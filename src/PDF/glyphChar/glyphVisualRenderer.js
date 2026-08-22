const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const fingerprintBytes = (data) => {
  let hash = 2166136261;
  for (let index = 0; index < data.length; index += 16) {
    hash ^= data[index];
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

export const normalizeGlyphVisual = (sourceCanvas, size = 96, { includeImageUrl = true } = {}) => {
  const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
  const image = sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  let left = image.width; let top = image.height; let right = -1; let bottom = -1;
  const cornerOffsets = [0, (image.width - 1) * 4, (image.height - 1) * image.width * 4, (image.width * image.height - 1) * 4];
  const background = cornerOffsets.reduce((sum, offset) => sum + (image.data[offset] + image.data[offset + 1] + image.data[offset + 2]) / 3, 0) / cornerOffsets.length;
  const ink = new Uint8Array(image.width * image.height);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const offset = (y * image.width + x) * 4;
      const luminance = image.data[offset] * 0.2126 + image.data[offset + 1] * 0.7152 + image.data[offset + 2] * 0.0722;
      const alpha = image.data[offset + 3] / 255;
      const isInk = alpha > 0.08 && Math.abs(luminance - background) > 34;
      if (!isInk) continue;
      ink[y * image.width + x] = 255;
      left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, size, size);
  if (right < left || bottom < top) {
    return { canvas, imageData: context.getImageData(0, 0, size, size), imageUrl: includeImageUrl ? canvas.toDataURL("image/png") : null, fingerprint: "empty", empty: true };
  }
  const width = right - left + 1;
  const height = bottom - top + 1;
  const available = size - 16;
  const scale = Math.min(available / width, available / height);
  const drawWidth = Math.max(1, Math.round(width * scale));
  const drawHeight = Math.max(1, Math.round(height * scale));
  const x = Math.floor((size - drawWidth) / 2);
  const y = Math.floor((size - drawHeight) / 2);
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = image.width; maskCanvas.height = image.height;
  const maskContext = maskCanvas.getContext("2d");
  const maskImage = maskContext.createImageData(image.width, image.height);
  for (let index = 0; index < ink.length; index += 1) {
    const offset = index * 4;
    maskImage.data[offset] = 0; maskImage.data[offset + 1] = 0; maskImage.data[offset + 2] = 0; maskImage.data[offset + 3] = ink[index];
  }
  maskContext.putImageData(maskImage, 0, 0);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(maskCanvas, left, top, width, height, x, y, drawWidth, drawHeight);
  const normalizedImage = context.getImageData(0, 0, size, size);
  return {
    canvas,
    imageData: normalizedImage,
    imageUrl: includeImageUrl ? canvas.toDataURL("image/png") : null,
    fingerprint: `${width}x${height}:${fingerprintBytes(normalizedImage.data)}`,
    empty: false,
    inkBounds: { left, top, right, bottom, width, height },
  };
};

export const createGlyphVisualRenderer = ({ pdfDoc, renderScale = 4, maxCachedPages = 2 }) => {
  const pages = new Map();
  const loadPage = async (pageNumber) => {
    if (pages.has(pageNumber)) return pages.get(pageNumber);
    const page = await pdfDoc.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const pixelBudgetScale = Math.sqrt(12_000_000 / Math.max(1, base.width * base.height));
    const scale = clamp(Math.min(renderScale, pixelBudgetScale), 1.5, renderScale);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport }).promise;
    const record = { canvas, scale };
    pages.set(pageNumber, record);
    while (pages.size > maxCachedPages) {
      const oldest = pages.keys().next().value;
      const removed = pages.get(oldest);
      removed.canvas.width = 0; removed.canvas.height = 0;
      pages.delete(oldest);
    }
    return record;
  };
  return {
    async render(instance, { includeImages = false } = {}) {
      if (!instance.visible) return null;
      const page = await loadPage(instance.pageNumber);
      const padding = Math.max(3, Math.ceil(page.scale * 1.5));
      const left = clamp(Math.floor(instance.bbox.x * page.scale) - padding, 0, page.canvas.width - 1);
      const top = clamp(Math.floor(instance.bbox.y * page.scale) - padding, 0, page.canvas.height - 1);
      const right = clamp(Math.ceil((instance.bbox.x + instance.bbox.width) * page.scale) + padding, left + 1, page.canvas.width);
      const bottom = clamp(Math.ceil((instance.bbox.y + instance.bbox.height) * page.scale) + padding, top + 1, page.canvas.height);
      const crop = document.createElement("canvas");
      crop.width = Math.max(1, right - left); crop.height = Math.max(1, bottom - top);
      crop.getContext("2d", { willReadFrequently: true }).drawImage(page.canvas, left, top, crop.width, crop.height, 0, 0, crop.width, crop.height);
      const normalized = normalizeGlyphVisual(crop, 96, { includeImageUrl: includeImages });
      return {
        renderedCrop: includeImages ? crop.toDataURL("image/png") : null,
        normalizedCrop: normalized.imageUrl,
        normalizedImageData: normalized.imageData,
        visualFingerprint: normalized.fingerprint,
        empty: normalized.empty,
        cropMethod: "pdfjs-high-resolution-page-crop",
        renderScale: page.scale,
        normalization: "tight-ink-proportional-center-96",
      };
    },
    clear() {
      pages.forEach(({ canvas }) => { canvas.width = 0; canvas.height = 0; });
      pages.clear();
    },
  };
};
