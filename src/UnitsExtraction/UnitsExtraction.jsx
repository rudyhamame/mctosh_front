import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as pdfjsLib from "pdfjs-dist";
import "./unitsExtraction.css";
import { apiUrl } from "../config/api.js";
import { readStoredSession } from "../utils/sessionCleanup";
import { LINGUISTIC_UNITS } from "../Linguistics/linguisticUnits";

pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

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

  const [sources,          setSources]          = useState([]);
  const [selectedSourceId, setSelectedSourceId] = useState("");

  const [docText,    setDocText]    = useState("");
  const [docName,    setDocName]    = useState("");
  const [docLoading, setDocLoading] = useState(false);
  const [docError,   setDocError]   = useState("");

  const [selection,    setSelection]    = useState(null); // { text, x, y }
  const [analyzing,    setAnalyzing]    = useState(false);
  const [analyzeError, setAnalyzeError] = useState("");

  const fileInputRef = useRef(null);
  const readerRef     = useRef(null);
  const selectBarRef  = useRef(null);

  useEffect(() => {
    authFetch(apiUrl("/api/sources"))
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.sources) setSources(d.sources.filter(s => s.type === "pdf")); })
      .catch(() => {});
  }, []);

  const dismissSelection = useCallback(() => {
    setSelection(null);
    setAnalyzeError("");
    window.getSelection()?.removeAllRanges();
  }, []);

  const extractText = useCallback(async (arrayBuffer, name) => {
    setDocLoading(true);
    setDocError("");
    setDocText("");
    dismissSelection();
    try {
      const doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const paragraphs = [];
      for (let p = 1; p <= doc.numPages; p++) {
        const page    = await doc.getPage(p);
        const content = await page.getTextContent();
        const pageText = content.items.map(it => it.str + (it.hasEOL ? "\n" : " ")).join("").trim();
        if (pageText) paragraphs.push(pageText);
      }
      setDocText(paragraphs.join("\n\n"));
      setDocName(name);
    } catch {
      setDocError("Could not read this PDF.");
    } finally {
      setDocLoading(false);
    }
  }, [dismissSelection]);

  const handleOpenSource = async () => {
    if (!selectedSourceId) return;
    const src = sources.find(s => s._id === selectedSourceId);
    setDocLoading(true);
    setDocError("");
    try {
      const res = await authFetch(apiUrl(`/api/sources/${selectedSourceId}/download`));
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setDocError(`Could not load PDF: ${data.error || res.status}`);
        setDocLoading(false);
        return;
      }
      const arrayBuffer = await res.arrayBuffer();
      extractText(arrayBuffer, src?.name || "document.pdf");
    } catch (e) {
      setDocError(`Could not load PDF: ${e.message}`);
      setDocLoading(false);
    }
  };

  const handleUploadClick = () => fileInputRef.current?.click();

  const handleLocalFile = (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (file.type !== "application/pdf") { setDocError("Please choose a PDF file."); return; }
    setSelectedSourceId("");
    file.arrayBuffer().then(buf => extractText(buf, file.name));
  };

  // ── Text selection → floating "Linguistic Analysis" bar ─────────────────
  const handleMouseUp = (e) => {
    const sel  = window.getSelection();
    const text = sel?.toString().replace(/\s+/g, " ").trim();
    if (!text || sel.rangeCount === 0) return;
    if (!readerRef.current?.contains(sel.anchorNode)) return;
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    setAnalyzeError("");
    setSelection({ text, x: rect.left + rect.width / 2, y: rect.bottom + 8 });
  };

  const handleAnalyze = useCallback(async () => {
    if (!selection || analyzing) return;
    setAnalyzing(true);
    setAnalyzeError("");
    try {
      const res = await authFetch(apiUrl("/api/youtube/classify-units"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: selection.text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Analysis failed.");
      const entry = { id: Date.now(), text: selection.text, units: data, source: docName, at: new Date().toISOString() };
      const next  = [entry, ...log];
      setLog(next);
      saveLog(next);
      dismissSelection();
    } catch (e) {
      setAnalyzeError(e.message);
    } finally {
      setAnalyzing(false);
    }
  }, [selection, analyzing, log, docName, dismissSelection]);

  const removeEntry = (id) => {
    const next = log.filter(e => e.id !== id);
    setLog(next);
    saveLog(next);
  };

  const clearLog = () => { setLog([]); saveLog([]); };

  // Dismiss the floating bar on outside click
  useEffect(() => {
    if (!selection) return;
    const handler = (e) => {
      if (selectBarRef.current && !selectBarRef.current.contains(e.target)) dismissSelection();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [selection, dismissSelection]);

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
          <span id="ue_title">MCTOSHS Units Extraction while Studying</span>
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

        {/* ── Right: Text reader ── */}
        <div id="ue_right">
          <div id="ue_source_row">
            <select
              id="ue_source_select"
              value={selectedSourceId}
              onChange={e => setSelectedSourceId(e.target.value)}
            >
              <option value="">— Select a PDF source —</option>
              {sources.map(s => (
                <option key={s._id} value={s._id}>{s.name}</option>
              ))}
            </select>
            <button id="ue_open_btn" onClick={handleOpenSource} disabled={!selectedSourceId || docLoading}>
              {docLoading
                ? <i className="fi fi-rr-spinner ue_spin" />
                : <><i className="fi fi-rr-eye" /> Open</>
              }
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

          {docError && (
            <div id="ue_doc_error">
              <i className="fi fi-rr-triangle-warning" /> {docError}
            </div>
          )}

          {!docText && !docLoading && !docError && (
            <div id="ue_doc_empty">
              <i className="fi fi-rr-book-open-reader" />
              <p>{sources.length === 0 ? "No PDF sources available — upload one instead" : "Select a source and click Open, or upload a PDF"}</p>
            </div>
          )}

          {docLoading && (
            <div id="ue_doc_empty">
              <i className="fi fi-rr-spinner ue_spin" />
              <p>Loading…</p>
            </div>
          )}

          {docText && (
            <div id="ue_reader" ref={readerRef} onMouseUp={handleMouseUp}>
              {docText.split(/\n{2,}/).map((para, i) => (
                <p key={i} className="ue_paragraph">{para}</p>
              ))}
            </div>
          )}
        </div>

      </div>

      {/* ── Floating selection bar ── */}
      {selection && (
        <div ref={selectBarRef} id="ue_select_bar" style={{ left: selection.x, top: selection.y }}>
          <span id="ue_select_snippet">
            {selection.text.length > 60 ? selection.text.slice(0, 60) + "…" : selection.text}
          </span>
          <button id="ue_analyze_btn" onClick={handleAnalyze} disabled={analyzing}>
            {analyzing ? "Analyzing…" : <><i className="fi fi-rr-brain" /> Linguistic Analysis</>}
          </button>
          <button id="ue_select_cancel" onClick={dismissSelection} title="Cancel">✕</button>
          {analyzeError && <span id="ue_select_err">{analyzeError}</span>}
        </div>
      )}
    </div>
  );
}
