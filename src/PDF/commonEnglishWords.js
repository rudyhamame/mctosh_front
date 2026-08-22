// commonEnglishWords.js
//
// A compact, hand-curated list of common English words, used alongside
// medicalVocabulary.js by pdfTextCorrection.js's split-word repair to
// decide whether joining two fragments ("pati" + "ent" -> "patient")
// produced a real word. Free/local/public-domain-style data — a plain
// frequency word list, not a licensed corpus or dictionary product.
//
// Intentionally NOT exhaustive (a few hundred of the highest-frequency
// English words, covering the function words and common verbs/adjectives
// that show up in almost any sentence) — split-word repair only needs to
// recognize that a REPAIRED fragment is plausible, not spell-check every
// word on the page. Domain-specific vocabulary lives in
// medicalVocabulary.js instead; extend that file for new medical terms,
// this one only for genuinely common general-English words.

export const COMMON_ENGLISH_WORDS = new Set([
  // Function words
  "the", "a", "an", "and", "or", "but", "if", "then", "than", "so",
  "of", "in", "on", "at", "by", "for", "with", "without", "from", "to",
  "into", "onto", "over", "under", "above", "below", "between", "among",
  "through", "during", "before", "after", "while", "until", "since",
  "this", "that", "these", "those", "it", "its", "he", "she", "they",
  "we", "you", "i", "his", "her", "their", "our", "your", "them", "him",
  "who", "whom", "whose", "which", "what", "when", "where", "why", "how",
  "is", "are", "was", "were", "be", "been", "being", "am",
  "has", "have", "had", "having",
  "do", "does", "did", "doing", "done",
  "will", "would", "shall", "should", "can", "could", "may", "might", "must",
  "not", "no", "yes", "nor", "as", "also", "too", "very", "more", "most",
  "less", "least", "some", "any", "all", "each", "every", "both", "few",
  "many", "much", "several", "other", "another", "such", "same",
  "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "first", "second", "third", "last", "next",

  // Common verbs
  "presented", "present", "presents", "showed", "show", "shows",
  "reported", "report", "reports", "revealed", "reveal", "reveals",
  "noted", "note", "notes", "found", "find", "finds", "finding",
  "indicated", "indicate", "indicates", "suggested", "suggest", "suggests",
  "confirmed", "confirm", "confirms", "denied", "deny", "denies",
  "developed", "develop", "develops", "occurred", "occur", "occurs",
  "increased", "increase", "increases", "decreased", "decrease", "decreases",
  "started", "start", "starts", "stopped", "stop", "stops",
  "given", "give", "gives", "taken", "take", "takes", "took",
  "used", "use", "uses", "using", "required", "require", "requires",
  "remained", "remain", "remains", "continued", "continue", "continues",
  "associated", "associate", "associates", "caused", "cause", "causes",
  "result", "results", "resulted", "resulting", "leads", "led", "lead",

  // Common adjectives / descriptors
  "normal", "abnormal", "positive", "negative", "significant",
  "elevated", "reduced", "stable", "unstable", "recurrent", "persistent",
  "recent", "current", "previous", "prior", "new", "old", "young",
  "large", "small", "high", "low", "early", "late", "further", "additional",
  "possible", "likely", "unlikely", "common", "rare", "typical", "atypical",
  "left", "right", "upper", "lower", "central", "peripheral",

  // Common nouns
  "patient", "patients", "history", "examination", "diagnosis",
  "treatment", "symptom", "symptoms", "condition", "conditions",
  "disease", "disorder", "syndrome", "case", "cases", "study", "studies",
  "result", "results", "outcome", "outcomes", "risk", "risks",
  "rate", "rates", "level", "levels", "value", "values", "range",
  "test", "tests", "testing", "sample", "samples", "data", "value",
  "day", "days", "week", "weeks", "month", "months", "year", "years",
  "time", "times", "age", "group", "groups", "number", "type", "types",
]);
