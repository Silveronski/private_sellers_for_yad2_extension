// yad2 cards with the real site's structure and class names (copied from the
// live site; SVGs and tooltips removed, ad IDs and dealer name made up):
// the dealer must be hidden, the private sellers kept.

const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const { loadPage, settle, labelOf, panelText } = require("./helpers");

// A dealer ad shown as a "look-alike" recommendation. It has a relative href,
// an agency name and a trade-in flag.
const DEALER_CARD = `
<a data-nagish="look-alike-item-link" data-testid="dlr00001" data-listing-type="look-alike"
   class="look-alike-module-scss-module__DKN-Gq__box" href="item/dlr00001?opened-from=feed&amp;spot=look_alike">
  <div data-testid="promotion-layout"><div data-testid="promotion-image-box">
    <div class="feed-item-image-section-module-scss-module__pAkAta__container">
      <img alt="מודעת רכב יונדאי קונה">
      <div class="feed-item-image-section-module-scss-module__pAkAta__imageTagBox">
        <span data-testid="trade-in-flag" class="flag-module-scss-module__uRRuKa__baseFlag">גם בטרייד אין</span>
      </div>
      <span class="feed-item-image-section-module-scss-module__pAkAta__agencyNameBox">
        <span class="feed-item-image-section-module-scss-module__pAkAta__agencyName">סוכנות רכב לדוגמה בע"מ</span>
      </span>
    </div>
  </div>
  <h2><span>יונדאי קונה</span></h2><span data-testid="price">99,000 ₪</span></div>
</a>`;

const privateCard = (token, model) => `
<a data-nagish="private-item-link" data-testid="${token}" data-listing-type="private-vehicle"
   class="private-item-module-scss-module__Ar6L9a__box" href="item/${token}?opened-from=feed&amp;spot=standard">
  <div data-testid="promotion-layout"><div data-testid="promotion-image-box">
    <div class="feed-item-image-section-module-scss-module__pAkAta__container">
      <img alt="${model}"><div class="feed-item-image-section-module-scss-module__pAkAta__imageTagBox"></div>
    </div>
  </div>
  <h2><span>${model}</span></h2><span data-testid="price">97,180 ₪</span>
  <div class="tag-list-module-scss-module__eZ2wmW__box">
    <span data-testid="listing-item-flag" class="flag-module-scss-module__uRRuKa__grayFlag">גלגלי מגנזיום</span>
  </div></div>
</a>`;

const FEED = `<div class="feed">
  ${privateCard("prv00001", "טויוטה C-HR")}
  ${DEALER_CARD}
  ${privateCard("prv00002", "מאזדה 3")}
</div>`;

const windows = [];
after(() => windows.forEach((w) => w.close()));

function cardLabels(window) {
  const labels = {};
  for (const link of window.document.querySelectorAll(".feed a")) {
    labels[link.dataset.testid] = labelOf(link);
  }
  return labels;
}

test("hides the dealer card and keeps private cards", async () => {
  const window = loadPage({ body: FEED });
  windows.push(window);
  await settle();

  assert.deepEqual(cardLabels(window), {
    prv00001: "private",
    dlr00001: "dealer",
    prv00002: "private",
  });
  assert.equal(panelText(window), "הוסתרו 1 מודעות סוחרים");
});

test("switching the filter off shows dealers again", async () => {
  const window = loadPage({ body: FEED });
  windows.push(window);
  await settle();

  const html = window.document.documentElement;
  assert.ok(html.classList.contains("y2pf-on"), "filter starts on");

  const toggle = window.document.getElementById("y2pf-toggle");
  toggle.click(); // the user flips the switch
  await settle();

  assert.ok(!html.classList.contains("y2pf-on"), "CSS hiding is off");
  assert.equal(panelText(window), "1 מודעות סוחרים בחיפוש");
});
