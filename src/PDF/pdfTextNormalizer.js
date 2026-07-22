// pdfTextNormalizer.js
//
// Deterministic, mapping-preserving text normalization for PDF-extracted
// text. Turns one `originalText` string into several parallel, purely
// *additional* representations used for tolerant search:
//
//   originalText     — untouched, exactly what PDF.js returned
//   normalizedText   — Unicode/ligature/punctuation-folded, whitespace
//                       collapsed to single spaces, nothing removed that
//                       could change meaning (hyphens, digits, +/- kept)
//   caseFoldedText   — normalizedText.toLowerCase() (index-compatible with
//                       normalizedText — see caveat below)
//   compactText      — normalizedText with whitespace AND soft line-break
//                       hyphens removed, for spacing/fragmentation-tolerant
//                       matching ("myoc ardial infar ction" -> "myocardialinfarction")
//
// plus index maps (normalizedToOriginalMap, compactToNormalizedMap) so any
// match found in a derived representation can be resolved back to an exact
// range in originalText. See pdfTextMapping.js for the range-resolution
// helpers that consume these maps, and pdfSearchIndex.js for how this is
// applied per PDF page (including PDF.js text-item positioning).
//
// This module NEVER guesses at meaning or rewrites terminology — that is
// pdfTextCorrection.js's job, and it only runs when explicitly requested.
// Everything here is a reversible, conservative folding of characters that
// are typographically/visually equivalent (ligatures, curly quotes, NFKC
// compatibility forms like superscript digits), not a spell-checker.

// Per-character NFKC covers most of what we need in one mechanism: Unicode
// ligatures (fi-ligature -> "fi", ff-ligature -> "ff", ...) and compatibility
// forms (superscript "2" -> "2", fullwidth forms, etc.) all have
// compatibility decompositions, so running NFKC character-by-character (not
// on the whole string at once, which would lose the ability to map each
// output slice back to the single input character that produced it) gets us
// both for free. A tiny explicit map is kept only as a defensive fallback
// for the couple of ligatures whose NFKC decomposition is inconsistent
// across older ICU/engine versions.
const LIGATURE_FALLBACK = {
  "ﬀ": "ff", // ﬀ
  "ﬁ": "fi", // ﬁ
  "ﬂ": "fl", // ﬂ
  "ﬃ": "ffi", // ﬃ
  "ﬄ": "ffl", // ﬄ
  "ﬅ": "st", // ﬅ (long s + t)
  "ﬆ": "st", // ﬆ
};

// U+200B ZWSP, U+200C ZWNJ, U+200D ZWJ, U+FEFF BOM/ZWNBSP, U+00AD soft
// hyphen — invisible, carry no searchable content. Built from numeric code
// points (not the literal glyphs pasted into source) so the file itself
// never embeds invisible characters — those are hard to see, hard to diff,
// and easy to corrupt via copy/paste or editor auto-formatting.
const ZERO_WIDTH_CODEPOINTS = [0x200b, 0x200c, 0x200d, 0xfeff, 0x00ad];
const ZERO_WIDTH_RE = new RegExp(`[${ZERO_WIDTH_CODEPOINTS.map((cp) => String.fromCharCode(cp)).join("")}]`);

// Punctuation variants folded for SEARCH only — never anything that could
// change a medical/scientific reading (digits, +, -, /, chemical notation
// are all left completely alone here).
const PUNCT_FOLD = {
  "‘": "'", "’": "'", "‚": "'", "‛": "'", // ' ' ‚ ‛
  "“": '"', "”": '"', "„": '"', "‟": '"', // " " „ ‟
  "–": "-", "—": "-", "−": "-", // – — − (en/em dash, minus sign -> hyphen)
  "…": "...", // …
};

const isLowerCaseLetter = (ch) => !!ch && ch !== ch.toUpperCase() && ch === ch.toLowerCase();

/**
 * Per-character conservative fold: NFKC + ligature fallback + punctuation
 * fold. Returns the folded string for ONE input character (may be "", one
 * char, or several — e.g. the fi-ligature -> "fi"). Zero-width characters
 * are handled by the caller before this is reached.
 */
const foldChar = (ch) => {
  const nfkc = ch.normalize("NFKC");
  const folded = LIGATURE_FALLBACK[ch] || nfkc;
  let out = "";
  for (const c of folded) out += PUNCT_FOLD[c] || c;
  return out;
};

/**
 * Builds normalizedText + normalizedToOriginalMap from originalText.
 *
 * normalizedToOriginalMap is an array of non-overlapping, normStart-sorted
 * segments: { normStart, normEnd, origStart, origEnd }. A segment can
 * represent a one-to-many (ligature), many-to-one (whitespace run), or
 * one-to-one (plain char) transformation — callers resolve a normalized
 * index/range by locating the covering segment(s), see pdfTextMapping.js.
 *
 * Also returns lineBreakSpaceAt: a Set of normalizedText indices whose
 * (single, collapsed) space character came from a real "\n"/"\r\n" in
 * originalText — used by buildCompactText to recognize genuine line-break
 * hyphenation ("cardio-\nvascular") vs an ordinary inline hyphen ("well-
 * controlled") that just happens to be followed by whitespace.
 */
export const buildNormalizedText = (originalText) => {
  const src = String(originalText || "");
  let normalizedText = "";
  const segments = [];
  const lineBreakSpaceAt = new Set();

  let i = 0;
  while (i < src.length) {
    const ch = src[i];

    // Zero-width / invisible chars first — must not be treated as
    // whitespace (that would turn an invisible BOM into a visible space).
    if (ZERO_WIDTH_RE.test(ch)) {
      i++;
      continue; // consumed, contributes nothing to normalizedText
    }

    // Whitespace run (including real newlines) -> exactly one space.
    if (/\s/.test(ch)) {
      const start = i;
      let sawNewline = false;
      while (i < src.length && /\s/.test(src[i]) && !ZERO_WIDTH_RE.test(src[i])) {
        if (src[i] === "\n" || src[i] === "\r") sawNewline = true;
        i++;
      }
      const normStart = normalizedText.length;
      normalizedText += " ";
      if (sawNewline) lineBreakSpaceAt.add(normStart);
      segments.push({ normStart, normEnd: normStart + 1, origStart: start, origEnd: i });
      continue;
    }

    const out = foldChar(ch);
    if (out) {
      const normStart = normalizedText.length;
      normalizedText += out;
      segments.push({ normStart, normEnd: normStart + out.length, origStart: i, origEnd: i + 1 });
    }
    i++;
  }

  return { normalizedText, normalizedToOriginalMap: segments, lineBreakSpaceAt };
};

/**
 * caseFoldedText is index-compatible with normalizedText for every input
 * this app will realistically see (medical/scientific PDF text). The one
 * documented exception is `.toLowerCase()` expanding certain rare Unicode
 * characters (e.g. Turkish dotted capital I-with-dot) into two code units —
 * treated as an accepted limitation rather than building a full case-index
 * map for an input class (Turkish text) this app doesn't handle.
 */
export const buildCaseFoldedText = (normalizedText) => normalizedText.toLowerCase();

/**
 * Builds compactText + compactToNormalizedMap from normalizedText: strips
 * every space, AND strips a hyphen immediately before a line-break space
 * when the next character is a lowercase letter (the strong signal from
 * section 9 — "cardio-\nvascular" collapses to "cardiovascular" here, but
 * "COVID-\n19" and "IL-\n6" don't, because the continuation isn't a
 * lowercase letter, and "well-controlled" isn't touched at all unless it
 * genuinely sits at a PDF line break).
 *
 * This never mutates normalizedText itself — a dehyphenated reading only
 * ever exists in compactText, so normal inline hyphens ("well-controlled",
 * "beta-blocker") are always still present, verbatim, in normalizedText/
 * originalText and in compactText when they're NOT at a real line break.
 */
export const buildCompactText = (normalizedText, lineBreakSpaceAt) => {
  let compactText = "";
  const segments = []; // { compactStart, compactEnd, normStart, normEnd }

  for (let i = 0; i < normalizedText.length; i++) {
    const ch = normalizedText[i];

    if (ch === " ") {
      // Soft-hyphen-at-linebreak: previous emitted char was "-", and this
      // space is a real line break, and the next char continues lowercase.
      const prevWasHyphen = compactText.endsWith("-");
      const isLineBreak = lineBreakSpaceAt?.has(i);
      const next = normalizedText[i + 1];
      if (prevWasHyphen && isLineBreak && isLowerCaseLetter(next)) {
        // Drop the hyphen we already emitted along with this space.
        compactText = compactText.slice(0, -1);
        const last = segments[segments.length - 1];
        if (last && last.compactEnd === compactText.length + 1) last.compactEnd = compactText.length;
      }
      continue; // spaces are never emitted into compactText
    }

    const compactStart = compactText.length;
    compactText += ch;
    segments.push({ compactStart, compactEnd: compactStart + 1, normStart: i, normEnd: i + 1 });
  }

  return { compactText, compactToNormalizedMap: segments };
};

/**
 * Full pipeline for one input string (a PDF page's joined text, a search
 * query, a selection's text — anything). Pure/deterministic/side-effect
 * free so callers can cache the result freely.
 */
export const normalizePdfText = (originalText) => {
  const { normalizedText, normalizedToOriginalMap, lineBreakSpaceAt } = buildNormalizedText(originalText);
  const caseFoldedText = buildCaseFoldedText(normalizedText);
  const { compactText, compactToNormalizedMap } = buildCompactText(normalizedText, lineBreakSpaceAt);
  return {
    originalText: String(originalText || ""),
    normalizedText,
    caseFoldedText,
    compactText,
    normalizedToOriginalMap,
    compactToNormalizedMap,
  };
};
