/**
 * Converts one byte range of the shared Markdown block model into inert HTML.
 *
 * Built on `scanMarkdownLines` / `scanHeadingBlocks` (`markdown.ts`) so index
 * and projection agree on every heading and fence boundary; this module adds
 * no second line/fence scanner of its own. A caller scans a document once
 * with `scanMarkdownDocument` and passes the result to every
 * `renderMarkdownHtml` call for that document, so rendering many blocks from
 * the same source never rescans it. Pure: no I/O, no globals, no mutation of
 * its inputs. Source text is always escaped; only `http:`, `https:` and
 * in-page fragment links ever carry an `href` (contract §18).
 */

import { escapeHtml } from "./html.js";
import {
  scanHeadingBlocks,
  scanMarkdownLines,
  type HeadingBlock,
  type MarkdownLine,
} from "./markdown.js";

/** One document scanned once; share this across every `renderMarkdownHtml` call for it. */
export interface MarkdownDocument {
  readonly bytes: Uint8Array;
  readonly lines: readonly MarkdownLine[];
  readonly headings: readonly HeadingBlock[];
  readonly headingByStart: ReadonlyMap<number, HeadingBlock>;
}

/** Scans `bytes` once for lines and headings; reuse the result across calls. */
export function scanMarkdownDocument(bytes: Uint8Array): MarkdownDocument {
  const lines = scanMarkdownLines(bytes);
  const headings = scanHeadingBlocks(bytes, lines);
  const headingByStart = new Map(
    headings.map((heading) => [heading.startOffset, heading]),
  );
  return { bytes, lines, headings, headingByStart };
}

export interface MarkdownHtmlOptions {
  /** Added to every source heading level (clamped to 6). */
  readonly headingLevelOffset?: number;
  /** Extra attributes for a heading, keyed by its HeadingBlock; values are escaped by you. */
  readonly headingAttributes?: (
    heading: HeadingBlock,
  ) => Readonly<Record<string, string>> | undefined;
  /** Extra attributes for a list item, keyed by the MarkdownLine that starts it. */
  readonly listItemAttributes?: (
    line: MarkdownLine,
  ) => Readonly<Record<string, string>> | undefined;
  /**
   * A plain-text label to show at the start of a list item, keyed by the
   * MarkdownLine that starts it (e.g. an `R-NNN/AC-NNN` id). Rendered as an
   * escaped `<span class="ac-id">` this module owns, so the caller never
   * builds HTML around a rendered fragment by hand.
   */
  readonly listItemPrefix?: (line: MarkdownLine) => string | undefined;
  /**
   * When true for a list item's starting line, that `<li>` is omitted
   * entirely. Used when the same line is rendered as a labelled item
   * elsewhere in the page, so it is not duplicated (contract §18: every
   * source block renders exactly once).
   */
  readonly omitListItem?: (line: MarkdownLine) => boolean;
}

function renderAttributes(
  attributes: Readonly<Record<string, string>> | undefined,
): string {
  if (attributes === undefined) return "";
  return Object.entries(attributes)
    .map(([name, value]) => ` ${name}="${escapeHtml(value)}"`)
    .join("");
}

/** Only `http:`, `https:` and in-page fragments become a live `href` (contract §18). */
function isSafeUrl(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  for (const character of normalized) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))
      return false;
  }
  return (
    normalized.startsWith("#") ||
    normalized.startsWith("http:") ||
    normalized.startsWith("https:")
  );
}

function renderLink(label: string, href: string): string {
  const rendered = renderInline(label);
  return isSafeUrl(href)
    ? `<a href="${escapeHtml(href.trim())}">${rendered}</a>`
    : `<a class="unsafe-link">${rendered}</a>`;
}

const wordCharacter = /[\p{L}\p{N}]/u;
const whitespace = /\s/u;

/**
 * A single `*` or `_` opens emphasis only when followed by non-whitespace;
 * `_` must also not follow a word character, so identifiers such as
 * `REVIEW_SOURCE_MISSING` keep their underscores (CommonMark flanking rules).
 */
function canOpenEmphasis(text: string, index: number): boolean {
  const next = text[index + 1];
  if (next === undefined || whitespace.test(next)) return false;
  const previous = text[index - 1];
  return (
    text[index] !== "_" ||
    previous === undefined ||
    !wordCharacter.test(previous)
  );
}

/**
 * Every index in `text` where `delimiter` could close emphasis, ascending.
 * Computed once per `renderInline` call so each opener's search below is a
 * binary search rather than a fresh linear scan (avoids the O(n^2) blowup a
 * long run of unmatched openers, e.g. `" _a".repeat(n)`, would otherwise cause).
 */
function emphasisClosePositions(
  text: string,
  delimiter: string,
): readonly number[] {
  const positions: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== delimiter) continue;
    const previous = text[index - 1];
    if (previous === undefined || whitespace.test(previous)) continue;
    const next = text[index + 1];
    if (delimiter === "_" && next !== undefined && wordCharacter.test(next))
      continue;
    positions.push(index);
  }
  return positions;
}

/** First entry of the ascending `positions` that is `>= from`, or -1. */
function findEmphasisClose(positions: readonly number[], from: number): number {
  let low = 0;
  let high = positions.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if ((positions[mid] as number) < from) low = mid + 1;
    else high = mid;
  }
  return low < positions.length ? (positions[low] as number) : -1;
}

/** A link destination's parenthesis nesting gives up past this depth (CommonMark-style cap). */
const MAX_LINK_PAREN_DEPTH = 32;

/** Code spans, links, strong and em; every other character is escaped text. */
function renderInline(text: string): string {
  let output = "";
  let plain = "";
  const flush = (): void => {
    if (plain === "") return;
    output += escapeHtml(plain);
    plain = "";
  };

  const underscoreCloses = emphasisClosePositions(text, "_");
  const asteriskCloses = emphasisClosePositions(text, "*");

  let index = 0;
  while (index < text.length) {
    const character = text[index] as string;

    if (character === "`") {
      const end = text.indexOf("`", index + 1);
      if (end !== -1) {
        flush();
        output += `<code>${escapeHtml(text.slice(index + 1, end))}</code>`;
        index = end + 1;
        continue;
      }
    }

    if (character === "[") {
      const closeBracket = text.indexOf("]", index + 1);
      if (closeBracket !== -1 && text[closeBracket + 1] === "(") {
        let depth = 1;
        let cursor = closeBracket + 2;
        while (cursor < text.length && depth > 0) {
          if (text[cursor] === "(") depth += 1;
          else if (text[cursor] === ")") depth -= 1;
          cursor += 1;
          if (depth > MAX_LINK_PAREN_DEPTH) break;
        }
        if (depth === 0) {
          flush();
          const label = text.slice(index + 1, closeBracket);
          const href = text.slice(closeBracket + 2, cursor - 1);
          output += renderLink(label, href);
          index = cursor;
          continue;
        }
      }
    }

    if (character === "*" && text[index + 1] === "*") {
      const end = text.indexOf("**", index + 2);
      if (end !== -1) {
        flush();
        output += `<strong>${renderInline(text.slice(index + 2, end))}</strong>`;
        index = end + 2;
        continue;
      }
    }

    if (
      (character === "*" || character === "_") &&
      canOpenEmphasis(text, index)
    ) {
      const end = findEmphasisClose(
        character === "_" ? underscoreCloses : asteriskCloses,
        index + 1,
      );
      if (end !== -1 && end > index + 1) {
        flush();
        output += `<em>${renderInline(text.slice(index + 1, end))}</em>`;
        index = end + 1;
        continue;
      }
    }

    plain += character;
    index += 1;
  }

  flush();
  return output;
}

function isAsciiVisible(character: string): boolean {
  if (character === "") return false;
  const codePoint = character.codePointAt(0) ?? 0;
  return codePoint >= 0x21 && codePoint <= 0x7e;
}

/** Joins prose lines with a space between ASCII-visible neighbors, none otherwise (CJK wraps bare). */
function joinInline(texts: readonly string[]): string {
  let html = "";
  texts.forEach((text, index) => {
    const rendered = renderInline(text);
    if (index === 0) {
      html = rendered;
      return;
    }
    const previous = texts[index - 1] as string;
    const separator =
      isAsciiVisible(previous.slice(-1)) && isAsciiVisible(text.slice(0, 1))
        ? " "
        : "";
    html += separator + rendered;
  });
  return html;
}

function renderHeading(
  heading: HeadingBlock,
  options: MarkdownHtmlOptions,
): string {
  const offset = options.headingLevelOffset ?? 0;
  const level = Math.min(Math.max(heading.level + offset, 1), 6);
  const attributes = options.headingAttributes?.(heading);
  return `<h${level}${renderAttributes(attributes)}>${renderInline(heading.text)}</h${level}>`;
}

function isFenceMarkerLine(trimmed: string): boolean {
  const character = trimmed[0];
  if (character !== "`" && character !== "~") return false;
  let run = 0;
  while (trimmed[run] === character) run += 1;
  return run >= 3 && run === trimmed.length;
}

/** Renders one contiguous run of fenced lines, dropping the fence markers themselves. */
function renderFence(group: readonly MarkdownLine[]): string {
  const body = group.slice(1);
  const last = body[body.length - 1];
  const content =
    last !== undefined && isFenceMarkerLine(last.trimmed)
      ? body.slice(0, -1)
      : body;
  const text = content.map((line) => line.text).join("\n");
  return `<pre><code>${escapeHtml(text)}</code></pre>`;
}

function isBlockQuoteLine(trimmed: string): boolean {
  return trimmed.startsWith(">");
}

function stripBlockQuote(trimmed: string): string {
  return trimmed.replace(/^>[ \t]?/, "");
}

/**
 * A block quote whose stripped first line starts a list renders that list
 * (the simplest correct behavior for the common case); anything else still
 * renders as one joined paragraph, as before. Full block-quote nesting
 * (mixed prose and lists, nested quotes) is out of scope here.
 */
function renderBlockQuote(
  group: readonly MarkdownLine[],
  headingByStart: ReadonlyMap<number, HeadingBlock>,
  options: MarkdownHtmlOptions,
): string {
  const stripped = group.map((line) => ({
    ...line,
    text: stripBlockQuote(line.trimmed),
    trimmed: stripBlockQuote(line.trimmed),
    fenced: false,
  }));
  const first = stripped[0];
  if (first !== undefined && parseItemMarker(first.trimmed) !== undefined) {
    const list = parseList(stripped, 0, headingByStart, options);
    return `<blockquote>${list.html}</blockquote>`;
  }
  const texts = group.map((line) => stripBlockQuote(line.trimmed));
  return `<blockquote><p>${joinInline(texts)}</p></blockquote>`;
}

function renderParagraph(group: readonly MarkdownLine[]): string {
  return `<p>${joinInline(group.map((line) => line.trimmed))}</p>`;
}

function isThematicBreak(trimmed: string): boolean {
  if (trimmed.length < 3) return false;
  const character = trimmed[0];
  if (character !== "-" && character !== "_" && character !== "*") return false;
  let count = 0;
  for (const candidate of trimmed) {
    if (candidate === character) {
      count += 1;
      continue;
    }
    if (candidate === " " || candidate === "\t") continue;
    return false;
  }
  return count >= 3;
}

// A single column still has one leading and one trailing `-{3,}` run with no
// further `|`-separated repeats, so the repeated group is optional.
function isTableDivider(trimmed: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(trimmed);
}

/** Splits one pipe-table row into cells; `\|` stays a literal pipe rather than a separator. */
function splitTableRow(trimmed: string): string[] {
  let inner = trimmed.trim();
  if (inner.startsWith("|")) inner = inner.slice(1);
  if (inner.endsWith("|") && inner.slice(-2) !== "\\|")
    inner = inner.slice(0, -1);

  const cells: string[] = [];
  let current = "";
  for (let index = 0; index < inner.length; index += 1) {
    if (inner[index] === "\\" && inner[index + 1] === "|") {
      current += "|";
      index += 1;
      continue;
    }
    if (inner[index] === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += inner[index];
  }
  cells.push(current.trim());
  return cells;
}

function renderTable(
  lines: readonly MarkdownLine[],
  index: number,
): { html: string; consumed: number } {
  const header = lines[index] as MarkdownLine;
  const rows: MarkdownLine[] = [];
  let cursor = index + 2;
  while (cursor < lines.length) {
    const candidate = lines[cursor] as MarkdownLine;
    if (
      candidate.fenced ||
      candidate.trimmed === "" ||
      !candidate.trimmed.includes("|")
    )
      break;
    rows.push(candidate);
    cursor += 1;
  }

  const headerCells = splitTableRow(header.trimmed)
    .map((cell) => `<th>${renderInline(cell)}</th>`)
    .join("");
  const bodyRows = rows
    .map(
      (row) =>
        `<tr>${splitTableRow(row.trimmed)
          .map((cell) => `<td>${renderInline(cell)}</td>`)
          .join("")}</tr>`,
    )
    .join("");
  const html = `<div class="table-scroll"><table><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table></div>`;
  return { html, consumed: cursor - index };
}

function indentOf(line: MarkdownLine): number {
  const match = /^[ \t]*/.exec(line.text);
  return match === null ? 0 : match[0].length;
}

/**
 * Matches an unordered (`-`, `*`, `+`) or ordered (`1.`, `1)`) list marker at
 * the start of `trimmed`, returning the unconsumed rest. A hand-rolled
 * prefix match plus `slice` rather than a single `(.*)$` capture group, so a
 * line holding a stray `\r` (which `.` never matches) cannot force the regex
 * engine to backtrack across the whole line looking for a split that works.
 */
function parseItemMarker(
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

/** Same hand-rolled-prefix approach as `parseItemMarker`, for the same reason. */
function parseCheckbox(
  text: string,
): { readonly glyph: string; readonly rest: string } | undefined {
  const match = /^\[([ xX])\][ \t]+/.exec(text);
  if (match === null) return undefined;
  return { glyph: match[1] as string, rest: text.slice(match[0].length) };
}

/** A `[ ]`/`[x]`/`[X]` at item start renders as a non-interactive glyph, never a control (AC-009). */
function renderItemText(text: string): string {
  const checkbox = parseCheckbox(text);
  if (checkbox === undefined) return renderInline(text);
  const glyph = checkbox.glyph === " " ? "☐" : "☑";
  return `<span class="checkbox-glyph" aria-hidden="true">${glyph}</span> ${renderInline(checkbox.rest)}`;
}

function listItemPrefixHtml(
  options: MarkdownHtmlOptions,
  line: MarkdownLine,
): string {
  const label = options.listItemPrefix?.(line);
  return label === undefined
    ? ""
    : `<span class="ac-id">${escapeHtml(label)}</span> `;
}

/**
 * Parses one list level starting at `start`. Every line at deeper indent
 * gets consumed either as this item's continuation text or as a further
 * nested list (recursing one level at a time, however many levels or
 * indentation shapes the source actually uses) — never dropped, however
 * irregular the indentation (AC-004).
 */
function parseList(
  lines: readonly MarkdownLine[],
  start: number,
  headingByStart: ReadonlyMap<number, HeadingBlock>,
  options: MarkdownHtmlOptions,
): { html: string; consumed: number } {
  const baseIndent = indentOf(lines[start] as MarkdownLine);
  const ordered = (
    parseItemMarker((lines[start] as MarkdownLine).trimmed) as {
      ordered: boolean;
    }
  ).ordered;

  const items: string[] = [];
  let index = start;
  while (index < lines.length) {
    const line = lines[index] as MarkdownLine;
    if (line.fenced || line.trimmed === "" || indentOf(line) !== baseIndent)
      break;
    const marker = parseItemMarker(line.trimmed);
    if (marker === undefined) break;
    const itemLine = line;
    index += 1;

    const nested: MarkdownLine[] = [];
    while (index < lines.length) {
      const candidate = lines[index] as MarkdownLine;
      if (
        candidate.fenced ||
        candidate.trimmed === "" ||
        indentOf(candidate) <= baseIndent
      )
        break;
      nested.push(candidate);
      index += 1;
    }

    let body = renderItemText(marker.rest);
    let lastPlain: string | undefined = marker.rest;
    let cursor = 0;
    while (cursor < nested.length) {
      const candidate = nested[cursor] as MarkdownLine;
      const nestedHeading = headingByStart.get(candidate.start);
      if (nestedHeading !== undefined) {
        body += renderHeading(nestedHeading, options);
        lastPlain = undefined;
        cursor += 1;
        continue;
      }
      if (parseItemMarker(candidate.trimmed) === undefined) {
        const text = candidate.trimmed;
        const separator =
          lastPlain !== undefined &&
          isAsciiVisible(lastPlain.slice(-1)) &&
          isAsciiVisible(text.slice(0, 1))
            ? " "
            : "";
        body += separator + renderInline(text);
        lastPlain = text;
        cursor += 1;
        continue;
      }
      const sub = parseList(nested, cursor, headingByStart, options);
      body += sub.html;
      lastPlain = undefined;
      cursor += Math.max(sub.consumed, 1);
    }

    if (!(options.omitListItem?.(itemLine) ?? false)) {
      const attributes = options.listItemAttributes?.(itemLine);
      const prefix = listItemPrefixHtml(options, itemLine);
      items.push(`<li${renderAttributes(attributes)}>${prefix}${body}</li>`);
    }
  }

  const tag = ordered ? "ol" : "ul";
  return {
    html: items.length === 0 ? "" : `<${tag}>${items.join("")}</${tag}>`,
    consumed: index - start,
  };
}

/** First index in the ascending-by-`start` `lines` whose `start` is `>= value`. */
function lowerBoundByStart(
  lines: readonly MarkdownLine[],
  value: number,
): number {
  let low = 0;
  let high = lines.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if ((lines[mid] as MarkdownLine).start < value) low = mid + 1;
    else high = mid;
  }
  return low;
}

/**
 * Renders the Markdown lines whose `start` lies in `[start, end)` as HTML,
 * sharing block boundaries with `scanMarkdownLines` / `scanHeadingBlocks` (via
 * `document`) so index and projection locators agree (contract §18). Scan
 * `document` once per source with `scanMarkdownDocument` and reuse it across
 * every call for that source; this function itself never rescans.
 */
export function renderMarkdownHtml(
  document: MarkdownDocument,
  start: number,
  end: number,
  options: MarkdownHtmlOptions = {},
): string {
  const { headingByStart } = document;
  const lines = document.lines.slice(
    lowerBoundByStart(document.lines, start),
    lowerBoundByStart(document.lines, end),
  );

  const blocks: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] as MarkdownLine;

    if (line.fenced) {
      // A maximal run of fenced lines may hold more than one fence: split it
      // on every fence-marker line so two adjacent fences render as two
      // separate blocks instead of one, with the second fence's opener
      // showing up as literal text (AC-005).
      while (index < lines.length && (lines[index] as MarkdownLine).fenced) {
        const group: MarkdownLine[] = [lines[index] as MarkdownLine];
        index += 1;
        while (
          index < lines.length &&
          (lines[index] as MarkdownLine).fenced &&
          !isFenceMarkerLine((lines[index] as MarkdownLine).trimmed)
        ) {
          group.push(lines[index] as MarkdownLine);
          index += 1;
        }
        if (
          index < lines.length &&
          (lines[index] as MarkdownLine).fenced &&
          isFenceMarkerLine((lines[index] as MarkdownLine).trimmed)
        ) {
          group.push(lines[index] as MarkdownLine);
          index += 1;
        }
        blocks.push(renderFence(group));
      }
      continue;
    }

    const heading = headingByStart.get(line.start);
    if (heading !== undefined) {
      index += 1;
      blocks.push(renderHeading(heading, options));
      continue;
    }

    if (line.trimmed === "") {
      index += 1;
      continue;
    }

    if (isThematicBreak(line.trimmed)) {
      index += 1;
      blocks.push("<hr>");
      continue;
    }

    const next = lines[index + 1];
    if (
      next !== undefined &&
      !next.fenced &&
      line.trimmed.includes("|") &&
      isTableDivider(next.trimmed)
    ) {
      const table = renderTable(lines, index);
      blocks.push(table.html);
      index += table.consumed;
      continue;
    }

    if (isBlockQuoteLine(line.trimmed)) {
      const group: MarkdownLine[] = [];
      while (
        index < lines.length &&
        !(lines[index] as MarkdownLine).fenced &&
        isBlockQuoteLine((lines[index] as MarkdownLine).trimmed)
      ) {
        group.push(lines[index] as MarkdownLine);
        index += 1;
      }
      blocks.push(renderBlockQuote(group, headingByStart, options));
      continue;
    }

    if (parseItemMarker(line.trimmed) !== undefined) {
      const list = parseList(lines, index, headingByStart, options);
      blocks.push(list.html);
      index += list.consumed;
      continue;
    }

    const group: MarkdownLine[] = [];
    while (index < lines.length) {
      const candidate = lines[index] as MarkdownLine;
      if (candidate.fenced) break;
      if (headingByStart.has(candidate.start)) break;
      if (candidate.trimmed === "") break;
      if (isThematicBreak(candidate.trimmed)) break;
      if (isBlockQuoteLine(candidate.trimmed)) break;
      if (parseItemMarker(candidate.trimmed) !== undefined) break;
      const following = lines[index + 1];
      if (
        following !== undefined &&
        !following.fenced &&
        candidate.trimmed.includes("|") &&
        isTableDivider(following.trimmed)
      )
        break;
      group.push(candidate);
      index += 1;
    }
    blocks.push(renderParagraph(group));
  }

  return blocks.join("\n");
}
