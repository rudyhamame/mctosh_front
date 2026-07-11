// Client for the Human Reference Atlas API (https://apps.humanatlas.io/api).
// Public, unauthenticated, external service — unlike the rest of src/utils,
// this does NOT go through config/api.js's apiUrl()/authHeader(), since it
// isn't our own backend.
const HRA_BASE_URL = "https://apps.humanatlas.io/api";

const hraFetch = async (path) => {
  const res = await fetch(`${HRA_BASE_URL}${path}`);
  if (!res.ok) throw new Error(`Human Reference Atlas request failed (${res.status})`);
  return res.json();
};

export const getReferenceOrgans = () => hraFetch("/v1/reference-organs");

export const getCellTypeTree = () => hraFetch("/v1/cell-type-tree-model");

export const getOntologyTree = () => hraFetch("/v1/ontology-tree-model");

export const getFtuIllustrations = async () => {
  const data = await hraFetch("/v1/ftu-illustrations");
  return data["@graph"] || [];
};

export const getTissueBlocks = (ontologyTermIri) => {
  const qs = ontologyTermIri
    ? `?ontology-terms=${encodeURIComponent(ontologyTermIri)}`
    : "";
  return hraFetch(`/v1/tissue-blocks${qs}`);
};
