// pdfDocumentModel.js
//
// Logical Reading Structure layer: groups pdfPageLayout.js's reading-order
// LINE blocks into paragraphs, and flags paragraphs that look like
// headings. This is the structural piece Narrative Mode (PdfNarrativeView)
// renders — a reflowed, provenance-preserving reading view, not a second
// text-extraction pipeline. Every paragraph carries the exact PDF.js
// itemIndexes it was built from, so any paragraph/heading can always be
// traced back to its source coordinates (see pdfHighlightRects.js).
//
// Pure, DOM-free, deterministic — same style as pdfPageLayout.js. Deeper
// layers (sentences, concepts, relations, tables, figures) are deliberately
// NOT built here; this module only reconstructs paragraphs and headings,
// per the project's phased-rollout plan.

import { itemsFromPdfJs, analyzePageLayout, blockToText, computeGutterMinWidth } from "./pdfPageLayout.js";

/** Same avgHeight convention pdfPageLayout.js's own thresholds use — shared here so paragraph-gap and low-confidence-gap detection both reason from the same number. */
const computeAvgHeight = (layout) => {
  const blocks = layout?.blocks || [];
  if (!blocks.length) return 1;
  return layout.lines?.length
    ? layout.lines.reduce((s, l) => s + (l.y2 - l.y1), 0) / layout.lines.length
    : blocks.reduce((s, b) => s + (b.y2 - b.y1), 0) / blocks.length || 1;
};

/** Short digit run or roman numeral — same pattern pdfPageLayout.js's isNumberTabSegment uses for the equivalent gutter-detection signal. */
const isPageNumberLikeText = (text) => {
  const trimmed = (text || "").trim();
  return trimmed.length > 0 && trimmed.length <= 5 && /^[ivxlcdm\d]+$/i.test(trimmed);
};

/**
 * True when a block's own last item is a bare page-number-like token. A
 * line that ends this way is essentially always the tail of one complete
 * table-of-contents/list entry ("Some Section  42") — ordinary wrapped
 * prose never ends a line on an isolated bare number with nothing else
 * following it on that line.
 */
const blockEndsWithPageNumberToken = (block) => {
  const items = block?.items;
  return !!items?.length && isPageNumberLikeText(items[items.length - 1].text);
};

/**
 * Groups layout.blocks (one per reconstructed line, already reading-order
 * + column-tagged by analyzePageLayout) into paragraph-level groups. A new
 * group starts when: the full-width/column-text boundary is crossed
 * (never merged either direction — a heading never absorbs body text or
 * vice versa), the column index changes, the PREVIOUS line in the current
 * group ended with a page-number-like token (see
 * blockEndsWithPageNumberToken — this is what keeps a table-of-contents
 * page from merging many list entries into one giant paragraph: normal
 * line-spacing between consecutive TOC rows looks identical to normal
 * line-spacing within one wrapped prose paragraph, so gap-based grouping
 * alone can't tell them apart, but "did the line I just finished end in
 * its own page number" can), or the vertical gap to the previous block in
 * the same in-progress group exceeds a threshold derived from the page's
 * own average line height (same style as pdfPageLayout.js's
 * `lineTolerance = Math.max(4, avgHeight * 0.6)` — no fixed pixel
 * constants, since a rescaled/re-rendered PDF has no fixed absolute
 * meaning).
 */
export const groupBlocksIntoParagraphs = (layout, avgHeight) => {
  const blocks = layout?.blocks || [];
  if (!blocks.length) return [];
  // Normal single-spaced consecutive lines leave a small extent gap
  // (roughly line-pitch minus line-height); a real paragraph break is
  // visibly larger than that — confirmed against this app's own
  // buildLines/detectGutters threshold style rather than a hand-picked
  // pixel value.
  const paragraphGapThreshold = Math.max(4, avgHeight * 0.7);

  const groups = [];
  let current = null;
  for (const block of blocks) {
    const groupKey = block.isFullWidth ? "full" : `col${block.columnIndex}`;
    const gap = current ? block.y1 - current.lastY2 : Infinity;
    const sameGroup = current && current.key === groupKey && gap <= paragraphGapThreshold && !current.endsWithPageNumber;
    if (sameGroup) {
      current.blocks.push(block);
      current.lastY2 = Math.max(current.lastY2, block.y2);
      current.endsWithPageNumber = blockEndsWithPageNumberToken(block);
    } else {
      current = {
        key: groupKey,
        isFullWidth: block.isFullWidth,
        columnIndex: block.isFullWidth ? null : block.columnIndex,
        blocks: [block],
        lastY2: block.y2,
        endsWithPageNumber: blockEndsWithPageNumberToken(block),
      };
      groups.push(current);
    }
  }
  return groups;
};

/**
 * True when some block in this paragraph has its own internal item-to-item
 * gap wide enough to plausibly be an undetected column boundary — i.e.
 * this paragraph's text might actually be two (or more) merged entries
 * that the geometric reconstruction couldn't cleanly separate. Confirmed
 * live: the two-pass column assignment (analyzePageLayout) classifies
 * every item by x-center against a SINGLE page-wide rough gutter x, but a
 * real document's right-column start position can drift row to row —
 * confirmed on a real corrupted-font TOC page, by a good 40+ points
 * between two entries a few rows apart — so a row whose own right-column
 * content happens to fall on the "wrong" side of that one shared
 * threshold stays merged into its left neighbor's block even though its
 * OWN internal gap is clearly gutter-sized. This is exactly the geometric
 * signal (not a text/language one) that makes such a paragraph a good
 * candidate for the opt-in AI resegment fallback (see PdfNarrativeView).
 *
 * Exempts a gap that leads straight into the BLOCK'S OWN trailing page
 * number (i.e. the last item on the line, and it's bare-number-like) —
 * confirmed live: lowering computeGutterMinWidth's floor to catch this
 * document's narrower real column gutters (see pdfPageLayout.js) also
 * made an entirely ordinary label-to-page-number tab stop wide enough to
 * cross that same floor on nearly every already-correctly-segmented TOC
 * row (a short label with a far-right-aligned page number has a large
 * gap that's completely normal for ONE entry, not evidence of a merge).
 * A gap that leads into anything else — more label text, another word —
 * is still flagged, since that's the actual cross-column-merge signature.
 */
const hasSuspiciousInternalGap = (group, avgHeight) => {
  const gutterMinWidth = computeGutterMinWidth(avgHeight);
  for (const block of group.blocks) {
    const sorted = [...block.items].sort((a, b) => a.x1 - b.x1);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].x1 - sorted[i - 1].x2 < gutterMinWidth) continue;
      const isOwnTrailingPageNumber = i === sorted.length - 1 && isPageNumberLikeText(sorted[i].text);
      if (isOwnTrailingPageNumber) continue;
      return true;
    }
  }
  return false;
};

/** One paragraph group -> its public fields (text, provenance, geometry). Not yet heading-classified. */
const buildParagraphFields = (group, id, avgHeight) => {
  let text = "";
  const itemIndexes = [];
  const itemOffsets = []; // paragraph-local {start, end, itemIndex} — lets an AI resegment response's returned offsets/substrings map straight back to source items, same convention as pdfTextMapping.js's segment maps.
  for (const block of group.blocks) {
    const { text: blockText, itemOffsets: blockOffsets } = blockToText(block);
    // blockToText's own trailing separator (hasEOL -> "\n", else " ") is a
    // page-wide-dump convention (pdfSearchIndex.js's originalText); a
    // narrative paragraph instead reads as flowing prose, so wrapped
    // lines join with a single collapsed space, not a hard line break.
    const trimmed = blockText.replace(/\s+$/, "");
    if (trimmed) {
      // blockToText's own o.start/o.end for each item cover exactly that
      // item's own text, measured BEFORE its trailing separator char is
      // appended — so they're already unaffected by trimming that
      // separator off the end; only a constant shift for where this
      // block lands within the growing paragraph `text` is needed.
      const prefixLen = text.length + (text ? 1 : 0); // +1 for the joining space inserted below
      for (const o of blockOffsets) itemOffsets.push({ start: prefixLen + o.start, end: prefixLen + o.end, itemIndex: o.itemIndex });
      text += (text ? " " : "") + trimmed;
    }
    for (const o of blockOffsets) itemIndexes.push(o.itemIndex);
  }
  const lowConfidence = hasSuspiciousInternalGap(group, avgHeight);
  const xMin = Math.min(...group.blocks.map((b) => b.xMin));
  const xMax = Math.max(...group.blocks.map((b) => b.xMax));
  const y1 = Math.min(...group.blocks.map((b) => b.y1));
  const y2 = Math.max(...group.blocks.map((b) => b.y2));
  // Per-LINE dominant (max) size, then averaged across this paragraph's
  // own lines — not a flat average over every individual item's fontSize.
  // A corrupted/distorted-font document can report SOME characters within
  // an otherwise-normal word/line at a visibly smaller size (confirmed
  // live: roughly half of this document's own glyph-level items measure
  // well under their line's real, intended size), which drags a flat
  // per-item average down enough to make ordinary lines look artificially
  // small — each line's own MAX size is a far more reliable "what size is
  // this line actually set at" signal than averaging every fragment.
  const lineMaxSizes = group.blocks
    .map((b) => Math.max(...b.items.map((it) => it.fontSize).filter(Number.isFinite)))
    .filter(Number.isFinite);
  const avgFontSize = lineMaxSizes.length ? lineMaxSizes.reduce((s, f) => s + f, 0) / lineMaxSizes.length : null;
  return {
    id,
    text,
    columnIndex: group.columnIndex,
    isFullWidth: group.isFullWidth,
    itemIndexes: itemIndexes.sort((a, b) => a - b),
    itemOffsets, // paragraph-local {start,end,itemIndex}[], already in text order — see AI resegment fallback
    lowConfidence,
    boundingBox: { x1: xMin, y1, x2: xMax, y2 },
    avgFontSize,
    lineCount: group.blocks.length,
  };
};

/** Public: layout -> paragraph objects (pre-heading-classification), reading-order, provenance-linked. */
export const buildParagraphs = (layout) => {
  const avgHeight = computeAvgHeight(layout);
  const groups = groupBlocksIntoParagraphs(layout, avgHeight);
  return groups.map((group, index) => buildParagraphFields(group, `p${index}`, avgHeight));
};

const HEADING_SIZE_RATIO = 1.15; // a heading-eligible paragraph's own avg fontSize must be at least this many times body size
const HEADING_MAX_LINES = 2;     // headings are short, isolated lines — not multi-line prose
const BAND_TOLERANCE = 0.12;     // relative (not absolute-pt) font-size clustering tolerance for heading levels

/**
 * Public: paragraphs -> same array with `type`/`level` added. Body-text
 * font size is the MEDIAN of each LINE's own dominant (max) fontSize
 * across the page — not a flat median over every individual item.
 * Confirmed live: a corrupted/distorted-font document can report roughly
 * half of its own glyph-level items at a visibly smaller size than the
 * line they belong to actually reads at, which skews a flat per-item
 * median well below the real body size (measured: 6.3pt "median" on a
 * page whose real body/TOC-entry size was 10pt) and misclassified
 * ordinary single-line entries as headings. Aggregating one size per
 * LINE first avoids that skew, the same way buildParagraphFields' own
 * avgFontSize does. Heading-eligible paragraphs' sizes are then bucketed
 * into relative bands (values within BAND_TOLERANCE of each other = same
 * band) and ranked largest-band-first = level 1, since a rescaled/
 * re-rendered PDF has no fixed absolute pt meaning.
 */
export const detectHeadings = (paragraphs, layout) => {
  const lineMaxSizes = (layout?.blocks || [])
    .map((b) => Math.max(...b.items.map((it) => it.fontSize).filter(Number.isFinite)))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!lineMaxSizes.length) return paragraphs.map((p) => ({ ...p, type: "paragraph" }));
  const bodyFontSize = lineMaxSizes[Math.floor(lineMaxSizes.length / 2)];

  const isEligible = (p) => p.lineCount <= HEADING_MAX_LINES && p.avgFontSize != null && p.avgFontSize >= bodyFontSize * HEADING_SIZE_RATIO;
  const distinctSizesDesc = [...new Set(paragraphs.filter(isEligible).map((p) => p.avgFontSize))].sort((a, b) => b - a);

  const sizeToLevel = new Map();
  let level = 0;
  let bandRepresentative = null;
  for (const size of distinctSizesDesc) {
    if (bandRepresentative === null || size < bandRepresentative * (1 - BAND_TOLERANCE)) {
      level += 1;
      bandRepresentative = size;
    }
    sizeToLevel.set(size, level);
  }

  return paragraphs.map((p) => (
    isEligible(p) ? { ...p, type: "heading", level: sizeToLevel.get(p.avgFontSize) } : { ...p, type: "paragraph" }
  ));
};

/**
 * Public orchestrator. `textItems` is PDF.js's raw content.items for one
 * page (same shape getPageTextItems() in PDFPage.jsx already returns —
 * this module never touches PDF.js/DOM directly, matching
 * pdfSearchIndex.js's buildPageIndex contract).
 */
export const buildPageModel = (pageNumber, textItems) => {
  const spatialItems = itemsFromPdfJs(textItems || []);
  const layout = analyzePageLayout(spatialItems);
  const paragraphs = detectHeadings(buildParagraphs(layout), layout);
  return {
    pageNumber,
    columnCount: layout.columnCount,
    gutters: layout.gutters,
    paragraphs,
  };
};

/**
 * Builds a {blocks, lines}-shaped layout directly from an array of
 * ALREADY reading-order-sorted, already column/row-classified spans —
 * PDFPage.jsx's own spansRef.current after its text-layer effect reorders
 * it (see analyzePageLayout there), not raw PDF.js content.items. Each
 * span needs { text, geoLeft, geoRight, geoTop, geoHeight, rowIndex,
 * columnIndex, pdfItemIndex }. No re-clustering happens here — the
 * spans' own rowIndex/columnIndex are trusted as-is, so this is only
 * correct to call on a genuinely already-ordered/classified array.
 */
export const buildLayoutFromOrderedSpans = (spans) => {
  const blocks = [];
  let current = null;
  for (const sp of spans) {
    if (!current || current.lineIndex !== sp.rowIndex) {
      current = {
        lineIndex: sp.rowIndex,
        columnIndex: sp.columnIndex,
        isFullWidth: sp.columnIndex == null,
        items: [],
        y1: Infinity, y2: -Infinity, xMin: Infinity, xMax: -Infinity,
      };
      blocks.push(current);
    }
    const y1 = sp.geoTop, y2 = sp.geoTop + sp.geoHeight;
    current.items.push({ text: sp.text, x1: sp.geoLeft, x2: sp.geoRight, y1, y2, itemIndex: sp.pdfItemIndex, hasEOL: false, fontSize: sp.geoHeight });
    current.y1 = Math.min(current.y1, y1);
    current.y2 = Math.max(current.y2, y2);
    current.xMin = Math.min(current.xMin, sp.geoLeft);
    current.xMax = Math.max(current.xMax, sp.geoRight);
  }
  return { blocks, lines: blocks };
};

/**
 * Same PageModel shape as buildPageModel, but from PDFPage.jsx's own
 * live, word/whitespace-token-granularity spans instead of recomputing
 * from raw PDF.js items. Prefer this whenever the live spans for that
 * exact page are available (i.e. it's the currently rendered page) — for
 * a document with an unreliable/corrupted embedded font, PDFPage.jsx's
 * canvas-remeasured token widths have been confirmed (live, this
 * session) to produce a more reliable column/gutter reconstruction than
 * PDF.js's own native per-item advance widths at raw item granularity,
 * which is all buildPageModel/itemsFromPdfJs have to work with. Falls
 * back to `gutters: []` — the debug overlay's gutter-line layer is purely
 * a visualization aid and this path already carries each block's own
 * resolved columnIndex, so it doesn't need a separate gutter x-position.
 */
export const buildPageModelFromOrderedSpans = (pageNumber, spans) => {
  const layout = buildLayoutFromOrderedSpans(spans || []);
  const paragraphs = detectHeadings(buildParagraphs(layout), layout);
  const columnIndexes = new Set(layout.blocks.filter((b) => !b.isFullWidth).map((b) => b.columnIndex));
  return {
    pageNumber,
    columnCount: Math.max(1, columnIndexes.size || 1),
    gutters: [],
    paragraphs,
  };
};

/** Mirrors createPageIndexCache()'s exact shape (pdfSearchIndex.js). */
export const createPageModelCache = () => {
  const cache = new Map();
  return {
    get(pageNumber, textItems) {
      const existing = cache.get(pageNumber);
      if (existing) return existing;
      const built = buildPageModel(pageNumber, textItems);
      cache.set(pageNumber, built);
      return built;
    },
    clear() {
      cache.clear();
    },
  };
};
