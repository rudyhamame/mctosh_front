import { apiUrl } from "../../config/api.js";
import { readStoredSession } from "../../utils/sessionCleanup.js";

const request = async (path, options = {}) => {
  const token = readStoredSession()?.token || "";
  const response = await fetch(apiUrl(path), {
    cache: "no-store",
    ...options,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    const error = new Error(data.error?.message || data.error || `CHARS extraction request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return data;
};

export const startPdfCharExtraction = (documentId) => request(`/api/pdf-char-extraction/documents/${documentId}/start?metadataOnly=true`, { method: "POST" });
export const reextractPdfChars = (documentId) => request(`/api/pdf-char-extraction/documents/${documentId}/reextract?metadataOnly=true`, { method: "POST" });
export const pausePdfCharExtraction = (jobId) => request(`/api/pdf-char-extraction/jobs/${jobId}/pause?metadataOnly=true`, { method: "POST" });
export const resumePdfCharExtraction = (jobId) => request(`/api/pdf-char-extraction/jobs/${jobId}/resume?metadataOnly=true`, { method: "POST" });
export const cancelPdfCharExtraction = (jobId) => request(`/api/pdf-char-extraction/jobs/${jobId}/cancel?metadataOnly=true`, { method: "POST" });
export const getPdfCharExtractionJob = (jobId) => request(`/api/pdf-char-extraction/jobs/${jobId}?metadataOnly=true`);
export const getPdfCharDefinitions = (jobId, { pageNumber = null, limit = null } = {}) => {
  const query = new URLSearchParams();
  if (Number.isInteger(Number(pageNumber)) && Number(pageNumber) > 0) query.set("pageNumber", String(Number(pageNumber)));
  if (Number.isInteger(Number(limit)) && Number(limit) > 0) query.set("limit", String(Number(limit)));
  return request(`/api/pdf-char-extraction/jobs/${jobId}/definitions${query.size ? `?${query}` : ""}`);
};
export const getPdfCharInstances = (jobId, { pageNumber = null, offset = 0, limit = 20 } = {}) => {
  const query = new URLSearchParams({ offset: String(offset), limit: String(limit) });
  if (Number.isInteger(Number(pageNumber)) && Number(pageNumber) > 0) query.set("pageNumber", String(Number(pageNumber)));
  return request(`/api/pdf-char-extraction/jobs/${jobId}/instances?${query}`);
};
