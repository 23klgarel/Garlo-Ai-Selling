# Garlo AI Selling — V5.0 Upgrade
## Product Research Suite & Foundation

### CHANGELOG
- **Modular Architecture**: Refactored the monolithic `dashboard.js` and `background.js` into ES modules.
- **Bilingual Support (DE/EN)**: Implemented a full i18n system. All UI strings are now translatable via `modules/i18n.js`.
- **Barcode Scanner**: Integrated the native `BarcodeDetector` API for real-time EAN scanning (V5).
- **Profit Calculator**: Added a dedicated research profit engine with eBay/PayPal fee calculation.
- **Tax Status**: Support for "Kleinunternehmer (§19 UStG)" (no VAT) via configuration.
- **Legal Guardrails**:
  - Mandatory First-Run Consent Modal.
  - Rate Limiter with 24h lockout for 403/429 errors.
  - Global Kill Switch to disable all automation.
  - Warning Banners on critical views.
- **Bulk Import**: New research tool to import ASINs for automated scraping.

### HONESTY STATEMENT
- **Barcode Scanner**: Requires a modern browser with `BarcodeDetector` support (Chrome 116+). Works best on mobile or high-res webcams.
- **Rate Limiter**: Strictly enforces cooldowns to prevent account bans. This may feel "slow" to users but is essential for safety.
- **eBay API**: Currently in "Form-Automation" mode. Real API plumbing is prepared for V7.

### TEST CHECKLIST
1. **Consent**: Clear `chrome.storage.local` and verify the modal appears on first load.
2. **Language**: Switch to English in Config and verify all UI labels (tabs, buttons, tooltips) change instantly.
3. **Scanner**: Open the Research tab and trigger the scanner; verify camera access request and EAN detection.
4. **Rate Limit**: Attempt to scrape multiple products rapidly; verify the 30s cooldown toast appears.
5. **Profit**: Enter 25€ EK and 50€ VK in the Research calculator; verify ROI and net profit (approx 13€ for eBay).

### MIGRATION
- Storage schema updated: `settings` object now contains `language`, `taxStatus`, and `consent`.
- Rate limits tracked in `rateLimits` and `lockouts` keys.
