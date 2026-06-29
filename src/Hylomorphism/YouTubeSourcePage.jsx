import React, { useCallback, useEffect, useRef, useState } from "react";
import { useHistory, useLocation } from "react-router-dom";
import { apiUrl } from "../config/api";
import { readStoredSession } from "../utils/sessionCleanup";
import { LINGUISTIC_UNITS } from "../Linguistics/linguisticUnits";
import "./youtubeSourcePage.css";

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

const YouTubeSourcePage = () => {
  const history  = useHistory();
  const location = useLocation();
  const { sourceId, sourceName, sourceUrl } = location.state || {};

  const [transcript,   setTranscript]   = useState("");
  const [loading,      setLoading]      = useState(true);
  const [lingTags,     setLingTags]     = useState([]);
  const [classifying,  setClassifying]  = useState(false);
  const [classifyErr,  setClassifyErr]  = useState("");

  const playerRef    = useRef(null);
  const playerDivRef = useRef(null);
  const videoId = extractVideoId(sourceUrl || "");

  // ── Load saved transcript ──────────────────────────────────────────────────
  useEffect(() => {
    if (!sourceId) { setLoading(false); return; }
    fetch(apiUrl(`/api/youtube/${sourceId}`), { headers: authHeader() })
      .then(r => r.json())
      .then(d => setTranscript(d.source?.transcript || ""))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [sourceId]);

  // ── IFrame API player ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!videoId) return;
    loadYTApi(() => {
      if (!playerDivRef.current || playerRef.current) return;
      playerRef.current = new window.YT.Player(playerDivRef.current, {
        videoId,
        playerVars: { rel: 0, modestbranding: 1 },
      });
    });
  }, [videoId]);

  // ── Text stats ─────────────────────────────────────────────────────────────
  const allWords   = transcript.trim() ? transcript.trim().split(/\s+/) : [];
  const totalWords = allWords.length;
  const uniqueWords = new Set(
    allWords.map(w => w.toLowerCase().replace(/[^a-z0-9À-ɏ]/gi, "")).filter(Boolean)
  ).size;

  // ── Classify ───────────────────────────────────────────────────────────────
  const handleClassify = useCallback(async () => {
    if (!transcript.trim() || classifying) return;
    setClassifying(true);
    setClassifyErr("");
    try {
      const res  = await fetch(apiUrl("/api/youtube/classify-units"), {
        method: "POST",
        headers: { ...authHeader(), "Content-Type": "application/json" },
        body: JSON.stringify({ text: transcript }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Classification failed.");
      const tags = [];
      for (const [unit, items] of Object.entries(data)) {
        for (const text of (items || [])) {
          tags.push({ id: `${unit}-${tags.length}`, unit, text });
        }
      }
      setLingTags(tags);
    } catch (e) {
      setClassifyErr(e.message);
    } finally {
      setClassifying(false);
    }
  }, [transcript, classifying]);

  return (
    <div id="ytsrc_page">
      {/* ── Header ── */}
      <div id="ytsrc_header">
        <button id="ytsrc_back_btn" onClick={() => history.push("/hylomorphism")}>←</button>
        <span id="ytsrc_title">{sourceName || "YouTube Source"}</span>
        <button
          id="ytsrc_open_editor_btn"
          onClick={() => history.push("/youtube", { sourceId, sourceName, sourceUrl })}
          title="Open in transcript editor"
        >Transcript Editor</button>
      </div>

      <div id="ytsrc_body">
        {/* ── Left: player + transcript ── */}
        <div id="ytsrc_left">
          <div id="ytsrc_embed_wrap">
            {videoId
              ? <div ref={playerDivRef} id="ytsrc_player" />
              : <div id="ytsrc_no_embed"><span>▶</span><p>No valid YouTube URL</p></div>
            }
          </div>

          <div id="ytsrc_transcript_panel">
            <span id="ytsrc_transcript_label">Transcript</span>
            {loading
              ? <p id="ytsrc_loading">Loading…</p>
              : transcript
                ? <p id="ytsrc_transcript_text">{transcript}</p>
                : <p id="ytsrc_transcript_empty">No transcript yet — open the Transcript Editor to fetch one.</p>
            }
          </div>
        </div>

        {/* ── Right: linguistic units table ── */}
        <div id="ytsrc_right">
          <div id="ytsrc_ling_table_wrap">
            <div id="ytsrc_ling_header">
              <span id="ytsrc_ling_title">Linguistic Units</span>
              <div id="ytsrc_ling_stats">
                <span className="ytsrc_stat"><b>{totalWords.toLocaleString()}</b> words</span>
                <span className="ytsrc_stat_sep">·</span>
                <span className="ytsrc_stat"><b>{uniqueWords.toLocaleString()}</b> unique</span>
                {lingTags.length > 0 && <>
                  <span className="ytsrc_stat_sep">·</span>
                  <span className="ytsrc_stat"><b>{lingTags.length}</b> hyles</span>
                </>}
              </div>
              <button
                id="ytsrc_classify_btn"
                onClick={handleClassify}
                disabled={!transcript.trim() || classifying}
                title="Classify all hyles from transcript"
              >
                {classifying ? "Classifying…" : "Classify"}
              </button>
              {lingTags.length > 0 && (
                <button className="ytsrc_clear_btn" onClick={() => setLingTags([])}>Clear</button>
              )}
              {classifyErr && <span id="ytsrc_classify_err">{classifyErr}</span>}
            </div>

            <table id="ytsrc_ling_table">
              <thead>
                <tr>
                  {LINGUISTIC_UNITS.map(u => {
                    const count = lingTags.filter(t => t.unit === u.id).length;
                    return (
                      <th key={u.id} style={{ "--lu-color": u.color }}>
                        <span className="ytsrc_unit_pill" style={{ "--lu-color": u.color }}>{u.label}</span>
                        <span className="ytsrc_th_desc">{u.desc}</span>
                        {count > 0 && <span className="ytsrc_th_count">{count}</span>}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const cols = LINGUISTIC_UNITS.map(u => lingTags.filter(t => t.unit === u.id));
                  const rowCount = Math.max(1, ...cols.map(c => c.length));
                  return Array.from({ length: rowCount }, (_, i) => (
                    <tr key={i}>
                      {LINGUISTIC_UNITS.map((u, ci) => {
                        const tag = cols[ci][i];
                        return (
                          <td key={u.id} className="ytsrc_td_cell">
                            {tag
                              ? <span className="ytsrc_tag" style={{ "--lu-color": u.color }}>{tag.text}</span>
                              : null
                            }
                          </td>
                        );
                      })}
                    </tr>
                  ));
                })()}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default YouTubeSourcePage;
