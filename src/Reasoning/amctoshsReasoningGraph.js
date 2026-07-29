// amctoshsReasoningGraph.js
//
// Pure client-side indexing over AMCTOSHS Reasoning's saved data
// ({reasoningEntities, relations} — the shape GET /api/amctoshs-reasoning
// returns). Same no-DOM/React, fully-unit-testable spirit as
// ClinicalSchemata/amctoshsMorpheGraph.js; kept as its own small module
// rather than importing that one, since Reasoning's index is keyed by
// reasoningType, not AMCTOSHS Domain.

export const buildReasoningIndex = ({ reasoningEntities = [], relations = [] } = {}) => {
  const byType = new Map(); // reasoningType -> entity[]
  for (const entity of reasoningEntities) {
    if (!byType.has(entity.reasoningType)) byType.set(entity.reasoningType, []);
    byType.get(entity.reasoningType).push(entity);
  }

  const relationsByEntityId = new Map();
  const ensureBucket = (id) => {
    const key = String(id);
    if (!relationsByEntityId.has(key)) relationsByEntityId.set(key, { outgoing: [], incoming: [] });
    return relationsByEntityId.get(key);
  };
  for (const relation of relations) {
    ensureBucket(relation.subjectId).outgoing.push(relation);
    ensureBucket(relation.objectId).incoming.push(relation);
  }

  return {
    byType,
    relationsFor: (id) => relationsByEntityId.get(String(id)) || { outgoing: [], incoming: [] },
  };
};
