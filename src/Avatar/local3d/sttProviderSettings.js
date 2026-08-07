export const STT_SETTINGS_KEY = "mctosh_stt_settings";

export const STT_PROVIDERS = {
  BROWSER: "browser",
  LOCAL_WHISPER: "local-whisper",
  OPENAI: "openai",
};

export const STT_PROVIDER_OPTIONS = [
  {
    id: STT_PROVIDERS.BROWSER,
    label: "Browser recognition",
    description: "Free and immediate, using the speech service built into your browser.",
    models: [{ id: "browser", label: "Browser default" }],
  },
  {
    id: STT_PROVIDERS.LOCAL_WHISPER,
    label: "Local Whisper",
    description: "Private local transcription using Whisper running on this device.",
    models: [{ id: "base.en", label: "Whisper Base English (CPU)" }],
  },
  {
    id: STT_PROVIDERS.OPENAI,
    label: "OpenAI",
    description: "Higher-accuracy server transcription for PDF Agent voice calls.",
    models: [{ id: "gpt-4o-transcribe", label: "GPT-4o Transcribe" }],
  },
];

const OPENAI_MODELS = new Set(STT_PROVIDER_OPTIONS
  .find((option) => option.id === STT_PROVIDERS.OPENAI)
  ?.models.map((item) => item.id) || []);

const defaults = { provider: STT_PROVIDERS.BROWSER, model: "browser" };

export const readSttSettings = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(STT_SETTINGS_KEY) || "null");
    const provider = Object.values(STT_PROVIDERS).includes(parsed?.provider)
      ? parsed.provider
      : defaults.provider;
    const option = STT_PROVIDER_OPTIONS.find((item) => item.id === provider);
    const model = option?.models.some((item) => item.id === parsed?.model)
      ? parsed.model
      : option?.models[0]?.id || defaults.model;
    return { provider, model };
  } catch {
    return defaults;
  }
};

export const normalizeOpenAiSttModel = (model) => (
  OPENAI_MODELS.has(model) ? model : "gpt-4o-transcribe"
);

export const writeSttSettings = (patch) => {
  const next = { ...readSttSettings(), ...(patch || {}) };
  const option = STT_PROVIDER_OPTIONS.find((item) => item.id === next.provider)
    || STT_PROVIDER_OPTIONS[0];
  if (!option.models.some((item) => item.id === next.model)) next.model = option.models[0].id;
  localStorage.setItem(STT_SETTINGS_KEY, JSON.stringify(next));
  return next;
};
