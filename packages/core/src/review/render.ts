import { scanHeadingBlocks, scanMarkdownLines } from "./markdown.js";
import type { ReviewDiagnostic, ReviewIndex } from "./types.js";

export interface ReviewProjectionDocument {
  readonly path: string;
  readonly bytes: Uint8Array | undefined;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function isSafeHref(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  for (const character of normalized) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))
      return false;
  }
  return (
    normalized.startsWith("#") ||
    normalized.startsWith("http:") ||
    normalized.startsWith("https:") ||
    normalized.startsWith("mailto:")
  );
}

function renderInline(value: string): string {
  let output = "";
  let cursor = 0;
  while (cursor < value.length) {
    const start = value.indexOf("[", cursor);
    const labelEnd = start === -1 ? -1 : value.indexOf("](", start + 1);
    if (start === -1 || labelEnd === -1) break;
    let end = labelEnd + 2;
    let depth = 1;
    while (end < value.length && depth > 0) {
      if (value[end] === "(") depth += 1;
      if (value[end] === ")") depth -= 1;
      end += 1;
    }
    if (depth !== 0) break;
    output += escapeHtml(value.slice(cursor, start));
    const label = escapeHtml(value.slice(start + 1, labelEnd));
    const href = value.slice(labelEnd + 2, end - 1);
    output += isSafeHref(href)
      ? `<a href="${escapeHtml(href)}">${label}</a>`
      : `<a class="unsafe-link">${label}</a>`;
    cursor = end;
  }
  return `${output}${escapeHtml(value.slice(cursor))}`;
}

function sourceId(index: number): string {
  return `source-${index + 1}`;
}

function locatorId(source: number, locator: number): string {
  return `source-${source + 1}-locator-${locator + 1}`;
}

function tableCells(line: string): string[] {
  const trimmed = line.trim().replace(/^\||\|$/g, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function isTableDivider(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function anchorAttribute(
  line: string,
  anchors: ReadonlyMap<string, string>,
): string {
  const explicit = /\b(?:R|AC)-\d+\b/.exec(line)?.[0];
  const target = anchors.get(explicit ?? line);
  return target === undefined ? "" : ` id="${target}"`;
}

function renderSourceText(
  bytes: Uint8Array,
  anchors: ReadonlyMap<string, string>,
): string {
  const lines = scanMarkdownLines(bytes);
  const rendered: string[] = [];
  let code: string[] = [];

  function flushCode() {
    if (code.length === 0) return;
    rendered.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
    code = [];
  }

  for (let position = 0; position < lines.length; position += 1) {
    const line = lines[position];
    if (line === undefined) continue;
    if (line.fenced) {
      code.push(line.text);
      if (!(lines[position + 1]?.fenced ?? false)) flushCode();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line.text);
    if (heading !== null) {
      const level = Math.min((heading[1] ?? "").length + 1, 6);
      const text = heading[2] ?? "";
      rendered.push(
        `<h${level}${anchorAttribute(text, anchors)}>${renderInline(text)}</h${level}>`,
      );
      continue;
    }
    if (isTableDivider(lines[position + 1]?.text ?? "")) {
      const headers = tableCells(line.text);
      const rows: string[][] = [];
      position += 2;
      while (position < lines.length && lines[position]?.text.includes("|")) {
        rows.push(tableCells(lines[position]?.text ?? ""));
        position += 1;
      }
      position -= 1;
      rendered.push(
        `<div class="table-scroll"><table><thead><tr>${headers.map((cell) => `<th>${renderInline(cell)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`,
      );
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line.text)) {
      rendered.push(
        `<p class="list-line"${anchorAttribute(line.text, anchors)}>${renderInline(line.text)}</p>`,
      );
      continue;
    }
    if (line.text.trim() === "") {
      rendered.push("");
      continue;
    }
    rendered.push(`<p>${renderInline(line.text)}</p>`);
  }
  flushCode();
  return rendered.join("\n");
}

function sectionText(bytes: Uint8Array, heading: string): string | undefined {
  const blocks = scanHeadingBlocks(bytes, scanMarkdownLines(bytes));
  const section = blocks.find(
    (block) => block.level === 2 && block.text === heading,
  );
  if (section === undefined) return undefined;
  return new TextDecoder("utf-8")
    .decode(bytes.subarray(section.startOffset, section.endOffset))
    .split("\n")
    .slice(1)
    .join("\n")
    .trim();
}

function renderStoryFocus(
  bytes: Uint8Array,
  acceptanceBytes: Uint8Array | undefined,
  acceptanceTarget: string,
): string {
  const sections = ["Goal", "Scope", "Rules", "Expected Errors", "Constraints"]
    .map((heading) => ({ heading, text: sectionText(bytes, heading) }))
    .filter(
      (
        section,
      ): section is { readonly heading: string; readonly text: string } =>
        section.text !== undefined,
    );
  if (sections.length === 0 && acceptanceBytes === undefined) return "";
  const acceptance =
    acceptanceBytes === undefined
      ? `<p><a href="#${acceptanceTarget}">Open the acceptance source</a></p>`
      : `<div class="acceptance-focus">${renderSourceText(acceptanceBytes, new Map())}</div>`;
  return `<section class="story-focus"><h3>Story focus</h3>${sections
    .map(
      (section) =>
        `<section><h4>${section.heading}</h4><pre>${escapeHtml(section.text)}</pre></section>`,
    )
    .join("")}<section><h4>Acceptance</h4>${acceptance}</section></section>`;
}

function locatorTargets(
  index: ReviewIndex,
): ReadonlyMap<string, Map<string, string>> {
  const targets = new Map<string, Map<string, string>>();
  const add = (path: string, anchor: string, position: number) => {
    const document = targets.get(path) ?? new Map<string, string>();
    if (!targets.has(path)) targets.set(path, document);
    if (!document.has(anchor))
      document.set(
        anchor,
        locatorId(
          index.sources.findIndex((source) => source.path === path),
          position,
        ),
      );
  };
  for (const spec of index.specs) {
    spec.entries.forEach((entry, position) =>
      add(spec.path, entry.locator.anchor, position),
    );
    spec.sections.forEach((section, position) =>
      add(spec.path, section.locator.anchor, spec.entries.length + position),
    );
  }
  for (const story of index.stories) {
    const storyPath = `${story.path}/story.md`;
    const acceptancePath = `${story.path}/acceptance.md`;
    story.locators.story.forEach((locator, position) =>
      add(storyPath, locator.anchor, position),
    );
    story.locators.acceptance.forEach((locator, position) =>
      add(acceptancePath, locator.anchor, position),
    );
  }
  for (const adr of index.adrs)
    adr.locators.forEach((locator, position) =>
      add(adr.path, locator.anchor, position),
    );
  return targets;
}

function renderDiagnostics(diagnostics: readonly ReviewDiagnostic[]): string {
  if (diagnostics.length === 0)
    return '<p class="muted">No diagnostics were reported for this reading snapshot.</p>';
  return `<ul class="diagnostics">${diagnostics
    .map(
      (diagnostic) =>
        `<li><strong>${escapeHtml(diagnostic.code)}</strong> <span>${escapeHtml(diagnostic.severity)}</span> ${escapeHtml(diagnostic.message)}</li>`,
    )
    .join("")}</ul>`;
}

/**
 * Produces an inert, self-contained reading projection. The caller owns source
 * acquisition and output publication; this function accepts only immutable
 * index data and source text, and performs no I/O.
 */
export function renderReviewProjection(
  index: ReviewIndex,
  documents: readonly ReviewProjectionDocument[],
): string {
  const documentsByPath = new Map(
    documents.map((document) => [document.path, document]),
  );
  const sourcePaths = index.sources.map((source) => source.path);
  const sourceIds = new Map(
    sourcePaths.map((path, position) => [path, sourceId(position)]),
  );
  const anchorsByPath = locatorTargets(index);
  const storyDocuments = new Map(
    index.stories.map((story) => [
      `${story.path}/story.md`,
      `${story.path}/acceptance.md`,
    ]),
  );

  const navigation = sourcePaths
    .map(
      (path, position) =>
        `<li><a href="#${sourceId(position)}">${escapeHtml(path)}</a></li>`,
    )
    .join("");
  const trace = index.trace
    .map((entry) => {
      const specTarget =
        anchorsByPath.get(entry.spec)?.get(entry.anchor) ??
        sourceIds.get(entry.spec) ??
        "contents";
      const stories = entry.stories
        .map((story) => {
          const directory = index.stories.find(
            (item) => item.id === story.storyId,
          )?.path;
          const storyTarget =
            directory === undefined
              ? "contents"
              : (sourceIds.get(`${directory}/story.md`) ?? "contents");
          const acceptancePath = `${directory}/acceptance.md`;
          const acceptanceLinks =
            story.acceptanceIds.length === 0
              ? "no acceptance IDs"
              : story.acceptanceIds
                  .map((acceptanceId) => {
                    const target =
                      directory === undefined
                        ? "contents"
                        : (anchorsByPath
                            .get(acceptancePath)
                            ?.get(acceptanceId) ??
                          sourceIds.get(acceptancePath) ??
                          "contents");
                    return `<a href="#${target}">${escapeHtml(acceptanceId)}</a>`;
                  })
                  .join(", ");
          return `<a href="#${storyTarget}">${escapeHtml(story.storyId)}</a> → ${acceptanceLinks}`;
        })
        .join(", ");
      return `<tr><td><a href="#${specTarget}">${escapeHtml(entry.anchor)}</a></td><td>${stories || "—"}</td></tr>`;
    })
    .join("");
  const documentsHtml = sourcePaths
    .map((path, position) => {
      const document = documentsByPath.get(path);
      const bytes = document?.bytes;
      if (bytes === undefined)
        return `<article id="${sourceId(position)}"><h2>${escapeHtml(path)}</h2><p class="missing">Source was unavailable when this snapshot was produced.</p></article>`;
      const text = new TextDecoder("utf-8").decode(bytes);
      const acceptancePath = storyDocuments.get(path);
      const acceptanceBytes =
        acceptancePath === undefined
          ? undefined
          : documentsByPath.get(acceptancePath)?.bytes;
      const focus =
        acceptancePath === undefined
          ? ""
          : renderStoryFocus(
              bytes,
              acceptanceBytes,
              sourceIds.get(acceptancePath) ?? "contents",
            );
      const digest = index.sources[position]?.sha256 ?? "unavailable";
      return `<article id="${sourceId(position)}"><h2>${escapeHtml(path)}</h2><p class="source-digest">SHA-256: ${escapeHtml(digest ?? "unavailable")}</p>${focus}<section><h3>Reading view</h3><div class="source-view">${renderSourceText(bytes, anchorsByPath.get(path) ?? new Map())}</div></section><section><h3>Full source text</h3><pre class="source-raw">${escapeHtml(text)}</pre></section></article>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'; style-src 'unsafe-inline'">
<title>Review Projection — ${escapeHtml(index.batchId)}</title>
<style>
:root { color-scheme: light; font-family: ui-serif, Georgia, "Noto Serif TC", serif; color: #25231f; background: #f4f1ea; }
* { box-sizing: border-box; }
body { margin: 0; line-height: 1.65; }
a { color: #1d4e5f; text-underline-offset: .18em; }
.unsafe-link { color: inherit; text-decoration: underline dotted; cursor: not-allowed; }
.toolbar { position: fixed; inset: 0 0 auto; z-index: 1; padding: .65rem max(1rem, calc((100vw - 76rem) / 2)); background: #25231f; color: #fff; font-family: ui-sans-serif, system-ui, sans-serif; }
.toolbar a { color: #fff; }
.layout { display: grid; grid-template-columns: minmax(12rem, 18rem) minmax(0, 1fr); gap: 2.5rem; max-width: 76rem; margin: 4rem auto 0; padding: 2rem; }
nav { position: sticky; top: 4.5rem; align-self: start; font-family: ui-sans-serif, system-ui, sans-serif; font-size: .9rem; }
nav ol { padding-left: 1.2rem; }
main { min-width: 0; }
h1, h2, h3, h4 { line-height: 1.2; }
h1 { font-size: clamp(2rem, 5vw, 4.2rem); margin: 0; }
h2 { border-top: 1px solid #c9c1b4; margin-top: 4rem; padding-top: 1.5rem; overflow-wrap: anywhere; }
h3 { margin-top: 1.8rem; }
.eyebrow, .muted, .meta, .diagnostics span { font-family: ui-sans-serif, system-ui, sans-serif; }
.eyebrow { color: #705f49; letter-spacing: .08em; text-transform: uppercase; }
.meta { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: .3rem 1rem; overflow-wrap: anywhere; }
.story-focus { margin: 1.5rem 0; padding: 1.25rem; border-left: .35rem solid #a96f35; background: #fffaf0; }
.story-focus h4 { margin-bottom: .25rem; }
pre, code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
pre { max-width: 100%; overflow: auto; padding: 1rem; background: #ebe7de; white-space: pre-wrap; overflow-wrap: anywhere; }
.source-view { overflow-wrap: anywhere; }
.source-view pre { white-space: pre; overflow-x: auto; }
.list-line { padding-left: 1rem; }
.diagnostics { padding-left: 1.2rem; }
.missing { color: #8a251e; }
.table-scroll { max-width: 100%; overflow-x: auto; }
table { width: 100%; border-collapse: collapse; }
th, td { padding: .6rem; border-bottom: 1px solid #c9c1b4; text-align: left; vertical-align: top; }
@media (max-width: 44rem) { .layout { display: block; padding: 1rem; } nav { position: static; border-bottom: 1px solid #c9c1b4; margin-bottom: 2rem; padding-bottom: 1rem; } .toolbar { position: static; } .layout { margin-top: 0; } }
@page { size: A4; margin: 16mm; }
@media print { :root, body { background: #fff; } .toolbar, nav { display: none; } .layout { display: block; max-width: none; margin: 0; padding: 0; } article { break-inside: avoid; } details { display: block; } details > summary { display: none; } details:not([open]) { display: block; } pre { overflow: visible; white-space: pre-wrap; } a { color: inherit; text-decoration: none; } }
</style>
</head>
<body>
<header class="toolbar"><a href="#contents">Jump to contents</a></header>
<div class="layout">
<nav aria-label="Review navigation"><p class="eyebrow">Review Projection</p><ol>${navigation}</ol></nav>
<main id="contents">
<p class="eyebrow">Offline reading snapshot</p>
<h1>${escapeHtml(index.batchId)}</h1>
<dl class="meta">${index.title === undefined ? "" : `<dt>Batch objective</dt><dd>${escapeHtml(index.title)}</dd>`}<dt>Requirement Fingerprint</dt><dd>${escapeHtml(index.fingerprint)}</dd><dt>Manifest SHA-256</dt><dd>${escapeHtml(index.manifestSha256)}</dd></dl>
<section><h2>Spec → Story → Acceptance</h2><table><thead><tr><th>Requirement</th><th>Stories and acceptance IDs</th></tr></thead><tbody>${trace}</tbody></table></section>
<section><h2>Diagnostics</h2>${renderDiagnostics(index.diagnostics)}</section>
${documentsHtml}
</main>
</div>
</body>
</html>`;
}
