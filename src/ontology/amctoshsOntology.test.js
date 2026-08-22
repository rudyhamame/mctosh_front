import { describe, expect, it } from "vitest";
import {
  AMCTOSHS_CONCEPTS,
  CANONICAL_FAQ_ITEMS,
  MODE_OF_ACCESS,
  validateOntology,
} from "./amctoshsOntology";

describe("canonical RabbitHole ontology", () => {
  it("passes structural validation", () => {
    expect(validateOntology()).toEqual({ valid: true, errors: [] });
  });

  it("preserves the access sequence and foundational dependencies", () => {
    expect(MODE_OF_ACCESS).toEqual(["societies", "humans", "systems", "organs", "tissues", "cells", "molecules", "atoms"]);
    expect(AMCTOSHS_CONCEPTS.hyle.independent).toBeUndefined();
    expect(AMCTOSHS_CONCEPTS.schema.independent).toBe(false);
    expect(AMCTOSHS_CONCEPTS.schema.dependsOn).toEqual(["hyle", "a-priori", "study"]);
  });

  it("provides the foundational FAQ subjects", () => {
    const ids = new Set(CANONICAL_FAQ_ITEMS.map((item) => item.id));
    ["amctoshs", "hyle", "clinician", "a-priori", "study", "schema", "instantiation", "trace", "3d-reality", "4d-reality", "change", "mode-of-access", "awareness", "life", "death"].forEach((id) => expect(ids.has(id)).toBe(true));
  });
});
