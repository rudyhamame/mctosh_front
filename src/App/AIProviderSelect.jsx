import React from "react";
import { AI_PROVIDERS } from "../hooks/useAIProvider";
import "./aiProviderSelect.css";

const AIProviderSelect = ({ provider, setProvider, disabled }) => (
  <div id="ai_provider_wrap">
    <span id="ai_provider_label">AI</span>
    <select
      id="ai_provider_select"
      value={provider}
      onChange={(e) => setProvider(e.target.value)}
      disabled={disabled}
    >
      {AI_PROVIDERS.map(({ id, label, sub }) => (
        <option key={id} value={id}>{label} · {sub}</option>
      ))}
    </select>
  </div>
);

export default AIProviderSelect;
