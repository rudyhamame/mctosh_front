import { describe, expect, it } from "vitest";
import { glyphBoxToViewport } from "./GlyphSelectionOverlay.jsx";

describe("glyph selection overlay geometry", () => {
  it("tracks the same document glyph through zoom", () => {
    const bbox = { x: 10, y: 20, width: 7, height: 12 };
    expect(glyphBoxToViewport(bbox, 1)).toEqual({ left: 10, top: 20, width: 7, height: 12 });
    expect(glyphBoxToViewport(bbox, 2.5)).toEqual({ left: 25, top: 50, width: 17.5, height: 30 });
  });
});

