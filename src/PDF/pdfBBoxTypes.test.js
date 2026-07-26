import { describe, expect, it } from "vitest";
import {
  BBOX_CARD_TYPES,
  BBOX_TYPES,
  clientPointToBBoxPagePoint,
  createBBoxDraft,
  getViewportDocumentSize,
} from "./pdfBBoxTypes.js";

describe("BBox type model", () => {
  it("registers every current bbox subtype", () => {
    expect([...BBOX_TYPES]).toEqual(["bbox", "bboxContainer", "bboxTitle", "imageBBox"]);
    expect([...BBOX_CARD_TYPES]).toEqual(["bbox", "imageBBox"]);
  });

  it("creates every subtype through the same freeform draft factory", () => {
    for (const type of BBOX_TYPES) {
      const draft = createBBoxDraft(type, { x: 12, y: 34, t: 56, pressure: 0.7 }, {
        color: "#123456",
        lineWidth: 2,
        borderStyle: "dashed",
      });
      expect(draft).toMatchObject({ type, x: 12, y: 34, points: [{ x: 12, y: 34 }] });
    }
  });
});

describe("zoom-independent BBox coordinates", () => {
  const rectAtZoom = (zoom) => ({ left: 20, top: 30, width: 600 * zoom, height: 800 * zoom });
  const viewportAtZoom = (zoom) => ({ width: 600 * zoom, height: 800 * zoom, scale: zoom });

  it.each([0.34, 0.55, 0.61, 0.63, 0.65, 0.67, 0.77, 1, 1.4, 2])(
    "maps the same page location at zoom %s",
    (zoom) => {
      const rect = rectAtZoom(zoom);
      const point = clientPointToBBoxPagePoint({
        clientX: rect.left + rect.width * 0.25,
        clientY: rect.top + rect.height * 0.75,
        rect,
        viewport: viewportAtZoom(zoom),
      });
      expect(point.x).toBeCloseTo(150, 8);
      expect(point.y).toBeCloseTo(600, 8);
    },
  );

  it("derives stable document dimensions from every viewport scale", () => {
    expect(getViewportDocumentSize({ width: 366, height: 488, scale: 0.61 })).toEqual({ width: 600, height: 800 });
    expect(getViewportDocumentSize({ width: 1200, height: 1600, scale: 2 })).toEqual({ width: 600, height: 800 });
  });
});
