/* Garlo AI Selling — modules/bulk-queue.js (v9.0)
   Semi-automatic publish queue. Opens form, fills it, waits for the
   USER to submit. 60 s cooldown between items.

   V9 CHANGES:
     • Image fetch falls back to the dashboard's live imageCache when
       the item has no sourceImages (fixes V6-migrated items)
     • fetchImagesVerbose used so we log which image URLs failed
     • fillNote capped at 240 chars (prevents storage bloat)
     • audit detail capped (handled by guard, but we pass short strings)
     • Better error messages that name the failing step */

import { guard, GuardError, audit, isKilled } from './guard.js';
import * as Store from './inventory-store.js';
import { PLATFORMS, QUEUE_PLATFORMS, ONLINE_STATUSES, detectPublished } from './platforms.js';
import { waitForComplete, injectContent, sendWithRetry, fetchImagesVerbose } from './tab-utils.js';
import { notify } from './notify.js';

const KEY = 'bulkQueue';
export const ALARM = 'garlo-queue-tick';
export const COOLDOWN_MS = 30000;
const SUBMIT_TIMEOUT_MS = 30 * 60000;
const MAX_FILL_NOTE = 240;

let chain = Promise.resolve();
const serial = (fn) => { const run = chain.then(fn); chain = run.catch(() => {}); return run; };

const blank = () => ({ state: 'idle', items: [], cooldownUntil: 0, pausedReason: '', updatedAt: Date.now() });
async function load() { const d = await chrome.storage.local.get([KEY]); return d[KEY] && Array.isArray(d[KEY].items) ? d[KEY] : blank(); }
async function save(q) { q.updatedAt = Date.now(); await chrome.storage.local.set({ [KEY]: q }); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ensureAlarm() { await chrome.alarms.create(ALARM, { delayInMinutes: 0.5, periodInMinutes: 1 }); }
async function clearAlarm() { await chrome.alarms.clear(ALARM); }

/* ---------- public API ---------- */
export const getQueue = () => load();

export function enqueue(itemIds, platform) {
  return serial(async () => {
    if (!QUEUE_PLATFORMS.includes(platform)) throw new Error('Plattform wird von der Queue nicht unterstützt: ' + platform);
    const q = await load();
    const inv = await Store.getInventory();
    let added = 0, skipped = 0;
    for (const id of itemIds || []) {
      const item = inv.find((x) => x.id === id);
      const dup = q.items.some((e) => e.itemId === id && e.platform === platform && (e.status === 'pending' || e.status === 'in-progress'));
      const alreadyLive = item?.publishedTo?.[platform]?.status === 'live';
      if (!item || dup || alreadyLive) { skipped++; continue; }
      q.items.push({
        qid: 'q-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        itemId: id, platform, title: item.title || '(ohne Titel)',
        status: 'pending', stage: '', attempts: 0, error: '', addedAt: Date.now()
      });
      added++;
    }
    await save(q);
    await audit({ feature: 'bulkQueue', platform, op: 'enqueue', outcome: 'recorded', detail: `${added} hinzugefügt, ${skipped} übersprungen` });
    return { queue: q, added, skipped };
  });
}

export function start() {
  return serial(async () => {
    const q = await load();
    if (!q.items.some((e) => e.status === 'pending' || e.status === 'in-progress')) return { queue: q, error: 'Keine offenen Einträge.' };
    try {
      for (const p of new Set(q.items.filter((e) => e.status === 'pending').map((e) => e.platform))) {
        await guard({ feature: 'bulkQueue', platform: p, op: 'queue-start' });
      }
    } catch (e) {
      if (e instanceof GuardError) return { queue: q, error: e.message, code: e.code, feature: e.feature };
      throw e;
    }
    q.state = 'running'; q.pausedReason = '';
    await save(q);
    await ensureAlarm();
    setTimeout(() => tick().catch(() => {}), 50);
    return { queue: q };
  });
}

export function pause(reason = 'user') {
  return serial(async () => {
    const q = await load();
    if (q.state === 'running') { q.state = 'paused'; q.pausedReason = reason; await save(q); }
    await clearAlarm();
    return { queue: q };
  });
}
export const pauseForKill = () => pause('kill-switch');

export function retry(qid) {
  return serial(async () => {
    const q = await load();
    const e = q.items.find((x) => x.qid === qid);
    if (e && (e.status === 'failed' || e.status === 'done')) { e.status = 'pending'; e.stage = ''; e.error = ''; e.tabId = null; }
    await save(q);
    return { queue: q };
  });
}
export function remove(qid) {
  return serial(async () => {
    const q = await load();
    q.items = q.items.filter((x) => x.qid !== qid);
    await save(q);
    return { queue: q };
  });
}
export function clearFinished() {
  return serial(async () => {
    const q = await load();
    q.items = q.items.filter((x) => x.status === 'pending' || x.status === 'in-progress');
    await save(q);
    return { queue: q };
  });
}

export function markDone(qid, url = '') {
  return serial(async () => {
    const q = await load();
    const e = q.items.find((x) => x.qid === qid);
    if (!e) return { queue: q, error: 'Eintrag nicht gefunden' };
    await finish(q, e, url, 'manual');
    return { queue: q };
  });
}

/* ---------- tab events ---------- */
export function onTabUpdated(tabId, url) {
  return serial(async () => {
    if (!url) return;
    const q = await load();
    const e = q.items.find((x) => x.tabId === tabId && x.status === 'in-progress');
    if (!e) return;
    const det = detectPublished(e.platform, url);
    if (det) await finish(q, e, det.url, 'detected');
  });
}
export function onTabRemoved(tabId) {
  return serial(async () => {
    const q = await load();
    const e = q.items.find((x) => x.tabId === tabId && x.status === 'in-progress');
    if (!e) return;
    e.status = 'failed';
    e.error = 'Tab geschlossen, bevor eine Veröffentlichung erkannt wurde. Falls du abgeschickt hast: „Als veröffentlicht markieren“.';
    e.finishedAt = Date.now();
    q.cooldownUntil = Date.now() + COOLDOWN_MS;
    await save(q);
  });
}

async function finish(q, e, url, how) {
  e.status = 'done'; e.stage = ''; e.error = ''; e.finishedAt = Date.now();
  q.cooldownUntil = Date.now() + COOLDOWN_MS;
  await save(q);
  try { await Store.markPublished(e.itemId, e.platform, { url: url || '', status: 'live', source: 'queue-' + how }); }
  catch (err) { console.warn('markPublished', err); }
  await audit({ feature: 'bulkQueue', platform: e.platform, op: 'publish-complete', itemId: e.itemId, outcome: how, detail: url });
  await notify('garlo-q-' + e.qid, 'Queue: veröffentlicht', `${e.title} (${PLATFORMS[e.platform].label})`);
  if (q.state === 'running') setTimeout(() => tick().catch(() => {}), COOLDOWN_MS + 500);
}

function fail(q, e, msg) {
  e.status = 'failed';
  e.error = String(msg).slice(0, MAX_FILL_NOTE);
  e.finishedAt = Date.now();
  q.cooldownUntil = Date.now() + COOLDOWN_MS;
}

/* ---------- the engine ---------- */
export function tick() {
  return serial(async () => {
    const q = await load();
    if (q.state !== 'running') return q;

    if (await isKilled()) {
      q.state = 'paused'; q.pausedReason = 'kill-switch';
      await save(q); await clearAlarm();
      return q;
    }

    const now = Date.now();
    const cur = q.items.find((e) => e.status === 'in-progress');
    if (cur) {
      if (now - (cur.startedAt || now) > SUBMIT_TIMEOUT_MS) {
        fail(q, cur, 'Zeitüberschreitung (30 Min.) — nicht abgeschickt? Erneut versuchen oder manuell markieren.');
        await save(q);
      }
      return q;
    }

    if (now < q.cooldownUntil) return q;

    const next = q.items.find((e) => e.status === 'pending');
    if (!next) {
      q.state = 'idle'; q.pausedReason = '';
      await save(q); await clearAlarm();
      await notify('garlo-q-done', 'Queue abgeschlossen', `${q.items.filter((e) => e.status === 'done').length} erledigt, ${q.items.filter((e) => e.status === 'failed').length} fehlgeschlagen.`);
      return q;
    }

    try {
      await guard({
        feature: 'bulkQueue', platform: next.platform, host: PLATFORMS[next.platform].rateHost,
        rate: 'publish', op: 'queue-open-form', itemId: next.itemId
      });
    } catch (e) {
      if (e instanceof GuardError) {
        if (e.code === 'RATE_LIMIT') return q;
        q.state = 'paused'; q.pausedReason = e.code;
        await save(q); await clearAlarm();
        return q;
      }
      throw e;
    }

    next.status = 'in-progress'; next.stage = 'opening'; next.startedAt = now; next.attempts++; next.error = '';
    await save(q);
    try {
      await openAndFill(q, next);
      next.stage = 'awaiting-submit';
    } catch (err) {
      fail(q, next, err?.message || String(err));
    }
    await save(q);
    return q;
  });
}

async function openAndFill(q, entry) {
  const item = await Store.getItem(entry.itemId);
  if (!item) throw new Error('Artikel nicht mehr im Inventar.');
  const p = PLATFORMS[entry.platform];

  const tab = await chrome.tabs.create({ url: p.newUrl, active: true });
  entry.tabId = tab.id;
  await save(q);
  await waitForComplete(tab.id, 20000);

  /* ---------- V9: image fetch with cache fallback ---------- */
  let images = [];
  let imageNote = '';
  if (Array.isArray(item.sourceImages) && item.sourceImages.length) {
    const r = await fetchImagesVerbose(item.sourceImages, 8);
    images = r.images;
    if (r.failed.length) {
      console.info('[garlo] %d Bilder fehlgeschlagen:', r.failed.length, r.failed);
      imageNote = ` · ${r.failed.length} Bild(er) fehlgeschlagen`;
    }
  }
  /* Fallback: use the dashboard's live image cache */
  if (!images.length) {
    try {
      const d = await chrome.storage.local.get(['imageCache']);
      const cache = Array.isArray(d.imageCache) ? d.imageCache : [];
      images = cache.slice(0, 8).map((img) => ({
        dataUrl: img.dataUrl,
        filename: img.filename || 'garlo-cache.jpg'
      }));
      if (images.length) imageNote = ` · ${images.length} Bilder aus Cache`;
    } catch { /* ignore */ }
  }

  const payload = {
    title: item.title || '',
    price: item.targetPrice || item.price || '',
    description: item.description || '',
    platform: entry.platform,
    images,
    brand: item.sourceBrand || '',
    autoCategory: entry.platform === 'kleinanzeigen'
  };

  try { await injectContent(tab.id, entry.platform); } catch { /* retried inside sendWithRetry */ }
  const resp = await sendWithRetry(tab.id, { action: 'fillForm', data: payload }, {
    platform: entry.platform, tries: 6, delay: 1500,
    until: (r) => r?.killed || (r?.ok && r.result?.filled?.includes('Titel'))
  });
  if (resp?.killed) throw new Error(resp.error || 'Kill-Switch aktiv');
  if (!resp?.ok) throw new Error(resp?.error || 'Formular konnte nicht befüllt werden');

  const r = resp.result || {};
  const note = (
    `${(r.filled || []).join(', ') || '–'}` +
    (r.missing?.length ? ' · fehlt: ' + r.missing.join(', ') : '') +
    (images.length ? '' : ' · keine Bilder') +
    imageNote
  ).slice(0, MAX_FILL_NOTE);

  entry.fillNote = note;

  if (!r.filled?.includes('Titel')) {
    throw new Error('Formularfelder nicht gefunden (Selektoren evtl. veraltet). ' + note);
  }

  await Store.setPlatformState(entry.itemId, entry.platform, { status: 'pending', ts: Date.now(), source: 'queue' });
  await audit({
    feature: 'bulkQueue', platform: entry.platform, op: 'form-filled',
    itemId: entry.itemId, outcome: 'awaiting-user-submit', detail: note
  });
}