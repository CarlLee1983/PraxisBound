import { readdir, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import {
  IMPLEMENTED_PROTOCOL_VERSION,
  RESULT_SCHEMA_VERSION,
  evaluateStoryContract,
  evaluateStoryReadiness,
  readStoryDecisions,
  type ResultEnvelope,
  type ResultIssue,
  type StoryDecisionRecord,
  type StoryFacts,
} from "@praxisbound/core";

import { nodeFileAccess, readSafeSource, type FileAccess } from "./source.js";

export type StoryOutputMode = "human" | "json";

export type StoryDiscovery =
  | { readonly ok: true; readonly stories: readonly string[] }
  | { readonly ok: false };

export interface StoryFileAccess extends FileAccess {
  readdir(path: string): Promise<readonly string[]>;
  stat(path: string): Promise<{ isDirectory(): boolean }>;
}

export const nodeStoryFileAccess: StoryFileAccess = {
  ...nodeFileAccess,
  readdir,
  stat,
};

export interface StoryReader {
  /** Lists every Story directory under the default Story root. */
  discover(): Promise<StoryDiscovery>;
  isStoryDirectory(path: string): Promise<boolean>;
  readStoryFile(
    path: string,
  ): Promise<
    | { readonly ok: true; readonly source: string }
    | { readonly ok: false; readonly reason: "symlink" | "unavailable" }
  >;
  /** Resolves one referenced decision record under the Story's decision root. */
  readDecision(
    storyDirectory: string,
    id: string,
  ): Promise<StoryDecisionRecord>;
}

/** One checked Story, or one subject that could not be checked. */
export type StoryEntry =
  | {
      readonly kind: "story";
      readonly label: string;
      readonly facts: StoryFacts;
      readonly issues: readonly ResultIssue[];
      readonly structureIssues: readonly ResultIssue[];
    }
  | {
      readonly kind: "error";
      readonly label?: string;
      readonly issue: ResultIssue;
      readonly diagnostic: string;
    };

/** The stable result name the command reports, as the retained checker names it. */
export type StoryOutcomeName =
  | "STORY_CONTRACT_OK"
  | "STORY_CONTRACT_INCOMPLETE"
  | "STORY_READINESS_OK"
  | "STORY_READINESS_INCOMPLETE"
  | "ERROR";

export interface StoryCommandExecution {
  readonly mode: StoryOutputMode;
  readonly ready: boolean;
  readonly entries: readonly StoryEntry[];
  readonly checked: number;
  readonly outcome: StoryOutcomeName;
  readonly result: ResultEnvelope;
}

export interface StoryRenderedOutput {
  readonly stdout: string;
  readonly stderr: string;
}

export const DEFAULT_STORY_ROOT = "specs/stories";
const TEMPLATE_DIRECTORY = "_template";
const REQUIRED_STORY_FILES = ["story.md", "acceptance.md"] as const;
const DEFAULT_DECISIONS_ROOT = "decisions";
const BANNER = "PraxisBound Story Contract Check\n";

export const storyHelp = `PraxisBound Story Contract Check

Usage:
  praxisbound story check [--ready] [--json] [story-directory ...]
  praxisbound story check --help

Without a story directory, every directory under specs/stories/ except
_template/ is checked relative to the current directory.

The command checks the Story ID, classification, governance declarations,
referenced decisions, risk signals and their contracts, the security
fixture matrix, trust boundaries, and superseded behavior.

--ready additionally checks Goal and Scope content, checkbox acceptance
criteria, Acceptance Evidence, placeholders, and risk-evidence links.

The check is static and read-only. It never executes repository code and
never replaces make verify or human review.
`;

function issue(code: string, message: string): ResultIssue {
  return Object.freeze({ code, message });
}

function envelope(
  status: "pass" | "fail" | "error",
  outcome: "success" | "failure" | "usage-error" | "configuration-error",
  exit: 0 | 1 | 2,
  issues: readonly ResultIssue[],
): ResultEnvelope {
  return Object.freeze({
    schemaVersion: RESULT_SCHEMA_VERSION,
    protocolVersion: IMPLEMENTED_PROTOCOL_VERSION,
    status,
    outcome,
    exit,
    subject: "story",
    issues: Object.freeze([...issues]),
  } as const);
}

export function createNodeStoryReader(
  fileAccess: StoryFileAccess = nodeStoryFileAccess,
  root: string = process.cwd(),
  environment: NodeJS.ProcessEnv = process.env,
): StoryReader {
  const locate = (path: string): string =>
    isAbsolute(path) ? path : resolve(root, path);
  const isDirectory = async (path: string): Promise<boolean> => {
    try {
      return (await fileAccess.stat(locate(path))).isDirectory();
    } catch {
      return false;
    }
  };

  return Object.freeze({
    isStoryDirectory: isDirectory,
    readStoryFile: (path: string) => readSafeSource(fileAccess, locate(path)),

    async readDecision(
      storyDirectory: string,
      id: string,
    ): Promise<StoryDecisionRecord> {
      // The retained checker resolves decisions next to the Story collection
      // unless the environment names another root.
      const legacy = environment["FORGEFLOW_DECISIONS_ROOT"];
      if (legacy !== undefined && legacy !== "")
        return {
          kind: "retired",
          message:
            "FORGEFLOW_DECISIONS_ROOT is retired; use PRAXISBOUND_DECISIONS_ROOT.",
        };
      const configured = environment["PRAXISBOUND_DECISIONS_ROOT"];
      const decisionsRoot =
        configured !== undefined && configured !== ""
          ? configured
          : resolve(locate(storyDirectory), "..", "..", DEFAULT_DECISIONS_ROOT);

      let names: readonly string[];
      try {
        names = await fileAccess.readdir(locate(decisionsRoot));
      } catch {
        return { kind: "missing" };
      }

      // The checker globs <root>/<ID>.md and <root>/<ID>-*.md, and skips a
      // symlinked candidate rather than following it.
      const candidates: string[] = [];
      for (const name of [...names].sort()) {
        if (name !== `${id}.md` && !name.startsWith(`${id}-`)) continue;
        if (name !== `${id}.md` && !name.endsWith(".md")) continue;
        const path = `${decisionsRoot}/${name}`;
        try {
          const stats = await fileAccess.lstat(locate(path));
          if (stats.isSymbolicLink() || !stats.isFile()) continue;
        } catch {
          continue;
        }
        candidates.push(path);
      }

      if (candidates.length === 0) return { kind: "missing" };
      if (candidates.length > 1) return { kind: "ambiguous" };

      const read = await readSafeSource(
        fileAccess,
        locate(candidates[0] as string),
      );
      return read.ok
        ? { kind: "found", source: read.source }
        : { kind: "unreadable" };
    },

    async discover(): Promise<StoryDiscovery> {
      if (!(await isDirectory(DEFAULT_STORY_ROOT))) return { ok: false };

      let names: readonly string[];
      try {
        names = await fileAccess.readdir(locate(DEFAULT_STORY_ROOT));
      } catch {
        return { ok: false };
      }

      // The retained checker globs specs/stories/*, which never matches a dot
      // directory. Its order is the shell's collation, so the comparison is
      // pinned to LC_ALL=C, where that collation is byte order.
      const stories: string[] = [];
      for (const name of [...names].sort()) {
        if (name === TEMPLATE_DIRECTORY || name.startsWith(".")) continue;
        const path = `${DEFAULT_STORY_ROOT}/${name}`;
        if (await isDirectory(path)) stories.push(path);
      }

      return { ok: true, stories };
    },
  });
}

function parseArguments(args: readonly string[]): {
  readonly mode: StoryOutputMode;
  readonly ready: boolean;
  readonly stories: readonly string[];
  readonly valid: boolean;
} {
  let mode: StoryOutputMode = "human";
  let ready = false;
  let index = 0;

  for (; index < args.length; index += 1) {
    if (args[index] === "--json" && mode === "human") mode = "json";
    else if (args[index] === "--ready" && !ready) ready = true;
    else break;
  }

  const stories = args.slice(index);

  return {
    mode,
    ready,
    stories,
    valid: stories.every((argument) => !argument.startsWith("-")),
  };
}

/**
 * A narrow wrapper over `checkStory` for `review preflight` (Story TST-027,
 * contract §9 "各 Story 通過既有 `story check`"): always runs `--ready` mode,
 * never `story check`'s default contract mode, and keeps its issue codes
 * unchanged. `story check` itself is untouched.
 */
export async function checkStoryReadiness(
  reader: StoryReader,
  directory: string,
): Promise<StoryEntry> {
  return checkStory(reader, directory, true);
}

async function checkStory(
  reader: StoryReader,
  label: string,
  ready: boolean,
): Promise<StoryEntry> {
  const sourceTexts: string[] = [];

  for (const name of REQUIRED_STORY_FILES) {
    const path = `${label}/${name}`;
    const read = await reader.readStoryFile(path);
    if (!read.ok) {
      return read.reason === "symlink"
        ? {
            kind: "error",
            label,
            issue: issue(
              "STORY_FILE_SYMLINK",
              `required Story file is a symlink: ${path}`,
            ),
            diagnostic: `ERROR ${label}: required Story file is a symlink: ${path}`,
          }
        : {
            kind: "error",
            label,
            issue: issue(
              "STORY_FILE_UNAVAILABLE",
              `required Story file is missing or unreadable: ${path}`,
            ),
            diagnostic: `ERROR ${label}: required Story file is missing or unreadable: ${path}`,
          };
    }
    sourceTexts.push(read.source);
  }

  // Core is pure, so every referenced decision is resolved up front and the
  // resolution is presented to it as a plain lookup.
  const [story = "", acceptance = ""] = sourceTexts;
  const resolved = new Map<string, StoryDecisionRecord>();
  for (const id of readStoryDecisions(story))
    resolved.set(id, await reader.readDecision(label, id));

  const sources = {
    directory: label,
    story,
    acceptance,
    decision: (id: string) => resolved.get(id) ?? { kind: "missing" },
  } as const;
  if (ready) {
    const evaluation = evaluateStoryReadiness(sources);
    return {
      kind: "story",
      label,
      facts: evaluation.facts,
      issues: evaluation.result.issues,
      structureIssues: evaluation.structure.issues,
    };
  }

  const evaluation = evaluateStoryContract(sources);

  return {
    kind: "story",
    label,
    facts: evaluation.facts,
    issues: evaluation.result.issues,
    structureIssues: evaluation.result.issues,
  };
}

/** Runs `praxisbound story check` over explicit subjects or discovery. */
export async function runStoryCheck(
  args: readonly string[],
  reader: StoryReader = createNodeStoryReader(),
): Promise<StoryCommandExecution> {
  const parsed = parseArguments(args);

  if (!parsed.valid) {
    return Object.freeze({
      mode: parsed.mode,
      ready: parsed.ready,
      entries: Object.freeze([]),
      checked: 0,
      outcome: "ERROR" as const,
      result: envelope("error", "usage-error", 2, [
        issue("STORY_USAGE", "Invalid arguments"),
      ]),
    });
  }

  const entries: StoryEntry[] = [];
  let subjects: readonly string[];

  if (parsed.stories.length === 0) {
    const discovery = await reader.discover();
    if (!discovery.ok) {
      return Object.freeze({
        mode: parsed.mode,
        ready: parsed.ready,
        entries: Object.freeze([
          {
            kind: "error" as const,
            issue: issue(
              "STORY_ROOT_MISSING",
              `Story directory is missing: ${DEFAULT_STORY_ROOT}/`,
            ),
            diagnostic: `ERROR Story directory is missing: ${DEFAULT_STORY_ROOT}/`,
          },
        ]),
        checked: 0,
        outcome: "ERROR" as const,
        result: envelope("error", "configuration-error", 2, [
          issue(
            "STORY_ROOT_MISSING",
            `Story directory is missing: ${DEFAULT_STORY_ROOT}/`,
          ),
        ]),
      });
    }
    subjects = discovery.stories;
  } else {
    subjects = parsed.stories;
  }

  let checked = 0;
  for (const subject of subjects) {
    if (!(await reader.isStoryDirectory(subject))) {
      entries.push({
        kind: "error",
        issue: issue(
          "STORY_DIRECTORY_MISSING",
          `Story directory is missing: ${subject}`,
        ),
        diagnostic: `ERROR Story directory is missing: ${subject}`,
      });
      continue;
    }
    checked += 1;
    entries.push(await checkStory(reader, subject, parsed.ready));
  }

  const operationalError = entries.some((entry) => entry.kind === "error");
  const issues = entries.flatMap((entry) =>
    entry.kind === "error" ? [entry.issue] : [...entry.issues],
  );

  if (operationalError)
    return Object.freeze({
      mode: parsed.mode,
      ready: parsed.ready,
      entries: Object.freeze(entries),
      checked,
      outcome: "ERROR" as const,
      result: envelope("error", "configuration-error", 2, issues),
    });

  if (checked === 0)
    return Object.freeze({
      mode: parsed.mode,
      ready: parsed.ready,
      entries: Object.freeze([
        ...entries,
        {
          kind: "error" as const,
          issue: issue("STORY_NONE_CHECKED", "No Story directory was checked"),
          diagnostic: "ERROR No Story directory was checked",
        },
      ]),
      checked: 0,
      outcome: "ERROR" as const,
      result: envelope("error", "configuration-error", 2, [
        issue("STORY_NONE_CHECKED", "No Story directory was checked"),
      ]),
    });

  const incomplete = issues.length > 0;

  return Object.freeze({
    mode: parsed.mode,
    ready: parsed.ready,
    entries: Object.freeze(entries),
    checked,
    outcome: parsed.ready
      ? incomplete
        ? ("STORY_READINESS_INCOMPLETE" as const)
        : ("STORY_READINESS_OK" as const)
      : incomplete
        ? ("STORY_CONTRACT_INCOMPLETE" as const)
        : ("STORY_CONTRACT_OK" as const),
    result: incomplete
      ? envelope("fail", "failure", 1, issues)
      : envelope("pass", "success", 0, []),
  });
}

/** Renders the human output the retained checker produces. */
export function renderStoryHuman(
  execution: StoryCommandExecution,
): StoryRenderedOutput {
  // A usage error is reported before the banner, exactly as the retained
  // checker reports it.
  if (execution.result.outcome === "usage-error")
    return Object.freeze({
      stdout: "\nResult: ERROR\nStories checked: 0\n",
      stderr:
        "ERROR Invalid arguments\n" +
        "Usage: praxisbound story check [--ready] [--json] [story-directory ...]\n" +
        "       praxisbound story check --help\n",
    });

  const stdout: string[] = [BANNER, "\n"];
  const stderr: string[] = [];

  for (const entry of execution.entries) {
    if (entry.kind === "error") {
      stderr.push(`${entry.diagnostic}\n`);
      continue;
    }

    if (entry.facts.storyId !== undefined)
      stdout.push(`INFO  ${entry.label}: Story ID ${entry.facts.storyId}\n`);

    for (const reported of entry.issues)
      stdout.push(`FAIL  ${entry.label}: ${reported.message}\n`);

    if (entry.structureIssues.length === 0)
      stdout.push(
        `PASS  ${entry.label}: classification security=${
          entry.facts.securitySensitive === true ? "yes" : "no"
        } baseline=${entry.facts.baselineConformance === true ? "yes" : "no"}\n`,
      );
  }

  stdout.push("\n");

  if (execution.outcome === "ERROR") {
    stdout.push("Result: ERROR\n");
    stdout.push(`Stories checked: ${execution.checked}\n`);
    return Object.freeze({
      stdout: stdout.join(""),
      stderr: stderr.join(""),
    });
  }

  if (execution.ready) {
    const structureIncomplete = execution.entries.some(
      (entry) => entry.kind === "story" && entry.structureIssues.length > 0,
    );
    stdout.push(
      `Structure: ${
        structureIncomplete ? "STORY_CONTRACT_INCOMPLETE" : "STORY_CONTRACT_OK"
      }\n`,
    );
    stdout.push(`Result: ${execution.outcome}\n`);
    stdout.push(`Stories checked: ${execution.checked}\n`);
    stdout.push(
      execution.outcome === "STORY_READINESS_INCOMPLETE"
        ? "Fill the reported structure or minimum content, then recheck.\n"
        : "Minimum content only, not human-approved READY. Run make verify and human review.\n",
    );
    return Object.freeze({ stdout: stdout.join(""), stderr: stderr.join("") });
  }

  stdout.push(`Result: ${execution.outcome}\n`);
  stdout.push(`Stories checked: ${execution.checked}\n\n`);
  stdout.push("Next:\n");

  if (execution.outcome === "STORY_CONTRACT_INCOMPLETE") {
    stdout.push(
      "Record the missing classification, conditional contract, fixture\n",
    );
    stdout.push("matrix, or superseded behavior in the Story, then recheck.\n");
  } else {
    stdout.push(
      "Static Story structure only. Run make verify and human review.\n",
    );
  }

  return Object.freeze({ stdout: stdout.join(""), stderr: stderr.join("") });
}
