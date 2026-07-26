import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { apiUrl } from "../config/api";
import { readStoredSession } from "../utils/sessionCleanup";
import { createLocalAvatarSpeechService } from "../Avatar/local3d/services/localAvatarSpeechService";
import { createBrowserTTSProvider } from "../Avatar/local3d/services/ttsProviders/BrowserTTSProvider";
import { createOpenVoiceCloneProvider } from "../Avatar/local3d/services/ttsProviders/OpenVoiceCloneProvider";
import { createKokoroTTSProvider } from "../Avatar/local3d/services/ttsProviders/KokoroTTSProvider";
import { createSupertonicTTSProvider } from "../Avatar/local3d/services/ttsProviders/SupertonicTTSProvider";
import { readTtsProviderId, readVoiceSettings, TTS_PROVIDERS } from "../Avatar/local3d/ttsProviderSettings";
import "./podcastPage.css";

const PODCAST_PAGE_FETCH_LIMIT = 250;

const authHeader = () => {
  const token = readStoredSession()?.token || "";
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const formatPublished = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
};

const formatPlayerTime = (value) => {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const totalSeconds = Math.floor(value);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
};

const archivePageLabel = (index) => `Archive Page ${index + 1}`;
const PODCAST_TTS_MAX_CHARS = 650;

const unlockBrowserSpeech = () => {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  try {
    const utterance = new SpeechSynthesisUtterance("");
    window.speechSynthesis.speak(utterance);
    window.speechSynthesis.cancel();
    window.speechSynthesis.resume?.();
  } catch {
    // Best-effort browser TTS unlock only.
  }
};

const createTtsProviderFor = (providerId) => {
  if (providerId === TTS_PROVIDERS.OPENVOICE) return createOpenVoiceCloneProvider();
  if (providerId === TTS_PROVIDERS.KOKORO) return createKokoroTTSProvider();
  if (providerId === TTS_PROVIDERS.SUPERTONIC) return createSupertonicTTSProvider();
  return createBrowserTTSProvider();
};

const splitTranscriptForTts = (text) => {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const sentences = normalized.match(/[^.!?]+[.!?]*|.+$/g) || [];
  const chunks = [];
  let current = "";

  const pushCurrent = () => {
    const next = current.trim();
    if (next) chunks.push(next);
    current = "";
  };

  sentences.forEach((sentence) => {
    const part = sentence.trim();
    if (!part) return;
    if (part.length > PODCAST_TTS_MAX_CHARS) {
      pushCurrent();
      const words = part.split(/\s+/);
      let oversizedChunk = "";
      words.forEach((word) => {
        const candidate = oversizedChunk ? `${oversizedChunk} ${word}` : word;
        if (candidate.length > PODCAST_TTS_MAX_CHARS && oversizedChunk) {
          chunks.push(oversizedChunk);
          oversizedChunk = word;
        } else {
          oversizedChunk = candidate;
        }
      });
      if (oversizedChunk) chunks.push(oversizedChunk);
      return;
    }
    const candidate = current ? `${current} ${part}` : part;
    if (candidate.length > PODCAST_TTS_MAX_CHARS) {
      pushCurrent();
      current = part;
      return;
    }
    current = candidate;
  });

  pushCurrent();
  return chunks;
};

const formatHostLabel = (value) => {
  if (!value) return "";
  try {
    return new URL(value).hostname.replace(/^www\./i, "");
  } catch {
    return value;
  }
};

const PodcastPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const { sourceId: stateSourceId, sourceName, sourceUrl } = location.state || {};
  const sourceId = stateSourceId || params.sourceId || "";

  const [source, setSource] = useState(sourceId ? { _id: sourceId, name: sourceName || "", url: sourceUrl || "" } : null);
  const [archivePageUrl, setArchivePageUrl] = useState(sourceUrl || "");
  const [archiveLoading, setArchiveLoading] = useState(true);
  const [archiveError, setArchiveError] = useState("");
  const [archiveData, setArchiveData] = useState(null);
  const [archivePages, setArchivePages] = useState([]);
  const [visibleArchivePageCount, setVisibleArchivePageCount] = useState(1);
  const [podcastCategories, setPodcastCategories] = useState([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [categoriesError, setCategoriesError] = useState("");
  const [archiveSyncLoading, setArchiveSyncLoading] = useState(false);
  const [archiveSyncStatus, setArchiveSyncStatus] = useState("");
  const [archiveSyncError, setArchiveSyncError] = useState("");
  const [asideOpen, setAsideOpen] = useState(true);
  const [selectedEpisodeUrl, setSelectedEpisodeUrl] = useState("");
  const [selectedEpisode, setSelectedEpisode] = useState(null);
  const [episodeLoading, setEpisodeLoading] = useState(false);
  const [episodeError, setEpisodeError] = useState("");
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptError, setTranscriptError] = useState("");
  const [transcriptText, setTranscriptText] = useState("");
  const [transcriptRequestedForUrl, setTranscriptRequestedForUrl] = useState("");
  const [transcriptSaved, setTranscriptSaved] = useState(false);
  const [transcriptDeleting, setTranscriptDeleting] = useState(false);
  const [transcriptFontSize, setTranscriptFontSize] = useState(16);
  const [transcriptTtsStatus, setTranscriptTtsStatus] = useState("idle");
  const [playerPlaying, setPlayerPlaying] = useState(false);
  const [playerCurrentTime, setPlayerCurrentTime] = useState(0);
  const [playerDuration, setPlayerDuration] = useState(0);
  const [playerSpeed, setPlayerSpeed] = useState(1);
  const audioRef = useRef(null);
  const transcriptFontSizeHydratedRef = useRef(false);
  const transcriptSpeechServiceRef = useRef(createLocalAvatarSpeechService(createTtsProviderFor(readTtsProviderId())));
  const transcriptSpeechProviderIdRef = useRef(readTtsProviderId());
  const transcriptSpeakTokenRef = useRef(0);

  useEffect(() => {
    document.body.classList.add("podcast_footer_theme");
    return () => {
      document.body.classList.remove("podcast_footer_theme");
      transcriptSpeechServiceRef.current.stop();
    };
  }, []);

  useEffect(() => {
    if (!sourceId) {
      setArchiveLoading(false);
      setArchiveError("No podcast source was provided.");
      return;
    }
    let cancelled = false;
    const run = async () => {
      setArchiveLoading(true);
      setArchiveError("");
      try {
        const query = archivePageUrl ? `?pageUrl=${encodeURIComponent(archivePageUrl)}` : "";
        const res = await fetch(apiUrl(`/api/sources/${sourceId}/podcast${query}`), { headers: authHeader() });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Failed to load this podcast source.");
        if (cancelled) return;
        setSource(data.source || null);
        setArchiveData(data.episode || null);
        setArchiveSyncError("");
      } catch (err) {
        if (cancelled) return;
        setArchiveError(err.message || "Failed to load this podcast source.");
        setArchiveData(null);
      } finally {
        if (!cancelled) setArchiveLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [sourceId, archivePageUrl]);

  useEffect(() => {
    if (!source?.url && sourceUrl) setSource((prev) => (prev ? { ...prev, url: sourceUrl } : prev));
    if (!archivePageUrl && sourceUrl) setArchivePageUrl(sourceUrl);
  }, [source?.url, sourceUrl, archivePageUrl]);

  useEffect(() => {
    if (!sourceId) {
      setPodcastCategories([]);
      setCategoriesLoading(false);
      setCategoriesError("");
      return;
    }
    let cancelled = false;
    const run = async () => {
      setCategoriesLoading(true);
      setCategoriesError("");
      try {
        const res = await fetch(apiUrl(`/api/sources/${sourceId}/podcast-categories`), { headers: authHeader() });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Failed to load podcast categories.");
        if (cancelled) return;
        setPodcastCategories(Array.isArray(data.categories) ? data.categories : []);
      } catch (err) {
        if (cancelled) return;
        setPodcastCategories([]);
        setCategoriesError(err.message || "Failed to load podcast categories.");
      } finally {
        if (!cancelled) setCategoriesLoading(false);
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [sourceId]);

  useEffect(() => {
    const nextFontSize = Number(source?.podcastReader?.transcriptFontSize);
    if (!Number.isFinite(nextFontSize)) return;
    transcriptFontSizeHydratedRef.current = true;
    setTranscriptFontSize(Math.min(24, Math.max(12, Math.round(nextFontSize))));
  }, [source?.podcastReader?.transcriptFontSize]);

  useEffect(() => {
    if (!archiveData) {
      setSelectedEpisodeUrl("");
      return;
    }
    if (archiveData.kind === "collection" || archivePages.length > 0) {
      const currentEpisodes = (archivePages.slice(0, visibleArchivePageCount).flatMap((page) => page?.episodes || []))
        || archiveData.episodes
        || [];
      const urls = currentEpisodes.map((entry) => entry?.url).filter(Boolean);
      if (!urls.length) {
        setSelectedEpisodeUrl("");
        return;
      }
      if (!urls.includes(selectedEpisodeUrl)) {
        setSelectedEpisodeUrl(urls[0]);
      }
      return;
    }
    if (archiveData.url) {
      setSelectedEpisodeUrl(archiveData.url);
    }
  }, [archiveData, archivePages, visibleArchivePageCount, selectedEpisodeUrl]);

  useEffect(() => {
    if (!sourceId || archiveData?.kind !== "collection") {
      setArchivePages([]);
      setVisibleArchivePageCount(1);
      setArchiveSyncLoading(false);
      setArchiveSyncStatus("");
      setArchiveSyncError("");
      return;
    }
    let cancelled = false;
    const makePage = (pageEpisode, index, url) => ({
      id: `${index}:${url || "root"}`,
      pageIndex: index,
      pageUrl: url || "",
      label: archivePageLabel(index),
      episodes: pageEpisode?.episodes || [],
    });
    const run = async () => {
      const initialPages = [makePage(archiveData, 0, archivePageUrl || source?.url || "")];
      setArchivePages(initialPages);
      setVisibleArchivePageCount(1);
      setArchiveSyncLoading(true);
      setArchiveSyncError("");
      setArchiveSyncStatus(`Loaded ${initialPages.length} archive page. Scanning archive...`);
      const pageUrls = new Set();
      const collectedPages = [...initialPages];
      let nextUrl = archiveData.pagination?.olderUrl || "";
      let pageCount = 1;
      try {
        while (nextUrl && !cancelled && pageCount < PODCAST_PAGE_FETCH_LIMIT) {
          if (pageUrls.has(nextUrl)) break;
          pageUrls.add(nextUrl);
          const query = `?pageUrl=${encodeURIComponent(nextUrl)}`;
          const res = await fetch(apiUrl(`/api/sources/${sourceId}/podcast${query}`), { headers: authHeader() });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || "Failed to load more podcast episodes.");
          if (cancelled) return;
          const pageEpisode = data.episode || null;
          if (!pageEpisode || pageEpisode.kind !== "collection") break;
          const nextPage = makePage(pageEpisode, pageCount, nextUrl);
          collectedPages.push(nextPage);
          setArchivePages([...collectedPages]);
          pageCount += 1;
          setArchiveSyncStatus(`Loaded ${pageCount} archive pages...`);
          nextUrl = String(pageEpisode.pagination?.olderUrl || "").trim();
        }
        if (cancelled) return;
        setArchiveSyncStatus(`Loaded ${collectedPages.length} archive pages.`);
      } catch (err) {
        if (cancelled) return;
        setArchiveSyncError(err.message || "Failed while scanning the archive.");
        setArchiveSyncStatus(`Loaded ${collectedPages.length} archive pages before the scan stopped.`);
      } finally {
        if (!cancelled) setArchiveSyncLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [sourceId, archiveData, archivePageUrl, source?.url]);

  useEffect(() => {
    if (!sourceId || !selectedEpisodeUrl) {
      setSelectedEpisode(null);
      setEpisodeLoading(false);
      setEpisodeError("");
      return;
    }
    let cancelled = false;
    const run = async () => {
      setEpisodeLoading(true);
      setEpisodeError("");
      try {
        const query = `?pageUrl=${encodeURIComponent(selectedEpisodeUrl)}`;
        const res = await fetch(apiUrl(`/api/sources/${sourceId}/podcast${query}`), { headers: authHeader() });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Failed to load this episode.");
        if (cancelled) return;
        setSelectedEpisode(data.episode || null);
      } catch (err) {
        if (cancelled) return;
        setEpisodeError(err.message || "Failed to load this episode.");
        setSelectedEpisode(null);
      } finally {
        if (!cancelled) setEpisodeLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [sourceId, selectedEpisodeUrl]);

  const displaySourceTitle = archiveData?.title || source?.name || "Podcast Source";
  const visibleArchivePages = archivePages.slice(0, visibleArchivePageCount);
  const archiveEpisodes = archiveData?.kind === "collection"
    ? (visibleArchivePages.flatMap((page) => page?.episodes || []) || archiveData.episodes || [])
    : [];
  const totalArchiveEpisodes = archivePages.reduce((sum, page) => sum + (page?.episodes?.length || 0), 0);
  const activeEpisode = selectedEpisode?.kind === "collection" ? null : selectedEpisode;
  const activeEpisodeTitle = activeEpisode?.title || displaySourceTitle;
  const activePublishedLabel = useMemo(() => formatPublished(activeEpisode?.publishedAt), [activeEpisode?.publishedAt]);
  const playerProgress = playerDuration > 0 ? Math.min(100, Math.max(0, (playerCurrentTime / playerDuration) * 100)) : 0;
  const sourceHostLabel = formatHostLabel(source?.url || archivePageUrl || sourceUrl || "");
  const categoryOptions = useMemo(() => podcastCategories.filter((entry) => entry?.url), [podcastCategories]);
  const selectedCategory = useMemo(
    () => categoryOptions.find((entry) => String(entry.url || "") === String(archivePageUrl || source?.url || "")) || null,
    [categoryOptions, archivePageUrl, source?.url]
  );
  const headerMeta = archiveData?.kind === "collection"
    ? `${archivePages.length || 1} archive page${(archivePages.length || 1) === 1 ? "" : "s"}`
    : "Single episode source";
  const transcriptTargetUrl = selectedEpisodeUrl
    || activeEpisode?.url
    || archiveData?.url
    || archivePageUrl
    || source?.url
    || "";

  useEffect(() => {
    setPlayerPlaying(false);
    setPlayerCurrentTime(0);
    setPlayerDuration(0);
    setPlayerSpeed(1);
    setTranscriptTtsStatus("idle");
    setTranscriptLoading(false);
    setTranscriptError("");
    setTranscriptText("");
    setTranscriptRequestedForUrl("");
    setTranscriptSaved(false);
    setTranscriptDeleting(false);
    transcriptSpeakTokenRef.current += 1;
    transcriptSpeechServiceRef.current.stop();
    const audioEl = audioRef.current;
    if (!audioEl) return;
    audioEl.pause();
    audioEl.currentTime = 0;
    audioEl.playbackRate = 1;
  }, [activeEpisode?.audioUrl]);

  const togglePlayback = async () => {
    const audioEl = audioRef.current;
    if (!audioEl || !activeEpisode?.audioUrl) return;
    if (audioEl.paused) {
      try {
        await audioEl.play();
      } catch {
        setPlayerPlaying(false);
      }
      return;
    }
    audioEl.pause();
  };

  const onSeek = (event) => {
    const audioEl = audioRef.current;
    const nextTime = Number(event.target.value) || 0;
    setPlayerCurrentTime(nextTime);
    if (!audioEl) return;
    audioEl.currentTime = nextTime;
  };

  const skipPlaybackBy = (deltaSeconds) => {
    const audioEl = audioRef.current;
    if (!audioEl) return;
    const duration = Number.isFinite(audioEl.duration) ? audioEl.duration : playerDuration;
    const nextTime = Math.min(Math.max(0, (Number(audioEl.currentTime) || 0) + deltaSeconds), duration || 0);
    audioEl.currentTime = nextTime;
    setPlayerCurrentTime(nextTime);
  };

  const onPlaybackRateChange = (event) => {
    const nextRate = Number(event.target.value) || 1;
    setPlayerSpeed(nextRate);
    const audioEl = audioRef.current;
    if (!audioEl) return;
    audioEl.playbackRate = nextRate;
  };

  useEffect(() => {
    if (!sourceId || !transcriptTargetUrl || !activeEpisode?.audioUrl) {
      setTranscriptSaved(false);
      return;
    }
    let cancelled = false;
    const run = async () => {
      try {
        const query = `?pageUrl=${encodeURIComponent(transcriptTargetUrl)}`;
        const res = await fetch(apiUrl(`/api/sources/${sourceId}/podcast-transcript-status${query}`), { headers: authHeader() });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Failed to load transcript status.");
        if (cancelled) return;
        const saved = Boolean(data.saved && data.transcript?.text);
        setTranscriptSaved(saved);
        if (saved) {
          setTranscriptText(String(data.transcript?.text || "").trim());
          setTranscriptRequestedForUrl(transcriptTargetUrl);
          setTranscriptError("");
        }
      } catch {
        if (cancelled) return;
        setTranscriptSaved(false);
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [sourceId, transcriptTargetUrl, activeEpisode?.audioUrl]);

  const requestTranscript = async () => {
    if (transcriptLoading) return;
    if (!sourceId || !transcriptTargetUrl) return;
    if (!activeEpisode?.audioUrl) {
      setTranscriptError("No audio file was found for this episode.");
      setTranscriptText("");
      setTranscriptRequestedForUrl(transcriptTargetUrl);
      return;
    }
    setTranscriptLoading(true);
    setTranscriptError("");
    try {
      const query = `?pageUrl=${encodeURIComponent(transcriptTargetUrl)}`;
      const res = await fetch(apiUrl(`/api/sources/${sourceId}/podcast-transcript${query}`), { headers: authHeader() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to transcribe this episode.");
      setTranscriptText(String(data.transcript?.text || "").trim());
      setTranscriptRequestedForUrl(transcriptTargetUrl);
      setTranscriptSaved(true);
    } catch (err) {
      setTranscriptError(err.message || "Failed to transcribe this episode.");
      setTranscriptText("");
      setTranscriptRequestedForUrl(transcriptTargetUrl);
      setTranscriptSaved(false);
    } finally {
      setTranscriptLoading(false);
    }
  };

  const deleteTranscript = async () => {
    if (transcriptDeleting || !sourceId || !transcriptTargetUrl) return;
    setTranscriptDeleting(true);
    setTranscriptError("");
    try {
      const query = `?pageUrl=${encodeURIComponent(transcriptTargetUrl)}`;
      const res = await fetch(apiUrl(`/api/sources/${sourceId}/podcast-transcript${query}`), {
        method: "DELETE",
        headers: authHeader(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to delete this transcript.");
      setTranscriptSaved(false);
      setTranscriptText("");
      setTranscriptRequestedForUrl(transcriptTargetUrl);
    } catch (err) {
      setTranscriptError(err.message || "Failed to delete this transcript.");
    } finally {
      setTranscriptDeleting(false);
    }
  };

  const adjustTranscriptFontSize = (delta) => {
    setTranscriptFontSize((current) => Math.min(24, Math.max(12, current + delta)));
  };

  const getTranscriptSpeechService = () => {
    const nextProviderId = readTtsProviderId();
    if (nextProviderId !== transcriptSpeechProviderIdRef.current) {
      transcriptSpeechServiceRef.current.stop();
      transcriptSpeechProviderIdRef.current = nextProviderId;
      transcriptSpeechServiceRef.current = createLocalAvatarSpeechService(createTtsProviderFor(nextProviderId));
    }
    return transcriptSpeechServiceRef.current;
  };

  const toggleTranscriptSpeech = () => {
    const transcriptBody = String(transcriptText || "").trim();
    if (!transcriptBody) return;
    if (transcriptTtsStatus === "creating" || transcriptTtsStatus === "speaking") {
      transcriptSpeakTokenRef.current += 1;
      transcriptSpeechServiceRef.current.stop();
      setTranscriptTtsStatus("idle");
      return;
    }
    const speakToken = transcriptSpeakTokenRef.current + 1;
    transcriptSpeakTokenRef.current = speakToken;
    const speechService = getTranscriptSpeechService();
    const { language, voiceURI, voiceProfileId, kokoroVoice, supertonicVoice } = readVoiceSettings();
    const transcriptChunks = splitTranscriptForTts(transcriptBody);
    if (!transcriptChunks.length) return;
    unlockBrowserSpeech();
    speechService.unlockAudio?.();
    setTranscriptTtsStatus("creating");
    setTranscriptError("");
    speechService.stop();
    void (async () => {
      for (const chunk of transcriptChunks) {
        if (transcriptSpeakTokenRef.current !== speakToken) return;
        await speechService.speak(chunk, {
          language,
          voice: voiceURI,
          voiceProfileId,
          kokoroVoice,
          supertonicVoice,
          onSynthesisStart: () => {
            if (transcriptSpeakTokenRef.current === speakToken) {
              setTranscriptTtsStatus("creating");
            }
          },
          onPlaybackStart: () => {
            if (transcriptSpeakTokenRef.current === speakToken) {
              setTranscriptTtsStatus("speaking");
            }
          },
        });
      }
    })().catch((error) => {
      console.error("[PodcastTranscriptTTS] failed:", error);
      if (transcriptSpeakTokenRef.current === speakToken) {
        setTranscriptError(error?.message || "Transcript TTS failed.");
      }
    }).finally(() => {
      if (transcriptSpeakTokenRef.current === speakToken) {
        setTranscriptTtsStatus("idle");
      }
    });
  };

  const transcriptTtsBusy = transcriptTtsStatus === "creating" || transcriptTtsStatus === "speaking";
  const transcriptTtsLabel = transcriptTtsStatus === "creating"
    ? "Creating..."
    : transcriptTtsStatus === "speaking"
      ? "Stop"
      : "TTS";

  useEffect(() => {
    if (!sourceId) return;
    if (!transcriptFontSizeHydratedRef.current) {
      transcriptFontSizeHydratedRef.current = true;
      return;
    }
    let cancelled = false;
    const timeoutId = window.setTimeout(async () => {
      try {
        const res = await fetch(apiUrl(`/api/sources/${sourceId}/podcast-reader`), {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            ...authHeader(),
          },
          body: JSON.stringify({ transcriptFontSize }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Failed to save transcript font size.");
        if (cancelled) return;
        setSource((prev) => (prev ? {
          ...prev,
          podcastReader: {
            ...(prev.podcastReader || {}),
            transcriptFontSize: data.podcastReader?.transcriptFontSize || transcriptFontSize,
          },
        } : prev));
      } catch {
        // Keep the local font size even if persistence fails.
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [sourceId, transcriptFontSize]);

  return (
    <div id="podcast_page">
      <div id="podcast_header">
        <button type="button" id="podcast_back_btn" onClick={() => navigate("/sources")}>←</button>
        <button
          type="button"
          id="podcast_aside_toggle"
          onClick={() => setAsideOpen((open) => !open)}
          aria-label={asideOpen ? "Close episodes panel" : "Open episodes panel"}
          aria-expanded={asideOpen}
        >
          <i className={`bx ${asideOpen ? "bx-chevron-left" : "bx-chevron-right"}`} />
        </button>
        <div id="podcast_header_badge" aria-hidden="true">
          <i className="bx bxs-waveform" />
        </div>
        <div id="podcast_header_copy">
          <div id="podcast_header_topline">
            <span id="podcast_header_label">Podcast Source</span>
            {sourceHostLabel ? <span className="podcast_header_chip">{sourceHostLabel}</span> : null}
          </div>
          <strong id="podcast_header_title">{displaySourceTitle}</strong>
          <div id="podcast_header_meta">
            {archiveData?.kind === "collection" ? (
              <span className="podcast_header_chip podcast_header_chip--soft">
                {categoryOptions.length} categories
              </span>
            ) : null}
            <span className="podcast_header_chip podcast_header_chip--soft">{headerMeta}</span>
            {archiveData?.kind === "collection" ? (
              <span className="podcast_header_chip podcast_header_chip--soft">
                {totalArchiveEpisodes || archiveEpisodes.length} episode{(totalArchiveEpisodes || archiveEpisodes.length) === 1 ? "" : "s"} in this archive
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div id="podcast_workspace" className={asideOpen ? "" : "podcast_workspace--aside_closed"}>
        <aside id="podcast_aside" aria-hidden={asideOpen ? undefined : "true"}>
          <div id="podcast_aside_head">
            <div className="podcast_section_label">Episodes</div>
            {archiveData?.kind === "collection" ? (
              <>
                <select
                  id="podcast_category_select"
                  value={selectedCategory?.url || ""}
                  onChange={(event) => {
                    const nextUrl = String(event.target.value || "").trim();
                    if (!nextUrl) return;
                    setVisibleArchivePageCount(1);
                    setArchivePageUrl(nextUrl);
                  }}
                  disabled={categoriesLoading || !categoryOptions.length}
                >
                  {categoryOptions.map((entry) => (
                    <option key={entry.id || entry.url} value={entry.url}>
                      {entry.parentLabel ? `${entry.parentLabel} / ${entry.label}` : entry.label}
                    </option>
                  ))}
                </select>
                {categoriesError ? (
                  <div className="podcast_aside_meta_error">{categoriesError}</div>
                ) : null}
              </>
            ) : (
              null
            )}
          </div>

          <div id="podcast_aside_body">
            {archiveLoading ? (
              <div className="podcast_status">Loading source…</div>
            ) : archiveError ? (
              <div className="podcast_status podcast_status--error">{archiveError}</div>
            ) : archiveData?.kind === "collection" ? (
              <>
                {archiveSyncError ? (
                  <div className="podcast_status podcast_status--error">{archiveSyncError}</div>
                ) : null}
                <div id="podcast_episode_list">
                  {archiveEpisodes.map((entry, index) => {
                    const isActive = entry.url === selectedEpisodeUrl;
                    const pageOrder = index + 1;
                    return (
                      <button
                        key={entry.id || `${index}-${entry.url}`}
                        type="button"
                        className={`podcast_episode_nav ${isActive ? "podcast_episode_nav--active" : ""}`}
                        onClick={() => setSelectedEpisodeUrl(entry.url || "")}
                      >
                        <div className="podcast_episode_nav_top">
                          <span className="podcast_episode_index">
                            <span className="podcast_episode_index_global">{pageOrder}</span>
                            <span className="podcast_episode_index_page">p{pageOrder}</span>
                          </span>
                          <span className="podcast_episode_nav_title">{entry.title || "Untitled episode"}</span>
                        </div>
                        <div className="podcast_episode_meta">
                          {formatPublished(entry.publishedAt) || "Undated"}
                        </div>
                        {entry.description ? (
                          <p className="podcast_episode_nav_description">{entry.description}</p>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
                {visibleArchivePageCount < archivePages.length ? (
                  <button
                    type="button"
                    id="podcast_load_more_btn"
                    onClick={() => setVisibleArchivePageCount((count) => Math.min(count + 1, archivePages.length))}
                  >
                    Load more episodes
                  </button>
                ) : null}
              </>
            ) : (
              <div className="podcast_status">
                This source opens directly as one episode, so there is no archive list on the left.
              </div>
            )}
          </div>
        </aside>

        <main id="podcast_main">
          {episodeLoading ? (
            <div className="podcast_status">Loading episode…</div>
          ) : episodeError ? (
            <div className="podcast_status podcast_status--error">{episodeError}</div>
          ) : activeEpisode ? (
            <section id="podcast_text_card">
              <div id="podcast_transcript_head">
                <div className="podcast_section_label">Episode Transcript</div>
                <div id="podcast_transcript_actions">
                  <button
                    type="button"
                    id="podcast_transcript_tts_btn"
                    onClick={toggleTranscriptSpeech}
                    disabled={!transcriptText || transcriptLoading}
                    aria-label={
                      transcriptTtsStatus === "creating"
                        ? "Creating transcript text to speech"
                        : transcriptTtsStatus === "speaking"
                          ? "Stop transcript text to speech"
                          : "Play transcript text to speech"
                    }
                    aria-pressed={transcriptTtsBusy}
                    data-status={transcriptTtsStatus}
                  >
                    <i className={`bx ${transcriptTtsStatus === "speaking" ? "bx-stop-circle" : "bx-volume-full"} ${transcriptTtsStatus === "creating" ? "podcast_tts_icon_spin" : ""}`} />
                    <span>{transcriptTtsLabel}</span>
                  </button>
                  <div id="podcast_transcript_fontsize" aria-label="Transcript font size">
                    <button type="button" onClick={() => adjustTranscriptFontSize(-1)} aria-label="Decrease transcript font size">A-</button>
                    <span>{transcriptFontSize}px</span>
                    <button type="button" onClick={() => adjustTranscriptFontSize(1)} aria-label="Increase transcript font size">A+</button>
                  </div>
                  {transcriptSaved ? (
                    <>
                      <span id="podcast_transcript_saved">Saved</span>
                      <button
                        type="button"
                        id="podcast_transcript_delete_btn"
                        onClick={deleteTranscript}
                        disabled={transcriptDeleting}
                      >
                        {transcriptDeleting ? "Deleting..." : "Delete"}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      id="podcast_transcribe_btn"
                      onClick={requestTranscript}
                      disabled={transcriptLoading || !sourceId || !transcriptTargetUrl || !activeEpisode?.audioUrl}
                    >
                      {transcriptLoading ? "Transcribing..." : "Transcribe"}
                    </button>
                  )}
                </div>
              </div>
              <div id="podcast_text_body" style={{ fontSize: `${transcriptFontSize}px` }}>
                {transcriptLoading
                  ? (
                    <div id="podcast_transcript_loader" role="status" aria-live="polite">
                      <span id="podcast_transcript_spinner" aria-hidden="true" />
                      <div id="podcast_transcript_loader_copy">
                        <strong>Generating transcript</strong>
                        <span>Extracting speech from the episode audio and shaping it into readable text.</span>
                      </div>
                    </div>
                  )
                  : transcriptError
                    ? transcriptError
                    : transcriptText
                      ? transcriptText
                      : transcriptRequestedForUrl === activeEpisode.url
                        ? "No transcript was generated for this episode yet."
                        : "Press Transcribe to generate the episode transcript."}
              </div>
            </section>
          ) : archiveLoading ? null : (
            <div className="podcast_status">
              Pick an episode from the left to open it here.
            </div>
          )}
        </main>
      </div>

      <div id="podcast_footer_player">
        {activeEpisode?.audioUrl ? (
          <>
            <div id="podcast_footer_player_copy">
              <div id="podcast_footer_player_label">Now Playing</div>
              <div id="podcast_footer_player_title">{activeEpisodeTitle}</div>
            </div>
            <div id="podcast_player_shell">
              <audio
                ref={audioRef}
                id="podcast_player"
                preload="none"
                src={activeEpisode.audioUrl}
                onPlay={() => setPlayerPlaying(true)}
                onPause={() => setPlayerPlaying(false)}
                onEnded={() => {
                  setPlayerPlaying(false);
                  setPlayerCurrentTime(0);
                }}
                onLoadedMetadata={(event) => {
                  const nextDuration = Number(event.currentTarget.duration) || 0;
                  setPlayerDuration(nextDuration);
                }}
                onTimeUpdate={(event) => {
                  setPlayerCurrentTime(Number(event.currentTarget.currentTime) || 0);
                }}
                onDurationChange={(event) => {
                  const nextDuration = Number(event.currentTarget.duration) || 0;
                  setPlayerDuration(nextDuration);
                }}
              />
              <button
                type="button"
                className="podcast_player_action"
                onClick={() => skipPlaybackBy(-10)}
                aria-label="Skip backward 10 seconds"
              >
                <i className="bx bx-rewind-circle" />
                <span>-10</span>
              </button>
              <button
                type="button"
                id="podcast_player_toggle"
                onClick={togglePlayback}
                aria-label={playerPlaying ? "Pause audio" : "Play audio"}
              >
                <i className={`bx ${playerPlaying ? "bx-pause" : "bx-play"}`} />
              </button>
              <button
                type="button"
                className="podcast_player_action"
                onClick={() => skipPlaybackBy(10)}
                aria-label="Skip forward 10 seconds"
              >
                <i className="bx bx-fast-forward-circle" />
                <span>+10</span>
              </button>
              <div id="podcast_player_timeline">
                <input
                  type="range"
                  id="podcast_player_seek"
                  min="0"
                  max={playerDuration || 0}
                  step="0.1"
                  value={Math.min(playerCurrentTime, playerDuration || 0)}
                  onChange={onSeek}
                />
                <div id="podcast_player_progress_track" aria-hidden="true">
                  <span id="podcast_player_progress_fill" style={{ width: `${playerProgress}%` }} />
                </div>
              </div>
              <div id="podcast_player_time">
                <span>{formatPlayerTime(playerCurrentTime)}</span>
                <span>/</span>
                <span>{formatPlayerTime(playerDuration)}</span>
              </div>
              <label id="podcast_player_speed">
                <span>Speed</span>
                <select value={playerSpeed} onChange={onPlaybackRateChange} aria-label="Playback speed">
                  <option value="0.75">0.75x</option>
                  <option value="1">1x</option>
                  <option value="1.25">1.25x</option>
                  <option value="1.5">1.5x</option>
                  <option value="2">2x</option>
                </select>
              </label>
            </div>
          </>
        ) : (
          <div className="podcast_status">No audio file was found for the current episode yet.</div>
        )}
      </div>
    </div>
  );
};

export default PodcastPage;
