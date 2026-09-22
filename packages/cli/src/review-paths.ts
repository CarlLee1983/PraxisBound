/**
 * Repository-relative path safety checks shared by `review.ts` and
 * `review-records.ts`. Split into its own module so neither file has to
 * import the other just for this: `review-records.ts` needs it for the
 * `records/` directory (contract §2), and `review.ts` needs it for every
 * declared source, the manifest, and `--output`.
 */

import { lstat } from "node:fs/promises";
import { resolve } from "node:path";

/** Finds the first declared path with a symlinked segment, checking every segment, not only the last. */
export async function findUnsafeSourcePath(
  root: string,
  paths: readonly string[],
): Promise<string | undefined> {
  for (const path of paths) {
    const segments = path.split("/");
    let prefix = "";
    for (const segment of segments) {
      prefix = prefix === "" ? segment : `${prefix}/${segment}`;
      let stats;
      try {
        stats = await lstat(resolve(root, prefix));
      } catch {
        break;
      }
      if (stats.isSymbolicLink()) return path;
    }
  }
  return undefined;
}
