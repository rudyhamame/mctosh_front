import { useRef } from "react";
import { useFrame } from "@react-three/fiber";

// Slow saccade-like look-around — bone-rotation based, since the standard
// morph-target list (see morphTargetMap.js) has no eye-look blend shapes,
// only eyeBlinkLeft/Right. Only activates if the rig actually has eye
// bones under one of these common names.
const EYE_BONE_CANDIDATES = {
  left: ["LeftEye", "eyeLeft", "mixamorigLeftEye", "mixamorig:LeftEye"],
  right: ["RightEye", "eyeRight", "mixamorigRightEye", "mixamorig:RightEye"],
};

const findBone = (root, names) => {
  for (const name of names) {
    const found = root?.getObjectByName?.(name);
    if (found) return found;
  }
  return null;
};

export const useEyeMovement = ({ root, enabled = true }) => {
  const leftEye = useRef(null);
  const rightEye = useRef(null);
  const resolved = useRef(false);
  const target = useRef({ x: 0, y: 0 });
  const current = useRef({ x: 0, y: 0 });
  const nextShiftAtMs = useRef(0);

  useFrame((state) => {
    if (!enabled || !root) return;
    if (!resolved.current) {
      leftEye.current = findBone(root, EYE_BONE_CANDIDATES.left);
      rightEye.current = findBone(root, EYE_BONE_CANDIDATES.right);
      resolved.current = true;
    }
    if (!leftEye.current && !rightEye.current) return;

    const nowMs = state.clock.elapsedTime * 1000;
    if (nowMs >= nextShiftAtMs.current) {
      // Small angles — a believable glance, not a cartoonish swivel.
      target.current = { x: (Math.random() - 0.5) * 0.25, y: (Math.random() - 0.5) * 0.15 };
      nextShiftAtMs.current = nowMs + 1500 + Math.random() * 2500;
    }
    current.current.x += (target.current.x - current.current.x) * 0.04;
    current.current.y += (target.current.y - current.current.y) * 0.04;

    if (leftEye.current) {
      leftEye.current.rotation.y = current.current.x;
      leftEye.current.rotation.x = current.current.y;
    }
    if (rightEye.current) {
      rightEye.current.rotation.y = current.current.x;
      rightEye.current.rotation.x = current.current.y;
    }
  });
};

export default useEyeMovement;
