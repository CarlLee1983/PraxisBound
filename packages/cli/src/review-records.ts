/**
 * Filesystem access to `records/revisions-*.json` and `records/responses-*.json`
 * shared by `review import` and `review respond`: safe-directory checks,
 * bounded reads, validating every existing record (contract §2, §6 修訂，
 * R-005, §7 修訂，R-005), cross-record consistency (security M2), and
 * atomic create-new writes (security M7/L2). Kept separate from `review.ts`
 * so that file does not keep growing (Story TST-024).
 */

import { constants } from "node:fs";
import {
  link as fsLink,
  lstat as fsLstat,
  mkdir as fsMkdir,
  open as fsOpen,
  readdir,
  realpath as fsRealpath,
  unlink as fsUnlink,
} from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";

import {
  rawJsonMaxDepth,
  validateStoredResponsesRecord,
  validateStoredRevisionRecord,
  type RevisionResponsesData,
  type RevisionSheetData,
} from "@praxisbound/core";

import { findUnsafeSourcePath } from "./review-paths.js";

export const RECORD_MAX_BYTES = 1024 * 1024;
const MAX_NESTING_DEPTH = 32;

const REVISION_RECORD_STRICT = /^revisions-([0-9a-f]{12})\.json$/;
const RESPONSE_RECORD_STRICT = /^responses-([0-9a-f]{12})-([1-9][0-9]*)\.json$/;

function isLooseRevisionName(name: string): boolean {
  return name.startsWith("revisions-") && name.endsWith(".json");
}
function isLooseResponseName(name: string): boolean {
  return name.startsWith("responses-") && name.endsWith(".json");
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** `specs/batches/<BATCH-ID>/records`, relative to `root`, derived from the manifest's own relative path. */
export function recordsDirectory(manifestPath: string): string {
  return `${dirname(manifestPath).split("\\").join("/")}/records`;
}

/** True when `records/` or any of its parent segments is a symlink (contract §2, R12). */
export async function isRecordsPathUnsafe(
  root: string,
  manifestPath: string,
): Promise<boolean> {
  const unsafe = await findUnsafeSourcePath(root, [
    recordsDirectory(manifestPath),
  ]);
  return unsafe !== undefined;
}

/**
 * Reads at most `max` bytes from `handle`, starting at its current
 * position; returns `undefined` when the file holds more than `max` bytes,
 * without ever buffering more than `max + 1` (security L1).
 */
export async function readBounded(
  handle: {
    read(
      buffer: Uint8Array,
      offset: number,
      length: number,
      position: number | null,
    ): Promise<{ bytesRead: number }>;
  },
  max: number,
): Promise<Uint8Array | undefined> {
  const buffer = new Uint8Array(max + 1);
  let total = 0;
  for (;;) {
    const { bytesRead } = await handle.read(
      buffer,
      total,
      buffer.length - total,
      null,
    );
    if (bytesRead === 0) break;
    total += bytesRead;
    if (total > max) return undefined;
  }
  return buffer.subarray(0, total);
}

async function readRecordBytes(
  absolute: string,
): Promise<Uint8Array | undefined> {
  let handle;
  try {
    handle = await fsOpen(
      absolute,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch {
    return undefined;
  }
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) return undefined;
    if (stats.size > RECORD_MAX_BYTES) return undefined;
    return await readBounded(handle, RECORD_MAX_BYTES);
  } catch {
    return undefined;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

export interface InvalidRecord {
  readonly path: string;
}

export interface ValidRevisionRecord {
  readonly path: string;
  readonly sha256: string;
  readonly sheet: RevisionSheetData;
}

export interface RevisionRecordsRead {
  readonly invalid: readonly InvalidRecord[];
  /** `records/revisions-<sheet12>.json` content, keyed by its own sha256 (the identity `respond` checks `revisionSheets` entries against). */
  readonly bySha256: ReadonlyMap<string, RevisionSheetData>;
  /** Every valid record, with its repo-relative path, for cross-record checks that must name a file (security M2). */
  readonly records: readonly ValidRevisionRecord[];
}

function parseRecordJson(
  bytes: Uint8Array,
): { readonly ok: true; readonly data: unknown } | { readonly ok: false } {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false };
  }
  if (rawJsonMaxDepth(text) > MAX_NESTING_DEPTH) return { ok: false };
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/** Reads and validates every `records/revisions-*.json` under `records/` (contract §2, §6 修訂，R-005). */
export async function readRevisionRecords(
  root: string,
  manifestPath: string,
  batchId: string,
  /** Pre-fetched `records/` directory entries (from `listRecordsDirectory`), so a caller that already listed the directory never lists it twice. Falls back to its own `readdir` when omitted, treating any failure as "no records" (unchanged behavior for `review import`/`review respond`). */
  names?: readonly string[],
): Promise<RevisionRecordsRead> {
  let entries: string[];
  if (names !== undefined) {
    entries = names.filter(isLooseRevisionName);
  } else {
    const directory = resolve(root, recordsDirectory(manifestPath));
    try {
      entries = (await readdir(directory)).filter(isLooseRevisionName);
    } catch {
      return { invalid: [], bySha256: new Map(), records: [] };
    }
  }

  const invalid: InvalidRecord[] = [];
  const bySha256 = new Map<string, RevisionSheetData>();
  const records: ValidRevisionRecord[] = [];
  for (const name of entries.sort()) {
    const relativePath = `${recordsDirectory(manifestPath)}/${name}`;
    const match = REVISION_RECORD_STRICT.exec(name);
    if (match === null) {
      invalid.push({ path: relativePath });
      continue;
    }
    const bytes = await readRecordBytes(resolve(root, relativePath));
    if (bytes === undefined) {
      invalid.push({ path: relativePath });
      continue;
    }
    const digest = sha256Hex(bytes);
    if (digest.slice(0, 12) !== match[1]) {
      invalid.push({ path: relativePath });
      continue;
    }
    const parsed = parseRecordJson(bytes);
    if (!parsed.ok) {
      invalid.push({ path: relativePath });
      continue;
    }
    const validated = validateStoredRevisionRecord(parsed.data, batchId);
    if (!validated.ok) {
      invalid.push({ path: relativePath });
      continue;
    }
    bySha256.set(digest, validated.sheet);
    records.push({
      path: relativePath,
      sha256: digest,
      sheet: validated.sheet,
    });
  }
  return { invalid, bySha256, records };
}

export interface ValidResponseRecord {
  readonly path: string;
  readonly record: RevisionResponsesData;
}

export interface ResponseRecordsRead {
  readonly invalid: readonly InvalidRecord[];
  /** Every valid record, with its repo-relative path (needed by the projection's evidence area, contract §20 修訂，R-005). */
  readonly records: readonly ValidResponseRecord[];
}

/** Reads and validates every `records/responses-*.json` under `records/` (contract §7 修訂，R-005). */
export async function readResponseRecords(
  root: string,
  manifestPath: string,
  batchId: string,
  /** Same pre-fetched-listing contract as `readRevisionRecords`. */
  names?: readonly string[],
): Promise<ResponseRecordsRead> {
  let entries: string[];
  if (names !== undefined) {
    entries = names.filter(isLooseResponseName);
  } else {
    const directory = resolve(root, recordsDirectory(manifestPath));
    try {
      entries = (await readdir(directory)).filter(isLooseResponseName);
    } catch {
      return { invalid: [], records: [] };
    }
  }

  const invalid: InvalidRecord[] = [];
  const records: ValidResponseRecord[] = [];
  for (const name of entries.sort()) {
    const relativePath = `${recordsDirectory(manifestPath)}/${name}`;
    const match = RESPONSE_RECORD_STRICT.exec(name);
    if (match === null) {
      invalid.push({ path: relativePath });
      continue;
    }
    const bytes = await readRecordBytes(resolve(root, relativePath));
    if (bytes === undefined) {
      invalid.push({ path: relativePath });
      continue;
    }
    const parsed = parseRecordJson(bytes);
    if (!parsed.ok) {
      invalid.push({ path: relativePath });
      continue;
    }
    const validated = validateStoredResponsesRecord(parsed.data, batchId);
    if (
      !validated.ok ||
      validated.record.toFingerprint.slice(0, 12) !== match[1]
    ) {
      invalid.push({ path: relativePath });
      continue;
    }
    records.push({ path: relativePath, record: validated.record });
  }
  return { invalid, records };
}

export interface RecordFileNameCounts {
  /** Files matching the loose `revisions-*.json` name (including invalid ones), counted by name only. */
  readonly revisionsNames: number;
  /** Files matching the loose `responses-*.json` name (including invalid ones), counted by name only. */
  readonly responsesNames: number;
}

/**
 * Counts already-listed `records/` entries by name only, before any file is
 * opened (contract §13/§20 修訂，R-005: the 200-file bound is checked by
 * name first so an over-large collection never causes any record content to
 * be read). Pure: takes the listing `listRecordsDirectory` already read,
 * rather than reading the directory itself.
 */
export function countLooseRecordFileNames(
  names: readonly string[],
): RecordFileNameCounts {
  return {
    revisionsNames: names.filter(isLooseRevisionName).length,
    responsesNames: names.filter(isLooseResponseName).length,
  };
}

export type RecordsDirectoryListing =
  | { readonly ok: true; readonly names: readonly string[] }
  | { readonly ok: false; readonly reason: "not-found" }
  | { readonly ok: false; readonly reason: "error" };

/**
 * Lists `records/` once, distinguishing "the directory does not exist" (the
 * ordinary, silent case every reader already treats as "no records") from
 * any other failure to read it (permission denied, not a directory, …),
 * which the caller must diagnose rather than silently treat as empty. The
 * one listing this returns is meant to be reused by both a file-name count
 * and `readRevisionRecords`/`readResponseRecords`, so `records/` is read
 * from disk at most once per command run.
 */
export async function listRecordsDirectory(
  root: string,
  manifestPath: string,
): Promise<RecordsDirectoryListing> {
  const directory = resolve(root, recordsDirectory(manifestPath));
  try {
    return { ok: true, names: await readdir(directory) };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return { ok: false, reason: code === "ENOENT" ? "not-found" : "error" };
  }
}

/** The filesystem primitives a create-new write uses; injectable so a test can force the "temp created, then the write itself fails" branch (security M7). */
export interface RecordFilesystem {
  readonly mkdir: typeof fsMkdir;
  readonly open: typeof fsOpen;
  readonly link: typeof fsLink;
  readonly unlink: typeof fsUnlink;
  readonly lstat: typeof fsLstat;
  readonly realpath: typeof fsRealpath;
}

export const defaultRecordFilesystem: RecordFilesystem = {
  mkdir: fsMkdir,
  open: fsOpen,
  link: fsLink,
  unlink: fsUnlink,
  lstat: fsLstat,
  realpath: fsRealpath,
};

export type CreateNewRecordResult =
  | { readonly ok: true; readonly relativePath: string }
  | { readonly ok: false; readonly reason: "unsafe" | "write-failed" };

/**
 * True when `recordsDirAbsolute` resolves, by real filesystem identity, to
 * exactly `root`'s `recordsDirectory(manifestPath)` — a second check run
 * right before the write, guarding the window between the pre-write safety
 * check and the write itself (security M1 TOCTOU): a symlink swapped in
 * during that window changes the realpath even when every lstat segment
 * check already ran once before it existed.
 */
async function recordsDirectoryIdentityOk(
  root: string,
  manifestPath: string,
  recordsDirAbsolute: string,
  filesystem: RecordFilesystem,
): Promise<boolean> {
  try {
    const realRoot = await filesystem.realpath(root);
    const realRecords = await filesystem.realpath(recordsDirAbsolute);
    const expected = resolve(realRoot, recordsDirectory(manifestPath));
    return realRecords === expected;
  } catch {
    return false;
  }
}

/**
 * Writes `bytes` verbatim to a fresh record path built from `nameFor`,
 * exclusively: a temp file is created with `O_EXCL` under a name that can
 * never match a record's own naming pattern, `fsync`ed, then hard-linked to
 * the final name (`EEXIST` on the link tries the next `nameFor(attempt)`,
 * up to `maxAttempts`); the temp file is always unlinked afterward, and the
 * final file's identity is confirmed by `dev`/`ino` before success is
 * reported, so a write can never leave a corrupted or substituted file
 * (security M7/L2). `records/` is created first if missing, and its safety
 * and identity are re-checked right before the link (security M1).
 */
export async function createNewRecord(
  root: string,
  manifestPath: string,
  nameFor: (attempt: number) => string,
  bytes: Uint8Array,
  options: {
    readonly maxAttempts?: number;
    readonly filesystem?: RecordFilesystem;
  } = {},
): Promise<CreateNewRecordResult> {
  const filesystem = options.filesystem ?? defaultRecordFilesystem;
  const maxAttempts = options.maxAttempts ?? 1;
  const directory = resolve(root, recordsDirectory(manifestPath));

  try {
    await filesystem.mkdir(directory, { recursive: true });
  } catch {
    return { ok: false, reason: "write-failed" };
  }

  if (await isRecordsPathUnsafe(root, manifestPath))
    return { ok: false, reason: "unsafe" };
  if (
    !(await recordsDirectoryIdentityOk(
      root,
      manifestPath,
      directory,
      filesystem,
    ))
  )
    return { ok: false, reason: "unsafe" };

  const tempName = `.write-${randomUUID()}.tmp`;
  const tempAbsolute = resolve(directory, tempName);
  let handle: Awaited<ReturnType<typeof fsOpen>> | undefined;
  let tempCreated = false;
  let tempDev: number | undefined;
  let tempIno: number | undefined;
  try {
    handle = await filesystem.open(
      tempAbsolute,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    tempCreated = true;
    await handle.writeFile(bytes);
    await handle.sync();
    const stats = await handle.stat();
    tempDev = stats.dev;
    tempIno = stats.ino;
    await handle.close();
    handle = undefined;
  } catch {
    if (handle !== undefined) await handle.close().catch(() => undefined);
    if (tempCreated)
      await filesystem.unlink(tempAbsolute).catch(() => undefined);
    return { ok: false, reason: "write-failed" };
  }

  try {
    if (
      !(await recordsDirectoryIdentityOk(
        root,
        manifestPath,
        directory,
        filesystem,
      ))
    )
      return { ok: false, reason: "unsafe" };

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const name = nameFor(attempt);
      const finalAbsolute = resolve(directory, name);
      try {
        await filesystem.link(tempAbsolute, finalAbsolute);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "EEXIST" && attempt < maxAttempts) continue;
        return { ok: false, reason: "write-failed" };
      }

      const finalStats = await filesystem
        .lstat(finalAbsolute)
        .catch(() => undefined);
      if (
        finalStats === undefined ||
        finalStats.dev !== tempDev ||
        finalStats.ino !== tempIno
      ) {
        await filesystem.unlink(finalAbsolute).catch(() => undefined);
        return { ok: false, reason: "write-failed" };
      }
      return {
        ok: true,
        relativePath: `${recordsDirectory(manifestPath)}/${name}`,
      };
    }
    return { ok: false, reason: "write-failed" };
  } finally {
    await filesystem.unlink(tempAbsolute).catch(() => undefined);
  }
}
