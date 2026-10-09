/* Garlo AI Selling — modules/ebay-api.js (v7)  ⚠ SCAFFOLD — REQUIRES USER TESTING
   eBay REST (Sell Inventory / Account / Fulfillment) via OAuth 2.0 authorization-code flow.
   Written from eBay's public docs; NEVER executed against eBay's servers by the author.
   Use the SANDBOX environment first (default). Form-fill remains the fallback in the UI.

   SECURITY MODEL: App ID, Cert ID (client secret) and tokens are stored in plain
   chrome.storage.local ("local-trust model"). Anyone with access to the browser profile
   can read them. Access tokens last ~2 h; refresh tokens ~18 months.

   Every operation goes through guard() (kill switch, separate 'ebayApi' consent, rate limit,
   audit). HTTP 429 → 24 h lockout of host 'ebay-api'. HTTP 403 is NOT treated as a lockout
   here (on eBay it normally means missing scope/permission) — deviation from V6 host rule. */

import { guard, audit } from './guard.js';
import { handleHostError } from './rate-limiter.js';
import * as Store from './inventory-store.js';
import { recordSale } from './tone-tracking.js';

const CRED_KEY = 'platformCredentials';
const TOKEN_KEY = 'ebayTokens';
const POLL_KEY = 'ebayOrderPoll';
const MARKETPLACE = 'EBAY_DE';
const HOST = 'ebay-api';

const ENV = {
  production: { auth: 'https://auth.ebay.com/oauth2/authorize', api: 'https://api.ebay.com', web: 'https://www.ebay.de' },
  sandbox:    { auth: 'https://auth.sandbox.ebay.com/oauth2/authorize', api: 'https://api.sandbox.ebay.com', web: 'https://www.sandbox.ebay.de' }
};
const SCOPES = [
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
  'https://api.ebay.com/oauth/api_scope/sell.account',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment'
];
const APP_SCOPE = 'https://api.ebay.com/oauth/api_scope';

export class EbayError extends Error {
  constructor(code, message, extra = {}) { super(message); this.name = 'EbayError'; this.code = code; Object.assign(this, extra); }
}

/* ---------- credentials / tokens ---------- */
export async function getCreds() {
  const d = await chrome.storage.local.get([CRED_KEY]);
  return { env: 'sandbox', condition: 'NEW', ...(d[CRED_KEY]?.ebay || {}) };
}
export async function saveCreds(patch) {
  const d = await chrome.storage.local.get([CRED_KEY]);
  const all = d[CRED_KEY] || {};
  const ebay = { ...(all.ebay || {}), ...patch };
  await chrome.storage.local.set({ [CRED_KEY]: { ...all, ebay } });
  return ebay;
}
const isConfigured = (c) => !!(c.appId && c.certId && c.ruName);
const envOf = (c) => ENV[c.env] || ENV.sandbox;
const basic = (c) => 'Basic ' + btoa(`${c.appId}:${c.certId}`);

async function getTokens() { return (await chrome.storage.local.get([TOKEN_KEY]))[TOKEN_KEY] || null; }

export async function getApiStatus() {
  const [c, t, d] = await Promise.all([getCreds(), getTokens(), chrome.storage.local.get(['settings'])]);
  const s = d.settings || {};
  const configured = isConfigured(c);
  const connected = !!(t?.refreshToken && t.env === c.env && (!t.refreshExpiresAt || t.refreshExpiresAt > Date.now()));
  const consented = !!s.consents?.ebayApi?.given;
  const setup = { fulfillment: !!c.fulfillmentPolicyId, payment: !!c.paymentPolicyId, returns: !!c.returnPolicyId, location: !!c.merchantLocationKey };
  return {
    configured, connected, consented, env: c.env, setup,
    setupComplete: Object.values(setup).every(Boolean),
    refreshExpiresAt: t?.refreshExpiresAt || 0,
    killed: !!s.killSwitch,
    apiMode: configured && connected && consented && !s.killSwitch
  };
}

export function getRedirectUri() { return chrome.identity.getRedirectURL(); }

async function tokenRequest(form, c) {
  const res = await fetch(`${envOf(c).api}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basic(c) },
    body: new URLSearchParams(form).toString()
  });
  let j = {};
  try { j = await res.json(); } catch { /* ignore */ }
  if (!res.ok) {
    if (res.status === 429) await handleHostError(HOST, 429);
    throw new EbayError('TOKEN_ERROR', `[${res.status}] ${j.error_description || j.error || res.statusText}`, { status: res.status });
  }
  return j;
}

async function storeTokens(j, c, prev) {
  const now = Date.now();
  const t = {
    env: c.env,
    accessToken: j.access_token,
    accessExpiresAt: now + (Number(j.expires_in) || 7200) * 1000,
    refreshToken: j.refresh_token || prev?.refreshToken,
    refreshExpiresAt: j.refresh_token_expires_in ? now + Number(j.refresh_token_expires_in) * 1000 : (prev?.refreshExpiresAt || 0),
    scope: SCOPES.join(' '), obtainedAt: now
  };
  await chrome.storage.local.set({ [TOKEN_KEY]: t });
  return t;
}

/* Must run in an extension page or the service worker with an interactive window. */
export async function connect() {
  await guard({ feature: 'ebayApi', platform: 'ebay', host: HOST, rate: 'auth', op: 'oauth-connect' });
  const c = await getCreds();
  if (!isConfigured(c)) throw new EbayError('NOT_CONFIGURED', 'App ID, Cert ID und RuName eintragen.');
  const state = crypto.randomUUID();
  const url = `${envOf(c).auth}?client_id=${encodeURIComponent(c.appId)}&redirect_uri=${encodeURIComponent(c.ruName)}` +
    `&response_type=code&scope=${encodeURIComponent(SCOPES.join(' '))}&state=${state}`;
  const redirect = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
  const u = new URL(redirect);
  if (u.searchParams.get('state') !== state) throw new EbayError('STATE_MISMATCH', 'OAuth-State stimmt nicht überein — abgebrochen.');
  const code = u.searchParams.get('code');
  if (!code) throw new EbayError('NO_CODE', u.searchParams.get('error_description') || 'eBay hat keinen Code geliefert.');
  const j = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: c.ruName }, c);
  await storeTokens(j, c, null);
  await audit({ feature: 'ebayApi', platform: 'ebay', op: 'oauth-connect', outcome: 'connected', detail: c.env });
  return getApiStatus();
}

export async function disconnect() {
  await chrome.storage.local.remove([TOKEN_KEY]);
  await audit({ feature: 'ebayApi', platform: 'ebay', op: 'oauth-disconnect', outcome: 'recorded' });
}

let refreshing = null;
async function accessToken(force = false) {
  const [c, t] = await Promise.all([getCreds(), getTokens()]);
  if (!t?.refreshToken || t.env !== c.env) throw new EbayError('NOT_CONNECTED', 'eBay nicht verbunden.');
  if (!force && t.accessToken && t.accessExpiresAt - Date.now() > 60000) return t.accessToken;
  if (t.refreshExpiresAt && Date.now() >= t.refreshExpiresAt) throw new EbayError('REAUTH_REQUIRED', 'Refresh-Token abgelaufen (18 Monate) — neu verbinden.');
  if (!refreshing) {
    refreshing = (async () => {
      const j = await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refreshToken, scope: SCOPES.join(' ') }, c);
      return (await storeTokens(j, c, t)).accessToken;
    })().finally(() => { refreshing = null; });
  }
  return refreshing;
}

let appTok = { token: '', exp: 0 };
async function applicationToken(c) {
  if (appTok.token && appTok.exp - Date.now() > 60000) return appTok.token;
  const j = await tokenRequest({ grant_type: 'client_credentials', scope: APP_SCOPE }, c);
  appTok = { token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 7200) * 1000 };
  return appTok.token;
}

/* ---------- HTTP ---------- */
async function api(path, { method = 'GET', body, token, retry = true } = {}) {
  const c = await getCreds();
  const tok = token || await accessToken();
  const res = await fetch(envOf(c).api + path, {
    method,
    headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json', Accept: 'application/json', 'Content-Language': 'de-DE' },
    body: body ? JSON.stringify(body) : undefined
  });
  if (res.status === 401 && retry && !token) { await accessToken(true); return api(path, { method, body, retry: false }); }
  if (res.status === 204) return {};
  let j = {};
  try { j = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    if (res.status === 429) await handleHostError(HOST, 429);
    const msgs = (j.errors || []).map((e) => `${e.errorId}: ${e.message}${e.longMessage ? ' — ' + e.longMessage : ''}`).join(' | ');
    throw new EbayError('HTTP_' + res.status, `[${res.status}] ${msgs || res.statusText}`, { status: res.status, errors: j.errors });
  }
  return j;
}

/* ---------- helpers ---------- */
const num = (s) => parseFloat(String(s ?? '').replace(/\s/g, '').replace(/[^\d.,-]/g, '').replace(',', '.'));
export const skuFor = (item) => ('GARLO' + String(item.id).replace(/[^A-Za-z0-9]/g, '')).slice(0, 50);
const htmlEsc = (t) => String(t || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])).replace(/\n/g, '<br>');
const listingUrl = (c, listingId) => `${envOf(c).web}/itm/${listingId}`;

function imagesFor(item) {
  const urls = (item.apiImageUrls?.length ? item.apiImageUrls : item.sourceImages || []).filter((u) => /^https:\/\//i.test(u)).slice(0, 12);
  if (!urls.length) throw new EbayError('NO_IMAGES', 'Keine öffentlichen https-Bild-URLs. Im Drawer „Bild-URLs (eBay API)“ eintragen — Data-URLs/Cache-Bilder funktionieren mit der API nicht.');
  return urls;
}
function requireSetup(c) {
  const miss = [['fulfillmentPolicyId', 'Versand-Policy'], ['paymentPolicyId', 'Zahlungs-Policy'], ['returnPolicyId', 'Rückgabe-Policy'], ['merchantLocationKey', 'Lagerort']].filter(([k]) => !c[k]).map(([, l]) => l);
  if (miss.length) throw new EbayError('SETUP_INCOMPLETE', 'eBay-Setup unvollständig: ' + miss.join(', ') + ' (Config → „Setup prüfen“).');
}
function inventoryItemBody(item, c) {
  const brand = item.sourceBrand || '';
  return {
    product: {
      title: String(item.title || '').slice(0, 80),
      description: htmlEsc(item.description),
      imageUrls: imagesFor(item),
      ...(brand ? { aspects: { Marke: [brand] } } : {})
    },
    condition: item.ebayCondition || c.condition || 'NEW',
    availability: { shipToLocationAvailability: { quantity: 1 } }
  };
}
function offerBody(item, c, categoryId) {
  const price = num(item.targetPrice || item.price);
  if (!isFinite(price) || price <= 0) throw new EbayError('NO_PRICE', 'Kein gültiger Preis.');
  return {
    sku: skuFor(item), marketplaceId: MARKETPLACE, format: 'FIXED_PRICE', availableQuantity: 1,
    categoryId: String(categoryId), listingDescription: htmlEsc(item.description),
    listingPolicies: { fulfillmentPolicyId: c.fulfillmentPolicyId, paymentPolicyId: c.paymentPolicyId, returnPolicyId: c.returnPolicyId },
    pricingSummary: { price: { value: price.toFixed(2), currency: 'EUR' } },
    merchantLocationKey: c.merchantLocationKey
  };
}
async function suggestCategory(item, c) {
  if (item.ebayCategoryId) return item.ebayCategoryId;
  if (c.defaultCategoryId) return c.defaultCategoryId;
  try {
    const tok = await applicationToken(c);
    const j = await api(`/commerce/taxonomy/v1/category_tree/77/get_category_suggestions?q=${encodeURIComponent(String(item.title || '').slice(0, 100))}`, { token: tok });
    const id = j.categorySuggestions?.[0]?.category?.categoryId;
    if (id) return id;
  } catch (e) { throw new EbayError('NO_CATEGORY', 'Kategorie konnte nicht ermittelt werden (' + e.message + '). Standard-Kategorie-ID in Config oder ebayCategoryId am Artikel setzen.'); }
  throw new EbayError('NO_CATEGORY', 'Keine Kategorie-Vorschläge. Standard-Kategorie-ID in Config setzen.');
}
async function findOfferId(item) {
  try {
    const j = await api(`/sell/inventory/v1/offer?sku=${encodeURIComponent(skuFor(item))}&marketplace_id=${MARKETPLACE}`);
    return j.offers?.[0]?.offerId || null;
  } catch { return null; }
}

/* ---------- operations ---------- */
export async function checkSetup() {
  await guard({ feature: 'ebayApi', platform: 'ebay', host: HOST, rate: 'update', op: 'check-setup' });
  const c = await getCreds();
  const out = { errors: [] };
  const pick = async (path, listKey, idKey, field) => {
    try { const j = await api(path); const id = j[listKey]?.[0]?.[idKey]; if (id) { out[field] = id; } }
    catch (e) { out.errors.push(`${field}: ${e.message}`); }
  };
  await pick(`/sell/account/v1/fulfillment_policy?marketplace_id=${MARKETPLACE}`, 'fulfillmentPolicies', 'fulfillmentPolicyId', 'fulfillmentPolicyId');
  await pick(`/sell/account/v1/payment_policy?marketplace_id=${MARKETPLACE}`, 'paymentPolicies', 'paymentPolicyId', 'paymentPolicyId');
  await pick(`/sell/account/v1/return_policy?marketplace_id=${MARKETPLACE}`, 'returnPolicies', 'returnPolicyId', 'returnPolicyId');
  await pick('/sell/inventory/v1/location', 'locations', 'merchantLocationKey', 'merchantLocationKey');
  const patch = {};
  ['fulfillmentPolicyId', 'paymentPolicyId', 'returnPolicyId', 'merchantLocationKey'].forEach((k) => { patch[k] = out[k] || ''; });
  await saveCreds(patch);
  await audit({ feature: 'ebayApi', platform: 'ebay', op: 'check-setup', outcome: out.errors.length ? 'partial' : 'ok', detail: out.errors.join(' | ').slice(0, 300) });
  return { ...out, c };
}

export async function createListing(item, { confirmed } = {}) {
  await guard({ feature: 'ebayApi', platform: 'ebay', host: HOST, rate: 'publish', op: 'create-listing', itemId: item.id, requireConfirm: true, confirmed, detail: item.title });
  const c = await getCreds();
  requireSetup(c);
  const sku = skuFor(item);
  const categoryId = await suggestCategory(item, c);

  await api(`/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, { method: 'PUT', body: inventoryItemBody(item, c) });

  let offerId = item.publishedTo?.ebay?.offerId || await findOfferId(item);
  if (offerId) await api(`/sell/inventory/v1/offer/${offerId}`, { method: 'PUT', body: offerBody(item, c, categoryId) });
  else offerId = (await api('/sell/inventory/v1/offer', { method: 'POST', body: offerBody(item, c, categoryId) })).offerId;

  await Store.setPlatformState(item.id, 'ebay', { status: 'pending', offerId, sku, source: 'api', ts: Date.now(), error: '' });
  try {
    const pub = await api(`/sell/inventory/v1/offer/${offerId}/publish`, { method: 'POST' });
    const url = listingUrl(c, pub.listingId);
    await Store.markPublished(item.id, 'ebay', { url, status: 'live', offerId, listingId: pub.listingId, sku, source: 'api', env: c.env });
    return { ok: true, listingId: pub.listingId, url, offerId };
  } catch (e) {
    await Store.setPlatformState(item.id, 'ebay', { status: 'pending', error: e.message.slice(0, 300) });
    if (/25002|aspect|Artikelmerkmal/i.test(e.message)) e.message += '\nHinweis: Die Kategorie verlangt evtl. Pflicht-Artikelmerkmale (Item Specifics), die das Tool nicht befüllt.';
    throw e;
  }
}

export async function updateListing(item, { confirmed } = {}) {
  await guard({ feature: 'ebayApi', platform: 'ebay', host: HOST, rate: 'update', op: 'update-listing', itemId: item.id, requireConfirm: true, confirmed });
  const c = await getCreds();
  requireSetup(c);
  const offerId = item.publishedTo?.ebay?.offerId;
  if (!offerId) throw new EbayError('NO_OFFER', 'Keine eBay-Offer-ID gespeichert — erst per API erstellen.');
  await api(`/sell/inventory/v1/inventory_item/${encodeURIComponent(skuFor(item))}`, { method: 'PUT', body: inventoryItemBody(item, c) });
  const cur = await api(`/sell/inventory/v1/offer/${offerId}`);
  await api(`/sell/inventory/v1/offer/${offerId}`, { method: 'PUT', body: offerBody(item, c, cur.categoryId) });
  await audit({ feature: 'ebayApi', platform: 'ebay', op: 'update-listing', itemId: item.id, outcome: 'ok' });
  return { ok: true };
}

/* Ends the live listing (withdraw offer). Deterministic → no dry-run once confirmed. */
export async function endListing(item, { confirmed, forceDryRun } = {}) {
  const g = await guard({
    feature: 'autoDelist', platform: 'ebay', host: HOST, rate: 'end', op: 'end-listing', itemId: item.id,
    needs: ['ebayApi'], destructive: true, deterministic: true, confirmed, forceDryRun
  });
  const offerId = item.publishedTo?.ebay?.offerId;
  if (!offerId) throw new EbayError('NO_OFFER', 'Keine eBay-Offer-ID gespeichert.');
  if (g.dryRun) return { ok: true, dryRun: true, note: `Dry-Run: würde Offer ${offerId} per API beenden (withdraw).` };
  await api(`/sell/inventory/v1/offer/${offerId}/withdraw`, { method: 'POST' });
  await Store.setPlatformState(item.id, 'ebay', { status: 'ended', endedAt: Date.now() });
  return { ok: true, dryRun: false, note: 'eBay-Angebot per API beendet.' };
}

/* Poll orders → mark matching items sold. Returns { orders, matched }. */
export async function pollOrders() {
  await guard({ feature: 'ebayApi', platform: 'ebay', host: HOST, rate: 'orders', op: 'poll-orders', audit: false });
  const st = (await chrome.storage.local.get([POLL_KEY]))[POLL_KEY] || {};
  const since = new Date(st.since || Date.now() - 14 * 86400000).toISOString();
  const started = Date.now();
  const j = await api(`/sell/fulfillment/v1/order?filter=${encodeURIComponent(`creationdate:[${since}..]`)}&limit=50`);
  const orders = j.orders || [];
  const inv = await Store.getInventory();
  const bySku = new Map(inv.map((i) => [skuFor(i), i]));
  let matched = 0;
  for (const o of orders) {
    for (const li of o.lineItems || []) {
      const item = bySku.get(li.sku);
      if (!item || item.status === 'sold') continue;
      await Store.updateFields(item.id, { status: 'sold', soldAt: Date.now(), soldOn: 'ebay', needsDelistReview: true });
      await Store.setPlatformState(item.id, 'ebay', { status: 'sold' });
      if (item.tone) { try { await recordSale(item.tone, item.id); } catch { /* ignore */ } }
      await audit({ feature: 'ebayApi', platform: 'ebay', op: 'order-sold', itemId: item.id, outcome: 'recorded', detail: o.orderId });
      matched++;
    }
  }
  await chrome.storage.local.set({ [POLL_KEY]: { since: started - 60000, lastPoll: started, lastCount: orders.length } });
  return { orders: orders.length, matched };
}
