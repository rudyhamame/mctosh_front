import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
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
const DENSE_SUBSTEPS = 960;
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

const detectSafariIPad = () => {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const platform = navigator.platform || "";
  const isAppleTouchDevice =
    /iPad/.test(ua) ||
    (platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isSafari =
    /Safari/i.test(ua) &&
    !/Chrome|CriOS|EdgiOS|Edg|FxiOS|Firefox/i.test(ua);
  return isAppleTouchDevice && isSafari;
};

// ── Legacy 2D stage — the original live spring-physics simulation, kept
// standalone so it can be viewed side by side with the 3D discrete-identity
// object above. Unlike the 3D object (a stack of precomputed frames you
// travel through), this is a genuine continuous RAF simulation: M springs
// toward a disease target set by dragging the arc, C/T/O/OS/H/S cascade to
// compensate (each rope-tethered deeper than the orbit it protects via
// DEPTH_GROWTH), and — left alone long enough after settling — the whole
// system heals itself back toward optimum physiology on its own.
const LegacyPhysicsStage = React.forwardRef(function LegacyPhysicsStage({ onInfoChange, onDiseaseChange }, ref) {
  const wrapRef          = useRef(null);
  // Pointer math (arc drag, M drag) is measured against #legacy_stage
  // itself — the actual 900x900 scaled box — not the flex wrap around it.
  // Relying on the wrap's own rect assumed flex-centering of an oversized,
  // transformed child was always pixel-perfect; measuring the real box
  // directly is unambiguous regardless of aspect-ratio mismatches between
  // the wrap and the stage.
  const stageElRef       = useRef(null);
  const dotElsRef        = useRef(new Array(MCTOSHS_ORBITS.length).fill(null));
  const ropeCanvasRef    = useRef(null);
  const orbStateRef      = useRef(MCTOSHS_ORBITS.map(() => ({ angle: 0, omega: 0 })));
  const diseaseRef       = useRef(0);
  const [diseaseLevel, setDiseaseLevel] = useState(0);
  const mDraggingRef     = useRef(false);
  const arcDraggingRef   = useRef(false);
  const settledStreakRef = useRef(0);
  const physicsParams    = useRef({ ...PHYS_DEFAULTS });
  const [activeStageIdx, setActiveStageIdx] = useState(0);
  const activeStageIdxRef = useRef(0);

  // Unified 60fps loop: disease physics + homeostasis cascade + rope + stage display
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

      // Healing: once every orbit has genuinely settled (not just for one
      // frame — selectStage zeroes every omega instantly, which would
      // otherwise look "settled" before real motion even starts) and
      // nothing is actively dragging, the disease level decays back toward
      // zero on its own.
      const SETTLE_OMEGA = 0.05;
      let allSettled = true;
      for (let k = 0; k < N; k++) {
        if (Math.abs(orbStateRef.current[k].omega) >= SETTLE_OMEGA) { allSettled = false; break; }
      }
      settledStreakRef.current = allSettled ? settledStreakRef.current + 1 : 0;
      const trulySettled = settledStreakRef.current > 30;
      if (!mDraggingRef.current && !arcDraggingRef.current && trulySettled && s0.angle < DEATH_THRESH && diseaseRef.current > 0) {
        const HEAL_RATE = 0.15; // /s
        const next = diseaseRef.current * Math.max(0, 1 - HEAL_RATE * dt);
        diseaseRef.current = next < 0.0005 ? 0 : next;
        setDiseaseLevel(diseaseRef.current);
      }

      // M: springs toward the disease-driven target, overwhelming any
      // compensatory pushback (K_DISEASE dominates), overdamped so it
      // approaches smoothly without oscillating.
      if (!mDraggingRef.current) {
        const TARGET_ANG = (diseaseRef.current / 0.20) * Math.PI;
        const K_DISEASE  = 28.0;
        const DMP_M      = 14.0;
        const alphaM = K_DISEASE * (TARGET_ANG - s0.angle);
        s0.omega += (alphaM - DMP_M * s0.omega) * dt;
        s0.angle += s0.omega * dt;
        if (s0.angle > Math.PI)      { s0.angle = Math.PI; s0.omega = 0; }
        if (s0.angle < -Math.PI / 2) { s0.angle = -Math.PI / 2; s0.omega = 0; }
      }

      const mAng   = s0.angle;
      const isDead = mAng >= DEATH_THRESH;

      const currentD    = (Math.max(0, mAng) / Math.PI) * 0.20;
      const dynStageIdx = CARDIAC_ANNOTATIONS.reduce((best, ann, idx) => currentD >= ann.d ? idx : best, 0);
      const dynEngaged  = CARDIAC_ANNOTATIONS[dynStageIdx].engaged;

      const pp      = physicsParams.current;
      const K_SP    = pp.kSp;
      const DMP_ORB = pp.dmpOrb;

      // C: always compensates CCW against M's pathological pressure.
      {
        const sc            = orbStateRef.current[1];
        const mPathological = Math.max(0, mAng);
        const targetC       = -Math.min(mPathological, PHYSIO_LIMIT) * pp.cMirrorRatio;
        const mOverload     = Math.max(0, mPathological - pp.compResilience);
        const alpha_c = isDead
          ? 3.0 * (-Math.PI - sc.angle) - DMP_ORB * 3.5 * sc.omega
          : K_SP * 1.7 * (targetC - sc.angle) - DMP_ORB * 1.1 * sc.omega - pp.pressureCoeff * mOverload;
        sc.omega += alpha_c * dt;
        sc.angle += sc.omega * dt;
        if (sc.angle > 0)        { sc.angle = 0;        sc.omega = 0; }
        if (sc.angle < -Math.PI) { sc.angle = -Math.PI; sc.omega = 0; }
      }

      // T, O, OS, H, S: engaged orbits compensate deeper than the orbit
      // they protect (DEPTH_GROWTH), tracking the outer orbit's REAL-TIME
      // angle (not a lagged average) so each inner orbit is always pinned
      // to stay proportionally deeper than its outer neighbor — this is
      // what guarantees C leads recovery, T follows, and so on inward,
      // since an inner orbit's target can only reach 0 once its outer
      // neighbor's actual angle already has.
      for (let i = 2; i < N; i++) {
        const s         = orbStateRef.current[i];
        const outer     = orbStateRef.current[i - 1];
        const prevAng   = outer.angle;
        const orbId     = MCTOSHS_ORBITS[i].letter;
        const isEngaged = dynEngaged.includes(orbId);
        const orb_k     = K_SP    * CASCADE_K_FACTORS[i - 2];
        const orb_dmp   = DMP_ORB * CASCADE_DMP_FACTORS[i - 2] * 2.1;
        let alpha       = -orb_dmp * s.omega;

        if (isDead) {
          alpha += 3.0 * (-Math.PI - s.angle);
        } else if (!isEngaged) {
          alpha += orb_k * (0 - s.angle);
        } else {
          const ropeTgt = prevAng * DEPTH_GROWTH;
          alpha += orb_k * (ropeTgt - s.angle);
          const ccw_overload = Math.max(0, -prevAng - PHYSIO_LIMIT);
          alpha -= pp.breakdownForce * ccw_overload;
        }

        s.omega += alpha * dt;
        s.angle += s.omega * dt;
        if (s.angle >  0)       { s.angle =  0;       s.omega = 0; }
        if (s.angle < -Math.PI) { s.angle = -Math.PI; s.omega = 0; }
      }

      // Death-guard rope constraint — belt-and-suspenders so no orbit ever
      // gets more than a generous slack further toward death than the
      // orbit holding its rope, applied innermost-out.
      {
        const DEATH_GUARD_SLACK = Math.PI * 0.55;
        for (let i = N - 2; i >= 1; i--) {
          const s     = orbStateRef.current[i];
          const inner = orbStateRef.current[i + 1];
          const floor = inner.angle - DEATH_GUARD_SLACK;
          if (s.angle < floor) { s.angle = floor; if (s.omega < 0) s.omega = 0; }
        }
      }

      // Render dots directly via DOM (no React re-render per frame).
      MCTOSHS_ORBITS.forEach((orb, i) => {
        const s  = orbStateRef.current[i];
        const el = dotElsRef.current[i];
        if (!el) return;
        const cssDeg = s.angle * (180 / Math.PI) - 90;
        const rad    = s.angle - Math.PI / 2;
        el.style.transform = `rotate(${cssDeg}deg) translateX(${orb.r}px)`;
        const dotEl = el.firstElementChild;
        if (dotEl) dotEl.style.transform = `rotate(${-cssDeg}deg)`;
        s._x = 450 + Math.cos(rad) * orb.r;
        s._y = 450 + Math.sin(rad) * orb.r;
      });

      // Which canonical stage M's actual position currently reads as —
      // reported to the parent (via the onInfoChange effect below) instead
      // of writing into the DOM directly, since the display now lives in
      // the shared footer, not floating over the stage itself.
      {
        const mD = Math.max(0, s0.angle / Math.PI) * 0.20;
        let annIdx = 0;
        for (let ai = CARDIAC_ANNOTATIONS.length - 1; ai >= 0; ai--) {
          if (mD >= CARDIAC_ANNOTATIONS[ai].d) { annIdx = ai; break; }
        }
        if (annIdx !== activeStageIdxRef.current) {
          activeStageIdxRef.current = annIdx;
          setActiveStageIdx(annIdx);
        }
      }

      // Ropes.
      const ropeCanvas = ropeCanvasRef.current;
      if (ropeCanvas) {
        const ctx = ropeCanvas.getContext('2d');
        ctx.clearRect(0, 0, 900, 900);
        for (let i = 0; i < N - 1; i++) {
          const a = orbStateRef.current[i];
          const b = orbStateRef.current[i + 1];
          ctx.beginPath();
          ctx.moveTo(a._x, a._y);
          ctx.lineTo(b._x, b._y);
          ctx.strokeStyle = MCTOSHS_ORBITS[i].color + '55';
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

  const handleMDotPointerDown = (e) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    mDraggingRef.current = true;
    orbStateRef.current[0].omega = 0;
  };

  const handleStagePointerMove = (e) => {
    if (!mDraggingRef.current) return;
    const stageEl = stageElRef.current;
    if (!stageEl) return;
    const rect = stageEl.getBoundingClientRect();
    const dx = e.clientX - (rect.left + rect.width  / 2);
    const dy = e.clientY - (rect.top  + rect.height / 2);
    if (Math.sqrt(dx * dx + dy * dy) < 5) return;
    const s0 = orbStateRef.current[0];
    s0.angle = Math.atan2(dy, dx) + Math.PI / 2;
    s0.omega = 0;
  };

  const handleStagePointerUp = () => { mDraggingRef.current = false; };

  const updateDiseaseFromPointer = (e) => {
    const stageEl = stageElRef.current;
    if (!stageEl) return;
    const rect = stageEl.getBoundingClientRect();
    const dx = e.clientX - (rect.left + rect.width  / 2);
    const dy = e.clientY - (rect.top  + rect.height / 2);
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
  const handleArcPointerMove = (e) => { if (arcDraggingRef.current) updateDiseaseFromPointer(e); };
  const handleArcPointerUp   = () => { arcDraggingRef.current = false; };

  const selectStage = (idx) => {
    const ann = CARDIAC_ANNOTATIONS[idx];
    diseaseRef.current = ann.d;
    setDiseaseLevel(ann.d);
    physicsParams.current = { ...PHYS_DEFAULTS, ...ann.config };
    activeStageIdxRef.current = idx;
    setActiveStageIdx(idx);
    orbStateRef.current.forEach(s => { s.omega = 0; });
    settledStreakRef.current = 0;
  };

  // Lets the parent trigger a stage selection from the shared footer's
  // stage-list buttons, which live outside this component now.
  useImperativeHandle(ref, () => ({ selectStage }));

  // Reports this stage's current status up so the parent can render it in
  // the shared footer instead of it floating over the stage itself, and so
  // the 2D arc can drive the 3D object's observation plate in sync.
  useEffect(() => {
    onInfoChange?.({ stageIdx: activeStageIdx, diseaseLevel });
  }, [activeStageIdx, diseaseLevel, onInfoChange]);
  useEffect(() => {
    onDiseaseChange?.(diseaseLevel);
  }, [diseaseLevel, onDiseaseChange]);

  const t      = diseaseLevel / 0.20;
  const ARC_R  = 390;
  const ang    = t * Math.PI - Math.PI / 2;
  const dotX   = 450 + ARC_R * Math.cos(ang);
  const dotY   = 450 + ARC_R * Math.sin(ang);
  const dr     = Math.round(255 * t);
  const dg     = Math.round(220 * (1 - t));
  const dotCol  = `rgba(${dr},${dg},70,0.95)`;
  const glowCol = `rgba(${dr},${dg},70,0.30)`;
  const trackD  = `M 450 ${450 - ARC_R} A ${ARC_R} ${ARC_R} 0 0 1 450 ${450 + ARC_R}`;

  return (
    <div id="legacy_stage_wrap" ref={wrapRef}
      onPointerMove={handleStagePointerMove}
      onPointerUp={handleStagePointerUp}
      onPointerCancel={handleStagePointerUp}
    >
      <div id="legacy_stage" ref={stageElRef}>
        <div id="legacy_center">
          <div id="legacy_pr_sphere" />
          <div id="legacy_mctosh_sphere" />
        </div>

        {MCTOSHS_ORBITS.map(orb => (
          <div
            key={`legacy-ring-${orb.id}`}
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

        <canvas
          ref={ropeCanvasRef}
          width={900} height={900}
          style={{ position: 'absolute', top: 0, left: 0, width: '900px', height: '900px', pointerEvents: 'none', zIndex: 7 }}
        />

        <svg viewBox="0 0 900 900" style={{ position: 'absolute', top: 0, left: 0, width: '900px', height: '900px', overflow: 'visible', pointerEvents: 'none', zIndex: 9 }}>
          <path d={trackD} fill="none" stroke="rgba(170,170,210,0.55)" strokeWidth="1.5" strokeDasharray="5 8" strokeLinecap="round" opacity="0.7" />
          <path d={trackD} fill="none" stroke="transparent" strokeWidth="44"
            pointerEvents="stroke" style={{ cursor: 'ns-resize' }}
            onPointerDown={handleArcPointerDown} onPointerMove={handleArcPointerMove}
            onPointerUp={handleArcPointerUp} onPointerCancel={handleArcPointerUp}
          />
          <circle cx={dotX} cy={dotY} r="14" fill="none" stroke={glowCol} strokeWidth="8" style={{ pointerEvents: 'none' }} />
          <circle cx={dotX} cy={dotY} r="5.5" fill={dotCol} stroke="rgba(255,255,255,0.65)" strokeWidth="1.5" style={{ pointerEvents: 'none' }} />
        </svg>

        {MCTOSHS_ORBITS.map((orb, i) => (
          <div
            key={orb.id}
            ref={el => { dotElsRef.current[i] = el; }}
            className="bio_particle"
            style={{ "--orb-color": orb.color, opacity: 1, ...(i === 0 ? { cursor: 'grab', touchAction: 'none' } : {}) }}
            onPointerDown={i === 0 ? handleMDotPointerDown : undefined}
          >
            <div className="orb_dot"><span className="orb_dot_letter">{orb.letter}</span></div>
          </div>
        ))}
      </div>
    </div>
  );
});

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
  const [isSafariIPad] = useState(detectSafariIPad);
  // Touch-primary devices (phones/tablets) get a much lower 3D slice render
  // budget below — iOS/iPadOS Safari's compositor has a far smaller memory
  // ceiling than desktop and crashes the tab under a high one.
  const [isCoarsePointer] = useState(() =>
    typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches
  );

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

  // The legacy 2D stage's own status, reported up so the shared footer can
  // display it and so its stage-list buttons (also in the footer) can
  // trigger a selection back down via legacyStageRef.
  const legacyStageRef = useRef(null);
  const [legacyInfo, setLegacyInfo] = useState({ stageIdx: 0, diseaseLevel: 0 });
  // Cross-link: dragging the 2D arc (or picking a 2D stage) moves the 3D
  // object's observation plate to the matching depth simultaneously, so
  // the two views always agree on "where" the patient currently is. Which
  // HALF of COMBINED_TRACK it lands on matters too — DENSE_ONSET and
  // DENSE_RECOVERY hold different per-orbit angles at the same disease
  // level (recovery lags C→T→O→OS→H→S, same as the live 2D physics now
  // does), so whether disease level is rising (onset) or falling
  // (recovery/healing) in the 2D sim decides which track the 3D slice
  // comes from — inferred from the sign of the change since onDiseaseChange
  // only reports the level, not the direction it's moving.
  // Memoized so the child's effect (keyed on this callback's identity)
  // doesn't re-fire on every unrelated parent re-render — setPlate only
  // ever touches refs + a stable state setter, so a stale closure over it
  // is safe here.
  const legacyDirRef  = useRef("onset");
  const legacyPrevDRef = useRef(0);
  const handleLegacyDiseaseChange = useCallback((d) => {
    const prev = legacyPrevDRef.current;
    if (d > prev + 1e-6)      legacyDirRef.current = "onset";
    else if (d < prev - 1e-6) legacyDirRef.current = "recovery";
    legacyPrevDRef.current = d;

    const frac = d / 0.20;
    if (legacyDirRef.current === "recovery") {
      setPlate(DENSE_ONSET.length + Math.round(frac * (DENSE_RECOVERY.length - 1)));
    } else {
      setPlate(Math.round(frac * (DENSE_ONSET.length - 1)));
    }
  }, []);

  // cutawayIdx: hides slices strictly in front of the plate (idx <
  // cutawayIdx, i.e. life-ward along the loop) so you can see past a
  // crowded near field straight down to
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

      // Decay toward the healthy end of whichever HALF of COMBINED_TRACK
      // the plate is currently sitting in, not toward absolute index 0 —
      // sitting in the recovery half (idx >= DENSE_ONSET.length), its own
      // "fully healed" point is DENSE_ONSET.length, not 0, otherwise idle
      // decay would blindly cross back into unrelated onset frames.
      const trackStart = plateIdxRef.current >= DENSE_ONSET.length ? DENSE_ONSET.length : 0;
      const rel = plateIdxRef.current - trackStart;
      if (Date.now() - lastInteractionRef.current > HEAL_DELAY_MS && rel > 0) {
        const nextRel = rel * Math.max(0, 1 - HEAL_RATE * dt);
        const settled = trackStart + (nextRel < 0.5 ? 0 : nextRel);
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
      const fitSize = height > 0 ? Math.min(width, height) : width;
      baseScaleRef.current = fitSize / STAGE;
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
  // (PR sphere + orbit rings) to a depth along this line — a marker plane
  // scanning through the object, not a change to the object.
  // Total tunnel depth stays constant regardless of how many frames
  // COMBINED_TRACK has — the per-step gap shrinks as DENSE_SUBSTEPS rises
  // so raising it for smoother motion doesn't also stretch the object
  // absurdly deep.
  const TOTAL_DEPTH_RANGE = 970;
  const STACK_SLICE_GAP = TOTAL_DEPTH_RANGE / (COMBINED_TRACK.length - 1);
  // Negative translateZ recedes away from the viewer (into the screen);
  // positive comes forward, toward the viewer. Life (idx 0) sits forward,
  // death (the last idx) recedes deepest — so sliding from life to death
  // reads as travelling INTO the object's depth, not out of it.
  const depthForIdx = (idx) => -(idx - (COMBINED_TRACK.length - 1) / 2) * STACK_SLICE_GAP;
  // Every moving piece — slices, the observation plate, the orbit rings —
  // shares this one function so they all sit on the exact same straight axis.
  const transformForIdx = (idx, extraZ = 0) => `translateZ(${depthForIdx(idx) + extraZ}px)`;

  // The rendered/actual position — eased (see the RAF loop above), not the
  // raw slider target — so depth motion always reads as continuous. Keep the
  // exact fractional position for transforms, and only quantize when we need
  // to label/report which canonical slice we're nearest to.
  const animatedDepthIdx = Math.max(0, Math.min(COMBINED_TRACK.length - 1, animatedIdx));
  const lowerAnimatedIdx = Math.floor(animatedDepthIdx);
  const upperAnimatedIdx = Math.min(COMBINED_TRACK.length - 1, lowerAnimatedIdx + 1);
  const animatedMix = animatedDepthIdx - lowerAnimatedIdx;
  const lowerEntry = COMBINED_TRACK[lowerAnimatedIdx];
  const upperEntry = COMBINED_TRACK[upperAnimatedIdx];
  const animatedEntry = {
    angles: lowerEntry.angles.map((angle, i) => angle + (upperEntry.angles[i] - angle) * animatedMix),
    d: lowerEntry.d + (upperEntry.d - lowerEntry.d) * animatedMix,
    color: animatedMix < 0.5 ? lowerEntry.color : upperEntry.color,
    track: animatedMix < 0.5 ? lowerEntry.track : upperEntry.track,
  };
  const onticIdx = Math.max(0, Math.min(COMBINED_TRACK.length - 1, Math.round(animatedDepthIdx)));
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
  // Each rendered slice is now just one ring div (see renderRing/renderItems
  // above — the heavy item dots + rope SVG are a single shared instance, not
  // duplicated per slice), so the budget mainly costs one composited layer
  // per slice rather than ~16. Desktop GPUs handle a high budget fine, but
  // iOS/iPadOS Safari has a much smaller compositor memory ceiling and can
  // still crash the tab ("A Problem Repeatedly Occurred") under enough
  // simultaneous 3D layers — coarse-pointer devices still get a lower
  // budget to stay safe, just a less punishing one than before.
  const FULL_VIEW_BUDGET = isSafariIPad ? 36 : (isCoarsePointer ? 120 : 1000);
  // Clamped so the cutaway can only clear slices strictly in front of the
  // plate — it stops the moment it reaches the plate's own slice, never
  // eating into the plate or anything beyond it.
  const effectiveCutaway = Math.min(cutawayIdx, plateIdx);
  // Expensive at this budget (Set build + sort over ~1000 entries) and only
  // actually depends on the budget/cutaway, neither of which changes on a
  // RAF tick — but this component re-renders on every animatedIdx tick
  // while the plate eases, ~60x/s. Rebuilding this on every one of those
  // renders (as a plain const used to) was slow enough to choke the easing
  // loop into never visibly progressing once the budget went from 180 to
  // 1000 — the same class of bug fixed earlier for the cord feature.
  // Memoized so it only rebuilds when the budget or cutaway actually change.
  const fullViewIndices = useMemo(() => {
    const stride = Math.max(1, Math.ceil(COMBINED_TRACK.length / FULL_VIEW_BUDGET));
    const idxs = [];
    for (let j = 0; j < COMBINED_TRACK.length; j += stride) {
      if (j >= effectiveCutaway) idxs.push(j);
    }
    return idxs;
  }, [FULL_VIEW_BUDGET, effectiveCutaway]);
  // Cheap per-tick work: a linear scan over the memoized (already sorted,
  // already-filtered) array to find whichever sampled slice onticIdx is
  // nearest to right now — only the stable ring stack uses this sampled
  // notion. The moving observation plate/items use animatedDepthIdx above.
  let nearestSampledIdx = fullViewIndices[0] ?? 0, nearestSampledDist = Infinity;
  for (const j of fullViewIndices) {
    const dist = Math.abs(j - onticIdx);
    if (dist < nearestSampledDist) { nearestSampledDist = dist; nearestSampledIdx = j; }
  }

  // Ring-only slice — just the Patient Reality border cross-section at this
  // slice's own depth, repeated up to FULL_VIEW_BUDGET times to build the
  // tunnel. Deliberately the ONLY thing duplicated per slice: no rope SVG,
  // no item dots — those are heavy (an SVG + 7 nested divs each) and
  // duplicating them across up to 1000 slices is what made the object
  // unusable, without actually being needed at every depth simultaneously.
  const renderRing = (color, sliceKey, track, idx, isCurrent) => (
    <div
      key={sliceKey}
      className={`identity_slice${isCurrent ? " identity_slice--current" : ""}${track === "recovery" ? " identity_slice--recovery" : ""}`}
      style={{ transform: transformForIdx(idx), "--slice-color": color }}
    >
      <div className="identity_shell_ring" aria-hidden="true" />
    </div>
  );

  // The item dots + connecting rope: ONE shared instance, not duplicated
  // per slice. It follows the exact eased plate position continuously, so
  // travelling through depth reads as one smooth motion instead of hopping
  // between sampled slices.
  const renderItems = (entry, idx) => {
    const positions = MCTOSHS_ORBITS.map((orb, i) => {
      const rad = entry.angles[i] - Math.PI / 2;
      return { x: 450 + Math.cos(rad) * orb.r, y: 450 + Math.sin(rad) * orb.r };
    });
    return (
      <div
        className={`identity_items${entry.track === "recovery" ? " identity_items--recovery" : ""}`}
        style={{ transform: transformForIdx(idx), "--slice-color": entry.color }}
      >
        <svg className="identity_rope_svg" viewBox="0 0 900 900" aria-hidden="true">
          {positions.slice(0, -1).map((p, i) => (
            <line
              key={i} x1={p.x} y1={p.y} x2={positions[i + 1].x} y2={positions[i + 1].y}
              stroke={MCTOSHS_ORBITS[i].color} strokeWidth="1.2" strokeDasharray="4 5" opacity="0.55"
            />
          ))}
        </svg>
        {MCTOSHS_ORBITS.map((orb, i) => {
          const cssDeg = entry.angles[i] * (180 / Math.PI) - 90;
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

        {/* ── Dual view: the 3D discrete-identity object next to the
            original 2D live-physics stage, side by side for comparison. ── */}
        <div id="dual_stage_row" className={isSafariIPad ? "dual_stage_row--single" : ""}>
        <div id="login_stage_wrap" ref={wrapRef}
          onPointerDown={handleWrapPointerDown}
          onPointerMove={handleStagePointerMove}
          onPointerUp={handleStagePointerUp}
          onPointerCancel={handleStagePointerUp}
        >
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
            <div id="login_center" style={{ transform: `translate(-50%, -50%) ${transformForIdx(animatedDepthIdx, -2)}` }}>
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
                className="orb_ring observation_ring"
                style={{
                  "--orb-color": orb.color,
                  width:      `${orb.r * 2}px`,
                  height:     `${orb.r * 2}px`,
                  marginTop:  `-${orb.r}px`,
                  marginLeft: `-${orb.r}px`,
                  transform:  transformForIdx(animatedDepthIdx),
                }}
              />
            ))}

            {/* ── The whole object: every identity, always present, always
                the same shape. The travel slider never touches this — it
                only moves the observation plate (PR sphere + orbit rings,
                above) through depthForIdx. Only a direct drag on the stage
                rotates the object itself. */}
            <div id="identity_stack">
              {fullViewIndices.map(j => renderRing(
                COMBINED_TRACK[j].color, j, COMBINED_TRACK[j].track, j, j === nearestSampledIdx
              ))}
              {renderItems(animatedEntry, animatedDepthIdx)}
            </div>

          </div>
        </div>

        {!isSafariIPad && (
          <LegacyPhysicsStage ref={legacyStageRef} onInfoChange={setLegacyInfo} onDiseaseChange={handleLegacyDiseaseChange} />
        )}
        </div>

        {/* ── Shared footer — everything that used to float over the 3D and
            2D objects (labels, live status, sliders, the stage pickers)
            lives here now instead, in normal document flow below both
            stages, so nothing ever overlaps either view. Left column is the
            3D object's info/controls, right column is the 2D stage's. ── */}
        <div id="anim_footer">
          <div id="anim_footer_row" className={isSafariIPad ? "anim_footer_row--single" : ""}>
          <div id="anim_footer_3d">
            {/* ── Section title — what this column is about, and what's
                actually part of this particular object. ── */}
            <div className="footer_section_title">
              3D Object
              <span className="footer_section_sub">discrete identity stack · {COMBINED_TRACK.length} slices · rotate + travel slider</span>
            </div>

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

            {/* ── Travel slider — dragging it moves the observation plate
                through the object's depth; it doesn't touch the object's
                rotation or shape at all. */}
            <div id="travel_slider_wrap">
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
                (closer to the viewer, life-ward of it) so you can see
                straight down to wherever the plate currently sits without a
                crowded near field in the way. Capped at plateIdx: it
                physically cannot drag past the plate's slice. */}
            <div id="cutaway_slider_wrap">
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
          </div>

          {!isSafariIPad && (
          <div id="anim_footer_2d">
            <div className="footer_section_title">
              2D Object
              <span className="footer_section_sub">live spring physics · M→C→T→O→OS→H→S cascade · self-healing</span>
            </div>

            <div id="legacy_stage_display">
              <span className="dstage_abbr" style={{ color: CARDIAC_ANNOTATIONS[legacyInfo.stageIdx].color }}>
                {CARDIAC_ANNOTATIONS[legacyInfo.stageIdx].abbr}
              </span>
              <span className="dstage_desc">{CARDIAC_ANNOTATIONS[legacyInfo.stageIdx].desc}</span>
              <span className="object_info_sub">{(legacyInfo.diseaseLevel / 0.20 * 100).toFixed(0)}% disease level</span>
            </div>
            <div id="legacy_stage_list">
              {CARDIAC_ANNOTATIONS.map((ann, idx) => (
                <button
                  key={idx}
                  className={`ds_item${legacyInfo.stageIdx === idx ? " ds_item--active" : ""}`}
                  style={{ "--sc": ann.color }}
                  onClick={() => legacyStageRef.current?.selectStage(idx)}
                >
                  <span className="ds_dot" />
                  <span className="ds_abbr">{ann.abbr}</span>
                </button>
              ))}
            </div>
          </div>
          )}
          </div>

          {/* ── Items — shared by both objects (both are built from the same
              M/C/T/O/OS/H/S), so the legend lives once, below both columns,
              instead of living inside just one of them. ── */}
          <div id="anim_footer_items">
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
        </div>

        <p id="login_tagline">&ldquo;From representation to reality&rdquo;</p>


      </div>

      {/* ── Collapse toggle ── */}
      <button
        id="login_panel_toggle"
        className={panelHidden ? "login_panel_toggle--collapsed" : ""}
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
