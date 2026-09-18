/**
 * The batch review source index: turns one validated plan plus the bytes and
 * directory facts the CLI adapter gathered into the index contract §2–§5
 * define, with diagnostics for every gap Story TST-021 R8 names.
 *
 * This module performs no filesystem, process, or clock access (R9); every
 * fact it reasons about arrives through `plan` and `observations`.
 */

import { computeFingerprint, sha256Hex } from "./fingerprint.js";
import {
  readAcceptanceCheckboxLines,
  readDependencyProseIds,
  readSpecAcceptanceLines,
  readSpecEntryId,
  scanHeadingBlocks,
  scanMarkdownLines,
  type HeadingBlock,
  type MarkdownLineMatch,
} from "./markdown.js";
import { escapeControlCharacters } from "./path.js";
import type {
  AdrIndex,
  IndexReviewBatchResult,
  Locator,
  ReviewBatchPlan,
  ReviewDiagnostic,
  ReviewObservations,
  SourceDigest,
  SourceObservation,
  SpecAcceptanceEntry,
  SpecEntryIndex,
  SpecIndex,
  SpecSectionIndex,
  StoryIndex,
  TraceEntry,
} from "./types.js";

const MAX_SOURCE_MARKDOWN_BYTES = 4 * 1024 * 1024;

function diagnostic(
  code: string,
  severity: ReviewDiagnostic["severity"],
  message: string,
  path?: string,
  locator?: Locator,
): ReviewDiagnostic {
  const base: ReviewDiagnostic = { code, severity, message };
  return {
    ...base,
    ...(path === undefined ? {} : { path }),
    ...(locator === undefined ? {} : { locator }),
  };
}

function observationOf(
  observations: ReviewObservations,
  path: string,
): SourceObservation {
  return observations.get(path) ?? { kind: "missing" };
}

/** Groups items by a key, preserving each group's original order. */
function groupBy<T>(
  items: readonly T[],
  key: (item: T) => string,
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = groups.get(key(item)) ?? [];
    group.push(item);
    groups.set(key(item), group);
  }
  return groups;
}

/**
 * Evaluates one validated plan against the bytes and directory facts the CLI
 * gathered. A symlink/escape or an oversized source rejects the whole
 * command before any further content is read (Story TST-021 R6, R7); every
 * other gap becomes a diagnostic on a returned index (R8).
 */
export function indexReviewBatch(
  plan: ReviewBatchPlan,
  observations: ReviewObservations,
): IndexReviewBatchResult {
  for (const path of plan.sources) {
    const observation = observationOf(observations, path);
    if (observation.kind === "unsafe") return { kind: "unsafe", path };
  }
  for (const path of plan.sources) {
    const observation = observationOf(observations, path);
    if (
      observation.kind === "file" &&
      observation.bytes.byteLength > MAX_SOURCE_MARKDOWN_BYTES
    ) {
      return { kind: "too-large", path };
    }
  }

  const diagnostics: ReviewDiagnostic[] = [...plan.diagnostics];

  const sourceDigests: SourceDigest[] = plan.sources.map((path) => {
    const observation = observationOf(observations, path);
    if (observation.kind === "file") {
      return { path, sha256: sha256Hex(observation.bytes) };
    }
    diagnostics.push(
      diagnostic(
        "REVIEW_SOURCE_MISSING",
        "blocking",
        `declared source is missing: ${path}`,
        path,
      ),
    );
    return { path, sha256: null };
  });

  const fingerprint = computeFingerprint(plan.manifestSha256, sourceDigests);

  const knownStoryIds = new Set(
    plan.stories
      .map((story) => story.storyId)
      .filter((id): id is string => id !== undefined),
  );
  const ambiguousStoryIds = new Set(plan.ambiguousStoryIds);

  const adrs: AdrIndex[] = plan.adrs.map((path) => ({
    path,
    locators: documentLocators(
      path,
      observationOf(observations, path),
      adrExplicitId,
    ),
  }));

  const specs = plan.specs.map((path) =>
    indexSpec(path, observationOf(observations, path), diagnostics),
  );

  const stories: StoryIndex[] = plan.stories.map((story) => {
    const storyObservation = observationOf(observations, story.storyPath);
    const acceptanceObservation = observationOf(
      observations,
      story.acceptancePath,
    );

    const storyLocators = documentLocators(
      story.storyPath,
      storyObservation,
      storyExplicitId,
    );

    let acceptanceIds: readonly string[] = [];
    let acceptanceLocators: readonly Locator[] = [];
    if (acceptanceObservation.kind === "file") {
      const { bytes } = acceptanceObservation;
      const lines = scanMarkdownLines(bytes);
      const headingLocators = documentLocators(
        story.acceptancePath,
        acceptanceObservation,
        () => undefined,
      );
      const checkboxLines = readAcceptanceCheckboxLines(lines);
      const byId = groupBy(checkboxLines, (line) => line.id);

      const resolvedIds: string[] = [];
      const checkboxLocators: Locator[] = [];
      for (const [id, occurrences] of byId) {
        for (const occurrence of occurrences) {
          checkboxLocators.push({
            path: story.acceptancePath,
            anchor: id,
            blockSha256: sha256Hex(
              bytes.subarray(occurrence.start, occurrence.end),
            ),
          });
        }
        if (occurrences.length > 1) {
          for (const occurrence of occurrences) {
            diagnostics.push(
              diagnostic(
                "REVIEW_ANCHOR_DUPLICATE",
                "blocking",
                `anchor occurs more than once in ${story.acceptancePath}: ${id}`,
                story.acceptancePath,
                {
                  path: story.acceptancePath,
                  anchor: id,
                  blockSha256: sha256Hex(
                    bytes.subarray(occurrence.start, occurrence.end),
                  ),
                },
              ),
            );
          }
          continue;
        }
        resolvedIds.push(id);
      }

      acceptanceIds = resolvedIds;
      acceptanceLocators = [...headingLocators, ...checkboxLocators];

      if (acceptanceIds.length === 0) {
        diagnostics.push(
          diagnostic(
            "REVIEW_ACCEPTANCE_MISSING",
            "blocking",
            `Story has no acceptance criterion: ${story.directory}`,
            story.acceptancePath,
          ),
        );
      }
    }

    if (storyObservation.kind === "file" && story.storyId !== undefined) {
      const decoded = new TextDecoder("utf-8").decode(storyObservation.bytes);
      const mentioned = readDependencyProseIds(decoded, knownStoryIds);
      const declared = new Set(
        plan.dependencies
          .filter((dependency) => dependency.story === story.storyId)
          .flatMap((dependency) => dependency.dependsOn),
      );
      for (const mentionedId of mentioned) {
        if (mentionedId === story.storyId) continue;
        if (!declared.has(mentionedId))
          diagnostics.push(
            diagnostic(
              "REVIEW_DEPENDENCY_UNDECLARED",
              "advisory",
              `${story.storyId} prose mentions ${mentionedId} but the manifest does not declare that dependency`,
              story.storyPath,
            ),
          );
      }
    }

    return {
      id: story.storyId,
      path: story.directory,
      acceptanceIds,
      locators: {
        story: storyLocators,
        acceptance: acceptanceLocators,
      },
    };
  });

  const acceptanceByStoryId = new Map(
    stories
      .filter(
        (story): story is StoryIndex & { id: string } => story.id !== undefined,
      )
      .map((story) => [story.id, story.acceptanceIds] as const),
  );

  const trace: TraceEntry[] = [];
  for (const spec of specs) {
    for (const entry of spec.entries) {
      const matches = plan.requirements.filter(
        (requirement) =>
          requirement.spec === spec.path && requirement.anchor === entry.id,
      );

      const referencedStoryIds = matches.flatMap(
        (requirement) => requirement.stories,
      );
      const resolved = [
        ...new Set(
          referencedStoryIds.filter(
            (id) => knownStoryIds.has(id) && !ambiguousStoryIds.has(id),
          ),
        ),
      ];
      const unresolved = [
        ...new Set(
          referencedStoryIds.filter((id) => ambiguousStoryIds.has(id)),
        ),
      ];

      if (resolved.length === 0) {
        diagnostics.push(
          diagnostic(
            "REVIEW_REQUIREMENT_UNMAPPED",
            "blocking",
            `Spec entry has no mapped Story: ${entry.id}`,
            spec.path,
            entry.locator,
          ),
        );
        continue;
      }

      trace.push({
        spec: spec.path,
        anchor: entry.id,
        stories: [
          ...resolved.map((storyId) => ({
            storyId,
            acceptanceIds: acceptanceByStoryId.get(storyId) ?? [],
          })),
          ...unresolved.map((storyId) => ({
            storyId,
            acceptanceIds: [] as readonly string[],
            unresolved: true as const,
          })),
        ],
      });
    }
  }

  // A mapped anchor that does not name any recognized entry in its Spec
  // (including one excluded as a duplicate, which is reported separately) is
  // diagnosed once per requirement rather than silently ignored.
  for (const requirement of plan.requirements) {
    const spec = specs.find((candidate) => candidate.path === requirement.spec);
    if (spec === undefined) continue;
    const recognizedIds = new Set(spec.allRecognizedIds);
    if (!recognizedIds.has(requirement.anchor)) {
      diagnostics.push(
        diagnostic(
          "REVIEW_ANCHOR_UNKNOWN",
          "blocking",
          `requirement names an anchor not found in ${requirement.spec}: ${requirement.anchor}`,
          requirement.spec,
        ),
      );
    }
  }

  return {
    kind: "ok",
    index: {
      batchId: plan.batchId,
      title: plan.title,
      fingerprint,
      manifestSha256: plan.manifestSha256,
      sources: sourceDigests,
      adrs,
      specs: specs.map((spec) => ({
        path: spec.path,
        entries: spec.entries,
        sections: spec.sections,
      })),
      stories,
      trace,
      dependencies: plan.dependencies,
      diagnostics,
    },
  };
}

const adrTitlePattern = /ADR-(\d+)/;

function adrExplicitId(
  heading: HeadingBlock,
  index: number,
): string | undefined {
  if (index !== 0) return undefined;
  const match = adrTitlePattern.exec(heading.text);
  return match === null ? undefined : `ADR-${match[1]}`;
}

const STORY_FIXED_FIELDS: ReadonlySet<string> = new Set([
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

function storyExplicitId(heading: HeadingBlock): string | undefined {
  return heading.level === 2 && STORY_FIXED_FIELDS.has(heading.text)
    ? heading.text
    : undefined;
}

/**
 * Builds one locator per un-fenced heading of a document: the caller's
 * explicit ID when it recognizes one, else the heading path (contract §5).
 */
function documentLocators(
  path: string,
  observation: SourceObservation,
  explicitIdOf: (heading: HeadingBlock, index: number) => string | undefined,
): readonly Locator[] {
  if (observation.kind !== "file") return [];
  const { bytes } = observation;
  const lines = scanMarkdownLines(bytes);
  const headings = scanHeadingBlocks(bytes, lines);

  return headings.map((heading, index) => {
    const anchor = explicitIdOf(heading, index) ?? heading.headingPath;
    return {
      path,
      anchor,
      blockSha256: sha256Hex(
        bytes.subarray(heading.startOffset, heading.endOffset),
      ),
    };
  });
}

interface SpecIndexInternal extends SpecIndex {
  /** Every id recognized as a Spec entry, including ones excluded as duplicates (index-internal only). */
  readonly allRecognizedIds: readonly string[];
}

function specAcceptanceLocator(
  path: string,
  entryId: string,
  bytes: Uint8Array,
  line: MarkdownLineMatch,
): Locator {
  return {
    path,
    anchor: `${entryId}/${line.id}`,
    blockSha256: sha256Hex(bytes.subarray(line.start, line.end)),
  };
}

function indexSpec(
  path: string,
  observation: SourceObservation,
  diagnostics: ReviewDiagnostic[],
): SpecIndexInternal {
  if (observation.kind !== "file") {
    return { path, entries: [], sections: [], allRecognizedIds: [] };
  }

  const { bytes } = observation;
  const lines = scanMarkdownLines(bytes);
  const headings = scanHeadingBlocks(bytes, lines);

  const byId = new Map<string, HeadingBlock[]>();
  for (const heading of headings) {
    const id = readSpecEntryId(heading);
    if (id === undefined) continue;
    const group = byId.get(id) ?? [];
    group.push(heading);
    byId.set(id, group);
  }

  const duplicateIds = new Set(
    [...byId.entries()]
      .filter(([, group]) => group.length > 1)
      .map(([id]) => id),
  );

  // Recognized entry ranges, used only to tell a heading nested inside an
  // entry's own block apart from a genuinely unrecognized top-level section
  // (Story TST-021 code review item 7).
  const entryRanges = headings
    .map((heading) => ({ heading, id: readSpecEntryId(heading) }))
    .filter(
      (candidate): candidate is { heading: HeadingBlock; id: string } =>
        candidate.id !== undefined && !duplicateIds.has(candidate.id),
    )
    .map((candidate) => candidate.heading);

  const entries: SpecEntryIndex[] = [];
  const sections: SpecSectionIndex[] = [];
  const reportedSections = new Set<string>();

  for (const heading of headings) {
    const id = readSpecEntryId(heading);

    if (id !== undefined && duplicateIds.has(id)) {
      const blockSha256 = sha256Hex(
        bytes.subarray(heading.startOffset, heading.endOffset),
      );
      diagnostics.push(
        diagnostic(
          "REVIEW_ANCHOR_DUPLICATE",
          "blocking",
          `anchor occurs more than once in ${path}: ${id}`,
          path,
          { path, anchor: id, blockSha256 },
        ),
      );
      continue;
    }

    if (id !== undefined) {
      const blockSha256 = sha256Hex(
        bytes.subarray(heading.startOffset, heading.endOffset),
      );
      const acceptanceLines = readSpecAcceptanceLines(
        lines,
        heading.startOffset,
        heading.endOffset,
      );
      const byAcceptanceId = groupBy(acceptanceLines, (line) => line.id);
      const acceptance: SpecAcceptanceEntry[] = [];
      for (const [acId, occurrences] of byAcceptanceId) {
        if (occurrences.length > 1) {
          for (const occurrence of occurrences) {
            diagnostics.push(
              diagnostic(
                "REVIEW_ANCHOR_DUPLICATE",
                "blocking",
                `anchor occurs more than once in ${path}: ${id}/${acId}`,
                path,
                specAcceptanceLocator(path, id, bytes, occurrence),
              ),
            );
          }
          continue;
        }
        const [only] = occurrences as [MarkdownLineMatch];
        acceptance.push({
          id: acId,
          locator: specAcceptanceLocator(path, id, bytes, only),
        });
      }

      entries.push({
        id,
        heading: heading.text,
        locator: { path, anchor: id, blockSha256 },
        acceptance,
      });
      continue;
    }

    // A heading nested inside a recognized entry's own block is that entry's
    // content, not a separate, unrecognized top-level section.
    const nestedInEntry = entryRanges.some(
      (entry) =>
        heading.startOffset > entry.startOffset &&
        heading.startOffset < entry.endOffset,
    );
    if (nestedInEntry) continue;

    // An unrecognized heading is still indexed by heading path so no source
    // content is dropped from the index (Story TST-021 R3, R5).
    const blockSha256 = sha256Hex(
      bytes.subarray(heading.startOffset, heading.endOffset),
    );
    sections.push({
      headingPath: heading.headingPath,
      locator: { path, anchor: heading.headingPath, blockSha256 },
    });
    if (!reportedSections.has(heading.headingPath)) {
      reportedSections.add(heading.headingPath);
      diagnostics.push(
        diagnostic(
          "REVIEW_SECTION_UNRECOGNIZED",
          "advisory",
          `unrecognized section: ${escapeControlCharacters(heading.headingPath)}`,
          path,
          { path, anchor: heading.headingPath, blockSha256 },
        ),
      );
    }
  }

  return {
    path,
    entries,
    sections,
    allRecognizedIds: [...byId.keys()],
  };
}
