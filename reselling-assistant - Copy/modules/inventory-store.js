/* Garlo AI Selling — modules/inventory-store.js (v7)
   Single source of truth for inventory reads/writes.

   Storage key: 'inventory' (array, newest first, capped at 500 items).
   Serializes all writes so concurrent callers don't clobber each other.

   Exports:
     getInventory()                             → Item[]
     getItem(id)                                → Item | null
     updateFields(id, patch)                    → Item | null
     setPlatformState(id, platform, patch)      → Item | null
     markPublished(id, platform, patch)         → Item | null
     migrateV7()                                → void (idempotent)
     REMOTE_OPS                                 → Set of allowed ops for page→SW calls
*/

const KEY = 'inventory';
const MAX_ITEMS = 500;
const SCHEMA_KEY = 'schemaVersion';
const SCHEMA_VERSION = 7;

const get = (k) => new Promise((r) => chrome.storage.local.get(k, r));
const set = (o) => new Promise((r) => chrome.storage.local.set(o, r));

/* Serialize writes so concurrent callers (queue + watcher + dashboard) don't clobber. */
let chain = Promise.resolve();
function serial(fn) {
  const run = chain.then(fn);
  chain = run.catch(() => {});
  return run;
}

export async function getInventory() {
  const d = await get([KEY]);
  return Array.isArray(d[KEY]) ? d[KEY] : [];
}

export async function getItem(id) {
  if (!id) return null;
  const list = await getInventory();
  return list.find((x) => x.id === id) || null;
}

export function updateFields(id, patch) {
  return serial(async () => {
    const list = await getInventory();
    const i = list.findIndex((x) => x.id === id);
    if (i === -1) return null;
    list[i] = { ...list[i], ...patch, updatedAt: Date.now() };
    await set({ [KEY]: list.slice(0, MAX_ITEMS) });
    return list[i];
  });
}

export function setPlatformState(id, platform, patch) {
  if (!platform) return Promise.resolve(null);
  return serial(async () => {
    const list = await getInventory();
    const i = list.findIndex((x) => x.id === id);
    if (i === -1) return null;
    const item = list[i];
    const pub = { ...(item.publishedTo || {}) };
    pub[platform] = { ...(pub[platform] || {}), ...patch, updatedAt: Date.now() };
    list[i] = { ...item, publishedTo: pub, updatedAt: Date.now() };
    await set({ [KEY]: list.slice(0, MAX_ITEMS) });
    return list[i];
  });
}

/* Convenience wrapper: force status='live' unless caller overrides. */
export function markPublished(id, platform, patch = {}) {
  return setPlatformState(id, platform, {
    ...patch,
    status: patch.status || 'live',
    ts: patch.ts || Date.now()
  });
}

/* V7 migration — idempotent. Adds publishedTo, listedAt, priceLog, sourceImages.
   Never deletes data. Safe to run multiple times. */
export function migrateV7() {
  return serial(async () => {
    const d = await get([KEY, SCHEMA_KEY]);
    if (d[SCHEMA_KEY] === SCHEMA_VERSION) return;

    const list = Array.isArray(d[KEY]) ? d[KEY] : [];
    const migrated = list.map((item) => {
      const out = { ...item };
      if (!out.publishedTo || typeof out.publishedTo !== 'object') out.publishedTo = {};
      if (!Array.isArray(out.priceLog)) out.priceLog = [];
      if (!Array.isArray(out.sourceImages)) out.sourceImages = [];
      if (!Array.isArray(out.apiImageUrls)) out.apiImageUrls = [];
      if (!Array.isArray(out.priceDropPendingApply)) out.priceDropPendingApply = [];

      /* V6 items marked 'listed' never recorded a platform entry — flag as unknown
         so they still count as delist targets and stale-price candidates. */
      if (out.status === 'listed' && !out.listedAt) {
        out.listedAt = out.updatedAt || out.createdAt || Date.now();
        const p = out.platform || 'kleinanzeigen';
        if (!out.publishedTo[p]) {
          out.publishedTo[p] = { status: 'unknown', source: 'migration-v6', ts: out.listedAt };
        }
      }
      return out;
    });

    await set({ [KEY]: migrated.slice(0, MAX_ITEMS), [SCHEMA_KEY]: SCHEMA_VERSION });
  });
}

/* Ops that extension pages may invoke via chrome.runtime.sendMessage({action:'invStore',op,args}).
   Whitelist prevents arbitrary function execution from a compromised page context. */
export const REMOTE_OPS = new Set([
  'getInventory',
  'getItem',
  'updateFields',
  'setPlatformState',
  'markPublished'
]);