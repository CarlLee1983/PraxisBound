/**
 * The Requirement Fingerprint, contract §4, byte for byte.
 *
 * `node:crypto` is a pure hashing primitive, not filesystem, process, or
 * clock access, so its use here does not violate the review module's I/O-free
 * contract (Story TST-021 R9 / AC-011).
 */

import { createHash } from "node:crypto";

import type { SourceDigest } from "./types.js";

/** The raw-byte SHA-256 of one file's exact bytes, lowercase hex. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * The fixed-shape canonical JSON contract §4 defines: object keys in the
 * documented order, no extraneous whitespace, JSON-standard string escaping,
 * non-ASCII left unescaped, and no trailing newline. `JSON.stringify` of a
 * single string already satisfies JSON-standard escaping without an ASCII
 * bias, so it is reused as the primitive rather than reimplemented.
 */
export function canonicalManifestJson(
  manifestSha256: string,
  sources: readonly SourceDigest[],
): string {
  const sourcesJson = sources
    .map(
      (source) =>
        `{"path":${JSON.stringify(source.path)},"sha256":${
          source.sha256 === null ? "null" : JSON.stringify(source.sha256)
        }}`,
    )
    .join(",");

  return `{"manifest":${JSON.stringify(manifestSha256)},"sources":[${sourcesJson}]}`;
}

/** The Requirement Fingerprint: `sha256(UTF-8(canonicalJson(...)))`, lowercase hex. */
export function computeFingerprint(
  manifestSha256: string,
  sources: readonly SourceDigest[],
): string {
  const canonical = canonicalManifestJson(manifestSha256, sources);
  return sha256Hex(new TextEncoder().encode(canonical));
}
