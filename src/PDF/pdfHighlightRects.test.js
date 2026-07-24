import { describe, expect, it } from "vitest";
import { computeHighlightRectsForItemIndexes, computeHighlightRectsForCanonicalBboxes } from "./pdfHighlightRects.js";

// Identity viewport transform keeps the on-screen math equal to the raw
// item transform, so expected rects can be worked out by hand.
const IDENTITY_VT = [1, 0, 0, 1, 0, 0];

const item = (str, width, x, y, fontSize = 12) => ({
  str, width, transform: [fontSize, 0, 0, fontSize, x, y],
});

describe("computeHighlightRectsForItemIndexes — whole-item behavior (no itemRanges)", () => {
  it("covers the item's full width when no itemRanges are given", () => {
    const items = [item("heart failure", 100, 50, 200)];
    const [rect] = computeHighlightRectsForItemIndexes([0], items, IDENTITY_VT);
    expect(rect.x).toBe(50);
    expect(rect.width).toBe(100);
  });
});

describe("computeHighlightRectsForItemIndexes — substring-only highlighting (itemRanges)", () => {
  it("clips the rect to just the matched substring's own share of the item's width", () => {
    const items = [item("heart failure", 130, 50, 200)]; // 13 chars, 10px/char
    const itemRanges = [{ itemIndex: 0, localStart: 0, localEnd: 5, itemLength: 13 }]; // "heart"
    const [rect] = computeHighlightRectsForItemIndexes([0], items, IDENTITY_VT, itemRanges);
    expect(rect.x).toBe(50); // starts at the item's left edge
    expect(rect.width).toBeCloseTo((5 / 13) * 130, 5); // ~50, not the full 130
  });

  it("offsets the rect's start when the match begins partway through the item", () => {
    const items = [item("heart failure", 130, 50, 200)];
    const itemRanges = [{ itemIndex: 0, localStart: 6, localEnd: 13, itemLength: 13 }]; // "failure"
    const [rect] = computeHighlightRectsForItemIndexes([0], items, IDENTITY_VT, itemRanges);
    expect(rect.x).toBeCloseTo(50 + (6 / 13) * 130, 5);
    expect(rect.width).toBeCloseTo((7 / 13) * 130, 5);
  });

  it("falls back to the item's full width when itemRanges has no entry for that item", () => {
    const items = [item("heart failure", 100, 50, 200)];
    const [rect] = computeHighlightRectsForItemIndexes([0], items, IDENTITY_VT, []);
    expect(rect.x).toBe(50);
    expect(rect.width).toBe(100);
  });

  it("applies each item's own range independently across a multi-item match", () => {
    const items = [item("myoc", 40, 0, 0), item("ardial", 60, 40, 0)];
    const itemRanges = [
      { itemIndex: 0, localStart: 0, localEnd: 4, itemLength: 4 }, // whole first item
      { itemIndex: 1, localStart: 0, localEnd: 3, itemLength: 6 }, // "ard" only
    ];
    const rects = computeHighlightRectsForItemIndexes([0, 1], items, IDENTITY_VT, itemRanges);
    expect(rects[0].x).toBe(0);
    expect(rects[0].width).toBe(40);
    expect(rects[1].x).toBe(40);
    expect(rects[1].width).toBeCloseTo(30, 5); // half of the 60-wide item
  });
});

describe("computeHighlightRectsForCanonicalBboxes", () => {
  it("computes one rect per canonical bbox, scaled by pageViewport.scale", () => {
    const rects = computeHighlightRectsForCanonicalBboxes([[10, 20, 60, 40], [0, 0, 5, 5]], { scale: 2 });
    expect(rects).toHaveLength(2);
    expect(rects[0]).toEqual({ x: 20, y: 40, width: 100, height: 40 });
    expect(rects[1]).toEqual({ x: 0, y: 0, width: 10, height: 10 });
  });

  it("returns an empty array when given no bboxes or no viewport", () => {
    expect(computeHighlightRectsForCanonicalBboxes([], { scale: 1 })).toEqual([]);
    expect(computeHighlightRectsForCanonicalBboxes([[0, 0, 1, 1]], null)).toEqual([]);
  });
});
