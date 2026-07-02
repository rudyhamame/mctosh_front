import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./login.css";
import { apiUrl } from "../config/api";
import { writeStoredSession } from "../utils/sessionCleanup";

const STAGE = 980;

const MCTOSHS_ORBITS = [
  { id: "m",  letter: "M", r:  48, color: "#00e5ff", dur: "8s",  dir: "cw",  delay: "0s"   },
  { id: "c",  letter: "C", r:  82, color: "#4da6ff", dur: "14s", dir: "ccw", delay: "-4s"  },
  { id: "t",  letter: "T", r: 116, color: "#a678f5", dur: "20s", dir: "cw",  delay: "-8s"  },
  { id: "o",  letter: "O", r: 150, color: "#ffab40", dur: "27s", dir: "ccw", delay: "-12s" },
  { id: "s1", letter: "S", r: 182, color: "#5cf5a0", dur: "35s", dir: "cw",  delay: "-18s" },
  { id: "h",  letter: "H", r: 214, color: "#ff7aa2", dur: "45s", dir: "ccw", delay: "-22s" },
  { id: "s2", letter: "S", r: 244, color: "#ffd54f", dur: "54s", dir: "cw",  delay: "-28s" },
];

export default function Login({ onLogin }) {
  const navigate     = useNavigate();
  const wrapRef      = useRef(null);
  const baseScaleRef = useRef(1);   // fit-to-container scale from ResizeObserver
  const pinchRef     = useRef({ active: false, startDist: 0, startZoom: 1 });
  const zoomRef      = useRef(1);   // user pinch multiplier

  const [mode,       setMode]       = useState("login");
  const [username,   setUsername]   = useState("");
  const [password,   setPassword]   = useState("");
  const [name,       setName]       = useState("");
  const [error,      setError]      = useState("");
  const [loading,    setLoading]    = useState(false);
  const [stageScale, setStageScale] = useState(1);

  // Fit stage to container
  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      baseScaleRef.current = Math.min(width, height) / STAGE;
      setStageScale(baseScaleRef.current * zoomRef.current);
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  // Pinch-zoom on animation wrap only
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    const touchDist = (touches) => {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };

    const onStart = (e) => {
      if (e.touches.length === 2) {
        pinchRef.current = {
          active:    true,
          startDist: touchDist(e.touches),
          startZoom: zoomRef.current,
        };
      }
    };

    const onMove = (e) => {
      if (e.touches.length === 2 && pinchRef.current.active) {
        e.preventDefault();
        const ratio   = touchDist(e.touches) / pinchRef.current.startDist;
        const newZoom = Math.max(0.4, Math.min(3, pinchRef.current.startZoom * ratio));
        zoomRef.current = newZoom;
        setStageScale(baseScaleRef.current * newZoom);
      }
    };

    const onEnd = () => { pinchRef.current.active = false; };

    wrap.addEventListener("touchstart", onStart, { passive: true });
    wrap.addEventListener("touchmove",  onMove,  { passive: false });
    wrap.addEventListener("touchend",   onEnd,   { passive: true });

    return () => {
      wrap.removeEventListener("touchstart", onStart);
      wrap.removeEventListener("touchmove",  onMove);
      wrap.removeEventListener("touchend",   onEnd);
    };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const endpoint = mode === "signup" ? "/api/user/signup" : "/api/user/login";
    const body     = mode === "signup" ? { username, password, name } : { username, password };
    try {
      const res  = await fetch(apiUrl(endpoint), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setError(data?.error?.message || "Something went wrong."); return; }
      writeStoredSession(data);
      onLogin(data);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const toggle = () => { setMode(m => m === "login" ? "signup" : "login"); setError(""); };

  return (
    <div id="login_page">

      {/* ── LEFT: 2D Orbital Animation ── */}
      <div id="login_anim_panel">
        <div id="login_brand">
          <div id="login_sigil"><span>M</span></div>
          <div id="login_brand_text">
            <h1 id="login_wordmark">MCTOSHS</h1>
            <p id="login_platform_label">Clinical Intelligence Platform</p>
          </div>
        </div>

        <div id="login_stage_wrap" ref={wrapRef}>
          <div id="login_stage" style={{ transform: `scale(${stageScale})` }}>

            {/* Spheres */}
            <div id="login_center">
              <div id="login_center_glow" />
              <div id="pr_sphere">
                <div id="pr_spec_a" />
                <div id="pr_spec_b" />
                <div id="pr_rim" />
                <div id="mctosh_sphere">
                  <div id="ms_rim" />
                  <div id="ms_void" />
                  <div id="ms_m_ring" />
                </div>
              </div>
            </div>

            {/* MCTOSHS label — outside the MCTOSHS sphere */}
            <div id="ms_label_wrap">
              <span id="ms_label_name">MCTOSHS</span>
            </div>

            {/* Patient Reality label — outside the PR sphere */}
            <div id="pr_label_wrap">
              <span id="pr_name">Patient Reality</span>
            </div>

            {/* Soft orbit path rings */}
            {MCTOSHS_ORBITS.map(orb => (
              <div
                key={`ring-${orb.id}`}
                className="orb_ring"
                style={{
                  "--orb-color": orb.color,
                  width:      `${orb.r * 2}px`,
                  height:     `${orb.r * 2}px`,
                  marginTop:  `-${orb.r}px`,
                  marginLeft: `-${orb.r}px`,
                }}
              />
            ))}

            {/* Orbiting letter dots */}
            {MCTOSHS_ORBITS.map(orb => (
              <div
                key={orb.id}
                className="bio_particle"
                style={{
                  "--r":         `${orb.r}px`,
                  "--dur":       orb.dur,
                  "--delay":     orb.delay,
                  "--orb-color": orb.color,
                  animationName: `orbit_${orb.dir}`,
                }}
              >
                <div className="orb_dot">
                  <span
                    className="orb_dot_letter"
                    style={{
                      animationName:            `counter_${orb.dir}`,
                      animationDuration:        orb.dur,
                      animationDelay:           orb.delay,
                      animationTimingFunction:  "linear",
                      animationIterationCount:  "infinite",
                      animationFillMode:        "both",
                    }}
                  >
                    {orb.letter}
                  </span>
                </div>
              </div>
            ))}

          </div>
        </div>

        <p id="login_tagline">&ldquo;From representation to reality&rdquo;</p>
      </div>

      {/* ── RIGHT: Form Panel ── */}
      <div id="login_panel">
        <form id="login_form" onSubmit={handleSubmit}>

          <div id="login_form_head">
            <div id="login_form_bar" />
            <span id="login_form_title">
              {mode === "login" ? "Access system" : "Create account"}
            </span>
          </div>

          {mode === "signup" && (
            <div className="login_field">
              <label className="login_field_label" htmlFor="lf_name">Display name</label>
              <input
                id="lf_name" type="text" placeholder="Your name"
                value={name} onChange={e => setName(e.target.value)}
                autoComplete="name"
              />
            </div>
          )}

          <div className="login_field">
            <label className="login_field_label" htmlFor="lf_user">Username</label>
            <input
              id="lf_user" type="text" placeholder="Enter username"
              value={username} onChange={e => setUsername(e.target.value)}
              autoComplete="username" autoCapitalize="none"
              autoCorrect="off" spellCheck={false} required
            />
          </div>

          <div className="login_field">
            <label className="login_field_label" htmlFor="lf_pass">Password</label>
            <input
              id="lf_pass" type="password" placeholder="Enter password"
              value={password} onChange={e => setPassword(e.target.value)}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              autoCapitalize="none" autoCorrect="off" spellCheck={false} required
            />
          </div>

          {error && <p id="login_error" role="alert">{error}</p>}

          <button type="submit" id="login_submit" disabled={loading}>
            {loading ? "Authenticating…" : mode === "signup" ? "Create account" : "Enter MCTOSHS"}
          </button>

          <button type="button" id="login_toggle" onClick={toggle}>
            {mode === "signup"
              ? "Already have an account? Sign in"
              : "No account? Sign up"}
          </button>

          <div id="login_links">
            <button type="button" className="login_link" onClick={() => navigate("/about")}>About</button>
            <span className="login_link_sep">·</span>
            <button type="button" className="login_link" onClick={() => navigate("/portfolio")}>Portfolio</button>
          </div>

        </form>

        <footer id="login_footer">
          <span>MCTOSHS &middot; From representation to reality</span>
          <span>&copy; {new Date().getFullYear()} Rudy Hamame</span>
        </footer>
      </div>

    </div>
  );
}
