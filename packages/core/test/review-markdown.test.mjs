import assert from "node:assert/strict";
import test from "node:test";
import { TextEncoder } from "node:util";

import { renderMarkdownHtml } from "../dist/index.js";

const encoder = new TextEncoder();

function bytesOf(text) {
  return encoder.encode(text);
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
  const html = renderMarkdownHtml(bytes, 0, bytes.length);

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
  const text = subsetDocument;
  const secondHeadingStart = text.indexOf("## Heading Two");

  const html = renderMarkdownHtml(bytes, secondHeadingStart, bytes.length);

  assert.match(html, /<h2>Heading Two<\/h2>/);
  assert.match(html, /<p>More text here\.<\/p>/);
  assert.doesNotMatch(html, /Heading One/);
  assert.doesNotMatch(html, /nested item/);
});

test("TST022-AC-005: headingLevelOffset shifts every rendered heading, clamped to 6", () => {
  const document = "###### Deepest\n\nBody text.\n";
  const bytes = bytesOf(document);

  const shifted = renderMarkdownHtml(bytes, 0, bytes.length, {
    headingLevelOffset: 3,
  });

  assert.match(shifted, /<h6>Deepest<\/h6>/);
});

test("TST022-AC-005: omitLeadingHeading skips only the heading at exactly start", () => {
  const bytes = bytesOf(subsetDocument);

  const withHeading = renderMarkdownHtml(bytes, 0, bytes.length);
  const withoutHeading = renderMarkdownHtml(bytes, 0, bytes.length, {
    omitLeadingHeading: true,
  });

  assert.match(withHeading, /<h1>Heading One<\/h1>/);
  assert.doesNotMatch(withoutHeading, /<h1>Heading One<\/h1>/);
  // The rest of the document still renders, including the second heading.
  assert.match(withoutHeading, /<h2>Heading Two<\/h2>/);
});

test("TST022-AC-005: headingAttributes and listItemAttributes attach escaped attributes to the right element", () => {
  const document = "# Title\n\n- keep this\n- flag this\n";
  const bytes = bytesOf(document);

  const html = renderMarkdownHtml(bytes, 0, bytes.length, {
    headingAttributes: (heading) =>
      heading.text === "Title" ? { "data-anchor": '"quoted"' } : undefined,
    listItemAttributes: (line) =>
      line.trimmed.includes("flag") ? { "data-flag": "yes" } : undefined,
  });

  assert.match(html, /<h1 data-anchor="&quot;quoted&quot;">Title<\/h1>/);
  assert.match(html, /<li>keep this<\/li>/);
  assert.match(html, /<li data-flag="yes">flag this<\/li>/);
});

test("TST022-AC-009: a source checkbox renders as a non-interactive glyph, never a control", () => {
  const document = "- [ ] pending item\n- [x] done item\n- [X] also done\n";
  const bytes = bytesOf(document);

  const html = renderMarkdownHtml(bytes, 0, bytes.length);

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

  const html = renderMarkdownHtml(bytes, 0, bytes.length);

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

  const html = renderMarkdownHtml(bytes, 0, bytes.length);

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

  const html = renderMarkdownHtml(bytes, 0, bytes.length);

  assert.match(html, /<a href="http:\/\/example\.test">a<\/a>/);
  assert.match(html, /<a href="https:\/\/example\.test">b<\/a>/);
  assert.match(html, /<a href="#fragment">c<\/a>/);
});

test("TST022-AC-005: paragraph lines join with a space for ASCII neighbors and no space for CJK", () => {
  const asciiBytes = bytesOf("line one\nline two\n");
  const cjkBytes = bytesOf("第一行\n第二行\n");

  const asciiHtml = renderMarkdownHtml(asciiBytes, 0, asciiBytes.length);
  const cjkHtml = renderMarkdownHtml(cjkBytes, 0, cjkBytes.length);

  assert.match(asciiHtml, /<p>line one line two<\/p>/);
  assert.match(cjkHtml, /<p>第一行第二行<\/p>/);
});

test("TST022-AC-004/005: intraword underscores and spaced asterisks stay literal text", () => {
  const bytes = new TextEncoder().encode(
    "Blocked by REVIEW_SOURCE_MISSING and snake_case_name; 2 * 3 * 4.\n\nThis _is_ emphasis and *so* is this.\n",
  );
  const html = renderMarkdownHtml(bytes, 0, bytes.length);

  assert.match(html, /REVIEW_SOURCE_MISSING/);
  assert.match(html, /snake_case_name/);
  assert.match(html, /2 \* 3 \* 4\./);
  assert.match(html, /<em>is<\/em>/);
  assert.match(html, /<em>so<\/em>/);
});
