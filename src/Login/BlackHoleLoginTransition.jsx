import { useCallback, useEffect, useRef } from "react";
import "./blackHoleLoginTransition.css";

const TRANSITION_FALLBACK_MS = 15200;
const REDUCED_MOTION_FALLBACK_MS = 15200;
const HOME_ENTRY_SIGNAL = "rabbit-hole-home-entry";

export default function BlackHoleLoginTransition({ active, onComplete }) {
  const completeRef = useRef(onComplete);
  const hasCompletedRef = useRef(false);

  useEffect(() => {
    completeRef.current = onComplete;
  }, [onComplete]);

  const finishTransition = useCallback(() => {
    if (hasCompletedRef.current) return;
    hasCompletedRef.current = true;
    try {
      window.sessionStorage.setItem(HOME_ENTRY_SIGNAL, "1");
    } catch {
      // The transition still completes when storage is unavailable.
    }
    completeRef.current?.();
  }, []);

  useEffect(() => {
    if (!active) {
      hasCompletedRef.current = false;
      return undefined;
    }

    hasCompletedRef.current = false;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const fallbackTimer = window.setTimeout(
      finishTransition,
      reducedMotion ? REDUCED_MOTION_FALLBACK_MS : TRANSITION_FALLBACK_MS,
    );
    return () => window.clearTimeout(fallbackTimer);
  }, [active, finishTransition]);

  if (!active) return null;

  return (
    <div className="blackHoleLoginTransition" aria-hidden="true">
      <img
        className="blackHoleLoginTransition__logo"
        src={`${import.meta.env.BASE_URL}logo.png`}
        alt=""
        draggable="false"
        onAnimationEnd={finishTransition}
      />
    </div>
  );
}
