/**
 * `review confirm`'s interactive portion (contract §8 steps 4–5): display
 * scope, fingerprint, and a staleness reminder; collect a typed `defer` +
 * reason for every unresolved non-blocking request (H2: rejecting an
 * oversized or hidden/reordering-character reason, re-asking rather than
 * silently accepting one); and the final fingerprint-prefix confirmation.
 * Split out of `review-confirm.ts` so that file stays focused on
 * orchestration.
 */

import {
  containsHiddenOrReorderingCharacters,
  escapeHiddenCharacters,
  MAX_DEFERRAL_REASON_BYTES,
  type ConfirmationApplicability,
  type DeferredRevision,
  type RevisionRecord,
  type SourceDigest,
} from "@praxisbound/core";

import type { ReviewConfirmTerminal } from "./review-confirm-terminal.js";

const MAX_REASON_RETRIES = 20;

export type ConfirmInteractionResult =
  | { readonly aborted: true }
  | { readonly aborted: false; readonly deferred: readonly DeferredRevision[] };

/** Escapes every field of one unresolved non-blocking request for terminal display (contract §8 step 4, R8). */
function displayRequest(
  terminal: ReviewConfirmTerminal,
  revision: Pick<
    RevisionRecord,
    "id" | "targets" | "quote" | "proposal" | "rationale"
  >,
): void {
  const escape = escapeHiddenCharacters;
  terminal.write(`\nUnresolved non-blocking request ${escape(revision.id)}\n`);
  const targets = revision.targets
    .map((target) => `${escape(target.path)} ${escape(target.anchor)}`)
    .join("; ");
  terminal.write(`  target(s): ${targets}\n`);
  terminal.write(`  quote: ${escape(revision.quote)}\n`);
  terminal.write(`  proposal: ${escape(revision.proposal)}\n`);
  terminal.write(`  rationale: ${escape(revision.rationale)}\n`);
}

/** Contract §8 修訂，R-006 "list the changed/added/removed sources" reminder, shown before the fingerprint prompt so the human can compare against the HTML page header. */
function displayStalenessReminder(
  terminal: ReviewConfirmTerminal,
  staleness: ConfirmationApplicability | undefined,
): void {
  const escape = escapeHiddenCharacters;
  terminal.write(
    "\nCompare the fingerprint above with the Review Projection page header before typing.\n",
  );
  if (staleness === undefined || staleness.applies) return;
  if (staleness.latest === undefined) return;
  terminal.write(
    `A previous confirmation exists (${escape(staleness.latest.record.confirmedAt)}) but does not apply to the current sources:\n`,
  );
  for (const change of staleness.sourceChanges) {
    const label = change.missing === true ? "missing" : change.kind;
    terminal.write(`  ${label}: ${escape(change.path)}\n`);
  }
  if (staleness.manifestChanged) terminal.write("  manifest changed\n");
}

/** H2: rejects a deferral reason over §13's 64 KiB string bound, or one containing a hidden/reordering character (control, bidi, zero-width, or the byte-order mark) — never silently accepted, only escaped on display. */
function reasonProblem(reason: string): string | undefined {
  if (reason.trim().length === 0) return "the reason must not be empty.";
  if (new TextEncoder().encode(reason).length > MAX_DEFERRAL_REASON_BYTES)
    return "the reason exceeds the 64 KiB limit.";
  if (containsHiddenOrReorderingCharacters(reason))
    return "the reason must not contain a hidden or reordering character.";
  return undefined;
}

/**
 * Runs the interactive portion: displays scope/fingerprint/staleness
 * (contract §8 step 4), collects a typed `defer` + validated reason for
 * every unresolved non-blocking request, then the fingerprint-prefix
 * confirmation (step 5). Returns `{ aborted: true }` the moment any answer
 * is missing, EOF, or invalid past the retry bound — never partway through
 * with some deferrals already accepted and others not.
 */
export async function runConfirmInteraction(
  terminal: ReviewConfirmTerminal,
  index: {
    readonly batchId: string;
    readonly fingerprint: string;
    readonly sources: readonly SourceDigest[];
  },
  unresolvedNonBlockingIds: readonly string[],
  effectiveById: ReadonlyMap<string, RevisionRecord>,
  staleness: ConfirmationApplicability | undefined,
): Promise<ConfirmInteractionResult> {
  const escape = escapeHiddenCharacters;
  terminal.write(
    `\n${escape(index.batchId)} — Requirement Fingerprint ${escape(index.fingerprint)}\n`,
  );
  terminal.write(`Sources (${index.sources.length}):\n`);
  for (const source of index.sources)
    terminal.write(`  ${escape(source.path)}\n`);

  const deferred: DeferredRevision[] = [];
  for (const id of unresolvedNonBlockingIds) {
    const revision = effectiveById.get(id);
    if (revision !== undefined) displayRequest(terminal, revision);
    const answer = await terminal.question(
      `Type "defer" to defer ${escape(id)}, or anything else to abort: `,
    );
    if (answer !== "defer") return { aborted: true };

    let reason: string | undefined;
    for (let attempt = 0; attempt < MAX_REASON_RETRIES; attempt += 1) {
      const reasonAnswer = await terminal.question(
        `Reason for deferring ${escape(id)}: `,
      );
      if (reasonAnswer === undefined) return { aborted: true };
      const problem = reasonProblem(reasonAnswer);
      if (problem === undefined) {
        reason = reasonAnswer;
        break;
      }
      terminal.write(`Rejected: ${problem} Please try again.\n`);
    }
    if (reason === undefined) return { aborted: true };
    deferred.push({ revisionId: id, reason });
  }

  displayStalenessReminder(terminal, staleness);

  // §8 step 5: the human types the fingerprint's first 8 characters.
  const prefixAnswer = await terminal.question(
    "Type the first 8 characters of the fingerprint shown above to confirm: ",
  );
  if (
    prefixAnswer === undefined ||
    prefixAnswer !== index.fingerprint.slice(0, 8)
  )
    return { aborted: true };

  return { aborted: false, deferred };
}
