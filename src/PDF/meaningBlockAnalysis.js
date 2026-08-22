import * as pdfjsLib from "pdfjs-dist";

export const MEANING_BLOCK_SOURCE_VERSION = "pdfjs-source-text-items-v1";
export const MEANING_BLOCK_IMAGE_VERSION = "pdfjs-page-overlay-v1";

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const round = (value, precision = 4) => Number(finite(value).toFixed(precision));
const nowIso = () => new Date().toISOString();
const elapsed = (started) => Math.max(0, Math.round(performance.now() - started));
const procedure = (step, name, startedAt, durationMs, status, counts = {}, validation = "pass", failure = "") => ({
  step, name, startedAt, completedAt: nowIso(), durationMs, status, counts, validation, failure,
});

const canvasBlob = (canvas, type, quality) => new Promise((resolve, reject) => {
  canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error(`Could not encode ${type} analysis image.`)), type, quality);
});

const sourceItemId = (_pageIndex, sourceIndex) => `T${String(sourceIndex + 1).padStart(4, "0")}`;

const itemBBox = (item, viewport) => {
  const transform = Array.isArray(item?.transform) && item.transform.length >= 6 ? item.transform.slice(0, 6).map(Number) : null;
  if (!transform?.every(Number.isFinite)) return null;
  const mapped = pdfjsLib.Util.transform(viewport.transform, transform);
  const fontHeight = Math.max(0.5, Math.hypot(mapped[2], mapped[3]));
  const width = Math.max(0.5, Math.abs(finite(item.width) * finite(viewport.scale, 1)));
  const x = mapped[4];
  const y = mapped[5] - fontHeight;
  if (![x, y, width, fontHeight].every(Number.isFinite)) return null;
  return { x: round(x), y: round(y), width: round(width), height: round(fontHeight) };
};

const normalizeBBox = (bbox, width, height) => bbox ? ({
  x: round(bbox.x / Math.max(1, width), 6),
  y: round(bbox.y / Math.max(1, height), 6),
  width: round(bbox.width / Math.max(1, width), 6),
  height: round(bbox.height / Math.max(1, height), 6),
}) : null;

export const prepareMeaningBlockPage = async ({ pdfDoc, pageNumber, maxImageDimension = 1800 }) => {
  if (!pdfDoc || !Number.isInteger(pageNumber) || pageNumber < 1) throw new Error("A valid PDF page is required for MeaningBlock analysis.");
  const procedures = [];
  const sourceStartedAt = nowIso();
  const sourceStarted = performance.now();
  const page = await pdfDoc.getPage(pageNumber);
  const content = await page.getTextContent({ disableCombineTextItems: true, includeMarkedContent: false });
  const sourceItemsRaw = (content.items || []).filter((item) => typeof item?.str === "string");
  if (!sourceItemsRaw.length) throw new Error(`Page ${pageNumber} has no PDF.js source textItems.`);
  procedures.push(procedure(1, "Load immutable PDF.js source textItems", sourceStartedAt, elapsed(sourceStarted), "complete", { sourceItems: sourceItemsRaw.length }));

  const geometryStartedAt = nowIso();
  const geometryStarted = performance.now();
  const baseViewport = page.getViewport({ scale: 1 });
  const sourceItems = sourceItemsRaw.map((item, sourceIndex) => {
    const bbox = itemBBox(item, baseViewport);
    return Object.freeze({
      id: sourceItemId(pageNumber - 1, sourceIndex),
      pageIndex: pageNumber - 1,
      sourceIndex,
      str: item.str,
      dir: item.dir || "",
      transform: Array.isArray(item.transform) ? item.transform.slice(0, 6).map((value) => finite(value)) : [],
      width: finite(item.width),
      height: finite(item.height),
      fontName: String(item.fontName || ""),
      hasEOL: Boolean(item.hasEOL),
      bbox,
      normalizedBBox: normalizeBBox(bbox, baseViewport.width, baseViewport.height),
    });
  });
  const mappedCount = sourceItems.filter((item) => item.bbox).length;
  procedures.push(procedure(2, "Build source geometry map", geometryStartedAt, elapsed(geometryStarted), mappedCount === sourceItems.length ? "complete" : "partial", { sourceItems: sourceItems.length, mappedBBoxes: mappedCount, unresolvedBBoxes: sourceItems.length - mappedCount }, mappedCount === sourceItems.length ? "pass" : "partial"));

  const cleanStartedAt = nowIso();
  const cleanStarted = performance.now();
  const imageScale = Math.min(2, Math.max(1, maxImageDimension / Math.max(baseViewport.width, baseViewport.height)));
  const imageViewport = page.getViewport({ scale: imageScale });
  const cleanCanvas = document.createElement("canvas");
  cleanCanvas.width = Math.max(1, Math.ceil(imageViewport.width));
  cleanCanvas.height = Math.max(1, Math.ceil(imageViewport.height));
  const cleanContext = cleanCanvas.getContext("2d", { alpha: false });
  cleanContext.fillStyle = "#fff";
  cleanContext.fillRect(0, 0, cleanCanvas.width, cleanCanvas.height);
  await page.render({ canvasContext: cleanContext, viewport: imageViewport }).promise;
  const cleanImage = await canvasBlob(cleanCanvas, "image/jpeg", 0.9);
  procedures.push(procedure(3, "Prepare clean page image", cleanStartedAt, elapsed(cleanStarted), "complete", { imageWidth: cleanCanvas.width, imageHeight: cleanCanvas.height, bytes: cleanImage.size }));

  const overlayStartedAt = nowIso();
  const overlayStarted = performance.now();
  const overlayCanvas = document.createElement("canvas");
  overlayCanvas.width = cleanCanvas.width;
  overlayCanvas.height = cleanCanvas.height;
  const overlayContext = overlayCanvas.getContext("2d");
  overlayContext.drawImage(cleanCanvas, 0, 0);
  overlayContext.lineWidth = Math.max(1, imageScale);
  overlayContext.font = `${Math.max(8, Math.round(7 * imageScale))}px ui-monospace, monospace`;
  overlayContext.textBaseline = "top";
  sourceItems.forEach((item) => {
    if (!item.bbox) return;
    const x = item.bbox.x * imageScale;
    const y = item.bbox.y * imageScale;
    const width = Math.max(1, item.bbox.width * imageScale);
    const height = Math.max(1, item.bbox.height * imageScale);
    overlayContext.strokeStyle = "rgba(124, 58, 237, .72)";
    overlayContext.fillStyle = "rgba(124, 58, 237, .035)";
    overlayContext.fillRect(x, y, width, height);
    overlayContext.strokeRect(x, y, width, height);
    const shortId = item.id;
    const labelWidth = overlayContext.measureText(shortId).width + 4;
    const labelY = Math.max(0, y - Math.max(9, 8 * imageScale));
    overlayContext.fillStyle = "rgba(55, 20, 90, .78)";
    overlayContext.fillRect(x, labelY, labelWidth, Math.max(9, 8 * imageScale));
    overlayContext.fillStyle = "#fff";
    overlayContext.fillText(shortId, x + 2, labelY + 1);
  });
  const overlayImage = await canvasBlob(overlayCanvas, "image/png");
  procedures.push(procedure(4, "Prepare textItem overlay image", overlayStartedAt, elapsed(overlayStarted), "complete", { labeledItems: mappedCount, bytes: overlayImage.size }));

  cleanCanvas.width = 1;
  cleanCanvas.height = 1;
  overlayCanvas.width = 1;
  overlayCanvas.height = 1;
  return {
    sourceItems,
    cleanImage,
    overlayImage,
    procedures,
    coordinateMap: {
      pageWidth: round(baseViewport.width), pageHeight: round(baseViewport.height),
      imageWidth: Math.ceil(imageViewport.width), imageHeight: Math.ceil(imageViewport.height),
      scaleX: round(imageViewport.width / Math.max(1, baseViewport.width), 6),
      scaleY: round(imageViewport.height / Math.max(1, baseViewport.height), 6),
      rotation: finite(imageViewport.rotation), pdfOrigin: "bottom-left", imageOrigin: "top-left", yAxis: "down", viewportTransform: imageViewport.transform.map((value) => round(value, 6)),
    },
    sourceVersion: MEANING_BLOCK_SOURCE_VERSION,
    imageVersion: MEANING_BLOCK_IMAGE_VERSION,
  };
};
