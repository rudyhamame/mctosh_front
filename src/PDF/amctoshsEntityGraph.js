// amctoshsEntityGraph.js
//
// Shared AMCTOSHS Entity infrastructure — reconstructs the
// Domain → Sub-Entity Schema → Trace → Trace Value hierarchy from the flat
// list of AmctoshsEntity records the Entity Builder persists. This is the
// core of what makes the AMCTOSHS Morphe page a genuine "global
// representational container" rather than a second, incompatible schema
// browser: it reads the SAME records EntityBuilderPanel.jsx writes,
// through the SAME name-based linking that panel's own `schemaOptions`
// already uses (case-insensitive match on a schema's `name`) — no new
// backend model, no ID-based foreign keys added.
//
// Why name-based, not ID-based: `trace_value` records don't carry a
// `parentSchema` field at all (only `trace`/`instance` types do) — they
// only carry `traceName`, a free-typed string. So a trace_value's schema
// is resolved by finding a `trace`-type record with a matching name and
// reading ITS parentSchema. This mirrors a real gap in the current data
// model rather than papering over it — see `unlinkedRows` below.
//
// Nothing here ever collapses/overwrites a value: every trace_value /
// instance / intervener record the backend has ever stored for a trace
// becomes its own row, timestamped by when it was created (`createdAt`) —
// there is no PATCH/update endpoint for these records, so the backend
// itself already guarantees full history is preserved; this module's job
// is purely to group and order what's already there.

import { ENTITY_DOMAINS, VALUE_BEARING_TYPES } from "./entityBuilderConstants";

const norm = (value) => (value || "").trim().toLowerCase();

/**
 * @param {Array} entities - serialized AmctoshsEntity records (as returned by listAmctoshsEntities())
 * @returns {{
 *   byDomain: Map<string, Array<{ id, name, domain, key, traceDefinitions: string[], traceRows: Array }>>,
 *   unlinkedRows: Array,
 * }}
 */
export const buildAmctoshsMorpheIndex = (entities) => {
  const list = Array.isArray(entities) ? entities : [];

  // Sub-Entity Schemas — one canonical schema per case-insensitive name,
  // first-created wins (same dedup EntityBuilderPanel.jsx's schemaOptions
  // already applies when populating its own "Preexisting Entity Schema"
  // dropdown, so a trace built against "Heart" in the PDF Reader lands
  // under the exact same schema Morphe shows).
  const schemasByKey = new Map();
  for (const e of list) {
    if (e.type !== "schema" || !e.name) continue;
    const key = norm(e.name);
    if (!schemasByKey.has(key)) schemasByKey.set(key, e);
  }

  // Trace definitions (type "trace") — name -> parent schema key. Used
  // only to resolve trace_value rows, which have no parentSchema of their
  // own (see module comment above).
  const traceParentByKey = new Map();
  const traceDefsBySchemaKey = new Map();
  for (const e of list) {
    if (e.type !== "trace" || !e.name) continue;
    const traceKey = norm(e.name);
    const schemaKey = norm(e.parentSchema);
    if (!traceParentByKey.has(traceKey)) traceParentByKey.set(traceKey, schemaKey);
    if (schemaKey) {
      if (!traceDefsBySchemaKey.has(schemaKey)) traceDefsBySchemaKey.set(schemaKey, new Set());
      traceDefsBySchemaKey.get(schemaKey).add(e.name);
    }
  }

  const rowsBySchemaKey = new Map();
  const unlinkedRows = [];

  for (const e of list) {
    if (!VALUE_BEARING_TYPES.includes(e.type) || !e.traceName) continue;

    // Resolve which schema this reading belongs to: prefer the record's
    // own parentSchema (instance/intervener may carry one directly),
    // otherwise fall back to the trace DEFINITION's parentSchema.
    let schemaKey = e.parentSchema ? norm(e.parentSchema) : "";
    if (!schemaKey || !schemasByKey.has(schemaKey)) {
      const viaTrace = traceParentByKey.get(norm(e.traceName));
      schemaKey = viaTrace && schemasByKey.has(viaTrace) ? viaTrace : "";
    }

    const row = {
      id: e.id,
      timestamp: e.createdAt,
      trace: e.traceName,
      value: e.value,
      unit: e.unit,
      typeKey: e.type,
      typeLabel: e.typeLabel,
    };

    if (schemaKey) {
      if (!rowsBySchemaKey.has(schemaKey)) rowsBySchemaKey.set(schemaKey, []);
      rowsBySchemaKey.get(schemaKey).push(row);
    } else {
      unlinkedRows.push(row);
    }
  }

  const sortAsc = (rows) => rows.slice().sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  const byDomain = new Map();
  for (const domain of ENTITY_DOMAINS) byDomain.set(domain, []);

  for (const [key, schema] of schemasByKey) {
    const domain = ENTITY_DOMAINS.includes(schema.domain) ? schema.domain : "Unassigned Domain";
    if (!byDomain.has(domain)) byDomain.set(domain, []);
    byDomain.get(domain).push({
      id: schema.id,
      name: schema.name,
      domain: schema.domain,
      key,
      traceDefinitions: Array.from(traceDefsBySchemaKey.get(key) || []),
      traceRows: sortAsc(rowsBySchemaKey.get(key) || []),
    });
  }

  for (const list_ of byDomain.values()) list_.sort((a, b) => a.name.localeCompare(b.name));

  return { byDomain, unlinkedRows: sortAsc(unlinkedRows) };
};
