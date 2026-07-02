import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import AIProviderSelect from "../App/AIProviderSelect";
import { useAIProvider } from "../hooks/useAIProvider";
import * as pdfjsLib from "pdfjs-dist";
import "./pdfPage.css";
import { apiUrl } from "../config/api";
import { readStoredSession } from "../utils/sessionCleanup";
import HyleCards from "./HyleCards";
import SystemMessageModal from "./SystemMessageModal";
import { drawAnnotation } from "./annotationDraw";
import { LINGUISTIC_UNITS, unitById } from "../Linguistics/linguisticUnits";

pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

const PDF_TYPE_LABEL = {
  "text-based": "✅ Text-based",
  "mixed":      "⚠️ Mixed",
  "scanned":    "🔴 Scanned",
};

const CARDS = [
  { key: "objects",   label: "Objects" },
  { key: "traces",    label: "Traces" },
  { key: "phenomena", label: "Phenomena" },
  { key: "concept",   label: "Concept" },
  { key: "models",    label: "Models" },
];

const HYLE_TYPE_TREE = [
  {
    key: "morpheme", label: "Morpheme",
    children: [
      {
        key: "morpheme.base", label: "Base",
        children: [
          { key: "morpheme.base.free",  label: "Free",  note: "simple word" },
          { key: "morpheme.base.bound", label: "Bound" },
        ],
      },
      {
        key: "morpheme.affix", label: "Affix",
        children: [
          { key: "morpheme.affix.prefix",      label: "Prefix" },
          { key: "morpheme.affix.connecting",  label: "Connecting vowel" },
          { key: "morpheme.affix.suffix",      label: "Suffix" },
        ],
      },
    ],
  },
  {
    key: "word", label: "Word",
    children: [
      { key: "word.compound", label: "Compound", note: "one or more morphemes" },
    ],
  },
  { key: "syntagm",  label: "Syntagm" },
  { key: "paradigm", label: "Paradigm" },
];

// Flat label lookup for selected type display
const HYLE_TYPE_LABELS = {
  "morpheme.base.free":       "Free base",
  "morpheme.base.bound":      "Bound base",
  "morpheme.affix.prefix":    "Prefix",
  "morpheme.affix.connecting":"Connecting vowel",
  "morpheme.affix.suffix":    "Suffix",
  "word.compound":            "Compound",
  "syntagm":                  "Syntagm",
  "paradigm":                 "Paradigm",
};

const ANNOT_TOOLS = [
  { key: "highlight",     icon: "fi-rr-highlighter",          label: "Highlight",     hasSize: true  },
  { key: "underline",     icon: "fi-rr-underline",            label: "Underline",     hasSize: false },
  { key: "strikethrough", icon: "fi-rr-strikethrough",        label: "Strikethrough", hasSize: false },
  { key: "pen",           icon: "fi-rr-pencil",               label: "Pen",           hasSize: true  },
  { key: "line",          icon: "fi-rr-minus",                label: "Line",          hasSize: false },
  { key: "arrow",         icon: "fi-rr-arrow-small-right",    label: "Arrow",         hasSize: false },
  { key: "rect",          icon: "fi-rr-rectangle-horizontal", label: "Rectangle",     hasSize: false },
  { key: "circle",        icon: "fi-rr-circle",               label: "Ellipse",       hasSize: false },
  { key: "text",          icon: "fi-rr-text",                 label: "Text",          hasSize: false },
  { key: "eraser",        icon: "fi-rr-eraser",               label: "Eraser",        hasSize: true  },
];

const ANNOT_COLORS = ["#ffff00","#ff6b6b","#51cf66","#74c0fc","#f783ac","#ffa94d","#e9ecef","#212529"];

// Draw a single annotation onto a 2d canvas context.
// Coordinates are stored in PDF-point space; scale = fitScale * zoom converts to canvas pixels.

const ALL_MODES = ["sub-molecule","molecule","sub-cell","cell","sub-tissue","tissue","sub-organ","organ","sub-system","system","sub-human","human"];
const modeObj   = () => Object.fromEntries(ALL_MODES.map((m) => [m, []]));

const EMPTY_HYLES = () => ({
  objects:   modeObj(),
  traces:    modeObj(),
  phenomena: modeObj(),
  concept:   modeObj(),
  models:    modeObj(),
  _total: 0,
});

const authFetch = (url, options = {}) => {
  const token = readStoredSession()?.token || "";
  return fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` },
  });
};

const initStatus   = () => ({ value: "pending", at: new Date().toISOString() });
const currentStatus = (item) => item.status?.value || "pending";

const inflateExtraction = (extraction) => {
  const data = EMPTY_HYLES();
  for (const { id, num, noun, card, mode, reason, status } of extraction.nouns || []) {
    if (data[card]?.[mode]) {
      data[card][mode].push({ id, num, noun, reason: reason || "", status: status?.value ? status : initStatus() });
    }
  }
  data._total = extraction.totalNouns || 0;
  return data;
};

const deflateNounData = (hyleData) => {
  const nouns = [];
  for (const card of ["objects", "traces", "phenomena", "concept", "models"]) {
    for (const mode of ALL_MODES) {
      for (const item of hyleData[card]?.[mode] || []) {
        nouns.push({ id: item.id, num: item.num, noun: item.noun, card, mode, reason: item.reason, status: item.status });
      }
    }
  }
  return nouns;
};

const PDFPage = () => {
  const [pdfDoc, setPdfDoc]         = useState(null);
  const [filename, setFilename]     = useState("");
  const [pageNum, setPageNum]       = useState(1);
  const [pageCount, setPageCount]   = useState(0);
  const [pdfType, setPdfType]       = useState(null);
  const [loading, setLoading]       = useState(false);
  const [dragOver, setDragOver]     = useState(false);
  const [pageViewport, setPageViewport] = useState(null);
  const [zoom, setZoom]               = useState(1);
  const [splitRatio,     setSplitRatio]    = useState(1);
  const [extractionOpen, setExtractionOpen] = useState(false);
  const savedRatioRef                 = useRef(0.42);
  const contentRef                    = useRef(null);
  const fitScaleRef                 = useRef(1);
  const zoomRef                     = useRef(1);
  const extractModeRef              = useRef("ai");

  const [hyleData, setHyleData]       = useState(null);
  const [hyleFontSize, setHyleFontSize] = useState(1);
  const [hylePage, setHylePage]       = useState(null);
  const [extracting, setExtracting]   = useState(false);
  const [extractError, setExtractError] = useState("");
  const { provider, setProvider }     = useAIProvider();
  const [showSysModal, setShowSysModal] = useState(false);

  // AI vs Manual toggle
  const extractMode = provider === "manual" ? "manual" : "ai";
  const [extractionType, setExtractionType] = useState(null); // selected hyle type key
  const [typeTreeOpen,   setTypeTreeOpen]   = useState(false);

  // Manual selection popup
  const [manualPopup,     setManualPopup]     = useState(null); // { x, y }
  const [manualHyle,      setManualHyle]      = useState("");
  const [manualCard,      setManualCard]      = useState(() => {
    const p = window.location.pathname.split("/").pop();
    return CARDS.find((c) => c.key === p)?.key || "objects";
  });
  const [manualMode,      setManualMode]      = useState("organ");
  // Selection bar (shown before popup — lets user expand range word-by-word)
  const [manualSelection, setManualSelection] = useState(null); // { startIdx, endIdx, text, x, y }
  const [dragHandle,      setDragHandle]      = useState(null); // "start" | "end"

  const [history, setHistory]               = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [saving, setSaving]                 = useState(false);
  const [savedId, setSavedId]               = useState(null);
  const [activeHistoryId, setActiveHistoryId] = useState(null);

  // ── Annotation state ──────────────────────────────────────────────────────
  const [annotTool,      setAnnotTool]      = useState(null);
  const [annotColor,     setAnnotColor]     = useState("#ffff00");
  const [annotSize,      setAnnotSize]      = useState(16);  // highlight lineWidth
  const [penSize,        setPenSize]        = useState(2);   // pen lineWidth
  const [eraserSize,     setEraserSize]     = useState(18);  // eraser radius
  const [highlightMode,  setHighlightMode]  = useState("freehand"); // "freehand" | "line"
  const [linguisticUnit, setLinguisticUnit] = useState(null); // id from LINGUISTIC_UNITS | null
  const [annotations, setAnnotations] = useState({});   // { [pageNum]: [...] }
  const [annotTextInput, setAnnotTextInput] = useState(null); // { vx, vy, cx, cy }
  const [annotTextVal,   setAnnotTextVal]   = useState("");
  const annotCanvasRef  = useRef(null);
  const activeAnnotRef  = useRef(null);  // in-progress shape

  // Per-page refs for continuous scroll
  const pageCanvasRefs    = useRef([]);
  const pageContainerRefs = useRef([]);
  const renderTasksRef    = useRef([]);
  const pageViewportsRef  = useRef([]);
  const pageNumRef        = useRef(1);
  pageNumRef.current      = pageNum;  // sync during render

  // Proxy ref: always points to current page's PDF canvas
  const canvasRef = { get current() { return pageCanvasRefs.current[pageNumRef.current - 1] ?? null; } };

  const textLayerRef  = useRef(null);
  const previewRef    = useRef(null);
  const canvasWrapRef = useRef(null);
  const fileInputRef  = useRef(null);
  const popupRef      = useRef(null);
  const selBarRef          = useRef(null);
  const spansRef           = useRef([]); // [{text, el}] built when text layer renders
  const scrollAfterZoomRef = useRef(null); // {left, top} to apply after zoom re-render
  const mouseDownPosRef    = useRef(null); // {x,y} at last mousedown — used to detect drag vs click

  // ── Sources list (for /hyles drop-zone replacement) ─────────────────────
  const [hyleSources,        setHyleSources]        = useState([]);
  const [hyleSourcesLoading, setHyleSourcesLoading] = useState(false);

  useEffect(() => {
    if (!isNounsPage) return;
    setHyleSourcesLoading(true);
    authFetch(apiUrl("/api/sources/"))
      .then((r) => r.json())
      .then((d) => setHyleSources((d.sources || []).filter((s) => s.type === "pdf" || s.type === "word")))
      .catch(() => {})
      .finally(() => setHyleSourcesLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load from Sources page ────────────────────────────────────────────────
  useEffect(() => {
    const { sourceId, pdfName } = location.state || {};
    if (sourceId) loadFromSource(sourceId, pdfName || "document.pdf");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fetch history on mount ─────────────────────────────────────────────────
  useEffect(() => {
    setHistoryLoading(true);
    authFetch(apiUrl("/api/pdf/history"))
      .then((r) => r.json())
      .then((d) => {
        const extractions = d.extractions || [];
        setHistory(extractions);
        if (extractions.length > 0) {
          const first = extractions[0];
          authFetch(apiUrl(`/api/pdf/history/${first._id}`))
            .then((r) => r.json())
            .then((data) => {
              setHyleData(inflateExtraction(data.extraction));
              setActiveHistoryId(first._id);
              setSavedId(first._id);
            })
            .catch(() => {});
        }
      })
      .catch(() => {})
      .finally(() => setHistoryLoading(false));
  }, []);

  // ── Render PDF page on canvas ──────────────────────────────────────────────
  // Render ALL pages whenever pdfDoc or zoom changes (continuous scroll)
  useEffect(() => {
    if (!pdfDoc || pageCount === 0) return;
    let cancelled = false;
    renderTasksRef.current.forEach(t => t?.cancel());
    renderTasksRef.current = new Array(pageCount).fill(null);

    const renderOnePage = async (n) => {
      if (cancelled) return;
      const canvas = pageCanvasRefs.current[n - 1];
      if (!canvas) return;
      const page = await pdfDoc.getPage(n);
      if (cancelled || !pageCanvasRefs.current[n - 1]) return;
      const scale    = fitScaleRef.current * zoom;
      const viewport = page.getViewport({ scale });
      pageViewportsRef.current[n - 1] = viewport;
      const c = pageCanvasRefs.current[n - 1];
      if (!c || cancelled) return;
      c.width  = viewport.width;
      c.height = viewport.height;
      const task = page.render({ canvasContext: c.getContext("2d"), viewport });
      renderTasksRef.current[n - 1] = task;
      task.promise.catch(err => { if (err?.name !== "RenderingCancelledException") console.error(err); });
      if (n === pageNumRef.current && !cancelled) setPageViewport(viewport);
    };

    // Compute fitScale from page 1 first, then render all pages
    pdfDoc.getPage(1).then(page1 => {
      if (cancelled) return;
      const previewWidth = previewRef.current?.clientWidth || 480;
      fitScaleRef.current = (previewWidth - 24) / page1.getViewport({ scale: 1 }).width;
      const cur = pageNumRef.current;
      renderOnePage(cur);
      for (let n = 1; n <= pageCount; n++) { if (n !== cur) renderOnePage(n); }
    });

    return () => { cancelled = true; renderTasksRef.current.forEach(t => t?.cancel()); };
  }, [pdfDoc, zoom, pageCount]);

  // Sync pageViewport when pageNum changes via scroll
  useEffect(() => {
    const vp = pageViewportsRef.current[pageNum - 1];
    if (vp) setPageViewport(vp);
  }, [pageNum]);

  // Keep refs in sync so event handlers always read the latest values
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);

  // Apply zoom-to-point scroll correction after canvas re-renders at new zoom.
  // Also strips any CSS pinch-transform that was held until this point.
  useEffect(() => {
    const pending = scrollAfterZoomRef.current;
    if (!pending || !previewRef.current) return;
    scrollAfterZoomRef.current = null;
    const el   = previewRef.current;
    const wrap = canvasWrapRef.current;
    requestAnimationFrame(() => {
      // Remove the CSS transform and set the real scroll in the same frame
      // so the canvas never flashes back to the pre-zoom position.
      if (wrap && wrap.style.transform) {
        wrap.style.transform       = "";
        wrap.style.transformOrigin = "";
      }
      el.scrollLeft = Math.max(0, pending.left);
      el.scrollTop  = Math.max(0, pending.top);
    });
  }, [zoom]);
  // IntersectionObserver: update pageNum as user scrolls through pages
  useEffect(() => {
    if (!pdfDoc || !previewRef.current || pageCount === 0) return;
    const root = previewRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        let topmost = null;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const n = parseInt(entry.target.dataset.page, 10);
          if (topmost === null || n < topmost) topmost = n;
        }
        if (topmost !== null) setPageNum(topmost);
      },
      { root, threshold: 0.15 }
    );
    pageContainerRefs.current.forEach((el, i) => {
      if (el) { el.dataset.page = String(i + 1); observer.observe(el); }
    });
    return () => observer.disconnect();
  }, [pdfDoc, pageCount]);

  useEffect(() => { extractModeRef.current = extractMode; }, [extractMode]);
  useEffect(() => { if (extractMode !== "manual") { setManualPopup(null); setManualSelection(null); } }, [extractMode]);

  const manualSelectionRef = useRef(null);
  const dragHandleRef      = useRef(null); // sync mirror of dragHandle state
  useEffect(() => { manualSelectionRef.current = manualSelection; }, [manualSelection]);

  // ── Render annotation canvas ───────────────────────────────────────────────
  useEffect(() => {
    const ac = annotCanvasRef.current;
    const pc = canvasRef.current;
    if (!ac || !pc) return;
    ac.width  = pc.width;
    ac.height = pc.height;
    const scale = fitScaleRef.current * zoom;
    const ctx = ac.getContext("2d");
    ctx.clearRect(0, 0, ac.width, ac.height);
    for (const ann of (annotations[pageNum] || [])) drawAnnotation(ctx, ann, scale);
  }, [annotations, pageNum, zoom]);

  // ── Annotation drawing events ──────────────────────────────────────────────
  useEffect(() => {
    const ac = annotCanvasRef.current;
    if (!ac || !annotTool) return;

    // Returns coordinates in PDF-point space (canvas pixels ÷ scale)
    const getScale = () => fitScaleRef.current * zoomRef.current;
    const toCanvas = (e) => {
      const rect  = ac.getBoundingClientRect();
      const scale = getScale();
      const sx    = ac.width  / rect.width;
      const sy    = ac.height / rect.height;
      const cx    = e.touches ? e.touches[0].clientX : e.clientX;
      const cy    = e.touches ? e.touches[0].clientY : e.clientY;
      return { x: (cx - rect.left) * sx / scale, y: (cy - rect.top) * sy / scale, vx: cx, vy: cy };
    };

    const redraw = (extra) => {
      const scale = getScale();
      const ctx = ac.getContext("2d");
      ctx.clearRect(0, 0, ac.width, ac.height);
      for (const ann of (annotations[pageNum] || [])) drawAnnotation(ctx, ann, scale);
      if (extra) drawAnnotation(ctx, extra, scale);
    };

    // When a linguistic unit is active it overrides the stroke color
    const lingMeta = linguisticUnit ? unitById(linguisticUnit) : null;
    const activeColor = lingMeta ? lingMeta.color : annotColor;
    const unitField   = linguisticUnit ? { unit: linguisticUnit } : {};

    const onDown = (e) => {
      if (e.touches && e.touches.length >= 2) {
        activeAnnotRef.current = null; // cancel any in-progress stroke
        return;
      }
      if (annotTool === "text") {
        const p = toCanvas(e);
        setAnnotTextInput({ vx: p.vx, vy: p.vy, cx: p.x, cy: p.y });
        setAnnotTextVal("");
        return;
      }
      const p = toCanvas(e);
      if (annotTool === "highlight") {
        activeAnnotRef.current = { type: "highlight", color: activeColor, lineWidth: annotSize / getScale(), mode: highlightMode, points: [{ x: p.x, y: p.y }], ...unitField };
      } else if (["underline","strikethrough","rect","circle"].includes(annotTool)) {
        activeAnnotRef.current = { type: annotTool, color: activeColor, x: p.x, y: p.y, w: 0, h: 0, _sx: p.x, _sy: p.y, ...unitField };
      } else if (["line","arrow"].includes(annotTool)) {
        activeAnnotRef.current = { type: annotTool, color: activeColor, x1: p.x, y1: p.y, x2: p.x, y2: p.y, ...unitField };
      } else if (annotTool === "pen") {
        activeAnnotRef.current = { type: "pen", color: activeColor, lineWidth: penSize / getScale(), points: [{ x: p.x, y: p.y }], ...unitField };
      } else if (annotTool === "eraser") {
        activeAnnotRef.current = { type: "eraser" };
        const er = eraserSize / getScale();
        setAnnotations((prev) => {
          const pts = [...(prev[pageNum] || [])];
          return { ...prev, [pageNum]: pts.filter((a) => {
            if (a.type === "pen" || a.type === "highlight") return !a.points.some((pt) => Math.hypot(pt.x - p.x, pt.y - p.y) < er);
            const cx2 = (a.x ?? a.x1 ?? 0), cy2 = (a.y ?? a.y1 ?? 0);
            return Math.hypot(cx2 - p.x, cy2 - p.y) > er;
          })};
        });
      }
    };

    const onMove = (e) => {
      if (e.touches && e.touches.length >= 2) {
        activeAnnotRef.current = null;
        return;
      }
      const ann = activeAnnotRef.current;
      if (!ann) return;
      const p = toCanvas(e);
      if (ann.type === "pen" || ann.type === "highlight") {
        if (ann.mode === "line") {
          ann.points[1] = { x: p.x, y: p.y };
        } else {
          ann.points.push({ x: p.x, y: p.y });
        }
        redraw(ann);
      } else if (["underline","strikethrough","rect","circle"].includes(ann.type)) {
        ann.x = Math.min(ann._sx, p.x); ann.y = Math.min(ann._sy, p.y);
        ann.w = Math.abs(p.x - ann._sx); ann.h = Math.abs(p.y - ann._sy);
        redraw(ann);
      } else if (["line","arrow"].includes(ann.type)) {
        ann.x2 = p.x; ann.y2 = p.y;
        redraw(ann);
      } else if (ann.type === "eraser") {
        const er = eraserSize / getScale();
        setAnnotations((prev) => {
          const pts = [...(prev[pageNum] || [])];
          return { ...prev, [pageNum]: pts.filter((a) => {
            if (a.type === "pen" || a.type === "highlight") return !a.points.some((pt) => Math.hypot(pt.x - p.x, pt.y - p.y) < er);
            const cx2 = (a.x ?? a.x1 ?? 0), cy2 = (a.y ?? a.y1 ?? 0);
            return Math.hypot(cx2 - p.x, cy2 - p.y) > er;
          })};
        });
      }
    };

    const onUp = () => {
      const ann = activeAnnotRef.current;
      activeAnnotRef.current = null;
      if (!ann || ann.type === "eraser") return;
      // ignore accidental tiny marks
      const tiny = ann.type === "pen"
        ? ann.points.length < 3
        : ["line","arrow"].includes(ann.type)
          ? Math.hypot(ann.x2 - ann.x1, ann.y2 - ann.y1) < 3
          : ann.w < 3 && ann.h < 3;
      if (tiny) return;
      const { _sx, _sy, ...clean } = ann;
      setAnnotations((prev) => ({ ...prev, [pageNum]: [...(prev[pageNum] || []), { ...clean, id: Date.now() }] }));
    };

    ac.addEventListener("mousedown",  onDown, { passive: true });
    ac.addEventListener("mousemove",  onMove, { passive: true });
    ac.addEventListener("mouseup",    onUp);
    ac.addEventListener("touchstart", onDown, { passive: true });
    ac.addEventListener("touchmove",  onMove, { passive: true });
    ac.addEventListener("touchend",   onUp);
    return () => {
      ac.removeEventListener("mousedown",  onDown);
      ac.removeEventListener("mousemove",  onMove);
      ac.removeEventListener("mouseup",    onUp);
      ac.removeEventListener("touchstart", onDown);
      ac.removeEventListener("touchmove",  onMove);
      ac.removeEventListener("touchend",   onUp);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotTool, annotColor, annotSize, penSize, eraserSize, highlightMode, linguisticUnit, pageNum, annotations]);

  const commitAnnotText = useCallback(() => {
    if (!annotTextInput || !annotTextVal.trim()) { setAnnotTextInput(null); return; }
    const scale = fitScaleRef.current * zoomRef.current;
    setAnnotations((prev) => ({
      ...prev,
      [pageNum]: [...(prev[pageNum] || []), {
        id: Date.now(), type: "text", color: annotColor,
        x: annotTextInput.cx / scale, y: annotTextInput.cy / scale,
        text: annotTextVal, fontSize: 16 / scale,
      }],
    }));
    setAnnotTextInput(null); setAnnotTextVal("");
  }, [annotTextInput, annotTextVal, annotColor, pageNum]);

  const handleAnnotUndo = useCallback(() => {
    setAnnotations((prev) => {
      const arr = [...(prev[pageNum] || [])];
      arr.pop();
      return { ...prev, [pageNum]: arr };
    });
  }, [pageNum]);

  const handleAnnotClear = useCallback(() => {
    setAnnotations((prev) => ({ ...prev, [pageNum]: [] }));
  }, [pageNum]);

  // ── Ctrl+Scroll to zoom ────────────────────────────────────────────────────
  useEffect(() => {
    const el = previewRef.current;
    if (!el || !pdfDoc) return;
    const onWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect    = el.getBoundingClientRect();
      const midX    = e.clientX - rect.left;
      const midY    = e.clientY - rect.top;
      const delta   = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const oldZoom = zoomRef.current;
      const newZoom = Math.max(1, Math.min(5, oldZoom * delta));
      const scale   = newZoom / oldZoom;
      scrollAfterZoomRef.current = {
        left: (el.scrollLeft + midX) * scale - midX,
        top:  (el.scrollTop  + midY) * scale - midY,
      };
      setZoom(newZoom);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [pdfDoc]);

  // ── Two-finger pinch zoom + single-finger pan + tap word selection ─────────
  useEffect(() => {
    const el = previewRef.current;
    if (!el || !pdfDoc) return;

    const MOVE_THRESHOLD = 8; // px — below this, treat as tap not pan

    // Pinch state
    let startDist = null;
    let startZoom = 1;
    let startMidX = 0, startMidY = 0, startSL = 0, startST = 0;

    // Single-finger state
    let panX = 0, panY = 0, panSL = 0, panST = 0;
    let hasMoved = false;

    // Long-press + drag selection state
    let lpTimer = null;
    let isLpSelecting = false;
    let lpStartSpanIdx = -1;

    const touchDist = (t) => {
      const dx = t[0].clientX - t[1].clientX;
      const dy = t[0].clientY - t[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };

    // Use elementFromPoint — the browser's own hit-test — to find which span the
    // finger is over, then expand from the tapped character to word boundaries.
    const selectWordAt = (cx, cy) => {
      const target = document.elementFromPoint(cx, cy);
      const layer  = textLayerRef.current;
      if (!target || !layer || !layer.contains(target)) return null;

      const textNode = target.firstChild;
      if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return null;
      const text = textNode.textContent;
      if (!text.trim()) return null;

      const spanIdx = parseInt(target.dataset.spanIdx ?? "-1", 10);
      if (spanIdx < 0) return null;

      const r     = target.getBoundingClientRect();
      const ratio = r.width > 0 ? (cx - r.left) / r.width : 0;
      let s = Math.round(ratio * text.length);
      let e = s;
      while (s > 0          && /\S/.test(text[s - 1])) s--;
      while (e < text.length && /\S/.test(text[e]))     e++;
      if (s === e) return null;

      // pdfjs sometimes splits one word across adjacent spans with no whitespace.
      // Expand left/right across spans that share the same word boundary.
      const spans = spansRef.current;
      let loIdx = spanIdx, hiIdx = spanIdx;
      if (s === 0) {
        while (loIdx > 0 && !/\s$/.test(spans[loIdx - 1]?.el.textContent || " ")) loIdx--;
      }
      if (e === text.length) {
        while (hiIdx < spans.length - 1 && !/^\s/.test(spans[hiIdx + 1]?.el.textContent || " ")) hiIdx++;
      }

      const parts = [
        ...spans.slice(loIdx, spanIdx).map((sp) => sp.el.textContent),
        text.substring(s, e),
        ...spans.slice(spanIdx + 1, hiIdx + 1).map((sp) => sp.el.textContent),
      ];
      const word = parts.join("").trim();
      if (!word) return null;
      window.getSelection()?.removeAllRanges();

      const bx = parseFloat(target.style.left  || "0") + (parseFloat(target.style.width  || "0") || target.offsetWidth  || 0) / 2;
      const by = parseFloat(target.style.top   || "0") +  parseFloat(target.style.height || "0") + 8;
      return { text: word, spanIdx: loIdx, endIdx: hiIdx, x: bx, y: by };
    };

    // Extra pinch state
    let pinchOriginX = 0, pinchOriginY = 0; // transform-origin in canvas-wrap space
    let lastPinchZoom = 1;                   // final zoom reached during gesture

    const onTouchStart = (e) => {
      // Handles are managed by their own React onTouchStart — don't start a pan
      if (e.target.closest?.(".sel_handle")) return;

      if (e.touches.length === 2) {
        clearTimeout(lpTimer); lpTimer = null; isLpSelecting = false;
        startDist = touchDist(e.touches);
        startZoom = zoomRef.current;
        lastPinchZoom = startZoom;
        const elRect   = el.getBoundingClientRect();
        const wrapRect = canvasWrapRef.current?.getBoundingClientRect() || elRect;
        startMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - elRect.left;
        startMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - elRect.top;
        startSL   = el.scrollLeft;
        startST   = el.scrollTop;
        // transform-origin: midpoint relative to the canvas wrap element
        pinchOriginX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - wrapRect.left;
        pinchOriginY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - wrapRect.top;
      } else if (e.touches.length === 1) {
        panX = e.touches[0].clientX;
        panY = e.touches[0].clientY;
        panSL = el.scrollLeft;
        panST = el.scrollTop;
        hasMoved = false;
        isLpSelecting = false;

        if (extractModeRef.current === "manual") {
          const ct = e.touches[0];
          lpTimer = setTimeout(() => {
            lpTimer = null;
            const target = document.elementFromPoint(ct.clientX, ct.clientY);
            const layer  = textLayerRef.current;
            if (!target || !layer || !layer.contains(target)) return;
            const spanIdx = parseInt(target.dataset.spanIdx ?? "-1", 10);
            if (spanIdx < 0) return;

            // If this span is inside the existing selection, grab the nearest handle
            const curSel = manualSelectionRef.current;
            if (curSel) {
              const lo  = Math.min(curSel.startIdx, curSel.endIdx);
              const hi  = Math.max(curSel.startIdx, curSel.endIdx);
              if (spanIdx >= lo && spanIdx <= hi) {
                navigator.vibrate?.(30);
                setDragHandle(spanIdx <= (lo + hi) / 2 ? "start" : "end");
                return;
              }
            }

            // Normal long-press: start a new selection from this word, expanding
            // across adjacent spans that pdfjs may have split the word into.
            const lpSpans = spansRef.current;
            let loIdx = spanIdx, hiIdx = spanIdx;
            while (loIdx > 0 && !/\s$/.test(lpSpans[loIdx - 1]?.el.textContent || " ")) loIdx--;
            while (hiIdx < lpSpans.length - 1 && !/^\s/.test(lpSpans[hiIdx + 1]?.el.textContent || " ")) hiIdx++;
            const fromNode = lpSpans[loIdx]?.el.firstChild;
            const toNode   = lpSpans[hiIdx]?.el.firstChild;
            if (fromNode && fromNode.nodeType === Node.TEXT_NODE &&
                toNode   && toNode.nodeType   === Node.TEXT_NODE) {
              const range = document.createRange();
              range.setStart(fromNode, 0);
              range.setEnd(toNode, toNode.textContent.length);
              const sel = window.getSelection();
              sel.removeAllRanges();
              sel.addRange(range);
            }
            lpStartSpanIdx = loIdx;
            isLpSelecting  = true;
            navigator.vibrate?.(30);
          }, 400);
        }
      }
    };

    const onTouchMove = (e) => {
      if (e.touches.length === 2 && startDist !== null) {
        clearTimeout(lpTimer); lpTimer = null; isLpSelecting = false;
        e.preventDefault();
        const newZoom = Math.max(1, Math.min(5, startZoom * touchDist(e.touches) / startDist));
        lastPinchZoom = newZoom;
        const factor = newZoom / startZoom;
        // CSS transform: instant visual scale centered on the pinch midpoint, no React re-render
        const wrap = canvasWrapRef.current;
        if (wrap) {
          wrap.style.transformOrigin = `${pinchOriginX}px ${pinchOriginY}px`;
          wrap.style.transform       = `scale(${factor})`;
        }
        return;
      }
      if (e.touches.length !== 1) return;

      // Drag handle — handled inline so it works on the very first touchmove
      if (dragHandleRef.current) {
        e.preventDefault();
        const ct     = e.touches[0];
        const target = document.elementFromPoint(ct.clientX, ct.clientY);
        const layer  = textLayerRef.current;
        if (!target || !layer || !layer.contains(target)) return;
        const idx = parseInt(target.dataset.spanIdx ?? "-1", 10);
        if (idx < 0) return;
        const which = dragHandleRef.current;
        setManualSelection((sel) => {
          if (!sel) return sel;
          if (which === "start") {
            const newStart = Math.min(idx, sel.endIdx);
            return { ...sel, startIdx: newStart, text: spansRef.current.slice(newStart, sel.endIdx + 1).map((s) => s.text).join(" ").trim() };
          } else {
            const newEnd = Math.max(idx, sel.startIdx);
            return { ...sel, endIdx: newEnd, text: spansRef.current.slice(sel.startIdx, newEnd + 1).map((s) => s.text).join(" ").trim() };
          }
        });
        return;
      }

      // After long-press fires, dragging extends the text selection
      if (isLpSelecting) {
        e.preventDefault();
        const ct  = e.touches[0];
        const target = document.elementFromPoint(ct.clientX, ct.clientY);
        const layer  = textLayerRef.current;
        if (target && layer && layer.contains(target)) {
          const spanIdx = parseInt(target.dataset.spanIdx ?? "-1", 10);
          if (spanIdx >= 0 && lpStartSpanIdx >= 0) {
            const fromIdx = Math.min(lpStartSpanIdx, spanIdx);
            const toIdx   = Math.max(lpStartSpanIdx, spanIdx);
            const fromEl  = spansRef.current[fromIdx]?.el;
            const toEl    = spansRef.current[toIdx]?.el;
            if (fromEl?.firstChild && toEl?.firstChild) {
              const range = document.createRange();
              range.setStart(fromEl.firstChild, 0);
              range.setEnd(toEl.firstChild, toEl.firstChild.textContent.length);
              const sel = window.getSelection();
              sel.removeAllRanges();
              sel.addRange(range);
            }
          }
        }
        return;
      }

      const dx = e.touches[0].clientX - panX;
      const dy = e.touches[0].clientY - panY;
      const moved = Math.sqrt(dx * dx + dy * dy);

      if (!hasMoved && moved < MOVE_THRESHOLD) return;

      clearTimeout(lpTimer); lpTimer = null;
      hasMoved = true;
      e.preventDefault();
      el.scrollLeft = panSL - dx;
      el.scrollTop  = panST - dy;
    };

    const onTouchEnd = (e) => {
      if (dragHandleRef.current) {
        dragHandleRef.current = null;
        setDragHandle(null);
        return;
      }

      if (e.touches.length < 2 && startDist !== null) {
        startDist = null;
        const wrap = canvasWrapRef.current;
        if (wrap && wrap.style.transform) {
          // Keep the CSS transform alive — useEffect([zoom]) will strip it atomically
          // with the scroll correction after the canvas re-renders, preventing any snap.
          const finalZoom = lastPinchZoom;
          const ratio     = finalZoom / startZoom;
          scrollAfterZoomRef.current = {
            left: (startSL + startMidX) * ratio - startMidX,
            top:  (startST + startMidY) * ratio - startMidY,
          };
          setZoom(finalZoom);
        }
      }
      clearTimeout(lpTimer); lpTimer = null;

      if (isLpSelecting) {
        isLpSelecting = false;
        const sel  = window.getSelection();
        const text = sel?.toString().replace(/\s+/g, " ").trim();
        if (text) {
          const vr = sel.getRangeAt(0).getBoundingClientRect();
          const noun = text.toLowerCase().replace(/[.,;:]+$/, "").replace(/\s+/g, " ").trim();
          setManualHyle(noun);
          setManualPopup({
            x: vr.left + vr.width  / 2,
            y: vr.bottom + 10,
          });
        }
        sel?.removeAllRanges();
        return;
      }

      if (extractModeRef.current === "manual" && !hasMoved && e.changedTouches.length === 1) {
        const ct     = e.changedTouches[0];
        const result = selectWordAt(ct.clientX, ct.clientY);
        if (result) {
          // Tapping inside an existing selection: keep it, don't replace
          const curSel = manualSelectionRef.current;
          if (curSel) {
            const lo = Math.min(curSel.startIdx, curSel.endIdx);
            const hi = Math.max(curSel.startIdx, curSel.endIdx);
            if (result.spanIdx >= lo && result.spanIdx <= hi) return;
          }
          setManualSelection({ startIdx: result.spanIdx, endIdx: result.endIdx, text: result.text, x: result.x, y: result.y });
        }
      }
    };

    const onContextMenu = (e) => e.preventDefault();

    el.addEventListener("touchstart",  onTouchStart,  { passive: true });
    el.addEventListener("touchmove",   onTouchMove,   { passive: false });
    el.addEventListener("touchend",    onTouchEnd,    { passive: true });
    el.addEventListener("touchcancel", onTouchEnd,    { passive: true });
    el.addEventListener("contextmenu", onContextMenu);

    return () => {
      el.removeEventListener("touchstart",  onTouchStart);
      el.removeEventListener("touchmove",   onTouchMove);
      el.removeEventListener("touchend",    onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
      el.removeEventListener("contextmenu", onContextMenu);
    };
  }, [pdfDoc]);

  // ── Mouse drag to pan ──────────────────────────────────────────────────────
  useEffect(() => {
    const el = previewRef.current;
    if (!el || !pdfDoc) return;

    let dragging = false;
    let startX = 0, startY = 0, scrollL = 0, scrollT = 0;

    const onMouseDown = (e) => {
      if (e.button !== 0) return;
      if (extractModeRef.current === "manual") return;
      if (e.target.closest?.(".pdf_text_layer")) return;
      const tag = e.target.tagName;
      if (tag === "BUTTON" || tag === "SELECT" || tag === "INPUT" || tag === "A") return;

      dragging = true;
      startX   = e.clientX;
      startY   = e.clientY;
      scrollL  = el.scrollLeft;
      scrollT  = el.scrollTop;
      el.style.cursor     = "grabbing";
      el.style.userSelect = "none";
      e.preventDefault();
    };

    const onMouseMove = (e) => {
      if (!dragging) return;
      el.scrollLeft = scrollL - (e.clientX - startX);
      el.scrollTop  = scrollT - (e.clientY - startY);
    };

    const onMouseUp = () => {
      if (!dragging) return;
      dragging            = false;
      el.style.cursor     = "";
      el.style.userSelect = "";
    };

    el.addEventListener("mousedown", onMouseDown);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup",   onMouseUp);

    return () => {
      el.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup",   onMouseUp);
    };
  }, [pdfDoc]);

  // ── Render text layer for Manual mode ─────────────────────────────────────
  useEffect(() => {
    const div = textLayerRef.current;
    if (extractMode !== "manual" || !pdfDoc || !div) return;
    if (!pageViewport) return;
    div.innerHTML = "";
    spansRef.current = [];
    setManualSelection(null);
    let cancelled = false;

    pdfDoc.getPage(pageNum).then((page) =>
      page.getTextContent().then((content) => {
        if (cancelled || !textLayerRef.current) return;

        // Multiply two 2-D affine matrices (same as pdfjsLib.Util.transform).
        // vt = viewport.transform, it = item.transform → tx = vt × it
        const vt    = pageViewport.transform;
        const scale = Math.hypot(vt[0], vt[1]); // viewport scale (px per user-space unit)
        const mul   = ([a2, b2, c2, d2, e2, f2]) => [
          vt[0] * a2 + vt[2] * b2,
          vt[1] * a2 + vt[3] * b2,
          vt[0] * c2 + vt[2] * d2,
          vt[1] * c2 + vt[3] * d2,
          vt[0] * e2 + vt[2] * f2 + vt[4],
          vt[1] * e2 + vt[3] * f2 + vt[5],
        ];

        for (const item of content.items) {
          if (!item.str) continue;
          const tx       = mul(item.transform);
          const fontSize = Math.hypot(tx[0], tx[1]);
          if (fontSize < 1) continue;

          const angle      = Math.atan2(tx[1], tx[0]);
          const itemWidth  = item.width * scale; // PDF advance width → canvas pixels

          const span = document.createElement("span");
          span.dataset.spanIdx    = String(spansRef.current.length);
          spansRef.current.push({ text: item.str, el: span });
          span.textContent        = item.str;
          span.style.position     = "absolute";
          span.style.left         = `${tx[4]}px`;
          span.style.top          = `${tx[5] - fontSize * 0.8}px`;
          span.style.height       = `${fontSize}px`;
          span.style.fontSize     = `${fontSize}px`;
          span.style.whiteSpace   = "pre";
          span.style.color        = "transparent";
          span.style.transformOrigin = "0% 0%";
          span.style.userSelect   = "text";
          span.style.webkitUserSelect = "text";
          if (itemWidth > 0)
            span.style.width = `${itemWidth}px`;
          if (Math.abs(angle) > 0.01)
            span.style.transform = `rotate(${angle}rad)`;
          div.appendChild(span);
        }
      })
    );

    return () => { cancelled = true; if (textLayerRef.current) textLayerRef.current.innerHTML = ""; };
  }, [extractMode, pdfDoc, pageNum, pageViewport]);

  // Highlight selected text: group spans by line → one even rect per line.
  // Uses getBoundingClientRect() for real visual bounds (glyph height > em-size, width overflow, etc.)
  useEffect(() => {
    const spans = spansRef.current;
    const layer = textLayerRef.current;

    layer?.querySelectorAll(".sel_highlight").forEach((el) => el.remove());
    spans.forEach(({ el }) => el.classList.remove("span_selected"));

    if (!manualSelection || !layer) return;
    const lo = Math.min(manualSelection.startIdx, manualSelection.endIdx);
    const hi = Math.max(manualSelection.startIdx, manualSelection.endIdx);

    for (let i = lo; i <= hi; i++) spans[i]?.el?.classList.add("span_selected");

    const layerRect = layer.getBoundingClientRect();
    const bodyZoom  = parseFloat(document.body.style.zoom) || 1;

    const lines = [];
    for (let i = lo; i <= hi; i++) {
      const el = spans[i]?.el;
      if (!el) continue;

      // Canvas-local bounds from the span's explicit CSS geometry
      const r      = el.getBoundingClientRect();
      const left   = (r.left   - layerRect.left) / bodyZoom;
      const top    = (r.top    - layerRect.top)  / bodyZoom;
      const right  = (r.right  - layerRect.left) / bodyZoom;
      const bottom = (r.bottom - layerRect.top)  / bodyZoom;
      const h      = bottom - top;

      // PDF glyphs have ascenders/descenders that extend beyond the em-box.
      // Pad vertically so the highlight covers the real canvas-rendered glyph height.
      const padV = h * 0.25;

      // Cluster threshold scales with font size
      let line = lines.find((l) => Math.abs(l.refTop - top) < Math.max(8, h * 0.5));
      if (!line) { line = { refTop: top, minL: Infinity, maxR: -Infinity, minT: Infinity, maxB: -Infinity }; lines.push(line); }
      line.minL = Math.min(line.minL, left);
      line.maxR = Math.max(line.maxR, right);
      line.minT = Math.min(line.minT, top    - padV);
      line.maxB = Math.max(line.maxB, bottom + padV);
    }

    for (const l of lines) {
      const rect = document.createElement("div");
      rect.className           = "sel_highlight";
      rect.style.position      = "absolute";
      rect.style.left          = `${l.minL}px`;
      rect.style.top           = `${l.minT}px`;
      rect.style.width         = `${l.maxR - l.minL}px`;
      rect.style.height        = `${l.maxB - l.minT}px`;
      rect.style.background    = "rgba(56,139,253,0.35)";
      rect.style.borderRadius  = "2px";
      rect.style.pointerEvents = "none";
      rect.style.zIndex        = "1";
      layer.insertBefore(rect, layer.firstChild);
    }

    return () => { layer?.querySelectorAll(".sel_highlight").forEach((el) => el.remove()); };
  }, [manualSelection]);

  // Positions (canvas-space px) of the two drag handles, using real visual bounds
  const selHandles = useMemo(() => {
    if (!manualSelection) return null;
    const { startIdx, endIdx } = manualSelection;
    const lo  = Math.min(startIdx, endIdx);
    const hi  = Math.max(startIdx, endIdx);
    const sEl = spansRef.current[lo]?.el;
    const eEl = spansRef.current[hi]?.el;
    const layer = textLayerRef.current;
    if (!sEl || !eEl || !layer) return null;
    const layerRect = layer.getBoundingClientRect();
    const bodyZoom  = parseFloat(document.body.style.zoom) || 1;
    const sR = sEl.getBoundingClientRect();
    const eR = eEl.getBoundingClientRect();
    const toLocal = (r) => ({
      left:   (r.left   - layerRect.left) / bodyZoom,
      top:    (r.top    - layerRect.top)  / bodyZoom,
      right:  (r.right  - layerRect.left) / bodyZoom,
      bottom: (r.bottom - layerRect.top)  / bodyZoom,
    });
    const s    = toLocal(sR);
    const e    = toLocal(eR);
    const padS = (s.bottom - s.top) * 0.25;
    const padE = (e.bottom - e.top) * 0.25;
    return {
      start: { x: s.left,  y: s.top - padS, h: (s.bottom - s.top) + padS * 2 },
      end:   { x: e.right, y: e.top - padE, h: (e.bottom - e.top) + padE * 2 },
    };
  }, [manualSelection]);

  // Drag-handle events — attached while a handle is being dragged
  useEffect(() => {
    if (!dragHandle) return;

    // Kill native text selection for the duration of the drag
    const prev = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    window.getSelection()?.removeAllRanges();

    const onMove = (e) => {
      e.preventDefault();
      const cx = e.touches ? e.touches[0].clientX : e.clientX;
      const cy = e.touches ? e.touches[0].clientY : e.clientY;
      // Hit-test behind the handle (temporarily hide it so elementFromPoint sees the text layer)
      const target = document.elementFromPoint(cx, cy);
      const layer  = textLayerRef.current;
      if (!target || !layer || !layer.contains(target)) return;
      const idx = parseInt(target.dataset.spanIdx ?? "-1", 10);
      if (idx < 0) return;
      setManualSelection((sel) => {
        if (!sel) return sel;
        if (dragHandle === "start") {
          const newStart = Math.min(idx, sel.endIdx);
          const text = spansRef.current.slice(newStart, sel.endIdx + 1).map((s) => s.text).join(" ").trim();
          return { ...sel, startIdx: newStart, text };
        } else {
          const newEnd = Math.max(idx, sel.startIdx);
          const text = spansRef.current.slice(sel.startIdx, newEnd + 1).map((s) => s.text).join(" ").trim();
          return { ...sel, endIdx: newEnd, text };
        }
      });
    };
    const onUp = () => { dragHandleRef.current = null; setDragHandle(null); };

    // Touch drag is handled inline in #pdf_preview's native onTouchMove — only mouse needs window listeners
    window.addEventListener("mousemove", onMove, { passive: false });
    window.addEventListener("mouseup",   onUp);
    return () => {
      document.body.style.userSelect = prev;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",   onUp);
    };
  }, [dragHandle]);

  // ── Dismiss popup when clicking outside ───────────────────────────────────
  useEffect(() => {
    if (!manualPopup) return;
    const handler = (e) => {
      if (popupRef.current && !popupRef.current.contains(e.target)) {
        setManualPopup(null);
        window.getSelection()?.removeAllRanges();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [manualPopup]);

  // ── Clear results on page change ───────────────────────────────────────────
  useEffect(() => {
    if (hyleData !== null && hylePage !== pageNum) {
      setHyleData(null);
      setExtractError("");
      setSavedId(null);
      setActiveHistoryId(null);
    }
    setManualPopup(null);
  }, [pageNum]);

  // ── Load PDF ───────────────────────────────────────────────────────────────
  const loadPdfBytes = useCallback(async (arrayBuffer, name) => {
    setLoading(true);
    setFilename(name);
    setPdfDoc(null); setPdfType(null);
    setHyleData(null); setHylePage(null);
    setExtractError(""); setSavedId(null); setActiveHistoryId(null);
    setPageNum(1); setPageViewport(null); setZoom(1);
    renderTasksRef.current.forEach(t => t?.cancel());
    pageCanvasRefs.current = []; pageContainerRefs.current = [];
    pageViewportsRef.current = []; renderTasksRef.current = [];
    try {
      const doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      setPdfDoc(doc);
      setPageCount(doc.numPages);
      const sampleCount = Math.min(10, doc.numPages);
      const step        = Math.max(1, Math.floor(doc.numPages / sampleCount));
      let totalChars = 0, sampledPages = 0;
      for (let p = 1; p <= doc.numPages && sampledPages < sampleCount; p += step) {
        const pg      = await doc.getPage(p);
        const content = await pg.getTextContent();
        totalChars   += content.items.reduce((n, item) => n + item.str.length, 0);
        sampledPages++;
      }
      const charsPerPage = sampledPages > 0 ? totalChars / sampledPages : 0;
      setPdfType(charsPerPage < 50 ? "scanned" : charsPerPage < 300 ? "mixed" : "text-based");
    } catch {
      alert("Could not open PDF.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadFile = useCallback(async (file) => {
    if (!file || file.type !== "application/pdf") return;
    const arrayBuffer = await file.arrayBuffer();
    loadPdfBytes(arrayBuffer, file.name);
  }, [loadPdfBytes]);

  const loadFromSource = useCallback(async (sourceId, name) => {
    setLoading(true);
    try {
      const res = await authFetch(apiUrl(`/api/sources/${sourceId}/download`));
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(`Could not load PDF: ${data.error || res.status}`);
        setLoading(false);
        return;
      }
      const arrayBuffer = await res.arrayBuffer();
      loadPdfBytes(arrayBuffer, name);
    } catch (err) {
      alert(`Could not load PDF: ${err.message}`);
      setLoading(false);
    }
  }, [loadPdfBytes]);

  // ── History ────────────────────────────────────────────────────────────────
  const handleDeleteExtraction = useCallback(async (e, id) => {
    e.stopPropagation();
    try {
      await authFetch(apiUrl(`/api/pdf/history/${id}`), { method: "DELETE" });
      setHistory((h) => h.filter((item) => item._id !== id));
      if (activeHistoryId === id) { setActiveHistoryId(null); setSavedId(null); }
    } catch {}
  }, [activeHistoryId]);

  const loadHistoryItem = useCallback(async (id) => {
    if (id === activeHistoryId) return;
    try {
      const res  = await authFetch(apiUrl(`/api/pdf/history/${id}`));
      const data = await res.json();
      if (data.extraction) {
        setHyleData(inflateExtraction(data.extraction));
        setHylePage(data.extraction.pageNumber);
        setActiveHistoryId(id); setSavedId(id); setExtractError("");
      }
    } catch {}
  }, [activeHistoryId]);

  // ── Save ───────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!hyleData || saving) return;
    setSaving(true);
    try {
      const { systemMessage } = await (await fetch(apiUrl("/api/pdf/system-message"))).json();
      const res  = await authFetch(apiUrl("/api/pdf/save-extraction"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: filename || "unknown.pdf",
          pageCount: pageCount || 1,
          type: pdfType || "text-based",
          pageNumber: hylePage || pageNum,
          provider: extractMode === "manual" ? "manual" : provider,
          model: extractMode === "manual" ? "user" : provider,
          systemMessageSnapshot: systemMessage || "",
          nouns: deflateNounData(hyleData),
          totalNouns: hyleData._total,
        }),
      });
      const data = await res.json();
      if (data.extractionId) {
        setSavedId(data.extractionId);
        authFetch(apiUrl("/api/pdf/history")).then((r) => r.json()).then((d) => setHistory(d.extractions || [])).catch(() => {});
      }
    } catch {}
    finally { setSaving(false); }
  }, [hyleData, saving, filename, pageCount, pdfType, hylePage, pageNum, provider, extractMode]);

  // ── AI extraction (streaming) ──────────────────────────────────────────────
  const handleExtract = useCallback(async () => {
    if (!pdfDoc || extracting || pdfType === "scanned") return;
    setExtracting(true);
    setHyleData(EMPTY_HYLES());
    setHylePage(pageNum);
    setExtractError(""); setSavedId(null); setActiveHistoryId(null);

    try {
      const page    = await pdfDoc.getPage(pageNum);
      const content = await page.getTextContent();
      const text    = content.items.map((item) => item.str + (item.hasEOL ? "\n" : " ")).join("").trim();

      if (!text || text.replace(/\s/g, "").length < 80) {
        setExtractError("This page has no extractable text content.");
        setHyleData(null);
        return;
      }

      const res     = await authFetch(apiUrl("/api/pdf/extract-nouns"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, provider }),
      });

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer    = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") break;
          try {
            const { noun, card, mode, reason, total, error: err } = JSON.parse(payload);
            if (err) { setExtractError(err); break; }
            if (noun && card && mode) {
              setHyleData((prev) => {
                const all = ["objects","traces","phenomena","concept","models"].flatMap((c) => ALL_MODES.flatMap((m) => prev[c][m].map((it) => it.noun)));
                if (all.includes(noun)) return prev;
                const num = prev[card][mode].length + 1;
                return {
                  ...prev,
                  [card]: { ...prev[card], [mode]: [...prev[card][mode], { id: `${card}_${mode}_${num}`, num, noun, reason: reason || "", status: initStatus() }] },
                  _total: total,
                };
              });
            }
          } catch {}
        }
      }
    } catch (err) {
      setExtractError(err.message);
    } finally {
      setExtracting(false);
    }
  }, [pdfDoc, pageNum, extracting, pdfType, provider]);

  // ── Manual selection ───────────────────────────────────────────────────────
  const handleTextMouseDown = useCallback((e) => {
    mouseDownPosRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleTextSelection = useCallback((e) => {
    if (extractMode !== "manual") return;
    const down = mouseDownPosRef.current;
    mouseDownPosRef.current = null;

    const moved = down
      ? (e.clientX - down.x) ** 2 + (e.clientY - down.y) ** 2
      : 999;

    if (moved >= 64) {
      // Drag → open popup directly with selected text
      const sel      = window.getSelection();
      const dragText = sel?.toString().trim().replace(/\s+/g, " ");
      if (dragText && sel.rangeCount > 0) {
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        setManualHyle(dragText.toLowerCase().replace(/[.,;:]+$/, ""));
        setManualPopup({ x: rect.left + rect.width / 2, y: rect.bottom + 10 });
      }
      return;
    }

    // Single click → find word under cursor → show selection bar
    const target  = document.elementFromPoint(e.clientX, e.clientY);
    const layer   = textLayerRef.current;
    if (!target || !layer || !layer.contains(target)) return;
    const spanIdx = parseInt(target.dataset.spanIdx ?? "-1", 10);
    if (spanIdx < 0) return;
    const tn = target.firstChild;
    if (!tn || tn.nodeType !== Node.TEXT_NODE || !tn.textContent.trim()) return;
    const txt   = tn.textContent;
    const r     = target.getBoundingClientRect();
    const ratio = r.width > 0 ? (e.clientX - r.left) / r.width : 0;
    let s = Math.round(ratio * txt.length), end = s;
    while (s > 0            && /\S/.test(txt[s - 1])) s--;
    while (end < txt.length && /\S/.test(txt[end]))   end++;
    if (s >= end) return;
    const range = document.createRange();
    range.setStart(tn, s);
    range.setEnd(tn, end);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    const word = sel.toString().trim();
    if (!word) return;
    sel.removeAllRanges(); // clear browser selection highlight
    const bx = parseFloat(target.style.left || "0") + (parseFloat(target.style.width || "0") || target.offsetWidth || 0) / 2;
    const by = parseFloat(target.style.top  || "0") +  parseFloat(target.style.height || "0") + 8;
    setManualSelection({ startIdx: spanIdx, endIdx: spanIdx, text: word, x: bx, y: by });
  }, [extractMode]);

  const handleManualAdd = useCallback(() => {
    const noun = manualHyle.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.,;:]+$/, "");
    if (!noun) return;

    setHyleData((prev) => {
      const base = prev || EMPTY_HYLES();
      const all  = ["objects","traces","phenomena","concept","models"].flatMap((c) => ALL_MODES.flatMap((m) => base[c][m].map((it) => it.noun)));
      if (all.includes(noun)) return base;
      const num = (base[manualCard][manualMode]?.length || 0) + 1;
      return {
        ...base,
        [manualCard]: {
          ...base[manualCard],
          [manualMode]: [...base[manualCard][manualMode], { id: `${manualCard}_${manualMode}_${num}`, num, noun, reason: "manual", status: initStatus() }],
        },
        _total: (base._total || 0) + 1,
      };
    });
    if (!hylePage) setHylePage(pageNum);
    setManualPopup(null);
    setManualHyle("");
    window.getSelection()?.removeAllRanges();
  }, [manualHyle, manualCard, manualMode, hylePage, pageNum]);

  // ── Selection bar: expand / confirm ───────────────────────────────────────
  const expandLeft = useCallback(() => {
    setManualSelection((sel) => {
      if (!sel || sel.startIdx === 0) return sel;
      const idx  = sel.startIdx - 1;
      const text = spansRef.current.slice(idx, sel.endIdx + 1).map((s) => s.text).join(" ").trim();
      return { ...sel, startIdx: idx, text };
    });
  }, []);

  const expandRight = useCallback(() => {
    setManualSelection((sel) => {
      if (!sel || sel.endIdx >= spansRef.current.length - 1) return sel;
      const idx  = sel.endIdx + 1;
      const text = spansRef.current.slice(sel.startIdx, idx + 1).map((s) => s.text).join(" ").trim();
      return { ...sel, endIdx: idx, text };
    });
  }, []);

  const confirmSelection = useCallback(() => {
    if (!manualSelection) return;
    const noun = manualSelection.text.toLowerCase().replace(/[.,;:]+$/, "").replace(/\s+/g, " ").trim();
    setManualHyle(noun);
    // Get fresh viewport coords for the popup via the span's bounding rect
    const spanEl = spansRef.current[manualSelection.endIdx]?.el;
    const vr = spanEl?.getBoundingClientRect();
    setManualPopup({
      x: vr ? vr.left + vr.width / 2 : window.innerWidth  / 2,
      y: vr ? vr.bottom + 10         : window.innerHeight / 2,
    });
    setManualSelection(null);
  }, [manualSelection]);


  // Dismiss selection bar when clicking outside
  useEffect(() => {
    if (!manualSelection) return;
    const handler = (e) => {
      if (e.target.closest?.(".sel_handle")) return;
      if (selBarRef.current && !selBarRef.current.contains(e.target)) {
        setManualSelection(null);
        window.getSelection()?.removeAllRanges();
      }
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler, { passive: true });
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [manualSelection]);

  // ── Noun controls ──────────────────────────────────────────────────────────
  const reindex = (items, card, mode) =>
    items.map((item, i) => ({ ...item, num: i + 1, id: `${card}_${mode}_${i + 1}` }));

  const handleHyleStatus = useCallback((card, mode, index, newValue) => {
    setHyleData((prev) => {
      const items  = [...prev[card][mode]];
      const next   = currentStatus(items[index]) === newValue ? "pending" : newValue;
      items[index] = { ...items[index], status: { value: next, at: new Date().toISOString() } };
      return { ...prev, [card]: { ...prev[card], [mode]: items } };
    });
  }, []);

  const handleHyleDelete = useCallback((card, mode, index) => {
    setHyleData((prev) => {
      const items = [...prev[card][mode]];
      items.splice(index, 1);
      return { ...prev, [card]: { ...prev[card], [mode]: reindex(items, card, mode) } };
    });
  }, []);

  const handleHyleMove = useCallback((fromCard, fromMode, index, toCard, toMode) => {
    if (fromCard === toCard && fromMode === toMode) return;
    setHyleData((prev) => {
      const src = [...prev[fromCard][fromMode]];
      const [item] = src.splice(index, 1);
      const dst = [...prev[toCard][toMode]];
      const num = dst.length + 1;
      dst.push({ ...item, num, id: `${toCard}_${toMode}_${num}`, status: initStatus() });
      return {
        ...prev,
        [fromCard]: { ...prev[fromCard], [fromMode]: reindex(src, fromCard, fromMode) },
        [toCard]:   { ...prev[toCard],   [toMode]:   dst },
      };
    });
  }, []);

  // ── Panel resize handle ────────────────────────────────────────────────────
  const handleResizeStart = useCallback((e) => {
    e.preventDefault();
    const onMove = (ev) => {
      if (!contentRef.current) return;
      const rect  = contentRef.current.getBoundingClientRect();
      const clientX = ev.touches ? ev.touches[0].clientX : ev.clientX;
      const ratio = Math.max(0.1, Math.min(1, (clientX - rect.left) / rect.width));
      setSplitRatio(ratio);
      if (ratio < 0.9) savedRatioRef.current = ratio;
    };
    const onEnd = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",   onEnd);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend",  onEnd);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onEnd);
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend",  onEnd);
  }, []);

  const togglePreview = useCallback(() => {
    setSplitRatio((r) => {
      if (r === 0) return savedRatioRef.current || 0.42;
      savedRatioRef.current = r;
      return 0;
    });
  }, []);

  // ── Drag & drop ────────────────────────────────────────────────────────────
  const handleDrop        = useCallback((e) => { e.preventDefault(); setDragOver(false); loadFile(e.dataTransfer.files[0]); }, [loadFile]);
  const handleDragOver    = (e) => { e.preventDefault(); setDragOver(true); };
  const handleDragLeave   = () => setDragOver(false);
  const handleInputChange = (e) => loadFile(e.target.files[0]);

  const handleClose = () => {
    renderTasksRef.current.forEach(t => t?.cancel());
    pageCanvasRefs.current = []; pageContainerRefs.current = [];
    pageViewportsRef.current = []; renderTasksRef.current = [];
    setPdfDoc(null); setFilename(""); setPageNum(1); setPageCount(0);
    setPdfType(null); setHyleData(null); setHylePage(null);
    setExtractError(""); setSavedId(null); setActiveHistoryId(null);
    setPageViewport(null); setManualPopup(null); setZoom(1);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const renderTypeNode = (node, depth = 0) => {
    const isLeaf = !node.children || node.children.length === 0;
    return (
      <div key={node.key} className={`hyle_type_node hyle_type_depth_${depth}`}>
        {isLeaf ? (
          <button
            className={`hyle_type_leaf${extractionType === node.key ? " hyle_type_leaf--active" : ""}`}
            onClick={() => setExtractionType(extractionType === node.key ? null : node.key)}
          >
            {node.label}
            {node.note && <span className="hyle_type_note">{node.note}</span>}
          </button>
        ) : (
          <>
            <span className="hyle_type_group">{node.label}</span>
            <div className="hyle_type_children">
              {node.children.map((child) => renderTypeNode(child, depth + 1))}
            </div>
          </>
        )}
      </div>
    );
  };

  const navigate = useNavigate();
  const location   = useLocation();
  const { card: urlCard } = useParams();
  const isNounsPage = !urlCard; // true when mounted at /hyles (no card in URL)
  const [localCard, setLocalCard] = useState("objects");
  const activeCard = isNounsPage
    ? localCard
    : (CARDS.find((c) => c.key === urlCard)?.key || "objects");
  const canExtract = Boolean(pdfDoc) && pdfType !== "scanned";

  return (
    <div id="pdf_page">
      {showSysModal && <SystemMessageModal onClose={() => setShowSysModal(false)} />}

      {/* Manual selection popup — fixed to viewport */}
      {manualPopup && (
        <div
          ref={popupRef}
          id="manual_popup"
          style={{ left: manualPopup.x, top: manualPopup.y }}
          onKeyDown={(e) => { if (e.key === "Enter") handleManualAdd(); if (e.key === "Escape") { setManualPopup(null); window.getSelection()?.removeAllRanges(); } }}
        >
          <input
            id="manual_noun_input"
            value={manualHyle}
            onChange={(e) => setManualHyle(e.target.value)}
            placeholder="Hyle"
            autoFocus
          />
          <div id="manual_selects">
            <select value={manualCard} onChange={(e) => setManualCard(e.target.value)}>
              {CARDS.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}
            </select>
            <select value={manualMode} onChange={(e) => setManualMode(e.target.value)}>
              {ALL_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div id="manual_actions">
            <button id="manual_add_btn" onClick={handleManualAdd}>Add</button>
            <button id="manual_cancel_btn" onClick={() => { setManualPopup(null); window.getSelection()?.removeAllRanges(); }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div id="pdf_toolbar">
        <button id="pdf_home_btn" onClick={() => navigate("/hylomorphism")} title="Hyle-to-Meaning">⌂</button>
        {pdfDoc && <>
          <button onClick={() => pageContainerRefs.current[pageNum - 2]?.scrollIntoView({ behavior: "smooth", block: "start" })} disabled={pageNum <= 1}>‹</button>
          <span>{pageNum} / {pageCount}</span>
          <button onClick={() => pageContainerRefs.current[pageNum]?.scrollIntoView({ behavior: "smooth", block: "start" })} disabled={pageNum >= pageCount}>›</button>
          <span id="pdf_filename">{filename}</span>
          {pdfType && <span className={`pdf_type_badge pdf_type_badge--${pdfType}`}>{PDF_TYPE_LABEL[pdfType]}</span>}
          <div id="pdf_zoom_controls">
            <button onClick={() => setZoom((z) => Math.max(1, z / 1.25))} title="Zoom out">−</button>
            <button id="pdf_zoom_label" onClick={() => setZoom(1)} title="Reset to fit width">
              {Math.round(zoom * 100)}%
            </button>
            <button onClick={() => setZoom((z) => Math.min(5, z * 1.25))} title="Zoom in">+</button>
          </div>
          <button id="pdf_close" onClick={handleClose}>✕</button>

          {/* Hyles toggle + extraction controls */}
          <button
            id="pdf_hyles_toggle_btn"
            className={extractionOpen ? "pdf_hyles_toggle_btn--active" : ""}
            onClick={() => {
              const next = !extractionOpen;
              setExtractionOpen(next);
              setSplitRatio(next ? 0.5 : 1);
            }}
          >Hyles</button>

          {extractionOpen && (
            <div id="pdf_hyles_actions">
              {hyleData && hyleData._total > 0 && !extracting && (
                <button className={`pdf_action_btn${savedId ? " pdf_action_btn--saved" : ""}`} onClick={handleSave} disabled={saving}>
                  {saving ? "Saving…" : savedId ? "Saved" : "Save"}
                </button>
              )}
              <button id="pdf_sys_btn" onClick={() => setShowSysModal(true)}>System</button>
              <AIProviderSelect provider={provider} setProvider={setProvider} disabled={extracting} />
              {extractMode === "ai" && (
                <button id="pdf_extract_btn" onClick={handleExtract} disabled={!canExtract || extracting} title={!canExtract ? "Open a text-based PDF first" : ""}>
                  {extracting ? "Extracting…" : pdfDoc ? `Extract Page ${pageNum}` : "Extract"}
                </button>
              )}
            </div>
          )}
        </>}
      </div>

      {/* Annotation toolbar + Linguistic Units bar */}
      {pdfDoc && (<>
        <div id="pdf_annot_toolbar">
          <div id="pdf_annot_tools">
            {ANNOT_TOOLS.map(({ key, icon, label }) => (
              <button
                key={key}
                className={`annot_tool_btn${annotTool === key ? " annot_tool_btn--active" : ""}`}
                title={label}
                onClick={() => setAnnotTool((t) => t === key ? null : key)}
              ><i className={`fi ${icon}`} /></button>
            ))}
          </div>
          <div id="pdf_annot_colors">
            {ANNOT_COLORS.map((c) => (
              <button
                key={c}
                className={`annot_color_btn${annotColor === c ? " annot_color_btn--active" : ""}`}
                style={{ background: c }}
                title={c}
                onClick={() => setAnnotColor(c)}
              />
            ))}
          </div>
          <div id="pdf_annot_actions">
            <button className="annot_action_btn" onClick={handleAnnotUndo} title="Undo last" disabled={!(annotations[pageNum]?.length > 0)}><i className="fi fi-rr-undo" /></button>
            <button className="annot_action_btn" onClick={handleAnnotClear} title="Clear page" disabled={!(annotations[pageNum]?.length > 0)}><i className="fi fi-rr-trash" /></button>
          </div>
        </div>

        {/* Linguistic Units bar */}
        <div id="pdf_ling_bar">
          <span id="pdf_ling_label">Linguistic Units</span>
          <div id="pdf_ling_units">
            {LINGUISTIC_UNITS.map(u => (
              <button
                key={u.id}
                className={`pdf_ling_btn${linguisticUnit === u.id ? " pdf_ling_btn--active" : ""}`}
                style={{ "--lu-color": u.color }}
                title={u.desc}
                onClick={() => {
                  setLinguisticUnit(prev => prev === u.id ? null : u.id);
                  if (!annotTool) setAnnotTool("highlight");
                }}
              >{u.label}</button>
            ))}
            {linguisticUnit && (
              <button
                className="pdf_ling_clear"
                title="Clear linguistic unit"
                onClick={() => setLinguisticUnit(null)}
              >×</button>
            )}
          </div>
        </div>
      </>)}

      {/* Tool options panel (pen / highlight / eraser) */}
      {(annotTool === "highlight" || annotTool === "pen" || annotTool === "eraser") && (
        <div id="highlight_panel">
          <div id="hlp_preview">
            <div
              id="hlp_circle"
              style={{
                width:        annotTool === "pen" ? penSize * 4 : annotTool === "eraser" ? eraserSize * 2 : annotSize * 2,
                height:       annotTool === "pen" ? penSize * 4 : annotTool === "eraser" ? eraserSize * 2 : annotSize * 2,
                background:   annotTool === "eraser" ? "rgba(255,255,255,0.15)" : annotColor,
                borderRadius: "50%",
                border:       annotTool === "eraser" ? "1px dashed rgba(255,255,255,0.4)" : "none",
                maxWidth:     "80px",
                maxHeight:    "80px",
              }}
            />
          </div>
          <div id="hlp_controls">
            {annotTool === "pen" && (
              <input
                id="hlp_slider"
                type="range"
                min="1" max="20" step="0.5"
                value={penSize}
                onChange={(e) => setPenSize(Number(e.target.value))}
              />
            )}
            {annotTool === "highlight" && (
              <input
                id="hlp_slider"
                type="range"
                min="4" max="64" step="2"
                value={annotSize}
                onChange={(e) => setAnnotSize(Number(e.target.value))}
              />
            )}
            {annotTool === "eraser" && (
              <input
                id="hlp_slider"
                type="range"
                min="6" max="48" step="2"
                value={eraserSize}
                onChange={(e) => setEraserSize(Number(e.target.value))}
              />
            )}
            {annotTool !== "eraser" && (
              <div id="hlp_colors">
                {ANNOT_COLORS.map((c) => (
                  <button
                    key={c}
                    className={`annot_color_btn${annotColor === c ? " annot_color_btn--active" : ""}`}
                    style={{ background: c }}
                    onClick={() => setAnnotColor(c)}
                  />
                ))}
              </div>
            )}
            {annotTool === "highlight" && (
              <div id="hlp_mode_toggle">
                <button
                  className={`hlp_mode_btn${highlightMode === "freehand" ? " hlp_mode_btn--active" : ""}`}
                  onClick={() => setHighlightMode("freehand")}
                >Freehand</button>
                <button
                  className={`hlp_mode_btn${highlightMode === "line" ? " hlp_mode_btn--active" : ""}`}
                  onClick={() => setHighlightMode("line")}
                >Line</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Split area */}
      <div id="pdf_content" ref={contentRef}>

        {/* Left — PDF viewer or upload zone */}
        <div
          id="pdf_preview"
          ref={previewRef}
          style={{ width: splitRatio === 0 ? "0" : splitRatio >= 0.9 ? "100%" : `${splitRatio * 100}%` }}
          className={splitRatio === 0 ? "pdf_preview--closed" : ""}
        >
          {pdfDoc ? (
            <div id="pdf_canvas_wrap" ref={canvasWrapRef}>
              {Array.from({ length: pageCount }, (_, i) => i + 1).map(n => (
                <div
                  key={n}
                  className="pdf_page_container"
                  ref={el => { pageContainerRefs.current[n - 1] = el; }}
                  data-page={n}
                >
                  <canvas
                    className="pdf_page_canvas"
                    ref={el => { pageCanvasRefs.current[n - 1] = el; }}
                  />
                  {pageNum === n && (
                    <>
                      <canvas
                        id="pdf_annot_canvas"
                        ref={annotCanvasRef}
                        style={{ pointerEvents: annotTool ? "auto" : "none", cursor: annotTool === "eraser" ? "cell" : annotTool ? "crosshair" : "default" }}
                      />
                      {annotTextInput && (
                        <input
                          id="annot_text_input"
                          autoFocus
                          value={annotTextVal}
                          onChange={(e) => setAnnotTextVal(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") commitAnnotText(); if (e.key === "Escape") setAnnotTextInput(null); }}
                          onBlur={commitAnnotText}
                          style={{ left: annotTextInput.vx - annotCanvasRef.current?.getBoundingClientRect().left, top: annotTextInput.vy - annotCanvasRef.current?.getBoundingClientRect().top }}
                        />
                      )}
                      {manualSelection && !manualPopup && selHandles && (
                        <>
                          <div
                            className="sel_handle sel_handle--start"
                            style={{ left: selHandles.start.x, top: selHandles.start.y, height: selHandles.start.h + 8 }}
                            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setDragHandle("start"); dragHandleRef.current = "start"; }}
                            onTouchStart={(e) => { e.stopPropagation(); dragHandleRef.current = "start"; setDragHandle("start"); }}
                          />
                          <div
                            className="sel_handle sel_handle--end"
                            style={{ left: selHandles.end.x, top: selHandles.end.y, height: selHandles.end.h + 8 }}
                            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setDragHandle("end"); dragHandleRef.current = "end"; }}
                            onTouchStart={(e) => { e.stopPropagation(); dragHandleRef.current = "end"; setDragHandle("end"); }}
                          />
                        </>
                      )}
                      {manualSelection && !manualPopup && (
                        <div ref={selBarRef} id="manual_select_bar" style={{ left: manualSelection.x, top: manualSelection.y }}>
                          <span id="msb_text">{manualSelection.text}</span>
                          <button id="msb_confirm" onClick={confirmSelection}>✓</button>
                          <button id="msb_cancel"  onClick={() => { setManualSelection(null); window.getSelection()?.removeAllRanges(); }}>✕</button>
                        </div>
                      )}
                      {extractMode === "manual" && (
                        <div
                          ref={textLayerRef}
                          className="pdf_text_layer"
                          style={pageViewport
                            ? { width: pageViewport.width, height: pageViewport.height }
                            : { inset: 0, position: "absolute" }}
                          onMouseDown={handleTextMouseDown}
                          onMouseUp={handleTextSelection}
                        />
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          ) : isNounsPage ? (
            <div id="pdf_source_select_zone">
              {loading ? <p>Loading…</p> : hyleSourcesLoading ? <p>Loading sources…</p> : hyleSources.length === 0 ? (
                <>
                  <span id="pdf_source_empty_icon">📂</span>
                  <p id="pdf_source_empty_msg">No sources yet.</p>
                  <p id="pdf_source_empty_sub">Go to <strong>Hyle Source Organisation</strong> to add PDFs.</p>
                </>
              ) : (
                <>
                  <label id="pdf_source_label" htmlFor="pdf_source_select">Choose Hyle Source</label>
                  <select
                    id="pdf_source_select"
                    defaultValue=""
                    onChange={(e) => {
                      const src = hyleSources.find((s) => s._id === e.target.value);
                      if (src) loadFromSource(src._id, src.name);
                    }}
                  >
                    <option value="" disabled>Select a source…</option>
                    {hyleSources.map((s) => (
                      <option key={s._id} value={s._id}>{s.name}</option>
                    ))}
                  </select>
                </>
              )}
            </div>
          ) : (
            <div
              id="pdf_drop_zone"
              className={dragOver ? "drag_over" : ""}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
            >
              {loading ? <p>Loading PDF…</p> : (
                <>
                  <span style={{ fontSize: "2rem" }}>📄</span>
                  <p>Drop a PDF here or click to select</p>
                  <button id="pdf_pick_btn" type="button">Choose file</button>
                </>
              )}
            </div>
          )}
          <input ref={fileInputRef} type="file" accept="application/pdf" style={{ display: "none" }} onChange={handleInputChange} />
        </div>

        {/* Resize handle */}
        {splitRatio < 0.9 && splitRatio > 0 && (
          <div id="pdf_resize_handle" onMouseDown={handleResizeStart} onTouchStart={handleResizeStart} />
        )}

        {/* Right — Noun panel */}
        <div id="pdf_hyles_panel" style={{ display: splitRatio >= 0.9 ? "none" : undefined }}>

          <div id="pdf_hyles_panel_header">
            <button
              id="pdf_preview_toggle"
              onClick={togglePreview}
              title={splitRatio === 0 ? "Show PDF viewer" : "Hide PDF viewer"}
            >
              {splitRatio === 0 ? "›" : "‹"}
            </button>
            <span style={{ flex: 1 }}>
              {hylePage ? `Page ${hylePage} Hyles` : "Hyles"}
              {hyleData?._total > 0 && (
                <span style={{ fontWeight: 400, marginLeft: "0.5rem", color: "var(--color-text-muted)" }}>
                  ({hyleData._total} found)
                </span>
              )}
            </span>

            <div className="hyle_font_controls">
              <button className="hyle_font_btn" onClick={() => setHyleFontSize((s) => Math.max(0.5, +(s - 0.05).toFixed(2)))} disabled={hyleFontSize <= 0.5}>−</button>
              <span className="hyle_font_label">{Math.round(hyleFontSize * 100)}%</span>
              <button className="hyle_font_btn" onClick={() => setHyleFontSize((s) => Math.min(1.6, +(s + 0.05).toFixed(2)))} disabled={hyleFontSize >= 1.6}>+</button>
            </div>

            <button
              id="hyle_type_toggle_btn"
              className={typeTreeOpen ? "hyle_type_toggle_btn--open" : ""}
              onClick={() => setTypeTreeOpen((o) => !o)}
              title="Extraction type"
            >
              {extractionType ? HYLE_TYPE_LABELS[extractionType] : "Type"}
            </button>
          </div>

          {typeTreeOpen && (
            <div id="hyle_type_panel">
              {HYLE_TYPE_TREE.map((node) => renderTypeNode(node))}
            </div>
          )}

          {isNounsPage && (
            <div id="hyle_card_tabs">
              {CARDS.map(({ key, label }) => (
                <button
                  key={key}
                  className={`hyle_card_tab${activeCard === key ? " hyle_card_tab--active" : ""}`}
                  onClick={() => setLocalCard(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {!extracting && extractError && (
            <div id="pdf_hyles_error">
              <span>⚠ {extractError}</span>
              {pdfDoc && extractMode === "ai" && <button onClick={handleExtract}>Retry</button>}
            </div>
          )}

          <div id="pdf_hyles_body">
            <div id="pdf_hyles_table_area">
              <HyleCards
                data={hyleData || EMPTY_HYLES()}
                streaming={extracting}
                onStatus={handleHyleStatus}
                onMove={handleHyleMove}
                onDelete={handleHyleDelete}
                activeCard={activeCard}
                fontSize={hyleFontSize}
              />
            </div>

            {history.length > 0 && (
              <div id="pdf_history">
                <div id="pdf_history_label">
                  {historyLoading ? "Loading…" : "Sessions"}
                </div>
                <div id="pdf_history_scroll">
                  {history.map((item) => (
                    <div
                      key={item._id}
                      className={`phi_row${activeHistoryId === item._id ? " phi_row--active" : ""}`}
                      onClick={() => loadHistoryItem(item._id)}
                    >
                      <div className="phi_td_name">{item.documentId?.filename || "—"}</div>
                      <div className="phi_td_meta">p.{item.pageNumber} · {item.totalNouns} nouns · {item.provider}</div>
                      <div className="phi_td_del">
                        <button
                          className="phi_delete_btn"
                          onClick={(e) => handleDeleteExtraction(e, item._id)}
                          title="Delete"
                        >✕</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
};

export default PDFPage;
