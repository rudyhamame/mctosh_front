import { describe, expect, it } from "vitest";
import { buildMorpheIndex } from "./amctoshsMorpheGraph.js";

const schema = (overrides) => ({ _id: "schema-1", name: "Heart", domain: "organs", ...overrides });
const instance = (overrides) => ({ _id: "instance-1", schemaId: "schema-1", instanceName: "Heart: John", domain: "organs", ...overrides });
const traceSchema = (overrides) => ({
  _id: "trace-schema-1", name: "Heart Sound", domainOfAccess: "organs", sourceSchemaId: "schema-1", ...overrides,
});
const traceInstance = (overrides) => ({
  _id: "trace-instance-1", traceSchemaId: "trace-schema-1", sourceInstanceId: "instance-1", ...overrides,
});
const relation = (overrides) => ({ subjectType: "Schema", subjectId: "schema-1", predicate: "generates", objectType: "TraceSchema", objectId: "trace-schema-1", ...overrides });

describe("buildMorpheIndex", () => {
  it("groups a schema under its own domain", () => {
    const { byDomain } = buildMorpheIndex({ schemas: [schema()] });
    expect(byDomain.get("organs").schemas).toHaveLength(1);
    expect(byDomain.get("organs").schemas[0].name).toBe("Heart");
  });

  it("groups instances and trace schemata under their own domain, independent of their parent schema's domain", () => {
    const { byDomain } = buildMorpheIndex({
      schemas: [schema()],
      instances: [instance({ domain: "humans" })],
      traceSchemas: [traceSchema({ domainOfAccess: "molecules" })],
    });
    expect(byDomain.get("organs").schemas).toHaveLength(1);
    expect(byDomain.get("humans").instances).toHaveLength(1);
    expect(byDomain.get("molecules").traceSchemas).toHaveLength(1);
  });

  it("groups a trace instance under its PARENT TRACE SCHEMA's domain, since it has no domain of its own", () => {
    const { byDomain } = buildMorpheIndex({
      traceSchemas: [traceSchema({ domainOfAccess: "molecules" })],
      traceInstances: [traceInstance()],
    });
    expect(byDomain.get("molecules").traceInstances).toHaveLength(1);
  });

  it("indexes instances by their schemaId", () => {
    const { instancesBySchemaId } = buildMorpheIndex({ schemas: [schema()], instances: [instance()] });
    expect(instancesBySchemaId.get("schema-1")).toHaveLength(1);
  });

  it("indexes trace schemata by their sourceSchemaId", () => {
    const { traceSchemasBySchemaId } = buildMorpheIndex({ schemas: [schema()], traceSchemas: [traceSchema()] });
    expect(traceSchemasBySchemaId.get("schema-1")).toHaveLength(1);
  });

  it("indexes trace instances by both their traceSchemaId and their sourceInstanceId", () => {
    const { traceInstancesByTraceSchemaId, traceInstancesBySourceInstanceId } = buildMorpheIndex({
      traceInstances: [traceInstance()],
    });
    expect(traceInstancesByTraceSchemaId.get("trace-schema-1")).toHaveLength(1);
    expect(traceInstancesBySourceInstanceId.get("instance-1")).toHaveLength(1);
  });

  it("schemaCounts reports the right instance/trace-schema counts for a given schema", () => {
    const { schemaCounts } = buildMorpheIndex({
      schemas: [schema()],
      instances: [instance(), instance({ _id: "instance-2" })],
      traceSchemas: [traceSchema()],
    });
    expect(schemaCounts(schema())).toEqual({ instanceCount: 2, traceSchemaCount: 1 });
  });

  it("traceSchemaCounts reports the right trace-instance count for a given trace schema", () => {
    const { traceSchemaCounts } = buildMorpheIndex({
      traceSchemas: [traceSchema()],
      traceInstances: [traceInstance(), traceInstance({ _id: "trace-instance-2" })],
    });
    expect(traceSchemaCounts(traceSchema())).toEqual({ traceInstanceCount: 2 });
  });

  it("relationsFor returns outgoing relations for the subject and incoming for the object", () => {
    const { relationsFor } = buildMorpheIndex({ relations: [relation()] });
    expect(relationsFor("schema-1").outgoing).toHaveLength(1);
    expect(relationsFor("schema-1").incoming).toHaveLength(0);
    expect(relationsFor("trace-schema-1").incoming).toHaveLength(1);
    expect(relationsFor("trace-schema-1").outgoing).toHaveLength(0);
  });

  it("relationsFor returns empty buckets for an entity with no relations", () => {
    const { relationsFor } = buildMorpheIndex({});
    expect(relationsFor("nonexistent")).toEqual({ outgoing: [], incoming: [] });
  });
});
