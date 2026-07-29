import { describe, expect, it } from "vitest";
import { buildReasoningIndex } from "./amctoshsReasoningGraph.js";

const entity = (overrides) => ({ _id: "reasoning-1", name: "Heart Rate", reasoningType: "calculated_quantity", ...overrides });
const relation = (overrides) => ({ subjectType: "ReasoningDependentEntity", subjectId: "reasoning-1", predicate: "depends_on", objectType: "Schema", objectId: "schema-1", ...overrides });

describe("buildReasoningIndex", () => {
  it("groups entities by their own reasoningType", () => {
    const { byType } = buildReasoningIndex({
      reasoningEntities: [entity(), entity({ _id: "reasoning-2", name: "Bradycardia", reasoningType: "classification" })],
    });
    expect(byType.get("calculated_quantity")).toHaveLength(1);
    expect(byType.get("classification")).toHaveLength(1);
  });

  it("relationsFor returns outgoing for the subject and incoming for the object", () => {
    const { relationsFor } = buildReasoningIndex({ relations: [relation()] });
    expect(relationsFor("reasoning-1").outgoing).toHaveLength(1);
    expect(relationsFor("schema-1").incoming).toHaveLength(1);
  });

  it("relationsFor returns empty buckets for an entity with no relations", () => {
    const { relationsFor } = buildReasoningIndex({});
    expect(relationsFor("nonexistent")).toEqual({ outgoing: [], incoming: [] });
  });
});
