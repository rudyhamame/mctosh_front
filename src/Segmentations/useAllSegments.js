import { useEffect, useMemo, useState } from "react";
import { apiUrl } from "../config/api";
import { readStoredSession } from "../utils/sessionCleanup";
import { buildHyleBBoxIdMap } from "../PDF/pdfBBoxTypes";

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

// Hyle's raw paragraph is an ordered stack of extracted visual lines. Keep
// those line boundaries for the Original processing stage; later processing
// owns the explicit paragraph-gluing step.
const lineBlockText = (value) => String(value || "")
  .replace(/\r\n?/gu, "\n")
  .split("\n")
  .map((line) => line.replace(/[ \t]+/gu, " ").trim())
  .join("\n")
  .trim();

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

  // One group per source, each holding paragraph Line Blocks across all
  // source pages, sorted in page-then-appearance order.
  const sourceGroups = useMemo(() => (
    sources.map((source, sourceIndex) => {
      const layers = flattenPersistedAnnotationLayers(layersBySource[source._id]);
      const pageNums = Object.keys(layers)
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n))
        .sort((a, b) => a - b);

      const segments = [];
      for (const pageNum of pageNums) {
        const allPageAnnotations = (layers[pageNum] || []).filter(Boolean);
        // Line Blocks are paragraph BBoxes only. Page, partition, and figure
        // BBoxes provide context but are not Line Block records themselves.
        const pageAnnotations = allPageAnnotations.filter((bbox) => bbox.type === "bbox");
        const partitionAnnotations = allPageAnnotations.filter((bbox) => bbox.type === "columnBBox");
        const pageContainers = allPageAnnotations
          .filter((bbox) => bbox.type === "pageBBox")
          .map((container, index) => ({
            ...container,
            _displayName: container.title?.trim() || `Page ${pageNum}`,
          }));
        const hyleIds = buildHyleBBoxIdMap(allPageAnnotations, sourceIndex + 1, pageNum);

        pageAnnotations
          .forEach((bbox, index) => {
            const containingContainer = pageContainers.find((container) => (
              bbox.parentId === container.id || isBBoxWithinContainer(bbox, container)
            ));
            const containingPartition = partitionAnnotations.find((partition) => (
              bbox.parentId === partition.id || isBBoxWithinContainer(bbox, partition)
            ));
            const hyleId = hyleIds[bbox.id];
            if (!hyleId) return;
            const partitionIndex = containingPartition
              ? partitionAnnotations.indexOf(containingPartition) + 1
              : null;
            const partitionName = containingPartition
              ? containingPartition.title?.trim() || `Partition ${partitionIndex}`
              : null;
            const typeLabel = "Paragraph";
            // Prefer the PDF-layer raw text because `text` may be an older
            // normalized/corrected snapshot from a previous segmentation.
            const renderedText = lineBlockText(bbox.rawPdfText || bbox.text || "");
            segments.push({
              key: hyleId,
              sourceId: source._id,
              sourceName: source.name,
              pageNum,
              hyleId,
              bbox: { ...bbox, hyleId },
              renderedText,
              isImage: false,
              typeLabel,
              partition_name: partitionName,
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
