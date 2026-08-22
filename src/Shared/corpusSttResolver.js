const SPEECH_TOKEN_RE = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;

const readJson = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
};

const normalizeWord = (value) => String(value || "")
  .normalize("NFKC")
  .replaceAll("’", "'")
  .toLocaleLowerCase()
  .trim();

const preserveSpokenCase = (spoken, corpusWord) => {
  if (spoken === spoken.toLocaleUpperCase() && /\p{L}/u.test(spoken)) {
    return corpusWord.toLocaleUpperCase();
  }
  if (/^\p{Lu}/u.test(spoken)) {
    return `${corpusWord.charAt(0).toLocaleUpperCase()}${corpusWord.slice(1)}`;
  }
  return corpusWord;
};

const levenshteinWithin = (left, right, maximum) => {
  if (Math.abs(left.length - right.length) > maximum) return maximum + 1;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    let rowMinimum = row;
    for (let column = 1; column <= right.length; column += 1) {
      const value = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
      current[column] = value;
      rowMinimum = Math.min(rowMinimum, value);
    }
    if (rowMinimum > maximum) return maximum + 1;
    previous = current;
  }
  return previous[right.length];
};

const allowedDistance = (length) => {
  if (length < 4) return 0;
  if (length <= 7) return 1;
  if (length <= 11) return 2;
  return 3;
};

const readCorpusEntries = () => {
  const selectedWords = readJson("mctosh_corpus_unit_words", []);
  const allWords = readJson("mctosh_corpus_words", []);
  const source = Array.isArray(selectedWords) && selectedWords.length
    ? selectedWords
    : allWords;
  const snapshot = readJson("mctosh_corpus_snapshot", null);
  const occurrences = new Map(
    Array.isArray(snapshot?.rows)
      ? snapshot.rows.map((row) => [normalizeWord(row?.string), Number(row?.occurrence) || 1])
      : [],
  );
  const unique = new Map();
  (Array.isArray(source) ? source : []).forEach((entry) => {
    const word = normalizeWord(typeof entry === "string" ? entry : entry?.string);
    if (!word || unique.has(word)) return;
    unique.set(word, { word, occurrence: occurrences.get(word) || Number(entry?.occurrence) || 1 });
  });
  return [...unique.values()];
};

let corpusIndexCache = null;

const corpusIndex = () => {
  if (corpusIndexCache) return corpusIndexCache;
  const entries = readCorpusEntries();
  const exact = new Map(entries.map((entry) => [entry.word, entry.word]));
  const buckets = new Map();
  entries.forEach((entry) => {
    const first = entry.word.charAt(0);
    const key = `${first}:${entry.word.length}`;
    const bucket = buckets.get(key) || [];
    bucket.push(entry);
    buckets.set(key, bucket);
  });
  corpusIndexCache = { entries, exact, buckets };
  return corpusIndexCache;
};

// Read-only evidence adapter used by deterministic reconstruction. It exposes
// the existing Corpus index (including its stored occurrence counts) without
// creating a second vocabulary or allowing reconstruction to mutate Corpus.
export const lookupCorpusEvidence = (value) => {
  const normalized = normalizeWord(value);
  const { entries } = corpusIndex();
  const entry = entries.find((candidate) => candidate.word === normalized);
  return {
    candidate: String(value || ""),
    normalized,
    recognized: Boolean(entry),
    frequency: entry ? Number(entry.occurrence) || 1 : 0,
    source: "application-corpus",
  };
};

export const getCorpusEvidenceVersion = () => {
  const { entries } = corpusIndex();
  let hash = 2166136261;
  entries.forEach((entry) => {
    const value = `${entry.word}:${entry.occurrence}|`;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
  });
  return `local-corpus-${(hash >>> 0).toString(16).padStart(8, "0")}`;
};

if (typeof window !== "undefined") {
  const invalidateCorpusIndex = () => { corpusIndexCache = null; };
  window.addEventListener("amctoshs:corpus-words", invalidateCorpusIndex);
  window.addEventListener("storage", invalidateCorpusIndex);
}

export const suggestCorpusCorrections = (selectedText, limit = 10) => {
  const spoken = String(selectedText || "").trim();
  const normalized = normalizeWord(spoken);
  if (!normalized || !/^[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*$/u.test(normalized)) return [];

  const { buckets } = corpusIndex();
  const maximum = normalized.length <= 2
    ? 1
    : Math.max(2, Math.min(3, Math.ceil(normalized.length * 0.3)));
  const matches = [];
  for (let length = Math.max(1, normalized.length - maximum); length <= normalized.length + maximum; length += 1) {
    const candidates = buckets.get(`${normalized.charAt(0)}:${length}`) || [];
    candidates.forEach((candidate) => {
      if (candidate.word === normalized) return;
      const distance = levenshteinWithin(normalized, candidate.word, maximum);
      if (distance <= maximum) matches.push({ ...candidate, distance });
    });
  }
  return matches
    .sort((left, right) => left.distance - right.distance
      || right.occurrence - left.occurrence
      || left.word.localeCompare(right.word))
    .slice(0, limit)
    .map((candidate) => preserveSpokenCase(spoken, candidate.word));
};

export const createCorpusSttResolver = () => {
  const { entries, exact, buckets } = corpusIndex();
  if (!entries.length) return (transcript) => String(transcript || "");

  const resolveToken = (spokenToken) => {
    const normalized = normalizeWord(spokenToken);
    if (!normalized || /^\p{N}+$/u.test(normalized)) return spokenToken;
    const exactWord = exact.get(normalized);
    if (exactWord) return preserveSpokenCase(spokenToken, exactWord);

    const maximum = allowedDistance(normalized.length);
    if (!maximum) return spokenToken;
    let best = null;
    for (let length = normalized.length - maximum; length <= normalized.length + maximum; length += 1) {
      const candidates = buckets.get(`${normalized.charAt(0)}:${length}`) || [];
      candidates.forEach((candidate) => {
        const distance = levenshteinWithin(normalized, candidate.word, maximum);
        if (distance > maximum) return;
        if (!best
          || distance < best.distance
          || distance === best.distance && candidate.occurrence > best.occurrence) {
          best = { ...candidate, distance };
        }
      });
    }
    return best ? preserveSpokenCase(spokenToken, best.word) : spokenToken;
  };

  return (transcript) => String(transcript || "").replace(SPEECH_TOKEN_RE, resolveToken);
};
