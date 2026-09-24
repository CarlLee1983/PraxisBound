/**
 * Pure Goal Plan projection (contract §10, Story TST-031): turns the current
 * batch.json, ADR/Spec/Story source bytes, every Story's Readiness Sidecar
 * bytes, and the one Definition Confirmation record whose fingerprint
 * matches into the exact bytes of the three Goal Plan artifacts
 * (`declaration.json`, `manifest.json`, `coverage-review.json`), built on
 * top of Story TST-029's exporters (`goal-plan-artifacts.ts`), which
 * self-validate every artifact they produce before returning it.
 *
 * This module reads no clock, environment, git state, or earlier Goal Plan
 * (R4): every fact it needs is a caller-supplied argument, so projecting the
 * same input twice always yields identical bytes.
 */

import {
  exportGoalPlanDeclaration,
  exportGoalPlanManifest,
  exportPlanCoverageReview,
  type CoverageIndex,
  type GoalPlanSourceBytes,
} from "../goal-plan-artifacts.js";
import { sha256Hex } from "./fingerprint.js";

export interface GoalPlanProjectionStory {
  /** The Story ID (Declaration/Manifest `nodeRef`). */
  readonly nodeRef: string;
  /** The Story directory (Declaration/Manifest `storyRef`). */
  readonly storyRef: string;
  /** Story IDs this Story depends on. */
  readonly dependsOn: readonly string[];
  /** `<storyRef>/readiness.json` bytes. */
  readonly readiness: GoalPlanSourceBytes;
  /** `<storyRef>/story.md` bytes. */
  readonly storyMd: GoalPlanSourceBytes;
  /** `<storyRef>/acceptance.md` bytes. */
  readonly acceptanceMd: GoalPlanSourceBytes;
}

export interface GoalPlanProjectionConfirmation {
  /** The confirmation record's repo-relative path. */
  readonly path: string;
  /** The confirmation record's exact bytes. */
  readonly bytes: Uint8Array;
  /** The confirmation record's own `confirmedAt`. */
  readonly confirmedAt: string;
}

export interface GoalPlanProjectionInput {
  readonly planId: string;
  readonly batchId: string;
  readonly fingerprint: string;
  readonly batchJson: GoalPlanSourceBytes;
  readonly adrs: readonly GoalPlanSourceBytes[];
  readonly specs: readonly GoalPlanSourceBytes[];
  readonly stories: readonly GoalPlanProjectionStory[];
  readonly confirmation: GoalPlanProjectionConfirmation;
}

export interface GoalPlanProjectionSuccess {
  readonly ok: true;
  /** `specs/batches/<BATCH-ID>/goal-plan/<plan.id>` (no trailing slash). */
  readonly directory: string;
  readonly declarationPath: string;
  readonly manifestPath: string;
  readonly coverageReviewPath: string;
  readonly declaration: Uint8Array;
  readonly manifest: Uint8Array;
  readonly coverageReview: Uint8Array;
}

export interface GoalPlanProjectionFailure {
  readonly ok: false;
  readonly message: string;
}

export type GoalPlanProjectionResult =
  GoalPlanProjectionSuccess | GoalPlanProjectionFailure;

const CONFIRMED_AT_PATTERN = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+)?Z$/;

/**
 * Contract §10 step 3's `reviewedAt`: the confirmation's own `confirmedAt`
 * truncated to milliseconds and padded to the `.000Z` form the Goal Plan
 * artifact schema requires (exactly three fractional-second digits).
 */
export function toGoalPlanReviewedAt(confirmedAt: string): string {
  const match = CONFIRMED_AT_PATTERN.exec(confirmedAt);
  if (match === null)
    throw new TypeError("confirmedAt is not a valid UTC date-time");
  const fractionDigits = (match[2] ?? ".").slice(1);
  const milliseconds = (fractionDigits + "000").slice(0, 3);
  return `${match[1]}.${milliseconds}Z`;
}

/**
 * Contract §10 step 3's `reviewId` derivation: the confirmation record's own
 * sha256, its first 32 hex characters formatted 8-4-4-4-12, with the 13th
 * character forced to `4` and the 17th forced to one of `8`/`9`/`a`/`b`
 * (`& 0x3 | 0x8`) — a UUIDv4-shaped value, never claimed to be random.
 */
export function deriveGoalPlanReviewId(confirmationSha256: string): string {
  const hex = confirmationSha256.slice(0, 32).split("");
  const sixteenth = hex[16];
  if (hex.length < 32 || sixteenth === undefined)
    throw new TypeError(
      "confirmation sha256 is too short to derive a reviewId",
    );
  hex[12] = "4";
  hex[16] = ((Number.parseInt(sixteenth, 16) & 0x3) | 0x8).toString(16);
  const joined = hex.join("");
  return [
    joined.slice(0, 8),
    joined.slice(8, 12),
    joined.slice(12, 16),
    joined.slice(16, 20),
    joined.slice(20, 32),
  ].join("-");
}

/**
 * Projects the three Goal Plan artifacts from caller-supplied facts alone
 * (R4). Every export already self-validates against Story TST-029's own
 * validator (`goal-plan-artifacts.ts`) before returning, so a projection
 * that would fail its own validator throws here instead of returning bytes
 * — the caller (`review goal-plan`) turns that into `ERROR`, exit 3.
 */
export function projectGoalPlan(
  input: GoalPlanProjectionInput,
): GoalPlanProjectionResult {
  try {
    const directory = `specs/batches/${input.batchId}/goal-plan/${input.planId}`;
    const declarationPath = `${directory}/declaration.json`;
    const manifestPath = `${directory}/manifest.json`;
    const coverageReviewPath = `${directory}/coverage-review.json`;

    const declaration = exportGoalPlanDeclaration({
      planId: input.planId,
      revision: 1,
      nodes: input.stories.map((story) => ({
        nodeRef: story.nodeRef,
        storyRef: story.storyRef,
        dependsOn: story.dependsOn,
      })),
    });

    const declarationBinding: GoalPlanSourceBytes = {
      path: declarationPath,
      bytes: declaration,
    };

    const coverageIndex: CoverageIndex = {
      batchId: input.batchId,
      fingerprint: input.fingerprint,
    };

    // Contract §10 step 3: reviewedSources lists batch.json, every ADR,
    // Spec, story.md, acceptance.md, readiness.json, and the Declaration
    // itself; the exporter sorts them by UTF-8 path bytes.
    const reviewedSources: GoalPlanSourceBytes[] = [
      input.batchJson,
      ...input.adrs,
      ...input.specs,
      ...input.stories.flatMap((story) => [
        story.storyMd,
        story.acceptanceMd,
        story.readiness,
      ]),
      declarationBinding,
    ];

    const manifest = exportGoalPlanManifest({
      planId: input.planId,
      revision: 1,
      declaration: declarationBinding,
      nodes: input.stories.map((story) => ({
        nodeRef: story.nodeRef,
        storyRef: story.storyRef,
        readiness: story.readiness,
        dependsOn: story.dependsOn,
      })),
      reviewedSources,
      coverageIndex,
    });

    const sourceFacts = new Map<string, Uint8Array>();
    for (const source of reviewedSources)
      sourceFacts.set(source.path, source.bytes);

    const coverageReview = exportPlanCoverageReview({
      manifestBytes: manifest,
      reviewId: deriveGoalPlanReviewId(sha256Hex(input.confirmation.bytes)),
      conclusion: "approved",
      reviewer: {
        name: `PraxisBound Definition Confirmation ${input.confirmation.path}`,
        assurance: "self-asserted",
      },
      reviewedAt: toGoalPlanReviewedAt(input.confirmation.confirmedAt),
      sources: sourceFacts,
    });

    return {
      ok: true,
      directory,
      declarationPath,
      manifestPath,
      coverageReviewPath,
      declaration,
      manifest,
      coverageReview,
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "Goal Plan projection failed",
    };
  }
}
