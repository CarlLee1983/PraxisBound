/**
 * AC-007 cross-check: run this Core's compiled validators against
 * ForgePilot 32b7a68's own Goal Plan artifact fixtures.
 *
 * Usage (from the PraxisBound repository root, after `pnpm run build`):
 *   node specs/stories/TST-029-goal-plan-shape-alignment/evidence/check-forgepilot-fixtures.mjs \
 *     <path to a clean checkout/archive of ForgePilot 32b7a68>
 *
 * The ForgePilot path defaults to $FORGEPILOT_ROOT when the argument is
 * omitted. See verification.md for the exact commands used to obtain it
 * and the verbatim output of this script.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(new URL("../../../..", import.meta.url).pathname);
const distPath = path.join(
  repoRoot,
  "packages/core/dist/goal-plan-artifacts.js",
);
const {
  validateGoalPlanManifest,
  validatePlanCoverageReview,
} = await import(distPath);

const forgePilotRoot = process.argv[2] ?? process.env.FORGEPILOT_ROOT;
if (forgePilotRoot === undefined) {
  console.error(
    "usage: node check-forgepilot-fixtures.mjs <ForgePilot 32b7a68 checkout root> (or set FORGEPILOT_ROOT)",
  );
  process.exit(2);
}
const fpRoot = path.join(
  forgePilotRoot,
  "internal/app/testdata/goal-plan-artifacts/v1",
);

function bytes(rel) {
  return readFileSync(path.join(fpRoot, rel));
}

function repoSourceFacts() {
  const repo = path.join(fpRoot, "valid/repository");
  return new Map([
    [
      "specs/plans/example-goal.json",
      readFileSync(path.join(repo, "specs/plans/example-goal.json")),
    ],
    [
      "specs/decisions/ADR-001-example.md",
      readFileSync(path.join(repo, "specs/decisions/ADR-001-example.md")),
    ],
    [
      "specs/features/example/spec.md",
      readFileSync(path.join(repo, "specs/features/example/spec.md")),
    ],
    [
      "specs/stories/EX-001-first/acceptance.md",
      readFileSync(
        path.join(repo, "specs/stories/EX-001-first/acceptance.md"),
      ),
    ],
    [
      "specs/stories/EX-001-first/story.md",
      readFileSync(path.join(repo, "specs/stories/EX-001-first/story.md")),
    ],
    [
      "specs/stories/EX-001-first/readiness.json",
      readFileSync(
        path.join(repo, "specs/stories/EX-001-first/readiness.json"),
      ),
    ],
  ]);
}

let failed = false;
function report(label, ok, expectedOk, category, expectedCategory) {
  const pass = ok === expectedOk && (expectedCategory === undefined || category === expectedCategory);
  console.log(pass ? "PASS" : "FAIL", label, "-> ok=" + ok, "category=" + category);
  if (!pass) failed = true;
}

// Valid fixtures must validate.
{
  const manifestBytes = bytes("valid/goal-plan-manifest.json");
  const result = validateGoalPlanManifest(manifestBytes, repoSourceFacts());
  report("valid/goal-plan-manifest.json", result.ok, true, result.category);

  const reviewResult = validatePlanCoverageReview(
    bytes("valid/plan-coverage-review.json"),
    manifestBytes,
    repoSourceFacts(),
  );
  report("valid/plan-coverage-review.json", reviewResult.ok, true, reviewResult.category);
}

// The 5 invalid fixtures must be rejected.
{
  const result = validateGoalPlanManifest(
    bytes("invalid/cycle-goal-plan-manifest.json"),
    new Map(),
  );
  report("invalid/cycle-goal-plan-manifest.json", result.ok, false, result.category);
}
{
  const result = validateGoalPlanManifest(
    bytes("invalid/dangling-dependency-goal-plan-manifest.json"),
    new Map(),
  );
  report(
    "invalid/dangling-dependency-goal-plan-manifest.json",
    result.ok,
    false,
    result.category,
  );
}
{
  const manifestBytes = bytes("valid/goal-plan-manifest.json");
  const result = validatePlanCoverageReview(
    bytes("invalid/manifest-digest-mismatch-plan-coverage-review.json"),
    manifestBytes,
    repoSourceFacts(),
  );
  report(
    "invalid/manifest-digest-mismatch-plan-coverage-review.json",
    result.ok,
    false,
    result.category,
  );
}
{
  const result = validateGoalPlanManifest(
    bytes("invalid/readiness-digest-mismatch-goal-plan-manifest.json"),
    repoSourceFacts(),
  );
  report(
    "invalid/readiness-digest-mismatch-goal-plan-manifest.json",
    result.ok,
    false,
    result.category,
  );
}
{
  const result = validateGoalPlanManifest(
    bytes("invalid/source-digest-mismatch-goal-plan-manifest.json"),
    repoSourceFacts(),
  );
  report(
    "invalid/source-digest-mismatch-goal-plan-manifest.json",
    result.ok,
    false,
    result.category,
  );
}

if (failed) process.exit(1);
console.log("all ForgePilot fixture checks passed");
