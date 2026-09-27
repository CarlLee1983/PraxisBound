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

## Follow-up: native Safari A4 pagination

Observed 2026-09-27 16:49–16:54 UTC on this repository's `185b163` source, using the same `fixture()` builder in temporary repositories. Safari's application bundle reports version `26.5` (build `21624.2.5.11.4`) on macOS `26.5.1`. This is a separate WebKit-based browser from the Playwright WebKit `26.6` build above. The earlier Playwright MCP screen and print-media observations still stand; macOS Safari was operated through the native computer-use UI for its actual print dialog because Playwright cannot produce a WebKit PDF. No repository browser dependency was added.

The native Safari print dialog showed **A4, portrait, 100% scale, all pages** for each state. Its PDF control saved these paginated outputs under `evidence/webkit/`:

| State | PDF | Pages | Setup and visible result |
| --- | --- | ---: | --- |
| Initial | `safari-26.5-initial-a4.pdf` | 12 | Fresh `review index` and `review render`; original source and fingerprint print. |
| Restored | `safari-26.5-restored-a4.pdf` | 12 | Opened that initial projection, selected the existing exported `revision-sheet.md`, and applied it; the page displayed one restored, exported opinion before printing. The annotation drawer and its draft opinion are hidden by print CSS. |
| Revised | `safari-26.5-revised-a4.pdf` | 13 | In a fresh temporary fixture, confirmed the original fingerprint through the existing injected terminal adapter, imported the sheet, changed Alpha, and rendered again. The CLI returned `REVIEW_SOURCE_CHANGED`; the page and PDF showed the new fingerprint, changed source, and `需複審`. The synthetic fixture confirmation is not approval of real work. |
| Storage disabled | `safari-26.5-storage-disabled-a4.pdf` | 12 | In Safari Web Inspector, made `Storage.prototype.setItem` throw for this disposable page, then added an opinion. The page showed `瀏覽器無法暫存，請記得匯出` and `未匯出 1` before printing. That warning and the draft are hidden by print CSS. |
| Imported opinion, additional | `safari-26.5-imported-a4.pdf` | 12 | `review import` and re-render made the long opinion printable historical evidence. |

`pdfinfo` reports Safari as Creator and `595 × 842 pt` (A4) for all five PDFs. `pdftotext -layout` finds the original Alpha sentence and original fingerprint in the initial/restored/storage-disabled output; it finds the new fingerprint, clarified Alpha sentence, and `需複審` in the revised output; and it finds all 120 unbroken `A` characters plus the opinion rationale in the imported output. Visual inspection of the revised first page and imported opinion page 7 found the fingerprint wrapping within the page and the full opinion wrapping across three lines, with no cut right edge or missing end. The PDFs retain Safari's default header and footer, including the temporary local file path.

This establishes paginated A4 output for **Safari 26.5** on this fixture. It does not establish paginated output for **Playwright WebKit 26.6**: that build still has only continuous print-media screenshots. Those two version-specific claims must stay separate in user-facing support wording. Other versions, devices, and browsers remain **未驗證**.

## Follow-up: Playwright WebKit 26.6 paginated A4 output

Observed 2026-09-27 17:19–17:23 UTC after merge commit `0c2c1f3`, using the previously generated isolated TST-038 fixture; that merge changed evidence only, not the product renderer. The existing external Playwright MCP `1.64.0-alpha-1789764292000` launched its headed WebKit browser; `navigator.userAgent` reported `Version/26.6 Safari/605.1.15`. The Playwright app's native **Page Setup** showed A4 (210 × 297 mm), portrait, and 100% scale. Its **Print** dialog selected all pages, and the PDF control saved the actual paginated output. No repository browser dependency changed. This resolves the earlier print-dialog capture limitation for this build; the previous print-media screenshots remain separate evidence.

| State | PDF in `evidence/webkit/` | Pages | Observed setup |
| --- | --- | ---: | --- |
| Initial | `playwright-webkit-26.6-initial-a4.pdf` | 12 | Opened the original projection. |
| Restored | `playwright-webkit-26.6-restored-a4.pdf` | 12 | Used the page's Restore file picker and Apply control with the exported `sheet.md`; the panel reported one added opinion and displayed one exported opinion before printing. |
| Revised | `playwright-webkit-26.6-revised-a4.pdf` | 13 | Opened the confirmed-then-revised projection from the fixture; the page displayed the new fingerprint and `需複審`. Its confirmation is synthetic setup, not approval of real work. |
| Storage disabled | `playwright-webkit-26.6-storage-disabled-a4.pdf` | 12 | In the disposable Playwright page, made `Storage.getItem` and `Storage.setItem` throw before initialization, then added an opinion. The page displayed `瀏覽器無法暫存，請記得匯出` and `未匯出 1` before printing. |
| Imported opinion, additional | `playwright-webkit-26.6-imported-a4.pdf` | 12 | Opened the fixture's imported-opinion projection so the long opinion was printable historical evidence. |

`pdfinfo` identifies **Playwright** as Creator and reports `595 × 842 pt` (A4) for all five PDFs. `pdftotext -layout` finds the original fingerprint in the initial, restored, and storage-disabled PDFs; the revised PDF contains the new fingerprint, clarified Alpha text, and `需複審`; the imported PDF contains the full 120-character opinion and its rationale on page 7. Visual inspection of every page in the revised and imported PDFs, plus detailed views of revised page 1 and imported page 7, found the source, fingerprint, and long opinion wrapped within the page, with no cut right edge or missing end. The drawer and its draft opinion or storage warning are intentionally hidden by print CSS, as described above.

For this fixture, **Chrome 153.0.8010.54** and **Playwright WebKit 26.6** now have observed 1280 px, 390 px, and paginated A4 output for all four required states. Safari 26.5 has separate A4 evidence. Other browser engines or versions, devices, and pixel parity remain **未驗證**. The earlier unverified statements above describe what had been observed at those earlier checkpoints; they are superseded for Playwright WebKit 26.6 pagination by these five PDFs.
