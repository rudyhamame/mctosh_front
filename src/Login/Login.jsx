import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./login.css";
import { apiUrl } from "../config/api";
import { writeStoredSession } from "../utils/sessionCleanup";

// Divisor used only for fitting the 900px stage to its container (see
// baseScaleRef below) — bigger than the stage's own 900px so the object
// renders smaller than its container, leaving real empty space around it
// to isolate it from the surrounding panel/UI instead of crowding the
// edges. Deliberately generous since rotating the object and the observation
// plate's depth travel both extend its visual footprint well past the flat
// 900px sphere radius.
const STAGE = 1500;

const MCTOSHS_ORBITS = [
  { id: "m",  letter: "M",  r: 244, color: "#00e5ff", dur: "8s",   dir: "cw", delay: "0s" },
  { id: "c",  letter: "C",  r: 214, color: "#4da6ff", dur: "16s",  dir: "cw", delay: "0s" },
  { id: "t",  letter: "T",  r: 182, color: "#a678f5", dur: "32s",  dir: "cw", delay: "0s" },
  { id: "o",  letter: "O",  r: 150, color: "#ffab40", dur: "64s",  dir: "cw", delay: "0s" },
  { id: "s1", letter: "OS", r: 116, color: "#5cf5a0", dur: "128s", dir: "cw", delay: "0s" },
  { id: "h",  letter: "H",  r:  82, color: "#ff7aa2", dur: "256s", dir: "cw", delay: "0s" },
  { id: "s2", letter: "S",  r:  48, color: "#ffd54f", dur: "512s", dir: "cw", delay: "0s" },
];

// Full name for each orbit letter — the biological/social scale MCTOSHS is
// built from, matching the same naming used in ClinicalSchemata and the
// ontology validation schema elsewhere in the app.
const SCHEMA_NAMES = {
  M:  "Molecule Schema",
  C:  "Cell Schema",
  T:  "Tissue Schema",
  O:  "Organ Schema",
  OS: "Organ System Schema",
  H:  "Human Schema",
  S:  "Society Schema",
};

// ── Homeostasis zones (angles: 0 = 12 o'clock, CW positive) ──────────────
const PHYSIO_LIMIT  = Math.PI / 2;
const DEATH_THRESH  = Math.PI * 0.95;
// Each engaged orbit's rope target reaches this much *deeper* than the
// smoothed position of the orbit it's protecting (T shields C, O shields T,
// ...) — not a small fixed offset, a proportional one, so the reserve
// chain's depth compounds inward: whichever orbit is deepest (normally S)
// is the one actually closest to real death.
const DEPTH_GROWTH = 1.35;

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

// ── Precomputed identities ────────────────────────────────────────────────
// Each disease stage is a discrete, self-contained 2D identity — the full
// [M,C,T,O,OS,H,S] angle set that stage "is", not a live simulation result.
// Stacking these along a depth axis (see the 3D slice stack below) is what
// turns the sequence into a single 3D object: time isn't a free parameter
// you scrub through, it's what's revealed by moving from one identity to
// the next.
const computeOnsetIdentity = (stageIdx) => {
  const ann = CARDIAC_ANNOTATIONS[stageIdx];
  const cfg = { ...PHYS_DEFAULTS, ...ann.config };
  const mAngle = (ann.d / 0.20) * Math.PI;
  const mPathological = Math.max(0, mAngle);
  // Total system collapse: M itself has crossed into death, so nothing is
  // "compensating" anymore — every dimension gives out at once and the
  // whole cascade aligns at -PI, the same way every dimension aligns at 0
  // in the healthy identity. This bypasses the ordinary compensation
  // formulas below, which only ever approach -PI asymptotically and would
  // otherwise leave C (and often T, O) short of true alignment even in
  // the worst stage.
  const isDeathStage = mAngle >= DEATH_THRESH;
  const angles = new Array(MCTOSHS_ORBITS.length).fill(0);
  angles[0] = mAngle;
  const cAngle = isDeathStage
    ? -Math.PI
    : ann.engaged.includes("C")
      ? -Math.min(mPathological, PHYSIO_LIMIT) * cfg.cMirrorRatio
      : 0;
  angles[1] = cAngle;
  let prevAngle = cAngle;
  for (let i = 2; i < MCTOSHS_ORBITS.length; i++) {
    const letter = MCTOSHS_ORBITS[i].letter;
    if (isDeathStage) {
      angles[i] = -Math.PI;
      prevAngle = -Math.PI;
    } else if (ann.engaged.includes(letter)) {
      // Deliberately DEEPER than the orbit it's protecting (T shields C, O
      // shields T, ...), clamped at -PI (death) — DEPTH_GROWTH compounding
      // means the deepest reserves in the worst stages are already AT death
      // in their onset identity, not just approaching it.
      const depth = Math.max(-Math.PI, prevAngle * DEPTH_GROWTH);
      angles[i] = depth;
      prevAngle = depth;
    } else {
      angles[i] = 0;
    }
  }
  return angles;
};

const ONSET_IDENTITIES = CARDIAC_ANNOTATIONS.map((_, i) => computeOnsetIdentity(i));
const WORST_STAGE_IDX = CARDIAC_ANNOTATIONS.length - 1;

// Recovery identity: M and C track the new (lower) stage directly — they
// respond to the current disease level with no lag. T/O/OS/H/S don't:
// each is still interpolating back from wherever it peaked (the worst
// stage reached) toward the new target, at its own pace — CASCADE_K_FACTORS
// (T fastest, S slowest) doubles as "how much of that recovery journey is
// already done" so C always leads, T follows, and S is last, exactly
// mirroring the onset order in reverse.
const computeRecoveryIdentity = (stageIdx) => {
  const onset = ONSET_IDENTITIES[stageIdx];
  const peak = ONSET_IDENTITIES[WORST_STAGE_IDX];
  const angles = [onset[0], onset[1]];
  for (let i = 2; i < MCTOSHS_ORBITS.length; i++) {
    const recovered = CASCADE_K_FACTORS[i - 2];
    angles[i] = peak[i] + (onset[i] - peak[i]) * recovered;
  }
  return angles;
};

const RECOVERY_IDENTITIES = CARDIAC_ANNOTATIONS.map((_, i) => computeRecoveryIdentity(i));

// ── Dense interpolation — a continuous physics, expressed as many discrete
// frames instead of a live simulation. Between every pair of adjacent
// canonical stages we linearly interpolate the full [M,C,T,O,OS,H,S] vector
// (and severity/color) in DENSE_SUBSTEPS increments, turning 9 precomputed
// identities into a long, smooth-stepping sequence — still fundamentally a
// stack of 2D slices, just fine-grained enough to feel continuous when you
// travel through it one frame at a time.
// Higher = more, finer-grained frames = smoother apparent motion when
// travelling through the track (each index step is a smaller change).
// Cheap to raise: rendering only ever samples a fixed DOM budget (see
// FULL_VIEW_BUDGET) regardless of how many frames actually exist here.
const DENSE_SUBSTEPS = 40;
const buildDenseTrack = (stageIdentities) => {
  const dense = [];
  for (let s = 0; s < CARDIAC_ANNOTATIONS.length - 1; s++) {
    const fromAnn = CARDIAC_ANNOTATIONS[s];
    const toAnn   = CARDIAC_ANNOTATIONS[s + 1];
    const fromId  = stageIdentities[s];
    const toId    = stageIdentities[s + 1];
    for (let k = 0; k < DENSE_SUBSTEPS; k++) {
      const t = k / DENSE_SUBSTEPS;
      dense.push({
        angles: fromId.map((a, i) => a + (toId[i] - a) * t),
        d:      fromAnn.d + (toAnn.d - fromAnn.d) * t,
        color:  t < 0.5 ? fromAnn.color : toAnn.color,
      });
    }
  }
  const last = CARDIAC_ANNOTATIONS[CARDIAC_ANNOTATIONS.length - 1];
  dense.push({ angles: stageIdentities[stageIdentities.length - 1], d: last.d, color: last.color });
  return dense;
};

const DENSE_ONSET    = buildDenseTrack(ONSET_IDENTITIES);
const DENSE_RECOVERY = buildDenseTrack(RECOVERY_IDENTITIES);
// One continuous ordered path through the whole object, monotonically from
// optimum physiology to full death: the onset story first (healthy →
// death), then the recovery track's own identities in that same
// direction (least-severe → most-severe). Both tracks end at the identical
// full-death identity, so the very first frame is life and the very last
// is death, with nothing beyond it.
const COMBINED_TRACK = [
  ...DENSE_ONSET.map(e => ({ ...e, track: "onset" })),
  ...DENSE_RECOVERY.map(e => ({ ...e, track: "recovery" })),
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
  const [stageScale, setStageScale] = useState(1);

  const [mode,         setMode]         = useState("login");
  const [username,     setUsername]     = useState("");
  const [password,     setPassword]     = useState("");
  const [name,         setName]         = useState("");
  const [error,        setError]        = useState("");
  const [loading,      setLoading]      = useState(false);
  const [panelHidden,     setPanelHidden]     = useState(false);
  const [selectedDisease,  setSelectedDisease]  = useState("atherosclerosis");
  const [selectorCollapsed, setSelectorCollapsed] = useState(true);

  // Every precomputed identity is always present, layered along Z — that
  // whole assembly IS the 3D object, and it stays put. A direct drag on the
  // stage freely rotates it to view from outside. The travel slider doesn't
  // touch the object at all — it moves a separate "observation plate" (the
  // PR sphere + orbit rings, see depthForIdx below) through the object's
  // fixed depth axis, like a scan plane passing through a stack of slices.
  const [rotation, setRotation] = useState({ x: -20, y: -30 });
  const rotateDragRef = useRef({ active: false, startX: 0, startY: 0, startRotX: 0, startRotY: 0 });

  // plateIdx: the TARGET frame the slider/stage-list asked for — instant
  // and exact, so the slider thumb itself always feels directly responsive.
  // animatedIdx is the frame that's actually rendered: it eases toward
  // plateIdx every tick of the RAF loop below instead of snapping, which is
  // the "dynamic continuous motion" from the old live simulation, reused
  // here for the discrete track instead of a physics angle.
  const [plateIdx, setPlateIdx] = useState(0);
  const plateIdxRef = useRef(0);
  const [animatedIdx, setAnimatedIdx] = useState(0);
  // Every direct interaction (slider drag, stage-list click) resets this —
  // it's what the auto-heal loop below checks to know nothing is currently
  // driving the plate deeper.
  const lastInteractionRef = useRef(Date.now());
  const setPlate = (v) => {
    plateIdxRef.current = v;
    lastInteractionRef.current = Date.now();
    setPlateIdx(v);
  };

  // cutawayIdx: hides slices strictly in front of the plate (idx <
  // cutawayIdx, i.e. life-ward / closer to the viewer than depthForIdx(0)
  // puts them) so you can see past a crowded near field straight down to
  // wherever the plate currently sits. Clamped to plateIdx — it can only
  // ever clear away up TO the plate's own slice, never past it.
  const [cutawayIdx, setCutawayIdx] = useState(0);

  // Automatic healing: left alone (no slider drag, no stage-list click) for
  // a few seconds, the plate drifts back toward optimum physiology on its
  // own — the same exponential decay-toward-health idea the old live
  // simulation used when nothing was actively pushing disease further.
  useEffect(() => {
    let raf;
    let lastT = performance.now();
    const HEAL_DELAY_MS = 2500; // idle time before healing kicks in
    const HEAL_RATE      = 0.18; // /s — decay time constant
    const EASE_SPEED     = 8;    // /s — how fast the rendered frame chases the target

    const tick = (t) => {
      raf = requestAnimationFrame(tick);
      // Capped higher than a single 60fps frame (but still capped) so a
      // busy tab/machine dropping frames doesn't read as the animation
      // itself running in slow motion — it still reflects real elapsed
      // time up to a point, it just won't lurch after very long stalls
      // (e.g. a backgrounded tab).
      const dt = Math.min((t - lastT) / 1000, 0.15);
      lastT = t;

      if (Date.now() - lastInteractionRef.current > HEAL_DELAY_MS && plateIdxRef.current > 0) {
        const next = plateIdxRef.current * Math.max(0, 1 - HEAL_RATE * dt);
        const settled = next < 0.5 ? 0 : next;
        plateIdxRef.current = settled;
        setPlateIdx(settled);
      }

      setAnimatedIdx(prev => {
        const diff = plateIdxRef.current - prev;
        if (Math.abs(diff) < 0.02) return plateIdxRef.current;
        return prev + diff * Math.min(1, dt * EASE_SPEED);
      });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

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
        rotateDragRef.current.active = false; // cancel rotate-drag when pinch begins
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

  // Drag anywhere on the stage (that isn't the arc control) to orbit the
  // object freely — both axes, unclamped, so it can be panned 360° in any
  // direction to inspect the full identity stack from outside.
  const handleWrapPointerDown = (e) => {
    if (!e.isPrimary || pinchRef.current.active) return;
    const dr = rotateDragRef.current;
    dr.active = true;
    dr.startX = e.clientX;
    dr.startY = e.clientY;
    dr.startRotX = rotation.x;
    dr.startRotY = rotation.y;
  };

  const handleStagePointerMove = (e) => {
    const dr = rotateDragRef.current;
    if (!dr.active || !e.isPrimary) return;
    const dx = e.clientX - dr.startX;
    const dy = e.clientY - dr.startY;
    setRotation({
      x: dr.startRotX - dy * 0.4,
      y: dr.startRotY + dx * 0.4,
    });
  };

  const handleStagePointerUp = () => {
    rotateDragRef.current.active = false;
  };

  // Stage-list click: jump the observation plate straight to that canonical
  // stage's exact onset frame (stage s sits at dense index s *
  // DENSE_SUBSTEPS within COMBINED_TRACK, since the onset half of the track
  // occupies its first DENSE_ONSET.length entries in that same order).
  const selectStage = (idx) => {
    setPlate(idx * DENSE_SUBSTEPS);
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

  // The full object is the whole dense COMBINED_TRACK — every interpolated
  // frame of the round trip (sicken, then heal), layered as flat, parallel
  // slices along Z, one per frame, and it never changes shape or hides
  // anything for the slider. Dragging the stage directly is the only thing
  // that rotates it. The travel slider instead moves the observation plate
  // (PR sphere + orbit rings) to depthForIdx(plateIdx) — a marker plane
  // scanning through the object's fixed depth, not a change to the object.
  // Total tunnel depth stays constant (±485px) regardless of how many
  // frames COMBINED_TRACK has — the per-step gap shrinks as DENSE_SUBSTEPS
  // rises so raising it for smoother motion doesn't also stretch the object
  // absurdly deep.
  const TOTAL_DEPTH_RANGE = 970;
  const STACK_SLICE_GAP = TOTAL_DEPTH_RANGE / (COMBINED_TRACK.length - 1);
  // Negative translateZ recedes away from the viewer (into the screen);
  // positive comes forward, toward the viewer. Life (idx 0) sits forward,
  // death (the last idx) recedes deepest — so sliding from life to death
  // reads as travelling INTO the object's depth, not out of it.
  const depthForIdx = (idx) => -(idx - (COMBINED_TRACK.length - 1) / 2) * STACK_SLICE_GAP;
  // A real worm isn't a rigid straight rod — it wanders side to side as it
  // recedes. Two out-of-phase sine waves (X and Y, different frequencies)
  // curve the whole depth axis into an S-like meander instead of a straight
  // tube, without changing its total length (depthForIdx is untouched).
  const CURVE_CYCLES_X = 1.6;
  const CURVE_CYCLES_Y = 1.05;
  const CURVE_AMP_X = 170;
  const CURVE_AMP_Y = 110;
  const curveForIdx = (idx) => {
    const t = idx / (COMBINED_TRACK.length - 1);
    return {
      x: Math.sin(t * Math.PI * CURVE_CYCLES_X) * CURVE_AMP_X,
      y: Math.cos(t * Math.PI * CURVE_CYCLES_Y) * CURVE_AMP_Y,
    };
  };
  // Every moving piece — slices, the observation plate, the orbit rings —
  // shares this one function so they all bend along the exact same path.
  const transformForIdx = (idx, extraZ = 0) => {
    const { x, y } = curveForIdx(idx);
    return `translateX(${x}px) translateY(${y}px) translateZ(${depthForIdx(idx) + extraZ}px)`;
  };

  // The rendered/actual position — eased (see the RAF loop above), not the
  // raw slider target — so depth motion always reads as continuous.
  const onticIdx = Math.max(0, Math.min(COMBINED_TRACK.length - 1, Math.round(animatedIdx)));
  const onticEntry = COMBINED_TRACK[onticIdx];
  let onticNearestStage = CARDIAC_ANNOTATIONS[0];
  CARDIAC_ANNOTATIONS.forEach(ann => {
    if (Math.abs(ann.d - onticEntry.d) < Math.abs(onticNearestStage.d - onticEntry.d)) onticNearestStage = ann;
  });

  // COMBINED_TRACK stays dense (642 frames) so the plate can land on any of
  // them one at a time — but rendering all of them simultaneously in the
  // full (unisolated) view is far more DOM than a phone/tablet GPU can
  // composite smoothly (each frame is ~30 elements incl. an SVG and
  // per-slice 3D transform). The full view instead samples a FIXED budget
  // of frames spread evenly across the whole track. This set must stay
  // stable across renders while animatedIdx is easing/healing — forcing the
  // exact onticIdx into it every frame (as this used to do) meant a brand
  // new DOM node got mounted and unmounted on almost every tick as the
  // position swept past each un-sampled index, which is exactly what
  // caused the item dots to flicker while the plate moved. Instead, the
  // "current" highlight is just whichever already-sampled slice is
  // nearest — same stable set of DOM nodes throughout, only the isCurrent
  // flag moves between them.
  const FULL_VIEW_BUDGET = 40;
  const fullViewStride = Math.max(1, Math.ceil(COMBINED_TRACK.length / FULL_VIEW_BUDGET));
  const fullViewIdxSet = new Set();
  for (let j = 0; j < COMBINED_TRACK.length; j += fullViewStride) fullViewIdxSet.add(j);
  let nearestSampledIdx = 0, nearestSampledDist = Infinity;
  fullViewIdxSet.forEach(j => {
    const dist = Math.abs(j - onticIdx);
    if (dist < nearestSampledDist) { nearestSampledDist = dist; nearestSampledIdx = j; }
  });
  // Clamped so the cutaway can only clear slices strictly in front of the
  // plate — it stops the moment it reaches the plate's own slice, never
  // eating into the plate or anything beyond it.
  const effectiveCutaway = Math.min(cutawayIdx, plateIdx);
  const fullViewIndices = Array.from(fullViewIdxSet)
    .filter(j => j >= effectiveCutaway)
    .sort((a, b) => a - b);

  const renderSlice = (identity, color, sliceKey, track, idx, isCurrent) => {
    const positions = MCTOSHS_ORBITS.map((orb, i) => {
      const rad = identity[i] - Math.PI / 2;
      return { x: 450 + Math.cos(rad) * orb.r, y: 450 + Math.sin(rad) * orb.r };
    });
    return (
      <div
        key={sliceKey}
        className={`identity_slice${isCurrent ? " identity_slice--current" : ""}${track === "recovery" ? " identity_slice--recovery" : ""}`}
        style={{ transform: transformForIdx(idx), "--slice-color": color }}
      >
        {/* The Patient Reality border, repeated at this slice's own depth —
            same idea as the item dots: one cross-section per Z layer, so
            the sphere's boundary reads as a 3D tube alongside the items
            instead of a single flat static ring out front. */}
        <div className="identity_shell_ring" aria-hidden="true" />
        <svg className="identity_rope_svg" viewBox="0 0 900 900" aria-hidden="true">
          {positions.slice(0, -1).map((p, i) => (
            <line
              key={i} x1={p.x} y1={p.y} x2={positions[i + 1].x} y2={positions[i + 1].y}
              stroke={MCTOSHS_ORBITS[i].color} strokeWidth="1.2" strokeDasharray="4 5" opacity="0.55"
            />
          ))}
        </svg>
        {MCTOSHS_ORBITS.map((orb, i) => {
          const cssDeg = identity[i] * (180 / Math.PI) - 90;
          return (
            <div key={orb.id} className="bio_particle" style={{ "--orb-color": orb.color, transform: `rotate(${cssDeg}deg) translateX(${orb.r}px)` }}>
              <div className="orb_dot" style={{ transform: `rotate(${-cssDeg}deg)` }}>
                <span className="orb_dot_letter">{orb.letter}</span>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div id="login_page">

      {/* ── LEFT: 2D Orbital Animation ── */}
      <div id="login_anim_panel" className={panelHidden ? "login_panel_expanded" : ""}>
        <div id="login_brand">
          <div id="login_sigil"><span>M</span></div>
          <div id="login_brand_text">
            <h1 id="login_wordmark">MCTOSHS | CVS</h1>
            <p id="login_platform_label">Cardiovascular Clinical Intelligence Platform</p>
          </div>
        </div>

        <div id="login_stage_wrap" ref={wrapRef}
          onPointerDown={handleWrapPointerDown}
          onPointerMove={handleStagePointerMove}
          onPointerUp={handleStagePointerUp}
          onPointerCancel={handleStagePointerUp}
        >
          {/* Object details — outside #login_stage so it never rotates with
              the object, always readable: how many 2D slices make up the
              whole thing, and which one is ontic (actually the case) now. */}
          <div id="object_info">
            <div className="object_info_row">
              <span className="object_info_label">Slices</span>
              <span className="object_info_value">{COMBINED_TRACK.length}</span>
            </div>
            <div className="object_info_row">
              <span className="object_info_label">Ontic now</span>
              <span className="object_info_value">
                #{onticIdx + 1} / {COMBINED_TRACK.length}
                <span className="object_info_sub">
                  {" "}· {(onticEntry.d / 0.20 * 100).toFixed(1)}% · {onticEntry.track === "onset" ? "sickening" : "healing"} · near {onticNearestStage.abbr}
                </span>
              </span>
            </div>
          </div>

          {/* Labels card — MCTOSHS / Patient Reality naming and the item
              legend, pulled out of the rotating object (where they used to
              live as floating labels that curved/tilted along with
              everything else and were hard to read) into one flat,
              always-legible panel. */}
          <div id="labels_card">
            <div id="labels_card_head">
              <span id="labels_card_mctoshs">MCTOSHS</span>
              <span id="labels_card_pr">Patient Reality</span>
            </div>
            <ul id="labels_card_list">
              {MCTOSHS_ORBITS.map(orb => (
                <li key={orb.id} style={{ "--orb-color": orb.color }}>
                  <span className="labels_card_dot" />
                  <span className="labels_card_name">{SCHEMA_NAMES[orb.letter]}</span>
                  <span className="labels_card_letter">({orb.letter})</span>
                </li>
              ))}
            </ul>
          </div>

          <div
            id="login_stage"
            className={rotateDragRef.current.active ? "login_stage--dragging" : ""}
            style={{ transform: `scale(${stageScale}) rotateX(${rotation.x}deg) rotateY(${rotation.y}deg)` }}
          >

            {/* Spheres + zone labels on PR sphere — the purple-bordered
                Patient Reality boundary tracks the ontic slice's own depth,
                same as every other slice, instead of sitting frozen at the
                front while the slider moves everything else. */}
            {/* Nudged 2px behind the exact matching slice (not equal Z) so
                the now-opaque plate never wins a same-depth tie against the
                ontic slice's own dots — those must stay visible on top of
                the plate, not hidden behind an opaque disc. */}
            <div id="login_center" style={{ transform: `translate(-50%, -50%) ${transformForIdx(onticIdx, -2)}` }}>
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
            </div>

            {/* Soft orbit path rings — always full size */}
            {/* Orbit rings track the ontic slice's depth too, same as the
                PR sphere — the whole reference frame moves with the slider,
                not just the identity dots themselves. */}
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
                  transform:  transformForIdx(onticIdx),
                }}
              />
            ))}

            {/* ── The whole object: every identity, always present, always
                the same shape. The travel slider never touches this — it
                only moves the observation plate (PR sphere + orbit rings,
                above) through depthForIdx. Only a direct drag on the stage
                rotates the object itself. */}
            <div id="identity_stack">
              {fullViewIndices.map(j => renderSlice(
                COMBINED_TRACK[j].angles, COMBINED_TRACK[j].color, j, COMBINED_TRACK[j].track,
                j,
                j === nearestSampledIdx
              ))}
            </div>

          </div>

          {/* ── Travel slider — flat 2D, sits below the object entirely so
              it never overlaps or disrupts the 3D view. Dragging it moves
              the observation plate through the object's depth; it doesn't
              touch the object's rotation or shape at all. stopPropagation
              here keeps the stage's rotate-drag handler (bound to the wrap,
              above) from firing when the user is just touching the slider. */}
          <div id="travel_slider_wrap" onPointerDown={e => e.stopPropagation()}>
            <input
              id="travel_slider"
              type="range"
              min={0}
              max={COMBINED_TRACK.length - 1}
              step={1}
              value={plateIdx}
              onChange={e => setPlate(Number(e.target.value))}
              style={{ "--slider-fill": `${(plateIdx / (COMBINED_TRACK.length - 1)) * 100}%` }}
            />
            <span className="slider_label">
              {onticEntry.track === "onset" ? "sickening" : "healing"} · {(onticEntry.d / 0.20 * 100).toFixed(0)}%
            </span>
          </div>

          {/* ── Cutaway slider — clears away slices in front of the plate
              (closer to the viewer, life-ward of it) so you can see straight
              down to wherever the plate currently sits without a crowded
              near field in the way. Its own range is capped at plateIdx: it
              physically cannot drag past the plate's slice. */}
          <div id="cutaway_slider_wrap" onPointerDown={e => e.stopPropagation()}>
            <input
              id="cutaway_slider"
              type="range"
              min={0}
              max={plateIdx}
              step={1}
              value={effectiveCutaway}
              onChange={e => setCutawayIdx(Number(e.target.value))}
              disabled={plateIdx === 0}
              style={{ "--slider-fill": plateIdx === 0 ? "0%" : `${(effectiveCutaway / plateIdx) * 100}%` }}
            />
            <span className="slider_label">
              clear front · {effectiveCutaway} / {plateIdx}
            </span>
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
            <button
              id="ds_stack_toggle"
              onClick={() => setRotation({ x: -20, y: -30 })}
              title="Recenter the view"
            >
              <i className="fi fi-rr-refresh" />
              Recenter
            </button>
            <button id="ds_collapse_btn" onClick={() => setSelectorCollapsed(v => !v)}
              title={selectorCollapsed ? "Expand" : "Collapse"}>
              <i className={`fi ${selectorCollapsed ? "fi-rr-angle-up" : "fi-rr-angle-down"}`} />
            </button>
          </div>
          <div id="ds_list" className={selectorCollapsed ? "ds_list--hidden" : ""}>
            {CARDIAC_ANNOTATIONS.map((ann, idx) => (
              <button
                key={idx}
                className={`ds_item${onticNearestStage.abbr === ann.abbr ? " ds_item--active" : ""}`}
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
