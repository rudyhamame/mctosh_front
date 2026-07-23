import { describe, expect, it } from "vitest";
import {
  buildElementsById, reconstructSegmentText, itemIndexesForSegment,
  groupSegmentsByFlow, buildSegmentForest, buildSegmentsById,
} from "./pdfSegmentTree.js";

const el = (id, text) => ({ id, text });

describe("pdfSegmentTree — text reconstruction", () => {
  it("joins a segment's own elementIds' text, in order, with single spaces", () => {
    const elementsById = buildElementsById([el("el-1-0", "Heart"), el("el-1-1", "failure"), el("el-1-2", "occurs.")]);
    const segment = { elementIds: ["el-1-0", "el-1-1", "el-1-2"] };
    expect(reconstructSegmentText(segment, elementsById)).toBe("Heart failure occurs.");
  });

  it("skips an elementId that isn't in the elements snapshot rather than throwing", () => {
    const elementsById = buildElementsById([el("el-1-0", "Heart")]);
    const segment = { elementIds: ["el-1-0", "el-1-99"] };
    expect(reconstructSegmentText(segment, elementsById)).toBe("Heart");
  });

  it("never mixes another segment's elements in — text is built ONLY from this segment's own elementIds", () => {
    const elementsById = buildElementsById([el("el-1-0", "Main"), el("el-1-1", "Aside")]);
    const mainSeg = { elementIds: ["el-1-0"] };
    const asideSeg = { elementIds: ["el-1-1"] };
    expect(reconstructSegmentText(mainSeg, elementsById)).toBe("Main");
    expect(reconstructSegmentText(asideSeg, elementsById)).toBe("Aside");
  });
});

describe("pdfSegmentTree — itemIndexesForSegment", () => {
  it("parses raw PDF.js item indexes out of a segment's elementIds", () => {
    const segment = { elementIds: ["el-4-0", "el-4-1", "el-4-5"] };
    expect(itemIndexesForSegment(segment)).toEqual([0, 1, 5]);
  });

  it("returns an empty array for a segment with no elementIds", () => {
    expect(itemIndexesForSegment({ elementIds: [] })).toEqual([]);
    expect(itemIndexesForSegment({})).toEqual([]);
  });
});

describe("pdfSegmentTree — groupSegmentsByFlow", () => {
  it("groups by flowId and sorts each flow's own segments by readingOrder", () => {
    const segments = [
      { id: "a", flowId: "main", readingOrder: 2 },
      { id: "b", flowId: "aside-1", readingOrder: 0 },
      { id: "c", flowId: "main", readingOrder: 0 },
      { id: "d", flowId: "main", readingOrder: 1 },
    ];
    const flows = groupSegmentsByFlow(segments);
    const main = flows.find((f) => f.flowId === "main");
    expect(main.segments.map((s) => s.id)).toEqual(["c", "d", "a"]);
    const aside = flows.find((f) => f.flowId === "aside-1");
    expect(aside.segments.map((s) => s.id)).toEqual(["b"]);
  });

  it("defaults a missing flowId to 'main'", () => {
    const flows = groupSegmentsByFlow([{ id: "a", readingOrder: 0 }]);
    expect(flows).toHaveLength(1);
    expect(flows[0].flowId).toBe("main");
  });

  it("never interleaves two flows into one — an aside never lands inside main's own ordered list", () => {
    const segments = [
      { id: "m1", flowId: "main", readingOrder: 0 },
      { id: "a1", flowId: "aside-1", readingOrder: 0 },
      { id: "m2", flowId: "main", readingOrder: 1 },
    ];
    const flows = groupSegmentsByFlow(segments);
    const main = flows.find((f) => f.flowId === "main");
    expect(main.segments.map((s) => s.id)).toEqual(["m1", "m2"]);
  });
});

describe("pdfSegmentTree — buildSegmentForest", () => {
  it("nests a child under its parentId, keeping the parent as the root", () => {
    const flowSegments = [
      { id: "parent", parentId: null },
      { id: "child", parentId: "parent" },
    ];
    const forest = buildSegmentForest(flowSegments);
    expect(forest).toHaveLength(1);
    expect(forest[0].id).toBe("parent");
    expect(forest[0].children).toHaveLength(1);
    expect(forest[0].children[0].id).toBe("child");
  });

  it("treats a segment whose parentId isn't in this flow as its own root (not silently dropped)", () => {
    const flowSegments = [{ id: "orphan", parentId: "not-in-this-flow" }];
    const forest = buildSegmentForest(flowSegments);
    expect(forest.map((n) => n.id)).toEqual(["orphan"]);
  });

  it("supports multiple independent roots at the top level", () => {
    const flowSegments = [{ id: "a", parentId: null }, { id: "b", parentId: null }];
    const forest = buildSegmentForest(flowSegments);
    expect(forest.map((n) => n.id).sort()).toEqual(["a", "b"]);
  });
});

describe("pdfSegmentTree — buildSegmentsById", () => {
  it("indexes every segment by its own id, across the whole page regardless of flow", () => {
    const segments = [{ id: "a", flowId: "main" }, { id: "b", flowId: "aside-1" }];
    const byId = buildSegmentsById(segments);
    expect(byId.get("a").flowId).toBe("main");
    expect(byId.get("b").flowId).toBe("aside-1");
  });
});
