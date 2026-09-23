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
  readonly parse: ReadinessSidecarParseResult;
}

const UNREADABLE_MESSAGE =
  "readiness.json exists but could not be read (permission denied or similar)";

/** Contract §13/§21's Readiness Sidecar bound — matches `review.ts`'s own `READINESS_SIDECAR_MAX_BYTES`. */
const READINESS_SIDECAR_MAX_BYTES = 1024 * 1024;

/**
 * Every batch Story with a present Sidecar (contract §21 R1: absence is
 * never diagnosed here). A Sidecar that exists but could not be read
 * (`kind: "unreadable"` — MEDIUM: distinct from a genuinely absent one) is
 * reported as a synthetic `REVIEW_READINESS_INVALID` parse failure rather
 * than silently skipped, since there is no content to parse but the Story
 * still declares a Sidecar that must resolve to a definite outcome. An
 * over-limit one (`kind: "oversized"`, HIGH-1 code review round 2) was never
 * read into memory at all, so it is reported the same way Core's own
 * `parseReadinessSidecar` reports an over-limit Sidecar it *did* read
 * (`tooLarge: true`), without ever parsing it.
 */
export function loadBatchReadinessSidecars(
  index: ReviewIndex,
  observations: ReviewObservations,
): readonly ReadinessSidecarEntry[] {
  const entries: ReadinessSidecarEntry[] = [];
  for (const story of index.stories) {
    if (!story.readinessPresent || story.readinessPath === undefined) continue;
    const observation = observations.get(story.readinessPath);
    if (observation?.kind === "file") {
      entries.push({
        storyDirectory: story.path,
        parse: parseReadinessSidecar(observation.bytes, story.path),
      });
      continue;
    }
    if (observation?.kind === "oversized") {
      entries.push({
        storyDirectory: story.path,
        parse: {
          ok: false,
          tooLarge: true,
          message: `readiness.json exceeds ${READINESS_SIDECAR_MAX_BYTES} bytes`,
        },
      });
      continue;
    }
    // `unreadable` (or any other non-`file`/`oversized` state reachable
    // while `readinessPresent` is true): no bytes to parse, so it never
    // reaches `REVIEW_READY` and `readiness-digests` never treats it as
    // writable.
    entries.push({
      storyDirectory: story.path,
      parse: { ok: false, tooLarge: false, message: UNREADABLE_MESSAGE },
    });
  }
  return entries;
}

export interface ReadinessPreflightFinding {
  readonly code: string;
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
 * any, still reports. LOW: `readAuthority`/`readTaskMode`'s own governance
 * issues (a malformed `## Authority`/`## Classification`) are surfaced
 * here, as their own `STORY_*` findings, rather than silently discarded —
 * `evaluatePreflight` already classifies any `STORY_`-prefixed code as
 * BLOCKED.
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

    const governanceIssues: {
      readonly code: string;
      readonly message: string;
    }[] = [];
    const storyText = new TextDecoder("utf-8").decode(storyMdObservation.bytes);
    const taskMode = readTaskMode(storyText, governanceIssues);
    const authority = readAuthority(storyText, taskMode, governanceIssues);
    for (const issue of governanceIssues)
      findings.push({
        code: issue.code,
        message: issue.message,
        path: story.path,
      });

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
