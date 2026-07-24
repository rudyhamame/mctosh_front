import { describe, expect, it } from "vitest";
import { buildRawHyle, buildSegmentedHyle } from "./pdfHyleStats.js";

// Fake PDF.js content.items — same shape/convention as pdfFuzzySearch.test.js's
// mkItems: one item per fragment, positioned left-to-right, zero gap between
// consecutive items on a line, one row per line. Under the IDENTITY_VT used
// below, itemsFromPdfJs passes item.transform's own y straight through, so
// rows are given ascending y (0, 20, 40, ...) to land in top-to-bottom
// reading order — matching real viewport space's y-grows-downward
// convention, which real pageViewport.transform values also produce.
const mkItems = (rows) => {
  const items = [];
  let y = 0;
  const fontSize = 12;
  for (const row of rows) {
    let x = 0;
    row.forEach((str, i) => {
      const width = str.length * 6;
      items.push({ str, width, hasEOL: i === row.length - 1, transform: [fontSize, 0, 0, fontSize, x, y] });
      x += width;
    });
    y += 20;
  }
  return items;
};
const IDENTITY_VT = [1, 0, 0, 1, 0, 0];

describe("buildRawHyle", () => {
  it("keeps every item separate, in raw stream order, with no reading-order interpretation", () => {
    const items = mkItems([["myoc", "ardial"], ["infar", "ction"]]);
    const raw = buildRawHyle(items);
    expect(raw.items.map((it) => it.text)).toEqual(["myoc", "ardial", "infar", "ction"]);
    expect(raw.items.map((it) => it.itemIndex)).toEqual([0, 1, 2, 3]);
  });

  it("joins into a plain-text view using PDF.js's own hasEOL, one newline per line end", () => {
    const items = mkItems([["Heart", "failure"], ["Chest", "pain"]]);
    const raw = buildRawHyle(items);
    expect(raw.text).toBe("Heart failure\nChest pain");
  });

  it("skips items with no string content", () => {
    const items = [{ str: "", width: 0, hasEOL: false, transform: [12, 0, 0, 12, 0, 0] }, ...mkItems([["Real"]])];
    const raw = buildRawHyle(items);
    expect(raw.items).toHaveLength(1);
    expect(raw.items[0].text).toBe("Real");
  });

  it("returns empty items/text for no input", () => {
    expect(buildRawHyle([])).toEqual({ items: [], text: "" });
    expect(buildRawHyle(null)).toEqual({ items: [], text: "" });
  });
});

describe("buildSegmentedHyle", () => {
  it("produces one segment per visual line, in reading order", () => {
    const items = mkItems([["Heart", "failure", "is", "common"], ["Chest", "pain", "varies"]]);
    const { segments, lineCount } = buildSegmentedHyle(items, IDENTITY_VT);
    expect(lineCount).toBe(2);
    expect(segments).toHaveLength(2);
  });

  it("counts each line's own words and each word's own character count", () => {
    const items = mkItems([["Heart", "failure", "is", "common"]]);
    const { segments } = buildSegmentedHyle(items, IDENTITY_VT);
    expect(segments[0].wordCount).toBe(4);
    expect(segments[0].words).toEqual([
      { text: "Heart", chars: 5 },
      { text: "failure", chars: 7 },
      { text: "is", chars: 2 },
      { text: "common", chars: 6 },
    ]);
    expect(segments[0].charCount).toBe(5 + 7 + 2 + 6);
  });

  it("gives each segment a viewport-space bbox usable directly for a canvas overlay box", () => {
    const items = mkItems([["Heart", "failure"]]);
    const { segments } = buildSegmentedHyle(items, IDENTITY_VT);
    const bbox = segments[0].bbox;
    expect(bbox.x).toBe(0); // starts at the first item's left edge
    expect(bbox.width).toBeGreaterThan(0);
    expect(bbox.height).toBeGreaterThan(0);
  });

  it("carries the underlying PDF.js item indexes behind each line", () => {
    const items = mkItems([["Heart", "failure"], ["Chest", "pain"]]);
    const { segments } = buildSegmentedHyle(items, IDENTITY_VT);
    expect(segments[0].itemIndexes).toEqual([0, 1]);
    expect(segments[1].itemIndexes).toEqual([2, 3]);
  });

  it("returns no segments for an empty page", () => {
    expect(buildSegmentedHyle([], IDENTITY_VT)).toEqual({ segments: [], lineCount: 0 });
  });
});
