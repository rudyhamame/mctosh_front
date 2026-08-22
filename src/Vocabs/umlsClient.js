import { apiUrl } from "../config/api";
import { readStoredSession } from "../utils/sessionCleanup";

const resourceCache = new Map();
const inflight = new Map();
const MAX_RESOURCE_CACHE_ENTRIES = 48;

const authHeaders = () => {
  const token = readStoredSession()?.token || "";
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const asList = (value) => Array.isArray(value) ? value : value ? [value] : [];
const noneToNull = (value) => {
  if (value === undefined || value === null || String(value).trim().toUpperCase() === "NONE") return null;
  return value;
};

export const unwrapResult = (payload) => {
  const result = payload?.result ?? payload;
  return result?.results ?? result;
};

export const tuiFromUri = (uri) => {
  const value = noneToNull(uri);
  if (!value) return null;
  const parts = String(value).split("/").filter(Boolean);
  return parts.at(-1) || null;
};

export const normalizeSemanticType = (type) => {
  const value = typeof type === "string" ? { name: type } : (type || {});
  return { name: noneToNull(value.name || value.label), uri: noneToNull(value.uri), tui: noneToNull(value.tui || tuiFromUri(value.uri)) };
};

export const normalizeConcept = (concept = {}) => ({
  cui: noneToNull(concept.ui || concept.cui || concept.CUI),
  preferredName: noneToNull(concept.name || concept.preferredName || concept.preferred_name),
  semanticTypes: asList(concept.semanticTypes || concept.semantic_types || concept.semanticType).map(normalizeSemanticType).filter((type) => type.name || type.tui),
  atoms: noneToNull(concept.atoms),
  definitions: noneToNull(concept.definitions),
  relations: noneToNull(concept.relations),
  suppressible: noneToNull(concept.suppressible),
  obsolete: noneToNull(concept.obsolete),
  majorRevisionDate: noneToNull(concept.majorRevisionDate || concept.major_revision_date),
  raw: concept,
});

export const normalizeAtom = (atom = {}) => ({
  aui: noneToNull(atom.ui || atom.aui || atom.AUI),
  name: noneToNull(atom.name),
  rootSource: noneToNull(atom.rootSource || atom.root_source),
  code: noneToNull(atom.code),
  language: noneToNull(atom.language),
  termType: noneToNull(atom.termType || atom.term_type),
  suppressible: noneToNull(atom.suppressible),
  obsolete: noneToNull(atom.obsolete),
  sourceDescriptor: noneToNull(atom.sourceDescriptor || atom.source_descriptor),
  raw: atom,
});

export const normalizeDefinition = (definition = {}) => ({
  value: noneToNull(definition.value || definition.definition || definition.text),
  rootSource: noneToNull(definition.rootSource || definition.root_source),
  language: noneToNull(definition.language || definition.lang),
  ui: noneToNull(definition.ui || definition.DUI),
  sourceOriginated: noneToNull(definition.sourceOriginated || definition.source_originated),
  raw: definition,
});

export const normalizeRelation = (relation = {}) => ({
  ui: noneToNull(relation.ui),
  relatedId: noneToNull(relation.relatedId || relation.related_id || relation.relatedFromId),
  relatedFromId: noneToNull(relation.relatedFromId),
  relatedToId: noneToNull(relation.relatedToId),
  rootSource: noneToNull(relation.rootSource || relation.root_source),
  relationLabel: noneToNull(relation.relationLabel || relation.relation_label),
  additionalRelationLabel: noneToNull(relation.additionalRelationLabel || relation.additional_relation_label),
  obsolete: noneToNull(relation.obsolete),
  suppressible: noneToNull(relation.suppressible),
  raw: relation,
});

const requestJson = async (url, signal) => {
  const response = await fetch(apiUrl(url), { headers: { Accept: "application/json", ...authHeaders() }, signal });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "UMLS request failed.");
  return payload;
};

export const searchUmls = async (query, options = {}) => {
  const params = new URLSearchParams({ string: query, pageNumber: String(options.pageNumber || 1), pageSize: String(options.pageSize || 25) });
  const payload = await requestJson(`/api/vocabs/umls/search?${params}`, options.signal);
  const result = unwrapResult(payload);
  return { items: asList(result).map(normalizeConcept), raw: payload, pageCount: payload.pageCount || result?.pageCount || 1 };
};

const fetchResourcePage = async (cui, resource, pageNumber, options = {}) => {
  const params = new URLSearchParams({ pageNumber: String(pageNumber), pageSize: "500" });
  if (resource === "atoms" && options.language) params.set("language", String(options.language).toUpperCase());
  const payload = await requestJson(`/api/vocabs/umls/concepts/${encodeURIComponent(cui)}/${resource}?${params}`, options.signal);
  const result = unwrapResult(payload);
  return { items: asList(result), raw: payload, pageCount: Number(payload.pageCount || result?.pageCount || 1) || 1 };
};

export const getUmlsResource = (cui, resource, options = {}) => {
  const language = resource === "atoms" ? String(options.language || "").toUpperCase() : "";
  const key = `current:${cui}:${resource}:${language}`;
  if (resourceCache.has(key)) return Promise.resolve(resourceCache.get(key));
  if (inflight.has(key)) return inflight.get(key);
  const promise = (async () => {
    const first = await fetchResourcePage(cui, resource, 1, options);
    const pages = [first];
    const pageCount = Math.min(first.pageCount, 20);
    for (let page = 2; page <= pageCount; page += 1) pages.push(await fetchResourcePage(cui, resource, page, options));
    const allItems = pages.flatMap((page) => page.items);
    const items = resource === "atoms" && language
      ? allItems.filter((atom) => String(atom?.language || "").toUpperCase() === language)
      : allItems;
    const value = { resource, language: language || null, items, raw: pages.map((page) => page.raw) };
    resourceCache.delete(key);
    resourceCache.set(key, value);
    while (resourceCache.size > MAX_RESOURCE_CACHE_ENTRIES) {
      resourceCache.delete(resourceCache.keys().next().value);
    }
    return value;
  })().finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
};

export const clearUmlsCache = () => resourceCache.clear();
