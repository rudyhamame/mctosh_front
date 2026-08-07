export const TRANSLATOR_PROVIDERS = Object.freeze({
  LIBRETRANSLATE: "libretranslate",
  AI: "ai",
});

const TRANSLATOR_STORAGE_KEY = "mctosh_pdf_translator";

export const readTranslatorProvider = () => {
  const saved = localStorage.getItem(TRANSLATOR_STORAGE_KEY);
  return Object.values(TRANSLATOR_PROVIDERS).includes(saved)
    ? saved
    : TRANSLATOR_PROVIDERS.LIBRETRANSLATE;
};

export const writeTranslatorProvider = (provider) => {
  const next = Object.values(TRANSLATOR_PROVIDERS).includes(provider)
    ? provider
    : TRANSLATOR_PROVIDERS.LIBRETRANSLATE;
  localStorage.setItem(TRANSLATOR_STORAGE_KEY, next);
  return next;
};
