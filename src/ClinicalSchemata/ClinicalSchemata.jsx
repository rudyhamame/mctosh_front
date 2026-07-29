import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./clinicalSchemata.css";
import "./morphePanels.css";
import { listMorphe, morpheSchemas, morpheInstances, morpheTraceSchemas, morpheTraceInstances, morpheTextRelations } from "./amctoshsMorpheClient";
import { buildMorpheIndex } from "./amctoshsMorpheGraph";
import MorpheDomainPanel from "./MorpheDomainPanel";
import MorpheEntityNav from "./MorpheEntityNav";
import MorpheEditorPanel from "./MorpheEditorPanel";

// AMCTOSHS Morphe — the structured DESTINATION where accepted AMCTOSHS
// Sub-Entity Schemata/Instances, Trace Schemata/Instances, and Relations
// are browsed and edited, organized by AMCTOSHS Domain. This page is
// browse/edit ONLY — it never triggers AI extraction itself. The
// extraction action ("Extract AMCTOSHS Relations") lives on the AMCTOSHS
// Segmentation page instead (see ../Segmentations/SegmentationsPage.jsx);
// accepted results saved from there simply appear here. AMCTOSHS
// Reasoning (a separate page/tool) is downstream of what's saved here — it
// is never triggered from this page either.

const ENTITY_MODEL_CLIENT = {
  schemas: morpheSchemas, instances: morpheInstances,
  traceSchemas: morpheTraceSchemas, traceInstances: morpheTraceInstances,
  textRelations: morpheTextRelations,
};

export default function ClinicalSchemata() {
  const navigate = useNavigate();

  const [morpheData, setMorpheData] = useState({ schemas: [], instances: [], traceSchemas: [], traceInstances: [], relations: [], textRelations: [] });
  const [morpheLoading, setMorpheLoading] = useState(true);
  const [morpheError, setMorpheError] = useState("");

  const [activeDomain, setActiveDomain] = useState("all");
  const [activeEntityType, setActiveEntityType] = useState("schemas");
  const [selectedItemId, setSelectedItemId] = useState(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);

  const refreshMorphe = async () => {
    setMorpheLoading(true);
    try {
      const data = await listMorphe();
      setMorpheData(data);
      setMorpheError("");
    } catch (err) {
      setMorpheError(err.message || "Could not load AMCTOSHS Morphe data.");
    } finally {
      setMorpheLoading(false);
    }
  };

  useEffect(() => { refreshMorphe(); }, []);

  const index = useMemo(() => {
    const built = buildMorpheIndex(morpheData);
    built.schemasById = new Map(morpheData.schemas.map((s) => [s._id, s]));
    built.instancesById = new Map(morpheData.instances.map((i) => [i._id, i]));
    built.traceSchemasById = new Map(morpheData.traceSchemas.map((t) => [t._id, t]));
    built.traceInstancesById = new Map(morpheData.traceInstances.map((t) => [t._id, t]));
    built.textRelationsById = new Map(morpheData.textRelations.map((r) => [r._id, r]));
    return built;
  }, [morpheData]);

  const countsByDomain = useMemo(() => {
    const map = new Map();
    for (const [domain, group] of index.byDomain.entries()) {
      map.set(domain, {
        schemas: group.schemas.length, instances: group.instances.length,
        traceSchemas: group.traceSchemas.length, traceInstances: group.traceInstances.length,
      });
    }
    return map;
  }, [index]);

  const selectedItem = selectedItemId ? index[`${activeEntityType}ById`]?.get(selectedItemId) || null : null;

  const selectDomain = (domain) => {
    setActiveDomain(domain);
    setSelectedItemId(null);
    setDrawerOpen(false);
  };

  const selectEntityType = (type) => {
    setActiveEntityType(type);
    setSelectedItemId(null);
  };

  const selectItem = (type, id) => {
    setActiveEntityType(type);
    setSelectedItemId(id);
    setEditError("");
    setDrawerOpen(false);
  };

  const handleEditSave = async (patch) => {
    setEditSaving(true);
    setEditError("");
    try {
      await ENTITY_MODEL_CLIENT[activeEntityType].update(selectedItemId, patch);
      await refreshMorphe();
    } catch (err) {
      setEditError(err.message || "Failed to save changes.");
    } finally {
      setEditSaving(false);
    }
  };

  const handleEditDelete = async () => {
    const label = selectedItem?.name || selectedItem?.instanceName || selectedItem?.sourceInstanceName
      || (selectedItem?.subject ? `${selectedItem.subject} —${selectedItem.predicate}→ ${selectedItem.object}` : null)
      || "this item";
    if (!window.confirm(`Delete ${label}? This cannot be undone.`)) return;
    try {
      await ENTITY_MODEL_CLIENT[activeEntityType].remove(selectedItemId);
      setSelectedItemId(null);
      await refreshMorphe();
    } catch (err) {
      setEditError(err.message || "Failed to delete that item.");
    }
  };

  const totalSaved = morpheData.schemas.length + morpheData.instances.length + morpheData.traceSchemas.length
    + morpheData.traceInstances.length + morpheData.textRelations.length;

  const domainPanelEl = <MorpheDomainPanel activeDomain={activeDomain} onSelectDomain={selectDomain} countsByDomain={countsByDomain} />;

  return (
    <div id="cs_root">
      <div id="cs_header">
        <button id="cs_back" onClick={() => navigate("/home")} title="Back">
          <i className="fi fi-rr-arrow-left" />
        </button>
        <button id="cs_drawer_toggle" onClick={() => setDrawerOpen((v) => !v)} title="Browse AMCTOSHS Domains">
          <i className="fi fi-rr-menu-burger" />
        </button>
        <div id="cs_header_titles">
          <span id="cs_title">AMCTOSHS Morphe</span>
          <span id="cs_subtitle">Sub-Entity Schema / Instance / Trace Schema / Trace Instance / Relation</span>
        </div>
        <div id="cs_header_meta">
          <span className="cs_count_badge">{totalSaved} saved item{totalSaved !== 1 ? "s" : ""}</span>
        </div>
      </div>

      {morpheError && (
        <div id="cs_row_error">
          <i className="bx bx-error" /> {morpheError}
          <button type="button" onClick={() => setMorpheError("")}><i className="bx bx-x" /></button>
        </div>
      )}

      <div id="cs_body">
        <div id="cs_left">{domainPanelEl}</div>

        {drawerOpen && (
          <div id="cs_drawer_backdrop" onClick={() => setDrawerOpen(false)}>
            <div id="cs_drawer_sheet" onClick={(e) => e.stopPropagation()}>{domainPanelEl}</div>
          </div>
        )}

        <div id="mrp_middle">
          {morpheLoading ? (
            <div id="cs_no_selection"><i className="bx bx-loader-circle mrp_icon_spin" /><p>Loading AMCTOSHS Morphe…</p></div>
          ) : (
            <MorpheEntityNav
              index={index}
              activeDomain={activeDomain}
              activeEntityType={activeEntityType}
              onSelectEntityType={selectEntityType}
              selectedItemId={selectedItemId}
              onSelectItem={selectItem}
              textRelations={morpheData.textRelations}
            />
          )}
        </div>

        <div id="cs_right">
          <MorpheEditorPanel
            itemType={activeEntityType}
            item={selectedItem}
            index={index}
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
