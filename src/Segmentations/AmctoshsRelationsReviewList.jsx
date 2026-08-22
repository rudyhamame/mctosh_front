import React, { useState } from "react";

const findProposal = (normalizedResponse, tempId) => (
  (normalizedResponse.relations || []).find((r) => r.relation_id === tempId)
);

const latestEditedFields = (reviewedItem) => (
  reviewedItem.edits?.length ? reviewedItem.edits[reviewedItem.edits.length - 1].fields : null
);

// The row title is the RAW sentence from the segment, as-is — the exact
// quoted evidence_text span(s) that support this relation, not a
// reconstructed "subject —predicate→ object" string. Falls back to the
// SVO reconstruction only in the rare case evidence_text is empty (the
// validator only warns on that, never rejects it), so a row is never left
// blank.
const summaryFor = (proposal, edited) => {
  const merged = { ...proposal, ...edited };
  const rawSentence = merged.evidence_text?.length
    ? merged.evidence_text.join(" ")
    : `${merged.subject} —${merged.predicate}→ ${merged.object}`;
  return {
    title: rawSentence,
    detail: merged.dependency_status === "asserted_dependency" ? "asserted" : "proposed",
  };
};

// Frontend mirror of back/validation/amctoshsRelationsSchemas.js's Subject
// of Relation (SOR) enums — display/edit only, the backend's own Zod
// schema is the real enforcement.
const SOR_OBJECT_CLASSES = ["SubEntitySchema", "SubEntityInstance", "not_ontic"];
const GRAMMATICAL_NUMBERS = ["singular", "plural", "mass", "collective", "unknown"];
const SOR_MODIFIER_TYPES = [
  "laterality", "position", "region", "quantity", "quality", "state",
  "developmental_stage", "temporal", "patient_reference", "species",
  "material", "cell_type", "tissue_type", "other",
];
const SOR_INTERNAL_RELATION_TYPES = [
  "part_of", "located_in", "contained_in", "belongs_to", "composed_of",
  "derived_from", "adjacent_to", "connected_to", "associated_with",
  "generated_by", "property_of", "affects", "borne_by",
];

const updateAt = (arr, index, patch) => arr.map((item, i) => (i === index ? { ...item, ...patch } : item));
const removeAt = (arr, index) => arr.filter((_, i) => i !== index);

// Collapsible "Subject of Relation" section (spec §16) — shows the
// grammatical/ontic breakdown of the relation's subject phrase (mention,
// grammatical head, canonical core, modifiers, internal relations) and,
// when `editable`, lets the reviewer correct the canonical core name/
// object class, grammatical number, modifiers, and each internal
// relation's predicate/object. `mention`/`grammatical_head` stay read-only
// — they're what relation.subject is validated against, not something a
// reviewer free-edits here.
const SORPanel = ({ sor, editable, onChange }) => {
  const [expanded, setExpanded] = useState(false);
  if (!sor) return null;

  const headMismatch = sor.grammatical_head.surface.trim().toLowerCase() !== sor.canonical_core.name.trim().toLowerCase();
  const showModifiers = sor.modifiers.length > 0 || editable;
  const showInternalRelations = sor.internal_relations.length > 0 || editable;

  return (
    <div className="arv_sor_panel">
      <button type="button" className="arv_sor_toggle" onClick={() => setExpanded((v) => !v)}>
        <i className={`bx bx-chevron-${expanded ? "down" : "right"}`} />
        Subject of Relation: {sor.canonical_core.name}
        <span className={`mrp_status_chip mrp_status_chip--${sor.canonical_core.resolution_status === "existing_object" ? "asserted" : "proposed"}`}>
          {sor.canonical_core.resolution_status}
        </span>
        {headMismatch && <span className="arv_sor_flag" title="Grammatical head and canonical core name differ">⚠ head ≠ core</span>}
      </button>

      {expanded && (
        <div className="arv_sor_body">
          <div className="arv_sor_field_row"><span className="arv_sor_label">Mention</span><span className="arv_sor_value">{sor.mention}</span></div>
          <div className="arv_sor_field_row">
            <span className="arv_sor_label">Grammatical head</span>
            <span className="arv_sor_value">{sor.grammatical_head.surface} <em>(lemma: {sor.grammatical_head.lemma})</em></span>
          </div>
          {headMismatch && <p className="arv_sor_warning_text">Grammatical head and canonical core differ — may be legitimate, but worth a second look.</p>}

          <div className="arv_sor_field_row">
            <span className="arv_sor_label">Canonical core</span>
            {editable ? (
              <input className="mrp_input" value={sor.canonical_core.name} onChange={(e) => onChange({ ...sor, canonical_core: { ...sor.canonical_core, name: e.target.value } })} />
            ) : <span className="arv_sor_value">{sor.canonical_core.name}</span>}
          </div>
          <div className="arv_sor_field_row">
            <span className="arv_sor_label">Object class</span>
            {editable ? (
              <select className="mrp_input" value={sor.canonical_core.object_class} onChange={(e) => onChange({ ...sor, canonical_core: { ...sor.canonical_core, object_class: e.target.value } })}>
                {SOR_OBJECT_CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            ) : <span className="arv_sor_value">{sor.canonical_core.object_class}</span>}
          </div>
          <div className="arv_sor_field_row">
            <span className="arv_sor_label">Grammatical number</span>
            {editable ? (
              <select className="mrp_input" value={sor.grammatical_number} onChange={(e) => onChange({ ...sor, grammatical_number: e.target.value })}>
                {GRAMMATICAL_NUMBERS.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            ) : <span className="arv_sor_value">{sor.grammatical_number}</span>}
          </div>

          {showModifiers && (
            <div className="arv_sor_section">
              <span className="arv_sor_label">Modifiers</span>
              {sor.modifiers.map((m, i) => (
                <div key={i} className="arv_sor_list_row">
                  {editable ? (
                    <>
                      <select className="mrp_input" value={m.type} onChange={(e) => onChange({ ...sor, modifiers: updateAt(sor.modifiers, i, { type: e.target.value }) })}>
                        {SOR_MODIFIER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <input className="mrp_input" value={m.surface} onChange={(e) => onChange({ ...sor, modifiers: updateAt(sor.modifiers, i, { surface: e.target.value, normalized_value: e.target.value }) })} />
                      <button type="button" className="mrv_btn" onClick={() => onChange({ ...sor, modifiers: removeAt(sor.modifiers, i) })} title="Remove modifier">✕</button>
                    </>
                  ) : (
                    <span className="arv_sor_value">{m.type}: {m.surface}</span>
                  )}
                </div>
              ))}
              {!sor.modifiers.length && <p className="mrp_empty_hint">No modifiers.</p>}
            </div>
          )}

          {showInternalRelations && (
            <div className="arv_sor_section">
              <span className="arv_sor_label">Internal relations</span>
              {sor.internal_relations.map((ir, i) => (
                <div key={i} className="arv_sor_list_row">
                  {editable ? (
                    <>
                      <select className="mrp_input" value={ir.predicate} onChange={(e) => onChange({ ...sor, internal_relations: updateAt(sor.internal_relations, i, { predicate: e.target.value }) })}>
                        {SOR_INTERNAL_RELATION_TYPES.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                      <input
                        className="mrp_input"
                        value={ir.object.name}
                        onChange={(e) => onChange({ ...sor, internal_relations: updateAt(sor.internal_relations, i, { object: { ...ir.object, name: e.target.value } }) })}
                      />
                      <button type="button" className="mrv_btn" onClick={() => onChange({ ...sor, internal_relations: removeAt(sor.internal_relations, i) })} title="Remove internal relation">✕</button>
                    </>
                  ) : (
                    <span className="arv_sor_value">{ir.predicate} → {ir.object.name}</span>
                  )}
                  <span className="arv_sor_evidence">"{ir.evidence_text}"</span>
                </div>
              ))}
              {!sor.internal_relations.length && <p className="mrp_empty_hint">No internal relations.</p>}
            </div>
          )}

          <div className="arv_sor_field_row">
            <span className="arv_sor_label">Confidence</span>
            <span className="arv_sor_value">{sor.confidence != null ? sor.confidence.toFixed(2) : "—"}</span>
          </div>
        </div>
      )}
    </div>
  );
};

const ReviewRow = ({ reviewedItem, proposal, busy, onDecide, index }) => {
  const [editing, setEditing] = useState(false);
  const edited = latestEditedFields(reviewedItem);
  const [draftSubject, setDraftSubject] = useState(edited?.subject ?? proposal.subject);
  const [draftPredicate, setDraftPredicate] = useState(edited?.predicate ?? proposal.predicate);
  const [draftObject, setDraftObject] = useState(edited?.object ?? proposal.object);
  const [draftLogic, setDraftLogic] = useState(edited?.extraction_logic ?? proposal.extraction_logic);
  const [draftSOR, setDraftSOR] = useState(edited?.subject_of_relation ?? proposal.subject_of_relation);
  const { title, detail } = summaryFor(proposal, edited);
  const logic = edited?.extraction_logic ?? proposal.extraction_logic;
  const displaySOR = edited?.subject_of_relation ?? proposal.subject_of_relation;

  // Hard error mirroring the server-side rule: relation.subject must equal
  // subject_of_relation.mention exactly — mention itself isn't editable
  // here, so this only trips if the reviewer edits `subject` without
  // realizing it must match the SOR breakdown's own mention.
  const subjectMentionMismatch = editing && draftSOR && draftSubject.trim() !== draftSOR.mention.trim();

  const saveEdit = () => {
    if (subjectMentionMismatch) return;
    onDecide(reviewedItem.tempId, "edited_accepted", {
      subject: draftSubject, predicate: draftPredicate, object: draftObject, extraction_logic: draftLogic,
      subject_of_relation: draftSOR,
    });
    setEditing(false);
  };

  return (
    <div className={`mrv_row mrv_row--${reviewedItem.decision}`}>
      <span className="mrp_dim_badge mrp_dim_badge--muted">Relation</span>
      <span className="mrv_row_body">
        {editing ? (
          <span className="arv_edit_fields">
            <input className="mrp_input" value={draftSubject} onChange={(e) => setDraftSubject(e.target.value)} placeholder="Subject" autoFocus />
            <input className="mrp_input" value={draftPredicate} onChange={(e) => setDraftPredicate(e.target.value)} placeholder="Predicate" />
            <input className="mrp_input" value={draftObject} onChange={(e) => setDraftObject(e.target.value)} placeholder="Object" />
            <textarea className="mrp_input arv_logic_input" value={draftLogic} onChange={(e) => setDraftLogic(e.target.value)} placeholder="Extraction logic — why this relation follows from the text" rows={2} />
            {subjectMentionMismatch && (
              <p className="arv_sor_hard_error">Subject must match the Subject of Relation's mention ("{draftSOR.mention}") — edit the SOR panel below instead if the phrase itself is wrong.</p>
            )}
          </span>
        ) : (
          <>
            <span className="mrv_row_title"><sup className="arv_row_ref">{index + 1}</sup>{title}</span>
            <span className="mrv_row_detail">{detail}</span>
            {logic && <span className="arv_row_logic">{logic}</span>}
          </>
        )}
        <SORPanel sor={editing ? draftSOR : displaySOR} editable={editing} onChange={setDraftSOR} />
      </span>
      <span className="mrv_row_actions">
        {editing ? (
          <>
            <button type="button" className="mrv_btn mrv_btn--accept" disabled={busy || subjectMentionMismatch} onClick={saveEdit}>Save &amp; Accept</button>
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

// The per-item review UI for "Extract RabbitHole Relations". This stage
// only ever produces one item type (free-text Relations — no ontic
// classification happens here, see amctoshsRelationsExtractor.js's own
// doc comment), so unlike the retired multi-type review list this
// predates, every row is a Relation with an inline 3-field (subject/
// predicate/object) edit form, plus a collapsible Subject of Relation
// (SOR) breakdown per row. Reuses ../ClinicalSchemata/morphePanels.css's
// .mrv_*/.mrp_* classes (imported by SegmentationsPage.jsx alongside this
// component) — fully generic review-list styling, not Morphe-specific.
export default function AmctoshsRelationsReviewList({ extraction, busy, onDecide, onSaveAccepted }) {
  const items = extraction.reviewedItems || [];
  const acceptedNotSaved = items.filter((ri) => ["accepted", "edited_accepted"].includes(ri.decision) && !ri.savedDocId);

  if (!items.length) return null;

  return (
    <div id="mrv_root">
      <div id="mrv_head">
        <span className="mrp_panel_label">Review RabbitHole Relations Proposal</span>
        {extraction.validation?.warnings?.length > 0 && (
          <span className="mrv_warning_count" title={extraction.validation.warnings.join("\n")}>
            <i className="bx bx-error" /> {extraction.validation.warnings.length} warning{extraction.validation.warnings.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>
      <div id="mrv_list">
        {items.map((ri, index) => {
          const proposal = findProposal(extraction.normalizedResponse, ri.tempId);
          if (!proposal) return null;
          return <ReviewRow key={ri.tempId} reviewedItem={ri} proposal={proposal} busy={busy} onDecide={onDecide} index={index} />;
        })}
      </div>
      <button
        type="button"
        id="mrv_save_accepted_btn"
        disabled={busy || acceptedNotSaved.length === 0}
        onClick={() => onSaveAccepted(acceptedNotSaved.map((ri) => ri.tempId))}
      >
        {busy ? "Saving…" : `Save ${acceptedNotSaved.length} accepted item${acceptedNotSaved.length !== 1 ? "s" : ""}`}
      </button>
    </div>
  );
}
