import { describe, expect, it } from "vitest";
import { buildAmctoshsMorpheIndex } from "./amctoshsEntityGraph.js";

const schema = (overrides) => ({ id: "s1", type: "schema", typeLabel: "Schema", name: "Heart", domain: "Organs", createdAt: "2026-07-20T09:00:00.000Z", ...overrides });
const traceDef = (overrides) => ({ id: "t1", type: "trace", typeLabel: "Schema Trace", name: "Heart Rate", parentSchema: "Heart", createdAt: "2026-07-20T09:00:00.000Z", ...overrides });
const traceValue = (overrides) => ({ id: "v1", type: "trace_value", typeLabel: "Schema Trace Value", traceName: "Heart Rate", value: "82", unit: "bpm", createdAt: "2026-07-20T09:00:00.000Z", ...overrides });
const instance = (overrides) => ({ id: "i1", type: "instance", typeLabel: "Schema Instance", parentSchema: "Heart", traceName: "Rhythm", value: "Sinus tachycardia", createdAt: "2026-07-21T08:00:00.000Z", ...overrides });

describe("buildAmctoshsMorpheIndex", () => {
  it("groups a schema under its declared domain", () => {
    const { byDomain } = buildAmctoshsMorpheIndex([schema()]);
    expect(byDomain.get("Organs")).toHaveLength(1);
    expect(byDomain.get("Organs")[0].name).toBe("Heart");
  });

  it("resolves a trace_value's schema via its trace definition (trace_value carries no parentSchema of its own)", () => {
    const { byDomain } = buildAmctoshsMorpheIndex([schema(), traceDef(), traceValue()]);
    const heart = byDomain.get("Organs")[0];
    expect(heart.traceRows).toHaveLength(1);
    expect(heart.traceRows[0]).toMatchObject({ trace: "Heart Rate", value: "82", unit: "bpm" });
  });

  it("resolves an instance's schema directly via its own parentSchema, no trace definition required", () => {
    const { byDomain } = buildAmctoshsMorpheIndex([schema(), instance()]);
    const heart = byDomain.get("Organs")[0];
    expect(heart.traceRows).toHaveLength(1);
    expect(heart.traceRows[0]).toMatchObject({ trace: "Rhythm", value: "Sinus tachycardia" });
  });

  it("never overwrites — multiple readings of the same trace all survive as separate rows", () => {
    const { byDomain } = buildAmctoshsMorpheIndex([
      schema(),
      traceDef(),
      traceValue({ id: "v1", value: "82", createdAt: "2026-07-20T09:00:00.000Z" }),
      traceValue({ id: "v2", value: "106", createdAt: "2026-07-20T13:00:00.000Z" }),
    ]);
    const heart = byDomain.get("Organs")[0];
    expect(heart.traceRows).toHaveLength(2);
    expect(heart.traceRows.map((r) => r.value)).toEqual(["82", "106"]);
  });

  it("orders trace rows oldest -> newest by default", () => {
    const { byDomain } = buildAmctoshsMorpheIndex([
      schema(),
      traceDef(),
      traceValue({ id: "v2", value: "106", createdAt: "2026-07-20T13:00:00.000Z" }),
      traceValue({ id: "v1", value: "82", createdAt: "2026-07-20T09:00:00.000Z" }),
    ]);
    const heart = byDomain.get("Organs")[0];
    expect(heart.traceRows.map((r) => r.value)).toEqual(["82", "106"]);
  });

  it("schema name matching is case-insensitive, same as EntityBuilderPanel's own schemaOptions dedup", () => {
    const { byDomain } = buildAmctoshsMorpheIndex([
      schema({ name: "Heart" }),
      traceDef({ parentSchema: "HEART" }),
      traceValue(),
    ]);
    expect(byDomain.get("Organs")[0].traceRows).toHaveLength(1);
  });

  it("dedupes duplicate schema records with the same name, first-created wins", () => {
    const { byDomain } = buildAmctoshsMorpheIndex([
      schema({ id: "s1", createdAt: "2026-07-20T09:00:00.000Z" }),
      schema({ id: "s2", createdAt: "2026-07-20T10:00:00.000Z" }),
    ]);
    expect(byDomain.get("Organs")).toHaveLength(1);
    expect(byDomain.get("Organs")[0].id).toBe("s1");
  });

  it("buckets a trace_value that matches no known trace/schema into unlinkedRows instead of dropping it", () => {
    const { unlinkedRows } = buildAmctoshsMorpheIndex([traceValue({ traceName: "Mystery Trace" })]);
    expect(unlinkedRows).toHaveLength(1);
    expect(unlinkedRows[0].trace).toBe("Mystery Trace");
  });

  it("buckets a schema with an unrecognized/blank domain into 'Unassigned Domain' instead of dropping it", () => {
    const { byDomain } = buildAmctoshsMorpheIndex([schema({ domain: "" })]);
    expect(byDomain.get("Unassigned Domain")).toHaveLength(1);
  });

  it("returns every canonical ENTITY_DOMAINS key even when empty", () => {
    const { byDomain } = buildAmctoshsMorpheIndex([]);
    expect(byDomain.get("Atoms")).toEqual([]);
    expect(byDomain.get("Societies")).toEqual([]);
  });
});
