import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import ThreadPyramidLogo from "./ThreadPyramidLogo";
import { readStoredSession } from "../utils/sessionCleanup";
import "./App.css";

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
        label: "AMCTOSHS Entities",
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
const LEVEL_LABELS = LEVELS.map((level) => level.label);
const HOME_SCROLL_STORAGE_KEY = "mctoshs_home_scroll_top";
const HOME_PROGRESS_STORAGE_KEY = "mctoshs_home_progress";

const readSavedHomeScrollTop = () => {
  try {
    const fromSession = Number(sessionStorage.getItem(HOME_SCROLL_STORAGE_KEY) || "");
    if (Number.isFinite(fromSession) && fromSession > 0) return fromSession;
  } catch {}
  try {
    const fromLocal = Number(localStorage.getItem(HOME_SCROLL_STORAGE_KEY) || "");
    if (Number.isFinite(fromLocal) && fromLocal > 0) return fromLocal;
  } catch {}
  return 0;
};

const saveHomeScrollTop = (value) => {
  const next = String(Math.max(0, Number(value) || 0));
  try { sessionStorage.setItem(HOME_SCROLL_STORAGE_KEY, next); } catch {}
  try { localStorage.setItem(HOME_SCROLL_STORAGE_KEY, next); } catch {}
};

const readSavedHomeProgress = () => {
  try {
    const fromSession = Number(sessionStorage.getItem(HOME_PROGRESS_STORAGE_KEY) || "");
    if (Number.isFinite(fromSession) && fromSession >= 0) return Math.min(1, fromSession);
  } catch {}
  try {
    const fromLocal = Number(localStorage.getItem(HOME_PROGRESS_STORAGE_KEY) || "");
    if (Number.isFinite(fromLocal) && fromLocal >= 0) return Math.min(1, fromLocal);
  } catch {}
  return 0;
};

const saveHomeProgress = (value) => {
  const next = String(Math.min(1, Math.max(0, Number(value) || 0)));
  try { sessionStorage.setItem(HOME_PROGRESS_STORAGE_KEY, next); } catch {}
  try { localStorage.setItem(HOME_PROGRESS_STORAGE_KEY, next); } catch {}
};

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
  const session = readStoredSession();
  const profilePhoto = readProfilePhoto(session);
  const displayName = readDisplayName(session);
  const username = readHandle(session);
  const profileInitials = getInitials(displayName);

  const handleScroll = (event) => {
    const el = event.currentTarget;
    const scrollable = el.scrollHeight - el.clientHeight;
    const p = scrollable > 0 ? el.scrollTop / scrollable : 0;
    saveHomeScrollTop(el.scrollTop);
    saveHomeProgress(p);
    setProgress(Math.min(1, Math.max(0, p)));
  };

  const activeLevel = useMemo(
    () => Math.min(LEVELS.length - 1, Math.floor(progress * (LEVELS.length - 1) + 0.0001)),
    [progress]
  );

  // The scrollable track has nine snap positions but only eight intervals
  // between them. Those eight intervals are exactly the eight sewing spans:
  // Hyle -> Atoms sews Atoms, Atoms -> Molecules sews Molecules, and so on.
  const climbProgress = progress;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const savedTop = readSavedHomeScrollTop();
    const savedProgress = readSavedHomeProgress();
    if (!savedTop && !savedProgress) return;

    let raf = 0;
    let cancelled = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 60;

    const restoreScroll = () => {
      if (cancelled) return;
      attempts += 1;

      const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
      const fallbackTop = savedProgress > 0 ? savedProgress * maxScroll : 0;
      const desiredTop = savedTop > 0 ? savedTop : fallbackTop;
      const nextTop = Math.min(desiredTop, maxScroll);
      if (maxScroll > 0 && nextTop > 0) {
        el.scrollTop = nextTop;
        const p = nextTop / maxScroll;
        setProgress(Math.min(1, Math.max(0, p)));
      } else if (maxScroll > 0 && savedProgress > 0) {
        setProgress(Math.min(1, Math.max(0, savedProgress)));
      }

      // Keep retrying until the scroll container has measurable travel and
      // the desired position sticks after layout settles.
      const layoutNotReady = maxScroll <= 0 && (savedTop > 0 || savedProgress > 0);
      const positionNotApplied = maxScroll > 0 && Math.abs(el.scrollTop - nextTop) > 1;
      if (attempts < MAX_ATTEMPTS && (layoutNotReady || positionNotApplied)) {
        raf = requestAnimationFrame(restoreScroll);
      }
    };

    raf = requestAnimationFrame(restoreScroll);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, []);

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (!profileMenuRef.current?.contains(event.target)) {
        setProfileMenuOpen(false);
      }
    };

    const handleEscape = (event) => {
      if (event.key === "Escape") setProfileMenuOpen(false);
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
            />

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

            <div id="app_scroll_hint" className={progress > 0.03 ? "app_scroll_hint--hidden" : ""}>
              <span id="app_scroll_hint_title">AMCTOSHS</span>
              <p id="app_scroll_hint_intro">
                A composite representational entity of a patient, constituted by a collection of AMCTOSHS sub-entities, each representing a distinct aspect of that patient.
              </p>
              <p id="app_scroll_hint_intro_levels">
                The domain of AMCTOSHS spans the following levels of organization:
                <br />
                <span id="app_domain_flow">Atoms → Molecules → Tissues → Organs → Organ Systems → Humans → Societies</span>
              </p>
              <span id="app_scroll_hint_sub">Scroll to study the hyle and climb the eight biological scales ↓</span>
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

          {LEVELS.map(({ label }) => (
            <div key={`scroll-step-${label}`} className="app_floor_scroll_step" aria-hidden="true" />
          ))}
        </div>
      </div>
    </div>
  );
};

export default App;
