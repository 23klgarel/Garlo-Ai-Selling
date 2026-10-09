/* Garlo AI Selling — modules/alt-text.js (v6) */
import { getListingLanguage } from './listing-language.js';

export async function generateAltTexts(images) {
  if (!Array.isArray(images) || images.length === 0) return [];
  const lang = await getListingLanguage();
  const results = [];
  for (const img of images) {
    try {
      const resp = await chrome.runtime.sendMessage({
        action: 'generateAltText',
        dataUrl: img.dataUrl,
        language: lang
      });
      results.push(resp?.ok ? resp.text : null);
    } catch { results.push(null); }
  }
  return results;
}

export function formatAltTexts(altTexts) {
  if (!Array.isArray(altTexts) || !altTexts.length) return '';
  const lines = altTexts.filter(Boolean).map((t, i) => `Bild ${i + 1}: ${t}`);
  return lines.length ? `\n\n--- Bild-Beschreibungen (SEO) ---\n${lines.join('\n')}` : '';
}