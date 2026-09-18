/**
 * The Spec document's placement partition (contract §18, Story TST-022 R11):
 * batch Goal/Non-goals, and for each entry its matrix Goal/Non-goals cells,
 * 需求驗收, and 需求細節, plus the Spec's leftover sections for the appendix.
 *
 * The document is scanned once (`scanMarkdownDocument`); every entry, heading,
 * and AC line is then found by Map lookup, binary search, or a walk over the
 * entry's own headings, never by rescanning the document per entry.
 */

import {
  acceptanceItemOptions,
  blockHeadingAttributes,
  hiddenLocatorAttributes,
  leadingAppendixSection,
  MISSING_SECTION_TEXT,
  type AcceptanceItemOptions,
  type AppendixSection,
} from "./render-source.js";
import {
  ENTRY_SECTION_LABELS,
  matchEntrySectionVocab,
  matchTopLevelVocab,
} from "./vocabulary.js";
import {
  renderMarkdownHtml,
  type MarkdownHtmlOptions,
} from "./markdown-html.js";
import {
  headingDisplayEnd,
  readSpecAcceptanceLines,
  readSpecEntryId,
  scanMarkdownDocument,
  type HeadingBlock,
  type MarkdownDocument,
  type MarkdownLineMatch,
} from "./markdown.js";
import {
  headingBlockLocatorAttributes,
  type LocatorLookup,
} from "./render-locators.js";
import type { SpecEntryIndex, SpecIndex } from "./types.js";

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
 * Renders one recognized vocabulary heading's own block, including the
 * heading itself (demoted, since the caller already labels the slot in
 * Chinese): the heading text is still verbatim source content (R11), and its
 * Locator has to attach to the element that carries it (R-005 second half).
 * `hideHeading` visually hides that heading when the caller's own caption
 * already names the same field (contract §18).
 */
function renderVocabBlock(
  document: MarkdownDocument,
  heading: HeadingBlock | undefined,
  path: string,
  anchor: string,
  lookup: LocatorLookup,
  entryId: string | undefined,
  hideHeading = false,
  acceptanceItems: AcceptanceItemOptions = {},
): string | undefined {
  if (heading === undefined) return undefined;
  return renderMarkdownHtml(
    document,
    heading.startOffset,
    headingDisplayEnd(document, heading),
    {
      ...acceptanceItems,
      headingLevelOffset: 4,
      headingAttributes: blockHeadingAttributes(
        heading,
        () =>
          hideHeading
            ? hiddenLocatorAttributes(
                lookup,
                path,
                anchor,
                document.bytes,
                heading,
              )
            : headingBlockLocatorAttributes(
                lookup,
                path,
                anchor,
                document.bytes,
                heading,
              ),
        (nested) =>
          headingBlockLocatorAttributes(
            lookup,
            path,
            specHeadingAnchor(nested, entryId),
            document.bytes,
            nested,
          ),
      ),
    },
  );
}

/** Strips a `parseList`-generated `<ul>…</ul>`/`<ol>…</ol>` wrapper, keeping only its `<li>`s. */
function unwrapListItems(html: string): string {
  return html.replace(/^<(ul|ol)>([\s\S]*)<\/\1>$/, "$2");
}

/** The first heading starting at or after `offset`, or `undefined`. */
function nextHeadingStart(
  document: MarkdownDocument,
  offset: number,
): number | undefined {
  let low = 0;
  let high = document.headings.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if ((document.headings[mid] as HeadingBlock).startOffset < offset)
      low = mid + 1;
    else high = mid;
  }
  return document.headings[low]?.startOffset;
}

interface EntryLayout {
  readonly heading: HeadingBlock;
  readonly subheadings: readonly HeadingBlock[];
  readonly goal: HeadingBlock | undefined;
  readonly nonGoals: HeadingBlock | undefined;
  readonly acceptance: HeadingBlock | undefined;
  /** The entry's AC lines the index recognized (unique ids only), keyed by line start. */
  readonly acceptanceItems: AcceptanceItemOptions;
  /**
   * AC items moved into 需求驗收 because the entry has no Acceptance heading,
   * each as its full list-item extent `[start, end)`, in source order.
   */
  readonly movedItems: readonly {
    readonly start: number;
    readonly end: number;
  }[];
}

function withinHeadingBlock(
  document: MarkdownDocument,
  heading: HeadingBlock | undefined,
  offset: number,
): boolean {
  return (
    heading !== undefined &&
    offset >= heading.startOffset &&
    offset < headingDisplayEnd(document, heading)
  );
}

/**
 * Where every AC line of one Spec entry renders — exactly once each
 * (contract §18, AC-004):
 *
 * 1. An AC inside the entry's `Goal` or `Non-goals` block belongs to that
 *    vocabulary block and renders there, in the matrix cell.
 * 2. With an `Acceptance` heading, every other AC also stays where it sits:
 *    in the Acceptance block (需求驗收) or wherever else in the entry it was
 *    written (需求細節).
 * 3. Without one, every other AC is moved into 需求驗收 as its full
 *    list-item extent (sub-bullets and continuation lines included) and that
 *    same extent is omitted from 需求細節. An AC nested inside an already
 *    moved AC travels with it; an AC whose extent would carry a heading
 *    stays in place, since that heading renders in its own block.
 *
 * Wherever it renders, a recognized AC carries its `R-NNN/AC-NNN` label and
 * locator, so the matrix count equals the labelled items for the entry.
 */
function layoutEntry(
  document: MarkdownDocument,
  lookup: LocatorLookup,
  specPath: string,
  entry: SpecEntryIndex,
  headingIndex: number,
): EntryLayout {
  const heading = document.headings[headingIndex] as HeadingBlock;
  const entryEnd = heading.endOffset;

  // Entry blocks never overlap, so walking each entry's own headings visits
  // every heading of the document at most once in total.
  const subheadings: HeadingBlock[] = [];
  for (
    let index = headingIndex + 1;
    index < document.headings.length &&
    (document.headings[index] as HeadingBlock).startOffset < entryEnd;
    index += 1
  ) {
    const candidate = document.headings[index] as HeadingBlock;
    if (candidate.level === 3) subheadings.push(candidate);
  }
  const firstOf = (key: string) =>
    subheadings.find(
      (candidate) => matchEntrySectionVocab(candidate.text) === key,
    );
  const goal = firstOf("goal");
  const nonGoals = firstOf("nonGoals");
  const acceptance = firstOf("acceptance");

  // The same line reader the index used, bounded to this entry; an id seen
  // more than once is unresolved there (REVIEW_ANCHOR_DUPLICATE), so it gets
  // no label here either.
  const recognized = new Set(entry.acceptance.map((item) => item.id));
  const lines = readSpecAcceptanceLines(
    document.lines,
    heading.startOffset,
    entryEnd,
  );
  const occurrences = new Map<string, number>();
  for (const line of lines)
    occurrences.set(line.id, (occurrences.get(line.id) ?? 0) + 1);
  const itemsByStart = new Map<
    number,
    {
      readonly match: MarkdownLineMatch;
      readonly anchor: string;
      readonly label: string;
    }
  >();
  for (const line of lines) {
    if (occurrences.get(line.id) !== 1 || !recognized.has(line.id)) continue;
    const anchor = `${entry.id}/${line.id}`;
    itemsByStart.set(line.start, { match: line, anchor, label: anchor });
  }

  const movedItems: { start: number; end: number }[] = [];
  if (acceptance === undefined) {
    let coveredUntil = -1;
    for (const line of lines) {
      if (!itemsByStart.has(line.start)) continue;
      if (line.start < coveredUntil) continue;
      if (
        withinHeadingBlock(document, goal, line.start) ||
        withinHeadingBlock(document, nonGoals, line.start)
      )
        continue;
      const end = document.listItemEndByStart.get(line.start) ?? line.end;
      const headingAfter = nextHeadingStart(document, line.start + 1);
      if (headingAfter !== undefined && headingAfter < end) continue;
      movedItems.push({ start: line.start, end });
      coveredUntil = end;
    }
  }

  return {
    heading,
    subheadings,
    goal,
    nonGoals,
    acceptance,
    acceptanceItems: acceptanceItemOptions(
      lookup,
      specPath,
      document.bytes,
      itemsByStart,
    ),
    movedItems,
  };
}

function renderEntryAcceptance(
  specPath: string,
  entryId: string,
  layout: EntryLayout,
  document: MarkdownDocument,
  lookup: LocatorLookup,
): string {
  // An Acceptance block always renders, even when none of its lines is a
  // recognized AC (none written, or only duplicated ids): it is consumed
  // from 需求細節, so this is its only placement.
  const acceptanceHeading = layout.acceptance;
  if (acceptanceHeading === undefined) {
    if (layout.movedItems.length === 0)
      return `<p class="muted">${MISSING_SECTION_TEXT}</p>`;
    return `<ul>${layout.movedItems
      .map((item) =>
        unwrapListItems(
          renderMarkdownHtml(document, item.start, item.end, {
            ...layout.acceptanceItems,
          }),
        ),
      )
      .join("")}</ul>`;
  }
  return renderMarkdownHtml(
    document,
    acceptanceHeading.startOffset,
    headingDisplayEnd(document, acceptanceHeading),
    {
      ...layout.acceptanceItems,
      headingLevelOffset: 4,
      headingAttributes: blockHeadingAttributes(
        acceptanceHeading,
        () =>
          hiddenLocatorAttributes(
            lookup,
            specPath,
            `${entryId}/Acceptance`,
            document.bytes,
            acceptanceHeading,
          ),
        (nested) =>
          headingBlockLocatorAttributes(
            lookup,
            specPath,
            specHeadingAnchor(nested, entryId),
            document.bytes,
            nested,
          ),
      ),
    },
  );
}

function renderEntryDetail(
  specPath: string,
  entryId: string,
  layout: EntryLayout,
  document: MarkdownDocument,
  lookup: LocatorLookup,
): string {
  const headingAttributes = (heading: HeadingBlock) =>
    headingBlockLocatorAttributes(
      lookup,
      specPath,
      specHeadingAnchor(heading, entryId),
      document.bytes,
      heading,
    );
  const moved = new Set(layout.movedItems.map((item) => item.start));
  const options: MarkdownHtmlOptions = {
    ...layout.acceptanceItems,
    headingLevelOffset: 4,
    headingAttributes,
    omitListItem: (line) => moved.has(line.start),
  };
  const consumed = new Set(
    [layout.goal, layout.nonGoals, layout.acceptance].filter(
      (heading): heading is HeadingBlock => heading !== undefined,
    ),
  );

  // The front chunk (entry heading line + preamble) ends at the first
  // subheading of any kind, consumed or not — a subheading consumed
  // elsewhere (Goal/Acceptance/Non-goals) must never bleed into this span.
  const frontEnd =
    layout.subheadings[0]?.startOffset ?? layout.heading.endOffset;
  const blocks = [
    renderMarkdownHtml(document, layout.heading.startOffset, frontEnd, options),
  ];
  for (const heading of layout.subheadings) {
    if (consumed.has(heading)) continue;
    blocks.push(
      renderMarkdownHtml(
        document,
        heading.startOffset,
        headingDisplayEnd(document, heading),
        options,
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
  const document = scanMarkdownDocument(bytes);
  const headings = document.headings;

  // One pass over the headings: the first Spec-level Goal/Non-goals heading
  // and the first heading of each entry id, so no per-entry lookup scans.
  let goalHeading: HeadingBlock | undefined;
  let nonGoalsHeading: HeadingBlock | undefined;
  const entryHeadingIndexById = new Map<string, number>();
  headings.forEach((heading, index) => {
    if (heading.level !== 2) return;
    const id = readSpecEntryId(heading);
    if (id !== undefined) {
      if (!entryHeadingIndexById.has(id)) entryHeadingIndexById.set(id, index);
      return;
    }
    const vocab = matchTopLevelVocab(heading.text);
    if (vocab === "goal") goalHeading ??= heading;
    if (vocab === "nonGoals") nonGoalsHeading ??= heading;
  });

  const missing = `<p class="muted">${MISSING_SECTION_TEXT}</p>`;
  const entries = new Map<string, SpecEntryContent>();
  const consumedTopLevel = new Set<HeadingBlock>();
  for (const entry of spec.entries) {
    const headingIndex = entryHeadingIndexById.get(entry.id);
    if (headingIndex === undefined) {
      entries.set(entry.id, {
        goalCellHtml: missing,
        nonGoalsCellHtml: missing,
        acceptanceHtml: missing,
        detailHtml: "",
      });
      continue;
    }
    const layout = layoutEntry(
      document,
      lookup,
      spec.path,
      entry,
      headingIndex,
    );
    consumedTopLevel.add(layout.heading);

    entries.set(entry.id, {
      goalCellHtml:
        renderVocabBlock(
          document,
          layout.goal,
          spec.path,
          `${entry.id}/Goal`,
          lookup,
          entry.id,
          true,
          layout.acceptanceItems,
        ) ?? missing,
      nonGoalsCellHtml:
        renderVocabBlock(
          document,
          layout.nonGoals,
          spec.path,
          `${entry.id}/Non-goals`,
          lookup,
          entry.id,
          true,
          layout.acceptanceItems,
        ) ?? missing,
      acceptanceHtml: renderEntryAcceptance(
        spec.path,
        entry.id,
        layout,
        document,
        lookup,
      ),
      detailHtml: renderEntryDetail(
        spec.path,
        entry.id,
        layout,
        document,
        lookup,
      ),
    });
  }

  if (goalHeading !== undefined) consumedTopLevel.add(goalHeading);
  if (nonGoalsHeading !== undefined) consumedTopLevel.add(nonGoalsHeading);
  const appendixHeadingAttributes = (candidate: HeadingBlock) =>
    headingBlockLocatorAttributes(
      lookup,
      spec.path,
      specHeadingAnchor(candidate, undefined),
      document.bytes,
      candidate,
    );
  const appendixSections: AppendixSection[] = [];
  const leading = leadingAppendixSection(
    document,
    spec.path,
    appendixHeadingAttributes,
  );
  if (leading !== undefined) appendixSections.push(leading);
  for (const heading of headings) {
    if (heading.level > 2) continue;
    if (consumedTopLevel.has(heading)) continue;
    const html = renderMarkdownHtml(
      document,
      heading.startOffset,
      headingDisplayEnd(document, heading),
      { headingLevelOffset: 3, headingAttributes: appendixHeadingAttributes },
    );
    appendixSections.push({ path: spec.path, html });
  }

  return {
    goalHtml: renderVocabBlock(
      document,
      goalHeading,
      spec.path,
      "Goal",
      lookup,
      undefined,
    ),
    nonGoalsHtml: renderVocabBlock(
      document,
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
