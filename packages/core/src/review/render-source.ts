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

import { escapeHtml } from "./html.js";
import {
  adrExplicitId,
  ENTRY_SECTION_LABELS,
  matchEntrySectionVocab,
  matchTopLevelVocab,
  STORY_FIXED_FIELDS,
} from "./vocabulary.js";
import {
  renderMarkdownHtml,
  scanMarkdownDocument,
  type MarkdownDocument,
} from "./markdown-html.js";
import {
  readAcceptanceCheckboxLines,
  readSpecAcceptanceLines,
  readSpecEntryId,
  type HeadingBlock,
} from "./markdown.js";
import {
  headingBlockLocatorAttributes,
  locatorAttributes,
  type LocatorLookup,
} from "./render-locators.js";
import type { SpecAcceptanceEntry, SpecIndex } from "./types.js";

export { escapeHtml } from "./html.js";

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

/**
 * The document's own leading text, before its first heading (any level or
 * none at all counts as "no leading text"). Contract §18 places every source
 * block somewhere in the projection; a document can carry prose above its
 * first heading that no heading-anchored partition ever reaches, so this
 * span is appended to that document's own appendix group.
 */
function leadingAppendixSection(
  document: MarkdownDocument,
  path: string,
): AppendixSection | undefined {
  const firstStart = document.headings[0]?.startOffset;
  if (firstStart === undefined || firstStart === 0) return undefined;
  return { path, html: renderMarkdownHtml(document, 0, firstStart) };
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

const specAcceptanceLinePattern = /^[-*]\s+AC-(\d+)[：:]/;

/**
 * Same as `headingBlockLocatorAttributes`, but visually hides the element.
 * Used where the caller already shows an equivalent Chinese caption for this
 * vocabulary heading, so the source heading stays in the DOM (locator,
 * accessibility tree) without displaying the same label a second time on
 * screen or print.
 */
function hiddenLocatorAttributes(
  lookup: LocatorLookup,
  path: string,
  anchor: string,
  bytes: Uint8Array,
  heading: HeadingBlock,
): Record<string, string> | undefined {
  const attributes = headingBlockLocatorAttributes(
    lookup,
    path,
    anchor,
    bytes,
    heading,
  );
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
  document: MarkdownDocument,
  heading: HeadingBlock | undefined,
  path: string,
  anchor: string,
  lookup: LocatorLookup,
  entryId: string | undefined,
  hideHeading = false,
): string | undefined {
  if (heading === undefined) return undefined;
  return renderMarkdownHtml(
    document,
    heading.startOffset,
    boundedEnd(document.headings, heading),
    {
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

function renderEntryAcceptance(
  specPath: string,
  entryId: string,
  acceptance: readonly SpecAcceptanceEntry[],
  acceptanceHeading: HeadingBlock | undefined,
  entryHeading: HeadingBlock,
  entryEnd: number,
  document: MarkdownDocument,
  lookup: LocatorLookup,
): string {
  if (acceptance.length === 0)
    return `<p class="muted">${MISSING_SECTION_TEXT}</p>`;
  if (acceptanceHeading === undefined) {
    // No dedicated Acceptance heading recognized; the AC lines are still
    // indexed (§5 scans the whole entry, each AC's own block is its own
    // line), so each is rendered here from its own line, verbatim, as its
    // own list — the same lines 需求細節 must then skip (contract §18).
    const byId = new Map(
      readSpecAcceptanceLines(
        document.lines,
        entryHeading.startOffset,
        entryEnd,
      ).map((line) => [line.id, line] as const),
    );
    return `<ul>${acceptance
      .map((item) => {
        const line = byId.get(item.id);
        if (line === undefined) return "";
        return unwrapListItems(
          renderMarkdownHtml(document, line.start, line.end, {
            listItemAttributes: () =>
              locatorAttributes(lookup, specPath, item.locator.anchor),
            listItemPrefix: () => item.locator.anchor,
          }),
        );
      })
      .join("")}</ul>`;
  }
  return renderMarkdownHtml(
    document,
    acceptanceHeading.startOffset,
    boundedEnd(document.headings, acceptanceHeading),
    {
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
      listItemAttributes: (line) => {
        const match = specAcceptanceLinePattern.exec(line.trimmed);
        if (match === null) return undefined;
        return locatorAttributes(lookup, specPath, `${entryId}/AC-${match[1]}`);
      },
      // Computed from the same line `listItemAttributes` just matched, so a
      // non-AC bullet, a nested sub-bullet, or an out-of-order AC id can
      // never shift which `<li>` a label lands on (contract §18).
      listItemPrefix: (line) => {
        const match = specAcceptanceLinePattern.exec(line.trimmed);
        return match === null ? undefined : `${entryId}/AC-${match[1]}`;
      },
    },
  );
}

function renderEntryDetail(
  specPath: string,
  entryId: string,
  entryHeading: HeadingBlock,
  entryEnd: number,
  subheadings: readonly HeadingBlock[],
  kept: ReadonlySet<HeadingBlock>,
  document: MarkdownDocument,
  lookup: LocatorLookup,
  /**
   * True when the entry has no dedicated Acceptance heading: its AC lines
   * are labelled directly in 需求驗收 (`renderEntryAcceptance`), so this
   * function must omit exactly those lines rather than render them a second
   * time (contract §18: every source block renders exactly once).
   */
  omitAcceptanceLines: boolean,
): string {
  const headingAttributes = (heading: HeadingBlock) =>
    headingBlockLocatorAttributes(
      lookup,
      specPath,
      specHeadingAnchor(heading, entryId),
      document.bytes,
      heading,
    );
  const omitListItem = (line: { readonly trimmed: string }): boolean =>
    omitAcceptanceLines && specAcceptanceLinePattern.test(line.trimmed);

  // The front chunk (entry heading line + preamble) ends at the first
  // subheading of any kind, consumed or not — a subheading consumed
  // elsewhere (Goal/Acceptance/Non-goals) must never bleed into this span.
  const frontEnd = subheadings[0]?.startOffset ?? entryEnd;
  const blocks = [
    renderMarkdownHtml(document, entryHeading.startOffset, frontEnd, {
      headingLevelOffset: 4,
      headingAttributes,
      omitListItem,
    }),
  ];
  for (const heading of subheadings) {
    if (!kept.has(heading)) continue;
    blocks.push(
      renderMarkdownHtml(
        document,
        heading.startOffset,
        boundedEnd(document.headings, heading),
        {
          headingLevelOffset: 4,
          headingAttributes,
          omitListItem,
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
  const document = scanMarkdownDocument(bytes);
  const headings = document.headings;

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
          document,
          entryGoal,
          spec.path,
          `${entry.id}/Goal`,
          lookup,
          entry.id,
          true,
        ) ?? `<p class="muted">${MISSING_SECTION_TEXT}</p>`,
      nonGoalsCellHtml:
        renderVocabBlock(
          document,
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
        entryHeading,
        entryEnd,
        document,
        lookup,
      ),
      detailHtml: renderEntryDetail(
        spec.path,
        entry.id,
        entryHeading,
        entryEnd,
        subheadings,
        kept,
        document,
        lookup,
        entryAcceptance === undefined,
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
  const leading = leadingAppendixSection(document, spec.path);
  if (leading !== undefined) appendixSections.push(leading);
  for (const heading of headings) {
    if (heading.level > 2) continue;
    if (consumedTopLevel.has(heading)) continue;
    const html = renderMarkdownHtml(
      document,
      heading.startOffset,
      boundedEnd(headings, heading),
      {
        headingLevelOffset: 3,
        headingAttributes: (candidate) =>
          headingBlockLocatorAttributes(
            lookup,
            spec.path,
            specHeadingAnchor(candidate, undefined),
            document.bytes,
            candidate,
          ),
      },
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
  const document = scanMarkdownDocument(bytes);
  const headings = document.headings;

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
      document,
      heading.startOffset,
      boundedEnd(headings, heading),
      {
        headingLevelOffset: 4,
        headingAttributes: blockHeadingAttributes(
          heading,
          () =>
            hiddenLocatorAttributes(
              lookup,
              storyPath,
              field,
              document.bytes,
              heading,
            ),
          (nested) =>
            headingBlockLocatorAttributes(
              lookup,
              storyPath,
              nested.headingPath,
              document.bytes,
              nested,
            ),
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
  const leading = leadingAppendixSection(document, storyPath);
  if (leading !== undefined) appendixSections.push(leading);
  for (const heading of headings) {
    if (heading.level > 2) continue;
    if (focusHeadings.get(heading.text) === heading) continue;
    const html = renderMarkdownHtml(
      document,
      heading.startOffset,
      boundedEnd(headings, heading),
      {
        headingLevelOffset: 3,
        headingAttributes: (candidate) =>
          headingBlockLocatorAttributes(
            lookup,
            storyPath,
            STORY_FIXED_FIELDS.has(candidate.text) && candidate.level === 2
              ? candidate.text
              : candidate.headingPath,
            document.bytes,
            candidate,
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
  storyId: string | undefined,
  acceptancePath: string,
  bytes: Uint8Array,
  lookup: LocatorLookup,
): AcceptanceContent {
  const document = scanMarkdownDocument(bytes);
  const headings = document.headings;
  const checkboxLines = readAcceptanceCheckboxLines(document.lines);

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
    const stripBullet = (trimmed: string): string | undefined =>
      trimmed.startsWith("* ") || trimmed.startsWith("- ")
        ? trimmed.slice(2)
        : undefined;
    const body = renderMarkdownHtml(document, heading.startOffset, end, {
      headingLevelOffset: 2,
      headingAttributes: (candidate) =>
        headingBlockLocatorAttributes(
          lookup,
          acceptancePath,
          candidate.headingPath,
          document.bytes,
          candidate,
        ),
      listItemAttributes: (line) => {
        const stripped = stripBullet(line.trimmed);
        const match =
          stripped === undefined
            ? null
            : acceptanceCheckboxLinePattern.exec(stripped);
        if (match === null) return undefined;
        return locatorAttributes(lookup, acceptancePath, match[2] as string);
      },
      // Computed from the same line `listItemAttributes` just matched, so
      // the label always names its own `<li>` (contract §18).
      listItemPrefix: (line) => {
        const stripped = stripBullet(line.trimmed);
        const match =
          stripped === undefined
            ? null
            : acceptanceCheckboxLinePattern.exec(stripped);
        if (match === null) return undefined;
        return storyId === undefined
          ? (match[2] as string)
          : `${storyId}/${match[2]}`;
      },
    });
    groups.push(`<section class="acceptance-group">${body}</section>`);
  }

  const acceptanceGroupsHtml =
    groups.length === 0
      ? `<p class="muted">${MISSING_SECTION_TEXT}</p>`
      : groups.join("");

  const appendixSections: AppendixSection[] = [];
  const leading = leadingAppendixSection(document, acceptancePath);
  if (leading !== undefined) appendixSections.push(leading);
  for (const heading of headings) {
    if (heading.level > 2) continue;
    if (consumed.has(heading)) continue;
    const html = renderMarkdownHtml(
      document,
      heading.startOffset,
      boundedEnd(headings, heading),
      {
        headingLevelOffset: 3,
        headingAttributes: (candidate) =>
          headingBlockLocatorAttributes(
            lookup,
            acceptancePath,
            candidate.headingPath,
            document.bytes,
            candidate,
          ),
      },
    );
    appendixSections.push({ path: acceptancePath, html });
  }

  return { acceptanceGroupsHtml, appendixSections };
}

/**
 * A document's first `#` heading text, verbatim (contract §18: a Story's
 * displayed title and an ADR's own title both come from this same line).
 * `undefined` when the document has no top-level heading at all.
 */
export function firstH1Text(bytes: Uint8Array): string | undefined {
  const text = new TextDecoder("utf-8").decode(bytes);
  return /^#\s+(.*)$/m.exec(text)?.[1]?.trim();
}

/** An ADR's title and `Status` line text, as plain labels (contract §18 "決策約束"). */
export function adrSummary(bytes: Uint8Array): {
  readonly title: string;
  readonly status: string;
} {
  const text = new TextDecoder("utf-8").decode(bytes);
  const statusMatch = /^\*\s+Status:\s*(.*)$/m.exec(text);
  return {
    title: firstH1Text(bytes) ?? "",
    status: statusMatch?.[1]?.trim() ?? "",
  };
}

/** An ADR's full text for the appendix; the whole document is the placement unit (contract §18). */
export function renderAdrAppendix(
  path: string,
  bytes: Uint8Array,
  lookup: LocatorLookup,
): string {
  const document = scanMarkdownDocument(bytes);
  const position = new Map(
    document.headings.map((heading, index) => [heading.startOffset, index]),
  );
  return renderMarkdownHtml(document, 0, bytes.length, {
    headingLevelOffset: 3,
    headingAttributes: (heading) => {
      const anchor =
        adrExplicitId(heading, position.get(heading.startOffset) ?? -1) ??
        heading.headingPath;
      return headingBlockLocatorAttributes(
        lookup,
        path,
        anchor,
        document.bytes,
        heading,
      );
    },
  });
}
