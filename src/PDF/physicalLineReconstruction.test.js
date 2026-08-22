import { describe, expect, it } from "vitest";
import { reconstructPhysicalLines } from "./physicalLineReconstruction.js";
import { reconstructDocument } from "./documentReconstruction.js";

const item = (text, x, y, width, height = 10, extra = {}) => ({ id: extra.id || `${extra.sourceIndex ?? 0}:${text}`, sourceIndex: extra.sourceIndex ?? 0, text, bbox: { x, y, width, height }, baseline: extra.baseline ?? y + height, fontSize: height, direction: extra.direction || "ltr", ...extra });
const run = (items) => reconstructPhysicalLines({ documentId: "fixture", pageIndex: 0, sourceItems: items });

describe("source-order PhysicalLine reconstruction", () => {
  it("groups several baseline-compatible source strings into one line", () => {
    const result = run([item("The ", 10, 20, 22, 10, { sourceIndex: 0 }), item("heart ", 32, 20, 30, 10, { sourceIndex: 1 }), item("contracts.", 62, 20, 48, 10, { sourceIndex: 2 })]);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].sourceText).toBe("The heart contracts.");
  });

  it("keeps CO₂ on one line and classifies the lowered run physically", () => {
    const result = run([item("CO", 10, 20, 14, 10, { sourceIndex: 0 }), item("2", 24, 26, 5, 7, { sourceIndex: 1 })]);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].items[1]).toEqual(expect.objectContaining({ relativeVerticalPosition: "below-baseline", scriptCandidate: "subscript" }));
  });

  it("keeps x² on one line and classifies the raised run physically", () => {
    const result = run([item("x", 10, 20, 7, 10, { sourceIndex: 0 }), item("2", 17, 15, 5, 7, { sourceIndex: 1 })]);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].items[1]).toEqual(expect.objectContaining({ relativeVerticalPosition: "above-baseline", scriptCandidate: "superscript" }));
  });

  it.each([
    ["PaCO₂ was 55 mmHg.", [item("PaCO", 10, 20, 28, 10, { sourceIndex: 0 }), item("2", 38, 26, 5, 7, { sourceIndex: 1 }), item(" was 55 mmHg.", 43, 20, 75, 10, { sourceIndex: 2 })]],
    ["Ca²⁺ concentration", [item("Ca", 10, 20, 14, 10, { sourceIndex: 0 }), item("2", 24, 15, 5, 7, { sourceIndex: 1 }), item("+", 29, 15, 5, 7, { sourceIndex: 2 }), item(" concentration", 34, 20, 70, 10, { sourceIndex: 3 })]],
    ["Treatment was successful.¹", [item("Treatment was successful.", 10, 20, 120, 10, { sourceIndex: 0 }), item("1", 130, 15, 5, 7, { sourceIndex: 1 })]],
  ])("keeps displaced inline notation in one line: %s", (_label, items) => expect(run(items).lines).toHaveLength(1));

  it("separates a genuine next line with baseline displacement and horizontal reset", () => {
    const result = run([item("The heart contracts.", 10, 20, 100, 10, { sourceIndex: 0 }), item("Blood enters the aorta.", 10, 35, 115, 10, { sourceIndex: 1 })]);
    expect(result.lines).toHaveLength(2);
    expect(result.relations[0]).toEqual(expect.objectContaining({ consecutiveSourceFlow: true, evidenceOnly: true }));
  });

  it("uses flow and envelope evidence rather than Y displacement alone", () => {
    const inline = run([item("PaCO", 10, 20, 28, 10, { sourceIndex: 0 }), item("2", 38, 24, 5, 7, { sourceIndex: 1 })]);
    const reset = run([item("First line", 80, 20, 55, 10, { sourceIndex: 0 }), item("Next line", 10, 24, 50, 10, { sourceIndex: 1 })]);
    expect(inline.lines).toHaveLength(1);
    expect(reset.lines).toHaveLength(2);
  });

  it("keeps mixed font sizes inline", () => {
    expect(run([item("Normal ", 10, 20, 42, 10, { sourceIndex: 0 }), item("SMALL", 52, 22, 24, 7, { sourceIndex: 1 }), item(" normal", 76, 20, 42, 10, { sourceIndex: 2 })]).lines).toHaveLength(1);
  });

  it("does not join source-adjacent text from separate columns", () => {
    expect(run([item("Left column", 10, 20, 70, 10, { sourceIndex: 0 }), item("Right column", 320, 20, 75, 10, { sourceIndex: 1 })]).lines).toHaveLength(2);
  });

  it("respects RTL horizontal progression", () => {
    const result = run([item("القلب ", 200, 20, 45, 10, { sourceIndex: 0, direction: "rtl" }), item("ينقبض", 155, 20, 40, 10, { sourceIndex: 1, direction: "rtl" })]);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].writingDirection).toBe("rtl");
  });

  it("preserves source order separately from resolved order", () => {
    const result = run([item("B", 30, 20, 8, 10, { sourceIndex: 0 }), item("A", 20, 20, 8, 10, { sourceIndex: 1 })]);
    expect(result.lines[0].sourceText).toBe("BA");
    expect(result.lines[0].resolvedText).toBe("AB");
    expect(result.lines[0].items.map((entry) => entry.sourceOrder)).toEqual([0, 1]);
  });

  it("stops automatic document reconstruction at PhysicalLines", () => {
    const pageHeight = 800;
    const pdfItem = (text, x, top, sourceIndex) => ({ str: text, dir: "ltr", width: text.length * 5, height: 10, transform: [10, 0, 0, 10, x, pageHeight - (top + 8)], fontName: "Fixture", hasEOL: true, sourceIndex });
    const result = reconstructDocument({ documentId: "line-first", fileHash: "line-first", pageCount: 1, pages: [{ pageIndex: 0, width: 600, height: pageHeight, viewportTransform: [1, 0, 0, -1, 0, pageHeight], items: [pdfItem("Line one.", 20, 20, 0), pdfItem("Line two.", 20, 34, 1), pdfItem("Line three.", 20, 48, 2), pdfItem("Line four.", 20, 62, 3)] }] });
    expect(result.physical.lines).toHaveLength(4);
    expect(result.physical.blocks).toEqual([]);
    expect(result.paragraphs).toEqual([]);
    expect(result.sentences.length).toBeGreaterThan(0);
    expect(result.physical.lineRelations).toHaveLength(3);
  });

  it("allows one sentence to span multiple PhysicalLines", () => {
    const pageHeight = 800;
    const pdfItem = (text, top, sourceIndex) => ({ str: text, dir: "ltr", width: text.length * 5, height: 10, transform: [10, 0, 0, 10, 20, pageHeight - (top + 8)], fontName: "Fixture", hasEOL: true, sourceIndex });
    const result = reconstructDocument({ documentId: "sentence-crosses-lines", fileHash: "sentence-crosses-lines", pageCount: 1, pages: [{ pageIndex: 0, width: 600, height: pageHeight, viewportTransform: [1, 0, 0, -1, 0, pageHeight], items: [pdfItem("The heart ", 20, 0), pdfItem("contracts.", 34, 1)] }] });
    expect(result.physical.lines).toHaveLength(2);
    expect(result.sentences).toHaveLength(1);
    expect(result.sentences[0].lineIds).toHaveLength(2);
  });

  it("allows multiple sentences to share one PhysicalLine", () => {
    const pageHeight = 800;
    const result = reconstructDocument({ documentId: "sentences-share-line", fileHash: "sentences-share-line", pageCount: 1, pages: [{ pageIndex: 0, width: 600, height: pageHeight, viewportTransform: [1, 0, 0, -1, 0, pageHeight], items: [{ str: "First ends. Second ends.", dir: "ltr", width: 125, height: 10, transform: [10, 0, 0, 10, 20, pageHeight - 28], fontName: "Fixture", hasEOL: true, sourceIndex: 0 }] }] });
    expect(result.physical.lines).toHaveLength(1);
    expect(result.sentences).toHaveLength(2);
    expect(new Set(result.sentences.flatMap((sentence) => sentence.lineIds))).toEqual(new Set([result.physical.lines[0].id]));
  });

  it("limits linguistic analysis to independently selected manual PhysicalBlocks", () => {
    const pageHeight = 800;
    const pages = [{ pageIndex: 0, width: 600, height: pageHeight, viewportTransform: [1, 0, 0, -1, 0, pageHeight], items: [
      { str: "First discourse continues", dir: "ltr", width: 120, height: 10, transform: [10, 0, 0, 10, 20, pageHeight - 28], fontName: "Fixture", hasEOL: true, sourceIndex: 0 },
      { str: "Second discourse continues", dir: "ltr", width: 130, height: 10, transform: [10, 0, 0, 10, 20, pageHeight - 48], fontName: "Fixture", hasEOL: true, sourceIndex: 1 },
    ] }];
    const input = { documentId: "manual-block-scope", fileHash: "manual-block-scope", pageCount: 1, pages, config: { linguisticScope: "manual-physical-blocks" } };
    const unscoped = reconstructDocument(input);
    expect(unscoped.physical.lines).toHaveLength(2);
    expect(unscoped.words).toEqual([]);
    expect(unscoped.sentences).toEqual([]);
    const scoped = reconstructDocument({ ...input, documentFormAssignments: unscoped.physical.lines.map((line, index) => ({ id: `block-${index}`, kind: "manual-physical-block", createDocumentForm: false, lineIds: [line.id] })) });
    expect(scoped.physical.blocks).toHaveLength(2);
    expect(scoped.sentences).toHaveLength(2);
    expect(scoped.sentences.map((sentence) => sentence.scopePhysicalBlockId)).toEqual(scoped.physical.blocks.map((block) => block.id));
  });
});
