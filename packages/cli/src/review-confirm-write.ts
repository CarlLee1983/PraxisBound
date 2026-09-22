/**
 * Building and writing one Definition Confirmation record (contract §8 step
 * 6). Split out of `review-confirm.ts` so that file stays focused on
 * orchestration.
 *
 * H2 (review round 1): before writing, the built record is re-validated
 * through Core's own `validateStoredConfirmationRecord` and its serialized
 * byte length is checked against §13's 1 MiB record bound — a defense in
 * depth against a code-level inconsistency, since the interactive prompt
 * (`review-confirm-interact.ts`) already rejects an oversized or
 * hidden-character deferral reason at input time.
 *
 * H3 (review round 1): confirm reads only its own write target,
 * `records/confirmation-<fp12>.json` — never the wider `confirmation-*.json`
 * collection (that full scan belongs to `review render`'s advisory
 * staleness diagnostics, `review-confirmation-records.ts`). The create-new
 * write is attempted first, exclusively; only an `EEXIST`-shaped failure
 * (the final file now exists although this call never created it) is
 * followed by a read of that one target, mapped to `REVIEW_CONFIRMATION_EXISTS`
 * or `REVIEW_RECORD_COLLISION` per contract §8 step 6's literal wording
 * ("內容完整指紋相同" — same `fingerprint` value in content, not full-byte
 * equality). Any other write failure (including an injected one) leaves no
 * file at all, so it is never mistaken for a collision.
 */

import { lstat } from "node:fs/promises";
import { resolve } from "node:path";

import {
  validateStoredConfirmationRecord,
  type ConfirmationData,
} from "@praxisbound/core";

import {
  createNewRecord,
  parseRecordJson,
  readRecordBytes,
  recordsDirectory,
  type RecordFilesystem,
} from "./review-records.js";

export const CONFIRMATION_RECORD_MAX_BYTES = 1024 * 1024;

export type BuildConfirmationRecordResult =
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly reason: "invalid" | "too-large" };

/** H2: validates the record this command is about to write, and bounds its serialized size, before any write is attempted. */
export function buildConfirmationRecordBytes(
  record: ConfirmationData,
): BuildConfirmationRecordResult {
  const validated = validateStoredConfirmationRecord(record, record.batchId);
  if (!validated.ok) return { ok: false, reason: "invalid" };
  const bytes = new TextEncoder().encode(JSON.stringify(record));
  if (bytes.length > CONFIRMATION_RECORD_MAX_BYTES)
    return { ok: false, reason: "too-large" };
  return { ok: true, bytes };
}

export type WriteConfirmationResult =
  | { readonly kind: "written"; readonly relativePath: string }
  | {
      readonly kind: "exists";
      readonly path: string;
      readonly deferred: ConfirmationData["deferred"];
    }
  | { readonly kind: "collision"; readonly path: string }
  | { readonly kind: "unsafe" }
  | { readonly kind: "write-failed" };

/** True when `targetRelativePath` exists as a regular file (never following a symlink), the plain existence signal that distinguishes a genuine write failure from an `EEXIST` race. */
async function targetExists(
  root: string,
  targetRelativePath: string,
): Promise<boolean> {
  try {
    const stats = await lstat(resolve(root, targetRelativePath));
    return stats.isFile();
  } catch {
    return false;
  }
}

/** Reads and validates exactly one `records/confirmation-<fp12>.json`, the sole file H3's EEXIST branch is ever allowed to look at. */
async function readTargetConfirmation(
  root: string,
  batchId: string,
  targetRelativePath: string,
): Promise<ConfirmationData | undefined> {
  const bytes = await readRecordBytes(resolve(root, targetRelativePath));
  if (bytes === undefined) return undefined;
  const parsed = parseRecordJson(bytes);
  if (!parsed.ok) return undefined;
  const validated = validateStoredConfirmationRecord(parsed.data, batchId);
  return validated.ok ? validated.record : undefined;
}

/**
 * Attempts one exclusive create-new write to `records/confirmation-<fp12>.json`;
 * on `EEXIST` (this call did not create the file but it now exists), reads
 * that one target and maps it to `exists`/`collision` per contract §8 step
 * 6. Never scans or bounds the wider `confirmation-*.json` collection (H3).
 */
export async function writeConfirmationRecord(
  root: string,
  manifestPath: string,
  batchId: string,
  fingerprint: string,
  bytes: Uint8Array,
  options: { readonly filesystem?: RecordFilesystem } = {},
): Promise<WriteConfirmationResult> {
  const fp12 = fingerprint.slice(0, 12);
  const targetName = `confirmation-${fp12}.json`;
  const targetRelativePath = `${recordsDirectory(manifestPath)}/${targetName}`;

  const written = await createNewRecord(
    root,
    manifestPath,
    () => targetName,
    bytes,
    {
      maxAttempts: 1,
      ...(options.filesystem === undefined
        ? {}
        : { filesystem: options.filesystem }),
    },
  );
  if (written.ok)
    return { kind: "written", relativePath: written.relativePath };
  if (written.reason === "unsafe") return { kind: "unsafe" };

  // `written.reason === "write-failed"`: `createNewRecord` never leaves the
  // final target in place unless a prior write already occupied that exact
  // name (create-new's own discipline — every other failure path unlinks
  // whatever it created before returning). So the target existing now is
  // the one-and-only signal this really was an `EEXIST` race against an
  // existing (or concurrently written) confirmation, not a genuine failure
  // (disk error, an injected filesystem fault, …), which never leaves a
  // readable file behind at all.
  if (!(await targetExists(root, targetRelativePath)))
    return { kind: "write-failed" };

  const existing = await readTargetConfirmation(
    root,
    batchId,
    targetRelativePath,
  );
  // The target exists: same fingerprint content is `exists`; anything else
  // — different content, or content that fails validation outright — is a
  // collision. Only the read's own success and a matching `fingerprint`
  // ever counts as the same act (never "close enough").
  if (existing !== undefined && existing.fingerprint === fingerprint)
    return {
      kind: "exists",
      path: targetRelativePath,
      deferred: existing.deferred,
    };
  return { kind: "collision", path: targetRelativePath };
}
