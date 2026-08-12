import React, { useMemo, useState } from "react";
import { DOMAIN_LABELS, MORPHE_OBJECT_MODES } from "./amctoshsMorpheConstants";

const EXTRACTION_BASIS_OPTIONS = [
  ["explicit", "Explicit"],
  ["linguistically_presupposed", "Linguistically presupposed"],
  ["externally_inferred", "Externally inferred"],
  ["manually_added", "Manually added"],
];
const EPISTEMIC_STATUS_OPTIONS = [
  ["asserted", "Asserted"],
  ["linguistically_presupposed", "Linguistically presupposed"],
  ["proposed", "Proposed"],
  ["manually_added", "Manually added"],
  ["manually_corrected", "Manually corrected"],
  ["rejected", "Rejected"],
];

const nextObjectId = (schemas, mode) => {
  const matcher = new RegExp(`^${mode}(\\d+)$`, "i");
  const maximum = schemas.reduce((current, schema) => {
    const match = String(schema.objectId || schema.name || "").match(matcher);
    return match ? Math.max(current, Number(match[1])) : current;
  }, 0);
  return `${mode}${maximum + 1}`;
};

export default function MorpheObjectsAside({ schemas, selectedItemId, creating, error, onCreate, onSelect, onEdit, onDelete }) {
  const [formOpen, setFormOpen] = useState(false);
  const [modeOfAccess, setModeOfAccess] = useState(MORPHE_OBJECT_MODES[0].key);
  const [schemaName, setSchemaName] = useState("");
  const [editingObject, setEditingObject] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [actionBusyId, setActionBusyId] = useState(null);
  const [actionError, setActionError] = useState("");
  const previewId = useMemo(() => nextObjectId(schemas, modeOfAccess), [modeOfAccess, schemas]);
  const objectDomains = useMemo(() => new Set(MORPHE_OBJECT_MODES.map(({ domain }) => domain)), []);
  const objects = schemas.filter((schema) => objectDomains.has(schema.domain));

  const submit = async (event) => {
    event.preventDefault();
    const created = await onCreate({ modeOfAccess, schemaName });
    if (created) setFormOpen(false);
  };

  const beginEdit = (event, object) => {
    event.stopPropagation();
    setActionError("");
    setEditingObject(object);
    setEditForm({
      schemaName: object.name || "",
      modeOfAccess: object.modeOfAccess || "ATOM",
      entityClass: object.entityClass || "AMCTOSHS Object",
      extractionBasis: object.extractionBasis || "manually_added",
      epistemicStatus: object.epistemicStatus || "manually_added",
      manualOverrideReason: object.manualOverrideReason || "",
    });
  };

  const cancelEdit = (event) => {
    event.stopPropagation();
    setEditingObject(null);
    setEditForm(null);
  };

  const submitEdit = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!editForm || !editingObject) return;
    setActionBusyId(editingObject._id);
    setActionError("");
    const updated = await onEdit(editingObject, {
      ...editForm,
      name: editForm.schemaName.trim(),
      entityClass: editForm.entityClass.trim(),
      manualOverrideReason: editForm.manualOverrideReason.trim(),
    });
    setActionBusyId(null);
    if (updated) {
      setEditingObject(null);
      setEditForm(null);
    } else setActionError("Could not edit this object.");
  };

  const deleteObject = async (event, object) => {
    event.stopPropagation();
    if (!window.confirm(`Delete AMCTOSHS Object “${object.objectId || object.name}”? Its associated traces will also be deleted.`)) return;
    setActionBusyId(object._id);
    setActionError("");
    const deleted = await onDelete(object);
    setActionBusyId(null);
    if (!deleted) setActionError("Could not delete this object.");
  };

  return (
    <aside id="mrp_objects_aside" aria-label="AMCTOSHS objects">
      <div id="mrp_objects_aside_header">
        <h2>AMCTOSHS objects</h2>
        <button type="button" id="mrp_add_object_btn" onClick={() => setFormOpen((open) => !open)} aria-expanded={formOpen} aria-controls="mrp_add_object_form" title="Add AMCTOSHS object">
          <span aria-hidden="true">+</span>
        </button>
      </div>

      {formOpen && (
        <form id="mrp_add_object_form" onSubmit={submit}>
          <label className="mrp_field">
            <span>Mode of access</span>
            <select className="mrp_input" value={modeOfAccess} onChange={(event) => setModeOfAccess(event.target.value)}>
              {MORPHE_OBJECT_MODES.map((mode) => <option key={mode.key} value={mode.key}>{mode.key}</option>)}
            </select>
          </label>
          <label className="mrp_field">
            <span>Generated object ID</span>
            <input className="mrp_input" value={previewId} readOnly aria-readonly="true" />
          </label>
          <label className="mrp_field">
            <span>Schema name (optional)</span>
            <input className="mrp_input" value={schemaName} onChange={(event) => setSchemaName(event.target.value)} placeholder="Name the schema created with this object" maxLength={160} autoComplete="off" />
          </label>
          {error && <p className="mrp_object_create_error">{error}</p>}
          <button type="submit" className="mrp_save_btn" disabled={creating}>{creating ? "Adding…" : "Add object"}</button>
        </form>
      )}

      <div id="mrp_objects_list">
        {objects.length === 0 ? (
          <p className="mrp_empty_hint">No AMCTOSHS objects yet.</p>
        ) : objects.map((object) => (
          <div key={object._id} className={`mrp_object_row${selectedItemId === object._id ? " mrp_object_row--active" : ""}`}>
            <>
                <button type="button" className="mrp_object_select_btn" onClick={() => onSelect(object)}>
                  <span className="mrp_object_name">{object.objectId || object.name}</span>
                  <span className="mrp_object_mode">{object.name !== (object.objectId || object.name) ? `Schema: ${object.name}` : (object.modeOfAccess || DOMAIN_LABELS[object.domain] || object.domain)}</span>
                </button>
                <div className="mrp_object_actions">
                  <button type="button" className="mrp_object_action_btn" onClick={(event) => beginEdit(event, object)} disabled={actionBusyId === object._id} title="Edit object" aria-label={`Edit ${object.name}`}>
                    <i className="bx bx-edit-alt" aria-hidden="true" />
                  </button>
                  <button type="button" className="mrp_object_action_btn mrp_object_action_btn--delete" onClick={(event) => deleteObject(event, object)} disabled={actionBusyId === object._id} title="Delete object" aria-label={`Delete ${object.name}`}>
                    <i className="bx bx-trash" aria-hidden="true" />
                  </button>
                </div>
            </>
          </div>
        ))}
        {actionError && <p className="mrp_object_create_error">{actionError}</p>}
        {error && !formOpen && <p className="mrp_object_create_error">{error}</p>}
      </div>
      {editingObject && editForm && (
        <div className="mrp_object_editor_backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) cancelEdit(event); }}>
          <form className="mrp_object_editor" onSubmit={submitEdit} onMouseDown={(event) => event.stopPropagation()}>
            <div className="mrp_object_editor_header">
              <div>
                <span className="mrp_object_editor_eyebrow">Edit object</span>
                <h3>{editingObject.objectId || editingObject.name}</h3>
              </div>
              <button type="button" className="mrp_object_editor_close" onClick={cancelEdit} aria-label="Close editor" title="Close editor">×</button>
            </div>
            <div className="mrp_object_editor_grid">
              <label className="mrp_field"><span>Object ID</span><input className="mrp_input" value={editingObject.objectId || editingObject.name} readOnly aria-readonly="true" autoFocus /></label>
              <label className="mrp_field mrp_object_editor_wide"><span>Schema name</span><input className="mrp_input" value={editForm.schemaName} onChange={(event) => setEditForm((form) => ({ ...form, schemaName: event.target.value }))} maxLength={160} required /></label>
              <label className="mrp_field"><span>Mode of access</span><select className="mrp_input" value={editForm.modeOfAccess} onChange={(event) => setEditForm((form) => ({ ...form, modeOfAccess: event.target.value }))}>{MORPHE_OBJECT_MODES.map((mode) => <option key={mode.key} value={mode.key}>{mode.label}</option>)}</select></label>
              <label className="mrp_field"><span>Domain</span><input className="mrp_input" value={DOMAIN_LABELS[MORPHE_OBJECT_MODES.find((mode) => mode.key === editForm.modeOfAccess)?.domain] || ""} readOnly aria-readonly="true" /></label>
              <label className="mrp_field"><span>Entity class</span><input className="mrp_input" value={editForm.entityClass} onChange={(event) => setEditForm((form) => ({ ...form, entityClass: event.target.value }))} maxLength={160} /></label>
              <label className="mrp_field"><span>Extraction basis</span><select className="mrp_input" value={editForm.extractionBasis} onChange={(event) => setEditForm((form) => ({ ...form, extractionBasis: event.target.value }))}>{EXTRACTION_BASIS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label className="mrp_field"><span>Epistemic status</span><select className="mrp_input" value={editForm.epistemicStatus} onChange={(event) => setEditForm((form) => ({ ...form, epistemicStatus: event.target.value }))}>{EPISTEMIC_STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label className="mrp_field mrp_object_editor_wide"><span>Manual rationale</span><textarea className="mrp_input mrp_object_editor_textarea" value={editForm.manualOverrideReason} onChange={(event) => setEditForm((form) => ({ ...form, manualOverrideReason: event.target.value }))} maxLength={500} rows={3} /></label>
            </div>
            {actionBusyId === editingObject._id && <p className="mrp_object_editor_status">Saving changes…</p>}
            <div className="mrp_object_editor_footer"><button type="button" className="mrp_object_editor_cancel" onClick={cancelEdit} disabled={actionBusyId === editingObject._id}>Cancel</button><button type="submit" className="mrp_save_btn" disabled={actionBusyId === editingObject._id}><i className="bx bx-save" aria-hidden="true" /> Save changes</button></div>
          </form>
        </div>
      )}
    </aside>
  );
}
