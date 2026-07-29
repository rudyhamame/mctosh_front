import React, { useState } from "react";
import { DOMAINS, DOMAIN_LABELS, VALUE_TYPES } from "./amctoshsMorpheConstants";
import MorpheRelationList from "./MorpheRelationList";

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
    {item.sourceSegmentIds?.length > 0 && (
      <p className="mrp_evidence_source">From segment: {item.sourceSegmentIds.join(", ")}</p>
    )}
  </div>
);

// Right panel — a thin container selecting one of five typed forms
// (Schema/Instance/Trace Schema/Trace Instance/Relation fields are
// structurally unrelated, so one shared form would fight per-type
// validation) plus the shared evidence display and MorpheRelationList. A
// free-text Relation isn't part of the typed AMCTOSHSRelation graph
// (subject/object are plain phrases, not links to other saved items), so
// it skips MorpheRelationList entirely.
export default function MorpheEditorPanel({
  itemType, item, index, saving, saveError,
  onSave, onDelete,
}) {
  const resolveName = (type, id) => {
    const key = String(id);
    if (type === "Schema") return index.schemasById?.get(key)?.name || "(unknown schema)";
    if (type === "Instance") return index.instancesById?.get(key)?.instanceName || "(unknown instance)";
    if (type === "TraceSchema") return index.traceSchemasById?.get(key)?.name || "(unknown trace schema)";
    if (type === "TraceInstance") {
      const ti = index.traceInstancesById?.get(key);
      return ti ? (ti.sourceInstanceName || "(trace instance)") : "(unknown trace instance)";
    }
    return "(unknown)";
  };

  if (!item) {
    return (
      <div id="mrp_no_selection">
        <i className="fi fi-rr-shapes" />
        <p>Select a Sub-Entity Schema, Instance, Trace Schema, Trace Instance, or Relation to view it</p>
      </div>
    );
  }

  return (
    <div id="mrp_editor" key={item._id}>
      {itemType === "schemas" && <SchemaEditor item={item} saving={saving} onSave={onSave} />}
      {itemType === "instances" && <InstanceEditor item={item} saving={saving} onSave={onSave} />}
      {itemType === "traceSchemas" && <TraceSchemaEditor item={item} saving={saving} onSave={onSave} />}
      {itemType === "traceInstances" && <TraceInstanceEditor item={item} saving={saving} onSave={onSave} />}
      {itemType === "textRelations" && <TextRelationEditor item={item} saving={saving} onSave={onSave} />}

      {saveError && <p className="mrp_row_error">{saveError}</p>}

      {itemType !== "textRelations" && (
        <div className="mrp_editor_section">
          <div className="mrp_panel_label">AMCTOSHS Relations</div>
          <MorpheRelationList entityId={item._id} relationsFor={index.relationsFor} resolveName={resolveName} />
        </div>
      )}

      <EvidencePanel item={item} />

      <button type="button" id="mrp_delete_btn" onClick={onDelete}>
        <i className="bx bx-trash" /> Delete
      </button>
    </div>
  );
}

const SchemaEditor = ({ item, saving, onSave }) => {
  const [name, setName] = useState(item.name);
  const [domain, setDomain] = useState(item.domain);
  const [entityClass, setEntityClass] = useState(item.entityClass || "");
  const dirty = name !== item.name || domain !== item.domain || entityClass !== (item.entityClass || "");

  return (
    <div className="mrp_editor_form">
      <div className="mrp_editor_head">
        <span className="mrp_dim_badge">AMCTOSHS Sub-Entity Schema</span>
        <span className={`mrp_status_chip mrp_status_chip--${item.epistemicStatus}`}>{item.epistemicStatus}</span>
      </div>
      <label className="mrp_field">
        <span>Name</span>
        <input className="mrp_input" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="mrp_field">
        <span>AMCTOSHS Domain</span>
        <select className="mrp_input" value={domain} onChange={(e) => setDomain(e.target.value)}>
          {DOMAINS.map((d) => <option key={d} value={d}>{DOMAIN_LABELS[d]}</option>)}
        </select>
      </label>
      <label className="mrp_field">
        <span>Entity class</span>
        <input className="mrp_input" value={entityClass} onChange={(e) => setEntityClass(e.target.value)} placeholder="e.g. anatomical_material_entity" />
      </label>
      <button type="button" className="mrp_save_btn" disabled={!dirty || saving} onClick={() => onSave({ name, domain, entityClass })}>
        {saving ? "Saving…" : "Save changes"}
      </button>
    </div>
  );
};

const InstanceEditor = ({ item, saving, onSave }) => {
  const [instanceName, setInstanceName] = useState(item.instanceName);
  const [patientId, setPatientId] = useState(item.patientId || "");
  const [domain, setDomain] = useState(item.domain);
  const dirty = instanceName !== item.instanceName || patientId !== (item.patientId || "") || domain !== item.domain;

  return (
    <div className="mrp_editor_form">
      <div className="mrp_editor_head">
        <span className="mrp_dim_badge">AMCTOSHS Sub-Entity Instance</span>
        <span className={`mrp_status_chip mrp_status_chip--${item.epistemicStatus}`}>{item.epistemicStatus}</span>
      </div>
      <label className="mrp_field">
        <span>Instance name</span>
        <input className="mrp_input" value={instanceName} onChange={(e) => setInstanceName(e.target.value)} />
      </label>
      <label className="mrp_field">
        <span>Patient identifier</span>
        <input className="mrp_input" value={patientId} onChange={(e) => setPatientId(e.target.value)} />
      </label>
      <label className="mrp_field">
        <span>AMCTOSHS Domain</span>
        <select className="mrp_input" value={domain} onChange={(e) => setDomain(e.target.value)}>
          {DOMAINS.map((d) => <option key={d} value={d}>{DOMAIN_LABELS[d]}</option>)}
        </select>
      </label>
      <button type="button" className="mrp_save_btn" disabled={!dirty || saving} onClick={() => onSave({ instanceName, patientId, domain })}>
        {saving ? "Saving…" : "Save changes"}
      </button>
    </div>
  );
};

// Type-level fields only (name, moa, type, phenomenon, valueType) — the
// concrete observation/status fields live on TraceInstanceEditor below,
// per the Trace Schema/Trace Instance split (correction 1: a Trace
// Schema's source is a Sub-Entity Schema and never changes post-save, so
// it isn't offered as an editable field here).
const TraceSchemaEditor = ({ item, saving, onSave }) => {
  const [name, setName] = useState(item.name);
  const [moaName, setMoaName] = useState(item.moa?.name || "");
  const [typeName, setTypeName] = useState(item.type?.name || "");
  const [phenomenonName, setPhenomenonName] = useState(item.phenomenon?.name || "");
  const [valueType, setValueType] = useState(item.valueType || "");

  const dirty = (
    name !== item.name
    || moaName !== (item.moa?.name || "")
    || typeName !== (item.type?.name || "")
    || phenomenonName !== (item.phenomenon?.name || "")
    || valueType !== (item.valueType || "")
  );

  const save = () => onSave({
    name,
    moa: { ...item.moa, name: moaName || null },
    type: { ...item.type, name: typeName || null },
    phenomenon: { ...item.phenomenon, name: phenomenonName },
    valueType: valueType || null,
  });

  return (
    <div className="mrp_editor_form">
      <div className="mrp_editor_head">
        <span className="mrp_dim_badge">AMCTOSHS Trace Schema</span>
        <span className="mrp_dim_badge mrp_dim_badge--muted">source: {item.sourceSchemaName}</span>
        <span className={`mrp_status_chip mrp_status_chip--${item.epistemicStatus}`}>{item.epistemicStatus}</span>
      </div>
      <label className="mrp_field">
        <span>Name</span>
        <input className="mrp_input" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="mrp_field">
        <span>Means of access</span>
        <input className="mrp_input" value={moaName} onChange={(e) => setMoaName(e.target.value)} placeholder="e.g. Auditory access" />
      </label>
      <label className="mrp_field">
        <span>Trace type</span>
        <input className="mrp_input" value={typeName} onChange={(e) => setTypeName(e.target.value)} placeholder="e.g. Sound" />
      </label>
      <label className="mrp_field">
        <span>Phenomenon</span>
        <input className="mrp_input" value={phenomenonName} onChange={(e) => setPhenomenonName(e.target.value)} />
      </label>
      <label className="mrp_field">
        <span>Value type</span>
        <select className="mrp_input" value={valueType} onChange={(e) => setValueType(e.target.value)}>
          <option value="">—</option>
          {VALUE_TYPES.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      </label>
      <button type="button" className="mrp_save_btn" disabled={!dirty || saving} onClick={save}>
        {saving ? "Saving…" : "Save changes"}
      </button>
    </div>
  );
};

// Concrete occurrence fields only (observation, status) — type-level
// fields (moa/type/phenomenon) live on TraceSchemaEditor above.
const TraceInstanceEditor = ({ item, saving, onSave }) => {
  const [valueType, setValueType] = useState(item.observation?.valueType || "");
  const [value, setValue] = useState(item.observation?.value ?? "");
  const [unit, setUnit] = useState(item.observation?.unit || "");
  const [traceStatus, setTraceStatus] = useState(item.traceStatus);

  const dirty = (
    valueType !== (item.observation?.valueType || "")
    || String(value) !== String(item.observation?.value ?? "")
    || unit !== (item.observation?.unit || "")
    || traceStatus !== item.traceStatus
  );

  const save = () => onSave({
    observation: { valueType: valueType || null, value: value === "" ? null : value, unit: unit || null },
    traceStatus,
  });

  return (
    <div className="mrp_editor_form">
      <div className="mrp_editor_head">
        <span className="mrp_dim_badge">AMCTOSHS Trace Instance</span>
        <span className="mrp_dim_badge mrp_dim_badge--muted">source: {item.sourceInstanceName}</span>
        <span className={`mrp_status_chip mrp_status_chip--${item.epistemicStatus}`}>{item.epistemicStatus}</span>
      </div>
      <div className="mrp_field_row">
        <label className="mrp_field">
          <span>Value type</span>
          <select className="mrp_input" value={valueType} onChange={(e) => setValueType(e.target.value)}>
            <option value="">—</option>
            {VALUE_TYPES.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <label className="mrp_field">
          <span>Value</span>
          <input className="mrp_input" value={value} onChange={(e) => setValue(e.target.value)} />
        </label>
        <label className="mrp_field">
          <span>Unit</span>
          <input className="mrp_input" value={unit} onChange={(e) => setUnit(e.target.value)} disabled={valueType !== "quantitative"} />
        </label>
      </div>
      <label className="mrp_field">
        <span>Trace status</span>
        <select className="mrp_input" value={traceStatus} onChange={(e) => setTraceStatus(e.target.value)}>
          <option value="asserted">asserted</option>
          <option value="proposed">proposed</option>
        </select>
      </label>
      <button type="button" className="mrp_save_btn" disabled={!dirty || saving} onClick={save}>
        {saving ? "Saving…" : "Save changes"}
      </button>
    </div>
  );
};

// A free-text Relation saved by "Extract AMCTOSHS Relations" — subject/
// predicate/object are plain phrases, not links to other saved items (see
// MorpheEditorPanel's own doc comment above).
const TextRelationEditor = ({ item, saving, onSave }) => {
  const [subject, setSubject] = useState(item.subject);
  const [predicate, setPredicate] = useState(item.predicate);
  const [object, setObject] = useState(item.object);
  const [dependencyStatus, setDependencyStatus] = useState(item.dependencyStatus);
  const [extractionLogic, setExtractionLogic] = useState(item.extractionLogic || "");

  const dirty = (
    subject !== item.subject
    || predicate !== item.predicate
    || object !== item.object
    || dependencyStatus !== item.dependencyStatus
    || extractionLogic !== (item.extractionLogic || "")
  );

  return (
    <div className="mrp_editor_form">
      <div className="mrp_editor_head">
        <span className="mrp_dim_badge">AMCTOSHS Relation</span>
        <span className={`mrp_status_chip mrp_status_chip--${item.epistemicStatus}`}>{item.epistemicStatus}</span>
      </div>
      <label className="mrp_field">
        <span>Subject</span>
        <input className="mrp_input" value={subject} onChange={(e) => setSubject(e.target.value)} />
      </label>
      <label className="mrp_field">
        <span>Predicate</span>
        <input className="mrp_input" value={predicate} onChange={(e) => setPredicate(e.target.value)} />
      </label>
      <label className="mrp_field">
        <span>Object</span>
        <input className="mrp_input" value={object} onChange={(e) => setObject(e.target.value)} />
      </label>
      <label className="mrp_field">
        <span>Dependency status</span>
        <select className="mrp_input" value={dependencyStatus} onChange={(e) => setDependencyStatus(e.target.value)}>
          <option value="asserted_dependency">asserted</option>
          <option value="proposed_dependency">proposed</option>
        </select>
      </label>
      <label className="mrp_field">
        <span>Extraction logic</span>
        <textarea
          className="mrp_input"
          value={extractionLogic}
          onChange={(e) => setExtractionLogic(e.target.value)}
          placeholder="Why this relation follows from the source text"
          rows={3}
        />
      </label>
      <button
        type="button"
        className="mrp_save_btn"
        disabled={!dirty || saving}
        onClick={() => onSave({ subject, predicate, object, dependencyStatus, extractionLogic })}
      >
        {saving ? "Saving…" : "Save changes"}
      </button>

      <SubjectOfRelationSummary sor={item.subjectOfRelation} />
    </div>
  );
};

// Read-only Subject of Relation (SOR) summary for a saved
// AMCTOSHSTextRelation — richer inline editing of this data happens on
// the AMCTOSHS Segmentation page's review UI (before save); once saved,
// Morphe just needs it to stay inspectable/auditable. Absent on relations
// saved before this field existed (no backfill migration) — rendered as
// "no SOR data available" rather than erroring.
const SubjectOfRelationSummary = ({ sor }) => {
  if (!sor) {
    return (
      <div className="mrp_editor_section">
        <div className="mrp_panel_label">Subject of Relation</div>
        <p className="mrp_empty_hint">No Subject of Relation data available for this item.</p>
      </div>
    );
  }
  return (
    <div className="mrp_editor_section">
      <div className="mrp_panel_label">Subject of Relation</div>
      <div className="mrp_field_row">
        <span className="mrp_count_chip" title="Mention">{sor.mention}</span>
        <span className="mrp_count_chip" title="Grammatical head">head: {sor.grammaticalHead?.surface}</span>
        <span className={`mrp_status_chip mrp_status_chip--${sor.canonicalCore?.resolutionStatus === "existing_object" ? "asserted" : "proposed"}`}>
          {sor.canonicalCore?.resolutionStatus}
        </span>
      </div>
      <p className="mrp_evidence_source">
        Core: <strong>{sor.canonicalCore?.name}</strong> ({sor.canonicalCore?.objectClass}) · number: {sor.grammaticalNumber}
      </p>
      {sor.modifiers?.length > 0 && (
        <p className="mrp_evidence_source">Modifiers: {sor.modifiers.map((m) => `${m.type}=${m.surface}`).join(", ")}</p>
      )}
      {sor.internalRelations?.length > 0 && (
        <p className="mrp_evidence_source">
          Internal relations: {sor.internalRelations.map((ir, i) => <span key={i}>{i > 0 ? "; " : ""}{ir.predicate} → {ir.object?.name}</span>)}
        </p>
      )}
      {sor.confidence != null && <p className="mrp_evidence_source">Confidence: {sor.confidence.toFixed(2)}</p>}
    </div>
  );
};
