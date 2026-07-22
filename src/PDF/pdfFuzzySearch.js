// pdfFuzzySearch.js
//
// The multi-stage tolerant search pipeline: given a page index (from
// pdfSearchIndex.js) and a query, tries the safest/most precise method
// first and only falls through to fuzzy matching if nothing better is
// found — spec section 14/52. This module owns the fuzzy edit-distance
// matcher AND the medical-safety guardrails around it (prefix sensitivity,
// negation sensitivity) — those guardrails are the reason this is a
// hand-rolled matcher rather than a generic library: a stock fuzzy-search
// library (Fuse.js, SymSpell, ...) scores "hyperkalemia" vs "hypokalemia"
// as a near-perfect match (one character apart), which is exactly the
// class of false positive sections 50/51 require us to actively suppress.
// A small local weighted-edit-distance implementation gives full control
// over that scoring, with zero added bundle weight — see section 59's own
// list of acceptable local techniques ("Levenshtein/edit-distance
// libraries" includes hand-rolled ones).
//
// Never used for the *default* search bar keystroke path without a floor:
// stage order is exact -> case-insensitive -> compact (whitespace/hyphen-
// insensitive) -> token-window -> fuzzy, and fuzzy results below
// MIN_FUZZY_CONFIDENCE are dropped unless the caller explicitly asks for
// low-confidence results too (section 17).

import { normalizePdfText } from "./pdfTextNormalizer.js";
import {
  compactRangeToOriginal,
  mapRangeThroughSegments,
  normalizedRangeToOriginal,
  originalRangeToItemIndexes,
} from "./pdfTextMapping.js";

// ── Confidence bands (section 17) ───────────────────────────────────────
// Tuned, not arbitrary: EXACT/CASE_INSENSITIVE/COMPACT are all lossless-or-
// near-lossless reconstructions of the query (no character guessing), so
// they sit at or near 1.0. TOKEN allows non-token junk between real words,
// which is still a strong signal, so it starts below COMPACT. FUZZY_FLOOR
// (0.75) is the spec's own "probable match" floor (section 17); anything
// scoring under it is noise-level for medical text (a handful of stray
// character edits away from *some* word is not evidence of *that* word).
export const CONFIDENCE = {
  EXACT: 1.0,
  CASE_INSENSITIVE: 0.97,
  COMPACT: 0.93,
  ALIAS: 0.9,
  TOKEN: 0.85,
  FUZZY_FLOOR: 0.75,
};

// ── Scientific aliases (section 33) ──────────────────────────────────────
// Greek letters are kept verbatim in normalizedText/compactText (never
// blanket-replaced — a beta-blocker dose table should still display "β",
// not "beta"), but the spelled-out form is a deliberate, curated ALIAS
// used only for comparison, so "β-blocker" and "beta blocker" can find
// each other. Deliberately small and explicit rather than every Greek
// letter Unicode has, per "prefer aliases" / "be conservative".
const GREEK_ALIASES = {
  "α": "alpha", "β": "beta", "γ": "gamma", "δ": "delta", "ε": "epsilon",
  "θ": "theta", "λ": "lambda", "μ": "mu", "π": "pi", "σ": "sigma",
  "τ": "tau", "φ": "phi", "ω": "omega",
};
const GREEK_RE = new RegExp(`[${Object.keys(GREEK_ALIASES).join("")}]`, "g");
// Hyphens are also folded away at this stage (in addition to the Greek
// substitution): "β-blocker" and "beta blocker" only line up once a
// hyphen and an inter-word space are treated as the same non-event, same
// as compactText already does for spaces alone.
export const aliasFold = (s) => s.replace(GREEK_RE, (ch) => GREEK_ALIASES[ch] || ch).replace(/-/g, "");

/** Alias-folds compactLowerText char-by-char (Greek letters + dropping hyphens), keeping a segment map back to compact positions (mirrors pdfTextNormalizer's segment approach, scoped to just this one substitution). */
const buildAliasFoldMap = (compactLowerText) => {
  let aliasText = "";
  const segments = [];
  for (let i = 0; i < compactLowerText.length; i++) {
    const ch = compactLowerText[i];
    if (ch === "-") continue; // dropped, no segment — mirrors aliasFold's hyphen stripping
    const out = GREEK_ALIASES[ch] || ch;
    const aliasStart = aliasText.length;
    aliasText += out;
    segments.push({ aliasStart, aliasEnd: aliasStart + out.length, compactStart: i, compactEnd: i + 1 });
  }
  return { aliasText, segments };
};

// ── OCR-like confusion canonicalization (section 35) ────────────────────
// Applied ONLY inside the fuzzy comparator, to a throwaway copy of both
// strings — never to normalizedText/compactText themselves. Single-char
// confusions (l/I/1, O/0) get a reduced substitution cost directly; the
// multi-character ones (rn<->m, cl<->d, vv<->w) can't be expressed as a
// single substitution in classic edit distance, so they're folded to a
// shared canonical spelling before comparing, which is cheap and correct
// for scoring purposes without touching the DP algorithm itself.
const OCR_MULTI_CHAR_FOLD = [
  [/rn/g, "m"],
  [/vv/g, "w"],
  [/cl/g, "d"],
];
const ocrCanonicalize = (s) => {
  let out = s;
  for (const [re, repl] of OCR_MULTI_CHAR_FOLD) out = out.replace(re, repl);
  return out;
};
const OCR_SINGLE_CHAR_CLASS = [
  new Set(["l", "i", "1"]),
  new Set(["o", "0"]),
];
const ocrLowCost = (a, b) => OCR_SINGLE_CHAR_CLASS.some((set) => set.has(a) && set.has(b));

/**
 * Weighted Levenshtein distance: substitution cost 1 normally, 0.4 for a
 * known OCR-confusable pair, insertion/deletion cost 1. Iterative two-row
 * DP — O(len(a)*len(b)), fine at the chunk sizes this is ever called with
 * (single words to ~30-word windows, never a whole page).
 */
export const weightedEditDistance = (aRaw, bRaw) => {
  const a = ocrCanonicalize(aRaw);
  const b = ocrCanonicalize(bRaw);
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const ca = a[i - 1], cb = b[j - 1];
      if (ca === cb) {
        curr[j] = prev[j - 1];
      } else {
        const subCost = ocrLowCost(ca, cb) ? 0.4 : 1;
        curr[j] = Math.min(
          prev[j - 1] + subCost, // substitute
          prev[j] + 1, // delete from a
          curr[j - 1] + 1, // insert into a
        );
      }
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
};

/** Edit distance -> 0..1 similarity, normalized by the longer string's length. */
export const similarityFromDistance = (distance, aLen, bLen) => {
  const maxLen = Math.max(aLen, bLen, 1);
  return Math.max(0, 1 - distance / maxLen);
};

// ── Medically-critical prefix pairs (section 50) ─────────────────────────
// If the query starts with one member of a pair and the candidate starts
// with the OTHER member, treat it as a near-zero-confidence match no
// matter how close the edit distance is — "bradycardia" and "tachycardia"
// are one prefix apart and describe opposite conditions.
const CRITICAL_PREFIX_PAIRS = [
  ["brady", "tachy"],
  ["hyper", "hypo"],
  ["anti", "pro"],
  ["intra", "extra"],
  ["endo", "exo"],
];
export const hasCriticalPrefixConflict = (queryCompact, candidateCompact) => {
  for (const [a, b] of CRITICAL_PREFIX_PAIRS) {
    const qHasA = queryCompact.startsWith(a);
    const qHasB = queryCompact.startsWith(b);
    const cHasA = candidateCompact.startsWith(a);
    const cHasB = candidateCompact.startsWith(b);
    if ((qHasA && cHasB) || (qHasB && cHasA)) return true;
  }
  return false;
};

// ── Negation sensitivity (section 51) ────────────────────────────────────
// This is lexical search, not semantic search — normalization never strips
// these words, and fuzzy phrase matching treats a negation-word mismatch
// between query and candidate as a strong penalty, not a free pass.
const NEGATION_WORDS = new Set(["no", "not", "without", "denies", "negative", "absent", "never"]);
export const hasNegationConflict = (queryTokens, candidateTokens) => {
  const qNeg = queryTokens.some((t) => NEGATION_WORDS.has(t));
  const cNeg = candidateTokens.some((t) => NEGATION_WORDS.has(t));
  return qNeg !== cNeg;
};

/**
 * Normalizes a raw search query into the same representations page text
 * gets, plus word tokens — spec section 14, Stage 1.
 */
export const normalizeQuery = (query) => {
  const norm = normalizePdfText(query);
  const tokens = (norm.normalizedText.match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) || []).map((t) => t.toLowerCase());
  return {
    originalQuery: norm.originalText,
    normalizedQuery: norm.normalizedText,
    caseFoldedQuery: norm.caseFoldedText,
    compactQuery: norm.compactText.toLowerCase(),
    tokens,
  };
};

const allIndexesOf = (haystack, needle) => {
  if (!needle) return [];
  const out = [];
  let from = 0;
  for (;;) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) break;
    out.push(idx);
    from = idx + Math.max(1, needle.length);
  }
  return out;
};

/**
 * Builds a { start, end, itemIndexes, originalMatchedText,
 * normalizedMatchedText } result from an original-text range.
 * itemIndexes is every PDF.js item index behind that range, sorted
 * ascending — NOT necessarily numerically contiguous (reading-order
 * reconstruction, see pdfPageLayout.js), so callers must iterate the
 * array rather than assume a [min,max] loop covers exactly the right set.
 */
const buildResultFromOriginalRange = (pageIndex, origStart, origEnd, extra) => {
  const items = originalRangeToItemIndexes(pageIndex, origStart, origEnd);
  return {
    pageNumber: pageIndex.pageNumber,
    originalStartIndex: origStart,
    originalEndIndex: origEnd,
    originalMatchedText: pageIndex.originalText.slice(origStart, origEnd),
    itemIndexes: items?.itemIndexes ?? [],
    ...extra,
  };
};

// ── Stages 2-4: exact / case-insensitive / compact ───────────────────────
const searchExactStages = (pageIndex, q) => {
  const results = [];

  if (q.normalizedQuery) {
    for (const idx of allIndexesOf(pageIndex.normalizedText, q.normalizedQuery)) {
      const normEnd = idx + q.normalizedQuery.length;
      const origRange = normalizedRangeToOriginal(pageIndex.normalizedToOriginalMap, idx, normEnd);
      if (!origRange) continue;
      results.push(buildResultFromOriginalRange(pageIndex, origRange.start, origRange.end, {
        matchType: "exact",
        confidence: CONFIDENCE.EXACT,
        normalizedMatchedText: pageIndex.normalizedText.slice(idx, normEnd),
        normalizedStartIndex: idx,
        normalizedEndIndex: normEnd,
      }));
    }
  }
  if (results.length) return results;

  if (q.caseFoldedQuery) {
    for (const idx of allIndexesOf(pageIndex.caseFoldedText, q.caseFoldedQuery)) {
      const normEnd = idx + q.caseFoldedQuery.length;
      const origRange = normalizedRangeToOriginal(pageIndex.normalizedToOriginalMap, idx, normEnd);
      if (!origRange) continue;
      results.push(buildResultFromOriginalRange(pageIndex, origRange.start, origRange.end, {
        matchType: "case_insensitive",
        confidence: CONFIDENCE.CASE_INSENSITIVE,
        normalizedMatchedText: pageIndex.normalizedText.slice(idx, normEnd),
        normalizedStartIndex: idx,
        normalizedEndIndex: normEnd,
      }));
    }
  }
  if (results.length) return results;

  const compactLower = pageIndex.compactText.toLowerCase();
  if (q.compactQuery) {
    for (const idx of allIndexesOf(compactLower, q.compactQuery)) {
      const compactEnd = idx + q.compactQuery.length;
      const origRange = compactRangeToOriginal(pageIndex, idx, compactEnd);
      if (!origRange) continue;
      results.push(buildResultFromOriginalRange(pageIndex, origRange.start, origRange.end, {
        matchType: "compact",
        confidence: CONFIDENCE.COMPACT,
        normalizedMatchedText: pageIndex.compactText.slice(idx, compactEnd),
      }));
    }
  }
  if (results.length) return results;

  // Scientific-alias stage (section 33): "beta blocker" <-> "β-blocker".
  // Folds BOTH sides (page text AND query) the same way — the query may be
  // the plain-English spelling ("beta blocker", already unchanged by the
  // fold) while it's the PAGE text that needs folding, or vice versa if the
  // user searches "β-blocker" against plain-English page text.
  const aliasQuery = aliasFold(q.compactQuery);
  if (aliasQuery) {
    const { aliasText, segments } = buildAliasFoldMap(compactLower);
    for (const idx of allIndexesOf(aliasText, aliasQuery)) {
      const aliasEnd = idx + aliasQuery.length;
      const compactRange = mapRangeThroughSegments(segments, idx, aliasEnd, "alias", "compact");
      if (!compactRange) continue;
      const origRange = compactRangeToOriginal(pageIndex, compactRange.start, compactRange.end);
      if (!origRange) continue;
      results.push(buildResultFromOriginalRange(pageIndex, origRange.start, origRange.end, {
        matchType: "alias",
        confidence: CONFIDENCE.ALIAS,
        normalizedMatchedText: pageIndex.compactText.slice(compactRange.start, compactRange.end),
      }));
    }
  }
  return results;
};

// ── Stage 6: token-aware search ───────────────────────────────────────────
// Handles fragmentation that isn't pure whitespace (compact already covers
// that) — e.g. a stray footnote marker or bullet sitting between two real
// word-tokens. Joins consecutive tokens' own text (skipping whatever sits
// between them) and compares that against the query's compact form.
const searchTokenStage = (pageIndex, q) => {
  if (q.tokens.length < 1) return [];
  const results = [];
  const tokens = pageIndex.tokens;
  const qJoined = q.tokens.join("");
  for (let i = 0; i < tokens.length; i++) {
    let joined = "";
    let j = i;
    while (j < tokens.length && joined.length < qJoined.length) {
      joined += tokens[j].text.toLowerCase();
      j++;
    }
    if (joined !== qJoined) continue;
    const first = tokens[i], last = tokens[j - 1];
    const origRange = normalizedRangeToOriginal(pageIndex.normalizedToOriginalMap, first.normStart, last.normEnd);
    if (!origRange) continue;
    results.push(buildResultFromOriginalRange(pageIndex, origRange.start, origRange.end, {
      matchType: "token",
      confidence: CONFIDENCE.TOKEN,
      normalizedMatchedText: pageIndex.normalizedText.slice(first.normStart, last.normEnd),
      normalizedStartIndex: first.normStart,
      normalizedEndIndex: last.normEnd,
    }));
  }
  return results;
};

// ── Stage 7: fuzzy fallback ────────────────────────────────────────────────
// Sliding windows of consecutive tokens, sized around the query's own token
// count (spec section 15's 3-30 word guidance, scaled to query length) —
// never a full-page character-by-character scan. Short queries get a wide
// margin ABOVE their own token count (a single distorted word like
// "Bradi DycaR dia" can fragment into 3-4 page tokens for one query token),
// longer phrase queries taper off since phrase fragmentation rarely adds
// more than one or two extra pieces per already-multi-word query.
const windowSizesFor = (queryTokenCount) => {
  const base = Math.max(1, queryTokenCount);
  const extra = base <= 2 ? 4 : base <= 5 ? 2 : 1;
  const min = Math.max(1, base - 1);
  const max = base + extra;
  const sizes = [];
  for (let n = min; n <= max; n++) sizes.push(n);
  return sizes;
};

const searchFuzzyStage = (pageIndex, q, options) => {
  if (!q.tokens.length) return [];
  const results = [];
  const tokens = pageIndex.tokens;
  const sizes = windowSizesFor(q.tokens.length);
  const minConfidence = options.minConfidence ?? CONFIDENCE.FUZZY_FLOOR;

  for (const size of sizes) {
    for (let i = 0; i + size <= tokens.length; i++) {
      const windowTokens = tokens.slice(i, i + size);
      const candidateTokenTexts = windowTokens.map((t) => t.text.toLowerCase());
      const candidateCompact = candidateTokenTexts.join("");
      const queryCompact = q.compactQuery;

      // Cheap length pre-filter before paying for edit distance.
      if (Math.abs(candidateCompact.length - queryCompact.length) > Math.max(4, queryCompact.length * 0.5)) continue;

      if (hasCriticalPrefixConflict(queryCompact, candidateCompact)) continue;
      if (hasNegationConflict(q.tokens, candidateTokenTexts)) continue;

      const distance = weightedEditDistance(queryCompact, candidateCompact);
      const confidence = similarityFromDistance(distance, queryCompact.length, candidateCompact.length);
      if (confidence < minConfidence) continue;

      const first = windowTokens[0], last = windowTokens[windowTokens.length - 1];
      const origRange = normalizedRangeToOriginal(pageIndex.normalizedToOriginalMap, first.normStart, last.normEnd);
      if (!origRange) continue;
      results.push(buildResultFromOriginalRange(pageIndex, origRange.start, origRange.end, {
        matchType: "fuzzy",
        confidence,
        normalizedMatchedText: pageIndex.normalizedText.slice(first.normStart, last.normEnd),
        normalizedStartIndex: first.normStart,
        normalizedEndIndex: last.normEnd,
      }));
    }
  }
  return results;
};

/** Drops lower-confidence results whose original range overlaps a higher-confidence one (section 46). */
const dedupeOverlapping = (results) => {
  const sorted = [...results].sort((a, b) => b.confidence - a.confidence);
  const kept = [];
  for (const r of sorted) {
    const overlaps = kept.some((k) =>
      r.originalStartIndex < k.originalEndIndex && r.originalEndIndex > k.originalStartIndex);
    if (!overlaps) kept.push(r);
  }
  return kept.sort((a, b) => a.originalStartIndex - b.originalStartIndex);
};

/**
 * Runs the full stage pipeline against ONE page's index. `queryRepr` is the
 * output of normalizeQuery(). Returns results sorted by position, already
 * deduplicated/overlap-resolved and confidence-annotated. Exact/case/
 * compact/token stages always run (they're cheap); fuzzy only runs when
 * `options.fuzzy !== false` AND nothing at least COMPACT-confidence was
 * already found on this page (section 14: safest method first, fuzzy is a
 * fallback, not a parallel always-on pass) unless options.alwaysFuzzy.
 */
export const searchPageForQuery = (pageIndex, queryRepr, options = {}) => {
  if (!queryRepr.normalizedQuery.trim()) return [];
  let results = searchExactStages(pageIndex, queryRepr);
  if (!results.length) results = results.concat(searchTokenStage(pageIndex, queryRepr));
  const shouldTryFuzzy = options.fuzzy !== false && (options.alwaysFuzzy || !results.length);
  if (shouldTryFuzzy) results = results.concat(searchFuzzyStage(pageIndex, queryRepr, options));
  return dedupeOverlapping(results);
};

/**
 * Convenience top-level API matching spec section 44:
 *   searchPdfText(query, { pageCount, getPageIndex, fuzzy, maxResults, minConfidence })
 * `getPageIndex(pageNumber)` may be sync or async and must return a page
 * index shaped like pdfSearchIndex.js's buildPageIndex() output.
 * Exists mainly for tests and standalone use — PDFPage.jsx's live search
 * calls searchPageForQuery per page directly so it can keep its existing
 * cancellation/streaming behavior (see the integration notes there).
 */
export const searchPdfText = async (query, options) => {
  const { pageCount, getPageIndex, maxResults = 50 } = options;
  const queryRepr = normalizeQuery(query);
  const allResults = [];
  for (let n = 1; n <= pageCount; n++) {
    const pageIndex = await getPageIndex(n);
    if (!pageIndex) continue;
    const pageResults = searchPageForQuery(pageIndex, queryRepr, options);
    allResults.push(...pageResults);
    if (allResults.length >= maxResults) break;
  }
  return allResults
    .sort((a, b) => (b.confidence - a.confidence) || (a.pageNumber - b.pageNumber))
    .slice(0, maxResults);
};
