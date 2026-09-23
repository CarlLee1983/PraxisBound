/**
 * AC-007 cross-check: export a Declaration, Manifest, and Coverage Review
 * with this Core into a scratch git repository seeded from ForgePilot
 * 32b7a68's own valid fixture repository tree, so `forgepilot goal
 * preflight` can be run against artifacts this Core produced.
 *
 * Usage (from the PraxisBound repository root, after `pnpm run build`):
 *   node specs/stories/TST-029-goal-plan-shape-alignment/evidence/export-forgepilot-artifacts.mjs \
 *     <scratch fixture repository root>
 *
 * See verification.md for the exact preceding `git init`/`forgepilot init`
 * commands and the verbatim output of this script and of `goal preflight`.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const coreRoot = path.resolve(new URL("../../../..", import.meta.url).pathname);
const distPath = path.join(coreRoot, "packages/core/dist/goal-plan-artifacts.js");
const { exportGoalPlanDeclaration, exportGoalPlanManifest, exportPlanCoverageReview } =
  await import(distPath);

const repoRoot = process.argv[2];
if (repoRoot === undefined) {
  console.error(
    "usage: node export-forgepilot-artifacts.mjs <scratch fixture repository root>",
  );
  process.exit(2);
}

function read(rel) {
  return readFileSync(path.join(repoRoot, rel));
}
function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const adr = read("specs/decisions/ADR-001-example.md");
const spec = read("specs/features/example/spec.md");
const story = read("specs/stories/EX-001-first/story.md");
const acceptance = read("specs/stories/EX-001-first/acceptance.md");
const readiness = read("specs/stories/EX-001-first/readiness.json");

const declarationBytes = exportGoalPlanDeclaration({
  planId: "praxisbound-cross-check",
  revision: 1,
  nodes: [
    { nodeRef: "node-001", storyRef: "specs/stories/EX-001-first", dependsOn: [] },
    {
      nodeRef: "node-002",
      storyRef: "specs/stories/EX-001-first",
      dependsOn: ["node-001"],
    },
  ],
});

const outDir = path.join(repoRoot, "specs/plans");
mkdirSync(outDir, { recursive: true });
const declarationPath = "specs/plans/praxisbound-cross-check.json";
writeFileSync(path.join(repoRoot, declarationPath), declarationBytes);

const reviewedSources = [
  { path: "specs/decisions/ADR-001-example.md", bytes: adr },
  { path: "specs/features/example/spec.md", bytes: spec },
  { path: "specs/stories/EX-001-first/acceptance.md", bytes: acceptance },
  { path: "specs/stories/EX-001-first/story.md", bytes: story },
];

const coverageIndex = {
  batchId: "BR-002-cross-check",
  fingerprint: sha256(Buffer.from("praxisbound-cross-check-fingerprint")),
};

const manifestBytes = exportGoalPlanManifest({
  planId: "praxisbound-cross-check",
  revision: 1,
  declaration: { path: declarationPath, bytes: declarationBytes },
  nodes: [
    {
      nodeRef: "node-001",
      storyRef: "specs/stories/EX-001-first",
      readiness: { path: "specs/stories/EX-001-first/readiness.json", bytes: readiness },
      dependsOn: [],
    },
    {
      nodeRef: "node-002",
      storyRef: "specs/stories/EX-001-first",
      readiness: { path: "specs/stories/EX-001-first/readiness.json", bytes: readiness },
      dependsOn: ["node-001"],
    },
  ],
  reviewedSources,
  coverageIndex,
});
const manifestDir = path.join(repoRoot, "specs/batches/BR-002-cross-check/goal-plan");
mkdirSync(manifestDir, { recursive: true });
const manifestPath = "specs/batches/BR-002-cross-check/goal-plan/manifest.json";
writeFileSync(path.join(repoRoot, manifestPath), manifestBytes);

const sourceFacts = new Map([
  [declarationPath, declarationBytes],
  ["specs/stories/EX-001-first/readiness.json", readiness],
  ...reviewedSources.map((s) => [s.path, s.bytes]),
]);

const reviewBytes = exportPlanCoverageReview({
  manifestBytes,
  reviewId: "00000000-0000-4000-8000-0000000000ab",
  conclusion: "approved",
  reviewer: { name: "PraxisBound Cross-Check", assurance: "self-asserted" },
  reviewedAt: "2026-09-23T00:00:00.000Z",
  sources: sourceFacts,
});
const reviewPath = "specs/batches/BR-002-cross-check/goal-plan/coverage-review.json";
writeFileSync(path.join(repoRoot, reviewPath), reviewBytes);

console.log(JSON.stringify({ declarationPath, manifestPath, reviewPath }, null, 2));
