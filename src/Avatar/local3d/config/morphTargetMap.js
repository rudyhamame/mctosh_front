// Standard morph-target names this app's animation code asks for, and the
// real-world aliases different rigs/exporters commonly use for the same
// blend shape. AvatarModel.jsx is what actually resolves these against
// whatever a given .glb reports at load time — nothing here assumes the
// model uses any particular naming convention; this is just the candidate
// list AvatarModel.jsx tries, case-insensitively, in order, per standard
// name, falling back to "not present" (and logging that) rather than
// guessing wrong.

export const STANDARD_MORPH_TARGETS = [
  "jawOpen",
  "mouthClose",
  "mouthFunnel",
  "mouthPucker",
  "mouthSmile",
  "mouthFrown",
  "eyeBlinkLeft",
  "eyeBlinkRight",
  "browInnerUp",
  "browDownLeft",
  "browDownRight",
  "viseme_AA",
  "viseme_E",
  "viseme_I",
  "viseme_O",
  "viseme_U",
  "viseme_M",
  "viseme_F",
  "viseme_TH",
  "viseme_L",
  "viseme_R",
  "viseme_S",
];

// Aliases seen across common exporters (Ready Player Me/ARKit blend shapes,
// Mixamo-derived rigs, raw ARKit BlendShapeLocation names, etc.) — the
// standard name itself is always tried first.
export const MORPH_TARGET_ALIASES = {
  jawOpen: ["JawOpen", "jaw_open", "mouth_open", "MouthOpen"],
  mouthClose: ["MouthClose", "mouth_close"],
  mouthFunnel: ["MouthFunnel", "mouth_funnel"],
  mouthPucker: ["MouthPucker", "mouth_pucker"],
  mouthSmile: ["MouthSmile", "mouthSmileLeft", "mouthSmileRight", "mouth_smile"],
  mouthFrown: ["MouthFrown", "mouthFrownLeft", "mouthFrownRight", "mouth_frown"],
  eyeBlinkLeft: ["EyeBlinkLeft", "eye_blink_L", "blinkLeft", "Blink_L"],
  eyeBlinkRight: ["EyeBlinkRight", "eye_blink_R", "blinkRight", "Blink_R"],
  browInnerUp: ["BrowInnerUp", "brow_inner_up", "browsUp"],
  browDownLeft: ["BrowDownLeft", "brow_down_L"],
  browDownRight: ["BrowDownRight", "brow_down_R"],
  viseme_AA: ["viseme_aa", "vrc.v_aa", "AA"],
  viseme_E: ["viseme_e", "vrc.v_e", "E"],
  viseme_I: ["viseme_i", "vrc.v_i", "I"],
  viseme_O: ["viseme_o", "vrc.v_oh", "O"],
  viseme_U: ["viseme_u", "vrc.v_ou", "U"],
  viseme_M: ["viseme_PP", "viseme_m", "vrc.v_pp", "M"],
  viseme_F: ["viseme_FF", "viseme_f", "vrc.v_ff", "F"],
  viseme_TH: ["viseme_th", "vrc.v_th", "TH"],
  viseme_L: ["viseme_l", "vrc.v_l", "L"],
  viseme_R: ["viseme_RR", "viseme_r", "vrc.v_rr", "R"],
  viseme_S: ["viseme_SS", "viseme_s", "vrc.v_ss", "S"],
};

// Given the set of morph-target names a loaded model actually reports (a
// Set or array of strings), returns { standardName -> realName } for every
// standard name that could be resolved. Case-insensitive.
export const resolveMorphTargetMap = (availableNames) => {
  const lowerToReal = new Map();
  for (const name of availableNames) lowerToReal.set(String(name).toLowerCase(), name);

  const resolved = {};
  for (const standardName of STANDARD_MORPH_TARGETS) {
    const candidates = [standardName, ...(MORPH_TARGET_ALIASES[standardName] || [])];
    const match = candidates
      .map((c) => lowerToReal.get(c.toLowerCase()))
      .find((real) => real !== undefined);
    if (match) resolved[standardName] = match;
  }
  return resolved;
};

// Morph targets can be spread across several meshes in one .glb (separate
// head/teeth/eye/tongue meshes each with their own morphTargetDictionary) —
// this writes a standard-named weight to every mesh that actually has it,
// a no-op wherever a given mesh doesn't. Shared by every animation hook
// below rather than each reimplementing the same lookup.
export const applyMorphWeight = (meshesWithMorphs, standardToReal, standardName, weight) => {
  const realName = standardToReal[standardName];
  if (!realName) return;
  for (const mesh of meshesWithMorphs) {
    const index = mesh.morphTargetDictionary?.[realName];
    if (index !== undefined && mesh.morphTargetInfluences) {
      mesh.morphTargetInfluences[index] = weight;
    }
  }
};
