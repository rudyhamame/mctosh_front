import { describe, expect, it } from "vitest";
import { normalizePdfText } from "./pdfTextNormalizer.js";
import { normalizedRangeToOriginal, compactRangeToOriginal } from "./pdfTextMapping.js";

describe("pdfTextNormalizer", () => {
  it("expands ligatures via NFKC", () => {
    const r = normalizePdfText("ﬁbrillation");
    expect(r.normalizedText).toBe("fibrillation");
    expect(r.compactText).toBe("fibrillation");
  });

  it("collapses whitespace runs (spaces, tabs, newlines) to a single space", () => {
    expect(normalizePdfText("heart   failure").normalizedText).toBe("heart failure");
    expect(normalizePdfText("heart\t\tfailure").normalizedText).toBe("heart failure");
    expect(normalizePdfText("heart\n\nfailure").normalizedText).toBe("heart failure");
  });

  it("strips zero-width characters without leaving a visible space", () => {
    const withZwsp = "heart​failure";
    expect(normalizePdfText(withZwsp).normalizedText).toBe("heartfailure");
  });

  it("folds curly quotes and dashes for search, without touching originalText", () => {
    const r = normalizePdfText("“heart failure” – severe");
    expect(r.originalText).toBe("“heart failure” – severe");
    expect(r.normalizedText).toBe('"heart failure" - severe');
  });

  it("normalizes superscript/subscript scientific notation via NFKC (Ca2+, O2)", () => {
    expect(normalizePdfText("Ca²⁺").normalizedText).toBe("Ca2+");
    expect(normalizePdfText("O₂").normalizedText).toBe("O2");
  });

  it("preserves medically meaningful characters untouched", () => {
    for (const term of ["Na+", "Ca2+", "HbA1c", "IL-6", "HLA-B27", "pH 7.4", "CO2", "TNF-α"]) {
      expect(normalizePdfText(term).normalizedText).toBe(term);
    }
  });

  it("compactText strips whitespace but keeps inline hyphens (well-controlled)", () => {
    const r = normalizePdfText("well-controlled");
    expect(r.compactText).toBe("well-controlled");
  });

  it("compactText dehyphenates only a REAL line-break hyphen followed by lowercase", () => {
    const wrapped = normalizePdfText("cardio-\nvascular");
    expect(wrapped.compactText).toBe("cardiovascular");

    // Same hyphen, but no real newline — an ordinary inline hyphen, not touched.
    const inline = normalizePdfText("cardio- vascular");
    expect(inline.compactText).toBe("cardio-vascular");
  });

  it("does not dehyphenate when the continuation isn't lowercase (COVID-19, IL-6)", () => {
    expect(normalizePdfText("COVID-\n19").compactText).toBe("COVID-19");
    expect(normalizePdfText("IL-\n6").compactText).toBe("IL-6");
  });

  it("normalizedToOriginalMap resolves a normalized range back to the exact original range", () => {
    const r = normalizePdfText("ﬁbrillation");
    // "fi" (normalized 0..2) came from the single ligature char (original 0..1)
    const range = normalizedRangeToOriginal(r.normalizedToOriginalMap, 0, 2);
    expect(r.originalText.slice(range.start, range.end)).toBe("ﬁ");
  });

  it("compactRangeToOriginal chains both maps back to the original text", () => {
    const original = "myoc ardial infar ction";
    const r = normalizePdfText(original);
    const idx = r.compactText.indexOf("myocardialinfarction");
    expect(idx).toBeGreaterThanOrEqual(0);
    const range = compactRangeToOriginal(r, idx, idx + "myocardialinfarction".length);
    expect(original.slice(range.start, range.end)).toBe("myoc ardial infar ction");
  });
});
