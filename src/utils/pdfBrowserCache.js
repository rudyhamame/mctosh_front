const PDF_CACHE_NAME = "mctosh-pdf-cache-v1";
const cacheRequest = (sourceId, filename) => new Request(
  `/__mctosh_pdf_cache__/${encodeURIComponent(String(sourceId || "local"))}/${encodeURIComponent(String(filename || "document.pdf"))}`,
);

export const readCachedPdf = async (sourceId, filename) => {
  if (!window.caches || !sourceId) return null;
  try {
    const cache = await window.caches.open(PDF_CACHE_NAME);
    const response = await cache.match(cacheRequest(sourceId, filename));
    return response?.ok ? response.arrayBuffer() : null;
  } catch {
    return null;
  }
};

export const writeCachedPdf = async (sourceId, filename, response) => {
  if (!window.caches || !sourceId || !response?.ok) return;
  try {
    const cache = await window.caches.open(PDF_CACHE_NAME);
    await cache.put(cacheRequest(sourceId, filename), response.clone());
  } catch {
    // Browser storage is best-effort; opening the PDF must still work.
  }
};
