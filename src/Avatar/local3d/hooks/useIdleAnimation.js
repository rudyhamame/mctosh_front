import { useRef } from "react";
import { useFrame } from "@react-three/fiber";

// Subtle idle head sway/breathing — bone-rotation based (not a morph
// target; no standard head-sway blend shape exists), so it only activates
// if the loaded rig actually has a bone under one of these common names.
// Silently does nothing otherwise rather than guessing at a bone that
// doesn't exist.
const HEAD_BONE_CANDIDATES = ["Head", "head", "mixamorigHead", "mixamorig:Head", "Neck", "neck"];

const findBone = (root, names) => {
  for (const name of names) {
    const found = root?.getObjectByName?.(name);
    if (found) return found;
  }
  return null;
};

export const useIdleAnimation = ({ root, enabled = true }) => {
  const headBone = useRef(null);
  const baseRotation = useRef(null);
  const resolved = useRef(false);

  useFrame((state) => {
    if (!enabled || !root) return;
    if (!resolved.current) {
      headBone.current = findBone(root, HEAD_BONE_CANDIDATES);
      if (headBone.current) baseRotation.current = headBone.current.rotation.clone();
      resolved.current = true;
    }
    if (!headBone.current || !baseRotation.current) return;

    const t = state.clock.elapsedTime;
    // Three independent slow sine waves, out of phase, read as organic
    // sway/breathing rather than a mechanical single-axis nod.
    headBone.current.rotation.x = baseRotation.current.x + Math.sin(t * 0.6) * 0.015;
    headBone.current.rotation.y = baseRotation.current.y + Math.sin(t * 0.35) * 0.02;
    headBone.current.rotation.z = baseRotation.current.z + Math.sin(t * 0.5) * 0.008;
  });
};

export default useIdleAnimation;
