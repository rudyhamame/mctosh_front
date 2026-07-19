import React, { useCallback, useEffect, useRef, useState } from "react";
import { apiUrl } from "../config/api";
import { readStoredSession } from "../utils/sessionCleanup";
import { loadYTApi } from "../utils/youtubeIframeApi";
import "./smartVideoPanel.css";

const TRANSCRIPT_POLL_MS = 2500;

const authHeader = () => {
  const token = readStoredSession()?.token || "";
  return token ? { Authorization: `Bearer ${token}` } : {};
};

// Matches AI_PROVIDERS in src/hooks/useAIProvider.js — a small local copy
// rather than importing that hook here, since this component only needs
// the display labels, not provider-selection state.
const PROVIDER_LABEL = {
  local: "Local (Ollama)",
  openai: "OpenAI",
  groq: "Groq",
  moonshot: "Kimi (Moonshot)",
  gemini: "Gemini",
};

const ROLE_LABEL = {
  best_overall: "Best Overall Match",
  best_visual: "Best Visual Explanation",
  best_concise: "Best Concise Review",
  best_deep_dive: "Best Deep Dive",
  best_clinical: "Best Clinical Application",
};

const STYLE_OPTIONS = [
  { value: "animation", label: "Animation" },
  { value: "whiteboard", label: "Whiteboard" },
  { value: "lecture", label: "Lecture" },
  { value: "clinical_case", label: "Clinical case" },
  { value: "talking_head", label: "Talking head" },
  { value: "slides", label: "Slides" },
];

const LEARNING_GOAL_OPTIONS = [
  { value: "quick_review", label: "Quick review" },
  { value: "deep_understanding", label: "Deep understanding" },
  { value: "exam_prep", label: "Exam prep" },
];

const LANGUAGE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "ar", label: "Arabic" },
  { value: "hi", label: "Hindi" },
  { value: "pt", label: "Portuguese" },
];

const formatDuration = (seconds) => {
  if (!seconds) return "";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

const formatViews = (n) => {
  if (!n) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M views`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K views`;
  return `${n} views`;
};

// Same new/loadVideoById construction as YouTubePage.jsx/YouTubeSourcePage.jsx
// (see src/utils/youtubeIframeApi.js) — a real embedded IFrame-API player,
// not a bare <iframe>, so play/pause/seek are the player's own native
// controls (playerVars.controls defaults to 1) rather than anything custom
// built here.
const VideoPlayer = ({ videoId }) => {
  const divRef = useRef(null);
  const playerRef = useRef(null);

  useEffect(() => {
    if (!videoId) return;
    loadYTApi(() => {
      if (!divRef.current) return;
      if (playerRef.current) {
        try { playerRef.current.loadVideoById(videoId); return; } catch { /* fall through to rebuild below */ }
      }
      playerRef.current = new window.YT.Player(divRef.current, {
        width: "100%",
        height: "100%",
        videoId,
        playerVars: { rel: 0, modestbranding: 1, autoplay: 1 },
      });
    });
  }, [videoId]);

  // Only torn down when the panel itself unmounts (or the player section
  // closes, via key-remount below) — changing videos while it's open reuses
  // the same player via loadVideoById above instead of a full rebuild.
  useEffect(() => () => {
    try { playerRef.current?.destroy?.(); } catch { /* already gone */ }
    playerRef.current = null;
  }, []);

  return (
    <div className="smart_video_player_wrap">
      <div ref={divRef} />
    </div>
  );
};

const VideoTranscript = ({ video }) => {
  const [status, setStatus] = useState("idle");
  const [jobId, setJobId] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState("");

  const videoUrl = video?.url || (video?.videoId ? `https://www.youtube.com/watch?v=${video.videoId}` : "");
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  const busy = status === "submitting" || status === "queued";

  const requestTranscript = useCallback(async () => {
    if (!videoUrl || busy) return;
    setStatus("submitting");
    setJobId("");
    setText("");
    setError("");
    try {
      const res = await fetch(apiUrl("/api/youtube/transcript"), {
        method: "POST",
        headers: { ...authHeader(), "Content-Type": "application/json" },
        body: JSON.stringify({ url: videoUrl, lang: "", mode: "auto" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || data.error || "Transcription failed.");
      if (data.status === "queued") {
        setJobId(data.jobId);
        setStatus("queued");
        return;
      }
      setText(String(data.content || ""));
      setStatus("completed");
    } catch (err) {
      setError(err.message || "Transcription failed.");
      setStatus("failed");
    }
  }, [busy, videoUrl]);

  useEffect(() => {
    setStatus(videoUrl ? "idle" : "failed");
    setJobId("");
    setText("");
    setError(videoUrl ? "" : "No YouTube URL is available for this video.");
  }, [videoUrl]);

  useEffect(() => {
    if (!videoUrl) return;
    void requestTranscript();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoUrl]);

  useEffect(() => {
    if (!jobId || status !== "queued") return undefined;
    const id = setTimeout(async () => {
      try {
        const res = await fetch(apiUrl(`/api/youtube/transcript/${encodeURIComponent(jobId)}`), { headers: authHeader() });
        const data = await res.json();
        const nextStatus = String(data.status || "queued").toLowerCase();
        if (nextStatus === "completed") {
          setText(String(data.content || ""));
          setStatus("completed");
          setJobId("");
        } else if (nextStatus === "failed") {
          setError(String(data.error?.message || data.error || "Transcription failed."));
          setStatus("failed");
          setJobId("");
        } else {
          setStatus("queued");
        }
      } catch (err) {
        setError(err.message || "Transcription failed.");
        setStatus("failed");
        setJobId("");
      }
    }, TRANSCRIPT_POLL_MS);
    return () => clearTimeout(id);
  }, [jobId, status]);

  return (
    <div id="smart_video_transcript">
      <div id="smart_video_transcript_header">
        <span><i className="bx bx-text" /> Transcript</span>
        {wordCount > 0 && <span id="smart_video_transcript_count">{wordCount} words</span>}
        <button
          type="button"
          id="smart_video_transcript_retry"
          onClick={requestTranscript}
          disabled={busy || !videoUrl}
        >
          {busy ? <i className="bx bx-loader-circle pdf_icon_spin" /> : <i className="bx bx-refresh" />}
          {busy ? "Transcribing..." : text ? "Refresh" : "Transcribe"}
        </button>
      </div>
      {busy && (
        <div className="smart_video_transcript_status">
          <i className="bx bx-loader-circle pdf_icon_spin" /> Typing transcript from the selected video...
        </div>
      )}
      {!busy && error && (
        <div className="smart_video_transcript_status smart_video_transcript_status--error">
          <i className="bx bx-error" /> {error}
        </div>
      )}
      {!busy && !error && (
        <textarea
          id="smart_video_transcript_text"
          value={text}
          readOnly
          placeholder="Transcript will appear here once the transcription service finishes."
        />
      )}
    </div>
  );
};

const formatSavedDate = (iso) => {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch { return ""; }
};

const SavedItem = ({ item, onLoad, onDelete }) => (
  <div className="smart_video_saved_item">
    <button type="button" className="smart_video_saved_item_main" onClick={() => onLoad(item)}>
      <span className="smart_video_saved_item_concept">{item.canonicalConcept}</span>
      {item.summary && <span className="smart_video_saved_item_summary">{item.summary}</span>}
      <span className="smart_video_saved_item_meta">
        {item.videos?.length || 0} video{item.videos?.length === 1 ? "" : "s"} · {formatSavedDate(item.createdAt)}
        {item.documentTitle ? ` · ${item.documentTitle}` : ""}
      </span>
    </button>
    <button
      type="button"
      className="smart_video_saved_item_delete"
      onClick={(e) => { e.stopPropagation(); onDelete(item.id); }}
      title="Delete"
    ><i className="bx bx-trash" /></button>
  </div>
);

// A toggle-chip multi-select — used for language/preferred-style filters,
// which are small fixed option sets, not free text.
const ChipMultiSelect = ({ options, values, onToggle }) => (
  <div className="smart_video_pref_chips">
    {options.map((opt) => (
      <button
        key={opt.value}
        type="button"
        className={`smart_video_pref_chip${values.includes(opt.value) ? " smart_video_pref_chip--active" : ""}`}
        onClick={() => onToggle(opt.value)}
      >
        {opt.label}
      </button>
    ))}
  </div>
);

// The Video Preferences panel — hard filters (exclude a video outright) vs.
// ranking preferences (reorder without excluding) are visually grouped to
// match how the backend actually treats them (see back/helpers/
// videoFilters.js vs. back/helpers/videoScoring.js) rather than presenting
// one flat, undifferentiated list of knobs.
const PreferencesPanel = ({ preferences, onChange }) => {
  const { hardFilters, rankingPreferences, maxResults } = preferences;

  const setHardFilters = (patch) => onChange({ ...preferences, hardFilters: { ...hardFilters, ...patch } });
  const setRankingPreferences = (patch) => onChange({ ...preferences, rankingPreferences: { ...rankingPreferences, ...patch } });
  const toggleInArray = (arr, value) => (arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value]);

  return (
    <div id="smart_video_preferences">
      <div className="smart_video_pref_section">
        <span className="smart_video_pref_section_title">Hard filters — excludes non-matching videos</span>

        <label className="smart_video_pref_label">Video language</label>
        <ChipMultiSelect
          options={LANGUAGE_OPTIONS}
          values={hardFilters.language}
          onToggle={(v) => setHardFilters({ language: toggleInArray(hardFilters.language, v) })}
        />

        <div className="smart_video_pref_row">
          <label className="smart_video_pref_label" htmlFor="svp_max_dur">Max length (min)</label>
          <input
            id="svp_max_dur" type="number" min="1" max="600" placeholder="Any"
            value={hardFilters.maxDurationMinutes ?? ""}
            onChange={(e) => setHardFilters({ maxDurationMinutes: e.target.value ? Number(e.target.value) : null })}
          />
        </div>
        <div className="smart_video_pref_row">
          <label className="smart_video_pref_label" htmlFor="svp_min_dur">Min length (min)</label>
          <input
            id="svp_min_dur" type="number" min="0" max="600" placeholder="Any"
            value={hardFilters.minDurationMinutes ?? ""}
            onChange={(e) => setHardFilters({ minDurationMinutes: e.target.value ? Number(e.target.value) : null })}
          />
        </div>
        <label className="smart_video_pref_checkbox">
          <input
            type="checkbox" checked={hardFilters.captionsRequired}
            onChange={(e) => setHardFilters({ captionsRequired: e.target.checked })}
          /> Captions required
        </label>
      </div>

      <div className="smart_video_pref_section">
        <span className="smart_video_pref_section_title">Ranking preferences — reorder, never exclude</span>

        <label className="smart_video_pref_label">Presentation / visual style</label>
        <ChipMultiSelect
          options={STYLE_OPTIONS}
          values={rankingPreferences.preferredStyles}
          onToggle={(v) => setRankingPreferences({ preferredStyles: toggleInArray(rankingPreferences.preferredStyles, v) })}
        />

        <div className="smart_video_pref_row">
          <label className="smart_video_pref_label" htmlFor="svp_goal">Learning goal</label>
          <select
            id="svp_goal"
            value={rankingPreferences.learningGoal || ""}
            onChange={(e) => setRankingPreferences({ learningGoal: e.target.value || undefined })}
          >
            <option value="">No preference</option>
            {LEARNING_GOAL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        <div className="smart_video_pref_row">
          <label className="smart_video_pref_label" htmlFor="svp_clinical">
            Basic science ↔ Clinical
          </label>
          <input
            id="svp_clinical" type="range" min="0" max="1" step="0.1"
            value={rankingPreferences.clinicalFocus ?? 0.5}
            onChange={(e) => setRankingPreferences({ clinicalFocus: Number(e.target.value) })}
          />
        </div>
        <div className="smart_video_pref_row">
          <label className="smart_video_pref_label" htmlFor="svp_recency">Recency preference</label>
          <input
            id="svp_recency" type="range" min="0" max="1" step="0.1"
            value={rankingPreferences.recencyWeight}
            onChange={(e) => setRankingPreferences({ recencyWeight: Number(e.target.value) })}
          />
        </div>
        <div className="smart_video_pref_row">
          <label className="smart_video_pref_label" htmlFor="svp_pop">Popularity preference</label>
          <input
            id="svp_pop" type="range" min="0" max="1" step="0.1"
            value={rankingPreferences.popularityWeight}
            onChange={(e) => setRankingPreferences({ popularityWeight: Number(e.target.value) })}
          />
        </div>

        <label className="smart_video_pref_checkbox">
          <input
            type="checkbox" checked={rankingPreferences.preferAcademicSources}
            onChange={(e) => setRankingPreferences({ preferAcademicSources: e.target.checked })}
          /> Prefer academic/trusted sources
        </label>
        <label className="smart_video_pref_checkbox">
          <input
            type="checkbox" checked={rankingPreferences.strictRelevance}
            onChange={(e) => setRankingPreferences({ strictRelevance: e.target.checked })}
          /> Strict relevance (harsher penalty for weak matches)
        </label>

        <div className="smart_video_pref_row">
          <label className="smart_video_pref_label" htmlFor="svp_max_results">Maximum results</label>
          <input
            id="svp_max_results" type="number" min="1" max="12"
            value={maxResults}
            onChange={(e) => onChange({ ...preferences, maxResults: Math.min(12, Math.max(1, Number(e.target.value) || 1)) })}
          />
        </div>
      </div>
    </div>
  );
};

// Distinguishes "the AI actually read this video's transcript" from "the AI
// only saw title/description/channel" — the one rule this whole feature is
// built around not blurring. Never rendered as a vague "AI analyzed" badge.
const AnalysisBasisBadge = ({ contentAnalysis }) => {
  const verified = contentAnalysis?.status === "verified";
  return (
    <span className={`smart_video_basis_badge${verified ? " smart_video_basis_badge--verified" : ""}`}>
      <i className={`bx ${verified ? "bxs-badge-check" : "bx-search-alt"}`} />
      {verified ? "Content Verified" : "Search Match"}
    </span>
  );
};

const VideoCard = ({ video, onWatch }) => {
  const analysis = video.contentAnalysis || {};
  const verified = analysis.status === "verified";
  const overall = video.scores?.overall ?? video.score;

  return (
    <div className={`smart_video_card${video.role ? " smart_video_card--role" : ""}`}>
      {video.role && ROLE_LABEL[video.role] && (
        <div className="smart_video_role_banner">{ROLE_LABEL[video.role]}</div>
      )}
      <div className="smart_video_card_body">
        <button type="button" className="smart_video_thumb" onClick={() => onWatch(video.videoId)} title="Watch">
          {video.thumbnailUrl
            ? <img src={video.thumbnailUrl} alt="" loading="lazy" />
            : <div className="smart_video_thumb_fallback"><i className="bx bx-play-circle" /></div>}
          {video.durationSeconds ? <span className="smart_video_duration">{formatDuration(video.durationSeconds)}</span> : null}
        </button>
        <div className="smart_video_meta">
          <div className="smart_video_title" title={video.title}>{video.title}</div>
          <div className="smart_video_channel">
            {video.channelTitle}{video.viewCount ? ` · ${formatViews(video.viewCount)}` : ""}
          </div>

          <div className="smart_video_badge_row">
            {typeof overall === "number" && (
              <span className="smart_video_score_badge">{Math.round(overall * 100)}% match</span>
            )}
            <AnalysisBasisBadge contentAnalysis={analysis} />
            {video.confidenceLabel && (
              <span className={`smart_video_confidence_badge smart_video_confidence_badge--${video.confidenceLabel.toLowerCase()}`}>
                {video.confidenceLabel} confidence
              </span>
            )}
          </div>

          {video.coverage?.length > 0 && (
            <div className="smart_video_coverage_list">
              {video.coverage.map((c) => (
                <span key={c.concept} className={`smart_video_coverage_item${c.covered ? " smart_video_coverage_item--covered" : ""}`}>
                  <i className={`bx ${c.covered ? "bx-check" : "bx-x"}`} /> {c.concept}
                </span>
              ))}
            </div>
          )}

          {video.explanation && <div className="smart_video_reason">{video.explanation}</div>}

          <div className="smart_video_basis_note">
            Based on: {verified ? "Transcript analysis" : "Title, description, channel, and metadata"}
          </div>

          <div className="smart_video_actions">
            <button type="button" className="smart_video_watch_btn" onClick={() => onWatch(video.videoId)}>
              <i className="bx bx-play-circle" /> Watch
            </button>
            <a
              className="smart_video_open_btn"
              href={`https://www.youtube.com/watch?v=${video.videoId}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <i className="bx bx-link-external" /> Open on YouTube
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

// Rendered as a far-left column inside #pdf_content — same convention as
// #pdf_annot_history_panel/#pdf_md_panel in PDFPage.jsx (fixed width,
// subtracted from #pdf_preview's own width via splitRatio's calc()). Mounts
// as soon as the "smartVideo" tool is selected (see the annotTool effect in
// PDFPage.jsx) — capture controls live at the top of this same aside instead
// of a separate toolbar sub-panel, so there's one place for the whole
// capture -> review -> search -> watch flow. Deliberately has no close
// button of its own — re-pressing the Smart Video tool button (a toggle,
// see toggleAnnotTool in PDFPage.jsx) is the only way to close it, so
// switching to a different tool (e.g. Pen) leaves the aside's results and
// captured screenshots exactly where they were instead of yanking them away.
const SmartVideoPanel = ({
  selecting, onToggleSelecting,
  screenshots, captureBusy, onRemoveScreenshot, onClearScreenshots,
  difficulty, onDifficultyChange, onSearch,
  stage, error, eidos, videos, activeVideoId, onWatch, onCloseVideo,
  provider, providerModels,
  savedOpen, onToggleSaved, saved, savedLoading, onLoadSaved, onDeleteSaved,
  onSave, saveBusy, savedId,
  preferences, onPreferencesChange, preferencesOpen, onTogglePreferences,
}) => {
  const busy = stage === "extracting" || stage === "searching";
  const verifiedCount = videos.filter((v) => v.contentAnalysis?.status === "verified").length;
  const activeVideo = activeVideoId ? videos.find((v) => v.videoId === activeVideoId) || { videoId: activeVideoId } : null;

  return (
    <div id="smart_video_panel">
      <div id="smart_video_header">
        <span id="smart_video_header_title">Smart Video Search</span>
        <button
          type="button"
          id="smart_video_prefs_toggle"
          className={preferencesOpen ? "smart_video_prefs_toggle--active" : ""}
          onClick={onTogglePreferences}
          title="Video preferences"
          aria-label="Video preferences"
        >
          <i className="bx bx-sliders-alt" /> Preferences
        </button>
        <button
          type="button"
          id="smart_video_saved_toggle"
          className={savedOpen ? "smart_video_saved_toggle--active" : ""}
          onClick={onToggleSaved}
          title="Saved concepts"
          aria-label="Saved concepts"
        >
          <i className={`bx ${savedOpen ? "bxs-bookmark" : "bx-bookmark"}`} /> Saved{saved.length ? ` (${saved.length})` : ""}
        </button>
      </div>

      {preferencesOpen ? (
        <div id="smart_video_body">
          <PreferencesPanel preferences={preferences} onChange={onPreferencesChange} />
        </div>
      ) : savedOpen ? (
        <div id="smart_video_body">
          {savedLoading && (
            <div className="smart_video_status"><i className="bx bx-loader-circle pdf_icon_spin" /> Loading saved concepts…</div>
          )}
          {!savedLoading && saved.length === 0 && (
            <div className="smart_video_status">Nothing saved yet — find some videos, then press Save.</div>
          )}
          {!savedLoading && saved.length > 0 && (
            <div id="smart_video_saved_list">
              {saved.map((item) => (
                <SavedItem key={item.id} item={item} onLoad={onLoadSaved} onDelete={onDeleteSaved} />
              ))}
            </div>
          )}
        </div>
      ) : (
      <div id="smart_video_body" className={activeVideoId ? "smart_video_body--watching" : ""}>
        <div id="smart_video_capture_panel">
          <p id="smart_video_capture_hint">
            {selecting
              ? "Drag a rectangle around a paragraph to capture it — repeat for more than one area."
              : "Press Start selecting, then drag a rectangle around a paragraph on the page to capture it."}
          </p>

          <button
            type="button"
            id="smart_video_start_selecting"
            className={selecting ? "smart_video_start_selecting--active" : ""}
            onClick={onToggleSelecting}
          >
            <i className={`bx ${selecting ? "bx-stop-circle" : "bx-crop"}`} />
            {selecting ? "Stop selecting" : "Start selecting"}
          </button>

          {screenshots.length > 0 && (
            <div id="smart_video_capture_thumbs">
              {screenshots.map((s) => (
                <div key={s.id} className="smart_video_capture_thumb">
                  <img src={s.dataUrl} alt="" />
                  {s.status === "reading" && (
                    <span className="smart_video_capture_thumb_status">
                      <i className="bx bx-loader-circle pdf_icon_spin" />
                    </span>
                  )}
                  {(s.status === "empty" || s.status === "error") && (
                    <span className="smart_video_capture_thumb_status smart_video_capture_thumb_status--warn" title={s.status === "empty" ? "No text detected" : "Reading failed"}>
                      <i className="bx bx-error" />
                    </span>
                  )}
                  <button
                    type="button"
                    className="smart_video_capture_thumb_remove"
                    onClick={() => onRemoveScreenshot(s.id)}
                    title="Remove"
                  >✕</button>
                </div>
              ))}
            </div>
          )}

          <div id="smart_video_capture_controls">
            <select
              value={difficulty}
              onChange={(e) => onDifficultyChange(e.target.value)}
              title="Target difficulty level"
              aria-label="Target difficulty level"
            >
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
            </select>
            <button
              type="button"
              id="smart_video_capture_clear"
              onClick={onClearScreenshots}
              disabled={!screenshots.length || captureBusy}
            >Clear</button>
            <button
              type="button"
              id="smart_video_capture_search"
              onClick={onSearch}
              disabled={captureBusy || busy}
            >
              <i className="bx bx-search" /> Find Videos
            </button>
          </div>
        </div>

        {busy && (
          <div className="smart_video_status">
            <i className="bx bx-loader-circle pdf_icon_spin" />
            {stage === "extracting" ? "Extracting the underlying concept…" : "Searching YouTube, verifying transcripts, and analyzing candidates…"}
          </div>
        )}

        {!busy && error && (
          <div className="smart_video_status smart_video_status--error"><i className="bx bx-error" /> {error}</div>
        )}

        {eidos && (
          <div id="smart_video_eidos">
            <div id="smart_video_eidos_top">
              <div id="smart_video_eidos_concept">{eidos.canonicalConcept}</div>
              <button
                type="button"
                id="smart_video_save_btn"
                className={savedId ? "smart_video_save_btn--saved" : ""}
                onClick={onSave}
                disabled={saveBusy || Boolean(savedId)}
                title={savedId ? "Saved" : "Save this concept and its videos"}
              >
                {saveBusy
                  ? <i className="bx bx-loader-circle pdf_icon_spin" />
                  : <i className={`bx ${savedId ? "bxs-bookmark" : "bx-bookmark"}`} />}
                {savedId ? "Saved" : "Save"}
              </button>
            </div>
            {eidos.provider && (
              <span id="smart_video_eidos_provider" title={eidos.model ? `Model: ${eidos.model}` : undefined}>
                <i className="bx bx-chip" /> {PROVIDER_LABEL[eidos.provider] || eidos.provider}
              </span>
            )}
            {eidos.summary && <p id="smart_video_eidos_summary">{eidos.summary}</p>}
            {eidos.ambiguities?.length > 0 && (
              <div className="smart_video_ambiguity">
                <i className="bx bx-error-circle" /> This passage was ambiguous: {eidos.ambiguities.join(" · ")}
              </div>
            )}
            {eidos.concepts?.length > 0 && (
              <div className="smart_video_taglist">
                <span className="smart_video_taglist_label">Key concepts</span>
                {eidos.concepts.map((p) => <span key={p} className="smart_video_tag">{p}</span>)}
              </div>
            )}
            {eidos.prerequisites?.length > 0 && (
              <div className="smart_video_taglist">
                <span className="smart_video_taglist_label">Prerequisites</span>
                {eidos.prerequisites.map((p) => <span key={p} className="smart_video_tag">{p}</span>)}
              </div>
            )}
            {eidos.relatedConcepts?.length > 0 && (
              <div className="smart_video_taglist">
                <span className="smart_video_taglist_label">Related</span>
                {eidos.relatedConcepts.map((p) => <span key={p} className="smart_video_tag">{p}</span>)}
              </div>
            )}
          </div>
        )}

        {activeVideoId && (
          <div id="smart_video_player_section">
            <VideoPlayer videoId={activeVideoId} />
            <VideoTranscript video={activeVideo} />
            <button type="button" id="smart_video_player_close" onClick={onCloseVideo}>
              <i className="bx bx-x" /> Close player
            </button>
          </div>
        )}

        {!busy && videos.length > 0 && (
          <>
            <div id="smart_video_analysis_summary">
              <i className="bx bx-info-circle" />
              {verifiedCount > 0
                ? `${verifiedCount} of ${videos.length} result${videos.length === 1 ? "" : "s"} content-verified from an actual transcript; the rest ranked from metadata only.`
                : `No transcript was available for any candidate — every result below is ranked from metadata only (title, description, channel).`}
            </div>
            <div id="smart_video_list">
              {videos.map((v) => <VideoCard key={v.videoId} video={v} onWatch={onWatch} />)}
            </div>
          </>
        )}

        {!busy && !error && eidos && videos.length === 0 && (
          <div className="smart_video_status">No relevant videos were found for this concept.</div>
        )}
      </div>
      )}

      {/* Pinned outside the scrollable body — always visible, even before
          Find Videos is ever pressed. Model name: prefer eidos.model (the
          ACTUAL provider/model a completed request resolved to, which can
          differ from the selected one if that provider wasn't configured
          and it fell back) — before that exists yet, fall back to
          providerModels[provider] (from GET /api/settings/ai-status, the
          same source Settings' own AI Providers section reads). */}
      {!activeVideoId && (
        <div id="smart_video_footer">
          <i className="bx bx-chip" />
          You are using: {PROVIDER_LABEL[eidos?.provider || provider] || eidos?.provider || provider}
          {(eidos?.model || providerModels?.[provider]) && (
            <span id="smart_video_footer_model"> · {eidos?.model || providerModels[provider]}</span>
          )}
        </div>
      )}
    </div>
  );
};

export default SmartVideoPanel;
