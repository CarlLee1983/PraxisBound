/**
 * The shared Markdown declaration subset every PraxisBound contract reader uses.
 *
 * This module is internal to Core. It owns fences and heading scope; callers
 * own meaning, so one parsing subset serves every declaration section.
 */

/** One `* label: value` bullet, or an entry that is not a declaration. */
export type Declaration =
  | {
      readonly kind: "declaration";
      readonly label: string;
      readonly value: string;
    }
  | { readonly kind: "entry"; readonly text: string };

export interface DeclarationSection {
  /** How many times the heading itself was declared. */
  readonly count: number;
  /** Every bullet of every occurrence, in document order. */
  readonly entries: readonly Declaration[];
}

const placeholders = new Set([
  "*",
  "-",
  "TBD",
  "tbd",
  "TODO",
  "todo",
  "N/A",
  "n/a",
  "...",
]);

/**
 * Trims exactly the whitespace the portable checker trims: carriage return,
 * tab, and space. Every other code point, Unicode whitespace included, is
 * content.
 */
function isDeclarationSpace(character: string | undefined): boolean {
  return character === " " || character === "\t" || character === "\r";
}

// Index scans, not `/[ \t\r]+$/`: that regex retries from every position of a
// long whitespace run followed by other text, which is quadratic.
export function trimDeclarationText(line: string): string {
  let start = 0;
  let end = line.length;
  while (start < end && isDeclarationSpace(line[start])) start += 1;
  while (end > start && isDeclarationSpace(line[end - 1])) end -= 1;
  return line.slice(start, end);
}

const trim = trimDeclarationText;

function fenceRun(line: string, character: string): number {
  let run = 0;
  while (line[run] === character) run += 1;
  return run;
}

/** Splits one raw bullet into a `label: value` declaration, or an entry. */
export function splitDeclaration(bullet: string): Declaration {
  const separator = bullet.indexOf(": ");
  let label: string;
  let value: string;

  if (separator >= 0) {
    label = bullet.slice(0, separator);
    value = bullet.slice(separator + 2);
  } else if (bullet.endsWith(":")) {
    label = bullet.slice(0, -1);
    value = "";
  } else {
    return { kind: "entry", text: bullet };
  }

  label = trim(label);
  return label === ""
    ? { kind: "entry", text: bullet }
    : { kind: "declaration", label, value: trim(value) };
}

/**
 * Yields every trimmed source line that is neither inside nor part of a fenced
 * block. Every declaration reader shares this one fence subset.
 */
export function* readContentLines(source: string): Generator<string> {
  let fenceCharacter = "";
  let fenceLength = 0;

  for (const rawLine of source.split("\n")) {
    const line = trim(rawLine);

    if (fenceLength === 0) {
      const character = line.startsWith("`")
        ? "`"
        : line.startsWith("~")
          ? "~"
          : "";
      if (character !== "") {
        const run = fenceRun(line, character);
        if (run >= 3) {
          fenceCharacter = character;
          fenceLength = run;
          continue;
        }
      }
    } else {
      if (line.startsWith(fenceCharacter)) {
        const run = fenceRun(line, fenceCharacter);
        if (run >= fenceLength && line.length === run) fenceLength = 0;
      }
      continue;
    }

    yield line;
  }
}

export interface BulletSection {
  /** How many times the heading itself was declared. */
  readonly count: number;
  /** Every non-empty bullet of every occurrence, trimmed, in document order. */
  readonly bullets: readonly string[];
}

/** Reads the raw bullets of one Markdown section, ignoring fenced examples. */
export function readSectionBullets(
  source: string,
  heading: string,
): BulletSection {
  const bullets: string[] = [];
  let count = 0;
  let inSection = false;

  for (const line of readContentLines(source)) {
    if (line.startsWith("#")) {
      inSection = line === heading;
      if (inSection) count += 1;
      continue;
    }
    if (!inSection) continue;

    const bullet =
      line.startsWith("* ") || line.startsWith("- ") ? trim(line.slice(2)) : "";
    if (bullet === "") continue;

    bullets.push(bullet);
  }

  return Object.freeze({ count, bullets: Object.freeze(bullets) });
}

/** Reads the declarations of one Markdown section, ignoring fenced examples. */
export function readDeclarationSection(
  source: string,
  heading: string,
): DeclarationSection {
  const section = readSectionBullets(source, heading);

  return Object.freeze({
    count: section.count,
    entries: Object.freeze(section.bullets.map(splitDeclaration)),
  });
}

/**
 * Recognizes one exact same-line backticked literal. A placeholder such as
 * `TBD` is deliberately not an exact value.
 */
export function readExactLiteral(value: string): string | undefined {
  const trimmed = trim(value);
  if (trimmed.length < 2 || !trimmed.startsWith("`") || !trimmed.endsWith("`"))
    return undefined;

  const inner = trimmed.slice(1, -1);
  if (
    inner === "" ||
    inner.includes("`") ||
    !/[^ \t\r\n\v\f]/.test(inner) ||
    placeholders.has(inner)
  )
    return undefined;

  return inner;
}
