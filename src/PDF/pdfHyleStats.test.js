import { describe, expect, it } from "vitest";
import { buildRawHyle, buildSegmentedHyle, computeMarkerPosition } from "./pdfHyleStats.js";

// Fake PDF.js content.items — same shape/convention as pdfFuzzySearch.test.js's
// mkItems: one item per fragment, positioned left-to-right, zero gap between
// consecutive items on a line, one row per line.
//
// item.transform[5] (Ty) is set to PAGE_HEIGHT - y, DECREASING as rows go
// down the page — matching how real PDF.js item transforms actually work
// (PDF space has a bottom-left origin, so the first/top line of text sits
// at the LARGEST Ty, not the smallest). This matters now that
// buildSegmentedHyle runs its structural analysis in RAW PDF space
// (itemsFromPdfJs with no transform, which negates Ty — see that
// function's own comment) and a SEPARATE display pass through a real
// viewport-style transform (VIEWPORT_VT below, with a negative d
// component like PDF.js's own viewport.transform always has) — both
// passes only agree on top-to-bottom row order if the fixture's own Ty
// values follow the real convention, not an arbitrary increasing one.
const PAGE_HEIGHT = 1000;
const mkItems = (rows) => {
  const items = [];
  let y = 0;
  const fontSize = 12;
  for (const row of rows) {
    let x = 0;
    row.forEach((str, i) => {
      const width = str.length * 6;
      items.push({ str, width, hasEOL: i === row.length - 1, transform: [fontSize, 0, 0, fontSize, x, PAGE_HEIGHT - y] });
      x += width;
    });
    y += 20;
  }
  return items;
};
// A realistic viewport transform (scale 1, y-flipped, like PDF.js's own
// page.getViewport().transform always is) rather than a pure identity
// matrix — see the mkItems comment above for why the flip specifically
// matters for this module's two-coordinate-space design. Under this
// transform a row built at "y" above lands at display y = y itself (the
// PAGE_HEIGHT terms cancel), so existing bbox.y assertions stay simple
// round numbers.
const VIEWPORT_VT = [1, 0, 0, -1, 0, PAGE_HEIGHT];

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
    const { segments, lineCount } = buildSegmentedHyle(items, VIEWPORT_VT);
    expect(lineCount).toBe(2);
    expect(segments).toHaveLength(2);
  });

  it("counts each line's own words and each word's own character count", () => {
    const items = mkItems([["Heart", "failure", "is", "common"]]);
    const { segments } = buildSegmentedHyle(items, VIEWPORT_VT);
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
    const { segments } = buildSegmentedHyle(items, VIEWPORT_VT);
    const bbox = segments[0].bbox;
    expect(bbox.x).toBe(0); // starts at the first item's left edge
    expect(bbox.width).toBeGreaterThan(0);
    expect(bbox.height).toBeGreaterThan(0);
  });

  it("carries the underlying PDF.js item indexes behind each line", () => {
    const items = mkItems([["Heart", "failure"], ["Chest", "pain"]]);
    const { segments } = buildSegmentedHyle(items, VIEWPORT_VT);
    expect(segments[0].itemIndexes).toEqual([0, 1]);
    expect(segments[1].itemIndexes).toEqual([2, 3]);
  });

  it("returns no segments for an empty page", () => {
    expect(buildSegmentedHyle([], VIEWPORT_VT)).toEqual({ segments: [], lineCount: 0, columnGutterXs: [] });
  });

  it("keeps the same line/column structure regardless of the given zoom scale — only on-screen position should change", () => {
    // A two-column layout with a real recurring gutter (same shape as
    // pdfPageLayout.test.js's own verified two-column fixture). At a
    // small enough scale, analyzePageLayout's own small fixed-px floors
    // (e.g. computeGutterMinWidth's `Math.max(16, avgHeight * 1.7)`)
    // would dominate over the page's own (now tiny) avgHeight if the
    // structural decision were made in zoom-scaled space — silently
    // reclassifying columns/lines differently at low zoom than at high
    // zoom. buildSegmentedHyle must never do that: the structural pass
    // always runs at a fixed scale, so both should come out identical.
    const rows = [
      ["Electrocardiogram", "18", "Dyslipidemia", "55"],
      ["Cardiac Physical Exam", "22", "Hypertension", "57"],
      ["Arrhythmias", "25", "Pericardial Disease", "64"],
      ["Congestive Heart Failure", "34", "Endocarditis", "67"],
      ["Cardiomyopathy", "40", "Vascular Diseases", "75"],
    ];
    const leftWidths = [110, 130, 70, 145, 90];
    const rightWidths = [75, 65, 120, 70, 110];
    const items = [];
    rows.forEach((row, i) => {
      const Ty = PAGE_HEIGHT - i * 20;
      const push = (str, x, width) => items.push({ str, width, hasEOL: false, transform: [12, 0, 0, 12, x, Ty] });
      push(row[0], 60, leftWidths[i]);
      push(row[1], 330, 20);
      push(row[2], 500, rightWidths[i]);
      push(row[3], 660, 20);
    });

    // Low-zoom-like (small scale) vs. high-zoom-like (large scale) —
    // both real-shaped viewport transforms (y-flipped, like PDF.js's own).
    const lowZoomVT = [0.3, 0, 0, -0.3, 0, PAGE_HEIGHT * 0.3];
    const highZoomVT = [2.5, 0, 0, -2.5, 0, PAGE_HEIGHT * 2.5];

    const lowZoom = buildSegmentedHyle(items, lowZoomVT);
    const highZoom = buildSegmentedHyle(items, highZoomVT);

    expect(lowZoom.lineCount).toBe(highZoom.lineCount);
    expect(lowZoom.segments.map((s) => s.itemIndexes)).toEqual(highZoom.segments.map((s) => s.itemIndexes));
    // Sanity: positions themselves DO still scale with zoom (that part is
    // supposed to vary) — the high-zoom bbox should be noticeably wider.
    expect(highZoom.segments[0].bbox.width).toBeGreaterThan(lowZoom.segments[0].bbox.width);
    // The detected gutter's own display-space x should scale with zoom
    // the same way a line's bbox does — same underlying structural x,
    // just converted through a bigger/smaller viewportTransform.
    expect(lowZoom.columnGutterXs).toHaveLength(1);
    expect(highZoom.columnGutterXs).toHaveLength(1);
    expect(highZoom.columnGutterXs[0]).toBeGreaterThan(lowZoom.columnGutterXs[0]);
  });

  it("returns no column gutters for an ordinary single-column page", () => {
    const items = mkItems([["Heart", "failure", "is", "common"], ["Chest", "pain", "varies"]]);
    const { columnGutterXs } = buildSegmentedHyle(items, VIEWPORT_VT);
    expect(columnGutterXs).toEqual([]);
  });
});

describe("computeMarkerPosition", () => {
  const box = (x, y, width, height) => ({ x, y, width, height });

  it("always places the marker just to the right of the line's own content", () => {
    const boxes = [box(0, 0, 100, 20)];
    const pos = computeMarkerPosition(0, boxes, 400, 16);
    expect(pos.x).toBe(100 + 4); // box.x + box.width + gap
    expect(pos.y).toBe(0 + 10 - 8); // vertical center minus half the marker size
  });

  it("still places it to the right (clamped onto the page) even when the line runs almost to the page edge", () => {
    const boxes = [box(0, 0, 380, 20)];
    const pos = computeMarkerPosition(0, boxes, 400, 16);
    expect(pos.x).toBeLessThanOrEqual(400 - 16 - 2); // clamped fully onto the page
    expect(pos.x).toBeGreaterThanOrEqual(0);
  });

  it("keeps the same right-side rule regardless of neighboring lines — no above/below fallback", () => {
    // Densely packed, wedged tight — a line that would previously have
    // needed an above/below/clamped-fallback branch now just clamps to
    // the page's right edge, same as any other line.
    const boxes = [
      box(0, 0, 380, 20),
      box(0, 22, 380, 20),
      box(0, 44, 380, 20),
    ];
    const pos = computeMarkerPosition(1, boxes, 400, 16);
    expect(pos).not.toBeNull();
    expect(pos.x).toBeLessThanOrEqual(400 - 16 - 2);
    expect(pos.x).toBeGreaterThanOrEqual(0);
  });

  it("returns null for a degenerate (zero-size) box", () => {
    expect(computeMarkerPosition(0, [box(0, 0, 0, 0)], 400, 16)).toBeNull();
  });
});
