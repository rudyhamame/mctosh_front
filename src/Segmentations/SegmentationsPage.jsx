import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./segmentationsPage.css";
import "../ClinicalSchemata/morphePanels.css";
import { apiUrl } from "../config/api";
import { readStoredSession } from "../utils/sessionCleanup";
import { useAIProvider, AI_PROVIDERS } from "../hooks/useAIProvider";
import { useAllSegments, segmentKeyFor } from "./useAllSegments";
import { createRelationsExtraction, reviewRelationsExtraction, saveRelationsExtraction } from "./amctoshsRelationsExtractionClient";
import AmctoshsRelationsReviewList from "./AmctoshsRelationsReviewList";
import {
  createPredicateExtraction, reviewPredicateExtraction, analyzePredicateExtraction,
  reviewPredicateAnalysis, savePredicateAnalysis,
} from "./amctoshsPredicateExtractionClient";
import AmctoshsPredicateExtractionReviewList from "./AmctoshsPredicateExtractionReviewList";
import AmctoshsPredicateAnalysisReviewList from "./AmctoshsPredicateAnalysisReviewList";

// AMCTOSHS Segmentation — the single reservoir of every AMCTOSHS Segment
// (a content BBox, drawn and text-extracted in the PDF Reader — see
// PDF/EntityBuilderPanel.jsx, the same BBOX_CARD_TYPES source of truth)
// across ALL of the user's source documents at once, grouped by source in
// a left aside (fetch/flatten logic lives in useAllSegments.js, shared
// with AMCTOSHS Morphe's own browse page). Each segment carries its own
// source + page so it can always be traced back and opened directly in
// the PDF Reader.
//
// This page also OWNS the "Extract AMCTOSHS Relations" action (button
// text exact per spec — never "Extract Morphe"): the user checks one or
// more stored segments, clicks the button, reviews the proposed free-text
// Relations (subject/predicate/object phrases decomposed straight from
// the segment text — this stage never classifies anything into an ontic
// category) inline, and accepted results are saved into AMCTOSHS Morphe
// (a separate page) — the structured destination they're later browsed/
// edited in, not the actor that triggers extraction.
//
// A second, independent workflow lives on this page too: "Extract
// Predicates" -> "Analyze Predicates" (back/routes/AMCTOSHSPredicateAPI.js).
// It shares the same segment selection but is a SEPARATE, strictly
// linguistic pipeline (predicate-argument structure, grammatical head/
// core decomposition) — it never classifies anything into an AMCTOSHS
// ontic category either, and Predicate Analysis only ever runs over
// predicate assertions the user has already accepted from Predicate
// Extraction (never auto-chained).

const previewText = (text, max = 110) => {
  const flat = String(text || "").replace(/\s+/g, " ").trim();
  if (!flat) return "";
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

// Locates a relation's first evidence_text span inside the raw segment
// text — exact match first, falling back to a case-insensitive search
// (the AI's quote can differ in case from the source) — so its reference
// number can be anchored at the right position.
const findEvidenceStart = (text, evidenceText) => {
  if (!evidenceText) return -1;
  const exact = text.indexOf(evidenceText);
  if (exact !== -1) return exact;
  return text.toLowerCase().indexOf(evidenceText.toLowerCase());
};

// Same numbered-reference convention as AmctoshsRelationsReviewList.jsx's
// row titles (index+1 into normalizedResponse.relations, the same order
// reviewedItems/the review list itself use) — but applied to the RAW
// segment text this time, so a reviewer can see exactly where each
// numbered relation's evidence sits within the source sentence(s), not
// just in the review list below.
const buildSegmentTextWithRefs = (text, relations, segmentId) => {
  if (!text || !relations?.length) return [text];
  const marks = [];
  relations.forEach((relation, i) => {
    if (!relation.source_segment_ids?.includes(segmentId)) return;
    const start = findEvidenceStart(text, relation.evidence_text?.[0]);
    if (start === -1) return;
    marks.push({ start, ref: i + 1 });
  });
  if (!marks.length) return [text];

  marks.sort((a, b) => a.start - b.start);
  const grouped = [];
  for (const m of marks) {
    const last = grouped[grouped.length - 1];
    if (last && last.start === m.start) last.refs.push(m.ref);
    else grouped.push({ start: m.start, refs: [m.ref] });
  }

  const nodes = [];
  let cursor = 0;
  grouped.forEach((g, i) => {
    if (g.start > cursor) nodes.push(text.slice(cursor, g.start));
    nodes.push(<sup key={`ref-${i}`} className="segp_seg_text_ref">{g.refs.join(",")}</sup>);
    cursor = g.start;
  });
  nodes.push(text.slice(cursor));
  return nodes;
};

export default function SegmentationsPage() {
  const navigate = useNavigate();

  const {
    sources, sourceGroups, totalSegments, listBusy,
    sourcesError, annotationsError, clearErrors,
  } = useAllSegments();

  const [selectedSegmentKey, setSelectedSegmentKey] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [selectedKeys, setSelectedKeys] = useState(() => new Set());
  const [extraction, setExtraction] = useState(null);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState("");
  const [reviewBusy, setReviewBusy] = useState(false);

  // "Extract Predicates" -> "Analyze Predicates" — a fully parallel state
  // block, driven by the same selectedKeys/allSegmentsByKey, never
  // auto-chained (analyzing only ever starts on an explicit button click,
  // gated on there being at least one accepted predicate assertion).
  const [predicateExtraction, setPredicateExtraction] = useState(null);
  const [predicateExtracting, setPredicateExtracting] = useState(false);
  const [predicateExtractError, setPredicateExtractError] = useState("");
  const [predicateReviewBusy, setPredicateReviewBusy] = useState(false);
  const [predicateAnalysis, setPredicateAnalysis] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState("");
  const [analysisReviewBusy, setAnalysisReviewBusy] = useState(false);

  // Which AI provider "Extract AMCTOSHS Relations" runs against — inherits
  // the app-wide default set on the Settings page's AI Providers section
  // (src/hooks/useAIProvider.js, localStorage key "mctosh_ai_provider").
  // No per-page override here — shown read-only in the footer below.
  const { provider } = useAIProvider();
  // providerId -> model, from the SAME /api/settings/ai-status the Settings
  // page's AI Providers section and PDFPage.jsx's own "you are using"
  // footers already use — one source of truth for the currently
  // configured model per provider, not a hardcoded guess.
  const [aiProviderModels, setAiProviderModels] = useState({});
  useEffect(() => {
    const session = readStoredSession();
    if (!session?.token) return;
    fetch(apiUrl("/api/settings/ai-status"), { headers: { Authorization: `Bearer ${session.token}` } })
      .then((res) => res.json())
      .then((data) => {
        const byId = {};
        for (const p of data.providers || []) byId[p.id] = p.model;
        setAiProviderModels(byId);
      })
      .catch(() => {}); // the provider label alone is still shown if this fails
  }, []);
  const providerLabel = AI_PROVIDERS.find((p) => p.id === provider)?.label || provider;
  const currentModelLabel = extraction?.extractionModel || aiProviderModels[provider] || "";

  const allSegmentsByKey = useMemo(() => {
    const map = new Map();
    for (const group of sourceGroups) for (const seg of group.segments) map.set(seg.key, seg);
    return map;
  }, [sourceGroups]);

  const selectedSegment = useMemo(() => (
    selectedSegmentKey ? allSegmentsByKey.get(selectedSegmentKey) || null : null
  ), [allSegmentsByKey, selectedSegmentKey]);

  const selectSegment = (key) => {
    setSelectedSegmentKey(key);
    setDrawerOpen(false);
  };

  const toggleSegmentSelected = (key, ev) => {
    ev?.stopPropagation();
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const clearSelection = () => setSelectedKeys(new Set());

  // Traces a segment back to its own source document, open to the exact
  // page it was drawn on — PDFReaderWorkspace/PDFPage both read
  // location.state.page on mount (see SourcesPage.jsx's own openSource
  // for the same sourceId/pdfName navigation shape).
  const openSegmentSource = (segment, ev) => {
    ev?.stopPropagation();
    navigate("/pdf-reader", { state: { sourceId: segment.sourceId, pdfName: segment.sourceName, page: segment.pageNum } });
  };

  const extractRelations = async () => {
    const segments = [...selectedKeys]
      .map((key) => allSegmentsByKey.get(key))
      .filter((seg) => seg && !seg.isImage)
      .map((seg) => ({
        sourceId: seg.sourceId, pageNum: seg.pageNum, segmentBboxId: seg.bbox.id,
        segmentText: seg.bbox.text || "", containerName: seg.container_name || null,
      }));
    if (!segments.length) return;

    setExtracting(true);
    setExtractError("");
    try {
      const doc = await createRelationsExtraction({ segments, provider });
      setExtraction(doc);
    } catch (err) {
      setExtractError(err.message || "Extraction failed.");
      if (err.extraction) setExtraction(err.extraction);
    } finally {
      setExtracting(false);
    }
  };

  const handleDecide = async (tempId, decision, editedFields) => {
    if (!extraction) return;
    setReviewBusy(true);
    try {
      const updated = await reviewRelationsExtraction(extraction._id, [{ tempId, decision, editedFields }]);
      setExtraction(updated);
    } catch (err) {
      setExtractError(err.message || "Failed to update the review.");
    } finally {
      setReviewBusy(false);
    }
  };

  const handleSaveAccepted = async (tempIds) => {
    if (!extraction) return;
    setReviewBusy(true);
    try {
      const { extraction: updated } = await saveRelationsExtraction(extraction._id, tempIds);
      setExtraction(updated);
    } catch (err) {
      setExtractError(err.message || "Failed to save the accepted results.");
    } finally {
      setReviewBusy(false);
    }
  };

  const extractPredicates = async () => {
    const segments = [...selectedKeys]
      .map((key) => allSegmentsByKey.get(key))
      .filter((seg) => seg && !seg.isImage)
      .map((seg) => ({
        sourceId: seg.sourceId, pageNum: seg.pageNum, segmentBboxId: seg.bbox.id,
        segmentText: seg.bbox.text || "", containerName: seg.container_name || null,
      }));
    if (!segments.length) return;

    setPredicateExtracting(true);
    setPredicateExtractError("");
    setPredicateAnalysis(null);
    setAnalyzeError("");
    try {
      const doc = await createPredicateExtraction({ segments, provider });
      setPredicateExtraction(doc);
    } catch (err) {
      setPredicateExtractError(err.message || "Predicate extraction failed.");
      if (err.extraction) setPredicateExtraction(err.extraction);
    } finally {
      setPredicateExtracting(false);
    }
  };

  const handlePredicateDecide = async (tempId, decision, editedFields) => {
    if (!predicateExtraction) return;
    setPredicateReviewBusy(true);
    try {
      const updated = await reviewPredicateExtraction(predicateExtraction._id, [{ tempId, decision, editedFields }]);
      setPredicateExtraction(updated);
    } catch (err) {
      setPredicateExtractError(err.message || "Failed to update the review.");
    } finally {
      setPredicateReviewBusy(false);
    }
  };

  const handleAnalyze = async () => {
    if (!predicateExtraction) return;
    setAnalyzing(true);
    setAnalyzeError("");
    try {
      const doc = await analyzePredicateExtraction(predicateExtraction._id, { provider });
      setPredicateAnalysis(doc);
    } catch (err) {
      setAnalyzeError(err.message || "Predicate analysis failed.");
      if (err.analysis) setPredicateAnalysis(err.analysis);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleAnalysisDecide = async (tempId, decision, editedFields) => {
    if (!predicateAnalysis) return;
    setAnalysisReviewBusy(true);
    try {
      const updated = await reviewPredicateAnalysis(predicateAnalysis._id, [{ tempId, decision, editedFields }]);
      setPredicateAnalysis(updated);
    } catch (err) {
      setAnalyzeError(err.message || "Failed to update the review.");
    } finally {
      setAnalysisReviewBusy(false);
    }
  };

  const handleSaveAnalysisAccepted = async (tempIds) => {
    if (!predicateAnalysis) return;
    setAnalysisReviewBusy(true);
    try {
      const { analysis: updated } = await savePredicateAnalysis(predicateAnalysis._id, tempIds);
      setPredicateAnalysis(updated);
    } catch (err) {
      setAnalyzeError(err.message || "Failed to save the accepted results.");
    } finally {
      setAnalysisReviewBusy(false);
    }
  };

  const asideContent = (
    <>
      <div id="segp_left_head">
        <span className="segp_panel_label">Segments</span>
        <span className="segp_count_pill">{totalSegments}</span>
      </div>

      <div id="segp_segment_list">
        {listBusy ? (
          <div className="segp_empty">
            <i className="bx bx-loader-circle segp_icon_spin" />
            <p>Loading segments…</p>
          </div>
        ) : sources.length === 0 ? (
          <div className="segp_empty">
            <i className="fi fi-rr-shapes" />
            <p>No source documents yet.</p>
            <p className="segp_empty_hint">Add a PDF in AMCTOSHS Hyle first.</p>
          </div>
        ) : totalSegments === 0 ? (
          <div className="segp_empty">
            <i className="fi fi-rr-shapes" />
            <p>No segments found across any source yet.</p>
            <p className="segp_empty_hint">Draw content Segments in the PDF Reader first.</p>
          </div>
        ) : (
          sourceGroups.map((group) => (
            <div key={group.sourceId} className="segp_source_group">
              <div className="segp_source_group_head">
                <i className="fi fi-rr-file-pdf" />
                <span className="segp_source_group_name">{group.sourceName}</span>
                <span className="segp_inst_count">{group.segments.length}</span>
                <button
                  type="button"
                  className="segp_source_open_btn"
                  title={`Open "${group.sourceName}" in the PDF Reader`}
                  onClick={(ev) => openSegmentSource(group.segments[0], ev)}
                >
                  <i className="fi fi-rr-arrow-up-right-from-square" />
                </button>
              </div>
              {group.segments.map((seg) => (
                <button
                  key={seg.key}
                  type="button"
                  className={`segp_segment_row${selectedSegmentKey === seg.key ? " segp_segment_row--active" : ""}`}
                  onClick={() => selectSegment(seg.key)}
                >
                  {!seg.isImage && (
                    <input
                      type="checkbox"
                      className="segp_segment_checkbox"
                      checked={selectedKeys.has(seg.key)}
                      onClick={(ev) => ev.stopPropagation()}
                      onChange={(ev) => toggleSegmentSelected(seg.key, ev)}
                      title="Select for AMCTOSHS Relations extraction"
                    />
                  )}
                  <i className={seg.isImage ? "fi fi-rr-picture" : "fi fi-rr-text"} />
                  <span className="segp_segment_row_text">
                    <span className="segp_segment_row_title">{seg.displayTitle}</span>
                    {!seg.isImage && (
                      <span className="segp_segment_row_preview">
                        {previewText(seg.bbox.text) || "No text extracted yet."}
                      </span>
                    )}
                  </span>
                  <span className="segp_segment_row_page">p.{seg.pageNum}</span>
                </button>
              ))}
            </div>
          ))
        )}
      </div>
    </>
  );

  return (
    <div id="segp_root">
      <div id="segp_header">
        <button id="segp_back" onClick={() => navigate("/home")} title="Back">
          <i className="fi fi-rr-arrow-left" />
        </button>
        <button id="segp_drawer_toggle" onClick={() => setDrawerOpen((v) => !v)} title="Browse segments">
          <i className="fi fi-rr-menu-burger" />
        </button>
        <div id="segp_header_titles">
          <span id="segp_title">AMCTOSHS Segmentation</span>
          <span id="segp_subtitle">AMCTOSHS Segment → AMCTOSHS Relations</span>
        </div>
        <div id="segp_header_meta">
          <span className="segp_count_badge">{totalSegments} segment{totalSegments !== 1 ? "s" : ""}</span>
          <span className="segp_count_badge segp_count_badge--inst">{sourceGroups.length} source{sourceGroups.length !== 1 ? "s" : ""}</span>
        </div>
      </div>

      {selectedKeys.size > 0 && (
        <div id="segp_selection_bar">
          <span className="segp_selection_count">{selectedKeys.size} segment{selectedKeys.size !== 1 ? "s" : ""} selected</span>
          <button type="button" id="segp_selection_clear_btn" onClick={clearSelection} disabled={extracting}>
            Clear
          </button>
          <button type="button" id="segp_extract_btn" onClick={extractRelations} disabled={extracting}>
            <i className={extracting ? "bx bx-loader-circle segp_icon_spin" : "fi fi-rr-sparkles"} />
            {extracting ? "Extracting…" : "Extract AMCTOSHS Relations"}
          </button>
          <button type="button" id="segp_extract_predicates_btn" onClick={extractPredicates} disabled={predicateExtracting}>
            <i className={predicateExtracting ? "bx bx-loader-circle segp_icon_spin" : "fi fi-rr-diagram-project"} />
            {predicateExtracting ? "Extracting…" : "Extract Predicates"}
          </button>
        </div>
      )}

      {(sourcesError || annotationsError) && (
        <div id="segp_row_error">
          <i className="bx bx-error" /> {sourcesError || annotationsError}
          <button type="button" onClick={clearErrors}><i className="bx bx-x" /></button>
        </div>
      )}

      <div id="segp_body">
        <div id="segp_left">{asideContent}</div>

        {drawerOpen && (
          <div id="segp_drawer_backdrop" onClick={() => setDrawerOpen(false)}>
            <div id="segp_drawer_sheet" onClick={(e) => e.stopPropagation()}>{asideContent}</div>
          </div>
        )}

        <div id="segp_right">
          {!selectedSegment && !extraction ? (
            <div id="segp_no_selection">
              <i className="fi fi-rr-arrow-small-left" />
              <p>Select a segment from the list to view it, or check segments and click "Extract AMCTOSHS Relations"</p>
            </div>
          ) : (
            <div id="segp_seg_body">
              {selectedSegment && (
                <>
                  <div id="segp_seg_header">
                    <div id="segp_seg_header_title">
                      <span id="segp_seg_name">{selectedSegment.displayTitle}</span>
                      <span className="segp_dim_badge segp_dim_badge--source" title="Source document">
                        <i className="fi fi-rr-file-pdf" /> {selectedSegment.sourceName}
                      </span>
                      <span className="segp_dim_badge">Page {selectedSegment.pageNum}</span>
                      {selectedSegment.container_name && (
                        <span className="segp_dim_badge segp_dim_badge--type" title="Segment Container">
                          {selectedSegment.container_name}
                        </span>
                      )}
                      <span className="segp_dim_badge segp_dim_badge--type">{selectedSegment.typeLabel}</span>
                    </div>
                    <button
                      type="button"
                      id="segp_open_source_btn"
                      onClick={(ev) => openSegmentSource(selectedSegment, ev)}
                      title={`Open "${selectedSegment.sourceName}" at page ${selectedSegment.pageNum} in the PDF Reader`}
                    >
                      <i className="fi fi-rr-arrow-up-right-from-square" /> Open in PDF Reader
                    </button>
                  </div>

                  <div id="segp_seg_content">
                    {selectedSegment.isImage ? (
                      selectedSegment.bbox.imageDataUrl ? (
                        <img
                          id="segp_seg_image"
                          src={selectedSegment.bbox.imageDataUrl}
                          alt={selectedSegment.displayTitle}
                        />
                      ) : (
                        <p className="segp_empty_hint">No image captured for this segment yet.</p>
                      )
                    ) : (
                      <p id="segp_seg_text">
                        {(() => {
                          const text = selectedSegment.bbox.text?.trim() || "";
                          if (!text) return "No text extracted for this segment yet.";
                          const relations = extraction?.normalizedResponse?.relations;
                          if (!relations?.length) return text;
                          const segmentId = segmentKeyFor(selectedSegment.sourceId, selectedSegment.pageNum, selectedSegment.bbox.id);
                          return buildSegmentTextWithRefs(text, relations, segmentId);
                        })()}
                      </p>
                    )}
                  </div>
                </>
              )}

              {(extraction || extractError) && (
                <div id="segp_relations_section">
                  {extractError && <p id="segp_relations_section_error">{extractError}</p>}
                  {extraction && (
                    <AmctoshsRelationsReviewList
                      extraction={extraction}
                      busy={reviewBusy}
                      onDecide={handleDecide}
                      onSaveAccepted={handleSaveAccepted}
                    />
                  )}
                </div>
              )}

              {(predicateExtraction || predicateExtractError) && (
                <div id="segp_predicates_section">
                  {predicateExtractError && <p id="segp_relations_section_error">{predicateExtractError}</p>}
                  {predicateExtraction && (
                    <AmctoshsPredicateExtractionReviewList
                      extraction={predicateExtraction}
                      busy={predicateReviewBusy}
                      onDecide={handlePredicateDecide}
                      onAnalyze={handleAnalyze}
                      analyzing={analyzing}
                    />
                  )}
                  {analyzeError && <p id="segp_relations_section_error">{analyzeError}</p>}
                  {predicateAnalysis && (
                    <AmctoshsPredicateAnalysisReviewList
                      extraction={predicateAnalysis}
                      busy={analysisReviewBusy}
                      onDecide={handleAnalysisDecide}
                      onSaveAccepted={handleSaveAnalysisAccepted}
                    />
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div id="segp_footer">
        <i className="fi fi-rr-microchip-ai" />
        <span>AI: {providerLabel}{currentModelLabel ? ` · ${currentModelLabel}` : ""}</span>
      </div>
    </div>
  );
}
