export const AVATAR_VIEWPORT_SETTINGS_KEY = "mctosh_local3d_avatar_frame";
export const AVATAR_VIEWPORT_UPDATED_EVENT = "mctosh-local3d-viewport-updated";
export const DEFAULT_VIEWPORT_FRAME = { offsetX: 0, offsetY: 0, zoom: 1 };
export const MIN_VIEWPORT_ZOOM = 0.7;
export const MAX_VIEWPORT_ZOOM = 2.4;

export const clampViewportZoom = (value) => Math.max(MIN_VIEWPORT_ZOOM, Math.min(MAX_VIEWPORT_ZOOM, value));
export const normalizeViewportFrame = (frame) => ({
  offsetX: DEFAULT_VIEWPORT_FRAME.offsetX,
  offsetY: Number.isFinite(frame?.offsetY) ? frame.offsetY : DEFAULT_VIEWPORT_FRAME.offsetY,
  zoom: clampViewportZoom(Number.isFinite(frame?.zoom) ? frame.zoom : DEFAULT_VIEWPORT_FRAME.zoom),
});

export const readSavedViewportFrame = () => {
  try {
    const raw = localStorage.getItem(AVATAR_VIEWPORT_SETTINGS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_VIEWPORT_FRAME };
    return normalizeViewportFrame(parsed);
  } catch {
    return { ...DEFAULT_VIEWPORT_FRAME };
  }
};

export const writeSavedViewportFrame = (frame) => {
  const next = normalizeViewportFrame(frame);
  localStorage.setItem(AVATAR_VIEWPORT_SETTINGS_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(AVATAR_VIEWPORT_UPDATED_EVENT, { detail: next }));
  return next;
};
