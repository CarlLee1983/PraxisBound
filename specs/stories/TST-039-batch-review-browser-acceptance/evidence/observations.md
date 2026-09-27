# R-009 browser visual observations

Observed 2026-09-27 UTC against PraxisBound `915f2181338e7fa29e0f58b53a2a0a61ee78db60` plus this evidence-only branch. The subject was an isolated temporary repository created by `fixture()` in `packages/cli/test/review-batch-e2e-support.mjs`: batch `BR-127-e2e`, two Specs, four dependent Stories. The built `packages/cli/dist/bin.js` rendered local `file://` projections. The temporary fixture and the Playwright MCP installation were outside this repository; no package manifest or lockfile changed.

Playwright MCP `1.64.0-alpha-1789764292000` controlled both sessions. Chrome reported `153.0.8010.54` (`HeadlessChrome/153.0.0.0` user agent). Playwright WebKit reported `26.6` (`Version/26.6 Safari/605.1.15` user agent). Both were headless for the captured artifacts. The later headed WebKit print attempt is described below.

## State preparation

| State | Observed preparation | Fingerprint |
| --- | --- | --- |
| `initial` | `review index`, then `review render` | `01dbc9a159063e7be61aaa38278ef2cae83a6bf9c71692dfd57600ad64246399` |
| `restored` | In each browser, selected `R-001/AC-001`, entered a 120-character unbroken `A` run in a Revision Request, exported a Markdown Revision Sheet through the download link, cleared local storage, reloaded, and restored the exported sheet in the page | same original fingerprint |
| `revised` | In the temporary fixture, confirmed the original fingerprint through the existing injected terminal adapter, imported the exported sheet, revised Alpha, recorded a response, and rendered again; `review render` reported `REVIEW_SOURCE_CHANGED` | `74bed2c452cd100e4c78e89f7a07ae0584b7e2060bfcc1f2398300a5120b9318` |
| `storage-disabled` | Overrode `Storage.getItem` and `Storage.setItem` before page script initialization so both throw; then added an opinion through the UI | original fingerprint |

The fixture confirmation and response are synthetic visual setup, not a human approval of real work. The exported sample is [`revision-sheet.md`](revision-sheet.md). The `imported` captures are an additional state showing how the same opinion becomes printable historical evidence after `review import` and re-render.

## Captures and inspection

Each browser directory contains `initial`, `restored`, `revised`, and `storage-disabled` captures at `desktop` (1280×900 CSS px), `narrow` (390×844 CSS px), and `print` (794 CSS px with print media). Images are lossless WebP screenshots. Chrome also has actual A4 `*-a4.pdf` files generated through Playwright. The extra `imported` captures show printable opinion evidence; each browser also has `restored-panel-bottom.webp` showing the long restored opinion after scrolling the 390 px drawer.

| Browser and view | Observation |
| --- | --- |
| Chrome 1280 and 390 | All four states rendered with no page-level horizontal overflow (`scrollWidth == viewportWidth`). The fingerprint wrapped at 390 px. The revised page showed the new fingerprint and `需複審`. The disabled-storage page showed the persistent export warning and one `未匯出` opinion. |
| WebKit 1280 and 390 | Same observations. The long restored opinion wrapped in the internally scrollable drawer; its ending and rationale are visible in `restored-panel-bottom.webp`. The revised page showed the new fingerprint and `需複審`. |
| Chrome A4 | Playwright generated A4 PDFs for all four states. `pdfinfo` reported 11 pages for `initial`, `restored`, and `storage-disabled`, and 12 for `revised`; the extra `imported` PDF also had 12. The revised PDF contains `需複審`, the changed source, and both fingerprints. `pdftotext` confirms the original Alpha sentence and imported opinion in the relevant PDFs. Visual inspection found wrapped source digests and opinion text rather than a cut right edge. |
| WebKit print media | At 794 CSS px, print-style full-page screenshots were captured for all four states and the extra `imported` state. The visible source, fingerprints, changed-source badges, and imported long opinion wrapped inside the page width; the full opinion and rationale are visible in `imported-print.webp`. These are continuous print-media screenshots, not paginated A4 preview or PDF. |

The browser drawer is intentionally hidden by existing print CSS. Thus the `restored` print artifact has the source and fingerprint but not the draft opinion. After `review import`, the historical evidence area prints the opinion, as shown by `imported-print.webp` and `imported-a4.pdf`. This is a visibility distinction, not a truncated opinion.

## Limits and support statement for #131

Playwright returned `page.pdf: PDF generation is only supported for Headless Chromium` in WebKit. A headed WebKit `window.print()` was invoked through Playwright MCP, but the macOS print dialog could not be captured by the available computer-use service (`SCStreamErrorDomain -3811` on two attempts). **WebKit A4 pagination and page-break behavior are unverified.** Its print-media CSS at A4 width was observed; that is a narrower claim.

Chrome `153.0.8010.54` has observed desktop, narrow, and paginated A4 output for these fixture states. WebKit `26.6` has observed desktop, narrow, and continuous print-media rendering only. Other browser engines and versions, device-specific behavior, and WebKit paginated A4 output are **未驗證**. No pixel parity or general browser-support guarantee follows from this single fixture.
