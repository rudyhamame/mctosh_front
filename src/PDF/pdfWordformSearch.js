// Wordform Search for the PDF Reader.
//
// This module compares query/source CHAR values only. It deliberately does
// not use glyph appearance, OCR guesses, fuzzy distance, or permutations of
// inserted spaces. Source characters retain their item/character provenance
// so callers can map a result back to PDF.js text items and coordinates.

const ALNUM_RE = /[\p{L}\p{N}]/u;
const SPACE_RE = /\s/u;

const isAlphanumeric = (value) => ALNUM_RE.test(String(value || ""));
const isSpace = (value) => SPACE_RE.test(String(value || ""));
const foldCase = (value) => String(value || "").toLocaleLowerCase();

export const normalizeWordformQuery = (query) => Array.from(String(query || ""))
  .filter(isAlphanumeric)
  .map(foldCase)
  .join("");

const charIdFor = (pageIndex, itemIndex, charIndex) => `p${pageIndex}-item${itemIndex}-char${charIndex}`;

const itemCharBox = (item, charIndex, charCount) => {
  const transform = Array.isArray(item?.transform) ? item.transform : null;
  const itemWidth = Number(item?.width) || 0;
  const itemHeight = Math.max(1, Math.abs(Number(item?.height) || (transform?.[3] || 12)));
  const x = Number(transform?.[4]) || 0;
  const y = Number(transform?.[5]) || 0;
  const width = charCount > 0 ? itemWidth / charCount : itemWidth;
  return { x: x + width * charIndex, y, width, height: itemHeight };
};

/**
 * Build a source CHAR sequence from PDF.js text items. `canonicalItemOrder`
 * may be supplied by the existing page index/layout; otherwise PDF.js item
 * order is retained. No synthetic separators are inserted.
 */
export const buildWordformCharIndex = (pageIndex, textItems, canonicalItemOrder = null) => {
  const items = Array.isArray(textItems) ? textItems : [];
  const order = Array.isArray(canonicalItemOrder)
    ? canonicalItemOrder
    : items.map((_, index) => index);
  const chars = [];
  for (const itemIndex of order) {
    const item = items[itemIndex];
    if (!item) continue;
    const text = String(item.str || "");
    const codepoints = Array.from(text);
    codepoints.forEach((value, charIndex) => {
      chars.push({
        id: charIdFor(pageIndex, itemIndex, charIndex),
        pageIndex,
        itemIndex,
        charIndex,
        itemLength: codepoints.length,
        itemTotalLength: codepoints.length,
        value,
        comparisonValue: foldCase(value),
        bbox: itemCharBox(item, charIndex, codepoints.length),
      });
    });
  }
  return chars;
};

const boundaryValid = (chars, index) => index < 0 || index >= chars.length || !isAlphanumeric(chars[index].value);

const sourceTextFor = (chars) => chars.map((char) => char.value).join("");

const bboxFor = (chars) => {
  const boxes = chars.map((char) => char.bbox).filter((box) => box && Number.isFinite(box.x));
  if (!boxes.length) return null;
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
};

const itemRangesFor = (chars) => {
  const ranges = new Map();
  for (const char of chars) {
    const existing = ranges.get(char.itemIndex) || { start: char.charIndex, end: char.charIndex + 1 };
    existing.start = Math.min(existing.start, char.charIndex);
    existing.end = Math.max(existing.end, char.charIndex + 1);
    ranges.set(char.itemIndex, existing);
  }
  return Array.from(ranges, ([itemIndex, range]) => ({
      itemIndex,
      localStart: range.start,
      localEnd: range.end,
      itemLength: chars.find((char) => char.itemIndex === itemIndex)?.itemTotalLength || range.end,
  }));
};

/** Search one canonical source CHAR sequence deterministically. */
export const searchWordformChars = (chars, query, pageIndex = 1) => {
  const queryOriginal = String(query || "");
  const queryNormalized = normalizeWordformQuery(queryOriginal);
  if (!queryNormalized || !chars.length) return [];
  const results = [];

  for (let start = 0; start < chars.length; start += 1) {
    if (chars[start].comparisonValue !== queryNormalized[0]) continue;
    if (!boundaryValid(chars, start - 1)) continue;

    const matched = [chars[start]];
    const skippedSpaces = [];
    let cursor = start;
    let failed = false;
    for (let queryIndex = 1; queryIndex < queryNormalized.length; queryIndex += 1) {
      let next = cursor + 1;
      while (next < chars.length && isSpace(chars[next].value)) {
        skippedSpaces.push(chars[next]);
        next += 1;
      }
      if (next >= chars.length || chars[next].comparisonValue !== queryNormalized[queryIndex]) {
        failed = true;
        break;
      }
      matched.push(chars[next]);
      cursor = next;
    }
    if (failed) continue;
    const end = matched[matched.length - 1];
    if (!boundaryValid(chars, cursor + 1)) continue;

    const sourceSpan = chars.slice(start, cursor + 1);
    const sourceTextOriginal = sourceTextFor(sourceSpan);
    const matchType = skippedSpaces.length ? "SPACE_TOLERANT_MATCH" : "EXACT_CHAR_MATCH";
    results.push({
      queryOriginal,
      queryNormalized,
      pageIndex,
      sourceStartCharId: matched[0].id,
      sourceEndCharId: end.id,
      matchedSourceCharIds: matched.map((char) => char.id),
      skippedSpaceCharIds: skippedSpaces.map((char) => char.id),
      leftBoundaryValid: true,
      rightBoundaryValid: true,
      sourceTextOriginal,
      comparisonText: matched.map((char) => char.comparisonValue).join(""),
      matchType,
      itemIndexes: Array.from(new Set(sourceSpan.map((char) => char.itemIndex))),
      itemRanges: itemRangesFor(sourceSpan),
      originalMatchedText: sourceTextOriginal,
      bbox: bboxFor(sourceSpan),
      provenance: { sourceCharOrderPreserved: true, glyphComparisonUsed: false },
    });
  }
  return results;
};

export const searchPageForWordform = (pageIndex, textItems, query, canonicalItemOrder = null) => (
  searchWordformChars(buildWordformCharIndex(pageIndex, textItems, canonicalItemOrder), query, pageIndex)
);
