// Stub adapter — reserved slot for a future Kokoro TTS integration (a free,
// open-weight model), not wired to anything real yet. Same "not configured"
// pattern as AzureTTSProvider.js: synthesize() rejects clearly so callers
// fall back to BrowserTTSProvider instead of silently doing nothing.
// Factory, not a class — matches every other adapter in this folder.
export const createKokoroTTSProvider = () => ({
  async synthesize() {
    throw new Error(
      "KokoroTTSProvider is not implemented yet — it's a reserved slot for " +
      "a future self-hosted Kokoro TTS integration. Use Browser Speech " +
      "Synthesis or OpenVoiceClone for now."
    );
  },
});

export default createKokoroTTSProvider;
