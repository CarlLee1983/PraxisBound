/**
 * Path syntax and text-escaping helpers shared by the review module.
 *
 * This module never touches a filesystem: it recognizes an unsafe path by
 * its characters only. The physical symlink/escape check belongs to the CLI
 * adapter, which owns directory facts (contract section 3, Story TST-021 R6).
 *
 * Control-character ranges are compared as code points rather than encoded
 * as regular-expression escapes, so this source file never carries a raw
 * control character or line-separator code point itself.
 */

const LINE_SEPARATOR = 0x2028;
const PARAGRAPH_SEPARATOR = 0x2029;

function isControlCodePoint(codePoint: number): boolean {
  return (
    codePoint <= 0x1f ||
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    codePoint === LINE_SEPARATOR ||
    codePoint === PARAGRAPH_SEPARATOR
  );
}

/**
 * A code point that can hide or reorder rendered text without itself
 * producing a visible glyph: every `isControlCodePoint` code point, plus the
 * zero-width/marker block U+200B–U+200F, the bidi embedding/override
 * controls U+202A–U+202E, the bidi isolate controls U+2066–U+2069, and the
 * byte-order mark U+FEFF. The one shared definition for every place
 * untrusted text reaches a human reader — a CLI issue message and the
 * Review Projection's evidence area both escape exactly this set, so
 * neither can be tightened or loosened without the other noticing.
 */
export function isHiddenOrReorderingCodePoint(codePoint: number): boolean {
  return (
    isControlCodePoint(codePoint) ||
    (codePoint >= 0x200b && codePoint <= 0x200f) ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2066 && codePoint <= 0x2069) ||
    codePoint === 0xfeff
  );
}

/**
 * Renders untrusted text for a one-line, non-HTML context (a CLI terminal
 * message or a `ResultIssue.message`): every code point
 * `isHiddenOrReorderingCodePoint` names becomes a visible hex escape.
 * Unlike `render-evidence.ts`'s `escapeEvidenceField`/`escapeEvidenceProse`,
 * this never HTML-escapes — it is for contexts that are not markup.
 */
export function escapeHiddenCharacters(value: string): string {
  let out = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    out += isHiddenOrReorderingCodePoint(codePoint)
      ? `\\x${codePoint.toString(16).padStart(codePoint > 0xff ? 4 : 2, "0")}`
      : character;
  }
  return out;
}

/** Recognizes a repo-relative POSIX path with none of the syntactic hazards contract section 3 names. */
export function isSyntacticallySafeRepoPath(path: string): boolean {
  if (path.length === 0 || path.length > 1024) return false;
  if (path.startsWith("/")) return false;
  if (path.includes("\\")) return false;

  for (const character of path) {
    if (isControlCodePoint(character.codePointAt(0) ?? 0)) return false;
  }

  return path
    .split("/")
    .every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/**
 * Renders untrusted text safely for a one-line issue message: every control
 * character (C0, DEL, C1, and the two Unicode line/paragraph separators)
 * becomes a visible hex escape, so a message never carries a raw control
 * character or line break.
 */
export function escapeControlCharacters(value: string): string {
  let out = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (!isControlCodePoint(codePoint)) {
      out += character;
      continue;
    }
    const width = codePoint > 0xff ? 4 : 2;
    out += `\\x${codePoint.toString(16).padStart(width, "0")}`;
  }
  return out;
}

const encoder = new TextEncoder();

/** Compares two strings by their UTF-8 byte sequence, ascending. */
export function compareUtf8(a: string, b: string): number {
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  const length = Math.min(aBytes.length, bBytes.length);

  for (let index = 0; index < length; index += 1) {
    const diff = (aBytes[index] ?? 0) - (bBytes[index] ?? 0);
    if (diff !== 0) return diff;
  }

  return aBytes.length - bBytes.length;
}
