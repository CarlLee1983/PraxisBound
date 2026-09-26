#!/usr/bin/env node
// TST-035：依 contract §11（TST-034 修訂版）執行第一段「建立並預覽」，並以 `review observe` 記錄。
// 用法：node segment1.mjs <config.json> <observation-output.json> [--swap-mappings]
// --swap-mappings（AC-006）：故意把前兩個 node 的 workItemId 對調，使 `goal preflight` exit 0 但回報 diagnostics。
// config：{ fixture, forgepilot, praxisbound, manifest, semanticReport, goalPlanDir, forgepilotVersion, values }
// values 只來自人在會話中提供的值：workerProfile、engineGeneration、caps、expiresAt。
// 腳本從不執行 `review confirm`、`execution authorize`，也不讀寫 `.forgepilot`。
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const STREAM_LIMIT = 1024 * 1024;
const [configPath, observationPath, flag] = process.argv.slice(2);
const swapMappings = flag === "--swap-mappings";
if (!configPath || !observationPath) throw new Error("usage: segment1.mjs <config.json> <observation-output.json>");
const config = JSON.parse(readFileSync(configPath, "utf8"));
const root = config.fixture;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const manifestPath = `${config.goalPlanDir}/manifest.json`;
const manifestBytes = readFileSync(join(root, manifestPath));
const manifestSha = sha256(manifestBytes);
const goalManifest = JSON.parse(manifestBytes);
const goalId = goalManifest.plan.id;
const fingerprint = goalManifest.coverageIndex.fingerprint;
const steps = [];

function capture(text) {
  const bytes = Buffer.byteLength(text);
  if (bytes <= STREAM_LIMIT) return { text, truncated: false, bytes };
  return { text: Buffer.from(text).subarray(0, STREAM_LIMIT).toString("utf8"), truncated: true, bytes };
}

function record(command, result, extra = {}) {
  const out = capture(result.stdout ?? "");
  const err = capture(result.stderr ?? "");
  const step = { command, ...extra, exit: result.status ?? null, stdout: out.text, stderr: err.text };
  if (out.truncated || err.truncated) {
    step.truncated = true;
    step.originalStdoutBytes = out.bytes;
    step.originalStderrBytes = err.bytes;
  }
  steps.push(step);
  return step;
}

function forgepilot(args) {
  return spawnSync(config.forgepilot, args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function finish(stoppedBecause) {
  const observation = {
    schemaVersion: "2.0.0",
    batchId: goalManifest.coverageIndex.batchId,
    fingerprint,
    goalPlan: { path: manifestPath, sha256: manifestSha },
    goalId,
    forgepilotVersion: config.forgepilotVersion,
    observedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    steps,
    stoppedBecause,
  };
  writeFileSync(observationPath, `${JSON.stringify(observation, null, 2)}\n`);
  const observe = spawnSync(config.praxisbound, ["review", "observe", config.manifest, observationPath, "--json"], {
    cwd: root,
    encoding: "utf8",
  });
  process.stdout.write(`stoppedBecause=${stoppedBecause}\n${observe.stdout}`);
  process.exit(observe.status ?? 1);
}

// §11 步驟 2：每個 ForgePilot 寫入前重查；步驟 3 前的這次重查同時涵蓋 goal create。
function recheck() {
  const result = spawnSync(
    config.praxisbound,
    ["review", "preflight", config.manifest, "--semantic-report", config.semanticReport, "--expect-fingerprint", fingerprint, "--json"],
    { cwd: root, encoding: "utf8" },
  );
  record("preflight", result);
  const current = sha256(readFileSync(join(root, manifestPath)));
  if (result.status !== 0 || current !== manifestSha) finish("preflight-not-ready");
}

function parseOrStop(step) {
  if (step.exit !== 0) finish("step-failed");
  try {
    return JSON.parse(step.stdout);
  } catch {
    finish("result-unknown");
  }
}

// 依 declaration 拓撲序（同層依 Story ID）
function topologicalNodes() {
  const nodes = [...goalManifest.nodes].sort((a, b) => (a.nodeRef < b.nodeRef ? -1 : 1));
  const done = new Set();
  const ordered = [];
  while (ordered.length < nodes.length) {
    const layer = nodes.filter((n) => !done.has(n.nodeRef) && n.dependsOn.every((d) => done.has(d)));
    if (layer.length === 0) throw new Error("dependency cycle in Goal Plan");
    for (const n of layer) {
      ordered.push(n);
      done.add(n.nodeRef);
    }
  }
  return ordered;
}

recheck();
const list = record("work-list", forgepilot(["work", "list", "--goal", goalId, "--json"]));
const workItemByStory = new Map();
if (list.exit !== 0) {
  // §11 步驟 3：不解析輸出，直接 goal create；其 exit 決定結果。
  const create = record(
    "goal-create",
    forgepilot(["goal", "create", "--id", goalId, "--title", goalManifest.coverageIndex.batchId, "--review-policy", "goal", "--json"]),
  );
  parseOrStop(create);
} else {
  const existing = parseOrStop(list);
  // ForgePilot 以大寫 `GOAL` 回報 `--review-policy goal`（contract §11 步驟 3，TST-034）。
  if (existing.goal?.review_policy !== "GOAL") finish("goal-mismatch");
  for (const item of existing.work_items ?? []) {
    const node = goalManifest.nodes.find((n) => n.nodeRef === item.external_ref);
    if (!node || item.story_ref !== node.storyRef) finish("work-mismatch");
    workItemByStory.set(node.nodeRef, item);
  }
  for (const [story, item] of workItemByStory) {
    const node = goalManifest.nodes.find((n) => n.nodeRef === story);
    const expected = node.dependsOn.map((d) => workItemByStory.get(d)?.id).sort();
    if (expected.includes(undefined) || JSON.stringify(expected) !== JSON.stringify([...item.depends_on].sort())) finish("work-mismatch");
  }
}

for (const node of topologicalNodes()) {
  recheck();
  const dependsOn = node.dependsOn.flatMap((d) => ["--depends-on", workItemByStory.get(d).id]);
  const add = record(
    "work-add",
    forgepilot(["work", "add", "--goal", goalId, "--story", node.storyRef, "--external-ref", node.nodeRef, ...dependsOn, "--json"]),
    { story: node.nodeRef },
  );
  if (add.exit !== 0) finish("step-failed");
  const parsed = parseOrStop(add);
  add.workItemId = parsed.work_item?.id;
  add.created = parsed.created;
  if (typeof add.workItemId !== "string" || typeof add.created !== "boolean") finish("result-unknown");
  workItemByStory.set(node.nodeRef, parsed.work_item);
}

const goalPlanRequest = {
  formatVersion: "forgepilot.goal-preflight-request/v1",
  goalId,
  manifestPath,
  coverageReviewPath: `${config.goalPlanDir}/coverage-review.json`,
  nodeMappings: goalManifest.nodes.map((n) => ({ planNodeRef: n.nodeRef, workItemId: workItemByStory.get(n.nodeRef).id })),
};
if (swapMappings) {
  const [a, b] = goalPlanRequest.nodeMappings;
  [a.workItemId, b.workItemId] = [b.workItemId, a.workItemId];
}
// 頂層 diagnostics 必須為 null 或空陣列；巢狀物件內的 diagnostics 不計（contract §11，TST-034）。
const failedDiagnostics = (result) => !(result.diagnostics === null || (Array.isArray(result.diagnostics) && result.diagnostics.length === 0));
const preflightRequestPath = `${config.goalPlanDir}/preflight-request.json`;
writeFileSync(join(root, preflightRequestPath), `${JSON.stringify(goalPlanRequest, null, 2)}\n`);
const goalPreflight = record("goal-preflight", forgepilot(["goal", "preflight", "--request", preflightRequestPath, "--json"]));
const goalPreflightResult = parseOrStop(goalPreflight);
if (failedDiagnostics(goalPreflightResult)) finish("goal-preflight-failed");

const executionRequest = {
  formatVersion: "forgepilot.execution-plan-request/v2",
  goalPlanRequest,
  workerProfile: config.values.workerProfile,
  engineGeneration: config.values.engineGeneration,
  caps: config.values.caps,
  expiresAt: config.values.expiresAt,
};
const executionRequestPath = `${config.goalPlanDir}/execution-request.json`;
writeFileSync(join(root, executionRequestPath), `${JSON.stringify(executionRequest, null, 2)}\n`);
const plan = record("execution-plan", forgepilot(["execution", "plan", "--request", executionRequestPath, "--json"]));
const planResult = parseOrStop(plan);
if (failedDiagnostics(planResult) || typeof planResult.approvalToken !== "string") finish("execution-plan-failed");
finish("awaiting-authorization");
