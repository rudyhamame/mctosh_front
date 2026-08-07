import sbd from "sbd";

/**
 * Split a paragraph into complete sentence units.
 *
 * This is sentence-boundary detection only. It does not interpret the text
 * or run predicate, relation, or grammatical analysis.
 */
export function splitParagraphIntoSentences(paragraph) {
  if (typeof paragraph !== "string") return [];

  const normalizedParagraph = paragraph
    .replace(/\r\n/gu, "\n")
    .replace(/\r/gu, "\n")
    .replace(/[ \t]+/gu, " ")
    .trim();

  if (!normalizedParagraph) return [];

  return sbd
    .sentences(normalizedParagraph, {
      newline_boundaries: false,
      sanitize: false,
      preserve_whitespace: false,
    })
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

