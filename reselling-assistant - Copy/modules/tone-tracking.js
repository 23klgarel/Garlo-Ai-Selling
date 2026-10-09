/* Garlo AI Selling — modules/tone-tracking.js (v6) */
const KEY = 'toneStats';

export async function recordGeneration(tone, itemId) {
  const data = await chrome.storage.local.get([KEY]);
  const stats = data[KEY] || { generated: {}, sold: {}, events: [] };
  stats.generated[tone] = (stats.generated[tone] || 0) + 1;
  stats.events.unshift({ ts: Date.now(), type: 'generate', tone, itemId });
  stats.events = stats.events.slice(0, 2000);
  await chrome.storage.local.set({ [KEY]: stats });
}

export async function recordSale(tone, itemId) {
  const data = await chrome.storage.local.get([KEY]);
  const stats = data[KEY] || { generated: {}, sold: {}, events: [] };
  stats.sold[tone] = (stats.sold[tone] || 0) + 1;
  stats.events.unshift({ ts: Date.now(), type: 'sale', tone, itemId });
  stats.events = stats.events.slice(0, 2000);
  await chrome.storage.local.set({ [KEY]: stats });
}

export async function getStats(days = 90) {
  const data = await chrome.storage.local.get([KEY]);
  const stats = data[KEY] || { generated: {}, sold: {}, events: [] };
  const since = Date.now() - days * 86400_000;
  const recent = (stats.events || []).filter((e) => e.ts >= since);
  const gen = {}, sold = {};
  recent.forEach((e) => {
    if (e.type === 'generate') gen[e.tone] = (gen[e.tone] || 0) + 1;
    if (e.type === 'sale')     sold[e.tone] = (sold[e.tone] || 0) + 1;
  });
  return ['conservative', 'balanced', 'creative'].map((tone) => {
    const g = gen[tone] || 0;
    const s = sold[tone] || 0;
    return { tone, generated: g, sold: s, conversion: g > 0 ? (s / g) * 100 : 0 };
  });
}