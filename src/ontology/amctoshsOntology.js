/**
 * Canonical RabbitHole ontology registry.
 *
 * Ontology-facing components should consume concept IDs and labels from this
 * module instead of inventing local definitions. Database/UMLS identifiers are
 * intentionally not treated as RabbitHole ontology IDs.
 */

export const AMCTOSHS_ONTOLOGY_VERSION = "0.1";

export const MODE_OF_ACCESS = Object.freeze([
  "societies",
  "humans",
  "systems",
  "organs",
  "tissues",
  "cells",
  "molecules",
  "atoms",
]);

const concept = (definition) => Object.freeze({ ...definition, relations: Object.freeze(definition.relations || []) });

export const AMCTOSHS_CONCEPTS = Object.freeze({
  amctoshs: concept({
    id: "amctoshs", label: "RabbitHole", category: "foundation",
    definition: "A framework for representing patient reality as accessed and distinguished by a particular Clinician through a particular Mode of Access.",
    relations: [{ type: "represents", target: "reality" }],
  }),
  entity: concept({
    id: "entity", label: "Entity", category: "foundation",
    definition: "Anything admitted as existing in the ontology.",
  }),
  truth: concept({
    id: "truth", label: "Truth", category: "epistemic-relation",
    definition: "In Hylonoesis, Truth is not expressed by the statement ‘it is what it is,’ because Reality and the description of Reality arise from two different sides of access. Reality provides the ‘it is’: the independent presence of the object of Study. The Observer provides the ‘what it is’: the distinctions, descriptions, and interpretations through which that Reality becomes accessible. Since the Observer is variable—differing in State, Mode of Access, prior knowledge, and position—there is no single observer-independent ‘what it is.’ Different Observers may therefore produce different truths about the same Reality without creating that Reality itself. Hylonoesis thus separates existence from description: Reality determines that it is; the Observer determines what it is taken to be. In this sense, Truth is relational: ‘It is; what it is depends on who observes it.’",
    relations: [{ type: "describes", target: "reality" }, { type: "depends-on", target: "clinician" }],
  }),
  "verbal-traces": concept({
    id: "verbal-traces", label: "Verbal Traces", category: "trace",
    definition: "Traces that arise through the Humans and Societies Modes of Access of RabbitHole, including spoken and written linguistic expressions through which aspects of Reality become accessible.",
    relations: [{ type: "comes-from", target: "humans" }, { type: "comes-from", target: "societies" }, { type: "makes-accessible", target: "hyle" }],
  }),
  "visual-traces": concept({
    id: "visual-traces", label: "Visual Traces", category: "trace",
    definition: "Traces that arise through the Atoms, Molecules, Cells, Tissues, Organs, and Organ Systems Modes of Access of RabbitHole, including visually accessible structures, configurations, signals, and measurements.",
    relations: [{ type: "comes-from", target: "atoms" }, { type: "comes-from", target: "molecules" }, { type: "comes-from", target: "cells" }, { type: "comes-from", target: "tissues" }, { type: "comes-from", target: "organs" }, { type: "comes-from", target: "systems" }, { type: "makes-accessible", target: "hyle" }],
  }),
  clinician: concept({
    id: "clinician", label: "Clinician", category: "agent",
    definition: "The studying agent who accesses, distinguishes, observes, compares, relates, measures, interprets, and studies Hyle.",
    aliases: ["studying agent"], deprecatedAliases: ["Self"],
    relations: [{ type: "possesses", target: "a-priori" }, { type: "performs", target: "study" }],
  }),
  "a-priori": concept({
    id: "a-priori", label: "A priori", category: "condition",
    definition: "The pre-existing organization of the Clinician that conditions Study, including fundamental capacities and previously acquired Schemas and relations.",
    relations: [{ type: "conditions", target: "study" }, { type: "contributes-to", target: "schema" }],
  }),
  hyle: concept({
    id: "hyle", label: "Hyle", category: "indeterminacy-condition",
    definition: "Hyle is an ontically existent entity that is epistemically non-existent to a particular observer because no Mode of Access has yet been established between the observer and the entity.",
    relations: [{ type: "describes", target: "reality" }, { type: "relative-to", target: "clinician" }, { type: "conditions", target: "study" }],
  }),
  study: concept({
    id: "study", label: "Study", category: "activity",
    definition: "The Clinician's active relational engagement with Hyle through which extrinsic Clinician–Hyle relations are established without creating Hyle's intrinsic relations.",
    dependsOn: ["clinician", "a-priori", "hyle"],
    relations: [{ type: "produces", target: "schema" }, { type: "establishes", target: "extrinsic-relation" }],
  }),
  schema: concept({
    id: "schema", label: "Schema", category: "noetic-organization",
    definition: "A dependent noetic organization produced by the Clinician through Study; it is not the object itself and does not exist inside Hyle as a second object.",
    independent: false, dependsOn: ["hyle", "a-priori", "study"],
    relations: [{ type: "generalizes", target: "instantiation" }, { type: "interprets", target: "trace" }, { type: "may-depend-on", target: "schema" }],
  }),
  instantiation: concept({
    id: "instantiation", label: "Instantiation", category: "particular", 
    definition: "A particular concrete realization of a Schema; it is not identical to the general Schema.",
    dependsOn: ["schema"], relations: [{ type: "realizes", target: "schema" }],
  }),
  trace: concept({
    id: "trace", label: "Trace", category: "accessible-manifestation",
    definition: "An accessible manifestation, measurement, sign, signal, or result through which aspects of Hyle can become available to the Clinician.",
    dependsOn: ["hyle"], relations: [{ type: "makes-accessible", target: "hyle" }, { type: "interpreted-by", target: "schema" }],
  }),
  "intrinsic-relation": concept({
    id: "intrinsic-relation", label: "Intrinsic Relation", category: "relation",
    definition: "A relation belonging to Hyle independently of the Clinician's awareness of it, such as part-of, connected-to, contains, located-within, causes, or interacts-with.",
    independent: true, dependsOn: ["hyle"],
  }),
  "extrinsic-relation": concept({
    id: "extrinsic-relation", label: "Extrinsic Relation", category: "relation",
    definition: "A relation established between the Clinician and the object of Study, such as observing, measuring, reading, comparing, or understanding.",
    dependsOn: ["clinician", "study"],
  }),
  "linguistic-reference": concept({
    id: "linguistic-reference", label: "Linguistic Reference", category: "representation",
    definition: "A linguistic sign that refers to a Schema, Trace, Instantiation, Relation, or conceptual model; it is not identical to its referent.",
    relations: [{ type: "refers-to", target: "schema" }, { type: "refers-to", target: "trace" }, { type: "refers-to", target: "instantiation" }, { type: "refers-to", target: "intrinsic-relation" }],
  }),
  "conceptual-model": concept({
    id: "conceptual-model", label: "Conceptual Model", category: "representation",
    definition: "An organized network that may contain multiple Schemas, Instantiations, Traces, Relations, Linguistic References, and dependencies.",
    dependsOn: ["schema", "instantiation", "trace", "linguistic-reference"],
  }),
  "patient-instance": concept({
    id: "patient-instance", label: "Patient Instance", category: "patient-representation",
    definition: "The particular patient whose reality RabbitHole represents; the patient/Hyle remains ontically independent of the Clinician.",
    relations: [{ type: "has", target: "reality" }, { type: "may-function-as", target: "hyle" }],
  }),
  reality: concept({
    id: "reality", label: "Reality", category: "patient-representation",
    definition: "Patient-instance-specific and Clinician-relative representation: Reality = R(P, C, M), where P is Patient Instance, C is Clinician, and M is Mode of Access.",
    dependsOn: ["patient-instance", "clinician", "mode-of-access"],
    relations: [{ type: "decomposes-into", target: "identity" }, { type: "decomposes-into", target: "state" }],
  }),
  identity: concept({
    id: "identity", label: "Identity", category: "patient-representation",
    definition: "What remains attributable to the same Patient Instance across changes of State; conceptually Identity = Reality − State.",
    relations: [{ type: "unifies", target: "reality" }, { type: "preserved-through", target: "change" }],
  }),
  state: concept({
    id: "state", label: "State", category: "patient-representation",
    definition: "The particular mode-accessible configuration of a Patient Reality that can vary while Identity is preserved, including structures, positions, relations, conditions, and traces.",
    dependsOn: ["reality", "mode-of-access"], relations: [{ type: "differentiates", target: "reality" }],
  }),
  "3d-reality": concept({
    id: "3d-reality", label: "3D Reality", category: "dimension",
    definition: "Identity in a particular State: the spatial configuration of a Patient Instance as distinguishable through a Mode of Access.",
    dependsOn: ["identity", "state", "mode-of-access"],
  }),
  "4d-reality": concept({
    id: "4d-reality", label: "4D Reality", category: "dimension",
    definition: "Identity through Change. It relates changing 3D Realities without privileging one State and is not simply 3D plus time.",
    dependsOn: ["identity", "change", "3d-reality"],
  }),
  change: concept({
    id: "change", label: "Change", category: "dimension",
    definition: "The distinction between identity-preserving 3D configurations; Change, rather than time, is the RabbitHole fourth dimension.",
    dependsOn: ["identity", "3d-reality"],
  }),
  "mode-of-access": concept({
    id: "mode-of-access", label: "Mode of Access", category: "access",
    definition: "The level through which the Clinician distinguishes Reality; apparent sameness and distinguishability are Mode-of-Access-relative.",
    relations: MODE_OF_ACCESS.map((mode) => ({ type: "includes", target: mode })),
  }),
  awareness: concept({
    id: "awareness", label: "Awareness", category: "experience",
    definition: "A 3D-State-bound capacity arising through distinction and selective relation; 4D Reality relates awareness-bearing 3D Realities but does not itself constitute an additional awareness.",
    dependsOn: ["3d-reality", "state", "identity"],
  }),
  life: concept({
    id: "life", label: "Life", category: "trajectory",
    definition: "Continuous preservation of Patient Identity through changing 3D spatial configurations.",
    dependsOn: ["patient-instance", "identity", "change", "3d-reality"],
  }),
  death: concept({
    id: "death", label: "Death", category: "trajectory",
    definition: "Termination of the living identity-preserving succession of distinct 3D Realities; remaining Hyle may continue changing.",
    dependsOn: ["life", "identity", "change"],
  }),
});

export const ONTOLOGY_TERMINOLOGY = Object.freeze({
  clinician: { canonical: "Clinician", aliases: ["studying agent"], deprecated: ["Self"], note: "Do not rename unrelated programming uses of self." },
  hyle: { canonical: "Hyle", aliases: ["object of Study", "given reality"], deprecated: ["raw matter only"] },
  schema: { canonical: "Schema", aliases: ["noetic organization"], deprecated: ["object itself"] },
  change: { canonical: "Change", aliases: ["fourth dimension"], deprecated: ["time as the RabbitHole fourth dimension"] },
});

export const getOntologyConcept = (id) => AMCTOSHS_CONCEPTS[id] || null;
export const getOntologyConceptIds = () => Object.keys(AMCTOSHS_CONCEPTS);

export const AMCTOSHS_AI_CONTEXT = `RabbitHole ontology v${AMCTOSHS_ONTOLOGY_VERSION}
RabbitHole represents patient reality as R(P,C,M): Patient Instance, Clinician, and Mode of Access.
Clinician is the canonical studying agent; do not use Self as the ontology term.
Hyle is an ontically existent entity that is epistemically non-existent to a particular observer because no Mode of Access has yet been established between the observer and the entity.
A priori is the pre-existing organization of the Clinician that conditions Study.
Schema is a dependent noetic organization produced through Study and depends on Hyle + A priori + Study; it is not the object itself.
An Instantiation is a particular realization of a Schema. A Trace is an accessible manifestation, measurement, sign, signal, or result through which Hyle becomes available.
3D Reality = Identity + State; Identity = Reality − State conceptually. State differentiates Realities; Identity unifies them.
Change, not time, is the RabbitHole fourth dimension. 4D Reality = Identity through Change and is not simply 3D + time.
Mode of Access ordering is Societies → Humans → Systems → Organs → Tissues → Cells → Molecules → Atoms; distinguishability and apparent sameness are mode-relative.
Awareness belongs to a particular 3D State. Life is identity preserved through changing 3D Realities. Death terminates the living identity-preserving succession; remaining Hyle may continue changing.
UMLS supplies external biomedical terminology (CUIs, terms, semantic types, sources); it must not silently redefine RabbitHole foundational concepts.`;

const faq = (id, question, answer) => ({ id, question, answer });
export const CANONICAL_FAQ_ITEMS = Object.freeze([
  faq("amctoshs", "What is RabbitHole?", "<p><strong>RabbitHole</strong> represents patient reality as accessed and distinguished by a particular <strong>Clinician</strong> through a particular <strong>Mode of Access</strong>. <strong>3D Reality = Identity + State</strong>; <strong>4D Reality = Identity through Change</strong>.</p>"),
  faq("hyle", "What is Hyle?", "<p><strong>Hyle is an ontically existent entity that is epistemically non-existent to a particular observer because no Mode of Access has yet been established between the observer and the entity.</strong></p>"),
  faq("clinician", "What is a Clinician in RabbitHole?", "<p>The <strong>Clinician</strong> is the studying agent who accesses, distinguishes, compares, measures, relates, interprets, and studies Hyle. <strong>Clinician</strong> is the canonical RabbitHole term; <strong>Self</strong> is deprecated in ontology-facing language.</p>"),
  faq("a-priori", "What is A priori?", "<p><strong>A priori</strong> is the pre-existing organization of the Clinician that conditions Study. It includes fundamental capacities necessary for Study and previously acquired Schemas and relations.</p>"),
  faq("study", "What does Study mean?", "<p><strong>Study</strong> is the Clinician's active relational engagement with Hyle. It establishes extrinsic Clinician–Hyle relations while leaving Hyle's intrinsic relations independent.</p>"),
  faq("schema", "What is a Schema?", "<p>A <strong>Schema</strong> is a dependent noetic organization produced through Study. It depends on <strong>Hyle + A priori + Study</strong> and is not the object itself or an object inside Hyle.</p>"),
  faq("independence", "Why is Hyle independent and Schema dependent?", "<p><strong>Hyle is independent reality.</strong> A <strong>Schema</strong> is dependent on Hyle, the Clinician's A priori, and Study. Hyle can exist without a Schema; a Schema cannot arise independently of what is studied and the conditions that make Study possible.</p>"),
  faq("instantiation", "What is an Instantiation?", "<p>An <strong>Instantiation</strong> is a particular concrete realization of a Schema. A Schema organizes what is generalizable; an Instantiation is particular.</p>"),
  faq("trace", "What is a Trace?", "<p>A <strong>Trace</strong> is an accessible manifestation, measurement, sign, signal, or result through which aspects of Hyle become available to the Clinician. It is not identical to the object that generates it.</p>"),
  faq("intrinsic-relations", "What are intrinsic relations?", "<p><strong>Intrinsic relations</strong> belong to Hyle independently of the Clinician, such as part-of, connected-to, contains, located-within, causes, or interacts-with.</p>"),
  faq("extrinsic-relations", "What are extrinsic relations?", "<p><strong>Extrinsic relations</strong> are established between the Clinician and Hyle, such as observing a Patient, measuring a Trace, reading a Textbook, comparing Instantiations, or understanding a Relation.</p>"),
  faq("textbook-patient", "How are Textbook and Patient related?", "<p>Both can function as Hyle. A <strong>Textbook</strong> is predominantly accessed through linguistic references; a <strong>Patient</strong> is clinically and directly accessed through history, examination, observation, imaging, laboratory measurements, physiological signals, language, and other Traces.</p>"),
  faq("linguistic-reference", "What is a linguistic reference?", "<p>A <strong>linguistic reference</strong> is a sign that refers to a Schema, Trace, Instantiation, Relation, or conceptual model. A word is not identical to its meaning, Schema, or referent.</p>"),
  faq("conceptual-model", "What is a conceptual model?", "<p>A <strong>conceptual model</strong> is an organized network that may contain multiple Schemas, Instantiations, Traces, Relations, Linguistic References, and dependencies. A Textbook can linguistically represent a conceptual model.</p>"),
  faq("reality", "What is RabbitHole Reality?", "<p>RabbitHole Reality is patient-instance-specific and Clinician-relative: <strong>Reality = R(P, C, M)</strong>, where P is Patient Instance, C is Clinician, and M is Mode of Access. This relation does not create the independent patient/Hyle.</p>"),
  faq("identity", "What is Identity?", "<p><strong>Identity</strong> is what remains attributable to the same Patient Instance across State changes. Conceptually, <strong>Identity = Reality − State</strong>; State differentiates Realities while Identity unifies them.</p>"),
  faq("state", "What is State?", "<p><strong>State</strong> is the particular configuration of a Patient Reality that can vary while Identity is preserved, including spatial configuration, structures, positions, relations, conditions, and Traces distinguishable through a Mode of Access.</p>"),
  faq("3d-reality", "What is 3D Reality?", "<p><strong>3D Reality is Identity in a particular State.</strong> It represents the spatial configuration of a Patient Instance as distinguishable through a Mode of Access. Spatial configuration can code Reality but is not asserted to exhaust every possible property.</p>"),
  faq("4d-reality", "What is 4D Reality?", "<p><strong>4D Reality is Identity through Change.</strong> It relates changing 3D Realities without privileging one State. It is not simply 3D plus time.</p>"),
  faq("change", "Why is Change, not time, the fourth dimension?", "<p><strong>Change</strong> is the distinction between identity-preserving 3D configurations. Operational timestamps may index measurements, but time is not automatically a primitive RabbitHole ontological variable.</p>"),
  faq("mode-of-access", "What is Mode of Access?", `<p>Mode of Access controls distinguishability. The canonical sequence is <strong>${MODE_OF_ACCESS.map((mode) => mode[0].toUpperCase() + mode.slice(1)).join(" → ")}</strong>. Apparent sameness at Humans Mode does not imply no change at Atoms Mode.</p>`),
  faq("awareness", "What is Awareness?", "<p><strong>Awareness belongs to a particular 3D State.</strong> It begins with distinction, selective relation, foreground/background, and differentiation. To be aware of everything without distinction is functionally to be aware of nothing.</p>"),
  faq("life", "What is Life?", "<p><strong>Life</strong> is continuous preservation of Patient Identity through changing 3D spatial configurations. It is not absence of change.</p>"),
  faq("death", "What is Death?", "<p><strong>Death</strong> terminates the living identity-preserving succession of distinct 3D Realities. Remaining Hyle may continue changing after the living Patient trajectory ends.</p>"),
]);

export const buildCanonicalFaqItems = () => CANONICAL_FAQ_ITEMS.map((item) => ({ ...item }));

export const validateOntology = () => {
  const errors = [];
  const ids = new Set(getOntologyConceptIds());
  if (MODE_OF_ACCESS.join(",") !== "societies,humans,systems,organs,tissues,cells,molecules,atoms") errors.push("Mode of Access ordering is invalid.");
  Object.values(AMCTOSHS_CONCEPTS).forEach((item) => {
    item.dependsOn?.forEach((dependency) => { if (!ids.has(dependency)) errors.push(`${item.id} depends on unknown concept ${dependency}.`); });
    item.relations?.forEach((relation) => { if (!ids.has(relation.target) && !MODE_OF_ACCESS.includes(relation.target)) errors.push(`${item.id} relates to unknown concept ${relation.target}.`); });
  });
  if (AMCTOSHS_CONCEPTS.schema.independent !== false) errors.push("Schema must be dependent.");
  if (JSON.stringify(AMCTOSHS_CONCEPTS.schema.dependsOn) !== JSON.stringify(["hyle", "a-priori", "study"])) errors.push("Schema dependency is invalid.");
  return { valid: errors.length === 0, errors };
};
