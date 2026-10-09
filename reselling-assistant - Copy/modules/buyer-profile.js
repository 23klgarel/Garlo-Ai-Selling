/* Garlo AI Selling — modules/buyer-profile.js (v8)
   Lightweight buyer reputation tracking. Purely local — no server, no
   external lookups. Scores are computed from the user's own history.

   Storage: 'buyerProfiles' → {
     [buyerName]: {
       messagesReceived, messagesSent, replies,
       firstSeen, lastSeen,
       soldTo, declined,
       avgResponseMins,
       notes
     }
   }

   Score (0–100):
     +30 base if we've ever replied
     +20 if they bought
     +20 if avg response time < 60 min
     +15 if > 5 messages exchanged (engaged buyer)
     −50 if marked as declined/trouble
   */

const KEY = 'buyerProfiles';

const get = (k) => new Promise((r) => chrome.storage.local.get(k, r));
const set = (o) => new Promise((r) => chrome.storage.local.set(o, r));

let chain = Promise.resolve();
function serial(fn) {
  const run = chain.then(fn);
  chain = run.catch(() => {});
  return run;
}

function normalise(name) {
  return String(name || '').trim().toLowerCase().slice(0, 60);
}

export function scoreProfile(p) {
  if (!p) return 0;
  let score = 0;
  if (p.replies > 0) score += 30;
  if (p.soldTo) score += 20;
  if (p.avgResponseMins && p.avgResponseMins < 60) score += 20;
  if ((p.messagesReceived || 0) > 5) score += 15;
  if (p.declined) score -= 50;
  return Math.max(0, Math.min(100, score));
}

export function tierFor(score) {
  if (score >= 70) return 'high';
  if (score >= 40) return 'mid';
  return 'low';
}

export async function getProfile(buyerName) {
  const d = await get([KEY]);
  const map = d[KEY] || {};
  const key = normalise(buyerName);
  const p = map[key];
  if (!p) return null;
  return { ...p, score: scoreProfile(p), tier: tierFor(scoreProfile(p)) };
}

export async function getProfileMap() {
  const d = await get([KEY]);
  const map = d[KEY] || {};
  const out = {};
  for (const [k, v] of Object.entries(map)) {
    const s = scoreProfile(v);
    out[k] = { ...v, score: s, tier: tierFor(s) };
  }
  return out;
}

export function recordMessage(buyerName, { from = 'them' } = {}) {
  return serial(async () => {
    const d = await get([KEY]);
    const map = d[KEY] || {};
    const key = normalise(buyerName);
    if (!key) return;

    const p = map[key] || {
      messagesReceived: 0,
      messagesSent: 0,
      replies: 0,
      soldTo: false,
      declined: false,
      firstSeen: Date.now(),
      notes: ''
    };
    const now = Date.now();
    p.lastSeen = now;
    if (from === 'them') p.messagesReceived = (p.messagesReceived || 0) + 1;
    else p.messagesSent = (p.messagesSent || 0) + 1;

    /* First reply tracking */
    if (from === 'me' && !p.replies) p.replies = 1;
    else if (from === 'me') p.replies = (p.replies || 0) + 1;

    map[key] = p;
    await set({ [KEY]: map });
  });
}

export function markSold(buyerName, sold = true) {
  return serial(async () => {
    const d = await get([KEY]);
    const map = d[KEY] || {};
    const key = normalise(buyerName);
    if (!key) return;
    const p = map[key] || { messagesReceived: 0, messagesSent: 0, replies: 0, firstSeen: Date.now(), notes: '' };
    p.soldTo = !!sold;
    p.lastSeen = Date.now();
    map[key] = p;
    await set({ [KEY]: map });
  });
}

export function markDeclined(buyerName, declined = true) {
  return serial(async () => {
    const d = await get([KEY]);
    const map = d[KEY] || {};
    const key = normalise(buyerName);
    if (!key) return;
    const p = map[key] || { messagesReceived: 0, messagesSent: 0, replies: 0, firstSeen: Date.now(), notes: '' };
    p.declined = !!declined;
    map[key] = p;
    await set({ [KEY]: map });
  });
}

export function setNote(buyerName, note) {
  return serial(async () => {
    const d = await get([KEY]);
    const map = d[KEY] || {};
    const key = normalise(buyerName);
    if (!key) return;
    const p = map[key] || { messagesReceived: 0, messagesSent: 0, replies: 0, firstSeen: Date.now(), notes: '' };
    p.notes = String(note || '').slice(0, 500);
    p.lastSeen = Date.now();
    map[key] = p;
    await set({ [KEY]: map });
  });
}

export function recordResponseTime(buyerName, minutes) {
  return serial(async () => {
    if (!isFinite(minutes) || minutes < 0) return;
    const d = await get([KEY]);
    const map = d[KEY] || {};
    const key = normalise(buyerName);
    if (!key) return;
    const p = map[key] || { messagesReceived: 0, messagesSent: 0, replies: 0, firstSeen: Date.now(), notes: '' };
    const prev = p.avgResponseMins;
    p.avgResponseMins = prev ? Math.round((prev + minutes) / 2) : Math.round(minutes);
    map[key] = p;
    await set({ [KEY]: map });
  });
}