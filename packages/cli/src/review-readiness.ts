/**
 * Shared Readiness Sidecar loading for `review preflight` and `review
 * readiness-digests` (contract §21, Story TST-030): reads every present
 * `<story>/readiness.json` from the same `observations` `review index`
 * already gathered (no extra filesystem access), and turns Core's pure
 * parse/consistency/reference checks into the findings each command needs.
 */

import {
  buildReadinessOutputOwners,
  checkReadinessSidecarConsistency,
  checkReadinessSidecarReferences,
  parseReadinessSidecar,
  readAuthority,
  readTaskMode,
  sha256Hex,
  transitiveDependencyClosureDirectories,
  type ReadinessSidecarData,
  type ReadinessSidecarParseResult,
  type ReviewIndex,
  type ReviewObservations,
} from "@praxisbound/core";

export interface ReadinessSidecarEntry {
  readonly storyDirectory: string;
  readonly bytes: Uint8Array;
  readonly parse: ReadinessSidecarParseResult;
}

/** Every batch Story with a present Sidecar (contract §21 R1: absence is never diagnosed here). */
export function loadBatchReadinessSidecars(
  index: ReviewIndex,
  observations: ReviewObservations,
): readonly ReadinessSidecarEntry[] {
  const entries: ReadinessSidecarEntry[] = [];
  for (const story of index.stories) {
    if (!story.readinessPresent) continue;
    const observation = observations.get(story.readinessPath);
    if (observation === undefined || observation.kind !== "file") continue;
    entries.push({
      storyDirectory: story.path,
      bytes: observation.bytes,
      parse: parseReadinessSidecar(observation.bytes, story.path),
    });
  }
  return entries;
}

export interface ReadinessPreflightFinding {
  readonly code:
    | "REVIEW_READINESS_INVALID"
    | "REVIEW_INPUT_TOO_LARGE"
    | "REVIEW_READINESS_STALE"
    | "REVIEW_READINESS_CRITERIA_MISMATCH"
    | "REVIEW_READINESS_OPERATION_UNGRANTED"
    | "REVIEW_READINESS_REFERENCE_UNKNOWN";
  readonly message: string;
  readonly path: string;
}

/**
 * Every contract §21 preflight finding for every present Sidecar: schema/
 * size (`REVIEW_READINESS_INVALID`/`REVIEW_INPUT_TOO_LARGE`), then — only
 * for a schema-valid one — digest, criteria, operation, and reference
 * consistency. A Story whose `story.md`/`acceptance.md` could not be read is
 * skipped for the consistency/reference checks (a missing source already
 * reports `REVIEW_SOURCE_MISSING` elsewhere); its schema/size finding, if
 * any, still reports.
 */
export function computeReadinessPreflightFindings(
  index: ReviewIndex,
  observations: ReviewObservations,
): readonly ReadinessPreflightFinding[] {
  const entries = loadBatchReadinessSidecars(index, observations);
  const findings: ReadinessPreflightFinding[] = [];

  const parsedByDirectory = new Map<string, ReadinessSidecarData>();
  for (const entry of entries) {
    if (!entry.parse.ok) {
      findings.push({
        code: entry.parse.tooLarge
          ? "REVIEW_INPUT_TOO_LARGE"
          : "REVIEW_READINESS_INVALID",
        message: entry.parse.message,
        path: entry.storyDirectory,
      });
      continue;
    }
    parsedByDirectory.set(entry.storyDirectory, entry.parse.data);
  }
  if (parsedByDirectory.size === 0) return findings;

  const directoryByStoryId = new Map<string, string>();
  for (const story of index.stories) {
    if (story.id !== undefined) directoryByStoryId.set(story.id, story.path);
  }
  const batchStoryDirectories = new Set(
    index.stories.map((story) => story.path),
  );
  const outputOwners = buildReadinessOutputOwners(parsedByDirectory);

  for (const story of index.stories) {
    const data = parsedByDirectory.get(story.path);
    if (data === undefined) continue;

    const storyMdObservation = observations.get(`${story.path}/story.md`);
    const acceptanceMdObservation = observations.get(
      `${story.path}/acceptance.md`,
    );
    if (
      storyMdObservation?.kind !== "file" ||
      acceptanceMdObservation?.kind !== "file"
    )
      continue;

    const issues: { readonly code: string; readonly message: string }[] = [];
    const taskMode = readTaskMode(
      new TextDecoder("utf-8").decode(storyMdObservation.bytes),
      issues,
    );
    const authority = readAuthority(
      new TextDecoder("utf-8").decode(storyMdObservation.bytes),
      taskMode,
      issues,
    );
    const grantedOperations = new Set(
      Object.entries(authority)
        .filter(([, granted]) => granted)
        .map(([operation]) => operation),
    );

    const dependencyClosure =
      story.id === undefined
        ? new Set<string>()
        : transitiveDependencyClosureDirectories(
            story.id,
            index.dependencies,
            directoryByStoryId,
          );

    const context = {
      storyDirectory: story.path,
      storyMdBytes: storyMdObservation.bytes,
      acceptanceMdBytes: acceptanceMdObservation.bytes,
      acceptanceIds: story.acceptanceIds,
      grantedOperations,
      dependencyClosure,
    };

    for (const finding of checkReadinessSidecarConsistency(data, context))
      findings.push({
        code: finding.code,
        message: finding.message,
        path: finding.storyDirectory,
      });
    for (const finding of checkReadinessSidecarReferences(data, context, {
      batchStoryDirectories,
      outputOwners,
    }))
      findings.push({
        code: finding.code,
        message: finding.message,
        path: finding.storyDirectory,
      });
  }

  return findings;
}

/** `sha256:` plus the lowercase hex digest of `bytes` (contract §21's digest form). */
export function prefixedSha256(bytes: Uint8Array): string {
  return `sha256:${sha256Hex(bytes)}`;
}
