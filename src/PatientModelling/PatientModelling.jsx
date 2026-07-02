import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./patientModelling.css";
import { apiUrl } from "../config/api";
import { readStoredSession } from "../utils/sessionCleanup";

const MORPHE_TYPES = ["Diagnostic", "Therapeutic", "Prognostic", "Descriptive", "Aetiological"];

const DIMENSIONS = [
  {
    key: "objects",
    name: "Objects",
    dot: "#e53935",
    hint: "Formal physical entities — body structures, instruments, substances",
  },
  {
    key: "traces",
    name: "Traces",
    dot: "#f57c00",
    hint: "Formal observable dimensions — signs, measurements, test results",
  },
  {
    key: "phenomena",
    name: "Phenomena",
    dot: "#7b1fa2",
    hint: "Formal clinical pattern dimensions — syndromes, events, presentations",
  },
  {
    key: "concepts",
    name: "Concepts",
    dot: "#1565c0",
    hint: "Formal interpretive dimensions — diagnoses, mechanisms, pathophysiology",
  },
  {
    key: "models",
    name: "Models",
    dot: "#2e7d32",
    hint: "Formal theoretical frameworks — classifications, schema categories",
  },
  {
    key: "social",
    name: "Social",
    dot: "#00897b",
    hint: "Formal social dimensions — roles, relations, institutions, contexts",
  },
];

const emptyDraft = () => ({
  title:       "",
  morpheType:  "",
  patientId:   "",
  patientDbId: "",
  objects:     [],
  traces:      [],
  phenomena:   [],
  concepts:    [],
  models:      [],
  social:      [],
  notes:       "",
});

const getUserId = () => readStoredSession()?.userId || readStoredSession()?._id || "";
const newItem   = () => ({ name: "", description: "" });

export default function PatientModelling() {
  const navigate = useNavigate();
  const userId  = getUserId();

  const [morphes,   setMorphes]   = useState([]);
  const [patients,  setPatients]  = useState([]);
  const [active,    setActive]    = useState(null);
  const [draft,     setDraft]     = useState(emptyDraft());
  const [saving,    setSaving]    = useState(false);
  const [saved,     setSaved]     = useState(false);
  const saveTimer = useRef(null);

  const loadMorphes = useCallback(async () => {
    if (!userId) return;
    const res = await fetch(apiUrl(`/api/patient-models?userId=${userId}`));
    if (res.ok) setMorphes(await res.json());
  }, [userId]);

  const loadPatients = useCallback(async () => {
    if (!userId) return;
    const res = await fetch(apiUrl(`/api/patients?userId=${userId}`));
    if (res.ok) setPatients(await res.json());
  }, [userId]);

  useEffect(() => { loadMorphes(); loadPatients(); }, [loadMorphes, loadPatients]);

  const selectMorphe = (m) => {
    setActive(m._id);
    setDraft({
      title:       m.title       || "",
      morpheType:  m.morpheType  || "",
      patientId:   m.patientId   || "",
      patientDbId: m.patientDbId || "",
      objects:     m.objects     || [],
      traces:      m.traces      || [],
      phenomena:   m.phenomena   || [],
      concepts:    m.concepts    || [],
      models:      m.models      || [],
      social:      m.social      || [],
      notes:       m.notes       || "",
    });
    setSaved(false);
  };

  const startNew = () => { setActive("new"); setDraft(emptyDraft()); setSaved(false); };

  const setField = (key, val) => { setDraft(d => ({ ...d, [key]: val })); setSaved(false); };

  const handleDesignate = (e) => {
    const opt = e.target.options[e.target.selectedIndex];
    setDraft(d => ({
      ...d,
      patientId:   opt.dataset.patientid || "",
      patientDbId: opt.value             || "",
    }));
    setSaved(false);
  };

  const addItem = (key) => {
    setDraft(d => ({ ...d, [key]: [...d[key], newItem()] }));
    setSaved(false);
  };

  const updateItem = (key, idx, field, val) => {
    setDraft(d => ({
      ...d,
      [key]: d[key].map((it, i) => i === idx ? { ...it, [field]: val } : it),
    }));
    setSaved(false);
  };

  const removeItem = (key, idx) => {
    setDraft(d => ({ ...d, [key]: d[key].filter((_, i) => i !== idx) }));
    setSaved(false);
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      if (active === "new") {
        const res = await fetch(apiUrl("/api/patient-models"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, ...draft }),
        });
        if (res.ok) {
          const created = await res.json();
          await loadMorphes();
          setActive(created._id);
          setSaved(true);
          clearTimeout(saveTimer.current);
          saveTimer.current = setTimeout(() => setSaved(false), 2500);
        }
      } else if (active) {
        await fetch(apiUrl(`/api/patient-models/${active}`), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draft),
        });
        await loadMorphes();
        setSaved(true);
        clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => setSaved(false), 2500);
      }
    } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!active || active === "new") return;
    await fetch(apiUrl(`/api/patient-models/${active}`), { method: "DELETE" });
    setActive(null);
    setDraft(emptyDraft());
    await loadMorphes();
  };

  const isEditing   = active !== null;
  const isHylo      = isEditing && !!draft.patientId;
  const designatedPt = patients.find(p => p._id === draft.patientDbId);

  return (
    <div id="pm_root">

      {/* ── Header ── */}
      <div id="pm_header">
        <button id="pm_back" onClick={() => navigate("/home")} title="Back">
          <i className="fi fi-rr-arrow-left" />
        </button>
        <div id="pm_header_title_group">
          <span id="pm_title">MCTOSHS Objects Modelling</span>
          <span id="pm_subtitle">Patient Representative Object Morphe Builder</span>
        </div>
        {isEditing && (
          <div id="pm_header_actions">
            {saved && <span className="pm_status_ok">Saved</span>}
            {active && active !== "new" && (
              <button className="pm_btn pm_btn--danger" onClick={handleDelete}>
                <i className="fi fi-rr-trash" /> Delete
              </button>
            )}
            <button
              className="pm_btn pm_btn--primary"
              onClick={handleSave}
              disabled={saving || !draft.title.trim()}
            >
              <i className="fi fi-rr-disk" />
              {saving ? "Saving…" : "Save Morphe"}
            </button>
          </div>
        )}
      </div>

      {/* ── Body ── */}
      <div id="pm_layout">

        {/* Sidebar */}
        <div id="pm_sidebar">
          <button id="pm_new_btn" onClick={startNew}>
            <i className="fi fi-rr-plus" /> New Morphe
          </button>
          <div id="pm_model_list">
            {morphes.length === 0 && <p id="pm_list_empty">No morphes yet</p>}
            {morphes.map(m => (
              <button
                key={m._id}
                className={`pm_model_item${active === m._id ? " pm_model_item--active" : ""}`}
                onClick={() => selectMorphe(m)}
              >
                <span className="pm_item_morphe_tag">MORPHE{m.patientId ? " · ⬡ REPRESENTATIVE OBJECT" : ""}</span>
                <span className="pm_item_title">{m.title || "Untitled"}</span>
                <div className="pm_item_meta">
                  {m.morpheType && <span className="pm_item_type">{m.morpheType}</span>}
                  {m.patientId  && <span className="pm_item_patient">→ {m.patientId}</span>}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div id="pm_content">
          {!isEditing ? (
            <div id="pm_welcome">
              <i className="fi fi-rr-blueprint pm_welcome_icon" />
              <p>Select a Morphe for an MCTOSHS representative object or create a new one</p>
            </div>
          ) : (
            <>
              {/* Morphe header bar */}
              <div id="pm_model_header">
                <span className="pm_morphe_badge">MORPHE</span>
                {isHylo ? (
                  <span className="pm_hylo_badge">
                    <i className="fi fi-rr-link" /> MCTOSHS Representative Object · {draft.patientId}
                  </span>
                ) : (
                  <span className="pm_undesignated_badge">Schema Not Yet Designated</span>
                )}
              </div>

              <div id="pm_form">

                {/* Identity */}
                <div className="pm_meta_row">
                  <div className="pm_field">
                    <label className="pm_field_label">Morphe Name</label>
                    <input
                      className="pm_field_input"
                      type="text"
                      placeholder="Name this morphe…"
                      value={draft.title}
                      onChange={e => setField("title", e.target.value)}
                    />
                  </div>
                  <div className="pm_field">
                    <label className="pm_field_label">Morphe Type</label>
                    <select
                      className="pm_field_input"
                      value={draft.morpheType}
                      onChange={e => setField("morpheType", e.target.value)}
                    >
                      <option value="">— Select type —</option>
                      {MORPHE_TYPES.map(t => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Formal dimensions */}
                <p className="pm_section_label">Formal Morphe Dimensions</p>

                {DIMENSIONS.map(({ key, name, dot, hint }) => (
                  <div key={key} className="pm_cat_section">
                    <div className="pm_cat_header">
                      <span className="pm_cat_dot" style={{ background: dot }} />
                      <span className="pm_cat_name">{name}</span>
                      <span className="pm_cat_hint">{hint}</span>
                      <span className="pm_cat_count">{draft[key].length}</span>
                      <button className="pm_cat_add" onClick={() => addItem(key)}>
                        <i className="fi fi-rr-plus" /> Add
                      </button>
                    </div>
                    <div className="pm_cat_items">
                      {draft[key].length === 0 ? (
                        <p className="pm_cat_empty">No {name.toLowerCase()} defined</p>
                      ) : (
                        draft[key].map((item, idx) => (
                          <div key={idx} className="pm_item">
                            <div className="pm_item_fields">
                              <input
                                className="pm_item_input"
                                type="text"
                                placeholder="Formal name"
                                value={item.name}
                                onChange={e => updateItem(key, idx, "name", e.target.value)}
                              />
                              <input
                                className="pm_item_input"
                                type="text"
                                placeholder="Formal definition"
                                value={item.description}
                                onChange={e => updateItem(key, idx, "description", e.target.value)}
                              />
                            </div>
                            <button
                              className="pm_item_remove"
                              onClick={() => removeItem(key, idx)}
                              title="Remove"
                            >
                              <i className="fi fi-rr-cross-small" />
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                ))}

                {/* Notes */}
                <div className="pm_notes_section">
                  <span className="pm_notes_label">Morphe Notes</span>
                  <textarea
                    className="pm_notes_textarea"
                    placeholder="Schema rationale, formal constraints, representative-object reasoning…"
                    value={draft.notes}
                    onChange={e => setField("notes", e.target.value)}
                  />
                </div>

                {/* Designation to patient representative object */}
                <div className="pm_designate_section">
                  <div className="pm_designate_header">
                    <i className="fi fi-rr-arrow-right" />
                    <span>Designate to Patient Representative Object</span>
                  </div>
                  <p className="pm_designate_desc">
                    Designating this Morphe to a Patient Representative Object forms a{" "}
                    <strong>MCTOSHS Representative Object</strong> inside the domain — the union of
                    formal schema and representative instantiation.
                  </p>
                  <div className="pm_designate_row">
                    <select
                      className="pm_field_input pm_designate_select"
                      value={draft.patientDbId}
                      onChange={handleDesignate}
                    >
                      <option value="">— No representative object designation —</option>
                      {patients.map(p => (
                        <option key={p._id} value={p._id} data-patientid={p.patientId}>
                          {p.patientId} · {p.personal?.firstName} {p.personal?.lastName}
                        </option>
                      ))}
                    </select>
                    {isHylo && designatedPt && (
                      <div className="pm_designate_status">
                        <span className="pm_hylo_pill">⬡ MCTOSHS Representative Object</span>
                        <span className="pm_designate_name">
                          {designatedPt.personal?.firstName} {designatedPt.personal?.lastName}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
