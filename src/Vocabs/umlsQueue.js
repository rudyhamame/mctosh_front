import { listSavedVocabulary, saveVocabulary, updateVocabulary } from "../utils/vocabApi";
import { getUmlsResource, searchUmls } from "./umlsClient";
import { readUmlsLanguage } from "./umlsSettings";

const publishSavedVocabulary = (saved) => {
  if (typeof window !== "undefined" && saved?.id) {
    window.dispatchEvent(new CustomEvent("amctoshs:vocab-saved", { detail: saved }));
  }
};

export const fetchCompleteUmlsConcept = async (concept, language = readUmlsLanguage()) => {
  if (!concept?.cui) return null;
  const atomResult = await getUmlsResource(concept.cui, "atoms", { language });
  const atoms = atomResult.items || [];
  if (!atoms.length) return null;

  const supportingResources = await Promise.all(["definitions", "relations"].map(async (resource) => {
    const result = await getUmlsResource(concept.cui, resource);
    return [resource, { items: result.items, raw: result.raw }];
  }));
  const preferredAtom = atoms.find((atom) => ["PT", "PN"].includes(String(atom?.termType || "").toUpperCase())) || atoms[0];

  return {
    ...concept,
    preferredName: preferredAtom?.name || concept.preferredName,
    language,
    resources: {
      atoms: { items: atoms, raw: atomResult.raw },
      ...Object.fromEntries(supportingResources),
    },
  };
};

export const fetchFirstUmlsConceptInLanguage = async (concepts, language = readUmlsLanguage()) => {
  for (const concept of (concepts || []).slice(0, 10)) {
    const completed = await fetchCompleteUmlsConcept(concept, language);
    if (completed) return completed;
  }
  return null;
};

export const queueVocabularyForUmls = async (value, options = {}) => {
  const entry = String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!entry) throw new Error("Select text before adding it to the UMLS Queue.");

  const savedResponse = await listSavedVocabulary();
  const existing = (savedResponse.saved || []).find((item) => String(item.word || "").toLocaleLowerCase() === entry.toLocaleLowerCase());
  const queued = existing || (await saveVocabulary({
    word: entry,
    translation: "",
    definitions: [],
    source: options.source || "pdf-selection",
    sourceLabel: options.sourceLabel || "PDF selection",
  })).saved;
  publishSavedVocabulary(queued);

  try {
    const umlsResult = await searchUmls(entry, { pageSize: 10 });
    const concept = await fetchFirstUmlsConceptInLanguage(umlsResult.items, options.language || readUmlsLanguage());
    if (!concept) return { saved: queued, found: false, lookupError: null };

    const response = await updateVocabulary(queued.id, {
      ...queued,
      umls: concept,
      umlsData: umlsResult.raw || queued.umlsData || null,
      umlsResponse: umlsResult.raw || queued.umlsResponse || null,
    });
    publishSavedVocabulary(response.saved);
    return { saved: response.saved, found: true, concept, lookupError: null };
  } catch (lookupError) {
    return { saved: queued, found: false, lookupError };
  }
};
