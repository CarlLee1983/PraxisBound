import assert from "node:assert/strict";
import test from "node:test";

import { buildTargetLookup, matchRevisionTarget } from "../dist/index.js";

/** A minimal fake `ReviewIndex`: `buildTargetLookup` only reads these fields. */
function fakeIndex({
  specs = [],
  stories = [],
  adrs = [],
  diagnostics = [],
  sources = [],
} = {}) {
  return { specs, stories, adrs, diagnostics, sources };
}

test("review item 5: a path\\0anchor key does not collide when the anchor or path itself contains the same text a naive space-joined key would produce", () => {
  // The real locator: path "specs/x.md", anchor "Goal > A".
  const real = {
    path: "specs/x.md",
    anchor: "Goal > A",
    blockSha256: "a".repeat(64),
  };
  const index = fakeIndex({
    stories: [
      {
        id: "RF-001",
        path: "specs/x.md",
        acceptanceIds: [],
        locators: { story: [real], acceptance: [] },
      },
    ],
  });
  const lookup = buildTargetLookup(index);

  // An attacker-controlled target whose path and anchor, space-joined,
  // would spell the same string as the real locator's own space-joined key
  // ("specs/x.md" + " " + "Goal > A" === "specs/x.md Goal" + " " + "> A").
  const collidingTarget = {
    path: "specs/x.md Goal",
    anchor: "> A",
    blockSha256: real.blockSha256,
  };
  const result = matchRevisionTarget(
    lookup,
    "specs/batches/X/batch.json",
    "b".repeat(64),
    collidingTarget,
  );
  assert.equal(
    result,
    "anchor-missing",
    "a space-joined key must not let a forged path/anchor split match the real locator",
  );

  // The real target, matched exactly, still succeeds.
  const genuine = matchRevisionTarget(
    lookup,
    "specs/batches/X/batch.json",
    "b".repeat(64),
    real,
  );
  assert.equal(genuine, "match");
});
