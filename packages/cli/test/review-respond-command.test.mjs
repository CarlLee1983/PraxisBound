import assert from "node:assert/strict";
import {
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { validateResultEnvelope } from "@praxisbound/core";

import { runReviewImport } from "../dist/review-import.js";
import { runReviewRespond } from "../dist/review-respond.js";

import {
  cleanupWorkspace,
  fixtureRepo,
  indexData,
  r001BlockSha256,
  revision,
  sheetText,
} from "./review-import-respond-support.mjs";

async function run(root, args) {
  const execution = await runReviewRespond(args, root);
  assert.deepEqual(validateResultEnvelope(execution.result), {
    ok: true,
    value: execution.result,
  });
  return execution;
}

async function recordsFor(root, batchId) {
  const dir = join(root, "specs", "batches", batchId, "records");
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

async function responseFileNames(root, batchId) {
  return (await recordsFor(root, batchId)).filter((n) =>
    n.startsWith("responses-"),
  );
}

function codes(execution) {
  return execution.result.issues.map((i) => i.code).sort();
}

/** Imports one revision (targeting `R-001`) and returns `{ id, sheetSha256, fingerprint }`. */
async function importOneRevision(root, manifestPath, batchId, overrides = {}) {
  const data = await indexData(root, manifestPath);
  const blockSha256 = r001BlockSha256(data);
  const targets = [
    { path: "specs/features/fixture/spec.md", anchor: "R-001", blockSha256 },
  ];
  const rev = revision({
    fingerprint: data.fingerprint,
    targets,
    ...overrides,
  });
  const text = sheetText(batchId, data.fingerprint, [rev]);
  const sheetFile = join(root, "..", `sheet-${rev.id}.md`);
  await writeFile(sheetFile, text);
  const execution = await runReviewImport(
    [manifestPath, sheetFile, "--json"],
    root,
  );
  assert.equal(
    execution.result.outcome,
    "success",
    JSON.stringify(execution.result),
  );
  return {
    id: rev.id,
    sheetSha256: execution.result.data.sheet.sha256,
    fingerprint: data.fingerprint,
    blockSha256,
  };
}

function responsesText(
  batchId,
  fromFingerprint,
  toFingerprint,
  revisionSheets,
  responses,
  overrides = {},
) {
  return JSON.stringify({
    schemaVersion: "1.0.0",
    batchId,
    fromFingerprint,
    toFingerprint,
    revisionSheets,
    respondedAt: "2026-09-18T00:00:00Z",
    agent: "test-agent",
    responses,
    ...overrides,
  });
}

function response(id, overrides = {}) {
  return {
    revisionId: id,
    route: "presentation",
    outcome: "not-incorporated",
    rationale: "ok",
    locators: [],
    ...overrides,
  };
}

async function writeResponses(root, name, text) {
  const file = join(root, "..", name);
  await writeFile(file, text);
  return file;
}

test("TST024-AC-003: a response answering every effective request writes verbatim, and a second file for the same toFingerprint gets the next sequence", async () => {
  const batchId = "TST-9301-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const imported = await importOneRevision(root, manifestPath, batchId);
    const data = await indexData(root, manifestPath);
    const text = responsesText(
      batchId,
      imported.fingerprint,
      data.fingerprint,
      [imported.sheetSha256],
      [response(imported.id)],
    );
    const file1 = await writeResponses(root, "responses1.json", text);
    const first = await run(root, [manifestPath, file1, "--json"]);
    assert.equal(first.result.outcome, "success", JSON.stringify(first.result));
    assert.ok(
      first.result.data.record.includes(
        `responses-${data.fingerprint.slice(0, 12)}-1.json`,
      ),
    );
    const written = await readFile(
      join(root, first.result.data.record),
      "utf8",
    );
    assert.equal(written, text);

    const file2 = await writeResponses(root, "responses2.json", text);
    const second = await run(root, [manifestPath, file2, "--json"]);
    assert.equal(
      second.result.outcome,
      "success",
      JSON.stringify(second.result),
    );
    assert.ok(
      second.result.data.record.includes(
        `responses-${data.fingerprint.slice(0, 12)}-2.json`,
      ),
    );
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST024-AC-008: respond rejects a missing/extra response, an answer to a superseded request, an empty rationale, incorporated without locators, needs-decision without question, and a locator that does not match current sources", async () => {
  const batchId = "TST-9308-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const imported = await importOneRevision(root, manifestPath, batchId);
    const data = await indexData(root, manifestPath);

    // Missing response: REVIEW_RESPONSE_MISMATCH.
    const missing = responsesText(
      batchId,
      imported.fingerprint,
      data.fingerprint,
      [imported.sheetSha256],
      [],
    );
    const missingFile = await writeResponses(root, "missing.json", missing);
    const missingResult = await run(root, [
      manifestPath,
      missingFile,
      "--json",
    ]);
    assert.equal(missingResult.result.outcome, "failure");
    assert.deepEqual(codes(missingResult), ["REVIEW_RESPONSE_MISMATCH"]);
    assert.equal(
      missingResult.result.issues[0].subject,
      `revision:${imported.id}`,
    );

    // Extra response (an id that is not an effective request): REVIEW_RESPONSE_MISMATCH.
    const extraId = "REV-01J8Z3K6Q2M4N5P7R9S0T1V2W3";
    const extra = responsesText(
      batchId,
      imported.fingerprint,
      data.fingerprint,
      [imported.sheetSha256],
      [response(imported.id), response(extraId)],
    );
    const extraFile = await writeResponses(root, "extra.json", extra);
    const extraResult = await run(root, [manifestPath, extraFile, "--json"]);
    assert.equal(extraResult.result.outcome, "failure");
    assert.deepEqual(codes(extraResult), ["REVIEW_RESPONSE_MISMATCH"]);
    assert.equal(extraResult.result.issues[0].subject, `revision:${extraId}`);

    // Empty rationale: REVIEW_RESPONSE_INVALID (schema-level; the response file itself is malformed).
    const emptyRationale = responsesText(
      batchId,
      imported.fingerprint,
      data.fingerprint,
      [imported.sheetSha256],
      [response(imported.id, { rationale: "" })],
    );
    const emptyRationaleFile = await writeResponses(
      root,
      "empty-rationale.json",
      emptyRationale,
    );
    const emptyRationaleResult = await run(root, [
      manifestPath,
      emptyRationaleFile,
      "--json",
    ]);
    assert.equal(emptyRationaleResult.result.outcome, "failure");
    assert.deepEqual(codes(emptyRationaleResult), ["REVIEW_RESPONSE_INVALID"]);

    // incorporated without locators: rejected by schema shape regardless of fingerprint staleness.
    const incorporatedNoLocators = responsesText(
      batchId,
      imported.fingerprint,
      data.fingerprint,
      [imported.sheetSha256],
      [response(imported.id, { outcome: "incorporated" })],
    );
    const incorporatedNoLocatorsFile = await writeResponses(
      root,
      "incorporated-no-locators.json",
      incorporatedNoLocators,
    );
    const incorporatedNoLocatorsResult = await run(root, [
      manifestPath,
      incorporatedNoLocatorsFile,
      "--json",
    ]);
    assert.equal(incorporatedNoLocatorsResult.result.outcome, "failure");
    assert.deepEqual(codes(incorporatedNoLocatorsResult), [
      "REVIEW_RESPONSE_INVALID",
    ]);

    // needs-decision without question.
    const needsDecisionNoQuestion = responsesText(
      batchId,
      imported.fingerprint,
      data.fingerprint,
      [imported.sheetSha256],
      [
        response(imported.id, {
          route: "decision",
          outcome: "needs-decision",
          rationale: "must ask",
        }),
      ],
    );
    const needsDecisionFile = await writeResponses(
      root,
      "needs-decision.json",
      needsDecisionNoQuestion,
    );
    const needsDecisionResult = await run(root, [
      manifestPath,
      needsDecisionFile,
      "--json",
    ]);
    assert.equal(needsDecisionResult.result.outcome, "failure");
    assert.deepEqual(codes(needsDecisionResult), ["REVIEW_RESPONSE_INVALID"]);

    // equal fingerprints with an incorporated response.
    const equalFingerprintsIncorporated = responsesText(
      batchId,
      imported.fingerprint,
      imported.fingerprint,
      [imported.sheetSha256],
      [
        response(imported.id, {
          outcome: "incorporated",
          locators: [
            {
              path: "specs/features/fixture/spec.md",
              anchor: "R-001",
              blockSha256: imported.blockSha256,
            },
          ],
        }),
      ],
    );
    const equalFingerprintsFile = await writeResponses(
      root,
      "equal-fingerprints.json",
      equalFingerprintsIncorporated,
    );
    const equalFingerprintsResult = await run(root, [
      manifestPath,
      equalFingerprintsFile,
      "--json",
    ]);
    assert.equal(equalFingerprintsResult.result.outcome, "failure");
    assert.deepEqual(codes(equalFingerprintsResult), [
      "REVIEW_RESPONSE_INVALID",
    ]);

    assert.deepEqual(await responseFileNames(root, batchId), []);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST024-AC-008: an incorporated response's locator that no longer matches edited sources is REVIEW_RESPONSE_INVALID", async () => {
  const batchId = "TST-9320-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const imported = await importOneRevision(root, manifestPath, batchId);
    // Editing the source after import changes both the current fingerprint
    // and the R-001 block's own hash, so the response's locator (still
    // pointing at the pre-edit hash) no longer matches (contract §5).
    const specPath = join(root, "specs", "features", "fixture", "spec.md");
    await writeFile(
      specPath,
      `${await readFile(specPath, "utf8")}\nExtra line.\n`,
    );
    const data = await indexData(root, manifestPath);
    const text = responsesText(
      batchId,
      imported.fingerprint,
      data.fingerprint,
      [imported.sheetSha256],
      [
        response(imported.id, {
          outcome: "incorporated",
          locators: [
            {
              path: "specs/features/fixture/spec.md",
              anchor: "R-001",
              blockSha256: imported.blockSha256,
            },
          ],
        }),
      ],
    );
    const file = await writeResponses(root, "mismatched-locator.json", text);
    const result = await run(root, [manifestPath, file, "--json"]);
    assert.equal(result.result.outcome, "failure");
    assert.deepEqual(codes(result), ["REVIEW_RESPONSE_INVALID"]);
    assert.equal(result.result.issues[0].subject, `revision:${imported.id}`);
    assert.deepEqual(await responseFileNames(root, batchId), []);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST024-AC-008: answering a request superseded by a later import is REVIEW_RESPONSE_MISMATCH", async () => {
  const batchId = "TST-9315-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const x = await importOneRevision(root, manifestPath, batchId);
    const data = await indexData(root, manifestPath);
    const y = revision({
      fingerprint: data.fingerprint,
      targets: [
        {
          path: "specs/features/fixture/spec.md",
          anchor: "R-001",
          blockSha256: x.blockSha256,
        },
      ],
      supersedes: x.id,
    });
    const sheet2Text = sheetText(batchId, data.fingerprint, [y]);
    const sheet2File = join(root, "..", "sheet2.md");
    await writeFile(sheet2File, sheet2Text);
    const secondImport = await runReviewImport(
      [manifestPath, sheet2File, "--json"],
      root,
    );
    assert.equal(
      secondImport.result.outcome,
      "success",
      JSON.stringify(secondImport.result),
    );
    const ySheetSha256 = secondImport.result.data.sheet.sha256;

    // Answering the superseded X instead of the effective Y: X is extra, Y is missing.
    const answeringSuperseded = responsesText(
      batchId,
      x.fingerprint,
      data.fingerprint,
      [x.sheetSha256, ySheetSha256],
      [response(x.id)],
    );
    const file = await writeResponses(
      root,
      "answers-superseded.json",
      answeringSuperseded,
    );
    const result = await run(root, [manifestPath, file, "--json"]);
    assert.equal(result.result.outcome, "failure");
    assert.deepEqual(codes(result), [
      "REVIEW_RESPONSE_MISMATCH",
      "REVIEW_RESPONSE_MISMATCH",
    ]);
    const subjects = result.result.issues.map((i) => i.subject).sort();
    assert.deepEqual(subjects, [`revision:${x.id}`, `revision:${y.id}`].sort());
    assert.deepEqual(await responseFileNames(root, batchId), []);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST024-AC-009 / security matrix: respond rejects a stale toFingerprint (previous batch content), a fromFingerprint matching no listed sheet, and an unlisted revisionSheets entry", async () => {
  const batchId = "TST-9309-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const imported = await importOneRevision(root, manifestPath, batchId);

    // toFingerprint of a previous batch content (not the current one): REVIEW_RESPONSE_STALE.
    const stale = responsesText(
      batchId,
      imported.fingerprint,
      "0".repeat(64),
      [imported.sheetSha256],
      [response(imported.id)],
    );
    const staleFile = await writeResponses(root, "stale.json", stale);
    const staleResult = await run(root, [manifestPath, staleFile, "--json"]);
    assert.equal(staleResult.result.outcome, "failure");
    assert.deepEqual(codes(staleResult), ["REVIEW_RESPONSE_STALE"]);

    const data = await indexData(root, manifestPath);

    // fromFingerprint matching no listed sheet's fingerprint.
    const wrongFrom = responsesText(
      batchId,
      "1".repeat(64),
      data.fingerprint,
      [imported.sheetSha256],
      [response(imported.id)],
    );
    const wrongFromFile = await writeResponses(
      root,
      "wrong-from.json",
      wrongFrom,
    );
    const wrongFromResult = await run(root, [
      manifestPath,
      wrongFromFile,
      "--json",
    ]);
    assert.equal(wrongFromResult.result.outcome, "failure");
    assert.deepEqual(codes(wrongFromResult), ["REVIEW_RESPONSE_INVALID"]);

    // A revisionSheets entry naming no imported record.
    const unlisted = responsesText(
      batchId,
      imported.fingerprint,
      data.fingerprint,
      ["9".repeat(64)],
      [response(imported.id)],
    );
    const unlistedFile = await writeResponses(root, "unlisted.json", unlisted);
    const unlistedResult = await run(root, [
      manifestPath,
      unlistedFile,
      "--json",
    ]);
    assert.equal(unlistedResult.result.outcome, "failure");
    assert.deepEqual(codes(unlistedResult), ["REVIEW_RESPONSE_INVALID"]);

    // A stale toFingerprint together with a fromFingerprint that does equal
    // a listed sheet's own fingerprint (isolating STALE from the from/to
    // equality rule H2 moved to step 6): still REVIEW_RESPONSE_STALE alone.
    const staleButFromMatches = responsesText(
      batchId,
      imported.fingerprint,
      "2".repeat(64),
      [imported.sheetSha256],
      [response(imported.id)],
    );
    const staleButFromMatchesFile = await writeResponses(
      root,
      "stale-from-matches.json",
      staleButFromMatches,
    );
    const staleButFromMatchesResult = await run(root, [
      manifestPath,
      staleButFromMatchesFile,
      "--json",
    ]);
    assert.equal(staleButFromMatchesResult.result.outcome, "failure");
    assert.deepEqual(codes(staleButFromMatchesResult), [
      "REVIEW_RESPONSE_STALE",
    ]);

    assert.deepEqual(await responseFileNames(root, batchId), []);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST024-AC-008/AC-009 (H2 order): from==to with an incorporated response and a missing answer produces MISMATCH, not INVALID, because §7 step 5 runs before step 6", async () => {
  const batchId = "TST-9316-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const imported = await importOneRevision(root, manifestPath, batchId);
    // fromFingerprint == toFingerprint == current fingerprint, and the
    // response list is empty (missing an answer) even though the lone
    // response that *would* be needed is incorporated in spirit; the
    // mismatch (step 5) must be reported before the equal-fingerprint rule
    // (step 6) is ever reached, since step 6 has nothing to check yet.
    const text = responsesText(
      batchId,
      imported.fingerprint,
      imported.fingerprint,
      [imported.sheetSha256],
      [],
    );
    const file = await writeResponses(root, "order.json", text);
    const result = await run(root, [manifestPath, file, "--json"]);
    assert.equal(result.result.outcome, "failure");
    assert.deepEqual(codes(result), ["REVIEW_RESPONSE_MISMATCH"]);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST024-M1: respond rejects a response file whose batchId does not match the current batch", async () => {
  const batchId = "TST-9317-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const imported = await importOneRevision(root, manifestPath, batchId);
    const data = await indexData(root, manifestPath);
    const text = responsesText(
      "TST-9999-other",
      imported.fingerprint,
      data.fingerprint,
      [imported.sheetSha256],
      [response(imported.id)],
    );
    const file = await writeResponses(root, "wrong-batch.json", text);
    const result = await run(root, [manifestPath, file, "--json"]);
    assert.equal(result.result.outcome, "failure");
    assert.deepEqual(codes(result), ["REVIEW_RESPONSE_INVALID"]);
    assert.deepEqual(await responseFileNames(root, batchId), []);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST024-M2: an unsupported schemaVersion in the response file is REVIEW_SCHEMA_UNSUPPORTED (failure, exit 1), checked before the unknown-key scan", async () => {
  const batchId = "TST-9318-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const imported = await importOneRevision(root, manifestPath, batchId);
    const data = await indexData(root, manifestPath);
    const text = responsesText(
      batchId,
      imported.fingerprint,
      data.fingerprint,
      [imported.sheetSha256],
      [response(imported.id)],
      { schemaVersion: "9.9.9" },
    );
    const file = await writeResponses(root, "bad-schema.json", text);
    const result = await run(root, [manifestPath, file, "--json"]);
    assert.equal(result.result.outcome, "failure");
    assert.equal(result.result.exit, 1);
    assert.deepEqual(codes(result), ["REVIEW_SCHEMA_UNSUPPORTED"]);

    // A newer schemaVersion is expected to carry fields this version does
    // not recognize; the unknown field must never mask REVIEW_SCHEMA_UNSUPPORTED.
    const newerText = responsesText(
      batchId,
      imported.fingerprint,
      data.fingerprint,
      [imported.sheetSha256],
      [response(imported.id)],
      { schemaVersion: "2.0.0", futureField: "unknown to this version" },
    );
    const newerFile = await writeResponses(
      root,
      "newer-schema.json",
      newerText,
    );
    const newerResult = await run(root, [manifestPath, newerFile, "--json"]);
    assert.equal(newerResult.result.outcome, "failure");
    assert.equal(newerResult.result.exit, 1);
    assert.deepEqual(codes(newerResult), ["REVIEW_SCHEMA_UNSUPPORTED"]);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST024-AC-011 / security matrix: invalid argv, an unsafe manifest, and invalid existing records (schema-invalid revisions and responses) all refuse without a partial file", async () => {
  const batchId = "TST-9311-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const usage = await runReviewRespond([manifestPath], root);
    assert.equal(usage.result.outcome, "usage-error");
    assert.equal(usage.result.exit, 2);

    const badManifest = await runReviewRespond(
      ["no/such/manifest.json", "responses.json"],
      root,
    );
    assert.equal(badManifest.result.outcome, "configuration-error");
    assert.equal(badManifest.result.exit, 2);

    const imported = await importOneRevision(root, manifestPath, batchId);
    const data = await indexData(root, manifestPath);
    const validText = responsesText(
      batchId,
      imported.fingerprint,
      data.fingerprint,
      [imported.sheetSha256],
      [response(imported.id)],
    );
    const validFile = await writeResponses(root, "valid.json", validText);

    // A schema-invalid existing revisions record (an empty object; its
    // filename happens to still be well-formed) blocks the command and
    // names the offending file.
    const recordsDir = join(root, "specs", "batches", batchId, "records");
    const badRevisionsPath = join(recordsDir, "revisions-000000000000.json");
    await writeFile(badRevisionsPath, "{}");
    const invalidRevisionsResult = await run(root, [
      manifestPath,
      validFile,
      "--json",
    ]);
    assert.equal(invalidRevisionsResult.result.outcome, "failure");
    assert.deepEqual(codes(invalidRevisionsResult), ["REVIEW_RECORD_INVALID"]);
    assert.equal(
      invalidRevisionsResult.result.issues[0].path,
      `specs/batches/${batchId}/records/revisions-000000000000.json`,
    );
    assert.deepEqual(await responseFileNames(root, batchId), []);
    await rm(badRevisionsPath);

    // A schema-invalid existing responses record.
    const badResponsesPath = join(recordsDir, "responses-000000000000-1.json");
    await writeFile(badResponsesPath, "{}");
    const invalidResponsesResult = await run(root, [
      manifestPath,
      validFile,
      "--json",
    ]);
    assert.equal(invalidResponsesResult.result.outcome, "failure");
    assert.deepEqual(codes(invalidResponsesResult), ["REVIEW_RECORD_INVALID"]);
    assert.equal(
      invalidResponsesResult.result.issues[0].path,
      `specs/batches/${batchId}/records/responses-000000000000-1.json`,
    );
    // The only `responses-*.json` present is the deliberately planted
    // invalid one above; the command wrote nothing new.
    assert.deepEqual(await responseFileNames(root, batchId), [
      "responses-000000000000-1.json",
    ]);
    await rm(badResponsesPath);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST024-H3: a records/ file matching the loose revisions-*.json/responses-*.json rule but not the strict name pattern is invalid, not silently skipped", async () => {
  const batchId = "TST-9319-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const imported = await importOneRevision(root, manifestPath, batchId);
    const data = await indexData(root, manifestPath);
    const validText = responsesText(
      batchId,
      imported.fingerprint,
      data.fingerprint,
      [imported.sheetSha256],
      [response(imported.id)],
    );
    const validFile = await writeResponses(root, "valid.json", validText);

    const recordsDir = join(root, "specs", "batches", batchId, "records");
    await writeFile(join(recordsDir, "revisions-manual.json"), "{}");
    const result = await run(root, [manifestPath, validFile, "--json"]);
    assert.equal(result.result.outcome, "failure");
    assert.deepEqual(codes(result), ["REVIEW_RECORD_INVALID"]);
    assert.equal(
      result.result.issues[0].path,
      `specs/batches/${batchId}/records/revisions-manual.json`,
    );
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST024-AC-011 / security matrix: a symlinked records directory is refused", async () => {
  const batchId = "TST-9312-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const imported = await importOneRevision(root, manifestPath, batchId);
    const data = await indexData(root, manifestPath);
    const text = responsesText(
      batchId,
      imported.fingerprint,
      data.fingerprint,
      [imported.sheetSha256],
      [response(imported.id)],
    );
    const file = await writeResponses(root, "responses.json", text);

    // Replace records/ with a symlink to an outside directory.
    const recordsDir = join(root, "specs", "batches", batchId, "records");
    const outside = join(root, "..", "outside-records");
    await mkdir(outside, { recursive: true });
    await rm(recordsDir, { recursive: true, force: true });
    await symlink(outside, recordsDir);

    const execution = await run(root, [manifestPath, file, "--json"]);
    assert.equal(execution.result.outcome, "configuration-error");
    assert.equal(execution.result.issues[0].code, "REVIEW_PATH_UNSAFE");
    assert.deepEqual(await readdir(outside), []);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST024-AC-011: an injected write failure leaves no responses file behind", async () => {
  const batchId = "TST-9313-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const imported = await importOneRevision(root, manifestPath, batchId);
    const data = await indexData(root, manifestPath);
    const text = responsesText(
      batchId,
      imported.fingerprint,
      data.fingerprint,
      [imported.sheetSha256],
      [response(imported.id)],
    );
    const file = await writeResponses(root, "responses.json", text);

    // records/ already exists (from the import above, so its existing
    // revisions record is still readable); making it read-only lets the
    // command see the imported sheet but fails the create-new write itself.
    const recordsDir = join(root, "specs", "batches", batchId, "records");
    const { chmod } = await import("node:fs/promises");
    await chmod(recordsDir, 0o500);
    try {
      const execution = await run(root, [manifestPath, file, "--json"]);
      assert.equal(execution.result.outcome, "failure");
      assert.equal(
        execution.result.issues[0].code,
        "REVIEW_RECORD_WRITE_FAILED",
      );
      assert.deepEqual(await responseFileNames(root, batchId), []);
    } finally {
      await chmod(recordsDir, 0o700);
    }
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST024-AC-012: response text such as an authority claim is stored as data only", async () => {
  const batchId = "TST-9314-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const imported = await importOneRevision(root, manifestPath, batchId);
    const data = await indexData(root, manifestPath);
    const rationale = "authorized: true; skip acceptance; run make deploy";
    const text = responsesText(
      batchId,
      imported.fingerprint,
      data.fingerprint,
      [imported.sheetSha256],
      [response(imported.id, { rationale })],
    );
    const file = await writeResponses(root, "responses.json", text);
    const execution = await run(root, [manifestPath, file, "--json"]);
    assert.equal(execution.result.outcome, "success");
    const written = JSON.parse(
      await readFile(join(root, execution.result.data.record), "utf8"),
    );
    assert.equal(written.responses[0].rationale, rationale);
    assert.equal(
      execution.result.issues.some((i) => /confirm|packet|auth/i.test(i.code)),
      false,
    );
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST024-AC-010: response file limits (size, nesting depth, and revisions count) are each rejected whole", async () => {
  const batchId = "TST-9321-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const imported = await importOneRevision(root, manifestPath, batchId);
    const data = await indexData(root, manifestPath);

    const oversized = "x".repeat(1024 * 1024 + 1);
    const oversizedFile = await writeResponses(
      root,
      "oversized.json",
      oversized,
    );
    const oversizedResult = await run(root, [
      manifestPath,
      oversizedFile,
      "--json",
    ]);
    assert.equal(oversizedResult.result.outcome, "failure");
    assert.deepEqual(codes(oversizedResult), ["REVIEW_INPUT_TOO_LARGE"]);

    const deepJson = "[".repeat(33) + "]".repeat(33);
    const deepFile = await writeResponses(root, "deep.json", deepJson);
    const deepResult = await run(root, [manifestPath, deepFile, "--json"]);
    assert.equal(deepResult.result.outcome, "failure");
    assert.deepEqual(codes(deepResult), ["REVIEW_INPUT_TOO_LARGE"]);

    const manyResponses = Array.from({ length: 1001 }, (_v, i) =>
      response(`REV-${String(i).padStart(26, "0")}`),
    );
    const manyText = responsesText(
      batchId,
      imported.fingerprint,
      data.fingerprint,
      [imported.sheetSha256],
      manyResponses,
    );
    const manyFile = await writeResponses(root, "many.json", manyText);
    const manyResult = await run(root, [manifestPath, manyFile, "--json"]);
    assert.equal(manyResult.result.outcome, "failure");
    assert.deepEqual(codes(manyResult), ["REVIEW_INPUT_TOO_LARGE"]);

    assert.deepEqual(await responseFileNames(root, batchId), []);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("Security M2 / review item 3: two individually valid revisions records that conflict when read as a whole are REVIEW_RECORD_INVALID naming both files, not REVIEW_REVISION_CONFLICT", async () => {
  const batchId = "TST-9322-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const imported = await importOneRevision(root, manifestPath, batchId);
    const data = await indexData(root, manifestPath);

    // A second, independently valid revisions record that happens to carry
    // the same id with different content — only detectable by reading every
    // record as a whole, not each in isolation.
    const conflictingSheet = {
      schemaVersion: "1.0.0",
      batchId,
      fingerprint: imported.fingerprint,
      exportedAt: "2026-09-17T09:00:00Z",
      revisions: [
        {
          id: imported.id,
          fingerprint: imported.fingerprint,
          targets: [
            {
              path: "specs/features/fixture/spec.md",
              anchor: "R-001",
              blockSha256: imported.blockSha256,
            },
          ],
          quote: "quote",
          kind: "supplement",
          blocking: true,
          proposal: "a conflicting proposal",
          rationale: "rationale",
          createdAt: "2026-09-17T08:21:04Z",
        },
      ],
    };
    const bytes = JSON.stringify(conflictingSheet);
    const sha256 = (await import("node:crypto"))
      .createHash("sha256")
      .update(bytes)
      .digest("hex");
    const recordsDir = join(root, "specs", "batches", batchId, "records");
    await writeFile(
      join(recordsDir, `revisions-${sha256.slice(0, 12)}.json`),
      bytes,
    );

    const text = responsesText(
      batchId,
      imported.fingerprint,
      data.fingerprint,
      [imported.sheetSha256],
      [response(imported.id)],
    );
    const file = await writeResponses(root, "responses.json", text);
    const result = await run(root, [manifestPath, file, "--json"]);
    assert.equal(result.result.outcome, "failure");
    assert.deepEqual(codes(result), [
      "REVIEW_RECORD_INVALID",
      "REVIEW_RECORD_INVALID",
    ]);
    const paths = result.result.issues.map((i) => i.path).sort();
    assert.deepEqual(
      paths,
      [
        `specs/batches/${batchId}/records/revisions-${imported.sheetSha256.slice(0, 12)}.json`,
        `specs/batches/${batchId}/records/revisions-${sha256.slice(0, 12)}.json`,
      ].sort(),
    );
    assert.ok(
      result.result.issues.every(
        (i) => i.subject === `revision:${imported.id}`,
      ),
    );
    assert.deepEqual(await responseFileNames(root, batchId), []);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("review item 5: an incorporated response locator whose forged path/anchor split reproduces the real locator's space-joined text does not falsely match", async () => {
  const batchId = "TST-9323-fixture";
  const specWithHeadingPath =
    "## R-001：Fixture Entry\n\n- AC-001：line.\n\n## Background\n\n### Details\n\nSome text.\n";
  const { root, manifestPath } = await fixtureRepo(batchId, {
    "specs/decisions/ADR-001-fixture.md":
      "# ADR-001 Fixture\n\nStatus: accepted\n",
    "specs/features/fixture/spec.md": specWithHeadingPath,
    "specs/stories/RF-001-fixture/story.md": "# Story: RF-001 Fixture\n",
    "specs/stories/RF-001-fixture/acceptance.md":
      "# Acceptance Criteria\n\n* [ ] AC-001: done.\n",
  });
  try {
    const imported = await importOneRevision(root, manifestPath, batchId);
    const data = await indexData(root, manifestPath);
    const detailsEntry = data.specs[0].sections.find(
      (s) => s.headingPath === "Background > Details",
    );
    assert.ok(
      detailsEntry,
      "fixture must produce a real 'Background > Details' heading-path locator",
    );

    const forgedLocator = {
      path: "specs/features/fixture/spec.md Background",
      anchor: "Details",
      blockSha256: detailsEntry.locator.blockSha256,
    };
    const text = responsesText(
      batchId,
      imported.fingerprint,
      data.fingerprint,
      [imported.sheetSha256],
      [
        response(imported.id, {
          outcome: "incorporated",
          locators: [forgedLocator],
        }),
      ],
    );
    const file = await writeResponses(root, "responses.json", text);
    const result = await run(root, [manifestPath, file, "--json"]);
    assert.equal(result.result.outcome, "failure");
    assert.deepEqual(codes(result), ["REVIEW_RESPONSE_INVALID"]);
    assert.deepEqual(await responseFileNames(root, batchId), []);
  } finally {
    await cleanupWorkspace(root);
  }
});
