import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./clinicalSchemata.css";
import { ENTITY_DOMAINS } from "../PDF/entityBuilderConstants";
import { listAmctoshsEntities, updateAmctoshsEntity, deleteAmctoshsEntity } from "../PDF/amctoshsEntitiesClient";
import { buildAmctoshsMorpheIndex } from "../PDF/amctoshsEntityGraph";

// AMCTOSHS Morphe — the global structured representational container of
// all AMCTOSHS sub-entities, organized by AMCTOSHS Domain, where each
// sub-entity exposes its temporally ordered AMCTOSHS Traces and AMCTOSHS
// Trace Values.
//
// This is the SAME core tool as the AMCTOSHS Entity Builder inside the PDF
// Reader (front/src/PDF/EntityBuilderPanel.jsx) plus a global view on top:
// it reads the exact same back/models/AmctoshsEntity.js records through
// the exact same back/routes/AmctoshsEntityAPI.js endpoint
// (GET /api/amctoshs-entities already returns everything a user has ever
// built, across every domain and every source document — there is no
// per-document scoping on that model at all), reconstructed into a
// Domain → Sub-Entity Schema → Trace → Trace Value hierarchy by
// amctoshsEntityGraph.js. The PDF Reader's Entity Builder stays the tool
// for BUILDING new sub-entities from PDF-derived text — Morphe does not
// duplicate that creation flow. It does support editing/deleting a
// sub-entity already built (correcting a schema's name/domain, or a
// trace value's own value/unit — see updateAmctoshsEntity), since that's
// inspecting-and-correcting the global view, not a second way to create
// the same data from scratch.
//
// Domain/type vocabulary (ENTITY_DOMAINS, VALUE_BEARING_TYPES) comes from
// entityBuilderConstants.js, shared with EntityBuilderPanel.jsx, so the
// same sub-entity schema represents the same conceptual entity in both
// places — no second, incompatible model (the previous version of this
// page had its own disconnected localStorage-only 6-dimension model;
// that is gone).

const DOMAIN_COLOR = {
  "Atoms": "#ffb74d",
  "Molecules": "#7e57c2",
  "Tissues": "#42a5f5",
  "Organs": "#26c6da",
  "Organ Systems": "#26a69a",
  "Humans": "#66bb6a",
  "Societies": "#ff8a65",
  "Unassigned Domain": "#9e9e9e",
};

const UNLINKED_KEY = "__unlinked__";

const formatTimestamp = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const formatTraceValue = (row) => [row.value, row.unit].filter(Boolean).join(" ") || "—";

export default function ClinicalSchemata() {
  const navigate = useNavigate();
  const [entities, setEntities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [activeDomain, setActiveDomain] = useState(ENTITY_DOMAINS[0]);
  const [selectedKey, setSelectedKey] = useState(null);
  const [selectedTrace, setSelectedTrace] = useState(null); // which AMCTOSHS Trace's values are currently shown
  const [schemaSearch, setSchemaSearch] = useState("");
  const [sortOrder, setSortOrder] = useState("asc"); // oldest -> newest, per AMCTOSHS 4D convention (spec §5)
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [rowError, setRowError] = useState("");

  // Editing an AMCTOSHS Sub-Entity Schema row (name + domain).
  const [editingSchemaKey, setEditingSchemaKey] = useState(null);
  const [editSchemaName, setEditSchemaName] = useState("");
  const [editSchemaDomain, setEditSchemaDomain] = useState("");

  // Editing one AMCTOSHS Trace Value row (value + unit only — traceName/
  // parentSchema linkage isn't editable inline; rebuild it from the
  // Entity Builder if it needs to point somewhere else).
  const [editingValueId, setEditingValueId] = useState(null);
  const [editValueText, setEditValueText] = useState("");
  const [editValueUnit, setEditValueUnit] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await listAmctoshsEntities();
        if (!cancelled) setEntities(data);
      } catch (err) {
        if (!cancelled) setLoadError(err.message || "Could not load AMCTOSHS sub-entities.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const { byDomain, unlinkedRows } = useMemo(() => buildAmctoshsMorpheIndex(entities), [entities]);

  // Domain tabs: the canonical 7, plus "Unassigned Domain" only if it
  // actually has content (a schema built with a domain value outside the
  // canonical list) — never invented, never silently dropped.
  const domainTabs = useMemo(() => {
    const extra = Array.from(byDomain.keys()).filter((d) => !ENTITY_DOMAINS.includes(d));
    return [...ENTITY_DOMAINS, ...extra];
  }, [byDomain]);

  const schemasInDomain = activeDomain === UNLINKED_KEY ? [] : (byDomain.get(activeDomain) || []);
  const filteredSchemas = schemaSearch.trim()
    ? schemasInDomain.filter((s) => s.name.toLowerCase().includes(schemaSearch.trim().toLowerCase()))
    : schemasInDomain;

  const selectedSchema = activeDomain === UNLINKED_KEY
    ? null
    : schemasInDomain.find((s) => s.key === selectedKey) || null;

  // One AMCTOSHS Trace never appears more than once — its AMCTOSHS Trace
  // Values are grouped underneath it as an array, ordered by temporal
  // succession (Order = each value's fixed position within ITS OWN
  // trace's history, 1 = earliest), not flattened into repeated
  // trace-name rows.
  const traceGroups = useMemo(() => {
    const rows = activeDomain === UNLINKED_KEY ? unlinkedRows : (selectedSchema?.traceRows || []);
    const byTrace = new Map(); // insertion order == first-appearance order
    for (const row of rows) {
      if (!byTrace.has(row.trace)) byTrace.set(row.trace, []);
      byTrace.get(row.trace).push(row);
    }
    const groups = Array.from(byTrace.entries()).map(([trace, values]) => ({
      trace,
      // values arrives already chronologically ascending (see
      // amctoshsEntityGraph.js) — order numbers are assigned here, fixed,
      // before any display-direction reversal.
      values: values.map((v, i) => ({ ...v, order: i + 1 })),
    }));
    // Groups themselves are ordered by their own earliest reading —
    // whichever trace started being recorded first is listed first.
    groups.sort((a, b) => new Date(a.values[0].timestamp) - new Date(b.values[0].timestamp));
    return groups;
  }, [activeDomain, unlinkedRows, selectedSchema]);

  const visibleGroups = useMemo(() => (
    traceGroups.map((g) => ({ ...g, values: sortOrder === "asc" ? g.values : g.values.slice().reverse() }))
  ), [traceGroups, sortOrder]);

  const totalSchemas = Array.from(byDomain.values()).reduce((n, list) => n + list.length, 0);
  const totalTraceRows = Array.from(byDomain.values()).reduce((n, list) => n + list.reduce((m, s) => m + s.traceRows.length, 0), 0) + unlinkedRows.length;

  const selectDomain = (domain) => {
    setActiveDomain(domain);
    setSelectedKey(null);
    setSelectedTrace(null);
    setSchemaSearch("");
    setDrawerOpen(false);
  };

  const selectSchema = (key) => {
    setSelectedKey(key);
    setSelectedTrace(null);
    setDrawerOpen(false);
  };

  // ── AMCTOSHS Sub-Entity Schema — edit / delete ──────────────────────────
  const startEditSchema = (s, ev) => {
    ev.stopPropagation();
    setEditingSchemaKey(s.key);
    setEditSchemaName(s.name);
    setEditSchemaDomain(s.domain);
    setRowError("");
  };
  const cancelEditSchema = () => setEditingSchemaKey(null);

  const saveEditSchema = async (s) => {
    const name = editSchemaName.trim();
    if (!name) return;
    try {
      const updated = await updateAmctoshsEntity(s.id, { name, domain: editSchemaDomain });
      setEntities((prev) => prev.map((e) => (e.id === s.id ? updated : e)));
      setEditingSchemaKey(null);
    } catch (err) {
      setRowError(err.message || "Failed to update that schema.");
    }
  };

  const deleteSchema = async (s, ev) => {
    ev.stopPropagation();
    if (!window.confirm(`Delete the AMCTOSHS Sub-Entity Schema "${s.name}"? Its own record is removed. Any AMCTOSHS Traces/Trace Values that reference it by name are not deleted — they'll show up under "Unlinked" until relinked to a schema of the same name.`)) return;
    const prevEntities = entities;
    setEntities((prev) => prev.filter((e) => e.id !== s.id));
    if (selectedKey === s.key) { setSelectedKey(null); setSelectedTrace(null); }
    try {
      await deleteAmctoshsEntity(s.id);
    } catch (err) {
      setEntities(prevEntities);
      setRowError(err.message || "Failed to delete that schema.");
    }
  };

  // ── AMCTOSHS Trace Value — edit / delete ────────────────────────────────
  const startEditValue = (v) => {
    setEditingValueId(v.id);
    setEditValueText(v.value);
    setEditValueUnit(v.unit || "");
    setRowError("");
  };
  const cancelEditValue = () => setEditingValueId(null);

  const saveEditValue = async (v) => {
    const value = editValueText.trim();
    if (!value) return;
    if (v.typeKey === "trace_value" && !editValueUnit.trim()) {
      setRowError("Entity Schema Trace Value must include a unit.");
      return;
    }
    try {
      const updated = await updateAmctoshsEntity(v.id, { value, unit: editValueUnit.trim() });
      setEntities((prev) => prev.map((e) => (e.id === v.id ? updated : e)));
      setEditingValueId(null);
    } catch (err) {
      setRowError(err.message || "Failed to update that value.");
    }
  };

  const deleteValue = async (v) => {
    if (!window.confirm(`Delete this AMCTOSHS Trace Value (${formatTraceValue(v)})? This cannot be undone.`)) return;
    const prevEntities = entities;
    setEntities((prev) => prev.filter((e) => e.id !== v.id));
    try {
      await deleteAmctoshsEntity(v.id);
    } catch (err) {
      setEntities(prevEntities);
      setRowError(err.message || "Failed to delete that value.");
    }
  };

  const domainColor = (d) => DOMAIN_COLOR[d] || "#9e9e9e";

  // Bundled so renderTraces (a module-level function, not a component
  // closure) can reach the AMCTOSHS Trace Value edit/delete state and
  // handlers without needing a dozen separate positional params.
  const valueRowHandlers = {
    editingValueId, editValueText, editValueUnit,
    setEditValueText, setEditValueUnit,
    startEditValue, cancelEditValue, saveEditValue, deleteValue,
  };

  // Sits above BOTH #cs_left and #cs_right (the container holding the
  // schema list and the trace-viewing table) — not inside the aside —
  // so it always spans the full page width in one row, regardless of how
  // narrow #cs_left itself is.
  const domainTabsBar = (
    <div id="cs_domain_tabs" role="tablist" aria-label="AMCTOSHS Domain">
      {domainTabs.map((d) => (
        <button
          key={d}
          type="button"
          role="tab"
          aria-selected={activeDomain === d}
          className={`cs_domain_tab${activeDomain === d ? " cs_domain_tab--active" : ""}`}
          style={{ "--dim-color": domainColor(d) }}
          onClick={() => selectDomain(d)}
        >
          {d}
          <span className="cs_domain_tab_count">{(byDomain.get(d) || []).length}</span>
        </button>
      ))}
      {unlinkedRows.length > 0 && (
        <button
          type="button"
          role="tab"
          aria-selected={activeDomain === UNLINKED_KEY}
          className={`cs_domain_tab cs_domain_tab--unlinked${activeDomain === UNLINKED_KEY ? " cs_domain_tab--active" : ""}`}
          onClick={() => selectDomain(UNLINKED_KEY)}
          title="AMCTOSHS Traces that reference a Sub-Entity Schema the Entity Builder hasn't named yet"
        >
          <i className="bx bx-error" /> Unlinked
          <span className="cs_domain_tab_count">{unlinkedRows.length}</span>
        </button>
      )}
    </div>
  );

  const asideContent = (
    activeDomain !== UNLINKED_KEY && (
        <>
          <div id="cs_schema_head">
            <span className="cs_panel_label">AMCTOSHS Sub-Entity Schemas</span>
            <span className="cs_schema_count">{schemasInDomain.length}</span>
          </div>

          {schemasInDomain.length > 4 && (
            <div className="cs_search_wrap">
              <i className="fi fi-rr-search cs_search_icon" />
              <input
                className="cs_input cs_search_input"
                placeholder="Search sub-entities…"
                value={schemaSearch}
                onChange={(e) => setSchemaSearch(e.target.value)}
              />
              {schemaSearch && (
                <button className="cs_search_clear" onClick={() => setSchemaSearch("")}><i className="fi fi-rr-cross-small" /></button>
              )}
            </div>
          )}

          <div id="cs_schema_list">
            {schemasInDomain.length === 0 ? (
              <div className="cs_empty">
                <i className="fi fi-rr-shapes" />
                <p>No AMCTOSHS sub-entities instantiated in this domain yet.</p>
                <p className="cs_empty_hint">Build one from the AMCTOSHS Entity Builder in the PDF Reader.</p>
              </div>
            ) : filteredSchemas.length === 0 ? (
              <div className="cs_empty"><p className="cs_empty_hint">No match for &ldquo;{schemaSearch}&rdquo;</p></div>
            ) : (
              filteredSchemas.map((s) => (
                editingSchemaKey === s.key ? (
                  <div key={s.key} className="cs_edit_form cs_edit_form--schema">
                    <input
                      className="cs_input"
                      autoFocus
                      value={editSchemaName}
                      onChange={(e) => setEditSchemaName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveEditSchema(s);
                        if (e.key === "Escape") cancelEditSchema();
                      }}
                      placeholder="Sub-Entity Schema name"
                    />
                    <select
                      className="cs_input cs_select"
                      value={editSchemaDomain}
                      onChange={(e) => setEditSchemaDomain(e.target.value)}
                    >
                      {ENTITY_DOMAINS.map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                    <div className="cs_edit_form_actions">
                      <button type="button" className="cs_edit_form_save" onClick={() => saveEditSchema(s)}>
                        <i className="fi fi-rr-check" /> Save
                      </button>
                      <button type="button" className="cs_edit_form_cancel" onClick={cancelEditSchema}>
                        <i className="fi fi-rr-cross-small" /> Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    key={s.key}
                    type="button"
                    className={`cs_schema_row${selectedKey === s.key ? " cs_schema_row--active" : ""}`}
                    onClick={() => selectSchema(s.key)}
                  >
                    <span className="cs_schema_name">{s.name}</span>
                    <span className="cs_inst_count" title="AMCTOSHS Traces recorded">{s.traceRows.length}</span>
                    <span className="cs_row_actions">
                      <span
                        className="cs_row_action_btn"
                        role="button"
                        tabIndex={0}
                        title="Edit this AMCTOSHS Sub-Entity Schema"
                        onClick={(ev) => startEditSchema(s, ev)}
                      >
                        <i className="fi fi-rr-pencil" />
                      </span>
                      <span
                        className="cs_row_action_btn cs_row_action_btn--danger"
                        role="button"
                        tabIndex={0}
                        title="Delete this AMCTOSHS Sub-Entity Schema"
                        onClick={(ev) => deleteSchema(s, ev)}
                      >
                        <i className="fi fi-rr-trash" />
                      </span>
                    </span>
                  </button>
                )
              ))
            )}
          </div>
        </>
    )
  );

  return (
    <div id="cs_root">
      <div id="cs_header">
        <button id="cs_back" onClick={() => navigate("/home")} title="Back">
          <i className="fi fi-rr-arrow-left" />
        </button>
        <button id="cs_drawer_toggle" onClick={() => setDrawerOpen((v) => !v)} title="Browse AMCTOSHS Sub-Entity Schemas">
          <i className="fi fi-rr-menu-burger" />
        </button>
        <div id="cs_header_titles">
          <span id="cs_title">AMCTOSHS Morphe</span>
          <span id="cs_subtitle">
            AMCTOSHS Domain → AMCTOSHS Sub-Entity Schema → AMCTOSHS Trace → AMCTOSHS Trace Value
          </span>
        </div>
        <div id="cs_header_meta">
          <span className="cs_count_badge">{totalSchemas} sub-entit{totalSchemas !== 1 ? "ies" : "y"}</span>
          <span className="cs_count_badge cs_count_badge--inst">{totalTraceRows} trace{totalTraceRows !== 1 ? "s" : ""}</span>
        </div>
      </div>

      {domainTabsBar}

      {rowError && (
        <div id="cs_row_error">
          <i className="bx bx-error" /> {rowError}
          <button type="button" onClick={() => setRowError("")}><i className="fi fi-rr-cross-small" /></button>
        </div>
      )}

      <div id="cs_body">
        <div id="cs_left">{asideContent}</div>

        {drawerOpen && (
          <div id="cs_drawer_backdrop" onClick={() => setDrawerOpen(false)}>
            <div id="cs_drawer_sheet" onClick={(e) => e.stopPropagation()}>
              {asideContent}
            </div>
          </div>
        )}

        <div id="cs_right">
          {loading ? (
            <div id="cs_no_selection"><i className="bx bx-loader-circle pdf_icon_spin" /><p>Loading AMCTOSHS sub-entities…</p></div>
          ) : loadError ? (
            <div id="cs_no_selection"><i className="bx bx-error" /><p>{loadError}</p></div>
          ) : activeDomain === UNLINKED_KEY ? (
            <>
              <div id="cs_inst_header">
                <div id="cs_inst_header_title">
                  <span id="cs_schema_label">Unlinked AMCTOSHS Traces</span>
                  <span className="cs_inst_header_count">{unlinkedRows.length} row{unlinkedRows.length !== 1 ? "s" : ""}</span>
                </div>
              </div>
              <p className="cs_unlinked_note">
                These AMCTOSHS Trace Values reference a trace name that no AMCTOSHS Sub-Entity Schema
                in the Entity Builder currently claims — usually because the Schema Trace (the named
                slot, e.g. &ldquo;Heart Rate&rdquo;) was never declared under a Schema (e.g.
                &ldquo;Heart&rdquo;) before a value was recorded for it. Nothing is discarded; build
                the missing Schema Trace in the AMCTOSHS Entity Builder to link these in.
              </p>
              {renderTraces(visibleGroups, selectedTrace, setSelectedTrace, sortOrder, setSortOrder, valueRowHandlers)}
            </>
          ) : !selectedSchema ? (
            <div id="cs_no_selection">
              <i className="fi fi-rr-shapes" />
              <p>Select an AMCTOSHS Sub-Entity Schema to view its traces</p>
              <p className="cs_empty_hint">AMCTOSHS Domain: {activeDomain}</p>
            </div>
          ) : (
            <>
              <div id="cs_inst_header">
                <div id="cs_inst_header_title">
                  <span id="cs_schema_label">{selectedSchema.name}</span>
                  <span className="cs_dim_badge" style={{ "--dim-color": domainColor(activeDomain) }}>{activeDomain}</span>
                  <span className="cs_inst_header_count">{traceGroups.length} AMCTOSHS Trace{traceGroups.length !== 1 ? "s" : ""}</span>
                </div>
              </div>
              <div className="cs_meta_line">
                <span>AMCTOSHS Domain: <strong>{activeDomain}</strong></span>
                <span>AMCTOSHS Sub-Entity Schema: <strong>{selectedSchema.name}</strong></span>
              </div>
              {renderTraces(visibleGroups, selectedTrace, setSelectedTrace, sortOrder, setSortOrder, valueRowHandlers)}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// A list of AMCTOSHS Traces (names only, never duplicated) — click one to
// render its AMCTOSHS Trace Values as a list alongside it. Order is each
// value's fixed position within ITS OWN trace's history (1 = earliest),
// not the raw clock timestamp — the underlying timestamp is never
// discarded, only de-emphasized, so it stays available as a hover title.
// Never reduces a trace to its latest value only: every historical value
// stays visible (spec §10) once its trace is selected.
const renderTraces = (groups, selectedTraceName, onSelectTrace, sortOrder, setSortOrder, valueHandlers) => {
  const {
    editingValueId, editValueText, editValueUnit,
    setEditValueText, setEditValueUnit,
    startEditValue, cancelEditValue, saveEditValue, deleteValue,
  } = valueHandlers;
  const selectedGroup = groups.find((g) => g.trace === selectedTraceName) || null;
  return (
    <div id="cs_trace_table_wrap">
      <div id="cs_trace_table_head">
        <span className="cs_trace_table_title">AMCTOSHS Traces</span>
        <button
          type="button"
          id="cs_sort_toggle"
          onClick={() => setSortOrder((v) => (v === "asc" ? "desc" : "asc"))}
          title="Toggle chronological order"
        >
          <i className={`bx ${sortOrder === "asc" ? "bx-sort-up" : "bx-sort-down"}`} />
          {sortOrder === "asc" ? "Oldest → Newest" : "Newest → Oldest"}
        </button>
      </div>
      {groups.length === 0 ? (
        <div className="cs_empty cs_inst_empty">
          <i className="fi fi-rr-document" />
          <p>No AMCTOSHS traces recorded for this sub-entity yet.</p>
        </div>
      ) : (
        <div id="cs_trace_split">
          <div id="cs_trace_list">
            {groups.map((group) => (
              <button
                key={group.trace}
                type="button"
                className={`cs_trace_list_row${selectedTraceName === group.trace ? " cs_trace_list_row--active" : ""}`}
                onClick={() => onSelectTrace(group.trace)}
              >
                <span className="cs_trace_list_name">{group.trace}</span>
                <span className="cs_inst_count">{group.values.length}</span>
              </button>
            ))}
          </div>

          <div id="cs_trace_values">
            {!selectedGroup ? (
              <div className="cs_empty cs_inst_empty">
                <i className="fi fi-rr-arrow-small-left" />
                <p>Select an AMCTOSHS Trace to view its AMCTOSHS Trace Values</p>
              </div>
            ) : (
              <>
                <div className="cs_trace_values_head">
                  <span className="cs_trace_group_name">{selectedGroup.trace}</span>
                  <span className="cs_inst_count">{selectedGroup.values.length} AMCTOSHS Trace Value{selectedGroup.values.length !== 1 ? "s" : ""}</span>
                </div>
                <ul id="cs_value_list">
                  {selectedGroup.values.map((v) => (
                    editingValueId === v.id ? (
                      <li key={v.id} className="cs_edit_form cs_edit_form--value">
                        <input
                          className="cs_input"
                          autoFocus
                          value={editValueText}
                          onChange={(e) => setEditValueText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveEditValue(v);
                            if (e.key === "Escape") cancelEditValue();
                          }}
                          placeholder="Value"
                        />
                        <input
                          className="cs_input cs_edit_form_unit"
                          value={editValueUnit}
                          onChange={(e) => setEditValueUnit(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveEditValue(v);
                            if (e.key === "Escape") cancelEditValue();
                          }}
                          placeholder={v.typeKey === "trace_value" ? "Unit (required)" : "Unit"}
                        />
                        <div className="cs_edit_form_actions">
                          <button type="button" className="cs_edit_form_save" onClick={() => saveEditValue(v)}>
                            <i className="fi fi-rr-check" /> Save
                          </button>
                          <button type="button" className="cs_edit_form_cancel" onClick={cancelEditValue}>
                            <i className="fi fi-rr-cross-small" /> Cancel
                          </button>
                        </div>
                      </li>
                    ) : (
                      <li key={v.id} className="cs_value_list_row">
                        <span className="cs_trace_order" title={formatTimestamp(v.timestamp)}>{v.order}</span>
                        <span className="cs_value_list_val">{formatTraceValue(v)}</span>
                        <span className="cs_row_type_tag">{v.typeLabel}</span>
                        <span className="cs_row_actions">
                          <span
                            className="cs_row_action_btn"
                            role="button"
                            tabIndex={0}
                            title="Edit this AMCTOSHS Trace Value"
                            onClick={() => startEditValue(v)}
                          >
                            <i className="fi fi-rr-pencil" />
                          </span>
                          <span
                            className="cs_row_action_btn cs_row_action_btn--danger"
                            role="button"
                            tabIndex={0}
                            title="Delete this AMCTOSHS Trace Value"
                            onClick={() => deleteValue(v)}
                          >
                            <i className="fi fi-rr-trash" />
                          </span>
                        </span>
                      </li>
                    )
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
