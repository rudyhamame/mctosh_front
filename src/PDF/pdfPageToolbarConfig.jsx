import React, { useCallback, useRef } from "react";
import { InfoPopupButton } from "./InfoPopupButton";

export const InsertPageIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M13 10h-2v3H8v2h3v3h2v-3h3v-2h-3z" />
    <path d="m19.94 7.68-.03-.09a.8.8 0 0 0-.2-.29l-5-5c-.09-.09-.19-.15-.29-.2l-.09-.03a.8.8 0 0 0-.26-.05c-.02 0-.04-.01-.06-.01H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-12s-.01-.04-.01-.06c0-.09-.02-.17-.05-.26ZM6 20V4h7v4c0 .55.45 1 1 1h4v11z" />
  </svg>
);

export const DeletePageIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M8 13h8v2H8z" />
    <path d="m19.94 7.68-.03-.09a.8.8 0 0 0-.2-.29l-5-5c-.09-.09-.19-.15-.29-.2l-.09-.03a.8.8 0 0 0-.26-.05c-.02 0-.04-.01-.06-.01H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-12s-.01-.04-.01-.06c0-.09-.02-.17-.05-.26ZM6 20V4h7v4c0 .55.45 1 1 1h4v11z" />
  </svg>
);

export const PDF_TYPE_LABEL = {
  "text-based": "Text-based",
  "mixed": "Mixed",
  "scanned": "Scanned",
};

export const CARDS = [
  { key: "entities", label: "Entities" },
  { key: "traces", label: "Traces" },
  { key: "phenomena", label: "Phenomena" },
  { key: "concept", label: "Concept" },
  { key: "models", label: "Models" },
];

export const HYLE_TYPE_TREE = [
  {
    key: "morpheme", label: "Morpheme",
    children: [
      {
        key: "morpheme.base", label: "Base",
        children: [
          { key: "morpheme.base.free", label: "Free", note: "simple word" },
          { key: "morpheme.base.bound", label: "Bound" },
        ],
      },
      {
        key: "morpheme.affix", label: "Affix",
        children: [
          { key: "morpheme.affix.prefix", label: "Prefix" },
          { key: "morpheme.affix.connecting", label: "Connecting vowel" },
          { key: "morpheme.affix.suffix", label: "Suffix" },
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
  { key: "syntagm", label: "Syntagm" },
  { key: "paradigm", label: "Paradigm" },
];

export const HYLE_TYPE_LABELS = {
  "morpheme.base.free": "Free base",
  "morpheme.base.bound": "Bound base",
  "morpheme.affix.prefix": "Prefix",
  "morpheme.affix.connecting": "Connecting vowel",
  "morpheme.affix.suffix": "Suffix",
  "word.compound": "Compound",
  "syntagm": "Syntagm",
  "paradigm": "Paradigm",
};

export const ANNOT_TOOLS = [
  { key: "highlight", icon: "bx bx-highlight", label: "Highlight", hasSize: true },
  {
    key: "underline",
    iconSvg: (
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="2 2 20 20">
        <path d="M5 18h14v2H5zM17 8V4H7v4h2V6h2v8H9v2h6v-2h-2V6h2v2z" />
      </svg>
    ),
    label: "Underline",
    hasSize: false,
  },
  { key: "strikethrough", icon: "bx bx-strikethrough", label: "Strikethrough", hasSize: false },
  { key: "pen", icon: "bx bx-pencil", label: "Pen", hasSize: true },
  { key: "line", icon: "bx bx-minus", label: "Line", hasSize: false },
  { key: "arrow", icon: "bx bx-right-arrow-alt", label: "Arrow", hasSize: true },
  { key: "rect", icon: "bx bx-rectangle", label: "Rectangle", hasSize: false },
  { key: "bbox", icon: "bx bx-crop", label: "Segmentation", hasSize: false },
  { key: "circle", icon: "bx bx-circle", label: "Ellipse", hasSize: false },
  {
    key: "freeshape",
    iconSvg: (
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="2 2 20 20">
        <path d="M12 3c2.4 0 4 1.3 5.4 2.8 1.5 1.6 3.6 2.9 3.6 5.4 0 2.1-1.8 3.1-3.4 4.3-1.5 1.1-2.9 2.5-5.6 2.5-2.5 0-4.3-1.2-5.8-2.6C4.7 14 3 12.7 3 10.6c0-2.3 1.9-3.4 3.6-4.7C8.1 4.6 9.7 3 12 3Zm0 2c-1.5 0-2.7 1.2-4.1 2.3C6.5 8.4 5 9.2 5 10.6c0 1.2 1.1 2.1 2.6 3.2 1.3 1 2.7 2.2 4.4 2.2 1.9 0 3-1 4.3-2 1.2-.9 2.7-1.7 2.7-3.2 0-1.5-1.5-2.5-2.9-3.9C14.9 5.6 13.6 5 12 5Z" />
      </svg>
    ),
    label: "Freeshape",
    hasSize: false,
  },
  {
    key: "text",
    iconSvg: (
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="2 2 20 20">
        <path d="M7 9h10v2H7zm0 4h7v2H7z" />
        <path d="M12 2C6.49 2 2 6.49 2 12c0 2.12.68 4.19 1.93 5.9l-1.75 2.53c-.21.31-.24.7-.06 1.03.17.33.51.54.89.54h9c5.51 0 10-4.49 10-10S17.51 2 12 2m0 18H4.91L6 18.43c.26-.37.23-.88-.06-1.22A7.98 7.98 0 0 1 4.01 12c0-4.41 3.59-8 8-8s8 3.59 8 8-3.59 8-8 8Z" />
      </svg>
    ),
    label: "Text",
    hasSize: false,
  },
  { key: "drawText", icon: "bx bx-magic-wand", label: "Draw to Text", hasSize: false },
  { key: "eraser", icon: "bx bx-eraser", label: "Eraser", hasSize: true },
  {
    key: "smartVideo",
    iconSvg: (
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="2 2 20 20">
        <path d="M20 3H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h7v3H8v2h8v-2h-3v-3h7c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2M4 15V5h16v10z" />
        <path d="m10 13 5-3-5-3z" />
      </svg>
    ),
    label: "Extract Eidos and Find Videos",
    hasSize: false,
  },
];

export const SHAPE_TOOL_KEYS = ["line", "arrow", "rect", "circle", "freeshape"];
export const DRAWING_TOOL_ORDER = [
  "pen",
  "highlight",
  "underline",
  "strikethrough",
  "shapes",
  "text",
  "drawText",
  "bbox",
  "eraser",
];
export const MODE_TOOL_ORDER = ["smartVideo"];

export const ANNOT_COLORS = [
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

export const ANNOT_COLOR_GROUPS = [
  { label: "Neutrals", colors: ANNOT_COLORS.slice(0, 5) },
  { label: "Warm", colors: ANNOT_COLORS.slice(5, 14) },
  { label: "Cool", colors: ANNOT_COLORS.slice(14, 29) },
  { label: "Green", colors: ANNOT_COLORS.slice(29, 38) },
  { label: "Sun", colors: ANNOT_COLORS.slice(38) },
];

export const BBOX_DISTINCT_COLORS = [
  "#fa5252",
  "#e64980",
  "#be4bdb",
  "#7950f2",
  "#4c6ef5",
  "#339af0",
  "#22b8cf",
  "#20c997",
  "#51cf66",
  "#94d82d",
  "#fcc419",
  "#fd7e14",
];

export const DEFAULT_ANNOT_TOOL_COLORS = {
  highlight: "#ffe066",
  pen: "#212529",
  underline: "#fa5252",
  strikethrough: "#e03131",
  line: "#4c6ef5",
  arrow: "#339af0",
  rect: "#20c997",
  bbox: "#339af0",
  circle: "#fd7e14",
  text: "#212529",
  drawText: "#212529",
};

export const BBOX_MIN_GAP = 1;

export const resolveBBoxSpacing = (candidate, obstacles, gap = BBOX_MIN_GAP) => {
  if (!candidate) return candidate;
  const next = { ...candidate };
  const overlapsWithGap = (a, b) => (
    a.x < b.x + b.w + gap
    && a.x + a.w + gap > b.x
    && a.y < b.y + b.h + gap
    && a.y + a.h + gap > b.y
  );

  for (let iter = 0; iter < 12; iter++) {
    let moved = false;
    for (const obs of obstacles) {
      if (!obs || !overlapsWithGap(next, obs)) continue;

      const shifts = [
        { dx: (obs.x - gap) - (next.x + next.w), dy: 0 },
        { dx: (obs.x + obs.w + gap) - next.x, dy: 0 },
        { dx: 0, dy: (obs.y - gap) - (next.y + next.h) },
        { dx: 0, dy: (obs.y + obs.h + gap) - next.y },
      ];

      let best = null;
      for (const shift of shifts) {
        const test = {
          x: next.x + shift.dx,
          y: next.y + shift.dy,
          w: next.w,
          h: next.h,
        };
        if (overlapsWithGap(test, obs)) continue;
        const dist = Math.abs(shift.dx) + Math.abs(shift.dy);
        if (!best || dist < best.dist) best = { ...shift, dist };
      }

      if (!best) continue;
      next.x += best.dx;
      next.y += best.dy;
      moved = true;
    }
    if (!moved) break;
  }

  return next;
};

export const bendPointAwayFromRect = (point, rect, gap = BBOX_MIN_GAP) => {
  if (!point || !rect) return point;
  const pad = Math.max(0, Number(gap) || 0);
  const left = rect.x - pad;
  const right = rect.x + rect.w + pad;
  const top = rect.y - pad;
  const bottom = rect.y + rect.h + pad;
  const inside = point.x >= left && point.x <= right && point.y >= top && point.y <= bottom;
  if (!inside) return point;
  const distLeft = point.x - left;
  const distRight = right - point.x;
  const distTop = point.y - top;
  const distBottom = bottom - point.y;
  const minDist = Math.min(distLeft, distRight, distTop, distBottom);
  const next = { ...point };
  if (minDist === distLeft) next.x = rect.x - pad;
  else if (minDist === distRight) next.x = rect.x + rect.w + pad;
  else if (minDist === distTop) next.y = rect.y - pad;
  else next.y = rect.y + rect.h + pad;
  return next;
};

export const bendPointAwayFromObstacles = (point, obstacles, gap = BBOX_MIN_GAP) => {
  if (!point) return point;
  let next = { ...point };
  for (let iter = 0; iter < 4; iter++) {
    let moved = false;
    for (const obstacle of obstacles || []) {
      const bent = bendPointAwayFromRect(next, obstacle, gap);
      if (bent !== next && (bent.x !== next.x || bent.y !== next.y)) {
        next = bent;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return next;
};

export const TEXT_FONT_FAMILIES = [
  { key: "Georgia", label: "Georgia" },
  { key: "Arial", label: "Arial" },
  { key: "Verdana", label: "Verdana" },
  { key: "Trebuchet MS", label: "Trebuchet MS" },
  { key: "Times New Roman", label: "Times New Roman" },
  { key: "Courier New", label: "Courier New" },
];

export const ANNOT_HISTORY_META = {
  add: { icon: "bx bx-plus", verb: "Added" },
  edit: { icon: "bx bx-edit", verb: "Edited" },
  undo: { icon: "bx bx-undo", verb: "Undid" },
  redo: { icon: "bx bx-redo", verb: "Redid" },
  erase: { icon: "bx bx-eraser", verb: "Erased" },
  clear: { icon: "bx bx-trash", verb: "Cleared" },
};

export const PenToolIcon = () => (
  <svg className="pdf_toolbar_svg_icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="2 2 20 20" aria-hidden="true">
    <path d="M19.41 3c-.78-.78-2.05-.78-2.83 0l-2.09 2.09L12.7 3.3a.996.996 0 0 0-1.41 0l-6 6 1.41 1.41 5.29-5.29 1.09 1.09-8.79 8.78c-.13.13-.22.29-.26.46l-1 4c-.08.34.01.7.26.95.19.19.45.29.71.29.08 0 .16 0 .24-.03l4-1c.18-.04.34-.13.46-.26L20.99 7.41c.78-.78.78-2.05 0-2.83L19.4 2.99ZM7.48 18.1l-2.11.53.53-2.11 8.6-8.61 1.59 1.59-8.6 8.6ZM17.49 8.09 15.9 6.5l2.09-2.09 1.59 1.58-2.09 2.09Z" />
  </svg>
);

export const ShapesToolIcon = () => (
  <svg className="pdf_toolbar_svg_icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="2 2 20 20" aria-hidden="true">
    <path d="M20 8h-2.27c-.89-3.47-4.07-6-7.73-6-4.41 0-8 3.59-8 8 0 3.66 2.53 6.84 6 7.73V20c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2M8 10v5.64c-2.34-.83-4-3.08-4-5.64 0-3.31 2.69-6 6-6 2.57 0 4.81 1.66 5.64 4H10c-1.1 0-2 .9-2 2m12 10H10V10h10z" />
  </svg>
);

export const ArrowToolIcon = () => (
  <svg className="pdf_toolbar_svg_icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="2 2 20 20" aria-hidden="true">
    <path d="M6 13h8.09l-3.3 3.29 1.42 1.42 5.7-5.71-5.7-5.71-1.42 1.42 3.3 3.29H6z" />
  </svg>
);

export const FreeshapeToolIcon = () => (
  <svg className="pdf_toolbar_svg_icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="2 2 20 20" aria-hidden="true">
    <path d="M12 3c2.4 0 4 1.3 5.4 2.8 1.5 1.6 3.6 2.9 3.6 5.4 0 2.1-1.8 3.1-3.4 4.3-1.5 1.1-2.9 2.5-5.6 2.5-2.5 0-4.3-1.2-5.8-2.6C4.7 14 3 12.7 3 10.6c0-2.3 1.9-3.4 3.6-4.7C8.1 4.6 9.7 3 12 3Zm0 2c-1.5 0-2.7 1.2-4.1 2.3C6.5 8.4 5 9.2 5 10.6c0 1.2 1.1 2.1 2.6 3.2 1.3 1 2.7 2.2 4.4 2.2 1.9 0 3-1 4.3-2 1.2-.9 2.7-1.7 2.7-3.2 0-1.5-1.5-2.5-2.9-3.9C14.9 5.6 13.6 5 12 5Z" />
  </svg>
);

export const SmartVideoIcon = () => (
  <svg className="pdf_toolbar_svg_icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="2 2 20 20" aria-hidden="true">
    <path d="M20 3H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h7v3H8v2h8v-2h-3v-3h7c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2M4 15V5h16v10z" />
    <path d="m10 13 5-3-5-3z" />
  </svg>
);

const KNOB_MIN_PX = 8;
const KNOB_MAX_PX = 22;
const KNOB_PAD_PX = 12;
const KNOB_TRACK_W = 64;
const KNOB_LABEL_W = 44;
const KNOB_TOTAL_W = KNOB_TRACK_W + KNOB_LABEL_W;
const OPACITY_MIN_PCT = 10;
const OPACITY_MAX_PCT = 90;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const SizeKnob = ({ min, max, step, value, onChange, color, dashed, variant = "dot" }) => {
  const trackRef = useRef(null);
  const draggingRef = useRef(false);

  const nudgeSize = useCallback((direction) => {
    const precision = String(step).includes(".") ? String(step).split(".")[1].length : 0;
    const next = clamp(value + (direction * step), min, max);
    onChange(Number(next.toFixed(precision)));
  }, [max, min, onChange, step, value]);

  const updateFromClientX = useCallback((clientX) => {
    const rect = trackRef.current.getBoundingClientRect();
    const usable = KNOB_TRACK_W - KNOB_PAD_PX * 2;
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

  const frac = Math.min(1, Math.max(0, (value - min) / (max - min)));
  const knobSize = KNOB_MIN_PX + frac * (KNOB_MAX_PX - KNOB_MIN_PX);
  const highlightPreviewHeight = clamp(value * 0.65, 5, 26);
  const highlightPreviewWidth = clamp(22 + value * 0.55, 28, 54);
  const centerX = KNOB_PAD_PX + frac * (KNOB_TRACK_W - KNOB_PAD_PX * 2);

  return (
    <div className="annot_size_knob">
      <div className="annot_size_stepper" aria-label="Adjust tool size">
        <button type="button" className="annot_size_stepper_btn" onClick={() => nudgeSize(1)} disabled={value >= max} title="Increase size">+</button>
        <button type="button" className="annot_size_stepper_btn" onClick={() => nudgeSize(-1)} disabled={value <= min} title="Decrease size">-</button>
      </div>
      <div
        className="annot_size_knob_track"
        ref={trackRef}
        style={{ width: KNOB_TOTAL_W }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        title="Size"
      >
        <div className="annot_size_knob_fill" style={{ width: centerX }} />
        {variant === "highlight" ? (
          <div
            className="annot_size_highlight_preview"
            style={{ width: highlightPreviewWidth, height: highlightPreviewHeight, left: centerX, color, background: color }}
          />
        ) : (
          <div
            className={`annot_size_knob_dot${dashed ? " annot_size_knob_dot--eraser" : ""}`}
            style={{ width: knobSize, height: knobSize, left: centerX, background: dashed ? "transparent" : color }}
          />
        )}
        <span className="annot_size_label">{Number.isInteger(value) ? value : value.toFixed(1)}pt</span>
      </div>
    </div>
  );
};

export const OpacityKnob = ({ value, onChange, color }) => {
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

  const frac = Math.min(1, Math.max(0, (value - OPACITY_MIN_PCT) / (OPACITY_MAX_PCT - OPACITY_MIN_PCT)));
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
      <div className="annot_size_knob_dot" style={{ width: 14, height: 14, left: centerX, background: color, opacity: value / 100 }} />
    </div>
  );
};

export const PercentKnob = ({ value, onChange, min = 0, max = 100, step = 5, label = "%" }) => {
  const trackRef = useRef(null);
  const draggingRef = useRef(false);

  const updateFromClientX = useCallback((clientX) => {
    const rect = trackRef.current.getBoundingClientRect();
    const usable = KNOB_TRACK_W - KNOB_PAD_PX * 2;
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
        style={{ width: KNOB_TOTAL_W }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        title={`${value}${label}`}
      >
        <div className="annot_size_knob_fill" style={{ width: centerX }} />
        <div className="annot_size_knob_dot annot_size_knob_dot--percent" style={{ width: 14, height: 14, left: centerX }} />
        <span className="annot_size_label">{value}{label}</span>
      </div>
    </div>
  );
};

export const LabeledPercentKnob = ({ title, subtitle, ...props }) => (
  <div className="annot_control">
    <div className="annot_control_head annot_control_head--info">
      <span className="annot_control_title">{title}</span>
      {subtitle ? (
        <div className="annot_control_info_wrap">
          <InfoPopupButton info={subtitle} label="More info" />
        </div>
      ) : null}
    </div>
    <PercentKnob {...props} />
  </div>
);

export const AnnotControlHeaderInfo = ({ title, info }) => (
  <div className="annot_control_head annot_control_head--info">
    <span className="annot_control_title">{title}</span>
    {info ? (
      <div className="annot_control_info_wrap">
        <InfoPopupButton info={info} label={`${title} info`} />
      </div>
    ) : null}
  </div>
);
