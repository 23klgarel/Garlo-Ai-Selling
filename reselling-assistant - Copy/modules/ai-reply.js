/* Garlo AI Selling — modules/ai-reply.js (v8)
   Generates German reply drafts to buyer messages, grounded in:
     • the conversation so far
     • the item being discussed (title, price, description)
     • the user's tone preference (from settings)
     • any selected template as guidance

   Sends via chrome.runtime.sendMessage to background.js (which owns the
   Gemini call + model fallback). Never writes to disk here. */

const TONE_LABELS = {
  short: 'Kurz und knapp (max. 2 Sätze).',
  friendly: 'Freundlich und höflich, etwas Wärme.',
  firm: 'Sachlich, direkt, keine Umschweife.',
  negotiating: 'Verhandlungsbereit, aber keine Preisnachlässe unter 10%.'
};

export async function draftReply({
  conversation,
  messages,
  item,
  tone = 'friendly',
  userHint = '',
  template = null
}) {
  const toneDesc = TONE_LABELS[tone] || TONE_LABELS.friendly;

  const history = (messages || [])
    .slice(-10)
    .map((m) => `${m.from === 'me' ? 'ICH' : 'KÄUFER'}: ${m.text}`)
    .join('\n');

  const itemInfo = item
    ? `Titel: ${item.title || '(unbekannt)'}
Preis: ${item.targetPrice || item.price || '?'} €
Zustand: ${item.condition || 'Neu & OVP'}`
    : '(kein Artikel verknüpft)';

  const buyerName = conversation?.buyer || '(unbekannt)';

  const prompt = `Du bist ein professioneller Verkäufer auf Kleinanzeigen. Formuliere eine Antwort auf die letzte Käufernachricht.

=== KONTEXT ===
Käufer: ${buyerName}
Artikel:
${itemInfo}

Gesprächsverlauf (neueste unten):
${history || '(kein Verlauf)'}

=== STILVORGABE ===
${toneDesc}
${userHint ? `\nZusätzlicher Hinweis vom Verkäufer: ${userHint}` : ''}
${template ? `\nOrientierung an diesem Baustein (nicht wörtlich kopieren):\n"${template}"` : ''}

=== REGELN ===
1. Schreibe auf Deutsch, natürlicher Ton, keine KI-Floskeln.
2. Maximal 3 kurze Sätze.
3. Kein Emoji-Spam (max. 1 Emoji wenn passend).
4. Beziehe dich konkret auf die letzte Nachricht des Käufers.
5. Keine erfundenen Details — wenn du etwas nicht weißt, lass es weg.
6. Keine Rechtsbelehrungen, keine Disclaimer — das macht der Verkäufer selbst.
7. Kein Briefkopf, keine Anrede-Formatierung wie "Sehr geehrter…" — klein und direkt.

=== AUSGABE ===
Antworte NUR mit dem fertigen Nachrichtentext. Kein JSON, kein Kommentar, keine Anführungszeichen drumherum.`;

  try {
    const resp = await chrome.runtime.sendMessage({
      action: 'generateReplyDraft',
      prompt
    });
    if (!resp?.ok) {
      return { ok: false, error: resp?.error || 'Generierung fehlgeschlagen.' };
    }
    return { ok: true, text: (resp.text || '').trim(), model: resp.model };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* Simple heuristic feedback chips that the user can click to steer the
   next draft without editing a full prompt. */
export const QUICK_HINTS = [
  { id: 'shorter', label: 'Kürzer', hint: 'Bitte kürzer und prägnanter formulieren.' },
  { id: 'friendlier', label: 'Freundlicher', hint: 'Etwas wärmer und freundlicher.' },
  { id: 'firm', label: 'Bestimmter', hint: 'Klar und bestimmt, aber höflich.' },
  { id: 'no_discount', label: 'Kein Rabatt', hint: 'Kein Rabatt möglich, freundlich ablehnen.' },
  { id: 'ask_when', label: 'Nachfragen', hint: 'Nach konkreter Kaufabsicht oder Abholtermin fragen.' }
];