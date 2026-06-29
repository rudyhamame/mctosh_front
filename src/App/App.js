import React, { useState } from "react";
import { useHistory } from "react-router-dom";
import "./App.css";
import AIProviderSelect from "./AIProviderSelect";
import { useAIProvider } from "../hooks/useAIProvider";

const HOME_ITEMS = [
  {
    path: "/hylomorphism",
    label: "Hyle-to-Meaning",
    description: "Extract hyles from clinical text and classify them into Objects, Traces, Phenomena, Concepts, and Models",
    color: "#e53935",
  },
  {
    path: "/sources",
    label: "Hyle Source Organisation",
    description: "Store and manage PDFs as sources from which hyles will be extracted",
    color: "#4fc3f7",
  },
  {
    path: "/study",
    label: "Study Room",
    description: "Read sources, annotate PDFs, and review extracted hyles side-by-side",
    color: "#ce93d8",
  },
  {
    path: "/settings",
    label: "Settings",
    description: "Control prompts, AI providers, and app theme",
    color: "#78909c",
  },
];

const App = ({ onLogout }) => {
  const history = useHistory();
  const { provider, setProvider } = useAIProvider();
  const [scale, setScale] = useState(
    () => parseFloat(localStorage.getItem("appScale") || "1")
  );

  const applyScale = (next) => {
    const s = Math.min(2, Math.max(0.5, Math.round(next * 10) / 10));
    setScale(s);
    localStorage.setItem("appScale", String(s));
    document.body.style.zoom = String(s);
  };

  return (
    <div id="App_viewportScale">
      <div id="app_nav_header">
        <span id="app_nav_title">MCTOSH</span>
        <div id="app_scale_controls">
          <button onClick={() => applyScale(scale - 0.1)} disabled={scale <= 0.5}>−</button>
          <button id="app_scale_label" onClick={() => applyScale(1)} title="Reset zoom">
            {Math.round(scale * 100)}%
          </button>
          <button onClick={() => applyScale(scale + 0.1)} disabled={scale >= 2}>+</button>
        </div>
        <AIProviderSelect provider={provider} setProvider={setProvider} />
        <button id="app_logout_btn" onClick={onLogout}>Logout</button>
      </div>

      <div id="app_home_grid">
        {HOME_ITEMS.map(({ path, label, description, color }) => (
          <button
            key={path}
            className="app_home_card"
            style={{ "--nav-color": color }}
            onClick={() => history.push(path)}
          >
            <span className="app_home_card_label">{label}</span>
            <span className="app_home_card_desc">{description}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default App;
