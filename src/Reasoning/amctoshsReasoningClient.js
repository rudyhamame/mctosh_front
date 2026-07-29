// amctoshsReasoningClient.js
//
// Thin fetch wrapper for the AMCTOSHS Reasoning backend
// (back/routes/AmctoshsReasoningAPI.js) — same authHeaders/jsonHeaders/
// parseJsonResponse convention as ClinicalSchemata/amctoshsMorpheClient.js.
// Extraction input here is a set of already-saved Morphe Trace/Schema
// ids (traceIds/schemaIds), never raw text.

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

/** Everything this user has SAVED in AMCTOSHS Reasoning — {reasoningEntities, relations}. */
export const listReasoning = async () => {
  const res = await fetch(apiUrl("/api/amctoshs-reasoning/"), { headers: authHeaders() });
  return parseJsonResponse(res);
};

/** Runs the AI extraction over the given already-saved Morphe Trace/Schema ids. Never auto-saves. */
export const createReasoningExtraction = async ({ traceIds = [], schemaIds = [], provider, model }) => {
  const res = await fetch(apiUrl("/api/amctoshs-reasoning/extractions"), {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ traceIds, schemaIds, provider, model }),
  });
  return parseJsonResponse(res);
};

export const listReasoningExtractions = async () => {
  const res = await fetch(apiUrl("/api/amctoshs-reasoning/extractions"), { headers: authHeaders() });
  return parseJsonResponse(res);
};

export const getReasoningExtraction = async (id) => {
  const res = await fetch(apiUrl(`/api/amctoshs-reasoning/extractions/${id}`), { headers: authHeaders() });
  return parseJsonResponse(res);
};

/** reviewedItems: [{tempId, decision, editedFields?}] */
export const reviewReasoningExtraction = async (id, reviewedItems) => {
  const res = await fetch(apiUrl(`/api/amctoshs-reasoning/extractions/${id}/review`), {
    method: "PATCH",
    headers: jsonHeaders(),
    body: JSON.stringify({ reviewedItems }),
  });
  return parseJsonResponse(res);
};

export const saveReasoningExtraction = async (id, tempIds) => {
  const res = await fetch(apiUrl(`/api/amctoshs-reasoning/extractions/${id}/save`), {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ tempIds }),
  });
  return parseJsonResponse(res);
};

export const reasoningEntities = {
  get: async (id) => parseJsonResponse(await fetch(apiUrl(`/api/amctoshs-reasoning/reasoning-entities/${id}`), { headers: authHeaders() })),
  update: async (id, patch) => parseJsonResponse(await fetch(apiUrl(`/api/amctoshs-reasoning/reasoning-entities/${id}`), {
    method: "PATCH", headers: jsonHeaders(), body: JSON.stringify(patch),
  })),
  remove: async (id) => parseJsonResponse(await fetch(apiUrl(`/api/amctoshs-reasoning/reasoning-entities/${id}`), {
    method: "DELETE", headers: authHeaders(),
  })),
};
