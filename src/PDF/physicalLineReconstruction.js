export const PHYSICAL_LINE_MODEL_VERSION = "physical-lines-v1-source-order-envelopes";

export const DEFAULT_PHYSICAL_LINE_CONFIG = Object.freeze({
  orientationToleranceDegrees: 2,
  minimumVerticalOverlapRatio: 0.2,
  maximumInlineBaselineOffset: 0.58,
  horizontalOverlapToleranceRatio: 2,
  maximumHorizontalGapLineHeights: 8,
  maximumHorizontalGapGlyphWidths: 18,
  horizontalResetLineHeights: 1.8,
  resetBaselineOffsetThreshold: 0.24,
  scriptBaselineOffsetThreshold: 0.12,
  scriptMaximumHeightRatio: 0.92,
});

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const unique = (values) => [...new Set(values.filter((value) => value != null))];
const median = (values, fallback = 0) => {
  const ordered = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  return ordered.length ? ordered[Math.floor(ordered.length / 2)] : fallback;
};
const weightedMedian = (entries, fallback = 0) => {
  const ordered = entries.filter((entry) => Number.isFinite(entry.value) && entry.weight > 0).slice().sort((left, right) => left.value - right.value);
  if (!ordered.length) return fallback;
  const midpoint = ordered.reduce((sum, entry) => sum + entry.weight, 0) / 2;
  let weight = 0;
  return ordered.find((entry) => { weight += entry.weight; return weight >= midpoint; })?.value ?? fallback;
};
const bboxUnion = (items) => {
  const left = Math.min(...items.map((item) => item.bbox.x));
  const top = Math.min(...items.map((item) => item.bbox.y));
  const right = Math.max(...items.map((item) => item.bbox.x + item.bbox.width));
  const bottom = Math.max(...items.map((item) => item.bbox.y + item.bbox.height));
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
};
const verticalOverlapRatio = (left, right) => {
  const overlap = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
  return overlap / Math.max(0.01, Math.min(left.height, right.height));
};
const horizontalOverlapRatio = (left, right) => {
  const overlap = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  return overlap / Math.max(0.01, Math.min(left.width, right.width));
};
const normalizeDirection = (value) => String(value || "ltr").toLocaleLowerCase().startsWith("rtl") ? "rtl" : "ltr";
const normalizeItem = (item, index) => {
  const bbox = item.bbox ? {
    x: finite(item.bbox.x), y: finite(item.bbox.y), width: Math.max(0, finite(item.bbox.width)), height: Math.max(0.01, finite(item.bbox.height, 1)),
  } : {
    x: finite(item.x, item.x1), y: finite(item.y, item.y1), width: Math.max(0, finite(item.width, finite(item.x2) - finite(item.x1))), height: Math.max(0.01, finite(item.height, finite(item.y2) - finite(item.y1, 0), 1)),
  };
  return {
    id: String(item.id || `source-item-${index}`), sourceItemId: String(item.sourceItemId || item.id || `source-item-${index}`),
    sourceOrder: Number.isInteger(Number(item.sourceIndex)) ? Number(item.sourceIndex) : index,
    text: String(item.text ?? item.rawText ?? item.str ?? ""), bbox,
    baseline: finite(item.baseline, bbox.y + bbox.height), height: bbox.height,
    fontName: item.fontName || "unknown", fontSize: finite(item.fontSize, bbox.height),
    writingDirection: normalizeDirection(item.writingDirection || item.direction || item.dir),
    orientation: finite(item.orientation ?? item.rotation), transform: Array.isArray(item.transform) ? [...item.transform] : undefined,
    hasEOL: Boolean(item.hasEOL),
    sourceCharacterIds: unique(item.sourceCharacterIds || []),
  };
};

const lineMetrics = (items) => {
  const bbox = bboxUnion(items);
  const dominantLineHeight = weightedMedian(items.map((item) => ({ value: item.height, weight: Math.max(1, Array.from(item.text).length) * Math.max(1, item.height) })), median(items.map((item) => item.height), 1));
  const dominantBaseline = weightedMedian(items.map((item) => ({
    value: item.baseline,
    // Height-squared weighting lets normal text establish the baseline while
    // retaining small displaced runs as local envelope extensions.
    weight: Math.max(1, Array.from(item.text).length) * Math.max(1, item.height * item.height),
  })), median(items.map((item) => item.baseline), bbox.y + bbox.height));
  return { bbox, dominantLineHeight, dominantBaseline, upperEnvelope: bbox.y, lowerEnvelope: bbox.y + bbox.height };
};

const flowEvidence = (lineItems, candidate, config) => {
  const metrics = lineMetrics(lineItems);
  const previous = lineItems.at(-1);
  const direction = previous.writingDirection;
  const sameDirection = direction === candidate.writingDirection;
  const sameOrientation = Math.abs(previous.orientation - candidate.orientation) <= config.orientationToleranceDegrees;
  const overlap = verticalOverlapRatio(metrics.bbox, candidate.bbox);
  const baselineOffset = Math.abs(candidate.baseline - metrics.dominantBaseline) / Math.max(1, metrics.dominantLineHeight);
  const glyphWidth = median([...lineItems, candidate].map((item) => item.bbox.width / Math.max(1, Array.from(item.text).length)), metrics.dominantLineHeight * 0.45);
  const directionalGap = direction === "rtl"
    ? previous.bbox.x - (candidate.bbox.x + candidate.bbox.width)
    : candidate.bbox.x - (previous.bbox.x + previous.bbox.width);
  const horizontalReset = direction === "rtl"
    ? candidate.bbox.x - previous.bbox.x > metrics.dominantLineHeight * config.horizontalResetLineHeights
    : previous.bbox.x - candidate.bbox.x > metrics.dominantLineHeight * config.horizontalResetLineHeights;
  const maximumGap = Math.max(metrics.dominantLineHeight * config.maximumHorizontalGapLineHeights, glyphWidth * config.maximumHorizontalGapGlyphWidths);
  const horizontalCompatible = directionalGap <= maximumGap
    && directionalGap >= -metrics.dominantLineHeight * config.horizontalOverlapToleranceRatio;
  const envelopeCompatible = overlap >= config.minimumVerticalOverlapRatio || baselineOffset <= config.maximumInlineBaselineOffset;
  const resetSignalsNewLine = horizontalReset && baselineOffset > config.resetBaselineOffsetThreshold;
  const explicitBreakSupportsNewLine = previous.hasEOL && (horizontalReset || baselineOffset > config.scriptBaselineOffsetThreshold);
  const sameLine = sameDirection && sameOrientation && horizontalCompatible && envelopeCompatible && !resetSignalsNewLine && !explicitBreakSupportsNewLine;
  const evidence = [
    "source-order-continuity",
    sameDirection ? "same-writing-direction" : "writing-direction-transition",
    sameOrientation ? "same-orientation" : "orientation-transition",
    horizontalCompatible ? "horizontal-flow-continuity" : "horizontal-flow-break",
    overlap >= config.minimumVerticalOverlapRatio ? "vertical-overlap" : null,
    baselineOffset <= config.maximumInlineBaselineOffset ? "baseline-compatible" : "baseline-incompatible",
    baselineOffset > config.scriptBaselineOffsetThreshold && envelopeCompatible ? "inline-baseline-offset" : null,
    envelopeCompatible ? "line-envelope-compatible" : "line-envelope-break",
    resetSignalsNewLine ? "horizontal-reset-with-line-displacement" : null,
    explicitBreakSupportsNewLine ? "explicit-line-break" : null,
  ].filter(Boolean);
  return { sameLine, evidence, verticalOverlap: overlap, normalizedBaselineOffset: baselineOffset, directionalGap, horizontalReset, horizontalCompatible, envelopeCompatible, sameDirection, sameOrientation, metrics };
};

const finalizeLine = (rawLine, lineIndex, pageIndex, makeId, documentId, config) => {
  const metrics = lineMetrics(rawLine.items);
  const items = rawLine.items.map((item, itemIndex) => {
    const normalizedBaselineOffset = (item.baseline - metrics.dominantBaseline) / Math.max(1, metrics.dominantLineHeight);
    const absoluteOffset = Math.abs(normalizedBaselineOffset);
    const relativeVerticalPosition = absoluteOffset <= config.scriptBaselineOffsetThreshold ? "normal" : normalizedBaselineOffset < 0 ? "above-baseline" : "below-baseline";
    const heightRatio = item.height / Math.max(1, metrics.dominantLineHeight);
    const scriptCandidate = absoluteOffset > config.scriptBaselineOffsetThreshold && heightRatio <= config.scriptMaximumHeightRatio
      ? normalizedBaselineOffset < 0 ? "superscript" : "subscript"
      : absoluteOffset > config.maximumInlineBaselineOffset ? "unknown" : "normal";
    return {
      ...item, resolvedOrderWithinLine: itemIndex, baselineOffset: item.baseline - metrics.dominantBaseline,
      normalizedBaselineOffset, verticalOverlap: verticalOverlapRatio(metrics.bbox, item.bbox), relativeVerticalPosition, scriptCandidate,
      sameLineEvidence: rawLine.itemEvidence[item.id] || (itemIndex === 0 ? ["line-origin"] : []),
    };
  });
  const id = makeId ? makeId("physical-line", documentId, pageIndex, items.map((item) => item.sourceItemId)) : `physical-line:${documentId}:${pageIndex}:${items.map((item) => item.sourceItemId).join(":")}`;
  return {
    id, type: "physical-line", modelVersion: PHYSICAL_LINE_MODEL_VERSION, pageIndex, pageNumber: pageIndex + 1,
    sourceItemIds: items.map((item) => item.sourceItemId), sourceCharacterIds: unique(items.flatMap((item) => item.sourceCharacterIds)),
    sourceStartIndex: Math.min(...items.map((item) => item.sourceOrder)), sourceEndIndex: Math.max(...items.map((item) => item.sourceOrder)) + 1,
    bbox: metrics.bbox, xStart: metrics.bbox.x, xEnd: metrics.bbox.x + metrics.bbox.width, yTop: metrics.bbox.y, yBottom: metrics.bbox.y + metrics.bbox.height,
    dominantBaseline: metrics.dominantBaseline, dominantLineHeight: metrics.dominantLineHeight, baseline: metrics.dominantBaseline,
    upperEnvelope: metrics.upperEnvelope, lowerEnvelope: metrics.lowerEnvelope,
    orientation: weightedMedian(items.map((item) => ({ value: item.orientation, weight: Math.max(1, Array.from(item.text).length) })), 0),
    writingDirection: items[0]?.writingDirection || "ltr", textDirection: items[0]?.writingDirection || "ltr",
    items, sourceText: items.sort((left, right) => left.sourceOrder - right.sourceOrder).map((item) => item.text).join(""),
    resolvedText: [...items].sort((left, right) => items[0]?.writingDirection === "rtl" ? right.bbox.x - left.bbox.x : left.bbox.x - right.bbox.x).map((item) => item.text).join(""),
    resolvedLineIndex: lineIndex, readingOrderIndex: lineIndex, confidence: clamp(items.reduce((sum, item) => sum + (item.sameLineEvidence.includes("line-envelope-compatible") ? 1 : 0.8), 0) / Math.max(1, items.length)),
    evidence: unique(items.flatMap((item) => item.sameLineEvidence)),
  };
};

export const buildConsecutiveLineRelations = (lines = [], requestedConfig = {}, makeId, documentId = "document") => {
  const config = { ...DEFAULT_PHYSICAL_LINE_CONFIG, ...requestedConfig };
  return lines.slice(1).map((next, index) => {
    const previous = lines[index];
    const localHeight = median([previous.dominantLineHeight, next.dominantLineHeight], 1);
    const verticalGap = next.bbox.y - (previous.bbox.y + previous.bbox.height);
    const sameOrientation = Math.abs(previous.orientation - next.orientation) <= config.orientationToleranceDegrees;
    const sameColumn = horizontalOverlapRatio(previous.bbox, next.bbox) >= 0.2 || Math.abs(previous.bbox.x - next.bbox.x) <= localHeight * 2;
    const id = makeId ? makeId("line-relation", documentId, previous.id, next.id) : `line-relation:${previous.id}:${next.id}`;
    return { id, previousLineId: previous.id, nextLineId: next.id, pageIndex: previous.pageIndex, verticalGap, normalizedGap: verticalGap / Math.max(1, localHeight), sameColumn, sameOrientation, sameWritingDirection: previous.writingDirection === next.writingDirection, horizontalOverlap: horizontalOverlapRatio(previous.bbox, next.bbox), consecutiveSourceFlow: previous.sourceEndIndex === next.sourceStartIndex, evidenceOnly: true };
  });
};

/** Deterministically reconstruct horizontal writing-flow lines from source order. */
export const reconstructPhysicalLines = ({ documentId = "document", pageIndex = 0, sourceItems = [], makeId, requestedConfig = {} } = {}) => {
  const config = { ...DEFAULT_PHYSICAL_LINE_CONFIG, ...requestedConfig };
  const ordered = sourceItems.map(normalizeItem).filter((item) => item.text.length > 0 && item.bbox.width >= 0).sort((left, right) => left.sourceOrder - right.sourceOrder || left.id.localeCompare(right.id));
  const rawLines = [];
  ordered.forEach((item) => {
    const current = rawLines.at(-1);
    if (!current) { rawLines.push({ items: [item], itemEvidence: { [item.id]: ["line-origin"] } }); return; }
    const decision = flowEvidence(current.items, item, config);
    if (!decision.sameLine) rawLines.push({ items: [item], itemEvidence: { [item.id]: ["line-origin", ...decision.evidence] } });
    else { current.items.push(item); current.itemEvidence[item.id] = decision.evidence; }
  });
  const lines = rawLines.map((line, index) => finalizeLine(line, index, Number(pageIndex), makeId, documentId, config));
  return { version: PHYSICAL_LINE_MODEL_VERSION, lines, relations: buildConsecutiveLineRelations(lines, config, makeId, documentId), sourceItems: ordered, config };
};
