import { execFile as execFileCallback } from "node:child_process";
import { stat, realpath } from "node:fs/promises";
import { promisify } from "node:util";

import type { ReleaseReadinessState, ReleaseTagState } from "@praxisbound/core";

import type {
  ReleaseInspection,
  ReleaseObservationAdapter,
} from "./release.js";

const execFile = promisify(execFileCallback);
const MAX_OUTPUT_BYTES = 1024 * 1024;

interface GitFailure {
  readonly exit: number | undefined;
}

const releaseTagRefPattern =
  /^refs\/tags\/v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/;

function cleanEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...process.env };
  for (const name of Object.keys(environment)) {
    if (
      name === "GIT_DIR" ||
      name === "GIT_WORK_TREE" ||
      name === "GIT_INDEX_FILE" ||
      name === "GIT_COMMON_DIR" ||
      name === "GIT_OBJECT_DIRECTORY" ||
      name === "GIT_ALTERNATE_OBJECT_DIRECTORIES" ||
      name === "GIT_NAMESPACE" ||
      name === "GIT_CONFIG_PARAMETERS" ||
      name === "GIT_CONFIG_COUNT" ||
      /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(name)
    ) {
      delete environment[name];
    }
  }
  return {
    ...environment,
    GIT_OPTIONAL_LOCKS: "0",
    GIT_NO_LAZY_FETCH: "1",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    LC_ALL: "C",
  };
}

export async function git(
  cwd: string,
  args: readonly string[],
): Promise<
  | { readonly ok: true; readonly stdout: string }
  | { readonly ok: false; readonly failure: GitFailure }
> {
  try {
    const result = await execFile(
      "git",
      ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", ...args],
      {
        cwd,
        env: cleanEnvironment(),
        encoding: "utf8",
        maxBuffer: MAX_OUTPUT_BYTES,
        windowsHide: true,
      },
    );
    return { ok: true, stdout: result.stdout };
  } catch (error: unknown) {
    return {
      ok: false,
      failure: Object.freeze({ exit: (error as { code?: number }).code }),
    };
  }
}

async function mustGit(
  cwd: string,
  args: readonly string[],
): Promise<string | undefined> {
  const result = await git(cwd, args);
  return result.ok ? result.stdout : undefined;
}

async function localTag(
  cwd: string,
  head: string,
  expected: string,
): Promise<
  { readonly tag: ReleaseTagState; readonly refs: string } | undefined
> {
  const refs = await mustGit(cwd, [
    "for-each-ref",
    "--format=%(refname)%00%(objectname)%00%(*objectname)",
    "refs/tags",
  ]);
  if (refs === undefined) return undefined;
  const expectedRef = `refs/tags/${expected}`;
  const expectedExists = await git(cwd, [
    "show-ref",
    "--verify",
    "--quiet",
    expectedRef,
  ]);
  let expectedState: ReleaseTagState = "absent";
  if (expectedExists.ok) {
    const commit = await mustGit(cwd, [
      "rev-parse",
      "--verify",
      `${expectedRef}^{commit}`,
    ]);
    if (commit === undefined) return { tag: "non-commit", refs };
    expectedState = commit.trim() === head ? "same-head" : "wrong-head";
  } else if (expectedExists.failure.exit !== 1) {
    return undefined;
  }
  if (expectedState === "wrong-head") return { tag: expectedState, refs };

  const names = refs
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("\0")[0] ?? "");
  for (const name of names) {
    if (name === expectedRef || !releaseTagRefPattern.test(name)) continue;
    const commit = await mustGit(cwd, [
      "rev-parse",
      "--verify",
      `${name}^{commit}`,
    ]);
    if (commit?.trim() === head) return { tag: "conflict", refs };
  }
  return { tag: expectedState, refs };
}

async function snapshot(
  cwd: string,
): Promise<ReleaseReadinessState | ReleaseInspection> {
  const head = await mustGit(cwd, ["rev-parse", "--verify", "HEAD^{commit}"]);
  if (head === undefined)
    return {
      kind: "incomplete",
      code: "RELEASE_HEAD_UNAVAILABLE",
      message: "HEAD is not a commit",
    };

  const index = await mustGit(cwd, ["ls-files", "-v"]);
  if (index === undefined)
    return {
      kind: "incomplete",
      code: "RELEASE_INDEX_INSPECTION_FAILED",
      message: "index could not be inspected",
    };
  const indexFlags = /^(?:[a-z]|S)/m.test(index) ? "hidden" : "clear";

  const headObject = await mustGit(cwd, [
    "rev-parse",
    "--verify",
    "HEAD:VERSION",
  ]);
  let headVersion: ReleaseReadinessState["headVersion"];
  if (headObject === undefined) {
    headVersion = { kind: "missing" };
  } else {
    const object = headObject.trim();
    const type = await mustGit(cwd, ["cat-file", "-t", object]);
    if (type === undefined || type.trim() !== "blob") {
      headVersion = { kind: "other", object };
    } else {
      const content = await mustGit(cwd, ["cat-file", "blob", object]);
      if (content === undefined)
        return {
          kind: "incomplete",
          code: "RELEASE_VERSION_READ_FAILED",
          message: "committed VERSION could not be read",
        };
      headVersion = { kind: "blob", object, content };
    }
  }

  const working = await mustGit(cwd, [
    "hash-object",
    "--no-filters",
    "VERSION",
  ]);
  const workingVersion =
    working === undefined
      ? { kind: "missing" as const }
      : { kind: "file" as const, object: working.trim() };
  const status = await mustGit(cwd, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "--ignore-submodules=none",
  ]);
  if (status === undefined)
    return {
      kind: "incomplete",
      code: "RELEASE_WORKTREE_INSPECTION_FAILED",
      message: "worktree could not be inspected",
    };

  const version =
    headVersion.kind === "blob" && headVersion.content !== undefined
      ? /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\n$/
          .exec(headVersion.content)?.[0]
          ?.slice(0, -1)
      : undefined;
  const tags = await localTag(
    cwd,
    head.trim(),
    version === undefined ? "v__invalid__" : `v${version}`,
  );
  if (tags === undefined)
    return {
      kind: "incomplete",
      code: "RELEASE_TAGS_INSPECTION_FAILED",
      message: "local tags could not be inspected",
    };

  return Object.freeze({
    head: head.trim(),
    indexFlags,
    headVersion: Object.freeze(headVersion),
    workingVersion: Object.freeze(workingVersion),
    worktree: status === "" ? "clean" : "dirty",
    tag: tags.tag,
    tagRefs: tags.refs,
  });
}

function isInspection(
  value: ReleaseReadinessState | ReleaseInspection,
): value is ReleaseInspection {
  return (
    "kind" in value &&
    (value.kind === "incomplete" ||
      value.kind === "error" ||
      value.kind === "observed")
  );
}

export const nodeReleaseGitAdapter: ReleaseObservationAdapter = Object.freeze({
  async inspect({
    candidate,
  }: {
    readonly candidate: string;
  }): Promise<ReleaseInspection> {
    let root: string;
    try {
      if (!(await stat(candidate)).isDirectory())
        return {
          kind: "error",
          code: "RELEASE_TARGET_INVALID",
          message: "repository target is not a directory",
          exit: 2,
        };
      root = await realpath(candidate);
    } catch {
      return {
        kind: "error",
        code: "RELEASE_TARGET_INVALID",
        message: "repository target cannot be resolved",
        exit: 2,
      };
    }

    const insideWorktree = await mustGit(root, [
      "rev-parse",
      "--is-inside-work-tree",
    ]);
    if (insideWorktree === undefined)
      return {
        kind: "incomplete",
        code: "RELEASE_NOT_GIT_WORKTREE",
        message: "target is not a Git worktree",
      };
    if (insideWorktree.trim() !== "true")
      return {
        kind: "error",
        code: "RELEASE_TARGET_NOT_ROOT",
        message: "repository target must be a worktree directory",
        exit: 2,
      };
    const gitRoot = await mustGit(root, ["rev-parse", "--show-toplevel"]);
    if (gitRoot === undefined)
      return {
        kind: "error",
        code: "RELEASE_ROOT_UNAVAILABLE",
        message: "Git worktree root cannot be resolved",
        exit: 2,
      };
    let physicalGitRoot: string;
    try {
      physicalGitRoot = await realpath(gitRoot.trim());
    } catch {
      return {
        kind: "error",
        code: "RELEASE_ROOT_UNAVAILABLE",
        message: "Git worktree root cannot be resolved",
        exit: 2,
      };
    }
    if (physicalGitRoot !== root)
      return {
        kind: "error",
        code: "RELEASE_TARGET_NOT_ROOT",
        message: "repository target must be the worktree root",
        exit: 2,
      };

    const initial = await snapshot(root);
    if (isInspection(initial)) return initial;
    const final = await snapshot(root);
    if (isInspection(final)) return final;
    return Object.freeze({ kind: "observed", root, initial, final });
  },
});
