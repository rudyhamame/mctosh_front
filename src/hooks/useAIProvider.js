import { useState, useCallback } from "react";

export const AI_PROVIDERS = [
  { id: "local",  label: "Local",  sub: "Ollama" },
  { id: "openai", label: "OpenAI", sub: "GPT-4o mini" },
  { id: "groq",   label: "Groq",   sub: "Llama 4 Scout" },
  { id: "nara",   label: "Nara",   sub: "mimo-v2.5" },
  { id: "manual", label: "Manual", sub: "Select text" },
];

const STORAGE_KEY = "mctosh_ai_provider";

export const useAIProvider = () => {
  const [provider, setProviderState] = useState(
    () => localStorage.getItem(STORAGE_KEY) || "nara"
  );

  const setProvider = useCallback((id) => {
    localStorage.setItem(STORAGE_KEY, id);
    setProviderState(id);
  }, []);

  return { provider, setProvider };
};
