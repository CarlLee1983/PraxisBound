/**
 * Mechanical batch review preflight (contract §9, Story TST-027). Combines
 * the diagnostics `planReviewBatch`/`indexReviewBatch` already produced with
 * the confirmation, unresolved-request, dependency-cycle, record, Story, git,
 * and fingerprint findings the CLI gathers, derives every diagnostic's
 * severity and the run's outcome from one classification table (R6), and
 * orders the result deterministically. The Semantic Report is checked only
 * for existence here (`REVIEW_SEMANTIC_MISSING`); TST-028 parses its content.
 * This module never touches a filesystem, process, or clock.
 */

import { escapeHiddenCharacters } from "./path.js";
import type {
  Locator,
  ReviewBatchPlanDependency,
  ReviewDiagnostic,
} from "./types.js";
import { findDependencyCycles } from "./dependency-graph.js";

/** Contract §9 result classes, in outcome-precedence order (R1). */
type PreflightOutcomeClass = "stale" | "blocked" | "incomplete" | "advisory";

export type PreflightOutcome =
  "REVIEW_READY" | "REVIEW_BLOCKED" | "REVIEW_INCOMPLETE" | "REVIEW_STALE";

export interface PreflightFinding {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
  readonly locator?: Locator;
}

export type PreflightConfirmationState =
  | {
      readonly kind: "applies";
      readonly deferredRevisionIds: readonly string[];
    }
  | {
      readonly kind: "stale";
      readonly differences: readonly ReviewDiagnostic[];
    }
  | { readonly kind: "missing" };

export interface PreflightUnresolvedRequests {
  readonly blocking: readonly string[];
  readonly nonBlocking: readonly string[];
}

export interface PreflightInput {
  readonly fingerprint: string;
  /** `plan.diagnostics` concatenated with `index.diagnostics`. */
  readonly batchDiagnostics: readonly ReviewDiagnostic[];
  readonly dependencies: readonly ReviewBatchPlanDependency[];
  readonly confirmation: PreflightConfirmationState;
  readonly unresolved: PreflightUnresolvedRequests;
  /** REVIEW_RECORD_INVALID, REVIEW_RESPONSE_INVALID, REVIEW_RESPONSE_MISMATCH, REVIEW_REVISION_STALE_TARGET, REVIEW_RECORD_WRITE_FAILED. Severity is always re-derived; a supplied severity is ignored. */
  readonly recordFindings: readonly PreflightFinding[];
  /** Per-Story `story check --ready` issues (`STORY_*`), each carrying its Story directory `path`. */
  readonly storyFindings: readonly PreflightFinding[];
  readonly expectFingerprint: string | undefined;
  /** REVIEW_PACKET_REVISION_MISMATCH, REVIEW_NOT_A_GIT_REPOSITORY, REVIEW_SOURCES_UNCOMMITTED. */
  readonly gitFindings: readonly PreflightFinding[];
  readonly semanticReport: "missing" | "present";
}

export interface PreflightEvaluation {
  readonly outcome: PreflightOutcome;
  readonly mechanical: readonly ReviewDiagnostic[];
  /** Always empty in this Story; TST-028 fills it from the parsed Semantic Report. */
  readonly semantic: readonly ReviewDiagnostic[];
}

/**
 * The one table mapping each contract §9 issue code to its result class
 * (R6). `STORY_*` (any `story check --ready` issue code) and unrecognized
 * `REVIEW_*` codes are handled outside this table: see
 * `classify` below.
 */
const CLASS_BY_CODE: Readonly<Record<string, PreflightOutcomeClass>> = {
  // STALE
  REVIEW_PACKET_FINGERPRINT_MISMATCH: "stale",
  REVIEW_PACKET_REVISION_MISMATCH: "stale",
  REVIEW_CONFIRMATION_STALE: "stale",
  // BLOCKED
  REVIEW_SOURCE_MISSING: "blocked",
  REVIEW_NOT_A_GIT_REPOSITORY: "blocked",
  REVIEW_SOURCES_UNCOMMITTED: "blocked",
  REVIEW_DEPENDENCY_CYCLE: "blocked",
  REVIEW_STORY_UNKNOWN: "blocked",
  REVIEW_REQUIREMENT_UNMAPPED: "blocked",
  REVIEW_ACCEPTANCE_MISSING: "blocked",
  REVIEW_ANCHOR_UNKNOWN: "blocked",
  REVIEW_ANCHOR_DUPLICATE: "blocked",
  REVIEW_UNRESOLVED_BLOCKING: "blocked",
  REVIEW_MANIFEST_INVALID: "blocked",
  // INCOMPLETE
  REVIEW_CONFIRMATION_MISSING: "incomplete",
  REVIEW_REVISION_UNADDRESSED: "incomplete",
  REVIEW_RESPONSE_MISMATCH: "incomplete",
  REVIEW_RESPONSE_INVALID: "incomplete",
  REVIEW_SEMANTIC_MISSING: "incomplete",
  REVIEW_RECORD_WRITE_FAILED: "incomplete",
  // ADVISORY (不影響結果)
  REVIEW_DEPENDENCY_UNDECLARED: "advisory",
  REVIEW_RECORD_INVALID: "advisory",
  REVIEW_REVISION_STALE_TARGET: "advisory",
  REVIEW_SECTION_UNRECOGNIZED: "advisory",
  REVIEW_SOURCE_ADDED: "advisory",
  REVIEW_SOURCE_REMOVED: "advisory",
  REVIEW_SOURCE_CHANGED: "advisory",
  REVIEW_MANIFEST_CHANGED: "advisory",
};

/** Outcome-precedence order (R1): STALE > BLOCKED > INCOMPLETE > (READY). */
const CLASS_ORDER: readonly PreflightOutcomeClass[] = [
  "stale",
  "blocked",
  "incomplete",
  "advisory",
];

/**
 * Resolves one issue code's result class. A `STORY_*` code (any `story
 * check --ready` issue) is always BLOCKED regardless of the table, matching
 * R4's "keep its issue codes". An unrecognized `REVIEW_*` code is a
 * programming error — a check was added to a caller without updating this
 * table — and throws rather than silently degrading to advisory.
 */
function classify(code: string): PreflightOutcomeClass {
  const known = CLASS_BY_CODE[code];
  if (known !== undefined) return known;
  if (code.startsWith("STORY_")) return "blocked";
  throw new Error(
    `evaluatePreflight: no contract §9 outcome class is known for issue code "${code}"`,
  );
}

const MAX_MESSAGE_LENGTH = 4096;
const TRUNCATION_MARK = "...";

/**
 * Deterministic §16-safe shortening: escapes hidden/control characters first
 * (so truncation can never re-expose one at the cut point), then, only if
 * still over the defs schema's 4096-character limit, keeps the first
 * `4096 - 3` characters and appends an ASCII ellipsis so the result is
 * exactly 4096 characters. Never throws.
 */
function finalizeMessage(message: string): string {
  const escaped = escapeHiddenCharacters(message);
  if (escaped.length <= MAX_MESSAGE_LENGTH) return escaped;
  return (
    escaped.slice(0, MAX_MESSAGE_LENGTH - TRUNCATION_MARK.length) +
    TRUNCATION_MARK
  );
}

function severityOf(
  outcomeClass: PreflightOutcomeClass,
): ReviewDiagnostic["severity"] {
  return outcomeClass === "advisory" ? "advisory" : "blocking";
}

/** Re-derives `severity` from `code` (R6): a caller-supplied severity is never trusted. */
function finalizeDiagnostic(
  code: string,
  message: string,
  path: string | undefined,
  locator: Locator | undefined,
): ReviewDiagnostic {
  const outcomeClass = classify(code);
  const base: ReviewDiagnostic = {
    code,
    severity: severityOf(outcomeClass),
    message: finalizeMessage(message),
  };
  return {
    ...base,
    ...(path === undefined ? {} : { path }),
    ...(locator === undefined ? {} : { locator }),
  };
}

function finalizeFinding(finding: PreflightFinding): ReviewDiagnostic {
  return finalizeDiagnostic(
    finding.code,
    finding.message,
    finding.path,
    finding.locator,
  );
}

function dependencyCycleDiagnostics(
  dependencies: readonly ReviewBatchPlanDependency[],
): ReviewDiagnostic[] {
  return findDependencyCycles(dependencies).map((members) =>
    finalizeDiagnostic(
      "REVIEW_DEPENDENCY_CYCLE",
      `dependency cycle: ${members.map((member) => escapeHiddenCharacters(member)).join(" -> ")}`,
      undefined,
      undefined,
    ),
  );
}

function confirmationDiagnostics(
  confirmation: PreflightConfirmationState,
): ReviewDiagnostic[] {
  if (confirmation.kind === "applies") return [];
  if (confirmation.kind === "missing")
    return [
      finalizeDiagnostic(
        "REVIEW_CONFIRMATION_MISSING",
        "no confirmation record applies to the current fingerprint",
        undefined,
        undefined,
      ),
    ];
  return [
    finalizeDiagnostic(
      "REVIEW_CONFIRMATION_STALE",
      "the latest valid confirmation was made for a different fingerprint",
      undefined,
      undefined,
    ),
    ...confirmation.differences.map((difference) =>
      finalizeDiagnostic(
        difference.code,
        difference.message,
        difference.path,
        difference.locator,
      ),
    ),
  ];
}

function unresolvedDiagnostics(
  unresolved: PreflightUnresolvedRequests,
  confirmation: PreflightConfirmationState,
): ReviewDiagnostic[] {
  const deferred =
    confirmation.kind === "applies"
      ? new Set(confirmation.deferredRevisionIds)
      : new Set<string>();
  const diagnostics: ReviewDiagnostic[] = [];
  for (const revisionId of unresolved.blocking) {
    diagnostics.push(
      finalizeDiagnostic(
        "REVIEW_UNRESOLVED_BLOCKING",
        `blocking revision ${escapeHiddenCharacters(revisionId)} is unresolved`,
        undefined,
        undefined,
      ),
    );
  }
  for (const revisionId of unresolved.nonBlocking) {
    if (deferred.has(revisionId)) continue;
    diagnostics.push(
      finalizeDiagnostic(
        "REVIEW_REVISION_UNADDRESSED",
        `non-blocking revision ${escapeHiddenCharacters(revisionId)} is neither resolved nor deferred`,
        undefined,
        undefined,
      ),
    );
  }
  return diagnostics;
}

function fingerprintMismatchDiagnostics(
  fingerprint: string,
  expectFingerprint: string | undefined,
): ReviewDiagnostic[] {
  if (expectFingerprint === undefined || expectFingerprint === fingerprint)
    return [];
  return [
    finalizeDiagnostic(
      "REVIEW_PACKET_FINGERPRINT_MISMATCH",
      `expected fingerprint ${escapeHiddenCharacters(expectFingerprint)} does not match the current fingerprint ${escapeHiddenCharacters(fingerprint)}`,
      undefined,
      undefined,
    ),
  ];
}

function semanticReportDiagnostics(
  semanticReport: "missing" | "present",
): ReviewDiagnostic[] {
  if (semanticReport === "present") return [];
  return [
    finalizeDiagnostic(
      "REVIEW_SEMANTIC_MISSING",
      "no Semantic Report was provided",
      undefined,
      undefined,
    ),
  ];
}

function outcomeFor(mechanical: readonly ReviewDiagnostic[]): PreflightOutcome {
  const classes = new Set(
    mechanical.map((diagnostic) => classify(diagnostic.code)),
  );
  if (classes.has("stale")) return "REVIEW_STALE";
  if (classes.has("blocked")) return "REVIEW_BLOCKED";
  if (classes.has("incomplete")) return "REVIEW_INCOMPLETE";
  return "REVIEW_READY";
}

/**
 * Evaluates every mechanical contract §9 check in scope for this Story
 * (R-007 minus TST-028's Semantic Report parsing) and returns the outcome
 * and the full diagnostic list, ordered by result class
 * (`CLASS_ORDER`: STALE, BLOCKED, INCOMPLETE, ADVISORY) and, within a class,
 * by the order each check ran (batch diagnostics, dependency cycles,
 * confirmation, unresolved requests, record findings, Story findings,
 * fingerprint, git findings, Semantic Report). `semantic` is always empty
 * here (TST-028).
 */
export function evaluatePreflight(input: PreflightInput): PreflightEvaluation {
  const raw: ReviewDiagnostic[] = [
    ...input.batchDiagnostics.map((diagnostic) =>
      finalizeDiagnostic(
        diagnostic.code,
        diagnostic.message,
        diagnostic.path,
        diagnostic.locator,
      ),
    ),
    ...dependencyCycleDiagnostics(input.dependencies),
    ...confirmationDiagnostics(input.confirmation),
    ...unresolvedDiagnostics(input.unresolved, input.confirmation),
    ...input.recordFindings.map(finalizeFinding),
    ...input.storyFindings.map(finalizeFinding),
    ...fingerprintMismatchDiagnostics(
      input.fingerprint,
      input.expectFingerprint,
    ),
    ...input.gitFindings.map(finalizeFinding),
    ...semanticReportDiagnostics(input.semanticReport),
  ];

  const mechanical = CLASS_ORDER.flatMap((outcomeClass) =>
    raw.filter((diagnostic) => classify(diagnostic.code) === outcomeClass),
  );

  return { outcome: outcomeFor(mechanical), mechanical, semantic: [] };
}
