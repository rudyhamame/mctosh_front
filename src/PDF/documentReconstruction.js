import { analyzePageLayout, itemsFromPdfJs } from "./pdfPageLayout.js";
import { analyzeParagraphLineStream, classifyParagraphUnit, PARAGRAPH_RECONSTRUCTION_VERSION, PARAGRAPH_RULES } from "./paragraphReconstruction.js";
import { buildDocumentForms, buildManualPhysicalBlocks, DOCUMENT_FORM_MODEL_VERSION, MANUAL_PHYSICAL_BLOCK_MODEL_VERSION, PHYSICAL_BLOCK_MODEL_VERSION } from "./physicalBlockReconstruction.js";
import { PHYSICAL_LINE_MODEL_VERSION, reconstructPhysicalLines } from "./physicalLineReconstruction.js";

export const DOCUMENT_RECONSTRUCTION_VERSION = "3.1.0-physical-lines-no-table-detector";

export const DEFAULT_RECONSTRUCTION_CONFIG = Object.freeze({
  algorithmVersion: DOCUMENT_RECONSTRUCTION_VERSION,
  lineMergeTolerance: 0.6,
  wordGapRatioThreshold: 0.62,
  sameWordGapRatioThreshold: 0.28,
  paragraphGapRatioThreshold: 1.65,
  detectColumns: true,
  detectHeadersFooters: true,
  detectFootnotes: true,
  normalizeLigatures: true,
  joinLineHyphenation: true,
  useDictionaryEvidence: false,
  useAbbreviationDictionary: true,
  strictDeterministicMode: true,
  linguisticScope: "canonical-source",
});

export const RECONSTRUCTION_RULES = Object.freeze({
  SOURCE_CHARACTER: "CHAR_SOURCE_EMBEDDED",
  LIGATURE: "CHAR_LIGATURE_EXPANSION",
  EXPLICIT_SPACE: "WORD_EXPLICIT_SPACE",
  FALSE_SPACE: "WORD_FALSE_EMBEDDED_SPACE",
  SMALL_GAP: "WORD_GAP_SMALL_SAME_BASELINE",
  LARGE_GAP: "WORD_VISUAL_GAP",
  TEXT_ITEM_JOIN: "WORD_JOIN_TEXT_ITEMS",
  LINE_HYPHEN_JOIN: "WORD_LINE_HYPHEN_JOIN",
  TERMINAL: "SENTENCE_TERMINAL_PUNCTUATION",
  ABBREVIATION: "SENTENCE_KNOWN_ABBREVIATION",
  DECIMAL: "SENTENCE_DECIMAL_PERIOD",
  PARAGRAPH_GAP: "PARA_LOCAL_VERTICAL_GAP",
  PARAGRAPH_CONTINUATION: "PARA_PAGE_CONTINUATION",
  ...PARAGRAPH_RULES,
  HEADING_OUTLINE: "HEADING_BOOKMARK_MATCH",
});

export const EVIDENCE_POLICIES = Object.freeze({
  "character-identity": { requiredLayers: ["pdf-object", "embedded-character"], optionalLayers: ["glyph", "raster", "ocr"], rules: [RECONSTRUCTION_RULES.SOURCE_CHARACTER] },
  "word-boundary": { requiredLayers: ["embedded-character", "geometry"], optionalLayers: ["raster", "lexical", "context"], rules: [RECONSTRUCTION_RULES.EXPLICIT_SPACE, RECONSTRUCTION_RULES.FALSE_SPACE, RECONSTRUCTION_RULES.SMALL_GAP, RECONSTRUCTION_RULES.LARGE_GAP] },
  "sentence-boundary": { requiredLayers: ["embedded-character"], optionalLayers: ["lexical", "context"], rules: [RECONSTRUCTION_RULES.DECIMAL, RECONSTRUCTION_RULES.ABBREVIATION, RECONSTRUCTION_RULES.TERMINAL] },
  "paragraph-boundary": { requiredLayers: ["geometry"], optionalLayers: ["structure"], rules: [RECONSTRUCTION_RULES.PARAGRAPH_GAP, RECONSTRUCTION_RULES.PARAGRAPH_CONTINUATION] },
  "glyph-anomaly": { requiredLayers: ["glyph", "raster"], optionalLayers: ["embedded-character"], rules: [] },
});

export const FORENSIC_CONFLICT_TYPES = Object.freeze({
  CHARACTER_IDENTITY: "CHARACTER_IDENTITY_CONFLICT",
  OCR_SUPPORT: "OCR_SUPPORT",
  OCR_CONTRADICTION: "OCR_CONTRADICTION",
  OCR_UNALIGNED: "OCR_UNALIGNED",
  GLYPH_ANOMALY: "GLYPH_ANOMALY",
  RASTER_INCONCLUSIVE: "RASTER_COMPARISON_INCONCLUSIVE",
});

const KNOWN_ABBREVIATIONS = new Set(["dr.", "mr.", "mrs.", "prof.", "fig.", "eq.", "no.", "vs.", "e.g.", "i.e.", "etc.", "al."]);
const LIGATURES = Object.freeze({ "ﬁ": "fi", "ﬂ": "fl", "ﬀ": "ff", "ﬃ": "ffi", "ﬄ": "ffl" });
const WORD_CHARACTER = /[\p{L}\p{N}\p{M}]/u;
const TERMINAL_CHARACTER = /[.!?…]/u;

const stableSerialize = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
};

export const deterministicHash = (value) => {
  const text = typeof value === "string" ? value : stableSerialize(value);
  // Four independently mixed 32-bit lanes give stable 128-bit identities.
  // The former single FNV-1a lane collided in large canonical streams (for
  // example two distinct characters both became char_44b16af0).
  let h1 = 1779033703; let h2 = 3144134277; let h3 = 1013904242; let h4 = 2773480762;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = h2 ^ Math.imul(h1 ^ code, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ code, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ code, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ code, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4; h2 ^= h1; h3 ^= h1; h4 ^= h1;
  return [h1, h2, h3, h4].map((hash) => (hash >>> 0).toString(16).padStart(8, "0")).join("");
};

const stableId = (prefix, ...parts) => `${prefix}_${deterministicHash(parts)}`;
const unique = (values) => [...new Set(values.filter((value) => value != null))];
const median = (values, fallback = 0) => { const ordered = values.filter(Number.isFinite).slice().sort((a, b) => a - b); return ordered.length ? ordered[Math.floor(ordered.length / 2)] : fallback; };
const frozen = (value) => Object.freeze(value);
const construction = (method, ruleId, createdFromIds, configHash) => ({ method, ruleId, algorithmVersion: DOCUMENT_RECONSTRUCTION_VERSION, createdFromIds: [...createdFromIds], configurationHash: configHash });
const sourceRefFor = (character) => ({
  pageIndex: character.pageIndex,
  regionId: character.regionId,
  lineId: character.lineId,
  textRunId: character.textRunId,
  textItemId: character.textItemId,
  glyphId: character.glyphId,
  charOffsetStart: character.itemCharacterOffset,
  charOffsetEnd: character.itemCharacterOffset + 1,
  x: character.geometry?.xStart,
  y: character.geometry?.yTop,
  width: character.geometry?.width,
  height: character.geometry?.height,
});

const spanForCharacters = (characters, ids) => {
  const selected = (ids || []).map((id) => characters.find((character) => character.id === id)).filter(Boolean);
  if (!selected.length) return null;
  const ordered = selected.slice().sort((left, right) => left.canonicalIndex - right.canonicalIndex);
  return { start: ordered[0].canonicalIndex, end: ordered.at(-1).canonicalIndex + 1, characterIds: ordered.map((character) => character.id) };
};

const spanForWords = (words, ids) => {
  const spans = (ids || []).map((id) => words.find((word) => word.id === id)?.canonicalSpan).filter(Boolean);
  if (!spans.length) return null;
  return { start: Math.min(...spans.map((span) => span.start)), end: Math.max(...spans.map((span) => span.end)), characterIds: [...new Set(spans.flatMap((span) => span.characterIds || []))] };
};

const canonicalSpansForIndexes = (indexes) => {
  const ordered = unique(indexes.map(Number).filter(Number.isInteger)).sort((left, right) => left - right);
  const spans = [];
  ordered.forEach((index) => {
    const previous = spans.at(-1);
    if (!previous || index > previous.end) spans.push({ start: index, end: index + 1 });
    else previous.end = Math.max(previous.end, index + 1);
  });
  return spans;
};

const attachCanonicalPhysicalLines = (physicalPages, characters, canonicalText) => {
  const indexesByLine = new Map(); const characterIdsByLine = new Map(); const characterIdsByItem = new Map();
  characters.forEach((character) => (character.sourceRefs || []).forEach((reference) => {
    if (!reference.lineId) return;
    const indexes = indexesByLine.get(reference.lineId) || []; indexes.push(character.canonicalIndex); indexesByLine.set(reference.lineId, indexes);
    const ids = characterIdsByLine.get(reference.lineId) || []; ids.push(character.id); characterIdsByLine.set(reference.lineId, ids);
    if (reference.textItemId) { const itemIds = characterIdsByItem.get(reference.textItemId) || []; itemIds.push(character.id); characterIdsByItem.set(reference.textItemId, itemIds); }
  }));
  const canonicalCharacters = Array.from(canonicalText || "");
  return physicalPages.map((page) => {
    const regions = page.regions.map((region) => ({ ...region, lines: region.lines.map((line) => {
      const canonicalSpans = canonicalSpansForIndexes(indexesByLine.get(line.id) || []);
      return { ...line, items: (line.items || []).map((item) => ({ ...item, sourceCharacterIds: unique(characterIdsByItem.get(item.sourceItemId) || []) })), canonicalSpans, canonicalText: canonicalSpans.map((span) => canonicalCharacters.slice(span.start, span.end).join("")).join(""), sourceCharacterIds: unique(characterIdsByLine.get(line.id) || []) };
    }) }));
    return { ...page, regions, physicalLines: regions.flatMap((region) => region.lines) };
  });
};

export const buildCanonicalTextArtifact = ({ source, physical, characters, transformations = [] }) => {
  const canonicalText = characters.map((character) => character.value).join("");
  const sourceText = (physical?.pages || []).flatMap((page) => page.regions || []).filter((region) => region.includeInBodyReadingOrder !== false).flatMap((region) => region.lines || []).map((line) => line.text || "").join("\n");
  const operations = transformations.map((operation) => ({
    id: operation.id,
    type: operation.type,
    input: operation.before ?? "",
    output: operation.after ?? "",
    reason: operation.ruleId || operation.type,
    evidenceIds: (operation.sourceEvidenceRefs || []).map((ref) => ref.entityId).filter(Boolean),
    confidence: operation.confidence ?? null,
    status: operation.status === "unresolved" ? "unresolved" : "accepted",
  }));
  const count = (predicate) => characters.filter(predicate).length;
  return {
    version: "canonical-text-v1",
    sourceText,
    reconstructedText: sourceText,
    text: canonicalText,
    characterCount: Array.from(canonicalText).length,
    statistics: {
      rawCharacterCandidates: count((character) => character.rawValue != null),
      canonicalCharacters: characters.length,
      explicitCharacters: count((character) => character.origin === "embedded"),
      normalizedCharacters: count((character) => character.origin === "normalized"),
      inferredCharacters: count((character) => ["inferred", "derived"].includes(character.origin)),
      unresolvedCharacters: count((character) => character.unresolved === true || character.status === "unresolved"),
      explicitSpaces: characters.filter((character) => character.value === " " && character.origin === "embedded").length,
      inferredSpaces: operations.filter((operation) => operation.type === "INSERT_WORD_BOUNDARY").length,
      removedSpaces: operations.filter((operation) => operation.type === "REMOVE_EXTRACTION_SPACE").length,
      ligatureExpansions: operations.filter((operation) => operation.type === "LIGATURE_EXPANSION").length,
      unicodeNormalizations: operations.filter((operation) => operation.type === "UNICODE_NORMALIZATION").length,
      lineBreakResolutions: operations.filter((operation) => operation.type === "LINE_HYPHEN_JOIN").length,
    },
    operations,
    provenance: { characterIds: characters.map((character) => character.id), documentId: source?.id || null },
  };
};

const normalizeCharacter = (raw, config) => {
  if (config.normalizeLigatures && LIGATURES[raw]) return { value: LIGATURES[raw], type: "LIGATURE_EXPANSION", ruleId: RECONSTRUCTION_RULES.LIGATURE };
  const normalized = raw.normalize("NFC");
  return normalized === raw ? { value: raw } : { value: normalized, type: "UNICODE_NORMALIZATION", ruleId: "CHAR_UNICODE_NFC" };
};

const classifyRegion = (block, pageHeight) => {
  const text = block.items.map((item) => item.text).join(" ").trim();
  const relativeTop = pageHeight ? block.y1 / pageHeight : 0.5;
  if (/^(figure|fig\.|table|plate)\s+/i.test(text)) return "caption";
  if (/^\s*\d+\s*$/.test(text) && (relativeTop < 0.08 || relativeTop > 0.92)) return "page-number";
  if (relativeTop < 0.06) return "header";
  if (relativeTop > 0.94) return "footer";
  return "body";
};

const buildPhysicalEvidence = (documentId, pages) => {
  const physicalPages = [];
  const sourceEvidence = [];
  const embeddedCharacters = [];
  const embeddedSourceOrderById = new Map();
  const glyphs = [];
  const geometry = [];
  const whitespace = [];
  const readingCharacters = [];
  const lineRelations = [];

  [...pages].sort((a, b) => a.pageIndex - b.pageIndex).forEach((pageInput) => {
    const pageIndex = Number(pageInput.pageIndex);
    const rawItems = Array.isArray(pageInput.items) ? pageInput.items : [];
    // Reconstruction geometry must use the same top-left viewport space as
    // the rendered PDF page. The no-viewport fallback only negates PDF Y and
    // therefore leaves every item above the page (negative Y).
    const viewportTransform = Array.isArray(pageInput.viewportTransform) && pageInput.viewportTransform.length >= 6
      ? pageInput.viewportTransform
      : null;
    const spatialItems = itemsFromPdfJs(rawItems, viewportTransform);
    const spatialByIndex = new Map(spatialItems.map((item) => [item.itemIndex, item]));
    const layout = analyzePageLayout(spatialItems);
    const pageId = stableId("page", documentId, pageIndex);
    const pageSourceItems = spatialItems.slice().sort((left, right) => left.itemIndex - right.itemIndex).map((spatial) => {
      const rawItem = rawItems[spatial.itemIndex] || {};
      const textItemId = stableId("item", documentId, pageIndex, spatial.itemIndex);
      const evidence = {
        id: textItemId, sourceItemId: textItemId, documentId, pageIndex, sourceType: "pdf-text-item", rawText: String(rawItem.str || ""), text: String(rawItem.str || ""),
        x: spatial.x1, y: spatial.y1, width: spatial.x2 - spatial.x1, height: spatial.y2 - spatial.y1, baseline: spatial.y2,
        transform: Array.isArray(rawItem.transform) ? [...rawItem.transform] : undefined,
        fontName: rawItem.fontName, fontSize: spatial.fontSize, direction: rawItem.dir || "ltr",
        hasEOL: Boolean(rawItem.hasEOL),
        orientation: Array.isArray(rawItem.transform) ? Math.atan2(rawItem.transform[1] || 0, rawItem.transform[0] || 1) * 180 / Math.PI : 0,
        sourceIndex: spatial.itemIndex, extractionMethod: "pdfjs-getTextContent", extractionVersion: "3.11.174",
        raw: frozen({ str: rawItem.str, dir: rawItem.dir, width: rawItem.width, height: rawItem.height, transform: rawItem.transform, fontName: rawItem.fontName, hasEOL: rawItem.hasEOL }),
      };
      sourceEvidence.push(frozen(evidence));
      return evidence;
    });
    const reconstructed = reconstructPhysicalLines({ documentId, pageIndex, sourceItems: pageSourceItems, makeId: stableId, requestedConfig: {} });
    lineRelations.push(...reconstructed.relations);
    const lineByItemId = new Map(reconstructed.lines.flatMap((line) => line.sourceItemIds.map((id) => [id, line])));
    const regionTypeByLine = new Map(reconstructed.lines.map((line) => [line.id, classifyRegion({ items: [{ text: line.sourceText }], y1: line.bbox.y }, Number(pageInput.height) || 0)]));
    const regionIdByLine = new Map(reconstructed.lines.map((line) => [line.id, stableId("region", documentId, pageIndex, line.resolvedLineIndex, regionTypeByLine.get(line.id))]));
    const characterIdsByLine = new Map();

    pageSourceItems.forEach((sourceItem) => {
      const spatial = spatialByIndex.get(sourceItem.sourceIndex); const rawItem = rawItems[sourceItem.sourceIndex] || {};
      const line = lineByItemId.get(sourceItem.id); if (!spatial || !line) return;
      const lineId = line.id; const regionId = regionIdByLine.get(line.id);
      const textRunId = stableId("run", documentId, pageIndex, sourceItem.sourceIndex);
      const rawCharacters = Array.from(String(rawItem.str || ""));
      const estimatedWidth = (spatial.x2 - spatial.x1) / Math.max(1, rawCharacters.length);
      rawCharacters.forEach((rawCharacter, characterOffset) => {
        const embeddedId = stableId("embedded", sourceItem.id, characterOffset, rawCharacter.codePointAt(0));
        const glyphId = stableId("glyph", embeddedId); const xStart = spatial.x1 + characterOffset * estimatedWidth;
        const characterGeometry = frozen({ id: stableId("geometry", embeddedId), characterEvidenceId: embeddedId, pageIndex, xStart, xEnd: xStart + estimatedWidth, yTop: spatial.y1, yBottom: spatial.y2, baseline: spatial.y2, width: estimatedWidth, height: spatial.y2 - spatial.y1, rotation: sourceItem.orientation, geometryMethod: "text-item-derived" });
        geometry.push(characterGeometry);
        glyphs.push(frozen({ id: glyphId, documentId, pageIndex, textItemId: sourceItem.id, characterEvidenceId: embeddedId, fontName: rawItem.fontName, fontSize: spatial.fontSize, x: xStart, y: spatial.y1, width: estimatedWidth, height: spatial.y2 - spatial.y1, transform: rawItem.transform, renderStatus: "unknown", geometryMethod: "text-item-derived" }));
        const embedded = frozen({ id: embeddedId, documentId, textItemId: sourceItem.id, textRunId, lineId, regionId, glyphId, pageIndex, itemCharacterOffset: characterOffset, rawCharacter, codePoint: rawCharacter.codePointAt(0), isWhitespace: /\s/u.test(rawCharacter), sourceOrderIndex: embeddedCharacters.length, readingOrderIndex: readingCharacters.length, geometry: characterGeometry, fontName: rawItem.fontName, fontSize: spatial.fontSize });
        embeddedCharacters.push(embedded); readingCharacters.push(embedded);
        embeddedSourceOrderById.set(embeddedId, embedded.sourceOrderIndex);
        const ids = characterIdsByLine.get(lineId) || []; ids.push(embeddedId); characterIdsByLine.set(lineId, ids);
      });
    });

    const regions = reconstructed.lines.map((line) => {
      const regionType = regionTypeByLine.get(line.id);
      const regionId = regionIdByLine.get(line.id);
      const sourceItemIds = line.sourceItemIds;
      const itemFontSizes = line.items.map((item) => item.fontSize);
      const sourceCharacterIds = characterIdsByLine.get(line.id) || [];
      const sourceCharacterIndexes = sourceCharacterIds.map((id) => embeddedSourceOrderById.get(id)).filter(Number.isInteger);
      const physicalLine = frozen({ ...line, regionId, sourceCharacterIds, sourceCharacterRange: sourceCharacterIndexes.length ? { start: Math.min(...sourceCharacterIndexes), endExclusive: Math.max(...sourceCharacterIndexes) + 1 } : null, sourceRefs: sourceItemIds, text: line.sourceText, fontName: line.items[0]?.fontName || "unknown", fontSize: median(itemFontSizes, line.dominantLineHeight), columnId: "source-flow", isFullWidth: false });
      return frozen({ id: regionId, documentId, pageIndex, regionType, text: line.sourceText, includeInBodyReadingOrder: true, status: regionType === "body" ? "inferred" : "ambiguous", x: line.bbox.x, y: line.bbox.y, width: line.bbox.width, height: line.bbox.height, lineIds: [line.id], readingOrderIndex: line.resolvedLineIndex, lines: [physicalLine] });
    });
    physicalPages.push(frozen({ id: pageId, documentId, pageIndex, width: pageInput.width, height: pageInput.height, regions, physicalLines: regions.flatMap((region) => region.lines), lineRelations: reconstructed.relations, columnCount: layout.columnCount, gutters: [...layout.gutters] }));
  });

  for (let index = 0; index < readingCharacters.length - 1; index += 1) {
    const left = readingCharacters[index];
    const right = readingCharacters[index + 1];
    if (left.isWhitespace || right.isWhitespace || left.lineId !== right.lineId || left.textItemId !== right.textItemId || left.pageIndex !== right.pageIndex) {
      const visualGap = right.pageIndex === left.pageIndex ? right.geometry.xStart - left.geometry.xEnd : undefined;
      const localWidth = Math.max(0.01, (left.geometry.width + right.geometry.width) / 2);
      whitespace.push(frozen({
        id: stableId("space", left.id, right.id), pageIndex: left.pageIndex,
        sourceType: left.isWhitespace || right.isWhitespace ? "explicit-space-character" : left.pageIndex !== right.pageIndex ? "page-break" : left.lineId !== right.lineId ? "line-break" : "text-item-boundary",
        beforeCharacterId: left.id, afterCharacterId: right.id, visualGap,
        normalizedVisualGap: Number.isFinite(visualGap) ? visualGap / localWidth : undefined,
      }));
    }
  }

  // A top/bottom position alone is not enough to call content a header or
  // footer. Confirm those regions only when normalized text recurs across the
  // document at a similar edge; page numbers remain independently typed.
  const edgeOccurrences = new Map();
  physicalPages.forEach((page) => page.regions.forEach((region) => {
    if (!["header", "footer"].includes(region.regionType)) return;
    const normalized = region.text.normalize("NFKC").replace(/\d+/g, "#").replace(/\s+/g, " ").trim().toLocaleLowerCase();
    if (!normalized) return;
    const key = `${region.regionType}:${normalized}`;
    const pagesForText = edgeOccurrences.get(key) || new Set();
    pagesForText.add(page.pageIndex);
    edgeOccurrences.set(key, pagesForText);
  }));
  const recurrenceMinimum = Math.max(2, Math.ceil(physicalPages.length * 0.2));
  const excludedRegionIds = new Set();
  const classifiedPages = physicalPages.map((page) => frozen({
    ...page,
    regions: page.regions.map((region) => {
      let regionType = region.regionType;
      if (["header", "footer"].includes(regionType)) {
        const normalized = region.text.normalize("NFKC").replace(/\d+/g, "#").replace(/\s+/g, " ").trim().toLocaleLowerCase();
        if ((edgeOccurrences.get(`${regionType}:${normalized}`)?.size || 0) < recurrenceMinimum) regionType = "body";
      }
      const includeInBodyReadingOrder = !["header", "footer", "page-number", "table"].includes(regionType);
      if (!includeInBodyReadingOrder) excludedRegionIds.add(region.id);
      return frozen({ ...region, regionType, includeInBodyReadingOrder, status: regionType === "body" ? "inferred" : "document-frequency-inferred" });
    }),
  }));
  const bodyReadingCharacters = readingCharacters.filter((character) => !excludedRegionIds.has(character.regionId));

  return { physicalPages: classifiedPages, sourceEvidence, embeddedCharacters, glyphs, geometry, whitespace, lineRelations, readingCharacters: bodyReadingCharacters };
};

const buildCanonicalCharacters = (documentId, embeddedCharacters, config, configHash) => {
  const characters = [];
  const transformations = [];
  const alignments = [];
  embeddedCharacters.forEach((sourceCharacter) => {
    const normalized = normalizeCharacter(sourceCharacter.rawCharacter, config);
    const values = Array.from(normalized.value);
    const canonicalIds = [];
    values.forEach((value, expansionOffset) => {
      const id = stableId("char", sourceCharacter.id, expansionOffset, value);
      canonicalIds.push(id);
      characters.push({
        id, documentId, value, rawValue: sourceCharacter.rawCharacter,
        normalizedValue: normalized.value, canonicalIndex: characters.length,
        previousCharacterId: null, nextCharacterId: null, parentWordId: null,
        origin: normalized.type ? "normalized" : "embedded",
        sourceRefs: [sourceRefFor(sourceCharacter)], sourceEvidenceRefs: [{ layer: "embedded-character", entityId: sourceCharacter.id, relation: "derived-from" }],
        transformationIds: [], status: normalized.type ? "inferred" : "asserted",
        qualityState: normalized.type ? "NORMALIZED_ONLY" : "SOURCE_EXACT",
        construction: construction("canonical-character-stream", normalized.ruleId || RECONSTRUCTION_RULES.SOURCE_CHARACTER, [sourceCharacter.id], configHash),
      });
    });
    if (normalized.type) {
      const transformationId = stableId("transform", sourceCharacter.id, normalized.type, normalized.value);
      transformations.push({
        id: transformationId, documentId, targetEntityId: canonicalIds[0], type: normalized.type,
        before: sourceCharacter.rawCharacter, after: normalized.value,
        sourceEvidenceRefs: [{ layer: "embedded-character", entityId: sourceCharacter.id, relation: "derived-from" }],
        ruleId: normalized.ruleId, algorithmVersion: DOCUMENT_RECONSTRUCTION_VERSION, status: "inferred",
      });
      canonicalIds.forEach((id) => characters.find((character) => character.id === id).transformationIds.push(transformationId));
    }
    alignments.push({
      id: stableId("alignment", sourceCharacter.id, canonicalIds), sourceCharacterIds: [sourceCharacter.id], canonicalCharacterIds: canonicalIds,
      relation: canonicalIds.length > 1 ? "expansion" : normalized.type ? "normalization" : "identity",
      transformationId: transformations.at(-1)?.targetEntityId === canonicalIds[0] ? transformations.at(-1).id : undefined,
    });
  });
  characters.forEach((character, index) => {
    character.previousCharacterId = characters[index - 1]?.id;
    character.nextCharacterId = characters[index + 1]?.id;
  });
  return { characters, transformations, alignments };
};

const buildWords = (documentId, characters, embeddedById, config, configHash) => {
  const tokens = [];
  const tokenBoundaryRecords = [];
  let current = [];
  let pendingWhitespace = [];
  let internalWhitespace = [];
  const sourceCharacterFor = (character) => embeddedById.get(character.sourceEvidenceRefs.find((ref) => ref.layer === "embedded-character")?.entityId);
  const flush = (decision = null) => {
    if (current.length) tokens.push({ characters: current, internalWhitespace, trailingDecision: decision });
    current = [];
    internalWhitespace = [];
  };
  const evaluateBoundary = (left, right) => {
    const leftSource = sourceCharacterFor(left);
    const rightSource = sourceCharacterFor(right);
    if (!leftSource || !rightSource) return { decision: "unresolved", ruleId: "WORD_MISSING_PHYSICAL_EVIDENCE", status: "unresolved", evidence: [] };
    const samePage = leftSource.pageIndex === rightSource.pageIndex;
    const sameLine = samePage && leftSource.lineId === rightSource.lineId;
    const sameTextItem = sameLine && leftSource.textItemId === rightSource.textItemId;
    const visualGap = samePage ? rightSource.geometry.xStart - leftSource.geometry.xEnd : undefined;
    const medianWidth = Math.max(0.01, (leftSource.geometry.width + rightSource.geometry.width) / 2);
    const normalizedGap = Number.isFinite(visualGap) ? visualGap / medianWidth : undefined;
    const evidence = [{ type: "character-pair", samePage, sameLine, sameTextItem, explicitSourceSpace: pendingWhitespace.length > 0, explicitWhitespaceCharacterIds: pendingWhitespace.map((entry) => entry.id), visualGap, normalizedGap, sameBaseline: sameLine, sameFont: leftSource.fontName === rightSource.fontName, sameFontSize: leftSource.fontSize === rightSource.fontSize }];
    if (pendingWhitespace.length) {
      if (sameLine && normalizedGap <= config.sameWordGapRatioThreshold) return { decision: "same", ruleId: RECONSTRUCTION_RULES.FALSE_SPACE, status: "inferred", evidence };
      return { decision: "boundary", ruleId: RECONSTRUCTION_RULES.EXPLICIT_SPACE, status: "asserted", evidence };
    }
    if (sameTextItem && rightSource.itemCharacterOffset === leftSource.itemCharacterOffset + 1) return { decision: "same", ruleId: "WORD_CONTIGUOUS_SOURCE_CHARACTERS", status: "asserted", evidence };
    if (sameLine && normalizedGap <= config.sameWordGapRatioThreshold) return { decision: "same", ruleId: RECONSTRUCTION_RULES.SMALL_GAP, status: "inferred", evidence };
    if (sameLine && normalizedGap >= config.wordGapRatioThreshold) return { decision: "boundary", ruleId: RECONSTRUCTION_RULES.LARGE_GAP, status: "inferred", evidence };
    if (!sameLine && config.joinLineHyphenation && /[-‐‑]$/u.test(left.value)) return { decision: "same", ruleId: RECONSTRUCTION_RULES.LINE_HYPHEN_JOIN, status: "inferred", evidence };
    if (!sameLine) return { decision: "boundary", ruleId: samePage ? "WORD_LINE_BREAK" : "WORD_PAGE_BREAK", status: "inferred", evidence };
    return { decision: "unresolved", ruleId: "WORD_GAP_AMBIGUOUS", status: "unresolved", evidence };
  };

  characters.forEach((character) => {
    if (/\s/u.test(character.value)) { pendingWhitespace.push(character); return; }
    const isWordCharacter = WORD_CHARACTER.test(character.value) || /['’\-‐‑]/u.test(character.value);
    if (!isWordCharacter) {
      flush();
      tokens.push({ characters: [character], trailingDecision: null });
      pendingWhitespace = [];
      return;
    }
    if (current.length) {
      const decision = evaluateBoundary(current.at(-1), character);
      tokenBoundaryRecords.push({ leftCharacterId: current.at(-1).id, rightCharacterId: character.id, ...decision });
      if (decision.decision !== "same") flush(decision);
      else if (pendingWhitespace.length) internalWhitespace.push(...pendingWhitespace);
    } else if (tokens.length && pendingWhitespace.length) {
      tokens.at(-1).trailingDecision ||= { decision: "boundary", ruleId: RECONSTRUCTION_RULES.EXPLICIT_SPACE, status: "asserted", evidence: [] };
    }
    current.push(character);
    pendingWhitespace = [];
  });
  flush();

  const transformations = [];
  const words = tokens.map(({ characters: token, internalWhitespace: removedWhitespace = [], trailingDecision }, index) => {
    const sourceRefs = token.flatMap((character) => character.sourceRefs);
    const pageIndexes = unique(sourceRefs.map((ref) => ref.pageIndex));
    const normalizedText = token.map((character) => character.value).join("");
    const hyphenJoined = token.some((character, characterIndex) => /[-‐‑]/u.test(character.value) && characterIndex < token.length - 1 && sourceCharacterFor(character)?.lineId !== sourceCharacterFor(token[characterIndex + 1])?.lineId);
    const resolvedText = hyphenJoined ? normalizedText.replace(/[-‐‑](?=\p{L})/gu, "") : normalizedText;
    const sourceCharacterIds = unique(token.map((character) => character.sourceEvidenceRefs.find((ref) => ref.layer === "embedded-character")?.entityId));
    const removedWhitespaceSourceIds = unique(removedWhitespace.map((character) => character.sourceEvidenceRefs.find((ref) => ref.layer === "embedded-character")?.entityId));
    const rawText = [...sourceCharacterIds, ...removedWhitespaceSourceIds]
      .map((id) => embeddedById.get(id))
      .filter(Boolean)
      .sort((left, right) => left.sourceOrderIndex - right.sourceOrderIndex)
      .map((entry) => entry.rawCharacter)
      .join("");
    const inheritedTransformationIds = unique(token.flatMap((character) => character.transformationIds || []));
    const id = stableId("word", documentId, token.map((character) => character.id));
    token.forEach((character) => { character.parentWordId = id; });
    if (hyphenJoined) transformations.push({
      id: stableId("transform", id, "LINE_HYPHEN_JOIN"), documentId, targetEntityId: id,
      type: "LINE_HYPHEN_JOIN", before: normalizedText, after: resolvedText,
      sourceEvidenceRefs: token.flatMap((character) => character.sourceEvidenceRefs),
      ruleId: RECONSTRUCTION_RULES.LINE_HYPHEN_JOIN, algorithmVersion: DOCUMENT_RECONSTRUCTION_VERSION, status: "inferred",
    });
    if (removedWhitespaceSourceIds.length) {
      const transformation = {
        id: stableId("transform", id, "REMOVE_EXTRACTION_SPACE", removedWhitespaceSourceIds), documentId, targetEntityId: id,
        type: "REMOVE_EXTRACTION_SPACE", before: rawText, after: resolvedText,
        sourceEvidenceRefs: removedWhitespaceSourceIds.map((entityId) => ({ layer: "embedded-character", entityId, relation: "removed-boundary-evidence" })),
        ruleId: RECONSTRUCTION_RULES.FALSE_SPACE, algorithmVersion: DOCUMENT_RECONSTRUCTION_VERSION, status: "inferred",
      };
      transformations.push(transformation);
      inheritedTransformationIds.push(transformation.id);
    }
    return {
      id, documentId, displayIndex: index + 1, rawText, normalizedText, resolvedText,
      characterIds: token.map((character) => character.id), canonicalSpan: { start: token[0].canonicalIndex, end: token.at(-1).canonicalIndex + 1, characterIds: token.map((character) => character.id) }, parentSentenceId: null, sourceRefs,
      transformationIds: unique(inheritedTransformationIds), morphemeIds: [], morphologyStatus: "not-analyzed",
      spansPages: pageIndexes.length > 1, pageIndexes, tokenClass: /^\p{N}+(?:[.,]\p{N}+)?$/u.test(resolvedText) ? "number" : /^\p{L}/u.test(resolvedText) ? "lexical-word" : "symbol",
      status: trailingDecision?.status === "unresolved" ? "unresolved" : token.some((character) => character.status !== "asserted") || hyphenJoined ? "inferred" : "asserted",
      qualityState: hyphenJoined || removedWhitespaceSourceIds.length ? "DETERMINISTICALLY_RECONSTRUCTED" : token.some((character) => character.qualityState !== "SOURCE_EXACT") ? "NORMALIZED_ONLY" : "SOURCE_EXACT",
      construction: construction("word-boundary-engine", trailingDecision?.ruleId || "WORD_CONTIGUOUS_SOURCE_CHARACTERS", token.map((character) => character.id), configHash),
    };
  });
  const boundaries = words.slice(0, -1).map((word, index) => {
    const decision = tokens[index]?.trailingDecision || { decision: "boundary", ruleId: "WORD_PUNCTUATION_BOUNDARY", status: "asserted", evidence: [] };
    return ({
    id: stableId("boundary", "word", word.id, words[index + 1].id), boundaryType: "word",
    afterEntityId: word.id, beforeEntityId: words[index + 1].id, ...decision,
  }); });
  return { words, boundaries, transformations, characterBoundaryEvidence: tokenBoundaryRecords };
};

const applyForcedWordSplits = (documentId, wordResult, characters, decisions, configHash) => {
  if (!Array.isArray(decisions) || !decisions.length) return wordResult;
  const decisionBySurface = new Map(decisions.map((decision) => [String(decision.surface || "").normalize("NFKC").toLocaleLowerCase(), decision]));
  const characterById = new Map(characters.map((character) => [character.id, character]));
  const expanded = [];
  const insertedTransformations = [];
  wordResult.words.forEach((word) => {
    const decision = decisionBySurface.get(word.resolvedText.normalize("NFKC").toLocaleLowerCase());
    const segmentation = Array.isArray(decision?.segmentation) ? decision.segmentation.map(String).filter(Boolean) : [];
    if (segmentation.length < 2 || segmentation.join("").normalize("NFKC").toLocaleLowerCase() !== word.resolvedText.normalize("NFKC").toLocaleLowerCase()) {
      expanded.push({ ...word, _originWordId: word.id });
      return;
    }
    let characterCursor = 0;
    const splitWords = segmentation.map((surface, segmentIndex) => {
      const characterCount = Array.from(surface).length;
      const characterIds = word.characterIds.slice(characterCursor, characterCursor + characterCount);
      characterCursor += characterCount;
      const segmentCharacters = characterIds.map((id) => characterById.get(id)).filter(Boolean);
      const id = stableId("word", documentId, characterIds);
      segmentCharacters.forEach((character) => { character.parentWordId = id; });
      const sourceRefs = segmentCharacters.flatMap((character) => character.sourceRefs || []);
      const pageIndexes = unique(sourceRefs.map((ref) => ref.pageIndex));
      return {
        ...word, id, displayIndex: 0, rawText: segmentCharacters.map((character) => character.rawValue).join(""), normalizedText: surface,
        resolvedText: surface, characterIds, parentSentenceId: null, sourceRefs, pageIndexes, spansPages: pageIndexes.length > 1,
        transformationIds: [], morphemeIds: [], morphologyStatus: "not-analyzed", qualityState: "DETERMINISTICALLY_RECONSTRUCTED",
        construction: construction("word-boundary-engine", decision.ruleId || "WORD_MISSING_SPACE_MULTI_EVIDENCE", characterIds, configHash),
        lexicalEvidence: decision.evidence?.segments?.[segmentIndex] || null, _originWordId: word.id, _splitIndex: segmentIndex,
      };
    });
    const transformation = {
      id: stableId("transform", word.id, "INSERT_WORD_BOUNDARY", segmentation), documentId, targetEntityId: splitWords[0].id,
      affectedEntityIds: splitWords.map((entry) => entry.id), type: "INSERT_WORD_BOUNDARY", before: word.resolvedText, after: segmentation.join(" "),
      sourceEvidenceRefs: word.sourceRefs.map((ref) => ({ layer: "geometry", entityId: ref.textItemId, relation: "boundary-discontinuity" })),
      evidence: decision.evidence || {}, ruleId: decision.ruleId || "WORD_MISSING_SPACE_MULTI_EVIDENCE", algorithmVersion: DOCUMENT_RECONSTRUCTION_VERSION, status: "inferred",
    };
    insertedTransformations.push(transformation);
    splitWords.forEach((entry) => entry.transformationIds.push(transformation.id));
    expanded.push(...splitWords);
  });
  expanded.forEach((word, index) => { word.displayIndex = index + 1; });
  const oldBoundaryByPair = new Map(wordResult.boundaries.map((boundary) => [`${boundary.afterEntityId}:${boundary.beforeEntityId}`, boundary]));
  const boundaries = expanded.slice(0, -1).map((word, index) => {
    const next = expanded[index + 1];
    if (word._originWordId === next._originWordId && word._splitIndex != null) return { id: stableId("boundary", "word", word.id, next.id), boundaryType: "word", afterEntityId: word.id, beforeEntityId: next.id, decision: "boundary", ruleId: "WORD_MISSING_SPACE_MULTI_EVIDENCE", status: "inferred", evidence: decisions.find((decision) => String(decision.surface || "").toLocaleLowerCase() === `${word.resolvedText}${next.resolvedText}`.toLocaleLowerCase())?.evidence ? [decisions.find((decision) => String(decision.surface || "").toLocaleLowerCase() === `${word.resolvedText}${next.resolvedText}`.toLocaleLowerCase()).evidence] : [] };
    const previous = oldBoundaryByPair.get(`${word._originWordId}:${next._originWordId}`);
    return { ...(previous || { decision: "boundary", ruleId: "WORD_SOURCE_TOKEN_BOUNDARY", status: "inferred", evidence: [] }), id: stableId("boundary", "word", word.id, next.id), afterEntityId: word.id, beforeEntityId: next.id, boundaryType: "word" };
  });
  expanded.forEach((word) => { delete word._originWordId; delete word._splitIndex; });
  return { ...wordResult, words: expanded, boundaries, transformations: [...wordResult.transformations, ...insertedTransformations] };
};

const sentenceBoundary = (words, index) => {
  const word = words[index];
  const next = words[index + 1];
  const text = word?.resolvedText || "";
  if (!TERMINAL_CHARACTER.test(text.at(-1) || "")) return { decision: "same", ruleId: "SENTENCE_NO_TERMINAL", status: "asserted" };
  const previousText = words[index - 1]?.resolvedText || "";
  if (text === "." && /^\d+$/u.test(previousText) && /^\d+$/u.test(next?.resolvedText || "")) return { decision: "same", ruleId: RECONSTRUCTION_RULES.DECIMAL, status: "asserted" };
  if (KNOWN_ABBREVIATIONS.has(text.toLocaleLowerCase()) || (text === "." && KNOWN_ABBREVIATIONS.has(`${previousText}.`.toLocaleLowerCase()))) return { decision: "same", ruleId: RECONSTRUCTION_RULES.ABBREVIATION, status: "asserted" };
  return { decision: "boundary", ruleId: RECONSTRUCTION_RULES.TERMINAL, status: "inferred" };
};

const buildSentences = (documentId, words, configHash) => {
  const sentences = [];
  const boundaries = [];
  let current = [];
  words.forEach((word, index) => {
    current.push(word);
    const result = sentenceBoundary(words, index);
    if (index < words.length - 1) boundaries.push({ id: stableId("boundary", "sentence", word.id, words[index + 1].id), boundaryType: "sentence", afterEntityId: word.id, beforeEntityId: words[index + 1].id, ...result, evidence: [] });
    if (result.decision === "boundary" || index === words.length - 1) {
      const id = stableId("sent", documentId, current.map((entry) => entry.id));
      current.forEach((entry) => { entry.parentSentenceId = id; });
      const sourceRefs = current.flatMap((entry) => entry.sourceRefs);
      const pageIndexes = unique(sourceRefs.map((ref) => ref.pageIndex));
      const lineIds = unique(sourceRefs.map((ref) => ref.lineId).filter(Boolean));
      const text = current.map((entry) => entry.resolvedText).join(" ").replace(/\s+([,.;:!?])/gu, "$1").replace(/(\d)\.\s+(?=\d)/gu, "$1.");
      sentences.push({
        id, documentId, displayIndex: sentences.length + 1, wordIds: current.map((entry) => entry.id),
        canonicalSpan: spanForWords(words, current.map((entry) => entry.id)),
        rawText: current.map((entry) => entry.rawText).join(" "), normalizedText: text, resolvedText: text, canonicalText: text,
        parentParagraphId: null, sourceRefs, lineIds, pageIndexes, spansPages: pageIndexes.length > 1,
        status: current.some((entry) => entry.status !== "asserted") ? "inferred" : "asserted",
        construction: construction("sentence-boundary-engine", result.ruleId, current.map((entry) => entry.id), configHash),
      });
      current = [];
    }
  });
  return { sentences, boundaries };
};

const buildParagraphs = (documentId, sentences, words, physicalPages, config, configHash, canonicalTextValue = "") => {
  const lines = physicalPages.flatMap((page) => page.regions.filter((region) => region.includeInBodyReadingOrder).sort((left, right) => left.readingOrderIndex - right.readingOrderIndex).flatMap((region) => region.lines.map((line) => ({ ...line, regionType: region.regionType, regionId: region.id, pageWidth: page.width, pageHeight: page.height }))));
  const lineById = new Map(lines.map((line) => [line.id, line]));
  const sentenceLineIds = new Map(); const sentenceContinuationPairs = new Set();
  sentences.forEach((sentence) => {
    const lineIds = unique(sentence.sourceRefs.map((ref) => ref.lineId)).filter((lineId) => lineById.has(lineId)); sentenceLineIds.set(sentence.id, lineIds);
    lineIds.slice(1).forEach((lineId, index) => sentenceContinuationPairs.add(`${lineIds[index]}:${lineId}`));
  });
  const analysis = analyzeParagraphLineStream({ documentId, lines, makeId: stableId, sentenceContinuationPairs, config: config.paragraph || {} });
  const spanByLineId = new Map(analysis.spans.flatMap((span) => span.lineIds.map((lineId) => [lineId, span])));
  const wordById = new Map(words.map((word) => [word.id, word])); const conflicts = []; const reconciledSentences = [];
  sentences.forEach((sentence) => {
    const groups = [];
    sentence.wordIds.forEach((wordId) => {
      const word = wordById.get(wordId); const lineId = word?.sourceRefs?.[0]?.lineId; const spanId = spanByLineId.get(lineId)?.id || analysis.spans[0]?.id;
      let group = groups.at(-1); if (!group || group.spanId !== spanId) { group = { spanId, words: [] }; groups.push(group); } group.words.push(word);
    });
    if (groups.length <= 1) { reconciledSentences.push(sentence); return; }
    const replacements = groups.filter((group) => group.words.length).map((group) => {
      const sourceRefs = group.words.flatMap((word) => word.sourceRefs); const pageIndexes = unique(sourceRefs.map((ref) => ref.pageIndex)); const resolvedText = group.words.map((word) => word.resolvedText).join(" ").replace(/\s+([,.;:!?])/gu, "$1");
      const id = stableId("sent", documentId, "paragraph-reconciliation", group.spanId, group.words.map((word) => word.id)); group.words.forEach((word) => { word.parentSentenceId = id; });
      const replacement = { ...sentence, id, displayIndex: 0, wordIds: group.words.map((word) => word.id), rawText: group.words.map((word) => word.rawText).join(" "), normalizedText: resolvedText, resolvedText, canonicalText: resolvedText, parentParagraphId: null, sourceRefs, lineIds: unique(sourceRefs.map((ref) => ref.lineId).filter(Boolean)), pageIndexes, spansPages: pageIndexes.length > 1, status: "inferred", construction: construction("sentence-paragraph-reconciliation", "PARAGRAPH_STRONG_LAYOUT_SENTENCE_REEVALUATION", group.words.map((word) => word.id), configHash) };
      sentenceLineIds.set(id, unique(sourceRefs.map((ref) => ref.lineId)).filter((lineId) => lineById.has(lineId))); return replacement;
    });
    replacements.forEach((replacement) => reconciledSentences.push(replacement));
    const crossedDecisionIds = analysis.decisions.filter((decision) => decision.decision === "new-paragraph" && (sentenceLineIds.get(sentence.id) || []).includes(decision.previousLineId) && (sentenceLineIds.get(sentence.id) || []).includes(decision.nextLineId)).map((decision) => decision.id);
    conflicts.push({ id: stableId("conflict", "sentence-paragraph", sentence.id, replacements.map((entry) => entry.id)), type: "SENTENCE_PARAGRAPH_BOUNDARY_CONFLICT", targetId: replacements[0]?.id || sentence.id, originalSentenceId: sentence.id, replacementSentenceIds: replacements.map((entry) => entry.id), boundaryDecisionIds: crossedDecisionIds, paragraphSpanIds: groups.map((group) => group.spanId), lineIds: sentenceLineIds.get(sentence.id) || [], status: "reconciled", severity: "high", reconciliation: "split-sentence-at-strong-physical-paragraph-boundary", ruleId: "PARAGRAPH_STRONG_LAYOUT_SENTENCE_REEVALUATION", algorithmVersion: PARAGRAPH_RECONSTRUCTION_VERSION, evidenceRefs: crossedDecisionIds.map((id) => ({ layer: "paragraph-boundary", entityId: id })) });
  });
  reconciledSentences.forEach((sentence, index) => { sentence.displayIndex = index + 1; }); sentences.splice(0, sentences.length, ...reconciledSentences);
  const sentencesBySpanId = new Map();
  sentences.forEach((sentence) => {
    const lineIds = sentenceLineIds.get(sentence.id) || []; const spans = unique(lineIds.map((lineId) => spanByLineId.get(lineId)?.id));
    const spanId = spans[0] || analysis.spans[0]?.id; if (!spanId) return;
    const entries = sentencesBySpanId.get(spanId) || []; entries.push(sentence); sentencesBySpanId.set(spanId, entries);
    if (spans.length > 1) conflicts.push({ id: stableId("conflict", "sentence-paragraph", sentence.id, spans), type: "SENTENCE_PARAGRAPH_BOUNDARY_CONFLICT", targetId: sentence.id, sentenceId: sentence.id, paragraphSpanIds: spans, lineIds, status: "unresolved", severity: "high", ruleId: "PARAGRAPH_SENTENCE_RECONCILIATION", algorithmVersion: PARAGRAPH_RECONSTRUCTION_VERSION, evidenceRefs: spans.map((id) => ({ layer: "paragraph-span", entityId: id })) });
  });
  const paragraphs = [];
  analysis.spans.forEach((span) => {
    const assigned = sentencesBySpanId.get(span.id) || []; if (!assigned.length) return;
    const id = stableId("para", documentId, span.lineIds); assigned.forEach((sentence) => { sentence.parentParagraphId = id; });
    const sourceRefs = assigned.flatMap((sentence) => sentence.sourceRefs); const pageIndexes = unique(span.lines.map((line) => line.pageIndex));
    const startDecision = analysis.decisions.find((entry) => entry.id === span.startBoundaryDecisionId); const endDecision = analysis.decisions.find((entry) => entry.id === span.endBoundaryDecisionId);
    const canonicalSpan = spanForWords(sentences, assigned.map((sentence) => sentence.id));
    const sourceBlockIds = unique(span.lines.map((line) => line.regionId).filter(Boolean));
    const classification = classifyParagraphUnit(span.lines[0] || {});
    paragraphs.push({
      id, documentId, displayIndex: paragraphs.length + 1, sentenceIds: assigned.map((sentence) => sentence.id), lineIds: span.lineIds,
      canonicalSpan, canonicalSpans: canonicalSpan ? [canonicalSpan] : [], canonicalText: assigned.map((sentence) => sentence.canonicalText || sentence.resolvedText || "").join(" "),
      candidateType: "paragraph-candidate", classification, layoutBlockIds: sourceBlockIds, sourceBlockIds,
      boundaryDecisionIds: [span.startBoundaryDecisionId, span.endBoundaryDecisionId].filter(Boolean), startBoundaryDecisionId: span.startBoundaryDecisionId, endBoundaryDecisionId: span.endBoundaryDecisionId,
      startReason: startDecision?.ruleId || "DOCUMENT_OR_REGION_START", endReason: endDecision?.ruleId || "DOCUMENT_OR_REGION_END", styleProfileId: span.styleProfileId,
      parentDivisionId: null, rawText: assigned.map((sentence) => sentence.rawText).join(" "), normalizedText: assigned.map((sentence) => sentence.normalizedText).join(" "), resolvedText: assigned.map((sentence) => sentence.resolvedText).join(" "),
      sourceRefs, pageIndexes, regionIds: unique(span.lines.map((line) => line.regionId)), spansPages: pageIndexes.length > 1, crossPage: pageIndexes.length > 1,
      status: [startDecision, endDecision].some((entry) => entry?.status === "unresolved") ? "unresolved" : "inferred", unresolved: [startDecision, endDecision].some((entry) => entry?.status === "unresolved"),
      construction: construction("physical-line-paragraph-engine", endDecision?.ruleId || startDecision?.ruleId || PARAGRAPH_RULES.SAME_LINE_STYLE_CONTINUATION, span.lineIds, configHash),
    });
  });
  return { paragraphs, boundaries: analysis.decisions, paragraphBoundaryDecisions: analysis.decisions, paragraphStyleProfiles: analysis.profiles, layoutBlocks: analysis.layoutBlocks || [], paragraphCandidates: analysis.spans || [], conflicts, profileState: analysis.profileState };
};

const spanOverlap = (left, right) => Math.max(0, Math.min(left?.end || 0, right?.end || 0) - Math.max(left?.start || 0, right?.start || 0));

const scopeWordsAndSentencesToPhysicalBlocks = ({ documentId, words, physicalBlocks, configHash }) => {
  const claimedWordIds = new Set();
  const scopedWords = [];
  const sentences = [];
  const boundaries = [];
  [...physicalBlocks].sort((left, right) => left.displayIndex - right.displayIndex || left.id.localeCompare(right.id)).forEach((block) => {
    const blockWords = words.filter((word) => !claimedWordIds.has(word.id) && (block.canonicalSpans || []).some((span) => spanOverlap(word.canonicalSpan, span) > 0));
    if (!blockWords.length) return;
    blockWords.forEach((word) => {
      claimedWordIds.add(word.id);
      word.scopePhysicalBlockId = block.id;
      word.physicalBlockIds = [block.id];
      scopedWords.push(word);
    });
    const blockSentences = buildSentences(documentId, blockWords, configHash);
    blockSentences.sentences.forEach((sentence) => {
      sentence.scopePhysicalBlockId = block.id;
      sentence.physicalBlockIds = [block.id];
    });
    sentences.push(...blockSentences.sentences);
    boundaries.push(...blockSentences.boundaries);
  });
  sentences.forEach((sentence, index) => { sentence.displayIndex = index + 1; });
  scopedWords.forEach((word, index) => { word.displayIndex = index + 1; });
  return { words: scopedWords, sentences, boundaries };
};

const buildExplicitDocumentStructure = ({ documentId, forms, physicalBlocks, sentenceCandidates, wordCandidates, canonicalText, configHash }) => {
  const blockById = new Map(physicalBlocks.map((block) => [block.id, block]));
  const assignmentBySentence = new Map();
  sentenceCandidates.forEach((sentence) => {
    const ranked = forms.map((form) => ({ form, overlap: (form.canonicalSpans || []).reduce((sum, span) => sum + spanOverlap(sentence.canonicalSpan, span), 0) }))
      .filter((entry) => entry.overlap > 0)
      .sort((left, right) => right.overlap - left.overlap || left.form.id.localeCompare(right.form.id));
    if (ranked[0]) assignmentBySentence.set(sentence.id, ranked[0].form);
  });
  // Sentential Meaning is reconstructed from the canonical source stream,
  // independent of manual document forms. Forms may annotate sentences, but
  // they never gate whether a sentence/word exists.
  const sentences = sentenceCandidates;
  const words = wordCandidates;
  const paragraphs = [];
  forms.forEach((form) => {
    const assigned = sentences.filter((sentence) => assignmentBySentence.get(sentence.id)?.id === form.id);
    form.sentenceIds = assigned.map((sentence) => sentence.id);
    assigned.forEach((sentence) => {
      sentence.parentDocumentFormId = form.id;
      sentence.parentParagraphId = form.type === "PARAGRAPH" ? form.id : null;
    });
    if (form.type !== "PARAGRAPH") return;
    const blocks = form.physicalBlockIds.map((id) => blockById.get(id)).filter(Boolean);
    const sourceRefs = assigned.flatMap((sentence) => sentence.sourceRefs || []);
    const canonicalSpan = form.canonicalSpans.length ? {
      start: Math.min(...form.canonicalSpans.map((span) => span.start)),
      end: Math.max(...form.canonicalSpans.map((span) => span.end)),
      characterIds: [],
    } : null;
    paragraphs.push({
      ...form,
      documentId,
      displayIndex: paragraphs.length + 1,
      sentenceIds: form.sentenceIds,
      lineIds: unique(blocks.flatMap((block) => block.lineIds)),
      canonicalSpan,
      canonicalText: form.canonicalText,
      candidateType: "document-form",
      classification: "paragraph",
      layoutBlockIds: form.physicalBlockIds,
      sourceBlockIds: form.physicalBlockIds,
      boundaryDecisionIds: [],
      parentDivisionId: null,
      rawText: form.canonicalText,
      normalizedText: form.canonicalText,
      resolvedText: form.canonicalText,
      sourceRefs,
      pageIndexes: form.pageIndexes,
      regionIds: unique(blocks.flatMap((block) => block.lineIds)),
      spansPages: form.pageIndexes.length > 1,
      crossPage: form.pageIndexes.length > 1,
      status: "asserted",
      unresolved: false,
      construction: construction("manual-document-form-assignment", "DOCUMENT_FORM_PARAGRAPH", form.physicalBlockIds, configHash),
    });
  });
  sentences.forEach((sentence, index) => { sentence.displayIndex = index + 1; });
  words.forEach((word, index) => { word.displayIndex = index + 1; });
  return { forms, paragraphs, sentences, words };
};

const outlineRole = (title, level) => {
  const value = String(title || "").trim();
  if (/^book\b/i.test(value)) return "book";
  if (/^volume\b/i.test(value)) return "volume";
  if (/^part\b/i.test(value)) return "part";
  if (/^unit\b/i.test(value)) return "unit";
  if (/^chapter\b/i.test(value)) return "chapter";
  if (/^appendix\b/i.test(value)) return "appendix";
  return level >= 3 ? "subsection" : "section";
};

const buildDivisions = (documentId, outlines, paragraphs, configHash, documentForms = []) => {
  const sorted = [...(outlines || [])].sort((a, b) => Number(a.startPage) - Number(b.startPage) || Number(a.level || 1) - Number(b.level || 1));
  const divisions = [];
  const stack = [];
  sorted.forEach((outline, index) => {
    const level = Math.max(1, Number(outline.level) || 1);
    while (stack.length && stack.at(-1).level >= level) stack.pop();
    const parent = stack.at(-1);
    const id = stableId("div", documentId, outline.id || index, outline.title, outline.startPage, level);
    const division = { id, documentId, role: outlineRole(outline.title, level), level, title: String(outline.title || `Division ${index + 1}`), ordinal: outline.ordinal, headingSourceRefs: [], parentDivisionId: parent?.id, childDivisionIds: [], paragraphIds: [], documentFormIds: [], startPage: Number(outline.startPage) || 1, endPage: Number(outline.endPage) || Number.MAX_SAFE_INTEGER, status: "asserted", construction: construction("outline-division-engine", RECONSTRUCTION_RULES.HEADING_OUTLINE, [], configHash) };
    if (parent) parent.childDivisionIds.push(id);
    divisions.push(division);
    stack.push(division);
  });
  paragraphs.forEach((paragraph) => {
    const firstPage = paragraph.pageIndexes[0] ?? 0;
    const parent = divisions.filter((division) => firstPage + 1 >= division.startPage && firstPage + 1 <= division.endPage).sort((a, b) => b.level - a.level)[0];
    if (parent) { parent.paragraphIds.push(paragraph.id); paragraph.parentDivisionId = parent.id; }
  });
  documentForms.forEach((form) => {
    const firstPage = form.pageIndexes[0] ?? 0;
    const parent = divisions.filter((division) => firstPage + 1 >= division.startPage && firstPage + 1 <= division.endPage).sort((a, b) => b.level - a.level)[0];
    if (parent) { parent.documentFormIds.push(form.id); form.parentDivisionId = parent.id; }
  });
  return divisions;
};

const buildLinguisticStructure = (documentId, sentences, words, language = "und", configHash, lexicalAnalyses = []) => {
  const clauses = [];
  const phrases = [];
  const lexemeByKey = new Map();
  const lexemes = [];
  const lexicalAnalysisByWord = new Map(lexicalAnalyses.map((analysis) => [analysis.wordId, analysis]));
  const clauseJoiners = new Set(["because", "although", "though", "while", "when", "if", "unless", "and", "but", "or"]);
  sentences.forEach((sentence) => {
    const sentenceWords = sentence.wordIds.map((id) => words.find((word) => word.id === id)).filter(Boolean);
    const groups = [];
    let current = [];
    sentenceWords.forEach((word) => {
      if (current.length && clauseJoiners.has(String(word.resolvedText || "").toLocaleLowerCase())) {
        groups.push(current);
        current = [];
      }
      current.push(word);
    });
    if (current.length) groups.push(current);
    (groups.length ? groups : [sentenceWords]).forEach((group, index) => {
      const clauseId = stableId("clause", documentId, sentence.id, index, group.map((word) => word.id));
      const clauseType = groups.length > 1 && index > 0 ? "dependent" : "unknown";
      const clause = {
        id: clauseId, documentId, type: "clause", displayIndex: clauses.length + 1, sentenceId: sentence.id, clauseType,
        wordIds: group.map((word) => word.id), phraseIds: [], text: group.map((word) => word.resolvedText).join(" "), canonicalText: group.map((word) => word.resolvedText).join(" "),
        canonicalSpan: spanForWords(words, group.map((word) => word.id)), confidence: null,
        pageIndexes: unique(group.flatMap((word) => word.pageIndexes || [])),
        unresolved: clauseType === "unknown", status: clauseType === "unknown" ? "unresolved" : "inferred",
        construction: construction("conservative-clause-segmentation", "CLAUSE_CONJUNCTION_BOUNDARY", group.map((word) => word.id), configHash),
      };
      clauses.push(clause);
      const phraseId = stableId("phrase", clauseId, "unknown", group.map((word) => word.id));
      const phrase = {
        id: phraseId, documentId, type: "phrase", displayIndex: phrases.length + 1, phraseType: "unknown", clauseId, wordIds: group.map((word) => word.id),
        text: clause.text, canonicalText: clause.text, canonicalSpan: clause.canonicalSpan, headWordId: null, confidence: null,
        pageIndexes: clause.pageIndexes,
        unresolved: true, status: "unresolved", construction: construction("conservative-phrase-placeholder", "PHRASE_PARSER_UNAVAILABLE", group.map((word) => word.id), configHash),
      };
      phrases.push(phrase);
      clause.phraseIds.push(phraseId);
      group.forEach((word) => {
        word.parentClauseId = clauseId;
        word.parentPhraseId = phraseId;
        if (word.tokenClass !== "lexical-word") return;
        const lexicalAnalysis = lexicalAnalysisByWord.get(word.id);
        const lemma = String(lexicalAnalysis?.lemma || lexicalAnalysis?.lexeme || "").trim();
        const normalizedKey = (lemma || word.resolvedText).normalize("NFKC").toLocaleLowerCase();
        const key = `${language}:${normalizedKey}`;
        let lexeme = lexemeByKey.get(key);
        if (!lexeme) {
          lexeme = { id: stableId("lexeme", documentId, key), type: "lexeme", documentId, lemma: normalizedKey, normalizedKey, language, partOfSpeech: lexicalAnalysis?.partOfSpeech || null, lexicalEvidence: lexicalAnalysis ? [lexicalAnalysis] : [], confidence: lexicalAnalysis?.confidence ?? null, unresolved: !lemma, status: lemma ? "asserted" : "unresolved", wordFormIds: [] };
          lexemeByKey.set(key, lexeme); lexemes.push(lexeme);
        }
        word.lexemeId = lexeme.id;
        word.lexicalRelation = { type: "REALIZES", lexemeId: lexeme.id };
        lexeme.wordFormIds.push(word.id);
      });
    });
  });
  return { clauses, phrases, lexemes };
};

const buildMorphemes = (words, analyses = [], characters = []) => {
  const byWordId = new Map(analyses.map((analysis) => [analysis.wordId, analysis]));
  const morphemes = [];
  words.forEach((word) => {
    const analysis = byWordId.get(word.id);
    if (!analysis || analysis.status !== "analyzed" || !Array.isArray(analysis.morphemes)) return;
    word.morphologyStatus = "analyzed";
    analysis.morphemes.forEach((morpheme, index) => {
      const id = stableId("morph", word.id, morpheme.start, morpheme.end, morpheme.surface, index);
      word.morphemeIds.push(id);
      const characterIds = word.characterIds.slice(Number(morpheme.start) || 0, Number(morpheme.end) || 0);
      morphemes.push({ id, wordId: word.id, type: "morpheme", surface: String(morpheme.surface || ""), typeLabel: morpheme.type || "unknown", characterIds, canonicalSpan: spanForCharacters(characters, characterIds), analysisMethod: analysis.provider || "morphology-provider", status: "asserted" });
    });
  });
  return morphemes;
};

export const validateDocumentReconstruction = (result) => {
  const errors = [];
  const ids = new Set();
  const nonParagraphForms = (result.documentForms || []).filter((form) => form.type !== "PARAGRAPH");
  const collections = [result.characters, result.words, result.sentences, result.clauses || [], result.phrases || [], result.paragraphs, nonParagraphForms, result.divisions, result.morphemes, result.lexemes || [], result.physical?.blocks || []];
  collections.flat().forEach((entity) => {
    if (!entity?.id) errors.push("Entity without stable ID");
    else if (ids.has(entity.id)) errors.push(`Duplicate entity ID: ${entity.id}`);
    else ids.add(entity.id);
  });
  const sourceIds = new Set(result.evidence.embeddedCharacters.map((entity) => entity.id));
  const canonicalIndexes = new Set();
  result.characters.forEach((character) => {
    if (canonicalIndexes.has(character.canonicalIndex)) errors.push(`Duplicate canonical index: ${character.canonicalIndex}`);
    canonicalIndexes.add(character.canonicalIndex);
    if (!character.sourceEvidenceRefs.length && !["derived", "manual"].includes(character.origin)) errors.push(`Orphan canonical character: ${character.id}`);
    character.sourceEvidenceRefs.forEach((ref) => { if (ref.layer === "embedded-character" && !sourceIds.has(ref.entityId)) errors.push(`Missing source character: ${ref.entityId}`); });
    if (character.rawValue !== character.value && !character.transformationIds.length) errors.push(`Invisible transformation: ${character.id}`);
  });
  const characterIds = new Set(result.characters.map((entity) => entity.id));
  const canonicalLength = result.characters.length;
  const validateSpan = (entity, label) => {
    const span = entity.canonicalSpan;
    if (!span || !Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start < 0 || span.end <= span.start || span.end > canonicalLength) errors.push(`${label} ${entity.id} has an invalid canonical span`);
    else if (Array.isArray(span.characterIds) && span.characterIds.some((id) => !characterIds.has(id))) errors.push(`${label} ${entity.id} has a missing canonical character reference`);
  };
  result.words.forEach((word) => validateSpan(word, "Word"));
  result.words.forEach((word) => {
    word.characterIds.forEach((id) => { if (!characterIds.has(id)) errors.push(`Word ${word.id} has missing character ${id}`); });
    if (word.rawText !== word.resolvedText && !result.transformations.some((transformation) => transformation.targetEntityId === word.id) && !word.transformationIds?.length) errors.push(`Invisible transformation: ${word.id}`);
    if (word.morphologyStatus === "not-analyzed" && result.morphemes.some((morpheme) => morpheme.wordId === word.id)) errors.push(`Unanalyzed word has asserted morphemes: ${word.id}`);
  });
  result.transformations.forEach((transformation) => {
    if (transformation.type === "INSERT_WORD_BOUNDARY" && !transformation.evidence) errors.push(`Lexically driven transformation lacks evidence: ${transformation.id}`);
    if (/UMLS/i.test(transformation.ruleId || "") && !transformation.evidence?.umls && !transformation.evidence?.phrase?.umls) errors.push(`UMLS-driven transformation lacks an evidence snapshot: ${transformation.id}`);
  });
  const wordIds = new Set(result.words.map((entity) => entity.id));
  result.sentences.forEach((sentence) => sentence.wordIds.forEach((id) => { if (!wordIds.has(id)) errors.push(`Sentence ${sentence.id} has missing word ${id}`); }));
  const sentenceIds = new Set(result.sentences.map((entity) => entity.id));
  result.sentences.forEach((sentence) => validateSpan(sentence, "Sentence"));
  const clauseIds = new Set((result.clauses || []).map((clause) => clause.id));
  const phraseIds = new Set((result.phrases || []).map((phrase) => phrase.id));
  (result.clauses || []).forEach((clause) => {
    validateSpan(clause, "Clause");
    if (!sentenceIds.has(clause.sentenceId)) errors.push(`Clause ${clause.id} has missing sentence ${clause.sentenceId}`);
    const sentence = result.sentences.find((entry) => entry.id === clause.sentenceId);
    if (sentence?.canonicalSpan && (clause.canonicalSpan.start < sentence.canonicalSpan.start || clause.canonicalSpan.end > sentence.canonicalSpan.end)) errors.push(`Clause ${clause.id} lies outside its sentence span`);
    (clause.phraseIds || []).forEach((id) => { if (!phraseIds.has(id)) errors.push(`Clause ${clause.id} has missing phrase ${id}`); });
  });
  (result.phrases || []).forEach((phrase) => {
    validateSpan(phrase, "Phrase");
    if (!clauseIds.has(phrase.clauseId)) errors.push(`Phrase ${phrase.id} has missing clause ${phrase.clauseId}`);
    const clause = (result.clauses || []).find((entry) => entry.id === phrase.clauseId);
    if (clause?.canonicalSpan && (phrase.canonicalSpan.start < clause.canonicalSpan.start || phrase.canonicalSpan.end > clause.canonicalSpan.end)) errors.push(`Phrase ${phrase.id} lies outside its clause span`);
  });
  result.words.forEach((word) => {
    if (word.parentPhraseId && !phraseIds.has(word.parentPhraseId)) errors.push(`Word ${word.id} has missing phrase ${word.parentPhraseId}`);
    if (word.tokenClass === "lexical-word" && (word.lexicalRelation?.type !== "REALIZES" || !(result.lexemes || []).some((lexeme) => lexeme.id === word.lexicalRelation.lexemeId))) errors.push(`Word ${word.id} has an invalid lexeme relation`);
  });
  (result.morphemes || []).forEach((morpheme) => {
    const word = result.words.find((entry) => entry.id === morpheme.wordId);
    if (!word) errors.push(`Morpheme ${morpheme.id} has missing word ${morpheme.wordId}`);
    if (morpheme.canonicalSpan && word?.canonicalSpan && (morpheme.canonicalSpan.start < word.canonicalSpan.start || morpheme.canonicalSpan.end > word.canonicalSpan.end)) errors.push(`Morpheme ${morpheme.id} lies outside its word span`);
  });
  const physicalLineIds = new Set(result.physical.pages.flatMap((page) => page.regions.flatMap((region) => region.lines.map((line) => line.id))));
  const physicalBlockIds = new Set((result.physical?.blocks || []).map((block) => block.id));
  const blockLineCounts = new Map();
  (result.physical?.blocks || []).forEach((block) => {
    if (!block.lineIds.length) errors.push(`PhysicalBlock ${block.id} has no lines`);
    block.lineIds.forEach((id) => {
      if (!physicalLineIds.has(id)) errors.push(`PhysicalBlock ${block.id} has missing physical line ${id}`);
      blockLineCounts.set(id, (blockLineCounts.get(id) || 0) + 1);
    });
    if (block.pageIndexes.length !== 1) errors.push(`PhysicalBlock ${block.id} crosses a page boundary`);
    if (block.canonicalText !== (block.canonicalSpans || []).map((span) => Array.from(result.canonicalText.text).slice(span.start, span.end).join("")).join("")) errors.push(`PhysicalBlock ${block.id} text does not derive from CanonicalText`);
  });
  (result.physical?.lines || []).forEach((line) => {
    if (!line.sourceItemIds?.length) errors.push(`PhysicalLine ${line.id} has no source-item provenance`);
    if (!Number.isInteger(line.sourceStartIndex) || !Number.isInteger(line.sourceEndIndex) || line.sourceEndIndex <= line.sourceStartIndex) errors.push(`PhysicalLine ${line.id} has an invalid source range`);
  });
  (result.physical?.blocks || []).forEach((block) => {
    if (block.createdBy !== "user" && block.source !== "manual") errors.push(`PhysicalBlock ${block.id} is not an explicit user-created group`);
  });
  const tableCharacterIds = new Set(result.characters.map((character) => character.id));
  (result.physical?.tables || []).forEach((table) => {
    if (table.rowCount !== table.rows.length) errors.push(`Table ${table.id} row count does not match its rows`);
    table.rows.forEach((row) => {
      if (row.cells.length !== table.columnCount) errors.push(`Table row ${row.id} does not preserve ${table.columnCount} columns`);
      row.cells.forEach((cell) => {
        if ((cell.sourceCharacterIds || []).some((id) => !tableCharacterIds.has(id))) errors.push(`Table cell ${cell.id} has a missing canonical character reference`);
        if (!cell.sourceItemIds?.length && cell.status !== "empty") errors.push(`Resolved table cell ${cell.id} has no source item provenance`);
      });
    });
  });
  (result.documentForms || []).forEach((form) => {
    (form.physicalBlockIds || []).forEach((id) => { if (!physicalBlockIds.has(id)) errors.push(`DocumentForm ${form.id} has missing PhysicalBlock ${id}`); });
    if (!(form.physicalBlockIds || []).length && !(form.bboxes || []).length) errors.push(`DocumentForm ${form.id} has no physical reference`);
  });
  result.paragraphs.forEach((paragraph) => {
    validateSpan(paragraph, "Paragraph");
    paragraph.sentenceIds.forEach((id) => { if (!sentenceIds.has(id)) errors.push(`Paragraph ${paragraph.id} has missing sentence ${id}`); });
    (paragraph.lineIds || []).forEach((id) => { if (!physicalLineIds.has(id)) errors.push(`Paragraph ${paragraph.id} has missing physical line ${id}`); });
    (paragraph.layoutBlockIds || paragraph.sourceBlockIds || []).forEach((id) => { if (!physicalBlockIds.has(id)) errors.push(`Paragraph ${paragraph.id} has missing PhysicalBlock ${id}`); });
    if (paragraph.canonicalSpan && paragraph.canonicalText != null) {
      const spans = paragraph.canonicalSpans?.length ? paragraph.canonicalSpans : [paragraph.canonicalSpan];
      const derived = spans.map((span) => Array.from(result.canonicalText.text).slice(span.start, span.end).join("")).join("");
      if (derived !== paragraph.canonicalText) errors.push(`Paragraph ${paragraph.id} text does not match its canonical spans`);
    }
  });
  if (!result.canonicalText || result.canonicalText.version !== "canonical-text-v1") errors.push("CanonicalText artifact is missing or has an unsupported version");
  return { valid: errors.length === 0, errors };
};

const diagnosticMedian = (values) => { const sorted = values.slice().sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)] || 0; };
const buildDiagnostics = (result) => {
  const blockFrequency = result.paragraphs.flatMap((paragraph) => paragraph.layoutBlockIds || paragraph.sourceBlockIds || []).reduce((counts, id) => ({ ...counts, [id]: (counts[id] || 0) + 1 }), {});
  const splitPhysicalBlocks = Object.values(blockFrequency).filter((count) => count > 1).length;
  return ({
  totalPages: result.physical.pages.length,
  physicalBlockModelVersion: result.physical?.manualBlockModelVersion || "manual-only",
  physicalLineModelVersion: result.physical?.modelVersion || PHYSICAL_LINE_MODEL_VERSION,
  totalPhysicalLines: result.physical?.lines?.length || 0,
  totalPhysicalBlocks: result.physical?.blocks?.length || 0,
  totalTables: result.physical?.tables?.length || 0,
  totalTableRows: (result.physical?.tables || []).reduce((sum, table) => sum + table.rowCount, 0),
  totalTableCells: (result.physical?.tables || []).reduce((sum, table) => sum + table.rows.reduce((rowSum, row) => rowSum + row.cells.length, 0), 0),
  ambiguousTableCandidates: (result.physical?.tableCandidates || []).filter((candidate) => candidate.status === "ambiguous").length,
  totalDocumentForms: result.documentForms?.length || 0,
  unassignedPhysicalBlocks: (result.physical?.blocks || []).filter((block) => !(block.documentFormIds || []).length).length,
  totalPhysicalTextRuns: result.evidence.sourceEvidence.length,
  totalCharacters: result.characters.length,
  totalWords: result.words.length,
  totalSentences: result.sentences.length,
  totalClauses: (result.clauses || []).length,
  totalPhrases: (result.phrases || []).length,
  totalParagraphs: result.paragraphs.length,
  totalMorphemes: (result.morphemes || []).length,
  uniqueLexemes: (result.lexemes || []).length,
  wordLexemeRelations: result.words.filter((word) => word.lexicalRelation?.type === "REALIZES").length,
  unresolvedClauses: (result.clauses || []).filter((clause) => clause.unresolved).length,
  unresolvedPhrases: (result.phrases || []).filter((phrase) => phrase.unresolved).length,
  unresolvedLexemes: (result.lexemes || []).filter((lexeme) => lexeme.unresolved).length,
  linguisticModelVersion: result.linguisticModelVersion || "legacy",
  totalStructuralDivisions: result.divisions.length,
  ambiguousBoundaries: result.boundaries.filter((boundary) => boundary.status === "ambiguous").length,
  unresolvedBoundaries: result.boundaries.filter((boundary) => boundary.status === "unresolved").length,
  crossPageSentences: result.sentences.filter((sentence) => sentence.spansPages).length,
  meanLinesPerParagraph: result.paragraphs.length ? result.paragraphs.reduce((sum, paragraph) => sum + (paragraph.lineIds?.length || 0), 0) / result.paragraphs.length : 0,
  medianLinesPerParagraph: diagnosticMedian(result.paragraphs.map((paragraph) => paragraph.lineIds?.length || 0)),
  layoutBlocks: result.paragraphReconstruction?.layoutBlockCount ?? result.paragraphs.reduce((sum, paragraph) => sum + (paragraph.layoutBlockIds?.length || 0), 0),
  paragraphCandidates: result.paragraphReconstruction?.paragraphCandidateCount ?? result.paragraphs.length,
  logicalParagraphs: result.paragraphs.length,
  oneLineParagraphCandidates: result.paragraphs.filter((paragraph) => paragraph.lineIds?.length === 1).length,
  oneLineParagraphs: result.paragraphs.filter((paragraph) => paragraph.lineIds?.length === 1).length,
  oneWordParagraphCandidates: result.paragraphs.filter((paragraph) => (paragraph.resolvedText || "").trim().split(/\s+/u).filter(Boolean).length === 1).length,
  finalOneLineLogicalParagraphs: result.paragraphs.filter((paragraph) => paragraph.lineIds?.length === 1 && paragraph.classification === "paragraph").length,
  reclassifiedHeadings: result.paragraphs.filter((paragraph) => paragraph.classification === "heading").length,
  reclassifiedListItems: result.paragraphs.filter((paragraph) => paragraph.classification === "list-item").length,
  crossPageParagraphs: result.paragraphs.filter((paragraph) => paragraph.spansPages).length,
  unresolvedParagraphBoundaries: result.paragraphBoundaryDecisions.filter((entry) => entry.status === "unresolved").length,
  lowConfidenceParagraphBoundaries: result.paragraphBoundaryDecisions.filter((entry) => ["WEAK", "SUPPORTING"].includes(entry.confidence)).length,
  mergedPhysicalBlocks: result.paragraphs.filter((paragraph) => (paragraph.layoutBlockIds?.length || 0) > 1).length,
  splitPhysicalBlocks,
  overSegmentationRepairs: result.paragraphs.filter((paragraph) => (paragraph.layoutBlockIds?.length || 0) > 1).length,
  underSegmentationRepairs: 0,
  paragraphRulesUsed: result.paragraphBoundaryDecisions.reduce((counts, decision) => ({ ...counts, [decision.ruleId]: (counts[decision.ruleId] || 0) + 1 }), {}),
  paragraphOversegmentationSuspected: result.paragraphs.length >= 5 && result.paragraphs.filter((paragraph) => paragraph.lineIds?.length === 1).length / result.paragraphs.length >= 0.8,
  paragraphUndersegmentationSuspected: result.paragraphs.some((paragraph) => (paragraph.lineIds?.length || 0) >= 300),
  transformations: result.transformations.length,
  falseSpacesDetected: result.transformations.filter((entry) => entry.type === "REMOVE_EXTRACTION_SPACE").length,
  falseSpacesResolved: result.transformations.filter((entry) => entry.type === "REMOVE_EXTRACTION_SPACE" && entry.status !== "unresolved").length,
  missingSpacesDetected: result.transformations.filter((entry) => entry.type === "INSERT_WORD_BOUNDARY").length,
  missingSpacesResolved: result.transformations.filter((entry) => entry.type === "INSERT_WORD_BOUNDARY" && entry.status !== "unresolved").length,
  characterIdentityConflicts: result.evidence.conflicts.filter((entry) => entry.type === FORENSIC_CONFLICT_TYPES.CHARACTER_IDENTITY).length,
  ocrSupport: (result.evidence.ocrAlignments || []).filter((entry) => entry.status === FORENSIC_CONFLICT_TYPES.OCR_SUPPORT).length,
  ocrContradictions: (result.evidence.ocrAlignments || []).filter((entry) => entry.status === FORENSIC_CONFLICT_TYPES.OCR_CONTRADICTION).length,
  ocrUnaligned: (result.evidence.ocrAlignments || []).filter((entry) => entry.status === FORENSIC_CONFLICT_TYPES.OCR_UNALIGNED).length,
  glyphAnomalies: (result.evidence.glyphAssessments || []).filter((entry) => ["suspected-malformed", "malformed"].includes(entry.status)).length,
  rasterEscalations: (result.evidence.rasterEvidence || []).length,
  reconstructionStatusDistribution: result.characters.reduce((counts, character) => ({ ...counts, [character.qualityState]: (counts[character.qualityState] || 0) + 1 }), {}),
  });
};

const buildDocumentStatistics = (result) => {
  const lexical = new Map();
  result.words.filter((word) => word.tokenClass === "lexical-word").forEach((word) => {
    const normalizedForm = word.resolvedText.normalize("NFKC").toLocaleLowerCase();
    const current = lexical.get(normalizedForm) || { normalizedForm, count: 0, pages: new Set(), sentenceIds: new Set() };
    current.count += 1;
    word.pageIndexes.forEach((page) => current.pages.add(page));
    if (word.parentSentenceId) current.sentenceIds.add(word.parentSentenceId);
    lexical.set(normalizedForm, current);
  });
  const fonts = new Map();
  result.evidence.sourceEvidence.forEach((item) => {
    const key = `${item.fontName || "unknown"}|${Number(item.fontSize || 0).toFixed(2)}`;
    const current = fonts.get(key) || { fontName: item.fontName || "unknown", fontSize: Number(item.fontSize) || 0, count: 0, pages: new Set() };
    current.count += 1;
    current.pages.add(item.pageIndex);
    fonts.set(key, current);
  });
  const lineGaps = [];
  const repeatedEdgeText = new Map();
  result.physical.pages.forEach((page) => {
    const lines = page.regions.flatMap((region) => region.lines).sort((left, right) => left.yTop - right.yTop);
    lines.slice(1).forEach((line, index) => lineGaps.push(Math.max(0, line.yTop - lines[index].yBottom)));
    page.regions.filter((region) => ["header", "footer", "page-number"].includes(region.regionType)).forEach((region) => {
      const key = `${region.regionType}:${region.text.normalize("NFKC").replace(/\d+/g, "#").replace(/\s+/g, " ").trim().toLocaleLowerCase()}`;
      const current = repeatedEdgeText.get(key) || { regionType: region.regionType, normalizedText: key.slice(key.indexOf(":") + 1), count: 0, pages: [] };
      current.count += 1; current.pages.push(page.pageIndex); repeatedEdgeText.set(key, current);
    });
  });
  const sortedLineGaps = lineGaps.sort((a, b) => a - b);
  return {
    treeOutcomes: { physicalLines: result.physical?.lines?.length || 0, manualPhysicalBlocks: result.physical?.blocks?.length || 0, physicalBlocks: result.physical?.blocks?.length || 0, tables: result.physical?.tables?.length || 0, tableRows: (result.physical?.tables || []).reduce((sum, table) => sum + table.rowCount, 0), tableCells: (result.physical?.tables || []).reduce((sum, table) => sum + table.rows.reduce((rowSum, row) => rowSum + row.cells.length, 0), 0), documentForms: result.documentForms?.length || 0, divisions: result.divisions.length, paragraphs: result.paragraphs.length, sentences: result.sentences.length, clauses: (result.clauses || []).length, phrases: (result.phrases || []).length, words: result.words.length, morphemes: (result.morphemes || []).length, uniqueLexemes: (result.lexemes || []).length, wordLexemeRelations: result.words.filter((word) => word.lexicalRelation?.type === "REALIZES").length },
    paragraphReconstruction: { version: result.paragraphReconstruction?.version || PARAGRAPH_RECONSTRUCTION_VERSION, layoutBlocks: result.diagnostics?.layoutBlocks || 0, paragraphCandidates: result.diagnostics?.paragraphCandidates || result.paragraphs.length, logicalParagraphs: result.paragraphs.length, mergedPhysicalBlocks: result.diagnostics?.mergedPhysicalBlocks || 0, splitPhysicalBlocks: result.diagnostics?.splitPhysicalBlocks || 0, overSegmentationRepairs: result.diagnostics?.overSegmentationRepairs || 0, underSegmentationRepairs: result.diagnostics?.underSegmentationRepairs || 0, oneLineCandidates: result.diagnostics?.oneLineParagraphCandidates || 0, finalOneLineParagraphs: result.diagnostics?.finalOneLineLogicalParagraphs || 0, oneWordCandidates: result.diagnostics?.oneWordParagraphCandidates || 0, reclassifiedHeadings: result.diagnostics?.reclassifiedHeadings || 0, reclassifiedListItems: result.diagnostics?.reclassifiedListItems || 0, crossPageParagraphs: result.diagnostics?.crossPageParagraphs || 0, unresolvedBoundaries: result.diagnostics?.unresolvedParagraphBoundaries || 0 },
    lexical: [...lexical.values()].map((entry) => ({ ...entry, pages: [...entry.pages].sort((a, b) => a - b), sentenceIds: [...entry.sentenceIds] })).sort((a, b) => b.count - a.count || a.normalizedForm.localeCompare(b.normalizedForm)),
    fonts: [...fonts.values()].map((entry) => ({ ...entry, pages: [...entry.pages].sort((a, b) => a - b) })).sort((a, b) => b.count - a.count),
    lineGaps: { count: sortedLineGaps.length, median: sortedLineGaps[Math.floor(sortedLineGaps.length / 2)] || 0, p90: sortedLineGaps[Math.floor(sortedLineGaps.length * 0.9)] || 0 },
    repeatedEdgeText: [...repeatedEdgeText.values()].sort((left, right) => right.count - left.count || left.normalizedText.localeCompare(right.normalizedText)),
  };
};

const associateOcrEvidence = (result) => {
  const charactersByPage = new Map();
  result.characters.forEach((character) => character.sourceRefs.forEach((ref) => {
    const entries = charactersByPage.get(ref.pageIndex) || [];
    entries.push({ character, ref });
    charactersByPage.set(ref.pageIndex, entries);
  }));
  const wordByCharacter = new Map(result.characters.map((character) => [character.id, character.parentWordId]));
  const alignSequences = (source, observed) => {
    const left = Array.from(source); const right = Array.from(observed);
    const matrix = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));
    for (let row = 0; row <= left.length; row += 1) matrix[row][0] = row;
    for (let column = 0; column <= right.length; column += 1) matrix[0][column] = column;
    for (let row = 1; row <= left.length; row += 1) for (let column = 1; column <= right.length; column += 1) matrix[row][column] = Math.min(matrix[row - 1][column] + 1, matrix[row][column - 1] + 1, matrix[row - 1][column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1));
    const operations = [];
    let row = left.length; let column = right.length;
    while (row || column) {
      if (row && column && matrix[row][column] === matrix[row - 1][column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1)) {
        operations.unshift({ type: left[row - 1] === right[column - 1] ? "match" : "substitution", sourceIndex: row - 1, observedIndex: column - 1, sourceValue: left[row - 1], observedValue: right[column - 1] }); row -= 1; column -= 1;
      } else if (row && matrix[row][column] === matrix[row - 1][column] + 1) {
        operations.unshift({ type: "deletion", sourceIndex: row - 1, observedIndex: null, sourceValue: left[row - 1], observedValue: "" }); row -= 1;
      } else {
        operations.unshift({ type: "insertion", sourceIndex: null, observedIndex: column - 1, sourceValue: "", observedValue: right[column - 1] }); column -= 1;
      }
    }
    return { distance: matrix[left.length][right.length], operations };
  };
  const ocrAlignments = [];
  const characterConflicts = [];
  result.evidence.ocrObservations = result.evidence.ocrObservations.map((observation) => {
    const page = result.physical.pages.find((entry) => entry.pageIndex === observation.pageIndex);
    const bbox = observation.bbox;
    if (!page || !bbox || !observation.pageWidth || !observation.pageHeight) {
      ocrAlignments.push({ id: stableId("ocr-align", observation.id), observationId: observation.id, status: FORENSIC_CONFLICT_TYPES.OCR_UNALIGNED, canonicalText: "", observedText: observation.text || "", operations: [], evidenceRefs: [{ layer: "ocr", entityId: observation.id }] });
      return { ...observation, canonical: false, characterIds: [], wordIds: [] };
    }
    const scaleX = page.width / observation.pageWidth;
    const scaleY = page.height / observation.pageHeight;
    // OCR page boxes and the physical tree both use top-left page coordinates.
    // Scaling is sufficient; subtracting page height moves every OCR box off
    // the page and silently prevents spatial alignment.
    const normalizedBBox = { x: Number(bbox.x) * scaleX, y: Number(bbox.y) * scaleY, width: Number(bbox.width) * scaleX, height: Number(bbox.height) * scaleY };
    const characterIds = (charactersByPage.get(observation.pageIndex) || []).filter(({ ref }) => ref.x <= normalizedBBox.x + normalizedBBox.width && ref.x + ref.width >= normalizedBBox.x && ref.y <= normalizedBBox.y + normalizedBBox.height && ref.y + ref.height >= normalizedBBox.y).map(({ character }) => character.id);
    const orderedCharacters = unique(characterIds).map((id) => result.characters.find((character) => character.id === id)).filter(Boolean).sort((left, right) => left.canonicalIndex - right.canonicalIndex);
    // Align against the same sequence that is used to construct canonicalText.
    // Otherwise a removed whitespace character shifts every subsequent
    // sourceIndex and can attach an OCR substitution to the wrong character.
    const alignedCharacters = orderedCharacters.filter((character) => !/^\s$/u.test(character.value));
    const canonicalText = alignedCharacters.map((character) => character.value).join("");
    const observedText = String(observation.text || "").normalize("NFC").replace(/\s+/g, "");
    const aligned = alignSequences(canonicalText, observedText);
    const status = !orderedCharacters.length ? FORENSIC_CONFLICT_TYPES.OCR_UNALIGNED : aligned.distance === 0 ? FORENSIC_CONFLICT_TYPES.OCR_SUPPORT : FORENSIC_CONFLICT_TYPES.OCR_CONTRADICTION;
    const alignmentId = stableId("ocr-align", observation.id, alignedCharacters.map((character) => character.id), observedText);
    ocrAlignments.push({ id: alignmentId, observationId: observation.id, status, canonicalText, observedText, distance: aligned.distance, operations: aligned.operations, confidence: observation.confidence ?? null, engine: observation.engine, engineVersion: observation.engineVersion, bbox: normalizedBBox, evidenceRefs: [{ layer: "ocr", entityId: observation.id }, ...alignedCharacters.map((character) => ({ layer: "canonical-character", entityId: character.id }))] });
    aligned.operations.filter((operation) => operation.type === "substitution").forEach((operation) => {
      const character = alignedCharacters[operation.sourceIndex];
      if (!character) return;
      characterConflicts.push({
        id: stableId("conflict", "character", character.id, observation.id, operation.observedValue), type: FORENSIC_CONFLICT_TYPES.CHARACTER_IDENTITY,
        targetId: character.id, pageIndex: observation.pageIndex, status: "unresolved", severity: "high",
        sourceValue: character.value, candidates: [
          { value: character.value, relation: "embedded-source", evidenceRefs: character.sourceEvidenceRefs },
          { value: operation.observedValue, relation: "ocr-observation", evidenceRefs: [{ layer: "ocr", entityId: observation.id }, { layer: "ocr-alignment", entityId: alignmentId }] },
        ],
        sourceAnchors: character.sourceRefs, ocrObservationId: observation.id, ocrAlignmentId: alignmentId,
        evidenceRefs: [{ layer: "embedded-character", entityId: character.sourceEvidenceRefs[0]?.entityId }, { layer: "ocr", entityId: observation.id }],
        resolution: null,
      });
    });
    return { ...observation, canonical: false, normalizedBBox, characterIds: orderedCharacters.map((character) => character.id), wordIds: unique(orderedCharacters.map((character) => wordByCharacter.get(character.id))), alignmentId, alignmentStatus: status };
  });
  result.evidence.ocrAlignments = ocrAlignments;
  result.evidence.conflicts.push(...characterConflicts);
};

export const reconstructDocument = ({ documentId: requestedDocumentId, fileName = "PDF document", fileHash = "", pageCount: requestedPageCount, pages = [], outlines = [], ocrObservations = [], manualResolutions = [], morphologyAnalyses = [], wordSplitDecisions = [], documentFormAssignments = [], evidenceVersions = {}, extractionState = null, config: requestedConfig = {} }) => {
  const config = frozen({ ...DEFAULT_RECONSTRUCTION_CONFIG, ...requestedConfig, algorithmVersion: DOCUMENT_RECONSTRUCTION_VERSION });
  const configHash = deterministicHash(config);
  const documentId = requestedDocumentId || stableId("doc", fileHash || fileName, pages.length);
  const sourceHash = fileHash || deterministicHash(pages.map((page) => page.items));
  const pageCount = Math.max(Number(requestedPageCount) || 0, pages.reduce((maximum, page) => Math.max(maximum, Number(page.pageIndex) + 1), 0));
  const source = frozen({ id: documentId, fileHash: sourceHash, fileName, pageCount, extractionEngine: "pdfjs", extractionEngineVersion: "3.11.174" });
  const physicalEvidence = buildPhysicalEvidence(documentId, pages);
  const canonical = buildCanonicalCharacters(documentId, physicalEvidence.readingCharacters, config, configHash);
  const initialCanonicalText = canonical.characters.map((character) => character.value).join("");
  const canonicalPhysicalPages = attachCanonicalPhysicalLines(physicalEvidence.physicalPages, canonical.characters, initialCanonicalText);
  const embeddedById = new Map(physicalEvidence.embeddedCharacters.map((character) => [character.id, character]));
  const initialWordResult = buildWords(documentId, canonical.characters, embeddedById, config, configHash);
  const wordResult = applyForcedWordSplits(documentId, initialWordResult, canonical.characters, wordSplitDecisions, configHash);
  const preliminaryCanonicalText = buildCanonicalTextArtifact({ source, physical: { pages: canonicalPhysicalPages }, characters: canonical.characters, transformations: [...canonical.transformations, ...wordResult.transformations] });
  const physicalLines = canonicalPhysicalPages.flatMap((page) => page.physicalLines || page.regions.flatMap((region) => region.lines));
  const manualPhysicalBlocks = buildManualPhysicalBlocks({ documentId, physicalLines, assignments: documentFormAssignments, canonicalText: preliminaryCanonicalText.text, makeId: stableId });
  const manualBlockByLineSignature = new Map(manualPhysicalBlocks.map((block) => [[...block.lineIds].sort().join("|"), block]));
  const normalizedDocumentFormAssignments = documentFormAssignments.map((assignment) => {
    const lineSignature = unique(assignment.lineIds || assignment.physicalLineIds || []).sort().join("|");
    const manualBlock = manualBlockByLineSignature.get(lineSignature);
    return manualBlock ? { ...assignment, physicalBlockIds: [manualBlock.id], source: assignment.source || "manual" } : assignment;
  });
  const documentForms = buildDocumentForms({ documentId, physicalBlocks: manualPhysicalBlocks, assignments: normalizedDocumentFormAssignments, characters: canonical.characters, canonicalText: preliminaryCanonicalText.text, makeId: stableId });
  const physicalBlockScopedLinguistics = config.linguisticScope === "manual-physical-blocks";
  const scopedCandidates = physicalBlockScopedLinguistics
    ? scopeWordsAndSentencesToPhysicalBlocks({ documentId, words: wordResult.words, physicalBlocks: manualPhysicalBlocks, configHash })
    : { ...buildSentences(documentId, wordResult.words, configHash), words: wordResult.words };
  if (physicalBlockScopedLinguistics) {
    const scopedWordIds = new Set(scopedCandidates.words.map((word) => word.id));
    canonical.characters.forEach((character) => { if (character.parentWordId && !scopedWordIds.has(character.parentWordId)) character.parentWordId = null; });
  }
  const sentenceCandidates = { sentences: scopedCandidates.sentences, boundaries: scopedCandidates.boundaries };
  const explicitStructure = buildExplicitDocumentStructure({ documentId, forms: documentForms, physicalBlocks: manualPhysicalBlocks, sentenceCandidates: sentenceCandidates.sentences, wordCandidates: scopedCandidates.words, canonicalText: preliminaryCanonicalText.text, configHash });
  manualPhysicalBlocks.forEach((block) => {
    block.sentenceIds = explicitStructure.sentences
      .filter((sentence) => sentence.scopePhysicalBlockId === block.id)
      .map((sentence) => sentence.id);
  });
  const divisions = buildDivisions(documentId, outlines, explicitStructure.paragraphs, configHash, documentForms);
  const linguistic = buildLinguisticStructure(documentId, explicitStructure.sentences, explicitStructure.words, requestedConfig.language || "und", configHash, morphologyAnalyses);
  const morphemes = buildMorphemes(explicitStructure.words, morphologyAnalyses, canonical.characters);
  const normalizedEvidenceVersions = frozen({ ...evidenceVersions });
  const canonicalText = preliminaryCanonicalText;
  const manualPhysicalBlockSignature = manualPhysicalBlocks.map((block) => [block.id, block.lineIds, block.purpose]);
  const result = {
    source, run: { id: stableId("run", source.fileHash, DOCUMENT_RECONSTRUCTION_VERSION, configHash, normalizedEvidenceVersions, documentForms.map((form) => [form.id, form.type, form.physicalBlockIds]), manualPhysicalBlockSignature), documentId, createdAt: null, algorithmVersion: DOCUMENT_RECONSTRUCTION_VERSION, config, configHash, evidenceVersions: normalizedEvidenceVersions, reconstructionHash: deterministicHash([source.fileHash, DOCUMENT_RECONSTRUCTION_VERSION, configHash, normalizedEvidenceVersions, documentForms.map((form) => [form.id, form.type, form.physicalBlockIds]), manualPhysicalBlockSignature]), status: extractionState?.complete === false ? "partial" : "complete" },
    extractionState: extractionState ? { ...extractionState, documentId: extractionState.documentId || documentId, pageCount, sourceHash } : { documentId, pageCount, extractedPages: pages.map((page) => Number(page.pageIndex)).sort((a, b) => a - b), failedPages: [], complete: pages.length === pageCount, sourceHash, extractionVersion: "pdfjs-compact-v1" },
    physical: { id: stableId("pdf", documentId), type: "pdf", pages: canonicalPhysicalPages, lines: physicalLines, physicalLines, lineRelations: physicalEvidence.lineRelations, blocks: manualPhysicalBlocks, manualBlocks: manualPhysicalBlocks, blockBoundaries: [], structuralRegions: [], tables: [], tableCandidates: [], modelVersion: PHYSICAL_LINE_MODEL_VERSION, manualBlockModelVersion: MANUAL_PHYSICAL_BLOCK_MODEL_VERSION, config: requestedConfig.physicalLines || {} },
    documentForms,
    documentFormModelVersion: DOCUMENT_FORM_MODEL_VERSION,
    paragraphReconstruction: { version: DOCUMENT_FORM_MODEL_VERSION, layoutBlockCount: manualPhysicalBlocks.length, paragraphCandidateCount: 0, mode: "sentence-stream-with-manual-document-forms" },
    evidence: { sourceEvidence: physicalEvidence.sourceEvidence, rawCharacterCandidates: physicalEvidence.embeddedCharacters, embeddedCharacters: physicalEvidence.embeddedCharacters, glyphs: physicalEvidence.glyphs, referenceGlyphs: [], glyphAssessments: [], rasterEvidence: [], geometry: physicalEvidence.geometry, whitespace: physicalEvidence.whitespace, lineRelations: physicalEvidence.lineRelations, characterBoundaryEvidence: wordResult.characterBoundaryEvidence, physicalBlockBoundaries: [], paragraphBoundaryDecisions: [], paragraphStyleProfiles: [], ocrObservations: [...ocrObservations], ocrAlignments: [], conflicts: [], policies: EVIDENCE_POLICIES },
    characters: canonical.characters, alignments: canonical.alignments, words: explicitStructure.words,
    clauses: linguistic.clauses, phrases: linguistic.phrases, lexemes: linguistic.lexemes,
    linguisticModelVersion: "canonical-linguistic-v1",
    linguisticScope: { mode: physicalBlockScopedLinguistics ? "manual-physical-blocks" : "canonical-source", physicalBlockIds: manualPhysicalBlocks.map((block) => block.id) },
    canonicalText,
    morphemes, sentences: explicitStructure.sentences, paragraphs: explicitStructure.paragraphs, divisions, paragraphBoundaryDecisions: [], paragraphStyleProfiles: [],
    transformations: [...canonical.transformations, ...wordResult.transformations], boundaries: [...wordResult.boundaries, ...sentenceCandidates.boundaries],
    manualResolutions: [...manualResolutions], statistics: null, validation: null, diagnostics: null,
  };
  associateOcrEvidence(result);
  result.validation = validateDocumentReconstruction(result);
  result.diagnostics = buildDiagnostics(result);
  result.statistics = buildDocumentStatistics(result);
  return result;
};

const allLogicalEntities = (result) => [...(result.physical?.lines || []), ...(result.physical?.blocks || []), ...(result.physical?.tables || []).flatMap((table) => [table, ...table.rows.flatMap((row) => [row, ...row.cells])]), ...result.divisions, ...(result.documentForms || []).filter((form) => form.type !== "PARAGRAPH"), ...result.paragraphs, ...result.sentences, ...(result.clauses || []), ...(result.phrases || []), ...result.words, ...result.morphemes, ...(result.lexemes || []), ...result.characters];
const entityIndexCache = new WeakMap();
const entityIndexFor = (result) => {
  let index = entityIndexCache.get(result);
  if (!index) {
    index = new Map([[result.source.id, result.source], ...allLogicalEntities(result).map((entity) => [entity.id, entity])]);
    entityIndexCache.set(result, index);
  }
  return index;
};
export const getEntity = (result, entityId) => entityIndexFor(result).get(entityId) || null;

export const getLogicalRootPath = (result, entityId) => {
  const indexes = {
    division: new Map(result.divisions.map((entity) => [entity.id, entity])), paragraph: new Map(result.paragraphs.map((entity) => [entity.id, entity])),
    sentence: new Map(result.sentences.map((entity) => [entity.id, entity])), word: new Map(result.words.map((entity) => [entity.id, entity])),
    morpheme: new Map(result.morphemes.map((entity) => [entity.id, entity])), character: new Map(result.characters.map((entity) => [entity.id, entity])),
  };
  const path = [{ type: "document", id: result.source.id, label: result.source.fileName || "Document" }];
  const target = getEntity(result, entityId);
  if (!target || target.id === result.source.id) return path;
  let paragraph;
  if (target.wordId) {
    const word = indexes.word.get(target.wordId); const sentence = indexes.sentence.get(word?.parentSentenceId); paragraph = indexes.paragraph.get(sentence?.parentParagraphId);
  } else if (target.parentWordId) {
    const word = indexes.word.get(target.parentWordId); const sentence = indexes.sentence.get(word?.parentSentenceId); paragraph = indexes.paragraph.get(sentence?.parentParagraphId);
  } else if (target.parentSentenceId) paragraph = indexes.paragraph.get(indexes.sentence.get(target.parentSentenceId)?.parentParagraphId);
  else if (target.parentParagraphId) paragraph = indexes.paragraph.get(target.parentParagraphId);
  else if (target.sentenceIds) paragraph = target;
  const divisionPath = [];
  let division = indexes.division.get(paragraph?.parentDivisionId || target.parentDivisionId);
  while (division) { divisionPath.unshift({ type: "division", id: division.id, label: division.title }); division = indexes.division.get(division.parentDivisionId); }
  path.push(...divisionPath);
  if (paragraph) path.push({ type: "paragraph", id: paragraph.id, label: `Paragraph ${paragraph.displayIndex}` });
  const sentence = target.wordId ? indexes.sentence.get(indexes.word.get(target.wordId)?.parentSentenceId) : target.parentWordId ? indexes.sentence.get(indexes.word.get(target.parentWordId)?.parentSentenceId) : target.parentSentenceId ? indexes.sentence.get(target.parentSentenceId) : target.wordIds ? target : null;
  if (sentence) path.push({ type: "sentence", id: sentence.id, label: `Sentence ${sentence.displayIndex}` });
  const word = target.wordId ? indexes.word.get(target.wordId) : target.parentWordId ? indexes.word.get(target.parentWordId) : target.characterIds && target.resolvedText != null ? target : null;
  if (word) path.push({ type: "word", id: word.id, label: word.resolvedText });
  if (target.wordId) path.push({ type: "morpheme", id: target.id, label: target.surface });
  if (target.parentWordId) path.push({ type: "character", id: target.id, label: target.value });
  return path;
};

export const getPhysicalEvidence = (result, entityId) => {
  const entity = getEntity(result, entityId);
  const refs = entity?.sourceRefs || (entity?.characterIds || entity?.sourceCharacterIds || []).flatMap((id) => result.characters.find((character) => character.id === id)?.sourceRefs || []);
  return [...(refs || [])].sort((a, b) => a.pageIndex - b.pageIndex || (a.y || 0) - (b.y || 0) || (a.x || 0) - (b.x || 0));
};

export const getLogicalEntitiesAtPdfLocation = (result, { pageIndex, x, y, width = 0, height = 0 }) => {
  const right = x + Math.max(0, width);
  const bottom = y + Math.max(0, height);
  const overlaps = (ref) => ref.pageIndex === pageIndex
    && ref.x <= right && ref.x + Math.max(0, ref.width || 0) >= x
    && ref.y <= bottom && ref.y + Math.max(0, ref.height || 0) >= y;
  const characters = result.characters.filter((character) => character.sourceRefs.some(overlaps));
  if (!characters.length) return [];
  const words = unique(characters.map((character) => character.parentWordId)).map((id) => getEntity(result, id)).filter(Boolean);
  const sentences = unique(words.map((word) => word.parentSentenceId)).map((id) => getEntity(result, id)).filter(Boolean);
  const paragraphs = unique(sentences.map((sentence) => sentence.parentParagraphId)).map((id) => getEntity(result, id)).filter(Boolean);
  return [...characters, ...words, ...sentences, ...paragraphs];
};

export const getMissingSpaceCandidates = (result, lookupLocalEvidence = null) => {
  const candidates = [];
  result.words.filter((word) => word.tokenClass === "lexical-word" && Array.from(word.resolvedText).length >= 6).forEach((word) => {
    const chars = word.characterIds.map((id) => result.characters.find((entry) => entry.id === id)).filter(Boolean);
    for (let index = 1; index < chars.length; index += 1) {
      const leftRef = chars[index - 1].sourceRefs[0];
      const rightRef = chars[index].sourceRefs[0];
      if (!leftRef || !rightRef || leftRef.pageIndex !== rightRef.pageIndex || leftRef.textItemId === rightRef.textItemId) continue;
      const left = chars.slice(0, index).map((entry) => entry.value).join("");
      const right = chars.slice(index).map((entry) => entry.value).join("");
      if (Array.from(left).length < 2 || Array.from(right).length < 2 || !/^\p{L}+$/u.test(left) || !/^\p{L}+$/u.test(right)) continue;
      const joinedEvidence = lookupLocalEvidence?.(word.resolvedText) || null;
      const leftEvidence = lookupLocalEvidence?.(left) || null;
      const rightEvidence = lookupLocalEvidence?.(right) || null;
      const localSupportsSplit = Boolean(leftEvidence?.corpus?.recognized && rightEvidence?.corpus?.recognized && !joinedEvidence?.corpus?.recognized);
      const visualGap = Number(rightRef.x) - (Number(leftRef.x) + Number(leftRef.width));
      const averageWidth = Math.max(0.01, (Number(leftRef.width) + Number(rightRef.width)) / 2);
      candidates.push({
        id: stableId("candidate", "missing-space", word.id, index), wordId: word.id, surface: word.resolvedText, segmentation: [left, right],
        geometry: { pageIndex: leftRef.pageIndex, sourceItemTransition: true, visualGap, normalizedVisualGap: visualGap / averageWidth, leftTextItemId: leftRef.textItemId, rightTextItemId: rightRef.textItemId },
        localEvidence: { joined: joinedEvidence, segments: [leftEvidence, rightEvidence] }, localSupportsSplit,
      });
    }
  });
  return candidates;
};

export const explainResolution = (result, entityId) => {
  const entity = getEntity(result, entityId);
  if (!entity) return null;
  return {
    entityId, status: entity.status, qualityState: entity.qualityState,
    raw: entity.rawText ?? entity.rawValue ?? entity.value ?? entity.surface ?? "",
    normalized: entity.normalizedText ?? entity.normalizedValue ?? entity.value ?? entity.surface ?? "",
    resolved: entity.resolvedText ?? entity.value ?? entity.surface ?? "",
    construction: entity.construction,
    transformations: result.transformations.filter((transformation) => transformation.targetEntityId === entityId || entity.transformationIds?.includes(transformation.id)),
    sourceRefs: getPhysicalEvidence(result, entityId),
  };
};

export const compareSourceAndResolved = (result, entityId) => {
  const explanation = explainResolution(result, entityId);
  return explanation ? { source: explanation.raw, normalized: explanation.normalized, resolved: explanation.resolved, identical: explanation.raw === explanation.resolved, transformations: explanation.transformations } : null;
};

export const getChildren = (result, entityId) => {
  if (entityId === result.source.id) {
    const topDivisions = result.divisions.filter((division) => !division.parentDivisionId);
    const topForms = (result.documentForms || []).filter((form) => !form.parentDivisionId);
    return [...topDivisions, ...topForms, ...(result.physical?.tables || []), ...(result.physical?.lines || []), ...(result.physical?.blocks || [])];
  }
  const entity = getEntity(result, entityId);
  if (!entity) return [];
  if (entity.type === "table" && entity.rows) return entity.rows;
  if (entity.tableId && entity.cells) return entity.cells;
  if (entity.childDivisionIds) return [...entity.childDivisionIds.map((id) => getEntity(result, id)), ...(entity.documentFormIds || []).map((id) => getEntity(result, id))].filter(Boolean);
  if (entity.sentenceIds) return entity.sentenceIds.map((id) => getEntity(result, id)).filter(Boolean);
  if (entity.wordIds) return entity.wordIds.map((id) => getEntity(result, id)).filter(Boolean);
  if (entity.characterIds && entity.resolvedText != null) {
    const morphemes = result.morphemes.filter((morpheme) => morpheme.wordId === entity.id);
    return morphemes.length ? morphemes : entity.characterIds.map((id) => getEntity(result, id)).filter(Boolean);
  }
  if (entity.wordId) return entity.characterIds.map((id) => getEntity(result, id)).filter(Boolean);
  return [];
};

export const toTreeNodeView = (result, entity) => {
  const type = entity.id === result.source.id ? "document" : entity.modelVersion === PHYSICAL_LINE_MODEL_VERSION || entity.type === "physical-line" ? "physical-line" : entity.type === "table" && entity.rows ? "table" : entity.tableId && entity.cells ? "table-row" : entity.rowId && Number.isInteger(entity.columnIndex) ? "table-cell" : [PHYSICAL_BLOCK_MODEL_VERSION, MANUAL_PHYSICAL_BLOCK_MODEL_VERSION].includes(entity.modelVersion) ? "physical-block" : entity.modelVersion === DOCUMENT_FORM_MODEL_VERSION ? entity.type.toLocaleLowerCase().replaceAll("_", "-") : entity.role ? "division" : entity.sentenceIds ? "paragraph" : entity.wordIds ? "sentence" : entity.wordId ? "morpheme" : entity.parentWordId ? "character" : "word";
  const label = type === "document" ? entity.fileName : type === "division" ? entity.title : type === "physical-line" ? entity.canonicalText || entity.sourceText || `PhysicalLine ${entity.resolvedLineIndex + 1}` : type === "table" ? `TABLE · ${entity.columnCount} columns · ${entity.rowCount} rows` : type === "table-row" ? `Row ${entity.rowIndex + 1}` : type === "table-cell" ? `Cell ${entity.columnIndex + 1}: ${entity.sourceText || "[empty]"}` : type === "physical-block" ? entity.canonicalText || `Manual PhysicalBlock ${entity.displayIndex}` : entity.modelVersion === DOCUMENT_FORM_MODEL_VERSION ? entity.canonicalText || entity.type : type === "paragraph" ? `Paragraph ${entity.displayIndex}` : type === "sentence" ? entity.resolvedText : type === "word" ? entity.resolvedText : type === "morpheme" ? entity.surface : `${entity.value} · U+${entity.value.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`;
  const children = getChildren(result, entity.id);
  return { id: entity.id, type, label, status: entity.status || "asserted", qualityState: entity.qualityState || "SOURCE_EXACT", hasChildren: children.length > 0, childCount: children.length };
};

export const getTransformations = (result, entityId) => {
  const entity = getEntity(result, entityId);
  return result.transformations.filter((transformation) => transformation.targetEntityId === entityId || entity?.transformationIds?.includes(transformation.id));
};

export const getCharacterEvidence = (result, characterId) => {
  const character = result.characters.find((entry) => entry.id === characterId);
  if (!character) return null;
  const embeddedIds = character.sourceEvidenceRefs.filter((ref) => ref.layer === "embedded-character").map((ref) => ref.entityId);
  return {
    character,
    embeddedCharacters: result.evidence.embeddedCharacters.filter((entry) => embeddedIds.includes(entry.id)),
    glyphs: result.evidence.glyphs.filter((entry) => embeddedIds.includes(entry.characterEvidenceId)),
    geometry: result.evidence.geometry.filter((entry) => embeddedIds.includes(entry.characterEvidenceId)),
    ocrObservations: result.evidence.ocrObservations.filter((entry) => entry.characterId === characterId || entry.characterIds?.includes(characterId) || embeddedIds.includes(entry.characterEvidenceId)),
    ocrAlignments: (result.evidence.ocrAlignments || []).filter((entry) => entry.evidenceRefs?.some((ref) => ref.layer === "canonical-character" && ref.entityId === characterId)),
    raster: (result.evidence.rasterEvidence || []).filter((entry) => entry.targetId === characterId),
    referenceGlyphs: (result.evidence.referenceGlyphs || []).filter((entry) => entry.targetId === characterId),
    glyphAssessments: (result.evidence.glyphAssessments || []).filter((entry) => entry.targetId === characterId),
    transformations: getTransformations(result, characterId),
    conflicts: result.evidence.conflicts.filter((entry) => entry.targetId === characterId),
  };
};

export const getWordEvidence = (result, wordId) => {
  const word = result.words.find((entry) => entry.id === wordId);
  if (!word) return null;
  const characterEvidence = word.characterIds.map((id) => getCharacterEvidence(result, id)).filter(Boolean);
  return {
    word,
    characters: characterEvidence,
    whitespace: result.evidence.whitespace.filter((entry) => word.characterIds.some((id) => {
      const character = result.characters.find((candidate) => candidate.id === id);
      const embeddedId = character?.sourceEvidenceRefs.find((ref) => ref.layer === "embedded-character")?.entityId;
      return embeddedId && [entry.beforeCharacterId, entry.afterCharacterId].includes(embeddedId);
    })),
    transformations: getTransformations(result, wordId),
    conflicts: result.evidence.conflicts.filter((entry) => entry.targetId === wordId),
    boundaries: result.boundaries.filter((entry) => entry.afterEntityId === wordId || entry.beforeEntityId === wordId),
    sourceRefs: getPhysicalEvidence(result, wordId),
    lexical: word.lexicalEvidence || null,
    ocrObservations: characterEvidence.flatMap((entry) => entry.ocrObservations || []),
    ocrAlignments: characterEvidence.flatMap((entry) => entry.ocrAlignments || []),
    raster: [...(result.evidence.rasterEvidence || []).filter((entry) => entry.targetId === wordId), ...characterEvidence.flatMap((entry) => entry.raster || [])],
    referenceGlyphs: characterEvidence.flatMap((entry) => entry.referenceGlyphs || []),
    glyphAssessments: characterEvidence.flatMap((entry) => entry.glyphAssessments || []),
  };
};

export const getEvidenceForEntity = (result, entityId) => {
  if (result.characters.some((entry) => entry.id === entityId)) return getCharacterEvidence(result, entityId);
  if (result.words.some((entry) => entry.id === entityId)) return getWordEvidence(result, entityId);
  const entity = getEntity(result, entityId); const paragraphDecisionIds = new Set(entity?.boundaryDecisionIds || []);
  return { entity, sourceRefs: getPhysicalEvidence(result, entityId), transformations: getTransformations(result, entityId), conflicts: result.evidence.conflicts.filter((entry) => entry.targetId === entityId || entry.sentenceId && entity?.sentenceIds?.includes(entry.sentenceId)), boundaries: result.boundaries.filter((entry) => entry.afterEntityId === entityId || entry.beforeEntityId === entityId || paragraphDecisionIds.has(entry.id)), paragraphStyleProfile: result.paragraphStyleProfiles?.find((entry) => entry.id === entity?.styleProfileId) || null };
};

export const getParagraphBoundaryEvidence = (result, boundaryId) => result.paragraphBoundaryDecisions?.find((entry) => entry.id === boundaryId) || null;
export const getParagraphEvidence = (result, paragraphId) => {
  const paragraph = result.paragraphs.find((entry) => entry.id === paragraphId); if (!paragraph) return null;
  return { paragraph, lines: result.physical.pages.flatMap((page) => page.regions.flatMap((region) => region.lines)).filter((line) => paragraph.lineIds.includes(line.id)), boundaries: paragraph.boundaryDecisionIds.map((id) => getParagraphBoundaryEvidence(result, id)).filter(Boolean), styleProfile: result.paragraphStyleProfiles.find((entry) => entry.id === paragraph.styleProfileId) || null, sourceRefs: getPhysicalEvidence(result, paragraphId) };
};
export const explainParagraph = (result, paragraphId) => {
  const evidence = getParagraphEvidence(result, paragraphId); if (!evidence) return null;
  return { paragraphId, lineIds: evidence.paragraph.lineIds, pages: evidence.paragraph.pageIndexes, regions: evidence.paragraph.regionIds, startReason: evidence.paragraph.startReason, endReason: evidence.paragraph.endReason, styleProfile: evidence.styleProfile, crossPage: evidence.paragraph.crossPage, boundaries: evidence.boundaries };
};

export const getEvidenceConflicts = (result, { status } = {}) => result.evidence.conflicts.filter((conflict) => !status || conflict.status === status);
export const getGlyphAnomalies = (result) => result.evidence.glyphAssessments.filter((assessment) => ["suspected-malformed", "malformed"].includes(assessment.status));
export const getUnresolvedBoundaries = (result) => result.boundaries.filter((boundary) => boundary.decision === "unresolved" || boundary.status === "unresolved");

const normalizedConfidence = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric > 1 ? numeric / 100 : numeric));
};

const recognizedEvidenceLayers = (evidence) => ["dictionary", "corpus", "context", "approvedLexicon", "umls"]
  .filter((layer) => evidence?.[layer]?.recognized).length;

// A deterministic decision function, deliberately separate from mutation.
// OCR disagreement alone can never replace embedded text. Automatic
// substitution requires independent OCR, lexical/context and same-font
// raster support, all recorded in the returned rationale.
export const decideCharacterIdentityConflict = (result, conflictId, { lexicalEvidenceByValue = {}, minimumOcrConfidence = 0.92, minimumLexicalLayers = 2, minimumVisualMargin = 0.12 } = {}) => {
  const conflict = result.evidence.conflicts.find((entry) => entry.id === conflictId && entry.type === FORENSIC_CONFLICT_TYPES.CHARACTER_IDENTITY);
  if (!conflict) return { decision: "invalid", reason: "character-conflict-not-found", conflictId };
  const sourceValue = conflict.sourceValue;
  const ocrCandidate = conflict.candidates?.find((candidate) => candidate.relation === "ocr-observation" && candidate.value !== sourceValue);
  if (!ocrCandidate || Array.from(String(ocrCandidate.value)).length !== 1) return { decision: "keep-source", selectedValue: sourceValue, reason: "no-single-character-alternative", conflictId };
  const observation = result.evidence.ocrObservations.find((entry) => entry.id === conflict.ocrObservationId);
  const assessments = (result.evidence.glyphAssessments || []).filter((entry) => entry.targetId === conflict.targetId && entry.candidateValue != null && entry.referenceGlyphId);
  const sourceAssessment = assessments.find((entry) => entry.candidateValue === sourceValue);
  const candidateAssessment = assessments.find((entry) => entry.candidateValue === ocrCandidate.value);
  const sourceReference = result.evidence.referenceGlyphs.find((entry) => entry.id === sourceAssessment?.referenceGlyphId);
  const candidateReference = result.evidence.referenceGlyphs.find((entry) => entry.id === candidateAssessment?.referenceGlyphId);
  const confidence = normalizedConfidence(observation?.confidence);
  const lexicalLayers = recognizedEvidenceLayers(lexicalEvidenceByValue[ocrCandidate.value]);
  const sourceLayers = recognizedEvidenceLayers(lexicalEvidenceByValue[sourceValue]);
  const visualMargin = Number(candidateAssessment?.comparisonScore || 0) - Number(sourceAssessment?.comparisonScore || 0);
  const sameFontComparison = sourceReference?.referenceFontMethod === "source-font" && candidateReference?.referenceFontMethod === "source-font";
  const evidence = { confidence, lexicalLayers, sourceLayers, visualMargin, sameFontComparison, sourceAssessmentId: sourceAssessment?.id || null, candidateAssessmentId: candidateAssessment?.id || null, ocrObservationId: observation?.id || null };
  const substitute = confidence >= minimumOcrConfidence && lexicalLayers >= minimumLexicalLayers && lexicalLayers > sourceLayers && sameFontComparison && visualMargin >= minimumVisualMargin;
  return substitute
    ? { decision: "substitute", selectedValue: ocrCandidate.value, previousValue: sourceValue, reason: "independent-multi-evidence-consensus", ruleId: "CHAR_SUBSTITUTION_MULTI_EVIDENCE", conflictId, evidence }
    : { decision: "keep-source", selectedValue: sourceValue, alternativeValue: ocrCandidate.value, reason: "insufficient-independent-evidence", ruleId: "CHAR_KEEP_SOURCE_CONSERVATIVE", conflictId, evidence };
};

const sentenceTextFromWords = (words) => words.map((entry) => entry.resolvedText).join(" ").replace(/\s+([,.;:!?])/gu, "$1").replace(/(\d)\.\s+(?=\d)/gu, "$1.");

export const applyCharacterIdentityDecision = (result, decision, { actor = "deterministic-resolver", note = "" } = {}) => {
  const conflict = result.evidence.conflicts.find((entry) => entry.id === decision?.conflictId && entry.type === FORENSIC_CONFLICT_TYPES.CHARACTER_IDENTITY);
  const character = result.characters.find((entry) => entry.id === conflict?.targetId);
  if (!conflict || !character || !["substitute", "keep-source"].includes(decision?.decision)) throw new Error("Invalid character identity decision.");
  if (actor === "manual-review") throw new Error("Manual decisions must be stored as overrides, not applied to deterministic reconstruction.");
  const previousValue = character.value;
  if (decision.decision === "substitute" && decision.selectedValue !== previousValue) {
    const transformation = {
      id: stableId("transform", character.id, "CHARACTER_SUBSTITUTION", previousValue, decision.selectedValue, decision.ruleId), documentId: result.source.id,
      targetEntityId: character.id, type: "CHARACTER_SUBSTITUTION", before: previousValue, after: decision.selectedValue,
      sourceEvidenceRefs: character.sourceEvidenceRefs, evidence: decision.evidence, ruleId: decision.ruleId || "CHAR_SUBSTITUTION_MULTI_EVIDENCE",
      algorithmVersion: DOCUMENT_RECONSTRUCTION_VERSION, status: "inferred",
    };
    character.value = decision.selectedValue;
    character.status = "inferred";
    character.qualityState = "DETERMINISTICALLY_RECONSTRUCTED";
    character.transformationIds = unique([...(character.transformationIds || []), transformation.id]);
    result.transformations.push(transformation);
    const word = result.words.find((entry) => entry.id === character.parentWordId);
    if (word) {
      word.resolvedText = word.characterIds.map((id) => result.characters.find((entry) => entry.id === id)?.value || "").join("").replace(/[-‐‑](?=\p{L})/gu, "");
      word.qualityState = character.qualityState;
      word.transformationIds = unique([...(word.transformationIds || []), transformation.id]);
      const sentence = result.sentences.find((entry) => entry.id === word.parentSentenceId);
      if (sentence) {
        sentence.resolvedText = sentenceTextFromWords(sentence.wordIds.map((id) => result.words.find((entry) => entry.id === id)).filter(Boolean));
        const paragraph = result.paragraphs.find((entry) => entry.id === sentence.parentParagraphId);
        if (paragraph) paragraph.resolvedText = paragraph.sentenceIds.map((id) => result.sentences.find((entry) => entry.id === id)?.resolvedText || "").join(" ");
      }
    }
  }
  conflict.status = "resolved";
  conflict.resolution = { ...decision, actor, note, resolvedAt: null };
  result.manualResolutions.push({ id: stableId("resolution", conflict.id, decision.decision, decision.selectedValue, actor, note), targetId: character.id, conflictId: conflict.id, action: decision.decision, previousState: { value: previousValue }, newState: { value: character.value }, sourceEvidence: conflict.evidenceRefs, actor, note, createdAt: null });
  result.canonicalText = buildCanonicalTextArtifact({ source: result.source, physical: result.physical, characters: result.characters, transformations: result.transformations });
  result.validation = validateDocumentReconstruction(result);
  result.diagnostics = buildDiagnostics(result);
  result.statistics = buildDocumentStatistics(result);
  return result;
};

export const explainBoundary = (result, boundaryId) => {
  const boundary = result.boundaries.find((entry) => entry.id === boundaryId);
  if (!boundary) return null;
  return {
    boundary,
    humanReadable: `${boundary.decision.toUpperCase()} by ${boundary.ruleId}.`,
    evidence: boundary.evidence,
    policy: EVIDENCE_POLICIES[`${boundary.boundaryType}-boundary`] || EVIDENCE_POLICIES[boundary.boundaryType === "word" ? "word-boundary" : boundary.boundaryType === "sentence" ? "sentence-boundary" : "paragraph-boundary"],
  };
};

export const applyManualResolution = (result, { targetId, action, newState, previousState, userId, note = "" }) => {
  const target = getEntity(result, targetId) || result.boundaries.find((entry) => entry.id === targetId) || result.evidence.conflicts.find((entry) => entry.id === targetId);
  if (!target) throw new Error(`Manual resolution target not found: ${targetId}`);
  const sourceAnchors = target.boundaryType
    ? [...getPhysicalEvidence(result, target.afterEntityId), ...getPhysicalEvidence(result, target.beforeEntityId)]
    : getPhysicalEvidence(result, target.targetId || targetId);
  const resolution = {
    id: stableId("manual", result.run.id, targetId, action, newState, deterministicHash(sourceAnchors), result.manualResolutions.length),
    targetId, action, previousState: previousState ?? null, newState,
    deterministicValue: target.value ?? target.resolvedText ?? target.decision ?? null,
    effectiveValue: newState?.value ?? newState?.decision ?? target.value ?? target.resolvedText ?? target.decision ?? null,
    candidateSelected: newState?.candidateSelected ?? null, evidenceSnapshot: getEvidenceForEntity(result, target.targetId || targetId),
    sourceAnchors, sourceAnchorHash: deterministicHash(sourceAnchors), reconstructionHash: result.run.reconstructionHash,
    status: "ACTIVE", createdAt: new Date().toISOString(), userId, note,
  };
  return { ...result, manualResolutions: [...result.manualResolutions, resolution] };
};

export const getEffectiveEntity = (result, entityId) => {
  const entity = getEntity(result, entityId);
  if (!entity) return null;
  const deterministicValue = entity.value ?? entity.resolvedText ?? null;
  const currentAnchorHash = deterministicHash(getPhysicalEvidence(result, entityId));
  const override = [...result.manualResolutions].reverse().find((entry) => entry.targetId === entityId && entry.status !== "withdrawn");
  if (!override) return { ...entity, deterministicValue, effectiveValue: deterministicValue, manualOverride: null };
  const compatible = override.sourceAnchorHash === currentAnchorHash;
  return { ...entity, deterministicValue, effectiveValue: compatible ? override.effectiveValue : deterministicValue, manualOverride: { ...override, status: compatible ? override.status : "ORPHANED_OVERRIDE" } };
};

export const getEffectiveBoundary = (result, boundaryId) => {
  const boundary = result.boundaries.find((entry) => entry.id === boundaryId);
  if (!boundary) return null;
  const anchors = [...getPhysicalEvidence(result, boundary.afterEntityId), ...getPhysicalEvidence(result, boundary.beforeEntityId)];
  const anchorHash = deterministicHash(anchors);
  const override = [...result.manualResolutions].reverse().find((entry) => entry.targetId === boundaryId && entry.status !== "withdrawn");
  const compatible = !override || override.sourceAnchorHash === anchorHash;
  return { ...boundary, deterministicDecision: boundary.decision, effectiveDecision: override && compatible ? override.effectiveValue : boundary.decision, manualOverride: override ? { ...override, status: compatible ? override.status : "ORPHANED_OVERRIDE" } : null };
};
