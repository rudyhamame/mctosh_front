// pdfSegmentTree.js
//
// Pure helpers over a v2 canonical page structure ({pageType, confidence,
// flowRegions[], elements[], tables[], relationships[], readingOrder[],
// ambiguities[]} — back/models/PdfPageStructure.js's shape, produced by
// back/helpers/pdfStructureFusion.js) that PdfNarrativeView.jsx renders
// from. Kept separate and DOM/React-free (per explicit ask) so element-
// tree traversal, flow grouping, and list/table shaping are unit-testable
// without mounting a component.
//
// Unlike the pre-redesign version of this file, there is no text-
// reconstruction step here anymore: each element already carries its own
// `text`/`correctedText` directly (assigned once during fusion), so
// there's no elementIds-join indirection layer to maintain. There is also
// no itemIndex-based click-to-highlight helper — v2 elements have no 1:1
// PDF.js item mapping (a Docling-only figure, an OCR'd word, or any fused
// element may not correspond to a single client-side item); use each
// element's own `bbox` directly with pdfHighlightRects.js's
// computeHighlightRectsForCanonicalBboxes instead.

/** id -> element, for O(1) lookup while walking flows/trees. */
export const buildElementsById = (elements) => {
  const map = new Map();
  for (const el of elements || []) map.set(el.id, el);
  return map;
};

/**
 * Groups elements by flowRegionId, each flow's own elements sorted by
 * readingOrderIndex — the zone-based ordering the pipeline's own
 * pdfBlockLayout.js reading order already establishes (an aside/sidebar
 * never gets spliced into the middle of the main flow just because it
 * sits at a similar page position). Returns
 * [{flowRegionId, elements: [...sorted]}], flows in first-appearance order.
 * Only top-level elements (parentId == null) are grouped here — nested
 * elements (list_items under a list, table cells under a table) are
 * reached via buildElementForest/buildListTree/buildTableGrid instead, so
 * they're never rendered twice.
 *
 * Flow buckets themselves are ordered by each flow's own minimum
 * readingOrderIndex, NOT first-appearance in `elements` (regression: the
 * raw `elements` array still reflects fuseStructure's internal
 * construction-loop order — tables pushed before paragraphs/headings —
 * so a table's flowRegionId ("main", since tables have no real flow
 * region) was always registered first, hoisting the entire "main" flow
 * above a header/heading flow that reads earlier on the page).
 */
export const groupElementsByFlowRegion = (elements) => {
  const topLevel = (elements || []).filter((e) => e.parentId == null);
  const byFlow = new Map();
  for (const el of topLevel) {
    const flowRegionId = el.flowRegionId || "main";
    if (!byFlow.has(flowRegionId)) byFlow.set(flowRegionId, []);
    byFlow.get(flowRegionId).push(el);
  }
  for (const list of byFlow.values()) list.sort((a, b) => (a.readingOrderIndex ?? 0) - (b.readingOrderIndex ?? 0));
  const order = [...byFlow.keys()].sort((a, b) => {
    const aMin = byFlow.get(a)[0]?.readingOrderIndex ?? 0;
    const bMin = byFlow.get(b)[0]?.readingOrderIndex ?? 0;
    return aMin - bMin;
  });
  return order.map((flowRegionId) => ({ flowRegionId, elements: byFlow.get(flowRegionId) }));
};

/**
 * Nests a flow's own (already reading-order-sorted) top-level element list
 * by parentId/childIds into a tree — each node gets a `.children` array.
 * Cycle-safe: the backend's own integrity check already rejects cycles
 * before a structure is ever persisted, but this still guards against
 * re-visiting a node via parent-identity rather than trusting that.
 */
export const buildElementForest = (flowElements, elementsById) => {
  const byId = elementsById || buildElementsById(flowElements);
  const build = (el, seen) => {
    if (seen.has(el.id)) return { ...el, children: [] }; // cycle guard — defense in depth only
    const nextSeen = new Set(seen).add(el.id);
    const children = (el.childIds || []).map((id) => byId.get(id)).filter(Boolean).map((child) => build(child, nextSeen));
    return { ...el, children };
  };
  return flowElements.map((el) => build(el, new Set()));
};

/**
 * A "list" element's own childIds -> a nested tree of "list_item"
 * elements (each item's own childIds, if any, are nested LISTs — the one
 * case where a deeper structure genuinely nests inside its own parent
 * item, matching how a real outline/sub-list looks). Returns
 * {...listElement, items: [...]}; each item gets `.childList` (or null)
 * for its own nested sub-list, if any of its childIds point to a "list".
 */
export const buildListTree = (listElement, elementsById) => {
  const items = (listElement.childIds || [])
    .map((id) => elementsById.get(id))
    .filter((el) => el?.kind === "list_item")
    .map((item) => {
      const nestedListId = (item.childIds || []).find((id) => elementsById.get(id)?.kind === "list");
      const childList = nestedListId ? buildListTree(elementsById.get(nestedListId), elementsById) : null;
      return { ...item, childList };
    });
  return { ...listElement, items };
};

/**
 * A table's flat `cells[]` (row/col/rowSpan/colSpan) -> a `rows[][]` 2-D
 * grid, each cell placed at its own (row,col) and additionally at every
 * (row,col) it spans over via a `{spanned: true, ownerCell}` placeholder,
 * so a naive `<td>`-per-grid-slot renderer never double-renders a
 * multi-span cell's own content — only the owning (top-left) slot carries
 * the real cell, matching real HTML <table> rowSpan/colSpan semantics.
 */
export const buildTableGrid = (table) => {
  const rows = Array.from({ length: table.rows || 0 }, () => new Array(table.cols || 0).fill(null));
  for (const cell of table.cells || []) {
    for (let r = cell.row; r < cell.row + (cell.rowSpan || 1) && r < rows.length; r++) {
      for (let c = cell.col; c < cell.col + (cell.colSpan || 1) && c < (table.cols || 0); c++) {
        rows[r][c] = (r === cell.row && c === cell.col) ? { ...cell, isOwner: true } : { spanned: true, ownerRow: cell.row, ownerCol: cell.col };
      }
    }
  }
  return rows;
};
