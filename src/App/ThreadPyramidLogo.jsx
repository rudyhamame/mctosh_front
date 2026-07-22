import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import "./threadPyramidLogo.css";

// ── Rebuild, from scratch ────────────────────────────────────────────────
// Each STRUCTURED floor (Atoms through Societies — see FLOOR_COUNT below)
// is ONE thread, not many — a single unbroken, continuous path the whole
// time. It's a coil: the same kind of deterministic expanding spiral the
// Hyle floor already uses (see buildHyleThreadPoints/buildStructuredCoilPoints
// below), not a flat back-and-forth weave. Each floor's own thread LENGTH
// shrinks going up the stack (floorLengthScaleFor below — Atoms/floor 1 is
// longest, Societies/the last floor shortest), and since a coil's radius is
// derived directly from how much length it has to contain (the same
// footprint-area relationship Hyle's own radius uses), the radius shrinks
// right along with it — the whole structured stack reads as a narrowing
// cone of coils, not a rack of identical flat rings.
//
// The Hyle floor (floor 0, see buildHyleFloor below) is deliberately NOT
// one of the structured floors — it's the raw material of all eight of
// them combined, before any of it has resolved into a specific floor: a
// single continuous thread whose own length is calculated (not guessed)
// from the other eight floors' real combined length.

const GROUND_Y = 0;
const THREAD_RADIUS = 1.4; // thick enough that a whole floor reads as a solid, prominent band rather than a fine wire

// One floor per level of App.js's own scroll (LEVELS): Hyle, Atoms,
// Molecules, Cells, Tissues, Organs, Organ Systems, Humans, Societies —
// stacked directly above one another like floors of a building, spaced
// evenly apart vertically. Floors 1-8 (the lettered/structured ones) are
// eight identical copies of the same weave; floor 0 (Hyle) is a distinct
// kind of thread entirely — see buildHyleFloor above buildGroundThread.
const FLOOR_COUNT = 9;
const FLOOR_SPACING = 200;
// Which floor is Atoms and which is Molecules, matching App.js's own
// LEVELS order (Hyle=0 first) — the cargo below rides on these two floors
// specifically.
const ATOMIC_FLOOR_INDEX = 1;
const MOLECULAR_FLOOR_INDEX = 2;

// Every STRUCTURED floor's own coil (floors 1..FLOOR_COUNT-1 — Hyle, floor
// 0, isn't part of this scheme at all, see buildHyleFloor above) has two
// true open ends — its INNER end (theta≈0, closest to where the coil's own
// path structurally begins) and its OUTER end (theta=max, the last point
// wound). Rather than receding flat into the distance, each end bends
// vertically — a quarter-turn (sin/cos easing, so the tangent continues the
// coil's own direction at the join, then eases to purely vertical at the
// tip) — and alternates direction floor to floor:
//   floor 1: inner up,   outer down
//   floor 2: inner down, outer up
//   floor 3: inner up,   outer down
//   ...and so on, odd floors matching floor 1, even floors matching floor 2.
// Two neighboring floors' facing ends (floor 1's inner-up meeting floor 2's
// inner-down; floor 2's outer-up meeting floor 3's outer-down; and so on)
// bend exactly half of FLOOR_SPACING vertically each, so their tips land at
// the same height — blending into one continuous connector rather than two
// separate stubs. Only the two ends with nothing to meet stay true open
// ends, hanging past the whole structured stack instead: whichever end
// (inner or outer — which one it is depends on floor parity) points down at
// floor 1 (the bottom of the structured stack, fed by the Hyle floor's own
// peripheral endpoint), and whichever end points up at the very last floor.
const FREE_END_BEND_RUN = 140; // horizontal distance every bend covers, continuing the coil's own tangent direction at the join
const FREE_END_BEND_SAMPLES = 20;
const HALF_FLOOR_SPACING = FLOOR_SPACING / 2; // internal floor-to-floor bends each cover exactly this much, so they meet in the middle
const OPEN_FREE_END_DROP = 260; // the structured stack's own two true open ends (bottom of floor 1, top of the last floor) hang this far past it
// sign: +1 (bends up) is only ever open at the very last floor (nothing
// above it); -1 (bends down) is only ever open at floor 1, the bottom of
// the structured stack (nothing below it meets it — see above) — true
// regardless of FLOOR_COUNT's own parity, unlike a hardcoded "floor 1 or
// last floor" check on one specific end alone would be.
const isOpenFreeEnd = (sign, floorIndex) =>
  (sign === -1 && floorIndex === 1) || (sign === 1 && floorIndex === FLOOR_COUNT - 1);

// Evenly-lit identical floors are hard to tell apart from a distance —
// each one now gets its own hue (evenly spread around the color wheel, so
// no two floors are ever confusable) and a much brighter glow than the
// single shared thread color this used to be, so a floor reads clearly the
// instant it's visible.
const FLOOR_GLOW_EMISSIVE_INTENSITY = 1.0;
const colorForFloor = (floorIndex) => new THREE.Color().setHSL(floorIndex / FLOOR_COUNT, 0.85, 0.6);

// ── Structured floors as shrinking coils ──────────────────────────────────
// Floor 1 (Atoms) gets the full base length; every floor above it tapers
// down toward STRUCTURED_LENGTH_MIN_SCALE of that (the last floor,
// Societies) — since a coil's radius is derived from how much length it
// has to contain (see structuredCoilRadiusFor below, the same footprint-
// area relationship the Hyle floor's own radius uses), the radius shrinks
// right along with the length, with no separate radius parameter needed.
const BASE_STRUCTURED_FLOOR_LENGTH = 28000; // floor 1 (Atoms)'s own target length — matches what every floor's old back-and-forth weave used to measure out to
const STRUCTURED_LENGTH_MIN_SCALE = 0.35; // the last floor (Societies)'s target length, as a fraction of floor 1's
const STRUCTURED_COIL_STEP_LENGTH = 55; // tighter point sampling than Hyle's own (90) — these coils are far shorter, closer-spaced points still read as a smooth wind
const STRUCTURED_COIL_MIN_CLEARANCE = THREAD_RADIUS * 2 + 1.0;
const STRUCTURED_COIL_CENTER_CLEARANCE_RADIUS = 40; // smaller dead center than Hyle's own 120 — these coils are far shorter, a big empty middle would look sparse
const STRUCTURED_COIL_FILL_FRACTION = 0.3; // slightly denser winding than Hyle's "unformed" 0.22 — reads as more resolved/deliberate than the raw Hyle material it came from
const COIL_POINTS_PER_SEGMENT = 6; // curve points per tube segment — chunks the coil into small, individually-sewable pieces, similar count to the old weave's own per-row segments

const floorLengthScaleFor = (floorIndex) => {
  const t = (floorIndex - 1) / (FLOOR_COUNT - 2); // 0 at floor 1 (Atoms) .. 1 at the last floor (Societies)
  return 1 - t * (1 - STRUCTURED_LENGTH_MIN_SCALE);
};

const structuredCoilRadiusFor = (totalLength) => {
  const footprintArea = totalLength * STRUCTURED_COIL_MIN_CLEARANCE;
  return Math.sqrt(footprintArea / (Math.PI * STRUCTURED_COIL_FILL_FRACTION));
};

// Every parameter needed to both WALK a floor's coil (buildStructuredCoilPoints
// below) and to re-sample a single point on it later (coilPointAt, used by
// cargo to ride the same path) — computed once per floor from nothing but
// its own target length, so both call sites always agree on the same shape
// without passing built geometry back and forth.
const coilParamsFor = (floorIndex) => {
  const totalLength = BASE_STRUCTURED_FLOOR_LENGTH * floorLengthScaleFor(floorIndex);
  const wanderRadius = structuredCoilRadiusFor(totalLength);
  const spacingFromBudget = (Math.PI * wanderRadius * wanderRadius * STRUCTURED_COIL_FILL_FRACTION) / Math.max(totalLength, 1);
  const spacing = Math.max(STRUCTURED_COIL_MIN_CLEARANCE * 3.4, spacingFromBudget);
  const spiralB = (spacing * 1.6) / (Math.PI * 2);
  return { totalLength, spacing, spiralB, seed: floorIndex * 37.5 };
};

const coilPointAt = (params, theta) => {
  const radius = STRUCTURED_COIL_CENTER_CLEARANCE_RADIUS + params.spiralB * theta;
  const wobbleFade = Math.min(1, (radius - STRUCTURED_COIL_CENTER_CLEARANCE_RADIUS) / (params.spacing * 6));
  const wobble = Math.sin(theta * 0.73 + params.seed) * params.spacing * 0.1 * wobbleFade;
  return new THREE.Vector3((radius + wobble) * Math.cos(theta), GROUND_Y, (radius - wobble) * Math.sin(theta));
};

// Same deterministic expanding-spiral walk as buildHyleThreadPoints, just
// bounded to this floor's own (smaller) length budget — returns both the
// points and the final theta reached, so cargo (buildCargo below) knows the
// coil's own angular span to spread its items across.
const buildStructuredCoilPoints = (params) => {
  const points = [];
  let theta = 0.01;
  let travelled = 0;
  points.push(coilPointAt(params, theta));
  while (travelled < params.totalLength) {
    const current = points[points.length - 1];
    const localRadius = Math.max(params.spacing, params.spiralB * theta);
    const dTheta = Math.min(0.22, STRUCTURED_COIL_STEP_LENGTH / Math.hypot(localRadius, params.spiralB));
    theta += dTheta;
    let next = coilPointAt(params, theta);
    const stepLength = current.distanceTo(next);
    const remaining = params.totalLength - travelled;
    if (stepLength > remaining) {
      next = current.clone().lerp(next, remaining / stepLength);
      points.push(next);
      travelled = params.totalLength;
      break;
    }
    points.push(next);
    travelled += stepLength;
  }
  return { points, thetaMax: theta };
};

// The ordered list of point-arrays that make up one STRUCTURED floor's
// thread (floors 1..FLOOR_COUNT-1, i.e. Atoms through Societies) — each
// array becomes one tube segment. Pulled out of buildFloor so the exact
// same point data can also be measured (floorThreadLength below) rather
// than only ever turned into a mesh — the Hyle floor's own length has to
// come from the real geometry, not a hand-derived estimate that could
// silently drift out of sync with it.
const floorSegments = (floorIndex) => {
  const { points: coilPoints } = buildStructuredCoilPoints(coilParamsFor(floorIndex));

  // A short vertical bend hanging off a coil endpoint — same sin/cos easing
  // as the old weave's own free-end bends (continues the coil's own
  // tangent direction at the join, eases to purely vertical at the tip),
  // just computed from that endpoint's own local tangent instead of a
  // fixed AXIS-aligned direction, since a coil's tangent varies
  // continuously with theta rather than staying fixed the way a straight
  // weave row's did.
  const bendPointsFrom = (endpoint, tangentDir, sign, drop) => {
    const bendPoints = [];
    for (let s = 0; s <= FREE_END_BEND_SAMPLES; s++) {
      const u = s / FREE_END_BEND_SAMPLES;
      const alongOffset = FREE_END_BEND_RUN * Math.sin((u * Math.PI) / 2);
      const rise = sign * drop * (1 - Math.cos((u * Math.PI) / 2));
      bendPoints.push(endpoint.clone().addScaledVector(tangentDir, alongOffset).add(new THREE.Vector3(0, rise, 0)));
    }
    return bendPoints;
  };

  const isEven = floorIndex % 2 === 0;
  const innerSign = isEven ? -1 : 1;
  const outerSign = isEven ? 1 : -1;
  const innerDrop = isOpenFreeEnd(innerSign, floorIndex) ? OPEN_FREE_END_DROP : HALF_FLOOR_SPACING;
  const outerDrop = isOpenFreeEnd(outerSign, floorIndex) ? OPEN_FREE_END_DROP : HALF_FLOOR_SPACING;

  // Tangent direction at each endpoint, from the last two coil points on
  // that side — inner points "backward" (continuing inward, away from
  // where the coil starts winding out), outer points "forward" (continuing
  // the coil's own outward direction of travel).
  const innerTangent = coilPoints[0].clone().sub(coilPoints[1]).normalize();
  const outerTangent = coilPoints[coilPoints.length - 1].clone().sub(coilPoints[coilPoints.length - 2]).normalize();

  const segments = [];
  segments.push(bendPointsFrom(coilPoints[0], innerTangent, innerSign, innerDrop));
  for (let i = 0; i < coilPoints.length - 1; i += COIL_POINTS_PER_SEGMENT) {
    const chunk = coilPoints.slice(i, Math.min(coilPoints.length, i + COIL_POINTS_PER_SEGMENT + 1));
    if (chunk.length >= 2) segments.push(chunk);
  }
  segments.push(bendPointsFrom(coilPoints[coilPoints.length - 1], outerTangent, outerSign, outerDrop));

  // Build every structured floor from its downward end toward its upward
  // end. Odd floors have their downward end at the outer side, so they
  // reverse; even floors already start at their downward inner connector.
  // That keeps the sewing continuous from Hyle -> Atoms -> ... -> Societies.
  return isEven ? segments : segments.reverse().map((points) => [...points].reverse());
};

// Real arc length of one structured floor's thread, measured from the exact
// same point data its mesh is built from (via THREE's own curve sampling,
// not a hand-derived formula) — summed across floors 1..FLOOR_COUNT-1 in
// buildGroundThread below to get the Hyle floor's own length budget.
const floorThreadLength = (floorIndex) => {
  let total = 0;
  for (const points of floorSegments(floorIndex)) {
    total += new THREE.CatmullRomCurve3(points).getLength();
  }
  return total;
};

// Builds one structured floor AND tags every one of its segment meshes with
// its own running cumulativeLength (in thread-path order, since
// floorSegments already returns segments in the order the thread actually
// runs through them) — read by the component's own progress effect to
// "sew" this floor in gradually as it's scrolled into, one segment at a
// time, rather than popping fully-formed into view. floor.userData.
// totalLength is the same number floorThreadLength(floorIndex) would
// return, just captured here instead of recomputed a second time.
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
  let cumulativeLength = 0;
  for (const points of floorSegments(floorIndex)) {
    const curve = new THREE.CatmullRomCurve3(points);
    // Bends carry FREE_END_BEND_SAMPLES+1 points and need that many tubular
    // segments to read as a smooth curve; every other segment here is a
    // straight 2-point run, which only ever needs 2.
    const tubularSegments = points.length > 2 ? points.length - 1 : 2;
    const geometry = new THREE.TubeGeometry(curve, tubularSegments, THREAD_RADIUS, 10, false); // more radial segments than before — THREAD_RADIUS is thick enough now that a hexagonal cross-section would show
    const mesh = new THREE.Mesh(geometry, threadMaterial);
    cumulativeLength += curve.getLength();
    mesh.userData.cumulativeLength = cumulativeLength;
    floor.add(mesh);
  }
  floor.userData.totalLength = cumulativeLength;
  return floor;
};

const HYLE_STEP_LENGTH = 90; // one sampling step's own length — small enough to read as genuine wandering, not a handful of long straight jumps
const HYLE_SEED = 1337; // fixed — the same "unformed" shape every load, not a different one on every reload
const HYLE_MIN_CLEARANCE = THREAD_RADIUS * 2 + 1.2; // rendered tubes must stay at least this far apart, centerline to centerline, to never visually touch or cross
const HYLE_CENTER_CLEARANCE_RADIUS = 120; // avoids the first spiral turns folding across the origin and visually intersecting
// The Hyle thread's footprint radius is derived from totalLength: how much
// flat area the thread's own footprint (length × clearance "lane" width)
// needs, divided by a conservative fill fraction, solved for the disk
// radius that contains that area.
const HYLE_TARGET_FILL_FRACTION = 0.22;
const hyleWanderRadiusFor = (totalLength) => {
  const footprintArea = totalLength * HYLE_MIN_CLEARANCE;
  return Math.sqrt(footprintArea / (Math.PI * HYLE_TARGET_FILL_FRACTION));
};

// The Hyle floor's own thread: not floor 0 of the same repeated weave every
// structured floor above it uses, but the raw material of all eight of
// them combined. It must actually contain the same length budget as those
// eight structured floors combined. A previous greedy random walk could
// box itself in and stop after only a small fraction of that budget, which
// made the HUD show impossible-looking numbers (e.g. Hyle ~9,440 while
// each structured floor was ~28,000). This deterministic expanding spiral
// keeps the "unformed" look without any dead-end state, so it always reaches
// the requested length.
const buildHyleThreadPoints = (totalLength) => {
  const wanderRadius = hyleWanderRadiusFor(totalLength);
  const spacingFromBudget = (Math.PI * wanderRadius * wanderRadius * HYLE_TARGET_FILL_FRACTION) / Math.max(totalLength, 1);
  const spacing = Math.max(HYLE_MIN_CLEARANCE * 3.4, spacingFromBudget);
  const spiralB = (spacing * 1.6) / (Math.PI * 2);
  const points = [];
  let theta = 0.01;
  let travelled = 0;

  const pointAtTheta = (t) => {
    const radius = HYLE_CENTER_CLEARANCE_RADIUS + spiralB * t;
    const wobbleFade = Math.min(1, (radius - HYLE_CENTER_CLEARANCE_RADIUS) / (spacing * 6));
    const wobble = Math.sin(t * 0.73 + HYLE_SEED) * spacing * 0.1 * wobbleFade;
    return new THREE.Vector3(
      (radius + wobble) * Math.cos(t),
      GROUND_Y,
      (radius - wobble) * Math.sin(t)
    );
  };

  points.push(pointAtTheta(theta));
  while (travelled < totalLength) {
    const current = points[points.length - 1];
    const localRadius = Math.max(spacing, spiralB * theta);
    const dTheta = Math.min(0.22, HYLE_STEP_LENGTH / Math.hypot(localRadius, spiralB));
    theta += dTheta;
    let next = pointAtTheta(theta);
    const stepLength = current.distanceTo(next);
    const remaining = totalLength - travelled;
    if (stepLength > remaining) {
      next = current.clone().lerp(next, remaining / stepLength);
      points.push(next);
      travelled = totalLength;
      break;
    }
    points.push(next);
    travelled += stepLength;
  }
  return points;
};

// Single continuous tube (unlike the structured floors' many small
// per-segment meshes) — its own reveal doesn't toggle whole segments on
// gradually the way a structured floor's does, it shrinks via
// geometry.setDrawRange (see the component's own progress effect), so
// tubularSegments/radialSegments are stashed in userData to convert a
// visible-length fraction into an index count later without recomputing
// anything about the geometry itself.
const buildHyleFloor = (totalLength) => {
  const floor = new THREE.Group();
  const floorColor = colorForFloor(0);
  const threadMaterial = new THREE.MeshStandardMaterial({
    color: floorColor,
    emissive: floorColor,
    emissiveIntensity: FLOOR_GLOW_EMISSIVE_INTENSITY,
    roughness: 0.5,
    metalness: 0.05,
  });
  let points = buildHyleThreadPoints(totalLength);
  let curve = new THREE.CatmullRomCurve3(points, false, "centripetal");
  const builtLength = curve.getLength();
  if (builtLength > 0) {
    const lengthScale = totalLength / builtLength;
    points = points.map((p) => new THREE.Vector3(p.x * lengthScale, p.y, p.z * lengthScale));
    curve = new THREE.CatmullRomCurve3(points, false, "centripetal");
  }
  const radialSegments = 10;
  const tubularSegments = points.length - 1;
  const geometry = new THREE.TubeGeometry(curve, tubularSegments, THREAD_RADIUS, radialSegments, false);
  const mesh = new THREE.Mesh(geometry, threadMaterial);
  mesh.userData.tubularSegments = tubularSegments;
  mesh.userData.radialSegments = radialSegments;
  floor.add(mesh);
  // The path generator is constructed to hit the requested length budget;
  // read back the built curve length anyway so the HUD/consumption math
  // reflects the real geometry after curve interpolation.
  floor.userData.totalLength = curve.getLength();
  return floor;
};

const buildGroundThread = () => {
  const group = new THREE.Group();

  // The 8 lettered floors' own combined thread length — this is the Hyle
  // floor's entire length budget (see buildHyleFloor above), not an
  // arbitrary or matched-by-eye number.
  const floorLengths = new Array(FLOOR_COUNT).fill(0);
  let structuredFloorsLength = 0;
  for (let f = 1; f < FLOOR_COUNT; f++) {
    const len = floorThreadLength(f);
    floorLengths[f] = len;
    structuredFloorsLength += len;
  }

  const floorGroups = []; // indexed by floor — read by the component to show only the active level's own floor
  for (let f = 0; f < FLOOR_COUNT; f++) {
    const floor = f === 0 ? buildHyleFloor(structuredFloorsLength) : buildFloor(f);
    floor.position.y = f * FLOOR_SPACING;
    group.add(floor);
    floorGroups.push(floor);
    if (f === 0) floorLengths[0] = floor.userData.totalLength; // the actually-built length, see buildHyleFloor's own note
  }

  return { group, floorGroups, floorLengths };
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
// Each item drives back and forth along its own floor's coil, staying
// within the coil's own angular span (away from the free-end bends either
// side) — a simple there-and-back "drive" sliding along the wound thread,
// not a full traversal of it.
const CARGO_THETA_HALF_SPAN = 0.5; // radians each item swings around its own resting point along the coil
const CARGO_SPEED = 0.6; // radians per second
const CARGO_PERIOD = (CARGO_THETA_HALF_SPAN * 4) / CARGO_SPEED; // seconds for one full there-and-back cycle

const buildCargo = () => {
  const group = new THREE.Group();
  const items = []; // { mesh, coilParams, theta0, offset } — read every frame by updateCargo below

  const cargoMaterialTemplate = new THREE.MeshStandardMaterial({
    color: CARGO_COLOR,
    emissive: new THREE.Color(CARGO_COLOR),
    emissiveIntensity: CARGO_EMISSIVE_INTENSITY,
    roughness: 0.35,
    metalness: 0.15,
    flatShading: true, // facets catch the light unevenly, so the gem shape reads as 3D even from a distance
  });
  const cargoGeometry = new THREE.IcosahedronGeometry(CARGO_RADIUS, 0); // detail 0 = the plain 20-face icosahedron, not a smoothed sphere
  const outlineMaterialTemplate = new THREE.MeshBasicMaterial({ color: CARGO_OUTLINE_COLOR, side: THREE.BackSide });
  const outlineGeometry = new THREE.IcosahedronGeometry(CARGO_RADIUS * CARGO_OUTLINE_SCALE, 0);

  const floorGroups = {}; // floorIndex -> its own cargo group, for the floors that have cargo — read by the component to show only the active level's own floor

  const addCargoForFloor = (floorIndex, labels) => {
    const floorGroup = new THREE.Group();
    floorGroup.userData.isCargoFloor = true;
    floorGroup.position.y = floorIndex * FLOOR_SPACING;
    group.add(floorGroup);
    floorGroups[floorIndex] = floorGroup;
    const cargoMaterial = cargoMaterialTemplate.clone();
    const outlineMaterial = outlineMaterialTemplate.clone();

    const coilParams = coilParamsFor(floorIndex);
    const { thetaMax } = buildStructuredCoilPoints(coilParams);

    labels.forEach((label, i) => {
      // Spread evenly along the coil's own angular span, staying clear of
      // the free-end bends at either end (theta≈0 and theta≈thetaMax).
      const t = (i + 0.5) / labels.length;
      const theta0 = thetaMax * 0.08 + t * thetaMax * 0.84;

      const itemGroup = new THREE.Group();
      itemGroup.add(new THREE.Mesh(outlineGeometry, outlineMaterial)); // rendered first, back faces only, so it silhouettes the gem inside it
      itemGroup.add(new THREE.Mesh(cargoGeometry, cargoMaterial));
      const sprite = createLabelSprite(label, CARGO_LABEL_WORLD_SIZE);
      sprite.position.y = CARGO_RADIUS * CARGO_OUTLINE_SCALE + CARGO_LABEL_CLEARANCE;
      itemGroup.add(sprite);
      floorGroup.add(itemGroup);

      items.push({ mesh: itemGroup, coilParams, thetaMax, theta0, offset: i / labels.length });
    });
  };

  addCargoForFloor(ATOMIC_FLOOR_INDEX, ATOMIC_CARGO);
  addCargoForFloor(MOLECULAR_FLOOR_INDEX, MOLECULAR_CARGO);

  return { group, items, floorGroups };
};

// Called every animation frame — moves each cargo item along its own
// floor's coil via a constant-speed triangle wave (drive in, drive out),
// staggered by its own offset so a floor's items don't all move in
// lockstep. Swinging theta (rather than a fixed radius) means each item
// genuinely rides the wound thread — sliding along it changes both its
// angle and its radius together, the same way a bead on a coiled wire
// would move.
const updateCargo = (items, elapsedSeconds) => {
  for (const item of items) {
    const cyclePhase = (elapsedSeconds / CARGO_PERIOD + item.offset) % 1;
    const t = cyclePhase < 0.5 ? cyclePhase * 2 : 2 - cyclePhase * 2; // 0 -> 1 -> 0
    const swing = -CARGO_THETA_HALF_SPAN + t * (CARGO_THETA_HALF_SPAN * 2);
    const theta = Math.max(0.01, Math.min(item.thetaMax, item.theta0 + swing));
    item.mesh.position.copy(coilPointAt(item.coilParams, theta));
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
// LEVELS), tuned live from the floating control panel below — the
// alternative to guessing framing values with no way to actually see the
// result. Deliberately hardcoded here, NOT persisted anywhere at runtime
// (no localStorage, no backend) — every visitor needs the same tuned shots,
// not just whoever's browser happened to save one. The panel's "Save
// current view" button copies a ready-to-paste snippet for that level to
// the clipboard; pasting it into this object (and committing the change)
// is what actually makes a tuned shot permanent/shipped.
const DEFAULT_CAMERA_PRESETS = {
  0: { position: { x: 0, y: 1151.6, z: 0 }, target: { x: 0, y: 800, z: 0 } },
  1: { position: { x: 1939.67, y: 724.46, z: 1239.42 }, target: { x: -88.11, y: -102.8, z: 477.92 } },
  2: { position: { x: 1939.67, y: 724.46, z: 1239.42 }, target: { x: -88.11, y: -102.8, z: 477.92 } },
  3: { position: { x: 1939.67, y: 724.46, z: 1239.42 }, target: { x: -88.11, y: -102.8, z: 477.92 } },
  4: { position: { x: 1939.67, y: 724.46, z: 1239.42 }, target: { x: -88.11, y: -102.8, z: 477.92 } },
  5: { position: { x: 1939.67, y: 724.46, z: 1239.42 }, target: { x: -88.11, y: -102.8, z: 477.92 } },
  6: { position: { x: 1939.67, y: 724.46, z: 1239.42 }, target: { x: -88.11, y: -102.8, z: 477.92 } },
  7: { position: { x: 1939.67, y: 724.46, z: 1239.42 }, target: { x: -88.11, y: -102.8, z: 477.92 } },
  8: { position: { x: 1939.67, y: 724.46, z: 1239.42 }, target: { x: -88.11, y: -102.8, z: 477.92 } },
};
const loadCameraPresets = () => ({ ...DEFAULT_CAMERA_PRESETS });

// No more built-in per-level default framing — every level's shot comes
// from a saved preset (the control panel below) or it doesn't move at all.
// This is just where the camera sits before any level has one saved yet:
// pulled back generously (floor 1/Atoms' own coil, the widest of the
// tapering stack, spans roughly BASE_STRUCTURED_FLOOR_LENGTH worth of
// wound thread) and centered on the middle of the whole floor stack
// vertically, so it starts clear of the field rather than up against or
// inside it.
const INITIAL_CAMERA_FOCUS = new THREE.Vector3(0, ((FLOOR_COUNT - 1) * FLOOR_SPACING) / 2, 0);
const INITIAL_CAMERA_DISTANCE = 1400;

// How long a level-to-level camera transition takes, and its easing curve
// (slow-in, fast-through-the-middle, slow-out) — a plain cubic ease, not a
// linear lerp, so the motion reads as a deliberate camera move rather than
// a robotic slide.
const CAMERA_TRANSITION_MS = 1200;
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const FLOOR_MOUNT_SLIDE_LERP = 0.14;
const OBJECT_AUTO_ROTATION_SPEED = 0.035; // radians per second — deliberately slow, just enough to keep the form alive
const LIGHT_THEME_OBJECT_COLOR = new THREE.Color("#000000");
const clamp01 = (value) => Math.max(0, Math.min(1, value));
const floorSewFractionFor = (floorIndex, climbProgress) => {
  if (floorIndex <= 0) return 1;
  const perFloorSpan = 1 / (FLOOR_COUNT - 1);
  return clamp01(climbProgress / perFloorSpan - (floorIndex - 1));
};

const ThreadPyramidLogo = ({ activeLevel = 0, levelLabels = [], progress = 0, scrollWeights = [], onScrollWeightChange = null, showCameraPanel = false }) => {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);
  const previousActiveLevelRef = useRef(activeLevel);
  const activeLevelRef = useRef(activeLevel);
  const groundThreadRef = useRef(null);
  const cargoGroupRef = useRef(null);
  const cargoItemsRef = useRef([]); // read fresh every animation frame by the mount effect's own animate() loop below
  const floorVisibilityGroupsRef = useRef({}); // floorIndex -> [groups] — every ground/cargo group that floor owns, toggled by the activeLevel effect below
  const hyleMeshRef = useRef(null); // the Hyle floor's single tube mesh — shrunk via geometry.setDrawRange as the climb consumes it, see the progress effect below
  const [cameraPresets, setCameraPresets] = useState(loadCameraPresets);
  const [presetPanelOpen, setPresetPanelOpen] = useState(false);
  // Read inside the mount-only effect below (empty deps — it can't just
  // close over presetPanelOpen directly and stay current) so the wheel
  // handler there knows whether tuning is actually in progress.
  const presetPanelOpenRef = useRef(presetPanelOpen);
  useEffect(() => { presetPanelOpenRef.current = presetPanelOpen; }, [presetPanelOpen]);
  const [copiedLevel, setCopiedLevel] = useState(null); // brief "Copied!" confirmation, see saveCurrentViewAsPreset
  const [objectAutoRotationEnabled, setObjectAutoRotationEnabled] = useState(true);
  const [showThreadLengthHud, setShowThreadLengthHud] = useState(false);
  const [floorLengths, setFloorLengths] = useState([]); // index 0 = Hyle's total, 1..8 = each lettered floor's own — set once after the ground thread is built
  const [hyleRemaining, setHyleRemaining] = useState(0); // live — how much of Hyle's own length is still unconsumed, updates every scroll tick
  const [isLightTheme, setIsLightTheme] = useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("theme-light")
  );
  const isLightThemeRef = useRef(isLightTheme);
  const objectAutoRotationEnabledRef = useRef(objectAutoRotationEnabled);
  const progressRef = useRef(progress);

  activeLevelRef.current = activeLevel;
  isLightThemeRef.current = isLightTheme;
  objectAutoRotationEnabledRef.current = objectAutoRotationEnabled;
  progressRef.current = progress;

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const root = document.documentElement;
    const syncTheme = () => setIsLightTheme(root.classList.contains("theme-light"));
    syncTheme();

    const observer = new MutationObserver(syncTheme);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  const applyFloorVisualState = (group, floorIndex, visible) => {
    const currentIsLightTheme = isLightThemeRef.current;

    group.traverse((obj) => {
      if (!obj.material) return;
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      materials.forEach((material) => {
        if (material.color && material.userData.baseColor === undefined) {
          material.userData.baseColor = material.color.clone();
        }
        if (material.emissiveIntensity !== undefined && material.userData.baseEmissiveIntensity === undefined) {
          material.userData.baseEmissiveIntensity = material.emissiveIntensity;
        }
        if (material.emissive && material.userData.baseEmissive === undefined) {
          material.userData.baseEmissive = material.emissive.clone();
        }

        if (obj.isSprite) {
          material.transparent = true;
          material.depthWrite = false;
          if (material.color) {
            material.color.copy(
              currentIsLightTheme
                ? LIGHT_THEME_OBJECT_COLOR
                : new THREE.Color("#ffffff")
            );
          }
          return;
        }

        material.opacity = 1;
        material.transparent = false;
        material.depthWrite = true;
        material.depthTest = true;
        if (material.color) {
          material.color.copy(
            currentIsLightTheme
              ? LIGHT_THEME_OBJECT_COLOR
              : material.userData.baseColor
          );
        }

        if (material.emissiveIntensity !== undefined) {
          material.emissiveIntensity = currentIsLightTheme
            ? 0
            : material.userData.baseEmissiveIntensity;
        }
        if (material.emissive) {
          material.emissive.copy(
            currentIsLightTheme
              ? LIGHT_THEME_OBJECT_COLOR
              : material.userData.baseEmissive
          );
        }
      });
    });
  };

  const applyFloorMountLayout = (isImmediate = false) => {
    const currentActiveLevel = activeLevelRef.current;
    Object.entries(floorVisibilityGroupsRef.current).forEach(([floorIndex, groups]) => {
      const idx = Number(floorIndex);
      const sewFraction = floorSewFractionFor(idx, progressRef.current);
      const visible = idx === 0 || sewFraction > 0 || idx < currentActiveLevel;
      const targetOffset = visible ? -currentActiveLevel * FLOOR_SPACING : 0;

      groups.forEach((group) => {
        if (group.userData.baseY === undefined) group.userData.baseY = group.position.y;
        if (group.userData.currentYOffset === undefined) group.userData.currentYOffset = 0;
        group.userData.targetYOffset = targetOffset;
        group.renderOrder = 0;
        group.visible = group.userData.isCargoFloor ? sewFraction >= 0.999 : visible;
        applyFloorVisualState(group, idx, visible);
        if (isImmediate) {
          group.userData.currentYOffset = targetOffset;
          group.position.y = group.userData.baseY + targetOffset;
        }
      });
    });
  };

  // Rounded to 2dp — these are hand-tuned camera shots, not physics; the
  // raw float noise three.js reports isn't meaningful precision, just
  // clutter in the pasted code.
  const round2 = (n) => Math.round(n * 100) / 100;
  const formatPreset = (preset) => (
    `{ position: { x: ${round2(preset.position.x)}, y: ${round2(preset.position.y)}, z: ${round2(preset.position.z)} }, ` +
    `target: { x: ${round2(preset.target.x)}, y: ${round2(preset.target.y)}, z: ${round2(preset.target.z)} } }`
  );
  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  };

  // Updates the LIVE in-memory preset (so you can immediately see how it
  // looks while tuning) and copies a ready-to-paste snippet — pasting that
  // into DEFAULT_CAMERA_PRESETS above and committing is what actually ships
  // it to every visitor; nothing here persists on its own.
  const saveCurrentViewAsPreset = async (levelIndex) => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const preset = {
      position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
      target: { x: controls.target.x, y: controls.target.y, z: controls.target.z },
    };
    setCameraPresets((prev) => ({ ...prev, [levelIndex]: preset }));
    const copied = await copyToClipboard(`${levelIndex}: ${formatPreset(preset)},`);
    if (copied) {
      setCopiedLevel(levelIndex);
      setTimeout(() => setCopiedLevel((current) => (current === levelIndex ? null : current)), 2000);
    }
  };

  const clearPresetForLevel = (levelIndex) => {
    setCameraPresets((prev) => {
      if (!(levelIndex in prev)) return prev;
      const next = { ...prev };
      delete next[levelIndex];
      return next;
    });
  };

  // Exports every currently-tuned level in one paste-ready block, for after
  // a full tuning pass across all levels rather than one at a time.
  const copyAllPresetsAsCode = () => {
    const lines = Object.entries(cameraPresets)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([levelIndex, preset]) => `  ${levelIndex}: ${formatPreset(preset)},`);
    copyToClipboard(`const DEFAULT_CAMERA_PRESETS = {\n${lines.join("\n")}\n};`);
    setCopiedLevel("all");
    setTimeout(() => setCopiedLevel((current) => (current === "all" ? null : current)), 2000);
  };

  // Same hardcode-and-commit pattern as the camera presets above, but for
  // how many screens of scrolling each level's own step takes — see
  // DEFAULT_LEVEL_SCROLL_WEIGHTS in App.js, which actually owns this state
  // (it drives the real .app_floor_scroll_step heights there); this panel
  // is just the live-tuning remote control for it.
  const copyScrollWeightsAsCode = () => {
    const lines = scrollWeights.map((w) => `  ${round2(w)},`);
    copyToClipboard(`const DEFAULT_LEVEL_SCROLL_WEIGHTS = [\n${lines.join("\n")}\n];`);
    setCopiedLevel("scroll-weights");
    setTimeout(() => setCopiedLevel((current) => (current === "scroll-weights" ? null : current)), 2000);
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
    // Always on — needed for OrbitControls' own internal touch-pinch dolly
    // (controls.touches.TWO below) to work. This does NOT reopen the
    // touchpad-scroll-hijack hole that used to come with it: OrbitControls'
    // own internal wheel listener lives on the canvas itself, a descendant
    // of `mount`, and the custom onWheel handler below is registered on
    // `mount` with capture:true — capture fires first, on the way down,
    // so onWheel always gets first (and, via stopPropagation, final) say
    // over every wheel event before OrbitControls' own listener ever sees
    // it. See onWheel's own comments for how each case is handled.
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
    let threeFingerPanActive = false;
    const averageTouchClient = (touches) => {
      let x = 0, y = 0;
      for (let i = 0; i < touches.length; i++) { x += touches[i].clientX; y += touches[i].clientY; }
      return { x: x / touches.length, y: y / touches.length };
    };
    const onThreeFingerTouchStart = (event) => {
      if (event.touches.length === 3) {
        event.preventDefault();
        event.stopImmediatePropagation();
        threeFingerPanActive = true;
        controls.enabled = false;
        moveDragStart = averageTouchClient(event.touches);
      }
    };
    const onThreeFingerTouchMove = (event) => {
      if (!threeFingerPanActive) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.touches.length !== 3 || moveDragStart === null) return;
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
      if (!threeFingerPanActive) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.touches.length === 3) {
        moveDragStart = averageTouchClient(event.touches);
        return;
      }
      moveDragStart = null;
      if (event.touches.length === 0) {
        threeFingerPanActive = false;
        controls.enabled = true;
      }
    };
    renderer.domElement.addEventListener("touchstart", onThreeFingerTouchStart, { passive: false, capture: true });
    renderer.domElement.addEventListener("touchmove", onThreeFingerTouchMove, { passive: false, capture: true });
    renderer.domElement.addEventListener("touchend", onThreeFingerTouchEnd, { passive: false, capture: true });
    renderer.domElement.addEventListener("touchcancel", onThreeFingerTouchEnd, { passive: false, capture: true });

    const onWheel = (event) => {
      // Browsers report an actual trackpad pinch as a wheel event with
      // ctrlKey set — that's always a deliberate zoom gesture, never
      // confusable with a plain two-finger scroll, so it zooms the object
      // regardless of whether the camera-tuning panel is open.
      if (event.ctrlKey) {
        event.preventDefault();
        event.stopPropagation();
        const distance = camera.position.distanceTo(controls.target);
        const zoomed = distance * Math.pow(0.98, -event.deltaY);
        const clamped = Math.min(controls.maxDistance, Math.max(controls.minDistance, zoomed));
        camera.position.sub(controls.target).setLength(clamped).add(controls.target);
        return;
      }

      // A laptop touchpad's two-finger scroll and an actual mouse wheel
      // both fire as plain (non-ctrl) "wheel" events — with no camera-
      // tuning panel open, that gesture should do exactly what it looks
      // like it should: scroll the page to climb levels, not silently pan
      // the 3D camera. Not calling preventDefault is what lets it bubble
      // up to #app_home_grid as normal page scroll — but stopPropagation
      // still runs, so OrbitControls' own internal wheel listener (on the
      // canvas itself, a descendant of `mount`; see controls.enableZoom's
      // own comment above for why it's permanently true now) never gets a
      // chance to preventDefault this same event out from under us. Only
      // while actively tuning a shot (panel open) does plain wheel/
      // trackpad input pan the camera instead.
      if (!presetPanelOpenRef.current) {
        event.stopPropagation();
        return;
      }
      event.preventDefault();
      event.stopPropagation();

      const distance = camera.position.distanceTo(controls.target);
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
    let previousFrameTime = performance.now();
    const cargoStartTime = performance.now();
    const animate = (now = performance.now()) => {
      raf = requestAnimationFrame(animate);
      const deltaSeconds = Math.min(0.05, Math.max(0, (now - previousFrameTime) / 1000));
      previousFrameTime = now;

      if (objectAutoRotationEnabledRef.current) {
        const rotationDelta = OBJECT_AUTO_ROTATION_SPEED * deltaSeconds;
        if (groundThreadRef.current) groundThreadRef.current.rotation.y += rotationDelta;
        if (cargoGroupRef.current) cargoGroupRef.current.rotation.y += rotationDelta;
      }

      updateCargo(cargoItemsRef.current, (performance.now() - cargoStartTime) / 1000);
      Object.values(floorVisibilityGroupsRef.current).forEach((groups) => {
        groups.forEach((group) => {
          if (group.userData.baseY === undefined) return;
          const target = group.userData.targetYOffset ?? 0;
          const current = group.userData.currentYOffset ?? 0;
          const next = Math.abs(target - current) < 0.01
            ? target
            : current + (target - current) * FLOOR_MOUNT_SLIDE_LERP;
          group.userData.currentYOffset = next;
          group.position.y = group.userData.baseY + next;
        });
      });
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
      renderer.domElement.removeEventListener("touchstart", onThreeFingerTouchStart, { capture: true });
      renderer.domElement.removeEventListener("touchmove", onThreeFingerTouchMove, { capture: true });
      renderer.domElement.removeEventListener("touchend", onThreeFingerTouchEnd, { capture: true });
      renderer.domElement.removeEventListener("touchcancel", onThreeFingerTouchEnd, { capture: true });
      controls.dispose();
      renderer.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
      sceneRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
    };
  }, []);

  // Builds the ground-thread group once, on mount — the geometry itself is
  // static (built once, never rebuilt on scroll); what DOES change on
  // scroll is which portion of it is currently visible, handled by the
  // progress effect further down via per-segment .visible flags (structured
  // floors) and geometry.setDrawRange (Hyle), not by touching the geometry
  // built here.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    const { group: groundThread, floorGroups, floorLengths } = buildGroundThread();
    scene.add(groundThread);
    groundThreadRef.current = groundThread;
    setFloorLengths(floorLengths);
    setHyleRemaining(floorLengths[0] || 0);

    const visibilityGroups = floorVisibilityGroupsRef.current;
    floorGroups.forEach((floorGroup, floorIndex) => {
      if (!visibilityGroups[floorIndex]) visibilityGroups[floorIndex] = [];
      visibilityGroups[floorIndex].push(floorGroup);
      if (floorIndex === 0) hyleMeshRef.current = floorGroup.children[0] || null;
    });
    applyFloorMountLayout(true);

    return () => {
      scene.remove(groundThread);
      disposeGroundThread(groundThread);
      groundThreadRef.current = null;
      hyleMeshRef.current = null;
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
    cargoGroupRef.current = cargoGroup;
    cargoItemsRef.current = items;

    const visibilityGroups = floorVisibilityGroupsRef.current;
    Object.entries(floorGroups).forEach(([floorIndex, floorGroup]) => {
      const idx = Number(floorIndex);
      if (!visibilityGroups[idx]) visibilityGroups[idx] = [];
      visibilityGroups[idx].push(floorGroup);
    });
    applyFloorMountLayout(true);

    return () => {
      scene.remove(cargoGroup);
      disposeCargo(cargoGroup);
      cargoGroupRef.current = null;
      cargoItemsRef.current = [];
    };
  }, []);

  // Every previously reached floor remains mounted, and the whole mounted
  // stack slides downward so the newly active floor lands at the same
  // viewing level instead of replacing the old one.
  useEffect(() => {
    applyFloorMountLayout(false);
  }, [activeLevel, isLightTheme]);

  // "Sewing" — the floor currently being climbed into builds itself in
  // gradually, one segment at a time in the thread's own path order. The
  // Home scroll has eight intervals, so each interval sews the next
  // structured floor: Hyle->Atoms sews Atoms, Atoms->Molecules sews
  // Molecules, and so on. At the same time, and
  // driven by that exact same `progress` value, the Hyle floor's own thread
  // visibly shrinks from its inner/central endpoint outward — that central
  // endpoint (index 0 in buildHyleThreadPoints, theta≈0) is the feed end
  // closest to the Atomic floor's downward open end, so the outer/
  // peripheral endpoint (the tube's last point) is what survives until the
  // whole thread is consumed. Hyle's total length WAS the other eight
  // floors' combined length to begin with (see buildGroundThread): building
  // them is depicted as consuming it, not as two unrelated things happening
  // to share a number.
  useEffect(() => {
    const hyleTotal = floorLengths[0] || 0;
    const hyleVisibleFraction = clamp01(1 - progress);
    const hyleMesh = hyleMeshRef.current;
    if (hyleMesh && hyleMesh.userData.tubularSegments) {
      const { tubularSegments, radialSegments } = hyleMesh.userData;
      const indicesPerStep = radialSegments * 6;
      const visibleSteps = Math.floor(tubularSegments * hyleVisibleFraction);
      const hiddenSteps = tubularSegments - visibleSteps;
      hyleMesh.geometry.setDrawRange(hiddenSteps * indicesPerStep, Math.max(0, visibleSteps * indicesPerStep));
    }
    setHyleRemaining(hyleTotal * hyleVisibleFraction);

    Object.entries(floorVisibilityGroupsRef.current).forEach(([floorIndexStr, groups]) => {
      const idx = Number(floorIndexStr);
      if (idx === 0) return; // Hyle handled above — it isn't sewn segment-by-segment, it's consumed
      const fraction = floorSewFractionFor(idx, progress);
      groups.forEach((group) => {
        if (group.userData.isCargoFloor) {
          group.visible = fraction >= 0.999;
          return;
        }
        const totalLength = group.userData.totalLength;
        if (!totalLength) return;
        group.visible = fraction > 0 || idx < activeLevel;
        const revealLength = fraction * totalLength;
        group.children.forEach((mesh) => {
          mesh.visible = (mesh.userData.cumulativeLength || 0) <= revealLength;
        });
      });
    });
  }, [progress, activeLevel, floorLengths]);

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

    const levelChanged = previousActiveLevelRef.current !== activeLevel;
    previousActiveLevelRef.current = activeLevel;
    if (levelChanged) return;

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
      {showCameraPanel && (
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
              Pick a level, drag/pinch to the shot you want, then save it —
              this copies the shot to your clipboard as code. Paste it into
              DEFAULT_CAMERA_PRESETS in ThreadPyramidLogo.jsx and commit it —
              nothing here ships to other visitors on its own.
            </p>
            <button
              type="button"
              className="camera_preset_copy_btn"
              onClick={copyAllPresetsAsCode}
              disabled={Object.keys(cameraPresets).length === 0}
            >
              {copiedLevel === "all" ? "Copied!" : "Copy all tuned levels as code"}
            </button>
            <button
              type="button"
              className="camera_preset_copy_btn"
              onClick={copyScrollWeightsAsCode}
              disabled={!scrollWeights.length}
            >
              {copiedLevel === "scroll-weights" ? "Copied!" : "Copy scroll weights as code"}
            </button>
            <label id="camera_rotation_toggle" className="camera_preset_control_row">
              <span>
                <strong>Object rotation</strong>
                <small>Slow vertical-axis spin</small>
              </span>
              <input
                type="checkbox"
                checked={objectAutoRotationEnabled}
                onChange={(event) => setObjectAutoRotationEnabled(event.target.checked)}
              />
            </label>
            <label id="camera_thread_length_toggle" className="camera_preset_control_row">
              <span>
                <strong>Thread length</strong>
                <small>Show floor length HUD</small>
              </span>
              <input
                type="checkbox"
                checked={showThreadLengthHud}
                onChange={(event) => setShowThreadLengthHud(event.target.checked)}
              />
            </label>
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
                  {onScrollWeightChange && (
                    <label className="camera_preset_scroll_weight" title="Screens of scrolling this level's own step takes (1 = default)">
                      <span>Scroll</span>
                      <input
                        type="number"
                        min="0.25"
                        step="0.25"
                        value={scrollWeights[i] ?? 1}
                        onChange={(event) => onScrollWeightChange(i, Number(event.target.value) || 1)}
                      />
                    </label>
                  )}
                  <button
                    disabled={i !== activeLevel}
                    onClick={() => saveCurrentViewAsPreset(i)}
                    title={i === activeLevel ? "Copy this level's current view as a code snippet" : "Scroll to this level first"}
                  >
                    {copiedLevel === i ? "Copied!" : "Save current view"}
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
      )}
      {showThreadLengthHud && (
        <div id="thread_length_hud">
          <div id="thread_length_hud_title">Thread length</div>
          {levelLabels.map((label, i) => (
            <div
              key={label}
              className={`thread_length_hud_row${i === activeLevel ? " thread_length_hud_row--active" : ""}${i === 0 ? " thread_length_hud_row--hyle" : ""}`}
            >
              <span className="thread_length_hud_label">{label}</span>
              <span className="thread_length_hud_value">
                {i === 0
                  ? `${Math.round(hyleRemaining).toLocaleString()} / ${Math.round(floorLengths[0] || 0).toLocaleString()}`
                  : Math.round(floorLengths[i] || 0).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
};

export default ThreadPyramidLogo;
