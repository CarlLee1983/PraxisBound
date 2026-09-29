# TST-042 same-fixture rehearsal observations

Observed 2026-09-29 UTC. The subject is the disposable repository at `/tmp/praxisbound-142.PaHYtX/fixture`, batch `BR-942-complete`. This path is local working evidence; the repository's baseline Git revision and hashes below identify the fixture independently of its path. No prior TST-041 Goal or confirmation is reused.

| Component | Observed identity |
| --- | --- |
| PraxisBound Git HEAD at preparation | `419d3a733b438c40984934d9e07abffb477ea970` |
| Built CLI | version `0.3.0`; SHA-256 `c6525f4f05336b9c4f16319e5b4c4f8ede8eeda06e4e356f8c8aa6073b3532b7` |
| Fixture builder | TST-041 `evidence/build-fixture.mjs`; SHA-256 `2f7beab99d3f5c6add48e3edd611cfc859cc99d78814cb356e1c1961b63c6456` |
| Fixture baseline | Git HEAD `ec787c98e3e10600afa023abfeac6e8dec0b23d1`; batch manifest SHA-256 `eacb302c147fe39e9caf0cc90db3fc5341b4d20a48e8746849e89e4c1d1fad1c` |

## Preparation

1. `node specs/stories/TST-041-batch-review-live-rehearsal/evidence/build-fixture.mjs <empty-target-directory> BR-942-complete` exited 0 and created the isolated fixture, two Specs, four dependent Stories, Readiness Sidecars, and a local baseline commit. The fixture's baseline `make verify` exited 0 with three pending cases skipped and zero passes. This is a pre-implementation observation, not final acceptance or a gate for the rendered source revision.
2. `review readiness-digests specs/batches/BR-942-complete/batch.json --json` exited 0 and updated the four Sidecars. The resulting fingerprint was `6049bd12abecbca2f08041cad31366c45d26dcc269fbafc805bdcbb81f5d2168`.
3. `review render specs/batches/BR-942-complete/batch.json --output specs/batches/BR-942-complete/review.html --json` exited 0 with the same fingerprint. The HTML SHA-256 was `c6fbfcd1cde226765fffe3518af638d9db2df1cd6fe100c5575bb68c5f8da1b7`. Two unrecognized Spec-title advisories were nonblocking.
4. At the rendered source revision, fixture `make verify` again exited 0 with zero passes and the same three pending cases skipped; `git diff --check` exited 0. Its source identity is the baseline commit plus the four updated Sidecars: FX-001 `ca6a58fb956fde2d4ec28c28aef31a30f6789fa61db62639e0cd21b659e28e25`, FX-002 `fd4d27b8bba9b4378c23dfe1d7b484c03f489c0a3db8d836802c12905b5307ff`, FX-003 `59ea46783c639f070c4a06f06135035ccced6fa05f1cbf70ab0e53db53f0f27d`, and FX-004 `ad94059cc89ea2a953a0454a14983bea4913c3155d0f011`. The pending cases remain residual until Worker output is verified.

## Browser boundary

The connected browser rejected the fixture's `file://` page under its URL security policy and explicitly prohibited retrying through another browser surface. The Agent did not use an alternate browser or synthesize the browser export/restore observation. The human opened the local page in their own browser, selected the `R-001/AC-001` and `R-002/AC-001` source blocks, authored two blocking supplement requests, and exported `/Users/carl/Downloads/BR-942-complete-revisions.md` (SHA-256 `cdf30fa9e75f2fdd0e5b9bd0d13e9e7aeeeda8723a3cbcf8c25553ab96f99326`). The first restore attempt in the original browser session reported two skipped duplicates because those opinions were already saved there. The human then opened a clean private window and reported `新增 2 則、待比對 0 則、略過重複 0 則`. This is the restore observation; browser automation remains blocked.

## Imported revision and source repair

1. `review import` exited 0. Both imported request targets had `match` locators. The accepted record is `specs/batches/BR-942-complete/records/revisions-8a0e4d31d5e1.json`, SHA-256 `8a0e4d31d5e154db82194c609b3d8f64c7a8bf65d1b8249016efe1c32554b6ba`.
2. For `REV-01M3P0N8B1H7PQNME2HZN1K9Z4`, the Agent added the `greet("Mina")` example to Greeting R-001, FX-001 and FX-002 acceptance, and the fixture acceptance test. For `REV-01M3P0VM9AY3EHPZ4TQAJY6MH6`, the Agent added `farewell("Mina")` to Farewell R-002, FX-003 acceptance, and the fixture acceptance test. No other definition source was changed. `review readiness-digests` updated the affected three Sidecars before the final render; `review index` exited 0 with fingerprint `b432508b8fa33c80333753c898308417aa2d06618ebedd3b4281ee23623b25f0`.
3. `review respond` exited 0 with one `incorporated` response per request and current post-repair locators. The accepted response record is `specs/batches/BR-942-complete/records/responses-b432508b8fa3-1.json`, SHA-256 `7d6e2c8271c11bf542a592d1ae5eed73351ce4766bf217c756035e03b26dfc6a`.
4. `review render` exited 0 with the revised fingerprint; HTML SHA-256 `90c7f0f4c2e4174a4de8a215c462b2aba3f12b422e10feae45b72cbc85ca96d9`. It includes both changed requirements and both imported requests and responses. The fixture `make verify` exited 0 with zero passes and the same three pre-implementation skips; `git diff --check` exited 0.

The revised render did **not** emit `REVIEW_SOURCE_CHANGED` or a `需複審` badge. The contract and implementation produce that marker only when a prior valid confirmation exists and is stale; this flow had no initial human confirmation before the requests. The new fingerprint, original quotes, revised sources, and individual responses are visible as historical comparison, but the Story's explicit changed-source/re-review indication criterion remains unproven. The human reloaded the revised page and reported seeing both Mina changes and their incorporated responses. Final terminal confirmation, preflight, and live handoff have not yet been observed.
