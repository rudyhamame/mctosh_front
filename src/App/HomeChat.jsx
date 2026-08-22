import React, { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useLocation } from "react-router-dom";
import "./homeChat.css";
import { apiUrl } from "../config/api";
import { AI_PROVIDERS, useAIProvider } from "../hooks/useAIProvider";
import { readStoredSession } from "../utils/sessionCleanup";
import { AVATAR_GREETING, speakableText } from "./AnamAvatar";
import { readDevAiSettings } from "./devAiSettings";
import AvatarContainer from "../Avatar/AvatarContainer";
import { startConfiguredStt } from "../Shared/configuredStt";
import { readSttSettings, STT_PROVIDER_OPTIONS } from "../Avatar/local3d/sttProviderSettings";
import { createLocalAvatarSpeechService } from "../Avatar/local3d/services/localAvatarSpeechService";
import { createBrowserTTSProvider } from "../Avatar/local3d/services/ttsProviders/BrowserTTSProvider";
import { createOpenVoiceCloneProvider } from "../Avatar/local3d/services/ttsProviders/OpenVoiceCloneProvider";
import { createKokoroTTSProvider } from "../Avatar/local3d/services/ttsProviders/KokoroTTSProvider";
import { createSupertonicTTSProvider } from "../Avatar/local3d/services/ttsProviders/SupertonicTTSProvider";
import { readVoiceSettings, readTtsProviderId, TTS_PROVIDERS } from "../Avatar/local3d/ttsProviderSettings";
import { useAvatarProvider } from "../Avatar/AvatarProviderContext";
import { AVATAR_PROVIDERS } from "../Avatar/avatarConstants";
import VirtualKeyboard from "../Shared/VirtualKeyboard";
import { RABBIT_LOGO_BLINK_FRAMES } from "../Shared/RabbitLogoBlink";

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
const useContextChat = (userId, provider, model, avatarRef, currentPage, onReplySpeech = null, voiceCallRef = null) => {
  const [messages, setMessages] = useState([]);
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef(null);
  const rawReplyRef = useRef("");
  const displayedReplyRef = useRef("");
  const streamFinishedRef = useRef(false);
  const speechStartedRef = useRef(false);
  const pendingSpeechRef = useRef(null);
  const typingIntervalRef = useRef(90);

  // Reveal the assistant reply one character at a time. The network stream
  // may arrive in large chunks, so rendering it directly bypasses the
  // intended typing latency and makes the avatar/text feel disconnected.
  useEffect(() => {
    let timer = 0;
    const tick = () => {
      if (!speechStartedRef.current) {
        timer = window.setTimeout(tick, 60);
        return;
      }
      if (displayedReplyRef.current.length < rawReplyRef.current.length) {
        const voiceCall = Boolean(voiceCallRef?.current);
        const nextText = voiceCall
          ? rawReplyRef.current
          : rawReplyRef.current[displayedReplyRef.current.length];
        if (voiceCall) displayedReplyRef.current = rawReplyRef.current;
        else displayedReplyRef.current += nextText;
        setMessages((previous) => replaceLast(previous, displayedReplyRef.current));
        avatarRef?.current?.streamChunk(nextText);
      } else if (streamFinishedRef.current) {
        const pendingSpeech = pendingSpeechRef.current;
        pendingSpeechRef.current = null;
        streamFinishedRef.current = false;
        setStreaming(false);
        avatarRef?.current?.endMessage();
        pendingSpeech?.();
      }

      timer = window.setTimeout(tick, speechStartedRef.current ? typingIntervalRef.current : 60);
    };
    timer = window.setTimeout(tick, 60);

    return () => window.clearTimeout(timer);
  }, [avatarRef, voiceCallRef]);

  const send = async (userText) => {
    const text = String(userText || "").trim();
    if (!text || streaming) return;

    const nextMessages = [...messages, { role: "user", content: text }];
    setMessages([...nextMessages, { role: "assistant", content: "" }]);
    rawReplyRef.current = "";
    displayedReplyRef.current = "";
    streamFinishedRef.current = false;
    speechStartedRef.current = false;
    typingIntervalRef.current = 90;
    setStreaming(true);

    const controller = new AbortController();
    controller.assistantStoppedByUser = false;
    abortRef.current = controller;
    let stallTimer = 0;
    const armStallTimer = () => {
      window.clearTimeout(stallTimer);
      stallTimer = window.setTimeout(() => controller.abort(), 35000);
    };
    armStallTimer();

    try {
      const res = await fetch(apiUrl("/api/ai/context-chat"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages, provider, model, userId, currentPage,
        }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error?.message || `Assistant request failed (${res.status}).`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        armStallTimer();
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
            else if (error) rawReplyRef.current = `Error: ${error}`;
            else if (delta) {
              rawReplyRef.current += delta;
              // The answer has started; the avatar must leave Thinking even
              // while the rest of the streamed reply is still arriving.
              speechStartedRef.current = true;
            }
          } catch {}
        }
      }
    } catch (err) {
      if (controller.assistantStoppedByUser) {
        setMessages((previous) => {
          const last = previous[previous.length - 1];
          return last?.role === "assistant" && !last.content ? previous.slice(0, -1) : previous;
        });
      } else {
        rawReplyRef.current = err.name === "AbortError"
          ? "The assistant stopped because the AI response stalled. Please try again."
          : (err.message || "Could not reach AI.");
      }
    } finally {
      window.clearTimeout(stallTimer);
      abortRef.current = null;
      streamFinishedRef.current = true;
      speechStartedRef.current = true;
      if (rawReplyRef.current && onReplySpeech && !controller.assistantStoppedByUser) {
        pendingSpeechRef.current = () => onReplySpeech(rawReplyRef.current, (durationMs) => {
          typingIntervalRef.current = Math.max(20, Number(durationMs) / Math.max(1, rawReplyRef.current.length));
        });
      }
    }
  };

  const stop  = () => {
    if (abortRef.current) abortRef.current.assistantStoppedByUser = true;
    abortRef.current?.abort();
  };
  const reset = () => {
    if (abortRef.current) abortRef.current.assistantStoppedByUser = true;
    abortRef.current?.abort();
    setMessages([]);
    rawReplyRef.current = "";
    displayedReplyRef.current = "";
    streamFinishedRef.current = false;
    speechStartedRef.current = false;
    pendingSpeechRef.current = null;
    setStreaming(false);
  };

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

let configuredSpeechService = null;
let configuredSpeechProviderId = null;
let browserFallbackSpeechService = null;

const createConfiguredTtsProvider = (providerId) => {
  if (providerId === TTS_PROVIDERS.OPENVOICE) return createOpenVoiceCloneProvider();
  if (providerId === TTS_PROVIDERS.KOKORO) return createKokoroTTSProvider();
  if (providerId === TTS_PROVIDERS.SUPERTONIC) return createSupertonicTTSProvider();
  return createBrowserTTSProvider();
};

const ensureConfiguredSpeechService = () => {
  const providerId = readTtsProviderId();
  if (!configuredSpeechService || configuredSpeechProviderId !== providerId) {
    configuredSpeechService?.stop?.();
    configuredSpeechProviderId = providerId;
    configuredSpeechService = createLocalAvatarSpeechService(createConfiguredTtsProvider(providerId));
  }
  return configuredSpeechService;
};

const ensureBrowserFallbackSpeechService = () => {
  if (!browserFallbackSpeechService) {
    browserFallbackSpeechService = createLocalAvatarSpeechService(createBrowserTTSProvider());
  }
  return browserFallbackSpeechService;
};

const unlockConfiguredAudio = () => {
  ensureConfiguredSpeechService().unlockAudio?.();
};

const speak = (text, onDone, onDuration) => {
  const clean = speakableText(stripMd(text));
  if (!clean) { onDone?.(); return; }
  const speechService = ensureConfiguredSpeechService();
  const settings = readVoiceSettings();
  const speechOptions = {
    language: settings.language || "en-US",
    voice: settings.voiceURI,
    voiceProfileId: settings.voiceProfileId,
    kokoroVoice: settings.kokoroVoice,
    supertonicVoice: settings.supertonicVoice,
    onDuration,
  };
  speechService.speak(clean, speechOptions).then(() => onDone?.()).catch((error) => {
    console.error("[HomeChat] configured TTS playback failed:", error);
    if (readTtsProviderId() === TTS_PROVIDERS.BROWSER) {
      onDone?.();
      return;
    }
    // Wonderland must remain audible even when an optional local TTS
    // service is offline or returns an unreadable audio response.
    ensureBrowserFallbackSpeechService().speak(clean, speechOptions)
      .then(() => onDone?.())
      .catch((fallbackError) => {
        console.error("[HomeChat] browser TTS fallback failed:", fallbackError);
        onDone?.();
      });
  });
};

// ── Voice Call ────────────────────────────────────────────────────────────────

const TTS_PROVIDER_LABELS = {
  [TTS_PROVIDERS.BROWSER]: "Browser speech synthesis",
  [TTS_PROVIDERS.OPENVOICE]: "OpenVoice",
  [TTS_PROVIDERS.KOKORO]: "Kokoro",
  [TTS_PROVIDERS.SUPERTONIC]: "Supertonic",
};

// No "avatar finished speaking" event exists on the Anam client to hook
// into (checked the SDK — only stream-started/session events, nothing for
// audio playback actually ending), so how long the avatar keeps talking
// after its own text finishes streaming has to be estimated from the reply
// length instead — generous enough (~18 chars/sec, floor 600ms) that the
// mic re-arming early and picking up the avatar's own trailing voice as if
// it were the user speaking is the failure mode avoided, not triggered.
const estimateSpeakingMs = (text) => Math.max(600, String(text || "").length * 55);
const INTERRUPTION_MIN_WORDS = 2;
const INTERRUPTION_MIN_CHARS = 10;

const isInterruptingTranscript = (text) => {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  const words = normalized.split(" ").filter(Boolean);
  return words.length >= INTERRUPTION_MIN_WORDS || normalized.length >= INTERRUPTION_MIN_CHARS;
};

// No boxed overlay, no controls of its own — just the STT loop, rendering a
// single live caption line under the avatar (see HomeChat.jsx). Ending the
// call is just unmounting this (the shared call-toggle button does that),
// which the mount effect's own cleanup below already handles.
const VoiceCall = ({ send, streaming, messages, avatarRef, onStateChange, onSpeechActivity }) => {
  const [callState, setCallState]     = useState("listening");
  const [transcript, setTranscript]   = useState("");
  const activeRef  = useRef(true);
  const recRef     = useRef(null);
  const sendRef    = useRef(send);
  const callStateRef = useRef("listening");
  const speakingTimerRef = useRef(null);
  const interruptRecRef = useRef(null);
  const interruptedRef = useRef(false);

  useEffect(() => { sendRef.current = send; });
  useEffect(() => { callStateRef.current = callState; }, [callState]);
  useEffect(() => { onStateChange?.(callState); }, [callState, onStateChange]);

  const clearSpeakingTimer = () => {
    if (speakingTimerRef.current) {
      clearTimeout(speakingTimerRef.current);
      speakingTimerRef.current = null;
    }
  };

  const stopInterruptRecognizer = () => {
    const rec = interruptRecRef.current;
    interruptRecRef.current = null;
    if (!rec) return;
    try { rec.stop(); } catch {}
  };

  const stopCurrentReply = () => {
    clearSpeakingTimer();
    avatarRef?.current?.stop?.();
    window.speechSynthesis.cancel();
  };

  const startListening = async () => {
    if (!activeRef.current) return;
    onSpeechActivity?.(false);
    stopInterruptRecognizer();
    clearSpeakingTimer();
    interruptedRef.current = false;
    setCallState("listening");
    setTranscript("");

    let finalText = "";
    const pending = { stop: () => {}, abort: () => {} };
    recRef.current = pending;
    try {
      const rec = await startConfiguredStt({
        continuous: false,
        language: "en-US",
        // Whisper is the authority for whether the recording contains
        // speech; local RMS detection must not discard a quiet utterance.
        requireDetectedSpeech: false,
        onSpeechActivityChange: (active) => {
          if (activeRef.current) onSpeechActivity?.(active);
        },
        onText: (text, { final }) => {
          setTranscript(text);
          onSpeechActivity?.(Boolean(String(text || "").trim()));
          if (String(text || "").trim()) finalText = text;
        },
        onEnd: () => {
          recRef.current = null;
          onSpeechActivity?.(false);
          if (!activeRef.current) return;
          if (finalText.trim()) {
            setCallState("thinking");
            setTranscript(finalText);
            sendRef.current(finalText);
          } else setTimeout(startListening, 400);
        },
        onError: () => {
          onSpeechActivity?.(false);
          if (activeRef.current) setTimeout(startListening, 1000);
        },
      });
      if (recRef.current !== pending) rec.abort?.();
      else recRef.current = rec;
    } catch {
      recRef.current = null;
      if (activeRef.current) setTimeout(startListening, 1000);
    }
  };

  const startInterruptionListening = async () => {
    if (!activeRef.current || !avatarRef?.current?.isLive?.()) return;
    if (!readDevAiSettings().interruptOnSpeech) return;
    stopInterruptRecognizer();
    interruptedRef.current = false;

    let finalText = "";
    const pending = { stop: () => {}, abort: () => {} };
    interruptRecRef.current = pending;
    try {
      const rec = await startConfiguredStt({
        continuous: false,
        language: "en-US",
        onSpeechActivityChange: (active) => {
          if (activeRef.current) onSpeechActivity?.(active);
        },
        onText: (nextText, { final }) => {
          if (!isInterruptingTranscript(nextText)) return;
          onSpeechActivity?.(true);
          setTranscript(nextText);
          if (!interruptedRef.current) {
            interruptedRef.current = true;
            stopCurrentReply();
            setCallState("listening");
          }
          if (final) finalText = nextText;
        },
        onEnd: () => {
          interruptRecRef.current = null;
          onSpeechActivity?.(false);
          if (!activeRef.current) return;
          if (finalText.trim()) {
            setCallState("thinking");
            setTranscript(finalText);
            sendRef.current(finalText);
          } else if (interruptedRef.current) setTimeout(startListening, 250);
        },
        onError: () => {
          interruptRecRef.current = null;
          onSpeechActivity?.(false);
          if (activeRef.current && interruptedRef.current) setTimeout(startListening, 400);
        },
      });
      if (interruptRecRef.current !== pending) rec.abort?.();
      else interruptRecRef.current = rec;
    } catch {
      interruptRecRef.current = null;
    }
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
      speakingTimerRef.current = setTimeout(() => {
        if (activeRef.current) startListening();
      }, estimateSpeakingMs(last.content));
      startInterruptionListening();
      return () => {
        clearSpeakingTimer();
        stopInterruptRecognizer();
      };
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
      clearSpeakingTimer();
      stopInterruptRecognizer();
      recRef.current?.stop();
      avatarRef?.current?.stop?.();
      window.speechSynthesis.cancel();
    };
  }, []); // eslint-disable-line

// Footer caption should show only the assistant's text, never the user's
// own live speech transcript. Until the assistant reply is available, keep
// the footer empty rather than echoing recognition text or call-state
// labels.
  return null;
};

// ── Main panel ────────────────────────────────────────────────────────────────

const HomeChat = ({ embedded = false, initiallyOpen = false, onClose = null }) => {
  // Provider is chosen in Settings now (same mctosh_ai_provider localStorage
  // key useAIProvider reads on mount) — Dev AI no longer has its own
  // selector, just uses whatever's currently set.
  const { provider } = useAIProvider();
  const { provider: avatarProvider } = useAvatarProvider();
  const userId = readStoredSession()?.my_id;
  // Rendered once, app-wide (see AppRouter.js), outside of <Routes> — but
  // useLocation() still tracks navigation from anywhere inside the Router,
  // so this stays current even though HomeChat itself never remounts as
  // the user moves between pages.
  const location = useLocation();
  const currentPage = location.pathname + location.search;

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
  const selectedProviderLabel = providerOptions.find(p => p.id === provider)?.label || provider || "AI provider";
  const sttSettings = readSttSettings();
  const sttProviderLabel = STT_PROVIDER_OPTIONS.find((option) => option.id === sttSettings.provider)?.label || sttSettings.provider;
  const ttsProviderId = readTtsProviderId();
  const ttsProviderLabel = TTS_PROVIDER_LABELS[ttsProviderId] || ttsProviderId;
  const avatarRef = useRef(null);
  const messagesEndRef = useRef(null);
  const inCallRef = useRef(false);
  const [replySpeaking, setReplySpeaking] = useState(false);
  const startReplySpeech = useCallback((text, onDuration) => {
    if (inCallRef.current) return;
    setReplySpeaking(true);
    speak(text, () => setReplySpeaking(false), onDuration);
  }, []);
  const { messages, streaming, send, stop } = useContextChat(userId, provider, selectedModel, avatarRef, currentPage, startReplySpeech, inCallRef);
  const [isOpen, setIsOpen]        = useState(initiallyOpen);
  const [isMinimized, setIsMinimized] = useState(false);
  const [inCall, setInCall]       = useState(false);
  const [voiceState, setVoiceState] = useState("listening");
  const [humanSpeaking, setHumanSpeaking] = useState(false);
  const [input, setInput]         = useState("");

  const handleVoiceStateChange = useCallback((state) => {
    setVoiceState(state);
  }, []);

  useEffect(() => {
    if (!isOpen) setInCall(false);
  }, [isOpen]);

  useEffect(() => {
    inCallRef.current = inCall;
  }, [inCall]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  const rabbitProviderActive = avatarProvider === AVATAR_PROVIDERS.RABBIT_WONDERLAND;
  const assistantReplyText = messages[messages.length - 1]?.role === "assistant" ? messages[messages.length - 1]?.content || "" : "";
  const assistantReplyStarted = streaming && messages[messages.length - 1]?.role === "assistant" && Boolean(messages[messages.length - 1]?.content);
  const rabbitAvatarActivity = inCall
    ? (voiceState === "listening"
      ? "listening"
      : (voiceState === "speaking" || (voiceState === "thinking" && Boolean(assistantReplyText))
        ? "speaking"
        : "thinking"))
    : (!inCall && replySpeaking && !streaming
      ? "speaking"
      : (!inCall && input.trim() && !streaming
        ? "waiting"
        : (!inCall && streaming
          ? (assistantReplyStarted ? "typing" : "thinking")
          : (voiceState === "speaking" ? "speaking" : (voiceState === "thinking" ? "thinking" : "idle")))));

  const submitText = (event) => {
    event.preventDefault();
    const text = input.trim();
    if (!text || streaming) return;
    unlockSpeech();
    unlockConfiguredAudio();
    send(text);
    setInput("");
  };

  const toggleVoiceCall = () => {
    if (inCall) {
      setInCall(false);
      setReplySpeaking(false);
      setHumanSpeaking(false);
      avatarRef.current?.stop?.();
      configuredSpeechService?.stop?.();
      window.speechSynthesis.cancel();
      return;
    }
    unlockSpeech();
    unlockConfiguredAudio();
    avatarRef.current?.unlockAudio?.();
    setInCall(true);
  };

  return (
    <div id="home_chat_root" className={embedded ? "home_chat_root--embedded" : undefined}>
      {isOpen && !isMinimized && (
        <section id="home_chat_panel" className={rabbitProviderActive ? "has-rabbit-provider" : undefined} aria-label="Rabbit of Wonderland AI">
          {rabbitProviderActive && (
            <div className="home_chat_provider_avatar" aria-label="Rabbit of Wonderland provider">
              <AvatarContainer ref={avatarRef} allowViewportControls={false} activity={rabbitAvatarActivity} typingText={assistantReplyText} />
            </div>
          )}
          <header id="home_chat_header">
            <div>
              <span className="home_chat_kicker">Rabbit of Wonderland</span>
              <h2>AI companion</h2>
              <p>Ask, explore, and follow a thought down the rabbit hole.</p>
              <div className="home_chat_model_io">
                <span className="home_chat_model" title={`${selectedProviderLabel} · ${selectedModel || "configured model"}`}>
                  {selectedProviderLabel} · {selectedModel || "configured model"}
                </span>
                <span className="home_chat_io" title={`Speech to text: ${sttProviderLabel}; text to speech: ${ttsProviderLabel}`}>
                  <span><b>STT</b> {sttProviderLabel}</span>
                  <span><b>TTS</b> {ttsProviderLabel}</span>
                </span>
              </div>
            </div>
            <button type="button" className={`home_chat_voice${inCall ? " is-active" : ""}`} onClick={toggleVoiceCall} aria-pressed={inCall}>
              <i className={`fi ${inCall ? "fi-ss-phone-call" : "fi-ss-microphone"}`} />
              {inCall ? "End voice call" : "Voice call"}
            </button>
            {onClose && (
              <button type="button" className="home_chat_minimize" onClick={() => setIsMinimized(true)} aria-label="Minimize Wonderland AI" title="Minimize chat">
                <i className="fi fi-rr-minus-small" />
              </button>
            )}
            {onClose && (
              <button type="button" className="home_chat_close" onClick={onClose} aria-label="Close Rabbit of Wonderland AI" title="Close chat">
                <i className="fi fi-rr-cross-small" />
              </button>
            )}
          </header>

          <div className={`home_chat_conversation${rabbitProviderActive ? " has-provider-avatar" : ""}`}>
            <div id="home_chat_messages" aria-live="polite">
              {messages.length === 0 && (
                <p className="home_chat_empty">What would you like to uncover?</p>
              )}
              {messages.map((message, index) => (
                <article key={`${message.role}-${index}`} className={`home_chat_message home_chat_message--${message.role}`}>
                  <span className="home_chat_message_role">{message.role === "user" ? "You" : "Wonderland AI"}</span>
                  <p>{message.content || (streaming && index === messages.length - 1 ? "Thinking…" : "")}</p>
                  {message.model && <small>{message.model}</small>}
                </article>
              ))}
              <div ref={messagesEndRef} />
            </div>
          </div>

          <form id="home_chat_composer" onSubmit={submitText}>
            <div className="home_chat_input_row">
              <textarea
                value={input}
                rows={2}
                placeholder="Write to Wonderland AI…"
                aria-label="Message Wonderland AI"
                disabled={streaming}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    submitText(event);
                  }
                }}
              />
              {streaming ? (
                <button type="button" className="home_chat_send" style={{ backgroundColor: "#000", backgroundImage: "none", color: "#fff", WebkitAppearance: "none" }} onClick={stop}>Stop</button>
              ) : (
                <button type="submit" className="home_chat_send" style={{ backgroundColor: "#000", backgroundImage: "none", color: "#fff", WebkitAppearance: "none" }} disabled={!input.trim()}>Send</button>
              )}
            </div>
            <div id="home_chat_keyboard_slot" aria-label="AI message keyboard" />
            <VirtualKeyboard inline autoOpenOnFocus showToggle={false} panelPortalId="home_chat_keyboard_slot" panelClassName="home_chat_virtual_keyboard" />
          </form>
        </section>
      )}

      {/* Floats at the bottom-center of the whole app — no boxed chat
          container anymore, just the avatar and a live caption of
          whatever's currently being said (either side). No
          border/background of its own (see homeChat.css/anamAvatar.css). */}
      {isOpen && !isMinimized && inCall && (
        <div id="home_avatar_float">
          {inCall ? (
            <VoiceCall send={send} streaming={streaming} messages={messages} avatarRef={avatarRef} onStateChange={handleVoiceStateChange} onSpeechActivity={setHumanSpeaking} />
          ) : null}

          {!rabbitProviderActive && (
            <AvatarContainer ref={avatarRef} allowViewportControls />
          )}
        </div>
      )}

      {/* FAB */}
      {!embedded && <button
        id="home_chat_fab"
        onClick={() => {
          // Opening auto-engages the call (see the isOpen->inCall effect
          // above) — unlocking speechSynthesis here, synchronously inside
          // this actual click, is what lets the browser-TTS fallback path
          // (used when the avatar itself isn't live) speak at all; done
          // from an effect instead, Safari silently refuses it since it's
          // no longer inside a real user gesture by then.
          if (!isOpen) {
            setIsMinimized(false);
            unlockSpeech();
            unlockConfiguredAudio();
            flushSync(() => setIsOpen(true));
            avatarRef.current?.unlockAudio?.();
            return;
          }
          if (isMinimized) {
            setIsMinimized(false);
            return;
          }
          setIsOpen(false);
        }}
        title={isOpen ? "Close RabbitHole Assistant" : "Open RabbitHole Assistant"}
        aria-label={isOpen ? "Close RabbitHole Assistant" : "Open RabbitHole Assistant"}
        aria-expanded={isOpen}
        className={`${isOpen ? "home_chat_fab--open" : ""}${isMinimized && rabbitProviderActive ? " home_chat_fab--minimized" : ""}`}
      >
        {isMinimized && rabbitProviderActive ? (
          <img
            className="home_chat_fab_logo"
            src={RABBIT_LOGO_BLINK_FRAMES[RABBIT_LOGO_BLINK_FRAMES.length - 1]}
            alt="Open Wonderland AI"
          />
        ) : (
          <i className={`fi ${isOpen ? "fi-ss-cross-small" : "fi-ss-message-bot"}`} />
        )}
        {!isOpen && messages.length > 0 && (
          <span id="home_chat_badge">{messages.filter(m => m.role === "assistant").length}</span>
        )}
      </button>}

    </div>
  );
};

export default HomeChat;
