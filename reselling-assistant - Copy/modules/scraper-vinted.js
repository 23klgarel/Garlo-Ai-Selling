/* Garlo AI Selling — modules/scraper-vinted.js (v7)
   CLASSIC script (not an ES module): loaded as a content script on vinted.de BEFORE
   content.js (see manifest) or injected via chrome.scripting. Exposes window.__garloVinted.

   ⚠ STATUS: PARTIAL / UNVERIFIED. Vinted is a React app with changing markup, custom
   dropdowns and bot detection. Selectors below are best-effort guesses in a multi-selector
   fallback chain (same pattern as content.js); JSON-LD is tried first for scraping because
   it is the most stable source. Users can PREPEND working selectors without a code change:
     chrome.storage.local.set({ vintedSelectorOverrides: { title:['…'], price:['…'] } })
   Fields: title, price, description, imageInput. Brand is best-effort; category, size and
   condition are NOT automated (manual). */
(function () {
  'use strict';
  if (window.__garloVinted) return;

  const clean = (t) => (t || '').replace(/\s+/g, ' ').trim();
  const qs = (s, r = document) => { try { return r.querySelector(s); } catch { return null; } };
  const qsa = (s, r = document) => { try { return Array.from(r.querySelectorAll(s)); } catch { return []; } };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const SEL = {
    title:       ['input[name="title"]', '#title', '[data-testid="title--input"]', 'input[id*="title"]'],
    description: ['textarea[name="description"]', '#description', '[data-testid="description--input"]', 'textarea[id*="description"]'],
    price:       ['input[name="price"]', '#price', '[data-testid="price-input--input"]', 'input[inputmode="decimal"]', 'input[id*="price"]'],
    imageInput:  ['input[type="file"][accept*="image"]', 'input[type="file"]'],
    /* item page (scrape) */
    pTitle:      ['[data-testid="item-title"]', '[itemprop="name"]', 'h1'],
    pPrice:      ['[data-testid="item-price"]', '[itemprop="price"]', '[class*="price"]'],
    pDesc:       ['[data-testid="item-description"]', '[itemprop="description"]'],
    pBrand:      ['[data-testid="item-attributes-brand"]', 'a[href*="brand_ids"]'],
    pImages:     ['[data-testid*="image"] img', 'img[src*="vinted.net"]']
  };

  let overrides = {};
  const ready = (async () => {
    try { overrides = (await chrome.storage.local.get(['vintedSelectorOverrides'])).vintedSelectorOverrides || {}; } catch { /* ignore */ }
  })();
  const sels = (k) => [...(Array.isArray(overrides[k]) ? overrides[k] : []), ...SEL[k]];
  const find = (k) => { for (const s of sels(k)) { const el = qs(s); if (el) return el; } return null; };

  function setNative(el, value) {
    try {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
    } catch { el.value = value; }
    ['input', 'change', 'blur'].forEach((ev) => el.dispatchEvent(new Event(ev, { bubbles: true })));
  }

  /* ---------- scrape (item page) ---------- */
  function jsonLdProduct() {
    for (const s of qsa('script[type="application/ld+json"]')) {
      try {
        const j = JSON.parse(s.textContent);
        const arr = Array.isArray(j) ? j : (j['@graph'] || [j]);
        const p = arr.find((x) => x && /Product/i.test(String(x['@type'])));
        if (p) return p;
      } catch { /* next */ }
    }
    return null;
  }

  function scrape() {
    const diagnostics = [];
    const data = { title: '', price: '', features: '', brand: '', images: [], url: location.href, site: 'vinted', isAmazonCom: false };
    const ld = jsonLdProduct();
    if (ld) {
      data.title = clean(ld.name);
      data.features = clean(ld.description);
      data.brand = clean(typeof ld.brand === 'string' ? ld.brand : ld.brand?.name);
      const offer = Array.isArray(ld.offers) ? ld.offers[0] : ld.offers;
      if (offer?.price != null) data.price = String(offer.price).replace('.', ',');
      const img = Array.isArray(ld.image) ? ld.image : (ld.image ? [ld.image] : []);
      data.images = img.filter((u) => typeof u === 'string').slice(0, 8);
      diagnostics.push('ℹ JSON-LD gefunden');
    }
    if (!data.title) { const el = sels('pTitle').map((s) => qs(s)).find((e) => e && clean(e.textContent)); if (el) data.title = clean(el.textContent); }
    if (!data.price) {
      const el = sels('pPrice').map((s) => qs(s)).find((e) => e && /\d/.test(e.textContent || e.getAttribute?.('content') || ''));
      const m = clean(el?.getAttribute?.('content') || el?.textContent).match(/(\d{1,5}(?:[.,]\d{2})?)/);
      if (m) data.price = m[1];
    }
    if (!data.features) { const el = sels('pDesc').map((s) => qs(s)).find((e) => e && clean(e.textContent)); if (el) data.features = clean(el.textContent); }
    if (!data.images.length) {
      data.images = Array.from(new Set(sels('pImages').flatMap((s) => qsa(s)).map((i) => i.getAttribute('src')).filter(Boolean))).slice(0, 8);
    }
    diagnostics.push(data.title ? '✓ Titel' : '✗ Titel fehlt', data.price ? '✓ Preis' : '✗ Preis fehlt', `✓ ${data.images.length} Bilder`);
    return { ok: !!data.title, data, diagnostics, error: data.title ? null : 'Titel nicht gefunden (Vinted-Selektoren evtl. veraltet)' };
  }

  /* ---------- best-effort custom dropdown (brand) ---------- */
  async function pickDropdown(labelRe, wanted) {
    const trigger = qsa('[role="combobox"], button, input[readonly], [data-testid*="dropdown"], div[role="button"]')
      .find((e) => labelRe.test(`${e.getAttribute('aria-label') || ''} ${e.getAttribute('placeholder') || ''} ${e.textContent || ''}`));
    if (!trigger) return false;
    trigger.click();
    await sleep(500);
    const input = qs('input[type="search"], input[type="text"]:focus');
    if (input) { setNative(input, wanted); await sleep(500); }
    const opt = qsa('[role="option"], li, [data-testid*="cell"]').find((e) => clean(e.textContent).toLowerCase().includes(wanted.toLowerCase()));
    if (!opt) return false;
    opt.click();
    await sleep(250);
    return true;
  }

  /* ---------- fill (publish form) ---------- */
  async function fill({ title, price, description, images, brand } = {}) {
    await ready;
    const result = { filled: [], missing: [], imagesInjected: 0, categoryMatched: null, notes: [] };

    const tEl = find('title');
    if (tEl && title) { setNative(tEl, title.slice(0, 100)); result.filled.push('Titel'); } else result.missing.push('Titel');

    const dEl = find('description');
    if (dEl && description) { setNative(dEl, description); result.filled.push('Beschreibung'); } else result.missing.push('Beschreibung');

    const pEl = find('price');
    if (pEl && price) { setNative(pEl, String(price).replace(/[^\d.,]/g, '').replace(',', '.')); result.filled.push('Preis'); } else result.missing.push('Preis');

    if (Array.isArray(images) && images.length) {
      const fi = find('imageInput');
      if (fi) {
        try {
          const dt = new DataTransfer();
          images.forEach((img) => {
            if (!img?.dataUrl) return;
            const [meta, b64] = img.dataUrl.split(',');
            const mime = (meta.match(/data:([^;]+);/) || [])[1] || 'image/jpeg';
            const bin = atob(b64); const buf = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
            dt.items.add(new File([new Blob([buf], { type: mime })], img.filename || `img-${Date.now()}.jpg`, { type: mime }));
          });
          fi.files = dt.files;
          fi.dispatchEvent(new Event('change', { bubbles: true }));
          result.imagesInjected = dt.files.length;
          result.filled.push(`${dt.files.length} Bilder`);
        } catch (e) { result.missing.push('Bilder: ' + e.message); }
      } else result.missing.push('Bild-Feld');
    }

    if (brand) {
      try {
        if (await pickDropdown(/marke|brand/i, brand)) result.filled.push('Marke');
        else result.missing.push('Marke (manuell wählen)');
      } catch { result.missing.push('Marke (manuell wählen)'); }
    }
    result.notes.push('Kategorie, Größe und Zustand bitte manuell wählen (nicht automatisiert).');
    return result;
  }

  /* ---------- assisted delist: locate (and optionally click) the delete control ---------- */
  function delistAssist({ live } = {}) {
    const rx = /^(artikel\s+)?(löschen|entfernen|delete(\s+item)?|supprimer)$/i;
    const cand = qsa('button, a, [role="button"]').find((e) => rx.test(clean(e.textContent)));
    if (!cand) return { found: false, clicked: false, note: 'Lösch-Schaltfläche nicht gefunden. Auf Vinted ggf. „Bearbeiten“ öffnen und dort löschen.' };
    cand.scrollIntoView({ block: 'center' });
    cand.style.outline = '3px solid #f87171';
    cand.style.outlineOffset = '2px';
    if (live) cand.click();
    return { found: true, clicked: !!live, note: live ? 'Klick ausgeführt — Vinted-Bestätigung selbst bestätigen.' : 'Dry-Run: Schaltfläche markiert, nichts geklickt.' };
  }

  window.__garloVinted = { scrape, fill, delistAssist, SEL };
})();
