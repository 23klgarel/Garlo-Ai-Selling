/* Garlo AI Selling — modules/price-watcher.js (v7.1)
   "If not sold in N days, reduce price by X%".

   ALL PRICES ARE WHOLE EUROS (rounded up). No cents, no decimals — matches the
   rest of the extension (target price from EK × 2 is Math.ceil'd).

   RELIABILITY MODEL (MV3):
   chrome.alarms may be skipped while the service worker is asleep or the browser
   is closed, so correctness NEVER depends on alarm cadence:
     • decisions are timestamp-based (listedAt / lastPriceDropAt / lastRunAt),
       not counter-based
     • the alarm is hourly + re-created on install / startup; the dashboard also
       triggers a catch-up run when opened
     • at most ONE reduction per item per run → a week offline does not compound
       five drops

   The watcher changes item.targetPrice LOCALLY. It never edits live listings; it
   flags item.priceDropPendingApply so the UI can offer "apply to listing".

   FLOOR:
   When rules.floor is true (default), the watcher will never cut below
   breakEvenPrice(EK, soldOnPlatform). If the current price is already at or
   below the floor, the item is flagged priceFloorReached and skipped — with
   a single notification so the user knows why it stopped dropping.

   Exports:
     RULES_KEY, STATE_KEY, ALARM, DEFAULT_RULES
     getRules(), saveRules(patch)
     effectiveRule(item, rules)
     isLive(item)
     referenceTime(item)
     staleInfo(item, rules, now)
     computeFloor(item)
     ensureAlarm()
     runPriceWatcher({ reason }) */

import { guard, GuardError, audit } from './guard.js';
import * as Store from './inventory-store.js';
import { breakEvenPrice } from './pricing.js';
import { notify } from './notify.js';
import { ONLINE_STATUSES } from './platforms.js';

export const RULES_KEY = 'priceRules';       // written ONLY by the dashboard
export const STATE_KEY = 'priceWatchState';  // written ONLY by the watcher
export const ALARM = 'garlo-price-watch';

export const DEFAULT_RULES = {
  enabled: false,
  days: 14,
  percent: 10,
  floor: true
};

const DAY = 86400000;

/* ---------- number helpers ---------- */
const num = (s) => {
  if (s == null) return NaN;
  if (typeof s === 'number') return s;
  return parseFloat(String(s).replace(/\s/g, '').replace(/[^\d.,-]/g, '').replace(',', '.'));
};
const fmt = (n) => String(Math.ceil(n));   // whole euros, always

/* ---------- rules persistence ---------- */
export async function getRules() {
  const d = await chrome.storage.local.get([RULES_KEY]);
  return { ...DEFAULT_RULES, ...(d[RULES_KEY] || {}) };
}

export async function saveRules(patch) {
  const next = { ...(await getRules()), ...patch };
  await chrome.storage.local.set({ [RULES_KEY]: next });
  return next;
}

/* ---------- per-item rule resolution ----------
   item.priceRule = { mode:'inherit'|'on'|'off', days?, percent? }
     inherit → use the global rule's `enabled`, `days`, `percent`
     on      → always enabled, use item's days/percent if given, else global's
     off     → never enabled (excluded from the watcher) */
export function effectiveRule(item, rules) {
  const r = item.priceRule || {};
  const mode = r.mode || 'inherit';
  const enabled = mode === 'on' ? true : mode === 'off' ? false : !!rules.enabled;
  return {
    enabled,
    days: Math.max(1, Number(r.days) || rules.days),
    percent: Math.min(90, Math.max(1, Number(r.percent) || rules.percent)),
    mode
  };
}

/* ---------- which items are eligible ----------
   Only items with status 'listed'. Everything else (drafted / ready / sold)
   is out of scope — the watcher exists to fight stale listings. */
export function isLive(item) {
  return item.status === 'listed';
}

/* ---------- age reference ----------
   Priority: lastPriceDropAt (last time WE cut the price) → listedAt (when the
   user first marked it listed) → the earliest known publishedAt timestamp from
   any platform → fallback to updatedAt/createdAt. */
export function referenceTime(item) {
  if (item.lastPriceDropAt) return item.lastPriceDropAt;
  if (item.listedAt) return item.listedAt;
  const stamps = Object.values(item.publishedTo || {})
    .filter((p) => p && ONLINE_STATUSES.has(p.status) && p.ts)
    .map((p) => p.ts);
  if (stamps.length) return Math.min(...stamps);
  return item.updatedAt || item.createdAt || Date.now();
}

/* ---------- pure helper for the UI (stale badge) ---------- */
export function staleInfo(item, rules, now = Date.now()) {
  if (!isLive(item)) return { stale: false };
  const rule = effectiveRule(item, rules);
  if (!rule.enabled) return { stale: false, rule };
  const ageDays = Math.floor((now - referenceTime(item)) / DAY);
  return {
    stale: ageDays >= rule.days,
    ageDays,
    dueInDays: Math.max(0, rule.days - ageDays),
    rule
  };
}

/* ---------- floor ----------
   Lowest price at which selling still nets zero profit, given the platform's
   fee model. Uses the primary platform the item is listed on; defaults to
   Kleinanzeigen (fee-free) if none is live.

   Returns a NUMBER in whole euros (already Math.ceil'd), or NaN if EK is
   invalid. Callers MUST treat NaN as "cannot protect margin → skip". */
export function computeFloor(item) {
  const livePlatforms = Object.entries(item.publishedTo || {})
    .filter(([, p]) => p && ONLINE_STATUSES.has(p.status))
    .map(([k]) => k);

  /* Prefer eBay if listed there (fees are highest → floor is highest). */
  let platform = 'kleinanzeigen';
  if (livePlatforms.includes('ebay')) platform = 'ebay';
  else if (livePlatforms.includes('vinted')) platform = 'vinted';
  else if (item.platform) platform = item.platform;

  const raw = breakEvenPrice(item.purchasePrice, platform);
  if (!isFinite(raw)) return NaN;
  return Math.ceil(raw);
}

/* ---------- alarm management ---------- */
export async function ensureAlarm() {
  try {
    const existing = await chrome.alarms.get(ALARM);
    if (!existing) {
      await chrome.alarms.create(ALARM, { delayInMinutes: 1, periodInMinutes: 60 });
    }
  } catch {
    /* alarms API unavailable — the dashboard-open catch-up still runs */
  }
}

/* ============================================================
   MAIN ENTRY POINT
   Idempotent. Safe to call from alarm, startup, dashboard-open,
   or manual "Run now" button. Never throws past the guard check —
   a bug in one item must not abort the whole run.
   ============================================================ */
export async function runPriceWatcher({ reason = 'alarm' } = {}) {
  /* Guard first: kill switch, base consent, priceWatcher consent. */
  try {
    await guard({
      feature: 'priceWatcher',
      platform: '*',
      op: 'run',
      audit: false,
      auditDenied: false
    });
  } catch (e) {
    if (e instanceof GuardError) return { skipped: e.code, reason };
    throw e;
  }

  const rules = await getRules();
  const summary = {
    reason,
    ts: Date.now(),
    checked: 0,
    dropped: 0,
    atFloor: 0,
    noEk: 0,
    errors: 0
  };

  const items = await Store.getInventory();

  for (const item of items) {
    try {
      /* Only 'listed' items participate. */
      if (!isLive(item)) continue;

      const rule = effectiveRule(item, rules);
      if (!rule.enabled) continue;

      summary.checked++;

      /* --- age check --- */
      const ageDays = (Date.now() - referenceTime(item)) / DAY;
      if (ageDays < rule.days) continue;

      /* --- price validation --- */
      const current = num(item.targetPrice || item.price);
      if (!isFinite(current) || current <= 0) continue;

      /* --- compute next price in whole euros (round down for the cut, since
             the user wants a lower price — but keep it a whole euro). We use
             Math.floor on the % cut so "50 € - 10%" = "45 €" not "46 €". --- */
      const rawNext = current * (1 - rule.percent / 100);
      let next = Math.floor(rawNext);

      /* Never let a cut leave the price unchanged or increase it. */
      if (next >= current) next = current - 1;
      if (next < 1) next = 1;

      let note = '';

      /* --- floor enforcement --- */
      if (rules.floor) {
        const floor = computeFloor(item);

        if (!isFinite(floor)) {
          /* No valid EK → we cannot protect margin. Skip silently. */
          summary.noEk++;
          continue;
        }

        if (current <= floor) {
          /* Already at or below floor: flag once, notify once, skip. */
          summary.atFloor++;
          if (!item.priceFloorReached) {
            await Store.updateFields(item.id, { priceFloorReached: true });
            await audit({
              feature: 'priceWatcher',
              platform: '*',
              op: 'floor-reached',
              itemId: item.id,
              outcome: 'skipped',
              detail: `Preis ${fmt(current)} € ≤ Untergrenze ${fmt(floor)} €`
            });
            await notify(
              'garlo-floor-' + item.id,
              'Preis-Untergrenze erreicht',
              `${item.title || 'Artikel'}: keine weitere Senkung (min. ${fmt(floor)} €).`
            );
          }
          continue;
        }

        if (next < floor) {
          next = floor;
          note = ' (auf Untergrenze begrenzt)';
        }
      }

      if (next >= current) continue;

      /* --- apply the drop --- */
      const livePlatforms = Object.entries(item.publishedTo || {})
        .filter(([, p]) => p && ONLINE_STATUSES.has(p.status))
        .map(([k]) => k);

      const logEntry = {
        ts: Date.now(),
        from: fmt(current),
        to: fmt(next),
        percent: rule.percent,
        reason
      };

      await Store.updateFields(item.id, {
        targetPrice: fmt(next),
        lastPriceDropAt: Date.now(),
        priceFloorReached: false,
        priceDropPendingApply: livePlatforms,
        priceLog: [logEntry, ...(item.priceLog || [])].slice(0, 20)
      });

      await audit({
        feature: 'priceWatcher',
        platform: '*',
        op: 'price-drop',
        itemId: item.id,
        outcome: 'applied',
        detail: `${fmt(current)} → ${fmt(next)} € (−${rule.percent} %)${note}`
      });

      await notify(
        'garlo-drop-' + item.id + '-' + Date.now(),
        'Preis gesenkt',
        `${item.title || 'Artikel'}: ${fmt(current)} → ${fmt(next)} €${note}. Live-Inserate bitte anpassen.`
      );

      summary.dropped++;
    } catch (e) {
      /* One item failing must not abort the run. */
      summary.errors++;
      try {
        await audit({
          feature: 'priceWatcher',
          platform: '*',
          op: 'item-error',
          itemId: item?.id,
          outcome: 'error',
          detail: String(e?.message || e).slice(0, 300)
        });
      } catch { /* ignore */ }
    }
  }

  await chrome.storage.local.set({ [STATE_KEY]: summary });
  return summary;
}
