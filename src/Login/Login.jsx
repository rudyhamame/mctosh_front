import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./login.css";
import { apiUrl } from "../config/api";
import { writeStoredSession } from "../utils/sessionCleanup";

const STAGE = 980;

// Patient Reality "thread" — Z depths (px) for each cross-section ring making
// up the rope-like tube. Centered on 0 so the ring at index (RINGS-1)/2 sits
// exactly at the surface, matching today's flat circle when unrotated.
const PR_THREAD_RINGS = Array.from({ length: 28 }, (_, i) => (i - 13.5) * 24);

const MCTOSHS_ORBITS = [
  { id: "m",  letter: "M",  r: 244, color: "#00e5ff", dur: "8s",   dir: "cw", delay: "0s" },
  { id: "c",  letter: "C",  r: 214, color: "#4da6ff", dur: "16s",  dir: "cw", delay: "0s" },
  { id: "t",  letter: "T",  r: 182, color: "#a678f5", dur: "32s",  dir: "cw", delay: "0s" },
  { id: "o",  letter: "O",  r: 150, color: "#ffab40", dur: "64s",  dir: "cw", delay: "0s" },
  { id: "s1", letter: "OS", r: 116, color: "#5cf5a0", dur: "128s", dir: "cw", delay: "0s" },
  { id: "h",  letter: "H",  r:  82, color: "#ff7aa2", dur: "256s", dir: "cw", delay: "0s" },
  { id: "s2", letter: "S",  r:  48, color: "#ffd54f", dur: "512s", dir: "cw", delay: "0s" },
];

// ── Homeostasis zones (angles: 0 = 12 o'clock, CW positive) ──────────────
const PHYSIO_LIMIT  = Math.PI / 2;
const DEATH_THRESH  = Math.PI * 0.95;
// Rope gap between adjacent engaged orbits (short rope = tight CCW coupling)
const ROPE_GAP = 0.10; // radians each orbit trails behind its outer neighbour

// ── Worldline temporal factors — T, O, OS, H, S ───────────────────────────
// Each factor encodes how quickly that MCTOSH dimension registers a disease
// state change, mirroring the biological lag in Atherosclerosis:
//   T  (Traces / biomarkers)  → fastest:  CRP, LDL, troponin rise early
//   O  (Objects / structure)  → moderate: plaque remodelling takes longer
//   OS (Observable Signs)     → slow:     symptoms lag structural change
//   H  (Hylomorphic state)    → slower:   syndrome integration lags signs
//   S  (Social/systemic)      → slowest:  systemic burden accumulates last
const CASCADE_K_FACTORS   = [1.00, 0.58, 0.32, 0.17, 0.09]; // spring scale per orbit
const CASCADE_DMP_FACTORS = [1.00, 0.90, 0.80, 0.71, 0.63]; // damping scale per orbit
// When a dimension is *engaged* by disease it moves CW — these are its CW targets
// as a fraction of M's angle, decreasing inward (T most exposed → S most insulated).
const ENGAGE_CW_SCALE = [0.78, 0.62, 0.47, 0.33, 0.21]; // T, O, OS, H, S

const PHYS_DEFAULTS = {
  compResilience: 0.60,
  kSp:            2.0,   // base spring constant — T orbit uses this directly
  dmpOrb:         1.40,  // base damping — T orbit uses this directly
  pressureCoeff:  1.4,
  breakdownForce: 1.8,
  extraDepth:     0.22,
  cMirrorRatio:   0.58,
};

// Atherosclerosis disease timeline — right-half arc from t₀ (12 o'clock) to t_end (6 o'clock).
// Each stage maps a temporal moment to its MCTOSH dimensional state + physics config.
const CARDIAC_ANNOTATIONS = [
  {
    d: 0.00,  abbr: "t₀",   desc: "Endothelial Normalcy",
    color: "rgba(0,220,110,0.85)",
    note: "M at 12 o'clock — all MCTOSHS dimensions in full homeostasis · Coronary endothelium intact · No disease signal",
    engaged: ["M"],
    config: { compResilience: 0.90, kSp: 2.8, dmpOrb: 1.50, pressureCoeff: 0.50, breakdownForce: 0.40, extraDepth: 0.08, cMirrorRatio: 0.40 },
  },
  {
    d: 0.038, abbr: "EDF",  desc: "Endothelial Dysfunction",
    color: "rgba(70,210,55,0.78)",
    note: "M begins CW drift · C activates — NO synthesis, antioxidant response · T: oxidised LDL enters intima · Subclinical — silent disease initiation",
    engaged: ["M", "C"],
    config: { compResilience: 0.80, kSp: 2.5, dmpOrb: 1.45, pressureCoeff: 0.80, breakdownForce: 0.70, extraDepth: 0.12, cMirrorRatio: 0.46 },
  },
  {
    d: 0.075, abbr: "FSk",  desc: "Fatty Streak · Foam Cell Infiltration",
    color: "rgba(200,205,0,0.80)",
    note: "M in physiological zone, drifting · C compensates via HDL reverse transport · O: first morphological lesion · OS: no symptoms · Reversible stage",
    engaged: ["M", "C", "T"],
    config: { compResilience: 0.72, kSp: 2.2, dmpOrb: 1.42, pressureCoeff: 1.05, breakdownForce: 1.00, extraDepth: 0.16, cMirrorRatio: 0.50 },
  },
  {
    d: 0.115, abbr: "FPq",  desc: "Fibrous Plaque · Luminal Narrowing <50%",
    color: "rgba(255,162,0,0.82)",
    note: "M approaching PHYSIO_LIMIT · Cascade T→O→OS fully engaged · SMC proliferation, collagen deposition · Compensation stable but structurally committed",
    engaged: ["M", "C", "T", "O"],
    config: { compResilience: 0.62, kSp: 2.0, dmpOrb: 1.40, pressureCoeff: 1.30, breakdownForce: 1.40, extraDepth: 0.20, cMirrorRatio: 0.54 },
  },
  {
    d: 0.140, abbr: "StA",  desc: "Stable Angina · Stenosis >50%",
    color: "rgba(255,110,15,0.84)",
    note: "M crosses PHYSIO_LIMIT — deterioration zone entered · C near-maximum · OS: exertional chest pain · H integrates chronic ischaemic pattern",
    engaged: ["M", "C", "T", "O", "OS"],
    config: { compResilience: 0.52, kSp: 1.8, dmpOrb: 1.38, pressureCoeff: 1.60, breakdownForce: 1.80, extraDepth: 0.22, cMirrorRatio: 0.58 },
  },
  {
    d: 0.160, abbr: "VPq",  desc: "Vulnerable Plaque · Thin-Cap Fibroatheroma",
    color: "rgba(255,60,20,0.86)",
    note: "M deep in deterioration · C stretched to limit · T: CRP/IL-6 surge · O: cap <65μm, large necrotic core · OS: rest pain episodes · Critical — rupture imminent",
    engaged: ["M", "C", "T", "O", "OS", "H"],
    config: { compResilience: 0.38, kSp: 1.6, dmpOrb: 1.35, pressureCoeff: 2.10, breakdownForce: 2.30, extraDepth: 0.25, cMirrorRatio: 0.62 },
  },
  {
    d: 0.176, abbr: "PRp",  desc: "Plaque Rupture · Thrombosis · ACS",
    color: "rgba(255,22,12,0.89)",
    note: "M overwhelming cascade · T: troponin rise, ST changes · O: cap fracture, platelet aggregation · OS: acute chest pain, diaphoresis · H: ACS syndrome · S: emergency activation",
    engaged: ["M", "C", "T", "O", "OS", "H", "S"],
    config: { compResilience: 0.22, kSp: 1.4, dmpOrb: 1.30, pressureCoeff: 2.80, breakdownForce: 3.20, extraDepth: 0.28, cMirrorRatio: 0.67 },
  },
  {
    d: 0.188, abbr: "COc",  desc: "Complete Occlusion · STEMI",
    color: "rgba(228,4,4,0.92)",
    note: "M near t_end · All MCTOSHS dimensions at maximum depth · T: ST elevation, troponin peak · O: complete lumen occlusion · H: cardiogenic shock",
    engaged: ["M", "C", "T", "O", "OS", "H", "S"],
    config: { compResilience: 0.10, kSp: 1.2, dmpOrb: 1.25, pressureCoeff: 3.80, breakdownForce: 4.50, extraDepth: 0.32, cMirrorRatio: 0.72 },
  },
  {
    d: 0.20,  abbr: "t_end", desc: "Ventricular Fibrillation · Cardiac Arrest",
    color: "rgba(200,0,0,0.94)", anchor: "end",
    note: "M reaches 6 o'clock — system collapse · MCTOSHS cascade reaches π · C/T/O/OS/H/S all failed · Lethal arrhythmia from transmural ischaemia",
    engaged: ["M", "C", "T", "O", "OS", "H", "S"],
    config: { compResilience: 0.02, kSp: 1.0, dmpOrb: 1.20, pressureCoeff: 5.50, breakdownForce: 6.50, extraDepth: 0.36, cMirrorRatio: 0.78 },
  },
];

const DISEASES = [
  { id: "atherosclerosis", name: "Atherosclerosis", annotations: CARDIAC_ANNOTATIONS },
];

export default function Login({ onLogin }) {
  const navigate     = useNavigate();
  const wrapRef      = useRef(null);
  const videoRef     = useRef(null);
  const [videoPaused,  setVideoPaused]  = useState(true);
  const [videoVisible, setVideoVisible] = useState(false);
  const baseScaleRef = useRef(1);   // fit-to-container scale from ResizeObserver
  const pinchRef     = useRef({ active: false, startDist: 0, startZoom: 1 });
  const zoomRef      = useRef(1);   // user pinch multiplier

  // M-drag: true while user is dragging M directly on the stage
  const mDraggingRef  = useRef(false);
  // Disease intensity — read by RAF, written by slider
  const diseaseRef    = useRef(0);
  // Pan state — one-finger drag to navigate after zoom
  const panRef        = useRef({ active: false, startX: 0, startY: 0, panX: 0, panY: 0 });
  const [panXY,      setPanXY]      = useState({ x: 0, y: 0 });

  // Physics state — all start at 12 o'clock
  // smo: exponential moving average of each orbit's angle (used by inner orbits as rope target
  // so T,O,OS,H,S track C's slow trend rather than its fast oscillation)
  const orbStateRef = useRef(
    MCTOSHS_ORBITS.map(() => ({ angle: 0, omega: 0, smo: 0 }))
  );
  const dotElsRef      = useRef(new Array(MCTOSHS_ORBITS.length).fill(null));
  const ropeCanvasRef  = useRef(null);
  const stageDisplayRef = useRef(null);

  const [mode,         setMode]         = useState("login");
  const [username,     setUsername]     = useState("");
  const [password,     setPassword]     = useState("");
  const [name,         setName]         = useState("");
  const [error,        setError]        = useState("");
  const [loading,      setLoading]      = useState(false);
  const [stageScale,   setStageScale]   = useState(1);
  const [diseaseLevel, setDiseaseLevel] = useState(0);
  const arcDraggingRef = useRef(false);
  const physicsParams  = useRef({ ...PHYS_DEFAULTS });
  const engagedRef     = useRef(new Set(CARDIAC_ANNOTATIONS[0].engaged));
  const [panelHidden,     setPanelHidden]     = useState(false);
  const [selectedDisease,  setSelectedDisease]  = useState("atherosclerosis");
  const [activeStageIdx,   setActiveStageIdx]   = useState(0);
  const [selectorCollapsed, setSelectorCollapsed] = useState(true);
  const activeStageIdxRef = useRef(0);

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
        panRef.current.active = false; // cancel pan when pinch begins
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

  // Unified 60-fps loop: disease physics + homeostasis cascade + rope + control canvas
  useEffect(() => {
    let prevT = null;
    let raf;

    const tick = (t) => {
      raf = requestAnimationFrame(tick);
      if (prevT === null) { prevT = t; return; }
      const dt = Math.min((t - prevT) / 1000, 0.05);
      prevT = t;

      const N  = MCTOSHS_ORBITS.length;
      const s0 = orbStateRef.current[0]; // M

      // ── M physics ─────────────────────────────────────────────
      // The arc control sets a TARGET ANGLE for M (mapped from arc position 0–0.20 → angle 0–PI).
      // M springs toward that target — it ALWAYS reaches it regardless of compensation.
      // T, O, OS, H, S push back CCW but the disease spring (K=4.0) dominates, so M
      // settles within a few degrees of the target. Cascade depth shows how hard the
      // body is fighting; the target determines where M ultimately rests.
      if (!mDraggingRef.current) {
        const TARGET_ANG = (diseaseRef.current / 0.20) * Math.PI; // arc → angle [0, PI]
        const K_DISEASE  = 28.0;  // overwhelms all compensatory forces — M ALWAYS reaches target
        const DMP_M      = 14.0;  // overdamped (ratio ≈ 1.3) — no oscillation, smooth approach
        const alphaM = K_DISEASE * (TARGET_ANG - s0.angle); // spring toward disease target
        s0.omega += (alphaM - DMP_M * s0.omega) * dt;
        s0.angle += s0.omega * dt;
        if (s0.angle > Math.PI)    { s0.angle = Math.PI; s0.omega = 0; }
        if (s0.angle < -Math.PI/2) { s0.angle = -Math.PI/2; s0.omega = 0; }
      }

      const mAng   = s0.angle;
      const isDead = mAng >= DEATH_THRESH;

      // Dynamic engagement from M's actual position — keeps arc-drag and stage-buttons in sync
      const currentD     = (Math.max(0, mAng) / Math.PI) * 0.20;
      const dynStageIdx  = CARDIAC_ANNOTATIONS.reduce((best, ann, idx) => currentD >= ann.d ? idx : best, 0);
      const dynEngaged   = CARDIAC_ANNOTATIONS[dynStageIdx].engaged;

      // ── C: always compensates CCW against M's pathological pressure ──
      const pp      = physicsParams.current;
      const K_SP    = pp.kSp;
      const DMP_ORB = pp.dmpOrb;
      {
        const sc            = orbStateRef.current[1];
        const mPathological = Math.max(0, mAng);
        const targetC       = -Math.min(mPathological, PHYSIO_LIMIT) * pp.cMirrorRatio;
        const mOverload     = Math.max(0, mPathological - pp.compResilience);
        const alpha_c       = isDead
          ? 3.0 * (-Math.PI - sc.angle) - DMP_ORB * 3.5 * sc.omega
          : K_SP * 1.7 * (targetC - sc.angle) - DMP_ORB * 1.1 * sc.omega - pp.pressureCoeff * mOverload;
        sc.omega += alpha_c * dt;
        sc.angle += sc.omega * dt;
        if (sc.angle > 0)        { sc.angle = 0;        sc.omega = 0; }
        if (sc.angle < -Math.PI) { sc.angle = -Math.PI; sc.omega = 0; }
        // Update C's smoothed angle — inner orbits use this to avoid chasing C's oscillation
        sc.smo += 0.01 * (sc.angle - sc.smo);
      }

      // ── T, O, OS, H, S: engaged → compensate CCW, not yet engaged → stay at 0 ──
      // "engaged" means this dimension has been recruited into the homeostatic fight.
      // Each orbit tracks a SMOOTHED version of its outer neighbour's angle (smo) so it follows
      // the slow trend of C's position without bouncing with C's fast oscillation.
      for (let i = 2; i < N; i++) {
        const s         = orbStateRef.current[i];
        const outer     = orbStateRef.current[i - 1];
        const prevAng   = outer.angle; // actual (oscillating) outer angle
        const prevSmo   = outer.smo;  // smoothed outer angle — rope target uses this
        const orbId     = MCTOSHS_ORBITS[i].letter;
        const isEngaged = dynEngaged.includes(orbId);
        const orb_k     = K_SP    * CASCADE_K_FACTORS[i - 2];
        const orb_dmp   = DMP_ORB * CASCADE_DMP_FACTORS[i - 2] * 2.1; // critically damped: no overshoot, clean follow
        let alpha       = -orb_dmp * s.omega;

        if (isDead) {
          alpha += 3.0 * (-Math.PI - s.angle);
        } else if (!isEngaged) {
          alpha += orb_k * (0 - s.angle);
        } else {
          // Rope target uses smoothed outer so T/O/OS/H/S don't chase C's oscillation
          const ropeTgt = Math.min(0, prevSmo + ROPE_GAP);
          alpha += orb_k * (ropeTgt - s.angle);
          const ccw_overload = Math.max(0, -prevAng - PHYSIO_LIMIT); // actual for overload detection
          alpha -= pp.breakdownForce * ccw_overload;
        }

        s.omega += alpha * dt;
        s.angle += s.omega * dt;
        if (s.angle >  0)          { s.angle =  0;          s.omega = 0; }
        if (s.angle < -Math.PI)    { s.angle = -Math.PI;    s.omega = 0; }
        if (s.angle < prevSmo)     { s.angle = prevSmo;     s.omega = 0; } // clamp to outer's trend (not instant)
        s.smo += 0.01 * (s.angle - s.smo); // update this orbit's smoothed angle for its inner neighbour
      }

      // ── Render all orbit dots ──────────────────────────────────
      MCTOSHS_ORBITS.forEach((orb, i) => {
        const s  = orbStateRef.current[i];
        const el = dotElsRef.current[i];
        if (!el) return;
        const cssDeg = s.angle * (180 / Math.PI) - 90;
        const rad    = s.angle - Math.PI / 2;
        el.style.transform = `rotate(${cssDeg}deg) translateX(${orb.r}px)`;
        el.style.opacity   = '1';
        const dotEl = el.firstElementChild;
        if (dotEl) dotEl.style.transform = `rotate(${-cssDeg}deg)`;
        s._x = 450 + Math.cos(rad) * orb.r;
        s._y = 450 + Math.sin(rad) * orb.r;
      });

      // ── Update stage display + active stage index ─────────────
      {
        const mD = Math.max(0, s0.angle / Math.PI) * 0.20;
        let ann = CARDIAC_ANNOTATIONS[0];
        let annIdx = 0;
        for (let ai = CARDIAC_ANNOTATIONS.length - 1; ai >= 0; ai--) {
          if (mD >= CARDIAC_ANNOTATIONS[ai].d) { ann = CARDIAC_ANNOTATIONS[ai]; annIdx = ai; break; }
        }
        const el = stageDisplayRef.current;
        if (el && el._lastAbbr !== ann.abbr) {
          el._lastAbbr = ann.abbr;
          const raw = ann.color;
          el.innerHTML =
            `<span class="dstage_abbr" style="color:${raw}">${ann.abbr}</span>` +
            `<span class="dstage_desc">${ann.desc}</span>` +
            `<span class="dstage_note">${ann.note}</span>`;
          el.style.borderColor = raw.replace(/[\d.]+\)$/, '0.28)');
        }
        if (annIdx !== activeStageIdxRef.current) {
          activeStageIdxRef.current = annIdx;
          setActiveStageIdx(annIdx);
        }
      }

      // ── Draw ropes ─────────────────────────────────────────────
      const ropeCanvas = ropeCanvasRef.current;
      if (ropeCanvas) {
        const ctx = ropeCanvas.getContext('2d');
        ctx.clearRect(0, 0, 900, 900);
        for (let i = 0; i < N - 1; i++) {
          const a = orbStateRef.current[i];
          const b = orbStateRef.current[i + 1];
          const col = MCTOSHS_ORBITS[i].color;
          ctx.beginPath();
          ctx.moveTo(a._x, a._y);
          ctx.lineTo(b._x, b._y);
          ctx.strokeStyle = col + '55';
          ctx.lineWidth   = 1.2;
          ctx.setLineDash([4, 5]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // M-drag: grab the M dot directly on the stage and drag it to any position
  const handleMDotPointerDown = (e) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    mDraggingRef.current = true;
    orbStateRef.current[0].omega = 0;
  };

  const handleWrapPointerDown = (e) => {
    // Only start pan for the primary pointer (not M-dot or arc — those stopPropagation)
    if (!e.isPrimary || pinchRef.current.active) return;
    const pr = panRef.current;
    pr.active = true;
    pr.startX = e.clientX;
    pr.startY = e.clientY;
    // snapshot current pan as base for this drag
    pr.baseX  = pr.panX;
    pr.baseY  = pr.panY;
  };

  const handleStagePointerMove = (e) => {
    if (mDraggingRef.current) {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const dx = e.clientX - (rect.left + rect.width  / 2);
      const dy = e.clientY - (rect.top  + rect.height / 2);
      if (Math.sqrt(dx * dx + dy * dy) < 5) return;
      const s0 = orbStateRef.current[0];
      s0.angle = Math.atan2(dy, dx) + Math.PI / 2;
      s0.omega = 0;
    } else if (panRef.current.active && e.isPrimary && !arcDraggingRef.current) {
      const pr = panRef.current;
      const nx = pr.baseX + (e.clientX - pr.startX);
      const ny = pr.baseY + (e.clientY - pr.startY);
      pr.panX = nx;
      pr.panY = ny;
      setPanXY({ x: nx, y: ny });
    }
  };

  const handleStagePointerUp = () => {
    mDraggingRef.current   = false;
    panRef.current.active  = false;
  };

  // Arc control: angle from wrap center maps to disease intensity [0, 0.20]
  const updateDiseaseFromPointer = (e) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    // Subtract panXY because the arc centre moves with the pan offset
    const dx = e.clientX - (rect.left + rect.width  / 2) - panXY.x;
    const dy = e.clientY - (rect.top  + rect.height / 2) - panXY.y;
    const raw = Math.atan2(dy, dx);
    const ang = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, raw));
    const d = (ang + Math.PI / 2) / Math.PI * 0.20;
    diseaseRef.current = d;
    setDiseaseLevel(d);
  };

  const handleArcPointerDown = (e) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    arcDraggingRef.current = true;
    updateDiseaseFromPointer(e);
  };
  const handleArcPointerMove = (e) => {
    if (!arcDraggingRef.current) return;
    updateDiseaseFromPointer(e);
  };
  const handleArcPointerUp = () => { arcDraggingRef.current = false; };

  const selectStage = (idx) => {
    const ann = CARDIAC_ANNOTATIONS[idx];
    diseaseRef.current = ann.d;
    setDiseaseLevel(ann.d);
    physicsParams.current = { ...PHYS_DEFAULTS, ...ann.config };
    engagedRef.current = new Set(ann.engaged);
    activeStageIdxRef.current = idx;
    setActiveStageIdx(idx);
    // Kill velocities and sync smo to current angle on stage change
    orbStateRef.current.forEach(s => { s.omega = 0; s.smo = s.angle; });
  };

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

  // Spheres always at full size (no sagittal cross-section)
  const prR_disp = 360;
  const msR_disp = 260;

  return (
    <div id="login_page">

      {/* ── LEFT: 2D Orbital Animation ── */}
      <div id="login_anim_panel" className={panelHidden ? "login_panel_expanded" : ""}>
        <div id="login_brand">
          <div id="login_sigil"><span>M</span></div>
          <div id="login_brand_text">
            <h1 id="login_wordmark">MCTOSHS | CVS</h1>
            <p id="login_platform_label">Cardiovascular Thread of Clinical Patient Reality</p>
          </div>
        </div>

        <div id="login_stage_wrap" ref={wrapRef}
          onPointerDown={handleWrapPointerDown}
          onPointerMove={handleStagePointerMove}
          onPointerUp={handleStagePointerUp}
          onPointerCancel={handleStagePointerUp}
        >
          <div id="login_stage" style={{ transform: `translate(${panXY.x}px,${panXY.y}px) scale(${stageScale})` }}>

            {/* Spheres + zone labels on PR sphere */}
            <div id="login_center">
              <div id="login_center_glow" />
              <div id="pr_sphere">
                {/* Zone sector labels — positioned within the PR sphere */}
                <div id="pr_zone_detr">Deterioration</div>
                {/* Divider lines at 3 o'clock / 9 o'clock / 12 o'clock */}
                <svg id="pr_zone_svg" viewBox="0 0 720 720" aria-hidden="true">
                  <line x1="360" y1="0"   x2="360" y2="360" stroke="rgba(255,255,255,0.08)" strokeWidth="1"/>
                </svg>
                <div id="pr_spec_a" />
                <div id="pr_spec_b" />
                <div id="pr_rim" />
                <div id="mctosh_sphere">
                  <div id="ms_rim" />
                </div>
              </div>

              {/* Patient Reality as a 3D thread — panning reveals the flat
                  circle is one cross-section ring of a rope-like tube */}
              <div id="pr_thread_wrap">
                <div
                  id="pr_thread_group"
                  style={{
                    transform:
                      `rotateX(${Math.max(-28, Math.min(28, -panXY.y * 0.06))}deg) ` +
                      `rotateY(${Math.max(-28, Math.min(28,  panXY.x * 0.06))}deg)`,
                  }}
                >
                  {PR_THREAD_RINGS.map((z) => (
                    <div key={z} className="pr_thread_ring" style={{ transform: `translateZ(${z}px)` }} />
                  ))}
                </div>
              </div>
            </div>

            {/* MCTOSHS label */}
            <div id="ms_label_wrap" style={{ top: `${450 + msR_disp + 15}px` }}>
              <span id="ms_label_name">MCTOSHS</span>
            </div>

            {/* Patient Reality label */}
            <div id="pr_label_wrap">
              <span id="pr_name">Patient Reality</span>
            </div>

            {/* Soft orbit path rings — always full size */}
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

            {/* Rope canvas — drawn by RAF loop */}
            <canvas
              ref={ropeCanvasRef}
              width={900} height={900}
              style={{
                position: 'absolute', top: 0, left: 0,
                width: '900px', height: '900px',
                pointerEvents: 'none', zIndex: 7,
              }}
            />

            {/* Curved disease control — right half of PR sphere border */}
            {(() => {
              const ARC_R  = 390;
              const t      = diseaseLevel / 0.20;
              const ang    = t * Math.PI - Math.PI / 2;
              const dotX   = 450 + ARC_R * Math.cos(ang);
              const dotY   = 450 + ARC_R * Math.sin(ang);
              const dr     = Math.round(255 * t);
              const dg     = Math.round(220 * (1 - t));
              const dotCol  = `rgba(${dr},${dg},70,0.95)`;
              const glowCol = `rgba(${dr},${dg},70,0.30)`;
              const trackD  = `M 450 ${450 - ARC_R} A ${ARC_R} ${ARC_R} 0 0 1 450 ${450 + ARC_R}`;
              return (
                <svg viewBox="0 0 900 900" style={{
                  position: 'absolute', top: 0, left: 0,
                  width: '900px', height: '900px',
                  overflow: 'visible', pointerEvents: 'none', zIndex: 9,
                }}>
                  <defs>
                    <linearGradient id="arcGrad" gradientUnits="userSpaceOnUse"
                      x1="450" y1={450 - ARC_R} x2="450" y2={450 + ARC_R}>
                      <stop offset="0%"   stopColor="rgba(0,220,110,0.80)" />
                      <stop offset="45%"  stopColor="rgba(255,190,0,0.70)" />
                      <stop offset="100%" stopColor="rgba(255,60,60,0.80)" />
                    </linearGradient>
                    {/* Illustration arc gradients */}
                    <linearGradient id="dfGrad" gradientUnits="userSpaceOnUse"
                      x1="450" y1="188" x2="450" y2="712">
                      <stop offset="0%"   stopColor="rgba(255,180,40,0.45)" />
                      <stop offset="55%"  stopColor="rgba(255,60,10,0.90)" />
                      <stop offset="100%" stopColor="rgba(210,0,0,1.00)" />
                    </linearGradient>
                    <linearGradient id="drGrad" gradientUnits="userSpaceOnUse"
                      x1="450" y1="188" x2="450" y2="712">
                      <stop offset="0%"   stopColor="rgba(0,240,120,1.00)" />
                      <stop offset="50%"  stopColor="rgba(0,200,255,0.80)" />
                      <stop offset="100%" stopColor="rgba(0,120,220,0.35)" />
                    </linearGradient>
                  </defs>

                  {/* Death-Favours — right half of MCTOSHS system (CW 12→6 o'clock) */}
                  <path d="M 450 188 A 262 262 0 0 1 450 712"
                    fill="none" stroke="url(#dfGrad)"
                    strokeWidth="2.5" strokeDasharray="6 6"
                    strokeLinecap="round" opacity="0.92"
                    style={{ pointerEvents: 'none' }} />
                  <text
                    transform="rotate(90, 730, 450)"
                    x="730" y="452"
                    textAnchor="middle" dominantBaseline="middle"
                    fill="rgba(255,90,20,0.85)"
                    fontSize="9.5" fontFamily="'Courier New', monospace"
                    fontWeight="700" letterSpacing="0.22em"
                    style={{ pointerEvents: 'none' }}
                  >DEATH-FAVOURS</text>

                  {/* Death-Resistance — left half of MCTOSHS system (CCW 12→6 o'clock) */}
                  <path d="M 450 188 A 262 262 0 0 0 450 712"
                    fill="none" stroke="url(#drGrad)"
                    strokeWidth="2.5" strokeDasharray="6 6"
                    strokeLinecap="round" opacity="0.92"
                    style={{ pointerEvents: 'none' }} />
                  <text
                    transform="rotate(-90, 170, 450)"
                    x="170" y="452"
                    textAnchor="middle" dominantBaseline="middle"
                    fill="rgba(0,220,110,0.85)"
                    fontSize="9.5" fontFamily="'Courier New', monospace"
                    fontWeight="700" letterSpacing="0.22em"
                    style={{ pointerEvents: 'none' }}
                  >DEATH-RESISTANCE</text>

                  {/* Timing range indicators — one tick per disease stage along the arc */}
                  {CARDIAC_ANNOTATIONS.map((ann, i) => {
                    const tf  = ann.d / 0.20;
                    const ang = tf * Math.PI - Math.PI / 2;
                    const R   = 390;
                    const ax  = 450 + R * Math.cos(ang);
                    const ay  = 450 + R * Math.sin(ang);
                    const nx  = Math.cos(ang); // outward normal
                    const ny  = Math.sin(ang);
                    const isEndpoint = i === 0 || i === CARDIAC_ANNOTATIONS.length - 1;
                    const TICK = isEndpoint ? 20 : 13;
                    const LPAD = 4;
                    const lx  = ax + (TICK + LPAD) * nx;
                    const ly  = ay + (TICK + LPAD) * ny;
                    const anchor = Math.abs(nx) < 0.12 ? "middle" : nx > 0 ? "start" : "end";
                    return (
                      <g key={ann.abbr} style={{ pointerEvents: 'none' }}>
                        <line
                          x1={ax} y1={ay}
                          x2={ax + TICK * nx} y2={ay + TICK * ny}
                          stroke={ann.color}
                          strokeWidth={isEndpoint ? "1.5" : "1"}
                          opacity={isEndpoint ? "0.65" : "0.50"}
                        />
                        <text
                          x={lx} y={ly}
                          textAnchor={anchor}
                          dominantBaseline="middle"
                          fill={ann.color}
                          fontSize={isEndpoint ? "9" : "8"}
                          fontFamily="'Courier New', monospace"
                          fontWeight="700"
                          letterSpacing="0.06em"
                          opacity={isEndpoint ? "0.80" : "0.65"}
                          style={{ pointerEvents: 'none' }}
                        >{ann.abbr}</text>
                      </g>
                    );
                  })}

                  {/* Track */}
                  <path d={trackD} fill="none" stroke="url(#arcGrad)"
                    strokeWidth="1.5" strokeDasharray="5 8" strokeLinecap="round" opacity="0.65" />


                  {/* Hit area — wide invisible stroke for easy touch/drag */}
                  <path d={trackD} fill="none" stroke="transparent" strokeWidth="44"
                    pointerEvents="stroke" style={{ cursor: 'ns-resize' }}
                    onPointerDown={handleArcPointerDown}
                    onPointerMove={handleArcPointerMove}
                    onPointerUp={handleArcPointerUp}
                    onPointerCancel={handleArcPointerUp}
                  />

                  {/* Glow ring */}
                  <circle cx={dotX} cy={dotY} r="14"
                    fill="none" stroke={glowCol} strokeWidth="8"
                    style={{ pointerEvents: 'none' }} />
                  {/* Indicator dot */}
                  <circle cx={dotX} cy={dotY} r="5.5"
                    fill={dotCol} stroke="rgba(255,255,255,0.65)" strokeWidth="1.5"
                    style={{ pointerEvents: 'none' }} />
                </svg>
              );
            })()}

            {/* Orbiting letter dots — M (i=0) is draggable to set disease state */}
            {MCTOSHS_ORBITS.map((orb, i) => (
              <div
                key={orb.id}
                ref={el => { dotElsRef.current[i] = el; }}
                className="bio_particle"
                style={{ "--orb-color": orb.color, ...(i === 0 ? { cursor: 'grab', touchAction: 'none' } : {}) }}
                onPointerDown={i === 0 ? handleMDotPointerDown : undefined}
              >
                <div className="orb_dot">
                  <span className="orb_dot_letter">{orb.letter}</span>
                </div>
              </div>
            ))}

          </div>
        </div>


        {/* ── Disease timeline selector ── */}
        <div id="disease_selector">
          <div id="ds_head">
            <i className="fi fi-rr-time-forward" />
            <select
              id="ds_disease_select"
              value={selectedDisease}
              onChange={e => setSelectedDisease(e.target.value)}
            >
              {DISEASES.map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
            <button id="ds_collapse_btn" onClick={() => setSelectorCollapsed(v => !v)}
              title={selectorCollapsed ? "Expand" : "Collapse"}>
              <i className={`fi ${selectorCollapsed ? "fi-rr-angle-up" : "fi-rr-angle-down"}`} />
            </button>
          </div>
          <div id="ds_list" className={selectorCollapsed ? "ds_list--hidden" : ""}>
            {CARDIAC_ANNOTATIONS.map((ann, idx) => (
              <button
                key={idx}
                className={`ds_item${activeStageIdx === idx ? " ds_item--active" : ""}`}
                style={{ "--sc": ann.color }}
                onClick={() => selectStage(idx)}
              >
                <span className="ds_dot" />
                <span className="ds_abbr">{ann.abbr}</span>
                <span className="ds_desc">{ann.desc}</span>
                <div className="ds_engaged">
                  {ann.engaged.map(e => (
                    <span key={e} className="ds_badge">{e}</span>
                  ))}
                </div>
              </button>
            ))}
          </div>
        </div>


        <p id="login_tagline">&ldquo;From representation to reality&rdquo;</p>


      </div>

      {/* ── Collapse toggle ── */}
      <button
        id="login_panel_toggle"
        title={panelHidden ? "Show login panel" : "Hide login panel"}
        onClick={() => setPanelHidden(v => !v)}
      >
        <i className={`fi ${panelHidden ? "fi-rr-angle-left" : "fi-rr-angle-right"}`} />
      </button>

      {/* ── RIGHT: Form Panel ── */}
      <div id="login_panel" className={panelHidden ? "login_panel_hidden" : ""}>

        {/* Introduction video — hidden by default, shown on request */}
        <button
          id="login_video_toggle"
          type="button"
          onClick={() => {
            if (videoVisible) {
              const v = videoRef.current;
              if (v && !v.paused) { v.pause(); setVideoPaused(true); }
            }
            setVideoVisible(v => !v);
          }}
        >
          <i className={`fi ${videoVisible ? "fi-rr-cross-small" : "fi-rr-play-alt"}`} />
          {videoVisible ? "Hide intro" : "Watch intro"}
        </button>

        {videoVisible && (
          <div id="login_video_container">
            <video
              id="login_intro_video"
              ref={videoRef}
              src="https://res.cloudinary.com/dtoxkii3q/video/upload/v1782581889/sample1/user-images/6a237f080175aacbdb3962ff/copy_dbc85ec1-1520-4cba-af16-b27eb6de8979.mp4"
              loop playsInline
            />
            <button
              id="login_video_btn"
              type="button"
              aria-label={videoPaused ? "Play" : "Pause"}
              onClick={() => {
                const v = videoRef.current;
                if (!v) return;
                if (v.paused) { v.play(); setVideoPaused(false); }
                else          { v.pause(); setVideoPaused(true);  }
              }}
            >
              {videoPaused
                ? <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
                : <svg viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="3" width="4" height="18"/><rect x="15" y="3" width="4" height="18"/></svg>
              }
            </button>
          </div>
        )}

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
          <span>MCTOSHS | CVS &middot; From representation to reality</span>
          <span>&copy; {new Date().getFullYear()} Rudy Hamame</span>
        </footer>
      </div>

    </div>
  );
}
