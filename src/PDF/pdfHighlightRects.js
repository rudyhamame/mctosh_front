// pdfHighlightRects.js
//
// One shared place for "PDF.js content.items entry -> on-screen rect,
// given the current page viewport". Pure/DOM-free (no canvas, no React) —
// callers own drawing. Previously this exact math lived inline inside
// PDFPage.jsx's search-highlight draw effect only; it's extracted here so
// Narrative Mode's jump-to-source flash and its layout debug overlay reuse
// the identical formulas instead of a second/third hand-written copy.

import { canonicalToViewportRect } from "./pdfCoordinateTransform.js";

/** pageViewport.transform × item.transform, same convention used throughout this app's PDF-space math. */
const multiplyTransform = (viewportTransform, itemTransform) => {
  const vt = viewportTransform;
  const [a2, b2, c2, d2, e2, f2] = itemTransform;
  return [
    vt[0] * a2 + vt[2] * b2,
    vt[1] * a2 + vt[3] * b2,
    vt[0] * c2 + vt[2] * d2,
    vt[1] * c2 + vt[3] * d2,
    vt[0] * e2 + vt[2] * f2 + vt[4],
    vt[1] * e2 + vt[3] * f2 + vt[5],
  ];
};

/**
 * Computes an on-screen rect for every itemIndex that resolves to a real
 * PDF.js text item, given that page's raw content.items and the current
 * pageViewport.transform. Skips (does not throw on) missing items or
 * degenerate font sizes — same tolerant behavior the original inline
 * search-highlight code had.
 *
 * `itemRanges` (optional) is the per-item [localStart, localEnd)/
 * itemLength data from pdfTextMapping.js's originalRangeToItemIndexes —
 * when an item has an entry there, only the fraction of its width
 * covered by [localStart, localEnd) is drawn, so a match that's just one
 * word inside a longer text item (or only partially covers its first/
 * last item) highlights that word rather than the item's whole line.
 * Character positions are assumed roughly proportional to on-screen
 * width (reasonable for the short, mostly-monospaced-enough spans a
 * search match spans — exact per-glyph advances aren't available from
 * PDF.js's plain text-content items). Callers that don't pass
 * `itemRanges` (Narrative Mode's jump-to-source flash, the layout debug
 * overlay) keep the original whole-item behavior.
 */
export const computeHighlightRectsForItemIndexes = (itemIndexes, pageTextItems, viewportTransform, itemRanges) => {
  if (!pageTextItems || !viewportTransform || !itemIndexes?.length) return [];
  const scale = Math.hypot(viewportTransform[0], viewportTransform[1]);
  const rangeByIndex = new Map();
  if (itemRanges?.length) {
    for (const r of itemRanges) rangeByIndex.set(r.itemIndex, r);
  }
  const rects = [];
  for (const itemIndex of itemIndexes) {
    const item = pageTextItems[itemIndex];
    if (!item) continue;
    const tx = multiplyTransform(viewportTransform, item.transform);
    const fontSize = Math.hypot(tx[0], tx[1]);
    if (fontSize < 1) continue;

    let startFrac = 0, endFrac = 1;
    const range = rangeByIndex.get(itemIndex);
    if (range && range.itemLength > 0) {
      startFrac = range.localStart / range.itemLength;
      endFrac = range.localEnd / range.itemLength;
    }
    const fullWidth = item.width * scale;
    rects.push({
      x: tx[4] + startFrac * fullWidth,
      y: tx[5] - fontSize * 0.85,
      width: Math.max(2, (endFrac - startFrac) * fullWidth),
      height: fontSize * 1.05,
      itemIndex,
    });
  }
  return rects;
};

/**
 * v2 structure sibling of computeHighlightRectsForItemIndexes — for
 * canonical (hybrid-pipeline) bboxes, which have no PDF.js itemIndex to
 * look up (a Docling-only figure/table region, an OCR'd word, or any
 * element whose bbox came from server-side fusion rather than a 1:1
 * client-side PDF.js item). Uses pdfCoordinateTransform.js's pure-scale
 * mapping (see that module's own comment for why no rotation matrix is
 * needed here, unlike multiplyTransform above). `bboxes` is an array of
 * canonical [x1,y1,x2,y2] arrays; returns one rect per bbox, in order.
 */
export const computeHighlightRectsForCanonicalBboxes = (bboxes, pageViewport) => {
  if (!pageViewport || !bboxes?.length) return [];
  return bboxes.map((bbox) => canonicalToViewportRect(bbox, pageViewport));
};

/** Transforms a single PDF-space point (e.g. a column-gutter x at some reference y) into viewport space — used by the debug overlay for gutter lines, which aren't tied to any one item. */
export const computeViewportPoint = (x, y, viewportTransform) => {
  const tx = multiplyTransform(viewportTransform, [1, 0, 0, 1, x, y]);
  return { x: tx[4], y: tx[5] };
};
