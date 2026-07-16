import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./unitsExtraction.css";
import { apiUrl } from "../config/api.js";
import { readStoredSession } from "../utils/sessionCleanup";
import { LINGUISTIC_UNITS } from "../Linguistics/linguisticUnits";
import PDFPage from "../PDF/PDFPage.jsx";

const LOG_KEY = "mctosh_units_extraction_log";

const loadLog = () => {
  try { return JSON.parse(localStorage.getItem(LOG_KEY) || "[]"); } catch { return []; }
};
const saveLog = (list) => localStorage.setItem(LOG_KEY, JSON.stringify(list));

const authFetch = (url, options = {}) => {
  const token = readStoredSession()?.token || "";
  return fetch(url, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` } });
};

export default function UnitsExtraction() {
  const navigate = useNavigate();

  const [log, setLog] = useState(loadLog);

  const [sources,            setSources]            = useState([]);
  const [selectedSourceId,   setSelectedSourceId]    = useState("");
  const [selectedSourceName, setSelectedSourceName]  = useState("");
  const [localFile,          setLocalFile]           = useState(null);
  const [pdfBlobUrl,         setPdfBlobUrl]          = useState(null); // truthy marker gating the reader

  const fileInputRef = useRef(null);

  useEffect(() => {
    authFetch(apiUrl("/api/sources"))
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.sources) setSources(d.sources.filter(s => /\.pdf$/i.test(s.name))); })
      .catch(() => {});
  }, []);

  const handleOpenSource = () => {
    if (!selectedSourceId) return;
    const src = sources.find(s => s._id === selectedSourceId);
    setLocalFile(null);
    setSelectedSourceName(src?.name || "document.pdf");
    setPdfBlobUrl(`source:${selectedSourceId}`);
  };

  const handleUploadClick = () => fileInputRef.current?.click();

  const handleLocalFile = (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file || file.type !== "application/pdf") return;
    setSelectedSourceId("");
    setSelectedSourceName(file.name);
    setLocalFile(file);
    setPdfBlobUrl(`local:${file.name}:${Date.now()}`);
  };

  // Called by the embedded PDFPage reader when the user runs "Linguistic Analysis"
  // on a selected span of text.
  const handleAnalyze = useCallback(async (text) => {
    const res = await authFetch(apiUrl("/api/youtube/classify-units"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Analysis failed.");
    const entry = { id: Date.now(), text, units: data, source: selectedSourceName, at: new Date().toISOString() };
    setLog((prev) => {
      const next = [entry, ...prev];
      saveLog(next);
      return next;
    });
  }, [selectedSourceName]);

  const removeEntry = (id) => {
    setLog((prev) => {
      const next = prev.filter(e => e.id !== id);
      saveLog(next);
      return next;
    });
  };

  const clearLog = () => { setLog([]); saveLog([]); };

  const fmt = (iso) => {
    const d = new Date(iso);
    return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div id="ue_root">

      {/* ── Header ── */}
      <div id="ue_header">
        <button id="ue_back" onClick={() => navigate("/home")} title="Back">
          <i className="fi fi-rr-arrow-left" />
        </button>
        <div id="ue_header_titles">
          <span id="ue_title">AMCTOSHS Units Extraction while Studying</span>
          <span id="ue_subtitle">Select a span of text to run a Linguistic Analysis on it</span>
        </div>
        <div id="ue_header_meta">
          <span id="ue_log_count">{log.length} analys{log.length === 1 ? "is" : "es"}</span>
        </div>
      </div>

      {/* ── Body ── */}
      <div id="ue_layout">

        {/* ── Left: Linguistic Analysis log ── */}
        <div id="ue_left">
          <div className="ue_panel_head">
            <i className="fi fi-rr-brain" />
            <span>Linguistic Analysis</span>
            {log.length > 0 && (
              <button className="ue_clear_all" onClick={clearLog} title="Clear all analyses">Clear all</button>
            )}
          </div>

          <div id="ue_log_list">
            {log.length === 0 ? (
              <p className="ue_empty">Select text on the right and run a Linguistic Analysis to see results here.</p>
            ) : (
              log.map(entry => (
                <div key={entry.id} className="ue_log_entry">
                  <div className="ue_entry_top">
                    <span className="ue_entry_snippet" title={entry.text}>{entry.text}</span>
                    <button className="ue_entry_remove" onClick={() => removeEntry(entry.id)} title="Remove">
                      <i className="fi fi-rr-cross-small" />
                    </button>
                  </div>
                  <div className="ue_entry_units">
                    {LINGUISTIC_UNITS.map(u => {
                      const items = entry.units?.[u.id] || [];
                      if (!items.length) return null;
                      return (
                        <div key={u.id} className="ue_unit_group" style={{ "--lu-color": u.color }}>
                          <span className="ue_unit_label">{u.label}</span>
                          <div className="ue_unit_chips">
                            {items.map((it, i) => <span key={i} className="ue_unit_chip">{it}</span>)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="ue_entry_meta">
                    {entry.source && <span className="ue_entry_source">{entry.source}</span>}
                    <span className="ue_entry_time">{fmt(entry.at)}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ── Right: PDF reader ── */}
        <div id="ue_right">
          <div id="ue_source_row">
            <select
              id="ue_source_select"
              value={selectedSourceId}
              onChange={e => {
                const nextId = e.target.value;
                setLocalFile(null);
                setSelectedSourceId(nextId);
                setSelectedSourceName(sources.find(s => s._id === nextId)?.name || "");
                setPdfBlobUrl(null);
              }}
            >
              <option value="">— Select a PDF source —</option>
              {sources.map(s => (
                <option key={s._id} value={s._id}>{s.name}</option>
              ))}
            </select>
            <button id="ue_open_btn" onClick={handleOpenSource} disabled={!selectedSourceId}>
              <i className="fi fi-rr-eye" /> Open
            </button>
            <button id="ue_upload_btn" onClick={handleUploadClick} title="Upload a PDF from this device">
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

          {!pdfBlobUrl && (
            <div id="ue_doc_empty">
              <i className="fi fi-rr-book-open-reader" />
              <p>{sources.length === 0 ? "No PDF sources available — upload one instead" : "Select a source and click Open, or upload a PDF"}</p>
            </div>
          )}

          {pdfBlobUrl && (
            <div id="ue_reader_wrap">
              <PDFPage
                embeddedSourceId={localFile ? "" : selectedSourceId}
                embeddedPdfName={selectedSourceName}
                embeddedFile={localFile}
                embeddedHomePath="/units-extraction"
                selectionOnly
                onSelectionAction={handleAnalyze}
                selectionActionLabel="Linguistic Analysis"
              />
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
