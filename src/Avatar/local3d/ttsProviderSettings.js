// Local3D avatar voice settings — split out of Local3DAvatarView.jsx so
// SettingsPage.jsx (which needs these to build the "Local 3D Voice" picker)
// doesn't have to import the whole Three.js/@react-three/fiber avatar
// component just to read a couple of localStorage keys; Local3DAvatarView
// imports these back from here rather than defining its own copies.
export const VOICE_SETTINGS_KEY = "mctosh_avatar_voice_local3d";
export const readVoiceSettings = () => {
  try {
    const raw = localStorage.getItem(VOICE_SETTINGS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return { language: "en-US", voiceURI: null, voiceProfileId: null, ...(parsed || {}) };
  } catch {
    return { language: "en-US", voiceURI: null, voiceProfileId: null };
  }
};
export const writeVoiceSettings = (patch) => {
  const next = { ...readVoiceSettings(), ...patch };
  localStorage.setItem(VOICE_SETTINGS_KEY, JSON.stringify(next));
  return next;
};

// Which TTS engine speaks for the local 3D avatar — separate from
// AvatarProviderContext's anam/local3d choice (that's ANAM vs local 3D as a
// whole; this is a nested setting that only matters once "local3d" is
// picked).
export const TTS_PROVIDER_SETTINGS_KEY = "mctosh_local3d_tts_provider";
export const TTS_PROVIDERS = { BROWSER: "browser", OPENVOICE: "openvoice", KOKORO: "kokoro" };
export const readTtsProviderId = () => {
  const stored = localStorage.getItem(TTS_PROVIDER_SETTINGS_KEY);
  return Object.values(TTS_PROVIDERS).includes(stored) ? stored : TTS_PROVIDERS.BROWSER;
};
export const writeTtsProviderId = (id) => {
  localStorage.setItem(TTS_PROVIDER_SETTINGS_KEY, id);
};
