/* Garlo AI Selling — modules/platforms.js (v7)
   Central registry for the three marketplaces. Single source of truth for:
     • display labels + short names
     • rate-limiter host key
     • which URLs to open for a new listing / for managing existing listings
     • the tab-query pattern used to find an already-open marketplace tab
     • which guard "feature" key routes the action through consent
     • which publishedTo[] statuses count as "online" (delist targets, live badges)
     • best-effort URL detection for "did the user just publish this?"

   CONSUMERS:
     bulk-queue.js     → PLATFORMS[p].{label, short, rateHost, newUrl}, QUEUE_PLATFORMS, detectPublished
     dashboard.js      → PLATFORMS[p].{tabPattern, newUrl, rateHost}, featureFor
     cross-delist.js   → PLATFORMS[p].{label, short, manageUrl}, ONLINE_STATUSES
     price-watcher.js  → ONLINE_STATUSES
     v7-ui.js          → PLATFORMS[p].{label, short}

   NOTE ON URL PATTERNS: `detectPublished` and `manageUrl` are BEST-EFFORT GUESSES.
   Only eBay (via real API) is deterministic. Kleinanzeigen/Vinted are DOM/URL based
   and may drift — the manual "mark as published" fallback in the queue UI is the
   reliable path. If a pattern breaks, update it here and everything re-derives. */

/* ---------- platforms ---------- */
export const PLATFORMS = {
  kleinanzeigen: {
    id: 'kleinanzeigen',
    label: 'Kleinanzeigen',
    short: 'KA',
    rateHost: 'kleinanzeigen',
    newUrl: 'https://www.kleinanzeigen.de/p-anzeige-aufgeben.html',
    manageUrl: 'https://www.kleinanzeigen.de/m-meine-anzeige.html',
    tabPattern: '*://*.kleinanzeigen.de/*'
  },
  ebay: {
    id: 'ebay',
    label: 'eBay.de',
    short: 'eBay',
    rateHost: 'ebay',
    newUrl: 'https://www.ebay.de/sl/sell',
    manageUrl: 'https://www.ebay.de/sh/ovw',
    tabPattern: '*://*.ebay.de/*'
  },
  vinted: {
    id: 'vinted',
    label: 'Vinted',
    short: 'Vinted',
    rateHost: 'vinted',
    newUrl: 'https://www.vinted.de/items/new',
    manageUrl: 'https://www.vinted.de/my/items',
    tabPattern: '*://*.vinted.de/*'
  }
};

/* Platforms the semi-automatic queue supports. */
export const QUEUE_PLATFORMS = ['kleinanzeigen', 'vinted'];

/* publishedTo[platform].status values that mean "this listing is currently online".
   Used for:
     • delist targets (cross-delist.js)
     • stale-price candidates (price-watcher.js)
     • "already live" dedupe in queue enqueue (bulk-queue.js)
     • delist-review flag on sold (background.js updateStatus)
   `unknown` is what V6-migrated items get — they might still be live, treat conservatively.
   `delist-requested` means the user triggered a delist but it hasn't been confirmed yet;
   still counts as online until a real end action succeeds. */
export const ONLINE_STATUSES = new Set(['live', 'unknown', 'delist-requested']);

/* Maps a platform to the guard() feature key. Determines which per-feature consent
   is required (see FEATURE_CONSENT in guard.js):
     'formfill'  → base consent only (Kleinanzeigen, eBay form-fill)
     'vinted'    → Vinted consent required
     'ebayApi'   → eBay API consent (used inside ebay-api.js directly, NOT here)
     'autoDelist'→ auto-delist consent (used inside cross-delist.js directly) */
export function featureFor(platform) {
  if (platform === 'vinted') return 'vinted';
  return 'formfill';
}

/* ---------- publish detection ----------
   Called on every tab URL change (bulk-queue.onTabUpdated, publish-watch.onTabUpdated).
   Returns { url } when the URL looks like a completed publish page for the given platform,
   otherwise null. NEVER throws.

   eBay-with-API publishing does not rely on this at all (the API returns a listing id);
   this is only used for form-fill based publishes. */
export function detectPublished(platform, url) {
  if (!url) return null;
  let u;
  try { u = new URL(url); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;

  if (platform === 'kleinanzeigen') {
    /* Two known landing patterns:
       1) After submit, KA redirects to the new ad's public URL:
          https://www.kleinanzeigen.de/s-anzeige/<slug>/<digits>
       2) Some flows land on a confirmation page:
          https://www.kleinanzeigen.de/p-anzeige-aufgeben-bestaetigung.html
       The live-ad URL is what we want to store. If we only see the confirmation
       page, we still treat it as published but with the confirmation URL — the
       user can paste the real URL in the drawer. */
    if (/kleinanzeigen\.de\/s-anzeige\/.+\/\d{6,}/i.test(u.pathname)) {
      return { url: `${u.origin}${u.pathname}` };
    }
    if (/kleinanzeigen\.de\/p-anzeige-aufgeben-bestaetigung/i.test(u.pathname)) {
      return { url: `${u.origin}${u.pathname}` };
    }
    return null;
  }

  if (platform === 'vinted') {
    /* Vinted's new-item flow usually ends on the item's public page:
         https://www.vinted.de/items/<id>-<slug>
       Older flows redirected to the profile:
         https://www.vinted.de/member/<id>/items
       We accept both — the item page is preferred. */
    if (/vinted\.de\/items\/\d+/i.test(u.pathname)) {
      return { url: `${u.origin}${u.pathname}` };
    }
    if (/vinted\.de\/member\/\d+\/items/i.test(u.pathname)) {
      return { url: `${u.origin}${u.pathname}` };
    }
    return null;
  }

  if (platform === 'ebay') {
    /* eBay form-fill sell flow finishes on one of:
         https://www.ebay.de/itm/<id>
         https://www.ebay.de/sh/lst/active
         https://cgi.ebay.de/ws/eBayISAPI.dll?...  (legacy)
       If we can extract an item id we use the /itm/<id> form; otherwise we fall
       back to the current URL so the user has *something* clickable. */
    const itm = u.pathname.match(/\/itm\/(\d+)/);
    if (itm) return { url: `${u.origin}/itm/${itm[1]}` };
    if (/ebay\.de\/sh\/lst\/active/i.test(u.pathname)) return { url: `${u.origin}${u.pathname}` };
    if (/cgi\.ebay\.de\/ws\/eBayISAPI\.dll/i.test(u.pathname)) return { url: url };
    return null;
  }

  return null;
}