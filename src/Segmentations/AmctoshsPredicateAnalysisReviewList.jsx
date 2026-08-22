import React, { useState } from "react";

const findAnalyzed = (normalizedResponse, tempId) => (
  (normalizedResponse.analyzed_predicates || []).find((p) => p.predicate_id === tempId)
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

// Collapsible, read-only breakdown of a single analyzed argument — the
// full linguistic decomposition (grammatical head/lemma, linguistic core,
// number, determiner, modifiers, complements, embedded predicates,
// coreference candidates). Deliberately read-only: this stage's edit
// affordance is scoped to the predicate-level fields (see
// AnalysisRow below), not every nested argument sub-field — there is no
// ontology field anywhere in this tree to render, by construction (see
// validation/amctoshsPredicateSchemas.js's header comment).
const ArgumentPanel = ({ arg }) => {
  const [expanded, setExpanded] = useState(false);
  const coreDiffers = arg.grammatical_head.lemma.trim().toLowerCase() !== arg.linguistic_core.lemma.trim().toLowerCase();

  return (
    <div className="pav_arg_panel">
      <button type="button" className="pav_arg_toggle" onClick={() => setExpanded((v) => !v)}>
        <i className={`bx bx-chevron-${expanded ? "down" : "right"}`} />
        {arg.grammatical_role}: {arg.mention}
        <span className="mrp_status_chip mrp_status_chip--proposed">{arg.semantic_role}</span>
      </button>

      {expanded && (
        <div className="pav_arg_body">
          <div className="pav_arg_field_row"><span className="pav_arg_label">Grammatical head</span><span className="pav_arg_value">{arg.grammatical_head.surface} <em>(lemma: {arg.grammatical_head.lemma}, {arg.grammatical_head.part_of_speech})</em></span></div>
          <div className="pav_arg_field_row"><span className="pav_arg_label">Linguistic core</span><span className="pav_arg_value">{arg.linguistic_core.lemma}{coreDiffers && <em> (differs from head lemma — conventional multiword term preserved)</em>}</span></div>
          <div className="pav_arg_field_row"><span className="pav_arg_label">Number / determiner</span><span className="pav_arg_value">{arg.grammatical_number}{arg.determiner ? ` · "${arg.determiner}"` : ""}</span></div>

          {arg.modifiers.length > 0 && (
            <div className="pav_arg_section">
              <span className="pav_arg_label">Modifiers</span>
              {arg.modifiers.map((m, i) => <div key={i} className="pav_arg_list_row">{m.type}: {m.surface}</div>)}
            </div>
          )}

          {arg.complements.length > 0 && (
            <div className="pav_arg_section">
              <span className="pav_arg_label">Complements</span>
              {arg.complements.map((c, i) => (
                <div key={i} className="pav_arg_list_row">
                  {c.complement_type}: "{c.surface}"{c.object_head && ` → head "${c.object_head.surface}" (lemma: ${c.object_head.lemma})`}
                </div>
              ))}
            </div>
          )}

          {arg.embedded_predicates.length > 0 && (
            <div className="pav_arg_section">
              <span className="pav_arg_label">Embedded predicates</span>
              {arg.embedded_predicates.map((e, i) => (
                <div key={i} className="pav_arg_list_row">
                  {e.predicate}({e.arguments.map((a) => a.mention).join(", ")})
                  {e.predicate === "unresolved_relation" && <span className="arv_sor_flag" title="Ambiguous linguistic relation"> ⚠ unresolved</span>}
                </div>
              ))}
            </div>
          )}

          {arg.coreference_candidates.length > 0 && (
            <div className="pav_arg_section">
              <span className="pav_arg_label">Coreference candidates</span>
              {arg.coreference_candidates.map((c, i) => (
                <div key={i} className="pav_arg_list_row">
                  "{c.mention}" → "{c.antecedent_mention}"{c.confidence != null && ` (confidence ${c.confidence.toFixed(2)})`}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const AnalysisRow = ({ reviewedItem, analyzed, busy, onDecide, index }) => {
  const [editing, setEditing] = useState(false);
  const edited = latestEditedFields(reviewedItem);
  const [draftVoice, setDraftVoice] = useState(edited?.predicate_analysis?.voice ?? analyzed.predicate_analysis.voice);
  const [draftTense, setDraftTense] = useState(edited?.predicate_analysis?.tense ?? analyzed.predicate_analysis.tense);
  const [draftAspect, setDraftAspect] = useState(edited?.predicate_analysis?.aspect ?? analyzed.predicate_analysis.aspect);
  const [draftPolarity, setDraftPolarity] = useState(edited?.predicate_analysis?.polarity ?? analyzed.predicate_analysis.polarity);
  const [draftModality, setDraftModality] = useState(edited?.predicate_analysis?.modality ?? analyzed.predicate_analysis.modality);
  const merged = { ...analyzed, ...edited };

  const saveEdit = () => {
    onDecide(reviewedItem.tempId, "edited_accepted", {
      predicate_analysis: { ...merged.predicate_analysis, voice: draftVoice, tense: draftTense, aspect: draftAspect, polarity: draftPolarity, modality: draftModality },
    });
    setEditing(false);
  };

  return (
    <div className={`mrv_row mrv_row--${reviewedItem.decision}`}>
      <span className="mrp_dim_badge mrp_dim_badge--muted">Analyzed Predicate</span>
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
            <span className="mrv_row_title">
              <sup className="arv_row_ref">{index + 1}</sup>
              {merged.predicate_analysis.surface} ({merged.predicate_analysis.lemma}) · arity {merged.predicate_analysis.arity}
            </span>
            <span className="mrv_row_detail">
              {merged.predicate_analysis.voice} · {merged.predicate_analysis.tense}/{merged.predicate_analysis.aspect} · {merged.predicate_analysis.polarity} · {merged.predicate_analysis.modality}
              {merged.surface_voice === "passive" && ` · surface order: ${merged.surface_argument_order.join(" / ")}`}
            </span>
          </>
        )}
        <div className="pav_arguments">
          {merged.arguments.map((arg) => <ArgumentPanel key={arg.argument_id} arg={arg} />)}
        </div>
      </span>
      <span className="mrv_row_actions">
        {editing ? (
          <>
            <button type="button" className="mrv_btn mrv_btn--accept" disabled={busy} onClick={saveEdit}>Save &amp; Accept</button>
            <button type="button" className="mrv_btn" disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
          </>
        ) : reviewedItem.savedDocId ? (
          <span className="mrp_status_chip mrp_status_chip--asserted">saved</span>
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

// The per-item review UI for "Analyze Predicates" (stage 2 — see
// back/helpers/amctoshsPredicateAnalyzer.js's own doc comment). Same
// accept/edit/reject/save pattern as AmctoshsRelationsReviewList, with a
// per-argument collapsible linguistic breakdown (ArgumentPanel) instead of
// a single SOR panel — every analyzed predicate has multiple arguments,
// each with its own head/core/modifiers/complements/embedded predicates.
export default function AmctoshsPredicateAnalysisReviewList({ extraction, busy, onDecide, onSaveAccepted }) {
  const items = extraction.reviewedItems || [];
  const acceptedNotSaved = items.filter((ri) => ["accepted", "edited_accepted"].includes(ri.decision) && !ri.savedDocId);

  if (!items.length) return null;

  return (
    <div id="pav_root">
      <div id="pav_head">
        <span className="mrp_panel_label">Review Predicate Analysis Proposal</span>
        {extraction.validation?.warnings?.length > 0 && (
          <span className="mrv_warning_count" title={extraction.validation.warnings.join("\n")}>
            <i className="bx bx-error" /> {extraction.validation.warnings.length} warning{extraction.validation.warnings.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>
      <div id="pav_list">
        {items.map((ri, index) => {
          const analyzed = findAnalyzed(extraction.normalizedResponse, ri.tempId);
          if (!analyzed) return null;
          return <AnalysisRow key={ri.tempId} reviewedItem={ri} analyzed={analyzed} busy={busy} onDecide={onDecide} index={index} />;
        })}
      </div>
      <button
        type="button"
        id="pav_save_accepted_btn"
        disabled={busy || acceptedNotSaved.length === 0}
        onClick={() => onSaveAccepted(acceptedNotSaved.map((ri) => ri.tempId))}
      >
        {busy ? "Saving…" : `Save ${acceptedNotSaved.length} accepted item${acceptedNotSaved.length !== 1 ? "s" : ""}`}
      </button>
    </div>
  );
}
