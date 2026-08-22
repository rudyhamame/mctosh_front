// Web Speech API adapter — the only TTSProvider that actually produces
// sound today (zero API keys, zero backend cost, exactly the mechanism
// HomeChat.jsx's own speak() fallback already uses for Anam-unavailable
// cases). The Web Speech API has no way to hand back a playable audio
// blob/URL, and its own audio output never passes through an accessible Web
// Audio graph in any browser — so synthesize() only resolves metadata (an
// estimated duration); it does not speak. localAvatarSpeechService.js is
// what actually calls speechSynthesis.speak() once it sees this provider
// returned no audioUrl, driving lip movement from utterance boundary events
// instead of real amplitude analysis (see that file for why).

// Same heuristic HomeChat.jsx's own estimateSpeakingMs already uses, for
// consistency across the app wherever a spoken-duration guess is needed.
const estimateDurationMs = (text) => Math.max(400, String(text || "").length * 55);

export const listBrowserVoices = () => window.speechSynthesis?.getVoices() || [];

const pickVoice = (language, voiceURI) => {
  const voices = listBrowserVoices();
  if (voiceURI) {
    const exact = voices.find((v) => v.voiceURI === voiceURI);
    if (exact) return exact;
  }
  const lang = language || "en-US";
  const primary = lang.split("-")[0];
  return voices.find((v) => v.lang === lang && v.localService)
    || voices.find((v) => v.lang?.startsWith(primary) && v.localService)
    || voices.find((v) => v.lang?.startsWith(primary))
    || voices[0]
    || null;
};

// Factory, not a class — this codebase has no ES classes anywhere else
// (plain functions/hooks throughout), matched here for consistency.
export const createBrowserTTSProvider = () => ({
  async synthesize({ text, language, voice } = {}) {
    if (!window.speechSynthesis) {
      throw new Error("BrowserTTSProvider: speechSynthesis is not available in this browser.");
    }
    return {
      audioUrl: null, // no accessible audio output from the Web Speech API — see file header
      durationMs: estimateDurationMs(text),
      visemes: null,  // no phoneme/viseme timing available from this API
      // Not part of the public TTSProvider return shape — localAvatarSpeechService
      // reads these to actually drive speechSynthesis directly, since this
      // is the one adapter with no audioUrl to hand back instead.
      _text: text,
      _language: language || "en-US",
      _voice: pickVoice(language, voice),
    };
  },
});

export default createBrowserTTSProvider;
