import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiUrl } from "../config/api";
import { readStoredSession } from "../utils/sessionCleanup";
import "./freeformPage.css";

const authHeader = () => {
  const token = readStoredSession()?.token || "";
  return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
};

const AUTOSAVE_DELAY_MS = 1200;
const MIN_SCALE = 0.25;
const MAX_SCALE = 3;
const GRID_SIZE = 24;
const HISTORY_LIMIT = 50;
const ERASE_RADIUS = 10;

const COLORS = [
  "#1d1d1f", // graphite
  "#ff3b30", // red
  "#ff9500", // orange
  "#ffcc00", // yellow
  "#34c759", // green
  "#007aff", // blue
  "#af52de", // purple
  "#8e8e93", // gray
];

const STROKE_WIDTHS = [2, 4, 8];

const ERASE_TARGETS = [
  { id: "all",      icon: "fi-rr-objects-column", label: "All" },
  { id: "strokes",  icon: "fi-rr-pencil",         label: "Strokes" },
  { id: "elements", icon: "fi-rr-vector",         label: "Elements" },
];

const ERASE_MODES = [
  { id: "whole",     icon: "fi-rr-eraser",       label: "Whole", hint: "Touch an item to erase all of it" },
  { id: "precision", icon: "fi-rr-scalpel-path", label: "Precision", hint: "Only erases the ink you actually drag over" },
];

const ERASE_RADII = [10, 18, 28]; // precision-mode brush radius, small/medium/large, world px

const TOOLS = [
  { id: "select", icon: "fi-rr-cursor", title: "Select (V)" },
  { id: "pan",    icon: "fi-rr-arrows-alt",   title: "Pan (H)" },
  { id: "pen",    icon: "fi-rr-pencil", title: "Pen (P)" },
  { id: "text",   icon: "fi-rr-text",   title: "Text (T)" },
  { id: "sticky", icon: "fi-rr-note-sticky", title: "Sticky note (S)" },
  { id: "rect",   icon: "fi-rr-square", title: "Rectangle (R)" },
  { id: "ellipse", icon: "fi-rr-circle", title: "Ellipse (O)" },
  { id: "eraser", icon: "fi-rr-eraser", title: "Eraser (E)" },
];

const TOOL_KEYS = { v: "select", h: "pan", p: "pen", t: "text", s: "sticky", r: "rect", o: "ellipse", e: "eraser" };

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

const distanceToSegment = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = clamp(t, 0, 1);
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
};

const strokeToPath = (points) => {
  if (!points.length) return "";
  return points.reduce((d, [x, y], i) => `${d}${i === 0 ? "M" : "L"}${x},${y} `, "");
};

const FreeformPage = () => {
  const navigate = useNavigate();
  const { id } = useParams();

  const [boardName, setBoardName] = useState("Untitled Board");
  const [elements, setElements] = useState([]);
  const [strokes, setStrokes] = useState([]);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [scale, setScale] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saveStatus, setSaveStatus] = useState(""); // "" | "saving" | "saved" | "error"

  const [tool, setTool] = useState("select");
  const [color, setColor] = useState("#1d1d1f");
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [selectedIds, setSelectedIds] = useState(() => new Set()); // multi-select — populated by a marquee drag as well as single clicks
  const [editingId, setEditingId] = useState(null);
  const [eraseTarget, setEraseTarget] = useState("all"); // 'all' | 'strokes' | 'elements'
  const [eraseMode, setEraseMode] = useState("whole"); // 'whole' | 'precision'
  const [eraseRadius, setEraseRadius] = useState(18); // precision-mode brush radius, world px

  const [draftStroke, setDraftStroke] = useState(null);
  const [draftShape, setDraftShape] = useState(null);
  const [draftMarquee, setDraftMarquee] = useState(null); // live rectangle while drag-selecting on empty canvas

  const [historyPast, setHistoryPast] = useState([]);
  const [historyFuture, setHistoryFuture] = useState([]);

  const canvasRef = useRef(null);
  const interactionRef = useRef(null); // { mode, ...data } for the in-progress mouse gesture
  const saveTimerRef = useRef(null);
  const savingRef = useRef(false);
  const editSnapshotRef = useRef(null); // {elements,strokes} captured the moment text editing begins

  const showPalette = ["pen", "text", "sticky", "rect", "ellipse"].includes(tool);

  // ── Load this board by id ──
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError("");
    fetch(apiUrl(`/api/freeform/${id}`), { headers: authHeader() })
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (!ok) throw new Error(data.error || "Failed to load that board.");
        setBoardName(data.title || "Untitled Board");
        setElements(Array.isArray(data.elements) ? data.elements : []);
        setStrokes(Array.isArray(data.strokes) ? data.strokes : []);
        setTx(data.viewport?.tx ?? 0);
        setTy(data.viewport?.ty ?? 0);
        setScale(data.viewport?.scale ?? 1);
        setHistoryPast([]);
        setHistoryFuture([]);
        setSelectedIds(new Set());
      })
      .catch((err) => { if (!cancelled) setLoadError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  // ── Autosave (debounced so drawing/panning doesn't fire a request per frame) ──
  useEffect(() => {
    if (loading) return; // don't stomp the board with empty initial state before the load above resolves
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      if (savingRef.current) return;
      savingRef.current = true;
      setSaveStatus("saving");
      try {
        const res = await fetch(apiUrl(`/api/freeform/${id}`), {
          method: "PATCH",
          headers: authHeader(),
          body: JSON.stringify({ elements, strokes, viewport: { tx, ty, scale } }),
        });
        if (!res.ok) throw new Error();
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus((s) => (s === "saved" ? "" : s)), 1800);
      } catch {
        setSaveStatus("error");
      } finally {
        savingRef.current = false;
      }
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(saveTimerRef.current);
  }, [id, loading, elements, strokes, tx, ty, scale]);

  const saveTitle = useCallback(async (newTitle) => {
    const trimmed = newTitle.trim() || "Untitled Board";
    setBoardName(trimmed);
    try {
      await fetch(apiUrl(`/api/freeform/${id}`), {
        method: "PATCH",
        headers: authHeader(),
        body: JSON.stringify({ title: trimmed }),
      });
    } catch { /* best-effort — the list page will show the last-saved title on next visit */ }
  }, [id]);

  // ── History ──
  const pushHistory = useCallback((snapshot) => {
    setHistoryPast((h) => [...h.slice(-(HISTORY_LIMIT - 1)), snapshot]);
    setHistoryFuture([]);
  }, []);

  const snapshotNow = useCallback(() => ({ elements, strokes }), [elements, strokes]);

  const undo = useCallback(() => {
    setHistoryPast((h) => {
      if (!h.length) return h;
      const prev = h[h.length - 1];
      setHistoryFuture((f) => [...f, { elements, strokes }]);
      setElements(prev.elements);
      setStrokes(prev.strokes);
      setSelectedIds(new Set());
      return h.slice(0, -1);
    });
  }, [elements, strokes]);

  const redo = useCallback(() => {
    setHistoryFuture((f) => {
      if (!f.length) return f;
      const next = f[f.length - 1];
      setHistoryPast((h) => [...h, { elements, strokes }]);
      setElements(next.elements);
      setStrokes(next.strokes);
      setSelectedIds(new Set());
      return f.slice(0, -1);
    });
  }, [elements, strokes]);

  // ── Coordinate transform ──
  const screenToWorld = useCallback((clientX, clientY) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: (clientX - rect.left - tx) / scale, y: (clientY - rect.top - ty) / scale };
  }, [tx, ty, scale]);

  const hitTestElement = useCallback((x, y) => {
    for (let i = elements.length - 1; i >= 0; i--) {
      const el = elements[i];
      if (x >= el.x && x <= el.x + el.w && y >= el.y && y <= el.y + el.h) return el;
    }
    return null;
  }, [elements]);

  const hitTestStroke = useCallback((x, y) => {
    const threshold = ERASE_RADIUS / scale;
    for (let i = strokes.length - 1; i >= 0; i--) {
      const pts = strokes[i].points;
      for (let j = 0; j < pts.length - 1; j++) {
        if (distanceToSegment(x, y, pts[j][0], pts[j][1], pts[j + 1][0], pts[j + 1][1]) <= threshold) {
          return strokes[i];
        }
      }
    }
    return null;
  }, [strokes, scale]);

  // ── Eraser — respects eraseTarget (what it touches) and eraseMode (how it
  // erases). "Whole" deletes the entire item it touches, like the original
  // eraser did; "Precision" only applies to strokes and removes just the
  // points within the brush radius, splitting the remainder into separate
  // strokes wherever a gap opens up — elements are never partially erased
  // (there's no meaningful "half a rectangle"), so precision mode still
  // deletes them wholly. Marks gesture.changed so the caller knows whether
  // to record an undo step; mutating that flag here (synchronously, before
  // any setState calls) rather than inside a setState updater avoids relying
  // on updater-callback timing, which React doesn't guarantee is immediate. ──
  const performErase = useCallback((x, y, gesture) => {
    if (eraseTarget !== "strokes") {
      const hitEl = hitTestElement(x, y);
      if (hitEl) {
        gesture.changed = true;
        setElements((els) => els.filter((el) => el.id !== hitEl.id));
      }
    }

    if (eraseTarget !== "elements") {
      if (eraseMode === "whole") {
        const hitStroke = hitTestStroke(x, y);
        if (hitStroke) {
          gesture.changed = true;
          setStrokes((ss) => ss.filter((s) => s.id !== hitStroke.id));
        }
      } else {
        const r = eraseRadius / scale;
        const anyHit = strokes.some((s) => s.points.some(([px, py]) => Math.hypot(px - x, py - y) <= r));
        if (anyHit) {
          gesture.changed = true;
          setStrokes((ss) => {
            const next = [];
            for (const s of ss) {
              const keptRuns = [];
              let current = [];
              let strokeChanged = false;
              for (const p of s.points) {
                if (Math.hypot(p[0] - x, p[1] - y) <= r) {
                  strokeChanged = true;
                  if (current.length) { keptRuns.push(current); current = []; }
                } else {
                  current.push(p);
                }
              }
              if (current.length) keptRuns.push(current);
              if (!strokeChanged) { next.push(s); continue; }
              for (const run of keptRuns) {
                if (run.length >= 2) next.push({ id: uid(), color: s.color, width: s.width, points: run });
              }
            }
            return next;
          });
        }
      }
    }
  }, [eraseTarget, eraseMode, eraseRadius, scale, strokes, hitTestElement, hitTestStroke]);

  // ── Zoom / pan via wheel ──
  // React registers "wheel" as a passive root listener by default, so
  // e.preventDefault() inside a JSX onWheel handler is silently ignored —
  // Ctrl/Cmd+wheel (and trackpad pinch, which browsers report as wheel +
  // ctrlKey) was zooming the canvas *and* the browser's native page zoom at
  // the same time, which is what made zooming feel broken/jerky. A native
  // listener with { passive: false } is the only way to actually stop the
  // native gesture and get a single, continuous zoom.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;

    const handleWheel = (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        // Exponential response: proportional and stable across both fine-grained
        // trackpad deltas and larger, discrete mouse-wheel notches, so the zoom
        // feels continuous instead of jumping in big steps.
        const factor = Math.exp(-e.deltaY * 0.0018);
        setScale((prevScale) => {
          const next = clamp(prevScale * factor, MIN_SCALE, MAX_SCALE);
          setTx((prevTx) => cx - (cx - prevTx) * (next / prevScale));
          setTy((prevTy) => cy - (cy - prevTy) * (next / prevScale));
          return next;
        });
      } else {
        setTx((t) => t - e.deltaX);
        setTy((t) => t - e.deltaY);
      }
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, []);

  // ── Creation helpers ──
  const addElement = useCallback((type, x, y, overrides = {}) => {
    pushHistory(snapshotNow());
    const base = {
      id: uid(),
      type,
      x,
      y,
      w: type === "sticky" ? 200 : type === "text" ? 220 : 160,
      h: type === "sticky" ? 160 : type === "text" ? 60 : 120,
      text: "",
      color,
      ...overrides,
    };
    setElements((els) => [...els, base]);
    return base;
  }, [color, pushHistory, snapshotNow]);

  // Starts dragging one element — or, if it's already part of a multi-object
  // selection, the whole group together. Shared by the per-element mousedown
  // handlers below and the canvas-level fallback in the Select tool.
  const beginDrag = useCallback((el, x, y) => {
    const startIds = selectedIds.has(el.id) && selectedIds.size > 1 ? selectedIds : new Set([el.id]);
    setSelectedIds(startIds);
    const origins = {};
    elements.forEach((e2) => { if (startIds.has(e2.id)) origins[e2.id] = { x: e2.x, y: e2.y }; });
    interactionRef.current = {
      mode: "drag",
      ids: startIds,
      origins,
      startX: x,
      startY: y,
      snapshot: snapshotNow(),
      moved: false,
    };
  }, [selectedIds, elements, snapshotNow]);

  // ── Mouse handlers ──
  const onCanvasMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    if (editingId) return; // let the textarea keep focus/blur naturally
    e.preventDefault(); // stop the browser treating pen/shape drags as a text-selection drag (which pops the native Copy/Search toolbar)
    const { x, y } = screenToWorld(e.clientX, e.clientY);

    if (tool === "select") {
      // Select is purely for picking/moving/resizing objects — it never
      // pans, even when the click misses everything (use the dedicated Pan
      // tool for that instead, so the two don't fight over what a drag does).
      // A miss starts a marquee (container) selection instead of panning:
      // drag a box and everything it touches gets selected together.
      const hit = hitTestElement(x, y);
      if (hit) {
        beginDrag(hit, x, y);
      } else {
        setSelectedIds(new Set());
        interactionRef.current = { mode: "marquee", startX: x, startY: y };
        setDraftMarquee({ x, y, w: 0, h: 0 });
      }
      return;
    }

    if (tool === "pan") {
      interactionRef.current = { mode: "pan", lastX: e.clientX, lastY: e.clientY };
      return;
    }

    if (tool === "pen") {
      setDraftStroke({ color, width: strokeWidth, points: [[x, y]] });
      interactionRef.current = { mode: "draw", snapshot: snapshotNow() };
      return;
    }

    if (tool === "text") {
      const el = addElement("text", x, y, { h: 40 });
      setTool("select");
      setSelectedIds(new Set([el.id]));
      setEditingId(el.id);
      editSnapshotRef.current = { elements: [...elements, el], strokes };
      return;
    }

    if (tool === "sticky") {
      const el = addElement("sticky", x, y);
      setTool("select");
      setSelectedIds(new Set([el.id]));
      setEditingId(el.id);
      editSnapshotRef.current = { elements: [...elements, el], strokes };
      return;
    }

    if (tool === "rect" || tool === "ellipse") {
      interactionRef.current = { mode: "shape", startX: x, startY: y, snapshot: snapshotNow() };
      setDraftShape({ type: tool, x, y, w: 0, h: 0, color });
      return;
    }

    if (tool === "eraser") {
      const gesture = { mode: "erase", snapshot: snapshotNow(), changed: false };
      interactionRef.current = gesture;
      performErase(x, y, gesture);
      return;
    }
  }, [tool, color, strokeWidth, editingId, screenToWorld, hitTestElement, hitTestStroke, addElement, pushHistory, snapshotNow, performErase, beginDrag]);

  const onCanvasMouseMove = useCallback((e) => {
    const gesture = interactionRef.current;
    if (!gesture) return;
    const { x, y } = screenToWorld(e.clientX, e.clientY);

    if (gesture.mode === "pan") {
      const dx = e.clientX - gesture.lastX;
      const dy = e.clientY - gesture.lastY;
      gesture.lastX = e.clientX;
      gesture.lastY = e.clientY;
      setTx((t) => t + dx);
      setTy((t) => t + dy);
      return;
    }

    if (gesture.mode === "drag") {
      gesture.moved = true;
      const dx = x - gesture.startX;
      const dy = y - gesture.startY;
      setElements((els) => els.map((el) => {
        const origin = gesture.origins[el.id];
        return origin ? { ...el, x: origin.x + dx, y: origin.y + dy } : el;
      }));
      return;
    }

    if (gesture.mode === "marquee") {
      setDraftMarquee({
        x: Math.min(gesture.startX, x),
        y: Math.min(gesture.startY, y),
        w: Math.abs(x - gesture.startX),
        h: Math.abs(y - gesture.startY),
      });
      return;
    }

    if (gesture.mode === "resize") {
      gesture.moved = true;
      const nw = Math.max(30, gesture.elW + (x - gesture.startX));
      const nh = Math.max(24, gesture.elH + (y - gesture.startY));
      setElements((els) => els.map((el) => (el.id === gesture.id ? { ...el, w: nw, h: nh } : el)));
      return;
    }

    if (gesture.mode === "draw") {
      setDraftStroke((s) => (s ? { ...s, points: [...s.points, [x, y]] } : s));
      return;
    }

    if (gesture.mode === "shape") {
      setDraftShape((s) => (s ? {
        ...s,
        x: Math.min(gesture.startX, x),
        y: Math.min(gesture.startY, y),
        w: Math.abs(x - gesture.startX),
        h: Math.abs(y - gesture.startY),
      } : s));
      return;
    }

    if (gesture.mode === "erase") {
      performErase(x, y, gesture);
    }
  }, [screenToWorld, performErase]);

  const onCanvasMouseUp = useCallback(() => {
    const gesture = interactionRef.current;
    interactionRef.current = null;

    if (!gesture) return;

    if ((gesture.mode === "drag" || gesture.mode === "resize") && gesture.moved) {
      pushHistory(gesture.snapshot);
    }

    if (gesture.mode === "erase" && gesture.changed) {
      pushHistory(gesture.snapshot);
    }

    if (gesture.mode === "draw") {
      setDraftStroke((s) => {
        if (s && s.points.length > 1) {
          pushHistory(gesture.snapshot);
          setStrokes((ss) => [...ss, { id: uid(), color: s.color, width: s.width, points: s.points }]);
        }
        return null;
      });
    }

    if (gesture.mode === "shape") {
      setDraftShape((s) => {
        if (s && s.w > 4 && s.h > 4) {
          pushHistory(gesture.snapshot);
          setElements((els) => [...els, { id: uid(), type: s.type, x: s.x, y: s.y, w: s.w, h: s.h, color: s.color, text: "" }]);
        }
        return null;
      });
      setTool("select");
    }

    if (gesture.mode === "marquee") {
      setDraftMarquee((m) => {
        if (m && (m.w > 2 || m.h > 2)) {
          // Intersects, not fully-contains — a corner poking out of the box
          // still counts, which is the more forgiving/expected behavior.
          const hits = elements.filter((el) =>
            el.x < m.x + m.w && el.x + el.w > m.x && el.y < m.y + m.h && el.y + el.h > m.y
          );
          if (hits.length) setSelectedIds(new Set(hits.map((el) => el.id)));
        }
        return null;
      });
    }
  }, [pushHistory, elements]);

  // ── Touch: single finger mirrors mouse (draw/select/pan per active tool),
  // two fingers pinch-zoom + pan the canvas. Scoped to #ff_canvas only via
  // touch-action: none, so the rest of the app keeps native touch scrolling. ──
  const touchDistance = (t1, t2) => Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
  const touchMidpoint = (t1, t2) => ({ x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 });

  const onCanvasTouchStart = useCallback((e) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const [t1, t2] = e.touches;
      const mid = touchMidpoint(t1, t2);
      interactionRef.current = { mode: "pinch", lastDist: touchDistance(t1, t2), lastMidX: mid.x, lastMidY: mid.y };
      return;
    }
    if (e.touches.length === 1) {
      const t = e.touches[0];
      onCanvasMouseDown({ button: 0, clientX: t.clientX, clientY: t.clientY, stopPropagation: () => {}, preventDefault: () => {} });
    }
  }, [onCanvasMouseDown]);

  const onCanvasTouchMove = useCallback((e) => {
    const gesture = interactionRef.current;

    if (gesture?.mode === "pinch" && e.touches.length === 2) {
      e.preventDefault();
      const [t1, t2] = e.touches;
      const dist = touchDistance(t1, t2);
      const mid = touchMidpoint(t1, t2);
      const rect = canvasRef.current.getBoundingClientRect();
      const curLocalX = mid.x - rect.left;
      const curLocalY = mid.y - rect.top;
      const prevLocalX = gesture.lastMidX - rect.left;
      const prevLocalY = gesture.lastMidY - rect.top;

      setScale((prevScale) => {
        const newScale = clamp(prevScale * (dist / gesture.lastDist), MIN_SCALE, MAX_SCALE);
        setTx((prevTx) => curLocalX - ((prevLocalX - prevTx) / prevScale) * newScale);
        setTy((prevTy) => curLocalY - ((prevLocalY - prevTy) / prevScale) * newScale);
        return newScale;
      });

      gesture.lastDist = dist;
      gesture.lastMidX = mid.x;
      gesture.lastMidY = mid.y;
      return;
    }

    if (gesture && e.touches.length === 1) {
      const t = e.touches[0];
      onCanvasMouseMove({ clientX: t.clientX, clientY: t.clientY });
    }
  }, [onCanvasMouseMove]);

  const onCanvasTouchEnd = useCallback((e) => {
    if (e.touches.length < 2 && interactionRef.current?.mode === "pinch") {
      interactionRef.current = null;
    }
    if (e.touches.length === 0) onCanvasMouseUp();
  }, [onCanvasMouseUp]);

  const beginResize = useCallback((e, el) => {
    e.stopPropagation();
    setSelectedIds(new Set([el.id])); // resizing only ever applies to a single object, even if a group was selected
    const { x, y } = screenToWorld(e.clientX, e.clientY);
    interactionRef.current = {
      mode: "resize", id: el.id, startX: x, startY: y, elW: el.w, elH: el.h, snapshot: snapshotNow(), moved: false,
    };
  }, [screenToWorld, snapshotNow]);

  // ── Text editing ──
  const commitText = useCallback((id, value) => {
    const prevText = editSnapshotRef.current?.elements.find((el) => el.id === id)?.text || "";
    if (prevText !== value && editSnapshotRef.current) pushHistory(editSnapshotRef.current);
    setElements((els) => els.map((el) => (el.id === id ? { ...el, text: value } : el)));
    editSnapshotRef.current = null;
    setEditingId(null);
  }, [pushHistory]);

  // ── Delete / keyboard shortcuts ──
  const deleteSelected = useCallback(() => {
    if (!selectedIds.size) return;
    pushHistory(snapshotNow());
    setElements((els) => els.filter((el) => !selectedIds.has(el.id)));
    setSelectedIds(new Set());
  }, [selectedIds, pushHistory, snapshotNow]);

  const clearBoard = useCallback(() => {
    if (!elements.length && !strokes.length) return;
    if (!window.confirm("Clear the entire board? This can be undone.")) return;
    pushHistory(snapshotNow());
    setElements([]);
    setStrokes([]);
    setSelectedIds(new Set());
  }, [elements.length, strokes.length, pushHistory, snapshotNow]);

  const resetView = useCallback(() => { setTx(0); setTy(0); setScale(1); }, []);
  const zoomBy = useCallback((factor) => {
    setScale((s) => clamp(Math.round(s * factor * 100) / 100, MIN_SCALE, MAX_SCALE));
  }, []);

  useEffect(() => {
    const onKeyDown = (e) => {
      const tag = document.activeElement?.tagName;
      const typing = tag === "TEXTAREA" || tag === "INPUT" || document.activeElement?.isContentEditable;
      if (typing) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedIds.size) {
        e.preventDefault();
        deleteSelected();
        return;
      }
      const mapped = TOOL_KEYS[e.key.toLowerCase()];
      if (mapped) setTool(mapped);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo, selectedIds, deleteSelected]);

  const cursorForTool = tool === "pan" ? "grab" : tool === "select" ? "default" : "crosshair";

  if (loading || loadError) {
    return (
      <div id="ff_page" className="ff_page--status">
        <button id="ff_back" onClick={() => navigate("/freeform")} title="Back to Boards">
          <i className="fi fi-rr-arrow-left" />
        </button>
        <p id="ff_status_msg">{loadError ? `⚠ ${loadError}` : "Loading your board…"}</p>
      </div>
    );
  }

  return (
    <div id="ff_page">
      <div id="ff_header">
        <button id="ff_back" onClick={() => navigate("/freeform")} title="Back to Boards">
          <i className="fi fi-rr-arrow-left" />
        </button>
        <input
          id="ff_board_name"
          value={boardName}
          onChange={(e) => setBoardName(e.target.value)}
          onBlur={(e) => saveTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
          spellCheck={false}
        />
        {saveStatus && <span id="ff_save_status">{saveStatus === "saving" ? "Saving…" : saveStatus === "saved" ? "Saved" : "Save failed"}</span>}
        <div id="ff_header_actions">
          <button onClick={undo} disabled={!historyPast.length} title="Undo (Ctrl+Z)"><i className="fi fi-rr-undo" /></button>
          <button onClick={redo} disabled={!historyFuture.length} title="Redo (Ctrl+Shift+Z)"><i className="fi fi-rr-redo" /></button>
          <button onClick={deleteSelected} disabled={!selectedIds.size} title="Delete selected"><i className="fi fi-rr-trash" /></button>
          <button onClick={clearBoard} title="Clear board"><i className="fi fi-rr-eraser" /> Clear</button>
        </div>
      </div>

      <div
        id="ff_canvas"
        ref={canvasRef}
        style={{ cursor: cursorForTool }}
        onMouseDown={onCanvasMouseDown}
        onMouseMove={onCanvasMouseMove}
        onMouseUp={onCanvasMouseUp}
        onMouseLeave={onCanvasMouseUp}
        onTouchStart={onCanvasTouchStart}
        onTouchMove={onCanvasTouchMove}
        onTouchEnd={onCanvasTouchEnd}
        onTouchCancel={onCanvasTouchEnd}
      >
        <div
          id="ff_dot_grid"
          style={{
            backgroundSize: `${GRID_SIZE * scale}px ${GRID_SIZE * scale}px`,
            backgroundPosition: `${tx}px ${ty}px`,
          }}
        />

        <div id="ff_world" style={{ transform: `translate(${tx}px, ${ty}px) scale(${scale})` }}>
          <svg id="ff_strokes_layer">
            {strokes.map((s) => (
              <path key={s.id} d={strokeToPath(s.points)} stroke={s.color} strokeWidth={s.width} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            ))}
            {draftStroke && (
              <path d={strokeToPath(draftStroke.points)} stroke={draftStroke.color} strokeWidth={draftStroke.width} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            )}
          </svg>

          {elements.map((el) => {
            const isSelected = selectedIds.has(el.id);
            const showResizeHandle = isSelected && selectedIds.size === 1; // resizing a group isn't supported — only a lone selection gets a handle
            const isEditing = editingId === el.id;
            const commonStyle = { left: el.x, top: el.y, width: el.w, height: el.h };

            if (el.type === "rect" || el.type === "ellipse") {
              return (
                <div
                  key={el.id}
                  className={`ff_el ff_shape ${el.type === "ellipse" ? "ff_shape--ellipse" : ""} ${isSelected ? "ff_el--selected" : ""}`}
                  style={{ ...commonStyle, borderColor: el.color }}
                  onMouseDown={(e) => {
                    if (tool !== "select") return;
                    e.stopPropagation();
                    const { x, y } = screenToWorld(e.clientX, e.clientY);
                    beginDrag(el, x, y);
                  }}
                >
                  {showResizeHandle && <div className="ff_resize_handle" onMouseDown={(e) => beginResize(e, el)} />}
                </div>
              );
            }

            return (
              <div
                key={el.id}
                className={`ff_el ${el.type === "sticky" ? "ff_sticky" : "ff_text"} ${isSelected ? "ff_el--selected" : ""}`}
                style={{
                  ...commonStyle,
                  background: el.type === "sticky" ? `color-mix(in srgb, ${el.color} 22%, var(--color-surface))` : "transparent",
                  borderColor: el.type === "sticky" ? `color-mix(in srgb, ${el.color} 55%, var(--color-border))` : "transparent",
                  color: el.type === "text" ? el.color : "var(--color-text)",
                }}
                onMouseDown={(e) => {
                  if (tool !== "select") return;
                  e.stopPropagation();
                  const { x, y } = screenToWorld(e.clientX, e.clientY);
                  beginDrag(el, x, y);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setTool("select");
                  setSelectedIds(new Set([el.id]));
                  setEditingId(el.id);
                  editSnapshotRef.current = snapshotNow();
                }}
              >
                {isEditing ? (
                  <textarea
                    className="ff_el_editor"
                    autoFocus
                    defaultValue={el.text}
                    onFocus={(e) => e.target.select()}
                    onBlur={(e) => commitText(el.id, e.target.value)}
                    onMouseDown={(e) => e.stopPropagation()}
                  />
                ) : (
                  <div className="ff_el_text">{el.text || (el.type === "sticky" ? "Tap to write…" : "")}</div>
                )}
                {showResizeHandle && !isEditing && <div className="ff_resize_handle" onMouseDown={(e) => beginResize(e, el)} />}
              </div>
            );
          })}

          {draftShape && (
            <div
              className={`ff_el ff_shape ff_shape--draft ${draftShape.type === "ellipse" ? "ff_shape--ellipse" : ""}`}
              style={{ left: draftShape.x, top: draftShape.y, width: draftShape.w, height: draftShape.h, borderColor: draftShape.color }}
            />
          )}

          {draftMarquee && (
            <div
              id="ff_marquee"
              style={{ left: draftMarquee.x, top: draftMarquee.y, width: draftMarquee.w, height: draftMarquee.h }}
            />
          )}
        </div>
      </div>

      <div id="ff_toolbar">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={`ff_tool_btn ${tool === t.id ? "ff_tool_btn--active" : ""}`}
            title={t.title}
            onClick={() => setTool(t.id)}
          >
            <i className={`fi ${t.icon}`} />
          </button>
        ))}
      </div>

      {showPalette && (
        <div id="ff_style_panel">
          <div id="ff_color_row">
            {COLORS.map((c) => (
              <button
                key={c}
                className={`ff_color_swatch ${color === c ? "ff_color_swatch--active" : ""}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
                title={c}
              />
            ))}
          </div>
          {tool === "pen" && (
            <div id="ff_width_row">
              {STROKE_WIDTHS.map((w) => (
                <button
                  key={w}
                  className={`ff_width_btn ${strokeWidth === w ? "ff_width_btn--active" : ""}`}
                  onClick={() => setStrokeWidth(w)}
                  title={`${w}px`}
                >
                  <span style={{ width: w, height: w }} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {tool === "eraser" && (
        <div id="ff_eraser_panel">
          <div className="ff_eraser_group">
            <span className="ff_eraser_group_label">Erase</span>
            <div className="ff_eraser_option_row">
              {ERASE_TARGETS.map((t) => (
                <button
                  key={t.id}
                  className={`ff_eraser_option_btn ${eraseTarget === t.id ? "ff_eraser_option_btn--active" : ""}`}
                  onClick={() => setEraseTarget(t.id)}
                  title={t.label}
                >
                  <i className={`fi ${t.icon}`} />
                  <span>{t.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="ff_eraser_group">
            <span className="ff_eraser_group_label">Mode</span>
            <div className="ff_eraser_option_row">
              {ERASE_MODES.map((m) => (
                <button
                  key={m.id}
                  className={`ff_eraser_option_btn ${eraseMode === m.id ? "ff_eraser_option_btn--active" : ""}`}
                  onClick={() => setEraseMode(m.id)}
                  title={m.hint}
                >
                  <i className={`fi ${m.icon}`} />
                  <span>{m.label}</span>
                </button>
              ))}
            </div>
          </div>

          {eraseMode === "precision" && (
            <div className="ff_eraser_group">
              <span className="ff_eraser_group_label">Brush size</span>
              <div id="ff_width_row">
                {ERASE_RADII.map((r) => (
                  <button
                    key={r}
                    className={`ff_width_btn ${eraseRadius === r ? "ff_width_btn--active" : ""}`}
                    onClick={() => setEraseRadius(r)}
                    title={`${r}px`}
                  >
                    <span style={{ width: r * 0.7, height: r * 0.7 }} />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div id="ff_zoom_controls">
        <button onClick={() => zoomBy(1 / 1.2)} title="Zoom out"><i className="fi fi-rr-minus" /></button>
        <button id="ff_zoom_label" onClick={resetView} title="Reset view">{Math.round(scale * 100)}%</button>
        <button onClick={() => zoomBy(1.2)} title="Zoom in"><i className="fi fi-rr-plus" /></button>
        <button onClick={resetView} title="Fit to view"><i className="fi fi-rr-expand" /></button>
      </div>
    </div>
  );
};

export default FreeformPage;
