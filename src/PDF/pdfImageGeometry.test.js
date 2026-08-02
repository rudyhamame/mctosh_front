import { describe, expect, it } from "vitest";
import { extractPlacedImageRects } from "./pdfImageGeometry.js";

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
