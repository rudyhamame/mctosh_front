import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiUrl } from "../config/api";
import { readStoredSession } from "../utils/sessionCleanup";
import "./freeformListPage.css";

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

const FreeformListPage = () => {
  const navigate = useNavigate();
  const [boards, setBoards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [deletingId, setDeletingId] = useState(null);

  const loadBoards = useCallback(() => {
    setLoading(true);
    fetch(apiUrl("/api/freeform"), { headers: authHeader() })
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data.error || "Failed to load your boards.");
        setBoards(data.boards || []);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadBoards(); }, [loadBoards]);

  const createBoard = useCallback(async () => {
    setCreating(true);
    setError("");
    try {
      const res = await fetch(apiUrl("/api/freeform"), { method: "POST", headers: authHeader(), body: JSON.stringify({}) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create a new board.");
      navigate(`/freeform/${data.id}`);
    } catch (err) {
      setError(err.message);
      setCreating(false);
    }
  }, [navigate]);

  const startRename = useCallback((e, board) => {
    e.stopPropagation();
    setRenamingId(board.id);
    setRenameValue(board.title);
  }, []);

  const commitRename = useCallback(async (id) => {
    const title = renameValue.trim() || "Untitled Board";
    setRenamingId(null);
    setBoards((prev) => prev.map((b) => (b.id === id ? { ...b, title } : b)));
    try {
      await fetch(apiUrl(`/api/freeform/${id}`), { method: "PATCH", headers: authHeader(), body: JSON.stringify({ title }) });
    } catch { /* best-effort — list will self-correct on next reload */ }
  }, [renameValue]);

  const deleteBoard = useCallback(async (e, id) => {
    e.stopPropagation();
    if (!window.confirm("Delete this board? This can't be undone.")) return;
    setError("");
    setDeletingId(id);
    try {
      const res = await fetch(apiUrl(`/api/freeform/${id}`), { method: "DELETE", headers: authHeader() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to delete that board.");
      setBoards((prev) => prev.filter((b) => String(b.id) !== String(id)));
    } catch (err) {
      setError(err.message);
    } finally {
      setDeletingId(null);
    }
  }, []);

  return (
    <div id="ffl_list_page">
      <div id="ffl_list_header">
        <button id="ffl_list_back_btn" onClick={() => navigate("/home")} title="Back to Home">←</button>
        <span id="ffl_list_title">Freeform</span>
        <button id="ffl_list_new_btn" onClick={createBoard} disabled={creating}>
          <i className="fi fi-rr-add" /> New Board
        </button>
      </div>

      {error && <p id="ffl_list_error">⚠ {error}</p>}

      {loading ? (
        <p id="ffl_list_status_msg">Loading your boards…</p>
      ) : boards.length === 0 ? (
        <div id="ffl_list_empty">
          <i className="fi fi-rr-note-sticky" />
          <p>No boards yet — start your first one.</p>
          <button onClick={createBoard} disabled={creating}><i className="fi fi-rr-add" /> New Board</button>
        </div>
      ) : (
        <div id="ffl_list_grid">
          {boards.map((b) => (
            <div key={b.id} className="ffl_list_card" onClick={() => renamingId !== b.id && navigate(`/freeform/${b.id}`)}>
              <div className="ffl_list_card_top">
                {renamingId === b.id ? (
                  <input
                    className="ffl_list_rename_input"
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={() => commitRename(b.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); commitRename(b.id); }
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                  />
                ) : (
                  <span className="ffl_list_card_title">{b.title}</span>
                )}
                <div className="ffl_list_card_actions">
                  <button title="Rename" onClick={(e) => startRename(e, b)}><i className="fi fi-rr-pencil" /></button>
                  <button title="Delete" disabled={deletingId === b.id} onClick={(e) => deleteBoard(e, b.id)}><i className="fi fi-rr-trash" /></button>
                </div>
              </div>
              <p className="ffl_list_card_preview">{b.preview || "Empty board"}</p>
              <span className="ffl_list_card_date">{formatDate(b.updatedAt)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default FreeformListPage;
