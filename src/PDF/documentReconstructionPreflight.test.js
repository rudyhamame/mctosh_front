import { describe, expect, it } from "vitest";
import { chooseReconstructionMode, estimateDocumentComplexity, selectPreflightPageNumbers } from "./documentReconstructionPreflight.js";

describe("document reconstruction preflight", () => {
  it("samples the beginning, middle and end without duplicate pages", () => {
    expect(selectPreflightPageNumbers(1000, 5)).toEqual([1, 251, 501, 750, 1000]);
    expect(selectPreflightPageNumbers(2, 5)).toEqual([1, 2]);
  });

  it("routes estimated large source-backed documents to the backend", () => {
    const estimate = estimateDocumentComplexity({ pageCount: 1000, samples: [{ characters: 1800, items: 220 }, { characters: 2200, items: 280 }] });
    expect(estimate).toEqual(expect.objectContaining({ estimatedCharacters: 2000000, estimatedItems: 250000 }));
    expect(chooseReconstructionMode({ estimate, sourceBacked: true }).mode).toBe("backend");
    expect(chooseReconstructionMode({ estimate, sourceBacked: false }).mode).toBe("browser-partial");
  });

  it("keeps small documents in browser mode", () => {
    const estimate = estimateDocumentComplexity({ pageCount: 20, samples: [{ characters: 1000, items: 100 }] });
    expect(chooseReconstructionMode({ estimate, sourceBacked: true }).mode).toBe("browser");
  });
});
