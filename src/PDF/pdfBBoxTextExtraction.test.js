import { describe, expect, it } from "vitest";
import {
  buildTightTextOutline,
  extractBoundingBoxTextParts,
  extractTextForBoundingBox,
  selectSpansForBoundingBox,
} from "./pdfBBoxTextExtraction.js";

const span = (text, x, y, width, height, zoom = 1, extra = {}) => ({
  text,
  el: { textContent: text },
  pageLeft: x,
  pageRight: x + width,
  pageTop: y,
  pageBottom: y + height,
  pageHeight: height,
  geoLeft: x * zoom,
  geoRight: (x + width) * zoom,
  geoTop: y * zoom,
  geoHeight: height * zoom,
  ...extra,
});

describe("pdfBBoxTextExtraction", () => {
  it("keeps the Rate paragraph's last line in left-to-right order even when a subscript glyph sits lower", () => {
    const bbox = { x: 0, y: 118, w: 520, h: 18 };
    const spans = [
      span("toxicosis,", 0, 120, 60, 12),
      span("carbon", 64, 120, 50, 12),
      span("dioxide", 116, 120, 50, 12),
      span("(CO", 168, 120, 28, 12),
      span("2", 200, 121.5, 8, 8),
      span(")", 207, 120, 8, 12),
      span("retention,", 244, 120, 82, 12),
      span("and", 330, 120, 24, 12),
      span("sympathomimetics.", 360, 120, 132, 12),
    ];

    expect(extractTextForBoundingBox(spans, bbox)).toBe(
      "toxicosis, carbon dioxide (CO 2) retention, and sympathomimetics.",
    );
  });

  it("returns the same extracted text at different zoom scales because it matches in page space", () => {
    const bbox = { x: 0, y: 118, w: 520, h: 18 };
    const spansAt100 = [
      span("toxicosis,", 0, 120, 60, 12, 1),
      span("carbon", 64, 120, 50, 12, 1),
      span("dioxide", 116, 120, 50, 12, 1),
      span("(CO", 168, 120, 28, 12, 1),
      span("2", 200, 121.5, 8, 8, 1),
      span(")", 207, 120, 8, 12, 1),
      span("retention,", 244, 120, 82, 12, 1),
      span("and", 330, 120, 24, 12, 1),
      span("sympathomimetics.", 360, 120, 132, 12, 1),
    ];
    const spansAt77 = [
      span("toxicosis,", 0, 120, 60, 12, 0.77),
      span("carbon", 64, 120, 50, 12, 0.77),
      span("dioxide", 116, 120, 50, 12, 0.77),
      span("(CO", 168, 120, 28, 12, 0.77),
      span("2", 200, 121.5, 8, 8, 0.77),
      span(")", 207, 120, 8, 12, 0.77),
      span("retention,", 244, 120, 82, 12, 0.77),
      span("and", 330, 120, 24, 12, 0.77),
      span("sympathomimetics.", 360, 120, 132, 12, 0.77),
    ];

    expect(extractTextForBoundingBox(spansAt100, bbox)).toBe(extractTextForBoundingBox(spansAt77, bbox));
  });

  it("does not pull in same-row text that sits outside the bbox horizontally", () => {
    const bbox = { x: 0, y: 118, w: 230, h: 18 };
    const spans = [
      span("toxicosis,", 0, 120, 60, 12),
      span("carbon", 64, 120, 50, 12),
      span("dioxide", 116, 120, 50, 12),
      span("(CO", 168, 120, 28, 12),
      span("2", 200, 121.5, 8, 8),
      span(")", 207, 120, 8, 12),
      span("retention,", 244, 120, 82, 12),
      span("and", 330, 120, 24, 12),
      span("sympathomimetics.", 360, 120, 132, 12),
    ];

    expect(extractTextForBoundingBox(spans, bbox)).toBe("toxicosis, carbon dioxide (CO 2)");
  });

  it("detects a visually distinct first line as the title and keeps only the body in text", () => {
    const bbox = { x: 0, y: 90, w: 260, h: 40 };
    const spans = [
      span("KEY FACT", 0, 92, 70, 16, 1, { fontWeight: "700", fontFamily: "Arial" }),
      span("This", 0, 112, 30, 12, 1, { fontWeight: "400", fontFamily: "Arial" }),
      span("is", 34, 112, 12, 12, 1, { fontWeight: "400", fontFamily: "Arial" }),
      span("the body.", 50, 112, 68, 12, 1, { fontWeight: "400", fontFamily: "Arial" }),
    ];

    expect(extractBoundingBoxTextParts(spans, bbox)).toEqual({
      title: "KEY FACT",
      text: "This is the body.",
    });
  });

  it("treats text inside a container but outside its child bboxes as the container title", () => {
    const container = { x: 0, y: 80, w: 260, h: 80 };
    const childBbox = { x: 0, y: 106, w: 180, h: 24 };
    const spans = [
      span("KEY FACT", 0, 84, 70, 16, 1, { fontWeight: "700", fontFamily: "Arial" }),
      span("This", 0, 110, 30, 12, 1, { fontWeight: "400", fontFamily: "Arial" }),
      span("is", 34, 110, 12, 12, 1, { fontWeight: "400", fontFamily: "Arial" }),
      span("inside the child bbox", 50, 110, 120, 12, 1, { fontWeight: "400", fontFamily: "Arial" }),
    ];

    expect(extractBoundingBoxTextParts(spans, container, undefined, [childBbox])).toEqual({
      title: "KEY FACT",
      text: "",
    });
  });

  it("builds a minimum line-following outline around exactly the extracted spans", () => {
    const bbox = { x: 0, y: 90, w: 300, h: 70 };
    const spans = [
      span("A", 20, 100, 20, 10, 1, { rowIndex: 0, columnIndex: 0 }),
      span("long first line", 45, 100, 95, 10, 1, { rowIndex: 0, columnIndex: 0 }),
      span("short line", 20, 120, 60, 10, 1, { rowIndex: 1, columnIndex: 0 }),
      span("other column", 200, 100, 80, 10, 1, { rowIndex: 0, columnIndex: 1 }),
    ];
    const selected = selectSpansForBoundingBox(spans, bbox);
    const outline = buildTightTextOutline(selected, 1);

    expect(selected.map((item) => item.text)).toEqual(["A", "long first line", "short line"]);
    expect(Math.min(...outline.map((point) => point.x))).toBe(19);
    expect(Math.max(...outline.map((point) => point.x))).toBe(141);
    expect(Math.min(...outline.map((point) => point.y))).toBe(99);
    expect(Math.max(...outline.map((point) => point.y))).toBe(131);
    expect(outline.some((point) => point.x === 81)).toBe(true);
  });

});
