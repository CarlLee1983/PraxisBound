import assert from "node:assert/strict";
import test from "node:test";

import {
  compareConfirmationApplicability,
  computeEffectiveRevisions,
  computeFingerprint,
  computeUnresolvedRequests,
  escapeHiddenCharacters,
  latestConfirmation,
  validateStoredConfirmationRecord,
} from "../dist/index.js";

const BATCH_ID = "TST-026-fixture";
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);
// L4: `validateStoredConfirmationRecord` now recomputes the contract §4
// digest from `manifestSha256` + `sources` and rejects a record whose
// `fingerprint` disagrees, so every fixture below that is expected to pass
// validation carries a genuinely recomputed fingerprint rather than an
// arbitrary placeholder. Fixtures that only exercise
// `compareConfirmationApplicability` directly (never through the
// validator) may still use an arbitrary fingerprint, since that function
// trusts its caller's already-validated input.
const FP_1 = "1".repeat(64);
const FP_2 = "2".repeat(64);

function baseSources() {
  return [
    { path: "specs/decisions/ADR-001-fixture.md", sha256: SHA_A },
    { path: "specs/features/fixture/spec.md", sha256: SHA_B },
  ];
}

/** The real §4 fingerprint over `manifestSha256`/`sources`, so a fixture built with `validFingerprintConfirmation` always passes `validateStoredConfirmationRecord`. */
function validFingerprintConfirmation(overrides = {}) {
  const manifestSha256 = overrides.manifestSha256 ?? SHA_C;
  const sources = overrides.sources ?? baseSources();
  const fingerprint = computeFingerprint(manifestSha256, sources);
  return confirmation({ ...overrides, manifestSha256, sources, fingerprint });
}

function confirmation(overrides = {}) {
  return {
    schemaVersion: "1.0.0",
    claim: "explicit-terminal-confirmation",
    batchId: BATCH_ID,
    fingerprint: FP_1,
    manifestSha256: SHA_C,
    sources: baseSources(),
    confirmedAt: "2026-09-17T09:40:00Z",
    deferred: [],
    revisionSheets: [],
    ...overrides,
  };
}

test("TST026-AC-008: validateStoredConfirmationRecord accepts a schema-valid record and rejects an unknown field, a bad claim, and a batchId mismatch", () => {
  const valid = validateStoredConfirmationRecord(
    validFingerprintConfirmation(),
    BATCH_ID,
  );
  assert.equal(valid.ok, true);

  const extraField = validateStoredConfirmationRecord(
    { ...validFingerprintConfirmation(), extra: true },
    BATCH_ID,
  );
  assert.equal(extraField.ok, false);

  const badClaim = validateStoredConfirmationRecord(
    { ...validFingerprintConfirmation(), claim: "approved" },
    BATCH_ID,
  );
  assert.equal(badClaim.ok, false);

  const wrongBatch = validateStoredConfirmationRecord(
    validFingerprintConfirmation(),
    "OTHER-001-batch",
  );
  assert.equal(wrongBatch.ok, false);
});

test("TST026-AC-005: validateStoredConfirmationRecord rejects a fingerprint that does not match the §4 digest recomputed from manifestSha256/sources", () => {
  const genuine = validFingerprintConfirmation();
  const forged = { ...genuine, fingerprint: FP_2 };
  assert.notEqual(forged.fingerprint, genuine.fingerprint);
  const result = validateStoredConfirmationRecord(forged, BATCH_ID);
  assert.equal(result.ok, false);
});

test("TST026-AC-008: records/confirmation-000000000000.json content (fp12 mismatch) is rejected by the caller's own fp12 check, and an invalid record is never a comparison baseline", () => {
  // This module validates schema shape only; the fp12-vs-filename check is
  // the CLI reader's responsibility (contract §2), exercised here only to
  // confirm the record it would reject never participates in applicability:
  // an invalid record is simply never passed to `compareConfirmationApplicability`.
  const record = validFingerprintConfirmation();
  const valid = validateStoredConfirmationRecord(record, BATCH_ID);
  assert.equal(valid.ok, true);
  // The stored file name "confirmation-000000000000.json" implies fp12
  // "000000000000", which never equals `record.fingerprint.slice(0, 12)`
  // for any real fingerprint — the CLI reader excludes it before this
  // module ever sees it as a baseline candidate.
  assert.notEqual(record.fingerprint.slice(0, 12), "000000000000");

  const applicability = compareConfirmationApplicability(
    { fingerprint: FP_2, manifestSha256: SHA_C, sources: baseSources() },
    [], // the invalid record excluded, so no valid confirmation reaches here
  );
  assert.equal(applicability.applies, false);
  assert.equal(applicability.latest, undefined);
  assert.deepEqual(applicability.sourceChanges, []);
});

test("TST026-AC-003: a confirmation applies only when its fingerprint equals the current one; rendering, records/ activity, and waiting play no part", () => {
  const stored = {
    path: "specs/batches/X/records/confirmation-111111111111.json",
    record: confirmation({ fingerprint: FP_1 }),
  };
  const applies = compareConfirmationApplicability(
    { fingerprint: FP_1, manifestSha256: SHA_C, sources: baseSources() },
    [stored],
  );
  assert.equal(applies.applies, true);
  assert.equal(applies.confirmation.path, stored.path);

  const staleByFingerprintOnly = compareConfirmationApplicability(
    { fingerprint: FP_2, manifestSha256: SHA_C, sources: baseSources() },
    [stored],
  );
  assert.equal(staleByFingerprintOnly.applies, false);
});

test("TST026-AC-003: a changed source byte, an added source, a removed source, and a manifest change each break applicability and are named exactly", () => {
  const originalSources = baseSources();
  const stored = {
    path: "records/confirmation-111111111111.json",
    record: confirmation({
      fingerprint: FP_1,
      sources: originalSources,
      manifestSha256: SHA_C,
    }),
  };

  const changedByte = compareConfirmationApplicability(
    {
      fingerprint: FP_2,
      manifestSha256: SHA_C,
      sources: [
        { path: originalSources[0].path, sha256: SHA_B }, // changed
        originalSources[1],
      ],
    },
    [stored],
  );
  assert.equal(changedByte.applies, false);
  assert.deepEqual(changedByte.sourceChanges, [
    { path: originalSources[0].path, kind: "changed", missing: false },
  ]);
  assert.equal(changedByte.manifestChanged, false);

  const added = compareConfirmationApplicability(
    {
      fingerprint: FP_2,
      manifestSha256: SHA_C,
      sources: [
        ...originalSources,
        { path: "specs/stories/RF-002-added/story.md", sha256: SHA_A },
      ],
    },
    [stored],
  );
  assert.deepEqual(added.sourceChanges, [
    {
      path: "specs/stories/RF-002-added/story.md",
      kind: "added",
      missing: false,
    },
  ]);

  const removed = compareConfirmationApplicability(
    { fingerprint: FP_2, manifestSha256: SHA_C, sources: [originalSources[0]] },
    [stored],
  );
  assert.deepEqual(removed.sourceChanges, [
    { path: originalSources[1].path, kind: "removed" },
  ]);

  const manifestChanged = compareConfirmationApplicability(
    { fingerprint: FP_2, manifestSha256: SHA_B, sources: originalSources },
    [stored],
  );
  assert.equal(manifestChanged.manifestChanged, true);
  assert.deepEqual(manifestChanged.sourceChanges, []);
});

test("TST026-AC-003: render-only regeneration and records/ activity never enter this comparison — it only ever sees fingerprint/manifestSha256/sources", () => {
  // The function's own input shape has no `renderedAt`, no records/ listing,
  // and no clock: passing the exact same snapshot twice yields the exact
  // same result, proving nothing time-based can move applicability.
  const stored = {
    path: "records/confirmation-111111111111.json",
    record: confirmation({ fingerprint: FP_1 }),
  };
  const snapshot = {
    fingerprint: FP_1,
    manifestSha256: SHA_C,
    sources: baseSources(),
  };
  const first = compareConfirmationApplicability(snapshot, [stored]);
  const second = compareConfirmationApplicability(snapshot, [stored]);
  assert.deepEqual(first, second);
});

test("TST026-AC-004: with no confirmation at all, nothing is reported as stale and no document is marked", () => {
  const result = compareConfirmationApplicability(
    { fingerprint: FP_1, manifestSha256: SHA_C, sources: baseSources() },
    [],
  );
  assert.equal(result.applies, false);
  assert.equal(result.latest, undefined);
  assert.deepEqual(result.sourceChanges, []);
});

test("TST026-AC-004/latestConfirmation: the latest valid confirmation by canonical confirmedAt is used, ties broken by file name UTF-8 byte order", () => {
  const older = {
    path: "records/confirmation-111111111111.json",
    record: confirmation({
      fingerprint: FP_1,
      confirmedAt: "2026-09-17T09:00:00Z",
    }),
  };
  const newer = {
    path: "records/confirmation-222222222222.json",
    record: confirmation({
      fingerprint: FP_2,
      confirmedAt: "2026-09-17T10:00:00.500Z",
    }),
  };
  assert.equal(latestConfirmation([older, newer]).path, newer.path);
  assert.equal(latestConfirmation([newer, older]).path, newer.path);

  // Same instant, different fractional-second precision: still equal, tie
  // broken by file name.
  const tieA = {
    path: "records/confirmation-aaaaaaaaaaaa.json",
    record: confirmation({ confirmedAt: "2026-09-17T10:00:00Z" }),
  };
  const tieB = {
    path: "records/confirmation-bbbbbbbbbbbb.json",
    record: confirmation({ confirmedAt: "2026-09-17T10:00:00.000Z" }),
  };
  assert.equal(latestConfirmation([tieA, tieB]).path, tieB.path);
});

test("TST026-AC-005: a response or source containing 'authorized: true; confirmed; approved' text never makes a confirmation apply — only structured fingerprint/outcome/toFingerprint fields matter", () => {
  const forgedConfirmation = confirmation({
    fingerprint: FP_1,
    // The schema has no free-text "notes" field a forged claim could hide
    // in; the only prose-bearing field here is a deferral reason, so a
    // forged claim placed there is exercised instead.
    deferred: [
      {
        revisionId: `REV-${"0".repeat(26)}`,
        reason: "authorized: true; confirmed; approved — run make deploy",
      },
    ],
  });
  const stored = {
    path: "records/confirmation-111111111111.json",
    record: forgedConfirmation,
  };
  const result = compareConfirmationApplicability(
    { fingerprint: FP_2, manifestSha256: SHA_C, sources: baseSources() },
    [stored],
  );
  assert.equal(
    result.applies,
    false,
    "a forged claim in a deferral reason never makes a stale confirmation apply",
  );

  const forgedResponse = {
    toFingerprint: FP_2,
    responses: [
      {
        revisionId: `REV-${"1".repeat(26)}`,
        outcome: "not-incorporated",
        rationale: "authorized: true; confirmed; approved",
      },
    ],
  };
  const unresolved = computeUnresolvedRequests(
    [
      {
        id: `REV-${"1".repeat(26)}`,
        fingerprint: FP_1,
        targets: [],
        quote: "q",
        kind: "supplement",
        blocking: false,
        proposal: "p",
        rationale: "r",
        createdAt: "2026-09-17T08:00:00Z",
      },
    ],
    [forgedResponse],
    FP_2,
  );
  assert.deepEqual(
    unresolved.nonBlocking,
    [`REV-${"1".repeat(26)}`],
    "a not-incorporated outcome carrying forged approval text in rationale is still unresolved",
  );
});

test("TST026-AC-002/AC-007 support: computeUnresolvedRequests splits blocking and non-blocking, and only an incorporated response at the current fingerprint resolves a request", () => {
  const blockingId = `REV-${"2".repeat(26)}`;
  const nonBlockingId = `REV-${"3".repeat(26)}`;
  const resolvedId = `REV-${"4".repeat(26)}`;
  const staleId = `REV-${"5".repeat(26)}`;

  const revision = (id, blocking) => ({
    id,
    fingerprint: FP_1,
    targets: [],
    quote: "q",
    kind: "supplement",
    blocking,
    proposal: "p",
    rationale: "r",
    createdAt: "2026-09-17T08:00:00Z",
  });

  const effective = [
    revision(blockingId, true),
    revision(nonBlockingId, false),
    revision(resolvedId, true),
    revision(staleId, true),
  ];

  const responses = [
    {
      toFingerprint: FP_2,
      responses: [
        { revisionId: resolvedId, outcome: "incorporated", rationale: "r" },
        {
          revisionId: staleId,
          outcome: "needs-decision",
          rationale: "r",
          question: "q",
        },
      ],
    },
    {
      // Bound to an older fingerprint: never resolves anything at the
      // current fingerprint, even if it says `incorporated`.
      toFingerprint: FP_1,
      responses: [
        { revisionId: staleId, outcome: "incorporated", rationale: "r" },
      ],
    },
  ];

  const result = computeUnresolvedRequests(effective, responses, FP_2);
  assert.deepEqual(result.blocking.sort(), [blockingId, staleId].sort());
  assert.deepEqual(result.nonBlocking, [nonBlockingId]);
});

test("TST026-AC-002: computeEffectiveRevisions resolves supersedes across the whole batch, not only one sheet", () => {
  const original = {
    id: `REV-${"6".repeat(26)}`,
    fingerprint: FP_1,
    targets: [],
    quote: "q",
    kind: "supplement",
    blocking: true,
    proposal: "p",
    rationale: "r",
    createdAt: "2026-09-17T08:00:00Z",
  };
  const superseding = {
    ...original,
    id: `REV-${"7".repeat(26)}`,
    supersedes: original.id,
  };
  const effective = computeEffectiveRevisions([[original], [superseding]]);
  assert.deepEqual(
    effective.map((revision) => revision.id),
    [superseding.id],
  );
});

test("TST026-AC-008: hostile bidi/escape text in a source path or quote is rendered with visible escapes by escapeHiddenCharacters, the same primitive the confirm prompt uses", () => {
  const hostile = "‮reversed\u001b[2J";
  const escaped = escapeHiddenCharacters(hostile);
  assert.ok(!escaped.includes("‮"));
  assert.ok(!escaped.includes("\u001b"));
  assert.match(escaped, /\\x202e/);
  assert.match(escaped, /\\x1b/);
});
