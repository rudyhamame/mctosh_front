// entityBuilderConstants.js
//
// Shared AMCTOSHS Entity infrastructure — the domain list, sub-entity type
// list, and display formatter used by BOTH:
//   - EntityBuilderPanel.jsx (PDF Reader — builds/assigns entities from
//     PDF-derived text)
//   - ClinicalSchemata.jsx (AMCTOSHS Morphe — the global representational
//     container that reads the same entities back across all domains)
//
// Extracted out of EntityBuilderPanel.jsx so the two never drift into
// incompatible domain/type vocabularies the way the old (pre-Morphe)
// ClinicalSchemata.jsx's own disconnected 6-item "dimension" list once did.
// This is the single canonical source for both.

export const AMCTOSHS_ENTITY_INFO = "An AMCTOSHS sub-entity is a representation of an aspect of a patient (ontic entity), constructed from the observed traces through which that aspect is known.";

// AMCTOSHS Domains — canonical, matches what the backend AmctoshsEntity
// documents actually carry in their `domain` field today (schema-type
// entities only; trace/trace_value/instance/intervener entities inherit
// their domain from the schema they're nested under — see
// amctoshsEntityGraph.js). Not enforced as a Mongoose enum server-side,
// so this list IS the enforcement.
export const ENTITY_DOMAINS = [
  "Atoms",
  "Molecules",
  "Tissues",
  "Organs",
  "Organ Systems",
  "Humans",
  "Societies",
];

// AMCTOSHS Sub-Entity types — the five-way discriminator every
// AmctoshsEntity document carries in its `type` field.
export const ENTITY_TYPES = [
  {
    key: "schema",
    label: "Schema",
    icon: "bx bx-cube-alt",
    helper: "Points to an ontic object, such as heart.",
  },
  {
    key: "trace",
    label: "Schema Trace",
    icon: "bx bx-git-branch",
    helper: "Nested inside a preexisting Entity Schema.",
  },
  {
    key: "trace_value",
    label: "Schema Trace Value",
    icon: "bx bx-ruler",
    helper: "A value for an existing trace. Unit is required.",
  },
  {
    key: "instance",
    label: "Schema Instance",
    icon: "bx bx-layer-plus",
    helper: "Instantiates a schema via one trace:value pair. Build several for a schema with multiple traces.",
  },
  {
    key: "intervener",
    label: "Trace Value Changer",
    icon: "bx bx-transfer-alt",
    helper: "A.k.a. Entity Intervener.",
  },
];

// Row types that carry an actual AMCTOSHS Trace Value (as opposed to
// "schema" — a sub-entity schema declaration — or "trace" — a named trace
// slot with no value yet). These are what populate a schema's Trace table
// in the AMCTOSHS Morphe page.
export const VALUE_BEARING_TYPES = ["trace_value", "instance", "intervener"];

export const formatEntity = (entry) => {
  const lines = [
    "AMCTOSHS Sub-Entity:",
    `1. Entity Type: ${entry.typeLabel}`,
  ];

  if (entry.type === "schema") {
    lines.push(`2. Entity Schema: ${entry.name || "Untitled Schema"}`);
    lines.push(`3. AMCTOSHS Sub-Entity schema Domain: ${entry.domain}`);
    lines.push(`4. Ontic Object Text: ${entry.sourceText}`);
  } else if (entry.type === "trace") {
    lines.push(`2. Entity Schema Trace: ${entry.name || "Untitled Trace"}`);
    lines.push(`3. Nested Inside Entity Schema: ${entry.parentSchema || "Not specified"}`);
    lines.push(`4. Trace Source Text: ${entry.sourceText}`);
  } else if (entry.type === "trace_value") {
    lines.push(`2. Entity Schema Trace: ${entry.traceName || "Not specified"}`);
    lines.push(`3. Entity Schema Trace Value: ${entry.value || entry.sourceText}`);
    lines.push(`4. Unit: ${entry.unit}`);
  } else if (entry.type === "instance") {
    lines.push(`2. Entity Schema Instance: ${entry.name || "Untitled Instance"}`);
    lines.push(`3. Entity Schema Name: ${entry.parentSchema || "Not specified"}`);
    lines.push(`4. Entity Schema Trace Name: ${entry.traceName || "Not specified"}`);
    lines.push(`5. Entity Schema Trace Value Entry: ${entry.value || "Not specified"}`);
  } else if (entry.type === "intervener") {
    lines.push(`2. Entity Intervener: ${entry.name || "Untitled Intervener"}`);
    lines.push(`3. Target Entity Schema Trace Value: ${entry.traceName || "Not specified"}`);
    lines.push(`4. Change: ${entry.value || entry.sourceText}`);
    lines.push(`5. Unit: ${entry.unit || "Not specified"}`);
  }

  return lines.join("\n");
};
