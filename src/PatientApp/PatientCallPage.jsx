import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Room, RoomEvent } from "livekit-client";
import { apiUrl } from "../config/api";
import { readStoredPatientSession } from "../utils/patientSessionCleanup";
import TalkingHead from "./TalkingHead";
import "./patientApp.css";

const authHeaders = (json = true) => {
  const token = readStoredPatientSession()?.token || "";
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  if (json) headers["Content-Type"] = "application/json";
  return headers;
};

// MCTOSHS's own turn-taking state, published by the LiveKit Agents
// framework as the "lk.agent.state" room attribute on its participant
// (initializing/idle/listening/thinking/speaking — automatic, not
// something back/agent/patientCallAgent.js sets itself). "stuck" is the
// one value that IS set manually, by that same file, when the agent
// session dies mid-call from an unrecoverable error — without it the
// patient would just see/hear nothing with no explanation.
const AGENT_STATE_LABELS = {
  initializing: "Connecting…",
  idle:         "Listening",
  listening:    "Listening",
  thinking:     "Thinking",
  speaking:     "Speaking",
  stuck:        "Stuck",
};

const AVATAR_OPTIONS = [
  { id: "female", label: "Female Avatar" },
  { id: "male", label: "Male Avatar" },
];

// idle -> connecting -> in-call -> ended
const PatientCallPage = () => {
  const navigate = useNavigate();
  const session = readStoredPatientSession();
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [muted, setMuted] = useState(false);
  // Text side of the same LiveKit call — sent/received over the room's
  // "lk.chat" text-stream topic (see back/agent/patientCallAgent.js), not a
  // separate channel. Available whenever connected, whether or not the
  // patient is also speaking.
  const [messages,   setMessages]   = useState([]);
  const [chatInput,  setChatInput]  = useState("");
  const [avatar, setAvatar] = useState("female");
  // Required on every call start (see PatientCallAPI.js's /start) — the
  // same stable "mctosh#N" id shown at signup and returned on every login
  // (readStoredPatientSession, below), not a one-time secret, so it's
  // safe to pre-fill from the session as a convenience.
  const [patientCode, setPatientCode] = useState(session?.patientId || "");
  // Conversation language toggle — sent to the backend at call start (see
  // startCall below) and locked in for that call via dispatch metadata
  // (back/agent/patientCallAgent.js). Only the live conversation switches;
  // whatever MCTOSHS records into the patient's profile (recordField) is
  // always translated to English regardless of this setting, since the
  // clinician-side patient instantiation page is English-only.
  const [language, setLanguage] = useState("en");
  // MCTOSHS's turn-taking state — see AGENT_STATE_LABELS above.
  const [agentState, setAgentState] = useState("");
  const roomRef = useRef(null);
  const audioRef = useRef(null);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  useEffect(() => () => {
    // Leave the call cleanly if the patient navigates away mid-call.
    roomRef.current?.disconnect();
  }, []);

  useEffect(() => {
    document.documentElement.classList.add("pa_route_html");
    document.body.classList.add("pa_route_body");
    document.getElementById("root")?.classList.add("pa_route_root");

    return () => {
      document.documentElement.classList.remove("pa_route_html");
      document.body.classList.remove("pa_route_body");
      document.getElementById("root")?.classList.remove("pa_route_root");
    };
  }, []);

  const startCall = async () => {
    if (!patientCode.trim()) {
      setError("Enter your patient ID to start a call.");
      return;
    }
    setError("");
    setStatus("connecting");
    setMessages([]);
    setAgentState("initializing");
    try {
      const res = await fetch(apiUrl("/api/patient-calls/start"), {
        method: "POST", headers: authHeaders(true), body: JSON.stringify({ avatar, patientId: patientCode.trim(), language }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "Could not start the call.");
        setStatus("idle");
        return;
      }

      const room = new Room();
      roomRef.current = room;

      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind !== "audio") return;
        const el = track.attach();
        if (audioRef.current) {
          audioRef.current.srcObject = el.srcObject;
          audioRef.current.play().catch(() => {});
        }
      });
      room.on(RoomEvent.Disconnected, () => {
        setStatus("ended");
      });

      // MCTOSHS's turn-taking state — read the initial value as soon as
      // its participant joins (attributes may already be set by then),
      // then track live changes the same way.
      room.on(RoomEvent.ParticipantConnected, (participant) => {
        const state = participant.attributes?.["lk.agent.state"];
        if (state) setAgentState(state);
      });
      room.on(RoomEvent.ParticipantAttributesChanged, (changedAttributes) => {
        const state = changedAttributes["lk.agent.state"];
        if (state) setAgentState(state);
      });

      // Text side of the call — MCTOSHS's replies arrive here regardless of
      // whether this particular turn was spoken or typed (see
      // agent/patientCallAgent.js, which mirrors every assistant reply onto
      // this same topic), AND so does a transcript of anything the patient
      // SAID (typed messages are already shown locally by sendMessage
      // below, so the agent skips re-echoing those). Sent as {role, text}
      // JSON rather than bare text, since both sides come from the same
      // agent participant and the topic alone can't tell them apart.
      room.registerTextStreamHandler("lk.chat", async (reader) => {
        const raw = (await reader.readAll())?.trim();
        if (!raw) return;
        let role = "assistant";
        let text = raw;
        let interrupted = false;
        try {
          const parsed = JSON.parse(raw);
          if (parsed?.text) {
            role = parsed.role === "user" ? "user" : "assistant";
            text = parsed.text;
            interrupted = parsed.interrupted === true;
          }
        } catch {
          // Older/malformed payload — treat as a plain assistant message.
        }
        // Mark a barge-in reply visibly (not just the truncated words on
        // their own) — otherwise it reads as MCTOSHS's complete, deliberate
        // reply instead of a sentence the patient cut off mid-way.
        setMessages((prev) => [...prev, { from: role === "user" ? "patient" : "agent", text, interrupted }]);
      });

      await room.connect(data.url, data.token);

      // The agent's dispatch is kicked off before this call's token is even
      // issued (see PatientCallAPI.js's /start handler), so by the time
      // room.connect() above resolves the agent participant may ALREADY be
      // in the room — RoomEvent.ParticipantConnected only fires for joins
      // that happen after this point, so it would never fire for it and
      // agentState would stay stuck on the "initializing" placeholder set
      // above ("Connecting…" forever). Read anyone already present too.
      room.remoteParticipants.forEach((participant) => {
        const state = participant.attributes?.["lk.agent.state"];
        if (state) setAgentState(state);
      });

      await room.localParticipant.setMicrophoneEnabled(true);
      setStatus("in-call");
    } catch (err) {
      setError("Could not connect. Please check your microphone permissions and try again.");
      setStatus("idle");
      setAgentState("");
    }
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    const text = chatInput.trim();
    const room = roomRef.current;
    if (!text || !room) return;
    setChatInput("");
    setMessages((prev) => [...prev, { from: "patient", text }]);
    try {
      await room.localParticipant.sendText(text, { topic: "lk.chat" });
    } catch {
      setError("Message failed to send. Please try again.");
    }
  };

  const endCall = async () => {
    await roomRef.current?.disconnect();
    roomRef.current = null;
    setStatus("ended");
    setAgentState("");
  };

  const toggleMute = async () => {
    const room = roomRef.current;
    if (!room) return;
    const nextMuted = !muted;
    await room.localParticipant.setMicrophoneEnabled(!nextMuted);
    setMuted(nextMuted);
  };

  return (
    <div className="pa_call_page">
      <audio ref={audioRef} autoPlay />

      <div className="pa_call_layout">
        <section className="pa_call_stage">
          <div className="pa_stage_copy">
            <div className="pa_stage_topbar">
              <span className="pa_stage_eyebrow">Patient-side MCTOSHS AI</span>
              <button className="pa_logout_link" onClick={() => navigate("/patient/settings")}>Settings</button>
            </div>
            <h1 className="pa_stage_title">
              A living interface for the call.
            </h1>
            <p className="pa_call_status">
              {session?.firstName ? `Hi ${session.firstName}. ` : ""}
              {status === "idle" && "Ready when you are."}
              {status === "connecting" && "Connecting…"}
              {status === "in-call" && agentState !== "stuck" && "You're connected — speak or type, whichever you prefer."}
              {status === "in-call" && agentState === "stuck" && "MCTOSHS lost its train of thought — please end and start a new call."}
              {status === "ended" && "Call ended. Thank you."}
            </p>

            {(status === "in-call" || status === "connecting") && agentState && (
              <div className={`pa_agent_state pa_agent_state--${agentState}`}>
                <span className="pa_agent_state_dot" />
                {AGENT_STATE_LABELS[agentState] || agentState}
              </div>
            )}

            <div className="pa_avatar_picker" role="radiogroup" aria-label="Choose avatar">
              {AVATAR_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`pa_avatar_option ${avatar === option.id ? "pa_avatar_option--active" : ""}`}
                  onClick={() => setAvatar(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {error && <p className="pa_error">{error}</p>}
          </div>
          <TalkingHead
            audioElement={audioRef}
            active={status === "in-call" || status === "connecting"}
            agentState={agentState}
            avatar={avatar}
          />
        </section>

        <section className="pa_call_panel">
          <div className="pa_chat">
            <div className="pa_chat_header">
              <span className="pa_chat_header_label">Conversation</span>
              <div className="pa_lang_toggle" role="radiogroup" aria-label="Conversation language">
                <button
                  type="button"
                  className={`pa_lang_option ${language === "en" ? "pa_lang_option--active" : ""}`}
                  onClick={() => setLanguage("en")}
                  disabled={status === "in-call" || status === "connecting"}
                >
                  EN
                </button>
                <button
                  type="button"
                  className={`pa_lang_option ${language === "ar" ? "pa_lang_option--active" : ""}`}
                  onClick={() => setLanguage("ar")}
                  disabled={status === "in-call" || status === "connecting"}
                >
                  AR
                </button>
              </div>
            </div>
            <div className="pa_chat_messages" dir={language === "ar" ? "rtl" : "ltr"}>
              {messages.length === 0 && (
                <p className="pa_chat_empty">
                  {status === "in-call" ? "Type a message below, or just start speaking." : "Start a call to talk with MCTOSHS."}
                </p>
              )}
              {messages.map((m, i) => (
                <div key={i} className={`pa_chat_bubble pa_chat_bubble--${m.from}${m.interrupted ? " pa_chat_bubble--interrupted" : ""}`}>
                  {m.text}
                  {m.interrupted && <span className="pa_chat_interrupted_tag">cut off — you interrupted</span>}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
            <form className="pa_chat_form" onSubmit={sendMessage}>
              <input
                type="text"
                dir={language === "ar" ? "rtl" : "ltr"}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder={status === "in-call" ? "Type a message…" : "Start a call to unlock chat…"}
                autoComplete="off"
                disabled={status !== "in-call"}
              />
              <button type="submit" disabled={status !== "in-call" || !chatInput.trim()}>Send</button>
            </form>
          </div>

          <div className="pa_call_actions pa_call_actions--footer">
            {(status === "idle" || status === "ended") && (
              <input
                type="text"
                className="pa_patient_code_input"
                placeholder="Your patient ID"
                value={patientCode}
                onChange={e => setPatientCode(e.target.value)}
                autoComplete="off"
              />
            )}
            {status === "idle" && (
              <button className="pa_call_btn pa_call_btn--start" onClick={startCall}>Start call</button>
            )}
            {status === "connecting" && (
              <button className="pa_call_btn pa_call_btn--start" disabled>Connecting…</button>
            )}
            {status === "in-call" && (
              <>
                <button className="pa_call_btn pa_call_btn--mute" onClick={toggleMute}>
                  {muted ? "Unmute" : "Mute"}
                </button>
                <button className="pa_call_btn pa_call_btn--end" onClick={endCall}>End call</button>
              </>
            )}
            {status === "ended" && (
              <button className="pa_call_btn pa_call_btn--start" onClick={startCall}>Call again</button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};

export default PatientCallPage;
