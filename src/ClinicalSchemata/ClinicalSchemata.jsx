import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import "./clinicalSchemata.css";
import { apiUrl } from "../config/api";
import { readStoredSession } from "../utils/sessionCleanup";

// ── MCTOSH Entities ──────────────────────────────────────────────────────────
// Entity (En)                — a named thing, e.g. "Heart"
// Entity Schema (EnS)        — the entity's schema; one per entity (1:1),
//                              implicit — it's just the entity's set of traces
// Entity Schema Trace (EnST) — a trace within that schema; acts as a JSON key
// Entity Schema Trace Value (EnSTV) — the trace's value; acts as the JSON
//                              value for that key. One value per trace (1:1).
//
// An entity's schema therefore renders directly as a flat JSON object:
// { "<trace key>": "<trace value>", ... } — see the JSON preview panel below.

const STORAGE_KEY = "mctosh_entities";

const DIMENSIONS = [
  "Molecule",
  "Tissue",
  "Organ",
  "Organ System",
  "Human",
  "Society",
];

const DIM_COLOR = {
  "Molecule":     "#64b5f6",
  "Tissue":       "#a5d6a7",
  "Organ":        "#ffe082",
  "Organ System": "#ce93d8",
  "Human":        "#f48fb1",
  "Society":      "#80cbc4",
};

// ── Persistence ───────────────────────────────────────────────────────────────

const uid = () => Math.random().toString(36).slice(2, 10);

const load = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return raw.map(e => ({
      id:         e.id,
      name:       e.name || "",
      dimension:  DIMENSIONS.includes(e.dimension) ? e.dimension : "Molecule",
      code:       e.code || "",
      createdAt:  e.createdAt || new Date().toISOString(),
      schema: {
        traces: (e.schema?.traces || []).map(t => ({
          id:    t.id,
          key:   t.key || "",
          value: t.value ? { id: t.value.id || uid(), value: t.value.value || "" } : null,
        })),
      },
    }));
  } catch { return []; }
};

const save = (data) => localStorage.setItem(STORAGE_KEY, JSON.stringify(data));

const schemaAsJson = (entity) => Object.fromEntries(
  (entity?.schema?.traces || [])
    .filter(t => t.value && t.value.value)
    .map(t => [t.key, t.value.value])
);

// ── Component ─────────────────────────────────────────────────────────────────

export default function ClinicalSchemata() {
  const navigate = useNavigate();
  const [entities, setEntities] = useState(load);

  // ── Entity state ──────────────────────────────────────────────────────────
  const [selectedId,    setSelectedId]    = useState(null);
  const [entitySearch,  setEntitySearch]  = useState("");
  const [newEntityName, setNewEntityName] = useState("");
  const [newEntityDim,  setNewEntityDim]  = useState("Molecule");
  const [newEntityCode, setNewEntityCode] = useState("");

  // ── Trace form state ──────────────────────────────────────────────────────
  const [addingTrace, setAddingTrace] = useState(false);
  const [traceKey,    setTraceKey]    = useState("");
  const [traceValue,  setTraceValue]  = useState("");
  const [traceSearch, setTraceSearch] = useState("");

  // ── Edit state — entity ───────────────────────────────────────────────────
  const [editingEntityId, setEditingEntityId] = useState(null);
  const [editEntityName,  setEditEntityName]  = useState("");
  const [editEntityDim,   setEditEntityDim]   = useState("Molecule");
  const [editEntityCode,  setEditEntityCode]  = useState("");

  // ── Edit state — trace (key + value together) ─────────────────────────────
  const [editingTraceId, setEditingTraceId] = useState(null);
  const [editTraceKey,   setEditTraceKey]   = useState("");
  const [editTraceValue, setEditTraceValue] = useState("");

  // ── JSON preview ──────────────────────────────────────────────────────────
  const [showJson, setShowJson] = useState(false);

  // ── Source extraction ─────────────────────────────────────────────────────
  const [extracting,       setExtracting]       = useState(false);
  const [extractError,     setExtractError]     = useState("");
  const [extractPanelOpen, setExtractPanelOpen] = useState(false);

  // ── Helpers ───────────────────────────────────────────────────────────────

  const mutate = (fn) => {
    setEntities(prev => {
      const next = fn(prev);
      save(next);
      return next;
    });
  };

  const selectedEntity = entities.find(e => e.id === selectedId) || null;

  const filteredEntities = entitySearch.trim()
    ? entities.filter(e => e.name.toLowerCase().includes(entitySearch.toLowerCase()))
    : entities;

  const filteredTraces = traceSearch.trim() && selectedEntity
    ? selectedEntity.schema.traces.filter(t => t.key.toLowerCase().includes(traceSearch.toLowerCase()))
    : selectedEntity?.schema.traces ?? [];

  // ── Entity (En) CRUD ──────────────────────────────────────────────────────

  const addEntity = () => {
    const name = newEntityName.trim();
    if (!name) return;
    const next = {
      id:        uid(),
      name,
      dimension: newEntityDim,
      code:      newEntityCode.trim(),
      createdAt: new Date().toISOString(),
      schema:    { traces: [] },
    };
    mutate(prev => [...prev, next]);
    setNewEntityName("");
    setNewEntityDim("Molecule");
    setNewEntityCode("");
    setSelectedId(next.id);
    setAddingTrace(false);
  };

  const deleteEntity = (id) => {
    mutate(prev => prev.filter(e => e.id !== id));
    if (selectedId === id) {
      setSelectedId(null);
      setAddingTrace(false);
    }
  };

  const startEditEntity = (e, ev) => {
    ev.stopPropagation();
    setEditingEntityId(e.id);
    setEditEntityName(e.name);
    setEditEntityDim(e.dimension);
    setEditEntityCode(e.code || "");
  };

  const saveEditEntity = () => {
    const name = editEntityName.trim();
    if (!name) return;
    mutate(prev => prev.map(e =>
      e.id === editingEntityId
        ? { ...e, name, dimension: editEntityDim, code: editEntityCode.trim() }
        : e
    ));
    setEditingEntityId(null);
  };

  const cancelEditEntity = () => setEditingEntityId(null);

  // ── Entity Schema Trace (EnST) + Trace Value (EnSTV) CRUD ─────────────────
  // The Entity Schema (EnS) itself is implicit — 1:1 with its entity — so
  // there's no separate "add schema" step; adding the first trace is enough.

  const addTrace = () => {
    const key = traceKey.trim();
    if (!key || !selectedId) return;
    const value = traceValue.trim();
    const trace = { id: uid(), key, value: value ? { id: uid(), value } : null };
    mutate(prev => prev.map(e =>
      e.id === selectedId ? { ...e, schema: { traces: [...e.schema.traces, trace] } } : e
    ));
    setTraceKey("");
    setTraceValue("");
    setAddingTrace(false);
  };

  const deleteTrace = (traceId) => {
    mutate(prev => prev.map(e =>
      e.id === selectedId
        ? { ...e, schema: { traces: e.schema.traces.filter(t => t.id !== traceId) } }
        : e
    ));
    if (editingTraceId === traceId) setEditingTraceId(null);
  };

  const startEditTrace = (t, ev) => {
    ev.stopPropagation();
    setEditingTraceId(t.id);
    setEditTraceKey(t.key);
    setEditTraceValue(t.value?.value || "");
  };

  const saveEditTrace = () => {
    const key = editTraceKey.trim();
    if (!key) return;
    const value = editTraceValue.trim();
    mutate(prev => prev.map(e =>
      e.id === selectedId
        ? {
            ...e,
            schema: {
              traces: e.schema.traces.map(t =>
                t.id === editingTraceId
                  ? { ...t, key, value: value ? { id: t.value?.id || uid(), value } : null }
                  : t
              ),
            },
          }
        : e
    ));
    setEditingTraceId(null);
  };

  const cancelEditTrace = () => setEditingTraceId(null);

  // ── Source extraction ─────────────────────────────────────────────────────
  // Not yet backed by a live endpoint (no /api/crs route exists server-side
  // today) — kept as a documented, disabled-on-failure action rather than
  // removed, so the UI doesn't silently drop functionality that's only
  // pending its backend half.

  const extractFromSources = async () => {
    if (!selectedId || extracting) return;
    setExtracting(true);
    setExtractError("");
    try {
      const session = readStoredSession();
      const res = await fetch(apiUrl("/api/crs/extract-entities"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityId: selectedId, userId: session?.my_id }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const { traces } = await res.json();
      if (Array.isArray(traces) && traces.length > 0) {
        mutate(prev => prev.map(e =>
          e.id === selectedId
            ? {
                ...e,
                schema: {
                  traces: [
                    ...e.schema.traces,
                    ...traces.map(t => ({
                      id:    uid(),
                      key:   t.key || t.name || "Unnamed",
                      value: t.value ? { id: uid(), value: String(t.value) } : null,
                    })),
                  ],
                },
              }
            : e
        ));
        setExtractPanelOpen(false);
      } else {
        setExtractError("No traces extracted from sources. Try adding more source documents.");
      }
    } catch (err) {
      setExtractError(err.message || "Extraction failed.");
    } finally {
      setExtracting(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const totalTraces = entities.reduce((acc, e) => acc + e.schema.traces.length, 0);

  return (
    <div id="cs_root">

      {/* ── Header ── */}
      <div id="cs_header">
        <button id="cs_back" onClick={() => navigate("/home")} title="Back">
          <i className="fi fi-rr-arrow-left" />
        </button>
        <div id="cs_header_titles">
          <span id="cs_title">MCTOSH Entities</span>
          <span id="cs_subtitle">
            Entity → Entity Schema → Trace → Trace Value · Extracted from the Reservoir
          </span>
        </div>
        <div id="cs_header_meta">
          <span className="cs_count_badge">
            {entities.length} entit{entities.length !== 1 ? "ies" : "y"}
          </span>
          <span className="cs_count_badge cs_count_badge--inst">
            {totalTraces} trace{totalTraces !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* ── Body ── */}
      <div id="cs_body">

        {/* ── Left: Entity list ── */}
        <div id="cs_left">
          <div id="cs_schema_head">
            <span className="cs_panel_label">
              <i className="fi fi-rr-shapes" /> Entities
            </span>
            <span className="cs_schema_count">{entities.length}</span>
          </div>

          {/* New entity form */}
          <div id="cs_schema_add_block">
            <div id="cs_schema_add_row1">
              <input
                className="cs_input"
                placeholder="Entity name… e.g. Heart"
                value={newEntityName}
                onChange={e => setNewEntityName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addEntity()}
              />
              <button
                className="cs_btn cs_btn--add"
                onClick={addEntity}
                disabled={!newEntityName.trim()}
                title="Add entity"
              >
                <i className="fi fi-rr-plus" />
              </button>
            </div>
            <div id="cs_schema_add_row2">
              <select
                className="cs_select cs_select--dim"
                value={newEntityDim}
                onChange={e => setNewEntityDim(e.target.value)}
                style={{ "--dim-color": DIM_COLOR[newEntityDim] }}
              >
                {DIMENSIONS.map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
              <input
                className="cs_input cs_input--code"
                placeholder="Code…"
                value={newEntityCode}
                onChange={e => setNewEntityCode(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addEntity()}
              />
            </div>
          </div>

          {entities.length > 4 && (
            <div className="cs_search_wrap">
              <i className="fi fi-rr-search cs_search_icon" />
              <input
                className="cs_input cs_search_input"
                placeholder="Filter entities…"
                value={entitySearch}
                onChange={e => setEntitySearch(e.target.value)}
              />
              {entitySearch && (
                <button className="cs_search_clear" onClick={() => setEntitySearch("")}><i className="fi fi-rr-cross-small" /></button>
              )}
            </div>
          )}

          <div id="cs_schema_list">
            {entities.length === 0 ? (
              <div className="cs_empty">
                <i className="fi fi-rr-shapes" />
                <p>No entities yet</p>
                <p className="cs_empty_hint">Enter a name above to create one</p>
              </div>
            ) : filteredEntities.length === 0 ? (
              <div className="cs_empty">
                <p className="cs_empty_hint">No match for &ldquo;{entitySearch}&rdquo;</p>
              </div>
            ) : (
              filteredEntities.map(e => {
                const dc        = DIM_COLOR[e.dimension] || "#aaa";
                const isEditing = editingEntityId === e.id;
                return (
                  <div
                    key={e.id}
                    className={[
                      "cs_schema_row",
                      selectedId === e.id ? "cs_schema_row--active" : "",
                      isEditing ? "cs_schema_row--editing" : "",
                    ].filter(Boolean).join(" ")}
                    onClick={() => {
                      if (isEditing) return;
                      setSelectedId(e.id);
                      setAddingTrace(false);
                      setTraceSearch("");
                      setEditingTraceId(null);
                      setShowJson(false);
                      setExtractPanelOpen(false);
                      setExtractError("");
                    }}
                  >
                    {isEditing ? (
                      <div className="cs_edit_form cs_edit_form--schema" onClick={ev => ev.stopPropagation()}>
                        <div className="cs_edit_row1">
                          <input
                            className="cs_input cs_input--sm"
                            value={editEntityName}
                            autoFocus
                            onChange={ev => setEditEntityName(ev.target.value)}
                            onKeyDown={ev => { if (ev.key === "Enter") saveEditEntity(); if (ev.key === "Escape") cancelEditEntity(); }}
                            placeholder="Entity name…"
                          />
                          <button className="cs_btn cs_btn--confirm cs_btn--sm" onClick={saveEditEntity} disabled={!editEntityName.trim()}>
                            <i className="fi fi-rr-check" />
                          </button>
                          <button className="cs_btn--cancel-sm" onClick={cancelEditEntity}>
                            <i className="fi fi-rr-cross-small" />
                          </button>
                        </div>
                        <div className="cs_edit_row2">
                          <select
                            className="cs_select cs_select--sm cs_select--dim"
                            value={editEntityDim}
                            onChange={ev => setEditEntityDim(ev.target.value)}
                            style={{ "--dim-color": DIM_COLOR[editEntityDim] }}
                          >
                            {DIMENSIONS.map(d => <option key={d} value={d}>{d}</option>)}
                          </select>
                          <input
                            className="cs_input cs_input--sm cs_input--code"
                            value={editEntityCode}
                            onChange={ev => setEditEntityCode(ev.target.value)}
                            onKeyDown={ev => { if (ev.key === "Enter") saveEditEntity(); if (ev.key === "Escape") cancelEditEntity(); }}
                            placeholder="Code…"
                          />
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="cs_schema_info">
                          <span className="cs_schema_name">{e.name}</span>
                          <div className="cs_schema_meta">
                            <span className="cs_dim_badge cs_dim_badge--schema" style={{ "--dim-color": dc }}>
                              {e.dimension}
                            </span>
                            {e.code && <span className="cs_code_badge">{e.code}</span>}
                          </div>
                        </div>
                        <span className="cs_inst_count">{e.schema.traces.length}</span>
                        <button className="cs_edit_btn" onClick={ev => startEditEntity(e, ev)} title="Edit entity">
                          <i className="fi fi-rr-pencil" />
                        </button>
                        <button className="cs_del_btn" onClick={ev => { ev.stopPropagation(); deleteEntity(e.id); }} title="Delete entity">
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

        {/* ── Right: Entity Schema (traces) panel ── */}
        <div id="cs_right">
          {!selectedEntity ? (
            <div id="cs_no_selection">
              <i className="fi fi-rr-shapes" />
              <p>Select an entity to view its schema</p>
              <p className="cs_empty_hint">
                Or create a new entity in the panel on the left
              </p>
            </div>
          ) : (
            <>
              {/* Right header */}
              <div id="cs_inst_header">
                <div id="cs_inst_header_title">
                  <span id="cs_schema_label">{selectedEntity.name} Schema</span>
                  <span
                    className="cs_dim_badge"
                    style={{ "--dim-color": DIM_COLOR[selectedEntity.dimension] || "#aaa" }}
                  >
                    {selectedEntity.dimension}
                  </span>
                  {selectedEntity.code && (
                    <span className="cs_code_badge">{selectedEntity.code}</span>
                  )}
                  <span className="cs_inst_header_count">
                    {selectedEntity.schema.traces.length} trace{selectedEntity.schema.traces.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <div id="cs_inst_actions">
                  <button
                    className={`cs_btn cs_btn--extract${showJson ? " cs_btn--extract-open" : ""}`}
                    onClick={() => setShowJson(v => !v)}
                    title="View this entity's schema as JSON"
                  >
                    <i className="fi fi-rr-brackets-curly" />
                    {showJson ? "Hide JSON" : "View JSON"}
                  </button>
                  <button
                    className={`cs_btn cs_btn--extract${extractPanelOpen ? " cs_btn--extract-open" : ""}`}
                    onClick={() => {
                      setExtractPanelOpen(v => !v);
                      setAddingTrace(false);
                      setExtractError("");
                    }}
                    title="Extract traces from sources"
                  >
                    <i className="fi fi-rr-bolt" />
                    Extract from Sources
                  </button>
                  <button
                    className={`cs_btn cs_btn--add-inst${addingTrace ? " cs_btn--cancel" : ""}`}
                    onClick={() => {
                      setAddingTrace(v => !v);
                      setExtractPanelOpen(false);
                      setTraceKey("");
                      setTraceValue("");
                    }}
                  >
                    <i className={`fi ${addingTrace ? "fi-rr-cross-small" : "fi-rr-plus"}`} />
                    {addingTrace ? "Cancel" : "Add Trace"}
                  </button>
                </div>
              </div>

              {/* JSON preview */}
              {showJson && (
                <pre className="cs_json_panel">{JSON.stringify(schemaAsJson(selectedEntity), null, 2)}</pre>
              )}

              {/* Extraction panel */}
              {extractPanelOpen && (
                <div id="cs_extract_panel">
                  <p className="cs_extract_desc">
                    The AI will read all source documents in your AMCTOSHS Hyle
                    and extract schema traces relevant to&nbsp;
                    <strong>{selectedEntity.name}</strong> at the&nbsp;
                    <strong>{selectedEntity.dimension}</strong> dimension.
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

              {/* Add trace form — key + value together */}
              {addingTrace && (
                <div id="cs_add_inst_form">
                  <div className="cs_form_row">
                    <div className="cs_field cs_field--grow">
                      <label className="cs_label">Trace Key</label>
                      <input
                        className="cs_input"
                        placeholder="e.g. chambers"
                        value={traceKey}
                        autoFocus
                        onChange={e => setTraceKey(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && addTrace()}
                      />
                    </div>
                    <div className="cs_field cs_field--grow">
                      <label className="cs_label">Trace Value</label>
                      <input
                        className="cs_input"
                        placeholder="e.g. 4"
                        value={traceValue}
                        onChange={e => setTraceValue(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && addTrace()}
                      />
                    </div>
                    <button
                      className="cs_btn cs_btn--confirm"
                      onClick={addTrace}
                      disabled={!traceKey.trim()}
                    >
                      <i className="fi fi-rr-check" /> Add
                    </button>
                  </div>
                </div>
              )}

              {/* Search traces */}
              {selectedEntity.schema.traces.length > 5 && (
                <div className="cs_search_wrap cs_inst_search">
                  <i className="fi fi-rr-search cs_search_icon" />
                  <input
                    className="cs_input cs_search_input"
                    placeholder="Filter traces…"
                    value={traceSearch}
                    onChange={e => setTraceSearch(e.target.value)}
                  />
                  {traceSearch && (
                    <button className="cs_search_clear" onClick={() => setTraceSearch("")}><i className="fi fi-rr-cross-small" /></button>
                  )}
                </div>
              )}

              {/* Trace list */}
              <div id="cs_inst_list">
                {selectedEntity.schema.traces.length === 0 ? (
                  <div className="cs_empty cs_inst_empty">
                    <i className="fi fi-rr-document" />
                    <p>No traces yet</p>
                    <p className="cs_empty_hint">
                      Add traces manually or extract from sources
                    </p>
                  </div>
                ) : filteredTraces.length === 0 ? (
                  <div className="cs_empty cs_inst_empty">
                    <p className="cs_empty_hint">No match for &ldquo;{traceSearch}&rdquo;</p>
                  </div>
                ) : (
                  filteredTraces.map(t => {
                    const isEditingT = editingTraceId === t.id;
                    return (
                      <div key={t.id} className={`cs_inst_card${isEditingT ? " cs_inst_card--editing" : ""}`}>
                        {isEditingT ? (
                          <div className="cs_edit_form cs_edit_form--inst">
                            <div className="cs_form_row">
                              <div className="cs_field cs_field--grow">
                                <label className="cs_label">Trace Key</label>
                                <input
                                  className="cs_input cs_input--sm"
                                  value={editTraceKey}
                                  autoFocus
                                  onChange={e => setEditTraceKey(e.target.value)}
                                  onKeyDown={e => { if (e.key === "Enter") saveEditTrace(); if (e.key === "Escape") cancelEditTrace(); }}
                                  placeholder="Trace key…"
                                />
                              </div>
                              <div className="cs_field cs_field--grow">
                                <label className="cs_label">Trace Value</label>
                                <input
                                  className="cs_input cs_input--sm"
                                  value={editTraceValue}
                                  onChange={e => setEditTraceValue(e.target.value)}
                                  onKeyDown={e => { if (e.key === "Enter") saveEditTrace(); if (e.key === "Escape") cancelEditTrace(); }}
                                  placeholder="Trace value…"
                                />
                              </div>
                              <button className="cs_btn cs_btn--confirm cs_btn--sm" onClick={saveEditTrace} disabled={!editTraceKey.trim()}>
                                <i className="fi fi-rr-check" />
                              </button>
                              <button className="cs_btn--cancel-sm" onClick={cancelEditTrace}>
                                <i className="fi fi-rr-cross-small" />
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="cs_inst_row cs_trace_row">
                            <span className="cs_inst_name cs_trace_key">{t.key}</span>
                            <i className="fi fi-rr-arrow-small-right cs_trace_arrow" />
                            <span className={`cs_trace_value${t.value ? "" : " cs_trace_value--empty"}`}>
                              {t.value ? t.value.value : "no value"}
                            </span>
                            <button className="cs_edit_btn" onClick={ev => startEditTrace(t, ev)} title="Edit trace">
                              <i className="fi fi-rr-pencil" />
                            </button>
                            <button className="cs_del_btn" onClick={() => deleteTrace(t.id)} title="Delete trace">
                              <i className="fi fi-rr-trash" />
                            </button>
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
