/* Garlo AI Selling — modules/rate-limiter.js (v9.2)
   Per-host, per-action rate limits + 24h lockout on hard blocks.

   V9.2: publish interval lowered 60 s → 30 s.
   Kleinanzeigen tolerates this. Below 15 s risks server-side anti-bot.

   CONTRACT (consumed by guard.js):
     checkRateLimit(host, action)   → resolves if allowed; throws with .code
     logAction(host, action)        → records a successful call timestamp
     handleHostError(host, status)  → applies 24h lockout for 403/429 */

const RATE_KEY = 'rateLimits';
const LOCK_KEY = 'lockouts';
const LOCKOUT_MS = 24 * 60 * 60 * 1000;

/* V9.2 — one shared constant so bulk-queue.js stays in sync */
const SECOND = 1000;
const MINUTE = 60 * SECOND;

const LIMITS = {
  kleinanzeigen: {
    scrape:  1 / (15 * SECOND),   /* 15 s  — was 30 s */
    inbox:   1 / (4 * MINUTE),    /* 4 min — was 6 min */
    publish: 1 / (30 * SECOND),   /* 30 s  — was 60 s  ← the change you need */
    delist:  1 / (15 * SECOND)    /* 15 s  — was 30 s */
  },
  ebay: {
    scrape:  1 / (5 * SECOND),
    publish: 1 / (20 * SECOND),   /* 20 s  — was 30 s */
    delist:  1 / (20 * SECOND)
  },
  vinted: {
    scrape:  1 / (15 * SECOND),
    publish: 1 / (30 * SECOND),
    delist:  1 / (15 * SECOND)
  },
  'ebay-api': {
    auth:    1 / (10 * SECOND),
    publish: 1 / (20 * SECOND),
    update:  1 / (5 * SECOND),
    end:     1 / (10 * SECOND),
    orders:  1 / (60 * SECOND)
  }
};

const get = (k) => new Promise((r) => chrome.storage.local.get(k, r));
const set = (o) => new Promise((r) => chrome.storage.local.set(o, r));

/* Serialize rate bookkeeping so parallel callers don't clobber each other */
let chain = Promise.resolve();
function serial(fn) {
  const run = chain.then(fn);
  chain = run.catch(() => {});
  return run;
}

function makeError(code, message, extra = {}) {
  const e = new Error(message);
  e.code = code;
  Object.assign(e, extra);
  return e;
}

export function checkRateLimit(host, action) {
  return serial(async () => {
    const now = Date.now();
    const d = await get([RATE_KEY, LOCK_KEY]);
    const lockouts = d[LOCK_KEY] || {};
    const limits = d[RATE_KEY] || {};

    const lockUntil = lockouts[host];
    if (lockUntil && now < lockUntil) {
      const remainMs = lockUntil - now;
      const hours = Math.ceil(remainMs / (60 * MINUTE));
      throw makeError(
        'LOCKOUT',
        `LOCKOUT: ${host} ist für ~${hours} h gesperrt (403/429 von der Plattform).`,
        { waitMs: remainMs }
      );
    }

    const key = `${host}:${action}`;
    const last = limits[key] || 0;
    const perMs = LIMITS[host]?.[action] ?? (1 / (5 * SECOND));
    const interval = perMs > 0 ? 1 / perMs : 0;
    const wait = interval - (now - last);

    if (wait > 0) {
      const secs = Math.ceil(wait / SECOND);
      throw makeError(
        'RATE_LIMIT',
        `RATE_LIMIT: ${host} · ${action} — bitte ${secs}s warten.`,
        { waitMs: wait }
      );
    }
    return true;
  });
}

export function logAction(host, action) {
  return serial(async () => {
    const d = await get([RATE_KEY]);
    const limits = { ...(d[RATE_KEY] || {}), [`${host}:${action}`]: Date.now() };
    await set({ [RATE_KEY]: limits });
  });
}

export function handleHostError(host, status) {
  if (status !== 403 && status !== 429) return Promise.resolve(false);
  return serial(async () => {
    const d = await get([LOCK_KEY]);
    const lockouts = { ...(d[LOCK_KEY] || {}), [host]: Date.now() + LOCKOUT_MS };
    await set({ [LOCK_KEY]: lockouts });
    return true;
  });
}