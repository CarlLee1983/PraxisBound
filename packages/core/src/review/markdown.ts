/**
 * The Markdown subset the review index reads: headings, fences, Spec entries,
 * Spec acceptance lines, Story acceptance IDs, and Dependencies prose.
 *
 * Operates on raw bytes so every `blockSha256` hashes the exact source bytes,
 * never a re-encoded string. UTF-8 continuation bytes are always `>= 0x80`,
 * so splitting on the `\n` byte never cuts a multi-byte code point.
 */

import { trimDeclarationText } from "../declarations.js";
import { isStoryId } from "../story-id.js";

export interface MarkdownLine {
  readonly start: number;
  /** Exclusive end: the next line's start, or the file length. */
  readonly end: number;
  /** The line's own bytes, excluding its trailing `\n` (and any `\r` it carries). */
  readonly text: string;
  readonly trimmed: string;
  readonly fenced: boolean;
  /**
   * Set only on a fence's own opener or closer line, as the scanner decided
   * it: the marker character and run length that opened the fence. Every
   * other fenced line is fence body, whatever it looks like (a shorter or
   * different-character marker inside a fence is content, not a boundary).
   */
  readonly fence: FenceMarker | undefined;
}

export interface FenceMarker {
  readonly role: "open" | "close";
  readonly character: string;
  readonly length: number;
}

/**
 * Splits raw bytes into decoded lines, marking every line inside a fence. A
 * trailing final `\n` ends the last line; it never manufactures a further,
 * empty line after it.
 */
export function scanMarkdownLines(bytes: Uint8Array): readonly MarkdownLine[] {
  const decoder = new TextDecoder("utf-8");
  const lines: MarkdownLine[] = [];
  let fenceCharacter = "";
  let fenceLength = 0;

  const emit = (start: number, rawEnd: number, end: number): void => {
    const text = decoder.decode(bytes.subarray(start, rawEnd));
    const trimmed = trimDeclarationText(text);

    if (fenceLength === 0) {
      const character = trimmed.startsWith("`")
        ? "`"
        : trimmed.startsWith("~")
          ? "~"
          : "";
      if (character !== "") {
        let run = 0;
        while (trimmed[run] === character) run += 1;
        if (run >= 3) {
          fenceCharacter = character;
          fenceLength = run;
          const fence: FenceMarker = { role: "open", character, length: run };
          lines.push({ start, end, text, trimmed, fenced: true, fence });
          return;
        }
      }
      lines.push({
        start,
        end,
        text,
        trimmed,
        fenced: false,
        fence: undefined,
      });
      return;
    }

    if (trimmed.startsWith(fenceCharacter)) {
      let run = 0;
      while (trimmed[run] === fenceCharacter) run += 1;
      if (run >= fenceLength && trimmed.length === run) {
        const fence: FenceMarker = {
          role: "close",
          character: fenceCharacter,
          length: fenceLength,
        };
        fenceLength = 0;
        lines.push({ start, end, text, trimmed, fenced: true, fence });
        return;
      }
    }
    lines.push({ start, end, text, trimmed, fenced: true, fence: undefined });
  };

  let lineStart = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] === 0x0a) {
      emit(lineStart, index, index + 1);
      lineStart = index + 1;
    }
  }
  if (lineStart < bytes.length) {
    emit(lineStart, bytes.length, bytes.length);
  }

  return lines;
}

export interface HeadingBlock {
  readonly level: number;
  readonly text: string;
  readonly headingPath: string;
  readonly startOffset: number;
  readonly endOffset: number;
}

// A bare run of 1-6 `#` with nothing else is a heading boundary; otherwise at
// least one space or tab must separate the hashes from the heading text.
const headingPattern = /^(#{1,6})(?:[ \t]+(.*))?$/;

/**
 * An ATX heading indented four or more columns (a space run, or any tab) is a
 * CommonMark indented code block, not a heading.
 */
function isIndentedOutOfHeadingScope(rawText: string): boolean {
  let spaces = 0;
  for (const character of rawText) {
    if (character === " ") {
      spaces += 1;
      if (spaces >= 4) return true;
      continue;
    }
    if (character === "\t") return true;
    break;
  }
  return false;
}

/** Finds every un-fenced ATX heading and its block extent (contract §5). */
export function scanHeadingBlocks(
  bytes: Uint8Array,
  lines: readonly MarkdownLine[],
): readonly HeadingBlock[] {
  interface Raw {
    readonly level: number;
    readonly text: string;
    readonly start: number;
    readonly headingPath: string;
  }

  const stack: { readonly level: number; readonly text: string }[] = [];
  const raw: Raw[] = [];

  for (const line of lines) {
    if (line.fenced) continue;
    if (isIndentedOutOfHeadingScope(line.text)) continue;
    const match = headingPattern.exec(line.trimmed);
    if (!match) continue;
    const level = (match[1] as string).length;
    const text = (match[2] ?? "").trim();
    while (
      stack.length > 0 &&
      (stack[stack.length - 1] as { level: number }).level >= level
    ) {
      stack.pop();
    }
    const headingPath = [...stack.map((entry) => entry.text), text].join(" > ");
    stack.push({ level, text });
    raw.push({ level, text, start: line.start, headingPath });
  }

  // One stack pass, back to front: a heading's block ends at the nearest
  // following heading of the same or a higher level (contract §5). The stack
  // holds, innermost last, the nearest following heading of each strictly
  // lower level still open, so every heading is pushed and popped once.
  const endOffsets: number[] = new Array<number>(raw.length);
  const following: Raw[] = [];
  for (let index = raw.length - 1; index >= 0; index -= 1) {
    const heading = raw[index] as Raw;
    while (
      following.length > 0 &&
      (following[following.length - 1] as Raw).level > heading.level
    ) {
      following.pop();
    }
    const next = following[following.length - 1];
    endOffsets[index] = next === undefined ? bytes.length : next.start;
    following.push(heading);
  }

  return raw.map((heading, index) => ({
    level: heading.level,
    text: heading.text,
    headingPath: heading.headingPath,
    startOffset: heading.start,
    endOffset: endOffsets[index] as number,
  }));
}

/**
 * Recognizes a Spec entry heading: second-level ATX, `R-` plus three or more
 * digits, then a space, a full- or half-width colon, or end of line (contract
 * §3). The recognized id is `R-<digits>`; the full heading text travels
 * separately so it is never lost or reinterpreted (Story TST-021 R3).
 */
const specEntryPattern = /^R-(\d{3,})(?:[ \t：:]|$)/;

export function readSpecEntryId(heading: HeadingBlock): string | undefined {
  if (heading.level !== 2) return undefined;
  const match = specEntryPattern.exec(heading.text);
  return match === undefined || match === null ? undefined : `R-${match[1]}`;
}

export interface MarkdownLineMatch {
  readonly id: string;
  readonly start: number;
  readonly end: number;
}

const specAcceptancePattern = /^[-*] AC-(\d+)[：:]/;

/**
 * Reads every Spec AC line (`- AC-NNN：` or `* AC-NNN:`) inside one entry's
 * block, undeduplicated. Visits only the lines inside `[blockStart,
 * blockEnd)` (found by binary search), so reading every entry of a document
 * costs one pass over its lines in total, not one pass per entry.
 */
export function readSpecAcceptanceLines(
  lines: readonly MarkdownLine[],
  blockStart: number,
  blockEnd: number,
): readonly MarkdownLineMatch[] {
  const found: MarkdownLineMatch[] = [];
  const first = lowerBoundByStart(lines, blockStart);
  for (let index = first; index < lines.length; index += 1) {
    const line = lines[index] as MarkdownLine;
    if (line.start >= blockEnd) break;
    if (line.fenced) continue;
    const match = specAcceptancePattern.exec(line.trimmed);
    if (!match) continue;
    found.push({ id: `AC-${match[1]}`, start: line.start, end: line.end });
  }
  return found;
}

const acceptanceCheckboxPattern = /^\[([ xX])] (AC-[0-9]+):/;

/** Reads every `AC-<digits>` checkbox line in a Story's `acceptance.md`, undeduplicated. */
export function readAcceptanceCheckboxLines(
  lines: readonly MarkdownLine[],
): readonly MarkdownLineMatch[] {
  const found: MarkdownLineMatch[] = [];
  for (const line of lines) {
    if (line.fenced) continue;
    const bullet =
      line.trimmed.startsWith("* ") || line.trimmed.startsWith("- ")
        ? line.trimmed.slice(2)
        : undefined;
    if (bullet === undefined) continue;
    const match = acceptanceCheckboxPattern.exec(bullet);
    if (!match) continue;
    found.push({ id: match[2] as string, start: line.start, end: line.end });
  }
  return found;
}

const storyIdToken = /[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-[0-9]+/g;

/** Reads every batch-internal Story ID a Story's `## Dependencies` prose names. */
export function readDependencyProseIds(
  source: string,
  knownStoryIds: ReadonlySet<string>,
): readonly string[] {
  const found = new Set<string>();
  let inSection = false;

  for (const rawLine of source.split("\n")) {
    const trimmed = trimDeclarationText(rawLine);
    if (trimmed.startsWith("#")) {
      inSection = trimmed === "## Dependencies";
      continue;
    }
    if (!inSection) continue;
    for (const match of trimmed.matchAll(storyIdToken)) {
      const candidate = match[0];
      if (isStoryId(candidate) && knownStoryIds.has(candidate))
        found.add(candidate);
    }
  }

  return [...found];
}

/** First index in the ascending-by-`start` `lines` whose `start` is `>= value`. */
export function lowerBoundByStart(
  lines: readonly { readonly start: number }[],
  value: number,
): number {
  let low = 0;
  let high = lines.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if ((lines[mid] as { readonly start: number }).start < value) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** The leading space/tab run of a line's own text, in characters. */
export function indentOf(line: { readonly text: string }): number {
  let width = 0;
  while (line.text[width] === " " || line.text[width] === "\t") width += 1;
  return width;
}

/**
 * Matches an unordered (`-`, `*`, `+`) or ordered (`1.`, `1)`) list marker at
 * the start of `trimmed`, returning the unconsumed rest. A hand-rolled
 * prefix match plus `slice` rather than a single `(.*)$` capture group, so a
 * line holding a stray `\r` (which `.` never matches) cannot force the regex
 * engine to backtrack across the whole line looking for a split that works.
 */
export function parseItemMarker(
  trimmed: string,
): { readonly ordered: boolean; readonly rest: string } | undefined {
  const bullet = /^[-*+][ \t]+/.exec(trimmed);
  if (bullet !== null)
    return { ordered: false, rest: trimmed.slice(bullet[0].length) };
  const ordered = /^\d+[.)][ \t]+/.exec(trimmed);
  if (ordered !== null)
    return { ordered: true, rest: trimmed.slice(ordered[0].length) };
  return undefined;
}

/**
 * One document scanned once. Every consumer looks facts up here by offset
 * (a Map or a binary search over `lines`) instead of rescanning `lines` or
 * `headings` per heading, per entry, or per line.
 */
export interface MarkdownDocument {
  readonly bytes: Uint8Array;
  readonly lines: readonly MarkdownLine[];
  readonly headings: readonly HeadingBlock[];
  readonly headingByStart: ReadonlyMap<number, HeadingBlock>;
  /** A heading's position in `headings`, keyed by its `startOffset`. */
  readonly headingIndexByStart: ReadonlyMap<number, number>;
  /**
   * Per heading (same order as `headings`), the end of the range the
   * projection shows for it: its block end, capped at the next `##` or `#`
   * heading, so a lone `#` title never swallows the whole file.
   */
  readonly headingDisplayEnds: readonly number[];
  /**
   * For every un-fenced list-item line, keyed by its `start`: the exclusive
   * end offset of the item's extent — the item line plus every following
   * non-blank, un-fenced line indented deeper than it (the same rule the
   * HTML list parser uses to nest continuation text and sub-lists).
   */
  readonly listItemEndByStart: ReadonlyMap<number, number>;
}

function scanListItemEnds(
  lines: readonly MarkdownLine[],
  documentEnd: number,
): ReadonlyMap<number, number> {
  // One stack pass: the open items, strictly increasing in indent. A line
  // closes every open item it is not indented deeper than; a blank or
  // fenced line closes them all. Each item is pushed and popped once.
  const ends = new Map<number, number>();
  const open: { readonly start: number; readonly indent: number }[] = [];
  const closeAll = (end: number): void => {
    for (const item of open) ends.set(item.start, end);
    open.length = 0;
  };

  for (const line of lines) {
    if (line.fenced || line.trimmed === "") {
      closeAll(line.start);
      continue;
    }
    const indent = indentOf(line);
    while (
      open.length > 0 &&
      (open[open.length - 1] as { indent: number }).indent >= indent
    ) {
      const item = open.pop() as { start: number };
      ends.set(item.start, line.start);
    }
    if (parseItemMarker(line.trimmed) !== undefined)
      open.push({ start: line.start, indent });
  }
  closeAll(documentEnd);
  return ends;
}

function scanHeadingDisplayEnds(
  headings: readonly HeadingBlock[],
  documentEnd: number,
): readonly number[] {
  const ends: number[] = new Array<number>(headings.length);
  let nextTopLevelStart = documentEnd;
  for (let index = headings.length - 1; index >= 0; index -= 1) {
    const heading = headings[index] as HeadingBlock;
    ends[index] =
      heading.level >= 2
        ? heading.endOffset
        : Math.min(heading.endOffset, nextTopLevelStart);
    if (heading.level <= 2) nextTopLevelStart = heading.startOffset;
  }
  return ends;
}

/** Scans `bytes` once into the shared block model; reuse the result across every consumer. */
export function scanMarkdownDocument(bytes: Uint8Array): MarkdownDocument {
  const lines = scanMarkdownLines(bytes);
  const headings = scanHeadingBlocks(bytes, lines);
  const headingByStart = new Map<number, HeadingBlock>();
  const headingIndexByStart = new Map<number, number>();
  headings.forEach((heading, index) => {
    headingByStart.set(heading.startOffset, heading);
    headingIndexByStart.set(heading.startOffset, index);
  });
  return {
    bytes,
    lines,
    headings,
    headingByStart,
    headingIndexByStart,
    headingDisplayEnds: scanHeadingDisplayEnds(headings, bytes.length),
    listItemEndByStart: scanListItemEnds(lines, bytes.length),
  };
}

/** The range end the projection shows for `heading` (see `headingDisplayEnds`). */
export function headingDisplayEnd(
  document: MarkdownDocument,
  heading: HeadingBlock,
): number {
  const index = document.headingIndexByStart.get(heading.startOffset);
  return index === undefined
    ? heading.endOffset
    : (document.headingDisplayEnds[index] as number);
}
