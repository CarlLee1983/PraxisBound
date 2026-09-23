/**
 * Per-document placement partition (contract §18, Story TST-022 R11).
 *
 * Splits one already-read document's bytes into the exact placement units
 * the projection page needs: a Story's focus fields, an acceptance file's AC
 * groups, an ADR's full text, and each document's leftover sections for the
 * appendix, plus the helpers the Spec partition (`render-spec.ts`) shares. Every function here recomputes byte ranges from
 * the shared scanner (`markdown.ts`) using the same recognition rules
 * `index.ts` used to build the `Locator`s it looks up — the Locator itself
 * carries no byte offset, so this is the only place that reconstructs one.
 * Pure: no I/O, only the bytes and index facts the caller already holds.
 */

import { sha256Hex } from "./fingerprint.js";
import { escapeHtml } from "./html.js";
import { escapeEvidenceField, escapeEvidenceProse } from "./render-evidence.js";
import { elementId } from "./render-locators.js";
import { adrExplicitId, STORY_FIXED_FIELDS } from "./vocabulary.js";
import {
  renderMarkdownHtml,
  type MarkdownHtmlOptions,
} from "./markdown-html.js";
import {
  headingDisplayEnd,
  lowerBoundByStart,
  readAcceptanceCheckboxLines,
  scanMarkdownDocument,
  type HeadingBlock,
  type MarkdownDocument,
  type MarkdownLine,
  type MarkdownLineMatch,
} from "./markdown.js";
import {
  blockLocatorAttributes,
  headingBlockLocatorAttributes,
  type LocatorLookup,
} from "./render-locators.js";

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
 * Everything before the document's first `#` or `##` heading — or the whole
 * document when it has none. Contract §18 places every source block
 * somewhere in the projection, but every other placement unit starts at a
 * `#`/`##` heading, so prose and deeper headings above the first one (or a
 * document with no such heading at all) would otherwise never render. This
 * span is appended to that document's own appendix group; a heading inside
 * it still carries its own locator.
 */
export function leadingAppendixSection(
  document: MarkdownDocument,
  path: string,
  headingAttributes: (
    heading: HeadingBlock,
  ) => Record<string, string> | undefined,
): AppendixSection | undefined {
  const firstTopLevel = document.headings.find((heading) => heading.level <= 2);
  const end = firstTopLevel?.startOffset ?? document.bytes.length;
  if (end === 0) return undefined;
  const html = renderMarkdownHtml(document, 0, end, {
    headingLevelOffset: 3,
    headingAttributes,
  });
  return html === "" ? undefined : { path, html };
}

/**
 * Heading attributes for one rendered block: the block's own heading gets
 * `own`; any heading nested inside it keeps the locator the index assigned to
 * that nested heading, and stays visible (R11, AC-005).
 */
export function blockHeadingAttributes(
  block: HeadingBlock,
  own: () => Record<string, string> | undefined,
  nested: (heading: HeadingBlock) => Record<string, string> | undefined,
): (heading: HeadingBlock) => Record<string, string> | undefined {
  return (heading) =>
    heading.startOffset === block.startOffset ? own() : nested(heading);
}

/**
 * Same as `headingBlockLocatorAttributes`, but visually hides the element.
 * Used where the caller already shows an equivalent Chinese caption for this
 * vocabulary heading, so the source heading stays in the DOM (locator,
 * accessibility tree) without displaying the same label a second time on
 * screen or print.
 */
export function hiddenLocatorAttributes(
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

/** The list-item label and locator options for AC lines; empty when there are none. */
export type AcceptanceItemOptions = Pick<
  MarkdownHtmlOptions,
  "listItemAttributes" | "listItemPrefix"
>;

/**
 * Label and locator options for a set of AC lines keyed by their `start`.
 * The label is shown only on an item that also gets its locator, both
 * derived from the same line, so a non-AC bullet, a nested sub-bullet, an
 * out-of-order or duplicated id can never shift or fake a label (contract
 * §18). Attributes are computed once per line and reused by both callbacks.
 */
export function acceptanceItemOptions(
  lookup: LocatorLookup,
  path: string,
  bytes: Uint8Array,
  itemsByStart: ReadonlyMap<
    number,
    {
      readonly match: MarkdownLineMatch;
      readonly anchor: string;
      readonly label: string;
    }
  >,
): AcceptanceItemOptions {
  const attributesByStart = new Map<
    number,
    Record<string, string> | undefined
  >();
  const attributesFor = (line: MarkdownLine) => {
    const item = itemsByStart.get(line.start);
    if (item === undefined) return undefined;
    if (!attributesByStart.has(line.start))
      attributesByStart.set(
        line.start,
        blockLocatorAttributes(
          lookup,
          path,
          item.anchor,
          bytes,
          item.match.start,
          item.match.end,
        ),
      );
    return attributesByStart.get(line.start);
  };
  return {
    listItemAttributes: attributesFor,
    listItemPrefix: (line) =>
      attributesFor(line) === undefined
        ? undefined
        : itemsByStart.get(line.start)?.label,
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
      headingDisplayEnd(document, heading),
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

  const appendixHeadingAttributes = (candidate: HeadingBlock) =>
    headingBlockLocatorAttributes(
      lookup,
      storyPath,
      STORY_FIXED_FIELDS.has(candidate.text) && candidate.level === 2
        ? candidate.text
        : candidate.headingPath,
      document.bytes,
      candidate,
    );
  const appendixSections: AppendixSection[] = [];
  const leading = leadingAppendixSection(
    document,
    storyPath,
    appendixHeadingAttributes,
  );
  if (leading !== undefined) appendixSections.push(leading);
  for (const heading of headings) {
    if (heading.level > 2) continue;
    if (focusHeadings.get(heading.text) === heading) continue;
    const html = renderMarkdownHtml(
      document,
      heading.startOffset,
      headingDisplayEnd(document, heading),
      { headingLevelOffset: 3, headingAttributes: appendixHeadingAttributes },
    );
    appendixSections.push({ path: storyPath, html });
  }

  return { focusHtml, appendixSections };
}

export interface AcceptanceContent {
  readonly acceptanceGroupsHtml: string;
  readonly appendixSections: readonly AppendixSection[];
}

/** Splits one `acceptance.md` into its AC groups and the rest (contract §18). */
export function partitionAcceptanceDocument(
  storyId: string | undefined,
  acceptancePath: string,
  bytes: Uint8Array,
  lookup: LocatorLookup,
): AcceptanceContent {
  const document = scanMarkdownDocument(bytes);
  const headings = document.headings;
  // The same checkbox reader the index used; ascending by `start`, so each
  // heading below finds whether it holds one by binary search.
  const checkboxLines = readAcceptanceCheckboxLines(document.lines);
  const acceptanceItems = acceptanceItemOptions(
    lookup,
    acceptancePath,
    document.bytes,
    new Map(
      checkboxLines.map((line) => [
        line.start,
        {
          match: line,
          anchor: line.id,
          label: storyId === undefined ? line.id : `${storyId}/${line.id}`,
        },
      ]),
    ),
  );

  const consumed = new Set<HeadingBlock>();
  const groups: string[] = [];
  for (const heading of headings) {
    // Usually a `##` heading groups AC lines, but a short `acceptance.md`
    // may place them directly under its `#` title with no grouping heading.
    if (heading.level > 2) continue;
    const end = headingDisplayEnd(document, heading);
    const first =
      checkboxLines[lowerBoundByStart(checkboxLines, heading.startOffset)];
    if (first === undefined || first.start >= end) continue;
    consumed.add(heading);
    const body = renderMarkdownHtml(document, heading.startOffset, end, {
      ...acceptanceItems,
      headingLevelOffset: 2,
      headingAttributes: (candidate) =>
        headingBlockLocatorAttributes(
          lookup,
          acceptancePath,
          candidate.headingPath,
          document.bytes,
          candidate,
        ),
    });
    groups.push(`<section class="acceptance-group">${body}</section>`);
  }

  const acceptanceGroupsHtml =
    groups.length === 0
      ? `<p class="muted">${MISSING_SECTION_TEXT}</p>`
      : groups.join("");

  const appendixHeadingAttributes = (candidate: HeadingBlock) =>
    headingBlockLocatorAttributes(
      lookup,
      acceptancePath,
      candidate.headingPath,
      document.bytes,
      candidate,
    );
  const appendixSections: AppendixSection[] = [];
  const leading = leadingAppendixSection(
    document,
    acceptancePath,
    appendixHeadingAttributes,
  );
  if (leading !== undefined) appendixSections.push(leading);
  for (const heading of headings) {
    if (heading.level > 2) continue;
    if (consumed.has(heading)) continue;
    const html = renderMarkdownHtml(
      document,
      heading.startOffset,
      headingDisplayEnd(document, heading),
      { headingLevelOffset: 3, headingAttributes: appendixHeadingAttributes },
    );
    appendixSections.push({ path: acceptancePath, html });
  }

  return { acceptanceGroupsHtml, appendixSections };
}

/**
 * A present Readiness Sidecar's block (Story TST-030, contract §21): its raw
 * bytes decoded and HTML-escaped as plain text, never parsed as Markdown or
 * re-serialized — the projection shows exactly the bytes the fingerprint
 * covers. `id`/`data-*` use the same `#document` anchor and whole-file
 * digest contract §5 rule 3 and `matchRevisionTarget` already recognize for
 * any batch source, so a Revision Request can target this block without any
 * extra Locator bookkeeping.
 */
export function renderReadinessSidecarHtml(
  path: string,
  bytes: Uint8Array,
): string {
  const text = new TextDecoder("utf-8").decode(bytes);
  const blockSha256 = sha256Hex(bytes);
  const id = elementId(path, `#document ${blockSha256}`);
  // HIGH-2: HTML-escaping alone leaves a raw bidi/hidden code point in the
  // text node; `escapeEvidenceProse` (shared with the evidence area,
  // `render-evidence.ts`) also visibly escapes every code point
  // `isHiddenOrReorderingCodePoint` names, while keeping literal newlines so
  // the pretty-printed JSON still reads as JSON. `escapeEvidenceField` gives
  // the same protection for the one-line path label.
  return (
    `<section class="readiness-sidecar" id="${id}" data-path="${escapeEvidenceField(path)}" data-anchor="#document" data-block-sha256="${blockSha256}">` +
    `<h4>Readiness Sidecar <span class="doc-path">${escapeEvidenceField(path)}</span></h4>` +
    `<pre class="raw-source"><code>${escapeEvidenceProse(text)}</code></pre>` +
    `</section>`
  );
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
