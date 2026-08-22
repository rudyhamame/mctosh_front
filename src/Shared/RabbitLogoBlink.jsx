import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import "./rabbitLogoBlink.css";

const FRAME_COUNT = 10;
const CLOSE_DELAYS = [25, 25, 25, 25, 25, 25, 25, 25, 30];
const OPEN_DELAYS = [30, 30, 30, 35, 35, 40, 40, 45, 45];
const DIVE_DOWN_DELAYS = [55, 55, 60, 65, 80];
const DIVE_UP_DELAYS = [80, 65, 60, 55];
const APPEAR_DELAYS = [85, 85, 90, 90, 95, 100, 100, 105, 110];
const APPEAR_HOLD_MS = 260;
const CLOSED_HOLD_MS = 65;
const DIVE_HOLD_MS = 150;
const DOUBLE_BLINK_PROBABILITY = 0.12;
const MUSIC_INTENSITY_THRESHOLD = 0.12;
const MUSIC_FRAME_STEP_MS = 260;

const frameUrls = (prefix) => Object.freeze(
  Array.from({ length: FRAME_COUNT }, (_, index) => `${import.meta.env.BASE_URL}logo/${prefix}${index + 1}.webp`),
);

export const RABBIT_LOGO_BLINK_FRAMES = frameUrls("logo");
export const RABBIT_LOGO_HOLE_FRAMES = frameUrls("move");
export const RABBIT_LOGO_APPEAR_FRAMES = frameUrls("appear/");
export const RABBIT_LOGO_LISTENING_FRAMES = frameUrls("listening/");
export const RABBIT_LOGO_SPEAKING_FRAMES = frameUrls("speaking/");
export const RABBIT_LOGO_TYPING_FRAMES = frameUrls("typing/");
export const RABBIT_LOGO_ALL_FRAMES = Object.freeze([
  ...RABBIT_LOGO_BLINK_FRAMES,
  ...RABBIT_LOGO_HOLE_FRAMES,
  ...RABBIT_LOGO_APPEAR_FRAMES,
  ...RABBIT_LOGO_LISTENING_FRAMES,
  ...RABBIT_LOGO_SPEAKING_FRAMES,
  ...RABBIT_LOGO_TYPING_FRAMES,
]);

const randomDelay = (minimum, maximum) => minimum + Math.floor(Math.random() * (maximum - minimum + 1));

const RabbitLogoBlink = forwardRef(function RabbitLogoBlink({ alt = "", className = "", imageClassName = "", onPointerEnter, musicPlaying = false, musicAudioRef = null, clickToAppear = false, blinkOnly = false, ...imageProps }, ref) {
  const idleFrame = clickToAppear ? RABBIT_LOGO_APPEAR_FRAMES[0] : RABBIT_LOGO_BLINK_FRAMES[0];
  const [src, setSrc] = useState(idleFrame);
  const [isLoaded, setIsLoaded] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const animationStateRef = useRef("idle");
  const animationTokenRef = useRef(0);
  const pendingDiveRef = useRef(false);
  const mountedRef = useRef(false);
  const visibleRef = useRef(true);
  const blinkTimerRef = useRef(null);
  const diveTimerRef = useRef(null);
  const frameTimerRef = useRef(null);
  const scheduleRef = useRef(null);
  const musicRafRef = useRef(null);
  const musicAudioContextRef = useRef(null);
  const musicAnalyserRef = useRef(null);
  const musicSourceRef = useRef(null);
  const musicIntensityRef = useRef(0);
  const musicTargetIntensityRef = useRef(0);
  const musicLastFrameAtRef = useRef(0);
  const musicFrameRef = useRef(0);

  const clearTimer = (timerRef) => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const clearIdleTimers = useCallback(() => {
    clearTimer(blinkTimerRef);
    clearTimer(diveTimerRef);
  }, []);

  const resetToIdle = useCallback(() => {
    animationTokenRef.current += 1;
    clearTimer(frameTimerRef);
    animationStateRef.current = "idle";
    if (mountedRef.current) setSrc(idleFrame);
  }, [idleFrame]);

  const sleep = useCallback((milliseconds, token) => new Promise((resolve) => {
    frameTimerRef.current = window.setTimeout(() => {
      frameTimerRef.current = null;
      resolve(mountedRef.current && visibleRef.current && animationTokenRef.current === token);
    }, milliseconds);
  }), []);

  const finishAnimation = useCallback(() => {
    resetToIdle();
    if (mountedRef.current && isLoaded && !reducedMotion && !musicPlaying && visibleRef.current) scheduleRef.current?.();
  }, [isLoaded, musicPlaying, reducedMotion, resetToIdle]);

  const playAppear = useCallback(async () => {
    if (!isLoaded || reducedMotion || !visibleRef.current || animationStateRef.current === "appearing") return false;
    clearIdleTimers();
    animationStateRef.current = "appearing";
    const token = ++animationTokenRef.current;
    for (let index = 0; index < FRAME_COUNT; index += 1) {
      if (index > 0 && !(await sleep(APPEAR_DELAYS[index - 1], token))) return false;
      setSrc(RABBIT_LOGO_APPEAR_FRAMES[index]);
    }
    if (!(await sleep(APPEAR_HOLD_MS, token))) return false;
    finishAnimation();
    return true;
  }, [clearIdleTimers, finishAnimation, isLoaded, reducedMotion, sleep]);

  const playBlink = useCallback(async () => {
    if (!isLoaded || reducedMotion || musicPlaying || !visibleRef.current || animationStateRef.current !== "idle") return false;
    // Keep the independent dive timer alive. If it expires during this blink,
    // playDive() records one pending dive and starts it after the eye reopens.
    clearTimer(blinkTimerRef);
    animationStateRef.current = "blinking";
    const token = ++animationTokenRef.current;
    for (let index = 1; index < FRAME_COUNT; index += 1) {
      if (!(await sleep(CLOSE_DELAYS[index - 1], token))) return false;
      setSrc(RABBIT_LOGO_BLINK_FRAMES[index]);
    }
    if (!(await sleep(CLOSED_HOLD_MS, token))) return false;
    for (let index = FRAME_COUNT - 2; index >= 0; index -= 1) {
      if (!(await sleep(OPEN_DELAYS[FRAME_COUNT - 2 - index], token))) return false;
      setSrc(RABBIT_LOGO_BLINK_FRAMES[index]);
    }
    finishAnimation();
    if (pendingDiveRef.current) {
      pendingDiveRef.current = false;
      diveTimerRef.current = window.setTimeout(() => {
        diveTimerRef.current = null;
        void playDive();
      }, 0);
    } else if (Math.random() < DOUBLE_BLINK_PROBABILITY) {
      clearTimer(blinkTimerRef);
      blinkTimerRef.current = window.setTimeout(() => {
        blinkTimerRef.current = null;
        void playBlink();
      }, randomDelay(120, 220));
    }
    return true;
  }, [clearIdleTimers, finishAnimation, isLoaded, musicPlaying, reducedMotion, sleep]);

  const playDive = useCallback(async () => {
    if (blinkOnly) return false;
    if (animationStateRef.current === "blinking") {
      pendingDiveRef.current = true;
      return false;
    }
    if (!isLoaded || reducedMotion || musicPlaying || !visibleRef.current || animationStateRef.current !== "idle") return false;
    clearIdleTimers();
    animationStateRef.current = "diving";
    const token = ++animationTokenRef.current;
    setSrc(RABBIT_LOGO_HOLE_FRAMES[0]);
    for (let index = 1; index < 6; index += 1) {
      if (!(await sleep(DIVE_DOWN_DELAYS[index - 1], token))) return false;
      setSrc(RABBIT_LOGO_HOLE_FRAMES[index]);
    }
    if (!(await sleep(DIVE_HOLD_MS, token))) return false;
    for (let index = 6; index < FRAME_COUNT; index += 1) {
      if (!(await sleep(DIVE_UP_DELAYS[index - 6], token))) return false;
      setSrc(RABBIT_LOGO_HOLE_FRAMES[index]);
    }
    finishAnimation();
    return true;
  }, [blinkOnly, clearIdleTimers, finishAnimation, isLoaded, musicPlaying, reducedMotion, sleep]);

  const scheduleAnimations = useCallback(() => {
    if (blinkOnly || clickToAppear || !mountedRef.current || !isLoaded || reducedMotion || musicPlaying || !visibleRef.current || animationStateRef.current !== "idle") return;
    if (blinkTimerRef.current === null) {
      blinkTimerRef.current = window.setTimeout(() => {
        blinkTimerRef.current = null;
        void playBlink();
      }, randomDelay(3500, 7000));
    }
    if (!blinkOnly && diveTimerRef.current === null) {
      diveTimerRef.current = window.setTimeout(() => {
        diveTimerRef.current = null;
        void playDive();
      }, randomDelay(12000, 24000));
    }
  }, [blinkOnly, clickToAppear, isLoaded, musicPlaying, playBlink, playDive, reducedMotion]);

  scheduleRef.current = scheduleAnimations;

  useImperativeHandle(ref, () => ({ playAppear, playBlink, playDive }), [playAppear, playBlink, playDive]);

  useEffect(() => {
    mountedRef.current = true;
    const preloaders = RABBIT_LOGO_ALL_FRAMES.map((frameUrl) => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = resolve;
      image.onerror = reject;
      image.src = frameUrl;
    }));
    Promise.all(preloaders).then(() => mountedRef.current && setIsLoaded(true)).catch(() => {});
    return () => {
      mountedRef.current = false;
      animationTokenRef.current += 1;
      pendingDiveRef.current = false;
      clearTimer(blinkTimerRef);
      clearTimer(diveTimerRef);
      clearTimer(frameTimerRef);
    };
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    visibleRef.current = !document.hidden;
    if (!isLoaded || reducedMotion) {
      clearIdleTimers();
      pendingDiveRef.current = false;
      resetToIdle();
      return undefined;
    }
    scheduleAnimations();
    const handleVisibility = () => {
      visibleRef.current = !document.hidden;
      if (!visibleRef.current) {
        clearIdleTimers();
        resetToIdle();
      } else {
        scheduleAnimations();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      clearIdleTimers();
      clearTimer(frameTimerRef);
    };
  }, [clearIdleTimers, isLoaded, reducedMotion, resetToIdle, scheduleAnimations]);

  // Start one deterministic automatic dive after the complete frame set is
  // ready. Later dives use the independent 12–24 second scheduler above.
  useEffect(() => {
    if (blinkOnly || clickToAppear || !isLoaded || reducedMotion || musicPlaying || !visibleRef.current) return undefined;
    const initialDiveTimer = window.setTimeout(() => {
      void playDive();
    }, 1500);
    return () => window.clearTimeout(initialDiveTimer);
  }, [blinkOnly, clickToAppear, isLoaded, musicPlaying, playDive, reducedMotion]);

  useEffect(() => {
    if (!isLoaded || reducedMotion || !musicPlaying || !musicAudioRef?.current) {
      if (musicRafRef.current !== null) cancelAnimationFrame(musicRafRef.current);
      musicRafRef.current = null;
      musicIntensityRef.current = 0;
      musicTargetIntensityRef.current = 0;
      musicLastFrameAtRef.current = 0;
      musicFrameRef.current = 0;
      if (animationStateRef.current === "music-diving") resetToIdle();
      return undefined;
    }

    clearIdleTimers();
    const audio = musicAudioRef.current;
    try {
      if (!musicAudioContextRef.current) {
        const context = new window.AudioContext();
        const source = context.createMediaElementSource(audio);
        const analyser = context.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        analyser.connect(context.destination);
        musicAudioContextRef.current = context;
        musicSourceRef.current = source;
        musicAnalyserRef.current = analyser;
      }
      void musicAudioContextRef.current.resume();
    } catch {
      return undefined;
    }

    const analyser = musicAnalyserRef.current;
    const samples = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      if (!mountedRef.current || !musicPlaying || document.hidden) return;
      if (animationStateRef.current === "idle") {
        animationStateRef.current = "music-diving";
        musicFrameRef.current = 0;
        setSrc(RABBIT_LOGO_HOLE_FRAMES[0]);
      }
      if (animationStateRef.current === "music-diving") {
        analyser.getByteFrequencyData(samples);
        const average = samples.reduce((sum, sample) => sum + sample, 0) / (samples.length * 255);
        const rawIntensity = Math.min(1, average * 2.4);
        const previous = musicIntensityRef.current;
        if (Math.abs(rawIntensity - musicTargetIntensityRef.current) >= MUSIC_INTENSITY_THRESHOLD) {
          musicTargetIntensityRef.current = rawIntensity;
        }
        const intensity = previous * 0.96 + musicTargetIntensityRef.current * 0.04;
        musicIntensityRef.current = intensity;
        const current = musicFrameRef.current;
        const now = performance.now();
        if (now - musicLastFrameAtRef.current >= MUSIC_FRAME_STEP_MS) {
          const rising = musicTargetIntensityRef.current > previous + 0.025;
          const falling = musicTargetIntensityRef.current < previous - 0.025;
          const target = rising
            ? Math.min(5, Math.round(intensity * 5))
            : falling
              ? Math.max(5, 9 - Math.round(intensity * 4))
              : current;
          const next = current < target ? current + 1 : current > target ? current - 1 : current;
          if (next !== current) {
            musicFrameRef.current = next;
            musicLastFrameAtRef.current = now;
            setSrc(RABBIT_LOGO_HOLE_FRAMES[next]);
          }
        }
      }
      musicRafRef.current = requestAnimationFrame(tick);
    };
    musicFrameRef.current = 0;
    musicIntensityRef.current = 0;
    musicTargetIntensityRef.current = 0;
    musicLastFrameAtRef.current = performance.now();
    musicRafRef.current = requestAnimationFrame(tick);
    return () => {
      if (musicRafRef.current !== null) cancelAnimationFrame(musicRafRef.current);
      musicRafRef.current = null;
    };
  }, [clearIdleTimers, isLoaded, musicAudioRef, musicPlaying, reducedMotion, resetToIdle]);

  const handlePointerEnter = (event) => {
    onPointerEnter?.(event);
    void playBlink();
  };

  return (
    <img
      {...imageProps}
      className={`rabbitLogoBlink__image${imageClassName ? ` ${imageClassName}` : ""}${className ? ` ${className}` : ""}`}
      src={src}
      alt={alt}
      draggable="false"
      onPointerEnter={handlePointerEnter}
    />
  );
});

export default RabbitLogoBlink;
