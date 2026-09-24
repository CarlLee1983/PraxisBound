#!/usr/bin/env node
// TST-033 AC-005：尚未 `execution authorize` 時執行 §11 步驟 8（重查後 `run --dry-run`），如實記錄並交給 `review observe`。
// 用法：node dry-run-unauthorized.mjs <config.json> <observation-output.json>
// 人尚未授權，因此不論 dry-run 結果如何都不執行 `run`；停止理由以 `awaiting-authorization` 送出，
// 若 `review observe` 拒絕，該拒絕本身就是演練證據，不改寫紀錄去迎合驗證。
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [configPath, observationPath] = process.argv.slice(2);
if (!configPath || !observationPath) throw new Error("usage: dry-run-unauthorized.mjs <config.json> <observation-output.json>");
const config = JSON.parse(readFileSync(configPath, "utf8"));
const root = config.fixture;
const manifestPath = `${config.goalPlanDir}/manifest.json`;
const manifestBytes = readFileSync(join(root, manifestPath));
const goalManifest = JSON.parse(manifestBytes);
const run = (cmd, args) => spawnSync(cmd, args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const step = (command, r) => ({ command, exit: r.status ?? null, stdout: r.stdout ?? "", stderr: r.stderr ?? "" });

const recheck = run(config.praxisbound, [
  "review", "preflight", config.manifest, "--semantic-report", config.semanticReport,
  "--expect-fingerprint", goalManifest.coverageIndex.fingerprint, "--json",
]);
const dryRun = run(config.forgepilot, ["run", "--goal", goalManifest.plan.id, "--runtime", "codex", "--snapshot", "--dry-run"]);
const observation = {
  schemaVersion: "2.0.0",
  batchId: goalManifest.coverageIndex.batchId,
  fingerprint: goalManifest.coverageIndex.fingerprint,
  goalPlan: { path: manifestPath, sha256: createHash("sha256").update(manifestBytes).digest("hex") },
  goalId: goalManifest.plan.id,
  forgepilotVersion: config.forgepilotVersion,
  observedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  steps: [step("preflight", recheck), step("run-dry-run", dryRun)],
  stoppedBecause: dryRun.status === 0 ? "awaiting-authorization" : "step-failed",
};
writeFileSync(observationPath, `${JSON.stringify(observation, null, 2)}\n`);
const observe = run(config.praxisbound, ["review", "observe", config.manifest, observationPath, "--json"]);
process.stdout.write(`dry-run exit=${dryRun.status}\nstoppedBecause=${observation.stoppedBecause}\nobserve exit=${observe.status}\n${observe.stdout}`);
