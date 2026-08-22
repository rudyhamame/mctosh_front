import { describe, expect, it } from "vitest";
import { buildParagraphMergePlan } from "./pdfParagraphMerge.js";

describe("paragraph BBox merging", () => {
  it("merges lines in PDF reading order rather than JSON or selection order", () => {
    const lower = { id: "lower", x: 10, y: 100 };
    const higher = { id: "higher", x: 10, y: 20 };
    const plan = buildParagraphMergePlan([
      { paragraph: lower, readingOrder: 8, inputOrder: 0, lines: ["lower one", "lower two"] },
      { paragraph: higher, readingOrder: 2, inputOrder: 1, lines: ["higher one", "higher two"] },
    ]);

    expect(plan.orderedRecords.map((record) => record.paragraph.id)).toEqual(["higher", "lower"]);
    expect(plan.mergedLines).toEqual(["higher one", "higher two", "lower one", "lower two"]);
    expect(plan.survivor.id).toBe("lower");
  });

  it("uses page geometry when live PDF reading-order spans are unavailable", () => {
    const plan = buildParagraphMergePlan([
      { paragraph: { id: "second", x: 20, y: 80 }, inputOrder: 0, lines: ["second"] },
      { paragraph: { id: "first", x: 20, y: 30 }, inputOrder: 1, lines: ["first"] },
    ]);

    expect(plan.mergedLines).toEqual(["first", "second"]);
    expect(plan.survivor.id).toBe("second");
  });
});
