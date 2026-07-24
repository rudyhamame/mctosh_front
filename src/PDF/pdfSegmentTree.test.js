import { describe, expect, it } from "vitest";
import {
  buildElementsById, groupElementsByFlowRegion, buildElementForest,
  buildListTree, buildTableGrid,
} from "./pdfSegmentTree.js";

describe("pdfSegmentTree — buildElementsById", () => {
  it("indexes every element by its own id", () => {
    const byId = buildElementsById([{ id: "el-1", text: "a" }, { id: "el-2", text: "b" }]);
    expect(byId.get("el-1").text).toBe("a");
    expect(byId.get("el-2").text).toBe("b");
  });
});

describe("pdfSegmentTree — groupElementsByFlowRegion", () => {
  it("groups top-level elements by flowRegionId and sorts each flow by readingOrderIndex", () => {
    const elements = [
      { id: "a", parentId: null, flowRegionId: "col0", readingOrderIndex: 2 },
      { id: "b", parentId: null, flowRegionId: "aside-1", readingOrderIndex: 0 },
      { id: "c", parentId: null, flowRegionId: "col0", readingOrderIndex: 0 },
      { id: "d", parentId: null, flowRegionId: "col0", readingOrderIndex: 1 },
    ];
    const flows = groupElementsByFlowRegion(elements);
    const col0 = flows.find((f) => f.flowRegionId === "col0");
    expect(col0.elements.map((e) => e.id)).toEqual(["c", "d", "a"]);
    const aside = flows.find((f) => f.flowRegionId === "aside-1");
    expect(aside.elements.map((e) => e.id)).toEqual(["b"]);
  });

  it("defaults a missing flowRegionId to 'main'", () => {
    const flows = groupElementsByFlowRegion([{ id: "a", parentId: null, readingOrderIndex: 0 }]);
    expect(flows).toHaveLength(1);
    expect(flows[0].flowRegionId).toBe("main");
  });

  it("excludes non-top-level elements (parentId set) — they belong to their parent's own tree, not the flat flow list", () => {
    const elements = [
      { id: "list-1", parentId: null, flowRegionId: "main", readingOrderIndex: 0 },
      { id: "item-1", parentId: "list-1", flowRegionId: "main", readingOrderIndex: 1 },
    ];
    const flows = groupElementsByFlowRegion(elements);
    expect(flows[0].elements.map((e) => e.id)).toEqual(["list-1"]);
  });

  it("orders flow buckets by their own readingOrderIndex, not first-appearance in the elements array (regression)", () => {
    // Regression for a real bug: fuseStructure's raw `elements` array
    // reflects its internal construction-loop order (tables pushed before
    // paragraphs/headings), so a table with flowRegionId "main" always
    // appeared before a page-header paragraph in a distinct flow region —
    // even though the header reads first on the page (readingOrderIndex 0
    // vs the table's 1). Flow bucket order must follow readingOrderIndex.
    const elements = [
      { id: "table-1", parentId: null, flowRegionId: null, readingOrderIndex: 1 }, // pushed first, but reads second
      { id: "header-1", parentId: null, flowRegionId: "header", readingOrderIndex: 0 }, // pushed second, but reads first
    ];
    const flows = groupElementsByFlowRegion(elements);
    expect(flows.map((f) => f.flowRegionId)).toEqual(["header", "main"]);
  });
});

describe("pdfSegmentTree — buildElementForest", () => {
  it("nests a child under its parentId via childIds, keeping the parent as the root", () => {
    const elementsById = buildElementsById([
      { id: "parent", parentId: null, childIds: ["child"] },
      { id: "child", parentId: "parent", childIds: [] },
    ]);
    const forest = buildElementForest([elementsById.get("parent")], elementsById);
    expect(forest).toHaveLength(1);
    expect(forest[0].id).toBe("parent");
    expect(forest[0].children).toHaveLength(1);
    expect(forest[0].children[0].id).toBe("child");
  });

  it("supports multiple independent roots at the top level", () => {
    const elementsById = buildElementsById([
      { id: "a", parentId: null, childIds: [] },
      { id: "b", parentId: null, childIds: [] },
    ]);
    const forest = buildElementForest([elementsById.get("a"), elementsById.get("b")], elementsById);
    expect(forest.map((n) => n.id).sort()).toEqual(["a", "b"]);
  });

  it("does not infinite-loop on a cycle (defense in depth beyond the backend's own integrity check)", () => {
    const elementsById = buildElementsById([
      { id: "a", parentId: "b", childIds: ["b"] },
      { id: "b", parentId: "a", childIds: ["a"] },
    ]);
    expect(() => buildElementForest([elementsById.get("a")], elementsById)).not.toThrow();
  });
});

describe("pdfSegmentTree — buildListTree", () => {
  it("builds a flat list's own items in childIds order", () => {
    const elementsById = buildElementsById([
      { id: "list-1", kind: "list", childIds: ["item-1", "item-2"] },
      { id: "item-1", kind: "list_item", childIds: [], text: "First" },
      { id: "item-2", kind: "list_item", childIds: [], text: "Second" },
    ]);
    const tree = buildListTree(elementsById.get("list-1"), elementsById);
    expect(tree.items.map((i) => i.text)).toEqual(["First", "Second"]);
    expect(tree.items[0].childList).toBeNull();
  });

  it("nests a sub-list under the item that contains it", () => {
    const elementsById = buildElementsById([
      { id: "list-1", kind: "list", childIds: ["item-1"] },
      { id: "item-1", kind: "list_item", childIds: ["sublist-1"], text: "Parent item" },
      { id: "sublist-1", kind: "list", childIds: ["item-2"] },
      { id: "item-2", kind: "list_item", childIds: [], text: "Nested item" },
    ]);
    const tree = buildListTree(elementsById.get("list-1"), elementsById);
    expect(tree.items[0].childList.items.map((i) => i.text)).toEqual(["Nested item"]);
  });
});

describe("pdfSegmentTree — buildTableGrid", () => {
  it("places each cell at its own row/col", () => {
    const table = {
      rows: 2, cols: 2,
      cells: [
        { row: 0, col: 0, rowSpan: 1, colSpan: 1, text: "A" },
        { row: 0, col: 1, rowSpan: 1, colSpan: 1, text: "B" },
        { row: 1, col: 0, rowSpan: 1, colSpan: 1, text: "C" },
        { row: 1, col: 1, rowSpan: 1, colSpan: 1, text: "D" },
      ],
    };
    const grid = buildTableGrid(table);
    expect(grid[0][0].text).toBe("A");
    expect(grid[1][1].text).toBe("D");
  });

  it("marks every spanned slot of a rowSpan/colSpan cell as owned by that cell, not duplicated", () => {
    const table = {
      rows: 2, cols: 2,
      cells: [
        { row: 0, col: 0, rowSpan: 2, colSpan: 2, text: "Merged" },
      ],
    };
    const grid = buildTableGrid(table);
    expect(grid[0][0].isOwner).toBe(true);
    expect(grid[0][0].text).toBe("Merged");
    expect(grid[0][1].spanned).toBe(true);
    expect(grid[0][1].ownerRow).toBe(0);
    expect(grid[1][0].spanned).toBe(true);
    expect(grid[1][1].spanned).toBe(true);
  });
});
