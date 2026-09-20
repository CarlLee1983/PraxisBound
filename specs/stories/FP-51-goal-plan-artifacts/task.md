# Implementation Notes

## Required delivery order

1. Define the v1 Goal Plan Manifest and Plan Coverage Review artifact shapes,
   including plan identity/revision, unique node and Story references,
   Readiness Contract source bindings, complete dependency references,
   raw-byte digests, coverage-index identity, and explicit self-declared
   approval fields.
2. Build pure validation/export behavior and stable failure categories before
   adding an adapter or documentation.
3. Add byte-preserved canonical fixtures and an expected-observation index;
   calculate fixture digests from raw files rather than parsed values.
4. Add focused tests, public artifact-boundary documentation, and run the
   repository verification gate.

## Boundary reminders

- ForgePilot is a downstream consumer. Do not edit ForgePilot, create a Goal,
  create ForgePilot state, or make an authorization decision in this Story.
- A valid Coverage Review proves only that the exact declared bindings and
  self-asserted approval fields validate. It does not authenticate a person,
  prove dependency/requirement completeness, or give any consumer permission to
  infer requirements or approve coverage.
- Keep any validation module deterministic and free of filesystem, process, and
  clock access; adapters may supply raw bytes and source facts at the boundary.
