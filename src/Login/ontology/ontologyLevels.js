const subjectLevel = (configuration) => Object.freeze({
  ...configuration,
  canvas: Object.freeze(configuration.canvas || { width: 1536, height: 1024 }),
  visibleBounds: Object.freeze(configuration.visibleBounds),
  contactAnchor: Object.freeze(configuration.contactAnchor),
  scale: Object.freeze(configuration.scale),
});

export const ONTOLOGY_LEVELS = Object.freeze([
  subjectLevel({
    id: "hyle",
    label: "Hyle",
    visual: "/ontology/hyle.webp",
    visibleBounds: { x: 162, y: 33, width: 1245, height: 965 },
    contactAnchor: { x: 0.5107, y: 0.9746 },
    scale: { landscape: 1.05, portrait: 1.02 },
  }),
  subjectLevel({
    id: "societies",
    label: "Societies",
    visual: "/ontology/societies.webp",
    visibleBounds: { x: 36, y: 14, width: 1490, height: 998 },
    contactAnchor: { x: 0.5085, y: 0.9883 },
    scale: { landscape: 0.94, portrait: 0.92 },
  }),
  subjectLevel({
    id: "humans",
    label: "Humans",
    visual: "/ontology/humans.webp",
    visibleBounds: { x: 6, y: 0, width: 1526, height: 1022 },
    contactAnchor: { x: 0.5007, y: 0.998 },
    scale: { landscape: 0.9, portrait: 0.88 },
  }),
  subjectLevel({
    id: "systems",
    label: "Organ Systems",
    visual: "/ontology/organsystems.webp",
    visibleBounds: { x: 0, y: 0, width: 1536, height: 1024 },
    contactAnchor: { x: 0.5, y: 0.998 },
    scale: { landscape: 0.9, portrait: 0.88 },
  }),
  subjectLevel({
    id: "organs",
    label: "Organs",
    visual: "/ontology/organ.webp",
    canvas: { width: 1254, height: 1254 },
    visibleBounds: { x: 48, y: 37, width: 1160, height: 1177 },
    contactAnchor: { x: 0.5, y: 0.967 },
    scale: { landscape: 0.9, portrait: 0.88 },
  }),
  subjectLevel({
    id: "tissues",
    label: "Tissues",
    visual: "/ontology/tissues.webp",
    canvas: { width: 1024, height: 1536 },
    visibleBounds: { x: 13, y: 29, width: 999, height: 1483 },
    contactAnchor: { x: 0.5, y: 0.984 },
    scale: { landscape: 0.9, portrait: 0.88 },
  }),
  subjectLevel({
    id: "cells",
    label: "Cells",
    visual: "/ontology/cells.webp",
    visibleBounds: { x: 0, y: 0, width: 1536, height: 1024 },
    contactAnchor: { x: 0.5, y: 0.998 },
    scale: { landscape: 0.9, portrait: 0.88 },
  }),
  subjectLevel({
    id: "molecules",
    label: "Molecules",
    visual: "/ontology/molecules.webp",
    canvas: { width: 1024, height: 1536 },
    visibleBounds: { x: 0, y: 0, width: 1024, height: 1536 },
    contactAnchor: { x: 0.5, y: 0.998 },
    scale: { landscape: 0.9, portrait: 0.88 },
  }),
  subjectLevel({
    id: "atoms",
    label: "Atoms",
    visual: "/ontology/atoms.webp",
    canvas: { width: 1024, height: 1536 },
    visibleBounds: { x: 0, y: 0, width: 1024, height: 1536 },
    contactAnchor: { x: 0.5, y: 0.998 },
    scale: { landscape: 0.9, portrait: 0.88 },
  }),
]);

export const FUTURE_ONTOLOGY_LEVELS = Object.freeze([]);

export const ONTOLOGY_TRANSITION_COUNT = ONTOLOGY_LEVELS.length - 1;

export const ONTOLOGY_DEBUG_ENABLED = import.meta.env.DEV && typeof window !== "undefined" && (() => {
  const search = new URLSearchParams(window.location.search);
  return search.get("ontologyDebug") === "1" || search.get("hyleDebug") === "1";
})();
