/* Garlo AI Selling — background.js (v9.0 — final)
   Service worker. Owns Gemini calls (with V9 fixes), inventory routing,
   publish auto-save, storage quota, bulk queue, price watcher, eBay poll,
   inbox poll, ledger auto-record.

   V9.0 FINAL:
     • updateStatus now records to ledger when status → sold
     • eBay order polling records to ledger
     • migrateLedgerV9 runs on install to backfill from prior sold items
     • All V9 Gemini fixes (22s timeout, 4 models, no 2nd pass, 2048 tokens) */

import * as Store from './modules/inventory-store.js';
import * as Guard from './modules/guard.js';
import * as Ledger from './modules/ledger.js';
import * as PriceWatcher from './modules/price-watcher.js';
import * as BulkQueue from './modules/bulk-queue.js';
import * as PublishWatch from './modules/publish-watch.js';
import * as EbayApi from './modules/ebay-api.js';
import * as Messenger from './modules/messenger.js';
import * as InboxPoller from './modules/inbox-poller.js';
import * as ReplyTemplates from './modules/reply-templates.js';
import * as BuyerProfile from './modules/buyer-profile.js';
import { notify } from './modules/notify.js';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

const PREFERRED_ORDER = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash-lite',
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-2.0-flash-001'
];

const FIRST_PASS_LIMIT = 4;
const FALLBACK_MODEL_LIST = [
  'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash-lite', 'gemini-3.8-flash'
];
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const PER_CALL_TIMEOUT_MS = 22000;
const TOTAL_BUDGET_MS = 90000;
const DEFAULT_MAX_OUTPUT_TOKENS = 2048;
const STORAGE_LIMIT_BYTES = 10 * 1024 * 1024;

const get = (k) => new Promise((r) => chrome.storage.local.get(k, r));
const set = (o) => new Promise((r) => chrome.storage.local.set(o, r));

/* ============================================================ MODELS */
let cachedModels = null, cachedModelsAt = 0;

async function fetchAvailableModels(apiKey, forceRefresh = false) {
  if (!forceRefresh && cachedModels && Date.now() - cachedModelsAt < 5 * 60 * 1000) return cachedModels;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(`${API_BASE}/models?key=${encodeURIComponent(apiKey)}&pageSize=200`, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} bei models.list`);
    const j = await res.json();
    const list = (j.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => (m.name || '').replace(/^models\//, ''))
      .filter((m) => !/(tts|audio|speech|embedding|aqa|transcribe|live|imagen|veo)/i.test(m));
    if (!list.length) throw new Error('Keine Text-Modelle zurückgegeben');
    cachedModels = list;
    cachedModelsAt = Date.now();
    return list;
  } finally { clearTimeout(timeoutId); }
}

function rankModels(available) {
  const avail = new Set(available);
  const ranked = [];
  PREFERRED_ORDER.forEach((m) => { if (avail.has(m)) ranked.push(m); });
  available.filter((m) => /flash/i.test(m) && !ranked.includes(m))
    .sort((a, b) => {
      const av = (a.match(/(\d+)\.(\d+)/) || [])[0] || '0';
      const bv = (b.match(/(\d+)\.(\d+)/) || [])[0] || '0';
      return bv.localeCompare(av, undefined, { numeric: true });
    })
    .forEach((m) => ranked.push(m));
  available.filter((m) => !ranked.includes(m)).forEach((m) => ranked.push(m));
  return ranked;
}

function buildTryList(userPreferred, available) {
  const ranked = rankModels(available);
  if (!userPreferred || userPreferred === '__auto__') return ranked;
  if (ranked.includes(userPreferred)) return [userPreferred, ...ranked.filter((m) => m !== userPreferred)];
  return [userPreferred, ...ranked];
}

async function probeHealth(apiKey) {
  if (!apiKey) return { ok: false, reason: 'Kein API Key', activeModel: null, available: [] };
  try {
    const available = await fetchAvailableModels(apiKey);
    const ranked = rankModels(available);
    return { ok: ranked.length > 0, activeModel: ranked[0] || null, available, reason: ranked.length ? 'OK' : 'Keine Text-Modelle verfügbar' };
  } catch (e) { return { ok: false, reason: e.message, activeModel: null, available: [] }; }
}

/* ============================================================ GEMINI */
async function callGemini(apiKey, model, prompt, opts = {}) {
  const {
    temperature = 0.7, topP = 0.95,
    maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS,
    responseMimeType = 'application/json'
  } = opts;

  const url = `${API_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const generationConfig = { temperature, topP, maxOutputTokens };
  if (responseMimeType) generationConfig.responseMimeType = responseMimeType;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PER_CALL_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig }),
      signal: controller.signal
    });
  } catch (netErr) {
    const isAbort = netErr.name === 'AbortError';
    const err = new Error(isAbort ? `Timeout nach ${Math.round(PER_CALL_TIMEOUT_MS / 1000)} s` : 'Netzwerkfehler: ' + netErr.message);
    err.status = isAbort ? 408 : 0;
    err.isTransient = true;
    err.isModelIssue = false;
    throw err;
  } finally { clearTimeout(timeoutId); }

  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error?.message || ''; } catch (_) {}
    const err = new Error(`[${res.status}] ${detail || res.statusText}`);
    err.status = res.status;
    err.detail = detail;
    err.isModelIssue = res.status === 404 ||
      /model.*(not found|no longer available|is not supported|does not exist)/i.test(detail) ||
      /response modalities|AUDIO/i.test(detail);
    err.isTransient = RETRYABLE_STATUS.has(res.status) ||
      /high demand|overloaded|temporarily unavailable|try again|rate limit/i.test(detail);
    throw err;
  }

  const json = await res.json();
  const text = (json?.candidates?.[0]?.content?.parts || []).map((p) => p.text).filter(Boolean).join('\n');
  if (!text) {
    const err = new Error('Leere Antwort.');
    err.status = 200; err.isTransient = true;
    throw err;
  }
  return text;
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function generateWithFallback({ apiKey, preferredModel, prompt, opts }) {
  const tried = [];
  const startedAt = Date.now();
  let available;
  try { available = await fetchAvailableModels(apiKey, false); }
  catch { available = PREFERRED_ORDER.slice(); }
  const tryList = buildTryList(preferredModel, available).slice(0, FIRST_PASS_LIMIT);

  for (let i = 0; i < tryList.length; i++) {
    if (Date.now() - startedAt > TOTAL_BUDGET_MS) {
      return {
        ok: false,
        error: `Zeitbudget überschritten (${Math.round(TOTAL_BUDGET_MS / 1000)} s).\n\nVersuche:\n` +
          tried.map((t) => `• ${t.model}: ${t.error}`).join('\n'),
        tried
      };
    }
    const model = tryList[i];
    try {
      const text = await callGemini(apiKey, model, prompt, opts);
      return { ok: true, text, model, tried, pass: 1 };
    } catch (e) {
      tried.push({ model, error: e.message, status: e.status });
      if (e.status === 400 && /API key/i.test(e.detail || '')) return { ok: false, error: 'Ungültiger API Key.', tried };
      if (e.status === 401 || e.status === 403) return { ok: false, error: e.message, tried };
      if (e.isTransient && i < tryList.length - 1) await delay(300);
    }
  }

  return {
    ok: false,
    error: 'Alle Gemini-Modelle waren nicht erreichbar oder haben zu lange gebraucht.\n' +
      'Bitte in Konfiguration ein anderes Modell wählen, oder in 1–2 Minuten erneut versuchen.\n\n' +
      'Versuche:\n' + tried.map((t) => `• ${t.model}: ${t.error}`).join('\n'),
    tried
  };
}

async function callGeminiVision({ apiKey, model, dataUrl, language }) {
  const prompt = language === 'EN'
    ? 'Generate a short, factual, SEO-optimized alt-text for this product image. Max 12 words.'
    : language === 'FR'
    ? 'Génère un texte alternatif court et factuel pour cette image produit. Max 12 mots.'
    : 'Erstelle einen kurzen, sachlichen, SEO-optimierten Alt-Text für dieses Produktbild. Max 12 Wörter.';
  const [meta, b64] = dataUrl.split(',');
  const mime = (meta.match(/data:([^;]+);/) || [])[1] || 'image/jpeg';
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PER_CALL_TIMEOUT_MS);
  try {
    const url = `${API_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType: mime, data: b64 } }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 60 }
      }),
      signal: controller.signal
    });
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json())?.error?.message || ''; } catch (_) {}
      throw new Error(`Vision API [${res.status}]: ${detail || res.statusText}`);
    }
    const json = await res.json();
    const text = (json?.candidates?.[0]?.content?.parts || []).map((p) => p.text).filter(Boolean).join(' ').trim();
    return text.replace(/^["']|["']$/g, '');
  } finally { clearTimeout(timeoutId); }
}

async function callGeminiTranslate({ apiKey, model, scraped }) {
  const prompt = `Übersetze die folgenden Produktdaten aus dem Englischen ins Deutsche. Behalte Markennamen unverändert.\n\nTitel: ${scraped.title}\nMarke: ${scraped.brand || ''}\nFeatures:\n${scraped.features || '(keine)'}\n\nAntworte NUR mit JSON:\n{"title": "...", "brand": "...", "features": "- Punkt 1\\n- Punkt 2\\n..."}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PER_CALL_TIMEOUT_MS);
  try {
    const url = `${API_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 1024, responseMimeType: 'application/json' }
      }),
      signal: controller.signal
    });
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json())?.error?.message || ''; } catch (_) {}
      throw new Error(`Translate API [${res.status}]: ${detail || res.statusText}`);
    }
    const json = await res.json();
    const text = (json?.candidates?.[0]?.content?.parts || []).map((p) => p.text).filter(Boolean).join('\n');
    const s = text.indexOf('{'), e = text.lastIndexOf('}');
    if (s === -1 || e === -1) throw new Error('Kein JSON in Antwort');
    return JSON.parse(text.slice(s, e + 1));
  } finally { clearTimeout(timeoutId); }
}

/* ============================================================ PROMPT */
function buildPrompt({ scraped, tone, purchasePrice, targetPrice, shippingTier, legal, listingLanguage, customTemplate }) {
  if (customTemplate) {
    const toneDesc = { conservative: 'Sachlich, faktenbasiert, knapp.', balanced: 'Freundlich, professionell.', creative: 'Sympathisch, warm, mit persönlicher Note.' }[tone] || 'Freundlich.';
    return customTemplate
      .replace(/\{\{toneDesc\}\}/g, toneDesc)
      .replace(/\{\{title\}\}/g, scraped.title || '')
      .replace(/\{\{brand\}\}/g, scraped.brand || '')
      .replace(/\{\{price\}\}/g, scraped.price || '')
      .replace(/\{\{features\}\}/g, scraped.features || '')
      .replace(/\{\{purchasePrice\}\}/g, purchasePrice || '')
      .replace(/\{\{targetPrice\}\}/g, targetPrice || '')
      .replace(/\{\{shipping\}\}/g, shippingTier || 'Versand zzgl. Versandkosten');
  }

  const brand = scraped.brand || '(unbekannt)';
  let target = '';
  if (targetPrice) {
    const n = parseFloat(String(targetPrice).replace(',', '.'));
    if (isFinite(n) && n > 0) target = String(Math.ceil(n));
  } else if (purchasePrice) {
    const n = parseFloat(String(purchasePrice).replace(',', '.'));
    if (isFinite(n) && n > 0) target = String(Math.ceil(n * 2));
  }
  const shipping = shippingTier || 'DHL Paket';
  const langInstr = (listingLanguage === 'EN' || listingLanguage === 'FR')
    ? `\n\nWICHTIG: Schreibe Titel und Beschreibung auf ${listingLanguage === 'EN' ? 'ENGLISCH' : 'FRANZÖSISCH'}. Behalte deutsche Rechtstexte auf DEUTSCH.`
    : '';

  return `Du bist ein professioneller Verkaufsassistent für Kleinanzeigen. Generiere aus den Produktdaten eine fertige Anzeige auf Deutsch.

FORMAT (exakt einhalten):
Titel: prägnant, Marke + Hauptmerkmal + "Neu & OVP", max 65 Zeichen.
Beschreibung:
Hallo! Ich verkaufe hier eine brandneue und originalverpackte [Produktname].

[Einleitungssatz 1-2 Sätze]

*Die wichtigsten Details im Überblick:*
* *Marke:* ${brand}
* [4-6 technische Stichpunkte]
* *Zustand:* Neu und originalverpackt (Neu & OVP).

*Versand & Zahlung:*
* *Nur Versand* (${shipping}). Keine Abholung möglich.
* Zahlung per Überweisung oder PayPal.

Keine Tauschangebote.

Privatverkauf unter Ausschluss der Sachmängelhaftung. Keine Rücknahme oder Garantie meinerseits.

=== PRODUKTDATEN ===
Titel: ${scraped.title}
Marke: ${brand}
Amazon-Preis: ${scraped.price || 'unbekannt'}
Features:
${scraped.features || '(keine)'}

=== PREIS ===
EK: ${purchasePrice || '(nicht angegeben)'}
${target ? `VK: ${target} EUR (ganze Euro). Verwende diesen Wert EXAKT.` : 'Schlage einen marktüblichen VK in ganzen Euro vor.'}

REGELN:
1. Beschreibung beginnt mit "Hallo! Ich verkaufe hier eine brandneue und originalverpackte".
2. Listenzeichen: NUR "* ". Kein "-", kein "•", kein "**".
3. Sternchen um: "Die wichtigsten Details im Überblick:", "Marke:", "Zustand:", "Versand & Zahlung:", "Nur Versand:".
4. Keine zusätzlichen Überschriften.
5. Keine erfundenen Details.
6. Preis im JSON als ganze Zahl: "50" nicht "50,00".
7. Antworte NUR mit JSON: {"title": "…", "price": "50", "description": "… mit \\n"}${langInstr}`;
}

function sanitizeDescription(desc) {
  if (!desc) return '';
  return String(desc)
    .replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/i, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/^\s*#+\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
function extractJson(text) {
  if (!text) return null;
  let t = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const s = t.indexOf('{'), e = t.lastIndexOf('}');
  if (s === -1 || e === -1) return null;
  try { return JSON.parse(t.slice(s, e + 1)); } catch { return null; }
}
function normalizePrice(p) {
  if (p == null || p === '') return '';
  const s = String(p).replace(/\s/g, '').replace(',', '.');
  const n = parseFloat(s.replace(/[^\d.\-]/g, ''));
  if (!isFinite(n) || n <= 0) return '';
  return String(Math.ceil(n));
}

/* ============================================================ PUBLISH COMPLETE */
function buildPublishedItem(payload) {
  const now = Date.now();
  return {
    id: 'g-' + now + '-' + Math.random().toString(36).slice(2, 8),
    title: (payload.title || '').trim(),
    price: (payload.price || '').trim(),
    description: payload.description || '',
    platform: payload.platform || 'kleinanzeigen',
    condition: payload.condition || 'Neu & OVP',
    purchasePrice: payload.purchasePrice || '',
    targetPrice: payload.targetPrice || payload.price || '',
    shippingTier: payload.shippingTier || '',
    legal: payload.legal || null,
    status: 'listed', listedAt: now,
    tone: payload.tone || 'balanced',
    variants: payload.variants || {},
    imageCount: payload.imageCount || 0,
    sourceTitle: payload.sourceTitle || '',
    sourceBrand: payload.sourceBrand || '',
    originalUrl: payload.originalUrl || '',
    sourceImages: Array.isArray(payload.sourceImages) ? payload.sourceImages.slice(0, 8) : [],
    publishedTo: {},
    createdAt: now, updatedAt: now
  };
}
function findExistingItem(inventory, payload) {
  if (payload.itemId) {
    const i = inventory.findIndex((x) => x.id === payload.itemId);
    if (i >= 0) return i;
  }
  if (payload.originalUrl) {
    const i = inventory.findIndex((x) => x.originalUrl === payload.originalUrl);
    if (i >= 0) return i;
  }
  if (payload.sourceTitle) {
    const i = inventory.findIndex((x) => x.sourceTitle && x.sourceTitle === payload.sourceTitle);
    if (i >= 0) return i;
  }
  return -1;
}

/* ============================================================ STORAGE */
async function getStorageBreakdown() {
  const keys = ['inventory','imageCache','messages','auditLog','buyerProfiles','inbox','promptPresets','replyTemplates','ledger'];
  const breakdown = {};
  let totalBytes = 0;
  try {
    totalBytes = await chrome.storage.local.getBytesInUse(null);
    for (const k of keys) {
      try { breakdown[k] = await chrome.storage.local.getBytesInUse(k); }
      catch { breakdown[k] = 0; }
    }
  } catch { totalBytes = -1; }
  return {
    total: totalBytes,
    totalMB: totalBytes > 0 ? totalBytes / 1048576 : 0,
    limitMB: 10,
    percent: totalBytes > 0 ? (totalBytes / STORAGE_LIMIT_BYTES) * 100 : 0,
    breakdown
  };
}

async function cleanupStorage({ aggressive = false } = {}) {
  const summary = { freed: 0, actions: [] };
  const before = await chrome.storage.local.getBytesInUse(null).catch(() => 0);
  try {
    const d = await get(['imageCache']);
    const images = Array.isArray(d.imageCache) ? d.imageCache : [];
    const cap = aggressive ? 12 : 24;
    if (images.length > cap) { await set({ imageCache: images.slice(0, cap) }); summary.actions.push(`imageCache: ${images.length} → ${cap}`); }
  } catch { /* ignore */ }
  try {
    const d = await get(['auditLog']);
    const log = Array.isArray(d.auditLog) ? d.auditLog : [];
    const cap = aggressive ? 200 : 500;
    if (log.length > cap) { await set({ auditLog: log.slice(0, cap) }); summary.actions.push(`auditLog: ${log.length} → ${cap}`); }
  } catch { /* ignore */ }
  try {
    const d = await get(['messages','inbox']);
    const messages = d.messages || {};
    const inbox = d.inbox || { conversations: [] };
    const keep = new Set((inbox.conversations || []).map((c) => c.id));
    const pruned = {}; let removedConvos = 0, removedMsgs = 0;
    for (const [cid, arr] of Object.entries(messages)) {
      if (!keep.has(cid)) { removedConvos++; continue; }
      if (!Array.isArray(arr)) continue;
      if (arr.length > 60) { removedMsgs += arr.length - 60; pruned[cid] = arr.slice(-60); }
      else pruned[cid] = arr;
    }
    if (removedConvos || removedMsgs) {
      await set({ messages: pruned });
      summary.actions.push(`messages: −${removedConvos} Convos, −${removedMsgs} msgs`);
    }
  } catch { /* ignore */ }
  try {
    const d = await get(['buyerProfiles']);
    const profiles = d.buyerProfiles || {};
    const entries = Object.entries(profiles);
    const cap = aggressive ? 100 : 200;
    if (entries.length > cap) {
      entries.sort((a, b) => (b[1]?.lastSeen || 0) - (a[1]?.lastSeen || 0));
      await set({ buyerProfiles: Object.fromEntries(entries.slice(0, cap)) });
      summary.actions.push(`buyerProfiles: ${entries.length} → ${cap}`);
    }
  } catch { /* ignore */ }
  const after = await chrome.storage.local.getBytesInUse(null).catch(() => 0);
  summary.freed = Math.max(0, before - after);
  summary.freedMB = summary.freed / 1048576;
  return summary;
}

/* ============================================================ MESSAGE ROUTER */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg?.action) {
        case 'probeHealth': {
          const { apiKey } = await get(['apiKey']);
          sendResponse({ ok: true, health: await probeHealth(apiKey) });
          break;
        }
        case 'listModels': {
          const key = msg.apiKey;
          if (!key) { sendResponse({ ok: false, error: 'Kein API Key eingegeben.' }); break; }
          try {
            const models = await fetchAvailableModels(key, true);
            sendResponse({ ok: true, models });
          } catch (e) {
            sendResponse({ ok: true, models: FALLBACK_MODEL_LIST.slice(), fallback: true, reason: e.message });
          }
          break;
        }
        case 'generateVariants': {
          const { apiKey, modelPreference } = await get(['apiKey', 'modelPreference']);
          if (!apiKey) { sendResponse({ ok: false, error: 'Kein API Key. In Dashboard → Konfiguration eintragen.' }); break; }
          const tones = msg.tones || ['balanced'];
          const results = {};
          for (const tone of tones) {
            const prompt = buildPrompt({ ...msg, tone });
            const r = await generateWithFallback({ apiKey, preferredModel: modelPreference, prompt });
            if (!r.ok) { results[tone] = { ok: false, error: r.error }; continue; }
            const parsed = extractJson(r.text);
            if (!parsed) { results[tone] = { ok: false, error: 'JSON parse fehlgeschlagen' }; continue; }
            results[tone] = {
              ok: true, model: r.model, pass: r.pass,
              title: parsed.title || '',
              price: normalizePrice(parsed.price || msg.targetPrice || ''),
              description: sanitizeDescription(parsed.description || '')
            };
          }
          sendResponse({ ok: true, results });
          break;
        }
        case 'generateAltText': {
          const { apiKey, modelPreference } = await get(['apiKey', 'modelPreference']);
          if (!apiKey) { sendResponse({ ok: false, error: 'Kein API Key' }); break; }
          try {
            const text = await callGeminiVision({
              apiKey,
              model: modelPreference && modelPreference !== '__auto__' ? modelPreference : 'gemini-2.5-flash',
              dataUrl: msg.dataUrl, language: msg.language || 'DE'
            });
            sendResponse({ ok: true, text });
          } catch (e) { sendResponse({ ok: false, error: e.message }); }
          break;
        }
        case 'translateProduct': {
          const { apiKey, modelPreference } = await get(['apiKey', 'modelPreference']);
          if (!apiKey) { sendResponse({ ok: false, error: 'Kein API Key' }); break; }
          try {
            const translated = await callGeminiTranslate({
              apiKey,
              model: modelPreference && modelPreference !== '__auto__' ? modelPreference : 'gemini-2.5-flash',
              scraped: msg.scraped
            });
            sendResponse({ ok: true, ...translated });
          } catch (e) { sendResponse({ ok: false, error: e.message }); }
          break;
        }
        case 'generateReplyDraft': {
          const { apiKey, modelPreference } = await get(['apiKey', 'modelPreference']);
          if (!apiKey) { sendResponse({ ok: false, error: 'Kein API Key' }); break; }
          try {
            const r = await generateWithFallback({
              apiKey, preferredModel: modelPreference, prompt: msg.prompt,
              opts: { temperature: 0.55, topP: 0.9, maxOutputTokens: 400, responseMimeType: null }
            });
            if (!r.ok) { sendResponse({ ok: false, error: r.error }); break; }
            sendResponse({ ok: true, text: (r.text || '').trim(), model: r.model });
          } catch (e) { sendResponse({ ok: false, error: e.message }); }
          break;
        }

        case 'getInventory': {
          await Store.migrateV7();
          const { inventory = [] } = await get(['inventory']);
          sendResponse({ ok: true, inventory });
          break;
        }
        case 'saveInventoryItem': {
          const { inventory = [] } = await get(['inventory']);
          const item = { ...msg.item, id: msg.item.id || ('g-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)) };
          const idx = inventory.findIndex((x) => x.id === item.id);
          if (idx >= 0) inventory[idx] = { ...inventory[idx], ...item, updatedAt: Date.now() };
          else inventory.unshift({ ...item, createdAt: Date.now(), updatedAt: Date.now() });
          await set({ inventory: inventory.slice(0, 500) });
          sendResponse({ ok: true, item });
          break;
        }
        case 'deleteInventoryItem': {
          const { inventory = [] } = await get(['inventory']);
          await set({ inventory: inventory.filter((x) => x.id !== msg.id) });
          sendResponse({ ok: true });
          break;
        }

        /* V9 — updateStatus now records ledger on sold transition */
        case 'updateStatus': {
          const { inventory = [] } = await get(['inventory']);
          const idx = inventory.findIndex((x) => x.id === msg.id);
          let needsReview = false;
          let ledgerItem = null;
          if (idx >= 0) {
            const it = inventory[idx];
            const prev = it.status;
            it.status = msg.status;
            it.updatedAt = Date.now();
            if (msg.status === 'sold' && prev !== 'sold') {
              it.soldAt = Date.now();
              needsReview = Object.values(it.publishedTo || {}).some((p) => ['live', 'unknown', 'delist-requested'].includes(p.status));
              it.needsDelistReview = needsReview;
              it.delistDismissed = false;
              ledgerItem = { ...it };
            }
            if (msg.status === 'listed' && !it.listedAt) it.listedAt = Date.now();
            if (msg.status !== 'sold') it.needsDelistReview = false;
            await set({ inventory });
          }
          /* Ledger record — awaited so Analytics sees it immediately */
          if (ledgerItem) {
            try {
              await Ledger.recordSale({
                item: ledgerItem,
                soldPrice: ledgerItem.soldPrice || ledgerItem.targetPrice || ledgerItem.price,
                source: 'auto-status'
              });
            } catch (e) { console.warn('ledger record failed', e); }
          }
          sendResponse({ ok: true, needsDelistReview: needsReview });
          break;
        }

        case 'invStore': {
          if (!Store.REMOTE_OPS.has(msg.op)) { sendResponse({ ok: false, error: 'Op nicht erlaubt' }); break; }
          sendResponse({ ok: true, result: await Store[msg.op](...(msg.args || [])) });
          break;
        }
        case 'importInventory': {
          const { inventory = [] } = await get(['inventory']);
          const incoming = Array.isArray(msg.items) ? msg.items : [];
          const ids = new Set(inventory.map((x) => x.id));
          const merged = [...inventory]; let added = 0;
          for (const raw of incoming) {
            if (!raw || typeof raw !== 'object') continue;
            const id = raw.id || ('g-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8));
            if (ids.has(id)) continue;
            merged.push({ ...raw, id }); ids.add(id); added++;
          }
          await set({ inventory: merged.slice(0, 500) });
          sendResponse({ ok: true, added });
          break;
        }

        /* V9 — publishComplete */
        case 'publishComplete': {
          const now = Date.now();
          const payload = msg.payload || {};
          const { inventory = [] } = await get(['inventory']);
          const existingIdx = findExistingItem(inventory, payload);
          let item, action;
          if (existingIdx >= 0) {
            item = { ...inventory[existingIdx] };
            item.status = 'listed';
            if (!item.listedAt) item.listedAt = now;
            item.updatedAt = now;
            if (payload.title) item.title = payload.title;
            if (payload.price) item.price = payload.price;
            if (payload.targetPrice) item.targetPrice = payload.targetPrice;
            if (payload.description) item.description = payload.description;
            if (!item.sourceImages?.length && Array.isArray(payload.sourceImages)) item.sourceImages = payload.sourceImages.slice(0, 8);
            item.publishedTo = { ...(item.publishedTo || {}) };
            item.publishedTo[payload.platform] = { status: 'live', url: payload.url || '', ts: now, source: 'publish-complete' };
            inventory[existingIdx] = item;
            action = 'updated';
          } else {
            item = buildPublishedItem(payload);
            item.publishedTo[payload.platform] = { status: 'live', url: payload.url || '', ts: now, source: 'publish-complete' };
            inventory.unshift(item);
            action = 'created';
          }
          await set({ inventory: inventory.slice(0, 500) });
          sendResponse({ ok: true, item, action });
          break;
        }

        /* V9 — storage quota */
        case 'getStorageUsage': {
          const usage = await getStorageBreakdown();
          sendResponse({ ok: true, usage });
          break;
        }
        case 'cleanupStorage': {
          const summary = await cleanupStorage({ aggressive: !!msg.aggressive });
          sendResponse({ ok: true, summary });
          break;
        }

        /* Bulk queue */
        case 'queueGet':           sendResponse({ ok: true, queue: await BulkQueue.getQueue(), now: Date.now() }); break;
        case 'queueEnqueue':       sendResponse({ ok: true, ...(await BulkQueue.enqueue(msg.itemIds, msg.platform)) }); break;
        case 'queueStart':         { const r = await BulkQueue.start(); sendResponse({ ok: !r.error, ...r }); break; }
        case 'queuePause':         sendResponse({ ok: true, ...(await BulkQueue.pause('user')) }); break;
        case 'queueRetry':         sendResponse({ ok: true, ...(await BulkQueue.retry(msg.qid)) }); break;
        case 'queueRemove':        sendResponse({ ok: true, ...(await BulkQueue.remove(msg.qid)) }); break;
        case 'queueClearFinished': sendResponse({ ok: true, ...(await BulkQueue.clearFinished()) }); break;
        case 'queueMarkDone':      sendResponse({ ok: true, ...(await BulkQueue.markDone(msg.qid, msg.url || '')) }); break;

        /* Price watcher + publish watch */
        case 'priceWatcherRun':    sendResponse({ ok: true, summary: await PriceWatcher.runPriceWatcher({ reason: msg.reason || 'manual' }) }); break;
        case 'watchRegister':      await PublishWatch.register(msg.tabId, { itemId: msg.itemId, platform: msg.platform }); sendResponse({ ok: true }); break;

        /* Inbox */
        case 'inboxGetConversations': sendResponse({ ok: true, conversations: await Messenger.getConversations(), lastSync: await Messenger.getLastSync() }); break;
        case 'inboxSync': { const r = await Messenger.syncConversations(); sendResponse(r); break; }
        case 'inboxGetMessages': sendResponse({ ok: true, messages: await Messenger.getMessages(msg.conversationId) }); break;
        case 'inboxSyncMessages': { const r = await Messenger.syncMessages(msg.conversationId, msg.conversationUrl); sendResponse(r); break; }
        case 'inboxMarkRead': await Messenger.markRead(msg.conversationId); sendResponse({ ok: true }); break;
        case 'inboxMarkAllRead': await Messenger.markAllRead(); sendResponse({ ok: true }); break;
        case 'inboxClear': await Messenger.clearAllMessages(); sendResponse({ ok: true }); break;
        case 'inboxFillReply': { const r = await Messenger.fillReply(msg.conversationUrl, msg.text); sendResponse(r); break; }
        case 'pollerStatus': { const enabled = await InboxPoller.isEnabled(); sendResponse({ ok: true, enabled }); break; }
        case 'pollerSetEnabled': { const settings = await InboxPoller.setEnabled(!!msg.enabled); sendResponse({ ok: true, settings }); break; }
        case 'pollerRunNow': { const r = await InboxPoller.runPoll(); sendResponse({ ok: true, result: r }); break; }

        /* Templates */
        case 'templatesList': sendResponse({ ok: true, templates: await ReplyTemplates.listTemplates() }); break;
        case 'templatesSave': { const t = await ReplyTemplates.saveTemplate(msg.template || {}); sendResponse({ ok: true, template: t }); break; }
        case 'templatesDelete': await ReplyTemplates.deleteTemplate(msg.id); sendResponse({ ok: true }); break;

        /* Buyer profiles */
        case 'buyerGet': { const p = await BuyerProfile.getProfile(msg.buyerName); sendResponse({ ok: true, profile: p }); break; }
        case 'buyerGetAll': { const map = await BuyerProfile.getProfileMap(); sendResponse({ ok: true, profiles: map }); break; }
        case 'buyerRecordMessage': await BuyerProfile.recordMessage(msg.buyerName, { from: msg.from }); sendResponse({ ok: true }); break;
        case 'buyerMarkSold': await BuyerProfile.markSold(msg.buyerName, msg.sold); sendResponse({ ok: true }); break;
        case 'buyerMarkDeclined': await BuyerProfile.markDeclined(msg.buyerName, msg.declined); sendResponse({ ok: true }); break;
        case 'buyerSetNote': await BuyerProfile.setNote(msg.buyerName, msg.note); sendResponse({ ok: true }); break;

        case 'syncKleinanzeigenInbox': { const r = await Messenger.syncConversations(); sendResponse(r); break; }

        default:
          sendResponse({ ok: false, error: 'Unbekannte Aktion: ' + msg?.action });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e?.message || String(e) });
    }
  })();
  return true;
});

/* ============================================================ ALARMS */
const EBAY_ALARM = 'garlo-ebay-orders';
const CLEANUP_ALARM = 'garlo-storage-cleanup';

async function ensureAlarms() {
  await PriceWatcher.ensureAlarm();
  if (!(await chrome.alarms.get(EBAY_ALARM))) await chrome.alarms.create(EBAY_ALARM, { delayInMinutes: 5, periodInMinutes: 30 });
  if (!(await chrome.alarms.get(CLEANUP_ALARM))) await chrome.alarms.create(CLEANUP_ALARM, { delayInMinutes: 60, periodInMinutes: 24 * 60 });
  await InboxPoller.ensureAlarm();
  const q = await BulkQueue.getQueue();
  if (q.state === 'running' && !(await chrome.alarms.get(BulkQueue.ALARM))) {
    await chrome.alarms.create(BulkQueue.ALARM, { delayInMinutes: 0.5, periodInMinutes: 1 });
  }
}

/* ============================================================ INSTALL */
chrome.runtime.onInstalled.addListener(async () => {
  const d = await get(['inventory', 'modelPreference', 'inbox']);
  const init = {};
  if (!d.inventory) init.inventory = [];
  if (!d.modelPreference) init.modelPreference = 'gemini-2.5-flash';
  if (!d.inbox) init.inbox = { conversations: [], lastSync: 0 };
  if (Object.keys(init).length) await set(init);
  await Store.migrateV7();
  await ReplyTemplates.ensureTemplatesSeeded();
  /* V9 — backfill ledger from prior sold items */
  try {
    const { inventory = [] } = await get(['inventory']);
    const r = await Ledger.migrateLedgerV9(inventory);
    if (r.added > 0) await notify('garlo-ledger-migrated', 'Ledger-Migration', `${r.added} frühere Verkäufe ins Ledger übernommen.`);
  } catch (e) { console.warn('ledger migration failed', e); }
  await ensureAlarms();
});

/* ============================================================ STARTUP */
chrome.runtime.onStartup.addListener(() => {
  ensureAlarms().catch(() => {});
  PriceWatcher.runPriceWatcher({ reason: 'startup' }).catch(() => {});
  InboxPoller.isEnabled().then((on) => { if (on) InboxPoller.runPoll().catch(() => {}); }).catch(() => {});
});

/* ============================================================ ALARMS */
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === BulkQueue.ALARM) {
    BulkQueue.tick().catch((e) => console.warn('queue tick', e));
  } else if (alarm.name === PriceWatcher.ALARM) {
    PriceWatcher.runPriceWatcher({ reason: 'alarm' }).catch((e) => console.warn('price watcher', e));
  } else if (alarm.name === EBAY_ALARM) {
    (async () => {
      const st = await EbayApi.getApiStatus();
      if (!st.apiMode) return;
      const r = await EbayApi.pollOrders();
      if (r.matched) {
        /* V9 — ledger backfill for eBay-detected sales */
        try {
          const { inventory = [] } = await get(['inventory']);
          const soldItems = inventory.filter((x) => x.status === 'sold' && x.soldOn === 'ebay');
          for (const item of soldItems.slice(0, r.matched)) {
            await Ledger.recordSale({
              item,
              soldPrice: item.soldPrice || item.targetPrice || item.price,
              source: 'auto-ebay'
            });
          }
        } catch (e) { console.warn('ledger from ebay', e); }
        await notify('garlo-ebay-sold', 'eBay: Verkauf erkannt', `${r.matched} Artikel als verkauft markiert — Delist prüfen.`);
      }
    })().catch((e) => { if (e?.code !== 'RATE_LIMIT') console.warn('ebay poll', e); });
  } else if (alarm.name === InboxPoller.ALARM) {
    InboxPoller.runPoll().catch((e) => { if (e?.code !== 'RATE_LIMIT') console.warn('inbox poll', e); });
  } else if (alarm.name === CLEANUP_ALARM) {
    (async () => {
      const usage = await getStorageBreakdown();
      if (usage.percent >= 70) {
        const summary = await cleanupStorage({ aggressive: usage.percent >= 85 });
        if (summary.actions.length) {
          await notify('garlo-cleanup', 'Speicher aufgeräumt', `${summary.freedMB.toFixed(2)} MB freigegeben`);
        }
      }
    })().catch((e) => console.warn('cleanup', e));
  }
});

/* ============================================================ TABS */
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  const url = info.url || (info.status === 'complete' ? tab?.url : null);
  if (!url) return;
  BulkQueue.onTabUpdated(tabId, url).catch(() => {});
  PublishWatch.onTabUpdated(tabId, url).catch(() => {});
});
chrome.tabs.onRemoved.addListener((tabId) => {
  BulkQueue.onTabRemoved(tabId).catch(() => {});
  PublishWatch.onTabRemoved(tabId).catch(() => {});
});

/* ============================================================ STORAGE WATCH */
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings) return;
  const was = !!changes.settings.oldValue?.killSwitch;
  const now = !!changes.settings.newValue?.killSwitch;
  if (now && !was) { BulkQueue.pauseForKill().catch(() => {}); InboxPoller.disableAlarm().catch(() => {}); }
  const prevAuto = !!changes.settings.oldValue?.inboxAutoPoll;
  const nextAuto = !!changes.settings.newValue?.inboxAutoPoll;
  if (prevAuto && !nextAuto) InboxPoller.disableAlarm().catch(() => {});
  if (!prevAuto && nextAuto) InboxPoller.ensureAlarm().catch(() => {});
});

ensureAlarms().catch(() => {});