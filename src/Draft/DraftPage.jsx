import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiUrl } from "../config/api";
import { readStoredSession } from "../utils/sessionCleanup";
import "./draftPage.css";

const authHeader = () => {
  const token = readStoredSession()?.token || "";
  return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
};

const AUTOSAVE_DELAY_MS = 1200;

const DraftPage = () => {
  const navigate = useNavigate();
  const [content, setContent]   = useState("");
  const [loading, setLoading]   = useState(true);
  const [loadError, setLoadError] = useState("");
  const [status, setStatus]     = useState(""); // "" | "saving" | "saved" | "error"
  const [scale, setScale]       = useState(1);

  const contentRef      = useRef("");   // latest content, kept in sync for the unmount-flush effect below (avoids a stale closure)
  const savedContentRef = useRef("");   // last content confirmed saved on the server
  const saveTimerRef    = useRef(null);
  const savingRef       = useRef(false);

  useEffect(() => {
    let cancelled = false;
    fetch(apiUrl("/api/draft"), { headers: authHeader() })
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (!ok) throw new Error(data.error || "Failed to load your draft.");
        setContent(data.content || "");
        contentRef.current = data.content || "";
        savedContentRef.current = data.content || "";
      })
      .catch((err) => { if (!cancelled) setLoadError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const saveNow = useCallback(async (text) => {
    if (text === savedContentRef.current || savingRef.current) return;
    savingRef.current = true;
    setStatus("saving");
    try {
      const res = await fetch(apiUrl("/api/draft"), {
        method: "PATCH",
        headers: authHeader(),
        body: JSON.stringify({ content: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed.");
      savedContentRef.current = text;
      setStatus("saved");
      setTimeout(() => setStatus((s) => (s === "saved" ? "" : s)), 1800);
    } catch {
      setStatus("error");
    } finally {
      savingRef.current = false;
    }
  }, []);

  const handleChange = useCallback((e) => {
    const next = e.target.value;
    setContent(next);
    contentRef.current = next;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => saveNow(next), AUTOSAVE_DELAY_MS);
  }, [saveNow]);

  // Flush a pending edit immediately when leaving the page, so a quick
  // in-and-out never silently loses the last debounce window. Deliberately
  // an empty dep array — this must run its cleanup ONLY on true unmount, not
  // on every content change (a cleanup keyed on `content` would fire on
  // every keystroke instead, comparing a stale closure value and racing the
  // debounced save with spurious ones).
  useEffect(() => () => {
    clearTimeout(saveTimerRef.current);
    if (contentRef.current !== savedContentRef.current) saveNow(contentRef.current);
  }, [saveNow]);

  const wordCount = (content.match(/\S+/g) || []).length;

  return (
    <div id="draft_page">
      <div id="draft_header">
        <button id="draft_back_btn" onClick={() => navigate("/home")} title="Back to Home">←</button>
        <span id="draft_title">MCTOSHS Draft</span>
        <span id="draft_status">
          {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : status === "error" ? "⚠ Couldn't save — retrying next edit" : ""}
        </span>
        <span id="draft_word_count">{wordCount} word{wordCount === 1 ? "" : "s"}</span>
        <div id="draft_font_controls">
          <button type="button" onClick={() => setScale((s) => Math.max(0.7, +(s - 0.1).toFixed(1)))} title="Smaller text" disabled={scale <= 0.7}>A−</button>
          <span id="draft_font_label">{Math.round(scale * 100)}%</span>
          <button type="button" onClick={() => setScale((s) => Math.min(2, +(s + 0.1).toFixed(1)))} title="Larger text" disabled={scale >= 2}>A+</button>
        </div>
      </div>

      {loading ? (
        <p id="draft_status_msg">Loading your draft…</p>
      ) : loadError ? (
        <p id="draft_status_msg" className="draft_status_msg--error">⚠ {loadError}</p>
      ) : (
        <textarea
          id="draft_editor"
          value={content}
          onChange={handleChange}
          placeholder="Write down whatever you find — this autosaves as you go."
          spellCheck={true}
          style={{ fontSize: `${scale}rem` }}
          autoFocus
        />
      )}
    </div>
  );
};

export default DraftPage;
