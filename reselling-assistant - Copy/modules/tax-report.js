/* Garlo AI Selling — modules/tax-report.js (v9.0)
   Generates tax-ready reports from the ledger.

   TWO MODES:
     klein       — Kleinunternehmer §19 UStG
                   Income statement only. No VAT lines. No reverse charge.
     regel       — Regelbesteuert
                   Adds VAT collected and VAT input tax. Net VAT due.
                   User provides their own VAT rate (default 19 %).

   Public API:
     getAvailableYears()
     generateReport({ year, mode, vatRate })
     exportReportCsv(report)
     exportReportJson(report)
     renderReportHtml(report)  — printable HTML for browser print → PDF */

import { getLedger } from './ledger.js';

const VAT_DEFAULT = 19;

/* ============================================================
   YEARS
   ============================================================ */
export async function getAvailableYears() {
  const entries = await getLedger({});
  const years = new Set();
  for (const e of entries) {
    if (e.occurredAt) years.add(new Date(e.occurredAt).getFullYear());
  }
  const current = new Date().getFullYear();
  years.add(current);
  return Array.from(years).sort((a, b) => b - a);
}

/* ============================================================
   REPORT GENERATION
   ============================================================ */
export async function generateReport({ year, mode = 'klein', vatRate = VAT_DEFAULT } = {}) {
  const y = Number(year) || new Date().getFullYear();
  const from = new Date(y, 0, 1).getTime();
  const to = new Date(y, 11, 31, 23, 59, 59, 999).getTime();

  const entries = await getLedger({ from, to, includeReversals: false });

  const sales = entries.filter((e) => e.type === 'sale');
  const expenses = entries.filter((e) => e.type === 'expense');

  /* Aggregate sales */
  const totals = {
    grossRevenue: 0,
    netRevenue: 0,
    vatCollected: 0,
    costBasis: 0,
    fees: 0,
    extraExpenses: 0,
    netProfitKlein: 0,
    netProfitRegel: 0
  };

  const vatFactor = vatRate / (100 + vatRate);

  for (const e of sales) {
    const revenue = e.revenue || 0;
    const netPart = revenue * (1 - vatFactor);
    const vatPart = revenue - netPart;
    totals.grossRevenue += revenue;
    totals.netRevenue += netPart;
    totals.vatCollected += vatPart;
    totals.costBasis += e.costBasis || 0;
    totals.fees += e.fees || 0;
    totals.extraExpenses += e.expenses || 0;
  }

  let generalExpenses = 0;
  for (const e of expenses) generalExpenses += e.expenses || 0;

  /* Kleinunternehmer: revenue - all costs */
  totals.netProfitKlein = totals.grossRevenue - totals.costBasis - totals.fees - totals.extraExpenses - generalExpenses;

  /* Regelbesteuert: net revenue - all costs (VAT is neutral to profit) */
  totals.netProfitRegel = totals.netRevenue - totals.costBasis - totals.fees - totals.extraExpenses - generalExpenses;

  /* Line items — chronological, oldest first */
  const lineItems = [
    ...sales.map((e) => ({
      date: e.occurredAt,
      type: 'sale',
      description: `${e.snapshot?.title || 'Verkauf'}${e.platform ? ' (' + e.platform + ')' : ''}`,
      reference: e.id,
      revenue: round2(e.revenue),
      cost: round2(e.costBasis),
      fees: round2(e.fees),
      expenses: round2(e.expenses),
      profit: round2(e.netProfit)
    })),
    ...expenses.map((e) => ({
      date: e.occurredAt,
      type: 'expense',
      description: e.notes || 'Ausgabe',
      reference: e.id,
      revenue: 0,
      cost: 0,
      fees: 0,
      expenses: round2(e.expenses),
      profit: round2(-e.expenses)
    }))
  ].sort((a, b) => a.date - b.date);

  return {
    year: y,
    mode,
    vatRate: mode === 'regel' ? vatRate : null,
    generatedAt: Date.now(),
    period: { from, to },
    totals: {
      grossRevenue: round2(totals.grossRevenue),
      netRevenue: round2(totals.netRevenue),
      vatCollected: round2(totals.vatCollected),
      costBasis: round2(totals.costBasis),
      fees: round2(totals.fees),
      extraExpenses: round2(totals.extraExpenses),
      generalExpenses: round2(generalExpenses),
      netProfit: round2(mode === 'regel' ? totals.netProfitRegel : totals.netProfitKlein),
      saleCount: sales.length,
      expenseCount: expenses.length
    },
    lineItems
  };
}

function round2(n) { return Math.round((n || 0) * 100) / 100; }
function fmtEuro(n) {
  return (isFinite(n) ? n : 0).toFixed(2).replace('.', ',') + ' €';
}
function fmtDate(ts) {
  return new Date(ts).toLocaleDateString('de-DE');
}

/* ============================================================
   CSV EXPORT
   ============================================================ */
export function exportReportCsv(report) {
  const rows = [];
  const q = (v) => {
    const s = String(v == null ? '' : v).replace(/"/g, '""');
    return /[,"\n;]/.test(s) ? `"${s}"` : s;
  };

  /* Header block */
  rows.push(['Steuerbericht', String(report.year)].map(q).join(';'));
  rows.push(['Modus', report.mode === 'regel' ? 'Regelbesteuert' : 'Kleinunternehmer §19 UStG'].map(q).join(';'));
  if (report.vatRate) rows.push(['MwSt-Satz', report.vatRate + ' %'].map(q).join(';'));
  rows.push(['Erstellt', new Date(report.generatedAt).toLocaleString('de-DE')].map(q).join(';'));
  rows.push('');

  /* Summary */
  rows.push(['Zusammenfassung'].map(q).join(';'));
  const t = report.totals;
  rows.push(['Bruttoerlös', fmtEuro(t.grossRevenue)].map(q).join(';'));
  if (report.mode === 'regel') {
    rows.push(['Nettoerlös', fmtEuro(t.netRevenue)].map(q).join(';'));
    rows.push(['Enthaltene MwSt', fmtEuro(t.vatCollected)].map(q).join(';'));
  }
  rows.push(['Wareneinsatz', fmtEuro(t.costBasis)].map(q).join(';'));
  rows.push(['Plattformgebühren', fmtEuro(t.fees)].map(q).join(';'));
  rows.push(['Versand/Packaging', fmtEuro(t.extraExpenses)].map(q).join(';'));
  rows.push(['Sonstige Ausgaben', fmtEuro(t.generalExpenses)].map(q).join(';'));
  rows.push(['Netto-Gewinn', fmtEuro(t.netProfit)].map(q).join(';'));
  rows.push(['Verkäufe', String(t.saleCount)].map(q).join(';'));
  rows.push(['Ausgaben', String(t.expenseCount)].map(q).join(';'));
  rows.push('');

  /* Line items */
  rows.push(['Datum', 'Typ', 'Beschreibung', 'Referenz', 'Erlös', 'Wareneinsatz', 'Gebühren', 'Ausgaben', 'Gewinn'].map(q).join(';'));
  for (const it of report.lineItems) {
    rows.push([
      fmtDate(it.date),
      it.type === 'sale' ? 'Verkauf' : 'Ausgabe',
      it.description,
      it.reference,
      it.revenue ? it.revenue.toFixed(2).replace('.', ',') : '',
      it.cost ? it.cost.toFixed(2).replace('.', ',') : '',
      it.fees ? it.fees.toFixed(2).replace('.', ',') : '',
      it.expenses ? it.expenses.toFixed(2).replace('.', ',') : '',
      it.profit.toFixed(2).replace('.', ',')
    ].map(q).join(';'));
  }

  /* BOM + semicolon separator (Excel-DE friendly) */
  const blob = new Blob(['\uFEFF' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  return {
    filename: `garlo-steuerbericht-${report.year}-${report.mode}.csv`,
    blob
  };
}

export function exportReportJson(report) {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  return {
    filename: `garlo-steuerbericht-${report.year}-${report.mode}.json`,
    blob
  };
}

/* ============================================================
   PRINTABLE HTML
   Returns a complete HTML document string. Caller opens it in a
   new tab and triggers window.print().
   ============================================================ */
export function renderReportHtml(report) {
  const t = report.totals;
  const isRegel = report.mode === 'regel';

  const rowsHtml = report.lineItems.map((it) => `
    <tr>
      <td>${escapeHtml(fmtDate(it.date))}</td>
      <td>${it.type === 'sale' ? 'Verkauf' : 'Ausgabe'}</td>
      <td>${escapeHtml(it.description)}</td>
      <td>${it.revenue ? fmtEuro(it.revenue) : ''}</td>
      <td>${it.cost ? fmtEuro(it.cost) : ''}</td>
      <td>${it.fees ? fmtEuro(it.fees) : ''}</td>
      <td>${it.expenses ? fmtEuro(it.expenses) : ''}</td>
      <td>${fmtEuro(it.profit)}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<title>Garlo Steuerbericht ${report.year} — ${isRegel ? 'Regelbesteuert' : 'Kleinunternehmer §19 UStG'}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #111; max-width: 900px; margin: 30px auto; padding: 0 20px; line-height: 1.5; }
  h1 { font-size: 22px; margin: 0 0 4px; letter-spacing: -0.02em; }
  .sub { color: #666; font-size: 12px; margin-bottom: 24px; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 24px; padding: 14px 16px; background: #f6f7f9; border: 1px solid #e5e7eb; border-radius: 8px; margin-bottom: 24px; font-size: 13px; }
  .meta strong { color: #444; }
  h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.06em; color: #666; margin: 24px 0 10px; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  th, td { padding: 8px 10px; text-align: left; border-bottom: 1px solid #eee; }
  th { background: #f6f7f9; font-weight: 700; color: #444; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .totals { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-bottom: 24px; }
  .totals .row { display: flex; justify-content: space-between; padding: 8px 12px; background: #f6f7f9; border-radius: 6px; }
  .totals .row.profit { background: #ecfdf5; color: #047857; font-weight: 700; }
  .foot { margin-top: 30px; font-size: 11px; color: #888; text-align: center; }
  @media print { body { margin: 0; } .meta, th { background: #f6f7f9 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
  <h1>Steuerbericht ${report.year}</h1>
  <p class="sub">${isRegel ? 'Regelbesteuert' : 'Kleinunternehmer (§19 UStG)'}</p>

  <div class="meta">
    <div><strong>Zeitraum:</strong> ${fmtDate(report.period.from)} – ${fmtDate(report.period.to)}</div>
    <div><strong>Erstellt:</strong> ${new Date(report.generatedAt).toLocaleString('de-DE')}</div>
    ${isRegel ? `<div><strong>MwSt-Satz:</strong> ${report.vatRate} %</div>` : ''}
    <div><strong>Verkäufe:</strong> ${t.saleCount} · <strong>Ausgaben:</strong> ${t.expenseCount}</div>
  </div>

  <h2>Zusammenfassung</h2>
  <div class="totals">
    <div class="row"><span>Bruttoerlös</span><span>${fmtEuro(t.grossRevenue)}</span></div>
    ${isRegel ? `<div class="row"><span>Nettoerlös</span><span>${fmtEuro(t.netRevenue)}</span></div>` : ''}
    ${isRegel ? `<div class="row"><span>Enthaltene MwSt</span><span>${fmtEuro(t.vatCollected)}</span></div>` : ''}
    <div class="row"><span>Wareneinsatz</span><span>${fmtEuro(t.costBasis)}</span></div>
    <div class="row"><span>Plattformgebühren</span><span>${fmtEuro(t.fees)}</span></div>
    <div class="row"><span>Versand / Packaging</span><span>${fmtEuro(t.extraExpenses)}</span></div>
    <div class="row"><span>Sonstige Ausgaben</span><span>${fmtEuro(t.generalExpenses)}</span></div>
    <div class="row profit"><span>Netto-Gewinn</span><span>${fmtEuro(t.netProfit)}</span></div>
  </div>

  <h2>Einzelposten</h2>
  <table>
    <thead>
      <tr>
        <th>Datum</th>
        <th>Typ</th>
        <th>Beschreibung</th>
        <th class="num">Erlös</th>
        <th class="num">Wareneinsatz</th>
        <th class="num">Gebühren</th>
        <th class="num">Ausgaben</th>
        <th class="num">Gewinn</th>
      </tr>
    </thead>
    <tbody>${rowsHtml || '<tr><td colspan="8" style="text-align:center;color:#888;padding:20px">Keine Einträge für dieses Jahr.</td></tr>'}</tbody>
  </table>

  <p class="foot">Erstellt mit Garlo AI Selling · Keine Steuerberatung — zur Weitergabe an Steuerberater:in prüfen.</p>

  <script>window.onload = () => setTimeout(() => window.print(), 400);</script>
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}