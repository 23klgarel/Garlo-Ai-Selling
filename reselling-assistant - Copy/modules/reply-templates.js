/* Garlo AI Selling — modules/reply-templates.js (v8)
   Saved reply templates. Two kinds:
     • builtin — shipped defaults, editable but deletable = false
     • custom  — user-created

   Storage: 'replyTemplates' → Template[]

   Template shape:
     { id, label, text, shortcut?, builtin, category?, createdAt, updatedAt }
   Shortcut is a chip label ("Ist noch da?", "Letzter Preis?", etc.) */

const KEY = 'replyTemplates';

export const BUILTIN_TEMPLATES = [
  {
    id: 'bt-available',
    label: 'Ist noch da?',
    shortcut: '✓ Verfügbar',
    text: 'Hallo! Ja, der Artikel ist noch verfügbar. Bei Interesse einfach melden. 😊',
    builtin: true,
    category: 'availability'
  },
  {
    id: 'bt-price',
    label: 'Letzter Preis?',
    shortcut: '💰 Preis',
    text: 'Der Preis ist bereits fair kalkuliert. Ich kann Ihnen aber ein kleines Entgegenkommen anbieten — schreiben Sie mir gerne Ihr Angebot.',
    builtin: true,
    category: 'price'
  },
  {
    id: 'bt-payment',
    label: 'Zahlung?',
    shortcut: '💳 Zahlung',
    text: 'Zahlung bitte per Überweisung oder PayPal (Freunde & Familie). Versand erfolgt nach Zahlungseingang per DHL.',
    builtin: true,
    category: 'payment'
  },
  {
    id: 'bt-shipping',
    label: 'Versand?',
    shortcut: '📦 Versand',
    text: 'Der Versand erfolgt per DHL-Paket. Keine Abholung möglich. Versandkosten sind im Preis nicht enthalten.',
    builtin: true,
    category: 'shipping'
  },
  {
    id: 'bt-details',
    label: 'Details?',
    shortcut: '📋 Details',
    text: 'Gerne! Der Artikel ist neu und originalverpackt. Bei Fragen zu Maßen oder Funktion einfach fragen.',
    builtin: true,
    category: 'details'
  },
  {
    id: 'bt-invoice',
    label: 'Rechnung?',
    shortcut: '🧾 Rechnung',
    text: 'Leider liegt keine separate Rechnung vor — der Artikel stammt aus einer größeren Bestellung.',
    builtin: true,
    category: 'invoice'
  },
  {
    id: 'bt-thanks',
    label: 'Danke / Abschluss',
    shortcut: '🙏 Danke',
    text: 'Vielen Dank für den Kauf! Ich versende schnellstmöglich nach Zahlungseingang. Bei Problemen einfach melden.',
    builtin: true,
    category: 'closing'
  }
];

const get = (k) => new Promise((r) => chrome.storage.local.get(k, r));
const set = (o) => new Promise((r) => chrome.storage.local.set(o, r));

let chain = Promise.resolve();
function serial(fn) {
  const run = chain.then(fn);
  chain = run.catch(() => {});
  return run;
}

/* ---------- read ---------- */
export async function listTemplates() {
  const d = await get([KEY]);
  const user = Array.isArray(d[KEY]) ? d[KEY] : [];
  /* Builtin always at top, in original order */
  const userFiltered = user.filter((t) => !t.builtin);
  return [...BUILTIN_TEMPLATES, ...userFiltered];
}

export async function getTemplate(id) {
  if (!id) return null;
  const list = await listTemplates();
  return list.find((t) => t.id === id) || null;
}

/* ---------- write ---------- */
export function saveTemplate(patch) {
  return serial(async () => {
    const d = await get([KEY]);
    const user = Array.isArray(d[KEY]) ? d[KEY] : [];

    /* Builtins are immutable; edits create a custom copy */
    if (patch.builtin) {
      const copy = {
        ...patch,
        id: 'ct-' + Date.now(),
        builtin: false,
        label: patch.label + ' (Kopie)',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      user.unshift(copy);
      await set({ [KEY]: user });
      return copy;
    }

    const idx = user.findIndex((t) => t.id === patch.id);
    if (idx >= 0) {
      user[idx] = { ...user[idx], ...patch, updatedAt: Date.now() };
    } else {
      user.unshift({
        ...patch,
        id: patch.id || ('ct-' + Date.now()),
        builtin: false,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
    }
    await set({ [KEY]: user });
    return patch;
  });
}

export function deleteTemplate(id) {
  return serial(async () => {
    const d = await get([KEY]);
    const user = Array.isArray(d[KEY]) ? d[KEY] : [];
    await set({ [KEY]: user.filter((t) => t.id !== id) });
  });
}

/* ---------- seeding (call once on install) ---------- */
export async function ensureTemplatesSeeded() {
  const d = await get([KEY]);
  if (d[KEY] !== undefined) return;
  await set({ [KEY]: [] });
}