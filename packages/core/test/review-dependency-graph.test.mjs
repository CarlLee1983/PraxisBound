import assert from "node:assert/strict";
import test from "node:test";

import { findDependencyCycles } from "@praxisbound/core";

test("AC-005: two Stories that depend on each other form one cycle", () => {
  const cycles = findDependencyCycles([
    { story: "RF-001", dependsOn: ["RF-002"] },
    { story: "RF-002", dependsOn: ["RF-001"] },
  ]);

  assert.deepEqual(cycles, [["RF-001", "RF-002"]]);
});

test("AC-005: a chain and a diamond without a back edge report no cycle", () => {
  const cycles = findDependencyCycles([
    { story: "RF-004", dependsOn: ["RF-002", "RF-003"] },
    { story: "RF-002", dependsOn: ["RF-001"] },
    { story: "RF-003", dependsOn: ["RF-001"] },
  ]);

  assert.deepEqual(cycles, []);
});

test("AC-005: a Story that depends on itself is a cycle", () => {
  const cycles = findDependencyCycles([
    { story: "RF-001", dependsOn: ["RF-001"] },
    { story: "RF-002", dependsOn: ["RF-001"] },
  ]);

  assert.deepEqual(cycles, [["RF-001"]]);
});

test("AC-005: separate cycles are reported once each, sorted, without their tails", () => {
  const cycles = findDependencyCycles([
    { story: "RF-009", dependsOn: ["RF-008"] },
    { story: "RF-008", dependsOn: ["RF-009"] },
    { story: "RF-005", dependsOn: ["RF-003"] },
    { story: "RF-003", dependsOn: ["RF-004"] },
    { story: "RF-004", dependsOn: ["RF-002"] },
    { story: "RF-002", dependsOn: ["RF-003"] },
  ]);

  assert.deepEqual(cycles, [
    ["RF-002", "RF-003", "RF-004"],
    ["RF-008", "RF-009"],
  ]);
});

test("AC-005: a chain of 20000 Stories closed into a cycle does not exhaust the stack", () => {
  const ids = Array.from(
    { length: 20000 },
    (_, n) => `RF-${String(n).padStart(5, "0")}`,
  );
  const dependencies = ids.map((story, n) => ({
    story,
    dependsOn: [ids[(n + 1) % ids.length]],
  }));

  const cycles = findDependencyCycles(dependencies);

  assert.equal(cycles.length, 1);
  assert.equal(cycles[0].length, ids.length);
  assert.equal(cycles[0][0], "RF-00000");
});
