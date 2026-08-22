// Maps a TTS provider's own viseme/phoneme codes to this app's standard
// viseme_* morph-target names (see morphTargetMap.js). Different TTS
// engines report visemes differently — Azure's Speech SDK uses numeric
// viseme IDs (0-21, Microsoft's own SAPI viseme set), other engines use
// short phonetic codes. BrowserTTSProvider (Web Speech API) has no
// standardized phoneme/viseme timing at all across browsers, so it never
// populates `visemes` — useLipSync falls back to jawOpen + audio-amplitude
// for that provider, exactly per spec. This map only matters once a
// provider that DOES supply real viseme timing (e.g. a future Azure
// adapter) is wired in.

// Microsoft Azure Speech SDK viseme ID -> standard viseme name (Azure's own
// documented viseme-to-phoneme table, condensed to this app's smaller set).
export const AZURE_VISEME_ID_MAP = {
  0: "mouthClose", // silence
  1: "viseme_AA",
  2: "viseme_AA",
  3: "viseme_O",
  4: "viseme_E",
  5: "viseme_E",
  6: "viseme_I",
  7: "viseme_U",
  8: "viseme_O",
  9: "viseme_O",
  10: "viseme_S",
  11: "viseme_R",
  12: "viseme_S",
  13: "viseme_TH",
  14: "viseme_F",
  15: "viseme_TH",
  16: "viseme_L",
  17: "viseme_R",
  18: "viseme_M",
  19: "viseme_M",
  20: "viseme_F",
  21: "viseme_L",
};

// Short phonetic-code fallback for adapters that report letters/codes
// instead of Azure's numeric IDs.
export const PHONETIC_CODE_VISEME_MAP = {
  AA: "viseme_AA", E: "viseme_E", I: "viseme_I", O: "viseme_O", U: "viseme_U",
  M: "viseme_M", P: "viseme_M", B: "viseme_M",
  F: "viseme_F", V: "viseme_F",
  TH: "viseme_TH", DH: "viseme_TH",
  L: "viseme_L", R: "viseme_R", S: "viseme_S", Z: "viseme_S",
  sil: "mouthClose",
};

export const resolveVisemeName = (code) => {
  if (code == null) return "mouthClose";
  if (typeof code === "number") return AZURE_VISEME_ID_MAP[code] || "mouthClose";
  return PHONETIC_CODE_VISEME_MAP[String(code).toUpperCase()] || "mouthClose";
};
