import { describe, expect, it } from "vitest";
import { applyOcrTokenCasing, buildTextCorrectionAudit, capitalizeSentenceStarts, correctBBoxText, isProtectedMedicalToken, normalizeForComparison } from "./bboxTextCorrection.js";

describe("BBox OCR text correction", () => {
  it("uses OCR casing without changing protected medical abbreviations", async () => {
    const result = await correctBBoxText({
      rawPdfText: "tHe ECG Shows a QRS complex",
      bboxPdf: { x: 0, y: 0, width: 100, height: 20 },
      ocrPage: { markdown: "The Ecg shows a Qrs complex" },
    });
    expect(result.correctedText).toBe("the ECG shows a QRS complex");
    expect(result.correctionSource).toBe("ocr_alignment");
    expect(result.rawText).toBe("tHe ECG Shows a QRS complex");
  });

  it("keeps raw text when OCR is unrelated", async () => {
    const result = await correctBBoxText({ rawPdfText: "Sinus rhythm", ocrPage: { markdown: "Renal physiology" } });
    expect(result.correctedText).toBe("sinus rhythm");
    expect(result.ocrCandidateText).toBe("Renal physiology");
    expect(result.correctionSource).toBe("pdf_text_layer");
    expect(result.correctionConfidence).toBeLessThan(0.7);
  });

  it("recognizes structural medical and scientific tokens", () => {
    expect(isProtectedMedicalToken("NSTEMI")).toBe(true);
    expect(isProtectedMedicalToken("HbA1c")).toBe(true);
    expect(isProtectedMedicalToken("PaCO₂")).toBe(true);
    expect(normalizeForComparison("Rate—Rhythm")).toBe("rate-rhythm");
  });

  it("aligns a BBox to its token window inside one large OCR table block", async () => {
    const result = await correctBBoxText({
      rawPdfText: "Arrhythmias 25 Bradyarrhythmias and ConduCtion aBnormalities 25 taChyarrhythmias 25",
      bboxPdf: { x: 10, y: 10, width: 120, height: 30 },
      ocrPage: {
        markdown: "",
        lines: [{
          text: "Electrocardiogram 18 Cardiac Physical Exam 22 Arrhythmias 25 BRADYARRHYTHMIAS AND CONDUCTION ABNORMALITIES 25 TACHYARRHYTHMIAS 25 Cardiac Life Support Basics 34 Congestive Heart Failure 34",
          bbox: { x: 0, y: 0, width: 160, height: 80 },
        }],
      },
    });
    expect(result.correctionSource).toBe("ocr_alignment");
    expect(result.correctedText).toBe("arrhythmias 25 bradyarrhythmias and conduction abnormalities 25 tachyarrhythmias 25");
    expect(result.correctionConfidence).toBeGreaterThanOrEqual(0.7);
  });

  it("projects corrected parent casing onto raw partition fragments", () => {
    expect(applyOcrTokenCasing(
      "heart failure with reduCed ejeCtion fraCtion",
      "HEART FAILURE WITH REDUCED EJECTION FRACTION",
    )).toBe("heart failure with reduced ejection fraction");
  });

  it("restores OCR-confirmed words split by stray spaces", () => {
    expect(applyOcrTokenCasing(
      "p ericardial effusion and eje ction fraction",
      "Pericardial effusion and ejection fraction",
    )).toBe("pericardial effusion and ejection fraction");
  });

  it("does not join legitimate adjacent words absent from the OCR reference", () => {
    expect(applyOcrTokenCasing(
      "a normal pericardial examination",
      "A normal pericardial examination",
    )).toBe("a normal pericardial examination");
  });

  it("accounts for every token and records joined OCR fragments", () => {
    const audit = buildTextCorrectionAudit("p ericardial eje ction", "pericardial ejection");
    expect(audit.entries.map((entry) => entry.status)).toEqual(["joined", "joined"]);
    expect(audit.summary.accountedRawTokenCount).toBe(4);
    expect(audit.summary.accountedCorrectedTokenCount).toBe(2);
    expect(audit.summary.silentOmissionCount).toBe(0);
    expect(audit.summary.verified).toBe(true);
  });

  it("surfaces inserted, deleted, and uncertain tokens for review", () => {
    const audit = buildTextCorrectionAudit("alpha removed mismatch", "alpha added different extra");
    expect(audit.summary.accountedRawTokenCount).toBe(3);
    expect(audit.summary.accountedCorrectedTokenCount).toBe(4);
    expect(audit.summary.unresolvedCount).toBeGreaterThan(0);
    expect(audit.summary.silentOmissionCount).toBe(0);
    expect(audit.summary.verified).toBe(false);
  });

  it("uses the complete OCR candidate and keeps body words natural-cased", async () => {
    const result = await correctBBoxText({
      rawPdfText: "The patient has ejeCtion fraCtion.",
      bboxPdf: { x: 0, y: 0, width: 100, height: 20 },
      ocrPage: { markdown: "THE PATIENT HAS EJECTION FRACTION." },
    });
    expect(result.correctedText).toBe("the patient has ejection fraction.");
  });

  it("lowercases ordinary words without changing abbreviations", () => {
    expect(capitalizeSentenceStarts("the first sentence. the second sentence has ECG."))
      .toBe("the first sentence. the second sentence has ECG.");
  });
});
