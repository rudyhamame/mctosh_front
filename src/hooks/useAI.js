import { useState, useCallback, useRef } from "react";
import { apiUrl } from "../config/api";

export const useAI = ({ model = "mistral" } = {}) => {
  const [messages, setMessages] = useState([]);
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef(null);

  const send = useCallback(async (userText) => {
    const text = String(userText || "").trim();
    if (!text || streaming) return;

    const nextMessages = [...messages, { role: "user", content: text }];
    setMessages([...nextMessages, { role: "assistant", content: "" }]);
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(apiUrl("/api/ai/chat"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages, model }),
        signal: controller.signal,
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") break;

          try {
            const { delta, error } = JSON.parse(payload);
            if (error) {
              setMessages((prev) => replaceLastContent(prev, `Error: ${error}`));
            } else if (delta) {
              setMessages((prev) => appendToLastContent(prev, delta));
            }
          } catch {}
        }
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        setMessages((prev) => replaceLastContent(prev, "Could not reach AI. Is Ollama running?"));
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [messages, streaming, model]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setStreaming(false);
  }, []);

  return { messages, streaming, send, stop, reset };
};

const appendToLastContent = (msgs, delta) => {
  const next = [...msgs];
  next[next.length - 1] = {
    ...next[next.length - 1],
    content: next[next.length - 1].content + delta,
  };
  return next;
};

const replaceLastContent = (msgs, text) => {
  const next = [...msgs];
  next[next.length - 1] = { ...next[next.length - 1], content: text };
  return next;
};
