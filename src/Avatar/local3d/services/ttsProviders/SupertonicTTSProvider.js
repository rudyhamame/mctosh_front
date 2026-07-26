import { apiUrl } from "../../../../config/api";
import { readStoredSession } from "../../../../utils/sessionCleanup";

export const createSupertonicTTSProvider = () => ({
  async synthesize({ text, language, supertonicVoice, signal } = {}) {
    const token = readStoredSession()?.token || "";
    const res = await fetch(apiUrl("/api/tts/supertonic/synthesize"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        text,
        language,
        voice: supertonicVoice,
      }),
      signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error || data?.error?.message || `SupertonicTTSProvider: synthesis failed (${res.status}).`);
    }
    return {
      audioUrl: data.audioUrl,
      durationMs: data.durationMs,
      visemes: data.visemes || null,
    };
  },
});

export default createSupertonicTTSProvider;
