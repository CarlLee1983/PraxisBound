/**
 * Contract §5 fixed-vocabulary recognition, shared by the index (`index.ts`)
 * and the projection's per-document partitioning (`render-source.ts`). Kept
 * in its own module so both sides recognize exactly the same headings as the
 * same anchors without importing render-only code into the index or vice
 * versa. Pure: no I/O, no globals.
 */

import type { HeadingBlock } from "./markdown.js";

const adrTitlePattern = /ADR-(\d+)/;

/**
 * Recognizes an ADR's own `ADR-<digits>` title, shared with the projection
 * so both agree on which heading's locator is the ADR's explicit id.
 */
export function adrExplicitId(
  heading: HeadingBlock,
  index: number,
): string | undefined {
  if (index !== 0) return undefined;
  const match = adrTitlePattern.exec(heading.text);
  return match === null ? undefined : `ADR-${match[1]}`;
}

/** Story `story.md` fixed field headings, shared with the projection. */
export const STORY_FIXED_FIELDS: ReadonlySet<string> = new Set([
  "Goal",
  "Context",
  "Classification",
  "Authority",
  "Architecture",
  "Risk",
  "Scope",
  "Inputs",
  "Outputs",
  "Rules",
  "Expected Errors",
  "Dependencies",
  "Constraints",
  "Guidance",
  "Trust Boundary Fields",
  "Security Fixture Matrix",
  "Superseded Behavior",
]);

/** Recognizes a `story.md` fixed field heading, shared with the projection. */
export function storyExplicitId(heading: HeadingBlock): string | undefined {
  return heading.level === 2 && STORY_FIXED_FIELDS.has(heading.text)
    ? heading.text
    : undefined;
}

export type TopLevelVocabKey = "goal" | "nonGoals";
export type EntrySectionVocabKey =
  "goal" | "acceptance" | "nonGoals" | "dependencies";

/** Contract §5 entry-section anchor labels, shared with the projection. */
export const ENTRY_SECTION_LABELS: Record<EntrySectionVocabKey, string> = {
  goal: "Goal",
  acceptance: "Acceptance",
  nonGoals: "Non-goals",
  dependencies: "Dependencies",
};

/**
 * Recognizes a Spec-level (non-entry) `Goal`/`Non-goals` heading (contract
 * §5): Non-goals is checked first, since it can also start with the Chinese
 * for "goal". English comparisons are case-insensitive; nothing else is
 * normalized beyond the heading text's own leading/trailing trim.
 */
export function matchTopLevelVocab(text: string): TopLevelVocabKey | undefined {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  if (
    trimmed.includes("非目標") ||
    trimmed.startsWith("不包含") ||
    lower.startsWith("non-goals") ||
    lower.startsWith("out of scope")
  )
    return "nonGoals";
  if (trimmed.startsWith("目標") || lower.startsWith("goal")) return "goal";
  return undefined;
}

/**
 * Recognizes a third-level heading inside a Spec entry as one of the fixed
 * `R-NNN/*` anchors (contract §5): an exact match on the trimmed heading
 * text, case-insensitive for the English forms only.
 */
export function matchEntrySectionVocab(
  text: string,
): EntrySectionVocabKey | undefined {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  if (trimmed === "目標" || lower === "goal") return "goal";
  if (trimmed === "驗收條件" || lower === "acceptance") return "acceptance";
  if (trimmed === "不包含" || lower === "out of scope") return "nonGoals";
  if (trimmed === "依賴" || lower === "dependencies") return "dependencies";
  return undefined;
}
