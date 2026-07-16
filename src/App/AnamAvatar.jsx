import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { createClient, AnamEvent } from "@anam-ai/js-sdk";
import { apiUrl } from "../config/api";
import { readStoredSession } from "../utils/sessionCleanup";
import "./anamAvatar.css";

const VIDEO_ELEMENT_ID = "anam_avatar_video";

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
  const [status, setStatus] = useState("connecting"); // connecting | live | error | unconfigured

  useImperativeHandle(ref, () => ({
    // One chunk of an in-progress assistant reply — lazily opens a talk
    // stream on the first chunk of each turn (see endMessage, which clears
    // talkStreamRef so the next turn's first chunk opens a fresh one).
    streamChunk(text) {
      if (status !== "live" || !clientRef.current || !text) return;
      try {
        if (!talkStreamRef.current) {
          talkStreamRef.current = clientRef.current.createTalkMessageStream();
        }
        if (talkStreamRef.current.isActive()) {
          talkStreamRef.current.streamMessageChunk(text, false);
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
        client.addListener(AnamEvent.CONNECTION_ESTABLISHED, () => { if (!cancelled) setStatus("live"); });
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
