/* Garlo AI Selling — modules/v9-ui.js (v9.0)
   Two-tab Analytics dashboard:
     • Übersicht  — KPIs, monthly chart, ROI breakdowns, top sellers,
                    dead stock, turnover, forecast
     • Berichte   — Tax report (Kleinunternehmer / Regelbesteuert),
                    ledger table with filters + pagination,
                    manual expense entry, backup/restore

   Renders everything dynamically into #analyticsRoot. If that element
   doesn't exist yet, creates one by taking over the Analytics tab.

   Public API:
     initV9UI(ctx)
     onAnalyticsTabActive()

   ctx = {
     esc,        // HTML escape helper
     toast,      // notification helper
     t,          // i18n
     getItems,   // () => current inventory array
     openDrawer  // (itemId) => void  — optional
   } */

import * as Ledger from './ledger.js';
import * as Analytics from './analytics-engine.js';
import * as TaxReport from './tax-report.js';
import * as Backup from './backup.js';

/* ============================================================
   STATE
   ============================================================ */
let ctx = null;
let rootEl = null;
let activeSubtab = 'overview';
let ledgerFilter = { type: 'all', platform: 'all', search: '' };
let ledgerPage = 0;
const LEDGER_PAGE_SIZE = 25;
let currentReport = null;
let reportYear = new Date().getFullYear();
let reportMode = 'klein';
let reportVat = 19;
let restoreInput = null;
let cachedOverview = null;

/* ============================================================
   INIT
   ============================================================ */
export async function initV9UI(context) {
  ctx = context;

  /* Hidden file input for restore */
  restoreInput = document.createElement('input');
  restoreInput.type = 'file';
  restoreInput.accept = 'application/json,.json';
  restoreInput.hidden = true;
  restoreInput.addEventListener('change', onRestoreFileSelected);
  document.body.appendChild(restoreInput);

  /* Delegated event listener at document level so re-renders don't lose handlers */
  document.addEventListener('click', onRootClick);
  document.addEventListener('change', onRootChange);
  document.addEventListener('input', onRootInput);
}

/* Called by dashboard.js whenever the Analytics tab becomes active */
export async function onAnalyticsTabActive() {
  const root = ensureRoot();
  if (!root) return;
  await refresh();
}

/* ============================================================
   ROOT MANAGEMENT
   ============================================================ */
function ensureRoot() {
  let r = document.getElementById('analyticsRoot');
  if (r) { rootEl = r; return r; }
  const panel = document.querySelector('[data-panel="analytics"]');
  if (!panel) return null;
  /* Take over: wipe old V8 analytics content */
  panel.innerHTML = '<div id="analyticsRoot"></div>';
  rootEl = document.getElementById('analyticsRoot');
  return rootEl;
}

/* ============================================================
   REFRESH — loads data then renders
   ============================================================ */
async function refresh() {
  try {
    const [statsToday, stats7, stats30, statsLifetime, monthly, turnover, roiPlatform, roiBrand, roiCategory, topRevenue, topUnits, deadStock, forecast, tonePerf, ledgerAll, years] =
      await Promise.all([
        Analytics.getRollingStats(1),
        Analytics.getRollingStats(7),
        Analytics.getRollingStats(30),
        Analytics.getRollingStats(36500),
        Analytics.getMonthlyBreakdown(12),
        Analytics.getTurnoverMetrics(),
        Analytics.getROIBy('platform', { minItems: 1 }),
        Analytics.getROIBy('brand', { minItems: 1 }),
        Analytics.getROIBy('category', { minItems: 1 }),
        Analytics.getBestSellers({ by: 'revenue', limit: 8 }),
        Analytics.getBestSellers({ by: 'units', limit: 8 }),
        Analytics.getDeadStock({ minDays: 60 }),
        Analytics.getForecast(3),
        Analytics.getTonePerformance(90),
        Ledger.getLedger({}),
        TaxReport.getAvailableYears()
      ]);

    cachedOverview = {
      statsToday, stats7, stats30, statsLifetime,
      monthly, turnover,
      roiPlatform, roiBrand, roiCategory,
      topRevenue, topUnits, deadStock, forecast, tonePerf,
      ledgerAll, years
    };
    render();
  } catch (e) {
    console.error('[V9UI] refresh failed', e);
    if (rootEl) {
      rootEl.innerHTML = `<div class="v9-empty">Fehler beim Laden der Analytics: ${ctx.esc(e.message)}</div>`;
    }
  }
}

/* ============================================================
   MAIN RENDER
   ============================================================ */
function render() {
  if (!rootEl || !cachedOverview) return;

  const o = cachedOverview;
  const tabsHtml = `
    <div class="v9-tabs" role="tablist">
      <button class="v9-tab ${activeSubtab === 'overview' ? 'active' : ''}" data-v9-tab="overview" type="button">Übersicht</button>
      <button class="v9-tab ${activeSubtab === 'reports' ? 'active' : ''}" data-v9-tab="reports" type="button">Berichte</button>
    </div>`;

  const bodyHtml = activeSubtab === 'overview'
    ? renderOverviewHtml(o)
    : renderReportsHtml(o);

  rootEl.innerHTML = tabsHtml + `<div class="v9-body">${bodyHtml}</div>`;
}

/* ============================================================
   OVERVIEW
   ============================================================ */
function renderOverviewHtml(o) {
  return `
    <div class="v9-section">
      ${renderKpiGrid(o)}
    </div>

    <div class="v9-section v9-panel">
      <h3 class="v9-panel-title">Umsatz &amp; Gewinn (12 Monate)</h3>
      ${renderMonthlyChart(o.monthly)}
    </div>

    <div class="v9-grid-2">
      <div class="v9-panel">
        <h3 class="v9-panel-title">ROI nach Kategorie</h3>
        ${renderRoiTable(o.roiCategory, 'category')}
      </div>
      <div class="v9-panel">
        <h3 class="v9-panel-title">ROI nach Plattform</h3>
        ${renderRoiTable(o.roiPlatform, 'platform')}
      </div>
    </div>

    <div class="v9-grid-2">
      <div class="v9-panel">
        <h3 class="v9-panel-title">Top-Verkäufe</h3>
        ${renderTopSellers(o.topRevenue, 'revenue')}
      </div>
      <div class="v9-panel">
        <h3 class="v9-panel-title">Ladenhüter (&gt;60 Tage)</h3>
        ${renderDeadStock(o.deadStock)}
      </div>
    </div>

    <div class="v9-grid-2">
      <div class="v9-panel">
        <h3 class="v9-panel-title">Umschlag</h3>
        ${renderTurnover(o.turnover)}
      </div>
      <div class="v9-panel">
        <h3 class="v9-panel-title">Umsatz-Prognose</h3>
        ${renderForecast(o.forecast)}
      </div>
    </div>

    ${o.roiBrand && o.roiBrand.length ? `
    <div class="v9-section v9-panel">
      <h3 class="v9-panel-title">ROI nach Marke</h3>
      ${renderRoiTable(o.roiBrand, 'brand')}
    </div>` : ''}

    ${renderTonePerf(o.tonePerf)}
  `;
}

/* ---------- KPI grid ---------- */
function renderKpiGrid(o) {
  const items = [
    { label: 'Heute', s: o.statsToday },
    { label: '7 Tage', s: o.stats7 },
    { label: '30 Tage', s: o.stats30 },
    { label: 'Gesamt', s: o.statsLifetime }
  ];
  return `
    <div class="v9-kpi-grid">
      ${items.map((k) => `
        <div class="v9-kpi">
          <div class="v9-kpi-label">${ctx.esc(k.label)}</div>
          <div class="v9-kpi-revenue">${fmtEuro(k.s.revenue)}</div>
          <div class="v9-kpi-profit ${k.s.netProfit >= 0 ? 'positive' : 'negative'}">
            ${k.s.netProfit >= 0 ? '+' : ''}${fmtEuro(k.s.netProfit)}
          </div>
          <div class="v9-kpi-count">${k.s.saleCount} Verkäufe</div>
        </div>`).join('')}
    </div>`;
}

/* ---------- Monthly chart ---------- */
function renderMonthlyChart(months) {
  const maxRevenue = Math.max(1, ...months.map((m) => m.revenue));
  const hasData = months.some((m) => m.revenue > 0);

  if (!hasData) {
    return `<div class="v9-empty">Noch keine Verkäufe erfasst. Der Chart füllt sich, sobald du Artikel als „sold“ markierst.</div>`;
  }

  const barsHtml = months.map((m) => {
    const heightPct = Math.max(2, (m.revenue / maxRevenue) * 100);
    const profitHeightPct = m.revenue > 0 ? Math.max(0, (Math.max(0, m.profit) / maxRevenue) * 100) : 0;
    const title = `${m.label}: ${fmtEuro(m.revenue)} Umsatz · ${fmtEuro(m.profit)} Gewinn · ${m.volume} Verkäufe`;
    return `
      <div class="v9-chart-col" title="${ctx.esc(title)}">
        <div class="v9-chart-bar-wrap">
          <div class="v9-chart-bar-fill" style="height:${heightPct}%"></div>
          ${profitHeightPct > 0 ? `<div class="v9-chart-bar-profit" style="height:${profitHeightPct}%"></div>` : ''}
        </div>
        <div class="v9-chart-bar-label">${ctx.esc(m.label)}</div>
      </div>`;
  }).join('');

  return `
    <div class="v9-chart-wrap">
      <div class="v9-chart-legend">
        <span><span class="v9-legend-dot revenue"></span>Umsatz</span>
        <span><span class="v9-legend-dot profit"></span>Gewinn</span>
      </div>
      <div class="v9-chart-bars">${barsHtml}</div>
    </div>`;
}

/* ---------- ROI table ---------- */
function renderRoiTable(rows, field) {
  if (!rows || !rows.length) {
    return `<div class="v9-empty">Keine Daten mit ≥ 3 Verkäufen pro Gruppe.</div>`;
  }
  return `
    <table class="v9-table">
      <thead>
        <tr>
          <th>${ctx.esc(labelForField(field))}</th>
          <th class="num">Anz.</th>
          <th class="num">Umsatz</th>
          <th class="num">Gewinn</th>
          <th class="num">ROI</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((r) => `
          <tr>
            <td>${ctx.esc(r.key)}</td>
            <td class="num">${r.count}</td>
            <td class="num">${fmtEuro(r.revenue)}</td>
            <td class="num">${fmtEuro(r.profit)}</td>
            <td class="num ${r.roi >= 0 ? 'positive' : 'negative'}">${r.roi}%</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

function labelForField(field) {
  return { category: 'Kategorie', platform: 'Plattform', brand: 'Marke', condition: 'Zustand' }[field] || field;
}

/* ---------- Top sellers ---------- */
function renderTopSellers(rows, by) {
  if (!rows || !rows.length) {
    return `<div class="v9-empty">Noch keine Verkäufe.</div>`;
  }
  return `
    <table class="v9-table">
      <thead>
        <tr>
          <th>Titel</th>
          <th class="num">${by === 'units' ? 'Stück' : 'Umsatz'}</th>
          <th class="num">Gewinn</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((r) => `
          <tr class="v9-row-clickable" data-v9-open-item="${ctx.esc(r.key)}">
            <td title="${ctx.esc(r.title)}">${ctx.esc(truncate(r.title, 44))}</td>
            <td class="num">${by === 'units' ? r.count : fmtEuro(r.revenue)}</td>
            <td class="num positive">${fmtEuro(r.profit)}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

/* ---------- Dead stock ---------- */
function renderDeadStock(rows) {
  if (!rows || !rows.length) {
    return `<div class="v9-empty">Kein Ladenhüter. 👍</div>`;
  }
  return `
    <table class="v9-table">
      <thead>
        <tr>
          <th>Titel</th>
          <th class="num">Tage gelistet</th>
          <th class="num">VK</th>
        </tr>
      </thead>
      <tbody>
        ${rows.slice(0, 10).map((r) => `
          <tr class="v9-row-clickable" data-v9-open-item="${ctx.esc(r.id)}">
            <td title="${ctx.esc(r.title)}">${ctx.esc(truncate(r.title, 40))}</td>
            <td class="num warn">${r.daysListed}</td>
            <td class="num">${r.targetPrice ? ctx.esc(r.targetPrice) + ' €' : '—'}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

/* ---------- Turnover ---------- */
function renderTurnover(t) {
  const rows = [
    ['Verkaufte Artikel', t.soldCount],
    ['Aktuell gelistet', t.listedCount],
    ['Ø Tage bis Verkauf', t.avgDaysToSell],
    ['Median Tage bis Verkauf', t.medianDaysToSell],
    ['Umschlag / Monat', t.turnoverRatePerMonth],
    ['Sell-Through', t.sellThroughPct + ' %']
  ];
  return `
    <div class="v9-stat-list">
      ${rows.map(([k, v]) => `
        <div class="v9-stat-row">
          <span>${ctx.esc(k)}</span>
          <strong>${ctx.esc(String(v))}</strong>
        </div>`).join('')}
    </div>`;
}

/* ---------- Forecast ---------- */
function renderForecast(f) {
  if (!f || !f.ok) {
    return `<div class="v9-empty">${ctx.esc(f?.reason || 'Zu wenig Daten.')}</div>`;
  }
  return `
    <table class="v9-table">
      <thead>
        <tr>
          <th>Monat</th>
          <th class="num">Konservativ</th>
          <th class="num">Erwartet</th>
          <th class="num">Optimistisch</th>
        </tr>
      </thead>
      <tbody>
        ${f.months.map((m) => `
          <tr>
            <td>+${m.monthOffset}</td>
            <td class="num">${fmtEuro(m.conservative)}</td>
            <td class="num strong">${fmtEuro(m.expected)}</td>
            <td class="num">${fmtEuro(m.optimistic)}</td>
          </tr>`).join('')}
      </tbody>
    </table>
    <p class="v9-hint">Basierend auf den letzten ${f.basis} abgeschlossenen Monaten.</p>`;
}

/* ---------- Tone performance ---------- */
function renderTonePerf(rows) {
  if (!rows || !rows.length) return '';
  const has = rows.some((r) => r.generated > 0);
  if (!has) return '';
  return `
    <div class="v9-section v9-panel">
      <h3 class="v9-panel-title">Tone-Performance (90 Tage)</h3>
      <table class="v9-table">
        <thead><tr><th>Tone</th><th class="num">Generiert</th><th class="num">Verkauft</th><th class="num">Conversion</th></tr></thead>
        <tbody>
          ${rows.map((r) => `
            <tr>
              <td>${ctx.esc(r.tone)}</td>
              <td class="num">${r.generated}</td>
              <td class="num">${r.sold}</td>
              <td class="num">${r.conversion}%</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

/* ============================================================
   REPORTS
   ============================================================ */
function renderReportsHtml(o) {
  return `
    <div class="v9-section v9-panel">
      <h3 class="v9-panel-title">Steuerbericht</h3>
      <div class="v9-input-row">
        <label class="v9-field">
          <span class="v9-field-label">Jahr</span>
          <select id="v9ReportYear">
            ${(o.years || [new Date().getFullYear()]).map((y) => `
              <option value="${y}" ${y === reportYear ? 'selected' : ''}>${y}</option>`).join('')}
          </select>
        </label>
        <label class="v9-field">
          <span class="v9-field-label">Modus</span>
          <select id="v9ReportMode">
            <option value="klein" ${reportMode === 'klein' ? 'selected' : ''}>Kleinunternehmer §19 UStG</option>
            <option value="regel" ${reportMode === 'regel' ? 'selected' : ''}>Regelbesteuert (mit MwSt)</option>
          </select>
        </label>
        ${reportMode === 'regel' ? `
        <label class="v9-field">
          <span class="v9-field-label">MwSt-Satz</span>
          <input id="v9ReportVat" type="number" min="1" max="30" value="${reportVat}" />
        </label>` : ''}
        <button class="btn-side primary" id="v9ReportGenerate" type="button">Bericht erzeugen</button>
      </div>
      <div id="v9ReportPreview">${currentReport ? renderReportPreview(currentReport) : ''}</div>
    </div>

    <div class="v9-section v9-panel">
      <h3 class="v9-panel-title">Kassenbuch (Ledger)</h3>
      <div class="v9-input-row">
        <label class="v9-field">
          <span class="v9-field-label">Typ</span>
          <select id="v9LedgerType">
            <option value="all" ${ledgerFilter.type === 'all' ? 'selected' : ''}>Alle</option>
            <option value="sale" ${ledgerFilter.type === 'sale' ? 'selected' : ''}>Verkäufe</option>
            <option value="expense" ${ledgerFilter.type === 'expense' ? 'selected' : ''}>Ausgaben</option>
          </select>
        </label>
        <label class="v9-field">
          <span class="v9-field-label">Plattform</span>
          <select id="v9LedgerPlatform">
            <option value="all" ${ledgerFilter.platform === 'all' ? 'selected' : ''}>Alle</option>
            <option value="kleinanzeigen" ${ledgerFilter.platform === 'kleinanzeigen' ? 'selected' : ''}>Kleinanzeigen</option>
            <option value="ebay" ${ledgerFilter.platform === 'ebay' ? 'selected' : ''}>eBay</option>
            <option value="vinted" ${ledgerFilter.platform === 'vinted' ? 'selected' : ''}>Vinted</option>
          </select>
        </label>
        <label class="v9-field v9-field-grow">
          <span class="v9-field-label">Suche</span>
          <input id="v9LedgerSearch" type="search" placeholder="Titel, Käufer, Notiz…" value="${ctx.esc(ledgerFilter.search)}" />
        </label>
      </div>
      <div id="v9LedgerTableWrap">${renderLedgerTableHtml(o.ledgerAll)}</div>
    </div>

    <div class="v9-section v9-panel">
      <h3 class="v9-panel-title">Ausgabe manuell erfassen</h3>
      <div class="v9-input-row">
        <label class="v9-field">
          <span class="v9-field-label">Betrag (€)</span>
          <input id="v9ExpenseAmount" type="text" inputmode="decimal" placeholder="z. B. 12,50" />
        </label>
        <label class="v9-field">
          <span class="v9-field-label">Kategorie</span>
          <select id="v9ExpenseCategory">
            <option value="Versand">Versand</option>
            <option value="Verpackung">Verpackung</option>
            <option value="Wareneinkauf">Wareneinkauf</option>
            <option value="Kleinteile">Kleinteile</option>
            <option value="Sonstiges">Sonstiges</option>
          </select>
        </label>
        <label class="v9-field v9-field-grow">
          <span class="v9-field-label">Notiz (optional)</span>
          <input id="v9ExpenseNotes" type="text" placeholder="z. B. DHL Paket 2 kg" />
        </label>
        <button class="btn-side primary" id="v9ExpenseSave" type="button">Speichern</button>
      </div>
    </div>

    <div class="v9-section v9-panel">
      <h3 class="v9-panel-title">Backup &amp; Restore</h3>
      <div class="v9-btn-row">
        <button class="btn-side primary" id="v9BackupFull" type="button">💾 Vollständiges Backup</button>
        <button class="btn-side" id="v9BackupLedger" type="button">📒 Nur Ledger</button>
        <button class="btn-side" id="v9BackupAnalytics" type="button">📊 Analytics-Snapshot</button>
        <button class="btn-side" id="v9BackupRestore" type="button">📥 Restore aus JSON</button>
      </div>
      <p class="v9-hint">Das vollständige Backup enthält Inventar, Ledger, Einstellungen, Bilder-Cache und alle Profile. Restore fügt nur neue Einträge hinzu — bestehende werden nicht überschrieben.</p>
    </div>
  `;
}

/* ---------- Tax report preview ---------- */
function renderReportPreview(report) {
  const t = report.totals;
  const isRegel = report.mode === 'regel';
  return `
    <div class="v9-report-preview">
      <div class="v9-report-head">
        <div>
          <div class="v9-report-title">Steuerbericht ${report.year}</div>
          <div class="v9-report-sub">${isRegel ? 'Regelbesteuert · ' + report.vatRate + ' %' : 'Kleinunternehmer §19 UStG'}</div>
        </div>
        <div class="v9-report-actions">
          <button class="btn-side" data-v9-report-export="csv" type="button">📄 CSV</button>
          <button class="btn-side" data-v9-report-export="json" type="button">🗂 JSON</button>
          <button class="btn-side primary" data-v9-report-export="print" type="button">🖨 Drucken / PDF</button>
        </div>
      </div>

      <div class="v9-report-grid">
        <div class="v9-report-row"><span>Bruttoerlös</span><strong>${fmtEuro(t.grossRevenue)}</strong></div>
        ${isRegel ? `<div class="v9-report-row"><span>Nettoerlös</span><strong>${fmtEuro(t.netRevenue)}</strong></div>` : ''}
        ${isRegel ? `<div class="v9-report-row"><span>Enthaltene MwSt</span><strong>${fmtEuro(t.vatCollected)}</strong></div>` : ''}
        <div class="v9-report-row"><span>Wareneinsatz</span><strong>${fmtEuro(t.costBasis)}</strong></div>
        <div class="v9-report-row"><span>Plattformgebühren</span><strong>${fmtEuro(t.fees)}</strong></div>
        <div class="v9-report-row"><span>Versand/Packaging</span><strong>${fmtEuro(t.extraExpenses)}</strong></div>
        <div class="v9-report-row"><span>Sonstige Ausgaben</span><strong>${fmtEuro(t.generalExpenses)}</strong></div>
        <div class="v9-report-row profit"><span>Netto-Gewinn</span><strong>${fmtEuro(t.netProfit)}</strong></div>
      </div>

      <div class="v9-report-items">
        <table class="v9-table">
          <thead>
            <tr>
              <th>Datum</th>
              <th>Typ</th>
              <th>Beschreibung</th>
              <th class="num">Erlös</th>
              <th class="num">Gewinn</th>
            </tr>
          </thead>
          <tbody>
            ${report.lineItems.slice(0, 20).map((it) => `
              <tr>
                <td>${fmtDate(it.date)}</td>
                <td>${it.type === 'sale' ? 'Verkauf' : 'Ausgabe'}</td>
                <td>${ctx.esc(truncate(it.description, 60))}</td>
                <td class="num">${it.revenue ? fmtEuro(it.revenue) : '—'}</td>
                <td class="num ${it.profit >= 0 ? 'positive' : 'negative'}">${fmtEuro(it.profit)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
        ${report.lineItems.length > 20
          ? `<p class="v9-hint">… und ${report.lineItems.length - 20} weitere. Vollständig im CSV / Druck enthalten.</p>`
          : ''}
      </div>
    </div>`;
}

/* ---------- Ledger table ---------- */
function renderLedgerTableHtml(entries) {
  const filtered = applyLedgerFilters(entries || []);
  const totalPages = Math.max(1, Math.ceil(filtered.length / LEDGER_PAGE_SIZE));
  if (ledgerPage >= totalPages) ledgerPage = totalPages - 1;
  const start = ledgerPage * LEDGER_PAGE_SIZE;
  const pageRows = filtered.slice(start, start + LEDGER_PAGE_SIZE);

  if (!filtered.length) {
    return `<div class="v9-empty">Keine Einträge passen zum Filter.</div>`;
  }

  return `
    <table class="v9-table v9-ledger-table">
      <thead>
        <tr>
          <th>Datum</th>
          <th>Typ</th>
          <th>Beschreibung</th>
          <th class="num">Erlös</th>
          <th class="num">Wareneinsatz</th>
          <th class="num">Gebühren</th>
          <th class="num">Gewinn</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${pageRows.map((e) => `
          <tr>
            <td>${fmtDate(e.occurredAt)}</td>
            <td>${e.type === 'sale' ? '<span class="v9-pill sale">Verkauf</span>'
              : e.type === 'expense' ? '<span class="v9-pill expense">Ausgabe</span>'
              : '<span class="v9-pill reversal">Storno</span>'}</td>
            <td title="${ctx.esc(e.notes || e.snapshot?.title || '')}">${ctx.esc(truncate(e.notes || e.snapshot?.title || '—', 56))}</td>
            <td class="num">${e.revenue ? fmtEuro(e.revenue) : '—'}</td>
            <td class="num">${e.costBasis ? fmtEuro(e.costBasis) : '—'}</td>
            <td class="num">${e.fees ? fmtEuro(e.fees) : '—'}</td>
            <td class="num ${e.netProfit >= 0 ? 'positive' : 'negative'}">${fmtEuro(e.netProfit)}</td>
            <td>
              ${e.type !== 'reversal' ? `<button class="v9-row-action danger" data-v9-reverse="${ctx.esc(e.id)}" title="Stornieren">↺</button>` : ''}
            </td>
          </tr>`).join('')}
      </tbody>
    </table>
    ${totalPages > 1 ? `
      <div class="v9-pagination">
        <button class="btn-mini" data-v9-page="prev" ${ledgerPage === 0 ? 'disabled' : ''}>‹</button>
        <span>Seite ${ledgerPage + 1} / ${totalPages}</span>
        <button class="btn-mini" data-v9-page="next" ${ledgerPage >= totalPages - 1 ? 'disabled' : ''}>›</button>
      </div>` : ''}`;
}

function applyLedgerFilters(entries) {
  return entries.filter((e) => {
    if (ledgerFilter.type !== 'all' && e.type !== ledgerFilter.type) return false;
    if (ledgerFilter.platform !== 'all' && e.platform !== ledgerFilter.platform) return false;
    if (ledgerFilter.search) {
      const q = ledgerFilter.search.toLowerCase();
      const hay = [e.notes, e.buyer, e.snapshot?.title, e.snapshot?.sourceBrand].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/* ============================================================
   EVENT DELEGATION
   ============================================================ */
function onRootClick(ev) {
  const t = ev.target;

  /* Sub-tab switching */
  const tabBtn = t.closest('[data-v9-tab]');
  if (tabBtn) {
    activeSubtab = tabBtn.dataset.v9Tab;
    render();
    return;
  }

  /* Open item drawer */
  const openBtn = t.closest('[data-v9-open-item]');
  if (openBtn) {
    const id = openBtn.dataset.v9OpenItem;
    if (id && ctx.openDrawer) ctx.openDrawer(id);
    return;
  }

  /* Pagination */
  const pageBtn = t.closest('[data-v9-page]');
  if (pageBtn && cachedOverview) {
    const dir = pageBtn.dataset.v9Page;
    const filtered = applyLedgerFilters(cachedOverview.ledgerAll || []);
    const totalPages = Math.max(1, Math.ceil(filtered.length / LEDGER_PAGE_SIZE));
    if (dir === 'prev') ledgerPage = Math.max(0, ledgerPage - 1);
    if (dir === 'next') ledgerPage = Math.min(totalPages - 1, ledgerPage + 1);
    document.getElementById('v9LedgerTableWrap').innerHTML = renderLedgerTableHtml(cachedOverview.ledgerAll);
    return;
  }

  /* Reverse ledger entry */
  const revBtn = t.closest('[data-v9-reverse]');
  if (revBtn) {
    const id = revBtn.dataset.v9Reverse;
    const reason = prompt('Storno-Grund (optional):') ?? null;
    if (reason === null) return; /* cancelled */
    Ledger.reverseEntry(id, reason).then(async (r) => {
      if (!r.ok) { ctx.toast(r.error || 'Storno fehlgeschlagen.', 'error'); return; }
      ctx.toast('Eintrag storniert.', 'success');
      await refresh();
    });
    return;
  }

  /* Report actions */
  const rptExport = t.closest('[data-v9-report-export]');
  if (rptExport && currentReport) {
    const mode = rptExport.dataset.v9ReportExport;
    handleReportExport(mode);
    return;
  }

  /* Generate report */
  if (t.id === 'v9ReportGenerate') {
    generateReport();
    return;
  }

  /* Expense save */
  if (t.id === 'v9ExpenseSave') {
    saveExpense();
    return;
  }

  /* Backup / restore */
  if (t.id === 'v9BackupFull') { downloadBackup('full'); return; }
  if (t.id === 'v9BackupLedger') { downloadBackup('ledger'); return; }
  if (t.id === 'v9BackupAnalytics') { downloadBackup('analytics'); return; }
  if (t.id === 'v9BackupRestore') {
    if (restoreInput) restoreInput.click();
    return;
  }
}

function onRootChange(ev) {
  const t = ev.target;
  if (t.id === 'v9ReportYear') {
    reportYear = Number(t.value);
  } else if (t.id === 'v9ReportMode') {
    reportMode = t.value;
    /* Re-render only the reports tab (mode toggle changes VAT input visibility) */
    if (rootEl && cachedOverview && activeSubtab === 'reports') {
      rootEl.querySelector('.v9-body').innerHTML = renderReportsHtml(cachedOverview);
    }
  } else if (t.id === 'v9ReportVat') {
    reportVat = Number(t.value) || 19;
  } else if (t.id === 'v9LedgerType') {
    ledgerFilter.type = t.value;
    ledgerPage = 0;
    if (cachedOverview) {
      document.getElementById('v9LedgerTableWrap').innerHTML = renderLedgerTableHtml(cachedOverview.ledgerAll);
    }
  } else if (t.id === 'v9LedgerPlatform') {
    ledgerFilter.platform = t.value;
    ledgerPage = 0;
    if (cachedOverview) {
      document.getElementById('v9LedgerTableWrap').innerHTML = renderLedgerTableHtml(cachedOverview.ledgerAll);
    }
  }
}

let searchDebounce = null;
function onRootInput(ev) {
  const t = ev.target;
  if (t.id === 'v9LedgerSearch') {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      ledgerFilter.search = t.value.trim();
      ledgerPage = 0;
      if (cachedOverview) {
        document.getElementById('v9LedgerTableWrap').innerHTML = renderLedgerTableHtml(cachedOverview.ledgerAll);
      }
    }, 200);
  }
}

/* ============================================================
   ACTIONS
   ============================================================ */
async function generateReport() {
  const btn = document.getElementById('v9ReportGenerate');
  if (btn) { btn.disabled = true; btn.textContent = 'Erzeuge…'; }
  try {
    currentReport = await TaxReport.generateReport({
      year: reportYear,
      mode: reportMode,
      vatRate: reportVat
    });
    const preview = document.getElementById('v9ReportPreview');
    if (preview) preview.innerHTML = renderReportPreview(currentReport);
  } catch (e) {
    ctx.toast('Bericht fehlgeschlagen: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Bericht erzeugen'; }
  }
}

function handleReportExport(mode) {
  if (!currentReport) return;
  try {
    if (mode === 'csv') {
      const { filename, blob } = TaxReport.exportReportCsv(currentReport);
      downloadBlob(blob, filename);
    } else if (mode === 'json') {
      const { filename, blob } = TaxReport.exportReportJson(currentReport);
      downloadBlob(blob, filename);
    } else if (mode === 'print') {
      const html = TaxReport.renderReportHtml(currentReport);
      const w = window.open('', '_blank');
      if (!w) { ctx.toast('Popup blockiert — bitte Popups erlauben.', 'warn'); return; }
      w.document.write(html);
      w.document.close();
    }
  } catch (e) {
    ctx.toast('Export fehlgeschlagen: ' + e.message, 'error');
  }
}

async function saveExpense() {
  const amount = document.getElementById('v9ExpenseAmount')?.value || '';
  const category = document.getElementById('v9ExpenseCategory')?.value || 'Sonstiges';
  const notes = document.getElementById('v9ExpenseNotes')?.value || '';

  const r = await Ledger.recordExpense({ amount, category, notes });
  if (!r.ok) { ctx.toast(r.error || 'Speichern fehlgeschlagen.', 'error'); return; }
  ctx.toast('Ausgabe gespeichert.', 'success');
  document.getElementById('v9ExpenseAmount').value = '';
  document.getElementById('v9ExpenseNotes').value = '';
  await refresh();
}

async function downloadBackup(kind) {
  try {
    let result;
    if (kind === 'full') result = await Backup.createFullBackup();
    else if (kind === 'ledger') result = await Backup.createLedgerBackup();
    else result = await Backup.createAnalyticsSnapshot();
    downloadBlob(result.blob, result.filename);
    ctx.toast('Backup heruntergeladen: ' + result.filename, 'success', 5000);
  } catch (e) {
    ctx.toast('Backup fehlgeschlagen: ' + e.message, 'error');
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function onRestoreFileSelected(ev) {
  const file = ev.target.files?.[0];
  ev.target.value = '';
  if (!file) return;

  const text = await file.text();
  /* Ask merge vs replace */
  const replace = confirm(
    'Restore aus: ' + file.name + '\n\n' +
    'OK = REPLACE — bestehende Einträge werden GELÖSCHT und nur Backup-Daten übernommen.\n' +
    'Abbrechen = MERGE — nur neue Einträge werden hinzugefügt (empfohlen).'
  );

  const r = await Backup.restoreFromBackup(text, { mode: replace ? 'replace' : 'merge' });
  if (!r.ok) { ctx.toast('Restore fehlgeschlagen: ' + r.error, 'error', 7000); return; }

  const added = Object.entries(r.summary.added || {})
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k}: +${n}`)
    .join(' · ');
  ctx.toast(`Restore OK (${r.summary.mode}) ${added}`, 'success', 8000);
  await refresh();
}

/* ============================================================
   FORMATTERS
   ============================================================ */
function fmtEuro(n) {
  const v = Number(n) || 0;
  return v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('de-DE');
}
function truncate(s, max) {
  s = String(s || '');
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}