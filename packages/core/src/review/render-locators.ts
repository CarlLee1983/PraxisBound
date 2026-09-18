/**
 * Locator lookup and safe element-id derivation shared by the projection's
 * page assembly and per-document partitioning.
 *
 * The index carries a `Locator` (`path`, `anchor`, `blockSha256`) for every
 * recognized block but never a byte offset, so the projection recomputes
 * byte ranges itself from the same shared Markdown scanner (`markdown.ts`)
 * and only *looks up* the index's Locator to attach it (contract §18, R-005
 * second half). This keeps index and projection agreeing on identity while
 * letting the projection alone decide layout.
 */

import { sha256Hex } from "./fingerprint.js";
import type { HeadingBlock } from "./markdown.js";
import type {
  AdrIndex,
  Locator,
  ReviewIndex,
  SpecIndex,
  StoryIndex,
} from "./types.js";

/**
 * Every Locator the index carries, keyed by its full identity `(path,
 * anchor, blockSha256)`. A key the index carries more than once maps to
 * `undefined`: two blocks can legitimately share an anchor (contract §5 rule
 * 2 heading paths, or a duplicated `acceptance.md` AC id) and even the same
 * bytes, and such an ambiguous match never gets a locator, so no two
 * elements ever share an HTML `id` and no `data-block-sha256` is ever
 * misattributed. One Map lookup per rendered block, never a scan.
 */
export type LocatorLookup = ReadonlyMap<string, Locator | undefined>;

function blockKey(path: string, anchor: string, blockSha256: string): string {
  return `${path}\u0000${anchor}\u0000${blockSha256}`;
}

function addLocator(
  target: Map<string, Locator | undefined>,
  locator: Locator,
): void {
  const key = blockKey(locator.path, locator.anchor, locator.blockSha256);
  target.set(key, target.has(key) ? undefined : locator);
}

function addSpecLocators(
  target: Map<string, Locator | undefined>,
  spec: SpecIndex,
): void {
  if (spec.goal !== undefined) addLocator(target, spec.goal);
  if (spec.nonGoals !== undefined) addLocator(target, spec.nonGoals);
  for (const section of spec.sections) addLocator(target, section.locator);
  for (const entry of spec.entries) {
    addLocator(target, entry.locator);
    for (const acceptance of entry.acceptance)
      addLocator(target, acceptance.locator);
    const { goal, acceptance, nonGoals, dependencies } = entry.sections;
    for (const locator of [goal, acceptance, nonGoals, dependencies])
      if (locator !== undefined) addLocator(target, locator);
  }
}

function addStoryLocators(
  target: Map<string, Locator | undefined>,
  story: StoryIndex,
): void {
  for (const locator of story.locators.story) addLocator(target, locator);
  for (const locator of story.locators.acceptance) addLocator(target, locator);
}

function addAdrLocators(
  target: Map<string, Locator | undefined>,
  adr: AdrIndex,
): void {
  for (const locator of adr.locators) addLocator(target, locator);
}

/** Every Locator the index carries, keyed by `(path, anchor, blockSha256)`. */
export function buildLocatorLookup(index: ReviewIndex): LocatorLookup {
  const target = new Map<string, Locator | undefined>();
  for (const spec of index.specs) addSpecLocators(target, spec);
  for (const story of index.stories) addStoryLocators(target, story);
  for (const adr of index.adrs) addAdrLocators(target, adr);
  return target;
}

/**
 * The index's Locator for exactly this block, when the index carries it
 * exactly once; `undefined` when it is absent or ambiguous.
 */
function uniqueLocator(
  lookup: LocatorLookup,
  path: string,
  anchor: string,
  blockSha256: string,
): Locator | undefined {
  return lookup.get(blockKey(path, anchor, blockSha256));
}

const encoder = new TextEncoder();

/**
 * A deterministic, safe HTML `id` for one `(path, anchor)` pair. Derived
 * rather than carried on the Locator itself, so an arbitrary source anchor
 * string never becomes an unescaped `id` (R-005 second half: "HTML `id`s are
 * generated safe tokens, not raw anchors").
 */
export function elementId(path: string, anchor: string): string {
  return `loc-${sha256Hex(encoder.encode(`${path} ${anchor}`)).slice(0, 16)}`;
}

/**
 * The one `id` derivation for a located block: every element that carries a
 * locator gets this id, and every in-page link to a locator targets it, so a
 * link can never name an id that no element has.
 */
function locatorElementId(locator: Locator): string {
  return elementId(locator.path, `${locator.anchor} ${locator.blockSha256}`);
}

/**
 * The attribute set for one rendered block — a heading block or an AC line —
 * whose bytes are `bytes[start, end)`. Attaches a locator only when the
 * index carries exactly one Locator with this `(path, anchor, blockSha256)`;
 * an ambiguous or absent match renders the block with no locator rather
 * than a wrong one.
 */
export function blockLocatorAttributes(
  lookup: LocatorLookup,
  path: string,
  anchor: string,
  bytes: Uint8Array,
  start: number,
  end: number,
): Record<string, string> | undefined {
  const blockSha256 = sha256Hex(bytes.subarray(start, end));
  const locator = uniqueLocator(lookup, path, anchor, blockSha256);
  if (locator === undefined) return undefined;
  return {
    id: locatorElementId(locator),
    "data-path": locator.path,
    "data-anchor": locator.anchor,
    "data-block-sha256": locator.blockSha256,
  };
}

/** `blockLocatorAttributes` for one heading's own block (contract §5). */
export function headingBlockLocatorAttributes(
  lookup: LocatorLookup,
  path: string,
  anchor: string,
  bytes: Uint8Array,
  heading: HeadingBlock,
): Record<string, string> | undefined {
  return blockLocatorAttributes(
    lookup,
    path,
    anchor,
    bytes,
    heading.startOffset,
    heading.endOffset,
  );
}

/**
 * An in-page `href` to the element `blockLocatorAttributes` renders for
 * `locator`, when that element gets a locator at all (the same uniqueness
 * rule), so the link always resolves to exactly one `id`.
 */
export function locatorHref(
  lookup: LocatorLookup,
  locator: Locator,
): string | undefined {
  const unique = uniqueLocator(
    lookup,
    locator.path,
    locator.anchor,
    locator.blockSha256,
  );
  return unique === undefined ? undefined : `#${locatorElementId(unique)}`;
}
