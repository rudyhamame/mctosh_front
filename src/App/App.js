import React, { useRef, useState } from "react";
import { useHistory } from "react-router-dom";
import "./App.css";

const NAV_ITEMS = [
  {
    path:        "/pdf",
    label:       "PDF Reader",
    description: "Extract and classify nouns from medical PDFs",
    color:       "#4fc3f7",
  },
  {
    path:        "/phenomena",
    label:       "Phenomena",
    description: "Organise sensory phenomena by means of access",
    color:       "#f06292",
  },
];

const App = ({ onLogout }) => {
  const history = useHistory();
  const [scale, setScale] = useState(
    () => parseFloat(localStorage.getItem("appScale") || "1")
  );
  const videoRef = useRef(null);
  const [playing, setPlaying] = useState(false);

  const handlePlay = () => {
    videoRef.current?.play();
    setPlaying(true);
  };

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
        <button id="app_logout_btn" onClick={onLogout}>Logout</button>
      </div>

      <div id="app_greeting">
        <div id="app_greeting_wrap">
          <video
            ref={videoRef}
            id="app_greeting_video"
            src="https://res.cloudinary.com/dtoxkii3q/video/upload/v1782581889/sample1/user-images/6a237f080175aacbdb3962ff/copy_dbc85ec1-1520-4cba-af16-b27eb6de8979.mp4"
            playsInline
            onEnded={() => setPlaying(false)}
          />
          {!playing && (
            <button id="app_greeting_play" onClick={handlePlay} aria-label="Play">
              ▶
            </button>
          )}
        </div>
      </div>

      <div id="app_nav_grid">
        {NAV_ITEMS.map(({ path, label, description, color }) => (
          <button
            key={path}
            className="app_nav_card"
            style={{ "--nav-color": color }}
            onClick={() => history.push(path)}
          >
            <span className="app_nav_card_label">{label}</span>
            <span className="app_nav_card_desc">{description}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default App;
