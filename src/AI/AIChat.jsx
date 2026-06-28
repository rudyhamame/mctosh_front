import React, { useEffect, useRef, useState } from "react";
import "./aiChat.css";
import { useAI } from "../hooks/useAI";

const AIChat = () => {
  const { messages, streaming, send, stop, reset } = useAI({ model: "llama3.2:3b" });
  const [input, setInput] = useState("");
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!input.trim()) return;
    send(input);
    setInput("");
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div id="ai_chat">
      <div id="ai_chat_messages">
        {messages.length === 0 && (
          <p style={{ color: "var(--color-text-muted)", alignSelf: "center", marginTop: "4rem" }}>
            Ask anything.
          </p>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={[
              "ai_msg",
              `ai_msg--${msg.role}`,
              msg.role === "assistant" && streaming && i === messages.length - 1
                ? "ai_msg--streaming"
                : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {msg.content}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <form id="ai_chat_footer" onSubmit={handleSubmit}>
        <textarea
          id="ai_chat_input"
          rows={1}
          placeholder="Message…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={streaming}
        />
        {streaming ? (
          <button id="ai_chat_send" type="button" onClick={stop}>
            Stop
          </button>
        ) : (
          <button id="ai_chat_send" type="submit" disabled={!input.trim()}>
            Send
          </button>
        )}
        {messages.length > 0 && !streaming && (
          <button id="ai_chat_reset" type="button" onClick={reset}>
            Clear
          </button>
        )}
      </form>
    </div>
  );
};

export default AIChat;
