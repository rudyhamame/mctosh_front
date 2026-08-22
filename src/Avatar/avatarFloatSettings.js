export const AVATAR_FLOAT_SETTINGS_KEY = "mctosh_dev_ai_avatar_float";
export const DEFAULT_AVATAR_FLOAT = { x: 0, y: 0, scale: 1, rotateX: 0, rotateY: 0 };
export const MIN_AVATAR_FLOAT_SCALE = 0.65;
export const MAX_AVATAR_FLOAT_SCALE = 2;
export const MIN_AVATAR_ROTATE_X = -85;
export const MAX_AVATAR_ROTATE_X = 85;
export const MIN_AVATAR_ROTATE_Y = -180;
export const MAX_AVATAR_ROTATE_Y = 180;

export const clampAvatarFloatScale = (value) => (
  Math.max(MIN_AVATAR_FLOAT_SCALE, Math.min(MAX_AVATAR_FLOAT_SCALE, value))
);

export const clampAvatarRotateX = (value) => (
  Math.max(MIN_AVATAR_ROTATE_X, Math.min(MAX_AVATAR_ROTATE_X, value))
);

export const clampAvatarRotateY = (value) => (
  Math.max(MIN_AVATAR_ROTATE_Y, Math.min(MAX_AVATAR_ROTATE_Y, value))
);

export const readAvatarFloatSettings = () => {
  try {
    const raw = localStorage.getItem(AVATAR_FLOAT_SETTINGS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_AVATAR_FLOAT };
    return {
      x: Number.isFinite(parsed.x) ? parsed.x : DEFAULT_AVATAR_FLOAT.x,
      y: Number.isFinite(parsed.y) ? parsed.y : DEFAULT_AVATAR_FLOAT.y,
      scale: clampAvatarFloatScale(Number.isFinite(parsed.scale) ? parsed.scale : DEFAULT_AVATAR_FLOAT.scale),
      rotateX: clampAvatarRotateX(Number.isFinite(parsed.rotateX) ? parsed.rotateX : DEFAULT_AVATAR_FLOAT.rotateX),
      rotateY: clampAvatarRotateY(Number.isFinite(parsed.rotateY) ? parsed.rotateY : DEFAULT_AVATAR_FLOAT.rotateY),
    };
  } catch {
    return { ...DEFAULT_AVATAR_FLOAT };
  }
};

export const writeAvatarFloatSettings = (settings) => {
  const next = {
    x: Number.isFinite(settings?.x) ? settings.x : DEFAULT_AVATAR_FLOAT.x,
    y: Number.isFinite(settings?.y) ? settings.y : DEFAULT_AVATAR_FLOAT.y,
    scale: clampAvatarFloatScale(Number.isFinite(settings?.scale) ? settings.scale : DEFAULT_AVATAR_FLOAT.scale),
    rotateX: clampAvatarRotateX(Number.isFinite(settings?.rotateX) ? settings.rotateX : DEFAULT_AVATAR_FLOAT.rotateX),
    rotateY: clampAvatarRotateY(Number.isFinite(settings?.rotateY) ? settings.rotateY : DEFAULT_AVATAR_FLOAT.rotateY),
  };
  localStorage.setItem(AVATAR_FLOAT_SETTINGS_KEY, JSON.stringify(next));
  return next;
};
