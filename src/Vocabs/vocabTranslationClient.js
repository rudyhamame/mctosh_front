import { apiUrl } from "../config/api";
import { readStoredSession } from "../utils/sessionCleanup";

export const VOCAB_TRANSLATION_LANGUAGE_KEY = "mctosh_vocab_translate_lang";

export const readVocabTranslationLanguage = () => localStorage.getItem(VOCAB_TRANSLATION_LANGUAGE_KEY) || "French";

export const translateVocabularyContent = async ({ entry, definition, provider, signal }) => {
  const values = [String(entry || "").trim(), String(definition || "").trim()];
  if (!values[0] || !values[1]) throw new Error("The entry and its definition are required for translation.");

  const token = readStoredSession()?.token || "";
  const response = await fetch(apiUrl("/api/ai/text-tool"), {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      action: "translate",
      texts: values,
      targetLang: readVocabTranslationLanguage(),
      provider,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || "Vocabulary translation failed.");
  if (!Array.isArray(data.results) || data.results.length !== values.length) {
    throw new Error("The translation provider returned an incomplete vocabulary translation.");
  }

  return {
    entry: String(data.results[0] || "").trim(),
    definition: String(data.results[1] || "").trim(),
    language: readVocabTranslationLanguage(),
  };
};
