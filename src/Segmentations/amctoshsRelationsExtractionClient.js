// amctoshsRelationsExtractionClient.js
//
// Thin fetch wrapper for "Extract RabbitHole Relations"
// (back/routes/AMCTOSHSRelationsExtractionAPI.js) — same authHeaders/
// jsonHeaders/parseJsonResponse convention as
// ../ClinicalSchemata/amctoshsMorpheClient.js. Extraction is explicitly
// user-triggered (the "Extract RabbitHole Relations" button click), never
// fired from a mount/navigation effect; extraction never silently
// persists into the typed collections, only saveRelationsExtraction does.

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

/** Runs the AI extraction over one or more selected RabbitHole Segments. Never auto-saves. */
export const createRelationsExtraction = async ({ segments, provider, model }) => {
  const res = await fetch(apiUrl("/api/amctoshs-relations-extraction/extractions"), {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ segments, provider, model }),
  });
  return parseJsonResponse(res);
};

export const listRelationsExtractions = async () => {
  const res = await fetch(apiUrl("/api/amctoshs-relations-extraction/extractions"), { headers: authHeaders() });
  return parseJsonResponse(res);
};

export const getRelationsExtraction = async (id) => {
  const res = await fetch(apiUrl(`/api/amctoshs-relations-extraction/extractions/${id}`), { headers: authHeaders() });
  return parseJsonResponse(res);
};

/** reviewedItems: [{tempId, decision, editedFields?}] */
export const reviewRelationsExtraction = async (id, reviewedItems) => {
  const res = await fetch(apiUrl(`/api/amctoshs-relations-extraction/extractions/${id}/review`), {
    method: "PATCH",
    headers: jsonHeaders(),
    body: JSON.stringify({ reviewedItems }),
  });
  return parseJsonResponse(res);
};

/** Promotes the given accepted/edited-accepted tempIds into the real typed collections. */
export const saveRelationsExtraction = async (id, tempIds) => {
  const res = await fetch(apiUrl(`/api/amctoshs-relations-extraction/extractions/${id}/save`), {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ tempIds }),
  });
  return parseJsonResponse(res);
};
