import { useEffect, useRef, useState } from "react";

const FISSURE_FRAME_IDS = [
  ...Array.from({ length: 18 }, (_, index) => index + 1),
  ...Array.from({ length: 10 }, (_, index) => index + 20),
];
const FISSURE_COUNT = FISSURE_FRAME_IDS.length;
const DEFAULT_BEAT_MS = 600;
const FISSURE_STEP_MS = 64;
const FISSURE_INTENSITY_GAMMA = 1.85;
const FISSURE_STARTUP_BOOST = 8;
const FISSURE_STARTUP_SECONDS = 18;
// Recalibrated for the complete 1–18, 20–29 snapshot sequence. Equal spacing keeps
// every authored frame reachable across the normalized audio-intensity range.
const FISSURE_AREA_PROGRESS = Array.from(
  { length: FISSURE_COUNT },
  (_, index) => index / (FISSURE_COUNT - 1),
);

const fissureUrl = (index) => `${import.meta.env.BASE_URL}fissure/${FISSURE_FRAME_IDS[index]}.webp`;
const intensityUrl = () => `${import.meta.env.BASE_URL}audio/login-intensity.json`;
let fissurePreparationPromise;

const prepareFissureAssets = () => {
  if (fissurePreparationPromise) return fissurePreparationPromise;

  const images = Array.from({ length: FISSURE_COUNT }, (_, index) => {
    const image = new Image();
    image.decoding = "async";
    image.src = fissureUrl(index);
    return image;
  });
  const imageDecodes = images.map((image) => (
    typeof image.decode === "function" ? image.decode() : Promise.resolve()
  ));
  const intensityTimeline = fetch(intensityUrl(), { cache: "force-cache" })
    .then((response) => {
      if (!response.ok) throw new Error(`Could not load music intensity: ${response.status}`);
      return response.json();
    })
    .then((data) => {
      const binary = window.atob(data.values);
      const values = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      return { stepSeconds: data.stepSeconds, values };
    });

  fissurePreparationPromise = Promise.all([...imageDecodes, intensityTimeline])
    .then((prepared) => ({ images, timeline: prepared[prepared.length - 1] }))
    .catch((error) => {
      fissurePreparationPromise = undefined;
      throw error;
    });
  return fissurePreparationPromise;
};

const frameForArea = (targetArea) => {
  let closestIndex = 0;
  let closestDistance = Infinity;
  FISSURE_AREA_PROGRESS.forEach((area, index) => {
    const distance = Math.abs(area - targetArea);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = index;
    }
  });
  return closestIndex;
};

export default function RandomFissureSeparator({ audioRef, onFrameChange, isPlaying = false }) {
  const preloadedImagesRef = useRef([]);
  const intensityTimelineRef = useRef(null);
  const [framesReady, setFramesReady] = useState(false);
  const [frame, setFrame] = useState(() => ({
    current: 0,
    transitionMs: 420,
  }));

  useEffect(() => {
    onFrameChange?.(frame.current);
  }, [frame.current, onFrameChange]);

  useEffect(() => {
    let cancelled = false;
    prepareFissureAssets().then(({ images, timeline }) => {
      if (cancelled) return;
      preloadedImagesRef.current = images;
      intensityTimelineRef.current = timeline;
      setFramesReady(true);
    });

    return () => {
      cancelled = true;
      preloadedImagesRef.current = [];
      intensityTimelineRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!framesReady) return undefined;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;

    const audio = audioRef.current;
    if (!audio) return undefined;

    let animationFrame = 0;
    let cancelled = false;
    const estimatedBeatMs = DEFAULT_BEAT_MS;
    let smoothedIntensity = 0;
    let selectedFrame = 0;
    let lastVisualChangeMs = -Infinity;
    let lastTransitionMs = 0;

    const showIntensityFrame = (intensity, force = false) => {
      const targetFrame = frameForArea(intensity);
      const nowMs = audio.currentTime * 1000;
      const distance = targetFrame - selectedFrame;
      if (distance === 0) return;

      const isIntermediateStep = Math.abs(distance) > 1;
      const nextFrame = isIntermediateStep
        ? selectedFrame + Math.sign(distance)
        : targetFrame;
      const transitionMs = isIntermediateStep
        ? FISSURE_STEP_MS
        : Math.round(Math.min(560, Math.max(280, estimatedBeatMs * 0.64)));

      // Finish the transition that is already visible before advancing. Large
      // jumps then cascade through every intervening authored frame in order.
      if (nowMs - lastVisualChangeMs < lastTransitionMs + 16) return;
      if (!force && !isIntermediateStep
        && Math.abs(intensity - FISSURE_AREA_PROGRESS[selectedFrame]) < 0.026) return;

      selectedFrame = nextFrame;
      lastVisualChangeMs = nowMs;
      lastTransitionMs = transitionMs;
      setFrame(() => ({
        current: nextFrame,
        transitionMs,
      }));
    };

    const analyseRhythm = () => {
      if (cancelled) return;
      if (!audio.paused) {
        const timeline = intensityTimelineRef.current;
        const timelinePosition = audio.currentTime / timeline.stepSeconds;
        const beforeIndex = Math.min(timeline.values.length - 1, Math.floor(timelinePosition));
        const afterIndex = Math.min(timeline.values.length - 1, beforeIndex + 1);
        const interpolation = timelinePosition - beforeIndex;
        const beforeIntensity = timeline.values[beforeIndex] / 255;
        const afterIntensity = timeline.values[afterIndex] / 255;
        const trackRelativeIntensity = beforeIntensity
          + (afterIntensity - beforeIntensity) * interpolation;
        // Require substantially stronger music before opening into frames 10–18.
        // Zero and full-scale peaks remain anchored to frames 1 and 18.
        const globallyDampedIntensity = trackRelativeIntensity ** FISSURE_INTENSITY_GAMMA;
        const startupProgress = Math.max(0, 1 - audio.currentTime / FISSURE_STARTUP_SECONDS);
        const startupGain = 1 + (FISSURE_STARTUP_BOOST - 1) * startupProgress;
        smoothedIntensity = Math.min(1, globallyDampedIntensity * startupGain);
        if (frameForArea(smoothedIntensity) !== selectedFrame) {
          showIntensityFrame(smoothedIntensity);
        }
      }
      animationFrame = window.requestAnimationFrame(analyseRhythm);
    };

    animationFrame = window.requestAnimationFrame(analyseRhythm);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(animationFrame);
    };
  }, [audioRef, framesReady]);

  return (
    <div
      className={`rhBoundarySeparator${isPlaying ? "" : " is-faded"}`}
      data-black-hole-item
      aria-hidden="true"
      style={{ "--rh-fissure-transition-ms": `${frame.transitionMs}ms` }}
    >
      {Array.from({ length: FISSURE_COUNT }, (_, index) => (
        <img
          key={index}
          className={`rhBoundarySeparatorFrame${index === frame.current ? " is-active" : ""}`}
          src={fissureUrl(index)}
          alt=""
        />
      ))}
    </div>
  );
}
