import React, { useState } from "react";

const findAssertion = (normalizedResponse, tempId) => (
  (normalizedResponse.predicate_assertions || []).find((a) => a.predicate_id === tempId)
);

const latestEditedFields = (reviewedItem) => (
  reviewedItem.edits?.length ? reviewedItem.edits[reviewedItem.edits.length - 1].fields : null
);

// Frontend mirror of back/validation/amctoshsPredicateSchemas.js's
// grammatical enums — display/edit only, the backend's own Zod schema
// (.strict(), no ontology fields at all) is the real enforcement.
const VOICE_TYPES = ["active", "passive", "middle", "copular", "unknown"];
const TENSE_TYPES = ["past", "present", "future", "unknown"];
const ASPECT_TYPES = ["simple", "progressive", "perfect", "perfect_progressive", "unknown"];
const POLARITY_TYPES = ["positive", "negative"];
const MODALITY_TYPES = ["asserted", "possible", "probable", "necessary", "permitted", "recommended", "conditional", "hypothetical", "unknown"];

const ExtractionRow = ({ reviewedItem, assertion, busy, onDecide, index }) => {
  const [editing, setEditing] = useState(false);
  const edited = latestEditedFields(reviewedItem);
  const [draftVoice, setDraftVoice] = useState(edited?.voice ?? assertion.voice);
  const [draftTense, setDraftTense] = useState(edited?.tense ?? assertion.tense);
  const [draftAspect, setDraftAspect] = useState(edited?.aspect ?? assertion.aspect);
  const [draftPolarity, setDraftPolarity] = useState(edited?.polarity ?? assertion.polarity);
  const [draftModality, setDraftModality] = useState(edited?.modality ?? assertion.modality);
  const merged = { ...assertion, ...edited };

  const saveEdit = () => {
    onDecide(reviewedItem.tempId, "edited_accepted", {
      voice: draftVoice, tense: draftTense, aspect: draftAspect, polarity: draftPolarity, modality: draftModality,
    });
    setEditing(false);
  };

  return (
    <div className={`mrv_row mrv_row--${reviewedItem.decision}`}>
      <span className="mrp_dim_badge mrp_dim_badge--muted">Predicate</span>
      <span className="mrv_row_body">
        {editing ? (
          <span className="arv_edit_fields">
            <select className="mrp_input" value={draftVoice} onChange={(e) => setDraftVoice(e.target.value)}>
              {VOICE_TYPES.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
            <select className="mrp_input" value={draftTense} onChange={(e) => setDraftTense(e.target.value)}>
              {TENSE_TYPES.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
            <select className="mrp_input" value={draftAspect} onChange={(e) => setDraftAspect(e.target.value)}>
              {ASPECT_TYPES.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
            <select className="mrp_input" value={draftPolarity} onChange={(e) => setDraftPolarity(e.target.value)}>
              {POLARITY_TYPES.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
            <select className="mrp_input" value={draftModality} onChange={(e) => setDraftModality(e.target.value)}>
              {MODALITY_TYPES.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </span>
        ) : (
          <>
            <span className="mrv_row_title"><sup className="arv_row_ref">{index + 1}</sup>{merged.clause.text}</span>
            <span className="mrv_row_detail">
              {merged.predicate.surface} ({merged.predicate.lemma}) · arity {merged.arity} · {merged.voice} · {merged.tense}/{merged.aspect} · {merged.polarity} · {merged.modality}
              {merged.confidence != null && ` · confidence ${merged.confidence.toFixed(2)}`}
            </span>
            <span className="pev_arguments">
              {merged.arguments.map((arg) => (
                <span key={arg.argument_id} className="pev_argument_chip">
                  <strong>{arg.grammatical_role}</strong>: {arg.mention}
                </span>
              ))}
            </span>
          </>
        )}
      </span>
      <span className="mrv_row_actions">
        {editing ? (
          <>
            <button type="button" className="mrv_btn mrv_btn--accept" disabled={busy} onClick={saveEdit}>Save &amp; Accept</button>
            <button type="button" className="mrv_btn" disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
          </>
        ) : (
          <>
            <button
              type="button"
              className={`mrv_btn mrv_btn--accept${reviewedItem.decision === "accepted" ? " mrv_btn--active" : ""}`}
              disabled={busy}
              onClick={() => onDecide(reviewedItem.tempId, "accepted")}
              title="Accept"
            >✓</button>
            <button type="button" className="mrv_btn" disabled={busy} onClick={() => setEditing(true)} title="Edit before accepting">
              <i className="bx bx-edit" />
            </button>
            <button
              type="button"
              className={`mrv_btn mrv_btn--reject${reviewedItem.decision === "rejected" ? " mrv_btn--active" : ""}`}
              disabled={busy}
              onClick={() => onDecide(reviewedItem.tempId, "rejected")}
              title="Reject"
            >✕</button>
          </>
        )}
      </span>
    </div>
  );
};

// The per-item review UI for "Extract Predicates" (stage 1 of the
// linguistic-only Predicate Extraction / Predicate Analysis pipeline —
// see back/helpers/amctoshsPredicateExtractor.js's own doc comment).
// Unlike AmctoshsRelationsReviewList, this stage never saves directly:
// its accepted items feed "Analyze Predicates" (onAnalyze), which the
// parent page gates on there being at least one accepted item here.
export default function AmctoshsPredicateExtractionReviewList({ extraction, busy, onDecide, onAnalyze, analyzing }) {
  const items = extraction.reviewedItems || [];
  const acceptedCount = items.filter((ri) => ["accepted", "edited_accepted"].includes(ri.decision)).length;

  if (!items.length) return null;

  return (
    <div id="pev_root">
      <div id="pev_head">
        <span className="mrp_panel_label">Review Predicate Extraction Proposal</span>
        {extraction.validation?.warnings?.length > 0 && (
          <span className="mrv_warning_count" title={extraction.validation.warnings.join("\n")}>
            <i className="bx bx-error" /> {extraction.validation.warnings.length} warning{extraction.validation.warnings.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>
      <div id="pev_list">
        {items.map((ri, index) => {
          const assertion = findAssertion(extraction.normalizedResponse, ri.tempId);
          if (!assertion) return null;
          return <ExtractionRow key={ri.tempId} reviewedItem={ri} assertion={assertion} busy={busy} onDecide={onDecide} index={index} />;
        })}
      </div>
      <button
        type="button"
        id="pev_analyze_btn"
        disabled={busy || analyzing || acceptedCount === 0}
        onClick={onAnalyze}
      >
        {analyzing ? "Analyzing…" : `Analyze ${acceptedCount} accepted predicate${acceptedCount !== 1 ? "s" : ""}`}
      </button>
    </div>
  );
}
