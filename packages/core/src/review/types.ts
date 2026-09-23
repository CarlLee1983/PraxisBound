/**
 * Shared shapes for the batch review source index.
 *
 * These types describe the pure data the `review` module exchanges with its
 * caller. The module itself never touches a filesystem, process, or clock;
 * see `manifest.ts` and `index.ts`.
 */

export interface SourceDigest {
  readonly path: string;
  readonly sha256: string | null;
}

export interface Locator {
  readonly path: string;
  readonly anchor: string;
  readonly blockSha256: string;
}

export type ReviewDiagnosticSeverity = "blocking" | "advisory";

export interface ReviewDiagnostic {
  readonly code: string;
  readonly severity: ReviewDiagnosticSeverity;
  readonly message: string;
  readonly path?: string;
  readonly locator?: Locator;
}

export interface ReviewBatchPlanRequirement {
  readonly spec: string;
  readonly anchor: string;
  readonly stories: readonly string[];
}

export interface ReviewBatchPlanDependency {
  readonly story: string;
  readonly dependsOn: readonly string[];
}

export interface ReviewBatchStoryPlan {
  readonly directory: string;
  readonly storyId: string | undefined;
  readonly storyPath: string;
  readonly acceptancePath: string;
  /** `<directory>/readiness.json` (Story TST-030, contract §21): a Readiness Sidecar is optional, so its presence is decided by `indexReviewBatch` from `observations`, never by this pure plan. */
  readonly readinessPath: string;
}

/** The pure, validated plan a manifest declares. */
export interface ReviewBatchPlan {
  readonly batchId: string;
  /** Optional human-readable batch objective from the manifest. */
  readonly title?: string | undefined;
  /** Optional Review Preface (manifest `preface`, schemaVersion 1.1.0 only). */
  readonly preface?: string | undefined;
  readonly manifestSha256: string;
  readonly adrs: readonly string[];
  readonly specs: readonly string[];
  readonly stories: readonly ReviewBatchStoryPlan[];
  readonly requirements: readonly ReviewBatchPlanRequirement[];
  readonly dependencies: readonly ReviewBatchPlanDependency[];
  /** Every declared ADR, Spec, `story.md` and `acceptance.md`, sorted by UTF-8 path bytes. */
  readonly sources: readonly string[];
  /** Diagnostics resolvable from manifest text alone, before any source is read. */
  readonly diagnostics: readonly ReviewDiagnostic[];
  /** Story IDs declared by more than one Story directory; never resolved in the trace. */
  readonly ambiguousStoryIds: readonly string[];
}

export type PlanReviewBatchResult =
  | { readonly ok: true; readonly plan: ReviewBatchPlan }
  | {
      readonly ok: false;
      readonly code: string;
      readonly message: string;
      readonly path?: string;
    };

export type SourceObservation =
  | { readonly kind: "file"; readonly bytes: Uint8Array }
  | { readonly kind: "missing" }
  | { readonly kind: "unsafe" }
  /**
   * The path exists (unlike `missing`, which is ENOENT/never-existed) but
   * its bytes could not be read — permission denied, a directory in a
   * file's place, or a race between the safety check and the read. Contract
   * §4's missing-source handling: a *declared* source in this state already
   * gets `sha256: null` plus `REVIEW_SOURCE_MISSING`, same as `missing`. A
   * Readiness Sidecar (Story TST-030, contract §21) in this state is
   * distinct from *absent*: it must not count as absent (R1), so it still
   * joins `sources` with `sha256: null` and that same diagnostic, and
   * preflight reports `REVIEW_READINESS_INVALID` for it.
   */
  | { readonly kind: "unreadable" }
  /**
   * The path exists and its whole-file digest is already known (streamed
   * without ever loading its bytes into memory), but it exceeds contract
   * §13/§21's 1 MiB Readiness Sidecar bound (Story TST-030 HIGH-1, code
   * review round 2): unlike `unreadable`, this still carries a real
   * `sha256`, so it joins `sources` and the fingerprint exactly like `file`
   * — only its content is never read, parsed, or rendered.
   */
  | { readonly kind: "oversized"; readonly sha256: string };

export type ReviewObservations = ReadonlyMap<string, SourceObservation>;

export interface SpecAcceptanceEntry {
  readonly id: string;
  readonly locator: Locator;
}

/** Fixed, vocabulary-recognized anchors inside one Spec entry (contract §5). */
export interface SpecEntrySections {
  readonly goal?: Locator | undefined;
  readonly acceptance?: Locator | undefined;
  readonly nonGoals?: Locator | undefined;
  readonly dependencies?: Locator | undefined;
}

export interface SpecEntryIndex {
  readonly id: string;
  readonly heading: string;
  readonly locator: Locator;
  readonly acceptance: readonly SpecAcceptanceEntry[];
  readonly sections: SpecEntrySections;
}

export interface SpecSectionIndex {
  readonly headingPath: string;
  readonly locator: Locator;
}

export interface SpecIndex {
  readonly path: string;
  readonly entries: readonly SpecEntryIndex[];
  readonly sections: readonly SpecSectionIndex[];
  /** Fixed `Goal`/`Non-goals` anchors recognized at the Spec's own level (contract §5). */
  readonly goal?: Locator | undefined;
  readonly nonGoals?: Locator | undefined;
}

export interface StoryIndex {
  readonly id: string | undefined;
  readonly path: string;
  readonly acceptanceIds: readonly string[];
  /**
   * `<path>/readiness.json` (Story TST-030): present only when a Readiness
   * Sidecar joins `sources`/the fingerprint (a present-but-unreadable one
   * counts, contract §21 R1; a genuinely absent one does not). Omitted
   * entirely, not merely falsy, when there is none, so a batch with no
   * Sidecar produces byte-identical `review index` output to before this
   * Story (AC-005).
   */
  readonly readinessPath?: string;
  /** `true` when present (contract §21 R1); omitted, never `false`, when there is none — see `readinessPath`. */
  readonly readinessPresent?: true;
  readonly locators: {
    /** One locator per un-fenced heading in `story.md`: a fixed field name when recognized, else its heading path. */
    readonly story: readonly Locator[];
    /** One locator per un-fenced heading, plus one per `AC-<digits>` checkbox line, in `acceptance.md`. */
    readonly acceptance: readonly Locator[];
  };
}

export interface AdrIndex {
  readonly path: string;
  /** One locator per un-fenced heading: the title's `ADR-<digits>` when recognized, else its heading path. */
  readonly locators: readonly Locator[];
}

export interface TraceStoryEntry {
  readonly storyId: string;
  readonly acceptanceIds: readonly string[];
  /** `true` when this Story ID is declared by more than one directory and so cannot be resolved. */
  readonly unresolved?: boolean;
}

export interface TraceEntry {
  readonly spec: string;
  readonly anchor: string;
  readonly stories: readonly TraceStoryEntry[];
}

export interface ReviewIndex {
  readonly batchId: string;
  /** Optional human-readable batch objective from the manifest. */
  readonly title?: string | undefined;
  /** Optional Review Preface (manifest `preface`, schemaVersion 1.1.0 only). */
  readonly preface?: string | undefined;
  readonly fingerprint: string;
  readonly manifestSha256: string;
  readonly sources: readonly SourceDigest[];
  readonly adrs: readonly AdrIndex[];
  readonly specs: readonly SpecIndex[];
  readonly stories: readonly StoryIndex[];
  readonly trace: readonly TraceEntry[];
  /** The manifest's `requirements` in declared order (contract §18 matrix row order). */
  readonly requirements: readonly ReviewBatchPlanRequirement[];
  readonly dependencies: readonly ReviewBatchPlanDependency[];
  readonly diagnostics: readonly ReviewDiagnostic[];
}

export type IndexReviewBatchResult =
  | { readonly kind: "unsafe"; readonly path: string }
  | { readonly kind: "too-large"; readonly path: string }
  | { readonly kind: "ok"; readonly index: ReviewIndex };
