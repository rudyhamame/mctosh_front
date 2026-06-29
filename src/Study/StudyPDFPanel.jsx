import React, { useCallback, useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { drawAnnotation } from "../PDF/annotationDraw";
import { apiUrl } from "../config/api";
import { readStoredSession } from "../utils/sessionCleanup";

// Reuse the same CDN worker that PDFPage uses — both share the pdfjs singleton
pdfjsLib.GlobalWorkerOptions.workerSrc =
  `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

const authHeader = () => {
  const token = readStoredSession()?.token || "";
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const TOOLS  = [
  { id: "pen",           icon: "fi-rr-pencil",               label: "Pen",        hasSize: true  },
  { id: "highlight",     icon: "fi-rr-highlighter",          label: "Highlight",  hasSize: true  },
  { id: "underline",     icon: "fi-rr-underline",            label: "Underline",  hasSize: false },
  { id: "strikethrough", icon: "fi-rr-strikethrough",        label: "Strikethrough", hasSize: false },
  { id: "rect",          icon: "fi-rr-rectangle-horizontal", label: "Rectangle",  hasSize: false },
  { id: "circle",        icon: "fi-rr-circle",               label: "Ellipse",    hasSize: false },
  { id: "line",          icon: "fi-rr-minus",                label: "Line",       hasSize: false },
  { id: "arrow",         icon: "fi-rr-arrow-small-right",    label: "Arrow",      hasSize: false },
  { id: "eraser",        icon: "fi-rr-eraser",               label: "Eraser",     hasSize: true  },
];
const COLORS = ["#ffff00", "#ff5252", "#69f0ae", "#40c4ff", "#ffffff"];

const StudyPDFPanel = ({ sourceId }) => {
  const [pdfDoc,      setPdfDoc]      = useState(null);
  const [pageCount,   setPageCount]   = useState(0);
  const [pageNum,     setPageNum]     = useState(1);
  const [annotations, setAnnotations] = useState({});
  const [tool,        setTool]        = useState("pen");
  const [color,       setColor]       = useState("#ffff00");
  const [penSize,     setPenSize]     = useState(2);
  const [hlSize,      setHlSize]      = useState(16);
  const [eraserSize,  setEraserSize]  = useState(18);
  const [saved,       setSaved]       = useState(true);
  const [saving,      setSaving]      = useState(false);
  const [loadingPdf,  setLoadingPdf]  = useState(false);

  const pageCanvasRefs    = useRef([]);
  const pageAnnotRefs     = useRef([]);
  const pageContainerRefs = useRef([]);
  const renderTasksRef    = useRef([]);
  const fitScaleRef       = useRef(1);
  const pageViewportsRef  = useRef([]);
  const activeAnnotRef    = useRef(null);
  const pageNumRef        = useRef(1);
  pageNumRef.current      = pageNum;
  const viewerRef         = useRef(null);
  const saveTimerRef      = useRef(null);

  // Proxy refs always pointing to the current page's canvas elements
  const canvasRef = { get current() { return pageCanvasRefs.current[pageNumRef.current - 1] ?? null; } };
  const annotRef  = { get current() { return pageAnnotRefs.current[pageNumRef.current - 1] ?? null; } };

  // ── Load PDF from source ───────────────────────────────────────────────────
  useEffect(() => {
    if (!sourceId) return;
    let cancelled = false;
    setLoadingPdf(true);
    setPdfDoc(null);
    setPageCount(0);
    setPageNum(1);
    setAnnotations({});
    setSaved(true);
    renderTasksRef.current.forEach(t => t?.cancel());
    pageCanvasRefs.current    = [];
    pageContainerRefs.current = [];
    pageAnnotRefs.current     = [];
    pageViewportsRef.current  = [];
    renderTasksRef.current    = [];

    (async () => {
      try {
        const res = await fetch(apiUrl(`/api/sources/${sourceId}/download`), { headers: authHeader() });
        if (!res.ok || cancelled) return;
        const buf = await res.arrayBuffer();
        if (cancelled) return;
        const doc = await pdfjsLib.getDocument({ data: buf }).promise;
        if (cancelled) return;
        // Set both together — the render effect needs pageCount > 0 to fire usefully,
        // but pdfDoc being non-null is what causes canvases to appear in the DOM.
        // We set pageCount first so that when pdfDoc triggers the re-render the
        // Array.from(length: pageCount) already has the right count.
        setPageCount(doc.numPages);
        setPdfDoc(doc);
      } catch (e) { console.error("StudyPDFPanel load error:", e); }
      finally { if (!cancelled) setLoadingPdf(false); }
    })();

    return () => { cancelled = true; };
  }, [sourceId]);

  // ── Load saved annotation layers ───────────────────────────────────────────
  useEffect(() => {
    if (!sourceId) return;
    fetch(apiUrl(`/api/source-annotations/${sourceId}`), { headers: authHeader() })
      .then(r => r.json())
      .then(d => { setAnnotations(d.layers || {}); setSaved(true); })
      .catch(() => {});
  }, [sourceId]);

  // ── Render all pages ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!pdfDoc || pageCount === 0) return;
    let cancelled = false;
    renderTasksRef.current.forEach(t => t?.cancel());
    renderTasksRef.current = new Array(pageCount).fill(null);

    const renderPage = async (n) => {
      if (cancelled) return;
      const canvas = pageCanvasRefs.current[n - 1];
      if (!canvas) return;
      const page = await pdfDoc.getPage(n);
      if (cancelled || !pageCanvasRefs.current[n - 1]) return;
      const scale = fitScaleRef.current;
      const vp    = page.getViewport({ scale });
      pageViewportsRef.current[n - 1] = vp;
      const c = pageCanvasRefs.current[n - 1];
      if (!c || cancelled) return;
      c.width  = vp.width;
      c.height = vp.height;
      const task = page.render({ canvasContext: c.getContext("2d"), viewport: vp });
      renderTasksRef.current[n - 1] = task;
      task.promise.catch(e => { if (e?.name !== "RenderingCancelledException") console.error(e); });
    };

    pdfDoc.getPage(1).then(p1 => {
      if (cancelled) return;
      const w = viewerRef.current?.clientWidth || 520;
      fitScaleRef.current = (w - 24) / p1.getViewport({ scale: 1 }).width;
      const cur = pageNumRef.current;
      renderPage(cur);
      for (let n = 1; n <= pageCount; n++) { if (n !== cur) renderPage(n); }
    });

    return () => { cancelled = true; renderTasksRef.current.forEach(t => t?.cancel()); };
  }, [pdfDoc, pageCount]);

  // ── Redraw annotation canvas on annotations or pageNum change ──────────────
  useEffect(() => {
    const ac = annotRef.current;
    const pc = canvasRef.current;
    if (!ac || !pc) return;
    ac.width  = pc.width;
    ac.height = pc.height;
    const ctx = ac.getContext("2d");
    ctx.clearRect(0, 0, ac.width, ac.height);
    for (const ann of (annotations[pageNum] || [])) drawAnnotation(ctx, ann, fitScaleRef.current);
  }, [annotations, pageNum]);

  // ── IntersectionObserver: track current page as user scrolls ──────────────
  useEffect(() => {
    if (!pdfDoc || !viewerRef.current || pageCount === 0) return;
    const root = viewerRef.current;
    const obs = new IntersectionObserver(
      (entries) => {
        let top = null;
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const n = parseInt(e.target.dataset.page, 10);
          if (top === null || n < top) top = n;
        }
        if (top !== null) setPageNum(top);
      },
      { root, threshold: 0.15 }
    );
    pageContainerRefs.current.forEach((el, i) => {
      if (el) { el.dataset.page = String(i + 1); obs.observe(el); }
    });
    return () => obs.disconnect();
  }, [pdfDoc, pageCount]);

  // ── Annotation drawing events on the current page's canvas ────────────────
  useEffect(() => {
    const ac = annotRef.current;
    if (!ac || !tool || tool === "eraser") return;
    const scale = () => fitScaleRef.current;
    const toP = (e) => {
      const r  = ac.getBoundingClientRect();
      const sx = ac.width  / r.width;
      const sy = ac.height / r.height;
      return { x: (e.clientX - r.left) * sx / scale(), y: (e.clientY - r.top) * sy / scale() };
    };
    const redraw = (extra) => {
      const ctx = ac.getContext("2d");
      ctx.clearRect(0, 0, ac.width, ac.height);
      for (const ann of (annotations[pageNum] || [])) drawAnnotation(ctx, ann, scale());
      if (extra) drawAnnotation(ctx, extra, scale());
    };
    const onDown = (e) => {
      const p = toP(e);
      if (tool === "pen")
        activeAnnotRef.current = { type: "pen", color, lineWidth: penSize / scale(), points: [p] };
      else if (tool === "highlight")
        activeAnnotRef.current = { type: "highlight", color, lineWidth: hlSize / scale(), mode: "freehand", points: [p] };
      else if (["rect","circle","underline","strikethrough"].includes(tool))
        activeAnnotRef.current = { type: tool, color, x: p.x, y: p.y, w: 0, h: 0, _sx: p.x, _sy: p.y };
      else if (["line","arrow"].includes(tool))
        activeAnnotRef.current = { type: tool, color, x1: p.x, y1: p.y, x2: p.x, y2: p.y };
    };
    const onMove = (e) => {
      const ann = activeAnnotRef.current;
      if (!ann) return;
      const p = toP(e);
      if (ann.type === "pen" || ann.type === "highlight") {
        ann.points.push(p);
      } else if (["rect","circle","underline","strikethrough"].includes(ann.type)) {
        ann.x = Math.min(ann._sx, p.x); ann.y = Math.min(ann._sy, p.y);
        ann.w = Math.abs(p.x - ann._sx); ann.h = Math.abs(p.y - ann._sy);
      } else if (["line","arrow"].includes(ann.type)) {
        ann.x2 = p.x; ann.y2 = p.y;
      }
      redraw(ann);
    };
    const onUp = () => {
      const ann = activeAnnotRef.current;
      if (!ann) return;
      activeAnnotRef.current = null;
      const clean = { ...ann };
      delete clean._sx; delete clean._sy;
      clean.id = Date.now();
      setAnnotations(prev => ({ ...prev, [pageNum]: [...(prev[pageNum] || []), clean] }));
      setSaved(false);
    };
    ac.addEventListener("mousedown", onDown);
    ac.addEventListener("mousemove", onMove);
    ac.addEventListener("mouseup",   onUp);
    return () => {
      ac.removeEventListener("mousedown", onDown);
      ac.removeEventListener("mousemove", onMove);
      ac.removeEventListener("mouseup",   onUp);
    };
  }, [tool, color, penSize, hlSize, pageNum, annotations]);

  // ── Eraser ────────────────────────────────────────────────────────────────
  const handleEraserClick = useCallback((e) => {
    if (tool !== "eraser") return;
    const ac = annotRef.current;
    if (!ac) return;
    const r  = ac.getBoundingClientRect();
    const sx = ac.width  / r.width;
    const sy = ac.height / r.height;
    const sc = fitScaleRef.current;
    const px = (e.clientX - r.left) * sx / sc;
    const py = (e.clientY - r.top)  * sy / sc;
    const er = eraserSize / sc;
    setAnnotations(prev => ({
      ...prev,
      [pageNum]: (prev[pageNum] || []).filter(a => {
        if (a.type === "pen" || a.type === "highlight")
          return !a.points.some(pt => Math.hypot(pt.x - px, pt.y - py) < er);
        const cx = a.x ?? a.x1 ?? 0, cy = a.y ?? a.y1 ?? 0;
        return Math.hypot(cx - px, cy - py) > er;
      }),
    }));
    setSaved(false);
  }, [tool, pageNum]);

  // ── Auto-save (debounced 1.5 s) ───────────────────────────────────────────
  useEffect(() => {
    if (saved || !sourceId) return;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      setSaving(true);
      try {
        await fetch(apiUrl(`/api/source-annotations/${sourceId}`), {
          method: "PUT",
          headers: { ...authHeader(), "Content-Type": "application/json" },
          body: JSON.stringify({ layers: annotations }),
        });
        setSaved(true);
      } catch {}
      finally { setSaving(false); }
    }, 1500);
    return () => clearTimeout(saveTimerRef.current);
  }, [annotations, saved, sourceId]);

  // ── Render ────────────────────────────────────────────────────────────────
  if (!sourceId) {
    return (
      <div className="study_pdf_empty">
        <span className="study_pdf_empty_icon">📄</span>
        <p>No source mounted</p>
        <p className="study_pdf_empty_sub">Select a PDF source from the header to begin</p>
      </div>
    );
  }

  return (
    <div className="study_pdf_wrap">
      {/* Annotation toolbar */}
      <div className="study_ann_toolbar">
        <div className="study_ann_tools">
          {TOOLS.map(t => (
            <button
              key={t.id}
              className={`study_ann_btn${tool === t.id ? " study_ann_btn--active" : ""}`}
              onClick={() => setTool(t.id)}
              title={t.label}
            ><i className={`fi ${t.icon}`} /></button>
          ))}
          <button className="study_ann_btn" title="Undo" onClick={() => {
            setAnnotations(prev => {
              const arr = [...(prev[pageNum] || [])]; arr.pop();
              return { ...prev, [pageNum]: arr };
            });
            setSaved(false);
          }}><i className="fi fi-rr-undo" /></button>
          <button className="study_ann_btn" title="Clear page" onClick={() => {
            setAnnotations(prev => ({ ...prev, [pageNum]: [] }));
            setSaved(false);
          }}><i className="fi fi-rr-trash" /></button>
        </div>
        {/* Size slider for pen / highlight / eraser */}
        {(tool === "pen" || tool === "highlight" || tool === "eraser") && (
          <div className="study_ann_size_row">
            <div
              className="study_ann_size_dot"
              style={{
                width:        tool === "pen" ? penSize * 3 : tool === "eraser" ? Math.min(eraserSize, 28) : hlSize,
                height:       tool === "pen" ? penSize * 3 : tool === "eraser" ? Math.min(eraserSize, 28) : hlSize,
                background:   tool === "eraser" ? "rgba(255,255,255,0.2)" : color,
                border:       tool === "eraser" ? "1px dashed rgba(255,255,255,0.4)" : "none",
                borderRadius: "50%",
              }}
            />
            <input
              className="study_ann_size_slider"
              type="range"
              min={tool === "pen" ? 1 : tool === "eraser" ? 6 : 4}
              max={tool === "pen" ? 20 : tool === "eraser" ? 48 : 64}
              step={tool === "pen" ? 0.5 : 2}
              value={tool === "pen" ? penSize : tool === "eraser" ? eraserSize : hlSize}
              onChange={e => {
                const v = Number(e.target.value);
                if (tool === "pen") setPenSize(v);
                else if (tool === "eraser") setEraserSize(v);
                else setHlSize(v);
              }}
            />
          </div>
        )}
        {tool !== "eraser" && (
          <div className="study_ann_colors">
            {COLORS.map(c => (
              <button
                key={c}
                className={`study_ann_color${color === c ? " study_ann_color--active" : ""}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        )}
        <span className="study_save_status">{saving ? "Saving…" : saved ? "Saved ✓" : "Unsaved"}</span>
        {pageCount > 0 && <span className="study_page_counter">{pageNum} / {pageCount}</span>}
      </div>

      {/* PDF viewer — always rendered so viewerRef and canvas refs are set before
          the render effect fires. Loading message sits inline inside the viewer. */}
      <div className="study_pdf_viewer" ref={viewerRef}>
        {loadingPdf && (
          <div className="study_pdf_loading_inline">Loading PDF…</div>
        )}
        {pdfDoc && Array.from({ length: pageCount }, (_, i) => i + 1).map(n => (
          <div
            key={n}
            className="study_page_container"
            ref={el => { pageContainerRefs.current[n - 1] = el; }}
            data-page={n}
          >
            <canvas
              className="study_page_canvas"
              ref={el => { pageCanvasRefs.current[n - 1] = el; }}
            />
            {pageNum === n && (
              <canvas
                ref={el => { pageAnnotRefs.current[n - 1] = el; }}
                className="study_annot_canvas"
                style={{ cursor: tool === "eraser" ? "cell" : "crosshair" }}
                onClick={handleEraserClick}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default StudyPDFPanel;
