/* Garlo AI Selling — modules/consent.js (v7)
   Two levels of consent:
     1) Base consent — one-time modal on first run (kept from V6, unchanged behavior).
     2) Per-feature consent — V7. Shown the first time a marketplace action for a
        risky feature (ebayApi / vinted / autoDelist) hits guard() and gets
        NO_FEATURE_CONSENT. See guard.js FEATURE_CONSENT map.

   Exports:
     checkConsent()                 — base consent, called from dashboard init
     requestFeatureConsent(key)     — show a modal, resolve true/false
     runWithConsent(fn)             — call fn(); on NO_FEATURE_CONSENT, prompt
                                      and retry once. Returns null if declined.

   SAFETY: modals are self-contained. If two V7 actions fire at once (rare),
   the second sees pendingConsent and waits for the first to resolve rather
   than opening a duplicate modal. */

import { t } from './i18n.js';
import { FEATURE_LABELS, grantFeatureConsent } from './guard.js';

/* ---------- base consent (kept from V6) ---------- */
let baseModalShown = false;

export async function checkConsent() {
  const data = await chrome.storage.local.get(['settings']);
  if (data.settings?.consent?.given) return;
  if (baseModalShown || document.getElementById('consentModal')) return;
  baseModalShown = true;
  showBaseModal();
}

function showBaseModal() {
  const modal = document.createElement('div');
  modal.id = 'consentModal';
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-content legal-modal">
      <h2 data-t="legal_consent_title">${t('legal_consent_title')}</h2>
      <p data-t="legal_consent_text">${t('legal_consent_text')}</p>
      <div class="modal-actions">
        <button id="acceptConsent" class="btn primary" data-t="legal_consent_btn">${t('legal_consent_btn')}</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  document.getElementById('acceptConsent').addEventListener('click', async () => {
    const data = await chrome.storage.local.get(['settings']);
    const settings = {
      ...(data.settings || {}),
      consent: { given: true, ts: Date.now() }
    };
    await chrome.storage.local.set({ settings });
    modal.remove();
  });
}

/* ---------- per-feature consent (V7) ---------- */
/* Description key per feature — resolved via t() in locales.js. */
const FEATURE_DESC_KEY = {
  ebayApi:    'consent_feature_ebayApi',
  vinted:     'consent_feature_vinted',
  autoDelist: 'consent_feature_autoDelist'
};

/* Shared state so two simultaneous guard denials don't open two modals. */
let pendingConsent = null;   // { key, promise }

export async function requestFeatureConsent(key) {
  if (!key) return true;

  /* Already granted → instant true. */
  const d = await chrome.storage.local.get(['settings']);
  if (d.settings?.consents?.[key]?.given) return true;

  /* A modal is already open. Wait for it, then re-check. */
  if (pendingConsent) {
    await pendingConsent.promise;
    const d2 = await chrome.storage.local.get(['settings']);
    return !!d2.settings?.consents?.[key]?.given;
  }

  const promise = new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.id = 'featureConsentModal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content legal-modal">
        <h2>${t('consent_feature_title')}</h2>
        <p><strong>${FEATURE_LABELS[key] || key}</strong></p>
        <p>${t(FEATURE_DESC_KEY[key] || 'consent_feature_generic')}</p>
        <div class="modal-actions">
          <button id="consentDecline" class="btn">${t('consent_decline')}</button>
          <button id="consentAccept" class="btn primary">${t('consent_accept')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const finish = (granted) => {
      modal.remove();
      pendingConsent = null;
      resolve(granted);
    };

    modal.querySelector('#consentAccept').addEventListener('click', async () => {
      try { await grantFeatureConsent(key); } catch { /* non-fatal */ }
      finish(true);
    });
    modal.querySelector('#consentDecline').addEventListener('click', () => finish(false));
  });

  pendingConsent = { key, promise };
  return promise;
}

/* ---------- run-with-consent wrapper ----------
   Usage in dashboard.js / v7-ui.js:
       const r = await runWithConsent(() => guard({ feature:'vinted', ... }));
       if (r === null) { toast(t('consent_declined'), 'warn'); return; }

   Only NO_FEATURE_CONSENT is intercepted. Every other GuardError
   (KILL_SWITCH, NO_CONSENT, RATE_LIMIT, LOCKOUT, CONFIRM_REQUIRED)
   propagates to the caller untouched. Retry happens AT MOST ONCE so a
   second denial cannot loop. */
export async function runWithConsent(fn) {
  try {
    return await fn();
  } catch (e) {
    if (e && e.code === 'NO_FEATURE_CONSENT' && e.feature) {
      const granted = await requestFeatureConsent(e.feature);
      if (!granted) return null;
      return await fn();
    }
    throw e;
  }
}