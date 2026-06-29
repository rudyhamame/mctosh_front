import React, { useCallback, useEffect, useRef, useState } from "react";
import { useHistory, useLocation } from "react-router-dom";
import { apiUrl } from "../config/api";
import { readStoredSession } from "../utils/sessionCleanup";
import "./youtubePage.css";

const POLL_MS  = 2500;
const SYNC_HZ  = 100; // ms between getCurrentTime polls

const authHeader = () => {
  const token = readStoredSession()?.token || "";
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const extractVideoId = (url = "") => {
  try {
    const u = new URL(url);
    let vid = u.searchParams.get("v");
    if (!vid) {
      const m = url.match(/(?:youtu\.be\/|\/embed\/|\/shorts\/)([A-Za-z0-9_-]{11})/);
      vid = m?.[1] ?? null;
    }
    return vid;
  } catch { return null; }
};

// Load YouTube IFrame API once globally
let ytApiReady = false;
let ytApiCallbacks = [];
const loadYTApi = (cb) => {
  if (ytApiReady) { cb(); return; }
  ytApiCallbacks.push(cb);
  if (document.getElementById("yt_iframe_api")) return;
  window.onYouTubeIframeAPIReady = () => {
    ytApiReady = true;
    ytApiCallbacks.forEach(f => f());
    ytApiCallbacks = [];
  };
  const s = document.createElement("script");
  s.id  = "yt_iframe_api";
  s.src = "https://www.youtube.com/iframe_api";
  document.head.appendChild(s);
};

const YouTubePage = () => {
  const history  = useHistory();
  const location = useLocation();
  const { sourceId, sourceName, sourceUrl } = location.state || {};

  // ── Core state ─────────────────────────────────────────────────────────────
  const [ytUrl,      setYtUrl]      = useState(sourceUrl || "");
  const [lang,       setLang]       = useState("");
  const [mode,       setMode]       = useState("auto");
  const [transcript, setTranscript] = useState("");
  const [status,     setStatus]     = useState("idle");
  const [jobId,      setJobId]      = useState("");
  const [error,      setError]      = useState("");
  const [saved,      setSaved]      = useState(true);
  const [saving,     setSaving]     = useState(false);
  const [wordCount,  setWordCount]  = useState(0);

  // ── Live sync state ─────────────────────────────────────────────────────────
  const [syncMode,    setSyncMode]    = useState(false);
  const [syncPlaying, setSyncPlaying] = useState(false);
  const [syncTime,    setSyncTime]    = useState(0);
  const [segments,    setSegments]    = useState([]); // [{ text, start, duration }]
  const [segStatus,   setSegStatus]   = useState("idle"); // idle | loading | queued | done | error
  const [segJobId,    setSegJobId]    = useState("");
  const playerRef    = useRef(null);
  const playerDivRef = useRef(null);
  const syncIntervalRef = useRef(null);

  const editorRef   = useRef(null);

  const saveTimerRef = useRef(null);
  const isBusy = status === "submitting" || status === "queued";

  const videoId = extractVideoId(ytUrl);

  // ── Load IFrame API + build player ─────────────────────────────────────────
  useEffect(() => {
    if (!videoId) return;
    loadYTApi(() => {
      if (!playerDivRef.current) return;
      if (playerRef.current) {
        try { playerRef.current.loadVideoById(videoId); } catch {}
        return;
      }
      playerRef.current = new window.YT.Player(playerDivRef.current, {
        videoId,
        playerVars: { rel: 0, modestbranding: 1 },
        events: {
          onStateChange: (e) => {
            const playing = e.data === window.YT.PlayerState.PLAYING;
            setSyncPlaying(playing);
          },
        },
      });
    });
  }, [videoId]);

  // ── Poll getCurrentTime when sync is on + playing ──────────────────────────
  useEffect(() => {
    if (!syncMode || !syncPlaying) {
      clearInterval(syncIntervalRef.current);
      return;
    }
    syncIntervalRef.current = setInterval(() => {
      try {
        const t = playerRef.current?.getCurrentTime?.();
        if (typeof t === "number") setSyncTime(t);
      } catch {}
    }, SYNC_HZ);
    return () => clearInterval(syncIntervalRef.current);
  }, [syncMode, syncPlaying]);

  // ── Scroll active segment into view ───────────────────────────────────────
  const activeSegRef = useRef(null);
  useEffect(() => {
    if (syncMode && activeSegRef.current) {
      activeSegRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [syncTime, syncMode]);

  // ── Fetch timed segments ───────────────────────────────────────────────────
  const fetchSegments = useCallback(async () => {
    if (!ytUrl.trim()) return;
    setSegStatus("loading");
    setSegJobId("");
    try {
      const res  = await fetch(apiUrl("/api/youtube/segments"), {
        method: "POST",
        headers: { ...authHeader(), "Content-Type": "application/json" },
        body: JSON.stringify({ url: ytUrl.trim(), lang: lang.trim(), mode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed.");
      if (data.status === "queued") {
        setSegJobId(data.jobId);
        setSegStatus("queued");
      } else {
        setSegments(data.segments || []);
        setSegStatus("done");
        setSyncMode(true);
      }
    } catch (e) {
      setSegStatus("error");
    }
  }, [ytUrl, lang, mode]);

  // ── Poll async segments job ────────────────────────────────────────────────
  useEffect(() => {
    if (!segJobId || segStatus !== "queued") return;
    const id = setTimeout(async () => {
      try {
        const res  = await fetch(apiUrl(`/api/youtube/transcript/${encodeURIComponent(segJobId)}`), { headers: authHeader() });
        const data = await res.json();
        const st   = String(data.status || "queued").toLowerCase();
        if (st === "completed") {
          // jobId poll still returns plain text; rebuild segments from joined content
          const segs = Array.isArray(data.segments) ? data.segments : [];
          setSegments(segs);
          setSegStatus("done");
          setSyncMode(true);
          setSegJobId("");
        } else if (st === "failed") {
          setSegStatus("error");
          setSegJobId("");
        } else {
          setSegStatus("queued");
        }
      } catch {
        setSegStatus("error");
        setSegJobId("");
      }
    }, POLL_MS);
    return () => clearTimeout(id);
  }, [segJobId, segStatus]);

  // ── Load existing transcript on mount ──────────────────────────────────────
  useEffect(() => {
    if (!sourceId) return;
    fetch(apiUrl(`/api/youtube/${sourceId}`), { headers: authHeader() })
      .then(r => r.json())
      .then(d => {
        const t = d.source?.transcript || "";
        setTranscript(t);
        setWordCount(t.split(/\s+/).filter(Boolean).length);
        setSaved(true);
      })
      .catch(() => {});
  }, [sourceId]);

  // ── Poll async transcript job ──────────────────────────────────────────────
  useEffect(() => {
    if (!jobId || status !== "queued") return;
    const id = setTimeout(async () => {
      try {
        const res  = await fetch(apiUrl(`/api/youtube/transcript/${encodeURIComponent(jobId)}`), { headers: authHeader() });
        const data = await res.json();
        const st   = String(data.status || "queued").toLowerCase();
        setStatus(st);
        if (st === "completed") {
          const text = String(data.content || "");
          setTranscript(text);
          setWordCount(text.split(/\s+/).filter(Boolean).length);
          setJobId("");
          setSaved(false);
        } else if (st === "failed") {
          setError(String(data.error?.message || "Transcription failed."));
          setJobId("");
        }
      } catch (e) {
        setError(e.message);
        setStatus("failed");
        setJobId("");
      }
    }, POLL_MS);
    return () => clearTimeout(id);
  }, [jobId, status]);

  // ── Start transcription ────────────────────────────────────────────────────
  const handleTranscribe = useCallback(async (e) => {
    e?.preventDefault();
    if (!ytUrl.trim() || isBusy) return;
    setStatus("submitting");
    setError("");
    setJobId("");
    try {
      const res  = await fetch(apiUrl("/api/youtube/transcript"), {
        method: "POST",
        headers: { ...authHeader(), "Content-Type": "application/json" },
        body: JSON.stringify({ url: ytUrl.trim(), lang: lang.trim(), mode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed.");
      if (data.status === "queued") {
        setJobId(data.jobId);
        setStatus("queued");
      } else {
        const text = String(data.content || "");
        setTranscript(text);
        setWordCount(text.split(/\s+/).filter(Boolean).length);
        setStatus("completed");
        setSaved(false);
      }
    } catch (e) {
      setError(e.message);
      setStatus("failed");
    }
  }, [ytUrl, lang, mode, isBusy]);

  // ── Debounced auto-save ────────────────────────────────────────────────────
  useEffect(() => {
    if (saved || !sourceId) return;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      setSaving(true);
      try {
        await fetch(apiUrl(`/api/youtube/${sourceId}/transcript`), {
          method: "PUT",
          headers: { ...authHeader(), "Content-Type": "application/json" },
          body: JSON.stringify({ text: transcript }),
        });
        setSaved(true);
      } catch {}
      finally { setSaving(false); }
    }, 1500);
    return () => clearTimeout(saveTimerRef.current);
  }, [transcript, saved, sourceId]);

  const handleTextChange = (e) => {
    const text = e.target.value;
    setTranscript(text);
    setWordCount(text.split(/\s+/).filter(Boolean).length);
    setSaved(false);
  };

  // ── Active segment for sync ────────────────────────────────────────────────
  const activeSegIdx = segments.length
    ? segments.reduce((best, s, i) => s.start <= syncTime ? i : best, -1)
    : -1;

  const statusLabel = {
    idle:       "",
    submitting: "Submitting…",
    queued:     "Transcribing… (polling)",
    completed:  "Done",
    failed:     "Failed",
  }[status];

  return (
    <div id="yt_page">
      {/* ── Header ── */}
      <div id="yt_header">
        <button id="yt_back_btn" onClick={() => history.push("/sources")}>←</button>
        <span id="yt_title">{sourceName || "YouTube Source"}</span>
        <span id="yt_save_status">{saving ? "Saving…" : saved ? "Saved ✓" : "Unsaved"}</span>
        <span id="yt_word_count">{wordCount > 0 ? `${wordCount} words` : ""}</span>
      </div>

      <div id="yt_body">
        {/* ── Left: player + transcription controls ── */}
        <div id="yt_left">
          {/* YouTube IFrame API player */}
          <div id="yt_embed_wrap">
            {videoId
              ? <div ref={playerDivRef} id="yt_player" />
              : <div id="yt_no_embed"><span>▶</span><p>No valid YouTube URL</p></div>
            }
          </div>

          {/* Transcription form */}
          <form id="yt_transcribe_form" onSubmit={handleTranscribe}>
            <div id="yt_url_row">
              <input id="yt_url_input" type="url" value={ytUrl} readOnly />
            </div>
            <div id="yt_options_row">
              <select
                id="yt_lang_input"
                value={lang}
                onChange={e => setLang(e.target.value)}
                disabled={isBusy}
              >
                <option value="">Auto-detect</option>
                <option value="en">English</option>
                <option value="fr">French</option>
                <option value="de">German</option>
                <option value="es">Spanish</option>
                <option value="it">Italian</option>
                <option value="pt">Portuguese</option>
                <option value="nl">Dutch</option>
                <option value="ru">Russian</option>
                <option value="ar">Arabic</option>
                <option value="zh">Chinese</option>
                <option value="ja">Japanese</option>
                <option value="ko">Korean</option>
                <option value="hi">Hindi</option>
                <option value="tr">Turkish</option>
                <option value="pl">Polish</option>
                <option value="sv">Swedish</option>
                <option value="no">Norwegian</option>
                <option value="da">Danish</option>
                <option value="fi">Finnish</option>
              </select>
              <select
                id="yt_mode_select"
                value={mode}
                onChange={e => setMode(e.target.value)}
                disabled={isBusy}
              >
                <option value="auto">Auto</option>
                <option value="native">Native</option>
                <option value="generate">Generate</option>
              </select>
            </div>
            <div id="yt_actions_row">
              <button type="submit" id="yt_transcribe_btn" disabled={!ytUrl.trim() || isBusy}>
                {isBusy ? "Transcribing…" : "Transcribe"}
              </button>
              {statusLabel && (
                <span id="yt_status_label" className={`yt_status--${status}`}>{statusLabel}</span>
              )}
            </div>
            {error && <div id="yt_error">{error}</div>}
          </form>

          {/* Live sync controls */}
          <div id="yt_sync_bar">
            <span id="yt_sync_label">Live Sync</span>
            <button
              id="yt_sync_btn"
              className={syncMode ? "yt_sync_btn--active" : ""}
              onClick={() => setSyncMode(m => !m)}
              disabled={segments.length === 0}
              title={segments.length === 0 ? "Fetch timed transcript first" : "Toggle live word sync"}
            >
              {syncMode ? "Sync ON" : "Sync OFF"}
            </button>
            <button
              id="yt_fetch_timed_btn"
              onClick={fetchSegments}
              disabled={segStatus === "loading" || segStatus === "queued" || !ytUrl.trim()}
              title="Fetch timed transcript for live word highlight"
            >
              {segStatus === "loading" || segStatus === "queued" ? "Fetching…" : "Fetch Timed"}
            </button>
            {segStatus === "done"  && <span className="yt_seg_status yt_seg_ok">{segments.length} segments</span>}
            {segStatus === "error" && <span className="yt_seg_status yt_seg_err">Failed</span>}
          </div>
        </div>

        {/* ── Right: transcript editor / sync view ── */}
        <div id="yt_editor_panel">
          <div id="yt_editor_header">
            <span id="yt_editor_label">Transcript</span>
            <button
              id="yt_copy_btn"
              onClick={() => navigator.clipboard?.writeText(transcript)}
              disabled={!transcript}
              title="Copy to clipboard"
            >Copy</button>
          </div>

          {/* Live sync view OR editable textarea */}
          {syncMode && segments.length > 0 ? (
            <div id="yt_sync_view">
              {segments.map((seg, i) => {
                const isActive = i === activeSegIdx;
                return (
                  <span
                    key={i}
                    ref={isActive ? activeSegRef : null}
                    className={`yt_seg${isActive ? " yt_seg--active" : ""}`}
                    onClick={() => {
                      try { playerRef.current?.seekTo?.(seg.start, true); } catch {}
                    }}
                    title={`${seg.start.toFixed(1)}s`}
                  >{seg.text} </span>
                );
              })}
            </div>
          ) : (
            <textarea
              id="yt_editor"
              ref={editorRef}
              value={transcript}
              onChange={handleTextChange}
              placeholder="The transcript will appear here once fetched — you can also type or paste text freely."
              spellCheck
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default YouTubePage;
