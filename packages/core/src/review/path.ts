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
