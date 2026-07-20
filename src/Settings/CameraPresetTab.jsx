import React, { useState } from "react";
import ThreadPyramidLogo from "../App/ThreadPyramidLogo";
import { LEVEL_LABELS } from "../App/App";
import "../App/threadPyramidLogo.css";
import "./cameraPresetTab.css";

// Moved off the Home page (2026-07) — the camera-tuning panel used to be a
// floating dev-only overlay visible to any visitor on Home. Now it only
// exists here, gated to a single username by SettingsPage.jsx's own check.
// Home has no scroll to drive activeLevel here, so a level picker replaces
// scrolling — everything else (drag/pinch the shot, "Save current view",
// "Copy as code") works exactly as ThreadPyramidLogo.jsx's own panel always
// has, unchanged.
const CameraPresetTab = () => {
  const [activeLevel, setActiveLevel] = useState(0);
  const [scrollWeights, setScrollWeights] = useState(() => LEVEL_LABELS.map(() => 1));

  const handleScrollWeightChange = (index, weight) => {
    setScrollWeights((prev) => prev.map((w, i) => (i === index ? weight : w)));
  };

  return (
    <div id="sett_camera_tab">
      <div id="sett_camera_level_picker">
        {LEVEL_LABELS.map((label, i) => (
          <button
            key={label}
            type="button"
            className={`sett_camera_level_btn${i === activeLevel ? " sett_camera_level_btn--active" : ""}`}
            onClick={() => setActiveLevel(i)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="sett_camera_stage">
        <ThreadPyramidLogo
          activeLevel={activeLevel}
          progress={1}
          levelLabels={LEVEL_LABELS}
          scrollWeights={scrollWeights}
          onScrollWeightChange={handleScrollWeightChange}
          showCameraPanel
        />
      </div>
    </div>
  );
};

export default CameraPresetTab;
