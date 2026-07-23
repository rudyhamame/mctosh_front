// pdfPageEvidence.js
//
// Builds the PDF.js-derived "elements" evidence array sent to AI page
// segmentation (pdfPageStructureClient.js) — one entry per raw PDF.js
// content.items entry (item-level granularity, matching the spec's own
// examples: "Heart failure with preserved ejection fraction" as ONE
// element, not split into words), with a STABLE id that's deterministic
// from page number + item order — never a DOM/React id (spec §61).
//
// Pure, DOM-free — reuses pdfPageLayout.js's existing itemsFromPdfJs
// (already-tested geometry math) rather than re-deriving x/y/width/height
// from item.transform a second time.

import { itemsFromPdfJs } from "./pdfPageLayout.js";

const ELEMENT_ID_RE = /^el-(\d+)-(\d+)$/;

/** `el-{pageNumber}-{itemIndex}` — itemIndex is itemsFromPdfJs's own stable per-page item order, not any DOM/React identity. */
const makeElementId = (pageNumber, itemIndex) => `el-${pageNumber}-${itemIndex}`;

/** Reverse of makeElementId. Returns null for anything not shaped like one of these ids (e.g. a stale id from a different id scheme). */
export const parseElementId = (id) => {
  const match = ELEMENT_ID_RE.exec(String(id || ""));
  if (!match) return null;
  return { pageNumber: Number(match[1]), itemIndex: Number(match[2]) };
};

/**
 * `textItems` is PDF.js's raw content.items for one page (same shape
 * getPageTextItems() in PDFPage.jsx already returns). Returns
 * [{id, text, bbox:[x1,y1,x2,y2], fontSize}], in item order.
 */
export const buildPageElements = (pageNumber, textItems) => {
  const spatialItems = itemsFromPdfJs(textItems || []);
  return spatialItems.map((it) => ({
    id: makeElementId(pageNumber, it.itemIndex),
    text: it.text,
    bbox: [Math.round(it.x1), Math.round(it.y1), Math.round(it.x2), Math.round(it.y2)],
    fontSize: it.fontSize != null ? Math.round(it.fontSize * 10) / 10 : null,
  }));
};
