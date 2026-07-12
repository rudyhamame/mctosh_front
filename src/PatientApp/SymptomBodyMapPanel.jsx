import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { apiUrl } from "../config/api";
import { readStoredPatientSession } from "../utils/patientSessionCleanup";

const assetUrl = (path) => `${import.meta.env.BASE_URL}${path.replace(/^\//, "")}`;
const MODEL_URLS = [
  assetUrl("models/Female Anatomy/female_anatomy.glb"),
  assetUrl("models/Female  Anatomy/female_anatomy.glb"),
];
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const DISTRIBUTION_OPTIONS = ["Localized", "Diffuse", "Radiating", "Widespread"];

const authHeaders = () => {
  const token = readStoredPatientSession()?.token || "";
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
};

const buildSummaryText = (payload) => {
  const parts = (payload.annotations || []).map((annotation, index) =>
    `${index + 1}. ${annotation.regionLabel} (${annotation.distribution}, intensity ${annotation.intensity}/10)`
  );
  return [
    payload.symptomLabel ? `Body map saved for ${payload.symptomLabel}.` : "Body map saved.",
    parts.length ? `Marked regions: ${parts.join(" ")}` : "",
  ].filter(Boolean).join(" ");
};

export default function SymptomBodyMapPanel({ request, language = "en", onClose, onSaved }) {
  const mountRef = useRef(null);
  const annotationsRef = useRef([]);
  const formStateRef = useRef({ intensity: 5, distribution: DISTRIBUTION_OPTIONS[0], notes: "" });
  const markerGroupRef = useRef(null);
  const redrawMarkersRef = useRef(() => {});
  const [selectedRegion, setSelectedRegion] = useState("");
  const [intensity, setIntensity] = useState(5);
  const [distribution, setDistribution] = useState(DISTRIBUTION_OPTIONS[0]);
  const [notes, setNotes] = useState("");
  const [annotations, setAnnotations] = useState([]);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    annotationsRef.current = annotations;
  }, [annotations]);

  useEffect(() => {
    formStateRef.current = { intensity, distribution, notes };
  }, [distribution, intensity, notes]);

  useEffect(() => {
    setSelectedRegion("");
    setIntensity(5);
    setDistribution(DISTRIBUTION_OPTIONS[0]);
    setNotes("");
    setAnnotations([]);
    setReady(false);
    setSaving(false);
    setError("");
  }, [request]);

  useEffect(() => {
    redrawMarkersRef.current();
  }, [annotations]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 100);
    camera.position.set(0, 0, 7.3);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    const modelGroup = new THREE.Group();
    const markerGroup = new THREE.Group();
    markerGroupRef.current = markerGroup;
    scene.add(modelGroup);
    scene.add(markerGroup);

    scene.add(new THREE.HemisphereLight(0xfefcff, 0x162430, 1.5));
    const key = new THREE.DirectionalLight(0xfff1dc, 1.7);
    key.position.set(2.5, 3.5, 5);
    scene.add(key);
    const fill = new THREE.PointLight(0x71f0ff, 11, 20, 2);
    fill.position.set(-2.5, 1.4, 3.4);
    scene.add(fill);

    const rotation = { x: -0.08, y: 0.25 };
    let modelScale = 1;
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const touchPoints = new Map();
    let pinchStartDistance = null;
    let pinchStartScale = 1;
    let dragging = false;
    let startPointer = null;
    let lastPointer = null;
    let baseCameraDistance = 7.3;
    const cameraTarget = new THREE.Vector3(0, 0.2, 0);

    const resize = () => {
      const width = mount.clientWidth || 1;
      const height = mount.clientHeight || 1;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    resize();
    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    resizeObserver?.observe(mount);
    window.addEventListener("resize", resize);

    const redrawMarkers = () => {
      const group = markerGroupRef.current;
      if (!group) return;
      while (group.children.length) {
        const child = group.children[group.children.length - 1];
        group.remove(child);
        child.geometry?.dispose?.();
        child.material?.dispose?.();
      }
      annotationsRef.current.forEach((annotation, index) => {
        const marker = new THREE.Mesh(
          new THREE.SphereGeometry(0.09, 18, 18),
          new THREE.MeshStandardMaterial({
            color: index === annotationsRef.current.length - 1 ? 0xff6f61 : 0x26d7ff,
            emissive: index === annotationsRef.current.length - 1 ? 0x70241b : 0x0d3a49,
            roughness: 0.35,
            metalness: 0.1,
          })
        );
        marker.position.set(annotation.point.x, annotation.point.y, annotation.point.z);
        group.add(marker);
      });
    };
    redrawMarkersRef.current = redrawMarkers;

    const fitCameraToObject = (object) => {
      const bounds = new THREE.Box3().setFromObject(object);
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      const verticalSize = Math.max(size.y, 0.01);
      const horizontalSize = Math.max(size.x, 0.01);
      const vFov = THREE.MathUtils.degToRad(camera.fov);
      const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
      const fitHeightDistance = (verticalSize / 2) / Math.tan(vFov / 2);
      const fitWidthDistance = (horizontalSize / 2) / Math.tan(hFov / 2);
      baseCameraDistance = Math.max(fitHeightDistance, fitWidthDistance) * 1.45;
      cameraTarget.copy(center);
      cameraTarget.y = center.y + size.y * 0.08;
      camera.position.set(center.x, cameraTarget.y, center.z + baseCameraDistance);
      camera.near = Math.max(0.01, baseCameraDistance / 80);
      camera.far = Math.max(100, baseCameraDistance * 10);
      camera.lookAt(cameraTarget);
      camera.updateProjectionMatrix();
    };

    const loader = new GLTFLoader();
    const loadModel = (index = 0) => {
      const url = MODEL_URLS[index];
      if (!url) {
        setError("The female anatomy model could not be loaded.");
        return;
      }
      loader.load(
        url,
        (gltf) => {
          const root = gltf.scene;
          root.traverse((obj) => {
            if (obj.isMesh) {
              obj.material = new THREE.MeshStandardMaterial({
                color: 0xf0d5cb,
                roughness: 0.78,
                metalness: 0.04,
              });
              obj.userData.regionLabel = obj.name || obj.parent?.name || "Body region";
            }
          });
          const bounds = new THREE.Box3().setFromObject(root);
          const size = bounds.getSize(new THREE.Vector3());
          if (size.y > 0) root.scale.setScalar(4.2 / size.y);
          root.updateMatrixWorld(true);
          const scaledBounds = new THREE.Box3().setFromObject(root);
          const scaledCenter = scaledBounds.getCenter(new THREE.Vector3());
          root.position.set(-scaledCenter.x, -scaledCenter.y, -scaledCenter.z);
          modelGroup.add(root);
          fitCameraToObject(modelGroup);
          setReady(true);
          setError("");
        },
        undefined,
        () => loadModel(index + 1)
      );
    };
    loadModel();

    const pickRegion = (clientX, clientY) => {
      const rect = mount.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(modelGroup.children, true);
      const hit = hits.find((entry) => entry.object?.isMesh);
      if (!hit) return null;
      return {
        meshName: hit.object.name || "",
        regionLabel: hit.object.userData.regionLabel || hit.object.name || "Body region",
        point: {
          x: Number(hit.point.x.toFixed(4)),
          y: Number(hit.point.y.toFixed(4)),
          z: Number(hit.point.z.toFixed(4)),
        },
      };
    };

    const onPointerDown = (event) => {
      touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touchPoints.size === 2) {
        const [a, b] = [...touchPoints.values()];
        pinchStartDistance = Math.hypot(a.x - b.x, a.y - b.y);
        pinchStartScale = modelScale;
        dragging = false;
        startPointer = null;
        lastPointer = null;
        return;
      }
      dragging = true;
      startPointer = { x: event.clientX, y: event.clientY };
      lastPointer = { x: event.clientX, y: event.clientY };
      mount.setPointerCapture?.(event.pointerId);
    };

    const onPointerMove = (event) => {
      if (touchPoints.has(event.pointerId)) {
        touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }
      if (touchPoints.size === 2) {
        const [a, b] = [...touchPoints.values()];
        const nextDistance = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchStartDistance) modelScale = clamp(pinchStartScale * (nextDistance / pinchStartDistance), 0.7, 1.8);
        return;
      }
      if (!dragging || !lastPointer) return;
      const dx = event.clientX - lastPointer.x;
      const dy = event.clientY - lastPointer.y;
      lastPointer = { x: event.clientX, y: event.clientY };
      rotation.y += dx * 0.008;
      rotation.x = clamp(rotation.x - dy * 0.006, -0.55, 0.55);
    };

    const onPointerUp = (event) => {
      const movement = startPointer ? Math.hypot(event.clientX - startPointer.x, event.clientY - startPointer.y) : 0;
      if (touchPoints.size <= 1 && movement < 8) {
        const region = pickRegion(event.clientX, event.clientY);
        if (region) {
          setSelectedRegion(region.regionLabel);
          setAnnotations((prev) => {
            const next = [...prev, {
              ...region,
              intensity: formStateRef.current.intensity,
              distribution: formStateRef.current.distribution,
              notes: formStateRef.current.notes.trim(),
            }];
            annotationsRef.current = next;
            redrawMarkers();
            return next;
          });
          setError("");
        }
      }
      touchPoints.delete(event.pointerId);
      if (touchPoints.size < 2) pinchStartDistance = null;
      dragging = false;
      startPointer = null;
      lastPointer = null;
      mount.releasePointerCapture?.(event.pointerId);
    };

    const onWheel = (event) => {
      event.preventDefault();
      modelScale = clamp(modelScale - event.deltaY * 0.0009, 0.7, 1.8);
    };

    mount.addEventListener("wheel", onWheel, { passive: false });
    mount.addEventListener("pointerdown", onPointerDown);
    mount.addEventListener("pointermove", onPointerMove);
    mount.addEventListener("pointerup", onPointerUp);
    mount.addEventListener("pointercancel", onPointerUp);

    let rafId = 0;
    const animate = () => {
      rafId = window.requestAnimationFrame(animate);
      modelGroup.rotation.x = rotation.x;
      modelGroup.rotation.y = rotation.y;
      modelGroup.scale.setScalar(modelScale);
      camera.position.set(cameraTarget.x, cameraTarget.y, cameraTarget.z + (baseCameraDistance / modelScale));
      camera.lookAt(cameraTarget);
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      window.cancelAnimationFrame(rafId);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", resize);
      mount.removeEventListener("wheel", onWheel);
      mount.removeEventListener("pointerdown", onPointerDown);
      mount.removeEventListener("pointermove", onPointerMove);
      mount.removeEventListener("pointerup", onPointerUp);
      mount.removeEventListener("pointercancel", onPointerUp);
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, [request]);

  const removeAnnotation = (index) => {
    setAnnotations((prev) => prev.filter((_, currentIndex) => currentIndex !== index));
  };

  const save = async () => {
    if (!annotations.length) {
      setError("Click the body model to mark at least one symptom location.");
      return;
    }
    setSaving(true);
    setError("");
    const payload = {
      model: "female_anatomy.glb",
      prompt: request?.prompt || "",
      symptomLabel: request?.symptomLabel || "",
      capturedAt: new Date().toISOString(),
      sex: "Female",
      annotations,
    };
    try {
      const res = await fetch(apiUrl("/api/patient-calls/symptom-body-map"), {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not save the body map.");
      onSaved?.(payload, buildSummaryText(payload));
    } catch (err) {
      setError(err.message || "Could not save the body map.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pa_bodymap_overlay">
      <div className="pa_bodymap_card">
        <div className="pa_bodymap_header">
          <div>
            <p className="pa_bodymap_eyebrow">Symptom body map</p>
            <h2 className="pa_bodymap_title">{request?.symptomLabel || "Point to the symptom location"}</h2>
            <p className="pa_bodymap_prompt">
              {request?.prompt || (language === "ar"
                ? "حددي مكان الأعراض ثم شدتها وانتشارها."
                : "Tap the body to mark the symptom location, then set intensity and distribution.")}
            </p>
          </div>
          <button type="button" className="pa_bodymap_close" onClick={onClose}>Close</button>
        </div>

        <div className="pa_bodymap_layout">
          <div className="pa_bodymap_canvas_shell">
            <div ref={mountRef} className="pa_bodymap_canvas" />
            <div className="pa_bodymap_hint">Rotate by dragging. Pinch or scroll to zoom. Tap to place a marker.</div>
            {!ready && !error && <div className="pa_bodymap_loading">Loading anatomy model…</div>}
          </div>

          <div className="pa_bodymap_controls">
            <label className="pa_bodymap_label">
              Selected region
              <input className="pa_bodymap_input" value={selectedRegion} readOnly placeholder="Tap the body model" />
            </label>

            <label className="pa_bodymap_label">
              Intensity: {intensity}/10
              <input type="range" min="0" max="10" step="1" value={intensity} onChange={(event) => setIntensity(Number(event.target.value))} />
            </label>

            <label className="pa_bodymap_label">
              Distribution
              <select className="pa_bodymap_input" value={distribution} onChange={(event) => setDistribution(event.target.value)}>
                {DISTRIBUTION_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>

            <label className="pa_bodymap_label">
              Notes
              <textarea
                className="pa_bodymap_input pa_bodymap_textarea"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Optional detail about this marked area"
              />
            </label>

            {error && <p className="pa_bodymap_error">{error}</p>}

            <div className="pa_bodymap_annotations">
              <div className="pa_bodymap_annotations_head">
                <span>Saved markers</span>
                <span>{annotations.length}</span>
              </div>
              {annotations.length === 0 && <p className="pa_bodymap_empty">No markers yet.</p>}
              {annotations.map((annotation, index) => (
                <div key={`${annotation.meshName || "marker"}-${index}`} className="pa_bodymap_marker">
                  <div>
                    <strong>{annotation.regionLabel}</strong>
                    <span>{annotation.distribution} · {annotation.intensity}/10</span>
                  </div>
                  <button type="button" onClick={() => removeAnnotation(index)}>Remove</button>
                </div>
              ))}
            </div>

            <div className="pa_bodymap_actions">
              <button type="button" className="pa_bodymap_btn pa_bodymap_btn--ghost" onClick={onClose}>Cancel</button>
              <button type="button" className="pa_bodymap_btn" onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save to patient file"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
