/* Garlo AI Selling — modules/publish-watch.js (v7)
   Watches a specific tab after a form-fill publish. When the tab's URL changes
   to something that looks like a live listing (per platforms.detectPublished),
   the item is marked live in the inventory and the watch is cleared.

   Used by:
     dashboard.js → doPublish() calls send({action:'watchRegister', tabId, itemId, platform})
     background.js → registers top-level listeners and forwards to onTabUpdated/onTabRemoved

   MV3 note: state lives in chrome.storage.local ('tabWatch'). No in-memory map.
   TTL is 6 h — a stale watch for a tab that never lands on a live URL is
   silently pruned on the next call. The queue uses its own detection path
   (bulk-queue.onTabUpdated) so this module is only for standalone publishes
   from the dashboard/table/drawer buttons. */

import * as Store from './inventory-store.js';
import { detectPublished } from './platforms.js';

const KEY = 'tabWatch';
const TTL_MS = 6 * 60 * 60 * 1000;

const get = (k) => new Promise((r) => chrome.storage.local.get(k, r));
const set = (o) => new Promise((r) => chrome.storage.local.set(o, r));

async function load() {
  const d = await get([KEY]);
  return d[KEY] && typeof d[KEY] === 'object' ? d[KEY] : {};
}
async function save(map) {
  await set({ [KEY]: map });
}
function prune(map) {
  const now = Date.now();
  const out = {};
  for (const [k, v] of Object.entries(map || {})) {
    if (v && now - (v.ts || 0) < TTL_MS) out[k] = v;
  }
  return out;
}

/* ---------- public API ---------- */
export async function register(tabId, { itemId, platform }) {
  if (!tabId || !itemId || !platform) return;
  const map = prune(await load());
  map[String(tabId)] = { itemId, platform, ts: Date.now() };
  await save(map);
}

export async function onTabUpdated(tabId, url) {
  if (!tabId || !url) return;
  const map = prune(await load());
  const entry = map[String(tabId)];
  if (!entry) return;

  const det = detectPublished(entry.platform, url);
  if (!det) return;

  try {
    await Store.markPublished(entry.itemId, entry.platform, {
      url: det.url,
      status: 'live',
      source: 'publish-watch'
    });
  } catch { /* store write failed — clear the watch anyway */ }

  delete map[String(tabId)];
  await save(map);
}

export async function onTabRemoved(tabId) {
  const map = await load();
  if (!map[String(tabId)]) return;
  delete map[String(tabId)];
  await save(map);
}