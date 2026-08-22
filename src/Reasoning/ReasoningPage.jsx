import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import "../ClinicalSchemata/clinicalSchemata.css";
import "../ClinicalSchemata/morphePanels.css";
import "./reasoningPage.css";
import { listMorphe } from "../ClinicalSchemata/amctoshsMorpheClient";
import {
  createReasoningExtraction, listReasoningExtractions, reviewReasoningExtraction, saveReasoningExtraction,
  listReasoning, reasoningEntities as reasoningEntityClient,
} from "./amctoshsReasoningClient";
import { buildReasoningIndex } from "./amctoshsReasoningGraph";
import ReasoningReviewList from "./ReasoningReviewList";
import ReasoningEditor from "./ReasoningEditor";

// RabbitHole Reasoning — the interpretive layer downstream of "Extract
// RabbitHole Relations". Owns its own workflow end to end: pick one or more
// already-saved Trace Instances/Schemas (fetched from RabbitHole Morphe's
// own browse data) → "Extract Reasoning" → review each proposed
// Reasoning-dependent entity/Relation → save the accepted ones → browse/
// edit everything saved so far. Never reads raw segment text — only
// already-saved, already-reviewed RabbitHole Morphe output. Reasons over
// Trace INSTANCES specifically (concrete recorded occurrences), never
// Trace Schemata (the type-level object).

const REASONING_TYPE_LABELS = {
  interpreted_event: "Interpreted event", calculated_quantity: "Calculated quantity",
  derived_property: "Derived property", classification: "Classification", diagnosis: "Diagnosis",
  aggregation: "Aggregation", comparison: "Comparison", temporal_pattern: "Temporal pattern",
  causal_inference: "Causal inference", risk_estimate: "Risk estimate", reference_rule: "Reference rule", other: "Other",
};

export default function ReasoningPage() {
  const navigate = useNavigate();

  const [morpheData, setMorpheData] = useState({ schemas: [], traceSchemas: [], traceInstances: [] });
  const [morpheLoading, setMorpheLoading] = useState(true);

  const [selectedTraceIds, setSelectedTraceIds] = useState(new Set());
  const [selectedSchemaIds, setSelectedSchemaIds] = useState(new Set());
  const [extractBusy, setExtractBusy] = useState(false);
  const [extractError, setExtractError] = useState("");
  const [currentExtraction, setCurrentExtraction] = useState(null);
  const [reviewBusy, setReviewBusy] = useState(false);

  const [reasoningData, setReasoningData] = useState({ reasoningEntities: [], relations: [] });
  const [reasoningLoading, setReasoningLoading] = useState(true);
  const [reasoningError, setReasoningError] = useState("");

  const [activeType, setActiveType] = useState("all");
  const [selectedEntityId, setSelectedEntityId] = useState(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const data = await listMorphe();
        setMorpheData(data);
      } catch {
        // Non-fatal — the picker just shows empty; the browse/edit half of the page still works.
      } finally {
        setMorpheLoading(false);
      }
    })();
  }, []);

  const refreshReasoning = async () => {
    setReasoningLoading(true);
    try {
      const data = await listReasoning();
      setReasoningData(data);
      setReasoningError("");
    } catch (err) {
      setReasoningError(err.message || "Could not load RabbitHole Reasoning data.");
    } finally {
      setReasoningLoading(false);
    }
  };

  useEffect(() => { refreshReasoning(); }, []);

  const index = useMemo(() => buildReasoningIndex(reasoningData), [reasoningData]);
  const reasoningEntitiesById = useMemo(() => new Map(reasoningData.reasoningEntities.map((e) => [e._id, e])), [reasoningData]);
  const schemasById = useMemo(() => new Map(morpheData.schemas.map((s) => [s._id, s])), [morpheData]);
  const traceSchemasById = useMemo(() => new Map(morpheData.traceSchemas.map((t) => [t._id, t])), [morpheData]);
  const traceInstancesById = useMemo(() => new Map(morpheData.traceInstances.map((t) => [t._id, t])), [morpheData]);

  const resolveName = (type, id) => {
    const key = String(id);
    if (type === "ReasoningDependentEntity") return reasoningEntitiesById.get(key)?.name || "(unknown entity)";
    if (type === "Schema") return schemasById.get(key)?.name || "(unknown schema)";
    if (type === "TraceInstance") {
      const ti = traceInstancesById.get(key);
      if (!ti) return "(unknown trace instance)";
      const traceSchemaName = traceSchemasById.get(String(ti.traceSchemaId))?.name;
      return traceSchemaName ? `${traceSchemaName}: ${ti.sourceInstanceName}` : (ti.sourceInstanceName || "(trace instance)");
    }
    return "(unknown)";
  };

  const toggleTrace = (id) => setSelectedTraceIds((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const toggleSchema = (id) => setSelectedSchemaIds((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const runExtraction = async () => {
    if ((!selectedTraceIds.size && !selectedSchemaIds.size) || extractBusy) return;
    setExtractBusy(true);
    setExtractError("");
    try {
      const doc = await createReasoningExtraction({
        traceIds: [...selectedTraceIds],
        schemaIds: [...selectedSchemaIds],
      });
      setCurrentExtraction(doc);
    } catch (err) {
      setExtractError(err.message || "RabbitHole Reasoning extraction failed.");
      if (err.extraction) setCurrentExtraction(err.extraction);
    } finally {
      setExtractBusy(false);
    }
  };

  const handleDecide = async (tempId, decision, editedFields) => {
    if (!currentExtraction) return;
    setReviewBusy(true);
    try {
      const updated = await reviewReasoningExtraction(currentExtraction._id, [{ tempId, decision, editedFields }]);
      setCurrentExtraction(updated);
    } catch (err) {
      setExtractError(err.message || "Failed to update the review.");
    } finally {
      setReviewBusy(false);
    }
  };

  const handleSaveAccepted = async (tempIds) => {
    if (!currentExtraction) return;
    setReviewBusy(true);
    try {
      const { extraction } = await saveReasoningExtraction(currentExtraction._id, tempIds);
      setCurrentExtraction(extraction);
      await refreshReasoning();
    } catch (err) {
      setExtractError(err.message || "Failed to save the accepted items.");
    } finally {
      setReviewBusy(false);
    }
  };

  const typeCounts = useMemo(() => {
    const counts = new Map();
    for (const [type, list] of index.byType.entries()) counts.set(type, list.length);
    return counts;
  }, [index]);

  const visibleEntities = activeType === "all"
    ? reasoningData.reasoningEntities
    : (index.byType.get(activeType) || []);

  const selectedEntity = selectedEntityId ? reasoningEntitiesById.get(selectedEntityId) || null : null;

  const handleEditSave = async (patch) => {
    setEditSaving(true);
    setEditError("");
    try {
      await reasoningEntityClient.update(selectedEntityId, patch);
      await refreshReasoning();
    } catch (err) {
      setEditError(err.message || "Failed to save changes.");
    } finally {
      setEditSaving(false);
    }
  };

  const handleEditDelete = async () => {
    if (!window.confirm(`Delete "${selectedEntity?.name}"? This cannot be undone.`)) return;
    try {
      await reasoningEntityClient.remove(selectedEntityId);
      setSelectedEntityId(null);
      await refreshReasoning();
    } catch (err) {
      setEditError(err.message || "Failed to delete that item.");
    }
  };

  const typePanelEl = (
    <div id="mrp_domain_panel">
      <div className="mrp_panel_label">Reasoning Type</div>
      <button type="button" className={`mrp_domain_row${activeType === "all" ? " mrp_domain_row--active" : ""}`} onClick={() => { setActiveType("all"); setSelectedEntityId(null); setDrawerOpen(false); }}>
        <span className="mrp_domain_name">All Types</span>
        <span className="mrp_domain_count">{reasoningData.reasoningEntities.length}</span>
      </button>
      {[...typeCounts.keys()].map((type) => (
        <button key={type} type="button" className={`mrp_domain_row${activeType === type ? " mrp_domain_row--active" : ""}`} onClick={() => { setActiveType(type); setSelectedEntityId(null); setDrawerOpen(false); }}>
          <span className="mrp_domain_name">{REASONING_TYPE_LABELS[type] || type}</span>
          <span className="mrp_domain_count">{typeCounts.get(type)}</span>
        </button>
      ))}
    </div>
  );

  return (
    <div id="cs_root">
      <div id="cs_header">
        <button id="cs_back" onClick={() => navigate("/home")} title="Back">
          <i className="fi fi-rr-arrow-left" />
        </button>
        <button id="cs_drawer_toggle" onClick={() => setDrawerOpen((v) => !v)} title="Browse reasoning types">
          <i className="fi fi-rr-menu-burger" />
        </button>
        <div id="cs_header_titles">
          <span id="cs_title">RabbitHole Reasoning</span>
          <span id="cs_subtitle">RabbitHole Trace / Schema → RabbitHole Reasoning-dependent Entity</span>
        </div>
        <div id="cs_header_meta">
          <span className="cs_count_badge" style={{ color: "#ab47bc", background: "color-mix(in srgb, #ab47bc 12%, transparent)", borderColor: "color-mix(in srgb, #ab47bc 28%, transparent)" }}>
            {reasoningData.reasoningEntities.length} saved item{reasoningData.reasoningEntities.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      <div id="mrp_extraction_bar">
        {morpheLoading ? (
          <span className="mrp_empty_hint">Loading RabbitHole Morphe data…</span>
        ) : (!morpheData.schemas.length && !morpheData.traceInstances.length) ? (
          <span className="mrp_empty_hint">No saved RabbitHole Morphe Trace Instances/Schemata yet — save some via "Extract RabbitHole Relations" first.</span>
        ) : (
          <details id="rsp_input_picker">
            <summary>{selectedTraceIds.size + selectedSchemaIds.size} input{selectedTraceIds.size + selectedSchemaIds.size !== 1 ? "s" : ""} selected</summary>
            <div className="rsp_picker_body">
              {morpheData.schemas.length > 0 && (
                <div className="rsp_picker_group">
                  <div className="rsp_picker_group_label">Schemata</div>
                  {morpheData.schemas.map((s) => (
                    <label key={s._id} className="rsp_picker_row">
                      <input type="checkbox" checked={selectedSchemaIds.has(s._id)} onChange={() => toggleSchema(s._id)} />
                      {s.name}
                    </label>
                  ))}
                </div>
              )}
              {morpheData.traceInstances.length > 0 && (
                <div className="rsp_picker_group">
                  <div className="rsp_picker_group_label">Trace Instances</div>
                  {morpheData.traceInstances.map((t) => (
                    <label key={t._id} className="rsp_picker_row">
                      <input type="checkbox" checked={selectedTraceIds.has(t._id)} onChange={() => toggleTrace(t._id)} />
                      {traceSchemasById.get(String(t.traceSchemaId))?.name || "Trace"}: {t.sourceInstanceName || t._id}
                    </label>
                  ))}
                </div>
              )}
            </div>
          </details>
        )}
        <button
          type="button"
          id="mrp_extract_btn"
          onClick={runExtraction}
          disabled={(!selectedTraceIds.size && !selectedSchemaIds.size) || extractBusy}
        >
          {extractBusy ? (<><i className="bx bx-loader-circle mrp_icon_spin" /> Reasoning…</>) : (<><i className="fi fi-rr-sparkles" /> Extract Reasoning</>)}
        </button>
      </div>

      {extractError && (
        <div id="cs_row_error">
          <i className="bx bx-error" /> {extractError}
          <button type="button" onClick={() => setExtractError("")}><i className="bx bx-x" /></button>
        </div>
      )}
      {reasoningError && (
        <div id="cs_row_error">
          <i className="bx bx-error" /> {reasoningError}
          <button type="button" onClick={() => setReasoningError("")}><i className="bx bx-x" /></button>
        </div>
      )}

      {currentExtraction && currentExtraction.normalizedResponse && (
        <ReasoningReviewList
          extraction={currentExtraction}
          busy={reviewBusy}
          onDecide={handleDecide}
          onSaveAccepted={handleSaveAccepted}
        />
      )}

      <div id="cs_body">
        <div id="cs_left">{typePanelEl}</div>

        {drawerOpen && (
          <div id="cs_drawer_backdrop" onClick={() => setDrawerOpen(false)}>
            <div id="cs_drawer_sheet" onClick={(e) => e.stopPropagation()}>{typePanelEl}</div>
          </div>
        )}

        <div id="mrp_middle">
          {reasoningLoading ? (
            <div id="cs_no_selection"><i className="bx bx-loader-circle mrp_icon_spin" /><p>Loading RabbitHole Reasoning…</p></div>
          ) : visibleEntities.length === 0 ? (
            <p className="mrp_empty_hint">No RabbitHole Reasoning-dependent entities saved yet.</p>
          ) : (
            <div id="mrp_entity_list">
              {visibleEntities.map((e) => (
                <button
                  key={e._id}
                  type="button"
                  className={`mrp_entity_row${selectedEntityId === e._id ? " mrp_entity_row--active" : ""}`}
                  onClick={() => { setSelectedEntityId(e._id); setEditError(""); setDrawerOpen(false); }}
                >
                  <span className="mrp_entity_row_name">{e.name}</span>
                  <span className="mrp_entity_row_meta">
                    <span className="mrp_count_chip">{REASONING_TYPE_LABELS[e.reasoningType] || e.reasoningType}</span>
                    {e.dependsOn?.length > 0 && <span className="mrp_count_chip">{e.dependsOn.length} dependenc{e.dependsOn.length !== 1 ? "ies" : "y"}</span>}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div id="cs_right">
          <ReasoningEditor
            item={selectedEntity}
            relationsFor={index.relationsFor}
            resolveName={resolveName}
            saving={editSaving}
            saveError={editError}
            onSave={handleEditSave}
            onDelete={handleEditDelete}
          />
        </div>
      </div>
    </div>
  );
}
