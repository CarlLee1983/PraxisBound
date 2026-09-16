import type { ResultDataValue } from "./result.js";

/**
 * One remaining step an adopter must perform before the repository is a
 * complete Adoption. `id` is the machine contract; `description` is prose for
 * a human and may be reworded without a classification.
 */
export interface AdoptionNextStep {
  readonly [key: string]: ResultDataValue;
  readonly id: string;
  readonly description: string;
}

/**
 * The ordered steps init reports on its preview and applied outcomes.
 * Identifiers, ordering and presence are version-protected. The gate step
 * states a required outcome rather than a file body, because the Reference
 * Tooling cannot know this repository's language or toolchain, and it never
 * writes the gate: an Adoption owns its own verification gate. ADR-012.
 */
export const adoptionNextSteps: readonly AdoptionNextStep[] = Object.freeze([
  Object.freeze({
    id: "verification-gate",
    description:
      "Create this repository's verification gate so that running `make verify` from its root runs the repository's own checks and exits 0. PraxisBound does not write it, because an Adoption owns its gate and only this repository knows what its checks are.",
  }),
  Object.freeze({
    id: "confirm-adoption",
    description:
      "Run `praxisbound doctor` from this repository's root and confirm it reports PASS. A PASSing doctor is what makes this repository a complete Adoption.",
  }),
]);
