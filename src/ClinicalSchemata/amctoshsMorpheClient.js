// amctoshsMorpheClient.js
//
// Thin fetch wrapper for the RabbitHole Morphe backend
// (back/routes/AmctoshsMorpheAPI.js) — browse/CRUD only. The extraction
// action ("Extract RabbitHole Relations") lives on the RabbitHole
// Segmentation page instead — see
// ../Segmentations/amctoshsRelationsExtractionClient.js. Same
// authHeaders/jsonHeaders/parseJsonResponse convention as that file.

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

/** Everything this user has SAVED in RabbitHole Morphe — {schemas, instances, traceSchemas, traceInstances, relations}. */
export const listMorphe = async () => {
  const res = await fetch(apiUrl("/api/amctoshs-morphe/"), { headers: authHeaders() });
  return parseJsonResponse(res);
};

/** Lightweight Schema-name hydrate used by the PDF reader's word markers. */
export const listMorpheSchemaNames = async () => {
  const res = await fetch(apiUrl("/api/amctoshs-morphe/schema-names"), { headers: authHeaders() });
  return parseJsonResponse(res);
};

export const listMorpheSources = async () => {
  const res = await fetch(apiUrl("/api/sources/"), { headers: authHeaders() });
  const data = await parseJsonResponse(res);
  return data.sources || [];
};

/** Create a one-word or multi-word Schema from a Smart Pen stroke, or return its existing match. */
export const upsertSmartPenSchema = async ({ name, sourceId, page }) => {
  const res = await fetch(apiUrl("/api/amctoshs-morphe/schemas/smart-pen"), {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ name, sourceId, page }),
  });
  return parseJsonResponse(res);
};

/** Save a directional Smart Pen far-end word as a Trace Schema for a Schema word. */
export const upsertSmartPenTrace = async ({ name, sourceSchemaId, sourceSchemaName, sourceId, page, traceDimension = "3D" }) => {
  const res = await fetch(apiUrl("/api/amctoshs-morphe/trace-schemas/smart-pen"), {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ name, sourceSchemaId, sourceSchemaName, sourceId, page, traceDimension }),
  });
  return parseJsonResponse(res);
};

const typedCrud = (resource) => ({
  create: async (payload) => parseJsonResponse(await fetch(apiUrl(`/api/amctoshs-morphe/${resource}`), {
    method: "POST", headers: jsonHeaders(), body: JSON.stringify(payload),
  })),
  get: async (id) => parseJsonResponse(await fetch(apiUrl(`/api/amctoshs-morphe/${resource}/${id}`), { headers: authHeaders() })),
  update: async (id, patch) => parseJsonResponse(await fetch(apiUrl(`/api/amctoshs-morphe/${resource}/${id}`), {
    method: "PATCH", headers: jsonHeaders(), body: JSON.stringify(patch),
  })),
  remove: async (id) => parseJsonResponse(await fetch(apiUrl(`/api/amctoshs-morphe/${resource}/${id}`), {
    method: "DELETE", headers: authHeaders(),
  })),
});

export const morpheSchemas = typedCrud("schemas");
export const morpheInstances = typedCrud("instances");
export const morpheTraceSchemas = typedCrud("trace-schemas");
export const morpheTraceInstances = typedCrud("trace-instances");
export const morpheTextRelations = typedCrud("text-relations");
