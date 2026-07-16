import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const ORBITS = [
  { id: "m",  letter: "M", r:  48, hex: 0x00e5ff, tiltX:  15, tiltZ:   0, speed: (Math.PI*2)/(8*60)  },
  { id: "c",  letter: "C", r:  82, hex: 0x4da6ff, tiltX: -28, tiltZ:  12, speed: (Math.PI*2)/(14*60) },
  { id: "t",  letter: "T", r: 116, hex: 0xa678f5, tiltX:  35, tiltZ: -10, speed: (Math.PI*2)/(20*60) },
  { id: "o",  letter: "O", r: 150, hex: 0xffab40, tiltX: -20, tiltZ:  18, speed: (Math.PI*2)/(27*60) },
  { id: "s1", letter: "OS", r: 182, hex: 0x5cf5a0, tiltX:  28, tiltZ:  -8, speed: (Math.PI*2)/(35*60) },
  { id: "h",  letter: "H", r: 214, hex: 0xff7aa2, tiltX: -14, tiltZ:  10, speed: (Math.PI*2)/(45*60) },
  { id: "s2", letter: "S", r: 244, hex: 0xffd54f, tiltX:  18, tiltZ: -16, speed: (Math.PI*2)/(54*60) },
];

const PR_R = 370;
const MS_R = 250;

// Canvas texture: transparent bg → outer glow → colored circle → letter
function makeDotTexture(letter, hex) {
  const S = 256;
  const c = document.createElement("canvas");
  c.width = S; c.height = S;
  const ctx = c.getContext("2d");
  const col = "#" + hex.toString(16).padStart(6, "0");
  const cx = S / 2, cy = S / 2;

  // Outer halo (soft, goes transparent at edge)
  const halo = ctx.createRadialGradient(cx, cy, S * 0.18, cx, cy, S * 0.5);
  halo.addColorStop(0,   col + "88");
  halo.addColorStop(0.5, col + "30");
  halo.addColorStop(1.0, col + "00");
  ctx.beginPath();
  ctx.arc(cx, cy, S / 2, 0, Math.PI * 2);
  ctx.fillStyle = halo;
  ctx.fill();

  // Inner bright glow ring
  const inner = ctx.createRadialGradient(cx, cy, 0, cx, cy, S * 0.30);
  inner.addColorStop(0,   "#ffffffcc");
  inner.addColorStop(0.4, col + "ee");
  inner.addColorStop(1.0, col + "00");
  ctx.beginPath();
  ctx.arc(cx, cy, S * 0.30, 0, Math.PI * 2);
  ctx.fillStyle = inner;
  ctx.fill();

  // Solid core circle
  ctx.beginPath();
  ctx.arc(cx, cy, S * 0.17, 0, Math.PI * 2);
  ctx.fillStyle = col;
  ctx.fill();

  // Letter
  ctx.font = `900 ${Math.floor(S * 0.165)}px "Courier New", monospace`;
  ctx.fillStyle = "#030a14";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(letter, cx, cy + 2);

  return new THREE.CanvasTexture(c);
}

function buildStars(n, rMin, rMax) {
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = rMin + Math.random() * (rMax - rMin);
    const theta = Math.random() * Math.PI * 2;
    const phi   = Math.acos(2 * Math.random() - 1);
    pos[i*3]   = r * Math.sin(phi) * Math.cos(theta);
    pos[i*3+1] = r * Math.sin(phi) * Math.sin(theta);
    pos[i*3+2] = r * Math.cos(phi);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(geo, new THREE.PointsMaterial({
    color: 0xffffff,
    size: 1.8,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }));
}

function buildOrbitLine(r, color) {
  const N = 256;
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
  }
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  return new THREE.Line(geo, new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0.35,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }));
}

function buildGlass(r, specColor, opacity, side = THREE.FrontSide) {
  return new THREE.Mesh(
    new THREE.SphereGeometry(r, 64, 64),
    new THREE.MeshPhongMaterial({
      color: 0x000814,
      specular: specColor,
      shininess: 190,
      transparent: true,
      opacity,
      side,
      depthWrite: false,
    })
  );
}

function buildRimGlow(r, color, opacity, side = THREE.BackSide) {
  return new THREE.Mesh(
    new THREE.SphereGeometry(r, 64, 64),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      side,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
}

export default function LoginAnim() {
  const mountRef = useRef(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    // ── Renderer ─────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);

    // ── Scene & Camera ────────────────────────────────────────────
    const scene  = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(44, mount.clientWidth / mount.clientHeight, 1, 8000);
    camera.position.set(0, 110, 860);
    camera.lookAt(0, 0, 0);

    // ── Lights ───────────────────────────────────────────────────
    scene.add(new THREE.AmbientLight(0x0d1b2e, 4));
    const key = new THREE.PointLight(0x4fc3f7, 200, 2600);
    key.position.set(350, 450, 600);
    scene.add(key);
    const rim = new THREE.PointLight(0x00e5ff, 80, 2000);
    rim.position.set(-400, -300, -500);
    scene.add(rim);
    const fill = new THREE.PointLight(0x7040d0, 45, 2000);
    fill.position.set(0, 350, -420);
    scene.add(fill);

    // ── Starfield ─────────────────────────────────────────────────
    scene.add(buildStars(550, PR_R * 0.85, PR_R * 1.5));

    // ── Patient Reality sphere ────────────────────────────────────
    scene.add(buildGlass(PR_R, 0x4fc3f7, 0.06));
    scene.add(buildRimGlow(PR_R + 3, 0x1a6080, 0.18));

    // ── AMCTOSHS sphere ────────────────────────────────────────────
    scene.add(buildGlass(MS_R, 0x00e5ff, 0.09, THREE.DoubleSide));
    scene.add(buildRimGlow(MS_R - 1, 0x00e5ff, 0.24));

    // ── 7 Orbital rings + glowing letter dots ─────────────────────
    const orbitItems = [];

    ORBITS.forEach(orb => {
      const color = new THREE.Color(orb.hex);

      const group = new THREE.Group();
      group.rotation.x = THREE.MathUtils.degToRad(orb.tiltX);
      group.rotation.z = THREE.MathUtils.degToRad(orb.tiltZ);
      scene.add(group);

      group.add(buildOrbitLine(orb.r, color));

      const tex    = makeDotTexture(orb.letter, orb.hex);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
      }));
      sprite.scale.set(88, 88, 1);
      group.add(sprite);

      orbitItems.push({
        id:    orb.id,
        sprite,
        r:     orb.r,
        speed: orb.speed,
        angle: Math.random() * Math.PI * 2,
      });
    });

    // ── OrbitControls ─────────────────────────────────────────────
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping   = true;
    controls.dampingFactor   = 0.06;
    controls.enableZoom      = false;
    controls.enablePan       = false;
    controls.autoRotate      = true;
    controls.autoRotateSpeed = 0.4;
    controls.minPolarAngle   = Math.PI * 0.15;
    controls.maxPolarAngle   = Math.PI * 0.85;

    // ── Animation loop ────────────────────────────────────────────
    let raf;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      orbitItems.forEach(item => {
        item.angle += item.speed;
        item.sprite.position.x = Math.cos(item.angle) * item.r;
        item.sprite.position.z = Math.sin(item.angle) * item.r;
      });
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // ── Resize ────────────────────────────────────────────────────
    const ro = new ResizeObserver(() => {
      const w = mount.clientWidth, h = mount.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    ro.observe(mount);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <div
      ref={mountRef}
      style={{ width: "100%", height: "100%", flex: 1, minHeight: 0, cursor: "grab" }}
    />
  );
}
