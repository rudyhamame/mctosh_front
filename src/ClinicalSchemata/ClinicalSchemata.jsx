import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import "./clinicalSchemata.css";
import { apiUrl } from "../config/api";
import { readStoredSession } from "../utils/sessionCleanup";

// ── Constants ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = "mctosh_crs_schemata";

const DIMENSIONS = [
  "Molecule",
  "Tissue",
  "Organ",
  "Organ System",
  "Human",
  "Society",
];

const SUB_DIMENSIONS = [
  "sub-Molecule",
  "sub-Tissue",
  "sub-Organ",
  "sub-Organ System",
  "sub-Human",
  "sub-Society",
];

const DIM_COLOR = {
  "Molecule":         "#64b5f6",
  "Tissue":           "#a5d6a7",
  "Organ":            "#ffe082",
  "Organ System":     "#ce93d8",
  "Human":            "#f48fb1",
  "Society":          "#80cbc4",
  "sub-Molecule":     "#42a5f5",
  "sub-Tissue":       "#66bb6a",
  "sub-Organ":        "#ffa726",
  "sub-Organ System": "#ba68c8",
  "sub-Human":        "#f06292",
  "sub-Society":      "#26a69a",
};

// ── Persistence ───────────────────────────────────────────────────────────────

const uid = () => Math.random().toString(36).slice(2, 10);

const load = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return raw.map(s => ({
      dimension: "Molecule",
      code:      "",
      ...s,
      instances: (s.instances || []).map(i => ({
        id:              i.id,
        name:            i.name,
        code:            i.code || "",
        nestedInstances: (i.nestedInstances || []).map(n => ({
          id:        n.id,
          name:      n.name,
          dimension: n.dimension,
          code:      n.code || "",
        })),
      })),
    }));
  } catch { return []; }
};

const save = (data) => localStorage.setItem(STORAGE_KEY, JSON.stringify(data));

// ── Component ─────────────────────────────────────────────────────────────────

export default function ClinicalSchemata() {
  const navigate = useNavigate();
  const [schemata, setSchemata] = useState(load);

  // ── Schema state ──────────────────────────────────────────────────────────
  const [selectedId,    setSelectedId]    = useState(null);
  const [schemaSearch,  setSchemaSearch]  = useState("");
  const [newSchemaName, setNewSchemaName] = useState("");
  const [newSchemaDim,  setNewSchemaDim]  = useState("Molecule");
  const [newSchemaCode, setNewSchemaCode] = useState("");

  // ── Instance form state ───────────────────────────────────────────────────
  const [addingInst, setAddingInst] = useState(false);
  const [instName,   setInstName]   = useState("");
  const [instCode,   setInstCode]   = useState("");
  const [instSearch, setInstSearch] = useState("");

  // ── Nested instance form ──────────────────────────────────────────────────
  const [expandedInstId,  setExpandedInstId]  = useState(null);
  const [addingNestedFor, setAddingNestedFor] = useState(null);
  const [nestedName,      setNestedName]      = useState("");
  const [nestedDim,       setNestedDim]       = useState("sub-Molecule");
  const [nestedCode,      setNestedCode]      = useState("");

  // ── Edit state — schema ───────────────────────────────────────────────────
  const [editingSchemaId,  setEditingSchemaId]  = useState(null);
  const [editSchemaName,   setEditSchemaName]   = useState("");
  const [editSchemaDim,    setEditSchemaDim]    = useState("Molecule");
  const [editSchemaCode,   setEditSchemaCode]   = useState("");

  // ── Edit state — instance ─────────────────────────────────────────────────
  const [editingInstId,    setEditingInstId]    = useState(null);
  const [editInstName,     setEditInstName]     = useState("");
  const [editInstCode,     setEditInstCode]     = useState("");

  // ── Edit state — nested instance  (key = "instId:nestedId") ──────────────
  const [editingNestedKey, setEditingNestedKey] = useState(null);
  const [editNestedName,   setEditNestedName]   = useState("");
  const [editNestedDim,    setEditNestedDim]    = useState("sub-Molecule");
  const [editNestedCode,   setEditNestedCode]   = useState("");

  // ── Source extraction ─────────────────────────────────────────────────────
  const [extracting,       setExtracting]       = useState(false);
  const [extractError,     setExtractError]     = useState("");
  const [extractPanelOpen, setExtractPanelOpen] = useState(false);

  // ── Helpers ───────────────────────────────────────────────────────────────

  const mutate = (fn) => {
    setSchemata(prev => {
      const next = fn(prev);
      save(next);
      return next;
    });
  };

  const selectedSchema = schemata.find(s => s.id === selectedId) || null;

  const filteredSchemata = schemaSearch.trim()
    ? schemata.filter(s => s.name.toLowerCase().includes(schemaSearch.toLowerCase()))
    : schemata;

  const filteredInstances = instSearch.trim() && selectedSchema
    ? selectedSchema.instances.filter(i =>
        i.name.toLowerCase().includes(instSearch.toLowerCase())
      )
    : selectedSchema?.instances ?? [];

  // ── Schema CRUD ───────────────────────────────────────────────────────────

  const addSchema = () => {
    const name = newSchemaName.trim();
    if (!name) return;
    const next = {
      id:        uid(),
      name,
      dimension: newSchemaDim,
      code:      newSchemaCode.trim(),
      createdAt: new Date().toISOString(),
      instances: [],
    };
    mutate(prev => [...prev, next]);
    setNewSchemaName("");
    setNewSchemaDim("Molecule");
    setNewSchemaCode("");
    setSelectedId(next.id);
    setAddingInst(false);
    setExpandedInstId(null);
  };

  const deleteSchema = (id) => {
    mutate(prev => prev.filter(s => s.id !== id));
    if (selectedId === id) {
      setSelectedId(null);
      setAddingInst(false);
      setExpandedInstId(null);
    }
  };

  const startEditSchema = (s, e) => {
    e.stopPropagation();
    setEditingSchemaId(s.id);
    setEditSchemaName(s.name);
    setEditSchemaDim(s.dimension);
    setEditSchemaCode(s.code || "");
  };

  const saveEditSchema = () => {
    const name = editSchemaName.trim();
    if (!name) return;
    mutate(prev => prev.map(s =>
      s.id === editingSchemaId
        ? { ...s, name, dimension: editSchemaDim, code: editSchemaCode.trim() }
        : s
    ));
    setEditingSchemaId(null);
  };

  const cancelEditSchema = () => setEditingSchemaId(null);

  // ── Instance CRUD ─────────────────────────────────────────────────────────

  const addInstance = () => {
    const name = instName.trim();
    if (!name || !selectedId) return;
    const inst = { id: uid(), name, code: instCode.trim(), nestedInstances: [] };
    mutate(prev => prev.map(s =>
      s.id === selectedId ? { ...s, instances: [...s.instances, inst] } : s
    ));
    setInstName("");
    setInstCode("");
    setAddingInst(false);
    setExpandedInstId(inst.id);
  };

  const deleteInstance = (instId) => {
    mutate(prev => prev.map(s =>
      s.id === selectedId
        ? { ...s, instances: s.instances.filter(i => i.id !== instId) }
        : s
    ));
    if (expandedInstId === instId) setExpandedInstId(null);
    if (addingNestedFor === instId) setAddingNestedFor(null);
  };

  const startEditInst = (inst, e) => {
    e.stopPropagation();
    setEditingInstId(inst.id);
    setEditInstName(inst.name);
    setEditInstCode(inst.code || "");
  };

  const saveEditInst = () => {
    const name = editInstName.trim();
    if (!name) return;
    mutate(prev => prev.map(s =>
      s.id === selectedId
        ? {
            ...s,
            instances: s.instances.map(i =>
              i.id === editingInstId
                ? { ...i, name, code: editInstCode.trim() }
                : i
            ),
          }
        : s
    ));
    setEditingInstId(null);
  };

  const cancelEditInst = () => setEditingInstId(null);

  // ── Nested CRUD ───────────────────────────────────────────────────────────

  const addNested = (instId) => {
    const name = nestedName.trim();
    if (!name) return;
    const nested = { id: uid(), name, dimension: nestedDim, code: nestedCode.trim() };
    mutate(prev => prev.map(s =>
      s.id === selectedId
        ? {
            ...s,
            instances: s.instances.map(i =>
              i.id === instId
                ? { ...i, nestedInstances: [...i.nestedInstances, nested] }
                : i
            ),
          }
        : s
    ));
    setNestedName("");
    setNestedDim("sub-Molecule");
    setNestedCode("");
    setAddingNestedFor(null);
  };

  const deleteNested = (instId, nestedId) => {
    mutate(prev => prev.map(s =>
      s.id === selectedId
        ? {
            ...s,
            instances: s.instances.map(i =>
              i.id === instId
                ? { ...i, nestedInstances: i.nestedInstances.filter(n => n.id !== nestedId) }
                : i
            ),
          }
        : s
    ));
  };

  const startEditNested = (instId, n, e) => {
    e.stopPropagation();
    setEditingNestedKey(`${instId}:${n.id}`);
    setEditNestedName(n.name);
    setEditNestedDim(n.dimension);
    setEditNestedCode(n.code || "");
  };

  const saveEditNested = (instId, nestedId) => {
    const name = editNestedName.trim();
    if (!name) return;
    mutate(prev => prev.map(s =>
      s.id === selectedId
        ? {
            ...s,
            instances: s.instances.map(i =>
              i.id === instId
                ? {
                    ...i,
                    nestedInstances: i.nestedInstances.map(n =>
                      n.id === nestedId
                        ? { ...n, name, dimension: editNestedDim, code: editNestedCode.trim() }
                        : n
                    ),
                  }
                : i
            ),
          }
        : s
    ));
    setEditingNestedKey(null);
  };

  const cancelEditNested = () => setEditingNestedKey(null);

  // ── Source extraction ─────────────────────────────────────────────────────

  const extractFromSources = async () => {
    if (!selectedId || extracting) return;
    setExtracting(true);
    setExtractError("");
    try {
      const session = readStoredSession();
      const res = await fetch(apiUrl("/api/crs/extract-schemata"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schemaId: selectedId, userId: session?.my_id }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const { instances } = await res.json();
      if (Array.isArray(instances) && instances.length > 0) {
        mutate(prev => prev.map(s =>
          s.id === selectedId
            ? {
                ...s,
                instances: [
                  ...s.instances,
                  ...instances.map(i => ({
                    id:              uid(),
                    name:            i.name || "Unnamed",
                    code:            i.code || "",
                    nestedInstances: (i.nestedInstances || []).map(n => ({
                      id:        uid(),
                      name:      n.name || "Unnamed",
                      dimension: SUB_DIMENSIONS.includes(n.dimension) ? n.dimension : "sub-Molecule",
                      code:      n.code || "",
                    })),
                  })),
                ],
              }
            : s
        ));
        setExtractPanelOpen(false);
      } else {
        setExtractError("No instances extracted from sources. Try adding more source documents.");
      }
    } catch (err) {
      setExtractError(err.message || "Extraction failed.");
    } finally {
      setExtracting(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const totalInstances = schemata.reduce((acc, s) => acc + s.instances.length, 0);

  return (
    <div id="cs_root">

      {/* ── Header ── */}
      <div id="cs_header">
        <button id="cs_back" onClick={() => navigate("/home")} title="Back">
          <i className="fi fi-rr-arrow-left" />
        </button>
        <div id="cs_header_titles">
          <span id="cs_title">Clinical Representative Schemata</span>
          <span id="cs_subtitle">
            MCTOSHS Clinical Knowledge Structures · Extracted from the Reservoir
          </span>
        </div>
        <div id="cs_header_meta">
          <span className="cs_count_badge">
            {schemata.length} schema{schemata.length !== 1 ? "ta" : ""}
          </span>
          <span className="cs_count_badge cs_count_badge--inst">
            {totalInstances} instance{totalInstances !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* ── Body ── */}
      <div id="cs_body">

        {/* ── Left: Schema list ── */}
        <div id="cs_left">
          <div id="cs_schema_head">
            <span className="cs_panel_label">
              <i className="fi fi-rr-shapes" /> Schemata
            </span>
            <span className="cs_schema_count">{schemata.length}</span>
          </div>

          {/* New schema form */}
          <div id="cs_schema_add_block">
            <div id="cs_schema_add_row1">
              <input
                className="cs_input"
                placeholder="Schema name…"
                value={newSchemaName}
                onChange={e => setNewSchemaName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addSchema()}
              />
              <button
                className="cs_btn cs_btn--add"
                onClick={addSchema}
                disabled={!newSchemaName.trim()}
                title="Add schema"
              >
                <i className="fi fi-rr-plus" />
              </button>
            </div>
            <div id="cs_schema_add_row2">
              <select
                className="cs_select cs_select--dim"
                value={newSchemaDim}
                onChange={e => setNewSchemaDim(e.target.value)}
                style={{ "--dim-color": DIM_COLOR[newSchemaDim] }}
              >
                {DIMENSIONS.map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
              <input
                className="cs_input cs_input--code"
                placeholder="Code…"
                value={newSchemaCode}
                onChange={e => setNewSchemaCode(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addSchema()}
              />
            </div>
          </div>

          {schemata.length > 4 && (
            <div className="cs_search_wrap">
              <i className="fi fi-rr-search cs_search_icon" />
              <input
                className="cs_input cs_search_input"
                placeholder="Filter schemata…"
                value={schemaSearch}
                onChange={e => setSchemaSearch(e.target.value)}
              />
              {schemaSearch && (
                <button className="cs_search_clear" onClick={() => setSchemaSearch("")}><i className="fi fi-rr-cross-small" /></button>
              )}
            </div>
          )}

          <div id="cs_schema_list">
            {schemata.length === 0 ? (
              <div className="cs_empty">
                <i className="fi fi-rr-shapes" />
                <p>No schemata yet</p>
                <p className="cs_empty_hint">Enter a name above to create one</p>
              </div>
            ) : filteredSchemata.length === 0 ? (
              <div className="cs_empty">
                <p className="cs_empty_hint">No match for &ldquo;{schemaSearch}&rdquo;</p>
              </div>
            ) : (
              filteredSchemata.map(s => {
                const dc       = DIM_COLOR[s.dimension] || "#aaa";
                const isEditing = editingSchemaId === s.id;
                return (
                  <div
                    key={s.id}
                    className={[
                      "cs_schema_row",
                      selectedId === s.id ? "cs_schema_row--active" : "",
                      isEditing ? "cs_schema_row--editing" : "",
                    ].filter(Boolean).join(" ")}
                    onClick={() => {
                      if (isEditing) return;
                      setSelectedId(s.id);
                      setAddingInst(false);
                      setExpandedInstId(null);
                      setAddingNestedFor(null);
                      setInstSearch("");
                      setExtractPanelOpen(false);
                      setExtractError("");
                    }}
                  >
                    {isEditing ? (
                      <div className="cs_edit_form cs_edit_form--schema" onClick={e => e.stopPropagation()}>
                        <div className="cs_edit_row1">
                          <input
                            className="cs_input cs_input--sm"
                            value={editSchemaName}
                            autoFocus
                            onChange={e => setEditSchemaName(e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter") saveEditSchema(); if (e.key === "Escape") cancelEditSchema(); }}
                            placeholder="Schema name…"
                          />
                          <button className="cs_btn cs_btn--confirm cs_btn--sm" onClick={saveEditSchema} disabled={!editSchemaName.trim()}>
                            <i className="fi fi-rr-check" />
                          </button>
                          <button className="cs_btn--cancel-sm" onClick={cancelEditSchema}>
                            <i className="fi fi-rr-cross-small" />
                          </button>
                        </div>
                        <div className="cs_edit_row2">
                          <select
                            className="cs_select cs_select--sm cs_select--dim"
                            value={editSchemaDim}
                            onChange={e => setEditSchemaDim(e.target.value)}
                            style={{ "--dim-color": DIM_COLOR[editSchemaDim] }}
                          >
                            {DIMENSIONS.map(d => <option key={d} value={d}>{d}</option>)}
                          </select>
                          <input
                            className="cs_input cs_input--sm cs_input--code"
                            value={editSchemaCode}
                            onChange={e => setEditSchemaCode(e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter") saveEditSchema(); if (e.key === "Escape") cancelEditSchema(); }}
                            placeholder="Code…"
                          />
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="cs_schema_info">
                          <span className="cs_schema_name">{s.name}</span>
                          <div className="cs_schema_meta">
                            <span className="cs_dim_badge cs_dim_badge--schema" style={{ "--dim-color": dc }}>
                              {s.dimension}
                            </span>
                            {s.code && <span className="cs_code_badge">{s.code}</span>}
                          </div>
                        </div>
                        <span className="cs_inst_count">{s.instances.length}</span>
                        <button className="cs_edit_btn" onClick={e => startEditSchema(s, e)} title="Edit schema">
                          <i className="fi fi-rr-pencil" />
                        </button>
                        <button className="cs_del_btn" onClick={e => { e.stopPropagation(); deleteSchema(s.id); }} title="Delete schema">
                          <i className="fi fi-rr-trash" />
                        </button>
                      </>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ── Right: Instance panel ── */}
        <div id="cs_right">
          {!selectedSchema ? (
            <div id="cs_no_selection">
              <i className="fi fi-rr-shapes" />
              <p>Select a schema to view its instances</p>
              <p className="cs_empty_hint">
                Or create a new schema in the panel on the left
              </p>
            </div>
          ) : (
            <>
              {/* Right header */}
              <div id="cs_inst_header">
                <div id="cs_inst_header_title">
                  <span id="cs_schema_label">{selectedSchema.name}</span>
                  <span
                    className="cs_dim_badge"
                    style={{ "--dim-color": DIM_COLOR[selectedSchema.dimension] || "#aaa" }}
                  >
                    {selectedSchema.dimension}
                  </span>
                  {selectedSchema.code && (
                    <span className="cs_code_badge">{selectedSchema.code}</span>
                  )}
                  <span className="cs_inst_header_count">
                    {selectedSchema.instances.length} instance{selectedSchema.instances.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <div id="cs_inst_actions">
                  <button
                    className={`cs_btn cs_btn--extract${extractPanelOpen ? " cs_btn--extract-open" : ""}`}
                    onClick={() => {
                      setExtractPanelOpen(v => !v);
                      setAddingInst(false);
                      setExtractError("");
                    }}
                    title="Extract instances from sources"
                  >
                    <i className="fi fi-rr-bolt" />
                    Extract from Sources
                  </button>
                  <button
                    className={`cs_btn cs_btn--add-inst${addingInst ? " cs_btn--cancel" : ""}`}
                    onClick={() => {
                      setAddingInst(v => !v);
                      setExtractPanelOpen(false);
                      setInstName("");
                    }}
                  >
                    <i className={`fi ${addingInst ? "fi-rr-cross-small" : "fi-rr-plus"}`} />
                    {addingInst ? "Cancel" : "Add Instance"}
                  </button>
                </div>
              </div>

              {/* Extraction panel */}
              {extractPanelOpen && (
                <div id="cs_extract_panel">
                  <p className="cs_extract_desc">
                    The AI will read all source documents in your Clinical Representation Reservoir
                    and extract instances relevant to&nbsp;
                    <strong>{selectedSchema.name}</strong> at the&nbsp;
                    <strong>{selectedSchema.dimension}</strong> dimension.
                  </p>
                  {extractError && (
                    <p className="cs_extract_error">{extractError}</p>
                  )}
                  <button
                    className="cs_btn cs_btn--extract-run"
                    onClick={extractFromSources}
                    disabled={extracting}
                  >
                    {extracting
                      ? <><i className="fi fi-rr-loading" /> Extracting…</>
                      : <><i className="fi fi-rr-bolt" /> Run Extraction</>
                    }
                  </button>
                </div>
              )}

              {/* Add instance form — name + code; dimension is on the schema */}
              {addingInst && (
                <div id="cs_add_inst_form">
                  <div className="cs_form_row">
                    <div className="cs_field cs_field--grow">
                      <label className="cs_label">Instance Name</label>
                      <input
                        className="cs_input"
                        placeholder="e.g. Oxidised LDL, Arterial Stiffening…"
                        value={instName}
                        autoFocus
                        onChange={e => setInstName(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && addInstance()}
                      />
                    </div>
                    <div className="cs_field">
                      <label className="cs_label">Code</label>
                      <input
                        className="cs_input cs_input--code"
                        placeholder="e.g. E78.5"
                        value={instCode}
                        onChange={e => setInstCode(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && addInstance()}
                      />
                    </div>
                    <button
                      className="cs_btn cs_btn--confirm"
                      onClick={addInstance}
                      disabled={!instName.trim()}
                    >
                      <i className="fi fi-rr-check" /> Add
                    </button>
                  </div>
                </div>
              )}

              {/* Search instances */}
              {selectedSchema.instances.length > 5 && (
                <div className="cs_search_wrap cs_inst_search">
                  <i className="fi fi-rr-search cs_search_icon" />
                  <input
                    className="cs_input cs_search_input"
                    placeholder="Filter instances…"
                    value={instSearch}
                    onChange={e => setInstSearch(e.target.value)}
                  />
                  {instSearch && (
                    <button className="cs_search_clear" onClick={() => setInstSearch("")}><i className="fi fi-rr-cross-small" /></button>
                  )}
                </div>
              )}

              {/* Instance list */}
              <div id="cs_inst_list">
                {selectedSchema.instances.length === 0 ? (
                  <div className="cs_empty cs_inst_empty">
                    <i className="fi fi-rr-document" />
                    <p>No instances yet</p>
                    <p className="cs_empty_hint">
                      Add instances manually or extract from sources
                    </p>
                  </div>
                ) : filteredInstances.length === 0 ? (
                  <div className="cs_empty cs_inst_empty">
                    <p className="cs_empty_hint">No match for &ldquo;{instSearch}&rdquo;</p>
                  </div>
                ) : (
                  filteredInstances.map(inst => {
                    const isExpanded     = expandedInstId === inst.id;
                    const isAddingNested = addingNestedFor === inst.id;
                    const isEditingInst  = editingInstId === inst.id;
                    return (
                      <div key={inst.id} className={[
                        "cs_inst_card",
                        isExpanded ? "cs_inst_card--open" : "",
                        isEditingInst ? "cs_inst_card--editing" : "",
                      ].filter(Boolean).join(" ")}>

                        {/* Instance row — normal or edit */}
                        {isEditingInst ? (
                          <div className="cs_edit_form cs_edit_form--inst">
                            <div className="cs_form_row">
                              <div className="cs_field cs_field--grow">
                                <label className="cs_label">Instance Name</label>
                                <input
                                  className="cs_input cs_input--sm"
                                  value={editInstName}
                                  autoFocus
                                  onChange={e => setEditInstName(e.target.value)}
                                  onKeyDown={e => { if (e.key === "Enter") saveEditInst(); if (e.key === "Escape") cancelEditInst(); }}
                                  placeholder="Instance name…"
                                />
                              </div>
                              <div className="cs_field">
                                <label className="cs_label">Code</label>
                                <input
                                  className="cs_input cs_input--sm cs_input--code"
                                  value={editInstCode}
                                  onChange={e => setEditInstCode(e.target.value)}
                                  onKeyDown={e => { if (e.key === "Enter") saveEditInst(); if (e.key === "Escape") cancelEditInst(); }}
                                  placeholder="Code…"
                                />
                              </div>
                              <button className="cs_btn cs_btn--confirm cs_btn--sm" onClick={saveEditInst} disabled={!editInstName.trim()}>
                                <i className="fi fi-rr-check" />
                              </button>
                              <button className="cs_btn--cancel-sm" onClick={cancelEditInst}>
                                <i className="fi fi-rr-cross-small" />
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div
                            className="cs_inst_row"
                            onClick={() => {
                              setExpandedInstId(isExpanded ? null : inst.id);
                              if (!isExpanded) setAddingNestedFor(null);
                            }}
                          >
                            <i className={`fi ${isExpanded ? "fi-rr-angle-up" : "fi-rr-angle-right"} cs_expand_icon`} />
                            <span className="cs_inst_name">{inst.name}</span>
                            {inst.code && <span className="cs_code_badge">{inst.code}</span>}
                            {inst.nestedInstances.length > 0 && (
                              <span className="cs_nested_count">{inst.nestedInstances.length}</span>
                            )}
                            <button className="cs_edit_btn" onClick={e => startEditInst(inst, e)} title="Edit instance">
                              <i className="fi fi-rr-pencil" />
                            </button>
                            <button className="cs_del_btn" onClick={e => { e.stopPropagation(); deleteInstance(inst.id); }} title="Delete instance">
                              <i className="fi fi-rr-trash" />
                            </button>
                          </div>
                        )}

                        {/* Expanded: nested instances */}
                        {isExpanded && (
                          <div className="cs_nested_area">
                            {inst.nestedInstances.length === 0 && !isAddingNested && (
                              <p className="cs_nested_empty">No nested instances</p>
                            )}

                            {inst.nestedInstances.map(n => {
                              const nColor    = DIM_COLOR[n.dimension] || "#888";
                              const nKey      = `${inst.id}:${n.id}`;
                              const isEditingN = editingNestedKey === nKey;
                              return (
                                <div key={n.id} className={`cs_nested_row${isEditingN ? " cs_nested_row--editing" : ""}`}>
                                  {isEditingN ? (
                                    <div className="cs_edit_form cs_edit_form--nested">
                                      <div className="cs_edit_row1">
                                        <input
                                          className="cs_input cs_input--sm"
                                          value={editNestedName}
                                          autoFocus
                                          onChange={e => setEditNestedName(e.target.value)}
                                          onKeyDown={e => { if (e.key === "Enter") saveEditNested(inst.id, n.id); if (e.key === "Escape") cancelEditNested(); }}
                                          placeholder="Name…"
                                        />
                                        <button className="cs_btn cs_btn--confirm cs_btn--sm" onClick={() => saveEditNested(inst.id, n.id)} disabled={!editNestedName.trim()}>
                                          <i className="fi fi-rr-check" />
                                        </button>
                                        <button className="cs_btn--cancel-sm" onClick={cancelEditNested}>
                                          <i className="fi fi-rr-cross-small" />
                                        </button>
                                      </div>
                                      <div className="cs_edit_row2">
                                        <select
                                          className="cs_select cs_select--sm"
                                          value={editNestedDim}
                                          onChange={e => setEditNestedDim(e.target.value)}
                                        >
                                          {SUB_DIMENSIONS.map(d => <option key={d} value={d}>{d}</option>)}
                                        </select>
                                        <input
                                          className="cs_input cs_input--sm cs_input--code"
                                          value={editNestedCode}
                                          onChange={e => setEditNestedCode(e.target.value)}
                                          onKeyDown={e => { if (e.key === "Enter") saveEditNested(inst.id, n.id); if (e.key === "Escape") cancelEditNested(); }}
                                          placeholder="Code…"
                                        />
                                      </div>
                                    </div>
                                  ) : (
                                    <>
                                      <i className="fi fi-rr-corner-down-right cs_nested_connector" />
                                      <span className="cs_nested_name">{n.name}</span>
                                      {n.code && <span className="cs_code_badge cs_code_badge--sm">{n.code}</span>}
                                      <span className="cs_dim_badge cs_dim_badge--sub" style={{ "--dim-color": nColor }}>
                                        {n.dimension}
                                      </span>
                                      <button className="cs_edit_btn cs_edit_btn--sm" onClick={e => startEditNested(inst.id, n, e)} title="Edit">
                                        <i className="fi fi-rr-pencil" />
                                      </button>
                                      <button className="cs_del_btn cs_del_btn--nested" onClick={() => deleteNested(inst.id, n.id)} title="Delete">
                                        <i className="fi fi-rr-cross-small" />
                                      </button>
                                    </>
                                  )}
                                </div>
                              );
                            })}

                            {/* Add nested form */}
                            {isAddingNested ? (
                              <div className="cs_add_nested_form">
                                <div className="cs_form_row cs_form_row--nested">
                                  <div className="cs_field cs_field--grow">
                                    <label className="cs_label">Nested Instance Name</label>
                                    <input
                                      className="cs_input cs_input--sm"
                                      placeholder="e.g. Apolipoprotein B, Macrophage foam cell…"
                                      value={nestedName}
                                      autoFocus
                                      onChange={e => setNestedName(e.target.value)}
                                      onKeyDown={e => e.key === "Enter" && addNested(inst.id)}
                                    />
                                  </div>
                                  <div className="cs_field">
                                    <label className="cs_label">Code</label>
                                    <input
                                      className="cs_input cs_input--sm cs_input--code"
                                      placeholder="Code…"
                                      value={nestedCode}
                                      onChange={e => setNestedCode(e.target.value)}
                                      onKeyDown={e => e.key === "Enter" && addNested(inst.id)}
                                    />
                                  </div>
                                  <div className="cs_field">
                                    <label className="cs_label">Sub-Dimension</label>
                                    <select
                                      className="cs_select cs_select--sm"
                                      value={nestedDim}
                                      onChange={e => setNestedDim(e.target.value)}
                                    >
                                      {SUB_DIMENSIONS.map(d => (
                                        <option key={d} value={d}>{d}</option>
                                      ))}
                                    </select>
                                  </div>
                                  <button
                                    className="cs_btn cs_btn--confirm cs_btn--sm"
                                    onClick={() => addNested(inst.id)}
                                    disabled={!nestedName.trim()}
                                  >
                                    <i className="fi fi-rr-check" />
                                  </button>
                                  <button
                                    className="cs_btn--cancel-sm"
                                    onClick={() => { setAddingNestedFor(null); setNestedName(""); setNestedCode(""); }}
                                  >
                                    <i className="fi fi-rr-cross-small" />
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <button
                                className="cs_add_nested_btn"
                                onClick={e => {
                                  e.stopPropagation();
                                  setAddingNestedFor(inst.id);
                                  setNestedName("");
                                  setNestedDim("sub-Molecule");
                                }}
                              >
                                <i className="fi fi-rr-plus" /> Add nested instance
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>

      </div>
    </div>
  );
}
