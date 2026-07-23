import { describe, expect, it } from "vitest";
import { buildPageElements, parseElementId } from "./pdfPageEvidence.js";

// Same fake-PDF.js-item shape convention as pdfFuzzySearch.test.js's own
// mkItems helper — real positions (transform), not just text, since
// itemsFromPdfJs (which buildPageElements wraps) needs them.
const mkItems = (strs) => {
  let cursorX = 0;
  const fontSize = 12;
  return strs.map((s) => {
    const width = s.length * 6;
    const it = { str: s, width, hasEOL: false, transform: [fontSize, 0, 0, fontSize, cursorX, 0] };
    cursorX += width;
    return it;
  });
};

describe("pdfPageEvidence — buildPageElements", () => {
  it("gives each element a stable, deterministic id keyed to page number and item order", () => {
    const items = mkItems(["Heart failure", "with preserved ejection fraction"]);
    const elements = buildPageElements(17, items);
    expect(elements).toHaveLength(2);
    expect(elements[0].id).toBe("el-17-0");
    expect(elements[1].id).toBe("el-17-1");
  });

  it("preserves the original text verbatim and includes a numeric bbox/fontSize", () => {
    const items = mkItems(["Bradycardia"]);
    const [el] = buildPageElements(3, items);
    expect(el.text).toBe("Bradycardia");
    expect(el.bbox).toHaveLength(4);
    expect(el.bbox.every((n) => Number.isFinite(n))).toBe(true);
    expect(el.fontSize).toBeGreaterThan(0);
  });

  it("produces the same ids for the same page across repeated calls (deterministic, not incidental)", () => {
    const items = mkItems(["A", "B", "C"]);
    const first = buildPageElements(5, items).map((e) => e.id);
    const second = buildPageElements(5, items).map((e) => e.id);
    expect(first).toEqual(second);
  });

  it("gives different pages different ids for the same item order (no cross-page collision)", () => {
    const items = mkItems(["Same text"]);
    const p1 = buildPageElements(1, items)[0].id;
    const p2 = buildPageElements(2, items)[0].id;
    expect(p1).not.toBe(p2);
  });
});

describe("pdfPageEvidence — parseElementId", () => {
  it("round-trips an id produced by buildPageElements", () => {
    const [el] = buildPageElements(42, mkItems(["x"]));
    expect(parseElementId(el.id)).toEqual({ pageNumber: 42, itemIndex: 0 });
  });

  it("returns null for anything not shaped like a real element id", () => {
    expect(parseElementId("not-an-id")).toBeNull();
    expect(parseElementId("")).toBeNull();
    expect(parseElementId(undefined)).toBeNull();
    expect(parseElementId("segment-4")).toBeNull();
  });
});
