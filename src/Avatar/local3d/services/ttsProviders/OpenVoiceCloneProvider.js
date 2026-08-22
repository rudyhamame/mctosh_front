// Real, self-hosted voice-cloning adapter — calls back/routes/TTSAPI.js's
// POST /api/tts/openvoice/synthesize (OpenVoice + MeloTTS running on the
// back/voice-clone/ Python microservice; see its README for the pipeline).
// Unlike BrowserTTSProvider, this returns a REAL playable audioUrl, so
// localAvatarSpeechService.js's existing speakViaAudioUrl path (real
// AnalyserNode amplitude analysis, built for the avatar-provider work) drives
// jawOpen for it automatically — no changes needed there. visemes is always
// null today (no phoneme/viseme timing from this pipeline yet), which the
// same existing code already treats as "fall back to amplitude", so this is
// forward-compatible, not a placeholder needing follow-up wiring.
// Factory, not a class — matches every other adapter in this folder.
import { apiUrl } from "../../../../config/api";
import { readStoredSession } from "../../../../utils/sessionCleanup";

export const createOpenVoiceCloneProvider = () => ({
  async synthesize({ text, language, voiceProfileId, signal } = {}) {
    if (!voiceProfileId) {
      throw new Error(
        "OpenVoiceCloneProvider: no voice profile selected — record or upload one on the Voice Profile page first."
      );
    }
    const token = readStoredSession()?.token || "";
    const res = await fetch(apiUrl("/api/tts/openvoice/synthesize"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ text, language: language || "en", voiceProfileId }),
      signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error || `OpenVoiceCloneProvider: synthesis failed (${res.status}).`);
    }
    return {
      audioUrl: data.audioUrl,
      durationMs: data.durationMs,
      visemes: data.visemes || null,
    };
  },
});

export default createOpenVoiceCloneProvider;
