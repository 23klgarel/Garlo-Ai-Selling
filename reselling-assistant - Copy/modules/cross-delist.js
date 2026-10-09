/* Garlo AI Selling — modules/cross-delist.js (v7)
   When an item is marked SOLD: offer to end its other live listings.
   SAFEGUARDS: per-item, per-platform confirmation · separate 'autoDelist' consent (+ 'vinted'
   for Vinted) · DRY-RUN by default (navigate + highlight, no click) · LIVE mode only after it
   was enabled in Config AND a second confirm() at click time · the site's OWN confirmation
   dialog is never clicked by us · eBay API mode can end deterministically (still confirmed
   per item) · kill switch aborts · every action audited.
   Kleinanzeigen/Vinted are ASSISTED (DOM locate + optional click) and PARTIAL: selectors are
   text-based best-effort and may need the user to finish manually. */

import { guard } from './guard.js';
import * as Store from './inventory-store.js';
import * as EbayApi from './ebay-api.js';
import { PLATFORMS, ONLINE_STATUSES } from './platforms.js';
import { waitForComplete, injectContent, sendWithRetry } from './tab-utils.js';
import { runWithConsent } from './consent.js';
import { t } from './i18n.js';

export function getDelistTargets(item, soldOn) {
  return Object.entries(item.publishedTo || {})
    .filter(([p, v]) => p !== soldOn && ONLINE_STATUSES.has(v.status))
    .map(([platform, v]) => ({ platform, url: v.url || '', status: v.status, offerId: v.offerId || null }));
}

/* One platform. Returns { dryRun, found?, clicked?, note }. Throws GuardError/EbayError. */
export async function delistOne(item, platform, { confirmed, forceDryRun } = {}) {
  const apiStatus = platform === 'ebay' ? await EbayApi.getApiStatus() : null;
  if (platform === 'ebay' && apiStatus?.apiMode && item.publishedTo?.ebay?.offerId) {
    return EbayApi.endListing(item, { confirmed, forceDryRun });
  }

  const p = PLATFORMS[platform];
  const g = await guard({
    feature: 'autoDelist', platform, host: p.rateHost, rate: 'delist', op: 'assisted-delist', itemId: item.id,
    destructive: true, confirmed, forceDryRun
  });

  const url = item.publishedTo?.[platform]?.url || '';
  const target = platform === 'vinted' && url ? url : p.manageUrl;
  const tab = await chrome.tabs.create({ url: target, active: true });
  await waitForComplete(tab.id, 20000);
  try { await injectContent(tab.id, platform); } catch { /* retried below */ }
  const resp = await sendWithRetry(tab.id, { action: 'delistAssist', platform, listingUrl: url, live: !g.dryRun }, { platform, tries: 5, delay: 1200 });
  if (resp?.killed) throw new Error(resp.error);

  if (!g.dryRun && resp?.clicked) await Store.setPlatformState(item.id, platform, { status: 'delist-requested', ts: Date.now() });
  return { dryRun: g.dryRun, found: !!resp?.found, clicked: !!resp?.clicked, note: resp?.note || resp?.error || '' };
}

/* ---------- modal (dashboard only) ---------- */
export async function openDelistModal(item, { toast = () => {}, onChange = () => {} } = {}) {
  const settings = (await chrome.storage.local.get(['settings'])).settings || {};
  const liveEnabled = !!settings.delistLive;
  let soldOn = item.soldOn || item.platform || '';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-content" style="max-width:640px">
      <h2>${esc(t('delist_title'))}</h2>
      <p>${esc(t('delist_intro'))}</p>
      <p><strong>${esc(item.title || '')}</strong></p>
      <div class="field"><label class="label">${esc(t('delist_sold_on'))}</label>
        <select id="dlSoldOn"></select></div>
      <div id="dlRows"></div>
      <p class="hint">${esc(liveEnabled ? t('delist_live_on') : t('delist_live_off'))}</p>
      <div class="modal-actions">
        <button class="btn-side" id="dlDismiss">${esc(t('delist_dismiss'))}</button>
        <button class="btn-side primary" id="dlClose">${esc(t('btn_close'))}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();

  const sel = overlay.querySelector('#dlSoldOn');
  const platforms = Object.keys(PLATFORMS);
  sel.innerHTML = platforms.map((p) => `<option value="${p}" ${p === soldOn ? 'selected' : ''}>${esc(PLATFORMS[p].label)}</option>`).join('') +
    `<option value="" ${!soldOn ? 'selected' : ''}>${esc(t('delist_sold_other'))}</option>`;

  async function run(platform, mode, btn) {
    if (mode === 'live' && !confirm(t('delist_confirm').replace('{p}', PLATFORMS[platform].label))) return;
    btn.disabled = true;
    try {
      const fresh = await Store.getItem(item.id);
      const r = await runWithConsent(() => delistOne(fresh, platform, { confirmed: true, forceDryRun: mode === 'dry' }));
      if (r === null) { toast(t('consent_declined'), 'warn'); }
      else toast(`${PLATFORMS[platform].label}: ${r.note || (r.dryRun ? 'Dry-Run' : 'OK')}`, r.found === false ? 'warn' : 'success', 6000);
      await onChange();
    } catch (e) { toast(`${PLATFORMS[platform].label}: ${e.message}`, 'error', 7000); }
    btn.disabled = false;
    render();
  }

  async function render() {
    const fresh = (await Store.getItem(item.id)) || item;
    const rows = overlay.querySelector('#dlRows');
    const targets = getDelistTargets(fresh, soldOn);
    if (!targets.length) { rows.innerHTML = `<p class="hint">${esc(t('delist_none'))}</p>`; return; }
    rows.innerHTML = targets.map((x) => `
      <div class="dl-row" data-p="${x.platform}">
        <div><strong>${esc(PLATFORMS[x.platform].label)}</strong> <span class="plat-badge plat-${esc(x.status)}">${esc(x.status)}</span><br>
          ${x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.url)}</a>` : `<span class="hint">${esc(t('delist_no_url'))}</span>`}</div>
        <div class="dl-actions">
          <button class="btn-side" data-act="dry">${esc(t('delist_dry'))}</button>
          <button class="btn-side danger" data-act="live" ${liveEnabled ? '' : 'disabled'}>${esc(t('delist_live'))}</button>
          <button class="btn-side" data-act="ended">${esc(t('delist_mark_ended'))}</button>
        </div>
      </div>`).join('');
    rows.querySelectorAll('.dl-row').forEach((row) => {
      const platform = row.dataset.p;
      row.querySelector('[data-act="dry"]').addEventListener('click', (e) => run(platform, 'dry', e.currentTarget));
      row.querySelector('[data-act="live"]').addEventListener('click', (e) => run(platform, 'live', e.currentTarget));
      row.querySelector('[data-act="ended"]').addEventListener('click', async () => {
        await Store.setPlatformState(item.id, platform, { status: 'ended', endedAt: Date.now() });
        await onChange(); render();
      });
    });
  }

  sel.addEventListener('change', () => { soldOn = sel.value; render(); });
  overlay.querySelector('#dlClose').addEventListener('click', close);
  overlay.querySelector('#dlDismiss').addEventListener('click', async () => {
    await Store.updateFields(item.id, { needsDelistReview: false, delistDismissed: true });
    await onChange(); close();
  });
  await render();
}
