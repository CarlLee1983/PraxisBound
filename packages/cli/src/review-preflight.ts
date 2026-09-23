/**
 * `praxisbound review preflight <manifest>` (contract §9, Story TST-027,
 * extended by TST-028): gathers every input the contract §9 table needs —
 * the batch's own index/plan diagnostics, the dependency graph, confirmation
 * applicability, unresolved requests, existing revision/response/story
 * findings, the fingerprint expectation, the git-observed HEAD/uncommitted
 * state (`ADR-015`, only when `--expect-revision` is given), and the
 * Semantic Report's own findings (`review-semantic-report.js`, R10a's path
 * rule and Core's `evaluateSemanticReport`) — and hands them to Core's
 * `evaluatePreflight`, which owns every classification, severity,
 * precedence, and outcome decision (R6). This module never re-implements
 * one of those decisions; it only collects input, projects the result, and
 * writes the Preflight Report (contract §2, §9 R7 deduplication).
 *
 * Out of scope: `review packet`.
 */

import { resolve } from "node:path";

import {
  buildPreflightReportRecord,
  buildTargetLookup,
  canonicalUtcTime,
  computeEffectiveRevisions,
  computeUnresolvedRequests,
  evaluatePreflight,
  MAX_DIAGNOSTICS,
  preflightReportsEqualExceptCheckedAt,
  sha256Hex,
  validateRevisionRecordSet,
  validateStoredPreflightReportRecord,
  type PreflightConfirmationState,
  type PreflightFinding,
  type PreflightReportExpect,
  type PreflightReportRecord,
  type PreflightReportRecordRef,
  type PreflightReportSemanticReportRef,
  type ReviewDiagnostic,
} from "@praxisbound/core";

import { loadReviewConfirmationApplicability } from "./review-confirmation-records.js";
import { loadSemanticReport } from "./review-semantic-report.js";
import {
  computeResponseCoverage,
  recordSetInvalidIssues,
} from "./review-input.js";
import {
  createNewRecord,
  loadRecordsListingState,
  parseRecordJson,
  readRecordBytes,
  readResponseRecords,
  readRevisionRecords,
  recordsDirectory,
  type RecordFilesystem,
} from "./review-records.js";
import {
  nodeReviewGitAdapter,
  type ReviewGitAdapter,
  type ReviewGitObservation,
} from "./review-git.js";
import { checkStoryReadiness, createNodeStoryReader } from "./story.js";
import {
  envelope,
  escapeHumanControlCharacters,
  issue,
  runReviewIndexUnsafe,
  sanitizeInternalError,
  toDataValue,
  type ReviewIndexExecution,
  type ReviewOutputMode,
  type ReviewRenderedOutput,
} from "./review.js";

export const reviewPreflightHelp = `PraxisBound Batch Review Preflight

Usage:
  praxisbound review preflight <manifest> [--semantic-report <file>]
    [--expect-fingerprint <sha256> --expect-revision <commit>] [--json]
  praxisbound review preflight --help

A read-only evaluation of every contract §9 check: missing sources, Story
readiness, dependency cycles, unresolved requests, existing record validity,
and the Semantic Report named by --semantic-report (well formed, bound to
the current fingerprint, covering every batch Story). It never runs make
verify, never requires an unimplemented test to pass, and never writes a
source. REVIEW_READY only means no blocker was
found — it grants no execution authority and claims no absence of defects.
`;

const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;
const REVISION_PATTERN = /^[a-f0-9]{40}$/;

interface ParsedPreflightArguments {
  readonly mode: ReviewOutputMode;
  readonly manifest: string | undefined;
  readonly semanticReport: string | undefined;
  readonly expectFingerprint: string | undefined;
  readonly expectRevision: string | undefined;
  readonly valid: boolean;
}

function parsePreflightArguments(
  args: readonly string[],
): ParsedPreflightArguments {
  let mode: ReviewOutputMode = "human";
  let manifest: string | undefined;
  let semanticReport: string | undefined;
  let expectFingerprint: string | undefined;
  let expectRevision: string | undefined;
  let valid = true;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === undefined) {
      valid = false;
      continue;
    }
    if (token === "--json" && mode === "human") {
      mode = "json";
      continue;
    }
    if (token === "--semantic-report" && semanticReport === undefined) {
      const value = args[index + 1];
      index += 1;
      if (value === undefined || value.startsWith("-")) {
        valid = false;
        continue;
      }
      semanticReport = value;
      continue;
    }
    if (token === "--expect-fingerprint" && expectFingerprint === undefined) {
      const value = args[index + 1];
      index += 1;
      if (value === undefined || value.startsWith("-")) {
        valid = false;
        continue;
      }
      expectFingerprint = value;
      continue;
    }
    if (token === "--expect-revision" && expectRevision === undefined) {
      const value = args[index + 1];
      index += 1;
      if (value === undefined || value.startsWith("-")) {
        valid = false;
        continue;
      }
      expectRevision = value;
      continue;
    }
    if (manifest === undefined && !token.startsWith("-")) {
      manifest = token;
      continue;
    }
    valid = false;
  }

  // Both `--expect-*` flags, or neither: contract §9's usage row.
  if ((expectFingerprint === undefined) !== (expectRevision === undefined))
    valid = false;
  if (
    expectFingerprint !== undefined &&
    !FINGERPRINT_PATTERN.test(expectFingerprint)
  )
    valid = false;
  if (expectRevision !== undefined && !REVISION_PATTERN.test(expectRevision))
    valid = false;

  return {
    mode,
    manifest,
    semanticReport,
    expectFingerprint,
    expectRevision,
    valid: valid && manifest !== undefined,
  };
}

/**
 * Review round 2 M4: the stale differences are `confirmationLoad`'s own
 * `advisoryIssues` (`review-confirmation-records.ts`), never re-derived
 * here — a second computation could drift from the first (and had already
 * dropped `REVIEW_MANIFEST_CHANGED`'s `path: manifestPath`). `severity` is
 * a filler value: Core's `finalizeDiagnostic` always re-derives it from
 * `code` and ignores what is supplied here (R6).
 */
function buildConfirmationState(
  confirmationLoad: Awaited<
    ReturnType<typeof loadReviewConfirmationApplicability>
  >,
): PreflightConfirmationState {
  const { applicability, advisoryIssues } = confirmationLoad;
  if (applicability === undefined) return { kind: "missing" };
  if (applicability.applies) {
    return {
      kind: "applies",
      deferredRevisionIds: applicability.confirmation.record.deferred.map(
        (entry) => entry.revisionId,
      ),
    };
  }
  if (applicability.latest === undefined) return { kind: "missing" };
  const differences: ReviewDiagnostic[] = advisoryIssues.map((entry) => ({
    code: entry.code,
    severity: "advisory",
    message: entry.message,
    ...(entry.path === undefined ? {} : { path: entry.path }),
  }));
  return { kind: "stale", differences };
}

/**
 * Contract §9's git rows (`ADR-015`), applied to one `ReviewGitObservation`:
 * a revision mismatch (including no HEAD commit yet) and one
 * `REVIEW_SOURCES_UNCOMMITTED` finding per distinct batch source or
 * manifest path the observation reports as modified or untracked. A
 * rename's two paths (`review-git.ts`) are both checked, so a match on
 * either side is caught.
 */
function gitObservationFindings(
  observation: Extract<ReviewGitObservation, { readonly kind: "observed" }>,
  expectRevision: string,
  manifestPath: string,
  batchSourcePaths: readonly string[],
): PreflightFinding[] {
  const findings: PreflightFinding[] = [];
  if (observation.head !== expectRevision) {
    findings.push({
      code: "REVIEW_PACKET_REVISION_MISMATCH",
      message:
        observation.head === undefined
          ? `expected revision ${expectRevision} but HEAD has no commit yet`
          : `expected revision ${expectRevision} does not match HEAD ${observation.head}`,
    });
  }
  const batchPaths = new Set([manifestPath, ...batchSourcePaths]);
  const matched = new Set<string>();
  for (const change of observation.changes) {
    if (batchPaths.has(change.path)) matched.add(change.path);
  }
  for (const path of [...matched].sort())
    findings.push({
      code: "REVIEW_SOURCES_UNCOMMITTED",
      message:
        "batch source or manifest has an uncommitted or untracked change",
      path,
    });
  return findings;
}

interface PreflightBaseline {
  readonly highestN: number;
  readonly baseline?: {
    readonly path: string;
    readonly record: PreflightReportRecord;
  };
  readonly invalidFindings: readonly PreflightFinding[];
}

// Review round 2 H1: bounded to at most 15 digits, so every match is well
// inside `Number.MAX_SAFE_INTEGER` (16 digits) and `Number(...)` can never
// silently lose precision (`1e20 + 1 === 1e20`) or format back out as
// `1e+22`. A name whose digit run is longer, or that has a leading zero,
// still "looks like" a preflight report for this `fp12` — it matches
// `LOOSE_SUFFIX_PATTERN` — so it is reported as an out-of-range advisory
// finding rather than silently ignored, but it can never win `highestN`.
const STRICT_SUFFIX_PATTERN = /^([1-9][0-9]{0,14})\.json$/;
const LOOSE_SUFFIX_PATTERN = /^([0-9]+)\.json$/;

function invalidBaselineFinding(
  relativePath: string,
  message: string,
): PreflightFinding {
  return {
    code: "REVIEW_RECORD_INVALID",
    message,
    path: relativePath,
  };
}

/**
 * Contract §2's 修訂性澄清（R-007）deduplication baseline: among
 * `records/preflight-<fp12>-<n>.json` names for the current `fp12`, the
 * highest `<n>` is read (bounded, `O_NOFOLLOW`, depth 32) and validated.
 * Only that one file is ever read — never the wider collection — so no
 * aggregate file-count or byte cap is needed (Story R10b). An invalid,
 * over-limit, out-of-range, unreadable, or symlinked file is reported as an
 * advisory finding and is never used for deduplication; `highestN` is
 * still reported so the next write still allocates past it, never reusing
 * its number (and never a number an out-of-range name merely looked like
 * it held, review round 2 H1).
 */
async function loadPreflightBaseline(
  root: string,
  manifestPath: string,
  batchId: string,
  fp12: string,
  names: readonly string[],
): Promise<PreflightBaseline> {
  const prefix = `preflight-${fp12}-`;
  let highestN = 0;
  let highestName: string | undefined;
  const invalidFindings: PreflightFinding[] = [];
  for (const name of names) {
    if (!name.startsWith(prefix)) continue;
    const suffix = name.slice(prefix.length);
    const strict = STRICT_SUFFIX_PATTERN.exec(suffix);
    if (strict !== null) {
      const n = Number(strict[1]);
      if (Number.isSafeInteger(n) && n > highestN) {
        highestN = n;
        highestName = name;
      }
      continue;
    }
    if (LOOSE_SUFFIX_PATTERN.test(suffix)) {
      invalidFindings.push(
        invalidBaselineFinding(
          `${recordsDirectory(manifestPath)}/${name}`,
          "existing preflight report name is out of range",
        ),
      );
    }
  }
  if (highestName === undefined) return { highestN, invalidFindings };

  const relativePath = `${recordsDirectory(manifestPath)}/${highestName}`;
  const invalid = (): PreflightBaseline => ({
    highestN,
    invalidFindings: [
      ...invalidFindings,
      invalidBaselineFinding(
        relativePath,
        "existing preflight report is invalid",
      ),
    ],
  });
  const bytes = await readRecordBytes(resolve(root, relativePath));
  if (bytes === undefined) return invalid();
  const parsed = parseRecordJson(bytes);
  if (!parsed.ok) return invalid();
  const validated = validateStoredPreflightReportRecord(parsed.data, batchId);
  if (!validated.ok) return invalid();
  // Review round 2 L3: the file name's own `fp12` must match the content's
  // `fingerprint` prefix, exactly like every other `records/` reader
  // (`readRevisionRecords`, `readConfirmationRecords`) already requires —
  // a baseline whose name and content disagree is never trusted.
  if (validated.record.fingerprint.slice(0, 12) !== fp12) return invalid();
  return {
    highestN,
    invalidFindings,
    baseline: { path: relativePath, record: validated.record },
  };
}

/** Runs `praxisbound review preflight <manifest>`. */
export async function runReviewPreflight(
  args: readonly string[],
  root: string = process.cwd(),
  options: {
    readonly gitAdapter?: ReviewGitAdapter;
    readonly now?: () => Date;
    readonly filesystem?: RecordFilesystem;
  } = {},
): Promise<ReviewIndexExecution> {
  const parsed = parsePreflightArguments(args);
  if (!parsed.valid || parsed.manifest === undefined) {
    return {
      mode: parsed.mode,
      result: envelope("error", "usage-error", 2, [
        issue("REVIEW_USAGE", "Invalid arguments"),
      ]),
    };
  }

  try {
    const loaded = await runReviewIndexUnsafe(
      [parsed.manifest, "--json"],
      root,
    );
    if (loaded.result.outcome !== "success" || loaded.loaded === undefined)
      return { mode: parsed.mode, result: loaded.result };
    const loadedBatch = loaded.loaded;
    const { manifestPath, index } = loadedBatch;

    // Contract §9's git rows (`ADR-015`): git is run only when
    // `--expect-revision` is given, exactly once, through the injected
    // adapter. A subprocess/observation failure is a reported condition,
    // never a silent pass: it stops the whole command at `ERROR`, exit 3,
    // before any record is read or written.
    const gitAdapter = options.gitAdapter ?? nodeReviewGitAdapter;
    const gitFindings: PreflightFinding[] = [];
    if (parsed.expectRevision !== undefined) {
      const batchSourcePaths = index.sources.map((source) => source.path);
      const observation = await gitAdapter.observe(root, [
        manifestPath,
        ...batchSourcePaths,
      ]);
      if (observation.kind === "failed") {
        process.stderr.write(
          "praxisbound review preflight: internal error: git observation failed\n",
        );
        return {
          mode: parsed.mode,
          result: envelope("error", "ERROR", 3, [
            issue(
              "REVIEW_INTERNAL_ERROR",
              "an unexpected internal failure occurred",
            ),
          ]),
        };
      }
      if (observation.kind === "not-a-repository") {
        gitFindings.push({
          code: "REVIEW_NOT_A_GIT_REPOSITORY",
          message: "the repository root is not inside a git working tree",
        });
      } else {
        gitFindings.push(
          ...gitObservationFindings(
            observation,
            parsed.expectRevision,
            manifestPath,
            batchSourcePaths,
          ),
        );
      }
    }

    const listingState = await loadRecordsListingState(root, manifestPath);
    const recordFindings: PreflightFinding[] = [];
    // Review round 2 L2: a symlinked `records/` is never reported here as
    // an advisory — `createNewRecord`'s own write-time check always turns
    // it into `configuration-error`/`REVIEW_PATH_UNSAFE` before anything is
    // written (see below), so an earlier advisory finding for the same
    // condition was dead code that could never surface in a written
    // report. An otherwise-unreadable `records/` (not a symlink) is a
    // different condition with no such later check, so it still reports.
    if (
      !listingState.unsafe &&
      !listingState.listing.ok &&
      listingState.listing.reason === "error"
    ) {
      recordFindings.push({
        code: "REVIEW_RECORD_INVALID",
        message: "unable to read the records directory",
        path: recordsDirectory(manifestPath),
      });
    }
    const names = listingState.listing.ok ? listingState.listing.names : [];

    const fp12 = index.fingerprint.slice(0, 12);
    const preflightBaseline = await loadPreflightBaseline(
      root,
      manifestPath,
      index.batchId,
      fp12,
      names,
    );
    recordFindings.push(...preflightBaseline.invalidFindings);

    const revisionRecords = await readRevisionRecords(
      root,
      manifestPath,
      index.batchId,
      names,
    );
    const responseRecords = await readResponseRecords(
      root,
      manifestPath,
      index.batchId,
      names,
    );
    for (const entry of revisionRecords.invalid)
      recordFindings.push({
        code: "REVIEW_RECORD_INVALID",
        message: "existing record is invalid",
        path: entry.path,
      });
    for (const entry of responseRecords.invalid)
      recordFindings.push({
        code: "REVIEW_RECORD_INVALID",
        message: "existing record is invalid",
        path: entry.path,
      });

    const recordSet = validateRevisionRecordSet(
      revisionRecords.records.map((record) => ({
        path: record.path,
        revisions: record.sheet.revisions,
      })),
    );
    if (!recordSet.ok) {
      for (const conflictIssue of recordSetInvalidIssues(recordSet.conflicts))
        recordFindings.push({
          code: conflictIssue.code,
          message: conflictIssue.message,
          ...(conflictIssue.path === undefined
            ? {}
            : { path: conflictIssue.path }),
        });
    }

    const effective = computeEffectiveRevisions(
      [...revisionRecords.bySha256.values()].map((sheet) => sheet.revisions),
    );
    const effectiveIds = new Set(effective.map((revision) => revision.id));

    // Contract §7's stored-responses re-check (this Story re-verifies every
    // already-written responses record, not only the one `review respond`
    // would write today): the same `computeResponseCoverage` `review
    // respond` itself uses, so the two commands can never disagree.
    for (const stored of responseRecords.records) {
      const listedSheets = stored.record.revisionSheets.map((sha) =>
        revisionRecords.bySha256.get(sha),
      );
      if (listedSheets.some((sheet) => sheet === undefined)) {
        recordFindings.push({
          code: "REVIEW_RESPONSE_INVALID",
          message: "revisionSheets names a record that was never imported",
          path: stored.path,
        });
        continue;
      }
      // Review round 2 H2 (Human Review decision): only a response record
      // bound to the CURRENT fingerprint gets the full contract §7 coverage
      // re-check. A later supersede (a new revision replacing one this
      // record already answered) changes today's effective requests, but
      // it can never retroactively make a past fingerprint's response
      // record wrong — that record is historical Evidence, not a claim
      // about the current batch, so only its structural validity (every
      // listed sheet was imported, checked above) is re-verified.
      if (stored.record.toFingerprint !== index.fingerprint) continue;
      const sheets = listedSheets as NonNullable<
        (typeof listedSheets)[number]
      >[];
      const responseIds = stored.record.responses.map(
        (response) => response.revisionId,
      );
      const coverage = computeResponseCoverage(
        sheets,
        effectiveIds,
        responseIds,
      );
      for (const id of coverage.missingIds)
        recordFindings.push({
          code: "REVIEW_RESPONSE_MISMATCH",
          message: `no response answers effective revision ${id}`,
          path: stored.path,
        });
      for (const id of coverage.extraIds)
        recordFindings.push({
          code: "REVIEW_RESPONSE_MISMATCH",
          message: `this response does not answer an effective request of its listed sheets: ${id}`,
          path: stored.path,
        });
    }

    const confirmationLoad = await loadReviewConfirmationApplicability(
      root,
      manifestPath,
      index,
      listingState,
    );
    // Review round 2 M3: the loader's own code (`REVIEW_RECORD_INVALID` or
    // `REVIEW_INPUT_TOO_LARGE`) is passed through unchanged — classifying
    // an issue code is Core's decision (`CLASS_BY_CODE`), never the CLI's.
    for (const blocking of confirmationLoad.blockingIssues)
      recordFindings.push({
        code: blocking.code,
        message: blocking.message,
        ...(blocking.path === undefined ? {} : { path: blocking.path }),
      });
    const confirmation = buildConfirmationState(confirmationLoad);

    const unresolved = computeUnresolvedRequests(
      effective,
      responseRecords.records.map((record) => record.record),
      index.fingerprint,
    );

    const reader = createNodeStoryReader(undefined, root);
    const storyFindings: PreflightFinding[] = [];
    for (const story of index.stories) {
      const entry = await checkStoryReadiness(reader, story.path);
      if (entry.kind === "error") {
        storyFindings.push({
          code: entry.issue.code,
          message: entry.issue.message,
          path: story.path,
        });
        continue;
      }
      for (const storyIssue of entry.issues)
        storyFindings.push({
          code: storyIssue.code,
          message: storyIssue.message,
          path: story.path,
        });
    }

    // R10a: the `--semantic-report` path must resolve inside the repository
    // with no symlinked segment; a violation is `configuration-error`,
    // exit 2, `REVIEW_PATH_UNSAFE`, and nothing is written — checked before
    // any other Semantic Report decision.
    const locatorLookup = buildTargetLookup(index);
    const batchBlockSha256 = sha256Hex(
      new TextEncoder().encode(index.fingerprint),
    );
    const semanticLoad = await loadSemanticReport(root, parsed.semanticReport, {
      batchId: index.batchId,
      fingerprint: index.fingerprint,
      storyIds: index.stories
        .map((story) => story.id)
        .filter((id): id is string => id !== undefined),
      locatorLookup,
      manifestPath,
      batchBlockSha256,
    });
    if (semanticLoad.unsafe) {
      return {
        mode: parsed.mode,
        result: envelope("error", "configuration-error", 2, [
          issue(
            "REVIEW_PATH_UNSAFE",
            "semantic report path resolves outside the repository root or through a symlink",
          ),
        ]),
      };
    }
    const semanticFindings = semanticLoad.findings;
    const semanticReportRef: PreflightReportSemanticReportRef | null =
      semanticLoad.sha256 === undefined
        ? null
        : { sha256: semanticLoad.sha256 };

    const evaluateNow = () =>
      evaluatePreflight({
        fingerprint: index.fingerprint,
        batchDiagnostics: index.diagnostics,
        dependencies: index.dependencies,
        confirmation,
        unresolved,
        recordFindings,
        storyFindings,
        expectFingerprint: parsed.expectFingerprint,
        gitFindings,
        semanticFindings,
      });

    const evaluation = evaluateNow();

    // Contract §13: the diagnostics bound should never be reachable within
    // the batch's own limits; over it is `ERROR`, exit 3, not truncation,
    // and nothing is written.
    if (
      evaluation.mechanical.length + evaluation.semantic.length >
      MAX_DIAGNOSTICS
    ) {
      return {
        mode: parsed.mode,
        result: envelope("error", "ERROR", 3, [
          issue(
            "REVIEW_INTERNAL_ERROR",
            `the preflight diagnostics count exceeds the limit (${MAX_DIAGNOSTICS})`,
          ),
        ]),
      };
    }

    // The confirmation ref (contract §2's Preflight Report `confirmation`
    // field) names the one applicable confirmation, by its own file's
    // sha256 — read once more here since `loadReviewConfirmationApplicability`
    // returns parsed content, not the raw bytes a record ref needs.
    let confirmationRef: PreflightReportRecordRef | null = null;
    if (confirmationLoad.applicability?.applies === true) {
      const confirmationPath = confirmationLoad.applicability.confirmation.path;
      const confirmationBytes = await readRecordBytes(
        resolve(root, confirmationPath),
      );
      if (confirmationBytes !== undefined) {
        confirmationRef = {
          path: confirmationPath,
          sha256: sha256Hex(confirmationBytes),
        };
      }
    }

    const expectRef: PreflightReportExpect | null =
      parsed.expectFingerprint !== undefined &&
      parsed.expectRevision !== undefined
        ? {
            fingerprint: parsed.expectFingerprint,
            revision: parsed.expectRevision,
          }
        : null;

    const now = options.now ?? ((): Date => new Date());
    const record = buildPreflightReportRecord({
      batchId: index.batchId,
      fingerprint: index.fingerprint,
      outcome: evaluation.outcome,
      checkedAt: canonicalUtcTime(now().toISOString()),
      confirmation: confirmationRef,
      semanticReport: semanticReportRef,
      mechanical: evaluation.mechanical,
      semantic: evaluation.semantic,
      expect: expectRef,
    });

    const validatedRecord = validateStoredPreflightReportRecord(
      record,
      record.batchId,
    );
    const recordBytes = new TextEncoder().encode(JSON.stringify(record));

    // R7: a rerun whose new record equals the highest existing one under
    // this `fp12` in every field but `checkedAt` (expect included) writes
    // nothing and names the existing file.
    if (
      preflightBaseline.baseline !== undefined &&
      preflightReportsEqualExceptCheckedAt(
        preflightBaseline.baseline.record,
        record,
      )
    ) {
      return {
        mode: parsed.mode,
        result: buildPreflightEnvelope(
          index,
          evaluation,
          semanticLoad.agent,
          preflightBaseline.baseline.path,
        ),
        loaded: loadedBatch,
      };
    }

    // H2 defense in depth (mirroring `buildConfirmationRecordBytes`): a
    // built record that fails its own validator, or is oversized, is
    // treated exactly like a genuine write failure below — this should be
    // unreachable in normal operation.
    const writeFailed = async (): Promise<ReviewIndexExecution> => {
      recordFindings.push({
        code: "REVIEW_RECORD_WRITE_FAILED",
        message: "unable to write the preflight report",
      });
      return {
        mode: parsed.mode,
        result: buildPreflightEnvelope(
          index,
          evaluateNow(),
          semanticLoad.agent,
        ),
        loaded: loadedBatch,
      };
    };

    if (!validatedRecord.ok || recordBytes.length > 1024 * 1024)
      return await writeFailed();

    const written = await createNewRecord(
      root,
      manifestPath,
      (attempt) =>
        `preflight-${fp12}-${preflightBaseline.highestN + attempt}.json`,
      recordBytes,
      {
        maxAttempts: 16,
        ...(options.filesystem ? { filesystem: options.filesystem } : {}),
      },
    );
    if (written.ok) {
      return {
        mode: parsed.mode,
        result: buildPreflightEnvelope(
          index,
          evaluation,
          semanticLoad.agent,
          written.relativePath,
        ),
        loaded: loadedBatch,
      };
    }
    if (written.reason === "unsafe") {
      return {
        mode: parsed.mode,
        result: envelope("error", "configuration-error", 2, [
          issue("REVIEW_PATH_UNSAFE", "records path has a symlinked segment"),
        ]),
      };
    }
    return await writeFailed();
  } catch (error) {
    process.stderr.write(
      `praxisbound review preflight: internal error: ${sanitizeInternalError(error, root)}\n`,
    );
    return {
      mode: parsed.mode,
      result: envelope("error", "ERROR", 3, [
        issue(
          "REVIEW_INTERNAL_ERROR",
          "an unexpected internal failure occurred",
        ),
      ]),
    };
  }
}

function buildPreflightEnvelope(
  index: {
    readonly batchId: string;
    readonly fingerprint: string;
    readonly sources: readonly {
      readonly path: string;
      readonly sha256: string | null;
    }[];
  },
  evaluation: ReturnType<typeof evaluatePreflight>,
  /** The Semantic Report's own `agent` field, once read (R5): shown only as the Agent's unverified claim, never as identity. */
  semanticAgent?: string,
  preflightRecordPath?: string,
) {
  const mechanicalAndSemantic = [
    ...evaluation.mechanical,
    ...evaluation.semantic,
  ];
  const issues = mechanicalAndSemantic.map((entry) =>
    issue(entry.code, entry.message, entry.path),
  );
  const diagnostics = mechanicalAndSemantic.map((entry) => ({
    code: entry.code,
    severity: entry.severity,
    ...(entry.locator === undefined
      ? {}
      : { locator: toDataValue(entry.locator) }),
  }));
  const data = {
    batchId: index.batchId,
    fingerprint: index.fingerprint,
    sources: toDataValue(index.sources),
    diagnostics: toDataValue(diagnostics),
    // Only the Agent observations section's boundary within the flat
    // `diagnostics`/`issues` arrays (Core already orders `mechanical`
    // before `semantic`): the human renderer needs this to split the two
    // sections without duplicating either array's shape.
    semanticCount: evaluation.semantic.length,
    ...(semanticAgent === undefined ? {} : { semanticAgent }),
    ...(preflightRecordPath === undefined
      ? {}
      : { preflightRecord: preflightRecordPath }),
  };

  if (evaluation.outcome === "REVIEW_READY")
    return envelope("pass", "REVIEW_READY", 0, issues, data);
  return envelope("fail", evaluation.outcome, 1, issues, data);
}

/** Renders the human output for `review preflight`: two labelled sections (Story R-007/AC-006, AC-008 contract §9), the fixed `REVIEW_READY` disclaimer (R8), and ESC-escaped untrusted text throughout. */
export function renderReviewPreflightHuman(
  execution: ReviewIndexExecution,
): ReviewRenderedOutput {
  const { result } = execution;
  if (result.outcome === "usage-error") {
    return {
      stdout: "",
      stderr:
        "ERROR Invalid arguments\n" +
        "Usage: praxisbound review preflight <manifest> [--semantic-report <file>]\n" +
        "         [--expect-fingerprint <sha256> --expect-revision <commit>] [--json]\n" +
        "       praxisbound review preflight --help\n",
    };
  }
  if (
    result.outcome !== "REVIEW_READY" &&
    result.outcome !== "REVIEW_BLOCKED" &&
    result.outcome !== "REVIEW_INCOMPLETE" &&
    result.outcome !== "REVIEW_STALE"
  ) {
    const lines = [
      "PraxisBound Batch Review Preflight",
      "",
      `Result: ${result.outcome}`,
      "",
    ];
    for (const reported of result.issues)
      lines.push(
        `FAIL ${reported.code}: ${escapeHumanControlCharacters(reported.message)}`,
      );
    return { stdout: `${lines.join("\n")}\n`, stderr: "" };
  }

  const data = result.data as
    | {
        readonly batchId: string;
        readonly fingerprint: string;
        readonly diagnostics: readonly {
          readonly code: string;
          readonly severity: "blocking" | "advisory";
          readonly locator?: {
            readonly path: string;
            readonly anchor: string;
            readonly blockSha256: string;
          };
        }[];
        readonly semanticCount?: number;
        readonly semanticAgent?: string;
        readonly preflightRecord?: string;
      }
    | undefined;

  // Core already orders `mechanical` before `semantic` (both `result.issues`
  // and `data.diagnostics` are the two concatenated in that order, R6): the
  // last `semanticCount` entries are the Semantic Report's own diagnostics
  // (Story TST-028), the rest are every other check's.
  const semanticCount = data?.semanticCount ?? 0;
  const allIssues = result.issues;
  const allDiagnostics = data?.diagnostics ?? [];
  const splitIndex = Math.max(allIssues.length - semanticCount, 0);
  const mechanicalIssues = allIssues.slice(0, splitIndex);
  const semanticIssues = allIssues.slice(splitIndex);
  const mechanicalDiagnostics = allDiagnostics.slice(0, splitIndex);
  const semanticDiagnostics = allDiagnostics.slice(splitIndex);

  function severityLabel(
    severity: "blocking" | "advisory" | undefined,
  ): string {
    return severity === "advisory" ? "NOTE" : "BLOCK";
  }

  function renderLine(
    reported: {
      readonly code: string;
      readonly message: string;
      readonly path?: string;
    },
    diagnostic:
      | {
          readonly severity: "blocking" | "advisory";
          readonly locator?: {
            readonly path: string;
            readonly anchor: string;
            readonly blockSha256: string;
          };
        }
      | undefined,
  ): string {
    const locatorPath = reported.path ?? diagnostic?.locator?.path;
    const location =
      locatorPath === undefined
        ? ""
        : ` (${escapeHumanControlCharacters(locatorPath)})`;
    return `${severityLabel(diagnostic?.severity)} ${reported.code}: ${escapeHumanControlCharacters(reported.message)}${location}`;
  }

  const lines = ["PraxisBound Batch Review Preflight", ""];
  if (data !== undefined) {
    lines.push(`Batch: ${data.batchId}`);
    lines.push(`Fingerprint: ${data.fingerprint}`);
    if (data.preflightRecord !== undefined)
      lines.push(
        `Record: ${escapeHumanControlCharacters(data.preflightRecord)}`,
      );
  }
  lines.push("", "Mechanical checks");
  if (mechanicalIssues.length === 0) {
    lines.push("none");
  } else {
    for (const [index, reported] of mechanicalIssues.entries())
      lines.push(renderLine(reported, mechanicalDiagnostics[index]));
  }
  lines.push("", "Agent observations (unverified)");
  if (data?.semanticAgent !== undefined)
    lines.push(
      `Agent (self-reported): ${escapeHumanControlCharacters(data.semanticAgent)}`,
    );
  if (semanticIssues.length === 0) {
    lines.push("none");
  } else {
    for (const [index, reported] of semanticIssues.entries())
      lines.push(renderLine(reported, semanticDiagnostics[index]));
  }
  lines.push("", `Result: ${result.outcome}`);
  if (result.outcome === "REVIEW_READY") {
    lines.push("", "只表示未發現阻擋，不宣稱沒有缺陷");
  }
  lines.push("");

  return { stdout: `${lines.join("\n")}\n`, stderr: "" };
}
