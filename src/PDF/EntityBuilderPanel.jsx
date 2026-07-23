import React, { useEffect, useMemo, useRef, useState } from "react";
import "./entityBuilderPanel.css";
import { InfoPopupButton } from "./InfoPopupButton";
import { apiUrl } from "../config/api";
import { readStoredSession } from "../utils/sessionCleanup";
import { AMCTOSHS_ENTITY_INFO, ENTITY_DOMAINS, ENTITY_TYPES, formatEntity } from "./entityBuilderConstants";
import { listAmctoshsEntities, createAmctoshsEntity, deleteAmctoshsEntity } from "./amctoshsEntitiesClient";

const jsonHeaders = () => {
  const session = readStoredSession();
  return { "Content-Type": "application/json", ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}) };
};

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

const EntityBuilderPanel = ({ onClose, selectedText = "", verifyBusy = false, onVerifySource = null }) => {
  const [entityType, setEntityType] = useState("schema");
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
  // it too. Also clears when the PDF selection is dismissed, but only if
  // the box still holds exactly what the last selection put there — text
  // the user has since typed or edited is left alone.
  const lastNameSyncRef = useRef("");
  useEffect(() => {
    if (cleanSelectedText) {
      setName(cleanSelectedText);
      lastNameSyncRef.current = cleanSelectedText;
    } else {
      setName((current) => (current === lastNameSyncRef.current ? "" : current));
      lastNameSyncRef.current = "";
    }
  }, [cleanSelectedText]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await migrateLocalHistoryIfNeeded();
      try {
        const entities = await listAmctoshsEntities();
        if (!cancelled) setHistory(entities);
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
    sourceText: name.trim(),
    name: name.trim(),
    domain,
    parentSchema: parentSchema.trim(),
    traceName: traceName.trim(),
    value: value.trim(),
    unit: unit.trim(),
  }), [activeType.label, domain, entityType, name, parentSchema, traceName, unit, value]);

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
      const data = await createAmctoshsEntity(draftEntry);
      setHistory((prev) => [data, ...prev].slice(0, 30));
      setError("");
    } catch (err) {
      setError(err.message || "Failed to save that entity — check your connection.");
    }
  };

  const deleteEntity = async (id) => {
    const prev = history;
    setHistory((current) => current.filter((item) => item.id !== id));
    try {
      await deleteAmctoshsEntity(id);
    } catch {
      setHistory(prev);
    }
  };

  const clearForm = () => {
    setName("");
    setParentSchema("");
    setTraceName("");
    setValue("");
    setUnit("");
    setError("");
  };

  const verifySourceText = async () => {
    if (!onVerifySource || verifyBusy) return;
    const text = name.trim();
    if (!text) {
      setError("Enter or select text before verifying it.");
      return;
    }
    setError("");
    try {
      const corrected = await onVerifySource(text);
      if (corrected) setName(corrected);
    } catch (err) {
      setError(err.message || "Verification failed.");
    }
  };

  return (
    <div id="entity_builder_panel" onMouseDown={(event) => event.stopPropagation()}>
      <div id="entity_builder_header">
        <span id="entity_builder_header_title">
          <i className="bx bx-network-chart" /> AMCTOSHS Entity Builder
          <InfoPopupButton
            info="Builds only from selected text or text entered here. Page text is not used."
            label="AMCTOSHS Entity Builder info"
          />
        </span>
        <button type="button" id="entity_builder_close" onClick={onClose} title="Close">✕</button>
      </div>

      <div id="entity_builder_body">
        <div className="entity_builder_label_row">
          <label className="entity_builder_label" htmlFor="entity_builder_name">Name</label>
          <button
            type="button"
            id="entity_builder_verify"
            onClick={verifySourceText}
            disabled={verifyBusy || !name.trim()}
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
        <input id="entity_builder_name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Example: heart" />

        <div className="entity_builder_label_row">
          <label className="entity_builder_label" htmlFor="entity_builder_type">AMCTOSHS Sub-Entity</label>
          <InfoPopupButton info={AMCTOSHS_ENTITY_INFO} label="AMCTOSHS Sub-Entity info" />
        </div>
        <select id="entity_builder_type" value={entityType} onChange={(event) => setEntityType(event.target.value)}>
          {ENTITY_TYPES.map((type) => <option key={type.key} value={type.key}>{type.label}</option>)}
        </select>
        <p className="entity_builder_helper">{activeType.helper}</p>

        {entityType === "schema" && (
          <>
            <label className="entity_builder_label" htmlFor="entity_builder_domain">AMCTOSHS Sub-Entity schema Domain</label>
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

        {error && <div className="entity_builder_status entity_builder_status--error"><i className="bx bx-error" /> {error}</div>}

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

      {verifyBusy && (
        <div id="entity_builder_footer">
          <i className="bx bx-loader-circle pdf_icon_spin" /> Using AI to verify this text against the page.
        </div>
      )}
    </div>
  );
};

export default EntityBuilderPanel;
