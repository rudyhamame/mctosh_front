// pdfPageStructureClient.js
//
// Thin fetch wrapper for the AI page-segmentation backend
// (back/routes/PdfPageStructureAPI.js) — same authHeaders/jsonHeaders
// convention already used throughout front/src/PDF (EntityBuilderPanel.jsx,
// the previous PdfNarrativeView.jsx). Kept separate from PdfNarrativeView.jsx
// so the component stays a UI/state coordinator, not an API-logic file.
//
// Every call here is either read-only (getPageStructure) or an explicit
// user-triggered action (resolveDocumentId once per loaded PDF, segmentPage
// only on an "AI Segment Page" click, saveDraft only on "Save",
// discardDraft only on "Reset"/"Discard") — nothing here is ever called
// from a mount/navigation effect on its own initiative.

import { apiUrl } from "../config/api";
import { readStoredSession } from "../utils/sessionCleanup";
import { trackPyMuPDFActivity } from "./pymupdfActivity";

const authHeaders = () => {
  const session = readStoredSession();
  return session?.token ? { Authorization: `Bearer ${session.token}` } : {};
};
const jsonHeaders = () => ({ "Content-Type": "application/json", ...authHeaders() });

const parseJsonResponse = async (res) => {
  const data = await res.json().catch(() => ({}));
  if (data.error) {
    const message = data.error.message || data.error || `Request failed (${res.status}).`;
    const details = Array.isArray(data.error.details)
      ? data.error.details
      : Array.isArray(data.details) ? data.details : [];
    throw new Error(details.length ? `${message} ${details.join("; ")}` : message);
  }
  if (!res.ok) throw new Error(`Request failed (${res.status}).`);
  return data;
};

const isObjectId = (value) => /^[a-f\d]{24}$/i.test(String(value || "").trim());
const documentResolutionCache = new Map();
const MAX_DOCUMENT_RESOLUTION_CACHE_ENTRIES = 32;

/**
 * Get-or-create a stable documentId for (user, filename) — no AI/extraction,
 * safe to call once per loaded PDF. `sourceId`, when the PDF is backed by
 * a saved Source, lets the backend resolve real PDF bytes for the hybrid
 * extraction pipeline (native PyMuPDF/Docling geometry now happens
 * server-side — see segmentPage's own comment on why it no longer sends
 * pageImageBase64/elements). A locally-opened PDF with no Source can
 * still resolve a documentId (to read any structure saved under this
 * filename previously), it just can't freshly segment — /segment 422s
 * with a clear message in that case.
 */
export const resolveDocumentId = async ({ filename, pageCount, type, sourceId }) => {
  const payload = { filename, pageCount, type };
  if (String(sourceId || "").trim()) payload.sourceId = String(sourceId).trim();
  const session = readStoredSession();
  const sessionKey = session?.my_id || session?.token || "anonymous";
  const identityKey = payload.sourceId
    ? `${sessionKey}:source:${payload.sourceId}:${pageCount}`
    : `${sessionKey}:local:${String(filename).trim()}:${pageCount}`;
  if (!documentResolutionCache.has(identityKey)) {
    const request = fetch(apiUrl("/api/pdf-page-structure/resolve-document"), {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify(payload),
    }).then(parseJsonResponse).then((data) => data.documentId);
    documentResolutionCache.set(identityKey, request);
    while (documentResolutionCache.size > MAX_DOCUMENT_RESOLUTION_CACHE_ENTRIES) {
      documentResolutionCache.delete(documentResolutionCache.keys().next().value);
    }
    request.catch(() => documentResolutionCache.delete(identityKey));
  }
  return documentResolutionCache.get(identityKey);
};

/** Read-only — loads existing draft/saved structure (+ each slot's own schemaVersion/legacy flag). NEVER triggers extraction/AI. Safe to call on page navigation / Narrative Mode open. */
export const getPageStructure = async (documentId, pageNumber) => {
  const res = await fetch(apiUrl(`/api/pdf-page-structure/${documentId}/${pageNumber}`), { headers: authHeaders() });
  return parseJsonResponse(res);
};

export const getPdfNavigation = async (documentId) => {
  const res = await fetch(apiUrl(`/api/pdf-page-structure/${documentId}/navigation`), { headers: authHeaders() });
  return parseJsonResponse(res);
};

export const savePdfNavigation = async (documentId, navigation) => {
  const res = await fetch(apiUrl(`/api/pdf-page-structure/${documentId}/navigation`), {
    method: "PATCH",
    headers: jsonHeaders(),
    body: JSON.stringify(navigation),
  });
  return parseJsonResponse(res);
};

/** Read-only extraction evidence for one page: native geometry + Docling layout, with no draft/save side effects. */
export const getPageExtractionEvidence = async (documentId, pageNumber, { nativeOnly = false, forensics = false } = {}) => {
  if (!isObjectId(documentId)) {
    throw new Error("PDF extraction is unavailable until the document identity is resolved.");
  }
  // raw-glyphs-v2 distinguishes the character-aware native payload from
  // older cached span-only responses that cannot repair synthetic spaces.
  const query = new URLSearchParams({ format: "raw-glyphs-v2" });
  if (nativeOnly) query.set("nativeOnly", "1");
  if (forensics) query.set("forensics", "1");
  return trackPyMuPDFActivity(async () => {
    const res = await fetch(apiUrl(`/api/pdf-page-structure/${documentId}/${pageNumber}/extraction?${query}`), {
      headers: authHeaders(),
      cache: "no-store",
    });
    return parseJsonResponse(res);
  });
};

/**
 * The ONLY extraction-triggering call (native geometry + Docling always;
 * AI only if the backend's own deterministic fusion pass flags genuine
 * ambiguities). Writes draft only, never saved. Deliberately does NOT
 * send pageImageBase64/elements anymore — native extraction now happens
 * server-side from the source's own real PDF bytes (PyMuPDF), which is
 * strictly more authoritative than the client's own PDF.js item list, so
 * sending a redundant client-side extraction added payload/latency for no
 * benefit. The backend 422s with a clear message if this PDF has no
 * resolvable Source (see resolveDocumentId's own comment).
 */
export const segmentPage = async (documentId, pageNumber, { requestId, provider, model }) => {
  return trackPyMuPDFActivity(async () => {
    const res = await fetch(apiUrl(`/api/pdf-page-structure/${documentId}/${pageNumber}/segment`), {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ requestId, provider, model }),
    });
    return parseJsonResponse(res);
  });
};

/** Promotes the current draft to saved. */
export const saveDraft = async (documentId, pageNumber) => {
  const res = await fetch(apiUrl(`/api/pdf-page-structure/${documentId}/${pageNumber}/save`), {
    method: "POST",
    headers: authHeaders(),
  });
  return parseJsonResponse(res);
};

/** Clears the pending draft only; saved (if any) is untouched. */
export const discardDraft = async (documentId, pageNumber) => {
  const res = await fetch(apiUrl(`/api/pdf-page-structure/${documentId}/${pageNumber}/discard-draft`), {
    method: "POST",
    headers: authHeaders(),
  });
  return parseJsonResponse(res);
};

/** Deletes BOTH draft and saved — the "start over" action. Reverts the page to NOT_SEGMENTED. The original PDF is never touched. */
export const deleteStructure = async (documentId, pageNumber) => {
  const res = await fetch(apiUrl(`/api/pdf-page-structure/${documentId}/${pageNumber}`), {
    method: "DELETE",
    headers: authHeaders(),
  });
  return parseJsonResponse(res);
};
