import React, { useState } from "react";

const findProposal = (normalizedResponse, tempId, itemType) => {
  if (itemType === "ReasoningDependentEntity") {
    return (normalizedResponse.reasoning_dependent_entities || []).find((e) => e.reasoning_entity_id === tempId);
  }
  if (itemType === "Relation") {
    const index = Number(String(tempId).replace("relation-", ""));
    return (normalizedResponse.relations || [])[index];
  }
  return null;
};

const latestEditedFields = (reviewedItem) => (
  reviewedItem.edits?.length ? reviewedItem.edits[reviewedItem.edits.length - 1].fields : null
);

const summaryFor = (itemType, proposal, edited) => {
  const merged = { ...proposal, ...edited };
  if (itemType === "ReasoningDependentEntity") {
    const dependsOn = (proposal.depends_on || []).map((d) => d.input_name).filter(Boolean).join(", ");
    return { title: merged.name, detail: `${proposal.reasoning_type}${dependsOn ? ` · depends on: ${dependsOn}` : ""}` };
  }
  if (itemType === "Relation") {
    return { title: `${proposal.subject_id} —${proposal.predicate}→ ${proposal.object_id}`, detail: proposal.dependency_status };
  }
  return { title: "(unknown item)", detail: "" };
};

const ReviewRow = ({ reviewedItem, proposal, busy, onDecide }) => {
  const [editing, setEditing] = useState(false);
  const editable = reviewedItem.itemType === "ReasoningDependentEntity";
  const edited = latestEditedFields(reviewedItem);
  const [draftValue, setDraftValue] = useState(editable ? (edited?.name ?? proposal.name) : "");
  const { title, detail } = summaryFor(reviewedItem.itemType, proposal, edited);

  const saveEdit = () => {
    onDecide(reviewedItem.tempId, "edited_accepted", { name: draftValue });
    setEditing(false);
  };

  return (
    <div className={`mrv_row mrv_row--${reviewedItem.decision}`}>
      <span className="mrp_dim_badge mrp_dim_badge--muted">{reviewedItem.itemType === "ReasoningDependentEntity" ? "Reasoning entity" : "Relation"}</span>
      <span className="mrv_row_body">
        {editing ? (
          <input className="mrp_input" value={draftValue} onChange={(e) => setDraftValue(e.target.value)} autoFocus />
        ) : (
          <>
            <span className="mrv_row_title">{title}</span>
            <span className="mrv_row_detail">{detail}</span>
          </>
        )}
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
            {editable && (
              <button type="button" className="mrv_btn" disabled={busy} onClick={() => setEditing(true)} title="Edit before accepting">
                <i className="bx bx-edit" />
              </button>
            )}
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

// Same adapted-from-HyleCards per-item review pattern as
// ClinicalSchemata/MorpheReviewList.jsx, mirrored here for Reasoning's
// own item shapes (ReasoningDependentEntity/Relation) rather than shared
// directly — the two review lists' underlying proposal shapes differ
// enough (reasoning_entity_id + depends_on vs schema_id/instance_id/
// trace_id) that a single generic component would need its own
// per-itemType branching anyway.
export default function ReasoningReviewList({ extraction, busy, onDecide, onSaveAccepted }) {
  const items = extraction.reviewedItems || [];
  const acceptedNotSaved = items.filter((ri) => ["accepted", "edited_accepted"].includes(ri.decision) && !ri.savedDocId);

  if (!items.length) return null;

  return (
    <div id="mrv_root">
      <div id="mrv_head">
        <span className="mrp_panel_label">Review AMCTOSHS Reasoning Proposal</span>
        {extraction.validation?.warnings?.length > 0 && (
          <span className="mrv_warning_count" title={extraction.validation.warnings.join("\n")}>
            <i className="bx bx-error" /> {extraction.validation.warnings.length} warning{extraction.validation.warnings.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>
      <div id="mrv_list">
        {items.map((ri) => {
          const proposal = findProposal(extraction.normalizedResponse, ri.tempId, ri.itemType);
          if (!proposal) return null;
          return <ReviewRow key={ri.tempId} reviewedItem={ri} proposal={proposal} busy={busy} onDecide={onDecide} />;
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
