// pdfHyleStats.js
//
// Pure helpers behind the PDF page canvas's "AMCTOSHS Hyle" floating
// button. Per this app's own AMCTOSHS vocabulary (see AboutPage.jsx:
// "Before extraction a word is a Hyle — undifferentiated matter"), a page
// has layers of imposed structure sitting on top of its raw substrate:
//
//   Raw Hyle       — the page's text exactly as PDF.js extracted it, in
//                     its own stream order, with NO reading-order/layout
//                     interpretation imposed (that reconstruction is
//                     itself a "form" — see pdfPageLayout.js's own module
//                     comment — so Raw Hyle deliberately skips it).
//   Segmented Hyle — the same page's own geometric line/column structure
//                     (pdfPageLayout.js's analyzePageLayout, which is
//                     ALREADY column-aware reading-order reconstruction),
//                     with each line's word count and each word's own
//                     character count exposed — a detailed counterpart to
//                     the Narrative Mode debug overlay (PDFPage.jsx),
//                     which labels AI-produced segments; this labels
//                     purely geometric ones instead.
//
// Both are pure/DOM-free: given plain PDF.js content.items (+ an optional
// viewport transform for on-screen bbox math), no canvas/React involved —
// PDFPage.jsx owns drawing and panel rendering.

import { itemsFromPdfJs, analyzePageLayout } from "./pdfPageLayout.js";

/**
 * Raw Hyle: every PDF.js text item's own string, in RAW stream order
 * (item index — NOT reading order), each item kept separate rather than
 * pre-joined into lines/paragraphs. `text` is a convenience flattening
 * for a plain-text view (item strings joined by a space, "\n" instead
 * wherever PDF.js itself reports item.hasEOL) — still no layout analysis,
 * just PDF.js's own hasEOL flag.
 */
export const buildRawHyle = (pdfJsItems) => {
  const items = [];
  for (let itemIndex = 0; itemIndex < (pdfJsItems || []).length; itemIndex++) {
    const raw = pdfJsItems[itemIndex];
    const text = raw?.str || "";
    if (!text) continue;
    items.push({ itemIndex, text, hasEOL: !!raw.hasEOL });
  }
  let text = "";
  for (const it of items) text += it.text + (it.hasEOL ? "\n" : " ");
  return { items, text: text.trimEnd() };
};

const WORD_RE = /\S+/g;

/** Splits one line's own reconstructed text into words, each with its own character count. */
const wordsForLineText = (lineText) => {
  const words = [];
  WORD_RE.lastIndex = 0;
  let m;
  while ((m = WORD_RE.exec(lineText))) words.push({ text: m[0], chars: m[0].length });
  return words;
};

/**
 * Segmented Hyle: one entry per geometric line/column-block from
 * pdfPageLayout.js's analyzePageLayout (already reading-order sorted,
 * already column-aware — a block is one visual line, or one column-slice
 * of a line that crosses a detected column gutter). Each entry carries:
 *   - bbox: viewport-space {x,y,width,height} — already usable directly
 *     for a canvas overlay box when `viewportTransform` was passed
 *     through to itemsFromPdfJs (no per-item rect lookup needed, unlike
 *     the item-index-based search/debug overlays elsewhere in this app).
 *   - words: [{text, chars}], one per whitespace-delimited word on that
 *     line, each with its own character count.
 *   - wordCount / charCount: the line's own totals (sum of its words'
 *     char counts — whitespace between words isn't counted as a
 *     character of any word).
 */
export const buildSegmentedHyle = (pdfJsItems, viewportTransform = null) => {
  const spatialItems = itemsFromPdfJs(pdfJsItems || [], viewportTransform);
  const { blocks } = analyzePageLayout(spatialItems);
  const segments = blocks.map((block, index) => {
    const lineText = block.items.map((it) => it.text).join(" ").trim();
    const words = wordsForLineText(lineText);
    return {
      index,
      lineIndex: block.lineIndex,
      bbox: { x: block.xMin, y: block.y1, width: Math.max(0, block.xMax - block.xMin), height: Math.max(0, block.y2 - block.y1) },
      itemIndexes: block.items.map((it) => it.itemIndex),
      words,
      wordCount: words.length,
      charCount: words.reduce((sum, w) => sum + w.chars, 0),
    };
  });
  return { segments, lineCount: segments.length };
};
