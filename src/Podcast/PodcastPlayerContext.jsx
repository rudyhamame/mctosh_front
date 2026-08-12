import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./podcastPlayerFooter.css";

const PodcastPlayerContext = createContext(null);

export const PodcastPlayerProvider = ({ children }) => {
  const audioRef = useRef(null);
  const [track, setTrack] = useState(null);

  const sendToFooter = useCallback(({ url, title, sourceId, episodeUrl, currentTime = 0, duration = 0, speed = 1, playing = false }) => {
    if (url) setTrack({ url, title: title || "Podcast episode", sourceId, episodeUrl, currentTime, duration, speed, playing });
  }, []);

  const toggleFooterPlayback = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      try { await audio.play(); } catch { setTrack((current) => current && ({ ...current, playing: false })); }
    } else audio.pause();
  }, []);

  const updateFooterTime = useCallback((event) => {
    const currentTime = Number(event.target.value) || 0;
    if (audioRef.current) audioRef.current.currentTime = currentTime;
    setTrack((current) => current && ({ ...current, currentTime }));
  }, []);

  const closeFooterPlayer = useCallback(() => {
    audioRef.current?.pause();
    setTrack(null);
  }, []);

  return (
    <PodcastPlayerContext.Provider value={{ track, setTrack, audioRef, sendToFooter }}>
      {children}
    </PodcastPlayerContext.Provider>
  );
};

export const PodcastPlayerFooter = () => {
  const { track, audioRef, setTrack } = usePodcastPlayer();
  const navigate = useNavigate();
  const onToggle = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      try { await audio.play(); } catch { setTrack((current) => current && ({ ...current, playing: false })); }
    } else audio.pause();
  };
  const onSeek = (event) => {
    const currentTime = Number(event.target.value) || 0;
    if (audioRef.current) audioRef.current.currentTime = currentTime;
    setTrack((current) => current && ({ ...current, currentTime }));
  };
  const onClose = () => {
    audioRef.current?.pause();
    setTrack(null);
  };
  const openPodcast = () => {
    if (track.sourceId) navigate(`/podcast/${track.sourceId}`, { state: { sourceId: track.sourceId, sourceUrl: track.episodeUrl, episodeUrl: track.episodeUrl } });
  };
  if (!track) return null;
  const formatTime = (value) => {
    const total = Math.max(0, Math.floor(Number(value) || 0));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
  };
  return (
    <div className="podcast_footer_mini_player" role="region" aria-label="Podcast mini player" onClick={openPodcast}>
      <audio
        ref={audioRef}
        src={track.url}
        preload="metadata"
        onLoadedMetadata={(event) => {
          const audio = event.currentTarget;
          audio.currentTime = Math.min(track.currentTime || 0, audio.duration || track.currentTime || 0);
          audio.playbackRate = track.speed || 1;
          if (track.playing) audio.play().catch(() => setTrack((current) => current && ({ ...current, playing: false })));
          setTrack((current) => current && ({ ...current, duration: Number(audio.duration) || current.duration }));
        }}
        onPlay={() => setTrack((current) => current && ({ ...current, playing: true }))}
        onPause={() => setTrack((current) => current && ({ ...current, playing: false }))}
        onTimeUpdate={(event) => {
          const currentTime = Number(event.currentTarget?.currentTime) || 0;
          setTrack((current) => current && ({ ...current, currentTime }));
        }}
        onEnded={() => setTrack((current) => current && ({ ...current, playing: false, currentTime: 0 }))}
      />
      <span className="podcast_footer_mini_icon"><i className="fi fi-rr-headphones" /></span>
      <span className="podcast_footer_mini_title" title={track.title}>{track.title}</span>
      <button type="button" className="podcast_footer_mini_action" onClick={(event) => { event.stopPropagation(); onToggle(); }} aria-label={track.playing ? "Pause podcast" : "Play podcast"}>
        <i className={`bx ${track.playing ? "bx-pause" : "bx-play"}`} />
      </button>
      <input className="podcast_footer_mini_seek" type="range" min="0" max={track.duration || 0} step="0.1" value={Math.min(track.currentTime || 0, track.duration || 0)} onClick={(event) => event.stopPropagation()} onChange={onSeek} aria-label="Seek podcast" />
      <span className="podcast_footer_mini_time">{formatTime(track.currentTime)} / {formatTime(track.duration)}</span>
      <button type="button" className="podcast_footer_mini_action" onClick={(event) => { event.stopPropagation(); onClose(); }} aria-label="Close podcast mini player" title="Close podcast mini player"><i className="fi fi-rr-cross-small" /></button>
    </div>
  );
};

export const usePodcastPlayer = () => {
  const context = useContext(PodcastPlayerContext);
  if (!context) throw new Error("usePodcastPlayer must be used within PodcastPlayerProvider");
  return context;
};
