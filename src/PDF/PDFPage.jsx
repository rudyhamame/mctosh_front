import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import AIProviderSelect from "../App/AIProviderSelect";
import { useAIProvider } from "../hooks/useAIProvider";
import * as pdfjsLib from "pdfjs-dist";
import "./pdfPage.css";
import { apiUrl } from "../config/api";
import { readStoredSession } from "../utils/sessionCleanup";
import { useLongPressSelect } from "../utils/longPressSelect";
import DraftTextViewer, { cleanMarkdownToPlainText } from "../components/DraftTextViewer";
import HyleCards from "./HyleCards";
import SystemMessageModal from "./SystemMessageModal";
import { drawAnnotation } from "./annotationDraw";

pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

const PDF_TYPE_LABEL = {
  "text-based": "Text-based",
  "mixed":      "Mixed",
  "scanned":    "Scanned",
};

const PDF_TYPE_ICON = {
  "text-based": "fi-rr-check-circle",
  "mixed":      "fi-rr-triangle-warning",
  "scanned":    "fi-rr-image",
};

const CARDS = [
  { key: "objects",   label: "Objects" },
  { key: "traces",    label: "Traces" },
  { key: "phenomena", label: "Phenomena" },
  { key: "concept",   label: "Concept" },
  { key: "models",    label: "Models" },
];

const HYLE_TYPE_TREE = [
  {
    key: "morpheme", label: "Morpheme",
    children: [
      {
        key: "morpheme.base", label: "Base",
        children: [
          { key: "morpheme.base.free",  label: "Free",  note: "simple word" },
          { key: "morpheme.base.bound", label: "Bound" },
        ],
      },
      {
        key: "morpheme.affix", label: "Affix",
        children: [
          { key: "morpheme.affix.prefix",      label: "Prefix" },
          { key: "morpheme.affix.connecting",  label: "Connecting vowel" },
          { key: "morpheme.affix.suffix",      label: "Suffix" },
        ],
      },
    ],
  },
  {
    key: "word", label: "Word",
    children: [
      { key: "word.compound", label: "Compound", note: "one or more morphemes" },
    ],
  },
  { key: "syntagm",  label: "Syntagm" },
  { key: "paradigm", label: "Paradigm" },
];

// Flat label lookup for selected type display
const HYLE_TYPE_LABELS = {
  "morpheme.base.free":       "Free base",
  "morpheme.base.bound":      "Bound base",
  "morpheme.affix.prefix":    "Prefix",
  "morpheme.affix.connecting":"Connecting vowel",
  "morpheme.affix.suffix":    "Suffix",
  "word.compound":            "Compound",
  "syntagm":                  "Syntagm",
  "paradigm":                 "Paradigm",
};

const ANNOT_TOOLS = [
  { key: "highlight",     icon: "fi-rr-highlighter",          label: "Highlight",     hasSize: true  },
  { key: "underline",     icon: "fi-rr-underline",            label: "Underline",     hasSize: false },
  { key: "strikethrough", icon: "fi-rr-strikethrough",        label: "Strikethrough", hasSize: false },
  { key: "pen",           icon: "fi-rr-pencil",               label: "Pen",           hasSize: true  },
  { key: "line",          icon: "fi-rr-minus",                label: "Line",          hasSize: false },
  { key: "arrow",         icon: "fi-rr-arrow-small-right",    label: "Arrow",         hasSize: true  },
  { key: "rect",          icon: "fi-rr-rectangle-horizontal", label: "Rectangle",     hasSize: false },
  { key: "circle",        icon: "fi-rr-circle",               label: "Ellipse",       hasSize: false },
  { key: "text",          icon: "fi-rr-text",                 label: "Text",          hasSize: false },
  { key: "drawText",      icon: "fi-rr-sparkles",             label: "Draw to Text",  hasSize: false },
  { key: "eraser",        icon: "fi-rr-eraser",               label: "Eraser",        hasSize: true  },
];

// Open Color (yeun.github.io/open-color) — the standard "professional" web
// UI palette, three shades (light/mid/deep) per hue family plus a grayscale
// anchor set, so annotations always land on a color that already looks
// intentional next to everything else in the app instead of a raw/neon pick.
const ANNOT_COLORS = [
  "#000000", "#212529", "#868e96", "#e9ecef", "#ffffff",
  "#ff8787", "#fa5252", "#e03131",
  "#f783ac", "#e64980", "#c2255c",
  "#da77f2", "#be4bdb", "#9c36b5",
  "#9775fa", "#7950f2", "#6741d9",
  "#748ffc", "#4c6ef5", "#3b5bdb",
  "#74c0fc", "#339af0", "#1c7ed6",
  "#66d9e8", "#22b8cf", "#1098ad",
  "#63e6be", "#20c997", "#0ca678",
  "#8ce99a", "#51cf66", "#37b24d",
  "#c0eb75", "#94d82d", "#74b816",
  "#ffe066", "#fcc419", "#f59f00",
  "#ffa94d", "#fd7e14", "#e8590c",
];
const ANNOT_COLOR_GROUPS = [
  { label: "Neutrals", colors: ANNOT_COLORS.slice(0, 5) },
  { label: "Warm", colors: ANNOT_COLORS.slice(5, 14) },
  { label: "Cool", colors: ANNOT_COLORS.slice(14, 29) },
  { label: "Green", colors: ANNOT_COLORS.slice(29, 38) },
  { label: "Sun", colors: ANNOT_COLORS.slice(38) },
];
const DEFAULT_ANNOT_TOOL_COLORS = {
  highlight: "#ffe066",
  pen: "#212529",
  underline: "#fa5252",
  strikethrough: "#e03131",
  line: "#4c6ef5",
  arrow: "#339af0",
  rect: "#20c997",
  circle: "#fd7e14",
  text: "#212529",
  drawText: "#212529",
};

const ANNOT_HISTORY_META = {
  add:   { icon: "fi-rr-plus",       verb: "Added" },
  undo:  { icon: "fi-rr-undo",       verb: "Undid" },
  redo:  { icon: "fi-rr-redo",       verb: "Redid" },
  erase: { icon: "fi-rr-eraser",     verb: "Erased" },
  clear: { icon: "fi-rr-trash",      verb: "Cleared" },
};

// Safari reports Apple-Pencil touches with Touch.touchType === "stylus" (vs.
// "direct" for a finger) — the only reliable signal we have to tell hand
// from pencil on a TouchEvent.
const isStylusTouch = (e) => Boolean(e.touches && e.touches[0] && e.touches[0].touchType === "stylus");

// Averages the pixels of the rendered PDF page canvas in a small square
// around (cx, cy) (canvas-pixel space) so "auto contrast" reacts to the
// actual local background rather than a single noisy pixel (e.g. one letter
// stroke in otherwise-white space).
const sampleAreaColor = (canvas, cx, cy, radius = 14) => {
  const x = Math.max(0, Math.round(cx - radius));
  const y = Math.max(0, Math.round(cy - radius));
  const w = Math.min(canvas.width  - x, radius * 2);
  const h = Math.min(canvas.height - y, radius * 2);
  if (w <= 0 || h <= 0) return { r: 255, g: 255, b: 255 };
  const { data } = canvas.getContext("2d").getImageData(x, y, w, h);
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
  return { r: r / n, g: g / n, b: b / n };
};

// WCAG relative luminance → picks whichever of pure black/white gives the
// higher contrast ratio against the sampled background (the theoretical
// best a single ink color can do).
const bestContrastColor = ({ r, g, b }) => {
  const toLinear = (c) => { const cs = c / 255; return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4); };
  const luminance = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  const contrastWithWhite = 1.05 / (luminance + 0.05);
  const contrastWithBlack = (luminance + 0.05) / 0.05;
  return contrastWithBlack > contrastWithWhite ? "#000000" : "#ffffff";
};
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 5;
// Pinch-to-zoom (touch, and trackpad pinch which browsers deliver as ctrl+wheel)
// is intentionally unbounded above MIN_ZOOM/MAX_ZOOM — this floor only exists so
// the zoom value can never hit 0 or go negative, which would divide-by-zero the
// viewport/scale math elsewhere.
const PINCH_ZOOM_FLOOR = 0.02;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const roundZoom = (value) => Math.round(value * 100) / 100;
const normalizeZoom = (value) => clamp(roundZoom(value), MIN_ZOOM, MAX_ZOOM);
const normalizePinchZoom = (value) => Math.max(PINCH_ZOOM_FLOOR, roundZoom(value));
const normalizeOcrText = (text) => (
  (text || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
);
const MAX_RENDER_CANVAS_DIMENSION = 8192;
const MAX_RENDER_CANVAS_PIXELS = 16777216;
const DEFAULT_PEN_SETTINGS = {
  stabilization: 45,
  pressureAssist: 55,
  taper: 72,
  flow: 38,
  border: true,
  nibAngle: 35,
  nibSpread: 68,
};
const DEFAULT_HIGHLIGHT_SETTINGS = {
  softness: 72,
  body: 58,
};
const PEN_TYPES = [
  { key: "ball", label: "Ball pen" },
  { key: "fountain", label: "Fountain pen" },
];
const PEN_THEMES = [
  {
    key: "artistic",
    label: "Artistic",
    penType: "fountain",
    settings: {
      stabilization: 32,
      pressureAssist: 72,
      taper: 88,
      flow: 76,
      border: true,
      nibAngle: 48,
      nibSpread: 84,
    },
  },
  {
    key: "professional",
    label: "Professional",
    penType: "ball",
    settings: {
      stabilization: 68,
      pressureAssist: 42,
      taper: 38,
      flow: 24,
      border: false,
      nibAngle: 35,
      nibSpread: 68,
    },
  },
];
const smoothStrokePoint = (points, nextPoint, stabilization) => {
  if (!points.length) return nextPoint;
  const previous = points[points.length - 1];
  const normalized = Math.min(1, Math.max(0, stabilization / 100));
  const blend = 0.12 + (normalized * normalized) * 0.84;
  const smoothed = {
    x: previous.x + (nextPoint.x - previous.x) * (1 - blend),
    y: previous.y + (nextPoint.y - previous.y) * (1 - blend),
    t: nextPoint.t,
    pressure: previous.pressure + (nextPoint.pressure - previous.pressure) * (1 - blend * 0.55),
  };
  if (Math.hypot(smoothed.x - previous.x, smoothed.y - previous.y) < 0.05) return null;
  return smoothed;
};

const distanceBetweenStrokePoints = (a, b) => Math.hypot((b.x ?? 0) - (a.x ?? 0), (b.y ?? 0) - (a.y ?? 0));

const dedupeStrokePoints = (points, minDistance = 0.02) => {
  if (!Array.isArray(points) || points.length < 2) return points || [];
  const deduped = [points[0]];
  for (let i = 1; i < points.length; i++) {
    if (distanceBetweenStrokePoints(deduped[deduped.length - 1], points[i]) >= minDistance) deduped.push(points[i]);
  }
  return deduped;
};

const resampleStrokePoints = (points, spacing = 0.7) => {
  if (!Array.isArray(points) || points.length < 2) return points || [];
  const safeSpacing = Math.max(0.2, spacing);
  const resampled = [points[0]];
  let previous = points[0];
  let remainder = 0;

  for (let i = 1; i < points.length; i++) {
    const current = points[i];
    let segLen = distanceBetweenStrokePoints(previous, current);
    if (segLen === 0) continue;

    while (remainder + segLen >= safeSpacing) {
      const step = (safeSpacing - remainder) / segLen;
      const point = {
        x: previous.x + (current.x - previous.x) * step,
        y: previous.y + (current.y - previous.y) * step,
        t: previous.t + ((current.t ?? previous.t ?? 0) - (previous.t ?? 0)) * step,
        pressure: (previous.pressure ?? 0.5) + ((current.pressure ?? previous.pressure ?? 0.5) - (previous.pressure ?? 0.5)) * step,
      };
      resampled.push(point);
      previous = point;
      segLen = distanceBetweenStrokePoints(previous, current);
      remainder = 0;
      if (segLen === 0) break;
    }

    remainder += segLen;
    previous = current;
  }

  const last = points[points.length - 1];
  if (distanceBetweenStrokePoints(resampled[resampled.length - 1], last) > 0.01) resampled.push(last);
  return resampled;
};

const smoothStrokePath = (points, smoothness = 0.45) => {
  if (!Array.isArray(points) || points.length < 3) return points || [];
  const tension = clamp(smoothness, 0, 1);
  const segmentsPerSpan = tension > 0.72 ? 4 : tension > 0.42 ? 3 : 2;
  const smoothed = [points[0]];

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    for (let step = 1; step <= segmentsPerSpan; step++) {
      const t = step / segmentsPerSpan;
      const t2 = t * t;
      const t3 = t2 * t;
      const x = 0.5 * (
        (2 * p1.x) +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
      );
      const y = 0.5 * (
        (2 * p1.y) +
        (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
      );
      smoothed.push({
        x,
        y,
        t: (p1.t ?? 0) + ((p2.t ?? p1.t ?? 0) - (p1.t ?? 0)) * t,
        pressure: clamp((p1.pressure ?? 0.5) + ((p2.pressure ?? p1.pressure ?? 0.5) - (p1.pressure ?? 0.5)) * t, 0.02, 1),
      });
    }
  }

  return dedupeStrokePoints(smoothed, 0.01);
};

const applySyntheticStrokePressure = (points, penType, pressureAssist = DEFAULT_PEN_SETTINGS.pressureAssist) => {
  if (!Array.isArray(points) || points.length < 2) return points || [];
  const normalizedAssist = clamp(pressureAssist / 100, 0, 1);
  const hasMeaningfulPressure = points.some((point) => {
    const pressure = point.pressure ?? 0.5;
    return pressure < 0.44 || pressure > 0.56;
  });
  if (hasMeaningfulPressure) {
    return points.map((point, index, array) => {
      const edgeTaper = Math.sin((index / Math.max(1, array.length - 1)) * Math.PI);
      const blendedPressure = (point.pressure ?? 0.5) * (1 - normalizedAssist * 0.35) + (0.5 + edgeTaper * 0.18) * (normalizedAssist * 0.35);
      return {
        ...point,
        pressure: clamp(blendedPressure * (0.92 + edgeTaper * 0.08), 0.04, 1),
      };
    });
  }

  return points.map((point, index, array) => {
    const prev = array[Math.max(0, index - 1)];
    const next = array[Math.min(array.length - 1, index + 1)];
    const dt = Math.max(1, Math.abs((next.t ?? point.t ?? 0) - (prev.t ?? point.t ?? 0)));
    const velocity = distanceBetweenStrokePoints(prev, next) / dt;
    const edgeTaper = Math.sin((index / Math.max(1, array.length - 1)) * Math.PI);
    const body = (penType === "fountain" ? 0.7 : 0.66) + normalizedAssist * 0.16;
    const velocityGain = (penType === "fountain" ? 0.34 : 0.22) + normalizedAssist * (penType === "fountain" ? 0.16 : 0.12);
    return {
      ...point,
      pressure: clamp(body + edgeTaper * 0.18 - velocity * velocityGain, 0.08, 0.94),
    };
  });
};

const finalizePenStroke = (points, penSettings = DEFAULT_PEN_SETTINGS, penType = "ball") => {
  if (!Array.isArray(points) || points.length < 2) return points || [];
  const stabilization = penSettings?.stabilization ?? DEFAULT_PEN_SETTINGS.stabilization;
  const pressureAssist = penSettings?.pressureAssist ?? DEFAULT_PEN_SETTINGS.pressureAssist;
  const normalized = clamp(stabilization / 100, 0, 1);
  const deduped = dedupeStrokePoints(points, 0.015 + normalized * 0.05);
  if (deduped.length < 2) return deduped;
  const resampled = resampleStrokePoints(deduped, 0.9 - normalized * 0.45);
  const smoothed = smoothStrokePath(resampled, 0.2 + normalized * 0.75);
  return applySyntheticStrokePressure(smoothed, penType, pressureAssist);
};

// Compact draggable "knob" that replaces a native <input type="range"> for
// annotation size — the knob's own diameter grows/shrinks live with the
// value, so it previews the stroke/highlight/eraser size instead of just
// pointing at a number on a track.
const KNOB_MIN_PX  = 8;
const KNOB_MAX_PX  = 22;
const KNOB_PAD_PX  = 12;
const KNOB_TRACK_W = 64;

const SizeKnob = ({ min, max, step, value, onChange, color, dashed }) => {
  const trackRef = useRef(null);
  const draggingRef = useRef(false);

  const updateFromClientX = useCallback((clientX) => {
    const rect = trackRef.current.getBoundingClientRect();
    const usable = rect.width - KNOB_PAD_PX * 2;
    let frac = (clientX - rect.left - KNOB_PAD_PX) / usable;
    frac = Math.min(1, Math.max(0, frac));
    let val = min + frac * (max - min);
    val = Math.round(val / step) * step;
    val = Math.min(max, Math.max(min, val));
    onChange(val);
  }, [min, max, step, onChange]);

  const onPointerDown = (e) => {
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    updateFromClientX(e.clientX);
  };
  const onPointerMove = (e) => {
    if (!draggingRef.current) return;
    updateFromClientX(e.clientX);
  };
  const onPointerUp = (e) => {
    draggingRef.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const frac     = Math.min(1, Math.max(0, (value - min) / (max - min)));
  const knobSize = KNOB_MIN_PX + frac * (KNOB_MAX_PX - KNOB_MIN_PX);
  const centerX  = KNOB_PAD_PX + frac * (KNOB_TRACK_W - KNOB_PAD_PX * 2);

  return (
    <div className="annot_size_knob">
      <div
        className="annot_size_knob_track"
        ref={trackRef}
        style={{ width: KNOB_TRACK_W }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        title="Size"
      >
        <div className="annot_size_knob_fill" style={{ width: centerX }} />
        <div
          className={`annot_size_knob_dot${dashed ? " annot_size_knob_dot--eraser" : ""}`}
          style={{
            width: knobSize,
            height: knobSize,
            left: centerX,
            background: dashed ? "transparent" : color,
          }}
        />
      </div>
      {/* Shown in "pt" — the unit these tools' size is conventionally read in, same as font size */}
      <span className="annot_size_label">{Number.isInteger(value) ? value : value.toFixed(1)}pt</span>
    </div>
  );
};

// Same draggable-pill mechanics as SizeKnob, but the dot's diameter stays
// fixed and its CSS opacity varies instead — previewing highlight opacity
// directly rather than a size no one asked about.
const OPACITY_MIN_PCT = 10;
const OPACITY_MAX_PCT = 90;
const OpacityKnob = ({ value, onChange, color }) => {
  const trackRef = useRef(null);
  const draggingRef = useRef(false);

  const updateFromClientX = useCallback((clientX) => {
    const rect = trackRef.current.getBoundingClientRect();
    const usable = rect.width - KNOB_PAD_PX * 2;
    let frac = (clientX - rect.left - KNOB_PAD_PX) / usable;
    frac = Math.min(1, Math.max(0, frac));
    const val = Math.round(OPACITY_MIN_PCT + frac * (OPACITY_MAX_PCT - OPACITY_MIN_PCT));
    onChange(val);
  }, [onChange]);

  const onPointerDown = (e) => {
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    updateFromClientX(e.clientX);
  };
  const onPointerMove = (e) => {
    if (!draggingRef.current) return;
    updateFromClientX(e.clientX);
  };
  const onPointerUp = (e) => {
    draggingRef.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const frac    = Math.min(1, Math.max(0, (value - OPACITY_MIN_PCT) / (OPACITY_MAX_PCT - OPACITY_MIN_PCT)));
  const centerX = KNOB_PAD_PX + frac * (KNOB_TRACK_W - KNOB_PAD_PX * 2);

  return (
    <div
      className="annot_size_knob_track"
      ref={trackRef}
      style={{ width: KNOB_TRACK_W }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      title={`Opacity: ${value}%`}
    >
      <div className="annot_size_knob_fill" style={{ width: centerX }} />
      <div
        className="annot_size_knob_dot"
        style={{ width: 14, height: 14, left: centerX, background: color, opacity: value / 100 }}
      />
    </div>
  );
};

const PercentKnob = ({ value, onChange, min = 0, max = 100, step = 5, label = "%" }) => {
  const trackRef = useRef(null);
  const draggingRef = useRef(false);

  const updateFromClientX = useCallback((clientX) => {
    const rect = trackRef.current.getBoundingClientRect();
    const usable = rect.width - KNOB_PAD_PX * 2;
    let frac = (clientX - rect.left - KNOB_PAD_PX) / usable;
    frac = Math.min(1, Math.max(0, frac));
    let val = min + frac * (max - min);
    val = Math.round(val / step) * step;
    val = Math.min(max, Math.max(min, val));
    onChange(val);
  }, [max, min, onChange, step]);

  const onPointerDown = (e) => {
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    updateFromClientX(e.clientX);
  };
  const onPointerMove = (e) => {
    if (!draggingRef.current) return;
    updateFromClientX(e.clientX);
  };
  const onPointerUp = (e) => {
    draggingRef.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const frac = Math.min(1, Math.max(0, (value - min) / (max - min)));
  const centerX = KNOB_PAD_PX + frac * (KNOB_TRACK_W - KNOB_PAD_PX * 2);

  return (
    <div className="annot_size_knob">
      <div
        className="annot_size_knob_track"
        ref={trackRef}
        style={{ width: KNOB_TRACK_W }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        title={`${value}${label}`}
      >
        <div className="annot_size_knob_fill" style={{ width: centerX }} />
        <div
          className="annot_size_knob_dot annot_size_knob_dot--percent"
          style={{ width: 14, height: 14, left: centerX }}
        />
      </div>
      <span className="annot_size_label">{value}{label}</span>
    </div>
  );
};

const LabeledPercentKnob = ({ title, subtitle, ...props }) => (
  <div className="annot_control">
    <div className="annot_control_head">
      <span className="annot_control_title">{title}</span>
      {subtitle ? <span className="annot_control_subtitle">{subtitle}</span> : null}
    </div>
    <PercentKnob {...props} />
  </div>
);

// Draw a single annotation onto a 2d canvas context.
// Coordinates are stored in PDF-point space; scale = fitScale * zoom converts to canvas pixels.

const ALL_MODES = ["sub-molecule","molecule","sub-cell","cell","sub-tissue","tissue","sub-organ","organ","sub-system","system","sub-human","human"];
const modeObj   = () => Object.fromEntries(ALL_MODES.map((m) => [m, []]));

const EMPTY_HYLES = () => ({
  objects:   modeObj(),
  traces:    modeObj(),
  phenomena: modeObj(),
  concept:   modeObj(),
  models:    modeObj(),
  _total: 0,
});

const authFetch = (url, options = {}) => {
  const token = readStoredSession()?.token || "";
  return fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` },
  });
};

const initStatus   = () => ({ value: "pending", at: new Date().toISOString() });
const currentStatus = (item) => item.status?.value || "pending";

const inflateExtraction = (extraction) => {
  const data = EMPTY_HYLES();
  for (const { id, num, noun, card, mode, reason, status } of extraction.nouns || []) {
    if (data[card]?.[mode]) {
      data[card][mode].push({ id, num, noun, reason: reason || "", status: status?.value ? status : initStatus() });
    }
  }
  data._total = extraction.totalNouns || 0;
  return data;
};

const deflateNounData = (hyleData) => {
  const nouns = [];
  for (const card of ["objects", "traces", "phenomena", "concept", "models"]) {
    for (const mode of ALL_MODES) {
      for (const item of hyleData[card]?.[mode] || []) {
        nouns.push({ id: item.id, num: item.num, noun: item.noun, card, mode, reason: item.reason, status: item.status });
      }
    }
  }
  return nouns;
};

const PDFPage = ({
  embeddedSourceId = "",
  embeddedPdfName = "",
  embeddedFile = null,
  embeddedHomePath = "/hylomorphism",
  homeLabel = "Hyle-to-Meaning",   // tooltip for the ⌂ button when routed directly (not embedded)
  selectionOnly = false,           // hide Hyle-extraction/annotation chrome, force manual text-selection always on
  onSelectionAction = null,        // async (selectedText) => void — replaces the ✓ "add to Hyles" button in the selection bar
  selectionActionLabel = "Add",
  hideHyleControls = false,        // hide just the "Hyles" toggle + extraction panel (plain reading/annotation use, e.g. /pdf-reader)
}) => {
  const [pdfDoc, setPdfDoc]         = useState(null);
  const [filename, setFilename]     = useState("");
  const [pageNum, setPageNum]       = useState(1);
  const [pageCount, setPageCount]   = useState(0);
  const [pdfType, setPdfType]       = useState(null);
  const [loading, setLoading]       = useState(false);
  const [loadError, setLoadError]   = useState("");
  const [dragOver, setDragOver]     = useState(false);
  const [pageViewport, setPageViewport] = useState(null);
  const [zoom, setZoom]               = useState(1);
  const [splitRatio,     setSplitRatio]    = useState(1);
  const [mdPanelWidth,   setMdPanelWidth]  = useState(340); // resizable width of the Markdown/Actions left column
  const [extractionOpen, setExtractionOpen] = useState(false);
  const savedRatioRef                 = useRef(0.42);
  const contentRef                    = useRef(null);
  const fitScaleRef                 = useRef(1);
  const zoomRef                     = useRef(1);
  const extractModeRef              = useRef("ai");

  const [hyleData, setHyleData]       = useState(null);
  const [hyleFontSize, setHyleFontSize] = useState(1);
  const [hylePage, setHylePage]       = useState(null);
  const [extracting, setExtracting]   = useState(false);
  const [extractError, setExtractError] = useState("");
  const { provider, setProvider }     = useAIProvider();
  const [showSysModal, setShowSysModal] = useState(false);
  const [readerTextSelectEnabled, setReaderTextSelectEnabled] = useState(false);

  // AI vs Manual toggle
  const extractMode = selectionOnly ? "manual" : (provider === "manual" ? "manual" : "ai");
  // Click/tap-and-hold word selection is part of manual Hyle extraction, but
  // the plain /pdf-reader restores its own local toggle so reading mode can
  // opt into selection without reopening the full Hyles controls.
  const textSelectable = selectionOnly
    ? true
    : hideHyleControls
      ? readerTextSelectEnabled
      : extractMode === "manual";
  const [extractionType, setExtractionType] = useState(null); // selected hyle type key
  const [typeTreeOpen,   setTypeTreeOpen]   = useState(false);

  // Manual selection popup
  const [manualPopup,     setManualPopup]     = useState(null); // { x, y }
  const [manualHyle,      setManualHyle]      = useState("");
  const [manualCard,      setManualCard]      = useState(() => {
    const p = window.location.pathname.split("/").pop();
    return CARDS.find((c) => c.key === p)?.key || "objects";
  });
  const [manualMode,      setManualMode]      = useState("organ");
  // Selection bar (shown before popup — lets user expand range word-by-word)
  const [manualSelection, setManualSelection] = useState(null); // { startIdx, endIdx, text, x, y }
  const [dragHandle,      setDragHandle]      = useState(null); // "start" | "end"

  const [history, setHistory]               = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [saving, setSaving]                 = useState(false);
  const [savedId, setSavedId]               = useState(null);
  const [activeHistoryId, setActiveHistoryId] = useState(null);

  // ── Per-page Markdown preview (toolbar "MD" button + left column) ──────────
  // View-only here: converting a document to Markdown happens from the Sources
  // table (it's a whole-document operation, not a per-page one) — this button
  // just opens the reader for a document that's already been converted there.
  const [hasStoredMarkdown, setHasStoredMarkdown] = useState(false);
  const [pageMdBusy,    setPageMdBusy]    = useState(false);
  const [pageMdError,   setPageMdError]   = useState("");
  const [pageMdOpen,    setPageMdOpen]    = useState(false);
  const [pageMdText,    setPageMdText]    = useState("");
  const [pageMdRange,   setPageMdRange]   = useState(null); // { from, to, all } — which range pageMdText is actually showing
  const [pageMdDeleteBusy, setPageMdDeleteBusy] = useState(false);
  const [mdDraftBusy,  setMdDraftBusy]  = useState(false); // Actions -> Markdown: spinning up (or reopening) a Draft document, separate from the pageMdOpen panel's own busy state
  const [mdDraftError, setMdDraftError] = useState("");
  const [mdPageIdx,     setMdPageIdx]     = useState(0); // index into mdPages — which single real page of the fetched range is displayed
  const [mdPageInputVal, setMdPageInputVal] = useState("1"); // editable page-number field's raw text, synced from mdCurrentPage.page
  const [pdfMdCountHighlight, setPdfMdCountHighlight] = useState(null); // null | "words" | "chars" — which markdown count is currently overlaid on the PDF page
  const [mdFontScale,   setMdFontScale]   = useState(1); // multiplier on the panel's base rem size — relative, so it scales with the root font-size same as everything else
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceQuery,     setVoiceQuery]     = useState("");
  const [voiceMatch,     setVoiceMatch]     = useState(null); // { start, end } char indices local to the displayed md page's text, or null
  const [voiceError,     setVoiceError]     = useState("");
  const voiceRecognitionRef = useRef(null);

  // Split the fetched range's Markdown into one chunk per real PDF page (the
  // server always tags each page with a "=== Page N ===" line via
  // pageMarkers=1) so the panel can show — and count — a single page at a
  // time instead of the whole range at once.
  const mdPages = useMemo(() => {
    const text = pageMdText || "";
    const re = /^=== Page (\d+) ===\r?\n?/gm;
    const marks = [...text.matchAll(re)];
    if (marks.length === 0) return text ? [{ page: pageMdRange?.from ?? pageNum, text, startOffset: 0 }] : [];
    return marks.map((m, i) => {
      const start = m.index + m[0].length;
      const end   = i + 1 < marks.length ? marks[i + 1].index : text.length;
      return { page: Number(m[1]), text: text.slice(start, end), startOffset: start };
    });
  }, [pageMdText, pageMdRange, pageNum]);

  // Which real page to land on once a fresh fetch's mdPages are ready — set
  // right before calling fetchMarkdownRange so the reset effect below can
  // jump straight to it instead of always defaulting to the first page.
  const mdFocusPageRef = useRef(null);
  useEffect(() => {
    const idx = mdFocusPageRef.current != null ? mdPages.findIndex((p) => p.page === mdFocusPageRef.current) : -1;
    setMdPageIdx(idx >= 0 ? idx : 0);
    mdFocusPageRef.current = null;
  }, [pageMdText]); // eslint-disable-line react-hooks/exhaustive-deps

  const mdCurrentPage = mdPages[mdPageIdx] || mdPages[0] || { page: pageNum, text: "", startOffset: 0 };
  useEffect(() => { setMdPageInputVal(String(mdCurrentPage.page)); }, [mdCurrentPage.page]);
  const cleanedMdCurrentText = useMemo(() => cleanMarkdownToPlainText(mdCurrentPage.text || ""), [mdCurrentPage.text]);
  const mdChars = useMemo(() => Array.from(cleanedMdCurrentText || ""), [cleanedMdCurrentText]);
  const mdStats = useMemo(() => ({
    words: (cleanedMdCurrentText.match(/\S+/g) || []).length,
    chars: mdChars.length,
  }), [cleanedMdCurrentText, mdChars]);

  // Bring a page into view in the main reader — fired by the word/char
  // counter buttons and by the panel's own page navigation, so the reader
  // always shows the page currently displayed in the panel.
  const scrollReaderToPage = useCallback((page) => {
    pageContainerRefs.current[page - 1]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const showMarkdownPageInPdf = useCallback((mode) => {
    const targetPage = mdCurrentPage.page;
    setPdfMdCountHighlight((prev) => {
      const next = prev === mode ? null : mode;
      if (!next) return null;
      if (splitRatio === 0) setSplitRatio(savedRatioRef.current || 0.42);
      setPageNum(targetPage);
      setZoom(1);
      scrollReaderToPage(targetPage);
      return next;
    });
  }, [mdCurrentPage.page, scrollReaderToPage, splitRatio]);

  // ── Annotation History (toolbar "History" button + left column) ────────────
  // A running, in-session log of every annotation step taken (add/undo/redo/
  // clear), independent of the annotations themselves — so you can see what
  // you did and when, not just the current end result.
  const [annotHistory,     setAnnotHistory]     = useState([]);
  const [annotHistoryOpen, setAnnotHistoryOpen] = useState(false);
  const [pageMinimap, setPageMinimap] = useState([]);
  const logAnnotHistory = useCallback((entry) => {
    setAnnotHistory((prev) => [...prev, { id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, time: new Date(), ...entry }].slice(-300));
  }, []);

  // ── Selection action (selectionOnly mode) ──────────────────────────────────
  const [selectionActionBusy,  setSelectionActionBusy]  = useState(false);
  const [selectionActionError, setSelectionActionError] = useState("");

  // ── Annotation state ──────────────────────────────────────────────────────
  const [annotTool,      setAnnotTool]      = useState(null);
  const [annotToolColors, setAnnotToolColors] = useState(DEFAULT_ANNOT_TOOL_COLORS);
  const [annotSize,      setAnnotSize]      = useState(16);  // highlight lineWidth
  const [penSize,        setPenSize]        = useState(2);   // pen lineWidth
  const [arrowSize,      setArrowSize]      = useState(3);   // arrow lineWidth
  const [penStabilization, setPenStabilization] = useState(DEFAULT_PEN_SETTINGS.stabilization);
  const [penPressureAssist, setPenPressureAssist] = useState(DEFAULT_PEN_SETTINGS.pressureAssist);
  const [penTaper, setPenTaper] = useState(DEFAULT_PEN_SETTINGS.taper);
  const [penFlow, setPenFlow] = useState(DEFAULT_PEN_SETTINGS.flow);
  const [penBorder, setPenBorder] = useState(DEFAULT_PEN_SETTINGS.border);
  const [penNibAngle, setPenNibAngle] = useState(DEFAULT_PEN_SETTINGS.nibAngle);
  const [penNibSpread, setPenNibSpread] = useState(DEFAULT_PEN_SETTINGS.nibSpread);
  const [penType,          setPenType]          = useState("ball");
  const [eraserSize,     setEraserSize]     = useState(18);  // eraser radius
  const [highlightMode,  setHighlightMode]  = useState("freehand"); // "freehand" | "line"
  const [highlightAutoWidth, setHighlightAutoWidth] = useState(true);
  const [highlightTaperEnds, setHighlightTaperEnds] = useState(true);
  const [annotOpacity,      setAnnotOpacity]      = useState(35);    // % — highlight fill opacity
  const [drawTextBusy, setDrawTextBusy] = useState(false);
  const [drawTextStatus, setDrawTextStatus] = useState("");
  const [drawTextProgress, setDrawTextProgress] = useState(0);
  const [toolsMenuOpen,  setToolsMenuOpen]  = useState(false); // floating tools dropdown
  const [colorMenuOpen,  setColorMenuOpen]  = useState(false); // floating color dropdown
  const [penMenuOpen,    setPenMenuOpen]    = useState(false); // floating pen controls dropdown
  const [highlightMenuOpen, setHighlightMenuOpen] = useState(false); // floating highlight controls dropdown
  const toolsMenuRef = useRef(null);
  const colorMenuRef = useRef(null);
  const penMenuRef = useRef(null);
  const highlightMenuRef = useRef(null);
  // "Actions" toolbar dropdown (Markdown / Linguistic Analysis) + its page-range picker popover
  const [actionsMenuOpen,    setActionsMenuOpen]    = useState(false);
  const actionsMenuRef = useRef(null);
  const [rangePickerAction, setRangePickerAction]   = useState(null); // null | "markdown" | "linguistic"
  const [rangeFrom,          setRangeFrom]          = useState(1);
  const [rangeTo,            setRangeTo]            = useState(1);
  const [rangeAll,           setRangeAll]           = useState(false);
  // "Hand" mode: when on, a finger touch only pans/scrolls the page and
  // never draws — only the pencil (stylus, per Safari's Touch.touchType)
  // draws. Lets you rest your hand on the screen while sketching with an
  // Apple Pencil without fighting the page underneath.
  const [fingerScrollOnly, setFingerScrollOnly] = useState(false);
  const fingerScrollOnlyRef = useRef(false);
  useEffect(() => { fingerScrollOnlyRef.current = fingerScrollOnly; }, [fingerScrollOnly]);
  // Auto-contrast: pick the ink color (black/white) with the best contrast
  // against the page background right under where each stroke starts.
  const [autoContrast, setAutoContrast] = useState(false);
  const [annotations, setAnnotations] = useState({});   // { [pageNum]: [...] }
  const [redoStacks, setRedoStacks] = useState({});     // { [pageNum]: [...] } — annotations popped by Undo, available to Redo
  const annotColor = annotTool && DEFAULT_ANNOT_TOOL_COLORS[annotTool]
    ? (annotToolColors[annotTool] || DEFAULT_ANNOT_TOOL_COLORS[annotTool])
    : "#ffff00";
  const setAnnotColor = useCallback((nextColor) => {
    setAnnotToolColors((prev) => {
      if (!annotTool || !DEFAULT_ANNOT_TOOL_COLORS[annotTool]) return prev;
      return { ...prev, [annotTool]: nextColor };
    });
  }, [annotTool]);
  const applyPenTheme = useCallback((theme) => {
    if (!theme) return;
    setPenType(theme.penType);
    setPenStabilization(theme.settings.stabilization);
    setPenPressureAssist(theme.settings.pressureAssist);
    setPenTaper(theme.settings.taper);
    setPenFlow(theme.settings.flow);
    setPenBorder(theme.settings.border);
    setPenNibAngle(theme.settings.nibAngle);
    setPenNibSpread(theme.settings.nibSpread);
  }, []);

  const getOcrWorker = useCallback(async () => {
    if (ocrWorkerRef.current) return ocrWorkerRef.current;
    if (ocrWorkerPromiseRef.current) return ocrWorkerPromiseRef.current;

    const workerPromise = (async () => {
      const { createWorker, PSM } = await import("tesseract.js");
      const worker = await createWorker("eng", 1, {
        logger: (message) => {
          if (drawTextJobRef.current === 0) return;
          if (message.status) setDrawTextStatus(message.status);
          if (typeof message.progress === "number") setDrawTextProgress(message.progress);
        },
      });
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SPARSE_TEXT,
        preserve_interword_spaces: "1",
      });
      ocrWorkerRef.current = worker;
      return worker;
    })();

    ocrWorkerPromiseRef.current = workerPromise;
    try {
      return await workerPromise;
    } finally {
      ocrWorkerPromiseRef.current = null;
    }
  }, []);

  useEffect(() => () => {
    drawTextJobRef.current = 0;
    const worker = ocrWorkerRef.current;
    ocrWorkerRef.current = null;
    ocrWorkerPromiseRef.current = null;
    worker?.terminate?.().catch?.(() => {});
  }, []);

  // Autosave the annotation session in the background — debounced so a whole
  // stroke's worth of state updates only writes once, a beat after the user
  // pauses. Server-side model (SourceAnnotation) already existed, just unused.
  useEffect(() => {
    if (skipNextAnnotationAutosaveRef.current) { skipNextAnnotationAutosaveRef.current = false; return; }
    const sourceId = currentSourceIdRef.current;
    if (!sourceId) return; // local/unsaved file — nothing to persist against
    const timer = setTimeout(() => {
      authFetch(apiUrl(`/api/source-annotations/${sourceId}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layers: annotations }),
      }).catch(() => {}); // best-effort background autosave — a failed write shouldn't interrupt reading/annotating
    }, 1500);
    return () => clearTimeout(timer);
  }, [annotations]);
  const [annotTextInput, setAnnotTextInput] = useState(null); // { vx, vy, cx, cy }
  const [annotTextVal,   setAnnotTextVal]   = useState("");
  const annotCanvasRef  = useRef(null);
  const activeAnnotRef  = useRef(null);  // in-progress shape
  const ocrWorkerRef = useRef(null);
  const ocrWorkerPromiseRef = useRef(null);
  const drawTextJobRef = useRef(0);

  // Close the floating tools/color/pen/highlight/actions dropdowns on an outside click
  useEffect(() => {
    if (!toolsMenuOpen && !colorMenuOpen && !penMenuOpen && !highlightMenuOpen && !actionsMenuOpen) return;
    const onDocPointerDown = (e) => {
      if (toolsMenuOpen && toolsMenuRef.current && !toolsMenuRef.current.contains(e.target)) setToolsMenuOpen(false);
      if (colorMenuOpen && colorMenuRef.current && !colorMenuRef.current.contains(e.target)) setColorMenuOpen(false);
      if (penMenuOpen && penMenuRef.current && !penMenuRef.current.contains(e.target)) setPenMenuOpen(false);
      if (highlightMenuOpen && highlightMenuRef.current && !highlightMenuRef.current.contains(e.target)) setHighlightMenuOpen(false);
      if (actionsMenuOpen && actionsMenuRef.current && !actionsMenuRef.current.contains(e.target)) setActionsMenuOpen(false);
    };
    document.addEventListener("mousedown", onDocPointerDown);
    return () => document.removeEventListener("mousedown", onDocPointerDown);
  }, [toolsMenuOpen, colorMenuOpen, penMenuOpen, highlightMenuOpen, actionsMenuOpen]);

  // Per-page refs for continuous scroll
  const pageCanvasRefs    = useRef([]);
  const pageContainerRefs = useRef([]);
  const renderTasksRef    = useRef([]);
  const pageViewportsRef  = useRef([]);
  const renderedScaleRef  = useRef([]); // scale each page's canvas was last rendered at — lets us skip already-current pages
  const renderedCssSizeRef = useRef([]); // last displayed CSS size per page, separate from the HiDPI backing buffer size
  const pageNumRef        = useRef(1);
  pageNumRef.current      = pageNum;  // sync during render

  // Proxy ref: always points to current page's PDF canvas
  const canvasRef = { get current() { return pageCanvasRefs.current[pageNumRef.current - 1] ?? null; } };

  const textLayerRef  = useRef(null);
  // Markdown panel's read-only text panes — selection only turns on after a
  // long press (see useLongPressSelect), so a quick click/scroll never
  // accidentally starts selecting.
  const mdTextRef        = useRef(null);
  useLongPressSelect(mdTextRef);
  const previewRef    = useRef(null);
  const canvasWrapRef = useRef(null);
  const fileInputRef  = useRef(null);
  const zoomHoldTimerRef = useRef(null);
  const zoomHoldIntervalRef = useRef(null);
  const selBarRef          = useRef(null);
  const footerAdjustTimerRef = useRef(null);
  const spansRef           = useRef([]); // [{text, el}] built when text layer renders
  const scrollAfterZoomRef = useRef(null); // {left, top} to apply after zoom re-render
  const mouseDownPosRef    = useRef(null); // {x,y} at last mousedown — used to detect drag vs click
  const suppressTextSelectionRef = useRef(false);
  const lastLoadedSourceKeyRef = useRef("");
  const currentSourceIdRef = useRef(""); // the Source _id backing pdfDoc, if any (empty for local file uploads)
  const lastLoadedFileRef = useRef(null);
  const skipNextAnnotationAutosaveRef = useRef(false); // set right before restoring a saved session, so that restore doesn't immediately re-trigger the autosave effect below
  const wheelZoomStateRef  = useRef({
    baseZoom: 1,
    pendingZoom: 1,
    originX: 0,
    originY: 0,
    midX: 0,
    midY: 0,
    startSL: 0,
    startST: 0,
    timer: null,
  });

  const navigate = useNavigate();
  const location = useLocation();
  const { card: urlCard } = useParams();
  const embedded = Boolean(embeddedSourceId) || Boolean(embeddedFile); // true when mounted inside another page (e.g. Traces Collector) rather than routed directly
  const isNounsPage = !urlCard; // true when mounted at /hyles (no card in URL)
  const [localCard, setLocalCard] = useState("objects");
  const activeCard = isNounsPage
    ? localCard
    : (CARDS.find((c) => c.key === urlCard)?.key || "objects");
  const canExtract = Boolean(pdfDoc) && pdfType !== "scanned";

  // ── Sources list (for /hyles drop-zone replacement) ─────────────────────
  const [hyleSources,        setHyleSources]        = useState([]);
  const [hyleSourcesLoading, setHyleSourcesLoading] = useState(false);

  useEffect(() => {
    if (!isNounsPage) return;
    setHyleSourcesLoading(true);
    authFetch(apiUrl("/api/sources/"))
      .then((r) => r.json())
      .then((d) => setHyleSources((d.sources || []).filter((s) => /\.(pdf|docx?)$/i.test(s.name))))
      .catch(() => {})
      .finally(() => setHyleSourcesLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fetch history on mount ─────────────────────────────────────────────────
  useEffect(() => {
    setHistoryLoading(true);
    authFetch(apiUrl("/api/pdf/history"))
      .then((r) => r.json())
      .then((d) => {
        const extractions = d.extractions || [];
        setHistory(extractions);
        if (extractions.length > 0) {
          const first = extractions[0];
          authFetch(apiUrl(`/api/pdf/history/${first._id}`))
            .then((r) => r.json())
            .then((data) => {
              setHyleData(inflateExtraction(data.extraction));
              setActiveHistoryId(first._id);
              setSavedId(first._id);
            })
            .catch(() => {});
        }
      })
      .catch(() => {})
      .finally(() => setHistoryLoading(false));
  }, []);

  // ── Render PDF page on canvas ──────────────────────────────────────────────
  // Renders a single page at the current fitScale*zoom, skipping it if its
  // canvas is already up to date at that scale.
  const renderPage = useCallback(async (n) => {
    if (!pdfDoc) return;
    const canvas = pageCanvasRefs.current[n - 1];
    if (!canvas) return;
    const displayScale = fitScaleRef.current * zoom;
    if (renderedScaleRef.current[n - 1] === displayScale) return;
    const page     = await pdfDoc.getPage(n);
    const c        = pageCanvasRefs.current[n - 1];
    if (!c) return;
    const displayViewport = page.getViewport({ scale: displayScale });
    pageViewportsRef.current[n - 1] = displayViewport;
    renderTasksRef.current[n - 1]?.cancel();
    const deviceScale = window.devicePixelRatio || 1;
    const renderScaleFactor = Math.min(
      1,
      MAX_RENDER_CANVAS_DIMENSION / Math.max(1, displayViewport.width * deviceScale),
      MAX_RENDER_CANVAS_DIMENSION / Math.max(1, displayViewport.height * deviceScale),
      Math.sqrt(MAX_RENDER_CANVAS_PIXELS / Math.max(1, displayViewport.width * displayViewport.height * deviceScale * deviceScale)),
    );
    const renderViewport = renderScaleFactor < 0.999
      ? page.getViewport({ scale: displayScale * renderScaleFactor })
      : displayViewport;
    const dimLimitedScale = Math.min(
      deviceScale,
      MAX_RENDER_CANVAS_DIMENSION / Math.max(1, renderViewport.width),
      MAX_RENDER_CANVAS_DIMENSION / Math.max(1, renderViewport.height),
    );
    const areaLimitedScale = Math.min(
      deviceScale,
      Math.sqrt(MAX_RENDER_CANVAS_PIXELS / Math.max(1, renderViewport.width * renderViewport.height)),
    );
    const outputScale = Math.max(1, Math.min(deviceScale, dimLimitedScale, areaLimitedScale));
    c.width  = Math.floor(renderViewport.width * outputScale);
    c.height = Math.floor(renderViewport.height * outputScale);
    // Keep layout in CSS pixels while rendering the raster at device-pixel
    // density, so the page reads sharper and less washed out on modern displays.
    c.style.width  = `${displayViewport.width}px`;
    c.style.height = `${displayViewport.height}px`;
    renderedCssSizeRef.current[n - 1] = {
      width: displayViewport.width,
      height: displayViewport.height,
    };
    const ctx = c.getContext("2d");
    ctx.setTransform(outputScale, 0, 0, outputScale, 0, 0);
    const task = page.render({ canvasContext: ctx, viewport: renderViewport });
    renderTasksRef.current[n - 1] = task;
    renderedScaleRef.current[n - 1] = displayScale;
    task.promise.catch(err => { if (err?.name !== "RenderingCancelledException") console.error(err); });
    if (n === pageNumRef.current) setPageViewport(displayViewport);
  }, [pdfDoc, zoom]);

  // Full reset + initial render whenever a new document (or page count) loads.
  // Deliberately does NOT run on zoom changes (see the effect below) — this
  // used to fire on zoom too and reset renderedScaleRef to all-null every
  // time, which wiped out the "last actually-rendered scale" a never-visited
  // page needs to correctly rescale itself on the NEXT zoom tick (it would
  // read back as null and silently stop rescaling after the first tick).
  useEffect(() => {
    if (!pdfDoc || pageCount === 0) return;
    let cancelled = false;
    renderTasksRef.current.forEach(t => t?.cancel());
    renderTasksRef.current   = new Array(pageCount).fill(null);
    renderedScaleRef.current = new Array(pageCount).fill(null);
    renderedCssSizeRef.current = new Array(pageCount).fill(null);

    // Embedded readers should preserve the PDF's original size instead of fitting to the container.
    pdfDoc.getPage(1).then(page1 => {
      if (cancelled) return;
      if (embedded) {
        fitScaleRef.current = 1;
      } else {
        const previewWidth = previewRef.current?.clientWidth || 480;
        fitScaleRef.current = Math.min(
          1,
          (previewWidth - 24) / page1.getViewport({ scale: 1 }).width,
        );
      }
      if (cancelled) return;
      renderPage(pageNumRef.current);
    });

    return () => { cancelled = true; renderTasksRef.current.forEach(t => t?.cancel()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- renderPage intentionally excluded, only pdfDoc/pageCount should reset the per-page render bookkeeping
  }, [pdfDoc, pageCount]);

  // Only the current page re-renders eagerly on zoom change; every other page
  // is instantly CSS-rescaled (approximate, no re-rasterization — cheap) and
  // lazily re-rendered for real by the IntersectionObserver below once it's
  // scrolled into view. Re-rasterizing every page on every zoom tick made
  // zooming a multi-page document slow; NOT touching renderedScaleRef here
  // (unlike the effect above) is what lets this compute the correct
  // cumulative rescale ratio across several zoom ticks in a row, even for a
  // page that's never actually revisited.
  useEffect(() => {
    if (!pdfDoc || pageCount === 0) return;
    const newScale = fitScaleRef.current * zoom;
    pageCanvasRefs.current.forEach((canvas, i) => {
      if (!canvas) return;
      const prevScale = renderedScaleRef.current[i];
      if (!prevScale || prevScale === newScale) return;
      const ratio = newScale / prevScale;
      const prevCssSize = renderedCssSizeRef.current[i];
      if (!prevCssSize) return;
      canvas.style.width  = `${prevCssSize.width * ratio}px`;
      canvas.style.height = `${prevCssSize.height * ratio}px`;
    });
    renderPage(pageNumRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only zoom should trigger this; renderPage/pdfDoc/pageCount changing here would re-run the doc-load effect above instead
  }, [zoom]);

  // Sync pageViewport when pageNum changes via scroll
  useEffect(() => {
    const vp = pageViewportsRef.current[pageNum - 1];
    if (vp) setPageViewport(vp);
  }, [pageNum]);

  // Keep refs in sync so event handlers always read the latest values
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);

  useEffect(() => () => {
    const state = wheelZoomStateRef.current;
    if (state.timer) clearTimeout(state.timer);
  }, []);

  // Apply zoom-to-point scroll correction after canvas re-renders at new zoom.
  // Also strips any CSS pinch-transform that was held until this point.
  useEffect(() => {
    const pending = scrollAfterZoomRef.current;
    if (!pending || !previewRef.current) return;
    scrollAfterZoomRef.current = null;
    const el   = previewRef.current;
    const wrap = canvasWrapRef.current;
    requestAnimationFrame(() => {
      // Remove the CSS transform and set the real scroll in the same frame
      // so the canvas never flashes back to the pre-zoom position.
      if (wrap && wrap.style.transform) {
        wrap.style.transform       = "";
        wrap.style.transformOrigin = "";
        wrap.style.willChange      = "";
      }
      el.scrollLeft = Math.max(0, pending.left);
      el.scrollTop  = Math.max(0, pending.top);
    });
  }, [zoom]);

  useEffect(() => {
    if (!pdfDoc || !previewRef.current) {
      setPageMinimap([]);
      return;
    }

    const previewEl = previewRef.current;
    let frame = 0;

    const updateMinimap = () => {
      frame = 0;
      const previewRect = previewEl.getBoundingClientRect();
      const visiblePages = pageContainerRefs.current
        .map((pageEl, index) => {
          if (!pageEl) return null;
          const pageRect = pageEl.getBoundingClientRect();
          if (pageRect.width <= 0 || pageRect.height <= 0) return null;
          const visibleLeft = clamp(previewRect.left - pageRect.left, 0, pageRect.width);
          const visibleTop = clamp(previewRect.top - pageRect.top, 0, pageRect.height);
          const visibleRight = clamp(previewRect.right - pageRect.left, 0, pageRect.width);
          const visibleBottom = clamp(previewRect.bottom - pageRect.top, 0, pageRect.height);
          const visibleWidth = Math.max(0, visibleRight - visibleLeft);
          const visibleHeight = Math.max(0, visibleBottom - visibleTop);
          if (visibleWidth <= 0 || visibleHeight <= 0) return null;
          return {
            page: index + 1,
            pageWidth: pageRect.width,
            pageHeight: pageRect.height,
            visibleLeft,
            visibleTop,
            visibleWidth,
            visibleHeight,
            previewSrc: pageCanvasRefs.current[index]?.toDataURL?.("image/jpeg", 0.72) || "",
          };
        })
        .filter(Boolean);

      setPageMinimap(visiblePages);
    };

    const requestMinimapUpdate = () => {
      if (!frame) frame = requestAnimationFrame(updateMinimap);
    };

    requestMinimapUpdate();
    previewEl.addEventListener("scroll", requestMinimapUpdate, { passive: true });
    window.addEventListener("resize", requestMinimapUpdate);

    return () => {
      previewEl.removeEventListener("scroll", requestMinimapUpdate);
      window.removeEventListener("resize", requestMinimapUpdate);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [pdfDoc, pageNum, pageViewport, zoom, splitRatio]);

  // IntersectionObserver: update pageNum as user scrolls through pages, and
  // lazily (re)render any visible page left stale by a zoom/doc change.
  useEffect(() => {
    if (!pdfDoc || !previewRef.current || pageCount === 0) return;
    const root = previewRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        let topmost = null;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const n = parseInt(entry.target.dataset.page, 10);
          if (topmost === null || n < topmost) topmost = n;
          renderPage(n);
        }
        if (topmost !== null) setPageNum(topmost);
      },
      { root, rootMargin: "200px 0px", threshold: 0.15 }
    );
    pageContainerRefs.current.forEach((el, i) => {
      if (el) { el.dataset.page = String(i + 1); observer.observe(el); }
    });
    return () => observer.disconnect();
  }, [pdfDoc, pageCount, renderPage]);

  useEffect(() => { extractModeRef.current = extractMode; }, [extractMode]);
  useEffect(() => { if (!textSelectable) { setManualPopup(null); setManualSelection(null); } }, [textSelectable]);

  const textSelectableRef = useRef(false);
  useEffect(() => { textSelectableRef.current = textSelectable; }, [textSelectable]);

  const manualSelectionRef = useRef(null);
  const dragHandleRef      = useRef(null); // sync mirror of dragHandle state
  const onSelectionActionRef = useRef(onSelectionAction);
  useEffect(() => { manualSelectionRef.current = manualSelection; }, [manualSelection]);
  useEffect(() => { onSelectionActionRef.current = onSelectionAction; }, [onSelectionAction]);

  // ── Render annotation canvas ───────────────────────────────────────────────
  // Keyed off pageViewport (not zoom directly): renderPage() re-rasterizes the
  // real page canvas asynchronously (it awaits pdfDoc.getPage() before touching
  // canvas.width/height), so reading pc.width/height synchronously on a zoom
  // change would copy the STALE pre-zoom raster size while drawing at the NEW
  // scale — mismatched forever, since nothing re-ran this effect afterward.
  // pageViewport is set by renderPage() at the exact moment it resizes the
  // current page's canvas, so waiting for it keeps the two canvases in sync.
  useEffect(() => {
    const ac = annotCanvasRef.current;
    if (!ac || !pageViewport) return;
    ac.width  = Math.max(1, Math.floor(pageViewport.width));
    ac.height = Math.max(1, Math.floor(pageViewport.height));
    ac.style.width = `${pageViewport.width}px`;
    ac.style.height = `${pageViewport.height}px`;
    const scale = fitScaleRef.current * zoom;
    const ctx = ac.getContext("2d");
    ctx.clearRect(0, 0, ac.width, ac.height);
    for (const ann of (annotations[pageNum] || [])) drawAnnotation(ctx, ann, scale);
  }, [annotations, pageNum, pageViewport]);

  const runDrawToTextRecognition = useCallback(async (selection) => {
    const pageCanvas = canvasRef.current;
    const annotCanvas = annotCanvasRef.current;
    const viewport = pageViewportsRef.current[pageNum - 1] || pageViewport;
    if (!pageCanvas || !annotCanvas || !viewport) return;

    const scale = fitScaleRef.current * zoomRef.current;
    const pageCssWidth = Math.max(1, viewport.width);
    const pageCssHeight = Math.max(1, viewport.height);
    const pageScaleX = pageCanvas.width / pageCssWidth;
    const pageScaleY = pageCanvas.height / pageCssHeight;
    const cropLeftCss = clamp(selection.x * scale, 0, pageCssWidth);
    const cropTopCss = clamp(selection.y * scale, 0, pageCssHeight);
    const cropWidthCss = clamp(selection.w * scale, 1, pageCssWidth - cropLeftCss);
    const cropHeightCss = clamp(selection.h * scale, 1, pageCssHeight - cropTopCss);
    if (cropWidthCss < 12 || cropHeightCss < 12) return;

    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = Math.max(1, Math.round(cropWidthCss * pageScaleX));
    cropCanvas.height = Math.max(1, Math.round(cropHeightCss * pageScaleY));
    const cropCtx = cropCanvas.getContext("2d", { willReadFrequently: true });
    cropCtx.fillStyle = "#ffffff";
    cropCtx.fillRect(0, 0, cropCanvas.width, cropCanvas.height);
    cropCtx.drawImage(
      pageCanvas,
      cropLeftCss * pageScaleX,
      cropTopCss * pageScaleY,
      cropWidthCss * pageScaleX,
      cropHeightCss * pageScaleY,
      0,
      0,
      cropCanvas.width,
      cropCanvas.height
    );
    cropCtx.drawImage(
      annotCanvas,
      cropLeftCss,
      cropTopCss,
      cropWidthCss,
      cropHeightCss,
      0,
      0,
      cropCanvas.width,
      cropCanvas.height
    );

    // A light grayscale/contrast pass helps handwriting and low-contrast pen
    // strokes read more like intentional ink before OCR sees the crop.
    const image = cropCtx.getImageData(0, 0, cropCanvas.width, cropCanvas.height);
    const { data } = image;
    for (let i = 0; i < data.length; i += 4) {
      const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      const boosted = gray < 185 ? gray * 0.68 : 255 - ((255 - gray) * 0.42);
      data[i] = boosted;
      data[i + 1] = boosted;
      data[i + 2] = boosted;
      data[i + 3] = 255;
    }
    cropCtx.putImageData(image, 0, 0);

    const jobId = Date.now();
    drawTextJobRef.current = jobId;
    setDrawTextBusy(true);
    setDrawTextProgress(0);
    setDrawTextStatus("Preparing OCR…");

    try {
      const worker = await getOcrWorker();
      const { data: { text } } = await worker.recognize(cropCanvas);
      if (drawTextJobRef.current !== jobId) return;
      const recognizedText = normalizeOcrText(text);
      if (!recognizedText) {
        setDrawTextStatus("No text detected");
        setTimeout(() => {
          if (drawTextJobRef.current === jobId) {
            setDrawTextBusy(false);
            setDrawTextStatus("");
            setDrawTextProgress(0);
            drawTextJobRef.current = 0;
          }
        }, 1200);
        return;
      }

      const rect = annotCanvas.getBoundingClientRect();
      const inputLeft = cropLeftCss + 8;
      const inputTop = cropTopCss + 8;
      setAnnotTextInput({
        vx: rect.left + inputLeft,
        vy: rect.top + inputTop,
        cx: selection.x + (8 / scale),
        cy: selection.y + (8 / scale),
        width: Math.max(160, cropWidthCss - 16),
      });
      setAnnotTextVal(recognizedText);
      setDrawTextBusy(false);
      setDrawTextStatus("");
      setDrawTextProgress(0);
      drawTextJobRef.current = 0;
    } catch (error) {
      console.error(error);
      if (drawTextJobRef.current !== jobId) return;
      setDrawTextStatus("OCR failed");
      setTimeout(() => {
        if (drawTextJobRef.current === jobId) {
          setDrawTextBusy(false);
          setDrawTextStatus("");
          setDrawTextProgress(0);
          drawTextJobRef.current = 0;
        }
      }, 1600);
    }
  }, [getOcrWorker, pageNum, pageViewport]);

  // ── Annotation drawing events ──────────────────────────────────────────────
  useEffect(() => {
    const ac = annotCanvasRef.current;
    if (!ac || !annotTool) return;

    // Returns coordinates in PDF-point space (canvas pixels ÷ scale)
    const getScale = () => fitScaleRef.current * zoomRef.current;
    const toCanvas = (e) => {
      const rect  = ac.getBoundingClientRect();
      const scale = getScale();
      const sx    = ac.width  / rect.width;
      const sy    = ac.height / rect.height;
      const cx    = e.touches ? e.touches[0].clientX : e.clientX;
      const cy    = e.touches ? e.touches[0].clientY : e.clientY;
      const pressure = typeof e.pressure === "number"
        ? e.pressure
        : typeof e.touches?.[0]?.force === "number"
          ? e.touches[0].force
          : 0.5;
      return {
        x: (cx - rect.left) * sx / scale,
        y: (cy - rect.top) * sy / scale,
        vx: cx,
        vy: cy,
        t: typeof e.timeStamp === "number" ? e.timeStamp : performance.now(),
        pressure: Math.min(1, Math.max(0, pressure || 0.5)),
      };
    };

    const getTextAlignedHighlightPoint = (e, lockedY = null) => {
      const basePoint = toCanvas(e);
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const target = document.elementFromPoint(clientX, clientY);
      const layer = textLayerRef.current;
      if (!target || !layer || !layer.contains(target)) {
        return lockedY == null
          ? { ...basePoint, lineWidth: null, textAligned: false }
          : { ...basePoint, y: lockedY, lineWidth: null, textAligned: false };
      }

      const span = target.closest?.("[data-span-idx]");
      if (!span) {
        return lockedY == null
          ? { ...basePoint, lineWidth: null, textAligned: false }
          : { ...basePoint, y: lockedY, lineWidth: null, textAligned: false };
      }

      const canvasRect = ac.getBoundingClientRect();
      const scale = getScale();
      const sx = ac.width / canvasRect.width;
      const sy = ac.height / canvasRect.height;
      const spanRect = span.getBoundingClientRect();
      const centerY = ((spanRect.top + spanRect.height / 2) - canvasRect.top) * sy / scale;
      const textHeight = Math.max(8, (spanRect.height * sy / scale) * 0.82);
      return {
        ...basePoint,
        y: lockedY ?? centerY,
        lineWidth: textHeight,
        textAligned: true,
      };
    };

    const getTextAlignedHighlightRange = (e) => {
      const alignedPoint = getTextAlignedHighlightPoint(e);
      if (!alignedPoint.textAligned) return null;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const target = document.elementFromPoint(clientX, clientY);
      const span = target?.closest?.("[data-span-idx]");
      if (!span) return null;
      const canvasRect = ac.getBoundingClientRect();
      const scale = getScale();
      const sx = ac.width / canvasRect.width;
      const spanRect = span.getBoundingClientRect();
      return {
        ...alignedPoint,
        startX: ((spanRect.left - canvasRect.left) * sx) / scale,
        endX: ((spanRect.right - canvasRect.left) * sx) / scale,
      };
    };

    const redraw = (extra) => {
      const scale = getScale();
      const ctx = ac.getContext("2d");
      ctx.clearRect(0, 0, ac.width, ac.height);
      for (const ann of (annotations[pageNum] || [])) drawAnnotation(ctx, ann, scale);
      if (extra) drawAnnotation(ctx, extra, scale);
    };

    const onDown = (e) => {
      if (e.touches && e.touches.length >= 2) {
        activeAnnotRef.current = null; // cancel any in-progress stroke
        return;
      }
      if (fingerScrollOnly && e.touches && !isStylusTouch(e)) return; // hand mode: a finger only scrolls, never draws
      if (drawTextBusy) return;
      if (annotTool === "text") {
        const p = toCanvas(e);
        setAnnotTextInput({ vx: p.vx, vy: p.vy, cx: p.x, cy: p.y });
        setAnnotTextVal("");
        return;
      }
      const p = toCanvas(e);
      let strokeColor = annotColor;
      if (autoContrast && annotTool !== "eraser") {
        const pageCanvas = canvasRef.current;
        if (pageCanvas) {
          const scale = getScale();
          strokeColor = bestContrastColor(sampleAreaColor(pageCanvas, p.x * scale, p.y * scale));
          setAnnotColor(strokeColor);
        }
      }
      if (annotTool === "highlight") {
        const alignedRange = highlightMode === "line" ? getTextAlignedHighlightRange(e) : null;
        const firstPoint = highlightMode === "line"
          ? (alignedRange || getTextAlignedHighlightPoint(e))
          : p;
        activeAnnotRef.current = {
          type: "highlight",
          color: strokeColor,
          lineWidth: (firstPoint.lineWidth || annotSize / getScale()),
          mode: highlightMode,
          opacity: annotOpacity / 100,
          highlightSettings: DEFAULT_HIGHLIGHT_SETTINGS,
          taperEnds: highlightTaperEnds,
          lineCenterY: highlightMode === "line" && firstPoint.textAligned ? firstPoint.y : null,
          autoWidthLocked: Boolean(highlightMode === "line" && highlightAutoWidth && alignedRange),
          points: highlightMode === "line" && highlightAutoWidth && alignedRange
            ? [
                { x: alignedRange.startX, y: firstPoint.y },
                { x: alignedRange.endX, y: firstPoint.y },
              ]
            : [{ x: firstPoint.x, y: firstPoint.y }],
        };
      } else if (["underline","strikethrough","rect","circle"].includes(annotTool)) {
        activeAnnotRef.current = { type: annotTool, color: strokeColor, x: p.x, y: p.y, w: 0, h: 0, _sx: p.x, _sy: p.y };
      } else if (annotTool === "drawText") {
        activeAnnotRef.current = { type: "drawTextSelection", color: strokeColor, x: p.x, y: p.y, w: 0, h: 0, _sx: p.x, _sy: p.y };
      } else if (["line","arrow"].includes(annotTool)) {
        activeAnnotRef.current = {
          type: annotTool, color: strokeColor, x1: p.x, y1: p.y, x2: p.x, y2: p.y,
          ...(annotTool === "arrow" ? { lineWidth: arrowSize / getScale() } : {}),
        };
      } else if (annotTool === "pen") {
        activeAnnotRef.current = {
          type: "pen",
          color: strokeColor,
          lineWidth: penSize / getScale(),
          penType,
          penSettings: {
            stabilization: penStabilization,
            pressureAssist: penPressureAssist,
            taper: penTaper,
            flow: penFlow,
            border: penBorder,
            nibAngle: penNibAngle,
            nibSpread: penNibSpread,
          },
          points: [{ x: p.x, y: p.y, t: p.t, pressure: p.pressure }],
        };
      } else if (annotTool === "eraser") {
        activeAnnotRef.current = { type: "eraser", erasedCount: 0 };
        const er = eraserSize / getScale();
        setAnnotations((prev) => {
          const pts = [...(prev[pageNum] || [])];
          const kept = pts.filter((a) => {
            if (a.type === "pen" || a.type === "highlight") return !a.points.some((pt) => Math.hypot(pt.x - p.x, pt.y - p.y) < er);
            const cx2 = (a.x ?? a.x1 ?? 0), cy2 = (a.y ?? a.y1 ?? 0);
            return Math.hypot(cx2 - p.x, cy2 - p.y) > er;
          });
          activeAnnotRef.current.erasedCount += pts.length - kept.length;
          return { ...prev, [pageNum]: kept };
        });
        setRedoStacks((prev) => (prev[pageNum]?.length ? { ...prev, [pageNum]: [] } : prev));
      }
    };

    const onMove = (e) => {
      if (e.touches && e.touches.length >= 2) {
        activeAnnotRef.current = null;
        return;
      }
      const ann = activeAnnotRef.current;
      if (!ann) return;
      const p = toCanvas(e);
      if (ann.type === "pen" || ann.type === "highlight") {
        if (ann.mode === "line") {
          if (ann.type === "highlight" && ann.autoWidthLocked) {
            redraw(ann);
            return;
          }
          const linePoint = ann.type === "highlight"
            ? getTextAlignedHighlightPoint(e, ann.lineCenterY)
            : p;
          if (ann.type === "highlight" && linePoint.textAligned && ann.lineCenterY == null) ann.lineCenterY = linePoint.y;
          if (ann.type === "highlight" && linePoint.lineWidth) ann.lineWidth = Math.max(ann.lineWidth || 0, linePoint.lineWidth);
          const lockedY = ann.type === "highlight" && ann.lineCenterY != null ? ann.lineCenterY : linePoint.y;
          if (ann.type === "highlight" && ann.points[0]) ann.points[0].y = lockedY;
          ann.points[1] = { x: linePoint.x, y: lockedY };
        } else {
          const nextPoint = ann.type === "pen"
            ? smoothStrokePoint(
                ann.points,
                { x: p.x, y: p.y, t: p.t, pressure: p.pressure },
                ann.penSettings?.stabilization ?? penStabilization
              )
            : { x: p.x, y: p.y };
          if (!nextPoint) return;
          ann.points.push(nextPoint);
        }
        redraw(ann);
      } else if (["underline","strikethrough","rect","circle","drawTextSelection"].includes(ann.type)) {
        ann.x = Math.min(ann._sx, p.x); ann.y = Math.min(ann._sy, p.y);
        ann.w = Math.abs(p.x - ann._sx); ann.h = Math.abs(p.y - ann._sy);
        redraw(ann);
      } else if (["line","arrow"].includes(ann.type)) {
        ann.x2 = p.x; ann.y2 = p.y;
        redraw(ann);
      } else if (ann.type === "eraser") {
        const er = eraserSize / getScale();
        setAnnotations((prev) => {
          const pts = [...(prev[pageNum] || [])];
          const kept = pts.filter((a) => {
            if (a.type === "pen" || a.type === "highlight") return !a.points.some((pt) => Math.hypot(pt.x - p.x, pt.y - p.y) < er);
            const cx2 = (a.x ?? a.x1 ?? 0), cy2 = (a.y ?? a.y1 ?? 0);
            return Math.hypot(cx2 - p.x, cy2 - p.y) > er;
          });
          ann.erasedCount = (ann.erasedCount || 0) + (pts.length - kept.length);
          return { ...prev, [pageNum]: kept };
        });
        setRedoStacks((prev) => (prev[pageNum]?.length ? { ...prev, [pageNum]: [] } : prev));
      }
    };

    const onUp = () => {
      const ann = activeAnnotRef.current;
      activeAnnotRef.current = null;
      if (!ann) return;
      if (ann.type === "eraser") {
        if (ann.erasedCount > 0) logAnnotHistory({ action: "erase", page: pageNum, count: ann.erasedCount });
        return;
      }
      if (ann.type === "pen") {
        ann.points = finalizePenStroke(
          ann.points,
          ann.penSettings ?? DEFAULT_PEN_SETTINGS,
          ann.penType ?? penType
        );
      }
      if (ann.type === "drawTextSelection") {
        if (ann.w < 8 || ann.h < 8) return;
        const { _sx, _sy, ...selection } = ann;
        void runDrawToTextRecognition(selection);
        redraw();
        return;
      }
      // ignore accidental tiny marks
      const tiny = ann.type === "pen"
        ? ann.points.length < 3
        : ["line","arrow"].includes(ann.type)
          ? Math.hypot(ann.x2 - ann.x1, ann.y2 - ann.y1) < 3
          : ann.w < 3 && ann.h < 3;
      if (tiny) return;
      const { _sx, _sy, ...clean } = ann;
      setAnnotations((prev) => ({ ...prev, [pageNum]: [...(prev[pageNum] || []), { ...clean, id: Date.now() }] }));
      setRedoStacks((prev) => (prev[pageNum]?.length ? { ...prev, [pageNum]: [] } : prev));
      logAnnotHistory({ action: "add", type: clean.type, page: pageNum, color: clean.color, size: clean.lineWidth ? Math.round(clean.lineWidth * (fitScaleRef.current * zoomRef.current)) : null });
    };

    ac.addEventListener("mousedown",  onDown, { passive: true });
    ac.addEventListener("mousemove",  onMove, { passive: true });
    ac.addEventListener("mouseup",    onUp);
    ac.addEventListener("touchstart", onDown, { passive: true });
    ac.addEventListener("touchmove",  onMove, { passive: true });
    ac.addEventListener("touchend",   onUp);
    return () => {
      ac.removeEventListener("mousedown",  onDown);
      ac.removeEventListener("mousemove",  onMove);
      ac.removeEventListener("mouseup",    onUp);
      ac.removeEventListener("touchstart", onDown);
      ac.removeEventListener("touchmove",  onMove);
      ac.removeEventListener("touchend",   onUp);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotTool, annotColor, annotSize, penSize, arrowSize, penStabilization, penPressureAssist, penTaper, penFlow, penBorder, penNibAngle, penNibSpread, penType, eraserSize, highlightMode, highlightAutoWidth, highlightTaperEnds, pageNum, annotations, fingerScrollOnly, autoContrast, annotOpacity, logAnnotHistory, drawTextBusy, runDrawToTextRecognition]);

  const commitAnnotText = useCallback(() => {
    if (!annotTextInput || !annotTextVal.trim()) { setAnnotTextInput(null); return; }
    const scale = fitScaleRef.current * zoomRef.current;
    setAnnotations((prev) => ({
      ...prev,
      [pageNum]: [...(prev[pageNum] || []), {
        id: Date.now(), type: "text", color: annotColor,
        x: annotTextInput.cx / scale, y: annotTextInput.cy / scale,
        text: annotTextVal, fontSize: 16 / scale,
      }],
    }));
    setRedoStacks((prev) => (prev[pageNum]?.length ? { ...prev, [pageNum]: [] } : prev));
    logAnnotHistory({ action: "add", type: "text", page: pageNum, color: annotColor });
    setAnnotTextInput(null); setAnnotTextVal("");
  }, [annotTextInput, annotTextVal, annotColor, pageNum, logAnnotHistory]);

  const handleAnnotUndo = useCallback(() => {
    const arr = annotations[pageNum] || [];
    if (arr.length === 0) return;
    const popped = arr[arr.length - 1];
    setAnnotations((prev) => ({ ...prev, [pageNum]: (prev[pageNum] || []).slice(0, -1) }));
    setRedoStacks((prev) => ({ ...prev, [pageNum]: [...(prev[pageNum] || []), popped] }));
    logAnnotHistory({ action: "undo", type: popped.type, page: pageNum });
  }, [pageNum, annotations, logAnnotHistory]);

  const handleAnnotRedo = useCallback(() => {
    const stack = redoStacks[pageNum] || [];
    if (stack.length === 0) return;
    const restored = stack[stack.length - 1];
    setRedoStacks((prev) => ({ ...prev, [pageNum]: prev[pageNum].slice(0, -1) }));
    setAnnotations((prev) => ({ ...prev, [pageNum]: [...(prev[pageNum] || []), restored] }));
    logAnnotHistory({ action: "redo", type: restored.type, page: pageNum });
  }, [pageNum, redoStacks, logAnnotHistory]);

  const handleAnnotClear = useCallback(() => {
    const count = (annotations[pageNum] || []).length;
    setAnnotations((prev) => ({ ...prev, [pageNum]: [] }));
    setRedoStacks((prev) => (prev[pageNum]?.length ? { ...prev, [pageNum]: [] } : prev));
    if (count > 0) logAnnotHistory({ action: "clear", page: pageNum, count });
  }, [pageNum, annotations, logAnnotHistory]);

  // ── Ctrl+Scroll to zoom ────────────────────────────────────────────────────
  useEffect(() => {
    const el = previewRef.current;
    if (!el || !pdfDoc) return;
    const commitWheelZoom = () => {
      const state = wheelZoomStateRef.current;
      const wrap = canvasWrapRef.current;
      if (state.timer) {
        clearTimeout(state.timer);
        state.timer = null;
      }
      if (!wrap) return;
      const finalZoom = normalizePinchZoom(state.pendingZoom);
      const ratio = finalZoom / state.baseZoom;
      scrollAfterZoomRef.current = {
        left: (state.startSL + state.midX) * ratio - state.midX,
        top: (state.startST + state.midY) * ratio - state.midY,
      };
      setZoom(finalZoom);
    };
    const onWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const wrap = canvasWrapRef.current;
      if (!wrap) return;
      const state = wheelZoomStateRef.current;
      const delta = e.deltaY < 0 ? 1.08 : 1 / 1.08;

      if (!state.timer) {
        state.baseZoom = zoomRef.current;
        state.pendingZoom = zoomRef.current;
        state.startSL = el.scrollLeft;
        state.startST = el.scrollTop;
      }

      state.midX = e.clientX - rect.left;
      state.midY = e.clientY - rect.top;
      const wrapRect = wrap.getBoundingClientRect();
      state.originX = e.clientX - wrapRect.left;
      state.originY = e.clientY - wrapRect.top;
      state.pendingZoom = normalizePinchZoom(state.pendingZoom * delta);

      wrap.style.transformOrigin = `${state.originX}px ${state.originY}px`;
      wrap.style.transform = `scale(${state.pendingZoom / state.baseZoom})`;

      if (state.timer) clearTimeout(state.timer);
      state.timer = setTimeout(commitWheelZoom, 70);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      const state = wheelZoomStateRef.current;
      if (state.timer) {
        clearTimeout(state.timer);
        state.timer = null;
      }
      el.removeEventListener("wheel", onWheel);
    };
  }, [pdfDoc, handleAnnotUndo]);

  const zoomToPoint = useCallback((clientX, clientY, nextZoom) => {
    const el = previewRef.current;
    const baseZoom  = zoomRef.current;
    const rawTarget = typeof nextZoom === "function" ? nextZoom(baseZoom) : nextZoom;
    const clamped   = normalizeZoom(rawTarget);
    if (!el) { setZoom(clamped); return; }
    const rect = el.getBoundingClientRect();
    const ratio = clamped / baseZoom;
    const midX  = clientX - rect.left;
    const midY  = clientY - rect.top;
    scrollAfterZoomRef.current = {
      left: (el.scrollLeft + midX) * ratio - midX,
      top:  (el.scrollTop  + midY) * ratio - midY,
    };
    setZoom(clamped);
  }, []);

  const zoomFromCenter = useCallback((nextZoom) => {
    const el = previewRef.current;
    if (!el) {
      const baseZoom  = zoomRef.current;
      const rawTarget = typeof nextZoom === "function" ? nextZoom(baseZoom) : nextZoom;
      setZoom(normalizeZoom(rawTarget));
      return;
    }
    zoomToPoint(
      el.getBoundingClientRect().left + el.clientWidth / 2,
      el.getBoundingClientRect().top + el.clientHeight / 2,
      nextZoom
    );
  }, [zoomToPoint]);

  const stopZoomHold = useCallback(() => {
    if (zoomHoldTimerRef.current) {
      clearTimeout(zoomHoldTimerRef.current);
      zoomHoldTimerRef.current = null;
    }
    if (zoomHoldIntervalRef.current) {
      clearInterval(zoomHoldIntervalRef.current);
      zoomHoldIntervalRef.current = null;
    }
  }, []);

  const startZoomHold = useCallback((step) => {
    stopZoomHold();
    zoomHoldTimerRef.current = setTimeout(() => {
      zoomHoldTimerRef.current = null;
      zoomHoldIntervalRef.current = setInterval(() => {
        zoomFromCenter((z) => z + step);
      }, 48);
    }, 220);
  }, [stopZoomHold, zoomFromCenter]);

  useEffect(() => {
    const stop = () => stopZoomHold();
    window.addEventListener("mouseup", stop);
    window.addEventListener("touchend", stop, { passive: true });
    window.addEventListener("touchcancel", stop, { passive: true });
    return () => {
      window.removeEventListener("mouseup", stop);
      window.removeEventListener("touchend", stop);
      window.removeEventListener("touchcancel", stop);
      stopZoomHold();
    };
  }, [stopZoomHold]);

  // ── Two-finger pinch zoom + single-finger pan + tap word selection ─────────
  useEffect(() => {
    const el = previewRef.current;
    if (!el || !pdfDoc) return;

    const MOVE_THRESHOLD = 8;
    const TWO_FINGER_UNDO_MOVE_THRESHOLD = 34;
    const TWO_FINGER_UNDO_MAX_MS = 420;
    const PINCH_COOLDOWN_MS = 350;
    const MIN_PINCH_START_DIST = 28;
    const PINCH_JITTER_PX = 3;

    let lastMidX = 0, lastMidY = 0;
    let twoFingerUndoCandidate = null;
    let startDist = null;
    let pinchPrimed = false;
    let startZoom = 1;
    let startMidX = 0, startMidY = 0, startSL = 0, startST = 0;
    let lastPinchZoom = 1;
    let pinchCooldownUntil = 0;
    let pinchTransformApplied = false;

    const fireTwoFingerUndo = () => {
      if (twoFingerUndoCandidate?.timer) clearTimeout(twoFingerUndoCandidate.timer);
      twoFingerUndoCandidate = null;
      handleAnnotUndo();
      clearTimeout(lpTimer); lpTimer = null;
      clearTimeout(lpRefineTimer); lpRefineTimer = null;
      navigator.vibrate?.(20);
    };

    let panX = 0, panY = 0, panSL = 0, panST = 0;
    let hasMoved = false;
    let touchInteractionActive = false;

    let lpTimer = null;
    let lpRefineTimer = null;
    let isLpSelecting = false;
    let lpStartSpanIdx = -1;
    let lpWordLocked = false;
    let lpLockX = 0, lpLockY = 0;
    const LP_EXPAND_THRESHOLD = 14;
    const LP_REFINE_DELAY = 320;

    const touchDist = (t) => {
      const dx = t[0].clientX - t[1].clientX;
      const dy = t[0].clientY - t[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };

    // Mirrors the ctrl+scroll zoom path: during the gesture we only push a
    // cheap CSS transform on the canvas wrapper (no React re-render, no PDF.js
    // re-rasterization) so the live pinch tracks the fingers at 60fps instead
    // of jittering on every touchmove; the real (expensive) setZoom + redraw
    // happens once, when the fingers lift.
    const commitPinchZoom = () => {
      if (!pinchPrimed || lastPinchZoom === startZoom) {
        // Nothing actually changed — no re-render is coming to strip the
        // preview transform, so clean it up here instead.
        const wrap = canvasWrapRef.current;
        if (wrap) {
          wrap.style.transform       = "";
          wrap.style.transformOrigin = "";
          wrap.style.willChange      = "";
        }
        pinchTransformApplied = false;
        return;
      }
      const ratio = lastPinchZoom / startZoom;
      scrollAfterZoomRef.current = {
        left: (startSL + startMidX) * ratio - lastMidX,
        top: (startST + startMidY) * ratio - lastMidY,
      };
      setZoom(lastPinchZoom);
      // The preview transform stays in place until the [zoom] effect swaps it
      // for the real scroll position in the same frame the new raster paints
      // — clearing it here would flash back to the pre-zoom size first.
      pinchTransformApplied = false;
    };

    const selectWordAt = (cx, cy) => {
      const target = document.elementFromPoint(cx, cy);
      const layer  = textLayerRef.current;
      if (!target || !layer || !layer.contains(target)) return null;

      const textNode = target.firstChild;
      if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return null;
      const text = textNode.textContent;
      if (!text.trim()) return null;

      const spanIdx = parseInt(target.dataset.spanIdx ?? "-1", 10);
      if (spanIdx < 0) return null;

      const r     = target.getBoundingClientRect();
      const ratio = r.width > 0 ? (cx - r.left) / r.width : 0;
      let s = Math.round(ratio * text.length);
      let e = s;
      while (s > 0          && /\S/.test(text[s - 1])) s--;
      while (e < text.length && /\S/.test(text[e]))     e++;
      if (s === e) return null;

      const spans = spansRef.current;
      let loIdx = spanIdx, hiIdx = spanIdx;
      if (s === 0) {
        while (loIdx > 0 && !/\s$/.test(spans[loIdx - 1]?.el.textContent || " ")) loIdx--;
      }
      if (e === text.length) {
        while (hiIdx < spans.length - 1 && !/^\s/.test(spans[hiIdx + 1]?.el.textContent || " ")) hiIdx++;
      }

      const parts = [
        ...spans.slice(loIdx, spanIdx).map((sp) => sp.el.textContent),
        text.substring(s, e),
        ...spans.slice(spanIdx + 1, hiIdx + 1).map((sp) => sp.el.textContent),
      ];
      const word = sanitizeSelectedText(parts.join(""));
      if (!word) return null;
      window.getSelection()?.removeAllRanges();

      const bx = parseFloat(target.style.left || "0") + (parseFloat(target.style.width || "0") || target.offsetWidth || 0) / 2;
      const by = parseFloat(target.style.top || "0") + parseFloat(target.style.height || "0") + 8;
      return { text: word, spanIdx: loIdx, endIdx: hiIdx, x: bx, y: by };
    };

    const onTouchStart = (e) => {
      if (e.target.closest?.(".sel_handle")) return;

      if (e.touches.length === 2) {
        clearTimeout(lpTimer); lpTimer = null; isLpSelecting = false;
        const elRect = el.getBoundingClientRect();
        startDist = touchDist(e.touches);
        pinchPrimed = startDist >= MIN_PINCH_START_DIST;
        startZoom = zoomRef.current;
        lastPinchZoom = startZoom;
        lastMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - elRect.left;
        lastMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - elRect.top;
        startMidX = lastMidX;
        startMidY = lastMidY;
        startSL = el.scrollLeft;
        startST = el.scrollTop;
        twoFingerUndoCandidate = {
          startedAt: Date.now(),
          startDist,
          startMidX: lastMidX,
          startMidY: lastMidY,
          timer: setTimeout(() => {
            if (!twoFingerUndoCandidate) return;
            fireTwoFingerUndo();
          }, 180),
        };
      } else if (e.touches.length === 1) {
        touchInteractionActive = true;
        if (Date.now() < pinchCooldownUntil) return;
        if (fingerScrollOnlyRef.current && isStylusTouch(e)) return;
        panX = e.touches[0].clientX;
        panY = e.touches[0].clientY;
        panSL = el.scrollLeft;
        panST = el.scrollTop;
        hasMoved = false;
        isLpSelecting = false;
        lpWordLocked = false;

        if (textSelectableRef.current) {
          const ct = e.touches[0];
          lpTimer = setTimeout(() => {
            lpTimer = null;
            const target = document.elementFromPoint(ct.clientX, ct.clientY);
            const layer  = textLayerRef.current;
            if (!target || !layer || !layer.contains(target)) return;
            const spanIdx = parseInt(target.dataset.spanIdx ?? "-1", 10);
            if (spanIdx < 0) return;

            const curSel = manualSelectionRef.current;
            if (curSel) {
              const lo = Math.min(curSel.startIdx, curSel.endIdx);
              const hi = Math.max(curSel.startIdx, curSel.endIdx);
              if (spanIdx >= lo && spanIdx <= hi) {
                navigator.vibrate?.(30);
                setDragHandle(spanIdx <= (lo + hi) / 2 ? "start" : "end");
                return;
              }
            }

            const lpSpans = spansRef.current;
            let loIdx = spanIdx, hiIdx = spanIdx;
            while (loIdx > 0 && !/\s$/.test(lpSpans[loIdx - 1]?.el.textContent || " ")) loIdx--;
            while (hiIdx < lpSpans.length - 1 && !/^\s/.test(lpSpans[hiIdx + 1]?.el.textContent || " ")) hiIdx++;
            const fromNode = lpSpans[loIdx]?.el.firstChild;
            const toNode   = lpSpans[hiIdx]?.el.firstChild;
            if (fromNode && fromNode.nodeType === Node.TEXT_NODE &&
                toNode   && toNode.nodeType   === Node.TEXT_NODE) {
              const range = document.createRange();
              range.setStart(fromNode, 0);
              range.setEnd(toNode, toNode.textContent.length);
              window.getSelection()?.removeAllRanges();
              const text = getSpanRangeText(loIdx, hiIdx);
              if (!text) return;
              const vr = range.getBoundingClientRect();
              if (hideHyleControls || onSelectionActionRef.current) {
                setManualSelection({ startIdx: loIdx, endIdx: hiIdx, text, x: vr.left + vr.width / 2, y: vr.bottom + 8 });
              } else {
                const noun = text.toLowerCase().replace(/[.,;:]+$/, "").replace(/\s+/g, " ").trim();
                setManualHyle(noun);
                setManualPopup({ x: vr.left + vr.width / 2, y: vr.bottom + 10 });
                setManualSelection(null);
              }
              lpWordLocked = true;
              lpStartSpanIdx = loIdx;
              lpLockX = ct.clientX;
              lpLockY = ct.clientY;
              clearTimeout(lpRefineTimer);
              lpRefineTimer = setTimeout(() => {
                if (!lpWordLocked) return;
                const exact = selectWordAt(ct.clientX, ct.clientY);
                if (!exact) return;
                if (hideHyleControls || onSelectionActionRef.current) {
                  setManualSelection({
                    startIdx: exact.spanIdx,
                    endIdx: exact.endIdx,
                    text: exact.text,
                    x: exact.x,
                    y: exact.y,
                  });
                } else {
                  const noun = exact.text.toLowerCase().replace(/[.,;:]+$/, "").replace(/\s+/g, " ").trim();
                  setManualHyle(noun);
                  setManualPopup({ x: exact.x, y: exact.y + 2 });
                  setManualSelection(null);
                }
                lpStartSpanIdx = exact.spanIdx;
              }, LP_REFINE_DELAY);
              navigator.vibrate?.(30);
            }
          }, 400);
        }
      }
    };

    const onTouchMove = (e) => {
      if (e.touches.length === 2 && twoFingerUndoCandidate) {
        clearTimeout(lpTimer); lpTimer = null; isLpSelecting = false;
        e.preventDefault();
        const nextDist = touchDist(e.touches);
        const elRect = el.getBoundingClientRect();
        lastMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - elRect.left;
        lastMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - elRect.top;
        const movedFar =
          Math.abs(nextDist - twoFingerUndoCandidate.startDist) > TWO_FINGER_UNDO_MOVE_THRESHOLD ||
          Math.hypot(lastMidX - twoFingerUndoCandidate.startMidX, lastMidY - twoFingerUndoCandidate.startMidY) > TWO_FINGER_UNDO_MOVE_THRESHOLD;
        if (movedFar) {
          if (twoFingerUndoCandidate.timer) clearTimeout(twoFingerUndoCandidate.timer);
          twoFingerUndoCandidate = null;
        }
        if (startDist !== null) {
          if (!pinchPrimed) {
            if (nextDist < MIN_PINCH_START_DIST) return;
            startDist = nextDist;
            startZoom = zoomRef.current;
            startMidX = lastMidX;
            startMidY = lastMidY;
            startSL = el.scrollLeft;
            startST = el.scrollTop;
            lastPinchZoom = startZoom;
            pinchPrimed = true;
            return;
          }
          if (Math.abs(nextDist - startDist) < PINCH_JITTER_PX) return;
          const rawRatio = Math.max(0.01, nextDist / startDist);
          const newZoom = normalizePinchZoom(startZoom * rawRatio);
          if (newZoom === lastPinchZoom) return;
          lastPinchZoom = newZoom;
          const wrap = canvasWrapRef.current;
          if (wrap) {
            const wrapRect = wrap.getBoundingClientRect();
            const originX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - wrapRect.left;
            const originY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - wrapRect.top;
            wrap.style.willChange      = "transform";
            wrap.style.transformOrigin = `${originX}px ${originY}px`;
            wrap.style.transform       = `scale(${newZoom / startZoom})`;
            pinchTransformApplied = true;
          }
        }
        return;
      }
      if (e.touches.length !== 1) return;
      if (Date.now() < pinchCooldownUntil) return;
      if (fingerScrollOnlyRef.current && isStylusTouch(e)) return;

      if (dragHandleRef.current) {
        clearTimeout(lpRefineTimer); lpRefineTimer = null;
        e.preventDefault();
        const ct = e.touches[0];
        const target = document.elementFromPoint(ct.clientX, ct.clientY);
        const layer  = textLayerRef.current;
        if (!target || !layer || !layer.contains(target)) return;
        const idx = parseInt(target.dataset.spanIdx ?? "-1", 10);
        if (idx < 0) return;
        const which = dragHandleRef.current;
        setManualSelection((sel) => {
          if (!sel) return sel;
          if (which === "start") {
            const newStart = Math.min(idx, sel.endIdx);
            return { ...sel, startIdx: newStart, text: getSpanRangeText(newStart, sel.endIdx) };
          }
          const newEnd = Math.max(idx, sel.startIdx);
          return { ...sel, endIdx: newEnd, text: getSpanRangeText(sel.startIdx, newEnd) };
        });
        return;
      }

      if (lpWordLocked) {
        e.preventDefault();
        const dx = e.touches[0].clientX - lpLockX;
        const dy = e.touches[0].clientY - lpLockY;
        if (Math.hypot(dx, dy) < LP_EXPAND_THRESHOLD) return;
        clearTimeout(lpRefineTimer); lpRefineTimer = null;
        lpWordLocked = false;
        isLpSelecting = true;
      }

      if (isLpSelecting) {
        e.preventDefault();
        const ct  = e.touches[0];
        const target = document.elementFromPoint(ct.clientX, ct.clientY);
        const layer  = textLayerRef.current;
        if (target && layer && layer.contains(target)) {
          const spanIdx = parseInt(target.dataset.spanIdx ?? "-1", 10);
          if (spanIdx >= 0 && lpStartSpanIdx >= 0) {
            const fromIdx = Math.min(lpStartSpanIdx, spanIdx);
            const toIdx   = Math.max(lpStartSpanIdx, spanIdx);
            const fromEl  = spansRef.current[fromIdx]?.el;
            const toEl    = spansRef.current[toIdx]?.el;
            if (fromEl?.firstChild && toEl?.firstChild) {
              const range = document.createRange();
              range.setStart(fromEl.firstChild, 0);
              range.setEnd(toEl.firstChild, toEl.firstChild.textContent.length);
              window.getSelection()?.removeAllRanges();
              const text = getSpanRangeText(fromIdx, toIdx);
              const vr = range.getBoundingClientRect();
              if (text) {
                if (hideHyleControls || onSelectionActionRef.current) {
                  setManualSelection({ startIdx: fromIdx, endIdx: toIdx, text, x: vr.left + vr.width / 2, y: vr.bottom + 8 });
                } else {
                  const noun = text.toLowerCase().replace(/[.,;:]+$/, "").replace(/\s+/g, " ").trim();
                  setManualHyle(noun);
                  setManualPopup({ x: vr.left + vr.width / 2, y: vr.bottom + 10 });
                  setManualSelection(null);
                }
              }
            }
          }
        }
        return;
      }

      const dx = e.touches[0].clientX - panX;
      const dy = e.touches[0].clientY - panY;
      const moved = Math.sqrt(dx * dx + dy * dy);
      if (!hasMoved && moved < MOVE_THRESHOLD) return;

      clearTimeout(lpTimer); lpTimer = null;
      hasMoved = true;
      e.preventDefault();
      el.scrollLeft = panSL - dx;
      el.scrollTop  = panST - dy;
    };

    const onTouchEnd = (e) => {
      touchInteractionActive = e.touches.length > 0;
      if (dragHandleRef.current) {
        dragHandleRef.current = null;
        setDragHandle(null);
        return;
      }

      if (e.touches.length < 2 && twoFingerUndoCandidate) {
        if (Date.now() - twoFingerUndoCandidate.startedAt <= TWO_FINGER_UNDO_MAX_MS) {
          fireTwoFingerUndo();
          return;
        }
        if (twoFingerUndoCandidate.timer) clearTimeout(twoFingerUndoCandidate.timer);
        twoFingerUndoCandidate = null;
      }
      clearTimeout(lpTimer); lpTimer = null;
      clearTimeout(lpRefineTimer); lpRefineTimer = null;

      if (e.touches.length < 2 && startDist !== null) {
        commitPinchZoom();
        startDist = null;
        pinchCooldownUntil = Date.now() + PINCH_COOLDOWN_MS;
        pinchPrimed = false;
      }

      if (lpWordLocked) { lpWordLocked = false; window.getSelection()?.removeAllRanges(); return; }

      if (isLpSelecting) {
        isLpSelecting = false;
        window.getSelection()?.removeAllRanges();
      }
      if (e.touches.length === 0) touchInteractionActive = false;
    };

    const onContextMenu = (e) => e.preventDefault();
    const onSelectStart = (e) => {
      if (touchInteractionActive || annotTool) e.preventDefault();
    };

    el.addEventListener("touchstart",  onTouchStart,  { passive: true });
    el.addEventListener("touchmove",   onTouchMove,   { passive: false });
    el.addEventListener("touchend",    onTouchEnd,    { passive: true });
    el.addEventListener("touchcancel", onTouchEnd,    { passive: true });
    el.addEventListener("contextmenu", onContextMenu);
    el.addEventListener("selectstart", onSelectStart);

    return () => {
      if (twoFingerUndoCandidate?.timer) clearTimeout(twoFingerUndoCandidate.timer);
      clearTimeout(lpTimer);
      clearTimeout(lpRefineTimer);
      if (pinchTransformApplied) {
        const wrap = canvasWrapRef.current;
        if (wrap) {
          wrap.style.transform       = "";
          wrap.style.transformOrigin = "";
          wrap.style.willChange      = "";
        }
      }
      el.removeEventListener("touchstart",  onTouchStart);
      el.removeEventListener("touchmove",   onTouchMove);
      el.removeEventListener("touchend",    onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
      el.removeEventListener("contextmenu", onContextMenu);
      el.removeEventListener("selectstart", onSelectStart);
    };
  }, [pdfDoc]);

  // ── Mouse drag to pan ──────────────────────────────────────────────────────
  useEffect(() => {
    const el = previewRef.current;
    if (!el || !pdfDoc) return;

    let dragging = false;
    let armed = false;
    let startX = 0, startY = 0, scrollL = 0, scrollT = 0;
    const PAN_THRESHOLD = 6;

    const onMouseDown = (e) => {
      if (e.button !== 0) return;
      const tag = e.target.tagName;
      if (tag === "BUTTON" || tag === "SELECT" || tag === "INPUT" || tag === "A") return;
      if (e.target.closest?.(".sel_handle, #manual_select_bar, #annot_text_input")) return;

      armed = true;
      dragging = false;
      startX   = e.clientX;
      startY   = e.clientY;
      scrollL  = el.scrollLeft;
      scrollT  = el.scrollTop;
      suppressTextSelectionRef.current = false;
    };

    const onMouseMove = (e) => {
      if (!armed && !dragging) return;
      if (!dragging) {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (Math.hypot(dx, dy) < PAN_THRESHOLD) return;
        dragging = true;
        suppressTextSelectionRef.current = true;
        el.style.cursor = "grabbing";
        el.style.userSelect = "none";
      }
      if (!dragging) return;
      el.scrollLeft = scrollL - (e.clientX - startX);
      el.scrollTop  = scrollT - (e.clientY - startY);
      e.preventDefault();
    };

    const onMouseUp = () => {
      armed = false;
      if (!dragging) return;
      dragging            = false;
      el.style.cursor     = "";
      el.style.userSelect = "";
      requestAnimationFrame(() => {
        suppressTextSelectionRef.current = false;
      });
    };

    el.addEventListener("mousedown", onMouseDown);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup",   onMouseUp);

    return () => {
      el.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup",   onMouseUp);
    };
  }, [pdfDoc]);

  // ── Render text layer for Manual mode (or a plain reader that still needs word-selection) ──
  useEffect(() => {
    const div = textLayerRef.current;
    if (!textSelectable || !pdfDoc || !div) return;
    if (!pageViewport) return;
    div.innerHTML = "";
    spansRef.current = [];
    setManualSelection(null);
    let cancelled = false;

    pdfDoc.getPage(pageNum).then((page) =>
      page.getTextContent().then((content) => {
        if (cancelled || !textLayerRef.current) return;

        // Multiply two 2-D affine matrices (same as pdfjsLib.Util.transform).
        // vt = viewport.transform, it = item.transform → tx = vt × it
        const vt    = pageViewport.transform;
        const scale = Math.hypot(vt[0], vt[1]); // viewport scale (px per user-space unit)
        const mul   = ([a2, b2, c2, d2, e2, f2]) => [
          vt[0] * a2 + vt[2] * b2,
          vt[1] * a2 + vt[3] * b2,
          vt[0] * c2 + vt[2] * d2,
          vt[1] * c2 + vt[3] * d2,
          vt[0] * e2 + vt[2] * f2 + vt[4],
          vt[1] * e2 + vt[3] * f2 + vt[5],
        ];

        for (const item of content.items) {
          if (!item.str) continue;
          const tx       = mul(item.transform);
          const fontSize = Math.hypot(tx[0], tx[1]);
          if (fontSize < 1) continue;

          const angle      = Math.atan2(tx[1], tx[0]);
          const itemWidth  = item.width * scale; // PDF advance width → canvas pixels

	          const span = document.createElement("span");
	          span.dataset.spanIdx    = String(spansRef.current.length);
	          spansRef.current.push({
	            text: item.str,
	            el: span,
	            left: tx[4],
	            top: tx[5] - fontSize * 0.8,
	            height: fontSize,
	            width: itemWidth,
	          });
	          span.textContent        = item.str;
          span.style.position     = "absolute";
          span.style.left         = `${tx[4]}px`;
          span.style.top          = `${tx[5] - fontSize * 0.8}px`;
          span.style.height       = `${fontSize}px`;
          span.style.fontSize     = `${fontSize}px`;
          span.style.whiteSpace   = "pre";
          span.style.color        = "transparent";
          span.style.transformOrigin = "0% 0%";
          span.style.userSelect   = "text";
          span.style.webkitUserSelect = "text";
          if (itemWidth > 0)
            span.style.width = `${itemWidth}px`;
          if (Math.abs(angle) > 0.01)
            span.style.transform = `rotate(${angle}rad)`;
          div.appendChild(span);
        }
      })
    );

    return () => { cancelled = true; if (textLayerRef.current) textLayerRef.current.innerHTML = ""; };
  }, [textSelectable, pdfDoc, pageNum, pageViewport]);

  // Highlight selected text: group spans by line → one even rect per line.
  // Uses getBoundingClientRect() for real visual bounds (glyph height > em-size, width overflow, etc.)
  useEffect(() => {
    const spans = spansRef.current;
    const layer = textLayerRef.current;

    layer?.querySelectorAll(".sel_highlight").forEach((el) => el.remove());
    spans.forEach(({ el }) => el.classList.remove("span_selected"));

    if (!manualSelection || !layer) return;
    const lo = Math.min(manualSelection.startIdx, manualSelection.endIdx);
    const hi = Math.max(manualSelection.startIdx, manualSelection.endIdx);

    for (let i = lo; i <= hi; i++) spans[i]?.el?.classList.add("span_selected");

    const layerRect = layer.getBoundingClientRect();
    const bodyZoom  = parseFloat(document.body.style.zoom) || 1;

    const lines = [];
    for (let i = lo; i <= hi; i++) {
      const el = spans[i]?.el;
      if (!el) continue;

      // Canvas-local bounds from the span's explicit CSS geometry
      const r      = el.getBoundingClientRect();
      const left   = (r.left   - layerRect.left) / bodyZoom;
      const top    = (r.top    - layerRect.top)  / bodyZoom;
      const right  = (r.right  - layerRect.left) / bodyZoom;
      const bottom = (r.bottom - layerRect.top)  / bodyZoom;
      const h      = bottom - top;

      // PDF glyphs have ascenders/descenders that extend beyond the em-box.
      // Pad vertically so the highlight covers the real canvas-rendered glyph height.
      const padV = h * 0.25;

      // Cluster threshold scales with font size
      let line = lines.find((l) => Math.abs(l.refTop - top) < Math.max(8, h * 0.5));
      if (!line) { line = { refTop: top, minL: Infinity, maxR: -Infinity, minT: Infinity, maxB: -Infinity }; lines.push(line); }
      line.minL = Math.min(line.minL, left);
      line.maxR = Math.max(line.maxR, right);
      line.minT = Math.min(line.minT, top    - padV);
      line.maxB = Math.max(line.maxB, bottom + padV);
    }

    for (const l of lines) {
      const rect = document.createElement("div");
      rect.className           = "sel_highlight";
      rect.style.position      = "absolute";
      rect.style.left          = `${l.minL}px`;
      rect.style.top           = `${l.minT}px`;
      rect.style.width         = `${l.maxR - l.minL}px`;
      rect.style.height        = `${l.maxB - l.minT}px`;
      rect.style.background    = "rgba(56,139,253,0.35)";
      rect.style.borderRadius  = "2px";
      rect.style.pointerEvents = "none";
      rect.style.zIndex        = "1";
      layer.insertBefore(rect, layer.firstChild);
    }

    return () => { layer?.querySelectorAll(".sel_highlight").forEach((el) => el.remove()); };
  }, [manualSelection]);

  // Positions (canvas-space px) of the two drag handles, using real visual bounds
  const selHandles = useMemo(() => {
    if (!manualSelection) return null;
    const { startIdx, endIdx } = manualSelection;
    const lo  = Math.min(startIdx, endIdx);
    const hi  = Math.max(startIdx, endIdx);
    const sEl = spansRef.current[lo]?.el;
    const eEl = spansRef.current[hi]?.el;
    const layer = textLayerRef.current;
    if (!sEl || !eEl || !layer) return null;
    const layerRect = layer.getBoundingClientRect();
    const bodyZoom  = parseFloat(document.body.style.zoom) || 1;
    const sR = sEl.getBoundingClientRect();
    const eR = eEl.getBoundingClientRect();
    const toLocal = (r) => ({
      left:   (r.left   - layerRect.left) / bodyZoom,
      top:    (r.top    - layerRect.top)  / bodyZoom,
      right:  (r.right  - layerRect.left) / bodyZoom,
      bottom: (r.bottom - layerRect.top)  / bodyZoom,
    });
    const s    = toLocal(sR);
    const e    = toLocal(eR);
    const padS = (s.bottom - s.top) * 0.25;
    const padE = (e.bottom - e.top) * 0.25;
    return {
      start: { x: s.left,  y: s.top - padS, h: (s.bottom - s.top) + padS * 2 },
      end:   { x: e.right, y: e.top - padE, h: (e.bottom - e.top) + padE * 2 },
    };
  }, [manualSelection]);

  // Drag-handle events — attached while a handle is being dragged
  useEffect(() => {
    if (!dragHandle) return;

    // Kill native text selection for the duration of the drag
    const prev = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    window.getSelection()?.removeAllRanges();

    const onMove = (e) => {
      e.preventDefault();
      const cx = e.touches ? e.touches[0].clientX : e.clientX;
      const cy = e.touches ? e.touches[0].clientY : e.clientY;
      // Hit-test behind the handle (temporarily hide it so elementFromPoint sees the text layer)
      const target = document.elementFromPoint(cx, cy);
      const layer  = textLayerRef.current;
      if (!target || !layer || !layer.contains(target)) return;
      const idx = parseInt(target.dataset.spanIdx ?? "-1", 10);
      if (idx < 0) return;
      setManualSelection((sel) => {
        if (!sel) return sel;
        if (dragHandle === "start") {
          const newStart = Math.min(idx, sel.endIdx);
          const text = spansRef.current.slice(newStart, sel.endIdx + 1).map((s) => s.text).join(" ").trim();
          return { ...sel, startIdx: newStart, text };
        } else {
          const newEnd = Math.max(idx, sel.startIdx);
          const text = spansRef.current.slice(sel.startIdx, newEnd + 1).map((s) => s.text).join(" ").trim();
          return { ...sel, endIdx: newEnd, text };
        }
      });
    };
    const onUp = () => { dragHandleRef.current = null; setDragHandle(null); };

    // Touch drag is handled inline in #pdf_preview's native onTouchMove — only mouse needs window listeners
    window.addEventListener("mousemove", onMove, { passive: false });
    window.addEventListener("mouseup",   onUp);
    return () => {
      document.body.style.userSelect = prev;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",   onUp);
    };
  }, [dragHandle]);

  // ── Clear results on page change ───────────────────────────────────────────
  useEffect(() => {
    if (hyleData !== null && hylePage !== pageNum) {
      setHyleData(null);
      setExtractError("");
      setSavedId(null);
      setActiveHistoryId(null);
    }
    setManualPopup(null);
  }, [pageNum]);

  // ── Load PDF ───────────────────────────────────────────────────────────────
  const loadPdfBytes = useCallback(async (arrayBuffer, name) => {
    currentSourceIdRef.current = ""; // caller (loadFromSource) sets this back if applicable
    setLoading(true);
    setLoadError("");
    setFilename(name);
    setPdfDoc(null); setPdfType(null);
    setHyleData(null); setHylePage(null);
    setExtractError(""); setSavedId(null); setActiveHistoryId(null);
    setPageNum(1); setPageViewport(null); setZoom(1);
    renderTasksRef.current.forEach(t => t?.cancel());
    pageCanvasRefs.current = []; pageContainerRefs.current = [];
    pageViewportsRef.current = []; renderTasksRef.current = []; renderedScaleRef.current = []; renderedCssSizeRef.current = [];
    try {
      const doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      setPdfDoc(doc);
      setPageCount(doc.numPages);
      const sampleCount = Math.min(10, doc.numPages);
      const step        = Math.max(1, Math.floor(doc.numPages / sampleCount));
      let totalChars = 0, sampledPages = 0;
      for (let p = 1; p <= doc.numPages && sampledPages < sampleCount; p += step) {
        const pg      = await doc.getPage(p);
        const content = await pg.getTextContent();
        totalChars   += content.items.reduce((n, item) => n + item.str.length, 0);
        sampledPages++;
      }
      const charsPerPage = sampledPages > 0 ? totalChars / sampledPages : 0;
      setPdfType(charsPerPage < 50 ? "scanned" : charsPerPage < 300 ? "mixed" : "text-based");
    } catch {
      setLoadError("Could not open PDF.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadFile = useCallback(async (file) => {
    if (!file) return;
    if (file.type !== "application/pdf") {
      setLoadError("Please choose a PDF file.");
      return;
    }
    const arrayBuffer = await file.arrayBuffer();
    loadPdfBytes(arrayBuffer, file.name);
  }, [loadPdfBytes]);

  const loadFromSource = useCallback(async (sourceId, name) => {
    setLoading(true);
    setLoadError("");
    try {
      const res = await authFetch(apiUrl(`/api/sources/${sourceId}/download`));
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setLoadError(`Could not load PDF: ${data.error || res.status}`);
        setLoading(false);
        return;
      }
      const arrayBuffer = await res.arrayBuffer();
      await loadPdfBytes(arrayBuffer, name);
      currentSourceIdRef.current = sourceId;

      // Check (cheaply — no page param, but only reading the boolean) whether
      // this source was already converted to Markdown from the Sources table.
      setHasStoredMarkdown(false);
      try {
        const srcRes = await authFetch(apiUrl(`/api/sources/${sourceId}`));
        if (srcRes.ok) {
          const srcData = await srcRes.json();
          const source = srcData.source || {};
          setHasStoredMarkdown(Boolean(source.markdown) || (Array.isArray(source.markdownPages) && source.markdownPages.some((page) => String(page || "").trim())));
        }
      } catch {
        // best-effort — MD button just stays disabled if this check fails
      }

      // Restore any annotation session previously auto-saved for this source —
      // the SourceAnnotation model already existed server-side, just unused.
      try {
        const annRes = await authFetch(apiUrl(`/api/source-annotations/${sourceId}`));
        if (annRes.ok) {
          const annData = await annRes.json();
          skipNextAnnotationAutosaveRef.current = true; // suppress the autosave effect for this restore
          setAnnotations(annData.layers || {});
        }
      } catch {
        // best-effort restore — a failure here shouldn't block reading the PDF
      }
    } catch (err) {
      setLoadError(`Could not load PDF: ${err.message}`);
      setLoading(false);
    }
  }, [loadPdfBytes]);

  // ── Load from Sources page ────────────────────────────────────────────────
  useEffect(() => {
    if (embeddedSourceId) {
      const nextKey = `embedded:${embeddedSourceId}:${embeddedPdfName || "document.pdf"}`;
      if (lastLoadedSourceKeyRef.current === nextKey) return;
      lastLoadedSourceKeyRef.current = nextKey;
      loadFromSource(embeddedSourceId, embeddedPdfName || "document.pdf");
      return;
    }

    const { sourceId, pdfName } = location.state || {};
    if (!sourceId) return;
    const nextKey = `route:${sourceId}:${pdfName || "document.pdf"}`;
    if (lastLoadedSourceKeyRef.current === nextKey) return;
    lastLoadedSourceKeyRef.current = nextKey;
    loadFromSource(sourceId, pdfName || "document.pdf");
  }, [embeddedPdfName, embeddedSourceId, loadFromSource, location.state]);

  // ── Load a locally-picked file (embedded, no server round-trip) ────────────
  useEffect(() => {
    if (!embeddedFile || lastLoadedFileRef.current === embeddedFile) return;
    lastLoadedFileRef.current = embeddedFile;
    loadFile(embeddedFile);
  }, [embeddedFile, loadFile]);

  // ── History ────────────────────────────────────────────────────────────────
  const handleDeleteExtraction = useCallback(async (e, id) => {
    e.stopPropagation();
    try {
      await authFetch(apiUrl(`/api/pdf/history/${id}`), { method: "DELETE" });
      setHistory((h) => h.filter((item) => item._id !== id));
      if (activeHistoryId === id) { setActiveHistoryId(null); setSavedId(null); }
    } catch {}
  }, [activeHistoryId]);

  const loadHistoryItem = useCallback(async (id) => {
    if (id === activeHistoryId) return;
    try {
      const res  = await authFetch(apiUrl(`/api/pdf/history/${id}`));
      const data = await res.json();
      if (data.extraction) {
        setHyleData(inflateExtraction(data.extraction));
        setHylePage(data.extraction.pageNumber);
        setActiveHistoryId(id); setSavedId(id); setExtractError("");
      }
    } catch {}
  }, [activeHistoryId]);

  // ── Save ───────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!hyleData || saving) return;
    setSaving(true);
    try {
      const { systemMessage } = await (await fetch(apiUrl("/api/pdf/system-message"))).json();
      const res  = await authFetch(apiUrl("/api/pdf/save-extraction"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: filename || "unknown.pdf",
          pageCount: pageCount || 1,
          type: pdfType || "text-based",
          pageNumber: hylePage || pageNum,
          provider: extractMode === "manual" ? "manual" : provider,
          model: extractMode === "manual" ? "user" : provider,
          systemMessageSnapshot: systemMessage || "",
          nouns: deflateNounData(hyleData),
          totalNouns: hyleData._total,
        }),
      });
      const data = await res.json();
      if (data.extractionId) {
        setSavedId(data.extractionId);
        authFetch(apiUrl("/api/pdf/history")).then((r) => r.json()).then((d) => setHistory(d.extractions || [])).catch(() => {});
      }
    } catch {}
    finally { setSaving(false); }
  }, [hyleData, saving, filename, pageCount, pdfType, hylePage, pageNum, provider, extractMode]);

  // Prefers the server-side LlamaParse Markdown for this page (better structure —
  // real headings/lists/tables) when the doc came from a saved Source; falls back
  // to raw client-side pdf.js text (local uploads, or if the markdown service is
  // unavailable/unconfigured/out of quota) so extraction never breaks.
  const getPageText = useCallback(async (n) => {
    const sourceId = currentSourceIdRef.current;
    if (sourceId) {
      try {
        const res  = await authFetch(apiUrl(`/api/sources/${sourceId}/markdown?page=${n}`));
        const data = await res.json();
        if (res.ok && data.markdown?.trim()) return data.markdown;
      } catch {}
    }
    const page    = await pdfDoc.getPage(n);
    const content = await page.getTextContent();
    return content.items.map((item) => item.str + (item.hasEOL ? "\n" : " ")).join("").trim();
  }, [pdfDoc]);

  // Shows a page range's (or the whole document's) Markdown in the left-side
  // column (the "All Pages"/pager/delete tools, not the Actions -> Text
  // Extraction flow below, which has its own dedicated fetch). The backend's
  // GET /api/sources/:id/markdown lazily converts on first read via
  // ensureSourceMarkdown, so this can be called on an unconverted source too.
  // Extended with ?from=&to= for ranges alongside the existing ?page= and
  // no-param forms.
  const fetchMarkdownRange = useCallback(async (from, to, isAll) => {
    const sourceId = currentSourceIdRef.current;
    if (!sourceId) return;
    setPageMdOpen(true);
    setPageMdBusy(true);
    setPageMdError("");
    setPdfMdCountHighlight(null);
    setVoiceMatch(null);
    setVoiceQuery("");
    setVoiceError("");
    try {
      // Always go through from/to (even for "All Pages") with pageMarkers=1 so
      // the panel can show a "=== Page N ===" divider between pages.
      const lo = isAll ? 1 : from;
      const hi = isAll ? pageCount : to;
      const res  = await authFetch(apiUrl(`/api/sources/${sourceId}/markdown?from=${lo}&to=${hi}&pageMarkers=1`), { signal: AbortSignal.timeout(5 * 60 * 1000) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load Markdown.");
      setPageMdText(data.markdown || "");
      setPageMdRange({ from: data.from ?? lo, to: data.to ?? hi, all: isAll });
    } catch (err) {
      setPageMdError(err.message);
      setPageMdText("");
      setPageMdRange(null);
    } finally {
      setPageMdBusy(false);
    }
  }, [pageCount]);

  // Actions -> Text Extraction: instead of the inline pageMdOpen panel, spins
  // up a real MCTOSHS Draft document containing the WHOLE document's text
  // (every page, in order — not just the one currently open), and navigates
  // there. Each PDF page's text lands as its own run of literal-text blocks
  // (escaped, one line per <div> — not parsed into rich formatting), preceded
  // by a `data-page-break` marker div for every page after the first, so the
  // draft's structure mirrors the PDF's page-by-page layout: the on-screen
  // editor shows a plain "— Page N —" divider (real pixel-perfect on-screen
  // pagination isn't something this editor's decorative page background can
  // do), and the PDF exporter (see buildDocumentPdf's data-page-break check)
  // turns each marker into a *real* forced page break in the exported PDF.
  // Posting with sourceId (no sourcePage — this is the one whole-document
  // draft, not a per-page one) lets the backend hand back the SAME draft on
  // a repeat click instead of creating duplicates, and the draft carries
  // sourceId/sourceName back so its own page can render a link back to this
  // PDF — that pair is the "back and forth" between the two.
  const openMarkdownAsDraft = useCallback(async () => {
    const sourceId = currentSourceIdRef.current;
    if (!sourceId) return;
    setActionsMenuOpen(false);
    setMdDraftBusy(true);
    setMdDraftError("");
    try {
      const mdRes = await authFetch(apiUrl(`/api/sources/${sourceId}/markdown?from=1&to=${pageCount}&includePages=1`));
      const mdData = await mdRes.json();
      if (!mdRes.ok) throw new Error(mdData.error || "Failed to load Markdown.");

      const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const toDraftParagraphs = (text) => {
        const cleaned = cleanMarkdownToPlainText(text);
        const paragraphs = cleaned
          ? cleaned.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean)
          : [];

        if (!paragraphs.length) return "<div><br></div>";

        return paragraphs.map((paragraph) => {
          const lines = paragraph
            .split("\n")
            .map((line) => escapeHtml(line))
            .join("<br />");
          return `<div>${lines || "<br>"}</div>`;
        }).join("");
      };
      const pages = Array.isArray(mdData.pages) && mdData.pages.length
        ? mdData.pages
        : [{ pageNumber: 1, markdown: mdData.markdown || "" }];

      const content = pages.map(({ pageNumber, markdown }, idx) => {
        const marker = idx > 0
          ? `<div data-page-break="1" class="draft_page_break_marker">— Page ${pageNumber} —</div>`
          : "";
        return marker + toDraftParagraphs(markdown);
      }).join("");

      const draftRes = await authFetch(apiUrl("/api/draft"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: filename || "Document",
          content,
          sourceId,
          sourceName: filename,
        }),
      });
      const draftData = await draftRes.json();
      if (!draftRes.ok) throw new Error(draftData.error || "Failed to create the document.");
      navigate(`/draft/${draftData.id}`);
    } catch (err) {
      setMdDraftError(err.message);
    } finally {
      setMdDraftBusy(false);
    }
  }, [pageCount, filename, navigate]);

  // Jump the Markdown panel straight to a given real page — reuses it from
  // the already-fetched range if present (e.g. after "All Pages"), otherwise
  // fetches just that single page on demand. Either way, scrolls the main
  // reader to the same page so the two stay in sync.
  const goToMarkdownPage = useCallback((targetPage) => {
    const n = Math.max(1, Math.min(pageCount || targetPage, targetPage));
    scrollReaderToPage(n);
    const idx = mdPages.findIndex((p) => p.page === n);
    if (idx !== -1) {
      setMdPageIdx(idx);
    } else {
      mdFocusPageRef.current = n;
      fetchMarkdownRange(n, n, false);
    }
  }, [pageCount, mdPages, scrollReaderToPage, fetchMarkdownRange]);

  // Commits the panel's editable page-number field (blur / Enter).
  const commitMdPageInput = useCallback(() => {
    const n = parseInt(mdPageInputVal, 10);
    if (Number.isFinite(n)) goToMarkdownPage(n);
    else setMdPageInputVal(String(mdCurrentPage.page));
  }, [mdPageInputVal, goToMarkdownPage, mdCurrentPage]);

  // Fetches every page's Markdown in one go (it's already converted, so this
  // is just a read) and keeps whichever page is currently displayed in view.
  const showAllMarkdownPages = useCallback(() => {
    mdFocusPageRef.current = mdCurrentPage.page;
    fetchMarkdownRange(1, pageCount, true);
  }, [fetchMarkdownRange, pageCount, mdCurrentPage]);

  const handleDeleteMarkdownPage = useCallback(async () => {
    const sourceId = currentSourceIdRef.current;
    if (!sourceId || pageMdDeleteBusy) return;
    if (!window.confirm(`Delete cached markdown for page ${mdCurrentPage.page}? The PDF source will remain intact.`)) return;

    setPageMdDeleteBusy(true);
    setPageMdError("");
    try {
      const res = await authFetch(apiUrl(`/api/sources/${sourceId}/markdown?page=${mdCurrentPage.page}`), {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete this markdown page.");

      setHasStoredMarkdown(Boolean(data.hasMarkdown));
      setPdfMdCountHighlight(null);
      setVoiceMatch(null);
      setVoiceQuery("");
      setVoiceError("");
      mdFocusPageRef.current = mdCurrentPage.page;
      if (pageMdRange?.all) await fetchMarkdownRange(1, pageCount, true);
      else await fetchMarkdownRange(mdCurrentPage.page, mdCurrentPage.page, false);
    } catch (err) {
      setPageMdError(err.message);
    } finally {
      setPageMdDeleteBusy(false);
    }
  }, [authFetch, fetchMarkdownRange, mdCurrentPage.page, pageCount, pageMdDeleteBusy, pageMdRange]);

  const handleDeleteAllMarkdownPages = useCallback(async () => {
    const sourceId = currentSourceIdRef.current;
    if (!sourceId || pageMdDeleteBusy) return;
    if (!window.confirm("Delete all cached markdown pages for this source? The PDF itself will remain intact.")) return;

    setPageMdDeleteBusy(true);
    setPageMdError("");
    try {
      const res = await authFetch(apiUrl(`/api/sources/${sourceId}/markdown?all=1`), {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete all markdown pages.");

      setHasStoredMarkdown(false);
      setPageMdText("");
      setPageMdRange(null);
      setPdfMdCountHighlight(null);
      setVoiceMatch(null);
      setVoiceQuery("");
      setVoiceError("");
      setPageMdOpen(false);
    } catch (err) {
      setPageMdError(err.message);
    } finally {
      setPageMdDeleteBusy(false);
    }
  }, [pageMdDeleteBusy]);

  // Confirms the Actions-dropdown page-range picker for Linguistic Analysis
  // (the Markdown action now opens the panel directly — see the "Markdown"
  // dropdown item below — so this only ever handles the "linguistic" case).
  const confirmRangePicker = useCallback(() => {
    const from = rangeAll ? 1 : Math.max(1, Math.min(rangeFrom, rangeTo));
    const to   = rangeAll ? pageCount : Math.max(rangeFrom, rangeTo);
    navigate("/linguistic-analysis", {
      state: {
        sourceId: currentSourceIdRef.current,
        pdfName: filename,
        rangeFrom: from,
        rangeTo: to,
        rangeAll,
      },
    });
    setRangePickerAction(null);
  }, [rangeAll, rangeFrom, rangeTo, pageCount, navigate, filename]);

  // ── Select markdown text by voice (Web Speech API) ──────────────────────────
  const handleVoiceSelect = useCallback(() => {
    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      setVoiceError("Voice recognition isn't supported in this browser.");
      return;
    }
    if (voiceRecognitionRef.current) {
      voiceRecognitionRef.current.stop();
      return;
    }
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => { setVoiceListening(true); setVoiceError(""); };
    recognition.onerror = (e) => {
      setVoiceError(e.error === "no-speech" ? "Didn't catch that — try again." : `Voice error: ${e.error}`);
    };
    recognition.onend = () => { setVoiceListening(false); voiceRecognitionRef.current = null; };
    recognition.onresult = (e) => {
      const transcript = e.results[0][0].transcript.trim();
      setVoiceQuery(transcript);
      const idx = cleanedMdCurrentText.toLowerCase().indexOf(transcript.toLowerCase());
      if (idx === -1) {
        setVoiceMatch(null);
        setVoiceError(`"${transcript}" wasn't found on this page.`);
      } else {
        setVoiceMatch({ start: idx, end: idx + transcript.length });
        setVoiceError("");
      }
    };
    voiceRecognitionRef.current = recognition;
    recognition.start();
  }, [cleanedMdCurrentText]);

  useEffect(() => {
    if (!voiceMatch) return;
    document.querySelector(".draft_text_viewer__highlight")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [voiceMatch]);

  useEffect(() => {
    const layer = textLayerRef.current;
    const spans = spansRef.current;

    layer?.querySelectorAll(".pdf_md_count_highlight").forEach((el) => el.remove());
    if (!layer || !pdfMdCountHighlight || pageNum !== mdCurrentPage.page || spans.length === 0) return;

    const layerRect = layer.getBoundingClientRect();
    const bodyZoom = parseFloat(document.body.style.zoom) || 1;
    const lines = [];

    spans.forEach(({ el, text }) => {
      if (!el || !/\S/.test(text || "")) return;

      const r = el.getBoundingClientRect();
      const left = (r.left - layerRect.left) / bodyZoom;
      const top = (r.top - layerRect.top) / bodyZoom;
      const right = (r.right - layerRect.left) / bodyZoom;
      const bottom = (r.bottom - layerRect.top) / bodyZoom;
      const h = bottom - top;
      const padV = h * 0.25;

      let line = lines.find((l) => Math.abs(l.refTop - top) < Math.max(8, h * 0.5));
      if (!line) {
        line = { refTop: top, minL: Infinity, maxR: -Infinity, minT: Infinity, maxB: -Infinity };
        lines.push(line);
      }
      line.minL = Math.min(line.minL, left);
      line.maxR = Math.max(line.maxR, right);
      line.minT = Math.min(line.minT, top - padV);
      line.maxB = Math.max(line.maxB, bottom + padV);
    });

    for (const l of lines) {
      const rect = document.createElement("div");
      rect.className = "pdf_md_count_highlight";
      rect.style.position = "absolute";
      rect.style.left = `${l.minL}px`;
      rect.style.top = `${l.minT}px`;
      rect.style.width = `${l.maxR - l.minL}px`;
      rect.style.height = `${l.maxB - l.minT}px`;
      rect.style.background = pdfMdCountHighlight === "chars"
        ? "rgba(255, 167, 38, 0.28)"
        : "rgba(56, 139, 253, 0.28)";
      rect.style.borderRadius = "2px";
      rect.style.pointerEvents = "none";
      rect.style.zIndex = "1";
      layer.insertBefore(rect, layer.firstChild);
    }

    return () => { layer?.querySelectorAll(".pdf_md_count_highlight").forEach((el) => el.remove()); };
  }, [pdfMdCountHighlight, pageNum, mdCurrentPage.page, pageViewport]);

  // ── AI extraction (streaming) ──────────────────────────────────────────────
  const handleExtract = useCallback(async () => {
    if (!pdfDoc || extracting || pdfType === "scanned") return;
    setExtracting(true);
    setHyleData(EMPTY_HYLES());
    setHylePage(pageNum);
    setExtractError(""); setSavedId(null); setActiveHistoryId(null);

    try {
      const text = await getPageText(pageNum);

      if (!text || text.replace(/\s/g, "").length < 80) {
        setExtractError("This page has no extractable text content.");
        setHyleData(null);
        return;
      }

      const res     = await authFetch(apiUrl("/api/pdf/extract-nouns"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, provider }),
      });

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer    = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") break;
          try {
            const { noun, card, mode, reason, total, error: err } = JSON.parse(payload);
            if (err) { setExtractError(err); break; }
            if (noun && card && mode) {
              setHyleData((prev) => {
                const all = ["objects","traces","phenomena","concept","models"].flatMap((c) => ALL_MODES.flatMap((m) => prev[c][m].map((it) => it.noun)));
                if (all.includes(noun)) return prev;
                const num = prev[card][mode].length + 1;
                return {
                  ...prev,
                  [card]: { ...prev[card], [mode]: [...prev[card][mode], { id: `${card}_${mode}_${num}`, num, noun, reason: reason || "", status: initStatus() }] },
                  _total: total,
                };
              });
            }
          } catch {}
        }
      }
    } catch (err) {
      setExtractError(err.message);
    } finally {
      setExtracting(false);
    }
  }, [pdfDoc, pageNum, extracting, pdfType, provider, getPageText]);

  // ── Manual selection ───────────────────────────────────────────────────────
  const handleTextMouseDown = useCallback((e) => {
    mouseDownPosRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleTextSelection = useCallback((e) => {
    if (!textSelectable) return;
    if (suppressTextSelectionRef.current) return;
    const down = mouseDownPosRef.current;
    mouseDownPosRef.current = null;

    const moved = down
      ? (e.clientX - down.x) ** 2 + (e.clientY - down.y) ** 2
      : 999;

    if (moved >= 64) {
      // Drag → open popup directly with selected text
      const sel      = window.getSelection();
      const dragText = sel?.toString().trim().replace(/\s+/g, " ");
      if (dragText && sel.rangeCount > 0) {
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        if (onSelectionAction || hideHyleControls) {
          setManualSelection({ startIdx: -1, endIdx: -1, text: dragText, x: rect.left + rect.width / 2, y: rect.bottom + 8 });
        } else {
          setManualHyle(dragText.toLowerCase().replace(/[.,;:]+$/, ""));
          setManualPopup({ x: rect.left + rect.width / 2, y: rect.bottom + 10 });
        }
      }
      return;
    }

  }, [textSelectable, onSelectionAction]);

  const handleManualAdd = useCallback(() => {
    const noun = manualHyle.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.,;:]+$/, "");
    if (!noun) return;

    setHyleData((prev) => {
      const base = prev || EMPTY_HYLES();
      const all  = ["objects","traces","phenomena","concept","models"].flatMap((c) => ALL_MODES.flatMap((m) => base[c][m].map((it) => it.noun)));
      if (all.includes(noun)) return base;
      const num = (base[manualCard][manualMode]?.length || 0) + 1;
      return {
        ...base,
        [manualCard]: {
          ...base[manualCard],
          [manualMode]: [...base[manualCard][manualMode], { id: `${manualCard}_${manualMode}_${num}`, num, noun, reason: "manual", status: initStatus() }],
        },
        _total: (base._total || 0) + 1,
      };
    });
    if (!hylePage) setHylePage(pageNum);
    setManualPopup(null);
    setManualHyle("");
    window.getSelection()?.removeAllRanges();
  }, [manualHyle, manualCard, manualMode, hylePage, pageNum]);

  const sanitizeSelectedText = useCallback((text) => (
    String(text || "")
      // Drop decorative leader runs at the start of the whole selection
      // or at the start of a new line, e.g. "........" / "------".
      .replace(/(^|\n)[ \t]*([.\-_=*~]{4,})+(?=\s|[\p{L}\p{N}]|$)/gu, "$1")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  ), []);

  const getSpanRangeText = useCallback((startIdx, endIdx) => {
    const lo = Math.min(startIdx, endIdx);
    const hi = Math.max(startIdx, endIdx);
    const spans = spansRef.current.slice(lo, hi + 1);
    if (spans.length === 0) return "";

    const NO_SPACE_BEFORE = /^[,.;:!?%)\]\}]/;
    const NO_SPACE_AFTER  = /[(\[\{]$/;

    let text = "";
    for (let i = 0; i < spans.length; i++) {
      const cur = spans[i];
      if (i === 0) {
        text += cur.text;
        continue;
      }

      const prev = spans[i - 1];
      const prevText = String(prev.text || "");
      const curText  = String(cur.text || "");
      const prevRight = Number.isFinite(prev.left) && Number.isFinite(prev.width)
        ? prev.left + Math.max(prev.width, 0)
        : null;
      const curLeft = Number.isFinite(cur.left) ? cur.left : null;
      const lineBreak =
        Number.isFinite(prev.top) &&
        Number.isFinite(cur.top) &&
        Math.abs(cur.top - prev.top) > Math.max((prev.height || 0), (cur.height || 0)) * 0.45;
      const paragraphBreak =
        Number.isFinite(prev.top) &&
        Number.isFinite(cur.top) &&
        Math.abs(cur.top - prev.top) > Math.max((prev.height || 0), (cur.height || 0)) * 1.15;
      const sameLineGap =
        !lineBreak &&
        prevRight !== null &&
        curLeft !== null &&
        (curLeft - prevRight) > Math.max((prev.height || 0), (cur.height || 0)) * 0.12;
      const hyphenatedWrap =
        lineBreak &&
        /[\p{L}\p{N}]-$/u.test(prevText) &&
        /^[\p{L}\p{N}]/u.test(curText);
      const needsBoundarySpace =
        !hyphenatedWrap &&
        (lineBreak || sameLineGap) &&
        prevText &&
        curText &&
        !/\s$/.test(prevText) &&
        !/^\s/.test(curText) &&
        !NO_SPACE_BEFORE.test(curText) &&
        !NO_SPACE_AFTER.test(prevText);

      if (hyphenatedWrap) {
        text = text.replace(/-\s*$/, "");
      } else if (paragraphBreak) {
        text += "\n";
      } else if (needsBoundarySpace) {
        text += " ";
      }
      text += curText;
    }

    return sanitizeSelectedText(text);
  }, [sanitizeSelectedText]);

  // ── Selection bar: expand / confirm ───────────────────────────────────────
  const expandLeft = useCallback(() => {
    setManualSelection((sel) => {
      if (!sel || sel.startIdx === 0) return sel;
      const idx  = sel.startIdx - 1;
      const text = getSpanRangeText(idx, sel.endIdx);
      return { ...sel, startIdx: idx, text };
    });
  }, [getSpanRangeText]);

  const expandRight = useCallback(() => {
    setManualSelection((sel) => {
      if (!sel || sel.endIdx >= spansRef.current.length - 1) return sel;
      const idx  = sel.endIdx + 1;
      const text = getSpanRangeText(sel.startIdx, idx);
      return { ...sel, endIdx: idx, text };
    });
  }, [getSpanRangeText]);

  const adjustLeftBoundary = useCallback(() => {
    setManualSelection((sel) => {
      if (!sel || sel.startIdx < 0 || sel.endIdx < 0) return sel;
      const width = Math.abs(sel.endIdx - sel.startIdx);
      const nextStart = width > 0
        ? Math.min(sel.startIdx + 1, sel.endIdx)
        : Math.max(0, sel.startIdx - 1);
      if (nextStart === sel.startIdx) return sel;
      return { ...sel, startIdx: nextStart, text: getSpanRangeText(nextStart, sel.endIdx) };
    });
  }, [getSpanRangeText]);

  const adjustRightBoundary = useCallback(() => {
    setManualSelection((sel) => {
      if (!sel || sel.startIdx < 0 || sel.endIdx < 0) return sel;
      const width = Math.abs(sel.endIdx - sel.startIdx);
      const nextEnd = width > 0
        ? Math.max(sel.startIdx, sel.endIdx - 1)
        : Math.min(spansRef.current.length - 1, sel.endIdx + 1);
      if (nextEnd === sel.endIdx) return sel;
      return { ...sel, endIdx: nextEnd, text: getSpanRangeText(sel.startIdx, nextEnd) };
    });
  }, [getSpanRangeText]);

  const stopFooterAdjust = useCallback(() => {
    if (footerAdjustTimerRef.current) {
      window.clearInterval(footerAdjustTimerRef.current);
      footerAdjustTimerRef.current = null;
    }
  }, []);

  const startFooterAdjust = useCallback((fn) => {
    fn();
    stopFooterAdjust();
    footerAdjustTimerRef.current = window.setInterval(fn, 140);
  }, [stopFooterAdjust]);

  useEffect(() => stopFooterAdjust, [stopFooterAdjust]);

  const confirmSelection = useCallback(() => {
    if (!manualSelection) return;
    const noun = manualSelection.text.toLowerCase().replace(/[.,;:]+$/, "").replace(/\s+/g, " ").trim();
    setManualHyle(noun);
    // Get fresh viewport coords for the popup via the span's bounding rect
    const spanEl = spansRef.current[manualSelection.endIdx]?.el;
    const vr = spanEl?.getBoundingClientRect();
    setManualPopup({
      x: vr ? vr.left + vr.width / 2 : window.innerWidth  / 2,
      y: vr ? vr.bottom + 10         : window.innerHeight / 2,
    });
    setManualSelection(null);
  }, [manualSelection]);

  const handleSelectionAction = useCallback(async () => {
    if (!manualSelection || !onSelectionAction || selectionActionBusy) return;
    setSelectionActionBusy(true);
    setSelectionActionError("");
    try {
      await onSelectionAction(manualSelection.text);
      setManualSelection(null);
      window.getSelection()?.removeAllRanges();
    } catch (e) {
      setSelectionActionError(e.message);
    } finally {
      setSelectionActionBusy(false);
    }
  }, [manualSelection, onSelectionAction, selectionActionBusy]);

  const footerSelectionText =
    manualPopup
      ? manualHyle
      : (hideHyleControls && manualSelection ? manualSelection.text : "");
  const showFooterSelection = Boolean(manualPopup || (hideHyleControls && manualSelection));

  // Dismiss selection bar when clicking outside
  useEffect(() => {
    if (!manualSelection) return;
    const handler = (e) => {
      if (e.target.closest?.(".sel_handle")) return;
      if (selBarRef.current && !selBarRef.current.contains(e.target)) {
        setManualSelection(null);
        window.getSelection()?.removeAllRanges();
      }
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler, { passive: true });
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [manualSelection]);

  // ── Noun controls ──────────────────────────────────────────────────────────
  const reindex = (items, card, mode) =>
    items.map((item, i) => ({ ...item, num: i + 1, id: `${card}_${mode}_${i + 1}` }));

  const handleHyleStatus = useCallback((card, mode, index, newValue) => {
    setHyleData((prev) => {
      const items  = [...prev[card][mode]];
      const next   = currentStatus(items[index]) === newValue ? "pending" : newValue;
      items[index] = { ...items[index], status: { value: next, at: new Date().toISOString() } };
      return { ...prev, [card]: { ...prev[card], [mode]: items } };
    });
  }, []);

  const handleHyleDelete = useCallback((card, mode, index) => {
    setHyleData((prev) => {
      const items = [...prev[card][mode]];
      items.splice(index, 1);
      return { ...prev, [card]: { ...prev[card], [mode]: reindex(items, card, mode) } };
    });
  }, []);

  const handleHyleMove = useCallback((fromCard, fromMode, index, toCard, toMode) => {
    if (fromCard === toCard && fromMode === toMode) return;
    setHyleData((prev) => {
      const src = [...prev[fromCard][fromMode]];
      const [item] = src.splice(index, 1);
      const dst = [...prev[toCard][toMode]];
      const num = dst.length + 1;
      dst.push({ ...item, num, id: `${toCard}_${toMode}_${num}`, status: initStatus() });
      return {
        ...prev,
        [fromCard]: { ...prev[fromCard], [fromMode]: reindex(src, fromCard, fromMode) },
        [toCard]:   { ...prev[toCard],   [toMode]:   dst },
      };
    });
  }, []);

  // ── Panel resize handle ────────────────────────────────────────────────────
  const handleResizeStart = useCallback((e) => {
    e.preventDefault();
    const onMove = (ev) => {
      if (!contentRef.current) return;
      const rect  = contentRef.current.getBoundingClientRect();
      const clientX = ev.touches ? ev.touches[0].clientX : ev.clientX;
      const ratio = Math.max(0.1, Math.min(1, (clientX - rect.left) / rect.width));
      setSplitRatio(ratio);
      if (ratio < 0.9) savedRatioRef.current = ratio;
    };
    const onEnd = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",   onEnd);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend",  onEnd);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onEnd);
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend",  onEnd);
  }, []);

  // Drag handle for the Markdown/Actions left column — width in px, not a ratio
  // (it sits alongside the PDF preview, not splitting against it 1:1).
  const handleMdPanelResizeStart = useCallback((e) => {
    e.preventDefault();
    const handleEl   = e.currentTarget;
    const startX     = e.touches ? e.touches[0].clientX : e.clientX;
    const startWidth = mdPanelWidth;
    handleEl.classList.add("pdf_md_panel_resize_handle--active");
    const onMove = (ev) => {
      const clientX = ev.touches ? ev.touches[0].clientX : ev.clientX;
      const next = Math.max(220, Math.min(720, startWidth + (clientX - startX)));
      setMdPanelWidth(next);
    };
    const onEnd = () => {
      handleEl.classList.remove("pdf_md_panel_resize_handle--active");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",   onEnd);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend",  onEnd);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onEnd);
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend",  onEnd);
  }, [mdPanelWidth]);

  const togglePreview = useCallback(() => {
    setSplitRatio((r) => {
      if (r === 0) return savedRatioRef.current || 0.42;
      savedRatioRef.current = r;
      return 0;
    });
  }, []);

  // ── Drag & drop ────────────────────────────────────────────────────────────
  const handleDrop        = useCallback((e) => { e.preventDefault(); setDragOver(false); loadFile(e.dataTransfer.files[0]); }, [loadFile]);
  const handleDragOver    = (e) => { e.preventDefault(); setDragOver(true); };
  const handleDragLeave   = () => setDragOver(false);
  const handleInputChange = (e) => loadFile(e.target.files[0]);

  const handleClose = () => {
    renderTasksRef.current.forEach(t => t?.cancel());
    pageCanvasRefs.current = []; pageContainerRefs.current = [];
    pageViewportsRef.current = []; renderTasksRef.current = []; renderedScaleRef.current = []; renderedCssSizeRef.current = [];
    setPdfDoc(null); setFilename(""); setPageNum(1); setPageCount(0);
    setPdfType(null); setHyleData(null); setHylePage(null);
    setExtractError(""); setSavedId(null); setActiveHistoryId(null);
    setPageViewport(null); setManualPopup(null); setZoom(1);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const renderTypeNode = (node, depth = 0) => {
    const isLeaf = !node.children || node.children.length === 0;
    return (
      <div key={node.key} className={`hyle_type_node hyle_type_depth_${depth}`}>
        {isLeaf ? (
          <button
            className={`hyle_type_leaf${extractionType === node.key ? " hyle_type_leaf--active" : ""}`}
            onClick={() => setExtractionType(extractionType === node.key ? null : node.key)}
          >
            {node.label}
            {node.note && <span className="hyle_type_note">{node.note}</span>}
          </button>
        ) : (
          <>
            <span className="hyle_type_group">{node.label}</span>
            <div className="hyle_type_children">
              {node.children.map((child) => renderTypeNode(child, depth + 1))}
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div
      id="pdf_page"
      className={[
        embedded ? "pdf_page--embedded" : "",
        showFooterSelection ? "pdf_page--footer-open" : "",
      ].filter(Boolean).join(" ") || undefined}
    >
      {showSysModal && <SystemMessageModal onClose={() => setShowSysModal(false)} />}

      {/* Toolbar */}
      <div id="pdf_toolbar">
        <button id="pdf_home_btn" onClick={() => navigate(embeddedHomePath)} title={embedded ? "Back to Traces Collector" : homeLabel}>⌂</button>
        {pdfDoc && <>
          <button onClick={() => pageContainerRefs.current[pageNum - 2]?.scrollIntoView({ behavior: "smooth", block: "start" })} disabled={pageNum <= 1}>‹</button>
          <span>{pageNum} / {pageCount}</span>
          <button onClick={() => pageContainerRefs.current[pageNum]?.scrollIntoView({ behavior: "smooth", block: "start" })} disabled={pageNum >= pageCount}>›</button>
          <span id="pdf_filename">{filename}</span>
          {pdfType && (
            <span className={`pdf_type_badge pdf_type_badge--${pdfType}`}>
              <i className={`fi ${PDF_TYPE_ICON[pdfType]}`} />
              {PDF_TYPE_LABEL[pdfType]}
            </span>
          )}
          <div id="pdf_zoom_controls">
            <button
              onClick={() => zoomFromCenter((z) => z - 0.01)}
              onMouseDown={() => startZoomHold(-0.01)}
              onMouseUp={stopZoomHold}
              onMouseLeave={stopZoomHold}
              onTouchStart={(e) => { e.preventDefault(); startZoomHold(-0.01); }}
              onTouchEnd={stopZoomHold}
              onTouchCancel={stopZoomHold}
              title="Zoom out 1%"
            >
              −
            </button>
            <button id="pdf_zoom_label" onClick={() => zoomFromCenter(1)} title="Reset zoom to original size">
              {Math.round(zoom * 100)}%
            </button>
            <button
              onClick={() => zoomFromCenter((z) => z + 0.01)}
              onMouseDown={() => startZoomHold(0.01)}
              onMouseUp={stopZoomHold}
              onMouseLeave={stopZoomHold}
              onTouchStart={(e) => { e.preventDefault(); startZoomHold(0.01); }}
              onTouchEnd={stopZoomHold}
              onTouchCancel={stopZoomHold}
              title="Zoom in 1%"
            >
              +
            </button>
          </div>
          {currentSourceIdRef.current && (
            <div className="annot_dd_wrap" ref={actionsMenuRef}>
              <button
                type="button"
                id="pdf_actions_btn"
                className={actionsMenuOpen ? "pdf_actions_btn--active" : ""}
                onClick={() => setActionsMenuOpen((o) => !o)}
                disabled={pageMdBusy || mdDraftBusy}
                title={hasStoredMarkdown ? "Text Extraction / Linguistic Analysis actions" : "Text Extraction / Linguistic Analysis actions — this document hasn't been extracted yet, Text Extraction will do that first"}
              >
                <i className={`fi ${mdDraftBusy ? "fi-rr-spinner pdf_icon_spin" : "fi-rr-menu-dots"}`} /> Actions
              </button>
              {mdDraftError && <span className="pdf_actions_error" title={mdDraftError}>⚠ {mdDraftError}</span>}
              {actionsMenuOpen && (
                <div className="annot_dd annot_dd--tools" id="pdf_actions_dd">
                  <button
                    type="button"
                    className="annot_dd_item"
                    onClick={openMarkdownAsDraft}
                  >
                    <i className="fi fi-rr-document" />
                    <span>Text Extraction</span>
                  </button>
                  <button
                    type="button"
                    className="annot_dd_item"
                    onClick={() => { setActionsMenuOpen(false); setRangeFrom(pageNum); setRangeTo(pageNum); setRangeAll(false); setRangePickerAction("linguistic"); }}
                  >
                    <i className="fi fi-rr-language" />
                    <span>Linguistic Analysis</span>
                  </button>
                </div>
              )}
              {rangePickerAction && (
                <div className="annot_dd" id="pdf_range_picker">
                  <div id="pdf_range_picker_title">Analyze Language</div>
                  <label id="pdf_range_all_row">
                    <input type="checkbox" checked={rangeAll} onChange={(e) => setRangeAll(e.target.checked)} />
                    All Pages ({pageCount})
                  </label>
                  {!rangeAll && (
                    <div id="pdf_range_inputs">
                      <label>
                        From
                        <input type="number" min={1} max={pageCount} value={rangeFrom} onChange={(e) => setRangeFrom(Math.max(1, Math.min(pageCount, Number(e.target.value) || 1)))} />
                      </label>
                      <label>
                        To
                        <input type="number" min={1} max={pageCount} value={rangeTo} onChange={(e) => setRangeTo(Math.max(1, Math.min(pageCount, Number(e.target.value) || 1)))} />
                      </label>
                    </div>
                  )}
                  <div id="pdf_range_actions">
                    <button type="button" className="annot_trigger" onClick={() => setRangePickerAction(null)}>Cancel</button>
                    <button type="button" className="annot_trigger annot_trigger--active" onClick={confirmRangePicker}>Analyze</button>
                  </div>
                </div>
              )}
            </div>
          )}
          {hideHyleControls && (
            <button
              id="pdf_text_select_btn"
              className={textSelectable ? "pdf_text_select_btn--active" : ""}
              onClick={() => setReaderTextSelectEnabled((enabled) => !enabled)}
              title={textSelectable ? "Disable text selection" : "Enable text selection"}
            >
              Select Text
            </button>
          )}
          {annotHistory.length > 0 && (
            <button
              id="pdf_annot_history_btn"
              className={annotHistoryOpen ? "pdf_annot_history_btn--active" : ""}
              onClick={() => setAnnotHistoryOpen((v) => !v)}
              title="Annotation History — every step taken this session"
            >
              <i className="fi fi-rr-time-past" /> History
            </button>
          )}
          <button id="pdf_close" onClick={handleClose}>✕</button>

          {/* Hyles toggle + extraction controls */}
          {!selectionOnly && !hideHyleControls && <>
            <button
              id="pdf_hyles_toggle_btn"
              className={extractionOpen ? "pdf_hyles_toggle_btn--active" : ""}
              onClick={() => {
                const next = !extractionOpen;
                setExtractionOpen(next);
                setSplitRatio(next ? 0.5 : 1);
              }}
            >Hyles</button>

            {extractionOpen && (
              <div id="pdf_hyles_actions">
                {hyleData && hyleData._total > 0 && !extracting && (
                  <button className={`pdf_action_btn${savedId ? " pdf_action_btn--saved" : ""}`} onClick={handleSave} disabled={saving}>
                    {saving ? "Saving…" : savedId ? "Saved" : "Save"}
                  </button>
                )}
                <button id="pdf_sys_btn" onClick={() => setShowSysModal(true)}>System</button>
                <AIProviderSelect provider={provider} setProvider={setProvider} disabled={extracting} />
                {extractMode === "ai" && (
                  <button id="pdf_extract_btn" onClick={handleExtract} disabled={!canExtract || extracting} title={!canExtract ? "Open a text-based PDF first" : ""}>
                    {extracting ? "Extracting…" : pdfDoc ? `Extract Page ${pageNum}` : "Extract"}
                  </button>
                )}
              </div>
            )}
          </>}
        </>}
      </div>

      {/* Annotation toolbar — one compact row: a floating "Tools" dropdown
          (was a row of 10 always-visible icon buttons), a floating color
          swatch dropdown (was a row of 8 always-visible swatches, repeated
          again in the old separate highlight_panel below), an inline size
          slider + freehand/line toggle when relevant, and undo/clear. This
          replaces both the old #pdf_annot_toolbar AND the separate
          #highlight_panel entirely — one row instead of two. */}
      {pdfDoc && !selectionOnly && (() => {
        const activeToolMeta = ANNOT_TOOLS.find((t) => t.key === annotTool) || null;
        const hasSize = annotTool === "pen" || annotTool === "highlight" || annotTool === "eraser" || annotTool === "arrow";
        const sizeProps =
          annotTool === "pen"     ? { min: 1, max: 36, step: 0.5, value: penSize,    onChange: setPenSize } :
          annotTool === "eraser"  ? { min: 6, max: 72, step: 2,   value: eraserSize, onChange: setEraserSize } :
          annotTool === "highlight" ? { min: 4, max: 96, step: 2, value: annotSize,  onChange: setAnnotSize } :
          annotTool === "arrow"   ? { min: 1, max: 20, step: 0.5, value: arrowSize,  onChange: setArrowSize } :
          null;
        return (
          <div id="pdf_annot_toolbar">
            <div className="annot_dd_wrap" ref={toolsMenuRef}>
              <button
                type="button"
                className={`annot_trigger${annotTool ? " annot_trigger--active" : ""}`}
                onClick={() => { setToolsMenuOpen((o) => !o); setColorMenuOpen(false); setPenMenuOpen(false); setHighlightMenuOpen(false); }}
              >
                <i className={`fi ${activeToolMeta?.icon || "fi-rr-pencil"}`} />
                <span className="annot_trigger_label">{activeToolMeta?.label || "Tools"}</span>
                <i className="fi fi-rr-angle-small-down annot_trigger_chevron" />
              </button>
              {toolsMenuOpen && (
                <div className="annot_dd annot_dd--tools">
                  {ANNOT_TOOLS.map(({ key, icon, label }) => (
                    <button
                      key={key}
                      type="button"
                      className={`annot_dd_item${annotTool === key ? " annot_dd_item--active" : ""}`}
                      onClick={() => { setAnnotTool((t) => t === key ? null : key); setToolsMenuOpen(false); }}
                    >
                      <i className={`fi ${icon}`} />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {annotTool && annotTool !== "eraser" && (
              <div className="annot_dd_wrap" ref={colorMenuRef}>
                <button
                  type="button"
                  className="annot_trigger annot_trigger--color"
                  onClick={() => { setColorMenuOpen((o) => !o); setToolsMenuOpen(false); setPenMenuOpen(false); setHighlightMenuOpen(false); }}
                  title="Color"
                >
                  <span className="annot_swatch annot_swatch--trigger" style={{ background: annotColor }} />
                  <span className="annot_trigger_label">Ink</span>
                  <i className="fi fi-rr-angle-small-down annot_trigger_chevron" />
                </button>
                {colorMenuOpen && (
                  <div className="annot_dd annot_dd--colors">
                    <div className="annot_color_preview">
                      <div className="annot_color_preview_chip" style={{ background: annotColor }} />
                      <div className="annot_color_preview_text">
                        <span className="annot_color_preview_label">Current ink</span>
                        <span className="annot_color_preview_hex">{annotColor.toUpperCase()}</span>
                      </div>
                    </div>
                    {ANNOT_COLOR_GROUPS.map(({ label, colors }) => (
                      <div key={label} className="annot_color_group">
                        <div className="annot_color_group_label">{label}</div>
                        <div className="annot_color_group_grid">
                          {colors.map((c) => (
                            <button
                              key={c}
                              type="button"
                              className={`annot_swatch_btn${annotColor === c ? " annot_swatch_btn--active" : ""}`}
                              style={{ background: c }}
                              title={c}
                              onClick={() => { setAnnotColor(c); setColorMenuOpen(false); }}
                            >
                              {annotColor === c && <span className="annot_swatch_btn_inner" />}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {hasSize && (
              <SizeKnob
                min={sizeProps.min} max={sizeProps.max} step={sizeProps.step}
                value={sizeProps.value}
                onChange={sizeProps.onChange}
                color={annotColor}
                dashed={annotTool === "eraser"}
              />
            )}

            {annotTool === "pen" && (
              <div className="annot_dd_wrap" ref={penMenuRef}>
                <button
                  type="button"
                  className={`annot_trigger${penMenuOpen ? " annot_trigger--active" : ""}`}
                  onClick={() => { setPenMenuOpen((o) => !o); setToolsMenuOpen(false); setColorMenuOpen(false); setHighlightMenuOpen(false); }}
                  title="Pen settings"
                >
                  <i className="fi fi-rr-settings-sliders" />
                  <span className="annot_trigger_label">Stroke shaping</span>
                  <i className="fi fi-rr-angle-small-down annot_trigger_chevron" />
                </button>
                {penMenuOpen && (
                  <div className="annot_dd annot_dd--pen">
                    <div className="annot_pen_panel">
                      <div className="annot_pen_group">
                        <div className="annot_pen_group_title">Themes</div>
                        <div className="annot_mode_toggle annot_mode_toggle--pen">
                          {PEN_THEMES.map((theme) => (
                            <button
                              key={theme.key}
                              type="button"
                              className="annot_mode_btn"
                              onClick={() => applyPenTheme(theme)}
                            >
                              {theme.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="annot_pen_group">
                        <div className="annot_pen_group_title">Pen type</div>
                        <div className="annot_mode_toggle annot_mode_toggle--pen">
                          {PEN_TYPES.map(({ key, label }) => (
                            <button
                              key={key}
                              type="button"
                              className={`annot_mode_btn${penType === key ? " annot_mode_btn--active" : ""}`}
                              onClick={() => setPenType(key)}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="annot_pen_group annot_pen_group--full">
                        <div className="annot_pen_group_title">Stroke shaping</div>
                        <div className="annot_mode_toggle annot_mode_toggle--pen">
                          <button
                            type="button"
                            className={`annot_mode_btn${penBorder ? " annot_mode_btn--active" : ""}`}
                            onClick={() => setPenBorder((value) => !value)}
                          >
                            Stroke border
                          </button>
                        </div>
                        <div className="annot_pen_controls annot_pen_controls--column">
                          <LabeledPercentKnob
                            title="Smoothing"
                            subtitle="Reduce hand jitter"
                            value={penStabilization}
                            onChange={setPenStabilization}
                            label="%"
                          />
                          <LabeledPercentKnob
                            title="Pressure assist"
                            subtitle="Shape width without stylus pressure"
                            value={penPressureAssist}
                            onChange={setPenPressureAssist}
                            label="%"
                          />
                          <LabeledPercentKnob
                            title="Tip taper"
                            subtitle="Sharper start and end"
                            value={penTaper}
                            onChange={setPenTaper}
                            label="%"
                          />
                          <LabeledPercentKnob
                            title="Ink flow"
                            subtitle="Extra body and softness"
                            value={penFlow}
                            onChange={setPenFlow}
                            label="%"
                          />
                        </div>
                      </div>

                      {penType === "fountain" && (
                        <div className="annot_pen_group">
                          <div className="annot_pen_group_title">Fountain nib</div>
                          <div className="annot_pen_controls">
                            <LabeledPercentKnob
                              title="Nib angle"
                              subtitle="Direction of the broad edge"
                              value={penNibAngle}
                              onChange={setPenNibAngle}
                              min={0}
                              max={180}
                              step={5}
                              label="°"
                            />
                            <LabeledPercentKnob
                              title="Nib spread"
                              subtitle="Broad-stroke contrast"
                              value={penNibSpread}
                              onChange={setPenNibSpread}
                              label="%"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {annotTool === "highlight" && (
              <div className="annot_dd_wrap" ref={highlightMenuRef}>
                <button
                  type="button"
                  className={`annot_trigger${highlightMenuOpen ? " annot_trigger--active" : ""}`}
                  onClick={() => { setHighlightMenuOpen((o) => !o); setToolsMenuOpen(false); setColorMenuOpen(false); setPenMenuOpen(false); }}
                  title="Highlight settings"
                >
                  <i className="fi fi-rr-marker" />
                  <span className="annot_trigger_label">Highlight</span>
                  <i className="fi fi-rr-angle-small-down annot_trigger_chevron" />
                </button>
                {highlightMenuOpen && (
                  <div className="annot_dd annot_dd--highlight">
                    <div className="annot_pen_panel annot_pen_panel--highlight">
                      <div className="annot_pen_group">
                        <div className="annot_pen_group_title">Shape</div>
                        <div className="annot_mode_toggle annot_mode_toggle--pen">
                          <button
                            type="button"
                            className={`annot_mode_btn${highlightMode === "freehand" ? " annot_mode_btn--active" : ""}`}
                            onClick={() => setHighlightMode("freehand")}
                          >Freehand</button>
                          <button
                            type="button"
                            className={`annot_mode_btn${highlightMode === "line" ? " annot_mode_btn--active" : ""}`}
                            onClick={() => setHighlightMode("line")}
                          >Straight line</button>
                        </div>
                        {highlightMode === "line" && (
                          <div className="annot_mode_toggle annot_mode_toggle--pen">
                            <button
                              type="button"
                              className={`annot_mode_btn annot_mode_btn--toggle${highlightAutoWidth ? " annot_mode_btn--active" : ""}`}
                              onClick={() => setHighlightAutoWidth((value) => !value)}
                              title="Auto width: click text to match that text span's width automatically"
                            >
                              Auto width
                            </button>
                            <button
                              type="button"
                              className={`annot_mode_btn annot_mode_btn--toggle${highlightTaperEnds ? " annot_mode_btn--active" : ""}`}
                              onClick={() => setHighlightTaperEnds((value) => !value)}
                              title="Taper ends: rounded marker caps; off uses blunt ends"
                            >
                              {highlightTaperEnds ? "Taper ends" : "Untaper ends"}
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="annot_pen_group">
                        <div className="annot_pen_group_title">Coverage</div>
                        <div className="annot_pen_controls">
                          <div className="annot_control">
                            <div className="annot_control_head">
                              <span className="annot_control_title">Width</span>
                              <span className="annot_control_subtitle">How wide the marker lays down ink</span>
                            </div>
                            <SizeKnob
                              min={4}
                              max={64}
                              step={2}
                              value={annotSize}
                              onChange={setAnnotSize}
                              color={annotColor}
                            />
                          </div>
                          <div className="annot_control">
                            <div className="annot_control_head">
                              <span className="annot_control_title">Opacity</span>
                              <span className="annot_control_subtitle">Transparency of the highlight layer</span>
                            </div>
                            <OpacityKnob value={annotOpacity} onChange={setAnnotOpacity} color={annotColor} />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {annotTool && annotTool !== "eraser" && (
              <button
                type="button"
                className={`annot_trigger${autoContrast ? " annot_trigger--active" : ""}`}
                onClick={() => setAutoContrast((v) => !v)}
                title="Auto contrast: pick black or white ink, whichever reads best against the page under the stroke"
              >
                <i className="fi fi-rr-eye-dropper" />
                <span className="annot_trigger_label">Auto contrast</span>
              </button>
            )}

            {/* Page-level controls (not tool options) — pinned to the right */}
            <div id="pdf_annot_right_group">
              <button
                type="button"
                className={`annot_trigger${fingerScrollOnly ? " annot_trigger--active" : ""}`}
                onClick={() => setFingerScrollOnly((v) => !v)}
                title="Hand mode: finger only scrolls the page, the pencil draws"
              >
                <i className="fi fi-rr-hand" />
                <span className="annot_trigger_label">Hand</span>
              </button>

              <div id="pdf_annot_actions">
                <button className="annot_action_btn" onClick={handleAnnotUndo} title="Undo last" disabled={!(annotations[pageNum]?.length > 0)}><i className="fi fi-rr-undo" /></button>
                <button className="annot_action_btn" onClick={handleAnnotRedo} title="Redo" disabled={!(redoStacks[pageNum]?.length > 0)}><i className="fi fi-rr-redo" /></button>
                <button className="annot_action_btn" onClick={handleAnnotClear} title="Clear page" disabled={!(annotations[pageNum]?.length > 0)}><i className="fi fi-rr-trash" /></button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Split area */}
      <div id="pdf_content" ref={contentRef}>

        {/* Far left — Markdown preview column for the current page, opened by the toolbar "MD" button */}
        {pageMdOpen && (
          <div id="pdf_md_panel" style={{ width: mdPanelWidth }}>
            <div
              id="pdf_md_panel_resize_handle"
              onMouseDown={handleMdPanelResizeStart}
              onTouchStart={handleMdPanelResizeStart}
            />
            <div id="pdf_md_panel_header">
              <span>Markdown</span>
              <button id="pdf_md_panel_close" onClick={() => setPageMdOpen(false)} title="Close">✕</button>
            </div>
            {pageMdText && (
              <div id="pdf_md_pager">
                <div id="pdf_md_page_nav">
                  <button type="button" onClick={() => goToMarkdownPage(mdCurrentPage.page - 1)} disabled={mdCurrentPage.page <= 1} title="Previous page">‹</button>
                  <input
                    type="number"
                    min={1}
                    max={pageCount}
                    value={mdPageInputVal}
                    onChange={(e) => setMdPageInputVal(e.target.value)}
                    onBlur={commitMdPageInput}
                    onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                    title="Type a page number to jump straight to its Markdown"
                  />
                  <span id="pdf_md_page_nav_total">/ {pageCount}</span>
                  <button type="button" onClick={() => goToMarkdownPage(mdCurrentPage.page + 1)} disabled={mdCurrentPage.page >= pageCount} title="Next page">›</button>
                </div>
                <button
                  type="button"
                  id="pdf_md_all_pages_btn"
                  className={`pdf_md_icon_btn${pageMdRange?.all ? " pdf_md_all_pages_btn--active" : ""}`}
                  onClick={showAllMarkdownPages}
                  disabled={pageMdBusy || pageMdDeleteBusy || Boolean(pageMdRange?.all)}
                  title={pageMdRange?.all ? "Every page is already loaded" : "Load every page's Markdown so you can page through the whole document without re-fetching"}
                >
                  <i className="fi fi-rr-layers" /> {pageMdRange?.all ? "Loaded" : "All Pages"}
                </button>
                <button
                  type="button"
                  className="pdf_md_icon_btn pdf_md_delete_btn"
                  onClick={handleDeleteMarkdownPage}
                  disabled={pageMdBusy || pageMdDeleteBusy || !pageMdText}
                  title="Delete cached markdown for the currently displayed page"
                >
                  <i className={`fi ${pageMdDeleteBusy ? "fi-rr-spinner pdf_icon_spin" : "fi-rr-trash"}`} /> {pageMdDeleteBusy ? "Deleting…" : "Delete Page"}
                </button>
                <button
                  type="button"
                  className="pdf_md_icon_btn pdf_md_delete_btn pdf_md_delete_btn--all"
                  onClick={handleDeleteAllMarkdownPages}
                  disabled={pageMdBusy || pageMdDeleteBusy || !pageMdText}
                  title="Delete every cached markdown page for this source"
                >
                  <i className={`fi ${pageMdDeleteBusy ? "fi-rr-spinner pdf_icon_spin" : "fi-rr-trash"}`} /> {pageMdDeleteBusy ? "Deleting…" : "Delete All"}
                </button>
              </div>
            )}
            {!pageMdBusy && !pageMdError && pageMdText && (
              <div id="pdf_md_stats">
                <button
                  type="button"
                  className={`pdf_md_stat_btn${pdfMdCountHighlight === "words" ? " pdf_md_stat_btn--active" : ""}`}
                  onClick={() => showMarkdownPageInPdf("words")}
                  title="Show this markdown page in the PDF viewer and highlight the counted words there"
                >
                  <i className="fi fi-rr-text" /> {mdStats.words} words
                </button>
                <button
                  type="button"
                  className={`pdf_md_stat_btn${pdfMdCountHighlight === "chars" ? " pdf_md_stat_btn--active" : ""}`}
                  onClick={() => showMarkdownPageInPdf("chars")}
                  title="Show this markdown page in the PDF viewer and highlight the counted characters there"
                >
                  <i className="fi fi-rr-keyboard" /> {mdStats.chars} characters
                </button>
                <button
                  type="button"
                  id="pdf_md_voice_btn"
                  className={voiceListening ? "pdf_md_voice_btn--active" : ""}
                  onClick={handleVoiceSelect}
                  title="Select text by voice — say a word or phrase to find and highlight it"
                >
                  <i className="fi fi-rr-microphone" /> Voice
                </button>
                <div id="pdf_md_font_controls">
                  <button type="button" onClick={() => setMdFontScale((s) => Math.max(0.7, +(s - 0.1).toFixed(1)))} title="Smaller text" disabled={mdFontScale <= 0.7}>A−</button>
                  <span id="pdf_md_font_label">{Math.round(mdFontScale * 100)}%</span>
                  <button type="button" onClick={() => setMdFontScale((s) => Math.min(2, +(s + 0.1).toFixed(1)))} title="Larger text" disabled={mdFontScale >= 2}>A+</button>
                </div>
              </div>
            )}
            {(voiceListening || voiceQuery || voiceError) && (
              <div id="pdf_md_voice_status">
                {voiceListening ? "Listening…" : voiceError ? `⚠ ${voiceError}` : voiceQuery ? `Heard: "${voiceQuery}"${voiceMatch ? " — found" : ""}` : ""}
              </div>
            )}
            <div id="pdf_md_panel_body">
              {pageMdBusy ? (
                <p id="pdf_md_panel_status">Converting…</p>
              ) : pageMdError ? (
                <p id="pdf_md_panel_status" className="pdf_md_panel_status--error">⚠ {pageMdError}</p>
              ) : mdCurrentPage.text ? (
                <div className="pdf_md_compare_layout">
                  <section className="pdf_md_compare_col">
                    <div className="pdf_md_compare_head">
                      <span>Draft Text View</span>
                      <span className="pdf_md_compare_meta">Page {mdCurrentPage.page}</span>
                    </div>
                    <div id="pdf_md_panel_text" ref={mdTextRef} style={{ fontSize: `${0.8 * mdFontScale}rem` }}>
                      <DraftTextViewer
                        text={mdCurrentPage.text}
                        highlightRange={voiceMatch}
                        emptyText="(This page had no extractable text.)"
                      />
                    </div>
                  </section>
                </div>
              ) : (
                <div id="pdf_md_panel_text" style={{ fontSize: `${0.8 * mdFontScale}rem` }}>
                  <DraftTextViewer text="" emptyText="(This page had no extractable text.)" />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Far left — Annotation History column, opened by the toolbar "History" button */}
        {annotHistoryOpen && (
          <div id="pdf_annot_history_panel">
            <div id="pdf_annot_history_header">
              <span>Annotation History</span>
              <button id="pdf_annot_history_close" onClick={() => setAnnotHistoryOpen(false)} title="Close">✕</button>
            </div>
            <div id="pdf_annot_history_body">
              {[...annotHistory].reverse().map((h) => {
                const meta = ANNOT_HISTORY_META[h.action] || ANNOT_HISTORY_META.add;
                const toolLabel = ANNOT_TOOLS.find((t) => t.key === h.type)?.label || (h.type === "text" ? "Text" : h.type);
                return (
                  <div key={h.id} className="anh_row">
                    <i className={`fi ${meta.icon} anh_icon`} />
                    <div className="anh_main">
                      <span className="anh_label">
                        {meta.verb}{h.action === "clear" ? ` ${h.count} item${h.count === 1 ? "" : "s"}` : h.action === "erase" ? ` ${h.count} mark${h.count === 1 ? "" : "s"}` : toolLabel ? ` ${toolLabel}` : ""}
                      </span>
                      <span className="anh_meta">
                        p.{h.page} · {h.time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </span>
                    </div>
                    {h.color && <span className="anh_swatch" style={{ background: h.color }} />}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Left — PDF viewer or upload zone */}
        <div
          id="pdf_preview"
          style={{
            width: splitRatio === 0
              ? "0"
              : `calc(${splitRatio >= 0.9 ? 100 : splitRatio * 100}% - ${(pageMdOpen ? mdPanelWidth : 0) + (annotHistoryOpen ? 300 : 0)}px)`,
          }}
          className={`${splitRatio === 0 ? "pdf_preview--closed" : ""}${annotTool ? " pdf_preview--tool-active" : ""}`}
        >
          <div id="pdf_preview_scroll" ref={previewRef}>
          {pdfDoc ? (
            <>
              <div id="pdf_canvas_wrap" ref={canvasWrapRef}>
                {Array.from({ length: pageCount }, (_, i) => i + 1).map(n => (
                  <div
                    key={n}
                    className="pdf_page_container"
                    ref={el => { pageContainerRefs.current[n - 1] = el; }}
                    data-page={n}
                  >
                    <canvas
                      className="pdf_page_canvas"
                      ref={el => { pageCanvasRefs.current[n - 1] = el; }}
                    />
                    {pageNum === n && (
                      <>
                      <canvas
                        id="pdf_annot_canvas"
                        ref={annotCanvasRef}
                        style={{ pointerEvents: annotTool ? "auto" : "none", cursor: annotTool === "eraser" ? "cell" : annotTool ? "crosshair" : "default" }}
                      />
                      {annotTextInput && (
                        <input
                          id="annot_text_input"
                          autoFocus
                          value={annotTextVal}
                          spellCheck
                          autoCorrect="on"
                          autoCapitalize="sentences"
                          onChange={(e) => setAnnotTextVal(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") commitAnnotText(); if (e.key === "Escape") setAnnotTextInput(null); }}
                          onBlur={commitAnnotText}
                          style={{
                            left: annotTextInput.vx - annotCanvasRef.current?.getBoundingClientRect().left,
                            top: annotTextInput.vy - annotCanvasRef.current?.getBoundingClientRect().top,
                            width: annotTextInput.width || undefined,
                          }}
                        />
                      )}
                      {drawTextBusy && (
                        <div id="pdf_draw_text_status">
                          <span className="pdf_draw_text_status_label">Draw to Text</span>
                          <span className="pdf_draw_text_status_body">
                            {drawTextStatus || "Reading selection…"}
                            {typeof drawTextProgress === "number" ? ` ${Math.round(drawTextProgress * 100)}%` : ""}
                          </span>
                        </div>
                      )}
                      {manualSelection && !manualPopup && onSelectionAction && selHandles && (
                        <>
                          <div
                            className="sel_handle sel_handle--start"
                            style={{ left: selHandles.start.x, top: selHandles.start.y, height: selHandles.start.h + 8 }}
                            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setDragHandle("start"); dragHandleRef.current = "start"; }}
                            onTouchStart={(e) => { e.stopPropagation(); dragHandleRef.current = "start"; setDragHandle("start"); }}
                          />
                          <div
                            className="sel_handle sel_handle--end"
                            style={{ left: selHandles.end.x, top: selHandles.end.y, height: selHandles.end.h + 8 }}
                            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setDragHandle("end"); dragHandleRef.current = "end"; }}
                            onTouchStart={(e) => { e.stopPropagation(); dragHandleRef.current = "end"; setDragHandle("end"); }}
                          />
                        </>
                      )}
                      {manualSelection && !manualPopup && onSelectionAction && (
                        <div ref={selBarRef} id="manual_select_bar" style={{ left: manualSelection.x, top: manualSelection.y }}>
                          <span id="msb_text">{manualSelection.text}</span>
                          {onSelectionAction ? (
                            <button id="msb_confirm" className="msb_action_btn" onClick={handleSelectionAction} disabled={selectionActionBusy}>
                              {selectionActionBusy ? "…" : selectionActionLabel}
                            </button>
                          ) : (
                            <button id="msb_confirm" onClick={confirmSelection}>✓</button>
                          )}
                          <button id="msb_cancel"  onClick={() => { setManualSelection(null); setSelectionActionError(""); window.getSelection()?.removeAllRanges(); }}>✕</button>
                          {selectionActionError && <span id="msb_error">{selectionActionError}</span>}
                        </div>
                      )}
                      {textSelectable && (
                        <div
                          ref={textLayerRef}
                          className="pdf_text_layer"
                          style={pageViewport
                            ? { width: pageViewport.width, height: pageViewport.height }
                            : { inset: 0, position: "absolute" }}
                          onMouseDown={handleTextMouseDown}
                          onMouseUp={handleTextSelection}
                        />
                      )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            </>
          ) : embedded ? (
            <div id="pdf_source_select_zone">
              {loading ? <p>Loading…</p> : loadError ? (
                <>
                  <span id="pdf_source_empty_icon">⚠️</span>
                  <p id="pdf_source_empty_msg">{loadError}</p>
                  <button
                    id="pdf_pick_btn"
                    type="button"
                    onClick={() => {
                      if (embeddedFile) loadFile(embeddedFile);
                      else loadFromSource(embeddedSourceId, embeddedPdfName || "document.pdf");
                    }}
                  >Retry</button>
                </>
              ) : (
                <>
                  <span id="pdf_source_empty_icon">📄</span>
                  <p id="pdf_source_empty_msg">No document loaded.</p>
                </>
              )}
            </div>
          ) : isNounsPage ? (
            <div id="pdf_source_select_zone">
              {loading ? <p>Loading…</p> : hyleSourcesLoading ? <p>Loading sources…</p> : hyleSources.length === 0 ? (
                <>
                  <span id="pdf_source_empty_icon">📂</span>
                  <p id="pdf_source_empty_msg">No sources yet.</p>
                  <p id="pdf_source_empty_sub">Go to <strong>Hyle Source Organisation</strong> to add PDFs.</p>
                </>
              ) : (
                <>
                  <label id="pdf_source_label" htmlFor="pdf_source_select">Choose Hyle Source</label>
                  <select
                    id="pdf_source_select"
                    defaultValue=""
                    onChange={(e) => {
                      const src = hyleSources.find((s) => s._id === e.target.value);
                      if (src) loadFromSource(src._id, src.name);
                    }}
                  >
                    <option value="" disabled>Select a source…</option>
                    {hyleSources.map((s) => (
                      <option key={s._id} value={s._id}>{s.name}</option>
                    ))}
                  </select>
                </>
              )}
            </div>
          ) : (
            <div
              id="pdf_drop_zone"
              className={dragOver ? "drag_over" : ""}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
            >
              {loading ? <p>Loading PDF…</p> : (
                <>
                  <span style={{ fontSize: "2rem" }}>📄</span>
                  <p>Drop a PDF here or click to select</p>
                  <button id="pdf_pick_btn" type="button">Choose file</button>
                </>
              )}
            </div>
          )}
          <input ref={fileInputRef} type="file" accept="application/pdf" style={{ display: "none" }} onChange={handleInputChange} />
          </div>
          {pdfDoc && pageMinimap.length > 0 && (
            <div id="pdf_page_minimap" aria-hidden="true">
              {pageMinimap.map((mini) => {
                const maxWidth = 92;
                const maxHeight = 124;
                const scale = Math.min(maxWidth / mini.pageWidth, maxHeight / mini.pageHeight);
                const miniWidth = Math.max(36, mini.pageWidth * scale);
                const miniHeight = Math.max(48, mini.pageHeight * scale);
                return (
                  <div key={mini.page} className="pdf_page_minimap_card">
                    <div className="pdf_page_minimap_label">p.{mini.page}</div>
                    <div className="pdf_page_minimap_sheet" style={{ width: miniWidth, height: miniHeight }}>
                      {mini.previewSrc && (
                        <img
                          className="pdf_page_minimap_image"
                          src={mini.previewSrc}
                          alt=""
                          draggable="false"
                        />
                      )}
                      <div
                        className="pdf_page_minimap_viewport"
                        style={{
                          left: mini.visibleLeft * scale,
                          top: mini.visibleTop * scale,
                          width: Math.max(10, mini.visibleWidth * scale),
                          height: Math.max(10, mini.visibleHeight * scale),
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Resize handle */}
        {splitRatio < 0.9 && splitRatio > 0 && (
          <div id="pdf_resize_handle" onMouseDown={handleResizeStart} onTouchStart={handleResizeStart} />
        )}

        {/* Right — Noun panel */}
        <div id="pdf_hyles_panel" style={{ display: splitRatio >= 0.9 ? "none" : undefined }}>

          <div id="pdf_hyles_panel_header">
            <button
              id="pdf_preview_toggle"
              onClick={togglePreview}
              title={splitRatio === 0 ? "Show PDF viewer" : "Hide PDF viewer"}
            >
              {splitRatio === 0 ? "›" : "‹"}
            </button>
            <span style={{ flex: 1 }}>
              {hylePage ? `Page ${hylePage} Hyles` : "Hyles"}
              {hyleData?._total > 0 && (
                <span style={{ fontWeight: 400, marginLeft: "0.5rem", color: "var(--color-text-muted)" }}>
                  ({hyleData._total} found)
                </span>
              )}
            </span>

            <div className="hyle_font_controls">
              <button className="hyle_font_btn" onClick={() => setHyleFontSize((s) => Math.max(0.5, +(s - 0.05).toFixed(2)))} disabled={hyleFontSize <= 0.5}>−</button>
              <span className="hyle_font_label">{Math.round(hyleFontSize * 100)}%</span>
              <button className="hyle_font_btn" onClick={() => setHyleFontSize((s) => Math.min(1.6, +(s + 0.05).toFixed(2)))} disabled={hyleFontSize >= 1.6}>+</button>
            </div>

            <button
              id="hyle_type_toggle_btn"
              className={typeTreeOpen ? "hyle_type_toggle_btn--open" : ""}
              onClick={() => setTypeTreeOpen((o) => !o)}
              title="Extraction type"
            >
              {extractionType ? HYLE_TYPE_LABELS[extractionType] : "Type"}
            </button>
          </div>

          {typeTreeOpen && (
            <div id="hyle_type_panel">
              {HYLE_TYPE_TREE.map((node) => renderTypeNode(node))}
            </div>
          )}

          {isNounsPage && (
            <div id="hyle_card_tabs">
              {CARDS.map(({ key, label }) => (
                <button
                  key={key}
                  className={`hyle_card_tab${activeCard === key ? " hyle_card_tab--active" : ""}`}
                  onClick={() => setLocalCard(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {!extracting && extractError && (
            <div id="pdf_hyles_error">
              <span>⚠ {extractError}</span>
              {pdfDoc && extractMode === "ai" && <button onClick={handleExtract}>Retry</button>}
            </div>
          )}

          <div id="pdf_hyles_body">
            <div id="pdf_hyles_table_area">
              <HyleCards
                data={hyleData || EMPTY_HYLES()}
                streaming={extracting}
                onStatus={handleHyleStatus}
                onMove={handleHyleMove}
                onDelete={handleHyleDelete}
                activeCard={activeCard}
                fontSize={hyleFontSize}
              />
            </div>

            {history.length > 0 && (
              <div id="pdf_history">
                <div id="pdf_history_label">
                  {historyLoading ? "Loading…" : "Sessions"}
                </div>
                <div id="pdf_history_scroll">
                  {history.map((item) => (
                    <div
                      key={item._id}
                      className={`phi_row${activeHistoryId === item._id ? " phi_row--active" : ""}`}
                      onClick={() => loadHistoryItem(item._id)}
                    >
                      <div className="phi_td_name">{item.documentId?.filename || "—"}</div>
                      <div className="phi_td_meta">p.{item.pageNumber} · {item.totalNouns} nouns · {item.provider}</div>
                      <div className="phi_td_del">
                        <button
                          className="phi_delete_btn"
                          onClick={(e) => handleDeleteExtraction(e, item._id)}
                          title="Delete"
                        >✕</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

        </div>
      </div>
      {showFooterSelection && (
        <div
          id="manual_popup_footer"
          onKeyDown={(e) => {
            if (e.key === "Enter" && manualPopup) handleManualAdd();
            if (e.key === "Escape") {
              setManualPopup(null);
              setManualSelection(null);
              window.getSelection()?.removeAllRanges();
            }
          }}
        >
          <div id="manual_popup">
            <div id="manual_popup_head">
              <span>{manualPopup ? "Selected Hyle" : "Selected Text"}</span>
            </div>
            {manualPopup ? (
              <>
                <input
                  id="manual_noun_input"
                  value={manualHyle}
                  onChange={(e) => setManualHyle(e.target.value)}
                  placeholder="Hyle"
                  autoFocus
                />
                <div id="manual_selects">
                  <select value={manualCard} onChange={(e) => setManualCard(e.target.value)}>
                    {CARDS.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}
                  </select>
                  <select value={manualMode} onChange={(e) => setManualMode(e.target.value)}>
                    {ALL_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </>
            ) : (
              <div id="manual_footer_editor">
                <button
                  id="manual_footer_left"
                  type="button"
                  onClick={adjustLeftBoundary}
                  onMouseDown={() => startFooterAdjust(adjustLeftBoundary)}
                  onMouseUp={stopFooterAdjust}
                  onMouseLeave={stopFooterAdjust}
                  onTouchStart={(e) => { e.preventDefault(); startFooterAdjust(adjustLeftBoundary); }}
                  onTouchEnd={stopFooterAdjust}
                  onTouchCancel={stopFooterAdjust}
                  disabled={!(manualSelection && manualSelection.startIdx >= 0 && manualSelection.endIdx >= 0)}
                  title="Trim left edge, then extend to the previous word once only one word remains"
                >
                  ←
                </button>
                <textarea
                  id="manual_footer_text"
                  value={footerSelectionText}
                  onChange={(e) => setManualSelection((sel) => sel ? { ...sel, text: e.target.value } : sel)}
                  rows={2}
                />
                <button
                  id="manual_footer_right"
                  type="button"
                  onClick={adjustRightBoundary}
                  onMouseDown={() => startFooterAdjust(adjustRightBoundary)}
                  onMouseUp={stopFooterAdjust}
                  onMouseLeave={stopFooterAdjust}
                  onTouchStart={(e) => { e.preventDefault(); startFooterAdjust(adjustRightBoundary); }}
                  onTouchEnd={stopFooterAdjust}
                  onTouchCancel={stopFooterAdjust}
                  disabled={!(manualSelection && manualSelection.startIdx >= 0 && manualSelection.endIdx >= 0)}
                  title="Trim right edge, then extend to the next word once only one word remains"
                >
                  →
                </button>
              </div>
            )}
            <div id="manual_actions">
              {manualPopup ? (
                <button id="manual_add_btn" onClick={handleManualAdd}>Add</button>
              ) : (
                <button id="manual_add_btn" onClick={() => { setManualSelection(null); window.getSelection()?.removeAllRanges(); }}>Done</button>
              )}
              <button id="manual_cancel_btn" onClick={() => { setManualPopup(null); setManualSelection(null); window.getSelection()?.removeAllRanges(); }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PDFPage;
