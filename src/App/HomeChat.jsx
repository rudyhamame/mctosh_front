import React, { useEffect, useRef, useState } from "react";
import "./homeChat.css";
import { apiUrl } from "../config/api";
import { AI_PROVIDERS, useAIProvider } from "../hooks/useAIProvider";
import { readStoredSession } from "../utils/sessionCleanup";
import AnamAvatar from "./AnamAvatar";

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
// independently.
const useContextChat = (userId, provider, model, withCodebase, withDb, avatarRef) => {
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
        body: JSON.stringify({ messages: nextMessages, provider, model, userId, withCodebase, withDb }),
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

// ── Minimal markdown renderer ─────────────────────────────────────────────────

const inlineMarkdown = (text) => {
  const parts = [];
  const re = /(`[^`]+`)|(\*\*\*(.+?)\*\*\*)|(\*\*(.+?)\*\*)|(\*(.+?)\*)/g;
  let last = 0, m, key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[1]) parts.push(<code key={key++}>{m[1].slice(1, -1)}</code>);
    else if (m[2]) parts.push(<strong key={key++}><em>{m[3]}</em></strong>);
    else if (m[4]) parts.push(<strong key={key++}>{m[5]}</strong>);
    else if (m[6]) parts.push(<em key={key++}>{m[7]}</em>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
};

const Markdown = ({ children }) => {
  const raw = children || "";
  const blocks = [];
  const lines = raw.split("\n");
  let i = 0, key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      blocks.push(<pre key={key++}><code>{codeLines.join("\n")}</code></pre>);
      i++; continue;
    }

    // Headings
    const hm = line.match(/^(#{1,6})\s+(.*)/);
    if (hm) {
      const Tag = `h${hm[1].length}`;
      blocks.push(<Tag key={key++}>{inlineMarkdown(hm[2])}</Tag>);
      i++; continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      blocks.push(<hr key={key++} />);
      i++; continue;
    }

    // Unordered list
    if (/^[-*]\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i])) {
        items.push(<li key={i}>{inlineMarkdown(lines[i].slice(2))}</li>);
        i++;
      }
      blocks.push(<ul key={key++}>{items}</ul>);
      continue;
    }

    // Ordered list
    if (/^\d+\.\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(<li key={i}>{inlineMarkdown(lines[i].replace(/^\d+\.\s/, ""))}</li>);
        i++;
      }
      blocks.push(<ol key={key++}>{items}</ol>);
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      const qLines = [];
      while (i < lines.length && lines[i].startsWith("> ")) {
        qLines.push(lines[i].slice(2));
        i++;
      }
      blocks.push(<blockquote key={key++}>{inlineMarkdown(qLines.join(" "))}</blockquote>);
      continue;
    }

    // Blank line — skip
    if (line.trim() === "") { i++; continue; }

    // Paragraph — collect consecutive non-special lines
    const pLines = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].startsWith("#") &&
      !lines[i].startsWith("```") &&
      !lines[i].startsWith("> ") &&
      !/^[-*]\s/.test(lines[i]) &&
      !/^\d+\.\s/.test(lines[i]) &&
      !/^---+$/.test(lines[i].trim())
    ) {
      pLines.push(lines[i]);
      i++;
    }
    if (pLines.length) {
      blocks.push(<p key={key++}>{inlineMarkdown(pLines.join(" "))}</p>);
    }
  }

  return <div className="hc_md">{blocks}</div>;
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
  const clean = stripMd(text);
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

const VoiceCall = ({ onEnd, send, streaming, messages }) => {
  const [callState, setCallState]     = useState("listening");
  const [transcript, setTranscript]   = useState("");
  const activeRef  = useRef(true);
  const recRef     = useRef(null);
  const sendRef    = useRef(send);
  const msgCountRef = useRef(messages.length); // track when new reply arrives

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

  // When streaming ends → speak the reply → then listen again
  useEffect(() => {
    if (streaming || callState !== "thinking") return;
    const last = messages[messages.length - 1];
    if (last?.role !== "assistant" || !last.content) return;

    setCallState("speaking");
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

  const handleEnd = () => {
    activeRef.current = false;
    recRef.current?.stop();
    window.speechSynthesis.cancel(); // stop any ongoing TTS
    onEnd();
  };

  return (
    <div id="home_call_overlay">
      <div id="home_call_orb_wrap">
        <div id="home_call_orb" data-state={callState} />
      </div>
      <span id="home_call_status">{CALL_LABELS[callState]}</span>
      {transcript && (
        <p id="home_call_transcript">&ldquo;{transcript}&rdquo;</p>
      )}
      <button id="home_call_end" onClick={handleEnd}>
        <i className="fi fi-rr-circle-phone-hangup" /> End Call
      </button>
    </div>
  );
};

// ── Main panel ────────────────────────────────────────────────────────────────

const HomeChat = () => {
  const { provider, setProvider }  = useAIProvider();
  const userId = readStoredSession()?.my_id;
  const [withCodebase, setWithCodebase] = useState(
    () => localStorage.getItem("mctosh_ai_codebase") === "true"
  );
  const [withDb, setWithDb] = useState(
    () => localStorage.getItem("mctosh_ai_db") === "true"
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
  const { messages, streaming, send, stop, reset } = useContextChat(userId, provider, selectedModel, withCodebase, withDb, avatarRef);
  const [isOpen, setIsOpen]        = useState(false);
  const [input, setInput]         = useState("");
  const [listening, setListening] = useState(false);
  const [ttsOn, setTtsOn]         = useState(false);
  const [inCall, setInCall]       = useState(false);

  const bottomRef    = useRef(null);
  const recognitionRef = useRef(null);
  const finalTextRef   = useRef("");
  const sendRef        = useRef(send);

  useEffect(() => { sendRef.current = send; });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // TTS for text chat (disabled during call — call handles its own TTS — and
  // while the avatar is open, since AnamAvatar above already speaks every
  // streamed reply itself; leaving TTS on at the same time would double up
  // both voices on top of each other).
  useEffect(() => {
    if (streaming || !ttsOn || inCall || isOpen) return;
    const last = messages[messages.length - 1];
    if (last?.role !== "assistant" || !last.content) return;
    speak(last.content);
  }, [streaming]); // eslint-disable-line

  // Auto-send when push-to-talk mic ends
  useEffect(() => {
    if (listening) return;
    const text = finalTextRef.current.trim();
    if (!text) return;
    finalTextRef.current = "";
    setInput("");
    sendRef.current(text);
  }, [listening]);

  const toggleListen = () => {
    if (listening) { recognitionRef.current?.stop(); return; }
    if (!SR) return;
    window.speechSynthesis.cancel();

    const rec = new SR();
    rec.continuous     = false;
    rec.interimResults = true;
    rec.lang           = "en-US";

    rec.onresult = (e) => {
      const t = Array.from(e.results).map(r => r[0].transcript).join("");
      setInput(t);
      if (e.results[e.results.length - 1].isFinal) {
        finalTextRef.current = t;
        rec.stop();
      }
    };

    rec.onerror = () => setListening(false);
    rec.onend   = () => setListening(false);

    finalTextRef.current = "";
    recognitionRef.current = rec;
    rec.start();
    setListening(true);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!input.trim()) return;
    send(input);
    setInput("");
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(e); }
  };

  return (
    <div id="home_chat_root">

      {/* Floating panel */}
      {isOpen && <div id="home_chat">
      <AnamAvatar ref={avatarRef} />
      <div id="home_chat_header">
        <span id="home_chat_title">Dev AI</span>
        <select
          id="home_chat_provider"
          value={provider}
          onChange={e => setProvider(e.target.value)}
          disabled={streaming || inCall}
        >
          {providerOptions.map(({ id, label, model }) => (
            <option key={id} value={id}>{label} · {model}</option>
          ))}
        </select>
        <div id="home_chat_ctrls">
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
              onClick={() => { if (!inCall) unlockSpeech(); setInCall(v => !v); }}
              title={inCall ? "Voice call: ON" : "Voice call: OFF"}
            >
              <i className={`fi ${inCall ? "fi-rr-phone-slash" : "fi-rr-phone-call"}`} />
            </button>
          )}
          <button
            className={`home_chat_ctrl${ttsOn ? " home_chat_ctrl--on" : " home_chat_ctrl--off"}`}
            onClick={() => { setTtsOn(v => { if (!v) unlockSpeech(); else window.speechSynthesis.cancel(); return !v; }); }}
            title={ttsOn ? "TTS: ON" : "TTS: OFF"}
          >
            <i className={`fi ${ttsOn ? "fi-rr-volume" : "fi-rr-volume-mute"}`} />
          </button>
          {messages.length > 0 && !streaming && !inCall && (
            <button className="home_chat_ctrl" onClick={() => { window.speechSynthesis.cancel(); reset(); }} title="Clear conversation">
              <i className="fi fi-rr-trash" />
            </button>
          )}
        </div>
      </div>

      <div id="home_chat_msgs">
        {messages.length === 0 && (
          <p id="home_chat_empty">Ask anything about AMCTOSHS, the codebase, or your data.</p>
        )}
        {messages.map((msg, i) => {
          const isStreamingLast = msg.role === "assistant" && streaming && i === messages.length - 1;
          return (
            <div
              key={i}
              className={[
                "home_chat_msg",
                `home_chat_msg--${msg.role}`,
                isStreamingLast ? "home_chat_msg--streaming" : "",
              ].filter(Boolean).join(" ")}
            >
              {msg.role === "assistant" ? (
                <>
                  <Markdown>{msg.content}</Markdown>
                  {msg.model && <span className="hc_msg_model">{msg.model}</span>}
                </>
              ) : msg.content}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {inCall && (
        <VoiceCall
          onEnd={() => setInCall(false)}
          send={send}
          streaming={streaming}
          messages={messages}
        />
      )}

      <form id="home_chat_footer" onSubmit={handleSubmit}>
        <textarea
          id="home_chat_input"
          rows={1}
          placeholder={listening ? "Listening…" : "Ask about code or data…"}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={streaming || listening || inCall}
        />
        {SR && (
          <button
            type="button"
            id="home_chat_mic"
            className={listening ? "home_chat_mic--active" : ""}
            onClick={toggleListen}
            disabled={streaming || inCall}
            title={listening ? "Stop recording" : "Voice input"}
          >
            <i className={`fi ${listening ? "fi-rr-microphone-slash" : "fi-rr-microphone"}`} />
          </button>
        )}
        {streaming ? (
          <button type="button" className="home_chat_send" onClick={stop}>
            <i className="fi fi-rr-stop-circle" />
          </button>
        ) : (
          <button type="submit" className="home_chat_send" disabled={!input.trim() || listening || inCall}>
            <i className="fi fi-rr-paper-plane-top" />
          </button>
        )}
      </form>
      </div>} {/* end panel */}

      {/* FAB */}
      <button
        id="home_chat_fab"
        onClick={() => setIsOpen(v => !v)}
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
