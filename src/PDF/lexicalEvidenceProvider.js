import { lookupDictionaryWord } from "../utils/dictionarySettings.js";
import { getCorpusEvidenceVersion, lookupCorpusEvidence } from "../Shared/corpusSttResolver.js";
import { searchUmls } from "../Vocabs/umlsClient.js";
import { isAbbreviationCandidate, normalizeAbbreviation } from "../Linguistics/abbreviations/extractAbbreviations.js";
import { apiUrl } from "../config/api.js";
import { readStoredSession } from "../utils/sessionCleanup.js";

const normalize = (value) => String(value || "").normalize("NFKC").replaceAll("’", "'").toLocaleLowerCase().trim();
const dictionaryCache = new Map();
const umlsCache = new Map();
const inflight = new Map();

const deduplicated = (cache, key, factory) => {
  if (cache.has(key)) return Promise.resolve(cache.get(key));
  const inflightKey = `${cache === dictionaryCache ? "dictionary" : "umls"}:${key}`;
  if (inflight.has(inflightKey)) return inflight.get(inflightKey);
  const promise = factory().then((value) => {
    cache.set(key, value);
    return value;
  }).finally(() => inflight.delete(inflightKey));
  inflight.set(inflightKey, promise);
  return promise;
};

const unavailable = (provider, error) => ({ recognized: false, status: "unavailable", provider, error: String(error?.message || error || "Unavailable") });

const lookupStoredEvidence = async (candidates, signal) => {
  const token = readStoredSession()?.token || "";
  if (!token) return { evidence: new Map(), evidenceVersion: "anonymous-unavailable" };
  try {
    const response = await fetch(apiUrl("/api/document-reconstruction/lexical-evidence"), { method: "POST", signal, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ candidates }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error?.message || payload.error || "Stored lexical evidence failed.");
    return { evidence: new Map((payload.evidence || []).map((entry) => [normalize(entry.candidate), entry])), evidenceVersion: payload.evidenceVersion || "stored-lexical-unknown" };
  } catch (error) {
    if (signal?.aborted) return { evidence: new Map(), evidenceVersion: "stored-lexical-timeout" };
    return { evidence: new Map(), evidenceVersion: `stored-lexical-unavailable:${error.message}` };
  }
};

const dictionaryEvidence = (candidate, signal) => deduplicated(dictionaryCache, normalize(candidate), async () => {
  try {
    const entry = await lookupDictionaryWord(candidate, { signal });
    return {
      recognized: entry.dictionaryResponseType === "entries" || entry.definitions.length > 0,
      status: "available",
      entries: entry.definitions,
      sources: [entry.sourceLabel].filter(Boolean),
      provider: entry.source,
      matchedForm: entry.word,
    };
  } catch (error) {
    // A normal dictionary miss and provider failure currently share the
    // existing endpoint's error channel, so preserve that uncertainty.
    return unavailable("application-dictionary", error);
  }
});

const umlsMatchType = (candidate, concept) => {
  const query = normalize(candidate);
  const preferred = normalize(concept.preferredName);
  if (preferred && preferred === query) return "preferred-name-exact";
  return "search-candidate";
};

const umlsEvidence = (candidate, signal) => deduplicated(umlsCache, normalize(candidate), async () => {
  try {
    const response = await searchUmls(candidate, { pageSize: 10, signal });
    const concepts = response.items.filter((concept) => concept.cui).map((concept) => ({
      cui: concept.cui,
      preferredConcept: concept.preferredName,
      semanticTypes: concept.semanticTypes.map((type) => type.name || type.tui).filter(Boolean),
      sourceVocabularies: [],
      matchedTerm: concept.preferredName,
      matchType: umlsMatchType(candidate, concept),
    }));
    return { recognized: concepts.length > 0, exactMatch: concepts.some((concept) => concept.matchType === "preferred-name-exact"), status: "available", concepts };
  } catch (error) {
    return unavailable("umls", error);
  }
});

export const createLexicalEvidenceProvider = ({ abbreviations = [], allowUmls = true } = {}) => {
  const abbreviationIndex = new Map(abbreviations.map((entry) => [normalizeAbbreviation(entry.shortForm), entry]));
  const provider = {
    evidenceVersions: {
      dictionary: "application-dictionary-live",
      corpus: getCorpusEvidenceVersion(),
      umls: allowUmls ? "umls-current-via-backend" : "disabled",
      abbreviations: `document-abbreviations-${abbreviationIndex.size}`,
    },
    lookupLocal(candidate) {
      const value = String(candidate || "").trim();
      const corpus = lookupCorpusEvidence(value);
      const abbreviationEntry = abbreviationIndex.get(normalizeAbbreviation(value));
      return {
        candidate: value,
        corpus: { recognized: corpus.recognized, globalFrequency: corpus.frequency, source: corpus.source },
        abbreviation: { recognized: Boolean(abbreviationEntry), status: abbreviationEntry?.status || "absent", expansions: abbreviationEntry?.alternatives?.map((entry) => entry.longForm) || [] },
      };
    },
    async lookup(candidate, context = {}) {
      const value = String(candidate || "").trim();
      const corpus = lookupCorpusEvidence(value);
      const abbreviationEntry = abbreviationIndex.get(normalizeAbbreviation(value));
      const stored = context.storedEvidence || null;
      const dictionary = stored?.dictionary?.recognized ? stored.dictionary : await dictionaryEvidence(value, context.signal);
      const medicalCandidate = context.medicalCandidate === true || (dictionary.recognized && dictionary.provider === "medical");
      const umls = stored?.umls?.recognized ? stored.umls : allowUmls && medicalCandidate
        ? await umlsEvidence(value, context.signal)
        : { recognized: false, status: "not-requested", concepts: [] };
      return {
        candidate: value,
        dictionary,
        corpus: { recognized: corpus.recognized || Boolean(stored?.corpus?.recognized), globalFrequency: Math.max(corpus.frequency, Number(stored?.corpus?.frequency) || 0), source: stored?.corpus?.recognized ? stored.corpus.sources || ["application-corpus"] : corpus.source },
        umls,
        context: stored?.context || null,
        approvedLexicon: stored?.approvedLexicon || null,
        abbreviation: {
          recognized: Boolean(abbreviationEntry) || isAbbreviationCandidate(value),
          status: abbreviationEntry?.status || (isAbbreviationCandidate(value) ? "candidate" : "absent"),
          expansions: abbreviationEntry?.alternatives?.map((entry) => entry.longForm) || (abbreviationEntry?.longForm ? [abbreviationEntry.longForm] : []),
        },
      };
    },
    async lookupMany(candidates, contextFor = () => ({})) {
      const unique = [...new Map(candidates.map((candidate) => [normalize(candidate), String(candidate || "").trim()])).values()].filter(Boolean);
      const firstContext = unique.length ? contextFor(unique[0]) : {};
      const stored = await lookupStoredEvidence(unique, firstContext.signal);
      provider.evidenceVersions.storedLexical = stored.evidenceVersion;
      return new Map(await Promise.all(unique.map(async (candidate) => [normalize(candidate), await provider.lookup(candidate, { ...contextFor(candidate), storedEvidence: stored.evidence.get(normalize(candidate)) })])));
    },
    clearMemoryCache() {
      dictionaryCache.clear();
      umlsCache.clear();
    },
  };
  return provider;
};

export const lexicalEvidenceCacheDiagnostics = () => ({ dictionaryEntries: dictionaryCache.size, umlsEntries: umlsCache.size, inflight: inflight.size });
