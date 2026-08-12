import { apiUrl } from "../config/api";
import { readStoredSession } from "./sessionCleanup";

export const DICTIONARY_PROVIDERS = Object.freeze({
  MERRIAM_WEBSTER_MEDICAL: "merriam-webster-medical",
  MERRIAM_WEBSTER_COLLEGIATE: "merriam-webster-collegiate",
});

export const DEFAULT_DICTIONARY_PROVIDER = DICTIONARY_PROVIDERS.MERRIAM_WEBSTER_MEDICAL;
export const MEDICAL_DICTIONARY_API_URL = "https://www.dictionaryapi.com/api/v3/references/medical/json";
export const OTHER_DICTIONARY_API_URL = "https://www.dictionaryapi.com/api/v3/references/collegiate/json";

export const lookupDictionaryWord = async (value, { signal, provider } = {}) => {
  const word = String(value || "").trim();
  if (!word) throw new Error("Select a word to look up.");
  const token = readStoredSession()?.token || "";
  const query = new URLSearchParams();
  if (provider) query.set("provider", provider);
  const providerQuery = `?${query.toString()}`;
  const response = await fetch(apiUrl(`/api/ai/medical-dictionary/${encodeURIComponent(word)}${providerQuery}`), {
    signal,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data?.error?.message || data?.message;
    const suggestions = Array.isArray(data?.error?.suggestions) ? data.error.suggestions.filter(Boolean) : [];
    const suffix = suggestions.length ? ` Suggestions: ${suggestions.slice(0, 8).join(", ")}.` : "";
    throw new Error(`${message || "Medical dictionary lookup failed."}${suffix}`);
  }

  const definitions = Array.isArray(data?.definitions) ? data.definitions.filter((item) => item?.definition) : [];
  const dictionaryResponseType = String(data?.dictionaryResponseType || "unknown");
  const suggestions = Array.isArray(data?.suggestions) ? data.suggestions.filter(Boolean) : [];
  if (!definitions.length && !["entries", "suggestions"].includes(dictionaryResponseType)) throw new Error(`No dictionary definitions were returned for “${word}”.`);
  const phonetic = String(data?.phonetic || "").trim();
  const formatted = definitions.slice(0, 6).map((item, index) => {
    const role = item.partOfSpeech ? ` (${item.partOfSpeech})` : "";
    const example = item.example ? ` Example: ${item.example}` : "";
    return `${index + 1}.${role} ${item.definition}${example}`;
  }).join("\n");

  return {
    word: String(data?.word || word),
    phonetic: phonetic || "",
    audioUrl: String(data?.audioUrl || "").trim(),
    pronunciations: Array.isArray(data?.pronunciations) ? data.pronunciations : [],
    phoneticSource: String(data?.phoneticSource || ""),
    definitions,
    suggestions,
    dictionaryResponse: Array.isArray(data?.dictionaryResponse) ? data.dictionaryResponse : null,
    dictionaryResponseType,
    source: data?.source === "ai" ? "ai" : data?.source === "collegiate" ? "collegiate" : "medical",
    sourceLabel: data?.source === "collegiate"
      ? "Merriam-Webster Collegiate"
      : data?.source === "ai" ? "AI Dictionary" : "Merriam-Webster Medical",
    text: `${phonetic ? `${phonetic}\n` : ""}${formatted}`,
  };
};
