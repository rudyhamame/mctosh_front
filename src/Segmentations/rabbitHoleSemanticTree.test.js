import { describe, expect, it } from "vitest";
import { buildStrictPhysicalBlockHierarchy } from "./rabbitHoleSemanticTree.js";

describe("buildStrictPhysicalBlockHierarchy", () => {
  it("preserves strict linguistic levels and materializes canonical characters", () => {
    const chars = Array.from("Heart");
    const nodes = [
      { entityId: "s1", entityType: "sentence", parentEntityId: "p1", payload: { canonicalSpan: { start: 0, end: 5 } } },
      { entityId: "c1", entityType: "clause", parentEntityId: "s1", payload: { canonicalSpan: { start: 0, end: 5 } } },
      { entityId: "ph1", entityType: "phrase", parentEntityId: "c1", payload: { canonicalSpan: { start: 0, end: 5 } } },
      { entityId: "w1", entityType: "word", parentEntityId: "ph1", payload: { canonicalSpan: { start: 0, end: 5 }, resolvedText: "Heart" } },
    ];
    const result = buildStrictPhysicalBlockHierarchy({ block: { id: "b1", canonicalSpans: [{ start: 0, end: 5 }] }, nodes, canonicalCharacters: chars });
    expect(result.map((node) => node.entityType)).toEqual(["sentence", "clause", "phrase", "word", "morpheme", "character", "character", "character", "character", "character"]);
    expect(result.find((node) => node.entityType === "morpheme")?.payload.structuralPlaceholder).toBe(true);
    expect(result.filter((node) => node.entityType === "character").map((node) => node.payload.value).join("")).toBe("Heart");
  });

  it("fills missing clause and phrase levels without claiming linguistic certainty", () => {
    const nodes = [
      { entityId: "s1", entityType: "sentence", payload: { canonicalSpan: { start: 0, end: 2 } } },
      { entityId: "w1", entityType: "word", parentEntityId: "s1", payload: { canonicalSpan: { start: 0, end: 2 }, resolvedText: "Hi" } },
    ];
    const result = buildStrictPhysicalBlockHierarchy({ block: { id: "b1", canonicalSpans: [{ start: 0, end: 2 }] }, nodes, canonicalCharacters: Array.from("Hi") });
    expect(result.slice(0, 5).map((node) => node.entityType)).toEqual(["sentence", "clause", "phrase", "word", "morpheme"]);
    expect(result.filter((node) => ["clause", "phrase", "morpheme"].includes(node.entityType)).every((node) => node.payload.structuralPlaceholder)).toBe(true);
  });
});
