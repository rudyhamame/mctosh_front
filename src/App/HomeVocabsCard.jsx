import { useEffect, useState } from "react";
import {
  deleteSavedVocabulary,
  listSavedVocabulary,
  updateVocabulary,
} from "../utils/vocabApi";

const EMPTY_DRAFT = Object.freeze({ word: "", translation: "", definition: "" });

export default function HomeVocabsCard({ onOpen }) {
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [editingItem, setEditingItem] = useState(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    listSavedVocabulary()
      .then((data) => {
        if (!cancelled) setSaved(Array.isArray(data.saved) ? data.saved : []);
      })
      .catch((requestError) => {
        if (!cancelled) {
          setSaved([]);
          setError(requestError.message);
        }
      });

    const receiveSavedTerm = (event) => {
      const item = event.detail;
      if (item?.id) setSaved((current) => [item, ...(current || []).filter((entry) => entry.id !== item.id)]);
    };
    window.addEventListener("amctoshs:vocab-saved", receiveSavedTerm);
    return () => {
      cancelled = true;
      window.removeEventListener("amctoshs:vocab-saved", receiveSavedTerm);
    };
  }, []);

  const openEdit = (item) => {
    setDraft({
      word: item.word || "",
      translation: item.translation || "",
      definition: item.definitions?.[0]?.definition || "",
    });
    setEditingItem(item);
    setError("");
    setEditorOpen(true);
  };

  const closeEditor = () => {
    if (saving) return;
    setEditorOpen(false);
    setEditingItem(null);
    setDraft(EMPTY_DRAFT);
    setError("");
  };

  const saveItem = async (event) => {
    event.preventDefault();
    if (!editingItem || !draft.word.trim()) return;
    setSaving(true);
    setError("");
    const previousDefinition = editingItem?.definitions?.[0] || {};
    const payload = {
      ...(editingItem || {}),
      word: draft.word,
      translation: draft.translation,
      definitions: draft.definition.trim()
        ? [{ ...previousDefinition, definition: draft.definition.trim() }]
        : [],
      source: editingItem?.source || "manual",
      sourceLabel: editingItem?.sourceLabel || "Manual entry",
    };
    try {
      const response = await updateVocabulary(editingItem.id, payload);
      setSaved((current) => [response.saved, ...(current || []).filter((item) => item.id !== response.saved.id)]);
      setEditorOpen(false);
      setEditingItem(null);
      setDraft(EMPTY_DRAFT);
      window.dispatchEvent(new CustomEvent("amctoshs:vocab-saved", { detail: response.saved }));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  };

  const removeItem = async (item) => {
    if (!window.confirm("Delete this vocabulary term?\n\n" + item.word)) return;
    setBusyId(item.id);
    setError("");
    try {
      await deleteSavedVocabulary(item.id);
      setSaved((current) => (current || []).filter((entry) => entry.id !== item.id));
      if (editingItem?.id === item.id) closeEditor();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusyId("");
    }
  };

  return (
    <article className="app_dashboard_card app_vocabs_card">
      <div className="app_card_heading">
        <div><span className="app_card_kicker">05 / RabbitHole MORPHEMES</span><h2>Morphemes</h2></div>
        <div className="app_card_icon_actions">
          <button className="app_icon_action" type="button" onClick={onOpen} aria-label="Open RabbitHole Morphemes" title="Open RabbitHole Morphemes"><i className="fi fi-rr-arrow-up-right" /></button>
        </div>
      </div>
      <p className="app_card_description">Your saved medical terms, translations, and dictionary definitions.</p>

      {editorOpen && (
        <form className="app_vocab_form" onSubmit={saveItem}>
          <label><span>Term</span><input value={draft.word} onChange={(event) => setDraft((current) => ({ ...current, word: event.target.value }))} placeholder="Vocabulary term" required /></label>
          <label><span>Translation</span><input value={draft.translation} onChange={(event) => setDraft((current) => ({ ...current, translation: event.target.value }))} placeholder="Translation" /></label>
          <label><span>Dictionary</span><textarea value={draft.definition} onChange={(event) => setDraft((current) => ({ ...current, definition: event.target.value }))} placeholder="English definition" rows={2} /></label>
          <div className="app_vocab_form_actions">
            <button type="button" onClick={closeEditor} aria-label="Cancel" title="Cancel" disabled={saving}><i className="fi fi-rr-cross-small" /></button>
            <button className="is-primary" type="submit" aria-label="Save vocabulary" title="Save vocabulary" disabled={saving || !draft.word.trim()}><i className={"fi " + (saving ? "fi-rr-spinner" : "fi-rr-check")} /></button>
          </div>
        </form>
      )}

      {error && <p className="app_spoken_trace_error" role="alert">{error}</p>}

      <div className="app_vocab_table_wrap">
        <table className="app_vocab_table">
          <thead><tr><th>Term</th><th>Translation</th><th>Dictionary</th><th aria-label="Actions" /></tr></thead>
          <tbody>
            {saved?.map((item) => (
              <tr key={item.id}>
                <td>{item.word}</td>
                <td>{item.translation || "—"}</td>
                <td title={item.definitions?.[0]?.definition || ""}>{item.definitions?.[0]?.definition || "—"}</td>
                <td>
                  <span className="app_trace_row_actions">
                    <button type="button" onClick={() => openEdit(item)} aria-label={"Edit " + item.word} title="Edit vocabulary" disabled={busyId === item.id}><i className="fi fi-rr-pencil" /></button>
                    <button className="is-delete" type="button" onClick={() => removeItem(item)} aria-label={"Delete " + item.word} title="Delete vocabulary" disabled={busyId === item.id}><i className="fi fi-rr-trash" /></button>
                  </span>
                </td>
              </tr>
            ))}
            {saved?.length === 0 && <tr><td className="app_spoken_trace_empty" colSpan={4}>No saved vocabulary yet.</td></tr>}
            {saved === null && <tr><td className="app_spoken_trace_empty" colSpan={4}>Loading vocabulary…</td></tr>}
          </tbody>
        </table>
      </div>
    </article>
  );
}
