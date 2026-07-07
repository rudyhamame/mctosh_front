import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import "./App.css";
import AIProviderSelect from "./AIProviderSelect";
import { useAIProvider } from "../hooks/useAIProvider";

const PIPELINE = [
  {
    path: "/sources",
    icon: "fi-rr-books",
    label: "Clinical Representation Reservoir",
    description: "Store and manage PDFs as sources from which clinical hyles are extracted",
    color: "#4fc3f7",
    step: "01",
  },
  {
    path: "/traces-collector",
    icon: "fi-rr-signal-alt",
    label: "MCTOSHS Traces Collector",
    description: "Collect and log formal observable dimensions — signs, measurements, test results",
    color: "#f57c00",
    step: "02",
  },
  {
    path: "/clinical-schemata",
    icon: "fi-rr-network",
    label: "Clinical Representative Schemata & Instances",
    description: "Extract or manually define MCTOSHS schemata and their instances across the six biological dimensions",
    color: "#26c6da",
    step: "03",
  },
  {
    path: "/patient-modelling",
    icon: "fi-rr-blueprint",
    label: "MCTOSHS Objects Modelling",
    description: "Build the Morphe/schema for Patient Representative Objects across the six MCTOSHS dimensions",
    color: "#8e24aa",
    step: "04",
  },
  {
    path: "/patient-instantiation",
    icon: "fi-rr-hospital-user",
    label: "Patient Instantiation",
    description: "Instantiate the Patient Instance — receive the Morphe to form the Hylomorphic Entity",
    color: "#26a69a",
    step: "05",
  },
];

const OTHER = [
  {
    path: "/pdf-reader",
    icon: "fi-rr-file-pdf",
    label: "PDF Reader",
    description: "Open and annotate any PDF source — highlight, draw, and extract markdown page by page",
    color: "#ef5350",
  },
  {
    path: "/units-extraction",
    icon: "fi-rr-book-open-reader",
    label: "MCTOSHS Units Extraction while Studying",
    description: "Read a source and select any span of text to run a linguistic analysis on it",
    color: "#b39ddb",
  },
  {
    path: "/linguistic-analysis",
    icon: "fi-rr-language",
    label: "Clinical Linguistic Analysis",
    description: "Extract morphemes, words, syntagms, clauses, sentences, and paragraphs from any converted PDF page",
    color: "#69f0ae",
  },
  {
    path: "/mcc/mccqe/objectives",
    icon: "fi-rr-document-signed",
    label: "MCCQE Objectives",
    description: "Browse the MCCQE objectives dataset with search, group filters, and rendered objective content",
    color: "#d4a24c",
  },
  {
    path: "/draft",
    icon: "fi-rr-notebook",
    label: "MCTOSHS Draft",
    description: "A running scratchpad for notes you find while reading — autosaves as you write",
    color: "#ffca28",
  },
  {
    path: "/settings",
    icon: "fi-rr-settings",
    label: "Settings",
    description: "Control prompts, AI providers, and app theme",
    color: "#78909c",
  },
  {
    path: "/social-media-control",
    icon: "fi-rr-megaphone",
    label: "MCTOSHS Social Media Control",
    description: "Plan campaigns, shape captions, review post drafts, and prepare Instagram publishing workflows",
    color: "#ff8a65",
  },
];

const App = ({ onLogout }) => {
  const navigate = useNavigate();
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
        <span id="app_nav_title">MCTOSHS</span>
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

        {/* Quote banner — the same line whispered on the Login page, given
            room to breathe here instead of hiding in the corner. */}
        <div id="app_quote_banner">
          <i className="fi fi-rr-quote-right" id="app_quote_mark" />
          <div id="app_quote_body">
            <p id="app_quote_text">
              A worm born inside the human intestine cannot observe or
              imagine the unity of the larger reality that contains it, even
              if such a unity truly exists.
            </p>
            <span id="app_quote_tagline">From representation to reality — MCTOSHS</span>
          </div>
        </div>

        {/* Pipeline section */}
        <div id="app_pipeline_section">
          <p id="app_pipeline_label">MCTOSHS Clinical Pipeline</p>
          <div id="app_pipeline_row">
            {PIPELINE.map(({ path, icon, label, description, color, step }, i) => (
              <React.Fragment key={path}>
                <button
                  className="app_home_card app_pipeline_card"
                  style={{ "--nav-color": color }}
                  onClick={() => navigate(path)}
                >
                  <div className="app_pipeline_step_num">{step}</div>
                  <i className={`fi ${icon} app_home_card_icon`} />
                  <span className="app_home_card_label">{label}</span>
                  <span className="app_home_card_desc">{description}</span>
                </button>

                {i < PIPELINE.length - 1 && (
                  <div className="app_pipeline_connector">
                    <div className="app_connector_line" />
                    <i className="fi fi-rr-caret-right app_connector_arrow" />
                    <div className="app_connector_line" />
                  </div>
                )}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Other cards */}
        <div id="app_other_section">
          {OTHER.map(({ path, icon, label, description, color }) => (
            <button
              key={path}
              className="app_home_card"
              style={{ "--nav-color": color }}
              onClick={() => navigate(path)}
            >
              <i className={`fi ${icon} app_home_card_icon`} />
              <span className="app_home_card_label">{label}</span>
              <span className="app_home_card_desc">{description}</span>
            </button>
          ))}
        </div>

      </div>
    </div>
  );
};

export default App;
