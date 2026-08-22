import { describe, expect, it } from "vitest";
import { compareGlyphChar, compareGlyphVisualEvidence, finalPredictionCharacter } from "./glyphCharComparison.js";
import { deriveGlyphCharCounters, glyphResultState } from "./glyphCharCounters.js";

const visualPrediction = (value = "a", status = "predicted", confidence = 0.94) => ({
  predictedChar: value,
  predictedChars: value == null ? [] : [value],
  confidence,
  candidates: value == null ? [] : [{ value, confidence }],
  recognizer: "visual-fixture",
  status,
});

describe("independent Vector/Raster/Given evidence", () => {
  it("keeps both visual predictions unchanged when Given Char changes", () => {
    const vector = Object.freeze(visualPrediction("a"));
    const raster = Object.freeze(visualPrediction("a"));
    expect(compareGlyphVisualEvidence({ givenChar: "a", vectorPrediction: vector, rasterPrediction: raster })).toBe("FULL_AGREEMENT");
    expect(compareGlyphVisualEvidence({ givenChar: "x", vectorPrediction: vector, rasterPrediction: raster })).toBe("PDF_MAPPING_DISAGREEMENT");
    expect(vector.predictedChar).toBe("a");
    expect(raster.predictedChar).toBe("a");
  });

  it("preserves Vector/Raster disagreement", () => {
    expect(compareGlyphVisualEvidence({ givenChar: "a", vectorPrediction: visualPrediction("a"), rasterPrediction: visualPrediction("b") })).toBe("VECTOR_RASTER_DISAGREEMENT");
  });
});

describe("Layer 1 glyph/Char comparison", () => {
  it("classifies agreement", () => {
    expect(compareGlyphChar({ givenChars: ["a"], prediction: visualPrediction("a"), visible: true })).toBe("MATCH");
  });

  it("classifies disagreement", () => {
    expect(compareGlyphChar({ givenChars: ["x"], prediction: visualPrediction("a"), visible: true })).toBe("DISAGREEMENT");
  });

  it("classifies a missing Given Char", () => {
    expect(compareGlyphChar({ givenChars: [], prediction: visualPrediction("a"), visible: true })).toBe("NO_GIVEN_CHAR");
  });

  it("preserves source-space evidence without inventing a visible glyph", () => {
    expect(compareGlyphChar({ givenChars: [" "], prediction: null, visible: false })).toBe("NO_VISIBLE_GLYPH");
  });

  it("classifies close visual candidates as ambiguous", () => {
    expect(compareGlyphChar({ givenChars: ["l"], prediction: visualPrediction("l", "ambiguous", 0.51), visible: true })).toBe("AMBIGUOUS");
  });

  it("proves prediction is independent from Given Char", () => {
    const visual = Object.freeze(visualPrediction("a"));
    expect(compareGlyphChar({ givenChars: ["a"], prediction: visual, visible: true })).toBe("MATCH");
    expect(compareGlyphChar({ givenChars: ["x"], prediction: visual, visible: true })).toBe("DISAGREEMENT");
    expect(visual.predictedChar).toBe("a");
  });

  it("does not promote a rejected closed-set candidate to a final character", () => {
    const glyph = {
      visible: true,
      analysisStatus: "studied",
      given: { value: "D", values: ["D"] },
      prediction: { status: "unpredictable", closedSetTopCandidate: "!", modelScore: 0.05, predictedChar: null },
      visualEvidence: { raster: { prediction: { status: "unpredictable", closedSetTopCandidate: "!", modelScore: 0.05, predictedChar: null } }, vector: { prediction: { status: "unavailable" } } },
      admissionDecision: { state: "OBSERVE_ONLY" },
    };
    expect(finalPredictionCharacter(glyph.prediction)).toBeNull();
    expect(glyphResultState(glyph)).toBe("UNPREDICTABLE");
    const counts = deriveGlyphCharCounters([glyph]);
    expect(counts.instances.studied).toBe(1);
    expect(counts.raster.unpredictable).toBe(1);
    expect(counts.evidenceComparison.unresolved).toBe(1);
    expect(counts.evidenceComparison.pdfMappingDisagreement).toBe(0);
    expect(counts.admission.OBSERVE_ONLY).toBe(1);
  });

  it("accounts for non-row invisible instances explicitly", () => {
    const visible = { visible: true, analysisStatus: "studied", given: { value: "A", values: ["A"] }, prediction: visualPrediction("A") };
    const invisible = { visible: false, analysisStatus: "studied", given: { value: " ", values: [" "] }, prediction: null };
    const counts = deriveGlyphCharCounters([visible, invisible]);
    expect(counts.instances).toEqual({ total: 2, studied: 2 });
    expect(counts.evidenceComparison.noVisibleGlyph).toBe(1);
  });
});
