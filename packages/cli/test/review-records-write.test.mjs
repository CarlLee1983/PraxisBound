import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { TextEncoder } from "node:util";

import {
  createNewRecord,
  defaultRecordFilesystem,
} from "../dist/review-records.js";

async function withRoot(build) {
  const base = await mkdtemp(join(tmpdir(), "review-records-write-"));
  try {
    return await build(base);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

test("security M7: a write failure after the temp file is created (an injected `link` failure) leaves no temp file and no final record", async () => {
  await withRoot(async (root) => {
    const manifestPath = "specs/batches/TST-9401-fixture/batch.json";
    const filesystem = {
      ...defaultRecordFilesystem,
      link: async () => {
        throw new Error("injected link failure");
      },
    };
    const result = await createNewRecord(
      root,
      manifestPath,
      () => "revisions-abcdefabcdef.json",
      new TextEncoder().encode("{}"),
      { filesystem },
    );
    assert.equal(result.ok, false);
    assert.equal(result.reason, "write-failed");

    const recordsDir = join(
      root,
      "specs",
      "batches",
      "TST-9401-fixture",
      "records",
    );
    const entries = await readdir(recordsDir);
    assert.deepEqual(
      entries,
      [],
      "no temp file and no final record must remain",
    );
  });
});

test("security M7: a mismatched dev/ino after link (an injected `lstat`) is treated as a write failure and the final file is removed", async () => {
  await withRoot(async (root) => {
    const manifestPath = "specs/batches/TST-9402-fixture/batch.json";
    const filesystem = {
      ...defaultRecordFilesystem,
      lstat: async () => ({ dev: -1, ino: -1 }),
    };
    const result = await createNewRecord(
      root,
      manifestPath,
      () => "revisions-abcdefabcdef.json",
      new TextEncoder().encode("{}"),
      { filesystem },
    );
    assert.equal(result.ok, false);
    assert.equal(result.reason, "write-failed");

    const recordsDir = join(
      root,
      "specs",
      "batches",
      "TST-9402-fixture",
      "records",
    );
    const entries = await readdir(recordsDir);
    assert.deepEqual(
      entries,
      [],
      "no temp file and no final record must remain",
    );
  });
});

test("a plain successful write leaves exactly the final record behind (no leftover temp file)", async () => {
  await withRoot(async (root) => {
    const manifestPath = "specs/batches/TST-9403-fixture/batch.json";
    const result = await createNewRecord(
      root,
      manifestPath,
      () => "revisions-abcdefabcdef.json",
      new TextEncoder().encode('{"ok":true}'),
    );
    assert.equal(result.ok, true);
    const recordsDir = join(
      root,
      "specs",
      "batches",
      "TST-9403-fixture",
      "records",
    );
    const entries = await readdir(recordsDir);
    assert.deepEqual(entries, ["revisions-abcdefabcdef.json"]);
  });
});
