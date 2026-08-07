import React from "react";
import { DOMAIN_LABELS } from "./amctoshsMorpheConstants";

export const ENTITY_TABS = [
  { key: "schemas", label: "Schemata" },
  { key: "instances", label: "Instances" },
  { key: "traces", label: "Traces" },
  { key: "textRelations", label: "Relations" },
];

const formatDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// Middle panel — within the active domain (or "all"), list Schemata /
// Instances / Trace Schemata / Trace Instances (one sub-tab at a time),
// each with the specific fields the AMCTOSHS spec calls out per type.
// Relations (free-text, saved by "Extract AMCTOSHS Relations") have no
// AMCTOSHS Domain of their own — that tab always shows the full list,
// ignoring `activeDomain`.
export default function MorpheEntityNav({
  index, activeDomain, activeEntityType, onSelectEntityType,
  selectedItemId, onSelectItem, textRelations = [], showTabs = true,
}) {
  const groups = activeDomain === "all"
    ? [...index.byDomain.values()]
    : (index.byDomain.get(activeDomain) ? [index.byDomain.get(activeDomain)] : []);

  const schemas = groups.flatMap((g) => g.schemas);
  const instances = groups.flatMap((g) => g.instances);
  const traceSchemas = groups.flatMap((g) => g.traceSchemas);
  const traceInstances = groups.flatMap((g) => g.traceInstances);

  const counts = {
    schemas: schemas.length, instances: instances.length,
    traces: traceSchemas.length + traceInstances.length,
    textRelations: textRelations.length,
  };

  return (
    <div id="mrp_entity_nav">
      {showTabs && <MorpheEntityTabs activeEntityType={activeEntityType} onSelectEntityType={onSelectEntityType} counts={counts} />}

      <div id="mrp_entity_list">
        {activeEntityType === "schemas" && (
          schemas.length === 0 ? (
            <p className="mrp_empty_hint">No AMCTOSHS Sub-Entity Schemata in this domain yet.</p>
          ) : schemas.map((s) => {
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

        {activeEntityType === "instances" && (
          instances.length === 0 ? (
            <p className="mrp_empty_hint">No AMCTOSHS Sub-Entity Instances in this domain yet.</p>
          ) : instances.map((i) => (
            <button
              key={i._id}
              type="button"
              className={`mrp_entity_row${selectedItemId === i._id ? " mrp_entity_row--active" : ""}`}
              onClick={() => onSelectItem("instances", i._id)}
            >
              <span className="mrp_entity_row_name">{i.instanceName}</span>
              <span className="mrp_entity_row_meta">
                {i.patientId && <span className="mrp_count_chip" title="Patient identifier">{i.patientId}</span>}
                {(i.validFrom || i.validTo) && (
                  <span className="mrp_count_chip" title="Temporal validity">
                    {formatDate(i.validFrom) || "…"} → {formatDate(i.validTo) || "…"}
                  </span>
                )}
              </span>
            </button>
          ))
        )}

        {(activeEntityType === "traces" || activeEntityType === "traceSchemas") && (
          traceSchemas.length === 0 ? (
            activeEntityType === "traces" ? null : <p className="mrp_empty_hint">No AMCTOSHS Trace Schemata in this domain yet.</p>
          ) : traceSchemas.map((ts) => {
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

        {(activeEntityType === "traces" || activeEntityType === "traceInstances") && (
          traceInstances.length === 0 ? (
            activeEntityType === "traces" ? null : <p className="mrp_empty_hint">No AMCTOSHS Trace Instances in this domain yet.</p>
          ) : traceInstances.map((ti) => (
            <button
              key={ti._id}
              type="button"
              className={`mrp_entity_row${selectedItemId === ti._id ? " mrp_entity_row--active" : ""}`}
              onClick={() => onSelectItem("traceInstances", ti._id)}
            >
              <span className="mrp_entity_row_name">{ti.sourceInstanceName || "(unresolved source)"}</span>
              <span className="mrp_entity_row_meta">
                {ti.observation?.value != null && (
                  <span className="mrp_count_chip" title="Observed value">
                    {ti.observation.value}{ti.observation.unit ? ` ${ti.observation.unit}` : ""}
                  </span>
                )}
                {ti.temporality?.observedAt && <span className="mrp_count_chip">{formatDate(ti.temporality.observedAt)}</span>}
                <span className={`mrp_status_chip mrp_status_chip--${ti.traceStatus}`}>{ti.traceStatus}</span>
              </span>
            </button>
          ))
        )}
        {activeEntityType === "traces" && traceSchemas.length === 0 && traceInstances.length === 0 && (
          <p className="mrp_empty_hint">No AMCTOSHS Traces in this domain yet.</p>
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
      {ENTITY_TABS.map(({ key, label }) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={activeEntityType === key}
          className={`mrp_entity_tab${activeEntityType === key ? " mrp_entity_tab--active" : ""}`}
          onClick={() => onSelectEntityType(key)}
        >
          {label}
          <span className="mrp_entity_tab_count">{counts[key]}</span>
        </button>
      ))}
    </div>
  );
}
