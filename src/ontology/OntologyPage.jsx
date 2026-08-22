import React, { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  AMCTOSHS_CONCEPTS,
  AMCTOSHS_ONTOLOGY_VERSION,
  MODE_OF_ACCESS,
} from "../ontology/amctoshsOntology";
import "./ontologyPage.css";

const titleCase = (value) => value.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const ONTOLOGY_EDITS_KEY = "amctoshs_ontology_card_edits";
const ONTOLOGY_ORDER_KEY = "amctoshs_ontology_card_order";
const DRAG_HOLD_DELAY_MS = 450;
const DRAG_HOLD_CANCEL_DISTANCE = 10;

const canonicalCard = (concept) => ({
  category: concept.category || "",
  status: concept.independent === true ? "Independent" : concept.independent === false ? "Dependent" : "",
  label: concept.label || "",
  definitions: Array.isArray(concept.definitions)
    ? concept.definitions
    : [concept.definition || ""],
  dependsOn: concept.dependsOn?.map(titleCase).join(" · ") || "",
  relations: concept.relations?.map(({ type, target }) => `${type} → ${titleCase(target)}`).join(" · ") || "",
});

const readStoredEdits = () => {
  try {
    const stored = JSON.parse(localStorage.getItem(ONTOLOGY_EDITS_KEY) || "{}");
    return stored && typeof stored === "object" ? stored : {};
  } catch {
    return {};
  }
};

const readStoredOrder = (conceptIds) => {
  try {
    const stored = JSON.parse(localStorage.getItem(ONTOLOGY_ORDER_KEY) || "[]");
    if (!Array.isArray(stored)) return conceptIds;
    const known = stored.filter((id) => conceptIds.includes(id));
    return [...known, ...conceptIds.filter((id) => !known.includes(id))];
  } catch {
    return conceptIds;
  }
};

const getRegistryColumnCount = () => {
  if (typeof window === "undefined") return 3;
  if (window.innerWidth <= 650) return 1;
  if (window.innerWidth <= 900) return 2;
  return 3;
};

const OntologyPage = () => {
  const navigate = useNavigate();
  const canonicalConcepts = Object.values(AMCTOSHS_CONCEPTS);
  const conceptIds = canonicalConcepts.map((concept) => concept.id);
  const [conceptOrder, setConceptOrder] = useState(conceptIds);
  const concepts = conceptOrder.map((id) => AMCTOSHS_CONCEPTS[id]).filter(Boolean);
  const [edits, setEdits] = useState({});
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [definitionPages, setDefinitionPages] = useState({});
  const [touchStart, setTouchStart] = useState({});
  const fieldTouchRef = useRef(new WeakMap());
  const activePointerDragRef = useRef(null);
  const [draggingId, setDraggingId] = useState(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [registryColumnCount, setRegistryColumnCount] = useState(getRegistryColumnCount);
  const [selectedConceptId, setSelectedConceptId] = useState(conceptIds[0] || "");
  const conceptRefs = useRef(new Map());

  useEffect(() => setEdits(readStoredEdits()), []);
  useEffect(() => setConceptOrder(readStoredOrder(conceptIds)), [conceptIds.join("|")]);
  useEffect(() => {
    const updateColumnCount = () => setRegistryColumnCount(getRegistryColumnCount());
    window.addEventListener("resize", updateColumnCount);
    return () => window.removeEventListener("resize", updateColumnCount);
  }, []);
  useEffect(() => () => clearTimeout(activePointerDragRef.current?.activationTimer), []);

  const getCardText = (concept) => {
    const stored = edits[concept.id] || {};
    const migrated = stored.definitions
      ? stored
      : stored.definition !== undefined
        ? { ...stored, definitions: [stored.definition] }
        : stored;
    return { ...canonicalCard(concept), ...migrated };
  };
  const updateDraft = (field, value) => setDraft((previous) => ({ ...(previous || {}), [field]: value }));
  const getDefinitionIndex = (conceptId, pageCount) => Math.min(definitionPages[conceptId] || 0, Math.max(0, pageCount - 1));
  const setDefinitionIndex = (conceptId, index) => setDefinitionPages((previous) => ({ ...previous, [conceptId]: index }));
  const moveDefinition = (conceptId, pageCount, amount) => {
    const current = getDefinitionIndex(conceptId, pageCount);
    setDefinitionIndex(conceptId, Math.max(0, Math.min(pageCount - 1, current + amount)));
  };
  const handleDefinitionTouchStart = (conceptId, event) => setTouchStart((previous) => ({ ...previous, [conceptId]: event.changedTouches[0].clientX }));
  const handleDefinitionTouchEnd = (conceptId, pageCount, event) => {
    const start = touchStart[conceptId];
    if (typeof start !== "number") return;
    const distance = event.changedTouches[0].clientX - start;
    if (Math.abs(distance) > 40) moveDefinition(conceptId, pageCount, distance < 0 ? 1 : -1);
    setTouchStart((previous) => ({ ...previous, [conceptId]: null }));
  };
  const clearNativeSelection = () => window.getSelection?.()?.removeAllRanges();
  const handleFieldFocus = (event) => {
    clearNativeSelection();
    const field = event.currentTarget;
    requestAnimationFrame(() => {
      if (document.activeElement !== field || typeof field.setSelectionRange !== "function") return;
      const end = field.value.length;
      field.setSelectionRange(end, end);
    });
  };
  const handleFieldTouchStart = (event) => {
    clearNativeSelection();
    const field = event.currentTarget;
    const now = Date.now();
    const previous = fieldTouchRef.current.get(field) || 0;
    if (now - previous < 450) {
      event.preventDefault();
      fieldTouchRef.current.set(field, 0);
      clearNativeSelection();
      return;
    }
    fieldTouchRef.current.set(field, now);
  };
  const handleFieldTouchEnd = (event) => {
    const field = event.currentTarget;
    const startedAt = fieldTouchRef.current.get(field) || 0;
    if (!startedAt) {
      event.preventDefault();
      clearNativeSelection();
      return;
    }
    if (Date.now() - startedAt < 450) clearNativeSelection();
  };
  const handleFieldDoubleClick = (event) => {
    event.preventDefault();
    clearNativeSelection();
  };
  const startEditing = (concept) => {
    setEditingId(concept.id);
    setDraft(getCardText(concept));
  };
  const cancelEditing = () => {
    setEditingId(null);
    setDraft(null);
  };
  const saveEditing = (concept) => {
    const nextEdits = { ...edits, [concept.id]: draft };
    setEdits(nextEdits);
    localStorage.setItem(ONTOLOGY_EDITS_KEY, JSON.stringify(nextEdits));
    cancelEditing();
  };
  const resetCard = (concept) => {
    const nextEdits = { ...edits };
    delete nextEdits[concept.id];
    setEdits(nextEdits);
    localStorage.setItem(ONTOLOGY_EDITS_KEY, JSON.stringify(nextEdits));
    cancelEditing();
  };
  const handleCardPointerDown = (conceptId, event) => {
    if (editingId === conceptId || event.target.closest("button, input, textarea, select, a, .ontology_definition_pager")) return;
    const active = {
      conceptId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      order: conceptOrder,
      lastTargetId: null,
      correctionX: 0,
      correctionY: 0,
      activated: false,
      activationTimer: null,
      cardElement: event.currentTarget,
    };
    activePointerDragRef.current = active;
    try {
      active.cardElement.setPointerCapture?.(active.pointerId);
    } catch {
      activePointerDragRef.current = null;
      return;
    }
    active.activationTimer = window.setTimeout(() => {
      if (activePointerDragRef.current !== active) return;
      active.activated = true;
      setDraggingId(conceptId);
      setDragOffset({ x: 0, y: 0 });
    }, DRAG_HOLD_DELAY_MS);
  };
  const handleCardPointerMove = (event) => {
    const active = activePointerDragRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (!active.activated) {
      const distance = Math.hypot(event.clientX - active.startX, event.clientY - active.startY);
      if (distance > DRAG_HOLD_CANCEL_DISTANCE) {
        clearTimeout(active.activationTimer);
        active.cardElement.releasePointerCapture?.(active.pointerId);
        activePointerDragRef.current = null;
      }
      return;
    }
    event.preventDefault();
    const pointerOffset = {
      x: event.clientX - active.startX,
      y: event.clientY - active.startY,
    };

    const targetCard = document.elementsFromPoint(event.clientX, event.clientY)
      .map((element) => element.closest?.("[data-ontology-concept-id]"))
      .find((element) => element?.dataset.ontologyConceptId !== active.conceptId);
    const targetId = targetCard?.dataset.ontologyConceptId || null;
    if (!targetId) {
      active.lastTargetId = null;
      setDragOffset({ x: pointerOffset.x + active.correctionX, y: pointerOffset.y + active.correctionY });
      return;
    }
    if (targetId === active.lastTargetId) {
      setDragOffset({ x: pointerOffset.x + active.correctionX, y: pointerOffset.y + active.correctionY });
      return;
    }
    active.lastTargetId = targetId;
    const draggedSelector = `[data-ontology-concept-id="${active.conceptId}"]`;
    const beforeRect = document.querySelector(draggedSelector)?.getBoundingClientRect();
    let orderChanged = false;
    flushSync(() => {
      setConceptOrder((previous) => {
        const fromIndex = previous.indexOf(active.conceptId);
        const targetIndex = previous.indexOf(targetId);
        if (fromIndex < 0 || targetIndex < 0 || fromIndex === targetIndex) return previous;
        const next = [...previous];
        next.splice(fromIndex, 1);
        next.splice(targetIndex, 0, active.conceptId);
        active.order = next;
        orderChanged = true;
        return next;
      });
    });
    if (orderChanged && beforeRect) {
      const afterRect = document.querySelector(draggedSelector)?.getBoundingClientRect();
      if (afterRect) {
        active.correctionX += beforeRect.left - afterRect.left;
        active.correctionY += beforeRect.top - afterRect.top;
      }
    }
    setDragOffset({ x: pointerOffset.x + active.correctionX, y: pointerOffset.y + active.correctionY });
  };
  const handleCardPointerUp = (event) => {
    const active = activePointerDragRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    clearTimeout(active.activationTimer);
    if (!active.activated) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      activePointerDragRef.current = null;
      return;
    }
    localStorage.setItem(ONTOLOGY_ORDER_KEY, JSON.stringify(active.order));
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    activePointerDragRef.current = null;
    setDraggingId(null);
    setDragOffset({ x: 0, y: 0 });
  };

  const focusConcept = (conceptId) => {
    setSelectedConceptId(conceptId);
    conceptRefs.current.get(conceptId)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const conceptColumns = Array.from({ length: registryColumnCount }, () => []);
  concepts.forEach((concept, index) => conceptColumns[index % registryColumnCount].push({ concept, index }));

  return (
    <main id="ontology_page">
      <header className="ontology_page_header">
        <button type="button" className="ontology_back" onClick={() => navigate(-1)} aria-label="Go back">←</button>
        <div>
          <span className="ontology_eyebrow">RabbitHole · DOCUMENTATIONS v{AMCTOSHS_ONTOLOGY_VERSION}</span>
          <h1>RabbitHole Documentations</h1>
        </div>
      </header>

      <div className="ontology_page_scroll">
        <aside className="ontology_documentation_aside" aria-label="RabbitHole ontology navigation">
          <div className="ontology_documentation_aside_heading">
            <span className="ontology_section_label">Ontology</span>
            <strong>App concepts</strong>
          </div>
          <nav className="ontology_documentation_nav" aria-label="Documentation topics">
            {concepts.map((concept) => (
              <button key={concept.id} type="button" className={selectedConceptId === concept.id ? "is-active" : ""} onClick={() => focusConcept(concept.id)}>
                <span>{concept.label}</span>
                <small>{concept.category}</small>
              </button>
            ))}
          </nav>
        </aside>

        <section className="ontology_documentation_viewer" aria-label="RabbitHole documentation viewer">
          <section className="ontology_intro">
            <span className="ontology_section_label">Canonical concept registry</span>
            <h2>The terms that organize patient reality.</h2>
            <p>
              RabbitHole represents patient reality as accessed and distinguished by a particular
              Clinician through a particular Mode of Access. Select an ontology concept from the
              left aside to open its documentation here.
            </p>
          </section>

          <section className="ontology_concepts" aria-labelledby="ontology_concepts_title">
            <div className="ontology_list_heading">
              <div>
                <span className="ontology_section_label">Documentation</span>
                <h2 id="ontology_concepts_title">RabbitHole ontology</h2>
              </div>
              <span className="ontology_count">{concepts.length} concepts · Select Edit on any card</span>
            </div>
            <div className="ontology_concept_grid" style={{ "--ontology-column-count": registryColumnCount }}>
            {conceptColumns.map((column, columnIndex) => (
              <div className="ontology_concept_column" key={`ontology-column-${columnIndex}`}>
            {column.map(({ concept, index }) => {
              const text = getCardText(concept);
              const editing = editingId === concept.id;
              return (
              <article
                data-ontology-concept-id={concept.id}
                ref={(element) => {
                  if (element) conceptRefs.current.set(concept.id, element);
                  else conceptRefs.current.delete(concept.id);
                }}
                className={`ontology_concept_card${editing ? " is-editing" : ""}${draggingId === concept.id ? " is-dragging" : ""}`}
                key={concept.id}
                style={draggingId === concept.id ? { transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)` } : undefined}
                onPointerDown={(event) => handleCardPointerDown(concept.id, event)}
                onPointerMove={handleCardPointerMove}
                onPointerUp={handleCardPointerUp}
                onPointerCancel={handleCardPointerUp}
              >
                {editing ? (
                  <div className="ontology_card_editor">
                    {Object.entries(draft || text).filter(([field]) => field !== "definitions").map(([field, value]) => (
                      <label key={field}>
                        <span>{field === "dependsOn" ? "Depends on" : field === "relations" ? "Relations" : field}</span>
                        {field === "dependsOn" || field === "relations" ? (
                          <textarea value={String(value ?? "")} onChange={(event) => updateDraft(field, event.target.value)} onFocus={handleFieldFocus} onTouchStart={handleFieldTouchStart} onTouchEnd={handleFieldTouchEnd} onDoubleClick={handleFieldDoubleClick} rows={2} />
                        ) : (
                          <input type="text" value={String(value ?? "")} onChange={(event) => updateDraft(field, event.target.value)} onFocus={handleFieldFocus} onTouchStart={handleFieldTouchStart} onTouchEnd={handleFieldTouchEnd} onDoubleClick={handleFieldDoubleClick} />
                        )}
                      </label>
                    ))}
                    <div className="ontology_definitions_editor">
                      <span className="ontology_editor_field_label">Definition pages</span>
                      {(draft?.definitions || text.definitions).map((definition, index) => (
                        <div className="ontology_definition_editor_row" key={`definition-${index}`}>
                          <span>{index + 1}</span>
                          <textarea value={definition} onChange={(event) => updateDraft("definitions", (draft?.definitions || text.definitions).map((item, itemIndex) => itemIndex === index ? event.target.value : item))} onFocus={handleFieldFocus} onTouchStart={handleFieldTouchStart} onTouchEnd={handleFieldTouchEnd} onDoubleClick={handleFieldDoubleClick} rows={5} />
                          {(draft?.definitions || text.definitions).length > 1 && <button type="button" onClick={() => updateDraft("definitions", (draft?.definitions || text.definitions).filter((_, itemIndex) => itemIndex !== index))}>Remove</button>}
                        </div>
                      ))}
                      <button type="button" onClick={() => updateDraft("definitions", [...(draft?.definitions || text.definitions), ""])}>Add definition page</button>
                    </div>
                    <div className="ontology_card_actions">
                      <button type="button" onClick={() => saveEditing(concept)}>Save</button>
                      <button type="button" onClick={cancelEditing}>Cancel</button>
                      <button type="button" onClick={() => resetCard(concept)}>Reset original</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="ontology_concept_meta">
                      <span className="ontology_card_number">{String(index).padStart(2, "0")}</span>
                      <span>{text.category}</span>
                      {text.status && <b>{text.status}</b>}
                    </div>
                    <div className="ontology_card_title_row"><h3>{text.label}</h3><button type="button" className="ontology_edit_button" onClick={() => startEditing(concept)}>Edit</button></div>
                    {(() => {
                      const pageCount = text.definitions.length;
                      const pageIndex = getDefinitionIndex(concept.id, pageCount);
                      return (
                        <div className="ontology_definition_pager" onTouchStart={(event) => handleDefinitionTouchStart(concept.id, event)} onTouchEnd={(event) => handleDefinitionTouchEnd(concept.id, pageCount, event)}>
                          <p>{text.definitions[pageIndex]}</p>
                          {pageCount > 1 && (
                            <div className="ontology_definition_navigation">
                              <button type="button" onClick={() => moveDefinition(concept.id, pageCount, -1)} disabled={pageIndex === 0} aria-label="Previous definition">←</button>
                              <span>Definition {pageIndex + 1} of {pageCount}</span>
                              <button type="button" onClick={() => moveDefinition(concept.id, pageCount, 1)} disabled={pageIndex === pageCount - 1} aria-label="Next definition">→</button>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                    {concept.id === "mode-of-access" && (
                      <div className="ontology_mode_sequence">
                        <strong>What can be distinguished</strong>
                        <div className="ontology_access_steps">
                          {MODE_OF_ACCESS.map((mode, modeIndex) => (
                            <React.Fragment key={mode}>
                              {modeIndex > 0 && <span className="ontology_access_arrow" aria-hidden="true">→</span>}
                              <span className="ontology_access_step"><small>{String(modeIndex + 1).padStart(2, "0")}</small>{titleCase(mode)}</span>
                            </React.Fragment>
                          ))}
                        </div>
                      </div>
                    )}
                    {text.dependsOn && <div className="ontology_card_row"><strong>Depends on</strong><span>{text.dependsOn}</span></div>}
                    {text.relations && <div className="ontology_card_row"><strong>Relations</strong><span>{text.relations}</span></div>}
                  </>
                )}
              </article>
              );
            })}
              </div>
            ))}
          </div>
        </section>
        </section>
      </div>
    </main>
  );
};

export default OntologyPage;
