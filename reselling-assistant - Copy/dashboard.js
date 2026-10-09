'use strict';

/* ============================================================
   Garlo AI Selling — dashboard.js (v9.0)
   V9 wiring complete. All V8 features preserved.
   Ledger auto-records on status change (background-side).
   ============================================================ */

import { initI18n, t, setLanguage, applyI18n } from './modules/i18n.js';
import { checkConsent, runWithConsent } from './modules/consent.js';
import { guard } from './modules/guard.js';
import * as EbayApi from './modules/ebay-api.js';
import * as Store from './modules/inventory-store.js';
import * as V7 from './modules/v7-ui.js';
import * as V8UI from './modules/v8-ui.js';
import * as V9UI from './modules/v9-ui.js';
import { PLATFORMS, featureFor } from './modules/platforms.js';
import { injectContent, fetchImages } from './modules/tab-utils.js';
import { updateProfitUI } from './modules/pricing.js';
import { initScanner, startScanning, stopScanning } from './modules/scanner.js';
import * as PromptEditor from './modules/prompt-editor.js';
import * as ListingLang from './modules/listing-language.js';
import * as ToneTracker from './modules/tone-tracking.js';
import * as AltText from './modules/alt-text.js';
import * as AutoTranslate from './modules/auto-translate.js';
import * as Messenger from './modules/messenger.js';

const $ = (id) => document.getElementById(id);

const els = {
  navBtns: document.querySelectorAll('.nav-btn'),
  tabPanels: document.querySelectorAll('.tab-panel'),
  viewTitle: $('viewTitle'), viewSub: $('viewSub'),
  globalSearch: $('globalSearch'),
  inboxBadge: $('inboxBadge'),
  kpiItems: $('kpiItems'), kpiInvested: $('kpiInvested'),
  kpiRevenue: $('kpiRevenue'), kpiProfit: $('kpiProfit'),
  modelHealth: $('modelHealth'), quotaPill: $('quotaPill'),
  productUrl: $('productUrl'), captureBtn: $('captureBtn'),
  capturedBox: $('capturedBox'), capturedTitle: $('capturedTitle'),
  capturedMeta: $('capturedMeta'), capturedLink: $('capturedLink'),
  purchasePrice: $('purchasePrice'), targetPrice: $('targetPrice'), compBar: $('compBar'),
  shippingTier: $('shippingTier'),
  legalSach: $('legalSach'), legalRück: $('legalRück'), legalTausch: $('legalTausch'),
  imageGrid: $('imageGrid'), imageBadge: $('imageBadge'), cleanImagesBtn: $('cleanImagesBtn'),
  generateAltTextBtn: $('generateAltTextBtn'),
  generateBtn: $('generateBtn'),
  publishKleinBtn: $('publishKleinBtn'), publishEbayBtn: $('publishEbayBtn'),
  saveToInventory: $('saveToInventory'),
  statusCard: $('statusCard'), statusIcon: $('statusIcon'), statusText: $('statusText'),
  diagnostics: $('diagnostics'),
  previewCard: $('previewCard'),
  titleOut: $('titleOut'), priceOut: $('priceOut'), descOut: $('descOut'),
  titleCount: $('titleCount'),
  copyTitleBtn: $('copyTitleBtn'), copyDescBtn: $('copyDescBtn'), copyAllBtn: $('copyAllBtn'),
  listingLangSelect: $('listingLangSelect'),
  promptPresetSelect: $('promptPresetSelect'), promptTextarea: $('promptTextarea'),
  promptSaveBtn: $('promptSaveBtn'), promptDeleteBtn: $('promptDeleteBtn'),
  startScanBtn: $('startScanBtn'), stopScanBtn: $('stopScanBtn'),
  scannerVideo: $('scannerVideo'), scannerOverlay: $('scannerOverlay'),
  scanResult: $('scanResult'), eanValue: $('eanValue'), lookupEanBtn: $('lookupEanBtn'),
  calcEk: $('calcEk'), calcVk: $('calcVk'), calcPlatform: $('calcPlatform'),
  bulkAsins: $('bulkAsins'), bulkImportBtn: $('bulkImportBtn'),
  acctGoogleStatus: $('acctGoogleStatus'), acctGoogleMeta: $('acctGoogleMeta'), acctGoogleBtn: $('acctGoogleBtn'),
  acctEbayStatus: $('acctEbayStatus'), acctEbayMeta: $('acctEbayMeta'), acctEbayBtn: $('acctEbayBtn'),
  acctKaStatus: $('acctKaStatus'), acctKaMeta: $('acctKaMeta'), acctKaBtn: $('acctKaBtn'),
  refreshAccountsBtn: $('refreshAccountsBtn'),
  invTableBody: $('invTableBody'),
  cfgLanguage: $('cfgLanguage'), cfgTaxStatus: $('cfgTaxStatus'),
  cfgApiKey: $('cfgApiKey'), cfgModel: $('cfgModel'), cfgSave: $('cfgSave'),
  refreshModels: $('refreshModels'), modelHint: $('modelHint'),
  quotaPct: $('quotaPct'), quotaFill: $('quotaFill'),
  quotaDetail: $('quotaDetail'), cleanupStorageBtn: $('cleanupStorageBtn'),
  pollerEnabled: $('pollerEnabled'), pollerHint: $('pollerHint'), pollerRunNow: $('pollerRunNow'),
  killSwitch: $('killSwitch'), clearAllBtn: $('clearAllBtn'),
  exportCsvBtn: $('exportCsvBtn'), importCsvBtn: $('importCsvBtn'),
  csvFileInput: $('csvFileInput'), themeToggle: $('themeToggle'),
  sidebarCollapse: $('sidebarCollapse'), killSwitchIndicator: $('killSwitchIndicator'),
  drawer: $('drawer'), closeDrawer: $('closeDrawer'),
  drawerTitle: $('drawerTitle'), drawerBody: $('drawerBody'),
  toastContainer: $('toastContainer'),
  legalWarning: $('legalWarning')
};

let inventory = [];
let searchTerm = '';
let activeTab = 'generator';
let scraped = null;
let variants = { balanced: null };
let activeTone = 'balanced';
let imageCache = [];
let isKleinunternehmer = true;
let currentPresetId = 'default-strict-german';
let allPresets = [];
let v8UiReady = false;

const send = (msg) => new Promise((r) => chrome.runtime.sendMessage(msg, r));
const get = (k) => new Promise((r) => chrome.storage.local.get(k, r));
const set = (o) => new Promise((r) => chrome.storage.local.set(o, r));

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(msg, type = 'info', dur = 3200) {
  if (!els.toastContainer) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  els.toastContainer.appendChild(el);
  setTimeout(() => {
    el.classList.add('toast-out');
    setTimeout(() => el.remove(), 260);
  }, dur);
}

function parseNum(s) {
  if (s == null) return NaN;
  return parseFloat(String(s).replace(/\s/g, '').replace(/[^\d.,-]/g, '').replace(',', '.'));
}
function fmtEuro(n) {
  return isFinite(n) ? n.toFixed(2).replace('.', ',') + ' €' : '0,00 €';
}

function setStatus(text, state = 'loading') {
  if (!els.statusCard || !els.statusText || !els.statusIcon) return;
  els.statusCard.hidden = false;
  els.statusCard.classList.remove('loading', 'success', 'error', 'info', 'idle');
  if (state !== 'idle') els.statusCard.classList.add(state);
  els.statusText.textContent = text;
  const glyphs = { idle: '●', loading: '', success: '✓', error: '✕', info: 'ℹ' };
  els.statusIcon.textContent = glyphs[state] ?? '●';
}
function hideStatus() {
  if (els.statusCard) els.statusCard.hidden = true;
  if (els.diagnostics) els.diagnostics.hidden = true;
}
function setDiagnostics(lines) {
  if (!els.diagnostics) return;
  const arr = (lines || []).filter(Boolean);
  if (!arr.length) { els.diagnostics.hidden = true; els.diagnostics.innerHTML = ''; return; }
  els.diagnostics.innerHTML = arr.map((l) => {
    let cls = 'diag-line';
    if (/^✓/.test(l)) cls += ' ok';
    else if (/^✗|Fehler|fehlgeschlagen/i.test(l)) cls += ' err';
    else if (/^ℹ/.test(l)) cls += ' info';
    return `<div class="${cls}">${esc(l)}</div>`;
  }).join('');
  els.diagnostics.hidden = false;
}
function relTime(ms) {
  if (!ms) return '';
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'gerade eben';
  if (diff < 3_600_000) return `vor ${Math.floor(diff / 60_000)} Min.`;
  if (diff < 86_400_000) return `vor ${Math.floor(diff / 3_600_000)} Std.`;
  return new Date(ms).toLocaleDateString('de-DE');
}
function initials(name) {
  if (!name) return '?';
  const p = String(name).trim().split(/\s+/);
  return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase();
}

/* ============================================================ TABS */
const TAB_META = {
  generator: { title: 'nav_generator', sub: 'gen_sub' },
  research:  { title: 'nav_research',  sub: 'res_sub' },
  inventory: { title: 'nav_inventory', sub: '' },
  inbox:     { title: 'nav_inbox',     sub: '' },
  kanban:    { title: 'nav_kanban',    sub: '' },
  analytics: { title: 'nav_analytics', sub: '' },
  queue:     { title: 'nav_queue',     sub: 'queue_hint' },
  accounts:  { title: 'nav_accounts',  sub: '' },
  config:    { title: 'nav_config',    sub: '' }
};

function switchTab(tab) {
  activeTab = tab;
  els.navBtns.forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  els.tabPanels.forEach((p) => p.classList.toggle('active', p.dataset.panel === tab));
  const meta = TAB_META[tab] || { title: '', sub: '' };
  if (els.viewTitle) els.viewTitle.setAttribute('data-t', meta.title);
  if (els.viewSub) els.viewSub.setAttribute('data-t', meta.sub);
  applyI18n();

  if (tab === 'analytics') V9UI.onAnalyticsTabActive();
  if (tab === 'accounts') refreshAccounts();
  if (tab === 'queue') V7.renderQueue();
  if (tab === 'config') { V7.renderConfigV7(); refreshStorageUsage(); refreshPollerStatus(); }
  if (tab === 'inbox' && v8UiReady) V8UI.onInboxTabActive();
}

/* ============================================================ DATA */
async function loadAll() {
  const r = await send({ action: 'getInventory' });
  inventory = Array.isArray(r?.inventory) ? r.inventory : [];
  await V7.refreshV7State();
  renderKPIs(); renderTable(); renderKanban();
  if (activeTab === 'analytics') V9UI.onAnalyticsTabActive();
  updateInboxBadge();
  V7.maybeOpenDelistReview();
  refreshStorageUsage();
}

function filterInventory() {
  if (!searchTerm) return inventory;
  const q = searchTerm.toLowerCase();
  return inventory.filter((x) => {
    const hay = [x.title, x.description, x.platform, x.condition, x.originalUrl]
      .filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
  });
}

function renderKPIs() {
  let invested = 0, revenue = 0;
  inventory.forEach((x) => {
    const c = parseNum(x.purchasePrice);
    const v = parseNum(x.targetPrice || x.price);
    if (isFinite(c)) invested += c;
    if (isFinite(v)) revenue += v;
  });
  if (els.kpiItems) els.kpiItems.textContent = inventory.length;
  if (els.kpiInvested) els.kpiInvested.textContent = fmtEuro(invested);
  if (els.kpiRevenue) els.kpiRevenue.textContent = fmtEuro(revenue);
  if (els.kpiProfit) {
    els.kpiProfit.textContent = fmtEuro(revenue - invested);
    els.kpiProfit.style.color = (revenue - invested) >= 0 ? 'var(--success)' : 'var(--danger)';
  }
}

function recalcPrice() {
  if (!els.purchasePrice || !els.targetPrice || !els.compBar) return;
  const p = parseNum(els.purchasePrice.value);
  const target = (isFinite(p) && p > 0) ? Math.ceil(p * 2) : NaN;
  els.targetPrice.value = isFinite(target) ? String(target) : '';
  const floor = isFinite(target) ? Math.ceil(target * 0.65) : NaN;
  const ceil  = isFinite(target) ? Math.ceil(target * 1.35) : NaN;
  const q = (sel) => els.compBar.querySelector(sel);
  if (q('.comp-floor'))  q('.comp-floor').textContent  = isFinite(floor)  ? `Floor: ${floor} €`   : 'Floor: —';
  if (q('.comp-target')) q('.comp-target').textContent = isFinite(target) ? `Target: ${target} €` : 'Target: —';
  if (q('.comp-ceil'))   q('.comp-ceil').textContent   = isFinite(ceil)   ? `Ceiling: ${ceil} €`  : 'Ceiling: —';
}

async function updateModelHealth() {
  const r = await send({ action: 'probeHealth' });
  const h = r?.health;
  if (!els.modelHealth) return;
  if (!h || !h.ok) {
    els.modelHealth.textContent = '● Offline';
    els.modelHealth.className = 'status-pill err';
    els.modelHealth.title = h?.reason || 'Keine Verbindung';
    return;
  }
  els.modelHealth.textContent = '● ' + (h.activeModel || 'ready').replace(/^gemini-/, '');
  els.modelHealth.className = 'status-pill ok';
  els.modelHealth.title = `Aktiv: ${h.activeModel}`;
}

/* ============================================================ STORAGE */
async function refreshStorageUsage() {
  try {
    const r = await send({ action: 'getStorageUsage' });
    const u = r?.usage;
    if (!u || u.total < 0) {
      if (els.quotaDetail) els.quotaDetail.textContent = 'Nicht verfügbar';
      if (els.quotaPill) els.quotaPill.textContent = '—';
      return;
    }
    const pct = Math.min(100, u.percent || 0);
    if (els.quotaPct) els.quotaPct.textContent = `${u.totalMB.toFixed(2)} / ${u.limitMB} MB (${pct.toFixed(0)}%)`;
    if (els.quotaFill) {
      els.quotaFill.style.width = pct + '%';
      els.quotaFill.style.background = pct > 85 ? 'var(--danger)' : pct > 70 ? 'var(--warn)' : 'var(--brand)';
    }
    if (els.quotaDetail) {
      const parts = Object.entries(u.breakdown || {})
        .filter(([, bytes]) => bytes > 0)
        .map(([k, bytes]) => `${k}: ${(bytes / 1048576).toFixed(2)} MB`);
      els.quotaDetail.textContent = parts.join(' · ') || 'Keine Daten';
    }
    if (els.quotaPill) {
      els.quotaPill.textContent = `${pct.toFixed(0)}%`;
      els.quotaPill.className = 'status-pill ' + (pct > 85 ? 'err' : pct > 70 ? 'warn' : '');
      els.quotaPill.title = `Speicher: ${u.totalMB.toFixed(2)} / ${u.limitMB} MB`;
    }
  } catch { /* ignore */ }
}

async function runCleanup() {
  if (!confirm('Speicher aufräumen? Älteste Bilder und Log-Einträge werden entfernt.')) return;
  els.cleanupStorageBtn.disabled = true;
  const r = await send({ action: 'cleanupStorage', aggressive: false });
  els.cleanupStorageBtn.disabled = false;
  if (r?.ok && r.summary) {
    toast(`${r.summary.freedMB.toFixed(2)} MB freigegeben.`, 'success', 5000);
    refreshStorageUsage();
  } else {
    toast('Aufräumen fehlgeschlagen.', 'error');
  }
}

/* ============================================================ POLLER */
async function refreshPollerStatus() {
  try {
    const r = await send({ action: 'pollerStatus' });
    if (els.pollerEnabled) els.pollerEnabled.checked = !!r?.enabled;
    if (els.pollerHint) {
      els.pollerHint.textContent = r?.enabled
        ? 'Poller läuft — nächste Prüfung innerhalb von ~15 Min.'
        : 'Poller ist deaktiviert. Aktiviere ihn für automatisches Sync im Hintergrund.';
    }
  } catch { /* ignore */ }
}

async function onPollerToggle(ev) {
  const on = ev.target.checked;
  const r = await send({ action: 'pollerSetEnabled', enabled: on });
  if (r?.ok) {
    toast(on ? 'Inbox-Poller aktiviert.' : 'Inbox-Poller deaktiviert.', 'success');
    refreshPollerStatus();
    if (on) setTimeout(runPollerNow, 500);
  } else {
    ev.target.checked = !on;
    toast('Konnte nicht umgeschaltet werden.', 'error');
  }
}

async function runPollerNow() {
  if (els.pollerRunNow) els.pollerRunNow.disabled = true;
  const r = await send({ action: 'pollerRunNow' });
  if (els.pollerRunNow) els.pollerRunNow.disabled = false;
  const res = r?.result;
  if (res?.ok) {
    toast(`${res.total} Unterhaltung(en), ${res.totalNew} neu.`, 'success');
    updateInboxBadge();
    if (v8UiReady && activeTab === 'inbox') V8UI.refreshInbox();
  } else if (res?.skipped) {
    toast('Sync übersprungen: ' + res.skipped, 'warn', 5000);
  } else {
    toast('Sync fehlgeschlagen.', 'error');
  }
}

/* ============================================================ TAB HELPERS */
function waitForTabComplete(tabId) {
  return new Promise((resolve) => {
    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        setTimeout(resolve, 800);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(); }, 15000);
  });
}

async function findOrCreateSourceTab(url) {
  const hostMatch = /amazon\.|otto\.|idealo\.|vinted\./i.test(url || '');
  if (!hostMatch) {
    const tabs = await new Promise((r) =>
      chrome.tabs.query({ url: ['*://*.amazon.de/*','*://*.amazon.com/*','*://*.otto.de/*','*://*.idealo.de/*','*://*.vinted.de/*'] }, r));
    if (tabs && tabs.length) return tabs[0];
    return null;
  }
  const tab = await chrome.tabs.create({ url, active: false });
  await waitForTabComplete(tab.id);
  return tab;
}

/* ============================================================ CAPTURE */
async function guardVintedScrape(u) {
  try {
    const g = await runWithConsent(() => guard({
      feature: 'vinted', platform: 'vinted', host: 'vinted',
      rate: 'scrape', op: 'scrape', detail: String(u).slice(0, 120)
    }));
    if (!g) { toast(t('consent_declined'), 'warn'); return false; }
    return true;
  } catch (e) { hideStatus(); toast(e.message, 'error', 6000); return false; }
}

async function captureProduct() {
  const url = els.productUrl.value.trim();
  let vintedGuarded = false;
  if (/vinted\./i.test(url)) { if (!(await guardVintedScrape(url))) return; vintedGuarded = true; }

  setStatus('Suche Quell-Tab…', 'loading');
  setDiagnostics([]);

  let tab;
  try { tab = await findOrCreateSourceTab(url); }
  catch (e) { setStatus('Tab-Fehler: ' + e.message, 'error'); toast('Tab-Fehler', 'error'); return; }

  if (!tab) { setStatus('Bitte Produktseite öffnen oder URL einfügen.', 'error'); toast('Bitte URL einfügen', 'warn'); return; }

  setStatus('Scrape Produkt…', 'loading');
  const sourceUrl = tab.url;
  if (!vintedGuarded && /vinted\./i.test(sourceUrl || '')) {
    if (!(await guardVintedScrape(sourceUrl))) return;
  }

  let resp;
  try { resp = await chrome.tabs.sendMessage(tab.id, { action: 'scrapeProduct' }); }
  catch {
    try {
      await injectContent(tab.id, /vinted\./i.test(sourceUrl || '') ? 'vinted' : 'x');
      await new Promise((r) => setTimeout(r, 300));
      resp = await chrome.tabs.sendMessage(tab.id, { action: 'scrapeProduct' });
    } catch (e) {
      setStatus('Scraping fehlgeschlagen. Seite neu laden (F5).', 'error');
      toast('Scraping fehlgeschlagen.', 'error');
      return;
    }
  }

  if (resp?.killed) { setStatus(resp.error, 'error'); toast(resp.error, 'error', 6000); return; }
  if (!resp?.ok) {
    setStatus(resp?.error || 'Scrape fehlgeschlagen.', 'error');
    setDiagnostics(resp?.diagnostics || []);
    toast(resp?.error || 'Scrape fehlgeschlagen.', 'error');
    return;
  }

  scraped = { ...resp.data, originalUrl: sourceUrl };
  setDiagnostics(resp.diagnostics || []);

  if (AutoTranslate.isAmazonCom(sourceUrl)) {
    setStatus(t('translating'), 'loading');
    const translated = await AutoTranslate.translateToGerman(scraped);
    if (translated.translated) scraped = translated;
  }

  els.capturedBox.hidden = false;
  els.capturedTitle.textContent = scraped.title || '(kein Titel)';
  els.capturedMeta.textContent = [
    scraped.site ? `Quelle: ${scraped.site}` : '',
    scraped.brand ? `Marke: ${scraped.brand}` : '',
    scraped.price ? `${scraped.price} €` : '',
    `${scraped.images?.length || 0} Bilder`,
    scraped.translated ? t('translated_badge') : ''
  ].filter(Boolean).join(' · ');
  els.capturedLink.href = sourceUrl;

  if (scraped.price && !els.purchasePrice.value) {
    els.purchasePrice.value = scraped.price;
    recalcPrice();
    set({ purchasePrice: els.purchasePrice.value });
  }

  if (scraped.images?.length) {
    setStatus(`Lade ${Math.min(scraped.images.length, 8)} Bilder parallel…`, 'loading');
    const urls = scraped.images.slice(0, 8);
    const results = await Promise.all(urls.map(async (u, idx) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);
      try {
        const r = await fetch(u, { credentials: 'omit', mode: 'cors', signal: controller.signal });
        if (!r.ok) return null;
        const blob = await r.blob();
        const dataUrl = await new Promise((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => res(fr.result);
          fr.onerror = () => rej(fr.error);
          fr.readAsDataURL(blob);
        });
        const ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
        return {
          id: `i-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
          dataUrl, filename: `garlo-${Date.now()}-${idx}.${ext}`, cleaned: false
        };
      } catch { return null; }
      finally { clearTimeout(timeoutId); }
    }));
    const cached = results.filter(Boolean);
    if (cached.length) {
      imageCache = cached;
      await set({ imageCache });
      renderImages();
    }
  }

  setStatus('Produkt erfasst.', 'success');
  setDiagnostics([`✓ ${scraped.title || '(kein Titel)'}`, `✓ ${scraped.images?.length || 0} Bilder`]);
  toast('Produkt erfasst.', 'success');
}

/* ============================================================ IMAGES */
function renderImages() {
  if (!els.imageGrid) return;
  els.imageGrid.innerHTML = '';
  if (els.imageBadge) els.imageBadge.textContent = imageCache.length;
  imageCache.forEach((img) => {
    const div = document.createElement('div');
    div.className = 'image-thumb';
    const el = document.createElement('img');
    el.src = img.dataUrl; el.alt = img.filename || '';
    const rm = document.createElement('button');
    rm.className = 'remove-img'; rm.type = 'button'; rm.textContent = '✕';
    rm.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      imageCache = imageCache.filter((i) => i.id !== img.id);
      await set({ imageCache });
      renderImages();
    });
    div.appendChild(el); div.appendChild(rm);
    if (img.cleaned) {
      const badge = document.createElement('div');
      badge.className = 'clean-badge'; badge.textContent = '✓ CLEAN';
      div.appendChild(badge);
    }
    els.imageGrid.appendChild(div);
  });
}

async function cleanImages() {
  if (!imageCache.length) { toast('Kein Bild im Cache.', 'warn'); return; }
  setStatus('Bereinige Bilder…', 'loading');
  const cleaned = [];
  for (const img of imageCache) {
    try {
      const result = await cleanImageDataUrl(img.dataUrl);
      cleaned.push({ ...img, dataUrl: result, cleaned: true });
    } catch { cleaned.push(img); }
  }
  imageCache = cleaned;
  await set({ imageCache });
  renderImages();
  setStatus(`${cleaned.length} Bild(er) bereinigt.`, 'success');
  toast(`${cleaned.length} Bild(er) bereinigt.`, 'success');
}

function cleanImageDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = im.naturalWidth; c.height = im.naturalHeight;
        const ctx = c.getContext('2d');
        ctx.drawImage(im, 0, 0);
        const trimmed = trimWhite(ctx, c.width, c.height);
        const side = Math.min(trimmed.w, trimmed.h);
        const sx = trimmed.x + Math.floor((trimmed.w - side) / 2);
        const sy = trimmed.y + Math.floor((trimmed.h - side) / 2);
        const out = document.createElement('canvas');
        out.width = 800; out.height = 800;
        const octx = out.getContext('2d');
        octx.fillStyle = '#ffffff'; octx.fillRect(0, 0, 800, 800);
        octx.drawImage(c, sx, sy, side, side, 0, 0, 800, 800);
        resolve(out.toDataURL('image/jpeg', 0.92));
      } catch (e) { reject(e); }
    };
    im.onerror = reject; im.src = dataUrl;
  });
}

function trimWhite(ctx, w, h) {
  const imgData = ctx.getImageData(0, 0, w, h).data;
  const threshold = 245;
  let top = 0, left = 0, right = w - 1, bottom = h - 1;
  const isWhite = (x, y) => {
    const i = (y * w + x) * 4;
    return imgData[i] > threshold && imgData[i + 1] > threshold && imgData[i + 2] > threshold;
  };
  const rowWhite = (y) => { for (let x = 0; x < w; x++) if (!isWhite(x, y)) return false; return true; };
  const colWhite = (x) => { for (let y = 0; y < h; y++) if (!isWhite(x, y)) return false; return true; };
  while (top < h && rowWhite(top)) top++;
  while (bottom > top && rowWhite(bottom)) bottom--;
  while (left < w && colWhite(left)) left++;
  while (right > left && colWhite(right)) right--;
  if (left >= right || top >= bottom) return { x: 0, y: 0, w, h };
  return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}

function applyActiveVariant() {
  const v = variants[activeTone];
  if (!v) return;
  els.titleOut.value = v.title || '';
  els.priceOut.value = v.price || '';
  els.descOut.value = v.description || '';
  els.titleOut.dispatchEvent(new Event('input'));
  els.previewCard.hidden = false;
  const tabs = document.querySelector('.variant-tabs');
  if (tabs) tabs.style.display = 'none';
}

/* ============================================================ GENERATE */
async function generate() {
  if (!scraped) { toast('Bitte zuerst Produkt scrapen.', 'warn'); return; }
  setStatus('Generiere Listing…', 'loading');
  setDiagnostics([]);

  const listingLang = await ListingLang.getListingLanguage();
  const presets = await PromptEditor.loadPresets();
  const preset = presets.find((p) => p.id === currentPresetId) || presets[0];

  const r = await send({
    action: 'generateVariants', scraped, tones: ['balanced'],
    purchasePrice: els.purchasePrice.value, targetPrice: els.targetPrice.value,
    shippingTier: els.shippingTier.value, listingLanguage: listingLang,
    customTemplate: preset?.template || null,
    legal: { sach: els.legalSach.checked, rück: els.legalRück.checked, tausch: els.legalTausch.checked }
  });

  if (!r?.ok) { setStatus(r?.error || 'Generierung fehlgeschlagen.', 'error'); toast('Generierung fehlgeschlagen.', 'error'); return; }

  const data = r.results?.balanced;
  if (!data?.ok) {
    setStatus('Generierung fehlgeschlagen.', 'error');
    setDiagnostics(String(data?.error || '').split('\n').map((l) => '✗ ' + l));
    toast('Generierung fehlgeschlagen.', 'error');
    return;
  }

  variants.balanced = data;
  activeTone = 'balanced';
  applyActiveVariant();

  const aiPrice = parseNum(data.price);
  if (isFinite(aiPrice) && aiPrice > 0) els.priceOut.value = String(Math.ceil(aiPrice));

  const modelInfo = `${data.model}${data.pass === 2 ? ' (2. Versuch)' : ''}`;
  setStatus('Listing generiert.', 'success');
  setDiagnostics([`✓ Modell: ${modelInfo}`, `✓ Titel: ${(data.title || '').slice(0, 70)}`, `✓ Preis: ${els.priceOut.value} €`]);
  await ToneTracker.recordGeneration('balanced', scraped.originalUrl || '');
  toast('Listing generiert.', 'success');
}

async function copyText(text, btn, label) {
  if (!text) { toast('Nichts zu kopieren.', 'warn'); return; }
  try {
    await navigator.clipboard.writeText(text);
    if (btn) { btn.classList.add('copied'); setTimeout(() => btn.classList.remove('copied'), 1200); }
    toast(`${label} kopiert!`, 'success');
  } catch { toast('Kopieren fehlgeschlagen.', 'error'); }
}

async function saveToInventory() {
  const title = els.titleOut.value.trim();
  if (!title) { toast('Kein Titel vorhanden. Erst generieren.', 'warn'); return; }
  const item = {
    title, price: els.priceOut.value.trim(), description: els.descOut.value.trim(),
    platform: 'kleinanzeigen', condition: 'Neu & OVP',
    purchasePrice: els.purchasePrice.value.trim(), targetPrice: els.targetPrice.value.trim(),
    shippingTier: els.shippingTier.value,
    legal: { sach: els.legalSach.checked, rück: els.legalRück.checked, tausch: els.legalTausch.checked },
    status: 'drafted', tone: activeTone, variants: JSON.parse(JSON.stringify(variants)),
    imageCount: imageCache.length,
    sourceTitle: scraped?.title || '', sourceBrand: scraped?.brand || '',
    originalUrl: scraped?.originalUrl || els.productUrl.value.trim() || '',
    sourceImages: (scraped?.images || []).filter((u) => /^https?:\/\//i.test(u)).slice(0, 8),
    publishedTo: {}
  };
  const r = await send({ action: 'saveInventoryItem', item });
  if (r?.ok) { toast('Im Inventar gespeichert.', 'success'); await loadAll(); }
  else toast('Speichern fehlgeschlagen.', 'error');
}

/* ============================================================ PUBLISH */
async function publishToMarketplace(platform) {
  const payload = {
    title: els.titleOut.value.trim(), price: els.priceOut.value.trim(),
    description: els.descOut.value.trim(), platform,
    images: imageCache.map((i) => ({ dataUrl: i.dataUrl, filename: i.filename })),
    brand: scraped?.brand || '', autoCategory: platform === 'kleinanzeigen',
    condition: 'Neu & OVP',
    purchasePrice: els.purchasePrice.value.trim(),
    targetPrice: els.targetPrice.value.trim(),
    shippingTier: els.shippingTier.value,
    tone: activeTone,
    variants: JSON.parse(JSON.stringify(variants)),
    imageCount: imageCache.length,
    sourceTitle: scraped?.title || '',
    sourceBrand: scraped?.brand || '',
    originalUrl: scraped?.originalUrl || els.productUrl.value.trim() || '',
    sourceImages: (scraped?.images || []).filter((u) => /^https?:\/\//i.test(u)).slice(0, 8),
    legal: { sach: els.legalSach.checked, rück: els.legalRück.checked, tausch: els.legalTausch.checked }
  };
  if (!payload.title && !payload.description) { toast('Erst ein Listing generieren.', 'warn'); return; }
  await doPublish(payload);
}

async function publishItem(item, platform) {
  const images = await fetchImages(item.sourceImages || [], 8);
  await doPublish({
    title: item.title || '', price: item.targetPrice || item.price || '',
    description: item.description || '', platform, images,
    brand: item.sourceBrand || '',
    autoCategory: platform === 'kleinanzeigen', itemId: item.id,
    condition: item.condition || 'Neu & OVP',
    purchasePrice: item.purchasePrice || '', targetPrice: item.targetPrice || '',
    shippingTier: item.shippingTier || '',
    tone: item.tone || 'balanced',
    variants: item.variants || {},
    imageCount: images.length,
    sourceTitle: item.sourceTitle || '', sourceBrand: item.sourceBrand || '',
    originalUrl: item.originalUrl || '',
    sourceImages: item.sourceImages || [],
    legal: item.legal || null
  });
}

async function doPublish(payload) {
  const platform = payload.platform;
  const P = PLATFORMS[platform];
  if (!P) { toast('Unbekannte Plattform: ' + platform, 'error'); return; }

  try {
    const g = await runWithConsent(() => guard({
      feature: featureFor(platform), platform, host: P.rateHost, rate: 'publish',
      op: 'form-fill', itemId: payload.itemId, detail: (payload.title || '').slice(0, 60)
    }));
    if (!g) { toast(t('consent_declined'), 'warn'); return; }
  } catch (e) { toast(e.message, 'error', 6000); return; }

  const tabs = await new Promise((r) => chrome.tabs.query({ url: P.tabPattern }, r));

  if (tabs && tabs.length) {
    const tab = tabs[0];
    chrome.tabs.update(tab.id, { active: true });
    let resp;
    try { resp = await chrome.tabs.sendMessage(tab.id, { action: 'fillForm', data: payload }); }
    catch {
      await injectContent(tab.id, platform);
      await new Promise((r) => setTimeout(r, 250));
      resp = await chrome.tabs.sendMessage(tab.id, { action: 'fillForm', data: payload });
    }
    if (resp?.killed) { toast(resp.error, 'error', 6000); return; }
    if (resp?.ok) {
      const { filled = [], missing = [], imagesInjected = 0, categoryMatched, notes = [] } = resp.result || {};
      toast(
        `${platform}: ${filled.join(', ') || '–'}` +
        (imagesInjected ? ` · ${imagesInjected} Bilder` : '') +
        (categoryMatched ? ` · ${categoryMatched}` : '') +
        (missing.length ? ` · fehlt: ${missing.join(', ')}` : '') +
        (notes.length ? ` · ${notes.join(' ')}` : ''),
        filled.length ? 'success' : 'warn', 6000
      );
      if (filled.length) {
        await publishComplete(payload, tab.url);
        await send({ action: 'watchRegister', tabId: tab.id, itemId: payload.itemId || '', platform });
      }
      return;
    }
  }

  const text = `TITEL:\n${payload.title}\n\nPREIS: ${payload.price} €\n\nBESCHREIBUNG:\n${payload.description}`;
  try { await navigator.clipboard.writeText(text); } catch {}
  const newTab = await chrome.tabs.create({ url: P.newUrl });
  await publishComplete(payload, '');
  await send({ action: 'watchRegister', tabId: newTab.id, itemId: payload.itemId || '', platform });
  toast(`${platform}-Text kopiert · Tab geöffnet.`, 'success', 4000);
}

async function publishComplete(payload, url) {
  try {
    const r = await send({ action: 'publishComplete', payload: { ...payload, url: url || '' } });
    if (r?.ok && r.action === 'created') {
      toast(`Neuer Artikel im Inventar angelegt (${(r.item.title || '').slice(0, 40) || '—'})`, 'success', 4500);
      await loadAll();
    } else if (r?.ok && r.action === 'updated') {
      await loadAll();
    }
  } catch (e) {
    console.warn('publishComplete failed', e);
  }
}

/* ============================================================ INVENTORY TABLE */
function renderTable() {
  if (!els.invTableBody) return;
  const list = filterInventory();
  els.invTableBody.innerHTML = '';
  if (!list.length) {
    els.invTableBody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:30px;color:var(--text-muted)">Keine Artikel.</td></tr>`;
    return;
  }
  list.forEach((item) => {
    const ek = parseNum(item.purchasePrice);
    const vk = parseNum(item.targetPrice || item.price);
    const margin = isFinite(ek) && isFinite(vk) && ek > 0 ? `${(((vk - ek) / ek) * 100).toFixed(0)} %` : '—';
    const url = item.originalUrl || item.sourceUrl || '';
    const safeTitle = esc(item.title || '(ohne Titel)');
    const titleHtml = url
      ? `<a class="title-link" href="${esc(url)}" target="_blank" rel="noopener">${safeTitle}</a>
         <a class="source-icon" href="${esc(url)}" target="_blank" rel="noopener" title="Quelle öffnen">↗</a>`
      : safeTitle;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="status-pill status-${item.status || 'drafted'}">${item.status || 'drafted'}</span></td>
      <td><div class="title-cell">${titleHtml}</div></td>
      <td>${esc(item.platform || '—')}</td>
      <td>${item.purchasePrice ? esc(item.purchasePrice) + ' €' : '—'}</td>
      <td>${item.targetPrice || item.price ? esc(item.targetPrice || item.price) + ' €' : '—'}</td>
      <td>${margin}</td>
      <td>${V7.platformBadgesHtml(item)} ${V7.staleBadgeHtml(item)}</td>
      <td><div class="publish-btns">
        <button class="publish-btn" data-publish="kleinanzeigen">KA</button>
        <button class="publish-btn" data-publish="ebay">eBay</button>
        <button class="publish-btn" data-publish="vinted">Vinted</button>
      </div></td>
      <td><button class="icon-btn" data-del="${item.id}">✕</button></td>
    `;
    tr.addEventListener('click', (e) => {
      if (e.target.closest('a') || e.target.closest('button')) return;
      openDrawer(item);
    });
    tr.querySelector('[data-del]').addEventListener('click', async (e) => {
      e.stopPropagation();
      const liveWarn = Object.values(item.publishedTo || {}).some((p) => p.status === 'live')
        ? '\n⚠ Der Artikel hat noch LIVE-Inserate (werden NICHT beendet).' : '';
      if (!confirm('Eintrag löschen?' + liveWarn)) return;
      await send({ action: 'deleteInventoryItem', id: item.id });
      await loadAll();
      toast('Gelöscht.', 'success');
    });
    tr.querySelectorAll('[data-publish]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await publishItem(item, btn.dataset.publish);
      });
    });
    els.invTableBody.appendChild(tr);
  });
}

/* ============================================================ KANBAN */
function renderKanban() {
  const filtered = filterInventory();
  const groups = { drafted: [], ready: [], listed: [], sold: [] };
  filtered.forEach((item) => {
    const st = item.status || 'drafted';
    (groups[st] = groups[st] || []).push(item);
  });
  Object.keys(groups).forEach((status) => {
    const cEl = document.querySelector(`[data-count="${status}"]`);
    if (cEl) cEl.textContent = groups[status].length;
    const body = document.querySelector(`[data-drop="${status}"]`);
    if (!body) return;
    body.innerHTML = '';
    groups[status].forEach((item) => body.appendChild(kanbanCard(item)));
  });
}

function kanbanCard(item) {
  const div = document.createElement('div');
  div.className = 'kcard'; div.draggable = true; div.dataset.id = item.id;
  const price = item.targetPrice || item.price;
  div.innerHTML = `
    <div class="kcard-title">${esc(item.title || '(ohne Titel)')}</div>
    ${price ? `<div class="kcard-price">${esc(price)} €</div>` : ''}
    <div class="kcard-tags">
      <span class="kcard-tag">${esc(item.platform || 'ka')}</span>
      ${item.tone ? `<span class="kcard-tag">${esc(item.tone)}</span>` : ''}
    </div>`;
  div.addEventListener('click', () => openDrawer(item));
  div.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', item.id); div.classList.add('dragging'); });
  div.addEventListener('dragend', () => div.classList.remove('dragging'));
  return div;
}

document.querySelectorAll('[data-drop]').forEach((col) => {
  col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drag-over'); });
  col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
  col.addEventListener('drop', async (e) => {
    e.preventDefault(); col.classList.remove('drag-over');
    const id = e.dataTransfer.getData('text/plain');
    const status = col.dataset.drop;
    if (!id || !status) return;
    await send({ action: 'updateStatus', id, status });
    const item = inventory.find((x) => x.id === id);
    if (item) item.status = status;
    renderKPIs(); renderTable(); renderKanban();
    if (status === 'sold' && item?.tone) await ToneTracker.recordSale(item.tone, id);
    toast(`Status → ${status}`, 'success', 1600);
    if (status === 'sold') await loadAll();
  });
});

/* ============================================================ INBOX BADGE */
async function updateInboxBadge() {
  try {
    const unread = await Messenger.getUnreadCount();
    if (!els.inboxBadge) return;
    if (unread > 0) { els.inboxBadge.textContent = unread; els.inboxBadge.hidden = false; }
    else els.inboxBadge.hidden = true;
  } catch { /* ignore */ }
}

/* ============================================================ ACCOUNTS */
function setAccountState(which, state) {
  const map = {
    google: { status: els.acctGoogleStatus, meta: els.acctGoogleMeta, card: document.querySelector('[data-service="google"]') },
    ebay:   { status: els.acctEbayStatus,   meta: els.acctEbayMeta,   card: document.querySelector('[data-service="ebay"]') },
    ka:     { status: els.acctKaStatus,     meta: els.acctKaMeta,     card: document.querySelector('[data-service="kleinanzeigen"]') }
  };
  const t2 = map[which]; if (!t2 || !t2.status) return;
  const { ok, label, metaText } = state;
  const dotClass = ok === true ? 'dot-ok' : ok === false ? 'dot-err' : 'dot-unknown';
  t2.status.innerHTML = `<span class="dot-status ${dotClass}"></span> ${esc(label)}`;
  if (t2.meta) t2.meta.textContent = metaText || '—';
  if (t2.card) {
    t2.card.classList.remove('connected', 'disconnected', 'error');
    if (ok === true) t2.card.classList.add('connected');
    else if (ok === false) t2.card.classList.add('error');
    else t2.card.classList.add('disconnected');
  }
}

async function refreshAccounts() {
  setAccountState('google', { ok: null, label: 'Prüfe…' });
  setAccountState('ebay',   { ok: null, label: 'Prüfe…' });
  setAccountState('ka',     { ok: null, label: 'Prüfe…' });
  const r = await send({ action: 'probeHealth' });
  const ok = !!r?.health?.ok;
  setAccountState('google', {
    ok, label: ok ? 'Verbunden' : 'Nicht verbunden',
    metaText: r?.health?.activeModel ? `Modell: ${r.health.activeModel}` : (r?.health?.reason || '—')
  });
  await V7.refreshV7State();
  setAccountState('ebay', { ok: V7.isEbayApiMode() ? true : null, label: V7.ebayModeLabel(), metaText: 'eBay.de' });
  setAccountState('ka',   { ok: null, label: 'Tab öffnen zum Prüfen', metaText: 'Kleinanzeigen.de' });
}

/* ============================================================ DRAWER */
function openDrawer(item) {
  if (!els.drawer) return;
  els.drawer.hidden = false;
  els.drawerTitle.textContent = item.title || 'Artikel';
  const margin = (() => {
    const c = parseNum(item.purchasePrice);
    const r = parseNum(item.targetPrice || item.price);
    if (!isFinite(c) || !isFinite(r) || c === 0) return '—';
    return `${(((r - c) / c) * 100).toFixed(1)} %`;
  })();
  const url = item.originalUrl || item.sourceUrl || '';
  const urlHtml = url
    ? `<a href="${esc(url)}" target="_blank" rel="noopener" style="color:var(--brand-hover);text-decoration:none;font-weight:600;">${esc(url)} ↗</a>`
    : '—';
  els.drawerBody.innerHTML = `
    <div class="drawer-field"><div class="drawer-label">Status</div>
      <div class="drawer-status" id="drawerStatusGroup">
        ${['drafted','ready','listed','sold'].map((s) => `<button data-status="${s}" class="${item.status === s ? 'active' : ''}">${s}</button>`).join('')}
      </div></div>
    <div class="drawer-field"><div class="drawer-label">Titel</div><div class="drawer-value">${esc(item.title || '—')}</div></div>
    <div class="drawer-field"><div class="drawer-label">Preis (EK → VK · Marge)</div>
      <div class="drawer-value">${esc(item.purchasePrice || '—')} € → ${esc(item.targetPrice || item.price || '—')} € · ${margin}</div></div>
    <div class="drawer-field"><div class="drawer-label">Beschreibung</div><div class="drawer-value">${esc(item.description || '—')}</div></div>
    <div class="drawer-field"><div class="drawer-label">Original-Quelle</div><div class="drawer-value">${urlHtml}</div></div>
    <div id="drawerV7"></div>
    <div class="drawer-actions">
      <button id="drawerPubKlein" class="btn-side primary">📢 Kleinanzeigen</button>
      <button id="drawerPubEbay" class="btn-side primary">📢 eBay.de</button>
      <button id="drawerCopyTitle" class="btn-side">📋 Titel</button>
      <button id="drawerCopyDesc" class="btn-side">📋 Beschreibung</button>
      <button id="drawerDelete" class="btn-side danger" style="grid-column: span 2;">🗑 Löschen</button>
    </div>`;
  els.drawerBody.querySelectorAll('#drawerStatusGroup button').forEach((b) => {
    b.addEventListener('click', async () => {
      const prev = item.status;
      await send({ action: 'updateStatus', id: item.id, status: b.dataset.status });
      item.status = b.dataset.status;
      els.drawerBody.querySelectorAll('#drawerStatusGroup button').forEach((x) => x.classList.toggle('active', x.dataset.status === item.status));
      renderKPIs(); renderTable(); renderKanban();
      if (b.dataset.status === 'sold' && prev !== 'sold' && item.tone) await ToneTracker.recordSale(item.tone, item.id);
      toast(`Status → ${item.status}`, 'success', 1600);
      if (b.dataset.status === 'sold' && prev !== 'sold') { closeDrawer(); await loadAll(); }
    });
  });
  $('drawerPubKlein')?.addEventListener('click', () => publishItem(item, 'kleinanzeigen'));
  $('drawerPubEbay')?.addEventListener('click', () => publishItem(item, 'ebay'));
  $('drawerCopyTitle')?.addEventListener('click', () => navigator.clipboard.writeText(item.title || '').then(() => toast('Titel kopiert.', 'success')));
  $('drawerCopyDesc')?.addEventListener('click', () => navigator.clipboard.writeText(item.description || '').then(() => toast('Beschreibung kopiert.', 'success')));
  $('drawerDelete')?.addEventListener('click', async () => {
    if (!confirm('Eintrag löschen?')) return;
    await send({ action: 'deleteInventoryItem', id: item.id });
    closeDrawer(); await loadAll(); toast('Gelöscht.', 'success');
  });
  V7.wireDrawerV7(item);
}

function closeDrawer() { if (els.drawer) els.drawer.hidden = true; }

/* ============================================================ CSV */
function csvEscape(v) {
  if (v == null) return '';
  const s = String(v).replace(/"/g, '""');
  return /[,"\n;]/.test(s) ? `"${s}"` : s;
}
function exportCsv() {
  if (!inventory.length) { toast('Inventar leer.', 'warn'); return; }
  const headers = ['id','status','title','price','purchasePrice','targetPrice','platform','condition','tone','shippingTier','sourceTitle','sourceBrand','originalUrl','imageCount','createdAt','updatedAt','description'];
  const rows = [headers.join(',')];
  inventory.forEach((x) => rows.push(headers.map((h) => csvEscape(x[h])).join(',')));
  const blob = new Blob(['\uFEFF' + rows.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `garlo-inventory-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast(`${inventory.length} Einträge exportiert.`, 'success');
}
function parseCsv(text) {
  const rows = []; let cur = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i+1] === '"') { field += '"'; i++; }
      else if (c === '"') inQ = false;
      else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { cur.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (field !== '' || cur.length) { cur.push(field); rows.push(cur); cur = []; field = ''; }
        if (c === '\r' && text[i+1] === '\n') i++;
      } else field += c;
    }
  }
  if (field !== '' || cur.length) { cur.push(field); rows.push(cur); }
  if (!rows.length) return [];
  const headers = rows[0];
  return rows.slice(1).map((r) => { const obj = {}; headers.forEach((h, i) => obj[h.trim()] = r[i]); return obj; });
}
async function importCsv(file) {
  try {
    const text = await file.text();
    const rows = parseCsv(text).filter((r) => r.title);
    if (!rows.length) throw new Error('Keine gültigen Zeilen.');
    const r = await send({ action: 'importInventory', items: rows });
    if (r?.ok) { await loadAll(); toast(`${r.added} Einträge importiert.`, 'success'); }
  } catch (e) { toast('CSV Fehler: ' + e.message, 'error'); }
}

/* ============================================================ CONFIG */
async function refreshModelsAction() {
  const inputKey = els.cfgApiKey.value.trim();
  const stored = (await get(['apiKey'])).apiKey || '';
  if (inputKey && inputKey !== stored) {
    await set({ apiKey: inputKey });
    toast('API Key gespeichert.', 'success', 2000);
  }
  const apiKey = inputKey || stored;
  if (!apiKey) {
    els.modelHint.textContent = 'Bitte zuerst API Key eintragen.';
    toast('Kein API Key im Feld.', 'warn', 4000);
    return;
  }
  els.refreshModels.disabled = true;
  els.modelHint.textContent = 'Lade Modellliste…';
  const r = await send({ action: 'listModels', apiKey });
  els.refreshModels.disabled = false;
  if (!r?.ok) {
    els.modelHint.textContent = 'Fehler: ' + (r?.error || 'unbekannt');
    toast('Modellliste: ' + (r?.error || 'Fehler'), 'error', 6000);
    return;
  }
  const current = els.cfgModel.value;
  els.cfgModel.innerHTML = '<option value="__auto__">🔄 Auto (bestes verfügbares)</option>';
  (r.models || []).forEach((m) => {
    const opt = document.createElement('option');
    opt.value = m; opt.textContent = m;
    els.cfgModel.appendChild(opt);
  });
  const options = Array.from(els.cfgModel.options).map((o) => o.value);
  if (options.includes(current)) els.cfgModel.value = current;
  if (r.fallback) {
    els.modelHint.textContent = `${r.models.length} Modelle (Fallback — ${r.reason || 'API-Liste fehlgeschlagen'})`;
    toast(`${r.models.length} Modelle geladen (Fallback)`, 'warn', 5000);
  } else {
    els.modelHint.textContent = `${r.models.length} Modelle verfügbar.`;
    toast(`${r.models.length} Modelle geladen.`, 'success');
  }
}

/* ============================================================ RESEARCH */
async function startScannerAction() {
  const ok = await initScanner();
  if (!ok) { toast('BarcodeDetector nicht unterstützt oder keine Kamera.', 'error'); return; }
  const started = await startScanning(els.scannerVideo, null, (ean) => {
    els.eanValue.textContent = ean;
    els.scanResult.hidden = false;
    toast(`Barcode: ${ean}`, 'success');
    stopScannerAction();
  });
  if (started) { els.startScanBtn.hidden = true; els.stopScanBtn.hidden = false; els.scannerOverlay.hidden = false; }
}
function stopScannerAction() {
  stopScanning(els.scannerVideo);
  els.startScanBtn.hidden = false; els.stopScanBtn.hidden = true; els.scannerOverlay.hidden = true;
}
function updateResearchProfit() {
  const panel = document.querySelector('[data-panel="research"]');
  if (panel) updateProfitUI(panel, els.calcEk.value, els.calcVk.value, els.calcPlatform.value, isKleinunternehmer);
}
async function runBulkImport() {
  const asins = els.bulkAsins.value.split('\n').map((s) => s.trim()).filter((s) => s.length > 5);
  if (!asins.length) { toast('Keine gültigen ASINs.', 'warn'); return; }
  els.bulkImportBtn.disabled = true;
  toast(`${asins.length} ASINs in Warteschlange. (Bulk-Scraping folgt in V10)`, 'info', 4000);
  els.bulkImportBtn.disabled = false;
}

/* ============================================================ PROMPT EDITOR */
async function loadPromptEditor() {
  allPresets = await PromptEditor.loadPresets();
  if (!els.promptPresetSelect) return;
  els.promptPresetSelect.innerHTML = allPresets.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}${p.builtin ? ' (System)' : ''}</option>`).join('');
  const current = allPresets.find((p) => p.id === currentPresetId) || allPresets[0];
  if (current) {
    currentPresetId = current.id;
    els.promptPresetSelect.value = current.id;
    els.promptTextarea.value = current.template;
  }
}

/* ============================================================ LISTING LANG */
async function initListingLanguage() {
  if (!els.listingLangSelect) return;
  const code = await ListingLang.getListingLanguage();
  els.listingLangSelect.value = code;
}
async function onGenerateAltTexts() {
  if (!imageCache.length) { toast('Keine Bilder im Cache.', 'warn'); return; }
  els.generateAltTextBtn.disabled = true;
  els.generateAltTextBtn.textContent = t('alt_text_generating');
  const texts = await AltText.generateAltTexts(imageCache);
  window.__lastAltTexts = texts;
  els.generateAltTextBtn.disabled = false;
  els.generateAltTextBtn.textContent = t('alt_text_btn');
  const ok = texts.filter(Boolean).length;
  toast(t('alt_text_done').replace('{n}', String(ok)), ok ? 'success' : 'warn');
}

/* ============================================================ SEARCH */
let searchDebounceTimer = null;
function onSearchInput() {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    searchTerm = els.globalSearch.value.trim();
    renderTable();
    renderKanban();
  }, 200);
}

/* ============================================================ INIT */
async function init() {
  await initI18n();
  await checkConsent();

  const config = await get(['apiKey', 'modelPreference', 'theme', 'settings']);
  if (config.apiKey && els.cfgApiKey) els.cfgApiKey.value = config.apiKey;
  if (config.modelPreference && els.cfgModel) els.cfgModel.value = config.modelPreference;
  if (config.settings?.language && els.cfgLanguage) els.cfgLanguage.value = config.settings.language;
  if (config.settings?.taxStatus && els.cfgTaxStatus) {
    els.cfgTaxStatus.value = config.settings.taxStatus;
    isKleinunternehmer = config.settings.taxStatus === 'klein';
  }
  if (config.theme) document.documentElement.setAttribute('data-theme', config.theme);

  if (els.sidebarCollapse) {
    const stored = await get(['sidebarCollapsed']);
    if (stored?.sidebarCollapsed) document.body.classList.add('sidebar-collapsed');
    els.sidebarCollapse.addEventListener('click', async () => {
      document.body.classList.toggle('sidebar-collapsed');
      await set({ sidebarCollapsed: document.body.classList.contains('sidebar-collapsed') });
    });
  }

  if (els.killSwitchIndicator && config.settings?.killSwitch) els.killSwitchIndicator.style.color = 'var(--danger)';

  els.navBtns.forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));

  els.captureBtn?.addEventListener('click', captureProduct);
  els.generateBtn?.addEventListener('click', generate);
  els.publishKleinBtn?.addEventListener('click', () => publishToMarketplace('kleinanzeigen'));
  els.publishEbayBtn?.addEventListener('click', () => publishToMarketplace('ebay'));
  els.saveToInventory?.addEventListener('click', saveToInventory);
  els.cleanImagesBtn?.addEventListener('click', cleanImages);
  els.generateAltTextBtn?.addEventListener('click', onGenerateAltTexts);

  els.copyTitleBtn?.addEventListener('click', () => copyText(els.titleOut.value.trim(), els.copyTitleBtn, 'Titel'));
  els.copyDescBtn?.addEventListener('click', () => copyText(els.descOut.value.trim(), els.copyDescBtn, 'Beschreibung'));
  els.copyAllBtn?.addEventListener('click', () => copyText(`Titel: ${els.titleOut.value}\nPreis: ${els.priceOut.value} €\n\n${els.descOut.value}`, els.copyAllBtn, 'Alles'));

  els.purchasePrice?.addEventListener('input', () => { recalcPrice(); set({ purchasePrice: els.purchasePrice.value }); });
  els.productUrl?.addEventListener('input', () => set({ draftProductUrl: els.productUrl.value }));
  els.shippingTier?.addEventListener('change', () => set({ shippingTier: els.shippingTier.value }));

  els.titleOut?.addEventListener('input', () => {
    const len = els.titleOut.value.length;
    if (els.titleCount) { els.titleCount.textContent = `${len}/65`; els.titleCount.style.color = len > 65 ? 'var(--danger)' : ''; }
  });

  await loadPromptEditor();
  els.promptPresetSelect?.addEventListener('change', () => {
    currentPresetId = els.promptPresetSelect.value;
    const p = allPresets.find((x) => x.id === currentPresetId);
    if (p) els.promptTextarea.value = p.template;
  });
  els.promptSaveBtn?.addEventListener('click', async () => {
    const p = allPresets.find((x) => x.id === currentPresetId);
    if (!p) return;
    await PromptEditor.savePreset({ ...p, template: els.promptTextarea.value });
    toast('Vorlage gespeichert.', 'success');
  });
  els.promptDeleteBtn?.addEventListener('click', async () => {
    const p = allPresets.find((x) => x.id === currentPresetId);
    if (!p || p.builtin) { toast('Systemvorlagen können nicht gelöscht werden.', 'warn'); return; }
    if (!confirm('Vorlage löschen?')) return;
    await PromptEditor.deletePreset(currentPresetId);
    await loadPromptEditor();
    toast('Gelöscht.', 'success');
  });

  await initListingLanguage();
  els.listingLangSelect?.addEventListener('change', async () => {
    await ListingLang.setListingLanguage(els.listingLangSelect.value);
    toast('Listing-Sprache gespeichert.', 'success');
  });

  els.startScanBtn?.addEventListener('click', startScannerAction);
  els.stopScanBtn?.addEventListener('click', stopScannerAction);
  els.calcEk?.addEventListener('input', updateResearchProfit);
  els.calcVk?.addEventListener('input', updateResearchProfit);
  els.calcPlatform?.addEventListener('change', updateResearchProfit);
  els.bulkImportBtn?.addEventListener('click', runBulkImport);

  els.refreshAccountsBtn?.addEventListener('click', async () => { await refreshAccounts(); toast('Konten geprüft.', 'success'); });
  els.acctGoogleBtn?.addEventListener('click', () => { switchTab('config'); setTimeout(() => els.cfgApiKey?.focus(), 150); });
  els.acctEbayBtn?.addEventListener('click', () => chrome.tabs.create({ url: 'https://www.ebay.de/sh/ovw' }));
  els.acctKaBtn?.addEventListener('click', () => chrome.tabs.create({ url: 'https://www.kleinanzeigen.de/m-meine-anzeigen.html' }));

  els.closeDrawer?.addEventListener('click', closeDrawer);
  els.drawer?.querySelector('.drawer-backdrop')?.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

  els.globalSearch?.addEventListener('input', onSearchInput);

  document.addEventListener('keydown', (ev) => {
    if (ev.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) {
      ev.preventDefault();
      els.globalSearch?.focus();
    }
  });

  els.exportCsvBtn?.addEventListener('click', exportCsv);
  els.importCsvBtn?.addEventListener('click', () => els.csvFileInput?.click());
  els.csvFileInput?.addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    if (f) await importCsv(f);
    e.target.value = '';
  });

  els.cfgSave?.addEventListener('click', async () => {
    const lang = els.cfgLanguage.value;
    const tax = els.cfgTaxStatus.value;
    isKleinunternehmer = tax === 'klein';
    await setLanguage(lang);
    const cur = await get(['settings']);
    await set({
      apiKey: els.cfgApiKey.value.trim(),
      modelPreference: els.cfgModel.value,
      settings: { ...(cur.settings || {}), language: lang, taxStatus: tax }
    });
    toast(t('toast_saved'), 'success');
    updateModelHealth();
  });
  els.refreshModels?.addEventListener('click', refreshModelsAction);

  els.cleanupStorageBtn?.addEventListener('click', runCleanup);
  els.pollerEnabled?.addEventListener('change', onPollerToggle);
  els.pollerRunNow?.addEventListener('click', runPollerNow);

  els.clearAllBtn?.addEventListener('click', async () => {
    if (!confirm('Wirklich ALLE Daten löschen?')) return;
    await set({ inventory: [], ledger: [], inbox: { conversations: [], lastSync: 0 }, messages: {}, buyerProfiles: {}, bulkQueue: { state: 'idle', items: [], cooldownUntil: 0 } });
    await loadAll();
    if (v8UiReady) await V8UI.refreshInbox();
    toast('Alle Daten gelöscht.', 'success');
  });

  els.themeToggle?.addEventListener('click', async () => {
    const cur = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = cur === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    await set({ theme: next });
  });

  await V7.initV7UI({
    send, esc, toast, t,
    reload: loadAll,
    getItems: () => inventory,
    getActiveTab: () => activeTab,
    publishItem,
    publishFromGenerator: publishToMarketplace,
    reopenDrawer: (id) => { const it = inventory.find((x) => x.id === id); if (it) openDrawer(it); }
  });

  await V8UI.initV8UI({
    send, esc, toast, t,
    findItemForConversation: (conv) => {
      if (!conv) return null;
      const hay = `${conv.item || ''} ${conv.buyer || ''}`.toLowerCase();
      return inventory.find((x) => {
        const tx = (x.title || '').toLowerCase();
        return tx && hay && (tx.includes(hay.slice(0, 20)) || hay.includes(tx.slice(0, 20)));
      }) || null;
    }
  });
  v8UiReady = true;

  /* V9 — Analytics UI */
  await V9UI.initV9UI({
    esc,
    toast,
    t,
    getItems: () => inventory,
    openDrawer: (id) => {
      const it = inventory.find((x) => x.id === id);
      if (it) openDrawer(it);
    }
  });

  recalcPrice();
  updateModelHealth();
  await loadAll();
  switchTab('generator');

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.settings && els.killSwitchIndicator) {
      const s = changes.settings.newValue || {};
      els.killSwitchIndicator.style.color = s.killSwitch ? 'var(--danger)' : '';
    }
    if (changes.inventory) {
      inventory = changes.inventory.newValue || [];
      renderKPIs(); renderTable(); renderKanban();
      if (activeTab === 'analytics') V9UI.onAnalyticsTabActive();
    }
    if (changes.ledger && activeTab === 'analytics') {
      V9UI.onAnalyticsTabActive();
    }
    if (changes.settings || changes.priceRules || changes.platformCredentials || changes.ebayTokens) {
      V7.refreshV7State().then(() => { renderTable(); if (activeTab === 'config') V7.renderConfigV7(); });
    }
    if (changes.bulkQueue) V7.renderQueue();
    if (changes.inbox) {
      updateInboxBadge();
      if (v8UiReady && activeTab === 'inbox') V8UI.refreshInbox();
    }
  });
}

document.addEventListener('DOMContentLoaded', init);