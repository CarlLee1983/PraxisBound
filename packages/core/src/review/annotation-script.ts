/**
 * The one fixed browser script contract §19 embeds in the Review Projection.
 *
 * Authoring choice: each part is an ordinary `String.raw` template literal
 * rather than a function's `.toString()`. `String.raw` leaves every
 * backslash untouched (no escaping of the regexes and `\n`/`\r` literals the
 * script needs), so the text reads exactly like the JS it is and stays inert
 * to Prettier. The literals therefore contain no backtick and no `${`.
 *
 * The script is assembled from four fragments that share one IIFE function
 * scope, in order:
 *
 * - `annotation-logic.ts`: limits, schema validation, Revision Sheet export
 *   and parsing, same-content comparison, and target quote text (§6/§13/§19);
 * - `annotation-state.ts`: Revision Request creation and every page state
 *   transition, as pure functions over an immutable `{ requests }` state;
 * - `annotation-dom.ts`: stateless DOM helpers and the request form builder;
 * - `annotation-ui.ts`: the DOM entry point, which only renders that state
 *   and dispatches those functions.
 *
 * When the host provides `globalThis.__PRAXIS_REVIEW_TEST__ = {}` before
 * evaluating the script, it attaches its pure API onto that object and does
 * nothing else — this is how `review-annotation.test.mjs` drives the exact
 * embedded logic from Node's `vm` module. Otherwise, in a page, it starts
 * the annotation UI.
 */

import { ANNOTATION_DOM } from "./annotation-dom.js";
import { ANNOTATION_LOGIC } from "./annotation-logic.js";
import { ANNOTATION_STATE } from "./annotation-state.js";
import { ANNOTATION_UI } from "./annotation-ui.js";

const BOOTSTRAP = String.raw`
  var testHook =
    typeof globalThis !== 'undefined' ? globalThis.__PRAXIS_REVIEW_TEST__ : undefined;
  if (testHook) {
    Object.keys(api).forEach(function (key) {
      testHook[key] = api[key];
    });
  } else if (typeof document !== 'undefined') {
    initAnnotationUi(api);
  }
`;

export const ANNOTATION_SCRIPT =
  "(function () {\n  'use strict';\n" +
  ANNOTATION_LOGIC +
  ANNOTATION_STATE +
  ANNOTATION_DOM +
  ANNOTATION_UI +
  BOOTSTRAP +
  "})();\n";
