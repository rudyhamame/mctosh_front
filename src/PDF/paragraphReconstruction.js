export const PARAGRAPH_RECONSTRUCTION_VERSION = "logical-paragraphs-v3";

export const PARAGRAPH_RULES = Object.freeze({
  SAME_LINE_STYLE_CONTINUATION: "PARAGRAPH_SAME_LINE_STYLE_CONTINUATION",
  FIRST_LINE_INDENT: "PARAGRAPH_FIRST_LINE_INDENT",
  BLOCK_GAP: "PARAGRAPH_BLOCK_GAP",
  INDENT_AND_GAP: "PARAGRAPH_INDENT_AND_GAP",
  BLANK_LINE: "PARAGRAPH_BLANK_LINE",
  AFTER_HEADING: "PARAGRAPH_AFTER_HEADING",
  BEFORE_HEADING: "PARAGRAPH_BEFORE_HEADING",
  LIST_ITEM_START: "PARAGRAPH_LIST_ITEM_START",
  HANGING_CONTINUATION: "PARAGRAPH_HANGING_CONTINUATION",
  CROSS_PAGE_CONTINUATION: "PARAGRAPH_CROSS_PAGE_CONTINUATION",
  SENTENCE_CONTINUATION: "PARAGRAPH_SENTENCE_CONTINUATION",
  REGION_TRANSITION: "PARAGRAPH_REGION_TRANSITION",
  HYPHEN_CONTINUATION: "PARAGRAPH_HYPHEN_CONTINUATION",
  UNRESOLVED: "PARAGRAPH_UNRESOLVED",
});

export const DEFAULT_PARAGRAPH_CONFIG = Object.freeze({
  profileSampleLimit: 128,
  maxProfiles: 64,
  fontSizeBand: 0.5,
  indentFontRatio: 0.85,
  blockGapRatio: 1.55,
  combinedGapRatio: 1.2,
  blankGapRatio: 2.25,
  sameLineGapRatio: 1.35,
  headingFontRatio: 1.18,
  minimumProfileSamples: 3,
});

const sortedMedian = (values, fallback = 0) => {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : fallback;
};
const tailPush = (array, value, limit) => {
  if (Number.isFinite(value)) array.push(value);
  if (array.length > limit) array.splice(0, array.length - limit);
};
const normalizeFont = (value) => String(value || "unknown").replace(/[,+-].*$/u, "").toLocaleLowerCase();
const isTerminal = (text) => /[.!?…]["'”’)]*$/u.test(String(text || "").trim());
const startsLowercase = (text) => /^\s*[\p{Ll}]/u.test(String(text || ""));
const startsUppercase = (text) => /^\s*[\p{Lu}]/u.test(String(text || ""));
const isListMarker = (text) => /^\s*(?:[•◦▪‣]|\(?\d+[.)]|[a-zA-Z][.)])\s+/u.test(String(text || ""));

export const classifyParagraphUnit = (line = {}) => {
  const text = String(line.text || "").trim();
  if (["caption", "table", "footnote", "page-number"].includes(line.regionType)) return line.regionType === "table" ? "table-cell" : line.regionType;
  if (isListMarker(text)) return "list-item";
  if (line.isHeading || ["heading", "title", "section-heading"].includes(line.regionType)) return line.regionType === "title" ? "heading" : "heading";
  return "paragraph";
};

const profileKey = (line, config) => [line.regionType || "body", line.columnId ?? "column-0", normalizeFont(line.fontName), Math.round((Number(line.fontSize) || 0) / config.fontSizeBand) * config.fontSizeBand].join("|");

export const createParagraphProfileState = () => ({ version: PARAGRAPH_RECONSTRUCTION_VERSION, profiles: {}, overflowCount: 0 });

const getProfile = (state, line, config) => {
  // Persisted reconstruction frontiers can outlive additions to the profile
  // state shape. Normalize missing fields at the boundary instead of letting
  // the first new font/column profile crash a resumed run.
  if (!state.profiles || typeof state.profiles !== "object" || Array.isArray(state.profiles)) state.profiles = {};
  if (!Number.isFinite(state.overflowCount)) state.overflowCount = 0;
  state.version ||= PARAGRAPH_RECONSTRUCTION_VERSION;
  let key = profileKey(line, config);
  if (!state.profiles[key] && Object.keys(state.profiles).length >= config.maxProfiles) { key = `${line.regionType || "body"}|${line.columnId ?? "column-0"}|overflow`; state.overflowCount += 1; }
  if (!state.profiles[key]) state.profiles[key] = { key, sampleCount: 0, lineGaps: [], leftMargins: [], rightMargins: [], widths: [], fontSizes: [] };
  return state.profiles[key];
};

const profileView = (profile, makeId, documentId) => {
  const medianLineGap = sortedMedian(profile.lineGaps, 0);
  const leftTolerance = Math.max(0.5, sortedMedian(profile.fontSizes, 10) * 0.35);
  const clusters = [];
  profile.leftMargins.slice().sort((a, b) => a - b).forEach((value) => {
    const cluster = clusters.find((candidate) => Math.abs(candidate.mean - value) <= leftTolerance);
    if (cluster) { cluster.sum += value; cluster.count += 1; cluster.mean = cluster.sum / cluster.count; }
    else clusters.push({ mean: value, sum: value, count: 1 });
  });
  clusters.sort((a, b) => b.count - a.count || a.mean - b.mean);
  return {
    id: makeId("paragraph-style", documentId, profile.key), documentId, regionType: profile.key.split("|")[0], columnId: profile.key.split("|")[1],
    fontFamily: profile.key.split("|")[2], fontSizeBand: Number(profile.key.split("|")[3]) || null,
    medianLineGap, lineGapP90: profile.lineGaps.slice().sort((a, b) => a - b)[Math.floor(profile.lineGaps.length * 0.9)] || medianLineGap,
    dominantLeftMargin: clusters[0]?.mean ?? sortedMedian(profile.leftMargins, 0), dominantRightMargin: sortedMedian(profile.rightMargins, 0),
    commonFirstLineIndent: clusters[1] && clusters[1].mean > clusters[0].mean ? clusters[1].mean - clusters[0].mean : null,
    commonHangingIndent: clusters[1] && clusters[1].mean < clusters[0].mean ? clusters[0].mean - clusters[1].mean : null,
    typicalLineWidth: sortedMedian(profile.widths, 0), sampleCount: profile.sampleCount,
    paragraphGapDistribution: { median: medianLineGap, p90: profile.lineGaps.slice().sort((a, b) => a - b)[Math.floor(profile.lineGaps.length * 0.9)] || medianLineGap },
  };
};

const observe = (state, previous, line, config) => {
  const profile = getProfile(state, line, config); profile.sampleCount += 1;
  tailPush(profile.leftMargins, Number(line.xStart), config.profileSampleLimit); tailPush(profile.rightMargins, Number(line.xEnd), config.profileSampleLimit);
  tailPush(profile.widths, Number(line.xEnd) - Number(line.xStart), config.profileSampleLimit); tailPush(profile.fontSizes, Number(line.fontSize), config.profileSampleLimit);
  if (previous && previous.pageIndex === line.pageIndex && previous.regionType === line.regionType && String(previous.columnId ?? "") === String(line.columnId ?? "")) tailPush(profile.lineGaps, Math.max(0, Number(line.yTop) - Number(previous.yBottom)), config.profileSampleLimit);
  return profile;
};

export const observeParagraphLine = (profileState, previousLine, line, requestedConfig = {}) => observe(profileState, previousLine, line, { ...DEFAULT_PARAGRAPH_CONFIG, ...requestedConfig });

const headingLike = (line, profile, config) => {
  if (["heading", "title", "section-heading"].includes(line.regionType) || line.isHeading) return true;
  const medianFont = sortedMedian(profile?.fontSizes || [], Number(line.fontSize) || 0);
  return profile?.sampleCount >= config.minimumProfileSamples && String(line.text || "").trim().split(/\s+/u).length <= 12 && Number(line.fontSize) > medianFont * config.headingFontRatio;
};

export const decideParagraphBoundary = ({ documentId, previousLine, nextLine, profileState, makeId, sentenceContinues = false, chunkTransition = false, config: requestedConfig = {} }) => {
  const config = { ...DEFAULT_PARAGRAPH_CONFIG, ...requestedConfig };
  const profile = getProfile(profileState, nextLine, config); const style = profileView(profile, makeId, documentId);
  const pageTransition = previousLine.pageIndex !== nextLine.pageIndex;
  const sameRegion = previousLine.regionType === nextLine.regionType;
  const sameColumnLabel = String(previousLine.columnId ?? "column-0") === String(nextLine.columnId ?? "column-0");
  const previousWidth = Math.max(1, Number(previousLine.xEnd) - Number(previousLine.xStart));
  const nextWidth = Math.max(1, Number(nextLine.xEnd) - Number(nextLine.xStart));
  const horizontalOverlap = Math.max(0, Math.min(Number(previousLine.xEnd), Number(nextLine.xEnd)) - Math.max(Number(previousLine.xStart), Number(nextLine.xStart)));
  const overlapRatio = horizontalOverlap / Math.max(1, Math.min(previousWidth, nextWidth));
  const lineScale = Math.max(1, Number(previousLine.fontSize) || 0, Number(nextLine.fontSize) || 0, Number(previousLine.yBottom) - Number(previousLine.yTop), Number(nextLine.yBottom) - Number(nextLine.yTop));
  const forwardVisualFlow = pageTransition || Number(nextLine.yTop) >= Number(previousLine.yTop) - lineScale * 0.25;
  // PDF layout can label one ordinary line `full-width` when that line
  // happens to cross a noisy gutter estimate. Preserve paragraph flow when
  // geometry still says the lines are vertically adjacent and overlap in the
  // same text track. A real column switch has little overlap or jumps upward.
  const geometryRepairsColumnDrift = !pageTransition && sameRegion && !sameColumnLabel && forwardVisualFlow && overlapRatio >= 0.55;
  const sameColumn = sameColumnLabel || geometryRepairsColumnDrift;
  const verticalGap = pageTransition ? undefined : Math.max(0, Number(nextLine.yTop) - Number(previousLine.yBottom));
  const normalizedVerticalGap = Number.isFinite(verticalGap) && style.medianLineGap > 0 ? verticalGap / style.medianLineGap : undefined;
  const leftIndentDelta = Number(nextLine.xStart) - Number(style.dominantLeftMargin || nextLine.xStart);
  const rightEdgeDelta = Number(nextLine.xEnd) - Number(previousLine.xEnd);
  const fontSizeDelta = Number(nextLine.fontSize || 0) - Number(previousLine.fontSize || 0);
  const sameFontFamily = normalizeFont(previousLine.fontName) === normalizeFont(nextLine.fontName);
  const sameFontSize = Math.abs(fontSizeDelta) <= Math.max(0.25, Number(nextLine.fontSize || 0) * 0.05);
  const indentThreshold = Math.max(2, Number(nextLine.fontSize || 10) * config.indentFontRatio);
  const firstLineIndentEvidence = profile.sampleCount >= config.minimumProfileSamples && leftIndentDelta >= indentThreshold;
  const previousList = isListMarker(previousLine.text); const nextList = isListMarker(nextLine.text);
  const hangingIndentEvidence = previousList && Number(nextLine.xStart) - Number(previousLine.xStart) >= indentThreshold * 0.6;
  const shortPrevious = String(previousLine.text || "").trim().split(/\s+/u).length <= 12; const shortNext = String(nextLine.text || "").trim().split(/\s+/u).length <= 12;
  const previousHeading = headingLike(previousLine, profile, config) || shortPrevious && Number(previousLine.fontSize) > Math.max(1, Number(nextLine.fontSize)) * config.headingFontRatio;
  const nextHeading = headingLike(nextLine, profile, config) || shortNext && Number(nextLine.fontSize) > Math.max(1, Number(previousLine.fontSize)) * config.headingFontRatio;
  const blankLineEvidence = Number.isFinite(normalizedVerticalGap) && normalizedVerticalGap >= config.blankGapRatio;
  const blockParagraphEvidence = Number.isFinite(normalizedVerticalGap) && normalizedVerticalGap >= config.blockGapRatio;
  const evidence = {
    verticalGap, normalizedVerticalGap, localMedianLineGap: style.medianLineGap,
    previousLineXStart: previousLine.xStart, nextLineXStart: nextLine.xStart, leftIndentDelta,
    previousLineXEnd: previousLine.xEnd, nextLineXEnd: nextLine.xEnd, rightEdgeDelta,
    previousLineWidth: Number(previousLine.xEnd) - Number(previousLine.xStart), nextLineWidth: Number(nextLine.xEnd) - Number(nextLine.xStart),
    sameRegion, sameColumn, sameColumnLabel, geometryRepairsColumnDrift, horizontalOverlap, overlapRatio, forwardVisualFlow, sameFont: previousLine.fontName === nextLine.fontName, sameFontFamily, sameFontSize, fontSizeDelta,
    sameAlignment: Math.abs(Number(previousLine.xStart) - Number(nextLine.xStart)) <= Math.max(1, Number(nextLine.fontSize || 10) * 0.2), sameBaselinePattern: sameFontSize,
    blankLineEvidence, firstLineIndentEvidence, hangingIndentEvidence, blockParagraphEvidence,
    listMarkerEvidence: nextList, headingBefore: previousHeading, headingAfter: nextHeading,
    previousLineEndsTerminalPunctuation: isTerminal(previousLine.text), previousLineEndsHyphen: /[-‐‑‒–]$/u.test(String(previousLine.text || "").trim()),
    nextLineStartsUppercase: startsUppercase(nextLine.text), nextLineStartsLowercase: startsLowercase(nextLine.text),
    pageTransition, chunkTransition, previousRegionType: previousLine.regionType, nextRegionType: nextLine.regionType,
    previousClassification: classifyParagraphUnit(previousLine), nextClassification: classifyParagraphUnit(nextLine),
    continuationEvidence: [], boundaryEvidence: [], styleProfileId: style.id,
  };
  let decision = "unresolved"; let ruleId = PARAGRAPH_RULES.UNRESOLVED; let status = "unresolved"; let strength = "WEAK";
  const choose = (nextDecision, nextRule, nextStatus, nextStrength, reason, kind) => { decision = nextDecision; ruleId = nextRule; status = nextStatus; strength = nextStrength; evidence[kind].push(reason); };
  if (!sameRegion || (!sameColumn && !pageTransition)) choose("new-paragraph", PARAGRAPH_RULES.REGION_TRANSITION, "asserted", "DECISIVE", !sameRegion ? "region-type-changed" : "column-changed", "boundaryEvidence");
  else if (previousHeading) choose("new-paragraph", PARAGRAPH_RULES.AFTER_HEADING, "asserted", "DECISIVE", "previous-line-is-heading", "boundaryEvidence");
  else if (nextHeading) choose("new-paragraph", PARAGRAPH_RULES.BEFORE_HEADING, "asserted", "DECISIVE", "next-line-is-heading", "boundaryEvidence");
  else if (nextList && !hangingIndentEvidence) choose("new-paragraph", PARAGRAPH_RULES.LIST_ITEM_START, "inferred", "STRONG", "list-marker-start", "boundaryEvidence");
  else if (hangingIndentEvidence) choose("same-paragraph", PARAGRAPH_RULES.HANGING_CONTINUATION, "inferred", "STRONG", "hanging-indent-continuation", "continuationEvidence");
  else if (evidence.previousLineEndsHyphen) choose("same-paragraph", PARAGRAPH_RULES.HYPHEN_CONTINUATION, "asserted", "STRONG", "line-final-hyphen", "continuationEvidence");
  else if (pageTransition && firstLineIndentEvidence) choose("new-paragraph", PARAGRAPH_RULES.FIRST_LINE_INDENT, "inferred", "STRONG", "cross-page-first-line-indent", "boundaryEvidence");
  else if (pageTransition && sameFontFamily && sameFontSize && (sentenceContinues || evidence.nextLineStartsLowercase)) choose("same-paragraph", PARAGRAPH_RULES.CROSS_PAGE_CONTINUATION, "inferred", "STRONG", "page-transition-neutral-with-continuity", "continuationEvidence");
  else if (pageTransition) choose("unresolved", PARAGRAPH_RULES.UNRESOLVED, "unresolved", "WEAK", "page-transition-is-neutral", "continuationEvidence");
  else if (blankLineEvidence) choose("new-paragraph", PARAGRAPH_RULES.BLANK_LINE, "inferred", "STRONG", "visual-blank-line-gap", "boundaryEvidence");
  else if (firstLineIndentEvidence && Number(normalizedVerticalGap || 0) >= config.combinedGapRatio) choose("new-paragraph", PARAGRAPH_RULES.INDENT_AND_GAP, "inferred", "STRONG", "first-line-indent-and-elevated-gap", "boundaryEvidence");
  else if (firstLineIndentEvidence) choose("new-paragraph", PARAGRAPH_RULES.FIRST_LINE_INDENT, "inferred", "STRONG", "recurring-first-line-indent", "boundaryEvidence");
  else if (blockParagraphEvidence) choose("new-paragraph", PARAGRAPH_RULES.BLOCK_GAP, "inferred", "STRONG", "locally-elevated-line-gap", "boundaryEvidence");
  else if (sentenceContinues) choose("same-paragraph", PARAGRAPH_RULES.SENTENCE_CONTINUATION, "inferred", "STRONG", "same-sentence-crosses-lines", "continuationEvidence");
  else if (sameFontFamily && sameFontSize && (normalizedVerticalGap == null || normalizedVerticalGap <= config.sameLineGapRatio)) choose("same-paragraph", PARAGRAPH_RULES.SAME_LINE_STYLE_CONTINUATION, "inferred", "SUPPORTING", "same-local-line-style", "continuationEvidence");
  return {
    id: makeId("paragraph-boundary", documentId, previousLine.id, nextLine.id), documentId,
    previousLineId: previousLine.id, nextLineId: nextLine.id, afterEntityId: previousLine.id, beforeEntityId: nextLine.id,
    boundaryType: "paragraph", decision, normalizedDecision: decision === "new-paragraph" ? "split" : decision === "same-paragraph" ? "merge" : "unresolved",
    boundaryScore: evidence.boundaryEvidence.length, continuationScore: evidence.continuationEvidence.length,
    confidence: strength, evidence, ruleId, status, strength, algorithmVersion: PARAGRAPH_RECONSTRUCTION_VERSION, styleProfileId: style.id,
  };
};

export const analyzeParagraphLineStream = ({ documentId, lines, makeId, sentenceContinuationPairs = new Set(), profileState = createParagraphProfileState(), config = {} }) => {
  const ordered = [...lines]; const decisions = []; const spans = [];
  if (!ordered.length) return { decisions, spans, profiles: [], profileState };
  observe(profileState, null, ordered[0], { ...DEFAULT_PARAGRAPH_CONFIG, ...config });
  for (let index = 1; index < ordered.length; index += 1) {
    const previousLine = ordered[index - 1]; const nextLine = ordered[index];
    decisions.push(decideParagraphBoundary({ documentId, previousLine, nextLine, profileState, makeId, sentenceContinues: sentenceContinuationPairs.has(`${previousLine.id}:${nextLine.id}`), config }));
    observe(profileState, previousLine, nextLine, { ...DEFAULT_PARAGRAPH_CONFIG, ...config });
  }
  let current = [ordered[0]]; let startDecisionId = null;
  decisions.forEach((decision, index) => {
    if (decision.decision === "new-paragraph") {
      spans.push({ id: makeId("paragraph-span", documentId, current.map((line) => line.id)), lineIds: current.map((line) => line.id), lines: current, startBoundaryDecisionId: startDecisionId, endBoundaryDecisionId: decision.id, styleProfileId: decision.styleProfileId });
      current = [ordered[index + 1]]; startDecisionId = decision.id;
    } else current.push(ordered[index + 1]);
  });
  spans.push({ id: makeId("paragraph-span", documentId, current.map((line) => line.id)), lineIds: current.map((line) => line.id), lines: current, startBoundaryDecisionId: startDecisionId, endBoundaryDecisionId: null, styleProfileId: decisions.at(-1)?.styleProfileId || null });
  const layoutBlockMap = new Map();
  ordered.forEach((line) => {
    const id = line.regionId || line.id;
    const block = layoutBlockMap.get(id) || { id, pageIndex: line.pageIndex, columnId: line.columnId, lineIds: [], sourceBlockIds: [id], classification: classifyParagraphUnit(line), typography: { fontName: line.fontName, fontSize: line.fontSize }, lines: [] };
    block.lineIds.push(line.id); block.lines.push(line); layoutBlockMap.set(id, block);
  });
  return {
    decisions,
    spans: spans.map((span) => ({ ...span, candidateType: "paragraph-candidate", classification: classifyParagraphUnit(span.lines[0] || {}), sourceBlockIds: [...new Set(span.lines.map((line) => line.regionId).filter(Boolean))] })),
    profiles: Object.values(profileState.profiles).map((profile) => profileView(profile, makeId, documentId)),
    layoutBlocks: [...layoutBlockMap.values()],
    profileState,
  };
};
