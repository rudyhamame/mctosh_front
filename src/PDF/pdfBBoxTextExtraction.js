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
  return getLineText(ordered);
};

export const selectSpansForBoundingBox = (spans, bbox, matchSpan = bboxTextMatchesSpan, excludedBboxes = []) => {
  if (!bbox || !Array.isArray(spans) || !spans.length) return [];
  const selected = spans.filter((span) => (
    matchSpan(bbox, span)
    && !excludedBboxes.some((excludedBBox) => matchSpan(excludedBBox, span))
  ));
  if (!selected.length) return [];
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

export const buildTightTextOutline = (spans, padding = 1) => {
  const bounds = buildTextLineRects(spans, padding);
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

export const buildTightOutlineFromRects = (rects) => {
  const bounds = (rects || [])
    .filter(Boolean)
    .map((rect) => ({
      x: rect.x ?? 0,
      y: rect.y ?? 0,
      w: Math.max(0, rect.w ?? 0),
      h: Math.max(0, rect.h ?? 0),
    }))
    .filter((rect) => rect.w > 0 && rect.h > 0);
  if (!bounds.length) return [];

  const xs = [...new Set(bounds.flatMap((rect) => [rect.x, rect.x + rect.w]))].sort((a, b) => a - b);
  const ys = [...new Set(bounds.flatMap((rect) => [rect.y, rect.y + rect.h]))].sort((a, b) => a - b);
  if (xs.length < 2 || ys.length < 2) return [];

  const filled = Array.from({ length: ys.length - 1 }, () => Array(xs.length - 1).fill(false));
  for (let row = 0; row < ys.length - 1; row++) {
    const cy = (ys[row] + ys[row + 1]) / 2;
    for (let col = 0; col < xs.length - 1; col++) {
      const cx = (xs[col] + xs[col + 1]) / 2;
      filled[row][col] = bounds.some((rect) => (
        cx >= rect.x
        && cx <= rect.x + rect.w
        && cy >= rect.y
        && cy <= rect.y + rect.h
      ));
    }
  }

  const segmentMap = new Map();
  const addSegment = (from, to) => {
    const key = `${from.x},${from.y}`;
    const existing = segmentMap.get(key) || [];
    existing.push(to);
    segmentMap.set(key, existing);
  };

  for (let row = 0; row < ys.length - 1; row++) {
    for (let col = 0; col < xs.length - 1; col++) {
      if (!filled[row][col]) continue;
      const x0 = xs[col];
      const x1 = xs[col + 1];
      const y0 = ys[row];
      const y1 = ys[row + 1];
      if (row === 0 || !filled[row - 1][col]) addSegment({ x: x0, y: y0 }, { x: x1, y: y0 });
      if (col === xs.length - 2 || !filled[row][col + 1]) addSegment({ x: x1, y: y0 }, { x: x1, y: y1 });
      if (row === ys.length - 2 || !filled[row + 1][col]) addSegment({ x: x1, y: y1 }, { x: x0, y: y1 });
      if (col === 0 || !filled[row][col - 1]) addSegment({ x: x0, y: y1 }, { x: x0, y: y0 });
    }
  }

  const takeNext = (point) => {
    const key = `${point.x},${point.y}`;
    const nextPoints = segmentMap.get(key) || [];
    if (!nextPoints.length) return null;
    const next = nextPoints.shift();
    if (!nextPoints.length) segmentMap.delete(key);
    else segmentMap.set(key, nextPoints);
    return next;
  };

  const polygonArea = (points) => {
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      area += (a.x * b.y) - (b.x * a.y);
    }
    return area / 2;
  };

  const loops = [];
  while (segmentMap.size) {
    const [startKey] = segmentMap.keys();
    const [sx, sy] = startKey.split(",").map(Number);
    const start = { x: sx, y: sy };
    const loop = [start];
    let current = start;
    let guard = 0;
    while (guard < 10000) {
      guard++;
      const next = takeNext(current);
      if (!next) break;
      if (next.x === start.x && next.y === start.y) {
        break;
      }
      loop.push(next);
      current = next;
    }
    if (loop.length >= 4) loops.push(loop);
  }

  if (!loops.length) return [];
  return loops.sort((a, b) => Math.abs(polygonArea(b)) - Math.abs(polygonArea(a)))[0];
};

export const extractBoundingBoxTextParts = (spans, bbox, matchSpan = bboxTextMatchesSpan, excludedBboxes = []) => {
  const narrowed = selectSpansForBoundingBox(spans, bbox, matchSpan, excludedBboxes);
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
  const titleLine = (looksLikeTitleLine(lines[0], lines.slice(1)) && lineMostlyInsideBBox(lines[0], bbox)) || loneLineLooksLikeTitle ? lines[0] : null;
  const title = titleLine ? getLineText(titleLine.spans) : "";
  const bodySpans = titleLine ? lines.slice(1).flatMap((line) => line.spans) : narrowed;
  const text = bodySpans.length ? extractTextFromOrderedSpans(bodySpans) : "";
  return { title, text };
};

export const extractTextForBoundingBox = (spans, bbox, matchSpan = bboxTextMatchesSpan, excludedBboxes = []) => {
  return extractBoundingBoxTextParts(spans, bbox, matchSpan, excludedBboxes).text;
};
