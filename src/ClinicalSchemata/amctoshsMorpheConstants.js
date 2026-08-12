// amctoshsMorpheConstants.js
//
// Frontend mirror of the enums in back/validation/amctoshsMorpheSchemas.js
// (kept as plain constants here, same convention as the old
// PDF/entityBuilderConstants.js — enforcement of these lists is client-side
// display/filtering only; the backend's own Zod schemas are the real
// enforcement). AMCTOSHS Reasoning imports DOMAINS from here too rather
// than redefining it.

export const DOMAINS = [
  "atoms", "molecules", "organelles", "cells", "tissues",
  "organs", "organ_systems", "humans", "societies",
];

export const DOMAIN_LABELS = {
  atoms: "Atoms",
  molecules: "Molecules",
  organelles: "Organelles",
  cells: "Cells",
  tissues: "Tissues",
  organs: "Organs",
  organ_systems: "Organ Systems",
  humans: "Humans",
  societies: "Societies",
};

export const MORPHE_OBJECT_MODES = [
  { key: "ATOM", domain: "atoms", label: "Atom" },
  { key: "MOLECULE", domain: "molecules", label: "Molecule" },
  { key: "CELL", domain: "cells", label: "Cell" },
  { key: "TISSUE", domain: "tissues", label: "Tissue" },
  { key: "ORGAN", domain: "organs", label: "Organ" },
  { key: "SYSTEM", domain: "organ_systems", label: "System" },
  { key: "HUMAN", domain: "humans", label: "Human" },
  { key: "SOCIETY", domain: "societies", label: "Society" },
];

export const EXTRACTION_BASES = ["explicit", "linguistically_presupposed", "externally_inferred", "manually_added"];

export const EXTRACTION_BASIS_LABELS = {
  explicit: "Explicit",
  linguistically_presupposed: "Linguistically presupposed",
  externally_inferred: "Externally inferred",
  manually_added: "Manually added",
};

export const EPISTEMIC_STATUSES = [
  "asserted", "linguistically_presupposed", "proposed",
  "manually_added", "manually_corrected", "rejected",
];

export const VALUE_TYPES = [
  "quantitative", "categorical", "binary", "ordinal", "textual",
  "temporal", "spatial", "structural", "sequence", "unknown",
];
