#!/usr/bin/env node
// TST-035：依 contract §11 步驟 8–9 執行第二段，並以 `review observe` 記錄。
// 用法：node segment2.mjs <config.json> <observation-output.json>
// AC-004 在人授權前執行本腳本（預期 `run` 被拒、回報 run-failed）；AC-003 在人於會話中表示已執行
// `execution authorize` 之後執行。腳本本身不判斷授權，也從不執行 `execution authorize` 或 `execution supervise`。
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const STREAM_LIMIT = 1024 * 1024;
const [configPath, observationPath] = process.argv.slice(2);
if (!configPath || !observationPath) throw new Error("usage: segment2.mjs <config.json> <observation-output.json>");
const config = JSON.parse(readFileSync(configPath, "utf8"));
const root = config.fixture;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const manifestPath = `${config.goalPlanDir}/manifest.json`;
const manifestBytes = readFileSync(join(root, manifestPath));
const manifestSha = sha256(manifestBytes);
const goalManifest = JSON.parse(manifestBytes);
const goalId = goalManifest.plan.id;
const fingerprint = goalManifest.coverageIndex.fingerprint;
const executablePath = config.values.workerProfile.executablePath;
const steps = [];

function capture(text) {
  const bytes = Buffer.byteLength(text);
  if (bytes <= STREAM_LIMIT) return { text, truncated: false, bytes };
  return { text: Buffer.from(text).subarray(0, STREAM_LIMIT).toString("utf8"), truncated: true, bytes };
}

function record(command, result) {
  const out = capture(result.stdout ?? "");
  const err = capture(result.stderr ?? "");
  const step = { command, exit: result.status ?? null, stdout: out.text, stderr: err.text };
  if (out.truncated || err.truncated) {
    step.truncated = true;
    step.originalStdoutBytes = out.bytes;
    step.originalStderrBytes = err.bytes;
  }
  steps.push(step);
  return step;
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
  process.stdout.write(`stoppedBecause=${stoppedBecause}\nobserve exit=${observe.status}\n${observe.stdout}`);
  process.exit(observe.status ?? 1);
}

// contract §11 的 run exit 對照表
function runStop(exit) {
  if (exit === 0) return "goal-completed";
  if (exit === 2) return "run-needs-human";
  if (exit === 3) return "run-limit-reached";
  if (exit === 130 || exit === 143) return "run-interrupted";
  return "run-failed";
}

const forgepilot = (args) =>
  spawnSync(config.forgepilot, args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const runArgs = ["run", "--goal", goalId, "--runtime", "codex", "--runtime-command", executablePath, "--snapshot"];

// 步驟 8：重做步驟 2 的重查，再 dry-run。
const recheck = record(
  "preflight",
  spawnSync(
    config.praxisbound,
    ["review", "preflight", config.manifest, "--semantic-report", config.semanticReport, "--expect-fingerprint", fingerprint, "--json"],
    { cwd: root, encoding: "utf8" },
  ),
);
if (recheck.exit !== 0 || sha256(readFileSync(join(root, manifestPath))) !== manifestSha) finish("preflight-not-ready");
const dryRun = record("run-dry-run", forgepilot([...runArgs, "--dry-run"]));
if (dryRun.exit !== 0) finish("step-failed");

// 步驟 9：真正的 run；授權的關卡在此。
const run = record("run", forgepilot(runArgs));
finish(runStop(run.exit));
