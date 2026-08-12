import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { readStoredSession } from "../utils/sessionCleanup";
import { InfoPopupButton } from "../PDF/InfoPopupButton";
import { listMorphe, listMorpheSources } from "../ClinicalSchemata/amctoshsMorpheClient";
import { deleteStudySession, listStudySessions, startStudySession, stopStudySession } from "../utils/studySessions";
import SpokenTracesCard from "./SpokenTracesCard";
import UnspokenTracesCard from "./UnspokenTracesCard";
import HomeVocabsCard from "./HomeVocabsCard";
import "./App.css";

const AMCTOSHS_INTRO_INFO = "A composite representational entity of a patient, constituted by a collection of AMCTOSHS sub-entities, each representing a distinct aspect of that patient.";

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
      {
        path: "/segmentations",
        icon: "fi-rr-shapes",
        label: "AMCTOSHS Segmentation",
        description: "Browse the Line Blocks (BBoxes) extracted from a PDF source and extract AMCTOSHS Medical Statements from each one",
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
        description: "The global structured view of every AMCTOSHS Sub-Entity Schema — browse by AMCTOSHS Domain and inspect each one's timestamped AMCTOSHS Traces and Trace Values",
        color: "#26c6da",
      },
      {
        path: "/vocabs",
        icon: "fi-rr-book-alt",
        label: "AMCTOSHS Vocabs",
        description: "Look up AMCTOSHS vocabulary terms with dictionary definitions and usage information",
        color: "#26a69a",
      },
      {
        path: "/terminology",
        icon: "fi-rr-database",
        label: "AMCTOSHS Terminology",
        description: "Import and search a normalized local UMLS reference of concepts, terms, definitions, semantic types, relations, and sources",
        color: "#607d8b",
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
  {
    label: "Societies",
    color: "#ff8a65",
    letter: "S",
    cards: [],
  },
];
// Shared by the camera-preset settings panel, which still previews the
// biological scale labels independently of the Home dashboard.
export const LEVEL_LABELS = LEVELS.map((level) => level.label);

// The one named chunk inside the AMCTOSHS Tools dropdown (see app_study_tools_*
// below) — AMCTOSHS Hyle and AMCTOSHS Morphe are the two tools that actually
// BUILD an AMCTOSHS entity's raw material/structure, so they're grouped
// under their own heading; every other tool stays a flat, ungrouped list.
const BUILDING_TOOL_PATHS = ["/sources", "/segmentations", "/clinical-schemata"];

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

const formatStudyTimer = (totalSeconds) => {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
};

const isPdfSource = (source) => (
  String(source?.format || "").toLowerCase() === "pdf"
  || /\.pdf$/i.test(String(source?.name || source?.filename || ""))
);

const App = ({ onLogout }) => {
  const navigate = useNavigate();
  const profileMenuRef = useRef(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const studyToolsRef = useRef(null);
  const [studyToolsOpen, setStudyToolsOpen] = useState(false);
  const [sourceData, setSourceData] = useState(null);
  const [schemataData, setSchemataData] = useState(null);
  const [studySessions, setStudySessions] = useState([]);
  const [activeStudySession, setActiveStudySession] = useState(null);
  const [studyElapsedSeconds, setStudyElapsedSeconds] = useState(0);
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const session = readStoredSession();
  const profilePhoto = readProfilePhoto(session);
  const displayName = readDisplayName(session);
  const username = readHandle(session);
  const profileInitials = getInitials(displayName);

  const currentDateLabel = new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(currentTime);
  const currentTimeLabel = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(currentTime);
  const currentHour = currentTime.getHours();
  const greeting = currentHour < 12 ? "Good morning" : currentHour < 18 ? "Good afternoon" : "Good evening";
  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!activeStudySession?.startedAt) return undefined;

    const updateElapsedTime = () => {
      setStudyElapsedSeconds(Math.max(0, Math.floor((Date.now() - new Date(activeStudySession.startedAt).getTime()) / 1000)));
    };

    updateElapsedTime();
    const timer = window.setInterval(updateElapsedTime, 1000);
    return () => window.clearInterval(timer);
  }, [activeStudySession]);

  useEffect(() => {
    const controller = new AbortController();
    listStudySessions(controller.signal)
      .then(({ sessions = [] }) => {
        setStudySessions(sessions.filter((item) => item.status === "completed"));
        setActiveStudySession(sessions.find((item) => item.status === "active") || null);
      })
      .catch((error) => {
        if (error.name !== "AbortError") console.error("Failed to load study sessions", error);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    let cancelled = false;
    listMorpheSources()
      .then((sources) => { if (!cancelled) setSourceData(Array.isArray(sources) ? sources.filter(isPdfSource) : []); })
      .catch(() => { if (!cancelled) setSourceData(null); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    listMorphe()
      .then((data) => { if (!cancelled) setSchemataData(Array.isArray(data?.schemas) ? data.schemas : []); })
      .catch(() => { if (!cancelled) setSchemataData(null); });
    return () => { cancelled = true; };
  }, []);

  const handleStartStudySession = async () => {
    try {
      const { session: nextSession } = await startStudySession();
      setActiveStudySession(nextSession);
      setStudyElapsedSeconds(0);
    } catch (error) {
      console.error("Failed to start study session", error);
    }
  };

  const handleStopStudySession = async () => {
    if (!activeStudySession?.id) return;
    try {
      const { session: completedSession } = await stopStudySession(activeStudySession.id);
      setStudySessions((previous) => [completedSession, ...previous]);
      setActiveStudySession(null);
      setStudyElapsedSeconds(completedSession.durationSeconds || 0);
    } catch (error) {
      console.error("Failed to stop study session", error);
    }
  };

  const handleDeleteStudySession = async (sessionId) => {
    if (!window.confirm("Delete this study session?")) return;
    try {
      await deleteStudySession(sessionId);
      setStudySessions((previous) => previous.filter((item) => item.id !== sessionId));
    } catch (error) {
      console.error("Failed to delete study session", error);
    }
  };

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
    <div id="app_home_view">
      <div id="app_home_grid">
        <div id="app_scroll_track">
          <div id="app_scroll_stage">
            <section id="app_home_dashboard" aria-label="AMCTOSHS study dashboard">
              <div className="app_dashboard_header">
                <div>
                  <p className="app_dashboard_eyebrow">Study workspace / {currentDateLabel} · <time dateTime={currentTime.toISOString()}>{currentTimeLabel}</time></p>
                  <h1>{greeting}, {displayName.split(" ")[0]}.</h1>
                  <p>Keep the patient object in view as you move from source material to Morphe.</p>
                </div>
              </div>

              <div className="app_dashboard_grid">
                <HomeVocabsCard onOpen={() => navigate("/vocabs")} />

                <article className="app_dashboard_card app_about_card">
                  <div className="app_card_heading">
                    <div><span className="app_card_kicker">00 / THE AMCTOSHS MODEL</span><h2>What is AMCTOSHS?</h2></div>
                    <button
                      type="button"
                      className="app_about_icon"
                      onClick={() => navigate("/about/amctoshs")}
                      aria-label="Open AMCTOSHS Model Info"
                      title="Open AMCTOSHS Model Info"
                    >
                      <i className="fi fi-rr-lightbulb-on" />
                    </button>
                  </div>
                  <p className="app_card_description">AMCTOSHS is a model that builds a representation, or schema, of the intangible PATIENT object through tangible instances and the traces that illuminate it.</p>
                  <div className="app_about_sections">
                    <div><strong>Accessible modes</strong><span>Atoms · molecules · cells · tissues · organs · organ systems · humans · societies</span></div>
                    <div><strong>Traces and access</strong><span>Direct sensory access produces 3D traces. Indirect access uses proxies to reveal objects that doctors rely on during their processes, before the object is fully illuminated to them.</span></div>
                    <div><strong>Time and reasoning</strong><span>Traces that come from memory rather than the senses are 4D traces. Reasoning orders 4D traces to build the logical representation of the PATIENT object.</span></div>
                  </div>
                </article>

                <SpokenTracesCard />
                <UnspokenTracesCard />

                <article className="app_dashboard_card app_sessions_card">
                  <div className="app_card_heading">
                    <div><span className="app_card_kicker">02 / Your rhythm</span><h2>Study sessions</h2></div>
                    <button className="app_card_link" type="button" onClick={() => navigate("/pdf-reader")}>View log <i className="fi fi-rr-arrow-up-right" /></button>
                  </div>
                  <div className="app_session_list">
                    {studySessions.map((sessionItem) => (
                      <div key={sessionItem.id} className="app_session_row">
                        <span className="app_session_date"><strong>Study session</strong><small>{new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "short", year: "numeric" }).format(new Date(sessionItem.startedAt))}</small></span>
                        <span className="app_session_track"><span className="app_session_track_fill" style={{ width: `${Math.min(94, Math.max(12, (sessionItem.durationSeconds / 3600) * 100))}%` }} /></span>
                        <span className="app_session_meta"><strong>{formatStudyTimer(sessionItem.durationSeconds || 0)}</strong><small>completed</small></span>
                        <button className="app_session_delete" type="button" title="Delete study session" aria-label="Delete study session" onClick={() => handleDeleteStudySession(sessionItem.id)}><i className="fi fi-rr-trash" /></button>
                      </div>
                    ))}
                    {!studySessions.length && !activeStudySession && <p className="app_dashboard_empty">No study sessions recorded yet.</p>}
                    {activeStudySession && (
                      <div className="app_active_session" role="status" aria-live="polite">
                        <span className="app_active_session_badge"><i /> In progress</span>
                        <strong>{formatStudyTimer(studyElapsedSeconds)}</strong>
                        <small>Study session started now</small>
                      </div>
                    )}
                  </div>
                  <div className="app_session_empty_actions">
                    {!activeStudySession && <p className="app_dashboard_data_note">Completed sessions are saved to your study history.</p>}
                    {activeStudySession ? (
                      <button className="app_session_start app_session_stop" type="button" onClick={handleStopStudySession}>
                        <i className="fi fi-rr-stop" /> Stop study session
                      </button>
                    ) : (
                      <button className="app_session_start" type="button" onClick={handleStartStudySession}>
                        <i className="fi fi-rr-play" /> Start study session
                      </button>
                    )}
                  </div>
                </article>

                <article className="app_dashboard_card app_morphe_card">
                  <div className="app_card_heading">
                    <div><span className="app_card_kicker">01 / AMCTOSHS HYLE</span><h2>PDF Sources</h2></div>
                    <span className="app_morphe_status"><i /> {sourceData ? "Live" : "Unavailable"}</span>
                  </div>
                  <p className="app_card_description">Your PDF source library for reading, annotation, and AMCTOSHS extraction.</p>
                  <div className="app_sources_summary" aria-label="PDF source summary">
                    <div className="app_sources_count"><strong>{sourceData ? sourceData.length : "—"}</strong><small>PDF sources</small></div>
                    <div className="app_sources_list">{sourceData?.slice(0, 3).map((source) => <span key={source._id}>{source.name || source.title || "Untitled source"}</span>)}{sourceData?.length === 0 && <span>No PDF sources yet.</span>}{!sourceData && <span>Loading sources…</span>}</div>
                  </div>
                  <button className="app_morphe_action" type="button" onClick={() => navigate("/sources")}>Open PDF Sources <i className="fi fi-rr-arrow-up-right" /></button>
                </article>

                <article className="app_dashboard_card app_schemata_card">
                  <div className="app_card_heading">
                    <div><span className="app_card_kicker">02 / AMCTOSHS MORPHE</span><h2>Schemata</h2></div>
                    <span className="app_trace_card_icon"><i className="fi fi-rr-network" /></span>
                  </div>
                  <p className="app_card_description">Saved AMCTOSHS schemata, with their object identifiers and domains ready for inspection.</p>
                  <div className="app_schemata_summary" aria-label="Saved schemata">
                    <div className="app_schemata_count"><strong>{schemataData ? schemataData.length : "—"}</strong><small>saved schemata</small></div>
                    <div className="app_schemata_list">
                      {schemataData?.slice(0, 4).map((schema) => (
                        <span key={schema._id}>
                          <strong>{schema.name || schema.objectId || "Unnamed schema"}</strong>
                          <small>{schema.domain || "Unclassified"}</small>
                        </span>
                      ))}
                      {schemataData?.length === 0 && <span className="app_schemata_empty">No saved schemata yet.</span>}
                      {!schemataData && <span className="app_schemata_empty">Loading schemata…</span>}
                    </div>
                  </div>
                  <button className="app_morphe_action" type="button" onClick={() => navigate("/clinical-schemata")}>Open Schemata <i className="fi fi-rr-arrow-up-right" /></button>
                </article>
              </div>
            </section>

            <div id="app_scroll_hint">
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

            <div id="app_scroll_hint_content">
              <span id="app_scroll_hint_title">AMCTOSHS</span>
              <span id="app_scroll_hint_sub">A focused view of your object, sessions, and Morphe work</span>
            </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
