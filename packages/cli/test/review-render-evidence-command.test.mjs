/**
 * `praxisbound review render`'s "修訂紀錄證據" area (contract §13/§20 修訂，
 * R-005): the count-first 200-file bound, the pre-read 16 MiB total-size
 * bound, the post-read 10000-entry bound, an invalid record's diagnostic,
 * cross-record conflict exclusion (security M2), a symlinked `records/`,
 * and the no-records-dir no-op case.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { validateResultEnvelope } from "@praxisbound/core";

import {
  MAX_EVIDENCE_TOTAL_BYTES,
  sumLooseRecordFileBytes,
} from "../dist/review-evidence.js";
import { runReviewImport } from "../dist/review-import.js";
import { runReviewRespond } from "../dist/review-respond.js";
import {
  renderReviewRenderHuman,
  runReviewIndex,
  runReviewRender,
} from "../dist/review.js";

import {
  cleanupWorkspace,
  fixtureRepo,
  indexData,
  nextRevisionId,
  r001BlockSha256,
  revision,
  sheetText,
} from "./review-import-respond-support.mjs";

function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

async function run(root, args) {
  const execution = await runReviewRender(args, root);
  assert.deepEqual(validateResultEnvelope(execution.result), {
    ok: true,
    value: execution.result,
  });
  return execution;
}

function recordsDir(root, batchId) {
  return join(root, "specs", "batches", batchId, "records");
}

async function listSourcePaths(root) {
  const paths = [];
  async function walk(dir, prefix) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === "records") continue;
      const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) await walk(join(dir, entry.name), rel);
      else paths.push(rel);
    }
  }
  await walk(root, "");
  return paths.sort();
}

function validRevisionSheetRecord(batchId, count, overrides = {}) {
  const revisions = [];
  for (let i = 0; i < count; i += 1) {
    revisions.push({
      id: nextRevisionId(),
      fingerprint: "0".repeat(64),
      targets: [
        {
          path: "specs/features/fixture/spec.md",
          anchor: "R-001",
          blockSha256: "a".repeat(64),
        },
      ],
      quote: "quote",
      kind: "supplement",
      blocking: true,
      proposal: "proposal",
      rationale: "rationale",
      createdAt: "2026-09-17T08:21:04Z",
    });
  }
  return {
    schemaVersion: "1.0.0",
    batchId,
    fingerprint: "0".repeat(64),
    exportedAt: "2026-09-17T08:30:00Z",
    revisions,
    ...overrides,
  };
}

async function writeValidRevisionRecord(root, batchId, count, overrides = {}) {
  const record = validRevisionSheetRecord(batchId, count, overrides);
  const text = JSON.stringify(record);
  const sha12 = sha256Hex(text).slice(0, 12);
  const dir = recordsDir(root, batchId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `revisions-${sha12}.json`), text);
  return { sha256: sha256Hex(text), record };
}

function validResponsesRecord(batchId, revisionId, overrides = {}) {
  return {
    schemaVersion: "1.0.0",
    batchId,
    fromFingerprint: "0".repeat(64),
    toFingerprint: "0".repeat(64),
    revisionSheets: ["1".repeat(64)],
    respondedAt: "2026-09-18T00:00:00Z",
    agent: "test-agent",
    responses: [
      {
        revisionId,
        route: "presentation",
        outcome: "not-incorporated",
        rationale: "rationale",
        locators: [],
      },
    ],
    ...overrides,
  };
}

async function writeValidResponseRecord(root, batchId, revisionId, n = 1) {
  const record = validResponsesRecord(batchId, revisionId);
  const dir = recordsDir(root, batchId);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, `responses-000000000000-${n}.json`),
    JSON.stringify(record),
  );
}

test("Security Fixture Matrix row 「records directory」: an invalid records/responses-000000000000.json is reported REVIEW_RECORD_INVALID with its path, render still succeeds, and no source or records/ file is written or changed", async () => {
  const batchId = "TST-9601-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const dir = recordsDir(root, batchId);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "responses-000000000000.json"),
      '{"not":"a real record"}',
    );

    const before = await listSourcePaths(root);
    const beforeRecordsListing = await readdir(dir);

    const execution = await run(root, [
      manifestPath,
      "--output",
      "review.html",
      "--json",
    ]);

    assert.equal(execution.result.outcome, "success");
    assert.ok(
      execution.result.issues.some(
        (i) =>
          i.code === "REVIEW_RECORD_INVALID" &&
          i.path ===
            `specs/batches/${batchId}/records/responses-000000000000.json`,
      ),
      JSON.stringify(execution.result.issues),
    );
    assert.ok(
      execution.result.data.diagnostics.some(
        (d) => d.code === "REVIEW_RECORD_INVALID" && d.severity === "blocking",
      ),
    );

    const after = (await listSourcePaths(root)).filter(
      (path) => path !== "review.html",
    );
    assert.deepEqual(
      after,
      before,
      "no source or manifest file is written (review.html, the render's own output, aside)",
    );
    const afterRecordsListing = await readdir(dir);
    assert.deepEqual(
      afterRecordsListing.sort(),
      beforeRecordsListing.sort(),
      "review render never writes into records/: the invalid record is untouched and no new record file appears",
    );

    const html = await readFile(join(root, "review.html"), "utf8");
    assert.match(html, /未採計的紀錄/);
    assert.match(html, /records\/responses-000000000000\.json/);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST025-AC-008 human-mode: an invalid record whose file name contains a bidi override and a literal newline is printed as an ISSUE line with both visibly escaped", async () => {
  const batchId = "TST-9614-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const dir = recordsDir(root, batchId);
    await mkdir(dir, { recursive: true });
    const dangerousName = "revisions-‮bad\nname.json";
    await writeFile(join(dir, dangerousName), "not read");

    // No `--json`. A raw control character in the file name can never
    // satisfy the envelope's own `path`-field schema (`result.ts`'s
    // `isPath`), so `loadReviewEvidence` omits `path` for this one issue
    // and folds a visibly escaped rendering into `message` instead — the
    // envelope stays schema-valid, which `run`'s own
    // `validateResultEnvelope` check still confirms.
    const execution = await run(root, [
      manifestPath,
      "--output",
      "review.html",
    ]);
    assert.equal(execution.result.outcome, "success");
    const reported = execution.result.issues.find(
      (i) => i.code === "REVIEW_RECORD_INVALID",
    );
    assert.ok(reported, JSON.stringify(execution.result.issues));
    assert.equal(
      reported.path,
      undefined,
      "an unsafe file name is never placed in the machine-readable path field",
    );
    assert.equal(
      reported.message,
      `record is invalid: specs/batches/${batchId}/records/revisions-\\x202ebad\\x0aname.json`,
    );

    const rendered = renderReviewRenderHuman(execution);
    assert.match(
      rendered.stdout,
      new RegExp(
        `ISSUE REVIEW_RECORD_INVALID: record is invalid: specs/batches/${batchId}/records/revisions-\\\\x202ebad\\\\x0aname\\.json`,
      ),
    );
    assert.ok(
      !rendered.stdout.includes(dangerousName),
      "the raw bidi override and newline must never reach stdout verbatim",
    );
    assert.ok(!rendered.stdout.includes("‮"));
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST025-AC-008: more than 200 revisions-/responses- record files (counted by name before any content is read) blocks REVIEW_INPUT_TOO_LARGE, never reports REVIEW_RECORD_INVALID (proving content is never opened), and renders no record content", async () => {
  const batchId = "TST-9602-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const dir = recordsDir(root, batchId);
    await mkdir(dir, { recursive: true });
    for (let i = 0; i < 201; i += 1) {
      await writeFile(
        join(dir, `revisions-loose-${String(i).padStart(4, "0")}.json`),
        "not read",
      );
    }

    const execution = await run(root, [
      manifestPath,
      "--output",
      "review.html",
      "--json",
    ]);

    assert.equal(execution.result.outcome, "success");
    assert.ok(
      execution.result.issues.some((i) => i.code === "REVIEW_INPUT_TOO_LARGE"),
      JSON.stringify(execution.result.issues),
    );
    assert.ok(
      !execution.result.issues.some((i) => i.code === "REVIEW_RECORD_INVALID"),
      "no file's content was ever opened, so none can be reported invalid",
    );

    const html = await readFile(join(root, "review.html"), "utf8");
    assert.match(html, /修訂紀錄超過投影上限，未呈現任何紀錄/);
    assert.match(html, /201/);
    assert.doesNotMatch(html, /class="evidence-entry"/);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST025-AC-008 boundary: exactly 200 record files render normally (the bound is exceeded only above 200)", async () => {
  const batchId = "TST-9605-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    for (let file = 0; file < 200; file += 1) {
      await writeValidRevisionRecord(root, batchId, 1);
    }

    const execution = await run(root, [
      manifestPath,
      "--output",
      "review.html",
      "--json",
    ]);

    assert.equal(execution.result.outcome, "success");
    assert.ok(
      !execution.result.issues.some((i) => i.code === "REVIEW_INPUT_TOO_LARGE"),
      JSON.stringify(execution.result.issues),
    );

    const html = await readFile(join(root, "review.html"), "utf8");
    assert.doesNotMatch(html, /修訂紀錄超過投影上限/);
    assert.match(html, /class="evidence-entry"/);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST025-AC-008: a total size over 16 MiB (lstat-summed, before any content is read) blocks REVIEW_INPUT_TOO_LARGE, never reports REVIEW_RECORD_INVALID (proving content is never opened), and renders no record content", async () => {
  const batchId = "TST-9616-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const dir = recordsDir(root, batchId);
    await mkdir(dir, { recursive: true });
    // 17 files of (1 MiB + 1 byte) each = 17,825,809 bytes, comfortably
    // over the 16 MiB (16,777,216-byte) bound; well under the 200-file
    // bound so it is the size bound, not the count one, being exercised.
    // The content is not valid JSON — if it were ever opened and parsed,
    // it would surface as `REVIEW_RECORD_INVALID`, which the test asserts
    // never happens.
    const oversizedGarbage = "x".repeat(1024 * 1024 + 1);
    for (let i = 0; i < 17; i += 1) {
      await writeFile(
        join(dir, `revisions-loose-${String(i).padStart(4, "0")}.json`),
        oversizedGarbage,
      );
    }

    const execution = await run(root, [
      manifestPath,
      "--output",
      "review.html",
      "--json",
    ]);

    assert.equal(execution.result.outcome, "success");
    assert.ok(
      execution.result.issues.some((i) => i.code === "REVIEW_INPUT_TOO_LARGE"),
      JSON.stringify(execution.result.issues),
    );
    assert.ok(
      !execution.result.issues.some((i) => i.code === "REVIEW_RECORD_INVALID"),
      "no file's content was ever opened, so none can be reported invalid",
    );

    const html = await readFile(join(root, "review.html"), "utf8");
    assert.match(html, /修訂紀錄超過投影上限，未呈現任何紀錄/);
    assert.match(html, /17825809/);
    assert.doesNotMatch(html, /class="evidence-entry"/);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST025-AC-008 boundary (pure sum function): the total-size sum is exact at the 16 MiB boundary and reflects lstat sizes, not content — building a full 16 MiB of schema-valid records for an end-to-end render test would be impractical, so this exercises the summing primitive `loadReviewEvidence` itself calls", async () => {
  const batchId = "TST-9617-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const dir = recordsDir(root, batchId);
    await mkdir(dir, { recursive: true });
    const oneMib = 1024 * 1024;
    const names = [];
    for (let i = 0; i < 16; i += 1) {
      const name = `revisions-loose-${String(i).padStart(4, "0")}.json`;
      await writeFile(join(dir, name), "x".repeat(oneMib));
      names.push(name);
    }

    const total = await sumLooseRecordFileBytes(root, manifestPath, names);
    assert.equal(total, 16 * oneMib);
    assert.equal(total, MAX_EVIDENCE_TOTAL_BYTES);
    assert.ok(
      !(total > MAX_EVIDENCE_TOTAL_BYTES),
      "exactly 16 MiB must not itself exceed the bound (only a total strictly greater does)",
    );
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST025-AC-008 boundary (end-to-end, non-schema-valid content): a total of exactly 16 MiB across loosely-named files is read (not blocked by the size bound) — every file is still individually invalid for an unrelated reason (a loose, non-strict file name), which is exactly how the pure-sum-function boundary test above is corroborated without needing 16 MiB of schema-valid records", async () => {
  const batchId = "TST-9618-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const dir = recordsDir(root, batchId);
    await mkdir(dir, { recursive: true });
    const oneMib = 1024 * 1024;
    for (let i = 0; i < 16; i += 1) {
      await writeFile(
        join(dir, `revisions-loose-${String(i).padStart(4, "0")}.json`),
        "x".repeat(oneMib),
      );
    }

    const execution = await run(root, [
      manifestPath,
      "--output",
      "review.html",
      "--json",
    ]);

    assert.equal(execution.result.outcome, "success");
    assert.ok(
      !execution.result.issues.some(
        (i) =>
          i.code === "REVIEW_INPUT_TOO_LARGE" && /bytes/.test(i.message ?? ""),
      ),
      "a total of exactly 16 MiB must not trip the size bound",
    );
    // Every file is opened and found invalid for its own (unrelated)
    // reason — name pattern and content, not size — proving the read
    // actually proceeded past the size check rather than the size check
    // having (incorrectly) let nothing through.
    const invalidCount = execution.result.issues.filter(
      (i) => i.code === "REVIEW_RECORD_INVALID",
    ).length;
    assert.equal(invalidCount, 16);

    const html = await readFile(join(root, "review.html"), "utf8");
    assert.doesNotMatch(html, /修訂紀錄超過投影上限/);
    assert.match(html, /未採計的紀錄/);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST025-AC-008: valid records whose total requests exceed 10000 block REVIEW_INPUT_TOO_LARGE after reading, and render no record content", async () => {
  const batchId = "TST-9603-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    for (let file = 0; file < 11; file += 1) {
      await writeValidRevisionRecord(root, batchId, 1000);
    }

    const execution = await run(root, [
      manifestPath,
      "--output",
      "review.html",
      "--json",
    ]);

    assert.equal(execution.result.outcome, "success");
    assert.ok(
      execution.result.issues.some((i) => i.code === "REVIEW_INPUT_TOO_LARGE"),
      JSON.stringify(execution.result.issues),
    );

    const html = await readFile(join(root, "review.html"), "utf8");
    assert.match(html, /修訂紀錄超過投影上限，未呈現任何紀錄/);
    assert.match(html, /11000/);
    assert.doesNotMatch(html, /class="evidence-entry"/);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST025-AC-008 boundary: exactly 10000 requests across 10 files render normally (the bound is exceeded only above 10000)", async () => {
  const batchId = "TST-9606-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    for (let file = 0; file < 10; file += 1) {
      await writeValidRevisionRecord(root, batchId, 1000);
    }

    const execution = await run(root, [
      manifestPath,
      "--output",
      "review.html",
      "--json",
    ]);

    assert.equal(execution.result.outcome, "success");
    assert.ok(
      !execution.result.issues.some((i) => i.code === "REVIEW_INPUT_TOO_LARGE"),
      JSON.stringify(execution.result.issues),
    );

    const html = await readFile(join(root, "review.html"), "utf8");
    assert.doesNotMatch(html, /修訂紀錄超過投影上限/);
    assert.match(html, /class="evidence-entry"/);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST025-AC-008 (security M2): two valid revisions-*.json files that disagree on the same REV id's content are excluded from the evidence content and listed as invalid, both paths named", async () => {
  const batchId = "TST-9607-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const sharedId = nextRevisionId();
    const first = await writeValidRevisionRecord(root, batchId, 0, {
      revisions: [
        {
          id: sharedId,
          fingerprint: "0".repeat(64),
          targets: [
            {
              path: "specs/features/fixture/spec.md",
              anchor: "R-001",
              blockSha256: "a".repeat(64),
            },
          ],
          quote: "quote-A",
          kind: "supplement",
          blocking: true,
          proposal: "proposal-A",
          rationale: "rationale",
          createdAt: "2026-09-17T08:21:04Z",
        },
      ],
    });
    const second = await writeValidRevisionRecord(root, batchId, 0, {
      revisions: [
        {
          id: sharedId,
          fingerprint: "0".repeat(64),
          targets: [
            {
              path: "specs/features/fixture/spec.md",
              anchor: "R-001",
              blockSha256: "a".repeat(64),
            },
          ],
          quote: "quote-B-different",
          kind: "supplement",
          blocking: true,
          proposal: "proposal-B-different",
          rationale: "rationale",
          createdAt: "2026-09-17T08:21:04Z",
        },
      ],
    });
    void first;
    void second;

    const execution = await run(root, [
      manifestPath,
      "--output",
      "review.html",
      "--json",
    ]);

    assert.equal(execution.result.outcome, "success");
    const conflictIssues = execution.result.issues.filter(
      (i) =>
        i.code === "REVIEW_RECORD_INVALID" &&
        i.subject === `revision:${sharedId}`,
    );
    assert.equal(
      conflictIssues.length,
      2,
      `expected one REVIEW_RECORD_INVALID per conflicting file, got ${JSON.stringify(execution.result.issues)}`,
    );

    const html = await readFile(join(root, "review.html"), "utf8");
    assert.doesNotMatch(
      html,
      /quote-A|quote-B-different/,
      "neither conflicting version's content is projected",
    );
    assert.match(html, /未採計的紀錄/);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST025-AC-008 (security M2): two requests superseding the same id are a record-set conflict, excluded from the evidence content", async () => {
  const batchId = "TST-9608-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const targetId = nextRevisionId();
    const supersederA = nextRevisionId();
    const supersederB = nextRevisionId();
    const baseRevision = (id, supersedes) => ({
      id,
      fingerprint: "0".repeat(64),
      targets: [
        {
          path: "specs/features/fixture/spec.md",
          anchor: "R-001",
          blockSha256: "a".repeat(64),
        },
      ],
      quote: "quote",
      kind: "supplement",
      blocking: true,
      proposal: "proposal",
      rationale: "rationale",
      createdAt: "2026-09-17T08:21:04Z",
      ...(supersedes === undefined ? {} : { supersedes }),
    });

    await writeValidRevisionRecord(root, batchId, 0, {
      revisions: [
        baseRevision(targetId),
        baseRevision(supersederA, targetId),
        baseRevision(supersederB, targetId),
      ],
    });

    const execution = await run(root, [
      manifestPath,
      "--output",
      "review.html",
      "--json",
    ]);

    assert.equal(execution.result.outcome, "success");
    assert.ok(
      execution.result.issues.some((i) => i.code === "REVIEW_RECORD_INVALID"),
      JSON.stringify(execution.result.issues),
    );

    const html = await readFile(join(root, "review.html"), "utf8");
    assert.doesNotMatch(
      html,
      new RegExp(`class="evidence-entry" id="evidence-rev-`),
      "the whole conflicting record's content is excluded, not just the doubly-superseded id",
    );
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST025-AC-008 (security M2, round-trip re-validation): a content conflict and an unrelated supersedes conflict, spread across four files, are both caught — not just the first one `validateRevisionRecordSet` happens to report", async () => {
  const batchId = "TST-9615-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const baseRevision = (id, overrides = {}) => ({
      id,
      fingerprint: "0".repeat(64),
      targets: [
        {
          path: "specs/features/fixture/spec.md",
          anchor: "R-001",
          blockSha256: "a".repeat(64),
        },
      ],
      quote: "quote",
      kind: "supplement",
      blocking: true,
      proposal: "proposal",
      rationale: "rationale",
      createdAt: "2026-09-17T08:21:04Z",
      ...overrides,
    });

    // A, B: same id X, different content — a content conflict
    // `validateRevisionRecordSet` reports on its very first pass.
    const x = nextRevisionId();
    await writeValidRevisionRecord(root, batchId, 0, {
      revisions: [baseRevision(x, { quote: "quote-A" })],
    });
    await writeValidRevisionRecord(root, batchId, 0, {
      revisions: [baseRevision(x, { quote: "quote-B-different" })],
    });

    // C: id Y plus a first supersedes of Y. D: a second, competing
    // supersedes of the same Y. This conflict is only visible once A/B
    // are excluded and the remaining set is re-validated — the very
    // re-validation loop this test exists to prove runs at all.
    const y = nextRevisionId();
    const s1 = nextRevisionId();
    const s2 = nextRevisionId();
    await writeValidRevisionRecord(root, batchId, 0, {
      revisions: [baseRevision(y), baseRevision(s1, { supersedes: y })],
    });
    await writeValidRevisionRecord(root, batchId, 0, {
      revisions: [baseRevision(s2, { supersedes: y })],
    });

    const execution = await run(root, [
      manifestPath,
      "--output",
      "review.html",
      "--json",
    ]);
    assert.equal(execution.result.outcome, "success");

    const invalid = execution.result.issues.filter(
      (i) => i.code === "REVIEW_RECORD_INVALID",
    );
    assert.equal(
      invalid.length,
      3,
      `expected the content conflict (2 files) and the supersedes conflict (1 file) both reported, got ${JSON.stringify(execution.result.issues)}`,
    );
    assert.ok(
      invalid.some((i) => i.subject === `revision:${x}`),
      "the content conflict on X must still be reported",
    );
    assert.ok(
      invalid.some(
        (i) => i.subject === `revision:${s1}` || i.subject === `revision:${s2}`,
      ),
      "the supersedes conflict on Y, only visible in the second validation round, must also be reported — this is exactly what the round-trip loop fixes",
    );

    const html = await readFile(join(root, "review.html"), "utf8");
    assert.doesNotMatch(html, /quote-A|quote-B-different/);
    // Whichever of C/D `validateRevisionRecordSet` names, that file's
    // *whole* content (not just the offending id) is excluded — the
    // other file survives and renders normally. Exactly one of the two
    // survives; the excluded pair's ids never appear as their own
    // rendered entries, so no 「已被…取代」 label is ever derived from
    // an excluded record.
    const survivedD = html.includes(s2) && !html.includes(s1);
    const survivedC = html.includes(s1) && !html.includes(s2);
    assert.notEqual(
      survivedC,
      survivedD,
      "exactly one of the two supersedes-conflicting files survives, never both and never neither",
    );
    // Whichever superseder's own file was excluded, its `supersedes` claim
    // must never look honored: Y is never labelled as superseded by it.
    // (The surviving file's superseder, if it is the one left standing, is
    // legitimate and *is* expected to carry that label — that is normal
    // §6 behavior, not a defect.)
    const excludedSupersederId = survivedC ? s2 : s1;
    assert.doesNotMatch(html, new RegExp(`已被 ${excludedSupersederId} 取代`));
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST025-AC-005: revisions render before responses, in file-name order, through a real import + respond flow", async () => {
  const batchId = "TST-9609-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const data = await indexData(root, manifestPath);
    const blockSha256 = r001BlockSha256(data);
    const rev = revision({
      fingerprint: data.fingerprint,
      targets: [
        {
          path: "specs/features/fixture/spec.md",
          anchor: "R-001",
          blockSha256,
        },
      ],
    });
    const sheetFile = join(root, "..", `sheet-${rev.id}.md`);
    await writeFile(sheetFile, sheetText(batchId, data.fingerprint, [rev]));
    const imported = await runReviewImport(
      [manifestPath, sheetFile, "--json"],
      root,
    );
    assert.equal(
      imported.result.outcome,
      "success",
      JSON.stringify(imported.result),
    );

    const afterImport = await indexData(root, manifestPath);
    const responsesText = JSON.stringify({
      schemaVersion: "1.0.0",
      batchId,
      fromFingerprint: data.fingerprint,
      toFingerprint: afterImport.fingerprint,
      revisionSheets: [imported.result.data.sheet.sha256],
      respondedAt: "2026-09-18T00:00:00Z",
      agent: "test-agent",
      responses: [
        {
          revisionId: rev.id,
          route: "presentation",
          outcome: "not-incorporated",
          rationale: "ok",
          locators: [],
        },
      ],
    });
    const responsesFile = join(root, "..", "responses.json");
    await writeFile(responsesFile, responsesText);
    const responded = await runReviewRespond(
      [manifestPath, responsesFile, "--json"],
      root,
    );
    assert.equal(
      responded.result.outcome,
      "success",
      JSON.stringify(responded.result),
    );

    const execution = await run(root, [
      manifestPath,
      "--output",
      "review.html",
      "--json",
    ]);
    assert.equal(execution.result.outcome, "success");

    const html = await readFile(join(root, "review.html"), "utf8");
    const revisionsHeading = html.indexOf(">修訂單紀錄<");
    const responsesHeading = html.indexOf(">回應紀錄<");
    assert.ok(revisionsHeading !== -1 && responsesHeading !== -1);
    assert.ok(
      revisionsHeading < responsesHeading,
      "the 修訂單紀錄 section renders before the 回應紀錄 section",
    );
    const revisionEntry = html.indexOf(rev.id, revisionsHeading);
    assert.ok(
      revisionEntry !== -1 && revisionEntry < responsesHeading,
      "the revision entry itself renders inside the revisions section",
    );

    // Elements in the evidence area carry no annotation-target attribute.
    const evidenceStart = html.indexOf('id="evidence"');
    const evidenceSection = html.slice(
      evidenceStart,
      html.indexOf('id="appendix"', evidenceStart),
    );
    assert.doesNotMatch(evidenceSection, /data-path=/);
    assert.doesNotMatch(evidenceSection, /data-anchor=/);
    assert.doesNotMatch(evidenceSection, /data-block-sha256=/);

    // The response's own revisionId links to the request, since it was rendered.
    assert.match(
      evidenceSection,
      new RegExp(
        `class="evidence-id" href="#evidence-rev-[0-9a-f]+">${rev.id}`,
      ),
    );
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST025-AC-003: a response naming a revision id that is not among the rendered records links nowhere", async () => {
  const batchId = "TST-9610-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const unknownId = nextRevisionId();
    await writeValidResponseRecord(root, batchId, unknownId);

    const execution = await run(root, [
      manifestPath,
      "--output",
      "review.html",
      "--json",
    ]);
    assert.equal(execution.result.outcome, "success");

    const html = await readFile(join(root, "review.html"), "utf8");
    assert.doesNotMatch(html, /class="evidence-id" href=/);
    assert.match(
      html,
      new RegExp(`<span class="evidence-id">${unknownId}</span>`),
    );
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST025-AC-008: a symlinked records/ directory blocks REVIEW_PATH_UNSAFE, names the records path, and omits the evidence area, while render still succeeds", async () => {
  const batchId = "TST-9611-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const outsideDir = join(root, "..", "outside-records");
    await mkdir(outsideDir, { recursive: true });
    await symlink(outsideDir, recordsDir(root, batchId));

    const execution = await run(root, [
      manifestPath,
      "--output",
      "review.html",
      "--json",
    ]);

    assert.equal(execution.result.outcome, "success");
    assert.ok(
      execution.result.issues.some(
        (i) =>
          i.code === "REVIEW_PATH_UNSAFE" &&
          i.path === `specs/batches/${batchId}/records`,
      ),
      JSON.stringify(execution.result.issues),
    );

    const html = await readFile(join(root, "review.html"), "utf8");
    assert.doesNotMatch(html, /修訂紀錄證據/);
  } finally {
    await cleanupWorkspace(root);
  }
});

test('TST025-AC-008: records/ replaced by a plain file (a listing failure other than "does not exist") blocks REVIEW_RECORD_INVALID naming the records directory, omits the evidence area, and writes nothing, while render still succeeds', async () => {
  const batchId = "TST-9613-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    // `records/` as a plain file makes `readdir` fail with ENOTDIR — a
    // listing failure distinct from "does not exist" (ENOENT), and
    // reproducible without root or platform-specific permission games.
    await writeFile(recordsDir(root, batchId), "not a directory");

    const before = await listSourcePaths(root);

    const execution = await run(root, [
      manifestPath,
      "--output",
      "review.html",
      "--json",
    ]);

    assert.equal(execution.result.outcome, "success");
    assert.ok(
      execution.result.issues.some(
        (i) =>
          i.code === "REVIEW_RECORD_INVALID" &&
          i.path === `specs/batches/${batchId}/records`,
      ),
      JSON.stringify(execution.result.issues),
    );
    assert.ok(
      execution.result.data.diagnostics.some(
        (d) => d.code === "REVIEW_RECORD_INVALID" && d.severity === "blocking",
      ),
    );

    const html = await readFile(join(root, "review.html"), "utf8");
    assert.doesNotMatch(html, /修訂紀錄證據/);

    const after = (await listSourcePaths(root)).filter(
      (path) => path !== "review.html",
    );
    assert.deepEqual(
      after,
      before,
      "no source, manifest, or records/ file is written (review.html, the render's own output, aside)",
    );
    const recordsBytes = await readFile(recordsDir(root, batchId), "utf8");
    assert.equal(
      recordsBytes,
      "not a directory",
      "the records/ path itself is left exactly as it was",
    );
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST025-AC-010: `review index` never reads records/ — its output is unchanged whether or not valid records exist", async () => {
  const batchId = "TST-9612-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const before = await runReviewIndex([manifestPath, "--json"], root);
    assert.equal(before.result.outcome, "success");

    await writeValidRevisionRecord(root, batchId, 3);

    const after = await runReviewIndex([manifestPath, "--json"], root);
    assert.equal(after.result.outcome, "success");
    assert.deepEqual(after.result, before.result);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST025-AC-010: with no records/ directory, the rendered page has no evidence section and is deterministic across two renders", async () => {
  const batchId = "TST-9604-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const first = await run(root, [
      manifestPath,
      "--output",
      "review-1.html",
      "--json",
    ]);
    assert.equal(first.result.outcome, "success");
    assert.ok(
      !first.result.issues.some(
        (i) =>
          i.code === "REVIEW_RECORD_INVALID" ||
          i.code === "REVIEW_INPUT_TOO_LARGE",
      ),
    );

    const second = await run(root, [
      manifestPath,
      "--output",
      "review-2.html",
      "--json",
    ]);
    assert.equal(second.result.outcome, "success");

    const html1 = await readFile(join(root, "review-1.html"), "utf8");
    const html2 = await readFile(join(root, "review-2.html"), "utf8");
    assert.equal(html1, html2);
    assert.doesNotMatch(html1, /修訂紀錄證據/);
  } finally {
    await cleanupWorkspace(root);
  }
});
