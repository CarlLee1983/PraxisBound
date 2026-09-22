/**
 * The "修訂紀錄證據" (revision-record evidence) area of the Review
 * Projection (contract §20, 修訂，R-005). Displays valid, already-imported
 * Revision Request records and Agent Revision Response records as
 * text-only, fingerprint-bound historical Evidence: it computes no
 * approval, completion, current-work, or authorization state (ADR-014), and
 * shows no diff — only the render-time §5 locator judgement of each target.
 *
 * Pure: no I/O, no globals, no mutation of its inputs. The caller (the CLI)
 * owns reading, validating, and cross-record-conflict-filtering `records/`
 * (including excluding any revision id whose content disagrees across
 * files, contract §6 security M2); this module only assembles HTML from
 * already-validated, already-filtered data.
 */

import { sha256Hex } from "./fingerprint.js";
import { isHiddenOrReorderingCodePoint } from "./path.js";
import { locatorHref, type LocatorLookup } from "./render-locators.js";
import type {
  RevisionLocatorValue,
  RevisionRecord,
} from "./revision-content.js";
import type { RevisionSheetData } from "./revision-sheet.js";
import {
  buildTargetLookup,
  matchRevisionTarget,
  type TargetLookup,
} from "./revision-targets.js";
import type {
  ResponseRecord,
  RevisionResponsesData,
} from "./revision-responses.js";
import type { ReviewIndex } from "./types.js";

export interface RevisionEvidenceRecord {
  readonly path: string;
  readonly sha256: string;
  readonly sheet: RevisionSheetData;
}

export interface ResponseEvidenceRecord {
  readonly path: string;
  readonly data: RevisionResponsesData;
}

export interface ReviewEvidenceOverLimit {
  /** Set when the 200-record-file bound (§13) was exceeded, counted by name before any content was read. */
  readonly recordFileCount?: number;
  /** Set when the 16 MiB total-size bound (§13) was exceeded, summed from filesystem-reported sizes before any content was read. */
  readonly totalBytes?: number;
  /** Set when the 10000-entry bound (§13) was exceeded, counted after all valid records were read. */
  readonly entryCount?: number;
}

export interface ReviewProjectionEvidence {
  readonly revisionRecords: readonly RevisionEvidenceRecord[];
  readonly responseRecords: readonly ResponseEvidenceRecord[];
  /** Repo-relative paths of records excluded as `REVIEW_RECORD_INVALID` (§2, §20); empty when `overLimit` is set. */
  readonly invalidRecordPaths: readonly string[];
  readonly overLimit?: ReviewEvidenceOverLimit;
}

/**
 * Escapes one code point for an HTML text node, one pass over the string
 * (no chained per-character `replaceAll`): the five HTML metacharacters
 * become entities, and every code point that can hide or reorder rendered
 * text (the same set `isHiddenOrReorderingCodePoint` names) becomes a
 * visible hex escape.
 */
function appendEscaped(
  out: string,
  character: string,
  codePoint: number,
): string {
  switch (character) {
    case "&":
      return out + "&amp;";
    case "<":
      return out + "&lt;";
    case ">":
      return out + "&gt;";
    case '"':
      return out + "&quot;";
    case "'":
      return out + "&#39;";
  }
  if (isHiddenOrReorderingCodePoint(codePoint)) {
    const width = codePoint > 0xff ? 4 : 2;
    return out + `\\x${codePoint.toString(16).padStart(width, "0")}`;
  }
  return out + character;
}

/**
 * Text-node-only rendering for a record's identifying fields — path, id,
 * anchor, diagnostic text — where every character, including `\n`, is
 * visibly escaped: these are one-line labels, never multi-line prose.
 */
export function escapeEvidenceField(value: string): string {
  let out = "";
  for (const character of value)
    out = appendEscaped(out, character, character.codePointAt(0) ?? 0);
  return out;
}

/**
 * Text-node-only rendering for record prose (`quote`, `proposal`,
 * `rationale`, `question`): every hiding/reordering code point is still
 * visibly escaped, except `\n`, which stays a literal newline so the text
 * renders as the multi-line prose it is. The element it is placed in must
 * set `white-space: pre-wrap` (contract §20: no diff markup, no `<br>` — a
 * literal newline in a text node is exactly as inert as any other
 * character, never markup).
 */
export function escapeEvidenceProse(value: string): string {
  let out = "";
  for (const character of value) {
    if (character === "\n") {
      out += "\n";
      continue;
    }
    out = appendEscaped(out, character, character.codePointAt(0) ?? 0);
  }
  return out;
}

/** A safe HTML `id`, derived from a hash rather than the raw revision id text (defense in depth, matching `render-locators.ts`'s `elementId`). */
function revisionElementId(revisionId: string): string {
  return `evidence-rev-${sha256Hex(new TextEncoder().encode(revisionId)).slice(0, 16)}`;
}

function renderTargetItem(
  target: RevisionLocatorValue,
  targetLookup: TargetLookup,
  locatorLookup: LocatorLookup,
  manifestPath: string,
  batchBlockSha256: string,
): string {
  const match = matchRevisionTarget(
    targetLookup,
    manifestPath,
    batchBlockSha256,
    target,
  );
  const identity = `${escapeEvidenceField(target.path)} ${escapeEvidenceField(target.anchor)}`;
  const href =
    match === "match"
      ? locatorHref(locatorLookup, {
          path: target.path,
          anchor: target.anchor,
          blockSha256: target.blockSha256,
        })
      : undefined;
  const label =
    href === undefined
      ? `<span class="evidence-judgement">${match}</span>`
      : `<a class="evidence-judgement" href="${href}">${match}</a>`;
  return `<li><span class="doc-path">${identity}</span> ${label}</li>`;
}

/**
 * Every valid imported revision's id superseded by another valid imported
 * revision, across all valid revision records (contract §6, §20): computed
 * from the full set, never from one record alone.
 */
function computeSupersededBy(
  revisionRecords: readonly RevisionEvidenceRecord[],
): ReadonlyMap<string, string> {
  const supersededBy = new Map<string, string>();
  for (const record of revisionRecords)
    for (const revision of record.sheet.revisions)
      if (
        typeof revision.supersedes === "string" &&
        !supersededBy.has(revision.supersedes)
      )
        supersededBy.set(revision.supersedes, revision.id);
  return supersededBy;
}

function fingerprintLabel(
  proposedFingerprint: string,
  currentFingerprint: string,
): string {
  return proposedFingerprint === currentFingerprint
    ? "提出時指紋與當前相同"
    : "提出時指紋與當前不同（歷史）";
}

interface RevisionRenderContext {
  readonly currentFingerprint: string;
  readonly supersededBy: ReadonlyMap<string, string>;
  readonly targetLookup: TargetLookup;
  readonly locatorLookup: LocatorLookup;
  readonly manifestPath: string;
  readonly batchBlockSha256: string;
  /** Ids already given an element id, mutated as revisions render — only the first occurrence of a given id gets one (§20 does not forbid a valid dedupe from appearing twice, but two elements must never share one HTML id). */
  readonly renderedRevisionIds: Set<string>;
}

function renderRevisionEntry(
  revision: RevisionRecord,
  ctx: RevisionRenderContext,
): string {
  const supersedingId = ctx.supersededBy.get(revision.id);
  const badges =
    `<span class="evidence-badge">${escapeEvidenceField(revision.kind)}</span>` +
    (revision.blocking
      ? `<span class="evidence-badge evidence-badge-blocking">阻擋</span>`
      : "") +
    (supersedingId === undefined
      ? ""
      : `<span class="evidence-badge">已被 ${escapeEvidenceField(supersedingId)} 取代（歷史）</span>`) +
    `<span class="evidence-badge">${fingerprintLabel(revision.fingerprint, ctx.currentFingerprint)}</span>`;

  const targetsHtml = revision.targets
    .map((target) =>
      renderTargetItem(
        target,
        ctx.targetLookup,
        ctx.locatorLookup,
        ctx.manifestPath,
        ctx.batchBlockSha256,
      ),
    )
    .join("");

  const supersedesLine =
    revision.supersedes === undefined
      ? ""
      : `<p class="evidence-meta">取代：${escapeEvidenceField(revision.supersedes)}</p>`;

  const isFirstOccurrence = !ctx.renderedRevisionIds.has(revision.id);
  if (isFirstOccurrence) ctx.renderedRevisionIds.add(revision.id);
  const idAttribute = isFirstOccurrence
    ? ` id="${revisionElementId(revision.id)}"`
    : "";

  return (
    `<article class="evidence-entry"${idAttribute}>` +
    `<header class="evidence-entry-head"><span class="evidence-id">${escapeEvidenceField(revision.id)}</span>${badges}</header>` +
    `<p class="evidence-meta">建立於 ${escapeEvidenceField(revision.createdAt)}</p>` +
    supersedesLine +
    `<p class="evidence-prose">${escapeEvidenceProse(revision.quote)}</p>` +
    `<p class="evidence-prose"><strong>建議：</strong>${escapeEvidenceProse(revision.proposal)}</p>` +
    `<p class="evidence-prose"><strong>理由：</strong>${escapeEvidenceProse(revision.rationale)}</p>` +
    `<ul class="evidence-targets">${targetsHtml}</ul>` +
    `</article>`
  );
}

function renderRevisionRecord(
  record: RevisionEvidenceRecord,
  ctx: RevisionRenderContext,
): string {
  const entries = record.sheet.revisions
    .map((revision) => renderRevisionEntry(revision, ctx))
    .join("");
  return (
    `<section class="evidence-record">` +
    `<header class="evidence-record-head">` +
    `<span class="doc-path">${escapeEvidenceField(record.path)}</span>` +
    ` <span class="digest">SHA-256: ${escapeEvidenceField(record.sha256)}</span>` +
    ` <span class="evidence-meta">修訂單指紋：${escapeEvidenceField(record.sheet.fingerprint)}</span>` +
    `</header>${entries}</section>`
  );
}

function toFingerprintLabel(
  toFingerprint: string,
  currentFingerprint: string,
): string {
  return toFingerprint === currentFingerprint
    ? "回應綁定當前指紋"
    : "回應綁定舊指紋（歷史）";
}

function renderResponseEntry(
  response: ResponseRecord,
  ctx: RevisionRenderContext,
): string {
  const targetsHtml = response.locators
    .map((locator) =>
      renderTargetItem(
        locator,
        ctx.targetLookup,
        ctx.locatorLookup,
        ctx.manifestPath,
        ctx.batchBlockSha256,
      ),
    )
    .join("");
  const questionLine =
    response.question === undefined
      ? ""
      : `<p class="evidence-prose"><strong>問題：</strong>${escapeEvidenceProse(response.question)}</p>`;
  const blockingSuggestionBadge =
    response.blockingSuggestion === true
      ? `<span class="evidence-badge evidence-badge-blocking">建議阻擋</span>`
      : "";

  // §20: "回應 id 連到同頁該則意見的位置（存在時）" — only when that
  // revision id was actually rendered (not excluded for being invalid,
  // cross-record-conflicting, or over the aggregate cap).
  const revisionIdRendered = ctx.renderedRevisionIds.has(response.revisionId);
  const revisionIdLabel = revisionIdRendered
    ? `<a class="evidence-id" href="#${revisionElementId(response.revisionId)}">${escapeEvidenceField(response.revisionId)}</a>`
    : `<span class="evidence-id">${escapeEvidenceField(response.revisionId)}</span>`;

  return (
    `<article class="evidence-entry">` +
    `<header class="evidence-entry-head">` +
    revisionIdLabel +
    `<span class="evidence-badge">${escapeEvidenceField(response.route)}</span>` +
    `<span class="evidence-badge">${escapeEvidenceField(response.outcome)}</span>` +
    blockingSuggestionBadge +
    `</header>` +
    `<p class="evidence-prose"><strong>理由：</strong>${escapeEvidenceProse(response.rationale)}</p>` +
    questionLine +
    (targetsHtml === ""
      ? ""
      : `<ul class="evidence-targets">${targetsHtml}</ul>`) +
    `</article>`
  );
}

function renderResponseRecord(
  record: ResponseEvidenceRecord,
  currentFingerprint: string,
  ctx: RevisionRenderContext,
): string {
  const entries = record.data.responses
    .map((response) => renderResponseEntry(response, ctx))
    .join("");
  return (
    `<section class="evidence-record">` +
    `<header class="evidence-record-head">` +
    `<span class="doc-path">${escapeEvidenceField(record.path)}</span>` +
    ` <span class="evidence-meta">fromFingerprint：${escapeEvidenceField(record.data.fromFingerprint)}</span>` +
    ` <span class="evidence-meta">toFingerprint：${escapeEvidenceField(record.data.toFingerprint)}</span>` +
    ` <span class="evidence-badge">${toFingerprintLabel(record.data.toFingerprint, currentFingerprint)}</span>` +
    ` <span class="evidence-meta">修訂單：${record.data.revisionSheets.map(escapeEvidenceField).join("、")}</span>` +
    `</header>${entries}</section>`
  );
}

export interface EvidenceSectionResult {
  readonly html: string;
  /** The `.evidence-*` CSS, or `""` when `html` is also `""` — so the caller never emits evidence styling on a page with no evidence section (contract §18: the page must render byte-identical with no matching record files). */
  readonly css: string;
}

const EMPTY_RESULT: EvidenceSectionResult = { html: "", css: "" };

/**
 * Renders the "修訂紀錄證據" section, or an empty result when there is
 * nothing to render (`evidence` is `undefined`, i.e. no `revisions-*.json`/
 * `responses-*.json` file exists under `records/` — contract §20: the page
 * omits the section entirely and §18 output stays unchanged).
 */
export function renderEvidenceSection(
  evidence: ReviewProjectionEvidence | undefined,
  index: ReviewIndex,
  manifestPath: string,
  locatorLookup: LocatorLookup,
): EvidenceSectionResult {
  if (evidence === undefined) return EMPTY_RESULT;

  const bodyHtml =
    evidence.overLimit !== undefined
      ? renderOverLimitNotice(evidence.overLimit)
      : renderEvidenceBody(evidence, index, manifestPath, locatorLookup);

  const html =
    `<section class="evidence" id="evidence"><h2>修訂紀錄證據</h2>` +
    `<p class="evidence-disclaimer">本區是歷史 Evidence（ADR-014）：不是人類核准，也不代表當前工作、Gate、進度、完成或生命週期狀態。</p>` +
    `<details class="evidence-body"><summary>展開修訂紀錄證據</summary>${bodyHtml}</details>` +
    `</section>`;

  return { html, css: EVIDENCE_CSS };
}

function renderOverLimitNotice(overLimit: ReviewEvidenceOverLimit): string {
  const counts: string[] = [];
  if (overLimit.recordFileCount !== undefined)
    counts.push(`紀錄檔案 ${overLimit.recordFileCount} 份`);
  if (overLimit.totalBytes !== undefined)
    counts.push(`紀錄檔案合計 ${overLimit.totalBytes} bytes`);
  if (overLimit.entryCount !== undefined)
    counts.push(`意見與回應合計 ${overLimit.entryCount} 則`);
  return `<p class="evidence-over-limit missing">修訂紀錄超過投影上限，未呈現任何紀錄（${counts.join("、")}）。</p>`;
}

function renderEvidenceBody(
  evidence: ReviewProjectionEvidence,
  index: ReviewIndex,
  manifestPath: string,
  locatorLookup: LocatorLookup,
): string {
  const targetLookup = buildTargetLookup(index);
  const batchBlockSha256 = sha256Hex(
    new TextEncoder().encode(index.fingerprint),
  );
  const supersededBy = computeSupersededBy(evidence.revisionRecords);
  const ctx: RevisionRenderContext = {
    currentFingerprint: index.fingerprint,
    supersededBy,
    targetLookup,
    locatorLookup,
    manifestPath,
    batchBlockSha256,
    renderedRevisionIds: new Set<string>(),
  };

  // Revisions render fully before any response (contract §20 順序), so
  // every response can link to the final `renderedRevisionIds` set.
  const revisionsHtml = evidence.revisionRecords
    .map((record) => renderRevisionRecord(record, ctx))
    .join("");
  const responsesHtml = evidence.responseRecords
    .map((record) => renderResponseRecord(record, index.fingerprint, ctx))
    .join("");
  const invalidHtml =
    evidence.invalidRecordPaths.length === 0
      ? ""
      : `<section class="evidence-invalid"><h3>未採計的紀錄</h3><ul>${evidence.invalidRecordPaths
          .map(
            (path) =>
              `<li><span class="doc-path">${escapeEvidenceField(path)}</span></li>`,
          )
          .join("")}</ul></section>`;

  return (
    `<section class="evidence-revisions"><h3>修訂單紀錄</h3>${
      revisionsHtml || `<p class="muted">沒有修訂單紀錄。</p>`
    }</section>` +
    `<section class="evidence-responses"><h3>回應紀錄</h3>${
      responsesHtml || `<p class="muted">沒有回應紀錄。</p>`
    }</section>` +
    invalidHtml
  );
}

const EVIDENCE_CSS = `
.evidence-disclaimer { color: #6f675c; font: .85rem ui-sans-serif, system-ui, sans-serif; }
.evidence-body > summary { cursor: pointer; font: 600 .9rem ui-sans-serif, system-ui, sans-serif; color: #6f675c; }
.evidence-record { border: 1px solid #d8d0c3; border-radius: 4px; padding: .6rem .9rem; margin: .8rem 0; background: #fbf9f5; }
.evidence-record-head { display: flex; gap: .5rem; flex-wrap: wrap; align-items: center; }
.evidence-entry { border-top: 1px dashed #d8d0c3; padding-top: .6rem; margin-top: .6rem; }
.evidence-entry-head { display: flex; gap: .4rem; flex-wrap: wrap; align-items: center; }
.evidence-id { font: 600 .85rem ui-monospace, Menlo, monospace; color: #7a4b1f; }
.evidence-badge { font: 600 .72rem ui-sans-serif, system-ui, sans-serif; border: 1px solid #d8d0c3; border-radius: 10px; padding: 0 .5em; color: #6f675c; }
.evidence-badge-blocking { color: #8a251e; border-color: #8a251e; }
.evidence-meta { font-size: .8rem; color: #6f675c; }
.evidence-prose { overflow-wrap: anywhere; white-space: pre-wrap; }
.evidence-targets { padding-left: 1.2rem; font-size: .85rem; }
.evidence-judgement { font: 600 .78rem ui-monospace, Menlo, monospace; }
.evidence-over-limit { font-weight: 600; }
`;
