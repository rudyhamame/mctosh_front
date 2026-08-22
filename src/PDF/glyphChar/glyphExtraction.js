const finiteBBox = (bbox) => (
  Array.isArray(bbox)
  && bbox.length >= 4
  && bbox.slice(0, 4).every((value) => Number.isFinite(Number(value)))
);

const bboxObject = (bbox) => ({
  x: Number(bbox[0]),
  y: Number(bbox[1]),
  width: Math.max(0, Number(bbox[2]) - Number(bbox[0])),
  height: Math.max(0, Number(bbox[3]) - Number(bbox[1])),
});

const instance = ({ documentId, pageNumber, index, traceIndex, fontName, fontRef, fontSize, glyphId, rawCode, bbox, transform, givenChars, givenSource, geometryConfidence, geometryMethod }) => {
  const whitespace = givenChars.length === 1 && /^\s$/u.test(givenChars[0]);
  const definitionKey = glyphId != null
    ? `fontdef-fallback:${fontRef || fontName || "unknown-font"}:${glyphId}`
    : null;
  return {
    id: `${documentId || "local"}:p${pageNumber}:g${index}`,
    documentId: documentId || "local",
    pageNumber,
    instanceIndex: index,
    traceIndex: traceIndex ?? null,
    fontRef: fontRef || null,
    fontName: fontName || null,
    fontSize: Number(fontSize) || null,
    glyphId: glyphId ?? null,
    sourceGlyphCode: rawCode ?? null,
    bbox,
    transform: Array.isArray(transform) ? transform : null,
    geometryConfidence,
    geometryMethod,
    visible: !whitespace && bbox.width > 0 && bbox.height > 0,
    renderedCrop: null,
    normalizedCrop: null,
    visualFingerprint: null,
    given: {
      value: givenChars.length === 1 ? givenChars[0] : givenChars.join("") || null,
      values: givenChars,
      source: givenSource,
      rawCode: rawCode ?? null,
      provenance: { mappingPath: "EXTRACTOR_FALLBACK", fontResource: fontRef || fontName || null },
      quality: { mappingPath: "EXTRACTOR_FALLBACK", explicitToUnicode: false, rawCodeAvailable: rawCode != null, confidence: "unknown-provenance" },
      sequenceStatus: givenChars.length > 1 ? "MULTI_CHAR_GLYPH" : givenChars.length === 1 ? "SINGLE_CHAR" : "NO_GIVEN_CHAR",
    },
    prediction: null,
    comparison: null,
    definitionCacheKey: definitionKey,
    definitionIdentityConfidence: "fallback",
    analysisStatus: "pending",
  };
};

export const extractNativeGlyphInstances = ({ extraction, documentId, pageNumber }) => {
  const traces = extraction?.native?.forensic?.textTrace || [];
  let index = 0;
  const traced = traces.flatMap((trace, traceIndex) => (trace.characters || []).flatMap((character) => {
    if (!finiteBBox(character.bbox)) return [];
    const givenChars = character.unicode == null ? [] : Array.from(String(character.unicode));
    return [instance({
      documentId, pageNumber, index: index++, traceIndex,
      fontName: trace.fontName, fontRef: trace.fontName, fontSize: trace.fontSize,
      glyphId: character.glyphId, rawCode: character.rawCode,
      bbox: bboxObject(character.bbox), transform: character.transform,
      givenChars, givenSource: "pymupdfTextTrace",
      geometryConfidence: "exact", geometryMethod: "pymupdf-texttrace-glyph-bbox",
    })];
  }));
  if (traced.length) return traced;

  return (extraction?.native?.spans || []).flatMap((span, spanIndex) => (span.chars || []).flatMap((character) => {
    if (!finiteBBox(character.bbox)) return [];
    const givenChars = character.c == null ? [] : Array.from(String(character.c));
    return [instance({
      documentId, pageNumber, index: index++, traceIndex: spanIndex,
      fontName: span.fontName, fontRef: span.fontName, fontSize: span.fontSize,
      glyphId: null, rawCode: null, bbox: bboxObject(character.bbox),
      transform: span.transform, givenChars, givenSource: "pymupdfRawDict",
      geometryConfidence: "exact", geometryMethod: "pymupdf-rawdict-char-bbox",
    })];
  }));
};

export const extractPdfJsFallbackGlyphInstances = async ({ pdfDoc, pdfjsUtil, documentId, pageNumber }) => {
  const page = await pdfDoc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent({ disableCombineTextItems: true, includeMarkedContent: true });
  let index = 0;
  return content.items.flatMap((item) => {
    if (typeof item?.str !== "string" || !Array.isArray(item.transform)) return [];
    const givenChars = Array.from(item.str);
    if (!givenChars.length) return [];
    const transform = pdfjsUtil.transform(viewport.transform, item.transform);
    const height = Math.max(0.5, Math.hypot(transform[2], transform[3]) || Number(item.height) || 1);
    const width = Math.max(0, Number(item.width) || 0);
    // A combined PDF.js text item remains one uncertain visual occurrence.
    // It is never divided into invented equal-width character boxes.
    return [instance({
      documentId, pageNumber, index: index++, traceIndex: null,
      fontName: item.fontName, fontRef: item.fontName, fontSize: height,
      glyphId: null, rawCode: null,
      bbox: { x: transform[4], y: transform[5] - height, width, height },
      transform: item.transform, givenChars, givenSource: "textContent",
      geometryConfidence: givenChars.length === 1 ? "probable" : "uncertain",
      geometryMethod: givenChars.length === 1 ? "pdfjs-single-character-item" : "pdfjs-combined-text-item-unsplit",
    })];
  });
};
