import React from "react";

// Plain relation-list rows — no graph-visualization library exists in this
// app, so the dependency-relations requirement (spec §9/§12) is satisfied
// as a flat list instead: one row per relation the given entity
// participates in, grouped by direction (what it depends on / what
// depends on it). `resolveName(type, id)` looks up a human-readable label
// for the other side of each relation from whichever collection it lives
// in — passed in by the caller since this component has no data-fetching
// of its own.
export default function MorpheRelationList({ entityId, relationsFor, resolveName }) {
  const { outgoing, incoming } = relationsFor(entityId);
  if (!outgoing.length && !incoming.length) {
    return <p className="mrp_empty_hint">No RabbitHole Relations recorded for this item yet.</p>;
  }
  return (
    <div className="mrp_relation_list">
      {outgoing.length > 0 && (
        <div className="mrp_relation_group">
          <div className="mrp_relation_group_label">Depends on / generates</div>
          {outgoing.map((r, i) => (
            <div key={i} className="mrp_relation_row">
              <span className={`mrp_relation_status mrp_relation_status--${r.dependencyStatus === "asserted_dependency" ? "asserted" : "proposed"}`}>
                {r.dependencyStatus === "asserted_dependency" ? "asserted" : "proposed"}
              </span>
              <span className="mrp_relation_predicate">{r.predicate}</span>
              <span className="mrp_relation_target">{resolveName(r.objectType, r.objectId)}</span>
            </div>
          ))}
        </div>
      )}
      {incoming.length > 0 && (
        <div className="mrp_relation_group">
          <div className="mrp_relation_group_label">Supports / is depended on by</div>
          {incoming.map((r, i) => (
            <div key={i} className="mrp_relation_row">
              <span className="mrp_relation_target">{resolveName(r.subjectType, r.subjectId)}</span>
              <span className="mrp_relation_predicate">{r.predicate}</span>
              <span className={`mrp_relation_status mrp_relation_status--${r.dependencyStatus === "asserted_dependency" ? "asserted" : "proposed"}`}>
                {r.dependencyStatus === "asserted_dependency" ? "asserted" : "proposed"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
