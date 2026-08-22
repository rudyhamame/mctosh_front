import { describe, expect, it } from "vitest";
import { buildDocumentForms, buildManualPhysicalBlocks, inferOrdinaryLineSpacingRegime, reconstructPhysicalBlocks } from "./physicalBlockReconstruction.js";

const makeId = (prefix, ...parts) => `${prefix}:${parts.flat().join(":")}`;
const fixture = ({ gaps = [2, 2], columns = ["column-0", "column-0", "column-0"] } = {}) => {
  const texts = ["Alpha.", "Beta.", "Gamma."];
  let top = 10;
  const lines = texts.map((text, index) => {
    const line = { id: `line-${index}`, xStart: columns[index] === "column-0" ? 10 : 220, xEnd: columns[index] === "column-0" ? 110 : 320, yTop: top, yBottom: top + 10, readingOrderIndex: index, columnId: columns[index], textDirection: "ltr", text, fontName: "Fixture", fontSize: 10 };
    top += 10 + (gaps[index] ?? 0);
    return line;
  });
  let canonicalIndex = 0;
  const canonicalText = texts.join("");
  const characters = lines.flatMap((line, lineIndex) => Array.from(texts[lineIndex]).map(() => ({ canonicalIndex: canonicalIndex++, sourceRefs: [{ lineId: line.id, textItemId: `item-${lineIndex}` }] })));
  const physicalPages = [{ pageIndex: 0, width: 600, height: 800, regions: lines.map((line) => ({ id: `region-${line.id}`, readingOrderIndex: line.readingOrderIndex, includeInBodyReadingOrder: true, regionType: "body", lines: [line] })) }];
  return { physicalPages, characters, canonicalText };
};

const lineFixture = (specs) => {
  const lines = specs.map((spec, index) => ({
    id: `line-${index}`,
    xStart: spec.xStart ?? 10,
    xEnd: spec.xEnd ?? 510,
    yTop: spec.yTop,
    yBottom: spec.yBottom,
    readingOrderIndex: index,
    columnId: spec.columnId || "column-0",
    textDirection: spec.textDirection || "ltr",
    orientation: spec.orientation || 0,
    text: spec.text || `Line ${index + 1}`,
    fontName: spec.fontName || "Body",
    fontSize: spec.fontSize || 11,
  }));
  let canonicalIndex = 0;
  const canonicalText = lines.map((line) => line.text).join("");
  const characters = lines.flatMap((line, lineIndex) => Array.from(line.text).map(() => ({ canonicalIndex: canonicalIndex++, sourceRefs: [{ lineId: line.id, textItemId: `item-${lineIndex}` }] })));
  const physicalPages = [{ pageIndex: 0, width: 600, height: 800, regions: lines.map((line) => ({ id: `region-${line.id}`, readingOrderIndex: line.readingOrderIndex, includeInBodyReadingOrder: true, regionType: "body", lines: [line] })) }];
  return { physicalPages, characters, canonicalText };
};

describe("PhysicalBlock reconstruction", () => {
  it("creates a PhysicalBlock only from an explicit user line grouping", () => {
    const lines = [
      { id: "line-a", pageIndex: 0, pageNumber: 1, bbox: { x: 10, y: 10, width: 100, height: 10 }, canonicalSpans: [{ start: 0, end: 5 }], sourceItemIds: ["item-a"] },
      { id: "line-b", pageIndex: 0, pageNumber: 1, bbox: { x: 10, y: 23, width: 100, height: 10 }, canonicalSpans: [{ start: 5, end: 10 }], sourceItemIds: ["item-b"] },
    ];
    expect(buildManualPhysicalBlocks({ documentId: "doc", physicalLines: lines, assignments: [], canonicalText: "abcdefghij", makeId })).toEqual([]);
    const blocks = buildManualPhysicalBlocks({ documentId: "doc", physicalLines: lines, assignments: [{ lineIds: ["line-a", "line-b"] }], canonicalText: "abcdefghij", makeId });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual(expect.objectContaining({ createdBy: "user", source: "manual", lineIds: ["line-a", "line-b"], canonicalText: "abcdefghij" }));
  });

  it("keeps a rectangle-created discourse PhysicalBlock separate from document forms", () => {
    const lines = [
      { id: "line-a", pageIndex: 0, pageNumber: 1, bbox: { x: 10, y: 10, width: 100, height: 10 }, canonicalSpans: [{ start: 0, end: 5 }], sourceItemIds: ["item-a"] },
      { id: "line-b", pageIndex: 0, pageNumber: 1, bbox: { x: 10, y: 23, width: 100, height: 10 }, canonicalSpans: [{ start: 5, end: 10 }], sourceItemIds: ["item-b"] },
    ];
    const assignment = { id: "manual-discourse", kind: "manual-physical-block", createDocumentForm: false, purpose: "unified-discourse-meaning", lineIds: ["line-a", "line-b"] };
    const blocks = buildManualPhysicalBlocks({ documentId: "doc", physicalLines: lines, assignments: [assignment], canonicalText: "abcdefghij", makeId });
    expect(blocks).toEqual([expect.objectContaining({ purpose: "unified-discourse-meaning", lineIds: ["line-a", "line-b"] })]);
    expect(buildDocumentForms({ documentId: "doc", physicalBlocks: blocks, assignments: [assignment], canonicalText: "abcdefghij", makeId })).toEqual([]);
  });
  it("groups a stable normalized line-spacing regime", () => {
    const result = reconstructPhysicalBlocks({ documentId: "doc", ...fixture(), makeId });
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].lineIds).toEqual(["line-0", "line-1", "line-2"]);
    expect(result.blocks[0].canonicalText).toBe("Alpha.Beta.Gamma.");
  });

  it("splits at a spacing-regime discontinuity", () => {
    const result = reconstructPhysicalBlocks({ documentId: "doc", ...fixture({ gaps: [2, 18] }), makeId });
    expect(result.blocks.map((block) => block.lineIds)).toEqual([["line-0", "line-1"], ["line-2"]]);
    expect(result.boundaries.at(-1)).toEqual(expect.objectContaining({ decision: "new-block", evidence: expect.arrayContaining(["inter-block-gap", "ordinary-line-spacing-mismatch"]) }));
  });

  it("splits a large first gap using the spacing context of the page", () => {
    const result = reconstructPhysicalBlocks({ documentId: "doc", ...fixture({ gaps: [18, 2] }), makeId });
    expect(result.blocks.map((block) => block.lineIds)).toEqual([["line-0"], ["line-1", "line-2"]]);
    expect(result.boundaries[0]).toEqual(expect.objectContaining({
      decision: "new-block",
      normalizedGap: 1.8,
      pageMedianNormalizedGap: 0.2,
      evidence: expect.arrayContaining(["ordinary-line-spacing-mismatch"]),
    }));
  });

  it("infers the low dense ordinary regime from a multimodal gap distribution", () => {
    const regime = inferOrdinaryLineSpacingRegime([
      0.27, 0.28, 0.26, 0.27, 0.29,
      1.05, 1.10, 1.12, 1.16, 1.18, 1.22, 1.30, 1.35,
    ].map((normalizedGap) => ({ normalizedGap })));
    expect(regime.baseline).toBeCloseTo(0.27, 2);
    expect(regime.largerGapRegimes.length).toBeGreaterThan(0);
  });

  it("merges the page-17 pair despite contaminated neighboring gaps", () => {
    const input = lineFixture([
      { text: "NOTE TO CONTRIBUTORS", xStart: 74, xEnd: 188, yTop: 98.398, yBottom: 110.398, fontName: "Heading", fontSize: 12 },
      { text: "All contributions become property of the authors and are subject to editing and reviewing. Please verify all data and", xStart: 69, xEnd: 591, yTop: 126.198, yBottom: 137.198 },
      { text: "spellings carefully. Contributions should be supported by at least two high-quality references.", xStart: 69, xEnd: 483, yTop: 140.201, yBottom: 151.201 },
      { text: "Check our website first to avoid duplicate submissions.", xStart: 69, xEnd: 591, yTop: 163.202, yBottom: 174.202 },
      { text: "only the first complete entry received will be credited.", xStart: 69, xEnd: 591, yTop: 177.205, yBottom: 188.205 },
      { text: "Please follow the style and punctuation.", xStart: 69, xEnd: 350, yTop: 191.208, yBottom: 202.208 },
    ]);
    const result = reconstructPhysicalBlocks({ documentId: "page-17", ...input, makeId });
    expect(result.blocks.map((block) => block.lineIds)).toEqual([["line-0"], ["line-1", "line-2"], ["line-3", "line-4", "line-5"]]);
    expect(result.boundaries[1]).toEqual(expect.objectContaining({
      decision: "same-block",
      evidence: expect.arrayContaining(["ordinary-line-spacing-match", "strong-horizontal-overlap"]),
    }));
    expect(result.boundaries[1].normalizedGap).toBeCloseTo(0.273, 3);
    expect(result.boundaries[1].ordinaryLineGapBaseline).toBeCloseTo(0.273, 3);
    expect(result.boundaries[1].evidence).not.toContain("normalized-gap-regime-change");
  });

  it("keeps a genuine paragraph gap as a PhysicalBlock boundary", () => {
    const result = reconstructPhysicalBlocks({ documentId: "doc", ...fixture({ gaps: [2.73, 10.91] }), makeId });
    expect(result.blocks.map((block) => block.lineIds)).toEqual([["line-0", "line-1"], ["line-2"]]);
    expect(result.boundaries[1]).toEqual(expect.objectContaining({ decision: "new-block", evidence: expect.arrayContaining(["inter-block-gap"]) }));
  });

  it("keeps a heading separate from ordinarily spaced body lines", () => {
    const input = lineFixture([
      { text: "NOTE TO CONTRIBUTORS", xStart: 74, xEnd: 188, yTop: 10, yBottom: 22, fontName: "Heading", fontSize: 12 },
      { text: "Body line one", xStart: 69, xEnd: 591, yTop: 37.8, yBottom: 48.8 },
      { text: "Body line two", xStart: 69, xEnd: 480, yTop: 51.803, yBottom: 62.803 },
    ]);
    const result = reconstructPhysicalBlocks({ documentId: "doc", ...input, makeId });
    expect(result.blocks.map((block) => block.lineIds)).toEqual([["line-0"], ["line-1", "line-2"]]);
  });

  it("splits ordinary-ish spacing when strong alignment evidence marks a role transition", () => {
    const input = lineFixture([
      { text: "CENTERED HEADING", xStart: 220, xEnd: 320, yTop: 10, yBottom: 20, fontName: "Heading" },
      { text: "Body line one", xStart: 10, xEnd: 510, yTop: 22.73, yBottom: 32.73, fontName: "Body" },
      { text: "Body line two", xStart: 10, xEnd: 510, yTop: 35.46, yBottom: 45.46, fontName: "Body" },
    ]);
    const result = reconstructPhysicalBlocks({ documentId: "doc", ...input, makeId });
    expect(result.blocks.map((block) => block.lineIds)).toEqual([["line-0"], ["line-1", "line-2"]]);
    expect(result.boundaries[0]).toEqual(expect.objectContaining({ decision: "new-block", evidence: expect.arrayContaining(["major-alignment-transition"]) }));
  });

  it("never merges lines across columns", () => {
    const result = reconstructPhysicalBlocks({ documentId: "doc", ...fixture({ columns: ["column-0", "column-1", "column-1"] }), makeId });
    expect(result.blocks.map((block) => block.lineIds)).toEqual([["line-0"], ["line-1", "line-2"]]);
    expect(result.boundaries[0]).toEqual(expect.objectContaining({ status: "hard-boundary", evidence: expect.arrayContaining(["column-transition"]) }));
  });

  it("creates no paragraph until a manual DocumentForm assignment exists", () => {
    const physical = reconstructPhysicalBlocks({ documentId: "doc", ...fixture(), makeId });
    expect(buildDocumentForms({ documentId: "doc", physicalBlocks: physical.blocks, assignments: [], canonicalText: fixture().canonicalText, makeId })).toEqual([]);
    const forms = buildDocumentForms({ documentId: "doc", physicalBlocks: physical.blocks, assignments: [{ type: "PARAGRAPH", physicalBlockIds: [physical.blocks[0].id], source: "manual" }], canonicalText: fixture().canonicalText, makeId });
    expect(forms).toEqual([expect.objectContaining({ type: "PARAGRAPH", source: "manual", physicalBlockIds: [physical.blocks[0].id], canonicalText: "Alpha.Beta.Gamma." })]);
  });
});
