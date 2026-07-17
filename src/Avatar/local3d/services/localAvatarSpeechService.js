// Orchestrates a TTSProvider (see ttsProviders/) into actual audio playback
// plus a live amplitude/viseme feed for useLipSync to animate the model
// from. Two real paths, chosen per-call based on what the provider actually
// returned:
//
//   1. Provider returned a real audioUrl (a hosted TTS result, e.g.
//      OpenVoiceClone) — fetched and decoded into an AudioBuffer, played via
//      an AudioBufferSourceNode wired into a real Web Audio AnalyserNode, so
//      amplitude is genuine RMS of the actual output. If the provider also
//      supplied a viseme timeline, that drives the mouth shape directly
//      instead (more accurate than amplitude); amplitude is the fallback.
//      Deliberately NOT an <audio> element routed through
//      createMediaElementSource() — that combination is a long-documented
//      source of silent-playback bugs specifically on Safari/WebKit (iOS in
//      particular), even with crossOrigin set and correct CORS headers on
//      the resource. fetch()+decodeAudioData()+AudioBufferSourceNode only
//      needs CORS for the fetch() itself (which is the well-supported,
//      reliable path everywhere, including iOS Safari) and never touches
//      that WebKit-specific quirk at all.
//   2. Provider returned no audioUrl (BrowserTTSProvider's only case, since
//      the Web Speech API exposes no accessible audio buffer in any
//      browser) — speechSynthesis.speak() is called directly here, and
//      mouth movement is a synthetic pulse timed off the utterance's own
//      onboundary (word-boundary) events. This is NOT real amplitude
//      analysis — the platform has no way to provide that for
//      speechSynthesis output — it's the standard workaround other
//      browser-TTS-driven avatars use too.
export const createLocalAvatarSpeechService = (ttsProvider) => {
  let bufferSource = null; // current AudioBufferSourceNode, if a real-audioUrl reply is playing
  let currentBuffer = null; // its decoded AudioBuffer — kept for pause/resume-by-offset
  let playStartedAtCtxTime = 0; // audioCtx.currentTime when the current segment started
  let pausedOffset = 0; // seconds into currentBuffer we'd resume from
  // One AudioContext for the whole service's lifetime, not one per speak()
  // call. A context created fresh right as an async chat reply arrives
  // (not inside a real click/keypress handler) is exactly the case
  // browsers' autoplay policy targets — resume() can silently reject and
  // leave it "suspended" forever, producing dead-silent output with no
  // visible error. A single context created lazily on the FIRST speak()
  // call — which in practice always follows the user's own action of
  // sending a message — only has to clear that bar once; every later
  // speak() reuses the same (by then already-running) context instead of
  // re-litigating the autoplay check from scratch.
  let sharedAudioCtx = null;
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

  const getAudioContext = () => {
    if (!sharedAudioCtx) sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return sharedAudioCtx;
  };

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
    if (bufferSource) {
      bufferSource.onended = null; // about to stop it ourselves — not a natural finish
      try { bufferSource.stop(); } catch { /* already stopped/never started — fine */ }
      bufferSource = null;
    }
    currentBuffer = null;
    pausedOffset = 0;
    // sharedAudioCtx is deliberately NOT closed here — see getAudioContext.
    analyser = null;
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

  const speakViaAudioUrl = (result, signal) => new Promise((resolve, reject) => {
    const audioCtx = getAudioContext();

    const startPlayback = (decoded) => {
      if (signal?.aborted) { resolve(); return; } // superseded while we were fetching/decoding
      currentBuffer = decoded;
      pausedOffset = 0;

      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
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

      const source = audioCtx.createBufferSource();
      source.buffer = decoded;
      source.connect(analyser);
      source.onended = finish;
      bufferSource = source;
      playStartedAtCtxTime = audioCtx.currentTime;

      // A suspended context produces dead-silent output with no error and
      // no visible symptom other than "nothing happened" — logged
      // explicitly (not swallowed) so a resume failure is actually
      // diagnosable instead of indistinguishable from every other kind of
      // silent failure.
      audioCtx.resume()
        .then(() => {
          if (audioCtx.state !== "running") {
            console.warn("[Local3DAvatar] AudioContext did not reach 'running' after resume() — state:", audioCtx.state, "(likely blocked by the browser's autoplay policy; playback will be silent until the page gets a direct user gesture, e.g. a tap on the chat panel)");
          }
        })
        .catch((err) => {
          console.warn("[Local3DAvatar] AudioContext.resume() failed — playback will be silent:", err);
        });
      try {
        source.start(0);
      } catch (err) {
        console.error("[Local3DAvatar] AudioBufferSourceNode.start() failed:", err);
        finish();
      }
    };

    fetch(result.audioUrl, { signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Fetching synthesized audio failed (${res.status})`);
        return res.arrayBuffer();
      })
      .then((bytes) => audioCtx.decodeAudioData(bytes))
      .then(startPlayback)
      .catch((err) => {
        if (err?.name === "AbortError") { resolve(); return; } // superseded — not a real failure
        console.error("[Local3DAvatar] failed to fetch/decode synthesized audio:", err);
        reject(err);
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
        await speakViaAudioUrl(result, signal);
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
      if (bufferSource && sharedAudioCtx) {
        pausedOffset += sharedAudioCtx.currentTime - playStartedAtCtxTime;
        bufferSource.onended = null;
        try { bufferSource.stop(); } catch { /* already stopped — fine */ }
        bufferSource = null;
      } else {
        window.speechSynthesis?.pause();
      }
    },
    resume() {
      // AudioBufferSourceNode has no native pause/resume (start() can only
      // ever be called once per node) — re-created from the same decoded
      // buffer at the offset pause() recorded, rather than restarting from
      // the beginning.
      if (currentBuffer && sharedAudioCtx && analyser) {
        const source = sharedAudioCtx.createBufferSource();
        source.buffer = currentBuffer;
        source.connect(analyser);
        source.onended = () => { teardownAudio(); onVisemeCb?.("mouthClose"); };
        bufferSource = source;
        playStartedAtCtxTime = sharedAudioCtx.currentTime;
        source.start(0, Math.min(pausedOffset, currentBuffer.duration));
      } else {
        window.speechSynthesis?.resume();
      }
    },
    // Must be called synchronously inside a real user gesture (a click/tap
    // event handler, not an async callback) — same rule and same reason as
    // HomeChat.jsx's own unlockSpeech() for the Web Speech API, just for
    // the separate AudioContext gate a network-backed provider
    // (OpenVoiceClone) actually uses. Without this, speak() only ever
    // creates/resumes the shared AudioContext from inside an async
    // chat-response callback, which iOS Safari in particular does NOT
    // count as gesture-adjacent — resume() silently stays "suspended"
    // forever, and playback is dead silent with no error.
    unlockAudio() {
      const ctx = getAudioContext();
      ctx.resume().catch(() => {});
      // Also unlocks a silent AudioBufferSourceNode blip through the same
      // context — belt-and-suspenders alongside resume() above, since some
      // WebKit versions have historically tied the "is audio unlocked"
      // flag to an actual node having been started inside a gesture, not
      // just resume() being called.
      try {
        const blip = ctx.createBuffer(1, 1, ctx.sampleRate);
        const src = ctx.createBufferSource();
        src.buffer = blip;
        src.connect(ctx.destination);
        src.start(0);
      } catch { /* best-effort — resume() above is the primary unlock */ }
    },
  };
};

export default createLocalAvatarSpeechService;
