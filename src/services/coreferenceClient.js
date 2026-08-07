import { apiUrl } from "../config/api";
import { readStoredSession } from "../utils/sessionCleanup";

const authHeaders = () => {
  const token = readStoredSession()?.token || "";
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export const resolveCoreference = async ({ text, language = "en", expandPronouns = true, signal } = {}) => {
  if (typeof text !== "string" || !text.trim()) throw new Error("A paragraph is required.");
  if (text.length > 20000) throw new Error("Paragraph exceeds the 20,000-character limit.");
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000);
  const abortFromCaller = () => controller.abort();
  signal?.addEventListener("abort", abortFromCaller, { once: true });
  try {
    const response = await fetch(apiUrl("/api/amctoshs-coreference/resolve"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ text, language, expandPronouns }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error?.message || "Coreference resolution failed.");
    if (
      typeof payload.originalText !== "string" ||
      typeof payload.resolvedText !== "string" ||
      !Array.isArray(payload.clusters) ||
      !Array.isArray(payload.replacements) ||
      !Array.isArray(payload.unresolvedMentions) ||
      !Array.isArray(payload.ambiguousMentions)
    ) {
      throw new Error("Coreference service returned an invalid response.");
    }
    return payload;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("Coreference resolution timed out or was cancelled.");
    throw error;
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener("abort", abortFromCaller);
  }
};
