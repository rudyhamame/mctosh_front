import { ONTOLOGY_SCENE_LEVELS, ONTOLOGY_TRANSITION_COUNT } from "./ontologyLevels";

export const ONTOLOGY_PHASES = Object.freeze({
  hold: [0, 0.18],
  pressure: [0.18, 0.38],
  fracture: [0.34, 0.72],
  reorganize: [0.42, 0.9],
  fragmentation: [0.58, 0.78],
  settle: [0.9, 1],
});

export const ONTOLOGY_SUBJECT_SWAP_PROGRESS = 0.74;

export const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
export const clamp01 = (value) => clamp(value, 0, 1);

export function rangeProgress(value, [start, end]) {
  return clamp01((value - start) / Math.max(0.0001, end - start));
}

export function getOntologyPhase(localProgress) {
  if (localProgress < ONTOLOGY_PHASES.hold[1]) return "ORIENT";
  if (localProgress < ONTOLOGY_PHASES.pressure[1]) return "ACQUIRE";
  if (localProgress < ONTOLOGY_PHASES.fragmentation[0]) return "MAGNIFY";
  if (localProgress < ONTOLOGY_PHASES.fragmentation[1]) return "PENETRATE";
  if (localProgress < ONTOLOGY_PHASES.settle[0]) return "EMERGE";
  return "RESOLVE";
}

export function getOntologyVisualState(rawViewportProgress) {
  const viewportProgress = clamp(rawViewportProgress, 0, ONTOLOGY_TRANSITION_COUNT);
  const atFinalLevel = viewportProgress >= ONTOLOGY_TRANSITION_COUNT;
  const fromIndex = atFinalLevel ? ONTOLOGY_TRANSITION_COUNT : Math.floor(viewportProgress);
  const toIndex = Math.min(fromIndex + 1, ONTOLOGY_TRANSITION_COUNT);
  const localProgress = atFinalLevel ? 0 : viewportProgress - fromIndex;
  const pressureAmount = rangeProgress(localProgress, ONTOLOGY_PHASES.pressure);

  return {
    viewportProgress,
    fromIndex,
    toIndex,
    transitionIndex: Math.max(0, Math.min(fromIndex, ONTOLOGY_TRANSITION_COUNT - 1)),
    fromLevel: ONTOLOGY_SCENE_LEVELS[fromIndex],
    toLevel: ONTOLOGY_SCENE_LEVELS[toIndex],
    localProgress,
    phase: getOntologyPhase(localProgress),
    pressureAmount,
    fractureAmount: rangeProgress(localProgress, ONTOLOGY_PHASES.fracture),
    nextLevelReveal: rangeProgress(localProgress, ONTOLOGY_PHASES.reorganize),
    debrisAmount: rangeProgress(localProgress, [ONTOLOGY_PHASES.pressure[0], ONTOLOGY_PHASES.settle[0]]),
    atFinalLevel,
  };
}
