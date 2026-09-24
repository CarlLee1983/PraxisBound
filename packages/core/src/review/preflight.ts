/**
 * Mechanical batch review preflight (contract §9, Story TST-027). Combines
 * the diagnostics `planReviewBatch`/`indexReviewBatch` already produced with
 * the confirmation, unresolved-request, dependency-cycle, record, Story, git,
 * and fingerprint findings the CLI gathers, derives every diagnostic's
 * severity and the run's outcome from one classification table (R6), and
 * orders the result deterministically. The Semantic Report's own
 * diagnostics (Story TST-028, `semantic-report.js`) are placed in
 * `semantic[]`, apart from every other check's `mechanical[]`. This module
 * never touches a filesystem, process, or clock.
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
  /**
   * The Semantic Report's R1 "gate" diagnostics (Story TST-028, H1):
   * `REVIEW_SEMANTIC_MISSING` (absent or unreadable file), the
   * size-before-read `REVIEW_INPUT_TOO_LARGE`, and Core's
   * `semantic-report.js` `gate` output (too-large/invalid/stale) once the
   * file's bytes were read. These are tool verdicts about the report as a
   * whole, so they are placed into `mechanical[]`, same as every other
   * check here — never `semantic[]`.
   */
  readonly semanticGateFindings: readonly PreflightFinding[];
  /**
   * The Semantic Report's R2–R4 diagnostics (Story TST-028): coverage, a
   * duplicate or out-of-batch Story, a non-matching issue locator, and each
   * issue's own blocking/observation diagnostic — computed only once the
   * report passed every gate check (Story Capacity "Failure projection").
   * Placed into `semantic[]`, never `mechanical[]`, though still classified
   * by `CLASS_BY_CODE` and counted toward the outcome (R6).
   */
  readonly semanticFindings: readonly PreflightFinding[];
  /**
   * Every present Readiness Sidecar's own findings (Story TST-030, contract
   * §21): `REVIEW_READINESS_INVALID` (schema/`story_ref`), `_STALE`,
   * `_CRITERIA_MISMATCH`, `_OPERATION_UNGRANTED`, `_REFERENCE_UNKNOWN`, each
   * naming its Story directory as `path`; an over-limit Sidecar's own
   * `REVIEW_INPUT_TOO_LARGE` (kept in its existing INCOMPLETE class, Human
   * Review 2026-09-23: one issue code, one outcome class). Placed into
   * `mechanical[]`, same as every other check here.
   */
  readonly readinessFindings: readonly PreflightFinding[];
}

export interface PreflightEvaluation {
  readonly outcome: PreflightOutcome;
  readonly mechanical: readonly ReviewDiagnostic[];
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
  // Readiness Sidecar rows (contract §21, Story TST-030): all BLOCKED except
  // the shared `REVIEW_INPUT_TOO_LARGE` code, which keeps its single
  // existing INCOMPLETE class (Human Review 2026-09-23, one code = one
  // class).
  REVIEW_READINESS_INVALID: "blocked",
  REVIEW_READINESS_STALE: "blocked",
  REVIEW_READINESS_CRITERIA_MISMATCH: "blocked",
  REVIEW_READINESS_OPERATION_UNGRANTED: "blocked",
  REVIEW_READINESS_REFERENCE_UNKNOWN: "blocked",
  // `review goal-plan`-only (Story TST-031, contract §10 step 1): a Story
  // with no Readiness Sidecar at all. `review preflight` never supplies
  // this code — no Sidecar is not itself a preflight blocker — so adding it
  // here changes no existing command's outcome.
  REVIEW_READINESS_MISSING: "blocked",
  // INCOMPLETE
  REVIEW_CONFIRMATION_MISSING: "incomplete",
  REVIEW_REVISION_UNADDRESSED: "incomplete",
  REVIEW_RESPONSE_MISMATCH: "incomplete",
  REVIEW_RESPONSE_INVALID: "incomplete",
  REVIEW_SEMANTIC_MISSING: "incomplete",
  REVIEW_RECORD_WRITE_FAILED: "incomplete",
  // Same class contract §9 gives it in the Semantic Report row (an
  // over-limit `records/confirmation-*.json` collection never blocks the
  // outcome outright; review round 2, M3).
  REVIEW_INPUT_TOO_LARGE: "incomplete",
  // Semantic Report rows (contract §9, Story TST-028).
  REVIEW_SEMANTIC_INVALID: "incomplete",
  REVIEW_SEMANTIC_COVERAGE: "incomplete",
  REVIEW_SEMANTIC_STALE: "stale",
  REVIEW_SEMANTIC_BLOCKING: "blocked",
  // ADVISORY (不影響結果)
  REVIEW_DEPENDENCY_UNDECLARED: "advisory",
  REVIEW_RECORD_INVALID: "advisory",
  REVIEW_REVISION_STALE_TARGET: "advisory",
  REVIEW_SECTION_UNRECOGNIZED: "advisory",
  REVIEW_SOURCE_ADDED: "advisory",
  REVIEW_SOURCE_REMOVED: "advisory",
  REVIEW_SOURCE_CHANGED: "advisory",
  REVIEW_MANIFEST_CHANGED: "advisory",
  REVIEW_SEMANTIC_OBSERVATION: "advisory",
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

function outcomeFor(
  diagnostics: readonly ReviewDiagnostic[],
): PreflightOutcome {
  const classes = new Set(
    diagnostics.map((diagnostic) => classify(diagnostic.code)),
  );
  if (classes.has("stale")) return "REVIEW_STALE";
  if (classes.has("blocked")) return "REVIEW_BLOCKED";
  if (classes.has("incomplete")) return "REVIEW_INCOMPLETE";
  return "REVIEW_READY";
}

/**
 * Evaluates every contract §9 check in scope for this Story and returns the
 * outcome and the two diagnostic lists, each ordered by result class
 * (`CLASS_ORDER`: STALE, BLOCKED, INCOMPLETE, ADVISORY) and, within a class,
 * by the order each check ran. `mechanical` holds every check but the
 * Semantic Report's own (batch diagnostics, dependency cycles, confirmation,
 * unresolved requests, record findings, Story findings, fingerprint, git
 * findings); `semantic` holds only the Semantic Report's diagnostics
 * (Story TST-028) — kept apart from `mechanical` (R6) though both count
 * toward the outcome, which is derived from the two lists together.
 */
export function evaluatePreflight(input: PreflightInput): PreflightEvaluation {
  const mechanicalRaw: ReviewDiagnostic[] = [
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
    ...input.readinessFindings.map(finalizeFinding),
    ...input.semanticGateFindings.map(finalizeFinding),
  ];
  const semanticRaw: ReviewDiagnostic[] =
    input.semanticFindings.map(finalizeFinding);

  const mechanical = CLASS_ORDER.flatMap((outcomeClass) =>
    mechanicalRaw.filter(
      (diagnostic) => classify(diagnostic.code) === outcomeClass,
    ),
  );
  const semantic = CLASS_ORDER.flatMap((outcomeClass) =>
    semanticRaw.filter(
      (diagnostic) => classify(diagnostic.code) === outcomeClass,
    ),
  );

  return {
    outcome: outcomeFor([...mechanical, ...semantic]),
    mechanical,
    semantic,
  };
}
