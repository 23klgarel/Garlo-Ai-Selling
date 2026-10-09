/* Garlo AI Selling — modules/tab-utils.js (v9.0)
   Shared helpers: tab lifecycle, content script injection, message
   with retry, parallel image fetch.

   V9 CHANGES:
     • IMAGE_TIMEOUT_MS 8000 → 6000 (faster user feedback on failure)
     • New fetchImagesVerbose() returns { images, failed: [{url, error}] }
       so callers can surface WHICH URLs failed and WHY
     • fetchImages() kept as a thin wrapper for backward compatibility */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const IMAGE_TIMEOUT_MS = 6000;

/* ============================================================
   TAB LIFECYCLE
   ============================================================ */
export function waitForComplete(tabId, timeoutMs = 20000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try { chrome.tabs.onUpdated.removeListener(listener); } catch { /* ignore */ }
      clearTimeout(timer);
      setTimeout(resolve, 800);
    };
    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete') finish();
    };
    try { chrome.tabs.onUpdated.addListener(listener); } catch { /* ignore */ }
    const timer = setTimeout(finish, Math.max(500, timeoutMs));
    chrome.tabs.get(tabId).then((tab) => {
      if (tab && tab.status === 'complete') finish();
    }).catch(() => { /* tab gone */ });
  });
}

export async function injectContent(tabId, platform) {
  if (!tabId || !chrome.scripting || !chrome.scripting.executeScript) {
    return { ok: false, error: 'chrome.scripting nicht verfügbar' };
  }
  const files = platform === 'vinted'
    ? ['modules/scraper-vinted.js', 'content.js']
    : ['content.js'];
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: false }, files });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || 'Injection fehlgeschlagen' };
  }
}

export async function sendWithRetry(tabId, msg, opts = {}) {
  const { platform = '', tries = 5, delay = 1200, until = null } = opts;
  let lastErr = null;
  let lastResp = null;

  for (let i = 0; i < tries; i++) {
    try {
      const resp = await chrome.tabs.sendMessage(tabId, msg);
      lastResp = resp;
      if (!until && resp !== undefined) return resp;
      if (until && until(resp)) return resp;
      lastErr = new Error('Content-Script noch nicht bereit');
    } catch (e) { lastErr = e; }
    if (i < tries - 1) await sleep(delay);
  }

  if (lastResp !== null && lastResp !== undefined) return lastResp;
  return { ok: false, error: (platform ? `[${platform}] ` : '') + (lastErr?.message || 'Content-Script antwortet nicht') };
}

/* ============================================================
   IMAGE FETCH — V9 verbose variant
   ============================================================ */
export async function fetchImages(urls, max = 8) {
  const r = await fetchImagesVerbose(urls, max);
  return r.images;
}

/* Returns { images, failed:[{url, error}] }. Never throws. */
export async function fetchImagesVerbose(urls, max = 8) {
  const list = (urls || [])
    .filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u))
    .slice(0, max);
  if (!list.length) return { images: [], failed: [] };

  const results = await Promise.all(list.map((u, idx) => fetchOneImageVerbose(u, idx)));
  const images = [];
  const failed = [];
  for (const r of results) {
    if (r.image) images.push(r.image);
    else failed.push({ url: r.url, error: r.error });
  }
  return { images, failed };
}

async function fetchOneImageVerbose(url, index) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      credentials: 'omit',
      mode: 'cors',
      signal: controller.signal
    });
    if (!r.ok) return { url, error: `HTTP ${r.status}` };
    const blob = await r.blob();
    if (!blob.size) return { url, error: 'Leerer Blob' };
    const dataUrl = await blobToDataUrl(blob);
    const ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
    return {
      image: {
        id: `img-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`,
        dataUrl,
        filename: `garlo-${Date.now()}-${index}.${ext}`,
        size: blob.size
      }
    };
  } catch (e) {
    const isAbort = e.name === 'AbortError';
    return { url, error: isAbort ? `Timeout (${IMAGE_TIMEOUT_MS} ms)` : (e.message || 'fetch-Fehler') };
  } finally {
    clearTimeout(timeoutId);
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}