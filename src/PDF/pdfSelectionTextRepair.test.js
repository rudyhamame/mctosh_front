import { describe, expect, it } from "vitest";
import { buildPdfSelectionTextRepairs } from "./pdfSelectionTextRepair.js";

const token = (text, left, right, top = 10, bottom = 20) => ({
  text, pageLeft: left, pageRight: right, pageTop: top, pageBottom: bottom,
});

describe("buildPdfSelectionTextRepairs", () => {
  it("removes synthetic spaces inside one PyMuPDF word", () => {
    const tokens = [
      token("h", 10, 14), token(" ", 14, 16), token("e", 16, 20),
      token(" ", 20, 22), token("a", 22, 26), token(" ", 26, 28),
      token("r", 28, 32), token(" ", 32, 34), token("t", 34, 38),
    ];
    const repairs = buildPdfSelectionTextRepairs(tokens, [{ id: "heart", text: "heart", bbox: [9, 9, 39, 21] }]);
    expect(tokens.map((_, index) => repairs.get(index)?.selectionText ?? tokens[index].text).join("")).toBe("heart");
    expect(new Set([...repairs.values()].map((entry) => entry.groupId)).size).toBe(1);
  });

  it("does not remove a genuine boundary between two words", () => {
    const tokens = [token("heart", 10, 30), token(" ", 30, 35), token("failure", 35, 65)];
    const repairs = buildPdfSelectionTextRepairs(tokens, [
      { id: "heart", text: "heart", bbox: [9, 9, 31, 21] },
      { id: "failure", text: "failure", bbox: [34, 9, 66, 21] },
    ]);
    expect(tokens.map((entry, index) => repairs.get(index)?.selectionText ?? entry.text).join("")).toBe("heart failure");
  });

  it("rejects PyMuPDF text whose non-whitespace characters differ", () => {
    const tokens = [token("h e a t", 10, 38)];
    const repairs = buildPdfSelectionTextRepairs(tokens, [{ text: "heart", bbox: [9, 9, 39, 21] }]);
    expect(repairs.size).toBe(0);
  });
});
