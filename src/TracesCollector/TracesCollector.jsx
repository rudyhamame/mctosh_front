import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import "./tracesCollector.css";
import { apiUrl } from "../config/api.js";
import PDFPage from "../PDF/PDFPage.jsx";

function authHeader() {
  const raw = sessionStorage.getItem("state") || localStorage.getItem("state") || "{}";
  const token = (() => { try { return JSON.parse(raw)?.token || ""; } catch { return ""; } })();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const REGISTRY_KEY = "mctosh_trace_registry";
const LOG_KEY      = "mctosh_trace_log";

const loadRegistry = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(REGISTRY_KEY) || "[]");
    // migrate old string-only format
    return raw.map(r => (typeof r === "string" ? { name: r, unit: "" } : r));
  } catch { return []; }
};
const saveRegistry = (list) => localStorage.setItem(REGISTRY_KEY, JSON.stringify(list));

const loadLog = () => {
  try { return JSON.parse(localStorage.getItem(LOG_KEY) || "[]"); } catch { return []; }
};
const saveLog = (list) => localStorage.setItem(LOG_KEY, JSON.stringify(list));

export default function TracesCollector() {
  const navigate = useNavigate();

  const [registry,      setRegistry]      = useState(loadRegistry);
  const [log,           setLog]           = useState(loadLog);
  const [newName,       setNewName]       = useState("");
  const [newUnit,       setNewUnit]       = useState("");
  const [regSearch,     setRegSearch]     = useState("");
  const [bulkMode,      setBulkMode]      = useState(false);
  const [bulkText,      setBulkText]      = useState("");
  const [selectedTrace, setSelectedTrace] = useState("");
  const [traceValue,    setTraceValue]    = useState("");
  const [unit,          setUnit]          = useState("");

  // Right-panel tabs
  const [rightTab,         setRightTab]         = useState("log");
  const [sources,          setSources]          = useState([]);
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [selectedSourceName, setSelectedSourceName] = useState("");
  const [pdfBlobUrl,       setPdfBlobUrl]       = useState(null);
  const [pdfLoading,       setPdfLoading]       = useState(false);
  const [pdfError,         setPdfError]         = useState("");
  const [localFile,        setLocalFile]        = useState(null);
  const blobRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    fetch(apiUrl("/api/sources"), { headers: authHeader() })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.sources) setSources(d.sources.filter(s => /\.pdf$/i.test(s.name))); })
      .catch(() => {});
  }, []);

  // Revoke previous blob URL when source changes or component unmounts
  useEffect(() => () => { if (blobRef.current) URL.revokeObjectURL(blobRef.current); }, []);

  const handleOpenSource = async () => {
    if (!selectedSourceId) return;
    const nextSource = sources.find((source) => source._id === selectedSourceId);
    setLocalFile(null);
    setSelectedSourceName(nextSource?.name || "document.pdf");
    setPdfError("");
    setPdfLoading(true);
    setPdfBlobUrl(null);
    try {
      setPdfBlobUrl(`source:${selectedSourceId}`);
    } catch (e) {
      setPdfError(e.message);
    } finally {
      setPdfLoading(false);
    }
  };

  const handleUploadClick = () => fileInputRef.current?.click();

  const handleLocalFile = (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (file.type !== "application/pdf") {
      setPdfError("Please choose a PDF file.");
      return;
    }
    setSelectedSourceId("");
    setSelectedSourceName(file.name);
    setPdfError("");
    setLocalFile(file);
    setPdfBlobUrl(`local:${file.name}:${Date.now()}`);
  };

  // ── Registry management ───────────────────────────────────────
  const addToRegistry = () => {
    const name = newName.trim();
    if (!name || registry.some(r => r.name === name)) { setNewName(""); setNewUnit(""); return; }
    const next = [...registry, { name, unit: newUnit.trim() }]
      .sort((a, b) => a.name.localeCompare(b.name));
    setRegistry(next);
    saveRegistry(next);
    setNewName("");
    setNewUnit("");
  };

  const addBulk = () => {
    const existing = new Set(registry.map(r => r.name));
    const names = bulkText
      .split(/[\n,]+/)
      .map(s => s.trim())
      .filter(s => s && !existing.has(s));
    if (!names.length) { setBulkText(""); setBulkMode(false); return; }
    const next = [...registry, ...names.map(n => ({ name: n, unit: "" }))]
      .sort((a, b) => a.name.localeCompare(b.name));
    setRegistry(next);
    saveRegistry(next);
    setBulkText("");
    setBulkMode(false);
  };

  const removeFromRegistry = (name) => {
    const next = registry.filter(r => r.name !== name);
    setRegistry(next);
    saveRegistry(next);
    if (selectedTrace === name) { setSelectedTrace(""); setTraceValue(""); setUnit(""); }
  };

  const clearRegistry = () => {
    setRegistry([]);
    saveRegistry([]);
    setSelectedTrace(""); setTraceValue(""); setUnit("");
    setRegSearch("");
  };

  const filteredRegistry = regSearch.trim()
    ? registry.filter(r => r.name.toLowerCase().includes(regSearch.toLowerCase()))
    : registry;

  // ── Log entry ─────────────────────────────────────────────────
  const logEntry = () => {
    if (!selectedTrace || !traceValue.trim()) return;
    const entry = {
      id:        Date.now(),
      trace:     selectedTrace,
      value:     traceValue.trim(),
      unit:      unit.trim(),
      timestamp: new Date().toISOString(),
    };
    const next = [entry, ...log];
    setLog(next);
    saveLog(next);
    setTraceValue("");
    setUnit("");
  };

  const removeLogEntry = (id) => {
    const next = log.filter(e => e.id !== id);
    setLog(next);
    saveLog(next);
  };

  const clearLog = () => { setLog([]); saveLog([]); };

  const fmt = (iso) => {
    const d = new Date(iso);
    return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div id="tc_root">

      {/* ── Header ── */}
      <div id="tc_header">
        <button id="tc_back" onClick={() => navigate("/home")} title="Back">
          <i className="fi fi-rr-arrow-left" />
        </button>
        <div id="tc_header_titles">
          <span id="tc_title">MCTOSHS Traces Collector</span>
          <span id="tc_subtitle">Formal Observable Dimensions — Signs · Measurements · Test Results</span>
        </div>
        <div id="tc_header_meta">
          <span id="tc_log_count">{log.length} trace{log.length !== 1 ? "s" : ""} logged</span>
        </div>
      </div>

      {/* ── Body ── */}
      <div id="tc_layout">

        {/* ── Left: Registry + Observation ── */}
        <div id="tc_left">

          {/* Trace Name Registry */}
          <div className="tc_panel tc_panel--registry">
            <div className="tc_panel_head">
              <i className="fi fi-rr-signal-alt" />
              <span>Trace Name Registry</span>
              <span className="tc_reg_count">{registry.length}</span>
              {registry.length > 0 && (
                <button className="tc_reg_clear_all" onClick={clearRegistry} title="Clear all trace names">
                  Clear all
                </button>
              )}
            </div>

            {/* Add controls */}
            {!bulkMode ? (
              <div className="tc_reg_add_row">
                <input
                  type="text"
                  className="tc_input"
                  placeholder="Trace name…"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && addToRegistry()}
                />
                <input
                  type="text"
                  className="tc_input tc_input--unit"
                  placeholder="Unit…"
                  value={newUnit}
                  onChange={e => setNewUnit(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && addToRegistry()}
                />
                <button className="tc_btn tc_btn--add" onClick={addToRegistry}>
                  <i className="fi fi-rr-plus" /> Add
                </button>
                <button className="tc_btn tc_btn--bulk" onClick={() => setBulkMode(true)} title="Add many at once">
                  Bulk
                </button>
              </div>
            ) : (
              <div className="tc_bulk_area">
                <label className="tc_label">Paste names — one per line or comma-separated</label>
                <textarea
                  className="tc_bulk_textarea"
                  placeholder={"Heart Rate\nBlood Pressure\nSpO2\nTemperature\n…"}
                  value={bulkText}
                  onChange={e => setBulkText(e.target.value)}
                  autoFocus
                />
                <div className="tc_bulk_actions">
                  <button className="tc_btn tc_btn--log" onClick={addBulk} disabled={!bulkText.trim()}>
                    <i className="fi fi-rr-add" /> Add All
                  </button>
                  <button className="tc_btn tc_btn--clear" onClick={() => { setBulkMode(false); setBulkText(""); }}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Search bar */}
            {registry.length > 5 && (
              <div className="tc_reg_search_wrap">
                <i className="fi fi-rr-search tc_reg_search_icon" />
                <input
                  type="text"
                  className="tc_input tc_reg_search_input"
                  placeholder="Filter trace names…"
                  value={regSearch}
                  onChange={e => setRegSearch(e.target.value)}
                />
                {regSearch && (
                  <button className="tc_reg_search_clear" onClick={() => setRegSearch("")}>×</button>
                )}
              </div>
            )}

            {/* Scrollable list */}
            <div className="tc_reg_list">
              {registry.length === 0 ? (
                <p className="tc_empty">No trace names registered yet</p>
              ) : filteredRegistry.length === 0 ? (
                <p className="tc_empty">No match for "{regSearch}"</p>
              ) : (
                filteredRegistry.map(r => (
                  <div key={r.name} className="tc_reg_row">
                    <span className="tc_reg_name">{r.name}</span>
                    {r.unit && <span className="tc_reg_unit">{r.unit}</span>}
                    <button
                      className="tc_reg_del"
                      onClick={() => removeFromRegistry(r.name)}
                      title="Remove"
                    >
                      <i className="fi fi-rr-trash" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Trace Observation */}
          <div className="tc_panel">
            <div className="tc_panel_head">
              <i className="fi fi-rr-eye" />
              <span>Trace Observation</span>
            </div>
            <div className="tc_obs_form">
              <div className="tc_field">
                <label className="tc_label">Trace Name</label>
                <select
                  className="tc_select"
                  value={selectedTrace}
                  onChange={e => {
                    const name = e.target.value;
                    const entry = registry.find(r => r.name === name);
                    setSelectedTrace(name);
                    setTraceValue("");
                    setUnit(entry?.unit || "");
                  }}
                >
                  <option value="">— Select trace —</option>
                  {registry.map(r => (
                    <option key={r.name} value={r.name}>{r.name}{r.unit ? ` (${r.unit})` : ""}</option>
                  ))}
                </select>
              </div>
              <div className="tc_obs_row">
                <div className="tc_field tc_field--grow">
                  <label className="tc_label">Trace Value</label>
                  <input
                    type="text"
                    className="tc_input"
                    placeholder="Enter value…"
                    value={traceValue}
                    disabled={!selectedTrace}
                    onChange={e => setTraceValue(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && logEntry()}
                  />
                </div>
                <div className="tc_field">
                  <label className="tc_label">Unit</label>
                  <input
                    type="text"
                    className="tc_input tc_input--unit"
                    placeholder="e.g. bpm"
                    value={unit}
                    disabled={!selectedTrace}
                    onChange={e => setUnit(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && logEntry()}
                  />
                </div>
              </div>
              <button
                className="tc_btn tc_btn--log"
                onClick={logEntry}
                disabled={!selectedTrace || !traceValue.trim()}
              >
                <i className="fi fi-rr-add" /> Log Observation
              </button>
            </div>
          </div>

        </div>

        {/* ── Right: tabbed panel ── */}
        <div id="tc_right">

          {/* Tab bar */}
          <div id="tc_right_tabs">
            <button
              className={`tc_right_tab${rightTab === "log" ? " tc_right_tab--active" : ""}`}
              onClick={() => setRightTab("log")}
            >
              <i className="fi fi-rr-list" />
              Observation Log
              {log.length > 0 && <span className="tc_right_tab_badge">{log.length}</span>}
            </button>
            <button
              className={`tc_right_tab${rightTab === "source" ? " tc_right_tab--active" : ""}`}
              onClick={() => setRightTab("source")}
            >
              <i className="fi fi-rr-document" />
              Source
            </button>
            {rightTab === "log" && log.length > 0 && (
              <button className="tc_btn tc_btn--clear tc_right_tab_action" onClick={clearLog}>
                <i className="fi fi-rr-trash" /> Clear all
              </button>
            )}
          </div>

          {/* ── Observation Log tab ── */}
          {rightTab === "log" && (
            <>
              {log.length === 0 ? (
                <div id="tc_log_empty">
                  <i className="fi fi-rr-signal-alt" />
                  <p>No observations logged yet</p>
                  <p className="tc_log_empty_hint">Select a trace, enter a value, and click Log Observation</p>
                </div>
              ) : (
                <div id="tc_log_list">
                  {log.map(entry => (
                    <div key={entry.id} className="tc_log_entry">
                      <button
                        className="tc_entry_remove"
                        onClick={() => removeLogEntry(entry.id)}
                        title="Remove"
                      >
                        <i className="fi fi-rr-cross-small" />
                      </button>
                      <div className="tc_entry_top">
                        <span className="tc_entry_name">{entry.trace}</span>
                        <span className="tc_entry_time">{fmt(entry.timestamp)}</span>
                      </div>
                      <div className="tc_entry_value">
                        {entry.value}
                        {entry.unit && <span className="tc_entry_unit"> {entry.unit}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* ── Source tab ── */}
          {rightTab === "source" && (
            <div id="tc_source_panel">
              <div id="tc_source_picker_row">
                <select
                  id="tc_source_picker_select"
                  value={selectedSourceId}
                  onChange={e => {
                    const nextId = e.target.value;
                    const nextSource = sources.find((source) => source._id === nextId);
                    setLocalFile(null);
                    setSelectedSourceId(nextId);
                    setSelectedSourceName(nextSource?.name || "");
                    setPdfBlobUrl(null);
                    setPdfError("");
                  }}
                >
                  <option value="">— Select a PDF source —</option>
                  {sources.map(s => (
                    <option key={s._id} value={s._id}>{s.name}</option>
                  ))}
                </select>
                <button
                  id="tc_source_open_btn"
                  onClick={handleOpenSource}
                  disabled={!selectedSourceId || pdfLoading}
                >
                  {pdfLoading
                    ? <i className="fi fi-rr-spinner tc_spin" />
                    : <><i className="fi fi-rr-eye" /> Open</>
                  }
                </button>
                <button id="tc_source_upload_btn" onClick={handleUploadClick} title="Upload a PDF from this device">
                  <i className="fi fi-rr-upload" /> Upload
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf"
                  style={{ display: "none" }}
                  onChange={handleLocalFile}
                />
              </div>

              {pdfError && (
                <div id="tc_source_error">
                  <i className="fi fi-rr-triangle-warning" /> {pdfError}
                </div>
              )}

              {!pdfBlobUrl && !pdfLoading && !pdfError && (
                <div id="tc_source_empty">
                  <i className="fi fi-rr-file-pdf" />
                  <p>{sources.length === 0 ? "No PDF sources available — upload one instead" : "Select a source and click Open, or upload a PDF"}</p>
                </div>
              )}

              {pdfBlobUrl && (
                <div id="tc_source_reader">
                  <PDFPage
                    embeddedSourceId={localFile ? "" : selectedSourceId}
                    embeddedPdfName={selectedSourceName}
                    embeddedFile={localFile}
                    embeddedHomePath="/traces-collector"
                  />
                </div>
              )}
            </div>
          )}

        </div>

      </div>
    </div>
  );
}
