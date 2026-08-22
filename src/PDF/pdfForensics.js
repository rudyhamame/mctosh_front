const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const rounded = (value, digits = 3) => {
  const number = finite(value);
  return number == null ? null : Number(number.toFixed(digits));
};
const codepoint = (value) => {
  const point = String(value || "").codePointAt(0);
  return Number.isInteger(point) ? `U+${point.toString(16).toUpperCase().padStart(4, "0")}` : null;
};

const summarizeOperand = (value, depth = 0) => {
  if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= 3) return "[nested value]";
  if (Array.isArray(value)) return value.slice(0, 250).map((entry) => summarizeOperand(entry, depth + 1));
  if (typeof value === "object") {
    const usefulKeys = ["unicode", "fontChar", "originalCharCode", "width", "isSpace", "isInFont", "accent", "operatorListId"];
    const selected = usefulKeys.filter((key) => Object.hasOwn(value, key));
    return Object.fromEntries((selected.length ? selected : Object.keys(value).slice(0, 20))
      .map((key) => [key, summarizeOperand(value[key], depth + 1)]));
  }
  return String(value);
};

export const collectPdfJsForensicEvidence = async (pdfDoc, pageNumber, ops = {}) => {
  if (!pdfDoc || !pageNumber) return null;
  const page = await pdfDoc.getPage(pageNumber);
  const [textContent, operatorList] = await Promise.all([
    page.getTextContent({ disableCombineTextItems: true, includeMarkedContent: true }),
    page.getOperatorList(),
  ]);
  const operatorNames = Object.fromEntries(Object.entries(ops || {}).map(([name, value]) => [value, name]));
  let textObject = 0;
  let inTextObject = false;
  const operators = operatorList.fnArray.map((fn, index) => {
    const name = operatorNames[fn] || `op_${fn}`;
    if (name === "beginText") { textObject += 1; inTextObject = true; }
    const record = {
      operatorIndex: index,
      operator: name,
      textObject: inTextObject ? textObject : null,
      operands: summarizeOperand(operatorList.argsArray[index]),
    };
    if (name === "endText") inTextObject = false;
    return record;
  }).filter((record) => /Text|Font|Char|Spacing|Leading|Matrix|Line|Rise|HScale|show/i.test(record.operator));

  let characterIndex = 0;
  const items = textContent.items.filter((item) => typeof item?.str === "string").map((item, itemIndex) => {
    const transform = Array.from(item.transform || []).map((value) => rounded(value, 5));
    const characters = Array.from(item.str).map((unicode, itemCharacterIndex) => ({
      page: pageNumber,
      characterIndex: characterIndex++,
      itemIndex,
      itemCharacterIndex,
      rawCode: null,
      rawCodeHex: null,
      unicode,
      unicodeCodepoint: codepoint(unicode),
      sourceOperator: null,
      font: item.fontName || "",
      glyphId: null,
      glyphName: null,
      x: transform[4] ?? null,
      y: transform[5] ?? null,
      width: item.str.length ? rounded(item.width / Array.from(item.str).length) : null,
      height: rounded(item.height),
      advance: null,
      explicitInPdf: null,
      confidence: 0.55,
      provenance: "pdfjs_getTextContent",
    }));
    return {
      itemIndex,
      text: item.str,
      direction: item.dir || null,
      width: rounded(item.width),
      height: rounded(item.height),
      transform,
      fontName: item.fontName || "",
      hasEOL: Boolean(item.hasEOL),
      characters,
    };
  });
  return {
    page: pageNumber,
    viewport: page.getViewport({ scale: 1 }),
    observedText: items.map((item) => `${item.text}${item.hasEOL ? "\n" : ""}`).join(""),
    items,
    styles: textContent.styles || {},
    operators,
    limitations: [
      "PDF.js getTextContent() exposes decoded strings, not authoritative original character codes.",
      "PDF.js operator-list glyph objects are retained where available, but worker normalization can hide original content-stream bytes.",
    ],
  };
};

const median = (values) => {
  const sorted = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const nativeCharacterEvidence = (native, pageNumber) => {
  let index = 0;
  return (native?.spans || []).flatMap((span, spanIndex) => (span.chars || []).map((character, spanCharacterIndex) => {
    const bbox = character.bbox || [];
    const value = character.c || "";
    return {
      page: pageNumber,
      characterIndex: index++,
      spanIndex,
      spanCharacterIndex,
      lineId: span.lineId || null,
      rawCode: null,
      rawCodeHex: null,
      unicode: value,
      unicodeCodepoint: codepoint(value),
      sourceOperator: null,
      font: span.fontName || "",
      glyphId: null,
      glyphName: null,
      bbox,
      x: rounded(bbox[0]),
      y: rounded(bbox[1]),
      width: rounded((bbox[2] || 0) - (bbox[0] || 0)),
      height: rounded((bbox[3] || 0) - (bbox[1] || 0)),
      advance: null,
      fontSize: rounded(span.fontSize),
      origin: character.origin || null,
      explicitInPdf: true,
      confidence: 0.9,
      provenance: "pymupdf_rawdict",
    };
  }));
};

const buildGeometryAndWhitespace = (characters) => {
  const geometry = [];
  const whitespace = [];
  const widths = characters.map((character) => character.width).filter((width) => width > 0);
  const averageAdvance = median(widths);
  for (let index = 0; index < characters.length; index += 1) {
    const current = characters[index];
    if (/\s/u.test(current.unicode || "")) {
      const left = characters[index - 1] || null;
      const right = characters[index + 1] || null;
      whitespace.push({
        index,
        leftCharacter: left?.unicode ?? null,
        rightCharacter: right?.unicode ?? null,
        extractedAsSpace: true,
        explicitSpaceCharacter: true,
        unicodeCodepoint: current.unicodeCodepoint,
        geometricGap: current.width,
        expectedAdvanceGap: averageAdvance,
        structuralBoundary: Boolean(left && right && left.spanIndex !== right.spanIndex),
        classification: "explicit_character_space",
        confidence: 0.9,
        reason: "A whitespace code point exists in the native character stream. Original encoded bytes remain separately unresolved.",
      });
      continue;
    }
    const next = characters[index + 1];
    if (!next || /\s/u.test(next.unicode || "") || current.lineId !== next.lineId) continue;
    const currentEnd = finite(current.bbox?.[2]);
    const nextStart = finite(next.bbox?.[0]);
    if (currentEnd == null || nextStart == null) continue;
    const gap = nextStart - currentEnd;
    const expected = median([current.width, next.width, averageAdvance]);
    const normalized = expected > 0 ? gap / expected : null;
    const structuralBoundary = current.spanIndex !== next.spanIndex;
    geometry.push({
      leftCharacterIndex: current.characterIndex,
      rightCharacterIndex: next.characterIndex,
      leftCharacter: current.unicode,
      rightCharacter: next.unicode,
      previousGlyphEndX: rounded(currentEnd),
      nextGlyphStartX: rounded(nextStart),
      actualGap: rounded(gap),
      expectedAdvance: rounded(expected),
      normalizedGap: rounded(normalized),
      baselineDifference: rounded((finite(next.origin?.[1]) || next.y || 0) - (finite(current.origin?.[1]) || current.y || 0)),
      fontChange: current.font !== next.font,
      fontSizeChange: current.fontSize !== next.fontSize,
      structuralBoundary,
    });
    if (structuralBoundary || (normalized != null && normalized > 0.45)) {
      whitespace.push({
        index: current.characterIndex + 0.5,
        leftCharacter: current.unicode,
        rightCharacter: next.unicode,
        extractedAsSpace: false,
        explicitSpaceCharacter: false,
        geometricGap: rounded(gap),
        expectedAdvanceGap: rounded(expected),
        structuralBoundary,
        classification: structuralBoundary ? "structural_discontinuity" : "geometric_space",
        confidence: structuralBoundary ? 0.78 : Math.min(0.95, 0.65 + Math.max(0, normalized || 0) / 5),
        reason: structuralBoundary
          ? "Adjacent characters cross a native span boundary; this does not by itself prove a linguistic word boundary."
          : "No whitespace character exists; the apparent separation is positional geometry.",
      });
    }
  }
  return { geometry, whitespace, averageAdvance: rounded(averageAdvance) };
};

const ocrTextForPage = (ocrPage) => (ocrPage?.blocks || [])
  .map((block) => String(block.text || block.markdown || "").trim())
  .filter(Boolean)
  .join("\n");

const normalizeComparison = (text) => String(text || "").normalize("NFKC").replace(/\s+/g, " ").trim();

export const buildPdfForensicReport = ({ pageNumber, nativeExtraction, pdfJsEvidence, ocrPage }) => {
  const native = nativeExtraction?.native || {};
  const characters = nativeCharacterEvidence(native, pageNumber);
  const rawText = characters.map((character) => character.unicode).join("");
  const observedText = pdfJsEvidence?.observedText || "";
  const ocrText = ocrTextForPage(ocrPage);
  const { geometry, whitespace, averageAdvance } = buildGeometryAndWhitespace(characters);
  const traces = native?.forensic?.textTrace || [];
  let nextGlyphIndex = 0;
  const glyphs = traces.flatMap((trace) => (trace.characters || []).map((character) => ({
    page: pageNumber,
    glyphIndex: nextGlyphIndex++,
    traceIndex: trace.traceIndex,
    font: trace.fontName,
    fontSize: trace.fontSize,
    glyphId: character.glyphId,
    glyphName: character.glyphName,
    bbox: character.bbox,
    transform: null,
    visualCandidate: null,
    correspondingPdfCharacter: character.unicode,
    quality: character.glyphId == null ? "uncertain" : "normal",
    confidence: character.glyphId == null ? 0.45 : 0.88,
  })));
  const discrepancies = [];
  if (rawText && observedText && rawText !== observedText) discrepancies.push({
    type: "RAW_TEXT_NE_PDFJS_TEXT",
    severity: "high",
    confidence: 0.98,
    nativeText: rawText,
    pdfJsText: observedText,
    reason: "PyMuPDF's character stream and PDF.js getTextContent() are not byte-for-byte equal.",
  });
  if (rawText && ocrText && normalizeComparison(rawText) !== normalizeComparison(ocrText)) discrepancies.push({
    type: "CHARACTER_NE_OCR",
    severity: "medium",
    confidence: 0.75,
    nativeText: rawText,
    ocrText,
    reason: "OCR is an independent witness and disagrees after whitespace normalization; it has not replaced native evidence.",
  });
  characters.filter((character) => character.unicode === "�" || character.unicode === "\0").forEach((character) => discrepancies.push({
    type: "SUSPECT_UNICODE_MAPPING",
    severity: "high",
    confidence: 0.96,
    characterIndex: character.characterIndex,
    observedCharacter: character.unicode,
  }));
  whitespace.filter((entry) => !entry.explicitSpaceCharacter).forEach((entry) => discrepancies.push({
    type: "EXTRACTED_SPACE_NE_EXPLICIT_SPACE",
    severity: entry.classification === "geometric_space" ? "medium" : "low",
    confidence: entry.confidence,
    ...entry,
  }));
  const canonicalSource = rawText ? "pymupdf_raw_character_stream" : "pdfjs_observed_stream";
  const canonicalText = rawText || observedText;
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    page: pageNumber,
    nonMutating: true,
    summary: {
      nativeCharacters: characters.length,
      glyphInstances: glyphs.length,
      pdfJsItems: pdfJsEvidence?.items?.length || 0,
      nativeFonts: native?.forensic?.fonts?.length || 0,
      contentStreamOperators: native?.forensic?.contentOperators?.length || 0,
      whitespaceCandidates: whitespace.length,
      discrepancies: discrepancies.length,
      averageCharacterAdvance: averageAdvance,
    },
    pdfStructure: {
      page: nativeExtraction?.page || null,
      fonts: native?.forensic?.fonts || [],
      contentOperators: native?.forensic?.contentOperators || [],
      pdfJsOperators: pdfJsEvidence?.operators || [],
      pdfJsStyles: pdfJsEvidence?.styles || {},
      limitations: [...(native?.forensic?.limitations || []), ...(pdfJsEvidence?.limitations || [])],
    },
    rawCharacterStream: { text: rawText, characters },
    glyphStream: glyphs,
    geometryStream: geometry,
    whitespaceAnalysis: whitespace,
    caseAnalysis: discrepancies.filter((item) => item.type === "PDF_CASE_NE_VISUAL_CASE"),
    visualAnalysis: {
      renderer: "PDF.js canvas",
      automatedGlyphClassification: "unavailable",
      note: "The rendered page remains visible beside this report. No pixel/OCR result is promoted to character truth.",
    },
    ocrComparison: { available: Boolean(ocrText), text: ocrText, source: ocrPage ? "persisted_ocr" : null },
    linguisticAnalysis: {
      status: "not_applied",
      note: "No dictionary or medical-language correction is silently applied in this first forensic pass.",
    },
    observedTextStream: { text: observedText, items: pdfJsEvidence?.items || [] },
    discrepancies: discrepancies.sort((a, b) => (
      ({ high: 3, medium: 2, low: 1 }[b.severity] || 0)
      - ({ high: 3, medium: 2, low: 1 }[a.severity] || 0)
    )),
    canonicalReconstruction: {
      text: canonicalText,
      source: canonicalSource,
      confidence: rawText ? 0.9 : observedText ? 0.55 : 0,
      confidenceLabel: rawText ? "high confidence" : observedText ? "probable" : "unresolved",
      transformations: [],
      note: "Conservative baseline only: no source evidence was overwritten and no speculative correction was applied.",
    },
  };
};
