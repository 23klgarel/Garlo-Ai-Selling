/* Garlo AI Selling — modules/v8-ui.js (v8)
   Split-pane inbox reader, reply composer, template chips, AI draft,
   buyer profile panel.

   Hooked into dashboard.js via initV8UI(ctx). The inbox tab in
   dashboard.html delegates all rendering here so dashboard.js stays
   small.

   ctx = {
     send, esc, toast, t, getItem,
     switchTab, openItemDrawer
   } */

import * as ReplyTemplates from './reply-templates.js';
import * as AiReply from './ai-reply.js';
import * as BuyerProfile from './buyer-profile.js';

const $ = (id) => document.getElementById(id);

let ctx = null;
let conversations = [];
let activeId = null;
let activeMessages = [];
let templates = [];
let selectedTemplateId = null;
let tone = 'friendly';
let userHint = '';
let unreadTimer = null;

/* ============================================================
   PUBLIC INIT
   ============================================================ */
export async function initV8UI(context) {
  ctx = context;
  await refreshInbox();
  bindEvents();
}

/* Called by dashboard.js whenever the Inbox tab is activated */
export async function onInboxTabActive() {
  await refreshInbox();
}

/* ============================================================
   INBOX LIST
   ============================================================ */
export async function refreshInbox() {
  const r = await ctx.send({ action: 'inboxGetConversations' });
  conversations = r?.conversations || [];
  updateBadge();
  renderInboxMeta(r?.lastSync || 0);
  renderConversationList();
  if (activeId) {
    /* Reload active conversation */
    const still = conversations.find((c) => c.id === activeId);
    if (!still) closeConversation();
  }
}

function updateBadge() {
  const unread = conversations.filter((c) => c.unread).length;
  const badge = $('inboxBadge');
  if (badge) {
    badge.textContent = unread;
    badge.hidden = unread === 0;
  }
  /* Update toolbar badge too via background? Simpler: local only. */
}

function renderInboxMeta(lastSync) {
  const el = $('inboxMeta');
  if (!el) return;
  if (!lastSync) { el.textContent = 'Noch nicht synchronisiert.'; return; }
  const ago = relTime(lastSync);
  el.textContent = `Letzte Sync: ${ago} · ${conversations.length} Unterhaltung(en)`;
}

function relTime(ms) {
  if (!ms) return '';
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'gerade eben';
  if (diff < 3_600_000) return `vor ${Math.floor(diff / 60_000)} Min.`;
  if (diff < 86_400_000) return `vor ${Math.floor(diff / 3_600_000)} Std.`;
  return new Date(ms).toLocaleDateString('de-DE');
}

function initials(name) {
  if (!name) return '?';
  const p = String(name).trim().split(/\s+/);
  return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase();
}

function renderConversationList() {
  const host = $('inboxList');
  if (!host) return;

  if (!conversations.length) {
    host.hidden = true;
    const empty = $('inboxEmpty');
    if (empty) empty.hidden = false;
    return;
  }

  host.hidden = false;
  const empty = $('inboxEmpty');
  if (empty) empty.hidden = true;

  const sorted = [...conversations].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  const e = ctx.esc;

  host.innerHTML = sorted.map((c) => `
    <div class="inbox-item ${c.unread ? 'unread' : 'read'}" data-cid="${e(c.id)}">
      <div class="inbox-avatar">${e(initials(c.buyer))}</div>
      <div class="inbox-body">
        <div class="inbox-row-top">
          <span class="inbox-buyer">${e(c.buyer || 'Unbekannt')}</span>
          <span class="inbox-time">${e(relTime(c.timestamp))}</span>
        </div>
        ${c.item ? `<div class="inbox-item-name">📦 ${e(c.item)}</div>` : ''}
        <div class="inbox-preview">${e(c.preview || '(kein Text)')}</div>
      </div>
      ${c.unread ? '<span class="inbox-unread-dot"></span>' : ''}
    </div>
  `).join('');

  host.querySelectorAll('.inbox-item').forEach((el) => {
    el.addEventListener('click', () => openConversation(el.dataset.cid));
  });
}

/* ============================================================
   CONVERSATION VIEW
   ============================================================ */
async function openConversation(id) {
  const conv = conversations.find((c) => c.id === id);
  if (!conv) return;
  activeId = id;

  /* Visual selection */
  document.querySelectorAll('.inbox-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.cid === id);
  });

  /* Auto-mark read locally + push to background */
  if (conv.unread) {
    conv.unread = false;
    renderConversationList();
    updateBadge();
    ctx.send({ action: 'inboxMarkRead', conversationId: id });
  }

  renderChatPane(conv, null, true);

  /* Fetch messages */
  const r = await ctx.send({ action: 'inboxGetMessages', conversationId: id });
  activeMessages = r?.messages || [];

  /* If we have no cached messages, fetch them */
  if (!activeMessages.length && conv.url) {
    renderChatPane(conv, [], true);
    const sync = await ctx.send({
      action: 'inboxSyncMessages',
      conversationId: id,
      conversationUrl: conv.url
    });
    if (sync?.ok) activeMessages = sync.messages || [];
    else if (sync?.error) ctx.toast(sync.error, 'warn', 5000);
  }

  renderChatPane(conv, activeMessages, false);
  recordBuyerInteraction(conv);
}

function recordBuyerInteraction(conv) {
  if (!conv?.buyer) return;
  /* Fire-and-forget — do not block UI */
  ctx.send({ action: 'buyerRecordMessage', buyerName: conv.buyer, from: 'them' });
}

async function loadBuyerProfile(buyerName) {
  const r = await ctx.send({ action: 'buyerGet', buyerName });
  return r?.profile || null;
}

async function renderChatPane(conv, messages, loading) {
  const pane = $('inboxChatPane');
  if (!pane) return;
  const e = ctx.esc;

  const profile = await loadBuyerProfile(conv.buyer);

  /* Header */
  const header = `
    <div class="pane-head">
      <div class="inbox-avatar">${e(initials(conv.buyer))}</div>
      <div style="flex:1;min-width:0;">
        <h2>${e(conv.buyer || 'Unbekannt')}</h2>
        <div class="pane-sub">
          ${conv.item ? `📦 ${e(conv.item)}` : ''}
          ${profile?.tier ? ` · <span class="buyer-badge ${e(profile.tier)}">${e(badgeLabel(profile.tier, profile.score))}</span>` : ''}
        </div>
      </div>
      <button class="icon-btn" id="chatRefreshBtn" title="Neu laden">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 12a9 9 0 1 1-3.3-7L21 8"/><path d="M21 3v5h-5"/>
        </svg>
      </button>
      <button class="icon-btn" id="chatOpenTabBtn" title="Im Browser öffnen">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
          <path d="M15 3h6v6"/><path d="M10 14 21 3"/>
        </svg>
      </button>
    </div>`;

  /* Body */
  let body;
  if (loading) {
    body = `<div class="chat-scroll"><div class="status"><span class="spinner"></span><span>Lade Nachrichten…</span></div></div>`;
  } else if (!messages.length) {
    body = `<div class="chat-scroll"><div style="text-align:center;color:var(--text-muted);padding:40px 20px;font-size:13px;">Keine Nachrichten gefunden.<br><span class="hint">Möglicherweise wurde die Unterhaltung geleert oder die Selektoren sind veraltet.</span></div></div>`;
  } else {
    body = `<div class="chat-scroll" id="chatScroll">
      ${messages.map((m) => bubbleHtml(m, e)).join('')}
    </div>`;
  }

  /* Composer */
  const composer = `
    <div class="chat-composer">
      <div class="template-chips" id="templateChips"></div>
      <textarea id="replyText" placeholder="Antwort schreiben…"></textarea>
      <div class="composer-actions">
        <button class="btn-side" id="replyAiBtn">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 3v3"/><path d="M18.4 5.6 16.3 7.7"/><path d="M21 12h-3"/>
            <path d="M18.4 18.4 16.3 16.3"/><path d="M12 18v3"/><path d="M5.6 18.4 7.7 16.3"/>
            <path d="M3 12h3"/><path d="M5.6 5.6 7.7 7.7"/>
          </svg>
          KI-Entwurf
        </button>
        <button class="btn-side" id="replyFillBtn">In Kleinanzeigen einfügen</button>
        <span class="spacer"></span>
        <button class="btn-side" id="replyClearBtn">Leeren</button>
      </div>
    </div>`;

  pane.innerHTML = header + body + composer;

  /* Wire */
  $('chatRefreshBtn')?.addEventListener('click', () => forceRefreshConversation());
  $('chatOpenTabBtn')?.addEventListener('click', () => {
    if (conv.url) chrome.tabs.create({ url: conv.url });
  });
  $('replyAiBtn')?.addEventListener('click', generateAiDraft);
  $('replyFillBtn')?.addEventListener('click', fillComposerInKleinanzeigen);
  $('replyClearBtn')?.addEventListener('click', () => { const ta = $('replyText'); if (ta) { ta.value = ''; ta.focus(); } });

  renderTemplateChips();

  /* Scroll to bottom */
  const scroll = $('chatScroll');
  if (scroll) scroll.scrollTop = scroll.scrollHeight;
}

function bubbleHtml(m, e) {
  const cls = m.from === 'me' ? 'me' : 'them';
  const time = m.time ? `<span class="chat-time">${e(m.time)}</span>` : '';
  return `<div class="chat-bubble ${cls}">${e(m.text)}${time}</div>`;
}

function badgeLabel(tier, score) {
  const labels = { high: '✓ verlässlich', mid: '~ neutral', low: '! Vorsicht' };
  return `${labels[tier] || tier}${score != null ? ' · ' + score : ''}`;
}

async function forceRefreshConversation() {
  if (!activeId) return;
  const conv = conversations.find((c) => c.id === activeId);
  if (!conv) return;
  renderChatPane(conv, null, true);
  const sync = await ctx.send({
    action: 'inboxSyncMessages',
    conversationId: activeId,
    conversationUrl: conv.url
  });
  if (sync?.ok) activeMessages = sync.messages || [];
  else if (sync?.error) ctx.toast(sync.error, 'warn', 5000);
  renderChatPane(conv, activeMessages, false);
}

function closeConversation() {
  activeId = null;
  activeMessages = [];
  const pane = $('inboxChatPane');
  if (pane) {
    pane.innerHTML = `
      <div class="pane-head">
        <div>
          <h2>Unterhaltung auswählen</h2>
          <div class="pane-sub">Wähle links eine Nachricht</div>
        </div>
      </div>
      <div class="inbox-empty">
        <div class="inbox-empty-icon">💬</div>
        <p>Klicke auf eine Unterhaltung, um den Verlauf zu sehen.</p>
      </div>`;
  }
}

/* ============================================================
   TEMPLATE CHIPS
   ============================================================ */
async function renderTemplateChips() {
  const r = await ctx.send({ action: 'templatesList' });
  templates = r?.templates || [];
  const host = $('templateChips');
  if (!host) return;
  const e = ctx.esc;
  host.innerHTML = templates.map((t) => `
    <span class="template-chip" data-tid="${e(t.id)}">${e(t.shortcut || t.label)}</span>
  `).join('');
  host.querySelectorAll('.template-chip').forEach((el) => {
    el.addEventListener('click', () => {
      const tpl = templates.find((t) => t.id === el.dataset.tid);
      if (!tpl) return;
      const ta = $('replyText');
      if (!ta) return;
      const cur = ta.value.trim();
      ta.value = cur ? `${cur}\n\n${tpl.text}` : tpl.text;
      ta.focus();
    });
  });
}

/* ============================================================
   AI DRAFT
   ============================================================ */
async function generateAiDraft() {
  if (!activeId) { ctx.toast('Erst Unterhaltung öffnen.', 'warn'); return; }
  const conv = conversations.find((c) => c.id === activeId);
  if (!conv) return;

  const btn = $('replyAiBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Generiere…'; }

  /* Optional: link inventory item by matching source title in conv.item */
  const item = ctx.findItemForConversation ? ctx.findItemForConversation(conv) : null;

  const hint = userHint || '';
  const template = selectedTemplateId
    ? templates.find((t) => t.id === selectedTemplateId)?.text || null
    : null;

  const r = await AiReply.draftReply({
    conversation: conv,
    messages: activeMessages,
    item,
    tone,
    userHint: hint,
    template
  });

  if (btn) {
    btn.disabled = false;
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 3v3"/><path d="M18.4 5.6 16.3 7.7"/><path d="M21 12h-3"/>
        <path d="M18.4 18.4 16.3 16.3"/><path d="M12 18v3"/><path d="M5.6 18.4 7.7 16.3"/>
        <path d="M3 12h3"/><path d="M5.6 5.6 7.7 7.7"/>
      </svg>
      KI-Entwurf`;
  }

  if (!r.ok) { ctx.toast(r.error, 'error', 6000); return; }

  const ta = $('replyText');
  if (ta) { ta.value = r.text; ta.focus(); }
  ctx.toast(`Entwurf generiert (${r.model})`, 'success');
}

/* ============================================================
   FILL IN KLEINANZEIGEN
   ============================================================ */
async function fillComposerInKleinanzeigen() {
  const ta = $('replyText');
  const text = ta?.value.trim();
  if (!text) { ctx.toast('Antwort ist leer.', 'warn'); return; }
  const conv = conversations.find((c) => c.id === activeId);
  if (!conv) return;

  const r = await ctx.send({
    action: 'inboxFillReply',
    conversationUrl: conv.url,
    text
  });

  if (!r?.ok) { ctx.toast(r?.error || 'Einfügen fehlgeschlagen.', 'error', 6000); return; }

  ctx.toast('In Kleinanzeigen eingefügt — bitte dort abschicken.', 'success', 4000);

  /* Record the reply once the user has decided to fill it in
     (best-effort signal, not proof they sent it) */
  if (conv.buyer) ctx.send({ action: 'buyerRecordMessage', buyerName: conv.buyer, from: 'me' });
}

/* ============================================================
   TOP-LEVEL EVENTS
   ============================================================ */
function bindEvents() {
  const sync = $('syncInboxBtn');
  if (sync) {
    sync.addEventListener('click', async () => {
      sync.disabled = true;
      const label = $('syncInboxLabel');
      const original = label?.textContent;
      if (label) label.textContent = '⏳ Synchronisiere…';
      const r = await ctx.send({ action: 'inboxSync' });
      sync.disabled = false;
      if (label) label.textContent = original || '🔄 Jetzt synchronisieren';

      if (!r?.ok) { ctx.toast(r?.error || 'Sync fehlgeschlagen.', 'error', 5000); return; }
      ctx.toast(`${r.count} Unterhaltung(en) geladen.`, 'success');
      await refreshInbox();
    });
  }

  /* Keyboard shortcut: / focuses the search input */
  document.addEventListener('keydown', (ev) => {
    if (ev.key === '/' && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName || '')) {
      ev.preventDefault();
      $('globalSearch')?.focus();
    }
  });

  /* Poll the badge every 90 s while dashboard is open */
  if (unreadTimer) clearInterval(unreadTimer);
  unreadTimer = setInterval(async () => {
    const r = await ctx.send({ action: 'inboxGetConversations' });
    if (r?.ok) {
      conversations = r.conversations || [];
      updateBadge();
    }
  }, 90000);
}