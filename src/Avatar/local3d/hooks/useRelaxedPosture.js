import { useRef } from "react";
import { useFrame } from "@react-three/fiber";

const LEFT_SHOULDER_CANDIDATES = ["LeftShoulder", "mixamorigLeftShoulder", "mixamorig:LeftShoulder", "Shoulder.L"];
const RIGHT_SHOULDER_CANDIDATES = ["RightShoulder", "mixamorigRightShoulder", "mixamorig:RightShoulder", "Shoulder.R"];
const LEFT_ARM_CANDIDATES = ["LeftArm", "LeftUpperArm", "mixamorigLeftArm", "mixamorig:LeftArm", "UpperArm.L"];
const RIGHT_ARM_CANDIDATES = ["RightArm", "RightUpperArm", "mixamorigRightArm", "mixamorig:RightArm", "UpperArm.R"];
const LEFT_FOREARM_CANDIDATES = ["LeftForeArm", "LeftLowerArm", "mixamorigLeftForeArm", "mixamorig:LeftForeArm", "ForeArm.L"];
const RIGHT_FOREARM_CANDIDATES = ["RightForeArm", "RightLowerArm", "mixamorigRightForeArm", "mixamorig:RightForeArm", "ForeArm.R"];

const EASE_RATE = 0.12;

const findBone = (root, names) => {
  for (const name of names) {
    const found = root?.getObjectByName?.(name);
    if (found) return found;
  }
  return null;
};

const easeRotation = (bone, base, offsets) => {
  if (!bone || !base) return;
  bone.rotation.x += ((base.x + (offsets.x || 0)) - bone.rotation.x) * EASE_RATE;
  bone.rotation.y += ((base.y + (offsets.y || 0)) - bone.rotation.y) * EASE_RATE;
  bone.rotation.z += ((base.z + (offsets.z || 0)) - bone.rotation.z) * EASE_RATE;
};

const DEFAULT_ARM_POSE = {
  shoulderX: 0.06,
  shoulderZ: 0,
  armX: 0.18,
  armY: 0.02,
  armZ: 0,
  forearmX: 0.1,
  forearmY: 0,
};

export const useRelaxedPosture = ({ root, enabled = true, postureRef }) => {
  const resolved = useRef(false);
  const bonesRef = useRef({
    leftShoulder: null,
    rightShoulder: null,
    leftArm: null,
    rightArm: null,
    leftForearm: null,
    rightForearm: null,
  });
  const basesRef = useRef({});

  useFrame(() => {
    if (!enabled || !root) return;
    const posture = postureRef?.current || DEFAULT_ARM_POSE;

    if (!resolved.current) {
      const bones = {
        leftShoulder: findBone(root, LEFT_SHOULDER_CANDIDATES),
        rightShoulder: findBone(root, RIGHT_SHOULDER_CANDIDATES),
        leftArm: findBone(root, LEFT_ARM_CANDIDATES),
        rightArm: findBone(root, RIGHT_ARM_CANDIDATES),
        leftForearm: findBone(root, LEFT_FOREARM_CANDIDATES),
        rightForearm: findBone(root, RIGHT_FOREARM_CANDIDATES),
      };
      bonesRef.current = bones;
      basesRef.current = Object.fromEntries(
        Object.entries(bones)
          .filter(([, bone]) => bone)
          .map(([key, bone]) => [key, bone.rotation.clone()])
      );
      resolved.current = true;
    }

    easeRotation(bonesRef.current.leftShoulder, basesRef.current.leftShoulder, {
      x: posture.shoulderX,
      y: 0,
      z: posture.shoulderZ,
    });
    easeRotation(bonesRef.current.rightShoulder, basesRef.current.rightShoulder, {
      x: posture.shoulderX,
      y: 0,
      z: -posture.shoulderZ,
    });
    easeRotation(bonesRef.current.leftArm, basesRef.current.leftArm, {
      x: posture.armX,
      y: -posture.armY,
      z: posture.armZ,
    });
    easeRotation(bonesRef.current.rightArm, basesRef.current.rightArm, {
      x: posture.armX,
      y: posture.armY,
      z: -posture.armZ,
    });
    easeRotation(bonesRef.current.leftForearm, basesRef.current.leftForearm, {
      x: posture.forearmX,
      y: -posture.forearmY,
      z: 0,
    });
    easeRotation(bonesRef.current.rightForearm, basesRef.current.rightForearm, {
      x: posture.forearmX,
      y: posture.forearmY,
      z: 0,
    });
  });
};

export default useRelaxedPosture;
export { DEFAULT_ARM_POSE };
