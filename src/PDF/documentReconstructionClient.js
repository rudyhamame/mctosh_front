import { apiUrl } from "../config/api.js";
import { readStoredSession } from "../utils/sessionCleanup.js";

const headers = () => {
  const token = readStoredSession()?.token || "";
  return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
};
const request = async (path, options = {}) => {
  const controller = new AbortController();
  const upstreamSignal = options.signal;
  const forwardAbort = () => controller.abort(upstreamSignal?.reason);
  if (upstreamSignal?.aborted) forwardAbort();
  else upstreamSignal?.addEventListener("abort", forwardAbort, { once: true });
  const timeout = globalThis.setTimeout(() => controller.abort(new Error("Reconstruction request timed out.")), 45000);
  try {
    const response = await fetch(apiUrl(path), { ...options, signal: controller.signal, headers: { ...headers(), ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) {
      const message = data.error?.message || data.error || `Reconstruction request failed (${response.status}).`;
      const error = new Error(`${message} [${response.status} ${path}]`);
      error.status = response.status;
      error.path = path;
      throw error;
    }
    return data;
  } catch (error) {
    if (controller.signal.aborted && !upstreamSignal?.aborted) {
      const timeoutError = new Error(`Reconstruction request timed out. [504 ${path}]`);
      timeoutError.status = 504;
      timeoutError.path = path;
      throw timeoutError;
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
    upstreamSignal?.removeEventListener("abort", forwardAbort);
  }
};
const batches = (records, size = 500) => Array.from({ length: Math.ceil(records.length / size) }, (_, index) => records.slice(index * size, (index + 1) * size));

const logicalNodes = (result) => {
  const lexemeById = new Map((result.lexemes || []).map((lexeme) => [lexeme.id, lexeme]));
  const compactPayload = (entity, entityType) => {
    if (["word", "morpheme"].includes(entityType)) return entity;
    const { sourceRefs = [], ...payload } = entity;
    return { ...payload, sourceRefSummary: sourceRefs.length ? { count: sourceRefs.length, first: sourceRefs[0], last: sourceRefs.at(-1) } : null };
  };
  const node = (entity, entityType, parentEntityId) => {
    const payload = compactPayload(entity, entityType);
    if (entityType === "word" && entity.lexemeId) payload.lexeme = lexemeById.get(entity.lexemeId) || { id: entity.lexemeId };
    return { entityId: entity.id, entityType, parentEntityId, displayIndex: entity.displayIndex ?? entity.rowIndex ?? entity.columnIndex, pageIndexes: entity.pageIndexes || (Number.isInteger(entity.pageIndex) ? [entity.pageIndex] : []), payload };
  };
  return [
    node(result.source, "document", null),
    ...(result.physical?.lines || []).map((entity) => node(entity, "physical-line", result.source.id)),
    ...(result.physical?.tables || []).flatMap((table) => [
      node(table, "table", result.source.id),
      ...table.rows.flatMap((row) => [node({ ...row, pageIndex: table.pageIndex }, "table-row", table.id), ...row.cells.map((cell) => node({ ...cell, pageIndex: table.pageIndex }, "table-cell", row.id))]),
    ]),
    ...(result.physical?.blocks || []).map((entity) => node(entity, "physical-block", result.source.id)),
    ...result.divisions.map((entity) => node(entity, "division", entity.parentDivisionId || result.source.id)),
    ...(result.documentForms || []).filter((entity) => entity.type !== "PARAGRAPH").map((entity) => node(entity, "document-form", entity.parentDivisionId || result.source.id)),
    ...result.paragraphs.map((entity) => node(entity, "paragraph", entity.parentDivisionId || result.source.id)),
    ...result.sentences.map((entity) => node(entity, "sentence", entity.parentDocumentFormId || entity.parentParagraphId || entity.scopePhysicalBlockId || result.source.id)),
    ...(result.clauses || []).map((entity) => node(entity, "clause", entity.sentenceId)),
    ...(result.phrases || []).map((entity) => node(entity, "phrase", entity.clauseId)),
    ...result.words.map((entity) => node(entity, "word", entity.parentPhraseId || entity.parentClauseId || entity.parentSentenceId)),
    ...result.morphemes.map((entity) => node(entity, "morpheme", entity.wordId)),
    // Canonical characters are source-anchored and reproducible from the
    // persisted page evidence + word character IDs. Avoid millions of tiny
    // browser-to-server writes; character records are materialized lazily.
  ];
};

const persistedCanonicalText = (result) => result.linguisticScope?.mode === "manual-physical-blocks"
  ? (result.physical?.blocks || []).map((block) => String(block.canonicalText || "")).filter(Boolean).join("\n")
  : String(result.canonicalText?.text || "");

const canonicalTextRecords = (result) => {
  const characters = Array.from(persistedCanonicalText(result));
  const size = 12000;
  return Array.from({ length: Math.ceil(characters.length / size) }, (_, chunkIndex) => {
    const start = chunkIndex * size;
    const chunk = characters.slice(start, start + size).join("");
    return { recordId: `canonical_text_${chunkIndex}`, recordType: "document-pattern", targetEntityIds: [], payload: { kind: "canonical-text", version: result.canonicalText?.version || "canonical-text-v1", chunkIndex, start, end: start + Math.min(size, characters.length - start), text: chunk } };
  });
};

const reconstructionRecords = (result) => [
  ...result.boundaries.map((payload) => ({ recordId: payload.id, recordType: "boundary", targetEntityIds: [payload.afterEntityId, payload.beforeEntityId].filter(Boolean), payload })),
  ...(result.physical?.lineRelations || []).map((payload) => ({ recordId: payload.id, recordType: "physical-line-relation", targetEntityIds: [payload.previousLineId, payload.nextLineId].filter(Boolean), payload })),
  ...(result.physical?.blockBoundaries || []).map((payload) => ({ recordId: payload.id, recordType: "physical-block-boundary", targetEntityIds: [payload.previousLineId, payload.nextLineId].filter(Boolean), payload })),
  ...(result.physical?.tableCandidates || []).map((payload) => ({ recordId: `${payload.id}:evidence`, recordType: "table-evidence", targetEntityIds: [payload.id], payload })),
  ...result.transformations.map((payload) => ({ recordId: payload.id, recordType: "transformation", targetEntityIds: [payload.targetEntityId].filter(Boolean), payload })),
  ...result.evidence.conflicts.map((payload) => ({ recordId: payload.id, recordType: "conflict", targetEntityIds: [payload.targetId].filter(Boolean), payload })),
  ...(result.evidence.rasterEvidence || []).map((payload) => ({ recordId: payload.id, recordType: "raster-evidence", targetEntityIds: [payload.targetId].filter(Boolean), payload })),
  ...(result.evidence.referenceGlyphs || []).map((payload) => ({ recordId: payload.id, recordType: "reference-glyph", targetEntityIds: [payload.targetId].filter(Boolean), payload })),
  ...(result.evidence.glyphAssessments || []).map((payload) => ({ recordId: payload.id, recordType: "glyph-assessment", targetEntityIds: [payload.targetId].filter(Boolean), payload })),
  ...(result.evidence.ocrAlignments || []).map((payload) => ({ recordId: payload.id, recordType: "ocr-alignment", targetEntityIds: (payload.evidenceRefs || []).filter((ref) => ref.layer === "canonical-character").map((ref) => ref.entityId), payload })),
  ...canonicalTextRecords(result),
];

export const persistForensicEvidence = async ({ runId, result }) => {
  const forensicTypes = new Set(["conflict", "raster-evidence", "reference-glyph", "glyph-assessment", "ocr-alignment"]);
  const records = reconstructionRecords(result).filter((record) => forensicTypes.has(record.recordType));
  for (const batch of batches(records)) await request(`/api/document-reconstruction/runs/${runId}/records`, { method: "PUT", body: JSON.stringify({ records: batch }) });
  return { stored: records.length };
};

export const persistManualResolution = ({ runId, resolution }) => request(`/api/document-reconstruction/runs/${runId}/manual-resolutions`, {
  method: "POST",
  body: JSON.stringify({
    targetId: resolution.targetId,
    action: resolution.action,
    previousState: resolution.previousState,
    newState: { ...resolution.newState, effectiveValue: resolution.effectiveValue, sourceAnchorHash: resolution.sourceAnchorHash, reconstructionHash: resolution.reconstructionHash, status: resolution.status },
    sourceEvidence: resolution.sourceAnchors,
    note: resolution.note,
  }),
});

export const preflightDocumentReconstruction = ({ documentId, samples }) => request(`/api/document-reconstruction/documents/${documentId}/preflight`, { method: "POST", body: JSON.stringify({ samples }) });
export const getLatestDocumentReconstruction = (documentId, scope = "", pageIndex = null, algorithmVersion = "", savedOnly = false) => {
  const params = new URLSearchParams();
  if (scope) params.set("scope", scope);
  if (Number.isInteger(pageIndex) && pageIndex >= 0) params.set("pageIndex", String(pageIndex));
  if (algorithmVersion) params.set("algorithmVersion", algorithmVersion);
  if (savedOnly) params.set("saved", "true");
  const query = params.toString();
  return request(`/api/document-reconstruction/documents/${documentId}/latest${query ? `?${query}` : ""}`);
};
export const listSavedDocumentReconstructions = (limit = 100) => request(`/api/document-reconstruction/saved-runs?limit=${encodeURIComponent(limit)}`);
export const listRabbitHoleDocuments = () => request("/api/document-reconstruction/documents");
export const getDocumentReconstructionStatus = (runId) => request(`/api/document-reconstruction/runs/${runId}/status`);
export const getDocumentReconstructionRoot = (runId) => request(`/api/document-reconstruction/runs/${runId}/root`);
export const getDocumentReconstructionCanonicalText = (runId, from = 0, limit = 50) => request(`/api/document-reconstruction/runs/${runId}/canonical-text?from=${from}&limit=${limit}`);
export const getDocumentReconstructionPhysicalBlocks = (runId, pageIndex) => request(`/api/document-reconstruction/runs/${runId}/pages/${pageIndex}/physical-blocks`);
export const getDocumentReconstructionPhysicalLines = (runId, pageIndex) => request(`/api/document-reconstruction/runs/${runId}/pages/${pageIndex}/physical-lines`);
export const getDocumentReconstructionPhysicalPages = (runId, fromPage = 0, limit = 50) => request(`/api/document-reconstruction/runs/${runId}/physical-pages?fromPage=${fromPage}&limit=${limit}`);
export const getPhysicalBlockSemanticTree = (runId, blockId) => request(`/api/document-reconstruction/runs/${runId}/physical-blocks/${encodeURIComponent(blockId)}/semantic-tree`);
export const getPhysicalLineSemanticTree = (runId, lineId) => request(`/api/document-reconstruction/runs/${runId}/physical-lines/${encodeURIComponent(lineId)}/semantic-tree`);
export const getDocumentReconstructionChildren = (runId, parentId, limit = 100, cursor = "") => request(`/api/document-reconstruction/runs/${runId}/children?parentId=${encodeURIComponent(parentId || "")}&limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
export const getDocumentReconstructionNode = (runId, entityId) => request(`/api/document-reconstruction/runs/${runId}/nodes/${encodeURIComponent(entityId)}`);
export const getDocumentReconstructionAncestors = (runId, entityId) => request(`/api/document-reconstruction/runs/${runId}/nodes/${encodeURIComponent(entityId)}/ancestors`);
export const getDocumentReconstructionEvidence = (runId, entityId, types = []) => request(`/api/document-reconstruction/runs/${runId}/nodes/${encodeURIComponent(entityId)}/evidence${types.length ? `?types=${encodeURIComponent(types.join(","))}` : ""}`);
export const getDocumentReconstructionParagraphEvidence = (runId, entityId) => request(`/api/document-reconstruction/runs/${runId}/nodes/${encodeURIComponent(entityId)}/paragraph-evidence`);
export const getDocumentReconstructionParagraphBoundary = (runId, boundaryId) => request(`/api/document-reconstruction/runs/${runId}/paragraph-boundaries/${encodeURIComponent(boundaryId)}`);
export const getDocumentReconstructionEntitySegments = (runId, entityId, cursor = 0, limit = 50) => request(`/api/document-reconstruction/runs/${runId}/nodes/${encodeURIComponent(entityId)}/segments?cursor=${cursor}&limit=${limit}`);
export const startBackendDocumentReconstruction = ({ documentId, chunkSize }) => request(`/api/document-reconstruction/documents/${documentId}/backend-runs`, { method: "POST", body: JSON.stringify({ chunkSize }) });
export const resumeBackendDocumentReconstruction = (runId) => request(`/api/document-reconstruction/runs/${runId}/resume`, { method: "POST" });
export const pauseBackendDocumentReconstruction = (runId) => request(`/api/document-reconstruction/runs/${runId}/pause`, { method: "POST" });
export const cancelBackendDocumentReconstruction = (runId) => request(`/api/document-reconstruction/runs/${runId}/cancel`, { method: "POST" });
export const deleteDocumentReconstruction = (runId) => request(`/api/document-reconstruction/runs/${runId}`, { method: "DELETE" });
export const deleteRabbitHoleDocument = (documentId) => request(`/api/document-reconstruction/documents/${documentId}`, { method: "DELETE" });
export const persistDocumentReconstruction = async ({ documentId, result, pages, onProgress }) => {
  const scopedCanonicalText = persistedCanonicalText(result);
  const resolved = await request("/api/document-reconstruction/runs", {
    method: "POST",
    body: JSON.stringify({ documentId, sourceHash: result.source.fileHash, algorithmVersion: result.run.algorithmVersion, configHash: result.run.configHash, reconstructionHash: result.run.reconstructionHash, evidenceVersions: result.run.evidenceVersions, configuration: result.run.config, reconstructionScope: result.extractionState?.scope === "page" ? "page" : "document", extractionState: result.extractionState, physicalLineModelVersion: result.physical?.modelVersion, physicalBlockModelVersion: result.physical?.manualBlockModelVersion, documentFormModelVersion: result.documentFormModelVersion, linguisticModelVersion: result.linguisticModelVersion, canonicalText: { version: result.canonicalText?.version, characterCount: Array.from(scopedCanonicalText).length, statistics: result.canonicalText?.statistics, status: result.validation?.valid === false ? "complete-with-unresolved" : "complete" } }),
  });
  if (resolved.reused) {
    // A previous request can create the run record and then fail before its
    // logical nodes are written. Do not mistake that orphaned run for a
    // successfully saved tree.
    try {
      const persistedRoot = await getDocumentReconstructionRoot(resolved.run._id);
      if (persistedRoot?.node && Number(persistedRoot.node.childCount) > 0) {
        return { run: resolved.run, root: persistedRoot.node, reused: true };
      }
    } catch {
      // Repopulate the existing run below; the server still owns the run.
    }
  }
  const runId = resolved.run._id;
  let completed = 0;
  const nodes = logicalNodes(result);
  const records = reconstructionRecords(result);
  const total = pages.length + Math.ceil(nodes.length / 500) + Math.ceil(records.length / 500) + 1;
  for (const page of pages) {
    const physicalPage = result.physical.pages.find((entry) => entry.pageIndex === page.pageIndex);
    const lines = physicalPage?.regions.flatMap((region) => region.lines.map((line) => ({ ...line, regionType: region.regionType, regionId: region.id }))) || [];
    const regions = physicalPage?.regions.map(({ lines: omittedLines, ...region }) => region) || page.regions || [];
    const physicalBlocks = (result.physical?.blocks || []).filter((block) => block.pageIndexes?.includes(page.pageIndex));
    const blockBoundaries = (result.physical?.blockBoundaries || []).filter((boundary) => boundary.pageIndex === page.pageIndex);
    const documentForms = (result.documentForms || []).filter((form) => form.pageIndexes?.includes(page.pageIndex));
    const tables = (result.physical?.tables || []).filter((table) => table.pageIndex === page.pageIndex);
    const structuralRegions = (result.physical?.structuralRegions || []).filter((region) => region.pageIndex === page.pageIndex);
    await request(`/api/document-reconstruction/runs/${runId}/pages/${page.pageIndex}`, { method: "PUT", body: JSON.stringify({ ...page, lines, physicalLines: lines, lineRelations: (result.physical?.lineRelations || []).filter((relation) => relation.pageIndex === page.pageIndex), regions, physicalBlocks, blockBoundaries, documentForms, tables, structuralRegions, pageCount: result.source.pageCount, extractionVersion: result.extractionState.extractionVersion }) });
    onProgress?.(++completed, total);
  }
  for (const batch of batches(nodes)) {
    await request(`/api/document-reconstruction/runs/${runId}/nodes`, { method: "PUT", body: JSON.stringify({ nodes: batch }) });
    onProgress?.(++completed, total);
  }
  for (const batch of batches(records)) {
    await request(`/api/document-reconstruction/runs/${runId}/records`, { method: "PUT", body: JSON.stringify({ records: batch }) });
    onProgress?.(++completed, total);
  }
  const finalized = await request(`/api/document-reconstruction/runs/${runId}/finalize`, { method: "PATCH", body: JSON.stringify({ extractionState: result.extractionState, statistics: result.statistics, diagnostics: result.diagnostics, validation: result.validation, physicalLineModelVersion: result.physical?.modelVersion, physicalBlockModelVersion: result.physical?.manualBlockModelVersion, documentFormModelVersion: result.documentFormModelVersion, linguisticModelVersion: result.linguisticModelVersion, canonicalText: { version: result.canonicalText?.version, characterCount: Array.from(scopedCanonicalText).length, statistics: result.canonicalText?.statistics, status: result.validation?.valid === false ? "complete-with-unresolved" : "complete" }, status: result.run.status === "partial" ? "partial" : "complete" }) });
  onProgress?.(++completed, total);
  const persistedRoot = await getDocumentReconstructionRoot(runId);
  if (!persistedRoot?.node) throw new Error("The database write finished without a persisted RabbitHole tree root.");
  if (Number(persistedRoot.node.childCount) < 1) throw new Error("The persisted RabbitHole root has no reconstructed branches.");
  return { run: finalized.run, root: persistedRoot.node, reused: false };
};
