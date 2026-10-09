/* Garlo AI Selling — modules/backup.js (v9.0)
   Full JSON backup + restore. Ledger-only and analytics-only exports.

   BACKUP FORMAT:
     {
       format: 'garlo-backup',
       version: '9.0',
       exportedAt: ISO string,
       appVersion: chrome version,
       counts: { inventory, ledger, inbox, messages, buyerProfiles, auditLog, ... },
       data: { ...all storage keys... }
     }

   RESTORE BEHAVIOR:
     merge mode (default) — add entries with new IDs, keep existing
     replace mode (opt-in) — wipe before import (destructive, confirmed by caller)

   Public API:
     createFullBackup()
     createLedgerBackup()
     createAnalyticsSnapshot()
     restoreFromBackup(json, { mode }) */

import { getLedgerStats } from './ledger.js';
import { getMonthlyBreakdown, getTurnoverMetrics, getROIBy, getBestSellers } from './analytics-engine.js';

const SCHEMA_VERSION = '9.0';

/* Keys we include in a full backup */
const BACKUP_KEYS = [
  'inventory',
  'ledger',
  'inbox',
  'messages',
  'imageCache',
  'buyerProfiles',
  'replyTemplates',
  'promptPresets',
  'archive',
  'settings',
  'priceRules',
  'priceWatchState',
  'auditLog',
  'modelPreference',
  'platformCredentials',
  'vintedSelectorOverrides'
];

const get = (k) => new Promise((r) => chrome.storage.local.get(k, r));
const set = (o) => new Promise((r) => chrome.storage.local.set(o, r));

function countOf(v) {
  if (Array.isArray(v)) return v.length;
  if (v && typeof v === 'object') return Object.keys(v).length;
  return v ? 1 : 0;
}

/* ============================================================
   BACKUP CREATION
   ============================================================ */
export async function createFullBackup() {
  const data = await get(BACKUP_KEYS);
  const counts = {};
  for (const k of BACKUP_KEYS) counts[k] = countOf(data[k]);

  const payload = {
    format: 'garlo-backup',
    version: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: safeChromeVersion(),
    counts,
    data
  };

  return {
    filename: `garlo-backup-${new Date().toISOString().slice(0, 10)}.json`,
    blob: new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
    counts
  };
}

export async function createLedgerBackup() {
  const data = await get(['ledger', 'inventory']);
  const ledger = Array.isArray(data.ledger) ? data.ledger : [];

  /* Include a lightweight inventory index so the ledger stays interpretable */
  const inv = Array.isArray(data.inventory) ? data.inventory : [];
  const inventoryIndex = {};
  for (const item of inv) {
    inventoryIndex[item.id] = {
      title: item.title || '',
      sourceBrand: item.sourceBrand || '',
      originalUrl: item.originalUrl || '',
      purchasePrice: item.purchasePrice || '',
      condition: item.condition || ''
    };
  }

  const payload = {
    format: 'garlo-ledger',
    version: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    entryCount: ledger.length,
    entries: ledger,
    inventoryIndex
  };

  return {
    filename: `garlo-ledger-${new Date().toISOString().slice(0, 10)}.json`,
    blob: new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
    count: ledger.length
  };
}

export async function createAnalyticsSnapshot() {
  const [
    stats30,
    stats90,
    statsLifetime,
    monthly,
    turnover,
    roiPlatform,
    roiBrand,
    roiCategory,
    topRevenue,
    topUnits
  ] = await Promise.all([
    getLedgerStats({ from: Date.now() - 30 * 86400000 }),
    getLedgerStats({ from: Date.now() - 90 * 86400000 }),
    getLedgerStats({}),
    getMonthlyBreakdown(12),
    getTurnoverMetrics(),
    getROIBy('platform', { minItems: 1 }),
    getROIBy('brand', { minItems: 1 }),
    getROIBy('category', { minItems: 1 }),
    getBestSellers({ by: 'revenue', limit: 10 }),
    getBestSellers({ by: 'units', limit: 10 })
  ]);

  const snapshot = {
    format: 'garlo-analytics',
    version: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    stats30,
    stats90,
    statsLifetime,
    monthly,
    turnover,
    roiByPlatform: roiPlatform,
    roiByBrand: roiBrand,
    roiByCategory: roiCategory,
    topByRevenue: topRevenue,
    topByUnits: topUnits
  };

  return {
    filename: `garlo-analytics-${new Date().toISOString().slice(0, 10)}.json`,
    blob: new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' })
  };
}

/* ============================================================
   RESTORE
   ============================================================ */
export async function restoreFromBackup(rawText, { mode = 'merge' } = {}) {
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (e) {
    return { ok: false, error: 'Ungültige JSON-Datei: ' + e.message };
  }

  if (!parsed || parsed.format !== 'garlo-backup' || !parsed.data) {
    return { ok: false, error: 'Kein Garlo-Backup (format != "garlo-backup").' };
  }

  /* Reject future-version backups we can't safely interpret */
  const incomingVersion = parseFloat(parsed.version || '0');
  const currentVersion = parseFloat(SCHEMA_VERSION);
  if (incomingVersion > currentVersion) {
    return { ok: false, error: `Backup-Version ${parsed.version} ist neuer als die Extension (${SCHEMA_VERSION}).` };
  }

  const summary = { added: {}, replaced: {}, skipped: [], mode };

  if (mode === 'replace') {
    /* Wipe only the keys we manage */
    const wipe = {};
    for (const k of BACKUP_KEYS) wipe[k] = k === 'settings' ? {} : (Array.isArray(parsed.data[k]) ? [] : {});
    await set(wipe);
  }

  /* Merge each key */
  for (const k of BACKUP_KEYS) {
    const incoming = parsed.data[k];
    if (incoming == null) continue;
    const existing = (await get([k]))[k];

    /* Arrays: merge by id where possible */
    if (Array.isArray(incoming)) {
      const merged = mergeArrays(k, Array.isArray(existing) ? existing : [], incoming);
      await set({ [k]: merged.list });
      summary.added[k] = merged.added;
      if (merged.skipped) summary.skipped.push(`${k}: ${merged.skipped} übersprungen`);
    }
    /* Objects: shallow merge, incoming wins on conflicts */
    else if (typeof incoming === 'object') {
      const merged = { ...(existing || {}), ...incoming };
      await set({ [k]: merged });
      summary.added[k] = countOf(incoming);
    }
    /* Scalars: overwrite if incoming is set */
    else if (existing == null || mode === 'replace') {
      await set({ [k]: incoming });
      summary.added[k] = 1;
    }
  }

  return { ok: true, summary, exportedAt: parsed.exportedAt, version: parsed.version };
}

function mergeArrays(key, existing, incoming) {
  const ids = new Set(existing.map((x) => x && x.id).filter(Boolean));
  const merged = [...existing];
  let added = 0, skipped = 0;

  for (const raw of incoming) {
    if (!raw || typeof raw !== 'object') { skipped++; continue; }
    /* Items without an id can't be deduped — skip to avoid silent dupes */
    if (!raw.id) { skipped++; continue; }
    if (ids.has(raw.id)) { skipped++; continue; }
    merged.push(raw);
    ids.add(raw.id);
    added++;
  }

  /* Keep newest first for the arrays that care about order */
  if (key === 'ledger' || key === 'auditLog') {
    merged.sort((a, b) => (b.occurredAt || b.ts || 0) - (a.occurredAt || a.ts || 0));
  }
  if (key === 'inventory') {
    merged.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  /* Cap same as the writers do */
  const caps = {
    inventory: 500,
    ledger: 5000,
    auditLog: 800,
    imageCache: 24,
    messages: undefined /* object, not array — won't hit this branch */
  };
  const cap = caps[key];
  const finalList = cap ? merged.slice(0, cap) : merged;

  return { list: finalList, added, skipped };
}

/* ============================================================
   HELPERS
   ============================================================ */
function safeChromeVersion() {
  try {
    if (chrome.runtime && chrome.runtime.getManifest) {
      return chrome.runtime.getManifest().version || 'unknown';
    }
  } catch { /* ignore */ }
  return 'unknown';
}

export function formatBytes(bytes) {
  if (!isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(2) + ' MB';
}