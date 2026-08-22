import { describe, expect, it } from "vitest";
import { ONTOLOGY_LEVELS, ONTOLOGY_SCENE_LEVELS, ONTOLOGY_TRANSITION_COUNT, RABBIT_HOLE_SCROLL_TRANSITIONS } from "./ontologyLevels";
import { ONTOLOGY_SUBJECT_SWAP_PROGRESS, getOntologyVisualState } from "./ontologyTimeline";

describe("Rabbit Hole ontology timeline", () => {
  it("defines the requested ontology in exact descending order", () => {
    expect(ONTOLOGY_LEVELS.map(({ index, label }) => `${index} / ${label}`)).toEqual([
      "00 / HYLE",
      "01 / SOCIETY",
      "02 / HUMANS",
      "03 / SYSTEMS",
      "04 / ORGANS",
      "05 / TISSUES",
      "06 / CELLS",
      "07 / MOLECULES",
      "08 / ATOMS",
    ]);
    expect(ONTOLOGY_TRANSITION_COUNT).toBe(7);
    expect(RABBIT_HOLE_SCROLL_TRANSITIONS).toBe(8);
  });

  it("maps every exact depth boundary to one stable ontology level", () => {
    ONTOLOGY_SCENE_LEVELS.forEach((level, index) => {
      const state = getOntologyVisualState(index);
      expect(state.viewportProgress).toBe(index);
      expect(state.fromLevel).toBe(level);
      expect(state.localProgress).toBe(0);
      expect(state.phase).toBe("ORIENT");
      expect(state.nextLevelReveal).toBe(0);
    });
  });

  it("interpolates continuously in both directions", () => {
    const forward = getOntologyVisualState(2.56);
    getOntologyVisualState(5.2);
    getOntologyVisualState(0.1);
    const backward = getOntologyVisualState(2.56);
    expect(backward).toEqual(forward);
    expect(forward.fromLevel.id).toBe("systems");
    expect(forward.toLevel.id).toBe("organs");
    expect(forward.localProgress).toBeCloseTo(0.56, 10);
  });

  it("clamps above societies and below atoms", () => {
    expect(getOntologyVisualState(-10).fromLevel.id).toBe("societies");
    const finalState = getOntologyVisualState(99);
    expect(finalState.fromLevel.id).toBe("atoms");
    expect(finalState.toLevel.id).toBe("atoms");
    expect(finalState.localProgress).toBe(0);
  });

  it("hands the current-depth indicator to the incoming level during resolution", () => {
    expect(ONTOLOGY_SUBJECT_SWAP_PROGRESS).toBeGreaterThan(0.7);
    expect(ONTOLOGY_SUBJECT_SWAP_PROGRESS).toBeLessThan(0.8);
  });
});
