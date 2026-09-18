/**
 * The requirement-organized Review Projection page (contract §18).
 *
 * Assembles the page order §18 specifies — title, Review Preface, overview
 * matrix, batch goal/non-goals, ADR constraints, diagnostic summary,
 * collapsed requirement cards, orphan Stories, appendix — from the index and
 * already-read source bytes. All partitioning (which byte range plays which
 * role) lives in `render-source.ts`; this module only assembles the page and
 * its inline CSS. Pure: no I/O, no globals, no mutation of its inputs.
 */

import { renderMarkdownHtml } from "./markdown-html.js";
import {
  buildLocatorLookup,
  elementId,
  locatorHref,
  type LocatorLookup,
} from "./render-locators.js";
import {
  adrSummary,
  escapeHtml,
  MISSING_SECTION_TEXT,
  NO_STORY_TEXT,
  partitionAcceptanceDocument,
  partitionSpecDocument,
  partitionStoryDocument,
  renderAdrAppendix,
  requirementLabelHtml,
  storyTitleWithoutId,
  type AcceptanceContent,
  type AppendixSection,
  type SpecDocumentContent,
  type StoryContent,
} from "./render-source.js";
import type {
  ReviewDiagnostic,
  ReviewIndex,
  SpecEntryIndex,
  SpecIndex,
} from "./types.js";

export interface ReviewProjectionDocument {
  readonly path: string;
  readonly bytes: Uint8Array | undefined;
}

const MISSING_SOURCE_TEXT = "產生本次離線快照時，此來源無法讀取。";

function firstH1Text(bytes: Uint8Array): string | undefined {
  const text = new TextDecoder("utf-8").decode(bytes);
  return /^#\s+(.*)$/m.exec(text)?.[1]?.trim();
}

interface StoryDocuments {
  readonly title: string | undefined;
  readonly story: StoryContent | undefined;
  readonly acceptance: AcceptanceContent | undefined;
}

interface MatrixEntry {
  readonly spec: SpecIndex;
  readonly entry: SpecEntryIndex;
}

/** Manifest `requirements` order first, then remaining entries in Spec order (R10). */
function buildMatrixOrder(index: ReviewIndex): readonly MatrixEntry[] {
  const specsByPath = new Map(index.specs.map((spec) => [spec.path, spec]));
  const seen = new Set<string>();
  const order: MatrixEntry[] = [];

  for (const requirement of index.requirements) {
    const spec = specsByPath.get(requirement.spec);
    const entry = spec?.entries.find(
      (candidate) => candidate.id === requirement.anchor,
    );
    if (spec === undefined || entry === undefined) continue;
    const key = `${spec.path}#${entry.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    order.push({ spec, entry });
  }
  for (const spec of index.specs) {
    for (const entry of spec.entries) {
      const key = `${spec.path}#${entry.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      order.push({ spec, entry });
    }
  }
  return order;
}

function missingSourceArticle(path: string): string {
  return `<p class="muted missing">${escapeHtml(path)}：${MISSING_SOURCE_TEXT}</p>`;
}

function renderMatrixAndCards(
  index: ReviewIndex,
  matrixOrder: readonly MatrixEntry[],
  specContent: ReadonlyMap<string, SpecDocumentContent | undefined>,
  storyDocuments: ReadonlyMap<string, StoryDocuments>,
): {
  readonly matrixRows: string;
  readonly cards: string;
  readonly orphanStories: string;
} {
  const traceByKey = new Map(
    index.trace.map((trace) => [`${trace.spec}#${trace.anchor}`, trace]),
  );
  const homeOf = new Map<string, string>();
  const referenced = new Set<string>();
  const matrixRows: string[] = [];
  const cards: string[] = [];

  for (const { spec, entry } of matrixOrder) {
    const key = `${spec.path}#${entry.id}`;
    const trace = traceByKey.get(key);
    const storyIds = trace?.stories.map((story) => story.storyId) ?? [];
    // The card's own navigation target: the first element of its body, not
    // the entry heading buried at the end in 需求細節 (contract §18), so
    // opening a card from the matrix lands above 需求驗收 rather than past it.
    const targetId = `card-${elementId(spec.path, entry.id)}`;
    const content = specContent.get(spec.path);
    const entryContent = content?.entries.get(entry.id);
    const missing = `<p class="muted">${MISSING_SECTION_TEXT}</p>`;

    for (const storyId of storyIds) {
      referenced.add(storyId);
      if (!homeOf.has(storyId)) homeOf.set(storyId, targetId);
    }

    const storyCell =
      storyIds.length === 0
        ? `<span class="muted">${NO_STORY_TEXT}</span>`
        : storyIds
            .map((storyId) => {
              const story = index.stories.find(
                (candidate) => candidate.id === storyId,
              );
              const title =
                story === undefined
                  ? undefined
                  : storyDocuments.get(story.path)?.title;
              const displayTitle =
                title === undefined
                  ? undefined
                  : (storyTitleWithoutId(title, storyId) ?? title);
              const home = homeOf.get(storyId) ?? targetId;
              return `<a href="#${home}">${escapeHtml(storyId)}</a>${displayTitle === undefined ? "" : ` ${escapeHtml(displayTitle)}`}`;
            })
            .join("、");

    const requirementAcceptanceCount = entry.acceptance.length;
    const executionAcceptanceCount = (trace?.stories ?? []).reduce(
      (sum, story) => sum + story.acceptanceIds.length,
      0,
    );

    matrixRows.push(
      `<tr><th scope="row"><a href="#${targetId}">${requirementLabelHtml(entry.id, entry.heading)}</a></th>` +
        `<td>${entryContent?.goalCellHtml ?? missing}</td>` +
        `<td>${storyCell}</td>` +
        `<td class="num">${requirementAcceptanceCount}</td>` +
        `<td class="num">${executionAcceptanceCount}</td>` +
        `<td>${entryContent?.nonGoalsCellHtml ?? missing}</td></tr>`,
    );

    const executionAcceptance =
      storyIds.length === 0
        ? `<p class="muted">${NO_STORY_TEXT}</p>`
        : storyIds
            .map((storyId) => {
              const story = index.stories.find(
                (candidate) => candidate.id === storyId,
              );
              if (story === undefined) return "";
              const home = homeOf.get(storyId);
              if (home !== targetId)
                return `<p><a href="#${home}">${escapeHtml(storyId)} 執行驗收已在其他卡片顯示</a></p>`;
              const acceptance = storyDocuments.get(story.path)?.acceptance;
              return `<section><h4>${escapeHtml(storyId)}</h4>${acceptance?.acceptanceGroupsHtml ?? missing}</section>`;
            })
            .join("");

    const storyFocus = storyIds
      .map((storyId) => {
        const story = index.stories.find(
          (candidate) => candidate.id === storyId,
        );
        if (story === undefined) return "";
        if (homeOf.get(storyId) !== targetId) return "";
        const focus = storyDocuments.get(story.path)?.story;
        return `<section><h4>${escapeHtml(storyId)}</h4>${focus?.focusHtml ?? missing}</section>`;
      })
      .join("");

    cards.push(
      `<details class="card"><summary>${requirementLabelHtml(entry.id, entry.heading)}</summary>` +
        `<div class="card-body">` +
        `<section class="req-ac" id="${targetId}"><h3>需求驗收</h3>${entryContent?.acceptanceHtml ?? missing}</section>` +
        `<section class="exec-ac"><h3>執行驗收</h3>${executionAcceptance}</section>` +
        `<section class="story-focus"><h3>Story 重點</h3>${storyFocus || `<p class="muted">${NO_STORY_TEXT}</p>`}</section>` +
        `<section class="detail"><h3>需求細節</h3>${entryContent?.detailHtml || `<p class="muted">${MISSING_SECTION_TEXT}</p>`}</section>` +
        `</div></details>`,
    );
  }

  const orphanStories = index.stories
    .filter(
      (story): story is typeof story & { readonly id: string } =>
        story.id !== undefined && !referenced.has(story.id),
    )
    .map((story) => {
      const documents = storyDocuments.get(story.path);
      const displayTitle =
        documents?.title === undefined
          ? undefined
          : (storyTitleWithoutId(documents.title, story.id) ?? documents.title);
      return (
        `<section class="orphan-story"><h3>${escapeHtml(story.id)}${displayTitle === undefined ? "" : ` ${escapeHtml(displayTitle)}`}</h3>` +
        `<section><h4>執行驗收</h4>${documents?.acceptance?.acceptanceGroupsHtml ?? `<p class="muted">${MISSING_SECTION_TEXT}</p>`}</section>` +
        `<section><h4>Story 重點</h4>${documents?.story?.focusHtml ?? `<p class="muted">${MISSING_SECTION_TEXT}</p>`}</section>` +
        `</section>`
      );
    })
    .join("");

  return {
    matrixRows: matrixRows.join(""),
    cards: cards.join(""),
    orphanStories,
  };
}

function renderDiagnosticsSummary(diagnostics: readonly ReviewDiagnostic[]): {
  readonly summaryHtml: string;
  readonly advisoryDetailHtml: string;
} {
  const blocking = diagnostics.filter(
    (diagnostic) => diagnostic.severity === "blocking",
  );
  const advisory = diagnostics.filter(
    (diagnostic) => diagnostic.severity === "advisory",
  );
  const item = (diagnostic: ReviewDiagnostic) =>
    `<li><strong>${escapeHtml(diagnostic.code)}</strong> ${escapeHtml(diagnostic.message)}${
      diagnostic.path === undefined
        ? ""
        : ` <span class="doc-path">${escapeHtml(diagnostic.path)}</span>`
    }</li>`;
  const summaryHtml =
    `<p>阻擋 ${blocking.length} 條、提示 ${advisory.length} 條（提示明細見附錄）。</p>` +
    (blocking.length === 0
      ? ""
      : `<ul class="diagnostics">${blocking.map(item).join("")}</ul>`);
  const advisoryDetailHtml =
    advisory.length === 0
      ? `<p class="muted">沒有提示診斷。</p>`
      : `<ul class="diagnostics">${advisory.map(item).join("")}</ul>`;
  return { summaryHtml, advisoryDetailHtml };
}

function renderAppendix(
  index: ReviewIndex,
  documents: ReadonlyMap<string, ReviewProjectionDocument>,
  specAppendix: readonly AppendixSection[],
  storyAppendix: readonly AppendixSection[],
  advisoryDetailHtml: string,
  lookup: LocatorLookup,
): string {
  const sourceList = index.sources
    .map(
      (source) =>
        `<li><span class="doc-path">${escapeHtml(source.path)}</span> — SHA-256: <span class="digest">${escapeHtml(source.sha256 ?? "unavailable")}</span></li>`,
    )
    .join("");

  const adrFullText = index.adrs
    .map((adr) => {
      const document = documents.get(adr.path);
      const body =
        document?.bytes === undefined
          ? missingSourceArticle(adr.path)
          : renderAdrAppendix(adr.path, document.bytes, lookup);
      return `<details class="raw-doc"><summary>${escapeHtml(adr.path)}</summary>${body}</details>`;
    })
    .join("");

  const remainingByPath = new Map<string, string[]>();
  for (const section of [...specAppendix, ...storyAppendix]) {
    const group = remainingByPath.get(section.path) ?? [];
    group.push(section.html);
    remainingByPath.set(section.path, group);
  }
  const remainingSections = [...remainingByPath.entries()]
    .map(
      ([path, blocks]) =>
        `<details class="raw-doc"><summary>${escapeHtml(path)}（其餘章節）</summary>${blocks.join("\n")}</details>`,
    )
    .join("");

  const rawMarkdown = index.sources
    .map((source) => {
      const document = documents.get(source.path);
      if (document?.bytes === undefined) return "";
      const text = new TextDecoder("utf-8").decode(document.bytes);
      return `<h4>${escapeHtml(source.path)}</h4><pre class="raw-source"><code>${escapeHtml(text)}</code></pre>`;
    })
    .join("");

  return (
    `<section class="appendix" id="appendix"><h2>附錄</h2>` +
    `<section><h3>來源清單</h3><ul class="source-list">${sourceList}</ul></section>` +
    `<section><h3>決策約束全文</h3>${adrFullText}</section>` +
    `<section><h3>其餘章節</h3>${remainingSections}</section>` +
    `<details class="raw no-print"><summary>原始 Markdown（不列印）</summary>${rawMarkdown}</details>` +
    `<section><h3>提示診斷明細</h3>${advisoryDetailHtml}</section>` +
    `</section>`
  );
}

/**
 * Produces an inert, self-contained reading projection. The caller owns
 * source acquisition and output publication; this function accepts only
 * immutable index data and source text, and performs no I/O.
 */
export function renderReviewProjection(
  index: ReviewIndex,
  documents: readonly ReviewProjectionDocument[],
): string {
  const documentsByPath = new Map(
    documents.map((document) => [document.path, document]),
  );
  const lookup = buildLocatorLookup(index);

  const specContent = new Map<string, SpecDocumentContent | undefined>();
  const specAppendix: AppendixSection[] = [];
  for (const spec of index.specs) {
    const bytes = documentsByPath.get(spec.path)?.bytes;
    if (bytes === undefined) {
      specContent.set(spec.path, undefined);
      continue;
    }
    const content = partitionSpecDocument(spec, bytes, lookup);
    specContent.set(spec.path, content);
    specAppendix.push(...content.appendixSections);
  }

  const storyDocuments = new Map<string, StoryDocuments>();
  const storyAppendix: AppendixSection[] = [];
  for (const story of index.stories) {
    const storyPath = `${story.path}/story.md`;
    const acceptancePath = `${story.path}/acceptance.md`;
    const storyBytes = documentsByPath.get(storyPath)?.bytes;
    const acceptanceBytes = documentsByPath.get(acceptancePath)?.bytes;
    const storyContent =
      storyBytes === undefined
        ? undefined
        : partitionStoryDocument(storyPath, storyBytes, lookup);
    const acceptanceContent =
      story.id === undefined || acceptanceBytes === undefined
        ? undefined
        : partitionAcceptanceDocument(
            story.id,
            acceptancePath,
            acceptanceBytes,
            lookup,
          );
    if (storyContent !== undefined)
      storyAppendix.push(...storyContent.appendixSections);
    if (acceptanceContent !== undefined)
      storyAppendix.push(...acceptanceContent.appendixSections);
    storyDocuments.set(story.path, {
      title: storyBytes === undefined ? undefined : firstH1Text(storyBytes),
      story: storyContent,
      acceptance: acceptanceContent,
    });
  }

  const matrixOrder = buildMatrixOrder(index);
  const { matrixRows, cards, orphanStories } = renderMatrixAndCards(
    index,
    matrixOrder,
    specContent,
    storyDocuments,
  );

  const goalSections = index.specs
    .map((spec) => {
      const content = specContent.get(spec.path);
      const html =
        content?.goalHtml ?? `<p class="muted">${MISSING_SECTION_TEXT}</p>`;
      return `<div class="doc-group"><p class="doc-path">${escapeHtml(spec.path)}</p>${html}</div>`;
    })
    .join("");
  const nonGoalsSections = index.specs
    .map((spec) => {
      const content = specContent.get(spec.path);
      const html =
        content?.nonGoalsHtml ?? `<p class="muted">${MISSING_SECTION_TEXT}</p>`;
      return `<div class="doc-group"><p class="doc-path">${escapeHtml(spec.path)}</p>${html}</div>`;
    })
    .join("");

  const adrConstraints = index.adrs
    .map((adr) => {
      const document = documentsByPath.get(adr.path);
      const summary =
        document?.bytes === undefined ? undefined : adrSummary(document.bytes);
      const titleAnchor = adr.locators[0]?.anchor;
      const href =
        titleAnchor === undefined
          ? undefined
          : locatorHref(lookup, adr.path, titleAnchor);
      const label =
        summary === undefined
          ? escapeHtml(adr.path)
          : escapeHtml(summary.title);
      const status =
        summary === undefined
          ? MISSING_SECTION_TEXT
          : escapeHtml(summary.status);
      return `<li>${href === undefined ? label : `<a href="${href}">${label}</a>`} <span class="status">${status}</span></li>`;
    })
    .join("");

  const { summaryHtml, advisoryDetailHtml } = renderDiagnosticsSummary(
    index.diagnostics,
  );

  const missingSourcesHtml = index.sources
    .filter((source) => documentsByPath.get(source.path)?.bytes === undefined)
    .map((source) => missingSourceArticle(source.path))
    .join("");

  const prefaceHtml =
    index.preface === undefined
      ? ""
      : `<section class="preface"><h2>審閱導言</h2><p class="label">由批次作者撰寫（Review Preface）</p>${renderMarkdownHtml(
          new TextEncoder().encode(index.preface),
          0,
          new TextEncoder().encode(index.preface).length,
        )}</section>`;

  const appendixHtml = renderAppendix(
    index,
    documentsByPath,
    specAppendix,
    storyAppendix,
    advisoryDetailHtml,
    lookup,
  );

  const title = index.title ?? index.batchId;

  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'; style-src 'unsafe-inline'">
<title>${escapeHtml(title)} — Review Projection</title>
<style>
${PAGE_CSS}
</style>
</head>
<body>
<main class="page">
<header class="cover">
<p class="kicker">離線閱讀快照</p>
<h1>${escapeHtml(title)}</h1>
<dl class="meta">
<dt>批次 ID</dt><dd>${escapeHtml(index.batchId)}</dd>
<dt>Requirement Fingerprint</dt><dd class="fingerprint">${escapeHtml(index.fingerprint)}</dd>
</dl>
${prefaceHtml}
</header>
<section class="matrix"><h2>需求總覽矩陣</h2><div class="table-scroll"><table>
<thead><tr><th scope="col">需求</th><th scope="col">目標</th><th scope="col">Story</th><th scope="col" class="num">需求驗收</th><th scope="col" class="num">執行驗收</th><th scope="col">不包含</th></tr></thead>
<tbody>${matrixRows}</tbody>
</table></div></section>
<section><h2>批次目標</h2>${goalSections}</section>
<section><h2>不包含</h2>${nonGoalsSections}</section>
<section><h2>決策約束</h2><ul class="adr-list">${adrConstraints}</ul></section>
<section><h2>診斷摘要</h2>${summaryHtml}</section>
${missingSourcesHtml}
<section class="cards"><h2>需求卡片</h2>${cards}</section>
<section class="orphan-stories"><h2>未對應需求的 Story</h2>${orphanStories || `<p class="muted">沒有未對應需求的 Story。</p>`}</section>
${appendixHtml}
</main>
</body>
</html>`;
}

const PAGE_CSS = `
:root { color-scheme: light; font-family: ui-serif, Georgia, "Noto Serif TC", serif; color: #24211c; background: #f7f4ee; }
* { box-sizing: border-box; }
body { margin: 0; line-height: 1.7; }
a { color: #1e4e6e; text-underline-offset: .18em; }
a.unsafe-link { color: inherit; text-decoration: underline dotted; cursor: not-allowed; }
.page { max-width: 64rem; margin: 0 auto; padding: 2.5rem 1.25rem; }
h1, h2, h3, h4 { font-family: ui-sans-serif, system-ui, sans-serif; line-height: 1.35; overflow-wrap: anywhere; }
h1 { font-size: clamp(1.7rem, 4.5vw, 2.6rem); margin: .2rem 0 .6rem; }
h2 { margin-top: 3rem; border-top: 1px solid #d8d0c3; padding-top: 1rem; }
h3 { margin-top: 1.4rem; }
.kicker { font: 600 .78rem/1.4 ui-sans-serif, system-ui, sans-serif; letter-spacing: .08em; color: #8a5a2b; margin: 0; }
.muted { color: #6f675c; }
.missing { color: #8a251e; }
.meta { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: .3rem 1rem; font-family: ui-sans-serif, system-ui, sans-serif; overflow-wrap: anywhere; }
.fingerprint { overflow-wrap: anywhere; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.preface { margin-top: 1.5rem; padding: .2rem 1.2rem .8rem; border-left: 4px solid #8a5a2b; background: #fffaf0; }
.preface h2 { border-top: none; margin-top: .2rem; padding-top: 0; }
.preface .label { font: .8rem ui-sans-serif, system-ui, sans-serif; color: #6f675c; margin: 0; }
.visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.doc-path { display: inline-block; font: .72rem/1.4 ui-monospace, Menlo, monospace; color: #6f675c; border: 1px solid #d8d0c3; border-radius: 3px; padding: .05rem .4rem; overflow-wrap: anywhere; }
.digest { overflow-wrap: anywhere; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.doc-group { margin: 1rem 0; }
pre, code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
pre { max-width: 100%; overflow: auto; padding: 1rem; background: #ece6da; white-space: pre-wrap; overflow-wrap: anywhere; }
.table-scroll { max-width: 100%; overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: .92rem; }
th, td { padding: .6rem; border-bottom: 1px solid #d8d0c3; text-align: left; vertical-align: top; }
td.num, th.num { text-align: center; }
th.num { white-space: nowrap; min-width: 6rem; }
.checkbox-glyph { font-size: 1em; }
.ac-id { display: inline-block; font: 600 .8rem ui-monospace, Menlo, monospace; color: #7a4b1f; margin-right: .4rem; }
.diagnostics { padding-left: 1.2rem; }
.card { border: 1px solid #d8d0c3; background: #fff; border-radius: 6px; padding: .8rem 1.2rem; margin: 1.2rem 0; }
.card > summary { cursor: pointer; font: 600 1rem ui-sans-serif, system-ui, sans-serif; }
.req-id { color: #8a5a2b; }
.card-body section { margin-top: 1.2rem; }
.orphan-story { border-top: 1px dashed #d8d0c3; padding-top: 1rem; margin-top: 1.5rem; }
.adr-list { padding-left: 1.2rem; }
.adr-list .status { font: 600 .75rem ui-sans-serif, system-ui, sans-serif; color: #2e6b3a; border: 1px solid #9cc3a4; border-radius: 10px; padding: 0 .5em; }
.raw-doc { border: 1px solid #d8d0c3; border-radius: 4px; padding: .4rem .9rem; margin: .8rem 0; background: #fbf9f5; }
.raw-doc > summary, .raw > summary { cursor: pointer; font: 600 .9rem ui-sans-serif, system-ui, sans-serif; color: #6f675c; }
@media (max-width: 24.375em) { .page { padding: 1rem .75rem; } }
@page { size: A4; margin: 16mm; }
@media print {
  :root, body { background: #fff; }
  .raw { display: none; }
  details::details-content { content-visibility: visible; display: block; }
  details > summary { list-style: none; }
  details > summary::-webkit-details-marker { display: none; }
  a { color: inherit; text-decoration: none; }
}
`;
