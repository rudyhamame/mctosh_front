export const bboxTextMatchesSpan = (bbox, span) => {
  if (!bbox || !span) return false;
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
  const centerX = (left + right) / 2;
  const centerInside = centerX >= bboxLeft && centerX <= bboxRight;
  return overlapY > 0 && (centerInside || overlapX / spanWidth >= 0.68);
};

const spanPageLeft = (span) => span.pageLeft ?? span.geoLeft ?? 0;
const spanPageRight = (span) => span.pageRight ?? span.geoRight ?? 0;
const spanPageTop = (span) => span.pageTop ?? span.geoTop ?? 0;
const spanPageHeight = (span) => span.pageHeight ?? span.geoHeight ?? 0;

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
  return getLineText(ordered);
};

export const extractBoundingBoxTextParts = (spans, bbox, matchSpan = bboxTextMatchesSpan, excludedBboxes = []) => {
  if (!bbox || !Array.isArray(spans) || !spans.length) return { title: "", text: "" };
  const selected = spans.filter((span) => (
    matchSpan(bbox, span)
    && !excludedBboxes.some((excludedBBox) => matchSpan(excludedBBox, span))
  ));
  if (!selected.length) return { title: "", text: "" };
  const columnVotes = new Map();
  for (const span of selected) {
    if (span.columnIndex == null) continue;
    columnVotes.set(span.columnIndex, (columnVotes.get(span.columnIndex) || 0) + 1);
  }
  const dominantColumn = [...columnVotes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const narrowed = dominantColumn == null
    ? selected
    : selected.filter((span) => span.columnIndex == null || span.columnIndex === dominantColumn);
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
  );
  const titleLine = looksLikeTitleLine(lines[0], lines.slice(1)) || loneLineLooksLikeTitle ? lines[0] : null;
  const title = titleLine ? getLineText(titleLine.spans) : "";
  const bodySpans = titleLine ? lines.slice(1).flatMap((line) => line.spans) : narrowed;
  const text = bodySpans.length ? extractTextFromOrderedSpans(bodySpans) : "";
  return { title, text };
};

export const extractTextForBoundingBox = (spans, bbox, matchSpan = bboxTextMatchesSpan, excludedBboxes = []) => {
  return extractBoundingBoxTextParts(spans, bbox, matchSpan, excludedBboxes).text;
};
