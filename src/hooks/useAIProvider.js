import { useState, useCallback } from "react";

// Static fallback shown before the live list loads from
// /api/settings/ai-status (the same source the AI Providers settings page
// uses) — kept in sync with back/routes/SettingsAPI.js's PROVIDERS so a
// provider id picked from the live list always passes VALID_IDS below, even
// on a reload that happens before the live fetch resolves.
export const AI_PROVIDERS = [
  { id: "local",    label: "Local",            sub: "Ollama" },
  { id: "openai",   label: "OpenAI",           sub: "GPT-4o mini" },
  { id: "groq",     label: "Groq",             sub: "Llama 4 Scout" },
  { id: "moonshot", label: "Kimi (Moonshot)",  sub: "kimi-k2.5" },
  { id: "gemini",   label: "Gemini",           sub: "gemini-2.5-flash" },
  { id: "manual",   label: "Manual",           sub: "Select text" },
];

const STORAGE_KEY = "mctosh_ai_provider";
const VALID_IDS = new Set(AI_PROVIDERS.map((p) => p.id));

export const useAIProvider = () => {
  const [provider, setProviderState] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored && VALID_IDS.has(stored) ? stored : "groq";
  });

  const setProvider = useCallback((id) => {
    localStorage.setItem(STORAGE_KEY, id);
    setProviderState(id);
  }, []);

  return { provider, setProvider };
};
