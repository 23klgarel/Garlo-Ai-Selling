/* Garlo AI Selling — modules/auto-translate.js (v6) */
export function isAmazonCom(url) {
  try {
    const u = new URL(url);
    return /amazon\.com$/i.test(u.hostname) ||
           (/amazon\./i.test(u.hostname) && !/amazon\.de/i.test(u.hostname));
  } catch { return false; }
}

export async function translateToGerman(scraped) {
  if (!scraped) return scraped;
  try {
    const resp = await chrome.runtime.sendMessage({
      action: 'translateProduct',
      scraped
    });
    if (!resp?.ok) return { ...scraped, translationWarning: resp?.error || 'Fehler' };
    return {
      ...scraped,
      title: resp.title || scraped.title,
      features: resp.features || scraped.features,
      brand: resp.brand || scraped.brand,
      translated: true
    };
  } catch (e) {
    return { ...scraped, translationWarning: e.message };
  }
}