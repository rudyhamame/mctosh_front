// pdfHighlightRects.js
//
// One shared place for "PDF.js content.items entry -> on-screen rect,
// given the current page viewport". Pure/DOM-free (no canvas, no React) —
// callers own drawing. Previously this exact math lived inline inside
// PDFPage.jsx's search-highlight draw effect only; it's extracted here so
// Narrative Mode's jump-to-source flash and its layout debug overlay reuse
// the identical formulas instead of a second/third hand-written copy.

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
 */
export const computeHighlightRectsForItemIndexes = (itemIndexes, pageTextItems, viewportTransform) => {
  if (!pageTextItems || !viewportTransform || !itemIndexes?.length) return [];
  const scale = Math.hypot(viewportTransform[0], viewportTransform[1]);
  const rects = [];
  for (const itemIndex of itemIndexes) {
    const item = pageTextItems[itemIndex];
    if (!item) continue;
    const tx = multiplyTransform(viewportTransform, item.transform);
    const fontSize = Math.hypot(tx[0], tx[1]);
    if (fontSize < 1) continue;
    rects.push({
      x: tx[4],
      y: tx[5] - fontSize * 0.85,
      width: Math.max(2, item.width * scale),
      height: fontSize * 1.05,
      itemIndex,
    });
  }
  return rects;
};

/** Transforms a single PDF-space point (e.g. a column-gutter x at some reference y) into viewport space — used by the debug overlay for gutter lines, which aren't tied to any one item. */
export const computeViewportPoint = (x, y, viewportTransform) => {
  const tx = multiplyTransform(viewportTransform, [1, 0, 0, 1, x, y]);
  return { x: tx[4], y: tx[5] };
};
