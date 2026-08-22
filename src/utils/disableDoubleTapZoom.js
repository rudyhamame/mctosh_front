const INSTALL_KEY = "__mctoshDoubleTapZoomGuardInstalled";
const DOUBLE_TAP_DELAY_MS = 350;
const MAX_TAP_DURATION_MS = 450;
const MAX_TAP_MOVEMENT_PX = 18;
const MAX_DOUBLE_TAP_DISTANCE_PX = 36;

/**
 * Stops mobile browsers from interpreting two quick one-finger taps as a
 * viewport-zoom command. Pinch gestures, scrolling, app-level double-tap
 * handlers and normal single taps remain available.
 */
export const installDoubleTapZoomGuard = (targetDocument = document) => {
  if (!targetDocument || targetDocument[INSTALL_KEY]) return;
  targetDocument[INSTALL_KEY] = true;

  let activeTap = null;
  let previousTap = null;

  const resetActiveTap = () => { activeTap = null; };

  const onTouchStart = (event) => {
    if (event.touches.length !== 1) {
      resetActiveTap();
      previousTap = null;
      return;
    }
    const touch = event.touches[0];
    activeTap = {
      startedAt: performance.now(),
      startX: touch.clientX,
      startY: touch.clientY,
      moved: false,
    };
  };

  const onTouchMove = (event) => {
    if (!activeTap || event.touches.length !== 1) {
      resetActiveTap();
      return;
    }
    const touch = event.touches[0];
    if (Math.hypot(touch.clientX - activeTap.startX, touch.clientY - activeTap.startY) > MAX_TAP_MOVEMENT_PX) {
      activeTap.moved = true;
      previousTap = null;
    }
  };

  const onTouchEnd = (event) => {
    if (!activeTap || activeTap.moved || event.touches.length || event.changedTouches.length !== 1) {
      resetActiveTap();
      return;
    }
    const endedAt = performance.now();
    const touch = event.changedTouches[0];
    const duration = endedAt - activeTap.startedAt;
    const stayedNearStart = Math.hypot(touch.clientX - activeTap.startX, touch.clientY - activeTap.startY) <= MAX_TAP_MOVEMENT_PX;
    const isTap = duration <= MAX_TAP_DURATION_MS && stayedNearStart;
    const isDoubleTap = isTap
      && previousTap
      && endedAt - previousTap.endedAt <= DOUBLE_TAP_DELAY_MS
      && Math.hypot(touch.clientX - previousTap.x, touch.clientY - previousTap.y) <= MAX_DOUBLE_TAP_DISTANCE_PX;

    if (isDoubleTap) {
      if (event.cancelable) event.preventDefault();
      previousTap = null;
    } else {
      previousTap = isTap ? { endedAt, x: touch.clientX, y: touch.clientY } : null;
    }
    resetActiveTap();
  };

  targetDocument.addEventListener("touchstart", onTouchStart, { passive: true, capture: true });
  targetDocument.addEventListener("touchmove", onTouchMove, { passive: true, capture: true });
  targetDocument.addEventListener("touchend", onTouchEnd, { passive: false, capture: true });
  targetDocument.addEventListener("touchcancel", () => {
    resetActiveTap();
    previousTap = null;
  }, { passive: true, capture: true });
};
