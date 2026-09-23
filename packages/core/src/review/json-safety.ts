/**
 * Scans JSON text for duplicate-object-key and pathological-nesting hazards
 * before it is ever handed to `JSON.parse` (Story TST-030 HIGH-2, code
 * review round 2). `JSON.parse` itself is the parser: unlike a hand-written
 * recursive-descent parser that builds objects via `obj[key] = value` (which
 * lets a `"__proto__"` key reach the `Object.prototype.__proto__` accessor
 * and repoint the object's own prototype, and which cannot represent two
 * same-named keys to detect a duplicate after the fact), `JSON.parse`
 * defines each property directly rather than through `[[Set]]`, so a
 * `"__proto__"` key becomes an ordinary own data property. This module never
 * re-implements parsing; it only rejects a document `JSON.parse` would
 * otherwise silently resolve by keeping the last of two duplicate keys, or
 * recurse into deeply enough to be a concern.
 *
 * Ported, not imported, from `goal-plan-artifacts.ts`'s `scanJsonSafety`
 * (same algorithm): that file is being rewritten on another branch
 * (TST-029), so this copy avoids a cross-branch merge conflict. The two are
 * expected to be deduplicated after both land.
 */

/**
 * `undefined` when `text` is safe to hand to `JSON.parse`; otherwise a
 * fixed, static failure reason, one of a small closed set of literal
 * strings. None of them ever quotes `text` itself (a duplicated key's name
 * included) — callers that must never echo untrusted document content
 * (Story TST-030 HIGH-1) can surface these messages directly, or classify
 * `JSON_SAFETY_DUPLICATE_KEY_MESSAGE`/`JSON_SAFETY_DEPTH_EXCEEDED_MESSAGE`
 * for a more specific, still field-path-free wording; see
 * `readiness-sidecar.ts`'s own re-wording.
 */
export function scanJsonSafety(
  text: string,
  maxDepth: number,
): string | undefined {
  let index = 0;
  let scanFailure: string | undefined;

  const fail = (message: string): false => {
    if (scanFailure === undefined) scanFailure = message;
    return false;
  };

  const skipWhitespace = (): void => {
    while (
      index < text.length &&
      (text[index] === " " ||
        text[index] === "\t" ||
        text[index] === "\n" ||
        text[index] === "\r")
    ) {
      index += 1;
    }
  };

  const readString = (): string | undefined => {
    if (text[index] !== '"') {
      fail("JSON string expected");
      return undefined;
    }
    const start = index;
    index += 1;
    while (index < text.length) {
      const character = text[index];
      if (character === '"') {
        index += 1;
        try {
          const value = JSON.parse(text.slice(start, index)) as unknown;
          if (typeof value !== "string") {
            fail("JSON object key is not a string");
            return undefined;
          }
          return value;
        } catch {
          fail("JSON string is malformed");
          return undefined;
        }
      }
      if (character === "\\") {
        index += 1;
        if (index >= text.length) {
          fail("JSON escape is incomplete");
          return undefined;
        }
        const escape = text[index];
        if (escape === "u") {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(index + 1, index + 5))) {
            fail("JSON unicode escape is malformed");
            return undefined;
          }
          index += 5;
        } else if ('"\\/bfnrt'.includes(escape ?? "")) {
          index += 1;
        } else {
          fail("JSON escape is malformed");
          return undefined;
        }
        continue;
      }
      if ((character?.charCodeAt(0) ?? 0) < 0x20) {
        fail("JSON string contains an unescaped control character");
        return undefined;
      }
      index += 1;
    }
    fail("JSON string is unterminated");
    return undefined;
  };

  const readValue = (depth: number): boolean => {
    if (depth > maxDepth)
      return fail("JSON nesting exceeds the supported depth");
    skipWhitespace();
    const character = text[index];
    if (character === "{") {
      index += 1;
      skipWhitespace();
      const keys = new Set<string>();
      if (text[index] === "}") {
        index += 1;
        return true;
      }
      while (index < text.length) {
        const key = readString();
        if (key === undefined) return false;
        // A fixed, static message (code review round 3 LOW): the docstring
        // above promises the duplicated key's own name is never quoted, so
        // the code must not quote it either, however harmless a single
        // instance might look.
        if (keys.has(key)) return fail(JSON_SAFETY_DUPLICATE_KEY_MESSAGE);
        keys.add(key);
        skipWhitespace();
        if (text[index] !== ":") return fail("JSON object key lacks a colon");
        index += 1;
        if (!readValue(depth + 1)) return false;
        skipWhitespace();
        if (text[index] === "}") {
          index += 1;
          return true;
        }
        if (text[index] !== ",") return fail("JSON object lacks a separator");
        index += 1;
        skipWhitespace();
      }
      return fail("JSON object is unterminated");
    }
    if (character === "[") {
      index += 1;
      skipWhitespace();
      if (text[index] === "]") {
        index += 1;
        return true;
      }
      while (index < text.length) {
        if (!readValue(depth + 1)) return false;
        skipWhitespace();
        if (text[index] === "]") {
          index += 1;
          return true;
        }
        if (text[index] !== ",") return fail("JSON array lacks a separator");
        index += 1;
        skipWhitespace();
      }
      return fail("JSON array is unterminated");
    }
    if (character === '"') return readString() !== undefined;
    if (text.startsWith("true", index)) {
      index += 4;
      return true;
    }
    if (text.startsWith("false", index)) {
      index += 5;
      return true;
    }
    if (text.startsWith("null", index)) {
      index += 4;
      return true;
    }
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(
      text.slice(index),
    );
    if (number !== null) {
      index += number[0].length;
      return true;
    }
    return fail("JSON value is malformed");
  };

  skipWhitespace();
  if (!readValue(0)) return scanFailure ?? "JSON is malformed";
  skipWhitespace();
  if (index !== text.length) return "JSON contains trailing data";
  return scanFailure;
}

/** The one fixed failure reason `scanJsonSafety` returns for exceeding `maxDepth`, so a caller can classify it (a size/complexity limit) without matching on any other message. */
export const JSON_SAFETY_DEPTH_EXCEEDED_MESSAGE =
  "JSON nesting exceeds the supported depth";

/** The one fixed failure reason `scanJsonSafety` returns for a duplicate object key — never the key's own name — so a caller can classify it for a more specific, still content-free message. */
export const JSON_SAFETY_DUPLICATE_KEY_MESSAGE =
  "JSON object key is duplicated";
