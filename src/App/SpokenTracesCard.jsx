import { useEffect, useState } from "react";
import {
  createSpokenTrace,
  deleteSpokenTrace,
  listSpokenTraces,
  updateSpokenTrace,
} from "../utils/spokenTraces";

const EMPTY_DRAFT = Object.freeze({ spokenTrace: "", illuminationMode: "Humans" });
const classificationFor = (mode) => (mode === "Humans" ? "Direct Trace" : "Indirect Trace");

export default function SpokenTracesCard() {
  const [traces, setTraces] = useState(null);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    listSpokenTraces(controller.signal)
      .then((data) => setTraces(Array.isArray(data.traces) ? data.traces : []))
      .catch((requestError) => {
        if (requestError.name !== "AbortError") {
          setTraces([]);
          setError(requestError.message);
        }
      });
    return () => controller.abort();
  }, []);

  const openAdd = () => {
    setDraft(EMPTY_DRAFT);
    setEditingId("");
    setError("");
    setEditorOpen(true);
  };

  const openEdit = (trace) => {
    setDraft({ spokenTrace: trace.spokenTrace, illuminationMode: trace.illuminationMode });
    setEditingId(trace.id);
    setError("");
    setEditorOpen(true);
  };

  const closeEditor = () => {
    if (saving) return;
    setEditorOpen(false);
    setEditingId("");
    setDraft(EMPTY_DRAFT);
    setError("");
  };

  const saveTrace = async (event) => {
    event.preventDefault();
    if (!draft.spokenTrace.trim()) return;
    setSaving(true);
    setError("");
    try {
      const response = editingId
        ? await updateSpokenTrace(editingId, draft)
        : await createSpokenTrace(draft);
      setTraces((current) => (
        editingId
          ? (current || []).map((trace) => (trace.id === editingId ? response.trace : trace))
          : [response.trace, ...(current || [])]
      ));
      setEditorOpen(false);
      setEditingId("");
      setDraft(EMPTY_DRAFT);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  };

  const removeTrace = async (trace) => {
    if (!window.confirm("Delete this spoken trace?\n\n" + trace.spokenTrace)) return;
    setBusyId(trace.id);
    setError("");
    try {
      await deleteSpokenTrace(trace.id);
      setTraces((current) => (current || []).filter((item) => item.id !== trace.id));
      if (editingId === trace.id) closeEditor();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusyId("");
    }
  };

  return (
    <article className="app_dashboard_card app_spoken_traces_card">
      <div className="app_card_heading">
        <div>
          <span className="app_card_kicker">03 / AMCTOSHS MORPHE: 3D TRACES</span>
          <h2>Spoken Traces</h2>
        </div>
        <button className="app_icon_action app_icon_action_add" type="button" onClick={openAdd} aria-label="Add spoken trace" title="Add spoken trace">
          <i className="fi fi-rr-plus" />
        </button>
      </div>

      <p className="app_card_description">
        Spoken 3D traces illuminate the Humans mode as Direct Traces and the Societies mode as Indirect Traces.
      </p>

      {editorOpen && (
        <form className="app_spoken_trace_form" onSubmit={saveTrace}>
          <label>
            <span>Spoken trace</span>
            <textarea
              value={draft.spokenTrace}
              onChange={(event) => setDraft((current) => ({ ...current, spokenTrace: event.target.value }))}
              placeholder="Enter the spoken trace"
              maxLength={1200}
              rows={2}
              required
            />
          </label>
          <label>
            <span>Illuminates</span>
            <select value={draft.illuminationMode} onChange={(event) => setDraft((current) => ({ ...current, illuminationMode: event.target.value }))}>
              <option value="Humans">Humans</option>
              <option value="Societies">Societies</option>
            </select>
          </label>
          <div className="app_spoken_trace_classification">
            <small>Classification</small>
            <strong>{classificationFor(draft.illuminationMode)}</strong>
            <span>3D Trace</span>
          </div>
          <div className="app_spoken_trace_form_actions">
            <button type="button" onClick={closeEditor} aria-label="Cancel" title="Cancel" disabled={saving}>
              <i className="fi fi-rr-cross-small" />
            </button>
            <button className="is-primary" type="submit" aria-label={editingId ? "Save spoken trace" : "Add spoken trace"} title={editingId ? "Save spoken trace" : "Add spoken trace"} disabled={saving || !draft.spokenTrace.trim()}>
              <i className={"fi " + (saving ? "fi-rr-spinner" : editingId ? "fi-rr-check" : "fi-rr-plus")} />
            </button>
          </div>
        </form>
      )}

      {error && <p className="app_spoken_trace_error" role="alert">{error}</p>}

      <div className="app_spoken_trace_table_wrap">
        <table className="app_spoken_trace_table">
          <thead>
            <tr><th>Spoken trace</th><th>Illuminates</th><th>Type</th><th aria-label="Actions" /></tr>
          </thead>
          <tbody>
            {traces?.map((trace) => (
              <tr key={trace.id}>
                <td>{trace.spokenTrace}</td>
                <td><span className="app_trace_mode">{trace.illuminationMode}</span></td>
                <td><span className={"app_trace_type " + (trace.traceType === "Direct Trace" ? "is-direct" : "is-indirect")}>{trace.traceType}</span></td>
                <td>
                  <span className="app_trace_row_actions">
                    <button type="button" onClick={() => openEdit(trace)} aria-label={"Edit " + trace.spokenTrace} title="Edit spoken trace" disabled={busyId === trace.id}><i className="fi fi-rr-pencil" /></button>
                    <button className="is-delete" type="button" onClick={() => removeTrace(trace)} aria-label={"Delete " + trace.spokenTrace} title="Delete spoken trace" disabled={busyId === trace.id}><i className="fi fi-rr-trash" /></button>
                  </span>
                </td>
              </tr>
            ))}
            {traces?.length === 0 && <tr><td className="app_spoken_trace_empty" colSpan={4}>No spoken traces recorded yet.</td></tr>}
            {traces === null && <tr><td className="app_spoken_trace_empty" colSpan={4}>Loading spoken traces…</td></tr>}
          </tbody>
        </table>
      </div>
    </article>
  );
}
