const ontologyLevel = (configuration) => Object.freeze(configuration);

export const ONTOLOGY_LEVELS = Object.freeze([
  ontologyLevel({
    id: "hyle",
    index: "00",
    label: "HYLE",
    singular: "HYLE",
    parent: "UNRESOLVED REALITY",
    child: "SOCIETY",
    descriptor: "entry / indeterminacy",
    variant: "hyle",
  }),
  ontologyLevel({
    id: "societies",
    index: "01",
    label: "SOCIETY",
    singular: "SOCIETY",
    parent: "SURFACE / RELATIONAL FIELD",
    child: "HUMAN",
    descriptor: "many ↔ many",
    variant: "societies",
  }),
  ontologyLevel({
    id: "humans",
    index: "02",
    label: "HUMANS",
    singular: "HUMAN",
    parent: "SOCIETIES",
    child: "SYSTEMS",
    descriptor: "entity within society",
    variant: "humans",
  }),
  ontologyLevel({
    id: "systems",
    index: "03",
    label: "SYSTEMS",
    singular: "SYSTEM",
    parent: "HUMAN",
    child: "ORGAN",
    descriptor: "organization within organism",
    variant: "systems",
  }),
  ontologyLevel({
    id: "organs",
    index: "04",
    label: "ORGANS",
    singular: "ORGAN",
    parent: "SYSTEM",
    child: "TISSUE",
    descriptor: "structure within system",
    variant: "organs",
  }),
  ontologyLevel({
    id: "tissues",
    index: "05",
    label: "TISSUES",
    singular: "TISSUE",
    parent: "ORGAN",
    child: "CELL",
    descriptor: "organization within organ",
    variant: "tissues",
  }),
  ontologyLevel({
    id: "cells",
    index: "06",
    label: "CELLS",
    singular: "CELL",
    parent: "TISSUE",
    child: "MOLECULE",
    descriptor: "entity within tissue",
    variant: "cells",
  }),
  ontologyLevel({
    id: "molecules",
    index: "07",
    label: "MOLECULES",
    singular: "MOLECULE",
    parent: "CELL",
    child: "ATOM",
    descriptor: "structure within cell",
    variant: "molecules",
  }),
  ontologyLevel({
    id: "atoms",
    index: "08",
    label: "ATOMS",
    singular: "ATOM",
    parent: "MOLECULE",
    child: null,
    descriptor: "entity / fundamental scale",
    variant: "atoms",
  }),
]);

// Hyle is the existing Login viewport. The animated scene begins at Society,
// while both surfaces continue to derive from this one canonical hierarchy.
export const ONTOLOGY_SCENE_LEVELS = Object.freeze(ONTOLOGY_LEVELS.slice(1));
export const ONTOLOGY_TRANSITION_COUNT = ONTOLOGY_SCENE_LEVELS.length - 1;
export const RABBIT_HOLE_SCROLL_TRANSITIONS = ONTOLOGY_LEVELS.length - 1;

export const ONTOLOGY_DEBUG_ENABLED = import.meta.env.DEV && typeof window !== "undefined" && (() => {
  const search = new URLSearchParams(window.location.search);
  return search.get("ontologyDebug") === "1" || search.get("rabbitHoleDebug") === "1";
})();
