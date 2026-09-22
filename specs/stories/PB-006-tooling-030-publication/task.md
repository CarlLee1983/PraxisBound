# Implementation Notes

## Required delivery order

1. Keep the candidate local and clean: raise Core, CLI, the CLI's exact Core
   dependency, lockfile, and current documentation coordinates to 0.3.0.
2. Run prompt and package-focused tests, then `make verify`. Record the exact
   candidate SHA only after the human separately authorizes a commit and push.
3. Repeat the six TST-020 observations on the final prompt bytes. Do not count
   pilots, earlier prompt versions, or sessions with follow-up input.
4. With distinct human authorization, obtain the exact-SHA remote CI result,
   then publish Core and CLI through separate approved `npm-publication` jobs
   from the unchanged SHA.
5. Record public signatures, attestations, provenance, integrity, exact-version
   smoke, and only then human `latest` promotion and latest smoke.

## Boundary reminders

- The version choice is 0.3.0. Protocol `VERSION` is unrelated to the public
  tooling package coordinate and does not change in this Story.
- A workflow rehearsal does not provide upload, provenance, or attestation
  evidence.
- An agent never dispatches, approves, publishes, tags, pushes, promotes, or
  reads credentials/settings. Stop and report partial external state instead.
