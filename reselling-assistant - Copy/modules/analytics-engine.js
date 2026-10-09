/* Garlo AI Selling — modules/analytics-engine.js (v9.0)
   Pure analytical functions. Reads ledger + inventory, returns
   plain objects. No DOM, no side effects, no writes.

   Public API:
     getMonthlyBreakdown(months=12)
     getRollingStats(days)
     compareMonths(monthOffset)
     getROIBy(field)  // 'brand' | 'category' | 'platform' | 'condition'
     getTurnoverMetrics()
     getDeadStock({ minDays })
     getForecast(months=3)
     getBestSellers({ by, limit })
     getTonePerformance(days=90)

   All heavy lifting is sequential — no fake async parallelism. */

import { getLedger, getLedgerStats } from './ledger.js';

/* ============================================================
   CATEGORY MAP (duplicated from content.js — kept in sync manually)
   ============================================================ */
const CATEGORIES = {
  'Handy & Telefon':    ['iphone', 'samsung galaxy', 'smartphone', 'pixel', 'xiaomi', 'oneplus', 'handy'],
  'Computer & Zubehör': ['laptop', 'notebook', 'pc', 'computer', 'tastatur', 'maus', 'monitor', 'ssd', 'webcam'],
  'TV, Audio & Kamera': ['fernseher', 'tv', 'kopfhörer', 'headset', 'lautsprecher', 'soundbar', 'airpods'],
  'Konsolen & Spiele':  ['playstation', 'xbox', 'nintendo', 'switch', 'controller', 'konsole'],
  'Foto & Camcorder':   ['kamera', 'objektiv', 'gopro', 'drohne', 'camcorder'],
  'Haushaltsgeräte':    ['staubsauger', 'kaffeemaschine', 'mixer', 'küchenmaschine', 'toaster'],
  'Spielzeug':          ['lego', 'playmobil', 'puppe', 'brettspiel', 'puzzle'],
  'Fahrräder':          ['fahrrad', 'e-bike', 'ebike', 'mountainbike', 'helm'],
  'Kleidung':           ['shirt', 'hose', 'jacke', 'schuhe', 'sneaker', 'tasche', 'gürtel'],
  'Beauty & Gesundheit': ['parfüm', 'creme', 'make-up', 'haartrockner', 'rasierer'],
  'Musikinstrumente':   ['gitarre', 'keyboard', 'piano', 'mikrofon', 'mischpult'],
  'Auto & Motorrad':    ['reifen', 'felge', 'motorrad', 'dachbox', 'helm']
};

function detectCategory(text) {
  const t = (text || '').toLowerCase();
  let best = 'Sonstiges', bestScore = 0;
  for (const [cat, kws] of Object.entries(CATEGORIES)) {
    let score = 0;
    kws.forEach((k) => { if (t.includes(k)) score += k.length; });
    if (score > bestScore) { bestScore = score; best = cat; }
  }
  return best;
}

/* ============================================================
   HELPERS
   ============================================================ */
const DAY = 86400000;
const round2 = (n) => Math.round(n * 100) / 100;
const monthKey = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const monthLabel = (key) => {
  const [y, m] = key.split('-');
  return new Date(Number(y), Number(m) - 1, 1)
    .toLocaleDateString('de-DE', { month: 'short', year: '2-digit' });
};

async function getInventory() {
  const d = await chrome.storage.local.get(['inventory']);
  return Array.isArray(d.inventory) ? d.inventory : [];
}

/* ============================================================
   TIME-SERIES
   ============================================================ */
export async function getMonthlyBreakdown(months = 12) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1).getTime();
  const entries = await getLedger({ from: start });

  /* Build an ordered array of month keys */
  const buckets = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    buckets.push({ key, label: monthLabel(key), revenue: 0, profit: 0, cost: 0, volume: 0, fees: 0 });
  }
  const byKey = Object.fromEntries(buckets.map((b) => [b.key, b]));

  for (const e of entries) {
    const k = monthKey(e.occurredAt);
    const b = byKey[k];
    if (!b) continue;
    if (e.type === 'sale') {
      b.revenue += e.revenue;
      b.profit += e.netProfit;
      b.cost += e.costBasis;
      b.fees += e.fees;
      b.volume += 1;
    } else if (e.type === 'expense') {
      b.profit -= e.expenses || 0;
    }
  }

  return buckets.map((b) => ({
    ...b,
    revenue: round2(b.revenue),
    profit: round2(b.profit),
    cost: round2(b.cost),
    fees: round2(b.fees)
  }));
}

export async function getRollingStats(days = 30) {
  const now = Date.now();
  const from = now - days * DAY;
  return getLedgerStats({ from });
}

export async function compareMonths(offset = 1) {
  const now = new Date();
  const thisStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const lastStart = new Date(now.getFullYear(), now.getMonth() - offset, 1).getTime();
  const lastEnd = thisStart;

  const [current, previous] = await Promise.all([
    getLedgerStats({ from: thisStart, to: now }),
    getLedgerStats({ from: lastStart, to: lastEnd })
  ]);

  const pct = previous.revenue > 0
    ? ((current.revenue - previous.revenue) / previous.revenue) * 100
    : (current.revenue > 0 ? 100 : 0);

  return {
    current,
    previous,
    revenueChangePct: round2(pct),
    profitChange: round2(current.netProfit - previous.netProfit)
  };
}

/* ============================================================
   ROI ANALYTICS
   ============================================================ */
export async function getROIBy(field = 'platform', { minItems = 3 } = {}) {
  const entries = await getLedger({ type: 'sale' });
  const groups = {};

  for (const e of entries) {
    const key = resolveField(e, field);
    if (!key) continue;
    if (!groups[key]) groups[key] = { key, count: 0, revenue: 0, cost: 0, profit: 0 };
    const g = groups[key];
    g.count++;
    g.revenue += e.revenue;
    g.cost += e.costBasis;
    g.profit += e.netProfit;
  }

  const list = Object.values(groups)
    .filter((g) => g.count >= minItems)
    .map((g) => ({
      key: g.key,
      count: g.count,
      revenue: round2(g.revenue),
      cost: round2(g.cost),
      profit: round2(g.profit),
      roi: g.cost > 0 ? round2((g.profit / g.cost) * 100) : 0,
      avgProfit: round2(g.profit / g.count)
    }))
    .sort((a, b) => b.roi - a.roi);

  return list;
}

function resolveField(entry, field) {
  const snap = entry.snapshot || {};
  if (field === 'platform') return entry.platform || 'unbekannt';
  if (field === 'brand') return snap.sourceBrand || 'unbekannt';
  if (field === 'condition') return snap.condition || 'unbekannt';
  if (field === 'category') return detectCategory(snap.title || '');
  return 'unbekannt';
}

/* ============================================================
   TURNOVER
   ============================================================ */
export async function getTurnoverMetrics() {
  const inventory = await getInventory();
  const sold = inventory.filter((x) => x.status === 'sold' && x.listedAt && x.soldAt);
  const listed = inventory.filter((x) => x.status === 'listed');

  const daysList = sold.map((x) => (x.soldAt - x.listedAt) / DAY).filter((n) => n >= 0);
  daysList.sort((a, b) => a - b);

  const avg = daysList.length ? daysList.reduce((s, n) => s + n, 0) / daysList.length : 0;
  const median = daysList.length
    ? daysList.length % 2 === 1
      ? daysList[Math.floor(daysList.length / 2)]
      : (daysList[daysList.length / 2 - 1] + daysList[daysList.length / 2]) / 2
    : 0;

  /* Rolling 90-day turnover */
  const cutoff = Date.now() - 90 * DAY;
  const recentSold = sold.filter((x) => x.soldAt >= cutoff);
  const turnoverRate = recentSold.length / 3; /* per month */

  const totalExposed = sold.length + listed.length;
  const sellThrough = totalExposed > 0 ? (sold.length / totalExposed) * 100 : 0;

  return {
    soldCount: sold.length,
    listedCount: listed.length,
    avgDaysToSell: round2(avg),
    medianDaysToSell: round2(median),
    turnoverRatePerMonth: round2(turnoverRate),
    sellThroughPct: round2(sellThrough)
  };
}

export async function getDeadStock({ minDays = 60 } = {}) {
  const inventory = await getInventory();
  const cutoff = Date.now() - minDays * DAY;
  return inventory
    .filter((x) => x.status === 'listed' && x.listedAt && x.listedAt <= cutoff)
    .map((x) => ({
      id: x.id,
      title: x.title || '(ohne Titel)',
      daysListed: Math.floor((Date.now() - x.listedAt) / DAY),
      listedAt: x.listedAt,
      targetPrice: x.targetPrice || x.price || '',
      purchasePrice: x.purchasePrice || ''
    }))
    .sort((a, b) => b.daysListed - a.daysListed);
}

/* ============================================================
   FORECAST
   ============================================================ */
export async function getForecast(months = 3) {
  const breakdown = await getMonthlyBreakdown(6);
  const completed = breakdown.slice(0, -1); /* drop current partial month */
  if (completed.length < 2) {
    return {
      ok: false,
      reason: 'Zu wenig Daten für verlässliche Prognose.',
      months: []
    };
  }
  const revenues = completed.map((b) => b.revenue);
  const avg = revenues.reduce((s, n) => s + n, 0) / revenues.length;
  const trend = revenues.length >= 2
    ? (revenues[revenues.length - 1] - revenues[0]) / (revenues.length - 1)
    : 0;

  const out = [];
  for (let i = 1; i <= months; i++) {
    const expected = Math.max(0, avg + trend * i);
    out.push({
      monthOffset: i,
      conservative: round2(expected * 0.75),
      expected: round2(expected),
      optimistic: round2(expected * 1.25)
    });
  }
  return { ok: true, months: out, basis: completed.length };
}

/* ============================================================
   BEST SELLERS
   ============================================================ */
export async function getBestSellers({ by = 'revenue', limit = 10 } = {}) {
  const entries = await getLedger({ type: 'sale' });
  const groups = {};

  for (const e of entries) {
    const key = e.itemId || e.snapshot?.title || 'unbekannt';
    if (!groups[key]) groups[key] = {
      key,
      title: e.snapshot?.title || '(ohne Titel)',
      brand: e.snapshot?.sourceBrand || '',
      url: e.snapshot?.originalUrl || '',
      count: 0,
      revenue: 0,
      profit: 0,
      firstSale: e.occurredAt,
      lastSale: e.occurredAt
    };
    const g = groups[key];
    g.count++;
    g.revenue += e.revenue;
    g.profit += e.netProfit;
    g.firstSale = Math.min(g.firstSale, e.occurredAt);
    g.lastSale = Math.max(g.lastSale, e.occurredAt);
  }

  const list = Object.values(groups);
  let sorted;
  if (by === 'revenue') sorted = list.sort((a, b) => b.revenue - a.revenue);
  else if (by === 'units') sorted = list.sort((a, b) => b.count - a.count);
  else if (by === 'profit') sorted = list.sort((a, b) => b.profit - a.profit);
  else if (by === 'fastest') sorted = list.sort((a, b) => (a.lastSale - a.firstSale) - (b.lastSale - b.firstSale));
  else sorted = list;

  return sorted.slice(0, limit).map((g) => ({
    ...g,
    revenue: round2(g.revenue),
    profit: round2(g.profit)
  }));
}

/* ============================================================
   TONE PERFORMANCE
   ============================================================ */
export async function getTonePerformance(days = 90) {
  const cutoff = Date.now() - days * DAY;
  const inventory = await getInventory();
  const tones = ['conservative', 'balanced', 'creative'];
  const stats = {};
  tones.forEach((t) => stats[t] = { tone: t, generated: 0, sold: 0, conversion: 0 });

  for (const item of inventory) {
    const tone = item.tone;
    if (!tone || !stats[tone]) continue;
    if ((item.createdAt || 0) < cutoff) continue;
    stats[tone].generated++;
    if (item.status === 'sold') stats[tone].sold++;
  }

  return Object.values(stats).map((s) => ({
    ...s,
    conversion: s.generated > 0 ? round2((s.sold / s.generated) * 100) : 0
  }));
}