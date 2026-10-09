export const locales = {
  de: {
    /* ---------- navigation ---------- */
    nav_generator: "Generator",
    nav_research: "Recherche",
    nav_inventory: "Inventar",
    nav_queue: "Queue",
    nav_inbox: "Posteingang",
    nav_kanban: "Pipeline",
    nav_analytics: "Analytics",
    nav_accounts: "Konten",
    nav_config: "Konfiguration",

    /* ---------- generic buttons ---------- */
    btn_save: "💾 Speichern",
    btn_close: "Schließen",
    btn_delete: "Löschen",
    btn_cancel: "Abbrechen",
    btn_copy: "📋 Kopieren",
    btn_export: "📤 CSV Export",
    btn_import: "📥 CSV Import",
    btn_clear_all: "🗑 Alle Daten löschen",
    btn_config: "Konfigurieren",
    btn_refresh_accounts: "🔄 Alle Konten prüfen",
    btn_refresh_models: "Verfügbare Modelle laden",
    search_placeholder: "Suchen…",
    clean_images: "Clean",
    view_source: "Original öffnen ↗",
    item: "Artikel",

    /* ---------- KPI ---------- */
    kpi_items: "Artikel",
    kpi_invested: "Investiert (EK)",
    kpi_revenue: "Erlös (×2)",
    kpi_profit: "Netto-Gewinn",

    /* ---------- generator ---------- */
    gen_sub: "Amazon scrapen, Listing erzeugen, publizieren",
    gen_capture_btn: "⚡ Quick Capture",
    gen_url_placeholder: "Produkt-URL (Amazon · Otto · Idealo · Vinted)",
    gen_purchase_price: "EK (€)",
    gen_target_price: "VK (€)",
    gen_generate_btn: "✨ Listing generieren",
    gen_publish_ka: "📢 Kleinanzeigen",
    gen_publish_ebay: "📢 eBay.de",
    gen_save_inv: "💾 In Inventar speichern",

    /* ---------- tones ---------- */
    tone_conservative: "Conservative",
    tone_balanced: "Balanced",
    tone_creative: "Creative",

    /* ---------- research ---------- */
    res_sub: "Barcode-Scanner & Profit-Rechner",
    res_scan_btn: "Barcode scannen",
    res_bulk_import: "Bulk-Import (ASINs)",
    res_profit_calc: "Profit-Rechner",
    res_fees_ebay: "eBay Gebühr (11%)",
    res_fees_pp: "PayPal Gebühr (2,5%)",
    res_shipping: "Versandkosten",
    res_profit_net: "Netto-Profit",
    res_roi: "ROI",

    /* ---------- inbox ---------- */
    inbox_no_sync: "Noch nicht synchronisiert.",
    inbox_empty_msg: "Klicke auf „Jetzt synchronisieren“, um deine aktiven Kleinanzeigen-Nachrichten zu laden.",
    sync_now: "🔄 Jetzt synchronisieren",

    /* ---------- pipeline statuses ---------- */
    status_drafted: "Drafted",
    status_ready: "Ready",
    status_listed: "Listed",
    status_sold: "Sold",

    /* ---------- platform statuses ---------- */
    plat_status_live: "live",
    plat_status_pending: "in Arbeit",
    plat_status_ended: "beendet",
    plat_status_sold: "verkauft",
    plat_status_unknown: "unbekannt",
    "plat_status_delist-requested": "Delist angefordert",

    /* ---------- inventory table ---------- */
    status: "Status",
    title: "Titel",
    platform: "Plattform",
    ek: "EK",
    vk: "VK",
    margin: "Marge",
    publish: "Publish",
    images: "Bilder",
    drawer_platforms: "Plattformen",
    badge_stale: "seit {d} Tagen",

    /* ---------- analytics ---------- */
    status_distribution: "Status-Verteilung",
    top_margins: "Top-Marge Items",
    recent_investments: "Letzte Importe",
    platform_split: "Plattform-Split",
    tone_perf: "Tone-Performance (90 Tage)",
    tone_no_data: "Noch keine Daten. Generiere Listings und markiere Verkäufe.",

    /* ---------- prompt editor ---------- */
    prompt_title: "Prompt-Editor",
    prompt_select: "Vorlage auswählen",
    prompt_edit: "Vorlage bearbeiten",
    prompt_vars_hint: "Verfügbare Variablen: {{title}}, {{brand}}, {{price}}, {{features}}, {{purchasePrice}}, {{targetPrice}}, {{shipping}}, {{toneDesc}}",
    prompt_save: "💾 Vorlage speichern",
    prompt_delete: "🗑 Löschen",

    /* ---------- listing language ---------- */
    listing_lang: "🌐 Listing-Sprache",
    listing_lang_hint: "Sprache für Titel & Beschreibung. Die UI-Sprache bleibt unabhängig.",

    /* ---------- alt-text ---------- */
    alt_text_btn: "🏷️ SEO Alt-Texte generieren",
    alt_text_generating: "⏳ Generiere Alt-Texte…",
    alt_text_done: "{n} Alt-Texte erstellt",

    /* ---------- auto-translate ---------- */
    translated_badge: "Aus amazon.com übersetzt",
    translating: "Übersetze aus amazon.com…",

    /* ---------- accounts tab ---------- */
    checking: "Prüfe Verbindung…",
    open_tab: "Tab öffnen",
    check_connections: "Verbindung neu prüfen",
    check_hint: "Konten werden anhand aktiver Browser-Tabs und gespeicherter Zugangsdaten erkannt.",

    /* ---------- queue ---------- */
    queue_title: "Veröffentlichungs-Queue",
    queue_hint: "Die Queue öffnet jedes Inserat, füllt das Formular aus und wartet, bis DU abschickst. Zwischen zwei Einträgen läuft ein 60-Sekunden-Cooldown.",
    queue_add_ready: "➕ Alle „Ready“ hinzufügen",
    queue_start: "▶️ Start",
    queue_pause: "⏸ Pause",
    queue_clear: "🧹 Erledigte entfernen",
    queue_empty: "Queue ist leer. Füge Artikel mit Status „Ready“ hinzu.",
    queue_pending: "Wartet",
    queue_in_progress: "In Arbeit",
    queue_done: "Erledigt",
    queue_failed: "Fehlgeschlagen",
    queue_awaiting: "Bitte selbst abschicken — danach autom. erkannt",
    queue_retry: "Erneut",
    queue_mark_done: "Als veröffentlicht markieren",
    queue_remove: "Entfernen",
    queue_paused_reason: "Pausiert: {r}",
    queue_cooldown: "Cooldown {s}s",

    /* ---------- config: general ---------- */
    cfg_settings: "Allgemein",
    cfg_language: "Sprache",
    cfg_tax_status: "Steuer-Status",
    cfg_tax_klein: "Kleinunternehmer (§19 UStG)",
    cfg_tax_reg: "Regelbesteuert",
    cfg_api_key: "Gemini API Key",
    cfg_model: "Modell-Präferenz",
    cfg_auto: "🔄 Auto (bestes verfügbares)",
    cfg_theme: "🌗 Theme",

    /* ---------- config: eBay API ---------- */
    cfg_ebay_title: "eBay API-Modus",
    cfg_ebay_badge_api: "API-Modus aktiv ({env})",
    cfg_ebay_badge_form: "Form-Automation — kein offizieller API-Zugriff",
    cfg_ebay_untested: "⚠️ UNGETESTET gegen eBay. Nutze Sandbox, bis der Ablauf zuverlässig funktioniert.",
    cfg_ebay_env: "Umgebung",
    cfg_ebay_app: "App ID (Client ID)",
    cfg_ebay_cert: "Cert ID (Client Secret)",
    cfg_ebay_secret_warn: "⚠️ Dieses Secret wird lokal im Klartext gespeichert. Nicht das Browserprofil teilen.",
    cfg_ebay_runame: "RuName (Redirect)",
    cfg_ebay_redirect: "Akzeptierte Redirect-URL (im eBay Portal eintragen)",
    cfg_ebay_cat: "Standard-Kategorie-ID (optional)",
    cfg_ebay_cond: "Standard-Zustand",
    cfg_ebay_checklist: "Setup-Checkliste",
    cfg_ebay_save: "💾 Speichern",
    cfg_ebay_connect: "🔗 Verbinden (OAuth)",
    cfg_ebay_check: "✔️ Setup prüfen",
    cfg_ebay_disconnect: "Trennen",
    cfg_ebay_chk_policies: "Geschäftsbedingungen (Versand, Zahlung, Rückgabe) hinterlegt",
    cfg_ebay_chk_location: "Lagerort (Merchant Location) angelegt",
    cfg_ebay_chk_ruame: "RuName akzeptierte URL = oben kopierte Redirect-URL",
    cfg_ebay_chk_images: "Artikel brauchen öffentliche https-Bild-URLs",

    /* ---------- config: price watcher ---------- */
    cfg_pw_title: "Preis-Watcher",
    cfg_pw_hint: "Senkt den Zielpreis automatisch, wenn ein Artikel seit N Tagen nicht verkauft ist.",
    cfg_pw_enabled: "Automatische Preissenkung aktiv",
    cfg_pw_days: "Nach wie vielen Tagen senken?",
    cfg_pw_percent: "Um wie viel Prozent senken?",
    cfg_pw_floor: "Untergrenze = EK + Gebühren (empfohlen)",
    cfg_pw_save: "💾 Speichern",
    cfg_pw_run: "▶️ Jetzt prüfen",

    /* ---------- config: delist ---------- */
    cfg_delist_title: "Auto-Delist",
    cfg_delist_hint: "Nach einem Verkauf werden andere Live-Inserate angeboten. Standard = Dry-Run.",
    cfg_delist_live: "Live-Modus erlauben (klickt wirklich — Vorsicht!)",
    cfg_delist_live_confirm: "Wirklich Live-Modus aktivieren? Klicks auf Löschknöpfe sind unwiderruflich.",

    /* ---------- config: consents & audit ---------- */
    cfg_consents_title: "Einwilligungen",
    cfg_consent_given: "erteilt",
    cfg_consent_missing: "fehlt",
    cfg_consent_grant: "Erteilen",
    cfg_consent_revoke: "Widerrufen",
    cfg_audit_title: "Audit-Log",
    cfg_audit_refresh: "🔄 Aktualisieren",
    cfg_audit_export: "📤 Export JSON",
    cfg_audit_clear: "🗑 Leeren",
    cfg_audit_empty: "Keine Einträge.",

    /* ---------- kill switch ---------- */
    legal_killswitch: "🚨 Alle Marketplace-Automatisierungen stoppen",
    killswitch_active_banner: "🚨 KILL-SWITCH AKTIV — keine Automatisierung läuft. Zum Freigeben in Konfiguration ausschalten.",
    killswitch_off_confirm: "Kill-Switch wirklich ausschalten? Automatisierung ist dann wieder aktiv.",

    /* ---------- legal / base consent ---------- */
    legal_consent_title: "Einverständniserklärung & Risikoaufklärung",
    legal_consent_text: "Diese Erweiterung automatisiert Aktionen auf Kleinanzeigen, eBay.de und Vinted. Die Nutzung erfolgt auf eigenes Risiko. Automatisierter Zugriff kann gegen die AGB dieser Plattformen verstoßen und zur Sperrung deines Kontos führen. Ich bestätige, dass ich die Nutzung verantwortungsvoll und im Einklang mit den jeweiligen AGB durchführe.",
    legal_consent_btn: "Ich verstehe und akzeptiere",
    legal_warning_banner: "⚠️ Nutzung auf eigenes Risiko — Verstöße können zur Kontosperrung führen.",
    legal_clauses: "Rechts-Klauseln",
    legal_sach: "Sachmängelhaftung ausschließen",
    legal_rück: "Keine Rücknahme / Garantie",
    legal_tausch: "Keine Tauschgeschäfte",

    /* ---------- per-feature consent ---------- */
    consent_feature_title: "Zusätzliche Einwilligung erforderlich",
    consent_feature_ebayApi: "Der eBay-API-Modus erstellt echte, gebührenpflichtige Inserate über die offizielle eBay-API.",
    consent_feature_vinted: "Vinted-Automatisierung füllt Formulare auf vinted.de automatisch aus. Vinted verbietet automatisierten Zugriff ausdrücklich — höchstes Sperrrisiko.",
    consent_feature_autoDelist: "Auto-Delist beendet Live-Inserate auf anderen Plattformen nach einem Verkauf. Unwiderruflich.",
    consent_feature_generic: "Diese Funktion greift auf externe Marktplätze zu. Nutzung auf eigenes Risiko.",
    consent_accept: "Akzeptieren",
    consent_decline: "Ablehnen",
    consent_declined: "Einwilligung abgelehnt — Aktion abgebrochen.",

    /* ---------- cross-delist modal ---------- */
    delist_title: "Verkauft — andere Inserate beenden?",
    delist_intro: "Du hast diesen Artikel als verkauft markiert. Die folgenden Live-Inserate können jetzt beendet werden.",
    delist_sold_on: "Verkauft auf",
    delist_sold_other: "(andere Plattform)",
    delist_confirm: "Wirklich LIVE beenden auf {p}? Diese Aktion ist unwiderruflich.",
    delist_dismiss: "Später erinnern",
    delist_none: "Keine weiteren Live-Inserate für diesen Artikel gefunden.",
    delist_no_url: "Keine gespeicherte URL — bitte im Drawer eintragen.",
    delist_dry: "Dry-Run",
    delist_live: "Live beenden",
    delist_mark_ended: "Als beendet markieren",
    delist_live_on: "Live-Modus aktiv — der Löschknopf wird wirklich geklickt.",
    delist_live_off: "Live-Modus deaktiviert (Standard). Nur Dry-Run möglich.",

    /* ---------- drawer ---------- */
    drawer_listing_url: "Inserat-URL",
    drawer_mark_live: "Als live markieren",
    drawer_apply_pending: "Preissenkung anwenden auf: {p}",
    drawer_price_rule: "Preis-Regel (pro Artikel)",
    drawer_rule_inherit: "Globale Regel übernehmen",
    drawer_rule_on: "An",
    drawer_rule_off: "Aus",
    drawer_rule_days: "Tage",
    drawer_rule_percent: "%",
    drawer_price_log: "Preis-Verlauf",
    drawer_api_images: "Bild-URLs (eBay API)",
    drawer_pub_vinted: "📢 Vinted",
    drawer_queue_ka: "🗂 In Queue (KA)",
    drawer_queue_vinted: "🗂 In Queue (Vinted)",
    drawer_delist: "✂️ Inserate beenden",
    drawer_ebay_api_create: "⚡ eBay API: erstellen",
    drawer_ebay_api_update: "🔄 eBay API: aktualisieren",
    drawer_ebay_api_end: "✂️ eBay API: beenden",

    /* ---------- V9 analytics ---------- */
    v9_tab_overview: "Übersicht",
    v9_tab_reports: "Berichte",
    v9_revenue: "Umsatz",
    v9_profit: "Gewinn",
    v9_reports: "Steuerbericht",
    v9_ledger: "Kassenbuch",
    v9_backup: "Backup",

    /* ---------- toasts ---------- */
    toast_saved: "Gespeichert!",
    toast_error: "Fehler aufgetreten.",
    toast_copied: "In Zwischenablage kopiert!"
  },

  en: {
    /* ---------- navigation ---------- */
    nav_generator: "Generator",
    nav_research: "Research",
    nav_inventory: "Inventory",
    nav_queue: "Queue",
    nav_inbox: "Inbox",
    nav_kanban: "Pipeline",
    nav_analytics: "Analytics",
    nav_accounts: "Accounts",
    nav_config: "Configuration",

    /* ---------- generic buttons ---------- */
    btn_save: "💾 Save",
    btn_close: "Close",
    btn_delete: "Delete",
    btn_cancel: "Cancel",
    btn_copy: "📋 Copy",
    btn_export: "📤 CSV Export",
    btn_import: "📥 CSV Import",
    btn_clear_all: "🗑 Delete all data",
    btn_config: "Configure",
    btn_refresh_accounts: "🔄 Check all accounts",
    btn_refresh_models: "Load available models",
    search_placeholder: "Search…",
    clean_images: "Clean",
    view_source: "Open original ↗",
    item: "Item",

    /* ---------- KPI ---------- */
    kpi_items: "Items",
    kpi_invested: "Invested (cost)",
    kpi_revenue: "Revenue (×2)",
    kpi_profit: "Net profit",

    /* ---------- generator ---------- */
    gen_sub: "Scrape Amazon, generate listing, publish",
    gen_capture_btn: "⚡ Quick Capture",
    gen_url_placeholder: "Product URL (Amazon · Otto · Idealo · Vinted)",
    gen_purchase_price: "Cost (€)",
    gen_target_price: "Sell (€)",
    gen_generate_btn: "✨ Generate Listing",
    gen_publish_ka: "📢 Kleinanzeigen",
    gen_publish_ebay: "📢 eBay.de",
    gen_save_inv: "💾 Save to Inventory",

    /* ---------- tones ---------- */
    tone_conservative: "Conservative",
    tone_balanced: "Balanced",
    tone_creative: "Creative",

    /* ---------- research ---------- */
    res_sub: "Barcode Scanner & Profit Calculator",
    res_scan_btn: "Scan Barcode",
    res_bulk_import: "Bulk Import (ASINs)",
    res_profit_calc: "Profit Calculator",
    res_fees_ebay: "eBay Fee (11%)",
    res_fees_pp: "PayPal Fee (2.5%)",
    res_shipping: "Shipping Costs",
    res_profit_net: "Net Profit",
    res_roi: "ROI",

    /* ---------- inbox ---------- */
    inbox_no_sync: "Not yet synchronized.",
    inbox_empty_msg: "Click \"Sync now\" to load your active Kleinanzeigen messages.",
    sync_now: "🔄 Sync now",

    /* ---------- pipeline statuses ---------- */
    status_drafted: "Drafted",
    status_ready: "Ready",
    status_listed: "Listed",
    status_sold: "Sold",

    /* ---------- platform statuses ---------- */
    plat_status_live: "live",
    plat_status_pending: "in progress",
    plat_status_ended: "ended",
    plat_status_sold: "sold",
    plat_status_unknown: "unknown",
    "plat_status_delist-requested": "delist requested",

    /* ---------- inventory table ---------- */
    status: "Status",
    title: "Title",
    platform: "Platform",
    ek: "Cost",
    vk: "Sell",
    margin: "Margin",
    publish: "Publish",
    images: "Images",
    drawer_platforms: "Platforms",
    badge_stale: "{d} days old",

    /* ---------- analytics ---------- */
    status_distribution: "Status Distribution",
    top_margins: "Top Margin Items",
    recent_investments: "Recent Imports",
    platform_split: "Platform Split",
    tone_perf: "Tone Performance (90 days)",
    tone_no_data: "No data yet. Generate listings and mark sales.",

    /* ---------- prompt editor ---------- */
    prompt_title: "Prompt Editor",
    prompt_select: "Select preset",
    prompt_edit: "Edit template",
    prompt_vars_hint: "Available variables: {{title}}, {{brand}}, {{price}}, {{features}}, {{purchasePrice}}, {{targetPrice}}, {{shipping}}, {{toneDesc}}",
    prompt_save: "💾 Save preset",
    prompt_delete: "🗑 Delete",

    /* ---------- listing language ---------- */
    listing_lang: "🌐 Listing language",
    listing_lang_hint: "Language for title & description. UI language stays independent.",

    /* ---------- alt-text ---------- */
    alt_text_btn: "🏷️ Generate SEO alt-texts",
    alt_text_generating: "⏳ Generating alt-texts…",
    alt_text_done: "{n} alt-texts created",

    /* ---------- auto-translate ---------- */
    translated_badge: "Translated from amazon.com",
    translating: "Translating from amazon.com…",

    /* ---------- accounts tab ---------- */
    checking: "Checking connection…",
    open_tab: "Open tab",
    check_connections: "Re-check connection",
    check_hint: "Accounts are detected via active browser tabs and stored credentials.",

    /* ---------- queue ---------- */
    queue_title: "Publish Queue",
    queue_hint: "The queue opens each listing, fills the form, and waits for YOU to submit. A 60-second cooldown runs between items.",
    queue_add_ready: "➕ Add all \"Ready\"",
    queue_start: "▶️ Start",
    queue_pause: "⏸ Pause",
    queue_clear: "🧹 Remove finished",
    queue_empty: "Queue is empty. Add items with status \"Ready\".",
    queue_pending: "Pending",
    queue_in_progress: "In progress",
    queue_done: "Done",
    queue_failed: "Failed",
    queue_awaiting: "Submit it yourself — will be detected",
    queue_retry: "Retry",
    queue_mark_done: "Mark as published",
    queue_remove: "Remove",
    queue_paused_reason: "Paused: {r}",
    queue_cooldown: "Cooldown {s}s",

    /* ---------- config: general ---------- */
    cfg_settings: "General",
    cfg_language: "Language",
    cfg_tax_status: "Tax status",
    cfg_tax_klein: "Small Business (§19 UStG)",
    cfg_tax_reg: "Standard Taxation",
    cfg_api_key: "Gemini API Key",
    cfg_model: "Model preference",
    cfg_auto: "🔄 Auto (best available)",
    cfg_theme: "🌗 Theme",

    /* ---------- config: eBay API ---------- */
    cfg_ebay_title: "eBay API mode",
    cfg_ebay_badge_api: "API mode active ({env})",
    cfg_ebay_badge_form: "Form automation — no official API access",
    cfg_ebay_untested: "⚠️ UNTESTED against eBay. Use Sandbox until the flow is reliable.",
    cfg_ebay_env: "Environment",
    cfg_ebay_app: "App ID (Client ID)",
    cfg_ebay_cert: "Cert ID (Client Secret)",
    cfg_ebay_secret_warn: "⚠️ This secret is stored locally in plaintext. Do not share your browser profile.",
    cfg_ebay_runame: "RuName (Redirect)",
    cfg_ebay_redirect: "Accepted redirect URL (paste into eBay portal)",
    cfg_ebay_cat: "Default category ID (optional)",
    cfg_ebay_cond: "Default condition",
    cfg_ebay_checklist: "Setup checklist",
    cfg_ebay_save: "💾 Save",
    cfg_ebay_connect: "🔗 Connect (OAuth)",
    cfg_ebay_check: "✔️ Check setup",
    cfg_ebay_disconnect: "Disconnect",
    cfg_ebay_chk_policies: "Business policies (shipping, payment, returns) configured",
    cfg_ebay_chk_location: "Merchant location created",
    cfg_ebay_chk_ruame: "RuName accepted URL = the redirect URL above",
    cfg_ebay_chk_images: "Items need public https image URLs",

    /* ---------- config: price watcher ---------- */
    cfg_pw_title: "Price Watcher",
    cfg_pw_hint: "Auto-reduces the target price if an item hasn't sold in N days.",
    cfg_pw_enabled: "Auto price reduction enabled",
    cfg_pw_days: "Reduce after how many days?",
    cfg_pw_percent: "Reduce by what percent?",
    cfg_pw_floor: "Floor = cost + fees (recommended)",
    cfg_pw_save: "💾 Save",
    cfg_pw_run: "▶️ Run now",

    /* ---------- config: delist ---------- */
    cfg_delist_title: "Auto-Delist",
    cfg_delist_hint: "After a sale, other live listings can be offered for delisting. Default = dry-run.",
    cfg_delist_live: "Allow live mode (actually clicks — careful!)",
    cfg_delist_live_confirm: "Really enable live mode? Delete-button clicks are irreversible.",

    /* ---------- config: consents & audit ---------- */
    cfg_consents_title: "Consents",
    cfg_consent_given: "granted",
    cfg_consent_missing: "missing",
    cfg_consent_grant: "Grant",
    cfg_consent_revoke: "Revoke",
    cfg_audit_title: "Audit log",
    cfg_audit_refresh: "🔄 Refresh",
    cfg_audit_export: "📤 Export JSON",
    cfg_audit_clear: "🗑 Clear",
    cfg_audit_empty: "No entries.",

    /* ---------- kill switch ---------- */
    legal_killswitch: "🚨 Stop all marketplace automation",
    killswitch_active_banner: "🚨 KILL SWITCH ACTIVE — no automation is running.",
    killswitch_off_confirm: "Really disable the kill switch? Automation will resume.",

    /* ---------- legal / base consent ---------- */
    legal_consent_title: "Consent & Risk Disclosure",
    legal_consent_text: "This extension automates actions on Kleinanzeigen, eBay.de and Vinted. Use at your own risk. Automated access may violate the terms of service of these platforms and lead to account suspension. I confirm that I will use it responsibly and in compliance with the respective terms of service.",
    legal_consent_btn: "I understand and accept",
    legal_warning_banner: "⚠️ Use at your own risk — violations can lead to account suspension.",
    legal_clauses: "Legal clauses",
    legal_sach: "Exclude liability for defects",
    legal_rück: "No returns / no warranty",
    legal_tausch: "No trades",

    /* ---------- per-feature consent ---------- */
    consent_feature_title: "Additional consent required",
    consent_feature_ebayApi: "eBay API mode creates real, fee-bearing listings via the official eBay API.",
    consent_feature_vinted: "Vinted automation fills forms on vinted.de automatically. Vinted explicitly prohibits automated access — highest ban risk.",
    consent_feature_autoDelist: "Auto-delist ends live listings on other platforms after a sale. Irreversible.",
    consent_feature_generic: "This feature accesses an external marketplace. Use at your own risk.",
    consent_accept: "Accept",
    consent_decline: "Decline",
    consent_declined: "Consent declined — action cancelled.",

    /* ---------- cross-delist modal ---------- */
    delist_title: "Sold — end other listings?",
    delist_intro: "You marked this item as sold. The following live listings can now be ended.",
    delist_sold_on: "Sold on",
    delist_sold_other: "(other platform)",
    delist_confirm: "Really end LIVE listing on {p}? This is irreversible.",
    delist_dismiss: "Remind me later",
    delist_none: "No other live listings found for this item.",
    delist_no_url: "No URL stored — please add it in the drawer.",
    delist_dry: "Dry-run",
    delist_live: "End live",
    delist_mark_ended: "Mark as ended",
    delist_live_on: "Live mode active — the delete button will actually be clicked.",
    delist_live_off: "Live mode disabled (default). Dry-run only.",

    /* ---------- drawer ---------- */
    drawer_listing_url: "Listing URL",
    drawer_mark_live: "Mark as live",
    drawer_apply_pending: "Apply price drop to: {p}",
    drawer_price_rule: "Price rule (per item)",
    drawer_rule_inherit: "Use global rule",
    drawer_rule_on: "On",
    drawer_rule_off: "Off",
    drawer_rule_days: "Days",
    drawer_rule_percent: "%",
    drawer_price_log: "Price history",
    drawer_api_images: "Image URLs (eBay API)",
    drawer_pub_vinted: "📢 Vinted",
    drawer_queue_ka: "🗂 Queue (KA)",
    drawer_queue_vinted: "🗂 Queue (Vinted)",
    drawer_delist: "✂️ End listings",
    drawer_ebay_api_create: "⚡ eBay API: create",
    drawer_ebay_api_update: "🔄 eBay API: update",
    drawer_ebay_api_end: "✂️ eBay API: end",

    /* ---------- V9 analytics ---------- */
    v9_tab_overview: "Overview",
    v9_tab_reports: "Reports",
    v9_revenue: "Revenue",
    v9_profit: "Profit",
    v9_reports: "Tax report",
    v9_ledger: "Ledger",
    v9_backup: "Backup",

    /* ---------- toasts ---------- */
    toast_saved: "Saved!",
    toast_error: "An error occurred.",
    toast_copied: "Copied to clipboard!"
  }
};