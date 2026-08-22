import React, { useState } from "react";
import MorpheRelationList from "../ClinicalSchemata/MorpheRelationList";

const REASONING_TYPES = [
  "interpreted_event", "calculated_quantity", "derived_property", "classification",
  "diagnosis", "aggregation", "comparison", "temporal_pattern",
  "causal_inference", "risk_estimate", "reference_rule", "other",
];

const EvidencePanel = ({ item }) => (
  <div className="mrp_evidence_block">
    <div className="mrp_evidence_label">Evidence text</div>
    {item.evidenceText?.length ? (
      <ul className="mrp_evidence_list">
        {item.evidenceText.map((line, i) => <li key={i}><mark>{line}</mark></li>)}
      </ul>
    ) : (
      <p className="mrp_empty_hint">No evidence text recorded.</p>
    )}
  </div>
);

// Right panel — the single typed editor RabbitHole Reasoning needs (unlike
// Morphe's 3-way split, there's only one entity kind here). Shows
// editable fields, evidence, and dependency Relations (reusing
// ClinicalSchemata/MorpheRelationList.jsx, which is fully generic —
// entityId/relationsFor/resolveName props, no Morphe-specific coupling).
export default function ReasoningEditor({ item, relationsFor, resolveName, saving, saveError, onSave, onDelete }) {
  if (!item) {
    return (
      <div id="mrp_no_selection">
        <i className="fi fi-rr-brain" />
        <p>Select a Reasoning-dependent entity to view it</p>
      </div>
    );
  }

  return <EntityForm key={item._id} item={item} relationsFor={relationsFor} resolveName={resolveName} saving={saving} saveError={saveError} onSave={onSave} onDelete={onDelete} />;
}

const EntityForm = ({ item, relationsFor, resolveName, saving, saveError, onSave, onDelete }) => {
  const [name, setName] = useState(item.name);
  const [reasoningType, setReasoningType] = useState(item.reasoningType);
  const [operationName, setOperationName] = useState(item.operation?.name || "");
  const [outputUnit, setOutputUnit] = useState(item.output?.unit || "");
  const [conditionOperator, setConditionOperator] = useState(item.condition?.operator || "");
  const [conditionValue, setConditionValue] = useState(item.condition?.value ?? "");

  const dirty = (
    name !== item.name
    || reasoningType !== item.reasoningType
    || operationName !== (item.operation?.name || "")
    || outputUnit !== (item.output?.unit || "")
    || conditionOperator !== (item.condition?.operator || "")
    || String(conditionValue) !== String(item.condition?.value ?? "")
  );

  const save = () => onSave({
    name,
    reasoningType,
    operation: { ...item.operation, name: operationName },
    output: { ...item.output, unit: outputUnit || null },
    condition: { ...item.condition, operator: conditionOperator || null, value: conditionValue === "" ? null : conditionValue },
  });

  return (
    <div id="mrp_editor">
      <div className="mrp_editor_form">
        <div className="mrp_editor_head">
          <span className="mrp_dim_badge" style={{ color: "#ab47bc", background: "color-mix(in srgb, #ab47bc 13%, transparent)", borderColor: "color-mix(in srgb, #ab47bc 32%, transparent)" }}>
            RabbitHole Reasoning-dependent Entity
          </span>
          <span className={`mrp_status_chip mrp_status_chip--${item.epistemicStatus}`}>{item.epistemicStatus}</span>
        </div>
        <label className="mrp_field">
          <span>Name</span>
          <input className="mrp_input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="mrp_field">
          <span>Reasoning type</span>
          <select className="mrp_input" value={reasoningType} onChange={(e) => setReasoningType(e.target.value)}>
            {REASONING_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <div className="mrp_field_row">
          <label className="mrp_field">
            <span>Operation</span>
            <input className="mrp_input" value={operationName} onChange={(e) => setOperationName(e.target.value)} placeholder="e.g. count_events_over_time" />
          </label>
          <label className="mrp_field">
            <span>Output unit</span>
            <input className="mrp_input" value={outputUnit} onChange={(e) => setOutputUnit(e.target.value)} placeholder="e.g. beats/min" />
          </label>
        </div>
        <div className="mrp_field_row">
          <label className="mrp_field">
            <span>Condition operator</span>
            <input className="mrp_input" value={conditionOperator} onChange={(e) => setConditionOperator(e.target.value)} placeholder="e.g. less_than" />
          </label>
          <label className="mrp_field">
            <span>Condition value</span>
            <input className="mrp_input" value={conditionValue} onChange={(e) => setConditionValue(e.target.value)} />
          </label>
        </div>
        <button type="button" className="mrp_save_btn" disabled={!dirty || saving} onClick={save}>
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>

      {saveError && <p className="mrp_row_error">{saveError}</p>}

      <div className="mrp_editor_section">
        <div className="mrp_panel_label">RabbitHole Relations</div>
        <MorpheRelationList entityId={item._id} relationsFor={relationsFor} resolveName={resolveName} />
      </div>

      <EvidencePanel item={item} />

      <button type="button" id="mrp_delete_btn" onClick={onDelete}>
        <i className="bx bx-trash" /> Delete
      </button>
    </div>
  );
};
