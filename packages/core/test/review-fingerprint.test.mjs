import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { TextEncoder } from "node:util";

import { indexReviewBatch, planReviewBatch } from "@praxisbound/core";

const encoder = new TextEncoder();

const MANIFEST_PATH = "specs/batches/TST-900-fixture/batch.json";
const ADR_PATH = "specs/decisions/ADR-900-fixture.md";
const SPEC_PATH = "specs/features/fixture/spec.md";
const STORY_DIR = "specs/stories/RF-900-fixture";
const STORY_MD = `${STORY_DIR}/story.md`;
const ACCEPTANCE_MD = `${STORY_DIR}/acceptance.md`;

function manifestText() {
  return JSON.stringify({
    schemaVersion: "1.0.0",
    batchId: "TST-900-fixture",
    sources: {
      adrs: [ADR_PATH],
      specs: [SPEC_PATH],
      stories: [STORY_DIR],
    },
    requirements: [{ spec: SPEC_PATH, anchor: "R-001", stories: ["RF-900"] }],
    dependencies: [],
  });
}

function baseSources() {
  return {
    [ADR_PATH]: "# ADR-900 Fixture\n\nStatus: accepted\n",
    [SPEC_PATH]: "## R-001：Fixture\n\n- AC-001：Fixture line.\n",
    [STORY_MD]: "# Story: RF-900 Fixture\n",
    [ACCEPTANCE_MD]: "# Acceptance Criteria\n\n* [ ] AC-001: Fixture.\n",
  };
}

function observationsOf(sources) {
  const map = new Map();
  for (const [path, text] of Object.entries(sources)) {
    map.set(path, { kind: "file", bytes: encoder.encode(text) });
  }
  return map;
}

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Independently computes contract §4's fingerprint from raw fixture bytes. */
function independentFingerprint(manifestBytes, sources) {
  const manifestSha256 = sha256Hex(manifestBytes);
  const digests = Object.keys(sources)
    .sort((a, b) => {
      const ab = encoder.encode(a);
      const bb = encoder.encode(b);
      const length = Math.min(ab.length, bb.length);
      for (let index = 0; index < length; index += 1) {
        if (ab[index] !== bb[index]) return ab[index] - bb[index];
      }
      return ab.length - bb.length;
    })
    .map((path) => ({
      path,
      sha256:
        sources[path] === undefined
          ? null
          : sha256Hex(encoder.encode(sources[path])),
    }));

  const sourcesJson = digests
    .map(
      (digest) =>
        `{"path":${JSON.stringify(digest.path)},"sha256":${
          digest.sha256 === null ? "null" : JSON.stringify(digest.sha256)
        }}`,
    )
    .join(",");
  const canonical = `{"manifest":${JSON.stringify(manifestSha256)},"sources":[${sourcesJson}]}`;
  return sha256Hex(encoder.encode(canonical));
}

function computeIndexFingerprint(manifestBytes, sources) {
  const plan = planReviewBatch(MANIFEST_PATH, manifestBytes);
  assert.equal(plan.ok, true, "fixture manifest must plan successfully");
  const result = indexReviewBatch(plan.plan, observationsOf(sources));
  assert.equal(result.kind, "ok", "fixture batch must index successfully");
  return result.index.fingerprint;
}

test("TST021-AC-003: the fingerprint equals the independently computed contract §4 value", () => {
  const manifestBytes = encoder.encode(manifestText());
  const sources = baseSources();

  const actual = computeIndexFingerprint(manifestBytes, sources);
  const expected = independentFingerprint(manifestBytes, sources);

  assert.equal(actual, expected);
});

test("TST021-AC-003: re-running without changes yields the same fingerprint", () => {
  const manifestBytes = encoder.encode(manifestText());
  const sources = baseSources();

  const first = computeIndexFingerprint(manifestBytes, sources);
  const second = computeIndexFingerprint(manifestBytes, { ...sources });

  assert.equal(first, second);
});

test("TST021-AC-003: editing a declared source changes the fingerprint", () => {
  const manifestBytes = encoder.encode(manifestText());
  const base = baseSources();
  const edited = { ...base, [ADR_PATH]: `${base[ADR_PATH]}edited\n` };

  assert.notEqual(
    computeIndexFingerprint(manifestBytes, base),
    computeIndexFingerprint(manifestBytes, edited),
  );
});

test("TST021-AC-003: converting a source from LF to CRLF changes the fingerprint", () => {
  const manifestBytes = encoder.encode(manifestText());
  const base = baseSources();
  const crlf = { ...base, [ADR_PATH]: base[ADR_PATH].replace(/\n/g, "\r\n") };

  assert.notEqual(
    computeIndexFingerprint(manifestBytes, base),
    computeIndexFingerprint(manifestBytes, crlf),
  );
});

test("TST021-AC-003: removing a declared source changes the fingerprint and uses a null digest", () => {
  const manifestBytes = encoder.encode(manifestText());
  const base = baseSources();
  const withoutAdr = { ...base };
  delete withoutAdr[ADR_PATH];

  const plan = planReviewBatch(MANIFEST_PATH, manifestBytes);
  const result = indexReviewBatch(plan.plan, observationsOf(withoutAdr));
  assert.equal(result.kind, "ok");
  const adrDigest = result.index.sources.find(
    (source) => source.path === ADR_PATH,
  );
  assert.equal(adrDigest?.sha256, null);

  assert.notEqual(
    computeIndexFingerprint(manifestBytes, base),
    computeIndexFingerprint(manifestBytes, withoutAdr),
  );
});

test("TST021-AC-003: editing the manifest changes the fingerprint", () => {
  const sources = baseSources();
  const originalBytes = encoder.encode(manifestText());
  const editedBytes = encoder.encode(
    JSON.stringify({
      schemaVersion: "1.0.0",
      batchId: "TST-900-fixture",
      title: "Edited",
      sources: {
        adrs: [ADR_PATH],
        specs: [SPEC_PATH],
        stories: [STORY_DIR],
      },
      requirements: [{ spec: SPEC_PATH, anchor: "R-001", stories: ["RF-900"] }],
      dependencies: [],
    }),
  );

  assert.notEqual(
    computeIndexFingerprint(originalBytes, sources),
    computeIndexFingerprint(editedBytes, sources),
  );
});

test("TST021-AC-003: an undeclared extra file does not change the fingerprint", () => {
  const manifestBytes = encoder.encode(manifestText());
  const base = baseSources();
  const withExtra = observationsOf(base);
  withExtra.set("specs/decisions/ADR-undeclared.md", {
    kind: "file",
    bytes: encoder.encode("# undeclared\n"),
  });

  const plan = planReviewBatch(MANIFEST_PATH, manifestBytes);
  const withoutExtra = indexReviewBatch(plan.plan, observationsOf(base));
  const withExtraResult = indexReviewBatch(plan.plan, withExtra);

  assert.equal(withoutExtra.kind, "ok");
  assert.equal(withExtraResult.kind, "ok");
  assert.equal(
    withoutExtra.index.fingerprint,
    withExtraResult.index.fingerprint,
  );
});

test("TST021-AC-003: adding a declared source changes the fingerprint", () => {
  const base = baseSources();
  const originalManifest = manifestText();
  const originalBytes = encoder.encode(originalManifest);

  const extraAdrPath = "specs/decisions/ADR-901-extra.md";
  const withExtraManifest = JSON.stringify({
    schemaVersion: "1.0.0",
    batchId: "TST-900-fixture",
    sources: {
      adrs: [ADR_PATH, extraAdrPath],
      specs: [SPEC_PATH],
      stories: [STORY_DIR],
    },
    requirements: [{ spec: SPEC_PATH, anchor: "R-001", stories: ["RF-900"] }],
    dependencies: [],
  });
  const withExtraBytes = encoder.encode(withExtraManifest);
  const withExtraSources = { ...base, [extraAdrPath]: "# extra ADR\n" };

  assert.notEqual(
    computeIndexFingerprint(originalBytes, base),
    computeIndexFingerprint(withExtraBytes, withExtraSources),
  );
});

// This literal was computed once, independently of both the module under
// test and the `independentFingerprint` helper above, by hand-running the
// contract §4 algorithm in a Node scratch script and pasting its output.
// The two non-ASCII paths are chosen so UTF-16 and UTF-8 orders disagree:
// as JS strings (UTF-16 code units), "😀" (U+1F600, a surrogate
// pair starting 0xD83D) sorts *before* "�" (U+FFFD, 0xFFFD) because
// 0xD83D < 0xFFFD. But by UTF-8 bytes, U+1F600 encodes to F0 9F 98 80 and
// U+FFFD encodes to EF BF BD, and 0xF0 > 0xEF, so U+FFFD sorts *first*. The
// assertion below on sorted `sources` order, and the pinned fingerprint
// itself, only pass if the implementation truly sorts by UTF-8 bytes.
test("TST021-AC-003/TST021 code review item 15: a pinned, independently computed fingerprint for a fixed non-ASCII fixture", () => {
  const pinnedManifestPath = "specs/batches/TST-950-fixture/batch.json";
  const emoji = "specs/😀.md";
  const replacementChar = "specs/�.md";
  const storyDir = "specs/stories/RF-950-fixture";

  const manifestObject = {
    schemaVersion: "1.0.0",
    batchId: "TST-950-fixture",
    sources: { adrs: [], specs: [emoji, replacementChar], stories: [storyDir] },
    requirements: [],
    dependencies: [],
  };
  const manifestBytes = encoder.encode(JSON.stringify(manifestObject));

  const sources = {
    [emoji]: "content-emoji\n",
    [replacementChar]: "content-repl\n",
    [`${storyDir}/story.md`]: "# Story: RF-950\n",
    [`${storyDir}/acceptance.md`]:
      "# Acceptance Criteria\n\n* [ ] AC-001: x.\n",
  };

  const plan = planReviewBatch(pinnedManifestPath, manifestBytes);
  assert.equal(plan.ok, true);
  const result = indexReviewBatch(plan.plan, observationsOf(sources));
  assert.equal(result.kind, "ok");

  assert.deepEqual(
    result.index.sources.map((s) => s.path),
    [
      `${storyDir}/acceptance.md`,
      `${storyDir}/story.md`,
      replacementChar,
      emoji,
    ],
    "UTF-8 byte order, not UTF-16 code-unit order, decides sort order",
  );

  assert.equal(
    result.index.fingerprint,
    "7b2adf61d595d0023ab784a1edfde953af5ac7d68e504a36182c8554240e6c68",
  );
});
