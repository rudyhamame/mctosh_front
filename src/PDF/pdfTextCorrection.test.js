import { describe, expect, it } from "vitest";
import { correctSelectedPdfText } from "./pdfTextCorrection.js";

describe("pdfTextCorrection — deterministic + dictionary split-word repair", () => {
  it("repairs multiple split words in one sentence, preserving trailing punctuation", () => {
    const r = correctSelectedPdfText({ selectedText: "The pati ent has myoc ardial infar ction." });
    expect(r.correctedText).toBe("The patient has myocardial infarction.");
    expect(r.changes.map((c) => c.type)).toEqual(["split_word_repair", "split_word_repair", "split_word_repair"]);
    expect(r.uncertain).toBe(false);
  });

  it("never joins two words that are already valid on their own (heart failure stays two words)", () => {
    const r = correctSelectedPdfText({ selectedText: "heart failure" });
    expect(r.correctedText).toBe("heart failure");
    expect(r.changes).toHaveLength(0);
  });

  it("repairs a real line-break hyphen into one word when the joined form is a known word", () => {
    const r = correctSelectedPdfText({ selectedText: "cardio-\nvascular" });
    expect(r.correctedText).toBe("cardiovascular");
    expect(r.changes[0].type).toBe("hyphenation_repair");
    expect(r.uncertain).toBe(false);
  });

  it("keeps the hyphen when the joined form is not a known word (well-controlled)", () => {
    const r = correctSelectedPdfText({ selectedText: "well-\ncontrolled" });
    expect(r.correctedText).toBe("well-controlled");
  });

  it("does not touch a legitimate inline hyphen with no real line break (COVID-19, IL-6)", () => {
    expect(correctSelectedPdfText({ selectedText: "COVID-19" }).correctedText).toBe("COVID-19");
    expect(correctSelectedPdfText({ selectedText: "IL-6" }).correctedText).toBe("IL-6");
  });

  it("does not touch a real line break followed by a non-lowercase continuation (COVID-\\n19)", () => {
    // Hyphen is kept (not a valid dehyphenation target); the line break
    // itself still collapses to a plain space via the general whitespace
    // repair step, same as any other real newline in a selection.
    expect(correctSelectedPdfText({ selectedText: "COVID-\n19" }).correctedText).toBe("COVID- 19");
  });

  it("leaves an already-correct mixed-case abbreviation untouched (HbA1c stays HbA1c, not hba1c)", () => {
    const r = correctSelectedPdfText({ selectedText: "HbA1c" });
    expect(r.correctedText).toBe("HbA1c");
    expect(r.changes).toHaveLength(0);
  });

  it("does not silently correct a heavily-distorted term — surfaces it as an uncertain candidate instead", () => {
    const r = correctSelectedPdfText({ selectedText: "Bradi DycaR dia" });
    expect(r.correctedText).toBe("Bradi DycaR dia"); // untouched
    expect(r.uncertain).toBe(true);
    expect(r.candidates[0].text).toBe("bradycardia");
  });

  it("expands ligatures", () => {
    const r = correctSelectedPdfText({ selectedText: "ﬁbrillation" });
    expect(r.correctedText).toBe("fibrillation");
  });

  it("leaves unrecognizable gibberish alone rather than guessing", () => {
    const r = correctSelectedPdfText({ selectedText: "zzxq wobblefritz" });
    expect(r.correctedText).toBe("zzxq wobblefritz");
    expect(r.changes).toHaveLength(0);
  });

  it("returns a safe empty result for blank input", () => {
    const r = correctSelectedPdfText({ selectedText: "   " });
    expect(r.correctedText).toBe("");
    expect(r.uncertain).toBe(false);
  });
});
