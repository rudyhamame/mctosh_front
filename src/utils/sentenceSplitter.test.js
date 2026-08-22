import { describe, expect, it } from "vitest";
import { splitParagraphIntoSentences } from "./sentenceSplitter";

describe("splitParagraphIntoSentences", () => {
  it("returns ordered complete sentence units without using an AI service", () => {
    expect(splitParagraphIntoSentences("Dr. Smith reviewed Fig. 2. The heart has four chambers!"))
      .toEqual(["Dr. Smith reviewed Fig. 2.", "The heart has four chambers!"]);
  });

  it("handles decimals and empty input", () => {
    expect(splitParagraphIntoSentences("The dose was 2.5 mg. It was repeated."))
      .toEqual(["The dose was 2.5 mg.", "It was repeated."]);
    expect(splitParagraphIntoSentences("  ")).toEqual([]);
    expect(splitParagraphIntoSentences(null)).toEqual([]);
  });
});
