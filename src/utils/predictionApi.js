import { apiUrl } from "../config/api";
import { readStoredSession } from "./sessionCleanup";
import { readUmlsLanguage } from "../Vocabs/umlsSettings";

const authHeader = () => {
  const token = readStoredSession()?.token || "";
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export const getPredictionPools = async () => {
  const res = await fetch(apiUrl("/api/prediction/pools"), { headers: authHeader() });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to load prediction pools.");
  return data.pools || [];
};

export const setPredictionPoolEnabled = async (key, enabled) => {
  const res = await fetch(apiUrl(`/api/prediction/pools/${encodeURIComponent(key)}`), {
    method: "PATCH",
    headers: { ...authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to update pool.");
  return data.pool;
};

export const rebuildPredictionPool = async (key) => {
  const res = await fetch(apiUrl(`/api/prediction/pools/${encodeURIComponent(key)}/rebuild`), {
    method: "POST",
    headers: authHeader(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to rebuild pool.");
  return data.wordCount;
};

export const ingestPredictionPool = async (key, text) => {
  const res = await fetch(apiUrl(`/api/prediction/pools/${encodeURIComponent(key)}/ingest`), {
    method: "POST",
    headers: { ...authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to sync pool.");
  return data.wordCount;
};

export const suggestPredictions = async (prefix, limit = 6) => {
  if (localStorage.getItem("mctosh_prediction_enabled") === "false") return [];
  const normalizedPrefix = String(prefix || "").trim().toLocaleLowerCase();
  const localSuggestions = (() => {
    try {
      const deduplicatedWords = JSON.parse(localStorage.getItem("mctosh_corpus_unit_words") || "[]");
      const corpusWords = JSON.parse(localStorage.getItem("mctosh_corpus_words") || "[]");
      const words = Array.isArray(deduplicatedWords) && deduplicatedWords.length > 0
        ? deduplicatedWords
        : corpusWords;
      return (Array.isArray(words) ? words : [])
        .map((word) => typeof word === "string" ? word : word?.string)
        .map((word) => String(word || "").trim())
        .filter((word) => word.toLocaleLowerCase().startsWith(normalizedPrefix))
        .slice(0, limit);
    } catch {
      return [];
    }
  })();
  // General prediction and inline autocomplete are intentionally Corpus-only.
  // Medical UMLS suggestions are fetched separately for the keyboard rail.
  return localSuggestions;
};

export const suggestMedicalPredictions = async (prefix, limit = 6) => {
  if (localStorage.getItem("mctosh_prediction_enabled") === "false") return [];
  const normalizedPrefix = String(prefix || "").trim();
  const token = readStoredSession()?.token || "";
  if (normalizedPrefix.length < 2 || !token) return [];

  try {
    const language = readUmlsLanguage();
    const params = new URLSearchParams({
      q: normalizedPrefix,
      limit: String(limit),
      languages: language,
    });
    const res = await fetch(apiUrl(`/api/terminology/suggest?${params}`), { headers: authHeader() });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.suggestions) ? data.suggestions : [];
  } catch {
    return [];
  }
};
