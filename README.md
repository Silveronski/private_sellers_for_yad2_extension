# Private Sellers Filter for Yad2

A Chrome extension that hides car-dealer and agency ads on [yad2](https://www.yad2.co.il/vehicles/cars) vehicle listings, so you only see private sellers.

- Dealer ads are hidden as the page loads, with no flash of dealer cards first.
- An on-page switch (**מוכרים פרטיים בלבד**) and a toolbar popup turn the filter on and off. The setting is shared across all yad2 tabs.
- A counter shows how many dealer ads were hidden across every page of the current search you've opened.

## Install

### From source (developer mode)

1. Build the extension (see [Development](#development)), or use the project folder as is.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select `dist/yad2-private-filter-<version>/` (or the project folder).
4. Open a yad2 vehicles page, for example `https://www.yad2.co.il/vehicles/cars`.

After changing the code, click the reload icon on the extension's card in `chrome://extensions`, then refresh the yad2 tab.

## How it works

The extension reads only what's visible on each listing card. It doesn't make any network requests.

1. **Find ads.** Every link to `item/<token>` is an ad. The *token* is yad2's ad ID.
2. **Find the card.** From each link, it climbs up the page to the element that holds that ad and no other.
3. **Classify.** A card is a **dealer** if it shows any of these:
   - an agency-name element (class containing `agency`, `merchant` or `commercial`)
   - the trade-in flag (`data-testid="trade-in-flag"`, "גם בטרייד אין")
   - dealer phrases in its text: התחייבויות, טרייד אין

   Any other card is **private**.
4. **Hide.** The card gets `data-y2pf="dealer"` or `"private"`. While the filter is on, `<html>` has the class `y2pf-on`, and a CSS rule hides dealer cards.
5. **Count.** Dealer ad IDs are added to a running total for the current search, kept per tab in `sessionStorage`. A *search* is the URL without its `page` parameter, so paging through results keeps one total and changing filters starts a new one.

A `MutationObserver` rescans whenever yad2 adds content, for example on scrolling or moving to the next page. Rescans run at most once per animation frame.

### Popup

Clicking the toolbar icon opens a popup with the same switch. On a yad2 vehicles page it shows that tab's count, which it gets by asking the content script. On other sites it offers a link to yad2.

## Project structure

```
manifest.json        Extension manifest (Manifest V3)
content.js           All page logic: find cards, classify, hide, count, on-page switch
content.css          Hides dealer cards; styles the on-page switch
popup.html/.css/.js  Toolbar popup
icons/               Extension icons (16, 32, 48, 128 px), generated
icon-original.png    Source image for the icons (not shipped)
scripts/
  build.ps1          Validates and packages the extension into dist/
  make-icons.ps1     Generates icons/ from icon-original.png
tests/               Automated tests (Node test runner + jsdom)
```

## Development

Requirements: Node.js 20+ and Windows PowerShell. The build and icon scripts use PowerShell.

```bash
npm install        # installs jsdom, used only by the tests
npm test           # runs the tests
npm run build      # validates and packages the extension
npm run icons      # regenerates icons/ from icon-original.png
```

### Tests

The tests run the real `content.js` and `popup.html` in a simulated browser (jsdom) with a fake `chrome` API:

- **cards.test.js**: real yad2 cards. The dealer is hidden, private sellers are kept, and the switch works.
- **running-total.test.js**: the count across pages, repeated ads and filter changes.
- **popup.test.js**: the popup's count, switch and saved setting, its "not on yad2" state, and the content script's replies.

### Build

`npm run build`:

1. Validates `manifest.json`: required fields, version format and Web Store limits.
2. Collects only the files the manifest references, plus the files its HTML pages load, and checks that they exist.
3. Checks that every script parses and that each icon's size matches the manifest.
4. Runs the tests. Pass `-SkipTests` to skip them when calling the script directly.
5. Writes `dist/yad2-private-filter-<version>/` (unpacked) and `dist/yad2-private-filter-<version>.zip` (for the Chrome Web Store).

Any failed check stops the build with a message saying what to fix.

### Releasing

1. Raise `version` in `manifest.json`. The Web Store rejects a version number it has already received.
2. Run `npm run build`.
3. Test the build with **Load unpacked** on `dist/yad2-private-filter-<version>/`.
4. Upload the zip in the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).

### Icons

Replace `icon-original.png` with a square image (1024×1024 or larger) and run `npm run icons`. The script:

- makes a dark background around a rounded-square icon transparent
- writes the 16, 32 and 48 px sizes full-bleed
- writes the 128 px size with Chrome's recommended 16 px of transparent padding

## Permissions and privacy

| Permission | Why |
|---|---|
| `storage` | Remembers whether the filter is on |
| Content script on `yad2.co.il/vehicles/*` | Reads and hides listing cards. The extension runs nowhere else |

The extension collects no data, makes no network requests and loads no remote code. See the full [privacy policy](PRIVACY.md). The only things it stores are the on/off setting (`chrome.storage.local`) and, per tab, the IDs of dealer ads already counted (`sessionStorage`).

## Limitations

- **Detection depends on what yad2 shows.** A dealer card with no agency name or trade-in flag is treated as private. If yad2 renames its classes, update `DEALER_MARKER_SELECTOR` and `DEALER_TEXT_MARKERS` in `content.js`.
- **The counter is a running total.** It only includes pages of the search you've opened in this tab, and a new tab starts from zero.
- **Page numbers are assumed to be in a `page` URL parameter.** If yad2 uses a different name, the count resets on every page; change it in `getSearchKey()` in `content.js`.

## License

[MIT](LICENSE)

## Disclaimer

This is an independent project, not affiliated with or endorsed by yad2.
