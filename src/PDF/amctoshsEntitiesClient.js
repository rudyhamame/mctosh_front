// amctoshsEntitiesClient.js
//
// Shared AMCTOSHS Entity infrastructure — thin fetch wrapper for
// back/routes/AmctoshsEntityAPI.js, used by BOTH EntityBuilderPanel.jsx
// (PDF Reader) and ClinicalSchemata.jsx (AMCTOSHS Morphe). Extracted so
// both consumers hit the exact same endpoints the exact same way rather
// than each keeping its own inline fetch/auth-header logic (which is how
// the two tools drifted apart before Morphe was rebuilt to share this).
//
// GET /api/amctoshs-entities already returns ALL of the current user's
// entities regardless of which PDF/document they were built from — the
// AmctoshsEntity model has no document-scoping field at all — so this is
// already the "global" read Morphe needs; no new backend route required.

import { apiUrl } from "../config/api";
import { readStoredSession } from "../utils/sessionCleanup";

const authHeaders = () => {
  const session = readStoredSession();
  return session?.token ? { Authorization: `Bearer ${session.token}` } : {};
};
const jsonHeaders = () => ({ "Content-Type": "application/json", ...authHeaders() });

/** All of the current user's AMCTOSHS Sub-Entities (schemas, traces, trace values, instances, interveners), across every domain and every document they were built from. */
export const listAmctoshsEntities = async () => {
  const res = await fetch(apiUrl("/api/amctoshs-entities"), { headers: authHeaders() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
  return Array.isArray(data.entities) ? data.entities : [];
};

/** Creates one new AMCTOSHS Sub-Entity record — a new historical reading, never a correction to an existing one. Every trace_value/instance/intervener reading is its own permanent, timestamped record, which is what lets the 4D/temporal history be reconstructed later; recording a changed value should almost always mean calling this again, not updateAmctoshsEntity below. */
export const createAmctoshsEntity = async (draftEntry) => {
  const res = await fetch(apiUrl("/api/amctoshs-entities"), {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(draftEntry),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Failed to save that entity.");
  return data;
};

/** Corrects an existing AMCTOSHS Sub-Entity's own fields in place (e.g. fixing a typo in a value that was mis-entered) — distinct from createAmctoshsEntity, which is how a genuinely new reading at a new point in time gets recorded. Never changes `type` or `sourceText`. */
export const updateAmctoshsEntity = async (id, patch) => {
  const res = await fetch(apiUrl(`/api/amctoshs-entities/${id}`), {
    method: "PATCH",
    headers: jsonHeaders(),
    body: JSON.stringify(patch),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Failed to update that entity.");
  return data;
};

export const deleteAmctoshsEntity = async (id) => {
  const res = await fetch(apiUrl(`/api/amctoshs-entities/${id}`), { method: "DELETE", headers: authHeaders() });
  if (!res.ok) throw new Error(`Request failed (${res.status}).`);
};
