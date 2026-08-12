import { apiUrl } from "../config/api";
import { readStoredSession } from "./sessionCleanup";

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
  if (localSuggestions.length > 0) return localSuggestions;

  // The browser DEDUP cache is intentionally usable without a provider
  // request. Only the server fallback requires an authenticated session.
  const token = readStoredSession()?.token || "";
  if (!token) return [];

  try {
    const res = await fetch(apiUrl(`/api/prediction/suggest?q=${encodeURIComponent(prefix)}&limit=${limit}`), {
      headers: authHeader(),
    });
    if (!res.ok) return localSuggestions;
    const data = await res.json();
    return [...new Set([...localSuggestions, ...(data.suggestions || [])])].slice(0, limit);
  } catch {
    return localSuggestions;
  }
};
