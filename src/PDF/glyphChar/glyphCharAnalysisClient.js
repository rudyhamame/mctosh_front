import { apiUrl } from "../../config/api.js";
import { readStoredSession } from "../../utils/sessionCleanup.js";
import { trackGlyphCharActivity } from "./glyphCharActivity.js";

const request = (path, options = {}) => trackGlyphCharActivity(async () => {
  const token = readStoredSession()?.token || "";
  const response = await fetch(apiUrl(path), {
    ...options,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    const error = new Error(data.error?.message || data.error || `Glyph analysis request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return data;
});

export const startGlyphCharAnalysis = (documentId, { scope = "document", pageNumber = null, force = false } = {}) => request(`/api/glyph-char-analysis/documents/${documentId}/start`, {
  method: "POST",
  body: JSON.stringify({ scope, ...(scope === "page" ? { pageNumber, force } : {}) }),
});
export const getSavedGlyphCharAnalysis = (documentId) => request(`/api/glyph-char-analysis/documents/${documentId}`);
export const cancelGlyphCharAnalysis = (jobId) => request(`/api/glyph-char-analysis/jobs/${jobId}/cancel`, { method: "POST" });
export const deleteGlyphCharAnalysisResults = (jobId) => request(`/api/glyph-char-analysis/jobs/${jobId}/results`, { method: "DELETE" });
export const getGlyphCharAnalysisResults = (jobId, afterPage = 0, { pageNumber = null } = {}) => {
  const query = new URLSearchParams({
    afterPage: String(Math.max(0, Number(afterPage) || 0)),
    limitPages: "2",
  });
  if (Number.isInteger(Number(pageNumber)) && Number(pageNumber) > 0) query.set("pageNumber", String(Number(pageNumber)));
  return request(`/api/glyph-char-analysis/jobs/${jobId}/results?${query}`);
};
export const getGlyphDefinitions = (jobId, { pageNumber = null } = {}) => {
  const query = new URLSearchParams();
  if (Number.isInteger(Number(pageNumber)) && Number(pageNumber) > 0) query.set("pageNumber", String(Number(pageNumber)));
  return request(`/api/glyph-char-analysis/jobs/${jobId}/definitions${query.size ? `?${query}` : ""}`);
};
export const getGlyphDefinitionInstances = (jobId, { definitionId, pageNumber = null } = {}) => {
  const query = new URLSearchParams({ definitionId: String(definitionId || "") });
  if (Number.isInteger(Number(pageNumber)) && Number(pageNumber) > 0) query.set("pageNumber", String(Number(pageNumber)));
  return request(`/api/glyph-char-analysis/jobs/${jobId}/definition-instances?${query}`);
};
export const getGlyphCharVisualStages = (jobId, { pageNumber, glyphId }) => {
  const query = new URLSearchParams({ pageNumber: String(pageNumber), glyphId: String(glyphId) });
  return request(`/api/glyph-char-analysis/jobs/${jobId}/visual-stage?${query}`);
};
export const trainGlyphCharSample = (jobId, { pageNumber, glyphId, confirmedChar }) => request(`/api/glyph-char-analysis/jobs/${jobId}/training-samples`, {
  method: "POST",
  body: JSON.stringify({ pageNumber, glyphId, confirmedChar }),
});

const responseFilename = (response, fallback) => {
  const disposition = response.headers.get("content-disposition") || "";
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  const quoted = /filename="([^"]+)"/i.exec(disposition)?.[1];
  try { return decodeURIComponent(encoded || quoted || fallback); } catch { return quoted || fallback; }
};

export const downloadGlyphCharPageReport = async (jobId, {
  pageNumber,
  format = "json",
  profile = "standard",
  includeDebug = false,
  includeImages = false,
  imageProfile = "diagnostic",
  selectedGlyphInstanceId = null,
  confirmLarge = false,
} = {}) => {
  const query = new URLSearchParams({
    pageNumber: String(pageNumber),
    format,
    profile,
    includeDebug: String(Boolean(includeDebug)),
    includeImages: String(Boolean(includeImages)),
    imageProfile,
    confirmLarge: String(Boolean(confirmLarge)),
  });
  if (selectedGlyphInstanceId) query.set("selectedGlyphInstanceId", selectedGlyphInstanceId);
  const token = readStoredSession()?.token || "";
  const response = await trackGlyphCharActivity(() => fetch(apiUrl(`/api/glyph-char-analysis/jobs/${jobId}/report?${query}`), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  }));
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const error = new Error(payload.error?.message || `Report generation failed (${response.status}).`);
    error.status = response.status;
    error.code = payload.error?.code;
    error.glyphCount = payload.error?.glyphCount;
    throw error;
  }
  const extension = format === "markdown" ? "md" : format === "bundle" ? "zip" : "json";
  return {
    blob: await response.blob(),
    filename: responseFilename(response, `rabbit-hole-layer1-page-${String(pageNumber).padStart(3, "0")}.${extension}`),
    reportStatus: response.headers.get("x-rabbithole-report-status"),
    glyphCount: Number(response.headers.get("x-rabbithole-glyph-count")) || null,
  };
};
