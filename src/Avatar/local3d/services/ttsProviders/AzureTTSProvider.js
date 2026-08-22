// Stub adapter — implements the same TTSProvider shape as
// BrowserTTSProvider, but has nothing real to call yet. Azure Speech needs
// a subscription key, which must never reach the frontend (per spec) — a
// real implementation would proxy through a new backend route that doesn't
// exist in this build (no credentials to test against). synthesize()
// rejects clearly so localAvatarSpeechService/callers can catch it and fall
// back to BrowserTTSProvider, rather than silently doing nothing.
// Factory, not a class — matches BrowserTTSProvider.js and the rest of the
// codebase's plain-function style.
export const createAzureTTSProvider = () => ({
  async synthesize() {
    throw new Error(
      "AzureTTSProvider is not configured — it needs a backend proxy route " +
      "(to keep the Azure key server-side) that doesn't exist yet. Use " +
      "BrowserTTSProvider, or add /api/tts/azure + AZURE_SPEECH_KEY and " +
      "wire this adapter to call it."
    );
  },
});

export default createAzureTTSProvider;
