/* Garlo AI Selling — modules/prompt-editor.js (v9.3)
   Custom prompt presets with {{variable}} substitution.

   V9.3: The Standard preset now contains the EXACT strict German layout
   the user requires. When the dashboard sends this template to
   background.js, it is used verbatim (with {{var}} substituted) and
   the AI is forced to follow the layout. */

export const DEFAULT_PRESETS = [
  {
    id: 'default-strict-german',
    name: 'Standard (Strict German)',
    builtin: true,
    language: 'DE',
    template: `Du bist ein professioneller Verkaufsassistent für Kleinanzeigen und eBay-Reselling. Wenn ich dir Produktdaten, Beschreibungen oder Textinformationen zu einem Produkt sende, generierst du mir sofort eine fertige, optimierte Kleinanzeigen-Anzeige auf Deutsch.

Halte dich strikt an dieses Layout:

### Suggested Ad Title (Titel)
> [Prägnanter Titel inklusive Marke, Hauptmerkmal und "Neu & OVP" sofern zutreffend]

### Description Text (Beschreibung)
Hallo! Ich verkaufe hier eine brandneue und originalverpackte [Produktname/Beschreibung einfügen].

[Kurzer Einleitungssatz zum Nutzen des Produkts]

*Die wichtigsten Details im Überblick:*
* *Marke:* {{brand}}
* [Weitere 4–6 prägnante Stichpunkte mit technischen Highlights als Bulletpoints]
* *Zustand:* Neu und originalverpackt (Neu & OVP).

*Versand & Zahlung:*
* *Nur Versand* (gegen Aufpreis, z.B. als DHL-Paket oder Warensendung). Keine Abholung möglich.
* Zahlung per Überweisung oder PayPal.

Keine Tauschangebote.

Privatverkauf unter Ausschluss der Sachmängelhaftung. Keine Rücknahme oder Garantie meinerseits.

=== PRODUKTDATEN ===
Titel: {{title}}
Marke: {{brand}}
Amazon-Preis: {{price}}
Features:
{{features}}

=== PREIS ===
Einkaufspreis (EK): {{purchasePrice}}
Verkaufspreis (VK, EK × 2): {{targetPrice}}
Versand: {{shipping}}

=== ZWINGENDE REGELN ===
1. Schreibe in einwandfreiem, natürlichem Deutsch.
2. Nutze AUSSCHLIESSLICH "* " als Listenzeichen. NIEMALS "-" oder "•".
3. Setze *Sternchen* um die fett markierten Labels: "*Die wichtigsten Details im Überblick:*", "*Marke:*", "*Zustand:*", "*Versand & Zahlung:*", "*Nur Versand*".
4. Die Beschreibung MUSS mit "Hallo! Ich verkaufe hier eine brandneue und originalverpackte" beginnen.
5. Die Versand- und Zahlungssektion MUSS exakt wie oben formatiert sein.
6. Erfinde KEINE technischen Details — nutze nur Infos aus den Produktdaten.
7. Der Titel darf max. 65 Zeichen lang sein.
8. Der Preis im JSON MUSS eine ganze Zahl als String sein: "50" (nicht "50,00").

=== AUSGABE ===
Antworte AUSSCHLIESSLICH mit gültigem JSON, ohne Markdown-Codeblöcke:
{"title": "…", "price": "50", "description": "… mit \\n für Zeilenumbrüche"}`
  },
  {
    id: 'default-minimal',
    name: 'Minimal (nur Titel + Beschreibung)',
    builtin: true,
    language: 'DE',
    template: `Erstelle aus diesen Amazon-Daten einen Kleinanzeigen-Text.

Titel: {{title}}
Marke: {{brand}}
Features:
{{features}}

Antworte NUR mit JSON: {"title": "...", "price": "...", "description": "..."}`
  }
];

const STORAGE_KEY = 'promptPresets';

export async function loadPresets() {
  const data = await chrome.storage.local.get([STORAGE_KEY]);
  const user = Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
  return [...DEFAULT_PRESETS, ...user];
}

export async function savePreset(preset) {
  const data = await chrome.storage.local.get([STORAGE_KEY]);
  const user = Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
  const idx = user.findIndex((p) => p.id === preset.id);
  if (idx >= 0) user[idx] = preset;
  else user.unshift({ ...preset, id: preset.id || ('p-' + Date.now()) });
  await chrome.storage.local.set({ [STORAGE_KEY]: user });
  return preset;
}

export async function deletePreset(id) {
  const data = await chrome.storage.local.get([STORAGE_KEY]);
  const user = (data[STORAGE_KEY] || []).filter((p) => p.id !== id);
  await chrome.storage.local.set({ [STORAGE_KEY]: user });
}

export function renderTemplate(template, vars) {
  if (!template) return '';
  return template.replace(/\{\{(\w+)\}\}/g, (m, key) => {
    const v = vars[key];
    return (v === undefined || v === null) ? m : String(v);
  });
}

export function extractVars(template) {
  const out = new Set();
  String(template || '').replace(/\{\{(\w+)\}\}/g, (_, k) => out.add(k));
  return Array.from(out);
}