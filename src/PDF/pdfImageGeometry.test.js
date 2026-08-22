import { describe, expect, it } from "vitest";
import { extractPlacedImageRects, extractVectorRulingLines } from "./pdfImageGeometry.js";

describe("extractPlacedImageRects", () => {
  it("tracks transforms and returns page-space image geometry", () => {
    const ops = { save: 1, restore: 2, transform: 3, paintImageXObject: 4 };
    const operatorList = {
      fnArray: [ops.save, ops.transform, ops.paintImageXObject, ops.restore],
      argsArray: [null, [300, 0, 0, 180, 200, 143], ["img_1"], null],
    };
    const viewport = { scale: 1, transform: [1, 0, 0, -1, 0, 783] };
    expect(extractPlacedImageRects(operatorList, viewport, ops)).toEqual([
      { x: 200, y: 460, w: 300, h: 180 },
    ]);
  });
});

describe("extractVectorRulingLines", () => {
  it("extracts stroked horizontal, vertical, and rectangle rulings in viewport space", () => {
    const ops = { constructPath: 1, moveTo: 2, lineTo: 3, rectangle: 4, stroke: 5 };
    const operatorList = {
      fnArray: [ops.constructPath, ops.stroke],
      argsArray: [[[ops.moveTo, ops.lineTo, ops.rectangle], [10, 20, 100, 20, 120, 10, 40, 30]], null],
    };
    const lines = extractVectorRulingLines(operatorList, { scale: 1, transform: [1, 0, 0, -1, 0, 200] }, ops);
    expect(lines).toHaveLength(5);
    expect(lines).toEqual(expect.arrayContaining([expect.objectContaining({ x1: 10, y1: 180, x2: 100, y2: 180 })]));
  });
});
