import { deterministicHash, FORENSIC_CONFLICT_TYPES } from "./documentReconstruction.js";

export const GLYPH_FORENSICS_VERSION = "glyph-forensics-v1";
export const DEFAULT_GLYPH_COMPARISON_CONFIG = Object.freeze({ maskSize: 32, sameFontMalformedThreshold: 0.45, sameFontSuspectedThreshold: 0.65, fallbackCatastrophicThreshold: 0.2, renderScale: 3 });

const clamp = (value, minimum = 0, maximum = 1) => Math.max(minimum, Math.min(maximum, value));

export const imageDataToInkMask = ({ data, width, height }, threshold = 0.18) => {
  const mask = new Uint8Array(width * height);
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    const alpha = data[offset + 3] / 255;
    const luminance = (data[offset] * 0.2126 + data[offset + 1] * 0.7152 + data[offset + 2] * 0.0722) / 255;
    mask[index] = alpha * (1 - luminance) >= threshold ? 1 : 0;
  }
  return { mask, width, height };
};

const inkBounds = ({ mask, width, height }) => {
  let left = width; let top = height; let right = -1; let bottom = -1;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) if (mask[y * width + x]) { left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); }
  return right < left ? null : { left, top, right, bottom, width: right - left + 1, height: bottom - top + 1 };
};

export const normalizeInkMask = (input, size = 32) => {
  const bounds = inkBounds(input);
  const normalized = new Uint8Array(size * size);
  if (!bounds) return { mask: normalized, width: size, height: size, empty: true };
  const available = size - 4;
  const scale = Math.min(available / bounds.width, available / bounds.height);
  const drawWidth = Math.max(1, Math.round(bounds.width * scale));
  const drawHeight = Math.max(1, Math.round(bounds.height * scale));
  const offsetX = Math.floor((size - drawWidth) / 2); const offsetY = Math.floor((size - drawHeight) / 2);
  for (let y = 0; y < drawHeight; y += 1) for (let x = 0; x < drawWidth; x += 1) {
    const sourceX = bounds.left + Math.min(bounds.width - 1, Math.floor(x / scale));
    const sourceY = bounds.top + Math.min(bounds.height - 1, Math.floor(y / scale));
    normalized[(offsetY + y) * size + offsetX + x] = input.mask[sourceY * input.width + sourceX];
  }
  return { mask: normalized, width: size, height: size, empty: false };
};

const edgeMask = ({ mask, width, height }) => {
  const edges = new Uint8Array(mask.length);
  for (let y = 1; y < height - 1; y += 1) for (let x = 1; x < width - 1; x += 1) {
    const index = y * width + x;
    if (!mask[index]) continue;
    if (!mask[index - 1] || !mask[index + 1] || !mask[index - width] || !mask[index + width]) edges[index] = 1;
  }
  return edges;
};

const overlapMetrics = (left, right) => {
  let intersection = 0; let union = 0; let leftCount = 0; let rightCount = 0; let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index]) leftCount += 1;
    if (right[index]) rightCount += 1;
    if (left[index] && right[index]) intersection += 1;
    if (left[index] || right[index]) union += 1;
    if (left[index] !== right[index]) difference += 1;
  }
  return { intersection, union, leftCount, rightCount, iou: union ? intersection / union : 1, dice: leftCount + rightCount ? 2 * intersection / (leftCount + rightCount) : 1, pixelSimilarity: 1 - difference / Math.max(1, left.length) };
};

export const compareGlyphMasks = (sourceImageData, referenceImageData, config = DEFAULT_GLYPH_COMPARISON_CONFIG) => {
  const source = normalizeInkMask(imageDataToInkMask(sourceImageData), config.maskSize);
  const reference = normalizeInkMask(imageDataToInkMask(referenceImageData), config.maskSize);
  const pixels = overlapMetrics(source.mask, reference.mask);
  const edges = overlapMetrics(edgeMask(source), edgeMask(reference));
  const score = clamp(pixels.dice * 0.45 + pixels.pixelSimilarity * 0.25 + edges.dice * 0.3);
  return { method: "normalized-mask-dice-edge-v1", score, sourceEmpty: source.empty, referenceEmpty: reference.empty, pixelDice: pixels.dice, pixelIoU: pixels.iou, pixelSimilarity: pixels.pixelSimilarity, edgeDice: edges.dice, maskSize: config.maskSize };
};

export const classifyGlyphComparison = (metrics, referenceFontMethod, config = DEFAULT_GLYPH_COMPARISON_CONFIG) => {
  if (metrics.sourceEmpty || metrics.referenceEmpty) return { status: "comparison-inconclusive", reason: metrics.sourceEmpty ? "source-mask-empty" : "reference-mask-empty" };
  if (referenceFontMethod === "source-font") {
    if (metrics.score < config.sameFontMalformedThreshold) return { status: "malformed", reason: "same-font-visual-score-below-malformed-threshold" };
    if (metrics.score < config.sameFontSuspectedThreshold) return { status: "suspected-malformed", reason: "same-font-visual-score-below-suspected-threshold" };
    return { status: "normal", reason: "same-font-comparison-supported" };
  }
  if (metrics.score < config.fallbackCatastrophicThreshold) return { status: "suspected-malformed", reason: "fallback-reference-catastrophic-difference" };
  return { status: "comparison-inconclusive", reason: "fallback-reference-cannot-establish-font-specific-shape" };
};

const canvasImageData = (canvas) => canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height);
const canvasDataUrl = (canvas) => canvas.toDataURL("image/webp", 0.9);

const renderReference = ({ value, sourceFontName, fontSize, width, height, scale }) => {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(8, Math.ceil(width * scale)); canvas.height = Math.max(8, Math.ceil(height * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height); context.fillStyle = "black";
  const requestedFont = String(sourceFontName || "").trim();
  const sourceAvailable = requestedFont && document.fonts?.check?.(`${Math.max(1, fontSize * scale)}px "${requestedFont}"`);
  const referenceFont = sourceAvailable ? requestedFont : "serif";
  const referenceFontMethod = sourceAvailable ? "source-font" : "fallback";
  const renderSize = Math.max(4, fontSize * scale);
  context.font = `${renderSize}px "${referenceFont}"`;
  context.textAlign = "center"; context.textBaseline = "middle";
  context.fillText(value, canvas.width / 2, canvas.height / 2);
  return { canvas, referenceFont, referenceFontMethod, renderSize, renderScale: scale };
};

export const getAutomaticGlyphEscalationTargets = (result) => {
  const targets = new Set(result.evidence.conflicts.filter((conflict) => conflict.type === FORENSIC_CONFLICT_TYPES.CHARACTER_IDENTITY).map((conflict) => conflict.targetId));
  const canonicalByEmbeddedId = new Map();
  result.characters.forEach((character) => character.sourceEvidenceRefs.forEach((ref) => {
    if (ref.layer === "embedded-character") canonicalByEmbeddedId.set(ref.entityId, character.id);
  }));
  const groups = new Map();
  result.evidence.embeddedCharacters.filter((entry) => !entry.isWhitespace).forEach((entry) => {
    const key = `${entry.fontName || "unknown"}:${entry.rawCharacter}`;
    const group = groups.get(key) || []; group.push(entry); groups.set(key, group);
  });
  groups.forEach((entries) => {
    if (entries.length < 5) return;
    const widths = entries.map((entry) => entry.geometry.width).sort((a, b) => a - b);
    const median = widths[Math.floor(widths.length / 2)] || 1;
    entries.forEach((entry) => {
      if (entry.geometry.width / median < 0.45 || entry.geometry.width / median > 2.2) {
        const characterId = canonicalByEmbeddedId.get(entry.id);
        if (characterId) targets.add(characterId);
      }
    });
  });
  return [...targets];
};

export const createGlyphForensicsService = ({ pdfDoc, rendererVersion = "unknown", maxPageCache = 2, maxRegionCache = 128, config = DEFAULT_GLYPH_COMPARISON_CONFIG }) => {
  const pageCache = new Map(); const regionCache = new Map();
  const cacheSet = (cache, key, value, maximum) => { cache.delete(key); cache.set(key, value); while (cache.size > maximum) { const oldest = cache.keys().next().value; const removed = cache.get(oldest); if (removed?.canvas) { removed.canvas.width = 0; removed.canvas.height = 0; } cache.delete(oldest); } };
  const pageRaster = async (pageIndex, scale) => {
    const key = `${pageIndex}:${scale}:${pdfDoc.fingerprints?.[0] || "pdf"}`;
    if (pageCache.has(key)) return pageCache.get(key);
    const page = await pdfDoc.getPage(pageIndex + 1); const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas"); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    const value = { canvas, viewport, renderer: "pdfjs", rendererVersion, scale };
    cacheSet(pageCache, key, value, maxPageCache); return value;
  };
  return {
    async analyzeCharacter(result, characterId, requestedScale = config.renderScale, candidateValue = null) {
      const character = result.characters.find((entry) => entry.id === characterId); const ref = character?.sourceRefs?.[0];
      if (!character || !ref) throw new Error("Character has no source raster anchor.");
      const scale = Math.max(1, Number(requestedScale) || config.renderScale);
      const bbox = { x: ref.x, y: ref.y, width: Math.max(ref.width, 0.5), height: Math.max(ref.height, 0.5) };
      const renderedValue = candidateValue == null ? character.value : String(candidateValue);
      const regionKey = deterministicHash([result.source.fileHash, ref.pageIndex, bbox, scale, renderedValue, GLYPH_FORENSICS_VERSION]);
      if (regionCache.has(regionKey)) return regionCache.get(regionKey);
      const raster = await pageRaster(ref.pageIndex, scale); const page = result.physical.pages.find((entry) => entry.pageIndex === ref.pageIndex);
      const padding = Math.max(2, Math.ceil(scale * 1.5));
      const left = Math.max(0, Math.floor(bbox.x * scale) - padding); const top = Math.max(0, Math.floor(bbox.y * scale) - padding);
      const right = Math.min(raster.canvas.width, Math.ceil((bbox.x + bbox.width) * scale) + padding); const bottom = Math.min(raster.canvas.height, Math.ceil((bbox.y + bbox.height) * scale) + padding);
      const sourceCanvas = document.createElement("canvas"); sourceCanvas.width = Math.max(1, right - left); sourceCanvas.height = Math.max(1, bottom - top);
      sourceCanvas.getContext("2d", { willReadFrequently: true }).drawImage(raster.canvas, left, top, sourceCanvas.width, sourceCanvas.height, 0, 0, sourceCanvas.width, sourceCanvas.height);
      const sourceCharacter = result.evidence.embeddedCharacters.find((entry) => character.sourceEvidenceRefs.some((evidenceRef) => evidenceRef.entityId === entry.id));
      const reference = renderReference({ value: renderedValue, sourceFontName: sourceCharacter?.fontName, fontSize: sourceCharacter?.fontSize || bbox.height, width: sourceCanvas.width / scale, height: sourceCanvas.height / scale, scale });
      const metrics = compareGlyphMasks(canvasImageData(sourceCanvas), canvasImageData(reference.canvas), config); const classification = classifyGlyphComparison(metrics, reference.referenceFontMethod, config);
      const rasterId = `raster_${deterministicHash([result.source.fileHash, ref.pageIndex, bbox, scale, GLYPH_FORENSICS_VERSION])}`; const referenceId = `reference_${deterministicHash([characterId, renderedValue, reference.referenceFont, scale, GLYPH_FORENSICS_VERSION])}`;
      const value = {
        rasterEvidence: { id: rasterId, targetId: characterId, pageIndex: ref.pageIndex, bbox, renderScale: scale, renderer: raster.renderer, rendererVersion: raster.rendererVersion, sourceHash: result.source.fileHash, cacheKey: regionKey, imageUrl: canvasDataUrl(sourceCanvas), method: "pdf-page-raster-crop" },
        referenceGlyph: { id: referenceId, targetId: characterId, character: renderedValue, sourceFont: sourceCharacter?.fontName || null, referenceFont: reference.referenceFont, referenceFontMethod: reference.referenceFontMethod, renderSize: reference.renderSize, renderScale: reference.renderScale, imageUrl: canvasDataUrl(reference.canvas), derivedEvidence: true },
        assessment: { id: `glyph-assessment_${deterministicHash([characterId, rasterId, referenceId, metrics])}`, targetId: characterId, candidateValue: renderedValue, sourceCandidate: renderedValue === character.value, glyphId: sourceCharacter?.glyphId || null, rasterEvidenceId: rasterId, referenceGlyphId: referenceId, status: classification.status, reason: classification.reason, comparisonMethod: metrics.method, comparisonScore: metrics.score, metrics, thresholds: { sameFontMalformed: config.sameFontMalformedThreshold, sameFontSuspected: config.sameFontSuspectedThreshold, fallbackCatastrophic: config.fallbackCatastrophicThreshold }, algorithmVersion: GLYPH_FORENSICS_VERSION },
      };
      cacheSet(regionCache, regionKey, value, maxRegionCache); return value;
    },
    clear() { pageCache.forEach((entry) => { entry.canvas.width = 0; entry.canvas.height = 0; }); pageCache.clear(); regionCache.clear(); },
    diagnostics() { return { cachedPages: pageCache.size, cachedRegions: regionCache.size }; },
  };
};

export const attachGlyphForensicEvidence = (result, analysis) => {
  const appendUnique = (list, entry) => list.some((current) => current.id === entry.id) ? list : [...list, entry];
  result.evidence.rasterEvidence = appendUnique(result.evidence.rasterEvidence, analysis.rasterEvidence);
  result.evidence.referenceGlyphs = appendUnique(result.evidence.referenceGlyphs, analysis.referenceGlyph);
  result.evidence.glyphAssessments = appendUnique(result.evidence.glyphAssessments, analysis.assessment);
  if (["suspected-malformed", "malformed"].includes(analysis.assessment.status) && !result.evidence.conflicts.some((conflict) => conflict.type === FORENSIC_CONFLICT_TYPES.GLYPH_ANOMALY && conflict.targetId === analysis.assessment.targetId)) result.evidence.conflicts.push({ id: `conflict_${deterministicHash([FORENSIC_CONFLICT_TYPES.GLYPH_ANOMALY, analysis.assessment.id])}`, type: FORENSIC_CONFLICT_TYPES.GLYPH_ANOMALY, targetId: analysis.assessment.targetId, status: "unresolved", severity: analysis.assessment.status === "malformed" ? "high" : "medium", assessmentId: analysis.assessment.id, evidenceRefs: [{ layer: "raster", entityId: analysis.rasterEvidence.id }, { layer: "reference-glyph", entityId: analysis.referenceGlyph.id }] });
  if (result.diagnostics) {
    result.diagnostics.glyphAssessments = result.evidence.glyphAssessments.length;
    result.diagnostics.glyphAnomalies = result.evidence.glyphAssessments.filter((entry) => ["suspected-malformed", "malformed"].includes(entry.status)).length;
    result.diagnostics.rasterEscalations = result.evidence.rasterEvidence.length;
    result.diagnostics.unresolvedConflicts = result.evidence.conflicts.filter((entry) => entry.status === "unresolved").length;
  }
  return result;
};
