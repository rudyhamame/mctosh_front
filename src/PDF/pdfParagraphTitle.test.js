import { describe, expect, it } from "vitest";
import { removeParagraphTitleFromText, removeParagraphTitleLine } from "./pdfParagraphTitle.js";

describe("paragraph title separation", () => {
  it("removes the matching title line while preserving body line order", () => {
    const result = removeParagraphTitleLine(
      ["Pericardial Disease", "Acute pericarditis", "Pericardial effusion"],
      "pericardial disease",
    );
    expect(result.removedLine).toBe("Pericardial Disease");
    expect(result.bodyLines).toEqual(["Acute pericarditis", "Pericardial effusion"]);
  });

  it("does not remove a body line that only partially matches the title", () => {
    const result = removeParagraphTitleLine(["Pericardial disease may recur"], "Pericardial Disease");
    expect(result.removedLine).toBe("");
    expect(result.bodyLines).toEqual(["Pericardial disease may recur"]);
  });

  it("removes a title prefix when corrected text has no line boundaries", () => {
    expect(removeParagraphTitleFromText("Pericardial Disease: acute pericarditis", "Pericardial Disease"))
      .toBe("acute pericarditis");
  });
});
