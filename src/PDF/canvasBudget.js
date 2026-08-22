const userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent;

// Safari is much more aggressive than Chromium about killing a tab when
// several large canvas/GPU surfaces coexist. iOS browsers all use WebKit.
export const IS_WEBKIT_SAFARI = /AppleWebKit/i.test(userAgent)
  && !/(Chrome|CriOS|Edg|EdgiOS|OPR|FxiOS)/i.test(userAgent);

// Keep the PDF raster sharp on high-density displays. Safari previously used
// a 2-megapixel ceiling to compensate for the removed WebGL page-turn layers;
// that ceiling visibly softened text because the canvas could fall below one
// backing pixel per CSS pixel. Canvas cleanup still limits transient memory,
// so all engines can use the original quality budget again.
export const MAX_RENDER_CANVAS_DIMENSION = 6144;
export const MAX_RENDER_CANVAS_PIXELS = 8388608;

export const getSafeCanvasOutputScale = (width, height, requestedScale = 1) => {
  const safeWidth = Math.max(1, Number(width) || 1);
  const safeHeight = Math.max(1, Number(height) || 1);
  const deviceScale = Math.max(0.1, Number(requestedScale) || 1);
  const dimensionScale = Math.min(
    deviceScale,
    MAX_RENDER_CANVAS_DIMENSION / safeWidth,
    MAX_RENDER_CANVAS_DIMENSION / safeHeight,
  );
  const areaScale = Math.min(
    deviceScale,
    Math.sqrt(MAX_RENDER_CANVAS_PIXELS / (safeWidth * safeHeight)),
  );
  return Math.max(0.1, Math.min(deviceScale, dimensionScale, areaScale));
};

// Setting both dimensions releases the old backing store immediately in
// WebKit. Keeping the CSS dimensions lets an inactive overlay remain aligned
// without retaining a full-page transparent bitmap.
export const releaseCanvasBackingStore = (canvas, cssWidth = 0, cssHeight = 0) => {
  if (!canvas) return;
  canvas.width = 1;
  canvas.height = 1;
  if (cssWidth) canvas.style.width = `${cssWidth}px`;
  if (cssHeight) canvas.style.height = `${cssHeight}px`;
};
