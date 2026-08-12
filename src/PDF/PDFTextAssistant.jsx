import React, { useCallback, useEffect, useRef, useState } from "react";
import AvatarContainer from "../Avatar/AvatarContainer";
import { apiUrl } from "../config/api";
import { AI_PROVIDERS } from "../hooks/useAIProvider";
import { readStoredSession } from "../utils/sessionCleanup";
import { normalizeOpenAiSttModel, readSttSettings, STT_PROVIDERS } from "../Avatar/local3d/sttProviderSettings";
import { startConfiguredStt } from "../Shared/configuredStt";
import "./pdfTextAssistant.css";

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const PDF_CHAT_CLIENT_TIMEOUT_MS = 120000;

const authFetch = (url, options = {}) => {
  const token = readStoredSession()?.token || "";
  return fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` },
  });
};

const replaceLastMessage = (messages, content) => {
  const next = [...messages];
  const lastIndex = next.length - 1;
  if (lastIndex < 0) return next;
  next[lastIndex] = { ...next[lastIndex], content };
  return next;
};

const PDFTextAssistant = ({
  appContext,
  filename,
  hasDocument = true,
  currentPage,
  loadDocumentPages,
  model,
  onClose,
  provider,
  sourceId,
}) => {
  const [pages, setPages] = useState([]);
  const [loadingText, setLoadingText] = useState(true);
  const [loadError, setLoadError] = useState("");
  // Whether the text this session is using actually lives in the DB
  // (textStored) and, if so, whether THIS load is what just put it there
  // vs it was already cached from a previous session (textGenerated) — the
  // status line below states this explicitly instead of leaving it
  // implicit, and textStored gates the "Delete stored text" action.
  const [textStored, setTextStored] = useState(false);
  const [textGenerated, setTextGenerated] = useState(false);
  const [deletingStoredText, setDeletingStoredText] = useState(false);
  const [messages, setMessages] = useState([]);
  const [question, setQuestion] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [listening, setListening] = useState(false);
  const [callActive, setCallActive] = useState(false);
  const [callState, setCallState] = useState("idle");
  const [callTranscript, setCallTranscript] = useState("");
  const [tokenUsage, setTokenUsage] = useState(null);
  const [sttSettings, setSttSettings] = useState(() => readSttSettings());
  const sttSettingsRef = useRef(sttSettings);
  sttSettingsRef.current = sttSettings;
  const [minimized, setMinimized] = useState(false);
  // Conversation persistence (GET/POST/PATCH /api/pdf-assistant-conversations)
  // — activeConversationId is state (drives the History list's "active" row
  // highlight); conversationIdRef mirrors it for reads inside async
  // callbacks (sendQuestion, the save effect) that would otherwise close
  // over a stale value.
  const [activeConversationId, setActiveConversationId] = useState(null);
  const [conversationList, setConversationList] = useState([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const conversationIdRef = useRef(null);
  // Set right before a conversation is loaded (initial auto-load of the
  // most recent one, or picking one from History) so that load's own
  // setMessages doesn't immediately turn around and re-save the exact same
  // messages it was just loaded with — same skip-flag pattern used for
  // annotation restores elsewhere in the PDF reader.
  const skipNextSaveRef = useRef(false);
  const avatarRef = useRef(null);
  const abortRef = useRef(null);
  const recognitionRef = useRef(null);
  const callRecognitionRef = useRef(null);
  const callActiveRef = useRef(false);
  const callRetryRef = useRef(null);
  const sendQuestionRef = useRef(null);
  const startCallListeningRef = useRef(null);
  const spokenCaptionRef = useRef("");
  const speechSyncedTurnRef = useRef(false);
  const speechStartedCallbackRef = useRef(null);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    if (typeof loadDocumentPages !== "function") {
      setPages([]);
      setTextStored(false);
      setTextGenerated(false);
      setLoadError("");
      setLoadingText(false);
      return undefined;
    }
    setLoadingText(true);
    setLoadError("");
    loadDocumentPages()
      .then((result) => {
        if (cancelled) return;
        // loadPdfAssistantPages resolves { pages, stored, generated } for a
        // saved source; tolerate a plain array too (a local/unsaved PDF's
        // fallback path, or any other caller that never adopted the
        // richer shape) so this doesn't assume every caller was updated.
        const nextPages = Array.isArray(result) ? result : result?.pages;
        const usablePages = (Array.isArray(nextPages) ? nextPages : []).filter((page) => String(page?.text || "").trim());
        setPages(usablePages);
        setTextStored(Boolean(!Array.isArray(result) && result?.stored));
        setTextGenerated(Boolean(!Array.isArray(result) && result?.generated));
        if (!usablePages.length && hasDocument) setLoadError("This PDF has no extractable text; app context is still available.");
      })
      .catch(() => {
        if (!cancelled) setLoadError("The PDF text could not be prepared.");
      })
      .finally(() => {
        if (!cancelled) setLoadingText(false);
      });
    return () => {
      cancelled = true;
      callActiveRef.current = false;
      window.clearTimeout(callRetryRef.current);
      abortRef.current?.abort();
      recognitionRef.current?.stop?.();
      callRecognitionRef.current?.abort?.();
      avatarRef.current?.stop?.();
    };
  }, [hasDocument, loadDocumentPages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  // Shared by both the initial auto-load (below) and the History panel's
  // own row clicks — loads one conversation's full messages and makes it
  // the active one.
  const loadConversation = useCallback(async (id) => {
    if (!id) return;
    try {
      const res = await authFetch(apiUrl(`/api/pdf-assistant-conversations/${id}`));
      const data = await res.json().catch(() => ({}));
      if (!data.conversation) return;
      skipNextSaveRef.current = true;
      conversationIdRef.current = data.conversation._id;
      setActiveConversationId(data.conversation._id);
      setMessages(data.conversation.messages || []);
      setTokenUsage(null);
      setHistoryOpen(false);
    } catch {
      // best-effort — the conversation just stays whatever it currently is
    }
  }, []);

  // Deleting the currently-open conversation clears the active chat too —
  // there'd be nothing left on the server for the save effect to PATCH
  // against, so staying "on" it would just recreate it on the next message.
  const deleteConversation = useCallback(async (id, event) => {
    event?.stopPropagation();
    if (!window.confirm("Delete this conversation? This cannot be undone.")) return;
    try {
      await authFetch(apiUrl(`/api/pdf-assistant-conversations/${id}`), { method: "DELETE" });
      setConversationList((prev) => prev.filter((c) => c._id !== id));
      if (conversationIdRef.current === id) {
        conversationIdRef.current = null;
        setActiveConversationId(null);
        setMessages([]);
      }
    } catch {
      // best-effort — the row just stays if the delete failed
    }
  }, []);

  // On open: fetch this source's past conversations (for the History
  // panel) and auto-load the most recent one, so closing and reopening the
  // assistant picks up right where the last conversation left off instead
  // of always starting blank. No sourceId (a local/unsaved PDF, never
  // saved as a Source) means there's nothing to persist against — stays a
  // plain in-session chat, same as before this feature existed.
  useEffect(() => {
    if (!sourceId) { setConversationList([]); return undefined; }
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch(apiUrl(`/api/pdf-assistant-conversations?sourceId=${sourceId}`));
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        const list = Array.isArray(data.conversations) ? data.conversations : [];
        setConversationList(list);
        if (list.length) void loadConversation(list[0]._id);
      } catch {
        // best-effort — the assistant still works as a plain in-session chat
      }
    })();
    return () => { cancelled = true; };
  }, [sourceId, loadConversation]);

  // Persists whenever the settled (non-streaming) message list changes —
  // reacting to the actual final state rather than trying to hand-compute
  // it inside sendQuestion's own success/error/abort branches, so this
  // stays correct regardless of which of those paths produced it. Creates
  // a new conversation on the first exchange, PATCHes the same one after
  // that (conversationIdRef, not React state, so this always sees the
  // latest id even from within the same effect run that just created it).
  useEffect(() => {
    if (!sourceId || streaming || !messages.length) return;
    if (skipNextSaveRef.current) { skipNextSaveRef.current = false; return; }
    (async () => {
      try {
        if (conversationIdRef.current) {
          const res = await authFetch(apiUrl(`/api/pdf-assistant-conversations/${conversationIdRef.current}`), {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messages }),
          });
          const data = await res.json().catch(() => ({}));
          if (data.conversation) {
            const summary = {
              _id: data.conversation._id,
              title: data.conversation.title,
              updatedAt: data.conversation.updatedAt,
              createdAt: data.conversation.createdAt,
              messageCount: data.conversation.messages.length,
            };
            setConversationList((prev) => [summary, ...prev.filter((c) => c._id !== summary._id)]);
          }
        } else {
          const res = await authFetch(apiUrl("/api/pdf-assistant-conversations"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sourceId, messages }),
          });
          const data = await res.json().catch(() => ({}));
          if (data.conversation) {
            conversationIdRef.current = data.conversation._id;
            setActiveConversationId(data.conversation._id);
            const summary = {
              _id: data.conversation._id,
              title: data.conversation.title,
              updatedAt: data.conversation.updatedAt,
              createdAt: data.conversation.createdAt,
              messageCount: data.conversation.messages.length,
            };
            setConversationList((prev) => [summary, ...prev.filter((c) => c._id !== summary._id)]);
          }
        }
      } catch {
        // best-effort — a failed save shouldn't interrupt the conversation itself
      }
    })();
  }, [messages, streaming, sourceId]);

  const startNewConversation = useCallback(() => {
    conversationIdRef.current = null;
    setActiveConversationId(null);
    setMessages([]);
    setTokenUsage(null);
    setHistoryOpen(false);
  }, []);

  // Clears the DB-cached Markdown for this source (DELETE .../markdown?all=1
  // — the same endpoint the Sources table's own cache-clear action uses),
  // not anything about this conversation. Doesn't touch `pages` — the text
  // already loaded into this session keeps working for the rest of THIS
  // chat; only the NEXT fresh open (reload, or reopening the assistant)
  // will re-extract, since ensureSourceMarkdown finds nothing cached.
  const deleteStoredText = useCallback(async () => {
    if (!sourceId || !textStored || deletingStoredText) return;
    if (!window.confirm("Delete the saved PDF text from the database? The next time this assistant opens, it will need to re-extract it.")) return;
    setDeletingStoredText(true);
    try {
      await authFetch(apiUrl(`/api/sources/${sourceId}/markdown?all=1`), { method: "DELETE" });
      setTextStored(false);
      setTextGenerated(false);
    } catch {
      // best-effort — if this fails the text simply stays cached
    } finally {
      setDeletingStoredText(false);
    }
  }, [sourceId, textStored, deletingStoredText]);

  const handleAvatarCaptionChange = useCallback((caption) => {
    if (!speechSyncedTurnRef.current) return;
    const spokenText = String(caption || "").trim();
    if (!spokenText || spokenText.length < spokenCaptionRef.current.length) return;
    spokenCaptionRef.current = spokenText;
    speechStartedCallbackRef.current?.();
    speechStartedCallbackRef.current = null;
    setMessages((previous) => replaceLastMessage(previous, spokenText));
  }, []);

  const sendQuestion = useCallback(async (rawQuestion, options = {}) => {
    const text = String(rawQuestion || "").trim();
    if (!text || streaming || loadingText) return "";
    speechSyncedTurnRef.current = false;
    speechStartedCallbackRef.current = null;
    avatarRef.current?.stop?.();
    avatarRef.current?.unlockAudio?.();
    const nextMessages = [...messages, { role: "user", content: text }];
    setMessages([...nextMessages, { role: "assistant", content: "" }]);
    setQuestion("");
    setHistoryOpen(false);
    setStreaming(true);
    setTokenUsage(null);
    const controller = new AbortController();
    abortRef.current = controller;
    let fullAnswer = "";
    let failed = false;
    let timedOut = false;
    spokenCaptionRef.current = "";
    speechSyncedTurnRef.current = true;
    speechStartedCallbackRef.current = options.onSpeaking || null;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, PDF_CHAT_CLIENT_TIMEOUT_MS);

    try {
      const response = await authFetch(apiUrl("/api/ai/pdf-chat"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages,
          sourceId: sourceId || undefined,
          pages: sourceId ? undefined : pages,
          filename,
          currentPage,
          appContext,
          provider: provider === "manual" ? "groq" : provider,
          model,
        }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error?.message || "The AMCTOSHS Assistant could not answer.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let complete = false;
      while (!complete) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") {
            complete = true;
            break;
          }
          try {
            const event = JSON.parse(payload);
            if (event.error) throw new Error(event.error);
            if (event.usage) setTokenUsage(event.usage);
            if (event.delta) {
              fullAnswer += event.delta;
              avatarRef.current?.streamSpeechChunk?.(event.delta);
            }
          } catch (error) {
            if (error instanceof SyntaxError) continue;
            throw error;
          }
        }
      }
    } catch (error) {
      failed = true;
      speechSyncedTurnRef.current = false;
      speechStartedCallbackRef.current = null;
      avatarRef.current?.stop?.();
      if (error.name === "AbortError" && !timedOut) {
        setMessages((previous) => {
          const lastMessage = previous[previous.length - 1];
          return lastMessage?.role === "assistant" && !lastMessage.content ? previous.slice(0, -1) : previous;
        });
      } else {
        setMessages((previous) => replaceLastMessage(
          previous,
          timedOut
            ? "The assistant timed out while waiting for the AI provider. Please try again."
            : error.message || "The AMCTOSHS Assistant could not answer.",
        ));
      }
    } finally {
      window.clearTimeout(timeoutId);
      abortRef.current = null;
      await Promise.resolve(avatarRef.current?.endMessage?.());
      if (fullAnswer && !failed) {
        setMessages((previous) => replaceLastMessage(previous, fullAnswer));
      }
      speechSyncedTurnRef.current = false;
      speechStartedCallbackRef.current = null;
      setStreaming(false);
    }
    return failed ? "" : fullAnswer;
  }, [appContext, currentPage, filename, loadingText, messages, model, pages, provider, sourceId, streaming]);

  sendQuestionRef.current = sendQuestion;

  const toggleListening = useCallback(async () => {
    if (streaming || callActive) return;
    if (listening) {
      recognitionRef.current?.stop?.();
      return;
    }
    const settings = readSttSettings();
    setSttSettings(settings);
    sttSettingsRef.current = settings;
    const pending = { stop: () => {}, abort: () => {} };
    recognitionRef.current = pending;
    try {
      const recognition = await startConfiguredStt({
        continuous: false,
        language: "en-US",
        onStart: () => setListening(true),
        onText: (transcript) => setQuestion(transcript),
        onError: () => setListening(false),
        onEnd: () => {
          setListening(false);
          recognitionRef.current = null;
        },
      });
      if (recognitionRef.current !== pending) recognition.abort?.();
      else recognitionRef.current = recognition;
    } catch {
      setListening(false);
      recognitionRef.current = null;
    }
  }, [callActive, listening, streaming]);

  const ready = !loadingText;
  const answeredMessages = messages.filter((message) => message.role === "assistant" && message.content);
  const effectiveProvider = provider === "manual" ? "groq" : provider;
  const providerDetails = AI_PROVIDERS.find((item) => item.id === effectiveProvider);
  const providerLabel = providerDetails?.label || effectiveProvider || "AI provider";
  const modelLabel = model || providerDetails?.sub || "Default model";

  const stopVoiceCall = useCallback(({ abortAnswer = true } = {}) => {
    callActiveRef.current = false;
    setCallActive(false);
    setCallState("idle");
    setCallTranscript("");
    window.clearTimeout(callRetryRef.current);
    callRetryRef.current = null;
    const recognition = callRecognitionRef.current;
    callRecognitionRef.current = null;
    if (recognition) {
      recognition.onend = null;
      recognition.onerror = null;
      recognition.onresult = null;
      recognition.abort?.();
    }
    if (abortAnswer) abortRef.current?.abort();
    avatarRef.current?.stop?.();
  }, []);

  const closeAgent = useCallback(() => {
    stopVoiceCall();
    window.clearTimeout(callRetryRef.current);
    callRetryRef.current = null;
    const dictation = recognitionRef.current;
    if (dictation) {
      dictation.onend = null;
      dictation.onerror = null;
      dictation.onresult = null;
      try { dictation.abort?.(); } catch { try { dictation.stop?.(); } catch {} }
    }
    recognitionRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
    speechSyncedTurnRef.current = false;
    speechStartedCallbackRef.current = null;
    spokenCaptionRef.current = "";
    avatarRef.current?.stop?.();
    onClose?.();
  }, [onClose, stopVoiceCall]);

  const queueCallListening = useCallback((delay = 250) => {
    window.clearTimeout(callRetryRef.current);
    callRetryRef.current = window.setTimeout(() => {
      if (callActiveRef.current) startCallListeningRef.current?.();
    }, delay);
  }, []);

  const processCallQuestion = useCallback(async (spokenQuestion) => {
    if (!callActiveRef.current || !spokenQuestion) return;
    setCallTranscript(spokenQuestion);
    setCallState("thinking");
    const answer = await sendQuestionRef.current?.(spokenQuestion, {
      onSpeaking: () => {
        if (callActiveRef.current) setCallState("speaking");
      },
    });
    if (!callActiveRef.current) return;
    setCallTranscript("");
    queueCallListening(answer ? 300 : 700);
  }, [queueCallListening]);

  const startCallListening = useCallback(() => {
    if (!callActiveRef.current || !ready || callRecognitionRef.current) return;
    const activeSttSettings = sttSettingsRef.current;

    if (activeSttSettings.provider !== STT_PROVIDERS.BROWSER) {
      const session = {
        aborted: false,
        abort: () => { session.aborted = true; },
      };
      callRecognitionRef.current = session;
      setCallState("listening");
      setCallTranscript("");

      (async () => {
        let stream;
        let recorder;
        let audioContext;
        let animationFrame = 0;
        const chunks = [];
        const startedAt = performance.now();
        let heardSpeech = false;
        let lastSpeechAt = startedAt;

        const releaseAudio = () => {
          if (animationFrame) cancelAnimationFrame(animationFrame);
          stream?.getTracks().forEach((track) => track.stop());
          audioContext?.close?.().catch(() => {});
        };

        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          });
          if (session.aborted || !callActiveRef.current) {
            releaseAudio();
            return;
          }

          const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"]
            .find((type) => MediaRecorder.isTypeSupported(type));
          recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
          audioContext = new AudioContext();
          const source = audioContext.createMediaStreamSource(stream);
          const analyser = audioContext.createAnalyser();
          analyser.fftSize = 1024;
          source.connect(analyser);
          const samples = new Uint8Array(analyser.fftSize);

          session.abort = () => {
            session.aborted = true;
            if (recorder?.state !== "inactive") recorder.stop();
            else releaseAudio();
          };
          recorder.ondataavailable = (event) => {
            if (event.data.size) chunks.push(event.data);
          };
          recorder.onstop = async () => {
            releaseAudio();
            if (callRecognitionRef.current === session) callRecognitionRef.current = null;
            if (session.aborted || !callActiveRef.current) return;
            const audio = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
            if (!heardSpeech || audio.size < 800) {
              queueCallListening(350);
              return;
            }

            setCallState("thinking");
            setCallTranscript("Transcribing...");
            try {
              const body = new FormData();
              body.append("audio", audio, recorder.mimeType.includes("ogg") ? "voice.ogg" : "voice.webm");
              const isLocalWhisper = activeSttSettings.provider === STT_PROVIDERS.LOCAL_WHISPER;
              if (!isLocalWhisper) {
                body.append("provider", "openai");
                body.append("model", normalizeOpenAiSttModel(activeSttSettings.model));
              }
              const response = await authFetch(apiUrl(isLocalWhisper ? "/api/ai/transcribe-local" : "/api/ai/transcribe"), { method: "POST", body });
              const data = await response.json().catch(() => ({}));
              if (!response.ok) throw new Error(data?.error?.message || "Voice transcription failed.");
              const transcript = String(data.text || "").trim();
              if (transcript) await processCallQuestion(transcript);
              else queueCallListening(400);
            } catch (error) {
              if (!callActiveRef.current) return;
              setCallTranscript(error.message || "Voice transcription failed.");
              queueCallListening(1200);
            }
          };

          const monitorSilence = () => {
            if (session.aborted || recorder.state === "inactive") return;
            analyser.getByteTimeDomainData(samples);
            let energy = 0;
            for (const sample of samples) {
              const normalized = (sample - 128) / 128;
              energy += normalized * normalized;
            }
            const rms = Math.sqrt(energy / samples.length);
            const now = performance.now();
            if (rms > 0.018) {
              heardSpeech = true;
              lastSpeechAt = now;
            }
            const utteranceComplete = heardSpeech && now - lastSpeechAt > 900 && now - startedAt > 600;
            const timedOut = now - startedAt > (heardSpeech ? 30000 : 12000);
            if (utteranceComplete || timedOut) recorder.stop();
            else animationFrame = requestAnimationFrame(monitorSilence);
          };

          recorder.start(250);
          animationFrame = requestAnimationFrame(monitorSilence);
        } catch (error) {
          releaseAudio();
          if (callRecognitionRef.current === session) callRecognitionRef.current = null;
          if (session.aborted || !callActiveRef.current) return;
          if (error.name === "NotAllowedError") {
            stopVoiceCall({ abortAnswer: false });
          } else {
            setCallTranscript("Microphone unavailable.");
            queueCallListening(1200);
          }
        }
      })();
      return;
    }

    if (!SpeechRecognition) return;
    const recognition = new SpeechRecognition();
    let finalTranscript = "";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onstart = () => {
      if (!callActiveRef.current) return;
      setCallState("listening");
      setCallTranscript("");
    };
    recognition.onresult = (event) => {
      let transcript = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        transcript += event.results[index][0].transcript;
        if (event.results[index].isFinal) finalTranscript += event.results[index][0].transcript;
      }
      setCallTranscript(transcript.trim());
    };
    recognition.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        stopVoiceCall({ abortAnswer: false });
      }
    };
    recognition.onend = async () => {
      if (callRecognitionRef.current === recognition) callRecognitionRef.current = null;
      if (!callActiveRef.current) return;
      const spokenQuestion = finalTranscript.trim();
      if (!spokenQuestion) {
        queueCallListening(400);
        return;
      }
      await processCallQuestion(spokenQuestion);
    };
    callRecognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      callRecognitionRef.current = null;
      queueCallListening(500);
    }
  }, [processCallQuestion, queueCallListening, ready, stopVoiceCall, sttSettings]);

  startCallListeningRef.current = startCallListening;

  const toggleVoiceCall = useCallback(() => {
    if (callActiveRef.current) {
      stopVoiceCall();
      return;
    }
    const settings = readSttSettings();
    setSttSettings(settings);
    sttSettingsRef.current = settings;
    const canUseRecordedStt = settings.provider !== STT_PROVIDERS.BROWSER
      && Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder && window.AudioContext);
    if ((!canUseRecordedStt && !SpeechRecognition) || !ready) return;
    recognitionRef.current?.abort?.();
    avatarRef.current?.unlockAudio?.();
    callActiveRef.current = true;
    setCallActive(true);
    setCallState("listening");
    queueCallListening(0);
  }, [queueCallListening, ready, stopVoiceCall, sttSettings.provider]);

  const voiceCallAvailable = sttSettings.provider !== STT_PROVIDERS.BROWSER
    ? Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder && window.AudioContext)
    : Boolean(SpeechRecognition);
  const dictationAvailable = sttSettings.provider === STT_PROVIDERS.BROWSER
    ? Boolean(SpeechRecognition)
    : Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);

  return (
    <section
      id="pdf_text_agent_panel"
      className={minimized ? "pdf_text_agent_panel--minimized" : undefined}
      aria-label="AMCTOSHS app assistant"
    >
      <button
        type="button"
        id="pdf_text_agent_restore"
        onClick={() => setMinimized(false)}
        aria-label="Restore AMCTOSHS Assistant"
        title="Restore AMCTOSHS Assistant"
      >
        <span className={`pdf_text_agent_restore_icon${callActive ? ` pdf_text_agent_restore_icon--${callState}` : ""}`}>
          <i className="bx bx-bot" aria-hidden="true" />
        </span>
        <span className="pdf_text_agent_restore_copy">
          <strong>AMCTOSHS</strong>
          <small>{callActive ? (callState === "thinking" ? "Thinking" : callState === "speaking" ? "Speaking" : "Listening") : streaming ? "Answering" : "Ready"}</small>
        </span>
        <i className="bx bx-window-open" aria-hidden="true" />
      </button>
      <header id="pdf_text_agent_header">
        <div>
          <span id="pdf_text_agent_eyebrow"><i className="bx bx-radar" /> App-wide awareness</span>
          <strong>AMCTOSHS Assistant</strong>
          <small title={filename}>{hasDocument ? `${filename || "Current PDF"} · page ${currentPage || 1}` : appContext?.route || "Current app"}</small>
          <div id="pdf_text_agent_model" title={`AI provider: ${providerLabel}; model: ${modelLabel}`}>
            <i className="bx bx-chip" aria-hidden="true" />
            <span>{providerLabel}</span>
            <b>{modelLabel}</b>
          </div>
        </div>
        <div id="pdf_text_agent_header_actions">
          {sourceId && (
            <button
              type="button"
              id="pdf_text_agent_history_btn"
              className={historyOpen ? "pdf_text_agent_history_btn--active" : undefined}
              onClick={() => setHistoryOpen((v) => !v)}
              aria-pressed={historyOpen}
              aria-label={historyOpen ? "Back to conversation" : "Browse past conversations"}
              title={historyOpen ? "Back to conversation" : "Browse past conversations"}
            >
              <i className={`bx ${historyOpen ? "bx-message-square-dots" : "bx-history"}`} />
            </button>
          )}
          {voiceCallAvailable && (
            <button
              type="button"
              id="pdf_text_agent_call_btn"
              className={callActive ? "pdf_text_agent_call_btn--active" : undefined}
              onClick={toggleVoiceCall}
              disabled={!ready}
              aria-pressed={callActive}
              aria-label={callActive ? "End voice call" : "Start voice call"}
            >
              <i className={`bx ${callActive ? "bx-phone-off" : "bx-phone-call"}`} />
              <span>{callActive ? "End call" : "Voice call"}</span>
            </button>
          )}
          <button
            type="button"
            id="pdf_text_agent_minimize"
            onClick={() => setMinimized(true)}
            aria-label="Minimize AMCTOSHS Assistant"
            title="Minimize and keep working in the background"
          >
            <i className="bx bx-minus" />
          </button>
          <button
            type="button"
            id="pdf_text_agent_close"
            onClick={closeAgent}
            aria-label="Close AMCTOSHS Assistant and end conversation"
            title="Close and end conversation"
          >
            <i className="bx bx-x" />
          </button>
        </div>
      </header>

      <div id="pdf_text_agent_avatar_stage">
        <AvatarContainer ref={avatarRef} allowViewportControls onSpeechCaptionChange={handleAvatarCaptionChange} />
        <div id="pdf_text_agent_scope">
          <span className={`pdf_text_agent_status_dot${ready ? " pdf_text_agent_status--ready" : ""}`} />
          <span className="pdf_text_agent_scope_label">
            {loadingText
              ? "Preparing assistant context..."
              : loadError || (hasDocument ? `${pages.length} text page${pages.length === 1 ? "" : "s"} ready${
                  textStored ? (textGenerated ? " · extracted & saved to DB" : " · loaded from DB") : ""
                }` : `Aware of ${appContext?.route || "the current app page"}`)}
          </span>
          {ready && textStored && (
            <button
              type="button"
              id="pdf_text_agent_delete_stored_btn"
              onClick={deleteStoredText}
              disabled={deletingStoredText}
              title="Delete the saved PDF text from the database"
              aria-label="Delete the saved PDF text from the database"
            >
              <i className={`bx ${deletingStoredText ? "bx-loader-alt bx-spin" : "bx-trash"}`} />
            </button>
          )}
        </div>
        {tokenUsage && (
          <div
            id="pdf_text_agent_tokens"
            className={callActive ? "pdf_text_agent_tokens--with-call" : undefined}
            title={`${tokenUsage.estimated ? "Estimated live" : "Provider-reported"} token usage`}
            aria-label={`${tokenUsage.promptTokens} prompt tokens, ${tokenUsage.completionTokens} response tokens, ${tokenUsage.totalTokens} total tokens`}
          >
            <i className="bx bx-pulse" aria-hidden="true" />
            <span><b>{tokenUsage.promptTokens}</b> in</span>
            <span><b>{tokenUsage.completionTokens}</b> out</span>
            <span><b>{tokenUsage.totalTokens}</b> total</span>
            {tokenUsage.estimated && <em>est.</em>}
          </div>
        )}
        {callActive && (
          <div id="pdf_text_agent_call_status" className={`pdf_text_agent_call_status--${callState}`} aria-live="polite">
            <span aria-hidden="true" />
            <strong>{callState === "thinking" ? "Thinking" : callState === "speaking" ? "Speaking" : "Listening"}</strong>
            {callTranscript && <small>{callTranscript}</small>}
          </div>
        )}
      </div>

      <div id="pdf_text_agent_messages" aria-live="polite">
        {historyOpen ? (
          <div id="pdf_text_agent_history_list">
            <button type="button" id="pdf_text_agent_history_new" onClick={startNewConversation}>
              <i className="bx bx-plus" /> New conversation
            </button>
            {!conversationList.length && (
              <p id="pdf_text_agent_history_empty">No past conversations on this PDF yet.</p>
            )}
            {conversationList.map((c) => (
              <div
                key={c._id}
                className={`pdf_text_agent_history_item${c._id === activeConversationId ? " pdf_text_agent_history_item--active" : ""}`}
              >
                <button type="button" className="pdf_text_agent_history_item_select" onClick={() => loadConversation(c._id)}>
                  <span className="pdf_text_agent_history_item_title">{c.title || "Untitled conversation"}</span>
                  <span className="pdf_text_agent_history_item_meta">
                    {c.messageCount} message{c.messageCount === 1 ? "" : "s"} · {new Date(c.updatedAt).toLocaleDateString()}
                  </span>
                </button>
                <button
                  type="button"
                  className="pdf_text_agent_history_item_delete"
                  onClick={(event) => deleteConversation(c._id, event)}
                  aria-label="Delete this conversation"
                  title="Delete this conversation"
                >
                  <i className="bx bx-trash" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <>
            {!messages.length && (
              <div id="pdf_text_agent_welcome">
                <strong>Ask about what is happening.</strong>
                <p>{hasDocument ? "The assistant knows the current app context and grounds document answers in this PDF." : "The assistant knows your current app location and recent interface actions."}</p>
                <div id="pdf_text_agent_suggestions">
                  {(hasDocument
                    ? ["Summarize the main points", `Explain page ${currentPage}`, "What am I currently working on?"]
                    : ["What page am I on?", "What did I just do?", "What can I do here?"]
                  ).map((suggestion) => (
                    <button type="button" key={suggestion} onClick={() => sendQuestion(suggestion)} disabled={!ready}>
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((message, index) => (
              <div key={`${message.role}-${index}`} className={`pdf_text_agent_message pdf_text_agent_message--${message.role}`}>
                <span>{message.role === "user" ? "You" : "AMCTOSHS"}</span>
                <p>{message.content || (streaming && index === messages.length - 1 ? "Thinking..." : "")}</p>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      <form
        id="pdf_text_agent_form"
        onSubmit={(event) => {
          event.preventDefault();
          sendQuestion(question);
        }}
      >
        <textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              sendQuestion(question);
            }
          }}
          placeholder={ready ? "Ask this PDF..." : "Preparing PDF text..."}
          disabled={!ready || streaming}
          rows={1}
          aria-label="Question about the current PDF"
        />
        {dictationAvailable && (
          <button
            type="button"
            className={listening ? "pdf_text_agent_mic--active" : undefined}
            onClick={toggleListening}
            disabled={!ready || streaming || callActive}
            aria-label={listening ? "Stop listening" : "Ask with microphone"}
          >
            <i className={`bx ${listening ? "bx-stop-circle" : "bx-microphone"}`} />
          </button>
        )}
        <button type="submit" disabled={!ready || streaming || !question.trim()} aria-label="Send question">
          <i className={`bx ${streaming ? "bx-loader-alt bx-spin" : "bx-send"}`} />
        </button>
      </form>

      {!historyOpen && answeredMessages.length > 0 && (
        <button type="button" id="pdf_text_agent_clear" onClick={startNewConversation} disabled={streaming}>
          New conversation
        </button>
      )}
    </section>
  );
};

export default PDFTextAssistant;
