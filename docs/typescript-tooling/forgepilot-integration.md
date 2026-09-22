# JSON Process Consumer Contract (ForgePilot Example)

An external process consumer should use the CLI boundary first. Pin the
tooling package version during acquisition, install it into the consumer, and
invoke the installed `praxisbound` binary with `--json`. Package acquisition may
use a registry; CLI runtime is local and does not fetch a Protocol snapshot.
The source on the default branch builds `@praxisbound/cli@0.3.0`, whose only
runtime dependency is exact `@praxisbound/core@0.3.0`. Before pinning, run
`npm view @praxisbound/cli dist-tags` and pin the exact version `latest`
resolves to; source and registry can differ between a merge and its
publication. Tooling version and the bundled Protocol version (`0.10.0`) are
separate compatibility values.

The published command paths are `init`, `codex activate`, `doctor`, `verify`,
`handoff check`, `release check`, `story check`, and `verification check`. Place
`--json` among the selected command's options. For every handled completion,
stdout contains one JSON object and one trailing newline. Child output and
progress from effectful commands may appear on stderr; they are not a machine
result. The [v1 schema](result-envelope-v1.schema.json) is the authority for the
shape and status/outcome combinations.

A process consumer should perform these checks in order:

1. Require exactly one JSON object on stdout. Missing, malformed, or multiple
   objects are a tooling or acquisition failure, regardless of process exit.
2. Check `schemaVersion` against the supported `1.0.0` before interpreting any
   result fields. Check `protocolVersion` against the selected supported
   Protocol. Stop on an unsupported version; do not parse human stdout as a
   fallback.
3. Check that envelope `exit` equals the actual child exit. Treat a signal or
   missing process exit as an execution failure.
4. Use `status`, `outcome`, `issues[*].code`, and documented `data` fields for
   decisions. `message` is presentation text. Unknown command-specific `data`
   keys may be ignored; unknown schema versions may not.

`pass` has exit `0`; `warning` is a distinct advisory status with exit `0`;
`fail` has exit `1`; `error` has exit `2` or `3`. An expected Protocol-negative
result still has a valid JSON envelope. Exit `3` with no usable envelope is an
internal tooling failure. The exact CLI package version supplies the tooling
SemVer; `praxisbound --version` can report the installed version separately.

The optional library boundary is appropriate only for a consumer running a
supported Node version that explicitly wants in-process semantic evaluation.
It must declare a compatible exact `@praxisbound/core` tooling version and import
only `@praxisbound/core` package-root exports. It supplies immutable observations
to Core and owns its filesystem, Git, process, and lifecycle effects. ForgePilot
is a Go program today, so the process boundary avoids a Node library dependency
inside ForgePilot. Neither mode imports PraxisBound internals or parses human
output.

If ForgePilot adopts this boundary, it alone owns its Goal, Work Item, Gate,
review, and current lifecycle state. PraxisBound evaluates repository artifacts
and reports evidence. It does not read or mutate ForgePilot's `.forgepilot`
snapshot or infer a current work status from an immutable Handoff. A
ForgePilot-owned integration check should
consume a version-pinned installed CLI against a disposable repository and
assert this ownership boundary when such a check exists. The repository-local
packed consumer suite proves the generic JSON process contract; it does not
claim a live ForgePilot integration until that separate consumer check exists
and passes. ForgePilot-owned evidence is optional for this contract.
