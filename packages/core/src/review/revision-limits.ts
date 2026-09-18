/**
 * Shared §13 limits, patterns, and hand-written schema-validation primitives
 * for the Revision Sheet (`revision-sheet.ts`) and Revision Response
 * (`revision-responses.ts`) records: both are validated against
 * `defs.schema.json` shapes the two schemas share (`locator`, `text`,
 * `utcTime`, `batchId`, `repoPath`). This module never touches a
 * filesystem, process, or clock.
 */

export const MAX_TEXT_BYTES = 65536;
export const MAX_RECORD_BYTES = 1024 * 1024;
export const MAX_LIST_ITEMS = 1000;
export const MAX_NESTING_DEPTH = 32;
export const MAX_LOCATOR_FIELD_LENGTH = 1024;
export const MAX_BATCH_ID_LENGTH = 128;

export const SHA256_PATTERN = /^[a-f0-9]{64}$/;
export const REVISION_ID_PATTERN = /^REV-[0-9A-HJKMNP-TV-Z]{26}$/;
export const UTC_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(\.\d+)?Z$/;
export const BATCH_ID_PATTERN =
  /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-[0-9]+(?:-[a-z0-9]+(?:-[a-z0-9]+)*)?$/;

// Ported byte for byte from the embedded page script's `REPO_PATH_PATTERN`
// (`annotation-logic.ts`) so the two share one judgement (Story TST-024
// AC-005 parity, M5): the excluded ranges are deliberately literal control
// characters (C0, DEL, C1) and the two Unicode line separators, not a typo.
export const REPO_PATH_PATTERN = new RegExp(
  // eslint-disable-next-line no-control-regex -- the excluded ranges are deliberate (see comment above)
  "^(?!/)(?!.*(?:^|/)\\.\\.?(?:/|$))(?!.*//)[^\\\\\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]+$",
);

const LOCATOR_KEYS = ["path", "anchor", "blockSha256"];

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Unicode code-point length, matching the schema's `maxLength` (UTF-16 code units are not code points). */
export function codePointLength(text: string): number {
  return [...text].length;
}

export function unknownKey(
  object: Record<string, unknown>,
  allowed: readonly string[],
): string | undefined {
  return Object.keys(object).find((key) => !allowed.includes(key));
}

/** `\r\n` and a lone `\r` both become `\n` (same rule the page's restore and same-content judgement use). */
export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/** Same as the schema's `date-time` pattern plus a real calendar check; a leap second is legal only at UTC 23:59:60. */
export function isUtcDateTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = UTC_TIME_PATTERN.exec(value);
  if (!match) return false;
  const parts = match.slice(1, 7).map(Number);
  const leap = parts[5] === 60;
  if (leap && (parts[3] !== 23 || parts[4] !== 59)) return false;
  const seconds = leap ? 59 : (parts[5] ?? 0);
  const date = new Date(0);
  date.setUTCFullYear(parts[0] ?? 0, (parts[1] ?? 1) - 1, parts[2]);
  date.setUTCHours(parts[3] ?? 0, parts[4] ?? 0, seconds, 0);
  return (
    date.getUTCFullYear() === parts[0] &&
    date.getUTCMonth() === (parts[1] ?? 1) - 1 &&
    date.getUTCDate() === parts[2] &&
    date.getUTCHours() === parts[3] &&
    date.getUTCMinutes() === parts[4] &&
    date.getUTCSeconds() === seconds
  );
}

/** Standard UTC form: uppercase `T`, trailing-zero-trimmed fractional seconds, trailing `Z`; a leap second keeps `:60`. */
export function canonicalUtcTime(value: string): string {
  const match = UTC_TIME_PATTERN.exec(value);
  if (!match) return value;
  let fraction = (match[7] ?? "").replace(/0+$/, "");
  if (fraction === ".") fraction = "";
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}${fraction}Z`;
}

/** Scans the raw fenced/file text's bracket nesting depth before `JSON.parse`, so a pathological input is never recursed into. */
export function rawJsonMaxDepth(text: string): number {
  let depth = 0;
  let max = 0;
  let inString = false;
  let escape = false;
  for (const ch of text) {
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") {
      depth += 1;
      if (depth > max) max = depth;
    } else if (ch === "}" || ch === "]") depth -= 1;
  }
  return max;
}

/**
 * A generic, position-only rendering of a `JSON.parse` failure: never
 * echoes the attacker-supplied text `SyntaxError#message` may quote
 * verbatim (M3). Only the numeric byte offset V8 reports is kept.
 */
export function jsonParseFailureMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : "";
  const position = /position (\d+)/.exec(raw)?.[1];
  return position === undefined
    ? "JSON parse failed"
    : `JSON parse failed at position ${position}`;
}

export interface FieldProblem {
  readonly message: string;
  readonly tooLarge: boolean;
  readonly unsupportedSchema: boolean;
}

export function problem(
  message: string,
  tooLarge = false,
  unsupportedSchema = false,
): FieldProblem {
  return { message, tooLarge, unsupportedSchema };
}

export function textFieldProblem(
  value: unknown,
  name: string,
): FieldProblem | undefined {
  if (typeof value !== "string") return problem(`${name} must be a string`);
  if (utf8Length(value) > MAX_TEXT_BYTES)
    return problem(`${name} exceeds the string limit (64 KiB, UTF-8)`, true);
  return undefined;
}

/** Same shape and bound (§13's 1024-character locator fields) the schema's non-`text` bounded strings share. */
export function boundedStringProblem(
  value: unknown,
  name: string,
): FieldProblem | undefined {
  if (typeof value !== "string" || value.length === 0)
    return problem(`${name} must be a non-empty string`);
  if (
    value.length > MAX_LOCATOR_FIELD_LENGTH * 2 ||
    codePointLength(value) > MAX_LOCATOR_FIELD_LENGTH
  )
    return problem(`${name} exceeds ${MAX_LOCATOR_FIELD_LENGTH} characters`);
  return undefined;
}

/** Same field-by-field shape as `defs.schema.json`'s `locator`, shared by a Revision target and a Response locator. */
export function validateLocatorShape(
  target: unknown,
): FieldProblem | undefined {
  if (!isRecord(target)) return problem("a locator must be an object");
  const extra = unknownKey(target, LOCATOR_KEYS);
  if (extra !== undefined) return problem("locator has an unknown field");
  const pathProblem = boundedStringProblem(target.path, "locator path");
  if (pathProblem) return pathProblem;
  if (!REPO_PATH_PATTERN.test(target.path as string))
    return problem("locator path has an invalid form");
  const anchorProblem = boundedStringProblem(target.anchor, "locator anchor");
  if (anchorProblem) return anchorProblem;
  if (
    typeof target.blockSha256 !== "string" ||
    !SHA256_PATTERN.test(target.blockSha256)
  )
    return problem("locator blockSha256 has an invalid form");
  return undefined;
}
