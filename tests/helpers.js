// Shared test setup: loads content.js into a simulated yad2 page, and the
// popup into a simulated popup window, with a fake chrome.* API.
//
// We use jsdom (a browser DOM implemented in Node) instead of a real browser,
// so the tests are fast and need no Chrome.

const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const read = (file) =>
  fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const CONTENT_SCRIPT = read("content.js");

/**
 * Creates a fake yad2 page and runs content.js in it.
 *
 * @param {object} options
 * @param {string} options.body  HTML for <body>
 * @param {string} [options.url] page URL
 * @param {object} [options.chrome] fake chrome API (see fakeChrome); omit to
 *                                  run without one
 * @returns {Window}
 */
function loadPage({ body, url = "https://www.yad2.co.il/vehicles/cars", chrome }) {
  const dom = new JSDOM(
    `<!doctype html><html><head></head><body>${body}</body></html>`,
    {
      url,
      runScripts: "outside-only",
      pretendToBeVisual: true, // enables requestAnimationFrame
    },
  );
  if (chrome) dom.window.chrome = chrome;
  dom.window.eval(CONTENT_SCRIPT);
  return dom.window;
}

/**
 * Opens popup.html with a fake chrome API and runs the scripts it loads
 * (its <script src> tags), so a missing tag makes the tests fail.
 */
function loadPopup(chrome) {
  const dom = new JSDOM(read("popup.html"), { runScripts: "outside-only" });
  const window = dom.window;
  window.chrome = chrome;
  for (const script of window.document.querySelectorAll("script[src]")) {
    window.eval(read(script.getAttribute("src")));
  }
  return window;
}

/**
 * Copies a value made inside a simulated page into a plain Node value, so
 * assert.deepEqual can compare it (objects from jsdom have different
 * prototypes). Chrome serialises extension messages the same way.
 */
const plain = (value) => JSON.parse(JSON.stringify(value));

/**
 * A minimal stand-in for the parts of the chrome.* API the extension uses.
 *
 * @param {object}   [options]
 * @param {object}   [options.stored]     initial chrome.storage.local contents
 * @param {Function} [options.tabStatus]  what the active tab's content script
 *                                        answers; throw to simulate "not a
 *                                        yad2 page"
 * The returned object also records calls: `.saved` (storage writes),
 * `.openedTabs`, and `.messageListeners` (runtime.onMessage listeners).
 */
function fakeChrome({ stored = {}, tabStatus = () => undefined } = {}) {
  const fake = {
    saved: [],
    openedTabs: [],
    messageListeners: [],
    storage: {
      local: {
        get: async (key) => (key in stored ? { [key]: stored[key] } : {}),
        set: async (items) => {
          fake.saved.push(items);
          Object.assign(stored, items);
        },
      },
      onChanged: { addListener: () => {} },
    },
    runtime: {
      onMessage: { addListener: (fn) => fake.messageListeners.push(fn) },
    },
    tabs: {
      query: async () => [{ id: 1 }],
      sendMessage: async (_tabId, message) => tabStatus(message),
      create: (props) => fake.openedTabs.push(props.url),
    },
  };
  return fake;
}

/** Sends a message to content.js the way chrome.tabs.sendMessage would. */
function askContentScript(chrome, message) {
  return new Promise((resolve) => {
    for (const listener of chrome.messageListeners) listener(message, {}, resolve);
  });
}

/** Waits for the next scan to finish (scans run on animation frames). */
const settle = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));

/** The label content.js gave the card containing `link`, or undefined. */
const labelOf = (link) => link.closest("[data-y2pf]")?.dataset.y2pf;

/** The count text shown in the floating panel. */
const panelText = (window) =>
  window.document.getElementById("y2pf-count")?.textContent;

module.exports = {
  loadPage,
  loadPopup,
  fakeChrome,
  askContentScript,
  plain,
  settle,
  labelOf,
  panelText,
};
