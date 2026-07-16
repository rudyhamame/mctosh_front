import React, { useEffect, useRef } from "react";
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
// Only the very first and very last row keep going instead of turning,
// out to a hidden distance, so the thread as a whole still never actually
// ends — infinity lives at the two true open ends, not in hiding every
// turn along the way.
//
// In exactly one place along that one thread, it rises up out of the
// ground and back down again — a single curve, nothing else changed.

const GROUND_Y = 0;
const ROW_COUNT = 40; // how many back-and-forth passes the one thread makes
const FIELD_HALF_WIDTH = 1000; // lateral spread, perpendicular to the shared direction — wider field, same row count, so rows sit further apart
const INNER_HALF_LENGTH = 320; // how far each INTERNAL turn sits from center — close enough to actually see the weave, now covering more ground along each row's own run
const OUTER_HALF_LENGTH = 4000; // how far the two TRUE open ends (first row's start, last row's end) reach — far enough neither is ever near the camera
const THREAD_RADIUS = 0.4;
// Soft, slightly warm off-white rather than stark pure white — a fully
// saturated white line at high brightness against a near-black background
// is a harsh, high-contrast look that's uncomfortable to look at for long.
const THREAD_COLOR = "#cfd2dc";

// One fixed direction the thread runs along on each pass.
const AXIS_ANGLE = 0.35; // radians — arbitrary, just fixed
const AXIS = new THREE.Vector3(Math.cos(AXIS_ANGLE), 0, Math.sin(AXIS_ANGLE));
const PERP = new THREE.Vector3(-AXIS.z, 0, AXIS.x); // perpendicular — the direction consecutive passes step across

const point = (along, lateral, height = 0) =>
  new THREE.Vector3(0, GROUND_Y + height, 0).addScaledVector(AXIS, along).addScaledVector(PERP, lateral);

// Where the thread rises — a plain symmetric curve, envelope-pinned to
// ground level at both edges (sin(pi*t): zero at t=0 and t=1), so it
// settles back into being flat with no seam. Has to fit inside one internal
// row's own span (±INNER_HALF_LENGTH) with room either side for flat
// lead-in/out before the row's own turn.
const ARCH_SPAN = 100; // half-width of the curve's near (atomic, rising) side, along the thread's own direction
const ARCH_SAMPLES = 150; // resolution across the curve
// The far side (past the midline, the molecular area) is deliberately
// wider than the near side — same t:0.5..1 parameter range, just stretched
// over more distance, so the height curve (a function of t, not along)
// keeps working unchanged everywhere that reads it.
const MOLECULE_SPAN = 180;
const alongForT = (t) => (t <= 0.5
  ? -ARCH_SPAN + t * (ARCH_SPAN * 2)
  : (t - 0.5) * (MOLECULE_SPAN * 2));

// The atoms the human body is built from — its most abundant elements by
// mass, each one its own raised, knotted thread. Atomic number stands in
// for "energy needed for atom creation" (heavier nuclei cost more fusion
// energy to build, which holds across this whole set — none of them are
// past the iron group where that trend reverses), so height is derived
// directly from atomic number: every atom gets a distinct number, so no two
// threads ever rise to the same height.
const BODY_ATOMS = [
  { atomicNumber: 8 }, // Oxygen
  { atomicNumber: 6 }, // Carbon
  { atomicNumber: 1 }, // Hydrogen
  { atomicNumber: 7 }, // Nitrogen
  { atomicNumber: 20 }, // Calcium
  { atomicNumber: 15 }, // Phosphorus
  { atomicNumber: 19 }, // Potassium
  { atomicNumber: 16 }, // Sulfur
  { atomicNumber: 11 }, // Sodium
  { atomicNumber: 17 }, // Chlorine
  { atomicNumber: 12 }, // Magnesium
  { atomicNumber: 26 }, // Iron
  { atomicNumber: 30 }, // Zinc
  { atomicNumber: 29 }, // Copper
  { atomicNumber: 25 }, // Manganese
  { atomicNumber: 53 }, // Iodine
  { atomicNumber: 34 }, // Selenium
  { atomicNumber: 42 }, // Molybdenum
  { atomicNumber: 27 }, // Cobalt
];
// Element symbol by proton count (index 0 = 1 proton = H) — covers every
// proton count this set ever reaches (up to iodine, 53). Used to label an
// atom mid-formation by whatever element its CURRENT proton count actually
// is, not just its final one: 1 proton reads H, 2 reads He, and so on,
// right up the real periodic table, until it reaches its own target count.
const PERIODIC_TABLE_SYMBOLS = [
  "H", "He", "Li", "Be", "B", "C", "N", "O", "F", "Ne",
  "Na", "Mg", "Al", "Si", "P", "S", "Cl", "Ar", "K", "Ca",
  "Sc", "Ti", "V", "Cr", "Mn", "Fe", "Co", "Ni", "Cu", "Zn",
  "Ga", "Ge", "As", "Se", "Br", "Kr", "Rb", "Sr", "Y", "Zr",
  "Nb", "Mo", "Tc", "Ru", "Rh", "Pd", "Ag", "Cd", "In", "Sn",
  "Sb", "Te", "I",
];
const symbolForProtonCount = (n) => PERIODIC_TABLE_SYMBOLS[n - 1];
// Hydrogen — one proton — is the unit. Its own height is set once
// (rendering minimum, not artistic: a single proton particle, radius
// PROTON_PARTICLE_RADIUS below, would clip through the ground if it rose
// any less than that radius plus a little clearance), and every other
// atom's height is just that same unit multiplied by its own proton count —
// no separate max/normalization, H directly defines what one proton is
// worth for all of them.
const H_UNIT_HEIGHT = 10; // PROTON_PARTICLE_RADIUS (1.6) + clearance — hydrogen's own height, and one proton's worth for everyone else
const archHeightForAtom = (atomicNumber) => atomicNumber * H_UNIT_HEIGHT;
const MAX_ATOMIC_NUMBER = Math.max(...BODY_ATOMS.map((atom) => atom.atomicNumber));

// App.js's `climbProgress` (passed in as `progress`) is 0 while the camera
// sits at the Hyle/ground stage and then climbs 0..1 evenly across the
// seven real levels (see App.js's LEVELS: Atoms, Molecules, Cell, Tissue,
// Organ, Organ System, Human) as the user scrolls — Atoms is the first of
// those seven, so this whole build-up is scoped to that first seventh: it
// starts the instant the climb begins and is fully built by the time the
// camera reaches Molecules. Hardcoded rather than imported since it's just
// "1 / (seven real levels)" — would need updating if LEVELS' count changes.
const ATOMIC_LEVEL_PROGRESS_SPAN = 1 / 7;

// Each atom finishes building at its own point within that span, in
// proportion to its own proton count — hydrogen (fewest protons) finishes
// almost immediately, iodine (the most) takes the whole span to fully form,
// since "how tall it ends up" and "how long it takes to get there" are the
// same underlying quantity: protons.
const revealFractionForAtom = (atomicNumber, progress) => {
  const atomProgressEnd = (atomicNumber / MAX_ATOMIC_NUMBER) * ATOMIC_LEVEL_PROGRESS_SPAN;
  if (atomProgressEnd <= 0) return 1;
  return Math.min(1, Math.max(0, progress / atomProgressEnd));
};

// The atom itself doesn't sit fixed at the arch's peak throughout — it
// travels along the rising half of the curve as it builds, starting at
// t=0 (the arch's own left edge, height 0, same place the flat thread
// hands off into the rise) and arriving at t=0.5 (dead center, the peak)
// exactly when fully formed. Same sin(pi*t) curve the dome tube itself
// uses, just swept only across its first half.
const markerTForFraction = (f) => f * 0.5;

// The curved section is its own separate mesh/material from the flat
// thread either side of it — same color and same fabric (matches this
// project's convention of telling parts apart by brightness, not a
// different material), just a much higher emissive intensity, so the
// raised part visibly glows against the dim flat thread it rises out of.
const FLAT_EMISSIVE_INTENSITY = 0.28;
const GLOW_EMISSIVE_INTENSITY = 1.4;

// Right at the atom's current position on the rising thread, its own node
// carries a cluster of small proton particles, one per proton, built up one
// at a time as the atom forms (see revealFractionForAtom above) rather than
// appearing all at once. The cluster's own radius isn't picked per atom —
// it comes straight from how many spheres of PROTON_PARTICLE_RADIUS are
// actually in it right now, sized so neighboring protons sit touching
// (hugging) rather than adrift in a loosely-scaled shell: the Fibonacci-
// sphere lattice's own nearest-neighbor spacing is ~3.6/sqrt(n) radians, so
// solving for the radius that turns that spacing into two touching
// particles (chord length = 2 * PROTON_PARTICLE_RADIUS) gives a radius
// proportional to sqrt(n) — the same packing math real nucleon clusters
// follow, not an arbitrary linear-with-protons guess.
const PROTON_PARTICLE_RADIUS = 1.6; // each individual proton in the cluster
const PROTON_PACKING_CONSTANT = 2 / 3.6;
const protonClusterRadius = (visibleProtons) =>
  visibleProtons <= 1 ? 0 : PROTON_PACKING_CONSTANT * PROTON_PARTICLE_RADIUS * Math.sqrt(visibleProtons);
const ATOM_COLOR = "#ffb74d";
// Emissive is unlit self-glow — added uniformly no matter which way a
// surface faces, so it ignores the directional light entirely. A thin tube
// barely shows that (little of its curved surface is visible from any one
// angle), but a solid sphere at the thread's own GLOW_EMISSIVE_INTENSITY
// washes out completely flat, no matter how it's lit. Much lower here so
// the directional light's highlight/shadow actually shows through.
const NODE_EMISSIVE_INTENSITY = 0.3;

// A cover drapes over the whole atomic level — one continuous surface
// spanning every raised row (lateral) and each row's own rise from ground
// up to its own peak (along), so it's a compliant sheet rather than a flat
// lid: it always mimics the terrain laterally, folding down low over
// hydrogen and rising all the way up over iodine, the tallest — every atom
// touches it at its own true height, never a single shared one. What
// changes once every atom has finished (see atomicLevelComplete below) is
// only the along-axis shape of each row's own strip: instead of curving
// back down past the midline the way the dome/thread itself does, it holds
// level at that atom's own peak height from the midline onward — the
// "far" half of the cover reads as horizontal once nothing is left to form
// — and is colored differently too, in the app's own established Molecule
// color (see App.js's LEVELS), since a flat, settled surface past the
// midline is what actually resembles the molecular level, not the still-
// folded atomic terrain on the near side.
const COVER_ALONG_SAMPLES = 40; // resolution along each row's own rise — kept even so the midline lands exactly on a sample
const MOLECULE_COLOR = "#7e57c2";
const COVER_OPACITY = 0.3;
const COVER_EMISSIVE_INTENSITY = 0.25; // low, same reasoning as NODE_EMISSIVE_INTENSITY — let directional shading show the folds

// Each node's element symbol, drawn onto a small canvas and used as a
// sprite texture — sprites always face the camera, so the label stays
// legible from any angle without tracking the camera by hand.
const LABEL_CANVAS_SIZE = 128;
const LABEL_WORLD_SIZE = 22;
const LABEL_CLEARANCE = 12; // added to that atom's own node radius, so the label clears whatever size the node actually is

// A dashed vertical line drops straight from each node down to the ground
// directly beneath it — a plain, literal indicator of how far that atom's
// proton count lifted it — with the proton count itself labeled at the
// line's own midpoint.
const PROTON_LINE_DASH_SIZE = 4;
const PROTON_LINE_GAP_SIZE = 3;

// Electrons — a neutral atom has exactly as many as it has protons, but
// they're not another number to read off a line: a small shell of dots
// orbiting the node itself, distinct from the proton indicator both in
// where it sits and in color (cool blue against the proton line's amber).
const ELECTRON_RADIUS = 1.2;
const ELECTRON_ORBIT_CLEARANCE = 6; // added to that atom's own node radius
const ELECTRON_COLOR = "#64b5f6";

// Evenly spreads `count` points across a unit sphere (the standard
// Fibonacci-sphere construction) — used so each atom's electron shell reads
// as a real 3D cloud around its node from any camera angle, not a flat ring
// that vanishes edge-on.
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const fibonacciSpherePoint = (index, count) => {
  if (count <= 1) return new THREE.Vector3(0, 1, 0);
  const y = 1 - (index / (count - 1)) * 2; // 1..-1
  const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = GOLDEN_ANGLE * index;
  return new THREE.Vector3(Math.cos(theta) * radiusAtY, y, Math.sin(theta) * radiusAtY);
};

const createLabelSprite = (text) => {
  const canvas = document.createElement("canvas");
  canvas.width = LABEL_CANVAS_SIZE;
  canvas.height = LABEL_CANVAS_SIZE;
  const ctx = canvas.getContext("2d");
  // Same system-UI stack Portfolio.jsx already uses elsewhere in the app —
  // a real font choice rather than the generic "sans-serif" fallback,
  // still native (no webfont to load onto a canvas mid-render).
  ctx.font = '700 64px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff8ec";
  ctx.fillText(text, LABEL_CANVAS_SIZE / 2, LABEL_CANVAS_SIZE / 2 + 4);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(LABEL_WORLD_SIZE, LABEL_WORLD_SIZE, 1);
  return sprite;
};

const buildGroundThread = (progress) => {
  const group = new THREE.Group();

  const makeMaterial = (color, emissiveIntensity) => new THREE.MeshStandardMaterial({
    color,
    emissive: new THREE.Color(color),
    emissiveIntensity,
    roughness: 0.5,
    metalness: 0.05,
  });
  const flatMaterial = makeMaterial(THREAD_COLOR, FLAT_EMISSIVE_INTENSITY);
  const glowMaterial = makeMaterial(THREAD_COLOR, GLOW_EMISSIVE_INTENSITY);
  const protonMaterial = makeMaterial(ATOM_COLOR, NODE_EMISSIVE_INTENSITY);
  const protonGeometry = new THREE.SphereGeometry(PROTON_PARTICLE_RADIUS, 8, 8);
  const electronMaterial = makeMaterial(ELECTRON_COLOR, NODE_EMISSIVE_INTENSITY);
  const electronGeometry = new THREE.SphereGeometry(ELECTRON_RADIUS, 8, 8);
  const moleculeThreadMaterial = makeMaterial(MOLECULE_COLOR, GLOW_EMISSIVE_INTENSITY);
  const makeCoverMaterial = (color) => new THREE.MeshStandardMaterial({
    color,
    emissive: new THREE.Color(color),
    emissiveIntensity: COVER_EMISSIVE_INTENSITY,
    roughness: 0.6,
    metalness: 0.05,
    transparent: true,
    opacity: COVER_OPACITY,
    side: THREE.DoubleSide, // folds mean the camera can end up looking at either face
  });
  const coverMaterial = makeCoverMaterial(ATOM_COLOR); // near half — still-folded atomic terrain
  const coverMoleculeMaterial = makeCoverMaterial(MOLECULE_COLOR); // far half, past the midline
  const protonLineMaterial = new THREE.LineDashedMaterial({
    color: ATOM_COLOR,
    dashSize: PROTON_LINE_DASH_SIZE,
    gapSize: PROTON_LINE_GAP_SIZE,
  });

  const addTube = (points, segments, material) => {
    const curve = new THREE.CatmullRomCurve3(points);
    const geometry = new THREE.TubeGeometry(curve, segments, THREAD_RADIUS, 6, false);
    group.add(new THREE.Mesh(geometry, material));
  };

  const rowStep = ROW_COUNT > 1 ? (FIELD_HALF_WIDTH * 2) / (ROW_COUNT - 1) : 0;
  // One row per atom, consecutive and centered in the field — the cluster
  // of rises reads as a single group (the atoms the body is built from),
  // not scattered arbitrarily across the whole thread. Arranged as a bell:
  // the heaviest atom dead center, the next two heaviest immediately either
  // side of it, and so on outward, so the lightest atoms land at the two
  // outer edges of the cluster and the whole row of rises reads as one
  // symmetric bell curve rather than a scattered or strictly sorted line.
  const raisedRowStart = Math.floor(ROW_COUNT / 2) - Math.floor(BODY_ATOMS.length / 2);
  const bellOrder = new Array(BODY_ATOMS.length);
  const sortedDesc = [...BODY_ATOMS].sort((a, b) => b.atomicNumber - a.atomicNumber);
  const center = Math.floor(BODY_ATOMS.length / 2);
  let left = center;
  let right = center;
  sortedDesc.forEach((atom, i) => {
    if (i === 0) {
      bellOrder[center] = atom;
    } else if (i % 2 === 1) {
      left -= 1;
      bellOrder[left] = atom;
    } else {
      right += 1;
      bellOrder[right] = atom;
    }
  });
  const atomForRow = new Map(bellOrder.map((atom, i) => [raisedRowStart + i, atom]));
  const coverProfile = []; // {lateral, archHeight} per raised row, in lateral order — what the cover drapes over
  // Iodine (the heaviest atom here) takes the whole climb to finish, so its
  // own completion IS the atomic level's completion — once it's done, every
  // atom has satisfied its identity. See the cover-building section below
  // for what that changes.
  const atomicLevelComplete = revealFractionForAtom(MAX_ATOMIC_NUMBER, progress) >= 1;

  // Pre-pass: each raised row's current build state (how tall it's risen,
  // how many of its protons have formed so far), computed up front so the
  // proton/electron instanced meshes below can be sized exactly — no
  // slack, no unused instances to hide.
  const rowState = new Map();
  let totalVisibleProtons = 0;
  let maxActiveHeight = 0; // tallest any atom has actually risen to so far — drives the camera's own framing, see the component below
  for (const [r, atom] of atomForRow) {
    const f = revealFractionForAtom(atom.atomicNumber, progress);
    // No floor — at f=0 (t=0) the atom hasn't started forming yet, so
    // zero protons and zero electrons exist, not even one. They accumulate
    // one at a time from nothing as f climbs toward 1.
    const visibleProtons = Math.round(f * atom.atomicNumber);
    const archHeight = archHeightForAtom(atom.atomicNumber) * f;
    rowState.set(r, { atom, archHeight, visibleProtons, f });
    totalVisibleProtons += visibleProtons;
    maxActiveHeight = Math.max(maxActiveHeight, archHeight);
  }
  // One shared instanced mesh each for every proton and every electron
  // currently visible across every atom — far cheaper than a separate mesh
  // per particle when the total runs into the hundreds. Electrons form
  // 1-for-1 with protons (neutral atoms), so the two totals match.
  const protonMesh = new THREE.InstancedMesh(protonGeometry, protonMaterial, totalVisibleProtons);
  const electronMesh = new THREE.InstancedMesh(electronGeometry, electronMaterial, totalVisibleProtons);
  let particleInstanceIndex = 0;

  for (let r = 0; r < ROW_COUNT; r++) {
    const lateral = -FIELD_HALF_WIDTH + r * rowStep;
    const forward = r % 2 === 0; // alternating direction each pass — what makes it one continuous back-and-forth thread
    // Only the very first row's own start and the very last row's own end
    // are true open ends of the whole thread — those reach OUTER_HALF_LENGTH,
    // hidden far away. Every other row boundary is an internal turn,
    // reaching only INNER_HALF_LENGTH — close enough to actually see.
    const startLength = r === 0 ? OUTER_HALF_LENGTH : INNER_HALF_LENGTH;
    const endLength = r === ROW_COUNT - 1 ? OUTER_HALF_LENGTH : INNER_HALF_LENGTH;
    const startAlong = forward ? -startLength : startLength;
    const endAlong = forward ? endLength : -endLength;

    if (!atomForRow.has(r)) {
      addTube([point(startAlong, lateral), point(endAlong, lateral)], 2, flatMaterial);
    } else {
      const { atom, archHeight, visibleProtons, f } = rowState.get(r); // this row's own unique rise, right now
      // Built in a fixed increasing-along order (-ARCH_SPAN to +ARCH_SPAN),
      // then reversed for a backward pass — the curve's own shape doesn't
      // care which direction it's traversed in, only the connecting flat
      // legs on either side do, which have to enter/exit whichever edge of
      // the dome the row's own travel direction actually reaches first.
      const domeEntry = forward ? -ARCH_SPAN : MOLECULE_SPAN;
      const domeExit = forward ? MOLECULE_SPAN : -ARCH_SPAN;
      addTube([point(startAlong, lateral), point(domeEntry, lateral)], 2, flatMaterial);

      const domeHeightAt = (t) => Math.sin(Math.PI * t) * archHeight;
      if (f < 1) {
        // Still forming — the whole rise stays one continuous solid tube,
        // same as ever, since there's no "used path" to deteriorate yet.
        const domePoints = [];
        for (let s = 0; s <= ARCH_SAMPLES; s++) {
          const t = s / ARCH_SAMPLES;
          domePoints.push(point(alongForT(t), lateral, domeHeightAt(t)));
        }
        if (!forward) domePoints.reverse();
        addTube(domePoints, ARCH_SAMPLES, glowMaterial);
      } else {
        // Fully formed, reached the midline — the left half (the path it
        // took to get there) stays a single unbroken tube. The right half
        // (past the midline, ahead of the atom) is what deteriorates into
        // a broken, dashed trail instead of staying solid.
        const mid = Math.floor(ARCH_SAMPLES / 2);
        const leftPoints = [];
        for (let s = 0; s <= mid; s++) {
          const t = s / ARCH_SAMPLES;
          leftPoints.push(point(alongForT(t), lateral, domeHeightAt(t)));
        }
        addTube(leftPoints, mid, glowMaterial);

        const DASH_COUNT = 14;
        const DASH_DUTY_CYCLE = 0.55; // fraction of each dash-gap cycle actually drawn
        const DASH_SAMPLES_PER_DASH = 4;
        const dashCycleLength = 0.5 / DASH_COUNT;
        for (let i = 0; i < DASH_COUNT; i++) {
          const tStart = 0.5 + i * dashCycleLength;
          const tEnd = tStart + dashCycleLength * DASH_DUTY_CYCLE;
          const dashPoints = [];
          for (let d = 0; d <= DASH_SAMPLES_PER_DASH; d++) {
            const t = tStart + (tEnd - tStart) * (d / DASH_SAMPLES_PER_DASH);
            dashPoints.push(point(alongForT(t), lateral, domeHeightAt(t)));
          }
          addTube(dashPoints, DASH_SAMPLES_PER_DASH, glowMaterial);
        }
      }

      // Where the atom itself currently sits on that same curve — at t=0
      // (the left edge, height 0) when f=0, sweeping up to t=0.5 (dead
      // center, the peak) exactly when fully formed at f=1.
      const markerT = markerTForFraction(f);
      const atomAlong = alongForT(markerT); // markerT never exceeds 0.5, so this always resolves via the near-side branch
      const atomHeight = Math.sin(Math.PI * markerT) * archHeight;
      const atomPoint = point(atomAlong, lateral, atomHeight);

      // Once formed, the atom grows a thread of its own out into the
      // molecular area — the start of a bond reaching toward where a
      // molecule will form — running flat at the atom's own height,
      // matching the plane it's extending into, out to where that plane
      // itself ends.
      if (f >= 1) {
        addTube([atomPoint, point(MOLECULE_SPAN, lateral, archHeight)], 2, moleculeThreadMaterial);
      }

      const clusterRadius = protonClusterRadius(visibleProtons);
      const electronOrbitRadius = clusterRadius + ELECTRON_ORBIT_CLEARANCE;
      for (let p = 0; p < visibleProtons; p++) {
        const dir = fibonacciSpherePoint(p, visibleProtons);
        const protonPosition = atomPoint.clone().addScaledVector(dir, clusterRadius);
        protonMesh.setMatrixAt(particleInstanceIndex, new THREE.Matrix4().setPosition(protonPosition));
        const electronPosition = atomPoint.clone().addScaledVector(dir, electronOrbitRadius);
        electronMesh.setMatrixAt(particleInstanceIndex, new THREE.Matrix4().setPosition(electronPosition));
        particleInstanceIndex++;
      }
      coverProfile.push({ lateral, archHeight });

      // Nothing to label before the first proton exists — at t=0 there's no
      // atom yet, just the bare thread. Once one forms, its label tracks
      // whatever element its CURRENT proton count actually is (1 -> H,
      // 2 -> He, ...), not its final target, so it visibly steps through
      // the periodic table as it builds.
      if (visibleProtons > 0) {
        const label = createLabelSprite(symbolForProtonCount(visibleProtons));
        label.position.copy(atomPoint);
        label.position.y += clusterRadius + LABEL_CLEARANCE;
        group.add(label);

        // Straight down from the atom to the ground directly below wherever
        // it currently is — a literal, unadorned measure of its own rise,
        // with its proton count labeled right at the midpoint. Labeled with
        // however many protons have formed so far, not the final count — it
        // grows right along with the cluster.
        const groundBelowAtom = point(atomAlong, lateral, 0);
        const protonLineGeometry = new THREE.BufferGeometry().setFromPoints([groundBelowAtom, atomPoint]);
        const protonLine = new THREE.Line(protonLineGeometry, protonLineMaterial);
        protonLine.computeLineDistances(); // required for the dash pattern to render
        group.add(protonLine);

        const protonCountLabel = createLabelSprite(String(visibleProtons));
        protonCountLabel.position.copy(groundBelowAtom);
        protonCountLabel.position.y = (groundBelowAtom.y + atomPoint.y) / 2;
        group.add(protonCountLabel);
      }

      addTube([point(domeExit, lateral), point(endAlong, lateral)], 2, flatMaterial);
    }

    // The turn — a short connector from the end of this pass to the start
    // of the next, at the next row's lateral position. Same flat material;
    // this is still the same one continuous thread, just changing rows.
    if (r < ROW_COUNT - 1) {
      const nextLateral = -FIELD_HALF_WIDTH + (r + 1) * rowStep;
      addTube([point(endAlong, lateral), point(endAlong, nextLateral)], 2, flatMaterial);
    }
  }

  protonMesh.instanceMatrix.needsUpdate = true;
  electronMesh.instanceMatrix.needsUpdate = true;
  group.add(protonMesh);
  group.add(electronMesh);

  if (coverProfile.length >= 2) {
    // A grid: one column per raised row (lateral), each column sampled
    // along that row's own rise (same sin(pi*t) shape the thread itself
    // uses, scaled by that row's own archHeight) — so the surface is
    // exactly the same terrain the nodes sit on, not a flat approximation
    // of it. Neighboring columns can differ wildly in height (protons vary
    // a lot across this set), which is what makes it fold rather than lie
    // flat laterally: it has no choice but to follow each column's own
    // peak. Along each column's own strip, the near half (t<=0.5, up to
    // the midline) always follows that same rising curve — but once the
    // atomic level is complete, the far half (t>0.5) stops curving back
    // down and holds level at that column's own peak height instead, so
    // the "after the midline" side reads as horizontal.
    const columns = coverProfile.length;
    const coverMid = COVER_ALONG_SAMPLES / 2; // exact — COVER_ALONG_SAMPLES is kept even

    // Built as two separate strips (near half / far half) rather than one,
    // purely so each half can carry its own material/color — the near
    // strip's own last column of vertices and the far strip's own first
    // column land on the exact same points (both sample ai=coverMid), so
    // the seam between the two colors is geometrically seamless even
    // though they're two different meshes.
    const buildCoverStrip = (aiStart, aiEnd, material) => {
      const positions = [];
      for (let ci = 0; ci < columns; ci++) {
        const { lateral, archHeight } = coverProfile[ci];
        for (let ai = aiStart; ai <= aiEnd; ai++) {
          const t = ai / COVER_ALONG_SAMPLES;
          const height = atomicLevelComplete && t > 0.5 ? archHeight : Math.sin(Math.PI * t) * archHeight;
          const p = point(alongForT(t), lateral, height);
          positions.push(p.x, p.y, p.z);
        }
      }

      const stripSamples = aiEnd - aiStart;
      const rowLength = stripSamples + 1;
      const indices = [];
      for (let ci = 0; ci < columns - 1; ci++) {
        for (let ai = 0; ai < stripSamples; ai++) {
          const a = ci * rowLength + ai;
          const b = (ci + 1) * rowLength + ai;
          const c = (ci + 1) * rowLength + ai + 1;
          const d = ci * rowLength + ai + 1;
          indices.push(a, b, d, b, c, d);
        }
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      group.add(new THREE.Mesh(geometry, material));
    };

    buildCoverStrip(0, coverMid, coverMaterial);
    buildCoverStrip(coverMid, COVER_ALONG_SAMPLES, coverMoleculeMaterial);
  }

  return { group, maxActiveHeight };
};

// Sprite.geometry is a single plane geometry three.js shares across every
// Sprite in the whole app (a module-level singleton) — only dispose it for
// real meshes/lines (each with their own geometry), or disposing a group
// would free GPU buffers any other sprite elsewhere still depends on.
const disposeGroundThread = (group) => {
  group.traverse((obj) => {
    if (obj.isMesh || obj.isLine) obj.geometry.dispose();
    if (obj.isSprite) obj.material.map?.dispose();
    if (obj.material) obj.material.dispose();
  });
};

// The camera's two framing endpoints — nothing grown yet (a tight
// close-up on the bare ground where the first atom will appear) and the
// tallest atom fully formed (the original wide establishing shot, pulled
// back and raised enough to take in many rows of the zigzag at once).
// Growth is lerped between them by however tall the tallest active atom
// actually is right now (see the progress effect below).
const FULL_ATOMIC_HEIGHT = archHeightForAtom(MAX_ATOMIC_NUMBER);
const CAMERA_WIDE_FOCUS = new THREE.Vector3(0, 20, 0);
const CAMERA_WIDE_POSITION = new THREE.Vector3(120, 340, 520);
const CAMERA_WIDE_DISTANCE = CAMERA_WIDE_POSITION.distanceTo(CAMERA_WIDE_FOCUS);
// The ground field is wide and dense (FIELD_HALF_WIDTH=1000, rows spaced
// ~51 apart, each running 320 deep) — a close distance picked without that
// in mind put the camera right up against, or inside, nearby thread
// geometry instead of just "close to the atoms." Pulled back generously
// (comparable to the field's own half-width) so it clears that field
// regardless of which row ends up nearest the camera — still a
// meaningfully tighter shot than CAMERA_WIDE below, just not so tight it
// risks sitting inside the scene.
const CAMERA_CLOSE_FOCUS = new THREE.Vector3(0, 40, 0);
const CAMERA_CLOSE_DISTANCE = 950;

const ThreadPyramidLogo = ({ progress = 1 }) => {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);
  const groundThreadRef = useRef(null);

  // Mount-only: renderer, camera, lights, controls — everything that
  // doesn't need to change as the user scrolls. Kept separate from the
  // ground-thread build below so scrolling (which changes `progress`
  // continuously) never tears down and recreates the renderer/controls,
  // just the geometry that actually depends on how far the atoms have
  // built up.
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
    const camera = new THREE.PerspectiveCamera(45, mount.clientWidth / mount.clientHeight, 1, 4000);
    cameraRef.current = camera;

    // Starting shot before the progress effect below gets a chance to
    // frame things properly — the wide establishing shot, pulled back and
    // raised enough to take in many rows of the zigzag at once, since that
    // repetition is what actually reads as "goes back and forth."
    const focus = CAMERA_WIDE_FOCUS.clone();
    camera.position.copy(CAMERA_WIDE_POSITION);
    camera.lookAt(focus);

    // Ambient only, plus one soft directional light. No point lights with a
    // finite falloff distance (those create a literal lit/unlit circle
    // wherever their falloff sphere meets the ground) — a directional light
    // has no falloff distance at all, so it's safe from that bug, and it's
    // what the node spheres actually need: under ambient alone every
    // surface gets the same flat brightness regardless of its normal, so a
    // sphere reads as a flat dot instead of a lit, curved ball. The flat
    // thread stays effectively unchanged (self-emissive, thin enough that
    // shading barely registers on it); the spheres are what pick this up.
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
    controls.enableZoom = true; // minDistance/maxDistance deliberately left at OrbitControls' own defaults (0/Infinity) — no zoom limit either way
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
    const animate = () => {
      raf = requestAnimationFrame(animate);
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

  // Rebuilds just the ground-thread group whenever `progress` changes —
  // the renderer/camera/controls above are untouched, so this is cheap
  // enough to run on every scroll-driven progress update. Also reframes
  // the camera so the currently-active scene — however tall it's grown so
  // far — stays in view: the user's own rotation (the camera's direction
  // relative to its target) is preserved, only the distance and the
  // target's own height are adjusted, so this never fights a drag/orbit
  // already in progress, it just keeps pace with growth.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    // React runs this effect's own cleanup (below) before re-running it on
    // the next `progress` change, so the previous group is already removed
    // and disposed by the time this line runs — nothing to guard against.
    const { group: groundThread, maxActiveHeight } = buildGroundThread(progress);
    scene.add(groundThread);
    groundThreadRef.current = groundThread;

    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (camera && controls) {
      // Lerped between a tight close-up (nothing grown yet) and the
      // original wide establishing shot (the tallest atom fully formed) —
      // matches CAMERA_WIDE_POSITION/CAMERA_WIDE_FOCUS exactly at growth=1,
      // so the very first frame (mount, before anything's built) and the
      // fully-grown state both land on the same shot they always have.
      const growth = Math.min(1, maxActiveHeight / FULL_ATOMIC_HEIGHT);
      const targetHeight = THREE.MathUtils.lerp(CAMERA_CLOSE_FOCUS.y, CAMERA_WIDE_FOCUS.y, growth);
      const distance = THREE.MathUtils.lerp(CAMERA_CLOSE_DISTANCE, CAMERA_WIDE_DISTANCE, growth);

      const direction = camera.position.clone().sub(controls.target).normalize();
      const newTarget = new THREE.Vector3(controls.target.x, targetHeight, controls.target.z);
      camera.position.copy(newTarget).addScaledVector(direction, distance);
      controls.target.copy(newTarget);
    }

    return () => {
      scene.remove(groundThread);
      disposeGroundThread(groundThread);
      groundThreadRef.current = null;
    };
  }, [progress]);

  return <div ref={mountRef} id="thread_logo_canvas" />;
};

export default ThreadPyramidLogo;
