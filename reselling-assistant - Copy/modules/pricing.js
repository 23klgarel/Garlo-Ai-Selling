/* Garlo AI Selling — modules/pricing.js (v7)
   Fee-aware profit math shared by:
     • research tab (V5)            → calculateProfit, updateProfitUI
     • price watcher (V7)           → breakEvenPrice
     • drawer / analytics (future)  → breakEvenPrice

   Every function is pure (no chrome.* access). Handles German number input
   ("25,00" / "25.00") transparently.

   Exports:
     calculateProfit(purchasePrice, targetPrice, platform, isKleinunternehmer)
     updateProfitUI(container, ek, vk, platform, isKleinunternehmer)
     breakEvenPrice(purchasePrice, platform)
*/

const parseN = (s) => {
  if (typeof s === 'number') return s;
  if (s == null) return NaN;
  return parseFloat(String(s).replace(/\s/g, '').replace(/[^\d.,-]/g, '').replace(',', '.'));
};

/* ---------- fee model ----------
   eBay.de private seller (2026): ~11% of total + a small fixed fee.
   PayPal / payment processing: ~2.5% of the gross.
   Kleinanzeigen: no seller fee.
   All values are estimates — the tool is honest about that in the UI. */
function feesFor(platform, gross) {
  if (!isFinite(gross) || gross <= 0) return { ebay: 0, payment: 0, total: 0 };
  let ebay = 0;
  if (platform === 'ebay') {
    ebay = gross * 0.11 + 0.35;          // 11% + fixed €0.35 estimate
  }
  const payment = gross * 0.025;          // PayPal / payment processing
  return { ebay, payment, total: ebay + payment };
}

/* ---------- profit calculator ---------- */
export function calculateProfit(purchasePrice, targetPrice, platform = 'ebay', isKleinunternehmer = true) {
  const ek = parseN(purchasePrice) || 0;
  const vk = parseN(targetPrice) || 0;
  const f = feesFor(platform, vk);
  const netProfit = vk - ek - f.total;
  const roi = ek > 0 ? (netProfit / ek) * 100 : 0;

  return {
    netProfit: netProfit.toFixed(2),
    roi: roi.toFixed(1),
    fees: f.total.toFixed(2),
    ebayFee: f.ebay.toFixed(2),
    paymentFee: f.payment.toFixed(2)
  };
}

/* ---------- UI helper (research tab) ---------- */
export function updateProfitUI(container, ek, vk, platform, isKleinunternehmer) {
  if (!container) return;
  const result = calculateProfit(ek, vk, platform, isKleinunternehmer);

  const profitEl = container.querySelector('.profit-value');
  const roiEl = container.querySelector('.roi-value');
  const feesEl = container.querySelector('.fees-value');

  if (profitEl) {
    const n = parseFloat(result.netProfit);
    profitEl.textContent = `${result.netProfit.replace('.', ',')} €`;
    profitEl.style.color = n >= 0 ? 'var(--success)' : 'var(--danger)';
  }
  if (roiEl) roiEl.textContent = `${result.roi}% ROI`;
  if (feesEl) feesEl.textContent = `${result.fees.replace('.', ',')} €`;
}

/* ---------- V7: break-even price ----------
   The lowest price at which selling this item nets zero profit (given the
   fee model above). Used by price-watcher.js as the floor when the user has
   "EK + Gebühren" floor enabled — it prevents the watcher from ever cutting
   a price to a loss-making level.

   Math:
     profit(vk) = vk - ek - (vk * feeRate + fixed)
                = vk * (1 - feeRate) - ek - fixed
     set profit = 0 →  vk = (ek + fixed) / (1 - feeRate)

   Returns a number (EUR), or NaN if ek is invalid.
   Callers must treat NaN as "cannot protect margin — do nothing". */
export function breakEvenPrice(purchasePrice, platform = 'kleinanzeigen') {
  const ek = parseN(purchasePrice);
  if (!isFinite(ek) || ek < 0) return NaN;

  const feeRate = platform === 'ebay' ? 0.11 + 0.025 : 0.025;
  const fixed = platform === 'ebay' ? 0.35 : 0;

  const denom = 1 - feeRate;
  if (denom <= 0) return NaN;
  return (ek + fixed) / denom;
}