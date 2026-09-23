import { git } from "./release-git.js";

/**
 * ADR-015: `review preflight` observes git through the hardened runner in
 * `release-git.ts` instead of a second, unhardened subprocess path. This
 * module owns parsing per-path porcelain status (and, since review round 2,
 * `git ls-files -v`'s assume-unchanged/skip-worktree tags) for the batch
 * review uncommitted-change check; it knows nothing about batches or
 * preflight outcomes.
 *
 * `observe` takes the exact batch paths (declared sources plus the
 * manifest, root-relative) to check, rather than scanning the whole
 * worktree, for two reasons (review round 2, M1/M2): a `.gitignore`d batch
 * source (never committed) would otherwise never show up as a change at
 * all (`git status` excludes ignored paths by default), and an unrelated
 * untracked tree elsewhere in a large repository would otherwise make the
 * status output — and so every preflight run — arbitrarily large. Every
 * pathspec is `:(literal)`-prefixed so no path's own glob-magic characters
 * are ever interpreted.
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
  observe(
    root: string,
    paths: readonly string[],
  ): Promise<ReviewGitObservation>;
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
 * Paths reported by `git status` are always repo-root-relative, even when
 * `root` is a subdirectory of the repository and the pathspecs given were
 * `root`-relative (confirmed empirically against the installed `git`);
 * `git ls-files -v` prints cwd-relative paths instead, so it needs no such
 * remap. Each `status` path is rebased onto `root` using the
 * `git rev-parse --show-prefix` prefix; a path outside `root` is dropped —
 * the caller only matches batch paths that are inside `root`, so a path it
 * can never match would only be noise.
 */
function relativeToRoot(path: string, prefix: string): string | undefined {
  if (prefix === "") return path;
  if (!path.startsWith(prefix)) return undefined;
  return path.slice(prefix.length);
}

/** `git ls-files -v`'s per-entry tag: uppercase is the ordinary state; a lowercase letter is "assume unchanged", and `S` is skip-worktree — both hide real content changes from plain `git status` (review round 2, M1). */
function isHiddenFromStatus(tag: string): boolean {
  return (
    tag === "S" || (tag === tag.toLowerCase() && tag !== tag.toUpperCase())
  );
}

function parseLsFilesZ(
  raw: string,
): readonly { readonly tag: string; readonly path: string }[] {
  const entries: { readonly tag: string; readonly path: string }[] = [];
  for (const token of raw.split("\0")) {
    if (token === "") continue;
    const tag = token.slice(0, 1);
    const path = token.slice(2);
    entries.push({ tag, path });
  }
  return entries;
}

export const nodeReviewGitAdapter: ReviewGitAdapter = Object.freeze({
  async observe(
    root: string,
    paths: readonly string[],
  ): Promise<ReviewGitObservation> {
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

    // A repository already verified to exist can still lack a first commit;
    // that is the only expected failure of this call, so it reports an
    // unborn branch (head undefined) rather than "failed".
    const headResult = await git(root, [
      "rev-parse",
      "--verify",
      "HEAD^{commit}",
    ]);
    const head = headResult.ok ? headResult.stdout.trim() : undefined;

    if (paths.length === 0)
      return Object.freeze({
        kind: "observed",
        head,
        changes: Object.freeze([]),
      });

    const pathspecs = paths.map((path) => `:(literal)${path}`);

    const prefixResult = await git(root, ["rev-parse", "--show-prefix"]);
    if (!prefixResult.ok) return { kind: "failed" };
    const prefix = prefixResult.stdout.trim();

    // `--ignored=matching` makes a `.gitignore`d-but-never-committed batch
    // path show up as `!!` instead of being silently excluded (M1(a));
    // the trailing pathspecs bound both the git-internal scan and this
    // process's output to exactly the batch paths (M1(b)), never the whole
    // working tree.
    const statusResult = await git(root, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--ignored=matching",
      "--ignore-submodules=none",
      "--",
      ...pathspecs,
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

    // `git status` never reports a path marked assume-unchanged or
    // skip-worktree, even though its working-tree content differs from
    // what is committed (M1(a)): `git ls-files -v`'s tag is the only way
    // to see it. Reported with a synthetic two-character status (the tag
    // doubled) so a caller matching on `status[0] === "R"`/`"C"` for a
    // rename never misreads one of these as a rename.
    const lsFilesResult = await git(root, [
      "ls-files",
      "-v",
      "-z",
      "--",
      ...pathspecs,
    ]);
    if (!lsFilesResult.ok) return { kind: "failed" };
    for (const entry of parseLsFilesZ(lsFilesResult.stdout)) {
      if (!isHiddenFromStatus(entry.tag)) continue;
      changes.push(
        Object.freeze({ path: entry.path, status: `${entry.tag}${entry.tag}` }),
      );
    }

    return Object.freeze({
      kind: "observed",
      head,
      changes: Object.freeze(changes),
    });
  },
});
