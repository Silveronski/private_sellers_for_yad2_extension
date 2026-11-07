/**
 * popup.js — the toolbar popup (popup.html).
 *
 * Flow
 *   popup opens
 *     ├─ read the on/off setting from chrome.storage → set the switch
 *     └─ ask the content script in the current tab for its status
 *          ├─ it answers (a yad2 vehicles page) → show the hidden-ads count
 *          └─ no answer (any other site)        → show "open yad2" link
 *
 *   switch flipped → save to chrome.storage
 *     → content.js in every yad2 tab hears the change and shows/hides dealers
 *       (see storage.onChanged in content.js)
 */

const SETTING_KEY = "y2pfEnabled"; // must match content.js
const YAD2_VEHICLES_URL = "https://www.yad2.co.il/vehicles/cars";

const toggle = document.getElementById("toggle");
const statusText = document.getElementById("status");
const notYad2 = document.getElementById("not-yad2");

let dealerCount = null; // null = current tab isn't a yad2 vehicles page

/** Same wording as the on-page panel in content.js. */
function countText(count, filterOn) {
  if (count === 0) return "אין מודעות סוחרים בחיפוש"; //    "no dealer ads in this search"
  if (filterOn) return `הוסתרו ${count} מודעות סוחרים`; // "N dealer ads hidden"
  return `${count} מודעות סוחרים בחיפוש`; //               "N dealer ads in this search"
}

function render() {
  const onYad2 = dealerCount !== null;
  statusText.hidden = !onYad2;
  notYad2.hidden = onYad2;
  if (onYad2) statusText.textContent = countText(dealerCount, toggle.checked);
}

/** Asks content.js in the active tab for its count. Null if it isn't running there. */
async function getTabStatus() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return null;
  try {
    return await chrome.tabs.sendMessage(tab.id, { type: "y2pf-status" });
  } catch {
    return null; // no content script on this page (not a yad2 vehicles page)
  }
}

async function init() {
  const saved = await chrome.storage.local.get(SETTING_KEY);
  toggle.checked = saved[SETTING_KEY] !== false; // default: on

  const status = await getTabStatus();
  dealerCount = status?.dealerCount ?? null;
  render();
}

toggle.addEventListener("change", () => {
  chrome.storage.local.set({ [SETTING_KEY]: toggle.checked });
  render();
});

document.getElementById("open-yad2").addEventListener("click", () => {
  chrome.tabs.create({ url: YAD2_VEHICLES_URL });
  window.close();
});

init();
