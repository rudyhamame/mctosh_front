import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./segmentationsPage.css";
import "../ClinicalSchemata/morphePanels.css";
import { apiUrl } from "../config/api";
import { readStoredSession } from "../utils/sessionCleanup";
import { useAIProvider, AI_PROVIDERS } from "../hooks/useAIProvider";
import { useAllSegments, segmentKeyFor } from "./useAllSegments";
import { splitParagraphIntoSentences } from "../utils/sentenceSplitter";
import { detectTopicLabel } from "../utils/topicLabelDetector";
import { normalizeTopicSentence } from "../utils/topicSentenceNormalizer";
import { resolveCoreference } from "../services/coreferenceClient";
import { glueParagraphLines, repairLineBreakHyphenation } from "../linguistics/dehyphenation/repairLineBreakHyphenation";
import { createRelationsExtraction, reviewRelationsExtraction, saveRelationsExtraction } from "./amctoshsRelationsExtractionClient";
import AmctoshsRelationsReviewList from "./AmctoshsRelationsReviewList";
import {
  createPredicateExtraction, reviewPredicateExtraction, analyzePredicateExtraction,
  reviewPredicateAnalysis, savePredicateAnalysis, listPredicateExtractions, deletePredicateExtraction,
} from "./amctoshsPredicateExtractionClient";
import AmctoshsPredicateExtractionReviewList from "./AmctoshsPredicateExtractionReviewList";
import AmctoshsPredicateAnalysisReviewList from "./AmctoshsPredicateAnalysisReviewList";
import ParagraphProcessingContainer from "./ParagraphProcessingContainer";

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
  const [predicateDeleteBusy, setPredicateDeleteBusy] = useState(false);
  const [predicateReviewBusy, setPredicateReviewBusy] = useState(false);
  const [predicateAnalysis, setPredicateAnalysis] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState("");
  const [analysisReviewBusy, setAnalysisReviewBusy] = useState(false);
  const [paragraphSentences, setParagraphSentences] = useState([]);
  const [selectedSentenceIndexes, setSelectedSentenceIndexes] = useState(() => new Set());
  const [predicateSentenceIndexes, setPredicateSentenceIndexes] = useState(() => new Set());
  const [coreference, setCoreference] = useState(null);
  const [coreferenceBusy, setCoreferenceBusy] = useState(false);
  const [coreferenceError, setCoreferenceError] = useState("");
  const [topicStructure, setTopicStructure] = useState(null);
  const [dehyphenation, setDehyphenation] = useState(null);
  const [gluedParagraph, setGluedParagraph] = useState(null);
  const [predicatePipelineSteps, setPredicatePipelineSteps] = useState([]);
  const [predicatePipelineBusy, setPredicatePipelineBusy] = useState(false);
  const [autoSaveReady, setAutoSaveReady] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState("");

  const autoSaveKeyFor = (key) => `amctoshs-segmentation-extraction:${key}`;

  useEffect(() => {
    if (!selectedSegmentKey) {
      setAutoSaveReady(false);
      setAutoSaveStatus("");
      return undefined;
    }
    setAutoSaveReady(false);
    try {
      const raw = window.localStorage.getItem(autoSaveKeyFor(selectedSegmentKey));
      if (raw) {
        const saved = JSON.parse(raw);
        setExtraction(saved.extraction || null);
        setPredicateExtraction(saved.predicateExtraction || null);
        setPredicateAnalysis(saved.predicateAnalysis || null);
        setParagraphSentences(Array.isArray(saved.paragraphSentences) ? saved.paragraphSentences : []);
        setSelectedSentenceIndexes(new Set(Array.isArray(saved.selectedSentenceIndexes) ? saved.selectedSentenceIndexes : []));
        setPredicateSentenceIndexes(new Set(Array.isArray(saved.predicateSentenceIndexes) ? saved.predicateSentenceIndexes : []));
        setCoreference(saved.coreference || null);
        setTopicStructure(saved.topicStructure || null);
        setDehyphenation(saved.dehyphenation || null);
        setGluedParagraph(saved.gluedParagraph || null);
        setAutoSaveStatus("Restored");
      } else {
        setAutoSaveStatus("");
      }
    } catch {
      setAutoSaveStatus("Unable to restore");
    } finally {
      setAutoSaveReady(true);
    }
    return undefined;
  }, [selectedSegmentKey]);

  useEffect(() => {
    if (!selectedSegmentKey || !autoSaveReady) return undefined;
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(autoSaveKeyFor(selectedSegmentKey), JSON.stringify({
          extraction,
          predicateExtraction,
          predicateAnalysis,
          paragraphSentences,
          selectedSentenceIndexes: [...selectedSentenceIndexes],
          predicateSentenceIndexes: [...predicateSentenceIndexes],
          coreference,
          topicStructure,
          dehyphenation,
          gluedParagraph,
          savedAt: new Date().toISOString(),
        }));
        setAutoSaveStatus("Auto-saved");
      } catch {
        setAutoSaveStatus("Auto-save failed");
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [
    selectedSegmentKey, autoSaveReady, extraction, predicateExtraction,
    predicateAnalysis, paragraphSentences, selectedSentenceIndexes,
    predicateSentenceIndexes, coreference, topicStructure,
    dehyphenation, gluedParagraph,
  ]);

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

  useEffect(() => {
    if (!selectedSegment || selectedSegment.isImage) return undefined;
    let cancelled = false;
    listPredicateExtractions()
      .then((payload) => {
        if (cancelled) return;
        const paragraphId = String(selectedSegment.bbox.id);
        const matches = (payload.extractions || []).filter((extraction) => (
          (extraction.segments || []).some((segment) => (
            segment.sourceId === selectedSegment.sourceId
            && Number(segment.pageNum) === Number(selectedSegment.pageNum)
            && (String(segment.segmentBboxId) === paragraphId || String(segment.segmentBboxId).startsWith(`${paragraphId}::sentence-`))
          ))
        ));
        if (matches[0]) setPredicateExtraction(matches[0]);
      })
      .catch(() => {
        // Existing local extraction state remains usable when history cannot load.
      });
    return () => { cancelled = true; };
  }, [selectedSegment]);

  const paragraphProcessingStages = useMemo(() => {
    if (!selectedSegment || selectedSegment.isImage) return [];
    const stepById = new Map(predicatePipelineSteps.map((step) => [step.id, step]));
    const statusFor = (id, hasOutput) => stepById.get(id)?.status || (hasOutput ? "completed" : "not_started");
    const originalText = selectedSegment.renderedText || "";
    const gluedText = gluedParagraph?.normalizedText
      || (dehyphenation ? glueParagraphLines(dehyphenation.normalizedText) : originalText);
    const topicText = topicStructure?.normalizedText || topicStructure?.bodyText || gluedText;
    let topicOffset = 0;
    const topicTransformations = (topicStructure?.sentences || []).flatMap((sentence) => {
      const sentenceText = sentence.normalizedText || "";
      const transformations = (sentence.transformationSteps || []).map((transformation) => ({
        ...transformation,
        start: Number.isInteger(transformation.start) ? transformation.start + topicOffset : transformation.start,
        end: Number.isInteger(transformation.end) ? transformation.end + topicOffset : transformation.end,
      }));
      topicOffset += sentenceText.length + 1;
      return transformations;
    });
    const sentenceText = paragraphSentences.map((sentence) => sentence.normalizedText || sentence.text || sentence.originalText).join("\n\n") || topicText;
    const predicateInputSentences = paragraphSentences.map((sentence) => sentence.normalizedText || sentence.resolvedText || sentence.originalText || sentence.text).filter(Boolean);
    const predicateText = predicateInputSentences.join("\n\n");
    const predicateRows = (predicateExtraction?.normalizedResponse?.predicate_assertions || []).map((assertion) => {
      const args = assertion.arguments || [];
      const subject = args.filter((arg) => ["subject", "expletive"].includes(arg.grammatical_role)).map((arg) => arg.mention).join("; ") || "—";
      const object = args.filter((arg) => ["direct_object", "indirect_object", "prepositional_object", "object_complement"].includes(arg.grammatical_role)).map((arg) => arg.mention).join("; ") || "—";
      return `Subject: ${subject} · Predicate: ${assertion.predicate?.surface || "—"} · Object: ${object}`;
    });
    const stages = [
      { id: "original", label: "Original (Hyle Lines)", text: originalText, status: "completed", method: "hyle_line_stack", transformations: [] },
      { id: "glued_paragraph", label: "Glued Paragraph", text: gluedText, status: statusFor("glue", Boolean(gluedParagraph || dehyphenation)), method: "line_stack_to_meaning_block", inputStage: "Original", transformations: dehyphenation?.transformations || [], metadata: { substep: "Line-Break Dehyphenation", candidatesDetected: dehyphenation?.transformations?.length || 0, resolved: dehyphenation?.transformations?.filter((item) => item.status === "resolved").length || 0, ambiguous: dehyphenation?.ambiguousCandidates?.length || 0, unresolved: dehyphenation?.unresolvedCandidates?.length || 0, softHyphensRemoved: dehyphenation?.softHyphensRemoved || 0 } },
      { id: "topic_structure", label: "Topic Structure", text: topicText, status: statusFor("topic", Boolean(topicStructure)), method: "deterministic_topic_structure", inputStage: "Glued Paragraph", transformations: topicTransformations, metadata: { topicLabel: topicStructure?.topicLabel?.text, constructionType: topicStructure?.constructionType, implicitRelation: topicStructure?.implicitRelation?.predicateType } },
      { id: "coreference", label: "Coreference", text: coreference?.resolvedText || topicText, status: statusFor("coreference", Boolean(coreference)), method: "local_coreference_resolution", inputStage: "Topic Structure", transformations: (coreference?.replacements || []).map((replacement) => ({ type: "resolve", before: replacement.mention || replacement.source || "", after: replacement.replacement || replacement.resolved || "", ruleId: "VALIDATED_TOPIC_COREFERENCE" })), metadata: { replacementCount: coreference?.replacements?.length || 0 } },
      { id: "sentences", label: "Sentences", text: sentenceText, status: statusFor("sentences", Boolean(paragraphSentences.length)), method: "deterministic_sentence_boundary_detection", inputStage: "Coreference", transformations: [], metadata: { sentenceCount: paragraphSentences.length, sentences: paragraphSentences.map((sentence) => sentence.normalizedText || sentence.text || sentence.originalText) } },
      { id: "predicate_input", label: "Predicate Input", text: predicateText, status: statusFor("predicates", Boolean(predicateExtraction)), method: "composed_linguistic_representation", inputStage: "Sentences", transformations: [], metadata: { description: "Each displayed sentence is submitted as its own Predicate Extraction segment.", sentenceCount: predicateInputSentences.length, sentences: predicateInputSentences } },
      ...(predicateExtraction ? [{ id: "predicate_results", label: "Predicates", text: "", status: "completed", method: "saved_predicate_extraction", inputStage: "Predicate Input", transformations: [], metadata: { predicates: predicateRows, predicateCount: predicateRows.length } }] : []),
    ];
    return predicatePipelineSteps.length ? stages : stages.filter((stage) => stage.id === "original" || stage.status !== "not_started");
  }, [selectedSegment, dehyphenation, gluedParagraph, topicStructure, paragraphSentences, coreference, predicateExtraction, predicatePipelineSteps]);

  const activeParagraphStageId = predicatePipelineSteps.find((stage) => stage.status === "running")?.id
    ? ({ glue: "glued_paragraph", topic: "topic_structure", sentences: "sentences", coreference: "coreference", predicates: "predicate_input" }[predicatePipelineSteps.find((stage) => stage.status === "running").id])
    : null;
  const paragraphProcessingStatus = predicatePipelineBusy ? "processing" : predicatePipelineSteps.some((stage) => stage.status === "failed") ? "failed" : predicateExtraction ? "completed" : "completed";

  const selectSegment = (key) => {
    if (key !== selectedSegmentKey) {
      setExtraction(null);
      setExtractError("");
      setPredicateExtraction(null);
      setPredicateExtractError("");
      setPredicateAnalysis(null);
      setAnalyzeError("");
      setParagraphSentences([]);
      setSelectedSentenceIndexes(new Set());
      setPredicateSentenceIndexes(new Set());
      setCoreference(null);
      setCoreferenceError("");
      setTopicStructure(null);
      setDehyphenation(null);
      setGluedParagraph(null);
    }
    setSelectedSegmentKey(key);
    setDrawerOpen(false);
  };

  // Traces a segment back to its own source document, open to the exact
  // page it was drawn on — PDFReaderWorkspace/PDFPage both read
  // location.state.page on mount (see SourcesPage.jsx's own openSource
  // for the same sourceId/pdfName navigation shape).
  const openSegmentSource = (segment, ev) => {
    ev?.stopPropagation();
    navigate("/pdf-reader", { state: { sourceId: segment.sourceId, pdfName: segment.sourceName, page: segment.pageNum } });
  };

  const extractRelations = async () => {
    if (!selectedSegment || selectedSegment.isImage) return;
    const segments = [{
      sourceId: selectedSegment.sourceId,
      pageNum: selectedSegment.pageNum,
      segmentBboxId: selectedSegment.bbox.id,
      segmentHyleId: selectedSegment.hyleId,
      segmentText: selectedSegment.renderedText || "",
      containerName: selectedSegment.container_name || null,
    }];

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

  const buildPredicateSegments = (sentences, coreferenceOverride = coreference, topicLabelOverride = topicStructure?.topicLabel?.text) => (
    (sentences || []).map((sentence, index) => {
      const text = sentence.normalizedText || sentence.resolvedText || sentence.originalText || sentence.text || "";
      return {
        sourceId: selectedSegment.sourceId,
        pageNum: selectedSegment.pageNum,
        segmentBboxId: `${selectedSegment.bbox.id}::sentence-${sentence.order || index + 1}`,
        segmentText: text,
        sentenceText: text,
        sentences: [sentence],
        originalText: sentence.originalText || sentence.text || "",
        resolvedText: sentence.resolvedText || text,
        sourceTopicLabel: topicLabelOverride || null,
        sourceParagraphId: String(selectedSegment.bbox.id),
        coreference: coreferenceOverride || null,
        containerName: selectedSegment.container_name || null,
      };
    }).filter((segment) => segment.segmentText.trim())
  );

  const extractPredicates = async () => {
    if (!selectedSegment || selectedSegment.isImage || !paragraphSentences.length) return;
    const selectedSentences = paragraphSentences.filter((_, index) => selectedSentenceIndexes.has(index));
    const segments = buildPredicateSegments(selectedSentences);
    if (!segments.length) return;

    setPredicateExtracting(true);
    setPredicateExtractError("");
    setPredicateAnalysis(null);
    setAnalyzeError("");
    try {
      const doc = await createPredicateExtraction({ segments, provider });
      setPredicateExtraction(doc);
      setPredicateSentenceIndexes(new Set(selectedSentenceIndexes));
    } catch (err) {
      setPredicateExtractError(err.message || "Predicate extraction failed.");
      if (err.extraction) setPredicateExtraction(err.extraction);
    } finally {
      setPredicateExtracting(false);
    }
  };

  const deletePredicateResults = async () => {
    if (predicateDeleteBusy) return;
    if (!window.confirm("Delete all processing results for this paragraph?")) return;
    setPredicateDeleteBusy(true);
    setPredicateExtractError("");
    try {
      if (predicateExtraction?._id) await deletePredicateExtraction(predicateExtraction._id);
      window.localStorage.removeItem(autoSaveKeyFor(selectedSegmentKey));
      setDehyphenation(null);
      setGluedParagraph(null);
      setTopicStructure(null);
      setCoreference(null);
      setCoreferenceError("");
      setParagraphSentences([]);
      setSelectedSentenceIndexes(new Set());
      setPredicateExtraction(null);
      setPredicateAnalysis(null);
      setPredicateExtractError("");
      setPredicateSentenceIndexes(new Set());
      setPredicatePipelineSteps([]);
    } catch (error) {
      setPredicateExtractError(error.message || "Failed to delete Predicate Extraction results.");
    } finally {
      setPredicateDeleteBusy(false);
    }
  };

  const extractSentences = () => {
    if (!selectedSegment || selectedSegment.isImage) return;
    const sentences = splitParagraphIntoSentences(topicStructure?.normalizedText || topicStructure?.bodyText || selectedSegment.renderedText || "");
    const sentenceUnits = sentences.map((text, index) => {
      const normalized = topicStructure?.topicLabel?.text ? normalizeTopicSentence(text, topicStructure.topicLabel.text) : { normalizedText: text, dependsOnTopic: false, topicDependencyType: "none", topicConstructionType: "not_topic_structure", usedTopicContext: false, usedImplicitRelation: false, implicitPredicateType: "none", surfaceCopula: null, normalizationMethod: "none", transformationSteps: [] };
      return {
      id: `${selectedSegment.key}:sentence:${index + 1}`,
      text, originalText: text, resolvedText: text, normalizedText: normalized.normalizedText,
      dependsOnTopic: normalized.dependsOnTopic, topicDependencyType: normalized.topicDependencyType,
      topicConstructionType: normalized.topicConstructionType, usedImplicitRelation: normalized.usedImplicitRelation,
      implicitPredicateType: normalized.implicitPredicateType, surfaceCopula: normalized.surfaceCopula,
      normalizationMethod: normalized.normalizationMethod,
      topicLabelText: topicStructure?.topicLabel?.text || null, usedTopicContext: normalized.usedTopicContext,
      transformationSteps: normalized.transformationSteps,
      order: index + 1,
      paragraphId: selectedSegment.bbox.id ? String(selectedSegment.bbox.id) : null,
      sourceSegmentId: selectedSegment.key || null,
      pageNumber: selectedSegment.pageNum ?? null,
      extractionMethod: "sbd",
      status: "extracted",
      coreferenceStatus: "not_processed",
      predicates: [],
      predicateAnalysis: null,
      };
    });
    setParagraphSentences(sentenceUnits);
    setSelectedSentenceIndexes(new Set(sentences.map((_, index) => index)));
    setPredicateSentenceIndexes(new Set());
    setPredicateExtraction(null);
    setPredicateExtractError("");
    setPredicateAnalysis(null);
    setAnalyzeError("");
  };

  const extractTopicLabels = (sourceText = gluedParagraph?.normalizedText || (dehyphenation ? glueParagraphLines(dehyphenation.normalizedText) : selectedSegment.renderedText || "")) => {
    if (!selectedSegment || selectedSegment.isImage) return;
    const detected = detectTopicLabel(sourceText);
    const topicLabel = detected.detected ? {
      text: detected.topicLabel,
      delimiter: detected.delimiter,
      start: detected.labelStart,
      end: detected.labelEnd,
      classification: detected.classification,
      extractionMethod: "deterministic-topic-label-detection",
      status: "extracted",
      resolutionSource: "deterministic",
      manuallyReviewed: false,
    } : null;
    const bodyText = detected.detected ? detected.bodyText : sourceText;
    const sentenceUnits = splitParagraphIntoSentences(bodyText).map((text, index) => {
      const normalized = topicLabel ? normalizeTopicSentence(text, topicLabel.text) : {
        normalizedText: text, dependsOnTopic: false, topicDependencyType: "none",
        topicConstructionType: "not_topic_structure", usedTopicContext: false, usedImplicitRelation: false,
        implicitPredicateType: "none", surfaceCopula: null, normalizationMethod: "none", transformationSteps: [],
      };
      return {
        id: `${selectedSegment.key}:sentence:${index + 1}`,
        text, originalText: text, resolvedText: text, normalizedText: normalized.normalizedText,
        dependsOnTopic: normalized.dependsOnTopic, topicDependencyType: normalized.topicDependencyType,
        topicConstructionType: normalized.topicConstructionType, usedImplicitRelation: normalized.usedImplicitRelation,
        implicitPredicateType: normalized.implicitPredicateType, surfaceCopula: normalized.surfaceCopula,
        normalizationMethod: normalized.normalizationMethod,
        topicLabelText: topicLabel?.text || null, usedTopicContext: normalized.usedTopicContext,
        transformationSteps: normalized.transformationSteps, order: index + 1,
        paragraphId: selectedSegment.bbox.id ? String(selectedSegment.bbox.id) : null,
        sourceSegmentId: selectedSegment.key || null, pageNumber: selectedSegment.pageNum ?? null,
        extractionMethod: "sbd", status: "extracted", coreferenceStatus: "not_processed",
        predicates: [], predicateAnalysis: null,
      };
    });
    const topicResult = {
      originalText: sourceText, topicLabel, bodyText,
      sentences: sentenceUnits,
      processing: { topicLabelExtractionStatus: detected.detected ? "completed" : "completed" },
      classification: detected.classification, confidence: detected.confidence,
      constructionType: detected.constructionType,
      rightSideAnalysis: detected.rightSideAnalysis,
      implicitRelation: detected.implicitRelation,
      normalizedText: sentenceUnits.map((sentence) => sentence.normalizedText).join(" ") || null,
      status: detected.detected ? "normalized" : detected.status,
      manuallyReviewed: false,
    };
    setTopicStructure(topicResult);
    setParagraphSentences(sentenceUnits);
    setSelectedSentenceIndexes(new Set(sentenceUnits.map((_, index) => index)));
    setPredicateSentenceIndexes(new Set());
    setPredicateExtraction(null);
    setPredicateAnalysis(null);
    return { topicStructure: topicResult, sentenceUnits, bodyText };
  };

  const runPredicatePipeline = async () => {
    if (!selectedSegment || selectedSegment.isImage || predicatePipelineBusy) return;
    const stages = [
      { id: "glue", label: "Glued Paragraph", status: "pending" },
      { id: "topic", label: "Extract topic label", status: "pending" },
      { id: "coreference", label: "Resolve paragraph references", status: "pending" },
      { id: "sentences", label: "Split resolved text into sentences", status: "pending" },
      { id: "predicates", label: "Extract predicates", status: "pending" },
    ];
    const updateStage = (id, status, detail = "") => setPredicatePipelineSteps((current) => current.map((stage) => stage.id === id ? { ...stage, status, detail } : stage));
    setPredicatePipelineBusy(true);
    setPredicatePipelineSteps(stages);
    setPredicateExtractError("");
    setCoreferenceError("");
    try {
      updateStage("glue", "running");
      const originalText = selectedSegment.renderedText || "";
      const dehyphenated = repairLineBreakHyphenation(originalText);
      const gluedText = glueParagraphLines(dehyphenated.normalizedText);
      setDehyphenation(dehyphenated);
      const gluedResult = { ...dehyphenated, normalizedText: gluedText, originalText, stageId: "glued_paragraph", substep: "Line-Break Dehyphenation" };
      setGluedParagraph(gluedResult);
      updateStage("glue", dehyphenated.status === "completed_with_warnings" ? "completed_with_warnings" : "completed", `${dehyphenated.transformations.length} line-break candidate${dehyphenated.transformations.length === 1 ? "" : "s"}`);
      updateStage("topic", "running");
      const topicResult = extractTopicLabels(gluedText);
      updateStage("topic", "completed", topicResult.topicStructure.topicLabel?.classification || "No topic label detected");

      updateStage("coreference", "running");
      let result;
      try {
        result = await resolveCoreference({ text: topicResult.topicStructure.normalizedText || topicResult.bodyText });
        setCoreference(result);
      } catch (coreferenceFailure) {
        // Predicate extraction can still use the last valid Topic Structure /
        // Sentences output when the optional coreference service is unavailable.
        result = {
          originalText: topicResult.topicStructure.normalizedText || topicResult.bodyText,
          resolvedText: topicResult.topicStructure.normalizedText || topicResult.bodyText,
          status: "skipped",
          clusters: [], replacements: [], unresolvedMentions: [], ambiguousMentions: [],
          error: coreferenceFailure.message,
        };
        setCoreference(result);
        updateStage("coreference", "completed_with_warnings", coreferenceFailure.message);
      }
      const originalSentences = splitParagraphIntoSentences(result.originalText);
      const resolvedSentences = splitParagraphIntoSentences(result.resolvedText);
      const mentionBySentence = (mentionList, sentenceIndex) => (mentionList || [])
        .filter((mention) => mention.sentenceIndex === sentenceIndex).map((mention) => mention.id).filter(Boolean);
      const pipelineSentences = originalSentences.map((text, index) => {
        const resolvedText = resolvedSentences[index] || text;
        const normalized = topicResult.topicStructure.topicLabel?.text
          ? normalizeTopicSentence(resolvedText, topicResult.topicStructure.topicLabel.text)
          : { normalizedText: resolvedText, dependsOnTopic: false, topicDependencyType: "none", topicConstructionType: "not_topic_structure", usedTopicContext: false, usedImplicitRelation: false, implicitPredicateType: "none", surfaceCopula: null, normalizationMethod: "none", transformationSteps: [] };
        return {
          id: `${selectedSegment.key}:sentence:${index + 1}`, text, originalText: text, resolvedText,
          normalizedText: normalized.normalizedText, dependsOnTopic: normalized.dependsOnTopic,
          topicDependencyType: normalized.topicDependencyType, topicLabelText: topicResult.topicStructure.topicLabel?.text || null,
          topicConstructionType: normalized.topicConstructionType, usedImplicitRelation: normalized.usedImplicitRelation,
          implicitPredicateType: normalized.implicitPredicateType, surfaceCopula: normalized.surfaceCopula,
          normalizationMethod: normalized.normalizationMethod,
          usedTopicContext: normalized.usedTopicContext, transformationSteps: normalized.transformationSteps,
          order: index + 1, paragraphId: String(selectedSegment.bbox.id), sourceSegmentId: selectedSegment.key,
          pageNumber: selectedSegment.pageNum, extractionMethod: "sbd", status: "extracted",
          coreferenceStatus: result.status || "completed", predicates: [], predicateAnalysis: null,
          coreferenceMentionIds: mentionBySentence(result.clusters.flatMap((cluster) => cluster.mentions || []), index),
          unresolvedMentionIds: mentionBySentence([...(result.unresolvedMentions || []), ...(result.ambiguousMentions || [])], index),
        };
      });
      updateStage("sentences", "running");
      setParagraphSentences(pipelineSentences);
      setSelectedSentenceIndexes(new Set(pipelineSentences.map((_, index) => index)));
      setPredicateSentenceIndexes(new Set());
      if (result.status !== "skipped") updateStage("coreference", "completed", `${result.replacements.length} replacement${result.replacements.length === 1 ? "" : "s"}`);
      updateStage("sentences", "completed", `${pipelineSentences.length} sentence${pipelineSentences.length === 1 ? "" : "s"}`);

      updateStage("predicates", "running");
      const doc = await createPredicateExtraction({
        segments: buildPredicateSegments(
          pipelineSentences,
          result,
          topicResult.topicStructure.topicLabel?.text,
        ),
        provider,
      });
      setPredicateExtraction(doc);
      setPredicateSentenceIndexes(new Set(pipelineSentences.map((_, index) => index)));
      updateStage("predicates", "completed", "Saved");
    } catch (error) {
      setPredicateExtractError(error.message || "Predicate pipeline failed.");
      setPredicatePipelineSteps((current) => current.map((stage) => stage.status === "running" ? { ...stage, status: "failed", detail: error.message } : stage));
    } finally {
      setPredicatePipelineBusy(false);
    }
  };

  const resolveReferences = async () => {
    if (!selectedSegment || selectedSegment.isImage) return;
    setCoreferenceBusy(true);
    setCoreferenceError("");
    try {
      const result = await resolveCoreference({ text: topicStructure?.normalizedText || topicStructure?.bodyText || selectedSegment.renderedText || "" });
      setCoreference(result);
      const originalSentences = splitParagraphIntoSentences(result.originalText);
      const resolvedSentences = splitParagraphIntoSentences(result.resolvedText);
      const mentionBySentence = (mentionList, sentenceIndex) => (mentionList || [])
        .filter((mention) => mention.sentenceIndex === sentenceIndex)
        .map((mention) => mention.id)
        .filter(Boolean);
      const nextUnits = originalSentences.map((text, index) => {
        const resolvedText = resolvedSentences[index] || text;
        const normalized = topicStructure?.topicLabel?.text
          ? normalizeTopicSentence(resolvedText, topicStructure.topicLabel.text)
          : { normalizedText: resolvedText, dependsOnTopic: false, topicDependencyType: "none", topicConstructionType: "not_topic_structure", usedTopicContext: false, usedImplicitRelation: false, implicitPredicateType: "none", surfaceCopula: null, normalizationMethod: "none", transformationSteps: [] };
        return {
          id: `${selectedSegment.key}:sentence:${index + 1}`,
          text, originalText: text, resolvedText, normalizedText: normalized.normalizedText,
          dependsOnTopic: normalized.dependsOnTopic, topicDependencyType: normalized.topicDependencyType,
          topicConstructionType: normalized.topicConstructionType, usedImplicitRelation: normalized.usedImplicitRelation,
          implicitPredicateType: normalized.implicitPredicateType, surfaceCopula: normalized.surfaceCopula,
          normalizationMethod: normalized.normalizationMethod,
          topicLabelText: topicStructure?.topicLabel?.text || null,
          usedTopicContext: normalized.usedTopicContext, transformationSteps: normalized.transformationSteps,
          order: index + 1,
          paragraphId: selectedSegment.bbox.id ? String(selectedSegment.bbox.id) : null,
          sourceSegmentId: selectedSegment.key || null, pageNumber: selectedSegment.pageNum ?? null,
          extractionMethod: "sbd", status: "extracted", coreferenceStatus: result.status || "completed",
          predicates: [], predicateAnalysis: null,
          coreferenceMentionIds: mentionBySentence(result.clusters.flatMap((cluster) => cluster.mentions || []), index),
          unresolvedMentionIds: mentionBySentence([...(result.unresolvedMentions || []), ...(result.ambiguousMentions || [])], index),
        };
      });
      setParagraphSentences(nextUnits);
      setSelectedSentenceIndexes(new Set(nextUnits.map((_, index) => index)));
      setPredicateSentenceIndexes(new Set());
    } catch (error) {
      setCoreferenceError(error.message || "Coreference resolution failed.");
    } finally {
      setCoreferenceBusy(false);
    }
  };

  const toggleSentence = (index) => {
    setSelectedSentenceIndexes((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
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
        <span className="segp_panel_label">Line Blocks</span>
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
            <p>No line blocks found across any source yet.</p>
            <p className="segp_empty_hint">Draw content BBoxes in the PDF Reader first.</p>
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
                  <i className={seg.isImage ? "fi fi-rr-picture" : "fi fi-rr-text"} />
                  <span className="segp_segment_row_text">
                    <span className="segp_segment_row_title">{seg.displayTitle}</span>
                    {!seg.isImage && (
                      <span className="segp_segment_row_preview">
                        {previewText(seg.renderedText) || "No text extracted yet."}
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
        <button id="segp_drawer_toggle" onClick={() => setDrawerOpen((v) => !v)} title="Browse line blocks">
          <i className="fi fi-rr-menu-burger" />
        </button>
        <div id="segp_header_titles">
          <span id="segp_title">AMCTOSHS Segmentation</span>
          <span id="segp_subtitle">AMCTOSHS Line Blocks → AMCTOSHS Relations</span>
        </div>
        <div id="segp_header_meta">
          <span className="segp_count_badge">{totalSegments} line block{totalSegments !== 1 ? "s" : ""}</span>
          <span className="segp_count_badge segp_count_badge--inst">{sourceGroups.length} source{sourceGroups.length !== 1 ? "s" : ""}</span>
        </div>
      </div>

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
              <p>Open a line block from the list to view it and run extraction actions here.</p>
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
                      {selectedSegment.partition_name && (
                        <span className="segp_dim_badge segp_dim_badge--type" title="Containing partition">
                          {selectedSegment.partition_name}
                        </span>
                      )}
                      {selectedSegment.container_name && (
                        <span className="segp_dim_badge segp_dim_badge--type" title="Segment Container">
                          {selectedSegment.container_name}
                        </span>
                      )}
                      <span className="segp_dim_badge segp_dim_badge--type">{selectedSegment.typeLabel}</span>
                      <span className="segp_dim_badge segp_dim_badge--id" title="Global AMCTOSHS Hyle BBox ID">
                        ID {selectedSegment.hyleId}
                      </span>
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

                  {!selectedSegment.isImage && (
                    <>
                      <div id="segp_seg_actions">
                        {autoSaveStatus && <span id="segp_extraction_autosave_status" role="status">{autoSaveStatus}</span>}
                      <button type="button" id="segp_extract_predicates_btn" onClick={runPredicatePipeline} disabled={predicatePipelineBusy || !selectedSegment.renderedText}>
                          <span className="segp_extract_predicates_copy">
                            <strong>{predicatePipelineBusy ? "Processing…" : "Start"}</strong>
                            {predicatePipelineBusy && <small>Running the linguistic pipeline</small>}
                          </span>
                          <span className="segp_extract_predicates_arrow" aria-hidden="true">→</span>
                        </button>
                        {(predicateExtraction || topicStructure || coreference || paragraphSentences.length > 0 || predicatePipelineSteps.length > 0) && (
                          <button
                            type="button"
                            id="segp_delete_predicate_results_btn"
                            onClick={deletePredicateResults}
                            disabled={predicateDeleteBusy}
                          >
                            {predicateDeleteBusy ? "Deleting…" : "Delete All Results"}
                          </button>
                        )}
                      </div>
                    </>
                  )}

                  {selectedSegment.isImage ? (
                    <div id="segp_seg_content">
                      {selectedSegment.bbox.imageDataUrl ? <img id="segp_seg_image" src={selectedSegment.bbox.imageDataUrl} alt={selectedSegment.displayTitle} /> : <p className="segp_empty_hint">No image captured for this segment yet.</p>}
                    </div>
                  ) : (
                    <div id="segp_processing_layout">
                      <ParagraphProcessingContainer
                        paragraph={{ title: selectedSegment.displayTitle, pageNumber: selectedSegment.pageNum }}
                        stages={paragraphProcessingStages}
                        activeProcessingStageId={activeParagraphStageId}
                        processingRunStatus={paragraphProcessingStatus}
                        paragraphSentences={paragraphSentences}
                        selectedSentenceIndexes={selectedSentenceIndexes}
                        predicateSentenceIndexes={predicateSentenceIndexes}
                        onToggleSentence={toggleSentence}
                      />
                      {predicatePipelineSteps.length > 0 && (
                        <div id="segp_predicate_pipeline" aria-live="polite">
                          {predicatePipelineSteps.map((stage, index) => (
                            <div key={stage.id} className={`segp_pipeline_step segp_pipeline_step--${stage.status}`}>
                              <span className="segp_pipeline_step_number">{stage.status === "completed" ? "✓" : stage.status === "failed" ? "!" : index + 1}</span>
                              <span>{stage.label}</span>
                              {stage.detail && <small>{stage.detail}</small>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
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
