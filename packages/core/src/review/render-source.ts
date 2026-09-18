/**
 * Per-document placement partition (contract §18, Story TST-022 R11).
 *
 * Splits one already-read document's bytes into the exact placement units
 * the projection page needs: Spec `Goal`/`Non-goals`/entry cells, a Story's
 * focus fields, an acceptance file's AC groups, and each document's leftover
 * sections for the appendix. Every function here recomputes byte ranges from
 * the shared scanner (`markdown.ts`) using the same recognition rules
 * `index.ts` used to build the `Locator`s it looks up — the Locator itself
 * carries no byte offset, so this is the only place that reconstructs one.
 * Pure: no I/O, only the bytes and index facts the caller already holds.
 */

import {
  adrExplicitId,
  ENTRY_SECTION_LABELS,
  matchEntrySectionVocab,
  matchTopLevelVocab,
  STORY_FIXED_FIELDS,
} from "./index.js";
import { renderMarkdownHtml } from "./markdown-html.js";
import {
  readAcceptanceCheckboxLines,
  readSpecEntryId,
  scanHeadingBlocks,
  scanMarkdownLines,
  type HeadingBlock,
} from "./markdown.js";
import { locatorAttributes, type LocatorLookup } from "./render-locators.js";
import type { SpecAcceptanceEntry, SpecIndex } from "./types.js";

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export const MISSING_SECTION_TEXT = "未寫明";
export const NO_STORY_TEXT = "無對應 Story";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * One requirement's matrix/card label (contract §18, R13). A recognized Spec
 * entry heading already starts with its own ID (§3), so repeating the ID in
 * front of it would show it twice; the ID is set apart visually only when
 * the heading text does not already carry it.
 */
export function requirementLabelHtml(id: string, heading: string): string {
  if (heading.startsWith(id)) return escapeHtml(heading);
  return `<span class="req-id">${escapeHtml(id)}</span> ${escapeHtml(heading)}`;
}

/**
 * The `story.md` H1 is `Story: <ID> <title>` (contract §18 R13); this strips
 * the `Story:` prefix and the repeated ID, leaving just `<title>`. Returns
 * `undefined` when the H1 does not follow that shape, so the caller shows it
 * unchanged instead of guessing at a different one.
 */
export function storyTitleWithoutId(
  h1Text: string,
  storyId: string,
): string | undefined {
  const pattern = new RegExp(`^Story:\\s*${escapeRegExp(storyId)}\\s+(.*)$`);
  return pattern.exec(h1Text)?.[1];
}

export interface AppendixSection {
  readonly path: string;
  readonly html: string;
}

/**
 * A heading block's display end, capped at the next heading of the
 * document's own structuring level (2, `##`) when the shared scanner would
 * otherwise extend a lone, sibling-less heading (typically the file's own
 * `#` title) all the way to end of file.
 */
function boundedEnd(
  headings: readonly HeadingBlock[],
  heading: HeadingBlock,
): number {
  const capLevel = Math.max(heading.level, 2);
  const next = headings.find(
    (candidate) =>
      candidate.startOffset > heading.startOffset &&
      candidate.level <= capLevel,
  );
  return next === undefined
    ? heading.endOffset
    : Math.min(heading.endOffset, next.startOffset);
}

/** The anchor `index.ts` would assign this Spec heading (contract §5). */
function specHeadingAnchor(
  heading: HeadingBlock,
  entryId: string | undefined,
): string {
  if (heading.level === 2) {
    const id = readSpecEntryId(heading);
    if (id !== undefined) return id;
    const vocab = matchTopLevelVocab(heading.text);
    if (vocab !== undefined) return vocab === "goal" ? "Goal" : "Non-goals";
  }
  if (heading.level === 3 && entryId !== undefined) {
    const vocab = matchEntrySectionVocab(heading.text);
    if (vocab !== undefined) return `${entryId}/${ENTRY_SECTION_LABELS[vocab]}`;
  }
  return heading.headingPath;
}

/**
 * Heading attributes for one rendered block: the block's own heading gets
 * `own`; any heading nested inside it keeps the locator the index assigned to
 * that nested heading, and stays visible (R11, AC-005).
 */
function blockHeadingAttributes(
  block: HeadingBlock,
  own: () => Record<string, string> | undefined,
  nested: (heading: HeadingBlock) => Record<string, string> | undefined,
): (heading: HeadingBlock) => Record<string, string> | undefined {
  return (heading) =>
    heading.startOffset === block.startOffset ? own() : nested(heading);
}

/** Inserts one label span, in order, at the start of each sequential `<li>` in `html`. */
function injectLabels(html: string, labels: readonly string[]): string {
  let index = 0;
  return html.replace(/<li([^>]*)>/g, (match, attributes: string) => {
    const label = labels[index];
    index += 1;
    return label === undefined
      ? match
      : `<li${attributes}><span class="ac-id">${escapeHtml(label)}</span> `;
  });
}

const specAcceptanceLinePattern = /^[-*]\s+AC-(\d+)[：:]/;

/**
 * Same as `locatorAttributes`, but visually hides the element. Used where the
 * caller already shows an equivalent Chinese caption for this vocabulary
 * heading, so the source heading stays in the DOM (locator, accessibility
 * tree) without displaying the same label a second time on screen or print.
 */
function hiddenLocatorAttributes(
  lookup: LocatorLookup,
  path: string,
  anchor: string,
): Record<string, string> | undefined {
  const attributes = locatorAttributes(lookup, path, anchor);
  return attributes === undefined
    ? undefined
    : { ...attributes, class: "visually-hidden" };
}

/**
 * Renders one recognized vocabulary heading's own block, including the
 * heading itself (demoted, since the caller already labels the slot in
 * Chinese): the heading text is still verbatim source content (R11), and its
 * Locator has to attach to the element that carries it (R-005 second half).
 * `hideHeading` visually hides that heading when the caller's own caption
 * already names the same field (contract §18).
 */
function renderVocabBlock(
  bytes: Uint8Array,
  headings: readonly HeadingBlock[],
  heading: HeadingBlock | undefined,
  path: string,
  anchor: string,
  lookup: LocatorLookup,
  entryId: string | undefined,
  hideHeading = false,
): string | undefined {
  if (heading === undefined) return undefined;
  return renderMarkdownHtml(
    bytes,
    heading.startOffset,
    boundedEnd(headings, heading),
    {
      headingLevelOffset: 4,
      headingAttributes: blockHeadingAttributes(
        heading,
        () =>
          hideHeading
            ? hiddenLocatorAttributes(lookup, path, anchor)
            : locatorAttributes(lookup, path, anchor),
        (nested) =>
          locatorAttributes(lookup, path, specHeadingAnchor(nested, entryId)),
      ),
    },
  );
}

function renderEntryAcceptance(
  specPath: string,
  entryId: string,
  acceptance: readonly SpecAcceptanceEntry[],
  acceptanceHeading: HeadingBlock | undefined,
  headings: readonly HeadingBlock[],
  bytes: Uint8Array,
  lookup: LocatorLookup,
): string {
  if (acceptance.length === 0)
    return `<p class="muted">${MISSING_SECTION_TEXT}</p>`;
  const labels = acceptance.map((item) => `${entryId}/${item.id}`);
  if (acceptanceHeading === undefined) {
    // No dedicated Acceptance heading recognized; the AC lines are still
    // indexed (§5 scans the whole entry), but this projection labels them
    // without their surrounding prose in that unusual shape.
    return acceptance
      .map(
        (item, position) =>
          `<p><span class="ac-id">${escapeHtml(labels[position] as string)}</span> ${escapeHtml(item.id)}</p>`,
      )
      .join("");
  }
  const html = renderMarkdownHtml(
    bytes,
    acceptanceHeading.startOffset,
    boundedEnd(headings, acceptanceHeading),
    {
      headingLevelOffset: 4,
      headingAttributes: blockHeadingAttributes(
        acceptanceHeading,
        () =>
          hiddenLocatorAttributes(lookup, specPath, `${entryId}/Acceptance`),
        (nested) =>
          locatorAttributes(
            lookup,
            specPath,
            specHeadingAnchor(nested, entryId),
          ),
      ),
      listItemAttributes: (line) => {
        const match = specAcceptanceLinePattern.exec(line.trimmed);
        if (match === null) return undefined;
        return locatorAttributes(lookup, specPath, `${entryId}/AC-${match[1]}`);
      },
    },
  );
  return injectLabels(html, labels);
}

function renderEntryDetail(
  specPath: string,
  entryId: string,
  entryHeading: HeadingBlock,
  entryEnd: number,
  subheadings: readonly HeadingBlock[],
  kept: ReadonlySet<HeadingBlock>,
  headings: readonly HeadingBlock[],
  bytes: Uint8Array,
  lookup: LocatorLookup,
): string {
  const headingAttributes = (heading: HeadingBlock) =>
    locatorAttributes(lookup, specPath, specHeadingAnchor(heading, entryId));

  // The front chunk (entry heading line + preamble) ends at the first
  // subheading of any kind, consumed or not — a subheading consumed
  // elsewhere (Goal/Acceptance/Non-goals) must never bleed into this span.
  const frontEnd = subheadings[0]?.startOffset ?? entryEnd;
  const blocks = [
    renderMarkdownHtml(bytes, entryHeading.startOffset, frontEnd, {
      headingAttributes,
    }),
  ];
  for (const heading of subheadings) {
    if (!kept.has(heading)) continue;
    blocks.push(
      renderMarkdownHtml(
        bytes,
        heading.startOffset,
        boundedEnd(headings, heading),
        {
          headingAttributes,
        },
      ),
    );
  }
  return blocks.join("\n");
}

export interface SpecEntryContent {
  readonly goalCellHtml: string;
  readonly nonGoalsCellHtml: string;
  readonly acceptanceHtml: string;
  readonly detailHtml: string;
}

export interface SpecDocumentContent {
  readonly goalHtml: string | undefined;
  readonly nonGoalsHtml: string | undefined;
  readonly entries: ReadonlyMap<string, SpecEntryContent>;
  readonly appendixSections: readonly AppendixSection[];
}

/** Splits one Spec document into its contract §18 placement units. */
export function partitionSpecDocument(
  spec: SpecIndex,
  bytes: Uint8Array,
  lookup: LocatorLookup,
): SpecDocumentContent {
  const lines = scanMarkdownLines(bytes);
  const headings = scanHeadingBlocks(bytes, lines);

  const goalHeading = headings.find(
    (heading) =>
      heading.level === 2 &&
      readSpecEntryId(heading) === undefined &&
      matchTopLevelVocab(heading.text) === "goal",
  );
  const nonGoalsHeading = headings.find(
    (heading) =>
      heading.level === 2 &&
      readSpecEntryId(heading) === undefined &&
      matchTopLevelVocab(heading.text) === "nonGoals",
  );

  const entries = new Map<string, SpecEntryContent>();
  for (const entry of spec.entries) {
    const entryHeading = headings.find(
      (heading) => heading.level === 2 && readSpecEntryId(heading) === entry.id,
    );
    if (entryHeading === undefined) {
      entries.set(entry.id, {
        goalCellHtml: `<p class="muted">${MISSING_SECTION_TEXT}</p>`,
        nonGoalsCellHtml: `<p class="muted">${MISSING_SECTION_TEXT}</p>`,
        acceptanceHtml: `<p class="muted">${MISSING_SECTION_TEXT}</p>`,
        detailHtml: "",
      });
      continue;
    }
    const entryEnd = entryHeading.endOffset;
    const subheadings = headings.filter(
      (heading) =>
        heading.level === 3 &&
        heading.startOffset > entryHeading.startOffset &&
        heading.startOffset < entryEnd,
    );
    const entryGoal = subheadings.find(
      (heading) => matchEntrySectionVocab(heading.text) === "goal",
    );
    const entryNonGoals = subheadings.find(
      (heading) => matchEntrySectionVocab(heading.text) === "nonGoals",
    );
    const entryAcceptance = subheadings.find(
      (heading) => matchEntrySectionVocab(heading.text) === "acceptance",
    );
    const consumed = new Set(
      [entryGoal, entryNonGoals, entryAcceptance].filter(
        (heading): heading is HeadingBlock => heading !== undefined,
      ),
    );
    const kept = new Set(
      subheadings.filter((heading) => !consumed.has(heading)),
    );

    entries.set(entry.id, {
      goalCellHtml:
        renderVocabBlock(
          bytes,
          headings,
          entryGoal,
          spec.path,
          `${entry.id}/Goal`,
          lookup,
          entry.id,
          true,
        ) ?? `<p class="muted">${MISSING_SECTION_TEXT}</p>`,
      nonGoalsCellHtml:
        renderVocabBlock(
          bytes,
          headings,
          entryNonGoals,
          spec.path,
          `${entry.id}/Non-goals`,
          lookup,
          entry.id,
          true,
        ) ?? `<p class="muted">${MISSING_SECTION_TEXT}</p>`,
      acceptanceHtml: renderEntryAcceptance(
        spec.path,
        entry.id,
        entry.acceptance,
        entryAcceptance,
        headings,
        bytes,
        lookup,
      ),
      detailHtml: renderEntryDetail(
        spec.path,
        entry.id,
        entryHeading,
        entryEnd,
        subheadings,
        kept,
        headings,
        bytes,
        lookup,
      ),
    });
  }

  const consumedTopLevel = new Set(
    [
      goalHeading,
      nonGoalsHeading,
      ...[...entries.keys()].map((id) =>
        headings.find(
          (heading) => heading.level === 2 && readSpecEntryId(heading) === id,
        ),
      ),
    ].filter((heading): heading is HeadingBlock => heading !== undefined),
  );
  const appendixSections: AppendixSection[] = [];
  for (const heading of headings) {
    if (heading.level > 2) continue;
    if (consumedTopLevel.has(heading)) continue;
    const html = renderMarkdownHtml(
      bytes,
      heading.startOffset,
      boundedEnd(headings, heading),
      {
        headingAttributes: (candidate) =>
          locatorAttributes(
            lookup,
            spec.path,
            specHeadingAnchor(candidate, undefined),
          ),
      },
    );
    appendixSections.push({ path: spec.path, html });
  }

  return {
    goalHtml: renderVocabBlock(
      bytes,
      headings,
      goalHeading,
      spec.path,
      "Goal",
      lookup,
      undefined,
    ),
    nonGoalsHtml: renderVocabBlock(
      bytes,
      headings,
      nonGoalsHeading,
      spec.path,
      "Non-goals",
      lookup,
      undefined,
    ),
    entries,
    appendixSections,
  };
}

const STORY_FOCUS_FIELDS = [
  "Goal",
  "Scope",
  "Rules",
  "Expected Errors",
  "Constraints",
] as const;

const STORY_FOCUS_LABELS: Readonly<Record<string, string>> = {
  Goal: "目標",
  Scope: "範圍",
  Rules: "規則",
  "Expected Errors": "預期錯誤",
  Constraints: "限制",
};

export interface StoryContent {
  readonly focusHtml: string;
  readonly appendixSections: readonly AppendixSection[];
}

/** Splits one `story.md` into its Focus fields and the rest (contract §18). */
export function partitionStoryDocument(
  storyPath: string,
  bytes: Uint8Array,
  lookup: LocatorLookup,
): StoryContent {
  const lines = scanMarkdownLines(bytes);
  const headings = scanHeadingBlocks(bytes, lines);

  const focusHeadings = new Map<string, HeadingBlock>();
  for (const heading of headings) {
    if (heading.level !== 2) continue;
    if (!(STORY_FOCUS_FIELDS as readonly string[]).includes(heading.text))
      continue;
    if (!focusHeadings.has(heading.text))
      focusHeadings.set(heading.text, heading);
  }

  const focusBlocks = STORY_FOCUS_FIELDS.map((field) => {
    const heading = focusHeadings.get(field);
    if (heading === undefined) return "";
    // The Chinese caption is interface text (R13); the source heading itself
    // still renders (demoted) so its own text and Locator are not dropped.
    const body = renderMarkdownHtml(
      bytes,
      heading.startOffset,
      boundedEnd(headings, heading),
      {
        headingLevelOffset: 4,
        headingAttributes: blockHeadingAttributes(
          heading,
          () => hiddenLocatorAttributes(lookup, storyPath, field),
          (nested) => locatorAttributes(lookup, storyPath, nested.headingPath),
        ),
      },
    );
    return `<section class="focus-field"><h4>${escapeHtml(
      STORY_FOCUS_LABELS[field] as string,
    )}</h4>${body}</section>`;
  }).join("");

  const focusHtml =
    focusHeadings.size === 0
      ? `<p class="muted">${MISSING_SECTION_TEXT}</p>`
      : focusBlocks;

  const appendixSections: AppendixSection[] = [];
  for (const heading of headings) {
    if (heading.level > 2) continue;
    if (focusHeadings.get(heading.text) === heading) continue;
    const html = renderMarkdownHtml(
      bytes,
      heading.startOffset,
      boundedEnd(headings, heading),
      {
        headingAttributes: (candidate) =>
          locatorAttributes(
            lookup,
            storyPath,
            STORY_FIXED_FIELDS.has(candidate.text) && candidate.level === 2
              ? candidate.text
              : candidate.headingPath,
          ),
      },
    );
    appendixSections.push({ path: storyPath, html });
  }

  return { focusHtml, appendixSections };
}

export interface AcceptanceContent {
  readonly acceptanceGroupsHtml: string;
  readonly appendixSections: readonly AppendixSection[];
}

const acceptanceCheckboxLinePattern = /^\[([ xX])] (AC-[0-9]+):/;

/** Splits one `acceptance.md` into its AC groups and the rest (contract §18). */
export function partitionAcceptanceDocument(
  storyId: string,
  acceptancePath: string,
  bytes: Uint8Array,
  lookup: LocatorLookup,
): AcceptanceContent {
  const lines = scanMarkdownLines(bytes);
  const headings = scanHeadingBlocks(bytes, lines);
  const checkboxLines = readAcceptanceCheckboxLines(lines);

  const consumed = new Set<HeadingBlock>();
  const groups: string[] = [];
  for (const heading of headings) {
    // Usually a `##` heading groups AC lines, but a short `acceptance.md`
    // may place them directly under its `#` title with no grouping heading.
    if (heading.level > 2) continue;
    const end = boundedEnd(headings, heading);
    const withinLines = checkboxLines.filter(
      (line) => line.start >= heading.startOffset && line.start < end,
    );
    if (withinLines.length === 0) continue;
    consumed.add(heading);
    const labels = withinLines.map((line) => `${storyId}/${line.id}`);
    const body = renderMarkdownHtml(bytes, heading.startOffset, end, {
      headingLevelOffset: 2,
      headingAttributes: (candidate) =>
        locatorAttributes(lookup, acceptancePath, candidate.headingPath),
      listItemAttributes: (line) => {
        const stripped =
          line.trimmed.startsWith("* ") || line.trimmed.startsWith("- ")
            ? line.trimmed.slice(2)
            : undefined;
        const match =
          stripped === undefined
            ? null
            : acceptanceCheckboxLinePattern.exec(stripped);
        if (match === null) return undefined;
        return locatorAttributes(lookup, acceptancePath, match[2] as string);
      },
    });
    groups.push(
      `<section class="acceptance-group">${injectLabels(body, labels)}</section>`,
    );
  }

  const acceptanceGroupsHtml =
    groups.length === 0
      ? `<p class="muted">${MISSING_SECTION_TEXT}</p>`
      : groups.join("");

  const appendixSections: AppendixSection[] = [];
  for (const heading of headings) {
    if (heading.level > 2) continue;
    if (consumed.has(heading)) continue;
    const html = renderMarkdownHtml(
      bytes,
      heading.startOffset,
      boundedEnd(headings, heading),
      {
        headingAttributes: (candidate) =>
          locatorAttributes(lookup, acceptancePath, candidate.headingPath),
      },
    );
    appendixSections.push({ path: acceptancePath, html });
  }

  return { acceptanceGroupsHtml, appendixSections };
}

/** An ADR's title and `Status` line text, as plain labels (contract §18 "決策約束"). */
export function adrSummary(bytes: Uint8Array): {
  readonly title: string;
  readonly status: string;
} {
  const text = new TextDecoder("utf-8").decode(bytes);
  const titleMatch = /^#\s+(.*)$/m.exec(text);
  const statusMatch = /^\*\s+Status:\s*(.*)$/m.exec(text);
  return {
    title: titleMatch?.[1]?.trim() ?? "",
    status: statusMatch?.[1]?.trim() ?? "",
  };
}

/** An ADR's full text for the appendix; the whole document is the placement unit (contract §18). */
export function renderAdrAppendix(
  path: string,
  bytes: Uint8Array,
  lookup: LocatorLookup,
): string {
  const lines = scanMarkdownLines(bytes);
  const headings = scanHeadingBlocks(bytes, lines);
  return renderMarkdownHtml(bytes, 0, bytes.length, {
    headingAttributes: (heading) => {
      const position = headings.findIndex(
        (candidate) => candidate.startOffset === heading.startOffset,
      );
      const anchor = adrExplicitId(heading, position) ?? heading.headingPath;
      return locatorAttributes(lookup, path, anchor);
    },
  });
}
