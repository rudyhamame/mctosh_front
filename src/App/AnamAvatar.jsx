import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { createClient, AnamEvent } from "@anam-ai/js-sdk";
import { apiUrl } from "../config/api";
import { readStoredSession } from "../utils/sessionCleanup";
import "./anamAvatar.css";

const VIDEO_ELEMENT_ID = "anam_avatar_video";

// Spoken once, the instant the avatar connects — greets the user and
// signals it's ready for their own spoken question (see HomeChat.jsx's
// auto-engaged voice call, which starts listening as soon as the panel
// opens — no separate "start call" click needed). Exported so HomeChat.jsx
// can reuse the exact same wording for its own idle/pre-call caption text.
export const AVATAR_GREETING = "Hi, I'm AMCTOSHS AI. I'm listening — go ahead and ask me anything.";

// TTS engines (both Anam's and the browser's own, see HomeChat.jsx's
// speak()) don't know "AMCTOSHS" is an acronym-turned-word and guess at it
// letter-by-letter or otherwise oddly — respelled phonetically so it comes
// out "AMEK-TOSH-S" instead. Applied only to text actually SENT to a speech
// engine; anything displayed on screen keeps the real spelling. Exported so
// both speech paths (the avatar's own talk stream here, and the browser-TTS
// fallback in HomeChat.jsx) apply the identical substitution.
export const speakableText = (text) => String(text || "").replace(/AMCTOSHS/gi, "Amek Tosh Ess");

// The face/voice layer for Dev AI (see HomeChat.jsx) — MCTOSH's own AI stays
// the brain. The reply text still comes entirely from
// /api/ai/context-chat's SSE stream, same as before; this component's only
// job is to relay that same text to Anam (via streamChunk/endMessage, see
// the imperative handle below) so Anam's hosted avatar speaks it with
// lip-synced video+voice instead of the reply sitting there as silent text.
// Requires the backend's ANAM_API_KEY (+ ANAM_PERSONA_ID, or
// ANAM_AVATAR_ID/ANAM_VOICE_ID) — see back/routes/AnamAPI.js. If a saved
// lab.anam.ai persona is used via ANAM_PERSONA_ID, its own brain must be set
// to "Custom LLM (client-side)" there, or Anam's built-in LLM would also try
// to answer on top of MCTOSH's reply.
const AnamAvatar = forwardRef((_props, ref) => {
  const clientRef = useRef(null);
  const talkStreamRef = useRef(null);
  const greetedRef = useRef(false); // once per mount — a re-render must never repeat the greeting
  const [status, setStatus] = useState("connecting"); // connecting | live | error | unconfigured

  useImperativeHandle(ref, () => ({
    // Whether Anam is actually live right now — VoiceCall (HomeChat.jsx)
    // checks this to decide whether IT still needs to speak the reply
    // itself (browser TTS fallback) or whether the avatar already has that
    // covered, so the two never talk over each other.
    isLive() {
      return status === "live";
    },
    // One chunk of an in-progress assistant reply — lazily opens a talk
    // stream on the first chunk of each turn (see endMessage, which clears
    // talkStreamRef so the next turn's first chunk opens a fresh one).
    // speakableText is applied per-chunk, so the rare case of "AMCTOSHS"
    // itself getting split across two SSE deltas won't get respelled — an
    // accepted gap, not worth buffering across chunk boundaries for.
    streamChunk(text) {
      if (status !== "live" || !clientRef.current || !text) return;
      try {
        if (!talkStreamRef.current) {
          talkStreamRef.current = clientRef.current.createTalkMessageStream();
        }
        if (talkStreamRef.current.isActive()) {
          talkStreamRef.current.streamMessageChunk(speakableText(text), false);
        }
      } catch {
        // Best-effort — a dropped chunk just means the avatar goes briefly
        // quiet; the text reply in the chat panel is unaffected either way.
      }
    },
    // Closes out the current turn's talk stream once MCTOSH's own reply has
    // finished streaming (called from useContextChat in HomeChat.jsx).
    endMessage() {
      try {
        if (talkStreamRef.current?.isActive()) talkStreamRef.current.endMessage();
      } catch {
        // Non-fatal — stream is discarded either way below.
      }
      talkStreamRef.current = null;
    },
  }), [status]);

  useEffect(() => {
    let cancelled = false;

    const connect = async () => {
      const token = readStoredSession()?.token || "";
      try {
        const res = await fetch(apiUrl("/api/anam/session-token"), {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const data = await res.json();
        if (!res.ok) {
          if (!cancelled) setStatus(res.status === 503 ? "unconfigured" : "error");
          return;
        }
        if (cancelled) return;

        const client = createClient(data.sessionToken);
        clientRef.current = client;
        client.addListener(AnamEvent.CONNECTION_ESTABLISHED, () => {
          if (cancelled) return;
          setStatus("live");
          if (!greetedRef.current) {
            greetedRef.current = true;
            client.talk(speakableText(AVATAR_GREETING)).catch(() => {
              // Best-effort — a missed greeting just means it opens quietly,
              // the video/mic are unaffected either way.
            });
          }
        });
        client.addListener(AnamEvent.CONNECTION_CLOSED, () => { if (!cancelled) setStatus("error"); });
        await client.streamToVideoElement(VIDEO_ELEMENT_ID);
      } catch {
        if (!cancelled) setStatus("error");
      }
    };

    connect();

    return () => {
      cancelled = true;
      try { clientRef.current?.stopStreaming(); } catch {
        // Unmounting anyway — nothing left to clean up on failure.
      }
      clientRef.current = null;
      talkStreamRef.current = null;
    };
  }, []);

  return (
    <div className="anam_avatar">
      <video id={VIDEO_ELEMENT_ID} className="anam_avatar_video" autoPlay playsInline />
      {status !== "live" && (
        <div className="anam_avatar_status">
          {status === "connecting" && "Connecting avatar…"}
          {status === "error" && "Avatar unavailable — text chat still works."}
          {status === "unconfigured" && "Avatar not configured."}
        </div>
      )}
    </div>
  );
});

AnamAvatar.displayName = "AnamAvatar";

export default AnamAvatar;
