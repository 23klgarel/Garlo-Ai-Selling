/* Garlo AI Selling — modules/guard.js (v9.0)  ★ PERMANENT SHARED SERVICE ★

   CONTRACT FOR ALL VERSIONS (V9 → V10+):
   Every marketplace-facing action MUST call guard() BEFORE acting.
   Order enforced: kill switch → base consent → per-feature consent →
   explicit confirmation → rate limit → dry-run → audit.

   V9 CHANGES:
     • Unknown features now default to null consent (not bypass)
     • New features registered: inboxSync, chatAssist, imageFetch, backup
     • Audit detail strings capped at 200 chars
     • Audit log capped at 800 entries (was 1000)
     • audit() sanitizes entry fields (no more raw objects)

   Works in service worker AND extension pages (no DOM access). */

import { checkRateLimit, logAction } from './rate-limiter.js';

export const GUARD_API_VERSION = 2;

/* feature → required consent key (null = base consent only).
   V9: every feature the codebase uses must appear here explicitly.
   Unknown features resolve to null → base consent is still required. */
const FEATURE_CONSENT = {
  /* Existing V7/V8 features */
  scrape: null,
  formfill: null,
  bulkQueue: null,
  priceWatcher: null,
  ebayApi: 'ebayApi',
  autoDelist: 'autoDelist',
  vinted: 'vinted',
  /* V9 explicit registrations */
  inboxSync: null,
  chatAssist: null,
  imageFetch: null,
  backup: null,
  publishComplete: null
};

/* platform → additional consent key */
const PLATFORM_CONSENT = { vinted: 'vinted' };

export const FEATURE_LABELS = {
  ebayApi: 'eBay API-Zugriff',
  vinted: 'Vinted-Automatisierung',
  autoDelist: 'Auto-Delist'
};

/* Future versions: registerFeature('chatAutomation', { consent: 'chat', label: 'Chat-Automation' }) */
export function registerFeature(name, { consent = null, label } = {}) {
  FEATURE_CONSENT[name] = consent;
  if (consent && label) FEATURE_LABELS[consent] = label;
}

export class GuardError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'GuardError';
    this.code = code;
    Object.assign(this, extra);
  }
}

/* ---------- settings (serialized read-modify-write) ---------- */
let settingsChain = Promise.resolve();

export async function getSettings() {
  const d = await chrome.storage.local.get(['settings']);
  return d.settings || {};
}

export function updateSettings(patch) {
  const run = settingsChain.then(async () => {
    const cur = await getSettings();
    const next = { ...cur, ...patch };
    if (patch.consents) next.consents = { ...(cur.consents || {}), ...patch.consents };
    await chrome.storage.local.set({ settings: next });
    return next;
  });
  settingsChain = run.catch(() => {});
  return run;
}

export async function isKilled() { return !!(await getSettings()).killSwitch; }

export async function setKillSwitch(on, source = 'ui') {
  await updateSettings({ killSwitch: !!on, killSwitchTs: Date.now() });
  await audit({ feature: 'killSwitch', op: on ? 'enable' : 'disable', outcome: 'recorded', detail: source });
}

export async function hasFeatureConsent(key) {
  return !!(await getSettings()).consents?.[key]?.given;
}
export async function grantFeatureConsent(key) {
  await updateSettings({ consents: { [key]: { given: true, ts: Date.now() } } });
  await audit({ feature: 'consent', op: 'grant', outcome: 'recorded', detail: key });
}
export async function revokeFeatureConsent(key) {
  await updateSettings({ consents: { [key]: { given: false, ts: Date.now() } } });
  await audit({ feature: 'consent', op: 'revoke', outcome: 'recorded', detail: key });
}

/* ---------- audit log ---------- */
const AUDIT_DETAIL_MAX = 200;
const AUDIT_MAX = 800;

let auditChain = Promise.resolve();

function safeField(v, max = 80) {
  if (v == null) return '';
  const s = typeof v === 'string' ? v : String(v);
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

export function audit(entry) {
  const run = auditChain.then(async () => {
    const d = await chrome.storage.local.get(['auditLog']);
    const log = Array.isArray(d.auditLog) ? d.auditLog : [];
    const clean = {
      ts: Date.now(),
      feature: safeField(entry.feature, 40),
      platform: safeField(entry.platform, 40),
      op: safeField(entry.op, 60),
      itemId: safeField(entry.itemId, 60),
      outcome: safeField(entry.outcome, 60),
      detail: safeField(entry.detail, AUDIT_DETAIL_MAX)
    };
    log.unshift(clean);
    await chrome.storage.local.set({ auditLog: log.slice(0, AUDIT_MAX) });
  });
  auditChain = run.catch(() => {});
  return run.catch(() => {});
}

export async function getAudit(n = 100) {
  const d = await chrome.storage.local.get(['auditLog']);
  const arr = Array.isArray(d.auditLog) ? d.auditLog : [];
  return arr.slice(0, Math.max(1, Math.min(n, AUDIT_MAX)));
}
export async function clearAudit() {
  await chrome.storage.local.set({ auditLog: [] });
}

/* ---------- the gate ----------
   action = {
     feature, platform, host, rate, op, itemId, detail,
     needs: [], requireConfirm, destructive, confirmed,
     deterministic, forceDryRun, audit, auditDenied
   }
   Returns { ok:true, dryRun, settings } or throws GuardError. */
export async function guard(a) {
  const s = await getSettings();
  const host = a.host || a.platform;

  const deny = async (code, message, extra = {}, quiet = false) => {
    if (a.auditDenied !== false && !quiet) {
      await audit({
        feature: a.feature, platform: a.platform, op: a.op,
        itemId: a.itemId, outcome: 'denied:' + code, detail: message
      });
    }
    throw new GuardError(code, message, extra);
  };

  if (s.killSwitch) return deny('KILL_SWITCH', 'Kill-Switch aktiv — alle Automatisierungen sind gestoppt.');
  if (!s.consent?.given) return deny('NO_CONSENT', 'Einwilligung fehlt (Dashboard öffnen und bestätigen).');

  /* V9: unknown features resolve to null, so they only require base consent.
     Explicit registrations in FEATURE_CONSENT take precedence. */
  const featureConsent = Object.prototype.hasOwnProperty.call(FEATURE_CONSENT, a.feature)
    ? FEATURE_CONSENT[a.feature]
    : null;

  const platformConsent = PLATFORM_CONSENT[a.platform];

  const needed = new Set([featureConsent, platformConsent, ...(a.needs || [])].filter(Boolean));
  for (const c of needed) {
    if (!s.consents?.[c]?.given) {
      return deny('NO_FEATURE_CONSENT', `Separate Einwilligung erforderlich: ${FEATURE_LABELS[c] || c}.`, { feature: c });
    }
  }

  if ((a.destructive || a.requireConfirm) && !a.confirmed) {
    return deny('CONFIRM_REQUIRED', 'Explizite Bestätigung erforderlich.');
  }

  if (a.rate) {
    try { await checkRateLimit(host, a.rate); }
    catch (e) {
      const code = e.code || (/^LOCKOUT/.test(e.message) ? 'LOCKOUT' : 'RATE_LIMIT');
      return deny(code, e.message, { waitMs: e.waitMs }, code === 'RATE_LIMIT');
    }
    await logAction(host, a.rate);
  }

  const dryRun = a.destructive
    ? !!a.forceDryRun || !(a.confirmed && (a.deterministic || s.delistLive))
    : false;

  if (a.audit !== false) {
    await audit({
      feature: a.feature, platform: a.platform, op: a.op, itemId: a.itemId,
      outcome: dryRun ? 'allowed-dry-run' : 'allowed', detail: a.detail
    });
  }
  return { ok: true, dryRun, settings: s };
}

export async function guardSafe(a) {
  try { return await guard(a); }
  catch (e) {
    if (e instanceof GuardError) return { ok: false, code: e.code, message: e.message, waitMs: e.waitMs, feature: e.feature };
    throw e;
  }
}