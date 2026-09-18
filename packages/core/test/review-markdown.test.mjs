import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { TextEncoder } from "node:util";

import {
  renderMarkdownHtml,
  scanMarkdownDocument,
} from "../dist/review/markdown-html.js";

const encoder = new TextEncoder();

function bytesOf(text) {
  return encoder.encode(text);
}

/** Scans once and renders one full-document range, for tests that render a whole document. */
function renderAll(bytes, options) {
  const document = scanMarkdownDocument(bytes);
  return renderMarkdownHtml(document, 0, bytes.length, options);
}

const subsetDocument = `# Heading One

Some *emphasis* and **strong** text with \`code\` and a [link](https://example.test/page).

- [ ] first item
- [x] second item
  continued text
  - nested item

| A | B |
| --- | --- |
| 1 | 2 |

\`\`\`
const value = 1;
\`\`\`

> quoted line
> second quoted line

## Heading Two

More text here.
`;

test("TST022-AC-005: renders headings, paragraphs, lists, tables, fences, quotes and inline markup as HTML structure", () => {
  const bytes = bytesOf(subsetDocument);
  const html = renderAll(bytes);

  assert.match(html, /<h1>Heading One<\/h1>/);
  assert.match(html, /<h2>Heading Two<\/h2>/);
  assert.match(
    html,
    /<p>Some <em>emphasis<\/em> and <strong>strong<\/strong> text with <code>code<\/code> and a <a href="https:\/\/example\.test\/page">link<\/a>\.<\/p>/,
  );
  assert.match(html, /<ul>.*<li>.*first item.*<\/li>/s);
  assert.match(
    html,
    /<li>.*second item.*<ul><li>.*nested item.*<\/li><\/ul><\/li>/s,
  );
  assert.match(
    html,
    /<div class="table-scroll"><table><thead><tr><th>A<\/th><th>B<\/th><\/tr><\/thead><tbody><tr><td>1<\/td><td>2<\/td><\/tr><\/tbody><\/table><\/div>/,
  );
  assert.match(html, /<pre><code>const value = 1;<\/code><\/pre>/);
  assert.match(
    html,
    /<blockquote><p>quoted line second quoted line<\/p><\/blockquote>/,
  );

  // No Markdown marker survives as literal text outside its rendered structure.
  assert.doesNotMatch(html, /##/);
  assert.doesNotMatch(html, /```/);
  assert.doesNotMatch(html, /^-\s|\n-\s/);
});

test("TST022-AC-005: only lines whose start lies in [start, end) are rendered", () => {
  const bytes = bytesOf(subsetDocument);
  const document = scanMarkdownDocument(bytes);
  const text = subsetDocument;
  const secondHeadingStart = text.indexOf("## Heading Two");

  const html = renderMarkdownHtml(document, secondHeadingStart, bytes.length);

  assert.match(html, /<h2>Heading Two<\/h2>/);
  assert.match(html, /<p>More text here\.<\/p>/);
  assert.doesNotMatch(html, /Heading One/);
  assert.doesNotMatch(html, /nested item/);
});

test("TST022-AC-005: headingLevelOffset shifts every rendered heading, clamped to 6", () => {
  const document = "###### Deepest\n\nBody text.\n";
  const bytes = bytesOf(document);

  const shifted = renderAll(bytes, { headingLevelOffset: 3 });

  assert.match(shifted, /<h6>Deepest<\/h6>/);
});

test("TST022-AC-005: headingAttributes and listItemAttributes attach escaped attributes to the right element", () => {
  const document = "# Title\n\n- keep this\n- flag this\n";
  const bytes = bytesOf(document);

  const html = renderAll(bytes, {
    headingAttributes: (heading) =>
      heading.text === "Title" ? { "data-anchor": '"quoted"' } : undefined,
    listItemAttributes: (line) =>
      line.trimmed.includes("flag") ? { "data-flag": "yes" } : undefined,
  });

  assert.match(html, /<h1 data-anchor="&quot;quoted&quot;">Title<\/h1>/);
  assert.match(html, /<li>keep this<\/li>/);
  assert.match(html, /<li data-flag="yes">flag this<\/li>/);
});

test("TST022-AC-005: listItemPrefix renders an escaped label span at the start of its own <li>", () => {
  const document =
    "- not an AC\n- AC-001: first\n  - AC-002: nested\n- AC-010: last\n";
  const bytes = bytesOf(document);

  const html = renderAll(bytes, {
    listItemPrefix: (line) => {
      const match = /AC-(\d+):/.exec(line.trimmed);
      return match === null ? undefined : `R-1/AC-${match[1]}`;
    },
  });

  assert.match(html, /<li>not an AC<\/li>/);
  assert.match(
    html,
    /<li><span class="ac-id">R-1\/AC-001<\/span> AC-001: first/,
  );
  assert.match(
    html,
    /<li><span class="ac-id">R-1\/AC-002<\/span> AC-002: nested/,
  );
  assert.match(
    html,
    /<li><span class="ac-id">R-1\/AC-010<\/span> AC-010: last/,
  );
});

test("TST022-AC-009: a source checkbox renders as a non-interactive glyph, never a control", () => {
  const document = "- [ ] pending item\n- [x] done item\n- [X] also done\n";
  const bytes = bytesOf(document);

  const html = renderAll(bytes);

  assert.match(
    html,
    /<span class="checkbox-glyph" aria-hidden="true">☐<\/span> pending item/,
  );
  assert.match(
    html,
    /<span class="checkbox-glyph" aria-hidden="true">☑<\/span> done item/,
  );
  assert.match(
    html,
    /<span class="checkbox-glyph" aria-hidden="true">☑<\/span> also done/,
  );
  assert.doesNotMatch(html, /<input/i);
  assert.doesNotMatch(html, /<button/i);
  assert.doesNotMatch(html, /type="checkbox"/i);
});

test("TST022-AC-010/Security Fixture Matrix: a script/img payload in the source body is preserved as escaped text, not executable markup", () => {
  const document =
    "Body text with a payload: <script>alert(1)</script><img src=x onerror=alert(1)>\n";
  const bytes = bytesOf(document);

  const html = renderAll(bytes);

  assert.match(
    html,
    /&lt;script&gt;alert\(1\)&lt;\/script&gt;&lt;img src=x onerror=alert\(1\)&gt;/,
  );
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<img /);
});

test("TST022-AC-010/Security Fixture Matrix: javascript:, data:, and mailto: links carry no href", () => {
  const document =
    "[x](javascript:alert(1))\n\n[y](data:text/html,payload)\n\n[z](mailto:a@example.test)\n";
  const bytes = bytesOf(document);

  const html = renderAll(bytes);

  assert.doesNotMatch(html, /href="javascript/);
  assert.doesNotMatch(html, /href="data:/);
  assert.doesNotMatch(html, /href="mailto:/);
  assert.match(html, /<a class="unsafe-link">x<\/a>/);
  assert.match(html, /<a class="unsafe-link">y<\/a>/);
  assert.match(html, /<a class="unsafe-link">z<\/a>/);
});

test("TST022-AC-010/Security Fixture Matrix: http:, https:, and in-page fragment links carry an href", () => {
  const document =
    "[a](http://example.test)\n\n[b](https://example.test)\n\n[c](#fragment)\n";
  const bytes = bytesOf(document);

  const html = renderAll(bytes);

  assert.match(html, /<a href="http:\/\/example\.test">a<\/a>/);
  assert.match(html, /<a href="https:\/\/example\.test">b<\/a>/);
  assert.match(html, /<a href="#fragment">c<\/a>/);
});

test("TST022-AC-005: paragraph lines join with a space for ASCII neighbors and no space for CJK", () => {
  const asciiBytes = bytesOf("line one\nline two\n");
  const cjkBytes = bytesOf("第一行\n第二行\n");

  const asciiHtml = renderAll(asciiBytes);
  const cjkHtml = renderAll(cjkBytes);

  assert.match(asciiHtml, /<p>line one line two<\/p>/);
  assert.match(cjkHtml, /<p>第一行第二行<\/p>/);
});

test("TST022-AC-004/005: intraword underscores and spaced asterisks stay literal text", () => {
  const bytes = bytesOf(
    "Blocked by REVIEW_SOURCE_MISSING and snake_case_name; 2 * 3 * 4.\n\nThis _is_ emphasis and *so* is this.\n",
  );
  const html = renderAll(bytes);

  assert.match(html, /REVIEW_SOURCE_MISSING/);
  assert.match(html, /snake_case_name/);
  assert.match(html, /2 \* 3 \* 4\./);
  assert.match(html, /<em>is<\/em>/);
  assert.match(html, /<em>so<\/em>/);
});

test("TST022-AC-005: a thematic break renders as <hr> instead of literal dashes", () => {
  const bytes = bytesOf("Before.\n\n---\n\nAfter.\n\n***\n\n___\n");
  const html = renderAll(bytes);

  assert.match(html, /<p>Before\.<\/p>\n<hr>\n<p>After\.<\/p>\n<hr>\n<hr>/);
  assert.doesNotMatch(html, /---/);
  assert.doesNotMatch(html, /\*\*\*/);
});

test("TST022-AC-005: + bullets and 1) ordered markers render as real lists", () => {
  const bytes = bytesOf("+ plus item\n+ another\n\n1) first\n2) second\n");
  const html = renderAll(bytes);

  assert.match(html, /<ul><li>plus item<\/li><li>another<\/li><\/ul>/);
  assert.match(html, /<ol><li>first<\/li><li>second<\/li><\/ol>/);
  assert.doesNotMatch(html, /\+ plus/);
  assert.doesNotMatch(html, /1\) first/);
});

test("TST022-AC-005: two adjacent fences render as two separate <pre> blocks, not one merged block", () => {
  const bytes = bytesOf("```\nfirst\n```\n```\nsecond\n```\n");
  const html = renderAll(bytes);

  assert.match(
    html,
    /<pre><code>first<\/code><\/pre>\n<pre><code>second<\/code><\/pre>/,
  );
  assert.doesNotMatch(html, /```/);
});

test("TST022-AC-005: a single-column table renders as a table, not literal pipes", () => {
  const bytes = bytesOf("| Only |\n| --- |\n| one |\n| two |\n");
  const html = renderAll(bytes);

  assert.match(
    html,
    /<table><thead><tr><th>Only<\/th><\/tr><\/thead><tbody><tr><td>one<\/td><\/tr><tr><td>two<\/td><\/tr><\/tbody><\/table>/,
  );
});

test("TST022-AC-005: a list item followed by a table-divider-like line stays a list, never a table", () => {
  const bytes = bytesOf("- AC-001: head | col\n|---|---|\n");
  const html = renderAll(bytes);

  assert.match(
    html,
    /<ul><li>AC-001: head \| col<\/li><\/ul>\n<p>\|---\|---\|<\/p>/,
  );
  assert.doesNotMatch(html, /<table>/);
});

test("TST022-AC-005: a list inside a block quote renders as a list, not literal markers", () => {
  const bytes = bytesOf("> - first\n> - second\n");
  const html = renderAll(bytes);

  assert.match(
    html,
    /<blockquote><ul><li>first<\/li><li>second<\/li><\/ul><\/blockquote>/,
  );
});

test("TST022-AC-005: a heading nested under a list item renders as a heading, not literal text", () => {
  const bytes = bytesOf("- item\n  ## Nested Heading\n  more text\n");
  const html = renderAll(bytes);

  assert.match(html, /<h2[^>]*>Nested Heading<\/h2>/);
  assert.doesNotMatch(html, /##/);
});

test("TST022-AC-004: nested lists with irregular indentation lose no source line", () => {
  const cases = [
    "- a\n    - b\n  - c LOST_C\n- d",
    "- a\n  - b\n  continuation of a\n- d",
    "- one\n  - two\n    - three\n  - four\n- five",
  ];
  for (const document of cases) {
    const bytes = bytesOf(document);
    const html = renderAll(bytes);
    for (const line of document.split("\n")) {
      const trimmed = line.trim();
      if (trimmed === "") continue;
      const text = trimmed.replace(/^[-*+]\s+/, "");
      assert.ok(
        html.includes(text),
        `expected output to contain ${JSON.stringify(text)} for input ${JSON.stringify(document)}\ngot: ${html}`,
      );
    }
  }
});

test("performance: rendering 4,000 headings from one scanned document stays well under a second", () => {
  const text = "## s\n".repeat(4000);
  const bytes = bytesOf(text);
  const document = scanMarkdownDocument(bytes);

  const start = performance.now();
  for (let index = 0; index < 4000; index += 1) {
    renderMarkdownHtml(document, index * 5, index * 5 + 5);
  }
  const elapsed = performance.now() - start;

  assert.ok(elapsed < 1000, `expected < 1000ms, took ${elapsed}ms`);
});

test("performance: rendering scales roughly linearly, not quadratically, with document size", () => {
  const timeFor = (n) => {
    const text = "## s\n".repeat(n);
    const bytes = bytesOf(text);
    const document = scanMarkdownDocument(bytes);
    const start = performance.now();
    for (let index = 0; index < n; index += 1) {
      renderMarkdownHtml(document, index * 5, index * 5 + 5);
    }
    return performance.now() - start;
  };

  timeFor(500); // warm up
  timeFor(4000); // warm up
  // Small and large runs interleave and compare medians, not single samples,
  // so a scheduling hiccup under `pnpm test`'s concurrent `node --test` run
  // does not land on only one side of the ratio (this file runs alongside
  // every other `*.test.mjs` file in one invocation).
  const smalls = [];
  const larges = [];
  for (let round = 0; round < 5; round += 1) {
    smalls.push(timeFor(1000));
    larges.push(timeFor(8000)); // 8x the lines
  }
  const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  };
  const small = median(smalls);
  const large = median(larges);

  // Quadratic scaling would be ~64x; allow generous headroom above linear,
  // since `small` sits close to the timer's noise floor and a busy machine
  // can add a GC pause to either side of the ratio.
  assert.ok(
    large < small * 30 + 300,
    `expected roughly linear scaling, got small=${small}ms large=${large}ms`,
  );
});

test("performance: a long run of unmatched emphasis openers stays well under a second at 200KB", () => {
  const text = " _a".repeat(70000);
  const bytes = bytesOf(text);
  assert.ok(bytes.length > 190000 && bytes.length < 260000);

  const start = performance.now();
  renderAll(bytes);
  const elapsed = performance.now() - start;

  assert.ok(elapsed < 1000, `expected < 1000ms, took ${elapsed}ms`);
});

test("performance: a long run of unmatched * emphasis openers stays well under a second at 200KB", () => {
  const text = " *a".repeat(70000);
  const bytes = bytesOf(text);

  const start = performance.now();
  renderAll(bytes);
  const elapsed = performance.now() - start;

  assert.ok(elapsed < 1000, `expected < 1000ms, took ${elapsed}ms`);
});

test("performance: a long run of unbalanced link-destination parens stays well under a second at 200KB", () => {
  const text = "[](".repeat(70000);
  const bytes = bytesOf(text);

  const start = performance.now();
  renderAll(bytes);
  const elapsed = performance.now() - start;

  assert.ok(elapsed < 1000, `expected < 1000ms, took ${elapsed}ms`);
});

// A long space run before a `\r` used to backtrack quadratically in both the
// list-marker parser and the shared line trim (`trimDeclarationText`).
test("performance: a list item with an embedded \\r completes quickly, not quadratically", () => {
  const text = "- " + " ".repeat(200_000) + "\r more";
  const bytes = bytesOf(text);

  const start = performance.now();
  renderAll(bytes);
  const elapsed = performance.now() - start;

  assert.ok(elapsed < 500, `expected < 500ms, took ${elapsed}ms`);
});

test("performance: a checkbox item with an embedded \\r completes quickly, not quadratically", () => {
  const text = "- [ ] " + " ".repeat(200_000) + "\r more";
  const bytes = bytesOf(text);

  const start = performance.now();
  renderAll(bytes);
  const elapsed = performance.now() - start;

  assert.ok(elapsed < 500, `expected < 500ms, took ${elapsed}ms`);
});
