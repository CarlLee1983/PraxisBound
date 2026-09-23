/**
 * Dependency cycle detection over a Batch Manifest's declared `dependencies`
 * (contract §9 `REVIEW_DEPENDENCY_CYCLE`). A cycle is reported as one
 * strongly connected component, not as every elementary cycle inside it, so
 * the result stays linear in the number of edges. The traversal is
 * iterative, so a long dependency chain cannot exhaust the call stack. This
 * module never touches a filesystem, process, or clock.
 */

import { compareUtf8 } from "./path.js";
import type { ReviewBatchPlanDependency } from "./types.js";

/**
 * Returns each group of Stories that reach one another through declared
 * dependencies, including a Story that depends on itself. Members of a group
 * are sorted by UTF-8 bytes, and groups by their first member.
 */
export function findDependencyCycles(
  dependencies: readonly ReviewBatchPlanDependency[],
): readonly (readonly string[])[] {
  const edges = new Map<string, string[]>();
  for (const { story, dependsOn } of dependencies) {
    edges.set(story, [...(edges.get(story) ?? []), ...dependsOn]);
  }

  return stronglyConnectedComponents(edges)
    .filter(
      ([first, ...rest]) =>
        rest.length > 0 ||
        (first !== undefined && (edges.get(first) ?? []).includes(first)),
    )
    .map((members) => [...members].sort(compareUtf8))
    .sort((left, right) => compareUtf8(left[0] ?? "", right[0] ?? ""));
}

interface Visit {
  readonly index: number;
  lowLink: number;
}

interface Frame {
  readonly node: string;
  readonly visit: Visit;
  readonly targets: Iterator<string>;
}

/** Tarjan's algorithm with an explicit frame stack instead of recursion. */
function stronglyConnectedComponents(
  edges: ReadonlyMap<string, readonly string[]>,
): string[][] {
  const visits = new Map<string, Visit>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];

  const enter = (node: string): Frame => {
    const visit = { index: visits.size, lowLink: visits.size };
    visits.set(node, visit);
    stack.push(node);
    onStack.add(node);
    return { node, visit, targets: (edges.get(node) ?? [])[Symbol.iterator]() };
  };

  for (const root of edges.keys()) {
    if (visits.has(root)) continue;
    const frames: Frame[] = [enter(root)];

    for (
      let frame = frames.at(-1);
      frame !== undefined;
      frame = frames.at(-1)
    ) {
      const next = frame.targets.next();
      if (!next.done) {
        const seen = visits.get(next.value);
        if (seen === undefined) frames.push(enter(next.value));
        else if (onStack.has(next.value))
          frame.visit.lowLink = Math.min(frame.visit.lowLink, seen.index);
        continue;
      }

      frames.pop();
      const parent = frames.at(-1);
      if (parent !== undefined)
        parent.visit.lowLink = Math.min(
          parent.visit.lowLink,
          frame.visit.lowLink,
        );

      if (frame.visit.lowLink === frame.visit.index) {
        const members: string[] = [];
        for (
          let member = stack.pop();
          member !== undefined;
          member = stack.pop()
        ) {
          onStack.delete(member);
          members.push(member);
          if (member === frame.node) break;
        }
        components.push(members);
      }
    }
  }

  return components;
}
