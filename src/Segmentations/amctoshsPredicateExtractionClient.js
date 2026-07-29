// amctoshsPredicateExtractionClient.js
//
// Thin fetch wrapper for the "Extract Predicates" / "Analyze Predicates"
// two-stage linguistic pipeline (back/routes/AMCTOSHSPredicateAPI.js) —
// same authHeaders/jsonHeaders/parseJsonResponse convention as
// ./amctoshsRelationsExtractionClient.js. Both stages are explicitly
// user-triggered button clicks, never fired from a mount/navigation
// effect; neither stage silently persists — only savePredicateAnalysis
// does.

import { apiUrl } from "../config/api";
import { readStoredSession } from "../utils/sessionCleanup";

const authHeaders = () => {
  const session = readStoredSession();
  return session?.token ? { Authorization: `Bearer ${session.token}` } : {};
};
const jsonHeaders = () => ({ "Content-Type": "application/json", ...authHeaders() });

const parseJsonResponse = async (res) => {
  const data = await res.json().catch(() => ({}));
  if (data.error) {
    const message = data.error.message || data.error || `Request failed (${res.status}).`;
    throw Object.assign(new Error(message), data);
  }
  if (!res.ok) throw new Error(`Request failed (${res.status}).`);
  return data;
};

// ── Stage 1: Predicate Extraction ───────────────────────────────────────

/** Runs Predicate Extraction over one or more selected AMCTOSHS Segments. Never auto-saves. */
export const createPredicateExtraction = async ({ segments, provider, model }) => {
  const res = await fetch(apiUrl("/api/amctoshs-predicates/extractions"), {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ segments, provider, model }),
  });
  return parseJsonResponse(res);
};

export const listPredicateExtractions = async () => {
  const res = await fetch(apiUrl("/api/amctoshs-predicates/extractions"), { headers: authHeaders() });
  return parseJsonResponse(res);
};

export const getPredicateExtraction = async (id) => {
  const res = await fetch(apiUrl(`/api/amctoshs-predicates/extractions/${id}`), { headers: authHeaders() });
  return parseJsonResponse(res);
};

/** reviewedItems: [{tempId, decision, editedFields?}] */
export const reviewPredicateExtraction = async (id, reviewedItems) => {
  const res = await fetch(apiUrl(`/api/amctoshs-predicates/extractions/${id}/review`), {
    method: "PATCH",
    headers: jsonHeaders(),
    body: JSON.stringify({ reviewedItems }),
  });
  return parseJsonResponse(res);
};

// ── Stage 2: Predicate Analysis ─────────────────────────────────────────

/** Runs Predicate Analysis over the given extraction's accepted predicate assertions. */
export const analyzePredicateExtraction = async (extractionId, { provider, model } = {}) => {
  const res = await fetch(apiUrl(`/api/amctoshs-predicates/extractions/${extractionId}/analyze`), {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ provider, model }),
  });
  return parseJsonResponse(res);
};

export const getPredicateAnalysis = async (id) => {
  const res = await fetch(apiUrl(`/api/amctoshs-predicates/analyses/${id}`), { headers: authHeaders() });
  return parseJsonResponse(res);
};

/** reviewedItems: [{tempId, decision, editedFields?}] */
export const reviewPredicateAnalysis = async (id, reviewedItems) => {
  const res = await fetch(apiUrl(`/api/amctoshs-predicates/analyses/${id}/review`), {
    method: "PATCH",
    headers: jsonHeaders(),
    body: JSON.stringify({ reviewedItems }),
  });
  return parseJsonResponse(res);
};

/** Promotes the given accepted/edited-accepted tempIds into AMCTOSHSLinguisticPredicate. */
export const savePredicateAnalysis = async (id, tempIds) => {
  const res = await fetch(apiUrl(`/api/amctoshs-predicates/analyses/${id}/save`), {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ tempIds }),
  });
  return parseJsonResponse(res);
};
