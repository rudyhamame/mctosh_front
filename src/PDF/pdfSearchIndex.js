// pdfSearchIndex.js
//
// Builds the per-page "page representation" the rest of the tolerant-search
// system searches against, from PDF.js's raw content.items (exactly what
// getPageTextItems() in PDFPage.jsx already returns — this module doesn't
// touch PDF.js or the DOM at all, just the plain-data items array):
//
//   {
//     pageNumber,
//     originalText,              // joined item.str, hasEOL -> "\n" else " "
//     normalizedText, caseFoldedText, compactText,
//     normalizedToOriginalMap, compactToNormalizedMap,
//     itemOffsets,                // [{ start, end, itemIndex }] in originalText coords
//     tokens,                     // [{ text, normStart, normEnd }] words in normalizedText
//     searchableChunks,           // sentence-ish windows for fuzzy search, see below
//   }
//
// Building this is pure/deterministic given (pageNumber, textItems), so
// it's cached per page — "normalize once, index once, search many times"
// (spec section 38). The cache is created fresh per loaded document (see
// createPageIndexCache, mirrored 1:1 against PDFPage.jsx's existing
// pageTextItemsCacheRef reset on document load).

import { normalizePdfText } from "./pdfTextNormalizer.js";
import { analyzePageLayout, itemsFromPdfJs } from "./pdfPageLayout.js";

const TOKEN_RE = /[\p{L}\p{N}][\p{L}\p{N}'-]*/gu;

/**
 * originalText + itemOffsets from raw PDF.js text items — built in true
 * READING order (pdfPageLayout.js's page layout analysis), not PDF-stream
 * order. content.items is not guaranteed to match how a human reads the
 * page; for a two-column document in particular, naively concatenating
 * items in their stream order can splice unrelated left/right column
 * content into one nonsensical string, which would then look like a
 * genuine (if garbled) sentence to the search/fuzzy-matching stages
 * below. A blank line is inserted between reading-order BLOCKS (not just
 * between items within one block) so a search/dehyphenation pass never
 * treats the end of one column/section and the start of the next as
 * directly-adjacent running text.
 */
const buildOriginalTextFromItems = (textItems) => {
  const spatialItems = itemsFromPdfJs(textItems);
  const layout = analyzePageLayout(spatialItems);

  let originalText = "";
  const itemOffsets = [];
  for (const block of layout.blocks) {
    for (const spatialItem of block.items) {
      const str = spatialItem.text || "";
      if (!str) continue;
      const start = originalText.length;
      originalText += str;
      itemOffsets.push({ start, end: originalText.length, itemIndex: spatialItem.itemIndex });
      originalText += spatialItem.hasEOL ? "\n" : " ";
    }
    if (originalText && !originalText.endsWith("\n")) originalText += "\n";
  }
  return { originalText, itemOffsets };
};

/** Word tokens over normalizedText, each with its normalized-index range. */
const buildTokens = (normalizedText) => {
  const tokens = [];
  TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = TOKEN_RE.exec(normalizedText))) {
    tokens.push({ text: m[0], normStart: m.index, normEnd: m.index + m[0].length });
  }
  return tokens;
};

// Sentence-ish chunks: split on ., !, ? followed by whitespace, or a real
// paragraph break, whichever comes first — gives fuzzy search reasonably
// sized, semantically coherent windows without ever comparing the whole
// page as one string (spec section 15/39). Token-window chunks (sized to
// the query) are generated separately, on demand, in pdfFuzzySearch.js —
// this precomputed set is a coarser, cheaper first pass.
const SENTENCE_SPLIT_RE = /(?<=[.!?])\s+(?=[A-Z(])|\n{1,}/g;
const buildSearchableChunks = (normalizedText, tokens) => {
  const chunks = [];
  let cursor = 0;
  const pushChunk = (normStart, normEnd) => {
    if (normEnd <= normStart) return;
    const text = normalizedText.slice(normStart, normEnd).trim();
    if (!text) return;
    const chunkTokens = tokens.filter((t) => t.normStart >= normStart && t.normEnd <= normEnd);
    chunks.push({ normStart, normEnd, text, tokens: chunkTokens });
  };
  SENTENCE_SPLIT_RE.lastIndex = 0;
  let m;
  while ((m = SENTENCE_SPLIT_RE.exec(normalizedText))) {
    pushChunk(cursor, m.index);
    cursor = m.index + m[0].length;
  }
  pushChunk(cursor, normalizedText.length);
  return chunks;
};

/**
 * Pure page-index builder. `textItems` is exactly PDF.js's
 * `content.items` for that page (from getPageTextItems in PDFPage.jsx).
 */
export const buildPageIndex = (pageNumber, textItems) => {
  const { originalText, itemOffsets } = buildOriginalTextFromItems(textItems || []);
  const norm = normalizePdfText(originalText);
  const tokens = buildTokens(norm.normalizedText);
  const searchableChunks = buildSearchableChunks(norm.normalizedText, tokens);
  return {
    pageNumber,
    originalText: norm.originalText,
    normalizedText: norm.normalizedText,
    caseFoldedText: norm.caseFoldedText,
    compactText: norm.compactText,
    normalizedToOriginalMap: norm.normalizedToOriginalMap,
    compactToNormalizedMap: norm.compactToNormalizedMap,
    itemOffsets,
    tokens,
    searchableChunks,
  };
};

/**
 * A tiny per-document page-index cache. Callers create one instance per
 * loaded PDF (see PDFPage.jsx's pageTextItemsCacheRef for the existing
 * sibling cache this is meant to sit next to) and call .clear() at the
 * same point that cache gets reset on document change.
 */
export const createPageIndexCache = () => {
  const cache = new Map();
  return {
    get(pageNumber, textItems) {
      const existing = cache.get(pageNumber);
      if (existing) return existing;
      const built = buildPageIndex(pageNumber, textItems);
      cache.set(pageNumber, built);
      return built;
    },
    clear() {
      cache.clear();
    },
  };
};
