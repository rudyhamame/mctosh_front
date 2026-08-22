import { describe, expect, it } from "vitest";
import { classifyGlyphComparison, compareGlyphMasks } from "./glyphForensics.js";

const image = (rows) => {
  const height = rows.length; const width = rows[0].length; const data = new Uint8ClampedArray(width * height * 4);
  rows.forEach((row, y) => [...row].forEach((cell, x) => { const offset = (y * width + x) * 4; const value = cell === "#" ? 0 : 255; data[offset] = value; data[offset + 1] = value; data[offset + 2] = value; data[offset + 3] = 255; }));
  return { data, width, height };
};

const H = image(["#...#", "#...#", "#####", "#...#", "#...#"]);
const malformed = image(["#####", "....#", "...#.", "..#..", ".#..."]);

describe("glyph forensics", () => {
  it("produces deterministic high similarity for identical masks", () => {
    const comparison = compareGlyphMasks(H, H);
    expect(comparison.score).toBe(1);
    expect(classifyGlyphComparison(comparison, "source-font").status).toBe("normal");
  });

  it("separates same-font malformation from fallback-font uncertainty", () => {
    const comparison = compareGlyphMasks(H, malformed);
    expect(classifyGlyphComparison(comparison, "source-font").status).toMatch(/malformed/);
    expect(classifyGlyphComparison({ ...comparison, score: 0.4 }, "fallback").status).toBe("comparison-inconclusive");
  });
});
