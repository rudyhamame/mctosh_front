// Orchestrates a TTSProvider (see ttsProviders/) into actual audio playback
// plus a live amplitude/viseme feed for useLipSync to animate the model
// from. Two real paths, chosen per-call based on what the provider actually
// returned:
//
//   1. Provider returned a real audioUrl (a hosted TTS result, e.g. a
//      future working AzureTTSProvider) — played through an <audio>
//      element wired into a real Web Audio AnalyserNode, so amplitude is
//      genuine RMS of the actual output. If the provider also supplied a
//      viseme timeline, that drives the mouth shape directly instead
//      (more accurate than amplitude); amplitude is the fallback.
//   2. Provider returned no audioUrl (BrowserTTSProvider's only case, since
//      the Web Speech API exposes no accessible audio buffer in any
//      browser) — speechSynthesis.speak() is called directly here, and
//      mouth movement is a synthetic pulse timed off the utterance's own
//      onboundary (word-boundary) events. This is NOT real amplitude
//      analysis — the platform has no way to provide that for
//      speechSynthesis output — it's the standard workaround other
//      browser-TTS-driven avatars use too.
export const createLocalAvatarSpeechService = (ttsProvider) => {
  let audioEl = null;
  let audioCtx = null;
  let analyser = null;
  let rafId = null;
  let visemeTimers = [];
  let currentUtterance = null;
  let onAmplitudeCb = null;
  let onVisemeCb = null;
  // Real network-backed providers (OpenVoiceClone) can take several seconds
  // to synthesize — stop() must be able to cancel a request still in flight,
  // not just audio that already started playing, or an obsolete reply can
  // finish speaking over a newer one (see Local3DAvatarView.jsx's endMessage).
  let currentAbortController = null;

  const stopAmplitudeLoop = () => {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  };

  const clearVisemeTimers = () => {
    visemeTimers.forEach(clearTimeout);
    visemeTimers = [];
  };

  const teardownAudio = () => {
    stopAmplitudeLoop();
    clearVisemeTimers();
    if (audioEl) {
      audioEl.pause();
      audioEl.src = "";
      audioEl = null;
    }
    if (audioCtx) {
      audioCtx.close().catch(() => {});
      audioCtx = null;
      analyser = null;
    }
  };

  const runAmplitudeLoop = () => {
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      if (!analyser) return;
      analyser.getByteTimeDomainData(data);
      let sumSquares = 0;
      for (let i = 0; i < data.length; i++) {
        const centered = (data[i] - 128) / 128;
        sumSquares += centered * centered;
      }
      const rms = Math.sqrt(sumSquares / data.length);
      onAmplitudeCb?.(Math.min(1, rms * 4)); // scaled up — raw RMS from speech reads quiet
      rafId = requestAnimationFrame(tick);
    };
    tick();
  };

  const speakViaAudioUrl = (result) => new Promise((resolve) => {
    audioEl = new Audio();
    // Must be set BEFORE .src (crossOrigin only affects requests made after
    // it's applied) — result.audioUrl is a cross-origin Cloudinary URL, and
    // createMediaElementSource() below routes 100% of playback through the
    // Web Audio graph. Without this, browsers silently zero the output of a
    // tainted cross-origin source (to block audio fingerprinting) — the
    // element still reports "playing" and onended still fires, but nothing
    // reaches the speakers. Requires the resource to actually send
    // Access-Control-Allow-Origin (Cloudinary's res.cloudinary.com CDN
    // delivery domain does; its Admin API download domain does not — see
    // back/routes/TTSAPI.js's own comment on using secure_url, not that).
    audioEl.crossOrigin = "anonymous";
    audioEl.src = result.audioUrl;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaElementSource(audioEl);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    analyser.connect(audioCtx.destination);

    if (result.visemes?.length) {
      visemeTimers = result.visemes.map((v) =>
        setTimeout(() => onVisemeCb?.(v.viseme), Math.max(0, v.time)));
    } else {
      runAmplitudeLoop();
    }

    const finish = () => {
      teardownAudio();
      onVisemeCb?.("mouthClose");
      resolve();
    };
    audioEl.onended = finish;
    audioEl.onerror = finish;
    // A freshly-created AudioContext can start "suspended" (autoplay
    // policy) — this speak() call happens inside an async chat-response
    // callback, not a direct click handler, so it isn't guaranteed to count
    // as the kind of user-gesture continuation that auto-resumes a context.
    // Left unresumed, playback proceeds with zero audible output and no
    // error, same symptom as the crossOrigin bug above.
    audioCtx.resume().catch(() => {});
    audioEl.play().catch((err) => {
      console.error("[Local3DAvatar] audio playback failed:", err);
      finish();
    });
  });

  const speakViaBrowserSynthesis = (result) => new Promise((resolve) => {
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(result._text);
    utt.lang = result._language;
    if (result._voice) utt.voice = result._voice;
    currentUtterance = utt;

    let pulseUntil = 0;
    const pulseLoop = () => {
      if (!currentUtterance) return;
      const now = performance.now();
      const amplitude = now < pulseUntil ? 0.6 + 0.4 * Math.sin(now / 40) : 0;
      onAmplitudeCb?.(Math.max(0, amplitude));
      rafId = requestAnimationFrame(pulseLoop);
    };
    rafId = requestAnimationFrame(pulseLoop);

    utt.onboundary = () => { pulseUntil = performance.now() + 220; };
    const finish = () => {
      stopAmplitudeLoop();
      currentUtterance = null;
      onAmplitudeCb?.(0);
      onVisemeCb?.("mouthClose");
      resolve();
    };
    utt.onend = finish;
    utt.onerror = finish;
    window.speechSynthesis.speak(utt);
  });

  return {
    // onAmplitude(0..1) and onViseme(standardVisemeName) are both optional
    // — useLipSync only ever wires up whichever one the resolved morph-target
    // map actually supports (visemes if the model has viseme_* targets,
    // amplitude-driven jawOpen otherwise).
    // onSynthesisStart/onPlaybackStart let the caller show a distinct
    // "synthesizing…" state instead of nothing at all — a network-backed
    // provider (OpenVoiceClone) can take 10-30s+ to return, especially
    // under CPU/memory pressure, and without this the avatar just sits
    // idle with no visible sign anything is happening.
    async speak(text, { language, voice, voiceProfileId, onAmplitude, onViseme, onSynthesisStart, onPlaybackStart } = {}) {
      onAmplitudeCb = onAmplitude || null;
      onVisemeCb = onViseme || null;
      currentAbortController = new AbortController();
      const { signal } = currentAbortController;
      onSynthesisStart?.();
      let result;
      try {
        result = await ttsProvider.synthesize({ text, language, voice, voiceProfileId, signal });
      } catch (err) {
        if (err?.name === "AbortError") return; // superseded by a newer speak()/stop() — not a real failure
        throw err;
      }
      if (signal.aborted) return; // synthesis finished but was superseded before playback could start
      onPlaybackStart?.();
      if (result.audioUrl) {
        await speakViaAudioUrl(result);
      } else {
        await speakViaBrowserSynthesis(result);
      }
    },
    stop() {
      currentAbortController?.abort();
      currentAbortController = null;
      window.speechSynthesis?.cancel();
      currentUtterance = null;
      teardownAudio();
      onAmplitudeCb?.(0);
      onVisemeCb?.("mouthClose");
    },
    pause() {
      if (audioEl) audioEl.pause();
      else window.speechSynthesis?.pause();
    },
    resume() {
      if (audioEl) audioEl.play().catch(() => {});
      else window.speechSynthesis?.resume();
    },
  };
};

export default createLocalAvatarSpeechService;
