#!/usr/bin/env node

import { readFileSync } from "node:fs";

import {
  activationHelp,
  renderActivationHuman,
  runActivation,
} from "./activation.js";
import {
  renderDoctorVerificationHuman,
  renderDoctorVerificationStart,
  runDoctorVerification,
} from "./doctor-execution.js";
import { doctorHelp, renderDoctorHuman, runDoctor } from "./doctor.js";
import { handoffHelp, renderHandoffHuman, runHandoffCheck } from "./handoff.js";
import { initHelp, renderInitHuman, runInit } from "./init.js";
import { serializeResultEnvelope } from "./machine.js";
import { releaseHelp, renderReleaseHuman, runReleaseCheck } from "./release.js";
import {
  renderReviewIndexHuman,
  renderReviewRenderHuman,
  reviewHelp,
  reviewRenderHelp,
  runReviewIndex,
  runReviewRender,
} from "./review.js";
import {
  renderReviewImportHuman,
  reviewImportHelp,
  runReviewImport,
} from "./review-import.js";
import {
  renderReviewRespondHuman,
  reviewRespondHelp,
  runReviewRespond,
} from "./review-respond.js";
import { renderStoryHuman, runStoryCheck, storyHelp } from "./story.js";
import {
  renderVerifyHuman,
  renderVerifyStart,
  runVerify,
  verifyHelp,
} from "./verify.js";
import {
  renderVerificationHuman,
  runVerificationCheck,
  verificationHelp,
} from "./verification.js";

const manifestUrl = new URL("../package.json", import.meta.url);
const manifest = JSON.parse(readFileSync(manifestUrl, "utf8")) as {
  version?: unknown;
};

if (typeof manifest.version !== "string") {
  throw new Error("The PraxisBound CLI package manifest has no version.");
}

const help = `PraxisBound CLI v${manifest.version}

Usage:
  praxisbound [command]

Commands:
  init               Plan or apply PraxisBound initialization
  codex activate     Preview or apply project-local Codex activation
  doctor             Inspect the static Repository Contract
  verify             Run the canonical repository verification target
  handoff check      Check immutable Handoff evidence
  release check      Inspect local Git release readiness
  story check        Check the static Story contract
  review index       Report the batch review source index
  review render      Write an offline batch review HTML projection
  review import      Record an exported Revision Sheet
  review respond     Record a Revision Response file
  verification check Resolve plans and check recorded results
  help, --help       Show this help
  version, --version Print the CLI version

Other migration commands are unavailable.
`;
const unavailable =
  "praxisbound: command unavailable; this command is not available. Run praxisbound --help.\n";
const args = process.argv.slice(2);

function activationGlobalOption(
  commandArgs: readonly string[],
): "--help" | "--version" | "invalid" | undefined {
  let selected: "--help" | "--version" | undefined;
  for (const argument of commandArgs) {
    if (argument === "--") break;
    if (argument !== "--help" && argument !== "--version") continue;
    if (selected !== undefined) return "invalid";
    selected = argument;
  }
  return selected;
}

function executionObserver(mode: "human" | "json") {
  return Object.freeze({
    onStdout: (chunk: string) => {
      if (mode === "human") process.stdout.write(chunk);
      else process.stderr.write(chunk);
    },
    onStderr: (chunk: string) => process.stderr.write(chunk),
  });
}

if (
  args.length === 0 ||
  (args.length === 1 && (args[0] === "help" || args[0] === "--help"))
) {
  process.stdout.write(help);
} else if (
  args.length === 1 &&
  (args[0] === "version" || args[0] === "--version")
) {
  process.stdout.write(`${manifest.version}\n`);
} else if (args.length === 2 && args[0] === "init" && args[1] === "--help") {
  process.stdout.write(initHelp);
} else if (args[0] === "init") {
  const execution = await runInit(args.slice(1));
  if (execution.mode === "json") {
    process.stdout.write(serializeResultEnvelope(execution.result));
  } else {
    const rendered = renderInitHuman(execution);
    process.stdout.write(rendered.stdout);
    process.stderr.write(rendered.stderr);
  }
  process.exitCode = execution.result.exit;
} else if (
  args[0] === "codex" &&
  args[1] === "activate" &&
  activationGlobalOption(args.slice(2)) === "--help"
) {
  process.stdout.write(activationHelp);
} else if (
  args[0] === "codex" &&
  args[1] === "activate" &&
  activationGlobalOption(args.slice(2)) === "--version"
) {
  process.stdout.write(`${manifest.version}\n`);
} else if (args[0] === "codex" && args[1] === "activate") {
  const execution = await runActivation(args.slice(2));
  if (execution.mode === "json") {
    process.stdout.write(serializeResultEnvelope(execution.result));
  } else {
    const rendered = renderActivationHuman(execution);
    process.stdout.write(rendered.stdout);
    process.stderr.write(rendered.stderr);
  }
  process.exitCode = execution.result.exit;
} else if (args.length === 2 && args[0] === "doctor" && args[1] === "--help") {
  process.stdout.write(doctorHelp);
} else if (args[0] === "doctor" && args[1] === "--run-verify") {
  const mode = args[2] === "--json" ? "json" : "human";
  const execution = await runDoctorVerification(
    args.slice(1),
    process.cwd(),
    undefined,
    undefined,
    executionObserver(mode),
    (staticExecution) => {
      if (mode === "human")
        process.stdout.write(renderDoctorVerificationStart(staticExecution));
    },
  );
  if (execution.mode === "json") {
    const result =
      execution.kind === "executed"
        ? execution.execution.result
        : execution.static.evaluation.result;
    process.stdout.write(serializeResultEnvelope(result));
  } else {
    const rendered = renderDoctorVerificationHuman(execution);
    process.stdout.write(rendered.stdout);
    process.stderr.write(rendered.stderr);
  }
  process.exitCode =
    execution.kind === "executed"
      ? execution.execution.result.exit
      : execution.static.evaluation.result.exit;
} else if (args[0] === "doctor") {
  const execution = await runDoctor(args.slice(1));
  if (execution.mode === "json") {
    process.stdout.write(serializeResultEnvelope(execution.evaluation.result));
  } else {
    const rendered = renderDoctorHuman(execution);
    process.stdout.write(rendered.stdout);
    process.stderr.write(rendered.stderr);
  }
  process.exitCode = execution.evaluation.result.exit;
} else if (args.length === 2 && args[0] === "verify" && args[1] === "--help") {
  process.stdout.write(verifyHelp);
} else if (args[0] === "verify") {
  const mode = args[1] === "--json" ? "json" : "human";
  const execution = await runVerify(
    args.slice(1),
    process.cwd(),
    undefined,
    undefined,
    executionObserver(mode),
    () => {
      if (mode === "human") process.stdout.write(renderVerifyStart());
    },
  );
  if (execution.mode === "json") {
    process.stdout.write(serializeResultEnvelope(execution.result));
  } else {
    const rendered = renderVerifyHuman(execution);
    process.stdout.write(rendered.stdout);
    process.stderr.write(rendered.stderr);
  }
  process.exitCode = execution.result.exit;
} else if (
  args.length === 3 &&
  args[0] === "release" &&
  args[1] === "check" &&
  args[2] === "--help"
) {
  process.stdout.write(releaseHelp);
} else if (args[0] === "release" && args[1] === "check") {
  const execution = await runReleaseCheck(args.slice(2), process.cwd());
  if (execution.mode === "json") {
    process.stdout.write(serializeResultEnvelope(execution.result));
  } else {
    const rendered = renderReleaseHuman(execution);
    process.stdout.write(rendered.stdout);
    process.stderr.write(rendered.stderr);
  }
  process.exitCode = execution.result.exit;
} else if (
  args.length === 3 &&
  args[0] === "handoff" &&
  args[1] === "check" &&
  args[2] === "--help"
) {
  process.stdout.write(handoffHelp);
} else if (
  args.length === 3 &&
  args[0] === "story" &&
  args[1] === "check" &&
  args[2] === "--help"
) {
  process.stdout.write(storyHelp);
} else if (args[0] === "story" && args[1] === "check") {
  const execution = await runStoryCheck(args.slice(2));
  if (execution.mode === "json") {
    process.stdout.write(serializeResultEnvelope(execution.result));
  } else {
    const rendered = renderStoryHuman(execution);
    process.stdout.write(rendered.stdout);
    process.stderr.write(rendered.stderr);
  }
  process.exitCode = execution.result.exit;
} else if (
  args.length === 3 &&
  args[0] === "review" &&
  args[1] === "index" &&
  args[2] === "--help"
) {
  process.stdout.write(reviewHelp);
} else if (args[0] === "review" && args[1] === "index") {
  const execution = await runReviewIndex(args.slice(2));
  if (execution.mode === "json") {
    process.stdout.write(serializeResultEnvelope(execution.result));
  } else {
    const rendered = renderReviewIndexHuman(execution);
    process.stdout.write(rendered.stdout);
    process.stderr.write(rendered.stderr);
  }
  process.exitCode = execution.result.exit;
} else if (
  args.length === 3 &&
  args[0] === "review" &&
  args[1] === "render" &&
  args[2] === "--help"
) {
  process.stdout.write(reviewRenderHelp);
} else if (args[0] === "review" && args[1] === "render") {
  const execution = await runReviewRender(args.slice(2));
  if (execution.mode === "json") {
    process.stdout.write(serializeResultEnvelope(execution.result));
  } else {
    const rendered = renderReviewRenderHuman(execution);
    process.stdout.write(rendered.stdout);
    process.stderr.write(rendered.stderr);
  }
  process.exitCode = execution.result.exit;
} else if (
  args.length === 3 &&
  args[0] === "review" &&
  args[1] === "import" &&
  args[2] === "--help"
) {
  process.stdout.write(reviewImportHelp);
} else if (args[0] === "review" && args[1] === "import") {
  const execution = await runReviewImport(args.slice(2));
  if (execution.mode === "json") {
    process.stdout.write(serializeResultEnvelope(execution.result));
  } else {
    const rendered = renderReviewImportHuman(execution);
    process.stdout.write(rendered.stdout);
    process.stderr.write(rendered.stderr);
  }
  process.exitCode = execution.result.exit;
} else if (
  args.length === 3 &&
  args[0] === "review" &&
  args[1] === "respond" &&
  args[2] === "--help"
) {
  process.stdout.write(reviewRespondHelp);
} else if (args[0] === "review" && args[1] === "respond") {
  const execution = await runReviewRespond(args.slice(2));
  if (execution.mode === "json") {
    process.stdout.write(serializeResultEnvelope(execution.result));
  } else {
    const rendered = renderReviewRespondHuman(execution);
    process.stdout.write(rendered.stdout);
    process.stderr.write(rendered.stderr);
  }
  process.exitCode = execution.result.exit;
} else if (
  args.length === 3 &&
  args[0] === "verification" &&
  args[1] === "check" &&
  args[2] === "--help"
) {
  process.stdout.write(verificationHelp);
} else if (args[0] === "verification" && args[1] === "check") {
  const execution = await runVerificationCheck(args.slice(2));
  if (execution.mode === "json") {
    process.stdout.write(serializeResultEnvelope(execution.result));
  } else {
    const rendered = renderVerificationHuman(execution);
    process.stdout.write(rendered.stdout);
    process.stderr.write(rendered.stderr);
  }
  process.exitCode = execution.result.exit;
} else if (args[0] === "handoff" && args[1] === "check") {
  const execution = await runHandoffCheck(args.slice(2));
  if (execution.mode === "json") {
    process.stdout.write(serializeResultEnvelope(execution.evaluation.result));
  } else {
    const rendered = renderHandoffHuman(execution);
    process.stdout.write(rendered.stdout);
    process.stderr.write(rendered.stderr);
  }
  process.exitCode = execution.evaluation.result.exit;
} else {
  process.stderr.write(unavailable);
  process.exitCode = 2;
}
