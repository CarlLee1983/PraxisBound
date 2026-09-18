/**
 * Converts one byte range of the shared Markdown block model into inert HTML.
 *
 * Built on `scanMarkdownLines` / `scanHeadingBlocks` (`markdown.ts`) so index
 * and projection agree on every heading and fence boundary; this module adds
 * no second line/fence scanner of its own. Pure: no I/O, no globals, no
 * mutation of its inputs. Source text is always escaped; only `http:`,
 * `https:` and in-page fragment links ever carry an `href` (contract §18).
 */

import {
  scanHeadingBlocks,
  scanMarkdownLines,
  type HeadingBlock,
  type MarkdownLine,
} from "./markdown.js";

export interface MarkdownHtmlOptions {
  /** Added to every source heading level (clamped to 6). */
  readonly headingLevelOffset?: number;
  /** Omit the heading line at exactly `start`, when the caller renders that heading itself. */
  readonly omitLeadingHeading?: boolean;
  /** Extra attributes for a heading, keyed by its HeadingBlock; values are escaped by you. */
  readonly headingAttributes?: (
    heading: HeadingBlock,
  ) => Readonly<Record<string, string>> | undefined;
  /** Extra attributes for a list item, keyed by the MarkdownLine that starts it. */
  readonly listItemAttributes?: (
    line: MarkdownLine,
  ) => Readonly<Record<string, string>> | undefined;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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

/** Code spans, links, strong and em; every other character is escaped text. */
function renderInline(text: string): string {
  let output = "";
  let plain = "";
  const flush = (): void => {
    if (plain === "") return;
    output += escapeHtml(plain);
    plain = "";
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
      const closeBracket = text.indexOf("]", index + 1);
      if (closeBracket !== -1 && text[closeBracket + 1] === "(") {
        let depth = 1;
        let cursor = closeBracket + 2;
        while (cursor < text.length && depth > 0) {
          if (text[cursor] === "(") depth += 1;
          else if (text[cursor] === ")") depth -= 1;
          cursor += 1;
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

    if (character === "*" || character === "_") {
      const end = text.indexOf(character, index + 1);
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

function renderBlockQuote(group: readonly MarkdownLine[]): string {
  const texts = group.map((line) => stripBlockQuote(line.trimmed));
  return `<blockquote><p>${joinInline(texts)}</p></blockquote>`;
}

function renderParagraph(group: readonly MarkdownLine[]): string {
  return `<p>${joinInline(group.map((line) => line.trimmed))}</p>`;
}

function isTableDivider(trimmed: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(trimmed);
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

const itemPattern = /^([-*]|\d+\.)[ \t]+(.*)$/;
const checkboxPattern = /^\[([ xX])\][ \t]+(.*)$/;

function parseItemMarker(
  trimmed: string,
): { readonly ordered: boolean; readonly rest: string } | undefined {
  const match = itemPattern.exec(trimmed);
  if (match === null) return undefined;
  return { ordered: /\d/.test(match[1] as string), rest: match[2] as string };
}

/** A `[ ]`/`[x]`/`[X]` at item start renders as a non-interactive glyph, never a control (AC-009). */
function renderItemText(text: string): string {
  const checkbox = checkboxPattern.exec(text);
  if (checkbox === null) return renderInline(text);
  const glyph = checkbox[1] === " " ? "☐" : "☑";
  return `<span class="checkbox-glyph" aria-hidden="true">${glyph}</span> ${renderInline(checkbox[2] as string)}`;
}

/** Parses one list level starting at `start`; one further level of nesting comes from recursion. */
function parseList(
  lines: readonly MarkdownLine[],
  start: number,
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

    let splitAt = nested.length;
    for (let position = 0; position < nested.length; position += 1) {
      if (
        parseItemMarker((nested[position] as MarkdownLine).trimmed) !==
        undefined
      ) {
        splitAt = position;
        break;
      }
    }
    const continuation = nested.slice(0, splitAt).map((line) => line.trimmed);
    const texts = [marker.rest, ...continuation];

    let body = renderItemText(texts[0] as string);
    for (let position = 1; position < texts.length; position += 1) {
      const previous = texts[position - 1] as string;
      const current = texts[position] as string;
      const separator =
        isAsciiVisible(previous.slice(-1)) &&
        isAsciiVisible(current.slice(0, 1))
          ? " "
          : "";
      body += separator + renderInline(current);
    }

    const nestedHtml =
      splitAt < nested.length ? parseList(nested, splitAt, options).html : "";
    const attributes = options.listItemAttributes?.(itemLine);
    items.push(`<li${renderAttributes(attributes)}>${body}${nestedHtml}</li>`);
  }

  const tag = ordered ? "ol" : "ul";
  return {
    html: `<${tag}>${items.join("")}</${tag}>`,
    consumed: index - start,
  };
}

/**
 * Renders the Markdown lines whose `start` lies in `[start, end)` as HTML,
 * sharing block boundaries with `scanMarkdownLines` / `scanHeadingBlocks` so
 * index and projection locators agree (contract §18).
 */
export function renderMarkdownHtml(
  bytes: Uint8Array,
  start: number,
  end: number,
  options: MarkdownHtmlOptions = {},
): string {
  const allLines = scanMarkdownLines(bytes);
  const headings = scanHeadingBlocks(bytes, allLines);
  const headingByStart = new Map(
    headings.map((heading) => [heading.startOffset, heading]),
  );
  const lines = allLines.filter(
    (line) => line.start >= start && line.start < end,
  );

  const blocks: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] as MarkdownLine;

    if (line.fenced) {
      const group: MarkdownLine[] = [];
      while (index < lines.length && (lines[index] as MarkdownLine).fenced) {
        group.push(lines[index] as MarkdownLine);
        index += 1;
      }
      blocks.push(renderFence(group));
      continue;
    }

    const heading = headingByStart.get(line.start);
    if (heading !== undefined) {
      index += 1;
      if (options.omitLeadingHeading === true && heading.startOffset === start)
        continue;
      blocks.push(renderHeading(heading, options));
      continue;
    }

    if (line.trimmed === "") {
      index += 1;
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
      blocks.push(renderBlockQuote(group));
      continue;
    }

    if (parseItemMarker(line.trimmed) !== undefined) {
      const list = parseList(lines, index, options);
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
