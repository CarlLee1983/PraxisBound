# Verification Result: TST-021

## Checks

* lint: pass — `make verify; Prettier, ESLint, shell syntax and Node syntax passed on exact SHA 9c58e8a04bb12641c439c5fbd385b059b083daf1`
* static: pass — `make verify; TypeScript typecheck, Story readiness and verification planning passed`
* unit: pass — `make verify; 381 Node tests passed, including 18 in packages/core/test/review-index.test.mjs and 9 in packages/core/test/review-fingerprint.test.mjs`
* integration: pass — `packages/cli/test/review-index-command.test.mjs; 20 process-boundary cases against temporary git repositories`
* contract: pass — `every CLI envelope in review-index-command.test.mjs validated by validateResultEnvelope at schemaVersion 1.0.0; tests/typescript-tooling.sh PB003-AC-001 accepted the widened core and cli tarball surfaces`
* e2e: pass — `exact SHA 9c58e8a04bb12641c439c5fbd385b059b083daf1 passed all 30 checks in Actions runs 35240954918 (pull_request) and 35240929948 (push)`
* architecture: pass — `Human Review: carl accepted in a Claude Code session on 2026-09-17 at 15:47Z, reviewing main at fe7438a0cb779dbbaaa83c81a7e3f20045f4bef0. Accepted the I/O-free review Core module behind planReviewBatch and indexReviewBatch, the CLI adapter owning filesystem facts, and conformance to ADR-014.`

PR #98 merged into main as fe7438a0cb779dbbaaa83c81a7e3f20045f4bef0, whose tree
is identical to 9c58e8a04bb12641c439c5fbd385b059b083daf1. The local
`make verify` run preceded a rebase that brought in only the documentation
merges #96 and #97; the remote runs above are for the rebased SHA.

## Evidence

* `AC-001`: pass — `TST021-AC-001/AC-010 indexed exactly the declared ADR, Spec, story.md and acceptance.md paths in UTF-8 path order and none of the undeclared fixture files.`
* `AC-002`: pass — `TST021-AC-002 traced mapped entries to Stories and acceptance IDs and reported REVIEW_REQUIREMENT_UNMAPPED and REVIEW_ACCEPTANCE_MISSING without marking either covered.`
* `AC-003`: pass — `TST021-AC-003 cases matched a pinned fingerprint computed outside the module for a non-ASCII fixture whose UTF-16 and UTF-8 orders differ, and changed exactly for add, remove, edit, CRLF and manifest edits; the CLI case showed an uncommitted edit changes it and an mtime-only touch does not.`
* `AC-004`: pass — `TST021-AC-004 reported REVIEW_SOURCE_MISSING with a null digest, REVIEW_MANIFEST_INVALID for a duplicate Story ID, REVIEW_STORY_UNKNOWN, REVIEW_ANCHOR_DUPLICATE and REVIEW_SECTION_UNRECOGNIZED while every heading stayed indexed.`
* `AC-005`: pass — `TST021-AC-005/AC-008 returned success exit 0 for a draft with missing sources and unmapped entries, with every gap in issues and data.diagnostics.`
* `AC-006`: pass — `TST021-AC-006 and the security-matrix cases rejected .., absolute, control-character and symlinked paths, including a symlinked specs/batches and the manifest's parent, with configuration-error exit 2 and the fixture tree unchanged.`
* `AC-007`: pass — `TST021-AC-007 and the code-review cases recognized only level-2 R-NNN headings, rejected R-01, R-001x, fenced and indented headings, and matched blockSha256 to the exact block bytes.`
* `AC-008`: pass — `every CLI test runs through a helper that validates the envelope and checks data.diagnostics aligns with issues.`
* `AC-009`: pass — `TST021-AC-009 cases returned usage-error or configuration-error exit 2 with REVIEW_MANIFEST_INVALID, REVIEW_SCHEMA_UNSUPPORTED or REVIEW_INPUT_TOO_LARGE and no partial index, including 90000-level nesting under the byte limit.`
* `AC-010`: pass — `every CLI test compares a recursive listing with sizes, hashes and mtimes before and after the invocation.`
* `AC-011`: pass — `Human Review: carl accepted in a Claude Code session on 2026-09-17 at 15:47Z, reviewing main at fe7438a0cb779dbbaaa83c81a7e3f20045f4bef0. packages/core/src/review has node:crypto as its only Node built-in import and no filesystem, process or clock access.`
* `AC-012`: pass — `make verify exited 0; VERSION is 0.10.0 and protocol/, templates/ and result-envelope-v1.schema.json are unchanged between main before and after #98.`

## Authority Used

* plan
* modify
* commit
* push

## Residual Risks

* `Story fixed-field locators use a static list of field names in packages/core/src/review/index.ts; a renamed Protocol field falls back to a heading-path anchor until the list is updated.`
* `The O_NOFOLLOW and fstat guard against a symlink swapped in between lstat and open has no dedicated test; it cannot be triggered from a single-process test.`
* `An independent code review before #98 found four HIGH issues, all fixed with regression tests. Three judgments made in that repair were accepted by carl in the same Human Review: REVIEW_ANCHOR_DUPLICATE is blocking, REVIEW_ANCHOR_UNKNOWN was added as blocking, and the repository root stays the working directory, matching the story command.`
