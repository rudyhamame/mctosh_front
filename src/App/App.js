import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { readStoredSession } from "../utils/sessionCleanup";
import { apiUrl } from "../config/api";
import { InfoPopupButton } from "../PDF/InfoPopupButton";
import { listMorphe, listMorpheSources } from "../ClinicalSchemata/amctoshsMorpheClient";
import { deleteStudySession, listStudySessions, startStudySession, stopStudySession } from "../utils/studySessions";
import SpokenTracesCard from "./SpokenTracesCard";
import UnspokenTracesCard from "./UnspokenTracesCard";
import HomeVocabsCard from "./HomeVocabsCard";
import RabbitLogoBlink from "../Shared/RabbitLogoBlink";
import "./home.css";
import HomeChat from "./HomeChat";

const AMCTOSHS_INTRO_INFO = "A composite representational entity of a patient, constituted by a collection of RabbitHole sub-entities, each representing a distinct aspect of that patient.";

const HOME_COLOR_WAVE_FRAMES = Array.from({ length: 10 }, (_, index) => (
  `/app%20background%20/colored/${index + 1}.webp`
));

const HomeColorWave = () => {
  const canvasRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [active, setActive] = useState(true);
  const [fadingOut, setFadingOut] = useState(false);

  useEffect(() => {
    const homeView = document.getElementById("app_home_view");
    if (!homeView) return undefined;
    if (ready && active && !fadingOut) homeView.classList.add("is-color-wave-active");
    else homeView.classList.remove("is-color-wave-active");
    return () => homeView.classList.remove("is-color-wave-active");
  }, [ready, active, fadingOut]);

  useEffect(() => {
    let cancelled = false;
    const preloaders = HOME_COLOR_WAVE_FRAMES.map((source) => new Promise((resolve) => {
      const image = new Image();
      image.onload = () => {
        const decoded = typeof image.decode === "function"
          ? image.decode().catch(() => {})
          : Promise.resolve();
        decoded.then(resolve);
      };
      image.onerror = resolve;
      image.src = source;
    }));
    Promise.all(preloaders).then(() => {
      if (!cancelled) setReady(true);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!ready) return undefined;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return undefined;
    const images = HOME_COLOR_WAVE_FRAMES.map((source) => {
      const image = new Image();
      image.src = source;
      return image;
    });
    let frameIndex = 0;
    let frameStartedAt = performance.now();
    let animationFrame = 0;
    let fadeOutTimer = 0;
    let resizeObserver = null;

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(bounds.width * ratio));
      canvas.height = Math.max(1, Math.round(bounds.height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const drawCover = (image, alpha = 1) => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
      const drawWidth = image.naturalWidth * scale;
      const drawHeight = image.naturalHeight * scale;
      context.globalAlpha = alpha;
      context.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
    };

    const render = (now) => {
      const elapsed = now - frameStartedAt;
      const holdDuration = 163.333;
      const crossfadeDuration = 170;
      const totalDuration = holdDuration + crossfadeDuration;
      const progress = Math.min(1, Math.max(0, (elapsed - holdDuration) / crossfadeDuration));
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      context.clearRect(0, 0, width, height);
      drawCover(images[frameIndex], 1);
      if (progress > 0 && frameIndex < images.length - 1) {
        drawCover(images[frameIndex + 1], progress);
      }
      context.globalAlpha = 1;

      if (elapsed >= totalDuration) {
        if (frameIndex >= images.length - 1) {
          setFadingOut(true);
          // Keep the final colored frame over the original pattern long enough
          // for both layers to crossfade instead of switching at the boundary.
          fadeOutTimer = window.setTimeout(() => setActive(false), 700);
          return;
        }
        frameIndex += 1;
        frameStartedAt = now;
      }
      animationFrame = window.requestAnimationFrame(render);
    };

    resize();
    if (typeof ResizeObserver === "function") {
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(canvas);
    } else {
      window.addEventListener("resize", resize);
    }
    animationFrame = window.requestAnimationFrame(render);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.clearTimeout(fadeOutTimer);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, [ready]);

  if (!active || !ready) return null;

  return <canvas ref={canvasRef} className={`app_home_color_wave${fadingOut ? " is-fading-out" : ""}`} aria-hidden="true" />;
};

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
        label: "Meta-Patient Noumena",
        description: "The logic about reconstructing patient noumena: representations, descriptions, records, images, measurements, or models referring to Patient Noumena.",
        color: "#4fc3f7",
      },
      {
        path: "/segmentations",
        icon: "fi-rr-shapes",
        label: "RabbitHole Hylomorphic Entities in 3D Mode",
        description: "Browse the Line Blocks (BBoxes) extracted from a PDF source and extract RabbitHole medical statements from each one",
        color: "#4fc3f7",
      },
      {
        path: "/hyle-entities-4d",
        icon: "fi-rr-time-past",
        label: "RabbitHole Hylomorphic Entities in 4D Mode",
        description: "View Hyle entities as persistent identities across changing states and representations",
        color: "#7e57c2",
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
        label: "RabbitHole's Patient Representation",
        description: "The global structured view of every RabbitHole Sub-Entity Schema — browse by RabbitHole Domain and inspect each one's timestamped RabbitHole Traces and Trace Values",
        color: "#26c6da",
      },
      {
        path: "/morphemes",
        icon: "fi-rr-book-alt",
        label: "RabbitHole Morphemes",
        description: "Look up RabbitHole morphemes with dictionary definitions and usage information",
        color: "#26a69a",
      },
      {
        path: "/terminology",
        icon: "fi-rr-database",
        label: "RabbitHole Terminology",
        description: "Import and search a normalized local UMLS reference of concepts, terms, definitions, semantic types, relations, and sources",
        color: "#607d8b",
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
        label: "Patient Noumena",
        description: "The patients-in-themselves: actual, concrete patient instances as they exist independently of any observation, description, image, measurement, or model.",
        color: "#26a69a",
      },
      {
        path: "/social-media-control",
        icon: "fi-rr-megaphone",
        label: "RabbitHole Social Media Control",
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

const ONTIC_TOOL_PATHS = ["/patient-instantiation", "/sources"];
const NOETIC_TOOL_PATHS = ["/segmentations", "/hyle-entities-4d", "/clinical-schemata"];

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

const App = ({ onLogout, colorWaveEnabled = true }) => {
  const navigate = useNavigate();
  const profileMenuRef = useRef(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantOpening, setAssistantOpening] = useState(false);
  const assistantLogoRef = useRef(null);
  const [sourceData, setSourceData] = useState(null);
  const [schemataData, setSchemataData] = useState(null);
  const [studySessions, setStudySessions] = useState([]);
  const [activeStudySession, setActiveStudySession] = useState(null);
  const [studyElapsedSeconds, setStudyElapsedSeconds] = useState(0);
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const session = readStoredSession();
  const [accountProfile, setAccountProfile] = useState(null);
  const [photoFailed, setPhotoFailed] = useState(false);
  const profilePhoto = accountProfile?.profilePhoto || "";
  const displayName = readDisplayName(accountProfile || session);
  const firstName = String(displayName).trim().split(/\s+/)[0] || "Profile";
  const username = readHandle(session);
  const profileInitials = getInitials(displayName);
  const accountToken = session?.token || "";

  useEffect(() => {
    const controller = new AbortController();
    setAccountProfile(null);
    if (!accountToken) return () => controller.abort();
    fetch(apiUrl("/api/user/me"), {
      headers: { Authorization: `Bearer ${accountToken}` },
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error("Unable to load account profile.");
        return response.json();
      })
      .then((profile) => {
        if (!controller.signal.aborted) setAccountProfile(profile);
      })
      .catch((error) => {
        if (error.name !== "AbortError") console.error("Failed to load account profile", error);
      });
    return () => controller.abort();
  }, [accountToken]);

  useEffect(() => { setPhotoFailed(false); }, [profilePhoto]);

  const currentDateLabel = new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(currentTime);
  const currentDayName = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
  }).format(currentTime);
  const currentTimeLabel = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(currentTime);
  const currentHour = currentTime.getHours();
  const greeting = currentHour < 12 ? "Good morning" : currentHour < 18 ? "Good afternoon" : "Good evening";
  const greetingText = `${greeting}, ${displayName.split(" ")[0]}.`;
  const [typedGreeting, setTypedGreeting] = useState("");

  const openAssistantFromLogo = async () => {
    if (assistantOpening || assistantOpen) return;
    setAssistantOpening(true);
    const didAppear = await assistantLogoRef.current?.playAppear();
    if (didAppear !== false) setAssistantOpen(true);
    setAssistantOpening(false);
  };

  useEffect(() => {
    setTypedGreeting("");
    let characterIndex = 0;
    const timer = window.setInterval(() => {
      characterIndex += 1;
      setTypedGreeting(greetingText.slice(0, characterIndex));
      if (characterIndex >= greetingText.length) window.clearInterval(timer);
    }, 58);

    return () => window.clearInterval(timer);
  }, [greetingText]);

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
    };

    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setProfileMenuOpen(false);
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
      {colorWaveEnabled && <HomeColorWave />}
      <div id="app_home_left">
      <>
      <div id="app_dashboard_header_row">
              <div className="app_dashboard_header">
               
                <div id="app_dashboard_header_profile_menu" ref={profileMenuRef}>
                  <button
                    id="app_dashboard_header_profile_trigger"
                    onClick={() => setProfileMenuOpen((open) => !open)}
                    aria-haspopup="menu"
                    aria-expanded={profileMenuOpen}
                    title={displayName}
                  >
                    {profilePhoto && !photoFailed ? <img
                      className="app_dashboard_header_profile"
                      src={profilePhoto}
                      alt={`${displayName} profile`}
                      onError={() => setPhotoFailed(true)}
                    /> : <span className="app_dashboard_header_initials" aria-label={`${displayName} profile`}>
                      {profileInitials}
                    </span>}
                  </button>

                  {profileMenuOpen && (
                    <div id="app_profile_dropdown" role="menu" aria-label="Profile menu">
                      <div id="app_profile_summary">
                        <div id="app_profile_summary_name">{displayName}</div>
                        {username && <div id="app_profile_summary_handle">@{username}</div>}
                      </div>

                      <button className="app_profile_dropdown_item" role="menuitem" onClick={() => { setProfileMenuOpen(false); navigate("/settings?section=personal"); }}>
                        <i className="fi fi-rr-user" />
                        <span>Personal information</span>
                      </button>
                      <button className="app_profile_dropdown_item" role="menuitem" onClick={() => { setProfileMenuOpen(false); navigate("/settings"); }}>
                        <i className="fi fi-rr-settings" />
                        <span>Settings</span>
                      </button>
                      <button className="app_profile_dropdown_item app_profile_dropdown_item--danger" role="menuitem" onClick={() => { setProfileMenuOpen(false); onLogout(); }}>
                        <i className="fi fi-rr-sign-out-alt" />
                        <span>Logout</span>
                      </button>
                    </div>
                  )}
                </div>
                <div id="app_dashboard_header_greeting">
                    <span
                      key={`greeting-caret-${currentTime.getSeconds()}`}
                      className="app_dashboard_header_greeting_text"
                    >{typedGreeting}</span>
                    <p className="app_dashboard_header_datetime">
                      <span>It is {currentDayName}, {currentDateLabel}</span>
                      <span>at {currentTimeLabel}</span>
                    </p>
                </div>
              </div>
      </div>
      {(() => {
        const allCards = LEVELS.flatMap((level) => level.cards);
        const onticCards = allCards.filter((card) => ONTIC_TOOL_PATHS.includes(card.path));
        const noeticCards = allCards.filter((card) => NOETIC_TOOL_PATHS.includes(card.path));
        const metaCards = allCards.filter((card) => !ONTIC_TOOL_PATHS.includes(card.path) && !NOETIC_TOOL_PATHS.includes(card.path));
        const renderCard = (card) => (
          <button
            key={card.path}
            className="app_home_card"
            role="menuitem"
            style={{ "--nav-color": card.color }}
            onClick={() => {
              navigate(card.path);
            }}
          >
            <i className={`fi ${card.icon} app_home_card_icon`} />
            <span className="app_home_card_copy">
              <span className="app_home_card_label">{card.label.replace(/\bRabbitHole\b/g, firstName)}</span>
              <span className="app_home_card_desc">{card.description}</span>
            </span>
          </button>
        );
        return (
          <div id="app_study_tools_buttons" role="menu" aria-label="RabbitHole Tools">
            {onticCards.length > 0 && <div className="app_study_tools_group"><div className="app_study_tools_group_label">Ontic Wonderland</div>{onticCards.map(renderCard)}</div>}
            {noeticCards.length > 0 && <div className="app_study_tools_group"><div className="app_study_tools_group_label">Noetic Wonderland</div>{noeticCards.map(renderCard)}</div>}
            {metaCards.length > 0 && <div className="app_study_tools_group"><div className="app_study_tools_group_label">Meta</div>{metaCards.map(renderCard)}</div>}
          </div>
        );
      })()}
      </>
      </div>
      {assistantOpen && (
        <HomeChat embedded initiallyOpen onClose={() => setAssistantOpen(false)} />
      )}
      {!assistantOpen && (
        <div
          className="app_home_center_logo"
          role="button"
          tabIndex={0}
          aria-label="Open Rabbit Assistant"
          aria-busy={assistantOpening}
          onClick={openAssistantFromLogo}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              void openAssistantFromLogo();
            }
          }}
        >
          <RabbitLogoBlink ref={assistantLogoRef} clickToAppear className="app_home_center_logo_image" alt="" />
        </div>
      )}
      <div id="app_home_middle">
      </div>

    </div>
  );
};

export default App;
