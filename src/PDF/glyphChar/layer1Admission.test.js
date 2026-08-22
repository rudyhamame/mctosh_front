import { describe, expect, it } from "vitest";
import { getAdmittedChar, getLayer1Admission } from "./layer1Admission";

describe("Layer 1 downstream admission accessor", () => {
  it("blocks a high raw prediction without admission", () => {
    const glyph = { prediction: { predictedChar: "S", modelScore: 0.9999 }, admissionDecision: { state: "OBSERVE_ONLY", admittedChar: null, reasonCodes: ["NO_APPROVED_VALIDATION_PROFILE"] } };
    expect(getAdmittedChar(glyph)).toBeNull();
  });
  it("exposes only explicitly eligible or human asserted chars", () => {
    expect(getAdmittedChar({ admissionDecision: { state: "ELIGIBLE_WITH_PROVENANCE", admittedChar: "S" } })).toBe("S");
    expect(getAdmittedChar({ admissionDecision: { state: "HUMAN_ASSERTED", admittedChar: "s" } })).toBe("s");
  });
  it("fails closed when the decision is absent", () => expect(getLayer1Admission({}).state).toBe("OBSERVE_ONLY"));
});
