import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import jsPDF from "jspdf";
import { apiUrl } from "../config/api";
import { readStoredSession } from "../utils/sessionCleanup";
import "./draftPage.css";

const authHeader = () => {
  const token = readStoredSession()?.token || "";
  return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
};

const AUTOSAVE_DELAY_MS = 1200;
// There's no standard CSS property to size the blinking caret directly —
// browsers derive its height from line-height, and Safari in particular
// stretches it to the *full* line-height box (unlike Chrome, which hugs the
// font's own metrics more closely), so a tall ratio makes the caret poke
// past its row instead of sitting inside it. Alignment only depends on
// line-height and the ruled-line spacing sharing the same computed pixel
// value (see the useLayoutEffect below) — not on what that value actually
// is — so this can be tightened freely to rein the caret in without ever
// breaking the rule alignment.
const LINE_HEIGHT_RATIO = 1.5;
const RULE_COLOR   = "color-mix(in srgb, var(--color-border) 85%, transparent)";
const MARGIN_COLOR = "color-mix(in srgb, var(--color-highlight) 55%, transparent)"; // the traditional red margin line, in the app's own accent
const PAGE_COLOR = "var(--color-surface)"; // the page itself, standing out against...
const DESK_COLOR  = "var(--color-bg)";     // ...the "desk" it sits on, and the gap drawn between stacked pages
const EDITOR_FONT_FAMILY = "Georgia, 'Iowan Old Style', 'Palatino Linotype', serif";
const DEFAULT_INDENT_LEVEL = 1; // every new paragraph starts pre-indented one step in, like a typeset paragraph — not flush left (level 0)

const FONT_FAMILY_OPTIONS = [
  { label: "Serif (default)", value: EDITOR_FONT_FAMILY },
  { label: "Sans-serif", value: "Arial, Helvetica, sans-serif" },
  { label: "Monospace", value: "'Courier New', Courier, monospace" },
  { label: "Handwriting", value: "'Segoe Script', 'Bradley Hand', cursive" },
];
const FONT_SIZE_OPTIONS = [12, 14, 16, 18, 20, 24, 28, 32, 40];
const MIN_SCALE = 0.5;
const MAX_SCALE = 2;
const DICTATION_COMMAND_PREFIX_RE = /^(command|editor|edit)\b[\s,:-]*/i;

const stripHtml = (html) => String(html || "").replace(/<[^>]+>/g, " ");
const DICTATION_FILLER_RE = /\b(uh|um|erm|er|ah|hmm|mm+|uhh+|umm+)\b/gi;
const DICTATION_FILLER_TEST_RE = /\b(uh|um|erm|er|ah|hmm|mm+|uhh+|umm+)\b/i;

const normalizeDictationText = (text) => String(text || "")
  .toLowerCase()
  .replace(DICTATION_FILLER_RE, " ")
  .replace(/[^\p{L}\p{N}\s]/gu, " ")
  .replace(/\s+/g, " ")
  .trim();

const dictationWordSet = (text) => new Set(normalizeDictationText(text).split(" ").filter(Boolean));

const dictationSimilarity = (a, b) => {
  const aWords = dictationWordSet(a);
  const bWords = dictationWordSet(b);
  if (!aWords.size || !bWords.size) return 0;
  let overlap = 0;
  aWords.forEach((word) => {
    if (bWords.has(word)) overlap += 1;
  });
  return overlap / Math.max(aWords.size, bWords.size);
};

const shouldReplacePreviousDictation = (previousText, currentText) => {
  const prev = normalizeDictationText(previousText);
  const curr = normalizeDictationText(currentText);
  if (!prev || !curr) return false;

  const prevWords = prev.split(" ").filter(Boolean);
  const currWords = curr.split(" ").filter(Boolean);
  if (prevWords.length < 5 || currWords.length < 5) return false;

  const similarity = dictationSimilarity(prev, curr);
  const closeInLength = currWords.length >= Math.max(4, prevWords.length - 3)
    && currWords.length <= prevWords.length + 5;

  return similarity >= 0.82 && closeInLength;
};

const shouldAutoCorrectDictation = (text) => {
  const raw = String(text || "").trim();
  if (!raw) return false;
  const normalized = normalizeDictationText(raw);
  const words = normalized ? normalized.split(" ").filter(Boolean) : [];
  return (
    DICTATION_FILLER_TEST_RE.test(raw) ||
    /\b[a-z]{1,2}\b(?:\s+\b[a-z]{1,2}\b){3,}/i.test(normalized) ||
    words.length >= 14
  );
};

// Measures how wide one indent step renders (4 spaces' worth) at a given
// font-size, in the editor's own font — so the default paragraph indent is
// an exact measurement, not an assumed em-multiple that could look right
// for one font and wrong for another.
const measureIndentUnitPx = (fontSizePx) => {
  const span = document.createElement("span");
  span.style.position = "absolute";
  span.style.visibility = "hidden";
  span.style.whiteSpace = "pre";
  span.style.fontFamily = EDITOR_FONT_FAMILY;
  span.style.fontSize = `${fontSizePx}px`;
  span.textContent = "    ";
  document.body.appendChild(span);
  const width = span.getBoundingClientRect().width;
  document.body.removeChild(span);
  return width;
};

// jsPDF only ships the core PDF fonts (no arbitrary web fonts without
// embedding a font file), so each of the editor's font choices maps to the
// closest match rather than rendering exactly — acceptable for a text
// export, unlike the on-screen editor where the real font matters visually.
const PDF_CORE_FONT_BY_FAMILY = (family) => {
  const f = String(family || "").toLowerCase();
  if (f.includes("courier")) return "courier";
  if (f.includes("arial") || f.includes("helvetica")) return "helvetica";
  return "times"; // serif default, and the closest available stand-in for the handwriting option too
};

const PX_TO_PT = 0.75; // CSS px are defined at 96/inch; PDF points are 72/inch

// The editor's base text color is a light, dark-theme-only screen affordance
// (var(--color-text)) — carrying it over as-is would print near-invisible
// light-gray text on a white page. Only an *explicit* inline color (one the
// user actually picked via the font-color tool) should survive into the
// PDF; anything else should fall back to plain black ink.
const findExplicitInlineColor = (el, block) => {
  let node = el;
  while (node && node.nodeType === Node.ELEMENT_NODE) {
    if (node.style?.color) return node.style.color;
    if (node === block) break;
    node = node.parentElement;
  }
  return null;
};

const getListMarker = (listEl, itemIndex) => {
  if (!listEl || listEl.tagName !== "OL") return "\u2022";
  const type = String(listEl.style?.listStyleType || "").toLowerCase();
  if (type.includes("alpha")) return `${String.fromCharCode(97 + (itemIndex % 26))}.`;
  return `${itemIndex + 1}.`;
};

const escapeRegExp = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeExtractedDraftHtml = (html) => {
  const raw = String(html || "").trim();
  if (!raw || typeof document === "undefined") return String(html || "");

  const host = document.createElement("div");
  host.innerHTML = raw;
  const topNodes = Array.from(host.childNodes);

  // Only normalize the legacy extraction shape: lots of top-level <div> line
  // blocks with optional page-break markers between them. Real authored
  // drafts/lists/tables should be left untouched.
  const looksLikeLegacyExtraction = topNodes.length > 0 && topNodes.every((node) => {
    if (node.nodeType === Node.TEXT_NODE) return !String(node.textContent || "").trim();
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    if (node.classList.contains("draft_page_break_marker")) return true;
    return node.tagName === "DIV" && !node.querySelector("ul,ol,table,blockquote,pre,h1,h2,h3,h4,h5,h6");
  });
  if (!looksLikeLegacyExtraction) return String(html || "");

  const out = document.createElement("div");
  let paragraphLines = [];

  const flushParagraph = () => {
    if (!paragraphLines.length) return;
    const block = document.createElement("div");
    block.innerHTML = paragraphLines.join("<br />");
    out.appendChild(block);
    paragraphLines = [];
  };

  topNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = String(node.textContent || "").trim();
      if (text) paragraphLines.push(text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"));
      return;
    }

    if (node.classList?.contains("draft_page_break_marker")) {
      flushParagraph();
      out.appendChild(node.cloneNode(true));
      return;
    }

    const inner = String(node.innerHTML || "").trim();
    const plain = String(node.textContent || "").replace(/\u00a0/g, " ").trim();
    const isBlank = !plain && /^(<br\s*\/?>)?$/i.test(inner);
    if (isBlank) {
      flushParagraph();
      return;
    }

    paragraphLines.push(inner || plain.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"));
  });

  flushParagraph();
  return out.innerHTML || String(html || "");
};

// Renders the live, styled editor DOM into a paginated PDF — walking the
// actual computed styles of each text node (so nested spans, e.g. a bold
// run inside a colored one, resolve correctly via normal CSS inheritance)
// rather than re-deriving formatting from the raw HTML string.
const buildDocumentPdf = (editorEl, title, format = "letter") => {
  const doc = new jsPDF({ unit: "pt", format });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginPt = 54; // 0.75in
  const maxX = pageWidth - marginPt;
  let y = marginPt;

  const newPageIfNeeded = (lineHeightPt) => {
    if (y + lineHeightPt > pageHeight - marginPt) {
      doc.addPage();
      y = marginPt;
    }
  };

  doc.setFont("times", "bold");
  doc.setFontSize(16);
  doc.text(title || "Untitled Document", marginPt, y);
  y += 26;

  const renderTextBlock = (block, extraIndentPx = 0, marker = "") => {
    const isElement = block.nodeType === Node.ELEMENT_NODE;
    const indentPx = (isElement ? parseFloat(block.style?.marginLeft) || 0 : 0) + extraIndentPx;
    const indentPt = indentPx * PX_TO_PT;
    const markerGap = marker ? doc.getTextWidth(`${marker} `) : 0;
    let x = marginPt + indentPt;
    let lineHeightPt = 14;
    let sawAnyText = false;

    if (marker) {
      doc.setFont("times", "normal");
      doc.setFontSize(12);
      doc.setTextColor(0, 0, 0);
      doc.text(marker, x, y);
      x += markerGap;
    }

    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let textNode;
    while ((textNode = walker.nextNode())) {
      const raw = textNode.textContent;
      if (!raw) continue;
      const el = textNode.parentElement || block;
      const cs = window.getComputedStyle(el);
      const bold = parseInt(cs.fontWeight, 10) >= 600 || cs.fontWeight === "bold";
      const italic = cs.fontStyle === "italic";
      const underline = cs.textDecorationLine?.includes("underline");
      const fontSizePt = (parseFloat(cs.fontSize) || 18) * PX_TO_PT;
      const font = PDF_CORE_FONT_BY_FAMILY(cs.fontFamily);
      const style = bold && italic ? "bolditalic" : bold ? "bold" : italic ? "italic" : "normal";
      const explicitColor = findExplicitInlineColor(el, block);
      const colorMatch = explicitColor ? (cs.color.match(/\d+/g) || [0, 0, 0]) : [0, 0, 0];
      const bgColor = cs.backgroundColor;
      const bgMatch = bgColor && !bgColor.includes("0, 0, 0, 0") && bgColor !== "transparent" ? bgColor.match(/\d+/g) : null;

      doc.setFont(font, style);
      doc.setFontSize(fontSizePt);
      lineHeightPt = Math.max(lineHeightPt, fontSizePt * 1.35);

      const words = raw.split(/(\s+)/).filter((w) => w.length);
      words.forEach((word) => {
        if (/^\s+$/.test(word)) {
          x += doc.getTextWidth(" ");
          return;
        }
        sawAnyText = true;
        const width = doc.getTextWidth(word);
        if (x + width > maxX) {
          x = marginPt + indentPt + markerGap;
          y += lineHeightPt;
          newPageIfNeeded(lineHeightPt);
        }
        if (bgMatch) {
          doc.setFillColor(Number(bgMatch[0]), Number(bgMatch[1]), Number(bgMatch[2]));
          doc.rect(x, y - fontSizePt * 0.82, width, fontSizePt * 1.05, "F");
        }
        doc.setTextColor(Number(colorMatch[0]), Number(colorMatch[1]), Number(colorMatch[2]));
        doc.text(word, x, y);
        if (underline) doc.line(x, y + 2, x + width, y + 2);
        x += width;
      });
    }

    y += lineHeightPt || 18;
    newPageIfNeeded(lineHeightPt);
    if (!sawAnyText) y += 4;
  };

  const walkBlocks = (nodes, extraIndentPx = 0) => {
    Array.from(nodes).forEach((block) => {
      if (block.nodeType !== Node.ELEMENT_NODE) {
        renderTextBlock(block, extraIndentPx);
        return;
      }
      // Text Extraction inserts one of these before every PDF source page
      // after the first (see PDFPage's openMarkdownAsDraft) — it's a real
      // forced page break here (its own "— Page N —" label is only a
      // screen-side aid, not printed), so the exported PDF's pages line up
      // with the original PDF's pages one-to-one.
      if (block.dataset?.pageBreak === "1") {
        doc.addPage();
        y = marginPt;
        return;
      }
      if (block.tagName === "UL" || block.tagName === "OL") {
        Array.from(block.children).forEach((item, index) => {
          renderTextBlock(item, extraIndentPx + 18, getListMarker(block, index));
          Array.from(item.children)
            .filter((child) => child.tagName === "UL" || child.tagName === "OL")
            .forEach((nested) => walkBlocks([nested], extraIndentPx + 30));
        });
        return;
      }
      renderTextBlock(block, extraIndentPx);
    });
  };

  walkBlocks(editorEl.childNodes);

  // Footer page numbers — added in a second pass since the total page count
  // isn't known until everything above has actually been laid out.
  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(140, 140, 140);
    doc.text(`Page ${i} of ${totalPages}`, pageWidth / 2, pageHeight - 24, { align: "center" });
  }
  doc.setPage(totalPages);

  return doc;
};

const PAGE_SIZE_OPTIONS = [
  { label: "Letter", value: "letter" },
  { label: "A4", value: "a4" },
  { label: "Legal", value: "legal" },
  { label: "A5", value: "a5" },
  { label: "Tabloid", value: "tabloid" },
];

// Real physical page dimensions, in inches — the same names jsPDF's own
// `format` option accepts, so the live editor and the exported/emailed PDF
// always agree on what e.g. "A4" actually means.
const PAGE_DIMENSIONS_IN = {
  letter:  { w: 8.5,  h: 11 },
  a4:      { w: 8.27, h: 11.69 },
  legal:   { w: 8.5,  h: 14 },
  a5:      { w: 5.83, h: 8.27 },
  tabloid: { w: 11,   h: 17 },
};
const CSS_PX_PER_IN = 96;
const PAGE_GAP_EXTRA_PX = 12; // small cosmetic buffer on top of the real margins, at scale 1

// Thin wrapper so switching between documents (id changes) fully remounts
// the editor below — undo/redo stacks, autosave refs, and DOM state are all
// per-document and must never bleed from one document into another.
const DraftPage = () => {
  const { id } = useParams();
  return <DraftEditor key={id} id={id} />;
};

const DraftEditor = ({ id }) => {
  const navigate = useNavigate();
  const [content, setContent]   = useState(""); // HTML — this is a rich-text editor now, not plain text
  const [title, setTitle]       = useState("Untitled Document");
  const [titleDraft, setTitleDraft] = useState(""); // editable value in the header's rename input, while it's focused
  const [renamingTitle, setRenamingTitle] = useState(false);
  const [loading, setLoading]   = useState(true);
  const [loadError, setLoadError] = useState("");
  // Set only for drafts spun off from a PDF's Markdown (PDFPage's Actions ->
  // Markdown) — lets this page render a link back to the exact page it came
  // from, the other half of the "back and forth" between the two.
  const [sourceId, setSourceId]     = useState(null);
  const [sourcePage, setSourcePage] = useState(null);
  const [sourceName, setSourceName] = useState("");
  const [status, setStatus]     = useState(""); // "" | "saving" | "saved" | "error"
  const [exportBusy, setExportBusy] = useState(null); // "pdf" | "email" | null
  const [exportError, setExportError] = useState("");
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [pageFormat, setPageFormat] = useState("letter");
  const [marginTopIn, setMarginTopIn] = useState(1);
  const [marginRightIn, setMarginRightIn] = useState(1);
  const [marginBottomIn, setMarginBottomIn] = useState(1);
  const [marginLeftIn, setMarginLeftIn] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [currentPageNum, setCurrentPageNum] = useState(1);
  const pageStackRef = useRef(null); // the scrollable "desk" wrapper around the fixed-size page
  const [scale, setScale]       = useState(1);
  const pinchZoomRef = useRef(null); // active two-finger pinch state for the page stack
  const pinchScrollAfterScaleRef = useRef(null); // scroll correction applied after the scale-driven re-layout lands
  const [lineHeightPx, setLineHeightPx] = useState(27); // measured from the real rendered font-size below — never guessed
  const [indentUnitPx, setIndentUnitPx] = useState(24); // measured width of one indent step, in the editor's own font
  const [fontSize, setFontSize] = useState(18);
  const [fontColor, setFontColor] = useState("#e0e0e0");
  const [highlightColor, setHighlightColor] = useState("#ffca28");
  const [aiToolBusy, setAiToolBusy] = useState(null); // "summarize" | "enhance" | "correct" | null
  const [aiToolError, setAiToolError] = useState("");
  const [isDictating, setIsDictating] = useState(false);
  const [dictationError, setDictationError] = useState("");
  const [dictationLangEn, setDictationLangEn] = useState(true);
  const [dictationLangAr, setDictationLangAr] = useState(false);
  const [isRtl, setIsRtl] = useState(false);

  const editorRef       = useRef(null);
  const contentRef      = useRef("");   // latest content, kept in sync for the unmount-flush effect below (avoids a stale closure)
  const savedContentRef = useRef("");   // last content confirmed saved on the server
  const normalizedContentSaveRef = useRef(""); // one-time normalized import HTML that should be persisted after load
  const saveTimerRef    = useRef(null);
  const savingRef       = useRef(false);
  const dictationPcRef     = useRef(null); // RTCPeerConnection to OpenAI's Realtime API
  const dictationDcRef     = useRef(null); // its data channel, carrying transcription events
  const dictationStreamRef = useRef(null); // the raw mic MediaStream, so its tracks can be stopped
  const liveDictationSpanRef = useRef(null); // the <span> currently accumulating one in-progress utterance's streamed text
  const lastDictationTextNodeRef = useRef(null); // last finalized dictated text node, for "I said that again" replacement
  const lastDictationTranscriptRef = useRef(""); // raw finalized transcript, before any cleanup pass

  // Custom undo/redo history — NOT the browser's native execCommand undo.
  // This editor mixes execCommand-based formatting with raw DOM mutations
  // (the default indent sets style.marginLeft/Right directly; AI replace
  // uses Range.deleteContents/insertNode) that the native undo stack doesn't
  // track as proper transactions, so relying on execCommand("undo") skips
  // over those edits unpredictably and can even duplicate content on redo.
  // Snapshotting innerHTML ourselves after every committed change sidesteps
  // that entirely — one array of past HTML strings, one array of undone
  // ones, both fully in our control regardless of *how* the DOM changed.
  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);
  const undoBatchOpenRef = useRef(false); // true while rapid changes (e.g. typing) are still being grouped into the current undo step
  const undoBatchTimerRef = useRef(null);
  const applyingHistoryRef = useRef(false); // true while WE are setting innerHTML from undo/redo, so it isn't re-snapshotted as a new edit
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(apiUrl(`/api/draft/${id}`), { headers: authHeader() })
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (!ok) throw new Error(data.error || "Failed to load your document.");
        const rawContent = data.content || "";
        const normalizedContent = data.sourceId ? normalizeExtractedDraftHtml(rawContent) : rawContent;
        normalizedContentSaveRef.current = normalizedContent !== rawContent ? normalizedContent : "";
        setContent(normalizedContent);
        contentRef.current = normalizedContent;
        savedContentRef.current = rawContent;
        setTitle(data.title || "Untitled Document");
        setSourceId(data.sourceId || null);
        setSourcePage(data.sourcePage ?? null);
        setSourceName(data.sourceName || "");
      })
      .catch((err) => { if (!cancelled) setLoadError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  // The ruled lines must land exactly under the text, always — not just
  // approximately. Measuring the editor's own *rendered* font-size in real
  // pixels and deriving one integer pixel line-height from it (fed into both
  // `line-height` and the ruled-line gradient's stops) means there's nothing
  // left that could round the two differently and drift apart line by line.
  // Declared *before* the content-load effect below (React runs
  // useLayoutEffects in declaration order) so indentUnitPx is already the
  // real measured value — not its unmeasured initial guess — by the time
  // that effect uses it to indent freshly loaded paragraphs.
  useLayoutEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    const cs = window.getComputedStyle(el);
    const fontSizePx = parseFloat(cs.fontSize) || 16 * scale;
    setLineHeightPx(Math.round(fontSizePx * LINE_HEIGHT_RATIO));
    setIndentUnitPx(measureIndentUnitPx(fontSizePx) || fontSizePx * 2);
  }, [scale, loading]);

  // contentEditable must be "uncontrolled" from React's point of view — if
  // a prop like dangerouslySetInnerHTML were bound to `content` (which also
  // changes on every keystroke via onInput), React would fight the browser
  // over the DOM on every re-render, corrupting the cursor position and
  // potentially eating keystrokes. Instead we set the initial HTML into the
  // DOM exactly once, right when the editor first mounts (loading → false),
  // and from then on the browser owns the DOM directly; `content` state
  // exists purely to drive the autosave/word-count, never to render.
  useLayoutEffect(() => {
    if (!loading && editorRef.current) {
      const el = editorRef.current;
      el.innerHTML = contentRef.current;
      // Loaded content (e.g. Markdown imported from a PDF via Actions ->
      // Markdown) arrives as plain, un-indented paragraph blocks — apply the
      // same forced default indent a block gets the moment it's typed into
      // (applyDefaultIndentIfFresh), so it reads identically to text
      // actually typed here instead of looking flush-left by comparison.
      // Deliberately NOT in the dep array below (see eslint-disable) — this
      // must run exactly once per load, not every time indentUnitPx/isRtl
      // change later (that would stomp the live-edited DOM back to the
      // originally loaded content).
      Array.from(el.children).forEach((block) => applyDefaultIndentIfFresh(block));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  const saveNow = useCallback(async (html) => {
    if (html === savedContentRef.current || savingRef.current) return;
    savingRef.current = true;
    setStatus("saving");
    try {
      const res = await fetch(apiUrl(`/api/draft/${id}`), {
        method: "PATCH",
        headers: authHeader(),
        body: JSON.stringify({ content: html }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed.");
      savedContentRef.current = html;
      setStatus("saved");
      setTimeout(() => setStatus((s) => (s === "saved" ? "" : s)), 1800);
    } catch {
      setStatus("error");
    } finally {
      savingRef.current = false;
    }
  }, [id]);

  useEffect(() => {
    if (loading) return;
    const normalized = normalizedContentSaveRef.current;
    if (!normalized || normalized === savedContentRef.current) return;
    normalizedContentSaveRef.current = "";
    void saveNow(normalized);
  }, [loading, saveNow]);

  const saveTitle = useCallback(async (newTitle) => {
    const trimmed = newTitle.trim() || "Untitled Document";
    setTitle(trimmed);
    setRenamingTitle(false);
    try {
      await fetch(apiUrl(`/api/draft/${id}`), {
        method: "PATCH",
        headers: authHeader(),
        body: JSON.stringify({ title: trimmed }),
      });
    } catch { /* best-effort — the list page will show the last-saved title on next visit */ }
  }, [id]);

  // Shared by typing and formatting commands — both are just "the HTML
  // changed, autosave it" from this point on.
  const commitContent = useCallback((html) => {
    setContent(html);
    contentRef.current = html;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => saveNow(html), AUTOSAVE_DELAY_MS);
  }, [saveNow]);

  const commitFromDom = useCallback(() => {
    if (!editorRef.current) return;
    const html = editorRef.current.innerHTML;

    if (!applyingHistoryRef.current) {
      if (!undoBatchOpenRef.current) {
        // First change in a new burst — snapshot the state as it was
        // *before* this change, so Undo has something to revert to. Rapid
        // follow-up changes (e.g. continued typing) join this same batch
        // instead of each pushing their own snapshot, so Undo reverts a
        // whole burst of typing at once rather than one character at a time.
        undoStackRef.current.push(contentRef.current);
        if (undoStackRef.current.length > 100) undoStackRef.current.shift();
        redoStackRef.current = [];
        setCanUndo(true);
        setCanRedo(false);
        undoBatchOpenRef.current = true;
      }
      clearTimeout(undoBatchTimerRef.current);
      undoBatchTimerRef.current = setTimeout(() => { undoBatchOpenRef.current = false; }, 600);
    }

    commitContent(html);
  }, [commitContent]);

  const handleUndo = useCallback(() => {
    const el = editorRef.current;
    if (!el || undoStackRef.current.length === 0) return;
    clearTimeout(undoBatchTimerRef.current);
    undoBatchOpenRef.current = false;
    redoStackRef.current.push(el.innerHTML);
    const prevHtml = undoStackRef.current.pop();
    applyingHistoryRef.current = true;
    el.innerHTML = prevHtml;
    applyingHistoryRef.current = false;
    commitContent(prevHtml);
    setCanUndo(undoStackRef.current.length > 0);
    setCanRedo(true);
  }, [commitContent]);

  const handleRedo = useCallback(() => {
    const el = editorRef.current;
    if (!el || redoStackRef.current.length === 0) return;
    clearTimeout(undoBatchTimerRef.current);
    undoBatchOpenRef.current = false;
    undoStackRef.current.push(el.innerHTML);
    const nextHtml = redoStackRef.current.pop();
    applyingHistoryRef.current = true;
    el.innerHTML = nextHtml;
    applyingHistoryRef.current = false;
    commitContent(nextHtml);
    setCanUndo(true);
    setCanRedo(redoStackRef.current.length > 0);
  }, [commitContent]);

  const handleEditorKeyDown = useCallback((e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    if (e.key === "z" && !e.shiftKey) { e.preventDefault(); handleUndo(); }
    else if (e.key === "y" || (e.key === "z" && e.shiftKey)) { e.preventDefault(); handleRedo(); }
  }, [handleUndo, handleRedo]);

  // Flush a pending edit immediately when leaving the page, so a quick
  // in-and-out never silently loses the last debounce window. Deliberately
  // an empty dep array — this must run its cleanup ONLY on true unmount, not
  // on every content change (a cleanup keyed on `content` would fire on
  // every keystroke instead, comparing a stale closure value and racing the
  // debounced save with spurious ones).
  useEffect(() => () => {
    clearTimeout(saveTimerRef.current);
    if (contentRef.current !== savedContentRef.current) saveNow(contentRef.current);
  }, [saveNow]);

  // Force one <div> per paragraph (Chrome's default already does this, but
  // not every engine) so every paragraph is a real, indentable block element.
  useEffect(() => {
    try { document.execCommand("defaultParagraphSeparator", false, "div"); } catch { /* best-effort */ }
  }, [loading]);

  // ── Paragraph indentation — a real per-paragraph CSS margin-left/right on
  // whichever block-level element the cursor is in, since a contentEditable
  // surface actually has paragraphs as real DOM elements (unlike the old
  // plain-textarea version, which had to fake this with literal leading-
  // space characters). ─────────────────────────────────────────────────────
  const getCurrentBlock = useCallback(() => {
    const el = editorRef.current;
    const sel = window.getSelection();
    if (!el || !sel || sel.rangeCount === 0) return null;
    let node = sel.getRangeAt(0).startContainer;
    if (!el.contains(node)) return null;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;
    while (node && node.parentNode !== el) node = node.parentNode;
    return node && node !== el && node.nodeType === Node.ELEMENT_NODE ? node : null;
  }, []);

  // New paragraphs default to DEFAULT_INDENT_LEVEL instead of flush against
  // the starting edge — applied lazily the first time a fresh block is
  // encountered, so it never re-applies over a block that already has one
  // (e.g. one just migrated by toggleDirection below).
  const applyDefaultIndentIfFresh = useCallback((block) => {
    const indentProp = isRtl ? "marginRight" : "marginLeft";
    // Page-break dividers (Text Extraction) are centered section markers,
    // not paragraphs — an inherited indent would just push them off-center.
    if (!block || block.dataset?.pageBreak === "1" || block.style[indentProp]) return;
    block.style[indentProp] = `${DEFAULT_INDENT_LEVEL * indentUnitPx}px`;
  }, [indentUnitPx, isRtl]);

  const ensureRangeLivesInIndentedBlock = useCallback((range) => {
    const el = editorRef.current;
    if (!el || !range) return range;

    let node = range.startContainer;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;
    while (node && node.parentNode !== el) node = node.parentNode;

    if (node && node !== el && node.nodeType === Node.ELEMENT_NODE) {
      applyDefaultIndentIfFresh(node);
      return range;
    }

    const wrapper = document.createElement("div");
    applyDefaultIndentIfFresh(wrapper);
    range.insertNode(wrapper);

    const nextRange = document.createRange();
    nextRange.selectNodeContents(wrapper);
    nextRange.collapse(true);
    return nextRange;
  }, [applyDefaultIndentIfFresh]);

  // Flipping direction alone doesn't move existing indentation — a block
  // indented via marginLeft while typing in LTR keeps that marginLeft after
  // switching to RTL, but marginLeft has no effect on where RTL (right-
  // aligned) text sits, so the paragraph silently lands back flush against
  // the right margin. Migrating each block's indent to the newly-active
  // side keeps the default-1 indent visually correct across the toggle.
  const toggleDirection = useCallback(() => {
    const el = editorRef.current;
    setIsRtl((prevIsRtl) => {
      const nextIsRtl = !prevIsRtl;
      if (el) {
        const fromProp = prevIsRtl ? "marginRight" : "marginLeft";
        const toProp = nextIsRtl ? "marginRight" : "marginLeft";
        Array.from(el.children).forEach((block) => {
          if (block.style?.[fromProp]) {
            block.style[toProp] = block.style[fromProp];
            block.style[fromProp] = "";
          }
        });
      }
      return nextIsRtl;
    });
    // Persisting the migration (commitFromDom) needs to happen *after*
    // isRtl has actually re-rendered — done in the effect below, since
    // setIsRtl above hasn't taken effect yet at this point in the same tick.
  }, []);

  const indentCurrentBlock = useCallback(() => {
    const block = getCurrentBlock();
    if (!block || block.dataset?.pageBreak === "1") return;
    const indentProp = isRtl ? "marginRight" : "marginLeft";
    const current = parseFloat(block.style[indentProp]) || 0;
    const next = current > 0 ? current + indentUnitPx : DEFAULT_INDENT_LEVEL * indentUnitPx;
    block.style[indentProp] = `${next}px`;
    commitFromDom();
  }, [commitFromDom, getCurrentBlock, indentUnitPx, isRtl]);

  // Runs only on an actual toggle (see toggleDirection above), never on
  // mount — guarded by `loading` so it can't fire before the real saved
  // content exists and autosave a blank document over it.
  useEffect(() => {
    if (loading || !editorRef.current) return;
    commitFromDom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRtl]);

  const handleInput = useCallback(() => {
    const el = editorRef.current;
    let block = getCurrentBlock();
    if (!block && el && el.childNodes.length) {
      // Loose text sitting directly under the editor root — the very first
      // character(s) typed before any Enter has been pressed, so there's no
      // real block yet to carry an indent. Wrap it in one, preserving the
      // caret exactly: the Range keeps referencing the same text node object
      // (appendChild moves it, doesn't clone it), so it's still valid after
      // the move without needing to reconstruct the selection by position.
      const sel = window.getSelection();
      const anchorNode = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).startContainer : null;
      const anchorOffset = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).startOffset : 0;
      const wrapper = document.createElement("div");
      while (el.firstChild) wrapper.appendChild(el.firstChild);
      el.appendChild(wrapper);
      block = wrapper;
      if (anchorNode) {
        try {
          const range = document.createRange();
          range.setStart(anchorNode, anchorOffset);
          range.setEnd(anchorNode, anchorOffset);
          sel.removeAllRanges();
          sel.addRange(range);
        } catch { /* best-effort caret restore */ }
      }
    }
    applyDefaultIndentIfFresh(block);
    commitFromDom();
  }, [getCurrentBlock, applyDefaultIndentIfFresh, commitFromDom]);

  // Page-margin number inputs — clamping on every keystroke (the old
  // behavior) fought the user: clearing the field to retype a value sent it
  // straight to Number("") || 0 → 0, snapping "" back to "0" before a new
  // digit could ever land. Pass typed input straight through (including a
  // momentarily empty field) while focused, and only clamp into the valid
  // 0–3in range on blur.
  const handleMarginInputChange = useCallback((e, setter) => {
    const raw = e.target.value;
    if (raw === "") { setter(""); return; }
    const n = Number(raw);
    if (!Number.isNaN(n)) setter(n);
  }, []);
  const handleMarginInputBlur = useCallback((e, setter) => {
    setter(Math.max(0, Math.min(3, Number(e.target.value) || 1)));
  }, []);

  // ── Formatting toolbar ──────────────────────────────────────────────────
  const focusEditor = useCallback(() => editorRef.current?.focus(), []);

  const execFormat = useCallback((command, value = null) => {
    focusEditor();
    document.execCommand("styleWithCSS", false, true);
    document.execCommand(command, false, value);
    commitFromDom();
  }, [focusEditor, commitFromDom]);

  // execCommand's own fontSize only supports the seven legacy HTML sizes —
  // wrapping the selection in a styled span gives real, exact pixel sizes.
  const wrapSelectionStyle = useCallback((styleObj) => {
    const el = editorRef.current;
    const sel = window.getSelection();
    if (!el || !sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    if (!el.contains(range.commonAncestorContainer)) return;

    const span = document.createElement("span");
    Object.assign(span.style, styleObj);
    try {
      range.surroundContents(span);
    } catch {
      // The range partially overlaps existing elements (surroundContents
      // can't handle that) — extract and re-wrap instead.
      const frag = range.extractContents();
      span.appendChild(frag);
      range.insertNode(span);
    }
    sel.removeAllRanges();
    const newRange = document.createRange();
    newRange.selectNodeContents(span);
    sel.addRange(newRange);
    commitFromDom();
  }, [commitFromDom]);

  const applyFontSize = useCallback((size) => {
    setFontSize(size);
    wrapSelectionStyle({ fontSize: `${size}px` });
  }, [wrapSelectionStyle]);

  const applyFontColor = useCallback((hex) => {
    setFontColor(hex);
    execFormat("foreColor", hex);
  }, [execFormat]);

  const applyHighlight = useCallback((hex) => {
    setHighlightColor(hex);
    execFormat("hiliteColor", hex);
  }, [execFormat]);

  const applyBorder = useCallback(() => {
    wrapSelectionStyle({
      border: "1px solid var(--color-text-muted)",
      borderRadius: "3px",
      padding: "0 3px",
    });
  }, [wrapSelectionStyle]);

  const applyList = useCallback((kind) => {
    focusEditor();
    document.execCommand("styleWithCSS", false, true);
    if (kind === "unordered") {
      document.execCommand("insertUnorderedList", false, null);
    } else {
      document.execCommand("insertOrderedList", false, null);
      const list = getCurrentBlock()?.closest?.("ol");
      if (list) list.style.listStyleType = kind === "alpha" ? "lower-alpha" : "decimal";
    }
    commitFromDom();
  }, [focusEditor, getCurrentBlock, commitFromDom]);

  const runAiTextTool = useCallback(async (action) => {
    const el = editorRef.current;
    const sel = window.getSelection();
    if (!el || !sel || sel.rangeCount === 0 || sel.isCollapsed) {
      setAiToolError("Select some text first.");
      return;
    }
    const range = sel.getRangeAt(0);
    if (!el.contains(range.commonAncestorContainer)) return;
    const selectedText = sel.toString();
    if (!selectedText.trim()) return;

    setAiToolBusy(action);
    setAiToolError("");
    try {
      const res = await fetch(apiUrl("/api/ai/text-tool"), {
        method: "POST",
        headers: authHeader(),
        body: JSON.stringify({ text: selectedText, action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || data.error || "AI request failed.");

      range.deleteContents();
      const textNode = document.createTextNode(data.result);
      range.insertNode(textNode);
      const newRange = document.createRange();
      newRange.selectNode(textNode);
      sel.removeAllRanges();
      sel.addRange(newRange);
      commitFromDom();
    } catch (err) {
      setAiToolError(err.message);
    } finally {
      setAiToolBusy(null);
    }
  }, [commitFromDom]);

  // ── Real-time dictation (speech-to-text) ────────────────────────────────
  // Deliberately NOT the browser's built-in SpeechRecognition — it's
  // Chrome-only, streams audio through Google's own servers with no control
  // over the model, and tends to drop or mangle words on longer dictation.
  // This instead opens a direct WebRTC connection from the browser straight
  // to OpenAI's Realtime Transcription API (via a short-lived token minted
  // by our backend) so words appear as they're spoken, not after a whole
  // recording is uploaded and transcribed as one batch.
  const teardownDictationConnection = useCallback(() => {
    dictationDcRef.current?.close();
    dictationPcRef.current?.close();
    dictationStreamRef.current?.getTracks().forEach((t) => t.stop());
    dictationDcRef.current = null;
    dictationPcRef.current = null;
    dictationStreamRef.current = null;
  }, []);

  // Turns the live, still-streaming span into permanent plain text (or drops
  // it if nothing was ever transcribed into it), so nothing "in progress"
  // is left behind once a segment finishes or dictation stops.
  const settleLiveSpan = useCallback((finalText) => {
    const span = liveDictationSpanRef.current;
    liveDictationSpanRef.current = null;
    if (!span || !span.parentNode) return null;
    const text = finalText != null ? finalText : span.textContent;
    if (!text.trim()) { span.remove(); return null; }
    const textNode = document.createTextNode(text);
    span.replaceWith(textNode);
    return textNode;
  }, []);

  const startNewLiveSpan = useCallback((afterNode) => {
    const el = editorRef.current;
    if (!el) return;
    const span = document.createElement("span");
    span.className = "draft_live_dictation";
    if (afterNode && afterNode.parentNode) {
      afterNode.parentNode.insertBefore(span, afterNode.nextSibling);
    } else {
      el.appendChild(span);
    }
    liveDictationSpanRef.current = span;
    const sel = window.getSelection();
    const range = document.createRange();
    range.setStart(span, 0);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }, []);

  const stopDictation = useCallback(() => {
    teardownDictationConnection();
    settleLiveSpan(null);
    lastDictationTextNodeRef.current = null;
    lastDictationTranscriptRef.current = "";
    setIsDictating(false);
    commitFromDom();
  }, [teardownDictationConnection, settleLiveSpan, commitFromDom]);

  const getEditorTextNodes = useCallback(() => {
    const root = editorRef.current;
    if (!root) return [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.textContent?.trim()) return NodeFilter.FILTER_REJECT;
        if (node.parentElement?.closest?.(".draft_live_dictation")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    let node;
    while ((node = walker.nextNode())) nodes.push(node);
    return nodes;
  }, []);

  const applyReplacementToRecentText = useCallback((target, replacement) => {
    const needle = String(target || "").trim();
    if (!needle) return false;
    const regex = new RegExp(escapeRegExp(needle), "i");
    const candidates = [
      lastDictationTextNodeRef.current,
      ...getEditorTextNodes().reverse(),
    ].filter(Boolean);

    for (const node of candidates) {
      const text = String(node.textContent || "");
      const match = text.match(regex);
      if (!match) continue;
      const start = match.index ?? text.toLowerCase().lastIndexOf(needle.toLowerCase());
      if (start < 0) continue;
      node.textContent = `${text.slice(0, start)}${replacement}${text.slice(start + match[0].length)}`;
      return true;
    }
    return false;
  }, [getEditorTextNodes]);

  const applyDeleteTextToRecentText = useCallback((target) => {
    const needle = String(target || "").trim();
    if (!needle) return false;
    const regex = new RegExp(`\\s*${escapeRegExp(needle)}\\s*`, "i");
    const candidates = [
      lastDictationTextNodeRef.current,
      ...getEditorTextNodes().reverse(),
    ].filter(Boolean);

    for (const node of candidates) {
      const text = String(node.textContent || "");
      if (!regex.test(text)) continue;
      node.textContent = text.replace(regex, " ").replace(/\s{2,}/g, " ");
      return true;
    }
    return false;
  }, [getEditorTextNodes]);

  const deleteLastWordFromRecentText = useCallback(() => {
    const candidates = [
      lastDictationTextNodeRef.current,
      ...getEditorTextNodes().reverse(),
    ].filter(Boolean);

    for (const node of candidates) {
      const text = String(node.textContent || "");
      const next = text.replace(/\s*\S+[^\s]*\s*$/, " ").replace(/\s{2,}/g, " ");
      if (next !== text) {
        node.textContent = next;
        return true;
      }
    }
    return false;
  }, [getEditorTextNodes]);

  const deleteLastSentenceFromRecentText = useCallback(() => {
    const node = lastDictationTextNodeRef.current || getEditorTextNodes().at(-1);
    if (!node) return false;
    const text = String(node.textContent || "");
    const next = text
      .replace(/\s*[^.!?]*[.!?]["']?\s*$/, " ")
      .replace(/\s{2,}/g, " ");

    if (next.trim()) node.textContent = next;
    else node.remove();
    return true;
  }, [getEditorTextNodes]);

  const correctLastSentenceFromRecentText = useCallback(async () => {
    const node = lastDictationTextNodeRef.current || getEditorTextNodes().at(-1);
    if (!node?.parentNode) return false;
    const text = String(node.textContent || "").trim();
    if (!text) return false;

    try {
      const res = await fetch(apiUrl("/api/ai/text-tool"), {
        method: "POST",
        headers: authHeader(),
        body: JSON.stringify({ text, action: "dictation_correct" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || data.error || "Couldn't correct the last sentence.");
      const corrected = String(data.result || "").trim();
      if (!corrected || !node.parentNode) return false;
      node.textContent = `${corrected} `;
      return true;
    } catch {
      return false;
    }
  }, [getEditorTextNodes]);

  const applyDictationEditorCommand = useCallback((command) => {
    const intent = String(command?.intent || "noop");
    switch (intent) {
      case "replace_text":
        return applyReplacementToRecentText(command.target, String(command.replacement || ""));
      case "delete_text":
        return applyDeleteTextToRecentText(command.target);
      case "delete_last_word":
        return deleteLastWordFromRecentText();
      case "delete_last_sentence":
        return deleteLastSentenceFromRecentText();
      default:
        return false;
    }
  }, [applyDeleteTextToRecentText, applyReplacementToRecentText, deleteLastSentenceFromRecentText, deleteLastWordFromRecentText]);

  const handleDictationEditorCommand = useCallback(async (transcript, anchorNode) => {
    const spokenCommand = String(transcript || "").replace(DICTATION_COMMAND_PREFIX_RE, "").trim();
    if (!spokenCommand) {
      startNewLiveSpan(anchorNode || lastDictationTextNodeRef.current || null);
      commitFromDom();
      return false;
    }

    try {
      const res = await fetch(apiUrl("/api/ai/text-tool"), {
        method: "POST",
        headers: authHeader(),
        body: JSON.stringify({ text: spokenCommand, action: "dictation_command" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || data.error || "Couldn't parse dictation command.");

      const parsed = JSON.parse(String(data.result || "{}").replace(/^```json\s*/i, "").replace(/```$/i, "").trim());
      const applied = parsed?.intent === "correct_last_sentence"
        ? await correctLastSentenceFromRecentText()
        : applyDictationEditorCommand(parsed);
      if (!applied) {
        setDictationError("I heard a command, but couldn't apply it.");
        return false;
      }
      return true;
    } catch (err) {
      setDictationError(err.message || "Couldn't apply dictation command.");
      return false;
    } finally {
      startNewLiveSpan(anchorNode || lastDictationTextNodeRef.current || null);
      commitFromDom();
    }
  }, [applyDictationEditorCommand, commitFromDom, correctLastSentenceFromRecentText, startNewLiveSpan]);

  const maybeCorrectDictationText = useCallback(async (textNode, text) => {
    if (!textNode || !textNode.parentNode || !shouldAutoCorrectDictation(text)) return false;

    try {
      const res = await fetch(apiUrl("/api/ai/text-tool"), {
        method: "POST",
        headers: authHeader(),
        body: JSON.stringify({ text, action: "dictation_correct" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || data.error || "Dictation correction failed.");

      const corrected = String(data.result || "").trim();
      if (!corrected || !textNode.parentNode) return false;
      textNode.textContent = `${corrected} `;
      commitFromDom();
      return true;
    } catch {
      // Best-effort cleanup only — dictation itself should keep working even
      // if the correction pass fails.
      return false;
    }
  }, [commitFromDom]);

  const startDictation = useCallback(async () => {
    setDictationError("");
    const el = editorRef.current;
    if (!el) return;

    const sel = window.getSelection();
    const initialRange = sel && sel.rangeCount > 0 && el.contains(sel.getRangeAt(0).commonAncestorContainer)
      ? sel.getRangeAt(0).cloneRange()
      : (() => { const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); return r; })();
    const range = ensureRangeLivesInIndentedBlock(initialRange);

    try {
      const tokenRes = await fetch(apiUrl("/api/ai/realtime-token"), { method: "POST", headers: authHeader() });
      const tokenData = await tokenRes.json();
      if (!tokenRes.ok) throw new Error(tokenData.error?.message || "Couldn't start real-time dictation.");
      const ephemeralKey = tokenData.value;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      dictationStreamRef.current = stream;

      const pc = new RTCPeerConnection();
      dictationPcRef.current = pc;
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      const dc = pc.createDataChannel("oai-events");
      dictationDcRef.current = dc;

      // Insert the live span at the cursor position captured above — by the
      // time events start arriving the editor's selection could be anywhere
      // (e.g. right after the mic button steals focus on click).
      range.deleteContents();
      const anchor = document.createComment("");
      range.insertNode(anchor);
      startNewLiveSpan(anchor);
      anchor.remove();

      // A single "language" hint is only meaningful when exactly one of
      // EN/AR is enabled — with both on (or, as a safe fallback, neither),
      // the field is omitted entirely so the model auto-detects between
      // languages from the audio itself rather than being pinned to one.
      const language = dictationLangEn && !dictationLangAr ? "en"
        : dictationLangAr && !dictationLangEn ? "ar"
        : undefined;

      dc.addEventListener("open", () => {
        dc.send(JSON.stringify({
          type: "session.update",
          session: {
            type: "transcription",
            audio: {
              input: {
                format: { type: "audio/pcm", rate: 24000 },
                transcription: { model: "gpt-4o-mini-transcribe", language },
                turn_detection: { type: "server_vad" },
              },
            },
          },
        }));
      });

      dc.addEventListener("message", (event) => {
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }
        if (msg.type === "conversation.item.input_audio_transcription.delta") {
          const span = liveDictationSpanRef.current;
          if (span) {
            span.textContent += msg.delta || "";
            commitFromDom();
          }
        } else if (msg.type === "conversation.item.input_audio_transcription.completed") {
          const transcript = String(msg.transcript || "").trim();
          if (DICTATION_COMMAND_PREFIX_RE.test(transcript)) {
            const anchorNode = settleLiveSpan("");
            void handleDictationEditorCommand(transcript, anchorNode);
            return;
          }
          const previousNode = lastDictationTextNodeRef.current;
          const previousTranscript = lastDictationTranscriptRef.current;
          const shouldReplacePrevious = previousNode?.parentNode && shouldReplacePreviousDictation(previousTranscript, transcript);
          const textNode = settleLiveSpan(transcript ? `${transcript} ` : "");

          let finalNode = textNode;
          if (shouldReplacePrevious && previousNode?.parentNode) {
            previousNode.textContent = transcript ? `${transcript} ` : "";
            textNode?.remove();
            finalNode = previousNode;
          }

          lastDictationTextNodeRef.current = finalNode || previousNode || null;
          lastDictationTranscriptRef.current = transcript;
          startNewLiveSpan(finalNode || previousNode || null);
          commitFromDom();
          if (transcript && (finalNode || previousNode)) {
            void maybeCorrectDictationText(finalNode || previousNode, transcript);
          }
        } else if (msg.type === "error") {
          setDictationError(msg.error?.message || "Real-time dictation error.");
        }
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const sdpRes = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        body: offer.sdp,
        headers: { Authorization: `Bearer ${ephemeralKey}`, "Content-Type": "application/sdp" },
      });
      if (!sdpRes.ok) throw new Error("Couldn't connect to the real-time transcription service.");
      const answerSdp = await sdpRes.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

      setIsDictating(true);
    } catch (err) {
      setDictationError(err.name === "NotAllowedError" ? "Microphone access was denied." : err.message);
      teardownDictationConnection();
      settleLiveSpan(null);
      setIsDictating(false);
    }
  }, [commitFromDom, settleLiveSpan, startNewLiveSpan, teardownDictationConnection, dictationLangEn, dictationLangAr, maybeCorrectDictationText, ensureRangeLivesInIndentedBlock, handleDictationEditorCommand]);

  const toggleDictation = useCallback(() => {
    if (isDictating) stopDictation();
    else startDictation();
  }, [isDictating, startDictation, stopDictation]);

  // Tear down the connection and mic if the user navigates away mid-dictation.
  useEffect(() => () => teardownDictationConnection(), [teardownDictationConnection]);

  // Two-finger pinch on the draft "desk" should drive the same scale state
  // as the toolbar buttons, so mobile/tablet zoom and button zoom never
  // drift apart or fight each other.
  useEffect(() => {
    const stack = pageStackRef.current;
    if (!stack) return;

    const touchDistance = (touches) => {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.hypot(dx, dy);
    };

    const onTouchStart = (e) => {
      if (e.touches.length !== 2) return;
      const rect = stack.getBoundingClientRect();
      pinchZoomRef.current = {
        startDist: touchDistance(e.touches),
        startScale: scale,
        startScrollLeft: stack.scrollLeft,
        startScrollTop: stack.scrollTop,
        midX: ((e.touches[0].clientX + e.touches[1].clientX) / 2) - rect.left,
        midY: ((e.touches[0].clientY + e.touches[1].clientY) / 2) - rect.top,
      };
    };

    const onTouchMove = (e) => {
      const pinch = pinchZoomRef.current;
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();

      const nextScale = Math.max(
        MIN_SCALE,
        Math.min(
          MAX_SCALE,
          +(pinch.startScale * (touchDistance(e.touches) / Math.max(1, pinch.startDist))).toFixed(2)
        )
      );

      pinchScrollAfterScaleRef.current = { ...pinch, nextScale };
      setScale((prev) => (Math.abs(prev - nextScale) > 0.001 ? nextScale : prev));
    };

    const endPinch = () => {
      if (!pinchZoomRef.current) return;
      pinchZoomRef.current = null;
    };

    stack.addEventListener("touchstart", onTouchStart, { passive: true });
    stack.addEventListener("touchmove", onTouchMove, { passive: false });
    stack.addEventListener("touchend", endPinch, { passive: true });
    stack.addEventListener("touchcancel", endPinch, { passive: true });

    return () => {
      stack.removeEventListener("touchstart", onTouchStart);
      stack.removeEventListener("touchmove", onTouchMove);
      stack.removeEventListener("touchend", endPinch);
      stack.removeEventListener("touchcancel", endPinch);
    };
  }, [scale]);

  useLayoutEffect(() => {
    const pending = pinchScrollAfterScaleRef.current;
    const stack = pageStackRef.current;
    if (!pending || !stack || Math.abs(scale - pending.nextScale) > 0.001) return;

    const ratio = pending.nextScale / pending.startScale;
    stack.scrollLeft = ((pending.startScrollLeft + pending.midX) * ratio) - pending.midX;
    stack.scrollTop = ((pending.startScrollTop + pending.midY) * ratio) - pending.midY;
    pinchScrollAfterScaleRef.current = null;
  }, [scale]);

  // ── Print / PDF export / Email ──────────────────────────────────────────
  const printDocument = useCallback(() => {
    // The print stylesheet (see draftPage.css's @media print block) hides
    // everything but #draft_editor, so the browser's own print/"Save as PDF"
    // dialog only ever sees the document itself, never the toolbar or ruler.
    window.print();
  }, []);

  const exportPdf = useCallback(() => {
    if (!editorRef.current) return;
    setExportError("");
    setExportBusy("pdf");
    try {
      const doc = buildDocumentPdf(editorRef.current, title);
      doc.save(`${title || "Untitled Document"}.pdf`);
    } catch (err) {
      setExportError("Couldn't generate the PDF.");
    } finally {
      setExportBusy(null);
    }
  }, [title]);

  const sendEmail = useCallback(async () => {
    if (!editorRef.current) return;
    if (!emailTo.trim()) { setExportError("Enter a recipient email address."); return; }
    setExportError("");
    setExportBusy("email");
    try {
      const doc = buildDocumentPdf(editorRef.current, title);
      const blob = doc.output("blob");
      const form = new FormData();
      form.append("pdf", blob, `${title || "Untitled Document"}.pdf`);
      form.append("to", emailTo.trim());
      form.append("subject", `AMCTOSHS Draft: ${title}`);
      const token = readStoredSession()?.token || "";
      const res = await fetch(apiUrl(`/api/draft/${id}/email`), {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || data.error || "Failed to send the email.");
      setEmailModalOpen(false);
      setEmailTo("");
    } catch (err) {
      setExportError(err.message);
    } finally {
      setExportBusy(null);
    }
  }, [emailTo, id, title]);

  const deleteDraft = useCallback(async () => {
    if (deleteBusy) return;
    if (!window.confirm("Delete this document? This can't be undone.")) return;
    setExportError("");
    setDeleteBusy(true);
    try {
      const res = await fetch(apiUrl(`/api/draft/${id}`), {
        method: "DELETE",
        headers: authHeader(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to delete that document.");
      navigate("/draft");
    } catch (err) {
      setExportError(err.message || "Failed to delete that document.");
      setDeleteBusy(false);
    }
  }, [deleteBusy, id, navigate]);

  // ── Paged layout (Letter/A4/etc, with customizable margins) ─────────────
  // The editor itself is now a fixed-size page (not a freestyle full-width
  // scroller) — real physical dimensions in px, at the current zoom level.
  const pxPerIn = CSS_PX_PER_IN * scale;
  const pageDims = PAGE_DIMENSIONS_IN[pageFormat] || PAGE_DIMENSIONS_IN.letter;
  const pageWidthPx = Math.round(pageDims.w * pxPerIn);
  const pageHeightPx = Math.round(pageDims.h * pxPerIn);
  const marginTopPx = Math.round(marginTopIn * pxPerIn);
  const marginRightPx = Math.round(marginRightIn * pxPerIn);
  const marginBottomPx = Math.round(marginBottomIn * pxPerIn);
  const marginLeftPx = Math.round(marginLeftIn * pxPerIn);
  // Before any real block exists, the forced default indent has nowhere to
  // live (applyDefaultIndentIfFresh only touches a real block's margin) — so
  // it's folded into the editor's own padding instead, on the side writing
  // starts from. This is real box padding, not a cosmetic pseudo-element
  // margin, so it moves the actual caret (not just the placeholder text) —
  // critical in RTL, where the caret otherwise sits at the physical right
  // edge of the page instead of at the indented spot where typing begins.
  //
  // Checked against the live DOM (editorRef), not the `content` string —
  // backspacing all text away often leaves a residual empty block behind
  // (e.g. "<div><br></div>") that still carries its own marginLeft/Right
  // from when it was first typed into. `content.trim() === ""` would still
  // read that as empty and add this padding on top, double-indenting the
  // caret away from its real spot. Only add it when the editor has truly
  // no child block left to carry the indent itself.
  const editorHasNoBlock = !editorRef.current || editorRef.current.childNodes.length === 0;
  const emptyStateIndentPx = editorHasNoBlock ? DEFAULT_INDENT_LEVEL * indentUnitPx : 0;
  const editorPaddingLeftPx = marginLeftPx + (isRtl ? 0 : emptyStateIndentPx);
  const editorPaddingRightPx = marginRightPx + (isRtl ? emptyStateIndentPx : 0);
  const contentHeightPx = Math.max(40, pageHeightPx - marginTopPx - marginBottomPx);
  // The gap drawn between stacked pages is this page's bottom margin PLUS
  // the next page's top margin (not a fixed value) — that's what makes real
  // customizable margins actually apply consistently at every page
  // transition, not just the very first/last page's outer edge.
  const pageGapPx = marginTopPx + marginBottomPx + PAGE_GAP_EXTRA_PX;
  const pageCyclePx = contentHeightPx + pageGapPx;

  // Recomputes which page the cursor/scroll position is on, and how many
  // pages the document currently spans — driven by the *stack* wrapper's
  // scroll position, since that's the actual scroll container now (the
  // page itself just grows to fit its content).
  const updatePageTracking = useCallback(() => {
    const stack = pageStackRef.current;
    const el = editorRef.current;
    if (!stack || !el) return;
    const total = Math.max(1, Math.ceil(el.scrollHeight / pageCyclePx));
    const current = Math.min(total, Math.floor(stack.scrollTop / pageCyclePx) + 1);
    setPageCount(total);
    setCurrentPageNum(current);
  }, [pageCyclePx]);

  useEffect(() => { updatePageTracking(); }, [updatePageTracking, content]);

  const wordCount = (stripHtml(content).match(/\S+/g) || []).length;

  return (
    <div id="draft_page">
      <div id="draft_header">
        <button id="draft_back_btn" onClick={() => navigate("/draft")} title="Back to Documents">←</button>
        {renamingTitle ? (
          <input
            id="draft_title_input"
            autoFocus
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() => saveTitle(titleDraft)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); saveTitle(titleDraft); }
              if (e.key === "Escape") setRenamingTitle(false);
            }}
          />
        ) : (
          <span id="draft_title" onClick={() => { setTitleDraft(title); setRenamingTitle(true); }} title="Click to rename">
            {title} <i className="fi fi-rr-pencil" />
          </span>
        )}
        <span id="draft_status">
          {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : status === "error" ? "⚠ Couldn't save — retrying next edit" : ""}
        </span>
        <span id="draft_word_count">{wordCount} word{wordCount === 1 ? "" : "s"}</span>
        {sourceId && (
          <button
            type="button"
            id="draft_back_to_pdf_btn"
            onClick={() => navigate("/pdf-reader", { state: { sourceId, pdfName: sourceName } })}
            title={`Back to ${sourceName || "PDF"}${sourcePage ? `, page ${sourcePage}` : ""}`}
          >
            <i className="fi fi-rr-file-pdf" /> Back to PDF
          </button>
        )}
        <div id="draft_doc_actions">
          <button type="button" onClick={printDocument} title="Print"><i className="fi fi-rr-print" /></button>
          <button type="button" onClick={exportPdf} title="Download as PDF" disabled={exportBusy !== null}>
            <i className={`fi ${exportBusy === "pdf" ? "fi-rr-spinner draft_icon_spin" : "fi-rr-file-pdf"}`} />
          </button>
          <button type="button" onClick={() => { setEmailModalOpen(true); setExportError(""); }} title="Email"><i className="fi fi-rr-envelope" /></button>
          <button type="button" onClick={deleteDraft} title="Delete document" disabled={deleteBusy}>
            <i className={`fi ${deleteBusy ? "fi-rr-spinner draft_icon_spin" : "fi-rr-trash"}`} />
          </button>
        </div>
        <span id="draft_page_indicator">Page {currentPageNum} of {pageCount}</span>
        <div id="draft_font_controls">
          <button type="button" onClick={() => setScale((s) => Math.max(MIN_SCALE, +(s - 0.1).toFixed(1)))} title="Zoom out" disabled={scale <= MIN_SCALE}>A−</button>
          <span id="draft_font_label">{Math.round(scale * 100)}%</span>
          <button type="button" onClick={() => setScale((s) => Math.min(MAX_SCALE, +(s + 0.1).toFixed(1)))} title="Zoom in" disabled={scale >= MAX_SCALE}>A+</button>
        </div>
      </div>

      {!loading && !loadError && (
        <div id="draft_page_setup">
          <label>
            Page
            <select value={pageFormat} onChange={(e) => setPageFormat(e.target.value)}>
              {PAGE_SIZE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <div id="draft_margin_group">
            <label>Top<input type="number" min="0" max="3" step="0.1" value={marginTopIn} onChange={(e) => handleMarginInputChange(e, setMarginTopIn)} onBlur={(e) => handleMarginInputBlur(e, setMarginTopIn)} />in</label>
            <label>Right<input type="number" min="0" max="3" step="0.1" value={marginRightIn} onChange={(e) => handleMarginInputChange(e, setMarginRightIn)} onBlur={(e) => handleMarginInputBlur(e, setMarginRightIn)} />in</label>
            <label>Bottom<input type="number" min="0" max="3" step="0.1" value={marginBottomIn} onChange={(e) => handleMarginInputChange(e, setMarginBottomIn)} onBlur={(e) => handleMarginInputBlur(e, setMarginBottomIn)} />in</label>
            <label>Left<input type="number" min="0" max="3" step="0.1" value={marginLeftIn} onChange={(e) => handleMarginInputChange(e, setMarginLeftIn)} onBlur={(e) => handleMarginInputBlur(e, setMarginLeftIn)} />in</label>
          </div>
        </div>
      )}

      {emailModalOpen && (
        <div id="draft_email_modal_backdrop" onClick={() => setEmailModalOpen(false)}>
          <div id="draft_email_modal" onClick={(e) => e.stopPropagation()}>
            <h3>Email this document</h3>
            <input
              type="email"
              placeholder="recipient@example.com"
              value={emailTo}
              onChange={(e) => setEmailTo(e.target.value)}
              autoFocus
            />
            {exportError && <p className="draft_tool_error">⚠ {exportError}</p>}
            <div id="draft_email_modal_actions">
              <button type="button" onClick={() => setEmailModalOpen(false)}>Cancel</button>
              <button type="button" className="draft_email_send_btn" onClick={sendEmail} disabled={exportBusy !== null}>
                {exportBusy === "email" ? "Sending…" : "Send"}
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <p id="draft_status_msg">Loading your draft…</p>
      ) : loadError ? (
        <p id="draft_status_msg" className="draft_status_msg--error">⚠ {loadError}</p>
      ) : (
        <>
          <div id="draft_toolbar">
            <button type="button" className="draft_tool_btn" title="Undo" onMouseDown={(e) => e.preventDefault()} onClick={handleUndo} disabled={!canUndo}><i className="fi fi-rr-undo" /></button>
            <button type="button" className="draft_tool_btn" title="Redo" onMouseDown={(e) => e.preventDefault()} onClick={handleRedo} disabled={!canRedo}><i className="fi fi-rr-redo" /></button>
            <span className="draft_toolbar_divider" />

            <select
              className="draft_tool_select"
              defaultValue={EDITOR_FONT_FAMILY}
              title="Font style"
              onChange={(e) => execFormat("fontName", e.target.value)}
            >
              {FONT_FAMILY_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>

            <select
              className="draft_tool_select"
              value={fontSize}
              title="Font size"
              onChange={(e) => applyFontSize(Number(e.target.value))}
            >
              {FONT_SIZE_OPTIONS.map((s) => <option key={s} value={s}>{s}px</option>)}
            </select>

            <button type="button" className="draft_tool_btn" title="Bold" onMouseDown={(e) => e.preventDefault()} onClick={() => execFormat("bold")}><b>B</b></button>
            <button type="button" className="draft_tool_btn" title="Italic" onMouseDown={(e) => e.preventDefault()} onClick={() => execFormat("italic")}><i>I</i></button>
            <button type="button" className="draft_tool_btn" title="Underline" onMouseDown={(e) => e.preventDefault()} onClick={() => execFormat("underline")}><u>U</u></button>

            <button type="button" className="draft_tool_btn" title="Align left" onMouseDown={(e) => e.preventDefault()} onClick={() => execFormat("justifyLeft")}><i className="fi fi-rr-align-left" /></button>
            <button type="button" className="draft_tool_btn" title="Align center" onMouseDown={(e) => e.preventDefault()} onClick={() => execFormat("justifyCenter")}><i className="fi fi-rr-align-center" /></button>
            <button type="button" className="draft_tool_btn" title="Align right" onMouseDown={(e) => e.preventDefault()} onClick={() => execFormat("justifyRight")}><i className="fi fi-rr-align-left draft_icon_flip" /></button>
            <button type="button" className="draft_tool_btn" title="Indent paragraph" onMouseDown={(e) => e.preventDefault()} onClick={indentCurrentBlock}>
              <i className="fi fi-rr-indent" />
            </button>

            <button
              type="button"
              className={`draft_tool_btn${isRtl ? " draft_tool_btn--active" : ""}`}
              title={isRtl ? "Switch to left-to-right text" : "Switch to right-to-left text"}
              onMouseDown={(e) => e.preventDefault()}
              onClick={toggleDirection}
            >
              {isRtl ? "RTL" : "LTR"}
            </button>

            <label className="draft_tool_color" title="Font color">
              A
              <input type="color" value={fontColor} onChange={(e) => applyFontColor(e.target.value)} />
            </label>
            <label className="draft_tool_color draft_tool_color--highlight" title="Text highlight">
              <i className="fi fi-rr-highlighter" />
              <input type="color" value={highlightColor} onChange={(e) => applyHighlight(e.target.value)} />
            </label>

            <button type="button" className="draft_tool_btn" title="Add border around selection" onMouseDown={(e) => e.preventDefault()} onClick={applyBorder}>
              <i className="fi fi-rr-square" />
            </button>
            <button type="button" className="draft_tool_btn" title="Unordered list" onMouseDown={(e) => e.preventDefault()} onClick={() => applyList("unordered")}>
              <i className="fi fi-rr-list" />
            </button>
            <button type="button" className="draft_tool_btn" title="Numbered list" onMouseDown={(e) => e.preventDefault()} onClick={() => applyList("numeric")}>
              1.
            </button>
            <button type="button" className="draft_tool_btn" title="Alphabetical list" onMouseDown={(e) => e.preventDefault()} onClick={() => applyList("alpha")}>
              a.
            </button>

            <div id="draft_dictation_group">
              <button
                type="button"
                className={`draft_tool_btn draft_tool_btn--mic${isDictating ? " draft_tool_btn--recording" : ""}`}
                title={isDictating ? "Stop dictation" : "Dictate text live (real-time speech-to-text)"}
                onMouseDown={(e) => e.preventDefault()}
                onClick={toggleDictation}
              >
                <i className={`fi ${isDictating ? "fi-rr-square" : "fi-rr-microphone"}`} />
              </button>
              <div id="draft_dictation_langs" title="Languages to detect while dictating">
                <button
                  type="button"
                  className={`draft_lang_btn${dictationLangEn ? " draft_lang_btn--active" : ""}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setDictationLangEn((v) => !v)}
                  disabled={isDictating}
                >
                  EN
                </button>
                <button
                  type="button"
                  className={`draft_lang_btn${dictationLangAr ? " draft_lang_btn--active" : ""}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setDictationLangAr((v) => !v)}
                  disabled={isDictating}
                >
                  AR
                </button>
              </div>
            </div>
            {dictationError && <span className="draft_tool_error">⚠ {dictationError}</span>}

            <span className="draft_toolbar_divider" />

            <button
              type="button"
              className="draft_tool_btn draft_tool_btn--ai"
              title="Summarize the selected text with AI"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => runAiTextTool("summarize")}
              disabled={aiToolBusy !== null}
            >
              <i className={`fi ${aiToolBusy === "summarize" ? "fi-rr-spinner draft_icon_spin" : "fi-rr-compress-alt"}`} /> Summarize
            </button>
            <button
              type="button"
              className="draft_tool_btn draft_tool_btn--ai"
              title="Enhance the selected text's clarity and grammar with AI"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => runAiTextTool("enhance")}
              disabled={aiToolBusy !== null}
            >
              <i className={`fi ${aiToolBusy === "enhance" ? "fi-rr-spinner draft_icon_spin" : "fi-rr-sparkles"}`} /> Enhance
            </button>
            <button
              type="button"
              className="draft_tool_btn draft_tool_btn--ai"
              title="Correct only contextual typos and word choice while preserving the text's structure and voice"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => runAiTextTool("correct")}
              disabled={aiToolBusy !== null}
            >
              <i className={`fi ${aiToolBusy === "correct" ? "fi-rr-spinner draft_icon_spin" : "fi-rr-check"}`} /> Correct
            </button>
            {aiToolError && <span className="draft_tool_error">⚠ {aiToolError}</span>}
          </div>

          <div id="draft_page_stack" ref={pageStackRef} onScroll={updatePageTracking}>
            <div
              id="draft_editor"
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              dir={isRtl ? "rtl" : "ltr"}
              onInput={handleInput}
              onKeyDown={handleEditorKeyDown}
              data-placeholder={isRtl
                ? "دوّن كل ما يخطر ببالك — يُحفظ هذا تلقائيًا أثناء الكتابة."
                : "Write down whatever you find — this autosaves as you go."}
              style={{
                width: pageWidthPx,
                minHeight: pageHeightPx,
                margin: "0 auto",
                padding: `${marginTopPx}px ${editorPaddingRightPx}px ${marginBottomPx}px ${editorPaddingLeftPx}px`,
                fontSize: `${scale}rem`,
                lineHeight: `${lineHeightPx}px`,
                backgroundColor: PAGE_COLOR,
                backgroundImage: [
                  // Coarse per-page cycle: transparent through the printable
                  // content area (lets the ruled lines below show through),
                  // then PAGE_COLOR through this page's bottom margin AND the
                  // next page's top margin (real padding — it must look like
                  // the page itself, not the desk behind it), with only a
                  // thin DESK_COLOR seam actually between the two pages.
                  `repeating-linear-gradient(to bottom,
                    transparent 0, transparent ${contentHeightPx}px,
                    ${PAGE_COLOR} ${contentHeightPx}px, ${PAGE_COLOR} ${contentHeightPx + marginBottomPx}px,
                    ${DESK_COLOR} ${contentHeightPx + marginBottomPx}px, ${DESK_COLOR} ${contentHeightPx + marginBottomPx + PAGE_GAP_EXTRA_PX}px,
                    ${PAGE_COLOR} ${contentHeightPx + marginBottomPx + PAGE_GAP_EXTRA_PX}px, ${PAGE_COLOR} ${pageCyclePx}px
                  )`,
                  `repeating-linear-gradient(to bottom, transparent 0, transparent ${lineHeightPx - 1}px, ${RULE_COLOR} ${lineHeightPx - 1}px, ${RULE_COLOR} ${lineHeightPx}px)`,
                  `linear-gradient(${MARGIN_COLOR}, ${MARGIN_COLOR})`,
                ].join(", "),
                // The red margin rule sits on the side writing starts from —
                // left for LTR, right for RTL — never both at once.
                backgroundPosition: `0 ${marginTopPx}px, 0 ${marginTopPx}px, ${isRtl ? `calc(100% - ${marginRightPx}px)` : `${marginLeftPx}px`} 0`,
                backgroundSize: "auto, auto, 1px 100%",
                backgroundRepeat: "repeat, repeat, no-repeat",
              }}
              autoFocus
            />
            {/* Page number (left) + document title (right), once per physical
                page — kept out of #draft_editor itself (not editable/
                selectable, not part of the saved content), positioned from
                the exact same pageCyclePx/contentHeightPx math that drives
                the page-background illusion above, so it lines up with each
                page's own bottom margin. top: "2rem" mirrors #draft_page_
                stack's own padding-top (draftPage.css) — that's the offset
                #draft_editor itself already gets for free by being a normal
                (not absolutely positioned) child. */}
            <div
              id="draft_page_footers"
              style={{ position: "absolute", top: "2rem", left: 0, right: 0, width: pageWidthPx, margin: "0 auto" }}
            >
              {Array.from({ length: pageCount }, (_, i) => (
                <div
                  key={i}
                  className="draft_page_footer"
                  style={{
                    top: i * pageCyclePx + contentHeightPx,
                    left: 0,
                    right: 0,
                    height: marginBottomPx,
                    paddingLeft: marginLeftPx,
                    paddingRight: marginRightPx,
                    boxSizing: "border-box",
                  }}
                >
                  <span className="draft_page_footer_num">{i + 1}</span>
                  <span className="draft_page_footer_title">{title}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default DraftPage;
