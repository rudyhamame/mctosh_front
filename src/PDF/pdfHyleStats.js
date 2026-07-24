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
// PDFPage.jsx owns drawing (there's no separate list/panel UI — both
// layers are shown entirely as an overlay drawn directly on the page).

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
 *     for a canvas overlay box, positioned/sized for the CURRENT zoom
 *     when a `viewportTransform` is given.
 *   - words: [{text, chars}], one per whitespace-delimited word on that
 *     line, each with its own character count.
 *   - wordCount / charCount: the line's own totals (sum of its words'
 *     char counts — whitespace between words isn't counted as a
 *     character of any word).
 * Deliberately line-level only — no grouping of lines into paragraph or
 * article containers of any kind (an earlier version of this function
 * did, via pdfDocumentModel.js's geometric paragraph/heading grouper;
 * removed at the user's explicit request after that grouping repeatedly
 * misgrouped real content — see this repo's own history on
 * pdfDocumentModel.js before its removal).
 * Also returns `columnGutterXs`: the x position of each detected column
 * gutter (pdfPageLayout.js's own analyzePageLayout — same detection that
 * decides each line's columnIndex), converted to display space so a
 * caller can draw a vertical separator line down the page at each one.
 *
 * The STRUCTURAL decision (which lines/columns exist at all) is made in
 * a FIXED, zoom-independent coordinate space — itemsFromPdfJs called with
 * no viewportTransform, which falls back to PDF.js's own raw item.transform
 * (see that function's own comment: "every threshold this module uses is
 * derived from the data's own average line height... only the ABSOLUTE
 * numbers differ, never the relative ones" — true only as long as the
 * SAME scale is used consistently for a given page; the small fixed-px
 * floors analyzePageLayout also uses, e.g. computeGutterMinWidth's own
 * `Math.max(16, ...)`, are a different FRACTION of the content at
 * different zoom levels if run in zoom-scaled space, which was silently
 * reclassifying — sometimes splitting, sometimes merging — lines/columns
 * differently every time the user zoomed). Running that decision once,
 * here, at a fixed scale keeps "what the lines are" stable across zoom;
 * only WHERE they're drawn on screen (via a second, display-only pass
 * over the SAME already-decided items, looked up by itemIndex) varies
 * with the given `viewportTransform`.
 */
export const buildSegmentedHyle = (pdfJsItems, viewportTransform = null) => {
  const structuralItems = itemsFromPdfJs(pdfJsItems || []);
  const layout = analyzePageLayout(structuralItems);
  const { blocks, gutters } = layout;

  // layout.gutters are x-positions in the SAME fixed structural space as
  // structuralItems (see this function's own comment on why the
  // structural pass never uses viewportTransform) — a single scalar per
  // gutter, not tied to any one item, so they need their own conversion
  // to display space rather than reusing displayItemsByIndex below
  // (itemIndex-keyed, no entry for a bare x position). Only the x
  // (horizontal-scale + horizontal-translate) terms of viewportTransform
  // apply — same axis-aligned-viewport assumption this whole module
  // already relies on elsewhere (e.g. transformItem's own math), so a
  // vertical gutter line's x doesn't depend on y at all.
  const columnGutterXs = viewportTransform
    ? gutters.map((gx) => viewportTransform[0] * gx + viewportTransform[4])
    : gutters;

  const displayItemsByIndex = new Map();
  if (viewportTransform) {
    for (const it of itemsFromPdfJs(pdfJsItems || [], viewportTransform)) displayItemsByIndex.set(it.itemIndex, it);
  }
  const displayBboxForItemIndexes = (itemIndexes, fallback) => {
    const displayItems = viewportTransform
      ? itemIndexes.map((i) => displayItemsByIndex.get(i)).filter(Boolean)
      : null;
    if (displayItems && displayItems.length) {
      return {
        x: Math.min(...displayItems.map((it) => it.x1)),
        y: Math.min(...displayItems.map((it) => it.y1)),
        x2: Math.max(...displayItems.map((it) => it.x2)),
        y2: Math.max(...displayItems.map((it) => it.y2)),
      };
    }
    return { x: fallback.x1, y: fallback.y1, x2: fallback.x2, y2: fallback.y2 };
  };

  const segments = blocks.map((block, index) => {
    const lineText = block.items.map((it) => it.text).join(" ").trim();
    const words = wordsForLineText(lineText);
    const itemIndexes = block.items.map((it) => it.itemIndex);
    const b = displayBboxForItemIndexes(itemIndexes, { x1: block.xMin, y1: block.y1, x2: block.xMax, y2: block.y2 });
    return {
      index,
      lineIndex: block.lineIndex,
      bbox: { x: b.x, y: b.y, width: Math.max(0, b.x2 - b.x), height: Math.max(0, b.y2 - b.y) },
      itemIndexes,
      words,
      wordCount: words.length,
      charCount: words.reduce((sum, w) => sum + w.chars, 0),
    };
  });

  return { segments, lineCount: segments.length, columnGutterXs };
};

/**
 * Positions a line's numbered marker — one per line, and EVERY line gets
 * one, no exceptions — always just to the right of that line's own
 * content (same coordinate space as `boxes[index]`), clamped so it never
 * runs off the page edge. Deliberately the SAME rule for every line,
 * always, rather than a per-line preference order (right, then above,
 * then below, then a clamped fallback) — a numbered marker (the line's
 * own number, spec) reads as a consistent, predictable margin annotation
 * only if it always sits in the same relative spot; varying its side
 * line-to-line was the right instinct for an unlabeled dot, but not for
 * something the reader is meant to visually scan down a column. Only
 * returns null for a degenerate (zero-size) box, which a real line
 * never has.
 */
export const computeMarkerPosition = (index, boxes, canvasWidth, markerSize, gap = 4) => {
  const box = boxes[index];
  if (!box || box.width <= 0 || box.height <= 0) return null;
  const midY = box.y + box.height / 2;
  const x = Math.min(box.x + box.width + gap, Math.max(0, canvasWidth - markerSize - 2));
  return { x, y: midY - markerSize / 2 };
};
