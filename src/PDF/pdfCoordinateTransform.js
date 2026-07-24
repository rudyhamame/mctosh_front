// pdfCoordinateTransform.js
//
// The one authoritative coordinate-transform utility for the hybrid PDF
// structure pipeline's canonical geometry (bboxes returned by
// back/pdf-structure and reconciled by back/helpers/pdfStructureFusion.js)
// -> PDF.js viewport/display space, used for every overlay/highlight in
// PdfNarrativeView.jsx and PDFPage.jsx that renders a v2 structure.
//
// Canonical space contract (see back/pdf-structure/README.md's own
// "Coordinate contract" section, which this mirrors): top-left origin, Y
// increasing downward, in PDF points, with dimensions already matching
// the PAGE's own rotated width/height (native_extraction.py applies
// page.rotation_matrix to every bbox before it ever leaves that service —
// confirmed live that PyMuPDF's raw get_text() output is NOT
// rotation-normalized on its own, this is a real fix, not an assumption).
//
// PDF.js's own viewport space (pageViewport, from page.getViewport({scale,
// rotation})) is ALSO top-left-origin, Y-down, with width/height already
// reflecting rotation. Both are the SAME orientation/origin convention —
// the only remaining difference between them is the scale factor. This is
// why the mapping below is a pure uniform scale by pageViewport.scale,
// with NO rotation matrix and no y-flip: reusing pageViewport.transform
// directly (as pdfPageLayout.js's own transformItem does) would be WRONG
// here, because that transform is built to map FROM raw, Y-UP, non-
// rotation-normalized PDF item space — feeding already-rotation-normalized,
// already-Y-down canonical coordinates through it would double-apply the
// Y-flip. If this assumption ever proves wrong on a real rotated page
// (not yet verified against one — see this module's own test file), the
// fix is an explicit rotation+scale matrix here, not a redesign of
// anything downstream.

/** One canonical [x1,y1,x2,y2] bbox -> viewport-space {x,y,width,height}, ready for direct canvas/CSS use. */
export const canonicalToViewportRect = (bbox, pageViewport) => {
  const scale = pageViewport?.scale ?? 1;
  const [x1, y1, x2, y2] = bbox;
  const vx1 = x1 * scale;
  const vy1 = y1 * scale;
  const vx2 = x2 * scale;
  const vy2 = y2 * scale;
  return { x: Math.min(vx1, vx2), y: Math.min(vy1, vy2), width: Math.abs(vx2 - vx1), height: Math.abs(vy2 - vy1) };
};

/** One canonical (x,y) point -> viewport-space {x,y}. */
export const canonicalToViewportPoint = (x, y, pageViewport) => {
  const scale = pageViewport?.scale ?? 1;
  return { x: x * scale, y: y * scale };
};
