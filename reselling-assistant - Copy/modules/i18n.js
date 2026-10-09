import { locales } from './locales.js';

let currentLanguage = 'de';

export async function initI18n() {
  const data = await chrome.storage.local.get(['settings']);
  currentLanguage = data.settings?.language || 'de';
  applyI18n();
}

export function t(key) {
  return locales[currentLanguage]?.[key] || locales['de']?.[key] || key;
}

export async function setLanguage(lang) {
  if (locales[lang]) {
    currentLanguage = lang;
    const data = await chrome.storage.local.get(['settings']);
    const settings = { ...(data.settings || {}), language: lang };
    await chrome.storage.local.set({ settings });
    applyI18n();
  }
}

export function getCurrentLanguage() {
  return currentLanguage;
}

export function applyI18n() {
  const elements = document.querySelectorAll('[data-t]');
  elements.forEach(el => {
    const key = el.getAttribute('data-t');
    const translation = t(key);
    
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      if (el.placeholder) el.placeholder = translation;
    } else {
      // Preserve child elements (like badges) if any, but usually data-t is on leaf nodes
      if (el.children.length === 0) {
        el.textContent = translation;
      } else {
        // Special case for nav buttons with icons/badges
        const textNode = Array.from(el.childNodes).find(n => n.nodeType === Node.TEXT_NODE);
        if (textNode) textNode.textContent = translation;
      }
    }
  });

  document.querySelectorAll('[data-t-placeholder]').forEach(el => {
    el.placeholder = t(el.getAttribute('data-t-placeholder'));
  });
  document.querySelectorAll('[data-t-title]').forEach(el => {
    el.title = t(el.getAttribute('data-t-title'));
  });
}
