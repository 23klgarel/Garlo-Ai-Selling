/* Garlo AI Selling — modules/ledger.js (v9.0)
   Immutable financial ledger. Every sale and expense is a row.
   Rows are never edited in place — reversals create a paired entry.

   Storage: 'ledger' → LedgerEntry[]

   LedgerEntry shape:
   {
     id: 'led-xxxx',
     type: 'sale' | 'expense' | 'reversal',
     ts: number,                // when recorded
     occurredAt: number,        // when it happened (may be earlier)
     itemId: string|null,
     platform: string|null,     // 'kleinanzeigen' | 'ebay' | 'vinted'
     buyer: string|null,
     revenue: number,           // 0 for expenses
     costBasis: number,         // purchase price (0 for expenses)
     fees: number,              // eBay + payment fees (0 for expenses)
     expenses: number,          // extra costs (shipping, packaging)
     netProfit: number,         // revenue - costBasis - fees - expenses
     notes: string,
     reversedBy: string|null,   // id of the reversal entry
     source: 'auto-status' | 'auto-ebay' | 'manual',
     snapshot: { title, condition, sourceBrand, originalUrl }
   }

   Public API:
     recordSale({ item, soldPrice, buyer, occurredAt, fees, expenses, source })
     recordExpense({ itemId, amount, category, notes, occurredAt })
     reverseEntry(entryId, reason)
     getLedger({ from, to, platform, itemId, type })
     getLedgerStats({ from, to })
     clearLedger()
     exportLedger()
     importLedger(entries)
     migrateLedgerV9() */

import { breakEvenPrice } from './pricing.js';

const LEDGER_KEY = 'ledger';
const LEDGER_LIMIT = 5000;

const get = (k) => new Promise((r) => chrome.storage.local.get(k, r));
const set = (o) => new Promise((r) => chrome.storage.local.set(o, r));

/* Serialize writes — the queue, the watcher, and the dashboard can all write */
let chain = Promise.resolve();
function serial(fn) {
  const run = chain.then(fn);
  chain = run.catch(() => {});
  return run;
}

const uid = (prefix) => prefix + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
const num = (s) => {
  if (typeof s === 'number') return isFinite(s) ? s : 0;
  if (s == null) return 0;
  const n = parseFloat(String(s).replace(/\s/g, '').replace(/[^\d.,-]/g, '').replace(',', '.'));
  return isFinite(n) ? n : 0;
};

/* Fee model — mirrors modules/pricing.js but inlined so the ledger is
   self-contained and can compute fees without an extra read. */
function computeFees({ platform, revenue }) {
  if (!revenue || revenue <= 0) return 0;
  let fee = 0;
  if (platform === 'ebay') fee += revenue * 0.11 + 0.35;
  /* Payment processing applies to KA/eBay/Vinted alike in practice */
  fee += revenue * 0.025;
  return Math.round(fee * 100) / 100;
}

/* ---------- read ---------- */
export async function getLedger(filter = {}) {
  const d = await get([LEDGER_KEY]);
  const all = Array.isArray(d[LEDGER_KEY]) ? d[LEDGER_KEY] : [];
  const { from, to, platform, itemId, type, includeReversals = false } = filter;
  return all.filter((e) => {
    if (!includeReversals && e.reversedBy) return false;
    if (type && e.type !== type) return false;
    if (platform && e.platform !== platform) return false;
    if (itemId && e.itemId !== itemId) return false;
    if (from && e.occurredAt < from) return false;
    if (to && e.occurredAt > to) return false;
    return true;
  });
}

export async function getLedgerStats(filter = {}) {
  const list = await getLedger(filter);
  let revenue = 0, cost = 0, fees = 0, expenses = 0, profit = 0, count = 0, expensesOnly = 0;
  for (const e of list) {
    if (e.type === 'sale') {
      revenue += e.revenue;
      cost += e.costBasis;
      fees += e.fees;
      expenses += e.expenses;
      profit += e.netProfit;
      count++;
    } else if (e.type === 'expense') {
      expensesOnly += e.expenses || e.revenue || 0;
    }
  }
  return {
    revenue: round2(revenue),
    cost: round2(cost),
    fees: round2(fees),
    expenses: round2(expenses),
    generalExpenses: round2(expensesOnly),
    netProfit: round2(profit - expensesOnly),
    saleCount: count
  };
}

function round2(n) { return Math.round(n * 100) / 100; }

/* ---------- write ---------- */

/* recordSale — preferred path from updateStatus and publishComplete.
   Idempotent per itemId+occurredAt second (dedupe double-clicks). */
export function recordSale({
  item,
  soldPrice,
  buyer = '',
  occurredAt = Date.now(),
  fees = null,
  expenses = 0,
  source = 'auto-status',
  notes = ''
} = {}) {
  return serial(async () => {
    if (!item || !item.id) return { ok: false, error: 'Kein Artikel.' };
    const revenue = num(soldPrice) || num(item.targetPrice) || num(item.price);
    if (revenue <= 0) return { ok: false, error: 'Kein gültiger Verkaufspreis.' };

    const d = await get([LEDGER_KEY]);
    const all = Array.isArray(d[LEDGER_KEY]) ? d[LEDGER_KEY] : [];

    /* Dedupe: same item + same second → existing entry wins */
    const existing = all.find((e) =>
      e.type === 'sale' &&
      e.itemId === item.id &&
      Math.abs(e.occurredAt - occurredAt) < 2000
    );
    if (existing) return { ok: true, entry: existing, deduped: true };

    const costBasis = num(item.purchasePrice);
    const computedFees = fees != null ? num(fees) : computeFees({ platform: item.platform, revenue });
    const extraExpenses = num(expenses);
    const netProfit = round2(revenue - costBasis - computedFees - extraExpenses);

    const entry = {
      id: uid('led'),
      type: 'sale',
      ts: Date.now(),
      occurredAt,
      itemId: item.id,
      platform: item.platform || null,
      buyer: String(buyer || '').slice(0, 80),
      revenue: round2(revenue),
      costBasis: round2(costBasis),
      fees: round2(computedFees),
      expenses: round2(extraExpenses),
      netProfit,
      notes: String(notes || '').slice(0, 400),
      reversedBy: null,
      source,
      snapshot: {
        title: String(item.title || '').slice(0, 200),
        condition: item.condition || '',
        sourceBrand: item.sourceBrand || '',
        originalUrl: item.originalUrl || ''
      }
    };

    all.unshift(entry);
    await set({ [LEDGER_KEY]: all.slice(0, LEDGER_LIMIT) });
    return { ok: true, entry };
  });
}

export function recordExpense({
  itemId = null,
  amount,
  category = 'general',
  notes = '',
  occurredAt = Date.now()
} = {}) {
  return serial(async () => {
    const amt = num(amount);
    if (amt <= 0) return { ok: false, error: 'Betrag muss > 0 sein.' };

    const d = await get([LEDGER_KEY]);
    const all = Array.isArray(d[LEDGER_KEY]) ? d[LEDGER_KEY] : [];

    const entry = {
      id: uid('led'),
      type: 'expense',
      ts: Date.now(),
      occurredAt,
      itemId,
      platform: null,
      buyer: null,
      revenue: 0,
      costBasis: 0,
      fees: 0,
      expenses: round2(amt),
      netProfit: round2(-amt),
      notes: `[${category}] ${String(notes || '').slice(0, 340)}`.slice(0, 400),
      reversedBy: null,
      source: 'manual',
      snapshot: { title: category, condition: '', sourceBrand: '', originalUrl: '' }
    };

    all.unshift(entry);
    await set({ [LEDGER_KEY]: all.slice(0, LEDGER_LIMIT) });
    return { ok: true, entry };
  });
}

/* reverseEntry — never deletes. Creates a mirrored 'reversal' row that
   cancels out the original's net effect. The original gets reversedBy set. */
export function reverseEntry(entryId, reason = '') {
  return serial(async () => {
    const d = await get([LEDGER_KEY]);
    const all = Array.isArray(d[LEDGER_KEY]) ? d[LEDGER_KEY] : [];
    const idx = all.findIndex((e) => e.id === entryId);
    if (idx === -1) return { ok: false, error: 'Eintrag nicht gefunden.' };
    if (all[idx].reversedBy) return { ok: false, error: 'Bereits storniert.' };

    const orig = all[idx];
    const reversal = {
      id: uid('rev'),
      type: 'reversal',
      ts: Date.now(),
      occurredAt: Date.now(),
      itemId: orig.itemId,
      platform: orig.platform,
      buyer: null,
      revenue: round2(-orig.revenue),
      costBasis: round2(-orig.costBasis),
      fees: round2(-orig.fees),
      expenses: round2(-orig.expenses),
      netProfit: round2(-orig.netProfit),
      notes: `Storno von ${orig.id}${reason ? ': ' + reason : ''}`.slice(0, 400),
      reversedBy: null,
      source: 'manual',
      snapshot: orig.snapshot
    };

    all[idx] = { ...orig, reversedBy: reversal.id };
    all.unshift(reversal);
    await set({ [LEDGER_KEY]: all.slice(0, LEDGER_LIMIT) });
    return { ok: true, reversal, original: all[idx] };
  });
}

/* ---------- maintenance ---------- */
export function clearLedger() {
  return serial(async () => { await set({ [LEDGER_KEY]: [] }); });
}

export async function exportLedger() {
  const { [LEDGER_KEY]: all = [] } = await get([LEDGER_KEY]);
  return {
    exportedAt: new Date().toISOString(),
    version: '9.0',
    count: all.length,
    items: all
  };
}

export function importLedger(entries) {
  return serial(async () => {
    const d = await get([LEDGER_KEY]);
    const existing = Array.isArray(d[LEDGER_KEY]) ? d[LEDGER_KEY] : [];
    const ids = new Set(existing.map((e) => e.id));
    const merged = [...existing];
    let added = 0;
    for (const raw of entries || []) {
      if (!raw || typeof raw !== 'object' || !raw.id) continue;
      if (ids.has(raw.id)) continue;
      merged.push(raw);
      ids.add(raw.id);
      added++;
    }
    merged.sort((a, b) => (b.occurredAt || 0) - (a.occurredAt || 0));
    await set({ [LEDGER_KEY]: merged.slice(0, LEDGER_LIMIT) });
    return { ok: true, added };
  });
}

/* One-shot migration: for existing sold items that predate the ledger,
   synthesize a sale entry from their soldAt + targetPrice. */
export function migrateLedgerV9(inventory = []) {
  return serial(async () => {
    const d = await get([LEDGER_KEY]);
    const existing = Array.isArray(d[LEDGER_KEY]) ? d[LEDGER_KEY] : [];
    const existingItemIds = new Set(existing.filter((e) => e.type === 'sale').map((e) => e.itemId));
    const toAdd = [];
    for (const item of inventory) {
      if (item.status !== 'sold') continue;
      if (!item.soldAt) continue;
      if (existingItemIds.has(item.id)) continue;
      const revenue = num(item.soldPrice) || num(item.targetPrice) || num(item.price);
      if (revenue <= 0) continue;
      const costBasis = num(item.purchasePrice);
      const fees = computeFees({ platform: item.platform, revenue });
      toAdd.push({
        id: uid('led'),
        type: 'sale',
        ts: Date.now(),
        occurredAt: item.soldAt,
        itemId: item.id,
        platform: item.platform || null,
        buyer: '',
        revenue: round2(revenue),
        costBasis: round2(costBasis),
        fees,
        expenses: 0,
        netProfit: round2(revenue - costBasis - fees),
        notes: 'Migration V9 — aus Altbestand rekonstruiert',
        reversedBy: null,
        source: 'auto-status',
        snapshot: {
          title: String(item.title || '').slice(0, 200),
          condition: item.condition || '',
          sourceBrand: item.sourceBrand || '',
          originalUrl: item.originalUrl || ''
        }
      });
    }
    if (toAdd.length) {
      const merged = [...toAdd, ...existing];
      merged.sort((a, b) => (b.occurredAt || 0) - (a.occurredAt || 0));
      await set({ [LEDGER_KEY]: merged.slice(0, LEDGER_LIMIT) });
    }
    return { ok: true, added: toAdd.length };
  });
}