/* Garlo AI Selling — modules/messenger.js (v8)
   Conversation data layer for Kleinanzeigen messages.

   DESIGN:
     • Storage: 'inbox'  → { conversations: [], lastSync: number }
                'messages' → { [conversationId]: Message[] }
     • Read functions (getConversations, getMessages) work anywhere.
     • Sync functions (syncConversations, syncMessages) require chrome.tabs,
       so they must be called from the service worker via message routing.

   SAFETY:
     • All network-adjacent operations go through guard() (kill switch + consent).
     • Kleinanzeigen rate limits from rate-limiter.js apply.
     • Nothing is ever sent automatically — the reply fill only populates the
       composer textarea; the user clicks send.
     • Hidden background tabs, opened and closed programmatically, so the
       dashboard isn't disturbed. */

import { guard, GuardError, audit } from './guard.js';
import { waitForComplete, injectContent, sendWithRetry } from './tab-utils.js';

const INBOX_KEY = 'inbox';
const MESSAGES_KEY = 'messages';
const TAB_OPEN_TIMEOUT = 25000;
const MESSAGES_CACHE_DAYS = 30;

const get = (k) => new Promise((r) => chrome.storage.local.get(k, r));
const set = (o) => new Promise((r) => chrome.storage.local.set(o, r));

let chain = Promise.resolve();
function serial(fn) {
  const run = chain.then(fn);
  chain = run.catch(() => {});
  return run;
}

function makeId(...parts) {
  const s = parts.filter(Boolean).join('|');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h) + s.charCodeAt(i) | 0;
  return 'ka-' + Math.abs(h).toString(36);
}

/* ---------- read ---------- */

export async function getConversations() {
  const d = await get([INBOX_KEY]);
  const inbox = d[INBOX_KEY];
  return Array.isArray(inbox?.conversations) ? inbox.conversations : [];
}

export async function getLastSync() {
  const d = await get([INBOX_KEY]);
  return d[INBOX_KEY]?.lastSync || 0;
}

export async function getMessages(conversationId) {
  if (!conversationId) return [];
  const d = await get([MESSAGES_KEY]);
  const all = d[MESSAGES_KEY] || {};
  const arr = all[conversationId];
  return Array.isArray(arr) ? arr : [];
}

export async function getUnreadCount() {
  const list = await getConversations();
  return list.filter((c) => c.unread).length;
}

/* ---------- write ---------- */

export async function markRead(conversationId) {
  return serial(async () => {
    const d = await get([INBOX_KEY]);
    const inbox = d[INBOX_KEY] || { conversations: [], lastSync: 0 };
    let changed = false;
    inbox.conversations = (inbox.conversations || []).map((c) => {
      if (c.id === conversationId && c.unread) { changed = true; return { ...c, unread: false }; }
      return c;
    });
    if (changed) await set({ [INBOX_KEY]: inbox });
    return changed;
  });
}

export async function markAllRead() {
  return serial(async () => {
    const d = await get([INBOX_KEY]);
    const inbox = d[INBOX_KEY] || { conversations: [], lastSync: 0 };
    inbox.conversations = (inbox.conversations || []).map((c) => ({ ...c, unread: false }));
    await set({ [INBOX_KEY]: inbox });
  });
}

export async function clearAllMessages() {
  await set({ [INBOX_KEY]: { conversations: [], lastSync: 0 }, [MESSAGES_KEY]: {} });
}

/* ---------- sync conversations (list view) ---------- */

export async function syncConversations() {
  /* Guard: kill switch + consent + rate limit */
  try {
    await guard({
      feature: 'inboxSync',
      platform: 'kleinanzeigen',
      host: 'kleinanzeigen',
      rate: 'inbox',
      op: 'sync-conversations'
    });
  } catch (e) {
    if (e instanceof GuardError) return { ok: false, code: e.code, error: e.message };
    throw e;
  }

  let tab;
  try {
    tab = await chrome.tabs.create({
      url: 'https://www.kleinanzeigen.de/m-nachrichten.html',
      active: false
    });
  } catch (e) {
    return { ok: false, error: 'Tab konnte nicht geöffnet werden: ' + e.message };
  }

  try {
    await waitForComplete(tab.id, TAB_OPEN_TIMEOUT);
    /* SPA renders a bit after 'complete' — give it breathing room */
    await new Promise((r) => setTimeout(r, 1400));

    let resp;
    try {
      resp = await chrome.tabs.sendMessage(tab.id, { action: 'scrapeKleinanzeigenInbox' });
    } catch {
      await injectContent(tab.id, 'x');
      await new Promise((r) => setTimeout(r, 400));
      resp = await chrome.tabs.sendMessage(tab.id, { action: 'scrapeKleinanzeigenInbox' });
    }

    if (!resp?.ok) {
      return { ok: false, error: resp?.error || 'Scrape fehlgeschlagen.' };
    }

    /* Merge: keep unread flags from local cache if the platform didn't report */
    const d = await get([INBOX_KEY]);
    const prev = d[INBOX_KEY]?.conversations || [];
    const prevById = new Map(prev.map((c) => [c.id, c]));

    const fresh = (resp.conversations || []).map((c) => {
      const id = c.id || makeId(c.buyer, c.url);
      const old = prevById.get(id);
      return {
        ...c,
        id,
        /* Persist unread=false if we already marked it read locally */
        unread: old && old.unread === false ? false : !!c.unread,
        firstSeen: old?.firstSeen || Date.now(),
        lastSeen: Date.now()
      };
    });

    await set({
      [INBOX_KEY]: { conversations: fresh, lastSync: Date.now() }
    });

    await audit({
      feature: 'inboxSync',
      platform: 'kleinanzeigen',
      op: 'sync-conversations',
      outcome: 'ok',
      detail: `${fresh.length} Unterhaltungen`
    });

    return { ok: true, count: fresh.length, conversations: fresh };
  } finally {
    try { chrome.tabs.remove(tab.id); } catch { /* ignore */ }
  }
}

/* ---------- sync messages (single conversation) ---------- */

export async function syncMessages(conversationId, conversationUrl) {
  if (!conversationId || !conversationUrl) {
    return { ok: false, error: 'Fehlende Argumente.' };
  }
  try {
    await guard({
      feature: 'inboxSync',
      platform: 'kleinanzeigen',
      host: 'kleinanzeigen',
      rate: 'inbox',
      op: 'sync-messages'
    });
  } catch (e) {
    if (e instanceof GuardError) return { ok: false, code: e.code, error: e.message };
    throw e;
  }

  let tab;
  try {
    tab = await chrome.tabs.create({ url: conversationUrl, active: false });
  } catch (e) {
    return { ok: false, error: e.message };
  }

  try {
    await waitForComplete(tab.id, TAB_OPEN_TIMEOUT);
    await new Promise((r) => setTimeout(r, 1600));

    let resp;
    try {
      resp = await chrome.tabs.sendMessage(tab.id, { action: 'scrapeKleinanzeigenConversation' });
    } catch {
      await injectContent(tab.id, 'x');
      await new Promise((r) => setTimeout(r, 400));
      resp = await chrome.tabs.sendMessage(tab.id, { action: 'scrapeKleinanzeigenConversation' });
    }

    if (!resp?.ok) {
      return { ok: false, error: resp?.error || 'Scrape fehlgeschlagen.' };
    }

    const messages = Array.isArray(resp.messages) ? resp.messages : [];
    const trimmed = messages.slice(-100); /* cap to last 100 per conversation */

    const d = await get([MESSAGES_KEY]);
    const all = d[MESSAGES_KEY] || {};
    all[conversationId] = trimmed;
    /* Prune old conversations to keep storage in check */
    const keys = Object.keys(all);
    if (keys.length > MESSAGES_CACHE_DAYS) {
      const newest = keys.slice(-MESSAGES_CACHE_DAYS);
      const pruned = {};
      newest.forEach((k) => { pruned[k] = all[k]; });
      await set({ [MESSAGES_KEY]: pruned });
    } else {
      await set({ [MESSAGES_KEY]: all });
    }

    return { ok: true, messages: trimmed };
  } finally {
    try { chrome.tabs.remove(tab.id); } catch { /* ignore */ }
  }
}

/* ---------- reply fill (does NOT send) ----------
   Finds the user's already-open Kleinanzeigen tab, injects the text into
   the composer, highlights it, and returns. The user reviews and presses
   the send button themselves. This matches the V7 "semi-automatic" pattern. */

export async function fillReply(conversationUrl, text) {
  if (!text || !text.trim()) return { ok: false, error: 'Leerer Text.' };

  try {
    await guard({
      feature: 'chatAssist',
      platform: 'kleinanzeigen',
      host: 'kleinanzeigen',
      rate: 'publish', /* reuse 1/min — plenty */
      op: 'fill-reply',
      detail: text.slice(0, 80)
    });
  } catch (e) {
    if (e instanceof GuardError) return { ok: false, code: e.code, error: e.message };
    throw e;
  }

  /* Prefer a tab that is already on the conversation URL */
  const tabs = await new Promise((r) =>
    chrome.tabs.query({ url: '*://*.kleinanzeigen.de/*' }, r)
  );

  let target = null;
  if (conversationUrl) {
    /* Match the specific conversation id fragment if possible */
    const frag = String(conversationUrl).match(/\/m-nachrichten\/[^/?#]+/);
    if (frag) {
      target = tabs.find((t) => t.url && t.url.includes(frag[0]));
    }
  }
  if (!target && tabs.length) target = tabs[0];

  if (!target) {
    return { ok: false, error: 'Kein Kleinanzeigen-Tab offen. Bitte Nachrichten-Seite öffnen.' };
  }

  chrome.tabs.update(target.id, { active: true });

  let resp;
  try {
    resp = await sendWithRetry(
      target.id,
      { action: 'fillReply', data: { text } },
      { platform: 'kleinanzeigen', tries: 4, delay: 800,
        until: (r) => r?.ok || r?.error }
    );
  } catch (e) {
    return { ok: false, error: e.message };
  }

  if (!resp?.ok) {
    return { ok: false, error: resp?.error || 'Composer nicht gefunden.' };
  }

  await audit({
    feature: 'chatAssist',
    platform: 'kleinanzeigen',
    op: 'fill-reply',
    outcome: 'ok',
    detail: text.slice(0, 80)
  });

  return { ok: true, tabId: target.id };
}