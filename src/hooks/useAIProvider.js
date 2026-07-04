import { useState, useCallback } from "react";

export const AI_PROVIDERS = [
  { id: "local",  label: "Local",  sub: "Ollama" },
  { id: "openai", label: "OpenAI", sub: "GPT-4o mini" },
  { id: "groq",   label: "Groq",   sub: "Llama 4 Scout" },
  { id: "manual", label: "Manual", sub: "Select text" },
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
