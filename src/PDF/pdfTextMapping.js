// pdfTextMapping.js
//
// Range-resolution helpers that walk the segment maps produced by
// pdfTextNormalizer.js (and the item-offset map produced by
// pdfSearchIndex.js) to answer one question, over and over:
//
//   "I have a [start, end) range in representation X — what's the
//    corresponding range in representation Y?"
//
// This is the one piece of machinery that makes the whole normalize-for-
// search / display-the-original architecture possible: every search stage
// works in whichever representation is convenient (compact, case-folded,
// normalized), and every result gets funneled back through here to recover
// an exact originalText range before anything is ever shown to the user.
//
// Segment shape convention: an array of objects sorted by their "from" key,
// each with { [fromKey+"Start"], [fromKey+"End"], [toKey+"Start"], [toKey+"End"] },
// non-overlapping and covering the "from" space left-to-right (gaps are
// tolerated — see findCoveringSegment).

/**
 * Binary search for the segment covering (or nearest preceding) `pos` in
 * the "from" space. Segments are sorted and non-overlapping, so this is a
 * plain sorted-array search — O(log n) instead of the O(n) linear scan the
 * original single-page search used (fine at page scale, but this same code
 * path also serves multi-page fuzzy scoring where it runs far more often).
 */
const findCoveringSegment = (segments, pos, fromStartKey, fromEndKey) => {
  if (!segments || !segments.length) return -1;
  let lo = 0, hi = segments.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const seg = segments[mid];
    if (pos < seg[fromStartKey]) hi = mid - 1;
    else if (pos >= seg[fromEndKey]) lo = mid + 1;
    else return mid;
  }
  // No segment directly covers pos (can happen at the exact end of the
  // string, or in a gap left by a fully-elided character) — fall back to
  // the nearest segment so callers still get a usable (if approximate)
  // position instead of nothing.
  return Math.max(0, Math.min(segments.length - 1, lo));
};

/**
 * Maps a [start, end) range in the "from" space to a [start, end) range in
 * the "to" space, using segments shaped as documented above. `end` is
 * exclusive, so it's resolved against position `end - 1` (the last
 * included character) rather than `end` itself, which may be one past the
 * last segment.
 */
export const mapRangeThroughSegments = (segments, start, end, fromKey, toKey) => {
  if (!segments || !segments.length || start >= end) return null;
  const fromStartKey = `${fromKey}Start`;
  const fromEndKey = `${fromKey}End`;
  const toStartKey = `${toKey}Start`;
  const toEndKey = `${toKey}End`;

  const startSegIdx = findCoveringSegment(segments, start, fromStartKey, fromEndKey);
  const endSegIdx = findCoveringSegment(segments, end - 1, fromStartKey, fromEndKey);
  if (startSegIdx < 0 || endSegIdx < 0) return null;

  const startSeg = segments[startSegIdx];
  const endSeg = segments[endSegIdx];
  return {
    start: Math.min(startSeg[toStartKey], endSeg[toStartKey]),
    end: Math.max(startSeg[toEndKey], endSeg[toEndKey]),
  };
};

/** normalized [start,end) -> original [start,end), via normalizedToOriginalMap. */
export const normalizedRangeToOriginal = (normalizedToOriginalMap, start, end) =>
  mapRangeThroughSegments(normalizedToOriginalMap, start, end, "norm", "orig");

/** compact [start,end) -> normalized [start,end), via compactToNormalizedMap. */
export const compactRangeToNormalized = (compactToNormalizedMap, start, end) =>
  mapRangeThroughSegments(compactToNormalizedMap, start, end, "compact", "norm");

/**
 * compact [start,end) -> original [start,end), chaining both maps. This is
 * the one most search stages actually want: compact is where whitespace/
 * fragmentation-tolerant matching happens, original is what gets
 * highlighted.
 */
export const compactRangeToOriginal = (pageIndex, start, end) => {
  const normRange = compactRangeToNormalized(pageIndex.compactToNormalizedMap, start, end);
  if (!normRange) return null;
  return normalizedRangeToOriginal(pageIndex.normalizedToOriginalMap, normRange.start, normRange.end);
};

/**
 * original [start,end) -> the PDF.js text item(s) that produced it, using
 * pageIndex.itemOffsets (built in pdfSearchIndex.js while joining
 * textItems into originalText — one { start, end, itemIndex } per item, in
 * READING order, not necessarily PDF.js's own item-index order — see
 * pdfPageLayout.js). Returns every overlapping item index, sorted
 * ascending — NOT just a [first, last] range: reading-order reconstruction
 * means the items behind one contiguous piece of originalText are not
 * guaranteed to be numerically contiguous PDF.js indexes (a match could
 * legitimately span, say, items 5 and 8 with 6/7 belonging to a
 * different reading-order block), so callers (the search-result ->
 * highlight-rect path) must iterate the actual returned set rather than
 * loop firstIndex..lastIndex.
 */
export const originalRangeToItemIndexes = (pageIndex, origStart, origEnd) => {
  const offsets = pageIndex?.itemOffsets;
  if (!offsets || !offsets.length) return null;
  const itemIndexes = [];
  // Linear scan: item counts per page are small (tens to low hundreds),
  // and this only runs once per surfaced match, not per candidate window.
  for (const o of offsets) {
    if (origStart < o.end && origEnd > o.start) itemIndexes.push(o.itemIndex);
  }
  if (!itemIndexes.length) return null;
  itemIndexes.sort((a, b) => a - b);
  return { itemIndexes };
};
