import React, { useEffect, useMemo, useRef, useState } from "react";

const STATUS_LABELS = {
  not_started: "Not started",
  queued: "Queued",
  processing: "Processing",
  completed: "Completed",
  completed_with_warnings: "Completed with warnings",
  ambiguous: "Ambiguous",
  failed: "Failed",
  skipped: "Skipped",
  stale: "Stale",
  ready: "Ready",
};

const statusIcon = (status) => ({
  completed: "✓",
  completed_with_warnings: "!",
  processing: "●",
  failed: "!",
  ambiguous: "?",
  skipped: "–",
  stale: "~",
}[status] || "·");

const changedText = (text, transformations, showChanges) => {
  if (!showChanges || !transformations?.length) return text;
  const ranges = transformations
    .filter((item) => ["insert", "copula_insertion", "implicit_copula_insertion", "article_insertion", "topic_article_insertion", "line_break_dehyphenation"].includes(item.type))
    .map((item) => ({ start: Number(item.start), end: Number(item.end) }))
    .filter((item) => Number.isInteger(item.start) && Number.isInteger(item.end) && item.start >= 0 && item.end > item.start)
    .sort((a, b) => a.start - b.start);
  if (!ranges.length) return text;
  const nodes = [];
  let cursor = 0;
  ranges.forEach((range, index) => {
    if (range.start > cursor) nodes.push(String(text || "").slice(cursor, range.start));
    nodes.push(<mark key={`inserted-${index}`} className="segp_stage_inserted">{String(text || "").slice(range.start, range.end)}</mark>);
    cursor = range.end;
  });
  if (cursor < String(text || "").length) nodes.push(String(text || "").slice(cursor));
  return nodes;
};

const stageText = (stage) => {
  if (!stage) return "";
  if ((stage.id === "sentences" || stage.id === "predicate_input") && Array.isArray(stage.metadata?.sentences)) {
    return stage.metadata.sentences.map((sentence, index) => `[${index + 1}] ${sentence}`).join("\n\n");
  }
  if (stage.id === "predicate_results" && Array.isArray(stage.metadata?.predicates)) {
    return stage.metadata.predicates.map((predicate, index) => `[${index + 1}] ${predicate}`).join("\n\n");
  }
  return stage.text || "";
};

export default function ParagraphProcessingContainer({
  paragraph,
  stages,
  activeProcessingStageId,
  processingRunStatus,
  paragraphSentences = [],
  selectedSentenceIndexes = new Set(),
  predicateSentenceIndexes = new Set(),
  onToggleSentence,
}) {
  const [selectedStageId, setSelectedStageId] = useState("original");
  const [followLive, setFollowLive] = useState(true);
  const [showChanges, setShowChanges] = useState(false);
  const tabRefs = useRef([]);
  const currentStage = stages.find((stage) => stage.id === selectedStageId) || stages[0];

  useEffect(() => {
    if (followLive && activeProcessingStageId && stages.some((stage) => stage.id === activeProcessingStageId)) {
      setSelectedStageId(activeProcessingStageId);
    }
  }, [activeProcessingStageId, followLive, stages]);

  useEffect(() => {
    if (!stages.some((stage) => stage.id === selectedStageId)) setSelectedStageId(stages[0]?.id || "original");
  }, [selectedStageId, stages]);

  const selectedText = useMemo(() => stageText(currentStage), [currentStage]);
  if (!paragraph || !stages.length) return null;

  const selectTab = (stageId) => {
    setSelectedStageId(stageId);
    if (stageId !== activeProcessingStageId) setFollowLive(false);
  };

  const moveTab = (event, index) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? stages.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + stages.length) % stages.length;
    tabRefs.current[nextIndex]?.focus();
    selectTab(stages[nextIndex].id);
  };

  return (
    <section className="segp_processing_container" aria-label="Paragraph Processing Container">
      <div className="segp_processing_header">
        <div>
          <strong>{paragraph.title}</strong>
          <span>Page {paragraph.pageNumber}</span>
        </div>
        <span className={`segp_processing_status segp_processing_status--${processingRunStatus || "completed"}`} role="status">
          {STATUS_LABELS[processingRunStatus] || "Completed"}
        </span>
      </div>
      <div className="segp_processing_toolbar">
        <div className="segp_processing_tabs" role="tablist" aria-label="Paragraph processing stages">
          {stages.map((stage, index) => (
            <button
              key={stage.id}
              ref={(node) => { tabRefs.current[index] = node; }}
              type="button"
              role="tab"
              aria-selected={currentStage.id === stage.id}
              aria-controls={`segp_stage_panel_${stage.id}`}
              tabIndex={currentStage.id === stage.id ? 0 : -1}
              className={currentStage.id === stage.id ? "is-active" : ""}
              onClick={() => selectTab(stage.id)}
              onKeyDown={(event) => moveTab(event, index)}
            >
              <span aria-hidden="true">{statusIcon(stage.status)}</span> {stage.label}
              <small>{STATUS_LABELS[stage.status] || stage.status}</small>
            </button>
          ))}
        </div>
        <div className="segp_processing_options">
          <label><input type="checkbox" checked={followLive} onChange={(event) => setFollowLive(event.target.checked)} /> Follow live</label>
          <label><input type="checkbox" checked={showChanges} onChange={(event) => setShowChanges(event.target.checked)} /> Show changes</label>
        </div>
      </div>
      <div id={`segp_stage_panel_${currentStage.id}`} className="segp_stage_viewport" role="tabpanel" aria-label={`${currentStage.label} paragraph text`}>
        {currentStage.status === "not_started" || currentStage.status === "queued" ? (
          <p className="segp_stage_placeholder">This stage has not been processed yet.</p>
        ) : currentStage.status === "failed" ? (
          <p className="segp_stage_placeholder">This stage failed. The previous valid text representation remains available.</p>
        ) : (
          <p className="segp_stage_text">{changedText(selectedText, currentStage.transformations, showChanges)}</p>
        )}
      </div>
      <div className="segp_stage_details">
        <div className="segp_stage_details_header"><strong>{currentStage.label} details</strong><span>{STATUS_LABELS[currentStage.status] || currentStage.status}</span></div>
        <div className="segp_stage_metadata">
          <span><strong>Method</strong>{currentStage.method || "—"}</span>
          <span><strong>Input stage</strong>{currentStage.inputStage || "—"}</span>
          {currentStage.metadata?.substep && <span><strong>Substep</strong>{currentStage.metadata.substep}</span>}
          <span><strong>Transformations</strong>{currentStage.transformations?.length || 0}</span>
          {currentStage.metadata?.topicLabel && <span><strong>Topic label</strong>{currentStage.metadata.topicLabel}</span>}
          {currentStage.metadata?.constructionType && <span><strong>Construction</strong>{currentStage.metadata.constructionType}</span>}
          {currentStage.metadata?.implicitRelation && <span><strong>Implicit relation</strong>{currentStage.metadata.implicitRelation}</span>}
          {currentStage.metadata?.sentenceCount != null && <span><strong>Predicate inputs</strong>{currentStage.metadata.sentenceCount} sentence{currentStage.metadata.sentenceCount === 1 ? "" : "s"}</span>}
          {currentStage.metadata?.candidatesDetected != null && <span><strong>Candidates detected</strong>{currentStage.metadata.candidatesDetected}</span>}
          {currentStage.metadata?.resolved != null && <span><strong>Resolved</strong>{currentStage.metadata.resolved}</span>}
          {currentStage.metadata?.ambiguous != null && <span><strong>Ambiguous</strong>{currentStage.metadata.ambiguous}</span>}
          {currentStage.metadata?.unresolved != null && <span><strong>Unresolved</strong>{currentStage.metadata.unresolved}</span>}
          {currentStage.metadata?.softHyphensRemoved != null && <span><strong>Soft hyphens removed</strong>{currentStage.metadata.softHyphensRemoved}</span>}
        </div>
        {currentStage.transformations?.length > 0 && (
          <div className="segp_stage_transformations" aria-label="Stage transformations">
            {currentStage.transformations.map((transformation, index) => (
              <span key={`${transformation.ruleId || transformation.type}-${index}`}>
                {transformation.type}: {transformation.before || transformation.originalText || "∅"} → {transformation.after || transformation.outputText || transformation.insertedText || transformation.replacement || "∅"}
              </span>
            ))}
          </div>
        )}
        {currentStage.id === "sentences" && paragraphSentences.length > 0 && (
          <div className="segp_stage_sentence_controls">
            <span><strong>Sentence selection</strong> {selectedSentenceIndexes.size} / {paragraphSentences.length} selected</span>
            {paragraphSentences.map((sentence, index) => (
              <label key={sentence.id || index}>
                <input type="checkbox" checked={selectedSentenceIndexes.has(index)} onChange={() => onToggleSentence?.(index)} />
                <span>Sentence {sentence.order}</span>
                <small>{predicateSentenceIndexes.has(index) ? "Submitted" : "Ready"}</small>
              </label>
            ))}
          </div>
        )}
        {currentStage.status === "ambiguous" && <p className="segp_stage_warning">Processing stopped at an ambiguous construction. The source text was preserved.</p>}
      </div>
    </section>
  );
}
