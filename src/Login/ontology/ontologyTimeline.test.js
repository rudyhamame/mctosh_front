import { describe, expect, it } from "vitest";
import { ONTOLOGY_LEVELS } from "./ontologyLevels";
import { ONTOLOGY_MOTION, getNextSubjectTransform, getSubjectTransform } from "./ontologyPhysics";
import { createOntologyParticles, getOntologyParticleCounts } from "./ontologyParticles";
import { ONTOLOGY_SUBJECT_SWAP_PROGRESS, getOntologyVisualState } from "./ontologyTimeline";

describe("ontology viewport timeline", () => {
  it("increases every debris class for each successive ontology transition", () => {
    const first = getOntologyParticleCounts(0);
    const second = getOntologyParticleCounts(1);
    expect(second.fragment).toBeGreaterThan(first.fragment);
    expect(second.grit).toBeGreaterThan(first.grit);
    expect(second.dust).toBeGreaterThan(first.dust);
    expect(createOntologyParticles(1).length).toBeGreaterThan(createOntologyParticles(0).length);
  });

  it("maps every exact viewport boundary to one stable ontology level", () => {
    ONTOLOGY_LEVELS.forEach((level, index) => {
      const state = getOntologyVisualState(index);
      expect(state.viewportProgress).toBe(index);
      expect(state.fromLevel).toBe(level);
      expect(state.localProgress).toBe(0);
      expect(state.phase).toBe("HOLD");
      expect(state.nextLevelReveal).toBe(0);
      expect(state.pressureAmount).toBe(0);
    });
  });

  it.each([
    [0, "Hyle", "Societies", 0, "HOLD"],
    [0.5, "Hyle", "Societies", 0.5, "FRACTURE"],
    [0.65, "Hyle", "Societies", 0.65, "FRAGMENTATION"],
    [1, "Societies", "Humans", 0, "HOLD"],
    [1.65, "Societies", "Humans", 0.65, "FRAGMENTATION"],
    [2, "Humans", "Organ Systems", 0, "HOLD"],
    [2.65, "Humans", "Organ Systems", 0.65, "FRAGMENTATION"],
    [3, "Organ Systems", "Organs", 0, "HOLD"],
    [3.65, "Organ Systems", "Organs", 0.65, "FRAGMENTATION"],
    [4, "Organs", "Tissues", 0, "HOLD"],
    [4.65, "Organs", "Tissues", 0.65, "FRAGMENTATION"],
    [5, "Tissues", "Tissues", 0, "HOLD"],
  ])(
    "derives the requested debug state at viewportProgress %s",
    (progress, from, to, localProgress, phase) => {
      const state = getOntologyVisualState(progress);
      expect(state.fromLevel.label).toBe(from);
      expect(state.toLevel.label).toBe(to);
      expect(state.localProgress).toBeCloseTo(localProgress, 10);
      expect(state.phase).toBe(phase);
    },
  );

  it("reconstructs an identical state after forward and backward traversal", () => {
    const original = getOntologyVisualState(0.55);
    getOntologyVisualState(1);
    getOntologyVisualState(0);
    expect(getOntologyVisualState(0.55)).toEqual(original);
  });

  it("clamps before Hyle and after Tissues", () => {
    expect(getOntologyVisualState(-10).fromLevel.id).toBe("hyle");
    const finalState = getOntologyVisualState(99);
    expect(finalState.fromLevel.id).toBe("tissues");
    expect(finalState.toLevel.id).toBe("tissues");
    expect(finalState.localProgress).toBe(0);
  });

  it("keeps the subject on its ground-contact anchor", () => {
    const stable = getSubjectTransform(getOntologyVisualState(0));
    const pressure = getSubjectTransform(getOntologyVisualState(0.25));
    const contact = getSubjectTransform(getOntologyVisualState(0.3));
    [stable, pressure, contact].forEach((transform) => {
      expect(transform.pressureYVh).toBe(0);
      expect(transform.yPx).toBe(0);
      expect(transform.distanceToGroundVh).toBe(0);
    });
  });

  it("keeps the fixed anchor and bounds every deterministic wiggle", () => {
    for (let step = 0; step <= 1000; step += 1) {
      const transform = getSubjectTransform(getOntologyVisualState(step / 1000));
      expect(Math.abs(transform.xPx)).toBeLessThanOrEqual(ONTOLOGY_MOTION.maxWiggleXPx);
      expect(Math.abs(transform.yPx)).toBeLessThanOrEqual(ONTOLOGY_MOTION.maxWiggleYPx);
      expect(Math.abs(transform.rotation)).toBeLessThanOrEqual(ONTOLOGY_MOTION.maxRotationDeg);
    }
    expect(getSubjectTransform(getOntologyVisualState(0.3)).xPx).toBe(0);
    expect(getSubjectTransform(getOntologyVisualState(0.9)).xPx).toBe(0);
  });

  it("reconstructs exactly the same in-place wiggle for the same progress", () => {
    const first = getSubjectTransform(getOntologyVisualState(0.65));
    getSubjectTransform(getOntologyVisualState(0.2));
    getSubjectTransform(getOntologyVisualState(0.9));
    expect(getSubjectTransform(getOntologyVisualState(0.65))).toEqual(first);
  });

  it("keeps the Society handoff at 100vh", () => {
    expect(ONTOLOGY_SUBJECT_SWAP_PROGRESS).toBe(1);
    const earlyState = getOntologyVisualState(0.55);
    const hyle = getSubjectTransform(earlyState);
    const society = getNextSubjectTransform(earlyState);
    expect(society.xPx).toBeCloseTo(hyle.xPx, 6);
    expect(society.yPx).toBeCloseTo(hyle.yPx, 6);
    expect(society.rotation).toBeCloseTo(hyle.rotation, 6);

    const settled = getNextSubjectTransform(getOntologyVisualState(0.9));
    expect(settled.xPx).toBe(0);
    expect(settled.yPx).toBe(0);
    expect(settled.rotation).toBe(0);
    expect(settled.compression).toBe(1);
  });
});
