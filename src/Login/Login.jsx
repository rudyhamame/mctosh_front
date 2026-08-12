import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./login.css";
import { apiUrl } from "../config/api";
import { writeStoredSession } from "../utils/sessionCleanup";
import OntologyScrollScene from "./ontology/OntologyScrollScene";
import VirtualKeyboard from "../Shared/VirtualKeyboard";
import {
  ONTOLOGY_DEBUG_ENABLED,
  ONTOLOGY_LEVELS,
  ONTOLOGY_TRANSITION_COUNT,
} from "./ontology/ontologyLevels";
import {
  ONTOLOGY_SUBJECT_SWAP_PROGRESS,
  clamp,
  getOntologyVisualState,
} from "./ontology/ontologyTimeline";

export default function Login({ onLogin }) {
  const navigate = useNavigate();
  const journeyRef = useRef(null);
  const ontologySceneRef = useRef(null);
  const videoRef = useRef(null);
  const [activeStage, setActiveStage] = useState(0);
  const [loginOpen, setLoginOpen] = useState(false);
  const [videoPaused, setVideoPaused] = useState(true);
  const [videoVisible, setVideoVisible] = useState(false);
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let frameRequest = 0;
    let lastStage = -1;

    const updateJourney = () => {
      const journey = journeyRef.current;
      if (!journey) return;

      const viewportHeight = Math.max(1, window.innerHeight);
      journey.style.setProperty("--ontology-viewport-height", `${viewportHeight}px`);
      const rect = journey.getBoundingClientRect();
      const scrollDistance = clamp(
        -rect.top,
        0,
        viewportHeight * ONTOLOGY_TRANSITION_COUNT,
      );
      const viewportProgress = scrollDistance / viewportHeight;
      const visualState = getOntologyVisualState(viewportProgress);
      const nextActiveStage = visualState.localProgress >= ONTOLOGY_SUBJECT_SWAP_PROGRESS
        ? visualState.toIndex
        : visualState.fromIndex;

      journey.style.setProperty(
        "--journey-progress",
        String(viewportProgress / ONTOLOGY_TRANSITION_COUNT),
      );
      ontologySceneRef.current?.setVisualState(visualState);
      if (nextActiveStage !== lastStage) {
        lastStage = nextActiveStage;
        setActiveStage(nextActiveStage);
      }

    };

    const queuePaint = () => {
      if (frameRequest) return;
      frameRequest = window.requestAnimationFrame(() => {
        frameRequest = 0;
        updateJourney();
      });
    };

    updateJourney();
    const scrollContainer = journeyRef.current?.closest("#app_route_view");
    const scrollTarget = scrollContainer || window;
    scrollTarget.addEventListener("scroll", queuePaint, { passive: true });
    window.addEventListener("resize", queuePaint);
    return () => {
      scrollTarget.removeEventListener("scroll", queuePaint);
      window.removeEventListener("resize", queuePaint);
      window.cancelAnimationFrame(frameRequest);
    };
  }, []);

  useEffect(() => {
    if (!loginOpen) return undefined;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setLoginOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [loginOpen]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    const endpoint = mode === "signup" ? "/api/user/signup" : "/api/user/login";
    const body = mode === "signup" ? { username, password, name } : { username, password };

    try {
      const response = await fetch(apiUrl(endpoint), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data?.error?.message || "Something went wrong.");
        return;
      }
      writeStoredSession(data);
      onLogin(data);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const toggleMode = () => {
    setMode((current) => (current === "login" ? "signup" : "login"));
    setError("");
  };

  const toggleVideo = () => {
    if (videoVisible && videoRef.current && !videoRef.current.paused) {
      videoRef.current.pause();
      setVideoPaused(true);
    }
    setVideoVisible((current) => !current);
  };

  const toggleVideoPlayback = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play();
      setVideoPaused(false);
    } else {
      video.pause();
      setVideoPaused(true);
    }
  };

  const currentStage = ONTOLOGY_LEVELS[activeStage];
  const currentStageNumber = String(activeStage).padStart(2, "0");

  return (
    <div id="login_page" className="loginPage loginJourney" ref={journeyRef}>
      <div className="patientRealitySticky">
        <OntologyScrollScene ref={ontologySceneRef} />
        <div className="patientRealityJourneyShade" aria-hidden="true" />

        <header className="patientRealityJourneyBrand">
          <span className="patientRealityBrandMark" aria-hidden="true">M</span>
          <div>
            <h1>AMCTOSHS</h1>
            <p>Patient Reality</p>
          </div>
        </header>

        <button type="button" className="patientRealitySignIn" onClick={() => setLoginOpen(true)}>
          Sign in
        </button>

        <div className="stageIdentity">
          <div className="stageIdentityLabel" key={currentStage.id} aria-live="polite">
            <span className="stageNumber">{currentStageNumber}</span>
            <h2>{currentStage.label}</h2>
          </div>
        </div>

        <div className="patientRealityProgress" aria-hidden="true">
          <span style={{ "--stage-progress": activeStage / ONTOLOGY_TRANSITION_COUNT }} />
          <small>{currentStageNumber} / 02</small>
        </div>

        {loginOpen && (
          <div className="loginOverlay" role="presentation" onPointerDown={(event) => {
            if (event.target === event.currentTarget) setLoginOpen(false);
          }}>
            <main id="login_panel" className="loginArea" aria-label="AMCTOSHS sign in">
              <div className="loginCard">
                <button type="button" className="loginCardClose" aria-label="Close sign in" onClick={() => setLoginOpen(false)}>
                  <i className="fi fi-rr-cross-small" />
                </button>

                <div id="login_role_tabs" role="tablist" aria-label="Log in as">
                  <button type="button" role="tab" aria-selected="true" className="login_role_tab login_role_tab--active">Clinician</button>
                  <button type="button" role="tab" aria-selected="false" className="login_role_tab" onClick={() => navigate("/patient/login")}>Patient</button>
                </div>

                <button id="login_video_toggle" type="button" onClick={toggleVideo}>
                  <i className={`fi ${videoVisible ? "fi-rr-cross-small" : "fi-rr-play-alt"}`} />
                  {videoVisible ? "Hide intro" : "Watch intro"}
                </button>

                {videoVisible && (
                  <div id="login_video_container">
                    <video
                      id="login_intro_video"
                      ref={videoRef}
                      src="https://res.cloudinary.com/dtoxkii3q/video/upload/v1782581889/sample1/user-images/6a237f080175aacbdb3962ff/copy_dbc85ec1-1520-4cba-af16-b27eb6de8979.mp4"
                      loop
                      playsInline
                    />
                    <button id="login_video_btn" type="button" aria-label={videoPaused ? "Play" : "Pause"} onClick={toggleVideoPlayback}>
                      {videoPaused ? (
                        <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21" /></svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="3" width="4" height="18" /><rect x="15" y="3" width="4" height="18" /></svg>
                      )}
                    </button>
                  </div>
                )}

                <form id="login_form" onSubmit={handleSubmit}>
                  <div id="login_form_head"><div id="login_form_bar" /><span id="login_form_title">{mode === "login" ? "Access system" : "Create account"}</span></div>

                  {mode === "login" && (
                    <div id="login_demo_note"><span>To try my app you can use the credentials:</span><strong>username: test</strong><strong>password: test123</strong></div>
                  )}

                  {mode === "signup" && (
                    <div className="login_field">
                      <label className="login_field_label" htmlFor="lf_name">Display name</label>
                      <input id="lf_name" type="text" placeholder="Your name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" />
                    </div>
                  )}

                  <div className="login_field">
                    <label className="login_field_label" htmlFor="lf_user">Username</label>
                    <input id="lf_user" type="text" placeholder="Enter username" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} required />
                  </div>

                  <div className="login_field">
                    <label className="login_field_label" htmlFor="lf_pass">Password</label>
                    <input id="lf_pass" type="password" placeholder="Enter password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "signup" ? "new-password" : "current-password"} autoCapitalize="none" autoCorrect="off" spellCheck={false} required />
                  </div>

                  {error && <p id="login_error" role="alert">{error}</p>}
                  <button type="submit" id="login_submit" disabled={loading}>{loading ? "Authenticating…" : mode === "signup" ? "Create account" : "Enter AMCTOSHS"}</button>
                  <button type="button" id="login_toggle" onClick={toggleMode}>{mode === "signup" ? "Already have an account? Sign in" : "No account? Sign up"}</button>
                  <div id="login_links">
                    <button type="button" className="login_link" onClick={() => navigate("/about")}>About</button>
                    <span className="login_link_sep">·</span>
                    <button type="button" className="login_link" onClick={() => navigate("/portfolio")}>Portfolio</button>
                  </div>
                </form>

                <footer id="login_footer"><span>AMCTOSHS · From representation to reality</span><span>© {new Date().getFullYear()} Rudy Hamame</span></footer>
              </div>
            </main>
            <VirtualKeyboard
              autoOpenOnFocus
              showToggle={false}
              panelClassName="vk_panel--login"
            />
          </div>
        )}
      </div>

      <div className="patientRealityStages" aria-hidden="true">
        {ONTOLOGY_LEVELS.map((stage, index) => (
          <section
            className="patientRealityScrollStage"
            key={stage.id}
            data-stage={index}
          >
            {ONTOLOGY_DEBUG_ENABLED && (
              <div className="ontologyDebugMarker">
                <span>{index * 100}vh {stage.label}</span>
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
