export const bboxTextMatchesSpan = (bbox, span) => {
  if (!bbox || !span) return false;
  if (!String(span.text ?? span.el?.textContent ?? "").trim()) return false;
  // Canonical rule: only spans that actually intersect the bbox in page
  // space are eligible. Never widen the match to a whole row or to
  // zoom-dependent screen geometry, or the same box will drift across
  // scales and start bleeding text from outside its borders.
  const left = span.pageLeft ?? span.geoLeft ?? 0;
  const right = span.pageRight ?? span.geoRight ?? 0;
  const top = span.pageTop ?? span.geoTop ?? 0;
  const bottom = span.pageBottom ?? (top + (span.pageHeight ?? span.geoHeight ?? 0));
  if (right <= left || bottom <= top) return false;
  const bboxLeft = bbox.x ?? 0;
  const bboxTop = bbox.y ?? 0;
  const bboxRight = bboxLeft + (bbox.w ?? 0);
  const bboxBottom = bboxTop + (bbox.h ?? 0);
  const overlapX = Math.max(0, Math.min(right, bboxRight) - Math.max(left, bboxLeft));
  const overlapY = Math.max(0, Math.min(bottom, bboxBottom) - Math.max(top, bboxTop));
  const spanWidth = Math.max(1, right - left);
  const spanHeight = Math.max(1, bottom - top);
  const spanArea = spanWidth * spanHeight;
  const overlapArea = overlapX * overlapY;
  return overlapArea / spanArea >= 0.9;
};

const spanPageLeft = (span) => span.pageLeft ?? span.geoLeft ?? 0;
const spanPageRight = (span) => span.pageRight ?? span.geoRight ?? 0;
const spanPageTop = (span) => span.pageTop ?? span.geoTop ?? 0;
const spanPageHeight = (span) => span.pageHeight ?? span.geoHeight ?? 0;

const spanText = (span) => String(span?.text ?? span?.el?.textContent ?? "");

// PDF.js can expose an entire visual line as one span. A partition may cut
// through that span, so selecting the span as a whole leaks text from the
// neighboring column. Clip the text to the partition's x-range and keep
// complete words at both cut edges.
export const clipSpanToHorizontalBBox = (span, bbox) => {
  const text = spanText(span);
  const left = spanPageLeft(span);
  const right = spanPageRight(span);
  const top = spanPageTop(span);
  const height = spanPageHeight(span);
  if (!text || right <= left || !bbox) return null;
  const bboxLeft = bbox.x ?? 0;
  const bboxRight = bboxLeft + (bbox.w ?? 0);
  const bboxTop = bbox.y ?? 0;
  const bboxBottom = bboxTop + (bbox.h ?? 0);
  if (right <= bboxLeft || left >= bboxRight || top + height <= bboxTop || top >= bboxBottom) return null;
  if (left >= bboxLeft && right <= bboxRight) return span;

  const length = text.length;
  const charWidth = (right - left) / Math.max(1, length);
  let start = Math.max(0, Math.floor((bboxLeft - left) / charWidth));
  let end = Math.min(length, Math.ceil((bboxRight - left) / charWidth));
  // If a boundary cuts through a word, retain that complete word rather than
  // returning a misleading partial token.
  while (start > 0 && !/\s/u.test(text[start - 1])) start -= 1;
  while (end < length && !/\s/u.test(text[end])) end += 1;
  const clippedText = text.slice(start, end).trim();
  if (!clippedText) return null;
  const leadingWhitespace = text.slice(start, end).search(/\S/u);
  const first = start + Math.max(0, leadingWhitespace);
  const trailing = text.slice(first, end).search(/\s+$/u);
  const last = trailing >= 0 ? first + trailing : end;
  return {
    ...span,
    text: text.slice(first, last),
    pageLeft: left + first * charWidth,
    pageRight: left + last * charWidth,
  };
};

const isLowercaseContinuation = (text) => {
  const first = String(text || "").trimStart().match(/^\p{Ll}/u)?.[0] || "";
  return !!first;
};

const getLineText = (spans) => {
  const pieces = [];
  let previous = null;
  for (const span of spans) {
    const text = span.text ?? span.el?.textContent ?? "";
    if (!text) continue;
    if (!previous) {
      pieces.push(text);
      previous = span;
      continue;
    }
    const topGap = Math.abs(spanPageTop(previous) - spanPageTop(span));
    const heightRef = Math.max(spanPageHeight(previous), spanPageHeight(span));
    const sameLine = topGap < Math.max(8, heightRef * 0.5)
      || ((previous.rowIndex ?? null) != null && (span.rowIndex ?? null) != null && previous.rowIndex === span.rowIndex);
    if (sameLine) {
      const gap = (previous.pageRight ?? previous.geoRight) != null && (span.pageLeft ?? span.geoLeft) != null
        ? (span.pageLeft ?? span.geoLeft) - (previous.pageRight ?? previous.geoRight)
        : 0;
      if (gap > 1) pieces.push(" ");
    } else {
      pieces.push("\n");
    }
    pieces.push(text);
    previous = span;
  }
  return pieces.join("").replace(/\s+/g, " ").trim();
};

const joinLineTexts = (lineTexts) => {
  const pieces = [];
  for (const rawText of lineTexts || []) {
    const text = String(rawText || "").trim();
    if (!text) continue;
    if (!pieces.length) {
      pieces.push(text);
      continue;
    }
    const previous = pieces[pieces.length - 1];
    if (previous.endsWith("-") && isLowercaseContinuation(text)) {
      pieces[pieces.length - 1] = previous.slice(0, -1) + text;
      continue;
    }
    pieces.push(text);
  }
  return pieces.join(" ").replace(/\s+/g, " ").trim();
};

const groupSpansIntoLines = (inputSpans) => {
  const seeded = [...inputSpans].sort((a, b) => (
    spanPageTop(a) - spanPageTop(b)
    || spanPageLeft(a) - spanPageLeft(b)
    || (a.rowIndex ?? 0) - (b.rowIndex ?? 0)
    || (a.columnIndex ?? 0) - (b.columnIndex ?? 0)
  ));
  const lines = [];
  for (const span of seeded) {
    const top = spanPageTop(span);
    const height = spanPageHeight(span);
    const prev = lines[lines.length - 1];
    const sameLine = prev && (
      (prev.rowIndex != null && span.rowIndex != null && prev.rowIndex === span.rowIndex)
      || Math.abs(top - prev.top) < Math.max(8, Math.max(prev.height, height) * 0.55)
    );
    if (!sameLine) {
      lines.push({ spans: [span], top, height, rowIndex: span.rowIndex ?? null });
      continue;
    }
    prev.spans.push(span);
    prev.top = Math.min(prev.top, top);
    prev.height = Math.max(prev.height, height);
  }
  return lines.map((line) => ({
    ...line,
    spans: line.spans.sort((a, b) => (
      spanPageLeft(a) - spanPageLeft(b)
      || spanPageTop(a) - spanPageTop(b)
      || (a.rowIndex ?? 0) - (b.rowIndex ?? 0)
      || (a.columnIndex ?? 0) - (b.columnIndex ?? 0)
    )),
  }));
};

const expandRect = (rect, padding = 0) => {
  if (!rect) return null;
  const pad = Math.max(0, Number(padding) || 0);
  return {
    x: (rect.x ?? 0) - pad,
    y: (rect.y ?? 0) - pad,
    w: Math.max(0, (rect.w ?? 0) + pad * 2),
    h: Math.max(0, (rect.h ?? 0) + pad * 2),
  };
};

const lineStyleSummary = (line) => {
  const spans = line?.spans || [];
  let totalHeight = 0;
  let boldCount = 0;
  let italicCount = 0;
  const familyCounts = new Map();
  for (const span of spans) {
    totalHeight += spanPageHeight(span);
    const weight = String(span.fontWeight ?? "").toLowerCase();
    const style = String(span.fontStyle ?? "").toLowerCase();
    if (weight.includes("bold") || Number(span.fontWeight) >= 600) boldCount++;
    if (style.includes("italic")) italicCount++;
    const family = String(span.fontFamily ?? "").trim().toLowerCase();
    if (family) familyCounts.set(family, (familyCounts.get(family) || 0) + 1);
  }
  return {
    avgHeight: spans.length ? totalHeight / spans.length : 0,
    boldRatio: spans.length ? boldCount / spans.length : 0,
    italicRatio: spans.length ? italicCount / spans.length : 0,
    primaryFamily: [...familyCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "",
  };
};

const lineBounds = (line) => {
  const spans = line?.spans || [];
  if (!spans.length) return null;
  const left = Math.min(...spans.map((span) => spanPageLeft(span)));
  const right = Math.max(...spans.map((span) => spanPageRight(span)));
  const top = Math.min(...spans.map((span) => spanPageTop(span)));
  const bottom = Math.max(...spans.map((span) => spanPageTop(span) + spanPageHeight(span)));
  return { x: left, y: top, w: Math.max(0, right - left), h: Math.max(0, bottom - top) };
};

export const buildTextLineRects = (spans, padding = 0) => {
  const lines = groupSpansIntoLines(spans || []);
  return lines
    .map(lineBounds)
    .filter(Boolean)
    .map((rect) => expandRect(rect, padding));
};

// One entry per visual line — text AND rect together (buildTextLineRects
// above only keeps the rect). Used by Smart Segmenting (pdfSmartSegment.js)
// to match a page's own text lines, in reading order, against a Markdown
// paragraph's text before it has any bbox to test overlap against yet —
// everything else in this file assumes a bbox already exists to select
// spans against, which is exactly backwards for that use case.
export const buildTextLines = (spans) => {
  const lines = groupSpansIntoLines(spans || []);
  return lines
    .map((line) => ({ text: getLineText(line.spans || []), rect: lineBounds(line) }))
    .filter((line) => line.rect);
};

const intersectRects = (left, right) => {
  if (!left || !right) return null;
  const x = Math.max(left.x ?? 0, right.x ?? 0);
  const y = Math.max(left.y ?? 0, right.y ?? 0);
  const rightEdge = Math.min((left.x ?? 0) + (left.w ?? 0), (right.x ?? 0) + (right.w ?? 0));
  const bottomEdge = Math.min((left.y ?? 0) + (left.h ?? 0), (right.y ?? 0) + (right.h ?? 0));
  return rightEdge > x && bottomEdge > y
    ? { type: "bbox", x, y, w: rightEdge - x, h: bottomEdge - y }
    : null;
};

// A paragraph can intentionally cross multiple Page partitions. Extract each
// fenced region independently so equal-Y lines from neighboring columns never
// merge, then concatenate the groups in stable partition order.
export const buildPartitionOrderedTextLines = (
  spans,
  bbox,
  partitions = [],
  matchSpan = bboxTextMatchesSpan,
) => {
  const groups = [];
  for (const partition of partitions || []) {
    const region = intersectRects(bbox, partition);
    if (!region) continue;
    const lines = buildTextLines(selectSpansForBoundingBox(
      spans,
      region,
      matchSpan,
      [],
      { preserveColumns: true, splitLines: true },
    ));
    if (!lines.length) continue;
    groups.push({ partitionId: partition.id, lines });
  }
  return {
    groups,
    lines: groups.flatMap((group) => group.lines),
    partitionIds: groups.map((group) => group.partitionId),
  };
};

const lineMostlyInsideBBox = (line, bbox, minCoverage = 0.9) => {
  const bounds = lineBounds(line);
  if (!bounds || !bbox) return false;
  const bboxLeft = bbox.x ?? 0;
  const bboxTop = bbox.y ?? 0;
  const bboxRight = bboxLeft + (bbox.w ?? 0);
  const bboxBottom = bboxTop + (bbox.h ?? 0);
  const overlapX = Math.max(0, Math.min(bounds.x + bounds.w, bboxRight) - Math.max(bounds.x, bboxLeft));
  const overlapY = Math.max(0, Math.min(bounds.y + bounds.h, bboxBottom) - Math.max(bounds.y, bboxTop));
  const lineArea = Math.max(1, bounds.w * bounds.h);
  return (overlapX * overlapY) / lineArea >= minCoverage;
};

const looksLikeTitleLine = (firstLine, bodyLines) => {
  if (!firstLine || !bodyLines.length) return false;
  const first = lineStyleSummary(firstLine);
  const body = lineStyleSummary({
    spans: bodyLines.flatMap((line) => line.spans || []),
  });
  const titleText = getLineText(firstLine.spans || []);
  if (!titleText || titleText.length > 140) return false;
  const styleDiffers = (
    first.avgHeight >= Math.max(body.avgHeight * 1.12, body.avgHeight + 1)
    || (first.boldRatio >= 0.5 && body.boldRatio < 0.35)
    || (first.italicRatio >= 0.35 && body.italicRatio < 0.2)
    || (first.primaryFamily && body.primaryFamily && first.primaryFamily !== body.primaryFamily)
  );
  return styleDiffers;
};

export const orderSpansForTextExtraction = (inputSpans) => {
  const seeded = [...inputSpans].sort((a, b) => (
    spanPageTop(a) - spanPageTop(b)
    || spanPageLeft(a) - spanPageLeft(b)
    || (a.rowIndex ?? 0) - (b.rowIndex ?? 0)
    || (a.columnIndex ?? 0) - (b.columnIndex ?? 0)
  ));
  return groupSpansIntoLines(seeded).flatMap((line) => line.spans);
};

export const extractTextFromOrderedSpans = (spans) => {
  const ordered = orderSpansForTextExtraction(spans);
  const lines = groupSpansIntoLines(ordered);
  return joinLineTexts(lines.map((line) => getLineText(line.spans || [])));
};

export const selectSpansForBoundingBox = (
  spans,
  bbox,
  matchSpan = bboxTextMatchesSpan,
  excludedBboxes = [],
  { preserveColumns = false, splitLines = false, spanKeys = null } = {},
) => {
  if (!bbox || !Array.isArray(spans) || !spans.length) return [];
  const shouldSplitLines = splitLines || ["bbox", "columnBBox"].includes(bbox.type);
  const selected = shouldSplitLines
    ? spans
      .filter((span) => (
        !excludedBboxes.some((excludedBBox) => matchSpan(excludedBBox, span))
      ))
      .map((span) => clipSpanToHorizontalBBox(span, bbox))
      .filter(Boolean)
    : spans.filter((span) => (
      matchSpan(bbox, span)
      && !excludedBboxes.some((excludedBBox) => matchSpan(excludedBBox, span))
    ));
  if (!selected.length) return [];
  // Smart/container boxes can be broad enough to cross a column gutter, so
  // retain their historical dominant-column filtering. Manual boxes are
  // already derived from the exact selected spans and must keep all of them
  // (notably a TOC label such as "Arrhythmias" plus its page number).
  if (Array.isArray(spanKeys)) {
    const selectedKeySet = new Set(spanKeys);
    return selected.filter((span) => selectedKeySet.has(span.spanKey));
  }
  if (preserveColumns) return selected;
  const columnVotes = new Map();
  for (const span of selected) {
    if (span.columnIndex == null) continue;
    columnVotes.set(span.columnIndex, (columnVotes.get(span.columnIndex) || 0) + 1);
  }
  const dominantColumn = [...columnVotes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return dominantColumn == null
    ? selected
    : selected.filter((span) => span.columnIndex == null || span.columnIndex === dominantColumn);
};

/**
 * A "staircase" outline hugging an arbitrary top-to-bottom-ordered list of
 * rects (one per text line, each free to have its own left/right extent) —
 * left edge walked top-to-bottom, right edge walked bottom-to-top. Every
 * rect passed in contributes its own step to the outline regardless of
 * whether it touches its neighbors, which is exactly what text lines need
 * (consecutive lines almost never touch pixel-for-pixel once real
 * line-height spacing is accounted for) — nothing is merged or discarded.
 *
 * Callers are responsible for passing rects that don't vertically overlap
 * (see autoFitBBoxToText in PDFPage.jsx for how it reconciles a padded
 * title row against the first body line) — this function trusts the given
 * top-to-bottom order and geometry as-is rather than second-guessing it,
 * since which rect "should" give way on an overlap is caller-specific
 * (e.g. a title row's padding exists to fully enclose its own border
 * stroke and must never be the one trimmed).
 */
export const buildTightOutlineFromLineRects = (rects) => {
  const bounds = (rects || []).filter(Boolean);
  if (!bounds.length) return [];
  const leftEdge = [];
  const rightEdge = [];
  for (const line of bounds) {
    leftEdge.push(
      { x: line.x, y: line.y },
      { x: line.x, y: line.y + line.h },
    );
  }
  for (let index = bounds.length - 1; index >= 0; index--) {
    const line = bounds[index];
    rightEdge.push(
      { x: line.x + line.w, y: line.y + line.h },
      { x: line.x + line.w, y: line.y },
    );
  }
  return [...leftEdge, ...rightEdge];
};

export const buildTightTextOutline = (spans, padding = 1) => (
  buildTightOutlineFromLineRects(buildTextLineRects(spans, padding))
);

export const extractBoundingBoxTextParts = (
  spans,
  bbox,
  matchSpan = bboxTextMatchesSpan,
  excludedBboxes = [],
  options = {},
) => {
  const { detectTitle = true, ...selectionOptions } = options || {};
  const narrowed = selectSpansForBoundingBox(spans, bbox, matchSpan, excludedBboxes, selectionOptions);
  if (!narrowed.length) return { title: "", text: "" };
  const lines = groupSpansIntoLines(narrowed);
  if (!lines.length) return { title: "", text: "" };
  const firstLineText = getLineText(lines[0].spans || []);
  const loneLineLooksLikeTitle = lines.length === 1 && firstLineText && (
    firstLineText.length <= 80
    && (
      (lineStyleSummary(lines[0]).boldRatio >= 0.5)
      || (lineStyleSummary(lines[0]).italicRatio >= 0.35)
      || /^[A-Z0-9 ,:;()\-]+$/.test(firstLineText)
    )
    && lineMostlyInsideBBox(lines[0], bbox)
  );
  const titleLine = detectTitle && ((looksLikeTitleLine(lines[0], lines.slice(1)) && lineMostlyInsideBBox(lines[0], bbox)) || loneLineLooksLikeTitle)
    ? lines[0]
    : null;
  const title = titleLine ? getLineText(titleLine.spans) : "";
  const bodyLines = titleLine ? lines.slice(1) : lines;
  const text = bodyLines.length
    ? joinLineTexts(bodyLines.map((line) => getLineText(line.spans || [])))
    : "";
  return { title, text };
};

export const extractTextForBoundingBox = (spans, bbox, matchSpan = bboxTextMatchesSpan, excludedBboxes = [], options = {}) => {
  return extractBoundingBoxTextParts(spans, bbox, matchSpan, excludedBboxes, options).text;
};
