import React, { useEffect, useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { resolveMorphTargetMap } from "./config/morphTargetMap";

// Roughly a human head+neck's own share of total standing height — used
// only to size the portrait crop below, not to identify any specific bone.
const HEAD_REGION_FRACTION = 0.16;

// Detects and logs every morph target the loaded .glb actually reports (per
// spec: "Detect and log all morph targets available in the GLB model. Do
// not assume the model uses standard names."), then resolves them against
// this app's standard names (see config/morphTargetMap.js) — the model's
// own real names always win; nothing here assumes a naming convention.
// Also measures the model's actual bounding box, so Local3DAvatarView can
// frame a portrait shot sized to whatever this specific model's real
// scale/proportions turn out to be, rather than a fixed camera position
// guessed for one file. Deliberately geometry-only (the exact top/center of
// the real mesh bounds), not a bone-pivot lookup — an earlier pass aimed at
// the Head bone's own pivot (which sits at the jaw/neck joint, not the
// visual top of the head) and needed constant hand-tuned offset guesses
// that still didn't reliably center the face. Suspends (via useGLTF) while
// loading and throws on a real load failure — both handled by
// Local3DAvatarView's own Suspense + error boundary, not here.
const AvatarModel = ({ modelUrl, onReady }) => {
  const gltf = useGLTF(modelUrl);

  const { meshesWithMorphs, standardToReal, portraitTarget, modelHeight } = useMemo(() => {
    const meshes = [];
    const allNames = new Set();
    gltf.scene.traverse((obj) => {
      if (obj.isMesh && obj.morphTargetDictionary && obj.morphTargetInfluences) {
        meshes.push(obj);
        Object.keys(obj.morphTargetDictionary).forEach((name) => allNames.add(name));
      }
    });

    gltf.scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const height = Math.max(0.01, box.max.y - box.min.y);
    const headRegionHeight = height * HEAD_REGION_FRACTION;
    // box.max.y is the TRUE top of the head/hair (exact mesh geometry) —
    // centering on the midpoint of a head-height-sized slice below it
    // reliably lands on the face regardless of this model's own bone
    // naming/pivot placement.
    const portrait = new THREE.Vector3(
      (box.min.x + box.max.x) / 2,
      box.max.y - headRegionHeight / 2,
      (box.min.z + box.max.z) / 2
    );

    return {
      meshesWithMorphs: meshes,
      standardToReal: resolveMorphTargetMap(allNames),
      portraitTarget: portrait,
      modelHeight: height,
    };
  }, [gltf]);

  useEffect(() => {
    const allRealNames = meshesWithMorphs.flatMap((m) => Object.keys(m.morphTargetDictionary || {}));
    console.info("[Local3DAvatar] morph targets found in model:", allRealNames);
    console.info("[Local3DAvatar] resolved standard -> real morph target map:", standardToReal);
    console.info("[Local3DAvatar] portrait target / model height:", portraitTarget, modelHeight);
    onReady?.({ root: gltf.scene, meshesWithMorphs, standardToReal, portraitTarget, modelHeight });
  }, [gltf.scene, meshesWithMorphs, standardToReal, portraitTarget, modelHeight, onReady]);

  return <primitive object={gltf.scene} />;
};

export default AvatarModel;
