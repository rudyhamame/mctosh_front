export const ONTOLOGY_PARTICLE_COUNTS = Object.freeze({ fragment: 52, grit: 188, dust: 144 });
export const ONTOLOGY_PARTICLE_INCREASE_PER_LEVEL = Object.freeze({
  fragment: 12,
  grit: 36,
  dust: 24,
});
// +1000% means the original quantity plus ten additional copies: 11x total.
export const ONTOLOGY_DEBRIS_QUANTITY_MULTIPLIER = 11;

export function getOntologyParticleCounts(transitionIndex) {
  const levelIncrease = Math.max(0, Math.floor(transitionIndex));
  return {
    fragment: (ONTOLOGY_PARTICLE_COUNTS.fragment
      + (ONTOLOGY_PARTICLE_INCREASE_PER_LEVEL.fragment * levelIncrease))
      * ONTOLOGY_DEBRIS_QUANTITY_MULTIPLIER,
    grit: (ONTOLOGY_PARTICLE_COUNTS.grit
      + (ONTOLOGY_PARTICLE_INCREASE_PER_LEVEL.grit * levelIncrease))
      * ONTOLOGY_DEBRIS_QUANTITY_MULTIPLIER,
    dust: (ONTOLOGY_PARTICLE_COUNTS.dust
      + (ONTOLOGY_PARTICLE_INCREASE_PER_LEVEL.dust * levelIncrease))
      * ONTOLOGY_DEBRIS_QUANTITY_MULTIPLIER,
  };
}

const EMISSION_WINDOWS = Object.freeze([
  [0.18, 0.3],
  [0.3, 0.48],
  [0.48, 0.62],
  [0.58, 0.78],
]);

function mulberry32(seed) {
  return () => {
    let value = seed += 0x6D2B79F5;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const between = (random, minimum, maximum) => minimum + ((maximum - minimum) * random());

function pickWindow(random) {
  const roll = random();
  if (roll < 0.24) return EMISSION_WINDOWS[0];
  if (roll < 0.52) return EMISSION_WINDOWS[1];
  if (roll < 0.82) return EMISSION_WINDOWS[2];
  return EMISSION_WINDOWS[3];
}

function createSolid(random, kind, index) {
  const [start, end] = pickWindow(random);
  const isFragment = kind === "fragment";
  const longThrow = random() < (isFragment ? 0.42 : 0.28);
  const landingDistance = longThrow
    ? between(random, isFragment ? 170 : 105, isFragment ? 330 : 230)
    : between(random, isFragment ? 58 : 24, isFragment ? 210 : 150);
  const fanAngle = between(random, 0, Math.PI);
  const fanDepth = Math.sin(fanAngle);
  const sides = Math.floor(between(random, 4, 6.99));
  return {
    id: `${kind}-${index}`,
    kind,
    startProgress: between(random, start, end),
    life: between(random, isFragment ? 0.15 : 0.1, isFragment ? 0.3 : 0.22),
    originX: between(random, -48, 48),
    originY: between(random, -12, 5),
    landingX: Math.cos(fanAngle) * landingDistance,
    landingY: (fanDepth * landingDistance * 0.34) + between(random, -7, 9),
    launchHeight: between(random, isFragment ? 12 : 4, isFragment ? 58 : 24)
      + (fanDepth * (isFragment ? 32 : 14)),
    flightEnd: between(random, 0.48, 0.84),
    bounce: between(random, isFragment ? 3 : 1, isFragment ? 18 : 8),
    rotation: between(random, 0, Math.PI * 2),
    angularVelocity: between(random, -8, 8),
    size: between(random, isFragment ? 7 : 1.5, isFragment ? 27 : 7),
    alpha: between(random, 0.42, 0.76),
    sides,
    vertexScales: Array.from({ length: sides }, () => between(random, 0.72, 1.08)),
    tone: between(random, -12, 12),
    depthRatio: between(random, isFragment ? 0.16 : 0.1, isFragment ? 0.34 : 0.24),
  };
}

function createDust(random, index) {
  const [start, end] = pickWindow(random);
  const fanAngle = between(random, 0, Math.PI);
  const fanSpeed = between(random, 45, 190);
  return {
    id: `dust-${index}`,
    kind: "dust",
    startProgress: between(random, start, end),
    life: between(random, 0.09, 0.2),
    originX: between(random, -46, 46),
    originY: between(random, -15, 4),
    vx: Math.cos(fanAngle) * fanSpeed,
    vy: between(random, -18, 10),
    lift: between(random, 38, 92) + (Math.sin(fanAngle) * fanSpeed * 0.72),
    turbulence: between(random, 7, 34),
    frequency: between(random, 4, 17),
    phase: between(random, 0, Math.PI * 2),
    rotation: between(random, 0, Math.PI * 2),
    angularVelocity: between(random, -2, 2),
    size: between(random, 5, 17),
    expansion: between(random, 1.1, 2.7),
    alpha: between(random, 0.07, 0.19),
  };
}

export function createOntologyParticles(transitionIndex) {
  const random = mulberry32(481516 + (transitionIndex * 10007));
  const counts = getOntologyParticleCounts(transitionIndex);
  const particles = [];
  for (let index = 0; index < counts.fragment; index += 1) {
    particles.push(createSolid(random, "fragment", index));
  }
  for (let index = 0; index < counts.grit; index += 1) {
    particles.push(createSolid(random, "grit", index));
  }
  for (let index = 0; index < counts.dust; index += 1) {
    particles.push(createDust(random, index));
  }
  return particles.sort((left, right) => left.startProgress - right.startProgress);
}
