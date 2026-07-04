import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as pdfjsLib from "pdfjs-dist";
import "./unitsExtraction.css";
import { apiUrl } from "../config/api.js";
import { readStoredSession } from "../utils/sessionCleanup";
import { LINGUISTIC_UNITS } from "../Linguistics/linguisticUnits";

pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;

const LOG_KEY = "mctosh_units_extraction_log";

const loadLog = () => {
  try { return JSON.parse(localStorage.getItem(LOG_KEY) || "[]"); } catch { return []; }
};
const saveLog = (list) => localStorage.setItem(LOG_KEY, JSON.stringify(list));

const authFetch = (url, options = {}) => {
  const token = readStoredSession()?.token || "";
  return fetch(url, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` } });
};

// Multiply two 2-D affine matrices (viewport.transform × item.transform).
const mulTransform = (vt, [a, b, c, d, e, f]) => [
  vt[0] * a + vt[2] * b,
  vt[1] * a + vt[3] * b,
  vt[0] * c + vt[2] * d,
  vt[1] * c + vt[3] * d,
  vt[0] * e + vt[2] * f + vt[4],
  vt[1] * e + vt[3] * f + vt[5],
];

export default function UnitsExtraction() {
  const navigate = useNavigate();

  const [log, setLog] = useState(loadLog);

  const [sources,          setSources]          = useState([]);
  const [selectedSourceId, setSelectedSourceId] = useState("");

  const [pdfDoc,     setPdfDoc]     = useState(null);
  const [pageCount,  setPageCount]  = useState(0);
  const [docName,    setDocName]    = useState("");
  const [docLoading, setDocLoading] = useState(false);
  const [docError,   setDocError]   = useState("");
  const [zoom,       setZoom]       = useState(1);

  const [selection,    setSelection]    = useState(null); // { text, x, y }
  const [analyzing,    setAnalyzing]    = useState(false);
  const [analyzeError, setAnalyzeError] = useState("");

  const fileInputRef      = useRef(null);
  const readerRef         = useRef(null); // scroll container
  const wrapRef           = useRef(null); // canvas wrap — pinch preview transform target
  const selectBarRef      = useRef(null);
  const pageCanvasRefs    = useRef([]);
  const pageContainerRefs = useRef([]);
  const pageTextLayerRefs = useRef([]);
  const fitScaleRef       = useRef(null);  // base fit-to-width scale, computed once per document
  const renderedScaleRef  = useRef([]);    // scale each page's canvas was last rendered at

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

  const loadPdf = useCallback(async (arrayBuffer, name) => {
    setDocLoading(true);
    setDocError("");
    setPdfDoc(null);
    setPageCount(0);
    setZoom(1);
    pageCanvasRefs.current = []; pageContainerRefs.current = []; pageTextLayerRefs.current = [];
    fitScaleRef.current = null; renderedScaleRef.current = [];
    dismissSelection();
    try {
      const doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      setPdfDoc(doc);
      setPageCount(doc.numPages);
      setDocName(name);
    } catch {
      setDocError("Could not read this PDF.");
    } finally {
      setDocLoading(false);
    }
  }, [dismissSelection]);

  // ── Render a single page's canvas + invisible selectable text layer ──────
  // Skips pages already rendered at the current scale, so zooming only
  // re-rasterizes what's actually on screen instead of the whole document.
  const renderPage = useCallback(async (n) => {
    if (!pdfDoc || fitScaleRef.current == null) return;
    const canvas = pageCanvasRefs.current[n - 1];
    if (!canvas) return;
    const scale = fitScaleRef.current * zoom;
    if (renderedScaleRef.current[n - 1] === scale) return;
    const page = await pdfDoc.getPage(n);
    const c    = pageCanvasRefs.current[n - 1];
    if (!c) return;
    const viewport = page.getViewport({ scale });
    c.width  = viewport.width;
    c.height = viewport.height;
    renderedScaleRef.current[n - 1] = scale;
    await page.render({ canvasContext: c.getContext("2d"), viewport }).promise.catch(() => {});

    const layer = pageTextLayerRefs.current[n - 1];
    if (!layer) return;
    layer.innerHTML = "";
    layer.style.width  = `${viewport.width}px`;
    layer.style.height = `${viewport.height}px`;

    const content     = await page.getTextContent();
    const vt          = viewport.transform;
    const scaleFactor = Math.hypot(vt[0], vt[1]);

    for (const item of content.items) {
      if (!item.str) continue;
      const tx       = mulTransform(vt, item.transform);
      const fontSize = Math.hypot(tx[0], tx[1]);
      if (fontSize < 1) continue;
      const angle     = Math.atan2(tx[1], tx[0]);
      const itemWidth = item.width * scaleFactor;

      const span = document.createElement("span");
      span.textContent    = item.str;
      span.style.position = "absolute";
      span.style.left     = `${tx[4]}px`;
      span.style.top      = `${tx[5] - fontSize * 0.8}px`;
      span.style.height   = `${fontSize}px`;
      span.style.fontSize = `${fontSize}px`;
      span.style.whiteSpace      = "pre";
      span.style.color          = "transparent";
      span.style.transformOrigin = "0% 0%";
      if (itemWidth > 0) span.style.width = `${itemWidth}px`;
      if (Math.abs(angle) > 0.01) span.style.transform = `rotate(${angle}rad)`;
      layer.appendChild(span);
    }
  }, [pdfDoc, zoom]);

  // Compute the base fit-to-width scale once per document, then render
  // whichever pages already happen to be on screen (usually just page 1).
  useEffect(() => {
    if (!pdfDoc || pageCount === 0) return;
    let cancelled = false;
    pdfDoc.getPage(1).then(page1 => {
      if (cancelled) return;
      const containerWidth = readerRef.current?.clientWidth || 700;
      const unscaledWidth  = page1.getViewport({ scale: 1 }).width;
      fitScaleRef.current  = Math.min(1.4, Math.max(0.2, (containerWidth - 48) / unscaledWidth));
      const readerBox = readerRef.current?.getBoundingClientRect();
      pageContainerRefs.current.forEach((el, i) => {
        if (!el || !readerBox) return;
        const r = el.getBoundingClientRect();
        if (r.bottom >= readerBox.top && r.top <= readerBox.bottom) renderPage(i + 1);
      });
    });
    return () => { cancelled = true; };
  }, [pdfDoc, pageCount, renderPage]);

  // IntersectionObserver: lazily (re)render pages as they scroll into view.
  // Recreated whenever `renderPage` changes identity (i.e. on zoom change),
  // and IntersectionObserver reports current intersections immediately on
  // `.observe()`, so this also refreshes whatever's already on screen.
  useEffect(() => {
    if (!pdfDoc || !readerRef.current || pageCount === 0) return;
    const root = readerRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          renderPage(parseInt(entry.target.dataset.page, 10));
        }
      },
      { root, rootMargin: "300px 0px", threshold: 0.1 }
    );
    pageContainerRefs.current.forEach((el, i) => {
      if (el) { el.dataset.page = String(i + 1); observer.observe(el); }
    });
    return () => observer.disconnect();
  }, [pdfDoc, pageCount, renderPage]);

  // ── Pinch-to-zoom (touch) + ctrl/trackpad-pinch wheel zoom ──────────────
  useEffect(() => {
    const el = readerRef.current;
    const wrap = wrapRef.current;
    if (!el || !wrap || !pdfDoc) return;

    const touchDist = (touches) => {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.hypot(dx, dy);
    };

    let startDist = null;
    let startZoom = 1;
    let originX = 0, originY = 0;
    let lastZoom = 1;

    const onTouchStart = (e) => {
      if (e.touches.length !== 2) return;
      startDist = touchDist(e.touches);
      startZoom = zoom;
      lastZoom  = startZoom;
      const wrapRect = wrap.getBoundingClientRect();
      originX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - wrapRect.left;
      originY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - wrapRect.top;
    };

    const onTouchMove = (e) => {
      if (e.touches.length !== 2 || startDist === null) return;
      e.preventDefault();
      lastZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, startZoom * touchDist(e.touches) / startDist));
      wrap.style.transformOrigin = `${originX}px ${originY}px`;
      wrap.style.transform       = `scale(${lastZoom / startZoom})`;
    };

    const onTouchEnd = (e) => {
      if (e.touches.length >= 2 || startDist === null) return;
      startDist = null;
      wrap.style.transform       = "";
      wrap.style.transformOrigin = "";
      setZoom(lastZoom);
    };

    // Trackpad pinch gestures are delivered by the browser as wheel events with ctrlKey set.
    const onWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const delta = e.deltaY < 0 ? 1.08 : 1 / 1.08;
      setZoom(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * delta)));
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove",  onTouchMove,  { passive: false });
    el.addEventListener("touchend",   onTouchEnd,   { passive: true });
    el.addEventListener("touchcancel", onTouchEnd,  { passive: true });
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove",  onTouchMove);
      el.removeEventListener("touchend",   onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
      el.removeEventListener("wheel", onWheel);
    };
  }, [pdfDoc, zoom]);

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
      loadPdf(arrayBuffer, src?.name || "document.pdf");
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
    file.arrayBuffer().then(buf => loadPdf(buf, file.name));
  };

  // ── Text selection → floating "Linguistic Analysis" bar ─────────────────
  const handleMouseUp = () => {
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

        {/* ── Right: PDF reader ── */}
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
            {pdfDoc && <span id="ue_zoom_badge" title="Pinch (touch or ctrl+scroll) to zoom">{Math.round(zoom * 100)}%</span>}
          </div>

          {docError && (
            <div id="ue_doc_error">
              <i className="fi fi-rr-triangle-warning" /> {docError}
            </div>
          )}

          {!pdfDoc && !docLoading && !docError && (
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

          {pdfDoc && (
            <div id="ue_reader" ref={readerRef} onMouseUp={handleMouseUp}>
              <div id="ue_canvas_wrap" ref={wrapRef}>
                {Array.from({ length: pageCount }, (_, i) => i + 1).map(n => (
                  <div
                    key={n}
                    className="ue_page_container"
                    ref={el => { pageContainerRefs.current[n - 1] = el; }}
                  >
                    <canvas
                      className="ue_page_canvas"
                      ref={el => { pageCanvasRefs.current[n - 1] = el; }}
                    />
                    <div
                      className="ue_text_layer"
                      ref={el => { pageTextLayerRefs.current[n - 1] = el; }}
                    />
                  </div>
                ))}
              </div>
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
