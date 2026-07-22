import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import ThreadPyramidLogo from "./ThreadPyramidLogo";
import { readStoredSession } from "../utils/sessionCleanup";
import { InfoPopupButton } from "../PDF/InfoPopupButton";
import "./App.css";

const AMCTOSHS_INTRO_INFO = "A composite representational entity of a patient, constituted by a collection of AMCTOSHS sub-entities, each representing a distinct aspect of that patient.";

// Loaded the same lazy way AppRouter.js loads it for every other page — the
// app-wide footer is hidden on Home (see AppRouter.js's FooterGate), so Dev
// AI needs its own instance docked inside the canvas here instead.
const HomeChat = lazy(() => import("./HomeChat"));

// The 14 navigable tools, regrouped by which of the eight AMCTOSHS
// biological/social scales they sit closest to — Atoms (the essential
// ions) up through Society (whole population) — plus a leading Hyle stage
// that isn't one of the eight scales at all: the ground threads
// themselves, before any of them has risen into the object. Ground threads
// sit flat in a 2D plane (see buildGroundThreads in ThreadPyramidLogo.jsx)
// — full of indeterminacy, no length, height, location, direction, or
// shape resolved in 3D yet. This grouping drives the scroll stage below,
// holding the camera at the ground for this first stage before the climb
// through the eight scales begins (see climbProgress in the App component).
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
    blurb: "The essential ions — potassium, sodium, calcium, magnesium, chloride, hydrogen, iron, zinc — driving along the thread, trapped flat in their own 2D floor.",
    cards: [],
  },
  {
    label: "Molecules",
    color: "#7e57c2",
    letter: "M",
    blurb: "Studying begins: logic buried in the folds surfaces as a thread first rises out of the ground and takes shape in 3D.",
    cards: [
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
        label: "AMCTOSHS Morphe",
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
      {
        path: "/voice-profile",
        icon: "fi-rr-microphone",
        label: "Voice Profiles",
        description: "Record or upload your own voice for the local 3D avatar's cloned-voice speech",
        color: "#ab47bc",
      },
    ],
  },
  {
    label: "Societies",
    color: "#ff8a65",
    letter: "S",
    cards: [],
  },
];
export const LEVEL_LABELS = LEVELS.map((level) => level.label);

// The one named chunk inside the AMCTOSHS Tools dropdown (see app_study_tools_*
// below) — AMCTOSHS Hyle and AMCTOSHS Morphe are the two tools that actually
// BUILD an AMCTOSHS entity's raw material/structure, so they're grouped
// under their own heading; every other tool stays a flat, ungrouped list.
const BUILDING_TOOL_PATHS = ["/sources", "/clinical-schemata"];

// How many screens of scrolling each level's own step takes — 1 = today's
// uniform 100vh-per-level default. Hardcoded here, NOT persisted anywhere
// at runtime (no localStorage, no backend) — same "tune live, copy the
// result into source, commit it" pattern as ThreadPyramidLogo.jsx's own
// DEFAULT_CAMERA_PRESETS, so every visitor gets the same pacing rather than
// whoever's browser happened to save one. weights[0] (Hyle) is scrolled
// through BEFORE any climbing starts; weights[1..8] each pace exactly one
// sewing span (Hyle->Atoms sews Atoms, Atoms->Molecules sews Molecules, and
// so on — see ThreadPyramidLogo.jsx's own floorSewFractionFor). The
// control panel's "Copy scroll weights as code" button produces a
// paste-ready replacement for this array.
const DEFAULT_LEVEL_SCROLL_WEIGHTS = LEVELS.map(() => 1);

const readProfilePhoto = (session) => (
  session?.photoUrl
  || session?.profilePhoto
  || session?.profilePicture
  || session?.avatarUrl
  || session?.imageUrl
  || session?.user?.photoUrl
  || session?.user?.profilePhoto
  || session?.user?.profilePicture
  || session?.user?.avatarUrl
  || session?.user?.imageUrl
  || ""
);

const readDisplayName = (session) => (
  session?.name
  || session?.displayName
  || session?.fullName
  || session?.username
  || session?.user?.name
  || session?.user?.displayName
  || session?.user?.fullName
  || session?.user?.username
  || "Profile"
);

const readHandle = (session) => (
  session?.username
  || session?.user?.username
  || ""
);

const getInitials = (label) => {
  const words = String(label || "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "P";
  return words.slice(0, 2).map((word) => word[0]?.toUpperCase() || "").join("") || "P";
};

const App = ({ onLogout }) => {
  const navigate = useNavigate();
  const [progress, setProgress] = useState(0);
  const scrollRef = useRef(null);
  const profileMenuRef = useRef(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const studyToolsRef = useRef(null);
  const [studyToolsOpen, setStudyToolsOpen] = useState(false);
  const session = readStoredSession();
  const profilePhoto = readProfilePhoto(session);
  const displayName = readDisplayName(session);
  const username = readHandle(session);
  const profileInitials = getInitials(displayName);

  const handleScroll = (event) => {
    const el = event.currentTarget;
    const scrollable = el.scrollHeight - el.clientHeight;
    const p = scrollable > 0 ? el.scrollTop / scrollable : 0;
    setProgress(Math.min(1, Math.max(0, p)));
  };

  const [scrollWeights, setScrollWeights] = useState(DEFAULT_LEVEL_SCROLL_WEIGHTS);
  const setScrollWeight = (levelIndex, weight) => {
    setScrollWeights((prev) => prev.map((w, i) => (i === levelIndex ? Math.max(0.1, weight) : w)));
  };

  // Cumulative raw-progress boundary at the START of each level's own
  // scroll step, derived from the REAL (possibly hand-tuned, non-uniform)
  // per-level weights instead of assuming every step is the same height —
  // length LEVELS.length + 1: boundaries[0] = 0, boundaries[LEVELS.length] = 1.
  const levelBoundaries = useMemo(() => {
    const total = scrollWeights.reduce((sum, w) => sum + Math.max(0.1, w), 0) || 1;
    let cursor = 0;
    const boundaries = [0];
    for (const w of scrollWeights) {
      cursor += Math.max(0.1, w) / total;
      boundaries.push(cursor);
    }
    return boundaries;
  }, [scrollWeights]);

  const activeLevel = useMemo(() => {
    for (let i = LEVELS.length - 1; i >= 0; i--) {
      if (progress >= levelBoundaries[i] - 0.0001) return i;
    }
    return 0;
  }, [progress, levelBoundaries]);

  // The scrollable track has nine snap positions but only eight intervals
  // between them. Those eight intervals are exactly the eight sewing spans:
  // Hyle -> Atoms sews Atoms, Atoms -> Molecules sews Molecules, and so on.
  // "Hyle -> Atoms sews Atoms" means literally that: Atoms builds up WHILE
  // scrolling through Hyle's own zone, finishing exactly when you cross
  // into Atoms' zone — not while scrolling through Atoms' own zone after
  // you've already arrived. That distinction matters a lot in practice:
  // scroll-snap-type:mandatory means the page only ever comes to rest at
  // the START of a level's zone, never partway through it — so if a
  // level's own geometry only sewed itself while dwelling in its own zone,
  // it would always be sitting at 0% built the instant you actually landed
  // on it (this was a real bug: restoring a saved scroll position, or just
  // scrolling normally, would land you on e.g. Atoms with its geometry
  // still fully unsewn, indistinguishable from bare Hyle). Sewing level k
  // during level (k-1)'s own zone instead means it's already fully built
  // by the time you arrive.
  const climbProgress = useMemo(() => {
    const sewSpanCount = LEVELS.length - 1; // 8 — matches FLOOR_COUNT-1 in ThreadPyramidLogo.jsx
    if (activeLevel >= sewSpanCount) return 1; // resting on/past the last level — everything already built
    const zoneStart = levelBoundaries[activeLevel];
    const zoneEnd = levelBoundaries[activeLevel + 1] ?? 1;
    const zoneSpan = Math.max(0.0001, zoneEnd - zoneStart);
    const withinZone = Math.min(1, Math.max(0, (progress - zoneStart) / zoneSpan));
    return (activeLevel + withinZone) / sewSpanCount;
  }, [progress, activeLevel, levelBoundaries]);

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (!profileMenuRef.current?.contains(event.target)) {
        setProfileMenuOpen(false);
      }
      if (!studyToolsRef.current?.contains(event.target)) {
        setStudyToolsOpen(false);
      }
    };

    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setProfileMenuOpen(false);
        setStudyToolsOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  return (
    <div id="App_viewportScale">
      <div id="app_home_grid" ref={scrollRef} onScroll={handleScroll}>
        <div id="app_scroll_track">
          <div id="app_scroll_stage">
            <ThreadPyramidLogo
              progress={climbProgress}
              activeLevel={activeLevel}
              levelLabels={LEVEL_LABELS}
              scrollWeights={scrollWeights}
              onScrollWeightChange={setScrollWeight}
            />

            {/* Every level's own tool buttons, consolidated into one dropdown
                on the intro banner's left side (the profile menu already
                owns the right) — the per-level cards used to sit inline in
                each level's floating panel below the object, one row per
                level; now that panel is just the label/blurb (see
                app_level_group below), and every tool lives here regardless
                of which level it belongs to. */}
            <div id="app_study_tools_menu" ref={studyToolsRef}>
              <button
                id="app_study_tools_trigger"
                onClick={() => setStudyToolsOpen((open) => !open)}
                aria-haspopup="menu"
                aria-expanded={studyToolsOpen}
                title="AMCTOSHS Tools"
              >
                <i className="fi fi-rr-apps" />
                <span>AMCTOSHS Tools</span>
              </button>

              {studyToolsOpen && (() => {
                const allCards = LEVELS.flatMap((level) => level.cards);
                const buildingCards = allCards.filter((card) => BUILDING_TOOL_PATHS.includes(card.path));
                const otherCards = allCards.filter((card) => !BUILDING_TOOL_PATHS.includes(card.path));
                const renderCard = (card) => (
                  <button
                    key={card.path}
                    className="app_home_card"
                    role="menuitem"
                    style={{ "--nav-color": card.color }}
                    onClick={() => {
                      setStudyToolsOpen(false);
                      navigate(card.path);
                    }}
                  >
                    <i className={`fi ${card.icon} app_home_card_icon`} />
                    <span className="app_home_card_label">{card.label}</span>
                    <span className="app_home_card_desc">{card.description}</span>
                  </button>
                );
                return (
                  <div id="app_study_tools_dropdown" role="menu" aria-label="AMCTOSHS Tools">
                    {buildingCards.length > 0 && (
                      <div className="app_study_tools_group">
                        <div className="app_study_tools_group_label">AMCTOSHS Building Tools</div>
                        {buildingCards.map(renderCard)}
                      </div>
                    )}
                    {otherCards.map(renderCard)}
                  </div>
                );
              })()}
            </div>

            <div id="app_profile_menu" ref={profileMenuRef}>
              <button
                id="app_profile_trigger"
                onClick={() => setProfileMenuOpen((open) => !open)}
                aria-haspopup="menu"
                aria-expanded={profileMenuOpen}
                title={displayName}
              >
                {profilePhoto ? (
                  <img src={profilePhoto} alt={displayName} />
                ) : (
                  <span>{profileInitials}</span>
                )}
              </button>

              {profileMenuOpen && (
                <div id="app_profile_dropdown" role="menu" aria-label="Profile menu">
                  <div id="app_profile_summary">
                    <div id="app_profile_summary_name">{displayName}</div>
                    {username && <div id="app_profile_summary_handle">@{username}</div>}
                  </div>

                  <button
                    className="app_profile_dropdown_item"
                    role="menuitem"
                    onClick={() => {
                      setProfileMenuOpen(false);
                      navigate("/settings?section=personal");
                    }}
                  >
                    <i className="fi fi-rr-user" />
                    <span>Personal information</span>
                  </button>
                  <button
                    className="app_profile_dropdown_item"
                    role="menuitem"
                    onClick={() => {
                      setProfileMenuOpen(false);
                      navigate("/settings");
                    }}
                  >
                    <i className="fi fi-rr-settings" />
                    <span>Settings</span>
                  </button>
                  <button
                    className="app_profile_dropdown_item app_profile_dropdown_item--danger"
                    role="menuitem"
                    onClick={() => {
                      setProfileMenuOpen(false);
                      onLogout();
                    }}
                  >
                    <i className="fi fi-rr-sign-out-alt" />
                    <span>Logout</span>
                  </button>
                </div>
              )}
            </div>

            <Suspense fallback={null}>
              <HomeChat />
            </Suspense>

            <div id="app_scroll_hint">
              <span id="app_scroll_hint_title">AMCTOSHS</span>
              <div id="app_scroll_hint_head">
                <span id="app_domain_flow">Atoms → Molecules → Tissues → Organs → Organ Systems → Humans → Societies</span>
                <InfoPopupButton info={AMCTOSHS_INTRO_INFO} label="About AMCTOSHS" />
              </div>
              <span id="app_scroll_hint_sub">Scroll to study the hyle and climb the eight biological scales ↓</span>
            </div>

            <div id="app_level_overlay">
              {LEVELS.map(({ label, color, letter, blurb }, i) => (
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
                </div>
              ))}
            </div>
          </div>

          {LEVELS.map(({ label }, i) => (
            <div
              key={`scroll-step-${label}`}
              className="app_floor_scroll_step"
              style={{ height: `calc(var(--vh, 1vh) * 100 * ${scrollWeights[i]})` }}
              aria-hidden="true"
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default App;
