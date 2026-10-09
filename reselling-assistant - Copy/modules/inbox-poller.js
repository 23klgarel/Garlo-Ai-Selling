/* Garlo AI Selling — modules/inbox-poller.js (v8)
   Background polling for new Kleinanzeigen messages. Runs only when:
     • feature is enabled in settings (settings.inboxAutoPoll = true)
     • kill switch is off
     • per-feature consent granted
     • rate-limiter allows (Kleinanzeigen inbox = 1 per 6 min max)

   Poll cadence: every 15 minutes.
     • Chrome min for unpacked extensions is 30 seconds; 15 min is safe.
     • Alarm is re-created on install and on startup because MV3 alarms
       may not survive a browser restart.

   On new message detected:
     • Updates inbox conversations
     • Fires a chrome.notifications toast
     • Bumps the badge

   Public API:
     ALARM
     ensureAlarm()
     disableAlarm()
     runPoll()          — the actual poll, safe to call manually
     isEnabled()        — reads settings */

import { guard, GuardError, isKilled, getSettings } from './guard.js';
import * as Messenger from './messenger.js';
import { notify } from './notify.js';

export const ALARM = 'garlo-inbox-poll';
const POLL_PERIOD_MIN = 15;

/* ---------- settings helpers ---------- */

export async function isEnabled() {
  const s = await getSettings();
  return !!s.inboxAutoPoll;
}

export async function setEnabled(on) {
  const s = await getSettings();
  const next = { ...s, inboxAutoPoll: !!on };
  await chrome.storage.local.set({ settings: next });
  if (on) await ensureAlarm();
  else await disableAlarm();
  return next;
}

/* ---------- alarm lifecycle ---------- */

export async function ensureAlarm() {
  try {
    if (!(await isEnabled())) return;
    if (await isKilled()) return;
    const existing = await chrome.alarms.get(ALARM);
    if (!existing) {
      await chrome.alarms.create(ALARM, {
        delayInMinutes: 2,
        periodInMinutes: POLL_PERIOD_MIN
      });
    }
  } catch { /* ignore */ }
}

export async function disableAlarm() {
  try { await chrome.alarms.clear(ALARM); } catch { /* ignore */ }
}

/* ---------- the poll ---------- */

export async function runPoll() {
  /* Guard: kill switch + consent + rate limit; bail silently if blocked */
  try {
    await guard({
      feature: 'inboxSync',
      platform: 'kleinanzeigen',
      host: 'kleinanzeigen',
      rate: 'inbox',
      op: 'inbox-poll',
      audit: false,
      auditDenied: false
    });
  } catch (e) {
    if (e instanceof GuardError) return { skipped: e.code };
    throw e;
  }

  /* Snapshot previous state to detect new */
  const before = await Messenger.getConversations();
  const beforeUnreadById = new Map(before.map((c) => [c.id, !!c.unread]));
  const beforeIds = new Set(before.map((c) => c.id));

  const r = await Messenger.syncConversations();
  if (!r.ok) return { skipped: r.code || 'sync-failed', error: r.error };

  const after = r.conversations || [];

  /* Detect new conversations and new unread flags */
  let newCount = 0;
  let unreadCount = 0;
  for (const c of after) {
    if (!beforeIds.has(c.id)) newCount++;
    else if (c.unread && beforeUnreadById.get(c.id) === false) unreadCount++;
  }

  const totalNew = newCount + unreadCount;

  if (totalNew > 0) {
    /* Fire one toast per new conversation, max 3 to avoid spam */
    const fresh = after.filter((c) =>
      !beforeIds.has(c.id) || (c.unread && beforeUnreadById.get(c.id) === false)
    ).slice(0, 3);

    for (const c of fresh) {
      await notify(
        'garlo-inbox-' + c.id + '-' + Date.now(),
        'Neue Kleinanzeigen-Nachricht',
        `${c.buyer || 'Käufer'}: ${(c.preview || '').slice(0, 120)}`
      );
    }

    if (totalNew > 3) {
      await notify(
        'garlo-inbox-more-' + Date.now(),
        `${totalNew - 3} weitere Nachrichten`,
        'Dashboard → Inbox öffnen für Details.'
      );
    }
  }

  /* Update the toolbar badge with unread count */
  try {
    if (chrome.action && chrome.action.setBadgeText) {
      const unread = after.filter((c) => c.unread).length;
      await chrome.action.setBadgeText({ text: unread > 0 ? String(unread) : '' });
      await chrome.action.setBadgeBackgroundColor({ color: '#f43f5e' });
    }
  } catch { /* ignore */ }

  return {
    ok: true,
    total: after.length,
    new: newCount,
    unread: unreadCount,
    totalNew
  };
}