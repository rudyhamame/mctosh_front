import { apiUrl } from "../config/api";
import { readStoredSession } from "../utils/sessionCleanup";
import {
  normalizeOpenAiSttModel,
  readSttSettings,
  STT_PROVIDERS,
} from "../Avatar/local3d/sttProviderSettings";

const authHeaders = () => {
  const token = readStoredSession()?.token || "";
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const recorderMimeType = () => [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
].find((type) => window.MediaRecorder?.isTypeSupported?.(type)) || "";

const audioFilename = (mimeType) => (
  mimeType.includes("mp4") ? "speech.m4a" : mimeType.includes("ogg") ? "speech.ogg" : "speech.webm"
);

const transcribeBlob = async (blob, settings, signal) => {
  const body = new FormData();
  body.append("audio", blob, audioFilename(blob.type));
  const local = settings.provider === STT_PROVIDERS.LOCAL_WHISPER;
  if (!local) {
    body.append("provider", "openai");
    body.append("model", normalizeOpenAiSttModel(settings.model));
  }
  const response = await fetch(apiUrl(local ? "/api/ai/transcribe-local" : "/api/ai/transcribe"), {
    method: "POST",
    headers: authHeaders(),
    body,
    signal,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || data?.error || "Speech transcription failed.");
  return String(data.text || "").trim();
};

export const getConfiguredStt = () => readSttSettings();

export const startConfiguredStt = async ({
  continuous = false,
  interimResults = true,
  language = "en-US",
  recordedChunkMs = 2500,
  requireDetectedSpeech = true,
  onStart,
  onText,
  onSpeechActivityChange,
  onProcessingChange,
  onError,
  onEnd,
} = {}) => {
  const settings = readSttSettings();
  if (settings.provider === STT_PROVIDERS.BROWSER) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) throw new Error("Browser speech recognition is unavailable.");
    const recognition = new SpeechRecognition();
    let ended = false;
    let stopped = false;
    let speechStartTimer = 0;
    recognition.continuous = continuous;
    recognition.interimResults = interimResults;
    recognition.maxAlternatives = 1;
    recognition.lang = language;
    recognition.onstart = () => {
      onStart?.(settings);
      onSpeechActivityChange?.(false);
    };
    recognition.onspeechstart = () => {
      window.clearTimeout(speechStartTimer);
      // Safari/Chromium can report very short ambient noises as speech. Only
      // expose Listening after speech has remained active for a moment.
      speechStartTimer = window.setTimeout(() => {
        if (!stopped) onSpeechActivityChange?.(true);
      }, 280);
    };
    recognition.onspeechend = () => {
      window.clearTimeout(speechStartTimer);
      onSpeechActivityChange?.(false);
    };
    recognition.onresult = (event) => {
      let text = "";
      let final = true;
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        text += event.results[index]?.[0]?.transcript || "";
        final = final && Boolean(event.results[index]?.isFinal);
      }
      if (text) onText?.(text, { final, provider: settings.provider });
    };
    recognition.onerror = (event) => {
      if (event.error !== "aborted") onError?.(new Error(event.error === "not-allowed" ? "Microphone access was denied." : `Speech recognition failed: ${event.error}.`));
    };
    recognition.onend = () => {
      window.clearTimeout(speechStartTimer);
      onSpeechActivityChange?.(false);
      if (continuous && !stopped) {
        window.setTimeout(() => {
          if (!stopped) {
            try { recognition.start(); } catch {}
          }
        }, 80);
        return;
      }
      if (ended) return;
      ended = true;
      onEnd?.();
    };
    recognition.start();
    return {
      provider: settings.provider,
      stop: () => { stopped = true; window.clearTimeout(speechStartTimer); try { recognition.stop(); } catch {} },
      abort: () => { stopped = true; window.clearTimeout(speechStartTimer); try { recognition.abort(); } catch {} },
    };
  }

  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    throw new Error(`${settings.provider === STT_PROVIDERS.LOCAL_WHISPER ? "Local Whisper" : "OpenAI STT"} requires microphone and MediaRecorder support.`);
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    // Auto gain raises room noise during silence and makes a fixed VAD appear
    // to hear speech repeatedly. Keep suppression enabled, but do not amplify
    // silence automatically.
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
  });
  const controller = new AbortController();
  const mimeType = recorderMimeType();
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  let recorder = null;
  let chunkTimer = 0;
  let monitorFrame = 0;
  let audioContext = null;
  let stopped = false;
  let stopping = false;
  let uploadQueue = Promise.resolve();
  let pendingUploads = 0;
  let chunkHasSpeech = false;
  let speechActive = false;

  const updateSpeechActivity = (active) => {
    if (speechActive === active) return;
    speechActive = active;
    onSpeechActivityChange?.(active);
  };

  const cleanup = () => {
    window.clearTimeout(chunkTimer);
    if (monitorFrame) cancelAnimationFrame(monitorFrame);
    stream.getTracks().forEach((track) => track.stop());
    audioContext?.close?.().catch(() => {});
    updateSpeechActivity(false);
    onEnd?.();
  };
  const queueUpload = (blob) => {
    if (!blob.size) return;
    pendingUploads += 1;
    onProcessingChange?.(true);
    uploadQueue = uploadQueue.then(async () => {
      const text = await transcribeBlob(blob, settings, controller.signal);
      if (text) onText?.(text, { final: true, provider: settings.provider });
    }).catch((error) => {
      if (error.name !== "AbortError") onError?.(error);
    }).finally(() => {
      pendingUploads = Math.max(0, pendingUploads - 1);
      onProcessingChange?.(pendingUploads > 0);
    });
  };
  const beginRecording = () => {
    if (stopped || stopping) return;
    chunkHasSpeech = !AudioContextClass;
    const chunks = [];
    recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    recorder.ondataavailable = (event) => { if (event.data?.size) chunks.push(event.data); };
    recorder.onerror = () => onError?.(new Error("Microphone recording failed."));
    recorder.onstop = () => {
      window.clearTimeout(chunkTimer);
      if (chunkHasSpeech || !requireDetectedSpeech) {
        queueUpload(new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" }));
      }
      if (stopping || stopped) {
        stopped = true;
        uploadQueue.finally(cleanup);
      } else if (continuous) {
        beginRecording();
      }
    };
    recorder.start();
    if (continuous) {
      // Longer chunks preserve enough context for Whisper/OpenAI punctuation.
      chunkTimer = window.setTimeout(() => {
        if (!stopped && !stopping && recorder?.state === "recording") recorder.stop();
      }, Math.max(1200, Number(recordedChunkMs) || 8000));
    }
  };

  beginRecording();
  onStart?.(settings);
  onSpeechActivityChange?.(false);

  if (AudioContextClass) {
    audioContext = new AudioContextClass();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    const startedAt = performance.now();
    let heardSpeech = false;
    let lastSpeechAt = startedAt;
    let speechCandidateAt = 0;
    let noiseFloor = 0.008;
    const calibrationEndsAt = startedAt + 450;
    const monitor = () => {
      if (stopped || stopping) return;
      analyser.getByteTimeDomainData(samples);
      let energy = 0;
      samples.forEach((sample) => { const value = (sample - 128) / 128; energy += value * value; });
      const now = performance.now();
      const rms = Math.sqrt(energy / samples.length);
      // Learn the microphone's room-noise floor while idle. The absolute
      // floor protects quiet microphones; the multiplier protects noisy rooms.
      if (!speechActive && (!speechCandidateAt || now < calibrationEndsAt)) {
        noiseFloor = (noiseFloor * 0.94) + (rms * 0.06);
      }
      const speechThreshold = Math.max(0.024, noiseFloor * 2.8);
      const releaseThreshold = Math.max(0.016, noiseFloor * 1.75);

      if (rms >= speechThreshold) {
        if (!speechCandidateAt) speechCandidateAt = now;
        // A click, tap, or short noise spike is not speech. Require a stable
        // signal before changing the keyboard from Idle to Listening.
        if (now - speechCandidateAt >= 180) {
          heardSpeech = true;
          chunkHasSpeech = true;
          lastSpeechAt = now;
          updateSpeechActivity(true);
        }
      } else if (!speechActive || rms < releaseThreshold) {
        speechCandidateAt = 0;
      }

      if (speechActive && rms >= releaseThreshold) {
        heardSpeech = true;
        chunkHasSpeech = true;
        lastSpeechAt = now;
      }
      if (speechActive && now - lastSpeechAt > 700) {
        speechCandidateAt = 0;
        updateSpeechActivity(false);
      }
      if (!continuous && ((heardSpeech && now - lastSpeechAt > 900) || now - startedAt > 15000)) {
        stopping = true;
        recorder.stop();
      } else {
        monitorFrame = requestAnimationFrame(monitor);
      }
    };
    monitorFrame = requestAnimationFrame(monitor);
  } else if (!continuous) {
    chunkTimer = window.setTimeout(() => {
      if (recorder?.state === "recording") {
        stopping = true;
        recorder.stop();
      }
    }, Math.max(1200, Number(recordedChunkMs) || 8000));
  }

  return {
    provider: settings.provider,
    stop: () => {
      if (stopped || stopping) return;
      stopping = true;
      if (recorder?.state === "recording") recorder.stop();
      else { stopped = true; cleanup(); }
    },
    abort: () => {
      stopped = true;
      controller.abort();
      if (recorder?.state === "recording") {
        recorder.onstop = null;
        recorder.stop();
      }
      cleanup();
    },
  };
};
