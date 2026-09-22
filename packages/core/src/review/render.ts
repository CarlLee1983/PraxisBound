/**
 * The requirement-organized Review Projection page (contract §18) and its
 * embedded annotation layer script (contract §19, Story TST-023 R1).
 *
 * Assembles the page order §18 specifies — title, Review Preface, overview
 * matrix, batch goal/non-goals, ADR constraints, diagnostic summary,
 * collapsed requirement cards, orphan Stories, appendix — from the index and
 * already-read source bytes. All partitioning (which byte range plays which
 * role) lives in `render-source.ts`; this module only assembles the page and
 * its inline CSS. Pure: no I/O, no globals, no mutation of its inputs.
 *
 * `node:crypto` is a pure hashing primitive here too (as in `fingerprint.ts`,
 * Story TST-021 R9/AC-011): it pins the one embedded script with its own
 * `sha256`, never touches the filesystem, process, or clock.
 */

import { createHash } from "node:crypto";

import { ANNOTATION_SCRIPT } from "./annotation-script.js";
import type { ConfirmationApplicability } from "./confirmation.js";
import { renderMarkdownHtml, scanMarkdownDocument } from "./markdown-html.js";
import {
  renderEvidenceSection,
  type ReviewProjectionEvidence,
} from "./render-evidence.js";
import {
  CONFIRMATION_STATUS_CSS,
  needsReviewBadgeHtml,
  renderConfirmationStatus,
} from "./render-confirmation.js";
import {
  buildLocatorLookup,
  elementId,
  locatorHref,
  type LocatorLookup,
} from "./render-locators.js";
import {
  adrSummary,
  escapeHtml,
  firstH1Text,
  MISSING_SECTION_TEXT,
  NO_STORY_TEXT,
  partitionAcceptanceDocument,
  partitionStoryDocument,
  renderAdrAppendix,
  requirementLabelHtml,
  storyTitleWithoutId,
  type AcceptanceContent,
  type AppendixSection,
  type StoryContent,
} from "./render-source.js";
import {
  partitionSpecDocument,
  type SpecDocumentContent,
} from "./render-spec.js";
import type {
  ReviewDiagnostic,
  ReviewIndex,
  SpecEntryIndex,
  SpecIndex,
  StoryIndex,
  TraceEntry,
} from "./types.js";

export interface ReviewProjectionDocument {
  readonly path: string;
  readonly bytes: Uint8Array | undefined;
}

const MISSING_SOURCE_TEXT = "產生本次離線快照時，此來源無法讀取。";

function renderPreface(preface: string): string {
  const bytes = new TextEncoder().encode(preface);
  const document = scanMarkdownDocument(bytes);
  return renderMarkdownHtml(document, 0, bytes.length);
}

interface StoryDocuments {
  readonly title: string | undefined;
  readonly story: StoryContent | undefined;
  readonly acceptance: AcceptanceContent | undefined;
}

interface MatrixEntry {
  /** The requirement's Spec, when the manifest's `spec` names one in the batch. */
  readonly spec: SpecIndex | undefined;
  /** The requirement's Spec entry, when its `anchor` resolves to a recognized, non-duplicate entry. */
  readonly entry: SpecEntryIndex | undefined;
  /** `spec.path` when resolved, else the manifest requirement's own declared path (§18.3). */
  readonly specPath: string;
  /** `entry.id` when resolved, else the manifest requirement's own declared anchor (§18.3). */
  readonly anchor: string;
  /**
   * The manifest `requirements` entry's own `stories`, used only when `entry`
   * did not resolve (no `trace` entry can exist for it either, so the row's
   * Stories come straight from the manifest instead of the trace).
   */
  readonly requirementStories: readonly string[] | undefined;
}

/**
 * Manifest `requirements` order first, then remaining Spec entries in Spec
 * order (R10). A `requirements` entry whose Spec or anchor does not resolve
 * to a recognized entry still gets a row (contract §18.3: one row per
 * manifest `requirements` item), carrying its declared anchor and Stories
 * instead of a resolved entry.
 */
function buildMatrixOrder(index: ReviewIndex): readonly MatrixEntry[] {
  const specsByPath = new Map(index.specs.map((spec) => [spec.path, spec]));
  const entriesByKey = new Map<string, SpecEntryIndex>();
  for (const spec of index.specs)
    for (const entry of spec.entries)
      entriesByKey.set(`${spec.path}#${entry.id}`, entry);
  const seen = new Set<string>();
  const order: MatrixEntry[] = [];

  for (const requirement of index.requirements) {
    const key = `${requirement.spec}#${requirement.anchor}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const spec = specsByPath.get(requirement.spec);
    const entry = entriesByKey.get(key);
    order.push({
      spec,
      entry,
      specPath: requirement.spec,
      anchor: requirement.anchor,
      requirementStories: requirement.stories,
    });
  }
  for (const spec of index.specs) {
    for (const entry of spec.entries) {
      const key = `${spec.path}#${entry.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      order.push({
        spec,
        entry,
        specPath: spec.path,
        anchor: entry.id,
        requirementStories: undefined,
      });
    }
  }
  return order;
}

function missingSourceArticle(path: string): string {
  return `<p class="muted missing">${escapeHtml(path)}：${MISSING_SOURCE_TEXT}</p>`;
}

interface MatrixRenderContext {
  readonly storiesById: ReadonlyMap<string, StoryIndex>;
  readonly specContent: ReadonlyMap<string, SpecDocumentContent | undefined>;
  readonly storyDocuments: ReadonlyMap<string, StoryDocuments>;
}

/**
 * The Stories serving one matrix row/card, in first-occurrence order. A
 * resolved entry's Stories come from the `trace` (built from the same
 * `requirements`); an unresolved requirement (missing/duplicated Spec or
 * entry, contract §18.3) has no trace entry, so its Stories come straight
 * from the manifest's own declared list instead.
 */
function resolveStoryIds(
  entry: SpecEntryIndex | undefined,
  trace: TraceEntry | undefined,
  requirementStories: readonly string[] | undefined,
): readonly string[] {
  if (trace !== undefined)
    return [...new Set(trace.stories.map((story) => story.storyId))];
  if (entry === undefined) return [...new Set(requirementStories ?? [])];
  return [];
}

function renderMatrixRow(
  ctx: MatrixRenderContext,
  matrixEntry: MatrixEntry,
  storyIds: readonly string[],
  targetId: string,
  homeOf: ReadonlyMap<string, string>,
  trace: TraceEntry | undefined,
): string {
  const { storiesById, specContent, storyDocuments } = ctx;
  const { entry, specPath, anchor } = matrixEntry;
  const content = specContent.get(specPath);
  const entryContent = content?.entries.get(anchor);
  const missing = `<p class="muted">${MISSING_SECTION_TEXT}</p>`;
  const label = requirementLabelHtml(anchor, entry?.heading ?? anchor);

  const storyCell =
    storyIds.length === 0
      ? `<span class="muted">${NO_STORY_TEXT}</span>`
      : storyIds
          .map((storyId) => {
            const story = storiesById.get(storyId);
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

  const requirementAcceptanceCount = entry?.acceptance.length ?? 0;
  const executionAcceptanceCount = (trace?.stories ?? []).reduce(
    (sum, story) => sum + story.acceptanceIds.length,
    0,
  );

  return (
    `<tr><th scope="row"><a href="#${targetId}">${label}</a></th>` +
    `<td>${entryContent?.goalCellHtml ?? missing}</td>` +
    `<td>${storyCell}</td>` +
    `<td class="num">${requirementAcceptanceCount}</td>` +
    `<td class="num">${executionAcceptanceCount}</td>` +
    `<td>${entryContent?.nonGoalsCellHtml ?? missing}</td></tr>`
  );
}

/** A visible source-path label plus its 「需複審」 badge, for a card source block (contract §18: "每個來源區塊…標示其來源路徑"; review round 1 H1). */
function docPathLabel(
  path: string,
  needsReviewPaths: ReadonlySet<string>,
): string {
  return ` <span class="doc-path">${escapeHtml(path)}</span>${needsReviewBadgeHtml(path, needsReviewPaths)}`;
}

function renderRequirementCard(
  ctx: MatrixRenderContext,
  matrixEntry: MatrixEntry,
  storyIds: readonly string[],
  targetId: string,
  homeOf: ReadonlyMap<string, string>,
  needsReviewPaths: ReadonlySet<string>,
): string {
  const { storiesById, specContent, storyDocuments } = ctx;
  const { entry, specPath, anchor } = matrixEntry;
  const content = specContent.get(specPath);
  const entryContent = content?.entries.get(anchor);
  const missing = `<p class="muted">${MISSING_SECTION_TEXT}</p>`;
  const label = requirementLabelHtml(anchor, entry?.heading ?? anchor);
  const specPathLabel = docPathLabel(specPath, needsReviewPaths);

  const executionAcceptance =
    storyIds.length === 0
      ? `<p class="muted">${NO_STORY_TEXT}</p>`
      : storyIds
          .map((storyId) => {
            const story = storiesById.get(storyId);
            if (story === undefined) return "";
            const home = homeOf.get(storyId);
            if (home !== targetId)
              return `<p><a href="#${home}">${escapeHtml(storyId)} 執行驗收已在其他卡片顯示</a></p>`;
            const acceptance = storyDocuments.get(story.path)?.acceptance;
            const acceptancePath = `${story.path}/acceptance.md`;
            return `<section><h4>${escapeHtml(storyId)}${docPathLabel(acceptancePath, needsReviewPaths)}</h4>${acceptance?.acceptanceGroupsHtml ?? missing}</section>`;
          })
          .join("");

  const storyFocus =
    storyIds.length === 0
      ? `<p class="muted">${NO_STORY_TEXT}</p>`
      : storyIds
          .map((storyId) => {
            const story = storiesById.get(storyId);
            if (story === undefined) return "";
            const home = homeOf.get(storyId);
            if (home !== targetId)
              return `<p><a href="#${home}">${escapeHtml(storyId)} 已在其他卡片顯示</a></p>`;
            const focus = storyDocuments.get(story.path)?.story;
            const storyPath = `${story.path}/story.md`;
            return `<section><h4>${escapeHtml(storyId)}${docPathLabel(storyPath, needsReviewPaths)}</h4>${focus?.focusHtml ?? missing}</section>`;
          })
          .join("");

  return (
    `<details class="card"><summary>${label}</summary>` +
    `<div class="card-body">` +
    `<section class="req-ac" id="${targetId}"><h3>需求驗收${specPathLabel}</h3>${entryContent?.acceptanceHtml ?? missing}</section>` +
    `<section class="exec-ac"><h3>執行驗收</h3>${executionAcceptance}</section>` +
    `<section class="story-focus"><h3>Story 重點</h3>${storyFocus}</section>` +
    `<section class="detail"><h3>需求細節${specPathLabel}</h3>${entryContent?.detailHtml || `<p class="muted">${MISSING_SECTION_TEXT}</p>`}</section>` +
    `</div></details>`
  );
}

/** Stories no requirement references (contract §18 §7): a Story with no recognized ID is always one of them, titled by its directory path (R11). */
function renderOrphanStories(
  index: ReviewIndex,
  storyDocuments: ReadonlyMap<string, StoryDocuments>,
  referenced: ReadonlySet<string>,
  needsReviewPaths: ReadonlySet<string>,
): string {
  return index.stories
    .filter((story) => story.id === undefined || !referenced.has(story.id))
    .map((story) => {
      const documents = storyDocuments.get(story.path);
      const displayTitle =
        story.id === undefined || documents?.title === undefined
          ? undefined
          : (storyTitleWithoutId(documents.title, story.id) ?? documents.title);
      const heading = escapeHtml(story.id ?? story.path);
      const acceptancePath = `${story.path}/acceptance.md`;
      const storyPath = `${story.path}/story.md`;
      return (
        `<section class="orphan-story"><h3>${heading}${displayTitle === undefined ? "" : ` ${escapeHtml(displayTitle)}`}</h3>` +
        `<section><h4>執行驗收${docPathLabel(acceptancePath, needsReviewPaths)}</h4>${documents?.acceptance?.acceptanceGroupsHtml ?? `<p class="muted">${MISSING_SECTION_TEXT}</p>`}</section>` +
        `<section><h4>Story 重點${docPathLabel(storyPath, needsReviewPaths)}</h4>${documents?.story?.focusHtml ?? `<p class="muted">${MISSING_SECTION_TEXT}</p>`}</section>` +
        `</section>`
      );
    })
    .join("");
}

function renderMatrixAndCards(
  index: ReviewIndex,
  matrixOrder: readonly MatrixEntry[],
  specContent: ReadonlyMap<string, SpecDocumentContent | undefined>,
  storyDocuments: ReadonlyMap<string, StoryDocuments>,
  needsReviewPaths: ReadonlySet<string>,
): {
  readonly matrixRows: string;
  readonly cards: string;
  readonly orphanStories: string;
} {
  const storiesById = new Map<string, StoryIndex>();
  for (const story of index.stories)
    if (story.id !== undefined && !storiesById.has(story.id))
      storiesById.set(story.id, story);
  const ctx: MatrixRenderContext = { storiesById, specContent, storyDocuments };
  const traceByKey = new Map(
    index.trace.map((trace) => [`${trace.spec}#${trace.anchor}`, trace]),
  );
  const homeOf = new Map<string, string>();
  const referenced = new Set<string>();
  const matrixRows: string[] = [];
  const cards: string[] = [];

  for (const matrixEntry of matrixOrder) {
    const { entry, specPath, anchor, requirementStories } = matrixEntry;
    const trace = traceByKey.get(`${specPath}#${anchor}`);
    const storyIds = resolveStoryIds(entry, trace, requirementStories);
    // The card's own navigation target: the first element of its body, not
    // the entry heading buried at the end in 需求細節 (contract §18), so
    // opening a card from the matrix lands above 需求驗收 rather than past it.
    const targetId = `card-${elementId(specPath, anchor)}`;

    for (const storyId of storyIds) {
      referenced.add(storyId);
      if (!homeOf.has(storyId)) homeOf.set(storyId, targetId);
    }

    matrixRows.push(
      renderMatrixRow(ctx, matrixEntry, storyIds, targetId, homeOf, trace),
    );
    cards.push(
      renderRequirementCard(
        ctx,
        matrixEntry,
        storyIds,
        targetId,
        homeOf,
        needsReviewPaths,
      ),
    );
  }

  return {
    matrixRows: matrixRows.join(""),
    cards: cards.join(""),
    orphanStories: renderOrphanStories(
      index,
      storyDocuments,
      referenced,
      needsReviewPaths,
    ),
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
  needsReviewPaths: ReadonlySet<string>,
): string {
  const sourceList = index.sources
    .map(
      (source) =>
        `<li><span class="doc-path">${escapeHtml(source.path)}</span>${needsReviewBadgeHtml(source.path, needsReviewPaths)} — SHA-256: <span class="digest">${escapeHtml(source.sha256 ?? "unavailable")}</span></li>`,
    )
    .join("");

  const adrFullText = index.adrs
    .map((adr) => {
      const document = documents.get(adr.path);
      const body =
        document?.bytes === undefined
          ? missingSourceArticle(adr.path)
          : renderAdrAppendix(adr.path, document.bytes, lookup);
      return `<details class="raw-doc"><summary>${escapeHtml(adr.path)}${needsReviewBadgeHtml(adr.path, needsReviewPaths)}</summary>${body}</details>`;
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
        `<details class="raw-doc"><summary>${escapeHtml(path)}（其餘章節）${needsReviewBadgeHtml(path, needsReviewPaths)}</summary>${blocks.join("\n")}</details>`,
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
 *
 * `manifestPath` is the batch target's `path` (contract §5 rule 3, §19): the
 * page's annotation script needs it, plus `batchId` and `fingerprint`, to
 * build the `#batch` target and the storage key, so it is emitted as a
 * `data-*` attribute on the page root rather than read from any other
 * rendered content.
 */
export function renderReviewProjection(
  index: ReviewIndex,
  documents: readonly ReviewProjectionDocument[],
  manifestPath: string,
  evidence?: ReviewProjectionEvidence,
  /** Contract §8 修訂，R-006: `undefined` when `records/` holds no valid `confirmation-*.json` at all (or the file bound was exceeded), same as `render`'s own `index` never reading `records/` — the header renders nothing and no source gets a 「需複審」 badge. */
  confirmationApplicability?: ConfirmationApplicability,
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
    // A loop, not `push(...sections)`: a document with hundreds of thousands
    // of sections would overflow the call stack as spread arguments.
    for (const section of content.appendixSections) specAppendix.push(section);
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
      acceptanceBytes === undefined
        ? undefined
        : partitionAcceptanceDocument(
            story.id,
            acceptancePath,
            acceptanceBytes,
            lookup,
          );
    if (storyContent !== undefined)
      for (const section of storyContent.appendixSections)
        storyAppendix.push(section);
    if (acceptanceContent !== undefined)
      for (const section of acceptanceContent.appendixSections)
        storyAppendix.push(section);
    storyDocuments.set(story.path, {
      title: storyBytes === undefined ? undefined : firstH1Text(storyBytes),
      story: storyContent,
      acceptance: acceptanceContent,
    });
  }

  const confirmationStatus = renderConfirmationStatus(
    confirmationApplicability,
  );

  const matrixOrder = buildMatrixOrder(index);
  const { matrixRows, cards, orphanStories } = renderMatrixAndCards(
    index,
    matrixOrder,
    specContent,
    storyDocuments,
    confirmationStatus.needsReviewPaths,
  );

  const goalSections = index.specs
    .map((spec) => {
      const content = specContent.get(spec.path);
      const html =
        content?.goalHtml ?? `<p class="muted">${MISSING_SECTION_TEXT}</p>`;
      return `<div class="doc-group"><p class="doc-path">${escapeHtml(spec.path)}${needsReviewBadgeHtml(spec.path, confirmationStatus.needsReviewPaths)}</p>${html}</div>`;
    })
    .join("");
  const nonGoalsSections = index.specs
    .map((spec) => {
      const content = specContent.get(spec.path);
      const html =
        content?.nonGoalsHtml ?? `<p class="muted">${MISSING_SECTION_TEXT}</p>`;
      return `<div class="doc-group"><p class="doc-path">${escapeHtml(spec.path)}${needsReviewBadgeHtml(spec.path, confirmationStatus.needsReviewPaths)}</p>${html}</div>`;
    })
    .join("");

  const adrConstraints = index.adrs
    .map((adr) => {
      const document = documentsByPath.get(adr.path);
      const summary =
        document?.bytes === undefined ? undefined : adrSummary(document.bytes);
      // The title's own locator, through the same id derivation and
      // uniqueness rule the appendix heading uses, so the link always lands
      // on exactly one rendered element.
      const titleLocator = adr.locators[0];
      const href =
        titleLocator === undefined || document?.bytes === undefined
          ? undefined
          : locatorHref(lookup, titleLocator);
      const label =
        summary === undefined
          ? escapeHtml(adr.path)
          : escapeHtml(summary.title);
      const status =
        summary === undefined || summary.status === ""
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
      : `<section class="preface"><h2>審閱導言</h2><p class="label">由批次作者撰寫（Review Preface）</p>${renderPreface(index.preface)}</section>`;

  const evidenceSection = renderEvidenceSection(
    evidence,
    index,
    manifestPath,
    lookup,
  );

  const appendixHtml = renderAppendix(
    index,
    documentsByPath,
    specAppendix,
    storyAppendix,
    advisoryDetailHtml,
    lookup,
    confirmationStatus.needsReviewPaths,
  );

  const title = index.title ?? index.batchId;

  // The one embedded script's exact bytes are pinned by their own sha256
  // (contract §19 R1); every other script source stays forbidden.
  const scriptHash = createHash("sha256")
    .update(ANNOTATION_SCRIPT, "utf8")
    .digest("base64");

  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${scriptHash}'; img-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'; style-src 'unsafe-inline'">
<title>${escapeHtml(title)} — Review Projection</title>
<style>
${PAGE_CSS}${confirmationStatus.headerHtml === "" ? "" : CONFIRMATION_STATUS_CSS}${evidenceSection.css}
</style>
</head>
<body data-pb-batch-id="${escapeHtml(index.batchId)}" data-pb-manifest-path="${escapeHtml(manifestPath)}" data-pb-fingerprint="${escapeHtml(index.fingerprint)}">
<main class="page">
<header class="cover">
<p class="kicker">離線閱讀快照</p>
<h1>${escapeHtml(title)}</h1>
<dl class="meta">
<dt>批次 ID</dt><dd>${escapeHtml(index.batchId)}</dd>
<dt>Requirement Fingerprint</dt><dd class="fingerprint">${escapeHtml(index.fingerprint)}</dd>
</dl>${confirmationStatus.headerHtml}
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
<section class="orphan-stories"><h2>未對應需求的 Story</h2>${orphanStories || `<p class="muted">沒有未對應需求的 Story。</p>`}</section>${evidenceSection.html}
${appendixHtml}
</main>
<script>${ANNOTATION_SCRIPT}</script>
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
code { overflow-wrap: anywhere; }
pre { max-width: 100%; overflow: auto; padding: 1rem; background: #ece6da; white-space: pre-wrap; overflow-wrap: anywhere; }
.table-scroll { position: relative; max-width: 100%; overflow-x: auto; }
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
.adr-list .status { font: 600 .75rem ui-sans-serif, system-ui, sans-serif; color: #6f675c; border: 1px solid #d8d0c3; border-radius: 10px; padding: 0 .5em; }
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
  .pb-annotation { display: none !important; }
  .pb-annotation-selectable, .pb-annotation-target-selected { outline: none !important; }
}

/* 審閱層（contract §19, Story TST-023）：抽屜、行內入口、頁面標記，皆以 .pb-annotation 標記以便列印隱藏。 */
.pb-annotation-toggle { position: fixed; top: 1rem; right: 1rem; z-index: 55; font: 600 .85rem ui-sans-serif, system-ui, sans-serif; padding: .5rem .9rem; border-radius: 999px; border: 1px solid #8a5a2b; background: #fffaf0; color: #5c3a15; cursor: pointer; }
.pb-annotation-drawer { position: fixed; top: 0; right: 0; bottom: 0; width: min(26rem, 100vw); overflow-y: auto; background: #fff; border-left: 1px solid #d8d0c3; box-shadow: -0.4rem 0 1.2rem rgba(0, 0, 0, .12); padding: 1rem; z-index: 50; font: .92rem/1.6 ui-sans-serif, system-ui, sans-serif; padding-top: 3.75rem; padding-bottom: 6rem; }
.pb-annotation-drawer-header { display: flex; flex-wrap: wrap; align-items: center; gap: .6rem; justify-content: space-between; border-bottom: 1px solid #d8d0c3; padding-bottom: .6rem; margin-bottom: .6rem; }
.pb-annotation-toolbar { display: flex; gap: .5rem; align-items: center; flex-wrap: wrap; }
.pb-annotation-section { margin: 1rem 0; }
.pb-annotation-form { display: flex; flex-direction: column; gap: .4rem; margin: .6rem 0; }
.pb-annotation-form textarea { min-height: 4rem; font: inherit; }
.pb-annotation-error:empty { display: none; }
.pb-annotation-error { color: #8a251e; }
.pb-annotation-target-list { list-style: none; padding: 0; margin: .4rem 0; display: flex; flex-direction: column; gap: .3rem; }
.pb-annotation-target-list li { display: flex; justify-content: space-between; align-items: center; gap: .4rem; border: 1px solid #d8d0c3; border-radius: 4px; padding: .2rem .5rem; }
.pb-annotation-card { border: 1px solid #d8d0c3; border-radius: 6px; padding: .6rem .8rem; margin: .6rem 0; }
.pb-annotation-card-head { display: flex; gap: .4rem; flex-wrap: wrap; }
.pb-annotation-badge { font: 600 .72rem ui-sans-serif, system-ui, sans-serif; border: 1px solid #d8d0c3; border-radius: 10px; padding: 0 .5em; color: #6f675c; }
.pb-annotation-badge-blocking { color: #8a251e; border-color: #8a251e; }
.pb-annotation-targets, .pb-annotation-excerpt { font-size: .85rem; color: #4a4640; overflow-wrap: anywhere; }
.pb-annotation-request-text { margin: .3rem 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.pb-annotation-card-actions { display: flex; gap: .5rem; margin-top: .4rem; }
.pb-annotation-inline-add { opacity: 0; margin-left: .4rem; font: 600 .72rem ui-sans-serif, system-ui, sans-serif; border: 1px solid #8a5a2b; background: #fffaf0; color: #5c3a15; border-radius: 999px; padding: 0 .5em; cursor: pointer; }
:hover > .pb-annotation-inline-add, :focus-within > .pb-annotation-inline-add, .pb-annotation-inline-add:focus { opacity: 1; }
.pb-annotation-selectable { outline: 1px dashed #8a5a2b; outline-offset: 2px; cursor: pointer; }
.pb-annotation-target-selected { outline: 2px solid #1e4e6e; outline-offset: 2px; }
.pb-annotation-marker { display: inline-block; margin-left: .4rem; font: 600 .7rem ui-sans-serif, system-ui, sans-serif; border: 1px solid #1e4e6e; color: #1e4e6e; border-radius: 999px; padding: 0 .5em; background: #eef4f8; cursor: pointer; overflow-wrap: anywhere; }
.pb-annotation-notice { position: fixed; bottom: 0; left: 0; right: 0; z-index: 60; background: #8a251e; color: #fff; text-align: center; padding: .5rem 1rem; font: 600 .85rem ui-sans-serif, system-ui, sans-serif; }
.pb-annotation-export-text, .pb-annotation-restore-text { display: block; width: 100%; min-height: 8rem; font: .8rem ui-monospace, Menlo, monospace; }
.pb-annotation-muted { color: #6f675c; }
@media (max-width: 24.375em) {
  .pb-annotation-drawer { width: 100vw; }
}
@media (hover: none), (max-width: 24.375em) {
  .pb-annotation-inline-add { opacity: 1; }
}
`;
