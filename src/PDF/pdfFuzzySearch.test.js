import { describe, expect, it } from "vitest";
import { buildPageIndex } from "./pdfSearchIndex.js";
import {
  searchPageForQuery,
  normalizeQuery,
  weightedEditDistance,
  hasCriticalPrefixConflict,
  hasNegationConflict,
} from "./pdfFuzzySearch.js";

// Builds fake PDF.js text items from a list of strings, one per item —
// mirrors how a distorted PDF actually reports fragmented text (each
// fragment is its own content.items entry, not literal whitespace inside
// one string). `eolAt` marks item indexes whose item ends a real line
// (PDF.js's own item.hasEOL), used for the hyphenation test cases.
// `transform` positions items left-to-right on one line (zero gap between
// consecutive items) — reading order is now geometry-based
// (pdfPageLayout.js), so fake items need real positions, not just text.
const mkItems = (strs, eolAt = []) => {
  let cursorX = 0;
  const fontSize = 12;
  return strs.map((s, i) => {
    const width = s.length * 6;
    const it = { str: s, width, hasEOL: eolAt.includes(i), transform: [fontSize, 0, 0, fontSize, cursorX, 0] };
    cursorX += width;
    return it;
  });
};

const searchOnce = (pdfWords, query, eolAt = []) => {
  const idx = buildPageIndex(1, mkItems(pdfWords, eolAt));
  const q = normalizeQuery(query);
  return searchPageForQuery(idx, q, {});
};

describe("pdfFuzzySearch — spec section 47 positive cases", () => {
  it("myoc ardial infar ction -> myocardial infarction", () => {
    const r = searchOnce(["myoc", "ardial", "infar", "ction"], "myocardial infarction");
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].originalMatchedText).toBe("myoc ardial infar ction");
  });

  it("cardio-\\nvascular -> cardiovascular", () => {
    const r = searchOnce(["cardio-", "vascular"], "cardiovascular", [0]);
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].originalMatchedText).toBe("cardio-\nvascular");
  });

  it("heart   failure -> heart failure (single item, literal extra spaces)", () => {
    const r = searchOnce(["heart   failure"], "heart failure");
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].matchType).toBe("exact");
  });

  it("ﬁbrillation -> fibrillation", () => {
    const r = searchOnce(["ﬁbrillation"], "fibrillation");
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].matchType).toBe("exact");
  });

  it("sympathomi metics -> sympathomimetics", () => {
    const r = searchOnce(["sympathomi", "metics"], "sympathomimetics");
    expect(r.length).toBeGreaterThan(0);
  });

  it("bRaDyCaRdIa -> bradycardia (case-insensitive)", () => {
    const r = searchOnce(["bRaDyCaRdIa"], "bradycardia");
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].matchType).toBe("case_insensitive");
  });

  it("BRADYCARDIA -> bradycardia (case-insensitive)", () => {
    const r = searchOnce(["BRADYCARDIA"], "bradycardia");
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].matchType).toBe("case_insensitive");
  });

  it("Heart Fail ure with Preserved Eject ion Fraction -> full phrase, in order", () => {
    const r = searchOnce(
      ["Heart", "Fail", "ure", "with", "Preserved", "Eject", "ion", "Fraction"],
      "heart failure with preserved ejection fraction",
    );
    expect(r.length).toBeGreaterThan(0);
  });

  it("β-blocker -> beta blocker (scientific alias)", () => {
    const r = searchOnce(["β-blocker"], "beta blocker");
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].matchType).toBe("alias");
  });

  it("Ca²⁺ -> Ca2+ (NFKC scientific normalization)", () => {
    const r = searchOnce(["Ca²⁺"], "Ca2+");
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].matchType).toBe("exact");
  });

  it("Bradi DycaR dia -> bradycardia (probable fuzzy match, heavily distorted)", () => {
    const r = searchOnce(["Bradi", "DycaR", "dia"], "bradycardia");
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].matchType).toBe("fuzzy");
    expect(r[0].confidence).toBeGreaterThanOrEqual(0.75);
    expect(r[0].originalMatchedText).toBe("Bradi DycaR dia");
  });

  it("acute myocardial infarction involving the anterior wall -> partial phrase 'myocardial infarction'", () => {
    const r = searchOnce(
      ["acute", "myocardial", "infarction", "involving", "the", "anterior", "wall"],
      "myocardial infarction",
    );
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].originalMatchedText).toBe("myocardial infarction");
  });
});

describe("pdfFuzzySearch — spec section 48 negative cases (no false positives)", () => {
  it("tachycardia does NOT match query bradycardia", () => {
    expect(searchOnce(["tachycardia"], "bradycardia")).toHaveLength(0);
  });

  it("myocarditis does NOT strongly match query myocardial infarction", () => {
    expect(searchOnce(["myocarditis"], "myocardial infarction")).toHaveLength(0);
  });

  it("heart rate does NOT match query heart failure", () => {
    expect(searchOnce(["heart", "rate"], "heart failure")).toHaveLength(0);
  });

  it("hyperkalemia does NOT match query hypokalemia (critical prefix pair)", () => {
    expect(searchOnce(["hyperkalemia"], "hypokalemia")).toHaveLength(0);
  });
});

describe("pdfFuzzySearch — prefix and negation guardrails", () => {
  it("flags brady/tachy as a critical prefix conflict", () => {
    expect(hasCriticalPrefixConflict("bradycardia", "tachycardia")).toBe(true);
    expect(hasCriticalPrefixConflict("bradycardia", "bradyarrhythmia")).toBe(false);
  });

  it("flags a negation-word mismatch between query and candidate tokens", () => {
    expect(hasNegationConflict(["no", "murmur"], ["murmur", "present"])).toBe(true);
    expect(hasNegationConflict(["murmur", "present"], ["murmur", "present"])).toBe(false);
  });
});

describe("pdfFuzzySearch — weightedEditDistance OCR-confusion tolerance", () => {
  it("costs less for a known OCR-confusable substitution than an unrelated one", () => {
    const ocrDistance = weightedEditDistance("l", "1"); // classic OCR confusion
    const plainDistance = weightedEditDistance("l", "q"); // unrelated substitution
    expect(ocrDistance).toBeLessThan(plainDistance);
  });

  it("folds rn/m for comparison (bridge, not a literal replacement of stored text)", () => {
    // "rn" visually resembles "m" in some corrupted extractions — "member"
    // contains no "rn" itself, so this isolates the fold from any
    // incidental "rn" substring the real word might otherwise contain.
    const distance = weightedEditDistance("member", "rnember");
    expect(distance).toBe(0); // canonicalized to the same string for comparison purposes
  });
});

describe("pdfFuzzySearch — result mapping stays anchored to the real original text", () => {
  it("never claims the PDF literally contains the query — only maps back to the real distorted text", () => {
    const r = searchOnce(["Bradi", "DycaR", "dia"], "bradycardia");
    expect(r[0].originalMatchedText).not.toBe("bradycardia");
    expect(r[0].originalMatchedText).toBe("Bradi DycaR dia");
  });

  it("resolves itemIndexes so the highlighter can find every PDF.js text item behind the match", () => {
    const r = searchOnce(["myoc", "ardial", "infar", "ction"], "myocardial infarction");
    expect(r[0].itemIndexes).toEqual([0, 1, 2, 3]);
  });

  it("resolves itemRanges to just the matched substring's own span within a longer single item", () => {
    // "heart" is only the first 5 of this item's 13 characters ("heart failure") —
    // the highlighter should be told to draw a rect over those 5 characters,
    // not the whole item's width.
    const r = searchOnce(["heart failure"], "heart");
    expect(r[0].itemIndexes).toEqual([0]);
    expect(r[0].itemRanges).toEqual([{ itemIndex: 0, localStart: 0, localEnd: 5, itemLength: 13 }]);
  });

  it("resolves itemRanges per-item when a match spans multiple items, not just the outer item indexes", () => {
    const r = searchOnce(["myoc", "ardial", "infar", "ction"], "myocardial infarction");
    expect(r[0].itemRanges).toEqual([
      { itemIndex: 0, localStart: 0, localEnd: 4, itemLength: 4 },
      { itemIndex: 1, localStart: 0, localEnd: 6, itemLength: 6 },
      { itemIndex: 2, localStart: 0, localEnd: 5, itemLength: 5 },
      { itemIndex: 3, localStart: 0, localEnd: 5, itemLength: 5 },
    ]);
  });
});
