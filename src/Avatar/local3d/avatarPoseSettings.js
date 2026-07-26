import { DEFAULT_ARM_POSE } from "./hooks/useRelaxedPosture";

export const AVATAR_POSE_SETTINGS_KEY = "mctosh_local3d_avatar_pose";
export const AVATAR_POSE_UPDATED_EVENT = "mctosh-local3d-pose-updated";

export const AVATAR_POSE_CONTROLS = [
  { key: "shoulderX", label: "Shoulder Down", min: -1, max: 0.65, step: 0.01 },
  { key: "shoulderZ", label: "Shoulder Spread", min: -0.75, max: 0.75, step: 0.01 },
  { key: "armX", label: "Arm Down", min: -3, max: 1, step: 0.01 },
  { key: "armY", label: "Arm Front", min: -0.9, max: 0.9, step: 0.01 },
  { key: "armZ", label: "Arm Side", min: -0.9, max: 0.9, step: 0.01 },
  { key: "forearmX", label: "Forearm Down", min: -1.35, max: 0.8, step: 0.01 },
  { key: "forearmY", label: "Forearm Front", min: -0.75, max: 0.75, step: 0.01 },
];

export const readSavedPose = () => {
  try {
    const raw = localStorage.getItem(AVATAR_POSE_SETTINGS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_ARM_POSE };
    return {
      shoulderX: Number.isFinite(parsed.shoulderX) ? parsed.shoulderX : DEFAULT_ARM_POSE.shoulderX,
      shoulderZ: Number.isFinite(parsed.shoulderZ) ? parsed.shoulderZ : DEFAULT_ARM_POSE.shoulderZ,
      armX: Number.isFinite(parsed.armX) ? parsed.armX : DEFAULT_ARM_POSE.armX,
      armY: Number.isFinite(parsed.armY) ? parsed.armY : DEFAULT_ARM_POSE.armY,
      armZ: Number.isFinite(parsed.armZ) ? parsed.armZ : DEFAULT_ARM_POSE.armZ,
      forearmX: Number.isFinite(parsed.forearmX) ? parsed.forearmX : DEFAULT_ARM_POSE.forearmX,
      forearmY: Number.isFinite(parsed.forearmY) ? parsed.forearmY : DEFAULT_ARM_POSE.forearmY,
    };
  } catch {
    return { ...DEFAULT_ARM_POSE };
  }
};

export const writeSavedPose = (pose) => {
  const next = {
    shoulderX: Number.isFinite(pose?.shoulderX) ? pose.shoulderX : DEFAULT_ARM_POSE.shoulderX,
    shoulderZ: Number.isFinite(pose?.shoulderZ) ? pose.shoulderZ : DEFAULT_ARM_POSE.shoulderZ,
    armX: Number.isFinite(pose?.armX) ? pose.armX : DEFAULT_ARM_POSE.armX,
    armY: Number.isFinite(pose?.armY) ? pose.armY : DEFAULT_ARM_POSE.armY,
    armZ: Number.isFinite(pose?.armZ) ? pose.armZ : DEFAULT_ARM_POSE.armZ,
    forearmX: Number.isFinite(pose?.forearmX) ? pose.forearmX : DEFAULT_ARM_POSE.forearmX,
    forearmY: Number.isFinite(pose?.forearmY) ? pose.forearmY : DEFAULT_ARM_POSE.forearmY,
  };
  localStorage.setItem(AVATAR_POSE_SETTINGS_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(AVATAR_POSE_UPDATED_EVENT, { detail: next }));
  return next;
};

export const emitAvatarPoseUpdate = (pose) => {
  const next = {
    shoulderX: Number.isFinite(pose?.shoulderX) ? pose.shoulderX : DEFAULT_ARM_POSE.shoulderX,
    shoulderZ: Number.isFinite(pose?.shoulderZ) ? pose.shoulderZ : DEFAULT_ARM_POSE.shoulderZ,
    armX: Number.isFinite(pose?.armX) ? pose.armX : DEFAULT_ARM_POSE.armX,
    armY: Number.isFinite(pose?.armY) ? pose.armY : DEFAULT_ARM_POSE.armY,
    armZ: Number.isFinite(pose?.armZ) ? pose.armZ : DEFAULT_ARM_POSE.armZ,
    forearmX: Number.isFinite(pose?.forearmX) ? pose.forearmX : DEFAULT_ARM_POSE.forearmX,
    forearmY: Number.isFinite(pose?.forearmY) ? pose.forearmY : DEFAULT_ARM_POSE.forearmY,
  };
  window.dispatchEvent(new CustomEvent(AVATAR_POSE_UPDATED_EVENT, { detail: next }));
  return next;
};
