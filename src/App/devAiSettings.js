export const DEV_AI_SETTINGS_KEY = "mctosh_dev_ai_settings";

const buildDefaultDevAiSettings = () => ({
  interruptOnSpeech: false,
});

export const readDevAiSettings = () => {
  try {
    const raw = localStorage.getItem(DEV_AI_SETTINGS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return { ...buildDefaultDevAiSettings(), ...(parsed || {}) };
  } catch {
    return buildDefaultDevAiSettings();
  }
};

export const writeDevAiSettings = (patch) => {
  const next = { ...readDevAiSettings(), ...(patch || {}) };
  localStorage.setItem(DEV_AI_SETTINGS_KEY, JSON.stringify(next));
  return next;
};
