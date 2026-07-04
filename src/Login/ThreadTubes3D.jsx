import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// Stage coordinate space (must match the 900x900 login_stage used elsewhere
// in Login.jsx — orbit dot positions, canvas, etc. are all in these units).
const STAGE_PX = 900;

// A stack of flat, forward-facing rings (each a torus lying in the XY plane,
// so it faces the camera like the original CSS circle) placed along Z. This
// is the actual technique that makes "flat circle at rest, tube on tilt"
// work — a true cylindrical wall surface is edge-on (invisible) when viewed
// straight down its own axis, but a stack of flat rings isn't. Built as ONE
// merged BufferGeometry so it's a single draw call no matter the ring count.
function buildRingStackGeometry({ radius, tubeThickness, ringCount, depthHalfRange, radialSeg = 10, tubularSeg = 64 }) {
  const geoms = [];
  for (let i = 0; i < ringCount; i++) {
    const t = ringCount === 1 ? 0 : (i / (ringCount - 1)) * 2 - 1; // -1..1
    const z = t * depthHalfRange;
    const fade = 1 - Math.abs(t); // 1 at center, 0 at the tips
    const g = new THREE.TorusGeometry(radius, tubeThickness / 2, radialSeg, tubularSeg);
    g.translate(0, 0, z);
    const count = g.attributes.position.count;
    const alpha = new Float32Array(count).fill(fade);
    g.setAttribute("aFade", new THREE.BufferAttribute(alpha, 1));
    geoms.push(g);
  }
  return mergeGeometries(geoms);
}

// Same idea but SOLID filled discs (not hollow rings) — used for the small
// orbit-dot "rope" threads, which were explicitly asked to look solid.
function buildDiscStackGeometry({ radius, discCount, depthHalfRange, radialSeg = 24 }) {
  const geoms = [];
  for (let i = 0; i < discCount; i++) {
    const t = discCount === 1 ? 0 : (i / (discCount - 1)) * 2 - 1;
    const z = t * depthHalfRange;
    const fade = 1 - Math.abs(t);
    const g = new THREE.CircleGeometry(radius, radialSeg);
    g.translate(0, 0, z);
    const count = g.attributes.position.count;
    const alpha = new Float32Array(count).fill(fade);
    g.setAttribute("aFade", new THREE.BufferAttribute(alpha, 1));
    geoms.push(g);
  }
  return mergeGeometries(geoms);
}

// Fade is baked in as a per-vertex custom attribute (aFade) rather than
// vertex-color alpha (which standard materials don't blend the way we want
// here) — a tiny onBeforeCompile patch multiplies it into the fragment alpha.
function makeFadeMaterial(colorHex, opacity) {
  const material = new THREE.MeshBasicMaterial({
    color: colorHex,
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    depthWrite: false,
    // Normal (not additive) blending — additive summed every overlapping
    // ring/disc toward blown-out white, since dozens of them stack near the
    // center of the depth range.
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aFade;\nvarying float vFade;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvFade = aFade;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vFade;")
      .replace("gl_FragColor = vec4( outgoingLight, diffuseColor.a );", "gl_FragColor = vec4( outgoingLight, diffuseColor.a * vFade );");
  };
  return material;
}

/**
 * Renders the Patient Reality tube, the nested MCTOSHS tube, and the
 * M/C/T/O/OS/H/S orbit-dot rope threads as WebGL geometry instead of
 * hundreds of stacked DOM elements (the previous CSS approach hung the
 * page outright at higher ring counts — this renders in a handful of
 * draw calls regardless of ring density).
 *
 * tiltXYRef: ref to the same {x,y} drag values Login.jsx's CSS threadRotation
 *   used to derive rotateX/rotateY from (one-finger drag / mouse drag).
 * orbStateRef: ref to the live physics state array (orbStateRef in
 *   Login.jsx) — each entry's _x/_y (0..900 stage coords) positions that
 *   dot's rope thread every frame, same as the real orbit dot on screen.
 * orbits: MCTOSHS_ORBITS (id/color per dot, in stage-radius units).
 */
export default function ThreadTubes3D({ tiltXYRef, orbStateRef, orbits }) {
  const mountRef = useRef(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();

    // Camera: positioned far along +Z so that, at the z=0 plane, the visible
    // height equals STAGE_PX — i.e. 1 Three.js unit == 1 CSS px at rest,
    // matching the DOM stage's own 900x900 coordinate space.
    const CAM_DIST = 2000;
    const fovRad = 2 * Math.atan(STAGE_PX / 2 / CAM_DIST);
    const fovDeg = THREE.MathUtils.radToDeg(fovRad);
    const camera = new THREE.PerspectiveCamera(fovDeg, mount.clientWidth / mount.clientHeight, 10, 20000);
    camera.position.set(0, 0, CAM_DIST);
    camera.lookAt(0, 0, 0);

    // Everything shares this one rotation — the tilt gesture rotates the
    // whole "solar system" of tubes as a single rigid object, and each
    // orbit-dot thread inherits it for free via the scene graph (no risk
    // of the double-rotation / wrong-direction bugs the CSS version hit).
    const tiltGroup = new THREE.Group();
    scene.add(tiltGroup);

    const PR_R = 360; // half of the 720px Patient Reality circle
    const MS_R = 260; // half of the 520px MCTOSHS circle

    const prGeo = buildRingStackGeometry({ radius: PR_R, tubeThickness: 10, ringCount: 60, depthHalfRange: 340, radialSeg: 6, tubularSeg: 40 });
    const prMesh = new THREE.Mesh(prGeo, makeFadeMaterial(0xa06eff, 0.55));
    tiltGroup.add(prMesh);

    const msGeo = buildRingStackGeometry({ radius: MS_R, tubeThickness: 8, ringCount: 60, depthHalfRange: 250, radialSeg: 6, tubularSeg: 40 });
    const msMesh = new THREE.Mesh(msGeo, makeFadeMaterial(0x00e5ff, 0.5));
    tiltGroup.add(msMesh);

    // One small solid rope thread per orbit dot, each in its own group so
    // its live (x,y) position can be updated every frame without touching
    // its geometry/rotation — it inherits tiltGroup's rotation automatically.
    const orbGroups = orbits.map((orb) => {
      const g = new THREE.Group();
      const discGeo = buildDiscStackGeometry({ radius: 16, discCount: 12, depthHalfRange: 340, radialSeg: 14 });
      const mesh = new THREE.Mesh(discGeo, makeFadeMaterial(new THREE.Color(orb.color).getHex(), 0.85));
      g.add(mesh);
      tiltGroup.add(g);
      return g;
    });

    let raf;
    const animate = () => {
      raf = requestAnimationFrame(animate);

      // Same rx/ry the CSS side (threadRotation in Login.jsx) uses for
      // orbit_system_group/pr_thread_group — but CSS is a Y-down screen
      // coordinate system while Three.js is Y-up, so an X-axis rotation
      // (which transforms the Y/Z coordinates) comes out mirrored between
      // the two: CSS's rotateX(deg) needs rotation.x = -deg here to match.
      // Y-axis rotation only transforms X/Z, unaffected by the Y flip, so
      // ry needs no adjustment.
      const tilt = tiltXYRef.current;
      const rx = THREE.MathUtils.clamp(-tilt.tiltY * 0.4, -90, 90);
      const ry = THREE.MathUtils.clamp(tilt.tiltX * 0.4, -90, 90);
      tiltGroup.rotation.x = THREE.MathUtils.degToRad(-rx);
      tiltGroup.rotation.y = THREE.MathUtils.degToRad(ry);

      const states = orbStateRef.current;
      for (let i = 0; i < orbGroups.length; i++) {
        const s = states[i];
        if (!s) continue;
        // Stage coords are 0..900 with Y increasing downward; Three.js is
        // centered on 0 with Y increasing upward.
        orbGroups[i].position.set(s._x - STAGE_PX / 2, -(s._y - STAGE_PX / 2), 0);
      }

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
      prGeo.dispose();
      msGeo.dispose();
      prMesh.material.dispose();
      msMesh.material.dispose();
      orbGroups.forEach((g) => {
        g.children.forEach((mesh) => {
          mesh.geometry.dispose();
          mesh.material.dispose();
        });
      });
      renderer.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={mountRef}
      style={{
        // #login_center (the parent) is a zero-size passthrough anchor —
        // "inset: 0" here would collapse to 0x0 and silently break the
        // renderer (mount.clientWidth/Height === 0). Give it the same
        // explicit 900x900 footprint as #login_stage, self-centered on
        // login_center's anchor point exactly like pr_thread_wrap was.
        position: "absolute",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        width: `${STAGE_PX}px`,
        height: `${STAGE_PX}px`,
        pointerEvents: "none",
      }}
    />
  );
}
