import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./clinicalSchemata.css";
import "./morphePanels.css";
import { listMorphe, morpheSchemas, morpheTraceInstances, morpheTraceSchemas, morpheTextRelations } from "./amctoshsMorpheClient";
import { buildMorpheIndex } from "./amctoshsMorpheGraph";
import MorpheEntityNav, { MORPHE_MODE_GROUPS } from "./MorpheEntityNav";
import MorpheInfoTab from "./MorpheInfoTab";
import MorpheObjectsAside from "./MorpheObjectsAside";
import MorpheTraceTable from "./MorpheTraceTable";
import Morphe3DTraceCreator from "./Morphe3DTraceCreator";
import { MORPHE_OBJECT_MODES } from "./amctoshsMorpheConstants";

// RabbitHole Morphe — the structured DESTINATION where accepted RabbitHole
// Objects, 3D traces/instances, and 4D relations/traces/schemata are
// browsed and edited through the grouped RabbitHole Morphe modes. This page is
// browse/edit ONLY — it never triggers AI extraction itself. The
// extraction action ("Extract RabbitHole Relations") lives on the RabbitHole
// Segmentation page instead (see ../Segmentations/SegmentationsPage.jsx);
// accepted results saved from there simply appear here. RabbitHole
// Reasoning (a separate page/tool) is downstream of what's saved here — it
// is never triggered from this page either.

export default function ClinicalSchemata() {
  const navigate = useNavigate();

  const [morpheData, setMorpheData] = useState({ schemas: [], instances: [], traceSchemas: [], traceInstances: [], relations: [], textRelations: [] });
  const [morpheLoading, setMorpheLoading] = useState(true);
  const [morpheError, setMorpheError] = useState("");

  const [activeDimension, setActiveDimension] = useState("3d");
  const [activeEntityType, setActiveEntityType] = useState("traceSchemas3d");
  const [selectedItemId, setSelectedItemId] = useState(null);
  const [objectCreating, setObjectCreating] = useState(false);
  const [objectCreateError, setObjectCreateError] = useState("");
  const [selectedObjectId, setSelectedObjectId] = useState(null);
  const [traceCreating, setTraceCreating] = useState(false);
  const [traceCreateError, setTraceCreateError] = useState("");
  const [activeMorpheView, setActiveMorpheView] = useState("entities");

  const refreshMorphe = async () => {
    setMorpheLoading(true);
    try {
      const data = await listMorphe();
      setMorpheData(data);
      setMorpheError("");
    } catch (err) {
      setMorpheError(err.message || "Could not load RabbitHole Morphe data.");
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

  const selectEntityType = (type) => {
    if (["traceSchemas3d", "instances"].includes(type)) setActiveDimension("3d");
    if (["textRelations", "traceSchemas4d", "schemas"].includes(type)) setActiveDimension("4d");
    setActiveEntityType(type);
    setSelectedItemId(null);
  };

  const selectItem = (type, id) => {
    if (type === "traceSchemas") {
      const traceSchema = index.traceSchemasById?.get(String(id));
      const dimension = String(traceSchema?.traceDimension || "3D").toUpperCase();
      setActiveDimension(dimension === "4D" ? "4d" : "3d");
      setActiveEntityType(dimension === "4D" ? "traceSchemas4d" : "traceSchemas3d");
    } else if (type === "traceInstances") {
      setActiveDimension("3d");
      setActiveEntityType("instances");
    } else if (type === "textRelations") {
      setActiveDimension("4d");
      setActiveEntityType("textRelations");
    } else if (type === "schemas") {
      setActiveDimension("4d");
      setActiveEntityType("schemas");
    }
    setSelectedItemId(id);
  };

  const selectObject = (object) => {
    setSelectedObjectId(object._id);
    setSelectedItemId(object._id);
  };

  const create3DTrace = async ({ biologicalSensor, accessMethod, proxyDevices, traceName }) => {
    if (!selectedObjectId) {
      setTraceCreateError("Select an RabbitHole object first.");
      return false;
    }
    setTraceCreating(true);
    setTraceCreateError("");
    try {
      const result = await morpheTraceSchemas.create({ sourceSchemaId: selectedObjectId, biologicalSensor, accessMethod, proxyDevices, traceName });
      await refreshMorphe();
      if (result.traceSchema) selectItem("traceSchemas", result.traceSchema._id);
      return true;
    } catch (err) {
      setTraceCreateError(err.message || "Failed to create the 3D Trace.");
      return false;
    } finally {
      setTraceCreating(false);
    }
  };

  const createObject = async ({ modeOfAccess, schemaName }) => {
    setObjectCreating(true);
    setObjectCreateError("");
    try {
      const result = await morpheSchemas.create({ modeOfAccess, schemaName: String(schemaName || "").trim() });
      await refreshMorphe();
      if (result.schema) selectObject(result.schema);
      return true;
    } catch (err) {
      setObjectCreateError(err.message || "Failed to create the RabbitHole object.");
      return false;
    } finally {
      setObjectCreating(false);
    }
  };

  const editObject = async (object, patch) => {
    try {
      const updated = await morpheSchemas.update(object._id, patch);
      await refreshMorphe();
      if (selectedObjectId === object._id) selectObject(updated);
      return true;
    } catch (err) {
      setObjectCreateError(err.message || "Failed to edit the RabbitHole object.");
      return false;
    }
  };

  const deleteObject = async (object) => {
    try {
      await morpheSchemas.remove(object._id);
      if (selectedObjectId === object._id) {
        setSelectedObjectId(null);
        setSelectedItemId(null);
      }
      await refreshMorphe();
      return true;
    } catch (err) {
      setObjectCreateError(err.message || "Failed to delete the RabbitHole object.");
      return false;
    }
  };

  const createTraceValue = async ({ traceSchemaId, value, unit }) => {
    await morpheTraceInstances.create({ traceSchemaId, value, unit });
    await refreshMorphe();
    selectItem("traceSchemas", traceSchemaId);
  };

  const totalSaved = morpheData.schemas.length + morpheData.instances.length + morpheData.traceSchemas.length
    + morpheData.traceInstances.length + morpheData.textRelations.length;

  const entityCounts = useMemo(() => {
    const counts = {
      schemas: morpheData.schemas.length,
      instances: morpheData.traceInstances.filter((trace) => {
        const parent = index.traceSchemasById?.get(String(trace.traceSchemaId));
        return String(parent?.traceDimension || "3D").toUpperCase() === "3D";
      }).length,
      traceSchemas4d: morpheData.traceSchemas.filter((trace) => String(trace.traceDimension || "3D").toUpperCase() === "4D").length,
      traceSchemas3d: morpheData.traceSchemas.filter((trace) => String(trace.traceDimension || "3D").toUpperCase() === "3D").length,
      textRelations: morpheData.textRelations.length,
    };
    for (const { domain } of MORPHE_OBJECT_MODES) {
      counts[`object:${domain}`] = morpheData.schemas.filter((schema) => schema.domain === domain).length;
    }
    return counts;
  }, [index, morpheData]);

  const activeDimensionGroup = MORPHE_MODE_GROUPS.find((group) => group.key === activeDimension);
  const selectDimension = (dimension) => {
    setActiveDimension(dimension);
    selectEntityType(dimension === "3d" ? "traceSchemas3d" : "textRelations");
  };

  return (
    <div id="cs_root">
      <div id="cs_header">
        <button id="cs_back" onClick={() => navigate("/home")} title="Back">
          <i className="fi fi-rr-arrow-left" />
        </button>
        <div id="cs_header_titles">
          <span id="cs_title">
            RabbitHole's Patient Representation
            <button
              type="button"
              id="cs_info_btn"
              className={activeMorpheView === "information" ? "cs_info_btn--active" : undefined}
              onClick={() => setActiveMorpheView((view) => (view === "information" ? "entities" : "information"))}
              aria-label="Open RabbitHole Representation information"
              aria-expanded={activeMorpheView === "information"}
              aria-controls="mrp_information"
              title="About RabbitHole Representation Entities"
            >
              <i className="bx bx-info-circle" aria-hidden="true" />
            </button>
          </span>
          <span id="cs_subtitle">Objects / 3D Traces and Instances / 4D Relations, Traces and Schemata</span>
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

      <div id="cs_body" className={activeMorpheView === "information" ? "cs_body--information" : undefined}>
        {activeMorpheView === "information" ? (
          <MorpheInfoTab onBackToEntities={() => setActiveMorpheView("entities")} />
        ) : (
        <div id="mrp_content">
        <MorpheObjectsAside
          schemas={morpheData.schemas}
          selectedItemId={selectedObjectId}
          creating={objectCreating}
          error={objectCreateError}
          onCreate={createObject}
          onSelect={selectObject}
          onEdit={editObject}
          onDelete={deleteObject}
        />
        <main id="mrp_dimension_main">
          <div id="mrp_dimension_tabs" role="tablist" aria-label="RabbitHole object dimension">
            <button type="button" role="tab" aria-selected={activeDimension === "3d"} className={`mrp_dimension_tab${activeDimension === "3d" ? " mrp_dimension_tab--active" : ""}`} onClick={() => selectDimension("3d")}>RabbitHole OBJECT in 3D</button>
            <button type="button" role="tab" aria-selected={activeDimension === "4d"} className={`mrp_dimension_tab${activeDimension === "4d" ? " mrp_dimension_tab--active" : ""}`} onClick={() => selectDimension("4d")}>RabbitHole OBJECT in 4D</button>
          </div>
          <div id="mrp_dimension_subtabs" role="tablist" aria-label={`${activeDimension.toUpperCase()} modes`}>
            {activeDimensionGroup?.children.map(([key, label, description]) => (
              <button key={key} type="button" role="tab" title={description || label} aria-selected={activeEntityType === key} className={`mrp_dimension_subtab${activeEntityType === key ? " mrp_dimension_subtab--active" : ""}`} onClick={() => selectEntityType(key)}>
                {label}<span className="mrp_entity_tab_count">{entityCounts[key] || 0}</span>
              </button>
            ))}
          </div>
          <div id="mrp_dimension_workspace">
            <aside id="mrp_items_aside">
              {activeDimension === "3d" && (
                <Morphe3DTraceCreator traceSchemas={morpheData.traceSchemas} selectedObject={selectedObjectId ? index.schemasById?.get(selectedObjectId) : null} creating={traceCreating} error={traceCreateError} onCreate={create3DTrace} />
              )}
              {morpheLoading ? (
                <div id="cs_no_selection"><i className="bx bx-loader-circle mrp_icon_spin" /><p>Loading RabbitHole Representation…</p></div>
              ) : (
                <MorpheEntityNav index={index} activeEntityType={activeEntityType} onSelectEntityType={selectEntityType} selectedItemId={selectedItemId} onSelectItem={selectItem} textRelations={morpheData.textRelations} showTabs={false} />
              )}
            </aside>
            <section id="cs_right">
              {!morpheLoading && <MorpheTraceTable index={index} selectedItemId={selectedItemId} onCreateValue={createTraceValue} />}
            </section>
          </div>
        </main>
        </div>
        )}
      </div>
    </div>
  );
}
