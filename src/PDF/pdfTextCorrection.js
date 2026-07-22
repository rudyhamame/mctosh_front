// pdfTextCorrection.js
//
// Selected-text correction: "the user selects distorted PDF text and
// requests a cleaned version" (spec section 21) — a SEPARATE, explicitly-
// requested feature from search (section 22). Search never needs this
// module; it tolerates distortion directly (pdfFuzzySearch.js). This one
// instead tries to reconstruct what the text was actually supposed to say,
// using only deterministic rules first (section 23) and local dictionary
// lookup — never a default AI call, per the free/local requirement.
//
// Pipeline, in order, each step strictly safer than the next:
//   1. Deterministic: Unicode/ligature/whitespace fold (pdfTextNormalizer),
//      plus hyphenation repair specific to real line breaks.
//   2. Split-word repair: join two adjacent fragments ONLY when the join
//      is a known dictionary word AND at least one fragment isn't already
//      one on its own (never merges two already-valid words — "heart
//      failure" stays two words, section 24).
//   3. Fuzzy dictionary fallback: for whatever's still unrecognized,
//      surface the closest vocabulary word as a labelled, confidence-
//      scored CANDIDATE only — this step never silently rewrites
//      correctedText itself (see the note on applyFuzzyFallback below for
//      why: unlike split-word repair, a lone out-of-vocabulary word is not
//      strong enough evidence on its own, and this app's dictionary is a
//      small, hand-curated, deliberately incomplete list — treating "not
//      found in it" as "therefore wrong" would overcorrect real words the
//      list simply doesn't happen to contain).

import { normalizePdfText } from "./pdfTextNormalizer.js";
import { hasCriticalPrefixConflict, similarityFromDistance, weightedEditDistance } from "./pdfFuzzySearch.js";
import { MEDICAL_VOCABULARY } from "./medicalVocabulary.js";
import { COMMON_ENGLISH_WORDS } from "./commonEnglishWords.js";

const HIGH_CONFIDENCE = 0.9; // section 27 — below this, mark uncertain instead of asserting the correction
const PER_WORD_CANDIDATE_FLOOR = 0.75; // single out-of-vocabulary words are risky to flag at all below this
const WHOLE_SELECTION_CANDIDATE_FLOOR = 0.6; // a whole distorted selection matching a real word is stronger evidence than one stray word matching one

const isKnownWord = (w) => {
  const lower = w.toLowerCase();
  return MEDICAL_VOCABULARY.has(lower) || COMMON_ENGLISH_WORDS.has(lower);
};

// ── Step 1: deterministic, non-dictionary repairs ────────────────────────
const HYPHEN_LINE_BREAK_RE = /(\p{L}+)-([ \t]*\n[ \t]*)(\p{Ll}\p{L}*)/gu;

/**
 * Real line-break hyphenation ("cardio-\nvascular" -> "cardiovascular")
 * is repaired for real here (unlike search's normalizedText, which
 * deliberately keeps hyphens verbatim and only dehyphenates in the
 * throwaway compactText) — a correction result is explicitly a best-effort
 * reconstruction, and showing "cardiovascular" with a reported change is
 * the whole point. But "well-controlled" must NOT become "wellcontrolled"
 * just because it happened to wrap at that hyphen (section 9) — resolved
 * with the dictionary: prefer the joined-no-hyphen reading only when it's
 * a KNOWN word; otherwise keep the hyphen (just drop the line break),
 * since silently deleting a possibly-meaningful character is worse than
 * leaving it in place.
 */
const repairLineBreakHyphens = (text) => {
  const changes = [];
  const repaired = text.replace(HYPHEN_LINE_BREAK_RE, (m, wordA, ws, wordB) => {
    const joined = wordA + wordB;
    const keepHyphen = !isKnownWord(joined);
    const to = keepHyphen ? `${wordA}-${wordB}` : joined;
    changes.push({ from: m, to, type: "hyphenation_repair", confidence: keepHyphen ? 0.85 : 0.95 });
    return to;
  });
  return { text: repaired, changes };
};

const applyDeterministicRepairs = (text) => {
  const changes = [];

  // Hyphenation FIRST, while real "\n" characters still exist — whitespace
  // collapsing below would make a genuine line-break indistinguishable
  // from an ordinary inline "word- word".
  const hyphenStep = repairLineBreakHyphens(text);
  changes.push(...hyphenStep.changes);
  const hyphenRepaired = hyphenStep.text;

  const hadLigature = /[ﬀﬁﬂﬃﬄﬅﬆ]/.test(hyphenRepaired);
  const norm = normalizePdfText(hyphenRepaired);
  const out = norm.normalizedText;
  if (hadLigature) changes.push({ from: hyphenRepaired, to: out, type: "ligature_expansion", confidence: 0.99 });
  else if (out !== hyphenRepaired.replace(/\s+/g, " ").trim() && /[^\x00-\x7F]/.test(hyphenRepaired)) {
    changes.push({ from: hyphenRepaired, to: out, type: "unicode_normalization", confidence: 0.97 });
  }
  if (/\s{2,}|\t|\n/.test(hyphenRepaired)) {
    changes.push({ from: hyphenRepaired, to: out, type: "whitespace_repair", confidence: 0.97 });
  }

  return { text: out, changes };
};

// ── Step 2: dictionary-based split-word repair ───────────────────────────
// Trailing punctuation on the second fragment ("infar ction." -> "ction.")
// is preserved on the joined result instead of being silently dropped.
const applySplitWordRepair = (text) => {
  const words = text.split(" ");
  const changes = [];
  const out = [];
  let i = 0;
  while (i < words.length) {
    const a = words[i];
    const b = words[i + 1];
    if (a && b) {
      const aClean = a.replace(/[^\p{L}\p{N}]/gu, "");
      const bMatch = b.match(/^([\p{L}\p{N}]*)(.*)$/su);
      const bClean = bMatch?.[1] || "";
      const bTrailing = bMatch?.[2] || "";
      const joined = aClean + bClean;
      if (aClean && bClean && isKnownWord(joined) && !(isKnownWord(aClean) && isKnownWord(bClean))) {
        const to = joined + bTrailing;
        out.push(to);
        changes.push({ from: `${a} ${b}`, to, type: "split_word_repair", confidence: 0.97 });
        i += 2;
        continue;
      }
    }
    out.push(a);
    i += 1;
  }
  return { text: out.join(" "), changes };
};

// ── Step 3: fuzzy dictionary fallback for whatever's still unrecognized ──
const VOCAB_LIST = () => [...MEDICAL_VOCABULARY, ...COMMON_ENGLISH_WORDS];

const bestVocabularyMatch = (word) => {
  const lower = word.toLowerCase();
  let best = null;
  for (const candidate of VOCAB_LIST()) {
    if (Math.abs(candidate.length - lower.length) > Math.max(3, lower.length * 0.5)) continue;
    if (hasCriticalPrefixConflict(lower, candidate)) continue;
    const distance = weightedEditDistance(lower, candidate);
    const confidence = similarityFromDistance(distance, lower.length, candidate.length);
    if (!best || confidence > best.confidence) best = { text: candidate, confidence };
  }
  return best;
};

/**
 * Per-word fuzzy fallback — deliberately CANDIDATES-ONLY, never applied to
 * correctedText. A lone word not found in a small hand-curated dictionary
 * is weak evidence of a typo (it's very plausibly just a real word the
 * dictionary doesn't happen to list) — see medicalVocabulary.js/
 * commonEnglishWords.js's own doc comments on why they're intentionally
 * incomplete. Split-word repair above is the one step that's safe to
 * auto-apply, because "two fragments joined into a real dictionary word"
 * is a much stronger, much rarer coincidence than "one word not being in
 * the list".
 */
const applyFuzzyFallback = (text) => {
  const words = text.split(" ");
  const candidatesByWord = [];
  for (const w of words) {
    const clean = w.replace(/[^\p{L}\p{N}]/gu, "");
    if (!clean || clean.length < 4 || isKnownWord(clean)) continue;
    const match = bestVocabularyMatch(clean);
    if (!match || match.confidence < PER_WORD_CANDIDATE_FLOOR) continue;
    candidatesByWord.push({ original: w, text: match.text, confidence: match.confidence });
  }
  return { candidatesByWord };
};

// Whole-selection fuzzy fallback: catches distortions that don't align to
// word boundaries at all (e.g. "Bradi DycaR dia" — none of its 3 space-
// separated fragments individually resembles a dictionary word, but the
// whole compact-joined selection does). Only attempted when the selection
// is short (a handful of words) — this is a "did you mean" for one
// garbled term, not a whole-paragraph rewrite — and only when nothing else
// in the pipeline found anything at all, so it never overrides a more
// precise repair.
const applyWholeSelectionFuzzyFallback = (text) => {
  const compact = text.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
  if (compact.length < 5 || compact.length > 40) return null;
  const match = bestVocabularyMatch(compact);
  if (!match || match.confidence < WHOLE_SELECTION_CANDIDATE_FLOOR) return null;
  return match;
};

/**
 * Deterministic-first, dictionary-assisted correction of one selected
 * piece of PDF text. `beforeText`/`afterText`/`pageNumber` are accepted
 * per spec section 29's context-aware API shape; this first implementation
 * uses them only for the returned metadata (surrounding context makes a
 * human reviewer more confident even when the algorithm itself doesn't
 * use it yet to change scoring — a documented, honest limitation rather
 * than pretending to be context-aware).
 */
export const correctSelectedPdfText = ({ selectedText, beforeText = "", afterText = "", pageNumber = null } = {}) => {
  const originalText = String(selectedText || "");
  if (!originalText.trim()) {
    return { originalText, normalizedText: "", correctedText: "", confidence: 1, changes: [], candidates: [], uncertain: false, pageNumber };
  }

  const normalizedText = normalizePdfText(originalText).normalizedText;

  const step1 = applyDeterministicRepairs(originalText);
  const step2 = applySplitWordRepair(step1.text);

  // Nothing left to guess at if every word here is already recognized —
  // skip both fuzzy stages entirely rather than "correcting" an
  // already-correct word to its stored-casing dictionary form (e.g.
  // "HbA1c" must never become "hba1c" just because that's how it's spelled
  // in the vocabulary Set).
  const remainingWords = step2.text.split(" ").map((w) => w.replace(/[^\p{L}\p{N}]/gu, "")).filter(Boolean);
  const allWordsKnown = remainingWords.length > 0 && remainingWords.every(isKnownWord);

  const step3 = allWordsKnown ? { candidatesByWord: [] } : applyFuzzyFallback(step2.text);

  let correctedText = step2.text;
  const changes = [...step1.changes, ...step2.changes];
  const candidates = step3.candidatesByWord.map((c) => ({ text: c.text, confidence: c.confidence, original: c.original }));

  // Whole-selection fallback only as a last resort, when literally nothing
  // more precise fired (and there's genuinely at least one unrecognized
  // word to explain) — it's the highest-risk step (matching a whole
  // garbled run against the dictionary), so it never runs alongside, or
  // overrides, a more targeted repair, and never runs on already-correct text.
  if (!changes.length && !candidates.length && !allWordsKnown) {
    const wholeMatch = applyWholeSelectionFuzzyFallback(step2.text);
    if (wholeMatch) {
      if (wholeMatch.confidence >= HIGH_CONFIDENCE) {
        correctedText = wholeMatch.text;
        changes.push({ from: originalText, to: wholeMatch.text, type: "fuzzy_dictionary_match", confidence: wholeMatch.confidence });
      } else {
        candidates.push({ text: wholeMatch.text, confidence: wholeMatch.confidence, original: originalText });
      }
    }
  }

  const confidence = changes.length
    ? Math.min(...changes.map((c) => c.confidence))
    : (candidates.length ? candidates[0].confidence : 1);
  const uncertain = confidence < HIGH_CONFIDENCE;

  return {
    originalText,
    normalizedText,
    correctedText,
    confidence,
    changes,
    candidates: candidates.sort((a, b) => b.confidence - a.confidence),
    uncertain,
    pageNumber,
  };
};
