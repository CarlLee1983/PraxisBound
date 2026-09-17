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
          lines.push({ start, end, text, trimmed, fenced: true });
          return;
        }
      }
      lines.push({ start, end, text, trimmed, fenced: false });
      return;
    }

    if (trimmed.startsWith(fenceCharacter)) {
      let run = 0;
      while (trimmed[run] === fenceCharacter) run += 1;
      if (run >= fenceLength && trimmed.length === run) fenceLength = 0;
    }
    lines.push({ start, end, text, trimmed, fenced: true });
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

  return raw.map((heading, index) => {
    let endOffset = bytes.length;
    for (let next = index + 1; next < raw.length; next += 1) {
      if ((raw[next] as Raw).level <= heading.level) {
        endOffset = (raw[next] as Raw).start;
        break;
      }
    }
    return {
      level: heading.level,
      text: heading.text,
      headingPath: heading.headingPath,
      startOffset: heading.start,
      endOffset,
    };
  });
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

/** Reads every Spec AC line (`- AC-NNN：` or `* AC-NNN:`) inside one entry's block, undeduplicated. */
export function readSpecAcceptanceLines(
  lines: readonly MarkdownLine[],
  blockStart: number,
  blockEnd: number,
): readonly MarkdownLineMatch[] {
  const found: MarkdownLineMatch[] = [];
  for (const line of lines) {
    if (line.fenced) continue;
    if (line.start < blockStart || line.start >= blockEnd) continue;
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
