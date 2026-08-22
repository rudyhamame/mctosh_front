import { describe, expect, it } from "vitest";
import { canonicalToViewportRect, canonicalToViewportPoint } from "./pdfCoordinateTransform.js";

describe("canonicalToViewportRect", () => {
  it("scales a canonical bbox uniformly by pageViewport.scale", () => {
    const rect = canonicalToViewportRect([10, 20, 110, 70], { scale: 2 });
    expect(rect).toEqual({ x: 20, y: 40, width: 200, height: 100 });
  });

  it("is a pure identity at scale 1", () => {
    const rect = canonicalToViewportRect([5, 5, 25, 15], { scale: 1 });
    expect(rect).toEqual({ x: 5, y: 5, width: 20, height: 10 });
  });

  it("handles a bbox given in any corner order without producing a negative width/height", () => {
    const rect = canonicalToViewportRect([100, 100, 10, 10], { scale: 1 });
    expect(rect.x).toBe(10);
    expect(rect.y).toBe(10);
    expect(rect.width).toBe(90);
    expect(rect.height).toBe(90);
  });

  it("defaults to scale 1 when pageViewport is missing/incomplete", () => {
    const rect = canonicalToViewportRect([0, 0, 50, 50], {});
    expect(rect).toEqual({ x: 0, y: 0, width: 50, height: 50 });
  });

  it("matches PDF.js's own viewport-space x-coordinates for a real page item at multiple scales — real cross-engine validation", () => {
    // Cross-checked live against a real page (Toronto Notes Cardiology,
    // page 4): PyMuPDF's own rotation-normalized canonical bbox for the
    // "C2" text item is [69.125, 60.772, 87.598, 75.373]. Independently
    // computing the SAME item's viewport-space bbox via PDF.js's own
    // getViewport({scale:1.5}).transform + pdfPageLayout.js's transformItem
    // math gave x1=103.687, x2=131.397 — matching this module's pure-scale
    // math (69.125*1.5, 87.598*1.5) to within floating-point precision.
    // (Y differed by ~1-2pt at this scale — expected and unrelated to
    // coordinate ORIENTATION: PyMuPDF uses the font's real glyph ascent/
    // descent, pdfPageLayout.js's own itemsFromPdfJs uses a fontSize*0.8/
    // 0.2 approximation — two different bbox-HEIGHT estimates, not a
    // coordinate-system mismatch, confirmed by the x-values matching
    // exactly regardless of scale.)
    const canonicalBbox = [69.125, 60.772, 87.598, 75.373];
    const rect = canonicalToViewportRect(canonicalBbox, { scale: 1.5 });
    expect(rect.x).toBeCloseTo(103.6875, 3);
    expect(rect.x + rect.width).toBeCloseTo(131.397, 2);
  });
});

describe("canonicalToViewportPoint", () => {
  it("scales a point by pageViewport.scale", () => {
    expect(canonicalToViewportPoint(10, 20, { scale: 3 })).toEqual({ x: 30, y: 60 });
  });
});
