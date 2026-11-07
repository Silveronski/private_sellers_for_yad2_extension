/**
 * content.js — the whole extension logic.
 *
 * Runs on yad2 vehicle pages (see manifest.json).
 *
 * What it does
 *   1. Finds every listing card on the page.
 *   2. Decides dealer vs. private from what's visible on the card (an agency
 *      name, a trade-in flag…) and marks it data-y2pf="dealer" or "private".
 *   3. content.css hides dealer cards while <html> has the class "y2pf-on".
 *   4. Shows a floating on/off switch with a count of dealer ads hidden
 *      across all pages of the current search.
 *   5. Tells the toolbar popup (popup.js) that count when it asks.
 *
 * Flow
 *
 *   page DOM changes (load, scroll, next page) ─┐
 *   switch toggled ─────────────────────────────┴─▶ scheduleScan()
 *                                                        │ (at most once per frame)
 *                                                        ▼
 *                                                   scanPage()
 *     for each ad link on the page:
 *       findCard()  →  classifyCard()  →  set data-y2pf on the card
 *     then:
 *       updateSearchTotal()  →  updatePanel()
 *
 * An "ad token" is yad2's ID for an ad, taken from its link: /item/<token>.
 */
(() => {
  // ─── Settings ─────────────────────────────────────────────────────────────

  const SETTING_KEY = "y2pfEnabled"; //  chrome.storage key for the on/off switch
  const FILTER_ON_CLASS = "y2pf-on"; //  on <html>; content.css hides dealers while set
  const SEARCH_TOTAL_PREFIX = "y2pf:"; // sessionStorage key prefix for running totals

  // Ad links. yad2 uses relative hrefs ("item/abc123?..."), so the selector is
  // loose; getAdToken() reads the browser-resolved path to be exact.
  const AD_LINK_SELECTOR = 'a[href*="item/"]';
  const AD_TOKEN_PATTERN = /\/item\/([A-Za-z0-9_-]+)/;

  // Once an element is this tall, assume it's the whole card (see findCard).
  const CARD_MIN_HEIGHT_PX = 120;

  // Visible signs on a card that mean "dealer". A card with none is private.
  const DEALER_MARKER_SELECTOR = [
    '[class*="agency" i]', //     e.g. the agency name box
    '[class*="merchant" i]',
    '[class*="commercial" i]',
    '[data-testid*="agency" i]',
    '[data-testid="trade-in-flag"]', // "גם בטרייד אין"
  ].join(", ");
  const DEALER_TEXT_MARKERS = ["התחייבויות", "טרייד אין", "טרייד-אין"];

  // ─── State ────────────────────────────────────────────────────────────────

  let filterOn = true;
  let panel = null; //        the floating switch element, created on first scan
  let scanQueued = false;

  /** Running total for the current search (see "Running total" below). */
  let currentSearchKey = null;
  let searchDealers = new Set();

  // ─── Reading the page ─────────────────────────────────────────────────────

  /** "…/item/abc123?x=1" → "abc123", or null for links that aren't ads. */
  function getAdToken(link) {
    return AD_TOKEN_PATTERN.exec(link.pathname ?? "")?.[1] ?? null;
  }

  /** True if every ad link inside `element` points to the same ad. */
  function holdsOnlyAd(element, token) {
    return [...element.querySelectorAll(AD_LINK_SELECTOR)].every(
      (link) => getAdToken(link) === token,
    );
  }

  /**
   * Finds the element that represents the whole card for an ad link — the
   * thing we hide. It must not contain any *other* ad, or we'd hide that too.
   */
  function findCard(link, token) {
    // Many layouts wrap each ad in an <li>.
    const listItem = link.closest("li");
    if (listItem && holdsOnlyAd(listItem, token)) return listItem;

    // Otherwise climb up from the link while the parent still holds only this
    // ad. Stop at <body>, or once the element is tall enough to be a card.
    let card = link;
    let parent = card.parentElement;
    while (parent && parent !== document.body && holdsOnlyAd(parent, token)) {
      card = parent;
      if (card.getBoundingClientRect().height > CARD_MIN_HEIGHT_PX) break;
      parent = card.parentElement;
    }
    return card;
  }

  /** True if the card visibly shows it's a dealer (agency name, trade-in…). */
  function hasDealerMarker(card) {
    const marker = card.querySelector(DEALER_MARKER_SELECTOR);
    if (marker?.textContent.trim()) return true;

    const text = card.textContent ?? "";
    return DEALER_TEXT_MARKERS.some((phrase) => text.includes(phrase));
  }

  /** "dealer" if the card shows a dealer marker, otherwise "private". */
  function classifyCard(card) {
    return hasDealerMarker(card) ? "dealer" : "private";
  }

  // ─── Running total across all pages of a search ───────────────────────────
  // The count in the panel covers every page of the current search you've
  // opened in this tab, not just the page on screen. Each dealer ad is counted
  // once, by token. The total is kept in sessionStorage, so it survives page
  // changes and reloads, but a new tab starts from zero.
  //
  // A "search" is the URL without its page number: ?manufacturer=21&page=3 and
  // ?manufacturer=21 are the same search. Changing a filter starts a new count.

  function getSearchKey() {
    const params = new URLSearchParams(location.search);
    params.delete("page");
    params.sort(); // same filters in a different order = same search
    return `${SEARCH_TOTAL_PREFIX}${location.pathname}?${params}`;
  }

  function loadSearchTotal(key) {
    try {
      return new Set(JSON.parse(sessionStorage.getItem(key)) ?? []);
    } catch {
      return new Set(); // storage blocked or corrupted
    }
  }

  function saveSearchTotal(key, dealers) {
    try {
      sessionStorage.setItem(key, JSON.stringify([...dealers]));
    } catch {
      // Storage blocked or full — the count just won't persist.
    }
  }

  /**
   * Adds this page's dealers to the running total and returns the new total.
   * Ads now labelled private are removed, in case yad2 re-rendered a card
   * and it no longer shows a dealer marker.
   */
  function updateSearchTotal(pageDealers, pagePrivates) {
    const key = getSearchKey();
    if (key !== currentSearchKey) {
      // URL changed to a different search (or this is the first scan).
      currentSearchKey = key;
      searchDealers = loadSearchTotal(key);
    }

    let changed = false;
    for (const token of pageDealers) {
      if (!searchDealers.has(token)) {
        searchDealers.add(token);
        changed = true;
      }
    }
    for (const token of pagePrivates) {
      if (searchDealers.delete(token)) changed = true;
    }

    if (changed) saveSearchTotal(key, searchDealers);
    return searchDealers.size;
  }

  // ─── Main pass ────────────────────────────────────────────────────────────

  /** Labels every card on the page and refreshes the panel. */
  function scanPage() {
    scanQueued = false;
    if (!document.body) return;

    const pageDealers = new Set();
    const pagePrivates = new Set();
    const handledCards = new Set(); // a card can contain several links to its ad

    for (const link of document.querySelectorAll(AD_LINK_SELECTOR)) {
      const token = getAdToken(link);
      if (!token) continue;

      const card = findCard(link, token);
      if (handledCards.has(card)) continue;
      handledCards.add(card);

      const kind = classifyCard(card);
      // Only touch the DOM when the label changes, so we don't retrigger our
      // own MutationObserver for nothing.
      if (card.dataset.y2pf !== kind) card.dataset.y2pf = kind;

      (kind === "dealer" ? pageDealers : pagePrivates).add(token);
    }

    updatePanel(updateSearchTotal(pageDealers, pagePrivates));
  }

  /**
   * Requests a scan on the next animation frame. Many triggers in a row (e.g.
   * dozens of DOM mutations while yad2 renders a page) collapse into one scan.
   */
  function scheduleScan() {
    if (scanQueued) return;
    scanQueued = true;
    requestAnimationFrame(scanPage);
  }

  // ─── Floating panel (on/off switch + count) ───────────────────────────────

  function createPanel() {
    panel = document.createElement("div");
    panel.id = "y2pf-panel";
    panel.dir = "rtl";
    panel.innerHTML = `
      <label class="y2pf-row">
        <input type="checkbox" id="y2pf-toggle">
        <span class="y2pf-switch" aria-hidden="true"></span>
        <span class="y2pf-label">מוכרים פרטיים בלבד</span>
      </label>
      <div class="y2pf-count" id="y2pf-count"></div>`;
    document.body.append(panel);

    const toggle = panel.querySelector("#y2pf-toggle");
    toggle.checked = filterOn;
    toggle.addEventListener("change", () => {
      setFilterOn(toggle.checked);
      saveSetting(toggle.checked);
    });
  }

  function countText(dealerCount) {
    if (dealerCount === 0) return "אין מודעות סוחרים בחיפוש"; //    "no dealer ads in this search"
    if (filterOn) return `הוסתרו ${dealerCount} מודעות סוחרים`; // "N dealer ads hidden"
    return `${dealerCount} מודעות סוחרים בחיפוש`; //               "N dealer ads in this search"
  }

  function updatePanel(dealerCount) {
    // yad2 can re-render the page and remove our panel; recreate it if so.
    if (!panel?.isConnected) createPanel();
    panel.querySelector("#y2pf-count").textContent = countText(dealerCount);
  }

  /** Turns hiding on/off. The CSS rule does the actual hiding. */
  function setFilterOn(on) {
    filterOn = on;
    document.documentElement.classList.toggle(FILTER_ON_CLASS, on);
    const toggle = panel?.querySelector("#y2pf-toggle");
    if (toggle) toggle.checked = on;
    scheduleScan(); // refresh the panel text
  }

  // ─── Saved on/off setting (chrome.storage, shared by all yad2 tabs) ───────

  function saveSetting(on) {
    try {
      globalThis.chrome?.storage?.local
        .set({ [SETTING_KEY]: on })
        .catch(() => {});
    } catch {
      // Extension was reloaded since this page opened — can't save.
    }
  }

  async function loadSetting() {
    const storage = globalThis.chrome?.storage;
    if (!storage) return;

    const saved = await storage.local.get(SETTING_KEY);
    setFilterOn(saved[SETTING_KEY] !== false); // default: on

    // Keep other open yad2 tabs in sync when the switch is flipped in one.
    storage.onChanged.addListener((changes, area) => {
      if (area === "local" && SETTING_KEY in changes) {
        setFilterOn(changes[SETTING_KEY].newValue !== false);
      }
    });
  }

  // ─── Status for the toolbar popup (popup.js) ──────────────────────────────

  /**
   * When the popup opens it asks this tab for its status, to show the count.
   * (The on/off switch itself goes through chrome.storage, handled above.)
   */
  function answerPopup() {
    globalThis.chrome?.runtime?.onMessage?.addListener(
      (message, _sender, sendResponse) => {
        if (message?.type !== "y2pf-status") return;
        sendResponse({ filterOn, dealerCount: searchDealers.size });
      },
    );
  }

  // ─── Start ────────────────────────────────────────────────────────────────
  // We run at document_start (before the page is drawn) so the class below is
  // set before any cards appear.

  // Hide dealers straight away, before the saved setting loads, so dealer ads
  // don't flash on screen. loadSetting() turns it off if the user chose that.
  document.documentElement.classList.add(FILTER_ON_CLASS);

  loadSetting().catch(() => {
    // Extension was reloaded or storage is unavailable — keep the default.
  });
  answerPopup();

  function start() {
    scheduleScan();
    // Rescan whenever yad2 adds or replaces content (scrolling, paging…).
    new MutationObserver(scheduleScan).observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
})();
