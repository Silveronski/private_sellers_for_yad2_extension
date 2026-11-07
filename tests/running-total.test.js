// The panel count is a running total across all pages of one search.
// Pages change the way yad2 does it: the URL changes (no reload) and the feed
// is re-rendered.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadPage, settle, panelText } = require("./helpers");

const dealer = (token) =>
  `<a href="item/${token}"><span class="x__agencyName">סוכנות</span></a>`;
const privateAd = (token) => `<a href="item/${token}"><span>רכב</span></a>`;

test("counts each dealer once per search, across pages", async (t) => {
  const window = loadPage({
    body: `<div class="feed"></div>`,
    url: "https://www.yad2.co.il/vehicles/cars?manufacturer=21",
  });
  t.after(() => window.close());
  const feed = window.document.querySelector(".feed");

  const openPage = async (url, html) => {
    window.history.pushState({}, "", url);
    feed.innerHTML = html;
    await settle();
    return panelText(window);
  };

  assert.equal(
    await openPage(
      "/vehicles/cars?manufacturer=21",
      dealer("d1") + dealer("d2") + privateAd("p1"),
    ),
    "הוסתרו 2 מודעות סוחרים",
    "page 1: two dealers",
  );
  assert.equal(
    await openPage(
      "/vehicles/cars?manufacturer=21&page=2",
      dealer("d3") + dealer("d1"),
    ),
    "הוסתרו 3 מודעות סוחרים",
    "page 2: one new dealer, d1 is a repeat",
  );
  assert.equal(
    await openPage("/vehicles/cars?manufacturer=21&page=3", privateAd("p3")),
    "הוסתרו 3 מודעות סוחרים",
    "page 3: no dealers, total unchanged",
  );
  assert.equal(
    await openPage(
      "/vehicles/cars?manufacturer=21",
      dealer("d1") + dealer("d2"),
    ),
    "הוסתרו 3 מודעות סוחרים",
    "back to page 1: nothing double-counted",
  );
  assert.equal(
    await openPage(
      "/vehicles/cars?manufacturer=48",
      dealer("x1") + privateAd("x2"),
    ),
    "הוסתרו 1 מודעות סוחרים",
    "different filter: fresh count",
  );
  assert.equal(
    await openPage("/vehicles/cars?manufacturer=21&page=4", dealer("d9")),
    "הוסתרו 4 מודעות סוחרים",
    "original filter again: resumes its total",
  );
});
