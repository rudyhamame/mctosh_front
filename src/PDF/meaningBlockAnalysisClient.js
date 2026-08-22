import { apiUrl } from "../config/api.js";
import { readStoredSession } from "../utils/sessionCleanup.js";

const authHeader = () => {
  const token = readStoredSession()?.token || "";
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const request = async (path, options = {}, timeoutMs = 120000) => {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(apiUrl(path), { ...options, signal: controller.signal, headers: { ...authHeader(), ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) {
      const error = new Error(`${data.error?.message || data.error || `Meaning analysis failed (${response.status}).`} [${response.status} ${path}]`);
      error.status = response.status;
      throw error;
    }
    return data;
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`Meaning analysis timed out. [504 ${path}]`);
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
  }
};

export const runVisualMeaningAnalysis = async ({ documentId, pageIndex, provider, model, preparation }) => {
  const form = new FormData();
  form.append("documentId", documentId);
  form.append("pageIndex", String(pageIndex));
  form.append("provider", provider || "");
  form.append("model", model || "");
  form.append("sourceVersion", preparation.sourceVersion);
  form.append("imageVersion", preparation.imageVersion);
  form.append("sourceItems", JSON.stringify(preparation.sourceItems));
  form.append("coordinateMap", JSON.stringify(preparation.coordinateMap));
  form.append("clientProcedures", JSON.stringify(preparation.procedures));
  form.append("cleanImage", preparation.cleanImage, `page-${pageIndex + 1}-clean.jpg`);
  form.append("overlayImage", preparation.overlayImage, `page-${pageIndex + 1}-textitems.png`);
  return request("/api/document-reconstruction/ai-meaning-analysis/visual", { method: "POST", body: form });
};

export const runSemanticMeaningAnalysis = (analysisId, { provider, model } = {}) => request(`/api/document-reconstruction/ai-meaning-analysis/${analysisId}/semantic`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider, model }) });
export const getLatestMeaningAnalysis = (documentId, pageIndex) => request(`/api/document-reconstruction/ai-meaning-analysis/documents/${documentId}/pages/${pageIndex}/latest`, {}, 45000);
export const updateMeaningBlock = (analysisId, blockId, update) => request(`/api/document-reconstruction/ai-meaning-analysis/${analysisId}/blocks/${encodeURIComponent(blockId)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(update) }, 45000);
export const updateMeaningBoundary = (analysisId, previousUnitId, nextUnitId, decision) => request(`/api/document-reconstruction/ai-meaning-analysis/${analysisId}/boundaries/${encodeURIComponent(previousUnitId)}/${encodeURIComponent(nextUnitId)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }) }, 45000);
export const deleteMeaningAnalysis = (analysisId) => request(`/api/document-reconstruction/ai-meaning-analysis/${analysisId}`, { method: "DELETE" }, 45000);
