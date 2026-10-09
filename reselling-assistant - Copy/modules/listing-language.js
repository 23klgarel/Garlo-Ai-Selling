/* Garlo AI Selling — modules/listing-language.js (v6) */
const KEY = 'listingLanguage';
export const SUPPORTED = [
  { code: 'DE', label: 'Deutsch' },
  { code: 'EN', label: 'English' },
  { code: 'FR', label: 'Français' }
];

export async function getListingLanguage() {
  const d = await chrome.storage.local.get([KEY]);
  return d[KEY] || 'DE';
}

export async function setListingLanguage(code) {
  if (!SUPPORTED.find((s) => s.code === code)) code = 'DE';
  await chrome.storage.local.set({ [KEY]: code });
}

export function languageInstruction(code) {
  if (code === 'EN') {
    return `\n\nIMPORTANT: Write title and description in ENGLISH. Keep the SAME structure as the German template (bullets, sections). Keep German legal phrases like "Privatverkauf unter Ausschluss der Sachmängelhaftung" in GERMAN (legally binding).`;
  }
  if (code === 'FR') {
    return `\n\nIMPORTANT: Write title and description in FRENCH. Keep the SAME structure as the German template (bullets, sections). Keep German legal phrases like "Privatverkauf unter Ausschluss der Sachmängelhaftung" in GERMAN (legally binding).`;
  }
  return '';
}