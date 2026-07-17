import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import "./threadPyramidLogo.css";

// ── Rebuild, from scratch ────────────────────────────────────────────────
// The ground is ONE thread, not many. It covers the field by going back
// and forth — runs a stretch, turns, runs back the other way one row
// over, turns again, and so on — a single unbroken, continuous path the
// whole time. Every one of those internal turns is close enough to see —
// that's the whole point, it's what actually shows this is one thread
// weaving back and forth rather than a field of separate parallel ones.
// Only the very first and very last row keep going instead of turning —
// see the free-end bends further down, where those two true open ends
// (per floor) bend vertically instead of receding into the horizontal
// distance. Flat otherwise, nothing else rises out of it — just the
// ground threads themselves.

const GROUND_Y = 0;
const ROW_COUNT = 40; // how many back-and-forth passes the one thread makes
const FIELD_HALF_WIDTH = 1000; // lateral spread, perpendicular to the shared direction — wider field, same row count, so rows sit further apart
const INNER_HALF_LENGTH = 320; // how far each INTERNAL turn sits from center — close enough to actually see the weave, now covering more ground along each row's own run
const THREAD_RADIUS = 1.4; // thick enough that a whole floor reads as a solid, prominent band rather than a fine wire

// One fixed direction the thread runs along on each pass.
const AXIS_ANGLE = 0.35; // radians — arbitrary, just fixed
const AXIS = new THREE.Vector3(Math.cos(AXIS_ANGLE), 0, Math.sin(AXIS_ANGLE));
const PERP = new THREE.Vector3(-AXIS.z, 0, AXIS.x); // perpendicular — the direction consecutive passes step across

const point = (along, lateral) =>
  new THREE.Vector3(0, GROUND_Y, 0).addScaledVector(AXIS, along).addScaledVector(PERP, lateral);

const ROW_STEP = ROW_COUNT > 1 ? (FIELD_HALF_WIDTH * 2) / (ROW_COUNT - 1) : 0;
const lateralForRow = (r) => -FIELD_HALF_WIDTH + r * ROW_STEP;

// One floor per level of App.js's own scroll (LEVELS): Hyle, Atoms,
// Molecules, Cells, Tissues, Organs, Organ Systems, Humans, Societies —
// nine identical copies of the same weave, stacked directly above one
// another like floors of a building — each one its own complete, separate
// thread (not one thread climbing between floors), spaced evenly apart
// vertically.
const FLOOR_COUNT = 9;
const FLOOR_SPACING = 200;
// Which floor is Atoms and which is Molecules, matching App.js's own
// LEVELS order (Hyle=0 first) — the cargo below rides on these two floors
// specifically.
const ATOMIC_FLOOR_INDEX = 1;
const MOLECULAR_FLOOR_INDEX = 2;

// Every floor's own thread has two true open ends — row 0's own start (the
// PROXIMAL one, closest to where the whole thread's own path structurally
// begins) and the last row's own end (the DISTAL one). Rather than every
// floor's own pair receding flat into the horizontal distance, each end
// bends vertically — a quarter-turn (sin/cos easing, so the tangent is
// purely horizontal at the join, purely vertical at the tip) from the same
// INNER_HALF_LENGTH join every ordinary internal turn already uses — and
// alternates direction floor to floor:
//   floor 0: proximal down, distal up
//   floor 1: proximal up,   distal down
//   floor 2: proximal down, distal up
//   ...and so on, even floors matching floor 0, odd floors matching floor 1.
// Two neighboring floors' facing ends (floor 0's distal-up meeting floor
// 1's distal-down; floor 1's proximal-up meeting floor 2's proximal-down;
// and so on) bend the identical horizontal distance and exactly half of
// FLOOR_SPACING vertically each, so their tips land on the exact same
// point in space — blending into one continuous connector rather than two
// separate stubs. Only the two ends with nothing to meet stay true open
// ends, hanging past the whole stack instead: whichever end (proximal or
// distal — which one it is depends on FLOOR_COUNT's own parity) points
// down at floor 0, and whichever end points up at the very last floor.
const FREE_END_BEND_ALONG = -INNER_HALF_LENGTH; // where every bend starts
const FREE_END_BEND_RUN = 140; // horizontal distance every bend covers
const FREE_END_BEND_SAMPLES = 20;
const HALF_FLOOR_SPACING = FLOOR_SPACING / 2; // internal floor-to-floor bends each cover exactly this much, so they meet in the middle
const OPEN_FREE_END_DROP = 260; // the stack's own two true open ends (bottom of floor 0, top of the last floor) hang this far past it
// sign: +1 (bends up) is only ever open at the very last floor (nothing
// above it); -1 (bends down) is only ever open at floor 0 (nothing below
// it) — true regardless of FLOOR_COUNT's own parity, unlike a hardcoded
// "floor 0 or last floor" check on one specific end alone would be.
const isOpenFreeEnd = (sign, floorIndex) =>
  (sign === -1 && floorIndex === 0) || (sign === 1 && floorIndex === FLOOR_COUNT - 1);

// Evenly-lit identical floors are hard to tell apart from a distance —
// each one now gets its own hue (evenly spread around the color wheel, so
// no two floors are ever confusable) and a much brighter glow than the
// single shared thread color this used to be, so a floor reads clearly the
// instant it's visible.
const FLOOR_GLOW_EMISSIVE_INTENSITY = 1.0;
const colorForFloor = (floorIndex) => new THREE.Color().setHSL(floorIndex / FLOOR_COUNT, 0.85, 0.6);

const buildGroundThread = () => {
  const group = new THREE.Group();

  const buildFloor = (floorIndex) => {
    const floor = new THREE.Group();
    const floorColor = colorForFloor(floorIndex);
    const threadMaterial = new THREE.MeshStandardMaterial({
      color: floorColor,
      emissive: floorColor,
      emissiveIntensity: FLOOR_GLOW_EMISSIVE_INTENSITY,
      roughness: 0.5,
      metalness: 0.05,
    });
    const addTube = (points, segments) => {
      const curve = new THREE.CatmullRomCurve3(points);
      const geometry = new THREE.TubeGeometry(curve, segments, THREAD_RADIUS, 10, false); // more radial segments than before — THREAD_RADIUS is thick enough now that a hexagonal cross-section would show
      floor.add(new THREE.Mesh(geometry, threadMaterial));
    };

    // sign: +1 bends up, -1 bends down. drop: how far, in local (this
    // floor's own) coordinates — HALF_FLOOR_SPACING for an internal bend
    // that meets its neighbor exactly halfway, OPEN_FREE_END_DROP for a
    // true open end with no neighbor to meet.
    const addFreeEndBend = (lateral, sign, drop) => {
      const bendPoints = [];
      for (let s = 0; s <= FREE_END_BEND_SAMPLES; s++) {
        const u = s / FREE_END_BEND_SAMPLES;
        const alongOffset = -FREE_END_BEND_RUN * Math.sin((u * Math.PI) / 2);
        const rise = sign * drop * (1 - Math.cos((u * Math.PI) / 2));
        bendPoints.push(
          new THREE.Vector3(0, rise, 0)
            .addScaledVector(AXIS, FREE_END_BEND_ALONG + alongOffset)
            .addScaledVector(PERP, lateral)
        );
      }
      addTube(bendPoints, FREE_END_BEND_SAMPLES);
    };

    const isEven = floorIndex % 2 === 0;
    const proximalSign = isEven ? -1 : 1;
    const distalSign = isEven ? 1 : -1;
    const proximalDrop = isOpenFreeEnd(proximalSign, floorIndex) ? OPEN_FREE_END_DROP : HALF_FLOOR_SPACING;
    const distalDrop = isOpenFreeEnd(distalSign, floorIndex) ? OPEN_FREE_END_DROP : HALF_FLOOR_SPACING;

    for (let r = 0; r < ROW_COUNT; r++) {
      const lateral = lateralForRow(r);
      const forward = r % 2 === 0; // alternating direction each pass — what makes it one continuous back-and-forth thread
      const startAlong = forward ? -INNER_HALF_LENGTH : INNER_HALF_LENGTH;
      const endAlong = forward ? INNER_HALF_LENGTH : -INNER_HALF_LENGTH;

      if (r === 0) {
        addFreeEndBend(lateral, proximalSign, proximalDrop);
        addTube([point(FREE_END_BEND_ALONG, lateral), point(endAlong, lateral)], 2);
      } else if (r === ROW_COUNT - 1) {
        addTube([point(startAlong, lateral), point(FREE_END_BEND_ALONG, lateral)], 2);
        addFreeEndBend(lateral, distalSign, distalDrop);
      } else {
        addTube([point(startAlong, lateral), point(endAlong, lateral)], 2);
      }

      // The turn — a short connector from the end of this pass to the start
      // of the next, at the next row's lateral position. Still the same one
      // continuous thread, just changing rows.
      if (r < ROW_COUNT - 1) {
        const nextLateral = lateralForRow(r + 1);
        addTube([point(endAlong, lateral), point(endAlong, nextLateral)], 2);
      }
    }

    return floor;
  };

  const floorGroups = []; // indexed by floor — read by the component to show only the active level's own floor
  for (let f = 0; f < FLOOR_COUNT; f++) {
    const floor = buildFloor(f);
    floor.position.y = f * FLOOR_SPACING;
    group.add(floor);
    floorGroups.push(floor);
  }

  return { group, floorGroups };
};

const disposeGroundThread = (group) => {
  group.traverse((obj) => {
    if (obj.isMesh) {
      obj.geometry.dispose();
      obj.material.dispose();
    }
  });
};

// Element symbol, drawn onto a small canvas and used as a sprite texture —
// sprites always face the camera, so a label stays legible from any angle
// without tracking the camera by hand. Canvas is wide (2:1) with an
// auto-shrinking font so longer formulas ("Fe²⁺/Fe³⁺", "C₆H₁₂O₆") still
// fit without the font going illegibly small for short ones ("O₂").
const LABEL_CANVAS_SIZE = 128;
const createLabelSprite = (text, worldSize) => {
  const canvas = document.createElement("canvas");
  canvas.width = LABEL_CANVAS_SIZE * 2;
  canvas.height = LABEL_CANVAS_SIZE;
  const ctx = canvas.getContext("2d");
  const fontStack = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  let fontSize = 64;
  ctx.font = `700 ${fontSize}px ${fontStack}`;
  const maxTextWidth = canvas.width * 0.9;
  const measuredWidth = ctx.measureText(text).width;
  if (measuredWidth > maxTextWidth) {
    fontSize = Math.max(22, Math.floor(fontSize * (maxTextWidth / measuredWidth)));
    ctx.font = `700 ${fontSize}px ${fontStack}`;
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff8ec";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 4);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(worldSize * 2, worldSize, 1); // matches the canvas's own 2:1 aspect ratio
  return sprite;
};

// ── Cargo — the essential ions (Atoms floor) and essential molecules
// (Molecules floor) that exist without any cellular process, each one
// driving back and forth along its own row of that floor's own thread —
// never rising, never leaving that floor's own flat plane, trapped in 2D
// the way the thread itself is.
const ATOMIC_CARGO = ["K⁺", "Na⁺", "Ca²⁺", "Mg²⁺", "Cl⁻", "H⁺", "Fe²⁺/Fe³⁺", "Zn²⁺"];
const MOLECULAR_CARGO = ["H₂O", "O₂", "CO₂", "C₆H₁₂O₆", "NH₃", "H₂O₂", "HCO₃⁻", "PO₄³⁻"];

// A plain small sphere in a near-white color read poorly — against a
// bright, glowing, differently-colored floor every few rows, there's no
// single cargo color that ever contrasts reliably. Two fixes together: a
// faceted gem shape (an icosahedron, flat-shaded, so each face catches the
// light differently — reads as a distinct 3D object even at a glance,
// unlike a smooth sphere) instead of a plain ball, plus a thin dark
// outline shell (a slightly larger copy of the same geometry, rendered
// back-face-only in near-black) that silhouettes the cargo against
// whatever color happens to be behind it — a value/contrast fix, not a
// hue one, so it works regardless of which floor's own color it's on.
const CARGO_RADIUS = 4.5;
const CARGO_COLOR = "#fff8ec";
const CARGO_EMISSIVE_INTENSITY = 1.3;
const CARGO_OUTLINE_COLOR = "#05070d";
const CARGO_OUTLINE_SCALE = 1.28;
const CARGO_CLEARANCE = CARGO_RADIUS * CARGO_OUTLINE_SCALE + 2; // lifts the cargo just clear of the thread's own surface, not clipping through it
const CARGO_LABEL_WORLD_SIZE = 14;
const CARGO_LABEL_CLEARANCE = 8;
// Each item drives back and forth along its own row, staying within the
// visible weave span (away from the free-end bends either side) — a
// simple there-and-back "drive," not a full traversal of the whole
// back-and-forth thread.
const CARGO_TRAVEL_HALF_SPAN = INNER_HALF_LENGTH;
const CARGO_SPEED = 45; // world units per second
const CARGO_PERIOD = (CARGO_TRAVEL_HALF_SPAN * 4) / CARGO_SPEED; // seconds for one full there-and-back cycle

const buildCargo = () => {
  const group = new THREE.Group();
  const items = []; // { mesh, lateral, offset } — read every frame by updateCargo below

  const cargoMaterial = new THREE.MeshStandardMaterial({
    color: CARGO_COLOR,
    emissive: new THREE.Color(CARGO_COLOR),
    emissiveIntensity: CARGO_EMISSIVE_INTENSITY,
    roughness: 0.35,
    metalness: 0.15,
    flatShading: true, // facets catch the light unevenly, so the gem shape reads as 3D even from a distance
  });
  const cargoGeometry = new THREE.IcosahedronGeometry(CARGO_RADIUS, 0); // detail 0 = the plain 20-face icosahedron, not a smoothed sphere
  const outlineMaterial = new THREE.MeshBasicMaterial({ color: CARGO_OUTLINE_COLOR, side: THREE.BackSide });
  const outlineGeometry = new THREE.IcosahedronGeometry(CARGO_RADIUS * CARGO_OUTLINE_SCALE, 0);

  const floorGroups = {}; // floorIndex -> its own cargo group, for the floors that have cargo — read by the component to show only the active level's own floor

  const addCargoForFloor = (floorIndex, labels) => {
    const floorGroup = new THREE.Group();
    floorGroup.position.y = floorIndex * FLOOR_SPACING;
    group.add(floorGroup);
    floorGroups[floorIndex] = floorGroup;

    labels.forEach((label, i) => {
      // Spread across the rows between the two free-end bends (row 0 and
      // the last row), evenly, so cargo doesn't cluster near either end.
      const r = 1 + Math.round(((i + 0.5) * (ROW_COUNT - 2)) / labels.length);
      const lateral = lateralForRow(r);

      const itemGroup = new THREE.Group();
      itemGroup.add(new THREE.Mesh(outlineGeometry, outlineMaterial)); // rendered first, back faces only, so it silhouettes the gem inside it
      itemGroup.add(new THREE.Mesh(cargoGeometry, cargoMaterial));
      const sprite = createLabelSprite(label, CARGO_LABEL_WORLD_SIZE);
      sprite.position.y = CARGO_RADIUS * CARGO_OUTLINE_SCALE + CARGO_LABEL_CLEARANCE;
      itemGroup.add(sprite);
      floorGroup.add(itemGroup);

      items.push({ mesh: itemGroup, lateral, offset: i / labels.length });
    });
  };

  addCargoForFloor(ATOMIC_FLOOR_INDEX, ATOMIC_CARGO);
  addCargoForFloor(MOLECULAR_FLOOR_INDEX, MOLECULAR_CARGO);

  return { group, items, floorGroups };
};

// Called every animation frame — moves each cargo item along its own row
// via a constant-speed triangle wave (drive out, drive back), staggered by
// its own offset so a floor's items don't all move in lockstep.
const updateCargo = (items, elapsedSeconds) => {
  for (const item of items) {
    const cyclePhase = (elapsedSeconds / CARGO_PERIOD + item.offset) % 1;
    const t = cyclePhase < 0.5 ? cyclePhase * 2 : 2 - cyclePhase * 2; // 0 -> 1 -> 0
    const along = -CARGO_TRAVEL_HALF_SPAN + t * (CARGO_TRAVEL_HALF_SPAN * 2);
    item.mesh.position.copy(point(along, item.lateral));
    item.mesh.position.y += CARGO_CLEARANCE;
  }
};

// Sprite.geometry is a single plane geometry three.js shares across every
// Sprite in the whole app (a module-level singleton) — only dispose it for
// real meshes (each with their own geometry), or disposing a cargo item
// would free GPU buffers every other sprite elsewhere still depends on.
const disposeCargo = (group) => {
  group.traverse((obj) => {
    if (obj.isMesh) obj.geometry.dispose();
    if (obj.isSprite) obj.material.map?.dispose();
    if (obj.material) obj.material.dispose();
  });
};

// Manually-tuned camera shots, one per level (keyed by index into App.js's
// LEVELS), saved from the floating control panel below — the alternative to
// guessing framing values with no way to actually see the result. Persisted
// in localStorage so a tuning session survives a reload.
const CAMERA_PRESETS_STORAGE_KEY = "mctoshs_thread_camera_presets";
const loadCameraPresets = () => {
  try {
    const raw = localStorage.getItem(CAMERA_PRESETS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};
const saveCameraPresetsToStorage = (presets) => {
  try {
    localStorage.setItem(CAMERA_PRESETS_STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // Private browsing / storage full / disabled — the preset still applies
    // for the rest of this session via React state, it just won't survive
    // a reload.
  }
};

// No more built-in per-level default framing — every level's shot comes
// from a saved preset (the control panel below) or it doesn't move at all.
// This is just where the camera sits before any level has one saved yet:
// pulled back generously (the ground field is wide and dense —
// FIELD_HALF_WIDTH=1000, rows spaced ~51 apart, each running 320 deep) and
// centered on the middle of the whole floor stack vertically, so it starts
// clear of the field rather than up against or inside it.
const INITIAL_CAMERA_FOCUS = new THREE.Vector3(0, ((FLOOR_COUNT - 1) * FLOOR_SPACING) / 2, 0);
const INITIAL_CAMERA_DISTANCE = 1400;

// How long a level-to-level camera transition takes, and its easing curve
// (slow-in, fast-through-the-middle, slow-out) — a plain cubic ease, not a
// linear lerp, so the motion reads as a deliberate camera move rather than
// a robotic slide.
const CAMERA_TRANSITION_MS = 1200;
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const ThreadPyramidLogo = ({ activeLevel = 0, levelLabels = [] }) => {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);
  const groundThreadRef = useRef(null);
  const cargoItemsRef = useRef([]); // read fresh every animation frame by the mount effect's own animate() loop below
  const floorVisibilityGroupsRef = useRef({}); // floorIndex -> [groups] — every ground/cargo group that floor owns, toggled by the activeLevel effect below
  const [cameraPresets, setCameraPresets] = useState(loadCameraPresets);
  const [presetPanelOpen, setPresetPanelOpen] = useState(false);

  const saveCurrentViewAsPreset = (levelIndex) => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const preset = {
      position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
      target: { x: controls.target.x, y: controls.target.y, z: controls.target.z },
    };
    setCameraPresets((prev) => {
      const next = { ...prev, [levelIndex]: preset };
      saveCameraPresetsToStorage(next);
      return next;
    });
  };

  const clearPresetForLevel = (levelIndex) => {
    setCameraPresets((prev) => {
      if (!(levelIndex in prev)) return prev;
      const next = { ...prev };
      delete next[levelIndex];
      saveCameraPresetsToStorage(next);
      return next;
    });
  };

  // Mount-only: renderer, camera, lights, controls — everything that
  // doesn't need to change as the user scrolls. Kept separate from the
  // ground-thread build below so scrolling never tears down and recreates
  // the renderer/controls, just the geometry.
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    // Defensive: guards against a stale canvas from a previous mount that
    // didn't get torn down (seen under Vite HMR for this file).
    while (mount.firstChild) mount.removeChild(mount.firstChild);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    sceneRef.current = scene;
    // far=4000 used to clip the object once zoomed far enough out — the
    // floor stack's own extent (FLOOR_SPACING * (FLOOR_COUNT-1) vertically,
    // plus each floor's own free-end bends and the field's own width/depth)
    // plus how far out a user can actually zoom (see controls.maxDistance
    // below) both need real headroom under this so nothing at the object's
    // own far side is ever clipped away.
    const camera = new THREE.PerspectiveCamera(45, mount.clientWidth / mount.clientHeight, 1, 20000);
    cameraRef.current = camera;

    // Starting shot before any preset is loaded/applies — see
    // INITIAL_CAMERA_FOCUS/DISTANCE above.
    const focus = INITIAL_CAMERA_FOCUS.clone();
    const direction = new THREE.Vector3(120, 340, 520).sub(new THREE.Vector3(0, 40, 0)).normalize();
    camera.position.copy(focus).addScaledVector(direction, INITIAL_CAMERA_DISTANCE);
    camera.lookAt(focus);

    // Ambient only, plus one soft directional light. No point lights with a
    // finite falloff distance (those create a literal lit/unlit circle
    // wherever their falloff sphere meets the ground) — a directional light
    // has no falloff distance at all, so it's safe from that bug.
    scene.add(new THREE.AmbientLight(0x9aa0c0, 0.35));
    const nodeLight = new THREE.DirectionalLight(0xfff3e0, 0.55);
    nodeLight.position.set(150, 420, 260);
    scene.add(nodeLight);

    // Left-click-drag rotates with a mouse; on touch, one-finger drag is
    // deliberately left unmapped (touches.ONE below) so it falls straight
    // through to the page's own native scroll instead of rotating the
    // camera — climbing the levels on a touchscreen is a plain one-finger
    // swipe, no separate scrollbar needed. Two-finger touch rotates, pinch
    // zooms (OrbitControls' own TOUCH.DOLLY_ROTATE reads both from the
    // same two-finger gesture: fingers moving together rotates the view,
    // fingers spreading/closing zooms). Two-finger PAN on a trackpad needs
    // its own handling below instead: a trackpad reports that gesture as a
    // plain wheel event, which OrbitControls always treats as zoom, with
    // no built-in way to tell a two-finger swipe apart from an actual
    // pinch through its public API.
    const controls = new OrbitControls(camera, renderer.domElement);
    controlsRef.current = controls;
    controls.target.copy(focus);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enableZoom = true;
    // Capped well short of the camera's own far plane (20000, see above) so
    // zooming out can never push part of the object past it and clip —
    // still generous enough to pull back and see the whole 8-floor stack
    // at once with plenty of room to spare.
    controls.maxDistance = 8000;
    controls.enablePan = true; // right-click-drag pans with a mouse; see controls.touches below for the touch equivalent
    controls.touches = {
      ONE: undefined, // freed for native page scroll rather than camera rotate
      TWO: THREE.TOUCH.DOLLY_ROTATE, // two-finger drag rotates, pinch zooms
    };
    // OrbitControls' own constructor sets touch-action:none on this element
    // unconditionally (to fully own touch itself), regardless of what
    // touches.ONE is mapped to — that CSS blocks the browser's native touch
    // handling before any JS (including the ONE:undefined above) ever gets
    // a say, which is exactly what was stopping one-finger scroll. pan-y
    // fixes that for one finger, but touch-action's pan-y doesn't actually
    // distinguish finger count on its own — left as a static value, a
    // two-finger drag can still get read as a native scroll too, which is
    // exactly the bug: two-finger touch must be OrbitControls' rotate,
    // never the page's scroll. So touch-action is flipped live by finger
    // count instead of left static: pan-y with one finger down (or none),
    // none the instant a second finger joins — switched back the moment
    // it's no longer a 2+-finger touch. The touchmove preventDefault below
    // is a second, redundant guard for the same 2+-finger case, since
    // touch-action is technically a hint the browser can already have
    // committed to before a same-tick style change takes effect.
    const updateTouchAction = (event) => {
      renderer.domElement.style.touchAction = event.touches.length >= 2 ? "none" : "pan-y";
    };
    renderer.domElement.style.touchAction = "pan-y";
    renderer.domElement.addEventListener("touchstart", updateTouchAction, { passive: true });
    renderer.domElement.addEventListener("touchend", updateTouchAction, { passive: true });
    renderer.domElement.addEventListener("touchcancel", updateTouchAction, { passive: true });
    const preventMultiTouchScroll = (event) => {
      if (event.touches.length >= 2) event.preventDefault();
    };
    renderer.domElement.addEventListener("touchmove", preventMultiTouchScroll, { passive: false });

    const panRight = new THREE.Vector3();
    const panUp = new THREE.Vector3();
    const panOffset = new THREE.Vector3();

    // Three-finger drag moves the object itself — vertical finger movement
    // changes the camera's own height (world Y), horizontal finger
    // movement shifts it sideways (along the camera's own horizontal right
    // vector, so "drag right" always means right on screen regardless of
    // which way the camera's currently facing) — camera and target move
    // together on both axes, a pure translation rather than an orbit.
    // OrbitControls' own touches config only recognizes ONE/TWO finger
    // gestures, so three fingers is handled by hand here: OrbitControls is
    // switched off for as long as a third finger stays down (it has no
    // gesture of its own for that count anyway, and would otherwise fight
    // over the other two touch points) and switched back on the moment it
    // drops back below 3.
    const MOVE_PER_PIXEL = 0.6;
    let moveDragStart = null; // { x, y } in screen space
    const averageTouchClient = (touches) => {
      let x = 0, y = 0;
      for (let i = 0; i < touches.length; i++) { x += touches[i].clientX; y += touches[i].clientY; }
      return { x: x / touches.length, y: y / touches.length };
    };
    const onThreeFingerTouchStart = (event) => {
      if (event.touches.length === 3) {
        controls.enabled = false;
        moveDragStart = averageTouchClient(event.touches);
      }
    };
    const onThreeFingerTouchMove = (event) => {
      if (event.touches.length !== 3 || moveDragStart === null) return;
      event.preventDefault();
      const current = averageTouchClient(event.touches);
      const heightDelta = (moveDragStart.y - current.y) * MOVE_PER_PIXEL; // fingers dragging up raises the camera
      const rightDelta = (current.x - moveDragStart.x) * MOVE_PER_PIXEL; // fingers dragging right moves it right

      panRight.setFromMatrixColumn(camera.matrix, 0);
      panOffset.copy(panRight).multiplyScalar(rightDelta);
      panOffset.y += heightDelta;
      camera.position.add(panOffset);
      controls.target.add(panOffset);

      moveDragStart = current;
    };
    const onThreeFingerTouchEnd = (event) => {
      if (event.touches.length < 3) {
        controls.enabled = true;
        moveDragStart = null;
      }
    };
    renderer.domElement.addEventListener("touchstart", onThreeFingerTouchStart, { passive: true });
    renderer.domElement.addEventListener("touchmove", onThreeFingerTouchMove, { passive: false });
    renderer.domElement.addEventListener("touchend", onThreeFingerTouchEnd, { passive: true });
    renderer.domElement.addEventListener("touchcancel", onThreeFingerTouchEnd, { passive: true });

    const onWheel = (event) => {
      event.preventDefault();
      event.stopPropagation();

      const distance = camera.position.distanceTo(controls.target);

      if (event.ctrlKey) {
        // Browsers report an actual trackpad pinch as a wheel event with
        // ctrlKey set — treat that as zoom, not pan.
        const zoomed = distance * Math.pow(0.98, -event.deltaY);
        const clamped = Math.min(controls.maxDistance, Math.max(controls.minDistance, zoomed));
        camera.position.sub(controls.target).setLength(clamped).add(controls.target);
        return;
      }

      const panScale = distance * 0.0016;
      panRight.setFromMatrixColumn(camera.matrix, 0);
      panUp.setFromMatrixColumn(camera.matrix, 1);
      panOffset
        .copy(panRight).multiplyScalar(-event.deltaX * panScale)
        .addScaledVector(panUp, event.deltaY * panScale);

      camera.position.add(panOffset);
      controls.target.add(panOffset);
    };
    mount.addEventListener("wheel", onWheel, { passive: false, capture: true });

    let raf;
    const cargoStartTime = performance.now();
    const animate = () => {
      raf = requestAnimationFrame(animate);
      updateCargo(cargoItemsRef.current, (performance.now() - cargoStartTime) / 1000);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const ro = new ResizeObserver(() => {
      const w = mount.clientWidth, h = mount.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    ro.observe(mount);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mount.removeEventListener("wheel", onWheel, { capture: true });
      renderer.domElement.removeEventListener("touchstart", updateTouchAction);
      renderer.domElement.removeEventListener("touchend", updateTouchAction);
      renderer.domElement.removeEventListener("touchcancel", updateTouchAction);
      renderer.domElement.removeEventListener("touchmove", preventMultiTouchScroll);
      renderer.domElement.removeEventListener("touchstart", onThreeFingerTouchStart);
      renderer.domElement.removeEventListener("touchmove", onThreeFingerTouchMove);
      renderer.domElement.removeEventListener("touchend", onThreeFingerTouchEnd);
      renderer.domElement.removeEventListener("touchcancel", onThreeFingerTouchEnd);
      controls.dispose();
      renderer.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
      sceneRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
    };
  }, []);

  // Builds the ground-thread group once, on mount — it's flat and static,
  // nothing about it depends on scroll progress anymore, so there's no
  // reason to rebuild it on every scroll tick the way the old atom/molecule
  // geometry once needed to.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    const { group: groundThread, floorGroups } = buildGroundThread();
    scene.add(groundThread);
    groundThreadRef.current = groundThread;

    const visibilityGroups = floorVisibilityGroupsRef.current;
    floorGroups.forEach((floorGroup, floorIndex) => {
      if (!visibilityGroups[floorIndex]) visibilityGroups[floorIndex] = [];
      visibilityGroups[floorIndex].push(floorGroup);
    });

    return () => {
      scene.remove(groundThread);
      disposeGroundThread(groundThread);
      groundThreadRef.current = null;
    };
  }, []);

  // Builds the cargo group once, on mount too — the items themselves move
  // every frame (see the mount effect's own animate() loop above, which
  // reads cargoItemsRef.current fresh each tick), but the meshes/sprites
  // that represent them are created just this once.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    const { group: cargoGroup, items, floorGroups } = buildCargo();
    scene.add(cargoGroup);
    cargoItemsRef.current = items;

    const visibilityGroups = floorVisibilityGroupsRef.current;
    Object.entries(floorGroups).forEach(([floorIndex, floorGroup]) => {
      const idx = Number(floorIndex);
      if (!visibilityGroups[idx]) visibilityGroups[idx] = [];
      visibilityGroups[idx].push(floorGroup);
    });

    return () => {
      scene.remove(cargoGroup);
      disposeCargo(cargoGroup);
      cargoItemsRef.current = [];
    };
  }, []);

  // Shows only the active level's own floor — every other floor's ground
  // thread (and cargo, on the floors that have any) hidden rather than
  // removed/rebuilt, so switching back to a previous level is instant.
  useEffect(() => {
    Object.entries(floorVisibilityGroupsRef.current).forEach(([floorIndex, groups]) => {
      const visible = Number(floorIndex) === activeLevel;
      groups.forEach((g) => { g.visible = visible; });
    });
  }, [activeLevel]);

  // Frames the camera for whichever level is currently active — no built-in
  // default framing anymore, only a saved preset (the control panel below)
  // ever moves the camera, and it eases there over CAMERA_TRANSITION_MS
  // rather than snapping instantly, so a level change reads as a deliberate
  // camera move. With no preset saved yet, the camera simply stays wherever
  // it already was — the previous level's own shot (or wherever it's been
  // manually left) — rather than jumping to any guessed framing. Scrolling
  // to a NEW level again before a transition finishes cancels the in-flight
  // one via this effect's own cleanup and starts the next straight from
  // wherever the camera actually is at that moment — interruptible, not
  // queued.
  useEffect(() => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;

    const preset = cameraPresets[activeLevel];
    if (!preset) return;

    const startPosition = camera.position.clone();
    const startTarget = controls.target.clone();
    const endPosition = new THREE.Vector3(preset.position.x, preset.position.y, preset.position.z);
    const endTarget = new THREE.Vector3(preset.target.x, preset.target.y, preset.target.z);
    const startTime = performance.now();
    let frame;

    const step = (now) => {
      const t = Math.min(1, (now - startTime) / CAMERA_TRANSITION_MS);
      const eased = easeInOutCubic(t);
      camera.position.lerpVectors(startPosition, endPosition, eased);
      controls.target.lerpVectors(startTarget, endTarget, eased);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);

    return () => cancelAnimationFrame(frame);
  }, [activeLevel, cameraPresets]);

  return (
    <>
      <div ref={mountRef} id="thread_logo_canvas" />
      <div id="camera_preset_panel" className={presetPanelOpen ? "camera_preset_panel--open" : ""}>
        <button
          id="camera_preset_panel_toggle"
          onClick={() => setPresetPanelOpen((open) => !open)}
        >
          {presetPanelOpen ? "Hide camera panel" : "Camera panel"}
        </button>
        {presetPanelOpen && (
          <div id="camera_preset_panel_body">
            <p id="camera_preset_panel_hint">
              Scroll to a level, drag/pinch to the shot you want, then save it.
            </p>
            {levelLabels.map((label, i) => (
              <div
                key={label}
                className={`camera_preset_row${i === activeLevel ? " camera_preset_row--active" : ""}`}
              >
                <span className="camera_preset_row_label">
                  {label}
                  {cameraPresets[i] && <span className="camera_preset_row_dot" title="Custom shot saved" />}
                </span>
                <div className="camera_preset_row_actions">
                  <button
                    disabled={i !== activeLevel}
                    onClick={() => saveCurrentViewAsPreset(i)}
                    title={i === activeLevel ? "Save the current view for this level" : "Scroll to this level first"}
                  >
                    Save current view
                  </button>
                  {cameraPresets[i] && (
                    <button onClick={() => clearPresetForLevel(i)} title="Remove the saved shot">
                      Clear
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
};

export default ThreadPyramidLogo;
