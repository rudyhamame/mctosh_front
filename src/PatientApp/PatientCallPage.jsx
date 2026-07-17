import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Room, RoomEvent } from "livekit-client";
import { apiUrl } from "../config/api";
import { readStoredPatientSession } from "../utils/patientSessionCleanup";
import TalkingHead from "./TalkingHead";
import SymptomBodyMapPanel from "./SymptomBodyMapPanel";
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
  // Starts true (mic OFF) rather than false — see startCall below for why.
  const [muted, setMuted] = useState(true);
  // Text side of the same LiveKit call — sent/received over the room's
  // "lk.chat" text-stream topic (see back/agent/patientCallAgent.js), not a
  // separate channel. Available whenever connected, whether or not the
  // patient is also speaking.
  const [messages,   setMessages]   = useState([]);
  // A turn's text used to only appear once fully finalized (see the
  // "lk.chat" handler below, which only fires from ConversationItemAdded —
  // i.e. after the WHOLE turn is already committed). The framework actually
  // streams both sides live, word-by-word as they're spoken, on the
  // standard "lk.transcription" topic by default (RoomOutputOptions.
  // transcriptionEnabled/syncTranscription default to true — confirmed by
  // reading @livekit/agents' RoomIO source; no backend change needed) — this
  // was simply never listened to. liveCaption mirrors that in-progress text
  // as a transient bubble; it's cleared once the segment finalizes, at
  // which point the same content shows up permanently via "lk.chat" as
  // usual. Note the patient's OWN side won't visibly stream word-by-word
  // like the assistant's does, since STT here runs in non-realtime/REST
  // mode (one result per completed turn, no interim hypotheses) — but it
  // still now arrives over this same low-latency live channel rather than
  // waiting on the extra DB round trip the "lk.chat" mirror involves.
  const [liveCaption, setLiveCaption] = useState(null);
  const [chatInput,  setChatInput]  = useState("");
  const [avatar, setAvatar] = useState("female");
  const [symptomBodyMapRequest, setSymptomBodyMapRequest] = useState(null);
  const [patientGender, setPatientGender] = useState(session?.gender || "");
  // Required on every call start (see PatientCallAPI.js's /start) — the
  // same stable "mctosh#N" id shown at signup and returned on every login
  // (readStoredPatientSession, below). No longer a visible/editable field
  // (see the removed input above the Start call button) since it's always
  // exactly this logged-in patient's own id — there was never a real case
  // for typing a different one in here.
  const patientCode = session?.patientId || "";
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
  }, [messages, liveCaption]);

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
      setError("Your patient ID could not be found — please log out and back in.");
      return;
    }
    setError("");
    setStatus("connecting");
    setMessages([]);
    setLiveCaption(null);
    setAgentState("initializing");
    setSymptomBodyMapRequest(null);
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
      setPatientGender(data?.patientGender || session?.gender || "");

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
        roomRef.current = null;
        setStatus("ended");
        setAgentState("");
      });

      // MCTOSHS's turn-taking state — read the initial value as soon as
      // its participant joins (attributes may already be set by then),
      // then track live changes the same way. When MCTOSHS ends the call
      // itself (see back/agent/patientCallAgent.js's finishCallTool), it
      // deletes the LiveKit room outright rather than publishing a state
      // for this side to react to — that force-disconnects every
      // participant, including this one, so RoomEvent.Disconnected above
      // fires on its own with no extra signal needed here.
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
          if (parsed?.type === "symptom_body_map_request") {
            setSymptomBodyMapRequest(parsed);
            return;
          }
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

      // Live, in-progress captioning — see liveCaption's own declaration
      // above for why this is a separate topic/handler from "lk.chat"
      // rather than a replacement for it. `identity` tells us whose speech
      // this segment is: the framework publishes the patient's own
      // transcript under the PATIENT's identity (i.e. this browser's own
      // localParticipant.identity) and the assistant's under the agent
      // participant's identity, even though both are technically sent by
      // the agent process (the only participant with room-write access) —
      // same distinguishing logic as the "role" field in the "lk.chat"
      // JSON payload above, just keyed off identity instead since this
      // topic carries plain text, not JSON.
      room.registerTextStreamHandler("lk.transcription", async (reader, { identity }) => {
        const from = identity === room.localParticipant.identity ? "patient" : "agent";
        try {
          for await (const text of reader) {
            setLiveCaption({ from, text });
          }
        } catch {
          // Stream aborted/errored mid-segment (e.g. an interruption cut it
          // short) — drop the in-progress caption rather than leave a
          // stale one on screen.
          setLiveCaption(null);
          return;
        }
        // The agent's captions are one long-lived stream per turn (the SDK
        // publishes them as a delta stream) — this loop only exits once
        // that stream actually closes, i.e. the turn is genuinely done, so
        // it's always safe to clear here. The patient's own captions are
        // the opposite: EVERY update (interim or final) is its own
        // short-lived stream, so this loop exits after each one — only the
        // "lk.transcription_final" attribute (set only on the true last
        // one) tells them apart. Clearing unconditionally here would wipe
        // the caption between every interim update instead of leaving it
        // up until the real final one.
        if (from === "agent" || reader.info?.attributes?.["lk.transcription_final"] === "true") {
          setLiveCaption(null);
        }
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

      // Mic starts OFF, not on — it used to be enabled unconditionally the
      // moment the call connected, which meant it stayed live picking up
      // background noise for the entire call unless the patient thought to
      // mute it themselves. Confirmed against real calls, TWICE: OpenAI's
      // transcription model hallucinated a short, clean-sounding word
      // ("Divorced") out of silence/noise and it got attributed to the
      // patient as something they'd actually said, interrupting MCTOSHS's
      // own reply — with the patient having said and typed nothing at all
      // at that point. Muting-after-send (see sendMessage) only closed
      // that gap AFTER a patient's first typed message; this closes it
      // from the very start of the call instead, for anyone who hasn't
      // explicitly chosen to speak yet. The patient can still enable their
      // mic anytime via the Mute/Unmute button below.
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
    // Sending a typed message is a strong signal this patient is doing the
    // call over text, not voice — mute the still-live mic afterward so
    // background noise/silence can't get transcribed and attributed to
    // them as a phantom spoken turn while they read/type the next one.
    // Confirmed against a real call: with the mic left on throughout, a
    // hallucinated one-word STT answer ("Divorced") appeared as if spoken,
    // interrupting MCTOSHS's own reply — nothing was actually said. The
    // backend's RECORDING RULE (see patientCallAgent.js) only guards
    // against ACTING on a hallucination like that; this stops it from
    // reaching the mic pipeline at all while texting. No auto-unmute —
    // the patient can switch back to voice explicitly via the Mute button,
    // same as if they'd muted themselves.
    if (!muted) {
      try {
        await room.localParticipant.setMicrophoneEnabled(false);
        setMuted(true);
      } catch {
        // Non-fatal — worst case the mic just stays on for this message.
      }
    }
  };

  const endCall = async () => {
    await roomRef.current?.disconnect();
    roomRef.current = null;
    setStatus("ended");
    setAgentState("");
    setSymptomBodyMapRequest(null);
  };

  const toggleMute = async () => {
    const room = roomRef.current;
    if (!room) return;
    const nextMuted = !muted;
    await room.localParticipant.setMicrophoneEnabled(!nextMuted);
    setMuted(nextMuted);
  };

  const handleSavedSymptomBodyMap = async (_payload, summaryText) => {
    setMessages((prev) => [...prev, { from: "patient", text: summaryText }]);
    setSymptomBodyMapRequest(null);
    const room = roomRef.current;
    if (!room) return;
    try {
      await room.localParticipant.sendText(summaryText, { topic: "lk.chat" });
    } catch {
      setError("Body map saved, but its summary could not be sent to the assistant.");
    }
  };

  return (
    <div className="pa_call_page">
      <audio ref={audioRef} autoPlay />

      <div className="pa_call_layout">
        <section className="pa_call_stage">
          <div className="pa_stage_copy">
            <div className="pa_stage_topbar">
              <div className="pa_stage_topbar_left">
                <span className="pa_stage_eyebrow">Patient-side MCTOSHS AI</span>
                {session?.patientId && <span className="pa_patient_badge">{session.patientId}</span>}
              </div>
              <div className="pa_stage_topbar_right">
                <button className="pa_logout_link" onClick={() => navigate("/patient/settings")}>Settings</button>
              </div>
            </div>
            <h1 className="pa_stage_title">
              A living interface for the call.
            </h1>
            <p className="pa_call_status">
              {session?.firstName ? `Hi ${session.firstName}. ` : ""}
              {status === "idle" && "Ready when you are."}
              {status === "connecting" && "Connecting…"}
              {status === "in-call" && agentState !== "stuck" && (muted
                ? "You're connected — type below, or tap Unmute to talk instead."
                : "You're connected — speak or type, whichever you prefer.")}
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
          {status === "in-call" && patientGender === "Female" && symptomBodyMapRequest && (
            <SymptomBodyMapPanel
              request={symptomBodyMapRequest}
              language={language}
              onClose={() => setSymptomBodyMapRequest(null)}
              onSaved={handleSavedSymptomBodyMap}
            />
          )}
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
              {liveCaption?.text && (
                <div className={`pa_chat_bubble pa_chat_bubble--${liveCaption.from} pa_chat_bubble--live`}>
                  {liveCaption.text}
                  <span className="pa_chat_live_dot" />
                </div>
              )}
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
