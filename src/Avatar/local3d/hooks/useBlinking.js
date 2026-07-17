import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { applyMorphWeight } from "../config/morphTargetMap";

// Natural randomized-interval blink — 2.5-6s apart (real human blink rate),
// not a fixed metronome, with a quick 140ms triangle-envelope close/open
// rather than an instant snap.
const randomBlinkIntervalMs = () => 2500 + Math.random() * 3500;
const BLINK_DURATION_MS = 140;

export const useBlinking = ({ meshesWithMorphs, standardToReal, enabled = true }) => {
  const nextBlinkAt = useRef(performance.now() + randomBlinkIntervalMs());
  const blinkStartedAt = useRef(0); // 0 = not currently blinking

  useFrame(() => {
    if (!enabled) return;
    const now = performance.now();

    if (!blinkStartedAt.current && now >= nextBlinkAt.current) {
      blinkStartedAt.current = now;
    }

    if (blinkStartedAt.current) {
      const elapsed = now - blinkStartedAt.current;
      const t = elapsed / BLINK_DURATION_MS;
      if (t >= 1) {
        blinkStartedAt.current = 0;
        nextBlinkAt.current = now + randomBlinkIntervalMs();
        applyMorphWeight(meshesWithMorphs, standardToReal, "eyeBlinkLeft", 0);
        applyMorphWeight(meshesWithMorphs, standardToReal, "eyeBlinkRight", 0);
      } else {
        const weight = t < 0.5 ? t * 2 : (1 - t) * 2; // open -> closed -> open
        applyMorphWeight(meshesWithMorphs, standardToReal, "eyeBlinkLeft", weight);
        applyMorphWeight(meshesWithMorphs, standardToReal, "eyeBlinkRight", weight);
      }
    }
  });
};

export default useBlinking;
