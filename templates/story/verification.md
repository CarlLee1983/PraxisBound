# Verification Result: <ID>

Optional. Record what verification actually did, so verified work carries
evidence rather than a claim. This is immutable evidence, not current
verification or completion state. `scripts/verification-check --result` reads
this file; it never runs a command recorded here.

## Checks

One entry per verification layer that ran. The status is `pass`, `fail`,
`skipped`, `blocked`, or `unsupported`, followed by the exact command or reason.
A layer the repository does not have is `unsupported`, never `pass`.
For a focused Story, a passing command must exactly match the command declared
in `story.md`. A low-risk focused documentation Story records `documentation`.
If the full gate was intentionally not run, record `full: skipped` and a residual
risk. A focused result that omits it remains partial. An explicit `Scope: full`
records `full: pass` with command `make verify`; an unrun required gate remains partial.

For a focused documentation Story, the recorded result looks like:

```markdown
## Checks

* documentation: pass — `./check-docs`
* full: skipped — `approved focused documentation scope`

## Evidence

* `AC-001`: pass — `document review observation`

## Residual Risks

* `full repository gate intentionally not run`
```

* lint: pass — `make verify`
* static: pass — `make verify`
* unit: pass — `make verify`

## Evidence

One entry per acceptance criterion, tracing it to the observation that proves
it. The status is `pass`, `fail`, `blocked`, or `skipped`.

* `AC-001`: pass — `tests/example.sh AC-001`

## Authority Used

Every operation the implementation actually performed. An operation the Story
does not grant is reported as an authority conflict.

* modify

## Residual Risks

Every skipped, blocked, unsupported, or failed verification, kept rather than
dropped. Required whenever the result is not complete.

* `no end-to-end environment in this repository`
