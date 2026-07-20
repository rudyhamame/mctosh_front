// Real, self-hosted, free adapter — calls back/routes/TTSAPI.js's POST
// /api/tts/kokoro/synthesize (Kokoro running on the back/kokoro-tts/ Python
// microservice; see its README for the pipeline). Not a voice clone — a
// single fixed good-quality voice, no voice profile needed, unlike
// OpenVoiceCloneProvider.js. Otherwise the exact same shape: a real
// playable audioUrl, so localAvatarSpeechService.js's existing
// speakViaAudioUrl path (real AnalyserNode amplitude analysis) drives
// jawOpen automatically — no changes needed there. visemes is always null
// today (no phoneme/viseme timing from this pipeline), which that same
// existing code already treats as "fall back to amplitude".
// Factory, not a class — matches every other adapter in this folder.
import { apiUrl } from "../../../../config/api";
import { readStoredSession } from "../../../../utils/sessionCleanup";

export const createKokoroTTSProvider = () => ({
  async synthesize({ text, signal } = {}) {
    const token = readStoredSession()?.token || "";
    const res = await fetch(apiUrl("/api/tts/kokoro/synthesize"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ text }),
      signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error || `KokoroTTSProvider: synthesis failed (${res.status}).`);
    }
    return {
      audioUrl: data.audioUrl,
      durationMs: data.durationMs,
      visemes: data.visemes || null,
    };
  },
});

export default createKokoroTTSProvider;
