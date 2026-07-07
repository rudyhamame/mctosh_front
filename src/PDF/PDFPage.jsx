import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import AIProviderSelect from "../App/AIProviderSelect";
import { useAIProvider } from "../hooks/useAIProvider";
import * as pdfjsLib from "pdfjs-dist";
import "./pdfPage.css";
import { apiUrl } from "../config/api";
import { readStoredSession } from "../utils/sessionCleanup";
import { useLongPressSelect } from "../utils/longPressSelect";
import HyleCards from "./HyleCards";
import SystemMessageModal from "./SystemMessageModal";
import { drawAnnotation } from "./annotationDraw";

pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

const PDF_TYPE_LABEL = {
  "text-based": "Text-based",
  "mixed":      "Mixed",
  "scanned":    "Scanned",
};

const PDF_TYPE_ICON = {
  "text-based": "fi-rr-check-circle",
  "mixed":      "fi-rr-triangle-warning",
  "scanned":    "fi-rr-image",
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

const ANNOT_HISTORY_META = {
  add:   { icon: "fi-rr-plus",       verb: "Added" },
  undo:  { icon: "fi-rr-undo",       verb: "Undid" },
  redo:  { icon: "fi-rr-redo",       verb: "Redid" },
  erase: { icon: "fi-rr-eraser",     verb: "Erased" },
  clear: { icon: "fi-rr-trash",      verb: "Cleared" },
};

const cleanMarkdownToPlainText = (text) => String(text || "")
  .replace(/```[\s\S]*?```/g, (block) => block.replace(/```/g, "").trim())
  .replace(/^\s{0,3}#{1,6}\s*/gm, "")
  .replace(/^\s*>\s?/gm, "")
  .replace(/^\s*[-*+]\s+/gm, "")
  .replace(/^\s*\d+\.\s+/gm, "")
  .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
  .replace(/(`)([^`]+)\1/g, "$2")
  .replace(/(\*\*\*|___)(.*?)\1/g, "$2")
  .replace(/(\*\*|__)(.*?)\1/g, "$2")
  .replace(/(\*|_)(.*?)\1/g, "$2")
  .replace(/^\s*---+\s*$/gm, "")
  .replace(/\n{3,}/g, "\n\n")
  .trim();

const PdfPlainTextView = ({ text, className = "" }) => {
  const cleaned = cleanMarkdownToPlainText(text);
  const paragraphs = cleaned ? cleaned.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean) : [];

  return (
    <div className={`pdf_plain_text ${className}`.trim()}>
      {paragraphs.length
        ? paragraphs.map((paragraph, idx) => (
            <p key={idx}>{paragraph}</p>
          ))
        : <p>(No AI-enhanced markdown was stored for this page.)</p>}
    </div>
  );
};

const renderOriginalMarkdownLine = (line, lineStart, voiceMatch) => {
  const headingMatch = line.match(/^(#{1,6})\s+/);
  const headingLevel = headingMatch ? headingMatch[1].length : 0;
  const nodes = [];
  let rawIndex = headingMatch ? headingMatch[0].length : 0;
  let key = 0;
  let bold = false;

  while (rawIndex < line.length) {
    const token = line.slice(rawIndex, rawIndex + 2);
    if (token === "**" || token === "__") {
      bold = !bold;
      rawIndex += 2;
      continue;
    }

    const globalIdx = lineStart + rawIndex;
    const isVoiceMatch = voiceMatch && globalIdx >= voiceMatch.start && globalIdx < voiceMatch.end;
    const classes = [
      isVoiceMatch ? "md_voice_hl" : null,
      bold ? "md_bold" : null,
    ].filter(Boolean);

    const ch = line[rawIndex];
    nodes.push(classes.length ? <span key={key++} className={classes.join(" ")}>{ch}</span> : ch);
    rawIndex += 1;
  }

  return {
    headingLevel,
    content: nodes.length ? nodes : " ",
    isRule: /^---+$/.test(line.trim()),
    isBlank: line.trim() === "",
  };
};

// Safari reports Apple-Pencil touches with Touch.touchType === "stylus" (vs.
// "direct" for a finger) — the only reliable signal we have to tell hand
// from pencil on a TouchEvent.
const isStylusTouch = (e) => Boolean(e.touches && e.touches[0] && e.touches[0].touchType === "stylus");

// Averages the pixels of the rendered PDF page canvas in a small square
// around (cx, cy) (canvas-pixel space) so "auto contrast" reacts to the
// actual local background rather than a single noisy pixel (e.g. one letter
// stroke in otherwise-white space).
const sampleAreaColor = (canvas, cx, cy, radius = 14) => {
  const x = Math.max(0, Math.round(cx - radius));
  const y = Math.max(0, Math.round(cy - radius));
  const w = Math.min(canvas.width  - x, radius * 2);
  const h = Math.min(canvas.height - y, radius * 2);
  if (w <= 0 || h <= 0) return { r: 255, g: 255, b: 255 };
  const { data } = canvas.getContext("2d").getImageData(x, y, w, h);
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
  return { r: r / n, g: g / n, b: b / n };
};

// WCAG relative luminance → picks whichever of pure black/white gives the
// higher contrast ratio against the sampled background (the theoretical
// best a single ink color can do).
const bestContrastColor = ({ r, g, b }) => {
  const toLinear = (c) => { const cs = c / 255; return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4); };
  const luminance = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  const contrastWithWhite = 1.05 / (luminance + 0.05);
  const contrastWithBlack = (luminance + 0.05) / 0.05;
  return contrastWithBlack > contrastWithWhite ? "#000000" : "#ffffff";
};
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 5;

// Compact draggable "knob" that replaces a native <input type="range"> for
// annotation size — the knob's own diameter grows/shrinks live with the
// value, so it previews the stroke/highlight/eraser size instead of just
// pointing at a number on a track.
const KNOB_MIN_PX  = 8;
const KNOB_MAX_PX  = 22;
const KNOB_PAD_PX  = 12;
const KNOB_TRACK_W = 64;

const SizeKnob = ({ min, max, step, value, onChange, color, dashed }) => {
  const trackRef = useRef(null);
  const draggingRef = useRef(false);

  const updateFromClientX = useCallback((clientX) => {
    const rect = trackRef.current.getBoundingClientRect();
    const usable = rect.width - KNOB_PAD_PX * 2;
    let frac = (clientX - rect.left - KNOB_PAD_PX) / usable;
    frac = Math.min(1, Math.max(0, frac));
    let val = min + frac * (max - min);
    val = Math.round(val / step) * step;
    val = Math.min(max, Math.max(min, val));
    onChange(val);
  }, [min, max, step, onChange]);

  const onPointerDown = (e) => {
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    updateFromClientX(e.clientX);
  };
  const onPointerMove = (e) => {
    if (!draggingRef.current) return;
    updateFromClientX(e.clientX);
  };
  const onPointerUp = (e) => {
    draggingRef.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const frac     = Math.min(1, Math.max(0, (value - min) / (max - min)));
  const knobSize = KNOB_MIN_PX + frac * (KNOB_MAX_PX - KNOB_MIN_PX);
  const centerX  = KNOB_PAD_PX + frac * (KNOB_TRACK_W - KNOB_PAD_PX * 2);

  return (
    <div className="annot_size_knob">
      <div
        className="annot_size_knob_track"
        ref={trackRef}
        style={{ width: KNOB_TRACK_W }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        title="Size"
      >
        <div className="annot_size_knob_fill" style={{ width: centerX }} />
        <div
          className={`annot_size_knob_dot${dashed ? " annot_size_knob_dot--eraser" : ""}`}
          style={{
            width: knobSize,
            height: knobSize,
            left: centerX,
            background: dashed ? "transparent" : color,
          }}
        />
      </div>
      {/* Shown in "pt" — the unit these tools' size is conventionally read in, same as font size */}
      <span className="annot_size_label">{Number.isInteger(value) ? value : value.toFixed(1)}pt</span>
    </div>
  );
};

// Same draggable-pill mechanics as SizeKnob, but the dot's diameter stays
// fixed and its CSS opacity varies instead — previewing highlight opacity
// directly rather than a size no one asked about.
const OPACITY_MIN_PCT = 10;
const OPACITY_MAX_PCT = 90;
const OpacityKnob = ({ value, onChange, color }) => {
  const trackRef = useRef(null);
  const draggingRef = useRef(false);

  const updateFromClientX = useCallback((clientX) => {
    const rect = trackRef.current.getBoundingClientRect();
    const usable = rect.width - KNOB_PAD_PX * 2;
    let frac = (clientX - rect.left - KNOB_PAD_PX) / usable;
    frac = Math.min(1, Math.max(0, frac));
    const val = Math.round(OPACITY_MIN_PCT + frac * (OPACITY_MAX_PCT - OPACITY_MIN_PCT));
    onChange(val);
  }, [onChange]);

  const onPointerDown = (e) => {
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    updateFromClientX(e.clientX);
  };
  const onPointerMove = (e) => {
    if (!draggingRef.current) return;
    updateFromClientX(e.clientX);
  };
  const onPointerUp = (e) => {
    draggingRef.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const frac    = Math.min(1, Math.max(0, (value - OPACITY_MIN_PCT) / (OPACITY_MAX_PCT - OPACITY_MIN_PCT)));
  const centerX = KNOB_PAD_PX + frac * (KNOB_TRACK_W - KNOB_PAD_PX * 2);

  return (
    <div
      className="annot_size_knob_track"
      ref={trackRef}
      style={{ width: KNOB_TRACK_W }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      title={`Opacity: ${value}%`}
    >
      <div className="annot_size_knob_fill" style={{ width: centerX }} />
      <div
        className="annot_size_knob_dot"
        style={{ width: 14, height: 14, left: centerX, background: color, opacity: value / 100 }}
      />
    </div>
  );
};

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

const PDFPage = ({
  embeddedSourceId = "",
  embeddedPdfName = "",
  embeddedFile = null,
  embeddedHomePath = "/hylomorphism",
  homeLabel = "Hyle-to-Meaning",   // tooltip for the ⌂ button when routed directly (not embedded)
  selectionOnly = false,           // hide Hyle-extraction/annotation chrome, force manual text-selection always on
  onSelectionAction = null,        // async (selectedText) => void — replaces the ✓ "add to Hyles" button in the selection bar
  selectionActionLabel = "Add",
  hideHyleControls = false,        // hide just the "Hyles" toggle + extraction panel (plain reading/annotation use, e.g. /pdf-reader)
}) => {
  const [pdfDoc, setPdfDoc]         = useState(null);
  const [filename, setFilename]     = useState("");
  const [pageNum, setPageNum]       = useState(1);
  const [pageCount, setPageCount]   = useState(0);
  const [pdfType, setPdfType]       = useState(null);
  const [loading, setLoading]       = useState(false);
  const [loadError, setLoadError]   = useState("");
  const [dragOver, setDragOver]     = useState(false);
  const [pageViewport, setPageViewport] = useState(null);
  const [zoom, setZoom]               = useState(1);
  const [splitRatio,     setSplitRatio]    = useState(1);
  const [mdPanelWidth,   setMdPanelWidth]  = useState(340); // resizable width of the Markdown/Actions left column
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
  const extractMode = selectionOnly ? "manual" : (provider === "manual" ? "manual" : "ai");
  // Click/tap-and-hold word selection is normally part of manual Hyle extraction
  // (always on there). A plain reader (Hyles hidden, e.g. /pdf-reader) only
  // gets it once the user explicitly turns on "Select Text" — off by default
  // so idle scrolling/reading never accidentally triggers a selection.
  const [selectTextMode, setSelectTextMode] = useState(false);
  const textSelectable = extractMode === "manual" || (hideHyleControls && selectTextMode);
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

  // ── Per-page Markdown preview (toolbar "MD" button + left column) ──────────
  // View-only here: converting a document to Markdown happens from the Sources
  // table (it's a whole-document operation, not a per-page one) — this button
  // just opens the reader for a document that's already been converted there.
  const [hasStoredMarkdown, setHasStoredMarkdown] = useState(false);
  const [hasStoredAiEnhancedMarkdown, setHasStoredAiEnhancedMarkdown] = useState(false);
  const [pageMdBusy,    setPageMdBusy]    = useState(false);
  const [pageMdError,   setPageMdError]   = useState("");
  const [pageMdOpen,    setPageMdOpen]    = useState(false);
  const [pageMdText,    setPageMdText]    = useState("");
  const [pageMdRange,   setPageMdRange]   = useState(null); // { from, to, all } — which range pageMdText is actually showing
  const [pageMdDeleteBusy, setPageMdDeleteBusy] = useState(false);
  const [mdPageIdx,     setMdPageIdx]     = useState(0); // index into mdPages — which single real page of the fetched range is displayed
  const [mdPageInputVal, setMdPageInputVal] = useState("1"); // editable page-number field's raw text, synced from mdCurrentPage.page
  const [pdfMdCountHighlight, setPdfMdCountHighlight] = useState(null); // null | "words" | "chars" — which markdown count is currently overlaid on the PDF page
  const [aiMdBusy, setAiMdBusy] = useState(false);
  const [aiMdOpen, setAiMdOpen] = useState(false);
  const [aiMdText, setAiMdText] = useState("");
  const [aiMdError, setAiMdError] = useState("");
  const [aiMdInfo, setAiMdInfo] = useState(null); // { page, provider, model }
  const [mdFontScale,   setMdFontScale]   = useState(1); // multiplier on the panel's base rem size — relative, so it scales with the root font-size same as everything else
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceQuery,     setVoiceQuery]     = useState("");
  const [voiceMatch,     setVoiceMatch]     = useState(null); // { start, end } char indices local to the displayed md page's text, or null
  const [voiceError,     setVoiceError]     = useState("");
  const voiceRecognitionRef = useRef(null);

  // Split the fetched range's Markdown into one chunk per real PDF page (the
  // server always tags each page with a "=== Page N ===" line via
  // pageMarkers=1) so the panel can show — and count — a single page at a
  // time instead of the whole range at once.
  const mdPages = useMemo(() => {
    const text = pageMdText || "";
    const re = /^=== Page (\d+) ===\r?\n?/gm;
    const marks = [...text.matchAll(re)];
    if (marks.length === 0) return text ? [{ page: pageMdRange?.from ?? pageNum, text, startOffset: 0 }] : [];
    return marks.map((m, i) => {
      const start = m.index + m[0].length;
      const end   = i + 1 < marks.length ? marks[i + 1].index : text.length;
      return { page: Number(m[1]), text: text.slice(start, end), startOffset: start };
    });
  }, [pageMdText, pageMdRange, pageNum]);

  // Which real page to land on once a fresh fetch's mdPages are ready — set
  // right before calling fetchMarkdownRange so the reset effect below can
  // jump straight to it instead of always defaulting to the first page.
  const mdFocusPageRef = useRef(null);
  useEffect(() => {
    const idx = mdFocusPageRef.current != null ? mdPages.findIndex((p) => p.page === mdFocusPageRef.current) : -1;
    setMdPageIdx(idx >= 0 ? idx : 0);
    mdFocusPageRef.current = null;
  }, [pageMdText]); // eslint-disable-line react-hooks/exhaustive-deps

  const mdCurrentPage = mdPages[mdPageIdx] || mdPages[0] || { page: pageNum, text: "", startOffset: 0 };
  useEffect(() => { setMdPageInputVal(String(mdCurrentPage.page)); }, [mdCurrentPage.page]);
  const mdChars = useMemo(() => Array.from(mdCurrentPage.text || ""), [mdCurrentPage]);
  const mdLines = useMemo(() => (mdCurrentPage.text || "").split("\n"), [mdCurrentPage]);
  const mdStats = useMemo(() => ({
    words: (mdCurrentPage.text.match(/\S+/g) || []).length,
    chars: mdChars.length,
  }), [mdCurrentPage, mdChars]);

  useEffect(() => {
    setAiMdOpen(false);
    setAiMdBusy(false);
    setAiMdText("");
    setAiMdError("");
    setAiMdInfo(null);
  }, [mdCurrentPage.page, pageMdText]);

  // Bring a page into view in the main reader — fired by the word/char
  // counter buttons and by the panel's own page navigation, so the reader
  // always shows the page currently displayed in the panel.
  const scrollReaderToPage = useCallback((page) => {
    pageContainerRefs.current[page - 1]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const showMarkdownPageInPdf = useCallback((mode) => {
    const targetPage = mdCurrentPage.page;
    setPdfMdCountHighlight((prev) => {
      const next = prev === mode ? null : mode;
      if (!next) return null;
      if (splitRatio === 0) setSplitRatio(savedRatioRef.current || 0.42);
      setPageNum(targetPage);
      setZoom(1);
      scrollReaderToPage(targetPage);
      return next;
    });
  }, [mdCurrentPage.page, scrollReaderToPage, splitRatio]);

  // ── Annotation History (toolbar "History" button + left column) ────────────
  // A running, in-session log of every annotation step taken (add/undo/redo/
  // clear), independent of the annotations themselves — so you can see what
  // you did and when, not just the current end result.
  const [annotHistory,     setAnnotHistory]     = useState([]);
  const [annotHistoryOpen, setAnnotHistoryOpen] = useState(false);
  const logAnnotHistory = useCallback((entry) => {
    setAnnotHistory((prev) => [...prev, { id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, time: new Date(), ...entry }].slice(-300));
  }, []);

  // ── Selection action (selectionOnly mode) ──────────────────────────────────
  const [selectionActionBusy,  setSelectionActionBusy]  = useState(false);
  const [selectionActionError, setSelectionActionError] = useState("");

  // ── Annotation state ──────────────────────────────────────────────────────
  const [annotTool,      setAnnotTool]      = useState(null);
  const [annotColor,     setAnnotColor]     = useState("#ffff00");
  const [annotSize,      setAnnotSize]      = useState(16);  // highlight lineWidth
  const [penSize,        setPenSize]        = useState(2);   // pen lineWidth
  const [eraserSize,     setEraserSize]     = useState(18);  // eraser radius
  const [highlightMode,  setHighlightMode]  = useState("freehand"); // "freehand" | "line"
  const [annotOpacity,      setAnnotOpacity]      = useState(35);    // % — highlight fill opacity
  const [toolsMenuOpen,  setToolsMenuOpen]  = useState(false); // floating tools dropdown
  const [colorMenuOpen,  setColorMenuOpen]  = useState(false); // floating color dropdown
  const toolsMenuRef = useRef(null);
  const colorMenuRef = useRef(null);
  // "Actions" toolbar dropdown (Markdown / Linguistic Analysis) + its page-range picker popover
  const [actionsMenuOpen,    setActionsMenuOpen]    = useState(false);
  const actionsMenuRef = useRef(null);
  const [rangePickerAction, setRangePickerAction]   = useState(null); // null | "markdown" | "linguistic"
  const [rangeFrom,          setRangeFrom]          = useState(1);
  const [rangeTo,            setRangeTo]            = useState(1);
  const [rangeAll,           setRangeAll]           = useState(false);
  // "Hand" mode: when on, a finger touch only pans/scrolls the page and
  // never draws — only the pencil (stylus, per Safari's Touch.touchType)
  // draws. Lets you rest your hand on the screen while sketching with an
  // Apple Pencil without fighting the page underneath.
  const [fingerScrollOnly, setFingerScrollOnly] = useState(false);
  const fingerScrollOnlyRef = useRef(false);
  useEffect(() => { fingerScrollOnlyRef.current = fingerScrollOnly; }, [fingerScrollOnly]);
  // Auto-contrast: pick the ink color (black/white) with the best contrast
  // against the page background right under where each stroke starts.
  const [autoContrast, setAutoContrast] = useState(false);
  const [annotations, setAnnotations] = useState({});   // { [pageNum]: [...] }
  const [redoStacks, setRedoStacks] = useState({});     // { [pageNum]: [...] } — annotations popped by Undo, available to Redo

  // Autosave the annotation session in the background — debounced so a whole
  // stroke's worth of state updates only writes once, a beat after the user
  // pauses. Server-side model (SourceAnnotation) already existed, just unused.
  useEffect(() => {
    if (skipNextAnnotationAutosaveRef.current) { skipNextAnnotationAutosaveRef.current = false; return; }
    const sourceId = currentSourceIdRef.current;
    if (!sourceId) return; // local/unsaved file — nothing to persist against
    const timer = setTimeout(() => {
      authFetch(apiUrl(`/api/source-annotations/${sourceId}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layers: annotations }),
      }).catch(() => {}); // best-effort background autosave — a failed write shouldn't interrupt reading/annotating
    }, 1500);
    return () => clearTimeout(timer);
  }, [annotations]);
  const [annotTextInput, setAnnotTextInput] = useState(null); // { vx, vy, cx, cy }
  const [annotTextVal,   setAnnotTextVal]   = useState("");
  const annotCanvasRef  = useRef(null);
  const activeAnnotRef  = useRef(null);  // in-progress shape

  // Close the floating tools/color/actions dropdowns on an outside click
  useEffect(() => {
    if (!toolsMenuOpen && !colorMenuOpen && !actionsMenuOpen) return;
    const onDocPointerDown = (e) => {
      if (toolsMenuOpen && toolsMenuRef.current && !toolsMenuRef.current.contains(e.target)) setToolsMenuOpen(false);
      if (colorMenuOpen && colorMenuRef.current && !colorMenuRef.current.contains(e.target)) setColorMenuOpen(false);
      if (actionsMenuOpen && actionsMenuRef.current && !actionsMenuRef.current.contains(e.target)) setActionsMenuOpen(false);
    };
    document.addEventListener("mousedown", onDocPointerDown);
    return () => document.removeEventListener("mousedown", onDocPointerDown);
  }, [toolsMenuOpen, colorMenuOpen, actionsMenuOpen]);

  // Per-page refs for continuous scroll
  const pageCanvasRefs    = useRef([]);
  const pageContainerRefs = useRef([]);
  const renderTasksRef    = useRef([]);
  const pageViewportsRef  = useRef([]);
  const renderedScaleRef  = useRef([]); // scale each page's canvas was last rendered at — lets us skip already-current pages
  const pageNumRef        = useRef(1);
  pageNumRef.current      = pageNum;  // sync during render

  // Proxy ref: always points to current page's PDF canvas
  const canvasRef = { get current() { return pageCanvasRefs.current[pageNumRef.current - 1] ?? null; } };

  const textLayerRef  = useRef(null);
  // Markdown panel's read-only text panes — selection only turns on after a
  // long press (see useLongPressSelect), so a quick click/scroll never
  // accidentally starts selecting.
  const mdTextRef        = useRef(null);
  const mdCompareTextRef = useRef(null);
  useLongPressSelect(mdTextRef);
  useLongPressSelect(mdCompareTextRef);
  const previewRef    = useRef(null);
  const canvasWrapRef = useRef(null);
  const fileInputRef  = useRef(null);
  const popupRef      = useRef(null);
  const selBarRef          = useRef(null);
  const spansRef           = useRef([]); // [{text, el}] built when text layer renders
  const scrollAfterZoomRef = useRef(null); // {left, top} to apply after zoom re-render
  const mouseDownPosRef    = useRef(null); // {x,y} at last mousedown — used to detect drag vs click
  const suppressTextSelectionRef = useRef(false);
  const lastLoadedSourceKeyRef = useRef("");
  const currentSourceIdRef = useRef(""); // the Source _id backing pdfDoc, if any (empty for local file uploads)
  const lastLoadedFileRef = useRef(null);
  const skipNextAnnotationAutosaveRef = useRef(false); // set right before restoring a saved session, so that restore doesn't immediately re-trigger the autosave effect below
  const wheelZoomStateRef  = useRef({
    baseZoom: 1,
    pendingZoom: 1,
    originX: 0,
    originY: 0,
    midX: 0,
    midY: 0,
    startSL: 0,
    startST: 0,
    timer: null,
  });

  const navigate = useNavigate();
  const location = useLocation();
  const { card: urlCard } = useParams();
  const embedded = Boolean(embeddedSourceId) || Boolean(embeddedFile); // true when mounted inside another page (e.g. Traces Collector) rather than routed directly
  const isNounsPage = !urlCard; // true when mounted at /hyles (no card in URL)
  const [localCard, setLocalCard] = useState("objects");
  const activeCard = isNounsPage
    ? localCard
    : (CARDS.find((c) => c.key === urlCard)?.key || "objects");
  const canExtract = Boolean(pdfDoc) && pdfType !== "scanned";

  // ── Sources list (for /hyles drop-zone replacement) ─────────────────────
  const [hyleSources,        setHyleSources]        = useState([]);
  const [hyleSourcesLoading, setHyleSourcesLoading] = useState(false);

  useEffect(() => {
    if (!isNounsPage) return;
    setHyleSourcesLoading(true);
    authFetch(apiUrl("/api/sources/"))
      .then((r) => r.json())
      .then((d) => setHyleSources((d.sources || []).filter((s) => /\.(pdf|docx?)$/i.test(s.name))))
      .catch(() => {})
      .finally(() => setHyleSourcesLoading(false));
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
  // Renders a single page at the current fitScale*zoom, skipping it if its
  // canvas is already up to date at that scale.
  const renderPage = useCallback(async (n) => {
    if (!pdfDoc) return;
    const canvas = pageCanvasRefs.current[n - 1];
    if (!canvas) return;
    const scale = fitScaleRef.current * zoom;
    if (renderedScaleRef.current[n - 1] === scale) return;
    const page     = await pdfDoc.getPage(n);
    const c        = pageCanvasRefs.current[n - 1];
    if (!c) return;
    const viewport = page.getViewport({ scale });
    pageViewportsRef.current[n - 1] = viewport;
    renderTasksRef.current[n - 1]?.cancel();
    c.width  = viewport.width;
    c.height = viewport.height;
    // Clear any temporary CSS pre-scale (see the zoom effect below) now that
    // the canvas's actual raster size matches the current zoom again.
    c.style.width  = "";
    c.style.height = "";
    const task = page.render({ canvasContext: c.getContext("2d"), viewport });
    renderTasksRef.current[n - 1] = task;
    renderedScaleRef.current[n - 1] = scale;
    task.promise.catch(err => { if (err?.name !== "RenderingCancelledException") console.error(err); });
    if (n === pageNumRef.current) setPageViewport(viewport);
  }, [pdfDoc, zoom]);

  // Full reset + initial render whenever a new document (or page count) loads.
  // Deliberately does NOT run on zoom changes (see the effect below) — this
  // used to fire on zoom too and reset renderedScaleRef to all-null every
  // time, which wiped out the "last actually-rendered scale" a never-visited
  // page needs to correctly rescale itself on the NEXT zoom tick (it would
  // read back as null and silently stop rescaling after the first tick).
  useEffect(() => {
    if (!pdfDoc || pageCount === 0) return;
    let cancelled = false;
    renderTasksRef.current.forEach(t => t?.cancel());
    renderTasksRef.current   = new Array(pageCount).fill(null);
    renderedScaleRef.current = new Array(pageCount).fill(null);

    // Embedded readers should preserve the PDF's original size instead of fitting to the container.
    pdfDoc.getPage(1).then(page1 => {
      if (cancelled) return;
      if (embedded) {
        fitScaleRef.current = 1;
      } else {
        const previewWidth = previewRef.current?.clientWidth || 480;
        fitScaleRef.current = Math.min(
          1,
          (previewWidth - 24) / page1.getViewport({ scale: 1 }).width,
        );
      }
      if (cancelled) return;
      renderPage(pageNumRef.current);
    });

    return () => { cancelled = true; renderTasksRef.current.forEach(t => t?.cancel()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- renderPage intentionally excluded, only pdfDoc/pageCount should reset the per-page render bookkeeping
  }, [pdfDoc, pageCount]);

  // Only the current page re-renders eagerly on zoom change; every other page
  // is instantly CSS-rescaled (approximate, no re-rasterization — cheap) and
  // lazily re-rendered for real by the IntersectionObserver below once it's
  // scrolled into view. Re-rasterizing every page on every zoom tick made
  // zooming a multi-page document slow; NOT touching renderedScaleRef here
  // (unlike the effect above) is what lets this compute the correct
  // cumulative rescale ratio across several zoom ticks in a row, even for a
  // page that's never actually revisited.
  useEffect(() => {
    if (!pdfDoc || pageCount === 0) return;
    const newScale = fitScaleRef.current * zoom;
    pageCanvasRefs.current.forEach((canvas, i) => {
      if (!canvas) return;
      const prevScale = renderedScaleRef.current[i];
      if (!prevScale || prevScale === newScale) return;
      const ratio = newScale / prevScale;
      canvas.style.width  = `${canvas.width  * ratio}px`;
      canvas.style.height = `${canvas.height * ratio}px`;
    });
    renderPage(pageNumRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only zoom should trigger this; renderPage/pdfDoc/pageCount changing here would re-run the doc-load effect above instead
  }, [zoom]);

  // Sync pageViewport when pageNum changes via scroll
  useEffect(() => {
    const vp = pageViewportsRef.current[pageNum - 1];
    if (vp) setPageViewport(vp);
  }, [pageNum]);

  // Keep refs in sync so event handlers always read the latest values
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);

  useEffect(() => () => {
    const state = wheelZoomStateRef.current;
    if (state.timer) clearTimeout(state.timer);
  }, []);

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
  // IntersectionObserver: update pageNum as user scrolls through pages, and
  // lazily (re)render any visible page left stale by a zoom/doc change.
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
          renderPage(n);
        }
        if (topmost !== null) setPageNum(topmost);
      },
      { root, rootMargin: "200px 0px", threshold: 0.15 }
    );
    pageContainerRefs.current.forEach((el, i) => {
      if (el) { el.dataset.page = String(i + 1); observer.observe(el); }
    });
    return () => observer.disconnect();
  }, [pdfDoc, pageCount, renderPage]);

  useEffect(() => { extractModeRef.current = extractMode; }, [extractMode]);
  useEffect(() => { if (!textSelectable) { setManualPopup(null); setManualSelection(null); } }, [textSelectable]);

  const textSelectableRef = useRef(false);
  useEffect(() => { textSelectableRef.current = textSelectable; }, [textSelectable]);

  const manualSelectionRef = useRef(null);
  const dragHandleRef      = useRef(null); // sync mirror of dragHandle state
  const onSelectionActionRef = useRef(onSelectionAction);
  useEffect(() => { manualSelectionRef.current = manualSelection; }, [manualSelection]);
  useEffect(() => { onSelectionActionRef.current = onSelectionAction; }, [onSelectionAction]);

  // ── Render annotation canvas ───────────────────────────────────────────────
  // Keyed off pageViewport (not zoom directly): renderPage() re-rasterizes the
  // real page canvas asynchronously (it awaits pdfDoc.getPage() before touching
  // canvas.width/height), so reading pc.width/height synchronously on a zoom
  // change would copy the STALE pre-zoom raster size while drawing at the NEW
  // scale — mismatched forever, since nothing re-ran this effect afterward.
  // pageViewport is set by renderPage() at the exact moment it resizes the
  // current page's canvas, so waiting for it keeps the two canvases in sync.
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
  }, [annotations, pageNum, pageViewport]);

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

    const onDown = (e) => {
      if (e.touches && e.touches.length >= 2) {
        activeAnnotRef.current = null; // cancel any in-progress stroke
        return;
      }
      if (fingerScrollOnly && e.touches && !isStylusTouch(e)) return; // hand mode: a finger only scrolls, never draws
      if (annotTool === "text") {
        const p = toCanvas(e);
        setAnnotTextInput({ vx: p.vx, vy: p.vy, cx: p.x, cy: p.y });
        setAnnotTextVal("");
        return;
      }
      const p = toCanvas(e);
      let strokeColor = annotColor;
      if (autoContrast && annotTool !== "eraser") {
        const pageCanvas = canvasRef.current;
        if (pageCanvas) {
          const scale = getScale();
          strokeColor = bestContrastColor(sampleAreaColor(pageCanvas, p.x * scale, p.y * scale));
          setAnnotColor(strokeColor);
        }
      }
      if (annotTool === "highlight") {
        activeAnnotRef.current = { type: "highlight", color: strokeColor, lineWidth: annotSize / getScale(), mode: highlightMode, opacity: annotOpacity / 100, points: [{ x: p.x, y: p.y }] };
      } else if (["underline","strikethrough","rect","circle"].includes(annotTool)) {
        activeAnnotRef.current = { type: annotTool, color: strokeColor, x: p.x, y: p.y, w: 0, h: 0, _sx: p.x, _sy: p.y };
      } else if (["line","arrow"].includes(annotTool)) {
        activeAnnotRef.current = { type: annotTool, color: strokeColor, x1: p.x, y1: p.y, x2: p.x, y2: p.y };
      } else if (annotTool === "pen") {
        activeAnnotRef.current = { type: "pen", color: strokeColor, lineWidth: penSize / getScale(), points: [{ x: p.x, y: p.y }] };
      } else if (annotTool === "eraser") {
        activeAnnotRef.current = { type: "eraser", erasedCount: 0 };
        const er = eraserSize / getScale();
        setAnnotations((prev) => {
          const pts = [...(prev[pageNum] || [])];
          const kept = pts.filter((a) => {
            if (a.type === "pen" || a.type === "highlight") return !a.points.some((pt) => Math.hypot(pt.x - p.x, pt.y - p.y) < er);
            const cx2 = (a.x ?? a.x1 ?? 0), cy2 = (a.y ?? a.y1 ?? 0);
            return Math.hypot(cx2 - p.x, cy2 - p.y) > er;
          });
          activeAnnotRef.current.erasedCount += pts.length - kept.length;
          return { ...prev, [pageNum]: kept };
        });
        setRedoStacks((prev) => (prev[pageNum]?.length ? { ...prev, [pageNum]: [] } : prev));
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
          const kept = pts.filter((a) => {
            if (a.type === "pen" || a.type === "highlight") return !a.points.some((pt) => Math.hypot(pt.x - p.x, pt.y - p.y) < er);
            const cx2 = (a.x ?? a.x1 ?? 0), cy2 = (a.y ?? a.y1 ?? 0);
            return Math.hypot(cx2 - p.x, cy2 - p.y) > er;
          });
          ann.erasedCount = (ann.erasedCount || 0) + (pts.length - kept.length);
          return { ...prev, [pageNum]: kept };
        });
        setRedoStacks((prev) => (prev[pageNum]?.length ? { ...prev, [pageNum]: [] } : prev));
      }
    };

    const onUp = () => {
      const ann = activeAnnotRef.current;
      activeAnnotRef.current = null;
      if (!ann) return;
      if (ann.type === "eraser") {
        if (ann.erasedCount > 0) logAnnotHistory({ action: "erase", page: pageNum, count: ann.erasedCount });
        return;
      }
      // ignore accidental tiny marks
      const tiny = ann.type === "pen"
        ? ann.points.length < 3
        : ["line","arrow"].includes(ann.type)
          ? Math.hypot(ann.x2 - ann.x1, ann.y2 - ann.y1) < 3
          : ann.w < 3 && ann.h < 3;
      if (tiny) return;
      const { _sx, _sy, ...clean } = ann;
      setAnnotations((prev) => ({ ...prev, [pageNum]: [...(prev[pageNum] || []), { ...clean, id: Date.now() }] }));
      setRedoStacks((prev) => (prev[pageNum]?.length ? { ...prev, [pageNum]: [] } : prev));
      logAnnotHistory({ action: "add", type: clean.type, page: pageNum, color: clean.color, size: clean.lineWidth ? Math.round(clean.lineWidth * (fitScaleRef.current * zoomRef.current)) : null });
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
  }, [annotTool, annotColor, annotSize, penSize, eraserSize, highlightMode, pageNum, annotations, fingerScrollOnly, autoContrast, annotOpacity, logAnnotHistory]);

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
    setRedoStacks((prev) => (prev[pageNum]?.length ? { ...prev, [pageNum]: [] } : prev));
    logAnnotHistory({ action: "add", type: "text", page: pageNum, color: annotColor });
    setAnnotTextInput(null); setAnnotTextVal("");
  }, [annotTextInput, annotTextVal, annotColor, pageNum, logAnnotHistory]);

  const handleAnnotUndo = useCallback(() => {
    const arr = annotations[pageNum] || [];
    if (arr.length === 0) return;
    const popped = arr[arr.length - 1];
    setAnnotations((prev) => ({ ...prev, [pageNum]: (prev[pageNum] || []).slice(0, -1) }));
    setRedoStacks((prev) => ({ ...prev, [pageNum]: [...(prev[pageNum] || []), popped] }));
    logAnnotHistory({ action: "undo", type: popped.type, page: pageNum });
  }, [pageNum, annotations, logAnnotHistory]);

  const handleAnnotRedo = useCallback(() => {
    const stack = redoStacks[pageNum] || [];
    if (stack.length === 0) return;
    const restored = stack[stack.length - 1];
    setRedoStacks((prev) => ({ ...prev, [pageNum]: prev[pageNum].slice(0, -1) }));
    setAnnotations((prev) => ({ ...prev, [pageNum]: [...(prev[pageNum] || []), restored] }));
    logAnnotHistory({ action: "redo", type: restored.type, page: pageNum });
  }, [pageNum, redoStacks, logAnnotHistory]);

  const handleAnnotClear = useCallback(() => {
    const count = (annotations[pageNum] || []).length;
    setAnnotations((prev) => ({ ...prev, [pageNum]: [] }));
    setRedoStacks((prev) => (prev[pageNum]?.length ? { ...prev, [pageNum]: [] } : prev));
    if (count > 0) logAnnotHistory({ action: "clear", page: pageNum, count });
  }, [pageNum, annotations, logAnnotHistory]);

  // ── Ctrl+Scroll to zoom ────────────────────────────────────────────────────
  useEffect(() => {
    const el = previewRef.current;
    if (!el || !pdfDoc) return;
    const commitWheelZoom = () => {
      const state = wheelZoomStateRef.current;
      const wrap = canvasWrapRef.current;
      if (state.timer) {
        clearTimeout(state.timer);
        state.timer = null;
      }
      if (!wrap) return;
      const finalZoom = state.pendingZoom;
      const ratio = finalZoom / state.baseZoom;
      scrollAfterZoomRef.current = {
        left: (state.startSL + state.midX) * ratio - state.midX,
        top: (state.startST + state.midY) * ratio - state.midY,
      };
      setZoom(finalZoom);
    };
    const onWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const wrap = canvasWrapRef.current;
      if (!wrap) return;
      const state = wheelZoomStateRef.current;
      const delta = e.deltaY < 0 ? 1.08 : 1 / 1.08;

      if (!state.timer) {
        state.baseZoom = zoomRef.current;
        state.pendingZoom = zoomRef.current;
        state.startSL = el.scrollLeft;
        state.startST = el.scrollTop;
      }

      state.midX = e.clientX - rect.left;
      state.midY = e.clientY - rect.top;
      const wrapRect = wrap.getBoundingClientRect();
      state.originX = e.clientX - wrapRect.left;
      state.originY = e.clientY - wrapRect.top;
      state.pendingZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, state.pendingZoom * delta));

      wrap.style.transformOrigin = `${state.originX}px ${state.originY}px`;
      wrap.style.transform = `scale(${state.pendingZoom / state.baseZoom})`;

      if (state.timer) clearTimeout(state.timer);
      state.timer = setTimeout(commitWheelZoom, 70);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      const state = wheelZoomStateRef.current;
      if (state.timer) {
        clearTimeout(state.timer);
        state.timer = null;
      }
      el.removeEventListener("wheel", onWheel);
    };
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
    let lastMidX  = 0, lastMidY  = 0; // continuously-updated pinch midpoint (relative to el) — tracks finger drift during the gesture instead of staying pinned to the gesture-start point
    // Fingers almost never lift simultaneously — after a pinch commits (first
    // finger up), the second finger is often still down for a moment, and
    // any movement/lift of THAT finger alone would otherwise be read as a
    // brand new one-finger pan/tap using stale/uninitialized reference
    // points. Ignore single-finger touch entirely for a short window right
    // after a pinch ends.
    const PINCH_COOLDOWN_MS = 350;
    let pinchCooldownUntil = 0;

    // Single-finger state
    let panX = 0, panY = 0, panSL = 0, panST = 0;
    let hasMoved = false;

    // Long-press + drag selection state
    let lpTimer = null;
    let isLpSelecting = false;
    let lpStartSpanIdx = -1;
    // Plain reader (Hyles hidden): a long-press locks onto exactly the one
    // word it landed on — tiny jitter while lifting the finger can't grow
    // it, but a deliberate drag past LP_EXPAND_THRESHOLD still extends it
    // (same continued touch, no need to find a drag handle).
    let lpWordLocked = false;
    let lpLockX = 0, lpLockY = 0;
    const LP_EXPAND_THRESHOLD = 14; // px of movement before a "settling" finger counts as an intentional drag

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
    // Captured ONCE at gesture start and reused for the whole gesture — el's
    // rect is stable regardless (transform is only applied to wrap, a
    // descendant, so it never affects el's own layout box), but wrap's rect
    // must NOT be re-read mid-gesture: once we start applying our own
    // translate+scale to wrap each frame, getBoundingClientRect() on it
    // would reflect THAT already-applied transform, corrupting the pivot
    // math every subsequent frame (this was causing the flicker/jitter).
    let gestureElRect = null, gestureWrapRect = null;

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
        gestureElRect   = elRect;
        gestureWrapRect = wrapRect;
        startMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - elRect.left;
        startMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - elRect.top;
        lastMidX  = startMidX;
        lastMidY  = startMidY;
        startSL   = el.scrollLeft;
        startST   = el.scrollTop;
        // Origin point in canvas-wrap space, used as the fixed pivot for the
        // translate+scale formula below — transform-origin itself stays at
        // "0 0" the whole gesture (see onTouchMove) so it never needs to
        // change mid-scale, which would itself cause a jump.
        pinchOriginX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - wrapRect.left;
        pinchOriginY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - wrapRect.top;
        const wrap = canvasWrapRef.current;
        if (wrap) wrap.style.transformOrigin = "0 0";
      } else if (e.touches.length === 1) {
        if (Date.now() < pinchCooldownUntil) return; // ignore — likely the 2nd finger of a pinch that just ended, not a real new touch
        if (fingerScrollOnlyRef.current && isStylusTouch(e)) return; // hand mode: the pencil never pans/selects, only draws
        panX = e.touches[0].clientX;
        panY = e.touches[0].clientY;
        panSL = el.scrollLeft;
        panST = el.scrollTop;
        hasMoved = false;
        isLpSelecting = false;
        lpWordLocked = false;

        if (textSelectableRef.current) {
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

              if (hideHyleControls) {
                // Plain reader: commit to exactly this word right now — no
                // "Add to Hyles" popup, just the ✓/✕ bar. Still draggable
                // past LP_EXPAND_THRESHOLD (see onTouchMove) to extend it.
                const text = sel.toString().replace(/\s+/g, " ").trim();
                if (text) {
                  const vr = range.getBoundingClientRect();
                  setManualSelection({ startIdx: loIdx, endIdx: hiIdx, text, x: vr.left + vr.width / 2, y: vr.bottom + 8 });
                }
                sel.removeAllRanges();
                lpWordLocked = true;
                lpStartSpanIdx = loIdx;
                lpLockX = ct.clientX;
                lpLockY = ct.clientY;
                navigator.vibrate?.(30);
                return;
              }
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
        const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, startZoom * touchDist(e.touches) / startDist));
        lastPinchZoom = newZoom;
        const factor = newZoom / startZoom;

        // Track the CURRENT midpoint (fingers rarely stay perfectly still
        // while pinching) so the content under them stays put even as they
        // drift — using a fixed transform-origin ("0 0", set once at
        // touchstart) plus an explicit translate computed from where the
        // origin-point has moved to, instead of moving transform-origin
        // itself mid-scale (which would jump, since re-anchoring an already
        // -scaled element relocates it).
        const curMidXWrap = (e.touches[0].clientX + e.touches[1].clientX) / 2 - gestureWrapRect.left;
        const curMidYWrap = (e.touches[0].clientY + e.touches[1].clientY) / 2 - gestureWrapRect.top;
        lastMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - gestureElRect.left;
        lastMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - gestureElRect.top;

        const tx = curMidXWrap - pinchOriginX * factor;
        const ty = curMidYWrap - pinchOriginY * factor;

        // CSS transform: instant visual scale (+ pan to follow drift), no React re-render
        const wrap = canvasWrapRef.current;
        if (wrap) {
          wrap.style.transform = `translate(${tx}px, ${ty}px) scale(${factor})`;
        }
        return;
      }
      if (e.touches.length !== 1) return;
      if (Date.now() < pinchCooldownUntil) return; // ignore — likely the 2nd finger of a pinch that just ended, not a real new touch
      if (fingerScrollOnlyRef.current && isStylusTouch(e)) return; // hand mode: the pencil never pans/selects, only draws

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

      // Plain reader: the word is locked in, but a deliberate drag (past a
      // small deadzone) still extends it — only jitter under the threshold
      // is ignored, so lifting the finger cleanly can't silently grow it.
      if (lpWordLocked) {
        e.preventDefault();
        const dx = e.touches[0].clientX - lpLockX;
        const dy = e.touches[0].clientY - lpLockY;
        if (Math.hypot(dx, dy) < LP_EXPAND_THRESHOLD) return;
        lpWordLocked = false;
        isLpSelecting = true;
        // fall through to the extend logic below using this same event
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
        pinchCooldownUntil = Date.now() + PINCH_COOLDOWN_MS;
        const wrap = canvasWrapRef.current;
        if (wrap && wrap.style.transform) {
          // Keep the CSS transform alive — useEffect([zoom]) will strip it atomically
          // with the scroll correction after the canvas re-renders, preventing any snap.
          const finalZoom = lastPinchZoom;
          const ratio     = finalZoom / startZoom;
          // Anchor to lastMidX/Y (where the fingers ended up), not
          // startMidX/Y (where they started) — otherwise any drift during
          // the gesture would be reflected in the live preview but then
          // snapped away the instant it commits to a real scroll position.
          scrollAfterZoomRef.current = {
            left: (startSL + startMidX) * ratio - lastMidX,
            top:  (startST + startMidY) * ratio - lastMidY,
          };
          setZoom(finalZoom);
        }
      }
      clearTimeout(lpTimer); lpTimer = null;

      // Word was already committed to manualSelection when the long-press
      // fired — nothing left to do but consume this touchend.
      if (lpWordLocked) { lpWordLocked = false; return; }

      if (isLpSelecting) {
        isLpSelecting = false;
        const sel  = window.getSelection();
        const text = sel?.toString().replace(/\s+/g, " ").trim();
        if (text) {
          const vr = sel.getRangeAt(0).getBoundingClientRect();
          if (onSelectionActionRef.current || hideHyleControls) {
            setManualSelection({ startIdx: -1, endIdx: -1, text, x: vr.left + vr.width / 2, y: vr.bottom + 8 });
          } else {
            const noun = text.toLowerCase().replace(/[.,;:]+$/, "").replace(/\s+/g, " ").trim();
            setManualHyle(noun);
            setManualPopup({
              x: vr.left + vr.width  / 2,
              y: vr.bottom + 10,
            });
          }
        }
        sel?.removeAllRanges();
        return;
      }

      if (textSelectableRef.current && !hasMoved && e.changedTouches.length === 1) {
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
    let armed = false;
    let startX = 0, startY = 0, scrollL = 0, scrollT = 0;
    const PAN_THRESHOLD = 6;

    const onMouseDown = (e) => {
      if (e.button !== 0) return;
      const tag = e.target.tagName;
      if (tag === "BUTTON" || tag === "SELECT" || tag === "INPUT" || tag === "A") return;
      if (e.target.closest?.(".sel_handle, #manual_select_bar, #annot_text_input")) return;

      armed = true;
      dragging = false;
      startX   = e.clientX;
      startY   = e.clientY;
      scrollL  = el.scrollLeft;
      scrollT  = el.scrollTop;
      suppressTextSelectionRef.current = false;
    };

    const onMouseMove = (e) => {
      if (!armed && !dragging) return;
      if (!dragging) {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (Math.hypot(dx, dy) < PAN_THRESHOLD) return;
        dragging = true;
        suppressTextSelectionRef.current = true;
        el.style.cursor = "grabbing";
        el.style.userSelect = "none";
      }
      if (!dragging) return;
      el.scrollLeft = scrollL - (e.clientX - startX);
      el.scrollTop  = scrollT - (e.clientY - startY);
      e.preventDefault();
    };

    const onMouseUp = () => {
      armed = false;
      if (!dragging) return;
      dragging            = false;
      el.style.cursor     = "";
      el.style.userSelect = "";
      requestAnimationFrame(() => {
        suppressTextSelectionRef.current = false;
      });
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

  // ── Render text layer for Manual mode (or a plain reader that still needs word-selection) ──
  useEffect(() => {
    const div = textLayerRef.current;
    if (!textSelectable || !pdfDoc || !div) return;
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
  }, [textSelectable, pdfDoc, pageNum, pageViewport]);

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
    currentSourceIdRef.current = ""; // caller (loadFromSource) sets this back if applicable
    setLoading(true);
    setLoadError("");
    setFilename(name);
    setPdfDoc(null); setPdfType(null);
    setHyleData(null); setHylePage(null);
    setExtractError(""); setSavedId(null); setActiveHistoryId(null);
    setPageNum(1); setPageViewport(null); setZoom(1);
    renderTasksRef.current.forEach(t => t?.cancel());
    pageCanvasRefs.current = []; pageContainerRefs.current = [];
    pageViewportsRef.current = []; renderTasksRef.current = []; renderedScaleRef.current = [];
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
      setLoadError("Could not open PDF.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadFile = useCallback(async (file) => {
    if (!file) return;
    if (file.type !== "application/pdf") {
      setLoadError("Please choose a PDF file.");
      return;
    }
    const arrayBuffer = await file.arrayBuffer();
    loadPdfBytes(arrayBuffer, file.name);
  }, [loadPdfBytes]);

  const loadFromSource = useCallback(async (sourceId, name) => {
    setLoading(true);
    setLoadError("");
    try {
      const res = await authFetch(apiUrl(`/api/sources/${sourceId}/download`));
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setLoadError(`Could not load PDF: ${data.error || res.status}`);
        setLoading(false);
        return;
      }
      const arrayBuffer = await res.arrayBuffer();
      await loadPdfBytes(arrayBuffer, name);
      currentSourceIdRef.current = sourceId;

      // Check (cheaply — no page param, but only reading the boolean) whether
      // this source was already converted to Markdown from the Sources table.
      setHasStoredMarkdown(false);
      setHasStoredAiEnhancedMarkdown(false);
      try {
        const srcRes = await authFetch(apiUrl(`/api/sources/${sourceId}`));
        if (srcRes.ok) {
          const srcData = await srcRes.json();
          const source = srcData.source || {};
          setHasStoredMarkdown(Boolean(source.markdown) || (Array.isArray(source.markdownPages) && source.markdownPages.some((page) => String(page || "").trim())));
          setHasStoredAiEnhancedMarkdown(
            Boolean(source.hasAiEnhancedMarkdown) ||
            Boolean(source.aiMarkdown) ||
            (Array.isArray(source.aiMarkdownPages) && source.aiMarkdownPages.some((page) => String(page || "").trim()))
          );
        }
      } catch {
        // best-effort — MD button just stays disabled if this check fails
      }

      // Restore any annotation session previously auto-saved for this source —
      // the SourceAnnotation model already existed server-side, just unused.
      try {
        const annRes = await authFetch(apiUrl(`/api/source-annotations/${sourceId}`));
        if (annRes.ok) {
          const annData = await annRes.json();
          skipNextAnnotationAutosaveRef.current = true; // suppress the autosave effect for this restore
          setAnnotations(annData.layers || {});
        }
      } catch {
        // best-effort restore — a failure here shouldn't block reading the PDF
      }
    } catch (err) {
      setLoadError(`Could not load PDF: ${err.message}`);
      setLoading(false);
    }
  }, [loadPdfBytes]);

  // ── Load from Sources page ────────────────────────────────────────────────
  useEffect(() => {
    if (embeddedSourceId) {
      const nextKey = `embedded:${embeddedSourceId}:${embeddedPdfName || "document.pdf"}`;
      if (lastLoadedSourceKeyRef.current === nextKey) return;
      lastLoadedSourceKeyRef.current = nextKey;
      loadFromSource(embeddedSourceId, embeddedPdfName || "document.pdf");
      return;
    }

    const { sourceId, pdfName } = location.state || {};
    if (!sourceId) return;
    const nextKey = `route:${sourceId}:${pdfName || "document.pdf"}`;
    if (lastLoadedSourceKeyRef.current === nextKey) return;
    lastLoadedSourceKeyRef.current = nextKey;
    loadFromSource(sourceId, pdfName || "document.pdf");
  }, [embeddedPdfName, embeddedSourceId, loadFromSource, location.state]);

  // ── Load a locally-picked file (embedded, no server round-trip) ────────────
  useEffect(() => {
    if (!embeddedFile || lastLoadedFileRef.current === embeddedFile) return;
    lastLoadedFileRef.current = embeddedFile;
    loadFile(embeddedFile);
  }, [embeddedFile, loadFile]);

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

  // Prefers the server-side LlamaParse Markdown for this page (better structure —
  // real headings/lists/tables) when the doc came from a saved Source; falls back
  // to raw client-side pdf.js text (local uploads, or if the markdown service is
  // unavailable/unconfigured/out of quota) so extraction never breaks.
  const getPageText = useCallback(async (n) => {
    const sourceId = currentSourceIdRef.current;
    if (sourceId) {
      try {
        const res  = await authFetch(apiUrl(`/api/sources/${sourceId}/markdown?page=${n}`));
        const data = await res.json();
        if (res.ok && data.markdown?.trim()) return data.markdown;
      } catch {}
    }
    const page    = await pdfDoc.getPage(n);
    const content = await page.getTextContent();
    return content.items.map((item) => item.str + (item.hasEOL ? "\n" : " ")).join("").trim();
  }, [pdfDoc]);

  // Shows a page range's (or the whole document's) Markdown in the left-side
  // column. View-only — never triggers a fresh conversion itself (the
  // Actions dropdown that calls this is only enabled once hasStoredMarkdown
  // is true; converting an unconverted source happens from the Sources
  // table). Reuses GET /api/sources/:id/markdown, now extended with
  // ?from=&to= for ranges alongside the existing ?page= and no-param forms.
  const fetchMarkdownRange = useCallback(async (from, to, isAll) => {
    const sourceId = currentSourceIdRef.current;
    if (!sourceId) return;
    setPageMdOpen(true);
    setPageMdBusy(true);
    setPageMdError("");
    setPdfMdCountHighlight(null);
    setVoiceMatch(null);
    setVoiceQuery("");
    setVoiceError("");
    try {
      // Always go through from/to (even for "All Pages") with pageMarkers=1 so
      // the panel can show a "=== Page N ===" divider between pages.
      const lo = isAll ? 1 : from;
      const hi = isAll ? pageCount : to;
      const res  = await authFetch(apiUrl(`/api/sources/${sourceId}/markdown?from=${lo}&to=${hi}&pageMarkers=1`), { signal: AbortSignal.timeout(5 * 60 * 1000) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load Markdown.");
      setPageMdText(data.markdown || "");
      setPageMdRange({ from: data.from ?? lo, to: data.to ?? hi, all: isAll });
    } catch (err) {
      setPageMdError(err.message);
      setPageMdText("");
      setPageMdRange(null);
    } finally {
      setPageMdBusy(false);
    }
  }, [pageCount]);

  // Jump the Markdown panel straight to a given real page — reuses it from
  // the already-fetched range if present (e.g. after "All Pages"), otherwise
  // fetches just that single page on demand. Either way, scrolls the main
  // reader to the same page so the two stay in sync.
  const goToMarkdownPage = useCallback((targetPage) => {
    const n = Math.max(1, Math.min(pageCount || targetPage, targetPage));
    scrollReaderToPage(n);
    const idx = mdPages.findIndex((p) => p.page === n);
    if (idx !== -1) {
      setMdPageIdx(idx);
    } else {
      mdFocusPageRef.current = n;
      fetchMarkdownRange(n, n, false);
    }
  }, [pageCount, mdPages, scrollReaderToPage, fetchMarkdownRange]);

  // Commits the panel's editable page-number field (blur / Enter).
  const commitMdPageInput = useCallback(() => {
    const n = parseInt(mdPageInputVal, 10);
    if (Number.isFinite(n)) goToMarkdownPage(n);
    else setMdPageInputVal(String(mdCurrentPage.page));
  }, [mdPageInputVal, goToMarkdownPage, mdCurrentPage]);

  // Fetches every page's Markdown in one go (it's already converted, so this
  // is just a read) and keeps whichever page is currently displayed in view.
  const showAllMarkdownPages = useCallback(() => {
    mdFocusPageRef.current = mdCurrentPage.page;
    fetchMarkdownRange(1, pageCount, true);
  }, [fetchMarkdownRange, pageCount, mdCurrentPage]);

  const handleDeleteMarkdownPage = useCallback(async () => {
    const sourceId = currentSourceIdRef.current;
    if (!sourceId || pageMdDeleteBusy) return;
    if (!window.confirm(`Delete cached markdown for page ${mdCurrentPage.page}? The PDF source will remain intact.`)) return;

    setPageMdDeleteBusy(true);
    setPageMdError("");
    try {
      const res = await authFetch(apiUrl(`/api/sources/${sourceId}/markdown?page=${mdCurrentPage.page}`), {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete this markdown page.");

      setHasStoredMarkdown(Boolean(data.hasMarkdown));
      setPdfMdCountHighlight(null);
      setVoiceMatch(null);
      setVoiceQuery("");
      setVoiceError("");
      mdFocusPageRef.current = mdCurrentPage.page;
      if (pageMdRange?.all) await fetchMarkdownRange(1, pageCount, true);
      else await fetchMarkdownRange(mdCurrentPage.page, mdCurrentPage.page, false);
    } catch (err) {
      setPageMdError(err.message);
    } finally {
      setPageMdDeleteBusy(false);
    }
  }, [authFetch, fetchMarkdownRange, mdCurrentPage.page, pageCount, pageMdDeleteBusy, pageMdRange]);

  const handleDeleteAllMarkdownPages = useCallback(async () => {
    const sourceId = currentSourceIdRef.current;
    if (!sourceId || pageMdDeleteBusy) return;
    if (!window.confirm("Delete all cached markdown pages for this source? The PDF itself will remain intact.")) return;

    setPageMdDeleteBusy(true);
    setPageMdError("");
    try {
      const res = await authFetch(apiUrl(`/api/sources/${sourceId}/markdown?all=1`), {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete all markdown pages.");

      setHasStoredMarkdown(false);
      setPageMdText("");
      setPageMdRange(null);
      setPdfMdCountHighlight(null);
      setVoiceMatch(null);
      setVoiceQuery("");
      setVoiceError("");
      setPageMdOpen(false);
    } catch (err) {
      setPageMdError(err.message);
    } finally {
      setPageMdDeleteBusy(false);
    }
  }, [pageMdDeleteBusy]);

  const handleShowEnhancedMarkdown = useCallback(async () => {
    const sourceId = currentSourceIdRef.current;
    if (!sourceId || !mdCurrentPage.text.trim() || aiMdBusy || !hasStoredAiEnhancedMarkdown) return;

    if (aiMdOpen && aiMdText && aiMdInfo?.page === mdCurrentPage.page) {
      setAiMdOpen(false);
      return;
    }

    setAiMdOpen(true);
    setAiMdBusy(true);
    setAiMdError("");
    setAiMdText("");
    setAiMdInfo(null);
    setMdPanelWidth((w) => Math.max(w, 720));

    try {
      const res = await authFetch(apiUrl(`/api/sources/${sourceId}/markdown-enhanced?page=${mdCurrentPage.page}`));
      const data = await res.json();
      const errorMessage = data?.error?.message || data?.error || "Failed to load enhanced markdown.";
      if (!res.ok) throw new Error(errorMessage);

      setAiMdText(String(data.markdown || "").trim());
      setAiMdInfo({
        page: mdCurrentPage.page,
        provider: data.provider || "Stored",
        model: data.model || "",
      });
    } catch (err) {
      setAiMdError(err.message);
    } finally {
      setAiMdBusy(false);
    }
  }, [aiMdBusy, aiMdInfo?.page, aiMdOpen, aiMdText, authFetch, hasStoredAiEnhancedMarkdown, mdCurrentPage.page, mdCurrentPage.text]);

  // Confirms the Actions-dropdown page-range picker for Linguistic Analysis
  // (the Markdown action now opens the panel directly — see the "Markdown"
  // dropdown item below — so this only ever handles the "linguistic" case).
  const confirmRangePicker = useCallback(() => {
    const from = rangeAll ? 1 : Math.max(1, Math.min(rangeFrom, rangeTo));
    const to   = rangeAll ? pageCount : Math.max(rangeFrom, rangeTo);
    navigate("/linguistic-analysis", {
      state: {
        sourceId: currentSourceIdRef.current,
        pdfName: filename,
        rangeFrom: from,
        rangeTo: to,
        rangeAll,
      },
    });
    setRangePickerAction(null);
  }, [rangeAll, rangeFrom, rangeTo, pageCount, navigate, filename]);

  // ── Select markdown text by voice (Web Speech API) ──────────────────────────
  const handleVoiceSelect = useCallback(() => {
    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      setVoiceError("Voice recognition isn't supported in this browser.");
      return;
    }
    if (voiceRecognitionRef.current) {
      voiceRecognitionRef.current.stop();
      return;
    }
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => { setVoiceListening(true); setVoiceError(""); };
    recognition.onerror = (e) => {
      setVoiceError(e.error === "no-speech" ? "Didn't catch that — try again." : `Voice error: ${e.error}`);
    };
    recognition.onend = () => { setVoiceListening(false); voiceRecognitionRef.current = null; };
    recognition.onresult = (e) => {
      const transcript = e.results[0][0].transcript.trim();
      setVoiceQuery(transcript);
      const idx = pageMdText.toLowerCase().indexOf(transcript.toLowerCase());
      if (idx === -1) {
        setVoiceMatch(null);
        setVoiceError(`"${transcript}" wasn't found in this range.`);
      } else {
        // Match is a global index into the whole fetched range — find which
        // page chunk it falls in, jump the panel there, then store the match
        // as an offset local to that page's text (what the renderer uses).
        const pIdx = mdPages.findIndex((p) => idx >= p.startOffset && idx < p.startOffset + p.text.length);
        const page = pIdx === -1 ? mdPages[0] : mdPages[pIdx];
        const localStart = idx - (page?.startOffset ?? 0);
        setMdPageIdx(pIdx === -1 ? 0 : pIdx);
        setVoiceMatch({ start: localStart, end: localStart + transcript.length });
        setVoiceError("");
      }
    };
    voiceRecognitionRef.current = recognition;
    recognition.start();
  }, [pageMdText, mdPages]);

  useEffect(() => {
    if (!voiceMatch) return;
    document.querySelector(".md_voice_hl")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [voiceMatch]);

  useEffect(() => {
    const layer = textLayerRef.current;
    const spans = spansRef.current;

    layer?.querySelectorAll(".pdf_md_count_highlight").forEach((el) => el.remove());
    if (!layer || !pdfMdCountHighlight || pageNum !== mdCurrentPage.page || spans.length === 0) return;

    const layerRect = layer.getBoundingClientRect();
    const bodyZoom = parseFloat(document.body.style.zoom) || 1;
    const lines = [];

    spans.forEach(({ el, text }) => {
      if (!el || !/\S/.test(text || "")) return;

      const r = el.getBoundingClientRect();
      const left = (r.left - layerRect.left) / bodyZoom;
      const top = (r.top - layerRect.top) / bodyZoom;
      const right = (r.right - layerRect.left) / bodyZoom;
      const bottom = (r.bottom - layerRect.top) / bodyZoom;
      const h = bottom - top;
      const padV = h * 0.25;

      let line = lines.find((l) => Math.abs(l.refTop - top) < Math.max(8, h * 0.5));
      if (!line) {
        line = { refTop: top, minL: Infinity, maxR: -Infinity, minT: Infinity, maxB: -Infinity };
        lines.push(line);
      }
      line.minL = Math.min(line.minL, left);
      line.maxR = Math.max(line.maxR, right);
      line.minT = Math.min(line.minT, top - padV);
      line.maxB = Math.max(line.maxB, bottom + padV);
    });

    for (const l of lines) {
      const rect = document.createElement("div");
      rect.className = "pdf_md_count_highlight";
      rect.style.position = "absolute";
      rect.style.left = `${l.minL}px`;
      rect.style.top = `${l.minT}px`;
      rect.style.width = `${l.maxR - l.minL}px`;
      rect.style.height = `${l.maxB - l.minT}px`;
      rect.style.background = pdfMdCountHighlight === "chars"
        ? "rgba(255, 167, 38, 0.28)"
        : "rgba(56, 139, 253, 0.28)";
      rect.style.borderRadius = "2px";
      rect.style.pointerEvents = "none";
      rect.style.zIndex = "1";
      layer.insertBefore(rect, layer.firstChild);
    }

    return () => { layer?.querySelectorAll(".pdf_md_count_highlight").forEach((el) => el.remove()); };
  }, [pdfMdCountHighlight, pageNum, mdCurrentPage.page, pageViewport]);

  // ── AI extraction (streaming) ──────────────────────────────────────────────
  const handleExtract = useCallback(async () => {
    if (!pdfDoc || extracting || pdfType === "scanned") return;
    setExtracting(true);
    setHyleData(EMPTY_HYLES());
    setHylePage(pageNum);
    setExtractError(""); setSavedId(null); setActiveHistoryId(null);

    try {
      const text = await getPageText(pageNum);

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
  }, [pdfDoc, pageNum, extracting, pdfType, provider, getPageText]);

  // ── Manual selection ───────────────────────────────────────────────────────
  const handleTextMouseDown = useCallback((e) => {
    mouseDownPosRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleTextSelection = useCallback((e) => {
    if (!textSelectable) return;
    if (suppressTextSelectionRef.current) return;
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
        if (onSelectionAction || hideHyleControls) {
          setManualSelection({ startIdx: -1, endIdx: -1, text: dragText, x: rect.left + rect.width / 2, y: rect.bottom + 8 });
        } else {
          setManualHyle(dragText.toLowerCase().replace(/[.,;:]+$/, ""));
          setManualPopup({ x: rect.left + rect.width / 2, y: rect.bottom + 10 });
        }
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
  }, [textSelectable, onSelectionAction]);

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

  const handleSelectionAction = useCallback(async () => {
    if (!manualSelection || !onSelectionAction || selectionActionBusy) return;
    setSelectionActionBusy(true);
    setSelectionActionError("");
    try {
      await onSelectionAction(manualSelection.text);
      setManualSelection(null);
      window.getSelection()?.removeAllRanges();
    } catch (e) {
      setSelectionActionError(e.message);
    } finally {
      setSelectionActionBusy(false);
    }
  }, [manualSelection, onSelectionAction, selectionActionBusy]);

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

  // Drag handle for the Markdown/Actions left column — width in px, not a ratio
  // (it sits alongside the PDF preview, not splitting against it 1:1).
  const handleMdPanelResizeStart = useCallback((e) => {
    e.preventDefault();
    const handleEl   = e.currentTarget;
    const startX     = e.touches ? e.touches[0].clientX : e.clientX;
    const startWidth = mdPanelWidth;
    handleEl.classList.add("pdf_md_panel_resize_handle--active");
    const onMove = (ev) => {
      const clientX = ev.touches ? ev.touches[0].clientX : ev.clientX;
      const next = Math.max(220, Math.min(720, startWidth + (clientX - startX)));
      setMdPanelWidth(next);
    };
    const onEnd = () => {
      handleEl.classList.remove("pdf_md_panel_resize_handle--active");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",   onEnd);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend",  onEnd);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onEnd);
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend",  onEnd);
  }, [mdPanelWidth]);

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

  // Zoom buttons (+/-/reset) previously just called setZoom directly, which
  // re-renders the canvas at a new size and leaves scrollLeft/scrollTop
  // unchanged in raw pixels — since the content underneath scaled, that
  // silently shifts what's actually visible (looks like the page "jumps"/
  // re-centers). Anchor on the viewport's center instead, reusing the same
  // scrollAfterZoomRef mechanism the ctrl+wheel/pinch zoom already uses to
  // keep the point under the cursor fixed — here the "point" is just the
  // middle of the visible area, so the page stays in place after zooming.
  const zoomFromCenter = (nextZoom) => {
    const el = previewRef.current;
    const baseZoom  = zoomRef.current;
    const rawTarget = typeof nextZoom === "function" ? nextZoom(baseZoom) : nextZoom;
    const clamped   = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, rawTarget));
    if (!el) { setZoom(clamped); return; }
    const ratio = clamped / baseZoom;
    const midX  = el.clientWidth  / 2;
    const midY  = el.clientHeight / 2;
    scrollAfterZoomRef.current = {
      left: (el.scrollLeft + midX) * ratio - midX,
      top:  (el.scrollTop  + midY) * ratio - midY,
    };
    setZoom(clamped);
  };

  const handleClose = () => {
    renderTasksRef.current.forEach(t => t?.cancel());
    pageCanvasRefs.current = []; pageContainerRefs.current = [];
    pageViewportsRef.current = []; renderTasksRef.current = []; renderedScaleRef.current = [];
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

  return (
    <div id="pdf_page" className={embedded ? "pdf_page--embedded" : undefined}>
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
        <button id="pdf_home_btn" onClick={() => navigate(embeddedHomePath)} title={embedded ? "Back to Traces Collector" : homeLabel}>⌂</button>
        {pdfDoc && <>
          <button onClick={() => pageContainerRefs.current[pageNum - 2]?.scrollIntoView({ behavior: "smooth", block: "start" })} disabled={pageNum <= 1}>‹</button>
          <span>{pageNum} / {pageCount}</span>
          <button onClick={() => pageContainerRefs.current[pageNum]?.scrollIntoView({ behavior: "smooth", block: "start" })} disabled={pageNum >= pageCount}>›</button>
          <span id="pdf_filename">{filename}</span>
          {pdfType && (
            <span className={`pdf_type_badge pdf_type_badge--${pdfType}`}>
              <i className={`fi ${PDF_TYPE_ICON[pdfType]}`} />
              {PDF_TYPE_LABEL[pdfType]}
            </span>
          )}
          <div id="pdf_zoom_controls">
            <button onClick={() => zoomFromCenter((z) => z / 1.25)} title="Zoom out">−</button>
            <button id="pdf_zoom_label" onClick={() => zoomFromCenter(1)} title="Reset zoom to original size">
              {Math.round(zoom * 100)}%
            </button>
            <button onClick={() => zoomFromCenter((z) => z * 1.25)} title="Zoom in">+</button>
          </div>
          {currentSourceIdRef.current && (
            <div className="annot_dd_wrap" ref={actionsMenuRef}>
              <button
                type="button"
                id="pdf_actions_btn"
                className={actionsMenuOpen ? "pdf_actions_btn--active" : ""}
                onClick={() => setActionsMenuOpen((o) => !o)}
                disabled={!hasStoredMarkdown || pageMdBusy}
                title={!hasStoredMarkdown ? "Not converted to Markdown yet — convert this document from the Sources table first" : "Markdown / Linguistic Analysis actions"}
              >
                <i className="fi fi-rr-menu-dots" /> Actions
              </button>
              {actionsMenuOpen && (
                <div className="annot_dd annot_dd--tools" id="pdf_actions_dd">
                  <button
                    type="button"
                    className="annot_dd_item"
                    onClick={() => { setActionsMenuOpen(false); mdFocusPageRef.current = pageNum; fetchMarkdownRange(pageNum, pageNum, false); }}
                  >
                    <i className="fi fi-rr-document" />
                    <span>Markdown</span>
                  </button>
                  <button
                    type="button"
                    className="annot_dd_item"
                    onClick={() => { setActionsMenuOpen(false); setRangeFrom(pageNum); setRangeTo(pageNum); setRangeAll(false); setRangePickerAction("linguistic"); }}
                  >
                    <i className="fi fi-rr-language" />
                    <span>Linguistic Analysis</span>
                  </button>
                </div>
              )}
              {rangePickerAction && (
                <div className="annot_dd" id="pdf_range_picker">
                  <div id="pdf_range_picker_title">Analyze Language</div>
                  <label id="pdf_range_all_row">
                    <input type="checkbox" checked={rangeAll} onChange={(e) => setRangeAll(e.target.checked)} />
                    All Pages ({pageCount})
                  </label>
                  {!rangeAll && (
                    <div id="pdf_range_inputs">
                      <label>
                        From
                        <input type="number" min={1} max={pageCount} value={rangeFrom} onChange={(e) => setRangeFrom(Math.max(1, Math.min(pageCount, Number(e.target.value) || 1)))} />
                      </label>
                      <label>
                        To
                        <input type="number" min={1} max={pageCount} value={rangeTo} onChange={(e) => setRangeTo(Math.max(1, Math.min(pageCount, Number(e.target.value) || 1)))} />
                      </label>
                    </div>
                  )}
                  <div id="pdf_range_actions">
                    <button type="button" className="annot_trigger" onClick={() => setRangePickerAction(null)}>Cancel</button>
                    <button type="button" className="annot_trigger annot_trigger--active" onClick={confirmRangePicker}>Analyze</button>
                  </div>
                </div>
              )}
            </div>
          )}
          {annotHistory.length > 0 && (
            <button
              id="pdf_annot_history_btn"
              className={annotHistoryOpen ? "pdf_annot_history_btn--active" : ""}
              onClick={() => setAnnotHistoryOpen((v) => !v)}
              title="Annotation History — every step taken this session"
            >
              <i className="fi fi-rr-time-past" /> History
            </button>
          )}
          <button id="pdf_close" onClick={handleClose}>✕</button>

          {/* Hyles toggle + extraction controls */}
          {!selectionOnly && !hideHyleControls && <>
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
        </>}
      </div>

      {/* Annotation toolbar — one compact row: a floating "Tools" dropdown
          (was a row of 10 always-visible icon buttons), a floating color
          swatch dropdown (was a row of 8 always-visible swatches, repeated
          again in the old separate highlight_panel below), an inline size
          slider + freehand/line toggle when relevant, and undo/clear. This
          replaces both the old #pdf_annot_toolbar AND the separate
          #highlight_panel entirely — one row instead of two. */}
      {pdfDoc && !selectionOnly && (() => {
        const activeToolMeta = ANNOT_TOOLS.find((t) => t.key === annotTool) || null;
        const hasSize = annotTool === "pen" || annotTool === "highlight" || annotTool === "eraser";
        const sizeProps =
          annotTool === "pen"     ? { min: 1, max: 20, step: 0.5, value: penSize,    onChange: setPenSize } :
          annotTool === "eraser"  ? { min: 6, max: 48, step: 2,   value: eraserSize, onChange: setEraserSize } :
          annotTool === "highlight" ? { min: 4, max: 64, step: 2, value: annotSize,  onChange: setAnnotSize } :
          null;
        return (
          <div id="pdf_annot_toolbar">
            <div className="annot_dd_wrap" ref={toolsMenuRef}>
              <button
                type="button"
                className={`annot_trigger${annotTool ? " annot_trigger--active" : ""}`}
                onClick={() => { setToolsMenuOpen((o) => !o); setColorMenuOpen(false); }}
              >
                <i className={`fi ${activeToolMeta?.icon || "fi-rr-pencil"}`} />
                <span className="annot_trigger_label">{activeToolMeta?.label || "Tools"}</span>
                <i className="fi fi-rr-angle-small-down annot_trigger_chevron" />
              </button>
              {toolsMenuOpen && (
                <div className="annot_dd annot_dd--tools">
                  {ANNOT_TOOLS.map(({ key, icon, label }) => (
                    <button
                      key={key}
                      type="button"
                      className={`annot_dd_item${annotTool === key ? " annot_dd_item--active" : ""}`}
                      onClick={() => { setAnnotTool((t) => t === key ? null : key); setToolsMenuOpen(false); }}
                    >
                      <i className={`fi ${icon}`} />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {annotTool && annotTool !== "eraser" && (
              <div className="annot_dd_wrap" ref={colorMenuRef}>
                <button
                  type="button"
                  className="annot_trigger annot_trigger--color"
                  onClick={() => { setColorMenuOpen((o) => !o); setToolsMenuOpen(false); }}
                  title="Color"
                >
                  <span className="annot_swatch" style={{ background: annotColor }} />
                  <i className="fi fi-rr-angle-small-down annot_trigger_chevron" />
                </button>
                {colorMenuOpen && (
                  <div className="annot_dd annot_dd--colors">
                    {ANNOT_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        className={`annot_swatch_btn${annotColor === c ? " annot_swatch_btn--active" : ""}`}
                        style={{ background: c }}
                        title={c}
                        onClick={() => { setAnnotColor(c); setColorMenuOpen(false); }}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {hasSize && (
              <SizeKnob
                min={sizeProps.min} max={sizeProps.max} step={sizeProps.step}
                value={sizeProps.value}
                onChange={sizeProps.onChange}
                color={annotColor}
                dashed={annotTool === "eraser"}
              />
            )}

            {annotTool === "highlight" && (
              <div className="annot_mode_toggle">
                <button
                  type="button"
                  className={`annot_mode_btn${highlightMode === "freehand" ? " annot_mode_btn--active" : ""}`}
                  onClick={() => setHighlightMode("freehand")}
                >Free</button>
                <button
                  type="button"
                  className={`annot_mode_btn${highlightMode === "line" ? " annot_mode_btn--active" : ""}`}
                  onClick={() => setHighlightMode("line")}
                >Line</button>
              </div>
            )}

            {annotTool === "highlight" && (
              <OpacityKnob value={annotOpacity} onChange={setAnnotOpacity} color={annotColor} />
            )}

            {annotTool && annotTool !== "eraser" && (
              <button
                type="button"
                className={`annot_trigger${autoContrast ? " annot_trigger--active" : ""}`}
                onClick={() => setAutoContrast((v) => !v)}
                title="Auto contrast: pick black or white ink, whichever reads best against the page under the stroke"
              >
                <i className="fi fi-rr-eye-dropper" />
                <span className="annot_trigger_label">Auto contrast</span>
              </button>
            )}

            {/* Page-level controls (not tool options) — pinned to the right */}
            <div id="pdf_annot_right_group">
              <button
                type="button"
                className={`annot_trigger${fingerScrollOnly ? " annot_trigger--active" : ""}`}
                onClick={() => setFingerScrollOnly((v) => !v)}
                title="Hand mode: finger only scrolls the page, the pencil draws"
              >
                <i className="fi fi-rr-hand" />
                <span className="annot_trigger_label">Hand</span>
              </button>

              {hideHyleControls && (
                <button
                  type="button"
                  className={`annot_trigger${selectTextMode ? " annot_trigger--active" : ""}`}
                  onClick={() => setSelectTextMode((v) => !v)}
                  title={selectTextMode ? "Select Text is on — tap/click and hold a word to select it" : "Turn on to select words by tapping/clicking and holding"}
                >
                  <i className="fi fi-rr-cursor-text" />
                  <span className="annot_trigger_label">Select Text</span>
                </button>
              )}

              <div id="pdf_annot_actions">
                <button className="annot_action_btn" onClick={handleAnnotUndo} title="Undo last" disabled={!(annotations[pageNum]?.length > 0)}><i className="fi fi-rr-undo" /></button>
                <button className="annot_action_btn" onClick={handleAnnotRedo} title="Redo" disabled={!(redoStacks[pageNum]?.length > 0)}><i className="fi fi-rr-redo" /></button>
                <button className="annot_action_btn" onClick={handleAnnotClear} title="Clear page" disabled={!(annotations[pageNum]?.length > 0)}><i className="fi fi-rr-trash" /></button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Split area */}
      <div id="pdf_content" ref={contentRef}>

        {/* Far left — Markdown preview column for the current page, opened by the toolbar "MD" button */}
        {pageMdOpen && (
          <div id="pdf_md_panel" style={{ width: mdPanelWidth }}>
            <div
              id="pdf_md_panel_resize_handle"
              onMouseDown={handleMdPanelResizeStart}
              onTouchStart={handleMdPanelResizeStart}
            />
            <div id="pdf_md_panel_header">
              <span>Markdown</span>
              <button id="pdf_md_panel_close" onClick={() => setPageMdOpen(false)} title="Close">✕</button>
            </div>
            {pageMdText && (
              <div id="pdf_md_pager">
                <div id="pdf_md_page_nav">
                  <button type="button" onClick={() => goToMarkdownPage(mdCurrentPage.page - 1)} disabled={mdCurrentPage.page <= 1} title="Previous page">‹</button>
                  <input
                    type="number"
                    min={1}
                    max={pageCount}
                    value={mdPageInputVal}
                    onChange={(e) => setMdPageInputVal(e.target.value)}
                    onBlur={commitMdPageInput}
                    onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                    title="Type a page number to jump straight to its Markdown"
                  />
                  <span id="pdf_md_page_nav_total">/ {pageCount}</span>
                  <button type="button" onClick={() => goToMarkdownPage(mdCurrentPage.page + 1)} disabled={mdCurrentPage.page >= pageCount} title="Next page">›</button>
                </div>
                <button
                  type="button"
                  id="pdf_md_all_pages_btn"
                  className={`pdf_md_icon_btn${pageMdRange?.all ? " pdf_md_all_pages_btn--active" : ""}`}
                  onClick={showAllMarkdownPages}
                  disabled={pageMdBusy || pageMdDeleteBusy || Boolean(pageMdRange?.all)}
                  title={pageMdRange?.all ? "Every page is already loaded" : "Load every page's Markdown so you can page through the whole document without re-fetching"}
                >
                  <i className="fi fi-rr-layers" /> {pageMdRange?.all ? "Loaded" : "All Pages"}
                </button>
                <button
                  type="button"
                  className="pdf_md_icon_btn pdf_md_delete_btn"
                  onClick={handleDeleteMarkdownPage}
                  disabled={pageMdBusy || pageMdDeleteBusy || !pageMdText}
                  title="Delete cached markdown for the currently displayed page"
                >
                  <i className={`fi ${pageMdDeleteBusy ? "fi-rr-spinner pdf_icon_spin" : "fi-rr-trash"}`} /> {pageMdDeleteBusy ? "Deleting…" : "Delete Page"}
                </button>
                <button
                  type="button"
                  className="pdf_md_icon_btn pdf_md_delete_btn pdf_md_delete_btn--all"
                  onClick={handleDeleteAllMarkdownPages}
                  disabled={pageMdBusy || pageMdDeleteBusy || !pageMdText}
                  title="Delete every cached markdown page for this source"
                >
                  <i className={`fi ${pageMdDeleteBusy ? "fi-rr-spinner pdf_icon_spin" : "fi-rr-trash"}`} /> {pageMdDeleteBusy ? "Deleting…" : "Delete All"}
                </button>
              </div>
            )}
            {!pageMdBusy && !pageMdError && pageMdText && (
              <div id="pdf_md_stats">
                <button
                  type="button"
                  className={`pdf_md_stat_btn${pdfMdCountHighlight === "words" ? " pdf_md_stat_btn--active" : ""}`}
                  onClick={() => showMarkdownPageInPdf("words")}
                  title="Show this markdown page in the PDF viewer and highlight the counted words there"
                >
                  <i className="fi fi-rr-text" /> {mdStats.words} words
                </button>
                <button
                  type="button"
                  className={`pdf_md_stat_btn${pdfMdCountHighlight === "chars" ? " pdf_md_stat_btn--active" : ""}`}
                  onClick={() => showMarkdownPageInPdf("chars")}
                  title="Show this markdown page in the PDF viewer and highlight the counted characters there"
                >
                  <i className="fi fi-rr-keyboard" /> {mdStats.chars} characters
                </button>
                <button
                  type="button"
                  id="pdf_md_voice_btn"
                  className={voiceListening ? "pdf_md_voice_btn--active" : ""}
                  onClick={handleVoiceSelect}
                  title="Select text by voice — say a word or phrase to find and highlight it"
                >
                  <i className="fi fi-rr-microphone" /> Voice
                </button>
                <button
                  type="button"
                  className={`pdf_md_icon_btn${aiMdOpen ? " pdf_md_icon_btn--active" : ""}`}
                  onClick={handleShowEnhancedMarkdown}
                  disabled={pageMdBusy || aiMdBusy || !mdCurrentPage.text.trim() || !hasStoredAiEnhancedMarkdown}
                  title={!hasStoredAiEnhancedMarkdown ? "No stored AI-enhanced markdown exists for this source yet" : "Show the stored AI-enhanced text for this page"}
                >
                  <i className={`fi ${aiMdBusy ? "fi-rr-spinner pdf_icon_spin" : "fi-rr-eye"}`} /> Enhanced Text
                </button>
                <div id="pdf_md_font_controls">
                  <button type="button" onClick={() => setMdFontScale((s) => Math.max(0.7, +(s - 0.1).toFixed(1)))} title="Smaller text" disabled={mdFontScale <= 0.7}>A−</button>
                  <span id="pdf_md_font_label">{Math.round(mdFontScale * 100)}%</span>
                  <button type="button" onClick={() => setMdFontScale((s) => Math.min(2, +(s + 0.1).toFixed(1)))} title="Larger text" disabled={mdFontScale >= 2}>A+</button>
                </div>
              </div>
            )}
            {(voiceListening || voiceQuery || voiceError) && (
              <div id="pdf_md_voice_status">
                {voiceListening ? "Listening…" : voiceError ? `⚠ ${voiceError}` : voiceQuery ? `Heard: "${voiceQuery}"${voiceMatch ? " — found" : ""}` : ""}
              </div>
            )}
            <div id="pdf_md_panel_body">
              {pageMdBusy ? (
                <p id="pdf_md_panel_status">Converting…</p>
              ) : pageMdError ? (
                <p id="pdf_md_panel_status" className="pdf_md_panel_status--error">⚠ {pageMdError}</p>
              ) : mdCurrentPage.text ? (
                <div className={`pdf_md_compare_layout${aiMdOpen ? " pdf_md_compare_layout--split" : ""}`}>
                  <section className="pdf_md_compare_col">
                    <div className="pdf_md_compare_head">
                      <span>Original Markdown</span>
                      <span className="pdf_md_compare_meta">Page {mdCurrentPage.page}</span>
                    </div>
                    <div id="pdf_md_panel_text" ref={mdTextRef} style={{ fontSize: `${0.8 * mdFontScale}rem` }}>
                      {(() => {
                        // Every source line break reads as its own paragraph here
                        // (a "\n" is a paragraph break, not just a wrapped line).
                        let offset = 0;
                        return mdLines.map((line, li) => {
                          const lineStart = offset;
                          const rendered = renderOriginalMarkdownLine(line, lineStart, voiceMatch);
                          offset += line.length + 1;
                          if (rendered.isRule) return <hr key={li} className="pdf_md_rule" />;
                          const lineClasses = [
                            "md_line",
                            rendered.isBlank ? "md_line--blank" : null,
                            rendered.headingLevel ? `md_heading md_heading--h${rendered.headingLevel}` : null,
                          ].filter(Boolean).join(" ");
                          return <div key={li} className={lineClasses}>{rendered.content}</div>;
                        });
                      })()}
                    </div>
                  </section>

                  {aiMdOpen && (
                    <section className="pdf_md_compare_col pdf_md_compare_col--ai">
                      <div className="pdf_md_compare_head">
                        <span>AI Enhanced</span>
                        <span className="pdf_md_compare_meta">
                          {aiMdBusy
                            ? "Thinking…"
                            : aiMdInfo?.model
                              ? `${aiMdInfo.provider} · ${aiMdInfo.model}`
                              : `Page ${mdCurrentPage.page}`}
                        </span>
                      </div>
                      {aiMdBusy ? (
                        <p id="pdf_md_panel_status">Loading enhanced text…</p>
                      ) : aiMdError ? (
                        <p id="pdf_md_panel_status" className="pdf_md_panel_status--error">⚠ {aiMdError}</p>
                      ) : aiMdText ? (
                        <div ref={mdCompareTextRef} style={{ fontSize: `${0.8 * mdFontScale}rem` }}>
                          <PdfPlainTextView text={aiMdText} className="pdf_md_panel_text_compare" />
                        </div>
                      ) : (
                        <p id="pdf_md_panel_status">Click Enhanced Text to show the stored AI-enhanced version for this page.</p>
                      )}
                    </section>
                  )}
                </div>
              ) : (
                <pre id="pdf_md_panel_text" style={{ fontSize: `${0.8 * mdFontScale}rem` }}>(This page had no extractable text.)</pre>
              )}
            </div>
          </div>
        )}

        {/* Far left — Annotation History column, opened by the toolbar "History" button */}
        {annotHistoryOpen && (
          <div id="pdf_annot_history_panel">
            <div id="pdf_annot_history_header">
              <span>Annotation History</span>
              <button id="pdf_annot_history_close" onClick={() => setAnnotHistoryOpen(false)} title="Close">✕</button>
            </div>
            <div id="pdf_annot_history_body">
              {[...annotHistory].reverse().map((h) => {
                const meta = ANNOT_HISTORY_META[h.action] || ANNOT_HISTORY_META.add;
                const toolLabel = ANNOT_TOOLS.find((t) => t.key === h.type)?.label || (h.type === "text" ? "Text" : h.type);
                return (
                  <div key={h.id} className="anh_row">
                    <i className={`fi ${meta.icon} anh_icon`} />
                    <div className="anh_main">
                      <span className="anh_label">
                        {meta.verb}{h.action === "clear" ? ` ${h.count} item${h.count === 1 ? "" : "s"}` : h.action === "erase" ? ` ${h.count} mark${h.count === 1 ? "" : "s"}` : toolLabel ? ` ${toolLabel}` : ""}
                      </span>
                      <span className="anh_meta">
                        p.{h.page} · {h.time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </span>
                    </div>
                    {h.color && <span className="anh_swatch" style={{ background: h.color }} />}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Left — PDF viewer or upload zone */}
        <div
          id="pdf_preview"
          ref={previewRef}
          style={{
            width: splitRatio === 0
              ? "0"
              : `calc(${splitRatio >= 0.9 ? 100 : splitRatio * 100}% - ${(pageMdOpen ? mdPanelWidth : 0) + (annotHistoryOpen ? 300 : 0)}px)`,
          }}
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
                          {onSelectionAction ? (
                            <button id="msb_confirm" className="msb_action_btn" onClick={handleSelectionAction} disabled={selectionActionBusy}>
                              {selectionActionBusy ? "…" : selectionActionLabel}
                            </button>
                          ) : (
                            <button id="msb_confirm" onClick={confirmSelection}>✓</button>
                          )}
                          <button id="msb_cancel"  onClick={() => { setManualSelection(null); setSelectionActionError(""); window.getSelection()?.removeAllRanges(); }}>✕</button>
                          {selectionActionError && <span id="msb_error">{selectionActionError}</span>}
                        </div>
                      )}
                      {textSelectable && (
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
          ) : embedded ? (
            <div id="pdf_source_select_zone">
              {loading ? <p>Loading…</p> : loadError ? (
                <>
                  <span id="pdf_source_empty_icon">⚠️</span>
                  <p id="pdf_source_empty_msg">{loadError}</p>
                  <button
                    id="pdf_pick_btn"
                    type="button"
                    onClick={() => {
                      if (embeddedFile) loadFile(embeddedFile);
                      else loadFromSource(embeddedSourceId, embeddedPdfName || "document.pdf");
                    }}
                  >Retry</button>
                </>
              ) : (
                <>
                  <span id="pdf_source_empty_icon">📄</span>
                  <p id="pdf_source_empty_msg">No document loaded.</p>
                </>
              )}
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
