/**
 * The Review Projection's confirmation-status header text and 「需複審」
 * source badges (contract §8 修訂，R-006, Story TST-026 R9(d)). Advisory
 * only: it never computes approval, authorization, or completion (`ADR-014`)
 * — only which of the three §8 header states applies, and which source
 * paths get a 「需複審」 marker. Pure: no I/O, no globals, no mutation of
 * its inputs.
 */

import { escapeHtml } from "./html.js";
import type {
  ConfirmationApplicability,
  ConfirmationSourceChange,
} from "./confirmation.js";

const CONFIRMATION_DISCLAIMER =
  "確認是人類聲明，不是授權、核准執行或完成狀態。";

export interface ConfirmationStatusRender {
  /** Empty string when no valid confirmation record exists at all (contract §8 修訂，R-006: the page renders nothing, byte-identical to a page with no confirmation records). */
  readonly headerHtml: string;
  /** Repo-relative paths of every added or changed source, for the per-block 「需複審」 badge; empty unless the stale-with-changes state applies. */
  readonly needsReviewPaths: ReadonlySet<string>;
}

const EMPTY_RENDER: ConfirmationStatusRender = {
  headerHtml: "",
  needsReviewPaths: new Set(),
};

/** A missing source (§4: `sha256: null`) reads 「缺失」 rather than 「內容變動」, even though the CLI still reports it under the same `REVIEW_SOURCE_CHANGED` issue code (review round 1). */
function changeLabel(change: ConfirmationSourceChange): string {
  if (change.missing === true) return "缺失";
  switch (change.kind) {
    case "added":
      return "新增";
    case "removed":
      return "移除";
    case "changed":
      return "內容變動";
  }
}

/**
 * Renders the header-area confirmation status text, one of the three
 * contract §8 states: bound to the current fingerprint, not bound (with the
 * exact changed/added/removed source list and whether the manifest
 * changed), or nothing when no valid confirmation record exists at all —
 * `applicability === undefined` (records/ holds no `confirmation-*.json`
 * file, or the confirmation-file bound was exceeded so no applicability
 * judgement was made) renders exactly like the empty-`latest` case.
 */
export function renderConfirmationStatus(
  applicability: ConfirmationApplicability | undefined,
): ConfirmationStatusRender {
  if (applicability === undefined) return EMPTY_RENDER;
  if (applicability.applies) {
    return {
      headerHtml:
        `<section class="confirmation-status confirmation-status-current">` +
        `<p>有一份確認紀錄綁定目前指紋。</p>` +
        `<p class="confirmation-disclaimer">${escapeHtml(CONFIRMATION_DISCLAIMER)}</p>` +
        `</section>`,
      needsReviewPaths: new Set(),
    };
  }
  if (applicability.latest === undefined) return EMPTY_RENDER;

  const items = applicability.sourceChanges
    .map(
      (change) =>
        `<li>${escapeHtml(changeLabel(change))}：<span class="doc-path">${escapeHtml(change.path)}</span></li>`,
    )
    .join("");
  const manifestItem = applicability.manifestChanged
    ? `<li>manifest 變動</li>`
    : "";
  const needsReviewPaths = new Set(
    applicability.sourceChanges
      .filter((change) => change.kind !== "removed")
      .map((change) => change.path),
  );

  return {
    headerHtml:
      `<section class="confirmation-status confirmation-status-stale">` +
      `<p>沒有確認紀錄綁定目前指紋；下列來源自 ${escapeHtml(applicability.latest.record.confirmedAt)} 的確認後有變動：</p>` +
      `<ul class="confirmation-changes">${items}${manifestItem}</ul>` +
      `<p class="confirmation-disclaimer">${escapeHtml(CONFIRMATION_DISCLAIMER)}</p>` +
      `</section>`,
    needsReviewPaths,
  };
}

/** The 「需複審」 badge markup for one source's path label, or `""` when that source needs no review. */
export function needsReviewBadgeHtml(
  path: string,
  needsReviewPaths: ReadonlySet<string>,
): string {
  return needsReviewPaths.has(path)
    ? ` <span class="review-badge">需複審</span>`
    : "";
}

export const CONFIRMATION_STATUS_CSS = `
.confirmation-status { margin: 1rem 0; padding: .6rem 1.2rem; border-left: 4px solid #8a5a2b; background: #fffaf0; }
.confirmation-status p { margin: .3rem 0; }
.confirmation-disclaimer { color: #6f675c; font: .85rem ui-sans-serif, system-ui, sans-serif; }
.confirmation-changes { padding-left: 1.2rem; }
.review-badge { display: inline-block; font: 600 .72rem ui-sans-serif, system-ui, sans-serif; border: 1px solid #8a251e; color: #8a251e; border-radius: 10px; padding: 0 .5em; margin-left: .3rem; }
`;
