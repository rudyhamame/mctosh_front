export const PROTECTED_HYPHENATED_TERMS = new Set([
  "beat-to-beat", "dose-dependent", "age-related", "well-defined", "t-cell", "b-cell",
  "p-p", "p-r", "q-t", "st-segment", "follow-up", "long-term", "short-term",
  "end-diastolic", "end-systolic",
]);

export const KNOWN_JOINED_WORDS = new Set([
  "characterized", "unknown", "within", "without", "overall", "sinoatrial",
  "atrioventricular", "electrocardiogram", "tachycardia", "bradycardia",
]);

export const normalizeLexicalWord = (value) => String(value || "").trim().toLowerCase();

export const defaultLexicalResources = {
  isKnownWord: (word) => KNOWN_JOINED_WORDS.has(normalizeLexicalWord(word)),
  isKnownMedicalWord: (word) => KNOWN_JOINED_WORDS.has(normalizeLexicalWord(word)),
  isKnownHyphenatedWord: (word) => PROTECTED_HYPHENATED_TERMS.has(normalizeLexicalWord(word)),
  isKnownDocumentWord: () => false,
};
