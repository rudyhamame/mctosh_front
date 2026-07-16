import React, { Suspense, lazy, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import ThreadPyramidLogo from "./ThreadPyramidLogo";
import "./App.css";

// Loaded the same lazy way AppRouter.js loads it for every other page — the
// app-wide footer is hidden on Home (see AppRouter.js's FooterGate), so Dev
// AI needs its own instance docked inside the canvas here instead.
const HomeChat = lazy(() => import("./HomeChat"));

// The 14 navigable tools, regrouped by which of the six AMCTOSHS biological
// scales they sit closest to — Molecule (rawest hyle/text) up through Human
// (whole-app, whole-person) — plus a leading Hyle stage that isn't one of
// the six scales at all: the ground threads themselves, before any of them
// has risen into the object. Ground threads sit flat in a 2D plane (see
// buildGroundThreads in ThreadPyramidLogo.jsx) — full of indeterminacy, no
// length, height, location, direction, or shape resolved in 3D yet. Only
// once a thread is studied does it rise and start becoming a Molecule; this
// grouping drives the scroll stage below, holding the camera at the ground
// for this first stage before the climb through the six scales begins (see
// climbProgress in the App component).
const LEVELS = [
  {
    label: "Hyle",
    color: "#b0bec5",
    letter: null,
    blurb: "The ground threads themselves — flat, in a 2D plane, full of indeterminacy. No length, height, location, direction, or shape in 3D yet.",
    cards: [
      {
        path: "/sources",
        icon: "fi-rr-books",
        label: "AMCTOSHS Hyle",
        description: "Store and manage PDFs as the hyle source library for AMCTOSHS extraction and analysis",
        color: "#4fc3f7",
      },
    ],
  },
  {
    label: "Atoms",
    color: "#ffb74d",
    letter: "A",
    blurb: "Before it's a molecule, it's an atom: protons and electrons accumulate one at a time right where the thread first begins to rise, out of the raw ground itself.",
    cards: [],
  },
  {
    label: "Molecules",
    color: "#7e57c2",
    letter: "M",
    blurb: "Studying begins: logic buried in the folds surfaces as a thread first rises out of the ground and takes shape in 3D.",
    cards: [
      {
        path: "/linguistic-analysis",
        icon: "fi-rr-language",
        label: "Clinical Linguistic Analysis",
        description: "Extract morphemes, words, syntagms, clauses, sentences, and paragraphs from any converted PDF page",
        color: "#69f0ae",
      },
      {
        path: "/units-extraction",
        icon: "fi-rr-book-open-reader",
        label: "AMCTOSHS Units Extraction while Studying",
        description: "Read a source and select any span of text to run a linguistic analysis on it",
        color: "#b39ddb",
      },
    ],
  },
  {
    label: "Cell",
    color: "#5c6bc0",
    letter: "C",
    cards: [
      {
        path: "/clinical-schemata",
        icon: "fi-rr-network",
        label: "MCTOSH Entities",
        description: "Extract or manually define Entities and their Entity Schemas — traces and trace values — across the six biological dimensions",
        color: "#26c6da",
      },
      {
        path: "/mcc/mccqe/objectives",
        icon: "fi-rr-document-signed",
        label: "MCCQE Objectives",
        description: "Browse the MCCQE objectives dataset with search, group filters, and rendered objective content",
        color: "#d4a24c",
      },
    ],
  },
  {
    label: "Tissue",
    color: "#42a5f5",
    letter: "T",
    cards: [
      {
        path: "/pdf-reader",
        icon: "fi-rr-file-pdf",
        label: "PDF Reader",
        description: "Open and annotate any PDF source — highlight, draw, and extract markdown page by page",
        color: "#ef5350",
      },
      {
        path: "/draft",
        icon: "fi-rr-notebook",
        label: "AMCTOSHS Draft",
        description: "A running scratchpad for notes you find while reading — autosaves as you write",
        color: "#ffca28",
      },
      {
        path: "/freeform",
        icon: "fi-rr-note-sticky",
        label: "Freeform",
        description: "Infinite canvas boards for freeform notes, sketches, and sticky notes — pan, zoom, draw, and write anywhere",
        color: "#ffca28",
      },
    ],
  },
  {
    label: "Organ",
    color: "#26c6da",
    letter: "O",
    cards: [
      {
        path: "/clinical-vignettes",
        icon: "fi-rr-clipboard-list-check",
        label: "Clinical Vignette Generator",
        description: "Generate original, USMLE Step 2 CK–style clinical vignette questions with AI — review, edit, approve, and export",
        color: "#ab47bc",
      },
      {
        path: "/medical-exams",
        icon: "fi-rr-graduation-cap",
        label: "Medical Exams",
        description: "Track exams with their sources, page spans, and reading progress — jump straight to a page in the PDF Reader",
        color: "#4fc3f7",
      },
    ],
  },
  {
    label: "Organ System",
    color: "#26a69a",
    letter: "OS",
    cards: [
      {
        path: "/patient-instantiation",
        icon: "fi-rr-hospital-user",
        label: "Patient Instantiation",
        description: "Instantiate the Patient Instance — receive the Morphe to form the Hylomorphic Entity",
        color: "#26a69a",
      },
      {
        path: "/human-atlas",
        icon: "fi-rr-heart",
        label: "Human Reference Atlas",
        description: "Browse 3D organ models, cell type and ontology trees, FTU illustrations, and tissue blocks from the Human Reference Atlas API",
        color: "#e57373",
      },
      {
        path: "/social-media-control",
        icon: "fi-rr-megaphone",
        label: "AMCTOSHS Social Media Control",
        description: "Plan campaigns, shape captions, review post drafts, and prepare Instagram publishing workflows",
        color: "#ff8a65",
      },
    ],
  },
  {
    label: "Human",
    color: "#66bb6a",
    letter: "H",
    cards: [
      {
        path: "/settings",
        icon: "fi-rr-settings",
        label: "Settings",
        description: "Control prompts, AI providers, and app theme",
        color: "#78909c",
      },
    ],
  },
];

const App = ({ onLogout }) => {
  const navigate = useNavigate();
  const [progress, setProgress] = useState(0);
  const scrollRef = useRef(null);

  // The scroll track is (LEVELS.length + 1) viewport-heights tall so there's
  // exactly LEVELS.length worth of scrollable travel behind the sticky-pinned
  // stage — progress 0..1 maps directly onto the LEVELS groups (Hyle plus
  // the six biological scales), one viewport-height of scroll each.
  const trackVh = (LEVELS.length + 1) * 100;

  const handleScroll = (event) => {
    const el = event.currentTarget;
    const scrollable = el.scrollHeight - el.clientHeight;
    const p = scrollable > 0 ? el.scrollTop / scrollable : 0;
    setProgress(Math.min(1, Math.max(0, p)));
  };

  const activeLevel = useMemo(
    () => Math.min(LEVELS.length - 1, Math.floor(progress * LEVELS.length)),
    [progress]
  );

  // ThreadPyramidLogo's camera only climbs through the six biological
  // scales — Hyle has no rung of its own to climb to, it's the flat ground
  // the object is rooted in. So the object's own 0..1 "climb" input only
  // starts advancing once scroll progress has passed the Hyle segment (the
  // first 1/LEVELS.length of the track); before that, the camera holds at
  // the ground view (climbProgress 0) while the Hyle card is up.
  const hyleFraction = 1 / LEVELS.length;
  const climbProgress = Math.min(
    1,
    Math.max(0, (progress - hyleFraction) / (1 - hyleFraction))
  );

  return (
    <div id="App_viewportScale">
      <div id="app_home_grid" ref={scrollRef} onScroll={handleScroll}>
        <div id="app_scroll_track" style={{ height: `${trackVh}vh` }}>
          <div id="app_scroll_stage">
            <ThreadPyramidLogo progress={climbProgress} />

            <button id="app_logout_btn" onClick={onLogout}>Logout</button>

            <Suspense fallback={null}>
              <HomeChat />
            </Suspense>

            <div id="app_scroll_hint" className={progress > 0.03 ? "app_scroll_hint--hidden" : ""}>
              <span id="app_scroll_hint_title">AMCTOSHS</span>
              <span id="app_scroll_hint_sub">Scroll to study the hyle and climb the six biological scales ↓</span>
            </div>

            <div id="app_level_overlay">
              {LEVELS.map(({ label, color, letter, blurb, cards }, i) => (
                <div
                  key={label}
                  className={`app_level_group${i === activeLevel ? " app_level_group--active" : ""}`}
                  style={{ "--nav-color": color }}
                >
                  <div className="app_level_group_head">
                    {letter && <span className="app_level_group_letter">{letter}</span>}
                    <span className="app_level_group_label">{label}</span>
                  </div>
                  {blurb && <p className="app_level_group_blurb">{blurb}</p>}
                  <div className="app_level_group_row">
                    {cards.map(({ path, icon, label: cardLabel, description, color: cardColor }) => (
                      <button
                        key={path}
                        className="app_home_card"
                        style={{ "--nav-color": cardColor }}
                        onClick={() => navigate(path)}
                      >
                        <i className={`fi ${icon} app_home_card_icon`} />
                        <span className="app_home_card_label">{cardLabel}</span>
                        <span className="app_home_card_desc">{description}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
