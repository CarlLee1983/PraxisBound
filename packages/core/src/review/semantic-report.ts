/**
 * Semantic Report validation (contract §9, §13, §15; Story TST-028): given
 * the raw bytes of a `--semantic-report` file the CLI already read within
 * the §13 size bound, decides — in R1's order — whether the report is
 * invalid UTF-8, too large (nesting depth, any string, or the total issue
 * count), invalid (not JSON, schema-invalid, or a different `batchId`),
 * stale (a different `fingerprint`), or checked for coverage and turned
 * into `REVIEW_SEMANTIC_COVERAGE`/`REVIEW_SEMANTIC_INVALID` (R2, R4)/
 * `REVIEW_SEMANTIC_BLOCKING`/`REVIEW_SEMANTIC_OBSERVATION` (R3) diagnostics.
 *
 * Every R1 "gate" decision (decode, depth/size/count, schema/batchId,
 * fingerprint) is a single tool verdict returned in `gate`, which the CLI
 * places in `mechanical[]`; only R2–R4's per-Story/per-issue decisions —
 * coverage, a duplicate or out-of-batch Story, an issue whose locator does
 * not match (R4), and each issue's own blocking/observation diagnostic —
 * are returned in `semantic`, computed only when `gate` is empty (Story
 * Capacity "Failure projection": `semantic[]` stays empty unless the report
 * passed schema, batch, and fingerprint checks).
 *
 * Every returned message is raw, untruncated text: `evaluatePreflight`'s own
 * `finalizeMessage` (escaping and the 4096-character bound) is the one place
 * a message is finalized, so this module never escapes or truncates a
 * message itself (double-limiting would drift from that single bound). The
 * `agent` field is never placed into a diagnostic (R5): it is returned
 * separately, as the Agent's own unverified claim. This module never
 * touches a filesystem, process, or clock.
 */

import type { TargetLookup } from "./revision-targets.js";
import { matchRevisionTarget } from "./revision-targets.js";
import {
  MAX_BATCH_ID_LENGTH,
  MAX_NESTING_DEPTH,
  MAX_TEXT_BYTES,
  BATCH_ID_PATTERN,
  SHA256_PATTERN,
  codePointLength,
  isRecord,
  isUtcDateTime,
  rawJsonMaxDepth,
  unknownKey,
  utf8Length,
  validateLocatorShape,
} from "./revision-limits.js";
import type { Locator } from "./types.js";

/** Contract §13: the total number of issues across every Story and category in one report. */
export const MAX_TOTAL_ISSUES = 1000;
const MAX_STORIES = 1000;
const MAX_AGENT_LENGTH = 256;
const STORY_ID_PATTERN = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-[0-9]+$/;
const MAX_STORY_ID_LENGTH = 64;

const CATEGORY_KEYS = [
  "missing-split",
  "contradiction",
  "insufficient-acceptance",
  "open-question",
] as const;
type CategoryKey = (typeof CATEGORY_KEYS)[number];

export type SemanticDiagnosticCode =
  | "REVIEW_INPUT_TOO_LARGE"
  | "REVIEW_SEMANTIC_INVALID"
  | "REVIEW_SEMANTIC_STALE"
  | "REVIEW_SEMANTIC_COVERAGE"
  | "REVIEW_SEMANTIC_BLOCKING"
  | "REVIEW_SEMANTIC_OBSERVATION";

export interface SemanticDiagnostic {
  readonly code: SemanticDiagnosticCode;
  readonly message: string;
  readonly locator?: Locator;
}

export interface SemanticReportContext {
  readonly batchId: string;
  readonly fingerprint: string;
  /** Every Story id the current batch declares. */
  readonly storyIds: readonly string[];
  readonly locatorLookup: TargetLookup;
  /** Every path the batch actually declares as a source (R4, M2): an issue locator naming any other path — including the manifest's own `#batch` path — is `REVIEW_SEMANTIC_INVALID`. */
  readonly sourcePaths: ReadonlySet<string>;
  readonly manifestPath: string;
  readonly batchBlockSha256: string;
}

export interface SemanticReportEvaluation {
  /** 0 or 1 R1 "gate" diagnostics: decode/size/schema/batch/fingerprint. Placed in `mechanical[]` by the caller. */
  readonly gate: readonly SemanticDiagnostic[];
  /** R2–R4 diagnostics, computed only when `gate` is empty. Placed in `semantic[]` by the caller. */
  readonly semantic: readonly SemanticDiagnostic[];
  /** The report's own `agent` field, once read as a valid string — shown only as the Agent's unverified claim (R5), never used as identity. */
  readonly agent: string | undefined;
}

function gateResult(
  code:
    | "REVIEW_INPUT_TOO_LARGE"
    | "REVIEW_SEMANTIC_INVALID"
    | "REVIEW_SEMANTIC_STALE",
  message: string,
  agent: string | undefined = undefined,
): SemanticReportEvaluation {
  return { gate: [{ code, message }], semantic: [], agent };
}

function tooLarge(message: string): SemanticReportEvaluation {
  return gateResult("REVIEW_INPUT_TOO_LARGE", message);
}

function invalid(
  message: string,
  agent: string | undefined = undefined,
): SemanticReportEvaluation {
  return gateResult("REVIEW_SEMANTIC_INVALID", message, agent);
}

function stale(agent: string | undefined): SemanticReportEvaluation {
  return gateResult(
    "REVIEW_SEMANTIC_STALE",
    "Semantic Report fingerprint does not match the current fingerprint",
    agent,
  );
}

interface ParsedIssue {
  readonly locator: Locator;
  readonly observation: string;
  readonly blocking: boolean;
}

interface ParsedCategory {
  readonly issues: readonly ParsedIssue[];
}

interface ParsedStory {
  readonly story: string;
  readonly categories: Readonly<Record<CategoryKey, ParsedCategory>>;
}

interface ParsedReport {
  readonly agent: string;
  readonly stories: readonly ParsedStory[];
}

type ShapeResult =
  | { readonly kind: "invalid"; readonly message: string }
  | { readonly kind: "ok"; readonly report: ParsedReport };

/**
 * A generic, schema-unaware §13 bound pass (H2): every string reachable
 * anywhere in the parsed structure (including an unrecognized field a later
 * schema check would otherwise reject first) must be ≤ 64 KiB, and the
 * total length of every array found under an `"issues"` key, anywhere in
 * the structure, must be ≤ 1000. Runs before any schema/batch/fingerprint
 * decision, so a bound violation is never masked by an unrelated schema
 * error (R1: "over a §13 bound" is checked before "schema-invalid").
 */
function genericBoundProblem(data: unknown): string | undefined {
  let totalIssues = 0;
  function visit(value: unknown): string | undefined {
    if (typeof value === "string") {
      if (utf8Length(value) > MAX_TEXT_BYTES)
        return "Semantic Report has a string exceeding the limit (64 KiB, UTF-8)";
      return undefined;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const problem = visit(item);
        if (problem) return problem;
      }
      return undefined;
    }
    if (isRecord(value)) {
      for (const [key, entryValue] of Object.entries(value)) {
        if (key === "issues" && Array.isArray(entryValue)) {
          totalIssues += entryValue.length;
          if (totalIssues > MAX_TOTAL_ISSUES)
            return "Semantic Report issue count exceeds the limit (1000)";
        }
        const problem = visit(entryValue);
        if (problem) return problem;
      }
      return undefined;
    }
    return undefined;
  }
  return visit(data);
}

/** Field-by-field shape validation against `semantic-report.schema.json`/`defs.schema.json`. Assumes `genericBoundProblem` already passed: every string is within bound and the total issue count is within bound. */
function validateShape(data: unknown, expectedBatchId: string): ShapeResult {
  if (!isRecord(data))
    return {
      kind: "invalid",
      message: "Semantic Report does not match the expected schema",
    };
  const extra = unknownKey(data, [
    "schemaVersion",
    "batchId",
    "fingerprint",
    "agent",
    "observedAt",
    "stories",
  ]);
  if (extra !== undefined)
    return { kind: "invalid", message: "Semantic Report has an unknown field" };
  if (data.schemaVersion !== "1.0.0")
    return {
      kind: "invalid",
      message: "Semantic Report schemaVersion is not supported",
    };
  if (
    typeof data.batchId !== "string" ||
    data.batchId.length > MAX_BATCH_ID_LENGTH ||
    !BATCH_ID_PATTERN.test(data.batchId)
  )
    return {
      kind: "invalid",
      message: "Semantic Report batchId has an invalid form",
    };
  if (data.batchId !== expectedBatchId)
    return {
      kind: "invalid",
      message: "Semantic Report batchId does not match the current batch",
    };
  if (
    typeof data.fingerprint !== "string" ||
    !SHA256_PATTERN.test(data.fingerprint)
  )
    return {
      kind: "invalid",
      message: "Semantic Report fingerprint has an invalid form",
    };
  if (
    typeof data.agent !== "string" ||
    data.agent.length === 0 ||
    codePointLength(data.agent) > MAX_AGENT_LENGTH
  )
    return {
      kind: "invalid",
      message: "Semantic Report agent has an invalid form",
    };
  if (!isUtcDateTime(data.observedAt))
    return {
      kind: "invalid",
      message: "Semantic Report observedAt must be a UTC date-time",
    };
  if (!Array.isArray(data.stories) || data.stories.length === 0)
    return {
      kind: "invalid",
      message: "Semantic Report stories must be a non-empty array",
    };
  // Schema `maxItems` (1000 stories): a pure shape violation, not the §13
  // aggregate issue-count bound `genericBoundProblem` already checked.
  if (data.stories.length > MAX_STORIES)
    return {
      kind: "invalid",
      message: "Semantic Report stories count exceeds the schema limit",
    };

  const stories: ParsedStory[] = [];
  for (const rawStory of data.stories) {
    if (!isRecord(rawStory))
      return {
        kind: "invalid",
        message: "Semantic Report has a Story entry that is not an object",
      };
    const storyExtra = unknownKey(rawStory, ["story", "categories"]);
    if (storyExtra !== undefined)
      return {
        kind: "invalid",
        message: "Semantic Report Story entry has an unknown field",
      };
    if (
      typeof rawStory.story !== "string" ||
      rawStory.story.length === 0 ||
      rawStory.story.length > MAX_STORY_ID_LENGTH ||
      !STORY_ID_PATTERN.test(rawStory.story)
    )
      return {
        kind: "invalid",
        message: "Semantic Report Story id has an invalid form",
      };
    if (!isRecord(rawStory.categories))
      return {
        kind: "invalid",
        message: "Semantic Report Story categories must be an object",
      };
    const categoryExtra = unknownKey(rawStory.categories, [...CATEGORY_KEYS]);
    if (categoryExtra !== undefined)
      return {
        kind: "invalid",
        message: "Semantic Report Story categories has an unknown field",
      };

    const categories: Record<string, ParsedCategory> = {};
    for (const key of CATEGORY_KEYS) {
      const rawCategory = rawStory.categories[key];
      if (!isRecord(rawCategory))
        return {
          kind: "invalid",
          message: "Semantic Report category conclusion must be an object",
        };
      if (rawCategory.result === "none") {
        const conclusionExtra = unknownKey(rawCategory, ["result"]);
        if (conclusionExtra !== undefined)
          return {
            kind: "invalid",
            message: "Semantic Report conclusion has an unknown field",
          };
        categories[key] = { issues: [] };
        continue;
      }
      if (rawCategory.result !== "issues")
        return {
          kind: "invalid",
          message: "Semantic Report conclusion result has an invalid value",
        };
      const conclusionExtra = unknownKey(rawCategory, ["result", "issues"]);
      if (conclusionExtra !== undefined)
        return {
          kind: "invalid",
          message: "Semantic Report conclusion has an unknown field",
        };
      if (!Array.isArray(rawCategory.issues) || rawCategory.issues.length === 0)
        return {
          kind: "invalid",
          message: "Semantic Report issues must be a non-empty array",
        };

      const issues: ParsedIssue[] = [];
      for (const rawIssue of rawCategory.issues) {
        if (!isRecord(rawIssue))
          return {
            kind: "invalid",
            message: "Semantic Report issue entry is not an object",
          };
        const issueExtra = unknownKey(rawIssue, [
          "locator",
          "observation",
          "impact",
          "blocking",
          "suggestion",
        ]);
        if (issueExtra !== undefined)
          return {
            kind: "invalid",
            message: "Semantic Report issue has an unknown field",
          };
        const locatorProblem = validateLocatorShape(rawIssue.locator);
        if (locatorProblem)
          return { kind: "invalid", message: locatorProblem.message };
        if (
          typeof rawIssue.observation !== "string" ||
          rawIssue.observation.length === 0 ||
          !/\S/.test(rawIssue.observation)
        )
          return {
            kind: "invalid",
            message: "Semantic Report issue observation has an invalid form",
          };
        if (
          typeof rawIssue.impact !== "string" ||
          rawIssue.impact.length === 0 ||
          !/\S/.test(rawIssue.impact)
        )
          return {
            kind: "invalid",
            message: "Semantic Report issue impact has an invalid form",
          };
        if (typeof rawIssue.blocking !== "boolean")
          return {
            kind: "invalid",
            message: "Semantic Report issue blocking must be a boolean",
          };
        if (typeof rawIssue.suggestion !== "string")
          return {
            kind: "invalid",
            message: "Semantic Report issue suggestion must be a string",
          };

        issues.push({
          locator: rawIssue.locator as Locator,
          observation: rawIssue.observation,
          blocking: rawIssue.blocking,
        });
      }
      categories[key] = { issues };
    }
    stories.push({
      story: rawStory.story,
      categories: categories as Record<CategoryKey, ParsedCategory>,
    });
  }

  return {
    kind: "ok",
    report: { agent: data.agent, stories },
  };
}

function coverageAndObservationDiagnostics(
  report: ParsedReport,
  context: SemanticReportContext,
): readonly SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];
  const batchStoryIds = new Set(context.storyIds);
  const seen = new Set<string>();

  for (const story of report.stories) {
    if (!batchStoryIds.has(story.story)) {
      diagnostics.push({
        code: "REVIEW_SEMANTIC_INVALID",
        message: `Semantic Report names Story ${story.story}, which is outside the batch`,
      });
      continue;
    }
    if (seen.has(story.story)) {
      diagnostics.push({
        code: "REVIEW_SEMANTIC_INVALID",
        message: `Semantic Report names Story ${story.story} more than once`,
      });
      continue;
    }
    seen.add(story.story);

    for (const key of CATEGORY_KEYS) {
      for (const item of story.categories[key].issues) {
        // R4/M2: the locator's path must name a declared batch source —
        // never the manifest's own `#batch` path or any other non-source
        // path — before it is matched against the index at all.
        if (!context.sourcePaths.has(item.locator.path)) {
          diagnostics.push({
            code: "REVIEW_SEMANTIC_INVALID",
            message: `Semantic Report ${story.story} ${key} issue locator does not name a batch source`,
            locator: item.locator,
          });
          continue;
        }
        const match = matchRevisionTarget(
          context.locatorLookup,
          context.manifestPath,
          context.batchBlockSha256,
          item.locator,
        );
        if (match !== "match") {
          diagnostics.push({
            code: "REVIEW_SEMANTIC_INVALID",
            message: `Semantic Report ${story.story} ${key} issue locator does not match a block in the current index`,
            locator: item.locator,
          });
          continue;
        }
        diagnostics.push({
          code: item.blocking
            ? "REVIEW_SEMANTIC_BLOCKING"
            : "REVIEW_SEMANTIC_OBSERVATION",
          message: `Semantic Report ${story.story} ${key}: ${item.observation}`,
          locator: item.locator,
        });
      }
    }
  }

  for (const storyId of context.storyIds) {
    if (!seen.has(storyId)) {
      diagnostics.push({
        code: "REVIEW_SEMANTIC_COVERAGE",
        message: `Semantic Report is missing Story ${storyId}`,
      });
    }
  }

  return diagnostics;
}

/**
 * Evaluates one already-read Semantic Report's raw bytes against R1–R4 and
 * R6 in order. The caller (the CLI) decides `REVIEW_SEMANTIC_MISSING` and
 * the size-before-read `REVIEW_INPUT_TOO_LARGE` before ever reaching this
 * function; both are also "gate" diagnostics from the caller's point of
 * view (mechanical, Story H1).
 */
export function evaluateSemanticReport(
  bytes: Uint8Array,
  context: SemanticReportContext,
): SemanticReportEvaluation {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return invalid("Semantic Report is not valid UTF-8");
  }

  if (rawJsonMaxDepth(text) > MAX_NESTING_DEPTH)
    return tooLarge("Semantic Report nesting depth exceeds the limit (32)");

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return invalid("Semantic Report is not valid JSON");
  }

  // H2: the generic §13 bound pass runs before any schema/batch decision,
  // so a bound violation is never masked by an unrelated schema error.
  const boundProblem = genericBoundProblem(data);
  if (boundProblem !== undefined) return tooLarge(boundProblem);

  const shape = validateShape(data, context.batchId);
  if (shape.kind === "invalid") return invalid(shape.message);

  const { report } = shape;
  const fingerprint = (data as { fingerprint: string }).fingerprint;
  if (fingerprint !== context.fingerprint) return stale(report.agent);

  return {
    gate: [],
    semantic: coverageAndObservationDiagnostics(report, context),
    agent: report.agent,
  };
}
