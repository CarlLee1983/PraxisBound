/**
 * Converts one byte range of the shared Markdown block model into inert HTML.
 *
 * Built on the shared block model (`scanMarkdownDocument`, `markdown.ts`) so
 * index and projection agree on every heading and fence boundary; this module
 * adds no second line/fence scanner of its own and never re-guesses a fence
 * boundary from a marker-looking line. A caller scans a document once and
 * passes the result to every `renderMarkdownHtml` call for that document, so
 * rendering many blocks from the same source never rescans it. Pure: no I/O,
 * no globals, no mutation of its inputs. Source text is always escaped; only `http:`, `https:` and
 * in-page fragment links ever carry an `href` (contract §18).
 */

import { trimDeclarationText } from "../declarations.js";
import { escapeHtml } from "./html.js";
import {
  indentOf,
  lowerBoundByStart,
  parseItemMarker,
  scanMarkdownDocument,
  type HeadingBlock,
  type MarkdownDocument,
  type MarkdownLine,
} from "./markdown.js";

export { scanMarkdownDocument, type MarkdownDocument };

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

  // Link scanning stays linear however many `[` precede one `]` or an
  // unclosed `(`: the scan position only moves forward, so the next `]` at
  // or after it is found once and reused until the scan passes it, and a
  // destination scan that failed after one `]` is remembered, since every
  // later `[` before that `]` would repeat exactly the same scan.
  let closeBracketCache = -2;
  let failedDestinationBracket = -1;
  const nextCloseBracket = (from: number): number => {
    if (closeBracketCache === -1 || closeBracketCache >= from)
      return closeBracketCache;
    closeBracketCache = text.indexOf("]", from);
    return closeBracketCache;
  };

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
      const closeBracket = nextCloseBracket(index + 1);
      if (
        closeBracket !== -1 &&
        closeBracket !== failedDestinationBracket &&
        text[closeBracket + 1] === "("
      ) {
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
        failedDestinationBracket = closeBracket;
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

function renderFenceBody(body: readonly string[]): string {
  return `<pre><code>${escapeHtml(body.join("\n"))}</code></pre>`;
}

function isBlockQuoteLine(trimmed: string): boolean {
  return trimmed.startsWith(">");
}

function stripBlockQuote(trimmed: string): string {
  return trimmed.replace(/^>[ \t]?/, "");
}

/** Past this many nested `>` levels a quote's remaining lines render as one paragraph. */
const MAX_BLOCK_QUOTE_DEPTH = 32;

/**
 * A block quote renders its stripped content through the same block loop as
 * the document itself, so a list, a later paragraph, or a blank-line-separated
 * second list inside one quote are all kept (AC-004). Each stripped line keeps
 * its source `start`, so per-line options still find it.
 */
function renderBlockQuote(
  group: readonly MarkdownLine[],
  context: BlockContext,
): string {
  if (context.quoteDepth >= MAX_BLOCK_QUOTE_DEPTH) {
    const texts = group.map((line) => stripBlockQuote(line.trimmed));
    return `<blockquote><p>${joinInline(texts)}</p></blockquote>`;
  }
  const stripped = group.map((line): MarkdownLine => {
    const text = stripBlockQuote(line.trimmed);
    return {
      start: line.start,
      end: line.end,
      text,
      trimmed: trimDeclarationText(text),
      fenced: false,
      fence: undefined,
    };
  });
  const inner = renderBlocks(stripped, {
    ...context,
    quoteDepth: context.quoteDepth + 1,
  });
  return `<blockquote>${inner}</blockquote>`;
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

function isDividerSpace(character: string | undefined): boolean {
  return character !== undefined && /\s/u.test(character);
}

/**
 * A pipe-table divider row: optional outer pipes, and one or more cells of
 * `:?-{3,}:?`, each separated by `|` and optional whitespace. A single
 * column still has one leading and one trailing `-{3,}` run. Hand-written in
 * one forward pass so a long whitespace run can never make it backtrack.
 */
function isTableDivider(trimmed: string): boolean {
  let index = 0;
  const skipSpace = (): void => {
    while (isDividerSpace(trimmed[index])) index += 1;
  };

  skipSpace();
  if (trimmed[index] === "|") index += 1;
  for (;;) {
    skipSpace();
    if (trimmed[index] === ":") index += 1;
    let dashes = 0;
    while (trimmed[index] === "-") {
      dashes += 1;
      index += 1;
    }
    if (dashes < 3) return false;
    if (trimmed[index] === ":") index += 1;
    skipSpace();
    if (index === trimmed.length) return true;
    if (trimmed[index] !== "|") return false;
    index += 1;
    skipSpace();
    if (index === trimmed.length) return true;
  }
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
  context: BlockContext,
): { html: string; consumed: number } {
  const { headingByStart, options } = context;
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
      const sub = parseList(nested, cursor, context);
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

interface BlockContext {
  readonly headingByStart: ReadonlyMap<number, HeadingBlock>;
  readonly options: MarkdownHtmlOptions;
  readonly quoteDepth: number;
}

function startsTable(lines: readonly MarkdownLine[], index: number): boolean {
  const line = lines[index] as MarkdownLine;
  const next = lines[index + 1];
  return (
    next !== undefined &&
    !next.fenced &&
    line.trimmed.includes("|") &&
    isTableDivider(next.trimmed)
  );
}

/** The block loop shared by a document range and a block quote's stripped content. */
function renderBlocks(
  lines: readonly MarkdownLine[],
  context: BlockContext,
): string {
  const { headingByStart, options } = context;
  const blocks: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] as MarkdownLine;

    if (line.fenced) {
      // Fence boundaries come from the scanner's own opener/closer marks, so
      // a shorter or different-character marker inside a fence stays body
      // text (AC-004). A closer whose opener lies before this range carries
      // no content of its own; a body line whose opener lies before the
      // range still starts a block here.
      if (line.fence?.role === "close") {
        index += 1;
        continue;
      }
      const body: string[] = [];
      let cursor = line.fence?.role === "open" ? index + 1 : index;
      while (cursor < lines.length) {
        const candidate = lines[cursor] as MarkdownLine;
        if (!candidate.fenced || candidate.fence?.role === "open") break;
        cursor += 1;
        if (candidate.fence?.role === "close") break;
        body.push(candidate.text);
      }
      blocks.push(renderFenceBody(body));
      index = cursor;
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

    if (startsTable(lines, index)) {
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
      blocks.push(renderBlockQuote(group, context));
      continue;
    }

    if (parseItemMarker(line.trimmed) !== undefined) {
      const list = parseList(lines, index, context);
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
      if (startsTable(lines, index)) break;
      group.push(candidate);
      index += 1;
    }
    blocks.push(renderParagraph(group));
  }

  return blocks.join("\n");
}

/**
 * Renders the Markdown lines whose `start` lies in `[start, end)` as HTML,
 * sharing block boundaries with the scanner (via `document`) so index and
 * projection locators agree (contract §18). Scan `document` once per source
 * with `scanMarkdownDocument` and reuse it across every call for that
 * source; this function itself never rescans.
 */
export function renderMarkdownHtml(
  document: MarkdownDocument,
  start: number,
  end: number,
  options: MarkdownHtmlOptions = {},
): string {
  const lines = document.lines.slice(
    lowerBoundByStart(document.lines, start),
    lowerBoundByStart(document.lines, end),
  );
  return renderBlocks(lines, {
    headingByStart: document.headingByStart,
    options,
    quoteDepth: 0,
  });
}
