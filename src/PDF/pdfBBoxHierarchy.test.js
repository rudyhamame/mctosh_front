import { describe, expect, it } from "vitest";
import { normalizePagePartitionHierarchy } from "./pdfBBoxHierarchy.js";

describe("Page and Partition hierarchy", () => {
  it("places partitions directly under Page and content under its smallest partition", () => {
    const normalized = normalizePagePartitionHierarchy([
      { id: "page", type: "pageBBox", x: 0, y: 0, w: 500, h: 700 },
      { id: "part", type: "columnBBox", parentId: "old-section", x: 20, y: 20, w: 200, h: 500 },
      { id: "paragraph", type: "bbox", parentId: "old-section", x: 30, y: 40, w: 150, h: 80 },
      { id: "figure", type: "imageBBox", parentId: "old-section", x: 40, y: 150, w: 120, h: 100 },
    ]);
    expect(normalized.find((item) => item.id === "part").parentId).toBe("page");
    expect(normalized.find((item) => item.id === "paragraph").parentId).toBe("part");
    expect(normalized.find((item) => item.id === "figure").parentId).toBe("part");
  });

  it("keeps paragraphs and figures directly under Page when no partition contains them", () => {
    const normalized = normalizePagePartitionHierarchy([
      { id: "page", type: "pageBBox", x: 0, y: 0, w: 500, h: 700 },
      { id: "paragraph", type: "bbox", x: 250, y: 40, w: 150, h: 80 },
      { id: "figure", type: "imageBBox", x: 250, y: 150, w: 120, h: 100 },
    ]);
    expect(normalized.find((item) => item.id === "paragraph").parentId).toBe("page");
    expect(normalized.find((item) => item.id === "figure").parentId).toBe("page");
  });

  it("preserves multiple sibling partitions under the same Page", () => {
    const normalized = normalizePagePartitionHierarchy([
      { id: "page", type: "pageBBox", x: 0, y: 0, w: 500, h: 700 },
      { id: "part-1", type: "columnBBox", x: 20, y: 20, w: 210, h: 640 },
      { id: "part-2", type: "columnBBox", x: 270, y: 20, w: 212, h: 640 },
    ]);

    expect(normalized.filter((item) => item.type === "columnBBox")).toEqual([
      expect.objectContaining({ id: "part-1", parentId: "page" }),
      expect.objectContaining({ id: "part-2", parentId: "page" }),
    ]);
  });

  it("keeps a contained Block as a nested Block instead of a sibling line source", () => {
    const normalized = normalizePagePartitionHierarchy([
      { id: "page", type: "pageBBox", x: 0, y: 0, w: 500, h: 700 },
      { id: "part", type: "columnBBox", x: 20, y: 20, w: 460, h: 650 },
      { id: "outer", type: "bbox", x: 40, y: 40, w: 400, h: 300 },
      { id: "inner", type: "bbox", x: 80, y: 100, w: 220, h: 100 },
      { id: "subline", type: "subLineBBox", parentId: "inner", x: 90, y: 120, w: 180, h: 20 },
    ]);

    expect(normalized.find((item) => item.id === "outer").parentId).toBe("part");
    expect(normalized.find((item) => item.id === "inner").parentId).toBe("outer");
    expect(normalized.find((item) => item.id === "subline").parentId).toBe("inner");
  });
});
