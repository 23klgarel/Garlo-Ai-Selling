/* Garlo AI Selling — content.js (v9.2)
   Universal scraper (Amazon/Otto/Idealo/Vinted) + marketplace autofill +
   inbox scrape + conversation reader + reply fill + assisted delist.

   V9.2 IMPROVEMENTS:
     • German price parser handles 1.234,56 correctly
     • Amazon: coupon price, availability, rating, review count, seller
     • Amazon: extra bullet fallbacks (productFacts, A+ content)
     • Amazon: image extraction from colorImages JSON blob
     • Otto + Idealo: feature bullets extraction
     • contenteditable insert via execCommand (React-safe)
     • Image upload returns per-image diagnostics to the UI
     • Faster amazon scrape (fewer DOM traversals)

   V9.1 (kept):
     • One-image-at-a-time injection with 2.5s gaps
     • Natural filename patterns (IMG_xxxx.jpg, Photo_1.jpg)
     • Past lastModified timestamps */

(function () {
  'use strict';
  if (window.__garloInjected) return;
  window.__garloInjected = true;

  /* ============ HELPERS ============ */
  const clean = (t) => (t || '').replace(/\s+/g, ' ').trim();
  const qs = (s, r = document) => { try { return r.querySelector(s); } catch { return null; } };
  const qsa = (s, r = document) => { try { return Array.from(r.querySelectorAll(s)); } catch { return []; } };
  const firstWithText = (sels, r = document) => {
    for (const s of sels) {
      const el = qs(s, r);
      if (el && clean(el.textContent)) return { el, sel: s };
    }
    return null;
  };
  const isAmazonComHost = () =>
    /amazon\.com$/i.test(location.hostname) ||
    (/amazon\./i.test(location.hostname) && !/amazon\.de/i.test(location.hostname));
  const hashCode = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = ((h << 5) - h) + s.charCodeAt(i) | 0; return h; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* German-aware number parser.
     "1.234,56" → 1234.56
     "1234,56"  → 1234.56
     "1,234.56" → 1234.56 (fallback)
     "1.99"     → 1.99
     Returns NaN if unparseable. */
  function parseGermanPrice(s) {
    if (s == null) return NaN;
    let str = String(s).replace(/[^\d.,-]/g, '');
    if (!str) return NaN;
    const hasComma = str.includes(',');
    const hasDot = str.includes('.');
    if (hasComma && hasDot) {
      /* Both present: last one is the decimal separator */
      if (str.lastIndexOf(',') > str.lastIndexOf('.')) {
        str = str.replace(/\./g, '').replace(',', '.');
      } else {
        str = str.replace(/,/g, '');
      }
    } else if (hasComma) {
      /* Only comma: it's the decimal separator */
      str = str.replace(',', '.');
    }
    /* Only dot or neither: leave as-is */
    return parseFloat(str);
  }

  /* ============ AMAZON ============ */
  function scrapeAmazon() {
    const diagnostics = [];
    const data = {
      title: '', price: '', features: '', brand: '', images: [],
      url: location.href, site: 'amazon', isAmazonCom: isAmazonComHost(),
      /* V9.2 new fields */
      availability: '', rating: '', reviewCount: '', seller: '',
      coupon: '', listPrice: ''
    };

    /* --- Title --- */
    const t = firstWithText(['#productTitle', 'h1#title', 'h1.product-title-word-break']);
    if (t) { data.title = clean(t.el.textContent); diagnostics.push('✓ Titel'); }
    else diagnostics.push('✗ Titel fehlt');

    /* --- Brand --- */
    const b = firstWithText(['#bylineInfo', 'a#bylineInfo', '#brand', '.po-brand .a-span9 span']);
    if (b) {
      data.brand = clean(b.el.textContent)
        .replace(/^Marke:\s*/i, '').replace(/^Brand:\s*/i, '')
        .replace(/^Besuchen Sie den\s+/i, '').replace(/\s+Store$/i, '');
      diagnostics.push('✓ Marke');
    }

    /* --- Price (V9.2: proper German parsing) --- */
    const whole = qs('.a-price-whole');
    const frac = qs('.a-price-fraction');
    if (whole) {
      const w = whole.textContent.replace(/[^\d]/g, '');
      const f = frac ? frac.textContent.replace(/[^\d]/g, '').slice(0, 2) : '00';
      data.price = `${w},${f}`;
      diagnostics.push('✓ Preis (.a-price)');
    } else {
      const p = firstWithText([
        '#corePrice_feature_div .a-offscreen',
        '.a-price .a-offscreen',
        '#priceblock_ourprice',
        '#price_inside_buybox',
        '#corePriceDisplay_desktop_feature_div .a-offscreen'
      ]);
      if (p) {
        const raw = clean(p.el.textContent);
        const n = parseGermanPrice(raw);
        if (isFinite(n)) data.price = n.toFixed(2).replace('.', ',');
        diagnostics.push(`✓ Preis (${p.sel})`);
      } else diagnostics.push('✗ Preis fehlt');
    }

    /* --- V9.2: List price / strike-through price --- */
    const listPriceEl = qs('.a-price.a-text-price .a-offscreen') ||
                        qs('[data-a-strike="true"] .a-offscreen') ||
                        qs('.basisPrice .a-offscreen');
    if (listPriceEl) {
      const n = parseGermanPrice(listPriceEl.textContent);
      if (isFinite(n)) {
        data.listPrice = n.toFixed(2).replace('.', ',');
        diagnostics.push('✓ Streichpreis');
      }
    }

    /* --- V9.2: Coupon / discount --- */
    const couponEl = qs('#couponBadge, .couponBadge, [data-feature-name="coupon"] .a-color-success');
    if (couponEl && clean(couponEl.textContent)) {
      data.coupon = clean(couponEl.textContent).slice(0, 80);
      diagnostics.push('✓ Coupon: ' + data.coupon);
    }

    /* --- V9.2: Availability --- */
    const availEl = qs('#availability span, #availability .a-color-success, #availability .a-color-price');
    if (availEl && clean(availEl.textContent)) {
      data.availability = clean(availEl.textContent).slice(0, 100);
      diagnostics.push('✓ Verfügbarkeit');
    }

    /* --- V9.2: Rating + review count --- */
    const ratingEl = qs('#acrPopover .a-icon-alt, [data-hook="rating-out-of-text"]');
    const reviewEl = qs('#acrCustomerReviewText');
    if (ratingEl) data.rating = clean(ratingEl.textContent).slice(0, 40);
    if (reviewEl) data.reviewCount = clean(reviewEl.textContent).slice(0, 40);
    if (data.rating || data.reviewCount) diagnostics.push('✓ Bewertung');

    /* --- V9.2: Seller (Amazon vs 3rd party) --- */
    const sellerEl = qs('#sellerProfileTriggerId, #merchant-info, #tabular-buybox .tabular-buybox-text');
    if (sellerEl) {
      const sellerText = clean(sellerEl.textContent);
      if (sellerText) {
        data.seller = sellerText.slice(0, 100);
        diagnostics.push('✓ Verkäufer');
      }
    }

    /* --- Feature bullets (V9.2: expanded fallbacks) --- */
    const bulletContainers = [
      '#feature-bullets',
      '#featurebullets_feature_div',
      '#productFactsDesktopExpander',
      '#productFactsDesktop_feature_div',
      '[data-feature-name="featurebullets"]',
      '#productOverview_feature_div'
    ];
    let bullets = null, bulletSel = null;
    for (const sel of bulletContainers) {
      const el = qs(sel);
      if (el) { bullets = el; bulletSel = sel; break; }
    }

    if (bullets) {
      const seen = new Set(); const arr = [];
      qsa('li span, li .a-list-item, li', bullets).forEach((li) => {
        const x = clean(li.textContent);
        if (x.length > 4 && x.length < 400 && !seen.has(x)) { seen.add(x); arr.push(x); }
      });
      data.features = arr.slice(0, 12).map((x) => '- ' + x).join('\n');
      diagnostics.push(`✓ ${arr.length} Bullets (${bulletSel})`);
    } else {
      /* V9.2: A+ content fallback */
      const aplusBlocks = qsa('[data-aplus-ajax-feature], .aplus-module h4, .aplus-module p');
      if (aplusBlocks.length) {
        const seen = new Set(); const arr = [];
        aplusBlocks.forEach((el) => {
          const x = clean(el.textContent);
          if (x.length > 10 && x.length < 400 && !seen.has(x)) { seen.add(x); arr.push(x); }
        });
        data.features = arr.slice(0, 8).map((x) => '- ' + x).join('\n');
        diagnostics.push(`✓ ${arr.length} A+ Bullets`);
      } else {
        diagnostics.push('ℹ Keine Bullets gefunden');
      }
    }

    /* --- Images (V9.2: JSON blob fallback) --- */
    const imgSet = new Set();
    qsa('#altImages li img, #imageBlock img, #main-image-container img, #imageBlock_feature_div img').forEach((img) => {
      const src = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-old-hires');
      if (src) {
        imgSet.add(src.replace(/\._[A-Z0-9,_]+_\./, '._SL1500_.'));
      }
    });

    /* Fallback: parse colorImages from inline scripts */
    if (imgSet.size < 2) {
      try {
        const scripts = qsa('script[type="text/javascript"]');
        for (const s of scripts) {
          const txt = s.textContent || '';
          const m = txt.match(/'colorImages'\s*:\s*(\{[\s\S]*?\})\s*,\s*'/);
          if (m && m[1]) {
            const found = m[1].match(/https?:\/\/[^"']+?\.(?:jpg|jpeg|png)/g) || [];
            found.forEach((u) => {
              const normalized = u.replace(/\\\//g, '/').replace(/\._[A-Z0-9,_]+_\./, '._SL1500_.');
              imgSet.add(normalized);
            });
            if (found.length) break;
          }
        }
      } catch { /* ignore */ }
    }

    data.images = Array.from(imgSet).slice(0, 8);
    diagnostics.push(`✓ ${data.images.length} Bilder`);

    return { ok: !!data.title, data, diagnostics, error: data.title ? null : 'Titel nicht gefunden' };
  }

  /* ============ OTTO (V9.2: features extraction) ============ */
  function scrapeOtto() {
    const diagnostics = [];
    const data = { title: '', price: '', features: '', brand: '', images: [], url: location.href, site: 'otto', isAmazonCom: false };

    const t = firstWithText(['h1[data-testid="pdp-title"]', 'h1.pdp_title', 'h1']);
    if (t) { data.title = clean(t.el.textContent); diagnostics.push('✓ Titel'); }

    const p = firstWithText(['[data-testid="pdp-price"]', '.pdp_price', '[class*="price"]']);
    if (p) {
      const n = parseGermanPrice(p.el.textContent);
      if (isFinite(n)) { data.price = n.toFixed(2).replace('.', ','); diagnostics.push('✓ Preis'); }
    }

    /* V9.2: Brand */
    const brandEl = qs('[data-testid*="brand"] a, .pdp_brand a, [class*="brand"] a');
    if (brandEl) data.brand = clean(brandEl.textContent).slice(0, 60);

    /* V9.2: Feature bullets */
    const bulletContainers = ['[data-testid*="feature"]', 'ul[class*="feature"]', '.pdp_features li', '.productDetails li'];
    let bullets = null;
    for (const sel of bulletContainers) {
      const el = qs(sel);
      if (el) { bullets = el; break; }
    }
    if (bullets) {
      const seen = new Set(); const arr = [];
      qsa('li, [class*="feature-item"]', bullets).forEach((li) => {
        const x = clean(li.textContent);
        if (x.length > 4 && x.length < 400 && !seen.has(x)) { seen.add(x); arr.push(x); }
      });
      data.features = arr.slice(0, 10).map((x) => '- ' + x).join('\n');
      diagnostics.push(`✓ ${arr.length} Bullets`);
    }

    const imgSet = new Set();
    qsa('img[src*="i.otto.de"], [data-testid*="gallery"] img').forEach((img) => {
      const src = img.getAttribute('src');
      if (src) imgSet.add(src.replace(/\?.*$/, ''));
    });
    data.images = Array.from(imgSet).slice(0, 8);
    diagnostics.push(`✓ ${data.images.length} Bilder`);

    return { ok: !!data.title, data, diagnostics, error: data.title ? null : 'Titel nicht gefunden' };
  }

  /* ============ IDEALO (V9.2: features extraction) ============ */
  function scrapeIdealo() {
    const diagnostics = [];
    const data = { title: '', price: '', features: '', brand: '', images: [], url: location.href, site: 'idealo', isAmazonCom: false };

    const t = firstWithText(['h1[data-testid*="title"]', 'h1']);
    if (t) { data.title = clean(t.el.textContent); diagnostics.push('✓ Titel'); }

    const p = firstWithText(['[data-testid*="price"]', '.price']);
    if (p) {
      const n = parseGermanPrice(p.el.textContent);
      if (isFinite(n)) { data.price = n.toFixed(2).replace('.', ','); diagnostics.push('✓ Preis'); }
    }

    /* V9.2: Feature bullets */
    const bullets = qs('[data-testid*="feature"], ul[class*="feature"]');
    if (bullets) {
      const arr = qsa('li', bullets).map((li) => clean(li.textContent)).filter((x) => x.length > 4 && x.length < 400);
      data.features = arr.slice(0, 10).map((x) => '- ' + x).join('\n');
      diagnostics.push(`✓ ${arr.length} Bullets`);
    }

    /* V9.2: Images */
    const imgSet = new Set();
    qsa('img[src*="idealoimg"], [data-testid*="gallery"] img').forEach((img) => {
      const src = img.getAttribute('src') || img.getAttribute('data-src');
      if (src) imgSet.add(src.replace(/\?.*$/, ''));
    });
    data.images = Array.from(imgSet).slice(0, 8);
    diagnostics.push(`✓ ${data.images.length} Bilder`);

    return { ok: !!data.title, data, diagnostics, error: data.title ? null : 'Titel nicht gefunden' };
  }

  function scrapeProduct() {
    if (/vinted\./i.test(location.hostname)) {
      return window.__garloVinted
        ? window.__garloVinted.scrape()
        : { ok: false, error: 'Vinted-Modul nicht geladen', diagnostics: [] };
    }
    if (/amazon\./i.test(location.hostname)) return scrapeAmazon();
    if (/otto\./i.test(location.hostname)) return scrapeOtto();
    if (/idealo\./i.test(location.hostname)) return scrapeIdealo();
    return { ok: false, error: 'Unbekannte Seite: ' + location.hostname, diagnostics: [] };
  }

  /* ============ GUARD MIRROR + BANNER ============ */
  async function automationAllowed() {
    try {
      const s = (await chrome.storage.local.get(['settings'])).settings || {};
      if (s.killSwitch) return { ok: false, reason: 'Kill-Switch aktiv.' };
      if (!s.consent?.given) return { ok: false, reason: 'Einwilligung fehlt (Dashboard öffnen).' };
      return { ok: true };
    } catch { return { ok: false, reason: 'Einstellungen nicht lesbar.' }; }
  }

  function showBanner(text) {
    try {
      let b = document.getElementById('__garlo-banner');
      if (!b) {
        b = document.createElement('div');
        b.id = '__garlo-banner';
        b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;padding:6px 12px;' +
          'background:#7c3aed;color:#fff;font:600 12px/1.4 system-ui,sans-serif;text-align:center;' +
          'box-shadow:0 2px 8px rgba(0,0,0,.3);pointer-events:none';
        document.documentElement.appendChild(b);
      }
      b.textContent = text || '🤖 Garlo AI Selling automatisiert diese Seite — Nutzung auf eigenes Risiko. Abschicken nur durch dich.';
      clearTimeout(showBanner._t);
      showBanner._t = setTimeout(() => b.remove(), 20000);
    } catch { /* ignore */ }
  }

  /* ============ KLEINANZEIGEN AUTH ============ */
  function checkKleinanzeigenAuth() {
    try {
      if (/\/m-einloggen|\/login/i.test(location.pathname)) return { connected: false, meta: 'Login-Seite aktiv' };
      const userMenu = qs('[data-testid="user-menu"]') || qs('a[href*="/m-mein-konto"]') || qs('a[href*="/m-meine-anzeigen"]');
      const loginLink = qs('a[href*="/m-einloggen"]') || qs('a[href*="einloggen"]');
      if (userMenu && !loginLink) {
        const name = clean(qs('[data-testid="user-menu"] .name, .user-menu .name, .user-name')?.textContent || '');
        return { connected: true, meta: name ? `Konto: ${name}` : 'Session aktiv' };
      }
      if (loginLink) return { connected: false, meta: 'Nicht eingeloggt' };
      return { connected: null, meta: 'Status unklar' };
    } catch { return { connected: null, meta: 'Prüfung fehlgeschlagen' }; }
  }

  /* ============ INBOX LIST ============ */
  function scrapeKleinanzeigenInbox() {
    try {
      const auth = checkKleinanzeigenAuth();
      if (auth.connected === false) return { ok: false, error: 'Nicht bei Kleinanzeigen eingeloggt.', auth };
      if (!/m-nachrichten|nachrichten|messages/i.test(location.pathname + location.href)) {
        return { ok: false, error: 'Nicht auf der Nachrichten-Seite.', auth, url: location.href };
      }

      const conversations = [];
      const seen = new Set();
      const linkSelectors = [
        'a[href*="/m-nachrichten/"]', 'a[href*="/nachricht/"]',
        'a[data-testid*="conversation"]', '[class*="conversation"] a[href]', 'li a[href*="nachricht"]'
      ];
      const links = [];
      for (const sel of linkSelectors) {
        qsa(sel).forEach((a) => {
          const href = a.getAttribute('href') || '';
          if (!href) return;
          if (href.includes('m-nachrichten.html') && !/\/m-nachrichten\//.test(href)) return;
          if (seen.has(href)) return;
          seen.add(href);
          links.push(a);
        });
        if (links.length > 0) break;
      }

      links.forEach((a) => {
        try {
          const href = a.getAttribute('href') || '';
          const fullUrl = href.startsWith('http') ? href : ('https://www.kleinanzeigen.de' + href);
          const blob = clean(a.textContent);
          if (!blob || blob.length < 3) return;

          const buyerEl = a.querySelector('[class*="name"], [data-testid*="name"], strong, h3, b');
          const previewEl = a.querySelector('[class*="preview"], [class*="message"], p, span + span, .text');
          const timeEl = a.querySelector('time, [class*="time"], [class*="date"], [datetime]');
          const itemEl = a.querySelector('[class*="title"], [class*="item"], [class*="ad-title"]');

          let buyer = buyerEl ? clean(buyerEl.textContent) : '';
          let preview = previewEl ? clean(previewEl.textContent) : '';
          const item = itemEl ? clean(itemEl.textContent) : '';
          let timestamp = 0;

          if (timeEl) {
            const tt = timeEl.getAttribute('datetime') || clean(timeEl.textContent);
            const parsed = Date.parse(tt);
            if (!isNaN(parsed)) timestamp = parsed;
          }
          if (!buyer || !preview) {
            const parts = blob.split(/\s{2,}|[•·|]/).map((s) => s.trim()).filter(Boolean);
            if (!buyer && parts[0]) buyer = parts[0];
            if (!preview && parts.length > 1) preview = parts.slice(1).join(' · ');
          }
          if (!buyer && blob) {
            const lines = blob.split(/\n/).map((l) => l.trim()).filter(Boolean);
            if (lines[0]) buyer = lines[0].slice(0, 60);
            if (!preview && lines.length > 1) preview = lines.slice(1).join(' ').slice(0, 200);
          }

          const unread = !!a.querySelector('[class*="unread"], [class*="bold"], [class*="new"]') || /\b(ungelesen|neu)\b/i.test(blob);
          if (!buyer && !preview) return;

          conversations.push({
            id: 'ka-' + Math.abs(hashCode(fullUrl)),
            buyer: buyer || 'Unbekannt',
            item: item || '',
            preview: preview || '(keine Vorschau)',
            timestamp: timestamp || Date.now(),
            url: fullUrl,
            unread
          });
        } catch { /* skip */ }
      });

      return { ok: true, conversations, count: conversations.length, auth, url: location.href };
    } catch (e) {
      return { ok: false, error: 'Inbox-Scrape Fehler: ' + e.message };
    }
  }

  /* ============ CONVERSATION SCRAPE ============ */
  function extractBuyerName() {
    const cands = [
      '[data-testid*="conversation"] h1', '[class*="conversation"] h1',
      '[class*="conversation-header"] [class*="name"]', 'h1[class*="name"]',
      '[data-testid*="counterpart"] [class*="name"]', '[class*="Counterpart"] [class*="name"]'
    ];
    for (const sel of cands) {
      const el = qs(sel);
      if (el && clean(el.textContent)) return clean(el.textContent).slice(0, 60);
    }
    return '';
  }

  function scrapeKleinanzeigenConversation() {
    try {
      const diagnostics = [];
      const messages = [];
      const seen = new Set();

      const candidateSelectors = [
        '[data-testid*="message-bubble"]', '[data-testid*="message"]',
        '[class*="message-bubble"]', '[class*="MessageBubble"]',
        '[class*="message-list"] > *', '[class*="conversation"] [class*="message"]',
        '[class*="Conversation"] [class*="Message"]', 'ul[class*="message"] > li', 'article'
      ];

      let bestBubbles = [];
      for (const sel of candidateSelectors) {
        const nodes = qsa(sel);
        if (nodes.length > bestBubbles.length) bestBubbles = nodes;
      }

      if (!bestBubbles.length) {
        const bodyText = (document.body && document.body.innerText) || '';
        const lines = bodyText.split('\n').map((l) => l.trim()).filter(Boolean);
        const candidates = lines.slice(-80).filter((t) => t.length >= 3 && t.length <= 800);
        if (!candidates.length) {
          return {
            ok: false,
            error: 'Nachrichten-Container nicht gefunden.',
            messages: [], buyer: extractBuyerName(),
            diagnostics: ['Keine Message-Bubbles', 'Text-Fallback leer', 'URL: ' + location.href]
          };
        }
        candidates.forEach((t) => { if (!seen.has(t)) { seen.add(t); messages.push({ from: 'them', text: t, time: '' }); } });
        return { ok: true, messages, buyer: extractBuyerName(), diagnostics: ['Fallback: Textzeilen'] };
      }

      bestBubbles.forEach((el) => {
        const text = clean(el.textContent);
        if (!text || text.length < 2 || seen.has(text)) return;
        seen.add(text);

        let from = 'them';
        const cls = (el.className || '').toString().toLowerCase();
        const testId = (el.getAttribute && (el.getAttribute('data-testid') || '')) || '';
        const combined = cls + ' ' + testId;
        if (/own|\bme\b|self|sent|outgoing|from-me/.test(combined)) from = 'me';
        else if (/them|other|received|incoming|partner|from-them/.test(combined)) from = 'them';
        else {
          try {
            const cs = window.getComputedStyle(el);
            const ml = parseFloat(cs.marginLeft) || 0;
            const mr = parseFloat(cs.marginRight) || 0;
            if (ml > mr * 1.5 && ml > 20) from = 'me';
            else if (mr > ml * 1.5 && mr > 20) from = 'them';
          } catch { /* ignore */ }
        }

        let time = '';
        const timeEl = el.querySelector && el.querySelector('time, [datetime], [class*="time"]');
        if (timeEl) time = timeEl.getAttribute('datetime') || clean(timeEl.textContent);
        else {
          const m = text.match(/^(\d{1,2}[:.]\d{2})/);
          if (m) time = m[1];
        }

        messages.push({ from, text, time });
      });

      diagnostics.push(`${messages.length} Nachrichten extrahiert`);
      return { ok: true, messages, buyer: extractBuyerName(), diagnostics };
    } catch (e) {
      return { ok: false, error: 'Conversation-Scrape Fehler: ' + e.message, messages: [], diagnostics: [e.message] };
    }
  }

  /* ============ FILL REPLY (V9.2: React-safe insert) ============ */
  function fillReply({ text } = {}) {
    if (!text || !text.trim()) return { ok: false, error: 'Leerer Text.' };

    const composerSelectors = [
      'textarea[data-testid*="message"]', 'textarea[data-testid*="reply"]',
      'textarea[placeholder*="Nachricht"]', 'textarea[placeholder*="schreiben"]',
      'textarea[placeholder*="Antwort"]', 'textarea[aria-label*="Nachricht"]',
      'textarea[aria-label*="Antwort"]', 'form[data-testid*="message"] textarea',
      'form[class*="composer"] textarea', 'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"]'
    ];

    let composer = null, matchedSelector = null;
    for (const sel of composerSelectors) {
      const el = qs(sel);
      if (el && el.offsetParent !== null) { composer = el; matchedSelector = sel; break; }
    }
    if (!composer) return { ok: false, error: 'Nachrichtenfeld nicht gefunden.' };

    composer.focus();

    if (composer.tagName === 'TEXTAREA' || composer.tagName === 'INPUT') {
      setNative(composer, text);
    } else if (composer.isContentEditable) {
      /* V9.2: React-friendly contenteditable insert */
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(composer);
      range.collapse(false); /* collapse to end */
      sel.removeAllRanges();
      sel.addRange(range);

      try {
        /* execCommand preserves React state better than innerHTML */
        const ok = document.execCommand('insertText', false, text);
        if (!ok) throw new Error('execCommand failed');
      } catch {
        /* Fallback: clear + set text (works for plain contenteditable) */
        composer.innerHTML = '';
        String(text).split('\n').forEach((line, i) => {
          if (i > 0) composer.appendChild(document.createElement('br'));
          composer.appendChild(document.createTextNode(line));
        });
      }
      composer.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      return { ok: false, error: 'Unbekanntes Feld.' };
    }

    /* Visual feedback */
    const orig = composer.style.outline;
    composer.style.transition = 'outline 0.3s';
    composer.style.outline = '2px solid #a855f7';
    composer.style.outlineOffset = '2px';
    setTimeout(() => { composer.style.outline = orig; }, 2500);

    /* V9.2: scroll into view */
    try { composer.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch { /* ignore */ }

    return { ok: true, bytes: text.length, selector: matchedSelector };
  }

  /* ============ ASSISTED DELIST ============ */
  function delistAssist({ platform, listingUrl, live }) {
    const rx = platform === 'ebay' ? /(angebot\s+)?beenden|end\s+(listing|item)/i : /^(anzeige\s+)?(löschen|entfernen)$/i;
    const idMatch = String(listingUrl || '').match(/(\d{7,})/g);
    const id = idMatch ? idMatch[idMatch.length - 1] : '';
    if (!id) return { found: false, clicked: false, note: 'Keine Inserats-ID in URL.' };

    const link = qsa(`a[href*="${id}"]`)[0];
    if (!link) return { found: false, clicked: false, note: 'Inserat nicht gefunden.' };

    let node = link, btn = null;
    for (let i = 0; i < 8 && node && !btn; i++) {
      node = node.parentElement;
      if (!node) break;
      btn = qsa('button, a, [role="button"], [role="menuitem"]', node).find((e) => rx.test(clean(e.textContent)));
    }
    if (!btn) {
      link.scrollIntoView({ block: 'center' });
      link.style.outline = '3px solid #f87171';
      return { found: false, clicked: false, note: 'Lösch-Knopf nicht gefunden.' };
    }
    btn.scrollIntoView({ block: 'center' });
    btn.style.outline = '3px solid #f87171';
    btn.style.outlineOffset = '2px';
    if (live) btn.click();
    return { found: true, clicked: !!live, note: live ? 'Klick ausgeführt.' : 'Dry-Run: markiert.' };
  }

  /* ============ CATEGORY MAPPER ============ */
  const CATEGORIES = {
    'Handy & Telefon': ['iphone', 'samsung galaxy', 'smartphone', 'pixel', 'xiaomi', 'oneplus', 'handy'],
    'Computer & Zubehör': ['laptop', 'notebook', 'pc', 'computer', 'tastatur', 'maus', 'monitor', 'ssd', 'webcam'],
    'TV, Audio & Kamera': ['fernseher', 'tv', 'kopfhörer', 'headset', 'lautsprecher', 'soundbar', 'airpods'],
    'Konsolen & Spiele': ['playstation', 'xbox', 'nintendo', 'switch', 'controller', 'konsole'],
    'Foto & Camcorder': ['kamera', 'objektiv', 'gopro', 'drohne', 'camcorder'],
    'Haushaltsgeräte': ['staubsauger', 'kaffeemaschine', 'mixer', 'küchenmaschine', 'toaster'],
    'Spielzeug': ['lego', 'playmobil', 'puppe', 'brettspiel', 'puzzle'],
    'Fahrräder': ['fahrrad', 'e-bike', 'ebike', 'mountainbike', 'helm'],
    'Kleidung': ['shirt', 'hose', 'jacke', 'schuhe', 'sneaker', 'tasche', 'gürtel'],
    'Beauty & Gesundheit': ['parfüm', 'creme', 'make-up', 'haartrockner', 'rasierer'],
    'Musikinstrumente': ['gitarre', 'keyboard', 'piano', 'mikrofon', 'mischpult'],
    'Auto & Motorrad': ['reifen', 'felge', 'motorrad', 'dachbox', 'helm']
  };
  function detectCategory(text) {
    const t = (text || '').toLowerCase();
    let best = null, bestScore = 0;
    for (const [cat, kws] of Object.entries(CATEGORIES)) {
      let score = 0;
      kws.forEach((k) => { if (t.includes(k)) score += k.length; });
      if (score > bestScore) { bestScore = score; best = cat; }
    }
    return best;
  }
  function applyCategory(name) {
    if (!name) return false;
    const selects = qsa('select').filter((s) => s.offsetParent !== null);
    for (const sel of selects) {
      const opts = Array.from(sel.options || []);
      const match = opts.find((o) => {
        const t = (o.textContent || '').toLowerCase().trim();
        const c = name.toLowerCase();
        return t === c || t.includes(c) || c.includes(t);
      });
      if (match) {
        sel.value = match.value;
        sel.dispatchEvent(new Event('input', { bubbles: true }));
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    }
    return false;
  }

  /* ============ FORM FILLER ============ */
  function setNative(el, value) {
    try {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
    } catch { el.value = value; }
    ['input', 'change', 'blur'].forEach((ev) => el.dispatchEvent(new Event(ev, { bubbles: true })));
  }

  const SELS = {
    kleinanzeigen: {
      title: ['#pco-title-input', 'input[name="title"]', 'input#postad-title', 'input[id*="title"]', 'input[name*="title"]', 'input[data-testid*="title"]', 'input[placeholder*="Titel"]', 'input[aria-label*="Titel"]'],
      price: ['#pco-price-input', 'input[name="price"]', 'input#postad-price', 'input[id*="price"]', 'input[name*="price"]', 'input[id*="preis"]', 'input[name*="preis"]', 'input[data-testid*="price"]', 'input[placeholder*="Preis"]', 'input[aria-label*="Preis"]', 'input[inputmode="numeric"]', 'input[type="number"]'],
      description: ['#pco-text-input', 'textarea[name="description"]', 'textarea#postad-description', 'textarea[id*="description"]', 'textarea[name*="description"]', 'textarea[id*="beschreibung"]', 'textarea[name*="beschreibung"]', 'textarea[data-testid*="description"]'],
      imageInput: ['input[type="file"][accept*="image"]', 'input[type="file"]']
    },
    ebay: {
      title: ['input#title', 'input[name="title"]'],
      price: ['input#binPrice', 'input#price', 'input[name="price"]'],
      description: ['textarea#description', 'textarea[name="description"]', 'iframe#desc_ifr'],
      imageInput: ['input[type="file"][accept*="image"]', 'input[type="file"]']
    }
  };

  function findEl(sels) {
    for (const s of sels) { const el = qs(s); if (el) return el; }
    return null;
  }

  /* V9.2: dataURL → natural-looking File */
  function dataUrlToNaturalFile(img, idx) {
    const [meta, b64] = img.dataUrl.split(',');
    const mime = (meta.match(/data:([^;]+);/) || [])[1] || 'image/jpeg';
    const bin = atob(b64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    const blob = new Blob([buf], { type: mime });
    const ext = (mime.split('/')[1] || 'jpg').replace('jpeg', 'jpg');

    const naturalNames = [
      `IMG_${20240 + idx}${String(Math.floor(Math.random() * 900) + 100)}.${ext}`,
      `IMG_${String(Math.floor(Math.random() * 9000) + 1000)}.${ext}`,
      `Photo_${idx + 1}.${ext}`
    ];
    const filename = naturalNames[idx % naturalNames.length];
    const pastMs = Date.now() - Math.floor(Math.random() * (60 - 2) * 86400000) - 2 * 86400000;
    return new File([blob], filename, { type: mime, lastModified: pastMs });
  }

  async function fillForm({ title, price, description, platform, images, autoCategory }) {
    const result = { filled: [], missing: [], imagesInjected: 0, categoryMatched: null, imageDetails: [] };
    const s = SELS[platform] || SELS.kleinanzeigen;

    /* Title */
    const tEl = findEl(s.title);
    if (tEl && title) { setNative(tEl, title); result.filled.push('Titel'); }
    else result.missing.push('Titel');

    /* Price — whole euros only */
    const pEl = findEl(s.price);
    if (pEl && price) {
      const n = parseGermanPrice(price);
      if (isFinite(n) && n > 0) {
        setNative(pEl, String(Math.ceil(n)));
        result.filled.push('Preis');
      } else result.missing.push('Preis');
    } else result.missing.push('Preis');

    /* Description */
    const dEl = findEl(s.description);
    if (dEl && description) {
      if (dEl.tagName === 'IFRAME') {
        try {
          const doc = dEl.contentDocument || dEl.contentWindow?.document;
          if (doc?.body) { doc.body.innerHTML = description.replace(/\n/g, '<br>'); result.filled.push('Beschreibung'); }
        } catch { result.missing.push('Beschreibung (iframe)'); }
      } else { setNative(dEl, description); result.filled.push('Beschreibung'); }
    } else result.missing.push('Beschreibung');

    /* Image injection — one at a time */
       if (Array.isArray(images) && images.length) {
      const fi = findEl(s.imageInput);
      if (!fi) {
        result.missing.push('Bild-Feld');
      } else {
        try {
          /* V9.3 — inject ALL files at once in one DataTransfer + one change event.
             Kleinanzeigen locks onto the first change event and clears the input
             afterwards, so per-file injection only lands the first image. */
          const dt = new DataTransfer();
          const toInject = images.slice(0, 8);
          let injected = 0;

          for (let idx = 0; idx < toInject.length; idx++) {
            const img = toInject[idx];
            if (!img?.dataUrl) continue;
            try {
              const file = dataUrlToNaturalFile(img, idx);
              dt.items.add(file);
              injected++;
              result.imageDetails.push({ index: idx, filename: file.name, size: file.size, ok: true });
            } catch (e) {
              result.imageDetails.push({ index: idx, ok: false, error: e.message });
            }
          }

          if (injected > 0) {
            /* One assignment, one event — Kleinanzeigen's React handler
               reads the full FileList and uploads every file in it. */
            fi.files = dt.files;
            fi.dispatchEvent(new Event('change', { bubbles: true }));
            result.imagesInjected = injected;
            result.filled.push(`${injected} Bilder`);
          } else {
            result.missing.push('Bilder (keine gültigen Daten)');
          }
        } catch (e) {
          result.missing.push('Bilder: ' + e.message);
        }
      }
    }

    /* Category auto-map */
    if (autoCategory && (title || description)) {
      const cat = detectCategory(`${title} ${description}`);
      if (cat && applyCategory(cat)) {
        result.categoryMatched = cat;
        result.filled.push(`Kategorie: ${cat}`);
      }
    }

    return result;
  }

  /* ============ MESSAGE ROUTER ============ */
  const isMarketplaceHost = () => /kleinanzeigen\.|ebay\.|vinted\./i.test(location.hostname);

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    (async () => {
      try {
        switch (msg?.action) {
          case 'ping':
            sendResponse({ ok: true, host: location.hostname });
            break;

          case 'scrapeProduct': {
            if (isMarketplaceHost()) {
              const a = await automationAllowed();
              if (!a.ok) { sendResponse({ ok: false, error: a.reason, killed: true, diagnostics: [] }); break; }
              showBanner();
            }
            sendResponse(scrapeProduct());
            break;
          }

          case 'scrapeKleinanzeigenInbox': {
            const a = await automationAllowed();
            if (!a.ok) { sendResponse({ ok: false, error: a.reason, killed: true }); break; }
            sendResponse(scrapeKleinanzeigenInbox());
            break;
          }

          case 'scrapeKleinanzeigenConversation': {
            const a = await automationAllowed();
            if (!a.ok) { sendResponse({ ok: false, error: a.reason, killed: true, messages: [] }); break; }
            sendResponse(scrapeKleinanzeigenConversation());
            break;
          }

          case 'fillForm': {
            const a = await automationAllowed();
            if (!a.ok) { sendResponse({ ok: false, error: a.reason, killed: true }); break; }
            showBanner();
            const data = msg.data || {};
            if (data.platform === 'vinted') {
              if (!window.__garloVinted) { sendResponse({ ok: false, error: 'Vinted-Modul nicht geladen' }); break; }
              sendResponse({ ok: true, result: await window.__garloVinted.fill(data) });
            } else {
              const result = await fillForm(data);
              sendResponse({ ok: true, result });
            }
            break;
          }

          case 'fillReply': {
            const a = await automationAllowed();
            if (!a.ok) { sendResponse({ ok: false, error: a.reason, killed: true }); break; }
            showBanner('🤖 Garlo: Antwort-Text wird eingefügt (nicht abgeschickt).');
            sendResponse(fillReply(msg.data || {}));
            break;
          }

          case 'delistAssist': {
            const a = await automationAllowed();
            if (!a.ok) { sendResponse({ ok: false, error: a.reason, killed: true }); break; }
            showBanner('🤖 Garlo: Assisted Delist' + (msg.live ? ' (LIVE)' : ' (Dry-Run)'));
            const r = msg.platform === 'vinted' && window.__garloVinted
              ? window.__garloVinted.delistAssist({ live: msg.live })
              : delistAssist(msg);
            sendResponse({ ok: true, ...r });
            break;
          }

          default:
            sendResponse({ ok: false, error: 'Unbekannte Aktion' });
        }
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  });
})();