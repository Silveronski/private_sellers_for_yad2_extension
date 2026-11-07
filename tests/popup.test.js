// The toolbar popup, and the status content.js gives it.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  loadPage,
  loadPopup,
  fakeChrome,
  askContentScript,
  plain,
  settle,
} = require("./helpers");

const dealer = (token) =>
  `<a href="item/${token}"><span class="x__agencyName">סוכנות</span></a>`;
const privateAd = (token) => `<a href="item/${token}"><span>רכב</span></a>`;

test("content.js tells the popup its dealer count", async (t) => {
  const chrome = fakeChrome();
  const window = loadPage({
    body: `<div class="feed">${dealer("d1") + dealer("d2") + privateAd("p1")}</div>`,
    chrome,
  });
  t.after(() => window.close());
  await settle();

  const status = await askContentScript(chrome, { type: "y2pf-status" });
  assert.deepEqual(plain(status), { filterOn: true, dealerCount: 2 });
});

test("popup on a yad2 page shows the count and the switch", async (t) => {
  const chrome = fakeChrome({ tabStatus: () => ({ filterOn: true, dealerCount: 3 }) });
  const window = loadPopup(chrome);
  t.after(() => window.close());
  await settle();

  const doc = window.document;
  const toggle = doc.getElementById("toggle");
  assert.equal(toggle.checked, true, "switch starts on (default)");
  assert.equal(doc.getElementById("status").textContent, "הוסתרו 3 מודעות סוחרים");
  assert.equal(doc.getElementById("not-yad2").hidden, true);

  toggle.click(); // user turns the filter off
  assert.deepEqual(plain(chrome.saved), [{ y2pfEnabled: false }], "setting saved");
  assert.equal(doc.getElementById("status").textContent, "3 מודעות סוחרים בחיפוש");
});

test("popup remembers the switch was turned off", async (t) => {
  const chrome = fakeChrome({
    stored: { y2pfEnabled: false },
    tabStatus: () => ({ filterOn: false, dealerCount: 0 }),
  });
  const window = loadPopup(chrome);
  t.after(() => window.close());
  await settle();

  assert.equal(window.document.getElementById("toggle").checked, false);
});

test("popup on another site offers to open yad2", async (t) => {
  const chrome = fakeChrome({
    tabStatus: () => {
      throw new Error("Could not establish connection. Receiving end does not exist.");
    },
  });
  const window = loadPopup(chrome);
  t.after(() => window.close());
  await settle();

  const doc = window.document;
  assert.equal(doc.getElementById("status").hidden, true);
  assert.equal(doc.getElementById("not-yad2").hidden, false);

  window.close = () => {}; // popup.js closes the popup after opening the tab
  doc.getElementById("open-yad2").click();
  assert.deepEqual(chrome.openedTabs, ["https://www.yad2.co.il/vehicles/cars"]);
});
