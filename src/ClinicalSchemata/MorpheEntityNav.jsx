import React from "react";
import { DOMAIN_LABELS, MORPHE_OBJECT_MODES } from "./amctoshsMorpheConstants";

export const MORPHE_MODE_GROUPS = [
  {
    key: "objects",
    label: "AMCTOSHS Objects",
    children: MORPHE_OBJECT_MODES.map(({ domain, label }) => [`object:${domain}`, label]),
  },
  {
    key: "3d",
    label: "AMCTOSHS in 3D",
    children: [
      ["traceSchemas3d", "3D TRACE (sub-instance)", "One 3D trace of an AMCTOSHS object with a value at a specific time."],
      ["instances", "INSTANCES", "All 3D traces with their values at a specific time."],
    ],
  },
  {
    key: "4d",
    label: "AMCTOSHS in 4D",
    children: [
      ["textRelations", "RELATIONS", "The order of the change in value for each 3D trace of an object."],
      ["traceSchemas4d", "4D TRACE (sub-schema)", "A thread of relational values of a specific 3D Trace of an AMCTOSHS object at many points of time."],
      ["schemas", "SCHEMATA", "All 4D traces with their values at all points of time."],
    ],
  },
];

const formatDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// Lists the records represented by the active grouped Morphe mode.
export default function MorpheEntityNav({
  index, activeEntityType, onSelectEntityType,
  selectedItemId, onSelectItem, textRelations = [], showTabs = true,
}) {
  const groups = [...index.byDomain.values()];

  const schemas = groups.flatMap((g) => g.schemas);
  const traceSchemas = groups.flatMap((g) => g.traceSchemas);
  const traceInstances = groups.flatMap((g) => g.traceInstances);
  const objectDomain = activeEntityType.startsWith("object:") ? activeEntityType.slice("object:".length) : null;
  const objectSchemas = objectDomain ? schemas.filter((schema) => schema.domain === objectDomain) : [];
  const traceSchemas4d = traceSchemas.filter((trace) => String(trace.traceDimension || "3D").toUpperCase() === "4D");
  const traceSchemas3d = traceSchemas.filter((trace) => String(trace.traceDimension || "3D").toUpperCase() === "3D");
  const traceInstances3d = traceInstances.filter((trace) => {
    const parent = index.traceSchemasById?.get(String(trace.traceSchemaId));
    return String(parent?.traceDimension || "3D").toUpperCase() === "3D";
  });

  const counts = {
    schemas: schemas.length,
    instances: traceInstances3d.length,
    traceSchemas4d: traceSchemas4d.length,
    traceSchemas3d: traceSchemas3d.length,
    textRelations: textRelations.length,
  };
  for (const { domain } of MORPHE_OBJECT_MODES) {
    counts[`object:${domain}`] = schemas.filter((schema) => schema.domain === domain).length;
  }

  return (
    <div id="mrp_entity_nav">
      {showTabs && <MorpheEntityTabs activeEntityType={activeEntityType} onSelectEntityType={onSelectEntityType} counts={counts} />}

      <div id="mrp_entity_list">
        {objectDomain && (
          objectSchemas.length === 0 ? (
            <p className="mrp_empty_hint">No saved AMCTOSHS {DOMAIN_LABELS[objectDomain] || objectDomain} objects yet.</p>
          ) : objectSchemas.map((s) => {
            const { instanceCount, traceSchemaCount } = index.schemaCounts(s);
            return (
              <button
                key={s._id}
                type="button"
                className={`mrp_entity_row${selectedItemId === s._id ? " mrp_entity_row--active" : ""}`}
                onClick={() => onSelectItem("schemas", s._id)}
              >
                <span className="mrp_entity_row_name">{s.name}</span>
                <span className="mrp_entity_row_meta">
                  <span className="mrp_status_chip" title="Extraction status">{s.epistemicStatus}</span>
                  <span className="mrp_count_chip" title="Instances">{instanceCount} inst.</span>
                  <span className="mrp_count_chip" title="Trace schemata">{traceSchemaCount} trace schemata</span>
                </span>
              </button>
            );
          })
        )}

        {activeEntityType === "schemas" && (
          schemas.length === 0 ? (
            <p className="mrp_empty_hint">No AMCTOSHS Schemata are saved yet.</p>
          ) : schemas.map((s) => {
            const { instanceCount, traceSchemaCount } = index.schemaCounts(s);
            return (
              <button key={s._id} type="button" className={`mrp_entity_row${selectedItemId === s._id ? " mrp_entity_row--active" : ""}`} onClick={() => onSelectItem("schemas", s._id)}>
                <span className="mrp_entity_row_name">{s.name}</span>
                <span className="mrp_entity_row_meta">
                  <span className="mrp_status_chip">{s.epistemicStatus}</span>
                  <span className="mrp_count_chip">{instanceCount} inst.</span>
                  <span className="mrp_count_chip">{traceSchemaCount} traces</span>
                </span>
              </button>
            );
          })
        )}

        {activeEntityType === "instances" && (
          traceInstances3d.length === 0 ? (
            <p className="mrp_empty_hint">No AMCTOSHS Instances are saved yet.</p>
          ) : traceInstances3d.map((instance) => (
            <button
              key={instance._id}
              type="button"
              className={`mrp_entity_row${selectedItemId === instance._id ? " mrp_entity_row--active" : ""}`}
              onClick={() => onSelectItem("traceInstances", instance._id)}
            >
              <span className="mrp_entity_row_name">{instance.sourceInstanceName || "(unresolved source)"}</span>
              <span className="mrp_entity_row_meta">
                {instance.observation?.value != null && <span className="mrp_count_chip">{instance.observation.value}{instance.observation.unit ? ` ${instance.observation.unit}` : ""}</span>}
                {instance.temporality?.observedAt && <span className="mrp_count_chip">{formatDate(instance.temporality.observedAt)}</span>}
                <span className={`mrp_status_chip mrp_status_chip--${instance.traceStatus}`}>{instance.traceStatus}</span>
              </span>
            </button>
          ))
        )}

        {activeEntityType === "traceSchemas4d" && (
          traceSchemas4d.length === 0 ? (
            <p className="mrp_empty_hint">No AMCTOSHS 4D Traces are saved yet.</p>
          ) : traceSchemas4d.map((ts) => {
            const { traceInstanceCount } = index.traceSchemaCounts(ts);
            return (
              <button
                key={ts._id}
                type="button"
                className={`mrp_entity_row${selectedItemId === ts._id ? " mrp_entity_row--active" : ""}`}
                onClick={() => onSelectItem("traceSchemas", ts._id)}
              >
                <span className="mrp_entity_row_name">
                  {ts.name}
                  {ts.phenomenon?.name ? ` — ${ts.phenomenon.name}` : ""}
                </span>
                <span className="mrp_entity_row_meta">
                  <span className="mrp_count_chip">{DOMAIN_LABELS[ts.domainOfAccess] || ts.domainOfAccess}</span>
                  <span className="mrp_count_chip" title="Source schema">from: {ts.sourceSchemaName || "?"}</span>
                  {ts.moa?.name && <span className="mrp_count_chip" title="Means of access">{ts.moa.name}</span>}
                  <span className="mrp_count_chip" title="Trace instances">{traceInstanceCount} instances</span>
                  <span className={`mrp_status_chip mrp_status_chip--${ts.epistemicStatus}`}>{ts.epistemicStatus}</span>
                </span>
              </button>
            );
          })
        )}

        {activeEntityType === "traceSchemas3d" && (
          traceSchemas3d.length === 0 ? (
            <p className="mrp_empty_hint">No AMCTOSHS 3D Traces are saved yet.</p>
          ) : traceSchemas3d.map((trace) => (
            <button
              key={trace._id}
              type="button"
              className={`mrp_entity_row${selectedItemId === trace._id ? " mrp_entity_row--active" : ""}`}
              onClick={() => onSelectItem("traceSchemas", trace._id)}
            >
              <span className="mrp_entity_row_name">{trace.traceId ? `${trace.traceId} — ` : ""}{trace.name}</span>
              <span className="mrp_entity_row_meta">
                <span className="mrp_count_chip">{trace.moa?.biologicalSensor || trace.moa?.name || "No sensor"}</span>
                <span className="mrp_count_chip">{trace.moa?.accessMethod || "No access method"}</span>
                {trace.moa?.proxySourceName && <span className="mrp_count_chip">via {trace.moa.proxySourceName}</span>}
                <span className="mrp_count_chip">from {trace.sourceSchemaName || "unknown object"}</span>
              </span>
            </button>
          ))
        )}
        {activeEntityType === "textRelations" && (
          textRelations.length === 0 ? (
            <p className="mrp_empty_hint">No AMCTOSHS Relations saved yet — extract some from AMCTOSHS Segmentation first.</p>
          ) : textRelations.map((r) => (
            <button
              key={r._id}
              type="button"
              className={`mrp_entity_row${selectedItemId === r._id ? " mrp_entity_row--active" : ""}`}
              onClick={() => onSelectItem("textRelations", r._id)}
            >
              <span className="mrp_entity_row_name">{r.subject} —{r.predicate}→ {r.object}</span>
              <span className="mrp_entity_row_meta">
                <span className={`mrp_status_chip mrp_status_chip--${r.epistemicStatus}`}>{r.epistemicStatus}</span>
                <span className="mrp_count_chip">{r.dependencyStatus === "asserted_dependency" ? "asserted" : "proposed"}</span>
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

export function MorpheEntityTabs({ activeEntityType, onSelectEntityType, counts }) {
  return (
    <div id="mrp_entity_tabs" role="tablist" aria-label="AMCTOSHS Morphe Mode">
      {MORPHE_MODE_GROUPS.map((group) => (
        <section key={group.key} className="mrp_mode_group" aria-label={group.label}>
          <div className="mrp_mode_group_title">{group.label}</div>
          <div className="mrp_mode_group_tabs">
            {group.children.map(([key, label, description]) => (
              <button key={key} type="button" role="tab" title={description || label} aria-selected={activeEntityType === key} className={`mrp_entity_tab${activeEntityType === key ? " mrp_entity_tab--active" : ""}`} onClick={() => onSelectEntityType(key)}>
                {label}
                <span className="mrp_entity_tab_count">{counts[key] || 0}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
