import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useHistory, useParams } from "react-router-dom";
import * as pdfjsLib from "pdfjs-dist";
import "./pdfPage.css";
import { apiUrl } from "../config/api";
import { readStoredSession } from "../utils/sessionCleanup";
import NounCards from "./NounCards";
import SystemMessageModal from "./SystemMessageModal";

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

const ALL_MODES = ["sub-molecule","molecule","sub-cell","cell","sub-tissue","tissue","sub-organ","organ","sub-system","system","sub-human","human"];
const modeObj   = () => Object.fromEntries(ALL_MODES.map((m) => [m, []]));

const EMPTY_NOUNS = () => ({
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
  const data = EMPTY_NOUNS();
  for (const { id, num, noun, card, mode, reason, status } of extraction.nouns || []) {
    if (data[card]?.[mode]) {
      data[card][mode].push({ id, num, noun, reason: reason || "", status: status?.value ? status : initStatus() });
    }
  }
  data._total = extraction.totalNouns || 0;
  return data;
};

const deflateNounData = (nounData) => {
  const nouns = [];
  for (const card of ["objects", "traces", "phenomena", "concept", "models"]) {
    for (const mode of ALL_MODES) {
      for (const item of nounData[card]?.[mode] || []) {
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
  const [zoom, setZoom]             = useState(1);
  const [previewOpen, setPreviewOpen] = useState(true);
  const fitScaleRef                 = useRef(1);
  const zoomRef                     = useRef(1);
  const extractModeRef              = useRef("ai");

  const [nounData, setNounData]       = useState(null);
  const [nounPage, setNounPage]       = useState(null);
  const [extracting, setExtracting]   = useState(false);
  const [extractError, setExtractError] = useState("");
  const [provider, setProvider]       = useState("openai");
  const [showSysModal, setShowSysModal] = useState(false);

  // AI vs Manual toggle
  const [extractMode, setExtractMode] = useState("ai");

  // Manual selection popup
  const [manualPopup,     setManualPopup]     = useState(null); // { x, y }
  const [manualNoun,      setManualNoun]      = useState("");
  const [manualCard,      setManualCard]      = useState(() => {
    const p = window.location.pathname.split("/").pop();
    return CARDS.find((c) => c.key === p)?.key || "objects";
  });
  const [manualMode,      setManualMode]      = useState("organ");
  // Selection bar (shown before popup — lets user expand range word-by-word)
  const [manualSelection, setManualSelection] = useState(null); // { startIdx, endIdx, text, x, y }

  const [history, setHistory]               = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [saving, setSaving]                 = useState(false);
  const [savedId, setSavedId]               = useState(null);
  const [activeHistoryId, setActiveHistoryId] = useState(null);

  const canvasRef     = useRef(null);
  const textLayerRef  = useRef(null);
  const previewRef    = useRef(null);
  const fileInputRef  = useRef(null);
  const renderTaskRef = useRef(null);
  const popupRef      = useRef(null);
  const selBarRef          = useRef(null);
  const spansRef           = useRef([]); // [{text, el}] built when text layer renders
  const scrollAfterZoomRef = useRef(null); // {left, top} to apply after zoom re-render
  const mouseDownPosRef    = useRef(null); // {x,y} at last mousedown — used to detect drag vs click

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
              setNounData(inflateExtraction(data.extraction));
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
  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;
    let cancelled = false;

    pdfDoc.getPage(pageNum).then((page) => {
      if (cancelled || !canvasRef.current) return;
      const previewWidth = previewRef.current?.clientWidth || 480;
      const naturalWidth = page.getViewport({ scale: 1 }).width;
      fitScaleRef.current = (previewWidth - 24) / naturalWidth;
      const scale    = fitScaleRef.current * zoom;
      const viewport = page.getViewport({ scale });

      const canvas = canvasRef.current;

      // Snapshot current content before resizing so we can paint it as a
      // scaled placeholder — prevents the canvas from flashing black while
      // pdfjs renders the new frame asynchronously.
      let snapshot = null;
      if (canvas.width > 0 && canvas.height > 0) {
        snapshot = document.createElement("canvas");
        snapshot.width  = canvas.width;
        snapshot.height = canvas.height;
        snapshot.getContext("2d").drawImage(canvas, 0, 0);
      }

      canvas.width  = viewport.width;
      canvas.height = viewport.height;

      if (snapshot) {
        canvas.getContext("2d").drawImage(snapshot, 0, 0, viewport.width, viewport.height);
      }

      renderTaskRef.current?.cancel();
      renderTaskRef.current = page.render({ canvasContext: canvas.getContext("2d"), viewport });
      renderTaskRef.current.promise.catch((err) => {
        if (err?.name !== "RenderingCancelledException") console.error(err);
      });
      setPageViewport(viewport);
    });

    return () => { cancelled = true; renderTaskRef.current?.cancel(); };
  }, [pdfDoc, pageNum, zoom]);

  // Keep refs in sync so event handlers always read the latest values
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);

  // Apply zoom-to-point scroll correction after canvas re-renders at new zoom
  useEffect(() => {
    const pending = scrollAfterZoomRef.current;
    if (!pending || !previewRef.current) return;
    scrollAfterZoomRef.current = null;
    const el = previewRef.current;
    requestAnimationFrame(() => {
      el.scrollLeft = Math.max(0, pending.left);
      el.scrollTop  = Math.max(0, pending.top);
    });
  }, [zoom]);
  useEffect(() => { extractModeRef.current = extractMode; }, [extractMode]);

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

      const range = document.createRange();
      range.setStart(textNode, s);
      range.setEnd(textNode, e);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      const word = sel.toString().trim();
      if (!word) return null;
      sel.removeAllRanges(); // clear browser selection highlight

      const bx = parseFloat(target.style.left  || "0") + (parseFloat(target.style.width  || "0") || target.offsetWidth  || 0) / 2;
      const by = parseFloat(target.style.top   || "0") +  parseFloat(target.style.height || "0") + 8;
      return { text: word, spanIdx, x: bx, y: by };
    };

    const onTouchStart = (e) => {
      if (e.touches.length === 2) {
        clearTimeout(lpTimer); lpTimer = null; isLpSelecting = false;
        startDist = touchDist(e.touches);
        startZoom = zoomRef.current;
        const rect = el.getBoundingClientRect();
        startMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
        startMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
        startSL   = el.scrollLeft;
        startST   = el.scrollTop;
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
            // Find and select the word under the finger
            const target = document.elementFromPoint(ct.clientX, ct.clientY);
            const layer  = textLayerRef.current;
            if (!target || !layer || !layer.contains(target)) return;
            const spanIdx = parseInt(target.dataset.spanIdx ?? "-1", 10);
            if (spanIdx < 0) return;
            // Select entire span as anchor
            const textNode = target.firstChild;
            if (textNode && textNode.nodeType === Node.TEXT_NODE) {
              const range = document.createRange();
              range.selectNodeContents(textNode);
              const sel = window.getSelection();
              sel.removeAllRanges();
              sel.addRange(range);
            }
            lpStartSpanIdx = spanIdx;
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
        const scale   = newZoom / startZoom;
        scrollAfterZoomRef.current = {
          left: (startSL + startMidX) * scale - startMidX,
          top:  (startST + startMidY) * scale - startMidY,
        };
        setZoom(newZoom);
        return;
      }
      if (e.touches.length !== 1) return;

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
      if (e.touches.length < 2) startDist = null;
      clearTimeout(lpTimer); lpTimer = null;

      if (isLpSelecting) {
        isLpSelecting = false;
        const sel  = window.getSelection();
        const text = sel?.toString().replace(/\s+/g, " ").trim();
        if (text) {
          const vr = sel.getRangeAt(0).getBoundingClientRect();
          const noun = text.toLowerCase().replace(/[.,;:]+$/, "").replace(/\s+/g, " ").trim();
          setManualNoun(noun);
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
          setManualSelection({ startIdx: result.spanIdx, endIdx: result.spanIdx, text: result.text, x: result.x, y: result.y });
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
    if (nounData !== null && nounPage !== pageNum) {
      setNounData(null);
      setExtractError("");
      setSavedId(null);
      setActiveHistoryId(null);
    }
    setManualPopup(null);
  }, [pageNum]);

  // ── Load PDF ───────────────────────────────────────────────────────────────
  const loadFile = useCallback(async (file) => {
    if (!file || file.type !== "application/pdf") return;
    setLoading(true);
    setFilename(file.name);
    setPdfDoc(null); setPdfType(null);
    setNounData(null); setNounPage(null);
    setExtractError(""); setSavedId(null); setActiveHistoryId(null);
    setPageNum(1); setPageViewport(null); setZoom(1);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const doc         = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
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
        setNounData(inflateExtraction(data.extraction));
        setNounPage(data.extraction.pageNumber);
        setActiveHistoryId(id); setSavedId(id); setExtractError("");
      }
    } catch {}
  }, [activeHistoryId]);

  // ── Save ───────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!nounData || saving) return;
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
          pageNumber: nounPage || pageNum,
          provider: extractMode === "manual" ? "manual" : provider,
          model: extractMode === "manual" ? "user" : provider === "openai" ? "gpt-4o-mini" : "llama3.2:3b",
          systemMessageSnapshot: systemMessage || "",
          nouns: deflateNounData(nounData),
          totalNouns: nounData._total,
        }),
      });
      const data = await res.json();
      if (data.extractionId) {
        setSavedId(data.extractionId);
        authFetch(apiUrl("/api/pdf/history")).then((r) => r.json()).then((d) => setHistory(d.extractions || [])).catch(() => {});
      }
    } catch {}
    finally { setSaving(false); }
  }, [nounData, saving, filename, pageCount, pdfType, nounPage, pageNum, provider, extractMode]);

  // ── AI extraction (streaming) ──────────────────────────────────────────────
  const handleExtract = useCallback(async () => {
    if (!pdfDoc || extracting || pdfType === "scanned") return;
    setExtracting(true);
    setNounData(EMPTY_NOUNS());
    setNounPage(pageNum);
    setExtractError(""); setSavedId(null); setActiveHistoryId(null);

    try {
      const page    = await pdfDoc.getPage(pageNum);
      const content = await page.getTextContent();
      const text    = content.items.map((item) => item.str + (item.hasEOL ? "\n" : " ")).join("").trim();

      if (!text || text.replace(/\s/g, "").length < 80) {
        setExtractError("This page has no extractable text content.");
        setNounData(null);
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
              setNounData((prev) => {
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
        setManualNoun(dragText.toLowerCase().replace(/[.,;:]+$/, ""));
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
    const noun = manualNoun.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.,;:]+$/, "");
    if (!noun) return;

    setNounData((prev) => {
      const base = prev || EMPTY_NOUNS();
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
    if (!nounPage) setNounPage(pageNum);
    setManualPopup(null);
    setManualNoun("");
    window.getSelection()?.removeAllRanges();
  }, [manualNoun, manualCard, manualMode, nounPage, pageNum]);

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
    setManualNoun(noun);
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

  const handleNounStatus = useCallback((card, mode, index, newValue) => {
    setNounData((prev) => {
      const items  = [...prev[card][mode]];
      const next   = currentStatus(items[index]) === newValue ? "pending" : newValue;
      items[index] = { ...items[index], status: { value: next, at: new Date().toISOString() } };
      return { ...prev, [card]: { ...prev[card], [mode]: items } };
    });
  }, []);

  const handleNounDelete = useCallback((card, mode, index) => {
    setNounData((prev) => {
      const items = [...prev[card][mode]];
      items.splice(index, 1);
      return { ...prev, [card]: { ...prev[card], [mode]: reindex(items, card, mode) } };
    });
  }, []);

  const handleNounMove = useCallback((fromCard, fromMode, index, toCard, toMode) => {
    if (fromCard === toCard && fromMode === toMode) return;
    setNounData((prev) => {
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

  // ── Drag & drop ────────────────────────────────────────────────────────────
  const handleDrop        = useCallback((e) => { e.preventDefault(); setDragOver(false); loadFile(e.dataTransfer.files[0]); }, [loadFile]);
  const handleDragOver    = (e) => { e.preventDefault(); setDragOver(true); };
  const handleDragLeave   = () => setDragOver(false);
  const handleInputChange = (e) => loadFile(e.target.files[0]);

  const handleClose = () => {
    setPdfDoc(null); setFilename(""); setPageNum(1); setPageCount(0);
    setPdfType(null); setNounData(null); setNounPage(null);
    setExtractError(""); setSavedId(null); setActiveHistoryId(null);
    setPageViewport(null); setManualPopup(null); setZoom(1);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const router     = useHistory();
  const { card: urlCard } = useParams();
  const activeCard = CARDS.find((c) => c.key === urlCard)?.key || "objects";
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
            value={manualNoun}
            onChange={(e) => setManualNoun(e.target.value)}
            placeholder="Noun"
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
        <button id="pdf_home_btn" onClick={() => router.push("/home")} title="Home">⌂</button>
        {pdfDoc && <>
          <button onClick={() => setPageNum((n) => n - 1)} disabled={pageNum <= 1}>‹</button>
          <span>{pageNum} / {pageCount}</span>
          <button onClick={() => setPageNum((n) => n + 1)} disabled={pageNum >= pageCount}>›</button>
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
        </>}
      </div>

      {/* Split area */}
      <div id="pdf_content">

        {/* Left — PDF viewer or upload zone */}
        <div id="pdf_preview" ref={previewRef} className={previewOpen ? "" : "pdf_preview--closed"}>
          {pdfDoc ? (
            <div id="pdf_canvas_wrap">
              <canvas id="pdf_canvas" ref={canvasRef} />
              {/* Selection bar — absolute inside canvas wrap so it sits over the word */}
              {manualSelection && !manualPopup && (
                <div ref={selBarRef} id="manual_select_bar" style={{ left: manualSelection.x, top: manualSelection.y }}>
                  <button className="msb_btn" onClick={expandLeft}  disabled={manualSelection.startIdx === 0}>←</button>
                  <span id="msb_text">{manualSelection.text}</span>
                  <button className="msb_btn" onClick={expandRight} disabled={manualSelection.endIdx >= spansRef.current.length - 1}>→</button>
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

        {/* Right — Noun panel */}
        <div id="pdf_nouns_panel">

          <div id="pdf_nouns_panel_header">
            <button
              id="pdf_preview_toggle"
              onClick={() => setPreviewOpen((o) => !o)}
              title={previewOpen ? "Hide PDF viewer" : "Show PDF viewer"}
            >
              {previewOpen ? "‹" : "›"}
            </button>
            <span>
              {nounPage ? `Page ${nounPage} Nouns` : "Nouns"}
              {nounData?._total > 0 && (
                <span style={{ fontWeight: 400, marginLeft: "0.5rem", color: "var(--color-text-muted)" }}>
                  ({nounData._total} found)
                </span>
              )}
            </span>

            <div id="pdf_nouns_actions">
              {nounData && nounData._total > 0 && !extracting && (
                <button className={`pdf_action_btn${savedId ? " pdf_action_btn--saved" : ""}`} onClick={handleSave} disabled={saving}>
                  {saving ? "Saving…" : savedId ? "Saved" : "Save"}
                </button>
              )}
              <button id="pdf_sys_btn" onClick={() => setShowSysModal(true)}>System</button>

              {/* AI / Manual toggle */}
              <div id="pdf_mode_toggle">
                <button
                  className={`pdf_mode_btn${extractMode === "ai" ? " pdf_mode_btn--active" : ""}`}
                  onClick={() => { setExtractMode("ai"); setManualPopup(null); }}
                  disabled={extracting}
                >AI</button>
                <button
                  className={`pdf_mode_btn${extractMode === "manual" ? " pdf_mode_btn--active" : ""}`}
                  onClick={() => setExtractMode("manual")}
                  disabled={!pdfDoc}
                  title={!pdfDoc ? "Open a PDF first" : ""}
                >Manual</button>
              </div>

              {/* AI-only controls */}
              {extractMode === "ai" && (
                <>
                  <div id="pdf_provider_toggle">
                    <button className={`pdf_provider_btn${provider === "local"  ? " pdf_provider_btn--active" : ""}`} onClick={() => setProvider("local")}  disabled={extracting}>Local</button>
                    <button className={`pdf_provider_btn${provider === "openai" ? " pdf_provider_btn--active" : ""}`} onClick={() => setProvider("openai")} disabled={extracting}>OpenAI</button>
                  </div>
                  <button id="pdf_extract_btn" onClick={handleExtract} disabled={!canExtract || extracting} title={!canExtract ? "Open a text-based PDF first" : ""}>
                    {extracting ? "Extracting…" : pdfDoc ? `Extract Page ${pageNum}` : "Extract"}
                  </button>
                </>
              )}

              {/* Manual mode hint */}
              {extractMode === "manual" && pdfDoc && (
                <span id="pdf_manual_hint">Click a word to select it / drag to select multiple</span>
              )}
            </div>
          </div>

          {!extracting && extractError && (
            <div id="pdf_nouns_error">
              <span>⚠ {extractError}</span>
              {pdfDoc && extractMode === "ai" && <button onClick={handleExtract}>Retry</button>}
            </div>
          )}

          <div id="pdf_nouns_body">
            <div id="pdf_nouns_table_area">
              <NounCards
                data={nounData || EMPTY_NOUNS()}
                streaming={extracting}
                onStatus={handleNounStatus}
                onMove={handleNounMove}
                onDelete={handleNounDelete}
                activeCard={activeCard}
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
