import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const assetUrl = (path) => `${import.meta.env.BASE_URL}${path.replace(/^\//, "")}`;

const AVATARS = {
  female: {
    label: "Claudia",
    modelUrls: [
      assetUrl("models/female/rp_claudia_rigged_002_yup_a.fbx"),
      assetUrl("models/female/rp_claudia_rigged_002_yup_t.fbx"),
      assetUrl("models/female/rp_claudia_rigged_002_ue4.fbx"),
    ],
    diffuseUrl: assetUrl("models/female/tex/rp_claudia_rigged_002_dif.jpg"),
  },
  male: {
    label: "Eric",
    modelUrls: [
      assetUrl("models/male/rp_eric_rigged_001_yup_a.fbx"),
      assetUrl("models/male/rp_eric_rigged_001_yup_t.fbx"),
      assetUrl("models/male/rp_eric_rigged_001_ue4.fbx"),
      assetUrl("models/male/rp_eric_rigged_001_u3d.fbx"),
    ],
    diffuseUrl: assetUrl("models/male/tex/rp_eric_rigged_001_dif.jpg"),
  },
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export default function TalkingHead({ audioElement, active, agentState, avatar = "female" }) {
  const mountRef = useRef(null);
  const audioLevelRef = useRef(0);
  const activeRef = useRef(active);
  const agentStateRef = useRef(agentState);
  const rotateRef = useRef({ x: 0, y: 0 });
  const moveRef = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const [loadState, setLoadState] = useState("loading");
  // Mirrors moveRef/rotateRef/zoomRef into React state on a timer (not
  // every frame — these are dragged, not continuously animated, so a
  // fast poll is plenty and avoids re-rendering the panel 60x/sec) purely
  // so the debug panel below can display and copy them. Lets whoever's
  // tuning the default framing drag/rotate/zoom live, then hand the exact
  // numbers back instead of me guessing them off a screenshot.
  const [liveTransform, setLiveTransform] = useState({ moveX: 0, moveY: 0, rotateX: 0, rotateY: 0, zoom: 1 });

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    agentStateRef.current = agentState;
  }, [agentState]);

  useEffect(() => {
    const id = setInterval(() => {
      setLiveTransform({
        moveX: moveRef.current.x,
        moveY: moveRef.current.y,
        rotateX: rotateRef.current.x,
        rotateY: rotateRef.current.y,
        zoom: zoomRef.current,
      });
    }, 150);
    return () => clearInterval(id);
  }, []);

  const copyLiveTransform = () => {
    const { moveX, moveY, rotateX, rotateY, zoom } = liveTransform;
    const text = `moveRef.current = { x: ${moveX.toFixed(3)}, y: ${moveY.toFixed(3)} };\n`
      + `rotateRef.current = { x: ${rotateX.toFixed(3)}, y: ${rotateY.toFixed(3)} };\n`
      + `zoomRef.current = ${zoom.toFixed(3)};`;
    navigator.clipboard?.writeText(text).catch(() => {});
  };

  useEffect(() => {
    const mount = mountRef.current;
    const avatarConfig = AVATARS[avatar] || AVATARS.female;
    if (!mount) return undefined;

    setLoadState("loading");

    // These persist across avatar switches (refs, not state tied to this
    // effect) — without resetting them on every scene build, a fresh
    // scene would inherit whatever move/rotate/zoom offset was left over
    // from dragging the PREVIOUS avatar around. Reset to the framing
    // captured via the live debug panel's Copy button (see
    // copyLiveTransform above) — actual dragged values, not a guess off a
    // screenshot like the previous attempt that pushed the head out of
    // frame.
    moveRef.current = { x: -0.37, y: -0.507 };
    rotateRef.current = { x: -0.176, y: 0.904 };
    zoomRef.current = 0.88;

    const scene = new THREE.Scene();
    scene.background = null;

    const camera = new THREE.PerspectiveCamera(24, 0.78, 0.1, 100);
    camera.position.set(0, 1.6, 2.5);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;
    mount.appendChild(renderer.domElement);

    const hemiLight = new THREE.HemisphereLight(0xf8fbff, 0x0a1118, 1.65);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff3e6, 2.1);
    keyLight.position.set(1.4, 3.1, 4.2);
    scene.add(keyLight);

    const cyanRim = new THREE.PointLight(0x7be9ff, 14, 10, 2);
    cyanRim.position.set(-2.1, 2.3, 2.8);
    scene.add(cyanRim);

    const tealFill = new THREE.PointLight(0x96fff1, 7, 12, 2);
    tealFill.position.set(2.6, 1.3, 2.3);
    scene.add(tealFill);

    // Avatar + chair both live under this group so drag-to-rotate (see
    // onPointerMove/animate below) turns them together as one rigid scene
    // instead of each object spinning independently. Lights stay direct
    // children of `scene` (not this group) so they stay fixed in world
    // space as the subject rotates, like a stationary studio light rig,
    // rather than rotating along with it.
    const stageGroup = new THREE.Group();
    scene.add(stageGroup);

    let modelRoot = null;
    let neckBone = null;
    let headBone = null;
    let jawBone = null;
    let eyelidLBone = null;
    let eyelidRBone = null;
    let eyebrowLBone = null;
    let eyebrowRBone = null;
    let eyeLBone = null;
    let eyeRBone = null;
    let spineBone = null;
    let upperArmLBone = null;
    let upperArmRBone = null;
    let nextBlinkAt = 1 + Math.random() * 2.5;
    let nextNodAt = 2 + Math.random() * 3;
    // Saccade state — see the gaze block in animate() below. A random new
    // look target (anywhere in the full range, not just an oscillating
    // path) is picked periodically; lookCurrentX/Y ease toward it each
    // frame.
    let lookTargetX = 0;
    let lookTargetY = 0;
    let lookCurrentX = 0;
    let lookCurrentY = 0;
    let nextLookChangeAt = 0.5;
    let rafId = 0;
    let baseRootY = -1.2;
    let baseRootX = 0.01;
    let baseDistance = 3;
    let cameraCenterX = 0;
    let cameraCenterZ = 0;
    let lookAtY = 0;
    // Reference points measured off the posed character, used to scale and
    // ground the chair model once it loads — set at the end of
    // handleLoadedModel, once the character's final seated transform is
    // known, so the chair (which loads independently and may resolve
    // before or after the avatar) always has real numbers to align to.
    let characterStandingHeight = 1.7;
    let chairSeatY = -0.4;
    let chairAnchorX = 0;
    let chairAnchorZ = 0;

    // Points the camera at `fitBounds`, sized so verticalFrac/horizontalFrac
    // of its extent fills the frame. Called once for the character alone at
    // load time, then again once the chair loads with the two objects'
    // COMBINED bounds — re-fitting rather than fitting once lets the frame
    // widen to include the chair (which extends below the character) after
    // the fact, instead of the character-only fit cropping it out.
    const fitCameraToBounds = (fitBounds, verticalFrac, horizontalFrac) => {
      const fitSize = fitBounds.getSize(new THREE.Vector3());
      const fitCenter = fitBounds.getCenter(new THREE.Vector3());
      const verticalSlice = fitSize.y * verticalFrac;
      const horizontalSlice = fitSize.x * horizontalFrac;
      const vFov = (camera.fov * Math.PI) / 180;
      const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
      const fitHeightDistance = (verticalSlice / 2) / Math.tan(vFov / 2);
      const fitWidthDistance = (horizontalSlice / 2) / Math.tan(hFov / 2);
      const fitDistance = Math.max(fitHeightDistance, fitWidthDistance);
      baseDistance = fitDistance * 1.12;
      cameraCenterX = fitCenter.x;
      cameraCenterZ = fitCenter.z;
      lookAtY = fitCenter.y;
      camera.position.set(cameraCenterX, fitCenter.y, cameraCenterZ + baseDistance);
      camera.near = Math.max(0.01, fitDistance / 80);
      camera.far = fitDistance * 8;
      camera.lookAt(fitCenter.x, lookAtY, fitCenter.z);
      camera.updateProjectionMatrix();
    };

    const loader = new FBXLoader();
    const textureLoader = new THREE.TextureLoader();
    const diffuseMap = textureLoader.load(avatarConfig.diffuseUrl);
    diffuseMap.colorSpace = THREE.SRGBColorSpace;

    const resize = () => {
      const width = mount.clientWidth || 1;
      const height = mount.clientHeight || 1;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    resize();
    window.addEventListener("resize", resize);
    const resizeObserver =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => resize()) : null;
    resizeObserver?.observe(mount);

    let audioContext;
    let analyser;
    let sourceNode;
    let frequencyData;
    let isDragging = false;
    let lastPointer = null;
    const touchPoints = new Map();
    let pinchStartDistance = null;
    let pinchStartZoom = 1;
    let lastCentroid = null;

    const setPointerCursor = (dragging) => {
      mount.style.cursor = dragging ? "grabbing" : "grab";
    };
    setPointerCursor(false);

    const onPointerDown = (event) => {
      touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touchPoints.size === 2) {
        const [a, b] = [...touchPoints.values()];
        pinchStartDistance = Math.hypot(a.x - b.x, a.y - b.y);
        pinchStartZoom = zoomRef.current;
        lastCentroid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      }
      isDragging = true;
      lastPointer = { x: event.clientX, y: event.clientY };
      setPointerCursor(true);
      mount.setPointerCapture?.(event.pointerId);
    };

    const onPointerMove = (event) => {
      if (touchPoints.has(event.pointerId)) {
        touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }
      if (touchPoints.size === 2) {
        const [a, b] = [...touchPoints.values()];
        // Pinch distance → zoom.
        const nextDistance = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchStartDistance) {
          const scale = nextDistance / pinchStartDistance;
          zoomRef.current = clamp(pinchStartZoom / scale, 0.72, 1.7);
        }
        // Two-finger centroid movement → 3D rotate the whole stage. Yaw is
        // unclamped (full turntable spin); pitch is clamped so it can't
        // flip the stage upside down.
        const centroid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (lastCentroid) {
          rotateRef.current.y += (centroid.x - lastCentroid.x) * 0.008;
          rotateRef.current.x = clamp(rotateRef.current.x - (centroid.y - lastCentroid.y) * 0.006, -0.5, 0.5);
        }
        lastCentroid = centroid;
        return;
      }
      lastCentroid = null;
      if (!isDragging || !lastPointer) return;
      const dx = event.clientX - lastPointer.x;
      const dy = event.clientY - lastPointer.y;
      lastPointer = { x: event.clientX, y: event.clientY };
      // Single-pointer drag (mouse or one finger) → move the whole stage.
      // Clamp widened (±0.8/±0.6 → ±3) — the old range was tuned for a
      // subtle nudge on a tight head-shot crop, not for freely
      // repositioning a full avatar+chair scene across the canvas.
      moveRef.current.x = clamp(moveRef.current.x + dx * 0.0025, -3, 3);
      moveRef.current.y = clamp(moveRef.current.y - dy * 0.003, -3, 3);
    };

    const endPointerDrag = (event) => {
      touchPoints.delete(event.pointerId);
      if (touchPoints.size < 2) {
        pinchStartDistance = null;
        lastCentroid = null;
      }
      isDragging = false;
      lastPointer = null;
      setPointerCursor(false);
      if (event) mount.releasePointerCapture?.(event.pointerId);
    };

    const onWheel = (event) => {
      event.preventDefault();
      zoomRef.current = clamp(zoomRef.current + event.deltaY * 0.0015, 0.72, 1.7);
    };

    mount.addEventListener("pointerdown", onPointerDown);
    mount.addEventListener("pointermove", onPointerMove);
    mount.addEventListener("pointerup", endPointerDrag);
    mount.addEventListener("pointerleave", endPointerDrag);
    mount.addEventListener("pointercancel", endPointerDrag);
    mount.addEventListener("wheel", onWheel, { passive: false });

    const connectAudio = async () => {
      const media = audioElement?.current;
      if (!media || audioContext) return;
      try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        await audioContext.resume();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.84;
        frequencyData = new Uint8Array(analyser.frequencyBinCount);
        sourceNode = audioContext.createMediaElementSource(media);
        sourceNode.connect(analyser);
        analyser.connect(audioContext.destination);
      } catch {
        audioContext = undefined;
      }
    };

    const readAudioLevel = () => {
      if (!analyser || !frequencyData) {
        audioLevelRef.current *= 0.92;
        return audioLevelRef.current;
      }
      analyser.getByteFrequencyData(frequencyData);
      let total = 0;
      for (let i = 8; i < 42; i += 1) total += frequencyData[i];
      const normalized = clamp(total / (34 * 145), 0, 1);
      audioLevelRef.current += (normalized - audioLevelRef.current) * 0.3;
      return audioLevelRef.current;
    };

    const handleLoadedModel = (fbx) => {
        modelRoot = fbx;
        modelRoot.scale.setScalar(0.01);
        modelRoot.position.set(0, -1.2, -0.15);
        modelRoot.rotation.y = 0;

        modelRoot.traverse((obj) => {
          if (!obj.isMesh && !obj.isSkinnedMesh) return;
          obj.castShadow = false;
          obj.receiveShadow = false;

          const original = obj.material;
          const material = new THREE.MeshStandardMaterial({
            map: diffuseMap,
            roughness: 0.92,
            metalness: 0.02,
            side: THREE.FrontSide,
            skinning: Boolean(obj.isSkinnedMesh),
          });

          if (original?.transparent) {
            material.transparent = true;
            material.alphaTest = 0.2;
          }

          obj.material = material;
        });

        // Measured while still standing (pre-fold) — used below as the
        // chair's target height, since the seated bounding box computed
        // after folding the legs is much shorter and isn't a useful chair
        // size reference.
        characterStandingHeight = new THREE.Box3().setFromObject(modelRoot).getSize(new THREE.Vector3()).y || characterStandingHeight;

        // ── Fold the legs into a seated, cross-legged pose — done BEFORE
        // the camera auto-fit below, so the fit measures the actual seated
        // silhouette (much shorter/wider than standing) instead of the
        // standing bind pose. Same measured-geometry technique as the arm
        // relaxing further down: point each bone at a target WORLD
        // direction derived from its own measured current direction (so
        // "left" vs "right" doesn't need to be guessed), rather than
        // assuming the rig's local axes.
        modelRoot.updateMatrixWorld(true);
        const pointBoneToward = (bone, childBone, targetDir) => {
          const boneP = new THREE.Vector3();
          const childP = new THREE.Vector3();
          bone.getWorldPosition(boneP);
          childBone.getWorldPosition(childP);
          const currentDir = childP.sub(boneP).normalize();
          const deltaQuat = new THREE.Quaternion().setFromUnitVectors(currentDir, targetDir.clone().normalize());
          const parentWorldQuat = bone.parent.getWorldQuaternion(new THREE.Quaternion());
          const boneWorldQuat = bone.getWorldQuaternion(new THREE.Quaternion());
          bone.quaternion.copy(parentWorldQuat.invert().multiply(deltaQuat.multiply(boneWorldQuat)));
          bone.updateMatrixWorld(true);
        };
        // Dropped the crossed-leg pose (kept fighting mesh clipping where
        // the legs overlapped, since it's one continuous skinned mesh with
        // no "draw in front" to rely on) for a plain symmetric sit instead
        // — both legs bend the same way, side by side, no overlap. outSign
        // passed explicitly (-1/+1) rather than measured from the bind
        // pose: standing legs hang almost perfectly vertical, so the
        // hip→knee X offset is too close to zero to reliably tell left
        // from right. That hardcoded guess was backward, though — widening
        // the spread was pulling the thighs INTO each other (crossing
        // right at the hip) instead of apart, confirmed by the crossing
        // getting worse each time the magnitude increased. Signs swapped
        // below to fix the direction, not the magnitude.
        const foldLeg = (upperName, lowerName, footName, outSign) => {
          const upperBone = modelRoot.getObjectByName(upperName);
          const lowerBone = modelRoot.getObjectByName(lowerName);
          const footBone = modelRoot.getObjectByName(footName);
          if (!upperBone || !lowerBone || !upperBone.parent || !lowerBone.parent) return;

          // Thigh: hip → knee, forward and roughly horizontal (seated, hip
          // bent ~90°). Narrowed further (0.2 → 0.12) for a smaller angle
          // between the legs than the previous knees-apart stance.
          pointBoneToward(upperBone, lowerBone, new THREE.Vector3(outSign * 0.12, -0.15, 0.97));
          // Shin: knee → ankle, bends down to the floor, scaled down to
          // match (0.15 → 0.09).
          if (footBone) {
            pointBoneToward(lowerBone, footBone, new THREE.Vector3(outSign * 0.09, -0.95, -0.15));
          }
        };
        foldLeg("upperleg_l", "lowerleg_l", "foot_l", 1);
        foldLeg("upperleg_r", "lowerleg_r", "foot_r", -1);

        const bounds = new THREE.Box3().setFromObject(modelRoot);
        const center = bounds.getCenter(new THREE.Vector3());
        // Seated silhouette is much shorter and squatter than standing, so
        // frame nearly the whole thing (was a 0.56 waist-up crop tuned for
        // a standing bust shot) rather than reusing that fraction here.
        // 0.95 left almost no headroom and was cropping the head — and
        // critically, if the chair's refit below doesn't end up firing (or
        // fires but gets raced/overwritten), THIS is the fit that's
        // actually on screen, so it needs to be non-cropping on its own,
        // not just rely on the second pass to fix it. Loosened to 0.7.
        // Refit again once the chair loads (see loadChair below) — this
        // first pass only knows about the character, not the chair's
        // extent below it.
        fitCameraToBounds(bounds, 0.7, 0.75);

        modelRoot.position.sub(center);
        modelRoot.position.x += 0.01;
        modelRoot.position.z -= 0.02;
        baseRootX = modelRoot.position.x;
        baseRootY = modelRoot.position.y;

        neckBone = modelRoot.getObjectByName("neck");
        headBone = modelRoot.getObjectByName("head");
        jawBone = modelRoot.getObjectByName("jaw");
        eyelidLBone = modelRoot.getObjectByName("eyelid_l");
        eyelidRBone = modelRoot.getObjectByName("eyelid_r");
        eyebrowLBone = modelRoot.getObjectByName("eyebrow_l");
        eyebrowRBone = modelRoot.getObjectByName("eyebrow_r");
        eyeLBone = modelRoot.getObjectByName("eye_l");
        eyeRBone = modelRoot.getObjectByName("eye_r");
        spineBone = modelRoot.getObjectByName("spine_03");

        [
          neckBone, headBone, jawBone,
          eyelidLBone, eyelidRBone, eyebrowLBone, eyebrowRBone, eyeLBone, eyeRBone,
          spineBone,
        ]
          .filter(Boolean)
          .forEach((bone) => {
            bone.userData.baseRotation = bone.rotation.clone();
          });

        // ── Rest the hands on the hips (not the chair's armrests anymore)
        // — the FBX bind pose is a T-pose (upper arms straight out to the
        // sides). Rather than guess the rig's local axis conventions (got
        // jaw.rotation wrong that way once already — see the mouth-talking
        // code above), measure each upper arm's ACTUAL current world-space
        // direction (shoulder → elbow) and rotate it down alongside the
        // torso, then bend the forearm down-and-inward at the elbow so the
        // palm lands on the hip on the SAME side, rather than reaching out
        // level to an armrest. Works the same for both arms regardless of
        // which way "left" vs "right" is signed in the rig, since the
        // outward lean is derived from each arm's own measured geometry,
        // not a guess, and mirrored (-outSign) for the forearm's inward
        // curl.
        modelRoot.updateMatrixWorld(true);
        const relaxArm = (upperName, lowerName, handName) => {
          const upperBone = modelRoot.getObjectByName(upperName);
          const lowerBone = modelRoot.getObjectByName(lowerName);
          const handBone = modelRoot.getObjectByName(handName);
          if (!upperBone || !lowerBone || !upperBone.parent) return;

          const shoulderPos = new THREE.Vector3();
          const elbowPos = new THREE.Vector3();
          upperBone.getWorldPosition(shoulderPos);
          lowerBone.getWorldPosition(elbowPos);
          const currentDir = elbowPos.sub(shoulderPos).normalize();
          const outSign = Math.sign(currentDir.x) || 1;
          pointBoneToward(upperBone, lowerBone, new THREE.Vector3(currentDir.x * 0.18, -0.9, 0.3));
          // Forearm: elbow → wrist, curls toward the body, bringing the
          // palm onto the same-side hip. Downward pull eased further
          // (-0.4 → -0.2) to raise the hand a bit higher, just above hip
          // level instead of at it. Inward pull stays eased (-0.15) so the
          // forearm stays abducted (outward) rather than drifting past
          // the hip toward the midline.
          const forearmDir = new THREE.Vector3(-outSign * 0.15, -0.2, 0.55).normalize();
          if (handBone) {
            pointBoneToward(lowerBone, handBone, forearmDir);
            // Wrist roll — rotates the hand around the forearm's OWN axis
            // (elbow→wrist), which changes which way the palm faces
            // without disturbing the arm direction just set above, same
            // as a real wrist pronating/supinating. Angle is a guess (not
            // measured — hand bones don't have a clean reference
            // direction to derive palm-normal from the way arm/leg
            // segments do), aimed at turning the palm to face down onto
            // the hip; retune HAND_ROLL_ANGLE if it's facing the wrong way.
            const HAND_ROLL_ANGLE = outSign * 1.4;
            const parentWorldQuat = handBone.parent.getWorldQuaternion(new THREE.Quaternion());
            const handWorldQuat = handBone.getWorldQuaternion(new THREE.Quaternion());
            const rollQuat = new THREE.Quaternion().setFromAxisAngle(forearmDir, HAND_ROLL_ANGLE);
            handBone.quaternion.copy(parentWorldQuat.invert().multiply(rollQuat.multiply(handWorldQuat)));
            handBone.updateMatrixWorld(true);
          }
          // Captured post-pose so the small speaking gesture in animate()
          // below oscillates around this resting-on-the-hip pose, not the
          // T-pose.
          upperBone.userData.baseRotation = upperBone.rotation.clone();
          return upperBone;
        };
        upperArmLBone = relaxArm("upperarm_l", "lowerarm_l", "hand_l");
        upperArmRBone = relaxArm("upperarm_r", "lowerarm_r", "hand_r");

        // Reference points for aligning the chair (see loadChair below) —
        // measured now, with the character's final seated transform
        // already set, even though modelRoot isn't in the scene graph yet:
        // getWorldPosition resolves against modelRoot's own matrix
        // regardless, since it has no parent to compose with yet.
        const hipBone = modelRoot.getObjectByName("hip");
        if (hipBone) {
          chairSeatY = hipBone.getWorldPosition(new THREE.Vector3()).y;
        }
        chairAnchorX = modelRoot.position.x;
        chairAnchorZ = modelRoot.position.z;

        stageGroup.add(modelRoot);
        setLoadState("ready");
        loadChair();
    };

    const tryLoadModel = (urls, index = 0) => {
      const url = urls[index];
      if (!url) {
        setLoadState("error");
        return;
      }

      loader.load(
        url,
        handleLoadedModel,
        undefined,
        () => {
          tryLoadModel(urls, index + 1);
        }
      );
    };

    // ── Chair — purely set dressing, so failures are silent (no chair is
    // fine; it's not the point of the call). Scaled/positioned using the
    // character's own measurements (characterStandingHeight, chairSeatY,
    // chairAnchorX/Z, set at the end of handleLoadedModel) rather than
    // fixed numbers, since this specific model's real-world proportions
    // aren't known ahead of time. Positions off the model's OWN measured
    // bounding box after scaling too, so it's independent of wherever the
    // download's internal pivot happens to be.
    const chairLoader = new GLTFLoader();
    const loadChair = (urls = [assetUrl("models/chair/scene.gltf"), assetUrl("models/chair/chair.glb")], index = 0) => {
      const url = urls[index];
      if (!url) return;
      chairLoader.load(
        url,
        (gltf) => {
          const chair = gltf.scene;
          chair.traverse((obj) => {
            if (obj.isMesh) {
              obj.castShadow = false;
              obj.receiveShadow = false;
            }
          });
          const naturalHeight = new THREE.Box3().setFromObject(chair).getSize(new THREE.Vector3()).y;
          if (naturalHeight > 0) {
            // Was matched 1:1 to standing height — too tall/wide next to
            // the character, so the combined-bounds refit had to zoom out
            // further than it needed to. A chair's back typically reaches
            // roughly mid-back on a SEATED person, well under a full
            // standing height, so ~0.55 of it instead.
            chair.scale.setScalar((characterStandingHeight * 0.55) / naturalHeight);
          }
          chair.updateMatrixWorld(true);
          const scaledBounds = new THREE.Box3().setFromObject(chair);
          const scaledCenter = scaledBounds.getCenter(new THREE.Vector3());
          chair.position.x += chairAnchorX - scaledCenter.x;
          // No backward Z offset anymore — that -0.3 assumed a normal
          // chair silhouette (flat seat + separate legs), but this is a
          // bowl/basket-shaped chair, and the offset was pushing it out
          // from under the character instead of centering her in it.
          chair.position.z += chairAnchorZ - scaledCenter.z;
          // Align the chair's SEAT to the character's actual hip height
          // (chairSeatY) rather than just matching floor levels — the
          // character's pose already puts its hip at a plausible sitting
          // height above its own feet, but nothing guarantees that height
          // happens to match this specific chair's floor-to-seat distance,
          // so floor-matching alone could leave the character floating
          // above the seat or sunk through it. Seat height itself isn't
          // known (no marked "seat" point on an arbitrary downloaded
          // model), so this is a guessed fraction of the chair's total
          // height — and it's PER-MODEL: 0.3 was tuned for an earlier bowl
          // chair, but this is a different, flat-seat armchair where the
          // seat sits roughly half way up (legs below, tall back above),
          // not near the bottom. Whoever swaps in a new chair file will
          // likely need to retune this again for that model's proportions.
          const SEAT_HEIGHT_FRACTION = 0.7;
          const estimatedSeatY = scaledBounds.min.y + scaledBounds.getSize(new THREE.Vector3()).y * SEAT_HEIGHT_FRACTION;
          chair.position.y += chairSeatY - estimatedSeatY;
          stageGroup.add(chair);

          // Refit the camera to BOTH objects together — the character-only
          // fit at load time didn't know about the chair, which extends
          // further down (legs reaching the floor below the character's
          // feet) and would otherwise get cropped out of the bottom of
          // frame. 0.92 was cutting it too tight and cropping the head off
          // the top — loosened to 0.72 for real headroom margin instead of
          // filling the frame edge-to-edge.
          //
          // modelRoot/chair are already parented under stageGroup by this
          // point, so their world bounds include whatever pan/rotate
          // offset (moveRef/rotateRef) is currently set — computing the
          // fit straight off that would bake the offset into the camera's
          // OWN target, which re-centers on it and silently cancels the
          // pan out (this was why every dragged value looked "centered").
          // Zero the group's transform just for this measurement so the
          // fit reflects the neutral composition, forcing the matrix
          // update explicitly (Box3 reads matrixWorld, which doesn't
          // update itself just from setting .position/.rotation) — then
          // restore the pan/rotate immediately after, rather than
          // assuming the next animate() frame would catch it in time.
          // That assumption was wrong: it visibly snapped to the panned
          // position for a frame, then sat at (0,0,0) — meaning something
          // in between was reading the zeroed transform as final, not
          // transient.
          const savedPos = stageGroup.position.clone();
          const savedRot = stageGroup.rotation.clone();
          stageGroup.position.set(0, 0, 0);
          stageGroup.rotation.set(0, 0, 0);
          stageGroup.updateMatrixWorld(true);
          const combined = new THREE.Box3().setFromObject(modelRoot).union(new THREE.Box3().setFromObject(chair));
          fitCameraToBounds(combined, 0.72, 0.75);
          stageGroup.position.copy(savedPos);
          stageGroup.rotation.copy(savedRot);
          stageGroup.updateMatrixWorld(true);
        },
        undefined,
        () => loadChair(urls, index + 1)
      );
    };

    tryLoadModel(avatarConfig.modelUrls);

    const clock = new THREE.Clock();

    const animate = () => {
      rafId = window.requestAnimationFrame(animate);
      const t = clock.getElapsedTime();
      const level = readAudioLevel();
      const state = agentStateRef.current;
      const activeBoost = activeRef.current ? 1 : 0;
      const speakingBoost = state === "speaking" ? 1 : 0;
      const thinkingBoost = state === "thinking" ? 1 : 0;
      const listeningBoost = state === "listening" || state === "idle" ? 1 : 0;

      // Single-pointer drag moves and two-finger touch rotates the whole
      // stage (avatar + chair) as one rigid group, so they move/rotate in
      // sync instead of each responding to input around its own separate
      // origin.
      stageGroup.position.x = moveRef.current.x;
      stageGroup.position.y = moveRef.current.y;
      stageGroup.rotation.y = rotateRef.current.y;
      stageGroup.rotation.x = rotateRef.current.x;

      if (modelRoot) {
        modelRoot.rotation.y = Math.sin(t * 0.32) * 0.04 + thinkingBoost * 0.015;
        modelRoot.position.x = baseRootX;
        modelRoot.position.y = baseRootY + Math.sin(t * 1.1) * 0.008;
      }

      camera.position.x = cameraCenterX;
      camera.position.z += (((cameraCenterZ + (baseDistance * zoomRef.current))) - camera.position.z) * 0.16;
      camera.lookAt(cameraCenterX, lookAtY, cameraCenterZ);

      // ── Shared gaze signal — one underlying "where am I looking"
      // direction (lookX/lookY) drives the neck, head, AND eyes below,
      // each at a different amplitude, instead of each being animated by
      // its own unrelated sine wave. Real gaze shifts work this way: eyes
      // lead and cover most of the motion, the head follows partially and
      // a little behind, neck barely at all — not three independently
      // wandering body parts that happen to share a torso.
      //
      // The look direction itself is a saccade, not a sine sweep — a sine
      // wave only ever traces the same repeating oval path, never
      // actually "looks" at a random point off to one side and holds
      // there. Instead, periodically pick a new random target ANYWHERE in
      // the full range (any angle, any distance from center — left,
      // right, up, down, or anything between), then ease toward it, so it
      // reads as actually looking somewhere rather than drifting.
      const gazeSettle = speakingBoost ? 0.35 : 1;
      if (t > nextLookChangeAt) {
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.sqrt(Math.random()); // uniform over the disc, not biased toward center
        lookTargetX = Math.cos(angle) * radius;
        lookTargetY = Math.sin(angle) * radius * 0.7; // vertical range a bit narrower than horizontal
        nextLookChangeAt = t + 1 + Math.random() * 2.6;
      }
      lookCurrentX += (lookTargetX - lookCurrentX) * 0.1;
      lookCurrentY += (lookTargetY - lookCurrentY) * 0.1;
      const lookX = lookCurrentX;
      const lookY = lookCurrentY;

      if (neckBone?.userData.baseRotation) {
        neckBone.rotation.y = neckBone.userData.baseRotation.y
          + lookX * 0.045 * gazeSettle
          + (activeBoost ? 0.02 : 0.01);
        neckBone.rotation.x = neckBone.userData.baseRotation.x
          - listeningBoost * 0.018
          + lookY * 0.02 * gazeSettle;
      }

      if (headBone?.userData.baseRotation) {
        headBone.rotation.y = headBone.userData.baseRotation.y + lookX * 0.025 * gazeSettle + thinkingBoost * 0.012;
        headBone.rotation.x = headBone.userData.baseRotation.x + lookY * 0.012 * gazeSettle - listeningBoost * 0.008;
        headBone.rotation.z = headBone.userData.baseRotation.z + Math.sin(t * 0.55) * 0.005;
      }

      // ── Mouth talking — driven by live mic/agent audio level. If nothing
      // is coming through the analyser yet (autoplay policy, connection
      // lag) but the agent is in "speaking" state, fall back to a synthetic
      // chatter so the avatar still visibly talks instead of sitting frozen.
      // Verified against the actual rig: the jaw bone hinges open on its
      // local Z axis (negative direction), not X — X/Y barely move the mesh.
      const syntheticTalk = speakingBoost && level < 0.05
        ? 0.2 + (Math.sin(t * 11) + 1) * 0.5 * 0.35
        : 0;
      const jawOpen = clamp(Math.max(level * 2.4, syntheticTalk), 0, 1);

      if (jawBone?.userData.baseRotation) {
        jawBone.rotation.z = jawBone.userData.baseRotation.z
          - jawOpen * 0.26
          - Math.sin(t * 9) * jawOpen * 0.02;
      }

      // ── Eyebrows — subtle raise while thinking/listening, gentle idle drift.
      const browRaise = thinkingBoost * 0.1 + listeningBoost * 0.035 + Math.sin(t * 0.4) * 0.008;
      if (eyebrowLBone?.userData.baseRotation) {
        eyebrowLBone.rotation.x = eyebrowLBone.userData.baseRotation.x - browRaise;
      }
      if (eyebrowRBone?.userData.baseRotation) {
        eyebrowRBone.rotation.x = eyebrowRBone.userData.baseRotation.x - browRaise;
      }

      // ── Eyes — same lookX/lookY signal as the neck/head above (see
      // there), just at full amplitude, since the eyes do most of the
      // work in a real gaze shift.
      const gazeX = lookX * 0.045 * gazeSettle;
      const gazeY = lookY * 0.025 * gazeSettle;
      [eyeLBone, eyeRBone].forEach((eye) => {
        if (!eye?.userData.baseRotation) return;
        eye.rotation.y = eye.userData.baseRotation.y + gazeX;
        eye.rotation.x = eye.userData.baseRotation.x + gazeY;
      });

      // ── Blinking — discrete triangular close/open pulse on a randomized
      // timer, not a continuous sine (real blinks are quick and sparse).
      let blinkClose = 0;
      const blinkPhase = t - nextBlinkAt;
      if (blinkPhase >= 0 && blinkPhase < 0.22) {
        const p = blinkPhase / 0.22;
        blinkClose = p < 0.5 ? p * 2 : (1 - p) * 2;
      } else if (blinkPhase >= 0.22) {
        nextBlinkAt = t + 2.4 + Math.random() * 3.6;
      }
      if (eyelidLBone?.userData.baseRotation) {
        eyelidLBone.rotation.x = eyelidLBone.userData.baseRotation.x + blinkClose * 0.85;
      }
      if (eyelidRBone?.userData.baseRotation) {
        eyelidRBone.rotation.x = eyelidRBone.userData.baseRotation.x + blinkClose * 0.85;
      }

      cyanRim.intensity = 10 + speakingBoost * 2 + level * 3;
      tealFill.intensity = 6 + listeningBoost * 1.5 + thinkingBoost;

      renderer.render(scene, camera);
    };

    connectAudio();
    animate();

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
      resizeObserver?.disconnect();
      mount.removeEventListener("pointerdown", onPointerDown);
      mount.removeEventListener("pointermove", onPointerMove);
      mount.removeEventListener("pointerup", endPointerDrag);
      mount.removeEventListener("pointerleave", endPointerDrag);
      mount.removeEventListener("pointercancel", endPointerDrag);
      mount.removeEventListener("wheel", onWheel);
      renderer.dispose();
      scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach((mat) => mat.dispose());
          else obj.material.dispose();
        }
      });
      diffuseMap.dispose();
      if (sourceNode) sourceNode.disconnect();
      if (analyser) analyser.disconnect();
      if (audioContext) audioContext.close().catch(() => {});
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, [audioElement, avatar]);

  useEffect(() => {
    if (!active) return undefined;
    const media = audioElement?.current;
    if (!media) return undefined;

    const wakeAudio = () => {
      media.play?.().catch(() => {});
    };

    wakeAudio();
    media.addEventListener("play", wakeAudio);
    return () => {
      media.removeEventListener("play", wakeAudio);
    };
  }, [active, audioElement]);

  return (
    <div className={`pa_head_shell ${active ? "pa_head_shell--active" : ""}`}>
      <div ref={mountRef} className="pa_head_canvas" />
      {loadState !== "ready" && (
        <div className="pa_head_status">
          {loadState === "loading" ? `Loading ${AVATARS[avatar]?.label || "avatar"}…` : "Avatar failed to load."}
        </div>
      )}
      <div className="pa_head_glow pa_head_glow--one" />
      <div className="pa_head_glow pa_head_glow--two" />

      {/* Tuning aid — drag/rotate/zoom the stage to find a framing, then
          copy the exact numbers out instead of eyeballing it from a
          screenshot. Not meant to ship long-term; remove once the default
          framing is settled. */}
      <div className="pa_head_debug_panel">
        <div>move: {liveTransform.moveX.toFixed(3)}, {liveTransform.moveY.toFixed(3)}</div>
        <div>rotate: {liveTransform.rotateX.toFixed(3)}, {liveTransform.rotateY.toFixed(3)}</div>
        <div>zoom: {liveTransform.zoom.toFixed(3)}</div>
        <button type="button" onClick={copyLiveTransform}>Copy</button>
      </div>
    </div>
  );
}
