import { useEffect, useMemo, useState } from "react";
import { apiUrl } from "../config/api";
import { readStoredSession } from "../utils/sessionCleanup";
import { BBOX_CARD_TYPES, bboxTypeHas, buildHyleBBoxIdMap } from "../PDF/pdfBBoxTypes";

// useAllSegments — the reservoir fetch + flatten logic originally inline
// in SegmentationsPage.jsx, extracted so AMCTOSHS Morphe's own segment
// picker (ClinicalSchemata.jsx) can list/select the exact same segments
// without duplicating this ~40-line fetch. Behavior-preserving extraction:
// same endpoints, same shape, same container-name resolution.

const authHeaders = () => {
  const token = readStoredSession()?.token || "";
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const isDocumentSource = (s) => (
  s && s.type !== "youtube" && s.type !== "podcast" && Boolean(s.key || s.parts?.length)
);

export const segmentKeyFor = (sourceId, pageNum, bboxId) => `${sourceId}::${pageNum}::${bboxId}`;

// SourceAnnotation.layers used to be the flat { [page]: annotations[] }
// object. The PDF reader now persists an array of named annotation layers,
// each with its own annotations object. Segmentation is a reservoir of saved
// content, so merge every persisted layer by page regardless of eye-toggle
// visibility; hidden is not deleted.
export const flattenPersistedAnnotationLayers = (storedLayers) => {
  if (!Array.isArray(storedLayers)) return storedLayers && typeof storedLayers === "object" ? storedLayers : {};
  const pages = {};
  for (const layer of storedLayers) {
    for (const [pageKey, annotations] of Object.entries(layer?.annotations || {})) {
      if (!Array.isArray(annotations)) continue;
      pages[pageKey] = [...(pages[pageKey] || []), ...annotations];
    }
  }
  return pages;
};

// Same geometric containment check (2px tolerance) EntityBuilderPanel.jsx's
// groupedBboxes uses to decide which segments sit inside a Segment
// Container on the same page.
const CONTAINER_INSET = 2;
const isBBoxWithinContainer = (bbox, container) => (
  bbox.x >= (container.x - CONTAINER_INSET)
  && bbox.y >= (container.y - CONTAINER_INSET)
  && bbox.x + bbox.w <= container.x + container.w + CONTAINER_INSET
  && bbox.y + bbox.h <= container.y + container.h + CONTAINER_INSET
);

export const useAllSegments = () => {
  const [sources, setSources] = useState([]);
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [sourcesError, setSourcesError] = useState("");

  const [layersBySource, setLayersBySource] = useState({}); // { [sourceId]: layers }
  const [annotationsLoading, setAnnotationsLoading] = useState(true);
  const [annotationsError, setAnnotationsError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(apiUrl("/api/sources/"), { headers: authHeaders() });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
        const docs = Array.isArray(data.sources) ? data.sources.filter(isDocumentSource) : [];
        if (cancelled) return;
        setSources(docs);
        setSourcesLoading(false);

        if (docs.length === 0) { setAnnotationsLoading(false); return; }

        // One reservoir across every source — fetch every document's
        // annotations in parallel rather than making the user pick one
        // first. A single source failing to load doesn't block the rest.
        const results = await Promise.allSettled(
          docs.map((s) => fetch(apiUrl(`/api/source-annotations/${s._id}`), { headers: authHeaders() })
            .then((r) => r.json().catch(() => ({})).then((body) => ({ ok: r.ok, sourceId: s._id, body }))))
        );
        if (cancelled) return;
        const nextLayers = {};
        let failedCount = 0;
        for (const result of results) {
          if (result.status === "fulfilled" && result.value.ok) {
            nextLayers[result.value.sourceId] = result.value.body.layers || {};
          } else {
            failedCount += 1;
          }
        }
        setLayersBySource(nextLayers);
        setAnnotationsError(failedCount > 0 ? `Could not load segments for ${failedCount} source${failedCount !== 1 ? "s" : ""}.` : "");
      } catch (err) {
        if (!cancelled) setSourcesError(err.message || "Could not load sources.");
      } finally {
        if (!cancelled) { setSourcesLoading(false); setAnnotationsLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // One group per source, each holding every one of its content segments
  // (page roots plus paragraph and figure BBoxes) across all source pages,
  // sorted page-then-appearance order.
  const sourceGroups = useMemo(() => (
    sources.map((source, sourceIndex) => {
      const layers = flattenPersistedAnnotationLayers(layersBySource[source._id]);
      const pageNums = Object.keys(layers)
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n))
        .sort((a, b) => a - b);

      const segments = [];
      for (const pageNum of pageNums) {
        const pageAnnotations = (layers[pageNum] || []).filter((bbox) => bbox && (
          BBOX_CARD_TYPES.has(bbox.type) || bbox.type === "pageBBox"
        ));
        const pageContainers = pageAnnotations
          .filter((bbox) => bbox.type === "pageBBox")
          .map((container, index) => ({
            ...container,
            _displayName: container.title?.trim() || `Page ${pageNum}`,
          }));
        const hyleIds = buildHyleBBoxIdMap(pageAnnotations, sourceIndex + 1, pageNum);

        pageAnnotations
          .forEach((bbox, index) => {
            const containingContainer = pageContainers.find((container) => (
              bbox.parentId === container.id || isBBoxWithinContainer(bbox, container)
            ));
            const hyleId = hyleIds[bbox.id];
            if (!hyleId) return;
            const isPage = bbox.type === "pageBBox";
            const isFigure = bboxTypeHas(bbox.type, "capturesImage");
            const typeLabel = isPage ? "Page Segment" : isFigure ? "Figure Segment" : "Segment";
            segments.push({
              key: hyleId,
              sourceId: source._id,
              sourceName: source.name,
              pageNum,
              hyleId,
              bbox: { ...bbox, hyleId },
              isImage: bboxTypeHas(bbox.type, "capturesImage"),
              typeLabel,
              displayTitle: bbox.title?.trim()
                || `${typeLabel} ${index + 1}`,
              container_name: containingContainer ? containingContainer._displayName : null,
            });
          });
      }
      return { sourceId: source._id, sourceName: source.name, segments };
    }).filter((group) => group.segments.length > 0)
  ), [sources, layersBySource]);

  const totalSegments = sourceGroups.reduce((n, g) => n + g.segments.length, 0);

  return {
    sources,
    sourceGroups,
    totalSegments,
    listBusy: sourcesLoading || annotationsLoading,
    sourcesError,
    annotationsError,
    clearErrors: () => { setSourcesError(""); setAnnotationsError(""); },
  };
};
