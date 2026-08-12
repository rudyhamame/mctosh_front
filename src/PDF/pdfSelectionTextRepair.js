const compactText = (value) => String(value || "").normalize("NFC").replace(/\s/gu, "");
const comparableText = (value) => compactText(value).toLocaleLowerCase();

const finiteBox = (value) => {
  if (!Array.isArray(value) || value.length < 4) return null;
  const box = value.slice(0, 4).map(Number);
  return box.every(Number.isFinite) && box[2] > box[0] && box[3] > box[1] ? box : null;
};

const tokenBox = (token) => finiteBox([
  token?.pageLeft,
  token?.pageTop,
  token?.pageRight,
  token?.pageBottom,
]);

const verticalCoverage = (left, right) => {
  const overlap = Math.max(0, Math.min(left[3], right[3]) - Math.max(left[1], right[1]));
  return overlap / Math.max(1, Math.min(left[3] - left[1], right[3] - right[1]));
};

const horizontallyRelated = (left, right) => {
  const overlap = Math.max(0, Math.min(left[2], right[2]) - Math.max(left[0], right[0]));
  if (overlap > 0) return true;
  const height = Math.max(1, Math.min(left[3] - left[1], right[3] - right[1]));
  const pad = height * 0.35;
  const center = (left[0] + left[2]) / 2;
  return center >= right[0] - pad && center <= right[2] + pad;
};

/**
 * Builds selection-only text repairs while retaining PDF.js token indexes
 * and geometry. A PyMuPDF word is accepted only when one contiguous PDF.js
 * token interval occupies the word box and both strings become identical
 * after whitespace removal. Consequently this can remove synthetic tracking
 * spaces but cannot substitute OCR text, reorder content, or change letters.
 */
export const buildPdfSelectionTextRepairs = (tokens, nativeWords) => {
  const sourceTokens = Array.isArray(tokens) ? tokens : [];
  const words = Array.isArray(nativeWords) ? nativeWords : [];
  const repairs = new Map();
  const claimed = new Set();

  words.forEach((word, wordIndex) => {
    const wordText = String(word?.text || "");
    const wordCompact = compactText(wordText);
    const wordComparable = comparableText(wordText);
    const wordBBox = finiteBox(word?.bbox);
    if (!wordBBox || wordCompact.length < 2) return;

    const hits = sourceTokens
      .map((token, index) => ({ token, index, bbox: tokenBox(token) }))
      .filter(({ token, bbox }) => (
        bbox
        && compactText(token?.text)
        && verticalCoverage(bbox, wordBBox) >= 0.42
        && horizontallyRelated(bbox, wordBBox)
      ));
    if (!hits.length) return;

    const first = Math.min(...hits.map(({ index }) => index));
    const last = Math.max(...hits.map(({ index }) => index));
    if (last - first > 64) return;
    const interval = sourceTokens.slice(first, last + 1);
    if (interval.some((_, offset) => claimed.has(first + offset))) return;

    const sourceComparable = comparableText(interval.map((token) => token?.text || "").join(""));
    if (!sourceComparable || sourceComparable !== wordComparable) return;

    const sourceCompactChars = Array.from(compactText(interval.map((token) => token?.text || "").join("")));
    const repairedChars = Array.from(wordCompact);
    if (sourceCompactChars.length !== repairedChars.length) return;

    const groupId = `pymupdf-word:${word?.id || wordIndex}`;
    let cursor = 0;
    interval.forEach((token, offset) => {
      const characterCount = Array.from(compactText(token?.text)).length;
      const selectionText = repairedChars.slice(cursor, cursor + characterCount).join("");
      cursor += characterCount;
      const index = first + offset;
      repairs.set(index, {
        selectionText,
        groupId,
        groupText: wordText,
        firstIndex: first,
        lastIndex: last,
      });
      claimed.add(index);
    });
  });

  return repairs;
};

