import { describe, expect, it, vi } from "vitest";
import { createGlyphPredictionCache } from "./glyphPredictionCache.js";

describe("glyph definition prediction cache", () => {
  it("analyzes one stable definition once for hundreds of instances", async () => {
    const cache = createGlyphPredictionCache();
    const recognize = vi.fn(async () => ({ predictedChar: "a" }));
    const results = await Promise.all(Array.from({ length: 300 }, () => cache.getOrCreate("F3:27", recognize)));
    expect(recognize).toHaveBeenCalledTimes(1);
    expect(results.every((result) => result.predictedChar === "a")).toBe(true);
    expect(cache.diagnostics()).toEqual({ definitions: 1, hits: 299, misses: 1 });
  });
});

