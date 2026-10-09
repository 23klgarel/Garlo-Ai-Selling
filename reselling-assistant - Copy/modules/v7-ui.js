/* Garlo AI Selling — modules/v7-ui.js (v8.0)
   All V7 dashboard UI in one module so dashboard.js only needs small hooks:
   banner + kill switch, queue tab, config sections (eBay API / price watcher /
   delist / consents / audit), drawer extensions, platform + stale badges.

   V8.0 fix: the eBay button injection block previously caused a duplicate
   "eBay.de" button to appear (from a cloneNode(false) that inherited the
   wrong ID and inserted the mode badge in the wrong position). Rewritten to
   build proper DOM nodes and insert them in the correct visual order. */

import { t } from './i18n.js';
import { getSettings, updateSettings, setKillSwitch, revokeFeatureConsent, getAudit, clearAudit, FEATURE_LABELS } from './guard.js';
import { requestFeatureConsent, runWithConsent } from './consent.js';
import * as EbayApi from './ebay-api.js';
import * as CrossDelist from './cross-delist.js';
import * as PriceWatcher from './price-watcher.js';
import * as Store from './inventory-store.js';
import { PLATFORMS } from './platforms.js';

let ctx = null;
let appSettings = {};
let priceRules = PriceWatcher.DEFAULT_RULES;
let apiStatus = { apiMode: false, env: 'sandbox', setup: {} };
const shownDelist = new Set();
const $ = (id) => document.getElementById(id);
const fmtS = (s, vars) => Object.entries(vars).reduce((a, [k, v]) => a.replace(`{${k}}`, v), s);

/* ============================ state ============================ */
export async function refreshV7State() {
  appSettings = await getSettings();
  priceRules = await PriceWatcher.getRules();
  try { apiStatus = await EbayApi.getApiStatus(); } catch { /* keep previous */ }
  renderBanner();
}
export function ebayModeLabel() {
  return apiStatus.apiMode
    ? fmtS(t('cfg_ebay_badge_api'), { env: apiStatus.env })
    : t('cfg_ebay_badge_form');
}
export const isEbayApiMode = () => !!apiStatus.apiMode;

function renderBanner() {
  const el = $('legalWarning');
  if (!el) return;
  el.removeAttribute('data-t');
  if (appSettings.killSwitch) {
    el.textContent = t('killswitch_active_banner');
    el.classList.add('kill');
    el.hidden = false;
  } else if (appSettings.consent?.given) {
    el.textContent = t('legal_warning_banner');
    el.classList.remove('kill');
    el.hidden = false;
  } else {
    el.hidden = true;
  }
  const ks = $('killSwitch');
  if (ks) ks.checked = !!appSettings.killSwitch;
  const inline = $('ebayModeInline');
  if (inline) {
    inline.textContent = ebayModeLabel();
    inline.className = 'mode-badge ' + (apiStatus.apiMode ? 'api' : 'form');
  }
}

/* ============================ badges ============================ */
export function platformBadgesHtml(item) {
  const e = ctx.esc;
  const out = Object.entries(item.publishedTo || {}).map(([p, v]) => {
    const mark = { live: ' ✓', pending: ' …', ended: ' ✕', sold: ' ✓$', 'delist-requested': ' ⌛' }[v.status] || ' ?';
    const label = e((PLATFORMS[p]?.short || p) + mark);
    const cls = `plat-badge plat-${e(v.status || 'unknown')}`;
    const title = e(t('plat_status_' + v.status) || v.status || '');
    return v.url
      ? `<a class="${cls}" href="${e(v.url)}" target="_blank" rel="noopener" title="${title}">${label}</a>`
      : `<span class="${cls}" title="${title}">${label}</span>`;
  });
  return out.join(' ') || '—';
}
export function staleBadgeHtml(item) {
  const s = PriceWatcher.staleInfo(item, priceRules);
  return s.stale
    ? `<span class="stale-badge" title="${ctx.esc(t('cfg_pw_title'))}">${ctx.esc(fmtS(t('badge_stale'), { d: s.ageDays }))}</span>`
    : '';
}

/* ============================ delist review ============================ */
export function maybeOpenDelistReview() {
  const item = ctx.getItems().find((x) =>
    x.needsDelistReview && !x.delistDismissed && !shownDelist.has(x.id)
  );
  if (!item) return;
  shownDelist.add(item.id);
  CrossDelist.openDelistModal(item, { toast: ctx.toast, onChange: ctx.reload });
}
export function openDelistFor(item) {
  shownDelist.add(item.id);
  CrossDelist.openDelistModal(item, { toast: ctx.toast, onChange: ctx.reload });
}

/* ============================ queue tab ============================ */
const QSTATUS = {
  pending: 'queue_pending',
  'in-progress': 'queue_in_progress',
  done: 'queue_done',
  failed: 'queue_failed'
};

export async function renderQueue() {
  const r = await ctx.send({ action: 'queueGet' });
  const q = r?.queue || { items: [], state: 'idle' };
  const open = q.items.filter((x) => x.status === 'pending' || x.status === 'in-progress').length;
  const nb = $('queueBadge');
  if (nb) { nb.textContent = open; nb.hidden = !open; }
  const list = $('queueList');
  if (!list) return;

  const cd = Math.max(0, Math.ceil(((q.cooldownUntil || 0) - Date.now()) / 1000));
  const summary = $('queueSummary');
  if (summary) {
    summary.textContent =
      `${q.state.toUpperCase()}` +
      (q.pausedReason && q.state === 'paused'
        ? ' — ' + fmtS(t('queue_paused_reason'), { r: q.pausedReason })
        : '') +
      (q.state === 'running' && cd
        ? ' · ' + fmtS(t('queue_cooldown'), { s: cd })
        : '');
  }

  if (!q.items.length) {
    list.innerHTML = `<div class="hint" style="padding:14px">${ctx.esc(t('queue_empty'))}</div>`;
    return;
  }
  const e = ctx.esc;
  list.innerHTML = q.items.map((x) => `
    <div class="queue-row" data-qid="${e(x.qid)}">
      <span class="qstatus qstatus-${e(x.status)}">${e(t(QSTATUS[x.status] || x.status))}</span>
      <div class="queue-main">
        <div class="queue-title">${e(x.title)} <span class="plat-badge">${e(PLATFORMS[x.platform]?.short || x.platform)}</span></div>
        <div class="hint">${x.status === 'in-progress' && x.stage === 'awaiting-submit' ? '✋ ' + e(t('queue_awaiting')) : ''}
          ${x.fillNote ? e(x.fillNote) : ''} ${x.error ? '<span style="color:var(--danger)">' + e(x.error) + '</span>' : ''}</div>
      </div>
      <div class="queue-actions">
        ${x.status === 'failed' ? `<button class="btn-mini" data-q="retry">${e(t('queue_retry'))}</button>` : ''}
        ${x.status === 'in-progress' || x.status === 'failed' ? `<button class="btn-mini" data-q="done">${e(t('queue_mark_done'))}</button>` : ''}
        ${x.status !== 'in-progress' ? `<button class="btn-mini" data-q="remove">${e(t('queue_remove'))}</button>` : ''}
      </div>
    </div>`).join('');
}

async function queueStartFlow() {
  let r = await ctx.send({ action: 'queueStart' });
  if (r?.code === 'NO_FEATURE_CONSENT' && r.feature) {
    if (!(await requestFeatureConsent(r.feature))) {
      ctx.toast(t('consent_declined'), 'warn');
      return;
    }
    r = await ctx.send({ action: 'queueStart' });
  }
  if (r?.error) ctx.toast(r.error, 'warn', 5000);
  await renderQueue();
}

function bindQueue() {
  $('queueAddReady')?.addEventListener('click', async () => {
    const ids = ctx.getItems().filter((x) => x.status === 'ready').map((x) => x.id);
    const r = await ctx.send({
      action: 'queueEnqueue',
      itemIds: ids,
      platform: $('queuePlatform').value
    });
    ctx.toast(`+${r?.added || 0} · ${r?.skipped || 0} übersprungen`, r?.added ? 'success' : 'warn');
    renderQueue();
  });
  $('queueStart')?.addEventListener('click', queueStartFlow);
  $('queuePause')?.addEventListener('click', async () => {
    await ctx.send({ action: 'queuePause' });
    renderQueue();
  });
  $('queueClear')?.addEventListener('click', async () => {
    await ctx.send({ action: 'queueClearFinished' });
    renderQueue();
  });
  $('queueList')?.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-q]');
    if (!b) return;
    const qid = b.closest('.queue-row').dataset.qid;
    const act = { retry: 'queueRetry', done: 'queueMarkDone', remove: 'queueRemove' }[b.dataset.q];
    await ctx.send({ action: act, qid });
    await ctx.reload();
    renderQueue();
  });
  setInterval(() => {
    if (ctx.getActiveTab() === 'queue') renderQueue();
  }, 2500);
}

/* ============================ drawer ============================ */
export function wireDrawerV7(item) {
  const e = ctx.esc;
  const host = $('drawerV7');
  if (!host) return;

  const platRows = Object.keys(PLATFORMS).map((p) => {
    const v = item.publishedTo?.[p] || {};
    return `<div class="plat-edit" data-p="${p}">
      <span class="plat-badge plat-${e(v.status || 'unknown')}">${e(PLATFORMS[p].short)}${v.status ? ' · ' + e(t('plat_status_' + v.status) || v.status) : ''}</span>
      <input type="url" class="plat-url" placeholder="${e(t('drawer_listing_url'))}" value="${e(v.url || '')}">
      <button class="btn-mini" data-act="live">${e(t('drawer_mark_live'))}</button>
    </div>`;
  }).join('');

  const r = item.priceRule || {};
  const pend = (item.priceDropPendingApply || []).map((p) => PLATFORMS[p]?.label || p).join(', ');
  const log = (item.priceLog || []).slice(0, 5).map((x) =>
    `<li>${new Date(x.ts).toLocaleDateString('de-DE')}: ${e(x.from)} → ${e(x.to)} € (−${e(x.percent)} %)</li>`
  ).join('');

  host.innerHTML = `
    <div class="drawer-field"><div class="drawer-label">${e(t('drawer_platforms'))}</div>${platRows}
      ${pend && item.status === 'listed' ? `<p class="hint" style="color:var(--warn)">${e(fmtS(t('drawer_apply_pending'), { p: pend }))}</p>` : ''}</div>
    <div class="drawer-field"><div class="drawer-label">${e(t('drawer_price_rule'))}</div>
      <div class="rule-row">
        <select id="drRuleMode">
          ${['inherit', 'on', 'off'].map((m) => `<option value="${m}" ${(r.mode || 'inherit') === m ? 'selected' : ''}>${e(t('drawer_rule_' + m))}</option>`).join('')}
        </select>
        <input id="drRuleDays" type="number" min="1" placeholder="${e(t('drawer_rule_days'))}" value="${e(r.days || '')}">
        <input id="drRulePct" type="number" min="1" max="90" placeholder="${e(t('drawer_rule_percent'))}" value="${e(r.percent || '')}">
        <button class="btn-mini" id="drRuleSave">${e(t('btn_save'))}</button>
      </div>
      ${log ? `<div class="drawer-label" style="margin-top:8px">${e(t('drawer_price_log'))}</div><ul class="hint">${log}</ul>` : ''}</div>
    ${(apiStatus.configured || apiStatus.apiMode) ? `<div class="drawer-field"><div class="drawer-label">${e(t('drawer_api_images'))}</div>
      <textarea id="drApiImages" rows="3" style="width:100%">${e((item.apiImageUrls || []).join('\n'))}</textarea>
      <button class="btn-mini" id="drApiImagesSave">${e(t('btn_save'))}</button></div>` : ''}`;

  host.querySelectorAll('.plat-edit').forEach((row) => {
    row.querySelector('[data-act="live"]')?.addEventListener('click', async () => {
      const url = row.querySelector('.plat-url').value.trim();
      await Store.markPublished(item.id, row.dataset.p, { url, status: 'live', source: 'manual' });
      ctx.toast(t('toast_saved'), 'success', 1500);
      await ctx.reload();
      ctx.reopenDrawer(item.id);
    });
  });
  $('drRuleSave')?.addEventListener('click', async () => {
    await Store.updateFields(item.id, {
      priceRule: {
        mode: $('drRuleMode').value,
        days: Number($('drRuleDays').value) || 0,
        percent: Number($('drRulePct').value) || 0
      }
    });
    ctx.toast(t('toast_saved'), 'success', 1500);
    await ctx.reload();
  });
  const imgSave = $('drApiImagesSave');
  if (imgSave) {
    imgSave.addEventListener('click', async () => {
      const urls = $('drApiImages').value.split('\n').map((x) => x.trim()).filter((x) => /^https:\/\//i.test(x));
      await Store.updateFields(item.id, { apiImageUrls: urls });
      ctx.toast(t('toast_saved'), 'success', 1500);
      await ctx.reload();
    });
  }

  /* Extra action buttons — inserted BEFORE the delete button */
  const actions = document.querySelector('#drawerBody .drawer-actions');
  if (!actions) return;
  const del = $('drawerDelete');
  const add = (id, label, fn) => {
    const b = document.createElement('button');
    b.id = id;
    b.className = 'btn-side';
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', fn);
    if (del) actions.insertBefore(b, del);
    else actions.appendChild(b);
  };

  add('drPubVinted', t('drawer_pub_vinted'), () => ctx.publishItem(item, 'vinted'));
  add('drQueueKa', t('drawer_queue_ka'), async () => {
    const r = await ctx.send({ action: 'queueEnqueue', itemIds: [item.id], platform: 'kleinanzeigen' });
    ctx.toast(r?.added ? '✓ Queue' : 'Übersprungen', r?.added ? 'success' : 'warn');
    renderQueue();
  });
  add('drQueueVinted', t('drawer_queue_vinted'), async () => {
    const r = await ctx.send({ action: 'queueEnqueue', itemIds: [item.id], platform: 'vinted' });
    ctx.toast(r?.added ? '✓ Queue' : 'Übersprungen', r?.added ? 'success' : 'warn');
    renderQueue();
  });
  if (Object.keys(item.publishedTo || {}).length) {
    add('drDelist', t('drawer_delist'), () => openDelistFor(item));
  }

  if (apiStatus.apiMode) {
    const apiRun = async (label, fn) => {
      try {
        const res = await runWithConsent(fn);
        if (res === null) ctx.toast(t('consent_declined'), 'warn');
        else ctx.toast(`eBay API: ${res.note || res.url || 'OK'}`, 'success', 6000);
      } catch (err) {
        ctx.toast(`eBay API: ${err.message}`, 'error', 9000);
      }
      await ctx.reload();
    };
    const fresh = () => Store.getItem(item.id);

    add('drApiCreate', t('drawer_ebay_api_create'), async () => {
      if (!confirm(`eBay (${apiStatus.env}): ${item.title}\n→ echtes Inserat erstellen?`)) return;
      apiRun('create', async () => EbayApi.createListing(await fresh(), { confirmed: true }));
    });

    if (item.publishedTo?.ebay?.offerId) {
      add('drApiUpdate', t('drawer_ebay_api_update'), async () => {
        if (!confirm('eBay-Inserat aktualisieren (Titel, Beschreibung, Preis)?')) return;
        apiRun('update', async () => {
          await EbayApi.updateListing(await fresh(), { confirmed: true });
          return { note: 'aktualisiert' };
        });
      });
      add('drApiEnd', t('drawer_ebay_api_end'), async () => {
        if (!confirm(fmtS(t('delist_confirm'), { p: 'eBay' }))) return;
        apiRun('end', async () => EbayApi.endListing(await fresh(), { confirmed: true }));
      });
    }
  }
}

/* ============================ config ============================ */
export async function renderConfigV7() {
  await refreshV7State();
  const c = await EbayApi.getCreds();

  const setVal = (id, v) => { const el = $(id); if (el) el.value = v; };
  setVal('ebayEnv', c.env || 'sandbox');
  setVal('ebayAppId', c.appId || '');
  setVal('ebayCertId', c.certId || '');
  setVal('ebayRuName', c.ruName || '');
  setVal('ebayDefaultCat', c.defaultCategoryId || '');
  setVal('ebayCondition', c.condition || 'NEW');
  setVal('ebayRedirectUri', EbayApi.getRedirectUri());

  const badge = $('ebayModeBadge');
  if (badge) {
    badge.textContent = ebayModeLabel();
    badge.className = 'mode-badge ' + (apiStatus.apiMode ? 'api' : 'form');
  }

  const st = apiStatus.setup || {};
  const ok = (b) => (b ? '✅' : '⬜');
  const checklist = $('ebayChecklist');
  if (checklist) {
    checklist.innerHTML = `
      <li>${ok(st.fulfillment && st.payment && st.returns)} ${ctx.esc(t('cfg_ebay_chk_policies'))}</li>
      <li>${ok(st.location)} ${ctx.esc(t('cfg_ebay_chk_location'))}</li>
      <li>⬜ ${ctx.esc(t('cfg_ebay_chk_ruame'))}</li>
      <li>⬜ ${ctx.esc(t('cfg_ebay_chk_images'))}</li>
      <li>${ok(apiStatus.consented)} Consent · ${ok(apiStatus.connected)} OAuth${apiStatus.refreshExpiresAt ? ' (bis ' + new Date(apiStatus.refreshExpiresAt).toLocaleDateString('de-DE') + ')' : ''}</li>`;
  }

  const pwEn = $('pwEnabled'); if (pwEn) pwEn.checked = !!priceRules.enabled;
  const pwD = $('pwDays'); if (pwD) pwD.value = priceRules.days;
  const pwP = $('pwPercent'); if (pwP) pwP.value = priceRules.percent;
  const pwF = $('pwFloor'); if (pwF) pwF.checked = priceRules.floor !== false;

  const ws = (await chrome.storage.local.get(['priceWatchState'])).priceWatchState;
  const pwLast = $('pwLast');
  if (pwLast) {
    pwLast.textContent = ws
      ? `${new Date(ws.ts).toLocaleString('de-DE')} · geprüft ${ws.checked}, gesenkt ${ws.dropped}, an Untergrenze ${ws.atFloor}, ohne EK ${ws.noEk}`
      : '—';
  }

  const dl = $('delistLive'); if (dl) dl.checked = !!appSettings.delistLive;

  const consentsEl = $('consentsList');
  if (consentsEl) {
    consentsEl.innerHTML = Object.keys(FEATURE_LABELS).map((k) => {
      const given = !!appSettings.consents?.[k]?.given;
      return `<div class="plat-edit"><span>${ctx.esc(FEATURE_LABELS[k])}: <strong>${ctx.esc(given ? t('cfg_consent_given') : t('cfg_consent_missing'))}</strong></span>
        <button class="btn-mini" data-consent="${k}" data-given="${given ? 1 : 0}">${ctx.esc(given ? t('cfg_consent_revoke') : t('cfg_consent_grant'))}</button></div>`;
    }).join('');
  }
  await renderAudit();
}

async function renderAudit() {
  const log = await getAudit(50);
  const el = $('auditList');
  if (!el) return;
  el.innerHTML = log.length
    ? log.map((x) => `
        <div class="audit-row">
          <span>${new Date(x.ts).toLocaleString('de-DE')}</span>
          <span>${ctx.esc([x.feature, x.op, x.platform].filter(Boolean).join(' / '))}</span>
          <span class="audit-${/denied/.test(x.outcome || '') ? 'bad' : 'ok'}">${ctx.esc(x.outcome || '')}</span>
          <span>${ctx.esc((x.detail || '').slice(0, 120))}</span>
        </div>`).join('')
    : `<div class="hint">${ctx.esc(t('cfg_audit_empty'))}</div>`;
}

async function saveEbayFields() {
  await EbayApi.saveCreds({
    env: $('ebayEnv').value,
    appId: $('ebayAppId').value.trim(),
    certId: $('ebayCertId').value.trim(),
    ruName: $('ebayRuName').value.trim(),
    defaultCategoryId: $('ebayDefaultCat').value.trim(),
    condition: $('ebayCondition').value
  });
}

const ebayErr = (m) => { const el = $('ebayErr'); if (el) el.textContent = m || ''; };

function bindConfig() {
  $('killSwitch')?.addEventListener('change', async (ev) => {
    const on = ev.target.checked;
    if (!on && !confirm(t('killswitch_off_confirm'))) { ev.target.checked = true; return; }
    await setKillSwitch(on, 'config-toggle');
    await refreshV7State();
    ctx.toast(on ? '🚨 Kill-Switch AN' : 'Kill-Switch aus', on ? 'warn' : 'success');
  });

  $('ebaySaveBtn')?.addEventListener('click', async () => {
    await saveEbayFields();
    ebayErr('');
    ctx.toast(t('toast_saved'), 'success');
    await renderConfigV7();
  });
  $('ebayConnectBtn')?.addEventListener('click', async () => {
    ebayErr('');
    try {
      await saveEbayFields();
      const r = await runWithConsent(() => EbayApi.connect());
      if (r === null) ctx.toast(t('consent_declined'), 'warn');
      else ctx.toast('eBay verbunden.', 'success');
    } catch (e) { ebayErr(e.message); }
    await renderConfigV7();
  });
  $('ebayDisconnectBtn')?.addEventListener('click', async () => {
    await EbayApi.disconnect();
    await renderConfigV7();
  });
  $('ebayCheckBtn')?.addEventListener('click', async () => {
    ebayErr('');
    try {
      const r = await runWithConsent(() => EbayApi.checkSetup());
      if (r && r.errors?.length) ebayErr(r.errors.join('\n'));
    } catch (e) { ebayErr(e.message); }
    await renderConfigV7();
  });

  $('pwSaveBtn')?.addEventListener('click', async () => {
    await PriceWatcher.saveRules({
      enabled: $('pwEnabled').checked,
      floor: $('pwFloor').checked,
      days: Math.max(1, Number($('pwDays').value) || 14),
      percent: Math.min(90, Math.max(1, Number($('pwPercent').value) || 10))
    });
    await refreshV7State();
    ctx.toast(t('toast_saved'), 'success');
    ctx.reload();
  });
  $('pwRunBtn')?.addEventListener('click', async () => {
    const r = await ctx.send({ action: 'priceWatcherRun', reason: 'manual' });
    const s = r?.summary || {};
    ctx.toast(
      s.skipped
        ? `Übersprungen: ${s.skipped}`
        : `Geprüft ${s.checked}, gesenkt ${s.dropped}`,
      s.skipped ? 'warn' : 'success'
    );
    await ctx.reload();
    renderConfigV7();
  });

  $('delistLive')?.addEventListener('change', async (ev) => {
    if (ev.target.checked && !confirm(t('cfg_delist_live_confirm'))) {
      ev.target.checked = false;
      return;
    }
    await updateSettings({ delistLive: ev.target.checked });
    await refreshV7State();
  });

  $('consentsList')?.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-consent]');
    if (!b) return;
    if (b.dataset.given === '1') await revokeFeatureConsent(b.dataset.consent);
    else await requestFeatureConsent(b.dataset.consent);
    renderConfigV7();
  });

  $('auditRefreshBtn')?.addEventListener('click', renderAudit);
  $('auditClearBtn')?.addEventListener('click', async () => {
    if (confirm('Audit-Log leeren?')) {
      await clearAudit();
      renderAudit();
    }
  });
  $('auditExportBtn')?.addEventListener('click', async () => {
    const blob = new Blob([JSON.stringify(await getAudit(1000), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `garlo-audit-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
}

/* ============================ init ============================ */
/* ctx = {
     send, esc, toast, t,
     reload, getItems, getActiveTab,
     publishItem(item, platform),
     publishFromGenerator(platform),
     reopenDrawer(id)
   } */
export async function initV7UI(context) {
  ctx = context;
  await refreshV7State();
  bindQueue();
  bindConfig();

  /* ------------------------------------------------------------
     V8.0 FIX: eBay mode badge + Vinted button injection.
     Previously this used `eb.cloneNode(false)` which produced a
     duplicate "eBay.de" button. Now we build proper DOM nodes and
     place them after the KA/eBay grid so they don't break the
     two-column layout.
     ------------------------------------------------------------ */
  const eb = $('publishEbayBtn');
  if (eb && !$('ebayModeInline')) {
    const grid = eb.closest('.grid-2');
    const anchor = grid || eb;

    /* Mode badge (form-fill vs API) — sits below the [KA][eBay] row */
    const badge = document.createElement('div');
    badge.id = 'ebayModeInline';
    badge.className = 'mode-badge form';
    badge.style.marginTop = '10px';
    badge.style.textAlign = 'center';
    anchor.insertAdjacentElement('afterend', badge);

    /* Vinted publish button — full width, sits below the badge */
    const vintedBtn = document.createElement('button');
    vintedBtn.id = 'publishVintedBtn';
    vintedBtn.type = 'button';
    vintedBtn.className = 'btn-side';
    vintedBtn.style.marginTop = '8px';
    vintedBtn.style.width = '100%';
    vintedBtn.textContent = '📢 Vinted';
    vintedBtn.addEventListener('click', () => {
      if (typeof ctx.publishFromGenerator === 'function') {
        ctx.publishFromGenerator('vinted');
      }
    });
    badge.insertAdjacentElement('afterend', vintedBtn);

    renderBanner();
  }

  /* Catch-up run for the price watcher (idempotent). Fire and forget. */
  ctx.send({ action: 'priceWatcherRun', reason: 'dashboard-open' }).catch(() => {});
}