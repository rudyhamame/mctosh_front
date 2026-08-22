import { describe, expect, it } from "vitest";
import { searchWordformChars } from "./pdfWordformSearch.js";

const search = (source, query) => searchWordformChars(
  Array.from(source).map((value, index) => ({ id: `c${index}`, itemIndex: 0, charIndex: index, value, comparisonValue: value.toLocaleLowerCase() })),
  query,
  1,
);

describe("PDF Reader Wordform Search", () => {
  it.each([
    ["heart", "heart", "EXACT_CHAR_MATCH"],
    ["heart", "Heart", "EXACT_CHAR_MATCH"],
    ["HEART", "heart", "EXACT_CHAR_MATCH"],
    ["he art", "heart", "SPACE_TOLERANT_MATCH"],
    ["h e a r t", "heart", "SPACE_TOLERANT_MATCH"],
    ["he  art", "heart", "SPACE_TOLERANT_MATCH"],
    ["(he art)", "heart", "SPACE_TOLERANT_MATCH"],
    ["\"heart.\"", "heart", "EXACT_CHAR_MATCH"],
  ])("matches %j with %j", (source, query, matchType) => {
    expect(search(source, query)[0]).toEqual(expect.objectContaining({ matchType }));
  });

  it.each(["hearty", "xheart", "heartx", "tarhe artam", "heXart", "he X art", "he9art"])("rejects %j", (source) => {
    expect(search(source, "heart")).toHaveLength(0);
  });

  it("returns traceable matched and skipped source character IDs", () => {
    const result = search("he art", "heart")[0];
    expect(result.matchedSourceCharIds).toHaveLength(5);
    expect(result.skippedSpaceCharIds).toEqual(["c2"]);
    expect(result.provenance).toEqual({ sourceCharOrderPreserved: true, glyphComparisonUsed: false });
  });
});

