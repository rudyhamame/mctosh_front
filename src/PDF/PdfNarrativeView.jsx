import React, { useEffect, useRef, useState } from "react";
import "./pdfNarrativeView.css";
import { buildPageElements } from "./pdfPageEvidence.js";
import { getPageStructure, segmentPage, saveDraft, discardDraft, deleteStructure } from "./pdfPageStructureClient.js";
import { buildElementsById, reconstructSegmentText, itemIndexesForSegment, groupSegmentsByFlow, buildSegmentForest } from "./pdfSegmentTree.js";
import { makeRequestId, isResponseStillCurrent } from "./pdfSegmentationRequest.js";

// "Narrative Mode" — the ONE reading-projection tool in this app (there is
// no second Narrative Mode). It shows NOTHING for a page until the user
// explicitly clicks "AI Segment Page": a multimodal AI call (current page
// image + PDF.js text/geometry, both current-page-only, never queued for
// other pages) proposes a structural interpretation, which becomes a
// DRAFT the user reviews and must explicitly Save before it's accepted.
// Narrative Mode renders ONLY from that accepted (or draft) structure —
// never from raw PDF.js concatenation, never from geometry alone. See
// back/routes/PdfPageStructureAPI.js / back/helpers/pdfPageSegmenter.js
// for the backend half of this, and pdfSegmentTree.js for the pure
// tree/flow/text-reconstruction helpers this component renders from (kept
// separate so this file stays a state/UI coordinator, not a monolith).
//
// State machine per page (derived from what's stored, not a separate
// flag): NOT_SEGMENTED (neither draft nor saved) -> SEGMENTING (client-
// local, while a request is in flight) -> DRAFT (draft only) or MODIFIED
// (draft exists ALONGSIDE an existing saved version — re-segmented a
// saved page, saved stays authoritative until Save) -> SAVED (saved only,
// no pending draft) -> ERROR (client-local, a segment request failed).
// Loading existing draft/saved state on page navigation is a plain GET,
// never an AI call (spec §33) — the ONLY AI-triggering action anywhere in
// this component is handleSegment(), fired only from the button's onClick.

// Same local label map as ClinicalVignetteBuilderPanel.jsx/SmartVideoPanel.jsx
// (src/hooks/useAIProvider.js) — display labels only, not provider-selection state.
const PROVIDER_LABEL = {
  local: "Local (Ollama)",
  openai: "OpenAI",
  groq: "Groq",
  moonshot: "Kimi (Moonshot)",
  gemini: "Gemini",
};

const HEADING_LEVEL_TAG = { 1: "h2", 2: "h3", 3: "h4", 4: "h5", 5: "h6", 6: "h6" };
const HEADING_ROLES = new Set(["document_title", "chapter_title", "section_heading", "subheading", "subsubheading"]);
const ASIDE_ROLES = new Set(["aside", "sidebar", "clinical_pearl", "warning", "definition", "example", "summary", "key_point", "callout"]);
const LIST_ROLES = new Set(["list", "nested_list"]);
const CAPTIONED_ROLES = new Set(["figure", "diagram", "table"]);
const CAPTION_ROLES = new Set(["figure_caption", "table_caption"]);
const SKIPPED_ROLES = new Set(["header", "footer", "page_number"]); // spec §19 — never inserted into the main narrative flow
const FLOW_LABEL_ROLE_HINT = { clinical_pearl: "Clinical Pearl", warning: "Warning", definition: "Definition", example: "Example", summary: "Summary", key_point: "Key Point", callout: "Callout", aside: "Aside", sidebar: "Sidebar" };

const roleLabel = (segment) => FLOW_LABEL_ROLE_HINT[segment.subtype] || FLOW_LABEL_ROLE_HINT[segment.role] || (segment.role || "").replace(/_/g, " ");

/**
 * One segment node + its nested children, recursively. Children ALWAYS
 * render as siblings after this node's own element, never nested inside
 * it — a heading (or paragraph/caption/etc.) is a single text-level
 * element; putting block-level children inside it would both be invalid
 * HTML (`<h3><p>...</p></h3>`) and make its own click target swallow
 * every descendant's text. This matters in practice: it's common for the
 * AI to nest a section's own body paragraphs under that section's heading
 * via parentId (a reasonable "this content belongs to this heading"
 * interpretation) — the rendering has to handle that without merging
 * them into one element.
 */
// Confidence badge for the "Corrected" tab (spec-adjacent extension: the
// user asked that a correction's confidence be visible, not silently
// applied) — only rendered in that tab, and only when the model actually
// supplied a confidence value for this segment's rejoin.
const CORRECTION_CONFIDENCE_CLASS = (value) => (
  value >= 0.85 ? "narrative_correction_confidence--high"
    : value >= 0.6 ? "narrative_correction_confidence--medium"
      : "narrative_correction_confidence--low"
);
const CorrectionConfidenceBadge = ({ confidence }) => (
  confidence == null ? null : (
    <span className={`narrative_correction_confidence ${CORRECTION_CONFIDENCE_CLASS(confidence)}`} title="AI correction confidence">
      {Math.round(confidence * 100)}%
    </span>
  )
);

const SegmentNode = ({ node, elementsById, onJumpToSource, textMode, depth = 0 }) => {
  if (SKIPPED_ROLES.has(node.role)) return null;
  // "Verbatim" always reconstructs straight from the original PDF.js
  // elements (ground truth, never touched by AI). "Corrected" prefers the
  // AI's rejoined text for readability, but falls back to verbatim if the
  // model left correctedText empty (e.g. a non-OpenAI provider, or a
  // segment that genuinely needed no correction).
  const verbatimText = reconstructSegmentText(node, elementsById);
  const text = textMode === "corrected" ? (node.correctedText?.trim() || verbatimText) : verbatimText;
  const confidenceBadge = textMode === "corrected" ? <CorrectionConfidenceBadge confidence={node.correctionConfidence} /> : null;
  const handleClick = (event) => {
    event.stopPropagation();
    onJumpToSource?.(itemIndexesForSegment(node));
  };
  const childrenNodes = node.children?.length
    ? node.children.map((child) => (
      <SegmentNode key={child.id} node={child} elementsById={elementsById} onJumpToSource={onJumpToSource} textMode={textMode} depth={depth + 1} />
    ))
    : null;

  // Lists are the one legitimate case where children visually nest INSIDE
  // the parent element (a sub-list belongs inside its parent <ul>).
  if (LIST_ROLES.has(node.role)) {
    return (
      <ul className="narrative_seg_list" style={{ marginLeft: depth ? "1rem" : 0 }}>
        {text && <li className="narrative_seg_list_item" onClick={handleClick} title="Jump to source">{text}{confidenceBadge}</li>}
        {childrenNodes}
      </ul>
    );
  }

  let own = null;
  if (HEADING_ROLES.has(node.role)) {
    const Tag = HEADING_LEVEL_TAG[node.level] || "h4";
    own = text ? <Tag className="narrative_seg_heading" onClick={handleClick} title="Jump to source">{text}{confidenceBadge}</Tag> : null;
  } else if (ASIDE_ROLES.has(node.role)) {
    own = (
      <div className="narrative_seg_aside" onClick={handleClick} title="Jump to source">
        <div className="narrative_seg_aside_label">{roleLabel(node)}</div>
        {text && <p className="narrative_seg_aside_text">{text}{confidenceBadge}</p>}
      </div>
    );
  } else if (CAPTIONED_ROLES.has(node.role)) {
    own = (
      <div className="narrative_seg_figure" onClick={handleClick} title="Jump to source">
        <div className="narrative_seg_figure_label">{roleLabel(node) || "Figure"}</div>
        {text && <p className="narrative_seg_figure_text">{text}{confidenceBadge}</p>}
      </div>
    );
  } else if (CAPTION_ROLES.has(node.role)) {
    own = text ? <p className="narrative_seg_caption" onClick={handleClick} title="Jump to source">{text}{confidenceBadge}</p> : null;
  } else if (node.role === "toc_entry" || node.role === "index_entry") {
    own = text ? (
      <div className="narrative_seg_toc_row" style={{ marginLeft: `${(node.level || 1) * 0.9}rem` }} onClick={handleClick} title="Jump to source">
        {text}{confidenceBadge}
      </div>
    ) : null;
  } else if (node.role === "footnote") {
    own = text ? <p className="narrative_seg_footnote" onClick={handleClick} title="Jump to source">{text}{confidenceBadge}</p> : null;
  } else {
    // paragraph / main_content / question / answer / explanation / case_vignette / unknown / anything else generic.
    own = text ? <p className="narrative_seg_paragraph" onClick={handleClick} title="Jump to source">{text}{confidenceBadge}</p> : null;
  }

  if (!childrenNodes) return own;
  return <>{own}{childrenNodes}</>;
};

/** Running header/footer/page-number segments — page furniture, kept out of the reading flow but never hidden (nothing on the page is omitted). */
const PageFurnitureStrip = ({ className, segments, elementsById, onJumpToSource, textMode }) => {
  if (!segments.length) return null;
  return (
    <div className={className}>
      {segments.map((seg) => {
        const furnitureText = textMode === "corrected"
          ? (seg.correctedText?.trim() || reconstructSegmentText(seg, elementsById))
          : reconstructSegmentText(seg, elementsById);
        if (!furnitureText) return null;
        return (
          <span
            key={seg.id}
            className="narrative_page_furniture_text"
            onClick={(event) => { event.stopPropagation(); onJumpToSource?.(itemIndexesForSegment(seg)); }}
            title="Jump to source"
          >
            {furnitureText}
          </span>
        );
      })}
    </div>
  );
};

// A single full-page AI call (image + all text elements, one pass) has no
// server-pushed progress events to report — there's no websocket/SSE here,
// just one request that resolves once. Rather than a bare spinner for
// what's routinely a 15-45s wait on a dense page, this ticks a real
// elapsed-time clock (the one thing we DO know client-side) and cycles
// through the general kinds of work a structural pass actually does —
// phrased as ongoing activity ("Identifying headings…"), not a literal
// step tracker, so it stays honest about what is/isn't actually observed.
const SEGMENTING_PHASES = [
  "Reading page layout and text positions",
  "Identifying headings, paragraphs, and asides",
  "Determining reading order across flows",
  "Structuring tables, figures, and captions",
  "Validating the proposed structure",
];

const useElapsedSeconds = (active, startedAt) => {
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    if (!active || !startedAt) { setElapsedMs(0); return; }
    setElapsedMs(Date.now() - startedAt);
    const timer = setInterval(() => setElapsedMs(Date.now() - startedAt), 250);
    return () => clearInterval(timer);
  }, [active, startedAt]);
  return Math.floor(elapsedMs / 1000);
};

const formatElapsed = (totalSeconds) => (
  totalSeconds >= 60 ? `${Math.floor(totalSeconds / 60)}m ${totalSeconds % 60}s` : `${totalSeconds}s`
);

/** Full-panel loader — shown while segmenting a page that has no draft/saved structure yet to keep showing underneath. */
const SegmentingLoader = ({ pageNumber, elementCount, startedAt }) => {
  const elapsedSeconds = useElapsedSeconds(true, startedAt);
  const [phaseIndex, setPhaseIndex] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setPhaseIndex((i) => (i + 1) % SEGMENTING_PHASES.length), 2200);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="narrative_segmenting_loader">
      <i className="bx bx-loader-circle pdf_icon_spin narrative_segmenting_spinner" />
      <p className="narrative_segmenting_title">Segmenting page {pageNumber}…</p>
      <div className="narrative_segmenting_progress"><div className="narrative_segmenting_progress_bar" /></div>
      <p className="narrative_segmenting_phase">{SEGMENTING_PHASES[phaseIndex]}…</p>
      <p className="narrative_segmenting_meta">
        {elementCount != null && `Analyzing ${elementCount} text elements and the page image · `}
        {formatElapsed(elapsedSeconds)} elapsed
      </p>
      <p className="narrative_segmenting_hint">
        This is a single full-page AI pass, not a queue — larger or denser pages (tables of contents, indexes) take longer.
      </p>
    </div>
  );
};

/** Compact inline banner — shown alongside the still-visible existing draft/saved content while re-segmenting. */
const SegmentingBanner = ({ pageNumber, startedAt }) => {
  const elapsedSeconds = useElapsedSeconds(true, startedAt);
  return (
    <div className="narrative_status_banner narrative_status_banner--active">
      <i className="bx bx-loader-circle pdf_icon_spin" /> Generating a new draft for page {pageNumber}… ({formatElapsed(elapsedSeconds)})
    </div>
  );
};

const FlowBlock = ({ flow, elementsById, onJumpToSource, textMode }) => {
  const forest = buildSegmentForest(flow.segments);
  if (!forest.length) return null;
  const isMain = flow.flowId === "main";
  return (
    <div className={`narrative_seg_flow${isMain ? "" : " narrative_seg_flow--aside"}`}>
      {forest.map((node) => (
        <SegmentNode key={node.id} node={node} elementsById={elementsById} onJumpToSource={onJumpToSource} textMode={textMode} />
      ))}
    </div>
  );
};

const PdfNarrativeView = ({
  onClose,
  pageNumber,
  documentId,
  getPageTextItems,
  captureCurrentPageImage,
  onJumpToSource,
  debugOverlayOn = false,
  onToggleDebugOverlay = null,
  onStructureChange = null,
  provider,
  providerModels,
}) => {
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [structureState, setStructureState] = useState({ status: "NOT_SEGMENTED", draft: null, saved: null });
  const [segmentingRequestId, setSegmentingRequestId] = useState(null);
  const [segmentingStartedAt, setSegmentingStartedAt] = useState(null);
  const [segmentingElementCount, setSegmentingElementCount] = useState(null);
  const [segmentError, setSegmentError] = useState("");
  const [lastSegmentResult, setLastSegmentResult] = useState(null); // actual {provider, model} the last segment call resolved to
  const [busyAction, setBusyAction] = useState(null); // "save" | "discard" | null
  // "verbatim" (default, ground truth — reconstructSegmentText straight
  // from the original PDF.js elements) vs "corrected" (AI-rejoined text,
  // fixing extraction-level word-splitting artifacts, each with its own
  // visible confidence — see pdfPageSegmenter.js's correctedText rule).
  const [textMode, setTextMode] = useState("verbatim");

  const currentPageNumberRef = useRef(pageNumber);
  useEffect(() => { currentPageNumberRef.current = pageNumber; }, [pageNumber]);
  // Identity of the most recently ISSUED segment request — survives page
  // navigation on purpose, so a late-arriving response for a page the
  // user has since left can still be recognized as stale (see
  // handleSegment's own comment for the exact race this guards).
  const latestRequestRef = useRef(null);

  // Loading existing draft/saved structure on page navigation — plain
  // read, never AI (spec §33/69). Deliberately does NOT fall back to any
  // geometry/raw-text reconstruction on error or absence (spec §4/56) —
  // NOT_SEGMENTED and ERROR both render an explicit empty/error state.
  useEffect(() => {
    if (!documentId || pageNumber == null) { setStructureState({ status: "NOT_SEGMENTED", draft: null, saved: null }); return; }
    let cancelled = false;
    setLoading(true);
    setLoadError("");
    setSegmentError("");
    setSegmentingRequestId(null);
    setSegmentingStartedAt(null);
    setSegmentingElementCount(null);
    getPageStructure(documentId, pageNumber)
      .then((data) => { if (!cancelled) setStructureState(data); })
      .catch((err) => { if (!cancelled) setLoadError(err?.message || "Could not load this page's structure."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [documentId, pageNumber]);

  useEffect(() => {
    onStructureChange?.(structureState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structureState]);

  const handleSegment = async () => {
    if (!documentId || pageNumber == null || !getPageTextItems || !captureCurrentPageImage) return;
    setSegmentError("");
    const requestId = makeRequestId();
    const requestedPageNumber = pageNumber; // frozen — this exact value is what gets sent, matching what the server persists under
    latestRequestRef.current = { pageNumber: requestedPageNumber, requestId };
    setSegmentingRequestId(requestId);
    setSegmentingStartedAt(Date.now());
    setSegmentingElementCount(null);
    try {
      const pageImageBase64 = captureCurrentPageImage();
      if (!pageImageBase64) throw new Error("Could not capture the current page image.");
      const textItems = await getPageTextItems(requestedPageNumber);
      const elements = buildPageElements(requestedPageNumber, textItems);
      if (isResponseStillCurrent({ latestRequest: latestRequestRef.current, currentPageNumber: currentPageNumberRef.current, requestedPageNumber, requestId })) {
        setSegmentingElementCount(elements.length);
      }
      // provider is respected (still whatever the user has selected), but
      // no explicit `model` override — page segmentation sends the whole
      // page's evidence in one request (confirmed live: a dense page can
      // need 15-20K+ tokens) and a user's own configured model for other,
      // lighter AI features can have a much lower per-minute token budget
      // (confirmed: Groq's free-tier llama-3.1-8b-instant caps at 6000
      // TPM). Omitting model lets the backend fall back to
      // defaultModel[provider] (aiClient.js) — that provider's own
      // general-purpose default, better suited to a heavier one-shot call.
      const data = await segmentPage(documentId, requestedPageNumber, {
        pageImageBase64, elements, requestId, provider,
      });
      // Freeze-the-request-page (spec §3, pdfSegmentationRequest.js): only
      // apply if this is still the LATEST request issued AND the user is
      // still looking at the same page it was issued for. If they've
      // navigated away, the draft is already correctly persisted
      // server-side under requestedPageNumber (the request URL itself
      // carries that) — navigating back later loads it for free via the
      // read-only GET above, no re-call needed.
      if (isResponseStillCurrent({ latestRequest: latestRequestRef.current, currentPageNumber: currentPageNumberRef.current, requestedPageNumber, requestId })) {
        setStructureState(data);
        setSegmentingRequestId(null);
        setSegmentingStartedAt(null);
        setLastSegmentResult({ provider: data.draft?.provider, model: data.draft?.model });
      }
    } catch (err) {
      if (isResponseStillCurrent({ latestRequest: latestRequestRef.current, currentPageNumber: currentPageNumberRef.current, requestedPageNumber, requestId })) {
        setSegmentError(err.message || "Page segmentation failed.");
        setSegmentingRequestId(null);
        setSegmentingStartedAt(null);
      }
    }
  };

  const handleSave = async () => {
    if (!documentId || pageNumber == null) return;
    setBusyAction("save");
    try {
      const data = await saveDraft(documentId, pageNumber);
      setStructureState(data);
    } catch (err) {
      setSegmentError(err.message || "Save failed.");
    } finally {
      setBusyAction(null);
    }
  };

  const handleDiscard = async () => {
    if (!documentId || pageNumber == null) return;
    setBusyAction("discard");
    try {
      const data = await discardDraft(documentId, pageNumber);
      setStructureState(data);
    } catch (err) {
      setSegmentError(err.message || "Reset failed.");
    } finally {
      setBusyAction(null);
    }
  };

  // Deletes BOTH draft and saved — distinct from Reset, which only clears
  // a pending draft and leaves an existing saved structure untouched.
  // This reverts the page all the way back to NOT_SEGMENTED. Irreversible
  // (the AI would have to be re-run from scratch), so it's confirmed —
  // same window.confirm convention PDFPage.jsx already uses for its own
  // destructive markdown-cache deletes.
  const handleDelete = async () => {
    if (!documentId || pageNumber == null) return;
    const message = saved
      ? "Delete this page's AI segmentation, including the saved structure? The original PDF is untouched — you can re-segment this page again later, but any current review progress will be lost."
      : "Discard this draft segmentation? The original PDF is untouched.";
    if (!window.confirm(message)) return;
    setSegmentError("");
    setBusyAction("delete");
    try {
      const data = await deleteStructure(documentId, pageNumber);
      setStructureState(data);
      setLastSegmentResult(null);
    } catch (err) {
      setSegmentError(err.message || "Delete failed.");
    } finally {
      setBusyAction(null);
    }
  };

  const { status, draft, saved } = structureState;
  const isSegmenting = !!segmentingRequestId;
  const activeStructure = draft || saved; // draft takes preview priority while under review
  const elementsById = activeStructure ? buildElementsById(activeStructure.elements) : null;
  const flows = activeStructure ? groupSegmentsByFlow(activeStructure.segments) : [];
  // header/footer/page_number segments (running banner, running footer,
  // page number) stay out of the main reading flow — they're page
  // furniture, not content — but per the "omit nothing" rule every
  // element must land in SOME segment, so these still get surfaced,
  // de-emphasized above/below the actual content rather than hidden or
  // interleaved into it.
  const headerSegments = activeStructure ? activeStructure.segments.filter((s) => s.role === "header") : [];
  const footerSegments = activeStructure ? activeStructure.segments.filter((s) => s.role === "footer" || s.role === "page_number") : [];

  return (
    <div id="narrative_view_panel" onMouseDown={(event) => event.stopPropagation()}>
      <div id="narrative_view_header">
        <span id="narrative_view_header_title">
          <i className="bx bx-align-left" /> Narrative Mode
        </span>
        {onToggleDebugOverlay && (
          <label id="narrative_view_debug_toggle" title="Show detected segments on the PDF">
            <input type="checkbox" checked={debugOverlayOn} onChange={onToggleDebugOverlay} />
            Debug overlay
          </label>
        )}
        <button type="button" id="narrative_view_close" onClick={onClose} title="Close">✕</button>
      </div>

      {/* Pinned above the scrollable body (not inside it) — the tabs
          control how ALL of the content below reads, so they stay visible
          above everything else regardless of scroll position, rather than
          scrolling away with the segments themselves. */}
      {activeStructure && (
        <div id="narrative_text_mode_tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={textMode === "verbatim"}
            className={`narrative_text_mode_tab${textMode === "verbatim" ? " narrative_text_mode_tab--active" : ""}`}
            onClick={() => setTextMode("verbatim")}
            title="Exactly as extracted from the PDF, untouched by AI"
          >
            Verbatim
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={textMode === "corrected"}
            className={`narrative_text_mode_tab${textMode === "corrected" ? " narrative_text_mode_tab--active" : ""}`}
            onClick={() => setTextMode("corrected")}
            title="AI-rejoined text (fixes word-splitting from PDF extraction), with per-segment confidence"
          >
            Corrected
          </button>
        </div>
      )}

      <div id="narrative_view_body">
        {loading && <div className="entity_builder_status">Loading page {pageNumber}…</div>}
        {!loading && loadError && <div className="entity_builder_status entity_builder_status--error"><i className="bx bx-error" /> {loadError}</div>}
        {segmentError && <div className="entity_builder_status entity_builder_status--error"><i className="bx bx-error" /> {segmentError}</div>}

        {!loading && !loadError && !activeStructure && !isSegmenting && (
          <div className="narrative_empty_state">
            <p>This page has not been segmented.</p>
            <button type="button" className="narrative_primary_btn" onClick={handleSegment}>
              <i className="bx bx-scan" /> AI Segment Page
            </button>
          </div>
        )}

        {!loading && !loadError && !activeStructure && isSegmenting && (
          <SegmentingLoader pageNumber={pageNumber} elementCount={segmentingElementCount} startedAt={segmentingStartedAt} />
        )}

        {!loading && !loadError && activeStructure && (
          <>
            {isSegmenting && <SegmentingBanner pageNumber={pageNumber} startedAt={segmentingStartedAt} />}
            {!isSegmenting && status === "MODIFIED" && (
              <div className="narrative_status_banner">
                Reviewing a new draft (v{draft.version}) — your saved structure (v{saved.version}) stays active until you Save.
              </div>
            )}
            <PageFurnitureStrip
              className="narrative_page_header_strip"
              segments={headerSegments}
              elementsById={elementsById}
              onJumpToSource={onJumpToSource}
              textMode={textMode}
            />
            {activeStructure.pageType && activeStructure.pageType !== "unknown" && (
              <div className="narrative_page_type_badge">{activeStructure.pageType.replace(/_/g, " ")}</div>
            )}
            {flows.map((flow) => (
              <FlowBlock key={flow.flowId} flow={flow} elementsById={elementsById} onJumpToSource={onJumpToSource} textMode={textMode} />
            ))}
            <PageFurnitureStrip
              className="narrative_page_footer_strip"
              segments={footerSegments}
              elementsById={elementsById}
              onJumpToSource={onJumpToSource}
              textMode={textMode}
            />
          </>
        )}
      </div>

      {/* Action bar — button set follows the page's own status exactly,
          per spec §66: NOT_SEGMENTED shows only the segment button (in
          the empty state above), SEGMENTING disables it, DRAFT/MODIFIED
          offer Save + Reset + Re-segment, SAVED offers only Re-segment
          (a structure editor is a deferred follow-up, not stubbed here). */}
      {activeStructure && (
        <div id="narrative_view_actions">
          <button type="button" className="narrative_secondary_btn" disabled={isSegmenting} onClick={handleSegment}>
            <i className={isSegmenting ? "bx bx-loader-circle pdf_icon_spin" : "bx bx-refresh"} />
            {isSegmenting ? "Segmenting…" : "Re-segment Page"}
          </button>
          {draft && (
            <>
              <button type="button" className="narrative_secondary_btn" disabled={busyAction != null} onClick={handleDiscard}>
                {busyAction === "discard" ? "Resetting…" : "Reset"}
              </button>
              <button type="button" className="narrative_primary_btn" disabled={busyAction != null} onClick={handleSave}>
                {busyAction === "save" ? "Saving…" : "Save"}
              </button>
            </>
          )}
          {!draft && saved && <span className="narrative_saved_badge"><i className="bx bx-check" /> Saved</span>}
          <button
            type="button"
            className="narrative_danger_btn"
            disabled={busyAction != null || isSegmenting}
            onClick={handleDelete}
            title="Delete this page's AI segmentation entirely — the original PDF is untouched"
          >
            <i className="bx bx-trash" />
            {busyAction === "delete" ? "Deleting…" : "Delete"}
          </button>
        </div>
      )}

      {/* Pinned outside the scrollable body — same convention as
          ClinicalVignetteBuilderPanel.jsx's/SmartVideoPanel.jsx's own
          footer. Model name: prefer the ACTUAL model the last successful
          segmentation call resolved to, otherwise fall back to
          providerModels[provider] from GET /api/settings/ai-status. */}
      {provider && (
        <div id="narrative_view_footer">
          <i className="bx bx-chip" />
          You are using: {lastSegmentResult?.provider ? (PROVIDER_LABEL[lastSegmentResult.provider] || lastSegmentResult.provider) : (PROVIDER_LABEL[provider] || provider)}
          {(lastSegmentResult?.model || providerModels?.[provider]) && (
            <span id="narrative_view_footer_model"> · {lastSegmentResult?.model || providerModels[provider]}</span>
          )}
        </div>
      )}
    </div>
  );
};

export default PdfNarrativeView;
