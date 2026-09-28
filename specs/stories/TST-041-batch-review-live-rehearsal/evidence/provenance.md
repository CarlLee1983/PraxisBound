# TST-041 rehearsal provenance

Observed 2026-09-28 03:27–03:55 UTC. Paths outside this repository are reported by role; `<fixture>` is the isolated temporary repository used in this session. The exact local path was handed to the human for terminal confirmation and is not an input to the batch fingerprint.

| Component | Observed identity |
| --- | --- |
| PraxisBound Git HEAD | `d8ae521e29657ebda08d9bdb60edb67e52b3580d`; TST-041 evidence files are uncommitted, product CLI source unchanged |
| PraxisBound CLI | `0.3.0`; built `packages/cli/dist/bin.js` SHA-256 `c6525f4f05336b9c4f16319e5b4c4f8ede8eeda06e4e356f8c8aa6073b3532b7` |
| Fixture builder | `evidence/build-fixture.mjs` SHA-256 `2f7beab99d3f5c6add48e3edd611cfc859cc99d78814cb356e1c1961b63c6456` |
| Fixture baseline | Git HEAD `a47207c969f63f54d3a51535f09e832f0aa2885e`; manifest SHA-256 `957077166387847c6de212a95356de919e2eecc5583bbfde453c36e30f0b8a63` |
| ForgePilot Bootstrap | `generation-v1 current` returned generation `3a76acaa5da206bef9a8d15df0db3f08f90311e2`, payload `sha256:6b82b953957d6bf8182bb09705ab8b4f690c0b7864b87193efde82df82b8cce5` |
| ForgePilot CLI | managed binary SHA-256 `426d85e6af61383365ef38017e8a05ed6027f0302679fc42c666a235ed951a82` |
| Codex CLI | `codex-cli 0.157.1`; resolved executable SHA-256 `27ceb5f9b957b43a519efe4eaa3816a0bffb0a531a2c89af18840c0a3c016a7d`; `codex login status`: `Logged in using ChatGPT` |

The fixture builder created two Specs and four Stories with declared edges `FX-002 → FX-001` and `FX-004 → FX-002, FX-003`. The fixture's initial `make verify` exited 0 with three pending acceptance cases skipped; those are deliberately not counted as implemented behavior. The strict `make verify-final` exited 2 with five expected failures for missing pre-implementation Story outputs; it must pass with no skips after the live run. `review readiness-digests` and `review render` each exited 0. Their raw JSON results are retained in `readiness-digests.json` and `render.json`. Current Requirement Fingerprint: `ffad64ff3208f284a4316456a71d7a5099abf31dcf2c584e29284153fac47321`. Both commands reported two `REVIEW_SECTION_UNRECOGNIZED` advisories for the Spec titles; no blocking issue was observed.

An earlier disposable fixture, created before the strict gate was added, was abandoned without confirmation or ForgePilot state. Its render path and baseline commit are not used for this rehearsal; only the fixture baseline above is current.

The unsupported metadata probe `forgepilot --version` exited 1 with `unknown command "--version"`; the Bootstrap generation and binary SHA above identify the ForgePilot used here. The human then confirmed the definition and authorized execution. The first and second ForgePilot segments, Worker run, final fixture checks, observed issues, and distinct acceptance states are recorded in `live-rehearsal.md` and `../verification.md`.
