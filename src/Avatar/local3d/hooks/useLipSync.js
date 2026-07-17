import { useCallback, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { applyMorphWeight, STANDARD_MORPH_TARGETS } from "../config/morphTargetMap";

const VISEME_TARGET_NAMES = STANDARD_MORPH_TARGETS.filter((name) => name.startsWith("viseme_"));

// Drives mouth shape from whichever channel localAvatarSpeechService.js is
// actually feeding: a live viseme name (precise, only ever available from a
// provider that returns real phoneme timing) or a 0..1 amplitude value
// (the fallback — always available, since BrowserTTSProvider's synthetic
// pulse and a future real audio-analysis path both speak this same
// language). If the loaded model has no viseme_* morph targets at all,
// amplitude-driven jawOpen is used even when a viseme value comes in —
// there's nothing to apply it to otherwise.
export const useLipSync = ({ meshesWithMorphs, standardToReal }) => {
  const amplitudeRef = useRef(0);
  const activeVisemeRef = useRef(null);
  const hasVisemeSupport = VISEME_TARGET_NAMES.some((name) => standardToReal[name]);

  const onAmplitude = useCallback((value) => { amplitudeRef.current = value; }, []);
  const onViseme = useCallback((visemeName) => { activeVisemeRef.current = visemeName; }, []);

  useFrame(() => {
    if (hasVisemeSupport && activeVisemeRef.current) {
      for (const name of VISEME_TARGET_NAMES) {
        applyMorphWeight(meshesWithMorphs, standardToReal, name, name === activeVisemeRef.current ? 1 : 0);
      }
      return;
    }
    applyMorphWeight(meshesWithMorphs, standardToReal, "jawOpen", amplitudeRef.current);
  });

  return { onAmplitude, onViseme };
};

export default useLipSync;
