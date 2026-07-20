import React, { useEffect, useMemo, useState } from "react";
import "./narrativeModePanel.css";
import { InfoPopupButton } from "./InfoPopupButton";
import { apiUrl } from "../config/api";
import { readStoredSession } from "../utils/sessionCleanup";

const authHeaders = () => {
  const session = readStoredSession();
  return session?.token ? { Authorization: `Bearer ${session.token}` } : {};
};
const jsonHeaders = () => ({ "Content-Type": "application/json", ...authHeaders() });

const AMCTOSHS_ENTITY_INFO = "An AMCTOSHS sub-entity is a representation of an aspect of a patient (ontic entity), constructed from the observed traces through which that aspect is known.";

const ENTITY_DOMAINS = [
  "Atoms",
  "Molecules",
  "Tissues",
  "Organs",
  "Organ Systems",
  "Humans",
  "Societies",
];

const ENTITY_TYPES = [
  {
    key: "schema",
    label: "Entity Schema",
    icon: "bx bx-cube-alt",
    helper: "Points to an ontic object, such as heart.",
  },
  {
    key: "trace",
    label: "Entity Schema Trace",
    icon: "bx bx-git-branch",
    helper: "Nested inside a preexisting Entity Schema.",
  },
  {
    key: "trace_value",
    label: "Entity Schema Trace Value",
    icon: "bx bx-ruler",
    helper: "A value for an existing trace. Unit is required.",
  },
  {
    key: "instance",
    label: "Entity Schema Instance",
    icon: "bx bx-layer-plus",
    helper: "Instantiates a schema via one trace:value pair. Build several for a schema with multiple traces.",
  },
  {
    key: "intervener",
    label: "Trace Value Changer",
    icon: "bx bx-transfer-alt",
    helper: "A.k.a. Entity Intervener.",
  },
];

const ENTITY_BUILDER_STORAGE_KEY = "amctoshs_entity_builder_history";
const ENTITY_BUILDER_MIGRATED_KEY = "amctoshs_entity_builder_migrated";

// One-time migration of whatever was already built under the old
// localStorage-only history into the backend AmctoshsEntity collection —
// after this runs once per browser, the backend is the source of truth
// and this localStorage key is never written to again.
const migrateLocalHistoryIfNeeded = async () => {
  if (localStorage.getItem(ENTITY_BUILDER_MIGRATED_KEY)) return;
  let entries = [];
  try {
    const parsed = JSON.parse(localStorage.getItem(ENTITY_BUILDER_STORAGE_KEY) || "[]");
    entries = Array.isArray(parsed) ? parsed : [];
  } catch {
    entries = [];
  }
  for (const entry of entries) {
    try {
      await fetch(apiUrl("/api/amctoshs-entities"), {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify(entry),
      });
    } catch {
      // best-effort — a failed migration entry just stays absent server-side
    }
  }
  localStorage.setItem(ENTITY_BUILDER_MIGRATED_KEY, "1");
};

const formatEntity = (entry) => {
  const lines = [
    "AMCTOSHS Sub-Entity:",
    `1. Entity Type: ${entry.typeLabel}`,
  ];

  if (entry.type === "schema") {
    lines.push(`2. Entity Schema: ${entry.name || "Untitled Schema"}`);
    lines.push(`3. Entity Schema Domain: ${entry.domain}`);
    lines.push(`4. Ontic Object Text: ${entry.sourceText}`);
  } else if (entry.type === "trace") {
    lines.push(`2. Entity Schema Trace: ${entry.name || "Untitled Trace"}`);
    lines.push(`3. Nested Inside Entity Schema: ${entry.parentSchema || "Not specified"}`);
    lines.push(`4. Trace Source Text: ${entry.sourceText}`);
  } else if (entry.type === "trace_value") {
    lines.push(`2. Entity Schema Trace: ${entry.traceName || "Not specified"}`);
    lines.push(`3. Entity Schema Trace Value: ${entry.value || entry.sourceText}`);
    lines.push(`4. Unit: ${entry.unit}`);
  } else if (entry.type === "instance") {
    lines.push(`2. Entity Schema Instance: ${entry.name || "Untitled Instance"}`);
    lines.push(`3. Entity Schema Name: ${entry.parentSchema || "Not specified"}`);
    lines.push(`4. Entity Schema Trace Name: ${entry.traceName || "Not specified"}`);
    lines.push(`5. Entity Schema Trace Value Entry: ${entry.value || "Not specified"}`);
  } else if (entry.type === "intervener") {
    lines.push(`2. Entity Intervener: ${entry.name || "Untitled Intervener"}`);
    lines.push(`3. Target Entity Schema Trace Value: ${entry.traceName || "Not specified"}`);
    lines.push(`4. Change: ${entry.value || entry.sourceText}`);
    lines.push(`5. Unit: ${entry.unit || "Not specified"}`);
  }

  return lines.join("\n");
};

const NarrativeModePanel = ({ onClose, selectedText = "", verifyBusy = false, onVerifySource = null }) => {
  const [entityType, setEntityType] = useState("schema");
  const [sourceText, setSourceText] = useState("");
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("Organs");
  const [parentSchema, setParentSchema] = useState("");
  const [traceName, setTraceName] = useState("");
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState("");
  const [error, setError] = useState("");
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  const cleanSelectedText = selectedText.trim();
  const activeType = ENTITY_TYPES.find((type) => type.key === entityType) || ENTITY_TYPES[0];
  const schemaOptions = useMemo(() => {
    const seen = new Set();
    return history
      .filter((entry) => entry.type === "schema" && entry.name)
      .map((entry) => entry.name)
      .filter((schemaName) => {
        const key = schemaName.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [history]);

  // Live — selectedText already tracks the current PDF selection in real
  // time, including mid-drag as a selection handle moves (see
  // manualSelection's own effect in PDFPage.jsx), so this box should track
  // it too rather than only grabbing a one-time snapshot the first time
  // it's empty. Only fires forward on an actual new selection (never
  // clears the box just because the selection was dismissed), so typed/
  // edited text survives until a genuinely new selection replaces it.
  useEffect(() => {
    if (cleanSelectedText) setSourceText(cleanSelectedText);
  }, [cleanSelectedText]);

  // Name takes its value from the same live selection, same "only fires
  // forward on an actual new selection" rule as sourceText above — still
  // a plain editable input afterward, this just seeds it instead of
  // leaving it blank.
  useEffect(() => {
    if (cleanSelectedText) setName(cleanSelectedText);
  }, [cleanSelectedText]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await migrateLocalHistoryIfNeeded();
      try {
        const res = await fetch(apiUrl("/api/amctoshs-entities"), { headers: authHeaders() });
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok) setHistory(Array.isArray(data.entities) ? data.entities : []);
      } catch {
        // best-effort — leave history empty rather than blocking the panel
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const draftEntry = useMemo(() => ({
    type: entityType,
    typeLabel: activeType.label,
    sourceText: sourceText.trim(),
    name: name.trim(),
    domain,
    parentSchema: parentSchema.trim(),
    traceName: traceName.trim(),
    value: value.trim(),
    unit: unit.trim(),
  }), [activeType.label, domain, entityType, name, parentSchema, sourceText, traceName, unit, value]);

  const preview = draftEntry.sourceText ? formatEntity(draftEntry) : "";

  const buildEntity = async () => {
    if (!draftEntry.sourceText) {
      setError("Select text or enter text before building an AMCTOSHS Sub-Entity.");
      return;
    }
    if ((entityType === "trace" || entityType === "instance") && !draftEntry.parentSchema) {
      setError("Select a preexisting Entity Schema.");
      return;
    }
    if (entityType === "trace_value" && !draftEntry.unit) {
      setError("Entity Schema Trace Value must include a unit.");
      return;
    }
    if (entityType === "instance" && (!draftEntry.traceName || !draftEntry.value)) {
      setError("Enter both the Entity Schema Trace name and its Trace Value entry.");
      return;
    }
    try {
      const res = await fetch(apiUrl("/api/amctoshs-entities"), {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify(draftEntry),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Failed to save that entity.");
        return;
      }
      setHistory((prev) => [data, ...prev].slice(0, 30));
      setError("");
    } catch {
      setError("Failed to save that entity — check your connection.");
    }
  };

  const deleteEntity = async (id) => {
    const prev = history;
    setHistory((current) => current.filter((item) => item.id !== id));
    try {
      const res = await fetch(apiUrl(`/api/amctoshs-entities/${id}`), { method: "DELETE", headers: authHeaders() });
      if (!res.ok) setHistory(prev);
    } catch {
      setHistory(prev);
    }
  };

  const clearForm = () => {
    setSourceText("");
    setName("");
    setParentSchema("");
    setTraceName("");
    setValue("");
    setUnit("");
    setError("");
  };

  const verifySourceText = async () => {
    if (!onVerifySource || verifyBusy) return;
    const text = sourceText.trim();
    if (!text) {
      setError("Enter or select text before verifying it.");
      return;
    }
    setError("");
    try {
      const corrected = await onVerifySource(text);
      if (corrected) setSourceText(corrected);
    } catch (err) {
      setError(err.message || "Verification failed.");
    }
  };

  return (
    <div id="narrative_mode_panel" onMouseDown={(event) => event.stopPropagation()}>
      <div id="narrative_mode_header">
        <span id="narrative_mode_header_title"><i className="bx bx-network-chart" /> AMCTOSHS Entities Builder</span>
        <button type="button" id="narrative_mode_close" onClick={onClose} title="Close">✕</button>
      </div>

      <div id="entity_builder_body">
        <div className="entity_builder_notice">
          <i className="bx bx-selection" />
          Builds only from selected text or text entered here. Page text is not used.
        </div>

        {cleanSelectedText && (
          <button type="button" className="entity_builder_selected_btn" onClick={() => setSourceText(cleanSelectedText)}>
            <i className="bx bx-import" /> Use selected text
          </button>
        )}

        <div className="entity_builder_label_row">
          <label className="entity_builder_label" htmlFor="entity_builder_source">Selected Text</label>
          <button
            type="button"
            id="entity_builder_verify"
            onClick={verifySourceText}
            disabled={verifyBusy || !sourceText.trim()}
            title="Verify/correct this text against the current PDF page"
            aria-label="Verify builder source text"
          >
            {verifyBusy ? <i className="bx bx-loader-circle pdf_icon_spin" /> : (
              <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M18.71 5.29a.996.996 0 0 0-1.41 0l-11 11a1 1 0 0 0-.29.71v3c0 .55.45 1 1 1h3c.27 0 .52-.11.71-.29l11-11a.996.996 0 0 0 0-1.41l-3-3ZM9.59 19H8v-1.59l7.5-7.5 1.59 1.59zm8.91-8.91L16.91 8.5 18 7.41 19.59 9zM7 12c.26 0 .5-.15.61-.4l1.23-2.77 2.77-1.23c.24-.11.4-.35.4-.61s-.16-.5-.4-.61L8.84 5.15 7.61 2.38a.68.68 0 0 0-.6-.4c-.27-.02-.5.15-.61.39L5.17 5.04 2.39 6.38c-.23.11-.38.35-.38.61s.16.49.4.6l2.77 1.23 1.23 2.77c.11.24.35.4.61.4Zm14.76 6.63-1.66-.74-.74-1.66a.41.41 0 0 0-.36-.24c-.16-.01-.3.09-.37.23l-.74 1.6-1.67.8c-.14.07-.23.21-.23.37s.1.3.24.36l1.66.74.74 1.66a.404.404 0 0 0 .74 0l.74-1.66 1.66-.74a.404.404 0 0 0 0-.74Z" />
              </svg>
            )}
          </button>
        </div>
        <textarea
          id="entity_builder_source"
          value={sourceText}
          onChange={(event) => setSourceText(event.target.value)}
          placeholder="Select text from the PDF, or enter text manually..."
        />

        <div className="entity_builder_label_row">
          <label className="entity_builder_label" htmlFor="entity_builder_type">AMCTOSHS Sub-Entity</label>
          <InfoPopupButton info={AMCTOSHS_ENTITY_INFO} label="AMCTOSHS Sub-Entity info" />
        </div>
        <select id="entity_builder_type" value={entityType} onChange={(event) => setEntityType(event.target.value)}>
          {ENTITY_TYPES.map((type) => <option key={type.key} value={type.key}>{type.label}</option>)}
        </select>
        <p className="entity_builder_helper">{activeType.helper}</p>

        {(entityType === "schema" || entityType === "trace" || entityType === "instance" || entityType === "intervener") && (
          <>
            <label className="entity_builder_label" htmlFor="entity_builder_name">Name</label>
            <input id="entity_builder_name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Example: heart" />
          </>
        )}

        {entityType === "schema" && (
          <>
            <label className="entity_builder_label" htmlFor="entity_builder_domain">Entity Schema Domain</label>
            <select id="entity_builder_domain" value={domain} onChange={(event) => setDomain(event.target.value)}>
              {ENTITY_DOMAINS.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </>
        )}

        {(entityType === "trace" || entityType === "instance") && (
          <>
            <label className="entity_builder_label" htmlFor="entity_builder_parent">Preexisting Entity Schema</label>
            <select
              id="entity_builder_parent"
              value={parentSchema}
              onChange={(event) => setParentSchema(event.target.value)}
              disabled={schemaOptions.length === 0}
            >
              <option value="">{schemaOptions.length === 0 ? "Build an Entity Schema first" : "Select an Entity Schema"}</option>
              {schemaOptions.map((schemaName) => (
                <option key={schemaName} value={schemaName}>{schemaName}</option>
              ))}
            </select>
          </>
        )}

        {(entityType === "trace_value" || entityType === "intervener" || entityType === "instance") && (
          <>
            <label className="entity_builder_label" htmlFor="entity_builder_trace">
              {entityType === "instance" ? "Entity Schema Trace Name" : "Existing Entity Schema Trace"}
            </label>
            <input id="entity_builder_trace" value={traceName} onChange={(event) => setTraceName(event.target.value)} placeholder="Example: heart rate" />
            <label className="entity_builder_label" htmlFor="entity_builder_value">
              {entityType === "instance" ? "Entity Schema Trace Value Entry" : "Value / change"}
            </label>
            <input id="entity_builder_value" value={value} onChange={(event) => setValue(event.target.value)} placeholder="Example: 72" />
            {entityType !== "instance" && (
              <>
                <label className="entity_builder_label" htmlFor="entity_builder_unit">Unit{entityType === "trace_value" ? " (required)" : ""}</label>
                <input id="entity_builder_unit" value={unit} onChange={(event) => setUnit(event.target.value)} placeholder="Example: beats/min" />
              </>
            )}
          </>
        )}

        {error && <div className="narrative_mode_status narrative_mode_status--error"><i className="bx bx-error" /> {error}</div>}

        <div id="entity_builder_actions">
          <button type="button" id="entity_builder_build" onClick={buildEntity}>
            <i className="bx bx-buildings" /> Build Entity
          </button>
          <button type="button" id="entity_builder_clear" onClick={clearForm}>
            <i className="bx bx-eraser" /> Clear
          </button>
        </div>

        {preview && (
          <>
            <div className="entity_builder_section_title">Preview</div>
            <pre id="entity_builder_preview">{preview}</pre>
          </>
        )}

        {historyLoading && <p className="entity_builder_helper">Loading your built entities...</p>}

        {history.length > 0 && (
          <>
            <div className="entity_builder_section_title">Built Entities</div>
            <div id="entity_builder_history">
              {history.map((entry) => (
                <article key={entry.id} className="entity_builder_history_item">
                  <div className="entity_builder_history_top">
                    <strong>{entry.typeLabel}</strong>
                    <button
                      type="button"
                      onClick={() => deleteEntity(entry.id)}
                      title="Delete entity"
                    >
                      <i className="bx bx-trash" />
                    </button>
                  </div>
                  <pre>{formatEntity(entry)}</pre>
                </article>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default NarrativeModePanel;
