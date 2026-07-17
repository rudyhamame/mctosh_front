import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiUrl } from "../config/api";
import { readStoredSession } from "../utils/sessionCleanup";
import "./draftListPage.css";

const authHeader = () => {
  const token = readStoredSession()?.token || "";
  return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
};

const formatDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined });
};

const DraftListPage = () => {
  const navigate = useNavigate();
  const [drafts, setDrafts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [deletingId, setDeletingId] = useState(null);

  const loadDrafts = useCallback(() => {
    setLoading(true);
    fetch(apiUrl("/api/draft"), { headers: authHeader() })
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data.error || "Failed to load your documents.");
        setDrafts(data.drafts || []);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadDrafts(); }, [loadDrafts]);

  const createDraft = useCallback(async () => {
    setCreating(true);
    setError("");
    try {
      const res = await fetch(apiUrl("/api/draft"), { method: "POST", headers: authHeader(), body: JSON.stringify({}) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create a new document.");
      navigate(`/draft/${data.id}`);
    } catch (err) {
      setError(err.message);
      setCreating(false);
    }
  }, [navigate]);

  const startRename = useCallback((e, draft) => {
    e.stopPropagation();
    setRenamingId(draft.id);
    setRenameValue(draft.title);
  }, []);

  const commitRename = useCallback(async (id) => {
    const title = renameValue.trim() || "Untitled Document";
    setRenamingId(null);
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, title } : d)));
    try {
      await fetch(apiUrl(`/api/draft/${id}`), { method: "PATCH", headers: authHeader(), body: JSON.stringify({ title }) });
    } catch { /* best-effort — list will self-correct on next reload */ }
  }, [renameValue]);

  const deleteDraft = useCallback(async (e, id) => {
    e.stopPropagation();
    if (!window.confirm("Delete this document? This can't be undone.")) return;
    setError("");
    setDeletingId(id);
    try {
      const res = await fetch(apiUrl(`/api/draft/${id}`), { method: "DELETE", headers: authHeader() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to delete that document.");
      setDrafts((prev) => prev.filter((d) => String(d.id) !== String(id)));
    } catch (err) {
      setError(err.message);
    } finally {
      setDeletingId(null);
    }
  }, []);

  return (
    <div id="draft_list_page">
      <div id="draft_list_header">
        <button id="draft_list_back_btn" onClick={() => navigate("/home")} title="Back to Home">←</button>
        <span id="draft_list_title">MCTOSHS Draft</span>
        <button id="draft_list_new_btn" onClick={createDraft} disabled={creating}>
          <i className="fi fi-rr-add" /> New Document
        </button>
      </div>

      {error && <p id="draft_list_error">⚠ {error}</p>}

      {loading ? (
        <p id="draft_list_status_msg">Loading your documents…</p>
      ) : drafts.length === 0 ? (
        <div id="draft_list_empty">
          <i className="fi fi-rr-notebook" />
          <p>No documents yet — start your first one.</p>
          <button onClick={createDraft} disabled={creating}><i className="fi fi-rr-add" /> New Document</button>
        </div>
      ) : (
        <div id="draft_list_grid">
          {drafts.map((d) => (
            <div key={d.id} className="draft_list_card" onClick={() => renamingId !== d.id && navigate(`/draft/${d.id}`)}>
              <div className="draft_list_card_top">
                {renamingId === d.id ? (
                  <input
                    className="draft_list_rename_input"
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={() => commitRename(d.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); commitRename(d.id); }
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                  />
                ) : (
                  <span className="draft_list_card_title">{d.title}</span>
                )}
                <div className="draft_list_card_actions">
                  <button title="Rename" onClick={(e) => startRename(e, d)}><i className="fi fi-rr-pencil" /></button>
                  <button title="Delete" disabled={deletingId === d.id} onClick={(e) => deleteDraft(e, d.id)}><i className="fi fi-rr-trash" /></button>
                </div>
              </div>
              <p className="draft_list_card_preview">{d.preview || "Empty document"}</p>
              <span className="draft_list_card_date">{formatDate(d.updatedAt)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default DraftListPage;
