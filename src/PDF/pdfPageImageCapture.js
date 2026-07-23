// pdfPageImageCapture.js
//
// Captures the CURRENTLY RENDERED PDF page canvas as a compressed JPEG data
// URL, for a one-shot multimodal AI call (front/src/PDF/pdfPageStructureClient.js's
// segmentPage). Same draw-to-offscreen-canvas-then-toDataURL idiom already
// used elsewhere in this app (PDFPage.jsx's thumbnail/crop-export paths) —
// no new pattern introduced. The live page canvas is sized for on-screen
// sharpness (can be well over 2000px wide with a high-DPI display), which
// is unnecessarily large/expensive for a vision model, so this redraws it
// at a capped width first.

/**
 * `sourceCanvas` is the live, already-rendered page canvas (e.g.
 * PDFPage.jsx's own `canvasRef.current`). Returns a `data:image/jpeg;...`
 * string sized to at most `maxWidth` px wide (aspect-preserved) — never
 * upscales a smaller canvas.
 */
export const capturePageImageDataUrl = (sourceCanvas, { maxWidth = 1400, quality = 0.82 } = {}) => {
  if (!sourceCanvas || !sourceCanvas.width || !sourceCanvas.height) return null;
  const scale = Math.min(1, maxWidth / sourceCanvas.width);
  const targetWidth = Math.max(1, Math.round(sourceCanvas.width * scale));
  const targetHeight = Math.max(1, Math.round(sourceCanvas.height * scale));

  const offscreen = document.createElement("canvas");
  offscreen.width = targetWidth;
  offscreen.height = targetHeight;
  const ctx = offscreen.getContext("2d");
  // White background first — the source canvas has already rendered the
  // page onto a white PDF background in the normal case, but filling here
  // too guards against any transparent edge pixels surviving the downscale.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, targetWidth, targetHeight);
  ctx.drawImage(sourceCanvas, 0, 0, sourceCanvas.width, sourceCanvas.height, 0, 0, targetWidth, targetHeight);
  return offscreen.toDataURL("image/jpeg", quality);
};
