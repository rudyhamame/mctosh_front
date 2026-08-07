import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import { useAIProvider } from "../hooks/useAIProvider";
import * as pdfjsLib from "pdfjs-dist";
import "./pdfPage.css";
import { apiUrl } from "../config/api";
import { readStoredSession } from "../utils/sessionCleanup";
import { normalizeOpenAiSttModel, readSttSettings, STT_PROVIDERS } from "../Avatar/local3d/sttProviderSettings";
import { useLongPressSelect } from "../utils/longPressSelect";
import DraftTextViewer, { cleanMarkdownToPlainText } from "../components/DraftTextViewer";
import HyleCards from "./HyleCards";
import PDFTextAssistant from "./PDFTextAssistant";
import SmartVideoPanel from "./SmartVideoPanel";
import EntityBuilderPanel from "./EntityBuilderPanel";
import { drawAnnotation, drawMaskedHighlightText } from "./annotationDraw";
import { PDF_TYPE_ICON } from "./pdfTypeIcon";
import { createPageIndexCache } from "./pdfSearchIndex.js";
import { normalizeQuery, searchPageForQuery } from "./pdfFuzzySearch.js";
import { correctSelectedPdfText } from "./pdfTextCorrection.js";
import { BBOX_TEXT_CORRECTION_VERSION, correctBBoxText } from "./bboxTextCorrection.js";
import { analyzePageLayout } from "./pdfPageLayout.js";
import { buildParagraphMergePlan } from "./pdfParagraphMerge.js";
import { removeParagraphTitleFromText, removeParagraphTitleLine } from "./pdfParagraphTitle.js";
import { normalizePagePartitionHierarchy } from "./pdfBBoxHierarchy.js";
import { computeHighlightRectsForItemIndexes } from "./pdfHighlightRects.js";
import {
  bboxTextMatchesSpan as bboxTextMatchesSpanUtil,
  buildPartitionOrderedTextLines,
  buildTextLineRects,
  buildTextLines,
  buildTightOutlineFromLineRects,
  buildTightTextOutline,
  extractBoundingBoxTextParts,
  selectSpansForBoundingBox,
} from "./pdfBBoxTextExtraction.js";
import { buildRawHyle, buildSegmentedHyle, computeMarkerPosition } from "./pdfHyleStats.js";
import { segmentPageIntoParagraphBBoxes } from "./pdfSmartSegment.js";
import { extractPlacedImageRects } from "./pdfImageGeometry.js";
import InfoPopupButton from "./InfoPopupButton";
import { getPageExtractionEvidence, resolveDocumentId } from "./pdfPageStructureClient.js";
import {
  listMorpheSchemaNames,
  upsertSmartPenSchema,
  upsertSmartPenTrace,
  morpheSchemas as morpheSchemasApi,
  morpheTraceSchemas as morpheTraceSchemasApi,
} from "../ClinicalSchemata/amctoshsMorpheClient.js";
import {
  SEMANTIC_DETECTION_SCOPE,
  buildSemanticCandidates,
  unionCandidateBoxes,
  semanticTypeToBBoxType,
} from "./pdfSemanticDetection.js";
import {
  BBOX_CARD_TYPES,
  canBBoxContain,
  EDITABLE_BBOX_TYPES,
  bboxTypeHas,
  clientPointToBBoxPagePoint,
  createBBoxDraft,
  getSemanticHyleBBoxId,
  buildHyleBBoxIdMap,
  getBBoxTypeAbbreviation,
  getBBoxTypeDefinition,
  getViewportDocumentSize,
  isBBoxType,
} from "./pdfBBoxTypes.js";
import {
  ANNOT_COLORS,
  ANNOT_COLOR_GROUPS,
  ANNOT_HISTORY_META,
  ANNOT_TOOLS,
  AnnotControlHeaderInfo,
  ArrowToolIcon,
  BBOX_DISTINCT_COLORS,
  CARDS,
  DEFAULT_ANNOT_TOOL_COLORS,
  DeletePageIcon,
  DRAWING_TOOL_ORDER,
  FreeshapeToolIcon,
  HYLE_TYPE_LABELS,
  HYLE_TYPE_TREE,
  InsertPageIcon,
  LabeledPercentKnob,
  MODE_TOOL_ORDER,
  OPACITY_MAX_PCT,
  OPACITY_MIN_PCT,
  OpacityKnob,
  PDF_TYPE_LABEL,
  PenToolIcon,
  SHAPE_TOOL_KEYS,
  ShapesToolIcon,
  SizeKnob,
  SmartVideoIcon,
  TEXT_FONT_FAMILIES,
} from "./pdfPageToolbarConfig.jsx";
import { readTranslatorProvider } from "../utils/translatorSettings";

pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 5;
const NOTEBOOK_DRAWING_WIDTH = 1000;
const SpeechRecognition = typeof window !== "undefined"
  ? (window.SpeechRecognition || window.webkitSpeechRecognition)
  : null;
const NOTEBOOK_VOICE_COMMANDS = [
  "Delete <line number> from <word number>",
  "Edit <word number> from <line number> to <new value>",
];
const LEGACY_NOTEBOOK_EDIT_COMMAND = "Edit <line number> from <word number>";
const NOTEBOOK_VOICE_COMMAND_ACTIONS = ["delete", "edit"];
const NOTEBOOK_VOICE_COMMAND_LABELS = ["Delete word", "Edit word"];
const NUMBER_WORDS = Object.freeze({
  ZERO: 0, ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5,
  SIX: 6, SEVEN: 7, EIGHT: 8, NINE: 9,
});
const voiceCommandLiteralPattern = (literal) => {
  const words = String(literal || "").match(/[\p{L}\p{N}]+/gu) || [];
  return words.length
    ? `\\s*${words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+")}\\s*`
    : "\\s*";
};
const compileNotebookVoiceCommand = (template, action) => {
  const placeholderPattern = /<\s*(line(?:\s+number)?|word(?:\s+number)?|new\s+value)\s*>/gi;
  const captures = [];
  let cursor = 0;
  let source = "^";
  let match;
  while ((match = placeholderPattern.exec(String(template || "")))) {
    source += voiceCommandLiteralPattern(String(template).slice(cursor, match.index));
    source += "(.+?)";
    const placeholder = match[1].toLowerCase().replace(/\s+/g, " ");
    captures.push(placeholder.startsWith("line") ? "line" : placeholder.startsWith("word") ? "word" : "value");
    cursor = match.index + match[0].length;
  }
  source += voiceCommandLiteralPattern(String(template || "").slice(cursor));
  source += "$";
  if (!captures.includes("line") || !captures.includes("word")) return null;
  if (action === "edit" && !captures.includes("value")) return null;
  return { action, captures, pattern: new RegExp(source, "iu") };
};
const isPenToolKey = (key) => key === "pen" || key === "smartPen";
const cleanSchemaWord = (value) => String(value || "")
  .normalize("NFKC")
  .trim()
  .replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, "")
  .trim();
const schemaWordKey = (value) => cleanSchemaWord(value).toLocaleLowerCase();
const areConsecutiveRawInstances = (previousRow, currentRow) => {
  const previous = Number(previousRow?.instanceNumber);
  const current = Number(currentRow?.instanceNumber);
  // Some fallback extraction rows do not carry an instance number. Preserve
  // their spatial grouping, but enforce source order whenever both values
  // are available.
  return !Number.isFinite(previous) || !Number.isFinite(current) || current === previous + 1;
};
const isRectFullyContainedByBBox = (rect, bbox, tolerance = 0.35) => {
  if (!rect || !bbox) return false;
  const left = Number(rect.x);
  const top = Number(rect.y);
  const width = Number(rect.w);
  const height = Number(rect.h);
  const bboxLeft = Number(bbox.x);
  const bboxTop = Number(bbox.y);
  const bboxWidth = Number(bbox.w);
  const bboxHeight = Number(bbox.h);
  if (![left, top, width, height, bboxLeft, bboxTop, bboxWidth, bboxHeight].every(Number.isFinite)) return false;
  return left >= bboxLeft - tolerance
    && top >= bboxTop - tolerance
    && left + Math.max(0, width) <= bboxLeft + bboxWidth + tolerance
    && top + Math.max(0, height) <= bboxTop + bboxHeight + tolerance;
};

const isSmartPenRectangularStroke = (stroke) => {
  const points = Array.isArray(stroke?.points) ? stroke.points : [];
  if (points.length < 8) return false;
  const xs = points.map((point) => Number(point.x)).filter(Number.isFinite);
  const ys = points.map((point) => Number(point.y)).filter(Number.isFinite);
  if (!xs.length || !ys.length) return false;
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  const width = right - left;
  const height = bottom - top;
  if (width < 4 || height < 4) return false;

  // A rectangle is one closed stroke with evidence of all four sides. A
  // straight line over a word has neither the required closure nor side
  // coverage, even if its bounding box happens to span the word's width.
  const closureTolerance = Math.max(2, Math.min(width, height) * 0.45);
  const first = points[0];
  const last = points[points.length - 1];
  if (Math.hypot(Number(first.x) - Number(last.x), Number(first.y) - Number(last.y)) > closureTolerance) return false;
  const sideTolerance = Math.max(1.5, Math.min(width, height) * 0.28);
  const sideSpan = (side, axis) => {
    const sidePoints = points.filter((point) => Math.abs(Number(point[axis]) - side) <= sideTolerance);
    if (sidePoints.length < 2) return 0;
    const values = sidePoints.map((point) => Number(point[axis === "x" ? "y" : "x"]));
    return Math.max(...values) - Math.min(...values);
  };
  return sideSpan(top, "y") >= width * 0.45
    && sideSpan(bottom, "y") >= width * 0.45
    && sideSpan(left, "x") >= height * 0.45
    && sideSpan(right, "x") >= height * 0.45;
};

const getSmartPenCoveredSpanRecords = (stroke, spans) => {
  if (!Array.isArray(stroke?.points) || stroke.points.length < 2) return [];
  const xs = stroke.points.map((point) => Number(point.x)).filter(Number.isFinite);
  const ys = stroke.points.map((point) => Number(point.y)).filter(Number.isFinite);
  if (!xs.length || !ys.length) return [];
  const strokePadding = Math.max(0.5, Number(stroke.lineWidth || 1) / 2);
  const strokeLeft = Math.min(...xs) - strokePadding;
  const strokeRight = Math.max(...xs) + strokePadding;
  const strokeTop = Math.min(...ys) - strokePadding;
  const strokeBottom = Math.max(...ys) + strokePadding;

  const matches = new Map();
  for (const span of spans || []) {
    const word = cleanSchemaWord(span?.text);
    if (!word || /\s/u.test(word) || !/[\p{L}\p{N}]/u.test(word)) continue;
    const left = Math.min(Number(span.pageLeft), Number(span.pageRight));
    const right = Math.max(Number(span.pageLeft), Number(span.pageRight));
    const top = Number(span.pageTop);
    const bottom = Number(span.pageBottom);
    if (![left, right, top, bottom].every(Number.isFinite) || right <= left || bottom <= top) continue;
    const centerY = (top + bottom) / 2;
    // Full rectangle containment is deliberate: a line passing across only
    // the word's width must never qualify as a contained word.
    if (left >= strokeLeft && right <= strokeRight && top >= strokeTop && bottom <= strokeBottom) {
      matches.set(schemaWordKey(word), { word, left, right, top, bottom, centerX: (left + right) / 2, centerY });
    }
  }
  return [...matches.values()];
};

const getSmartPenCoveredWords = (stroke, spans) => (
  getSmartPenCoveredSpanRecords(stroke, spans).map(({ word }) => word)
);

// A rectangular Smart Pen stroke may contain a phrase. Group covered words
// by visual line and join only neighboring words; this prevents two columns
// or separate lines inside one large rectangle from becoming one schema.
const getSmartPenCoveredSchemaNames = (stroke, spans) => {
  const records = getSmartPenCoveredSpanRecords(stroke, spans)
    .sort((a, b) => (a.centerY - b.centerY) || (a.left - b.left));
  const lines = [];
  records.forEach((record) => {
    const line = lines.find((candidate) => Math.abs(candidate.centerY - record.centerY) <= Math.max(3, Math.min(candidate.records[0].bottom - candidate.records[0].top, record.bottom - record.top) * 0.65));
    if (line) {
      line.records.push(record);
      line.centerY = (line.centerY * (line.records.length - 1) + record.centerY) / line.records.length;
    } else {
      lines.push({ centerY: record.centerY, records: [record] });
    }
  });
  const names = [];
  lines.forEach((line) => {
    line.records.sort((a, b) => a.left - b.left);
    let run = [];
    const flush = () => {
      const name = run.map((record) => record.word).join(" ").trim();
      if (name) names.push(name);
      run = [];
    };
    line.records.forEach((record, index) => {
      const previous = line.records[index - 1];
      const gap = previous ? record.left - previous.right : 0;
      const lineHeight = Math.max(1, record.bottom - record.top, previous ? previous.bottom - previous.top : 1);
      if (previous && gap > lineHeight * 1.8) flush();
      run.push(record);
    });
    flush();
  });
  return names;
};

const isSmartPenRectangularEndpoint = (stroke, targetRecords) => {
  if (!targetRecords.length) return false;
  const left = Math.min(...targetRecords.map((record) => record.left));
  const right = Math.max(...targetRecords.map((record) => record.right));
  const top = Math.min(...targetRecords.map((record) => record.top));
  const bottom = Math.max(...targetRecords.map((record) => record.bottom));
  const width = right - left;
  const height = bottom - top;
  if (width <= 0 || height <= 0) return false;
  const points = Array.isArray(stroke?.points) ? stroke.points : [];
  const tolerance = Math.max(1.5, Math.min(width, height) * 0.4, Number(stroke.lineWidth || 1));
  const projectedSpan = (side, axis, alongAxis, outward) => {
    const sidePoints = points.filter((point) => Math.abs(Number(point[axis]) - side) <= tolerance);
    if (sidePoints.length < 2) return 0;
    const sideCoordinates = sidePoints.map((point) => Number(point[axis])).filter(Number.isFinite);
    const outermost = outward === "min" ? Math.min(...sideCoordinates) : Math.max(...sideCoordinates);
    // The stroke must reach the outside of the target boundary. Points that
    // merely run through the target interior are not a container side.
    if (outward === "min" && outermost > side + 0.5) return 0;
    if (outward === "max" && outermost < side - 0.5) return 0;
    const values = sidePoints
      .map((point) => Number(point[alongAxis]))
      .filter(Number.isFinite);
    return values.length > 1 ? Math.max(...values) - Math.min(...values) : 0;
  };
  // The endpoint must have all four sides. A simple stroke through the text
  // has no top/bottom enclosure and therefore cannot create a Trace.
  return projectedSpan(top, "y", "x", "min") >= width * 0.45
    && projectedSpan(bottom, "y", "x", "max") >= width * 0.45
    && projectedSpan(left, "x", "y", "min") >= height * 0.45
    && projectedSpan(right, "x", "y", "max") >= height * 0.45;
};

const withoutTemporarySmartPenStrokes = (annotations = {}) => Object.fromEntries(
  Object.entries(annotations || {}).map(([page, pageAnnotations]) => [
    page,
    (pageAnnotations || []).filter((annotation) => !annotation?.smartPen),
  ]),
);
const hasTemporarySmartPenStrokes = (storedLayers) => {
  const annotationMaps = Array.isArray(storedLayers)
    ? storedLayers.map((layer) => layer?.annotations || {})
    : [storedLayers || {}];
  return annotationMaps.some((annotations) => Object.values(annotations).some(
    (pageAnnotations) => (pageAnnotations || []).some((annotation) => annotation?.smartPen),
  ));
};

const hasSmartPenFourDTraceScribble = (stroke, targetRecords) => {
  if (!targetRecords.length || !Array.isArray(stroke?.points)) return false;
  const left = Math.min(...targetRecords.map((record) => record.left));
  const right = Math.max(...targetRecords.map((record) => record.right));
  const top = Math.min(...targetRecords.map((record) => record.top));
  const bottom = Math.max(...targetRecords.map((record) => record.bottom));
  const width = right - left;
  const height = bottom - top;
  if (width <= 0 || height <= 0) return false;

  // A 4D gesture is the existing directional container followed by an
  // interior scribble. Boundary-only rectangles remain 3D. Requiring the
  // scribble to occupy the interior and reverse direction several times
  // avoids treating the rectangle's closing side as a temporal gesture.
  const innerLeft = left + width * 0.18;
  const innerRight = right - width * 0.18;
  const innerTop = top + height * 0.18;
  const innerBottom = bottom - height * 0.18;
  const interior = stroke.points
    .map((point, index) => ({ point, index }))
    .filter(({ point }) => (
      Number(point.x) >= innerLeft
      && Number(point.x) <= innerRight
      && Number(point.y) >= innerTop
      && Number(point.y) <= innerBottom
    ));
  if (interior.length < 6) return false;

  const interiorPoints = interior.map(({ point }) => point);
  const interiorWidth = Math.max(...interiorPoints.map((point) => Number(point.x))) - Math.min(...interiorPoints.map((point) => Number(point.x)));
  const interiorHeight = Math.max(...interiorPoints.map((point) => Number(point.y))) - Math.min(...interiorPoints.map((point) => Number(point.y)));
  if (interiorWidth < width * 0.38 || interiorHeight < height * 0.28) return false;

  let pathLength = 0;
  let directionChanges = 0;
  let previousDirection = null;
  for (let index = 1; index < interiorPoints.length; index += 1) {
    const dx = Number(interiorPoints[index].x) - Number(interiorPoints[index - 1].x);
    const dy = Number(interiorPoints[index].y) - Number(interiorPoints[index - 1].y);
    const segmentLength = Math.hypot(dx, dy);
    if (segmentLength < 0.5) continue;
    pathLength += segmentLength;
    const direction = Math.abs(dx) >= Math.abs(dy) ? Math.sign(dx) : Math.sign(dy) * 2;
    if (previousDirection !== null && direction !== previousDirection) directionChanges += 1;
    previousDirection = direction;
  }
  return pathLength >= Math.max(width, height) * 0.9 && directionChanges >= 3;
};

const getSmartPenDirectionalTraceRecords = (stroke, spans, schemaRecords) => {
  const covered = getSmartPenCoveredSpanRecords(stroke, spans);
  if (!covered.length || !Array.isArray(stroke?.points) || stroke.points.length < 2) return [];
  const first = stroke.points[0];
  const last = stroke.points[stroke.points.length - 1];
  const distance = (point, record) => Math.hypot(record.centerX - point.x, record.centerY - point.y);
  const sourceCandidates = spans
    .map((span) => {
      const word = cleanSchemaWord(span?.text);
      const left = Math.min(Number(span?.pageLeft), Number(span?.pageRight));
      const right = Math.max(Number(span?.pageLeft), Number(span?.pageRight));
      const top = Number(span?.pageTop);
      const bottom = Number(span?.pageBottom);
      return { word, left, right, top, bottom, centerX: (left + right) / 2, centerY: (top + bottom) / 2 };
    })
    .filter((record) => (
      record.word
      && schemaRecords.has(schemaWordKey(record.word))
      && [record.left, record.right, record.top, record.bottom].every(Number.isFinite)
      && first.x >= record.left - 1.5
      && first.x <= record.right + 1.5
      && first.y >= record.top - 1.5
      && first.y <= record.bottom + 1.5
    ));
  if (!sourceCandidates.length) return [];

  // The stroke must begin inside the existing Schema word. The far endpoint
  // is therefore always the last point, preserving the user's direction.
  const source = sourceCandidates.sort((a, b) => distance(first, a) - distance(first, b))[0];
  const sourcePoint = first;
  const farPoint = last;
  const farCandidates = covered
    .filter((record) => !schemaRecords.has(schemaWordKey(record.word)))
    .map((record) => ({ record, farDistance: distance(farPoint, record), sourceDistance: distance(sourcePoint, record) }))
    .filter(({ farDistance, sourceDistance }) => farDistance < sourceDistance)
    .sort((a, b) => a.farDistance - b.farDistance);
  if (!farCandidates.length) return [];

  // Keep the complete contiguous far-end word group. Distance from the final
  // point alone is sufficient for one word, but it drops the other words in a
  // phrase because their centers are naturally farther from the closing
  // corner of the container.
  const nearestFar = farCandidates[0].record;
  const targetLineTolerance = Math.max(
    4,
    (source.bottom - source.top) * 1.25,
    (nearestFar.bottom - nearestFar.top) * 1.25,
  );
  const sameLineCandidates = farCandidates
    .filter(({ record }) => Math.abs(record.centerY - nearestFar.centerY) <= targetLineTolerance)
    .sort((a, b) => a.record.left - b.record.left);
  const nearestIndex = sameLineCandidates.findIndex(({ record }) => record === nearestFar);
  if (nearestIndex < 0) return [];
  const gapLimit = Math.max(6, (source.bottom - source.top) * 1.8);
  let start = nearestIndex;
  let end = nearestIndex;
  while (start > 0) {
    const previous = sameLineCandidates[start - 1].record;
    const current = sameLineCandidates[start].record;
    if (current.left - previous.right > gapLimit) break;
    start -= 1;
  }
  while (end >= 0 && end < sameLineCandidates.length - 1) {
    const current = sameLineCandidates[end].record;
    const next = sameLineCandidates[end + 1].record;
    if (next.left - current.right > gapLimit) break;
    end += 1;
  }
  const targetRecords = sameLineCandidates.slice(Math.max(0, start), end + 1).map(({ record }) => record);
  if (!isSmartPenRectangularEndpoint(stroke, targetRecords)) return [];
  const traceDimension = hasSmartPenFourDTraceScribble(stroke, targetRecords) ? "4D" : "3D";
  return targetRecords.map((target) => ({ source, target, traceDimension }));
};

const RAW_COLUMN_NOTES = {
  ID: "Stable identifier assigned to the extracted Tesseract word row.",
  PAGE: "PDF page number that produced this Tesseract row.",
  LEVEL: "Tesseract TSV hierarchy level. Word rows are level 5.",
  ENGINE: "OCR engine used to produce this row.",
  "COORDINATE SPACE": "Coordinate system for the OCR geometry: rendered page pixels.",
  STRING: "PDF.js row type. This row represents one PDF.js text item, not necessarily one word or one visual line.",
  VALUE: "The exact text in TextItem.str. It is the text PDF.js exposes for copy, search, and text-layer construction.",
  TX: "Transformed text-origin X in page coordinates. This is the baseline origin after the page viewport transform is applied.",
  TY: "Transformed text-origin Y in page coordinates. This is normally the baseline origin, so it is usually below the visible top of the glyphs.",
  X: "Visible text-box left X in page coordinates. It is derived from the transformed origin and font ascent.",
  Y: "Visible text-box top Y in page coordinates. It is derived from the baseline minus the font ascent.",
  "FONT SIZE": "Per-item font size in page units, calculated from the transformed text matrix vertical axis.",
  TOP: "Top of the extracted visible text box. PDF.js does not provide a separate leading line, so this equals the ascent line here.",
  ASCENT: "Ascent line in page coordinates. It is the baseline moved upward by the PDF.js font ascent ratio.",
  BASELINE: "Baseline in page coordinates. PDF text is positioned from this line; it is not the top edge of the letters.",
  DESCENT: "Descent line in page coordinates. It is the baseline moved downward using the font descent metric.",
  BOTTOM: "Bottom of the extracted text box. It is based on the item height and is distinct from the baseline.",
  "FONT FAMILY": "PDF.js generic family classification or resolved fallback family. Embedded PDFs may not expose the exact original typeface name.",
  WEIGHT: "Detected font weight from the resolved PDF.js font object. Bold/black detection can be unavailable for unresolved fonts.",
  STYLE: "Detected font style from the resolved PDF.js font object, normally normal or italic.",
  "FONT NAME": "Internal PDF.js font resource name, often a subset identifier rather than a human-readable font name.",
  DIR: "Text direction reported by PDF.js, such as ltr or rtl.",
  EOL: "PDF.js hasEOL flag. It indicates that this text item is marked as ending a text line in the extracted content.",
  ROTATION: "Text angle in degrees, calculated from the original transform matrix.",
  "SCALE X": "Horizontal scale magnitude from the original transform matrix. It includes the text matrix's horizontal sizing.",
  "SCALE Y": "Vertical scale magnitude from the original transform matrix. It commonly corresponds closely to the font size.",
  "CHAR COUNT": "Number of Unicode code points in VALUE. This counts characters rather than UTF-16 code units.",
  WHITESPACE: "True when VALUE contains no non-whitespace characters. Whitespace items may still have geometry.",
  CODEPOINTS: "Unicode code points for VALUE, displayed as U+ hexadecimal values.",
  "ORIGINAL A": "A from the raw PDF.js TextItem.transform matrix, before the page viewport transform.",
  "ORIGINAL B": "B from the raw PDF.js TextItem.transform matrix, before the page viewport transform.",
  "ORIGINAL C": "C from the raw PDF.js TextItem.transform matrix, before the page viewport transform.",
  "ORIGINAL D": "D from the raw PDF.js TextItem.transform matrix, before the page viewport transform.",
  "ORIGINAL E": "E from the raw PDF.js TextItem.transform matrix. It is the raw PDF text origin X component.",
  "ORIGINAL F": "F from the raw PDF.js TextItem.transform matrix. It is the raw PDF text origin Y component.",
  "FULL A": "A from the combined page viewport transform and text-item transform. This is used for rendered page geometry.",
  "FULL B": "B from the combined page viewport transform and text-item transform.",
  "FULL C": "C from the combined page viewport transform and text-item transform.",
  "FULL D": "D from the combined page viewport transform and text-item transform.",
  "FULL E": "E from the combined page viewport transform and text-item transform. It is the transformed origin X component.",
  "FULL F": "F from the combined page viewport transform and text-item transform. It is the transformed origin Y component.",
  "RAW WIDTH": "The width supplied directly by PDF.js TextItem.width, before viewport normalization.",
  "RAW HEIGHT": "The height supplied directly by PDF.js TextItem.height, before viewport normalization. Some PDFs leave this unset.",
  "PAGE WIDTH": "Text-item width converted into the page coordinate system used by this RAW table.",
  "PAGE HEIGHT": "Text-item height converted into the page coordinate system used by this RAW table.",
  "SOURCE ORDER": "The PDF.js content-stream order for this text item. This is the current Instance # and does not necessarily match its visual left-to-right position on the page.",
  "VISUAL ORDER": "One-based rank after spatial sorting by page Y and then page X. This derived order describes page placement without changing PDF.js source order.",
  "DELTA X": "This item's X minus the previous PDF.js source item's X. A positive value moves right; a negative value moves left.",
  "ITEM FLOW": "Derived X direction for the consecutive source items in this visual Y band: ascending-X, descending-X, or mixed.",
  CLASS: "Application classification inferred from text, size, position, and geometry. It is not a native PDF.js semantic tag.",
  OMISSION: "Unicode general category/categories represented by this instance, with a Unicode character name when known. Checking the box omits the instance from Visual rendering.",
  "READING STATUS": "INCLUDED means the PDF.js string participates in selectable and reconstructed reading text. OMITTED means its full page rectangle is contained by one or more persisted Omission BBoxes; the row remains visible here for diagnosis.",
  "BLOCK #": "One-based order of the saved Block BBox on this PDF page.",
  "LINE REFERENCES": "MD Viewer line IDs containing at least one PDF.js string selected by this saved Block BBox.",
  "STRING REFERENCES": "PDF.js string instance numbers selected by this saved Block BBox. Membership requires horizontal intersection and at least 50% vertical coverage.",
  TYPE: "OCR block type supplied by the OCR service, such as title, heading, header, or paragraph.",
  HEADING: "True when the OCR block type is treated as heading-like for rendering.",
  WRAP: "Whether the imported OCR text is allowed to wrap inside its mapped bounding box.",
  "OCR SOURCE": "Indicates that the value came from persisted OCR output rather than native PDF.js text extraction.",
  "SOURCE PAGE": "The original PDF page from which this OCR fragment was imported.",
  ALIGN: "Text alignment assigned to the imported OCR fragment.",
  "TEXT BASELINE": "Text baseline mode used when rendering this OCR fragment.",
  PADDING: "Internal annotation padding value used by the OCR companion renderer.",
  CONFIDENCE: "OCR confidence reported by the engine when available. It is not a calibrated probability; Tesseract commonly reports 0 to 100.",
  BLOCK: "Tesseract block number from its TSV output.",
  PARAGRAPH: "Tesseract paragraph number within the block from its TSV output.",
  LINE: "Tesseract line number within the paragraph from its TSV output.",
  WORD: "Tesseract word number within the line from its TSV output.",
  "TESSERACT SOURCE": "Indicates that the row came from Tesseract OCR output.",
  "BLOCK ID": "The stable block identifier assigned while the OCR page was normalized and persisted.",
};

const TESSERACT_COLUMN_NOTES = {
  ID: "Stable identifier assigned to this Tesseract TSV word row.",
  "INSTANCE #": "Sequential instance number for this Tesseract OCR row on the currently displayed page.",
  VALUE: "The exact recognized word returned in the Tesseract TSV text field.",
  PAGE: "One-based PDF page number rendered and processed by Tesseract.",
  LEVEL: "The original Tesseract TSV hierarchy level: 1 page, 2 block, 3 paragraph, 4 line, and 5 recognized word.",
  X: "Left coordinate of the recognized word in the rendered image, measured in pixels from the page's left edge.",
  Y: "Top coordinate of the recognized word in the rendered image, measured in pixels from the page's top edge.",
  WIDTH: "Width of the recognized word bounding box in rendered image pixels.",
  HEIGHT: "Height of the recognized word bounding box in rendered image pixels.",
  "PAGE WIDTH": "Width of the rendered OCR image in pixels. This is the coordinate-space width for X and WIDTH.",
  "PAGE HEIGHT": "Height of the rendered OCR image in pixels. This is the coordinate-space height for Y and HEIGHT.",
  CONFIDENCE: "Tesseract's recognition confidence for this word, normally reported from 0 to 100. It is not a calibrated probability.",
  ENGINE: "OCR engine that produced the row. The current engine is Tesseract.",
  "COORDINATE SPACE": "Geometry coordinate system used by Tesseract: rendered page pixels with origin at the top-left.",
  BLOCK: "Tesseract block_num identifying the layout block containing this word.",
  PARAGRAPH: "Tesseract par_num identifying the paragraph within the layout block.",
  LINE: "Tesseract line_num identifying the text line within the paragraph.",
  WORD: "Tesseract word_num identifying the word position within the line.",
  "TESSERACT SOURCE": "Source label confirming that the row came from Tesseract OCR rather than PDF.js text extraction.",
};

const RawColumnHeader = ({ label, notes }) => (
  <span className="pdf_ocr_blank_raw_column_header">
    <span>{label}</span>
    <InfoPopupButton info={notes || RAW_COLUMN_NOTES[label] || label} label={`${label} column note`} />
  </span>
);

const formatSignedRotation = (value) => {
  if (!Number.isFinite(value)) return "-";
  const rounded = Number(value.toFixed(2));
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(2)}°`;
};

const VALID_MARKDOWN_ASIDE_MODES = new Set(["raw", "visual-only", "visual-raw", "tree-lines"]);
const VALID_MARKDOWN_VISUAL_MODES = new Set(["visual-only", "visual-raw"]);
const VALID_MARKDOWN_COLUMN_GROUPS = new Set(["text", "position", "font", "transform", "blocks"]);
const VALID_MARKDOWN_SPACING_TARGETS = new Set(["str", "line", "paragraph"]);
const VALID_NOTEBOOK_MODES = new Set(["notebook-only", "notebook-pdf", "notebook-md", "notebook-pdf-md"]);

const UNICODE_CHARACTER_NAMES = {
  "\u003C": "LESS-THAN SIGN",
  "\u003E": "GREATER-THAN SIGN",
  "\u002B": "PLUS SIGN",
  "\u002D": "HYPHEN-MINUS",
  "\u003D": "EQUALS SIGN",
  "\u002A": "ASTERISK",
  "\u002F": "SOLIDUS",
  "\u00B1": "PLUS-MINUS SIGN",
  "\u00D7": "MULTIPLICATION SIGN",
  "\u00F7": "DIVISION SIGN",
  "\u2022": "BULLET",
  "\u2023": "TRIANGULAR BULLET",
  "\u2043": "HYPHEN BULLET",
  "\u25A0": "BLACK SQUARE",
  "\u25AA": "BLACK SMALL SQUARE",
  "\u25AB": "WHITE SMALL SQUARE",
  "\u25CF": "BLACK CIRCLE",
  "\u25E6": "WHITE BULLET",
  "\u221E": "INFINITY",
  "\u221A": "SQUARE ROOT",
};

const getUnicodeGeneralCategory = (character) => {
  if (/\p{Lu}/u.test(character)) return "Lu";
  if (/\p{Ll}/u.test(character)) return "Ll";
  if (/\p{Lt}/u.test(character)) return "Lt";
  if (/\p{Nd}/u.test(character)) return "Nd";
  if (/\p{Z}/u.test(character)) return "Zs";
  if (/\p{P}/u.test(character)) return "P";
  if (/\p{Sc}/u.test(character)) return "Sc";
  if (/\p{Sk}/u.test(character)) return "Sk";
  if (/\p{Sm}/u.test(character)) return "Sm";
  if (/\p{So}/u.test(character)) return "So";
  if (/\p{M}/u.test(character)) return "M";
  return "Cn";
};

const getUnicodeOmissionLabel = (value) => {
  const characters = Array.from(String(value || "").trim());
  if (!characters.length) return "-";
  const categories = [...new Set(characters.map(getUnicodeGeneralCategory))];
  const names = [...new Set(characters.map((character) => UNICODE_CHARACTER_NAMES[character]).filter(Boolean))];
  return `${categories.join(", ")}${names.length ? ` (${names.join(", ")})` : ""}`;
};

const SegmentBuilderClosedEyeIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="m21.95 12.32-1.9-.64C19.98 11.9 18.16 17 12 17s-7.98-5.1-8.05-5.32l-1.9.63s.28.8.93 1.81L.7 15.85l1.21 1.6 2.3-1.74c.58.62 1.29 1.24 2.16 1.77l-1.51 2.48L6.57 21l1.62-2.65c.83.3 1.78.5 2.82.59v3.05h2v-3.05c1.05-.08 1.99-.29 2.82-.59L17.45 21l1.71-1.04-1.51-2.48c.87-.53 1.58-1.15 2.16-1.77l2.3 1.74 1.21-1.6-2.28-1.73c.65-1.01.92-1.79.93-1.81Z" />
  </svg>
);

const SegmentBuilderOpenEyeIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M12 8a4 4 0 1 0 0 8 4 4 0 1 0 0-8" />
    <path d="M12 4c-7.67 0-9.94 7.65-9.96 7.73-.05.18-.05.37 0 .55.02.08 2.3 7.73 9.96 7.73s9.94-7.65 9.96-7.73c.05-.18.05-.37 0-.55C21.94 11.65 19.66 4 12 4m0 14c-5.47 0-7.51-4.77-7.95-6 .44-1.23 2.48-6 7.95-6s7.51 4.78 7.95 6c-.44 1.23-2.48 6-7.95 6" />
  </svg>
);

const OCR_COMPANION_SERVICES = "Tesseract · pdftoppm";
const TESSERACT_COMPANION_SERVICES = "Tesseract · pdftoppm";
const RAW_COMPANION_SERVICES = "PDF.js Native Text";
const VISUAL_RAW_COMPANION_SERVICES = "PDF.js Visual Text";
// Matches the backend's ConceptExtractRequestSchema surfaceText.max(2000) —
// truncated client-side too so an overly ambitious multi-screenshot capture
// fails softly (a shorter search) instead of a 400 from the API.
const SMART_VIDEO_MAX_SURFACE_TEXT = 2000;
// Pinch-to-zoom (touch, and trackpad pinch which browsers deliver as ctrl+wheel)
// is intentionally unbounded above MIN_ZOOM/MAX_ZOOM — this floor only exists so
// the zoom value can never hit 0 or go negative, which would divide-by-zero the
// viewport/scale math elsewhere.
const PINCH_ZOOM_FLOOR = 0.02;
const RAW_Y_COLOR_PALETTE = [
  "#fee2e2", "#dbeafe", "#dcfce7", "#fef3c7", "#ede9fe", "#fce7f3",
  "#cffafe", "#ffedd5", "#e2e8f0", "#fef9c3", "#dbeafe", "#d1fae5",
];
const IBM_PLEX_MONO_FONT = '"IBM Plex Mono", ui-monospace, monospace';
const getRawVisibleHeight = (row) => {
  const top = Number(row?.top);
  const bottom = Number(row?.bottom);
  if (Number.isFinite(top) && Number.isFinite(bottom) && bottom > top) return bottom - top;
  return Math.max(1, Number(row?.height) || Number(row?.fontSize) || 1);
};
const OCR_BLANK_TITLE_MIN_SCALE = 0.82;
const OCR_BLANK_HEADER_FONT_SIZE = 10;
const OCR_BLANK_HEADER_TOP = 8;
const OCR_BLANK_HEADER_RIGHT = 10;
const OCR_BLANK_HEADER_PAD_Y = 3;
const OCR_BLANK_HEADER_PAD_X = 7;
const OCR_BLANK_FOOTER_FONT_SIZE = 10;
const OCR_BLANK_FOOTER_PAD_TOP = 8;
const OCR_BLANK_FOOTER_PAD_X = 13;
const OCR_BLANK_FOOTER_PAD_BOTTOM = 10;
const OCR_BLANK_FOOTER_LINE_HEIGHT = 1.2;
const EMPTY_AREA_MIN_WIDTH = 36;
const EMPTY_AREA_MIN_HEIGHT = 18;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const roundZoom = (value) => Math.round(value * 100) / 100;
const normalizeZoom = (value) => clamp(roundZoom(value), MIN_ZOOM, MAX_ZOOM);
const normalizePinchZoom = (value) => Math.max(PINCH_ZOOM_FLOOR, roundZoom(value));
const classifyPdfJsTextItem = ({ value, x = 0, y = 0, width = 0, height = 0, pageWidth = 1, pageHeight = 1, medianHeight = 0 }) => {
  const text = String(value || "");
  const trimmed = text.trim();
  const topRatio = pageHeight > 0 ? y / pageHeight : 0;
  const bottomRatio = pageHeight > 0 ? (y + height) / pageHeight : 0;
  const leftRatio = pageWidth > 0 ? x / pageWidth : 0;
  const centerX = x + (width / 2);
  const centerRatio = pageWidth > 0 ? centerX / pageWidth : 0.5;
  const isNearHorizontalCenter = centerRatio >= 0.38 && centerRatio <= 0.62;
  const isLargeText = medianHeight > 0 ? height >= medianHeight * 1.45 : height >= 16;
  const isSmallText = medianHeight > 0 ? height <= medianHeight * 0.85 : height <= 8;
  if (!trimmed) return "empty";
  if (/^\d+$/.test(trimmed) && (topRatio <= 0.1 || bottomRatio >= 0.9) && isNearHorizontalCenter) return "page number";
  if (topRatio <= 0.12 && (isSmallText || trimmed.length <= 50)) return "header";
  if (bottomRatio >= 0.88 && (isSmallText || trimmed.length <= 70)) return "footer";
  if (/^[\u25A0\u25AA\u25AB\u25CF\u25E6\u2022]$/.test(trimmed)) return "square bullet";
  if (/^[<>]$/.test(trimmed)) return "math/operator";
  if (/^[\p{P}\p{S}]+$/u.test(trimmed)) return "punctuation";
  if (/^(fig|figure|table|chapter|section|appendix)\b[:.\s-]*/i.test(trimmed)) return "label";
  if (isLargeText && (isNearHorizontalCenter || leftRatio <= 0.2) && trimmed.length <= 120) return "title";
  if (/^[A-Z0-9\s\-–—/&(),.:;%]+$/.test(trimmed) && /[A-Z]/.test(trimmed) && trimmed.length <= 80) return "all-caps heading";
  if (/^#{1,6}\s+/.test(trimmed)) return "markdown heading";
  if (/^[\u2022\u25AA\u25CF\u25E6\-*]\s+/.test(trimmed)) return "bullet";
  if (/^\(?\d+(\.\d+)*\)?[:.)\s-]/.test(trimmed)) return "numbered item";
  if (/^[A-Za-z][A-Za-z\s/-]{0,40}:\s*$/.test(trimmed)) return "field label";
  if (/^\d+(?:[.,]\d+)?(?:\s*(?:%|mg|g|kg|mcg|mm|cm|mL|L|bpm|mmHg|ms|sec|min|hr|yrs?))?$/i.test(trimmed)) return "numeric";
  if (/^[A-Z][A-Za-z0-9\s,;:'"()\-/%]+$/.test(trimmed) && trimmed.length <= 60 && !/[.?!]$/.test(trimmed)) return "title fragment";
  if (/[.?!:]$/.test(trimmed) || trimmed.split(/\s+/).length >= 8) return "paragraph fragment";
  return "text fragment";
};

const computeEmptyTextRects = (rows, pageWidth, pageHeight) => {
  if (!Number.isFinite(pageWidth) || !Number.isFinite(pageHeight) || pageWidth <= 0 || pageHeight <= 0) return [];
  const rawItems = (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const x = Math.max(0, Number(row?.x) || 0);
      const y = Math.max(0, Number(row?.y) || 0);
      const width = Math.max(0, Number(row?.width) || 0);
      const height = Math.max(0, Number(row?.height) || 0);
      if (!width || !height) return null;
      return {
        x1: clamp(x, 0, pageWidth),
        y1: clamp(y, 0, pageHeight),
        x2: clamp(x + width, 0, pageWidth),
        y2: clamp(y + height, 0, pageHeight),
        height,
        midY: y + (height / 2),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.midY - b.midY || a.x1 - b.x1);
  const rowHeights = rawItems.map((item) => item.height).sort((a, b) => a - b);
  const medianHeight = rowHeights[Math.floor(rowHeights.length / 2)] || 10;
  const lineTolerance = clamp(medianHeight * 0.7, 4, 18);
  const linePadX = clamp(medianHeight * 0.9, 8, 28);
  const linePadY = clamp(medianHeight * 0.55, 4, 18);
  const lines = [];
  rawItems.forEach((item) => {
    const line = lines.find((candidate) => Math.abs(candidate.midY - item.midY) <= lineTolerance);
    if (!line) {
      lines.push({
        midY: item.midY,
        x1: item.x1,
        y1: item.y1,
        x2: item.x2,
        y2: item.y2,
        count: 1,
      });
      return;
    }
    line.x1 = Math.min(line.x1, item.x1);
    line.y1 = Math.min(line.y1, item.y1);
    line.x2 = Math.max(line.x2, item.x2);
    line.y2 = Math.max(line.y2, item.y2);
    line.midY = ((line.midY * line.count) + item.midY) / (line.count + 1);
    line.count += 1;
  });
  const occupied = lines
    .map((line) => ({
      x1: clamp(line.x1 - linePadX, 0, pageWidth),
      y1: clamp(line.y1 - linePadY, 0, pageHeight),
      x2: clamp(line.x2 + linePadX, 0, pageWidth),
      y2: clamp(line.y2 + linePadY, 0, pageHeight),
    }))
    .sort((a, b) => a.y1 - b.y1 || a.x1 - b.x1)
    .reduce((merged, rect) => {
      const last = merged[merged.length - 1];
      if (
        last
        && rect.y1 <= (last.y2 + linePadY)
        && rect.x1 <= (last.x2 + linePadX)
        && rect.x2 >= (last.x1 - linePadX)
      ) {
        last.x1 = Math.min(last.x1, rect.x1);
        last.y1 = Math.min(last.y1, rect.y1);
        last.x2 = Math.max(last.x2, rect.x2);
        last.y2 = Math.max(last.y2, rect.y2);
        return merged;
      }
      merged.push({ ...rect });
      return merged;
    }, []);
  if (!occupied.length) return [{ x: 0, y: 0, w: pageWidth, h: pageHeight }];

  const yBreaks = Array.from(new Set([0, pageHeight, ...occupied.flatMap((rect) => [rect.y1, rect.y2])]))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const emptyRects = [];
  for (let i = 0; i < yBreaks.length - 1; i += 1) {
    const bandTop = yBreaks[i];
    const bandBottom = yBreaks[i + 1];
    const bandHeight = bandBottom - bandTop;
    if (bandHeight < EMPTY_AREA_MIN_HEIGHT) continue;
    const intervals = occupied
      .filter((rect) => rect.y1 < bandBottom && rect.y2 > bandTop)
      .map((rect) => [rect.x1, rect.x2])
      .sort((a, b) => a[0] - b[0]);
    const merged = [];
    intervals.forEach(([start, end]) => {
      const last = merged[merged.length - 1];
      if (!last || start > last[1]) merged.push([start, end]);
      else last[1] = Math.max(last[1], end);
    });
    let cursor = 0;
    merged.forEach(([start, end]) => {
      if ((start - cursor) >= EMPTY_AREA_MIN_WIDTH) {
        emptyRects.push({ x: cursor, y: bandTop, w: start - cursor, h: bandHeight });
      }
      cursor = Math.max(cursor, end);
    });
    if ((pageWidth - cursor) >= EMPTY_AREA_MIN_WIDTH) {
      emptyRects.push({ x: cursor, y: bandTop, w: pageWidth - cursor, h: bandHeight });
    }
  }
  return emptyRects.reduce((merged, rect) => {
    const last = merged[merged.length - 1];
    if (
      last
      && Math.abs(last.x - rect.x) <= 1
      && Math.abs(last.w - rect.w) <= 1
      && Math.abs((last.y + last.h) - rect.y) <= 1
    ) {
      last.h += rect.h;
      return merged;
    }
    merged.push({ ...rect });
    return merged;
  }, []);
};
// Mirrors PDF.js TextLayer's own ascent fallback. Using a fixed 0.8 ratio
// shifts boxes vertically for fonts whose embedded metrics differ.
const getPdfTextAscentRatio = (style) => {
  if (Number.isFinite(style?.ascent)) return style.ascent;
  if (Number.isFinite(style?.descent)) return 1 + style.descent;
  return 0.8;
};
// Effort scales with how far the CURRENT zoom already is from the natural
// 1.0 (100%) point — like a real lens/zoom ring, each further step gets
// progressively harder to turn rather than staying uniformly sensitive
// across the whole range. log(zoom) makes it symmetric between zooming in
// and zooming out (zoom=2 and zoom=0.5 apply the same resistance). Shared
// by every zoom path (pinch, ctrl+scroll, held +/- buttons) so "how it
// feels to zoom" is consistent no matter which input drives it. Stiff
// enough that reaching an extreme zoom (500%+) takes real, deliberate
// effort rather than a single aggressive pinch — at 1.5 a big finger-spread
// could still fling the page to 1000%+ in one gesture, which read as
// physically unrealistic (a real lens doesn't behave like that).
const ZOOM_RESISTANCE = 4;
const dynamicZoomGain = (baseGain, currentZoom) => baseGain / (1 + ZOOM_RESISTANCE * Math.abs(Math.log(currentZoom)));
// Held +/- zoom buttons: tick rate, and how fast/how far the per-tick step
// accelerates the longer the button stays down (see startZoomHold).
const ZOOM_HOLD_TICK_MS = 48;
const ZOOM_HOLD_RAMP_MS = 1800;
const ZOOM_HOLD_MAX_MULTIPLIER = 8;
const LIVE_ZOOM_COMMIT_MS = 140;

// ── Momentum ("billiard ball") panning ──────────────────────────────────────
// After a drag/pan is released fast enough, the scroll container keeps
// coasting in the same direction and decelerates smoothly to a stop, instead
// of snapping dead the instant the finger/mouse lifts.
const MOMENTUM_MAX_VELOCITY = 3;     // px/ms — caps an extreme flick
const MOMENTUM_MIN_VELOCITY = 0.015; // px/ms — below this we call it stopped
const MOMENTUM_FLICK_MIN    = 0.08;  // px/ms — release speed under this doesn't coast at all
const MOMENTUM_FRICTION     = 0.98;  // velocity retained per ~16ms frame — higher = longer, gentler glide

// Rather than blending every single move sample into a running average (which
// lags behind quick direction changes and is thrown off by one slow sample
// right before release), keep a short rolling window of recent {x, y, t}
// samples and measure velocity across that whole window at release time —
// the same trick native pan-gesture recognizers use.
const VELOCITY_WINDOW_MS = 80;
const createVelocityTracker = () => {
  let samples = [];
  return {
    reset() { samples = []; },
    push(x, y, t) {
      samples.push({ x, y, t });
      const cutoff = t - VELOCITY_WINDOW_MS;
      while (samples.length > 1 && samples[0].t < cutoff) samples.shift();
    },
    velocity() {
      if (samples.length < 2) return { vx: 0, vy: 0 };
      const first = samples[0];
      const last = samples[samples.length - 1];
      const dt = last.t - first.t;
      if (dt <= 0) return { vx: 0, vy: 0 };
      return { vx: (last.x - first.x) / dt, vy: (last.y - first.y) / dt };
    },
  };
};

const stopMomentumScroll = (frameRef) => {
  if (frameRef.current) {
    cancelAnimationFrame(frameRef.current);
    frameRef.current = 0;
  }
};

const stopLivePan = (stateRef) => {
  if (stateRef.current.frame) {
    cancelAnimationFrame(stateRef.current.frame);
    stateRef.current.frame = 0;
  }
};

const syncLivePan = (el, stateRef) => {
  const state = stateRef.current;
  const maxL = Math.max(0, el.scrollWidth - el.clientWidth);
  const maxT = Math.max(0, el.scrollHeight - el.clientHeight);
  state.currentL = clamp(state.targetL, 0, maxL);
  state.currentT = clamp(state.targetT, 0, maxT);
  el.scrollLeft = state.currentL;
  el.scrollTop = state.currentT;
};

const runLivePan = (el, stateRef) => {
  if (stateRef.current.frame) return;
  stateRef.current.frame = requestAnimationFrame(() => {
    stateRef.current.frame = 0;
    const state = stateRef.current;
    const maxL = Math.max(0, el.scrollWidth - el.clientWidth);
    const maxT = Math.max(0, el.scrollHeight - el.clientHeight);
    state.currentL = clamp(state.targetL, 0, maxL);
    state.currentT = clamp(state.targetT, 0, maxT);
    el.scrollLeft = state.currentL;
    el.scrollTop = state.currentT;
  });
};

const runMomentumScroll = (el, vx, vy, frameRef) => {
  stopMomentumScroll(frameRef);
  let velX = clamp(vx, -MOMENTUM_MAX_VELOCITY, MOMENTUM_MAX_VELOCITY);
  let velY = clamp(vy, -MOMENTUM_MAX_VELOCITY, MOMENTUM_MAX_VELOCITY);
  // Track position as floats, independent of el.scrollLeft/Top (which the
  // browser rounds to whole pixels). Reading the rounded value back as next
  // frame's basis would drop any sub-pixel motion — most of the tail of a
  // decelerating coast is sub-pixel-per-frame — producing a visibly stepped
  // crawl instead of a smooth glide.
  let posL = el.scrollLeft;
  let posT = el.scrollTop;
  let lastT = performance.now();
  const step = (t) => {
    const dt = Math.min(48, t - lastT); // guard against a big gap (e.g. tab switch)
    lastT = t;
    const decay = Math.pow(MOMENTUM_FRICTION, dt / 16);
    velX *= decay;
    velY *= decay;
    if (Math.hypot(velX, velY) < MOMENTUM_MIN_VELOCITY) { frameRef.current = 0; return; }
    posL -= velX * dt;
    posT -= velY * dt;
    // Clamp against the real scrollable range instead of comparing rounded
    // scrollLeft/Top before/after — that comparison is also (wrongly) true
    // whenever a sub-pixel delta rounds to the same integer, which would kill
    // velocity on a whim rather than only at an actual edge.
    const maxL = el.scrollWidth  - el.clientWidth;
    const maxT = el.scrollHeight - el.clientHeight;
    const clampedL = clamp(posL, 0, maxL);
    const clampedT = clamp(posT, 0, maxT);
    if (clampedL !== posL) { posL = clampedL; velX = 0; }
    if (clampedT !== posT) { posT = clampedT; velY = 0; }
    el.scrollLeft = posL;
    el.scrollTop  = posT;
    if (velX === 0 && velY === 0) { frameRef.current = 0; return; }
    frameRef.current = requestAnimationFrame(step);
  };
  frameRef.current = requestAnimationFrame(step);
};
const normalizeOcrText = (text) => (
  (text || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
);
// Backend error responses put validation specifics in a top-level
// `details` array (e.g. { error: "Invalid request.", details: [...] }) —
// both a plain `error` string and an { message } object shape exist across
// routes (see ConceptsAPI.js/YouTubeAPI.js vs. AIAPI.js's own convention),
// so this handles both instead of silently dropping `details` the way a
// bare `error.message` fallback would.
const describeApiError = (data, fallback) => {
  const base = typeof data?.error === "string" ? data.error : data?.error?.message || fallback;
  const details = Array.isArray(data?.details) ? data.details : null;
  return details?.length ? `${base} ${details.join("; ")}` : base;
};
const MAX_RENDER_CANVAS_DIMENSION = 8192;
const MAX_RENDER_CANVAS_PIXELS = 16777216;
const getSafeCanvasOutputScale = (width, height, deviceScale = window.devicePixelRatio || 1) => {
  const dimLimitedScale = Math.min(
    deviceScale,
    MAX_RENDER_CANVAS_DIMENSION / Math.max(1, width),
    MAX_RENDER_CANVAS_DIMENSION / Math.max(1, height),
  );
  const areaLimitedScale = Math.min(
    deviceScale,
    Math.sqrt(MAX_RENDER_CANVAS_PIXELS / Math.max(1, width * height)),
  );
  return Math.max(0.1, Math.min(deviceScale, dimLimitedScale, areaLimitedScale));
};

const prepareOverlayCanvas = (canvas, width, height, backingScale = window.devicePixelRatio || 1) => {
  const pixelWidth = Math.max(1, Math.round(width * backingScale));
  const pixelHeight = Math.max(1, Math.round(height * backingScale));
  // Assigning canvas.width/height clears the bitmap and reallocates its backing
  // store. Doing that for every pointermove was the largest MD/NB drawing stall.
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const cssWidth = `${width}px`;
  const cssHeight = `${height}px`;
  if (canvas.style.width !== cssWidth) canvas.style.width = cssWidth;
  if (canvas.style.height !== cssHeight) canvas.style.height = cssHeight;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.setTransform(backingScale, 0, 0, backingScale, 0, 0);
  context.clearRect(0, 0, width, height);
  return context;
};
const DEFAULT_PEN_SETTINGS = {
  dynamic: true, // always on now — no toggle, no per-session setting
  stabilization: 45,
  pressureAssist: 55,
  taper: 72,
  flow: 38,
  border: true,
  nibAngle: 35,
  nibSpread: 68,
};
const DEFAULT_HIGHLIGHT_SETTINGS = {
  softness: 72,
  body: 58,
};
const ERASER_MODES = [
  { key: "standard", label: "Standard" },
  { key: "precise", label: "Precise" },
  { key: "stroke", label: "Stroke" },
];
// Shapes tools only (line/arrow/rect/circle) — see annotationDraw.js's
// own dash-pattern handling for how each renders.
const SHAPE_BORDER_STYLES = [
  { key: "solid", label: "Solid" },
  { key: "dashed", label: "Dashed" },
  { key: "dotted", label: "Dotted" },
];
const distancePointToSegment = (px, py, x1, y1, x2, y2) => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
};
const annotationHitByEraser = (ann, x, y, radius) => {
  if ((ann.type === "pen" || ann.type === "highlight" || ann.type === "freeshape") && Array.isArray(ann.points)) {
    return ann.points.some((pt, index, points) => {
      if (Math.hypot(pt.x - x, pt.y - y) <= radius) return true;
      if (index === 0) return false;
      const prev = points[index - 1];
      return distancePointToSegment(x, y, prev.x, prev.y, pt.x, pt.y) <= radius;
    });
  }
  if (ann.type === "line" || ann.type === "arrow") {
    return distancePointToSegment(x, y, ann.x1 ?? 0, ann.y1 ?? 0, ann.x2 ?? 0, ann.y2 ?? 0) <= radius;
  }
  if (["rect", "circle", "underline", "strikethrough", "smartVideoCapture"].includes(ann.type)) {
    const left = ann.x ?? 0;
    const top = ann.y ?? 0;
    const right = left + (ann.w ?? 0);
    const bottom = top + (ann.h ?? 0);
    const clampedX = clamp(x, Math.min(left, right), Math.max(left, right));
    const clampedY = clamp(y, Math.min(top, bottom), Math.max(top, bottom));
    return Math.hypot(clampedX - x, clampedY - y) <= radius;
  }
  return Math.hypot((ann.x ?? ann.x1 ?? 0) - x, (ann.y ?? ann.y1 ?? 0) - y) <= radius;
};
const eraseAnnotationsAtPoint = (annotations, x, y, radius, mode) => {
  const hitRadius = mode === "precise" ? radius * 0.45 : radius;
  const kept = [];
  let erasedCount = 0;
  let changed = false;

  annotations.forEach((ann) => {
    if (mode === "precise" && (ann.type === "pen" || ann.type === "highlight" || ann.type === "freeshape") && Array.isArray(ann.points)) {
      const nextPoints = ann.points.filter((pt, index, points) => {
        const nearPoint = Math.hypot(pt.x - x, pt.y - y) <= hitRadius;
        const prev = points[index - 1];
        const next = points[index + 1];
        const nearPrevSegment = prev && distancePointToSegment(x, y, prev.x, prev.y, pt.x, pt.y) <= hitRadius;
        const nearNextSegment = next && distancePointToSegment(x, y, pt.x, pt.y, next.x, next.y) <= hitRadius;
        return !(nearPoint || nearPrevSegment || nearNextSegment);
      });
      if (nextPoints.length >= 2) {
        kept.push({ ...ann, points: nextPoints });
      } else {
        erasedCount += 1;
      }
      if (nextPoints.length !== ann.points.length) changed = true;
      return;
    }

    if (annotationHitByEraser(ann, x, y, hitRadius)) {
      erasedCount += 1;
      changed = true;
    } else {
      kept.push(ann);
    }
  });

  return { kept, erasedCount, changed };
};
const PDF_TOOLBAR_SETTINGS_STORAGE_KEY = "mctoshs_pdf_toolbar_tool_settings";
const COLOR_PRESET_SLOT_COUNT = 4;
const buildDefaultAnnotToolColorPresets = () => (
  Object.fromEntries(
    Object.entries(DEFAULT_ANNOT_TOOL_COLORS).map(([key, color]) => [key, [color, null, null, null]])
  )
);
const DEFAULT_SHAPE_TOOL_SETTINGS = {
  line: { strokeWidth: 2, borderStyle: "solid", background: false, borderRadius: 0 },
  arrow: { strokeWidth: 3, borderStyle: "solid", background: false, borderRadius: 0 },
  rect: { strokeWidth: 2, borderStyle: "solid", background: false, borderRadius: 0 },
  circle: { strokeWidth: 2, borderStyle: "solid", background: false, borderRadius: 0 },
  freeshape: { strokeWidth: 2, borderStyle: "solid", background: false, borderRadius: 0 },
};
const DEFAULT_PDF_TOOLBAR_SETTINGS = {
  annotToolColors: DEFAULT_ANNOT_TOOL_COLORS,
  annotToolColorPresets: buildDefaultAnnotToolColorPresets(),
  annotSize: 16,
  penSize: 2,
  arrowSize: 3,
  penStabilization: DEFAULT_PEN_SETTINGS.stabilization,
  penPressureAssist: DEFAULT_PEN_SETTINGS.pressureAssist,
  penTaper: DEFAULT_PEN_SETTINGS.taper,
  penFlow: DEFAULT_PEN_SETTINGS.flow,
  penNibAngle: DEFAULT_PEN_SETTINGS.nibAngle,
  penNibSpread: DEFAULT_PEN_SETTINGS.nibSpread,
  penType: "ball",
  eraserSize: 18,
  eraserMode: "standard",
  highlightMode: "freehand",
  // Off by default so a plain drag isn't unexpectedly word-snapped; when
  // turned on, "line" mode's onMove continuously re-snaps to whichever
  // word is under the cursor and grows from the starting word out to it
  // (see autoWidthLocked's onMove branch) — not a per-word stepped stroke.
  highlightAutoWidth: false,
  highlightTaperEnds: true,
  // Opt-in: clamps the highlight's rendered color to a legible lightness
  // and masks/repaints the original PDF text underneath in a contrasting
  // color (see findSpansOverlappingHighlight below and
  // drawMaskedHighlightText in annotationDraw.js). Off by default — only
  // applies to highlights drawn while this is on.
  highlightAutoContrast: false,
  annotOpacity: 35,
  textFontFamily: "Georgia",
  textFontSize: 16,
  textAlign: "left",
  textBold: false,
  textItalic: false,
  textUnderline: false,
  textBackground: false,
  textBackgroundColor: "#FFE066",
  // 100 = the original fixed fontSize*0.18/0.16 ratio (annotationDraw.js's
  // "text" case) — a multiplier on that ratio, not an absolute pixel
  // value, so it still scales sensibly across different font sizes.
  textPadding: 100,
  shapeBorderStyle: "solid",
  shapeBorderRadius: 0,
  bboxBorderSize: 2,
  bboxCreationType: null,
  shapeBackground: false, // fill always uses the shape's own border/ink color — no independent fill color setting
  shapeToolSettings: DEFAULT_SHAPE_TOOL_SETTINGS,
};
const isHexColor = (value) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
const readNumberSetting = (value, fallback, min, max) => (
  Number.isFinite(Number(value))
    ? Math.min(max, Math.max(min, Number(value)))
    : fallback
);
const readBooleanSetting = (value, fallback) => (typeof value === "boolean" ? value : fallback);
// Shared by the synchronous localStorage load below (instant, offline-safe
// first paint) AND the async server hydration effect further down in the
// component (GET /api/user/me/pdf-toolbar-settings — the account-level
// source of truth, so these controls follow a user across browsers/
// devices instead of resetting every time localStorage doesn't have them).
// Same clamping either way, so a value from either source is equally safe.
const normalizePdfToolbarSettings = (parsed) => {
  if (!parsed || typeof parsed !== "object") return DEFAULT_PDF_TOOLBAR_SETTINGS;
  const colors = { ...DEFAULT_ANNOT_TOOL_COLORS };
  const colorPresets = buildDefaultAnnotToolColorPresets();
  if (parsed.annotToolColors && typeof parsed.annotToolColors === "object") {
    Object.keys(DEFAULT_ANNOT_TOOL_COLORS).forEach((key) => {
      if (isHexColor(parsed.annotToolColors[key])) colors[key] = parsed.annotToolColors[key];
    });
  }
  if (parsed.annotToolColorPresets && typeof parsed.annotToolColorPresets === "object") {
    Object.keys(DEFAULT_ANNOT_TOOL_COLORS).forEach((key) => {
      const slots = parsed.annotToolColorPresets[key];
      if (!Array.isArray(slots)) return;
      colorPresets[key] = Array.from({ length: COLOR_PRESET_SLOT_COUNT }, (_, index) => (
        isHexColor(slots[index]) ? slots[index] : null
      ));
      if (!colorPresets[key].some(Boolean)) colorPresets[key][0] = colors[key];
    });
  }
  const shapeToolSettings = Object.fromEntries(SHAPE_TOOL_KEYS.map((toolKey) => {
    const defaults = DEFAULT_SHAPE_TOOL_SETTINGS[toolKey];
    const saved = parsed.shapeToolSettings?.[toolKey];
    return [toolKey, {
      strokeWidth: readNumberSetting(
        saved?.strokeWidth,
        toolKey === "arrow"
          ? readNumberSetting(parsed.arrowSize, defaults.strokeWidth, 1, 20)
          : defaults.strokeWidth,
        1,
        20,
      ),
      borderStyle: SHAPE_BORDER_STYLES.some(({ key }) => key === saved?.borderStyle)
        ? saved.borderStyle
        : SHAPE_BORDER_STYLES.some(({ key }) => key === parsed.shapeBorderStyle)
          ? parsed.shapeBorderStyle
          : defaults.borderStyle,
      background: readBooleanSetting(saved?.background, readBooleanSetting(parsed.shapeBackground, defaults.background)),
      borderRadius: readNumberSetting(
        saved?.borderRadius,
        toolKey === "rect"
          ? readNumberSetting(parsed.shapeBorderRadius, defaults.borderRadius, 0, 60)
          : defaults.borderRadius,
        0,
        60,
      ),
    }];
  }));
  return {
    annotToolColors: colors,
    annotToolColorPresets: colorPresets,
    annotSize: readNumberSetting(parsed.annotSize, DEFAULT_PDF_TOOLBAR_SETTINGS.annotSize, 4, 96),
    penSize: readNumberSetting(parsed.penSize, DEFAULT_PDF_TOOLBAR_SETTINGS.penSize, 1, 36),
    arrowSize: readNumberSetting(parsed.arrowSize, DEFAULT_PDF_TOOLBAR_SETTINGS.arrowSize, 1, 20),
    penStabilization: readNumberSetting(parsed.penStabilization, DEFAULT_PDF_TOOLBAR_SETTINGS.penStabilization, 0, 100),
    penPressureAssist: readNumberSetting(parsed.penPressureAssist, DEFAULT_PDF_TOOLBAR_SETTINGS.penPressureAssist, 0, 100),
    penTaper: readNumberSetting(parsed.penTaper, DEFAULT_PDF_TOOLBAR_SETTINGS.penTaper, 0, 100),
    penFlow: readNumberSetting(parsed.penFlow, DEFAULT_PDF_TOOLBAR_SETTINGS.penFlow, 0, 100),
    penNibAngle: readNumberSetting(parsed.penNibAngle, DEFAULT_PDF_TOOLBAR_SETTINGS.penNibAngle, 0, 180),
    penNibSpread: readNumberSetting(parsed.penNibSpread, DEFAULT_PDF_TOOLBAR_SETTINGS.penNibSpread, 0, 100),
    penType: ["ball", "fountain"].includes(parsed.penType) ? parsed.penType : DEFAULT_PDF_TOOLBAR_SETTINGS.penType,
    eraserSize: readNumberSetting(parsed.eraserSize, DEFAULT_PDF_TOOLBAR_SETTINGS.eraserSize, 6, 72),
    eraserMode: ERASER_MODES.some(({ key }) => key === parsed.eraserMode) ? parsed.eraserMode : DEFAULT_PDF_TOOLBAR_SETTINGS.eraserMode,
    highlightMode: ["freehand", "line"].includes(parsed.highlightMode) ? parsed.highlightMode : DEFAULT_PDF_TOOLBAR_SETTINGS.highlightMode,
    highlightAutoWidth: readBooleanSetting(parsed.highlightAutoWidth, DEFAULT_PDF_TOOLBAR_SETTINGS.highlightAutoWidth),
    highlightTaperEnds: readBooleanSetting(parsed.highlightTaperEnds, DEFAULT_PDF_TOOLBAR_SETTINGS.highlightTaperEnds),
    highlightAutoContrast: readBooleanSetting(parsed.highlightAutoContrast, DEFAULT_PDF_TOOLBAR_SETTINGS.highlightAutoContrast),
    annotOpacity: readNumberSetting(parsed.annotOpacity, DEFAULT_PDF_TOOLBAR_SETTINGS.annotOpacity, OPACITY_MIN_PCT, OPACITY_MAX_PCT),
    textFontFamily: TEXT_FONT_FAMILIES.some(({ key }) => key === parsed.textFontFamily) ? parsed.textFontFamily : DEFAULT_PDF_TOOLBAR_SETTINGS.textFontFamily,
    textFontSize: readNumberSetting(parsed.textFontSize, DEFAULT_PDF_TOOLBAR_SETTINGS.textFontSize, 10, 48),
    textAlign: ["left", "center", "right"].includes(parsed.textAlign) ? parsed.textAlign : DEFAULT_PDF_TOOLBAR_SETTINGS.textAlign,
    textBold: readBooleanSetting(parsed.textBold, DEFAULT_PDF_TOOLBAR_SETTINGS.textBold),
    textItalic: readBooleanSetting(parsed.textItalic, DEFAULT_PDF_TOOLBAR_SETTINGS.textItalic),
    textUnderline: readBooleanSetting(parsed.textUnderline, DEFAULT_PDF_TOOLBAR_SETTINGS.textUnderline),
    textBackground: readBooleanSetting(parsed.textBackground, DEFAULT_PDF_TOOLBAR_SETTINGS.textBackground),
    textBackgroundColor: isHexColor(parsed.textBackgroundColor) ? parsed.textBackgroundColor : DEFAULT_PDF_TOOLBAR_SETTINGS.textBackgroundColor,
    textPadding: readNumberSetting(parsed.textPadding, DEFAULT_PDF_TOOLBAR_SETTINGS.textPadding, 0, 300),
    shapeBorderStyle: ["solid", "dashed", "dotted"].includes(parsed.shapeBorderStyle) ? parsed.shapeBorderStyle : DEFAULT_PDF_TOOLBAR_SETTINGS.shapeBorderStyle,
    shapeBorderRadius: readNumberSetting(parsed.shapeBorderRadius, DEFAULT_PDF_TOOLBAR_SETTINGS.shapeBorderRadius, 0, 60),
    bboxBorderSize: readNumberSetting(parsed.bboxBorderSize, DEFAULT_PDF_TOOLBAR_SETTINGS.bboxBorderSize, 1, 12),
    bboxCreationType: ["pageBBox", "bbox", "subLineBBox", "imageBBox", "columnBBox"].includes(parsed.bboxCreationType)
      ? parsed.bboxCreationType
      : DEFAULT_PDF_TOOLBAR_SETTINGS.bboxCreationType,
    shapeBackground: readBooleanSetting(parsed.shapeBackground, DEFAULT_PDF_TOOLBAR_SETTINGS.shapeBackground),
    shapeToolSettings,
  };
};
const loadPdfToolbarSettings = () => {
  try {
    return normalizePdfToolbarSettings(JSON.parse(localStorage.getItem(PDF_TOOLBAR_SETTINGS_STORAGE_KEY) || "null"));
  } catch {
    return DEFAULT_PDF_TOOLBAR_SETTINGS;
  }
};
const savePdfToolbarSettings = (settings) => {
  try {
    localStorage.setItem(PDF_TOOLBAR_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {}
};
const distToSegment = (px, py, x1, y1, x2, y2) => {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
};
const polylineLength = (points) => {
  if (!Array.isArray(points) || points.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot((points[i]?.x ?? 0) - (points[i - 1]?.x ?? 0), (points[i]?.y ?? 0) - (points[i - 1]?.y ?? 0));
  }
  return total;
};
const smoothStrokePoint = (points, nextPoint, stabilization, scale = 1) => {
  if (!points.length) return nextPoint;
  const previous = points[points.length - 1];
  const normalized = Math.min(1, Math.max(0, stabilization / 100));
  const blend = 0.12 + (normalized * normalized) * 0.84;
  const smoothed = {
    x: previous.x + (nextPoint.x - previous.x) * (1 - blend),
    y: previous.y + (nextPoint.y - previous.y) * (1 - blend),
    t: nextPoint.t,
    pressure: previous.pressure + (nextPoint.pressure - previous.pressure) * (1 - blend * 0.55),
  };
  const minDocMovement = Math.max(0.003, 0.7 / Math.max(1, scale));
  if (Math.hypot(smoothed.x - previous.x, smoothed.y - previous.y) < minDocMovement) return null;
  return smoothed;
};

const pointsToBounds = (points) => {
  if (!Array.isArray(points) || !points.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    if (!point) continue;
    minX = Math.min(minX, point.x ?? Infinity);
    minY = Math.min(minY, point.y ?? Infinity);
    maxX = Math.max(maxX, point.x ?? -Infinity);
    maxY = Math.max(maxY, point.y ?? -Infinity);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) return null;
  return { x: minX, y: minY, w: Math.max(0, maxX - minX), h: Math.max(0, maxY - minY) };
};

const crossProduct = (origin, a, b) => (
  (a.x - origin.x) * (b.y - origin.y)
  - (a.y - origin.y) * (b.x - origin.x)
);

const convexHull = (points) => {
  const unique = Array.from(
    new Map(
      (Array.isArray(points) ? points : [])
        .filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y))
        .map((point) => [`${point.x}:${point.y}`, { x: point.x, y: point.y }]),
    ).values(),
  ).sort((a, b) => a.x - b.x || a.y - b.y);
  if (unique.length <= 2) return unique;
  const lower = [];
  for (const point of unique) {
    while (lower.length >= 2 && crossProduct(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper = [];
  for (let index = unique.length - 1; index >= 0; index -= 1) {
    const point = unique[index];
    while (upper.length >= 2 && crossProduct(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
};

const minimumAreaRectangle = (points) => {
  const hull = convexHull(points);
  if (hull.length < 3) {
    const bounds = pointsToBounds(hull);
    if (!bounds) return null;
    const { x, y, w, h } = bounds;
    return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
  }

  let best = null;
  for (let index = 0; index < hull.length; index += 1) {
    const start = hull[index];
    const end = hull[(index + 1) % hull.length];
    const edgeX = end.x - start.x;
    const edgeY = end.y - start.y;
    const edgeLength = Math.hypot(edgeX, edgeY);
    if (edgeLength <= 0.0001) continue;
    const ux = edgeX / edgeLength;
    const uy = edgeY / edgeLength;
    const vx = -uy;
    const vy = ux;
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const point of hull) {
      const projectedU = point.x * ux + point.y * uy;
      const projectedV = point.x * vx + point.y * vy;
      minU = Math.min(minU, projectedU);
      maxU = Math.max(maxU, projectedU);
      minV = Math.min(minV, projectedV);
      maxV = Math.max(maxV, projectedV);
    }
    const width = maxU - minU;
    const height = maxV - minV;
    const area = width * height;
    if (!best || area < best.area) {
      const pointAt = (u, v) => ({ x: u * ux + v * vx, y: u * uy + v * vy });
      best = {
        area,
        points: [
          pointAt(minU, minV),
          pointAt(maxU, minV),
          pointAt(maxU, maxV),
          pointAt(minU, maxV),
        ],
      };
    }
  }
  return best?.points || null;
};

const rectanglePointsFromBounds = ({ x, y, w, h }) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

const getSpanBounds = (span) => {
  const x = span?.pageLeft ?? span?.geoLeft;
  const y = span?.pageTop ?? span?.geoTop;
  const right = span?.pageRight ?? span?.geoRight;
  const bottom = span?.pageBottom ?? (y != null ? y + (span?.pageHeight ?? span?.geoHeight ?? 0) : null);
  if (![x, y, right, bottom].every(Number.isFinite)) return null;
  return { x, y, w: Math.max(0, right - x), h: Math.max(0, bottom - y) };
};

const getSelectedTextSpanEntries = (points, spans, expandToSelectedLines = false, singleLine = false) => {
  const drawnBounds = pointsToBounds(points);
  if (!drawnBounds || !Array.isArray(spans)) return [];
  const intersected = spans.map((source) => ({ source, bounds: getSpanBounds(source) })).filter(({ bounds }) => bounds).filter(({ bounds: span }) => {
    const overlapX = Math.max(0, Math.min(drawnBounds.x + drawnBounds.w, span.x + span.w) - Math.max(drawnBounds.x, span.x));
    const overlapY = Math.max(0, Math.min(drawnBounds.y + drawnBounds.h, span.y + span.h) - Math.max(drawnBounds.y, span.y));
    // PDF.js text spans are word-level in many documents. A BBox must cover
    // at least half of a span from top to bottom before it selects that line.
    return overlapX > 0.01 && overlapY / Math.max(1, span.h) >= 0.5;
  });
  if (!intersected.length) return [];
  const lineKey = (source, bounds) => source.rowIndex != null
    ? `${source.columnIndex ?? "full"}:${source.rowIndex}`
    : `${source.columnIndex ?? "full"}:${Math.round((bounds.y + bounds.h / 2) * 2) / 2}`;
  // A bbox selects complete touched lines, not individual glyph fragments.
  // Crucially, a line is eligible only when its center is inside the drawn
  // rectangle; a neighboring line merely grazed at its edge is excluded.
  const lineGroups = new Map();
  intersected.forEach((entry) => {
    const key = lineKey(entry.source, entry.bounds);
    const group = lineGroups.get(key) || { top: Infinity, bottom: -Infinity };
    group.top = Math.min(group.top, entry.bounds.y);
    group.bottom = Math.max(group.bottom, entry.bounds.y + entry.bounds.h);
    lineGroups.set(key, group);
  });
  const selectedLineKeys = new Set([...lineGroups.entries()]
    .filter(([, group]) => {
      const overlapTop = Math.max(drawnBounds.y, group.top);
      const overlapBottom = Math.min(drawnBounds.y + drawnBounds.h, group.bottom);
      const overlapHeight = Math.max(0, overlapBottom - overlapTop);
      // The line itself is the selection unit. Once the BBox covers at least
      // half of that line's top-to-bottom extent, keep the complete line,
      // even when its center is just outside the drawn rectangle.
      return overlapHeight / Math.max(1, group.bottom - group.top) >= 0.5;
    })
    .map(([key]) => key));
  return spans
    .map((source) => ({ source, bounds: getSpanBounds(source) }))
    .filter(({ source, bounds }) => bounds && selectedLineKeys.has(lineKey(source, bounds)));
};

const unionSelectedTextLines = (points, spans, expandToSelectedLines = false, selectedEntries = null, clipToDrawnBounds = false, singleLine = false) => {
  const drawnBounds = clipToDrawnBounds ? pointsToBounds(points) : null;
  const selected = (selectedEntries || getSelectedTextSpanEntries(points, spans, expandToSelectedLines, singleLine))
    .map(({ bounds }) => bounds)
    .filter(Boolean)
    .map((bounds) => {
      if (!drawnBounds) return bounds;
      const right = Math.min(bounds.x + bounds.w, drawnBounds.x + drawnBounds.w);
      const left = Math.max(bounds.x, drawnBounds.x);
      return {
        ...bounds,
        x: left,
        w: Math.max(0, right - left),
      };
    })
    .filter((bounds) => bounds.w > 0);
  if (!selected.length) return null;
  const left = Math.min(...selected.map((line) => line.x));
  const top = Math.min(...selected.map((line) => line.y));
  const right = Math.max(...selected.map((span) => span.x + span.w));
  const bottom = Math.max(...selected.map((span) => span.y + span.h));
  return { x: left, y: top, w: Math.max(0, right - left), h: Math.max(0, bottom - top) };
};

// Keep the live selection freeform, then commit a tight geometric rectangle
// when the pointer is released. Text-oriented BBoxes use the actual PDF text
// line geometry; image/blank selections fall back to the minimum-area shape.
const finalizeBBoxAsRectangle = (points, type, spans, selectedEntries = null) => {
  const drawnBounds = pointsToBounds(points);
  const selectedLineBounds = bboxTypeHas(type, "extractsText")
    ? unionSelectedTextLines(
        points,
        spans,
        ["bbox", "subLineBBox", "columnBBox"].includes(type),
        selectedEntries,
        ["bbox", "subLineBBox", "columnBBox"].includes(type),
        type === "subLineBBox",
      )
    : null;
  const rectangle = type === "pageBBox"
    ? (selectedLineBounds ? rectanglePointsFromBounds(selectedLineBounds) : drawnBounds ? rectanglePointsFromBounds(drawnBounds) : null)
    : type === "omissionBBox"
      ? (drawnBounds ? rectanglePointsFromBounds(drawnBounds) : null)
    : selectedLineBounds
    ? rectanglePointsFromBounds(selectedLineBounds)
    : minimumAreaRectangle(points);
  if (!rectangle) return { points: [], closed: false };
  return {
    points: rectangle,
    closed: true,
    geometry: "rectangle",
  };
};

const isBBoxOutlineClosed = (annotationLike) => annotationLike?.closed !== false;

const attractBBoxLoopPoint = (points, scale = 1) => {
  if (!Array.isArray(points) || points.length < 3) return { points: Array.isArray(points) ? points.map((point) => ({ ...point })) : [], closed: false, attraction: 0 };
  const nextPoints = points.map((point) => ({ ...point }));
  const first = nextPoints[0];
  const lastIndex = nextPoints.length - 1;
  const last = nextPoints[lastIndex];
  const safeScale = Math.max(0.25, Number(scale) || 1);
  const snapThreshold = Math.max(8 / safeScale, 4);
  const attractThreshold = snapThreshold * 3.2;
  const distance = Math.hypot((last.x ?? 0) - (first.x ?? 0), (last.y ?? 0) - (first.y ?? 0));
  if (distance <= snapThreshold) {
    nextPoints[lastIndex] = {
      ...last,
      x: first.x,
      y: first.y,
    };
    return { points: nextPoints, closed: true, attraction: 1 };
  }
  if (distance >= attractThreshold) return { points: nextPoints, closed: false, attraction: 0 };
  const ratio = 1 - ((distance - snapThreshold) / Math.max(0.000001, attractThreshold - snapThreshold));
  const pull = Math.pow(Math.max(0, Math.min(1, ratio)), 1.6) * 0.72;
  nextPoints[lastIndex] = {
    ...last,
    x: last.x + ((first.x ?? 0) - (last.x ?? 0)) * pull,
    y: last.y + ((first.y ?? 0) - (last.y ?? 0)) * pull,
  };
  return { points: nextPoints, closed: false, attraction: pull };
};

const expandRectBy = (rect, padding) => {
  if (!rect) return null;
  const pad = Math.max(0, Number(padding) || 0);
  return {
    x: rect.x - pad,
    y: rect.y - pad,
    w: rect.w + pad * 2,
    h: rect.h + pad * 2,
  };
};

const scalePointsToBounds = (points, fromBounds, toBounds) => {
  if (!Array.isArray(points) || points.length < 2 || !fromBounds || !toBounds) return points;
  const fromW = Math.max(1, fromBounds.w || 0);
  const fromH = Math.max(1, fromBounds.h || 0);
  const toW = Math.max(1, toBounds.w || 0);
  const toH = Math.max(1, toBounds.h || 0);
  return points.map((point) => ({
    ...point,
    x: toBounds.x + ((point.x - fromBounds.x) / fromW) * toW,
    y: toBounds.y + ((point.y - fromBounds.y) / fromH) * toH,
  }));
};

const buildEditableBBoxOutline = (annotation) => {
  if (Array.isArray(annotation?.points) && annotation.points.length >= 2) {
    return annotation.points.map((point) => ({
      x: point.x,
      y: point.y,
      t: point.t,
      pressure: point.pressure,
      manualControl: point.manualControl,
    }));
  }
  if (!annotation) return [];
  const left = annotation.x ?? 0;
  const top = annotation.y ?? 0;
  const right = left + (annotation.w ?? 0);
  const bottom = top + (annotation.h ?? 0);
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
};

const sampleClosedOutlineHandles = (annotation) => {
  if (!annotation) return [];
  const left = Number(annotation.x) || 0;
  const top = Number(annotation.y) || 0;
  const width = Math.max(1, Number(annotation.w) || 1);
  const height = Math.max(1, Number(annotation.h) || 1);
  return [
    { side: "top", x: left + width / 2, y: top, cursor: "ns-resize" },
    { side: "right", x: left + width, y: top + height / 2, cursor: "ew-resize" },
    { side: "bottom", x: left + width / 2, y: top + height, cursor: "ns-resize" },
    { side: "left", x: left, y: top + height / 2, cursor: "ew-resize" },
  ];
};

const deformClosedOutlineAroundPoint = (points, pointIndex, dx, dy, scale = 1, closed = true) => {
  if (!Array.isArray(points) || pointIndex == null || pointIndex < 0 || pointIndex >= points.length) return points;
  const count = points.length;
  if (count < 2) return points.map((point) => ({ ...point }));

  const segmentCount = closed ? count : Math.max(0, count - 1);
  const segmentLengths = Array.from({ length: segmentCount }, (_, index) => {
    const point = points[index];
    const next = points[index + 1] ?? points[(index + 1) % count];
    return Math.hypot((next.x ?? 0) - (point.x ?? 0), (next.y ?? 0) - (point.y ?? 0));
  });
  const perimeter = segmentLengths.reduce((sum, length) => sum + length, 0);
  if (perimeter <= 0.001) return points.map((point) => ({ ...point }));

  const safeScale = Math.max(0.25, Number(scale) || 1);
  const previousIndex = closed ? (pointIndex - 1 + count) % count : Math.max(0, pointIndex - 1);
  const nextIndex = closed ? pointIndex % count : Math.min(segmentLengths.length - 1, pointIndex);
  const localSegmentSpan = (segmentLengths[previousIndex] || 0) + (segmentLengths[nextIndex] || 0);
  // Keep border edits highly local: enough spread to avoid a hard kink,
  // but never enough to drag distant sides of the shape around.
  const influenceRadius = Math.max(
    14 / safeScale,
    Math.min(
      Math.max(localSegmentSpan * 1.35, 28 / safeScale),
      Math.max(18 / safeScale, perimeter * 0.085),
    ),
  );
  const forwardDistances = new Array(count).fill(Infinity);
  const backwardDistances = new Array(count).fill(Infinity);
  forwardDistances[pointIndex] = 0;
  backwardDistances[pointIndex] = 0;
  let distance = 0;
  for (let step = 1; step < count; step++) {
    const previousSegmentIndex = closed ? (pointIndex + step - 1) % count : pointIndex + step - 1;
    const index = closed ? (pointIndex + step) % count : pointIndex + step;
    if (!closed && (previousSegmentIndex >= segmentLengths.length || index >= count)) break;
    distance += segmentLengths[previousSegmentIndex] || 0;
    forwardDistances[index] = distance;
  }
  distance = 0;
  for (let step = 1; step < count; step++) {
    const index = closed ? (pointIndex - step + count) % count : pointIndex - step;
    if (!closed && index < 0) break;
    const segmentIndex = closed ? index : index;
    distance += segmentLengths[segmentIndex] || 0;
    backwardDistances[index] = distance;
  }

  return points.map((point, index) => {
    const borderDistance = Math.min(forwardDistances[index], backwardDistances[index]);
    const ratio = Math.min(1, borderDistance / Math.max(0.001, influenceRadius));
    const weight = borderDistance >= influenceRadius
      ? 0
      : Math.pow(1 - ratio, 2.6);
    if (weight <= 0) return { ...point };
    return {
      ...point,
      x: point.x + dx * weight,
      y: point.y + dy * weight,
    };
  });
};

const findNearestOutlinePointIndex = (points, x, y) => {
  if (!Array.isArray(points) || !points.length) return -1;
  let bestIndex = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    const distance = Math.hypot((point.x ?? 0) - x, (point.y ?? 0) - y);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }
  return bestIndex;
};

const stripTitleFromBBoxTextValue = (text, title) => {
  const bodyText = String(text || "").trim();
  const titleText = String(title || "").trim();
  if (!bodyText || !titleText) return bodyText;
  const escapedTitle = titleText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`^${escapedTitle}[\\s:;-]*`, "i"),
    new RegExp(`^[\\s:;-]*${escapedTitle}[\\s:;-]*`, "i"),
  ];
  for (const pattern of patterns) {
    const next = bodyText.replace(pattern, "").trim();
    if (next !== bodyText) return next;
  }
  return bodyText;
};

const distanceBetweenStrokePoints = (a, b) => Math.hypot((b.x ?? 0) - (a.x ?? 0), (b.y ?? 0) - (a.y ?? 0));

const dedupeStrokePoints = (points, minDistance = 0.02) => {
  if (!Array.isArray(points) || points.length < 2) return points || [];
  const deduped = [points[0]];
  for (let i = 1; i < points.length; i++) {
    if (distanceBetweenStrokePoints(deduped[deduped.length - 1], points[i]) >= minDistance) deduped.push(points[i]);
  }
  return deduped;
};

const resampleStrokePoints = (points, spacing = 0.7) => {
  if (!Array.isArray(points) || points.length < 2) return points || [];
  const safeSpacing = Math.max(0.2, spacing);
  const resampled = [points[0]];
  let previous = points[0];
  let remainder = 0;

  for (let i = 1; i < points.length; i++) {
    const current = points[i];
    let segLen = distanceBetweenStrokePoints(previous, current);
    if (segLen === 0) continue;

    while (remainder + segLen >= safeSpacing) {
      const step = (safeSpacing - remainder) / segLen;
      const point = {
        x: previous.x + (current.x - previous.x) * step,
        y: previous.y + (current.y - previous.y) * step,
        t: previous.t + ((current.t ?? previous.t ?? 0) - (previous.t ?? 0)) * step,
        pressure: (previous.pressure ?? 0.5) + ((current.pressure ?? previous.pressure ?? 0.5) - (previous.pressure ?? 0.5)) * step,
      };
      resampled.push(point);
      previous = point;
      segLen = distanceBetweenStrokePoints(previous, current);
      remainder = 0;
      if (segLen === 0) break;
    }

    remainder += segLen;
    previous = current;
  }

  const last = points[points.length - 1];
  if (distanceBetweenStrokePoints(resampled[resampled.length - 1], last) > 0.01) resampled.push(last);
  return resampled;
};

const smoothStrokePath = (points, smoothness = 0.45, scale = 1) => {
  if (!Array.isArray(points) || points.length < 3) return points || [];
  const tension = clamp(smoothness, 0, 1);
  const segmentsPerSpan = tension > 0.72 ? 4 : tension > 0.42 ? 3 : 2;
  const smoothed = [points[0]];

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    for (let step = 1; step <= segmentsPerSpan; step++) {
      const t = step / segmentsPerSpan;
      const t2 = t * t;
      const t3 = t2 * t;
      const x = 0.5 * (
        (2 * p1.x) +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
      );
      const y = 0.5 * (
        (2 * p1.y) +
        (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
      );
      smoothed.push({
        x,
        y,
        t: (p1.t ?? 0) + ((p2.t ?? p1.t ?? 0) - (p1.t ?? 0)) * t,
        pressure: clamp((p1.pressure ?? 0.5) + ((p2.pressure ?? p1.pressure ?? 0.5) - (p1.pressure ?? 0.5)) * t, 0.02, 1),
      });
    }
  }

  return dedupeStrokePoints(smoothed, Math.max(0.002, 0.24 / Math.max(1, scale)));
};

const applySyntheticStrokePressure = (points, penType, pressureAssist = DEFAULT_PEN_SETTINGS.pressureAssist, scale = 1) => {
  if (!Array.isArray(points) || points.length < 2) return points || [];
  const normalizedAssist = clamp(pressureAssist / 100, 0, 1);
  const hasMeaningfulPressure = points.some((point) => {
    const pressure = point.pressure ?? 0.5;
    return pressure < 0.44 || pressure > 0.56;
  });
  if (hasMeaningfulPressure) {
    return points.map((point, index, array) => {
      const edgeTaper = Math.sin((index / Math.max(1, array.length - 1)) * Math.PI);
      const blendedPressure = (point.pressure ?? 0.5) * (1 - normalizedAssist * 0.35) + (0.5 + edgeTaper * 0.18) * (normalizedAssist * 0.35);
      return {
        ...point,
        pressure: clamp(blendedPressure * (0.92 + edgeTaper * 0.08), 0.04, 1),
      };
    });
  }

  return points.map((point, index, array) => {
    const prev = array[Math.max(0, index - 1)];
    const next = array[Math.min(array.length - 1, index + 1)];
    const dt = Math.max(1, Math.abs((next.t ?? point.t ?? 0) - (prev.t ?? point.t ?? 0)));
    const velocity = (distanceBetweenStrokePoints(prev, next) * Math.max(1, scale)) / dt;
    const edgeTaper = Math.sin((index / Math.max(1, array.length - 1)) * Math.PI);
    const body = (penType === "fountain" ? 0.7 : 0.66) + normalizedAssist * 0.16;
    const velocityGain = (penType === "fountain" ? 0.34 : 0.22) + normalizedAssist * (penType === "fountain" ? 0.16 : 0.12);
    return {
      ...point,
      pressure: clamp(body + edgeTaper * 0.18 - velocity * velocityGain, 0.08, 0.94),
    };
  });
};

const finalizePenStroke = (points, penSettings = DEFAULT_PEN_SETTINGS, penType = "ball", scale = 1) => {
  if (!Array.isArray(points) || points.length < 2) return points || [];
  const dynamic = penSettings?.dynamic === true;
  const stabilization = penSettings?.stabilization ?? DEFAULT_PEN_SETTINGS.stabilization;
  const pressureAssist = penSettings?.pressureAssist ?? DEFAULT_PEN_SETTINGS.pressureAssist;
  const normalized = clamp(stabilization / 100, 0, 1);
  const scaleFactor = Math.max(1, scale);
  const deduped = dedupeStrokePoints(points, Math.max(0.002, (0.015 + normalized * 0.05) / scaleFactor));
  if (deduped.length < 2) return deduped;
  // Keep the released stroke visually close to the live preview: the live
  // path is already smoothed incrementally while drawing, so an extra
  // resample/smoothing pass here can reintroduce harder turns at lift-off.
  if (!dynamic) return deduped.map((point) => ({ ...point, pressure: 0.5 }));
  return applySyntheticStrokePressure(deduped, penType, pressureAssist, scaleFactor);
};

// Compact draggable "knob" that replaces a native <input type="range"> for
// annotation size — the preview grows/shrinks live with the value, so it
// previews the active tool size instead of just pointing at a number.
// Draw a single annotation onto a 2d canvas context.
// Coordinates are stored in PDF-point space; scale = fitScale * zoom converts to canvas pixels.

const ALL_MODES = ["sub-molecule","molecule","sub-cell","cell","sub-tissue","tissue","sub-organ","organ","sub-system","system","sub-human","human"];
const modeObj   = () => Object.fromEntries(ALL_MODES.map((m) => [m, []]));

const EMPTY_HYLES = () => ({
  entities:  modeObj(),
  traces:    modeObj(),
  phenomena: modeObj(),
  concept:   modeObj(),
  models:    modeObj(),
  _total: 0,
});

const authFetch = (url, options = {}) => {
  const token = readStoredSession()?.token || "";
  return fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` },
  });
};

const initStatus   = () => ({ value: "pending", at: new Date().toISOString() });
const currentStatus = (item) => item.status?.value || "pending";

const BBOX_TYPE_ABBREVIATIONS = Object.freeze({
  bbox: "B",
  subLineBBox: "SL",
  columnBBox: "Part",
  pageBBox: "Pg",
  bboxTitle: "T",
  imageBBox: "Fig",
  omissionBBox: "Omit",
});

const SEMANTIC_TYPE_ABBREVIATIONS = Object.freeze({
  chapter_title: "Ch",
  section_title: "S",
  subsection_title: "SubS",
  paragraph_title: "PT",
  body_paragraph: "P",
  figure: "Fig",
  figure_caption: "FigCap",
  table: "Tbl",
  table_caption: "TblCap",
  table_of_contents: "ToC",
  list: "List",
  equation: "Eq",
  header: "Hdr",
  footer: "Ftr",
  page_number: "Pg",
  unknown: "?",
});

// "objects" was the card name before the Entities rename — extractions saved
// before that rename still have nouns tagged "objects" in the database, so
// reads alias it to "entities" here rather than losing that historical data.
const normalizeCard = (card) => (card === "objects" ? "entities" : card);

const inflateExtraction = (extraction) => {
  const data = EMPTY_HYLES();
  for (const { id, num, noun, card, mode, reason, status } of extraction.nouns || []) {
    const normalizedCard = normalizeCard(card);
    if (data[normalizedCard]?.[mode]) {
      data[normalizedCard][mode].push({ id, num, noun, reason: reason || "", status: status?.value ? status : initStatus() });
    }
  }
  data._total = extraction.totalNouns || 0;
  return data;
};

const deflateNounData = (hyleData) => {
  const nouns = [];
  for (const card of ["entities", "traces", "phenomena", "concept", "models"]) {
    for (const mode of ALL_MODES) {
      for (const item of hyleData[card]?.[mode] || []) {
        nouns.push({ id: item.id, num: item.num, noun: item.noun, card, mode, reason: item.reason, status: item.status });
      }
    }
  }
  return nouns;
};

const NotebookZoomControls = ({ zoom, disabled, onZoomOut, onZoomIn, onReset }) => {
  const holdRef = useRef({ timer: null, interval: null, suppressClick: false });

  const stopHold = useCallback(() => {
    const state = holdRef.current;
    if (state.timer) window.clearTimeout(state.timer);
    if (state.interval) window.clearInterval(state.interval);
    state.timer = null;
    state.interval = null;
  }, []);

  useEffect(() => () => stopHold(), [stopHold]);

  const startHold = useCallback((direction) => {
    if (disabled) return;
    stopHold();
    const state = holdRef.current;
    const zoomStep = direction < 0 ? onZoomOut : onZoomIn;
    state.suppressClick = false;
    state.timer = window.setTimeout(() => {
      state.timer = null;
      state.suppressClick = true;
      const startedAt = performance.now();
      state.interval = window.setInterval(() => {
        const elapsed = performance.now() - startedAt;
        const progress = Math.min(1, elapsed / ZOOM_HOLD_RAMP_MS);
        const multiplier = 1 + (ZOOM_HOLD_MAX_MULTIPLIER - 1) * progress * progress;
        for (let step = 0; step < multiplier; step += 1) zoomStep();
      }, ZOOM_HOLD_TICK_MS);
    }, 220);
  }, [disabled, onZoomIn, onZoomOut, stopHold]);

  const finishHold = useCallback((event) => {
    const suppressClick = holdRef.current.suppressClick;
    stopHold();
    if (suppressClick) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (!suppressClick || event.type !== "pointerup") holdRef.current.suppressClick = false;
  }, [stopHold]);

  const consumeClick = useCallback((action) => (event) => {
    if (holdRef.current.suppressClick) {
      event.preventDefault();
      holdRef.current.suppressClick = false;
      return;
    }
    action();
  }, []);

  const percent = Math.round(zoom * 100);
  return (
    <div className="pdf_freeform_notebook_zoom" aria-label="Notebook drawing zoom controls">
      <button
        type="button"
        className="pdf_freeform_notebook_zoom_button"
        onPointerDown={() => startHold(-1)}
        onPointerUp={finishHold}
        onPointerCancel={finishHold}
        onPointerLeave={finishHold}
        onClick={consumeClick(onZoomOut)}
        disabled={disabled || zoom <= MIN_ZOOM}
        title="Zoom Notebook out"
      >
        <i className="bx bx-minus" />
      </button>
      <button
        type="button"
        className="pdf_freeform_notebook_zoom_value"
        onClick={onReset}
        disabled={disabled}
        title="Reset Notebook zoom"
      >
        {percent}%
      </button>
      <button
        type="button"
        className="pdf_freeform_notebook_zoom_button"
        onPointerDown={() => startHold(1)}
        onPointerUp={finishHold}
        onPointerCancel={finishHold}
        onPointerLeave={finishHold}
        onClick={consumeClick(onZoomIn)}
        disabled={disabled || zoom >= MAX_ZOOM}
        title="Zoom Notebook in"
      >
        <i className="bx bx-plus" />
      </button>
    </div>
  );
};

const PDFPage = forwardRef(({
  embeddedSourceId = "",
  embeddedPdfName = "",
  embeddedFile = null,
  embeddedHomePath = "/hylomorphism",
  homeLabel = "Hyle-to-Meaning",   // tooltip for the ⌂ button when routed directly (not embedded)
  selectionOnly = false,           // hide Hyle-extraction/annotation chrome, force manual text-selection always on
  onSelectionAction = null,        // async (selectedText) => void — replaces the ✓ "add to Hyles" button in the selection bar
  selectionActionLabel = "Add",
  hideHyleControls = false,        // hide just the "Hyles" toggle + extraction panel (plain reading/annotation use, e.g. /pdf-reader)
  onPdfTypeChange = null,          // (type) => void — lets an embedding parent (e.g. a tab strip) mirror text-based/mixed/scanned without owning the PDF.js parse itself
  initialPage = null,              // jump to this page once the source finishes loading (e.g. a deep link from Medical Exams) — ignored for embeddedFile/local-file loads
  hideUndoRedo = false,            // hide the undo/history/redo row from this instance's own toolbar — an embedding parent (e.g. PDFReaderWorkspace's tab bar) is driving it externally via ref instead, see useImperativeHandle below
  onUndoRedoStateChange = null,    // (state) => void — fired whenever canUndo/canRedo/hasHistory/historyOpen change, so an external driver's own buttons (disabled state, active state) can stay in sync without polling the ref
  hidePageNav = false,             // same idea as hideUndoRedo, for the prev/page-number/next row
  onPageNavStateChange = null,     // (state) => void — fired whenever pageNum/pageCount/disabled change
  onZoomStateChange = null,        // (state) => void — fired whenever zoom changes so an external driver can render zoom controls
  onAnnotationSaveStateChange = null, // (status) => void — mirrors annotation DB persistence in an external tab strip
  fitToContainer = false,          // force the fit-to-container initial zoom even though embedded is true — PDFReaderWorkspace's own reading pane is a full dedicated area, unlike a genuinely cramped embedding (e.g. Units Extraction), so it opts into this instead of "embedded" defaulting to native/1:1 scale for it too
  disableZoom = false,             // disable all zoom controls/gestures for fixed-size reader views like /pdf-reader
  toolbarHost = null,              // optional external DOM mount for this instance's real toolbar
  entityBuilderHost = null,        // optional external DOM mount for AMCTOSHS Illumination
  markdownHost = null,             // optional external DOM mount for the current page's Markdown aside
}, ref) => {
  const [pdfDoc, setPdfDoc]         = useState(null);
  const [filename, setFilename]     = useState("");
  const [pageNum, setPageNum]       = useState(1);
  const [pageCount, setPageCount]   = useState(0);
  // Booklet mode shows pageNum alongside a second, independently-picked
  // companion page (not fixed to pageNum+1 — e.g. {1,7} is a valid pair).
  // Read-only: full annotation editing stays on pageNum only, the
  // companion is a plain raster page rendered via the same renderPage()
  // used for pageNum, just without the interactive canvas layers.
  const [readingMode, setReadingMode] = useState("single"); // "single" | "booklet"
  const [bookletRightPage, setBookletRightPage] = useState(null);
  const pendingReaderRestoreRef = useRef(null);
  const [insertingBlankPage, setInsertingBlankPage] = useState(false);
  const [deletingPage, setDeletingPage] = useState(false);
  // Page numbers this source has ever had inserted blank via the toolbar
  // button — the ONLY pages eligible for the page-corner Delete button
  // (arbitrary real content can't be one-click-deleted, only a blank page
  // added this way can). Backed by Source.blankPages server-side (kept in
  // sync by insert-page/delete-page in SourcesAPI.js) and re-seeded from
  // there every time loadFromSource fetches the source's own row, so the
  // Delete button keeps showing for a blank page across reloads/reopens —
  // this local Set is just a fast-access mirror, updated optimistically
  // by insertBlankPageAfterCurrent/deletePageAtCurrent below and then
  // reconfirmed by that fetch once their own reload completes.
  const [blankInsertedPages, setBlankInsertedPages] = useState(() => new Set());

  // ── Document text search ────────────────────────────────────────────────
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  // [{page, itemIndexes, matchType, confidence, originalMatchedText}],
  // sorted by page then position — matchType/confidence come from the
  // tolerant search pipeline (pdfFuzzySearch.js): "exact" for a literal
  // substring match down through "fuzzy" for a distorted-text match found
  // only via edit-distance, see pdfSearchIndexCacheRef below.
  const [searchMatches, setSearchMatches] = useState([]);
  const [searchActiveIndex, setSearchActiveIndex] = useState(-1);
  const [searchScanning, setSearchScanning] = useState(false);
  const pageTextItemsCacheRef = useRef({}); // { [pageNum]: pdf.js text-content items[] } — raw getTextContent() results, independent of zoom/scale
  const pdfAssistantPagesCacheRef = useRef({ document: null, promise: null, pages: null });
  // Per-page normalized/compact/tokenized search index (pdfSearchIndex.js) —
  // built once per page from pageTextItemsCacheRef's items and cached
  // alongside it, cleared at the same point (loadPdfBytes) on document change.
  const pageIndexCacheRef = useRef(createPageIndexCache());
  const searchCanvasRef = useRef(null);
  const hyleCanvasRef = useRef(null);
  const hyleFabRef = useRef(null);
  const hyleIconsLayerRef = useRef(null);
  const searchRunIdRef = useRef(0);
  const hyleRunIdRef = useRef(0);
  const [hasSourceId, setHasSourceId] = useState(false); // mirrors currentSourceIdRef.current — see loadPdfBytes/loadFromSource for why a plain ref isn't enough here
  const [pdfType, setPdfType]       = useState(null);
  useEffect(() => { onPdfTypeChange?.(pdfType); }, [pdfType]); // eslint-disable-line react-hooks/exhaustive-deps -- onPdfTypeChange is a stable-enough callback prop, not a reactive dep
  const [loading, setLoading]       = useState(false);
  const [loadError, setLoadError]   = useState("");
  const [dragOver, setDragOver]     = useState(false);
  const [pageViewport, setPageViewport] = useState(null);
  const [zoom, setZoom]               = useState(1);
  const zoomingDisabled = disableZoom;
  // True for the duration of an actual (primed) pinch gesture — used to
  // lock out everything else a stray second/third contact point could
  // otherwise trigger while the user's fingers are still down, especially
  // text selection (touchInteractionActive below already checks it).
  const [pinchActive, setPinchActive] = useState(false);
  const [splitRatio,     setSplitRatio]    = useState(1);
  const [mdPanelWidth,   setMdPanelWidth]  = useState(340); // resizable width of the Markdown/Actions left column
  const [annotHistoryPanelWidth, setAnnotHistoryPanelWidth] = useState(300);
  const [smartVideoPanelWidth, setSmartVideoPanelWidth] = useState(380);
  const [entityBuilderPanelWidth, setEntityBuilderPanelWidth] = useState(360);
  const [extractionOpen, setExtractionOpen] = useState(false);
  const savedRatioRef                 = useRef(0.42);
  const contentRef                    = useRef(null);
  const toolbarRef                    = useRef(null);
  const toolButtonRefs                = useRef({}); // key -> tool strip button element, used to anchor .annot_tool_options at that button's own position instead of the toolbar's fixed corner
  const toolbarDragStateRef           = useRef(null); // { startX, startY, pointerId } while the drag handle is held
  const fitScaleRef                 = useRef(1);
  const zoomRef                     = useRef(1);
  const extractModeRef              = useRef("ai");
  // Which edge the toolbar is docked to — "top" (the default) and "bottom"
  // are full-width flat bars in normal document flow (never overlapping the
  // PDF pages below/above them); "left" and "right" are full-height flat
  // bars (#pdf_page switches to a row flex layout for these, see
  // pdf_page--toolbar-side below). No floating/overlay mode at all — dragging
  // the single handle button (see handleToolbarHandlePointerDown further
  // down) just reads which direction you dragged and snaps straight to
  // that flat dock, it never visually follows the cursor.
  const [toolbarDock, setToolbarDock] = useState({ edge: "top" });
  const [toolOptionsOffset, setToolOptionsOffset] = useState(0); // .annot_tool_options' own left (top/bottom dock) or top (left/right dock) offset, measured from the active tool's own button — see the effect near annotTool below
  const effectiveToolbarEdge = toolbarHost ? "top" : toolbarDock.edge;

  // Single drag handle (replaces the old 4-button dock pad) — press and
  // drag in any direction; once the drag clears a small dead zone (so an
  // ordinary click/tap never accidentally redocks it), the DOMINANT axis
  // of the drag (whichever of dx/dy is bigger) picks the edge, live,
  // every move tick — same "drag right to dock right" gesture the old
  // floating handle had, just without any floating visual to follow along
  // the way, since every dock is already a flat in-flow bar now.
  const TOOLBAR_DRAG_DEAD_ZONE = 18;
  const handleToolbarHandlePointerDown = useCallback((event) => {
    if (event.button != null && event.button !== 0 && !event.touches) return;
    event.preventDefault();
    const point = (e) => (e.touches ? (e.touches[0] || e.changedTouches[0]) : e);
    const p0 = point(event);
    toolbarDragStateRef.current = { startX: p0.clientX, startY: p0.clientY, pointerId: event.pointerId ?? null };
    if (event.pointerId != null) event.currentTarget.setPointerCapture?.(event.pointerId);
  }, []);

  useEffect(() => {
    const onMove = (event) => {
      const drag = toolbarDragStateRef.current;
      if (!drag || (drag.pointerId != null && event.pointerId !== drag.pointerId)) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < TOOLBAR_DRAG_DEAD_ZONE) return;
      const edge = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "bottom" : "top");
      setToolbarDock((prev) => (prev.edge === edge ? prev : { edge }));
    };
    const onEnd = (event) => {
      const drag = toolbarDragStateRef.current;
      if (!drag || (drag.pointerId != null && event.pointerId !== drag.pointerId)) return;
      toolbarDragStateRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
    };
  }, []);

  const [hyleData, setHyleData]       = useState(null);
  const [hyleFontSize, setHyleFontSize] = useState(1);
  const [hylePage, setHylePage]       = useState(null);
  const [extracting, setExtracting]   = useState(false);
  const [extractError, setExtractError] = useState("");
  const { provider, setProvider }     = useAIProvider();
  const [pdfAssistantOpen, setPdfAssistantOpen] = useState(false);

  // Start with a real drawing tool selected so the toolbar is immediately
  // live when the PDF loads. Panning is still available through the
  // dedicated gesture/mouse paths below, regardless of which tool is
  // selected.
  // Declared here (ahead of most other state) because textSelectable below
  // reads it immediately.
  const [annotTool,      setAnnotTool]      = useState(null);
  const navigationBlocked = Boolean(annotTool && !["shapes", "mdController"].includes(annotTool)); // true only when a real drawing tool is selected
  const toolActive = navigationBlocked;
  const annotToolRef = useRef(null); // mirrors navigationBlocked ? annotTool : null — read inside the pan-gesture effect, whose deps are just [pdfDoc], so annotTool itself would be stale there

  // AI vs Manual toggle
  const extractMode = selectionOnly ? "manual" : (provider === "manual" ? "manual" : "ai");
  // Click/tap-and-hold word selection is part of manual Hyle extraction; in
  // plain reading mode (hideHyleControls) it's simply always on now —
  // double-tap/double-click a word to select it, no separate "Select Text"
  // tool to activate first (there used to be one; removed since dblclick
  // selection doesn't conflict with any drawing tool's own canvas gestures).
  const textSelectable = selectionOnly
    ? true
    : hideHyleControls
      ? true
      : extractMode === "manual";
  const [extractionType, setExtractionType] = useState(null); // selected hyle type key
  const [typeTreeOpen,   setTypeTreeOpen]   = useState(false);

  // Manual selection popup
  const [manualPopup,     setManualPopup]     = useState(null); // { x, y }
  const [manualHyle,      setManualHyle]      = useState("");
  const [manualCard,      setManualCard]      = useState(() => {
    const p = window.location.pathname.split("/").pop();
    return CARDS.find((c) => c.key === p)?.key || "entities";
  });
  const [manualMode,      setManualMode]      = useState("organ");
  // Selection bar — shown before popup; always exactly the double-clicked/
  // double-tapped word, never an expandable range.
  const [manualSelection, setManualSelection] = useState(null); // { startIdx, endIdx, text, x, y }
  // A drag's window-level pointermove listener is only ever (re)attached
  // from a handle's own pointerdown — it does NOT get re-armed just
  // because manualSelection changed and the whole drawing effect below
  // reran (rebuilding the handle elements fresh doesn't retrigger a
  // mousedown). So the onWindowPointerMove closure actively handling an
  // in-progress drag can be "stale" — bound to whatever manualSelection
  // was when the drag started — for the drag's entire duration. This ref
  // is what that stale closure reads instead, so it always sees the real
  // current selection (needed for nearestSpanIndex's locality window, see
  // below) regardless of which render's closure is the one still live.
  const manualSelectionRef = useRef(null);
  useEffect(() => { manualSelectionRef.current = manualSelection; }, [manualSelection]);
  const resolveSpanIndexByKey = useCallback((key) => {
    if (!key) return -1;
    return spansRef.current.findIndex((span) => span?.spanKey === key);
  }, []);
  // Thin selection-bar action state (Translate to / Definition / Linguistic
  // Structure Check) — hideHyleControls reading context only.
  const [selectionToolBusy,   setSelectionToolBusy]   = useState(null); // which action key is in flight, or null
  const [selectionToolResult, setSelectionToolResult] = useState(null); // { label, text }
  const [selectionToolError,  setSelectionToolError]  = useState("");
  const [selectionVerifyBusy, setSelectionVerifyBusy] = useState(false); // AMCTOSHS builder source verification
  // Local/free/deterministic "Correct text" action result (pdfTextCorrection.js)
  // — a full correctSelectedPdfText() return value, distinct from the AI-backed
  // translate/define/linguistic-check tools' simpler { label, text } shape.
  const [correctionResult, setCorrectionResult] = useState(null);

  const [history, setHistory]               = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [saving, setSaving]                 = useState(false);
  const [savedId, setSavedId]               = useState(null);
  const [activeHistoryId, setActiveHistoryId] = useState(null);

  // ── Per-page Markdown preview (toolbar "MD" button + left column) ──────────
  // View-only here: converting a document to Markdown happens from the Sources
  // table (it's a whole-document operation, not a per-page one) — this button
  // just opens the reader for a document that's already been converted there.
  const [hasStoredMarkdown, setHasStoredMarkdown] = useState(false);
  const [pageMdBusy,    setPageMdBusy]    = useState(false);
  const [pageMdError,   setPageMdError]   = useState("");
  const [pageMdOpen,    setPageMdOpen]    = useState(false);
  const [pageMdText,    setPageMdText]    = useState("");
  const [pageMdRange,   setPageMdRange]   = useState(null); // { from, to, all } — which range pageMdText is actually showing
  const [pageMdDeleteBusy, setPageMdDeleteBusy] = useState(false);
  const [mdDraftBusy,  setMdDraftBusy]  = useState(false); // Actions -> Markdown: spinning up (or reopening) a Draft document, separate from the pageMdOpen panel's own busy state
  const [mdDraftError, setMdDraftError] = useState("");
  const [mdPageIdx,     setMdPageIdx]     = useState(0); // index into mdPages — which single real page of the fetched range is displayed
  const [mdPageInputVal, setMdPageInputVal] = useState("1"); // editable page-number field's raw text, synced from mdCurrentPage.page
  const [mdViewMode, setMdViewMode] = useState("draft"); // "draft" | "ocr" — cleaned reader view vs persisted OCR markdown
  const [pdfMdCountHighlight, setPdfMdCountHighlight] = useState(null); // null | "words" | "chars" — which markdown count is currently overlaid on the PDF page
  const [mdFontScale,   setMdFontScale]   = useState(1); // multiplier on the panel's base rem size — relative, so it scales with the root font-size same as everything else
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceQuery,     setVoiceQuery]     = useState("");
  const [voiceMatch,     setVoiceMatch]     = useState(null); // { start, end } char indices local to the displayed md page's text, or null
  const [voiceError,     setVoiceError]     = useState("");
  const voiceRecognitionRef = useRef(null);

  // Split the fetched range's Markdown into one chunk per real PDF page (the
  // server always tags each page with a "=== Page N ===" line via
  // pageMarkers=1) so the panel can show — and count — a single page at a
  // time instead of the whole range at once.
  const mdPages = useMemo(() => {
    const text = pageMdText || "";
    const re = /^=== Page (\d+) ===\r?\n?/gm;
    const marks = [...text.matchAll(re)];
    if (marks.length === 0) return text ? [{ page: pageMdRange?.from ?? pageNum, text, startOffset: 0 }] : [];
    return marks.map((m, i) => {
      const start = m.index + m[0].length;
      const end   = i + 1 < marks.length ? marks[i + 1].index : text.length;
      return { page: Number(m[1]), text: text.slice(start, end), startOffset: start };
    });
  }, [pageMdText, pageMdRange, pageNum]);

  // Which real page to land on once a fresh fetch's mdPages are ready — set
  // right before calling fetchMarkdownRange so the reset effect below can
  // jump straight to it instead of always defaulting to the first page.
  const mdFocusPageRef = useRef(null);
  useEffect(() => {
    const idx = mdFocusPageRef.current != null ? mdPages.findIndex((p) => p.page === mdFocusPageRef.current) : -1;
    setMdPageIdx(idx >= 0 ? idx : 0);
    mdFocusPageRef.current = null;
  }, [pageMdText]); // eslint-disable-line react-hooks/exhaustive-deps

  const mdCurrentPage = mdPages[mdPageIdx] || mdPages[0] || { page: pageNum, text: "", startOffset: 0 };
  useEffect(() => { setMdPageInputVal(String(mdCurrentPage.page)); }, [mdCurrentPage.page]);
  const cleanedMdCurrentText = useMemo(() => cleanMarkdownToPlainText(mdCurrentPage.text || ""), [mdCurrentPage.text]);
  const mdChars = useMemo(() => Array.from(cleanedMdCurrentText || ""), [cleanedMdCurrentText]);
  const mdStats = useMemo(() => ({
    words: (cleanedMdCurrentText.match(/\S+/g) || []).length,
    chars: mdChars.length,
  }), [cleanedMdCurrentText, mdChars]);

  // Bring a page into view in the main reader — fired by the word/char
  // counter buttons and by the panel's own page navigation, so the reader
  // always shows the page currently displayed in the panel.
  const scrollReaderToPage = useCallback((page) => {
    setPageNum(page);
  }, []);

  const showMarkdownPageInPdf = useCallback((mode) => {
    const targetPage = mdCurrentPage.page;
    setPdfMdCountHighlight((prev) => {
      const next = prev === mode ? null : mode;
      if (!next) return null;
      if (splitRatio === 0) setSplitRatio(savedRatioRef.current || 0.42);
      setPageNum(targetPage);
      setZoom(1);
      scrollReaderToPage(targetPage);
      return next;
    });
  }, [mdCurrentPage.page, scrollReaderToPage, splitRatio]);

  const toggleAnnotTool = useCallback((key) => {
    // Smart Video's aside is only ever closed by re-pressing this same
    // button while it's already the active tool (see the annotTool effect
    // near the smartVideo* state — it opens smartVideoOpen but never closes
    // it, precisely so switching to a different tool, e.g. Pen, leaves the
    // aside's results/screenshots visible instead of yanking them away).
    if (key === "smartVideo" && annotTool === "smartVideo") setSmartVideoOpen(false);
    setAnnotTool((current) => (current === key ? null : key));
    setColorMenuOpen(false);
  }, [annotTool]);

  // Shared button renderer for both DRAWING_TOOL_ORDER (.annot_tool_strip)
  // and MODE_TOOL_ORDER (.annot_mode_strip) — every plain annotTool button
  // (everything except the "shapes" group-opener, which has its own
  // active-state logic across all four SHAPE_TOOL_KEYS) follows the exact
  // same select/toggle pattern regardless of which group it
  // renders in.
  const renderAnnotToolButton = (key) => {
    if (key === "shapes") {
      const shapesActive = SHAPE_TOOL_KEYS.includes(annotTool);
      return (
        <button
          key="shapes"
          ref={(el) => { toolButtonRefs.current.shapes = el; }}
          type="button"
          className={`annot_trigger annot_tool_btn${(shapesActive || annotTool === "shapes") ? " annot_trigger--active" : ""}${pdfToolbarSettingsSaving && (shapesActive || annotTool === "shapes") ? " annot_tool_btn--saving" : ""}`}
          onClick={() => {
            setAnnotTool((current) => (current === "shapes" ? null : "shapes"));
            setColorMenuOpen(false);
          }}
          title="Shapes"
          aria-label="Shapes"
        >
          <ShapesToolIcon />
        </button>
      );
    }
    const tool = ANNOT_TOOLS.find((item) => item.key === key);
    if (!tool) return null;
    return (
      <React.Fragment key={key}>
        {key === "highlight" && <span className="annot_tool_separator" aria-hidden="true" />}
        <button
          ref={(el) => { toolButtonRefs.current[key] = el; }}
          type="button"
          className={`annot_trigger annot_tool_btn${annotTool === key ? " annot_trigger--active" : ""}${pdfToolbarSettingsSaving && annotTool === key ? " annot_tool_btn--saving" : ""}`}
          onClick={() => toggleAnnotTool(key)}
          title={tool.label}
          aria-label={tool.label}
        >
          {isPenToolKey(key) ? <PenToolIcon /> : tool.iconSvg || <i className={tool.icon} />}
        </button>
      </React.Fragment>
    );
  };

  // ── Annotation History (toolbar "History" button + left column) ────────────
  // A running, in-session log of every annotation step taken (add/undo/redo/
  // clear), independent of the annotations themselves — so you can see what
  // you did and when, not just the current end result.
  const [annotHistory,     setAnnotHistory]     = useState([]);
  const [annotHistoryOpen, setAnnotHistoryOpen] = useState(false);
  const [annotHistorySource, setAnnotHistorySource] = useState("pdf");
  const [activeAnnotationSurface, setActiveAnnotationSurface] = useState("pdf");
  const appendAnnotHistoryEntry = useCallback((history, entry) => (
    [...history, { id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, time: new Date(), ...entry }].slice(-300)
  ), []);
  const logAnnotHistory = useCallback((entry) => {
    setAnnotHistory((prev) => appendAnnotHistoryEntry(prev, entry));
  }, [appendAnnotHistoryEntry]);
  // Deleting a SINGLE annotation (text/highlight/bbox action-menu "Delete")
  // used to always append a brand new "Deleted ..." row — leaving the
  // original "Added ..." row for that same annotation sitting further up
  // the log looking like it's still active. Marking that original row
  // cleared in place is the more honest record: one row per annotation,
  // its own current status, not two disconnected rows for the same thing.
  // Only possible for annotations added after annotationId started being
  // logged (see the "add" call sites) and whose row hasn't aged out of the
  // 300-entry cap — falls back to the old standalone "delete" row otherwise.
  const markAnnotationCleared = useCallback((annotationId, page, type) => {
    const match = annotHistory.find((h) => h.action === "add" && h.annotationId === annotationId);
    if (!match) {
      logAnnotHistory({ action: "delete", type, page });
      return;
    }
    setAnnotHistory((prev) => prev.map((h) => (h.id === match.id ? { ...h, clearedAt: new Date() } : h)));
  }, [annotHistory, logAnnotHistory]);

  // ── Smart Video Search ("Extract Eidos and Find Videos") ────────────────────
  // A tool-strip tool (annotTool === "smartVideo", next to eraser). Selecting
  // it mounts the far-left <SmartVideoPanel> aside immediately (see the
  // effect below) — the same slot pattern as #pdf_annot_history_panel/
  // #pdf_md_panel — but dragging on the page does NOT start capturing until
  // the aside's own "Start selecting" button is pressed (smartVideoSelecting),
  // so opening the tool/aside to review past results never risks an
  // accidental capture. While armed, dragging captures a screenshot of that
  // area instead of drawing an annotation (see the smartVideoCapture branch
  // in the annotation-drawing effect below); each capture is OCR'd
  // (captureSmartVideoScreenshot) and collected into smartVideoScreenshots,
  // previewed as thumbnails in the aside — multiple captures are expected
  // before "Find Videos" is pressed. handleSmartVideoSearch then
  // concatenates their recognized text, calls POST /api/concepts/extract,
  // then POST /api/youtube/concept-search, and shows the result in the same aside.
  const [smartVideoOpen,   setSmartVideoOpen]   = useState(false);
  const [smartVideoSelecting, setSmartVideoSelecting] = useState(false);
  const [smartVideoStage,  setSmartVideoStage]  = useState(""); // "" | "extracting" | "searching" | "done"
  const [smartVideoError,  setSmartVideoError]  = useState("");
  const [smartVideoEidos,  setSmartVideoEidos]  = useState(null);
  const [smartVideoVideos, setSmartVideoVideos] = useState([]);
  const [smartVideoActiveVideoId, setSmartVideoActiveVideoId] = useState(null);
  const [smartVideoDifficulty, setSmartVideoDifficulty] = useState(
    () => localStorage.getItem("mctosh_smart_video_difficulty") || "intermediate",
  );
  useEffect(() => { localStorage.setItem("mctosh_smart_video_difficulty", smartVideoDifficulty); }, [smartVideoDifficulty]);
  // Video Preferences panel (hard filters exclude, ranking preferences only
  // reorder — see back/helpers/videoFilters.js vs back/helpers/
  // videoScoring.js). Shape matches HardFiltersSchema/RankingPreferencesSchema
  // in back/validation/conceptSchemas.js exactly, so it can be spread
  // straight into the concept-search request body with no translation layer.
  const DEFAULT_SMART_VIDEO_PREFERENCES = {
    hardFilters: { language: [], maxDurationMinutes: null, minDurationMinutes: null, captionsRequired: false },
    rankingPreferences: { preferredStyles: [], learningGoal: undefined, preferAcademicSources: false, clinicalFocus: undefined, recencyWeight: 0, popularityWeight: 0.5, strictRelevance: false },
    maxResults: 6,
  };
  const [smartVideoPreferences, setSmartVideoPreferences] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("mctosh_smart_video_preferences") || "null");
      return saved ? { ...DEFAULT_SMART_VIDEO_PREFERENCES, ...saved } : DEFAULT_SMART_VIDEO_PREFERENCES;
    } catch { return DEFAULT_SMART_VIDEO_PREFERENCES; }
  });
  useEffect(() => { localStorage.setItem("mctosh_smart_video_preferences", JSON.stringify(smartVideoPreferences)); }, [smartVideoPreferences]);
  const [smartVideoPreferencesOpen, setSmartVideoPreferencesOpen] = useState(false);
  // { id, dataUrl, text, pageNum, status: "reading"|"done"|"empty"|"error" }[]
  const [smartVideoScreenshots, setSmartVideoScreenshots] = useState([]);
  const [smartVideoCaptureBusy, setSmartVideoCaptureBusy] = useState(false);
  // providerId -> model, from the SAME /api/settings/ai-status the Settings
  // page's AI Providers section already uses (DB override, else env var,
  // else its own defaultModel — one source of truth, instead of yet another
  // hardcoded provider->model map going stale here the way aiClient.js's did).
  // Shared by every "you are using: <provider>" footer in this page (Smart
  // Video Search, the AMCTOSHS Clinical Vignette Generator) — one fetch,
  // cached, not a per-tool copy.
  const [aiProviderModels, setAiProviderModels] = useState({});
  const fetchAiProviderModelsOnce = useCallback(() => {
    if (Object.keys(aiProviderModels).length) return;
    authFetch(apiUrl("/api/settings/ai-status"))
      .then((res) => res.json())
      .then((data) => {
        const byId = {};
        for (const p of data.providers || []) byId[p.id] = p.model;
        setAiProviderModels(byId);
      })
      .catch(() => {}); // footer just falls back to provider-only if this fails
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiProviderModels]);
  useEffect(() => {
    if (!pdfAssistantOpen) return;
    fetchAiProviderModelsOnce();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfAssistantOpen]);
  // Mount the aside the moment the tool is picked; leaving the tool disarms
  // capture mode so switching away and back always requires an explicit
  // "Start selecting" press again, never a silently-still-armed drag.
  useEffect(() => {
    if (annotTool !== "smartVideo") { setSmartVideoSelecting(false); return; }
    setSmartVideoOpen(true);
    fetchAiProviderModelsOnce();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotTool]);

  // "Saved" view (see the bookmark toggle in SmartVideoPanel's header) —
  // POST/GET/DELETE /api/concepts/saved, a snapshot of eidos+videos so a
  // saved entry reopens exactly as it looked when saved, not a live re-query.
  const [smartVideoSavedOpen, setSmartVideoSavedOpen] = useState(false);
  const [smartVideoSaved, setSmartVideoSaved] = useState([]);
  const [smartVideoSavedLoading, setSmartVideoSavedLoading] = useState(false);
  const [smartVideoSaveBusy, setSmartVideoSaveBusy] = useState(false);
  const [smartVideoSavedId, setSmartVideoSavedId] = useState(null); // id of the currently-shown eidos, once saved

  const fetchSmartVideoSaved = useCallback(async () => {
    setSmartVideoSavedLoading(true);
    try {
      const res = await authFetch(apiUrl("/api/concepts/saved"));
      const data = await res.json();
      if (data.error) throw new Error(describeApiError(data, "Failed to load saved concepts."));
      setSmartVideoSaved(data.saved || []);
    } catch (e) {
      setSmartVideoError(e.message || "Failed to load saved concepts.");
    } finally {
      setSmartVideoSavedLoading(false);
    }
  }, []);

  const toggleSmartVideoSaved = useCallback(() => {
    setSmartVideoPreferencesOpen(false); // mutually exclusive with Preferences — see SmartVideoPanel.jsx's body ternary
    setSmartVideoSavedOpen((open) => {
      const next = !open;
      if (next) fetchSmartVideoSaved();
      return next;
    });
  }, [fetchSmartVideoSaved]);

  const toggleSmartVideoPreferences = useCallback(() => {
    setSmartVideoSavedOpen(false);
    setSmartVideoPreferencesOpen((open) => !open);
  }, []);

  const saveSmartVideoConcept = useCallback(async () => {
    if (!smartVideoEidos || smartVideoSaveBusy) return;
    setSmartVideoSaveBusy(true);
    try {
      // Explicit field list, not a `...smartVideoEidos` spread — the eidos
      // object also carries searchQueries/negativeTerms (only meaningful as
      // search INPUT, not as something worth persisting on a saved
      // concept), which SaveConceptRequestSchema's .strict() rejects
      // outright as unrecognized keys.
      const res = await authFetch(apiUrl("/api/concepts/saved"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          surfaceText: smartVideoEidos.surfaceText,
          eidos: smartVideoEidos.eidos,
          canonicalConcept: smartVideoEidos.canonicalConcept,
          concepts: smartVideoEidos.concepts,
          domain: smartVideoEidos.domain,
          summary: smartVideoEidos.summary,
          prerequisites: smartVideoEidos.prerequisites,
          relatedConcepts: smartVideoEidos.relatedConcepts,
          ambiguities: smartVideoEidos.ambiguities,
          language: smartVideoEidos.language,
          difficulty: smartVideoEidos.difficulty,
          learningIntent: smartVideoEidos.learningIntent,
          provider: smartVideoEidos.provider,
          model: smartVideoEidos.model,
          documentTitle: filename || "",
          videos: smartVideoVideos,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(describeApiError(data, "Failed to save concept."));
      setSmartVideoSavedId(data.id);
    } catch (e) {
      setSmartVideoError(e.message || "Failed to save concept.");
    } finally {
      setSmartVideoSaveBusy(false);
    }
  }, [smartVideoEidos, smartVideoVideos, smartVideoSaveBusy, filename]);

  const loadSmartVideoSaved = useCallback((saved) => {
    setSmartVideoSavedOpen(false);
    setSmartVideoError("");
    setSmartVideoStage("done");
    setSmartVideoEidos(saved);
    setSmartVideoVideos(saved.videos || []);
    setSmartVideoActiveVideoId(null);
    setSmartVideoSavedId(saved.id);
  }, []);

  const deleteSmartVideoSaved = useCallback(async (id) => {
    setSmartVideoSaved((prev) => prev.filter((s) => s.id !== id)); // optimistic
    try {
      const res = await authFetch(apiUrl(`/api/concepts/saved/${id}`), { method: "DELETE" });
      const data = await res.json();
      if (data.error) throw new Error(describeApiError(data, "Failed to delete saved concept."));
      if (smartVideoSavedId === id) setSmartVideoSavedId(null);
    } catch (e) {
      setSmartVideoError(e.message || "Failed to delete saved concept.");
      fetchSmartVideoSaved(); // undo the optimistic removal by re-syncing with the server
    }
  }, [smartVideoSavedId, fetchSmartVideoSaved]);

  // ── AMCTOSHS Illumination (formerly "AMCTOSHS Entity Builder") ─────────
  // It only builds from explicit user-provided text: the latest manual
  // text selection or text typed into the panel. It intentionally does not
  // read the current page text.
  const [entityBuilderSelectedText, setEntityBuilderSelectedText] = useState("");
  const [markdownAsideOpen, setMarkdownAsideOpen] = useState(false);
  const [markdownModeMenuOpen, setMarkdownModeMenuOpen] = useState(false);
  const [markdownModeMenuPosition, setMarkdownModeMenuPosition] = useState(null);
  const [markdownAsideMode, setMarkdownAsideMode] = useState("raw");
  const [markdownRetainedVisualMode, setMarkdownRetainedVisualMode] = useState(null);
  const [notebookMode, setNotebookMode] = useState(null);
  const [notebookText, setNotebookText] = useState("");
  const [notebookSttStatus, setNotebookSttStatus] = useState("idle");
  const [notebookSttError, setNotebookSttError] = useState("");
  const [notebookControlMode, setNotebookControlMode] = useState(false);
  const [notebookActiveTab, setNotebookActiveTab] = useState("typing");
  const [notebookVoiceCommands, setNotebookVoiceCommands] = useState(NOTEBOOK_VOICE_COMMANDS);
  const [notebookAnnotations, setNotebookAnnotations] = useState([]);
  const [notebookUndoStack, setNotebookUndoStack] = useState([]);
  const [notebookRedoStack, setNotebookRedoStack] = useState([]);
  const [notebookDrawingTextInput, setNotebookDrawingTextInput] = useState(null);
  const [notebookDrawingZoom, setNotebookDrawingZoom] = useState(1);
  const notebookControlModeRef = useRef(false);
  const handleNotebookVoiceCommandRef = useRef(null);
  const notebookEditorRef = useRef(null);
  const notebookDrawingSurfaceRef = useRef(null);
  const notebookDrawingCanvasRef = useRef(null);
  const notebookDrawingPaintRef = useRef(() => {});
  const notebookDrawingViewRef = useRef({ scale: 1, x: 0, y: 0 });
  const notebookDrawingZoomTimerRef = useRef(null);
  const notebookSttRef = useRef(null);
  const notebookSttStartIdRef = useRef(0);
  const publishNotebookDrawingZoom = useCallback((scale) => {
    if (notebookDrawingZoomTimerRef.current) clearTimeout(notebookDrawingZoomTimerRef.current);
    notebookDrawingZoomTimerRef.current = setTimeout(() => {
      notebookDrawingZoomTimerRef.current = null;
      setNotebookDrawingZoom(scale);
    }, 100);
  }, []);
  const zoomNotebookDrawingAt = useCallback((nextZoom, clientX, clientY) => {
    const surface = notebookDrawingSurfaceRef.current;
    if (!surface) return;
    const rect = surface.getBoundingClientRect();
    const view = notebookDrawingViewRef.current;
    const target = normalizeZoom(typeof nextZoom === "function" ? nextZoom(view.scale) : nextZoom);
    if (target === view.scale) return;
    const pointX = Number.isFinite(clientX) ? clientX - rect.left : rect.width / 2;
    const pointY = Number.isFinite(clientY) ? clientY - rect.top : rect.height / 2;
    const ratio = target / view.scale;
    view.x = pointX - (pointX - view.x) * ratio;
    view.y = pointY - (pointY - view.y) * ratio;
    view.scale = target;
    publishNotebookDrawingZoom(target);
    notebookDrawingPaintRef.current();
  }, [publishNotebookDrawingZoom]);
  useEffect(() => () => {
    if (notebookDrawingZoomTimerRef.current) clearTimeout(notebookDrawingZoomTimerRef.current);
  }, []);
  const saveNotebookAnnotations = useCallback((nextAnnotations) => {
    const sourceId = currentSourceIdRef.current || embeddedSourceId || null;
    if (!sourceId) return;
    void authFetch(apiUrl(`/api/source-annotations/${sourceId}`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notebookAnnotations: nextAnnotations }),
    }).catch((error) => console.error("[PDF] Failed to save Notebook annotations", error));
  }, [embeddedSourceId]);
  useEffect(() => { notebookControlModeRef.current = notebookControlMode; }, [notebookControlMode]);
  const notebookControlLines = useMemo(() => {
    let offset = 0;
    return notebookText.split("\n").map((line, lineIndex) => {
      const words = [];
      const wordPattern = /\S+/g;
      let match;
      while ((match = wordPattern.exec(line))) {
        words.push({
          number: words.length + 1,
          text: match[0],
          start: offset + match.index,
          end: offset + match.index + match[0].length,
        });
      }
      offset += line.length + 1;
      return { number: lineIndex + 1, text: line, words };
    });
  }, [notebookText]);
  const spokenNumber = useCallback((value) => {
    const tokens = String(value || "")
      .toUpperCase()
      .replace(/[^A-Z0-9\s-]/g, " ")
      .split(/[\s-]+/)
      .filter(Boolean);
    if (!tokens.length) return null;
    const digits = tokens.map((token) => NUMBER_WORDS[token] ?? (/^\d+$/.test(token) ? token : null));
    if (digits.some((digit) => digit == null)) return null;
    return Number(digits.join(""));
  }, []);
  const handleNotebookVoiceCommand = useCallback((spokenCommand) => {
    const normalized = String(spokenCommand || "")
      .replace(/[^\p{L}\p{N}\s-]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
    const configuredCommands = notebookVoiceCommands.map((template, index) => (
      compileNotebookVoiceCommand(template, NOTEBOOK_VOICE_COMMAND_ACTIONS[index])
    )).filter(Boolean);
    let resolved = null;
    for (const command of configuredCommands) {
      const match = normalized.match(command.pattern);
      if (!match) continue;
      const values = {};
      command.captures.forEach((name, index) => { values[name] = match[index + 1]; });
      resolved = { action: command.action, ...values };
      break;
    }
    if (!resolved) {
      setNotebookSttError(`Command not recognized. Configured commands: ${notebookVoiceCommands.filter(Boolean).join(" | ")}`);
      return false;
    }
    const { action } = resolved;
    const lineNumber = spokenNumber(resolved.line);
    const wordNumber = spokenNumber(resolved.word);
    const line = notebookControlLines[lineNumber - 1];
    const word = line?.words[wordNumber - 1];
    if (!line || !word) {
      setNotebookSttError(`No word W${wordNumber} exists on line L${lineNumber}.`);
      return false;
    }
    const editor = notebookEditorRef.current;
    if (action === "delete") {
      setNotebookText((current) => `${current.slice(0, word.start)}${current.slice(word.end)}`);
      editor?.focus({ preventScroll: true });
      editor?.setSelectionRange(word.start, word.start);
    } else {
      const newValue = String(resolved.value || "").trim();
      if (!newValue) {
        setNotebookSttError("The Edit command needs a new value.");
        return false;
      }
      setNotebookText((current) => `${current.slice(0, word.start)}${newValue}${current.slice(word.end)}`);
      window.requestAnimationFrame(() => {
        const currentEditor = notebookEditorRef.current;
        currentEditor?.focus({ preventScroll: true });
        const end = currentEditor?.value?.length ?? notebookText.length - word.text.length + newValue.length;
        currentEditor?.setSelectionRange(end, end);
      });
    }
    setNotebookSttError("");
    return true;
  }, [notebookControlLines, notebookText, notebookVoiceCommands, spokenNumber]);
  handleNotebookVoiceCommandRef.current = handleNotebookVoiceCommand;
  const appendNotebookSpeech = useCallback((spokenText) => {
    const text = String(spokenText || "").trim();
    if (!text) return;
    setNotebookText((current) => `${current}${current && !/\s$/.test(current) ? " " : ""}${text}`);
  }, []);
  const stopNotebookStt = useCallback(() => {
    notebookSttStartIdRef.current += 1;
    const session = notebookSttRef.current;
    if (!session) {
      setNotebookSttStatus("idle");
      return;
    }
    session.stopped = true;
    session.abortController?.abort();
    if (session.kind === "browser") {
      session.recognition.onresult = null;
      session.recognition.onend = null;
      session.recognition.onerror = null;
      try { session.recognition.abort?.(); } catch {}
      try { session.recognition.stop?.(); } catch {}
    } else if (session.kind === "local-whisper") {
      window.clearTimeout(session.chunkTimer);
      if (session.recorder) {
        session.recorder.ondataavailable = null;
        session.recorder.onstop = null;
        session.recorder.onerror = null;
        try { if (session.recorder.state !== "inactive") session.recorder.stop(); } catch {}
      }
    } else {
      session.dataChannel?.close?.();
      session.peerConnection?.close?.();
      if (session.recorder?.state !== "inactive") session.recorder.stop();
    }
    session.stream?.getTracks().forEach((track) => {
      track.enabled = false;
      track.stop();
    });
    notebookSttRef.current = null;
    setNotebookSttStatus("idle");
  }, []);
  const toggleNotebookStt = useCallback(async (requestedProvider = null) => {
    if (notebookSttRef.current) {
      stopNotebookStt();
      return;
    }
    setNotebookSttError("");
    const startId = notebookSttStartIdRef.current + 1;
    notebookSttStartIdRef.current = startId;
    const settings = readSttSettings();
    const provider = Object.values(STT_PROVIDERS).includes(requestedProvider)
      ? requestedProvider
      : settings.provider;
    if (provider === STT_PROVIDERS.LOCAL_WHISPER) {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
        setNotebookSttError("Local Whisper needs microphone and MediaRecorder support.");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (notebookSttStartIdRef.current !== startId) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]
          .find((candidate) => MediaRecorder.isTypeSupported?.(candidate)) || "";
        const session = {
          kind: "local-whisper",
          recorder: null,
          chunkTimer: 0,
          stream,
          uploadChain: Promise.resolve(),
          abortController: new AbortController(),
          stopped: false,
        };
        notebookSttRef.current = session;
        setNotebookSttStatus("listening");

        const queueChunkUpload = (audioBlob, extension) => {
          session.uploadChain = session.uploadChain.then(async () => {
            if (session.stopped || notebookSttRef.current !== session) return;
            const body = new FormData();
            body.append("audio", audioBlob, `notebook-${Date.now()}.${extension}`);
            const response = await authFetch(apiUrl("/api/ai/transcribe-local"), {
              method: "POST",
              body,
              signal: session.abortController.signal,
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error?.message || "Local Whisper transcription failed.");
            const transcript = String(data.text || "").trim();
            if (!transcript || session.stopped || notebookSttRef.current !== session) return;
            if (notebookControlModeRef.current) handleNotebookVoiceCommandRef.current?.(transcript);
            else appendNotebookSpeech(transcript);
          }).catch((error) => {
            if (notebookSttRef.current === session && !session.stopped && error.name !== "AbortError") {
              stopNotebookStt();
              setNotebookSttError(error.message || "Local Whisper transcription failed.");
            }
          });
        };

        const startCompleteChunk = () => {
          if (session.stopped || notebookSttRef.current !== session) return;
          const chunks = [];
          const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
          session.recorder = recorder;
          recorder.ondataavailable = (event) => {
            if (event.data?.size) chunks.push(event.data);
          };
          recorder.onerror = () => {
            if (notebookSttRef.current !== session || session.stopped) return;
            stopNotebookStt();
            setNotebookSttError("Local microphone recording failed.");
          };
          recorder.onstop = () => {
            window.clearTimeout(session.chunkTimer);
            if (session.stopped || notebookSttRef.current !== session) return;
            const audioBlob = new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" });
            const extension = audioBlob.type.includes("mp4") ? "m4a" : audioBlob.type.includes("ogg") ? "ogg" : "webm";
            if (audioBlob.size) queueChunkUpload(audioBlob, extension);
            startCompleteChunk();
          };
          recorder.start();
          session.chunkTimer = window.setTimeout(() => {
            if (!session.stopped && recorder.state === "recording") recorder.stop();
          }, 3500);
        };
        startCompleteChunk();
      } catch (error) {
        setNotebookSttStatus("idle");
        setNotebookSttError(error.name === "NotAllowedError" ? "Microphone access was denied." : error.message || "Could not start local Whisper.");
      }
      return;
    }
    if (provider === STT_PROVIDERS.BROWSER) {
      if (!SpeechRecognition) {
        setNotebookSttError("Browser speech recognition is unavailable.");
        return;
      }
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.lang = "en-US";
      recognition.onresult = (event) => {
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          if (event.results[index].isFinal) {
            const transcript = event.results[index][0].transcript;
            if (notebookControlModeRef.current) handleNotebookVoiceCommandRef.current?.(transcript);
            else appendNotebookSpeech(transcript);
          }
        }
      };
      recognition.onerror = (event) => {
        setNotebookSttError(event.error === "not-allowed" ? "Microphone access was denied." : "Speech recognition failed.");
        notebookSttRef.current = null;
        setNotebookSttStatus("idle");
      };
      recognition.onend = () => {
        if (notebookSttRef.current?.recognition === recognition) {
          notebookSttRef.current = null;
          setNotebookSttStatus("idle");
        }
      };
      notebookSttRef.current = { kind: "browser", recognition };
      setNotebookSttStatus("listening");
      try { recognition.start(); } catch (error) {
        notebookSttRef.current = null;
        setNotebookSttStatus("idle");
        setNotebookSttError(error.message || "Could not start speech recognition.");
      }
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
      setNotebookSttError("OpenAI speech input is unavailable on this device.");
      return;
    }
    try {
      notebookSttRef.current = { kind: "starting", startId };
      setNotebookSttStatus("listening");
      const tokenResponse = await authFetch(apiUrl("/api/ai/realtime-token"), { method: "POST" });
      const tokenData = await tokenResponse.json().catch(() => ({}));
      if (!tokenResponse.ok || !tokenData.value) {
        throw new Error(tokenData?.error?.message || tokenData?.error || "Could not start realtime speech input.");
      }
      if (notebookSttStartIdRef.current !== startId) return;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (notebookSttStartIdRef.current !== startId) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const peerConnection = new RTCPeerConnection();
      stream.getTracks().forEach((track) => peerConnection.addTrack(track, stream));
      const dataChannel = peerConnection.createDataChannel("oai-events");
      const session = { kind: "openai-realtime", startId, peerConnection, dataChannel, stream, insertedText: false };
      notebookSttRef.current = session;
      dataChannel.addEventListener("open", () => {
        dataChannel.send(JSON.stringify({
          type: "session.update",
          session: {
            type: "transcription",
            audio: {
              input: {
                format: { type: "audio/pcm", rate: 24000 },
                transcription: { model: normalizeOpenAiSttModel(settings.model) },
                turn_detection: { type: "server_vad" },
              },
            },
          },
        }));
      });
      dataChannel.addEventListener("message", (event) => {
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        if (message.type === "conversation.item.input_audio_transcription.delta") {
          const delta = String(message.delta || "");
          if (!delta) return;
          setNotebookText((current) => {
            const separator = !session.insertedText && current && !/\s$/.test(current) ? " " : "";
            session.insertedText = true;
            return `${current}${separator}${delta}`;
          });
        } else if (message.type === "conversation.item.input_audio_transcription.completed" && !session.insertedText) {
          appendNotebookSpeech(message.transcript);
        } else if (message.type === "error") {
          setNotebookSttError(message.error?.message || "Realtime speech recognition failed.");
        }
      });
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      if (notebookSttStartIdRef.current !== startId) {
        dataChannel.close();
        peerConnection.close();
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const sdpResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        body: offer.sdp,
        headers: { Authorization: `Bearer ${tokenData.value}`, "Content-Type": "application/sdp" },
      });
      if (!sdpResponse.ok) throw new Error("Could not connect to realtime speech input.");
      await peerConnection.setRemoteDescription({ type: "answer", sdp: await sdpResponse.text() });
      if (notebookSttStartIdRef.current !== startId || notebookSttRef.current !== session) {
        dataChannel.close();
        peerConnection.close();
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      setNotebookSttStatus("listening");
    } catch (error) {
      const session = notebookSttRef.current;
      session?.dataChannel?.close?.();
      session?.peerConnection?.close?.();
      session?.stream?.getTracks().forEach((track) => track.stop());
      notebookSttRef.current = null;
      setNotebookSttStatus("idle");
      if (notebookSttStartIdRef.current === startId) {
        setNotebookSttError(error.name === "NotAllowedError" ? "Microphone access was denied." : error.message || "Could not start speech input.");
      }
    }
  }, [appendNotebookSpeech, stopNotebookStt]);
  useEffect(() => () => stopNotebookStt(), [stopNotebookStt]);
  const [mdLineSpacing, setMdLineSpacing] = useState(0);
  const [mdSpacingTarget, setMdSpacingTarget] = useState("str");
  const [mdOpenLineId, setMdOpenLineId] = useState(null);
  const [mdLineOrders, setMdLineOrders] = useState({});
  const [mdLineTagsVisible, setMdLineTagsVisible] = useState(true);
  const markdownVisualMode = markdownAsideMode.includes("visual")
    ? markdownAsideMode
    : markdownRetainedVisualMode;
  const markdownVisualActive = markdownAsideOpen && Boolean(markdownVisualMode);
  const [entityBuilderOpen, setEntityBuilderOpen] = useState(false);
  const markdownVisualLayerRef = useRef(null);
  const markdownAnnotationCanvasRef = useRef(null);
  const [markdownAsideColumnGroup, setMarkdownAsideColumnGroup] = useState("text");
  const [entityBuilderOcrBlankPageOpen, setEntityBuilderOcrBlankPageOpen] = useState(false);
  const [entityBuilderOcrBlankPageBusy, setEntityBuilderOcrBlankPageBusy] = useState(false);
  const [entityBuilderOcrBlankPageError, setEntityBuilderOcrBlankPageError] = useState("");
  const [entityBuilderBlankPageMode, setEntityBuilderBlankPageMode] = useState("raw");
  const [entityBuilderRawColumnGroup, setEntityBuilderRawColumnGroup] = useState("text");
  const [entityBuilderRawValueQuery, setEntityBuilderRawValueQuery] = useState("");
  const [entityBuilderRawBlankPageRows, setEntityBuilderRawBlankPageRows] = useState([]);
  const [pymupdfPageExtraction, setPymupdfPageExtraction] = useState(null);
  const [pymupdfExtractionBusy, setPymupdfExtractionBusy] = useState(false);
  const pymupdfDocumentIdRef = useRef(null);
  const pymupdfSourceIdRef = useRef(null);
  const pymupdfPageCacheRef = useRef(new Map());
  const [entityBuilderOmittedRawCategories, setEntityBuilderOmittedRawCategories] = useState(() => new Set());
  const [entityBuilderVisualFocusId, setEntityBuilderVisualFocusId] = useState(null);
  const [entityBuilderRawBlankPageMeta, setEntityBuilderRawBlankPageMeta] = useState({ pageWidth: 0, pageHeight: 0, viewportScale: 0, pageRotation: 0, mediaBox: [] });
  const [entityBuilderVisualRawBlankPageText, setEntityBuilderVisualRawBlankPageText] = useState("");
  const [entityBuilderOcrBlankPageAnnotations, setEntityBuilderOcrBlankPageAnnotations] = useState([]);
  const [entityBuilderTesseractRows, setEntityBuilderTesseractRows] = useState([]);
  const [entityBuilderTesseractMeta, setEntityBuilderTesseractMeta] = useState({ pageWidth: 0, pageHeight: 0, pageNumber: 0, renderDpi: 200, coordinateSpace: "ocr_page_pixels" });
  const [entityBuilderTesseractBusy, setEntityBuilderTesseractBusy] = useState(false);
  const [entityBuilderTesseractError, setEntityBuilderTesseractError] = useState("");
  const [entityBuilderEmptyAreaHighlightsOpen, setEntityBuilderEmptyAreaHighlightsOpen] = useState(false);

  useEffect(() => {
    setEntityBuilderOmittedRawCategories(new Set());
    setMdLineOrders({});
    setMdOpenLineId(null);
  }, [pageNum]);

  useEffect(() => {
    const sourceId = currentSourceIdRef.current;
    if (!hasSourceId || !sourceId || !filename || !pageCount || !pageNum) {
      setPymupdfPageExtraction(null);
      return undefined;
    }
    let cancelled = false;
    const loadPyMuPDF = async () => {
      setPymupdfExtractionBusy(true);
      try {
        if (pymupdfSourceIdRef.current !== sourceId) {
          const resolvedDocumentId = await resolveDocumentId({
            filename,
            pageCount,
            type: pdfType || "text-based",
            sourceId,
          });
          if (!/^[a-f\d]{24}$/i.test(String(resolvedDocumentId || "").trim())) {
            throw new Error("The PDF document identity could not be resolved.");
          }
          pymupdfDocumentIdRef.current = resolvedDocumentId;
          pymupdfSourceIdRef.current = sourceId;
          pymupdfPageCacheRef.current = new Map();
        }
        if (!/^[a-f\d]{24}$/i.test(String(pymupdfDocumentIdRef.current || "").trim())) {
          throw new Error("The PDF document identity is unavailable.");
        }
        const cached = pymupdfPageCacheRef.current.get(pageNum);
        const extraction = cached || await getPageExtractionEvidence(pymupdfDocumentIdRef.current, pageNum, { nativeOnly: true });
        if (!cached) pymupdfPageCacheRef.current.set(pageNum, extraction);
        if (!cancelled) setPymupdfPageExtraction(extraction);
      } catch {
        if (!cancelled) setPymupdfPageExtraction(null);
      } finally {
        if (!cancelled) setPymupdfExtractionBusy(false);
      }
    };
    void loadPyMuPDF();
    return () => { cancelled = true; };
  }, [filename, hasSourceId, pageCount, pageNum, pdfType]);

  const entityBuilderFilteredRawRows = useMemo(() => {
    const query = entityBuilderRawValueQuery.trim().toLocaleLowerCase();
    if (!query) return entityBuilderRawBlankPageRows;
    return entityBuilderRawBlankPageRows.filter((row) => String(row.value || "").toLocaleLowerCase().includes(query));
  }, [entityBuilderRawBlankPageRows, entityBuilderRawValueQuery]);

  const entityBuilderRawSpatialMetadata = useMemo(() => {
    const metadata = new Map();
    const rows = entityBuilderRawBlankPageRows;
    const rowsByY = [...rows].sort((left, right) => {
      const yDifference = (Number(left.y) || 0) - (Number(right.y) || 0);
      return Math.abs(yDifference) > 0.01
        ? yDifference
        : (Number(left.instanceNumber) || 0) - (Number(right.instanceNumber) || 0);
    });
    const visualBands = [];
    rowsByY.forEach((row) => {
      const rowY = Number(row.y) || 0;
      const currentBand = visualBands.at(-1);
      if (!currentBand || Math.abs(rowY - currentBand.anchorY) > 1) {
        visualBands.push({ anchorY: rowY, rows: [row] });
      } else {
        currentBand.rows.push(row);
      }
    });
    const visualRows = visualBands.flatMap((band) => band.rows.sort((left, right) => {
      const xDifference = (Number(left.x) || 0) - (Number(right.x) || 0);
      return Math.abs(xDifference) > 0.01
        ? xDifference
        : (Number(left.instanceNumber) || 0) - (Number(right.instanceNumber) || 0);
    }));

    visualRows.forEach((row, index) => {
      metadata.set(row.id, { visualOrder: index + 1, deltaX: null, itemFlow: "mixed" });
    });

    rows.forEach((row, index) => {
      const previous = rows[index - 1];
      const currentX = Number(row.x);
      const previousX = Number(previous?.x);
      const entry = metadata.get(row.id) || {};
      entry.deltaX = index > 0 && Number.isFinite(currentX) && Number.isFinite(previousX)
        ? currentX - previousX
        : null;
      metadata.set(row.id, entry);
    });

    let runStart = 0;
    while (runStart < rows.length) {
      const startTy = Number(rows[runStart]?.ty);
      let runEnd = runStart;
      while (runEnd + 1 < rows.length) {
        const nextTy = Number(rows[runEnd + 1]?.ty);
        if (!Number.isFinite(startTy) || !Number.isFinite(nextTy) || Math.abs(nextTy - startTy) > 1) break;
        runEnd += 1;
      }

      let hasAscending = false;
      let hasDescending = false;
      for (let index = runStart + 1; index <= runEnd; index += 1) {
        const delta = (Number(rows[index]?.x) || 0) - (Number(rows[index - 1]?.x) || 0);
        if (delta > 0.01) hasAscending = true;
        else if (delta < -0.01) hasDescending = true;
      }
      const itemFlow = hasAscending && !hasDescending
        ? "ascending-X"
        : hasDescending && !hasAscending
          ? "descending-X"
          : "mixed";
      for (let index = runStart; index <= runEnd; index += 1) {
        const entry = metadata.get(rows[index].id) || {};
        entry.itemFlow = itemFlow;
        metadata.set(rows[index].id, entry);
      }
      runStart = runEnd + 1;
    }

    return metadata;
  }, [entityBuilderRawBlankPageRows]);

  const entityBuilderPyMuPdfRows = useMemo(() => {
    const spans = Array.isArray(pymupdfPageExtraction?.native?.spans) ? pymupdfPageExtraction.native.spans : [];
    const used = new Set();
    return new Map(entityBuilderRawBlankPageRows.map((row) => {
      const value = String(row.value || "").trim();
      const candidates = spans
        .map((span, index) => ({ span, index }))
        .filter(({ span, index }) => !used.has(index) && String(span.text || "").trim() === value)
        .sort((a, b) => {
          const aBox = a.span.bbox || [];
          const bBox = b.span.bbox || [];
          const aDistance = Math.hypot((Number(aBox[0]) || 0) - (Number(row.x) || 0), (Number(aBox[1]) || 0) - (Number(row.y) || 0));
          const bDistance = Math.hypot((Number(bBox[0]) || 0) - (Number(row.x) || 0), (Number(bBox[1]) || 0) - (Number(row.y) || 0));
          return aDistance - bDistance;
        });
      const match = candidates[0];
      if (!match) return [row.id, null];
      used.add(match.index);
      const span = match.span;
      return [row.id, {
        fontName: span.fontName || "-",
        fontSize: Number.isFinite(span.fontSize) ? span.fontSize : null,
        weight: span.bold ? "bold" : "normal",
        style: span.italic ? "italic" : "normal",
        flags: Number.isFinite(span.flags) ? span.flags : null,
        color: Number.isFinite(span.color) ? span.color : null,
        lineId: span.lineId || "-",
        blockId: span.blockId || "-",
        bbox: Array.isArray(span.bbox) ? span.bbox : [],
        ascender: Number.isFinite(span.ascender) ? span.ascender : null,
        descender: Number.isFinite(span.descender) ? span.descender : null,
      }];
    }));
  }, [entityBuilderRawBlankPageRows, pymupdfPageExtraction]);

  // Visual Raw uses the same matched records exposed by the Original Text
  // table. PyMuPDF's rotated, page-relative bbox is preferred because it is
  // the backend's native geometry; PDF.js remains the safe fallback while a
  // page is loading or when a native span has no exact text match.
  const entityBuilderVisualRawRows = useMemo(() => {
    return entityBuilderRawBlankPageRows.map((row) => {
      const native = entityBuilderPyMuPdfRows.get(row.id);
      const bbox = Array.isArray(native?.bbox) && native.bbox.length >= 4 ? native.bbox : null;
      const x = bbox ? Number(bbox[0]) : Number(row.x) || 0;
      const y = bbox ? Number(bbox[1]) : Number(row.y) || 0;
      const width = bbox ? Math.max(1, Number(bbox[2]) - Number(bbox[0])) : Math.max(1, Number(row.width) || 1);
      const height = bbox ? Math.max(1, Number(bbox[3]) - Number(bbox[1])) : getRawVisibleHeight(row);
      return {
        ...row,
        visualX: Number.isFinite(x) ? x : 0,
        visualY: Number.isFinite(y) ? y : 0,
        visualWidth: Number.isFinite(width) ? width : Math.max(1, Number(row.width) || 1),
        visualHeight: Number.isFinite(height) ? height : getRawVisibleHeight(row),
        visualFontSize: Number.isFinite(native?.fontSize) ? native.fontSize : Math.max(1, Number(row.fontSize) || 1),
        visualFontWeight: native?.weight || row.fontWeight || "normal",
        visualFontStyle: native?.style || row.fontStyle || "normal",
      };
    });
  }, [entityBuilderPyMuPdfRows, entityBuilderRawBlankPageRows]);

  const toggleRawCategoryOmission = useCallback((category) => {
    setEntityBuilderOmittedRawCategories((previous) => {
      const next = new Set(previous);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }, []);

  const entityBuilderRawYColors = useMemo(() => {
    const colors = new Map();
    let colorIndex = 0;
    entityBuilderRawBlankPageRows.forEach((row) => {
      if (!Number.isFinite(row.ty)) return;
      const tyKey = Number(row.ty).toFixed(2);
      if (!colors.has(tyKey)) {
        colors.set(tyKey, RAW_Y_COLOR_PALETTE[colorIndex % RAW_Y_COLOR_PALETTE.length]);
        colorIndex += 1;
      }
    });
    return colors;
  }, [entityBuilderRawBlankPageRows]);

  const focusOriginalTextValue = useCallback((row) => {
    if (!row?.id) return;
    setEntityBuilderVisualFocusId(row.id);
    setMarkdownAsideMode("visual-raw");
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const layer = markdownVisualLayerRef.current;
        const target = layer
          ? Array.from(layer.querySelectorAll("[data-raw-row-id]")).find((element) => element.dataset.rawRowId === String(row.id))
          : null;
        target?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      });
    });
  }, []);

  useEffect(() => {
    if (!entityBuilderVisualFocusId) return undefined;
    const timeout = window.setTimeout(() => setEntityBuilderVisualFocusId(null), 1800);
    return () => window.clearTimeout(timeout);
  }, [entityBuilderVisualFocusId]);

  const entityBuilderVisualRawLines = useMemo(() => {
    const visualRowsById = new Map(entityBuilderVisualRawRows.map((row) => [row.id, row]));
    // The MD table is the sole source of line membership. Consecutive items
    // remain chained while each TY stays within five units of the prior item.
    const tableLines = [];
    let tableIndex = 0;
    while (tableIndex < entityBuilderRawBlankPageRows.length) {
      const startIndex = tableIndex;
      const startRow = entityBuilderRawBlankPageRows[startIndex];
      let endIndex = startIndex;

      while (endIndex + 1 < entityBuilderRawBlankPageRows.length) {
        const currentRow = entityBuilderRawBlankPageRows[endIndex];
        const nextRow = entityBuilderRawBlankPageRows[endIndex + 1];
        if (!areConsecutiveRawInstances(currentRow, nextRow)) break;
        const currentTy = Number(currentRow.ty);
        const nextTy = Number(nextRow.ty);
        if (!Number.isFinite(currentTy) || !Number.isFinite(nextTy) || Math.abs(nextTy - currentTy) > 5) break;
        endIndex += 1;
      }

      tableLines.push({
        id: `visual-line-${startRow.id}`,
        tableRows: entityBuilderRawBlankPageRows.slice(startIndex, endIndex + 1),
      });
      tableIndex = endIndex + 1;
    }

    return tableLines.map((tableLine) => {
      const sourceRows = tableLine.tableRows
        .map((tableRow) => {
          const visualRow = visualRowsById.get(tableRow.id);
          return visualRow ? {
            ...visualRow,
            value: tableRow.value,
            ty: tableRow.ty,
            instanceNumber: tableRow.instanceNumber,
          } : null;
        })
        .filter((row) => row && !row.omitted && String(row.value || "").trim() && !entityBuilderOmittedRawCategories.has(getUnicodeOmissionLabel(row.value)));
      if (!sourceRows.length) return null;
      const visualRows = [...sourceRows].sort((left, right) => {
        const leftOrder = entityBuilderRawSpatialMetadata.get(left.id)?.visualOrder ?? Number.MAX_SAFE_INTEGER;
        const rightOrder = entityBuilderRawSpatialMetadata.get(right.id)?.visualOrder ?? Number.MAX_SAFE_INTEGER;
        return leftOrder - rightOrder;
      });
      const hasOrderDiscrepancy = visualRows.some((row, index) => row.id !== sourceRows[index]?.id);
      const xMin = Math.min(...visualRows.map((row) => Number(row.visualX) || 0));
      const xMax = Math.max(...visualRows.map((row) => (Number(row.visualX) || 0) + Math.max(1, Number(row.visualWidth) || 1)));
      const y = Math.min(...visualRows.map((row) => Number(row.visualY) || 0));
      const height = Math.max(...visualRows.map((row) => Number(row.visualHeight) || getRawVisibleHeight(row)));
      return { id: tableLine.id, rows: visualRows, sourceRows, visualRows, x: xMin, xMin, xMax, y, height, hasOrderDiscrepancy };
    }).filter(Boolean);
  }, [entityBuilderRawBlankPageRows, entityBuilderVisualRawRows, entityBuilderOmittedRawCategories, entityBuilderRawSpatialMetadata]);

  const entityBuilderVisualRawTextScale = useMemo(() => {
    if (typeof document === "undefined") return 1;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return 1;
    let sharedScale = 1;
    entityBuilderVisualRawRows
      .filter((row) => !row.omitted && String(row.value || "").trim() && !entityBuilderOmittedRawCategories.has(getUnicodeOmissionLabel(row.value)))
      .forEach((row) => {
        const fontSize = Math.max(1, Number(row.visualFontSize) || 1);
        const width = Math.max(1, Number(row.visualWidth) || 1);
        context.font = `${row.visualFontStyle || "normal"} ${row.visualFontWeight || "normal"} ${fontSize}px ${IBM_PLEX_MONO_FONT}`;
        const measuredWidth = context.measureText(String(row.value || "")).width;
        if (measuredWidth > width) sharedScale = Math.min(sharedScale, width / measuredWidth);
      });
    return Math.max(0.65, Math.min(1, sharedScale));
  }, [entityBuilderVisualRawRows, entityBuilderOmittedRawCategories]);

  const entityBuilderVisualRawPageWidth = Math.max(1, Number(pymupdfPageExtraction?.page?.widthPt) || Number(entityBuilderRawBlankPageMeta.pageWidth) || 1);
  const entityBuilderVisualRawPageHeight = Math.max(1, Number(pymupdfPageExtraction?.page?.heightPt) || Number(entityBuilderRawBlankPageMeta.pageHeight) || 1);

  const entityBuilderOcrTableRows = useMemo(() => (
    entityBuilderOcrBlankPageAnnotations.map((annotation) => ({
      id: annotation.id,
      stringKey: "ocr",
      type: annotation.type || "text",
      value: annotation.text || "",
      x: annotation.x,
      y: annotation.y,
      width: annotation.w,
      height: annotation.h,
      fontSize: annotation.fontSize,
      fontFamily: annotation.fontFamily || "sans-serif",
      fontWeight: annotation.fontBold ? "bold" : "normal",
      fontStyle: annotation.fontItalic ? "italic" : "normal",
      isHeadingLike: Boolean(annotation.isHeadingLike),
      wrap: Boolean(annotation.wrap),
      ocrSource: annotation.ocrImported ? "Tesseract OCR" : "OCR",
      sourcePage: annotation.pageImportedFrom,
      align: annotation.textAlign || "left",
      baseline: annotation.textBaseline || "top",
      padding: annotation.padding,
    }))
  ), [entityBuilderOcrBlankPageAnnotations]);

  const entityBuilderOcrRawTableRows = useMemo(() => (
    entityBuilderOcrBlankPageAnnotations.map((annotation) => ({
      id: annotation.id,
      stringKey: "ocr-raw",
      value: annotation.text || "",
      type: annotation.ocrBlockType || annotation.type || "text",
      x: annotation.x,
      y: annotation.y,
      width: annotation.w,
      height: annotation.h,
      confidence: annotation.ocrConfidence,
      blockId: annotation.ocrBlockId,
      sourcePage: annotation.pageImportedFrom,
      source: annotation.ocrImported ? "Tesseract OCR" : "OCR",
    }))
  ), [entityBuilderOcrBlankPageAnnotations]);

  const activeTesseractTableRows = useMemo(() => {
    if (entityBuilderTesseractRows.length) {
      return entityBuilderTesseractRows.map((row, index) => ({
        ...row,
        stringKey: "tesseract",
        instanceNumber: index + 1,
        source: "Tesseract",
        text: String(row.text ?? ""),
        confidence: Number.isFinite(Number(row.confidence)) ? Number(row.confidence) : null,
        x: Number(row.x),
        y: Number(row.y),
        width: Number(row.width),
        height: Number(row.height),
        block: row.block ?? "",
        paragraph: row.paragraph ?? "",
        line: row.line ?? "",
        word: row.word ?? "",
        pageNumber: Number(row.page) || pageNum,
        pageWidth: Number(entityBuilderTesseractMeta.pageWidth) || 0,
        pageHeight: Number(entityBuilderTesseractMeta.pageHeight) || 0,
      }));
    }

    // Sources-table OCR is persisted as normalized OCR blocks. Use those
    // blocks when no manual page-level run has populated the word rows.
    return entityBuilderOcrBlankPageAnnotations.map((annotation, index) => ({
      id: annotation.id,
      stringKey: "tesseract",
      instanceNumber: index + 1,
      text: String(annotation.text ?? ""),
      confidence: Number.isFinite(Number(annotation.ocrConfidence)) ? Number(annotation.ocrConfidence) : null,
      x: Number(annotation.x),
      y: Number(annotation.y),
      width: Number(annotation.w),
      height: Number(annotation.h),
      pageNumber: Number(annotation.pageImportedFrom) || pageNum,
      pageWidth: Number(entityBuilderRawBlankPageMeta.pageWidth) || 0,
      pageHeight: Number(entityBuilderRawBlankPageMeta.pageHeight) || 0,
      block: annotation.ocrBlockId || "",
      paragraph: "-",
      line: "-",
      word: "-",
      source: "Tesseract",
      level: null,
    }));
  }, [entityBuilderTesseractRows, entityBuilderTesseractMeta.pageWidth, entityBuilderTesseractMeta.pageHeight, entityBuilderOcrBlankPageAnnotations, entityBuilderRawBlankPageMeta.pageWidth, entityBuilderRawBlankPageMeta.pageHeight, pageNum]);

  const markdownAsideColumnGroups = [
    ["text", "TEXT"],
    ["position", "POSITION"],
    ["font", "FONT"],
    ["transform", "TRANSFORM"],
    ["blocks", "BLOCKS"],
  ];

  const markdownAsideRawColumns = useMemo(() => ({
    text: [
      ["INSTANCE #", (row) => Number.isFinite(row.instanceNumber) ? row.instanceNumber : "-"],
      ["VALUE", (row) => row.value],
      ["READING STATUS", (row) => row.omitted ? `OMITTED${row.omissionBBoxIds?.length ? ` (${row.omissionBBoxIds.length} bbox)` : ""}` : "INCLUDED"],
      ["DIR", (row) => row.direction || "-"],
      ["EOL", (row) => row.eol ? "true" : "false"],
      ["CHAR COUNT", (row) => Number.isFinite(row.charCount) ? row.charCount : "-"],
      ["WHITESPACE", (row) => row.whitespaceOnly ? "true" : "false"],
      ["OMISSION", (row) => getUnicodeOmissionLabel(row.value)],
    ],
    position: [
      ["INSTANCE #", (row) => Number.isFinite(row.instanceNumber) ? row.instanceNumber : "-"],
      ["VALUE", (row) => row.value || "-"],
      ["SOURCE ORDER", (row) => Number.isFinite(row.instanceNumber) ? row.instanceNumber : "-"],
      ["VISUAL ORDER", (row) => entityBuilderRawSpatialMetadata.get(row.id)?.visualOrder || "-"],
      ["DELTA X", (row) => Number.isFinite(entityBuilderRawSpatialMetadata.get(row.id)?.deltaX) ? entityBuilderRawSpatialMetadata.get(row.id).deltaX.toFixed(2) : "-"],
      ["ITEM FLOW", (row) => entityBuilderRawSpatialMetadata.get(row.id)?.itemFlow || "mixed"],
      ["TX", (row) => Number.isFinite(row.tx) ? row.tx.toFixed(2) : "-"],
      ["TY", (row) => Number.isFinite(row.ty) ? row.ty.toFixed(2) : "-"],
      ["X", (row) => Number.isFinite(row.x) ? row.x.toFixed(2) : "-"],
      ["Y", (row) => Number.isFinite(row.y) ? row.y.toFixed(2) : "-"],
      ["WIDTH", (row) => Number.isFinite(row.width) ? row.width.toFixed(2) : "-"],
      ["HEIGHT", (row) => Number.isFinite(row.height) ? row.height.toFixed(2) : "-"],
      ["TOP", (row) => Number.isFinite(row.top) ? row.top.toFixed(2) : "-"],
      ["ASCENT", (row) => Number.isFinite(row.ascent) ? row.ascent.toFixed(2) : "-"],
      ["BASELINE", (row) => Number.isFinite(row.baseline) ? row.baseline.toFixed(2) : "-"],
      ["DESCENT", (row) => Number.isFinite(row.descent) ? row.descent.toFixed(2) : "-"],
      ["BOTTOM", (row) => Number.isFinite(row.bottom) ? row.bottom.toFixed(2) : "-"],
      ["RAW WIDTH", (row) => Number.isFinite(row.rawWidth) ? row.rawWidth.toFixed(4) : "-"],
      ["RAW HEIGHT", (row) => Number.isFinite(row.rawHeight) ? row.rawHeight.toFixed(4) : "-"],
      ["PAGE WIDTH", (row) => Number.isFinite(row.width) ? row.width.toFixed(2) : "-"],
      ["PAGE HEIGHT", (row) => Number.isFinite(row.height) ? row.height.toFixed(2) : "-"],
      ["PYMUPDF X", (row) => Number.isFinite(entityBuilderPyMuPdfRows.get(row.id)?.bbox?.[0]) ? entityBuilderPyMuPdfRows.get(row.id).bbox[0].toFixed(2) : "-"],
      ["PYMUPDF Y", (row) => Number.isFinite(entityBuilderPyMuPdfRows.get(row.id)?.bbox?.[1]) ? entityBuilderPyMuPdfRows.get(row.id).bbox[1].toFixed(2) : "-"],
      ["PYMUPDF WIDTH", (row) => Number.isFinite(entityBuilderPyMuPdfRows.get(row.id)?.bbox?.[2]) && Number.isFinite(entityBuilderPyMuPdfRows.get(row.id)?.bbox?.[0]) ? (entityBuilderPyMuPdfRows.get(row.id).bbox[2] - entityBuilderPyMuPdfRows.get(row.id).bbox[0]).toFixed(2) : "-"],
      ["PYMUPDF HEIGHT", (row) => Number.isFinite(entityBuilderPyMuPdfRows.get(row.id)?.bbox?.[3]) && Number.isFinite(entityBuilderPyMuPdfRows.get(row.id)?.bbox?.[1]) ? (entityBuilderPyMuPdfRows.get(row.id).bbox[3] - entityBuilderPyMuPdfRows.get(row.id).bbox[1]).toFixed(2) : "-"],
    ],
    font: [
      ["INSTANCE #", (row) => Number.isFinite(row.instanceNumber) ? row.instanceNumber : "-"],
      ["VALUE", (row) => row.value || "-"],
      ["FONT SIZE", (row) => Number.isFinite(row.fontSize) ? row.fontSize.toFixed(2) : "-"],
      ["FONT FAMILY", (row) => row.fontFamily || "-"],
      ["WEIGHT", (row) => row.fontWeight || "-"],
      ["STYLE", (row) => row.fontStyle || "-"],
      ["FONT NAME", (row) => row.fontName || "-"],
      ["PYMUPDF FONT", (row) => entityBuilderPyMuPdfRows.get(row.id)?.fontName || "-"],
      ["PYMUPDF WEIGHT", (row) => entityBuilderPyMuPdfRows.get(row.id)?.weight || "-"],
      ["PYMUPDF STYLE", (row) => entityBuilderPyMuPdfRows.get(row.id)?.style || "-"],
      ["PYMUPDF FLAGS", (row) => Number.isFinite(entityBuilderPyMuPdfRows.get(row.id)?.flags) ? entityBuilderPyMuPdfRows.get(row.id).flags : "-"],
      ["PYMUPDF COLOR", (row) => Number.isFinite(entityBuilderPyMuPdfRows.get(row.id)?.color) ? entityBuilderPyMuPdfRows.get(row.id).color : "-"],
    ],
    transform: [
      ["INSTANCE #", (row) => Number.isFinite(row.instanceNumber) ? row.instanceNumber : "-"],
      ["VALUE", (row) => row.value || "-"],
      ["ROTATION", (row) => formatSignedRotation(row.rotation)],
      ["SCALE X", (row) => Number.isFinite(row.scaleX) ? row.scaleX.toFixed(4) : "-"],
      ["SCALE Y", (row) => Number.isFinite(row.scaleY) ? row.scaleY.toFixed(4) : "-"],
      ["ORIGINAL A", (row) => Number.isFinite(row.matrixA) ? row.matrixA.toFixed(4) : "-"],
      ["ORIGINAL B", (row) => Number.isFinite(row.matrixB) ? row.matrixB.toFixed(4) : "-"],
      ["ORIGINAL C", (row) => Number.isFinite(row.matrixC) ? row.matrixC.toFixed(4) : "-"],
      ["ORIGINAL D", (row) => Number.isFinite(row.matrixD) ? row.matrixD.toFixed(4) : "-"],
      ["ORIGINAL E", (row) => Number.isFinite(row.matrixE) ? row.matrixE.toFixed(4) : "-"],
      ["ORIGINAL F", (row) => Number.isFinite(row.matrixF) ? row.matrixF.toFixed(4) : "-"],
      ["FULL A", (row) => Number.isFinite(row.fullMatrixA) ? row.fullMatrixA.toFixed(4) : "-"],
      ["FULL B", (row) => Number.isFinite(row.fullMatrixB) ? row.fullMatrixB.toFixed(4) : "-"],
      ["FULL C", (row) => Number.isFinite(row.fullMatrixC) ? row.fullMatrixC.toFixed(4) : "-"],
      ["FULL D", (row) => Number.isFinite(row.fullMatrixD) ? row.fullMatrixD.toFixed(4) : "-"],
      ["FULL E", (row) => Number.isFinite(row.fullMatrixE) ? row.fullMatrixE.toFixed(4) : "-"],
      ["FULL F", (row) => Number.isFinite(row.fullMatrixF) ? row.fullMatrixF.toFixed(4) : "-"],
      ["PYMUPDF LINE", (row) => entityBuilderPyMuPdfRows.get(row.id)?.lineId || "-"],
      ["PYMUPDF BLOCK", (row) => entityBuilderPyMuPdfRows.get(row.id)?.blockId || "-"],
    ],
    blocks: [
      ["BLOCK #", (row) => Number.isFinite(row.blockNumber) ? row.blockNumber : "-"],
      ["LINE REFERENCES", (row) => row.lineReferences || "-"],
      ["STRING REFERENCES", (row) => row.stringReferences || "-"],
    ],
    classification: [["CLASS", (row) => row.classification || "-"]],
  }), [entityBuilderPyMuPdfRows, entityBuilderRawSpatialMetadata]);

  const runTesseractOcr = useCallback(async () => {
    const sourceId = currentSourceIdRef.current;
    if (!sourceId || !pageNum || entityBuilderTesseractBusy) return;
    setEntityBuilderTesseractBusy(true);
    setEntityBuilderTesseractError("");
    setEntityBuilderTesseractRows([]);
    try {
      const response = await authFetch(apiUrl(`/api/sources/${sourceId}/tesseract?page=${pageNum}`), { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error?.message || data.error || "Tesseract OCR failed.");
      setEntityBuilderTesseractRows(Array.isArray(data.rows) ? data.rows : []);
      setEntityBuilderTesseractMeta({
        pageWidth: Number(data.pageWidth) || 0,
        pageHeight: Number(data.pageHeight) || 0,
        pageNumber: Number(data.page) || pageNum,
        renderDpi: Number(data.renderDpi) || 200,
        coordinateSpace: data.coordinateSpace || "ocr_page_pixels",
      });
      setEntityBuilderBlankPageMode("tesseract");
    } catch (error) {
      setEntityBuilderTesseractError(error.message || "Tesseract OCR failed.");
    } finally {
      setEntityBuilderTesseractBusy(false);
    }
  }, [entityBuilderTesseractBusy, pageNum]);

  const toggleEntityBuilder = useCallback(() => {
    setEntityBuilderOpen((open) => !open);
  }, []);
  const toggleOcrBlankPage = useCallback(() => {
    setEntityBuilderOcrBlankPageOpen((open) => !open);
    setEntityBuilderOcrBlankPageError("");
  }, []);
  const toggleMarkdownAside = useCallback(() => {
    if (markdownModeMenuOpen) {
      setMarkdownModeMenuOpen(false);
      return;
    }
    if (!markdownAsideOpen) {
      setReadingMode("single");
    }
    const button = document.getElementById("pdf_ocr_companion_toggle");
    const rect = button?.getBoundingClientRect();
    if (rect) {
      const styles = window.getComputedStyle(button);
      setMarkdownModeMenuPosition({
        left: rect.left,
        top: rect.bottom - 1,
        width: rect.width,
        height: rect.height,
        radius: styles.borderRadius,
      });
    }
    setMarkdownModeMenuOpen(true);
  }, [markdownAsideOpen, markdownModeMenuOpen]);
  const setNotebookView = useCallback((mode) => {
    setReadingMode("single");
    setNotebookMode(mode);
    if (mode === "notebook-md") {
      setMarkdownAsideMode("visual-only");
      setMarkdownAsideOpen(true);
    } else if (mode === "notebook-pdf-md") {
      setMarkdownAsideMode("visual-raw");
      setMarkdownAsideOpen(true);
    } else {
      setMarkdownAsideOpen(false);
      setMarkdownModeMenuOpen(false);
      setMarkdownRetainedVisualMode(null);
    }
  }, []);
  const closeNotebook = useCallback(() => setNotebookMode(null), []);
  const setReaderReadingMode = useCallback((mode) => {
    setReadingMode(mode);
    setMarkdownAsideOpen(false);
    setMarkdownModeMenuOpen(false);
    setMarkdownRetainedVisualMode(null);
  }, []);
  useEffect(() => {
    if (!markdownModeMenuOpen) return undefined;
    const update = () => {
      const rect = document.getElementById("pdf_ocr_companion_toggle")?.getBoundingClientRect();
      const button = document.getElementById("pdf_ocr_companion_toggle");
      if (rect && button) {
        const styles = window.getComputedStyle(button);
        setMarkdownModeMenuPosition({
          left: rect.left,
          top: rect.bottom,
          width: rect.width,
          height: rect.height,
          radius: styles.borderRadius,
        });
      }
    };
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    const button = document.getElementById("pdf_ocr_companion_toggle");
    const navGroup = button?.closest(".pdfw_page_nav_group");
    const observer = typeof ResizeObserver !== "undefined" && button
      ? new ResizeObserver(update)
      : null;
    observer?.observe(button);
    if (navGroup && navGroup !== button) observer?.observe(navGroup);
    const frame = requestAnimationFrame(update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [markdownModeMenuOpen]);
  useEffect(() => {
    if (!markdownModeMenuOpen) return undefined;
    const closeOnOutsidePointer = (event) => {
      const button = document.getElementById("pdf_ocr_companion_toggle");
      const menu = document.querySelector(".pdf_markdown_mode_menu");
      if (button?.contains(event.target) || menu?.contains(event.target)) return;
      setMarkdownModeMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
  }, [markdownModeMenuOpen]);
  const entityBuilderEmptyAreaRects = useMemo(
    () => computeEmptyTextRects(
      entityBuilderRawBlankPageRows,
      Number(entityBuilderRawBlankPageMeta?.pageWidth) || 0,
      Number(entityBuilderRawBlankPageMeta?.pageHeight) || 0,
    ),
    [entityBuilderRawBlankPageMeta, entityBuilderRawBlankPageRows],
  );

  // ── AMCTOSHS Hyle layers (floating button, bottom-left of the canvas) ───
  // Per this app's own AMCTOSHS vocabulary — a word/page is Hyle
  // (undifferentiated matter) until form is imposed on it. Two views onto
  // the CURRENT page's own text, computed purely client-side from PDF.js's
  // text items (pdfHyleStats.js) — no AI call, no backend round-trip,
  // unlike Hyles/Narrative Mode:
  //   "raw"       — every PDF.js item exactly as extracted, no layout
  //                 imposed — and, faithful to that, no visual imposed on
  //                 the page either: this mode draws NOTHING on the
  //                 canvas, the page stays exactly as-is. It's the
  //                 default for that reason — selecting it is a true
  //                 no-op on the page's own appearance.
  //   "segmented" — the page's own geometric line/column structure, each
  //                 line's word count and each word's own char count,
  //                 drawn as boxes + numbered markers (form actually
  //                 imposed on the page).
  const [hyleFabOpen, setHyleFabOpen] = useState(false);
  const [annotationLayerTab, setAnnotationLayerTab] = useState("pdf");
  const activateAnnotationSurface = useCallback((surface) => {
    if (!surface) return;
    setActiveAnnotationSurface(surface);
    if (surface === "pdf" || surface === "md") {
      setAnnotationLayerTab(surface);
      setAnnotHistorySource(surface);
    }
  }, []);
  const [hyleMode, setHyleMode] = useState("raw"); // "raw" | "segmented" (never null — Raw is always the default/active layer)
  // Named distinctly from the existing hyleData/setHyleData state above
  // (the Hyles noun-extraction feature) — same "Hyle" vocabulary, but a
  // completely separate, purely client-side view, not to be confused.
  const [hyleLayerData, setHyleLayerData] = useState(null); // whatever pdfHyleStats.js returned for hyleMode, or null while loading/off

  const createAnnotationLayer = useCallback((index, annotationsForLayer = {}) => ({
    id: `annot-layer-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: `Layer ${index}`,
    visible: true,
    annotations: annotationsForLayer,
  }), []);

  // ── Selection action (selectionOnly mode) ──────────────────────────────────
  const [selectionActionBusy,  setSelectionActionBusy]  = useState(false);
  const [selectionActionError, setSelectionActionError] = useState("");

  // ── Annotation state ──────────────────────────────────────────────────────
  const [savedToolbarSettings] = useState(loadPdfToolbarSettings);
  const [annotToolColors, setAnnotToolColors] = useState(savedToolbarSettings.annotToolColors);
  const [annotToolColorPresets, setAnnotToolColorPresets] = useState(savedToolbarSettings.annotToolColorPresets);
  const [annotSize,      setAnnotSize]      = useState(savedToolbarSettings.annotSize);  // highlight lineWidth
  const [penSize,        setPenSize]        = useState(savedToolbarSettings.penSize);   // pen lineWidth
  const [penStabilization, setPenStabilization] = useState(savedToolbarSettings.penStabilization);
  const [penPressureAssist, setPenPressureAssist] = useState(savedToolbarSettings.penPressureAssist);
  const [penTaper, setPenTaper] = useState(savedToolbarSettings.penTaper);
  const [penFlow, setPenFlow] = useState(savedToolbarSettings.penFlow);
  const [penNibAngle, setPenNibAngle] = useState(savedToolbarSettings.penNibAngle);
  const [penNibSpread, setPenNibSpread] = useState(savedToolbarSettings.penNibSpread);
  const [penType,          setPenType]          = useState(savedToolbarSettings.penType);
  const [eraserSize,     setEraserSize]     = useState(savedToolbarSettings.eraserSize);  // eraser radius
  const [eraserMode,     setEraserMode]     = useState(savedToolbarSettings.eraserMode);
  const [highlightMode,  setHighlightMode]  = useState(savedToolbarSettings.highlightMode); // "freehand" | "line"
  const [highlightAutoWidth, setHighlightAutoWidth] = useState(savedToolbarSettings.highlightAutoWidth);
  const [highlightTaperEnds, setHighlightTaperEnds] = useState(savedToolbarSettings.highlightTaperEnds);
  const [highlightAutoContrast, setHighlightAutoContrast] = useState(savedToolbarSettings.highlightAutoContrast);
  const [annotOpacity,      setAnnotOpacity]      = useState(savedToolbarSettings.annotOpacity);    // % — highlight fill opacity
  const [textFontFamily, setTextFontFamily] = useState(savedToolbarSettings.textFontFamily);
  const [textFontSize, setTextFontSize] = useState(savedToolbarSettings.textFontSize);
  const [textAlign, setTextAlign] = useState(savedToolbarSettings.textAlign);
  const [textBold, setTextBold] = useState(savedToolbarSettings.textBold);
  const [textItalic, setTextItalic] = useState(savedToolbarSettings.textItalic);
  const [textUnderline, setTextUnderline] = useState(savedToolbarSettings.textUnderline);
  const [textBackground, setTextBackground] = useState(savedToolbarSettings.textBackground);
  const [textBackgroundColor, setTextBackgroundColor] = useState(savedToolbarSettings.textBackgroundColor);
  const [textPadding, setTextPadding] = useState(savedToolbarSettings.textPadding);
  // Shapes tools only (line/arrow/rect/circle) — border dash pattern and
  // (rect only) corner rounding. See annotationDraw.js's own "rect"/
  // shared-dash handling for how these render.
  const [shapeToolSettings, setShapeToolSettings] = useState(savedToolbarSettings.shapeToolSettings);
  const [bboxBorderSize, setBBoxBorderSize] = useState(savedToolbarSettings.bboxBorderSize);
  const [activeBBoxCreationType, setActiveBBoxCreationType] = useState(savedToolbarSettings.bboxCreationType);
  // Fill for closed shapes only (rect/circle — line/arrow have no
  // interior to fill), same low-alpha wash convention as textBackground.
  // Always uses the shape's own border/ink color (annotationDraw.js) —
  // no independent fill color, so just an on/off toggle, not a swatch.
  // Which color the shared floating dropdown (.annot_dd--colors) writes
  // to when a swatch is clicked — either the current tool ink, the Text
  // tool's background swatch, or one of the per-tool saved preset slots.
  // Not persisted — always resets to plain ink targeting on reload.
  const [colorMenuTarget, setColorMenuTarget] = useState({ type: "ink", presetIndex: null });
  const [colorMenuOpen,  setColorMenuOpen]  = useState(false); // floating color dropdown
  const [textMenuOpen, setTextMenuOpen] = useState(false); // floating text controls dropdown
  const colorMenuRef = useRef(null);
  const textMenuRef = useRef(null);
  // The color dropdown (.annot_dd--colors) is portalled straight to
  // document.body — same reasoning as InfoPopupButton.jsx's own popup:
  // #pdf_toolbar sits in a DOM branch (#pdf_page's direct children) that,
  // for reasons that held even at z-index:99999, painted BEHIND
  // #pdf_annot_canvas's own branch (#pdf_content > ... > the canvas) —
  // no in-place z-index fix reached it, only escaping the subtree does.
  // colorMenuPopoverRef covers the portalled node for the outside-click
  // handler below, since it's no longer a DOM descendant of colorMenuRef.
  const colorMenuPopoverRef = useRef(null);
  const [colorMenuPos, setColorMenuPos] = useState(null);
  // A second trigger (the Text tool's Background swatch) opens the same
  // shared dropdown — this ref covers ITS wrap for the outside-click
  // check below, same reason colorMenuRef does for the Ink trigger.
  const bgSwatchRef = useRef(null);
  const colorPresetPressRef = useRef({ index: null, timer: null, suppressClick: false, pointerId: null });
  const [annotationLayers, setAnnotationLayers] = useState(() => [createAnnotationLayer(1, {})]);
  const [activeAnnotationLayerId, setActiveAnnotationLayerId] = useState(null);
  const [annotations, setAnnotations] = useState({});   // active layer only: { [pageNum]: [...] }
  const entityBuilderRawBlockTableRows = useMemo(() => {
    const blockBBoxes = (annotations[pageNum] || []).filter((annotation) => annotation?.type === "bbox");
    return blockBBoxes.map((block, blockIndex) => {
      const blockLeft = Number(block.x);
      const blockTop = Number(block.y);
      const blockWidth = Number(block.w);
      const blockHeight = Number(block.h);
      const selectedRows = entityBuilderRawBlankPageRows.filter((row) => {
        if (row.omitted || !String(row.value || "").trim()) return false;
        if (entityBuilderOmittedRawCategories.has(getUnicodeOmissionLabel(row.value))) return false;
        const rowLeft = Number(row.x);
        const rowTop = Number(row.y);
        const rowWidth = Math.max(0, Number(row.width) || 0);
        const rowHeight = Math.max(1, Number(row.height) || 1);
        if (![rowLeft, rowTop, blockLeft, blockTop, blockWidth, blockHeight].every(Number.isFinite)) return false;
        const overlapX = Math.max(0, Math.min(rowLeft + rowWidth, blockLeft + blockWidth) - Math.max(rowLeft, blockLeft));
        const overlapY = Math.max(0, Math.min(rowTop + rowHeight, blockTop + blockHeight) - Math.max(rowTop, blockTop));
        return overlapX > 0.01 && overlapY / rowHeight >= 0.5;
      });
      const selectedIds = new Set(selectedRows.map((row) => row.id));
      const lineReferences = entityBuilderVisualRawLines
        .map((line, lineIndex) => line.sourceRows.some((row) => selectedIds.has(row.id)) ? `L${lineIndex + 1}` : null)
        .filter(Boolean);
      const stringReferences = selectedRows
        .map((row) => Number.isFinite(row.instanceNumber) ? `str #${row.instanceNumber}` : null)
        .filter(Boolean);
      return {
        id: block.id || `block-${blockIndex + 1}`,
        blockNumber: blockIndex + 1,
        lineReferences: lineReferences.join(", "),
        stringReferences: stringReferences.join(", "),
      };
    });
  }, [annotations, entityBuilderOmittedRawCategories, entityBuilderRawBlankPageRows, entityBuilderVisualRawLines, pageNum]);
  const [markdownAnnotations, setMarkdownAnnotations] = useState({}); // MD-only layer, never merged into PDF annotations
  const markdownAnnotationsRef = useRef(markdownAnnotations);
  markdownAnnotationsRef.current = markdownAnnotations;
  const [markdownUndoStack, setMarkdownUndoStack] = useState([]);
  const [markdownRedoStack, setMarkdownRedoStack] = useState([]);
  const saveMarkdownAnnotations = useCallback((nextLayers) => {
    const sourceId = currentSourceIdRef.current || embeddedSourceId || null;
    if (!sourceId) return;
    void authFetch(apiUrl(`/api/source-annotations/${sourceId}`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markdownLayers: nextLayers }),
    }).catch((error) => console.error("[PDF] Failed to save Markdown annotations", error));
  }, [embeddedSourceId]);
  const commitMarkdownAnnotations = useCallback((nextLayers) => {
    const previousLayers = markdownAnnotationsRef.current;
    if (nextLayers === previousLayers) return;
    setMarkdownUndoStack((stack) => [...stack.slice(-99), previousLayers]);
    setMarkdownRedoStack([]);
    markdownAnnotationsRef.current = nextLayers;
    setMarkdownAnnotations(nextLayers);
    saveMarkdownAnnotations(nextLayers);
  }, [saveMarkdownAnnotations]);
  const markdownHistoryEntries = useMemo(() => Object.entries(markdownAnnotations || {})
    .flatMap(([page, pageAnnotations]) => (Array.isArray(pageAnnotations) ? pageAnnotations : []).map((annotation, index) => {
      const timestamp = Number(String(annotation?.id || "").split("_")[0]);
      return {
        ...annotation,
        id: annotation?.id || `md_${page}_${index}`,
        page: Number(page) || page,
        time: Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp) : null,
      };
    }))
    .sort((a, b) => (b.time?.getTime?.() || 0) - (a.time?.getTime?.() || 0)), [markdownAnnotations]);
  const clearMarkdownAnnotations = useCallback(() => {
    if (!markdownHistoryEntries.length) return;
    commitMarkdownAnnotations({});
  }, [commitMarkdownAnnotations, markdownHistoryEntries.length]);
  const [annotationSaveStatus, setAnnotationSaveStatus] = useState("idle"); // idle | saving | saved | error
  const annotationSaveRequestRef = useRef(0);
  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;
  const [redoStacks, setRedoStacks] = useState({});     // { [pageNum]: [...] } — annotations popped by Undo, available to Redo
  const activeAnnotationLayer = useMemo(
    () => annotationLayers.find((layer) => layer.id === activeAnnotationLayerId) || annotationLayers[0] || null,
    [annotationLayers, activeAnnotationLayerId],
  );
  useEffect(() => {
    if (!annotationLayers.length) return;
    if (!activeAnnotationLayerId || !annotationLayers.some((layer) => layer.id === activeAnnotationLayerId)) {
      const firstLayer = annotationLayers[0];
      setActiveAnnotationLayerId(firstLayer.id);
      setAnnotations(firstLayer.annotations || {});
      setRedoStacks({});
    }
  }, [annotationLayers, activeAnnotationLayerId]);
  useEffect(() => {
    // `annotations` is the editable working state for the active layer.
    // Only copy it outward into that layer; copying layer state back here in
    // a second effect created a two-way race that could restore stale data
    // immediately after pointer-up and make a committed mark disappear.
    if (!activeAnnotationLayerId || !activeAnnotationLayer) return;
    if (activeAnnotationLayer.annotations === annotations) return;
    setAnnotationLayers((prev) => prev.map((layer) => (
      layer.id === activeAnnotationLayerId && layer.annotations !== annotations
        ? { ...layer, annotations }
        : layer
    )));
  }, [annotations, activeAnnotationLayer, activeAnnotationLayerId]);
  const annotationLayersForView = useMemo(() => (
    annotationLayers.map((layer) => (
      layer.id === activeAnnotationLayer?.id ? { ...layer, annotations } : layer
    ))
  ), [annotationLayers, activeAnnotationLayer, annotations]);
  const visibleAnnotations = useMemo(() => {
    const merged = {};
    for (const layer of annotationLayersForView) {
      if (layer.visible === false) continue;
      for (const [pageKey, pageAnnotations] of Object.entries(layer.annotations || {})) {
        merged[pageKey] = [...(merged[pageKey] || []), ...pageAnnotations];
      }
    }
    return merged;
  }, [annotationLayersForView]);
  const visiblePageAnnotations = visibleAnnotations[pageNum] || [];
  const displayPageDescriptors = useMemo(() => {
    if (!pageNum) return [];
    const descriptors = (
      readingMode === "booklet" && bookletRightPage && bookletRightPage !== pageNum
        ? [{ kind: "pdf", page: pageNum }, { kind: "pdf", page: bookletRightPage }]
        : [{ kind: "pdf", page: pageNum }]
    );
    if (entityBuilderOcrBlankPageOpen && readingMode === "single") {
      descriptors.push({ kind: "ocr-blank", page: pageNum });
    }
    return descriptors;
  }, [bookletRightPage, entityBuilderOcrBlankPageOpen, pageNum, readingMode]);
  const totalAnnotationCount = useMemo(
    () => annotationLayersForView.reduce(
      (sum, layer) => sum + Object.values(layer.annotations || {}).reduce((layerSum, list) => layerSum + list.length, 0),
      0,
    ),
    [annotationLayersForView],
  );
  const buildReaderStatePayload = useCallback(() => {
    const previewEl = previewRef.current;
    const currentPageEl = pageContainerRefs.current[pageNum - 1] || null;
    const pageWidth = Math.max(1, currentPageEl?.offsetWidth || 1);
    const pageHeight = Math.max(1, currentPageEl?.offsetHeight || 1);
    const pageLeft = currentPageEl?.offsetLeft || 0;
    const pageTop = currentPageEl?.offsetTop || 0;
    return {
      pageNum,
      zoom,
      viewMode: markdownAsideOpen ? "md" : "pdf",
      readingMode,
      bookletRightPage: readingMode === "booklet" ? bookletRightPage : null,
      markdownAsideOpen,
      markdownAsideMode,
      markdownRetainedVisualMode,
      markdownAsideColumnGroup,
      mdLineSpacing,
      mdSpacingTarget,
      mdLineTagsVisible,
      notebookMode,
      notebookActiveTab,
      notebookText,
      notebookVoiceCommands,
      searchOpen,
      searchQuery,
      pageRatioX: previewEl && currentPageEl
        ? clamp(((previewEl.scrollLeft + (previewEl.clientWidth / 2)) - pageLeft) / pageWidth, 0, 1)
        : null,
      pageRatioY: previewEl && currentPageEl
        ? clamp(((previewEl.scrollTop + (previewEl.clientHeight / 2)) - pageTop) / pageHeight, 0, 1)
        : null,
    };
  }, [
    bookletRightPage,
    markdownAsideColumnGroup,
    markdownAsideMode,
    markdownAsideOpen,
    markdownRetainedVisualMode,
    mdLineSpacing,
    mdLineTagsVisible,
    mdSpacingTarget,
    notebookMode,
    notebookActiveTab,
    notebookText,
    notebookVoiceCommands,
    pageNum,
    readingMode,
    searchOpen,
    searchQuery,
    zoom,
  ]);
  const buildAnnotationSavePayload = useCallback(({ activeAnnotations = annotations, history = annotHistory, layers = null } = {}) => {
    const sourceLayers = layers || annotationLayersForView;
    const targetLayerId = activeAnnotationLayer?.id
      || activeAnnotationLayerId
      || sourceLayers[0]?.id
      || null;
    const nextLayers = sourceLayers.map((layer) => (
      layer.id === targetLayerId
        ? { ...layer, annotations: withoutTemporarySmartPenStrokes(activeAnnotations) }
        : { ...layer, annotations: withoutTemporarySmartPenStrokes(layer.annotations) }
    ));
    return {
      layers: nextLayers,
      activeLayerId: targetLayerId || nextLayers[0]?.id || null,
      history,
      readerState: buildReaderStatePayload(),
    };
  }, [annotationLayersForView, activeAnnotationLayer, activeAnnotationLayerId, annotations, annotHistory, buildReaderStatePayload]);
  const buildReaderStatePayloadRef = useRef(buildReaderStatePayload);
  buildReaderStatePayloadRef.current = buildReaderStatePayload;
  const mapOcrPageToPdfSpace = useCallback(async (ocrPage, targetPage) => {
    if (!ocrPage || !(ocrPage.width > 0) || !(ocrPage.height > 0) || !pdfDoc) return ocrPage;
    const pdfPage = await pdfDoc.getPage(targetPage);
    const viewport = pdfPage.getViewport({ scale: 1 });
    const scaleX = viewport.width / ocrPage.width;
    const scaleY = viewport.height / ocrPage.height;
    return {
      ...ocrPage,
      lines: (ocrPage.blocks || []).map((block) => {
        const box = block.bbox || {};
        const x = Number(box.x);
        const y = Number(box.y);
        const width = Number(box.width);
        const height = Number(box.height);
        const text = String(block.text || block.markdown || "").trim();
        if (!text || ![x, y, width, height].every(Number.isFinite)) return null;
        return {
          text,
          type: block.type || "unknown",
          bbox: {
            x: x * scaleX,
            y: y * scaleY,
            width: width * scaleX,
            height: height * scaleY,
          },
        };
      }).filter(Boolean),
    };
  }, [pdfDoc]);
  const getPersistedOcrTextForSelection = useCallback(async (selection, targetPage = pageNum) => {
    const sourceId = currentSourceIdRef.current;
    if (!selection || !sourceId) return "";

    try {
      const response = await authFetch(apiUrl(`/api/sources/${sourceId}/ocr/pages?page=${targetPage}`));
      const data = await response.json().catch(() => ({}));
      const ocrPage = data.pages?.[0];
      if (!response.ok || !ocrPage) return "";

      const alignedOcrPage = await mapOcrPageToPdfSpace(ocrPage, targetPage);
      const selectionBox = {
        left: Number(selection.x) || 0,
        top: Number(selection.y) || 0,
        right: (Number(selection.x) || 0) + Math.max(0, Number(selection.w) || 0),
        bottom: (Number(selection.y) || 0) + Math.max(0, Number(selection.h) || 0),
      };
      const selectionArea = Math.max(1, (selectionBox.right - selectionBox.left) * (selectionBox.bottom - selectionBox.top));

      const matches = (alignedOcrPage?.lines || [])
        .map((line) => {
          const bbox = line?.bbox || {};
          const left = Number(bbox.x) || 0;
          const top = Number(bbox.y) || 0;
          const right = left + Math.max(0, Number(bbox.width) || 0);
          const bottom = top + Math.max(0, Number(bbox.height) || 0);
          const overlapWidth = Math.max(0, Math.min(selectionBox.right, right) - Math.max(selectionBox.left, left));
          const overlapHeight = Math.max(0, Math.min(selectionBox.bottom, bottom) - Math.max(selectionBox.top, top));
          const overlapArea = overlapWidth * overlapHeight;
          const lineArea = Math.max(1, (right - left) * (bottom - top));
          return {
            text: String(line?.text || "").trim(),
            x: left,
            y: top,
            overlapRatio: overlapArea / Math.min(selectionArea, lineArea),
          };
        })
        .filter((line) => line.text && line.overlapRatio >= 0.2)
        .sort((a, b) => a.y - b.y || a.x - b.x);

      return normalizeOcrText(matches.map((line) => line.text).join("\n"));
    } catch (error) {
      console.warn("[PDF] persisted OCR selection lookup failed", error);
      return "";
    }
  }, [mapOcrPageToPdfSpace, pageNum]);
  const getOcrBlankTextStyle = useCallback((ann, scale) => {
    const pageBoxWidth = Math.max(1, ann.w || 0);
    const pageFontSize = Math.max(1, ann.fontSize || 0);
    const fontWeight = ann.fontBold ? 700 : 400;
    const toRenderStyle = (fontSizePageUnits, wrap) => ({
      fontSize: `${Math.max(1, fontSizePageUnits * scale)}px`,
      lineHeight: `${Math.max(1, fontSizePageUnits * scale * 1.15)}px`,
      fontWeight,
      whiteSpace: wrap ? "normal" : "nowrap",
      overflowWrap: wrap ? "break-word" : "normal",
      wordBreak: wrap ? "normal" : "keep-all",
    });
    const fallbackStyle = toRenderStyle(pageFontSize, ann.wrap);
    if (typeof document === "undefined" || !ann?.text) return fallbackStyle;

    if (!ocrBlankMeasureCanvasRef.current) {
      ocrBlankMeasureCanvasRef.current = document.createElement("canvas");
    }
    const ctx = ocrBlankMeasureCanvasRef.current.getContext("2d");
    if (!ctx) return fallbackStyle;

    const fontFamily = ann.fontFamily || "sans-serif";
    const quotedFamily = fontFamily.includes(" ") ? `"${fontFamily}"` : fontFamily;
    const measureWidth = (fontPx) => {
      ctx.font = `${ann.fontItalic ? "italic " : ""}${fontWeight} ${fontPx}px ${quotedFamily}`;
      return ctx.measureText(ann.text).width;
    };

    const baseWidth = measureWidth(pageFontSize);
    if (!ann.isHeadingLike) {
      return toRenderStyle(pageFontSize, ann.wrap || baseWidth > pageBoxWidth * 1.02);
    }

    if (baseWidth <= pageBoxWidth * 1.01) return toRenderStyle(pageFontSize, false);

    const fitScale = Math.min(1, (pageBoxWidth / Math.max(1, baseWidth)) * 0.99);
    const shrunkFontSize = Math.max(7, pageFontSize * Math.max(OCR_BLANK_TITLE_MIN_SCALE, fitScale));
    const shrunkWidth = measureWidth(shrunkFontSize);
    if (shrunkWidth <= pageBoxWidth * 1.01) return toRenderStyle(shrunkFontSize, false);

    return toRenderStyle(shrunkFontSize, true);
  }, []);
  const buildOcrTextAnnotationsForBlankPage = useCallback(async ({ ocrPage, referencePage, destinationPage }) => {
    if (!ocrPage || !pdfDoc || !Number.isFinite(referencePage) || !Number.isFinite(destinationPage)) return [];
    const pdfPage = await pdfDoc.getPage(referencePage);
    const viewport = pdfPage.getViewport({ scale: 1 });
    const scaleX = (ocrPage.width > 0) ? (viewport.width / ocrPage.width) : 1;
    const scaleY = (ocrPage.height > 0) ? (viewport.height / ocrPage.height) : 1;

    const normalizeRect = (source = {}) => {
      const x = Number(source.x ?? source.left ?? source.top_left_x);
      const y = Number(source.y ?? source.top ?? source.top_left_y);
      const right = Number(source.right ?? source.bottom_right_x);
      const bottom = Number(source.bottom ?? source.bottom_right_y);
      const width = Number.isFinite(Number(source.width)) ? Number(source.width) : (Number.isFinite(x) && Number.isFinite(right) ? right - x : NaN);
      const height = Number.isFinite(Number(source.height)) ? Number(source.height) : (Number.isFinite(y) && Number.isFinite(bottom) ? bottom - y : NaN);
      if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
      return { x, y, width, height };
    };

    const normalizeText = (value) => String(value || "").replace(/\r/g, "").trim();
    const buildFragment = ({ text, bbox, type = "paragraph", confidence = null, blockId = "" }) => {
      const safeText = normalizeText(text);
      if (!safeText || !bbox) return null;
      const isHeadingLike = ["title", "heading", "header"].includes(type);
      const mappedBox = {
        x: bbox.x * scaleX,
        y: bbox.y * scaleY,
        width: bbox.width * scaleX,
        height: bbox.height * scaleY,
      };
      const estimatedCharWidth = safeText.length > 0 ? (mappedBox.width / Math.max(1, safeText.length * 0.58)) : mappedBox.height;
      const fontSize = Math.max(7, Math.min(mappedBox.height * 0.72, estimatedCharWidth));
      const estimatedTextWidth = safeText.length * fontSize * 0.58;
      const shouldWrap = !isHeadingLike && estimatedTextWidth > mappedBox.width * 1.02;
      return {
        id: Date.now() + Math.random(),
        type: "text",
        x: mappedBox.x,
        y: mappedBox.y,
        w: mappedBox.width,
        h: mappedBox.height,
        text: safeText,
        color: "#111111",
        fontSize,
        fontFamily: "sans-serif",
        textAlign: "left",
        fontBold: isHeadingLike,
        fontItalic: false,
        textUnderline: false,
        textBackground: false,
        textBackgroundColor: "#ffffff",
        textBaseline: "top",
        padding: 100,
        wrap: shouldWrap,
        isHeadingLike,
        ocrImported: true,
        ocrBlockType: type,
        ocrConfidence: Number.isFinite(Number(confidence)) ? Number(confidence) : null,
        ocrBlockId: blockId,
        pageImportedFrom: referencePage,
      };
    };

    const fragments = [];
    (ocrPage.blocks || []).forEach((block, blockIndex) => {
      const blockType = String(block?.type || "paragraph");
      const blockText = normalizeText(block?.text || block?.markdown || "");
      const blockBox = normalizeRect(block?.bbox || {});
      const rawLines = Array.isArray(block?.raw?.lines) ? block.raw.lines : [];

      if (rawLines.length) {
        rawLines.forEach((line, lineIndex) => {
          const lineText = normalizeText(line?.text || line?.content || line?.markdown || "");
          const lineBox = normalizeRect(line?.bbox || line?.bounding_box || line || {});
          const fragment = buildFragment({
            text: lineText,
            bbox: lineBox,
            type: blockType,
            confidence: line?.confidence ?? block?.confidence,
            blockId: block?.blockId || `p${referencePage}-b${blockIndex + 1}`,
          });
          if (fragment) {
            fragment.id = `ocr_${destinationPage}_${blockIndex}_${lineIndex}_${Date.now()}`;
            fragments.push(fragment);
          }
        });
        return;
      }

      if (!blockText || !blockBox) return;
      const lines = blockText.split("\n").map((line) => normalizeText(line)).filter(Boolean);
      const lineHeight = blockBox.height / Math.max(1, lines.length);
      lines.forEach((lineText, lineIndex) => {
        const fragment = buildFragment({
          text: lineText,
          bbox: {
            x: blockBox.x,
            y: blockBox.y + (lineIndex * lineHeight),
            width: blockBox.width,
            height: lineHeight,
          },
          type: blockType,
          confidence: block?.confidence,
          blockId: block?.blockId || `p${referencePage}-b${blockIndex + 1}`,
        });
        if (fragment) {
          fragment.id = `ocr_${destinationPage}_${blockIndex}_${lineIndex}_${Date.now()}`;
          fragments.push(fragment);
        }
      });
    });

    return fragments;
  }, [pdfDoc]);
  const correctBBoxAnnotationFromOcr = useCallback(async ({ annotationId, targetPage, rawPdfText, bboxPdf, sourceId }) => {
    if (!annotationId || !rawPdfText?.trim() || !sourceId) return;
    try {
      const response = await authFetch(apiUrl(`/api/sources/${sourceId}/ocr/pages?page=${targetPage}`));
      const data = await response.json();
      const ocrPage = data.pages?.[0];
      if (!response.ok || !ocrPage?.markdown?.trim()) return;
      const alignedOcrPage = await mapOcrPageToPdfSpace(ocrPage, targetPage);
      const correction = await correctBBoxText({
        rawPdfText,
        bboxPdf,
        pageIndex: targetPage - 1,
        ocrPage: alignedOcrPage,
      });
      const currentAnnotations = annotationsRef.current;
      const currentAnnotation = (currentAnnotations[targetPage] || []).find((item) => item.id === annotationId);
      if (!currentAnnotation || currentAnnotation.textCorrection?.source === "manual") return;
      const nextAnnotations = {
        ...currentAnnotations,
        [targetPage]: (currentAnnotations[targetPage] || []).map((item) => (
          item.id === annotationId
            ? {
                ...item,
                text: correction.correctedText,
                correctedText: correction.correctedText,
                ocrCorrectedText: correction.correctionSource === "ocr_alignment"
                  ? correction.correctedText
                  : (correction.ocrCandidateText || correction.correctedText),
                rawPdfText: correction.rawText,
                textCorrection: {
                  source: correction.correctionSource,
                  confidence: correction.correctionConfidence,
                  warnings: correction.correctionWarnings,
                  audit: correction.correctionAudit,
                  ocrVersion: data.job?.schemaVersion || null,
                  ocrJobId: data.job?.id || null,
                  applied: correction.correctionSource === "ocr_alignment",
                  correctionVersion: BBOX_TEXT_CORRECTION_VERSION,
                },
              }
            : item
        )),
      };
      annotationsRef.current = nextAnnotations;
      setAnnotations(nextAnnotations);
      await authFetch(apiUrl(`/api/source-annotations/${sourceId}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildAnnotationSavePayload({ activeAnnotations: nextAnnotations })),
      });
    } catch (error) {
      console.warn("[PDF] BBox OCR text correction skipped", error);
    }
  }, [buildAnnotationSavePayload, mapOcrPageToPdfSpace]);
  const activateAnnotationLayer = useCallback((layerId) => {
    const nextLayer = annotationLayers.find((layer) => layer.id === layerId);
    if (!nextLayer || nextLayer.id === activeAnnotationLayerId) return;
    setActiveAnnotationLayerId(nextLayer.id);
    setAnnotations(nextLayer.annotations || {});
    setRedoStacks({});
  }, [annotationLayers, activeAnnotationLayerId]);
  const addAnnotationLayer = useCallback(() => {
    setAnnotationLayers((prev) => {
      const nextLayer = createAnnotationLayer(prev.length + 1, {});
      const next = [...prev, nextLayer];
      setActiveAnnotationLayerId(nextLayer.id);
      setAnnotations(nextLayer.annotations);
      setRedoStacks({});
      setHyleFabOpen(true);
      return next;
    });
  }, [createAnnotationLayer]);
  const toggleAnnotationLayerVisibility = useCallback((layerId) => {
    setAnnotationLayers((prev) => {
      const layer = prev.find((item) => item.id === layerId);
      if (!layer) return prev;
      const visibleCount = prev.filter((item) => item.visible !== false).length;
      if (layer.visible !== false && visibleCount <= 1) return prev;
      const next = prev.map((item) => (item.id === layerId ? { ...item, visible: item.visible === false } : item));
      if (layer.id === activeAnnotationLayerId && layer.visible !== false) {
        const nextVisibleLayer = next.find((item) => item.id !== layerId && item.visible !== false);
        if (nextVisibleLayer) {
          setActiveAnnotationLayerId(nextVisibleLayer.id);
          setAnnotations(nextVisibleLayer.annotations || {});
          setRedoStacks({});
        }
      }
      return next;
    });
  }, [activeAnnotationLayerId]);
  const deleteAnnotationLayer = useCallback((layerId) => {
    if (annotationLayersForView.length <= 1) return;
    const layer = annotationLayersForView.find((item) => item.id === layerId);
    if (!layer) return;
    const annotationCount = Object.values(layer.annotations || {})
      .reduce((sum, list) => sum + list.length, 0);
    if (
      annotationCount > 0
      && !window.confirm(
        `Delete ${layer.name} and its ${annotationCount} annotation${annotationCount === 1 ? "" : "s"}? This cannot be undone.`,
      )
    ) return;

    let nextLayers = annotationLayersForView.filter((item) => item.id !== layerId);
    if (layerId === activeAnnotationLayerId) {
      let replacement = nextLayers.find((item) => item.visible !== false) || nextLayers[0];
      if (replacement.visible === false) {
        replacement = { ...replacement, visible: true };
        nextLayers = nextLayers.map((item) => (item.id === replacement.id ? replacement : item));
      }
      setActiveAnnotationLayerId(replacement.id);
      setAnnotations(replacement.annotations || {});
      setRedoStacks({});
    }
    setAnnotationLayers(nextLayers);
  }, [activeAnnotationLayerId, annotationLayersForView]);
  const selectionBboxes = useMemo(
    () => (annotations[pageNum] || []).filter((ann) => isBBoxType(ann.type) && !bboxTypeHas(ann.type, "extractsTitle")),
    [annotations, pageNum],
  );
  const managedBboxes = useMemo(
    () => (annotations[pageNum] || []).filter((ann) => EDITABLE_BBOX_TYPES.has(ann.type)),
    [annotations, pageNum],
  );
  const omissionBBoxes = useMemo(
    () => (annotations[pageNum] || []).filter((ann) => ann?.type === "omissionBBox"),
    [annotations, pageNum],
  );
  const drawAnnotationWithOwnerClip = useCallback((ctx, ann, scale, pageAnnotations = []) => {
    const basePageScale = Math.max(0.001, fitScaleRef.current || 1);
    drawAnnotation(ctx, ann, scale, scale / basePageScale);
  }, []);
  const bboxTextMatchesSpan = useCallback((bbox, span) => bboxTextMatchesSpanUtil(bbox, span), []);
  const bboxCreationMatchesSpan = useCallback((selectionRect, span) => {
    if (!selectionRect || !span) return false;
    const spanRect = span.el?.getBoundingClientRect?.();
    const canvasRect = annotCanvasRef.current?.getBoundingClientRect?.();
    if (!spanRect || !canvasRect) {
      const left = span.geoLeft ?? 0;
      const right = span.geoRight ?? 0;
      const top = span.geoTop ?? 0;
      const bottom = top + (span.geoHeight ?? 0);
      const rectLeft = selectionRect.x ?? 0;
      const rectTop = selectionRect.y ?? 0;
      const rectRight = rectLeft + (selectionRect.w ?? 0);
      const rectBottom = rectTop + (selectionRect.h ?? 0);
      const overlapX = Math.max(0, Math.min(right, rectRight) - Math.max(left, rectLeft));
      const overlapY = Math.max(0, Math.min(bottom, rectBottom) - Math.max(top, rectTop));
      const spanWidth = Math.max(1, right - left);
      const spanHeight = Math.max(1, bottom - top);
      const centerX = (left + right) / 2;
      const centerY = (top + bottom) / 2;
      const centerInside = centerX >= rectLeft && centerX <= rectRight && centerY >= rectTop && centerY <= rectBottom;
      const tinySpan = spanWidth <= 12 || spanHeight <= 12;
      if (tinySpan) return overlapX > 0 && overlapY > 0 && (centerInside || overlapX / spanWidth >= 0.35);
      return overlapY > 0 && overlapY / spanHeight >= 0.38 && (centerInside || overlapX / spanWidth >= 0.6);
    }
    const scale = pageViewport?.scale || (fitScaleRef.current * zoomRef.current);
    const bboxLeft = canvasRect.left + selectionRect.x * scale;
    const bboxTop = canvasRect.top + selectionRect.y * scale;
    const bboxRight = canvasRect.left + (selectionRect.x + selectionRect.w) * scale;
    const bboxBottom = canvasRect.top + (selectionRect.y + selectionRect.h) * scale;
    const left = spanRect.left;
    const right = spanRect.right;
    const top = spanRect.top;
    const bottom = spanRect.bottom;
    const overlapX = Math.max(0, Math.min(right, bboxRight) - Math.max(left, bboxLeft));
    const overlapY = Math.max(0, Math.min(bottom, bboxBottom) - Math.max(top, bboxTop));
    const spanWidth = Math.max(1, right - left);
    const spanHeight = Math.max(1, bottom - top);
    const centerX = (left + right) / 2;
    const centerY = (top + bottom) / 2;
    const centerInside = centerX >= bboxLeft && centerX <= bboxRight && centerY >= bboxTop && centerY <= bboxBottom;
    const tinySpan = spanWidth <= 12 || spanHeight <= 12;
    if (tinySpan) return overlapX > 0 && overlapY > 0 && (centerInside || overlapX / spanWidth >= 0.35);
    return overlapY > 0 && overlapY / spanHeight >= 0.38 && (centerInside || overlapX / spanWidth >= 0.6);
  }, [pageViewport?.scale]);
  const bboxMatchesSpan = useCallback((bbox, span) => {
    if (!bbox || !span) return false;
    const spanRect = span.el?.getBoundingClientRect?.();
    const canvasRect = annotCanvasRef.current?.getBoundingClientRect?.();
    const zoomFactor = Math.max(1, Math.min(1.2, zoomRef.current));
    const scale = fitScaleRef.current * zoomFactor;
    const leftPad = Math.max(2, 1.5 * zoomFactor);
    const rightPad = Math.max(4, 3.2 * zoomFactor);
    const padY = Math.max(2.5, 2.2 * zoomFactor);
    const overlapThreshold = 0.58;
    if (!spanRect || !canvasRect) {
      const left = span.geoLeft ?? 0;
      const right = span.geoRight ?? 0;
      const top = span.geoTop ?? 0;
      const bottom = top + (span.geoHeight ?? 0);
      const bboxRight = bbox.x + bbox.w;
      const bboxBottom = bbox.y + bbox.h;
      const overlapX = Math.max(0, Math.min(right, bboxRight + rightPad) - Math.max(left, bbox.x - leftPad));
      const overlapY = Math.max(0, Math.min(bottom, bboxBottom + padY) - Math.max(top, bbox.y - padY));
      const spanWidth = Math.max(1, right - left);
      const centerX = (left + right) / 2;
      const centerInside = centerX >= bbox.x && centerX <= bboxRight;
      return overlapY > 0 && (centerInside || overlapX / spanWidth >= overlapThreshold);
    }
    const bboxLeft = canvasRect.left + bbox.x * scale;
    const bboxTop = canvasRect.top + bbox.y * scale;
    const bboxRight = canvasRect.left + (bbox.x + bbox.w) * scale;
    const bboxBottom = canvasRect.top + (bbox.y + bbox.h) * scale;
    const left = spanRect.left;
    const right = spanRect.right;
    const top = spanRect.top;
    const bottom = spanRect.bottom;
    const overlapX = Math.max(0, Math.min(right, bboxRight + rightPad) - Math.max(left, bboxLeft - leftPad));
    const overlapY = Math.max(0, Math.min(bottom, bboxBottom + padY) - Math.max(top, bboxTop - padY));
    const spanWidth = Math.max(1, right - left);
    const centerX = (left + right) / 2;
    const centerInside = centerX >= bboxLeft && centerX <= bboxRight;
    return overlapY > 0 && (centerInside || overlapX / spanWidth >= overlapThreshold);
  }, [zoom]);
  const regionForSpanIndex = useCallback((spanIdx) => {
    const span = spansRef.current[spanIdx];
    if (!span) return null;
    return selectionBboxes
      .filter((bbox) => bboxMatchesSpan(bbox, span))
      .sort((a, b) => (a.w * a.h) - (b.w * b.h))[0] || null;
  }, [bboxMatchesSpan, selectionBboxes]);
  const annotColor = annotTool && DEFAULT_ANNOT_TOOL_COLORS[annotTool]
    ? (annotToolColors[annotTool] || DEFAULT_ANNOT_TOOL_COLORS[annotTool])
    : "#ffff00";
  const textToolColor = annotToolColors.text || DEFAULT_ANNOT_TOOL_COLORS.text;
  const activeToolColorPresets = annotTool && annotToolColorPresets[annotTool]
    ? annotToolColorPresets[annotTool]
    : [];
  const activeToolColorPresetIndex = activeToolColorPresets.findIndex((color) => color === annotColor);
  const activeShapeSettings = SHAPE_TOOL_KEYS.includes(annotTool)
    ? (shapeToolSettings[annotTool] || DEFAULT_SHAPE_TOOL_SETTINGS[annotTool])
    : null;
  const shapeStrokeWidth = activeShapeSettings?.strokeWidth || 2;
  const shapeBorderStyle = activeShapeSettings?.borderStyle || "solid";
  const shapeBorderRadius = activeShapeSettings?.borderRadius || 0;
  const shapeBackground = Boolean(activeShapeSettings?.background);
  const updateActiveShapeSetting = useCallback((patch) => {
    if (!SHAPE_TOOL_KEYS.includes(annotTool)) return;
    setShapeToolSettings((previous) => ({
      ...previous,
      [annotTool]: {
        ...(previous[annotTool] || DEFAULT_SHAPE_TOOL_SETTINGS[annotTool]),
        ...patch,
      },
    }));
  }, [annotTool]);
  const setShapeBorderStyle = useCallback((borderStyle) => {
    updateActiveShapeSetting({ borderStyle });
  }, [updateActiveShapeSetting]);
  const setShapeBorderRadius = useCallback((borderRadius) => {
    updateActiveShapeSetting({ borderRadius });
  }, [updateActiveShapeSetting]);
  const setShapeBackground = useCallback((valueOrUpdater) => {
    const nextValue = typeof valueOrUpdater === "function"
      ? valueOrUpdater(Boolean(activeShapeSettings?.background))
      : valueOrUpdater;
    updateActiveShapeSetting({ background: Boolean(nextValue) });
  }, [activeShapeSettings?.background, updateActiveShapeSetting]);
  const setAnnotColor = useCallback((nextColor) => {
    setAnnotToolColors((prev) => {
      if (!annotTool || !DEFAULT_ANNOT_TOOL_COLORS[annotTool]) return prev;
      return { ...prev, [annotTool]: nextColor };
    });
  }, [annotTool]);
  const setAnnotToolColorPreset = useCallback((presetIndex, nextColor) => {
    if (!annotTool || !DEFAULT_ANNOT_TOOL_COLORS[annotTool]) return;
    setAnnotToolColorPresets((prev) => {
      const current = Array.isArray(prev[annotTool]) ? prev[annotTool] : buildDefaultAnnotToolColorPresets()[annotTool];
      const nextSlots = Array.from({ length: COLOR_PRESET_SLOT_COUNT }, (_, index) => current[index] ?? null);
      nextSlots[presetIndex] = nextColor;
      return { ...prev, [annotTool]: nextSlots };
    });
    if (nextColor) setAnnotColor(nextColor);
  }, [annotTool, setAnnotColor]);
  const openColorMenuFromRect = useCallback((rect, target) => {
    setColorMenuTarget(target);
    setColorMenuOpen((wasOpen) => {
      if (
        wasOpen
        && colorMenuTarget.type === target.type
        && colorMenuTarget.presetIndex === (target.presetIndex ?? null)
      ) return false;
      if (effectiveToolbarEdge === "bottom") {
        setColorMenuPos({ position: "fixed", bottom: window.innerHeight - rect.top + 6, left: rect.left });
      } else {
        setColorMenuPos({ position: "fixed", top: rect.bottom + 6, left: rect.left });
      }
      return true;
    });
  }, [colorMenuTarget, effectiveToolbarEdge]);
  const startColorPresetLongPress = useCallback((presetIndex, event) => {
    const state = colorPresetPressRef.current;
    if (state.timer) clearTimeout(state.timer);
    state.index = presetIndex;
    state.pointerId = event.pointerId;
    state.suppressClick = false;
    const rect = event.currentTarget.getBoundingClientRect();
    state.timer = setTimeout(() => {
      state.timer = null;
      state.suppressClick = true;
      openColorMenuFromRect(rect, { type: "preset", presetIndex });
    }, 450);
  }, [openColorMenuFromRect]);
  const clearColorPresetLongPress = useCallback((pointerId = null, options = {}) => {
    const state = colorPresetPressRef.current;
    if (pointerId !== null && state.pointerId !== null && state.pointerId !== pointerId) return false;
    const suppressClick = state.suppressClick;
    if (state.timer) clearTimeout(state.timer);
    state.timer = null;
    if (!options.keepSuppressClick) {
      state.suppressClick = false;
      state.index = null;
      state.pointerId = null;
    }
    return suppressClick;
  }, []);
  useEffect(() => () => {
    if (colorPresetPressRef.current.timer) clearTimeout(colorPresetPressRef.current.timer);
  }, []);
  // Starts true so the save effect's very first run — the initial mount,
  // firing before the hydration GET below has had any chance to land —
  // never PATCHes the server. Without this, a slow/racing hydration fetch
  // could lose: mount fires the save effect with only the (possibly
  // stale/default) localStorage values, arms its 700ms PATCH regardless,
  // and if that fires before hydration's setters land, it overwrites
  // whatever was genuinely saved server-side with those stale local ones —
  // which is exactly "my settings vanished after a refresh": the account's
  // real saved settings got clobbered by defaults on the very reload meant
  // to restore them. This flag is mount-only: re-arming it during hydration
  // can swallow the user's first real edit when the hydrated values happen
  // to equal the local values and React therefore performs no state update.
  const skipNextPdfToolbarServerSaveRef = useRef(true);
  const pdfToolbarServerSaveTimerRef = useRef(null);
  const pdfToolbarHydrationPendingRef = useRef(true);
  const pdfToolbarSettingsDirtyRef = useRef(false);
  const pdfToolbarSettingsRef = useRef(savedToolbarSettings);
  const pdfToolbarSettingsSignatureRef = useRef(JSON.stringify(savedToolbarSettings));
  const pdfToolbarSettingsPatchRef = useRef({});
  const [pdfToolbarSettingsSaving, setPdfToolbarSettingsSaving] = useState(false);
  useEffect(() => {
    const settings = {
      annotToolColors,
      annotToolColorPresets,
      annotSize,
      penSize,
      penStabilization,
      penPressureAssist,
      penTaper,
      penFlow,
      penNibAngle,
      penNibSpread,
      penType,
      eraserSize,
      eraserMode,
      highlightMode,
      highlightAutoWidth,
      highlightTaperEnds,
      highlightAutoContrast,
      annotOpacity,
      textFontFamily,
      textFontSize,
      textAlign,
      textBold,
      textItalic,
      textUnderline,
      textBackground,
      textBackgroundColor,
      textPadding,
      arrowSize: shapeToolSettings.arrow?.strokeWidth ?? DEFAULT_PDF_TOOLBAR_SETTINGS.arrowSize,
      shapeBorderStyle,
      shapeBorderRadius,
      bboxBorderSize,
      bboxCreationType: activeBBoxCreationType,
      shapeBackground,
      shapeToolSettings,
    };
    const previousSettings = pdfToolbarSettingsRef.current;
    const settingsSignature = JSON.stringify(settings);
    const settingsChanged = pdfToolbarSettingsSignatureRef.current !== settingsSignature;
    const changedSettings = Object.fromEntries(
      Object.keys(settings).filter((key) => (
        JSON.stringify(previousSettings?.[key]) !== JSON.stringify(settings[key])
      )).map((key) => [key, settings[key]]),
    );
    pdfToolbarSettingsRef.current = settings;
    pdfToolbarSettingsSignatureRef.current = settingsSignature;
    // Instant, synchronous, offline-safe — unaffected by the server debounce
    // below, and still the first thing a fresh mount reads (loadPdfToolbarSettings).
    savePdfToolbarSettings(settings);

    if (skipNextPdfToolbarServerSaveRef.current) {
      skipNextPdfToolbarServerSaveRef.current = false;
      return;
    }
    // React StrictMode repeats mount effects in development. Do not treat
    // that identical second pass as a user edit or it blocks DB hydration.
    if (!settingsChanged) return;
    // The account copy is authoritative at startup. Existing annotations,
    // hidden PDFPage instances, or StrictMode must never overwrite it with
    // local/default values before the GET below has completed.
    if (pdfToolbarHydrationPendingRef.current) return;
    pdfToolbarSettingsPatchRef.current = {
      ...pdfToolbarSettingsPatchRef.current,
      ...changedSettings,
    };
    pdfToolbarSettingsDirtyRef.current = true;
    setPdfToolbarSettingsSaving(true);
    // Debounced: several of these controls (the opacity/size/stabilization
    // knobs especially) fire onChange continuously while being dragged —
    // PATCHing the server on every tick of a drag would spam it for no
    // benefit, since only the final value after release matters.
    if (pdfToolbarServerSaveTimerRef.current) clearTimeout(pdfToolbarServerSaveTimerRef.current);
    pdfToolbarServerSaveTimerRef.current = setTimeout(() => {
      pdfToolbarServerSaveTimerRef.current = null;
      const patchToSave = pdfToolbarSettingsPatchRef.current;
      pdfToolbarSettingsPatchRef.current = {};
      authFetch(apiUrl("/api/user/me/pdf-toolbar-settings"), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdfToolbarSettingsPatch: patchToSave }),
      }).then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.error || `Toolbar settings save failed (${response.status}).`);
        }
        if (pdfToolbarSettingsRef.current === settings) {
          pdfToolbarSettingsDirtyRef.current = false;
          setPdfToolbarSettingsSaving(false);
        }
      }).catch((error) => {
        pdfToolbarSettingsPatchRef.current = {
          ...patchToSave,
          ...pdfToolbarSettingsPatchRef.current,
        };
        if (pdfToolbarSettingsRef.current === settings) setPdfToolbarSettingsSaving(false);
        console.error("PDF toolbar settings were not saved to the database:", error);
      });
    }, 700);
  }, [
    annotToolColors,
    annotToolColorPresets,
    annotSize,
    penSize,
    penStabilization,
    penPressureAssist,
    penTaper,
    penFlow,
    penNibAngle,
    penNibSpread,
    penType,
    eraserSize,
    eraserMode,
    highlightMode,
    highlightAutoWidth,
    highlightTaperEnds,
    highlightAutoContrast,
    annotOpacity,
    textFontFamily,
    textFontSize,
    textAlign,
    textBold,
    textItalic,
    textUnderline,
    textBackground,
    textBackgroundColor,
    textPadding,
    shapeBorderStyle,
    shapeBorderRadius,
    bboxBorderSize,
    activeBBoxCreationType,
    shapeBackground,
    shapeToolSettings,
  ]);
  useEffect(() => {
    const persistPdfToolbarSettingsNow = () => {
      if (pdfToolbarHydrationPendingRef.current) return;
      if (!pdfToolbarSettingsDirtyRef.current && !pdfToolbarServerSaveTimerRef.current) return;
      if (pdfToolbarServerSaveTimerRef.current) {
        clearTimeout(pdfToolbarServerSaveTimerRef.current);
        pdfToolbarServerSaveTimerRef.current = null;
      }
      authFetch(apiUrl("/api/user/me/pdf-toolbar-settings"), {
        method: "PATCH",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdfToolbarSettingsPatch: pdfToolbarSettingsPatchRef.current }),
      }).then((response) => {
        if (!response.ok) throw new Error(`Toolbar settings save failed (${response.status}).`);
        pdfToolbarSettingsPatchRef.current = {};
        pdfToolbarSettingsDirtyRef.current = false;
      }).catch((error) => {
        console.error("PDF toolbar settings were not saved to the database:", error);
      });
    };
    window.addEventListener("pagehide", persistPdfToolbarSettingsNow);
    return () => {
      window.removeEventListener("pagehide", persistPdfToolbarSettingsNow);
      persistPdfToolbarSettingsNow();
    };
  }, []);
  // One-time hydration from the account's server-saved settings (GET
  // /api/user/me/pdf-toolbar-settings) — runs once on mount, right after
  // the synchronous localStorage-based defaults above already gave every
  // control an instant value. Overwrites them once the account's own copy
  // comes back, so switching browsers/devices actually carries these
  // settings over instead of silently resetting to DEFAULT_PDF_TOOLBAR_SETTINGS.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch(apiUrl("/api/user/me/pdf-toolbar-settings"), { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!data.pdfToolbarSettings || !Object.keys(data.pdfToolbarSettings).length) return;
        const s = normalizePdfToolbarSettings(data.pdfToolbarSettings);
        // Commit the authoritative account snapshot before React rerenders.
        // Previously this depended on the state-save effect running later;
        // a remount/refresh in between left localStorage on stale defaults.
        savePdfToolbarSettings(s);
        pdfToolbarSettingsRef.current = s;
        pdfToolbarSettingsSignatureRef.current = JSON.stringify(s);
        setAnnotToolColors(s.annotToolColors);
        setAnnotToolColorPresets(s.annotToolColorPresets);
        setAnnotSize(s.annotSize);
        setPenSize(s.penSize);
        setPenStabilization(s.penStabilization);
        setPenPressureAssist(s.penPressureAssist);
        setPenTaper(s.penTaper);
        setPenFlow(s.penFlow);
        setPenNibAngle(s.penNibAngle);
        setPenNibSpread(s.penNibSpread);
        setPenType(s.penType);
        setEraserSize(s.eraserSize);
        setEraserMode(s.eraserMode);
        setHighlightMode(s.highlightMode);
        setHighlightAutoWidth(s.highlightAutoWidth);
        setHighlightTaperEnds(s.highlightTaperEnds);
        setHighlightAutoContrast(s.highlightAutoContrast);
        setAnnotOpacity(s.annotOpacity);
        setTextFontFamily(s.textFontFamily);
        setTextFontSize(s.textFontSize);
        setTextAlign(s.textAlign);
        setTextBold(s.textBold);
        setTextItalic(s.textItalic);
        setTextUnderline(s.textUnderline);
        setTextBackground(s.textBackground);
        setTextBackgroundColor(s.textBackgroundColor);
        setTextPadding(s.textPadding);
        setBBoxBorderSize(s.bboxBorderSize);
        setActiveBBoxCreationType(s.bboxCreationType);
        setShapeToolSettings(s.shapeToolSettings);
      } catch (error) {
        // Keep the localStorage-loaded defaults if the fetch fails.
        console.error("PDF toolbar settings could not be loaded from the database:", error);
      } finally {
        pdfToolbarHydrationPendingRef.current = false;
      }
    })();
    return () => { cancelled = true; };
  }, []);
  const getTextAnnotationBounds = useCallback((ann, scale) => {
    const ctx = annotCanvasRef.current?.getContext?.("2d");
    const fontSize = (ann.fontSize || 16) * scale;
    const fontWeight = ann.fontBold ? "700" : "400";
    const fontStyle = ann.fontItalic ? "italic" : "normal";
    const fontFamily = ann.fontFamily || "sans-serif";
    const font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily.includes(" ") ? `"${fontFamily}"` : fontFamily}`;
    const x = ann.x * scale;
    const y = ann.y * scale;
    const textWidth = ctx ? (() => {
      ctx.save();
      ctx.font = font;
      const width = ctx.measureText(ann.text || "").width;
      ctx.restore();
      return width;
    })() : Math.max(1, (ann.text || "").length * fontSize * 0.5);
    const align = ann.textAlign || "left";
    const left = align === "center" ? x - textWidth / 2 : align === "right" ? x - textWidth : x;
    const top = ann.textBaseline === "top" ? y : y - fontSize * 0.8;
    return {
      left: left - fontSize * 0.15,
      right: left + textWidth + fontSize * 0.15,
      top: top - fontSize * 0.2,
      bottom: top + fontSize * 1.2,
    };
  }, []);

  const findTextAnnotationAt = useCallback((x, y) => {
    const scale = fitScaleRef.current * zoomRef.current;
    // x/y come in canvas-space (matches toCanvas's own p.x/p.y, and every
    // caller of this function), but getTextAnnotationBounds returns a box
    // in rendered/screen space (ann.x * scale — see its own comment on
    // the `ann.x * scale` line) since 3 of its 4 call sites need that for
    // absolute vx/vy positioning. Scale the point up to match, or this
    // silently only hits at combined scale === 1 (fitScale*zoom, almost
    // never exactly 1 for a real page/viewport size).
    const sx = x * scale;
    const sy = y * scale;
    const anns = annotations[pageNum] || [];
    for (let i = anns.length - 1; i >= 0; i--) {
      const ann = anns[i];
      if (ann.type !== "text") continue;
      const box = getTextAnnotationBounds(ann, scale);
      if (sx >= box.left && sx <= box.right && sy >= box.top && sy <= box.bottom) return ann;
    }
    return null;
  }, [annotations, getTextAnnotationBounds, pageNum]);

  // x/y here are canvas-space, matching toCanvas's p.x/p.y directly — a
  // highlight's own points/lineWidth are stored unscaled (see
  // annotationDraw.js's `p(v) = v * s` / `(ann.lineWidth||16) * s`), so
  // unlike findTextAnnotationAt above this needs no scale conversion.
  const findHighlightAnnotationAt = useCallback((x, y) => {
    const anns = annotations[pageNum] || [];
    for (let i = anns.length - 1; i >= 0; i--) {
      const ann = anns[i];
      if (ann.type !== "highlight" || !Array.isArray(ann.points) || !ann.points.length) continue;
      const tolerance = (ann.lineWidth || 16) / 2 + 4;
      if (ann.points.length === 1) {
        if (Math.hypot(x - ann.points[0].x, y - ann.points[0].y) <= tolerance) return ann;
        continue;
      }
      const pts = ann.mode === "line" ? [ann.points[0], ann.points[ann.points.length - 1]] : ann.points;
      let hit = false;
      for (let j = 0; j < pts.length - 1; j++) {
        if (distToSegment(x, y, pts[j].x, pts[j].y, pts[j + 1].x, pts[j + 1].y) <= tolerance) { hit = true; break; }
      }
      if (hit) return ann;
    }
    return null;
  }, [annotations, pageNum]);

  // Autosave the annotation session in the background — debounced so a whole
  // stroke's worth of state updates only writes once, a beat after the user
  // pauses. Server-side model (SourceAnnotation) already existed, just unused.
  // history rides along on the same debounced write (each entry already
  // carries its own `time`, stamped by logAnnotHistory when it's created)
  // so the Annotation History panel survives a reload instead of resetting
  // empty every session.
  useEffect(() => {
    if (skipNextAnnotationAutosaveRef.current) { skipNextAnnotationAutosaveRef.current = false; return; }
    const sourceId = currentSourceIdRef.current;
    if (!sourceId) return; // local/unsaved file — nothing to persist against
    const requestId = ++annotationSaveRequestRef.current;
    setAnnotationSaveStatus("saving");
    const timer = setTimeout(() => {
      authFetch(apiUrl(`/api/source-annotations/${sourceId}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildAnnotationSavePayloadRef.current()),
      })
        .then((response) => {
          if (!response.ok) throw new Error(`Annotation save failed (${response.status}).`);
          if (requestId === annotationSaveRequestRef.current) setAnnotationSaveStatus("saved");
        })
        .catch(() => {
          if (requestId === annotationSaveRequestRef.current) setAnnotationSaveStatus("error");
        });
    }, 1500);
    return () => clearTimeout(timer);
  }, [annotations, annotHistory]);
  const [annotTextInput, setAnnotTextInput] = useState(null); // { vx, vy, cx, cy }
  const [textActionMenu, setTextActionMenu] = useState(null); // { vx, vy, editingId }
  const [textStyleTargetId, setTextStyleTargetId] = useState(null); // id of an existing text annotation being style-edited
  const [annotTextVal,   setAnnotTextVal]   = useState("");
  const [highlightActionMenu, setHighlightActionMenu] = useState(null); // { vx, vy, editingId }
  const [highlightStyleTargetId, setHighlightStyleTargetId] = useState(null); // id of an existing highlight being style-edited
  const [bboxActionMenu, setBBoxActionMenu] = useState(null); // { vx, vy, editingId }
  const [bboxMinibarOpenId, setBBoxMinibarOpenId] = useState(null);
  const [bboxResizeTargetId, setBBoxResizeTargetId] = useState(null); // id of an existing bbox armed for resize
  const [bboxResizePreview, setBBoxResizePreview] = useState(null);
  const [bboxOverlayTick, setBBoxOverlayTick] = useState(0);
  const bboxLabelRefs = useRef({});
  const [bboxLabelPositions, setBBoxLabelPositions] = useState({});
  const bboxActionRefs = useRef({});
  const [bboxActionPositions, setBBoxActionPositions] = useState({});
  const toggleBBoxCreationType = useCallback((type) => {
    setActiveBBoxCreationType((current) => (current === type ? null : type));
  }, []);
  useLayoutEffect(() => {
    if (!pageViewport || !managedBboxes.length) return;
    const canvasRect = annotCanvasRef.current?.getBoundingClientRect?.();
    if (!canvasRect) return;
    const scale = pageViewport.scale || (fitScaleRef.current * zoomRef.current);
    const canvasScaleX = canvasRect.width && pageViewport.width ? canvasRect.width / pageViewport.width : 1;
    const canvasScaleY = canvasRect.height && pageViewport.height ? canvasRect.height / pageViewport.height : canvasScaleX;
    const priority = (label) => (
      label.startsWith("Section") ? 0
        : label.startsWith("Paragraph") ? 1
          : label.startsWith("Bullet") ? 2
            : label.startsWith("Image") ? 3 : 4
    );
    const overlaps = (a, b, gap = 2) => !(
      a.right + gap <= b.left
      || a.left >= b.right + gap
      || a.bottom + gap <= b.top
      || a.top >= b.bottom + gap
    );
    const ordered = managedBboxes
      .map((bbox) => ({ bbox, label: getBBoxTypeDefinition(bbox.type)?.label || "" }))
      .filter(({ bbox, label }) => label && bboxLabelRefs.current[bbox.id])
      .sort((a, b) => (
        priority(a.label) - priority(b.label)
        || a.bbox.y - b.bbox.y
        || a.bbox.x - b.bbox.x
        || String(a.bbox.id).localeCompare(String(b.bbox.id))
      ));
    const placed = [];
    const next = {};
    for (const { bbox, label } of ordered) {
      const element = bboxLabelRefs.current[bbox.id];
      const measured = element.getBoundingClientRect();
      const labelWidth = measured.width;
      const labelHeight = measured.height;
      const bboxLeft = bbox.x * scale * canvasScaleX;
      const bboxTop = bbox.y * scale * canvasScaleY;
      const bboxBottom = (bbox.y + bbox.h) * scale * canvasScaleY;
      const left = bboxLeft - labelWidth;
      const minY = bboxTop;
      const maxY = Math.max(minY, bboxBottom - labelHeight);
      let top = minY;
      let blocked = false;
      let changed = true;
      while (changed) {
        changed = false;
        const candidate = { left, top, right: bboxLeft, bottom: top + labelHeight };
        for (const previous of placed) {
          if (!overlaps(candidate, previous)) continue;
          const nextY = Math.min(previous.bottom + 2, maxY);
          if (nextY <= top) {
            blocked = true;
            changed = false;
            break;
          }
          top = nextY;
          changed = true;
          break;
        }
      }
      const labelOffsetY = Math.max(0, Math.min(top - bboxTop, maxY - bboxTop));
      const resolved = { labelOffsetY, blocked };
      placed.push({ left, top: bboxTop + labelOffsetY, right: bboxLeft, bottom: bboxTop + labelOffsetY + labelHeight });
      next[bbox.id] = resolved;
    }
    setBBoxLabelPositions((current) => JSON.stringify(current) === JSON.stringify(next) ? current : next);
  }, [managedBboxes, pageViewport]);
  useLayoutEffect(() => {
    if (!pageViewport || !managedBboxes.length) return;
    const canvasRect = annotCanvasRef.current?.getBoundingClientRect?.();
    if (!canvasRect) return;
    const scale = pageViewport.scale || (fitScaleRef.current * zoomRef.current);
    const canvasScaleX = canvasRect.width && pageViewport.width ? canvasRect.width / pageViewport.width : 1;
    const canvasScaleY = canvasRect.height && pageViewport.height ? canvasRect.height / pageViewport.height : canvasScaleX;
    const priority = (label) => (
      label.startsWith("Section") ? 0
        : label.startsWith("Paragraph") ? 1
          : label.startsWith("Bullet") ? 2
            : label.startsWith("Image") ? 3 : 4
    );
    const overlaps = (a, b, gap = 2) => !(
      a.right + gap <= b.left
      || a.left >= b.right + gap
      || a.bottom + gap <= b.top
      || a.top >= b.bottom + gap
    );
    const ordered = managedBboxes
      .map((bbox) => ({ bbox, label: getBBoxTypeDefinition(bbox.type)?.label || "" }))
      .filter(({ bbox }) => bboxActionRefs.current[bbox.id])
      .sort((a, b) => (
        priority(a.label) - priority(b.label)
        || a.bbox.y - b.bbox.y
        || a.bbox.x - b.bbox.x
        || String(a.bbox.id).localeCompare(String(b.bbox.id))
      ));
    const placed = [];
    const next = {};
    for (const { bbox } of ordered) {
      const element = bboxActionRefs.current[bbox.id];
      const measured = element.getBoundingClientRect();
      const width = measured.width;
      const height = measured.height;
      const bboxLeft = bbox.x * scale * canvasScaleX;
      const bboxTop = bbox.y * scale * canvasScaleY;
      const bboxBottom = (bbox.y + bbox.h) * scale * canvasScaleY;
      const minY = bboxTop;
      const maxY = Math.max(minY, bboxBottom - height);
      const left = bboxLeft - width;
      let top = minY;
      let changed = true;
      let blocked = false;
      while (changed) {
        changed = false;
        const candidate = { left, top, right: bboxLeft, bottom: top + height };
        for (const previous of placed) {
          if (!overlaps(candidate, previous)) continue;
          const nextY = Math.min(previous.bottom + 2, maxY);
          if (nextY <= top) {
            blocked = true;
            changed = false;
            break;
          }
          top = nextY;
          changed = true;
          break;
        }
      }
      next[bbox.id] = {
        offsetY: top - bboxTop,
        blocked,
      };
      placed.push({ left, top, right: bboxLeft, bottom: top + height });
    }
    setBBoxActionPositions((current) => JSON.stringify(current) === JSON.stringify(next) ? current : next);
  }, [managedBboxes, pageViewport, bboxMinibarOpenId]);
  const [bboxContainerBBoxTarget, setBBoxContainerBBoxTarget] = useState(null); // { pageNum, containerId } — next bbox should be placed inside this container
  const [smartSegmentingBusy, setSmartSegmentingBusy] = useState(false);
  const [smartSegmentingError, setSmartSegmentingError] = useState("");
  const [semanticDetectionBusy, setSemanticDetectionBusy] = useState(false);
  const [semanticDetectionError, setSemanticDetectionError] = useState("");
  const [semanticDetectionPreview, setSemanticDetectionPreview] = useState(null);
  const [semanticDetectionDialogOpen, setSemanticDetectionDialogOpen] = useState(false);
  const [semanticDetectionScope, setSemanticDetectionScope] = useState(SEMANTIC_DETECTION_SCOPE.CURRENT_PAGE);
  const annotTextInputRef = useRef(null);
  const textActionMenuRef = useRef(null);
  const highlightActionMenuRef = useRef(null);
  const bboxActionMenuRef = useRef(null);
  const annotCanvasRef  = useRef(null);
  const bboxOverlayRef = useRef(null);
  const pdfBytesRef = useRef(null);
  useEffect(() => {
    if (!import.meta.env.DEV || !managedBboxes.length) return;
    const overlay = bboxOverlayRef.current;
    if (!overlay) return;
    const targets = [
      overlay,
      ...overlay.querySelectorAll(".pdf_bbox_resize_handle"),
      ...document.querySelectorAll(".pdf_bbox_type_label, .pdf_bbox_action_stack"),
    ];
    const audit = targets.map((element) => {
      const ancestors = [];
      let node = element.parentElement;
      while (node) {
        const style = getComputedStyle(node);
        ancestors.push({
          element: node.id || node.className || node.tagName,
          transform: style.transform,
          zoom: style.zoom,
        });
        node = node.parentElement;
      }
      const style = getComputedStyle(element);
      return {
        element: element.id || element.className || element.tagName,
        transform: style.transform,
        zoom: style.zoom,
        ancestors,
      };
    });
      console.debug("[PDF BBox overlay audit]", {
        zoom,
        overlayTransform: getComputedStyle(overlay).transform,
        bboxAudit: audit,
      });
    const label = document.querySelector(".pdf_bbox_type_label");
    if (label) {
      const labelStyle = getComputedStyle(label);
      const firstBBox = managedBboxes[0];
      const bboxScale = pageViewport?.scale || (fitScaleRef.current * zoomRef.current);
      console.table({
        zoom,
        bboxTop: firstBBox ? firstBBox.y * bboxScale : null,
        bboxHeight: firstBBox ? firstBBox.h * bboxScale : null,
        labelOffsetY: firstBBox ? (bboxLabelPositions[firstBBox.id]?.labelOffsetY || 0) : null,
        renderedPageTop: firstBBox
          ? firstBBox.y * bboxScale + (bboxLabelPositions[firstBBox.id]?.labelOffsetY || 0)
          : null,
        labelInlineTop: label.style.top,
        labelFontSize: labelStyle.fontSize,
        labelTransform: labelStyle.transform,
        bboxBorderWidth: labelStyle.borderWidth,
      });
    }
  }, [bboxOverlayTick, bboxLabelPositions, managedBboxes, pageViewport, zoom]);
  useEffect(() => {
    const preview = previewRef.current;
    if (!preview) return undefined;
    const refresh = () => setBBoxOverlayTick((tick) => tick + 1);
    preview.addEventListener("scroll", refresh, { passive: true });
    window.addEventListener("resize", refresh);
    return () => {
      preview.removeEventListener("scroll", refresh);
      window.removeEventListener("resize", refresh);
    };
  }, [pageViewport]);
  // Separate, non-multiply-blended layer stacked above #pdf_annot_canvas —
  // see drawMaskedHighlightText's own comment in annotationDraw.js for why
  // masked/recolored highlight text can't just draw on the (CSS
  // mix-blend-mode:multiply) annotation canvas itself: multiply can never
  // fully replace/hide what's underneath with a new opaque color.
  const maskCanvasRef = useRef(null);
  const activeAnnotRef  = useRef(null);  // in-progress shape
  // What the LAST eraser gesture actually did to pageNum's array — before
  // (the full pre-erase snapshot) and after (the exact resulting array
  // reference). handleAnnotUndo's plain "pop the last item" logic assumes
  // undo target is whatever's now last in the array, which is only true
  // for a just-ADDED annotation; erasing REMOVES from arbitrary positions
  // (and, in "precise" mode, can shrink a stroke's own points in place
  // rather than removing it at all), so popping the new last item after an
  // erase deleted a completely unrelated annotation instead of restoring
  // what was erased. `after` lets undo confirm nothing has mutated the
  // page since (reference equality against the live annotations[pageNum])
  // before trusting this snapshot — any other edit naturally invalidates
  // it without needing to be tracked separately.
  const lastEraseRef = useRef(null);
  const eraserCursorRef = useRef(null);  // eraser-size preview circle, see the effect below
  const ocrBlankMeasureCanvasRef = useRef(null);
  const blankPageStructureDocumentRef = useRef({ key: "", documentId: null });
  // Close the floating color/text/highlight action dropdowns on an outside
  // click. Listens on "click" (fires after mouseup), not "mousedown" —
  // mousedown fires before a button's own onClick, so with mousedown a
  // click landing squarely on e.g. the highlight menu's Delete button could
  // still lose a race: this handler runs first, closes/unmounts the menu,
  // and the button's own onClick never gets a chance to fire once its DOM
  // node is gone. Synthetic/instant test clicks never showed it (down+up
  // with no gap leaves no time for the intervening re-render), but any
  // real click with normal human press/release timing hits it — reported
  // as "Delete's background flashes red then nothing happens". Listening
  // on "click" instead means the target's own onClick (attached to the
  // element itself) always runs before this bubbled document-level check.
  useEffect(() => {
    if (!colorMenuOpen && !textActionMenu && !highlightActionMenu && !bboxActionMenu) return;
    const onDocClick = (e) => {
      if (
        colorMenuOpen
        && !(colorMenuRef.current && colorMenuRef.current.contains(e.target))
        && !(bgSwatchRef.current && bgSwatchRef.current.contains(e.target))
        && !(colorMenuPopoverRef.current && colorMenuPopoverRef.current.contains(e.target))
      ) setColorMenuOpen(false);
      if (textActionMenu && textActionMenuRef.current && !textActionMenuRef.current.contains(e.target)) setTextActionMenu(null);
      if (highlightActionMenu && highlightActionMenuRef.current && !highlightActionMenuRef.current.contains(e.target)) setHighlightActionMenu(null);
      if (bboxActionMenu && bboxActionMenuRef.current && !bboxActionMenuRef.current.contains(e.target)) setBBoxActionMenu(null);
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [colorMenuOpen, textActionMenu, highlightActionMenu, bboxActionMenu]);

  useEffect(() => {
    if (!bboxMinibarOpenId) return undefined;
    const onDocumentClick = (event) => {
      if (
        event.target.closest?.(".pdf_bbox_type_label")
        || event.target.closest?.(".pdf_bbox_action_stack")
      ) return;
      setBBoxMinibarOpenId(null);
    };
    document.addEventListener("click", onDocumentClick);
    return () => document.removeEventListener("click", onDocumentClick);
  }, [bboxMinibarOpenId]);

  useEffect(() => {
    if (annotTool !== "text") setTextActionMenu(null);
    if (annotTool !== "text") setTextStyleTargetId(null);
    if (annotTool !== "highlight") setHighlightActionMenu(null);
    if (annotTool !== "highlight") setHighlightStyleTargetId(null);
    if (annotTool === "bbox") {
      setActiveBBoxCreationType((current) => current || "bbox");
    } else {
      setBBoxActionMenu(null);
      setBBoxMinibarOpenId(null);
      setBBoxResizeTargetId(null);
      setBBoxResizePreview(null);
      setActiveBBoxCreationType(null);
      setBBoxContainerBBoxTarget(null);
    }
  }, [annotTool]);

  // .annot_tool_options (the sub-toolbar dropdown) opens from the active
  // tool's OWN button position, not the toolbar's fixed corner — any of
  // the 4 SHAPE_TOOL_KEYS still anchor to the single "Shapes" button in
  // the main strip (there's no separate button per shape), everything
  // else anchors to its own like-named button directly.
  useEffect(() => {
    const anchorKey = SHAPE_TOOL_KEYS.includes(annotTool) ? "shapes" : annotTool;
    const btn = anchorKey ? toolButtonRefs.current[anchorKey] : null;
    const toolbarEl = toolbarRef.current;
    if (!btn || !toolbarEl) { setToolOptionsOffset(0); return; }
    const btnRect = btn.getBoundingClientRect();
    const toolbarRect = toolbarEl.getBoundingClientRect();
    const offset = (effectiveToolbarEdge === "left" || effectiveToolbarEdge === "right")
      ? btnRect.top - toolbarRect.top
      : btnRect.left - toolbarRect.left;
    setToolOptionsOffset(offset);
  }, [annotTool, effectiveToolbarEdge]);

  useEffect(() => {
    if (!annotTextInput) return;
    requestAnimationFrame(() => {
      annotTextInputRef.current?.focus?.();
      annotTextInputRef.current?.select?.();
    });
  }, [annotTextInput]);

  // fontSize stays canvas-space throughout (matching ann.fontSize's own
  // stored semantics, see annotationDraw.js's `(ann.fontSize||16) * s`) —
  // not scaled by the caller's current zoom, so the SizeKnob's number and
  // the eventual saved value never drift from what's actually on the page.
  // Only the live-editing <input>'s own CSS font-size (rendered, not
  // stored) needs a zoom multiply, applied right where it's used.
  const primeTextStyleFromAnnotation = useCallback((hit) => {
    setTextFontFamily(hit.fontFamily || "Georgia");
    setTextFontSize(Math.max(10, Math.round(hit.fontSize || 16)));
    setTextAlign(hit.textAlign || "left");
    setTextBold(Boolean(hit.fontBold));
    setTextItalic(Boolean(hit.fontItalic));
    setTextUnderline(Boolean(hit.textUnderline));
    setTextBackground(Boolean(hit.textBackground));
    setTextBackgroundColor(hit.textBackgroundColor || annotColor);
    setTextPadding(hit.padding ?? 100);
  }, [annotColor]);

  const openTextEditorForHit = useCallback((hit) => {
    const scale = fitScaleRef.current * zoomRef.current;
    const box = getTextAnnotationBounds(hit, scale);
    setAnnotTextInput({
      vx: annotCanvasRef.current.getBoundingClientRect().left + box.left,
      vy: annotCanvasRef.current.getBoundingClientRect().top + box.top,
      cx: hit.x * scale,
      cy: hit.y * scale,
      width: Math.max(120, box.right - box.left + 12),
      editingId: hit.id,
    });
    setAnnotTextVal(hit.text || "");
    primeTextStyleFromAnnotation(hit);
    setTextStyleTargetId(null);
    setTextActionMenu(null);
  }, [getTextAnnotationBounds, primeTextStyleFromAnnotation]);

  const updateStyledTextTarget = useCallback((patch) => {
    if (!textStyleTargetId) return;
    setAnnotations((prev) => ({
      ...prev,
      [pageNum]: (prev[pageNum] || []).map((ann) => (ann.id === textStyleTargetId ? { ...ann, ...patch } : ann)),
    }));
    setRedoStacks((prev) => (prev[pageNum]?.length ? { ...prev, [pageNum]: [] } : prev));
    logAnnotHistory({ action: "edit", type: "text", page: pageNum });
  }, [textStyleTargetId, pageNum, logAnnotHistory]);

  const handleTextAction = useCallback((action) => {
    if (!textActionMenu) return;
    const hit = (annotations[pageNum] || []).find((ann) => ann.id === textActionMenu.editingId);
    if (!hit) {
      setTextActionMenu(null);
      return;
    }

    if (action === "delete") {
      setAnnotations((prev) => ({
        ...prev,
        [pageNum]: (prev[pageNum] || []).filter((ann) => ann.id !== hit.id),
      }));
      setRedoStacks((prev) => (prev[pageNum]?.length ? { ...prev, [pageNum]: [] } : prev));
      markAnnotationCleared(hit.id, pageNum, "text");
      setAnnotTextInput(null);
      setAnnotTextVal("");
      setTextStyleTargetId(null);
      setTextActionMenu(null);
      return;
    }

    if (action === "edit-style") {
      setTextStyleTargetId(hit.id);
      primeTextStyleFromAnnotation(hit);
      setAnnotTextInput(null);
      setAnnotTextVal("");
      setTextActionMenu(null);
      return;
    }

    openTextEditorForHit(hit);
  }, [textActionMenu, annotations, pageNum, markAnnotationCleared, primeTextStyleFromAnnotation]);

  // Primes the shared highlight toolbar controls from an existing
  // annotation — annotColor is already namespaced per-tool (see its own
  // definition above), so this only ever touches the highlight tool's
  // own remembered color, same as switching tools normally would.
  const primeHighlightStyleFromAnnotation = useCallback((hit) => {
    setAnnotColor(hit.color || annotColor);
    setAnnotSize(hit.lineWidth || annotSize);
    setHighlightMode(hit.mode || "freehand");
    setHighlightTaperEnds(hit.taperEnds !== false);
    setAnnotOpacity(Math.round((hit.opacity ?? 0.35) * 100));
  }, [annotColor, annotSize, setAnnotColor]);

  const updateStyledHighlightTarget = useCallback((patch) => {
    if (!highlightStyleTargetId) return;
    setAnnotations((prev) => ({
      ...prev,
      [pageNum]: (prev[pageNum] || []).map((ann) => (ann.id === highlightStyleTargetId ? { ...ann, ...patch } : ann)),
    }));
    setRedoStacks((prev) => (prev[pageNum]?.length ? { ...prev, [pageNum]: [] } : prev));
    logAnnotHistory({ action: "edit", type: "highlight", page: pageNum });
  }, [highlightStyleTargetId, pageNum, logAnnotHistory]);

  // Single central sync point instead of wiring every highlight toolbar
  // control's own onChange individually (color swatch, SizeKnob, mode
  // toggle, taper toggle, opacity slider) — same net effect as
  // updateStyledTextTarget's per-control calls, less places to miss one.
  useEffect(() => {
    if (!highlightStyleTargetId) return;
    updateStyledHighlightTarget({
      color: annotColor,
      lineWidth: annotSize,
      mode: highlightMode,
      taperEnds: highlightTaperEnds,
      opacity: annotOpacity / 100,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotColor, annotSize, highlightMode, highlightTaperEnds, annotOpacity, highlightStyleTargetId]);

  const handleHighlightAction = useCallback((action) => {
    if (!highlightActionMenu) return;
    const hit = (annotations[pageNum] || []).find((ann) => ann.id === highlightActionMenu.editingId);
    if (!hit) {
      setHighlightActionMenu(null);
      return;
    }

    if (action === "delete") {
      setAnnotations((prev) => ({
        ...prev,
        [pageNum]: (prev[pageNum] || []).filter((ann) => ann.id !== hit.id),
      }));
      setRedoStacks((prev) => (prev[pageNum]?.length ? { ...prev, [pageNum]: [] } : prev));
      markAnnotationCleared(hit.id, pageNum, "highlight");
      setHighlightStyleTargetId(null);
      setHighlightActionMenu(null);
      return;
    }

    setHighlightStyleTargetId(hit.id);
    primeHighlightStyleFromAnnotation(hit);
    setHighlightActionMenu(null);
  }, [highlightActionMenu, annotations, pageNum, markAnnotationCleared, primeHighlightStyleFromAnnotation]);

  const handleBBoxAction = useCallback((action) => {
    if (!bboxActionMenu) return;
    const hit = (annotations[pageNum] || []).find((ann) => ann.id === bboxActionMenu.editingId && EDITABLE_BBOX_TYPES.has(ann.type));
    if (!hit) {
      setBBoxActionMenu(null);
      setBBoxResizeTargetId(null);
      return;
    }

    if (action === "delete") {
      setAnnotations((prev) => ({
        ...prev,
        [pageNum]: (prev[pageNum] || []).filter((ann) => ann.id !== hit.id),
      }));
      setRedoStacks((prev) => (prev[pageNum]?.length ? { ...prev, [pageNum]: [] } : prev));
      markAnnotationCleared(hit.id, pageNum, hit.type);
      setBBoxResizeTargetId(null);
      setBBoxActionMenu(null);
      return;
    }

    setBBoxResizeTargetId(hit.id);
    setBBoxActionMenu(null);
  }, [bboxActionMenu, annotations, pageNum, markAnnotationCleared]);

  const beginBBoxResize = useCallback((bbox, handle, event) => {
    if (!bbox || !handle || event.pointerType !== "pen") return;
    event.preventDefault();
    event.stopPropagation();
    const pointerId = event.pointerId;
    event.currentTarget?.setPointerCapture?.(pointerId);
    const getClientPoint = (inputEvent) => (
      inputEvent.touches?.[0]
        ? { x: inputEvent.touches[0].clientX, y: inputEvent.touches[0].clientY }
        : { x: inputEvent.clientX, y: inputEvent.clientY }
    );
    const toCanvasFromClient = (clientX, clientY) => {
      const rect = annotCanvasRef.current?.getBoundingClientRect?.();
      const scale = fitScaleRef.current * zoomRef.current;
      if (!rect || !scale) return null;
      return {
        x: (clientX - rect.left) / scale,
        y: (clientY - rect.top) / scale,
      };
    };
    const startClient = getClientPoint(event);
    const start = toCanvasFromClient(startClient.x, startClient.y);
    if (!start) return;
    const workingBounds = {
      x: Number(bbox.x) || 0,
      y: Number(bbox.y) || 0,
      w: Math.max(1, Number(bbox.w) || 1),
      h: Math.max(1, Number(bbox.h) || 1),
    };
    activeAnnotRef.current = {
      ...bbox,
      closed: isBBoxOutlineClosed(bbox),
      _editingId: bbox.id,
      points: buildEditableBBoxOutline(workingBounds),
      x: workingBounds.x,
      y: workingBounds.y,
      w: workingBounds.w,
      h: workingBounds.h,
      _resizeSide: handle.side,
      _resizeStartX: start.x,
      _resizeStartY: start.y,
      _lastDragX: start.x,
      _lastDragY: start.y,
      _dragMoved: false,
    };
    setBBoxActionMenu(null);
    setBBoxResizeTargetId(bbox.id);
    const onMove = (moveEvent) => {
      if (moveEvent.pointerId !== pointerId || moveEvent.pointerType !== "pen") return;
      const client = getClientPoint(moveEvent);
      const next = toCanvasFromClient(client.x, client.y);
      const ann = activeAnnotRef.current;
      if (!next || !ann || ann.id !== bbox.id) return;
      moveEvent.preventDefault?.();
      const dx = next.x - (ann._lastDragX ?? next.x);
      const dy = next.y - (ann._lastDragY ?? next.y);
      if (ann._resizeSide && (dx !== 0 || dy !== 0)) {
        if (!ann._dragMoved && Math.hypot(next.x - ann._resizeStartX, next.y - ann._resizeStartY) < 0.8) return;
        ann._dragMoved = true;
        const right = ann.x + ann.w;
        const bottom = ann.y + ann.h;
        const minimumSize = 1;
        if (ann._resizeSide === "top") {
          const nextTop = Math.min(next.y, bottom - minimumSize);
          ann.y = nextTop;
          ann.h = bottom - nextTop;
        } else if (ann._resizeSide === "right") {
          ann.w = Math.max(minimumSize, next.x - ann.x);
        } else if (ann._resizeSide === "bottom") {
          ann.h = Math.max(minimumSize, next.y - ann.y);
        } else if (ann._resizeSide === "left") {
          const nextLeft = Math.min(next.x, right - minimumSize);
          ann.x = nextLeft;
          ann.w = right - nextLeft;
        }
        ann.points = buildEditableBBoxOutline(ann);
        setBBoxResizePreview({ id: bbox.id, x: ann.x, y: ann.y, w: ann.w, h: ann.h });
        ann._lastDragX = next.x;
        ann._lastDragY = next.y;
      }
    };
    const onEnd = (endEvent) => {
      if (endEvent?.pointerId !== pointerId || endEvent?.pointerType !== "pen") return;
      endEvent?.preventDefault?.();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      const ann = activeAnnotRef.current;
      activeAnnotRef.current = null;
      if (!ann || ann.id !== bbox.id || !ann._editingId) return;
      if (!ann._dragMoved) {
        setBBoxResizePreview(null);
        return;
      }
      setAnnotations((prev) => {
        const pageAnnotations = prev[pageNum] || [];
        const childBboxes = bboxTypeHas(ann.type, "containsChildren")
          ? pageAnnotations.filter((item) => (
            item.id !== ann._editingId
            && BBOX_CARD_TYPES.has(item.type)
            && item.x >= ann.x
            && item.y >= ann.y
            && item.x + item.w <= ann.x + ann.w
            && item.y + item.h <= ann.y + ann.h
          ))
          : [];
        const resizedPageAnnotations = pageAnnotations.map((item) => (
            item.id === ann._editingId
              ? {
                  ...item,
                  x: ann.x,
                  y: ann.y,
                  w: ann.w,
                  h: ann.h,
                  ...(Array.isArray(ann.points) && ann.points.length >= 2 ? { points: ann.points.map((point) => ({ ...point })) } : {}),
                  ...(bboxTypeHas(item.type, "extractsText")
                    ? (() => {
                        const resizedBox = { x: ann.x, y: ann.y, w: ann.w, h: ann.h };
                        const extracted = extractBoundingBoxTextParts(
                          spansRef.current,
                          resizedBox,
                          bboxTextMatchesSpan,
                          [],
                          { preserveColumns: true, splitLines: ["bbox", "columnBBox", "subLineBBox"].includes(item.type), detectTitle: item.smartSegmented },
                        );
                        const partitionedText = item.type === "bbox"
                          ? buildPartitionOrderedTextLines(
                              spansRef.current,
                              resizedBox,
                              pageAnnotations.filter((candidate) => candidate?.type === "columnBBox"),
                              bboxTextMatchesSpan,
                            )
                          : { lines: [], groups: [], partitionIds: [] };
                        const partitionLines = partitionedText.lines.map((line) => line.text).filter(Boolean);
                        const bodyLines = partitionLines.length
                          ? removeParagraphTitleLine(partitionLines, item.title).bodyLines
                          : [];
                        const resizedText = bodyLines.length
                          ? bodyLines.join("\n")
                          : stripTitleFromBBoxTextValue(extracted.text, item.titleBBox?.text || extracted.title || item.title || "");
                        return {
                          title: item.smartSegmented
                            ? (extracted.title || item.title || "")
                            : (item.title || ""),
                          text: resizedText,
                          rawPdfText: resizedText,
                          ...(bodyLines.length ? { textLines: bodyLines } : {}),
                          ...(partitionedText.partitionIds.length > 1 ? {
                            partitionIds: partitionedText.partitionIds,
                            partitionLineGroups: partitionedText.groups.map((group) => ({
                              partitionId: group.partitionId,
                              lines: group.lines.map((line) => line.text).filter(Boolean),
                            })),
                          } : { partitionIds: [], partitionLineGroups: [] }),
                        };
                      })()
                    : bboxTypeHas(item.type, "extractsContainerTitle")
                      ? (() => {
                          const extracted = extractBoundingBoxTextParts(
                            spansRef.current,
                            { x: ann.x, y: ann.y, w: ann.w, h: ann.h },
                            bboxTextMatchesSpan,
                            childBboxes,
                          );
                          return {
                            title: extracted.title || item.title || "",
                          };
                        })()
                  : {}),
                }
              : item
          ));
        return {
          ...prev,
          [pageNum]: resizedPageAnnotations,
        };
      });
      setRedoStacks((prev) => (prev[pageNum]?.length ? { ...prev, [pageNum]: [] } : prev));
      logAnnotHistory({ action: "edit", type: ann.type, page: pageNum });
      setBBoxResizePreview(null);
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onEnd, { passive: false });
    window.addEventListener("pointercancel", onEnd, { passive: false });
  }, [annotations, pageNum, pageViewport, visiblePageAnnotations, logAnnotHistory, bboxTextMatchesSpan]);

  const updateBBoxName = useCallback((bboxId, nextName, targetPage = pageNum) => {
    const title = typeof nextName === "string" ? nextName.trim() : "";
    if (!title) return;
    let nextAnnotations = null;
    setAnnotations((prev) => {
      const nextPageAnnotations = (prev[targetPage] || []).map((ann) => {
        if (ann.id !== bboxId || !EDITABLE_BBOX_TYPES.has(ann.type)) return ann;
        if (ann.type !== "bbox") return { ...ann, title };
        const liveSourceTextLines = targetPage === pageNum
          ? buildTextLines(selectSpansForBoundingBox(
              spansRef.current,
              ann,
              bboxTextMatchesSpanUtil,
              [],
              { preserveColumns: true, splitLines: true },
            )).map((line) => line.text).filter(Boolean)
          : [];
        const sourceTextLines = Array.isArray(ann.sourceTextLines) && ann.sourceTextLines.length
          ? ann.sourceTextLines
          : (liveSourceTextLines.length
            ? liveSourceTextLines
            : (Array.isArray(ann.textLines) && ann.textLines.length
            ? ann.textLines
            : String(ann.sourceRawPdfText || ann.rawPdfText || ann.text || "").split(/\r?\n/).filter(Boolean)));
        const { bodyLines, removedLine } = removeParagraphTitleLine(sourceTextLines, title);
        const sourceRawPdfText = ann.sourceRawPdfText || ann.rawPdfText || ann.text || sourceTextLines.join("\n");
        const bodyRawText = removedLine
          ? bodyLines.join("\n")
          : removeParagraphTitleFromText(sourceRawPdfText, title);
        return {
          ...ann,
          title,
          titleSourceLine: removedLine || ann.titleSourceLine || "",
          sourceTextLines,
          sourceRawPdfText,
          textLines: bodyLines,
          text: removedLine ? bodyRawText : (removeParagraphTitleFromText(ann.text || bodyRawText, title) || bodyRawText),
          rawPdfText: bodyRawText,
          correctedText: removeParagraphTitleFromText(ann.correctedText, title),
          ocrCorrectedText: removeParagraphTitleFromText(ann.ocrCorrectedText, title),
          textCorrection: {
            ...(ann.textCorrection || {}),
            audit: null,
            applied: false,
            correctionVersion: null,
          },
        };
      });
      nextAnnotations = { ...prev, [targetPage]: nextPageAnnotations };
      return nextAnnotations;
    });
    setRedoStacks((prev) => (prev[targetPage]?.length ? { ...prev, [targetPage]: [] } : prev));
    logAnnotHistory({ action: "edit", type: "bbox", page: targetPage });
    const sourceId = currentSourceIdRef.current;
    if (sourceId && nextAnnotations) {
      authFetch(apiUrl(`/api/source-annotations/${sourceId}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildAnnotationSavePayload({ activeAnnotations: nextAnnotations })),
      }).catch(() => {});
    }
  }, [annotHistory, pageNum, logAnnotHistory]);

  const mergeParagraphBBoxes = useCallback((bboxIds, targetPage = pageNum) => {
    const orderedIds = [...new Set(Array.isArray(bboxIds) ? bboxIds : [])];
    if (orderedIds.length < 2) return;
    const currentAnnotations = annotationsRef.current;
    const pageAnnotations = currentAnnotations[targetPage] || [];
    const byId = new Map(pageAnnotations.map((annotation) => [annotation.id, annotation]));
    const selectedParagraphs = orderedIds.map((id) => byId.get(id)).filter((annotation) => annotation?.type === "bbox");
    if (selectedParagraphs.length < 2) return;

    const spanOrderByKey = new Map(spansRef.current.map((span, index) => [span.spanKey, index]));
    const mergeRecords = selectedParagraphs.map((paragraph, inputOrder) => {
      const selectedSpans = targetPage === pageNum
        ? selectSpansForBoundingBox(
            spansRef.current,
            paragraph,
            bboxTextMatchesSpanUtil,
            [],
            { preserveColumns: true, splitLines: true },
          )
        : [];
      const readingOrder = selectedSpans.reduce((earliest, span) => (
        Math.min(earliest, spanOrderByKey.get(span.spanKey) ?? Number.POSITIVE_INFINITY)
      ), Number.POSITIVE_INFINITY);
      const liveLines = buildTextLines(selectedSpans).map((line) => line.text).filter(Boolean);
      const lines = liveLines.length
        ? liveLines
        : (Array.isArray(paragraph.textLines) && paragraph.textLines.length
          ? paragraph.textLines
          : String(paragraph.rawPdfText || paragraph.text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
      return { paragraph, inputOrder, readingOrder, lines };
    });
    const { orderedRecords, survivor, mergedLines } = buildParagraphMergePlan(mergeRecords);
    const paragraphs = orderedRecords.map((record) => record.paragraph);
    if (!survivor) return;
    const mergedIds = new Set(paragraphs.map((paragraph) => paragraph.id));
    const removedIds = new Set(paragraphs.filter((paragraph) => paragraph.id !== survivor.id).map((paragraph) => paragraph.id));
    const left = Math.min(...paragraphs.map((paragraph) => paragraph.x));
    const top = Math.min(...paragraphs.map((paragraph) => paragraph.y));
    const right = Math.max(...paragraphs.map((paragraph) => paragraph.x + paragraph.w));
    const bottom = Math.max(...paragraphs.map((paragraph) => paragraph.y + paragraph.h));
    const text = mergedLines.join("\n");
    const parentIds = new Set(paragraphs.map((paragraph) => paragraph.parentId || null));
    const sharedParentId = parentIds.size === 1 ? paragraphs[0].parentId : null;
    let mergedParagraph = {
      ...survivor,
      x: left,
      y: top,
      w: right - left,
      h: bottom - top,
      points: [
        { x: left, y: top },
        { x: right, y: top },
        { x: right, y: bottom },
        { x: left, y: bottom },
      ],
      closed: true,
      text,
      rawPdfText: text,
      textLines: mergedLines,
      correctedText: "",
      ocrCorrectedText: "",
      textCorrection: {
        source: "pdf_text_layer",
        confidence: 1,
        warnings: [],
        correctionVersion: BBOX_TEXT_CORRECTION_VERSION,
      },
      textAutoFitted: false,
      autoFitSourceGeometry: null,
    };
    if (sharedParentId) mergedParagraph.parentId = sharedParentId;
    else {
      const { parentId: _discardedParentId, ...withoutParent } = mergedParagraph;
      mergedParagraph = withoutParent;
    }

    const nextPageAnnotations = pageAnnotations
      .filter((annotation) => (
        !removedIds.has(annotation.id)
        && !(annotation.type === "bboxTitle" && removedIds.has(annotation.ownerId || annotation.containerId))
      ))
      .map((annotation) => {
        if (annotation.id === survivor.id) return mergedParagraph;
        if (annotation.parentId && mergedIds.has(annotation.parentId)) {
          return { ...annotation, parentId: survivor.id };
        }
        return annotation;
      });
    const nextAnnotations = { ...currentAnnotations, [targetPage]: nextPageAnnotations };
    annotationsRef.current = nextAnnotations;
    setAnnotations(nextAnnotations);
    setRedoStacks((prev) => (prev[targetPage]?.length ? { ...prev, [targetPage]: [] } : prev));
    logAnnotHistory({ action: "merge", type: "bbox", page: targetPage });

    const sourceId = currentSourceIdRef.current;
    if (sourceId) {
      authFetch(apiUrl(`/api/source-annotations/${sourceId}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildAnnotationSavePayload({ activeAnnotations: nextAnnotations })),
      }).catch(() => {});
    }
  }, [logAnnotHistory, pageNum]);

  const autoFitBBoxToText = useCallback((bbox, targetPage = pageNum) => {
    if (!bbox || !bboxTypeHas(bbox.type, "autoFitsText")) return;
    if (bbox.textAutoFitted && bbox.autoFitSourceGeometry) {
      setAnnotations((prev) => ({
        ...prev,
        [targetPage]: (prev[targetPage] || []).map((annotation) => {
          if (annotation.id !== bbox.id) return annotation;
          const restored = {
            ...annotation,
            ...bbox.autoFitSourceGeometry,
            textAutoFitted: false,
            autoFitSourceGeometry: null,
          };
          const extracted = extractBoundingBoxTextParts(
            spansRef.current,
            { x: restored.x, y: restored.y, w: restored.w, h: restored.h },
            bboxTextMatchesSpan,
            [],
            { preserveColumns: true, splitLines: ["bbox", "columnBBox", "subLineBBox"].includes(bbox.type), detectTitle: bbox.smartSegmented },
          );
          return {
            ...restored,
            title: annotation.titleBBox?.text || annotation.title || "",
            text: stripTitleFromBBoxText(
              extracted.text || annotation.text || "",
              annotation.titleBBox?.text || annotation.title || "",
            ),
          };
        }),
      }));
      setRedoStacks((prev) => (prev[targetPage]?.length ? { ...prev, [targetPage]: [] } : prev));
      logAnnotHistory({ action: "edit", type: bbox.type, page: targetPage });
      return;
    }
    const selectedSpans = selectSpansForBoundingBox(
      spansRef.current,
      bbox,
      bboxTextMatchesSpan,
      [],
      { preserveColumns: true },
    );
    let tightPoints = buildTightTextOutline(selectedSpans, 1);
    if (bbox.titleBBox) {
      // Title row + every body line, each contributing its own step to the
      // outline (buildTightOutlineFromLineRects never merges/discards rects
      // the way the old grid-based buildTightOutlineFromRects did — that
      // one silently kept only its single largest-area loop, which is why
      // resizing a titled bbox used to snap tight around just the title
      // plus the first line and drop every line after it).
      const ownerBorderPad = Math.max(0, (bbox.lineWidth ?? 0) / 2);
      const titleBorderPad = Math.max(0, (bbox.titleBBox.lineWidth ?? 0) / 2);
      // Padded out on every side so the owner's new border fully encloses
      // the title's OWN rendered border stroke — that padding must never
      // be trimmed away, or the title's border spills past the owner's
      // (every edge except the top, which nothing above it can encroach
      // on). If the first body line's rect reaches up into this padded
      // region instead, it's that line's own top that gives way — raised
      // to meet the title row's padded bottom exactly, which also keeps
      // the connecting edge between them horizontal instead of a diagonal
      // cut through the line's text.
      tightPoints = buildTightOutlineFromLineRects([
        expandRectBy(bbox.titleBBox, titleBorderPad + ownerBorderPad),
        ...buildTextLineRects(selectedSpans, 1),
      ]);
    }
    const tightBounds = pointsToBounds(tightPoints);
    if (!tightBounds || tightPoints.length < 4) return;
    setAnnotations((prev) => ({
      ...prev,
      [targetPage]: (prev[targetPage] || []).map((annotation) => (
        annotation.id === bbox.id
          ? {
              ...annotation,
              ...tightBounds,
              points: tightPoints,
              textAutoFitted: true,
              autoFitSourceGeometry: annotation.textAutoFitted && annotation.autoFitSourceGeometry
                ? annotation.autoFitSourceGeometry
                : {
                    x: annotation.x,
                    y: annotation.y,
                    w: annotation.w,
                    h: annotation.h,
                    closed: annotation.closed,
                    points: Array.isArray(annotation.points)
                      ? annotation.points.map((point) => ({ ...point }))
                      : null,
                  },
            }
          : annotation
      )),
    }));
    setRedoStacks((prev) => (prev[targetPage]?.length ? { ...prev, [targetPage]: [] } : prev));
    logAnnotHistory({ action: "edit", type: bbox.type, page: targetPage });
  }, [bboxTextMatchesSpan, logAnnotHistory, pageNum]);

  const deleteBBox = useCallback((bboxId, targetPage = pageNum) => {
    // Read from the closed-over annotations state directly, synchronously
    // — NOT from inside the setAnnotations updater below, whose body isn't
    // guaranteed to run before this function continues, which would make
    // markAnnotationCleared's type argument unreliable.
    const targetType = (annotations[targetPage] || []).find((ann) => ann.id === bboxId)?.type || "bbox";
    let nextAnnotations = null;
    setAnnotations((prev) => {
      const pageAnnotations = prev[targetPage] || [];
      const target = pageAnnotations.find((ann) => ann.id === bboxId) || null;
      const nextPageAnnotations = pageAnnotations.filter((ann) => (
        ann.id !== bboxId
        && !(ann.type === "bboxTitle" && (ann.ownerId === bboxId || ann.containerId === bboxId))
      ));
      nextAnnotations = {
        ...prev,
        [targetPage]: nextPageAnnotations.map((ann) => {
          if (target?.type === "bboxTitle" && ann.id === target.ownerId) return { ...ann, titleBBox: null };
          if (ann.parentId !== target?.id) return ann;
          if (target?.type === "columnBBox" && target.parentId) return { ...ann, parentId: target.parentId };
          const { parentId: _removedParentId, ...withoutParent } = ann;
          return withoutParent;
        }),
      };
      return nextAnnotations;
    });
    setRedoStacks((prev) => (prev[targetPage]?.length ? { ...prev, [targetPage]: [] } : prev));
    markAnnotationCleared(bboxId, targetPage, targetType);
    const sourceId = currentSourceIdRef.current;
    if (sourceId && nextAnnotations) {
      authFetch(apiUrl(`/api/source-annotations/${sourceId}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildAnnotationSavePayload({ activeAnnotations: nextAnnotations })),
      }).catch(() => {});
    }
  }, [annotations, annotHistory, pageNum, markAnnotationCleared]);

  const moveBBoxInGroup = useCallback((bboxId, direction, targetPage = pageNum) => {
    if (!direction || !bboxId) return;
    let nextAnnotations = null;
    setAnnotations((prev) => {
      const pageAnnotations = [...(prev[targetPage] || [])];
      const targetIndex = pageAnnotations.findIndex((ann) => ann.id === bboxId && EDITABLE_BBOX_TYPES.has(ann.type));
      if (targetIndex < 0) return prev;
      const target = pageAnnotations[targetIndex];
      const targetContainer = bboxTypeHas(target.type, "canBeNested")
        ? [...pageAnnotations].reverse().find((ann) => (
          bboxTypeHas(ann.type, "containsChildren")
          && target.x >= ann.x
          && target.y >= ann.y
          && target.x + target.w <= ann.x + ann.w
          && target.y + target.h <= ann.y + ann.h
        )) || null
        : null;
      const sameGroup = pageAnnotations
        .map((ann, index) => ({ ann, index }))
        .filter(({ ann }) => {
          if (bboxTypeHas(target.type, "containsChildren")) return bboxTypeHas(ann.type, "containsChildren");
          if (!bboxTypeHas(ann.type, "canBeNested")) return false;
          const annContainer = [...pageAnnotations].reverse().find((container) => (
            bboxTypeHas(container.type, "containsChildren")
            && ann.x >= container.x
            && ann.y >= container.y
            && ann.x + ann.w <= container.x + container.w
            && ann.y + ann.h <= container.y + container.h
          )) || null;
          return (annContainer?.id ?? null) === (targetContainer?.id ?? null);
        });
      const groupPos = sameGroup.findIndex(({ index }) => index === targetIndex);
      const swapPos = groupPos + direction;
      if (groupPos < 0 || swapPos < 0 || swapPos >= sameGroup.length) return prev;
      const aIndex = sameGroup[groupPos].index;
      const bIndex = sameGroup[swapPos].index;
      [pageAnnotations[aIndex], pageAnnotations[bIndex]] = [pageAnnotations[bIndex], pageAnnotations[aIndex]];
      nextAnnotations = { ...prev, [targetPage]: pageAnnotations };
      return nextAnnotations;
    });
    if (!nextAnnotations) return;
    setRedoStacks((prev) => (prev[targetPage]?.length ? { ...prev, [targetPage]: [] } : prev));
    logAnnotHistory({ action: "edit", type: "bbox", page: targetPage });
    const sourceId = currentSourceIdRef.current;
    if (sourceId) {
      authFetch(apiUrl(`/api/source-annotations/${sourceId}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildAnnotationSavePayload({ activeAnnotations: nextAnnotations })),
      }).catch(() => {});
    }
  }, [annotHistory, pageNum, logAnnotHistory]);

  const setBBoxTitleFromLine = useCallback((bboxId, lineText, targetPage = pageNum) => {
    const title = String(lineText || "").replace(/\s+/g, " ").trim();
    if (!bboxId || !title) return;
    const currentAnnotations = annotationsRef.current;
    const pageAnnotations = currentAnnotations[targetPage] || [];
    if (!pageAnnotations.some((annotation) => annotation.id === bboxId && annotation.type === "bbox")) return;
    const nextAnnotations = {
      ...currentAnnotations,
      [targetPage]: pageAnnotations.map((annotation) => (
        annotation.id === bboxId
          ? { ...annotation, title, titleSourceLine: title }
          : annotation
      )),
    };
    annotationsRef.current = nextAnnotations;
    setAnnotations(nextAnnotations);
    setRedoStacks((prev) => (prev[targetPage]?.length ? { ...prev, [targetPage]: [] } : prev));
    logAnnotHistory({ action: "edit", type: "bbox", page: targetPage });
    const sourceId = currentSourceIdRef.current;
    if (sourceId) {
      authFetch(apiUrl(`/api/source-annotations/${sourceId}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildAnnotationSavePayload({ activeAnnotations: nextAnnotations })),
      }).catch(() => {});
    }
  }, [buildAnnotationSavePayload, logAnnotHistory, pageNum]);

  const expandContainerToIncludeBBox = useCallback((pageAnnotations, containerId, bbox) => {
    if (!containerId || !bbox) return pageAnnotations;
    const containerIndex = pageAnnotations.findIndex((ann) => ann.id === containerId && bboxTypeHas(ann.type, "containsChildren"));
    if (containerIndex < 0) return pageAnnotations;
    const container = pageAnnotations[containerIndex];
    const nextContainer = {
      ...container,
      x: Math.min(container.x, bbox.x),
      y: Math.min(container.y, bbox.y),
      w: Math.max(container.x + container.w, bbox.x + bbox.w) - Math.min(container.x, bbox.x),
      h: Math.max(container.y + container.h, bbox.y + bbox.h) - Math.min(container.y, bbox.y),
    };
    const next = [...pageAnnotations];
    next[containerIndex] = nextContainer;
    return next;
  }, []);

  const expandAnnotationToIncludeRect = useCallback((annotation, rect) => {
    if (!annotation || !rect) return annotation;
    const currentBounds = {
      x: annotation.x ?? 0,
      y: annotation.y ?? 0,
      w: annotation.w ?? 0,
      h: annotation.h ?? 0,
    };
    const nextBounds = {
      x: Math.min(currentBounds.x, rect.x),
      y: Math.min(currentBounds.y, rect.y),
      w: Math.max(currentBounds.x + currentBounds.w, rect.x + rect.w) - Math.min(currentBounds.x, rect.x),
      h: Math.max(currentBounds.y + currentBounds.h, rect.y + rect.h) - Math.min(currentBounds.y, rect.y),
    };
    const changed = (
      nextBounds.x !== currentBounds.x
      || nextBounds.y !== currentBounds.y
      || nextBounds.w !== currentBounds.w
      || nextBounds.h !== currentBounds.h
    );
    if (!changed) return annotation;
    const nextAnnotation = {
      ...annotation,
      ...nextBounds,
    };
    if (Array.isArray(annotation.points) && annotation.points.length >= 2) {
      const currentRight = currentBounds.x + currentBounds.w;
      const currentBottom = currentBounds.y + currentBounds.h;
      const nextRight = nextBounds.x + nextBounds.w;
      const nextBottom = nextBounds.y + nextBounds.h;
      const pushLeft = Math.max(0, currentBounds.x - nextBounds.x);
      const pushRight = Math.max(0, nextRight - currentRight);
      const pushTop = Math.max(0, currentBounds.y - nextBounds.y);
      const pushBottom = Math.max(0, nextBottom - currentBottom);
      const rangePadX = Math.max(6, currentBounds.w * 0.08);
      const rangePadY = Math.max(6, currentBounds.h * 0.08);
      const sideDepthX = Math.max(14, currentBounds.w * 0.18);
      const sideDepthY = Math.max(14, currentBounds.h * 0.18);
      const clamp01 = (value) => Math.max(0, Math.min(1, value));
      const smoothstep = (value) => {
        const t = clamp01(value);
        return t * t * (3 - 2 * t);
      };
      const rangeInfluence = (value, start, end, pad) => {
        if (value >= start && value <= end) return 1;
        if (value < start) return smoothstep(1 - ((start - value) / Math.max(1, pad)));
        return smoothstep(1 - ((value - end) / Math.max(1, pad)));
      };
      const movePointSet = annotation.points.map((point) => ({ ...point }));
      const rectLeft = rect.x;
      const rectRight = rect.x + rect.w;
      const rectTop = rect.y;
      const rectBottom = rect.y + rect.h;
      const centerY = (rectTop + rectBottom) / 2;
      const centerX = (rectLeft + rectRight) / 2;
      const applyDirectionalPush = (predicate, applyDelta, fallbackSelector) => {
        let affected = 0;
        movePointSet.forEach((point, index) => {
          const weight = predicate(point);
          if (weight <= 0) return;
          affected += 1;
          applyDelta(point, weight, index);
        });
        if (affected > 0 || !fallbackSelector) return;
        const nearestIndex = movePointSet.reduce((bestIndex, point, index) => (
          fallbackSelector(point) < fallbackSelector(movePointSet[bestIndex]) ? index : bestIndex
        ), 0);
        applyDelta(movePointSet[nearestIndex], 1, nearestIndex);
      };

      if (pushLeft > 0) {
        applyDirectionalPush(
          (point) => {
            const sideWeight = smoothstep(1 - ((point.x - currentBounds.x) / sideDepthX));
            const rangeWeight = rangeInfluence(point.y, rectTop, rectBottom, rangePadY);
            return sideWeight * rangeWeight;
          },
          (point, weight) => { point.x -= pushLeft * weight; },
          (point) => Math.abs(point.x - currentBounds.x) + Math.abs(point.y - centerY),
        );
      }
      if (pushRight > 0) {
        applyDirectionalPush(
          (point) => {
            const sideWeight = smoothstep(1 - ((currentRight - point.x) / sideDepthX));
            const rangeWeight = rangeInfluence(point.y, rectTop, rectBottom, rangePadY);
            return sideWeight * rangeWeight;
          },
          (point, weight) => { point.x += pushRight * weight; },
          (point) => Math.abs(point.x - currentRight) + Math.abs(point.y - centerY),
        );
      }
      if (pushTop > 0) {
        applyDirectionalPush(
          (point) => {
            const sideWeight = smoothstep(1 - ((point.y - currentBounds.y) / sideDepthY));
            const rangeWeight = rangeInfluence(point.x, rectLeft, rectRight, rangePadX);
            return sideWeight * rangeWeight;
          },
          (point, weight) => { point.y -= pushTop * weight; },
          (point) => Math.abs(point.y - currentBounds.y) + Math.abs(point.x - centerX),
        );
      }
      if (pushBottom > 0) {
        applyDirectionalPush(
          (point) => {
            const sideWeight = smoothstep(1 - ((currentBottom - point.y) / sideDepthY));
            const rangeWeight = rangeInfluence(point.x, rectLeft, rectRight, rangePadX);
            return sideWeight * rangeWeight;
          },
          (point, weight) => { point.y += pushBottom * weight; },
          (point) => Math.abs(point.y - currentBottom) + Math.abs(point.x - centerX),
        );
      }
      let movedBounds = pointsToBounds(movePointSet);
      const residualBottom = Math.max(0, nextBottom - ((movedBounds?.y ?? 0) + (movedBounds?.h ?? 0)));
      if (residualBottom > 0.01) {
        applyDirectionalPush(
          (point) => {
            const sideWeight = smoothstep(1 - ((currentBottom - point.y) / sideDepthY));
            const rangeWeight = rangeInfluence(point.x, rectLeft, rectRight, rangePadX);
            return Math.max(sideWeight * rangeWeight, sideWeight * 0.6);
          },
          (point, weight) => { point.y += residualBottom * weight; },
          (point) => Math.abs(point.y - currentBottom) + Math.abs(point.x - centerX),
        );
        movedBounds = pointsToBounds(movePointSet);
      }
      nextAnnotation.points = movePointSet;
      nextAnnotation.x = Math.min(nextBounds.x, movedBounds?.x ?? nextBounds.x);
      nextAnnotation.y = Math.min(nextBounds.y, movedBounds?.y ?? nextBounds.y);
      nextAnnotation.w = Math.max(nextRight, (movedBounds?.x ?? nextAnnotation.x) + (movedBounds?.w ?? 0)) - nextAnnotation.x;
      nextAnnotation.h = Math.max(nextBottom, (movedBounds?.y ?? nextAnnotation.y) + (movedBounds?.h ?? 0)) - nextAnnotation.y;
    }
    return nextAnnotation;
  }, []);

  const rehydrateBBoxTitleLayers = useCallback((layers) => {
    const removedBBoxTypes = new Set(["bboxContainer", "chapterBBox", "bulletBBox"]);
    const nextLayers = {};
    for (const [pageKey, pageAnnotations] of Object.entries(layers || {})) {
      // Title BBoxes are real persisted page annotations. Removing them here
      // made their border disappear on every reload and also discarded the
      // owner's geometry link.
      const restored = (pageAnnotations || [])
        .filter((ann) => !removedBBoxTypes.has(ann?.type) && ann?.type !== "bboxTitle")
        .map((ann) => {
        const { titleBBox: _discardedTitleBBox, ...withoutTitleBBox } = ann || {};
        const migrated = { ...withoutTitleBBox };
        if (bboxTypeHas(migrated.type, "extractsText")) {
          migrated.rawPdfText = migrated.rawPdfText ?? migrated.text ?? "";
          migrated.text = migrated.text ?? migrated.rawPdfText;
          migrated.textCorrection = migrated.textCorrection || {
            source: migrated.smartSegmented ? "ocr_alignment" : "pdf_text_layer",
            confidence: 1,
            warnings: [],
            correctionVersion: BBOX_TEXT_CORRECTION_VERSION,
          };
        }
        return migrated;
      });
      const restoredIds = new Set(restored.map((ann) => ann?.id));
      restored.forEach((ann) => {
        if (ann.parentId && !restoredIds.has(ann.parentId)) delete ann.parentId;
      });
      nextLayers[pageKey] = normalizePagePartitionHierarchy(restored);
    }
    return nextLayers;
  }, []);

  const normalizeStoredAnnotationLayers = useCallback((storedLayers, storedActiveLayerId = null) => {
    if (Array.isArray(storedLayers) && storedLayers.length) {
      const normalized = storedLayers.map((layer, index) => ({
        id: layer?.id || `annot-layer-${index + 1}`,
        name: String(layer?.name || `Layer ${index + 1}`),
        visible: layer?.visible !== false,
        annotations: rehydrateBBoxTitleLayers(withoutTemporarySmartPenStrokes(layer?.annotations || {})),
      }));
      const activeId = normalized.some((layer) => layer.id === storedActiveLayerId)
        ? storedActiveLayerId
        : normalized[0].id;
      return { layers: normalized, activeId };
    }
    return {
      layers: [createAnnotationLayer(1, rehydrateBBoxTitleLayers(withoutTemporarySmartPenStrokes(storedLayers || {})))],
      activeId: null,
    };
  }, [createAnnotationLayer, rehydrateBBoxTitleLayers]);

  const stripTitleFromBBoxText = useCallback((text, title) => stripTitleFromBBoxTextValue(text, title), []);

  const nextDistinctBBoxColor = useCallback((pageAnnotations) => {
    const used = new Set(
      (pageAnnotations || [])
        .filter((ann) => ann && EDITABLE_BBOX_TYPES.has(ann.type))
        .map((ann) => String(ann.color || "").toLowerCase())
        .filter(Boolean)
    );
    const unused = BBOX_DISTINCT_COLORS.find((color) => !used.has(color.toLowerCase()));
    if (unused) return unused;
    const bboxCount = (pageAnnotations || []).filter((ann) => ann && EDITABLE_BBOX_TYPES.has(ann.type)).length;
    return BBOX_DISTINCT_COLORS[bboxCount % BBOX_DISTINCT_COLORS.length];
  }, []);

  const findContainingTitleOwner = useCallback((pageAnnotations, rect, anchorPoint = null) => {
    if (!rect) return null;
    const rectRight = rect.x + rect.w;
    const rectBottom = rect.y + rect.h;
    const candidates = [...(pageAnnotations || [])]
      .filter((ann) => ann && EDITABLE_BBOX_TYPES.has(ann.type))
      .map((ann) => {
        const annRight = ann.x + ann.w;
        const annBottom = ann.y + ann.h;
        const anchorInside = !!anchorPoint && (
          anchorPoint.x >= ann.x
          && anchorPoint.y >= ann.y
          && anchorPoint.x <= annRight
          && anchorPoint.y <= annBottom
        );
        const contained = (
          rect.x >= ann.x
          && rect.y >= ann.y
          && rectRight <= annRight
          && rectBottom <= annBottom
        );
        const overlapW = Math.max(0, Math.min(rectRight, annRight) - Math.max(rect.x, ann.x));
        const overlapH = Math.max(0, Math.min(rectBottom, annBottom) - Math.max(rect.y, ann.y));
        const overlapArea = overlapW * overlapH;
        return { ann, contained, overlapArea, anchorInside };
      })
      .filter(({ contained, overlapArea }) => contained || overlapArea > 0)
      .sort((a, b) => {
        if (a.anchorInside !== b.anchorInside) return a.anchorInside ? -1 : 1;
        if (a.contained !== b.contained) return a.contained ? -1 : 1;
        if (a.ann.type !== b.ann.type) return bboxTypeHas(a.ann.type, "canBeNested") ? -1 : 1;
        if (a.contained) return (a.ann.w * a.ann.h) - (b.ann.w * b.ann.h);
        if (a.overlapArea !== b.overlapArea) return b.overlapArea - a.overlapArea;
        return (a.ann.w * a.ann.h) - (b.ann.w * b.ann.h);
      });
    return candidates[0]?.ann || null;
  }, []);

  const findContainingBBoxContainer = useCallback((pageAnnotations, rect) => {
    if (!rect) return null;
    return [...(pageAnnotations || [])]
      .filter((ann) => ann && bboxTypeHas(ann.type, "containsChildren"))
      .filter((container) => (
        rect.x >= container.x
        && rect.y >= container.y
        && rect.x + rect.w <= container.x + container.w
        && rect.y + rect.h <= container.y + container.h
      ))
      .sort((a, b) => (a.w * a.h) - (b.w * b.h))[0] || null;
  }, []);

  const armBBoxInsideContainer = useCallback((containerId, targetPage) => {
    if (!containerId) return;
    const nextPage = Math.min(Math.max(1, Number(targetPage) || pageNum), pageCount || Math.max(1, Number(targetPage) || pageNum));
    const isSameTarget = bboxContainerBBoxTarget?.containerId === containerId && bboxContainerBBoxTarget?.pageNum === nextPage;
    setAnnotTool("bbox");
    if (isSameTarget) {
      setActiveBBoxCreationType(null);
      setBBoxContainerBBoxTarget(null);
      return;
    }
    setPageNum(nextPage);
    setActiveBBoxCreationType("bbox");
    setBBoxContainerBBoxTarget({ containerId, pageNum: nextPage });
  }, [bboxContainerBBoxTarget, pageCount, pageNum]);

  const extractTextForRectSelection = useCallback((selectionRect) => {
    if (!selectionRect) return "";
    return extractBoundingBoxTextParts(spansRef.current, selectionRect, bboxTextMatchesSpan).text;
  }, []);

  // Per-page refs for continuous scroll
  const pageCanvasRefs    = useRef([]);
  const pageContainerRefs = useRef([]);
  const renderTasksRef    = useRef([]);
  const pageViewportsRef  = useRef([]);
  const renderedScaleRef  = useRef([]); // scale each page's canvas was last rendered at — lets us skip already-current pages
  const renderedCssSizeRef = useRef([]); // last displayed CSS size per page, separate from the HiDPI backing buffer size
  // How many backing-buffer pixels the CURRENT page's canvas gets per CSS
  // pixel — i.e. (page canvas.width / displayViewport.width), already
  // folding in both devicePixelRatio AND the MAX_RENDER_CANVAS_* safety cap
  // (see renderPage below). The annotation canvas mirrors this exact ratio
  // instead of re-deriving its own, so it can never end up sharper/blurrier
  // than the page underneath it, or exceed the same browser canvas-size
  // ceiling the page canvas is already careful to respect.
  const currentBackingScaleRef = useRef(1);
  const pageNumRef        = useRef(1);
  pageNumRef.current      = pageNum;  // sync during render

  // Proxy ref: always points to current page's PDF canvas
  const canvasRef = { get current() { return pageCanvasRefs.current[pageNumRef.current - 1] ?? null; } };

  const textLayerRef  = useRef(null);
  const [textLayerRenderTick, setTextLayerRenderTick] = useState(0); // bumps after the text layer finishes rebuilding so dependent overlays can repaint against the new spans
  // Markdown analyser text panes keep their existing long-press behavior.
  // The visual MD page uses the PDF-style custom double-touch selector below
  // and must never attach the native long-press selector.
  const mdTextRef        = useRef(null);
  useLongPressSelect(mdTextRef);

  useEffect(() => {
    const page = markdownVisualLayerRef.current;
    const canvas = markdownAnnotationCanvasRef.current;
    if (!page || !canvas || !markdownVisualActive || !pageViewport) return undefined;
    const rect = page.getBoundingClientRect();
    const backingScale = window.devicePixelRatio || 1;
    const context = prepareOverlayCanvas(canvas, rect.width, rect.height, backingScale);
    if (!context) return undefined;
    const scaleX = rect.width / Math.max(1, pageViewport.width);
    const scaleY = rect.height / Math.max(1, pageViewport.height);
    const scale = pageViewport.scale * Math.min(scaleX, scaleY);
    (markdownAnnotations[pageNum] || []).forEach((annotation) => drawAnnotationWithOwnerClip(context, annotation, scale, markdownAnnotations[pageNum] || []));
    return undefined;
  }, [drawAnnotationWithOwnerClip, markdownAnnotations, markdownVisualActive, pageNum, pageViewport]);

  // Independent Markdown annotation surface. These strokes use the same
  // page coordinate system and drawing renderer as PDF annotations, but are
  // stored only in markdownLayers and never enter the PDF layer state.
  useEffect(() => {
    const page = markdownVisualLayerRef.current;
    const canvas = markdownAnnotationCanvasRef.current;
    if (!page || !canvas || !markdownVisualActive || !pageViewport || !isPenToolKey(annotTool)) return undefined;
    let active = null;
    let drawFrame = 0;
    let pendingExtra = null;
    const getSurface = () => {
      const rect = page.getBoundingClientRect();
      const scale = pageViewport.scale * (rect.width / Math.max(1, pageViewport.width));
      return { rect, scale };
    };
    const paintSurface = (extra = null) => {
      const { rect, scale } = getSurface();
      const backingScale = window.devicePixelRatio || 1;
      const context = prepareOverlayCanvas(canvas, rect.width, rect.height, backingScale);
      if (!context) return;
      const ownAnnotations = markdownAnnotations[pageNum] || [];
      ownAnnotations.forEach((annotation) => drawAnnotationWithOwnerClip(context, annotation, scale, ownAnnotations));
      if (extra) drawAnnotationWithOwnerClip(context, extra, scale, ownAnnotations);
    };
    const drawSurface = (extra = null) => {
      pendingExtra = extra;
      if (drawFrame) return;
      drawFrame = requestAnimationFrame(() => {
        drawFrame = 0;
        paintSurface(pendingExtra);
      });
    };
    const pointFromEvent = (event) => {
      const { rect, scale } = getSurface();
      return {
        x: (event.clientX - rect.left) / scale,
        y: (event.clientY - rect.top) / scale,
        t: performance.now(),
        pressure: Number.isFinite(event.pressure) && event.pressure > 0 ? event.pressure : 0.5,
      };
    };
    const onDown = (event) => {
      if (event.pointerType !== "pen") return;
      event.preventDefault();
      event.stopPropagation();
      const point = pointFromEvent(event);
      active = {
        id: `${Date.now()}_md`,
        type: "pen",
        smartPen: annotTool === "smartPen",
        color: annotColor,
        lineWidth: penSize,
        penType,
        points: [point],
      };
      drawSurface(active);
    };
    const onMove = (event) => {
      if (event.pointerType !== "pen" || !active) return;
      event.preventDefault();
      event.stopPropagation();
      const point = pointFromEvent(event);
      const nextPoint = smoothStrokePoint(active.points, point, penStabilization, getSurface().scale);
      if (!nextPoint) return;
      active.points.push(nextPoint);
      drawSurface(active);
    };
    const onUp = (event) => {
      if (event.pointerType !== "pen" || !active) return;
      event.preventDefault();
      event.stopPropagation();
      const finished = active;
      active = null;
      if (finished.points.length < 2 || polylineLength(finished.points) < 1) {
        drawSurface();
        return;
      }
      const nextLayers = {
        ...markdownAnnotations,
        [pageNum]: [...(markdownAnnotations[pageNum] || []), finished],
      };
      commitMarkdownAnnotations(nextLayers);
      drawSurface();
    };
    page.addEventListener("pointerdown", onDown, { passive: false });
    page.addEventListener("pointermove", onMove, { passive: false });
    page.addEventListener("pointerup", onUp, { passive: false });
    page.addEventListener("pointercancel", onUp, { passive: false });
    return () => {
      if (drawFrame) cancelAnimationFrame(drawFrame);
      page.removeEventListener("pointerdown", onDown);
      page.removeEventListener("pointermove", onMove);
      page.removeEventListener("pointerup", onUp);
      page.removeEventListener("pointercancel", onUp);
    };
  }, [annotColor, annotTool, commitMarkdownAnnotations, drawAnnotationWithOwnerClip, markdownAnnotations, markdownVisualActive, pageNum, pageViewport, penSize, penStabilization, penType]);

  useEffect(() => {
    const mdTools = new Set(["highlight", "underline", "strikethrough", "rect", "circle", "line", "arrow", "freeshape", "bbox", "pageBBox", "columnBBox", "subLineBBox", "imageBBox", "eraser"]);
    const page = markdownVisualLayerRef.current;
    const canvas = markdownAnnotationCanvasRef.current;
    if (!page || !canvas || !markdownVisualActive || !pageViewport || !mdTools.has(annotTool)) return undefined;
    let active = null;
    let drawFrame = 0;
    let pendingDraw = { extra: null, layers: markdownAnnotations };
    const getSurface = () => {
      const rect = page.getBoundingClientRect();
      return { rect, scale: pageViewport.scale * (rect.width / Math.max(1, pageViewport.width)) };
    };
    const paintSurface = (extra = null, layers = markdownAnnotations) => {
      const { rect, scale } = getSurface();
      const backingScale = window.devicePixelRatio || 1;
      const context = prepareOverlayCanvas(canvas, rect.width, rect.height, backingScale);
      if (!context) return;
      (layers[pageNum] || []).forEach((annotation) => drawAnnotationWithOwnerClip(context, annotation, scale, layers[pageNum] || []));
      if (extra) drawAnnotationWithOwnerClip(context, extra, scale, layers[pageNum] || []);
    };
    const drawSurface = (extra = null, layers = markdownAnnotations) => {
      pendingDraw = { extra, layers };
      if (drawFrame) return;
      drawFrame = requestAnimationFrame(() => {
        drawFrame = 0;
        paintSurface(pendingDraw.extra, pendingDraw.layers);
      });
    };
    const pointFromEvent = (event) => {
      const { rect, scale } = getSurface();
      return { x: (event.clientX - rect.left) / scale, y: (event.clientY - rect.top) / scale };
    };
    const onDown = (event) => {
      if (event.pointerType !== "pen") return;
      event.preventDefault();
      event.stopPropagation();
      const point = pointFromEvent(event);
      if (annotTool === "eraser") {
        active = { type: "eraser", changed: false, lastKept: markdownAnnotations[pageNum] || [], lastErasePoint: null };
        const result = eraseAnnotationsAtPoint(active.lastKept, point.x, point.y, eraserSize / getSurface().scale, eraserMode);
        active.lastKept = result.kept;
        active.changed = result.changed;
        drawSurface(null, { ...markdownAnnotations, [pageNum]: active.lastKept });
        return;
      }
      const type = ["bbox", "pageBBox", "columnBBox", "subLineBBox", "imageBBox"].includes(annotTool) ? "rect" : annotTool;
      active = type === "line" || type === "arrow"
        ? { type, color: annotColor, lineWidth: shapeStrokeWidth / getSurface().scale, x1: point.x, y1: point.y, x2: point.x, y2: point.y }
        : ["rect", "circle"].includes(type)
          ? { type, color: annotColor, lineWidth: shapeStrokeWidth / getSurface().scale, x: point.x, y: point.y, w: 0, h: 0, shapeBackground: false }
          : ["highlight", "underline", "strikethrough"].includes(type)
            ? { type, color: annotColor, lineWidth: annotSize / getSurface().scale, points: [point, point], opacity: annotOpacity / 100 }
            : { type: "freeshape", color: annotColor, lineWidth: shapeStrokeWidth / getSurface().scale, points: [point], shapeBackground: false };
      drawSurface(active);
    };
    const onMove = (event) => {
      if (event.pointerType !== "pen" || !active) return;
      event.preventDefault();
      event.stopPropagation();
      const point = pointFromEvent(event);
      if (active.type === "eraser") {
        const result = eraseAnnotationsAtPoint(active.lastKept, point.x, point.y, eraserSize / getSurface().scale, eraserMode);
        active.lastKept = result.kept;
        active.changed = active.changed || result.changed;
      } else if (active.type === "line" || active.type === "arrow") {
        active.x2 = point.x; active.y2 = point.y;
      } else if (["rect", "circle"].includes(active.type)) {
        active.w = point.x - active.x; active.h = point.y - active.y;
      } else if (["highlight", "underline", "strikethrough"].includes(active.type)) {
        active.points[1] = point;
      } else {
        const nextPoint = smoothStrokePoint(active.points, { ...point, t: performance.now(), pressure: 0.5 }, penStabilization, getSurface().scale);
        if (nextPoint) active.points.push(nextPoint);
      }
      drawSurface(active.type === "eraser" ? null : active, active.type === "eraser" ? { ...markdownAnnotations, [pageNum]: active.lastKept } : markdownAnnotations);
    };
    const onUp = (event) => {
      if (event.pointerType !== "pen" || !active) return;
      event.preventDefault();
      event.stopPropagation();
      const finished = active;
      active = null;
      if (finished.type === "eraser") {
        if (finished.changed) {
          const nextLayers = { ...markdownAnnotations, [pageNum]: finished.lastKept };
          commitMarkdownAnnotations(nextLayers);
        }
        drawSurface();
        return;
      }
      const nextLayers = { ...markdownAnnotations, [pageNum]: [...(markdownAnnotations[pageNum] || []), { ...finished, id: `${Date.now()}_md` }] };
      commitMarkdownAnnotations(nextLayers);
      drawSurface(null, nextLayers);
    };
    page.addEventListener("pointerdown", onDown, { passive: false });
    page.addEventListener("pointermove", onMove, { passive: false });
    page.addEventListener("pointerup", onUp, { passive: false });
    page.addEventListener("pointercancel", onUp, { passive: false });
    return () => {
      if (drawFrame) cancelAnimationFrame(drawFrame);
      page.removeEventListener("pointerdown", onDown);
      page.removeEventListener("pointermove", onMove);
      page.removeEventListener("pointerup", onUp);
      page.removeEventListener("pointercancel", onUp);
    };
  }, [annotColor, annotOpacity, annotSize, annotTool, commitMarkdownAnnotations, drawAnnotationWithOwnerClip, eraserMode, eraserSize, markdownAnnotations, markdownVisualActive, pageNum, pageViewport, penStabilization, shapeStrokeWidth]);

  useEffect(() => {
    const surface = notebookDrawingSurfaceRef.current;
    const canvas = notebookDrawingCanvasRef.current;
    if (!surface || !canvas || !notebookMode || notebookActiveTab !== "drawing") return undefined;
    const supportedTools = new Set([
      "pen", "smartPen", "highlight", "underline", "strikethrough", "line", "arrow",
      "rect", "circle", "freeshape", "bbox", "eraser", "text",
    ]);
    let active = null;
    let drawFrame = 0;
    let pendingDraw = { extra: null, annotations: notebookAnnotations };

    const getSurface = () => {
      const rect = surface.getBoundingClientRect();
      const view = notebookDrawingViewRef.current;
      return {
        rect,
        view,
        baseScale: rect.width / NOTEBOOK_DRAWING_WIDTH,
        scale: (rect.width / NOTEBOOK_DRAWING_WIDTH) * view.scale,
      };
    };
    const paintSurface = (extra = null, annotationsToDraw = notebookAnnotations) => {
      const { rect, scale, view } = getSurface();
      const backingScale = window.devicePixelRatio || 1;
      const context = prepareOverlayCanvas(canvas, rect.width, rect.height, backingScale);
      if (!context) return;
      const gridSize = 24 * view.scale;
      surface.style.backgroundSize = `${gridSize}px ${gridSize}px`;
      surface.style.backgroundPosition = `${view.x}px ${view.y}px`;
      context.translate(view.x, view.y);
      annotationsToDraw.forEach((annotation) => drawAnnotationWithOwnerClip(context, annotation, scale, annotationsToDraw));
      if (extra) drawAnnotationWithOwnerClip(context, extra, scale, annotationsToDraw);
    };
    const drawSurface = (extra = null, annotationsToDraw = notebookAnnotations) => {
      pendingDraw = { extra, annotations: annotationsToDraw };
      if (drawFrame) return;
      drawFrame = requestAnimationFrame(() => {
        drawFrame = 0;
        paintSurface(pendingDraw.extra, pendingDraw.annotations);
      });
    };
    const pointFromEvent = (event) => {
      const { rect, scale, view } = getSurface();
      return {
        x: (event.clientX - rect.left - view.x) / scale,
        y: (event.clientY - rect.top - view.y) / scale,
        t: performance.now(),
        pressure: Number.isFinite(event.pressure) && event.pressure > 0 ? event.pressure : 0.5,
      };
    };
    const finishWithError = () => {
      active = null;
      drawSurface();
    };
    const onDown = (event) => {
      if (event.pointerType !== "pen" || !supportedTools.has(annotTool)) return;
      event.preventDefault();
      event.stopPropagation();
      canvas.setPointerCapture?.(event.pointerId);
      const point = pointFromEvent(event);
      const { scale } = getSurface();
      if (annotTool === "text") {
        const { rect } = getSurface();
        setNotebookDrawingTextInput({
          x: point.x,
          y: point.y,
          viewX: event.clientX - rect.left,
          viewY: event.clientY - rect.top,
          value: "",
        });
        return;
      }
      if (annotTool === "eraser") {
        const result = eraseAnnotationsAtPoint(notebookAnnotations, point.x, point.y, eraserSize / scale, eraserMode);
        active = { type: "eraser", changed: result.changed, lastKept: result.kept };
        drawSurface(null, result.kept);
        return;
      }
      if (isPenToolKey(annotTool)) {
        active = {
          type: "pen",
          smartPen: annotTool === "smartPen",
          color: annotColor,
          lineWidth: penSize / scale,
          penType,
          penSettings: {
            dynamic: true,
            stabilization: penStabilization,
            pressureAssist: penPressureAssist,
            taper: penTaper,
            flow: penFlow,
            border: true,
            nibAngle: penNibAngle,
            nibSpread: penNibSpread,
          },
          points: [point],
        };
      } else if (annotTool === "line" || annotTool === "arrow") {
        active = { type: annotTool, color: annotColor, lineWidth: shapeStrokeWidth / scale, x1: point.x, y1: point.y, x2: point.x, y2: point.y };
      } else if (["rect", "circle", "bbox"].includes(annotTool)) {
        active = { type: annotTool, color: annotColor, lineWidth: shapeStrokeWidth / scale, x: point.x, y: point.y, w: 0, h: 0, shapeBackground: false };
      } else if (["highlight", "underline", "strikethrough"].includes(annotTool)) {
        active = { type: annotTool, color: annotColor, lineWidth: annotSize / scale, points: [point, point], opacity: annotOpacity / 100 };
      } else {
        active = { type: "freeshape", color: annotColor, lineWidth: shapeStrokeWidth / scale, points: [point], shapeBackground: false };
      }
      drawSurface(active);
    };
    const onMove = (event) => {
      if (event.pointerType !== "pen" || !active) return;
      event.preventDefault();
      event.stopPropagation();
      const point = pointFromEvent(event);
      const { scale } = getSurface();
      if (active.type === "eraser") {
        const result = eraseAnnotationsAtPoint(active.lastKept, point.x, point.y, eraserSize / scale, eraserMode);
        active.lastKept = result.kept;
        active.changed = active.changed || result.changed;
        drawSurface(null, active.lastKept);
      } else if (active.type === "line" || active.type === "arrow") {
        active.x2 = point.x;
        active.y2 = point.y;
        drawSurface(active);
      } else if (["rect", "circle", "bbox"].includes(active.type)) {
        active.w = point.x - active.x;
        active.h = point.y - active.y;
        drawSurface(active);
      } else if (["highlight", "underline", "strikethrough"].includes(active.type)) {
        active.points[1] = point;
        drawSurface(active);
      } else {
        const nextPoint = smoothStrokePoint(active.points, point, penStabilization, scale);
        if (nextPoint) active.points.push(nextPoint);
        drawSurface(active);
      }
    };
    const onUp = (event) => {
      if (event.pointerType !== "pen" || !active) return;
      event.preventDefault();
      event.stopPropagation();
      const finished = active;
      active = null;
      if (finished.type === "eraser") {
        if (!finished.changed) return drawSurface();
        setNotebookUndoStack((previous) => [...previous, notebookAnnotations]);
        setNotebookAnnotations(finished.lastKept);
        setNotebookRedoStack([]);
        saveNotebookAnnotations(finished.lastKept);
        return drawSurface(null, finished.lastKept);
      }
      if (finished.type === "pen") {
        finished.points = finalizePenStroke(
          finished.points,
          finished.penSettings ?? DEFAULT_PEN_SETTINGS,
          finished.penType ?? penType,
          getSurface().scale
        );
      }
      if (finished.points?.length === 1) return finishWithError();
      const nextAnnotations = [...notebookAnnotations, { ...finished, id: `${Date.now()}_nb` }];
      setNotebookUndoStack((previous) => [...previous, notebookAnnotations]);
      setNotebookAnnotations(nextAnnotations);
      setNotebookRedoStack([]);
      saveNotebookAnnotations(nextAnnotations);
      drawSurface(null, nextAnnotations);
    };

    notebookDrawingPaintRef.current = () => drawSurface(active, active?.type === "eraser" ? active.lastKept : notebookAnnotations);
    drawSurface();
    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => drawSurface()) : null;
    resizeObserver?.observe(surface);
    canvas.addEventListener("pointerdown", onDown, { passive: false });
    canvas.addEventListener("pointermove", onMove, { passive: false });
    canvas.addEventListener("pointerup", onUp, { passive: false });
    canvas.addEventListener("pointercancel", onUp, { passive: false });
    return () => {
      notebookDrawingPaintRef.current = () => {};
      if (drawFrame) cancelAnimationFrame(drawFrame);
      resizeObserver?.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
    };
  }, [annotColor, annotOpacity, annotSize, annotTool, drawAnnotationWithOwnerClip, eraserMode, eraserSize, notebookActiveTab, notebookAnnotations, notebookMode, penFlow, penNibAngle, penNibSpread, penPressureAssist, penSize, penStabilization, penTaper, penType, saveNotebookAnnotations, shapeStrokeWidth]);

  // Freeform Drawing owns its viewport. Finger/mouse input navigates it while
  // pen input remains exclusively reserved for annotation tools.
  useEffect(() => {
    const surface = notebookDrawingSurfaceRef.current;
    if (!surface || !notebookMode || notebookActiveTab !== "drawing") return undefined;
    const pointers = new Map();
    let gesture = null;
    let paintFrame = 0;
    let zoomPublishFrame = 0;
    let wheelCommitTimer = null;

    const schedulePaint = () => {
      if (paintFrame) return;
      paintFrame = requestAnimationFrame(() => {
        paintFrame = 0;
        notebookDrawingPaintRef.current();
      });
    };
    const publishZoomOnFrame = () => {
      if (zoomPublishFrame) return;
      zoomPublishFrame = requestAnimationFrame(() => {
        zoomPublishFrame = 0;
        publishNotebookDrawingZoom(notebookDrawingViewRef.current.scale);
      });
    };
    const point = (event) => {
      const rect = surface.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const beginGesture = () => {
      const values = [...pointers.values()];
      const view = notebookDrawingViewRef.current;
      if (values.length >= 2) {
        const a = values[0];
        const b = values[1];
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        const rect = surface.getBoundingClientRect();
        const baseScale = rect.width / NOTEBOOK_DRAWING_WIDTH;
        gesture = {
          type: "pinch",
          distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
          scale: view.scale,
          worldX: (midX - view.x) / (baseScale * view.scale),
          worldY: (midY - view.y) / (baseScale * view.scale),
        };
      } else if (values.length === 1) {
        gesture = { type: "pan", start: values[0], x: view.x, y: view.y };
      }
    };
    const onPointerDown = (event) => {
      if (event.pointerType === "pen") return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.preventDefault();
      pointers.set(event.pointerId, point(event));
      surface.setPointerCapture?.(event.pointerId);
      beginGesture();
    };
    const onPointerMove = (event) => {
      if (!pointers.has(event.pointerId)) return;
      event.preventDefault();
      pointers.set(event.pointerId, point(event));
      const values = [...pointers.values()];
      const view = notebookDrawingViewRef.current;
      if (values.length >= 2 && gesture?.type === "pinch") {
        const a = values[0];
        const b = values[1];
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
        const nextScale = normalizeZoom(gesture.scale * (distance / gesture.distance));
        const baseScale = surface.getBoundingClientRect().width / NOTEBOOK_DRAWING_WIDTH;
        view.scale = nextScale;
        view.x = midX - gesture.worldX * baseScale * nextScale;
        view.y = midY - gesture.worldY * baseScale * nextScale;
        publishZoomOnFrame();
      } else if (values.length === 1 && gesture?.type === "pan") {
        view.x = gesture.x + values[0].x - gesture.start.x;
        view.y = gesture.y + values[0].y - gesture.start.y;
      } else {
        beginGesture();
      }
      schedulePaint();
    };
    const onPointerEnd = (event) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.delete(event.pointerId);
      surface.releasePointerCapture?.(event.pointerId);
      beginGesture();
    };
    const onWheel = (event) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const view = notebookDrawingViewRef.current;
        const factor = Math.exp(-event.deltaY * 0.0025);
        zoomNotebookDrawingAt(view.scale * factor, event.clientX, event.clientY);
        if (wheelCommitTimer) clearTimeout(wheelCommitTimer);
        wheelCommitTimer = setTimeout(() => {
          wheelCommitTimer = null;
          publishNotebookDrawingZoom(notebookDrawingViewRef.current.scale);
        }, 120);
        return;
      }
      const view = notebookDrawingViewRef.current;
      view.x -= event.deltaX;
      view.y -= event.deltaY;
      schedulePaint();
    };

    surface.addEventListener("pointerdown", onPointerDown, { passive: false });
    surface.addEventListener("pointermove", onPointerMove, { passive: false });
    surface.addEventListener("pointerup", onPointerEnd, { passive: false });
    surface.addEventListener("pointercancel", onPointerEnd, { passive: false });
    surface.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      if (paintFrame) cancelAnimationFrame(paintFrame);
      if (zoomPublishFrame) cancelAnimationFrame(zoomPublishFrame);
      if (wheelCommitTimer) clearTimeout(wheelCommitTimer);
      surface.removeEventListener("pointerdown", onPointerDown);
      surface.removeEventListener("pointermove", onPointerMove);
      surface.removeEventListener("pointerup", onPointerEnd);
      surface.removeEventListener("pointercancel", onPointerEnd);
      surface.removeEventListener("wheel", onWheel);
    };
  }, [notebookActiveTab, notebookMode, publishNotebookDrawingZoom, zoomNotebookDrawingAt]);

  const commitNotebookDrawingText = useCallback(() => {
    const input = notebookDrawingTextInput;
    const value = String(input?.value || "").trim();
    if (!input || !value) {
      setNotebookDrawingTextInput(null);
      return;
    }
    const surfaceWidth = notebookDrawingSurfaceRef.current?.getBoundingClientRect?.().width || NOTEBOOK_DRAWING_WIDTH;
    const scale = surfaceWidth / NOTEBOOK_DRAWING_WIDTH;
    const nextAnnotations = [...notebookAnnotations, {
      id: `${Date.now()}_nb`,
      type: "text",
      color: textToolColor,
      x: input.x,
      y: input.y,
      text: value,
      fontSize: textFontSize / scale,
      fontFamily: textFontFamily,
      textAlign,
      fontBold: textBold,
      fontItalic: textItalic,
      fontUnderline: textUnderline,
      textBackground,
      textBackgroundColor,
      textBaseline: "top",
      padding: textPadding / scale,
    }];
    setNotebookUndoStack((previous) => [...previous, notebookAnnotations]);
    setNotebookAnnotations(nextAnnotations);
    setNotebookRedoStack([]);
    saveNotebookAnnotations(nextAnnotations);
    setNotebookDrawingTextInput(null);
  }, [notebookAnnotations, notebookDrawingTextInput, saveNotebookAnnotations, textAlign, textBackground, textBackgroundColor, textBold, textFontFamily, textFontSize, textItalic, textPadding, textToolColor, textUnderline]);
  const previewRef    = useRef(null);
  const canvasWrapRef = useRef(null);

  // Match the PDF text layer's touch-selection model: native selection is
  // disabled on coarse pointers and a double-touch draws app-owned selection
  // chrome. This avoids Safari's long-touch selection entirely.
  useEffect(() => {
    const mdPage = markdownVisualLayerRef.current;
    const preview = previewRef.current;
    if (!mdPage || !preview || !markdownVisualActive) return undefined;
    const MD_DOUBLE_TAP_MS = 350;
    const MD_DOUBLE_TAP_DIST = 30;
    const mapToPdfPoint = (clientX, clientY) => {
      const sourceRect = mdPage.getBoundingClientRect();
      const targetRect = preview.getBoundingClientRect();
      if (!sourceRect.width || !sourceRect.height || !targetRect.width || !targetRect.height) return null;
      return {
        x: targetRect.left + ((clientX - sourceRect.left) / sourceRect.width) * targetRect.width,
        y: targetRect.top + ((clientY - sourceRect.top) / sourceRect.height) * targetRect.height,
      };
    };
    const dispatchDoubleClick = (clientX, clientY) => {
      const point = mapToPdfPoint(clientX, clientY);
      if (!point) return;
      preview.dispatchEvent(new MouseEvent("dblclick", {
        bubbles: true,
        cancelable: true,
        clientX: point.x,
        clientY: point.y,
      }));
    };
    const clearMarkdownSelection = () => {
      mdPage.querySelectorAll(".pdf_markdown_word_selection, .pdf_markdown_selection_handle").forEach((node) => node.remove());
    };
    let markdownSelectionModel = null;
    let activeHandleCleanup = null;
    const textPositionAtPoint = (clientX, clientY) => {
      let node = null;
      let offset = 0;
      const caret = document.caretRangeFromPoint?.(clientX, clientY);
      if (caret?.startContainer?.nodeType === Node.TEXT_NODE) {
        node = caret.startContainer;
        offset = caret.startOffset;
      }
      let item = node?.parentElement?.closest?.(".pdf_markdown_aside_visual_line_item");
      if (!item || !mdPage.contains(item)) {
        item = document.elementsFromPoint(clientX, clientY)
          .map((element) => element.closest?.(".pdf_markdown_aside_visual_line_item"))
          .find((element) => element && mdPage.contains(element));
        node = item ? [...item.childNodes].find((child) => child.nodeType === Node.TEXT_NODE) : null;
        if (!node) return null;
        const rect = item.getBoundingClientRect();
        const ratio = rect.width > 0 ? Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) : 0;
        offset = Math.round(ratio * (node.textContent?.length || 0));
      }
      return { item, node, offset: Math.max(0, Math.min(node.textContent?.length || 0, offset)) };
    };
    const orderedTextItems = () => [...mdPage.querySelectorAll(".pdf_markdown_aside_visual_line_item")];
    const normalizedMarkdownEndpoints = () => {
      if (!markdownSelectionModel) return null;
      const items = orderedTextItems();
      const startIndex = items.indexOf(markdownSelectionModel.start.item);
      const endIndex = items.indexOf(markdownSelectionModel.end.item);
      if (startIndex < 0 || endIndex < 0) return null;
      const startFirst = startIndex < endIndex
        || (startIndex === endIndex && markdownSelectionModel.start.offset <= markdownSelectionModel.end.offset);
      return {
        items,
        start: startFirst ? markdownSelectionModel.start : markdownSelectionModel.end,
        end: startFirst ? markdownSelectionModel.end : markdownSelectionModel.start,
        startIndex: startFirst ? startIndex : endIndex,
        endIndex: startFirst ? endIndex : startIndex,
      };
    };
    const selectedMarkdownText = ({ items, start, end, startIndex, endIndex }) => {
      if (startIndex === endIndex) return start.node.textContent.slice(start.offset, end.offset);
      const parts = items.slice(startIndex, endIndex + 1).map((item, relativeIndex) => {
        const textNode = [...item.childNodes].find((child) => child.nodeType === Node.TEXT_NODE);
        const text = textNode?.textContent || "";
        if (relativeIndex === 0) return text.slice(start.offset);
        if (relativeIndex === endIndex - startIndex) return text.slice(0, end.offset);
        return text;
      });
      return parts.join(" ");
    };
    const renderMarkdownSelection = () => {
      const endpoints = normalizedMarkdownEndpoints();
      if (!endpoints) return false;
      const range = document.createRange();
      range.setStart(endpoints.start.node, endpoints.start.offset);
      range.setEnd(endpoints.end.node, endpoints.end.offset);
      const pageRect = mdPage.getBoundingClientRect();
      const rects = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
      if (!rects.length || !pageRect.width || !pageRect.height) return false;
      clearMarkdownSelection();
      window.getSelection()?.removeAllRanges();
      const scaleX = mdPage.offsetWidth / pageRect.width;
      const scaleY = mdPage.offsetHeight / pageRect.height;
      const localRects = rects.map((rect) => ({
        left: (rect.left - pageRect.left) * scaleX,
        top: (rect.top - pageRect.top) * scaleY,
        width: rect.width * scaleX,
        height: rect.height * scaleY,
      }));
      localRects.forEach((rect) => {
        const highlight = document.createElement("div");
        highlight.className = "pdf_markdown_word_selection";
        Object.assign(highlight.style, {
          left: `${rect.left}px`, top: `${rect.top}px`,
          width: `${rect.width}px`, height: `${rect.height}px`,
        });
        mdPage.appendChild(highlight);
      });
      const addHandle = (edge, rect, x) => {
        const handle = document.createElement("div");
        handle.className = `sel_selection_handle sel_selection_handle--${edge} pdf_markdown_selection_handle`;
        handle.setAttribute("aria-label", `${edge} selection handle`);
        Object.assign(handle.style, { left: `${x}px`, top: `${rect.top + rect.height}px` });
        const onPointerDown = (event) => {
          event.preventDefault();
          event.stopPropagation();
          activeHandleCleanup?.();
          const pointerId = event.pointerId;
          const onPointerMove = (moveEvent) => {
            if (moveEvent.pointerId !== pointerId) return;
            moveEvent.preventDefault();
            const position = textPositionAtPoint(moveEvent.clientX, moveEvent.clientY);
            if (!position) return;
            markdownSelectionModel[edge] = position;
            renderMarkdownSelection();
          };
          const stop = (endEvent) => {
            if (endEvent.pointerId !== pointerId) return;
            document.removeEventListener("pointermove", onPointerMove);
            document.removeEventListener("pointerup", stop);
            document.removeEventListener("pointercancel", stop);
            activeHandleCleanup = null;
          };
          activeHandleCleanup = () => {
            document.removeEventListener("pointermove", onPointerMove);
            document.removeEventListener("pointerup", stop);
            document.removeEventListener("pointercancel", stop);
          };
          document.addEventListener("pointermove", onPointerMove, { passive: false });
          document.addEventListener("pointerup", stop);
          document.addEventListener("pointercancel", stop);
        };
        handle.addEventListener("pointerdown", onPointerDown, { passive: false });
        mdPage.appendChild(handle);
      };
      const firstRect = localRects[0];
      const lastRect = localRects[localRects.length - 1];
      addHandle("start", firstRect, firstRect.left);
      addHandle("end", lastRect, lastRect.left + lastRect.width);
      const selectedText = sanitizeSelectedText(selectedMarkdownText(endpoints));
      if (!selectedText) return false;
      setManualSelection({
        surface: "md",
        text: selectedText,
        startIdx: endpoints.startIndex,
        endIdx: endpoints.endIndex,
        startCharOffset: endpoints.start.offset,
        endCharOffset: endpoints.end.offset,
        x: firstRect.left,
        y: lastRect.top + lastRect.height + 8,
      });
      return true;
    };
    const selectMarkdownWordAt = (clientX, clientY) => {
      const position = textPositionAtPoint(clientX, clientY);
      const target = position?.item;
      const textNode = position?.node;
      if (!target || !textNode) return false;
      const text = textNode?.textContent || "";
      if (!text.trim()) return false;
      let offset = position.offset;
      let start = offset;
      let end = offset;
      while (start > 0 && /\S/.test(text[start - 1])) start -= 1;
      while (end < text.length && /\S/.test(text[end])) end += 1;
      if (start === end) return false;
      markdownSelectionModel = {
        start: { item: target, node: textNode, offset: start },
        end: { item: target, node: textNode, offset: end },
      };
      return renderMarkdownSelection();
    };
    let lastTouch = null;
    const onDoubleClick = (event) => {
      if (markdownVisualMode === "visual-only") {
        event.preventDefault();
        event.stopPropagation();
        selectMarkdownWordAt(event.clientX, event.clientY);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      dispatchDoubleClick(event.clientX, event.clientY);
    };
    const onTouchEnd = (event) => {
      if (event.changedTouches.length !== 1) return;
      const touch = event.changedTouches[0];
      const now = Date.now();
      const isDoubleTouch = lastTouch
        && now - lastTouch.time < MD_DOUBLE_TAP_MS
        && Math.hypot(touch.clientX - lastTouch.x, touch.clientY - lastTouch.y) < MD_DOUBLE_TAP_DIST;
      if (isDoubleTouch) {
        event.preventDefault();
        event.stopPropagation();
        lastTouch = null;
        if (markdownVisualMode === "visual-only") {
          selectMarkdownWordAt(touch.clientX, touch.clientY);
        } else {
          dispatchDoubleClick(touch.clientX, touch.clientY);
        }
      } else {
        lastTouch = { time: now, x: touch.clientX, y: touch.clientY };
      }
    };
    const onTouchCancel = () => {
      lastTouch = null;
    };
    const onContextMenu = (event) => {
      if (markdownVisualMode === "visual-only") event.preventDefault();
    };
    mdPage.addEventListener("dblclick", onDoubleClick, { passive: false });
    mdPage.addEventListener("touchend", onTouchEnd, { passive: false });
    mdPage.addEventListener("touchcancel", onTouchCancel, { passive: false });
    mdPage.addEventListener("contextmenu", onContextMenu, { passive: false });
    return () => {
      activeHandleCleanup?.();
      clearMarkdownSelection();
      mdPage.removeEventListener("dblclick", onDoubleClick);
      mdPage.removeEventListener("touchend", onTouchEnd);
      mdPage.removeEventListener("touchcancel", onTouchCancel);
      mdPage.removeEventListener("contextmenu", onContextMenu);
    };
  }, [markdownVisualActive, markdownVisualMode]);

  useEffect(() => {
    if (manualSelection?.surface === "md") return;
    markdownVisualLayerRef.current
      ?.querySelectorAll(".pdf_markdown_word_selection, .pdf_markdown_selection_handle")
      .forEach((node) => node.remove());
  }, [manualSelection]);

  // Click-to-select an existing text annotation without first having to
  // arm the Text tool — a plain click while just reading selects it and
  // opens the same Edit text/Edit Style/Delete popout the Text tool's own
  // onDown opens (see findTextAnnotationAt above). Attached to
  // canvasWrapRef (an ancestor, always interactive) rather than the annot
  // canvas itself, since that canvas is pointer-events:none whenever no
  // drawing tool is armed — exactly the idle "just reading" state this is
  // for. Skipped whenever a real drawing tool IS armed (annotToolRef.current)
  // since that tool's own onDown already owns clicks then.
  useEffect(() => {
    const wrap = canvasWrapRef.current;
    if (!wrap || !pdfDoc) return;
    const onClick = (e) => {
      if (annotToolRef.current) return;
      if (e.target.closest?.("button, select, input, a, .annot_text_action_menu, .annot_text_input_wrap")) return;
      const ac = annotCanvasRef.current;
      if (!ac) return;
      const rect = ac.getBoundingClientRect();
      const scale = pageViewport?.scale || (fitScaleRef.current * zoomRef.current);
      const x = (e.clientX - rect.left) / scale;
      const y = (e.clientY - rect.top) / scale;
      const hit = findTextAnnotationAt(x, y);
      if (!hit) return;
      const box = getTextAnnotationBounds(hit, scale);
      primeTextStyleFromAnnotation(hit);
      setTextActionMenu({
        vx: rect.left + box.left,
        vy: rect.top + box.top,
        editingId: hit.id,
      });
    };
    wrap.addEventListener("click", onClick);
    return () => wrap.removeEventListener("click", onClick);
  }, [pdfDoc, findTextAnnotationAt, getTextAnnotationBounds, primeTextStyleFromAnnotation]);
  // The zoom % label — pinch/ctrl-scroll/held +/- all defer the real `zoom`
  // state update until the gesture settles (a live re-render on every tick
  // would re-trigger the expensive PDF.js rasterization this whole scheme
  // exists to avoid). Written to directly during the gesture instead, same
  // as canvasWrapRef's own transform, so the number still tracks live
  // without paying for a React re-render on every tick.
  const momentumFrameRef = useRef(0); // shared by touch-pan and mouse-drag-pan momentum coasting
  const livePanRef = useRef({
    frame: 0,
    active: false,
    currentL: 0,
    currentT: 0,
    targetL: 0,
    targetT: 0,
    lastT: 0,
  });
  const fileInputRef  = useRef(null);
  const zoomHoldTimerRef = useRef(null);
  const zoomHoldIntervalRef = useRef(null);
  const selBarRef          = useRef(null);
  const spansRef           = useRef([]); // [{text, el}] built when text layer renders
  const pendingSmartPenStrokesRef = useRef([]);
  const pageImageRectsRef  = useRef([]);
  const pageOperatorListCacheRef = useRef(new Map());
  const currentSourceIdRef = useRef(""); // the Source _id backing pdfDoc, if any (empty for local file uploads)
  const [schemaWordKeys, setSchemaWordKeys] = useState(() => new Set());
  const schemaWordKeysRef = useRef(schemaWordKeys);
  const schemaRecordsRef = useRef(new Map());
  const [traceSourcesByWord, setTraceSourcesByWord] = useState(() => new Map());
  const [smartPenMarkerPopup, setSmartPenMarkerPopup] = useState(null);
  const [smartPenMorphePreview, setSmartPenMorphePreview] = useState(null);
  const morpheUndoRef = useRef([]);
  const morpheRedoRef = useRef([]);
  useEffect(() => { schemaWordKeysRef.current = schemaWordKeys; }, [schemaWordKeys]);

  const rememberMorpheCreation = useCallback((action) => {
    if (!action?.id) return;
    morpheUndoRef.current.push(action);
    morpheRedoRef.current = [];
    logAnnotHistory({
      action: "add",
      type: `morphe-${action.kind}`,
      page: action.page,
      annotationId: action.id,
      morpheEntityId: action.id,
    });
  }, [logAnnotHistory]);

  const refreshSchemaWordKeys = useCallback(async () => {
    try {
      const data = await listMorpheSchemaNames();
      const keys = new Set(
      (data.schemas || [])
          .map((schema) => schemaWordKey(schema?.name))
          .filter(Boolean),
      );
      schemaRecordsRef.current = new Map(
        (data.schemas || [])
          .map((schema) => [schemaWordKey(schema?.name), schema])
          .filter(([key]) => Boolean(key)),
      );
      const nextTraceSources = new Map();
      (data.traceSchemas || []).forEach((trace) => {
        const traceKey = schemaWordKey(trace?.name);
        const sourceName = cleanSchemaWord(trace?.sourceSchemaName);
        if (!traceKey || !sourceName) return;
        const sources = nextTraceSources.get(traceKey) || [];
        if (!sources.some((source) => schemaWordKey(source.name) === schemaWordKey(sourceName))) {
          sources.push({ name: sourceName, dimension: trace?.traceDimension === "4D" ? "4D" : "3D" });
        }
        nextTraceSources.set(traceKey, sources);
      });
      schemaWordKeysRef.current = keys;
      setSchemaWordKeys(keys);
      setTraceSourcesByWord(nextTraceSources);
    } catch (error) {
      console.error("[PDF] Failed to load Smart Pen Schema markers", error);
    }
  }, []);

  useEffect(() => {
    void refreshSchemaWordKeys();
    const refreshOnFocus = () => { void refreshSchemaWordKeys(); };
    window.addEventListener("focus", refreshOnFocus);
    window.addEventListener("amctoshs:morphe-updated", refreshOnFocus);
    return () => {
      window.removeEventListener("focus", refreshOnFocus);
      window.removeEventListener("amctoshs:morphe-updated", refreshOnFocus);
    };
  }, [refreshSchemaWordKeys]);

  const registerSmartPenStrokeSchemas = useCallback((stroke) => {
    if (!spansRef.current.length) {
      pendingSmartPenStrokesRef.current.push(stroke);
      return;
    }
    const coveredRecords = getSmartPenCoveredSpanRecords(stroke, spansRef.current);
    const coveredWords = coveredRecords.map(({ word }) => word);
    const newWords = coveredWords.filter((word) => !schemaWordKeysRef.current.has(schemaWordKey(word)));
    if (!newWords.length) return;

    const sourceId = currentSourceIdRef.current || embeddedSourceId || null;
    const directionalTraces = getSmartPenDirectionalTraceRecords(stroke, spansRef.current, schemaRecordsRef.current);
    if (directionalTraces.length) {
      directionalTraces.forEach(({ target, traceDimension }) => {
        window.dispatchEvent(new CustomEvent("amctoshs:morphe-updated", { detail: { phase: "saving", kind: "trace", name: target.word, traceDimension } }));
      });
      void Promise.allSettled(directionalTraces.map(({ source, target, traceDimension }) => {
        const sourceSchema = schemaRecordsRef.current.get(schemaWordKey(source.word));
        return upsertSmartPenTrace({
          name: target.word,
          sourceSchemaId: sourceSchema?._id,
          sourceSchemaName: source.word,
          sourceId,
          page: pageNum,
          traceDimension,
        });
      })).then((results) => {
        results.forEach((result, index) => {
          if (result.status !== "fulfilled" || result.value?.created === false) return;
          const trace = result.value?.traceSchema;
          const source = directionalTraces[index]?.source;
          const target = directionalTraces[index]?.target;
          if (!trace?._id || !source || !target) return;
          rememberMorpheCreation({
            kind: "trace",
            id: trace._id,
            name: target.word,
            sourceSchemaId: trace.sourceSchemaId || schemaRecordsRef.current.get(schemaWordKey(source.word))?._id,
            sourceSchemaName: source.word,
            sourceId,
            page: pageNum,
            traceDimension: directionalTraces[index]?.traceDimension || "3D",
          });
          window.dispatchEvent(new CustomEvent("amctoshs:morphe-updated", { detail: { phase: "saved", kind: "trace", name: trace.name, id: trace._id, traceDimension: trace.traceDimension || directionalTraces[index]?.traceDimension || "3D" } }));
        });
        results.forEach((result, index) => {
          if (result.status === "rejected") {
            window.dispatchEvent(new CustomEvent("amctoshs:morphe-updated", { detail: { phase: "failed", kind: "trace", name: directionalTraces[index]?.target?.word || "" } }));
          }
        });
        if (results.some((result) => result.status === "fulfilled")) {
          window.dispatchEvent(new CustomEvent("amctoshs:morphe-updated"));
        }
      });
      return;
    }
    // Once a stroke touches an existing Schema, it is a relationship gesture
    // rather than permission to turn every other covered word into a Schema.
    if (coveredRecords.some((record) => schemaRecordsRef.current.has(schemaWordKey(record.word)))) return;
    if (!isSmartPenRectangularStroke(stroke)) return;

    const schemaNames = getSmartPenCoveredSchemaNames(stroke, spansRef.current)
      .filter((name) => !schemaWordKeysRef.current.has(schemaWordKey(name)));
    if (!schemaNames.length) return;
    const optimisticKeys = new Set(schemaWordKeysRef.current);
    schemaNames.forEach((name) => optimisticKeys.add(schemaWordKey(name)));
    schemaWordKeysRef.current = optimisticKeys;
    setSchemaWordKeys(optimisticKeys);
    schemaNames.forEach((name) => {
      window.dispatchEvent(new CustomEvent("amctoshs:morphe-updated", { detail: { phase: "saving", kind: "schema", name } }));
    });
    void Promise.allSettled(schemaNames.map((name) => upsertSmartPenSchema({ name, sourceId, page: pageNum })))
      .then((results) => {
        results.forEach((result) => {
          const schema = result.status === "fulfilled" ? result.value?.schema : null;
          if (schema?._id) {
            schemaRecordsRef.current.set(schemaWordKey(schema.name), schema);
            if (result.value?.created !== false) {
              rememberMorpheCreation({ kind: "schema", id: schema._id, name: schema.name, sourceId, page: pageNum });
              window.dispatchEvent(new CustomEvent("amctoshs:morphe-updated", { detail: { phase: "saved", kind: "schema", name: schema.name, id: schema._id } }));
            }
          }
        });
        results.forEach((result, index) => {
          if (result.status === "rejected") {
            window.dispatchEvent(new CustomEvent("amctoshs:morphe-updated", { detail: { phase: "failed", kind: "schema", name: schemaNames[index] || "" } }));
          }
        });
        if (results.some((result) => result.status === "fulfilled")) {
          window.dispatchEvent(new CustomEvent("amctoshs:morphe-updated"));
        }
        return refreshSchemaWordKeys();
      });
  }, [embeddedSourceId, pageNum, refreshSchemaWordKeys, rememberMorpheCreation]);

  const schemaTextLayerActive = textSelectable || annotTool === "smartPen" || schemaWordKeys.size > 0;
  const [hyleSources, setHyleSources] = useState([]);
  const [hyleSourcesLoading, setHyleSourcesLoading] = useState(false);
  const bboxCardsForBuilder = useMemo(() => {
    const entityBuilderPageAnnotations = annotations[pageNum] || [];
    if (!entityBuilderPageAnnotations.length) return [];
    const sourceOrder = hyleSources.findIndex((source) => source._id === currentSourceIdRef.current) + 1;
    const hyleIds = buildHyleBBoxIdMap(entityBuilderPageAnnotations, sourceOrder, pageNum);
    const typeOrdinals = {};
    return entityBuilderPageAnnotations
      .filter((bbox) => BBOX_CARD_TYPES.has(bbox.type) || bboxTypeHas(bbox.type, "containsChildren") || ["columnBBox", "subLineBBox"].includes(bbox.type))
      .map((bbox, index) => {
        const viewBBox = bboxResizePreview?.id === bbox.id
          ? { ...bbox, ...bboxResizePreview }
          : bbox;
        typeOrdinals[viewBBox.type] = (typeOrdinals[viewBBox.type] || 0) + 1;
        const partitionedText = viewBBox.type === "bbox"
          ? buildPartitionOrderedTextLines(
              spansRef.current,
              viewBBox,
              entityBuilderPageAnnotations.filter((item) => item?.type === "columnBBox"),
              bboxTextMatchesSpanUtil,
            )
          : { lines: [], groups: [], partitionIds: [] };
        const derivedTextLines = bboxTypeHas(viewBBox.type, "extractsText")
          ? (partitionedText.lines.length
              ? partitionedText.lines
              : buildTextLines(
                  selectSpansForBoundingBox(
                    spansRef.current,
                    viewBBox,
                    bboxTextMatchesSpanUtil,
                    [],
                    { preserveColumns: true, splitLines: ["bbox", "columnBBox", "subLineBBox"].includes(viewBBox.type) },
                  ),
                )).map((line) => line.text).filter(Boolean)
          : null;
        // Keep every extracted line in Illumination, including a line that
        // may also be stored as paragraph title metadata. A SubLine child
        // must remain visible in the parent's line group after reparenting.
        const bodyTextLines = derivedTextLines;
        return {
          ...viewBBox,
          ...(bodyTextLines?.length || derivedTextLines?.length ? { textLines: bodyTextLines || [] } : {}),
          ...(partitionedText.partitionIds.length > 1 ? {
            partitionIds: partitionedText.partitionIds,
            partitionLineGroups: partitionedText.groups.map((group) => ({
              partitionId: group.partitionId,
              lines: group.lines.map((line) => line.text).filter(Boolean),
            })),
          } : {}),
          hyleId: hyleIds[bbox.id] || getSemanticHyleBBoxId(currentSourceIdRef.current, pageNum, viewBBox.type, typeOrdinals[viewBBox.type]),
          _index: index + 1,
          _displayTitle: bbox.title?.trim()
            || (bboxTypeHas(bbox.type, "containsChildren")
              ? `${getBBoxTypeAbbreviation(bbox.type)} ${index + 1}`
              : `${getBBoxTypeAbbreviation(bbox.type)} ${index + 1}`),
          text: bbox.text || "",
        };
      });
  }, [annotations, bboxResizePreview, hyleSources, pageNum, textLayerRenderTick]);
  const isCurrentPageFullySegmented = useMemo(() => {
    const meaningfulLines = buildTextLines(spansRef.current || []).filter((line) => {
      const text = String(line?.text || "").replace(/\s+/g, " ").trim();
      return text.length >= 2 && /[\p{L}\p{N}]/u.test(text);
    });
    if (!meaningfulLines.length) return false;

    const contentBboxes = (annotations[pageNum] || []).filter((annotation) => (
      bboxTypeHas(annotation?.type, "extractsText")
      && annotation.type !== "subLineBBox"
      && Number(annotation?.w) > 0
      && Number(annotation?.h) > 0
    ));
    if (!contentBboxes.length) return false;

    const lineCoveredByBBox = (line, bbox) => {
      const rect = line?.rect;
      if (!rect || !bbox) return false;
      const overlapX = Math.max(0, Math.min(rect.x + rect.w, bbox.x + bbox.w) - Math.max(rect.x, bbox.x));
      const overlapY = Math.max(0, Math.min(rect.y + rect.h, bbox.y + bbox.h) - Math.max(rect.y, bbox.y));
      const lineArea = Math.max(1, rect.w * rect.h);
      return (overlapX * overlapY) / lineArea >= 0.9;
    };

    return meaningfulLines.every((line) => contentBboxes.some((bbox) => lineCoveredByBBox(line, bbox)));
  }, [annotations, pageNum, textLayerRenderTick]);
  useEffect(() => {
    const sourceId = currentSourceIdRef.current;
    if (!entityBuilderOpen || !sourceId) return undefined;
    let cancelled = false;
    let retryTimer = 0;
    const targetPage = pageNum;

    const refreshCorrections = async () => {
      try {
        const response = await authFetch(apiUrl(`/api/sources/${sourceId}/ocr/pages?page=${targetPage}`));
        const data = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (response.status === 202 && ["queued", "uploading", "processing"].includes(data.status)) {
          retryTimer = window.setTimeout(refreshCorrections, 4000);
          return;
        }
        const ocrPage = data.pages?.[0];
        if (!response.ok || !ocrPage?.markdown?.trim()) return;
        const alignedOcrPage = await mapOcrPageToPdfSpace(ocrPage, targetPage);

        const currentAnnotations = annotationsRef.current;
        const currentPageAnnotations = currentAnnotations[targetPage] || [];
        const targets = currentPageAnnotations.filter((item) => (
          bboxTypeHas(item.type, "extractsText")
          && String(item.rawPdfText || item.text || "").trim()
          && item.textCorrection?.source !== "manual"
          && !(
            item.textCorrection?.ocrJobId === data.job?.id
            && item.textCorrection?.correctionVersion === BBOX_TEXT_CORRECTION_VERSION
          )
        ));
        if (!targets.length) return;

        const corrections = await Promise.all(targets.map(async (item) => ({
          id: item.id,
          result: await correctBBoxText({
            rawPdfText: item.rawPdfText || item.text || "",
            bboxPdf: { x: item.x, y: item.y, width: item.w, height: item.h },
            pageIndex: targetPage - 1,
            ocrPage: alignedOcrPage,
          }),
        })));
        if (cancelled || currentSourceIdRef.current !== sourceId) return;
        const correctionById = new Map(corrections.map((entry) => [entry.id, entry.result]));
        const nextAnnotations = {
          ...annotationsRef.current,
          [targetPage]: (annotationsRef.current[targetPage] || []).map((item) => {
            const correction = correctionById.get(item.id);
            if (!correction) return item;
            return {
              ...item,
              text: correction.correctedText,
              correctedText: correction.correctedText,
              ocrCorrectedText: correction.correctionSource === "ocr_alignment"
                ? correction.correctedText
                : (correction.ocrCandidateText || correction.correctedText),
              rawPdfText: correction.rawText,
              textCorrection: {
                source: correction.correctionSource,
                confidence: correction.correctionConfidence,
                warnings: correction.correctionWarnings,
                audit: correction.correctionAudit,
                ocrVersion: data.job?.schemaVersion || null,
                ocrJobId: data.job?.id || null,
                applied: correction.correctionSource === "ocr_alignment",
                correctionVersion: BBOX_TEXT_CORRECTION_VERSION,
              },
            };
          }),
        };
        annotationsRef.current = nextAnnotations;
        setAnnotations(nextAnnotations);
        await authFetch(apiUrl(`/api/source-annotations/${sourceId}`), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildAnnotationSavePayload({ activeAnnotations: nextAnnotations })),
        });
      } catch (error) {
        if (!cancelled) console.warn("[PDF] Could not refresh stored OCR corrections", error);
      }
    };

    void refreshCorrections();
    return () => {
      cancelled = true;
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  // Re-run only when the visible Builder page/source changes. Annotation
  // mutations are handled from annotationsRef to avoid correction loops.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityBuilderOpen, pageNum, hasSourceId]);
  useEffect(() => {
    let cancelled = false;
    pageImageRectsRef.current = [];
    if (!pdfDoc || !pageViewport) return undefined;
    pdfDoc.getPage(pageNum)
      .then(async (page) => {
        const cached = pageOperatorListCacheRef.current.get(pageNum);
        if (cached) return cached;
        const operatorList = await page.getOperatorList();
        pageOperatorListCacheRef.current.set(pageNum, operatorList);
        return operatorList;
      })
      .then((operatorList) => {
        if (cancelled) return;
        pageImageRectsRef.current = extractPlacedImageRects(operatorList, pageViewport, pdfjsLib.OPS);
      })
      .catch(() => {
        if (!cancelled) pageImageRectsRef.current = [];
      });
    return () => { cancelled = true; };
  }, [pdfDoc, pageNum, pageViewport]);
  const selectionDraggingEdgeRef = useRef(null); // "start" | "end" | null — which manual-selection handle (if any) is actively being dragged, see the manualSelection highlight effect below
  const selectionHandleDragRef = useRef(null); // { edge, startX, startY, active } — taps on handles must not alter selection, only real drags
  const selectionHandleLivePosRef = useRef(null); // { edge, x, y } live visual handle position while dragging
  const scrollAfterZoomRef = useRef(null); // {left, top} to apply after zoom re-render
  // Normalized position within the whole shared PDF/MD canvas. Keep this
  // even while zoomed far enough out that an axis no longer scrolls, so a
  // later zoom-in restores the previous pan instead of forgetting it at 0.
  const zoomPanMemoryRef = useRef({ page: null, layout: "", ratioX: 0.5, ratioY: 0.5 });
  const lastLoadedSourceKeyRef = useRef("");
  const insertBlankPageRef = useRef(null); // latest insertBlankPageAfterCurrent closure — see its own effect further down for why this indirection is needed
  const lastLoadedFileRef = useRef(null);
  const skipNextAnnotationAutosaveRef = useRef(false); // set right before restoring a saved session, so that restore doesn't immediately re-trigger the autosave effect below
  const wheelZoomStateRef  = useRef({
    baseZoom: 1,
    pendingZoom: 1,
    originX: 0,
    originY: 0,
    midX: 0,
    midY: 0,
    anchorMidX: 0,
    anchorMidY: 0,
    startSL: 0,
    startST: 0,
    timer: null,
    frame: 0,
  });

  const captureZoomAnchor = useCallback((clientX, clientY) => {
    const previewEl = previewRef.current;
    const wrap = canvasWrapRef.current;
    if (!previewEl || !wrap) return null;
    const previewRect = previewEl.getBoundingClientRect();
    const viewportX = clientX - previewRect.left;
    const viewportY = clientY - previewRect.top;
    const width = Math.max(1, wrap.offsetWidth);
    const height = Math.max(1, wrap.offsetHeight);
    const page = pageNumRef.current;
    const layout = wrap.className;
    const previous = zoomPanMemoryRef.current;
    const sameLayout = previous.page === page && previous.layout === layout;
    const rawRatioX = clamp((previewEl.scrollLeft + viewportX - wrap.offsetLeft) / width, 0, 1);
    const rawRatioY = clamp((previewEl.scrollTop + viewportY - wrap.offsetTop) / height, 0, 1);
    const ratioX = sameLayout && previewEl.scrollWidth <= previewEl.clientWidth + 1
      ? previous.ratioX
      : rawRatioX;
    const ratioY = sameLayout && previewEl.scrollHeight <= previewEl.clientHeight + 1
      ? previous.ratioY
      : rawRatioY;
    zoomPanMemoryRef.current = { page, layout, ratioX, ratioY };
    return {
      kind: "canvas-anchor",
      viewportX,
      viewportY,
      ratioX,
      ratioY,
    };
  }, []);

  const navigate = useNavigate();
  const location = useLocation();
  const { card: urlCard } = useParams();
  const embedded = Boolean(embeddedSourceId) || Boolean(embeddedFile); // true when mounted inside another page (e.g. Units Extraction) rather than routed directly
  const isNounsPage = !urlCard; // true when mounted at /hyles (no card in URL)
  const [localCard, setLocalCard] = useState("entities");
  const activeCard = isNounsPage
    ? localCard
    : (CARDS.find((c) => c.key === urlCard)?.key || "entities");
  const canExtract = Boolean(pdfDoc) && pdfType !== "scanned";

  // ── Sources list (for /hyles drop-zone replacement) ─────────────────────
  useEffect(() => {
    setHyleSourcesLoading(true);
    authFetch(apiUrl("/api/sources/"))
      .then((r) => r.json())
      .then((d) => setHyleSources((d.sources || []).filter((s) => /\.(pdf|docx?)$/i.test(s.name))))
      .catch(() => {})
      .finally(() => setHyleSourcesLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fetch history on mount ─────────────────────────────────────────────────
  useEffect(() => {
    setHistoryLoading(true);
    authFetch(apiUrl("/api/pdf/history"))
      .then((r) => r.json())
      .then((d) => {
        const extractions = d.extractions || [];
        setHistory(extractions);
        if (extractions.length > 0) {
          const first = extractions[0];
          authFetch(apiUrl(`/api/pdf/history/${first._id}`))
            .then((r) => r.json())
            .then((data) => {
              setHyleData(inflateExtraction(data.extraction));
              setActiveHistoryId(first._id);
              setSavedId(first._id);
            })
            .catch(() => {});
        }
      })
      .catch(() => {})
      .finally(() => setHistoryLoading(false));
  }, []);

  // ── Render PDF page on canvas ──────────────────────────────────────────────
  // Renders a single page at the current fitScale*zoom, skipping it if its
  // canvas is already up to date at that scale.
  const renderPage = useCallback(async (n) => {
    if (!pdfDoc) return;
    const canvas = pageCanvasRefs.current[n - 1];
    if (!canvas) return;
    const displayScale = fitScaleRef.current * zoom;
    if (renderedScaleRef.current[n - 1] === displayScale) return;
    const page     = await pdfDoc.getPage(n);
    const c        = pageCanvasRefs.current[n - 1];
    if (!c) return;
    const displayViewport = page.getViewport({ scale: displayScale });
    pageViewportsRef.current[n - 1] = displayViewport;
    renderTasksRef.current[n - 1]?.cancel();
    const deviceScale = window.devicePixelRatio || 1;
    const renderScaleFactor = Math.min(
      1,
      MAX_RENDER_CANVAS_DIMENSION / Math.max(1, displayViewport.width * deviceScale),
      MAX_RENDER_CANVAS_DIMENSION / Math.max(1, displayViewport.height * deviceScale),
      Math.sqrt(MAX_RENDER_CANVAS_PIXELS / Math.max(1, displayViewport.width * displayViewport.height * deviceScale * deviceScale)),
    );
    const renderViewport = renderScaleFactor < 0.999
      ? page.getViewport({ scale: displayScale * renderScaleFactor })
      : displayViewport;
    const outputScale = Math.max(1, getSafeCanvasOutputScale(renderViewport.width, renderViewport.height, deviceScale));
    c.width  = Math.floor(renderViewport.width * outputScale);
    c.height = Math.floor(renderViewport.height * outputScale);
    // Keep layout in CSS pixels while rendering the raster at device-pixel
    // density, so the page reads sharper and less washed out on modern displays.
    c.style.width  = `${displayViewport.width}px`;
    c.style.height = `${displayViewport.height}px`;
    renderedCssSizeRef.current[n - 1] = {
      width: displayViewport.width,
      height: displayViewport.height,
    };
    const ctx = c.getContext("2d");
    ctx.setTransform(outputScale, 0, 0, outputScale, 0, 0);
    const task = page.render({ canvasContext: ctx, viewport: renderViewport });
    renderTasksRef.current[n - 1] = task;
    renderedScaleRef.current[n - 1] = displayScale;
    task.promise.catch(err => { if (err?.name !== "RenderingCancelledException") console.error(err); });
    if (n === pageNumRef.current) {
      setPageViewport(displayViewport);
      currentBackingScaleRef.current = c.width / Math.max(1, displayViewport.width);
    }
  }, [pdfDoc, zoom]);

  // Full reset + initial render whenever a new document (or page count) loads.
  // Deliberately does NOT run on zoom changes (see the effect below) — this
  // used to fire on zoom too and reset renderedScaleRef to all-null every
  // time, which wiped out the "last actually-rendered scale" a never-visited
  // page needs to correctly rescale itself on the NEXT zoom tick (it would
  // read back as null and silently stop rescaling after the first tick).
  useEffect(() => {
    if (!pdfDoc || pageCount === 0) return;
    let cancelled = false;
    pageOperatorListCacheRef.current.clear();
    renderTasksRef.current.forEach(t => t?.cancel());
    renderTasksRef.current   = new Array(pageCount).fill(null);
    renderedScaleRef.current = new Array(pageCount).fill(null);
    renderedCssSizeRef.current = new Array(pageCount).fill(null);

    // Genuinely cramped embeddings (e.g. Units Extraction, a PDF preview
    // inside another page's own UI) preserve the PDF's original size
    // instead of fitting to the container — fitToContainer opts a specific
    // embedding OUT of that (see PDFReaderWorkspace.jsx, whose own reading
    // pane is a full dedicated area, not a cramped side panel, so
    // documents should scale to fit it like a routed reader would rather
    // than each rendering at a different raw native size depending on
    // that particular file's own page dimensions in points).
    pdfDoc.getPage(1).then(page1 => {
      if (cancelled) return;
      if (embedded && !fitToContainer) {
        fitScaleRef.current = 1;
      } else {
        const previewWidth = previewRef.current?.clientWidth || 480;
        const previewHeight = previewRef.current?.clientHeight || 720;
        const baseViewport = page1.getViewport({ scale: 1 });
        const horizontalFit = (previewWidth - 24) / baseViewport.width;
        const verticalFit = (previewHeight - 24) / baseViewport.height;
        fitScaleRef.current = Math.min(
          1,
          horizontalFit,
          verticalFit,
        );
      }
      if (cancelled) return;
      renderPage(pageNumRef.current);
    });

    return () => { cancelled = true; renderTasksRef.current.forEach(t => t?.cancel()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- renderPage intentionally excluded, only pdfDoc/pageCount should reset the per-page render bookkeeping
  }, [pdfDoc, pageCount]);

  // Only the current page re-renders eagerly on zoom change; every other page
  // is instantly CSS-rescaled (approximate, no re-rasterization — cheap) and
  // lazily re-rendered for real by the IntersectionObserver below once it's
  // scrolled into view. Re-rasterizing every page on every zoom tick made
  // zooming a multi-page document slow; NOT touching renderedScaleRef here
  // (unlike the effect above) is what lets this compute the correct
  // cumulative rescale ratio across several zoom ticks in a row, even for a
  // page that's never actually revisited.
  useEffect(() => {
    if (!pdfDoc || pageCount === 0) return;
    const newScale = fitScaleRef.current * zoom;
    pageCanvasRefs.current.forEach((canvas, i) => {
      if (!canvas) return;
      const prevScale = renderedScaleRef.current[i];
      if (!prevScale || prevScale === newScale) return;
      const ratio = newScale / prevScale;
      const prevCssSize = renderedCssSizeRef.current[i];
      if (!prevCssSize) return;
      canvas.style.width  = `${prevCssSize.width * ratio}px`;
      canvas.style.height = `${prevCssSize.height * ratio}px`;
    });
    renderPage(pageNumRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only zoom should trigger this; renderPage/pdfDoc/pageCount changing here would re-run the doc-load effect above instead
  }, [zoom]);

  // Sync pageViewport when pageNum changes via scroll
  useEffect(() => {
    const vp = pageViewportsRef.current[pageNum - 1];
    if (vp) setPageViewport(vp);
  }, [pageNum]);

  // Keep refs in sync so event handlers always read the latest values
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { annotToolRef.current = navigationBlocked ? annotTool : null; }, [annotTool, navigationBlocked]);

  useEffect(() => {
    if (annotTool !== "highlight") return undefined;
    const isInPreview = (event) => {
      const preview = previewRef.current;
      return Boolean(preview && event.target && preview.contains(event.target));
    };
    const suppressSafariHighlightLongTouch = (event) => {
      if (!isInPreview(event)) return;
      if (event.cancelable) event.preventDefault();
      window.getSelection?.()?.removeAllRanges();
      setManualSelection(null);
      setManualPopup(null);
    };
    const clearSafariSelection = () => {
      const selection = window.getSelection?.();
      if (!selection?.rangeCount) return;
      const preview = previewRef.current;
      const anchor = selection.anchorNode?.nodeType === Node.ELEMENT_NODE
        ? selection.anchorNode
        : selection.anchorNode?.parentElement;
      if (preview && anchor && preview.contains(anchor)) selection.removeAllRanges();
    };

    document.addEventListener("touchstart", suppressSafariHighlightLongTouch, { capture: true, passive: false });
    document.addEventListener("touchmove", suppressSafariHighlightLongTouch, { capture: true, passive: false });
    document.addEventListener("contextmenu", suppressSafariHighlightLongTouch, { capture: true });
    document.addEventListener("selectstart", suppressSafariHighlightLongTouch, { capture: true });
    document.addEventListener("selectionchange", clearSafariSelection);
    return () => {
      document.removeEventListener("touchstart", suppressSafariHighlightLongTouch, { capture: true });
      document.removeEventListener("touchmove", suppressSafariHighlightLongTouch, { capture: true });
      document.removeEventListener("contextmenu", suppressSafariHighlightLongTouch, { capture: true });
      document.removeEventListener("selectstart", suppressSafariHighlightLongTouch, { capture: true });
      document.removeEventListener("selectionchange", clearSafariSelection);
    };
  }, [annotTool]);

  useEffect(() => () => {
    const state = wheelZoomStateRef.current;
    if (state.timer) clearTimeout(state.timer);
    if (state.frame) cancelAnimationFrame(state.frame);
  }, []);

  // Apply zoom-to-point scroll correction after canvas re-renders at new zoom.
  // Also strips any CSS pinch-transform that was held until this point.
  //
  // renderPage() is async (it awaits pdfDoc.getPage before it ever touches
  // pageViewport), so the [zoom] state commits — and this effect's first
  // firing happens — well before the page container has actually resized to
  // the new zoom. Reading pageEl.offsetWidth/Height at that point returns
  // the OLD, still-small size; at a big zoom jump (e.g. pinching to 255%)
  // the resulting target undershoots badly enough to go negative and clamp
  // to (0,0) — the page snapping to its own upper-left corner the instant
  // the pinch lifted. renderedScaleRef is set (by renderPage) in the same
  // synchronous block as the pageViewport update that actually resizes the
  // page, right before it, so comparing against it here tells us whether
  // the DOM has really caught up yet — if not, leave the correction pending
  // instead of consuming it early; the effect fires again once pageViewport
  // itself updates, by which point the size is correct.
  useEffect(() => {
    const pending = scrollAfterZoomRef.current;
    if (!pending || !previewRef.current) return;
    if (renderedScaleRef.current[pageNumRef.current - 1] !== fitScaleRef.current * zoom) return;
    scrollAfterZoomRef.current = null;
    const el   = previewRef.current;
    const wrap = canvasWrapRef.current;
    requestAnimationFrame(() => {
      // Remove the CSS transform and set the real scroll in the same frame
      // so the canvas never flashes back to the pre-zoom position.
      if (wrap && wrap.style.transform) {
        wrap.style.transform       = "";
        wrap.style.transformOrigin = "";
        wrap.style.willChange      = "";
        wrap.style.removeProperty("--pdf-live-zoom-inverse");
      }
      if (pending.kind === "canvas-anchor") {
        const canvas = canvasWrapRef.current;
        if (canvas) {
          const targetLeft = canvas.offsetLeft + canvas.offsetWidth * pending.ratioX - pending.viewportX;
          const targetTop = canvas.offsetTop + canvas.offsetHeight * pending.ratioY - pending.viewportY;
          const maxLeft = Math.max(0, el.scrollWidth - el.clientWidth);
          const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
          el.scrollLeft = clamp(targetLeft, 0, maxLeft);
          el.scrollTop = clamp(targetTop, 0, maxTop);
          return;
        }
      }
      el.scrollLeft = Math.max(0, pending.left);
      el.scrollTop  = Math.max(0, pending.top);
    });
  }, [zoom, pageViewport]);

  // A zoom gesture uses a temporary wrapper transform until the committed
  // PDF raster reaches the new scale. The anchor effect above clears it when
  // an anchor exists, but some zoom paths intentionally have no anchor. Once
  // the rendered scale matches the committed zoom, no transform is allowed
  // to remain because it would resize the BBox DOM chrome as well.
  useEffect(() => {
    const wrap = canvasWrapRef.current;
    if (!wrap || renderedScaleRef.current[pageNumRef.current - 1] !== fitScaleRef.current * zoom) return undefined;
    const frame = requestAnimationFrame(() => {
      if (!wrap.style.transform) return;
      wrap.style.transform = "";
      wrap.style.transformOrigin = "";
      wrap.style.willChange = "";
      wrap.style.removeProperty("--pdf-live-zoom-inverse");
    });
    return () => cancelAnimationFrame(frame);
  }, [pageViewport, zoom]);

  // Single-page view: only pageNum is ever mounted, so (re)render it
  // directly on every page switch instead of watching scroll position.
  // renderedScaleRef is a "last scale this page was rasterized at" cache —
  // it exists to skip redundant re-renders of a page that's still mounted
  // (e.g. after a zoom-settle tick), but a page you're navigating BACK to
  // got a brand new, blank canvas when it unmounted, while its old cache
  // entry survived untouched. Without clearing it here, renderPage saw a
  // "same scale as last time" match and skipped rendering into that fresh
  // canvas entirely — the page you paged back to just stayed empty.
  useEffect(() => {
    if (!pdfDoc || pageCount === 0) return;
    renderedScaleRef.current[pageNum - 1] = null;
    renderPage(pageNum);
  }, [pdfDoc, pageCount, pageNum, renderPage]);

  // Booklet mode's companion page — same renderPage() call, same
  // pageCanvasRefs/renderedScaleRef arrays (index by page number), just
  // triggered off bookletRightPage instead of pageNum.
  useEffect(() => {
    if (!pdfDoc || pageCount === 0) return;
    if (readingMode !== "booklet" || !bookletRightPage) return;
    renderedScaleRef.current[bookletRightPage - 1] = null;
    renderPage(bookletRightPage);
  }, [pdfDoc, pageCount, readingMode, bookletRightPage, renderPage]);

  // Picking a sensible default companion page (pageNum+1) the moment
  // booklet mode is switched on, without stomping a value the user
  // already chose while staying in booklet mode.
  useEffect(() => {
    if (readingMode !== "booklet" || pageCount === 0) return;
    setBookletRightPage((prev) => {
      if (prev && prev >= 1 && prev <= pageCount) return prev;
      return Math.min(pageCount, pageNum + 1);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only readingMode/pageCount should pick a fresh default; pageNum is read once at the moment of switching, not tracked afterward
  }, [readingMode, pageCount]);

  // Jumping to a new page always lands at its top-left, not wherever the
  // previous page happened to be scrolled/panned to.
  useEffect(() => {
    const el = previewRef.current;
    if (el) { el.scrollLeft = 0; el.scrollTop = 0; }
  }, [pageNum]);

  useEffect(() => {
    const pending = pendingReaderRestoreRef.current;
    const previewEl = previewRef.current;
    const pageEl = pageContainerRefs.current[pageNum - 1];
    if (!pending || pending.pageNum !== pageNum || !previewEl || !pageEl || !pageViewport) return;
    requestAnimationFrame(() => {
      const nextPending = pendingReaderRestoreRef.current;
      const nextPreviewEl = previewRef.current;
      const nextPageEl = pageContainerRefs.current[pageNum - 1];
      if (!nextPending || nextPending.pageNum !== pageNum || !nextPreviewEl || !nextPageEl) return;
      const ratioX = typeof nextPending.pageRatioX === "number" ? nextPending.pageRatioX : null;
      const ratioY = typeof nextPending.pageRatioY === "number" ? nextPending.pageRatioY : null;
      if (ratioX == null || ratioY == null) {
        pendingReaderRestoreRef.current = null;
        return;
      }
      const pageWidth = Math.max(1, nextPageEl.offsetWidth || 1);
      const pageHeight = Math.max(1, nextPageEl.offsetHeight || 1);
      const targetCenterX = nextPageEl.offsetLeft + (pageWidth * ratioX);
      const targetCenterY = nextPageEl.offsetTop + (pageHeight * ratioY);
      const maxLeft = Math.max(0, nextPreviewEl.scrollWidth - nextPreviewEl.clientWidth);
      const maxTop = Math.max(0, nextPreviewEl.scrollHeight - nextPreviewEl.clientHeight);
      nextPreviewEl.scrollLeft = clamp(targetCenterX - (nextPreviewEl.clientWidth / 2), 0, maxLeft);
      nextPreviewEl.scrollTop = clamp(targetCenterY - (nextPreviewEl.clientHeight / 2), 0, maxTop);
      pendingReaderRestoreRef.current = null;
    });
  }, [pageNum, pageViewport, zoom]);

  const [readerStateSaveTick, setReaderStateSaveTick] = useState(0);
  useEffect(() => {
    const el = previewRef.current;
    if (!el) return undefined;
    let timer = 0;
    const onScroll = () => {
      if (timer) clearTimeout(timer);
      timer = window.setTimeout(() => {
        const rect = el.getBoundingClientRect();
        captureZoomAnchor(rect.left + el.clientWidth / 2, rect.top + el.clientHeight / 2);
        setReaderStateSaveTick((n) => n + 1);
      }, 220);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      if (timer) clearTimeout(timer);
      el.removeEventListener("scroll", onScroll);
    };
  }, [captureZoomAnchor, pageViewport, pageNum, readingMode]);

  useEffect(() => {
    const sourceId = currentSourceIdRef.current;
    if (!sourceId) return undefined;
    const timer = setTimeout(() => {
      authFetch(apiUrl(`/api/source-annotations/${sourceId}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // Zoom and scroll changes only modify readerState. Avoid rebuilding
        // and serializing every annotation layer during high-frequency
        // viewport interaction.
        body: JSON.stringify({ readerState: buildReaderStatePayloadRef.current() }),
      }).catch(() => {});
    }, 900);
    return () => clearTimeout(timer);
  }, [pageNum, zoom, readingMode, bookletRightPage, searchOpen, searchQuery, notebookMode, notebookActiveTab, notebookText, notebookVoiceCommands, readerStateSaveTick, buildReaderStatePayload]);

  // buildAnnotationSavePayload is read through a ref, and this effect's own
  // deps are deliberately [] (mount/unmount only) — NOT [buildAnnotationSavePayload].
  // React runs a useEffect's cleanup on every re-run whose deps changed, not
  // only on true unmount; buildAnnotationSavePayload gets a new identity on
  // almost every annotation edit (it depends on annotationLayersForView,
  // which is rebuilt any time annotations/annotationLayers change), so
  // depending on it directly here fired this "only on tab-close" real,
  // non-debounced PUT on nearly every stroke — the runaway repeated PUT
  // calls seen in the server log while just drawing normally.
  const buildAnnotationSavePayloadRef = useRef(buildAnnotationSavePayload);
  buildAnnotationSavePayloadRef.current = buildAnnotationSavePayload;
  useEffect(() => {
    const persistReaderStateNow = () => {
      const sourceId = currentSourceIdRef.current;
      if (!sourceId) return;
      authFetch(apiUrl(`/api/source-annotations/${sourceId}`), {
        method: "PUT",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ readerState: buildReaderStatePayloadRef.current() }),
      }).catch(() => {});
    };
    window.addEventListener("pagehide", persistReaderStateNow);
    return () => {
      window.removeEventListener("pagehide", persistReaderStateNow);
      persistReaderStateNow();
    };
  }, []);

  useEffect(() => { extractModeRef.current = extractMode; }, [extractMode]);
  useEffect(() => { if (!textSelectable) { setManualPopup(null); setManualSelection(null); } }, [textSelectable]);

  const textSelectableRef = useRef(false);
  useEffect(() => { textSelectableRef.current = textSelectable; }, [textSelectable]);

  const onSelectionActionRef = useRef(onSelectionAction);
  useEffect(() => { onSelectionActionRef.current = onSelectionAction; }, [onSelectionAction]);

  // ── Render annotation canvas ───────────────────────────────────────────────
  // Keyed off pageViewport (not zoom directly): renderPage() re-rasterizes the
  // real page canvas asynchronously (it awaits pdfDoc.getPage() before touching
  // canvas.width/height), so reading pc.width/height synchronously on a zoom
  // change would copy the STALE pre-zoom raster size while drawing at the NEW
  // scale — mismatched forever, since nothing re-ran this effect afterward.
  // pageViewport is set by renderPage() at the exact moment it resizes the
  // current page's canvas, so waiting for it keeps the two canvases in sync.
  const paintCurrentAnnotationLayers = useCallback(() => {
    // While a stroke/shape is actively being dragged, the pointer-handling
    // effect's own redraw(ann) is already keeping the canvas correctly
    // updated every move tick, drawing the in-progress annotation straight
    // from activeAnnotRef (nothing committed to `annotations` yet). If this
    // authoritative repaint — which only knows about committed state, not
    // the in-progress one — runs mid-gesture for any unrelated reason (a
    // re-render triggered elsewhere in the tree), it clears the canvas and
    // redraws WITHOUT the live stroke, which reappears on the next move
    // tick — a rapid blink for as long as the drag lasts. Bailing out here
    // while a gesture is in progress leaves redraw() as the sole source of
    // truth until pointer-up, when the commit's own state change naturally
    // triggers a fresh (now-inclusive) authoritative repaint anyway.
    if (activeAnnotRef.current) return;
    const ac = annotCanvasRef.current;
    if (!ac || !pageViewport) return;
    // Backing buffer at the SAME device-pixel density (and safety cap) as
    // the page canvas underneath — see currentBackingScaleRef. Sizing this
    // 1:1 with CSS pixels (the old behaviour) made every stroke look soft
    // on any HiDPI screen, worst at low zoom where the buffer itself is
    // tiny; the CSS size (ac.style.width/height) still tracks the page
    // exactly, only the internal bitmap resolution changes here.
    const backingScale = currentBackingScaleRef.current || 1;
    ac.width  = Math.max(1, Math.floor(pageViewport.width * backingScale));
    ac.height = Math.max(1, Math.floor(pageViewport.height * backingScale));
    ac.style.width = `${pageViewport.width}px`;
    ac.style.height = `${pageViewport.height}px`;
    // Use the exact viewport that sized the PDF and overlay canvases. Re-
    // deriving this from fitScale/zoom can differ by a fractional amount;
    // that turns into a visible vertical drift farther down the page.
    const scale = pageViewport.scale || (fitScaleRef.current * zoom);
    const ctx = ac.getContext("2d");
    // Setting width/height above reset the transform to identity — redraw()
    // (in the pointer-handling effect below) relies on this same transform
    // staying in place for the rest of the gesture, since it never resizes
    // the canvas itself.
    ctx.setTransform(backingScale, 0, 0, backingScale, 0, 0);
    ctx.clearRect(0, 0, pageViewport.width, pageViewport.height);
    const pageAnnotations = visiblePageAnnotations;
    // One malformed annotation throwing here used to abort this whole loop
    // silently (a canvas 2D context call throwing mid-draw doesn't leave
    // any trace outside the console) — every annotation on the page went
    // invisible, including perfectly valid ones already drawn before it or
    // still queued after it, since ctx.clearRect above had already wiped
    // the canvas for this repaint. Isolating each draw call means one bad
    // annotation only drops itself, not the whole page's worth.
    for (const ann of pageAnnotations) {
      try {
        drawAnnotationWithOwnerClip(ctx, ann, scale, pageAnnotations);
      } catch (err) {
        console.error("Failed to draw annotation", ann, err);
      }
    }

    const mc = maskCanvasRef.current;
    if (mc) {
      mc.width  = ac.width;
      mc.height = ac.height;
      mc.style.width = ac.style.width;
      mc.style.height = ac.style.height;
      const maskCtx = mc.getContext("2d");
      maskCtx.setTransform(backingScale, 0, 0, backingScale, 0, 0);
      maskCtx.clearRect(0, 0, pageViewport.width, pageViewport.height);
      for (const ann of visiblePageAnnotations) {
        if (ann.type !== "highlight") continue;
        try {
          drawMaskedHighlightText(maskCtx, ann, scale);
        } catch (err) {
          console.error("Failed to draw masked highlight text", ann, err);
        }
      }
    }
  }, [drawAnnotationWithOwnerClip, pageViewport, visiblePageAnnotations, zoom]);

  useEffect(() => {
    paintCurrentAnnotationLayers();
  }, [paintCurrentAnnotationLayers]);

  // Resize previews are not committed to `annotations` until pointer-up, so
  // the normal annotation repaint cannot see them. Paint the transient
  // rectangle whenever its React state changes; this keeps the moved side
  // synchronized with the handle instead of waiting for a later click.
  useLayoutEffect(() => {
    const preview = bboxResizePreview;
    const ac = annotCanvasRef.current;
    if (!preview || !ac || !pageViewport) return;
    const saved = visiblePageAnnotations.find((annotation) => annotation.id === preview.id);
    if (!saved) return;
    const backingScale = currentBackingScaleRef.current || 1;
    const scale = pageViewport.scale || (fitScaleRef.current * zoom);
    const ctx = ac.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(backingScale, 0, 0, backingScale, 0, 0);
    ctx.clearRect(0, 0, pageViewport.width, pageViewport.height);
    for (const annotation of visiblePageAnnotations) {
      if (annotation.id === preview.id) continue;
      drawAnnotationWithOwnerClip(ctx, annotation, scale, visiblePageAnnotations);
    }
    drawAnnotationWithOwnerClip(ctx, {
      ...saved,
      ...preview,
      points: rectanglePointsFromBounds(preview),
      closed: true,
      geometry: "rectangle",
    }, scale, visiblePageAnnotations);
  }, [bboxResizePreview, drawAnnotationWithOwnerClip, pageViewport, visiblePageAnnotations, zoom]);

  // Single-page mode keys each page's container on its own page number (see
  // the .map(n => ...) render below), so navigating away and back mounts a
  // BRAND NEW <canvas> — freshly zero-sized, nothing drawn to it yet. The
  // effect above only repaints when annotations/pageNum/pageViewport
  // actually CHANGE; a page you're revisiting can come back with the exact
  // same pageViewport reference already cached (e.g. two pages sharing
  // identical dimensions), so that effect's deps never fire and the fresh
  // canvas stays blank. These ref callbacks paint unconditionally the
  // instant a canvas node actually mounts, independent of those deps.
  //
  // paintCurrentAnnotationLayersRef (rather than closing over
  // paintCurrentAnnotationLayers directly) is what keeps setAnnotCanvasNode/
  // setMaskCanvasNode themselves stable ([] deps) across renders. If they
  // depended on paintCurrentAnnotationLayers directly, their own identity
  // would change on every annotation added/erased (it's in that callback's
  // deps) — and since a *changed* ref-callback identity makes React detach
  // the old one and reattach the new one even though the underlying DOM
  // node never moved, drawing a single stroke would spuriously fire this
  // mount path on every commit. Reading through a ref sidesteps that: the
  // callback identity never changes, so React only ever calls it on a real
  // mount/unmount, and it still always runs the latest paint logic.
  const paintCurrentAnnotationLayersRef = useRef(paintCurrentAnnotationLayers);
  paintCurrentAnnotationLayersRef.current = paintCurrentAnnotationLayers;

  const setAnnotCanvasNode = useCallback((node) => {
    annotCanvasRef.current = node;
    if (!node) return;
    requestAnimationFrame(() => { paintCurrentAnnotationLayersRef.current(); });
  }, []);

  const setMaskCanvasNode = useCallback((node) => {
    maskCanvasRef.current = node;
    if (!node) return;
    requestAnimationFrame(() => { paintCurrentAnnotationLayersRef.current(); });
  }, []);

  // Fetches (and caches) a page's raw pdf.js text-content items — the same
  // data the "Manual mode" text-layer effect above turns into DOM word-
  // spans, just kept at the pdf.js item level here since search only needs
  // the item's own transform/width to draw a highlight rect, not per-word
  // sub-splitting. Cached per page number so re-searching or paging back
  // to an already-scanned page never re-fetches.
  const getPageTextItems = useCallback(async (n) => {
    if (pageTextItemsCacheRef.current[n]) return pageTextItemsCacheRef.current[n];
    const page = await pdfDoc.getPage(n);
    const content = await page.getTextContent();
    let items = content.items;
    // Scanned pages can have no native PDF.js text layer. In that case,
    // search the persisted OCR blocks and map their OCR-page rectangles into
    // PDF.js item geometry, so search still works without invoking OCR here.
    if (!items.some((item) => String(item.str || "").trim()) && currentSourceIdRef.current) {
      try {
        const response = await authFetch(apiUrl(`/api/sources/${currentSourceIdRef.current}/ocr/pages?page=${n}`));
        const data = await response.json();
        const ocrPage = data.pages?.[0];
        if (response.ok && ocrPage?.width > 0 && ocrPage?.height > 0) {
          const viewport = page.getViewport({ scale: 1 });
          const scaleX = viewport.width / ocrPage.width;
          const scaleY = viewport.height / ocrPage.height;
          items = (ocrPage.blocks || []).map((block) => {
            const box = block.bbox || {};
            const x = Number(box.x);
            const y = Number(box.y);
            const width = Number(box.width);
            const height = Number(box.height);
            const text = String(block.text || block.markdown || "").trim();
            if (!text || ![x, y, width, height].every(Number.isFinite)) return null;
            const renderedHeight = Math.max(1, height * scaleY);
            return {
              str: text,
              width: Math.max(1, width * scaleX),
              height: renderedHeight,
              transform: [renderedHeight, 0, 0, renderedHeight, x * scaleX, viewport.height - ((y + height) * scaleY)],
              hasEOL: true,
              fontName: "ocr-cache",
            };
          }).filter(Boolean);
        }
      } catch {
        // Keep the empty native item list while OCR is unavailable/pending.
      }
    }
    pageTextItemsCacheRef.current[n] = items;
    return items;
  }, [pdfDoc]);
  const buildRawRowsForBlankPage = useCallback(async () => {
    if (!pageNum || !pdfDoc) return { rows: [], pageWidth: 0, pageHeight: 0 };
    const [page, items] = await Promise.all([
      pdfDoc.getPage(pageNum),
      getPageTextItems(pageNum),
    ]);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent().catch(() => null);
    const styleMap = content?.styles || {};
    const viewportScale = Math.hypot(viewport.transform[0], viewport.transform[1]) || 1;
    const getTextMetadata = (item, text, matrix = null) => {
      const safeMatrix = Array.isArray(matrix) && matrix.length >= 6 ? matrix : [0, 0, 0, 0, 0, 0];
      const codePoints = Array.from(text)
        .map((character) => `U+${character.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`)
        .join(" ");
      return {
        direction: item?.dir || "ltr",
        eol: Boolean(item?.hasEOL),
        charCount: Array.from(text).length,
        whitespaceOnly: !text.trim(),
        codePoints,
        rotation: Math.atan2(safeMatrix[1], safeMatrix[0]) * (180 / Math.PI),
        scaleX: Math.hypot(safeMatrix[0], safeMatrix[1]),
        scaleY: Math.hypot(safeMatrix[2], safeMatrix[3]),
        matrixA: safeMatrix[0],
        matrixB: safeMatrix[1],
        matrixC: safeMatrix[2],
        matrixD: safeMatrix[3],
        matrixE: safeMatrix[4],
        matrixF: safeMatrix[5],
      };
    };
    const getFontMetadata = (item) => {
      const style = styleMap?.[item?.fontName] || {};
      let fontFamily = String(style.fontFamily || "").trim() || "unknown";
      let fontWeight = "normal";
      let fontStyle = "normal";
      try {
        if (item?.fontName && page.commonObjs?.has(item.fontName)) {
          const fontObj = page.commonObjs.get(item.fontName);
          fontFamily = String(fontObj?.fallbackName || fontFamily).trim() || "unknown";
          fontWeight = fontObj?.black ? "900" : fontObj?.bold ? "bold" : "normal";
          fontStyle = fontObj?.italic ? "italic" : "normal";
        }
      } catch {
        // PDF.js may not have resolved the embedded font object yet.
      }
      return {
        fontName: item?.fontName || "unknown",
        fontFamily,
        fontWeight,
        fontStyle,
      };
    };
    const rawRows = (Array.isArray(items) ? items : [])
      .map((item, index) => {
        const text = String(item?.str || "");
        if (!text) return null;
        const font = getFontMetadata(item);
        const textMetadata = getTextMetadata(item, text, item?.transform);
        const style = styleMap?.[item?.fontName] || {};
        const ascentRatio = Number.isFinite(style.ascent) ? style.ascent : 0.8;
        const descentRatio = Number.isFinite(style.descent) ? style.descent : -0.2;
        const transform = Array.isArray(item?.transform) ? item.transform : null;
        if (!transform || transform.length < 6) {
          const fallbackHeight = Math.max(1, Math.abs(Number(item?.height) || 12));
          const fallbackBaseline = index * fallbackHeight;
          return {
            id: `raw-item-${pageNum}-${index}`,
            key: "str",
            value: text,
            x: 0,
            y: fallbackBaseline - (fallbackHeight * ascentRatio),
            tx: 0,
            ty: fallbackBaseline,
            fontSize: fallbackHeight,
            width: Math.max(1, Number(item?.width) || 0),
            height: fallbackHeight,
            rawWidth: Number(item?.width) || 0,
            rawHeight: Number(item?.height) || fallbackHeight,
            top: fallbackBaseline - (fallbackHeight * ascentRatio),
            ascent: fallbackBaseline - (fallbackHeight * ascentRatio),
            baseline: fallbackBaseline,
            descent: fallbackBaseline - (fallbackHeight * descentRatio),
            bottom: fallbackBaseline - (fallbackHeight * descentRatio),
            ...font,
            ...textMetadata,
            fullMatrixA: 0,
            fullMatrixB: 0,
            fullMatrixC: 0,
            fullMatrixD: 0,
            fullMatrixE: 0,
            fullMatrixF: 0,
          };
        }
        const tx = pdfjsLib.Util.transform(viewport.transform, transform);
        const fontSize = Math.max(1, Math.hypot(tx[2], tx[3]));
        const itemWidth = Math.max(1, (Number(item?.width) || 0) * viewportScale);
        const originX = Number(tx[4]) || 0;
        const originY = Number(tx[5]) || 0;
        const itemX = originX / viewportScale;
        const itemY = (originY - (fontSize * ascentRatio)) / viewportScale;
        const itemHeight = fontSize / viewportScale;
        const baseline = originY / viewportScale;
        const descent = (originY - (fontSize * descentRatio)) / viewportScale;
        return {
          id: `raw-item-${pageNum}-${index}`,
          key: "str",
          value: text,
          x: itemX,
          y: itemY,
          tx: originX / viewportScale,
          ty: originY / viewportScale,
          fontSize: fontSize / viewportScale,
          width: itemWidth,
          height: itemHeight,
          rawWidth: Number(item?.width) || 0,
          rawHeight: Number(item?.height) || 0,
          top: itemY,
          ascent: itemY,
          baseline,
          descent,
          bottom: itemY + itemHeight,
          ...font,
          ...getTextMetadata(item, text, transform),
          fullMatrixA: tx[0],
          fullMatrixB: tx[1],
          fullMatrixC: tx[2],
          fullMatrixD: tx[3],
          fullMatrixE: tx[4],
          fullMatrixF: tx[5],
        };
      })
      .filter(Boolean)
      .map((row, index) => ({ ...row, instanceNumber: index + 1 }));
    if (!rawRows.length) {
      return {
        rows: [],
        pageWidth: viewport.width,
        pageHeight: viewport.height,
        viewportScale,
        pageRotation: Number(page.rotate) || 0,
        mediaBox: Array.isArray(page.view) ? page.view : [],
      };
    }
    const heights = rawRows
      .map((row) => row.height)
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    const medianHeight = heights[Math.floor(heights.length / 2)] || 0;
    return {
      rows: rawRows.map((row) => {
        const omissionBBoxIds = omissionBBoxes
          .filter((bbox) => isRectFullyContainedByBBox({ x: row.x, y: row.y, w: row.width, h: row.height }, bbox))
          .map((bbox) => bbox.id)
          .filter(Boolean);
        return {
          ...row,
          omitted: omissionBBoxIds.length > 0,
          omissionBBoxIds,
          classification: classifyPdfJsTextItem({
          value: row.value,
          x: row.x,
          y: row.y,
          width: row.width,
          height: row.height,
          pageWidth: viewport.width,
          pageHeight: viewport.height,
          medianHeight,
        }),
        };
      }),
      pageWidth: viewport.width,
      pageHeight: viewport.height,
      viewportScale,
      pageRotation: Number(page.rotate) || 0,
      mediaBox: Array.isArray(page.view) ? page.view : [],
    };
  }, [getPageTextItems, omissionBBoxes, pageNum, pdfDoc]);
  const buildVisualRawTextForBlankPage = useCallback(async () => {
    if (!pageNum || !pdfDoc) return "";
    const [page, items] = await Promise.all([
      pdfDoc.getPage(pageNum),
      getPageTextItems(pageNum),
    ]);
    const viewport = page.getViewport({ scale: 1 });
    const visualItems = (Array.isArray(items) ? items : [])
      .map((item, index) => {
        const text = String(item?.str || "");
        if (!text.trim()) return null;
        const transform = Array.isArray(item?.transform) ? item.transform : null;
        if (!transform || transform.length < 6) {
          return {
            index,
            text,
            x: 0,
            y: index * 12,
            width: Number(item?.width) || 0,
            height: Number(item?.height) || 12,
          };
        }
        const height = Math.max(1, Math.abs(Number(item?.height) || transform[3] || 12));
        const width = Math.max(1, Number(item?.width) || 0);
        return {
          index,
          text,
          x: Number(transform[4]) || 0,
          y: viewport.height - (Number(transform[5]) || 0) - height,
          width,
          height,
        };
      })
      .filter(Boolean);
    if (!visualItems.length) return "";

    visualItems.sort((a, b) => {
      const aMid = a.y + (a.height / 2);
      const bMid = b.y + (b.height / 2);
      const lineTolerance = Math.max(a.height, b.height) * 0.6;
      if (Math.abs(aMid - bMid) > lineTolerance) return aMid - bMid;
      if (Math.abs(a.x - b.x) > 0.5) return a.x - b.x;
      return a.index - b.index;
    });

    const lines = [];
    visualItems.forEach((item) => {
      const itemMid = item.y + (item.height / 2);
      const targetLine = lines.find((line) => Math.abs(line.midY - itemMid) <= Math.max(line.avgHeight, item.height) * 0.65);
      if (targetLine) {
        targetLine.items.push(item);
        targetLine.midY = ((targetLine.midY * (targetLine.items.length - 1)) + itemMid) / targetLine.items.length;
        targetLine.avgHeight = ((targetLine.avgHeight * (targetLine.items.length - 1)) + item.height) / targetLine.items.length;
      } else {
        lines.push({
          midY: itemMid,
          avgHeight: item.height,
          items: [item],
        });
      }
    });

    return lines
      .sort((a, b) => a.midY - b.midY)
      .map((line) => line.items
        .sort((a, b) => a.x - b.x || a.index - b.index)
        .map((item, index, arr) => {
          const next = arr[index + 1];
          const currentText = item.text;
          if (!next) return currentText;
          const currentRight = item.x + item.width;
          const gap = next.x - currentRight;
          const spaceThreshold = Math.max(item.height * 0.18, 2);
          const needsSpace = gap > spaceThreshold && !/\s$/.test(currentText) && !/^\s/.test(next.text);
          return `${currentText}${needsSpace ? " " : ""}`;
        })
        .join(""))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }, [getPageTextItems, pageNum, pdfDoc]);

  // Scans every page's text for the query, debounced so fast typing doesn't
  // re-scan on every keystroke. Runs sequentially page-by-page (cheap after
  // the first pass, since getPageTextItems caches) rather than in parallel,
  // so an in-flight scan can be cleanly superseded (searchRunIdRef) the
  // instant the query changes again instead of racing a stale one to
  // completion and overwriting fresher results.
  useEffect(() => {
    if (!searchOpen || !pdfDoc || !pageCount || !searchQuery.trim()) {
      setSearchMatches([]);
      setSearchActiveIndex(-1);
      setSearchScanning(false);
      return;
    }
    const runId = ++searchRunIdRef.current;
    const timer = setTimeout(async () => {
      setSearchScanning(true);
      // Tolerant multi-stage search (pdfTextNormalizer/pdfSearchIndex/
      // pdfFuzzySearch) — normalize the query once, then per page: build
      // (or reuse the cached) page index and try exact -> case-insensitive
      // -> compact/whitespace-and-hyphen-insensitive -> scientific-alias ->
      // token-aware -> fuzzy, safest first. Every result already carries
      // its exact originalText range mapped back through those stages, so
      // this still resolves to the same {page, itemIndexes, itemRanges}
      // shape the highlight-drawing effect below expects, plus matchType/
      // confidence for the "Likely match" indicator in the search bar
      // (spec: search the normalized/compact representation, but always
      // highlight the untouched original PDF text). itemIndexes is every
      // PDF.js item behind the match, NOT necessarily numerically
      // contiguous — the search index is now built in true reading order
      // (pdfPageLayout.js), so a multi-column page's item stream order can
      // differ from reading order; see originalRangeToItemIndexes's own
      // comment. itemRanges is that same function's per-item
      // [localStart, localEnd) match offset, used to draw a highlight rect
      // over just the matched substring of an item rather than its whole
      // width.
      const queryRepr = normalizeQuery(searchQuery);
      const results = [];
      for (let n = 1; n <= pageCount; n++) {
        if (searchRunIdRef.current !== runId) return; // superseded by a newer search
        let items;
        try { items = await getPageTextItems(n); } catch { continue; }
        const pageIndex = pageIndexCacheRef.current.get(n, items);
        const pageResults = searchPageForQuery(pageIndex, queryRepr, { fuzzy: true });
        for (const r of pageResults) {
          if (!r.itemIndexes?.length) continue;
          results.push({
            page: n,
            itemIndexes: r.itemIndexes,
            itemRanges: r.itemRanges,
            matchType: r.matchType,
            confidence: r.confidence,
            originalMatchedText: r.originalMatchedText,
          });
        }
      }
      if (searchRunIdRef.current !== runId) return;
      setSearchMatches(results);
      setSearchActiveIndex(results.length ? 0 : -1);
      setSearchScanning(false);
      if (results.length) setPageNum(results[0].page);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchQuery, searchOpen, pdfDoc, pageCount, getPageTextItems]);

  const goToSearchMatch = useCallback((delta) => {
    setSearchActiveIndex((prev) => {
      if (!searchMatches.length) return prev;
      const next = ((prev + delta) % searchMatches.length + searchMatches.length) % searchMatches.length;
      const m = searchMatches[next];
      if (m.page !== pageNumRef.current) setPageNum(m.page);
      return next;
    });
  }, [searchMatches]);

  // Draws highlight rects for every match on the CURRENT page (the active
  // one in a stronger color, matching browser Ctrl+F conventions) — sized/
  // positioned the same way the Manual-mode text layer above computes a
  // text item's on-screen box (viewport.transform × item.transform), but
  // clipped to just the matched substring's own share of each item's
  // width (m.itemRanges) rather than the item's full line, so e.g.
  // searching "heart" inside a paragraph highlights only "heart", not the
  // whole sentence it sits in.
  useEffect(() => {
    const canvas = searchCanvasRef.current;
    if (!canvas || !pageViewport) return;
    const backingScale = currentBackingScaleRef.current || 1;
    canvas.width  = Math.max(1, Math.floor(pageViewport.width * backingScale));
    canvas.height = Math.max(1, Math.floor(pageViewport.height * backingScale));
    canvas.style.width  = `${pageViewport.width}px`;
    canvas.style.height = `${pageViewport.height}px`;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(backingScale, 0, 0, backingScale, 0, 0);
    ctx.clearRect(0, 0, pageViewport.width, pageViewport.height);
    if (!searchOpen || !searchMatches.length) return;

    const items = pageTextItemsCacheRef.current[pageNum];
    if (!items) return;
    const vt = pageViewport.transform;
    searchMatches.forEach((m, idx) => {
      if (m.page !== pageNum) return;
      const isActive = idx === searchActiveIndex;
      // Fuzzy/token matches are real but approximate — a lighter fill
      // keeps them visually distinct from exact/case/compact hits without
      // hiding them, matching the "show what was likely found" framing in
      // the search bar's confidence indicator.
      const isTentative = m.matchType === "fuzzy" || m.matchType === "token";
      ctx.fillStyle = isActive
        ? "rgba(255,140,0,0.55)"
        : isTentative ? "rgba(255,235,59,0.28)" : "rgba(255,235,59,0.45)";
      // Every PDF.js item actually behind the match, not a numeric
      // itemIndex..itemIndexEnd range — reading-order reconstruction
      // (pdfPageLayout.js) means those aren't guaranteed contiguous for a
      // multi-column page, so looping a min..max range could draw the
      // wrong items (or skip real ones) for a match that crosses a
      // reading-order reordering. See originalRangeToItemIndexes.
      for (const rect of computeHighlightRectsForItemIndexes(m.itemIndexes, items, vt, m.itemRanges)) {
        ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      }
    });
  }, [searchOpen, searchMatches, searchActiveIndex, pageNum, pageViewport]);

  // Computes the active AMCTOSHS Hyle layer's data (pdfHyleStats.js, pure/
  // client-side) for the current page and, for Segmented Hyle only, draws
  // its overlay boxes on the dedicated #pdf_hyle_canvas — same canvas-
  // sizing convention as the search/Narrative-Mode overlays above. Raw
  // Hyle draws NOTHING: it's the page's raw substrate before any form is
  // imposed, so — faithful to that — selecting it never changes how the
  // page itself looks; data is still computed (for whatever reads it),
  // just never painted. Segmented Hyle's bboxes come back already in
  // viewport-space (buildSegmentedHyle was given pageViewport.transform),
  // so they're drawn directly with no per-item rect lookup, unlike the
  // item-index-based overlays elsewhere. Boxes only, no text labels here —
  // per-line detail is shown on demand via a clickable numbered marker (a
  // DOM layer, not canvas — see hyleIconPositions and
  // #pdf_hyle_icons_layer below), not drawn unconditionally over the
  // page's own text.
  useEffect(() => {
    const canvas = hyleCanvasRef.current;
    if (!canvas || !pageViewport) return;
    const backingScale = currentBackingScaleRef.current || 1;
    canvas.width  = Math.max(1, Math.floor(pageViewport.width * backingScale));
    canvas.height = Math.max(1, Math.floor(pageViewport.height * backingScale));
    canvas.style.width  = `${pageViewport.width}px`;
    canvas.style.height = `${pageViewport.height}px`;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(backingScale, 0, 0, backingScale, 0, 0);
    ctx.clearRect(0, 0, pageViewport.width, pageViewport.height);

    const runId = ++hyleRunIdRef.current;
    const vt = pageViewport.transform;
    getPageTextItems(pageNum).then((items) => {
      if (!items || hyleRunIdRef.current !== runId) return;

      if (hyleMode === "raw") {
        setHyleLayerData({ mode: "raw", pageNum, ...buildRawHyle(items) });
        return; // no drawing — the page stays exactly as-is at this layer
      }

      // hyleMode === "segmented"
      const segmented = buildSegmentedHyle(items, vt);
      setHyleLayerData({ mode: "segmented", pageNum, ...segmented });

      // Deliberately line-level only — no paragraph/article grouping
      // container of any kind (an earlier version drew nested "article"
      // and "paragraph" tiers around groups of lines; removed at the
      // user's explicit request — "delete all logic of grouping lines in
      // containers" — after that grouping repeatedly misgrouped real
      // content). Each line stands alone as its own container.
      //
      // One vertical separator per detected column gutter (see
      // buildSegmentedHyle's own comment on columnGutterXs) — drawn
      // FIRST so the line boxes paint on top of it, spanning the full
      // page height rather than just the content extent, since a gutter
      // is a page-wide structural feature, not tied to any one line.
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(38,198,218,0.7)"; // cyan — matches the AMCTOSHS Morphe accent elsewhere in the app, distinct from the line boxes below
      for (const gx of segmented.columnGutterXs || []) {
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, pageViewport.height);
        ctx.stroke();
      }

      ctx.setLineDash([]);
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = "rgba(126,87,194,0.8)"; // matches Molecules' domain accent elsewhere in the app
      for (const seg of segmented.segments) {
        const { x, y, width, height } = seg.bbox;
        if (width <= 0 || height <= 0) continue;
        ctx.strokeRect(x, y, width, height);
      }
    }).catch(() => {});
  }, [pageViewport, pageNum, hyleMode, getPageTextItems]);

  // Where to place each line's numbered marker (a real DOM button, not
  // canvas — needs to be clickable/focusable). EVERY line gets one, no
  // exceptions, ALWAYS at the right end of its own line's own container
  // (see computeMarkerPosition — no per-line above/below/fallback
  // branching anymore, a numbered marker needs a predictable, scannable
  // position from one line to the next, unlike an unlabeled dot).
  // Recomputed whenever the segmented data itself changes; not tied to
  // the draw effect above since it doesn't touch the canvas.
  //
  // The marker is part of the line's own container, not a separate
  // floating badge beside it: a SQUARE (1:1) exactly as tall as that
  // line's own box, flush against its right edge (gap 0) — so it reads
  // as an extension of the container itself rather than an annotation
  // hovering next to it. Each line's own box.height already scales with
  // zoom (it comes straight from the SAME display-space bbox the line's
  // own outline is drawn from), so sizing the marker off it is
  // automatically zoom-proportional with no separate floor/gap constant
  // to keep in sync — unlike the old shared fixed-size+gap marker, which
  // needed its own scale-derived numbers kept perfectly aligned with the
  // placement math to avoid the zoom-jitter bugs described in this
  // module's git history.
  const hyleIconPositions = useMemo(() => {
    if (hyleMode !== "segmented" || !hyleLayerData || hyleLayerData.mode !== "segmented" || !pageViewport) return [];
    const boxes = hyleLayerData.segments.map((s) => s.bbox);
    const positions = [];
    boxes.forEach((box, i) => {
      const pos = computeMarkerPosition(i, boxes, pageViewport.width, box.height, 0);
      if (pos) positions.push({ index: i, size: box.height, ...pos });
    });
    return positions;
  }, [hyleMode, hyleLayerData, pageViewport]);

  // Which line's detail popover is open (index into hyleLayerData.segments,
  // or null) — one at a time, toggled by clicking its info icon.
  const [hyleActiveSegment, setHyleActiveSegment] = useState(null);
  useEffect(() => { setHyleActiveSegment(null); }, [hyleMode, pageNum]);

  // Dismiss the Hyle mode dropup when clicking outside it.
  useEffect(() => {
    if (!hyleFabOpen) return;
    const handler = (e) => {
      if (hyleFabRef.current && !hyleFabRef.current.contains(e.target)) setHyleFabOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler, { passive: true });
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [hyleFabOpen]);

  // Dismiss the open line-detail popover when clicking outside the icons
  // layer (which also contains the popover itself).
  useEffect(() => {
    if (hyleActiveSegment === null) return;
    const handler = (e) => {
      if (hyleIconsLayerRef.current && !hyleIconsLayerRef.current.contains(e.target)) setHyleActiveSegment(null);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler, { passive: true });
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [hyleActiveSegment]);

  // Screenshot capture for the "smartVideo" tool — drag a rectangle on the
  // page (handled in the annotation-drawing effect's smartVideoCapture
  // branch below), crop it out of the rendered page canvas for the preview,
  // then read the matching text from the persisted OCR already saved
  // for that page. This keeps Smart Video on the same OCR source of truth
  // and avoids re-running another OCR engine on the crop.
  // Declared here (before the annotation-drawing effect below, which
  // references it in its dependency array) rather than near the other
  // Smart Video handlers further down — that array is evaluated as part of
  // the useEffect() call itself, at this point in render order, so a
  // forward reference to a later-declared const would throw a TDZ
  // ReferenceError ("Cannot access before initialization").
  const captureSmartVideoScreenshot = useCallback(async (selection) => {
    const pageCanvas = canvasRef.current;
    const viewport = pageViewportsRef.current[pageNum - 1] || pageViewport;
    if (!pageCanvas || !viewport) return;

    const scale = fitScaleRef.current * zoomRef.current;
    const pageCssWidth = Math.max(1, viewport.width);
    const pageCssHeight = Math.max(1, viewport.height);
    const pageScaleX = pageCanvas.width / pageCssWidth;
    const pageScaleY = pageCanvas.height / pageCssHeight;
    const cropLeftCss = clamp(selection.x * scale, 0, pageCssWidth);
    const cropTopCss = clamp(selection.y * scale, 0, pageCssHeight);
    const cropWidthCss = clamp(selection.w * scale, 1, pageCssWidth - cropLeftCss);
    const cropHeightCss = clamp(selection.h * scale, 1, pageCssHeight - cropTopCss);
    if (cropWidthCss < 12 || cropHeightCss < 12) return;

    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = Math.max(1, Math.round(cropWidthCss * pageScaleX));
    cropCanvas.height = Math.max(1, Math.round(cropHeightCss * pageScaleY));
    const cropCtx = cropCanvas.getContext("2d", { willReadFrequently: true });
    cropCtx.fillStyle = "#ffffff";
    cropCtx.fillRect(0, 0, cropCanvas.width, cropCanvas.height);
    cropCtx.drawImage(
      pageCanvas,
      cropLeftCss * pageScaleX, cropTopCss * pageScaleY, cropWidthCss * pageScaleX, cropHeightCss * pageScaleY,
      0, 0, cropCanvas.width, cropCanvas.height,
    );

    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const dataUrl = cropCanvas.toDataURL("image/jpeg", 0.82);
    setSmartVideoScreenshots((prev) => [...prev, { id, dataUrl, text: "", pageNum, status: "reading" }]);
    setSmartVideoCaptureBusy(true);
    try {
      const recognizedText = await getPersistedOcrTextForSelection(selection, pageNum);
      setSmartVideoScreenshots((prev) => prev.map((s) => (
        s.id === id ? { ...s, text: recognizedText, status: recognizedText ? "done" : "empty" } : s
      )));
    } catch (err) {
      console.error(err);
      setSmartVideoScreenshots((prev) => prev.map((s) => (s.id === id ? { ...s, status: "error" } : s)));
    } finally {
      setSmartVideoCaptureBusy(false);
    }
  }, [getPersistedOcrTextForSelection, pageNum, pageViewport]);

  const captureImageBBoxSnippet = useCallback((selection) => {
    const pageCanvas = canvasRef.current;
    const viewport = pageViewportsRef.current[pageNum - 1] || pageViewport;
    if (!pageCanvas || !viewport || !selection) return null;

    // Both the freeform points and selection bounds are stored in unscaled
    // PDF-page space. Convert them to normalized page ratios before touching
    // the raster canvas; applying the current zoom here a second time made
    // image crops valid only at a narrow set of zoom levels.
    const { width: pageDocWidth, height: pageDocHeight } = getViewportDocumentSize(viewport);
    const leftRatio = clamp(selection.x / pageDocWidth, 0, 1);
    const topRatio = clamp(selection.y / pageDocHeight, 0, 1);
    const rightRatio = clamp((selection.x + selection.w) / pageDocWidth, leftRatio, 1);
    const bottomRatio = clamp((selection.y + selection.h) / pageDocHeight, topRatio, 1);
    const cropLeft = leftRatio * pageCanvas.width;
    const cropTop = topRatio * pageCanvas.height;
    const cropWidth = (rightRatio - leftRatio) * pageCanvas.width;
    const cropHeight = (bottomRatio - topRatio) * pageCanvas.height;
    if (cropWidth < 1 || cropHeight < 1) return null;

    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = Math.max(1, Math.round(cropWidth));
    cropCanvas.height = Math.max(1, Math.round(cropHeight));
    const cropCtx = cropCanvas.getContext("2d", { willReadFrequently: true });
    if (!cropCtx) return null;
    cropCtx.fillStyle = "#ffffff";
    cropCtx.fillRect(0, 0, cropCanvas.width, cropCanvas.height);
    cropCtx.drawImage(
      pageCanvas,
      cropLeft,
      cropTop,
      cropWidth,
      cropHeight,
      0,
      0,
      cropCanvas.width,
      cropCanvas.height,
    );
    return {
      dataUrl: cropCanvas.toDataURL("image/jpeg", 0.82),
      width: cropCanvas.width,
      height: cropCanvas.height,
    };
  }, [pageNum, pageViewport]);

  const removeSmartVideoScreenshot = useCallback((id) => {
    setSmartVideoScreenshots((prev) => prev.filter((s) => s.id !== id));
  }, []);
  const clearSmartVideoScreenshots = useCallback(() => setSmartVideoScreenshots([]), []);

  // ── Annotation drawing events ──────────────────────────────────────────────
  useEffect(() => {
    const ac = annotCanvasRef.current;
    if (!ac || !toolActive) return;

    // Returns coordinates in PDF-point space (CSS pixels ÷ scale). Note this
    // is deliberately independent of the annotation canvas's backing-buffer
    // resolution (ac.width/height, which now runs at device-pixel density —
    // see currentBackingScaleRef) — `scale` (fitScale*zoom) was calibrated
    // against CSS pixels, so multiplying by a device-pixel-buffer ratio here
    // would inflate every stroke's stored position by that same ratio.
    // Always use the live fit*zoom value for pointer/doc conversion so
    // creation math stays aligned with the actually displayed page even
    // while PDF.js is still catching up after a zoom change.
    const getScale = () => fitScaleRef.current * zoomRef.current;
    const toCanvas = (e) => {
      const rect  = ac.getBoundingClientRect();
      const scale = getScale();
      const cx    = e.touches ? e.touches[0].clientX : e.clientX;
      const cy    = e.touches ? e.touches[0].clientY : e.clientY;
      const pressure = typeof e.pressure === "number"
        ? e.pressure
        : typeof e.touches?.[0]?.force === "number"
          ? e.touches[0].force
          : 0.5;
      return {
        x: (cx - rect.left) / scale,
        y: (cy - rect.top) / scale,
        vx: cx,
        vy: cy,
        t: typeof e.timeStamp === "number" ? e.timeStamp : performance.now(),
        pressure: Math.min(1, Math.max(0, pressure || 0.5)),
      };
    };

    // Figure BBox gestures use page-relative ratios instead of the reader's
    // zoom value. This keeps pointer mapping valid while a zoom render is in
    // flight and at fractional/odd zoom percentages where CSS pixel sizes
    // are not exact multiples of PDF points.
    const toBBoxPagePoint = (e) => {
      const rect = ac.getBoundingClientRect();
      const viewport = pageViewportsRef.current[pageNum - 1] || pageViewport;
      const cx = e.touches ? e.touches[0].clientX : e.clientX;
      const cy = e.touches ? e.touches[0].clientY : e.clientY;
      const pressure = typeof e.pressure === "number"
        ? e.pressure
        : typeof e.touches?.[0]?.force === "number"
          ? e.touches[0].force
          : 0.5;
      return clientPointToBBoxPagePoint({
        clientX: cx,
        clientY: cy,
        rect,
        viewport,
        time: typeof e.timeStamp === "number" ? e.timeStamp : performance.now(),
        pressure,
      });
    };

    const findHighlightSpanAt = (clientX, clientY) => {
      // Live-measured (getBoundingClientRect), not stored left/top/width/
      // height fields — since word spans now lay out via normal inline
      // text flow (see the text-layer build effect), their real position
      // only exists on the live DOM, not as a precomputed number.
      const found = spansRef.current.find((span) => {
        const r = span.el?.getBoundingClientRect();
        if (!r) return false;
        return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
      });
      if (!found) return null;
      const canvasRect = ac.getBoundingClientRect();
      const scale = getScale();
      const r = found.el.getBoundingClientRect();
      return {
        left: (r.left - canvasRect.left) / scale,
        top: (r.top - canvasRect.top) / scale,
        width: r.width / scale,
        height: r.height / scale,
      };
    };

    // Y-band only (no X requirement at all) — a text line is "present"
    // for its FULL width, page edge to page edge, not just the tight
    // glyph boxes of the words sitting on it. findHighlightSpanAt's
    // exact per-word bbox is too strict for the "can I start drawing
    // here" gate: a click landing a pixel outside a word's box (very
    // common when aiming right at a word's leading edge, to grab its
    // first letter) used to be rejected as "not on text" even though
    // the row obviously has text on it.
    const findTextRowAt = (clientY) => {
      let best = null;
      let bestDist = Infinity;
      for (const span of spansRef.current) {
        const r = span.el?.getBoundingClientRect();
        if (!r || r.height <= 0) continue;
        if (clientY < r.top || clientY > r.bottom) continue;
        const dist = Math.abs(clientY - (r.top + r.height / 2));
        if (dist < bestDist) { bestDist = dist; best = r; }
      }
      if (!best) return null;
      const canvasRect = ac.getBoundingClientRect();
      const scale = getScale();
      return {
        top: (best.top - canvasRect.top) / scale,
        height: best.height / scale,
      };
    };

    // Word-snap lookup used where an exact word box is still needed
    // (underline/strikethrough, Auto Width's width lock) — tries the
    // exact tight-bbox hit first, and if that misses, falls back to
    // whichever word on the SAME row sits horizontally closest to the
    // pointer, so a click just short of a word's left edge still snaps
    // to that word (its first letter included) instead of finding
    // nothing.
    const findNearestSpanOnRow = (clientX, clientY) => {
      const exact = findHighlightSpanAt(clientX, clientY);
      if (exact) return exact;
      let rowCenterY = null;
      let rowDist = Infinity;
      for (const span of spansRef.current) {
        const r = span.el?.getBoundingClientRect();
        if (!r || r.height <= 0) continue;
        if (clientY < r.top || clientY > r.bottom) continue;
        const centerY = r.top + r.height / 2;
        const dist = Math.abs(clientY - centerY);
        if (dist < rowDist) { rowDist = dist; rowCenterY = centerY; }
      }
      if (rowCenterY == null) return null;
      let nearest = null;
      let nearestDist = Infinity;
      for (const span of spansRef.current) {
        const r = span.el?.getBoundingClientRect();
        if (!r || r.height <= 0) continue;
        const centerY = r.top + r.height / 2;
        if (Math.abs(centerY - rowCenterY) > r.height * 0.5) continue;
        const dist = clientX < r.left ? r.left - clientX : clientX > r.right ? clientX - r.right : 0;
        if (dist < nearestDist) { nearestDist = dist; nearest = r; }
      }
      if (!nearest) return null;
      const canvasRect = ac.getBoundingClientRect();
      const scale = getScale();
      return {
        left: (nearest.left - canvasRect.left) / scale,
        top: (nearest.top - canvasRect.top) / scale,
        width: nearest.width / scale,
        height: nearest.height / scale,
      };
    };

    // Every text-layer word span whose box overlaps a just-drawn
    // highlight's own bounding box (padded by half its line width) — used
    // to bake a masked/recolored text overlay onto the highlight so the
    // original PDF glyphs (whatever color they happen to be) don't fight
    // the highlight color for contrast. Bbox overlap, not exact stroke-path
    // distance — fine for "line" mode (near-exact) and close enough for
    // "freehand" (drawn tightly over the intended text in practice).
    // Returns canvas-space (PDF-point) geometry, matching ann.points'
    // own storage convention, computed once at commit time while the live
    // spans still exist (they don't for off-screen/unrendered pages).
    const findSpansOverlappingHighlight = (points) => {
      if (!points || !points.length) return [];
      const canvasRect = ac.getBoundingClientRect();
      const scale = getScale();
      // No horizontal padding at all — the highlight's own x-range must
      // actually intersect a word's box. Padding by the stroke's lineWidth
      // (previous version) was generous enough to reach into whichever
      // word sat immediately before/after the intended range, even though
      // the ink itself never got there — reported as "two extra words
      // highlighted, one before and one after the preview." Vertical
      // tolerance is based on each span's own height (half of it), not
      // lineWidth — keeps same-line words in "line" mode (whose Y is
      // locked to a detected span's center, see getTextAlignedHighlightPoint)
      // while still excluding adjacent lines a full line-height away.
      const minX = Math.min(...points.map((pt) => pt.x));
      const maxX = Math.max(...points.map((pt) => pt.x));
      const minY = Math.min(...points.map((pt) => pt.y));
      const maxY = Math.max(...points.map((pt) => pt.y));
      const results = [];
      for (const span of spansRef.current) {
        if (!span.text || !span.text.trim()) continue;
        const r = span.el?.getBoundingClientRect();
        if (!r) continue;
        const left = (r.left - canvasRect.left) / scale;
        const top = (r.top - canvasRect.top) / scale;
        const width = r.width / scale;
        const height = r.height / scale;
        if (left + width <= minX || left >= maxX) continue;
        const spanCenterY = top + height / 2;
        const verticalTolerance = height * 0.5;
        if (spanCenterY < minY - verticalTolerance || spanCenterY > maxY + verticalTolerance) continue;
        results.push({
          text: span.text,
          x: left,
          y: top,
          width,
          height,
          fontSize: (parseFloat(span.el.style.fontSize) || height) / scale,
          fontFamily: span.fontFamily || "sans-serif",
          fontWeight: span.fontWeight || "normal",
          fontStyle: span.fontStyle || "normal",
        });
      }
      return results;
    };

    const getTextAlignedHighlightPoint = (e, lockedY = null) => {
      const basePoint = toCanvas(e);
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const row = findTextRowAt(clientY);
      if (!row) {
        return lockedY == null
          ? { ...basePoint, lineWidth: null, textAligned: false }
          : { ...basePoint, y: lockedY, lineWidth: null, textAligned: false };
      }

      const centerY = row.top + row.height / 2;
      const textHeight = Math.max(8, row.height * 0.82);
      return {
        ...basePoint,
        y: lockedY ?? centerY,
        lineWidth: textHeight,
        textAligned: true,
      };
    };

    const getTextAlignedHighlightRange = (e) => {
      const alignedPoint = getTextAlignedHighlightPoint(e);
      if (!alignedPoint.textAligned) return null;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const span = findNearestSpanOnRow(clientX, clientY);
      if (!span) return null;
      return {
        ...alignedPoint,
        startX: span.left,
        endX: span.left + Math.max(1, span.width || 0),
      };
    };

    const redraw = (extra, annotationsOverride = visiblePageAnnotations) => {
      const scale = getScale();
      const ctx = ac.getContext("2d");
      // clientWidth/Height (CSS pixels), not ac.width/height (the device-
      // pixel backing buffer) — the sizing effect above already left this
      // context's transform scaled up to match that buffer, so clearRect
      // here needs to stay in the same post-transform CSS-pixel space
      // everything else in this function draws in.
      ctx.clearRect(0, 0, ac.clientWidth, ac.clientHeight);
      const pageAnnotations = annotationsOverride;
      for (const ann of pageAnnotations) drawAnnotationWithOwnerClip(ctx, ann, scale, pageAnnotations);
      if (extra) drawAnnotationWithOwnerClip(ctx, extra, scale, pageAnnotations);

      const mc = maskCanvasRef.current;
      if (mc) {
        const maskCtx = mc.getContext("2d");
        maskCtx.clearRect(0, 0, mc.clientWidth, mc.clientHeight);
        for (const annotation of pageAnnotations) {
          if (annotation.type === "highlight") drawMaskedHighlightText(maskCtx, annotation, scale);
        }
        if (extra?.type === "highlight") drawMaskedHighlightText(maskCtx, extra, scale);
      }
      syncLiveBBoxPreview(extra);
    };

    const eraseAtPoint = (ann, point) => {
      const eraserRadius = eraserSize / getScale();
      const previousPoint = ann.lastErasePoint;
      const distance = previousPoint
        ? Math.hypot(point.x - previousPoint.x, point.y - previousPoint.y)
        : 0;
      const sampleSpacing = Math.max(0.5 / getScale(), eraserRadius * 0.4);
      const sampleCount = Math.max(1, Math.ceil(distance / sampleSpacing));
      let workingAnnotations = ann.lastKept || ann.eraseSnapshot || [];

      // Fill the path between browser pointer events so a fast stylus sweep
      // cannot jump over a thin annotation between two sampled positions.
      for (let index = 1; index <= sampleCount; index += 1) {
        const ratio = index / sampleCount;
        const sampleX = previousPoint
          ? previousPoint.x + (point.x - previousPoint.x) * ratio
          : point.x;
        const sampleY = previousPoint
          ? previousPoint.y + (point.y - previousPoint.y) * ratio
          : point.y;
        const result = eraseAnnotationsAtPoint(
          workingAnnotations,
          sampleX,
          sampleY,
          eraserRadius,
          eraserMode,
        );
        workingAnnotations = result.kept;
        ann.erasedCount = (ann.erasedCount || 0) + result.erasedCount;
        ann.changed = Boolean(ann.changed || result.changed);
      }

      ann.lastErasePoint = { x: point.x, y: point.y };
      ann.lastKept = workingAnnotations;
      redraw(null, workingAnnotations);
    };

    const clearLiveBBoxPreview = () => {
      const layer = textLayerRef.current;
      if (!layer) return;
      layer.querySelectorAll(".bbox_preview_highlight").forEach((el) => el.remove());
      spansRef.current.forEach(({ el }) => el?.classList?.remove("bbox_preview_span_selected"));
    };

    const syncLiveBBoxPreview = (ann = null) => {
      const layer = textLayerRef.current;
      if (!layer) return;
      clearLiveBBoxPreview();
      if (!ann || !isBBoxType(ann.type) || bboxTypeHas(ann.type, "capturesImage")) return;
      const previewBox = Array.isArray(ann.points) && ann.points.length >= 2
        ? pointsToBounds(ann.points)
        : { x: ann.x, y: ann.y, w: ann.w, h: ann.h };
      if (!previewBox || previewBox.w < 4 || previewBox.h < 4) return;

      // Runtime selection should be responsive to partial overlap while the
      // rectangle is still being drawn. The stricter matcher remains used
      // for committed extraction; creation matching is intentionally more
      // forgiving for a moving selection boundary.
      const matchedSpans = spansRef.current.filter((span) => span?.el && bboxCreationMatchesSpan(previewBox, span));
      if (!matchedSpans.length) return;
      matchedSpans.forEach((span) => span.el.classList.add("bbox_preview_span_selected"));
    };

    const preventNativeTouchDrawingGesture = (e) => {
      if (e.cancelable && (e.touches || e.pointerType === "pen" || e.type === "contextmenu")) e.preventDefault();
      if (annotTool === "highlight") {
        window.getSelection?.()?.removeAllRanges();
        setManualSelection(null);
        setManualPopup(null);
      }
    };

    const onDown = (e) => {
      preventNativeTouchDrawingGesture(e);
      if (e.touches && e.touches.length >= 2) {
        activeAnnotRef.current = null; // cancel any in-progress stroke
        setSmartPenMorphePreview(null);
        return;
      }
      if (annotTool === "text") {
        const p = toCanvas(e);
        const hit = findTextAnnotationAt(p.x, p.y);
        if (hit) {
          const scale = fitScaleRef.current * zoomRef.current;
          const box = getTextAnnotationBounds(hit, scale);
          primeTextStyleFromAnnotation(hit);
          setTextActionMenu({
            vx: annotCanvasRef.current.getBoundingClientRect().left + box.left,
            vy: annotCanvasRef.current.getBoundingClientRect().top + box.top,
            editingId: hit.id,
          });
          setAnnotTextInput(null);
          return;
        }
        // An in-progress, unconfirmed box with real typed text stays put
        // on a stray click elsewhere — this used to unconditionally
        // overwrite annotTextInput/annotTextVal with a fresh blank box at
        // the new click point, silently discarding whatever was typed.
        // Only an empty draft (nothing worth keeping) gets replaced this
        // way; a non-empty one waits for its own Confirm/Cancel/Enter/Escape.
        if (annotTextInput && annotTextVal.trim()) return;
        setTextActionMenu(null);
        setTextStyleTargetId(null);
        // cx/cy must match openTextEditorForHit's convention (canvas-space
        // × scale) since commitAnnotText divides them by scale once to get
        // the final stored position — p.x/p.y from toCanvas are already
        // canvas-space, so storing them raw here double-divided on commit
        // and made the saved text jump toward the canvas origin.
        setAnnotTextInput({ vx: p.vx, vy: p.vy, cx: p.x * getScale(), cy: p.y * getScale(), width: undefined, editingId: null });
        setAnnotTextVal("");
        return;
      }
      const p = toCanvas(e);
      setSmartPenMorphePreview(null);
      const strokeColor = annotColor;
      const bboxColor = nextDistinctBBoxColor(annotations[pageNum] || []);
      if (annotTool === "bbox" && !activeBBoxCreationType) return;
      if (annotTool === "highlight") {
        const hit = findHighlightAnnotationAt(p.x, p.y);
        if (hit) {
          const canvasRect = annotCanvasRef.current.getBoundingClientRect();
          const scale = getScale();
          const minX = Math.min(...hit.points.map((pt) => pt.x));
          const minY = Math.min(...hit.points.map((pt) => pt.y));
          setHighlightActionMenu({
            vx: canvasRect.left + minX * scale,
            vy: canvasRect.top + minY * scale,
            editingId: hit.id,
          });
          return;
        }
        setHighlightStyleTargetId(null);
        // Gated on highlightAutoWidth, not just highlightMode==="line" —
        // getTextAlignedHighlightRange snaps the START point/width to the
        // clicked word's own left/right edges, which is exactly the
        // lock-to-word-boundaries behavior Auto Width is supposed to gate.
        // Previously this ran whenever "line" mode was active regardless
        // of the toggle, so even with Auto Width off, whatever you dragged
        // still started from a word-snapped position/width — reported as
        // "Auto Width is always working... it should only work when
        // clicked." getTextAlignedHighlightPoint below still keeps Y
        // centered on the text line and matches its height either way —
        // that part is "line" mode's own baseline-following behavior, not
        // the width-locking Auto Width controls.
        const alignedRange = highlightMode === "line" && highlightAutoWidth ? getTextAlignedHighlightRange(e) : null;
        const firstPoint = highlightMode === "line"
          ? (alignedRange || getTextAlignedHighlightPoint(e))
          : p;
        // Same restriction as underline/strikethrough — a highlight can
        // only start over real text, never blank margins/figures. "line"
        // mode already knows this via textAligned (set by
        // getTextAlignedHighlightPoint's own row lookup); "freehand" mode
        // never checked at all, so it's a separate findTextRowAt call at
        // the exact click point here. Row-band, not word-bbox — the whole
        // line counts as text from page-left to page-right, so starting
        // right at a word's leading edge (its first letter) never misses.
        activeAnnotRef.current = {
          type: "highlight",
          color: strokeColor,
          lineWidth: (firstPoint.lineWidth || annotSize),
          mode: highlightMode,
          opacity: annotOpacity / 100,
          highlightSettings: DEFAULT_HIGHLIGHT_SETTINGS,
          taperEnds: highlightTaperEnds,
          lineCenterY: highlightMode === "line" && firstPoint.textAligned ? firstPoint.y : null,
          autoWidthLocked: Boolean(highlightMode === "line" && highlightAutoWidth && alignedRange),
          // The starting word's own bounds — onMove (below) re-snaps to
          // whichever word is now under the cursor and grows/shrinks the
          // highlight to span from this fixed anchor out to that word,
          // continuously covering every whole word in between as the drag
          // moves. Without an anchor, "locked" mode had nothing to extend
          // FROM and just kept redrawing the single starting word forever
          // (reported as "highlights word-by-word instead of continuous").
          _autoWidthAnchorLeft: alignedRange ? alignedRange.startX : null,
          _autoWidthAnchorRight: alignedRange ? alignedRange.endX : null,
          points: highlightMode === "line" && highlightAutoWidth && alignedRange
            ? [
                { x: alignedRange.startX, y: firstPoint.y },
                { x: alignedRange.endX, y: firstPoint.y },
              ]
            : [{ x: firstPoint.x, y: firstPoint.y }],
        };
      } else if (["underline","strikethrough"].includes(annotTool)) {
        // Snaps to the word under the pointer — findNearestSpanOnRow
        // tries the exact tight bbox first, then falls back to the
        // closest word on the same text row, so a click landing just
        // short of a word's left edge (aiming for its first letter)
        // still finds that word instead of nothing.
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        const span = findNearestSpanOnRow(clientX, clientY);
        // No manual-drag fallback for a non-text click — underline/
        // strikethrough only ever mark real text now, never margins,
        // figures, or other blank page area (activeAnnotRef staying null
        // means onMove/onUp both just no-op for this gesture).
        activeAnnotRef.current = span
          ? { type: annotTool, color: strokeColor, x: span.left, y: span.top, w: Math.max(1, span.width), h: span.height, _startLeft: span.left, textAligned: true }
          : null;
      } else if (annotTool === "bbox" && activeBBoxCreationType) {
          const bboxPoint = toBBoxPagePoint(e);
          activeAnnotRef.current = createBBoxDraft(activeBBoxCreationType, bboxPoint, {
            color: activeBBoxCreationType === "omissionBBox"
              ? "#dc2626"
              : bboxTypeHas(activeBBoxCreationType, "extractsTitle") ? strokeColor : bboxColor,
            lineWidth: bboxBorderSize,
            borderStyle: shapeBorderStyle,
          });
      } else if (["rect","circle"].includes(annotTool)) {
          const bboxType = annotTool;
          activeAnnotRef.current = {
            type: bboxType, color: bboxType === "bbox" ? bboxColor : strokeColor, x: p.x, y: p.y, w: 0, h: 0, _sx: p.x, _sy: p.y,
            lineWidth: shapeStrokeWidth / getScale(),
            borderStyle: shapeBorderStyle,
            shapeBackground,
            ...(annotTool === "rect" ? { borderRadius: shapeBorderRadius } : {}),
          };
      } else if (annotTool === "smartVideo" && smartVideoSelecting && !smartVideoCaptureBusy) {
        activeAnnotRef.current = { type: "smartVideoCapture", color: strokeColor, x: p.x, y: p.y, w: 0, h: 0, _sx: p.x, _sy: p.y };
      } else if (["line","arrow"].includes(annotTool)) {
        activeAnnotRef.current = {
          type: annotTool, color: strokeColor, x1: p.x, y1: p.y, x2: p.x, y2: p.y,
          lineWidth: shapeStrokeWidth / getScale(),
          borderStyle: shapeBorderStyle,
        };
      } else if (annotTool === "freeshape") {
        // Captured the same way as a pen stroke (points pushed + smoothed
        // in onMove below), but finalized as a CLOSED, fillable/
        // strokeable shape (annotationDraw.js's "freeshape" case) instead
        // of an open stroke — border style and fill come from the same
        // Shapes-tool state rect/circle already use.
        activeAnnotRef.current = {
          type: "freeshape",
          color: strokeColor,
          lineWidth: shapeStrokeWidth / getScale(),
          borderStyle: shapeBorderStyle,
          shapeBackground,
          points: [{ x: p.x, y: p.y }],
        };
      } else if (isPenToolKey(annotTool)) {
        activeAnnotRef.current = {
          type: "pen",
          smartPen: annotTool === "smartPen",
          color: strokeColor,
          lineWidth: penSize,
          penType,
          penSettings: {
            dynamic: true, // always on — no toggle, see DEFAULT_PEN_SETTINGS.dynamic
            stabilization: penStabilization,
            pressureAssist: penPressureAssist,
            taper: penTaper,
            flow: penFlow,
            border: true, // always on — no toggle, see DEFAULT_PEN_SETTINGS.border
            nibAngle: penNibAngle,
            nibSpread: penNibSpread,
          },
          points: [{ x: p.x, y: p.y, t: p.t, pressure: p.pressure }],
        };
      } else if (annotTool === "eraser") {
        // Snapshot BEFORE this gesture touches anything — the one true
        // "undo target" for the whole drag, however many separate erase
        // hits it ends up covering. See lastEraseRef's own comment.
        activeAnnotRef.current = {
          type: "eraser",
          erasedCount: 0,
          changed: false,
          eraseSnapshot: annotations[pageNum] || [],
          lastKept: annotations[pageNum] || [],
        };
        eraseAtPoint(activeAnnotRef.current, p);
      }
    };

    const onMove = (e) => {
      preventNativeTouchDrawingGesture(e);
      if (e.touches && e.touches.length >= 2) {
        activeAnnotRef.current = null;
        setSmartPenMorphePreview(null);
        return;
      }
      const ann = activeAnnotRef.current;
      if (!ann) return;
      const p = isBBoxType(ann.type) ? toBBoxPagePoint(e) : toCanvas(e);
      if (ann.type === "pen" || ann.type === "highlight" || ann.type === "freeshape") {
        if (ann.mode === "line") {
          if (ann.type === "highlight" && ann.autoWidthLocked) {
            // Continuously re-snap to whichever word is now under the
            // cursor, growing/shrinking from the FIXED starting-word anchor
            // out to it — same word-span lookup underline/strikethrough's
            // own onMove uses. Previously this branch just redrew the
            // single word captured at mousedown on every tick and never
            // looked at where the cursor had moved to, so a drag across a
            // whole line only ever covered the first word touched.
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            const span = findNearestSpanOnRow(clientX, clientY);
            if (span) {
              ann.points[0].x = Math.min(ann._autoWidthAnchorLeft, span.left);
              ann.points[1].x = Math.max(ann._autoWidthAnchorRight, span.left + span.width);
            }
            redraw(ann);
            return;
          }
          const linePoint = ann.type === "highlight"
            ? getTextAlignedHighlightPoint(e, ann.lineCenterY)
            : p;
          if (ann.type === "highlight" && linePoint.textAligned && ann.lineCenterY == null) ann.lineCenterY = linePoint.y;
          // Track the live detected text height exactly, not just grow into
          // it — Math.max here used to mean a highlight that started off
          // text (falling back to the manual annotSize thickness) could
          // never shrink back down to the real, usually-smaller detected
          // line height once the drag actually reached real text.
          if (ann.type === "highlight" && linePoint.lineWidth) ann.lineWidth = linePoint.lineWidth;
          const lockedY = ann.type === "highlight" && ann.lineCenterY != null ? ann.lineCenterY : linePoint.y;
          if (ann.type === "highlight" && ann.points[0]) ann.points[0].y = lockedY;
          ann.points[1] = { x: linePoint.x, y: lockedY };
        } else {
          const nextPoint = (ann.type === "pen" || ann.type === "freeshape")
            ? smoothStrokePoint(
                ann.points,
                { x: p.x, y: p.y, t: p.t, pressure: p.pressure },
                ann.penSettings?.stabilization ?? penStabilization,
                getScale()
              )
            : { x: p.x, y: p.y };
          if (!nextPoint) return;
          ann.points.push(nextPoint);
        }
        if (ann.type === "pen" && ann.smartPen) {
          const tracePreview = getSmartPenDirectionalTraceRecords(ann, spansRef.current, schemaRecordsRef.current);
          if (tracePreview.length) {
            setSmartPenMorphePreview({
              kind: "trace",
              dimension: tracePreview[0].traceDimension,
              source: tracePreview[0].source.word,
              targets: tracePreview.map(({ target }) => target.word),
            });
          } else {
            const covered = getSmartPenCoveredSpanRecords(ann, spansRef.current);
            const newSchemaWords = isSmartPenRectangularStroke(ann)
              ? getSmartPenCoveredSchemaNames(ann, spansRef.current).filter((name) => !schemaRecordsRef.current.has(schemaWordKey(name)))
              : [];
            setSmartPenMorphePreview(newSchemaWords.length ? { kind: "schema", words: newSchemaWords } : null);
          }
        }
        redraw(ann);
      } else if (isBBoxType(ann.type) && ann._editingId && Array.isArray(ann.points)) {
        const dx = p.x - (ann._lastDragX ?? p.x);
        const dy = p.y - (ann._lastDragY ?? p.y);
        const draggedIndex = ann._pointEditIndex ?? findNearestOutlinePointIndex(ann.points, p.x, p.y);
        if (draggedIndex >= 0 && (dx !== 0 || dy !== 0)) {
          ann.points = deformClosedOutlineAroundPoint(ann.points, draggedIndex, dx, dy, getScale(), ann.closed !== false);
          ann._pointEditIndex = draggedIndex;
          ann._lastDragX = p.x;
          ann._lastDragY = p.y;
        }
        const nextBounds = pointsToBounds(ann.points);
        if (nextBounds) {
          ann.x = nextBounds.x;
          ann.y = nextBounds.y;
          ann.w = nextBounds.w;
          ann.h = nextBounds.h;
        }
        redraw(ann);
      } else if (isBBoxType(ann.type) && Array.isArray(ann.points) && !ann._editingId) {
        const nextPoint = {
          x: p.x,
          y: p.y,
          ...(p.t != null ? { t: p.t } : {}),
          ...(p.pressure != null ? { pressure: p.pressure } : {}),
        };
        const lastPoint = ann.points[ann.points.length - 1];
        if (lastPoint && Math.hypot((nextPoint.x ?? 0) - (lastPoint.x ?? 0), (nextPoint.y ?? 0) - (lastPoint.y ?? 0)) < 0.6) return;
        ann.points.push(nextPoint);
        const attracted = attractBBoxLoopPoint(ann.points, getScale());
        ann.points = attracted.points;
        ann.closed = attracted.closed;
        ann._loopAttraction = attracted.attraction;
        const bounds = pointsToBounds(ann.points);
        if (bounds) {
          ann.x = bounds.x;
          ann.y = bounds.y;
          ann.w = bounds.w;
          ann.h = bounds.h;
        }
        redraw(ann);
      } else if ((ann.type === "underline" || ann.type === "strikethrough") && ann.textAligned) {
        // Dragging across more words extends the line to cover them,
        // same word-span lookup as onDown — a plain click (no drag)
        // just keeps the single word it started on.
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        const span = findNearestSpanOnRow(clientX, clientY);
        if (span) {
          const left = Math.min(ann._startLeft, span.left);
          const right = Math.max(ann._startLeft + ann.w, span.left + span.width);
          ann.x = left;
          ann.w = right - left;
          ann.h = Math.max(ann.h, span.height);
        }
        redraw(ann);
      } else if (["underline","strikethrough","rect","circle","smartVideoCapture"].includes(ann.type)) {
        ann.x = Math.min(ann._sx, p.x); ann.y = Math.min(ann._sy, p.y);
        ann.w = Math.abs(p.x - ann._sx); ann.h = Math.abs(p.y - ann._sy);
        redraw(ann);
      } else if (["line","arrow"].includes(ann.type)) {
        ann.x2 = p.x; ann.y2 = p.y;
        redraw(ann);
      } else if (ann.type === "eraser") {
        eraseAtPoint(ann, p);
      }
    };

    const onUp = (e) => {
      preventNativeTouchDrawingGesture(e);
      const ann = activeAnnotRef.current;
      activeAnnotRef.current = null;
      if (!ann) return;
      if (ann.type === "eraser") {
        if (ann.changed) {
          setAnnotations((prev) => ({ ...prev, [pageNum]: ann.lastKept || [] }));
          setRedoStacks((prev) => (prev[pageNum]?.length ? { ...prev, [pageNum]: [] } : prev));
          lastEraseRef.current = { pageNum, before: ann.eraseSnapshot, after: ann.lastKept };
          logAnnotHistory({ action: "erase", page: pageNum, count: Math.max(1, ann.erasedCount || 0) });
        }
        clearLiveBBoxPreview();
        return;
      }
      if (ann.type === "pen") {
        ann.points = finalizePenStroke(
          ann.points,
          ann.penSettings ?? DEFAULT_PEN_SETTINGS,
          ann.penType ?? penType,
          fitScaleRef.current * zoomRef.current
        );
      }
      if (isBBoxType(ann.type) && !bboxTypeHas(ann.type, "extractsTitle")) {
        if (Array.isArray(ann.points) && !ann._editingId) {
          const finalized = finalizeBBoxAsRectangle(ann.points, ann.type, spansRef.current);
          ann.points = finalized.points;
          ann.closed = finalized.closed;
          ann.geometry = finalized.geometry;
        }
        const freeformBounds = Array.isArray(ann.points) && !ann._editingId ? pointsToBounds(ann.points) : null;
        if (freeformBounds) {
          ann.x = freeformBounds.x;
          ann.y = freeformBounds.y;
          ann.w = freeformBounds.w;
          ann.h = freeformBounds.h;
        }
        if (ann.type === "columnBBox") {
          const parentTolerance = 2;
          const containingParent = (annotationsRef.current[pageNum] || [])
            .filter((item) => (
              item.id !== ann._editingId
              && canBBoxContain(item.type, "columnBBox")
              && ann.x >= item.x - parentTolerance
              && ann.y >= item.y - parentTolerance
              && ann.x + ann.w <= item.x + item.w + parentTolerance
              && ann.y + ann.h <= item.y + item.h + parentTolerance
            ))
            .sort((a, b) => (a.w * a.h) - (b.w * b.h))[0] || null;
          if (!containingParent) {
            return;
          }
          ann.parentId = containingParent.id;
        }
        if (ann.type === "subLineBBox") {
          // Text-line metrics can protrude slightly past a paragraph's
          // tightly fitted border (font ascent and border rounding are the
          // usual causes). Treat that small difference as the same owner,
          // then clamp the visible child rectangle back inside it.
          const parentTolerance = 4;
          const paragraphCandidates = (annotationsRef.current[pageNum] || [])
            .filter((item) => item.id !== ann._editingId && item.type === "bbox" && canBBoxContain(item.type, "subLineBBox"));
          const containingParagraph = paragraphCandidates
            .map((item) => {
              const intersectionWidth = Math.max(0, Math.min(ann.x + ann.w, item.x + item.w) - Math.max(ann.x, item.x));
              const intersectionHeight = Math.max(0, Math.min(ann.y + ann.h, item.y + item.h) - Math.max(ann.y, item.y));
              const intersectionArea = intersectionWidth * intersectionHeight;
              const drawnArea = Math.max(1, ann.w * ann.h);
              const fullyInside = ann.x >= item.x - parentTolerance
                && ann.y >= item.y - parentTolerance
                && ann.x + ann.w <= item.x + item.w + parentTolerance
                && ann.y + ann.h <= item.y + item.h + parentTolerance;
              return { item, intersectionArea, overlapRatio: intersectionArea / drawnArea, fullyInside };
            })
            // A line selection may include generous whitespace around a
            // narrow partitioned paragraph. Any real intersection is enough
            // to identify the parent; the best candidate is selected below
            // and the child is clamped to that paragraph afterward.
            .filter(({ fullyInside, overlapRatio }) => fullyInside || overlapRatio > 0.01)
            .sort((a, b) => (
              Number(b.fullyInside) - Number(a.fullyInside)
              || b.overlapRatio - a.overlapRatio
              || (a.item.w * a.item.h) - (b.item.w * b.item.h)
            ))
            .map(({ item }) => item)[0] || null;
          if (!containingParagraph) return;
          const clampedLeft = Math.max(ann.x, containingParagraph.x);
          const clampedTop = Math.max(ann.y, containingParagraph.y);
          const clampedRight = Math.min(ann.x + ann.w, containingParagraph.x + containingParagraph.w);
          const clampedBottom = Math.min(ann.y + ann.h, containingParagraph.y + containingParagraph.h);
          if (clampedRight <= clampedLeft || clampedBottom <= clampedTop) return;
          ann.x = clampedLeft;
          ann.y = clampedTop;
          ann.w = clampedRight - clampedLeft;
          ann.h = clampedBottom - clampedTop;
          ann.points = rectanglePointsFromBounds(ann);
          ann.parentId = containingParagraph.id;
        }
        const minimumBBoxExtent = ann.type === "subLineBBox" ? 2 : 8;
        if (ann.w < minimumBBoxExtent || ann.h < minimumBBoxExtent) return;
        if (ann._editingId) {
          setAnnotations((prev) => {
            const pageAnnotations = prev[pageNum] || [];
            const childBboxes = bboxTypeHas(ann.type, "containsChildren")
              ? pageAnnotations.filter((item) => (
                item.id !== ann._editingId
                && BBOX_CARD_TYPES.has(item.type)
                && item.x >= ann.x
                && item.y >= ann.y
                && item.x + item.w <= ann.x + ann.w
                && item.y + item.h <= ann.y + ann.h
              ))
              : [];
            return {
              ...prev,
              [pageNum]: (prev[pageNum] || []).map((item) => (
                item.id === ann._editingId
                  ? {
                      ...item,
                      x: ann.x,
                      y: ann.y,
                      w: ann.w,
                      h: ann.h,
                      closed: ann.closed !== false,
                      ...(Array.isArray(ann.points) && ann.points.length >= 2 ? { points: ann.points.map((point) => ({ ...point })) } : {}),
                      ...(bboxTypeHas(item.type, "extractsText")
                        ? (() => {
                            const resizedBox = { x: ann.x, y: ann.y, w: ann.w, h: ann.h };
                            const extracted = extractBoundingBoxTextParts(
                              spansRef.current,
                              resizedBox,
                              bboxTextMatchesSpan,
                              [],
                              { splitLines: ["bbox", "columnBBox", "subLineBBox"].includes(item.type), detectTitle: item.smartSegmented },
                            );
                            const partitionedText = item.type === "bbox"
                              ? buildPartitionOrderedTextLines(
                                  spansRef.current,
                                  resizedBox,
                                  pageAnnotations.filter((candidate) => candidate?.type === "columnBBox"),
                                  bboxTextMatchesSpan,
                                )
                              : { lines: [], groups: [], partitionIds: [] };
                            const partitionLines = partitionedText.lines.map((line) => line.text).filter(Boolean);
                            const bodyLines = partitionLines.length
                              ? removeParagraphTitleLine(partitionLines, item.title).bodyLines
                              : [];
                            const resizedText = bodyLines.length
                              ? bodyLines.join("\n")
                              : stripTitleFromBBoxText(extracted.text, item.titleBBox?.text || extracted.title || item.title || "");
                            return {
                              title: item.smartSegmented
                                ? (extracted.title || item.title || "")
                                : (item.title || ""),
                              text: resizedText,
                              rawPdfText: resizedText,
                              ...(bodyLines.length ? { textLines: bodyLines } : {}),
                              ...(partitionedText.partitionIds.length > 1 ? {
                                partitionIds: partitionedText.partitionIds,
                                partitionLineGroups: partitionedText.groups.map((group) => ({
                                  partitionId: group.partitionId,
                                  lines: group.lines.map((line) => line.text).filter(Boolean),
                                })),
                              } : { partitionIds: [], partitionLineGroups: [] }),
                            };
                          })()
                        : bboxTypeHas(item.type, "extractsContainerTitle")
                          ? (() => {
                              const extracted = extractBoundingBoxTextParts(
                                spansRef.current,
                                { x: ann.x, y: ann.y, w: ann.w, h: ann.h },
                                bboxTextMatchesSpan,
                                childBboxes,
                              );
                              return {
                                title: item.smartSegmented ? (extracted.title || item.title || "") : (item.title || ""),
                              };
                            })()
                        : {}),
                  }
                : item
              )),
            };
          });
          setRedoStacks((prev) => (prev[pageNum]?.length ? { ...prev, [pageNum]: [] } : prev));
          logAnnotHistory({ action: "edit", type: ann.type, page: pageNum });
          setBBoxResizeTargetId(null);
          redraw();
          clearLiveBBoxPreview();
          return;
        }
      }
      if (bboxTypeHas(ann.type, "extractsTitle")) {
        const finalized = finalizeBBoxAsRectangle(ann.points, ann.type, spansRef.current);
        ann.points = finalized.points;
        ann.closed = finalized.closed;
        ann.geometry = finalized.geometry;
        const box = pointsToBounds(ann.points);
        if (!box || box.w < 8 || box.h < 8) return;
        const pageAnnotations = visiblePageAnnotations;
        const anchorPoint = Array.isArray(ann.points) && ann.points.length ? { x: ann.points[0].x, y: ann.points[0].y } : null;
        const selectionPad = Math.max(0.5, (ann.lineWidth ?? 0) / 2) + 0.5;
        const visibleTitleBox = {
          ...expandRectBy(box, selectionPad),
          lineWidth: ann.lineWidth,
        };
        const targetOwner = findContainingTitleOwner(pageAnnotations, visibleTitleBox, anchorPoint);
        if (!targetOwner) {
          redraw();
          clearLiveBBoxPreview();
          return;
        }
        const extracted = extractBoundingBoxTextParts(
          spansRef.current,
          box,
          bboxTextMatchesSpan,
          [],
          { preserveColumns: true },
        );
        const nextTitle = (extracted.title || extracted.text || "").trim();
        const titleId = Date.now();
        const titleGeometry = {
          id: titleId,
          type: "bboxTitle",
          ownerId: targetOwner.id,
          x: box.x,
          y: box.y,
          w: box.w,
          h: box.h,
          points: ann.points.map((point) => ({ x: point.x, y: point.y })),
          closed: true,
          geometry: "rectangle",
          color: targetOwner.color || ann.color,
          lineWidth: ann.lineWidth,
          borderStyle: ann.borderStyle,
          shapeBackground: false,
          text: nextTitle,
          hyleId: getSemanticHyleBBoxId(currentSourceIdRef.current, pageNum, "bboxTitle", 1),
        };
        let nextAnnotations = null;
        setAnnotations((prev) => {
          const withoutPreviousTitle = (prev[pageNum] || []).filter((item) => !(
            item.type === "bboxTitle" && (item.ownerId === targetOwner.id || item.containerId === targetOwner.id)
          ));
          const nextPageAnnotations = withoutPreviousTitle.map((item) => (
            item.id === targetOwner.id && item.type === targetOwner.type
              ? {
                  ...item,
                  title: nextTitle || item.title || "",
                  ...(bboxTypeHas(item.type, "extractsText")
                    ? (() => {
                        const sourceTextLines = buildTextLines(selectSpansForBoundingBox(
                          spansRef.current,
                          item,
                          bboxTextMatchesSpanUtil,
                          [],
                          { preserveColumns: true, splitLines: item.type === "bbox" },
                        )).map((line) => line.text).filter(Boolean);
                        const sourceRawPdfText = item.sourceRawPdfText || item.rawPdfText || item.text || sourceTextLines.join("\n");
                        return {
                          // Keep the titled line in the parent's line group.
                          // The title is metadata; assigning it must not make
                          // the original child/subline text disappear.
                          titleSourceLine: nextTitle || item.titleSourceLine || "",
                          sourceTextLines,
                          sourceRawPdfText,
                          textLines: sourceTextLines,
                          text: sourceRawPdfText,
                          rawPdfText: sourceRawPdfText,
                          correctedText: item.correctedText || sourceRawPdfText,
                          ocrCorrectedText: item.ocrCorrectedText || sourceRawPdfText,
                          textCorrection: {
                            ...(item.textCorrection || {}),
                            audit: null,
                            applied: false,
                            correctionVersion: null,
                          },
                        };
                      })()
                    : { text: item.text }),
                  titleBBox: { ...titleGeometry },
                }
              : item
          ));
          nextPageAnnotations.push(titleGeometry);
          nextAnnotations = {
            ...prev,
            [pageNum]: nextPageAnnotations,
          };
          return nextAnnotations;
        });
        setRedoStacks((prev) => (prev[pageNum]?.length ? { ...prev, [pageNum]: [] } : prev));
        const sourceId = currentSourceIdRef.current || embeddedSourceId || null;
        if (sourceId && nextAnnotations) {
          authFetch(apiUrl(`/api/source-annotations/${sourceId}`), {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(buildAnnotationSavePayload({ activeAnnotations: nextAnnotations })),
          }).catch(() => {});
        }
        logAnnotHistory({ action: "edit", type: targetOwner.type, page: pageNum });
        redraw();
        clearLiveBBoxPreview();
        return;
      }
      if (ann.type === "smartVideoCapture") {
        if (ann.w < 8 || ann.h < 8) return;
        const { _sx, _sy, ...selection } = ann;
        void captureSmartVideoScreenshot(selection);
        redraw();
        clearLiveBBoxPreview();
        return;
      }
      const tinyDocThreshold = 3 / Math.max(1, fitScaleRef.current * zoomRef.current);
      const strokeLength = (ann.type === "pen" || ann.type === "freeshape") ? polylineLength(ann.points) : 0;
      // ignore accidental tiny marks
      const tiny = (ann.type === "pen" || ann.type === "freeshape")
        ? (ann.points.length < 2 || strokeLength < tinyDocThreshold)
        : ["line","arrow"].includes(ann.type)
          ? Math.hypot(ann.x2 - ann.x1, ann.y2 - ann.y1) < tinyDocThreshold
          : ann.w < tinyDocThreshold && ann.h < tinyDocThreshold;
      if (tiny) {
        clearLiveBBoxPreview();
        return;
      }
      if (ann.type === "pen" && ann.smartPen) {
        setSmartPenMorphePreview(null);
        registerSmartPenStrokeSchemas(ann);
        redraw();
        clearLiveBBoxPreview();
        return;
      }
      const { _sx, _sy, _startLeft, textAligned, _editingId, points, ...clean } = ann;
      // points is pulled out above (alongside the truly transient drag-only
      // fields) so the BBox branch below can normalize/obstacle-adjust it
      // before reattaching — but every non-BBox points-based type (pen,
      // highlight, freeshape) never goes through that branch, so without
      // this fallback the committed annotation lost its points entirely:
      // drawAnnotation's own `!ann.points` guard then silently skipped it,
      // which is why a stroke stayed visible while dragging (the live
      // preview draws straight from the in-progress object) and vanished
      // the instant the pointer lifted (the committed one had no points).
      if (Array.isArray(points)) clean.points = points;
      if (isBBoxType(ann.type) && !bboxTypeHas(ann.type, "extractsTitle") && Array.isArray(points) && points.length >= 2 && !_editingId) {
        const normalizedPoints = points.map((point) => ({
          x: point.x,
          y: point.y,
          ...(point.t != null ? { t: point.t } : {}),
          ...(point.pressure != null ? { pressure: point.pressure } : {}),
        }));
        clean.points = normalizedPoints;
        clean.closed = ann.closed !== false;
      }
      if (clean.type === "highlight" && highlightAutoContrast) {
        const maskedText = findSpansOverlappingHighlight(clean.points);
        if (maskedText.length) clean.maskedText = maskedText;
      }
      const insideContainerTarget = bboxContainerBBoxTarget && bboxContainerBBoxTarget.pageNum === pageNum
        ? bboxContainerBBoxTarget
        : null;
      // Build the complete next state synchronously before handing it to
      // React. The database write below must not depend on a variable being
      // assigned inside a deferred setState updater.
      const nextId = Date.now();
      const buildNextAnnotations = (prev) => {
        const pageAnnotations = prev[pageNum] || [];
        const initialBox = isBBoxType(clean.type) && Array.isArray(clean.points) && clean.points.length >= 2
          ? {
              ...clean,
              ...(() => {
                const bounds = pointsToBounds(clean.points);
                return bounds ? { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h } : {};
              })(),
            }
          : clean;
        let box = initialBox;
        const typeOrdinal = pageAnnotations.filter((item) => item?.type === clean.type).length + 1;
        const containingSubLineParagraph = clean.type === "subLineBBox"
          ? pageAnnotations
            .filter((item) => item?.type === "bbox" && canBBoxContain(item.type, "subLineBBox"))
            .map((item) => {
              const overlapWidth = Math.max(0, Math.min(box.x + box.w, item.x + item.w) - Math.max(box.x, item.x));
              const overlapHeight = Math.max(0, Math.min(box.y + box.h, item.y + item.h) - Math.max(box.y, item.y));
              const overlapRatio = (overlapWidth * overlapHeight) / Math.max(1, box.w * box.h);
              const tolerance = 4;
              const fullyInside = box.x >= item.x - tolerance
                && box.y >= item.y - tolerance
                && box.x + box.w <= item.x + item.w + tolerance
                && box.y + box.h <= item.y + item.h + tolerance;
              return { item, fullyInside, overlapRatio };
            })
            .filter(({ fullyInside, overlapRatio }) => fullyInside || overlapRatio > 0.01)
            .sort((a, b) => (
              Number(b.fullyInside) - Number(a.fullyInside)
              || b.overlapRatio - a.overlapRatio
              || (a.item.w * a.item.h) - (b.item.w * b.item.h)
            ))
            .map(({ item }) => item)[0] || null
          : null;
        if (containingSubLineParagraph) {
          const parentRight = containingSubLineParagraph.x + containingSubLineParagraph.w;
          const parentBottom = containingSubLineParagraph.y + containingSubLineParagraph.h;
          const left = Math.max(box.x, containingSubLineParagraph.x);
          const top = Math.max(box.y, containingSubLineParagraph.y);
          const right = Math.min(box.x + box.w, parentRight);
          const bottom = Math.min(box.y + box.h, parentBottom);
          if (right <= left || bottom <= top) return { ...prev, [pageNum]: pageAnnotations };
          box = {
            ...box,
            x: left,
            y: top,
            w: right - left,
            h: bottom - top,
            points: rectanglePointsFromBounds({ x: left, y: top, w: right - left, h: bottom - top }),
          };
        }
        const containingColumn = ["bbox", "imageBBox"].includes(clean.type)
          ? pageAnnotations
            .filter((item) => (
              item?.type === "columnBBox"
              && canBBoxContain(item.type, clean.type)
              && box.x >= item.x
              && box.y >= item.y
              && box.x + box.w <= item.x + item.w
              && box.y + box.h <= item.y + item.h
            ))
            .sort((a, b) => (a.w * a.h) - (b.w * b.h))[0] || null
          : null;
        const containingPage = clean.type !== "pageBBox"
          ? pageAnnotations
            .filter((item) => (
              item?.type === "pageBBox"
              && canBBoxContain(item.type, clean.type)
              && box.x >= item.x - 2
              && box.y >= item.y - 2
              && box.x + box.w <= item.x + item.w + 2
              && box.y + box.h <= item.y + item.h + 2
            ))
            .sort((a, b) => (a.w * a.h) - (b.w * b.h))[0] || null
          : null;
        const imageSnippet = bboxTypeHas(clean.type, "capturesImage")
          ? captureImageBBoxSnippet(box)
          : null;
        if (clean.type === "columnBBox" && !containingPage) {
          return { ...prev, [pageNum]: pageAnnotations };
        }
        const structuralParent = clean.type === "columnBBox"
          ? containingPage
          : (["bbox", "imageBBox"].includes(clean.type)
            ? (containingColumn || containingPage)
            : (containingSubLineParagraph || containingPage));
        const newAnnotation = {
          ...box,
          ...(imageSnippet ? { imageDataUrl: imageSnippet.dataUrl, imageWidth: imageSnippet.width, imageHeight: imageSnippet.height } : {}),
          ...(bboxTypeHas(clean.type, "extractsText")
            ? (() => {
                const textMatcher = clean.type === "imageBBox"
                  ? (candidate, span) => {
                      if (!bboxTextMatchesSpan(candidate, span)) return false;
                      const spanLeft = span.pageLeft ?? span.geoLeft ?? 0;
                      const spanTop = span.pageTop ?? span.geoTop ?? 0;
                      const spanRight = span.pageRight ?? span.geoRight ?? spanLeft;
                      const spanBottom = span.pageBottom ?? (spanTop + (span.pageHeight ?? span.geoHeight ?? 0));
                      const spanArea = Math.max(1, (spanRight - spanLeft) * (spanBottom - spanTop));
                      return !pageImageRectsRef.current.some((imageRect) => {
                        const overlapX = Math.max(0, Math.min(spanRight, imageRect.x + imageRect.w) - Math.max(spanLeft, imageRect.x));
                        const overlapY = Math.max(0, Math.min(spanBottom, imageRect.y + imageRect.h) - Math.max(spanTop, imageRect.y));
                        return (overlapX * overlapY) / spanArea >= 0.5;
                      });
                    }
                  : bboxTextMatchesSpan;
                const extracted = extractBoundingBoxTextParts(
                  spansRef.current,
                  box,
                  textMatcher,
                  [],
                  { preserveColumns: true, splitLines: ["bbox", "columnBBox", "subLineBBox"].includes(clean.type), detectTitle: clean.smartSegmented },
                );
                const partitionedText = clean.type === "bbox"
                  ? buildPartitionOrderedTextLines(
                      spansRef.current,
                      box,
                      pageAnnotations.filter((item) => item?.type === "columnBBox"),
                      textMatcher,
                    )
                  : { lines: [], groups: [], partitionIds: [] };
                const selectedTextLines = (partitionedText.lines.length
                  ? partitionedText.lines
                  : buildTextLines(
                      selectSpansForBoundingBox(
                        spansRef.current,
                        box,
                        textMatcher,
                        [],
                        { preserveColumns: true, splitLines: ["bbox", "columnBBox", "subLineBBox"].includes(clean.type) },
                      ),
                    )).map((line) => line.text).filter(Boolean);
                if (extracted.title && selectedTextLines.length) {
                  const normalizeLine = (value) => String(value || "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
                  if (normalizeLine(selectedTextLines[0]) === normalizeLine(extracted.title)) {
                    selectedTextLines.shift();
                  }
                }
                const rawPdfText = clean.type === "subLineBBox"
                  ? [extracted.title, extracted.text].filter(Boolean).join(" ").trim()
                  : clean.type === "bbox" && !clean.smartSegmented && selectedTextLines.length
                    ? selectedTextLines.join("\n")
                  : stripTitleFromBBoxText(extracted.text, extracted.title || clean.title || "");
                return {
                  title: clean.smartSegmented
                    ? (clean.type === "subLineBBox" ? "" : extracted.title)
                    : (clean.title || ""),
                  text: rawPdfText,
                  rawPdfText,
                  ...(selectedTextLines.length ? { textLines: selectedTextLines } : {}),
                  ...(partitionedText.partitionIds.length > 1 ? {
                    partitionIds: partitionedText.partitionIds,
                    partitionLineGroups: partitionedText.groups.map((group) => ({
                      partitionId: group.partitionId,
                      lines: group.lines.map((line) => line.text).filter(Boolean),
                    })),
                  } : {}),
                  textCorrection: {
                    source: "pdf_text_layer",
                    confidence: 1,
                    warnings: ["No reliable OCR alignment was found"],
                    correctionVersion: BBOX_TEXT_CORRECTION_VERSION,
                  },
                };
              })()
            : {}),
          id: nextId,
          hyleId: getSemanticHyleBBoxId(currentSourceIdRef.current, pageNum, clean.type, typeOrdinal),
          ...(
            structuralParent
              ? { parentId: structuralParent.id }
              : {}
          ),
        };
        let nextPageAnnotations = [...pageAnnotations, newAnnotation];
        const isContainedBy = (child, parent) => (
          child.x >= parent.x
          && child.y >= parent.y
          && child.x + child.w <= parent.x + parent.w
          && child.y + child.h <= parent.y + parent.h
        );
        if (clean.type === "pageBBox") {
          const pagePartitions = nextPageAnnotations
            .filter((item) => item.type === "columnBBox" && isContainedBy(item, newAnnotation))
            .sort((a, b) => (a.w * a.h) - (b.w * b.h));
          nextPageAnnotations = nextPageAnnotations.map((item) => {
            if (item.id === newAnnotation.id) return item;
            if (item.type === "columnBBox" && isContainedBy(item, newAnnotation)) {
              return { ...item, parentId: newAnnotation.id };
            }
            if (!["bbox", "imageBBox"].includes(item.type) || !isContainedBy(item, newAnnotation)) return item;
            const partition = pagePartitions.find((candidate) => isContainedBy(item, candidate));
            return { ...item, parentId: partition?.id || newAnnotation.id };
          });
        } else if (clean.type === "columnBBox") {
          nextPageAnnotations = nextPageAnnotations.map((item) => (
            ["bbox", "imageBBox"].includes(item.type) && isContainedBy(item, newAnnotation)
              ? { ...item, parentId: newAnnotation.id }
              : item
          ));
        }
        const nextAnnotations = {
          ...prev,
          [pageNum]: nextPageAnnotations,
        };
        if (bboxTypeHas(clean.type, "canBeNested") && insideContainerTarget?.containerId) {
          nextAnnotations[pageNum] = expandContainerToIncludeBBox(
            nextAnnotations[pageNum],
            insideContainerTarget.containerId,
            box,
          );
        }
        return nextAnnotations;
      };
      // Pointer-up can arrive before React has rebound this effect after the
      // previous partition. Always build from the ref-backed current state so
      // adding Partition 2 cannot replace Partition 1 with a stale snapshot.
      const nextAnnotations = buildNextAnnotations(annotationsRef.current);
      annotationsRef.current = nextAnnotations;
      setAnnotations(nextAnnotations);
      setRedoStacks((prev) => (prev[pageNum]?.length ? { ...prev, [pageNum]: [] } : prev));
      if (bboxTypeHas(clean.type, "canBeNested") && insideContainerTarget) setBBoxContainerBBoxTarget(null);
      const historyEntry = {
        action: "add",
        type: clean.type,
        page: pageNum,
        color: clean.color,
        size: clean.lineWidth
          ? Math.round(clean.type === "pen" ? clean.lineWidth : clean.lineWidth * (fitScaleRef.current * zoomRef.current))
          : null,
        // Links this row to the actual annotation it created — see
        // markAnnotationCleared, which uses it to mark THIS row cleared
        // in place instead of appending a whole separate "deleted" row
        // when that specific annotation is later removed.
        annotationId: nextId,
      };
      const nextHistory = appendAnnotHistoryEntry(annotHistory, historyEntry);
      setAnnotHistory(nextHistory);
      const sourceId = currentSourceIdRef.current || embeddedSourceId || null;
      if (sourceId && nextAnnotations) {
        authFetch(apiUrl(`/api/source-annotations/${sourceId}`), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildAnnotationSavePayload({
            activeAnnotations: nextAnnotations,
            history: nextHistory,
          })),
        }).then((response) => {
          if (!response.ok) throw new Error(`Annotation save failed (${response.status})`);
        }).catch((error) => {
          console.error("[PDF] Failed to persist BBox annotation", error);
        });
      }
      const createdAnnotation = (nextAnnotations[pageNum] || []).find((item) => item.id === nextId);
      if (sourceId && createdAnnotation?.rawPdfText) {
        void correctBBoxAnnotationFromOcr({
          annotationId: nextId,
          targetPage: pageNum,
          rawPdfText: createdAnnotation.rawPdfText,
          bboxPdf: { x: createdAnnotation.x, y: createdAnnotation.y, width: createdAnnotation.w, height: createdAnnotation.h },
          sourceId,
        });
      }
      clearLiveBBoxPreview();
    };

    const onTouchCancel = (e) => {
      preventNativeTouchDrawingGesture(e);
      const ann = activeAnnotRef.current;
      activeAnnotRef.current = null;
      setBBoxResizePreview(null);
      clearLiveBBoxPreview();
      if (ann?.type === "highlight") {
        redraw();
        return;
      }
      if (ann) {
        activeAnnotRef.current = ann;
        onUp(e);
      }
    };

    let activeStylusPointerId = null;
    const onPointerDown = (event) => {
      if (event.pointerType !== "pen") return;
      activeStylusPointerId = event.pointerId;
      if (!event.__pdfMarkdownProxy) ac.setPointerCapture?.(event.pointerId);
      onDown(event);
    };
    const onPointerMove = (event) => {
      if (event.pointerType !== "pen" || event.pointerId !== activeStylusPointerId) return;
      onMove(event);
    };
    const finishStylusPointer = (event, cancelled = false) => {
      if (event.pointerType !== "pen" || event.pointerId !== activeStylusPointerId) return;
      if (cancelled) onTouchCancel(event);
      else onUp(event);
      if (!event.__pdfMarkdownProxy && ac.hasPointerCapture?.(event.pointerId)) ac.releasePointerCapture(event.pointerId);
      activeStylusPointerId = null;
    };
    const onPointerUp = (event) => finishStylusPointer(event, false);
    const onPointerCancel = (event) => finishStylusPointer(event, true);
    ac.addEventListener("pointerdown", onPointerDown, { passive: false });
    ac.addEventListener("pointermove", onPointerMove, { passive: false });
    ac.addEventListener("pointerup", onPointerUp, { passive: false });
    ac.addEventListener("pointercancel", onPointerCancel, { passive: false });
    ac.addEventListener("contextmenu", preventNativeTouchDrawingGesture);
    return () => {
      ac.removeEventListener("pointerdown", onPointerDown);
      ac.removeEventListener("pointermove", onPointerMove);
      ac.removeEventListener("pointerup", onPointerUp);
      ac.removeEventListener("pointercancel", onPointerCancel);
      ac.removeEventListener("contextmenu", preventNativeTouchDrawingGesture);
      clearLiveBBoxPreview();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotTool, annotColor, annotSize, penSize, shapeStrokeWidth, penStabilization, penPressureAssist, penTaper, penFlow, penNibAngle, penNibSpread, penType, eraserSize, eraserMode, highlightMode, highlightAutoWidth, highlightTaperEnds, highlightAutoContrast, pageNum, annotations, annotOpacity, logAnnotHistory, smartVideoSelecting, smartVideoCaptureBusy, captureSmartVideoScreenshot, captureImageBBoxSnippet, shapeBorderStyle, shapeBorderRadius, shapeBackground, activeBBoxCreationType, bboxContainerBBoxTarget, correctBBoxAnnotationFromOcr, expandContainerToIncludeBBox, findContainingBBoxContainer, registerSmartPenStrokeSchemas, updateBBoxName]);

  // Eraser-size cursor circle — a real hit-test-radius preview, not just a
  // generic "cell" cursor. eraserSize is already in screen/CSS pixels (the
  // erase hit-test itself divides it by getScale() to reach doc-space, see
  // the "eraser" branches in onDown/onMove above), so the on-screen circle
  // diameter is simply eraserSize * 2 — no extra scale conversion needed.
  // Mutates the DOM node directly via a ref rather than React state, since
  // this fires on every pointermove; matches the same performance pattern the
  // manual-selection-handle drag code above already uses.
  useEffect(() => {
    const ac = annotCanvasRef.current;
    const cursorEl = eraserCursorRef.current;
    if (!ac || !cursorEl) return;
    if (annotTool !== "eraser") {
      cursorEl.style.display = "none";
      return;
    }
    const diameter = eraserSize * 2;
    cursorEl.style.width  = `${diameter}px`;
    cursorEl.style.height = `${diameter}px`;

    const moveCursor = (e) => {
      if (e.pointerType !== "pen") return;
      const samples = e.getCoalescedEvents?.() || [];
      const latest = samples[samples.length - 1] || e;
      cursorEl.style.display = "block";
      cursorEl.style.left = `${latest.clientX}px`;
      cursorEl.style.top  = `${latest.clientY}px`;
    };
    const hideCursor = (e) => {
      if (!e || e.pointerType === "pen") cursorEl.style.display = "none";
    };

    ac.addEventListener("pointerenter", moveCursor);
    ac.addEventListener("pointerdown", moveCursor);
    ac.addEventListener("pointermove", moveCursor);
    ac.addEventListener("pointerleave", hideCursor);
    ac.addEventListener("pointercancel", hideCursor);
    return () => {
      ac.removeEventListener("pointerenter", moveCursor);
      ac.removeEventListener("pointerdown", moveCursor);
      ac.removeEventListener("pointermove", moveCursor);
      ac.removeEventListener("pointerleave", hideCursor);
      ac.removeEventListener("pointercancel", hideCursor);
      cursorEl.style.display = "none";
    };
  }, [annotTool, eraserSize, pageNum]);

  const commitAnnotText = useCallback(() => {
    if (!annotTextInput || !annotTextVal.trim()) { setAnnotTextInput(null); return; }
    const scale = fitScaleRef.current * zoomRef.current;
    const nextText = {
      type: "text",
      color: annotColor,
      x: annotTextInput.cx / scale,
      y: annotTextInput.cy / scale,
      text: annotTextVal,
      fontSize: textFontSize,
      fontFamily: textFontFamily,
      textAlign,
      fontBold: textBold,
      fontItalic: textItalic,
      textUnderline,
      textBackground,
      textBackgroundColor,
      textBaseline: "top",
      padding: textPadding,
    };
    const newTextId = Date.now();
    const isEditing = Boolean(annotTextInput.editingId);
    let nextAnnotations = null;
    setAnnotations((prev) => {
      nextAnnotations = {
        ...prev,
        [pageNum]: isEditing
          ? (prev[pageNum] || []).map((ann) => (ann.id === annotTextInput.editingId ? { ...ann, ...nextText } : ann))
          : [...(prev[pageNum] || []), { id: newTextId, ...nextText }],
      };
      return nextAnnotations;
    });
    setRedoStacks((prev) => (prev[pageNum]?.length ? { ...prev, [pageNum]: [] } : prev));
    const historyEntry = {
      action: isEditing ? "edit" : "add",
      type: "text",
      page: pageNum,
      color: annotColor,
      ...(isEditing ? {} : { annotationId: newTextId }),
    };
    if (isEditing) {
      logAnnotHistory(historyEntry);
    } else {
      const nextHistory = appendAnnotHistoryEntry(annotHistory, historyEntry);
      setAnnotHistory(nextHistory);
      const sourceId = currentSourceIdRef.current;
      if (sourceId && nextAnnotations) {
        authFetch(apiUrl(`/api/source-annotations/${sourceId}`), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildAnnotationSavePayload({ activeAnnotations: nextAnnotations, history: nextHistory })),
        }).catch(() => {});
      }
    }
    setAnnotTextInput(null);
    setTextActionMenu(null);
    setTextStyleTargetId(null);
    setAnnotTextVal("");
    // Same safety-net repaint as the generic pointer-commit path above —
    // see paintCurrentAnnotationLayersRef's own comment.
    requestAnimationFrame(() => { paintCurrentAnnotationLayersRef.current(); });
  }, [annotTextInput, annotTextVal, annotColor, pageNum, logAnnotHistory, textFontSize, textFontFamily, textAlign, textBold, textItalic, textUnderline, textBackground, textBackgroundColor, textPadding, appendAnnotHistoryEntry, annotHistory]);

  // Full 8-point resize (corners + edges) on the text-annotation editor
  // box, matching the standard text-box handle set of PowerPoint/Figma/
  // Google Docs rather than a single edge grip. Dragging from the top or
  // left moves the box's own anchor point (vx/vy) by the same amount the
  // edge moved, so the OPPOSITE edge stays fixed in place — the way a real
  // resize handle behaves — instead of the whole box sliding.
  const beginTextInputResize = useCallback((dir, e) => {
    if (e.pointerType !== "pen") return;
    e.preventDefault();
    e.stopPropagation();
    const pointerId = e.pointerId;
    e.currentTarget?.setPointerCapture?.(pointerId);
    const startX = e.touches ? e.touches[0].clientX : e.clientX;
    const startY = e.touches ? e.touches[0].clientY : e.clientY;
    const rect = annotTextInputRef.current?.getBoundingClientRect();
    const startWidth = rect?.width || 160;
    const startHeight = rect?.height || 28;
    const startVx = annotTextInput?.vx || 0;
    const startVy = annotTextInput?.vy || 0;
    const onMove = (ev) => {
      if (ev.pointerId !== pointerId || ev.pointerType !== "pen") return;
      const clientX = ev.touches ? ev.touches[0].clientX : ev.clientX;
      const clientY = ev.touches ? ev.touches[0].clientY : ev.clientY;
      const dx = clientX - startX;
      const dy = clientY - startY;
      const patch = {};
      if (dir.includes("e")) {
        patch.width = Math.max(60, startWidth + dx);
      } else if (dir.includes("w")) {
        const nextWidth = Math.max(60, startWidth - dx);
        patch.width = nextWidth;
        patch.vx = startVx + (startWidth - nextWidth);
      }
      if (dir.includes("s")) {
        patch.height = Math.max(28, startHeight + dy);
      } else if (dir.includes("n")) {
        const nextHeight = Math.max(28, startHeight - dy);
        patch.height = nextHeight;
        patch.vy = startVy + (startHeight - nextHeight);
      }
      setAnnotTextInput((cur) => (cur ? { ...cur, ...patch } : cur));
    };
    const onEnd = (ev) => {
      if (ev.pointerId !== pointerId || ev.pointerType !== "pen") return;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
  }, [annotTextInput?.vx, annotTextInput?.vy]);

  // n/s/e/w edges resize one axis; corners resize both — same convention
  // as every other professional text-box resize UI.
  const TEXT_RESIZE_HANDLES = [
    { dir: "nw", cursor: "nwse-resize" },
    { dir: "n",  cursor: "ns-resize" },
    { dir: "ne", cursor: "nesw-resize" },
    { dir: "e",  cursor: "ew-resize" },
    { dir: "se", cursor: "nwse-resize" },
    { dir: "s",  cursor: "ns-resize" },
    { dir: "sw", cursor: "nesw-resize" },
    { dir: "w",  cursor: "ew-resize" },
  ];

  const undoMorpheCreation = useCallback(async (action) => {
    if (!action?.id) return;
    try {
      if (action.kind === "schema") await morpheSchemasApi.remove(action.id);
      else await morpheTraceSchemasApi.remove(action.id);
      morpheUndoRef.current = morpheUndoRef.current.slice(0, -1);
      morpheRedoRef.current.push(action);
      logAnnotHistory({ action: "undo", type: `morphe-${action.kind}`, page: action.page, morpheEntityId: action.id });
      window.dispatchEvent(new CustomEvent("amctoshs:morphe-updated"));
    } catch (error) {
      console.error("[PDF] Failed to undo Smart Pen Morphe creation", error);
    }
  }, [logAnnotHistory]);

  const redoMorpheCreation = useCallback(async (action) => {
    if (!action) return;
    try {
      const result = action.kind === "schema"
        ? await upsertSmartPenSchema({ name: action.name, sourceId: action.sourceId, page: action.page })
        : await upsertSmartPenTrace({
          name: action.name,
          sourceSchemaId: action.sourceSchemaId,
          sourceSchemaName: action.sourceSchemaName,
          sourceId: action.sourceId,
          page: action.page,
          traceDimension: action.traceDimension,
        });
      const entity = result?.schema || result?.traceSchema;
      if (!entity?._id) return;
      const restored = { ...action, id: entity._id };
      morpheRedoRef.current = morpheRedoRef.current.slice(0, -1);
      morpheUndoRef.current.push(restored);
      logAnnotHistory({ action: "redo", type: `morphe-${action.kind}`, page: action.page, morpheEntityId: entity._id });
      window.dispatchEvent(new CustomEvent("amctoshs:morphe-updated"));
    } catch (error) {
      console.error("[PDF] Failed to redo Smart Pen Morphe creation", error);
    }
  }, [logAnnotHistory]);

  const handleAnnotUndo = useCallback(() => {
    if (activeAnnotationSurface === "nb" && notebookMode && notebookActiveTab === "drawing") {
      if (!notebookUndoStack.length) return;
      const restored = notebookUndoStack[notebookUndoStack.length - 1];
      setNotebookUndoStack((previous) => previous.slice(0, -1));
      setNotebookRedoStack((previous) => [...previous, notebookAnnotations]);
      setNotebookAnnotations(restored);
      saveNotebookAnnotations(restored);
      return;
    }
    if (activeAnnotationSurface === "md") {
      const currentLayers = markdownAnnotationsRef.current;
      let restored;
      if (markdownUndoStack.length) {
        restored = markdownUndoStack[markdownUndoStack.length - 1];
        setMarkdownUndoStack((stack) => stack.slice(0, -1));
      } else {
        const currentPageAnnotations = currentLayers[pageNum] || [];
        if (!currentPageAnnotations.length) return;
        restored = { ...currentLayers, [pageNum]: currentPageAnnotations.slice(0, -1) };
      }
      setMarkdownRedoStack((stack) => [...stack.slice(-99), currentLayers]);
      markdownAnnotationsRef.current = restored;
      setMarkdownAnnotations(restored);
      saveMarkdownAnnotations(restored);
      return;
    }
    const latestHistory = annotHistory[annotHistory.length - 1];
    const latestMorphe = morpheUndoRef.current[morpheUndoRef.current.length - 1];
    if (
      latestMorphe
      && latestHistory?.action === "add"
      && latestHistory?.type === `morphe-${latestMorphe.kind}`
      && latestHistory?.page === latestMorphe.page
      && latestHistory?.annotationId === latestMorphe.id
    ) {
      void undoMorpheCreation(latestMorphe);
      return;
    }
    // The eraser removes from wherever it hits (or, in "precise" mode,
    // shrinks a stroke's own points in place) — not from the end of the
    // array — so "pop whatever's now last" below is the wrong undo for it:
    // it would delete a completely unrelated annotation instead of
    // restoring what was actually erased. If the last thing that happened
    // to this page was an erase gesture, and nothing has touched the page
    // since (the reference-equality check), restore its pre-erase snapshot
    // wholesale instead.
    const le = lastEraseRef.current;
    if (le && le.pageNum === pageNum && le.before && annotations[pageNum] === le.after) {
      setAnnotations((prev) => ({ ...prev, [pageNum]: le.before }));
      setRedoStacks((prev) => (prev[pageNum]?.length ? { ...prev, [pageNum]: [] } : prev));
      lastEraseRef.current = null;
      logAnnotHistory({ action: "undo", type: "eraser", page: pageNum });
      return;
    }
    const arr = annotations[pageNum] || [];
    if (arr.length === 0) return;
    const popped = arr[arr.length - 1];
    setAnnotations((prev) => ({ ...prev, [pageNum]: (prev[pageNum] || []).slice(0, -1) }));
    setRedoStacks((prev) => ({ ...prev, [pageNum]: [...(prev[pageNum] || []), popped] }));
    logAnnotHistory({ action: "undo", type: popped.type, page: pageNum });
  }, [activeAnnotationSurface, annotHistory, annotations, logAnnotHistory, markdownUndoStack, notebookActiveTab, notebookAnnotations, notebookMode, notebookUndoStack, pageNum, saveMarkdownAnnotations, saveNotebookAnnotations, undoMorpheCreation]);

  const handleAnnotRedo = useCallback(() => {
    if (activeAnnotationSurface === "nb" && notebookMode && notebookActiveTab === "drawing") {
      if (!notebookRedoStack.length) return;
      const restored = notebookRedoStack[notebookRedoStack.length - 1];
      setNotebookRedoStack((previous) => previous.slice(0, -1));
      setNotebookUndoStack((previous) => [...previous, notebookAnnotations]);
      setNotebookAnnotations(restored);
      saveNotebookAnnotations(restored);
      return;
    }
    if (activeAnnotationSurface === "md") {
      if (!markdownRedoStack.length) return;
      const currentLayers = markdownAnnotationsRef.current;
      const restored = markdownRedoStack[markdownRedoStack.length - 1];
      setMarkdownRedoStack((stack) => stack.slice(0, -1));
      setMarkdownUndoStack((stack) => [...stack.slice(-99), currentLayers]);
      markdownAnnotationsRef.current = restored;
      setMarkdownAnnotations(restored);
      saveMarkdownAnnotations(restored);
      return;
    }
    const latestHistory = annotHistory[annotHistory.length - 1];
    const latestMorphe = morpheRedoRef.current[morpheRedoRef.current.length - 1];
    if (
      latestMorphe
      && latestHistory?.action === "undo"
      && latestHistory?.type === `morphe-${latestMorphe.kind}`
      && latestHistory?.page === latestMorphe.page
    ) {
      void redoMorpheCreation(latestMorphe);
      return;
    }
    const stack = redoStacks[pageNum] || [];
    if (stack.length === 0) return;
    const restored = stack[stack.length - 1];
    setRedoStacks((prev) => ({ ...prev, [pageNum]: prev[pageNum].slice(0, -1) }));
    setAnnotations((prev) => ({ ...prev, [pageNum]: [...(prev[pageNum] || []), restored] }));
    logAnnotHistory({ action: "redo", type: restored.type, page: pageNum });
  }, [activeAnnotationSurface, annotHistory, logAnnotHistory, markdownRedoStack, notebookActiveTab, notebookAnnotations, notebookMode, notebookRedoStack, pageNum, redoMorpheCreation, redoStacks, saveMarkdownAnnotations, saveNotebookAnnotations]);

  // Whole-document wipe — every page's annotations AND the entire history
  // log, gone with nothing left to retrieve. Deliberately not routed
  // through logAnnotHistory (which would immediately re-populate the log
  // it just blanked) and deliberately not attaching restorableAnnotations
  // the way handleDeleteHistoryDay's per-day delete does — "no retrieving,
  // blank history" was the explicit point of this one, unlike that one.
  const handleClearAllAnnotations = useCallback(() => {
    const totalCount = totalAnnotationCount;
    if (totalCount === 0) return;
    if (!window.confirm(`Permanently delete all ${totalCount} annotation${totalCount === 1 ? "" : "s"} on every page and blank the entire Annotation History? This cannot be undone — nothing will be left to retrieve.`)) return;

    const clearedLayers = annotationLayersForView.map((layer) => ({ ...layer, annotations: {} }));
    setAnnotationLayers(clearedLayers);
    setAnnotations({});
    setRedoStacks({});
    setAnnotHistory([]);
    // Same reasoning as the other destructive handlers above — persist
    // immediately instead of waiting on the debounced autosave effect.
    const sourceId = currentSourceIdRef.current;
    if (sourceId) {
      authFetch(apiUrl(`/api/source-annotations/${sourceId}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildAnnotationSavePayload({ activeAnnotations: {}, history: [], layers: clearedLayers })),
      }).catch(() => {});
    }
  }, [annotationLayersForView, buildAnnotationSavePayload, totalAnnotationCount]);

  // Deletes every annotation actually created on a given calendar day —
  // not just that day's rows in the history LOG. The log is only a record
  // of actions taken; annotation objects don't carry their own timestamp
  // field, but every one is created with `id: Date.now()` (see the "add"
  // path in the pointer-up handler and commitAnnotText below), so that id
  // doubles as its creation time. Spans every page, not just the current
  // one — a day's drawing session is rarely confined to a single page, and
  // "delete this day" from the history panel means the whole session.
  const handleDeleteHistoryDay = useCallback((day) => {
    const isSameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    const dayHistory = annotHistory.filter((h) => isSameDay(h.time, day));
    if (!dayHistory.length) return;
    const nextLayers = [];
    // Kept alongside the "Cleared" log entry itself (restorableAnnotations
    // below) so the panel can offer a real retrieve/undo for THIS specific
    // delete — not a generic undo stack entry, since undoStacks are
    // per-page and this spans the whole document.
    const removedByLayer = {};
    let removedCount = 0;
    for (const layer of annotationLayersForView) {
      const nextLayerAnnotations = {};
      const removedByPage = {};
      for (const [page, list] of Object.entries(layer.annotations || {})) {
        const kept = [];
        const removed = [];
        for (const ann of list) {
          (isSameDay(new Date(ann.id), day) ? removed : kept).push(ann);
        }
        removedCount += removed.length;
        if (removed.length) removedByPage[page] = removed;
        nextLayerAnnotations[page] = kept;
      }
      if (Object.keys(removedByPage).length) removedByLayer[layer.id] = removedByPage;
      nextLayers.push({ ...layer, annotations: nextLayerAnnotations });
    }
    const dayLabel = day.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
    if (
      !window.confirm(
        removedCount > 0
          ? `Permanently delete ${removedCount} annotation${removedCount === 1 ? "" : "s"} from ${dayLabel}? This cannot be undone.`
          : `Remove the history entries for ${dayLabel}? The annotations from that day were already erased.`
      )
    ) return;

    if (removedCount > 0) {
      setAnnotationLayers(nextLayers);
      setAnnotations(nextLayers.find((layer) => layer.id === activeAnnotationLayer?.id)?.annotations || {});
      setRedoStacks((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const layer of nextLayers) {
          for (const page of Object.keys(layer.annotations || {})) {
            if (next[page]?.length) { next[page] = []; changed = true; }
          }
        }
        return changed ? next : prev;
      });
    }
    // Drop that day's own log rows (the thing the user is deleting from
    // the panel), then log this deletion itself as a fresh "clear" entry —
    // same rendering the "Clear page" button's entries already use, just
    // not tied to a single page, so today's group still shows what happened.
    // restorableAnnotations rides along on THIS entry (not a separate undo
    // stack) so the "retrieve" button next to it — and only it, not every
    // "Cleared" row — knows exactly what to bring back and from where.
    const nextHistory = [
      ...annotHistory.filter((h) => !isSameDay(h.time, day)),
      ...(removedCount > 0
        ? [{ id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, time: new Date(), action: "clear", page: pageNum, count: removedCount, restorableAnnotations: removedByLayer }]
        : []),
    ].slice(-300);
    setAnnotHistory(nextHistory);

    // Same reasoning as handleAnnotClear above — persist immediately rather
    // than waiting on the debounced autosave, since this is destructive
    // and irreversible.
    const sourceId = currentSourceIdRef.current;
    if (sourceId) {
      authFetch(apiUrl(`/api/source-annotations/${sourceId}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildAnnotationSavePayload({
          activeAnnotations: nextLayers.find((layer) => layer.id === activeAnnotationLayer?.id)?.annotations || annotations,
          history: nextHistory,
          layers: nextLayers,
        })),
      }).catch(() => {});
    }
  }, [annotationLayersForView, activeAnnotationLayer, annotations, annotHistory, buildAnnotationSavePayload, pageNum]);

  // Brings back exactly what a specific "Cleared" entry removed (see
  // restorableAnnotations above) — re-inserted onto the same pages they
  // came from, with their original ids intact. Once restored, that entry's
  // own restorableAnnotations is cleared so the retrieve button can't be
  // pressed twice (which would duplicate the restored annotations).
  const handleRestoreHistoryDay = useCallback((entry) => {
    const removedByLayer = entry.restorableAnnotations;
    if (!removedByLayer || !Object.keys(removedByLayer).length) return;

    const nextLayers = annotationLayersForView.map((layer) => ({ ...layer, annotations: { ...(layer.annotations || {}) } }));
    let restoredCount = 0;
    for (const layer of nextLayers) {
      const layerRemoved = removedByLayer[layer.id];
      if (!layerRemoved) continue;
      for (const [page, list] of Object.entries(layerRemoved)) {
        layer.annotations[page] = [...(layer.annotations[page] || []), ...list];
        restoredCount += list.length;
      }
    }
    setAnnotationLayers(nextLayers);
    setAnnotations(nextLayers.find((layer) => layer.id === activeAnnotationLayer?.id)?.annotations || {});

    const nextHistory = [
      ...annotHistory.map((h) => (h.id === entry.id ? { ...h, restorableAnnotations: null } : h)),
      { id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, time: new Date(), action: "restore", page: pageNum, count: restoredCount },
    ].slice(-300);
    setAnnotHistory(nextHistory);

    const sourceId = currentSourceIdRef.current;
    if (sourceId) {
      authFetch(apiUrl(`/api/source-annotations/${sourceId}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildAnnotationSavePayload({
          activeAnnotations: nextLayers.find((layer) => layer.id === activeAnnotationLayer?.id)?.annotations || annotations,
          history: nextHistory,
          layers: nextLayers,
        })),
      }).catch(() => {});
    }
  }, [annotationLayersForView, activeAnnotationLayer, annotations, annotHistory, buildAnnotationSavePayload, pageNum]);

  // Lets an embedding parent drive undo/history/redo externally when
  // hideUndoRedo hides this instance's own copy of that row (see
  // PDFReaderWorkspace.jsx, which hoists it into its tab bar so a single
  // row controls whichever tab is active instead of one per open tab).
  // undoRedoState is reported via onUndoRedoStateChange (an effect, not
  // just exposed on the ref) because a parent can't otherwise know WHEN to
  // re-render its own buttons — refs don't trigger renders on their own.
  const notebookDrawingActive = notebookMode && notebookActiveTab === "drawing";
  useEffect(() => {
    if (activeAnnotationSurface === "md" && !markdownVisualActive) {
      activateAnnotationSurface("pdf");
    } else if (activeAnnotationSurface === "nb" && !notebookDrawingActive) {
      activateAnnotationSurface(markdownVisualActive ? "md" : "pdf");
    }
  }, [activateAnnotationSurface, activeAnnotationSurface, markdownVisualActive, notebookDrawingActive]);
  const undoRedoState = useMemo(() => ({
    canUndo: activeAnnotationSurface === "nb" && notebookDrawingActive
      ? notebookUndoStack.length > 0
      : activeAnnotationSurface === "md"
        ? markdownUndoStack.length > 0 || (markdownAnnotations[pageNum]?.length || 0) > 0
        : (annotations[pageNum]?.length || 0) > 0 || morpheUndoRef.current.some((action) => action.page === pageNum),
    canRedo: activeAnnotationSurface === "nb" && notebookDrawingActive
      ? notebookRedoStack.length > 0
      : activeAnnotationSurface === "md"
        ? markdownRedoStack.length > 0
        : (redoStacks[pageNum]?.length || 0) > 0 || morpheRedoRef.current.some((action) => action.page === pageNum),
    hasHistory: annotHistory.length > 0 || markdownHistoryEntries.length > 0,
    historyOpen: annotHistoryOpen,
    activeSurface: activeAnnotationSurface,
  }), [activeAnnotationSurface, annotations, pageNum, redoStacks, annotHistory.length, annotHistoryOpen, markdownAnnotations, markdownHistoryEntries.length, markdownRedoStack.length, markdownUndoStack.length, notebookDrawingActive, notebookRedoStack.length, notebookUndoStack.length]);

  useEffect(() => {
    onUndoRedoStateChange?.(undoRedoState);
  }, [undoRedoState]); // eslint-disable-line react-hooks/exhaustive-deps -- onUndoRedoStateChange is a stable-enough callback prop, not a reactive dep

  useEffect(() => {
    onAnnotationSaveStateChange?.(annotationSaveStatus);
  }, [annotationSaveStatus, onAnnotationSaveStateChange]);

  // Same pattern as undoRedoState above, for the prev/page-number/next row.
  // readingMode/bookletRightPage ride along here too so an embedding
  // parent (PDFReaderWorkspace) can hoist the Booklet toggle + companion-
  // page picker next to its own hoisted page-nav row the same way.
  // The active match's own matchType/confidence/text — not just the count —
  // so the search bar can show "Likely match: ... Confidence: NN%" for
  // anything found via the tolerant (non-exact) stages, per spec section
  // 54 ("do not show confidence unnecessarily for exact matches").
  const searchActiveMatch = searchMatches[searchActiveIndex] || null;

  const pageNavState = useMemo(() => ({
    pageNum,
    pageCount,
    disabled: pinchActive,
    readingMode,
    bookletRightPage,
    ocrBlankPageOpen: entityBuilderOcrBlankPageOpen,
    markdownOpen: markdownAsideOpen,
    markdownMenuOpen: markdownModeMenuOpen,
    notebookOpen: Boolean(notebookMode),
    notebookMode,
    insertingBlankPage,
    canInsertBlankPage: hasSourceId,
    searchOpen,
    searchQuery,
    searchMatchCount: searchMatches.length,
    searchActiveIndex,
    searchScanning,
    searchActiveMatchType: searchActiveMatch?.matchType ?? null,
    searchActiveConfidence: searchActiveMatch?.confidence ?? null,
    searchActiveMatchedText: searchActiveMatch?.originalMatchedText ?? null,
  }), [pageNum, pageCount, pinchActive, readingMode, bookletRightPage, entityBuilderOcrBlankPageOpen, markdownAsideOpen, markdownModeMenuOpen, notebookMode, insertingBlankPage, hasSourceId, searchOpen, searchQuery, searchMatches.length, searchActiveIndex, searchScanning, searchActiveMatch]);

  useEffect(() => {
    onPageNavStateChange?.(pageNavState);
  }, [pageNavState]); // eslint-disable-line react-hooks/exhaustive-deps -- onPageNavStateChange is a stable-enough callback prop, not a reactive dep

  const zoomState = useMemo(() => ({
    zoom,
    percent: Math.round(zoom * 100),
    canZoomOut: !zoomingDisabled && zoom > MIN_ZOOM,
    canZoomIn: !zoomingDisabled && zoom < MAX_ZOOM,
    disabled: zoomingDisabled,
  }), [zoom, zoomingDisabled]);

  useEffect(() => {
    onZoomStateChange?.(zoomState);
  }, [zoomState]); // eslint-disable-line react-hooks/exhaustive-deps -- callback prop is externally stable enough

  // Commits zoom through the PDF.js viewport. The page wrapper is never
  // visually transformed; the overlay and canvas are rerendered from the
  // same committed viewport.
  const commitLiveZoom = useCallback(() => {
    if (zoomingDisabled) return;
    const state = wheelZoomStateRef.current;
    const wrap = canvasWrapRef.current;
    const el = previewRef.current;
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    if (!wrap || !el) return;
    const finalZoom = normalizePinchZoom(state.pendingZoom);
    if (finalZoom === zoomRef.current) {
      // The gesture ended back at the zoom we're already at — setZoom would
      // bail out on an identical value, so the [zoom]-dependent effect that
      // normally strips this transform would never fire, leaving
      // canvasWrap stuck with an empty-but-present transform/will-change
      // forever. That silently breaks mix-blend-mode on the annotation
      // canvas (a descendant), even though the page itself looks unchanged.
      // The canvas is already the right size here, so clearing immediately
      // is a visual no-op, not a flash back to a stale size.
      wrap.style.transform       = "";
      wrap.style.transformOrigin = "";
      wrap.style.willChange      = "";
      wrap.style.removeProperty("--pdf-live-zoom-inverse");
      return;
    }
    scrollAfterZoomRef.current = captureZoomAnchor(
      el.getBoundingClientRect().left + (el.clientWidth / 2),
      el.getBoundingClientRect().top + (el.clientHeight / 2)
    ) || {
      left: (state.startSL + state.midX) * (finalZoom / state.baseZoom) - state.midX,
      top: (state.startST + state.midY) * (finalZoom / state.baseZoom) - state.midY,
    };
    zoomRef.current = finalZoom;
    setZoom(finalZoom);
  }, [captureZoomAnchor, zoomingDisabled]);

  const previewLiveZoom = useCallback(() => {
    const state = wheelZoomStateRef.current;
    if (state.frame) return;
    state.frame = requestAnimationFrame(() => {
      state.frame = 0;
      const wrap = canvasWrapRef.current;
      if (!wrap) return;
      const ratio = state.pendingZoom / Math.max(PINCH_ZOOM_FLOOR, state.baseZoom);
      const anchorX = state.startSL + state.anchorMidX - wrap.offsetLeft;
      const anchorY = state.startST + state.anchorMidY - wrap.offsetTop;
      const currentX = state.startSL + state.midX - wrap.offsetLeft;
      const currentY = state.startST + state.midY - wrap.offsetTop;
      wrap.style.transformOrigin = "0 0";
      wrap.style.transform = `translate3d(${currentX - anchorX * ratio}px, ${currentY - anchorY * ratio}px, 0) scale(${ratio})`;
      wrap.style.willChange = "transform";
    });
  }, []);

  const scheduleLiveZoomCommit = useCallback(() => {
    const state = wheelZoomStateRef.current;
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      state.timer = null;
      commitLiveZoom();
    }, LIVE_ZOOM_COMMIT_MS);
  }, [commitLiveZoom]);

  // ── Ctrl+Scroll to zoom ────────────────────────────────────────────────────
  useEffect(() => {
    if (zoomingDisabled) return undefined;
    const el = previewRef.current;
    const wrap = canvasWrapRef.current;
    if (!el || !wrap || !pdfDoc) return;
    const onWheel = (e) => {
      stopMomentumScroll(momentumFrameRef); // any wheel input (zoom or a plain scroll) catches a coasting pan
      if (zoomingDisabled) {
        if (e.ctrlKey || e.metaKey) e.preventDefault();
        return;
      }
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const state = wheelZoomStateRef.current;

      // Zoom changes scale only. Keep the saved viewport center fixed rather
      // than letting the mouse location introduce an accidental pan.
      state.midX = el.clientWidth / 2;
      state.midY = el.clientHeight / 2;
      if (!state.timer) {
        state.baseZoom = zoomRef.current;
        state.pendingZoom = zoomRef.current;
        state.startSL = el.scrollLeft;
        state.startST = el.scrollTop;
        state.anchorMidX = state.midX;
        state.anchorMidY = state.midY;
      }

      // 1.08 per tick at gain 1 — dynamicZoomGain shrinks the exponent (not
      // the 1.08 base itself) as pendingZoom drifts from 1.0, same resistance
      // curve the pinch handler uses.
      const tickGain = dynamicZoomGain(1, state.pendingZoom);
      const delta = e.deltaY < 0 ? Math.pow(1.08, tickGain) : Math.pow(1.08, -tickGain);

      state.pendingZoom = normalizePinchZoom(state.pendingZoom * delta);

      // Content-space origin (scroll position + viewport-relative point),
      // not wrap.getBoundingClientRect() — that reflects the transform
      // applied on the PREVIOUS tick once the gesture is underway, which
      // compounds a drift into the origin every tick and made held/repeated
      // zooms slide sideways instead of staying anchored (same fix already
      // applied to the two-finger pinch handler below).
      const originX = state.startSL + state.midX;
      const originY = state.startST + state.midY;
      state.originX = originX;
      state.originY = originY;

      // transform-origin is relative to wrap's OWN border box, not to el's
      // (previewEl's) content-space — but originX/Y above are measured in
      // el's frame (scrollLeft + viewport-relative point). wrap sits offset
      // from el's padding edge by wrap.offsetLeft/Top (el's own padding,
      // plus wrap's margin:auto centering when the page is narrower than
      // the viewer), so that offset must be subtracted out here or the live
      // preview zooms around a point down-and-right of the real cursor —
      // which visibly drifts the shown page up-and-left as the scale grows.
      previewLiveZoom();
      scheduleLiveZoomCommit();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      const state = wheelZoomStateRef.current;
      if (state.timer) {
        clearTimeout(state.timer);
        state.timer = null;
      }
      if (state.frame) {
        cancelAnimationFrame(state.frame);
        state.frame = 0;
      }
      if (wrap.style.transform) {
        wrap.style.transform = "";
        wrap.style.transformOrigin = "";
        wrap.style.willChange = "";
      }
      el.removeEventListener("wheel", onWheel);
    };
  }, [pdfDoc, previewLiveZoom, scheduleLiveZoomCommit, zoomingDisabled]);

  // Keep browser-level page zoom from resizing the reader chrome and Markdown
  // aside. The preview's own Ctrl/Cmd-wheel handler still receives the event
  // and applies zoom to the PDF page only.
  useEffect(() => {
    const preventBrowserZoomWheel = (event) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.cancelable) event.preventDefault();
    };
    const preventBrowserZoomKeys = (event) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (["+", "=", "-", "_", "0"].includes(event.key)) {
        event.preventDefault();
      }
    };
    document.addEventListener("wheel", preventBrowserZoomWheel, { capture: true, passive: false });
    document.addEventListener("keydown", preventBrowserZoomKeys, { capture: true });
    return () => {
      document.removeEventListener("wheel", preventBrowserZoomWheel, { capture: true });
      document.removeEventListener("keydown", preventBrowserZoomKeys, { capture: true });
    };
  }, []);

  const zoomFromCenter = useCallback((nextZoom) => {
    if (zoomingDisabled) return;
    const el = previewRef.current;
    const wrap = canvasWrapRef.current;
    if (!el || !wrap) {
      const baseZoom  = zoomRef.current;
      const rawTarget = typeof nextZoom === "function" ? nextZoom(baseZoom) : nextZoom;
      const targetZoom = normalizeZoom(rawTarget);
      zoomRef.current = targetZoom;
      setZoom(targetZoom);
      return;
    }
    const state = wheelZoomStateRef.current;
    state.midX = el.clientWidth / 2;
    state.midY = el.clientHeight / 2;
    if (!state.timer) {
      state.baseZoom    = zoomRef.current;
      state.pendingZoom = zoomRef.current;
      state.startSL     = el.scrollLeft;
      state.startST     = el.scrollTop;
      state.anchorMidX  = state.midX;
      state.anchorMidY  = state.midY;
    }
    // normalizeZoom (not normalizePinchZoom) so held/repeated clicks stay
    // clamped to [MIN_ZOOM, MAX_ZOOM] — the looser pinch bound is only for
    // an actual pinch gesture, which is allowed to briefly overshoot.
    // A function nextZoom is always an incremental step (the +/- buttons,
    // held or clicked) — dampen that step the same way pinch/ctrl-scroll
    // are dampened. A plain numeric nextZoom is a deliberate absolute jump
    // (e.g. reset to 100%), which should land exactly, not be resisted.
    let rawTarget;
    if (typeof nextZoom === "function") {
      const rawStep = nextZoom(state.pendingZoom) - state.pendingZoom;
      rawTarget = state.pendingZoom + rawStep * dynamicZoomGain(1, state.pendingZoom);
    } else {
      rawTarget = nextZoom;
    }
    state.pendingZoom = normalizeZoom(rawTarget);

    // Viewport center, in viewport-relative coordinates — el (the scroll
    // container) is never itself transformed, so this is safe to re-read
    // every tick.
    // Content-space origin (scroll position + viewport-relative point), not
    // wrap.getBoundingClientRect() — that reflects the transform applied on
    // the PREVIOUS tick once the gesture is underway, which compounds a
    // drift into the origin on every tick and is what made a held zoom
    // slide the page sideways instead of staying centered.
    const originX = state.startSL + state.midX;
    const originY = state.startST + state.midY;
    state.originX = originX;
    state.originY = originY;

    // Same wrap-vs-el frame mismatch as the ctrl+scroll handler above:
    // transform-origin is relative to wrap's own border box, so wrap's own
    // offset within el (padding + auto-centering margin) must be subtracted
    // from the el-frame origin computed above.
    previewLiveZoom();
    scheduleLiveZoomCommit();
  }, [previewLiveZoom, scheduleLiveZoomCommit, zoomingDisabled]);

  // Toolbar zoom is a discrete command, not a live gesture. Keep it out of
  // the wheel/pinch transaction state so a stale gesture or a temporarily
  // unmounted MD layout can never swallow a +/- click.
  const zoomFromToolbar = useCallback((nextZoom) => {
    if (zoomingDisabled) return;
    const currentZoom = zoomRef.current;
    const rawTarget = typeof nextZoom === "function" ? nextZoom(currentZoom) : nextZoom;
    const targetZoom = normalizeZoom(rawTarget);
    if (targetZoom === currentZoom) return;

    const el = previewRef.current;
    const wrap = canvasWrapRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      scrollAfterZoomRef.current = captureZoomAnchor(
        rect.left + el.clientWidth / 2,
        rect.top + el.clientHeight / 2,
      ) || { left: el.scrollLeft, top: el.scrollTop };
    }
    const gesture = wheelZoomStateRef.current;
    if (gesture.timer) clearTimeout(gesture.timer);
    if (gesture.frame) cancelAnimationFrame(gesture.frame);
    gesture.timer = null;
    gesture.frame = 0;
    gesture.baseZoom = targetZoom;
    gesture.pendingZoom = targetZoom;
    if (wrap) {
      wrap.style.transform = "";
      wrap.style.transformOrigin = "";
      wrap.style.willChange = "";
      wrap.style.removeProperty("--pdf-live-zoom-inverse");
    }
    zoomRef.current = targetZoom;
    setZoom(targetZoom);
  }, [captureZoomAnchor, zoomingDisabled]);

  useImperativeHandle(ref, () => ({
    undo: handleAnnotUndo,
    redo: handleAnnotRedo,
    toggleHistory: () => setAnnotHistoryOpen((v) => !v),
    ...undoRedoState,
    goToPrevPage: () => setPageNum((n) => Math.max(1, n - 1)),
    goToNextPage: () => setPageNum((n) => Math.min(pageCount, n + 1)),
    setReadingMode: setReaderReadingMode,
    setBookletRightPage,
    toggleOcrBlankPage,
    toggleMarkdownAside,
    setNotebookView,
    closeNotebook,
    insertBlankPageAfterCurrent: () => insertBlankPageRef.current?.(),
    setSearchOpen,
    setSearchQuery,
    goToSearchMatch,
    closeSearch: () => { setSearchOpen(false); setSearchQuery(""); },
    zoomIn: () => zoomFromToolbar((z) => z + 0.01),
    zoomOut: () => zoomFromToolbar((z) => z - 0.01),
    resetZoom: () => zoomFromToolbar(1),
    setZoomLevel: (value) => zoomFromToolbar(value),
    notebookZoomIn: () => zoomNotebookDrawingAt((z) => z + 0.01),
    notebookZoomOut: () => zoomNotebookDrawingAt((z) => z - 0.01),
    resetNotebookZoom: () => zoomNotebookDrawingAt(1),
    setNotebookZoomLevel: (value) => zoomNotebookDrawingAt(value),
    ...zoomState,
    ...pageNavState,
  }), [handleAnnotUndo, handleAnnotRedo, undoRedoState, pageCount, pageNavState, goToSearchMatch, toggleOcrBlankPage, toggleMarkdownAside, setNotebookView, closeNotebook, setReaderReadingMode, zoomFromToolbar, zoomNotebookDrawingAt, zoomState]);

  const stopZoomHold = useCallback(() => {
    if (zoomHoldTimerRef.current) {
      clearTimeout(zoomHoldTimerRef.current);
      zoomHoldTimerRef.current = null;
    }
    if (zoomHoldIntervalRef.current) {
      clearInterval(zoomHoldIntervalRef.current);
      zoomHoldIntervalRef.current = null;
    }
  }, []);

  const startZoomHold = useCallback((step) => {
    if (zoomingDisabled) return;
    stopZoomHold();
    zoomHoldTimerRef.current = setTimeout(() => {
      zoomHoldTimerRef.current = null;
      const holdStart = performance.now();
      zoomHoldIntervalRef.current = setInterval(() => {
        // Accelerates the longer the button stays held — quadratic ease-in
        // so a quick tap-and-hold still feels like the old fixed 1%/tick,
        // but a sustained hold ramps up to ZOOM_HOLD_MAX_MULTIPLIER× for
        // covering a big zoom range without a dozen individual presses.
        const heldMs = performance.now() - holdStart;
        const rampT = Math.min(1, heldMs / ZOOM_HOLD_RAMP_MS);
        const multiplier = 1 + (ZOOM_HOLD_MAX_MULTIPLIER - 1) * rampT * rampT;
        zoomFromCenter((z) => z + step * multiplier);
      }, ZOOM_HOLD_TICK_MS);
    }, 220);
  }, [stopZoomHold, zoomFromCenter, zoomingDisabled]);

  useEffect(() => {
    if (zoomingDisabled) return undefined;
    const stop = () => stopZoomHold();
    window.addEventListener("mouseup", stop);
    window.addEventListener("touchend", stop, { passive: true });
    window.addEventListener("touchcancel", stop, { passive: true });
    return () => {
      window.removeEventListener("mouseup", stop);
      window.removeEventListener("touchend", stop);
      window.removeEventListener("touchcancel", stop);
      stopZoomHold();
    };
  }, [stopZoomHold, zoomingDisabled]);

  const handleAnnotUndoRef = useRef(handleAnnotUndo);
  handleAnnotUndoRef.current = handleAnnotUndo;

  // ── Two-finger pinch zoom + single-finger pan + tap word selection ─────────
  useEffect(() => {
    const el = previewRef.current;
    if (!el || !pdfDoc) return;

    const MOVE_THRESHOLD = 8;
    const TWO_FINGER_UNDO_MOVE_THRESHOLD = 34;
    const TWO_FINGER_UNDO_MAX_MS = 420;
    const PINCH_COOLDOWN_MS = 350;
    const MIN_PINCH_START_DIST = 28;
    const PINCH_JITTER_PX = 3;
    // A raw 1:1 mapping of finger-distance ratio to zoom ratio needs a huge,
    // uncomfortable finger spread to cover a wide zoom range in one gesture.
    // Amplifying it in log-space (same trick apps like GoodNotes use) lets a
    // normal, comfortable pinch motion sweep a much bigger zoom range.
    const PINCH_GAIN = 1.7;

    let lastMidX = 0, lastMidY = 0;
    let twoFingerUndoCandidate = null;
    let startDist = null;
    let pinchPrimed = false;
    let startZoom = 1;
    let startMidX = 0, startMidY = 0, startSL = 0, startST = 0;
    let lastPinchZoom = 1;
    let pinchCooldownUntil = 0;
    let pinchTransformApplied = false;
    let pinchRaf = 0;
    let targetScale = 1;
    let targetX = 0;
    let targetY = 0;

    const animatePinch = () => {
      pinchRaf = 0;
      const wrap = canvasWrapRef.current;
      if (!wrap) return;
      wrap.style.transformOrigin = "0 0";
      wrap.style.transform = `translate3d(${targetX}px, ${targetY}px, 0) scale(${targetScale})`;
      wrap.style.willChange = "transform";
      pinchTransformApplied = true;
    };

    const startPinchAnimation = () => {
      if (!pinchRaf) pinchRaf = requestAnimationFrame(animatePinch);
    };

    const fireTwoFingerUndo = () => {
      if (twoFingerUndoCandidate?.timer) clearTimeout(twoFingerUndoCandidate.timer);
      twoFingerUndoCandidate = null;
      handleAnnotUndoRef.current?.();
      navigator.vibrate?.(20);
    };

    let panX = 0, panY = 0, panSL = 0, panST = 0;
    const panVelocityTracker = createVelocityTracker();
    let hasMoved = false;
    let touchInteractionActive = false;
    // A real pinch almost never lifts both fingers in exact sync — one
    // finger lifting first fires touchend at touches.length===1 (where
    // commitPinchZoom() actually runs, see below), then the second fires a
    // SEPARATE touchend at touches.length===0 a beat later. That second
    // event used to fall straight into the touches.length===0 branch below
    // and call syncLivePan() unconditionally, forcing scrollLeft/scrollTop
    // to livePanRef's currentL/currentT — which a pinch-only gesture never
    // touches, so it's still whatever stale value (often the untouched
    // {0,0} default) was left over from before. That synchronous DOM write
    // raced the zoom-to-point correction effect (which is deferred behind
    // an async re-render) and could win, snapping the freshly-zoomed page
    // back to its own upper-left corner right as the pinch lifted. Set the
    // instant commitPinchZoom() actually runs, checked and cleared the
    // instant the last finger lifts — mirrors the annotToolRef.current
    // guard just below it, which fixes the identical race for a drawing
    // stroke's own touch-lift.
    let pinchJustEnded = false;

    // Selection is double-click/double-tap only — a single word, no drag or
    // long-press range expansion. Just need last-tap bookkeeping to detect
    // the second tap of a double-tap on touch (dblclick handles mouse).
    let lastTapTime = 0, lastTapX = 0, lastTapY = 0;
    const DOUBLE_TAP_MS = 350;
    const DOUBLE_TAP_DIST = 30;

    const touchDist = (t) => {
      const dx = t[0].clientX - t[1].clientX;
      const dy = t[0].clientY - t[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };

    // Three-finger pan's own reference point — the average of all three
    // touches, so the gesture tracks smoothly even if the fingers don't
    // move in perfect unison.
    const touchCentroid = (t) => {
      let x = 0, y = 0;
      for (let i = 0; i < t.length; i++) { x += t[i].clientX; y += t[i].clientY; }
      return { x: x / t.length, y: y / t.length };
    };

    // Keep the gesture preview local and smooth. PDF.js rerenders only when
    // the gesture commits, while the shared canvas/page/annotation wrapper
    // follows the fingers at animation-frame cadence.
    const commitPinchZoom = () => {
      if (!pinchPrimed || lastPinchZoom === startZoom) {
        if (pinchRaf) cancelAnimationFrame(pinchRaf);
        pinchRaf = 0;
        targetScale = 1;
        targetX = 0;
        targetY = 0;
        const wrap = canvasWrapRef.current;
        if (wrap) {
          wrap.style.transform = "";
          wrap.style.transformOrigin = "";
          wrap.style.willChange = "";
        }
        pinchTransformApplied = false;
        return;
      }
      const centerX = el.clientWidth / 2;
      const centerY = el.clientHeight / 2;
      scrollAfterZoomRef.current = captureZoomAnchor(
        el.getBoundingClientRect().left + centerX,
        el.getBoundingClientRect().top + centerY
      ) || {
        // The canvas normally supplies a normalized anchor. This fallback
        // preserves the same viewport center if it is briefly unavailable.
        left: (startSL + centerX) * (lastPinchZoom / startZoom) - centerX,
        top: (startST + centerY) * (lastPinchZoom / startZoom) - centerY,
      };
      targetScale = lastPinchZoom / startZoom;
      startPinchAnimation();
      zoomRef.current = lastPinchZoom;
      setZoom(lastPinchZoom);
    };

    // Drops an in-progress pinch entirely — no setZoom, unlike
    // commitPinchZoom above. Used when a third finger lands mid-pinch (see
    // onTouchStart's 3-finger branch): three-finger touches are pan-only, so
    // whatever zoom ratio the pinch happened to be at the instant the third
    // finger touched down must never be applied, not even the ratio itself.
    const cancelPinchZoom = () => {
      if (pinchRaf) cancelAnimationFrame(pinchRaf);
      pinchRaf = 0;
      const wrap = canvasWrapRef.current;
      if (wrap) {
        wrap.style.transform       = "";
        wrap.style.transformOrigin = "";
        wrap.style.willChange      = "";
        wrap.style.removeProperty("--pdf-live-zoom-inverse");
      }
      pinchTransformApplied = false;
    };

    // Manual hit-test against the text layer's own spans, instead of
    // document.elementFromPoint(cx, cy) — WebKit has long-standing bugs
    // where elementFromPoint doesn't correctly account for the
    // non-standard CSS `zoom` property this app uses for its own zoom
    // feature (document.body.style.zoom, see bodyZoom elsewhere in this
    // file), while getBoundingClientRect() does. Confirmed live: this
    // mismatches badly enough on iPad Safari that a tap on one word
    // resolves to an entirely unrelated span elsewhere on the page.
    // getBoundingClientRect() is what everything else here already
    // trusts (visuallyConnected, the merge-cap logic, the handle-drag
    // math), so hit-testing against it too keeps every coordinate in this
    // function consistent, regardless of what elementFromPoint does.
    const layerPointFromClient = (cx, cy) => {
      const layer = textLayerRef.current;
      if (!layer) return null;
      const layerRect = layer.getBoundingClientRect();
      const bodyZoom = parseFloat(document.body.style.zoom) || 1;
      return {
        x: (cx - layerRect.left) / bodyZoom,
        y: (cy - layerRect.top) / bodyZoom,
        layerRect,
        bodyZoom,
      };
    };

    const spanAtPoint = (cx, cy) => {
      const point = layerPointFromClient(cx, cy);
      if (!point) return null;
      const { x, y, layerRect, bodyZoom } = point;
      let nearest = null;
      let nearestDist = Infinity;
      for (const sp of spansRef.current) {
        const r = sp.el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        const left = (r.left - layerRect.left) / bodyZoom;
        const top = (r.top - layerRect.top) / bodyZoom;
        const right = (r.right - layerRect.left) / bodyZoom;
        const bottom = (r.bottom - layerRect.top) / bodyZoom;
        if (x >= left && x <= right && y >= top && y <= bottom) return sp.el;
        // Sub-pixel/rounding gaps between adjacent spans can leave a point
        // just outside every rect — track the closest one as a fallback.
        const dx = Math.max(left - x, 0, x - right);
        const dy = Math.max(top - y, 0, y - bottom);
        const dist = Math.hypot(dx, dy);
        if (dist < nearestDist) { nearestDist = dist; nearest = sp.el; }
      }
      return nearestDist <= 3 ? nearest : null;
    };

    const bboxMatchesSpan = (bbox, span) => {
      if (!bbox || !span) return false;
      const spanRect = span.el?.getBoundingClientRect?.();
      const canvasRect = annotCanvasRef.current?.getBoundingClientRect?.();
      const zoomFactor = Math.max(1, Math.min(1.2, zoomRef.current));
      const scale = fitScaleRef.current * zoomFactor;
      const leftPad = Math.max(2, 1.5 * zoomFactor);
      const rightPad = Math.max(4, 3.2 * zoomFactor);
      const padY = Math.max(2.5, 2.2 * zoomFactor);
      const overlapThreshold = 0.58;
      if (!spanRect || !canvasRect) {
        const left = span.geoLeft ?? 0;
        const right = span.geoRight ?? 0;
        const top = span.geoTop ?? 0;
        const bottom = top + (span.geoHeight ?? 0);
        const bboxRight = bbox.x + bbox.w;
        const bboxBottom = bbox.y + bbox.h;
        const overlapX = Math.max(0, Math.min(right, bboxRight + rightPad) - Math.max(left, bbox.x - leftPad));
        const overlapY = Math.max(0, Math.min(bottom, bboxBottom + padY) - Math.max(top, bbox.y - padY));
        const spanWidth = Math.max(1, right - left);
        const centerX = (left + right) / 2;
        const centerInside = centerX >= bbox.x && centerX <= bboxRight;
        return overlapY > 0 && (centerInside || overlapX / spanWidth >= overlapThreshold);
      }
      const bboxLeft = canvasRect.left + bbox.x * scale;
      const bboxTop = canvasRect.top + bbox.y * scale;
      const bboxRight = canvasRect.left + (bbox.x + bbox.w) * scale;
      const bboxBottom = canvasRect.top + (bbox.y + bbox.h) * scale;
      const overlapX = Math.max(0, Math.min(spanRect.right, bboxRight + rightPad) - Math.max(spanRect.left, bboxLeft - leftPad));
      const overlapY = Math.max(0, Math.min(spanRect.bottom, bboxBottom + padY) - Math.max(spanRect.top, bboxTop - padY));
      const spanWidth = Math.max(1, spanRect.right - spanRect.left);
      const centerX = (spanRect.left + spanRect.right) / 2;
      const centerInside = centerX >= bboxLeft && centerX <= bboxRight;
      return overlapY > 0 && (centerInside || overlapX / spanWidth >= overlapThreshold);
    };

    const regionForSpanIndex = (spanIdx) => {
      const span = spansRef.current[spanIdx];
      if (!span) return null;
      return selectionBboxes
        .filter((bbox) => bboxMatchesSpan(bbox, span))
        .sort((a, b) => (a.w * a.h) - (b.w * b.h))[0] || null;
    };

    const selectWordAt = (cx, cy) => {
      const target = spanAtPoint(cx, cy);
      const layer  = textLayerRef.current;
      if (!target || !layer || !layer.contains(target)) return null;
      const point = layerPointFromClient(cx, cy);
      if (!point) return null;
      const { x, layerRect, bodyZoom } = point;

      const textNode = target.firstChild;
      if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return null;
      const text = textNode.textContent;
      if (!text.trim()) return null;

      const spanIdx = parseInt(target.dataset.spanIdx ?? "-1", 10);
      if (spanIdx < 0) return null;

      const r     = target.getBoundingClientRect();
      const left  = (r.left - layerRect.left) / bodyZoom;
      const width  = r.width / bodyZoom;
      const ratio = width > 0 ? (x - left) / width : 0;
      let s = Math.round(ratio * text.length);
      let e = s;
      while (s > 0          && /\S/.test(text[s - 1])) s--;
      while (e < text.length && /\S/.test(text[e]))     e++;
      if (s === e) return null;

      const spans = spansRef.current;
      const selectionRegion = regionForSpanIndex(spanIdx);
      // Only merge neighboring spans when they are visually connected. Some
      // PDFs split normal spaced words into separate text items without an
      // actual whitespace token, so "no literal space" is not enough proof
      // that two spans belong to one word.
      // Vertical CENTER, not top — a drop-cap/small-caps run sits at a
      // different font size than the rest of its own word (confirmed live:
      // "B"'s top and "radyarrhythmias"'s top differ by ~2px even though
      // they're the same word), so comparing tops under-tolerates same-word
      // fragments and, worse, on some renderers (confirmed: reproduces on
      // iPad Safari, not desktop Chrome) over-tolerates true cross-column
      // bleed in a dense two-column layout where two unrelated lines can
      // land within the top-based tolerance band.
      // Reads geoLeft/geoRight/geoTop/geoHeight (deterministic PDF-space
      // numbers, set alongside each span's CSS at creation time), NOT
      // getBoundingClientRect() — see the geo* fields' own comment above
      // for why: confirmed live on iPad Safari that getBoundingClientRect
      // reports a real gap for a pair the PDF's own data proves is
      // touching (gap 0), while desktop Chrome reports that same pair
      // correctly as touching. Using the pre-transform source numbers
      // instead sidesteps whatever WebKit does differently, on any device.
      const visuallyConnected = (a, b) => {
        if (!a || !b) return false;
        if (selectionRegion && (!bboxMatchesSpan(selectionRegion, a) || !bboxMatchesSpan(selectionRegion, b))) return false;
        const h = Math.max(a.geoHeight, b.geoHeight, 1);
        const acy = a.geoTop + a.geoHeight / 2;
        const bcy = b.geoTop + b.geoHeight / 2;
        const sameLine = Math.abs(acy - bcy) < h * 0.6;
        const gap = b.geoLeft - a.geoRight;
        return sameLine && gap <= Math.max(1.5, h * 0.12);
      };
      // Hard sanity caps, independent of the visuallyConnected heuristic
      // above — belt and suspenders. Confirmed live on iPad Safari: a
      // double-tap on "B" (in "Bradyarrhythmias", left TOC column) merged
      // clear across the page into the right column's "Secondary
      // Hypertension 63", producing "econdary hypertention 63
      // radyarrhythmias" as the "selected word" — whatever the underlying
      // per-pair gap miscalculation was, a single legitimately-fragmented
      // word never needs more than a handful of extra spans or anywhere
      // close to 40 characters, so both caps stop a runaway merge cold
      // regardless of root cause.
      const MAX_WORD_MERGE_SPANS = 8;
      const MAX_MERGED_WORD_LENGTH = 40;
      let loIdx = spanIdx, hiIdx = spanIdx;
      if (s === 0) {
        let mergedLen = text.length;
        while (
          loIdx > 0
          && spanIdx - loIdx < MAX_WORD_MERGE_SPANS
          && mergedLen < MAX_MERGED_WORD_LENGTH
          && visuallyConnected(spans[loIdx - 1], spans[loIdx])
          && !/\s$/.test(spans[loIdx - 1]?.el.textContent || " ")
        ) {
          mergedLen += (spans[loIdx - 1]?.el.textContent || "").length;
          loIdx--;
        }
      }
      if (e === text.length) {
        let mergedLen = text.length;
        while (
          hiIdx < spans.length - 1
          && hiIdx - spanIdx < MAX_WORD_MERGE_SPANS
          && mergedLen < MAX_MERGED_WORD_LENGTH
          && visuallyConnected(spans[hiIdx], spans[hiIdx + 1])
          && !/^\s/.test(spans[hiIdx + 1]?.el.textContent || " ")
        ) {
          mergedLen += (spans[hiIdx + 1]?.el.textContent || "").length;
          hiIdx++;
        }
      }

      // No separator: every span in [loIdx, hiIdx] passed visuallyConnected
      // (near-zero gap) and is guaranteed non-whitespace (the expansion
      // loops above stop at the first span bordering real whitespace), so
      // these are fragments of one word split across PDF text items —
      // common with stylized headers whose drop-cap/small-caps run sits in
      // a different font item than the rest of the word, glued with a zero
      // gap. Joining with a literal space used to insert one mid-word
      // ("B radyarrhythmias" instead of "Bradyarrhythmias").
      const parts = [
        ...spans.slice(loIdx, spanIdx).map((sp) => sp.el.textContent),
        text.substring(s, e),
        ...spans.slice(spanIdx + 1, hiIdx + 1).map((sp) => sp.el.textContent),
      ];
      const word = sanitizeSelectedText(parts.join(""));

      if (!word) return null;
      window.getSelection()?.removeAllRanges();

      // Centered on the FULL merged word (loIdx..hiIdx), not just the one
      // sub-span the click happened to land on — a word split across
      // several PDF text items (common with kerned/stylized text) has
      // `target` be only its first/middle/last fragment, and centering on
      // that alone shifted the popup left or right of the word's real
      // center depending on which fragment got clicked.
      const firstEl = spans[loIdx]?.el;
      const lastEl  = spans[hiIdx]?.el;
      const firstLeft = parseFloat(firstEl?.style.left || "0");
      const lastLeft  = parseFloat(lastEl?.style.left || "0");
      const lastWidth = parseFloat(lastEl?.style.width || "0") || lastEl?.offsetWidth || 0;
      const bx = (firstLeft + lastLeft + lastWidth) / 2;
      const by = parseFloat(lastEl?.style.top || "0") + (parseFloat(lastEl?.style.height || "0") || lastEl?.offsetHeight || 0) + 8;
      return { text: word, spanIdx: loIdx, endIdx: hiIdx, regionId: selectionRegion?.id ?? null, x: bx, y: by };
    };

    // Double-click (mouse) / double-tap (touch) entry point — always exactly
    // the single word under the point, never a range.
    const selectWordAtPoint = (cx, cy) => {
      const exact = selectWordAt(cx, cy);
      if (!exact) return;
      if (hideHyleControls || onSelectionActionRef.current) {
        // startCharOffset/endCharOffset default to the FULL word (0 →
        // length) — a fresh double-click always selects the whole word;
        // dragging a handle afterward is what narrows/widens character by
        // character (see updateSelectionEdge below).
        const endSpanText = spansRef.current[exact.endIdx]?.text ?? spansRef.current[exact.endIdx]?.el?.textContent ?? "";
        setManualSelection({
          startIdx: exact.spanIdx,
          endIdx: exact.endIdx,
          startSpanKey: spansRef.current[exact.spanIdx]?.spanKey ?? null,
          endSpanKey: spansRef.current[exact.endIdx]?.spanKey ?? null,
          startCharOffset: 0,
          endCharOffset: endSpanText.length,
          regionId: exact.regionId ?? null,
          text: exact.text,
          x: exact.x,
          y: exact.y,
        });
      } else {
        const noun = exact.text.toLowerCase().replace(/[.,;:]+$/, "").replace(/\s+/g, " ").trim();
        setManualHyle(noun);
        setManualPopup({ x: exact.x, y: exact.y + 2 });
        setManualSelection(null);
      }
      navigator.vibrate?.(30);
    };

    const onTouchStart = (e) => {
      livePanRef.current.active = false;
      stopLivePan(livePanRef);
      stopMomentumScroll(momentumFrameRef); // grabbing the page always catches it mid-coast
      pinchJustEnded = false; // a brand new touch sequence starting — any earlier pinch's tail is over

      if (annotToolRef.current && e.touches.length === 1) {
        touchInteractionActive = true;
        hasMoved = true;
        return;
      }

      if (e.touches.length === 2) {
        // A two-finger gesture is owned by the PDF reader. Prevent Safari/
        // Chrome from synthesizing a single-finger click after the gesture,
        // which could otherwise activate the nearby Insert Blank Page button.
        if (e.cancelable) e.preventDefault();
        touchInteractionActive = true; // wasn't being set for the 2-finger case at all — left text selection unblocked during a pinch
        if (zoomingDisabled) {
          hasMoved = true;
          return;
        }
        const elRect = el.getBoundingClientRect();
        startDist = touchDist(e.touches);
        pinchPrimed = startDist >= MIN_PINCH_START_DIST;
        if (pinchPrimed) setPinchActive(true);
        startZoom = zoomRef.current;
        lastPinchZoom = startZoom;
        lastMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - elRect.left;
        lastMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - elRect.top;
        startMidX = el.clientWidth / 2;
        startMidY = el.clientHeight / 2;
        startSL = el.scrollLeft;
        startST = el.scrollTop;
        twoFingerUndoCandidate = {
          startedAt: Date.now(),
          startDist,
          startMidX: lastMidX,
          startMidY: lastMidY,
          timer: setTimeout(() => {
            if (!twoFingerUndoCandidate) return;
            fireTwoFingerUndo();
          }, 180),
        };
      } else if (e.touches.length === 3) {
        // Three-finger pan — deliberately a different finger count from
        // pinch-zoom/two-finger-undo (both still exactly 2 fingers,
        // untouched above), so this never has to share or fight over the
        // same gesture-detection state. Always available regardless of
        // which drawing tool (if any) is currently selected — panning is
        // no longer tied to a "Navigator" tool at all (deleted; see
        // ANNOT_TOOLS). Reuses the same pan/panVelocityTracker/livePanRef
        // machinery a single-finger pan used to drive.
        //
        // Real fingers almost never land as one clean 3-touch event — a
        // pinch (2 fingers) is already in progress on most real gestures by
        // the time a third finger touches down. Removing a finger fires
        // touchend, but ADDING one fires a fresh touchstart with all 3
        // touches, landing right here — with no cleanup, the pinch's live
        // CSS preview transform (see onTouchMove's 2-finger branch) stayed
        // frozen on screen while panning scrolled underneath it, i.e.
        // three-finger touch visibly zoomed. Three-finger touches are
        // pan-only, so any in-progress pinch is dropped outright here
        // (cancelPinchZoom, not commitPinchZoom — the zoom ratio mid-pinch
        // is never applied, not even the ratio it was at).
        if (startDist !== null) {
          cancelPinchZoom();
          startDist = null;
          pinchPrimed = false;
          setPinchActive(false);
          if (twoFingerUndoCandidate) {
            if (twoFingerUndoCandidate.timer) clearTimeout(twoFingerUndoCandidate.timer);
            twoFingerUndoCandidate = null;
          }
        }
        touchInteractionActive = true;
        const c = touchCentroid(e.touches);
        panX = c.x;
        panY = c.y;
        panSL = el.scrollLeft;
        panST = el.scrollTop;
        panVelocityTracker.reset();
        panVelocityTracker.push(panX, panY, performance.now());
        livePanRef.current.currentL = panSL;
        livePanRef.current.currentT = panST;
        livePanRef.current.targetL = panSL;
        livePanRef.current.targetT = panST;
        livePanRef.current.active = true;
        hasMoved = false;
      } else if (e.touches.length === 1) {
        // No longer a pan trigger (panning is three-finger only, see
        // above) — this single-finger tracking only exists so onTouchEnd's
        // tap-vs-drag bookkeeping (hasMoved) and double-tap-to-select still
        // work, and so a real drawing stroke (handled by the annotation
        // canvas's own listeners, not this one) isn't fought over — this
        // handler deliberately never calls preventDefault()/touches
        // scroll state for the 1-finger case anymore.
        touchInteractionActive = true;
        panX = e.touches[0].clientX;
        panY = e.touches[0].clientY;
        hasMoved = false;
      }
    };

    const onTouchMove = (e) => {
      // NOTE: this branch used to be gated on `twoFingerUndoCandidate` being
      // truthy, but that candidate gets nulled out (below) the moment the
      // gesture moves past the two-finger-undo threshold — which any real
      // pinch does almost immediately. That froze pinch-zoom a few frames
      // into every gesture. The gate now tracks the pinch itself
      // (`startDist !== null`, set in onTouchStart) so zoom keeps updating
      // for the whole gesture; the undo-candidate check still runs inside,
      // independently, purely to decide whether to fire the undo gesture.
      if (e.touches.length === 2 && startDist !== null) {
        if (zoomingDisabled) return;
        e.preventDefault();
        const nextDist = touchDist(e.touches);
        const elRect = el.getBoundingClientRect();
        lastMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - elRect.left;
        lastMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - elRect.top;
        if (twoFingerUndoCandidate) {
          const movedFar =
            Math.abs(nextDist - twoFingerUndoCandidate.startDist) > TWO_FINGER_UNDO_MOVE_THRESHOLD ||
            Math.hypot(lastMidX - twoFingerUndoCandidate.startMidX, lastMidY - twoFingerUndoCandidate.startMidY) > TWO_FINGER_UNDO_MOVE_THRESHOLD;
          if (movedFar) {
            if (twoFingerUndoCandidate.timer) clearTimeout(twoFingerUndoCandidate.timer);
            twoFingerUndoCandidate = null;
          }
        }
        if (!pinchPrimed) {
          if (nextDist < MIN_PINCH_START_DIST) return;
          startDist = nextDist;
          startZoom = zoomRef.current;
          startMidX = el.clientWidth / 2;
          startMidY = el.clientHeight / 2;
          startSL = el.scrollLeft;
          startST = el.scrollTop;
          lastPinchZoom = startZoom;
          pinchPrimed = true;
          setPinchActive(true);
          return;
        }
        if (Math.abs(nextDist - startDist) < PINCH_JITTER_PX) return;
        const rawRatio = Math.max(0.01, nextDist / startDist);
        const newZoom = normalizePinchZoom(startZoom * Math.pow(rawRatio, dynamicZoomGain(PINCH_GAIN, startZoom)));
        if (newZoom === lastPinchZoom) return;
        lastPinchZoom = newZoom;
        // A real zoom change is happening — a pinch must never also fire the
        // two-finger-undo gesture below it, no matter how small or slow the
        // motion was (the movedFar check above uses a distance THRESHOLD, so
        // a small-but-real pinch that stays under it could still leave this
        // candidate alive and fire an unwanted undo on release). Once the
        // zoom has actually moved, that's unambiguous: this is a pinch, not
        // a tap, full stop.
        if (twoFingerUndoCandidate) {
          if (twoFingerUndoCandidate.timer) clearTimeout(twoFingerUndoCandidate.timer);
          twoFingerUndoCandidate = null;
        }
        const wrap = canvasWrapRef.current;
        if (wrap) {
          const ratio = newZoom / startZoom;
          const anchorX = startSL + startMidX - wrap.offsetLeft;
          const anchorY = startST + startMidY - wrap.offsetTop;
          const currentX = startSL + startMidX - wrap.offsetLeft;
          const currentY = startST + startMidY - wrap.offsetTop;
          targetScale = ratio;
          targetX = currentX - anchorX * ratio;
          targetY = currentY - anchorY * ratio;
          startPinchAnimation();
        }
        return;
      }
      if (e.touches.length === 3) {
        // Three-finger pan move — same mechanics single-finger pan used to
        // drive, just anchored to the 3-touch centroid instead. See the
        // matching branch in onTouchStart for why this is a distinct
        // finger count from pinch-zoom/two-finger-undo above.
        if (Date.now() < pinchCooldownUntil) return;
        const c = touchCentroid(e.touches);
        const dx = c.x - panX;
        const dy = c.y - panY;
        const moved = Math.sqrt(dx * dx + dy * dy);
        if (!hasMoved && moved < MOVE_THRESHOLD) return;

        hasMoved = true;
        e.preventDefault();
        livePanRef.current.targetL = panSL - dx;
        livePanRef.current.targetT = panST - dy;
        if (!livePanRef.current.frame) runLivePan(el, livePanRef);
        panVelocityTracker.push(c.x, c.y, performance.now());
        return;
      }

      if (e.touches.length !== 1) return;
      if (annotToolRef.current) {
        hasMoved = true;
        return;
      }
      // No longer a pan trigger — see the matching branch in onTouchStart.
      // Only tracks hasMoved so onTouchEnd can still tell a tap from a drag
      // for double-tap-to-select; never calls preventDefault() or touches
      // scroll state, so it can't interfere with a real drawing stroke
      // (handled by the annotation canvas's own listeners) or block native
      // behavior.
      if (Date.now() < pinchCooldownUntil) return;
      const dx = e.touches[0].clientX - panX;
      const dy = e.touches[0].clientY - panY;
      const moved = Math.sqrt(dx * dx + dy * dy);
      if (!hasMoved && moved >= MOVE_THRESHOLD) hasMoved = true;
    };

    const onTouchEnd = (e) => {
      if ((twoFingerUndoCandidate || startDist !== null) && e.cancelable) e.preventDefault();
      touchInteractionActive = e.touches.length > 0;

      if (e.touches.length < 2 && twoFingerUndoCandidate) {
        if (Date.now() - twoFingerUndoCandidate.startedAt <= TWO_FINGER_UNDO_MAX_MS) {
          fireTwoFingerUndo();
          return;
        }
        if (twoFingerUndoCandidate.timer) clearTimeout(twoFingerUndoCandidate.timer);
        twoFingerUndoCandidate = null;
      }

      if (e.touches.length < 2 && startDist !== null) {
        if (zoomingDisabled) {
          startDist = null;
          pinchPrimed = false;
          pinchCooldownUntil = Date.now() + PINCH_COOLDOWN_MS;
          setPinchActive(false);
          pinchJustEnded = false;
          return;
        }
        commitPinchZoom();
        startDist = null;
        pinchCooldownUntil = Date.now() + PINCH_COOLDOWN_MS;
        pinchPrimed = false;
        setPinchActive(false);
        pinchJustEnded = true;
      }

      if (e.touches.length === 0) {
        touchInteractionActive = false;
        if (annotToolRef.current) {
          hasMoved = false;
          lastTapTime = 0;
          return;
        }
        if (pinchJustEnded) {
          // The pinch's OTHER finger already committed the zoom above (or
          // on the touchend just before this one) — this is only the
          // second finger following it off the glass a beat later, not a
          // pan. livePanRef was never touched by a pinch, so syncLivePan()
          // below would snap the scroll to whatever stale {currentL,
          // currentT} it still had (often {0,0}) instead of leaving the
          // zoom-to-point correction's own result alone.
          pinchJustEnded = false;
          hasMoved = false;
          return;
        }
        // Only the three-finger pan branches (onTouchStart/onTouchMove
        // above) ever set livePanRef.current.active — a plain 1-finger tap
        // or drawing stroke never touches it, so this correctly tells
        // apart "a real pan just ended" (sync + possible momentum) from
        // "some other single-finger touch just ended" (neither — syncLivePan
        // would otherwise snap scrollLeft/scrollTop to stale target values
        // left over from the last real pan).
        const wasPanning = livePanRef.current.active;
        livePanRef.current.active = false;
        if (wasPanning) {
          syncLivePan(el, livePanRef);
          if (hasMoved) {
            const { vx, vy } = panVelocityTracker.velocity();
            if (Math.hypot(vx, vy) > MOMENTUM_FLICK_MIN) runMomentumScroll(el, vx, vy, momentumFrameRef);
          }
        } else if (!hasMoved && textSelectableRef.current && e.changedTouches.length === 1) {
          // Double-tap detection — the mouse path gets a real dblclick event,
          // touch doesn't reliably synthesize one, so track taps ourselves.
          // !hasMoved is what tells a genuine tap apart from a drawing
          // stroke that moved but never became a pan.
          const ct = e.changedTouches[0];
          const now = Date.now();
          const isDoubleTap =
            now - lastTapTime < DOUBLE_TAP_MS &&
            Math.hypot(ct.clientX - lastTapX, ct.clientY - lastTapY) < DOUBLE_TAP_DIST;
          if (isDoubleTap) {
            lastTapTime = 0;
            selectWordAtPoint(ct.clientX, ct.clientY);
          } else {
            lastTapTime = now;
            lastTapX = ct.clientX;
            lastTapY = ct.clientY;
          }
        }
        hasMoved = false;
      }
    };

    const onDblClick = (e) => {
      if (annotToolRef.current) return;
      if (!textSelectableRef.current) return;
      e.preventDefault();
      selectWordAtPoint(e.clientX, e.clientY);
    };

    const onContextMenu = (e) => e.preventDefault();
    const onSelectStart = (e) => {
      if (touchInteractionActive || annotToolRef.current) e.preventDefault();
    };

    el.addEventListener("touchstart",  onTouchStart,  { passive: false });
    el.addEventListener("touchmove",   onTouchMove,   { passive: false });
    el.addEventListener("touchend",    onTouchEnd,    { passive: false });
    el.addEventListener("touchcancel", onTouchEnd,    { passive: false });
    el.addEventListener("contextmenu", onContextMenu);
    el.addEventListener("selectstart", onSelectStart);
    el.addEventListener("dblclick",    onDblClick);

    return () => {
      if (twoFingerUndoCandidate?.timer) clearTimeout(twoFingerUndoCandidate.timer);
      if (pinchRaf) cancelAnimationFrame(pinchRaf);
      livePanRef.current.active = false;
      stopLivePan(livePanRef);
      stopMomentumScroll(momentumFrameRef);
      if (pinchTransformApplied) {
        const wrap = canvasWrapRef.current;
        if (wrap) {
          wrap.style.transform       = "";
          wrap.style.transformOrigin = "";
          wrap.style.willChange      = "";
          wrap.style.removeProperty("--pdf-live-zoom-inverse");
        }
      }
      el.removeEventListener("touchstart",  onTouchStart);
      el.removeEventListener("touchmove",   onTouchMove);
      el.removeEventListener("touchend",    onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
      el.removeEventListener("contextmenu", onContextMenu);
      el.removeEventListener("selectstart", onSelectStart);
      el.removeEventListener("dblclick",    onDblClick);
    };
  }, [pdfDoc, captureZoomAnchor, zoomingDisabled]);

  // ── Mouse drag to pan ──────────────────────────────────────────────────────
  useEffect(() => {
    const el = previewRef.current;
    if (!el || !pdfDoc) return;

    let dragging = false;
    let armed = false;
    let startX = 0, startY = 0, scrollL = 0, scrollT = 0;
    const dragVelocityTracker = createVelocityTracker();
    const PAN_THRESHOLD = 6;

    const onMouseDown = (e) => {
      if (e.button !== 0) return;
      if (annotToolRef.current) return; // an annotation tool is active — this mousedown is the start of a stroke, not a pan
      const tag = e.target.tagName;
      if (tag === "BUTTON" || tag === "SELECT" || tag === "INPUT" || tag === "A") return;
      if (e.target.closest?.("#manual_select_bar, #annot_text_input")) return;

      livePanRef.current.active = false;
      stopLivePan(livePanRef);
      stopMomentumScroll(momentumFrameRef); // grabbing the page always catches it mid-coast
      armed = true;
      dragging = false;
      startX   = e.clientX;
      startY   = e.clientY;
      scrollL  = el.scrollLeft;
      scrollT  = el.scrollTop;
      livePanRef.current.currentL = scrollL;
      livePanRef.current.currentT = scrollT;
      livePanRef.current.targetL = scrollL;
      livePanRef.current.targetT = scrollT;
      dragVelocityTracker.reset();
      dragVelocityTracker.push(startX, startY, performance.now());
    };

    const onMouseMove = (e) => {
      if (!armed && !dragging) return;
      if (!dragging) {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (Math.hypot(dx, dy) < PAN_THRESHOLD) return;
        dragging = true;
        el.style.cursor = "grabbing";
        el.style.userSelect = "none";
      }
      if (!dragging) return;
      livePanRef.current.active = true;
      livePanRef.current.targetL = scrollL - (e.clientX - startX);
      livePanRef.current.targetT = scrollT - (e.clientY - startY);
      if (!livePanRef.current.frame) runLivePan(el, livePanRef);
      e.preventDefault();
      dragVelocityTracker.push(e.clientX, e.clientY, performance.now());
    };

    const onMouseUp = () => {
      armed = false;
      if (!dragging) return;
      dragging            = false;
      el.style.cursor     = "";
      el.style.userSelect = "";
      livePanRef.current.active = false;
      syncLivePan(el, livePanRef);
      const { vx, vy } = dragVelocityTracker.velocity();
      if (Math.hypot(vx, vy) > MOMENTUM_FLICK_MIN) runMomentumScroll(el, vx, vy, momentumFrameRef);
    };

    el.addEventListener("mousedown", onMouseDown);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup",   onMouseUp);

    return () => {
      livePanRef.current.active = false;
      stopLivePan(livePanRef);
      stopMomentumScroll(momentumFrameRef);
      el.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup",   onMouseUp);
    };
  }, [pdfDoc]);

  // ── Render text layer for Manual mode (or a plain reader that still needs word-selection) ──
  useEffect(() => {
    const div = textLayerRef.current;
    if (!schemaTextLayerActive || !pdfDoc || !div) return;
    if (!pageViewport) return;
    div.innerHTML = "";
    spansRef.current = [];
    let cancelled = false;

    pdfDoc.getPage(pageNum).then((page) =>
      page.getTextContent().then((content) => {
        if (cancelled || !textLayerRef.current) return;

        // Multiply two 2-D affine matrices (same as pdfjsLib.Util.transform).
        // vt = viewport.transform, it = item.transform → tx = vt × it
        const vt    = pageViewport.transform;
        const scale = Math.hypot(vt[0], vt[1]); // viewport scale (px per user-space unit)
        const mul   = ([a2, b2, c2, d2, e2, f2]) => [
          vt[0] * a2 + vt[2] * b2,
          vt[1] * a2 + vt[3] * b2,
          vt[0] * c2 + vt[2] * d2,
          vt[1] * c2 + vt[3] * d2,
          vt[0] * e2 + vt[2] * f2 + vt[4],
          vt[1] * e2 + vt[3] * f2 + vt[5],
        ];

        // Text metrics only — this canvas is never drawn to or attached to
        // the page, just used for ctx.measureText's real per-character
        // proportional widths. Two earlier attempts both broke word
        // selection: (1) a uniform charWidth = itemWidth/str.length average
        // ignored that real fonts are proportional, drifting out of
        // alignment across a multi-word item; (2) switching to the
        // browser's live inline text-flow layout (measuring actual rendered
        // elements) turned out unreliable in practice — items' measured
        // natural width didn't reliably match their real PDF advance width,
        // so token boxes still overflowed into neighboring items and
        // clicks resolved to the wrong word. A canvas measureText call has
        // no live-layout/attachment dependency at all — it's a pure,
        // synchronous, deterministic font-metrics query — so this combines
        // real proportional widths with the same "scale the whole item to
        // its true PDF width" correction, but computed a way that can't be
        // thrown off by DOM timing.
        const measureCtx = document.createElement("canvas").getContext("2d");

        for (let pdfItemIndex = 0; pdfItemIndex < content.items.length; pdfItemIndex++) {
          const item = content.items[pdfItemIndex];
          if (!item.str) continue;
          const tx       = mul(item.transform);
          // PDF.js defines text height on the transform's vertical axis.
          // The horizontal axis may include glyph stretching/condensing and
          // must not be reused as height or boxes drift vertically.
          const fontSize = Math.hypot(tx[2], tx[3]);
          if (fontSize < 1) continue;
          const textStyle = content.styles?.[item.fontName];
          const ascentRatio = getPdfTextAscentRatio(textStyle);
          // PDF.js describes the vertical glyph interval from the baseline:
          // ascent is above it and descent is normally a negative value below
          // it. Use that interval for the Morphe frame instead of assuming
          // that one font-size equals the visible ascent+descent height.
          const descentRatio = Number.isFinite(textStyle?.descent) ? textStyle.descent : -0.2;

          const angle      = Math.atan2(tx[1], tx[0]);
          const itemWidth  = item.width * scale; // PDF advance width → canvas pixels
          const dirX = Math.cos(angle);
          const dirY = Math.sin(angle);

          // Resolved once per item (not per token) — used only for the
          // Highlight tool's masked/recolored text (drawMaskedHighlightText,
          // annotationDraw.js) so it can clone the PDF's real font instead
          // of a generic fallback. fallbackName is pdf.js's own generic
          // CSS-safe classification (serif/sans-serif/monospace) derived
          // from the embedded font's metadata — not the exact embedded
          // typeface (that would need hooking into pdf.js's FontLoader to
          // register its @font-face and get a browser-usable name), but a
          // close, always-available approximation. commonObjs.get throws
          // if the font isn't resolved yet, hence has() first + try/catch.
          let itemFontFamily = "sans-serif";
          let itemFontWeight = "normal";
          let itemFontStyle = "normal";
          try {
            if (page.commonObjs.has(item.fontName)) {
              const fontObj = page.commonObjs.get(item.fontName);
              itemFontFamily = fontObj?.fallbackName || "sans-serif";
              itemFontWeight = fontObj?.black ? "900" : fontObj?.bold ? "bold" : "normal";
              itemFontStyle = fontObj?.italic ? "italic" : "normal";
            }
          } catch {
            // leave defaults — a font that isn't resolved yet just falls
            // back to sans-serif for this item's masked-text rendering
          }

          // Use PDF.js's resolved fallback metrics when available. Measuring
          // every item as generic sans-serif accumulates horizontal error as
          // word tokens are split from one PDF.js item, which makes the shared
          // selection/Morphe overlay drift from the embedded PDF glyphs.
          measureCtx.font = `${itemFontStyle} ${itemFontWeight} ${fontSize}px ${itemFontFamily}`;
          const fullNaturalWidth = measureCtx.measureText(item.str).width;
          // Corrects for the measurement font not being the PDF's real
          // (often embedded/subset) font — every token's measured width is
          // scaled by this same ratio, so relative proportions between
          // tokens stay accurate even though the absolute font differs.
          const scaleX = fullNaturalWidth > 0 ? itemWidth / fullNaturalWidth : 1;

          // One span per WORD (or per whitespace run), not one per PDF text
          // item — a single item routinely covers a whole run of same-font
          // text ("cardiac output equals" as one item, not three). The
          // drag-handle logic (nearestSpanIndex/updateSelectionEdge) moves
          // the selection boundary one span at a time; without this split,
          // crossing into a neighboring multi-word item added every word in
          // it in one step ("selecting one word but highlighting many").
          const tokens = item.str.match(/\S+|\s+/g) || [item.str];
          let cursorNatural = 0; // cumulative unscaled width so far, in measureCtx's font
          for (const token of tokens) {
            const tokenNaturalWidth = measureCtx.measureText(token).width;
            const tokenWidth = tokenNaturalWidth * scaleX;
            const originX = tx[4] + cursorNatural * scaleX * dirX;
            const originY = tx[5] + cursorNatural * scaleX * dirY;
            const tokenIndex = spansRef.current.length;

            const span = document.createElement("span");
            span.dataset.spanIdx = String(tokenIndex);
            // geo* fields are the exact numbers this span's position/size
            // CSS was set from below — i.e. deterministic PDF-space math
            // (pageViewport.transform × item.transform, no canvas
            // measureText involved for single-token items — see the
            // scaleX comment above for why that cancels out exactly).
            // Selection logic (visuallyConnected, column detection) reads
            // THESE instead of live getBoundingClientRect() — confirmed on
            // iPad Safari that a same-line, zero-gap pair (per this exact
            // math) reports a getBoundingClientRect() gap large enough to
            // block merging, while desktop Chrome reports ~0 for the
            // identical PDF — a WebKit-specific measurement quirk (this
            // app's own zoom uses the non-standard `zoom` CSS property,
            // which WebKit has long-standing getBoundingClientRect bugs
            // with) rather than anything about the document itself.
            spansRef.current.push({
              text: token, el: span, fontFamily: itemFontFamily, fontWeight: itemFontWeight, fontStyle: itemFontStyle,
              geoLeft: originX, geoRight: originX + tokenWidth,
              geoTop: originY - fontSize * ascentRatio,
              geoHeight: fontSize * (ascentRatio - descentRatio),
              pageLeft: originX / scale,
              pageRight: (originX + tokenWidth) / scale,
              pageTop: (originY - fontSize * ascentRatio) / scale,
              pageBottom: (originY - fontSize * ascentRatio + (fontSize * (ascentRatio - descentRatio))) / scale,
              pageHeight: (fontSize * (ascentRatio - descentRatio)) / scale,
              pdfItemIndex, // which raw content.items entry this token came from
              tokenIndex,   // stable within the page: item index + token order
              spanKey: `${pdfItemIndex}:${tokenIndex}`,
            });
            span.textContent        = token;
            span.style.position     = "absolute";
            span.style.left         = `${originX}px`;
            span.style.top          = `${originY - fontSize * ascentRatio}px`;
            // Keep the DOM metrics in the PDF's original user-space units.
            // The previous implementation stored the viewport-scaled value
            // here (for example 40px at high zoom). That made the Morphe
            // outline depend on the browser's zoomed font metrics and caused
            // its saturated frame to grow/shrink relative to the canvas
            // glyphs. The span is still placed at viewport coordinates, but
            // its local box is scaled as one unit below, so its font-size is
            // the actual PDF font size again.
            const originalFontSize = fontSize / scale;
            const originalTextBoxHeight = (fontSize * (ascentRatio - descentRatio)) / scale;
            const originalTokenWidth = tokenWidth / scale;
            span.style.height       = `${originalTextBoxHeight}px`;
            span.style.fontSize     = `${originalFontSize}px`;
            span.style.whiteSpace   = "pre";
            span.style.color        = "transparent";
            span.style.transformOrigin = "0% 0%";
            // Selection is handled entirely by our own dblclick/double-tap
            // logic (see selectWordAtPoint) with a custom highlight overlay —
            // native browser text selection is switched off so it can't drag-
            // select a range or fight that custom highlight.
            span.style.userSelect   = "none";
            span.style.webkitUserSelect = "none";
            if (originalTokenWidth > 0) span.style.width = `${originalTokenWidth}px`;
            span.style.transform = `${Math.abs(angle) > 0.01 ? `rotate(${angle}rad) ` : ""}scale(${scale})`;
            div.appendChild(span);

            cursorNatural += tokenNaturalWidth;
          }
        }

        // Omission BBoxes suppress fully enclosed text tokens from every
        // selectable/reading flow while leaving PDF.js extraction intact for
        // the diagnostic RAW table. Removing the transparent DOM span also
        // prevents browser selection and assistant tools from reading it.
        if (omissionBBoxes.length) {
          spansRef.current = spansRef.current.filter((span) => {
            const omitted = omissionBBoxes.some((bbox) => isRectFullyContainedByBBox({
              x: span.pageLeft,
              y: span.pageTop,
              w: Number(span.pageRight) - Number(span.pageLeft),
              h: Number(span.pageBottom) - Number(span.pageTop),
            }, bbox));
            if (omitted) span.el?.remove();
            return !omitted;
          });
        }

        // PDF content streams are not guaranteed to match visual reading
        // order. Selection ranges are index-based, so normalize the span
        // index to what the user actually sees on the page: top-to-bottom,
        // then left-to-right within each line, AND per column for a
        // multi-column layout (e.g. a two-column table of contents).
        //
        // Delegates to pdfPageLayout.js — the same reading-order/column-
        // detection engine pdfSearchIndex.js uses for the search index —
        // instead of a second, independently-maintained copy of this
        // logic. That module's own comments cover the full history (the
        // non-transitive-sort root cause, the WebKit getBoundingClientRect
        // quirk that's why geo* fields exist at all, the position-
        // consensus gutter detection, the two-pass per-column line
        // reconstruction that fixes cross-column Y-coincidence, and the
        // page-number-tab-stop exclusion) — this call site only needs to
        // adapt spansRef.current's word/whitespace-token spans into the
        // module's plain spatial-item shape and apply its result back.
        const spatialItems = spansRef.current.map((sp) => ({
          text: sp.text, x1: sp.geoLeft, x2: sp.geoRight, y1: sp.geoTop, y2: sp.geoTop + sp.geoHeight, spanRef: sp,
        }));
        const layout = analyzePageLayout(spatialItems);

        const orderedSpans = [];
        for (const block of layout.blocks) {
          for (const spatialItem of block.items) {
            const sp = spatialItem.spanRef;
            sp.rowIndex = block.lineIndex;
            sp.columnIndex = block.columnIndex; // null for a full-width block — callers already treat null as "unscoped"
            orderedSpans.push(sp);
          }
        }
    spansRef.current = orderedSpans;
    spansRef.current.forEach((span, index) => {
      span.el.dataset.spanIdx = String(index);
    });
        setTextLayerRenderTick((tick) => tick + 1);
      })
    );

    return () => { cancelled = true; if (textLayerRef.current) textLayerRef.current.innerHTML = ""; };
  }, [schemaTextLayerActive, pdfDoc, pageNum, pageViewport, omissionBBoxes]);

  useEffect(() => {
    const schemaPhraseBySpan = new Map();
    const schemaPhraseGroupBySpan = new Map();
    const wordSpans = spansRef.current.filter((span) => {
      const value = cleanSchemaWord(span?.text);
      return value && !/\s/u.test(value) && /[\p{L}\p{N}]/u.test(value);
    });
    [...schemaWordKeys].filter((key) => /\s/u.test(key)).forEach((phraseKey) => {
      const phraseWords = phraseKey.split(/\s+/u).filter(Boolean);
      for (let index = 0; index <= wordSpans.length - phraseWords.length; index += 1) {
        const candidate = wordSpans.slice(index, index + phraseWords.length);
        const sameLine = candidate.every((span) => span.rowIndex === candidate[0].rowIndex && span.columnIndex === candidate[0].columnIndex);
        const matches = sameLine && candidate.every((span, wordIndex) => schemaWordKey(span.text) === phraseWords[wordIndex]);
        if (!matches) continue;
        candidate.forEach((span) => {
          schemaPhraseBySpan.set(span, phraseKey);
          schemaPhraseGroupBySpan.set(span, candidate);
        });
      }
    });

    for (const span of spansRef.current) {
      const key = schemaWordKey(span?.text);
      const element = span?.el;
      if (!element) continue;
      const schemaName = schemaPhraseBySpan.get(span) || cleanSchemaWord(span?.text);
      const phraseGroup = schemaPhraseGroupBySpan.get(span) || null;
      const isPhraseStart = !phraseGroup || phraseGroup[0] === span;
      const isSchema = Boolean((key && schemaWordKeys.has(key)) || schemaPhraseBySpan.has(span));
      const traceSources = key ? (traceSourcesByWord.get(key) || []) : [];
      const isTrace = !isSchema && traceSources.length > 0;
      element.classList.toggle("pdf_schema_word_span", isSchema);
      element.classList.toggle("pdf_morphe_unit_span", isSchema || isTrace);
      element.classList.toggle("pdf_morphe_unit_span--schema", isSchema);
      element.classList.toggle("pdf_morphe_unit_span--trace", isTrace);
      element.querySelectorAll(".pdf_morphe_frame").forEach((frame) => frame.remove());
      element.querySelectorAll(".pdf_schema_word_marker").forEach((marker) => marker.remove());
      if (!isSchema && !traceSources.length) continue;

      if (isPhraseStart) {
        // Use a real SVG frame rather than a CSS border. For a multi-word
        // Schema, the frame begins at the first word and ends at the last
        // word, while remaining vector geometry at every zoom level.
        const frame = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        const frameRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        const ownWidth = parseFloat(element.style.width) || element.getBoundingClientRect().width;
        const frameWidth = phraseGroup
          ? Math.max(ownWidth, (phraseGroup[phraseGroup.length - 1].pageRight || 0) - (phraseGroup[0].pageLeft || 0))
          : Math.max(1, ownWidth);
        const frameHeight = Math.max(1, parseFloat(element.style.height) || element.getBoundingClientRect().height);
        const frameStroke = Math.max(0.35, (parseFloat(element.style.fontSize) || frameHeight) * 0.06);
        frame.className.baseVal = "pdf_morphe_frame";
        frame.setAttribute("viewBox", `0 0 ${frameWidth} ${frameHeight}`);
        frame.setAttribute("preserveAspectRatio", "none");
        frame.setAttribute("aria-hidden", "true");
        frame.style.width = `${frameWidth}px`;
        frameRect.setAttribute("x", String(frameStroke / 2));
        frameRect.setAttribute("y", String(frameStroke / 2));
        frameRect.setAttribute("width", String(Math.max(0, frameWidth - frameStroke)));
        frameRect.setAttribute("height", String(Math.max(0, frameHeight - frameStroke)));
        frameRect.setAttribute("rx", String(Math.min(frameHeight * 0.16, 2)));
        frameRect.setAttribute("fill", "none");
        frameRect.setAttribute("stroke-width", String(frameStroke));
        frameRect.classList.add(isSchema ? "pdf_morphe_frame--schema" : "pdf_morphe_frame--trace");
        frame.appendChild(frameRect);
        element.appendChild(frame);
      }

      // A phrase has one Morphe marker at its first word, not one marker per
      // token inside the shared frame.
      if (!isPhraseStart) continue;

      const marker = document.createElement("button");
      marker.type = "button";
      marker.className = `pdf_schema_word_marker ${isSchema ? "pdf_schema_word_marker--schema" : "pdf_schema_word_marker--trace"}`;
      marker.setAttribute("aria-label", isSchema ? `Schema: ${schemaName}` : `Trace: ${span.text}`);
      marker.title = isSchema ? `Schema: ${schemaName}` : `Trace: ${span.text}`;
      marker.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const rect = marker.getBoundingClientRect();
        setSmartPenMarkerPopup({
          kind: isSchema ? "schema" : "trace",
          word: schemaName,
          sources: traceSources,
          rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
        });
      });
      element.appendChild(marker);
    }
    return () => {
      for (const span of spansRef.current) span?.el?.querySelectorAll(".pdf_schema_word_marker").forEach((marker) => marker.remove());
    };
  }, [schemaWordKeys, textLayerRenderTick, traceSourcesByWord]);

  useEffect(() => {
    if (!smartPenMarkerPopup) return undefined;
    const close = (event) => {
      if (!event.target.closest?.(".pdf_schema_marker_popup, .pdf_schema_word_marker")) {
        setSmartPenMarkerPopup(null);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [smartPenMarkerPopup]);

  useEffect(() => {
    if (!textLayerRenderTick || !pendingSmartPenStrokesRef.current.length) return;
    const pendingStrokes = pendingSmartPenStrokesRef.current.splice(0);
    pendingStrokes.forEach(registerSmartPenStrokeSchemas);
  }, [registerSmartPenStrokeSchemas, textLayerRenderTick]);

  // Highlight selected text: group spans by line → one even rect per line.
  // Uses getBoundingClientRect() for real visual bounds (glyph height > em-size, width overflow, etc.)
  useEffect(() => {
    const spans = spansRef.current;
    const layer = textLayerRef.current;

    layer?.querySelectorAll(".sel_highlight, .sel_selection_handle").forEach((el) => el.remove());
    spans.forEach(({ el }) => el.classList.remove("span_selected"));

    if (!manualSelection || manualSelection.surface === "md" || !layer) {
      selectionDraggingEdgeRef.current = null;
      selectionHandleDragRef.current = null;
      return;
    }
    const resolvedStartIdx = (() => {
      const idx = resolveSpanIndexByKey(manualSelection.startSpanKey);
      return idx >= 0 ? idx : manualSelection.startIdx;
    })();
    const resolvedEndIdx = (() => {
      const idx = resolveSpanIndexByKey(manualSelection.endSpanKey);
      return idx >= 0 ? idx : manualSelection.endIdx;
    })();
    const lo = Math.min(resolvedStartIdx, resolvedEndIdx);
    const hi = Math.max(resolvedStartIdx, resolvedEndIdx);
    const selectionRegion = manualSelection.regionId
      ? selectionBboxes.find((bbox) => bbox.id === manualSelection.regionId) || null
      : regionForSpanIndex(resolvedStartIdx) || regionForSpanIndex(resolvedEndIdx);
    const spanMatchesSelectionRegion = (span) => (
      !selectionRegion || bboxMatchesSpan(selectionRegion, span)
    );

    // Which char-offset crops the lo-index span vs. the hi-index span —
    // NOT simply startCharOffset/endCharOffset, since start can be either
    // side depending on which direction the selection was dragged.
    const hasCharOffsets = manualSelection.startCharOffset != null && manualSelection.endCharOffset != null;
    let loOffset = null, hiOffset = null;
    if (hasCharOffsets) {
      if (resolvedStartIdx === resolvedEndIdx) {
        loOffset = Math.min(manualSelection.startCharOffset, manualSelection.endCharOffset);
        hiOffset = Math.max(manualSelection.startCharOffset, manualSelection.endCharOffset);
      } else if (resolvedStartIdx < resolvedEndIdx) {
        loOffset = manualSelection.startCharOffset;
        hiOffset = manualSelection.endCharOffset;
      } else {
        loOffset = manualSelection.endCharOffset;
        hiOffset = manualSelection.startCharOffset;
      }
    }

    for (let i = lo; i <= hi; i++) {
      const span = spans[i];
      if (!span?.el) continue;
      if (!spanMatchesSelectionRegion(span)) continue;
      span.el.classList.add("span_selected");
    }

    const layerRect = layer.getBoundingClientRect();
    const bodyZoom  = parseFloat(document.body.style.zoom) || 1;
    const layerPointFromClient = (cx, cy) => ({
      x: (cx - layerRect.left) / bodyZoom,
      y: (cy - layerRect.top) / bodyZoom,
    });

    const lines = [];
    for (let i = lo; i <= hi; i++) {
      const span = spans[i];
      const el = span?.el;
      if (!el) continue;
      if (!spanMatchesSelectionRegion(span)) continue;

      // Canvas-local bounds from the span's explicit CSS geometry
      const r      = el.getBoundingClientRect();
      let   left   = (r.left   - layerRect.left) / bodyZoom;
      const top    = (r.top    - layerRect.top)  / bodyZoom;
      let   right  = (r.right  - layerRect.left) / bodyZoom;
      const bottom = (r.bottom - layerRect.top)  / bodyZoom;
      const fullWidth = right - left;

      // Crop the boundary span(s) to the exact dragged character, instead
      // of highlighting/selecting the whole word the handle is currently
      // nearest to — this is what makes the handle drag feel character-by-
      // character rather than jumping a whole word at a time.
      if (hasCharOffsets) {
        const text = spans[i]?.text ?? el.textContent ?? "";
        if (text.length > 0) {
          if (i === lo) left  += fullWidth * (loOffset / text.length);
          if (i === hi) right = (right - fullWidth) + fullWidth * (hiOffset / text.length);
        }
      }
      if (right <= left) continue; // fully cropped away — nothing of this span is actually selected

      const h      = bottom - top;

      // PDF glyphs have ascenders/descenders that extend beyond the em-box.
      // Keep the pad small so adjacent lines don't visually merge.
      const padV = Math.min(1.8, Math.max(0.8, h * 0.08));

      // Cluster threshold scales with font size
      let line = lines.find((l) => Math.abs(l.refTop - top) < Math.max(8, h * 0.5));
      if (!line) { line = { refTop: top, minL: Infinity, maxR: -Infinity, minT: Infinity, maxB: -Infinity }; lines.push(line); }
      line.minL = Math.min(line.minL, left);
      line.maxR = Math.max(line.maxR, right);
      line.minT = Math.min(line.minT, top    - padV);
      line.maxB = Math.max(line.maxB, bottom + padV);
    }

    for (const l of lines) {
      const rect = document.createElement("div");
      rect.className           = "sel_highlight";
      rect.style.position      = "absolute";
      rect.style.left          = `${l.minL}px`;
      rect.style.top           = `${l.minT}px`;
      rect.style.width         = `${l.maxR - l.minL}px`;
      rect.style.height        = `${l.maxB - l.minT}px`;
      rect.style.background    = "rgba(56,139,253,0.35)";
      rect.style.borderRadius  = "2px";
      rect.style.pointerEvents = "none";
      rect.style.zIndex        = "1";
      layer.insertBefore(rect, layer.firstChild);
    }

    const cleanSelectionText = (text) => (
      String(text || "")
        .replace(/(^|\n)[ \t]*([.\-_=*~]{4,})+(?=\s|[\p{L}\p{N}]|$)/gu, "$1")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n[ \t]+/g, "\n")
        .replace(/[ \t]{2,}/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
    );

    // startOffset/endOffset are optional — omitted, the whole startIdx/
    // endIdx span range is used (word granularity, the original
    // behavior); passed, the boundary spans are cropped to that exact
    // character (see the lo/hi crop math above, same convention: whichever
    // of startOffset/endOffset lands on the lower index crops from the
    // left, the other crops from the right).
    const selectionTextFor = (startIdx, endIdx, startOffset = null, endOffset = null) => {
      const rangeLo = Math.min(startIdx, endIdx);
      const rangeHi = Math.max(startIdx, endIdx);
      const hasOffsets = startOffset != null && endOffset != null;
      let loOffset = null, hiOffset = null;
      if (hasOffsets) {
        if (startIdx === endIdx) { loOffset = Math.min(startOffset, endOffset); hiOffset = Math.max(startOffset, endOffset); }
        else if (startIdx < endIdx) { loOffset = startOffset; hiOffset = endOffset; }
        else { loOffset = endOffset; hiOffset = startOffset; }
      }
      let text = "";
      let previous = null;
      for (let i = rangeLo; i <= rangeHi; i++) {
        const span = spans[i];
        if (span && !spanMatchesSelectionRegion(span)) continue;
        let token = span?.text ?? span?.el?.textContent ?? "";
        if (hasOffsets && token) {
          if (i === rangeLo && i === rangeHi) token = token.slice(loOffset, hiOffset);
          else if (i === rangeLo) token = token.slice(loOffset);
          else if (i === rangeHi) token = token.slice(0, hiOffset);
        }
        if (!token) continue;
        const rect = span?.el?.getBoundingClientRect?.();
        if (text && previous?.rect && rect) {
          const h = Math.max(previous.rect.height, rect.height, 1);
          const sameLine = Math.abs(previous.rect.top - rect.top) < h * 0.55;
          const gap = rect.left - previous.rect.right;
          const paragraphBreak = !sameLine && (rect.top - previous.rect.bottom) > Math.max(10, h * 0.9);
          const needsSpace = sameLine
            ? gap > Math.max(2, h * 0.16)
            : !paragraphBreak;
          if (paragraphBreak) text += "\n\n";
          else if (needsSpace) text += " ";
        }
        text += token;
        previous = { token, rect };
      }
      return cleanSelectionText(text);
    };

    // nearIndex bounds the search to a window of spans around it (reading
    // order, not screen position) instead of scanning every span on the
    // page. Without this, if ANY span anywhere ends up mispositioned —
    // e.g. accumulated floating-point drift in the canvas-measureText/
    // scaleX correction on a long multi-word PDF item, which a single
    // global per-item scale factor can't fully correct for uneven
    // justification/kerning — a drag could "snap" to that distant span the
    // instant it's even slightly closer on screen than the real neighbor,
    // ballooning the selection to wherever that span happens to sit (up to
    // a whole sentence away) in one step. Bounding the search keeps a drag
    // from ever moving the boundary further than SEARCH_WINDOW spans from
    // where it already was, regardless of what positioning bug might exist
    // elsewhere on the page.
    const SEARCH_WINDOW = 80;
    const nearestSpanIndex = (clientX, clientY, nearIndex = null) => {
      const point = layerPointFromClient(clientX, clientY);
      const { x, y } = point;
      let bestIdx = -1;
      let bestDistance = Infinity;
      const lo = nearIndex != null ? Math.max(0, nearIndex - SEARCH_WINDOW) : 0;
      const hi = nearIndex != null ? Math.min(spans.length - 1, nearIndex + SEARCH_WINDOW) : spans.length - 1;
      for (let index = lo; index <= hi; index++) {
        const span = spans[index];
        if (span && !spanMatchesSelectionRegion(span)) continue;
        const r = span?.el?.getBoundingClientRect?.();
        if (!r) continue;
        const left = (r.left - layerRect.left) / bodyZoom;
        const top = (r.top - layerRect.top) / bodyZoom;
        const right = (r.right - layerRect.left) / bodyZoom;
        const bottom = (r.bottom - layerRect.top) / bodyZoom;
        const cx = Math.max(left, Math.min(x, right));
        const cy = Math.max(top, Math.min(y, bottom));
        const distance = Math.hypot(x - cx, y - cy);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIdx = index;
        }
      }
      return bestIdx;
    };

    const textLengthForSpan = (index) => {
      const span = spans[index];
      return (span?.text ?? span?.el?.textContent ?? "").length;
    };

    const charOffsetForSpanPoint = (spanIdx, clientX) => {
      const point = layerPointFromClient(clientX, 0);
      const span = spans[spanIdx];
      const text = span?.text ?? span?.el?.textContent ?? "";
      const r = span?.el?.getBoundingClientRect?.();
      if (!r || !text) return 0;
      const left = (r.left - layerRect.left) / bodyZoom;
      const width = r.width / bodyZoom;
      const x = point.x;
      if (x >= left + width - EDGE_SNAP_PX / bodyZoom) return text.length;
      if (x <= left + EDGE_SNAP_PX / bodyZoom) return 0;
      const ratio = width > 0 ? (x - left) / width : 0;
      return Math.max(0, Math.min(text.length, Math.round(ratio * text.length)));
    };

    // Same as nearestSpanIndex, but also resolves exactly which character
    // within that span the point is nearest to. Prefer the visual line being
    // dragged over a broad nearest-neighbor search: PDF spans can have very
    // uneven boxes, and a nearby long text run can otherwise swallow the
    // whole sentence after a tiny handle movement.
    // Within EDGE_SNAP_PX of either edge of the span, always snap fully to
    // that edge (offset 0 or text.length) rather than rounding to whatever
    // character ratio the raw pixel happens to land on — without this, a
    // drag that visually reaches the end of a word but lands a couple
    // pixels short of its exact right edge rounded DOWN to one character
    // short ("Within" → "Withi"). Character-level precision still applies
    // in the middle of a word; only the boundary itself gets forgiving.
    const EDGE_SNAP_PX = 6;
    const nearestCharPosition = (clientX, clientY, nearIndex = null, edge = "end") => {
      if (!spans.length) return { spanIdx: -1, charOffset: 0 };

      const seededIndex = nearIndex != null ? Math.max(0, Math.min(spans.length - 1, nearIndex)) : nearestSpanIndex(clientX, clientY);
      const seedSpan = spans[seededIndex];
      const allRects = spans
        .map((span, index) => ({ span, index, rect: span?.el?.getBoundingClientRect?.() }))
        .filter(({ span, rect }) => span && rect && spanMatchesSelectionRegion(span));
      // Scoped to the seed's own column (multi-column layouts, e.g. a
      // two-column TOC) — otherwise "nearest line" is a pure Y-distance
      // search across the WHOLE page width, which favors whichever
      // column happens to have a line closer to the pointer's height
      // rather than continuing down the column actually being dragged.
      // Falls back to the full page if the column-scoped set is empty
      // (single-column documents, or a genuinely out-of-range drag).
      //
      // "Which line" is resolved via span.rowIndex — the SAME canonical,
      // precomputed, transitive row grouping the reading-order sort uses
      // (see the big comment on that sort for why it has to be
      // precomputed rather than a live pairwise/tolerance comparison) —
      // not a second, independent Y-tolerance re-clustering here. Reusing
      // one canonical grouping everywhere selection logic needs "same
      // line" was necessary: an earlier version of this function did its
      // own from-scratch re-clustering, which was consistent enough for
      // the FIRST line-wrap of a drag but drifted from the sort's own
      // grouping by the second — confirmed live, a drag that correctly
      // wrapped from a left-column line to the next left-column line
      // then wrapped again into the RIGHT column on the following line.
      const seedColumn = seedSpan?.columnIndex;
      const searchPoolAll = seedColumn != null ? allRects.filter(({ span }) => span.columnIndex === seedColumn) : allRects;
      const searchPool = searchPoolAll.length ? searchPoolAll : allRects;

      const seedRow = seedSpan?.rowIndex;
      let candidates = seedRow != null
        ? searchPool.filter(({ span }) => span.rowIndex === seedRow).sort((a, b) => a.rect.left - b.rect.left)
        : [];
      const seedHeight = seedSpan?.el?.getBoundingClientRect?.()?.height || 16;
      const seedLineTop = candidates.length ? Math.min(...candidates.map(({ rect }) => rect.top)) : null;
      const seedLineBottom = candidates.length ? Math.max(...candidates.map(({ rect }) => rect.bottom)) : null;
      const seedSlack = Math.max(6, seedHeight * 0.35);
      const pointerPastSeedRow =
        (edge === "end" && seedLineBottom != null && clientY > seedLineBottom + seedSlack) ||
        (edge === "start" && seedLineTop != null && clientY < seedLineTop - seedSlack);
      const pointerStillOnSeedLine = candidates.length
        && clientY >= seedLineTop - seedSlack
        && clientY <= seedLineBottom + seedSlack;

      if (!pointerStillOnSeedLine || pointerPastSeedRow) {
        const rowExtent = new Map(); // rowIndex -> { top, bottom }
        for (const { span, rect } of searchPool) {
          if (span.rowIndex == null) continue;
          const cur = rowExtent.get(span.rowIndex) || { top: rect.top, bottom: rect.bottom };
          cur.top = Math.min(cur.top, rect.top);
          cur.bottom = Math.max(cur.bottom, rect.bottom);
          rowExtent.set(span.rowIndex, cur);
        }
        let nearestRow = null, nearestDist = Infinity;
        for (const [ri, { top, bottom }] of rowExtent) {
          if (pointerPastSeedRow && ri === seedRow) continue;
          const dist = Math.abs((top + bottom) / 2 - clientY);
          if (dist < nearestDist) { nearestDist = dist; nearestRow = ri; }
        }
        if (nearestRow == null && pointerPastSeedRow && seedRow != null) {
          nearestRow = seedRow;
        }
        candidates = nearestRow != null
          ? searchPool.filter(({ span }) => span.rowIndex === nearestRow).sort((a, b) => a.rect.left - b.rect.left)
          : [];
      }

      if (!candidates.length) candidates = allRects.sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);

      for (const candidate of candidates) {
        const { index, rect } = candidate;
        if (clientX >= rect.left && clientX <= rect.right) {
          return { spanIdx: index, charOffset: charOffsetForSpanPoint(index, clientX) };
        }
      }

      let previous = null;
      let next = null;
      for (const candidate of candidates) {
        if (candidate.rect.right < clientX) previous = candidate;
        if (candidate.rect.left > clientX) {
          next = candidate;
          break;
        }
      }

      if (previous && next) {
        if (edge === "start") return { spanIdx: next.index, charOffset: 0 };
        return { spanIdx: previous.index, charOffset: textLengthForSpan(previous.index) };
      }
      if (previous) return { spanIdx: previous.index, charOffset: textLengthForSpan(previous.index) };
      if (next) return { spanIdx: next.index, charOffset: 0 };
      return { spanIdx: seededIndex, charOffset: charOffsetForSpanPoint(seededIndex, clientX) };
    };

    // startOffset/endOffset optional, same convention as selectionTextFor —
    // when given, anchors at the exact dragged character inside the edge
    // span instead of that span's horizontal center.
    const selectionAnchorFor = (startIdx, endIdx, startOffset = null, endOffset = null) => {
      const edgeIdx = Math.max(startIdx, endIdx);
      const edgeEl = spans[edgeIdx]?.el;
      if (!edgeEl) return { x: manualSelection.x, y: manualSelection.y };
      const left = parseFloat(edgeEl.style.left || "0");
      const top = parseFloat(edgeEl.style.top || "0");
      const width = parseFloat(edgeEl.style.width || "0") || edgeEl.offsetWidth || 0;
      const height = parseFloat(edgeEl.style.height || "0") || edgeEl.offsetHeight || 0;
      if (startOffset != null && endOffset != null) {
        const edgeOffset = startIdx === endIdx
          ? Math.max(startOffset, endOffset)
          : (startIdx > endIdx ? startOffset : endOffset);
        const text = spans[edgeIdx]?.text ?? edgeEl.textContent ?? "";
        const xOffset = text.length > 0 ? width * (edgeOffset / text.length) : width;
        return { x: left + xOffset, y: top + height + 8 };
      }
      return { x: left + width / 2, y: top + height + 8 };
    };

    // Skips the state update (and the DOM rebuild every state update
    // triggers, via this whole effect re-running) when the nearest
    // character hasn't actually changed — a slow/careful drag spends most
    // of its pointermove events still over the same character, and
    // updating unrelated handle DOM elements this hard is exactly what a
    // real logical change needs before ever committing anything.
    const updateSelectionEdge = (edge, clientX, clientY) => {
      // manualSelectionRef, not the manualSelection closure variable — see
      // its declaration for why this closure can be stale for a drag's
      // whole duration, and why that matters for nearIndex specifically.
      const currentSel = manualSelectionRef.current;
      const resolvedCurrentStartIdx = currentSel
        ? (() => {
            const idx = resolveSpanIndexByKey(currentSel.startSpanKey);
            return idx >= 0 ? idx : currentSel.startIdx;
          })()
        : null;
      const resolvedCurrentEndIdx = currentSel
        ? (() => {
            const idx = resolveSpanIndexByKey(currentSel.endSpanKey);
            return idx >= 0 ? idx : currentSel.endIdx;
          })()
        : null;
      const nearIndex = edge === "start" ? resolvedCurrentStartIdx : resolvedCurrentEndIdx;
      const next = nearestCharPosition(clientX, clientY, nearIndex ?? null, edge);
      if (next.spanIdx < 0) return;
      const nextSpanKey = spans[next.spanIdx]?.spanKey ?? null;
      setManualSelection((current) => {
        if (!current) return current;
        const currentStartIdx = (() => {
          const idx = resolveSpanIndexByKey(current.startSpanKey);
          return idx >= 0 ? idx : current.startIdx;
        })();
        const currentEndIdx = (() => {
          const idx = resolveSpanIndexByKey(current.endSpanKey);
          return idx >= 0 ? idx : current.endIdx;
        })();
        const nextStartIdx = edge === "start" ? next.spanIdx : currentStartIdx;
        const nextEndIdx   = edge === "end"   ? next.spanIdx : currentEndIdx;
        const nextStartOffset = edge === "start" ? next.charOffset : (current.startCharOffset ?? 0);
        const nextEndOffset   = edge === "end"   ? next.charOffset : (current.endCharOffset ?? (spans[currentEndIdx]?.text?.length ?? 0));
        if (
          nextStartIdx === currentStartIdx && nextEndIdx === currentEndIdx
          && nextStartOffset === (current.startCharOffset ?? 0)
          && nextEndOffset === (current.endCharOffset ?? (spans[currentEndIdx]?.text?.length ?? 0))
        ) return current;
        const text = selectionTextFor(nextStartIdx, nextEndIdx, nextStartOffset, nextEndOffset);
        if (!text) return current;
        const anchor = selectionAnchorFor(nextStartIdx, nextEndIdx, nextStartOffset, nextEndOffset);
        return {
          ...current,
          startIdx: nextStartIdx, endIdx: nextEndIdx,
          startSpanKey: edge === "start" ? nextSpanKey : current.startSpanKey,
          endSpanKey: edge === "end" ? nextSpanKey : current.endSpanKey,
          startCharOffset: nextStartOffset, endCharOffset: nextEndOffset,
          text, ...anchor,
        };
      });
    };

    // The handle's own on-screen position tracks the raw pointer every
    // pixel (continuous), independent of updateSelectionEdge's snapped,
    // per-span logical selection — X follows the finger directly; Y snaps
    // to the nearest line's own baseline so it doesn't jitter vertically as
    // the finger wobbles within one line. Looked up by class each call
    // (not a captured element reference) because manualSelection changing
    // reruns this WHOLE effect, which removes and recreates every handle
    // element from scratch — the element this closure was originally
    // attached to may no longer even be in the DOM by the time a later
    // pointermove fires.
    const positionHandleContinuous = (edge, clientX, clientY) => {
      const handleEl = layer.querySelector(`.sel_selection_handle--${edge}`);
      if (!handleEl) return;
      const currentSel = manualSelectionRef.current;
      const currentStartIdx = currentSel
        ? (() => {
            const idx = resolveSpanIndexByKey(currentSel.startSpanKey);
            return idx >= 0 ? idx : currentSel.startIdx;
          })()
        : null;
      const currentEndIdx = currentSel
        ? (() => {
            const idx = resolveSpanIndexByKey(currentSel.endSpanKey);
            return idx >= 0 ? idx : currentSel.endIdx;
          })()
        : null;
      const nearIndex = edge === "start" ? currentStartIdx : currentEndIdx;
      const nextIdx = nearestSpanIndex(clientX, clientY, nearIndex ?? null);
      const spanEl = spans[nextIdx]?.el;
      if (spanEl) {
        const r = spanEl.getBoundingClientRect();
        handleEl.style.top = `${(r.bottom - layerRect.top) / bodyZoom}px`;
      } else {
        handleEl.style.top = `${(clientY - layerRect.top) / bodyZoom}px`;
      }
      handleEl.style.left = `${(clientX - layerRect.left) / bodyZoom}px`;
      selectionHandleLivePosRef.current = {
        edge,
        x: clientX,
        y: clientY,
        left: parseFloat(handleEl.style.left) || 0,
        top: parseFloat(handleEl.style.top) || 0,
      };
    };

    // Window-level, not per-handle pointer capture — the actively-dragged
    // handle's own DOM element gets destroyed and recreated mid-drag (see
    // above), which would silently release element-level pointer capture
    // and stall the drag after the first span crossing. A ref survives
    // that rebuild; window listeners don't depend on any specific element
    // still existing at all.
    const HANDLE_DRAG_THRESHOLD_PX = 8;
    const onWindowPointerMove = (event) => {
      const edge = selectionDraggingEdgeRef.current;
      if (!edge) return;
      event.preventDefault();
      const drag = selectionHandleDragRef.current;
      if (!drag?.active) {
        if (!drag) return;
        const moved = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
        if (moved < HANDLE_DRAG_THRESHOLD_PX) return;
        drag.active = true;
      }
      positionHandleContinuous(edge, event.clientX, event.clientY);
      updateSelectionEdge(edge, event.clientX, event.clientY);
    };
    const onWindowPointerEnd = () => {
      selectionDraggingEdgeRef.current = null;
      selectionHandleDragRef.current = null;
      selectionHandleLivePosRef.current = null;
      window.removeEventListener("pointermove", onWindowPointerMove);
      window.removeEventListener("pointerup", onWindowPointerEnd);
      window.removeEventListener("pointercancel", onWindowPointerEnd);
    };
    const attachActiveSelectionDragListeners = () => {
      window.addEventListener("pointermove", onWindowPointerMove, { passive: false });
      window.addEventListener("pointerup", onWindowPointerEnd);
      window.addEventListener("pointercancel", onWindowPointerEnd);
    };

    const handlePositionFor = (edge, spanIdx, charOffset = null) => {
      const spanEl = spans[spanIdx]?.el;
      if (!spanEl) return { left: 0, top: 0 };
      const r = spanEl.getBoundingClientRect();
      const left = charOffset != null
        ? r.left + r.width * (spans[spanIdx]?.text?.length > 0 ? charOffset / spans[spanIdx].text.length : (edge === "start" ? 0 : 1))
        : (edge === "start" ? r.left : r.right);
      const top = r.bottom;
      return {
        left: (left - layerRect.left) / bodyZoom,
        top: (top - layerRect.top) / bodyZoom,
      };
    };

    const addHandle = (edge, spanIdx, charOffset = null) => {
      const spanEl = spans[spanIdx]?.el;
      if (!spanEl) return;
      // charOffset positions the handle at that exact character inside the
      // span instead of its full left/right edge — without this, every
      // re-render after a mid-word drag (any state update reruns this
      // whole effect, rebuilding every handle from scratch) would snap the
      // handle straight back out to the whole word's edge, undoing the
      // character-level crop visually even though the highlight/text
      // stayed correctly cropped.
      const livePos = selectionHandleLivePosRef.current;
      const isLiveEdge = livePos?.edge === edge && selectionDraggingEdgeRef.current === edge;
      const stablePos = isLiveEdge
        ? (livePos.left != null && livePos.top != null
            ? livePos
            : handlePositionFor(edge, spanIdx, charOffset))
        : handlePositionFor(edge, spanIdx, charOffset);
      const left = stablePos.left;
      const top = stablePos.top;
      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = `sel_selection_handle sel_selection_handle--${edge}`;
      handle.dataset.selectionHandle = edge;
      handle.setAttribute("aria-label", `${edge === "start" ? "Start" : "End"} selection handle`);
      handle.style.left = `${Math.max(0, left)}px`;
      handle.style.top = `${top}px`;
      const onPointerDown = (event) => {
        event.preventDefault();
        event.stopPropagation();
        // Deliberately does NOT call updateSelectionEdge here — a touch
        // rarely lands exactly on the handle's own anchor point, and
        // nearestSpanIndex would happily snap to whatever span is actually
        // closest to that slightly-off touch, jumping the selection before
        // any real dragging happened. Just arm the drag; the first real
        // pointermove past HANDLE_DRAG_THRESHOLD_PX is what starts
        // adjusting the selection.
        selectionDraggingEdgeRef.current = edge;
        const stablePos = handlePositionFor(edge, spanIdx, charOffset);
        selectionHandleDragRef.current = {
          edge,
          startX: event.clientX,
          startY: event.clientY,
          active: false,
        };
        selectionHandleLivePosRef.current = {
          edge,
          left: stablePos.left,
          top: stablePos.top,
          x: event.clientX,
          y: event.clientY,
        };
        attachActiveSelectionDragListeners();
      };
      handle.addEventListener("pointerdown", onPointerDown);
      layer.appendChild(handle);
    };

    addHandle("start", resolvedStartIdx, manualSelection.startCharOffset);
    addHandle("end", resolvedEndIdx, manualSelection.endCharOffset);
    if (selectionDraggingEdgeRef.current && selectionHandleDragRef.current) {
      attachActiveSelectionDragListeners();
    }

    return () => {
      layer?.querySelectorAll(".sel_highlight, .sel_selection_handle").forEach((el) => el.remove());
      // A live drag intentionally survives this cleanup: every character
      // update re-runs this effect and rebuilds the handles, so ending the
      // ref here would stop selection until the user lifted and grabbed the
      // handle again. The next effect instance immediately attaches fresh
      // window listeners for the same still-held drag.
      if (!selectionDraggingEdgeRef.current) selectionHandleDragRef.current = null;
      window.removeEventListener("pointermove", onWindowPointerMove);
      window.removeEventListener("pointerup", onWindowPointerEnd);
      window.removeEventListener("pointercancel", onWindowPointerEnd);
    };
  }, [manualSelection, pageViewport, textLayerRenderTick, resolveSpanIndexByKey]);

  // ── Clear results on page change ───────────────────────────────────────────
  useEffect(() => {
    if (hyleData !== null && hylePage !== pageNum) {
      setHyleData(null);
      setExtractError("");
      setSavedId(null);
      setActiveHistoryId(null);
    }
    setManualPopup(null);
  }, [pageNum]);

  // ── Load PDF ───────────────────────────────────────────────────────────────
  const loadPdfBytes = useCallback(async (arrayBuffer, name) => {
    // PDF.js may transfer/detach the ArrayBuffer passed to getDocument().
    // Keep an independent copy for the backend semantic-analysis upload.
    pdfBytesRef.current = arrayBuffer instanceof ArrayBuffer ? arrayBuffer.slice(0) : arrayBuffer;
    currentSourceIdRef.current = ""; // caller (loadFromSource) sets this back if applicable
    setHasSourceId(false); // mirrors currentSourceIdRef.current as real state — a plain ref mutation alone doesn't trigger the re-render canInsertBlankPage/pageNavState need to pick up the change
    setLoading(true);
    setLoadError("");
    setFilename(name);
    setPdfDoc(null); setPdfType(null);
    setHyleData(null); setHylePage(null);
    setExtractError(""); setSavedId(null); setActiveHistoryId(null);
    pendingReaderRestoreRef.current = null;
    setReadingMode("single");
    setBookletRightPage(null);
    setMarkdownAsideOpen(false);
    setMarkdownModeMenuOpen(false);
    setMarkdownAsideMode("raw");
    setMarkdownRetainedVisualMode(null);
    setMarkdownAsideColumnGroup("text");
    setMdLineSpacing(0);
    setMdSpacingTarget("str");
    setMdLineTagsVisible(true);
    setPageNum(1); setPageViewport(null); setZoom(1);
    renderTasksRef.current.forEach(t => t?.cancel());
    pageCanvasRefs.current = []; pageContainerRefs.current = [];
    pageViewportsRef.current = []; renderTasksRef.current = []; renderedScaleRef.current = []; renderedCssSizeRef.current = [];
    pageTextItemsCacheRef.current = {};
    pdfAssistantPagesCacheRef.current = { document: null, promise: null, pages: null };
    pageIndexCacheRef.current.clear();
    setPdfAssistantOpen(false);
    setSearchQuery(""); setSearchMatches([]); setSearchActiveIndex(-1); setSearchOpen(false);
    try {
      const doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      setPdfDoc(doc);
      setPageCount(doc.numPages);
      const sampleCount = Math.min(10, doc.numPages);
      const step        = Math.max(1, Math.floor(doc.numPages / sampleCount));
      let totalChars = 0, sampledPages = 0;
      for (let p = 1; p <= doc.numPages && sampledPages < sampleCount; p += step) {
        const pg      = await doc.getPage(p);
        const content = await pg.getTextContent();
        totalChars   += content.items.reduce((n, item) => n + item.str.length, 0);
        sampledPages++;
      }
      const charsPerPage = sampledPages > 0 ? totalChars / sampledPages : 0;
      setPdfType(charsPerPage < 50 ? "scanned" : charsPerPage < 300 ? "mixed" : "text-based");
      return doc.numPages;
    } catch {
      setLoadError("Could not open PDF.");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const loadFile = useCallback(async (file) => {
    if (!file) return;
    if (file.type !== "application/pdf") {
      setLoadError("Please choose a PDF file.");
      return;
    }
    const arrayBuffer = await file.arrayBuffer();
    loadPdfBytes(arrayBuffer, file.name);
  }, [loadPdfBytes]);

  const loadFromSource = useCallback(async (sourceId, name, jumpToPage = null) => {
    // A genuine switch to a different document — as opposed to insert/
    // delete-page's own reload of the SAME document (same sourceId) —
    // starts blankInsertedPages fresh, since the set only makes sense
    // relative to the currently-open PDF's own page numbers.
    if (sourceId !== currentSourceIdRef.current) {
      setBlankInsertedPages(new Set());
      setActiveAnnotationSurface("pdf");
      setAnnotHistorySource("pdf");
      setAnnotationLayerTab("pdf");
      markdownAnnotationsRef.current = {};
      setMarkdownAnnotations({});
      setMarkdownUndoStack([]);
      setMarkdownRedoStack([]);
      setNotebookMode(null);
      setNotebookActiveTab("typing");
      setNotebookText("");
      setNotebookVoiceCommands(NOTEBOOK_VOICE_COMMANDS);
      setNotebookAnnotations([]);
      setNotebookUndoStack([]);
      setNotebookRedoStack([]);
    }
    setLoading(true);
    setLoadError("");
    try {
      const res = await authFetch(apiUrl(`/api/sources/${sourceId}/download`));
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setLoadError(`Could not load PDF: ${data.error || res.status}`);
        setLoading(false);
        return;
      }
      const arrayBuffer = await res.arrayBuffer();
      const numPages = await loadPdfBytes(arrayBuffer, name);
      currentSourceIdRef.current = sourceId;
      setHasSourceId(true);
      if (jumpToPage && numPages) {
        setPageNum(Math.min(Math.max(1, parseInt(jumpToPage, 10) || 1), numPages));
      }

      // Check (cheaply — no page param, but only reading the boolean) whether
      // this source was already converted to Markdown from the Sources table.
      setHasStoredMarkdown(false);
      try {
        const srcRes = await authFetch(apiUrl(`/api/sources/${sourceId}`));
        if (srcRes.ok) {
          const srcData = await srcRes.json();
          const source = srcData.source || {};
          setHasStoredMarkdown(Boolean(source.markdown) || (Array.isArray(source.markdownPages) && source.markdownPages.some((page) => String(page || "").trim())));
          // Authoritative, server-persisted set of blank pages this source
          // has ever had inserted (see blankPages on the Source model) —
          // always applied here (not just on a genuine document switch)
          // so the page-corner Delete button keeps showing for a blank
          // page across reloads/reopens, not just for the rest of the
          // session it was added in. Runs after insert/delete-page's own
          // reload too, where it just re-confirms the optimistic local
          // update those handlers already made.
          setBlankInsertedPages(new Set(Array.isArray(source.blankPages) ? source.blankPages : []));
        }
      } catch {
        // best-effort — MD button just stays disabled if this check fails,
        // and blankInsertedPages is left at whatever loadFromSource's own
        // sourceId-change reset (below) already set it to.
      }

      // Restore any annotation session previously auto-saved for this source —
      // the SourceAnnotation model already existed server-side, just unused.
      try {
        const annRes = await authFetch(apiUrl(`/api/source-annotations/${sourceId}`));
        if (annRes.ok) {
          const annData = await annRes.json();
          skipNextAnnotationAutosaveRef.current = true; // suppress the autosave effect for this restore
          const normalizedAnnotationState = normalizeStoredAnnotationLayers(annData.layers || {}, annData.activeLayerId || null);
          const restoredActiveLayerId = normalizedAnnotationState.activeId || normalizedAnnotationState.layers[0]?.id || null;
          const persistedReaderState = annData.readerState || null;
          const persistedPageNum = Math.min(
            Math.max(1, parseInt(persistedReaderState?.pageNum, 10) || 1),
            numPages || Math.max(1, parseInt(persistedReaderState?.pageNum, 10) || 1),
          );
          const persistedMarkdownMode = VALID_MARKDOWN_ASIDE_MODES.has(persistedReaderState?.markdownAsideMode)
            ? persistedReaderState.markdownAsideMode
            : "raw";
          const restoreMarkdown = Boolean(
            persistedReaderState?.markdownAsideOpen
            || persistedReaderState?.viewMode === "md",
          );
          const persistedRetainedVisualMode = VALID_MARKDOWN_VISUAL_MODES.has(persistedReaderState?.markdownRetainedVisualMode)
            ? persistedReaderState.markdownRetainedVisualMode
            : null;
          const persistedColumnGroup = VALID_MARKDOWN_COLUMN_GROUPS.has(persistedReaderState?.markdownAsideColumnGroup)
            ? persistedReaderState.markdownAsideColumnGroup
            : "text";
          const persistedSpacingTarget = VALID_MARKDOWN_SPACING_TARGETS.has(persistedReaderState?.mdSpacingTarget)
            ? persistedReaderState.mdSpacingTarget
            : "str";
          const persistedNotebookMode = VALID_NOTEBOOK_MODES.has(persistedReaderState?.notebookMode)
            ? persistedReaderState.notebookMode
            : null;
          const persistedLineSpacing = Number.isFinite(Number(persistedReaderState?.mdLineSpacing))
            ? clamp(Number(persistedReaderState.mdLineSpacing), -40, 80)
            : 0;
          setAnnotationLayers(normalizedAnnotationState.layers);
          setActiveAnnotationLayerId(restoredActiveLayerId);
          const restoredMarkdownLayers = annData.markdownLayers || {};
          markdownAnnotationsRef.current = restoredMarkdownLayers;
          setMarkdownAnnotations(restoredMarkdownLayers);
          setMarkdownUndoStack([]);
          setMarkdownRedoStack([]);
          setNotebookAnnotations(Array.isArray(annData.notebookAnnotations) ? annData.notebookAnnotations : []);
          setNotebookUndoStack([]);
          setNotebookRedoStack([]);
          setAnnotations(
            normalizedAnnotationState.layers.find((layer) => layer.id === restoredActiveLayerId)?.annotations
            || normalizedAnnotationState.layers[0]?.annotations
            || {}
          );
          if (hasTemporarySmartPenStrokes(annData.layers || {})) {
            void authFetch(apiUrl(`/api/source-annotations/${sourceId}`), {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                layers: normalizedAnnotationState.layers,
                activeLayerId: restoredActiveLayerId,
                history: annData.history || [],
                readerState: annData.readerState || null,
              }),
            }).catch((error) => {
              console.error("[PDF] Failed to remove persisted temporary Smart Pen strokes", error);
            });
          }
          setReadingMode(!restoreMarkdown && persistedReaderState?.readingMode === "booklet" ? "booklet" : "single");
          setBookletRightPage(
            !restoreMarkdown && persistedReaderState?.readingMode === "booklet" && persistedReaderState?.bookletRightPage
              ? Math.min(Math.max(1, parseInt(persistedReaderState.bookletRightPage, 10) || 1), numPages || 1)
              : null
          );
          setMarkdownAsideOpen(restoreMarkdown);
          setMarkdownModeMenuOpen(false);
          setMarkdownAsideMode(persistedMarkdownMode);
          setMarkdownRetainedVisualMode(restoreMarkdown ? persistedRetainedVisualMode : null);
          setMarkdownAsideColumnGroup(persistedColumnGroup);
          setMdLineSpacing(persistedLineSpacing);
          setMdSpacingTarget(persistedSpacingTarget);
          setMdLineTagsVisible(persistedReaderState?.mdLineTagsVisible !== false);
          setNotebookMode(persistedNotebookMode);
          setNotebookActiveTab(["typing", "drawing", "settings"].includes(persistedReaderState?.notebookActiveTab)
            ? persistedReaderState.notebookActiveTab
            : "typing");
          setNotebookText(typeof persistedReaderState?.notebookText === "string" ? persistedReaderState.notebookText : "");
          setNotebookVoiceCommands(
            Array.isArray(persistedReaderState?.notebookVoiceCommands) && persistedReaderState.notebookVoiceCommands.length
              ? NOTEBOOK_VOICE_COMMANDS.map((fallback, index) => (
                  index < persistedReaderState.notebookVoiceCommands.length
                    ? (() => {
                        const savedCommand = String(persistedReaderState.notebookVoiceCommands[index] ?? "");
                        return index === 1 && savedCommand === LEGACY_NOTEBOOK_EDIT_COMMAND ? fallback : savedCommand;
                      })()
                    : fallback
                ))
              : NOTEBOOK_VOICE_COMMANDS,
          );
          setZoom(Number.isFinite(persistedReaderState?.zoom) ? normalizeZoom(persistedReaderState.zoom) : 1);
          setSearchOpen(Boolean(persistedReaderState?.searchOpen));
          setSearchQuery(typeof persistedReaderState?.searchQuery === "string" ? persistedReaderState.searchQuery : "");
          pendingReaderRestoreRef.current = persistedReaderState
            ? {
                pageNum: jumpToPage ? (Math.min(Math.max(1, parseInt(jumpToPage, 10) || 1), numPages || 1)) : persistedPageNum,
                pageRatioX: jumpToPage ? null : (typeof persistedReaderState.pageRatioX === "number" ? persistedReaderState.pageRatioX : null),
                pageRatioY: jumpToPage ? null : (typeof persistedReaderState.pageRatioY === "number" ? persistedReaderState.pageRatioY : null),
              }
            : null;
          if (!jumpToPage && persistedReaderState?.pageNum) {
            setPageNum(persistedPageNum);
          }
          // `time` round-trips through JSON as an ISO string — logAnnotHistory
          // and the history panel's own rendering (.toLocaleTimeString(),
          // day-bucketing) both expect a real Date instance.
          setAnnotHistory((annData.history || []).map((h) => ({ ...h, time: new Date(h.time) })));
        }
      } catch {
        // best-effort restore — a failure here shouldn't block reading the PDF
      }
    } catch (err) {
      setLoadError(`Could not load PDF: ${err.message}`);
      setLoading(false);
    }
  }, [loadPdfBytes]);

  // Inserts a real blank PDF page (server-side, via pdf-lib) right after the
  // one currently shown — only meaningful in page-by-page mode, since
  // booklet mode's whole premise is picking two EXISTING pages to view
  // together. Every annotation layer on a page after the insertion point
  // shifts up by one first (and is written back directly, ahead of the
  // reload below) so drawings stay attached to the same visual content
  // they were made on instead of drifting onto the new blank page.
  const insertBlankPageAfterCurrent = useCallback(async () => {
    const sourceId = currentSourceIdRef.current;
    if (!sourceId || insertingBlankPage) return;
    setInsertingBlankPage(true);
    try {
      const res = await authFetch(apiUrl(`/api/sources/${sourceId}/insert-page`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ afterPage: pageNum }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setLoadError(`Could not insert page: ${data.error || res.status}`);
        return;
      }

      const shiftPagesUp = (obj) => {
        const shifted = {};
        for (const [key, val] of Object.entries(obj || {})) {
          const n = parseInt(key, 10);
          shifted[n > pageNum ? n + 1 : n] = val;
        }
        return shifted;
      };
      const shiftedLayersState = annotationLayersForView.map((layer) => ({
        ...layer,
        annotations: shiftPagesUp(layer.id === activeAnnotationLayer?.id ? annotations : layer.annotations),
      }));
      const shiftedLayers = shiftedLayersState.find((layer) => layer.id === activeAnnotationLayer?.id)?.annotations || {};
      skipNextAnnotationAutosaveRef.current = true; // writing it directly below — the debounced autosave effect shouldn't also fire against the pre-shift state
      setAnnotationLayers(shiftedLayersState);
      setAnnotations(shiftedLayers);
      setRedoStacks({});
      await authFetch(apiUrl(`/api/source-annotations/${sourceId}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildAnnotationSavePayload({ activeAnnotations: shiftedLayers, layers: shiftedLayersState })),
      }).catch(() => {});

      setBlankInsertedPages((prev) => {
        const next = new Set(Array.from(prev, (n) => (n > pageNum ? n + 1 : n)));
        next.add(pageNum + 1); // the new blank page itself
        return next;
      });

      await loadFromSource(sourceId, filename, pageNum + 1);
    } finally {
      setInsertingBlankPage(false);
    }
  }, [pageNum, annotations, annotHistory, filename, loadFromSource, insertingBlankPage]);
  useEffect(() => {
    const sourceId = currentSourceIdRef.current;
    const companionContentOpen = entityBuilderOcrBlankPageOpen || markdownAsideOpen;
    if (!companionContentOpen) {
      setEntityBuilderRawBlankPageRows([]);
      setEntityBuilderRawBlankPageMeta({ pageWidth: 0, pageHeight: 0 });
      setEntityBuilderVisualRawBlankPageText("");
      setEntityBuilderOcrBlankPageAnnotations([]);
      setEntityBuilderEmptyAreaHighlightsOpen(false);
      setEntityBuilderOcrBlankPageBusy(false);
      setEntityBuilderOcrBlankPageError("");
      setEntityBuilderTesseractRows([]);
      setEntityBuilderTesseractMeta({ pageWidth: 0, pageHeight: 0 });
      setEntityBuilderTesseractError("");
      return undefined;
    }
    if (!sourceId || !pageNum) {
      setEntityBuilderRawBlankPageRows([]);
      setEntityBuilderRawBlankPageMeta({ pageWidth: 0, pageHeight: 0 });
      setEntityBuilderVisualRawBlankPageText("");
      setEntityBuilderOcrBlankPageAnnotations([]);
      setEntityBuilderEmptyAreaHighlightsOpen(false);
      setEntityBuilderOcrBlankPageBusy(false);
      setEntityBuilderOcrBlankPageError("No source page is available for OCR rendering.");
      setEntityBuilderTesseractRows([]);
      setEntityBuilderTesseractMeta({ pageWidth: 0, pageHeight: 0 });
      setEntityBuilderTesseractError("");
      return undefined;
    }
    let cancelled = false;
    setEntityBuilderTesseractRows([]);
    setEntityBuilderTesseractMeta({ pageWidth: 0, pageHeight: 0, pageNumber: 0, renderDpi: 200, coordinateSpace: "ocr_page_pixels" });
    setEntityBuilderTesseractError("");
    setEntityBuilderOcrBlankPageBusy(true);
    setEntityBuilderOcrBlankPageError("");

    buildRawRowsForBlankPage()
      .then((result) => {
        if (cancelled) return;
        setEntityBuilderRawBlankPageRows(Array.isArray(result?.rows) ? result.rows : []);
        setEntityBuilderRawBlankPageMeta({
          pageWidth: Number(result?.pageWidth) || 0,
          pageHeight: Number(result?.pageHeight) || 0,
          viewportScale: Number(result?.viewportScale) || 0,
          pageRotation: Number(result?.pageRotation) || 0,
          mediaBox: Array.isArray(result?.mediaBox) ? result.mediaBox : [],
        });
      })
      .catch(() => {
        if (!cancelled) {
          setEntityBuilderRawBlankPageRows([]);
          setEntityBuilderRawBlankPageMeta({ pageWidth: 0, pageHeight: 0 });
        }
      });
    buildVisualRawTextForBlankPage()
      .then((text) => {
        if (!cancelled) setEntityBuilderVisualRawBlankPageText(String(text || ""));
      })
      .catch(() => {
        if (!cancelled) setEntityBuilderVisualRawBlankPageText("");
      });

    authFetch(apiUrl(`/api/sources/${sourceId}/ocr/pages?page=${pageNum}&includeRaw=1`))
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (response.status === 202 && ["queued", "uploading", "processing"].includes(data.status)) {
          setEntityBuilderOcrBlankPageAnnotations([]);
          setEntityBuilderOcrBlankPageError("OCR is still processing for this page.");
          return;
        }
        const ocrPage = data.pages?.[0];
        if (!response.ok || !ocrPage) {
          setEntityBuilderOcrBlankPageAnnotations([]);
          setEntityBuilderOcrBlankPageError(typeof data.error === "string" ? data.error : data.error?.message || "Could not load OCR for this page.");
          return;
        }
        const persistedTesseractRows = Array.isArray(ocrPage.rawPage?.words) ? ocrPage.rawPage.words : [];
        if (persistedTesseractRows.length) {
          setEntityBuilderTesseractRows(persistedTesseractRows);
          setEntityBuilderTesseractMeta({
            pageWidth: Number(ocrPage.width) || Number(ocrPage.rawPage?.width) || 0,
            pageHeight: Number(ocrPage.height) || Number(ocrPage.rawPage?.height) || 0,
            pageNumber: Number(ocrPage.pageIndex) + 1 || pageNum,
            renderDpi: Number(ocrPage.rawPage?.renderDpi) || 200,
            coordinateSpace: ocrPage.coordinateSpace || ocrPage.rawPage?.coordinateSpace || "ocr_page_pixels",
          });
        }
        const importedTextAnnotations = await buildOcrTextAnnotationsForBlankPage({
          ocrPage,
          referencePage: pageNum,
          destinationPage: pageNum,
        });
        if (cancelled) return;
        if (!importedTextAnnotations.length) {
          setEntityBuilderOcrBlankPageAnnotations([]);
          setEntityBuilderOcrBlankPageError("No OCR text with usable coordinates was found for this page.");
          return;
        }
        setEntityBuilderOcrBlankPageAnnotations(importedTextAnnotations);
        setEntityBuilderOcrBlankPageError("");
      })
      .catch(() => {
        if (cancelled) return;
        setEntityBuilderOcrBlankPageAnnotations([]);
        setEntityBuilderOcrBlankPageError("Could not build the OCR blank page.");
      })
      .finally(() => {
        if (!cancelled) setEntityBuilderOcrBlankPageBusy(false);
      });

    return () => { cancelled = true; };
  }, [buildOcrTextAnnotationsForBlankPage, buildRawRowsForBlankPage, buildVisualRawTextForBlankPage, entityBuilderOcrBlankPageOpen, markdownAsideOpen, pageNum]);
  // Ref-mirrored (same pattern as textSelectableRef/onSelectionActionRef
  // above) so useImperativeHandle — declared earlier in this component,
  // before insertBlankPageAfterCurrent even exists as a binding — can
  // still always call the LATEST version of this closure.
  useEffect(() => { insertBlankPageRef.current = insertBlankPageAfterCurrent; }, [insertBlankPageAfterCurrent]);

  // Deletes the currently-viewed page outright — but ONLY a page this
  // source has had inserted blank via the button above (blankInsertedPages,
  // persisted server-side so it's not limited to the session it was added
  // in), so this is strictly an "undo a blank insert," never a way to
  // one-click
  // remove real, pre-existing document content. Same server-side pdf-lib
  // edit + reload shape as insertBlankPageAfterCurrent, just shifting
  // every later page's annotation layer DOWN by one instead of up, and
  // dropping the deleted page's own layer entirely (nothing for it to
  // reattach to — it's blank by construction, never had any).
  const deletePageAtCurrent = useCallback(async () => {
    const sourceId = currentSourceIdRef.current;
    if (!sourceId || insertingBlankPage || deletingPage || pageCount <= 1) return;
    if (!blankInsertedPages.has(pageNum)) return;
    setDeletingPage(true);
    try {
      const res = await authFetch(apiUrl(`/api/sources/${sourceId}/delete-page`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page: pageNum }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setLoadError(`Could not delete page: ${data.error || res.status}`);
        return;
      }

      const shiftPagesDown = (obj) => {
        const shifted = {};
        for (const [key, val] of Object.entries(obj || {})) {
          const n = parseInt(key, 10);
          if (n === pageNum) continue;
          shifted[n > pageNum ? n - 1 : n] = val;
        }
        return shifted;
      };
      const shiftedLayersState = annotationLayersForView.map((layer) => ({
        ...layer,
        annotations: shiftPagesDown(layer.id === activeAnnotationLayer?.id ? annotations : layer.annotations),
      }));
      const shiftedLayers = shiftedLayersState.find((layer) => layer.id === activeAnnotationLayer?.id)?.annotations || {};
      skipNextAnnotationAutosaveRef.current = true;
      setAnnotationLayers(shiftedLayersState);
      setAnnotations(shiftedLayers);
      setRedoStacks({});
      await authFetch(apiUrl(`/api/source-annotations/${sourceId}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildAnnotationSavePayload({ activeAnnotations: shiftedLayers, layers: shiftedLayersState })),
      }).catch(() => {});

      setBlankInsertedPages((prev) => {
        const next = new Set();
        for (const n of prev) {
          if (n === pageNum) continue;
          next.add(n > pageNum ? n - 1 : n);
        }
        return next;
      });

      const newPageCount = Math.max(1, pageCount - 1);
      await loadFromSource(sourceId, filename, Math.min(pageNum, newPageCount));
    } finally {
      setDeletingPage(false);
    }
  }, [pageNum, pageCount, annotations, annotHistory, filename, loadFromSource, insertingBlankPage, deletingPage, blankInsertedPages]);

  // ── Load from Sources page ────────────────────────────────────────────────
  useEffect(() => {
    if (embeddedSourceId) {
      const nextKey = `embedded:${embeddedSourceId}:${embeddedPdfName || "document.pdf"}:${initialPage || ""}`;
      if (lastLoadedSourceKeyRef.current === nextKey) return;
      lastLoadedSourceKeyRef.current = nextKey;
      loadFromSource(embeddedSourceId, embeddedPdfName || "document.pdf", initialPage);
      return;
    }

    const { sourceId, pdfName, page } = location.state || {};
    if (!sourceId) return;
    const nextKey = `route:${sourceId}:${pdfName || "document.pdf"}:${page || ""}`;
    if (lastLoadedSourceKeyRef.current === nextKey) return;
    lastLoadedSourceKeyRef.current = nextKey;
    loadFromSource(sourceId, pdfName || "document.pdf", page);
  }, [embeddedPdfName, embeddedSourceId, initialPage, loadFromSource, location.state]);

  // ── Load a locally-picked file (embedded, no server round-trip) ────────────
  useEffect(() => {
    if (!embeddedFile || lastLoadedFileRef.current === embeddedFile) return;
    lastLoadedFileRef.current = embeddedFile;
    loadFile(embeddedFile);
  }, [embeddedFile, loadFile]);

  // ── History ────────────────────────────────────────────────────────────────
  const handleDeleteExtraction = useCallback(async (e, id) => {
    e.stopPropagation();
    try {
      await authFetch(apiUrl(`/api/pdf/history/${id}`), { method: "DELETE" });
      setHistory((h) => h.filter((item) => item._id !== id));
      if (activeHistoryId === id) { setActiveHistoryId(null); setSavedId(null); }
    } catch {}
  }, [activeHistoryId]);

  const loadHistoryItem = useCallback(async (id) => {
    if (id === activeHistoryId) return;
    try {
      const res  = await authFetch(apiUrl(`/api/pdf/history/${id}`));
      const data = await res.json();
      if (data.extraction) {
        setHyleData(inflateExtraction(data.extraction));
        setHylePage(data.extraction.pageNumber);
        setActiveHistoryId(id); setSavedId(id); setExtractError("");
      }
    } catch {}
  }, [activeHistoryId]);

  // ── Save ───────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!hyleData || saving) return;
    setSaving(true);
    try {
      const { systemMessage } = await (await fetch(apiUrl("/api/pdf/system-message"))).json();
      const res  = await authFetch(apiUrl("/api/pdf/save-extraction"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: filename || "unknown.pdf",
          pageCount: pageCount || 1,
          type: pdfType || "text-based",
          pageNumber: hylePage || pageNum,
          provider: extractMode === "manual" ? "manual" : provider,
          model: extractMode === "manual" ? "user" : provider,
          systemMessageSnapshot: systemMessage || "",
          nouns: deflateNounData(hyleData),
          totalNouns: hyleData._total,
        }),
      });
      const data = await res.json();
      if (data.extractionId) {
        setSavedId(data.extractionId);
        authFetch(apiUrl("/api/pdf/history")).then((r) => r.json()).then((d) => setHistory(d.extractions || [])).catch(() => {});
      }
    } catch {}
    finally { setSaving(false); }
  }, [hyleData, saving, filename, pageCount, pdfType, hylePage, pageNum, provider, extractMode]);

  // Reads persisted OCR only. A missing or still-processing cache falls back to
  // local pdf.js extraction and never starts a provider request from the reader.
  const getPageText = useCallback(async (n) => {
    const sourceId = currentSourceIdRef.current;
    if (sourceId) {
      try {
        const res  = await authFetch(apiUrl(`/api/sources/${sourceId}/ocr/pages?page=${n}`));
        const data = await res.json();
        const ocrPage = data.pages?.[0];
        if (res.ok && ocrPage?.markdown?.trim()) return ocrPage.markdown;
      } catch {}
    }
    const page    = await pdfDoc.getPage(n);
    const content = await page.getTextContent();
    return content.items.map((item) => item.str + (item.hasEOL ? "\n" : " ")).join("").trim();
  }, [pdfDoc]);

  const loadPdfAssistantPages = useCallback(async () => {
    const cached = pdfAssistantPagesCacheRef.current;
    if (cached.document === pdfDoc && cached.pages) return cached;
    if (cached.document === pdfDoc && cached.promise) return cached.promise;

    const promise = (async () => {
      const assistantPageCount = Math.min(pageCount, 1500);
      const perPageCharacterLimit = Math.max(
        700,
        Math.min(12000, Math.floor(1500000 / Math.max(1, assistantPageCount))),
      );
      const sourceId = currentSourceIdRef.current;
      let pages = null;
      let stored = false;
      let generated = false;

      // Saved documents use one read-only bulk request to the persisted OCR
      // cache. Opening the assistant can never initiate document processing.
      if (sourceId) {
        try {
          const res = await authFetch(apiUrl(`/api/sources/${sourceId}/ocr/pages?from=1&to=${assistantPageCount}`));
          const data = await res.json();
          if (res.ok && Array.isArray(data.pages) && data.pages.some((p) => String(p.markdown || "").trim())) {
            pages = data.pages.map((p) => ({ pageNumber: Number(p.pageIndex) + 1, text: String(p.markdown || "").slice(0, perPageCharacterLimit) }));
            stored = true;
            generated = false;
          }
        } catch {
          // falls through to the per-page native-extraction loop below
        }
      }

      // Local/unsaved files (no sourceId), or the bulk fetch above failed/
      // came back empty — per-page pdf.js extraction, nothing saved anywhere.
      if (!pages) {
        pages = [];
        for (let start = 1; start <= assistantPageCount; start += 4) {
          const pageNumbers = Array.from(
            { length: Math.min(4, assistantPageCount - start + 1) },
            (_, index) => start + index,
          );
          const batch = await Promise.all(pageNumbers.map(async (pageNumber) => {
            try {
              const text = await getPageText(pageNumber);
              return { pageNumber, text: String(text || "").slice(0, perPageCharacterLimit) };
            } catch {
              return { pageNumber, text: "" };
            }
          }));
          pages.push(...batch);
        }
      }

      const result = { pages, stored, generated };
      pdfAssistantPagesCacheRef.current = { document: pdfDoc, promise: null, pages: result };
      return result;
    })();
    pdfAssistantPagesCacheRef.current = { document: pdfDoc, promise, pages: null };
    return promise;
  }, [getPageText, pageCount, pdfDoc]);

  // Page-space (PDF-point — same convention as ann.x/y/w/h) text spans built
  // straight from pdf.js's raw text items for the CURRENT page, independent
  // of whether the Manual-mode DOM text layer (spansRef) happens to be
  // mounted right now — Smart Segmenting needs to work regardless of
  // extract mode, and spansRef is left stale (not cleared) whenever
  // textSelectable is false, so it can't be trusted here. Item-level (not
  // word-level) granularity is enough: buildTextLines/groupSpansIntoLines
  // only need line-grouping geometry, not per-word boundaries. Same
  // viewport-transform math as the Manual-mode text-layer effect above
  // (pageViewport.transform × item.transform via pdf.js's own Util.transform),
  // just without that effect's word-splitting/font-metrics work, which
  // Smart Segmenting doesn't need.
  const buildPageSpansForSmartSegmenting = useCallback(async () => {
    if (!pageViewport) return [];
    const page = await pdfDoc.getPage(pageNum);
    const content = await page.getTextContent();
    const items = content.items;
    const scale = Math.hypot(pageViewport.transform[0], pageViewport.transform[1]);
    const spans = [];
    for (const item of items) {
      if (!item.str || !item.str.trim()) continue;
      const tx = pdfjsLib.Util.transform(pageViewport.transform, item.transform);
      const fontSize = Math.hypot(tx[2], tx[3]);
      if (fontSize < 1) continue;
      const itemWidth = item.width * scale;
      const originX = tx[4];
      const originY = tx[5];
      const ascentRatio = getPdfTextAscentRatio(content.styles?.[item.fontName]);
      spans.push({
        text: item.str,
        pageLeft: originX / scale,
        pageRight: (originX + itemWidth) / scale,
        pageTop: (originY - fontSize * ascentRatio) / scale,
        pageBottom: (originY - fontSize * ascentRatio + fontSize) / scale,
        pageHeight: fontSize / scale,
      });
    }
    return spans;
  }, [pageNum, pageViewport, pdfDoc]);

  const buildPageImageRectsForSmartSegmenting = useCallback(async () => {
    if (!pageViewport || !pdfDoc) return [];
    const page = await pdfDoc.getPage(pageNum);
    const operatorList = await page.getOperatorList();
    return extractPlacedImageRects(operatorList, pageViewport, pdfjsLib.OPS);
  }, [pageNum, pageViewport, pdfDoc]);

  const runSemanticDetection = useCallback(async () => {
    if (!pdfDoc || !pageViewport || semanticDetectionBusy) return;
    setSemanticDetectionBusy(true);
    setSemanticDetectionDialogOpen(false);
    setSemanticDetectionError("");
    setSemanticDetectionPreview(null);
    try {
      const [spans, imageRects, persistedOcrText] = await Promise.all([
        buildPageSpansForSmartSegmenting(),
        buildPageImageRectsForSmartSegmenting(),
        getPageText(pageNum),
      ]);
      const candidates = buildSemanticCandidates(spans, pageNum - 1, imageRects);
      if (!candidates.length) throw new Error("No candidate regions were found on this page.");
      const form = new FormData();
      form.append("candidates", JSON.stringify(candidates));
      form.append("reasoningEffort", "medium");
      form.append("scope", semanticDetectionScope);
      if (persistedOcrText) form.append("ocrPage", persistedOcrText);
      if (pdfBytesRef.current?.byteLength > 0) form.append("pdf", new Blob([pdfBytesRef.current], { type: "application/pdf" }), filename || "document.pdf");
      const pageCanvas = pageCanvasRefs.current[pageNum - 1];
      if (pageCanvas?.toDataURL) {
        const imageBlob = await new Promise((resolve) => pageCanvas.toBlob(resolve, "image/png"));
        if (imageBlob) form.append("pageImage", imageBlob, `page-${pageNum}.png`);
      }
      const response = await authFetch(apiUrl("/api/ai/semantic-document-detection"), { method: "POST", body: form });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error?.message || data.error || "Semantic detection failed.");
      const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
      const contentsEvidence = candidates.some((candidate) => (
        /\btable\s+of\s+contents\b|\bcontents\b/i.test(candidate.text || "")
        || /\.{2,}\s*\d{1,3}\s*$/.test(candidate.text || "")
      ));
      const normalizedRegions = (data.result?.regions || []).map((region) => {
        const regionText = region.candidateIds.map((id) => candidateById.get(id)?.text || "").join(" ");
        const rowLooksLikeContents = /\.{2,}\s*\d{1,3}\s*$/.test(regionText)
          || (/\bcontents\b/i.test(regionText) && ["body_paragraph", "list", "unknown"].includes(region.type));
        return contentsEvidence && rowLooksLikeContents
          ? { ...region, type: "table_of_contents", reasonCodes: [...(region.reasonCodes || []), "contents-page-pattern"] }
          : region;
      });
      setSemanticDetectionPreview({
        ...data.result,
        regions: normalizedRegions,
        candidates,
        candidateById,
        provider: data.provider,
        model: data.model,
      });
    } catch (error) {
      setSemanticDetectionError(error.message || "Semantic detection failed.");
    } finally {
      setSemanticDetectionBusy(false);
    }
  }, [pdfDoc, pageViewport, semanticDetectionBusy, buildPageSpansForSmartSegmenting, buildPageImageRectsForSmartSegmenting, getPageText, pageNum, semanticDetectionScope, filename]);

  const applySemanticDetection = useCallback((regionsOverride = null) => {
    if (!semanticDetectionPreview) return;
    const candidateById = semanticDetectionPreview.candidateById;
    const regions = regionsOverride || semanticDetectionPreview.regions;
    const nextIdStart = Date.now();
    const additions = regions
      .filter((region) => Number(region.confidence) >= 0.85)
      .map((region, index) => {
        const type = semanticTypeToBBoxType(region.type);
        if (!type) return null;
        let box;
        try { box = unionCandidateBoxes(region.candidateIds, candidateById); } catch { return null; }
        return {
          ...box,
          id: nextIdStart + index,
          type,
          color: nextDistinctBBoxColor(visiblePageAnnotations),
          closed: true,
          geometry: "rectangle",
          semanticDetected: true,
          semanticRole: region.type,
          semanticConfidence: region.confidence,
          semanticCandidateIds: region.candidateIds,
          text: region.candidateIds.map((id) => candidateById.get(id)?.text || "").filter(Boolean).join(" "),
          lineWidth: bboxBorderSize,
          borderStyle: shapeBorderStyle,
        };
      })
      .filter(Boolean);
    if (!additions.length) {
      setSemanticDetectionError("No confident semantic regions could be applied.");
      return;
    }
    const nextAnnotations = {
      ...annotations,
      [pageNum]: [...(annotations[pageNum] || []), ...additions],
    };
    setAnnotations(nextAnnotations);
    setRedoStacks((prev) => (prev[pageNum]?.length ? { ...prev, [pageNum]: [] } : prev));
    logAnnotHistory({ action: "semantic-detection", page: pageNum, count: additions.length });
    const sourceId = currentSourceIdRef.current;
    if (sourceId) {
      authFetch(apiUrl(`/api/source-annotations/${sourceId}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildAnnotationSavePayload({ activeAnnotations: nextAnnotations })),
      }).catch(() => {});
    }
    if (regionsOverride) {
      const applied = new Set(regionsOverride);
      setSemanticDetectionPreview((current) => {
        if (!current) return null;
        const remaining = current.regions.filter((region) => !applied.has(region));
        return remaining.length ? { ...current, regions: remaining } : null;
      });
    } else {
      setSemanticDetectionPreview(null);
    }
  }, [semanticDetectionPreview, visiblePageAnnotations, nextDistinctBBoxColor, annotations, pageNum, bboxBorderSize, shapeBorderStyle, logAnnotHistory, buildAnnotationSavePayload]);

  // BBox tool's "Smart Segmenting" action — one bbox per paragraph on the
  // current page, matched from the page's own cached OCR
  // Markdown against the PDF's real text geometry. Deliberately no AI/LLM
  // call: paragraph boundaries already exist in the Markdown, geometry
  // already exists in the PDF's text layer, and matching one against the
  // other is a deterministic text-comparison problem (pdfSmartSegment.js,
  // built on the same normalization/fuzzy-matching tools the search bar
  // uses) — not something that benefits from a model call.
  const runSmartSegmenting = useCallback(async () => {
    if (!pdfDoc || !pageViewport || smartSegmentingBusy) return;
    const targetSourceId = currentSourceIdRef.current
      || embeddedSourceId
      || location.state?.sourceId
      || "";
    if (!targetSourceId) {
      setSmartSegmentingError("Save this PDF to Sources before creating database-backed segments.");
      return;
    }
    // Pinned to whichever page was current WHEN THE BUTTON WAS CLICKED —
    // this is async (two awaited requests), and without this, navigating to
    // a different page before it resolves would still silently apply the
    // (stale-page's) results via the closure's own `pageNum`/`pageViewport`
    // — reported as "I'm on page 3 but got page 2's text," which is exactly
    // that: the operation actually ran against whatever page was current
    // when it STARTED, not whatever's current when it FINISHES. The
    // pageNumRef check below aborts instead of silently mutating a page
    // you've since navigated away from.
    const targetPageNum = pageNum;
    setSmartSegmentingBusy(true);
    setSmartSegmentingError("");
    try {
      const [markdown, spans, imageRects] = await Promise.all([
        getPageText(targetPageNum),
        buildPageSpansForSmartSegmenting(),
        buildPageImageRectsForSmartSegmenting(),
      ]);

      if (pageNumRef.current !== targetPageNum) {
        setSmartSegmentingError(`Switched away from page ${targetPageNum} before Smart Segmenting finished — try again on the page you want.`);
        return;
      }

      // debug isn't used for anything functional — it just lets a failed
      // run (0 matches) be diagnosed from the console instead of being a
      // single opaque error message. See segmentPageIntoParagraphBBoxes'
      // own comment for the shape.
      const debug = {};
      const matches = segmentPageIntoParagraphBBoxes(markdown, spans, debug, imageRects);
      console.log("[Smart Segmenting]", {
        page: targetPageNum,
        markdownLength: markdown?.length || 0,
        markdownPreview: String(markdown || "").slice(0, 200),
        spanCount: spans.length,
        imageCount: imageRects.length,
        paragraphCount: debug.paragraphCount,
        lineCount: debug.lineCount,
        matchedCount: matches.length,
        attempts: debug.attempts,
      });
      if (!matches.length) {
        setSmartSegmentingError("Couldn't confidently match any paragraphs on this page.");
        return;
      }

      const normalizeSegmentText = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
      const matchedTexts = new Set(matches.map((match) => normalizeSegmentText(match.text)).filter(Boolean));
      // Replace a previous Smart Segmenting result for the same paragraph.
      // Otherwise its persisted old rectangle remains directly underneath the
      // corrected one and makes a rerun look as though nothing changed.
      const existingPageAnnotations = (annotations[targetPageNum] || []).filter((annotation) => {
        if (annotation.smartSegmented === true) return false;
        return !(isBBoxType(annotation.type) && matchedTexts.has(normalizeSegmentText(annotation.text)));
      });
      // nextDistinctBBoxColor only ever looks at the array it's handed, so
      // each call needs to see the colors already claimed by THIS batch too
      // — not just what was on the page before it started — or every new
      // box would pick the same "first unused" color.
      const colorPool = [...existingPageAnnotations];
      let nextSmartBBoxId = Date.now();
      const smartTypeOrdinals = {};
      const createSmartBBox = (match, type, padding = 3, bottomPadding = padding, horizontalPadding = padding) => {
        const color = nextDistinctBBoxColor(colorPool);
        colorPool.push({ type, color });
        const annotation = {
          id: nextSmartBBoxId++,
          hyleId: getSemanticHyleBBoxId(
            targetSourceId,
            targetPageNum,
            type,
            (smartTypeOrdinals[type] = (smartTypeOrdinals[type] || 0) + 1),
          ),
          type,
          color,
          x: match.rect.x - horizontalPadding,
          y: match.rect.y - padding,
          w: match.rect.w + horizontalPadding * 2,
          h: match.rect.h + padding + bottomPadding,
          closed: true,
          borderStyle: shapeBorderStyle,
          lineWidth: bboxBorderSize,
          shapeBackground: false,
          smartSegmented: true,
          smartSegmentRole: type === "imageBBox" ? "figure" : "paragraph",
          text: match.text,
          title: match.title || "",
        };
        const imageSnippet = type === "imageBBox" ? captureImageBBoxSnippet(annotation) : null;
        return imageSnippet
          ? { ...annotation, imageDataUrl: imageSnippet.dataUrl, imageWidth: imageSnippet.width, imageHeight: imageSnippet.height }
          : annotation;
      };
      const smartBBoxGroups = matches.map((match) => {
        if (match.kind !== "section" || !match.childSegments?.length) {
          return [createSmartBBox(match, match.imageSegment ? "imageBBox" : "bbox")];
        }
        // Semantic headings remain useful metadata, but smart segmentation now
        // emits only content BBoxes rather than structural section/chapter boxes.
        const imageChild = match.imageSegment
          ? [createSmartBBox(match.imageSegment, "imageBBox", 1)]
          : [];
        const paragraphs = match.childSegments.map((child) => createSmartBBox(child, "bbox", 1));
        return [...imageChild, ...paragraphs];
      });
      // Preserve the exact candidate geometry. BBoxes are allowed to overlap;
      // no obstacle/shield promotion is applied to manual or smart results.
      const newBBoxes = smartBBoxGroups.flat();

      const nextAnnotations = { ...annotations, [targetPageNum]: [...existingPageAnnotations, ...newBBoxes] };
      const nextHistory = appendAnnotHistoryEntry(annotHistory, {
        action: "add",
        type: "bbox",
        page: targetPageNum,
        count: newBBoxes.length,
      });
      const saveResponse = await authFetch(apiUrl(`/api/source-annotations/${targetSourceId}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildAnnotationSavePayload({ activeAnnotations: nextAnnotations, history: nextHistory })),
      });
      if (!saveResponse.ok) {
        const saveError = await saveResponse.json().catch(() => ({}));
        const saveMessage = typeof saveError.error === "string"
          ? saveError.error
          : saveError.error?.message;
        throw new Error(saveMessage || `Could not save segments (${saveResponse.status}).`);
      }

      // The database is authoritative: publish the generated segmentation
      // locally only after its persisted layer payload is confirmed.
      setAnnotations(nextAnnotations);
      setRedoStacks((prev) => (prev[targetPageNum]?.length ? { ...prev, [targetPageNum]: [] } : prev));
      setAnnotHistory(nextHistory);
    } catch (error) {
      setSmartSegmentingError(error?.message || "Smart Segmenting failed for this page.");
    } finally {
      setSmartSegmentingBusy(false);
    }
  }, [
    pdfDoc, pageViewport, smartSegmentingBusy, getPageText, pageNum, buildPageSpansForSmartSegmenting,
    buildPageImageRectsForSmartSegmenting,
    annotations, nextDistinctBBoxColor, shapeBorderStyle, bboxBorderSize, appendAnnotHistoryEntry,
    annotHistory, buildAnnotationSavePayload, captureImageBBoxSnippet, embeddedSourceId, location.state,
  ]);

  // Shows a page range's (or the whole document's) Markdown in the left-side
  // column (the "All Pages"/pager/delete tools, not the Actions -> Text
  // Extraction flow below, which has its own dedicated fetch). The backend's
  // GET /api/sources/:id/markdown is a compatibility view over persisted OCR.
  // It never launches OCR; pending documents return a non-blocking 202.
  const fetchMarkdownRange = useCallback(async (from, to, isAll) => {
    const sourceId = currentSourceIdRef.current;
    if (!sourceId) return;
    setPageMdOpen(true);
    setPageMdBusy(true);
    setPageMdError("");
    setPdfMdCountHighlight(null);
    setVoiceMatch(null);
    setVoiceQuery("");
    setVoiceError("");
    try {
      // Always go through from/to (even for "All Pages") with pageMarkers=1 so
      // the panel can show a "=== Page N ===" divider between pages.
      const lo = isAll ? 1 : from;
      const hi = isAll ? pageCount : to;
      const res  = await authFetch(apiUrl(`/api/sources/${sourceId}/markdown?from=${lo}&to=${hi}&pageMarkers=1`), { signal: AbortSignal.timeout(5 * 60 * 1000) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load Markdown.");
      setPageMdText(data.markdown || "");
      setPageMdRange({ from: data.from ?? lo, to: data.to ?? hi, all: isAll });
    } catch (err) {
      setPageMdError(err.message);
      setPageMdText("");
      setPageMdRange(null);
    } finally {
      setPageMdBusy(false);
    }
  }, [pageCount]);

  // Actions -> Text Extraction: instead of the inline pageMdOpen panel, spins
  // up a real AMCTOSHS Draft document containing the WHOLE document's text
  // (every page, in order — not just the one currently open), and navigates
  // there. Each PDF page's text lands as its own run of literal-text blocks
  // (escaped, one line per <div> — not parsed into rich formatting), preceded
  // by a `data-page-break` marker div for every page after the first, so the
  // draft's structure mirrors the PDF's page-by-page layout: the on-screen
  // editor shows a plain "— Page N —" divider (real pixel-perfect on-screen
  // pagination isn't something this editor's decorative page background can
  // do), and the PDF exporter (see buildDocumentPdf's data-page-break check)
  // turns each marker into a *real* forced page break in the exported PDF.
  // Posting with sourceId (no sourcePage — this is the one whole-document
  // draft, not a per-page one) lets the backend hand back the SAME draft on
  // a repeat click instead of creating duplicates, and the draft carries
  // sourceId/sourceName back so its own page can render a link back to this
  // PDF — that pair is the "back and forth" between the two.
  const openMarkdownAsDraft = useCallback(async () => {
    const sourceId = currentSourceIdRef.current;
    if (!sourceId) return;
    setActionsMenuOpen(false);
    setMdDraftBusy(true);
    setMdDraftError("");
    try {
      const mdRes = await authFetch(apiUrl(`/api/sources/${sourceId}/markdown?from=1&to=${pageCount}&includePages=1`));
      const mdData = await mdRes.json();
      if (!mdRes.ok) throw new Error(mdData.error || "Failed to load Markdown.");

      const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const toDraftParagraphs = (text) => {
        const cleaned = cleanMarkdownToPlainText(text);
        const paragraphs = cleaned
          ? cleaned.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean)
          : [];

        if (!paragraphs.length) return "<div><br></div>";

        return paragraphs.map((paragraph) => {
          const lines = paragraph
            .split("\n")
            .map((line) => escapeHtml(line))
            .join("<br />");
          return `<div>${lines || "<br>"}</div>`;
        }).join("");
      };
      const pages = Array.isArray(mdData.pages) && mdData.pages.length
        ? mdData.pages
        : [{ pageNumber: 1, markdown: mdData.markdown || "" }];

      const content = pages.map(({ pageNumber, markdown }, idx) => {
        const marker = idx > 0
          ? `<div data-page-break="1" class="draft_page_break_marker">— Page ${pageNumber} —</div>`
          : "";
        return marker + toDraftParagraphs(markdown);
      }).join("");

      const draftRes = await authFetch(apiUrl("/api/draft"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: filename || "Document",
          content,
          sourceId,
          sourceName: filename,
        }),
      });
      const draftData = await draftRes.json();
      if (!draftRes.ok) throw new Error(draftData.error || "Failed to create the document.");
      navigate(`/draft/${draftData.id}`);
    } catch (err) {
      setMdDraftError(err.message);
    } finally {
      setMdDraftBusy(false);
    }
  }, [pageCount, filename, navigate]);

  // Jump the Markdown panel straight to a given real page — reuses it from
  // the already-fetched range if present (e.g. after "All Pages"), otherwise
  // fetches just that single page on demand. Either way, scrolls the main
  // reader to the same page so the two stay in sync.
  const goToMarkdownPage = useCallback((targetPage) => {
    const n = Math.max(1, Math.min(pageCount || targetPage, targetPage));
    scrollReaderToPage(n);
    const idx = mdPages.findIndex((p) => p.page === n);
    if (idx !== -1) {
      setMdPageIdx(idx);
    } else {
      mdFocusPageRef.current = n;
      fetchMarkdownRange(n, n, false);
    }
  }, [pageCount, mdPages, scrollReaderToPage, fetchMarkdownRange]);

  // Commits the panel's editable page-number field (blur / Enter).
  const commitMdPageInput = useCallback(() => {
    const n = parseInt(mdPageInputVal, 10);
    if (Number.isFinite(n)) goToMarkdownPage(n);
    else setMdPageInputVal(String(mdCurrentPage.page));
  }, [mdPageInputVal, goToMarkdownPage, mdCurrentPage]);


  // Fetches every page's Markdown in one go (it's already converted, so this
  // is just a read) and keeps whichever page is currently displayed in view.
  const showAllMarkdownPages = useCallback(() => {
    mdFocusPageRef.current = mdCurrentPage.page;
    fetchMarkdownRange(1, pageCount, true);
  }, [fetchMarkdownRange, pageCount, mdCurrentPage]);

  const handleDeleteMarkdownPage = useCallback(async () => {
    const sourceId = currentSourceIdRef.current;
    if (!sourceId || pageMdDeleteBusy) return;
    if (!window.confirm(`Delete cached markdown for page ${mdCurrentPage.page}? The PDF source will remain intact.`)) return;

    setPageMdDeleteBusy(true);
    setPageMdError("");
    try {
      const res = await authFetch(apiUrl(`/api/sources/${sourceId}/markdown?page=${mdCurrentPage.page}`), {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete this markdown page.");

      setHasStoredMarkdown(Boolean(data.hasMarkdown));
      setPdfMdCountHighlight(null);
      setVoiceMatch(null);
      setVoiceQuery("");
      setVoiceError("");
      mdFocusPageRef.current = mdCurrentPage.page;
      if (pageMdRange?.all) await fetchMarkdownRange(1, pageCount, true);
      else await fetchMarkdownRange(mdCurrentPage.page, mdCurrentPage.page, false);
    } catch (err) {
      setPageMdError(err.message);
    } finally {
      setPageMdDeleteBusy(false);
    }
  }, [authFetch, fetchMarkdownRange, mdCurrentPage.page, pageCount, pageMdDeleteBusy, pageMdRange]);

  const handleDeleteAllMarkdownPages = useCallback(async () => {
    const sourceId = currentSourceIdRef.current;
    if (!sourceId || pageMdDeleteBusy) return;
    if (!window.confirm("Delete all cached markdown pages for this source? The PDF itself will remain intact.")) return;

    setPageMdDeleteBusy(true);
    setPageMdError("");
    try {
      const res = await authFetch(apiUrl(`/api/sources/${sourceId}/markdown?all=1`), {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete all markdown pages.");

      setHasStoredMarkdown(false);
      setPageMdText("");
      setPageMdRange(null);
      setPdfMdCountHighlight(null);
      setVoiceMatch(null);
      setVoiceQuery("");
      setVoiceError("");
      setPageMdOpen(false);
    } catch (err) {
      setPageMdError(err.message);
    } finally {
      setPageMdDeleteBusy(false);
    }
  }, [pageMdDeleteBusy]);

  // ── Select markdown text by voice (Web Speech API) ──────────────────────────
  const handleVoiceSelect = useCallback(() => {
    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      setVoiceError("Voice recognition isn't supported in this browser.");
      return;
    }
    if (voiceRecognitionRef.current) {
      voiceRecognitionRef.current.stop();
      return;
    }
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => { setVoiceListening(true); setVoiceError(""); };
    recognition.onerror = (e) => {
      setVoiceError(e.error === "no-speech" ? "Didn't catch that — try again." : `Voice error: ${e.error}`);
    };
    recognition.onend = () => { setVoiceListening(false); voiceRecognitionRef.current = null; };
    recognition.onresult = (e) => {
      const transcript = e.results[0][0].transcript.trim();
      setVoiceQuery(transcript);
      const idx = cleanedMdCurrentText.toLowerCase().indexOf(transcript.toLowerCase());
      if (idx === -1) {
        setVoiceMatch(null);
        setVoiceError(`"${transcript}" wasn't found on this page.`);
      } else {
        setVoiceMatch({ start: idx, end: idx + transcript.length });
        setVoiceError("");
      }
    };
    voiceRecognitionRef.current = recognition;
    recognition.start();
  }, [cleanedMdCurrentText]);

  useEffect(() => {
    if (!voiceMatch) return;
    document.querySelector(".draft_text_viewer__highlight")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [voiceMatch]);

  useEffect(() => {
    const layer = textLayerRef.current;
    const spans = spansRef.current;

    layer?.querySelectorAll(".pdf_md_count_highlight").forEach((el) => el.remove());
    if (!layer || !pdfMdCountHighlight || pageNum !== mdCurrentPage.page || spans.length === 0) return;

    const layerRect = layer.getBoundingClientRect();
    const bodyZoom = parseFloat(document.body.style.zoom) || 1;
    const lines = [];

    spans.forEach(({ el, text }) => {
      if (!el || !/\S/.test(text || "")) return;

      const r = el.getBoundingClientRect();
      const left = (r.left - layerRect.left) / bodyZoom;
      const top = (r.top - layerRect.top) / bodyZoom;
      const right = (r.right - layerRect.left) / bodyZoom;
      const bottom = (r.bottom - layerRect.top) / bodyZoom;
      const h = bottom - top;
      const padV = Math.min(1.8, Math.max(0.8, h * 0.08));

      let line = lines.find((l) => Math.abs(l.refTop - top) < Math.max(8, h * 0.5));
      if (!line) {
        line = { refTop: top, minL: Infinity, maxR: -Infinity, minT: Infinity, maxB: -Infinity };
        lines.push(line);
      }
      line.minL = Math.min(line.minL, left);
      line.maxR = Math.max(line.maxR, right);
      line.minT = Math.min(line.minT, top - padV);
      line.maxB = Math.max(line.maxB, bottom + padV);
    });

    for (const l of lines) {
      const rect = document.createElement("div");
      rect.className = "pdf_md_count_highlight";
      rect.style.position = "absolute";
      rect.style.left = `${l.minL}px`;
      rect.style.top = `${l.minT}px`;
      rect.style.width = `${l.maxR - l.minL}px`;
      rect.style.height = `${l.maxB - l.minT}px`;
      rect.style.background = pdfMdCountHighlight === "chars"
        ? "rgba(255, 167, 38, 0.28)"
        : "rgba(56, 139, 253, 0.28)";
      rect.style.borderRadius = "2px";
      rect.style.pointerEvents = "none";
      rect.style.zIndex = "1";
      layer.insertBefore(rect, layer.firstChild);
    }

    return () => { layer?.querySelectorAll(".pdf_md_count_highlight").forEach((el) => el.remove()); };
  }, [pdfMdCountHighlight, pageNum, mdCurrentPage.page, pageViewport]);

  // ── AI extraction (streaming) ──────────────────────────────────────────────
  const handleExtract = useCallback(async () => {
    if (!pdfDoc || extracting || pdfType === "scanned") return;
    setExtracting(true);
    setHyleData(EMPTY_HYLES());
    setHylePage(pageNum);
    setExtractError(""); setSavedId(null); setActiveHistoryId(null);

    try {
      const text = await getPageText(pageNum);

      if (!text || text.replace(/\s/g, "").length < 80) {
        setExtractError("This page has no extractable text content.");
        setHyleData(null);
        return;
      }

      const res     = await authFetch(apiUrl("/api/pdf/extract-nouns"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, provider }),
      });

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer    = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") break;
          try {
            const { noun, card, mode, reason, total, error: err } = JSON.parse(payload);
            if (err) { setExtractError(err); break; }
            if (noun && card && mode) {
              setHyleData((prev) => {
                const all = ["entities","traces","phenomena","concept","models"].flatMap((c) => ALL_MODES.flatMap((m) => prev[c][m].map((it) => it.noun)));
                if (all.includes(noun)) return prev;
                const num = prev[card][mode].length + 1;
                return {
                  ...prev,
                  [card]: { ...prev[card], [mode]: [...prev[card][mode], { id: `${card}_${mode}_${num}`, num, noun, reason: reason || "", status: initStatus() }] },
                  _total: total,
                };
              });
            }
          } catch {}
        }
      }
    } catch (err) {
      setExtractError(err.message);
    } finally {
      setExtracting(false);
    }
  }, [pdfDoc, pageNum, extracting, pdfType, provider, getPageText]);

  // ── Manual selection ───────────────────────────────────────────────────────
  const handleManualAdd = useCallback(() => {
    const noun = manualHyle.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.,;:]+$/, "");
    if (!noun) return;

    setHyleData((prev) => {
      const base = prev || EMPTY_HYLES();
      const all  = ["entities","traces","phenomena","concept","models"].flatMap((c) => ALL_MODES.flatMap((m) => base[c][m].map((it) => it.noun)));
      if (all.includes(noun)) return base;
      const num = (base[manualCard][manualMode]?.length || 0) + 1;
      return {
        ...base,
        [manualCard]: {
          ...base[manualCard],
          [manualMode]: [...base[manualCard][manualMode], { id: `${manualCard}_${manualMode}_${num}`, num, noun, reason: "manual", status: initStatus() }],
        },
        _total: (base._total || 0) + 1,
      };
    });
    if (!hylePage) setHylePage(pageNum);
    setManualPopup(null);
    setManualHyle("");
    window.getSelection()?.removeAllRanges();
  }, [manualHyle, manualCard, manualMode, hylePage, pageNum]);

  // Thin selection bar (reading mode): Translate to / Definition /
  // Linguistic Structure Check — short AI lookups on the double-clicked word.
  const runSelectionTool = useCallback(async (action) => {
    const word = manualSelection?.text;
    if (!word || selectionToolBusy) return;
    setSelectionToolBusy(action);
    setSelectionToolError("");
    setSelectionToolResult(null);
    const targetLang = localStorage.getItem("mctosh_pdf_translate_lang") || "English";
    try {
      const res = await authFetch(apiUrl("/api/ai/text-tool"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: word,
          action,
          provider,
          targetLang,
          translator: action === "translate" ? readTranslatorProvider() : undefined,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message || "Request failed.");
      const labels = {
        translate: `Translation (${targetLang})`,
        define: "Definition",
        linguistic_check: "Linguistic Structure",
      };
      setSelectionToolResult({ label: labels[action] || action, text: data.result || "" });
    } catch (e) {
      setSelectionToolError(e.message || "Request failed.");
    } finally {
      setSelectionToolBusy(null);
    }
  }, [manualSelection, selectionToolBusy, provider]);

  // Local, free, deterministic text correction (pdfTextCorrection.js) —
  // no network call, no AI provider, runs synchronously against the
  // selection alone. A separate action from Translate/Define/Linguistic
  // Check above (those call the backend's AI text-tool endpoint); this one
  // never leaves the browser.
  const runLocalTextCorrection = useCallback(() => {
    const word = manualSelection?.text;
    if (!word) return;
    setSelectionToolError("");
    setSelectionToolResult(null);
    setCorrectionResult(correctSelectedPdfText({ selectedText: word, pageNumber: pageNum }));
  }, [manualSelection, pageNum]);

  // Cross-check builder source text against the current page text via AI
  // and return a corrected value. The selection bar no longer owns this
  // action; AMCTOSHS Entity Builder does.
  const verifyEntityBuilderSource = useCallback(async (text) => {
    const word = String(text || "").trim();
    if (!word || selectionVerifyBusy) return word;
    setSelectionVerifyBusy(true);
    setSelectionToolError("");
    try {
      const context = await getPageText(pageNum);
      const res = await authFetch(apiUrl("/api/ai/text-tool"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: word, action: "verify_selection", context, provider }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message || "Request failed.");
      const corrected = String(data.result || "").trim();
      return corrected || word;
    } catch (e) {
      throw new Error(e.message || "Verification failed.");
    } finally {
      setSelectionVerifyBusy(false);
    }
  }, [selectionVerifyBusy, getPageText, pageNum, provider]);

  // "Extract Eidos and Find Videos" — the captured screenshots' OCR'd text
  // (concatenated, in capture order) stands in for the old single-word
  // manualSelection.text as surfaceText -> POST /api/concepts/extract ->
  // eidos JSON -> POST /api/youtube/concept-search -> ranked videos.
  // Context/heading come from the FIRST screenshot's page via the same
  // getPageText() this file already uses for AI extraction (prefers the
  // server-side Markdown conversion, which has real headings) — a plain
  // page-level context rather than an exact before/after splice, since
  // OCR'd text can't be reliably substring-matched back into that page text
  // the way an exact DOM selection could. No document-language signal
  // exists anywhere in this file yet (mctosh_pdf_translate_lang is a
  // *target* translate-to language, not the document's own) — left blank,
  // which the backend already treats as "no preference" throughout.
  const handleSmartVideoSearch = useCallback(async () => {
    if (smartVideoStage === "extracting" || smartVideoStage === "searching") return;
    const readyShots = smartVideoScreenshots.filter((s) => s.text && s.text.trim());
    if (!readyShots.length) {
      setSmartVideoOpen(true);
      setSmartVideoError(
        smartVideoScreenshots.length
          ? "No readable text was found in the captured area(s) — try a clearer, more zoomed-in capture."
          : "Drag a rectangle around a paragraph on the page to capture it first.",
      );
      return;
    }

    let surfaceText = readyShots.map((s) => s.text.trim()).join("\n\n");
    if (surfaceText.length > SMART_VIDEO_MAX_SURFACE_TEXT) surfaceText = surfaceText.slice(0, SMART_VIDEO_MAX_SURFACE_TEXT);
    const capturePageNum = readyShots[0].pageNum || pageNum;

    setSmartVideoOpen(true);
    setSmartVideoError("");
    setSmartVideoEidos(null);
    setSmartVideoVideos([]);
    setSmartVideoActiveVideoId(null);
    setSmartVideoSavedId(null);
    setSmartVideoStage("extracting");

    let contextBefore = "", sectionHeading = "";
    try {
      const pageText = await getPageText(capturePageNum);
      contextBefore = pageText.slice(0, 1200).trim();
      const headingMatches = [...pageText.matchAll(/^#{1,6}\s+(.+)$/gm)];
      sectionHeading = headingMatches[0]?.[1]?.trim() || "";
    } catch {
      // No source markdown / page text available (e.g. scanned PDF with no
      // OCR text at the page level) — extraction still proceeds on the
      // captured screenshots' own OCR'd text alone.
    }

    try {
      const extractRes = await authFetch(apiUrl("/api/concepts/extract"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          surfaceText,
          contextBefore,
          contextAfter: "",
          sectionHeading,
          documentTitle: filename || "",
          pageNumber: capturePageNum,
          difficulty: smartVideoDifficulty,
          provider,
        }),
      });
      const eidos = await extractRes.json();
      if (eidos.error) throw new Error(describeApiError(eidos, "Concept extraction failed."));
      setSmartVideoEidos(eidos);
      setSmartVideoStage("searching");

      const searchRes = await authFetch(apiUrl("/api/youtube/concept-search"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          canonicalConcept: eidos.canonicalConcept,
          eidos: eidos.eidos,
          concepts: eidos.concepts,
          summary: eidos.summary,
          searchQueries: eidos.searchQueries,
          negativeTerms: eidos.negativeTerms,
          language: eidos.language,
          difficulty: eidos.difficulty,
          learningIntent: eidos.learningIntent,
          maxResults: smartVideoPreferences.maxResults,
          hardFilters: smartVideoPreferences.hardFilters,
          rankingPreferences: smartVideoPreferences.rankingPreferences,
          provider,
        }),
      });
      const searchData = await searchRes.json();
      if (searchData.error) throw new Error(describeApiError(searchData, "Video search failed."));
      setSmartVideoVideos(searchData.videos || []);
      if (!searchData.videos?.length && searchData.message) setSmartVideoError(searchData.message);
    } catch (e) {
      setSmartVideoError(e.message || "Something went wrong.");
    } finally {
      setSmartVideoStage("done");
    }
  }, [smartVideoScreenshots, smartVideoStage, smartVideoDifficulty, smartVideoPreferences, pageNum, filename, provider, getPageText]);

  const sanitizeSelectedText = useCallback((text) => (
    String(text || "")
      // Drop decorative leader runs at the start of the whole selection
      // or at the start of a new line, e.g. "........" / "------".
      .replace(/(^|\n)[ \t]*([.\-_=*~]{4,})+(?=\s|[\p{L}\p{N}]|$)/gu, "$1")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  ), []);


  const confirmSelection = useCallback(() => {
    if (!manualSelection) return;
    const noun = manualSelection.text.toLowerCase().replace(/[.,;:]+$/, "").replace(/\s+/g, " ").trim();
    setManualHyle(noun);
    // Get fresh viewport coords for the popup via the span's bounding rect
    const spanEl = spansRef.current[manualSelection.endIdx]?.el;
    const vr = spanEl?.getBoundingClientRect();
    setManualPopup({
      x: vr ? vr.left + vr.width / 2 : window.innerWidth  / 2,
      y: vr ? vr.bottom + 10         : window.innerHeight / 2,
    });
    setManualSelection(null);
  }, [manualSelection]);

  const handleSelectionAction = useCallback(async () => {
    if (!manualSelection || !onSelectionAction || selectionActionBusy) return;
    setSelectionActionBusy(true);
    setSelectionActionError("");
    try {
      await onSelectionAction(manualSelection.text);
      setManualSelection(null);
      window.getSelection()?.removeAllRanges();
    } catch (e) {
      setSelectionActionError(e.message);
    } finally {
      setSelectionActionBusy(false);
    }
  }, [manualSelection, onSelectionAction, selectionActionBusy]);

  const footerSelectionText = manualPopup ? manualHyle : "";
  // hideHyleControls' word selection now surfaces through the thin
  // selection bar under the toolbar (below) instead of this bottom footer —
  // the footer is only for the standalone Hyle-extraction manualPopup flow.
  const showFooterSelection = Boolean(manualPopup);

  // Reset any Translate/Definition/Linguistic Check result when the
  // selected word changes, and forward-sync the Entity Builder's Name
  // field to any new selection. Clearing the Name field back out again
  // is NOT done here — see the canvas-click listener below, which only
  // clears it for that one specific dismissal path.
  useEffect(() => {
    setSelectionToolResult(null);
    setSelectionToolError("");
    setSelectionToolBusy(null);
    setCorrectionResult(null);
    if (manualSelection?.text?.trim()) setEntityBuilderSelectedText(manualSelection.text.trim());
  }, [manualSelection]);

  // Dismiss selection bar when clicking outside
  useEffect(() => {
    if (!manualSelection) return;
    const handler = (e) => {
      if (e.target.closest?.(".sel_selection_handle")) return;
      if (previewRef.current && previewRef.current.contains(e.target)) return;
      if (selBarRef.current && !selBarRef.current.contains(e.target)) {
        setManualSelection(null);
        window.getSelection()?.removeAllRanges();
      }
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler, { passive: true });
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [manualSelection]);

  // Clears the Entity Builder's synced Name field, but only when the
  // selection is deselected by clicking on the page canvas itself —
  // dismissing it any other way (the ✕ button, switching tools, clicking
  // the Entity Builder panel, etc.) leaves the last-synced Name alone.
  useEffect(() => {
    const handler = (e) => {
      if (e.target.closest?.(".sel_selection_handle")) return;
      if (selBarRef.current && selBarRef.current.contains(e.target)) return;
      if (!e.target.closest?.(".pdf_page_container")) return;
      setEntityBuilderSelectedText("");
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler, { passive: true });
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, []);

  // ── Noun controls ──────────────────────────────────────────────────────────
  const reindex = (items, card, mode) =>
    items.map((item, i) => ({ ...item, num: i + 1, id: `${card}_${mode}_${i + 1}` }));

  const handleHyleStatus = useCallback((card, mode, index, newValue) => {
    setHyleData((prev) => {
      const items  = [...prev[card][mode]];
      const next   = currentStatus(items[index]) === newValue ? "pending" : newValue;
      items[index] = { ...items[index], status: { value: next, at: new Date().toISOString() } };
      return { ...prev, [card]: { ...prev[card], [mode]: items } };
    });
  }, []);

  const handleHyleDelete = useCallback((card, mode, index) => {
    setHyleData((prev) => {
      const items = [...prev[card][mode]];
      items.splice(index, 1);
      return { ...prev, [card]: { ...prev[card], [mode]: reindex(items, card, mode) } };
    });
  }, []);

  const handleHyleMove = useCallback((fromCard, fromMode, index, toCard, toMode) => {
    if (fromCard === toCard && fromMode === toMode) return;
    setHyleData((prev) => {
      const src = [...prev[fromCard][fromMode]];
      const [item] = src.splice(index, 1);
      const dst = [...prev[toCard][toMode]];
      const num = dst.length + 1;
      dst.push({ ...item, num, id: `${toCard}_${toMode}_${num}`, status: initStatus() });
      return {
        ...prev,
        [fromCard]: { ...prev[fromCard], [fromMode]: reindex(src, fromCard, fromMode) },
        [toCard]:   { ...prev[toCard],   [toMode]:   dst },
      };
    });
  }, []);

  // ── Panel resize handle ────────────────────────────────────────────────────
  const handleResizeStart = useCallback((e) => {
    e.preventDefault();
    const onMove = (ev) => {
      if (!contentRef.current) return;
      const rect  = contentRef.current.getBoundingClientRect();
      const clientX = ev.touches ? ev.touches[0].clientX : ev.clientX;
      const ratio = Math.max(0.1, Math.min(1, (clientX - rect.left) / rect.width));
      setSplitRatio(ratio);
      if (ratio < 0.9) savedRatioRef.current = ratio;
    };
    const onEnd = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",   onEnd);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend",  onEnd);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onEnd);
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend",  onEnd);
  }, []);

  // Drag handle for the Markdown/Actions left column — width in px, not a ratio
  // (it sits alongside the PDF preview, not splitting against it 1:1).
  const handleMdPanelResizeStart = useCallback((e) => {
    e.preventDefault();
    const handleEl   = e.currentTarget;
    const startX     = e.touches ? e.touches[0].clientX : e.clientX;
    const startWidth = mdPanelWidth;
    handleEl.classList.add("pdf_md_panel_resize_handle--active");
    const onMove = (ev) => {
      const clientX = ev.touches ? ev.touches[0].clientX : ev.clientX;
      const next = Math.max(220, Math.min(720, startWidth + (clientX - startX)));
      setMdPanelWidth(next);
    };
    const onEnd = () => {
      handleEl.classList.remove("pdf_md_panel_resize_handle--active");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",   onEnd);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend",  onEnd);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onEnd);
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend",  onEnd);
  }, [mdPanelWidth]);
  const handleMarkdownAsideResizeStart = useCallback((e) => {
    e.preventDefault();
    const handleEl = e.currentTarget;
    const startX = e.touches ? e.touches[0].clientX : e.clientX;
    const startWidth = mdPanelWidth;
    handleEl.classList.add("pdf_aside_resize_handle--active");
    const onMove = (ev) => {
      const clientX = ev.touches ? ev.touches[0].clientX : ev.clientX;
      const next = Math.max(220, Math.min(720, startWidth - (clientX - startX)));
      setMdPanelWidth(next);
    };
    const onEnd = () => {
      handleEl.classList.remove("pdf_aside_resize_handle--active");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onEnd);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onEnd);
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
  }, [mdPanelWidth]);
  const createAsideResizeStart = useCallback((startWidth, setWidth, min = 240, max = 720) => (e) => {
    e.preventDefault();
    const handleEl = e.currentTarget;
    const startX = e.touches ? e.touches[0].clientX : e.clientX;
    handleEl.classList.add("pdf_aside_resize_handle--active");
    const onMove = (ev) => {
      const clientX = ev.touches ? ev.touches[0].clientX : ev.clientX;
      const next = Math.max(min, Math.min(max, startWidth + (clientX - startX)));
      setWidth(next);
    };
    const onEnd = () => {
      handleEl.classList.remove("pdf_aside_resize_handle--active");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onEnd);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onEnd);
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
  }, []);
  const handleAnnotHistoryPanelResizeStart = useCallback(
    createAsideResizeStart(annotHistoryPanelWidth, setAnnotHistoryPanelWidth, 240, 640),
    [annotHistoryPanelWidth, createAsideResizeStart]
  );
  const handleSmartVideoPanelResizeStart = useCallback(
    createAsideResizeStart(smartVideoPanelWidth, setSmartVideoPanelWidth, 280, 760),
    [smartVideoPanelWidth, createAsideResizeStart]
  );
  const handleEntityBuilderPanelResizeStart = useCallback(
    createAsideResizeStart(entityBuilderPanelWidth, setEntityBuilderPanelWidth, 280, 760),
    [entityBuilderPanelWidth, createAsideResizeStart]
  );
  const togglePreview = useCallback(() => {
    setSplitRatio((r) => {
      if (r === 0) return savedRatioRef.current || 0.42;
      savedRatioRef.current = r;
      return 0;
    });
  }, []);

  // ── Drag & drop ────────────────────────────────────────────────────────────
  const handleDrop        = useCallback((e) => { e.preventDefault(); setDragOver(false); loadFile(e.dataTransfer.files[0]); }, [loadFile]);
  const handleDragOver    = (e) => { e.preventDefault(); setDragOver(true); };
  const handleDragLeave   = () => setDragOver(false);
  const handleInputChange = (e) => loadFile(e.target.files[0]);

  const renderTypeNode = (node, depth = 0) => {
    const isLeaf = !node.children || node.children.length === 0;
    return (
      <div key={node.key} className={`hyle_type_node hyle_type_depth_${depth}`}>
        {isLeaf ? (
          <button
            className={`hyle_type_leaf${extractionType === node.key ? " hyle_type_leaf--active" : ""}`}
            onClick={() => setExtractionType(extractionType === node.key ? null : node.key)}
          >
            {node.label}
            {node.note && <span className="hyle_type_note">{node.note}</span>}
          </button>
        ) : (
          <>
            <span className="hyle_type_group">{node.label}</span>
            <div className="hyle_type_children">
              {node.children.map((child) => renderTypeNode(child, depth + 1))}
            </div>
          </>
        )}
      </div>
    );
  };

  // Shared by the Tools dropdown (left group) and the undo/redo/clear group
  // (right group) in the toolbar below — computed once here instead of
  // inside either group so the two can live in separate containers.
  const activeToolMeta = ANNOT_TOOLS.find((t) => t.key === annotTool) || null;
  const shapeToolbarOpen = annotTool === "shapes";
  const hasSize = isPenToolKey(annotTool) || annotTool === "highlight" || annotTool === "eraser" || SHAPE_TOOL_KEYS.includes(annotTool);
  const sizeProps =
    isPenToolKey(annotTool)  ? { min: 1, max: 36, step: 0.5, value: penSize,    onChange: setPenSize } :
    annotTool === "eraser"  ? { min: 6, max: 72, step: 2,   value: eraserSize, onChange: setEraserSize } :
    annotTool === "highlight" ? { min: 4, max: 96, step: 2, value: annotSize,  onChange: setAnnotSize } :
    SHAPE_TOOL_KEYS.includes(annotTool) ? {
      min: 1,
      max: 20,
      step: 0.5,
      value: shapeStrokeWidth,
      onChange: (strokeWidth) => updateActiveShapeSetting({ strokeWidth }),
    } :
    null;
  // Per-tool title labels for the shared controls below (Ink/color trigger,
  // the generic hasSize knob) — same "every control gets a title above it"
  // organization the Pen panel already uses (LabeledPercentKnob), applied
  // to the controls Pen itself doesn't own.
  const inkColorLabel =
    annotTool === "text"     ? "Text color" :
    annotTool === "highlight" ? "Highlight color" :
    SHAPE_TOOL_KEYS.includes(annotTool) ? "Stroke color" :
    `${activeToolMeta?.label || "Tool"} color`;
  const sizeKnobLabel =
    isPenToolKey(annotTool)  ? "Stroke width" :
    annotTool === "eraser"   ? "Eraser size" :
    annotTool === "highlight" ? "Highlighter size" :
    SHAPE_TOOL_KEYS.includes(annotTool) ? "Stroke width" :
    "Size";
  const markdownVisualPageScale = Math.max(0.0001, fitScaleRef.current * zoom);
  const liveRenderedPageSize = renderedCssSizeRef.current[pageNum - 1];
  const liveRenderedPageScale = renderedScaleRef.current[pageNum - 1];
  const liveRenderedPageRatio = liveRenderedPageScale
    ? markdownVisualPageScale / Math.max(0.0001, liveRenderedPageScale)
    : null;
  const markdownVisualPageWidth = liveRenderedPageSize?.width && liveRenderedPageRatio
    ? Math.max(1, liveRenderedPageSize.width * liveRenderedPageRatio)
    : pageViewport?.scale
      ? Math.max(1, pageViewport.width * (markdownVisualPageScale / Math.max(0.0001, pageViewport.scale)))
      : Math.max(1, entityBuilderVisualRawPageWidth * markdownVisualPageScale);
  const markdownVisualPageHeight = liveRenderedPageSize?.height && liveRenderedPageRatio
    ? Math.max(1, liveRenderedPageSize.height * liveRenderedPageRatio)
    : pageViewport?.scale
      ? Math.max(1, pageViewport.height * (markdownVisualPageScale / Math.max(0.0001, pageViewport.scale)))
      : Math.max(1, entityBuilderVisualRawPageHeight * markdownVisualPageScale);
  const renderOriginalMarkdownVisualPage = () => (
    <div
      ref={markdownVisualLayerRef}
      className="pdf_markdown_aside_visual_page"
      onPointerDownCapture={() => activateAnnotationSurface("md")}
      onTouchStartCapture={() => activateAnnotationSurface("md")}
      style={{
        aspectRatio: `${entityBuilderVisualRawPageWidth} / ${entityBuilderVisualRawPageHeight}`,
        width: `${markdownVisualPageWidth}px`,
        height: `${markdownVisualPageHeight}px`,
        minWidth: `${markdownVisualPageWidth}px`,
        minHeight: `${markdownVisualPageHeight}px`,
        maxWidth: "none",
      }}
    >
      <canvas ref={markdownAnnotationCanvasRef} className="pdf_markdown_visual_annotation_layer" aria-hidden="true" />
      <svg
        className="pdf_markdown_visual_line_rules"
        viewBox={`0 0 ${entityBuilderVisualRawPageWidth} ${entityBuilderVisualRawPageHeight}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {entityBuilderVisualRawLines.map((line, lineIndex) => {
          const paragraphIndex = entityBuilderVisualRawLines
            .slice(0, lineIndex)
            .reduce((count, previousLine, previousIndex) => {
              const nextLine = entityBuilderVisualRawLines[previousIndex + 1];
              if (!nextLine) return count;
              const verticalGap = (Number(nextLine.y) || 0) - ((Number(previousLine.y) || 0) + (Number(previousLine.height) || 1));
              return verticalGap > Math.max(4, (Number(previousLine.height) || 1) * 0.8) ? count + 1 : count;
            }, 0);
          const lineOffset = mdSpacingTarget === "line"
            ? lineIndex * mdLineSpacing
            : mdSpacingTarget === "paragraph"
              ? paragraphIndex * mdLineSpacing
              : 0;
          const ruleY = line.y + lineOffset + line.height;
          return <line key={`${line.id}-rule`} x1="0" x2={entityBuilderVisualRawPageWidth} y1={ruleY} y2={ruleY} />;
        })}
      </svg>
      {entityBuilderVisualRawLines.map((line, lineIndex) => {
        const lineOrder = mdLineOrders[line.id] || "source";
        const lineRows = lineOrder === "source" ? line.sourceRows : line.visualRows;
        const paragraphIndex = entityBuilderVisualRawLines
          .slice(0, lineIndex)
          .reduce((count, previousLine, previousIndex) => {
            const nextLine = entityBuilderVisualRawLines[previousIndex + 1];
            if (!nextLine) return count;
            const verticalGap = (Number(nextLine.y) || 0) - ((Number(previousLine.y) || 0) + (Number(previousLine.height) || 1));
            return verticalGap > Math.max(4, (Number(previousLine.height) || 1) * 0.8) ? count + 1 : count;
          }, 0);
        const lineOffset = mdSpacingTarget === "line"
          ? lineIndex * mdLineSpacing
          : mdSpacingTarget === "paragraph"
            ? paragraphIndex * mdLineSpacing
            : 0;
        const lineTagFontSize = Math.max(1, Number(lineRows[0]?.visualFontSize) || 1);
        return <React.Fragment key={line.id}>
          {mdLineTagsVisible && <div
            className={`pdf_markdown_visual_line_marker${mdOpenLineId === line.id ? " pdf_markdown_visual_line_marker--open" : ""}`}
            style={{
              left: `${(line.xMin / entityBuilderVisualRawPageWidth) * 100}%`,
              top: `${((line.y + lineOffset) / entityBuilderVisualRawPageHeight) * 100}%`,
              fontSize: `${lineTagFontSize * entityBuilderVisualRawTextScale / entityBuilderVisualRawPageWidth * 100}cqw`,
            }}
          >
            <button
              type="button"
              className="pdf_markdown_visual_line_tag"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setMdOpenLineId((current) => current === line.id ? null : line.id);
              }}
              aria-label={`Line ${lineIndex + 1}, ${lineRows.length} strings${line.hasOrderDiscrepancy ? ", visual order differs from source order" : ""}`}
              aria-expanded={mdOpenLineId === line.id}
              title={line.hasOrderDiscrepancy ? "Visual order differs from PDF.js source order" : undefined}
            >{`L${lineIndex + 1}${line.hasOrderDiscrepancy ? "*" : ""}`}</button>
            {mdOpenLineId === line.id && (
              <div className="pdf_markdown_visual_line_contents" role="list" aria-label={`Strings in line ${lineIndex + 1}`}>
                <div className="pdf_markdown_visual_line_order" role="group" aria-label={`Order for line ${lineIndex + 1}`}>
                  <strong>ORDER</strong>
                  <div>
                    {[["visual", "VISUAL"], ["source", "SOURCE"]].map(([order, label]) => (
                      <button
                        key={order}
                        type="button"
                        className={lineOrder === order ? "pdf_markdown_visual_line_order_btn--active" : undefined}
                        aria-pressed={lineOrder === order}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setMdLineOrders((current) => ({ ...current, [line.id]: order }));
                        }}
                      >{label}</button>
                    ))}
                  </div>
                </div>
                {lineRows.map((row) => (
                  <div key={row.id} role="listitem">
                    <strong>{Number.isFinite(row.instanceNumber) ? `str #${row.instanceNumber}` : "str"}</strong>
                    <span className="pdf_markdown_visual_line_ty">TY {Number.isFinite(Number(row.ty)) ? Number(row.ty).toFixed(2) : "-"}</span>
                    <span>{row.value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>}
          <span className="pdf_markdown_aside_visual_line" title={lineRows.map((row) => row.value).join(" ")} style={{
            left: `${(line.xMin / entityBuilderVisualRawPageWidth) * 100}%`,
            top: `${((line.y + lineOffset) / entityBuilderVisualRawPageHeight) * 100}%`,
            width: `${Math.max(1, (line.xMax ?? line.xMin + 1) - line.xMin) / entityBuilderVisualRawPageWidth * 100}%`,
            height: `${line.height / entityBuilderVisualRawPageHeight * 100}%`,
          }}>
            {lineRows.map((row, rowIndex) => {
              const rowX = Number(row.visualX) || 0;
              const rowFontSize = Math.max(1, row.visualFontSize || 1);
              const rowOffset = mdSpacingTarget === "str" ? rowIndex * mdLineSpacing : 0;
              const geometryOffsetY = (Number(row.visualY) || 0) - (Number(line.y) || 0);
              const totalOffsetY = geometryOffsetY + rowOffset;
              return <React.Fragment key={row.id}>
                <span data-raw-row-id={row.id} title={row.value} className={`pdf_markdown_aside_visual_line_item${entityBuilderVisualFocusId === row.id ? " pdf_markdown_aside_visual_line_item--focused" : ""}`} style={{
                  left: `${(rowX - line.xMin) / entityBuilderVisualRawPageWidth * 100}cqw`,
                  top: 0,
                  fontSize: `${rowFontSize * entityBuilderVisualRawTextScale / entityBuilderVisualRawPageWidth * 100}cqw`,
                  fontFamily: IBM_PLEX_MONO_FONT,
                  height: `${Math.max(1, row.visualHeight || 1) / entityBuilderVisualRawPageWidth * 100}cqw`,
                  lineHeight: `${Math.max(1, row.visualHeight || 1) / entityBuilderVisualRawPageWidth * 100}cqw`,
                  fontWeight: row.visualFontWeight || "normal",
                  fontStyle: row.visualFontStyle || "normal",
                  transform: `${totalOffsetY ? `translateY(${totalOffsetY / Math.max(1, entityBuilderVisualRawPageWidth) * 100}cqw) ` : ""}rotate(${Number.isFinite(row.rotation) ? -row.rotation : 0}deg)`,
                  transformOrigin: "top left",
                }}>{row.value}</span>
              </React.Fragment>;
            })}
          </span>
        </React.Fragment>;
      })}
    </div>
  );

  return (
    <div
      id="pdf_page"
      className={[
        embedded ? "pdf_page--embedded" : "",
        showFooterSelection ? "pdf_page--footer-open" : "",
        effectiveToolbarEdge === "left" || effectiveToolbarEdge === "right" ? "pdf_page--toolbar-side" : "",
      ].filter(Boolean).join(" ") || undefined}
    >
      {(() => {
        const toolbarNode = (
          <div
            id="pdf_toolbar"
            ref={toolbarRef}
            className={`pdf_toolbar--${effectiveToolbarEdge}${toolbarHost ? " pdf_toolbar--hoisted" : ""}`}
          >
        {/* Wraps the toolbar's own content (page-nav/search/undo-redo row +
            tool-icons row) — a flex sibling of the dock-direction pad below,
            not a parent of it, so the pad always stays a fixed-size item
            pinned to the toolbar's own trailing edge (right for a
            horizontal top/bottom dock, bottom for a vertical left/right
            one) regardless of how much the content side scrolls/wraps. */}
        <div className="pdf_toolbar_scroll">
        <div id="pdf_toolbar_mainbar">
        <div id="pdf_toolbar_left">
          {pdfDoc && !selectionOnly && (
            <>
            {/* Wraps both groups in one flex ROW so .annot_mode_strip's
                margin-left: auto actually has a row to push against — the
                two groups are LEFT vs RIGHT areas of the same row, not a
                top/bottom stack (#pdf_toolbar_left itself is a plain block
                container in the default top/bottom dock, only becoming
                flex-row for the left/right dock — see the dock-aware rules
                in pdfPage.css — so without this wrapper the two groups
                would just stack as ordinary block siblings instead). */}
            <div className="annot_tool_row">
            <div className="annot_tool_strip" aria-label="Drawing tools">
              {DRAWING_TOOL_ORDER.map((key) => renderAnnotToolButton(key))}
            </div>

            {/* Non-drawing "mode" tools — Smart Video is a real annotTool
                (selected/drawn the same way as the drawing tools above,
                see MODE_TOOL_ORDER) but isn't itself a drawing tool;
                Entity Builder / Clinical Vignette / Narrative Mode are
                each their own boolean-toggle panel, not annotTools at
                all. Grouped together and pushed to the opposite end of
                this row (see .annot_mode_strip in pdfPage.css) so the
                toolbar reads as two areas: draw-on-the-page tools on the
                left, open-a-panel tools on the right. */}
            <div className="annot_mode_strip" aria-label="Panel tools">
              {markdownVisualActive && (
                <button
                  type="button"
                  ref={(el) => { toolButtonRefs.current.mdController = el; }}
                  className={`annot_trigger annot_tool_btn${annotTool === "mdController" ? " annot_tool_btn--active" : ""}`}
                  onClick={() => toggleAnnotTool("mdController")}
                  title="MD Controller"
                  aria-label="MD Controller"
                >
                  <i className="bx bx-slider" aria-hidden="true" />
                </button>
              )}
              <button
                type="button"
                className={`annot_trigger annot_tool_btn${entityBuilderOpen ? " annot_trigger--active" : ""}`}
                onClick={toggleEntityBuilder}
                title="AMCTOSHS Illumination"
                aria-label="AMCTOSHS Illumination"
              >
                {isCurrentPageFullySegmented ? <SegmentBuilderOpenEyeIcon /> : <SegmentBuilderClosedEyeIcon />}
              </button>
              <div id="pdf_search_group">
                <button
                  type="button"
                  id="pdf_search_toggle_btn"
                  className={searchOpen ? "pdf_search_toggle_btn--active" : undefined}
                  onClick={() => setSearchOpen((v) => !v)}
                  title="Search text"
                >
                  <i className="bx bx-search" />
                </button>
                {searchOpen && (
                  <div id="pdf_search_bar">
                    <div id="pdf_search_bar_row">
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            goToSearchMatch(e.shiftKey ? -1 : 1);
                          } else if (e.key === "Escape") {
                            setSearchOpen(false);
                          }
                        }}
                        placeholder="Search in document..."
                        autoFocus
                      />
                      <span id="pdf_search_count">
                        {searchScanning
                          ? "..."
                          : searchMatches.length
                            ? `${searchActiveIndex + 1} / ${searchMatches.length}`
                            : searchQuery.trim()
                              ? "0 / 0"
                              : ""}
                      </span>
                      <button type="button" onClick={() => goToSearchMatch(-1)} disabled={!searchMatches.length} title="Previous match"><i className="bx bx-chevron-up" /></button>
                      <button type="button" onClick={() => goToSearchMatch(1)} disabled={!searchMatches.length} title="Next match"><i className="bx bx-chevron-down" /></button>
                      <button type="button" onClick={() => { setSearchOpen(false); setSearchQuery(""); }} title="Close search"><i className="bx bx-x" /></button>
                    </div>
                    {searchActiveMatch?.matchType && searchActiveMatch.matchType !== "exact" && (
                      <div id="pdf_search_confidence">
                        <i className="bx bx-info-circle" /> Likely match: "{searchActiveMatch.originalMatchedText}"
                        <span id="pdf_search_confidence_pct">{Math.round((searchActiveMatch.confidence || 0) * 100)}%</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
              {MODE_TOOL_ORDER.map((key) => renderAnnotToolButton(key))}
            </div>
            </div>

            {/* Color/size/tool-settings for whichever tool is currently
                active — a detached dropdown popover (see .annot_tool_options
                in pdfPage.css), sized to its own content rather than
                stretching/shrinking the toolbar itself: a column list
                dropping down/up off a horizontal (top/bottom) dock, a row
                list flying out sideways off a vertical (left/right) one.
                Opens from the active tool's own button position (see
                toolOptionsOffset above), not the toolbar's fixed corner. */}
            <div
              className="annot_tool_options"
              style={
                (effectiveToolbarEdge === "left" || effectiveToolbarEdge === "right")
                  ? { top: toolOptionsOffset }
                  : { left: toolOptionsOffset }
              }
            >
              {annotTool === "mdController" && markdownVisualActive && (
                <div className="annot_control annot_md_controller" aria-label="Markdown line spacing controller">
                  <AnnotControlHeaderInfo title="MD Controller" />
                  <div className="annot_md_controller_row">
                    <button
                      type="button"
                      className={`annot_mode_btn annot_mode_btn--toggle${mdLineTagsVisible ? " annot_mode_btn--active" : ""}`}
                      onClick={() => {
                        setMdLineTagsVisible((visible) => !visible);
                        setMdOpenLineId(null);
                      }}
                      aria-pressed={mdLineTagsVisible}
                    >
                      <span>Show line tags: {mdLineTagsVisible ? "ON" : "OFF"}</span>
                    </button>
                    <select
                      className="annot_md_controller_select"
                      value={mdSpacingTarget}
                      onChange={(event) => setMdSpacingTarget(event.target.value)}
                      aria-label="Add space between"
                    >
                      <option value="str">str</option>
                      <option value="line">line</option>
                      <option value="paragraph">paragraph</option>
                    </select>
                    <button
                      type="button"
                      className="annot_mode_btn"
                      onClick={() => setMdLineSpacing((value) => Math.max(-40, value - 1))}
                      title="Decrease space between Markdown lines"
                      aria-label="Decrease space between Markdown lines"
                    >−</button>
                    <output className="annot_md_controller_value" aria-live="polite">
                      {mdLineSpacing > 0 ? `+${mdLineSpacing}` : mdLineSpacing}
                    </output>
                    <button
                      type="button"
                      className="annot_mode_btn"
                      onClick={() => setMdLineSpacing((value) => Math.min(80, value + 1))}
                      title="Increase space between Markdown lines"
                      aria-label="Increase space between Markdown lines"
                    >+</button>
                  </div>
                </div>
              )}
              {annotTool === "bbox" && (
                <div className="annot_bbox_creation_block annot_control">
                  <AnnotControlHeaderInfo title="Create" />
                  <div className="annot_bbox_creation_row">
                    <button
                      type="button"
                      className={`annot_mode_btn annot_mode_btn--toggle${activeBBoxCreationType === "pageBBox" ? " annot_mode_btn--active" : ""}`}
                      onClick={() => toggleBBoxCreationType("pageBBox")}
                      title={activeBBoxCreationType === "pageBBox" ? "Page BBox creation armed" : "Create a Page BBox containing this page's lines"}
                      aria-label="New page bbox"
                    >
                      <i className="bx bx-file" aria-hidden="true" />
                      <span>Page BBox</span>
                    </button>
                    <button
                      type="button"
                      className={`annot_mode_btn annot_mode_btn--toggle${activeBBoxCreationType === "bbox" ? " annot_mode_btn--active" : ""}`}
                      onClick={() => toggleBBoxCreationType("bbox")}
                      title={activeBBoxCreationType === "bbox" ? "Block BBox creation armed" : "Create a semantic Block BBox"}
                      aria-label="New Block BBox"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M7 3h2v2h6v2H9v10H7V7H5V5h2zm10 4h2v14H7v-2h10z" />
                      </svg>
                      <span>Block BBox</span>
                    </button>
                    <button
                      type="button"
                      className={`annot_mode_btn annot_mode_btn--toggle${activeBBoxCreationType === "subLineBBox" ? " annot_mode_btn--active" : ""}`}
                      onClick={() => toggleBBoxCreationType("subLineBBox")}
                      title={activeBBoxCreationType === "subLineBBox" ? "SubLine BBox creation armed" : "Nest selected lines under their preceding paragraph line"}
                      aria-label="New SubLine BBox"
                    >
                      <i className="bx bx-subdirectory-right" aria-hidden="true" />
                      <span>SubLine BBox</span>
                    </button>
                    <button
                      type="button"
                      className={`annot_mode_btn annot_mode_btn--toggle${activeBBoxCreationType === "imageBBox" ? " annot_mode_btn--active" : ""}`}
                      onClick={() => toggleBBoxCreationType("imageBBox")}
                      title={activeBBoxCreationType === "imageBBox" ? "Figure BBox armed" : "Arm figure bbox selection"}
                      aria-label="Figure BBox"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M4 5h16v14H4zm2 2v10h12V7z" />
                        <path d="M7 15l3-4 2 2 3-4 2 6z" />
                      </svg>
                      <span>Figure BBox</span>
                    </button>
                    <button
                      type="button"
                      className={`annot_mode_btn annot_mode_btn--toggle${activeBBoxCreationType === "omissionBBox" ? " annot_mode_btn--active" : ""}`}
                      onClick={() => toggleBBoxCreationType("omissionBBox")}
                      title={activeBBoxCreationType === "omissionBBox" ? "Omission BBox creation armed" : "Omit fully enclosed PDF.js text from reading"}
                      aria-label="New Omission BBox"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M3 3l18 18M10.6 10.7a2 2 0 0 0 2.7 2.7M9.9 4.2A10.8 10.8 0 0 1 12 4c6 0 9 6 9 8a12.6 12.6 0 0 1-2.1 3.7M6.6 6.6C4.2 8.2 3 10.7 3 12c0 2 3 8 9 8 1.3 0 2.5-.3 3.5-.7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <span>Omission BBox</span>
                    </button>
                    <button
                      type="button"
                      className={`annot_mode_btn annot_mode_btn--toggle${activeBBoxCreationType === "columnBBox" ? " annot_mode_btn--active" : ""}`}
                      onClick={() => toggleBBoxCreationType("columnBBox")}
                      title={activeBBoxCreationType === "columnBBox" ? "Partition BBox creation armed" : "Create a Partition BBox inside another BBox"}
                      aria-label="Create Partition BBox"
                    >
                      <i className="bx bx-columns" aria-hidden="true" />
                      <span>Partition BBox</span>
                    </button>
                    {/* One-shot bulk action, not an armed mode — no
                        --toggle/--active, unlike the five buttons above.
                        Auto-creates one bbox per paragraph on the current
                        page, matching this page's own cached Markdown
                        against the PDF's real text geometry (no AI call —
                        see runSmartSegmenting/pdfSmartSegment.js). */}
                    <button
                      type="button"
                      className="annot_mode_btn"
                      onClick={runSmartSegmenting}
                      disabled={smartSegmentingBusy || !pdfDoc}
                      title="Auto-create one bbox per paragraph on this page, using the page's saved text"
                      aria-label="Smart Segmenting"
                    >
                      {smartSegmentingBusy ? (
                        <i className="bx bx-loader-alt bx-spin" />
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M7.5 5.6 5 7l1.4-2.5L5 2l2.5 1.4L10 2 8.6 4.5 10 7z" />
                          <path d="M22 2l-1.4 2.5L22 7l-2.5-1.4L17 7l1.4-2.5L17 2l2.5 1.4z" />
                          <path d="m3.7 20.3 15-15 1.4 1.4-15 15z" />
                        </svg>
                      )}
                      <span>Smart Segmenting</span>
                    </button>
                  </div>
                  {smartSegmentingError && (
                    <p className="annot_bbox_creation_error">{smartSegmentingError}</p>
                  )}
                </div>
              )}
            {shapeToolbarOpen && (
              <div className="annot_shape_subtoolbar" aria-label="Shape tools">
                {SHAPE_TOOL_KEYS.map((shapeKey) => {
                  const shapeTool = ANNOT_TOOLS.find((item) => item.key === shapeKey);
                  return (
                    <button
                      key={shapeKey}
                      type="button"
                      className={`annot_trigger annot_tool_btn${annotTool === shapeKey ? " annot_trigger--active" : ""}`}
                      onClick={() => {
                        setAnnotTool(shapeKey);
                        setColorMenuOpen(false);
                      }}
                      title={shapeTool.label}
                      aria-label={shapeTool.label}
                    >
                      {shapeKey === "arrow" ? <ArrowToolIcon /> : shapeKey === "freeshape" ? <FreeshapeToolIcon /> : <i className={shapeTool.icon} />}
                    </button>
                  );
                })}
              </div>
            )}

            {toolActive && annotTool !== "eraser" && annotTool !== "smartVideo" && annotTool !== "bbox" && (
              <div className="annot_control">
                <AnnotControlHeaderInfo title={inkColorLabel} />
                <div className="annot_dd_wrap" ref={colorMenuRef}>
                  <div className="annot_color_preset_row" role="group" aria-label={inkColorLabel}>
                    {Array.from({ length: COLOR_PRESET_SLOT_COUNT }, (_, presetIndex) => {
                      const presetColor = activeToolColorPresets[presetIndex] || null;
                      const presetActive = presetColor && presetIndex === activeToolColorPresetIndex;
                      return (
                        <button
                          key={presetIndex}
                          type="button"
                          className={`annot_color_preset_btn${presetActive ? " annot_color_preset_btn--active" : ""}${presetColor ? "" : " annot_color_preset_btn--empty"}`}
                          onPointerDown={(event) => startColorPresetLongPress(presetIndex, event)}
                          onPointerUp={(event) => { clearColorPresetLongPress(event.pointerId, { keepSuppressClick: true }); }}
                          onPointerCancel={(event) => { clearColorPresetLongPress(event.pointerId); }}
                          onPointerLeave={(event) => { clearColorPresetLongPress(event.pointerId); }}
                          onClick={(event) => {
                            if (clearColorPresetLongPress(null)) return;
                            const rect = event.currentTarget.getBoundingClientRect();
                            if (!presetColor) {
                              openColorMenuFromRect(rect, { type: "preset", presetIndex });
                              return;
                            }
                            setAnnotColor(presetColor);
                          }}
                          title={presetColor ? `Preset ${presetIndex + 1}: ${presetColor}` : `Set preset ${presetIndex + 1}`}
                          aria-label={presetColor ? `Color preset ${presetIndex + 1}` : `Empty color preset ${presetIndex + 1}`}
                        >
                          <span
                            className="annot_color_preset_dot"
                            style={presetColor ? { background: presetColor } : undefined}
                          />
                        </button>
                      );
                    })}
                  </div>
                {colorMenuOpen && colorMenuPos && createPortal(
                  <div ref={colorMenuPopoverRef} className="annot_dd annot_dd--colors" style={colorMenuPos}>
                    <div className="annot_color_preview">
                      <div
                        className="annot_color_preview_chip"
                        style={{
                          background:
                            colorMenuTarget.type === "background"
                              ? textBackgroundColor
                              : colorMenuTarget.type === "preset"
                                ? (activeToolColorPresets[colorMenuTarget.presetIndex] || annotColor)
                                : annotColor,
                        }}
                      />
                      <div className="annot_color_preview_text">
                        <span className="annot_color_preview_label">
                          {colorMenuTarget.type === "background"
                            ? "Current background"
                            : colorMenuTarget.type === "preset"
                              ? `Preset ${Number(colorMenuTarget.presetIndex) + 1}`
                              : "Current ink"}
                        </span>
                        <span className="annot_color_preview_hex">
                          {(
                            colorMenuTarget.type === "background"
                              ? textBackgroundColor
                              : colorMenuTarget.type === "preset"
                                ? (activeToolColorPresets[colorMenuTarget.presetIndex] || annotColor)
                                : annotColor
                          ).toUpperCase()}
                        </span>
                      </div>
                    </div>
                    {colorMenuTarget.type === "background" && (
                      <button
                        type="button"
                        className="annot_dd_none_btn"
                        onClick={() => {
                          setTextBackground(false);
                          updateStyledTextTarget({ textBackground: false });
                          setColorMenuOpen(false);
                        }}
                      >
                        <span className="annot_swatch_btn annot_swatch_btn--none" aria-hidden="true" />
                        No background
                      </button>
                    )}
                    {ANNOT_COLOR_GROUPS.map(({ label, colors }) => (
                      <div key={label} className="annot_color_group">
                        <div className="annot_color_group_label">{label}</div>
                        <div className="annot_color_group_grid">
                          {colors.map((c) => {
                            const active = (
                              colorMenuTarget.type === "background"
                                ? textBackgroundColor
                                : colorMenuTarget.type === "preset"
                                  ? (activeToolColorPresets[colorMenuTarget.presetIndex] || annotColor)
                                  : annotColor
                            ) === c;
                            return (
                              <button
                                key={c}
                                type="button"
                                className={`annot_swatch_btn${active ? " annot_swatch_btn--active" : ""}`}
                                style={{ background: c }}
                                title={c}
                                onClick={() => {
                                  if (colorMenuTarget.type === "background") {
                                    setTextBackgroundColor(c);
                                    setTextBackground(true);
                                    updateStyledTextTarget({ textBackgroundColor: c, textBackground: true });
                                  } else if (colorMenuTarget.type === "preset") {
                                    setAnnotToolColorPreset(colorMenuTarget.presetIndex, c);
                                  } else {
                                    setAnnotColor(c);
                                  }
                                  setColorMenuOpen(false);
                                }}
                              >
                                {active && <span className="annot_swatch_btn_inner" />}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>,
                  document.body,
                )}
                </div>
              </div>
            )}

            {annotTool === "highlight" && (
              <div className="annot_control">
                <AnnotControlHeaderInfo title="Opacity" info="Transparency of the highlight layer" />
                <OpacityKnob value={annotOpacity} onChange={setAnnotOpacity} color={annotColor} />
              </div>
            )}

            {hasSize && (
              <div className="annot_control">
                <AnnotControlHeaderInfo title={sizeKnobLabel} />
                <SizeKnob
                  min={sizeProps.min} max={sizeProps.max} step={sizeProps.step}
                  value={sizeProps.value}
                  onChange={sizeProps.onChange}
                  color={annotColor}
                  dashed={annotTool === "eraser"}
                  variant={annotTool === "highlight" ? "highlight" : "dot"}
                />
              </div>
            )}

            {SHAPE_TOOL_KEYS.includes(annotTool) && (
              <div className="annot_control">
                <AnnotControlHeaderInfo title="Stroke style" />
                <div className="annot_mode_toggle" aria-label="Border style">
                  {SHAPE_BORDER_STYLES.map(({ key, label }) => (
                    <button
                      key={key}
                      type="button"
                      className={`annot_mode_btn${shapeBorderStyle === key ? " annot_mode_btn--active" : ""}`}
                      onClick={() => setShapeBorderStyle(key)}
                      title={`${label} border`}
                      aria-label={`${label} border`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {annotTool === "rect" && (
              <div className="annot_control">
                <AnnotControlHeaderInfo title="Corners" />
                <SizeKnob
                  min={0} max={60} step={1}
                  value={shapeBorderRadius}
                  onChange={setShapeBorderRadius}
                  color={annotColor}
                  variant="dot"
                />
              </div>
            )}

            {["rect", "circle", "freeshape"].includes(annotTool) && (
              <div className="annot_control">
                <AnnotControlHeaderInfo title="Interior" />
                <div className="annot_mode_toggle">
                  <button
                    type="button"
                    className={`annot_mode_btn annot_mode_btn--toggle${shapeBackground ? " annot_mode_btn--active" : ""}`}
                    onClick={() => setShapeBackground((value) => !value)}
                    title="Fill always uses this shape's own border color — there is no separate fill color"
                    aria-label="Fill shape"
                  >
                    Fill
                  </button>
                </div>
              </div>
            )}

            {annotTool === "eraser" && (
              <div className="annot_control">
                <AnnotControlHeaderInfo title="Mode" />
                <div className="annot_mode_toggle annot_mode_toggle--pen" aria-label="Eraser mode">
                {ERASER_MODES.map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    className={`annot_mode_btn${eraserMode === key ? " annot_mode_btn--active" : ""}`}
                    onClick={() => setEraserMode(key)}
                    title={`${label} eraser`}
                    aria-label={`${label} eraser`}
                  >
                    {label}
                  </button>
                ))}
                </div>
              </div>
            )}


            {annotTool === "text" && (
              <div className="annot_text_panel">
                <div className="annot_control">
                <AnnotControlHeaderInfo title="Alignment" />
                <div className="annot_mode_toggle annot_mode_toggle--pen">
                  <button
                    type="button"
                    className={`annot_mode_btn${textAlign === "left" ? " annot_mode_btn--active" : ""}`}
                    onClick={() => { setTextAlign("left"); updateStyledTextTarget({ textAlign: "left" }); }}
                    title="Align left"
                    aria-label="Align left"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="2 2 20 20" className="pdf_toolbar_svg_icon">
                      <path d="M3 7h12v2H3zm0-4h18v2H3zm0 8h18v2H3zm0 4h12v2H3zm0 4h18v2H3z" />
                    </svg>
                  </button>
                    <button
                      type="button"
                      className={`annot_mode_btn${textAlign === "center" ? " annot_mode_btn--active" : ""}`}
                      onClick={() => { setTextAlign("center"); updateStyledTextTarget({ textAlign: "center" }); }}
                      title="Align center"
                      aria-label="Align center"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="2 2 20 20" className="pdf_toolbar_svg_icon">
                        <path d="M6 7h12v2H6zM3 3h18v2H3zm0 8h18v2H3zm3 4h12v2H6zm-3 4h18v2H3z" />
                      </svg>
                    </button>
                  <button
                    type="button"
                    className={`annot_mode_btn${textAlign === "right" ? " annot_mode_btn--active" : ""}`}
                    onClick={() => { setTextAlign("right"); updateStyledTextTarget({ textAlign: "right" }); }}
                    title="Align right"
                    aria-label="Align right"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="2 2 20 20" className="pdf_toolbar_svg_icon">
                      <path d="M9 7h12v2H9zM3 3h18v2H3zm0 8h18v2H3zm6 4h12v2H9zm-6 4h18v2H3z" />
                    </svg>
                  </button>
                </div>
                </div>

                <div className="annot_control">
                <AnnotControlHeaderInfo title="Style" />
                <div className="annot_mode_toggle annot_mode_toggle--pen">
                    <button
                      type="button"
                      className={`annot_mode_btn${textBold ? " annot_mode_btn--active" : ""}`}
                      onClick={() => {
                        setTextBold((value) => {
                          const next = !value;
                          updateStyledTextTarget({ fontBold: next });
                          return next;
                        });
                      }}
                      title="Bold"
                      aria-label="Bold"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="2 2 20 20" className="pdf_toolbar_svg_icon">
                        <path d="M13 4.5H7c-.83 0-1.5.67-1.5 1.5v12c0 .83.67 1.5 1.5 1.5h6.5c2.48 0 4.5-2.02 4.5-4.5 0-1.3-.56-2.46-1.44-3.28.58-.76.94-1.69.94-2.72 0-2.48-2.02-4.5-4.5-4.5m0 3c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5H8.5v-3zm.5 9h-5v-3h5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5" />
                      </svg>
                    </button>
                  <button
                    type="button"
                    className={`annot_mode_btn${textItalic ? " annot_mode_btn--active" : ""}`}
                    onClick={() => {
                      setTextItalic((value) => {
                        const next = !value;
                        updateStyledTextTarget({ fontItalic: next });
                        return next;
                      });
                    }}
                    title="Italic"
                    aria-label="Italic"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="2 2 20 20" className="pdf_toolbar_svg_icon">
                      <path d="M19 4H9v2h3.67L9.25 18H5v2h10v-2h-3.67l3.42-12H19z" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className={`annot_mode_btn${textUnderline ? " annot_mode_btn--active" : ""}`}
                    onClick={() => {
                      setTextUnderline((value) => {
                        const next = !value;
                        updateStyledTextTarget({ textUnderline: next });
                        return next;
                      });
                    }}
                    title="Underline"
                    aria-label="Underline"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="2 2 20 20" className="pdf_toolbar_svg_icon">
                      <path d="M5 18h14v2H5zM6 4v6c0 3.31 2.69 6 6 6s6-2.69 6-6V4h-2v6c0 2.21-1.79 4-4 4s-4-1.79-4-4V4z" />
                    </svg>
                  </button>
                  <div className="annot_dd_wrap" ref={bgSwatchRef}>
                    <button
                      type="button"
                      className={`annot_mode_btn${textBackground ? " annot_mode_btn--active" : ""}`}
                      onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        openColorMenuFromRect(rect, { type: "background", presetIndex: null });
                      }}
                      title="Background color"
                      aria-label="Text background color"
                    >
                      <span
                        className="annot_swatch annot_swatch--trigger"
                        style={{ background: textBackgroundColor, opacity: textBackground ? 1 : 0.35 }}
                      />
                    </button>
                  </div>
                </div>
                </div>

                <div className="annot_control">
                <AnnotControlHeaderInfo title="Typeface" />
                <div className="annot_text_font_row">
                  <label className="annot_text_font_label" htmlFor="pdf_text_font_family">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="2 2 20 20" className="pdf_toolbar_svg_icon">
                      <path d="M10.44 6.67C10.3 6.27 9.92 6 9.5 6h-1c-.43 0-.81.27-.94.67L3.64 18h2.12l1.04-3h4.42l1.04 3h2.12L10.46 6.67ZM7.48 13 9 8.61 10.52 13zM13 6h8v2h-8zm2 4h6v2h-6zm2 4h4v2h-4z" />
                    </svg>
                  </label>
                  <select
                    id="pdf_text_font_family"
                    className="annot_text_select"
                    value={textFontFamily}
                    onChange={(e) => {
                      const next = e.target.value;
                      setTextFontFamily(next);
                      updateStyledTextTarget({ fontFamily: next });
                    }}
                    aria-label="Font type"
                  >
                    {TEXT_FONT_FAMILIES.map(({ key, label }) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </div>
                </div>


                <div className="annot_control">
                <AnnotControlHeaderInfo title="Type size" />
                <SizeKnob
                  min={10}
                  max={48}
                  step={1}
                  value={textFontSize}
                  onChange={(next) => {
                    setTextFontSize(next);
                    updateStyledTextTarget({ fontSize: next });
                  }}
                  color={annotColor}
                  dashed={false}
                />
                </div>


                <LabeledPercentKnob
                  title="Text padding"
                  subtitle="Space around text in the background/border box"
                  value={textPadding}
                  onChange={(next) => {
                    setTextPadding(next);
                    updateStyledTextTarget({ padding: next });
                  }}
                  min={0}
                  max={300}
                  step={10}
                  label="%"
                />
              </div>
            )}

            {isPenToolKey(annotTool) && (
              <div className="annot_pen_panel">
                <div className="annot_pen_controls annot_pen_controls--column">
                  <div className="annot_pen_stroke_shaping">
                    <LabeledPercentKnob
                      title="Smoothing"
                      subtitle="Reduce hand jitter"
                      value={penStabilization}
                      onChange={setPenStabilization}
                      label="%"
                    />
                    {/* Always a column under Smoothing, regardless of the
                        toolbar's own dock — unlike every other control here,
                        this trio doesn't flip to a row alongside Smoothing
                        when docked top/bottom (see .annot_pen_stroke_shaping
                        in pdfPage.css). Dynamic ink is always on now (see
                        DEFAULT_PEN_SETTINGS.dynamic) — no toggle needed, so
                        this always renders instead of being conditional. */}
                    <div className="annot_pen_stroke_shaping_extra">
                      <LabeledPercentKnob
                        title="Pressure assist"
                        subtitle="Shape width without stylus pressure"
                        value={penPressureAssist}
                        onChange={setPenPressureAssist}
                        label="%"
                      />
                      <LabeledPercentKnob
                        title="Tip taper"
                        subtitle="Sharper start and end"
                        value={penTaper}
                        onChange={setPenTaper}
                        label="%"
                      />
                      <LabeledPercentKnob
                        title="Ink flow"
                        subtitle="Extra body and softness"
                        value={penFlow}
                        onChange={setPenFlow}
                        label="%"
                      />
                    </div>
                  </div>
                </div>

                {penType === "fountain" && (
                  <div className="annot_pen_controls">
                    <LabeledPercentKnob
                      title="Nib angle"
                      subtitle="Direction of the broad edge"
                      value={penNibAngle}
                      onChange={setPenNibAngle}
                      min={0}
                      max={180}
                      step={5}
                      label="°"
                    />
                    <LabeledPercentKnob
                      title="Nib spread"
                      subtitle="Broad-stroke contrast"
                      value={penNibSpread}
                      onChange={setPenNibSpread}
                      label="%"
                    />
                  </div>
                )}
              </div>
            )}

            {annotTool === "highlight" && (
              <div className="annot_control">
                <AnnotControlHeaderInfo title="Style" />
                <div className="annot_mode_toggle annot_mode_toggle--pen">
                <button
                  type="button"
                  className={`annot_mode_btn${highlightMode === "freehand" ? " annot_mode_btn--active" : ""}`}
                  onClick={() => setHighlightMode("freehand")}
                >Freehand</button>
                <button
                  type="button"
                  className={`annot_mode_btn${highlightMode === "line" ? " annot_mode_btn--active" : ""}`}
                  onClick={() => setHighlightMode("line")}
                >Straight line</button>
                <button
                  type="button"
                  className={`annot_mode_btn annot_mode_btn--toggle${highlightAutoContrast ? " annot_mode_btn--active" : ""}`}
                  onClick={() => setHighlightAutoContrast((value) => !value)}
                  title="Auto Contrast: keep the highlight legible by clamping its color and repainting the covered text in a contrasting color"
                >
                  Auto Contrast
                </button>
                </div>
              </div>
            )}
            {annotTool === "highlight" && highlightMode === "line" && (
              <div className="annot_control">
                <AnnotControlHeaderInfo title="Straight line" />
                <div className="annot_mode_toggle annot_mode_toggle--pen">
                <button
                  type="button"
                  className={`annot_mode_btn annot_mode_btn--toggle${highlightAutoWidth ? " annot_mode_btn--active" : ""}`}
                  onClick={() => setHighlightAutoWidth((value) => !value)}
                  title="Auto width: click text to match that text span's width automatically"
                >
                  Auto width
                </button>
                <button
                  type="button"
                  className={`annot_mode_btn annot_mode_btn--toggle${highlightTaperEnds ? " annot_mode_btn--active" : ""}`}
                  onClick={() => setHighlightTaperEnds((value) => !value)}
                  title="Taper ends: rounded marker caps; off uses blunt ends"
                >
                  {highlightTaperEnds ? "Taper ends" : "Untaper ends"}
                </button>
                </div>
              </div>
            )}
            </div>

            </>
          )}
          {/* Hyles toggle + extraction controls */}
          {pdfDoc && !selectionOnly && !hideHyleControls && <>
            <button
              id="pdf_hyles_toggle_btn"
              className={extractionOpen ? "pdf_hyles_toggle_btn--active" : ""}
              onClick={() => {
                const next = !extractionOpen;
                setExtractionOpen(next);
                setSplitRatio(next ? 0.5 : 1);
              }}
            >Hyles</button>

            {extractionOpen && (
              <div id="pdf_hyles_actions">
                {hyleData && hyleData._total > 0 && !extracting && (
                  <button className={`pdf_action_btn${savedId ? " pdf_action_btn--saved" : ""}`} onClick={handleSave} disabled={saving}>
                    {saving ? "Saving…" : savedId ? "Saved" : "Save"}
                  </button>
                )}
                {extractMode === "ai" && (
                  <button id="pdf_extract_btn" onClick={handleExtract} disabled={!canExtract || extracting} title={!canExtract ? "Open a text-based PDF first" : ""}>
                    {extracting ? "Extracting…" : pdfDoc ? `Extract Page ${pageNum}` : "Extract"}
                  </button>
                )}
              </div>
            )}
          </>}
        </div>
        </div>
        </div>

          </div>
        );
        return toolbarHost ? createPortal(toolbarNode, toolbarHost) : toolbarNode;
      })()}

      {/* Thin selection bar — appears under the toolbar for a double-clicked
          word in reading mode (hideHyleControls). The onSelectionAction
          embedding case (e.g. Units Extraction) keeps its own floating
          #manual_select_bar/#manual_popup_footer instead, unchanged. */}
      {hideHyleControls && !onSelectionAction && manualSelection && (
        <div ref={selBarRef} id="pdf_selection_bar">
          <div id="pdf_selection_bar_row">
            <div id="pdf_selection_bar_actions">
              <button type="button" onClick={() => runSelectionTool("translate")} disabled={Boolean(selectionToolBusy)}>
                <i className={selectionToolBusy === "translate" ? "bx bx-loader-circle pdf_icon_spin" : "bx bx-globe"} />
                Translate to {localStorage.getItem("mctosh_pdf_translate_lang") || "English"}
              </button>
              <button type="button" onClick={() => runSelectionTool("define")} disabled={Boolean(selectionToolBusy)}>
                <i className={selectionToolBusy === "define" ? "bx bx-loader-circle pdf_icon_spin" : "bx bx-book"} />
                Definition
              </button>
              <button type="button" onClick={() => runSelectionTool("linguistic_check")} disabled={Boolean(selectionToolBusy)}>
                <i className={selectionToolBusy === "linguistic_check" ? "bx bx-loader-circle pdf_icon_spin" : "bx bx-git-branch"} />
                Linguistic Structure Check
              </button>
              {/* Local/free — no AI provider, no network call, see pdfTextCorrection.js */}
              <button type="button" onClick={runLocalTextCorrection} title="Repair split words, ligatures, and line-break hyphens — runs locally, no AI">
                <i className="bx bx-spell-check" />
                Correct text
              </button>
            </div>
            <button type="button" id="pdf_selection_bar_close" onClick={() => setManualSelection(null)} title="Dismiss">
              <i className="bx bx-x" />
            </button>
          </div>
          {(selectionToolResult || selectionToolError) && (
            <div id="pdf_selection_bar_result" className={selectionToolError ? "pdf_selection_bar_result--error" : ""}>
              {selectionToolError
                ? <span>⚠ {selectionToolError}</span>
                : <span><strong>{selectionToolResult.label}:</strong> {selectionToolResult.text}</span>}
            </div>
          )}
          {correctionResult && (
            <div id="pdf_selection_bar_result">
              {correctionResult.changes.length || correctionResult.candidates.length ? (
                <>
                  <span>
                    <strong>{correctionResult.uncertain ? "Suggested correction" : "Corrected"}:</strong>{" "}
                    {correctionResult.correctedText}
                    {correctionResult.uncertain && (
                      <span className="pdf_correction_confidence"> ({Math.round(correctionResult.confidence * 100)}%)</span>
                    )}
                  </span>
                  {correctionResult.candidates.map((c, i) => (
                    <span key={i} className="pdf_correction_candidate">
                      Did you mean "{c.text}"? ({Math.round(c.confidence * 100)}%)
                    </span>
                  ))}
                </>
              ) : (
                <span>No corrections found — this text already looks correct.</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Split area */}
      <div
        id="pdf_content"
        ref={contentRef}
        className={notebookMode ? (notebookMode === "notebook-only" ? "pdf_content--notebook-only" : "pdf_content--notebook-split") : undefined}
      >

        {notebookMode && (
          <aside
            id="pdf_freeform_notebook_panel"
            aria-label="Freeform Notebook"
            style={{ "--pdf-notebook-line-height": `${Math.max(textFontSize * 1.8, 24)}px` }}
          >
            <div className="pdf_freeform_notebook_header">
              <strong>Freeform Notebook</strong>
              <div className="pdf_freeform_notebook_actions">
                {notebookActiveTab === "drawing" && (
                  <NotebookZoomControls
                    zoom={notebookDrawingZoom}
                    disabled={zoomingDisabled}
                    onZoomOut={() => zoomNotebookDrawingAt((value) => value - 0.01)}
                    onZoomIn={() => zoomNotebookDrawingAt((value) => value + 0.01)}
                    onReset={() => zoomNotebookDrawingAt(1)}
                  />
                )}
                <div className="pdf_freeform_notebook_stt_pill">
                  <button
                    type="button"
                    className={`pdf_freeform_notebook_stt${notebookSttStatus === "listening" ? " pdf_freeform_notebook_stt--active" : ""}`}
                    title={notebookSttError || (notebookSttStatus === "listening" ? "Stop speech input" : "Enter text with speech")}
                    aria-label={notebookSttStatus === "listening" ? "Stop speech input" : "Enter text with speech"}
                    aria-pressed={notebookSttStatus === "listening"}
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => {
                      if (notebookSttStatus === "listening") {
                        stopNotebookStt();
                        return;
                      }
                      void toggleNotebookStt();
                    }}
                  >
                    <i className={`fi ${notebookSttStatus === "listening" ? "fi-rr-square" : "fi-rr-microphone"}`} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className={`pdf_freeform_notebook_control${notebookControlMode ? " pdf_freeform_notebook_control--active" : ""}`}
                    title="Voice control mode: Delete or Edit a numbered word"
                    aria-label="Toggle Freeform voice control mode"
                    aria-pressed={notebookControlMode}
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => {
                      const next = !notebookControlMode;
                      setNotebookControlMode(next);
                      if (next) {
                        if (notebookSttStatus === "listening") stopNotebookStt();
                        window.setTimeout(() => toggleNotebookStt(STT_PROVIDERS.BROWSER), 0);
                      }
                    }}
                  >
                    <i className="fi fi-rr-command" aria-hidden="true" />
                  </button>
                </div>
                <button
                  type="button"
                  className={`pdf_freeform_notebook_settings${notebookActiveTab === "settings" ? " pdf_freeform_notebook_settings--active" : ""}`}
                  title="Freeform settings"
                  aria-label="Open Freeform settings"
                  aria-pressed={notebookActiveTab === "settings"}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => setNotebookActiveTab((tab) => tab === "settings" ? "typing" : "settings")}
                >
                  <i className="fi fi-rr-settings-sliders" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="pdf_freeform_notebook_keyboard"
                  title="Open AMCTOSHS keyboard"
                  aria-label="Open AMCTOSHS keyboard"
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => {
                    document.querySelector(".pdf_freeform_notebook_editor")?.focus({ preventScroll: true });
                    window.dispatchEvent(new CustomEvent("virtual-keyboard:toggle"));
                  }}
                >
                  <i className="fi fi-rr-keyboard" aria-hidden="true" />
                </button>
                <button type="button" onClick={closeNotebook} title="Close Freeform Notebook" aria-label="Close Freeform Notebook">
                  <i className="bx bx-x" />
                </button>
              </div>
            </div>
            <div className="pdf_freeform_notebook_tabs" role="tablist" aria-label="Freeform Notebook views">
              <button type="button" role="tab" aria-selected={notebookActiveTab === "typing"} className={notebookActiveTab === "typing" ? "pdf_freeform_notebook_tab--active" : ""} onClick={() => setNotebookActiveTab("typing")}>Typing</button>
              <button type="button" role="tab" aria-selected={notebookActiveTab === "drawing"} className={notebookActiveTab === "drawing" ? "pdf_freeform_notebook_tab--active" : ""} onClick={() => setNotebookActiveTab("drawing")}>Drawing</button>
              <button type="button" role="tab" aria-selected={notebookActiveTab === "settings"} className={notebookActiveTab === "settings" ? "pdf_freeform_notebook_tab--active" : ""} onClick={() => setNotebookActiveTab("settings")}>Settings</button>
            </div>
            {notebookActiveTab === "settings" ? (
              <div className="pdf_freeform_notebook_settings_panel">
                <strong>Voice commands</strong>
                <p>
                  Control mode uses browser STT. Change the wording or placeholder order freely;
                  keep <code>&lt;line number&gt;</code> and <code>&lt;word number&gt;</code> in each enabled command,
                  plus <code>&lt;new value&gt;</code> in Edit.
                </p>
                {notebookVoiceCommands.map((command, index) => (
                  <label className="pdf_freeform_notebook_command_setting" key={NOTEBOOK_VOICE_COMMAND_ACTIONS[index] || index}>
                    <span>{NOTEBOOK_VOICE_COMMAND_LABELS[index] || `Command ${index + 1}`}</span>
                    <input
                      value={command}
                      aria-label={`${NOTEBOOK_VOICE_COMMAND_LABELS[index] || `Voice command ${index + 1}`} template`}
                      onChange={(event) => setNotebookVoiceCommands((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))}
                    />
                  </label>
                ))}
              </div>
            ) : notebookActiveTab === "drawing" ? (
              <div
                ref={notebookDrawingSurfaceRef}
                className="pdf_freeform_notebook_drawing_surface"
                onPointerDownCapture={() => activateAnnotationSurface("nb")}
                onTouchStartCapture={() => activateAnnotationSurface("nb")}
              >
                <canvas ref={notebookDrawingCanvasRef} className="pdf_freeform_notebook_drawing_canvas" aria-label="Freeform drawing canvas" />
                {notebookDrawingTextInput && (
                  <textarea
                    autoFocus
                    inputMode="none"
                    className="pdf_freeform_notebook_drawing_text_input"
                    value={notebookDrawingTextInput.value}
                    style={{ left: notebookDrawingTextInput.viewX, top: notebookDrawingTextInput.viewY }}
                    aria-label="Drawing text"
                    onChange={(event) => setNotebookDrawingTextInput((current) => current ? { ...current, value: event.target.value } : current)}
                    onBlur={commitNotebookDrawingText}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        setNotebookDrawingTextInput(null);
                      } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                        event.preventDefault();
                        commitNotebookDrawingText();
                      }
                    }}
                  />
                )}
              </div>
            ) : notebookControlMode ? (
              <div className="pdf_freeform_notebook_control_shell">
                <div className="pdf_freeform_notebook_control_view" aria-label="Freeform Notebook voice control tags">
                  {notebookControlLines.map((line) => (
                    <div className="pdf_freeform_notebook_control_line" key={line.number}>
                      <span className="pdf_freeform_notebook_line_tag">&lt;L{line.number}&gt;</span>
                      {line.words.length ? line.words.map((word) => (
                        <span className="pdf_freeform_notebook_word" key={word.number}>
                          <span className="pdf_freeform_notebook_word_tag">&lt;W{word.number}&gt;</span>{word.text}
                        </span>
                      )) : <span>&nbsp;</span>}
                    </div>
                  ))}
                </div>
                <textarea
                  ref={notebookEditorRef}
                  className="pdf_freeform_notebook_editor pdf_freeform_notebook_editor--control-hidden"
                  value={notebookText}
                  onChange={(event) => setNotebookText(event.target.value)}
                  aria-hidden="true"
                  tabIndex={-1}
                  inputMode="none"
                />
              </div>
            ) : (
              <textarea
                ref={notebookEditorRef}
                className="pdf_freeform_notebook_editor"
                value={notebookText}
                onChange={(event) => setNotebookText(event.target.value)}
                placeholder="Write freely..."
                aria-label="Freeform Notebook text"
                inputMode="none"
                style={{
                  fontFamily: textFontFamily,
                  fontSize: `${textFontSize}px`,
                  lineHeight: `${Math.max(textFontSize * 1.8, 24)}px`,
                  fontWeight: textBold ? 700 : 400,
                  fontStyle: textItalic ? "italic" : "normal",
                  textDecoration: textUnderline ? "underline" : "none",
                  textAlign,
                  color: textToolColor,
                  backgroundColor: textBackground ? textBackgroundColor : "transparent",
                }}
              />
            )}
            {notebookSttError && <div className="pdf_freeform_notebook_stt_error" role="status">{notebookSttError}</div>}
          </aside>
        )}

        {/* Far left — Annotation History column, opened by the toolbar "History" button */}
        {annotHistoryOpen && (
          <div id="pdf_annot_history_panel" style={{ width: annotHistoryPanelWidth }}>
            <div
              className="pdf_aside_resize_handle"
              onMouseDown={handleAnnotHistoryPanelResizeStart}
              onTouchStart={handleAnnotHistoryPanelResizeStart}
            />
            <div id="pdf_annot_history_header">
              <span className="pdf_annot_history_title">Annotation History</span>
              <div className="pdf_annot_history_source_toggle" role="tablist" aria-label="Annotation history source">
                <button type="button" role="tab" aria-selected={annotHistorySource === "pdf"} className={annotHistorySource === "pdf" ? "pdf_annot_history_source--active" : undefined} onClick={() => activateAnnotationSurface("pdf")}>PDF</button>
                <button type="button" role="tab" aria-selected={annotHistorySource === "md"} className={annotHistorySource === "md" ? "pdf_annot_history_source--active" : undefined} onClick={() => activateAnnotationSurface("md")}>MD</button>
              </div>
              <button
                id="pdf_annot_history_clear"
                onClick={annotHistorySource === "md" ? clearMarkdownAnnotations : handleClearAllAnnotations}
                title={annotHistorySource === "md" ? "Clear all Markdown annotations" : "Clear All Annotations — permanently delete every annotation on every page and blank the entire history. Cannot be undone."}
                aria-label="Clear All Annotations"
                disabled={annotHistorySource === "md" ? markdownHistoryEntries.length === 0 : totalAnnotationCount === 0}
              >
                <i className="bxf bx-trash-alt" />
              </button>
              <button id="pdf_annot_history_close" onClick={() => setAnnotHistoryOpen(false)} title="Close">✕</button>
            </div>
            <div id="pdf_annot_history_body">
              {annotHistorySource === "md" ? (
                markdownHistoryEntries.length ? markdownHistoryEntries.map((entry) => {
                  const toolLabel = ANNOT_TOOLS.find((tool) => tool.key === entry.type)?.label || entry.type || "Annotation";
                  return (
                    <div key={entry.id} className="anh_row anh_row--md">
                      <i className="bx bx-file anh_icon" />
                      <div className="anh_main">
                        <span className="anh_label">Added {toolLabel}</span>
                        <span className="anh_meta">p.{entry.page}{entry.time ? ` · ${entry.time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : " · current"}</span>
                      </div>
                      {entry.color && <span className="anh_swatch" style={{ background: entry.color }} />}
                    </div>
                  );
                }) : <div className="anh_empty">No Markdown annotations on this source.</div>
              ) : (() => {
                // Newest-first, chunked into per-day groups with a date
                // header between them — history now survives a reload
                // (see the autosave/restore effects above), so a single
                // flat list would otherwise mix days together with no way
                // to tell them apart once there's more than one session's
                // worth of entries.
                const isSameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
                const today = new Date();
                const yesterday = new Date(today);
                yesterday.setDate(today.getDate() - 1);
                const dayLabel = (d) => {
                  if (isSameDay(d, today)) return "Today";
                  if (isSameDay(d, yesterday)) return "Yesterday";
                  return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
                };
                // Deleting a day should stay available even if every
                // annotation created that day has already been erased from
                // the live document — the user may still want to clear the
                // day's history group itself. Count unique "add" rows by
                // annotationId so the button/tooltip reflect creations for
                // that day rather than only currently-surviving marks.
                const countCreatedOn = (day) => new Set(
                  annotHistory
                    .filter((h) => h.action === "add" && h.annotationId && isSameDay(h.time, day))
                    .map((h) => h.annotationId)
                ).size;
                const rows = [];
                let lastDay = null;
                for (const h of [...annotHistory].reverse()) {
                  if (!lastDay || !isSameDay(lastDay, h.time)) {
                    const dayForDelete = h.time;
                    const deletableCount = countCreatedOn(dayForDelete);
                    rows.push(
                      <div key={`day-${h.id}`} className="anh_day_header">
                        <span>{dayLabel(h.time)}</span>
                        <button
                          type="button"
                          className="anh_day_delete"
                          onClick={() => handleDeleteHistoryDay(dayForDelete)}
                          title={
                            deletableCount === 0
                              ? `Remove the history entries for ${dayLabel(h.time)} — the annotations from that day were already erased`
                              : `Delete ${deletableCount} annotation${deletableCount === 1 ? "" : "s"} created on ${dayLabel(h.time)}`
                          }
                        >
                          <i className="bx bx-trash" />
                        </button>
                      </div>
                    );
                    lastDay = h.time;
                  }
                  // A cleared "add" row (see markAnnotationCleared) keeps its
                  // own original icon/verb/color — it's still the record of
                  // that annotation being added, just tagged with what later
                  // happened to it — rather than borrowing "delete"'s meta.
                  const meta = ANNOT_HISTORY_META[h.action] || ANNOT_HISTORY_META.add;
                  const toolLabel = ANNOT_TOOLS.find((t) => t.key === h.type)?.label || (h.type === "text" ? "Text" : h.type);
                  // Only the "Cleared" row a day-delete itself produced
                  // carries restorableAnnotations (see handleDeleteHistoryDay)
                  // — a plain "Clear All Annotations" wipe deliberately never
                  // sets it, so no retrieve button appears there.
                  const canRetrieve = h.action === "clear" && h.restorableAnnotations && Object.keys(h.restorableAnnotations).length > 0;
                  const isCleared = h.action === "add" && Boolean(h.clearedAt);
                  rows.push(
                    <div key={h.id} className={`anh_row${isCleared ? " anh_row--cleared" : ""}`}>
                      <i className={`${meta.icon} anh_icon`} />
                      <div className="anh_main">
                        <span className="anh_label">
                          {meta.verb}{h.action === "clear" ? ` ${h.count} item${h.count === 1 ? "" : "s"}` : h.action === "erase" ? ` ${h.count} mark${h.count === 1 ? "" : "s"}` : toolLabel ? ` ${toolLabel}` : ""}
                        </span>
                        <span className="anh_meta">
                          p.{h.page} · {h.time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                        </span>
                      </div>
                      {h.color && <span className="anh_swatch" style={{ background: h.color }} />}
                      {isCleared && <span className="anh_cleared_tag">Cleared</span>}
                      {canRetrieve && (
                        <button
                          type="button"
                          className="anh_retrieve_btn"
                          onClick={() => handleRestoreHistoryDay(h)}
                          title={`Retrieve the ${h.count} annotation${h.count === 1 ? "" : "s"} deleted here`}
                        >
                          <i className="bx bx-history" />
                        </button>
                      )}
                    </div>
                  );
                }
                return rows;
              })()}
            </div>
          </div>
        )}

        {/* Far left — Smart Video Search results, opened by the toolbar
            "Extract Eidos and Find Videos" button. Same far-left-column
            convention as the Markdown/Annotation-History panels above. */}
        {smartVideoOpen && (
          <SmartVideoPanel
            width={smartVideoPanelWidth}
            onResizeStart={handleSmartVideoPanelResizeStart}
            selecting={smartVideoSelecting}
            onToggleSelecting={() => setSmartVideoSelecting((v) => !v)}
            screenshots={smartVideoScreenshots}
            captureBusy={smartVideoCaptureBusy}
            onRemoveScreenshot={removeSmartVideoScreenshot}
            onClearScreenshots={clearSmartVideoScreenshots}
            difficulty={smartVideoDifficulty}
            onDifficultyChange={setSmartVideoDifficulty}
            onSearch={handleSmartVideoSearch}
            stage={smartVideoStage}
            error={smartVideoError}
            eidos={smartVideoEidos}
            videos={smartVideoVideos}
            activeVideoId={smartVideoActiveVideoId}
            onWatch={setSmartVideoActiveVideoId}
            onCloseVideo={() => setSmartVideoActiveVideoId(null)}
            provider={provider}
            providerModels={aiProviderModels}
            savedOpen={smartVideoSavedOpen}
            onToggleSaved={toggleSmartVideoSaved}
            saved={smartVideoSaved}
            savedLoading={smartVideoSavedLoading}
            onLoadSaved={loadSmartVideoSaved}
            onDeleteSaved={deleteSmartVideoSaved}
            onSave={saveSmartVideoConcept}
            saveBusy={smartVideoSaveBusy}
            savedId={smartVideoSavedId}
            preferences={smartVideoPreferences}
            onPreferencesChange={setSmartVideoPreferences}
            preferencesOpen={smartVideoPreferencesOpen}
            onTogglePreferences={toggleSmartVideoPreferences}
          />
        )}

        {entityBuilderOpen && (() => {
          const illuminationNode = (
            <EntityBuilderPanel
              width={entityBuilderPanelWidth}
              onResizeStart={handleEntityBuilderPanelResizeStart}
              onClose={toggleEntityBuilder}
              pageNum={pageNum}
              isPageFullySegmented={isCurrentPageFullySegmented}
            />
          );
          return entityBuilderHost ? createPortal(illuminationNode, entityBuilderHost) : illuminationNode;
        })()}

        {/* Left — PDF viewer or upload zone */}
        <div
          id="pdf_preview"
          style={{
            width: splitRatio === 0
              ? "0"
              : `calc(${splitRatio >= 0.9 ? 100 : splitRatio * 100}% - ${(annotHistoryOpen ? annotHistoryPanelWidth : 0) + (smartVideoOpen ? smartVideoPanelWidth : 0) + (entityBuilderOpen && !entityBuilderHost ? entityBuilderPanelWidth : 0)}px)`,
          }}
          className={`${splitRatio === 0 ? "pdf_preview--closed" : ""}${navigationBlocked ? " pdf_preview--tool-active" : ""}${annotTool === "highlight" ? " pdf_preview--highlight-active" : ""}${zoom === 1 ? " pdf_preview--zoom-fit" : ""}`}
        >
          <div id="pdf_preview_scroll" ref={previewRef}>
          {pdfDoc ? (
            <>
              <div
                id="pdf_canvas_wrap"
                ref={canvasWrapRef}
                className={`${readingMode === "booklet" || entityBuilderOcrBlankPageOpen ? "pdf_canvas_wrap--booklet" : ""}${markdownVisualActive ? " pdf_canvas_wrap--md-visual" : ""}${markdownVisualMode === "visual-only" && markdownVisualActive ? " pdf_canvas_wrap--md-only" : ""}`}
              >
                {/* Single-page mode: only the current page is ever mounted —
                    no continuous scroll between pages, navigate with the
                    page arrows instead. Booklet mode mounts a second,
                    independently-picked companion page alongside it — it's
                    rendered (rasterized) the same way as the primary page,
                    but stays read-only: the annotation/mask canvases and
                    every interactive layer below are still gated on
                    `pageNum === n`, so only the primary/left page is ever
                    editable. */}
                {displayPageDescriptors.map((descriptor) => (
                  <div
                    key={`${descriptor.kind}-${descriptor.page}`}
                    className={`pdf_page_container${descriptor.kind === "ocr-blank" ? " pdf_page_container--ocr_blank" : ""}`}
                    ref={descriptor.kind === "pdf" ? (el => { pageContainerRefs.current[descriptor.page - 1] = el; }) : undefined}
                    data-page={descriptor.page}
                    onPointerDownCapture={descriptor.kind === "pdf" ? () => activateAnnotationSurface("pdf") : undefined}
                    onTouchStartCapture={descriptor.kind === "pdf" ? () => activateAnnotationSurface("pdf") : undefined}
                  >
                    {descriptor.kind === "pdf" ? (
                      <canvas
                        className="pdf_page_canvas"
                        ref={el => { pageCanvasRefs.current[descriptor.page - 1] = el; }}
                      />
                    ) : (
                      (() => {
                        const scale = pageViewport?.scale || (fitScaleRef.current * zoomRef.current);
                        const headerFontSize = Math.max(1, OCR_BLANK_HEADER_FONT_SIZE * scale);
                        const footerFontSize = Math.max(1, OCR_BLANK_FOOTER_FONT_SIZE * scale);
                        const footerHeight = Math.max(
                          1,
                          ((OCR_BLANK_FOOTER_FONT_SIZE * OCR_BLANK_FOOTER_LINE_HEIGHT) + OCR_BLANK_FOOTER_PAD_TOP + OCR_BLANK_FOOTER_PAD_BOTTOM) * scale,
                        );
                        const activeBlankPageServices = entityBuilderBlankPageMode === "ocr"
                          ? OCR_COMPANION_SERVICES
                          : ["tesseract", "tesseract-visual"].includes(entityBuilderBlankPageMode)
                            ? TESSERACT_COMPANION_SERVICES
                            : entityBuilderBlankPageMode === "visual-raw"
                              ? VISUAL_RAW_COMPANION_SERVICES
                              : RAW_COMPANION_SERVICES;
                        const showOcrBusy = ["ocr", "tesseract", "tesseract-visual"].includes(entityBuilderBlankPageMode) && entityBuilderOcrBlankPageBusy;
                        const showOcrError = ["ocr", "tesseract", "tesseract-visual"].includes(entityBuilderBlankPageMode) ? entityBuilderOcrBlankPageError : "";
                        const activeOcrEngine = "tesseract";
                        const activeOcrView = entityBuilderBlankPageMode === "tesseract-visual" ? "visual" : "table";
                        return (
                          <div
                            className="pdf_ocr_blank_page"
                            style={pageViewport ? { width: pageViewport.width, height: pageViewport.height } : undefined}
                          >
                            {showOcrError ? (
                              <div className="pdf_ocr_blank_page_status pdf_ocr_blank_page_status--error">{showOcrError}</div>
                            ) : showOcrBusy ? (
                              <div className="pdf_ocr_blank_page_status">Building OCR page...</div>
                            ) : (
                              <>
                                {entityBuilderBlankPageMode === "raw" || entityBuilderBlankPageMode === "visual-raw" ? (
                                  <div
                                    className={`pdf_ocr_blank_raw_text${entityBuilderBlankPageMode === "visual-raw" ? " pdf_ocr_blank_visual_raw_text" : ""}`}
                                    style={{
                                      inset: entityBuilderBlankPageMode === "visual-raw"
                                        ? `0 0 ${footerHeight}px 0`
                                        : `${Math.max(1, 72 * scale)}px ${Math.max(1, 18 * scale)}px ${footerHeight}px ${Math.max(1, 18 * scale)}px`,
                                      fontSize: `${Math.max(1, 11 * scale)}px`,
                                      lineHeight: 1.45,
                                    }}
                                  >
                                    {entityBuilderBlankPageMode === "visual-raw" ? (
                                      entityBuilderRawBlankPageRows.length ? (
                                        <div className="pdf_ocr_blank_visual_raw_layer">
                                          {entityBuilderRawBlankPageRows.filter((row) => !row.omitted && !entityBuilderOmittedRawCategories.has(getUnicodeOmissionLabel(row.value))).map((row) => (
                                            <span
                                              key={row.id}
                                              className="pdf_ocr_blank_visual_raw_item"
                                              title={row.value}
                                              style={{
                                                left: `${Math.max(0, row.x || 0) * scale}px`,
                                                top: `${Math.max(0, row.y || 0) * scale}px`,
                                                width: `${Math.max(1, row.width || 0) * scale}px`,
                                                height: `${getRawVisibleHeight(row) * scale}px`,
                                                lineHeight: `${getRawVisibleHeight(row) * scale}px`,
                                                fontSize: `${Math.max(1, row.fontSize || 1) * entityBuilderVisualRawTextScale * scale}px`,
                                                fontFamily: IBM_PLEX_MONO_FONT,
                                                fontWeight: row.fontWeight || "normal",
                                                fontStyle: row.fontStyle || "normal",
                                                transform: `rotate(${Number(row.rotation) || 0}deg)`,
                                              }}
                                            >
                                              {row.value}
                                            </span>
                                          ))}
                                        </div>
                                      ) : "No PDF.js text items were extracted for this page."
                                    ) : (
                                      entityBuilderRawBlankPageRows.length ? (
                                        <>
                                          <div className="pdf_ocr_blank_raw_dims">
                                            <div className="pdf_ocr_blank_raw_dims_row">
                                              <span className="pdf_ocr_blank_raw_dims_label">Page dimensions</span>
                                              <span className="pdf_ocr_blank_raw_dims_value">
                                                {entityBuilderRawBlankPageMeta?.pageWidth ? entityBuilderRawBlankPageMeta.pageWidth.toFixed(2) : "-"}
                                                {" × "}
                                                {entityBuilderRawBlankPageMeta?.pageHeight ? entityBuilderRawBlankPageMeta.pageHeight.toFixed(2) : "-"}
                                              </span>
                                              <span className="pdf_ocr_blank_raw_dims_label">Viewport scale</span>
                                              <span className="pdf_ocr_blank_raw_dims_value">
                                                {pageViewport?.scale ? pageViewport.scale.toFixed(4) : "-"}
                                              </span>
                                            </div>
                                            <div className="pdf_ocr_blank_raw_dims_row">
                                              <span className="pdf_ocr_blank_raw_dims_label">Page rotation</span>
                                              <span className="pdf_ocr_blank_raw_dims_value">
                                                {Number.isFinite(entityBuilderRawBlankPageMeta?.pageRotation) ? `${entityBuilderRawBlankPageMeta.pageRotation}°` : "-"}
                                              </span>
                                              <span className="pdf_ocr_blank_raw_dims_label">Media box</span>
                                              <span className="pdf_ocr_blank_raw_dims_value">
                                                {entityBuilderRawBlankPageMeta?.mediaBox?.length === 4
                                                  ? entityBuilderRawBlankPageMeta.mediaBox.map((value) => Number(value).toFixed(2)).join(" × ")
                                                  : "-"}
                                              </span>
                                              <button
                                                type="button"
                                                className={`pdf_ocr_blank_raw_action${entityBuilderEmptyAreaHighlightsOpen ? " pdf_ocr_blank_raw_action--active" : ""}`}
                                                onClick={() => setEntityBuilderEmptyAreaHighlightsOpen((open) => !open)}
                                              >
                                                {entityBuilderEmptyAreaHighlightsOpen ? "Hide Empty Areas" : "Show Empty Areas"}
                                              </button>
                                            </div>
                                          </div>
                                          <div className="pdf_ocr_blank_raw_column_tabs" role="tablist" aria-label="RAW metadata groups">
                                            {[
                                              ["text", "TEXT"],
                                              ["position", "POSITION"],
                                              ["font", "FONT"],
                                              ["transform", "TRANSFORM"],
                                              ["classification", "CLASSIFICATION"],
                                            ].map(([group, label]) => (
                                              <button
                                                key={group}
                                                type="button"
                                                role="tab"
                                                aria-selected={entityBuilderRawColumnGroup === group}
                                                className={entityBuilderRawColumnGroup === group ? "pdf_ocr_blank_raw_column_tab pdf_ocr_blank_raw_column_tab--active" : "pdf_ocr_blank_raw_column_tab"}
                                                onClick={() => setEntityBuilderRawColumnGroup(group)}
                                              >
                                                {label}
                                              </button>
                                            ))}
                                          </div>
                                          <div className="pdf_ocr_blank_raw_search">
                                            <label htmlFor="pdf-raw-value-search">Search VALUE</label>
                                            <input
                                              id="pdf-raw-value-search"
                                              type="search"
                                              value={entityBuilderRawValueQuery}
                                              onChange={(event) => setEntityBuilderRawValueQuery(event.target.value)}
                                              placeholder="Search extracted string values..."
                                              spellCheck="false"
                                            />
                                            {entityBuilderRawValueQuery && (
                                              <button
                                                type="button"
                                                className="pdf_ocr_blank_raw_search_clear"
                                                onClick={() => setEntityBuilderRawValueQuery("")}
                                                aria-label="Clear VALUE search"
                                                title="Clear search"
                                              >
                                                ×
                                              </button>
                                            )}
                                            <span className="pdf_ocr_blank_raw_search_count">
                                              {entityBuilderFilteredRawRows.length}/{entityBuilderRawBlankPageRows.length}
                                            </span>
                                          </div>
                                          <div className="pdf_ocr_blank_raw_table_scroll">
                                            <table
                                              className="pdf_ocr_blank_raw_table"
                                              data-raw-group={entityBuilderRawColumnGroup}
                                              style={{ fontSize: `${Math.max(1, 12 * scale)}px`, lineHeight: 1.25 }}
                                            >
                                              <thead>
                                                <tr>
                                                  {[
                                                    "INSTANCE #", "VALUE", "TX", "TY", "X", "Y", "FONT SIZE", "TOP", "ASCENT", "BASELINE", "DESCENT", "BOTTOM",
                                                    "FONT FAMILY", "WEIGHT", "STYLE", "FONT NAME", "DIR", "EOL", "ROTATION", "SCALE X", "SCALE Y", "CHAR COUNT",
                                                    "WHITESPACE", "ORIGINAL A", "ORIGINAL B", "ORIGINAL C", "ORIGINAL D", "ORIGINAL E", "ORIGINAL F",
                                                    "FULL A", "FULL B", "FULL C", "FULL D", "FULL E", "FULL F", "RAW WIDTH", "RAW HEIGHT", "PAGE WIDTH", "PAGE HEIGHT", "CLASS",
                                                  ].map((label) => (
                                                    <th key={label}><RawColumnHeader label={label} /></th>
                                                  ))}
                                                </tr>
                                              </thead>
                                              <tbody>
                                                {entityBuilderFilteredRawRows.map((row) => (
                                                  <tr key={row.id}>
                                                    <td>{Number.isFinite(row.instanceNumber) ? row.instanceNumber : "-"}</td>
                                                    <td className="pdf_ocr_wrap_cell"><button type="button" className="pdf_ocr_blank_raw_value_link" onClick={() => focusOriginalTextValue(row)}>{row.value}</button></td>
                                                    <td>{Number.isFinite(row.tx) ? row.tx.toFixed(2) : "-"}</td>
                                                    <td>{Number.isFinite(row.ty) ? row.ty.toFixed(2) : "-"}</td>
                                                    <td>{Number.isFinite(row.x) ? row.x.toFixed(2) : "-"}</td>
                                                    <td>{Number.isFinite(row.y) ? row.y.toFixed(2) : "-"}</td>
                                                    <td>{Number.isFinite(row.fontSize) ? row.fontSize.toFixed(2) : "-"}</td>
                                                    <td>{Number.isFinite(row.top) ? row.top.toFixed(2) : "-"}</td>
                                                    <td>{Number.isFinite(row.ascent) ? row.ascent.toFixed(2) : "-"}</td>
                                                    <td>{Number.isFinite(row.baseline) ? row.baseline.toFixed(2) : "-"}</td>
                                                    <td>{Number.isFinite(row.descent) ? row.descent.toFixed(2) : "-"}</td>
                                                    <td>{Number.isFinite(row.bottom) ? row.bottom.toFixed(2) : "-"}</td>
                                                    <td>{row.fontFamily || "-"}</td>
                                                    <td>{row.fontWeight || "-"}</td>
                                                    <td>{row.fontStyle || "-"}</td>
                                                    <td>{row.fontName || "-"}</td>
                                                    <td>{row.direction || "-"}</td>
                                                    <td>{row.eol ? "true" : "false"}</td>
                                                    <td>{formatSignedRotation(row.rotation)}</td>
                                                    <td>{Number.isFinite(row.scaleX) ? row.scaleX.toFixed(2) : "-"}</td>
                                                    <td>{Number.isFinite(row.scaleY) ? row.scaleY.toFixed(2) : "-"}</td>
                                                    <td>{Number.isFinite(row.charCount) ? row.charCount : "-"}</td>
                                                    <td>{row.whitespaceOnly ? "true" : "false"}</td>
                                                    <td>{Number.isFinite(row.matrixA) ? row.matrixA.toFixed(4) : "-"}</td>
                                                    <td>{Number.isFinite(row.matrixB) ? row.matrixB.toFixed(4) : "-"}</td>
                                                    <td>{Number.isFinite(row.matrixC) ? row.matrixC.toFixed(4) : "-"}</td>
                                                    <td>{Number.isFinite(row.matrixD) ? row.matrixD.toFixed(4) : "-"}</td>
                                                    <td>{Number.isFinite(row.matrixE) ? row.matrixE.toFixed(4) : "-"}</td>
                                                    <td>{Number.isFinite(row.matrixF) ? row.matrixF.toFixed(4) : "-"}</td>
                                                    <td>{Number.isFinite(row.fullMatrixA) ? row.fullMatrixA.toFixed(4) : "-"}</td>
                                                    <td>{Number.isFinite(row.fullMatrixB) ? row.fullMatrixB.toFixed(4) : "-"}</td>
                                                    <td>{Number.isFinite(row.fullMatrixC) ? row.fullMatrixC.toFixed(4) : "-"}</td>
                                                    <td>{Number.isFinite(row.fullMatrixD) ? row.fullMatrixD.toFixed(4) : "-"}</td>
                                                    <td>{Number.isFinite(row.fullMatrixE) ? row.fullMatrixE.toFixed(4) : "-"}</td>
                                                    <td>{Number.isFinite(row.fullMatrixF) ? row.fullMatrixF.toFixed(4) : "-"}</td>
                                                    <td>{Number.isFinite(row.rawWidth) ? row.rawWidth.toFixed(4) : "-"}</td>
                                                    <td>{Number.isFinite(row.rawHeight) ? row.rawHeight.toFixed(4) : "-"}</td>
                                                    <td>{Number.isFinite(row.width) ? row.width.toFixed(2) : "-"}</td>
                                                    <td>{Number.isFinite(row.height) ? row.height.toFixed(2) : "-"}</td>
                                                    <td>{row.classification}</td>
                                                  </tr>
                                                ))}
                                                {!entityBuilderFilteredRawRows.length && (
                                                  <tr>
                                                    <td className="pdf_ocr_blank_raw_no_matches" colSpan={40}>No VALUE matches found.</td>
                                                  </tr>
                                                )}
                                              </tbody>
                                            </table>
                                          </div>
                                        </>
                                      ) : "No native PDF.js text was extracted for this page."
                                    )}
                                  </div>
                                ) : entityBuilderBlankPageMode === "tesseract-visual" ? (
                                  <div className="pdf_ocr_blank_visual_ocr_layer">
                                    {activeTesseractTableRows.length && entityBuilderTesseractMeta.pageWidth && entityBuilderTesseractMeta.pageHeight ? activeTesseractTableRows.map((row) => (
                                      <span
                                        key={row.id}
                                        className="pdf_ocr_blank_visual_ocr_item"
                                        title={row.text}
                                        style={{
                                          left: `${(Math.max(0, row.x || 0) / entityBuilderTesseractMeta.pageWidth) * (pageViewport?.width || 0)}px`,
                                          top: `${(Math.max(0, row.y || 0) / entityBuilderTesseractMeta.pageHeight) * (pageViewport?.height || 0)}px`,
                                          width: `${Math.max(1, row.width || 0) / entityBuilderTesseractMeta.pageWidth * (pageViewport?.width || 0)}px`,
                                          minHeight: `${Math.max(1, row.height || 1) / entityBuilderTesseractMeta.pageHeight * (pageViewport?.height || 0)}px`,
                                          fontSize: `${Math.max(1, (row.height || 1) / entityBuilderTesseractMeta.pageHeight * (pageViewport?.height || 0) * 0.82)}px`,
                                          whiteSpace: "nowrap",
                                        }}
                                      >
                                        {row.text}
                                      </span>
                                    )) : "No Tesseract text with usable coordinates was returned for this page."}
                                  </div>
                                ) : entityBuilderBlankPageMode === "tesseract" ? (
                                  <div className="pdf_ocr_blank_ocr_table_wrap" style={{ paddingTop: `${Math.max(1, 72 * scale)}px` }}>
                                    <button
                                      type="button"
                                      className="pdf_ocr_tesseract_run_button"
                                      onClick={runTesseractOcr}
                                      disabled={entityBuilderTesseractBusy}
                                    >
                                      {entityBuilderTesseractBusy ? "Running Tesseract..." : "Run Tesseract"}
                                    </button>
                                    {entityBuilderTesseractError ? (
                                      <div className="pdf_ocr_blank_page_status pdf_ocr_blank_page_status--error">{entityBuilderTesseractError}</div>
                                    ) : entityBuilderTesseractBusy ? (
                                      <div className="pdf_ocr_blank_page_status">Running Tesseract...</div>
                                    ) : activeTesseractTableRows.length ? (
                                      <table className="pdf_ocr_blank_ocr_table" style={{ fontSize: `${Math.max(1, 12 * scale)}px`, lineHeight: 1.25 }}>
                                        <thead>
                                          <tr>
                                            {["VALUE", "INSTANCE #", "LEVEL", "X", "Y", "WIDTH", "HEIGHT", "CONFIDENCE", "BLOCK", "PARAGRAPH", "LINE", "WORD", "TESSERACT SOURCE"].map((label) => (
                                              <th key={label}><RawColumnHeader label={label} notes={TESSERACT_COLUMN_NOTES[label]} /></th>
                                            ))}
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {activeTesseractTableRows.map((row) => (
                                            <tr key={row.id}>
                                              <td>{row.text || "-"}</td>
                                              <td>{Number.isFinite(row.instanceNumber) ? row.instanceNumber : "-"}</td>
                                              <td>{Number.isFinite(row.level) ? row.level : "-"}</td>
                                              <td>{Number.isFinite(row.x) ? row.x.toFixed(2) : "-"}</td>
                                              <td>{Number.isFinite(row.y) ? row.y.toFixed(2) : "-"}</td>
                                              <td>{Number.isFinite(row.width) ? row.width.toFixed(2) : "-"}</td>
                                              <td>{Number.isFinite(row.height) ? row.height.toFixed(2) : "-"}</td>
                                              <td>{Number.isFinite(row.confidence) ? row.confidence.toFixed(2) : "-"}</td>
                                              <td>{row.block || "-"}</td>
                                              <td>{row.paragraph || "-"}</td>
                                              <td>{row.line || "-"}</td>
                                              <td>{row.word || "-"}</td>
                                              <td>{row.source || "-"}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    ) : "No Tesseract text was returned for this page."}
                                  </div>
                                ) : (
                                  <div className="pdf_ocr_blank_ocr_table_wrap" style={{ paddingTop: `${Math.max(1, 72 * scale)}px` }}>
                                    <button
                                      type="button"
                                      className="pdf_ocr_tesseract_run_button"
                                      onClick={runTesseractOcr}
                                      disabled={entityBuilderTesseractBusy}
                                    >
                                      {entityBuilderTesseractBusy ? "Running Tesseract..." : "Run Tesseract"}
                                    </button>
                                    {entityBuilderOcrTableRows.length ? (
                                      <table
                                        className="pdf_ocr_blank_ocr_table"
                                        style={{ fontSize: `${Math.max(1, 12 * scale)}px`, lineHeight: 1.25 }}
                                      >
                                        <thead>
                                          <tr>
                                            {[
                                              "STRING", "VALUE", "TYPE", "X", "Y", "WIDTH", "HEIGHT", "FONT SIZE", "FONT FAMILY",
                                              "WEIGHT", "STYLE", "HEADING", "WRAP", "OCR SOURCE", "SOURCE PAGE", "ALIGN", "TEXT BASELINE", "PADDING",
                                            ].map((label) => (
                                              <th key={label}><RawColumnHeader label={label} /></th>
                                            ))}
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {entityBuilderOcrTableRows.map((row) => (
                                            <tr key={row.id}>
                                              <td>{row.stringKey}</td>
                                              <td>{row.value}</td>
                                              <td>{row.type}</td>
                                              <td>{Number.isFinite(row.x) ? row.x.toFixed(2) : "-"}</td>
                                              <td>{Number.isFinite(row.y) ? row.y.toFixed(2) : "-"}</td>
                                              <td>{Number.isFinite(row.width) ? row.width.toFixed(2) : "-"}</td>
                                              <td>{Number.isFinite(row.height) ? row.height.toFixed(2) : "-"}</td>
                                              <td>{Number.isFinite(row.fontSize) ? row.fontSize.toFixed(2) : "-"}</td>
                                              <td>{row.fontFamily || "-"}</td>
                                              <td>{row.fontWeight || "-"}</td>
                                              <td>{row.fontStyle || "-"}</td>
                                              <td>{row.isHeadingLike ? "true" : "false"}</td>
                                              <td>{row.wrap ? "true" : "false"}</td>
                                              <td>{row.ocrSource || "-"}</td>
                                              <td>{Number.isFinite(row.sourcePage) ? row.sourcePage : "-"}</td>
                                              <td>{row.align || "-"}</td>
                                              <td>{row.baseline || "-"}</td>
                                              <td>{Number.isFinite(row.padding) ? row.padding : "-"}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    ) : "No OCR text with usable coordinates was extracted for this page."}
                                  </div>
                                )}
                                <div
                                  className="pdf_ocr_blank_page_footer"
                                  style={{
                                    gap: `${Math.max(1, 12 * scale)}px`,
                                    padding: `${Math.max(1, OCR_BLANK_FOOTER_PAD_TOP * scale)}px ${Math.max(1, OCR_BLANK_FOOTER_PAD_X * scale)}px ${Math.max(1, OCR_BLANK_FOOTER_PAD_BOTTOM * scale)}px`,
                                    fontSize: `${footerFontSize}px`,
                                    lineHeight: OCR_BLANK_FOOTER_LINE_HEIGHT,
                                  }}
                                >
                                  <span className="pdf_ocr_blank_page_services">{activeBlankPageServices}</span>
                                  <span className="pdf_ocr_blank_page_number">Page {descriptor.page}</span>
                                </div>
                              </>
                            )}
                            <div
                              className="pdf_ocr_blank_page_tabs"
                              style={{
                                top: `${Math.max(1, OCR_BLANK_HEADER_TOP * scale)}px`,
                                left: `${Math.max(1, OCR_BLANK_HEADER_RIGHT * scale)}px`,
                                gap: `${Math.max(1, 6 * scale)}px`,
                              }}
                            >
                              <div className="pdf_ocr_blank_page_primary_tabs">
                                <button
                                  type="button"
                                  className={`pdf_ocr_blank_page_tab${["raw", "visual-raw"].includes(entityBuilderBlankPageMode) ? " pdf_ocr_blank_page_tab--active" : ""}`}
                                  style={{ padding: `${Math.max(1, OCR_BLANK_HEADER_PAD_Y * scale)}px ${Math.max(1, OCR_BLANK_HEADER_PAD_X * scale)}px`, fontSize: `${headerFontSize}px` }}
                                  onClick={() => setEntityBuilderBlankPageMode("raw")}
                                >
                                  ORIGINAL TEXT
                                </button>
                                <button
                                  type="button"
                                  className={`pdf_ocr_blank_page_tab${["tesseract", "tesseract-visual"].includes(entityBuilderBlankPageMode) ? " pdf_ocr_blank_page_tab--active" : ""}`}
                                  style={{ padding: `${Math.max(1, OCR_BLANK_HEADER_PAD_Y * scale)}px ${Math.max(1, OCR_BLANK_HEADER_PAD_X * scale)}px`, fontSize: `${headerFontSize}px` }}
                                  onClick={() => setEntityBuilderBlankPageMode("tesseract")}
                                >
                                  OCR
                                </button>
                              </div>
                              {["raw", "visual-raw"].includes(entityBuilderBlankPageMode) && (
                                <div className="pdf_ocr_blank_page_subtabs">
                                  {[['raw', 'TABLE'], ['visual-raw', 'VISUAL']].map(([mode, label]) => (
                                    <button key={mode} type="button" className={`pdf_ocr_blank_page_tab${entityBuilderBlankPageMode === mode ? " pdf_ocr_blank_page_tab--active" : ""}`} style={{ padding: `${Math.max(1, OCR_BLANK_HEADER_PAD_Y * scale)}px ${Math.max(1, OCR_BLANK_HEADER_PAD_X * scale)}px`, fontSize: `${headerFontSize}px` }} onClick={() => setEntityBuilderBlankPageMode(mode)}>
                                      {label}
                                    </button>
                                  ))}
                                </div>
                              )}
                                {["tesseract", "tesseract-visual"].includes(entityBuilderBlankPageMode) && (
                                <div className="pdf_ocr_blank_page_subtabs">
                                  <span className="pdf_ocr_blank_page_tab pdf_ocr_blank_page_tab--active">TESSERACT</span>
                                  {[['table', 'TABLE'], ['visual', 'VISUAL']].map(([view, label]) => (
                                    <button key={view} type="button" className={`pdf_ocr_blank_page_tab${activeOcrView === view ? " pdf_ocr_blank_page_tab--active" : ""}`} style={{ padding: `${Math.max(1, OCR_BLANK_HEADER_PAD_Y * scale)}px ${Math.max(1, OCR_BLANK_HEADER_PAD_X * scale)}px`, fontSize: `${headerFontSize}px` }} onClick={() => setEntityBuilderBlankPageMode(view === "visual" ? "tesseract-visual" : "tesseract")}>
                                      {label}
                                    </button>
                                  ))}
                                </div>
                                )}
                            </div>
                          </div>
                        );
                      })()
                    )}
                    {descriptor.kind === "pdf" && readingMode === "single" && pageNum === descriptor.page && pageCount > 1 && blankInsertedPages.has(descriptor.page) && (
                      <button
                        type="button"
                        id="pdf_delete_page_btn"
                        onClick={deletePageAtCurrent}
                        disabled={deletingPage}
                        title="Delete this blank page"
                      >
                        {deletingPage ? <i className="bx bx-loader-alt bx-spin" /> : <DeletePageIcon />}
                      </button>
                    )}
                    {descriptor.kind === "pdf" && pageNum === descriptor.page && (
                      <>
                      <canvas
                        id="pdf_annot_canvas"
                        ref={setAnnotCanvasNode}
                        style={{ pointerEvents: toolActive ? "auto" : "none", cursor: annotTool === "eraser" ? "none" : toolActive ? "crosshair" : "default" }}
                      />
                      <canvas id="pdf_mask_canvas" ref={setMaskCanvasNode} />
                      <canvas id="pdf_search_canvas" ref={searchCanvasRef} />
                      <canvas id="pdf_hyle_canvas" ref={hyleCanvasRef} />
                      {hyleMode === "segmented" && hyleLayerData?.mode === "segmented" && hyleLayerData.pageNum === pageNum && pageViewport && (
                        <div
                          id="pdf_hyle_icons_layer"
                          ref={hyleIconsLayerRef}
                          style={{ width: pageViewport.width, height: pageViewport.height }}
                        >
                          {hyleIconPositions.map(({ index, x, y, size }) => (
                            <button
                              key={index}
                              type="button"
                              className={`pdf_hyle_info_icon${hyleActiveSegment === index ? " pdf_hyle_info_icon--active" : ""}`}
                              style={{
                                left: x, top: y,
                                width: size, height: size,
                                fontSize: size * 0.55,
                              }}
                              onClick={() => setHyleActiveSegment((prev) => (prev === index ? null : index))}
                              title={`Line ${index + 1} details`}
                            >
                              {index + 1}
                            </button>
                          ))}
                          {hyleActiveSegment !== null && hyleLayerData.segments[hyleActiveSegment] && (() => {
                            const seg = hyleLayerData.segments[hyleActiveSegment];
                            const iconPos = hyleIconPositions.find((p) => p.index === hyleActiveSegment);
                            if (!iconPos) return null;
                            return (
                              <div
                                id="pdf_hyle_line_popover"
                                style={{ left: iconPos.x, top: iconPos.y }}
                              >
                                <div id="pdf_hyle_line_popover_head">
                                  <span>Line {hyleActiveSegment + 1}</span>
                                  <span className="pdf_hyle_seg_count">{seg.wordCount} word{seg.wordCount !== 1 ? "s" : ""}</span>
                                  <span className="pdf_hyle_seg_count">{seg.charCount} char{seg.charCount !== 1 ? "s" : ""}</span>
                                  <button type="button" onClick={() => setHyleActiveSegment(null)} title="Close">
                                    <i className="bx bx-x" />
                                  </button>
                                </div>
                                {seg.words.length > 0 && (
                                  <div className="pdf_hyle_seg_words">
                                    {seg.words.map((w, wi) => (
                                      <span className="pdf_hyle_word" key={wi}>
                                        {w.text}<sup>{w.chars}</sup>
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      )}
                      {pageViewport && managedBboxes.length > 0 && pageContainerRefs.current[pageNum - 1] && createPortal(
                        <div
                          className="pdf_bbox_delete_layer"
                          ref={bboxOverlayRef}
                          style={{
                            position: "absolute",
                            left: 0,
                            top: 0,
                            width: annotCanvasRef.current?.getBoundingClientRect?.().width || pageViewport.width,
                            height: annotCanvasRef.current?.getBoundingClientRect?.().height || pageViewport.height,
                            transform: "none",
                            zIndex: 1000,
                          }}
                          data-overlay-tick={bboxOverlayTick}
                        >
                          {(() => {
                            return managedBboxes.map((bbox) => {
                              const viewBBox = bboxResizePreview?.id === bbox.id
                                ? { ...bbox, ...bboxResizePreview }
                                : bbox;
                              const scale = pageViewport.scale || (fitScaleRef.current * zoomRef.current);
                              const bboxTypeLabel = BBOX_TYPE_ABBREVIATIONS[viewBBox.type]
                                || getBBoxTypeDefinition(viewBBox.type)?.label?.replace(/\s+BBox$/i, "");
                              const canvasRect = annotCanvasRef.current?.getBoundingClientRect?.();
                              const canvasScaleX = canvasRect?.width && pageViewport.width
                                ? canvasRect.width / pageViewport.width
                                : 1;
                              const canvasScaleY = canvasRect?.height && pageViewport.height
                                ? canvasRect.height / pageViewport.height
                                : canvasScaleX;
                              const pageLeft = canvasRect?.left || 0;
                              const pageTop = canvasRect?.top || 0;
                              const boxLeft = pageLeft + viewBBox.x * scale * canvasScaleX;
                              const boxTop = pageTop + viewBBox.y * scale * canvasScaleY;
                              const overlayScale = scale * canvasScaleX;
                              const basePageScale = Math.max(0.001, fitScaleRef.current || 1);
                              const uiScale = scale / basePageScale;
                              const actionGap = 0;
                              const actionChrome = 2 * uiScale;
                              const actionSize = 8 * uiScale;
                              const actionHeight = actionSize + actionChrome;
                              const resolvedAction = bboxActionPositions[bbox.id];
                              const bboxLocalLeft = boxLeft - pageLeft;
                              const bboxLocalTop = boxTop - pageTop;
                              const bboxLocalWidth = viewBBox.w * overlayScale;
                              const localActionTop = resolvedAction?.offsetY ?? 0;
                              const isEditing = bboxResizeTargetId === bbox.id;
                              const isMinibarOpen = bboxMinibarOpenId === bbox.id;
                              const borderHandles = isEditing ? sampleClosedOutlineHandles(viewBBox) : [];
                              // Handles are rendered inside the page layer,
                              // which is temporarily scaled during preview.
                              // Keep their settled size fixed and compensate
                              // only for that transient wrapper transform.
                              const handleSize = 8 * uiScale;
                              return (
                                <React.Fragment key={bbox.id}>
                                  {bboxTypeLabel && (
                                    <span
                                      className="pdf_bbox_type_label"
                                      ref={(element) => {
                                        if (element) bboxLabelRefs.current[bbox.id] = element;
                                        else delete bboxLabelRefs.current[bbox.id];
                                      }}
                                      style={{
                                        left: bboxLocalLeft,
                                        top: bboxLocalTop,
                                        width: "max-content",
                                        minWidth: 0,
                                        height: "max-content",
                                        minHeight: 0,
                                        padding: `0 ${0.5 * uiScale}px`,
                                        fontSize: `${4 * uiScale}px`,
                                        lineHeight: 1,
                                        transform: "translateY(-100%)",
                                        writingMode: "horizontal-tb",
                                        textOrientation: "mixed",
                                        whiteSpace: "nowrap",
                                        color: bbox.color || "#334155",
                                        borderColor: bbox.color || "#334155",
                                        pointerEvents: "auto",
                                        cursor: "pointer",
                                      }}
                                      role="button"
                                      tabIndex={0}
                                      title={getBBoxTypeDefinition(bbox.type)?.label || bbox.type}
                                      aria-expanded={isMinibarOpen}
                                      onClick={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        setBBoxMinibarOpenId((current) => current === bbox.id ? null : bbox.id);
                                      }}
                                      onKeyDown={(event) => {
                                        if (event.key !== "Enter" && event.key !== " ") return;
                                        event.preventDefault();
                                        event.stopPropagation();
                                        setBBoxMinibarOpenId((current) => current === bbox.id ? null : bbox.id);
                                      }}
                                    >
                                      {bboxTypeLabel}
                                    </span>
                                  )}
                                  {isMinibarOpen && (
                                    <div
                                      className="pdf_bbox"
                                      style={{
                                        left: bboxLocalLeft,
                                        top: bboxLocalTop,
                                        width: bboxLocalWidth,
                                        height: viewBBox.h * overlayScale,
                                      }}
                                    >
                                      <div
                                        className="pdf_bbox_minibar_anchor"
                                        style={{ left: bboxLocalWidth, top: localActionTop }}
                                      >
                                        <div
                                          className="pdf_bbox_action_stack"
                                          ref={(element) => {
                                            if (element) bboxActionRefs.current[bbox.id] = element;
                                            else delete bboxActionRefs.current[bbox.id];
                                          }}
                                          style={{
                                            right: 0,
                                            top: 0,
                                            height: `${actionHeight}px`,
                                            minHeight: `${actionHeight}px`,
                                            padding: 0,
                                            gap: `${actionGap}px`,
                                            transform: "none",
                                          }}
                                        >
                                    <button
                                      type="button"
                                      className={`pdf_bbox_action_btn${isEditing ? " pdf_bbox_action_btn--active" : ""}`}
                                      style={{ width: `${actionSize}px`, height: `${actionSize}px`, minWidth: `${actionSize}px`, minHeight: `${actionSize}px`, fontSize: `${6 * uiScale}px`, transform: "none" }}
                                      title="Manual resize"
                                      aria-label="Manual resize"
                                      onMouseDown={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                      }}
                                      onTouchStart={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                      }}
                                      onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        setBBoxActionMenu(null);
                                        setBBoxResizeTargetId((prev) => (prev === bbox.id ? null : bbox.id));
                                      }}
                                    >
                                      <i className="bx bx-edit-alt" aria-hidden="true" />
                                    </button>
                                    <button
                                      type="button"
                                      className="pdf_bbox_delete_btn"
                                      style={{ width: `${actionSize}px`, height: `${actionSize}px`, minWidth: `${actionSize}px`, minHeight: `${actionSize}px`, fontSize: `${6 * uiScale}px`, transform: "none" }}
                                      title={`Delete ${bbox.title?.trim() || "BBox"}`}
                                      aria-label={`Delete ${bbox.title?.trim() || "BBox"}`}
                                      onMouseDown={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                      }}
                                      onTouchStart={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                      }}
                                      onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        deleteBBox(bbox.id);
                                      }}
                                    >
                                      <i className="bx bx-trash" aria-hidden="true" />
                                    </button>
                                        </div>
                                      </div>
                                    </div>
                                  )}
                                  {borderHandles.map((handle, handleIndex) => (
                                    <button
                                      key={`${bbox.id}-border-${handleIndex}`}
                                      type="button"
                                      className="pdf_bbox_resize_handle"
                                      style={{
                                        left: handle.x * overlayScale,
                                        top: handle.y * overlayScale,
                                        width: handleSize,
                                        height: handleSize,
                                        marginLeft: -(handleSize / 2),
                                        marginTop: -(handleSize / 2),
                                        cursor: handle.cursor || "grab",
                                      }}
                                      onPointerDown={(e) => beginBBoxResize(bbox, handle, e)}
                                      title={`Drag ${handle.side || "side"} border to resize`}
                                      aria-label={`Drag ${handle.side || "side"} border to resize`}
                                    />
                                  ))}
                                </React.Fragment>
                              );
                            });
                          })()}
                        </div>
                        , pageContainerRefs.current[pageNum - 1], "pdf-bbox-overlay"
                      )}
                      {semanticDetectionPreview?.regions?.length > 0 && pageViewport && pageContainerRefs.current[pageNum - 1] && createPortal(
                        <div
                          className="pdf_semantic_preview_layer"
                          style={{ width: annotCanvasRef.current?.getBoundingClientRect?.().width || pageViewport.width, height: annotCanvasRef.current?.getBoundingClientRect?.().height || pageViewport.height }}
                        >
                          {semanticDetectionPreview.regions.map((region, index) => {
                            let box;
                            try { box = unionCandidateBoxes(region.candidateIds, semanticDetectionPreview.candidateById); } catch { return null; }
                            const canvasRect = annotCanvasRef.current?.getBoundingClientRect?.();
                            const scale = pageViewport.scale || (fitScaleRef.current * zoomRef.current);
                            const canvasScaleX = canvasRect?.width && pageViewport.width ? canvasRect.width / pageViewport.width : 1;
                            const canvasScaleY = canvasRect?.height && pageViewport.height ? canvasRect.height / pageViewport.height : canvasScaleX;
                            const left = box.x * scale * canvasScaleX;
                            const top = box.y * scale * canvasScaleY;
                            const width = box.w * scale * canvasScaleX;
                            const height = box.h * scale * canvasScaleY;
                            const label = SEMANTIC_TYPE_ABBREVIATIONS[region.type] || String(region.type || "unknown").replaceAll("_", " ");
                            return (
                              <div
                                className="pdf_semantic_preview_bbox"
                                key={region.id || index}
                                style={{ left, top, width, height }}
                              >
                                <span className="pdf_semantic_preview_label" title={String(region.type || "unknown").replaceAll("_", " ")}>{label}</span>
                                <div className="pdf_semantic_preview_minibar" aria-label={`${label} proposal actions`}>
                                  <button type="button" title="Accept proposed region" aria-label="Accept proposed region" onClick={(event) => { event.stopPropagation(); applySemanticDetection([region]); }}>
                                    <i className="bx bx-check" aria-hidden="true" />
                                  </button>
                                  <button type="button" title="Reject proposed region" aria-label="Reject proposed region" onClick={(event) => { event.stopPropagation(); setSemanticDetectionPreview((current) => { if (!current) return null; const remaining = current.regions.filter((_, itemIndex) => itemIndex !== index); return remaining.length ? { ...current, regions: remaining } : null; }); }}>
                                    <i className="bx bx-x" aria-hidden="true" />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>,
                        pageContainerRefs.current[pageNum - 1],
                        "pdf-semantic-preview-overlay",
                      )}
                      {entityBuilderEmptyAreaHighlightsOpen && entityBuilderEmptyAreaRects.length > 0 && pageViewport && pageContainerRefs.current[pageNum - 1] && createPortal(
                        <div
                          className="pdf_empty_area_overlay"
                          style={{
                            width: annotCanvasRef.current?.getBoundingClientRect?.().width || pageViewport.width,
                            height: annotCanvasRef.current?.getBoundingClientRect?.().height || pageViewport.height,
                          }}
                        >
                          {(() => {
                            const canvasRect = annotCanvasRef.current?.getBoundingClientRect?.();
                            const canvasScaleX = canvasRect?.width && pageViewport.width ? canvasRect.width / pageViewport.width : 1;
                            const canvasScaleY = canvasRect?.height && pageViewport.height ? canvasRect.height / pageViewport.height : canvasScaleX;
                            const baseWidth = Number(entityBuilderRawBlankPageMeta?.pageWidth) || pageViewport.width || 1;
                            const baseHeight = Number(entityBuilderRawBlankPageMeta?.pageHeight) || pageViewport.height || 1;
                            const xScale = (pageViewport.width * canvasScaleX) / baseWidth;
                            const yScale = (pageViewport.height * canvasScaleY) / baseHeight;
                            return entityBuilderEmptyAreaRects.map((rect, index) => (
                              <div
                                key={`empty-area-${index}`}
                                className="pdf_empty_area_rect"
                                style={{
                                  left: rect.x * xScale,
                                  top: rect.y * yScale,
                                  width: rect.w * xScale,
                                  height: rect.h * yScale,
                                }}
                              />
                            ));
                          })()}
                        </div>,
                        pageContainerRefs.current[pageNum - 1],
                        "pdf-empty-area-overlay",
                      )}
                      {createPortal(
                        <div ref={eraserCursorRef} className="eraser_cursor_circle" />,
                        document.body,
                      )}
                      {annotTextInput && (
                        <div
                          className="annot_text_input_wrap"
                          style={{
                            left: annotTextInput.vx - annotCanvasRef.current?.getBoundingClientRect().left,
                            top: annotTextInput.vy - annotCanvasRef.current?.getBoundingClientRect().top,
                          }}
                        >
                          <input
                            id="annot_text_input"
                            ref={annotTextInputRef}
                            autoFocus
                            value={annotTextVal}
                            spellCheck
                            autoCorrect="on"
                            autoCapitalize="sentences"
                            inputMode="none"
                            onChange={(e) => setAnnotTextVal(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") commitAnnotText(); if (e.key === "Escape") setAnnotTextInput(null); }}
                            // Clicking elsewhere (toolbar controls, the
                            // resize handle, the page itself) blurs the
                            // input — only auto-close then if there's
                            // nothing worth keeping. With text typed, stay
                            // mounted and wait for an explicit confirm/
                            // cancel/Enter/Escape instead of silently
                            // discarding or committing on a stray blur.
                            onBlur={() => { if (!annotTextVal.trim()) setAnnotTextInput(null); }}
                            style={{
                              width: annotTextInput.width || undefined,
                              height: annotTextInput.height || undefined,
                              fontFamily: textFontFamily,
                              // Match the page's current render scale so the
                              // editor text stays proportional to the PDF at
                              // every zoom level instead of looking oversized
                              // when the page is zoomed out.
                              fontSize: `${textFontSize * (pageViewport?.scale || (fitScaleRef.current * zoomRef.current))}px`,
                              fontWeight: textBold ? 700 : 400,
                              fontStyle: textItalic ? "italic" : "normal",
                              textDecoration: textUnderline ? "underline" : "none",
                              textAlign,
                              // Dashed marks this as the live preview box,
                              // not the final annotation.
                              border: "1px dashed var(--color-border)",
                              // Same fill annotationDraw.js uses for the
                              // committed annotation (see the "text" case) —
                              // a low-alpha wash of the background swatch's
                              // own color, not a solid block, so typed text
                              // stays readable on top of it.
                              background: textBackground ? `${textBackgroundColor}40` : undefined,
                            }}
                          />
                          {TEXT_RESIZE_HANDLES.map(({ dir, cursor }) => (
                            <div
                              key={dir}
                              className={`annot_text_input_resize_handle annot_text_input_resize_handle--${dir}`}
                              style={{ cursor }}
                              onPointerDown={(e) => beginTextInputResize(dir, e)}
                              title="Drag to resize"
                            />
                          ))}
                          <div className="annot_text_input_actions">
                            <button
                              type="button"
                              className="annot_text_confirm_btn"
                              // preventDefault on mousedown keeps the input
                              // focused (no blur), so a stray click on this
                              // button can never race the input's own
                              // onBlur/outside-click handling.
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={commitAnnotText}
                              title="Confirm"
                              aria-label="Confirm text"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M9 15.59 4.71 11.3 3.3 12.71l5 5c.2.2.45.29.71.29s.51-.1.71-.29l11-11-1.41-1.41L9.02 15.59Z" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              className="annot_text_cancel_btn"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => setAnnotTextInput(null)}
                              title="Cancel"
                              aria-label="Cancel"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path d="m7.76 14.83-2.83 2.83 1.41 1.41 2.83-2.83 2.12-2.12.71-.71.71.71 1.41 1.42 3.54 3.53 1.41-1.41-3.53-3.54-1.42-1.41-.71-.71 5.66-5.66-1.41-1.41L12 10.59 6.34 4.93 4.93 6.34 10.59 12l-.71.71z" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      )}
                      {textActionMenu && createPortal(
                        // Portalled + position:fixed + z-index above the
                        // site-wide #app_footer (position:fixed,
                        // z-index:950). In-tree with a local z-index, this menu's clicks
                        // were silently eaten by the footer whenever it
                        // rendered in whatever screen region the footer
                        // physically covers (elementsFromPoint confirmed
                        // it, not visible in a screenshot) — the button's
                        // own onClick works fine when invoked directly,
                        // which is what made it look like a logic bug.
                        <div
                          ref={textActionMenuRef}
                          className="annot_text_action_menu"
                          style={{
                            position: "fixed",
                            left: textActionMenu.vx,
                            top: Math.max(8, textActionMenu.vy - 46),
                          }}
                        >
                          <button type="button" className="annot_text_action_btn" onClick={() => handleTextAction("edit-text")}>Edit text</button>
                          <span className="annot_text_action_sep" aria-hidden="true" />
                          <button type="button" className="annot_text_action_btn" onClick={() => handleTextAction("edit-style")}>Edit Style</button>
                          <span className="annot_text_action_sep" aria-hidden="true" />
                          <button type="button" className="annot_text_action_btn annot_text_action_btn--danger" onClick={() => handleTextAction("delete")}>Delete</button>
                        </div>,
                        document.body,
                      )}
                      {highlightActionMenu && createPortal(
                        <div
                          ref={highlightActionMenuRef}
                          className="annot_text_action_menu"
                          style={{
                            position: "fixed",
                            left: highlightActionMenu.vx,
                            top: Math.max(8, highlightActionMenu.vy - 46),
                          }}
                        >
                          <button type="button" className="annot_text_action_btn" onClick={() => handleHighlightAction("edit")}>Edit</button>
                          <span className="annot_text_action_sep" aria-hidden="true" />
                          <button type="button" className="annot_text_action_btn annot_text_action_btn--danger" onClick={() => handleHighlightAction("delete")}>Delete</button>
                        </div>,
                        document.body,
                      )}
                      {smartPenMarkerPopup && createPortal(
                        <div
                          className="pdf_schema_marker_popup"
                          role="dialog"
                          aria-label={smartPenMarkerPopup.kind === "trace" ? "Trace schemata" : "Schema marker"}
                          style={{
                            left: Math.min(
                              Math.max(8, smartPenMarkerPopup.rect.left),
                              Math.max(8, window.innerWidth - 296),
                            ),
                            top: Math.min(
                              Math.max(8, smartPenMarkerPopup.rect.bottom + 8),
                              Math.max(8, window.innerHeight - 276),
                            ),
                          }}
                        >
                          <div className="pdf_schema_marker_popup_header">
                            <span>{smartPenMarkerPopup.kind === "trace" ? `Trace: ${smartPenMarkerPopup.word}` : `Schema: ${smartPenMarkerPopup.word}`}</span>
                            <button type="button" onClick={() => setSmartPenMarkerPopup(null)} aria-label="Close">×</button>
                          </div>
                          {smartPenMarkerPopup.kind === "trace" ? (
                            smartPenMarkerPopup.sources.length ? (
                              <>
                                <div>Trace for:</div>
                                <ul className="pdf_schema_marker_popup_list">
                                  {smartPenMarkerPopup.sources.map((source) => (
                                    <li key={`${source.name}-${source.dimension}`}>
                                      {source.name} <small>({source.dimension} Trace)</small>
                                    </li>
                                  ))}
                                </ul>
                              </>
                            ) : <div>No source Schema found.</div>
                          ) : <div>This word is a saved Schema.</div>}
                        </div>,
                        document.body,
                      )}
                      {smartPenMorphePreview && pageViewport && pageContainerRefs.current[pageNum - 1] && createPortal(
                        <div className="pdf_smart_pen_morphe_preview" role="status" aria-live="polite">
                          <span className="pdf_smart_pen_morphe_preview__live"><i className="bx bx-pulse" /> LIVE MORPHE</span>
                          {smartPenMorphePreview.kind === "schema" ? (
                            <span>Schema: {smartPenMorphePreview.words.join(", ")}</span>
                          ) : (
                            <span>{smartPenMorphePreview.dimension} Trace: {smartPenMorphePreview.source} → {smartPenMorphePreview.targets.join(", ")}</span>
                          )}
                          <small>Lift pen to save</small>
                        </div>,
                        pageContainerRefs.current[pageNum - 1],
                      )}
                      {manualSelection && !manualPopup && onSelectionAction && (
                        <div ref={selBarRef} id="manual_select_bar" style={{ left: manualSelection.x, top: manualSelection.y }}>
                          <span id="msb_text">{manualSelection.text}</span>
                          {onSelectionAction ? (
                            <button id="msb_confirm" className="msb_action_btn" onClick={handleSelectionAction} disabled={selectionActionBusy}>
                              {selectionActionBusy ? "…" : selectionActionLabel}
                            </button>
                          ) : (
                            <button id="msb_confirm" onClick={confirmSelection}>✓</button>
                          )}
                          <button id="msb_cancel"  onClick={() => { setManualSelection(null); setSelectionActionError(""); window.getSelection()?.removeAllRanges(); }}>✕</button>
                          {selectionActionError && <span id="msb_error">{selectionActionError}</span>}
                        </div>
                      )}
                      {schemaTextLayerActive && (
                        <div
                          ref={textLayerRef}
                          className={`pdf_text_layer${textSelectable ? "" : " pdf_text_layer--schema-only"}`}
                          style={pageViewport
                            ? { width: pageViewport.width, height: pageViewport.height }
                            : { inset: 0, position: "absolute" }}
                        />
                      )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            </>
          ) : embedded ? (
            <div id="pdf_source_select_zone">
              {loading ? <p>Loading…</p> : loadError ? (
                <>
                  <span id="pdf_source_empty_icon">⚠️</span>
                  <p id="pdf_source_empty_msg">{loadError}</p>
                  <button
                    id="pdf_pick_btn"
                    type="button"
                    onClick={() => {
                      if (embeddedFile) loadFile(embeddedFile);
                      else loadFromSource(embeddedSourceId, embeddedPdfName || "document.pdf");
                    }}
                  >Retry</button>
                </>
              ) : (
                <>
                  <span id="pdf_source_empty_icon">📄</span>
                  <p id="pdf_source_empty_msg">No document loaded.</p>
                </>
              )}
            </div>
          ) : isNounsPage ? (
            <div id="pdf_source_select_zone">
              {loading ? <p>Loading…</p> : hyleSourcesLoading ? <p>Loading sources…</p> : hyleSources.length === 0 ? (
                <>
                  <span id="pdf_source_empty_icon">📂</span>
                  <p id="pdf_source_empty_msg">No sources yet.</p>
                  <p id="pdf_source_empty_sub">Go to <strong>Hyle Source Organisation</strong> to add PDFs.</p>
                </>
              ) : (
                <>
                  <label id="pdf_source_label" htmlFor="pdf_source_select">Choose Hyle Source</label>
                  <select
                    id="pdf_source_select"
                    defaultValue=""
                    onChange={(e) => {
                      const src = hyleSources.find((s) => s._id === e.target.value);
                      if (src) loadFromSource(src._id, src.name);
                    }}
                  >
                    <option value="" disabled>Select a source…</option>
                    {hyleSources.map((s) => (
                      <option key={s._id} value={s._id}>{s.name}</option>
                    ))}
                  </select>
                </>
              )}
            </div>
          ) : (
            <div
              id="pdf_drop_zone"
              className={dragOver ? "drag_over" : ""}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
            >
              {loading ? <p>Loading PDF…</p> : (
                <>
                  <span style={{ fontSize: "2rem" }}>📄</span>
                  <p>Drop a PDF here or click to select</p>
                  <button id="pdf_pick_btn" type="button">Choose file</button>
                </>
              )}
            </div>
          )}
          <input ref={fileInputRef} type="file" accept="application/pdf" style={{ display: "none" }} onChange={handleInputChange} />
          </div>
          {pdfDoc && !selectionOnly && pdfAssistantOpen && (
            <PDFTextAssistant
              filename={filename}
              currentPage={pageNum}
              loadDocumentPages={loadPdfAssistantPages}
              provider={provider}
              model={aiProviderModels[provider === "manual" ? "groq" : provider] || ""}
              onClose={() => setPdfAssistantOpen(false)}
              sourceId={hasSourceId ? currentSourceIdRef.current : null}
            />
          )}
          {pdfDoc && !selectionOnly && (
            <button
              type="button"
              id="pdf_ai_assistant_fab"
              className={pdfAssistantOpen ? "pdf_ai_assistant_fab--active" : undefined}
              onClick={() => setPdfAssistantOpen((open) => !open)}
              title={pdfAssistantOpen ? "Close PDF Study Avatar" : "Open PDF Study Avatar"}
              aria-label={pdfAssistantOpen ? "Close PDF Study Avatar" : "Open PDF Study Avatar"}
              aria-expanded={pdfAssistantOpen}
            >
              <i className={`bx ${pdfAssistantOpen ? "bx-x" : "bx-robot"}`} aria-hidden="true" />
            </button>
          )}
          {manualSelection && !manualPopup && (
            <div
              id="pdf_selected_text_preview"
              ref={previewRef}
              title={manualSelection.text}
              onMouseDownCapture={(e) => e.stopPropagation()}
              onTouchStartCapture={(e) => e.stopPropagation()}
            >
              <span id="pdf_selected_text_preview_label">Selected text</span>
              <span id="pdf_selected_text_preview_body">{manualSelection.text}</span>
            </div>
          )}
          {pdfDoc && (
            <div id="pdf_hyle_fab_wrap" ref={hyleFabRef}>
              {hyleFabOpen && (
                <div id="pdf_hyle_menu" role="menu" aria-label="Annotation layers">
                  <div className="pdf_hyle_menu_header">
                    <span>Annotation layers</span>
                  </div>
                  <div className="pdf_annotation_layer_tabs" role="tablist" aria-label="Annotation surface">
                    <button type="button" role="tab" aria-selected={annotationLayerTab === "pdf"} className={annotationLayerTab === "pdf" ? "pdf_annotation_layer_tab pdf_annotation_layer_tab--active" : "pdf_annotation_layer_tab"} onClick={() => activateAnnotationSurface("pdf")}>PDF</button>
                    <button type="button" role="tab" aria-selected={annotationLayerTab === "md"} className={annotationLayerTab === "md" ? "pdf_annotation_layer_tab pdf_annotation_layer_tab--active" : "pdf_annotation_layer_tab"} onClick={() => activateAnnotationSurface("md")}>MD</button>
                  </div>
                  {annotationLayerTab === "pdf" ? (
                    <>
                    <div className="pdf_hyle_menu_layers">
                    {annotationLayersForView.map((layer) => (
                      <div
                        key={layer.id}
                        role="menuitemradio"
                        tabIndex={0}
                        aria-checked={activeAnnotationLayer?.id === layer.id}
                        className={activeAnnotationLayer?.id === layer.id ? "pdf_hyle_menu_item pdf_hyle_menu_item--active" : "pdf_hyle_menu_item"}
                        onClick={() => activateAnnotationLayer(layer.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            activateAnnotationLayer(layer.id);
                          }
                        }}
                        title={`Draw on ${layer.name}`}
                      >
                        <span className="pdf_hyle_menu_item_main">
                          <span className="pdf_hyle_menu_item_name">{layer.name}</span>
                          <span className="pdf_hyle_menu_item_meta">
                            {Object.values(layer.annotations || {}).reduce((sum, list) => sum + list.length, 0)} annotations
                          </span>
                        </span>
                        <button
                          type="button"
                          className={`pdf_hyle_menu_eye${layer.visible === false ? " pdf_hyle_menu_eye--off" : ""}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleAnnotationLayerVisibility(layer.id);
                          }}
                          title={layer.visible === false ? "Show layer" : "Hide layer"}
                          aria-label={layer.visible === false ? `Show ${layer.name}` : `Hide ${layer.name}`}
                        >
                          {layer.visible === false ? (
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path d="M3 3l18 18M10.6 10.7a2 2 0 0 0 2.7 2.7M9.9 4.3A10.8 10.8 0 0 1 12 4c5.5 0 9 5.2 9 5.2a13.5 13.5 0 0 1-2.3 2.8M6.2 6.2C4.2 7.5 3 9.2 3 9.2s3.5 5.2 9 5.2c1.2 0 2.3-.2 3.3-.7" />
                            </svg>
                          ) : (
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path d="M3 12s3.5-5.2 9-5.2 9 5.2 9 5.2-3.5 5.2-9 5.2S3 12 3 12Z" />
                              <circle cx="12" cy="12" r="2.5" />
                            </svg>
                          )}
                        </button>
                        <button
                          type="button"
                          className="pdf_hyle_menu_delete"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteAnnotationLayer(layer.id);
                          }}
                          disabled={annotationLayersForView.length <= 1}
                          title={annotationLayersForView.length <= 1 ? "At least one layer is required" : `Delete ${layer.name}`}
                          aria-label={`Delete ${layer.name}`}
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" />
                          </svg>
                        </button>
                        {activeAnnotationLayer?.id === layer.id && <i className="bx bx-check pdf_hyle_menu_check" />}
                      </div>
                    ))}
                    </div>
                    <button type="button" className="pdf_hyle_menu_add" onClick={addAnnotationLayer} title="Create a new empty PDF annotation layer">
                      <i className="bx bx-plus" /> Add PDF layer
                    </button>
                    </>
                  ) : (
                    <div className="pdf_hyle_menu_layers">
                      <div className="pdf_hyle_menu_item pdf_hyle_menu_item--active" aria-label="Markdown annotations">
                        <span className="pdf_hyle_menu_item_main">
                          <span className="pdf_hyle_menu_item_name">Markdown annotations</span>
                          <span className="pdf_hyle_menu_item_meta">{Object.values(markdownAnnotations).reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0)} annotations</span>
                        </span>
                        <i className="bx bx-check pdf_hyle_menu_check" />
                      </div>
                    </div>
                  )}
                </div>
              )}
              <button
                type="button"
                id="pdf_hyle_fab_btn"
                className={hyleFabOpen ? "pdf_hyle_fab_btn--active" : undefined}
                onClick={() => setHyleFabOpen((v) => !v)}
                title="Annotation layers"
              >
                <i className="bx bx-layers" />
              </button>
            </div>
          )}
        </div>

        {markdownModeMenuOpen && markdownModeMenuPosition && createPortal(
          <div
            className="pdf_markdown_mode_menu"
            role="menu"
            aria-label="Markdown mode"
            style={{
              left: markdownModeMenuPosition.left,
              top: markdownModeMenuPosition.top,
              width: markdownModeMenuPosition.width,
              "--md-button-height": `${markdownModeMenuPosition.height}px`,
              "--md-button-radius": markdownModeMenuPosition.radius,
            }}
          >
            <button type="button" role="menuitem" title="MD only" aria-label="MD only" onClick={() => { setReadingMode("single"); setMarkdownRetainedVisualMode(null); setMarkdownAsideMode("visual-only"); setMarkdownModeMenuOpen(false); setMarkdownAsideOpen(true); }}>
              <i className="bx bx-file" aria-hidden="true" />
              <span>MD only</span>
            </button>
            <button type="button" role="menuitem" title="MD with PDF page" aria-label="MD with PDF page" onClick={() => { setReadingMode("single"); setMarkdownRetainedVisualMode(null); setMarkdownAsideMode("visual-raw"); setMarkdownModeMenuOpen(false); setMarkdownAsideOpen(true); }}>
              <i className="bx bx-book-open" aria-hidden="true" />
              <span>MD with PDF page</span>
            </button>
            <button type="button" role="menuitem" title="MD Analyser" aria-label="MD Analyser" onClick={() => { setReadingMode("single"); setMarkdownRetainedVisualMode((current) => markdownAsideMode.includes("visual") ? markdownAsideMode : current); setMarkdownAsideMode("raw"); setMarkdownModeMenuOpen(false); setMarkdownAsideOpen(true); }}>
              <i className="bx bx-table" aria-hidden="true" />
              <span>MD Analyser</span>
            </button>
          </div>,
          document.body,
        )}
        {markdownAsideOpen && (markdownAsideMode.includes("visual") ? canvasWrapRef.current : markdownHost) && createPortal(
          <>
            <div
              className="pdf_markdown_resize_handle"
              onMouseDown={handleMarkdownAsideResizeStart}
              onTouchStart={handleMarkdownAsideResizeStart}
            />
            <div
              id="pdf_markdown_aside"
              className={markdownAsideMode.includes("visual") ? "pdf_markdown_aside--visual-page pdf_markdown_viewer_page" : undefined}
              style={markdownAsideMode.includes("visual")
                ? { display: "contents", width: markdownVisualPageWidth, minWidth: 0 }
                : { width: mdPanelWidth }}
            >
            <div className="pdf_markdown_aside_header">
              <span>MARKDOWN</span>
              <span className="pdf_markdown_aside_page">Page {pageNum}</span>
              <button
                type="button"
                className="pdf_markdown_aside_close"
                onClick={() => { setMarkdownAsideOpen(false); setMarkdownModeMenuOpen(false); }}
                title="Close Markdown analyser"
                aria-label="Close Markdown analyser"
              >
                <i className="bx bx-x" aria-hidden="true" />
              </button>
            </div>
            <div className="pdf_markdown_aside_tabs">
              <div className="pdf_markdown_aside_primary_tabs">
                <button type="button" className={`pdf_markdown_aside_tab${["raw", "visual-raw"].includes(markdownAsideMode) ? " pdf_markdown_aside_tab--active" : ""}`} onClick={() => setMarkdownAsideMode("raw")}>ORIGINAL TEXT</button>
                <button type="button" className={`pdf_markdown_aside_tab${markdownAsideMode === "tree-lines" ? " pdf_markdown_aside_tab--active" : ""}`} onClick={() => setMarkdownAsideMode("tree-lines")}>Tree of Lines</button>
              </div>
              {["raw", "visual-raw"].includes(markdownAsideMode) && (
                <div className="pdf_markdown_aside_secondary_tabs">
                  {[['raw', 'TABLE']].map(([mode, label]) => <button key={mode} type="button" className={`pdf_markdown_aside_tab${markdownAsideMode === mode ? " pdf_markdown_aside_tab--active" : ""}`} onClick={() => setMarkdownAsideMode(mode)}>{label}</button>)}
                </div>
              )}
            </div>
            <div
              className="pdf_markdown_aside_table_scroll"
              style={markdownAsideMode.includes("visual") ? { display: "contents", width: "auto", minWidth: 0 } : undefined}
            >
              {markdownAsideMode === "tree-lines" ? (
                <div className="pdf_markdown_aside_tree_view">
                  <EntityBuilderPanel
                    embedded
                    bboxCards={bboxCardsForBuilder}
                    bboxResizePreview={bboxResizePreview}
                    pageNum={pageNum}
                    isPageFullySegmented={isCurrentPageFullySegmented}
                    onUpdateBBoxName={updateBBoxName}
                    onSetBBoxTitle={setBBoxTitleFromLine}
                    onDeleteBBox={deleteBBox}
                    onMoveBBoxUp={(bboxId) => moveBBoxInGroup(bboxId, -1, pageNum)}
                    onMoveBBoxDown={(bboxId) => moveBBoxInGroup(bboxId, 1, pageNum)}
                    onMergeParagraphs={mergeParagraphBBoxes}
                    onArmBBoxInsideContainer={armBBoxInsideContainer}
                    armedBBoxInsideContainer={bboxContainerBBoxTarget}
                  />
                </div>
              ) : markdownAsideMode === "raw" ? (
                <div className="pdf_markdown_aside_table_view">
                  <div className="pdf_markdown_aside_page_meta" aria-label="Original text page metadata">
                    <span><strong>Page</strong> {pageNum}</span>
                    <span><strong>Dimensions</strong> {entityBuilderRawBlankPageMeta.pageWidth ? entityBuilderRawBlankPageMeta.pageWidth.toFixed(2) : "-"} × {entityBuilderRawBlankPageMeta.pageHeight ? entityBuilderRawBlankPageMeta.pageHeight.toFixed(2) : "-"}</span>
                    <span><strong>Viewport scale</strong> {pageViewport?.scale ? pageViewport.scale.toFixed(4) : (entityBuilderRawBlankPageMeta.viewportScale ? entityBuilderRawBlankPageMeta.viewportScale.toFixed(4) : "-")}</span>
                    <span><strong>Rotation</strong> {Number.isFinite(entityBuilderRawBlankPageMeta.pageRotation) ? `${entityBuilderRawBlankPageMeta.pageRotation}°` : "-"}</span>
                    <span><strong>Media box</strong> {entityBuilderRawBlankPageMeta.mediaBox?.length === 4 ? entityBuilderRawBlankPageMeta.mediaBox.map((value) => Number(value).toFixed(2)).join(" × ") : "-"}</span>
                    <span><strong>PyMuPDF</strong> {pymupdfExtractionBusy ? "loading" : pymupdfPageExtraction?.native ? "ready" : "unavailable"}</span>
                  </div>
                  <div className="pdf_markdown_aside_column_tabs" role="tablist" aria-label="Original text table columns">
                    {markdownAsideColumnGroups.map(([group, label]) => (
                      <button key={group} type="button" role="tab" aria-selected={markdownAsideColumnGroup === group} className={`pdf_markdown_aside_tab${markdownAsideColumnGroup === group ? " pdf_markdown_aside_tab--active" : ""}`} onClick={() => setMarkdownAsideColumnGroup(group)}>{label}</button>
                    ))}
                  </div>
                  <div className="pdf_markdown_aside_table_data_scroll">
                    <table className={`pdf_markdown_aside_table${markdownAsideColumnGroup === "blocks" ? " pdf_markdown_aside_table--blocks" : " pdf_markdown_aside_table--raw"}`}>
                      {markdownAsideColumnGroup === "blocks" ? (
                        <thead>
                          <tr>
                            {markdownAsideRawColumns.blocks.map(([label]) => <th key={label}><RawColumnHeader label={label} /></th>)}
                          </tr>
                        </thead>
                      ) : (
                        <thead>
                          <tr>
                            <th colSpan="2"><RawColumnHeader label="INSTANCE" /></th>
                            {markdownAsideRawColumns[markdownAsideColumnGroup].slice(2).map(([label]) => <th key={label} rowSpan="2"><RawColumnHeader label={label} /></th>)}
                          </tr>
                          <tr>
                            <th><RawColumnHeader label="#" /></th>
                            <th><RawColumnHeader label="VALUE" /></th>
                          </tr>
                        </thead>
                      )}
                      <tbody>{(markdownAsideColumnGroup === "blocks" ? entityBuilderRawBlockTableRows : entityBuilderFilteredRawRows).map((row) => <tr key={row.id} className={row.omitted ? "pdf_markdown_aside_table_row--omitted" : undefined}>{markdownAsideRawColumns[markdownAsideColumnGroup].map(([label, value]) => {
                        const yColor = markdownAsideColumnGroup === "position" && label === "VALUE" && Number.isFinite(row.ty)
                          ? entityBuilderRawYColors.get(Number(row.ty).toFixed(2))
                          : undefined;
                        const lineCellStyle = markdownAsideColumnGroup === "blocks" && ["LINE REFERENCES", "STRING REFERENCES"].includes(label)
                          ? { whiteSpace: "normal", overflowWrap: "anywhere", wordBreak: "break-word", minWidth: label === "LINE REFERENCES" ? "12rem" : "18rem" }
                          : undefined;
                        return <td key={label} className={["VALUE", "CODEPOINTS"].includes(label) ? "pdf_ocr_wrap_cell" : undefined} style={{ ...(lineCellStyle || {}), ...(yColor ? { backgroundColor: yColor } : {}) }}>
                          {label === "VALUE" ? <button type="button" className="pdf_ocr_blank_raw_value_link" style={yColor ? { color: "#1f2937" } : undefined} onClick={() => focusOriginalTextValue(row)}>{value(row)}</button>
                            : label === "OMISSION" ? (
                              <label className="pdf_ocr_raw_omission_control">
                                <input type="checkbox" checked={entityBuilderOmittedRawCategories.has(getUnicodeOmissionLabel(row.value))} onChange={() => toggleRawCategoryOmission(getUnicodeOmissionLabel(row.value))} />
                                <span>{value(row)}</span>
                              </label>
                            ) : value(row)}
                        </td>;
                      })}</tr>)}</tbody>
                    </table>
                  </div>
                </div>
              ) : markdownAsideMode.includes("visual") ? renderOriginalMarkdownVisualPage() : null}
            </div>
            </div>
          </>,
          markdownAsideMode.includes("visual") ? canvasWrapRef.current : markdownHost,
        )}
        {markdownAsideOpen
          && markdownRetainedVisualMode
          && !markdownAsideMode.includes("visual")
          && canvasWrapRef.current
          && createPortal(
            <div
              id="pdf_markdown_retained_viewer"
              className="pdf_markdown_aside--visual-page pdf_markdown_viewer_page"
              style={{ width: markdownVisualPageWidth }}
            >
              <div className="pdf_markdown_aside_table_scroll">
                {renderOriginalMarkdownVisualPage()}
              </div>
            </div>,
            canvasWrapRef.current,
          )}

        {/* Resize handle */}
        {splitRatio < 0.9 && splitRatio > 0 && (
          <div id="pdf_resize_handle" onMouseDown={handleResizeStart} onTouchStart={handleResizeStart} />
        )}

        {/* Right — Noun panel */}
        <div id="pdf_hyles_panel" style={{ display: splitRatio >= 0.9 ? "none" : undefined }}>

          <div id="pdf_hyles_panel_header">
            <button
              id="pdf_preview_toggle"
              onClick={togglePreview}
              title={splitRatio === 0 ? "Show PDF viewer" : "Hide PDF viewer"}
            >
              {splitRatio === 0 ? "›" : "‹"}
            </button>
            <span style={{ flex: 1 }}>
              {hylePage ? `Page ${hylePage} Hyles` : "Hyles"}
              {hyleData?._total > 0 && (
                <span style={{ fontWeight: 400, marginLeft: "0.5rem", color: "var(--color-text-muted)" }}>
                  ({hyleData._total} found)
                </span>
              )}
            </span>

            <div className="hyle_font_controls">
              <button className="hyle_font_btn" onClick={() => setHyleFontSize((s) => Math.max(0.5, +(s - 0.05).toFixed(2)))} disabled={hyleFontSize <= 0.5}>−</button>
              <span className="hyle_font_label">{Math.round(hyleFontSize * 100)}%</span>
              <button className="hyle_font_btn" onClick={() => setHyleFontSize((s) => Math.min(1.6, +(s + 0.05).toFixed(2)))} disabled={hyleFontSize >= 1.6}>+</button>
            </div>

            <button
              id="hyle_type_toggle_btn"
              className={typeTreeOpen ? "hyle_type_toggle_btn--open" : ""}
              onClick={() => setTypeTreeOpen((o) => !o)}
              title="Extraction type"
            >
              {extractionType ? HYLE_TYPE_LABELS[extractionType] : "Type"}
            </button>
          </div>

          {typeTreeOpen && (
            <div id="hyle_type_panel">
              {HYLE_TYPE_TREE.map((node) => renderTypeNode(node))}
            </div>
          )}

          {isNounsPage && (
            <div id="hyle_card_tabs">
              {CARDS.map(({ key, label }) => (
                <button
                  key={key}
                  className={`hyle_card_tab${activeCard === key ? " hyle_card_tab--active" : ""}`}
                  onClick={() => setLocalCard(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {!extracting && extractError && (
            <div id="pdf_hyles_error">
              <span>⚠ {extractError}</span>
              {pdfDoc && extractMode === "ai" && <button onClick={handleExtract}>Retry</button>}
            </div>
          )}

          <div id="pdf_hyles_body">
            <div id="pdf_hyles_table_area">
              <HyleCards
                data={hyleData || EMPTY_HYLES()}
                streaming={extracting}
                onStatus={handleHyleStatus}
                onMove={handleHyleMove}
                onDelete={handleHyleDelete}
                activeCard={activeCard}
                fontSize={hyleFontSize}
              />
            </div>

            {history.length > 0 && (
              <div id="pdf_history">
                <div id="pdf_history_label">
                  {historyLoading ? "Loading…" : "Sessions"}
                </div>
                <div id="pdf_history_scroll">
                  {history.map((item) => (
                    <div
                      key={item._id}
                      className={`phi_row${activeHistoryId === item._id ? " phi_row--active" : ""}`}
                      onClick={() => loadHistoryItem(item._id)}
                    >
                      <div className="phi_td_name">{item.documentId?.filename || "—"}</div>
                      <div className="phi_td_meta">p.{item.pageNumber} · {item.totalNouns} nouns · {item.provider}</div>
                      <div className="phi_td_del">
                        <button
                          className="phi_delete_btn"
                          onClick={(e) => handleDeleteExtraction(e, item._id)}
                          title="Delete"
                        >✕</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

        </div>
      </div>
      {showFooterSelection && (
        <div
          id="manual_popup_footer"
          onKeyDown={(e) => {
            if (e.key === "Enter" && manualPopup) handleManualAdd();
            if (e.key === "Escape") {
              setManualPopup(null);
              setManualSelection(null);
              window.getSelection()?.removeAllRanges();
            }
          }}
        >
          <div id="manual_popup">
            <div id="manual_popup_head">
              <span>{manualPopup ? "Selected Hyle" : "Selected Text"}</span>
            </div>
            {manualPopup ? (
              <>
                <input
                  id="manual_noun_input"
                  value={manualHyle}
                  onChange={(e) => setManualHyle(e.target.value)}
                  placeholder="Hyle"
                  autoFocus
                />
                <div id="manual_selects">
                  <select value={manualCard} onChange={(e) => setManualCard(e.target.value)}>
                    {CARDS.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}
                  </select>
                  <select value={manualMode} onChange={(e) => setManualMode(e.target.value)}>
                    {ALL_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </>
            ) : (
              <div id="manual_footer_editor">
                <textarea
                  id="manual_footer_text"
                  value={footerSelectionText}
                  onChange={(e) => setManualSelection((sel) => sel ? { ...sel, text: e.target.value } : sel)}
                  rows={2}
                />
              </div>
            )}
            <div id="manual_actions">
              {manualPopup ? (
                <button id="manual_add_btn" onClick={handleManualAdd}>Add</button>
              ) : (
                <button id="manual_add_btn" onClick={() => { setManualSelection(null); window.getSelection()?.removeAllRanges(); }}>Done</button>
              )}
              <button id="manual_cancel_btn" onClick={() => { setManualPopup(null); setManualSelection(null); window.getSelection()?.removeAllRanges(); }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      {semanticDetectionDialogOpen && (
        <div className="pdf_semantic_detection_modal" role="dialog" aria-modal="true" aria-labelledby="pdf_semantic_detection_title">
          <div className="pdf_semantic_detection_card">
            <div className="pdf_semantic_detection_header">
              <div>
                <strong id="pdf_semantic_detection_title">Semantic Document Detection</strong>
                <span>Classify this document using candidate geometry and OpenAI.</span>
              </div>
              <button type="button" onClick={() => setSemanticDetectionDialogOpen(false)} aria-label="Close">×</button>
            </div>
            <label className="pdf_semantic_detection_scope">
              <span>Scope</span>
              <select value={semanticDetectionScope} onChange={(event) => setSemanticDetectionScope(event.target.value)}>
                <option value={SEMANTIC_DETECTION_SCOPE.CURRENT_PAGE}>Current page</option>
                <option value={SEMANTIC_DETECTION_SCOPE.VISIBLE_PAGES} disabled>Visible pages (coming next)</option>
                <option value={SEMANTIC_DETECTION_SCOPE.PAGE_RANGE} disabled>Page range (coming next)</option>
                <option value={SEMANTIC_DETECTION_SCOPE.ENTIRE_DOCUMENT} disabled>Entire document (coming next)</option>
              </select>
            </label>
            <div className="pdf_semantic_detection_actions">
              <button type="button" onClick={() => setSemanticDetectionDialogOpen(false)}>Cancel</button>
              <button type="button" className="pdf_semantic_detection_primary" onClick={runSemanticDetection}>Analyze</button>
            </div>
          </div>
        </div>
      )}
      {semanticDetectionPreview && (
        <div className="pdf_semantic_detection_modal" role="dialog" aria-modal="true" aria-labelledby="pdf_semantic_review_title">
          <div className="pdf_semantic_detection_card pdf_semantic_detection_card--review">
            <div className="pdf_semantic_detection_header">
              <div>
                <strong id="pdf_semantic_review_title">Semantic detection complete</strong>
                <span>{semanticDetectionPreview.regions.length} proposed regions · {semanticDetectionPreview.model}</span>
              </div>
              <button type="button" onClick={() => setSemanticDetectionPreview(null)} aria-label="Discard">×</button>
            </div>
            <div className="pdf_semantic_detection_results">
              {semanticDetectionPreview.regions.map((region, index) => (
                <div className="pdf_semantic_detection_result" key={region.id || index}>
                  <select
                    value={region.type}
                    onChange={(event) => setSemanticDetectionPreview((current) => ({
                      ...current,
                      regions: current.regions.map((item, itemIndex) => itemIndex === index ? { ...item, type: event.target.value } : item),
                    }))}
                  >
                    {[
                      "chapter_title", "section_title", "subsection_title", "paragraph_title", "body_paragraph",
                      "figure", "figure_caption", "table", "table_caption", "table_of_contents", "list", "equation", "header", "footer", "page_number", "unknown",
                    ].map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}
                  </select>
                  <span>{Math.round(Number(region.confidence || 0) * 100)}%</span>
                  <button type="button" onClick={() => setSemanticDetectionPreview((current) => ({ ...current, regions: current.regions.filter((_, itemIndex) => itemIndex !== index) }))}>Reject</button>
                </div>
              ))}
            </div>
            <div className="pdf_semantic_detection_actions">
              <button type="button" onClick={() => setSemanticDetectionPreview(null)}>Discard</button>
              <button type="button" className="pdf_semantic_detection_primary" onClick={applySemanticDetection}>Apply</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

PDFPage.displayName = "PDFPage";

export default PDFPage;
