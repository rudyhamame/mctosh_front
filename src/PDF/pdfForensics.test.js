import { describe, expect, it } from "vitest";
import { buildPdfForensicReport } from "./pdfForensics.js";

const character = (c, x0, x1) => ({ c, bbox: [x0, 10, x1, 20], origin: [x0, 19] });

describe("PDF forensic evidence reconciliation", () => {
  it("preserves an explicit space without turning OCR into authority", () => {
    const report = buildPdfForensicReport({
      pageNumber: 1,
      nativeExtraction: { native: { spans: [{ lineId: "l1", fontName: "F1", fontSize: 10, chars: [
        character("A", 0, 5), character(" ", 5, 8), character("B", 8, 13),
      ] }] } },
      pdfJsEvidence: { observedText: "A B", items: [], operators: [], styles: {}, limitations: [] },
      ocrPage: { blocks: [{ text: "AB" }] },
    });
    expect(report.rawCharacterStream.text).toBe("A B");
    expect(report.whitespaceAnalysis[0].classification).toBe("explicit_character_space");
    expect(report.canonicalReconstruction.text).toBe("A B");
    expect(report.canonicalReconstruction.transformations).toEqual([]);
    expect(report.ocrComparison.text).toBe("AB");
  });

  it("classifies a positional gap independently of linguistic meaning", () => {
    const report = buildPdfForensicReport({
      pageNumber: 3,
      nativeExtraction: { native: { spans: [{ lineId: "l1", fontName: "F1", fontSize: 10, chars: [
        character("A", 0, 5), character("R", 11, 16),
      ] }] } },
      pdfJsEvidence: { observedText: "A R", items: [], operators: [], styles: {}, limitations: [] },
      ocrPage: null,
    });
    const gap = report.whitespaceAnalysis.find((entry) => entry.classification === "geometric_space");
    expect(gap).toBeTruthy();
    expect(gap.explicitSpaceCharacter).toBe(false);
    expect(report.rawCharacterStream.text).toBe("AR");
    expect(report.canonicalReconstruction.text).toBe("AR");
    expect(report.discrepancies.some((entry) => entry.type === "EXTRACTED_SPACE_NE_EXPLICIT_SPACE")).toBe(true);
  });

  it("keeps structural boundaries separate from character spaces", () => {
    const report = buildPdfForensicReport({
      pageNumber: 2,
      nativeExtraction: { native: { spans: [
        { lineId: "l1", fontName: "F1", fontSize: 10, chars: [character("A", 0, 5)] },
        { lineId: "l1", fontName: "F2", fontSize: 10, chars: [character("R", 5.2, 10.2)] },
      ] } },
      pdfJsEvidence: { observedText: "AR", items: [], operators: [], styles: {}, limitations: [] },
      ocrPage: null,
    });
    expect(report.whitespaceAnalysis.some((entry) => entry.classification === "structural_discontinuity")).toBe(true);
    expect(report.whitespaceAnalysis.some((entry) => entry.explicitSpaceCharacter)).toBe(false);
  });
});
