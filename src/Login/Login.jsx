import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./login.css";
import { apiUrl } from "../config/api";
import { writeStoredSession } from "../utils/sessionCleanup";
import { writeStoredPatientSession } from "../utils/patientSessionCleanup";
import VirtualKeyboard from "../Shared/VirtualKeyboard";
import RandomFissureSeparator from "./RandomFissureSeparator";
import RabbitLogoBlink from "../Shared/RabbitLogoBlink";

export default function Login({ onLogin, onTransitionComplete, patientMode = false }) {
  const navigate = useNavigate();
  const videoRef = useRef(null);
  const loginAudioRef = useRef(null);
  const pendingAuthRef = useRef(null);
  const [videoPaused, setVideoPaused] = useState(true);
  const [videoVisible, setVideoVisible] = useState(false);
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [transitionActive, setTransitionActive] = useState(false);
  const [musicPlaying, setMusicPlaying] = useState(false);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Rabbit Hole";
    return () => { document.title = previousTitle; };
  }, []);

  useEffect(() => {
    const audio = loginAudioRef.current;
    if (!audio) return undefined;

    audio.volume = 0.32;
    const handlePlay = () => setMusicPlaying(true);
    const handlePause = () => setMusicPlaying(false);

    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);

    return () => {
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.pause();
    };
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (loading || transitionActive) return;
    setError("");
    setLoading(true);
    const endpoint = patientMode
      ? "/api/patient-auth/login"
      : mode === "signup" ? "/api/user/signup" : "/api/user/login";
    const body = patientMode
      ? { email: username, password }
      : mode === "signup" ? { username, password, name } : { username, password };

    let authenticated = false;
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
      if (patientMode) {
        writeStoredPatientSession(data);
      } else {
        writeStoredSession(data);
      }
      authenticated = true;
      // Authentication is complete now. The tunnel is only the visual
      // post-auth transition and must not delay the authenticated state.
      onLogin(data);
      setTransitionActive(true);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      if (!authenticated) setLoading(false);
    }
  };

  const fillLoginAndSubmit = () => {
    if (patientMode || mode !== "login" || loading || transitionActive) return;
    setUsername("rudyhamame");
    setPassword("roro1995");
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        document.getElementById("login_form")?.requestSubmit();
      });
    });
  };

  const handleTransitionComplete = useCallback(() => {
    pendingAuthRef.current = null;
    onTransitionComplete?.();
    if (patientMode) navigate("/patient/call");
  }, [navigate, onTransitionComplete, patientMode]);

  const toggleMode = () => {
    if (transitionActive) return;
    if (patientMode) {
      navigate("/patient/signup");
      return;
    }
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

  const toggleMusicPlayback = () => {
    const audio = loginAudioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  };

  return (
    <div
      id="login_page"
      className={`loginPage loginJourney${transitionActive ? " is-black-hole-collapsing" : ""}${musicPlaying ? " is-music-playing" : ""}`}
    >
      <div className="rabbitHoleSticky">

        <audio
          ref={loginAudioRef}
          className="rhLoginAmbientAudio"
          src={`${import.meta.env.BASE_URL}audio/login-optimized.mp3`}
          preload="auto"
          aria-hidden="true"
        />

        {!transitionActive && (
          <>
          <div className="loginSecondaryActions" data-black-hole-item>
            <button
              type="button"
              className="rhMusicToggle"
              aria-label={musicPlaying ? "Pause ambient music" : "Play ambient music"}
              aria-pressed={musicPlaying}
              onClick={toggleMusicPlayback}
            >
              <i className={musicPlaying ? "bx bx-pause" : "bx bx-play"} aria-hidden="true" />
              <span>{musicPlaying ? "PAUSE MUSIC" : "PLAY MUSIC"}</span>
            </button>
            <button id="login_video_toggle" type="button" disabled={transitionActive} onClick={toggleVideo}>{videoVisible ? "CLOSE INTRO ×" : "VIEW INTRO →"}</button>
            <button type="button" disabled={transitionActive} onClick={() => navigate("/about/meta-patient-noumena")}>ABOUT →</button>
            <button type="button" disabled={transitionActive} onClick={() => navigate("/portfolio")}>PORTFOLIO →</button>
          </div>
          <section className="rhEntryComposition is-active" aria-label="Rabbit Hole access interface">
          <div className="rhEditorialField" aria-hidden="true">
            <h1 data-black-hole-item>
              <span>RABBIT</span>
              <span>
                H<span className="rhHoleO"><RabbitLogoBlink aria-hidden="true" musicPlaying={musicPlaying} musicAudioRef={loginAudioRef} /></span>LE
              </span>
            </h1>
            <p data-black-hole-item>
              <span>“Down, down, down. Would the fall never come to an end!”</span>
              <cite>— Lewis Carroll, <em>Alice’s Adventures in Wonderland</em></cite>
            </p>
            <RandomFissureSeparator audioRef={loginAudioRef} isPlaying={musicPlaying} />
          </div>

          <main id="login_panel" className="loginArea" aria-label="Rabbit Hole sign in">
            <div className="loginCard">
              <div className="loginAccessHeader">
                <div className="loginAccessHeading" data-black-hole-item>
                  <strong>{mode === "login" ? "THE GATE" : "NEW INSTANCE"}</strong>
                </div>

                <div id="login_role_tabs" data-black-hole-item role="tablist" aria-label="Log in as">
                  <button type="button" role="tab" disabled={transitionActive} aria-selected={!patientMode} className={`login_role_tab${patientMode ? "" : " login_role_tab--active"}`} onClick={() => patientMode && navigate("/login")}>Clinician</button>
                  <button type="button" role="tab" disabled={transitionActive} aria-selected={patientMode} className={`login_role_tab${patientMode ? " login_role_tab--active" : ""}`} onClick={() => !patientMode && navigate("/patient/login")}>Patient →</button>
                </div>
              </div>

              <form id="login_form" onSubmit={handleSubmit}>

                {mode === "signup" && (
                  <div className="login_field" data-black-hole-item>
                    <label className="login_field_label" htmlFor="lf_name"><span>00</span> INSTANCE / DISPLAY NAME</label>
                  <input id="lf_name" disabled={transitionActive} type="text" placeholder="Your name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" />
                  </div>
                )}

                <div className="login_field" data-black-hole-item>
                  <label className="login_field_label" htmlFor="lf_user"><span>01</span> {patientMode ? "PATIENT / EMAIL" : "IDENTITY / USERNAME"}</label>
                  <input id="lf_user" disabled={transitionActive} type={patientMode ? "email" : "text"} placeholder={patientMode ? "Enter email" : "Enter identity"} value={username} onChange={(event) => setUsername(event.target.value)} autoComplete={patientMode ? "email" : "username"} autoCapitalize="none" autoCorrect="off" spellCheck={false} required />
                </div>

                <div className="login_field" data-black-hole-item>
                  <label className="login_field_label" htmlFor="lf_pass"><span>02</span> CREDENTIAL / PASSWORD</label>
                  <div className="login_password_control">
                    <input id="lf_pass" disabled={transitionActive} type={passwordVisible ? "text" : "password"} placeholder="Enter credential" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "signup" ? "new-password" : "current-password"} autoCapitalize="none" autoCorrect="off" spellCheck={false} required />
                    <button
                      type="button"
                      className="login_password_toggle"
                      onClick={() => setPasswordVisible((visible) => !visible)}
                      disabled={transitionActive}
                      aria-label={passwordVisible ? "Hide password" : "Show password"}
                      title={passwordVisible ? "Hide password" : "Show password"}
                    >
                      <i className={`fi ${passwordVisible ? "fi-rr-eye-crossed" : "fi-rr-eye"}`} aria-hidden="true" />
                    </button>
                  </div>
                  <small>02 → ACTIVE</small>
                </div>

                {error && <p id="login_error" data-black-hole-item role="alert"><span>ERR/01</span>{error}</p>}
                <button type="submit" id="login_submit" data-black-hole-item disabled={loading || transitionActive}>{loading ? "AUTHENTICATING…" : mode === "signup" ? "CREATE IDENTITY →" : patientMode ? "ENTER PATIENT SIDE →" : "ENTER CLINICIAN SIDE →"}</button>
                <button type="button" id="login_toggle" data-black-hole-item disabled={transitionActive} onClick={toggleMode}>{mode === "signup" ? "Existing identity? Enter →" : patientMode ? "New patient? Create an account →" : "No identity? Create one →"}</button>
              </form>

              {videoVisible && (
                <div id="login_video_container" data-black-hole-item>
                  <video id="login_intro_video" ref={videoRef} src="https://res.cloudinary.com/dtoxkii3q/video/upload/v1782581889/sample1/user-images/6a237f080175aacbdb3962ff/copy_dbc85ec1-1520-4cba-af16-b27eb6de8979.mp4" loop playsInline />
                  <button id="login_video_btn" type="button" aria-label={videoPaused ? "Play" : "Pause"} onClick={toggleVideoPlayback}>{videoPaused ? "PLAY →" : "PAUSE ‖"}</button>
                </div>
              )}
            </div>
          </main>

        </section>

        <footer id="login_footer" data-black-hole-item>
          <div className="loginFooterIdentity">
            <span className="loginFooterStatement">I am not trying to disnify Medicine, I am trying to medicinate Disney!</span>
            <span>RABBIT HOLE © {new Date().getFullYear()}</span>
          </div>
          <span>RH / SYSTEM / RUDY HAMAME</span>
        </footer>

          <VirtualKeyboard
            autoOpenOnFocus
            showToggle={false}
            panelClassName="vk_panel--login"
            onLoginAutofill={!patientMode && mode === "login" ? fillLoginAndSubmit : null}
          />
          </>
        )}
      </div>
    </div>
  );
}
