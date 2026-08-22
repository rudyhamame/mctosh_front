// Local3D avatar voice settings — split out of Local3DAvatarView.jsx so
// SettingsPage.jsx (which needs these to build the "Local 3D Voice" picker)
// doesn't have to import the whole Three.js/@react-three/fiber avatar
// component just to read a couple of localStorage keys; Local3DAvatarView
// imports these back from here rather than defining its own copies.
export const VOICE_SETTINGS_KEY = "mctosh_avatar_voice_local3d";
export const DEFAULT_KOKORO_VOICE = "af_heart";
export const DEFAULT_SUPERTONIC_VOICE = "F4";
export const KOKORO_VOICE_OPTIONS = [
  { id: "af_alloy", label: "Alloy" },
  { id: "af_aoede", label: "Aoede" },
  { id: "af_bella", label: "Bella" },
  { id: "af_heart", label: "Heart" },
  { id: "af_jessica", label: "Jessica" },
  { id: "af_kore", label: "Kore" },
  { id: "af_nicole", label: "Nicole" },
  { id: "af_nova", label: "Nova" },
  { id: "af_river", label: "River" },
  { id: "af_sarah", label: "Sarah" },
  { id: "af_sky", label: "Sky" },
  { id: "am_adam", label: "Adam" },
  { id: "am_echo", label: "Echo" },
  { id: "am_eric", label: "Eric" },
  { id: "am_fenrir", label: "Fenrir" },
  { id: "am_liam", label: "Liam" },
  { id: "am_michael", label: "Michael" },
  { id: "am_onyx", label: "Onyx" },
  { id: "am_puck", label: "Puck" },
  { id: "am_santa", label: "Santa" },
  { id: "bf_alice", label: "Alice" },
  { id: "bf_emma", label: "Emma" },
  { id: "bf_isabella", label: "Isabella" },
  { id: "bf_lily", label: "Lily" },
  { id: "bm_daniel", label: "Daniel" },
  { id: "bm_fable", label: "Fable" },
  { id: "bm_george", label: "George" },
  { id: "bm_lewis", label: "Lewis" },
  { id: "ef_dora", label: "Dora" },
  { id: "em_alex", label: "Alex" },
  { id: "em_santa", label: "Santa" },
  { id: "ff_siwis", label: "Siwis" },
  { id: "hf_alpha", label: "Alpha" },
  { id: "hf_beta", label: "Beta" },
  { id: "hm_omega", label: "Omega" },
  { id: "hm_psi", label: "Psi" },
  { id: "if_sara", label: "Sara" },
  { id: "im_nicola", label: "Nicola" },
  { id: "jf_alpha", label: "Alpha JP" },
  { id: "jf_gongitsune", label: "Gongitsune" },
];
export const SUPERTONIC_VOICE_OPTIONS = [
  { id: "M1", label: "M1" },
  { id: "M2", label: "M2" },
  { id: "M3", label: "M3" },
  { id: "M4", label: "M4" },
  { id: "M5", label: "M5" },
  { id: "F1", label: "F1" },
  { id: "F2", label: "F2" },
  { id: "F3", label: "F3" },
  { id: "F4", label: "F4" },
  { id: "F5", label: "F5" },
];

const buildDefaultVoiceSettings = () => ({
  language: "en-US",
  voiceURI: null,
  voiceProfileId: null,
  kokoroVoice: DEFAULT_KOKORO_VOICE,
  supertonicVoice: DEFAULT_SUPERTONIC_VOICE,
});

export const readVoiceSettings = () => {
  try {
    const raw = localStorage.getItem(VOICE_SETTINGS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return { ...buildDefaultVoiceSettings(), ...(parsed || {}) };
  } catch {
    return buildDefaultVoiceSettings();
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
export const TTS_PROVIDERS = {
  BROWSER: "browser",
  OPENVOICE: "openvoice",
  KOKORO: "kokoro",
  SUPERTONIC: "supertonic",
};
export const readTtsProviderId = () => {
  const stored = localStorage.getItem(TTS_PROVIDER_SETTINGS_KEY);
  return Object.values(TTS_PROVIDERS).includes(stored) ? stored : TTS_PROVIDERS.SUPERTONIC;
};
export const writeTtsProviderId = (id) => {
  localStorage.setItem(TTS_PROVIDER_SETTINGS_KEY, id);
};
