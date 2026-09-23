import { git } from "./release-git.js";

/**
 * ADR-015: `review preflight` observes git through the hardened runner in
 * `release-git.ts` instead of a second, unhardened subprocess path. This
 * module owns parsing per-path porcelain status for the batch review
 * uncommitted-change check; it knows nothing about batches or preflight
 * outcomes.
 */
export type ReviewGitObservation =
  | { readonly kind: "not-a-repository" }
  | {
      readonly kind: "observed";
      readonly head: string | undefined;
      readonly changes: readonly ReviewGitChange[];
    }
  | { readonly kind: "failed" };

export interface ReviewGitChange {
  readonly path: string;
  readonly status: string;
}

export interface ReviewGitAdapter {
  observe(root: string): Promise<ReviewGitObservation>;
}

const NOT_A_REPOSITORY_EXIT = 128;

interface PorcelainEntry {
  readonly status: string;
  readonly path: string;
  readonly origPath?: string;
}

function parsePorcelainZ(raw: string): readonly PorcelainEntry[] {
  const tokens = raw.split("\0");
  const entries: PorcelainEntry[] = [];
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    index += 1;
    if (token === undefined || token === "") continue;
    const status = token.slice(0, 2);
    const path = token.slice(3);
    if (status[0] === "R" || status[0] === "C") {
      const origPath = tokens[index];
      index += 1;
      if (origPath === undefined) entries.push({ status, path });
      else entries.push({ status, path, origPath });
    } else {
      entries.push({ status, path });
    }
  }
  return entries;
}

/**
 * Paths reported by `git status` are always repo-root-relative. `root` may
 * be a subdirectory of the repository, so each path is rebased onto `root`
 * using the `git rev-parse --show-prefix` prefix. A path outside `root` is
 * dropped: the caller only matches batch paths that are inside `root`, so a
 * path it can never match would only be noise.
 */
function relativeToRoot(path: string, prefix: string): string | undefined {
  if (prefix === "") return path;
  if (!path.startsWith(prefix)) return undefined;
  return path.slice(prefix.length);
}

export const nodeReviewGitAdapter: ReviewGitAdapter = Object.freeze({
  async observe(root: string): Promise<ReviewGitObservation> {
    const insideWorktree = await git(root, [
      "rev-parse",
      "--is-inside-work-tree",
    ]);
    if (!insideWorktree.ok) {
      if (insideWorktree.failure.exit === NOT_A_REPOSITORY_EXIT)
        return { kind: "not-a-repository" };
      return { kind: "failed" };
    }
    if (insideWorktree.stdout.trim() !== "true")
      return { kind: "not-a-repository" };

    const prefixResult = await git(root, ["rev-parse", "--show-prefix"]);
    if (!prefixResult.ok) return { kind: "failed" };
    const prefix = prefixResult.stdout.trim();

    // A repository already verified to exist can still lack a first commit;
    // that is the only expected failure of this call, so it reports an
    // unborn branch (head undefined) rather than "failed".
    const headResult = await git(root, [
      "rev-parse",
      "--verify",
      "HEAD^{commit}",
    ]);
    const head = headResult.ok ? headResult.stdout.trim() : undefined;

    const statusResult = await git(root, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--ignore-submodules=none",
    ]);
    if (!statusResult.ok) return { kind: "failed" };

    const changes: ReviewGitChange[] = [];
    for (const entry of parsePorcelainZ(statusResult.stdout)) {
      const relativePath = relativeToRoot(entry.path, prefix);
      if (relativePath !== undefined)
        changes.push(
          Object.freeze({ path: relativePath, status: entry.status }),
        );
      if (entry.origPath !== undefined) {
        const relativeOrigPath = relativeToRoot(entry.origPath, prefix);
        if (relativeOrigPath !== undefined)
          changes.push(
            Object.freeze({ path: relativeOrigPath, status: entry.status }),
          );
      }
    }

    return Object.freeze({
      kind: "observed",
      head,
      changes: Object.freeze(changes),
    });
  },
});
