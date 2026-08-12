import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { lookupDictionaryWord } from "../utils/dictionarySettings";
import {
  deleteSavedVocabulary,
  listSavedVocabulary,
  saveVocabulary,
  updateVocabulary,
} from "../utils/vocabApi";
import UmlsConceptTable from "./UmlsConceptTable";
import { searchUmls } from "./umlsClient";
import { fetchFirstUmlsConceptInLanguage } from "./umlsQueue";
import { translateVocabularyContent } from "./vocabTranslationClient";
import "./vocabsPage.css";

const EMPTY_DRAFT = Object.freeze({ word: "", translation: "", definition: "" });

const firstValue = (...values) => values.find((value) => value !== undefined && value !== null && value !== "");

const getUmls = (item) => item?.umls || item?.umlsData || item?.umlsResponse || {};

const hasLookupResult = (item) => {
  const umls = getUmls(item);
  return item?.dictionaryResponseType === "entries"
    || Boolean(item?.definitions?.some?.((definition) => definition?.definition))
    || Boolean(firstValue(umls.cui, umls.CUI, umls.ui, umls.UI, umls.result?.ui));
};

const formatList = (value) => {
  if (Array.isArray(value)) return value.filter(Boolean).join(", ");
  return String(value || "");
};

const playPronunciation = (item) => {
  if (item.audioUrl) {
    const audio = new Audio(item.audioUrl);
    void audio.play().catch(() => {});
    return;
  }
  if (typeof window !== "undefined" && "speechSynthesis" in window && item.word) {
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(item.word));
  }
};

const QueuedVocabularyTable = ({ items, selectedId, onSelect, onEdit, onDelete, onLookup, deletingId, lookupBusy, lookupMode, lookupIds, onToggleLookup, newEntryOpen, newEntryWord, onNewEntryChange, onNewEntrySubmit, onNewEntryCancel, addingEntry, loading = false }) => (
  <div className="vocabs_queue_list">
    {newEntryOpen && (
      <form className="vocabs_queue_new_entry" onSubmit={onNewEntrySubmit}>
        <input value={newEntryWord} onChange={(event) => onNewEntryChange(event.target.value)} onFocus={() => queueMicrotask(() => window.dispatchEvent(new CustomEvent("virtual-keyboard:open")))} placeholder="New entry" aria-label="New vocabulary entry" disabled={addingEntry} autoFocus />
        <span className="vocabs_row_actions">
          <button type="button" onClick={onNewEntryCancel} disabled={addingEntry} aria-label="Cancel new vocabulary entry" title="Cancel"><i className="fi fi-rr-cross-small" /></button>
          <button className="is-lookup" type="submit" disabled={addingEntry || !newEntryWord.trim()} aria-label="Save new vocabulary entry" title="Save entry"><i className={`fi ${addingEntry ? "fi-rr-spinner" : "fi-rr-check"}`} /></button>
        </span>
      </form>
    )}
    <ul>
      {items.map((item) => {
        const isSelected = selectedId === item.id;
        const isLookupSelected = lookupIds.has(item.id);
        return (
          <li key={item.id} data-vocab-row={item.id} className={isSelected ? "is-selected" : ""} onClick={() => lookupMode ? onToggleLookup(item.id) : onSelect(item.id)}>
            <span className="vocabs_queued_entry_cell">
              {lookupMode && <input type="checkbox" checked={isLookupSelected} onChange={() => onToggleLookup(item.id)} onClick={(event) => event.stopPropagation()} aria-label={`Select ${item.word} for lookup`} />}
              <span className="vocabs_entry_index_text">
                <strong>{item.word || "Untitled"}</strong>
                <small className={hasLookupResult(item) ? "is-completed" : "is-queued"}>{hasLookupResult(item) ? "Completed" : "Queued"}</small>
              </span>
            </span>
            <details className="vocabs_entry_actions_menu" onClick={(event) => event.stopPropagation()}>
              <summary aria-label={`Open actions for ${item.word}`} title="Entry actions">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 10a2 2 0 1 0 0 4 2 2 0 1 0 0-4m0 6a2 2 0 1 0 0 4 2 2 0 1 0 0-4m0-12a2 2 0 1 0 0 4 2 2 0 1 0 0-4" />
                </svg>
              </summary>
              <span className="vocabs_row_actions vocabs_entry_actions_dropdown">
                <button className="is-delete" type="button" onClick={() => onDelete(item)} disabled={deletingId === item.id || lookupBusy} aria-label={`Delete ${item.word}`} title="Delete vocabulary"><i className={`fi ${deletingId === item.id ? "fi-rr-spinner" : "fi-rr-trash"}`} /></button>
                <button type="button" onClick={() => onEdit(item)} disabled={deletingId === item.id || lookupBusy} aria-label={`Edit ${item.word}`} title="Edit vocabulary"><i className="fi fi-rr-pencil" /></button>
                <button className="is-lookup" type="button" onClick={() => onLookup(item)} disabled={deletingId === item.id || lookupBusy} aria-label={`Look up ${item.word}`} title="Start lookup"><i className={`fi ${lookupBusy ? "fi-rr-spinner" : "fi-rr-play"}`} /></button>
              </span>
            </details>
          </li>
        );
      })}
    </ul>
    {items.length === 0 && !newEntryOpen && <p className="vocabs_queue_empty">{loading ? "Loading vocabulary…" : "No queued entries."}</p>}
  </div>
);

const VocabComparisonTable = ({ items, entryIndexById, selectedId, onSelect, onEdit, onDelete, busyId, lookupMode, lookupIds, onToggleLookup, dataTab, loading = false, emptyMessage }) => (
  <div className="vocabs_comparison_wrap">
    <table className="vocabs_comparison_table">
      <thead>
        {dataTab === "dictionary" ? (
          <>
            <tr>
              {lookupMode && <th rowSpan="2" className="vocabs_lookup_check_heading">Select</th>}
              <th rowSpan="2">ID</th>
              <th colSpan="2">Entry</th>
              <th colSpan="2">Definition</th>
              <th rowSpan="2">Part of speech</th>
              <th rowSpan="2">Phonetic</th>
              <th rowSpan="2">Source</th>
              <th rowSpan="2">Status</th>
              <th rowSpan="2">Actions</th>
            </tr>
            <tr className="vocabs_subcolumn_headings">
              <th>Original</th>
              <th>Translated</th>
              <th>Original</th>
              <th>Translated</th>
            </tr>
          </>
        ) : (
          <tr>
            {lookupMode && <th className="vocabs_lookup_check_heading">Select</th>}
            <th>ID</th>
            <th>Entry</th>
            <th>Translation</th>
            <th>CUI</th>
            <th>Preferred concept</th>
            <th>Semantic type</th>
            <th>Actions</th>
          </tr>
        )}
      </thead>
      <tbody>
        {items.map((item, index) => {
          const entryId = `vocab#${String((entryIndexById?.get(item.id) ?? index) + 1).padStart(2, "0")}`;
          const definition = item.definitions?.[0] || {};
          const umls = getUmls(item);
          const dictionarySuggestions = (item.dictionarySuggestions?.length
            ? item.dictionarySuggestions
            : item.dictionaryResponseType === "suggestions" && Array.isArray(item.dictionaryResponse)
              ? item.dictionaryResponse.filter((value) => typeof value === "string")
              : []).slice(0, 8);
          const isSelected = selectedId === item.id;
          const isLookupSelected = lookupIds.has(item.id);
          return (
            <tr key={item.id} data-vocab-row={item.id} className={isSelected ? "is-selected" : ""} onClick={() => lookupMode ? onToggleLookup(item.id) : onSelect(item.id)}>
              {lookupMode && (
                <td className="vocabs_lookup_check_cell">
                  <input
                    type="checkbox"
                    checked={isLookupSelected}
                    onChange={() => onToggleLookup(item.id)}
                    onClick={(event) => event.stopPropagation()}
                    aria-label={`Select ${item.word} for lookup`}
                  />
                </td>
              )}
              <td><code>{entryId}</code></td>
              <td>
                <div className="vocabs_entry_cell">
                  <strong>
                    {item.word || "Untitled"}
                    {item.dictionaryOriginalEntry && item.dictionaryOriginalEntry.toLocaleLowerCase() !== String(item.word || "").toLocaleLowerCase() && (
                      <span className="vocabs_original_entry"> [{item.dictionaryOriginalEntry}]</span>
                    )}
                  </strong>
                </div>
              </td>
              {dataTab === "dictionary" ? (
                <>
                  <td className="vocabs_translation_cell">{item.translation || "—"}</td>
                  <td className="vocabs_definition_cell">{definition.definition || "—"}</td>
                  <td className="vocabs_definition_cell vocabs_definition_translation_cell">{definition.translation || "—"}</td>
                  <td>{firstValue(definition.partOfSpeech, definition.part_of_speech) || "—"}</td>
                  <td>
                    <span className="vocabs_phonetic_cell">
                      {item.word && <button type="button" className="vocabs_audio_button" onClick={(event) => { event.stopPropagation(); playPronunciation(item); }} aria-label={`Play pronunciation of ${item.word}`} title="Play pronunciation"><i className="fi fi-rr-play" /></button>}
                    </span>
                  </td>
                  <td className="vocabs_source_cell">
                    <span>
                      {item.source === "medical"
                        ? "Medical"
                        : item.source === "collegiate"
                          ? "General (fallback)"
                          : item.source === "ai"
                            ? "AI (fallback)"
                            : "—"}
                    </span>
                  </td>
                  <td className="vocabs_result_cell">
                    {item.dictionaryResponseType === "entries" ? (
                      <span className="vocabs_result_status vocabs_result_status--found"><i className="fi fi-rr-check" /> Found</span>
                    ) : item.dictionaryResponseType === "suggestions" ? (
                      <div className="vocabs_result_suggestions">
                        <span className="vocabs_result_status vocabs_result_status--suggested"><i className="fi fi-rr-search" /> Suggestions only</span>
                        {dictionarySuggestions.length > 0 ? (
                          <div className="vocabs_alternative_list" aria-label={`Dictionary alternatives for ${item.word}`}>
                            {dictionarySuggestions.map((suggestion) => <span key={suggestion}>{suggestion}</span>)}
                          </div>
                        ) : <small>No alternatives returned</small>}
                      </div>
                    ) : (
                      <span className="vocabs_result_status vocabs_result_status--pending"><i className="fi fi-rr-minus" /> Not confirmed</span>
                    )}
                  </td>
                </>
              ) : (
                <>
                  <td className="vocabs_translation_cell">{item.translation || "—"}</td>
                  <td><code>{firstValue(umls.cui, umls.CUI) || "—"}</code></td>
                  <td>{firstValue(umls.preferredName, umls.preferred_name, umls.name) || "—"}</td>
                  <td>{formatList(firstValue(umls.semanticTypes, umls.semantic_types, umls.semanticType)) || "—"}</td>
                </>
              )}
              <td>
                <span className="vocabs_row_actions">
                  <button type="button" onClick={(event) => { event.stopPropagation(); onEdit(item); }} disabled={busyId === item.id} aria-label={`Edit ${item.word}`} title="Edit vocabulary"><i className="fi fi-rr-pencil" /></button>
                  <button className="is-delete" type="button" onClick={(event) => { event.stopPropagation(); onDelete(item); }} disabled={busyId === item.id} aria-label={`Delete ${item.word}`} title="Delete vocabulary"><i className={`fi ${busyId === item.id ? "fi-rr-spinner" : "fi-rr-trash"}`} /></button>
                </span>
              </td>
            </tr>
          );
        })}
        {items.length === 0 && (
          <tr>
            <td className="vocabs_table_empty" colSpan={dataTab === "dictionary" ? (lookupMode ? 11 : 10) : (lookupMode ? 8 : 7)}>
              {loading ? "Loading vocabulary…" : emptyMessage || "No vocabulary entries yet. Use “Add new vocab” to create one."}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  </div>
);

const VocabsPage = () => {
  const navigate = useNavigate();
  const [saved, setSaved] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [newEntryOpen, setNewEntryOpen] = useState(false);
  const [newEntryWord, setNewEntryWord] = useState("");
  const [addingEntry, setAddingEntry] = useState(false);
  const [lookupMode, setLookupMode] = useState(false);
  const [lookupIds, setLookupIds] = useState(() => new Set());
  const [lookupBusy, setLookupBusy] = useState(false);
  const [alternativeQueue, setAlternativeQueue] = useState([]);
  const [alternativeBusyId, setAlternativeBusyId] = useState("");
  const [dataTab, setDataTab] = useState("dictionary");
  const [completedSearch, setCompletedSearch] = useState("");
  const [error, setError] = useState("");
  const tableRef = useRef(null);

  const entryIndexById = new Map(saved.map((item, index) => [item.id, index]));
  const normalizedCompletedSearch = completedSearch.trim().toLocaleLowerCase();
  const matchesEntrySearch = (item) => !normalizedCompletedSearch || [item.word, item.translation, item.dictionaryOriginalEntry]
    .some((value) => String(value || "").toLocaleLowerCase().includes(normalizedCompletedSearch));
  const filteredSavedItems = saved.filter(matchesEntrySearch);
  const selectedTableItem = filteredSavedItems.find((item) => item.id === selectedId) || null;
  const renderedTableItems = selectedTableItem ? [selectedTableItem] : filteredSavedItems;

  useEffect(() => {
    let cancelled = false;
    listSavedVocabulary()
      .then((data) => {
        if (!cancelled) {
          const entries = Array.isArray(data.saved) ? data.saved : [];
          setSaved(entries);
          setSelectedId(entries[0]?.id || "");
        }
      })
      .catch((requestError) => {
        if (!cancelled) setError(requestError.message || "Could not load vocabulary.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    const receiveSavedTerm = (event) => {
      const item = event.detail;
      if (item?.id) {
        setSaved((current) => [item, ...current.filter((entry) => entry.id !== item.id)]);
        setSelectedId(item.id);
      }
    };
    window.addEventListener("amctoshs:vocab-saved", receiveSavedTerm);
    return () => {
      cancelled = true;
      window.removeEventListener("amctoshs:vocab-saved", receiveSavedTerm);
    };
  }, []);

  useEffect(() => {
    if (!selectedId || dataTab !== "dictionary" || !tableRef.current) return;
    const row = tableRef.current.querySelector(`[data-vocab-row="${CSS.escape(selectedId)}"]`);
    row?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  }, [selectedId, dataTab, saved.length]);

  const openEdit = (item) => {
    setEditingItem(item);
    setDraft({
      word: item.word || "",
      translation: item.translation || "",
      definition: item.definitions?.[0]?.definition || "",
    });
    setError("");
    setEditorOpen(true);
  };

  const closeEditor = () => {
    if (saving) return;
    setEditorOpen(false);
    setEditingItem(null);
    setDraft(EMPTY_DRAFT);
  };

  const submitVocabulary = async (event) => {
    event.preventDefault();
    if (!editingItem || !draft.word.trim() || saving) return;
    setSaving(true);
    setError("");

    const previousDefinition = editingItem?.definitions?.[0] || {};
    const payload = {
      ...(editingItem || {}),
      word: draft.word.trim(),
      translation: draft.translation.trim(),
      definitions: draft.definition.trim()
        ? [{
          ...previousDefinition,
          definition: draft.definition.trim(),
          translation: draft.definition.trim() === String(previousDefinition.definition || "").trim()
            ? previousDefinition.translation || ""
            : "",
        }]
        : [],
      source: editingItem?.source || "manual",
      sourceLabel: editingItem?.sourceLabel || "Manual entry",
    };

    try {
      const response = await updateVocabulary(editingItem.id, payload);
      setSaved((current) => [response.saved, ...current.filter((item) => item.id !== response.saved.id)]);
      setSelectedId(response.saved.id);
      window.dispatchEvent(new CustomEvent("amctoshs:vocab-saved", { detail: response.saved }));
      setEditorOpen(false);
      setEditingItem(null);
      setDraft(EMPTY_DRAFT);
    } catch (requestError) {
      setError(requestError.message || "Could not save vocabulary.");
    } finally {
      setSaving(false);
    }
  };

  const removeVocabulary = async (item) => {
    if (!window.confirm(`Delete “${item.word}” from your vocabulary?`)) return;
    setDeletingId(item.id);
    setError("");
    try {
      await deleteSavedVocabulary(item.id);
      setSaved((current) => current.filter((entry) => entry.id !== item.id));
      setLookupIds((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
      setSelectedId((current) => current === item.id ? "" : current);
      if (editingItem?.id === item.id) closeEditor();
    } catch (requestError) {
      setError(requestError.message || "Could not delete vocabulary.");
    } finally {
      setDeletingId("");
    }
  };

  const toggleLookupEntry = (id) => {
    setLookupIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleLookup = async (directEntries = null) => {
    const isDirectLookup = Array.isArray(directEntries);
    if (lookupBusy) return;
    if (!isDirectLookup && !lookupMode) {
      setLookupMode(true);
      setLookupIds(new Set());
      return;
    }
    if (!isDirectLookup && lookupIds.size === 0) {
      setLookupMode(false);
      return;
    }

    const entriesToLookup = isDirectLookup
      ? directEntries.filter((entry) => entry?.id)
      : saved.filter((entry) => lookupIds.has(entry.id));
    if (entriesToLookup.length === 0) return;

    setLookupBusy(true);
    setError("");
    const provider = localStorage.getItem("mctosh_ai_provider") || undefined;
    const updates = [];
    const failures = [];
    const alternatives = [];
    for (const item of entriesToLookup) {
      try {
        const [dictionary, umlsResult] = await Promise.all([
          lookupDictionaryWord(item.word, { provider }),
          searchUmls(item.word, { pageSize: 10 }),
        ]);
        const umlsConcept = await fetchFirstUmlsConceptInLanguage(umlsResult.items);
        if (dictionary.dictionaryResponseType === "suggestions") {
          const response = await updateVocabulary(item.id, {
            ...item,
            ...dictionary,
            word: item.word,
            translation: item.translation || "",
            definitions: [],
            umls: null,
            umlsData: null,
            umlsResponse: null,
          });
          updates.push(response.saved);
          if (dictionary.suggestions?.length) {
            alternatives.push({ item: response.saved, originalEntry: item.dictionaryOriginalEntry || item.word, suggestions: dictionary.suggestions });
          } else failures.push(item.word);
          continue;
        }
        const firstDefinition = dictionary.definitions?.[0]?.definition || "";
        const translated = await translateVocabularyContent({
          entry: dictionary.word || item.word,
          definition: firstDefinition,
          provider,
        });
        const translatedDefinitions = (dictionary.definitions || []).map((definition, index) => index === 0
          ? { ...definition, translation: translated.definition }
          : definition);
        const response = await updateVocabulary(item.id, {
          ...item,
          ...dictionary,
          translation: translated.entry,
          definitions: translatedDefinitions,
          umls: umlsConcept,
          umlsData: umlsResult.raw || item.umlsData,
          umlsResponse: umlsResult.raw || item.umlsResponse,
        });
        updates.push(response.saved);
      } catch (lookupError) {
        failures.push(`${item.word}: ${lookupError.message || "lookup failed"}`);
      }
    }

    if (updates.length > 0) {
      const byId = new Map(updates.map((item) => [item.id, item]));
      setSaved((current) => current.map((item) => byId.get(item.id) || item));
    }
    if (alternatives.length > 0) setAlternativeQueue((current) => [...current.filter((queued) => !alternatives.some((next) => next.item.id === queued.item.id)), ...alternatives]);
    if (failures.length > 0) setError(`Lookup could not complete — ${failures.join("; ")}.`);
    setLookupBusy(false);
    setLookupMode(false);
    setLookupIds(new Set());
  };

  const chooseDictionaryAlternative = async (queued, preferredEntry) => {
    if (alternativeBusyId) return;
    setAlternativeBusyId(queued.item.id);
    setError("");
    const provider = localStorage.getItem("mctosh_ai_provider") || undefined;
    try {
      const [dictionary, umlsResult] = await Promise.all([
        lookupDictionaryWord(preferredEntry, { provider }),
        searchUmls(preferredEntry, { pageSize: 10 }),
      ]);
      if (dictionary.dictionaryResponseType !== "entries" || !dictionary.definitions?.length) {
        throw new Error(`“${preferredEntry}” did not return a confirmed dictionary entry.`);
      }
      const translated = await translateVocabularyContent({
        entry: dictionary.word || preferredEntry,
        definition: dictionary.definitions[0].definition,
        provider,
      });
      const translatedDefinitions = dictionary.definitions.map((definition, index) => index === 0
        ? { ...definition, translation: translated.definition }
        : definition);
      const umlsConcept = await fetchFirstUmlsConceptInLanguage(umlsResult.items);
      const response = await updateVocabulary(queued.item.id, {
        ...queued.item,
        ...dictionary,
        word: preferredEntry,
        dictionaryOriginalEntry: queued.originalEntry,
        translation: translated.entry,
        definitions: translatedDefinitions,
        umls: umlsConcept,
        umlsData: umlsResult.raw || null,
        umlsResponse: umlsResult.raw || null,
      });
      setSaved((current) => current.map((item) => item.id === response.saved.id ? response.saved : item));
      setSelectedId(response.saved.id);
      setAlternativeQueue((current) => current.filter((item) => item.item.id !== queued.item.id));
    } catch (requestError) {
      setError(requestError.message || `Could not save “${preferredEntry}”.`);
    } finally {
      setAlternativeBusyId("");
    }
  };

  const addEntry = async (event) => {
    event.preventDefault();
    const word = newEntryWord.trim();
    if (!word || addingEntry) return;
    setAddingEntry(true);
    setError("");
    try {
      const response = await saveVocabulary({
        word,
        translation: "",
        definitions: [],
        source: "manual",
        sourceLabel: "Manual entry",
      });
      const item = response.saved;
      setSaved((current) => [item, ...current.filter((entry) => entry.id !== item.id)]);
      setSelectedId(item.id);
      setNewEntryWord("");
      setNewEntryOpen(false);
      window.dispatchEvent(new CustomEvent("amctoshs:vocab-saved", { detail: item }));
    } catch (requestError) {
      setError(requestError.message || "Could not add vocabulary entry.");
    } finally {
      setAddingEntry(false);
    }
  };

  return (
    <main id="vocabs_page">
      <header className="vocabs_page_header">
        <div className="vocabs_header_row">
          <button type="button" className="vocabs_back" onClick={() => navigate("/home")} aria-label="Go to Home" title="Home"><i className="fi fi-rr-home" aria-hidden="true" /></button>
          <div className="vocabs_header_identity">
            <h1><i className="fi fi-rr-book-alt" aria-hidden="true" /> AMCTOSHS Vocabs</h1>
            <p>Look up the meaning and usage of terms while building and studying the patient object.</p>
          </div>
          <div className="vocabs_lookup_toolbar">
            <div className="vocabs_data_tabs" role="tablist" aria-label="Vocabulary data view">
              <button type="button" role="tab" aria-selected={dataTab === "all"} className={dataTab === "all" ? "is-active" : ""} onClick={() => setDataTab("all")}>
                <i className="fi fi-rr-apps" /> All
              </button>
              <button type="button" role="tab" aria-selected={dataTab === "dictionary"} className={dataTab === "dictionary" ? "is-active" : ""} onClick={() => setDataTab("dictionary")}>
                <i className="fi fi-rr-book-alt" /> Dictionary
              </button>
              <button type="button" role="tab" aria-selected={dataTab === "umls"} className={dataTab === "umls" ? "is-active" : ""} onClick={() => setDataTab("umls")}>
                <i className="fi fi-rr-database" /> UMLS
              </button>
            </div>
            <div className="vocabs_lookup_actions">
            <label className="vocabs_entry_search">
              <i className="fi fi-rr-search" aria-hidden="true" />
              <input
                type="search"
                value={completedSearch}
                onChange={(event) => setCompletedSearch(event.target.value)}
                onFocus={() => queueMicrotask(() => window.dispatchEvent(new CustomEvent("virtual-keyboard:open")))}
                placeholder="Search original or translated entry"
                aria-label="Search all vocabulary by original or translated entry"
              />
              {completedSearch && <button type="button" onClick={() => setCompletedSearch("")} aria-label="Clear vocabulary search" title="Clear search"><i className="fi fi-rr-cross-small" /></button>}
            </label>
            </div>
          </div>
        </div>
      </header>

      <section className="vocabs_page_card" aria-label="AMCTOSHS vocabulary lookup">
        {alternativeQueue.length > 0 && (
          <section className="vocabs_alternative_queue" aria-labelledby="vocabs-alternative-heading">
            <div className="vocabs_alternative_queue_heading">
              <div><span>Dictionary alternatives</span><h2 id="vocabs-alternative-heading">Choose the preferred entry</h2></div>
              <small>The original spelling will remain in brackets beside your choice.</small>
            </div>
            {alternativeQueue.map((queued) => (
              <div className="vocabs_alternative_choice" key={queued.item.id}>
                <strong>{queued.originalEntry}</strong>
                <div role="group" aria-label={`Alternatives for ${queued.originalEntry}`}>
                  {queued.suggestions.map((suggestion) => (
                    <button type="button" key={suggestion} disabled={Boolean(alternativeBusyId)} onClick={() => void chooseDictionaryAlternative(queued, suggestion)}>
                      {alternativeBusyId === queued.item.id ? <i className="fi fi-rr-spinner" /> : <i className="fi fi-rr-arrow-right" />}
                      {suggestion}
                    </button>
                  ))}
                </div>
                <button type="button" className="vocabs_alternative_skip" disabled={Boolean(alternativeBusyId)} onClick={() => setAlternativeQueue((current) => current.filter((item) => item.item.id !== queued.item.id))} aria-label={`Dismiss alternatives for ${queued.originalEntry}`} title="Dismiss"><i className="fi fi-rr-cross-small" /></button>
              </div>
            ))}
          </section>
        )}
        <div className="vocabs_table_row">
          <aside className="vocabs_queue_aside" aria-labelledby="vocabs-entries-heading">
            <div className="vocabs_status_table_heading">
              <h2 id="vocabs-entries-heading">Entries</h2>
              <span>{loading ? "—" : filteredSavedItems.length + (newEntryOpen ? 1 : 0)}</span>
              <button
                type="button"
                className={`vocabs_queue_lookup${lookupMode ? " is-active" : ""}${lookupBusy ? " is-busy" : ""}`}
                onClick={() => void handleLookup()}
                disabled={lookupBusy || saved.length === 0}
                aria-label={lookupBusy ? "Looking up vocabulary" : lookupMode && lookupIds.size > 0 ? `Look up ${lookupIds.size} selected entries` : lookupMode ? "Cancel vocabulary lookup" : "Select vocabulary entries to look up"}
                title={lookupBusy ? "Looking up…" : lookupMode && lookupIds.size > 0 ? `Lookup selected (${lookupIds.size})` : lookupMode ? "Cancel lookup" : "Lookup"}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M22 11.96c-.02-.39-.26-.74-.63-.89L17.44 9.5l3.43-6a1 1 0 0 0-.16-1.2 1 1 0 0 0-1.2-.16l-6.34 3.62L9.71 2.3c-.29-.29-.72-.37-1.09-.22S8 2.6 8 3v3.82l-4.84-.81a.99.99 0 0 0-1.05.53c-.2.39-.13.86.18 1.17l4.4 4.4-4.51 6.31a.99.99 0 0 0 .04 1.21c.28.35.76.47 1.17.29l5.87-2.51.76 3.79c.08.41.4.72.81.79.06 0 .11.01.17.01.35 0 .67-.18.86-.49l2.5-4.16 6.15 3.51a1.005 1.005 0 0 0 1.33-1.43l-3.37-5.06 2.99-1.49a1 1 0 0 0 .55-.94Zm-5.45 1.15c-.26.13-.45.36-.52.64s-.02.57.13.81l1.65 2.48-3.32-1.9a1 1 0 0 0-1.35.35l-1.67 2.78-.49-2.46c-.06-.29-.25-.55-.52-.69a1 1 0 0 0-.86-.04l-3.71 1.59 2.92-4.09c.28-.4.24-.94-.11-1.29L5.91 8.5l2.92.49c.29.05.59-.03.81-.22s.35-.47.35-.76V5.42l2.29 2.29c.32.32.81.39 1.2.16l3.82-2.18-2.18 3.82c-.14.25-.17.55-.08.83s.3.49.57.6l2.93 1.17-2.01 1Z" />
                </svg>
              </button>
              <button type="button" className="vocabs_queue_add" onClick={() => setNewEntryOpen(true)} aria-expanded={newEntryOpen} aria-label="Add new queued vocabulary entry" title="Add new vocabulary entry"><i className="fi fi-rr-plus" /></button>
            </div>
            <QueuedVocabularyTable items={loading ? [] : filteredSavedItems} entryIndexById={entryIndexById} selectedId={selectedId} onSelect={setSelectedId} onEdit={openEdit} onDelete={removeVocabulary} onLookup={(item) => void handleLookup([item])} deletingId={deletingId} lookupBusy={lookupBusy} lookupMode={lookupMode} lookupIds={lookupIds} onToggleLookup={toggleLookupEntry} newEntryOpen={newEntryOpen} newEntryWord={newEntryWord} onNewEntryChange={setNewEntryWord} onNewEntrySubmit={addEntry} onNewEntryCancel={() => { setNewEntryOpen(false); setNewEntryWord(""); }} addingEntry={addingEntry} loading={loading} />
          </aside>
          <section ref={tableRef} className="vocabs_comparison_column" aria-label="Vocabulary terminology table">
          {editorOpen && (
            <form className="vocabs_editor" onSubmit={submitVocabulary}>
              <div className="vocabs_editor_heading">
                <div><span>Edit vocabulary</span><strong>{editingItem.word}</strong></div>
                <button type="button" onClick={closeEditor} disabled={saving} aria-label="Close vocabulary editor" title="Close"><i className="fi fi-rr-cross-small" /></button>
              </div>
              <div className="vocabs_editor_fields">
                <label><span>Term</span><input required value={draft.word} onChange={(event) => setDraft((current) => ({ ...current, word: event.target.value }))} placeholder="Term" /></label>
                <label><span>Translation</span><input value={draft.translation} onChange={(event) => setDraft((current) => ({ ...current, translation: event.target.value }))} placeholder="Translation" /></label>
                <label className="vocabs_editor_definition"><span>Dictionary</span><textarea rows="3" value={draft.definition} onChange={(event) => setDraft((current) => ({ ...current, definition: event.target.value }))} placeholder="English definition" /></label>
              </div>
              <div className="vocabs_editor_actions">
                <button type="button" onClick={closeEditor} disabled={saving} aria-label="Cancel" title="Cancel"><i className="fi fi-rr-cross-small" /></button>
                <button className="is-primary" type="submit" disabled={saving || !draft.word.trim()} aria-label="Save changes" title="Save changes"><i className={`fi ${saving ? "fi-rr-spinner" : "fi-rr-check"}`} /></button>
              </div>
            </form>
          )}

          {error && <p className="vocabs_page_error" role="alert"><i className="fi fi-rr-exclamation" /> {error}</p>}

          {dataTab === "umls" ? (
            <UmlsConceptTable items={loading ? [] : renderedTableItems} entryIndexById={entryIndexById} />
          ) : (
            <div className="vocabs_status_tables">
              <section className="vocabs_status_table_section" aria-labelledby="vocabs-dictionary-heading">
                <div className="vocabs_status_table_heading">
                  <h2 id="vocabs-dictionary-heading">Dictionary</h2>
                  <span>{loading ? "—" : renderedTableItems.length}</span>
                </div>
                <VocabComparisonTable items={loading ? [] : renderedTableItems} entryIndexById={entryIndexById} selectedId={selectedId} onSelect={setSelectedId} onEdit={openEdit} onDelete={removeVocabulary} busyId={deletingId} lookupMode={lookupMode} lookupIds={lookupIds} onToggleLookup={toggleLookupEntry} dataTab="dictionary" loading={loading} emptyMessage={completedSearch ? "No vocabulary entry matches this search." : "No vocabulary entries."} />
              </section>
              {dataTab === "all" && (
                <section className="vocabs_status_table_section" aria-labelledby="vocabs-umls-heading">
                  <div className="vocabs_status_table_heading">
                    <h2 id="vocabs-umls-heading">UMLS</h2>
                    <span>{loading ? "—" : renderedTableItems.filter((item) => firstValue(getUmls(item)?.cui, getUmls(item)?.ui, getUmls(item)?.CUI)).length}</span>
                  </div>
                  <UmlsConceptTable items={loading ? [] : renderedTableItems} entryIndexById={entryIndexById} />
                </section>
              )}
            </div>
          )}
          </section>
        </div>
      </section>
    </main>
  );
};

export default VocabsPage;
