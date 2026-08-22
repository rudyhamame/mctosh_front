export const PHYSICAL_BLOCK_MODEL_VERSION = "physical-blocks-v3-ordinary-spacing-regimes";
export const MANUAL_PHYSICAL_BLOCK_MODEL_VERSION = "manual-physical-blocks-v1-line-groups";
export const DOCUMENT_FORM_MODEL_VERSION = "document-forms-v1-manual";

export const DOCUMENT_FORM_TYPES = Object.freeze([
  "PARAGRAPH",
  "HEADING",
  "SUBHEADING",
  "LIST",
  "LIST_ITEM",
  "CAPTION",
  "TABLE",
  "TABLE_CELL",
  "FOOTNOTE",
  "LABEL",
  "QUOTE",
  "SIDEBAR",
  "UNKNOWN",
]);

export const DEFAULT_PHYSICAL_BLOCK_CONFIG = Object.freeze({
  gapRegimeTolerance: 0.42,
  minimumGapDiscontinuity: 0.38,
  maximumNormalizedGapWithinBlock: 1.25,
  spacingContextWindow: 3,
  minimumSpacingRegimeTolerance: 0.1,
  spacingRegimeRelativeTolerance: 0.35,
  spacingRegimeMadMultiplier: 3,
  minimumBlockSpacingSamples: 2,
  lineHeightCompatibilityRatio: 1.35,
  horizontalOverlapRatio: 0.25,
  leftEdgeToleranceInLineHeights: 2.5,
  orientationToleranceDegrees: 2,
  dispersionUnresolvedThreshold: 0.5,
});

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const normalizeBBox = (value) => value ? {
  pageIndex: Number(value.pageIndex),
  x: finite(value.x ?? value.left),
  y: finite(value.y ?? value.top),
  width: Math.max(0, finite(value.width, finite(value.right) - finite(value.left))),
  height: Math.max(0, finite(value.height, finite(value.bottom) - finite(value.top))),
} : null;
const median = (values, fallback = 0) => {
  const ordered = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  return ordered.length ? ordered[Math.floor(ordered.length / 2)] : fallback;
};
const unique = (values) => [...new Set(values.filter((value) => value != null))];
const unionBBox = (lines) => {
  const left = Math.min(...lines.map((line) => line.bbox.x));
  const top = Math.min(...lines.map((line) => line.bbox.y));
  const right = Math.max(...lines.map((line) => line.bbox.x + line.bbox.width));
  const bottom = Math.max(...lines.map((line) => line.bbox.y + line.bbox.height));
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
};
const contiguousSpans = (indexes) => {
  const ordered = unique(indexes.map(Number).filter(Number.isInteger)).sort((a, b) => a - b);
  if (!ordered.length) return [];
  const spans = []; let start = ordered[0]; let previous = ordered[0];
  ordered.slice(1).forEach((index) => {
    if (index !== previous + 1) { spans.push({ start, end: previous + 1 }); start = index; }
    previous = index;
  });
  spans.push({ start, end: previous + 1 });
  return spans;
};
const textForSpans = (canonicalText, spans) => {
  const characters = Array.from(String(canonicalText || ""));
  return spans.map((span) => characters.slice(span.start, span.end).join("")).join("");
};
const normalizeSpans = (spans) => {
  const ordered = spans
    .filter((span) => Number.isInteger(span?.start) && Number.isInteger(span?.end) && span.end > span.start)
    .map((span) => ({ start: span.start, end: span.end }))
    .sort((left, right) => left.start - right.start || left.end - right.end);
  return ordered.reduce((merged, span) => {
    const previous = merged.at(-1);
    if (!previous || span.start > previous.end) merged.push({ ...span });
    else previous.end = Math.max(previous.end, span.end);
    return merged;
  }, []);
};
const overlapRatio = (left, right) => {
  const overlap = Math.max(0, Math.min(left.bbox.x + left.bbox.width, right.bbox.x + right.bbox.width) - Math.max(left.bbox.x, right.bbox.x));
  return overlap / Math.max(1, Math.min(left.bbox.width, right.bbox.width));
};
const directionOf = (line) => String(line.textDirection || line.direction || "ltr").toLocaleLowerCase();
const orientationOf = (line) => finite(line.orientation ?? line.rotation, 0);
const lineHeightRatio = (left, right) => {
  const low = Math.max(0.01, Math.min(finite(left?.bbox?.height, 1), finite(right?.bbox?.height, 1)));
  const high = Math.max(low, finite(left?.bbox?.height, 1), finite(right?.bbox?.height, 1));
  return high / low;
};

const enrichLines = ({ physicalPages, characters, canonicalText, excludedLineIds = [] }) => {
  const excluded = new Set(excludedLineIds);
  const canonicalIndexesByLine = new Map();
  const sourceItemsByLine = new Map();
  characters.forEach((character) => (character.sourceRefs || []).forEach((reference) => {
    if (!reference.lineId) return;
    const indexes = canonicalIndexesByLine.get(reference.lineId) || [];
    indexes.push(character.canonicalIndex);
    canonicalIndexesByLine.set(reference.lineId, indexes);
    const items = sourceItemsByLine.get(reference.lineId) || [];
    if (reference.textItemId) items.push(reference.textItemId);
    sourceItemsByLine.set(reference.lineId, items);
  }));
  return physicalPages.flatMap((page) => page.regions
    .filter((region) => region.includeInBodyReadingOrder !== false)
    .sort((left, right) => finite(left.readingOrderIndex) - finite(right.readingOrderIndex))
    .flatMap((region) => region.lines.filter((line) => !excluded.has(line.id)).map((line) => {
      const canonicalSpans = contiguousSpans(canonicalIndexesByLine.get(line.id) || []);
      const bbox = { x: finite(line.xStart), y: finite(line.yTop), width: Math.max(0, finite(line.xEnd) - finite(line.xStart)), height: Math.max(0, finite(line.yBottom) - finite(line.yTop)) };
      return {
        id: line.id,
        pageIndex: page.pageIndex,
        pageNumber: Number(page.pageIndex) + 1,
        bbox,
        baseline: finite(line.baseline, bbox.y + bbox.height),
        canonicalSpans,
        canonicalText: textForSpans(canonicalText, canonicalSpans),
        sourceItemIds: unique(sourceItemsByLine.get(line.id) || []),
        sourceEvidenceIds: unique(sourceItemsByLine.get(line.id) || []),
        textDirection: directionOf(line),
        columnId: line.columnId ?? "column-0",
        orientation: orientationOf(line),
        typographyProfile: { fontName: line.fontName || "unknown", fontSize: finite(line.fontSize), lineHeight: bbox.height },
        readingOrderIndex: finite(line.readingOrderIndex, finite(region.readingOrderIndex)),
        regionId: region.id,
        regionType: region.regionType || "body",
      };
    })));
};

const hardCompatibility = (previous, next, config) => {
  const reasons = [];
  const samePage = previous.pageIndex === next.pageIndex;
  const sameColumn = String(previous.columnId) === String(next.columnId);
  const sameWritingDirection = directionOf(previous) === directionOf(next);
  const sameOrientation = Math.abs(orientationOf(previous) - orientationOf(next)) <= config.orientationToleranceDegrees;
  const consecutiveReadingOrder = next.readingOrderIndex === previous.readingOrderIndex + 1;
  if (!samePage) reasons.push("page-transition");
  if (!sameColumn) reasons.push("column-transition");
  if (!sameWritingDirection) reasons.push("writing-direction-transition");
  if (!sameOrientation) reasons.push("orientation-transition");
  if (!consecutiveReadingOrder) reasons.push("non-consecutive-reading-order");
  const lineHeight = median([previous.bbox.height, next.bbox.height], 1);
  const horizontalOverlapRatio = overlapRatio(previous, next);
  const horizontalCompatible = horizontalOverlapRatio >= config.horizontalOverlapRatio
    || Math.abs(previous.bbox.x - next.bbox.x) <= lineHeight * config.leftEdgeToleranceInLineHeights;
  if (!horizontalCompatible) reasons.push("incompatible-horizontal-region");
  return { compatible: reasons.length === 0, reasons, samePage, sameColumn, sameWritingDirection, sameOrientation, consecutiveReadingOrder, horizontalCompatible, horizontalOverlapRatio, localMedianLineHeight: lineHeight };
};

const adjacentLinePairEvidence = (previous, next, pairIndex, config) => {
  const compatibility = hardCompatibility(previous, next, config);
  const rawVerticalGap = next.bbox.y - (previous.bbox.y + previous.bbox.height);
  const verticalGap = Math.max(0, rawVerticalGap);
  const normalizedGap = verticalGap / Math.max(1, compatibility.localMedianLineHeight);
  const heightRatio = lineHeightRatio(previous, next);
  const indentationDelta = Math.abs(previous.bbox.x - next.bbox.x);
  const widthRatio = Math.min(previous.bbox.width, next.bbox.width) / Math.max(1, Math.max(previous.bbox.width, next.bbox.width));
  const fontSizeRatio = Math.max(finite(previous.typographyProfile?.fontSize, 1), finite(next.typographyProfile?.fontSize, 1))
    / Math.max(0.01, Math.min(finite(previous.typographyProfile?.fontSize, 1), finite(next.typographyProfile?.fontSize, 1)));
  return {
    pairIndex,
    previousLineId: previous.id,
    currentLineId: next.id,
    pageIndex: previous.pageIndex,
    columnId: previous.columnId,
    orientation: orientationOf(previous),
    writingDirection: directionOf(previous),
    verticalGap,
    rawVerticalGap,
    normalizedGap,
    previousLineHeight: previous.bbox.height,
    currentLineHeight: next.bbox.height,
    localMedianLineHeight: compatibility.localMedianLineHeight,
    lineHeightRatio: heightRatio,
    lineHeightCompatible: heightRatio <= config.lineHeightCompatibilityRatio,
    horizontalOverlapRatio: compatibility.horizontalOverlapRatio,
    sameColumn: compatibility.sameColumn,
    sameOrientation: compatibility.sameOrientation,
    sameWritingDirection: compatibility.sameWritingDirection,
    consecutiveReadingOrder: compatibility.consecutiveReadingOrder,
    indentationDelta,
    widthRatio,
    fontSizeRatio,
    sameFont: String(previous.typographyProfile?.fontName || "") === String(next.typographyProfile?.fontName || ""),
    previousRegionType: previous.regionType,
    currentRegionType: next.regionType,
    compatibility,
  };
};

const summarizeGapCluster = (values, config) => {
  const baseline = median(values, 0);
  const deviations = values.map((value) => Math.abs(value - baseline));
  const mad = median(deviations, 0);
  const ordered = values.slice().sort((left, right) => left - right);
  const tolerance = Math.min(
    config.gapRegimeTolerance,
    Math.max(config.minimumSpacingRegimeTolerance, mad * config.spacingRegimeMadMultiplier, baseline * config.spacingRegimeRelativeTolerance),
  );
  return {
    baseline,
    mad,
    tolerance,
    sampleCount: values.length,
    minimum: ordered[0] ?? 0,
    maximum: ordered.at(-1) ?? 0,
  };
};

export const inferOrdinaryLineSpacingRegime = (pairEvidence = [], requestedConfig = {}, scope = "unknown") => {
  const config = { ...DEFAULT_PHYSICAL_BLOCK_CONFIG, ...requestedConfig };
  const values = pairEvidence
    .map((pair) => finite(pair?.normalizedGap, Number.NaN))
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((left, right) => left - right);
  if (!values.length) return null;
  const clusters = [];
  values.forEach((value) => {
    const current = clusters.at(-1);
    if (!current || value - current.at(-1) > config.minimumGapDiscontinuity) clusters.push([value]);
    else current.push(value);
  });
  const summaries = clusters.map((cluster) => summarizeGapCluster(cluster, config));
  const minimumDenseSupport = Math.max(2, Math.ceil(values.length * 0.1));
  const supportedLowGapClusters = summaries
    .filter((cluster) => cluster.sampleCount >= minimumDenseSupport)
    .sort((left, right) => left.baseline - right.baseline || right.sampleCount - left.sampleCount);
  const ordinary = supportedLowGapClusters[0] || summaries.slice().sort((left, right) =>
    right.sampleCount - left.sampleCount || left.baseline - right.baseline)[0];
  return {
    ...ordinary,
    scope,
    totalSampleCount: values.length,
    reliable: values.length >= 2,
    minimumDenseSupport,
    clusters: summaries,
    largerGapRegimes: summaries.filter((cluster) => cluster !== ordinary && cluster.baseline > ordinary.baseline),
  };
};

const plausibleOrdinarySpacingPair = (pair) => pair.compatibility.compatible
  && pair.lineHeightCompatible
  && pair.rawVerticalGap >= 0;

const scopedOrdinarySpacingRegime = (target, allPairs, config) => {
  const plausible = allPairs.filter(plausibleOrdinarySpacingPair);
  const comparableHeight = (pair) => Math.max(pair.localMedianLineHeight, target.localMedianLineHeight)
    / Math.max(0.01, Math.min(pair.localMedianLineHeight, target.localMedianLineHeight)) <= config.lineHeightCompatibilityRatio;
  const scopes = [
    ["page-column-orientation-line-height", (pair) => pair.pageIndex === target.pageIndex && String(pair.columnId) === String(target.columnId) && pair.writingDirection === target.writingDirection && Math.abs(pair.orientation - target.orientation) <= config.orientationToleranceDegrees && comparableHeight(pair)],
    ["page-column", (pair) => pair.pageIndex === target.pageIndex && String(pair.columnId) === String(target.columnId)],
    ["page", (pair) => pair.pageIndex === target.pageIndex],
    ["document-compatible-line-height", (pair) => pair.writingDirection === target.writingDirection && Math.abs(pair.orientation - target.orientation) <= config.orientationToleranceDegrees && comparableHeight(pair)],
    ["document", () => true],
  ];
  let sparseFallback = null;
  for (const [scope, predicate] of scopes) {
    const samples = plausible.filter(predicate);
    if (!samples.length) continue;
    const regime = inferOrdinaryLineSpacingRegime(samples, config, scope);
    if (samples.length >= 2) return regime;
    sparseFallback ||= regime;
  }
  return sparseFallback;
};

const strongIndependentBoundaryEvidence = (previous, next, pair, config) => {
  const evidence = [];
  const majorAlignmentTransition = pair.indentationDelta > pair.localMedianLineHeight * config.leftEdgeToleranceInLineHeights
    && pair.widthRatio < 0.72;
  const majorTypographyTransition = pair.fontSizeRatio >= 1.25;
  const combinedRoleTransition = !pair.sameFont && pair.fontSizeRatio >= 1.12 && pair.widthRatio < 0.82;
  if (majorAlignmentTransition) evidence.push("major-alignment-transition");
  if (majorTypographyTransition) evidence.push("major-typography-transition");
  if (combinedRoleTransition) evidence.push("typography-alignment-role-transition");
  if (previous.regionType !== next.regionType) evidence.push("region-role-transition");
  return evidence;
};

export const reconstructPhysicalBlocks = ({ documentId, physicalPages = [], characters = [], canonicalText = "", makeId, requestedConfig = {}, excludedLineIds = [] }) => {
  const config = { ...DEFAULT_PHYSICAL_BLOCK_CONFIG, ...requestedConfig };
  const lines = enrichLines({ physicalPages, characters, canonicalText, excludedLineIds });
  const boundaries = []; const blocks = [];
  const byPage = new Map();
  lines.forEach((line) => { const pageLines = byPage.get(line.pageIndex) || []; pageLines.push(line); byPage.set(line.pageIndex, pageLines); });
  const blockId = (...parts) => makeId ? makeId("physical-block", documentId, ...parts) : `physical-block:${documentId}:${parts.flat().join(":")}`;
  const boundaryId = (...parts) => makeId ? makeId("physical-block-boundary", documentId, ...parts) : `physical-block-boundary:${documentId}:${parts.join(":")}`;

  const finishBlock = (blockLines, gaps, normalizedGaps, startBoundaryId = null, endBoundaryId = null) => {
    if (!blockLines.length) return;
    const canonicalSpans = normalizeSpans(blockLines.flatMap((line) => line.canonicalSpans));
    const medianGap = median(gaps, 0); const medianLineHeight = median(blockLines.map((line) => line.bbox.height), 1);
    const normalizedMedian = median(normalizedGaps, 0);
    const dispersion = median(normalizedGaps.map((gap) => Math.abs(gap - normalizedMedian)), 0);
    const bbox = unionBBox(blockLines);
    blocks.push({
      id: blockId(blockLines.map((line) => line.id)),
      displayIndex: blocks.length + 1,
      modelVersion: PHYSICAL_BLOCK_MODEL_VERSION,
      pageIndexes: unique(blockLines.map((line) => line.pageIndex)),
      pageNumbers: unique(blockLines.map((line) => line.pageNumber)),
      bbox,
      lineIds: blockLines.map((line) => line.id),
      canonicalSpans,
      canonicalText: textForSpans(canonicalText, canonicalSpans),
      spacingProfile: { gaps: [...gaps], normalizedGaps: [...normalizedGaps], medianGap, medianLineHeight, dispersion },
      geometryProfile: {
        columnId: blockLines[0].columnId,
        writingDirection: blockLines[0].textDirection,
        orientation: blockLines[0].orientation,
        leftEdge: bbox.x,
        rightEdge: bbox.x + bbox.width,
        width: bbox.width,
        alignment: Math.max(...blockLines.map((line) => Math.abs(line.bbox.x - bbox.x))) <= medianLineHeight * 0.35 ? "left" : "mixed",
      },
      typographyProfile: {
        dominantFontName: blockLines.map((line) => line.typographyProfile.fontName).sort((a, b) => blockLines.filter((line) => line.typographyProfile.fontName === b).length - blockLines.filter((line) => line.typographyProfile.fontName === a).length)[0] || "unknown",
        medianFontSize: median(blockLines.map((line) => line.typographyProfile.fontSize), 0),
      },
      sourceEvidenceIds: unique(blockLines.flatMap((line) => line.sourceEvidenceIds)),
      startBoundaryId,
      endBoundaryId,
      reconstruction: { method: "line-spacing-regime", confidence: dispersion > config.dispersionUnresolvedThreshold ? "supporting" : "strong", unresolved: dispersion > config.dispersionUnresolvedThreshold, source: "automatic" },
      documentFormIds: [],
    });
  };

  const orderedPages = [...byPage.entries()].sort((left, right) => left[0] - right[0]).map(([pageIndex, pageLines]) => ({
    pageIndex,
    lines: pageLines.slice().sort((left, right) => left.readingOrderIndex - right.readingOrderIndex || left.bbox.y - right.bbox.y || left.bbox.x - right.bbox.x),
  }));
  // Infer ordinary spacing from raw adjacent-line relationships before any
  // PhysicalBlock membership exists. This avoids the circular dependency in
  // which a new block used heterogeneous neighboring boundaries as its own
  // expected internal spacing.
  const allPairEvidence = orderedPages.flatMap(({ lines: ordered }) => ordered.slice(1).map((next, offset) => adjacentLinePairEvidence(ordered[offset], next, offset + 1, config)));

  orderedPages.forEach(({ lines: ordered }) => {
    if (!ordered.length) return;
    const pagePairs = allPairEvidence.filter((pair) => pair.pageIndex === ordered[0].pageIndex);
    const pairByIndex = new Map(pagePairs.map((pair) => [pair.pairIndex, pair]));
    let currentLines = [ordered[0]]; let currentGaps = []; let currentNormalizedGaps = []; let startBoundaryId = null;
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1]; const next = ordered[index];
      const pair = pairByIndex.get(index) || adjacentLinePairEvidence(previous, next, index, config);
      const { compatibility, verticalGap: gap, normalizedGap } = pair;
      const ordinaryRegime = scopedOrdinarySpacingRegime(pair, allPairEvidence, config);
      const ordinaryDifference = ordinaryRegime ? Math.abs(normalizedGap - ordinaryRegime.baseline) : Number.POSITIVE_INFINITY;
      const gapMatchesOrdinaryLineSpacing = Boolean(ordinaryRegime?.reliable) && ordinaryDifference <= ordinaryRegime.tolerance;
      const blockInternalRegime = currentNormalizedGaps.length >= config.minimumBlockSpacingSamples
        ? inferOrdinaryLineSpacingRegime(currentNormalizedGaps.map((value) => ({ normalizedGap: value })), config, "established-block")
        : null;
      const blockInternalDifference = blockInternalRegime ? Math.abs(normalizedGap - blockInternalRegime.baseline) : Number.POSITIVE_INFINITY;
      const gapMatchesEstablishedBlock = Boolean(blockInternalRegime) && blockInternalDifference <= blockInternalRegime.tolerance;
      const independentBoundaryEvidence = compatibility.compatible ? strongIndependentBoundaryEvidence(previous, next, pair, config) : [];
      const strongFlowContinuity = compatibility.compatible && pair.horizontalOverlapRatio >= config.horizontalOverlapRatio && pair.lineHeightCompatible;
      const contextWindow = Math.max(1, Math.floor(finite(config.spacingContextWindow, 3)));
      const contextualBoundaryGaps = [];
      for (let offset = 1; offset <= contextWindow; offset += 1) {
        if (pairByIndex.has(index - offset)) contextualBoundaryGaps.push(pairByIndex.get(index - offset).normalizedGap);
        if (pairByIndex.has(index + offset)) contextualBoundaryGaps.push(pairByIndex.get(index + offset).normalizedGap);
      }
      const contextualBoundaryGapMedian = contextualBoundaryGaps.length ? median(contextualBoundaryGaps, 0) : null;
      const sparseDirectContinuity = !ordinaryRegime?.reliable && normalizedGap <= config.gapRegimeTolerance && strongFlowContinuity;
      const sameBlock = compatibility.compatible
        && independentBoundaryEvidence.length === 0
        && normalizedGap <= config.maximumNormalizedGapWithinBlock
        && ((gapMatchesOrdinaryLineSpacing && strongFlowContinuity) || gapMatchesEstablishedBlock || sparseDirectContinuity);
      const splitReasons = !compatibility.compatible
        ? compatibility.reasons
        : independentBoundaryEvidence.length ? independentBoundaryEvidence : ["inter-block-gap", "ordinary-line-spacing-mismatch"];
      const decision = sameBlock ? "same-block" : "new-block";
      const mergeEvidence = gapMatchesOrdinaryLineSpacing
        ? ["ordinary-line-spacing-match", "same-column", "consecutive-reading-order", "same-orientation", "same-writing-direction", "strong-horizontal-overlap"]
        : gapMatchesEstablishedBlock ? ["established-block-spacing-match", "compatible-physical-region"]
          : sparseDirectContinuity ? ["sparse-direct-spacing-continuity", "compatible-physical-region"] : [];
      const id = boundaryId(previous.id, next.id);
      boundaries.push({
        id,
        modelVersion: PHYSICAL_BLOCK_MODEL_VERSION,
        pageIndex: previous.pageIndex,
        previousLineId: previous.id,
        nextLineId: next.id,
        decision,
        evidence: sameBlock ? mergeEvidence : splitReasons,
        gap,
        normalizedGap,
        ordinaryLineGapBaseline: ordinaryRegime?.baseline ?? null,
        ordinaryLineGapTolerance: ordinaryRegime?.tolerance ?? null,
        ordinaryLineGapSpread: ordinaryRegime?.mad ?? null,
        ordinaryLineGapSampleCount: ordinaryRegime?.totalSampleCount ?? 0,
        ordinaryLineGapScope: ordinaryRegime?.scope ?? null,
        detectedSpacingRegimes: ordinaryRegime?.clusters || [],
        blockInternalGapBaseline: blockInternalRegime?.baseline ?? null,
        blockMedianNormalizedGap: blockInternalRegime?.baseline ?? ordinaryRegime?.baseline ?? null,
        pageMedianNormalizedGap: ordinaryRegime?.baseline ?? null,
        contextualBoundaryGapMedian,
        contextualBoundaryGaps,
        // Compatibility alias for older diagnostics. Context is retained as
        // boundary evidence only and is never an intra-line fallback.
        contextualMedianNormalizedGap: contextualBoundaryGapMedian,
        localMedianLineHeight: compatibility.localMedianLineHeight,
        horizontalOverlapRatio: compatibility.horizontalOverlapRatio,
        sameColumn: pair.sameColumn,
        sameOrientation: pair.sameOrientation,
        sameWritingDirection: pair.sameWritingDirection,
        consecutiveReadingOrder: pair.consecutiveReadingOrder,
        lineHeightCompatible: pair.lineHeightCompatible,
        independentBoundaryEvidence,
        status: compatibility.compatible ? "asserted" : "hard-boundary",
      });
      if (decision === "new-block") {
        finishBlock(currentLines, currentGaps, currentNormalizedGaps, startBoundaryId, id);
        currentLines = [next]; currentGaps = []; currentNormalizedGaps = []; startBoundaryId = id;
      } else {
        currentLines.push(next); currentGaps.push(gap); currentNormalizedGaps.push(normalizedGap);
      }
    }
    finishBlock(currentLines, currentGaps, currentNormalizedGaps, startBoundaryId, null);
  });

  return { version: PHYSICAL_BLOCK_MODEL_VERSION, lines, blocks, boundaries, excludedLineIds: unique(excludedLineIds), config };
};

export const buildDocumentForms = ({ documentId, physicalBlocks = [], assignments = [], characters = [], canonicalText = "", makeId }) => {
  const blockById = new Map(physicalBlocks.map((block) => [block.id, block]));
  const intersects = (block, bbox) => block.pageIndexes.includes(bbox.pageIndex)
    && block.bbox.x < bbox.x + bbox.width && block.bbox.x + block.bbox.width > bbox.x
    && block.bbox.y < bbox.y + bbox.height && block.bbox.y + block.bbox.height > bbox.y;
  const characterIndexesInBBoxes = (bboxes) => characters.filter((character) => (character.sourceRefs || []).some((reference) => bboxes.some((bbox) => (
    Number(reference.pageIndex) === bbox.pageIndex
    && finite(reference.x) < bbox.x + bbox.width && finite(reference.x) + Math.max(0, finite(reference.width)) > bbox.x
    && finite(reference.y) < bbox.y + bbox.height && finite(reference.y) + Math.max(0, finite(reference.height)) > bbox.y
  )))).map((character) => character.canonicalIndex);
  const forms = assignments.flatMap((assignment, index) => {
    // A manually drawn PhysicalBlock is a physical grouping assertion only.
    // It must not silently become a paragraph or another document form.
    if (assignment.createDocumentForm === false || assignment.kind === "manual-physical-block") return [];
    const type = String(assignment.type || assignment.documentFormType || "UNKNOWN").toUpperCase();
    if (!DOCUMENT_FORM_TYPES.includes(type)) return [];
    const bboxes = (Array.isArray(assignment.bboxes) ? assignment.bboxes : [assignment.bbox]).map(normalizeBBox).filter((bbox) => bbox && Number.isInteger(bbox.pageIndex) && bbox.width > 0 && bbox.height > 0);
    const explicitBlocks = unique(assignment.physicalBlockIds || []).map((id) => blockById.get(id)).filter(Boolean);
    const bboxBlocks = physicalBlocks.filter((block) => bboxes.some((bbox) => intersects(block, bbox)));
    const referencedBlocks = unique([...explicitBlocks, ...bboxBlocks].map((block) => block.id)).map((id) => blockById.get(id));
    if (!referencedBlocks.length && !bboxes.length) return [];
    const bboxCanonicalSpans = contiguousSpans(characterIndexesInBBoxes(bboxes));
    const canonicalSpans = normalizeSpans(explicitBlocks.length
      ? explicitBlocks.flatMap((block) => block.canonicalSpans)
      : bboxCanonicalSpans.length ? bboxCanonicalSpans : referencedBlocks.flatMap((block) => block.canonicalSpans));
    const id = assignment.id || (makeId ? makeId("document-form", documentId, type, referencedBlocks.map((block) => block.id), bboxes, index) : `document-form:${documentId}:${index}`);
    return [{
      id,
      displayIndex: index + 1,
      modelVersion: DOCUMENT_FORM_MODEL_VERSION,
      type,
      physicalBlockIds: referencedBlocks.map((block) => block.id),
      bboxes,
      canonicalSpans,
      canonicalText: textForSpans(canonicalText, canonicalSpans),
      source: assignment.source || "manual",
      status: "assigned",
      pageIndexes: unique([...referencedBlocks.flatMap((block) => block.pageIndexes), ...bboxes.map((bbox) => Number(bbox.pageIndex)).filter(Number.isInteger)]),
    }];
  });
  forms.forEach((form) => form.physicalBlockIds.forEach((id) => { const block = blockById.get(id); if (block) block.documentFormIds.push(form.id); }));
  return forms;
};

/** Build only explicit user-asserted line groups; never called automatically. */
export const buildManualPhysicalBlocks = ({ documentId, physicalLines = [], assignments = [], canonicalText = "", makeId }) => {
  const lineById = new Map(physicalLines.map((line) => [line.id, line]));
  return assignments.flatMap((assignment, index) => {
    const explicitLines = unique(assignment.lineIds || assignment.physicalLineIds || []).map((id) => lineById.get(id)).filter(Boolean);
    const selectionBBoxes = (Array.isArray(assignment.bboxes) ? assignment.bboxes : [assignment.bbox])
      .map(normalizeBBox)
      .filter((bbox) => bbox && Number.isInteger(bbox.pageIndex) && bbox.width > 0 && bbox.height > 0);
    // Persisted PyMuPDF lines and the live PDF.js preview can have different
    // deterministic IDs even though they identify the same visible line.
    // The user's selection rectangles are therefore the cross-engine source
    // of truth whenever the explicit line IDs cannot be resolved.
    const bboxLines = explicitLines.length ? [] : physicalLines.filter((line) => selectionBBoxes.some((bbox) => (
      Number(line.pageIndex) === bbox.pageIndex
      && finite(line.bbox?.x) < bbox.x + bbox.width
      && finite(line.bbox?.x) + Math.max(0, finite(line.bbox?.width)) > bbox.x
      && finite(line.bbox?.y) < bbox.y + bbox.height
      && finite(line.bbox?.y) + Math.max(0, finite(line.bbox?.height)) > bbox.y
    )));
    const lines = explicitLines.length ? explicitLines : bboxLines;
    if (!lines.length) return [];
    const canonicalSpans = normalizeSpans(lines.flatMap((line) => line.canonicalSpans || []));
    const bbox = unionBBox(lines.map((line) => ({ bbox: line.bbox })));
    const id = assignment.manualPhysicalBlockId || (makeId ? makeId("manual-physical-block", documentId, lines.map((line) => line.id), index) : `manual-physical-block:${documentId}:${index}`);
    return [{
      id, type: "manual-physical-block", displayIndex: index + 1, modelVersion: MANUAL_PHYSICAL_BLOCK_MODEL_VERSION,
      pageIndexes: unique(lines.map((line) => line.pageIndex)), pageNumbers: unique(lines.map((line) => line.pageNumber)), bbox,
      lineIds: lines.map((line) => line.id), canonicalSpans, canonicalText: textForSpans(canonicalText, canonicalSpans),
      sourceEvidenceIds: unique(lines.flatMap((line) => line.sourceItemIds || [])), documentFormIds: [],
      createdBy: assignment.createdBy || (assignment.source === "ai" ? "ai" : "user"), source: assignment.source || "manual", purpose: assignment.purpose || "manual-physical-group", label: assignment.label || "PhysicalBlock",
      reconstruction: assignment.source === "ai"
        ? { method: "ai-line-group", confidence: "model-reported", unresolved: false, source: "ai", blockType: assignment.blockType || "unknown", evidence: assignment.evidence || [], status: assignment.status || "candidate", provider: assignment.provider || null, model: assignment.model || null, promptVersion: assignment.promptVersion || null }
        : { method: "explicit-line-group", confidence: "asserted", unresolved: false, source: "manual" },
    }];
  });
};

export const physicalBlockTextFromCanonical = textForSpans;
