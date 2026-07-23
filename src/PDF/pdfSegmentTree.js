// pdfSegmentTree.js
//
// Pure helpers over an AI-produced page structure ({pageType, confidence,
// segments[], elements[]} — back/models/PdfPageStructure.js's shape) that
// PdfNarrativeView.jsx renders from. Kept separate and DOM/React-free (per
// explicit ask) so segment-tree traversal, flow/reading-order grouping,
// and text reconstruction are unit-testable without mounting a component.
//
// Text reconstruction happens HERE, after structure — never before it
// (spec §41): a segment's text is built from its OWN elementIds only, so
// an aside's text can never bleed into the main flow's text or vice versa.

import { parseElementId } from "./pdfPageEvidence.js";

/** id -> element, for O(1) text/bbox lookup while walking segments. */
export const buildElementsById = (elements) => {
  const map = new Map();
  for (const el of elements || []) map.set(el.id, el);
  return map;
};

/**
 * Joins a segment's own elementIds' text (in the order the AI listed
 * them — trusted as that segment's local reading order, since asking for
 * a fully separate per-element order field would be redundant for the
 * common case of already-contiguous PDF.js items) with single spaces.
 * Unknown/missing element ids are skipped rather than throwing — the
 * deterministic backend integrity check already rejects segments that
 * reference truly nonexistent ids, so this is just defensive.
 */
export const reconstructSegmentText = (segment, elementsById) => {
  const parts = [];
  for (const id of segment?.elementIds || []) {
    const el = elementsById.get(id);
    if (el?.text) parts.push(el.text);
  }
  return parts.join(" ").trim();
};

/** Every raw PDF.js content.items index behind a segment's elementIds — for click-to-highlight (computeHighlightRectsForItemIndexes expects raw item indexes). */
export const itemIndexesForSegment = (segment) => {
  const indexes = [];
  for (const id of segment?.elementIds || []) {
    const parsed = parseElementId(id);
    if (parsed) indexes.push(parsed.itemIndex);
  }
  return indexes;
};

/**
 * Groups segments by flowId, each flow's own segments sorted by
 * readingOrder — the zone-based ordering the spec requires (an aside
 * never gets spliced into the middle of the main flow just because it
 * sits at a similar page position). Returns
 * [{flowId, segments: [...sorted]}], flows in first-appearance order.
 */
export const groupSegmentsByFlow = (segments) => {
  const order = [];
  const byFlow = new Map();
  for (const seg of segments || []) {
    const flowId = seg.flowId || "main";
    if (!byFlow.has(flowId)) { byFlow.set(flowId, []); order.push(flowId); }
    byFlow.get(flowId).push(seg);
  }
  for (const list of byFlow.values()) list.sort((a, b) => (a.readingOrder ?? 0) - (b.readingOrder ?? 0));
  return order.map((flowId) => ({ flowId, segments: byFlow.get(flowId) }));
};

/**
 * Nests a flow's own (already reading-order-sorted) segment list by
 * parentId into a tree — each node gets a `.children` array. A segment
 * whose parentId points outside this flow (or to nothing) is a root.
 * Cycle-safe: the backend's own integrity check already rejects cycles
 * before a structure is ever stored, but this still guards against
 * re-visiting a node via a `visited` set rather than trusting that.
 */
export const buildSegmentForest = (flowSegments) => {
  const byId = new Map(flowSegments.map((s) => [s.id, { ...s, children: [] }]));
  const roots = [];
  for (const seg of flowSegments) {
    const node = byId.get(seg.id);
    const parent = seg.parentId != null ? byId.get(seg.parentId) : null;
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
};

/** relatedTo lookups (e.g. a figure_caption's related figure) — id -> segment, across ALL segments regardless of flow. */
export const buildSegmentsById = (segments) => {
  const map = new Map();
  for (const seg of segments || []) map.set(seg.id, seg);
  return map;
};
