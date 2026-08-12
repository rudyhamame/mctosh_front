import { ONTOLOGY_PHASES, clamp01, rangeProgress } from "./ontologyTimeline";

const mix = (from, to, amount) => from + ((to - from) * amount);
const easeInOutCubic = (value) => (value < 0.5
  ? 4 * value * value * value
  : 1 - (((-2 * value) + 2) ** 3) / 2);

export const ONTOLOGY_MOTION = Object.freeze({
  pressureEnabled: false,
  pressureDistanceVh: 0,
  maxWiggleXPx: 8,
  maxWiggleYPx: 0,
  maxRotationDeg: 1.25,
});

const smoothstep = (value) => {
  const bounded = clamp01(value);
  return bounded * bounded * (3 - (2 * bounded));
};

const WIGGLE_KEYFRAMES = Object.freeze([
  Object.freeze({ at: 0, x: 0, y: 0, rotation: 0 }),
  Object.freeze({ at: 0.12, x: -0.24, y: 0.18, rotation: -0.28 }),
  Object.freeze({ at: 0.27, x: 0.58, y: 0.62, rotation: 0.6 }),
  Object.freeze({ at: 0.41, x: -0.86, y: -0.44, rotation: -0.88 }),
  Object.freeze({ at: 0.56, x: 1, y: 1, rotation: 1 }),
  Object.freeze({ at: 0.7, x: -0.62, y: 0.45, rotation: -0.66 }),
  Object.freeze({ at: 0.83, x: 0.34, y: -0.22, rotation: 0.34 }),
  Object.freeze({ at: 1, x: 0, y: 0, rotation: 0 }),
]);

function sampleWiggle(progress) {
  const bounded = clamp01(progress);
  const rightIndex = WIGGLE_KEYFRAMES.findIndex((frame) => frame.at >= bounded);
  if (rightIndex <= 0) return WIGGLE_KEYFRAMES[0];
  const left = WIGGLE_KEYFRAMES[rightIndex - 1];
  const right = WIGGLE_KEYFRAMES[rightIndex];
  const local = smoothstep((bounded - left.at) / Math.max(0.0001, right.at - left.at));
  return {
    x: mix(left.x, right.x, local),
    y: mix(left.y, right.y, local),
    rotation: mix(left.rotation, right.rotation, local),
  };
}

export function getSubjectTransform(state, motion = ONTOLOGY_MOTION) {
  const { localProgress } = state;
  const stablePressureY = motion.pressureEnabled ? -motion.pressureDistanceVh : 0;
  const pressureLocal = easeInOutCubic(rangeProgress(localProgress, ONTOLOGY_PHASES.pressure));
  const pressureYVh = state.atFinalLevel
    ? 0
    : mix(stablePressureY, 0, pressureLocal);
  const fractureLocal = rangeProgress(localProgress, ONTOLOGY_PHASES.fracture);
  const wiggle = localProgress < ONTOLOGY_PHASES.fracture[0]
    || localProgress >= ONTOLOGY_PHASES.fracture[1]
    ? WIGGLE_KEYFRAMES[0]
    : sampleWiggle(fractureLocal);
  const xPx = wiggle.x * motion.maxWiggleXPx;
  const yPx = wiggle.y * motion.maxWiggleYPx;
  const rotation = wiggle.rotation * motion.maxRotationDeg;
  const compression = 1 - (pressureLocal * 0.008) - (Math.abs(wiggle.y) * 0.003);

  return {
    xPx,
    yPx,
    pressureYVh,
    rotation,
    compression,
    distanceToGroundVh: Math.max(0, -pressureYVh),
  };
}

export function getNextSubjectTransform(state, motion = ONTOLOGY_MOTION) {
  const sourceTransform = getSubjectTransform(state, motion);
  const settleProgress = smoothstep(rangeProgress(state.localProgress, [0.72, 0.9]));
  const followsHyle = 1 - settleProgress;
  return {
    xPx: sourceTransform.xPx * followsHyle,
    yPx: sourceTransform.yPx * followsHyle,
    pressureYVh: sourceTransform.pressureYVh * followsHyle,
    rotation: sourceTransform.rotation * followsHyle,
    compression: mix(sourceTransform.compression, 1, settleProgress),
    distanceToGroundVh: sourceTransform.distanceToGroundVh * followsHyle,
  };
}

export function getOntologyLayout(width, height, groundRatio) {
  const portrait = width < height;
  const resolvedGroundRatio = Number.isFinite(groundRatio)
    ? groundRatio
    : (portrait ? 0.815 : 0.83);
  return {
    width,
    subjectCenterX: width * (portrait ? 0.5 : 0.68),
    groundY: height * resolvedGroundRatio,
    particleScale: Math.max(0.72, Math.min(1.35, Math.min(width / 1440, height / 900))),
  };
}

export function getParticlePosition(particle, progress, contact) {
  if (progress < particle.startProgress) return null;
  const age = clamp01((progress - particle.startProgress) / particle.life);
  const originX = contact.x + (particle.originX * contact.scale);
  const originY = contact.y + (particle.originY * contact.scale);

  if (particle.kind === "dust") {
    const drift = particle.vx * age * contact.scale;
    const turbulence = Math.sin((age * particle.frequency) + particle.phase) * particle.turbulence * age;
    return {
      x: originX + drift + turbulence,
      y: originY + (particle.vy * age * contact.scale) - (particle.lift * age * contact.scale),
      rotation: particle.rotation + (particle.angularVelocity * age),
      size: particle.size * contact.scale * (1 + (age * particle.expansion)),
      alpha: particle.alpha * ((1 - age) ** 1.6),
    };
  }

  const flight = clamp01(age / particle.flightEnd);
  const landingX = originX + (particle.landingX * contact.scale);
  const landingY = contact.y + (particle.landingY * contact.scale);
  const arc = Math.sin(flight * Math.PI) * particle.launchHeight * contact.scale;
  const bounceAge = clamp01((age - particle.flightEnd) / Math.max(0.001, 1 - particle.flightEnd));
  const bounce = age > particle.flightEnd
    ? Math.abs(Math.sin(bounceAge * Math.PI * 3)) * particle.bounce * (1 - bounceAge) * contact.scale
    : 0;

  return {
    x: mix(originX, landingX, flight),
    y: mix(originY, landingY, flight) - arc - bounce,
    rotation: particle.rotation + (particle.angularVelocity * age),
    size: particle.size * contact.scale,
    alpha: particle.alpha,
  };
}
