import React, { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import "./homeChat.css";
import { apiUrl } from "../config/api";
import { AI_PROVIDERS, useAIProvider } from "../hooks/useAIProvider";
import { readStoredSession } from "../utils/sessionCleanup";
import { AVATAR_GREETING, speakableText } from "./AnamAvatar";
import AvatarContainer from "../Avatar/AvatarContainer";
import AvatarProviderSelector from "../Avatar/AvatarProviderSelector";

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

const appendToLast = (msgs, delta) => {
  const next = [...msgs];
  next[next.length - 1] = { ...next[next.length - 1], content: next[next.length - 1].content + delta };
  return next;
};

const replaceLast = (msgs, text) => {
  const next = [...msgs];
  next[next.length - 1] = { ...next[next.length - 1], content: text };
  return next;
};

// `avatarRef`, when provided, mirrors every streamed delta of MCTOSH's own
// reply onto the Anam avatar (see AnamAvatar.jsx) so it speaks the exact
// same text as it arrives, then closes out that turn once the stream ends —
// the avatar is a face on top of this same reply, not a second AI answering
// independently. `currentPage` (the route the user is actually looking at
// right now, see useLocation() in HomeChat below) is sent with every turn
// so the AI's own reply can be aware of it.
const useContextChat = (userId, provider, model, withCodebase, withDb, avatarRef, currentPage) => {
  const [messages, setMessages] = useState([]);
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef(null);

  const send = async (userText) => {
    const text = String(userText || "").trim();
    if (!text || streaming) return;

    const nextMessages = [...messages, { role: "user", content: text }];
    setMessages([...nextMessages, { role: "assistant", content: "" }]);
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(apiUrl("/api/ai/context-chat"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages, provider, model, userId, withCodebase, withDb, currentPage,
        }),
        signal: controller.signal,
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") break;
          try {
            const { delta, error, info } = JSON.parse(payload);
            if (info) setMessages(p => {
              const next = [...p];
              next[next.length - 1] = { ...next[next.length - 1], model: `${info.provider} · ${info.model}` };
              return next;
            });
            else if (error) setMessages(p => replaceLast(p, `Error: ${error}`));
            else if (delta) {
              setMessages(p => appendToLast(p, delta));
              avatarRef?.current?.streamChunk(delta);
            }
          } catch {}
        }
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        setMessages(p => replaceLast(p, "Could not reach AI."));
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
      avatarRef?.current?.endMessage();
    }
  };

  const stop  = () => abortRef.current?.abort();
  const reset = () => { abortRef.current?.abort(); setMessages([]); setStreaming(false); };

  return { messages, streaming, send, stop, reset };
};

// ── TTS utility ──────────────────────────────────────────────────────────────

const stripMd = (text) => text
  .replace(/```[\s\S]*?```/g, ", code block,")
  .replace(/`[^`]+`/g, m => m.slice(1, -1))
  .replace(/^#{1,6}\s+/gm, "")
  .replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1")
  .replace(/^\s*[-*]\s/gm, "")
  .replace(/^\s*\d+\.\s/gm, "")
  .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
  .replace(/^>\s*/gm, "")
  .replace(/---+/g, "")
  .replace(/\s+/g, " ")
  .trim();

// Must be called synchronously inside a user gesture to unlock Safari's audio gate
const unlockSpeech = () => {
  if (!window.speechSynthesis) return;
  const utt = new SpeechSynthesisUtterance("");
  window.speechSynthesis.speak(utt);
  window.speechSynthesis.cancel();
};

const speak = (text, onDone) => {
  const clean = speakableText(stripMd(text));
  if (!clean) { onDone?.(); return; }
  if (!window.speechSynthesis) { onDone?.(); return; }

  window.speechSynthesis.cancel();

  setTimeout(() => {
    const utt = new SpeechSynthesisUtterance(clean);
    utt.lang = "en-US";
    utt.rate = 1.05;

    const voices = window.speechSynthesis.getVoices();
    const enVoice = voices.find(v => v.lang === "en-US" && v.localService)
      || voices.find(v => v.lang.startsWith("en-") && v.localService)
      || voices.find(v => v.lang.startsWith("en"))
      || voices[0];
    if (enVoice) utt.voice = enVoice;

    const keepAlive = setInterval(() => {
      if (!window.speechSynthesis.speaking) { clearInterval(keepAlive); return; }
      window.speechSynthesis.pause();
      window.speechSynthesis.resume();
    }, 10000);

    const finish = () => { clearInterval(keepAlive); onDone?.(); };
    utt.onend   = finish;
    utt.onerror = finish;

    window.speechSynthesis.speak(utt);
  }, 150);
};

// ── Voice Call ────────────────────────────────────────────────────────────────

const CALL_LABELS = {
  listening: "Listening…",
  thinking:  "Thinking…",
  speaking:  "Speaking…",
};

// No "avatar finished speaking" event exists on the Anam client to hook
// into (checked the SDK — only stream-started/session events, nothing for
// audio playback actually ending), so how long the avatar keeps talking
// after its own text finishes streaming has to be estimated from the reply
// length instead — generous enough (~18 chars/sec, floor 600ms) that the
// mic re-arming early and picking up the avatar's own trailing voice as if
// it were the user speaking is the failure mode avoided, not triggered.
const estimateSpeakingMs = (text) => Math.max(600, String(text || "").length * 55);

// No boxed overlay, no controls of its own — just the STT loop, rendering a
// single live caption line under the avatar (see HomeChat.jsx). Ending the
// call is just unmounting this (the shared call-toggle button does that),
// which the mount effect's own cleanup below already handles.
const VoiceCall = ({ send, streaming, messages, avatarRef }) => {
  const [callState, setCallState]     = useState("listening");
  const [transcript, setTranscript]   = useState("");
  const activeRef  = useRef(true);
  const recRef     = useRef(null);
  const sendRef    = useRef(send);

  useEffect(() => { sendRef.current = send; });

  const startListening = () => {
    if (!SR || !activeRef.current) return;
    setCallState("listening");
    setTranscript("");

    const rec = new SR();
    rec.continuous     = false;
    rec.interimResults = true;
    rec.lang           = "en-US";

    let finalText = "";

    rec.onresult = (e) => {
      const t = Array.from(e.results).map(r => r[0].transcript).join("");
      setTranscript(t);
      if (e.results[e.results.length - 1].isFinal) {
        finalText = t;
        rec.stop();
      }
    };

    rec.onend = () => {
      if (!activeRef.current) return;
      if (finalText.trim()) {
        setCallState("thinking");
        setTranscript(finalText);
        sendRef.current(finalText);
      } else {
        // Nothing heard — listen again
        setTimeout(startListening, 400);
      }
    };

    rec.onerror = (e) => {
      if (!activeRef.current) return;
      if (e.error === "no-speech") {
        setTimeout(startListening, 400);
      } else {
        setCallState("listening");
        setTimeout(startListening, 1000);
      }
    };

    recRef.current = rec;
    try { rec.start(); } catch {}
  };

  // When streaming ends → speak the reply → then listen again. If the
  // avatar is live it's already speaking this exact reply itself (see
  // useContextChat's avatarRef.streamChunk/endMessage calls, which run
  // unconditionally whenever an avatar is mounted, call or no call) — using
  // the browser's own TTS on top of that here would talk over it with a
  // second voice, so this only falls back to speak() when there's no live
  // avatar to have already covered it.
  useEffect(() => {
    if (streaming || callState !== "thinking") return;
    const last = messages[messages.length - 1];
    if (last?.role !== "assistant" || !last.content) return;

    setCallState("speaking");
    if (avatarRef?.current?.isLive?.()) {
      const t = setTimeout(() => {
        if (activeRef.current) startListening();
      }, estimateSpeakingMs(last.content));
      return () => clearTimeout(t);
    }
    speak(last.content, () => {
      if (activeRef.current) startListening();
    });
  }, [streaming]); // eslint-disable-line

  // Start listening on mount
  useEffect(() => {
    startListening();
    return () => {
      activeRef.current = false;
      recRef.current?.stop();
      window.speechSynthesis.cancel();
    };
  }, []); // eslint-disable-line

  // The live caption itself: the AI's own reply, revealed exactly as live
  // as `messages` already updates (each SSE delta is its own re-render —
  // no separate "typing" animation needed), once it has anything to show;
  // otherwise the user's own live interim transcript while they're talking,
  // or a plain state label the rest of the time.
  const lastMsg = messages[messages.length - 1];
  const showingReply = lastMsg?.role === "assistant" && lastMsg.content;
  const caption = showingReply ? stripMd(lastMsg.content) : (transcript || CALL_LABELS[callState] || "");

  return <p id="home_live_caption">{caption}</p>;
};

// ── Main panel ────────────────────────────────────────────────────────────────

const HomeChat = () => {
  const { provider, setProvider }  = useAIProvider();
  const userId = readStoredSession()?.my_id;
  // Rendered once, app-wide (see AppRouter.js), outside of <Routes> — but
  // useLocation() still tracks navigation from anywhere inside the Router,
  // so this stays current even though HomeChat itself never remounts as
  // the user moves between pages.
  const location = useLocation();
  const currentPage = location.pathname + location.search;
  const [withCodebase, setWithCodebase] = useState(
    () => localStorage.getItem("mctosh_ai_codebase") === "true"
  );
  // Database context defaults ON (unlike codebase context, opt-in above) —
  // Dev AI should have access to your data from the moment you open it,
  // without needing to remember to flip the DB toggle on first. Still
  // respects an explicit "off" from the toggle button, persisted the same
  // way as before.
  const [withDb, setWithDb] = useState(
    () => localStorage.getItem("mctosh_ai_db") !== "false"
  );

  // Same provider/model list as the AI Providers settings page (same
  // endpoint, same env-var + saved-override resolution) — falls back to the
  // static AI_PROVIDERS list until this loads so the dropdown is never empty.
  const [providerOptions, setProviderOptions] = useState(
    () => AI_PROVIDERS.filter(p => p.id !== "manual").map(p => ({ id: p.id, label: p.label, model: p.sub }))
  );
  useEffect(() => {
    fetch(apiUrl("/api/settings/ai-status"))
      .then(r => r.json())
      .then(d => {
        if (Array.isArray(d.providers) && d.providers.length) {
          setProviderOptions(d.providers.map(p => ({ id: p.id, label: p.label, model: p.model })));
        }
      })
      .catch(() => {});
  }, []);

  const selectedModel = providerOptions.find(p => p.id === provider)?.model || "";
  const avatarRef = useRef(null);
  const { messages, streaming, send, stop, reset } = useContextChat(userId, provider, selectedModel, withCodebase, withDb, avatarRef, currentPage);
  const [isOpen, setIsOpen]        = useState(false);
  const [input, setInput]         = useState("");
  const [ttsOn, setTtsOn]         = useState(false);
  const [inCall, setInCall]       = useState(false);

  // Ready to listen the instant the panel opens — no separate "start call"
  // click needed, the avatar greets you and starts the mic itself (see
  // AnamAvatar's own auto-greeting and VoiceCall's mount-time
  // startListening). Turns back off on close so reopening always starts
  // this same fresh, rather than silently resuming whatever inCall was
  // left at from the last time the panel was open.
  useEffect(() => {
    if (!SR) return;
    setInCall(isOpen);
  }, [isOpen]);

  // TTS for typed (non-call) turns — skipped whenever the avatar is live,
  // since useContextChat's own avatarRef.streamChunk/endMessage calls
  // already speak every reply unconditionally (call or no call, open or
  // not); this is purely the fallback for when there's no live avatar to
  // have covered it, so the two never talk over each other.
  useEffect(() => {
    if (streaming || !ttsOn || inCall || avatarRef.current?.isLive?.()) return;
    const last = messages[messages.length - 1];
    if (last?.role !== "assistant" || !last.content) return;
    speak(last.content);
  }, [streaming]); // eslint-disable-line

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!input.trim()) return;
    // Synchronous, inside the real submit gesture — cheap/idempotent if
    // already unlocked earlier (see the panel-open/call/TTS toggle sites
    // above), and a safety net for whichever gesture happens to be the
    // FIRST one in a given session.
    avatarRef.current?.unlockAudio?.();
    send(input);
    setInput("");
  };

  return (
    <div id="home_chat_root">

      {/* Floats at the bottom-center of the whole app — no boxed chat
          container anymore, just the avatar, a live caption of whatever's
          currently being said (either side), a slim control row, and a
          minimal type-instead-of-talk fallback. No border/background of
          its own (see homeChat.css/anamAvatar.css). */}
      {isOpen && (
        <div id="home_avatar_float">
          <AvatarContainer ref={avatarRef} />

          {inCall ? (
            <VoiceCall send={send} streaming={streaming} messages={messages} avatarRef={avatarRef} />
          ) : (
            <p id="home_live_caption">
              {messages.length === 0
                ? AVATAR_GREETING
                : stripMd(messages[messages.length - 1]?.content || "")}
            </p>
          )}

          <div id="home_voice_ctrls">
            <AvatarProviderSelector compact />
            <select
              id="home_chat_provider"
              value={provider}
              onChange={e => setProvider(e.target.value)}
              disabled={streaming}
            >
              {providerOptions.map(({ id, label, model }) => (
                <option key={id} value={id}>{label} · {model}</option>
              ))}
            </select>
            <button
              className={`home_chat_ctrl${withCodebase ? " home_chat_ctrl--on" : " home_chat_ctrl--off"}`}
              onClick={() => setWithCodebase(v => { localStorage.setItem("mctosh_ai_codebase", String(!v)); return !v; })}
              title={withCodebase ? "Codebase ON" : "Codebase OFF"}
            >
              <i className="fi fi-rr-terminal" />
            </button>
            <button
              className={`home_chat_ctrl${withDb ? " home_chat_ctrl--on" : " home_chat_ctrl--off"}`}
              onClick={() => setWithDb(v => { localStorage.setItem("mctosh_ai_db", String(!v)); return !v; })}
              title={withDb ? "DB context ON" : "DB context OFF"}
            >
              <i className="fi fi-rr-database" />
            </button>
            {SR && (
              <button
                className={`home_chat_ctrl${inCall ? " home_chat_ctrl--call" : ""}`}
                onClick={() => { if (!inCall) { unlockSpeech(); avatarRef.current?.unlockAudio?.(); } setInCall(v => !v); }}
                title={inCall ? "Voice call: ON" : "Voice call: OFF"}
              >
                <i className={`fi ${inCall ? "fi-rr-phone-slash" : "fi-rr-phone-call"}`} />
              </button>
            )}
            <button
              className={`home_chat_ctrl${ttsOn ? " home_chat_ctrl--on" : " home_chat_ctrl--off"}`}
              onClick={() => { setTtsOn(v => { if (!v) { unlockSpeech(); avatarRef.current?.unlockAudio?.(); } else window.speechSynthesis.cancel(); return !v; }); }}
              title={ttsOn ? "TTS: ON" : "TTS: OFF"}
            >
              <i className={`fi ${ttsOn ? "fi-rr-volume" : "fi-rr-volume-mute"}`} />
            </button>
            {messages.length > 0 && !streaming && (
              <button className="home_chat_ctrl" onClick={() => { window.speechSynthesis.cancel(); reset(); }} title="Clear conversation">
                <i className="fi fi-rr-trash" />
              </button>
            )}
          </div>

          <form id="home_voice_input_form" onSubmit={handleSubmit}>
            <input
              type="text"
              placeholder="Or type instead…"
              value={input}
              onChange={e => setInput(e.target.value)}
              disabled={streaming}
            />
            {streaming ? (
              <button type="button" className="home_chat_send" onClick={stop}>
                <i className="fi fi-rr-stop-circle" />
              </button>
            ) : (
              <button type="submit" className="home_chat_send" disabled={!input.trim()}>
                <i className="fi fi-rr-paper-plane-top" />
              </button>
            )}
          </form>
        </div>
      )}

      {/* FAB */}
      <button
        id="home_chat_fab"
        onClick={() => {
          // Opening auto-engages the call (see the isOpen->inCall effect
          // above) — unlocking speechSynthesis here, synchronously inside
          // this actual click, is what lets the browser-TTS fallback path
          // (used when the avatar itself isn't live) speak at all; done
          // from an effect instead, Safari silently refuses it since it's
          // no longer inside a real user gesture by then.
          if (!isOpen) { unlockSpeech(); avatarRef.current?.unlockAudio?.(); }
          setIsOpen(v => !v);
        }}
        title={isOpen ? "Close AI" : "Dev AI"}
        className={isOpen ? "home_chat_fab--open" : ""}
      >
        <i className={`fi ${isOpen ? "fi-ss-cross-small" : "fi-ss-message-bot"}`} />
        {!isOpen && messages.length > 0 && (
          <span id="home_chat_badge">{messages.filter(m => m.role === "assistant").length}</span>
        )}
      </button>

    </div>
  );
};

export default HomeChat;
