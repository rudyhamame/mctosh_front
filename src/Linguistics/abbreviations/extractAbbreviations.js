const EXCLUDED_UPPERCASE = new Set([
  "A", "AN", "AND", "CHAPTER", "CONCLUSION", "FIG", "FIGURE", "INTRODUCTION",
  "OR", "SECTION", "TABLE", "THE",
]);

const UNIT_FORMS = new Set([
  "BPM", "CM", "G", "KG", "L", "MG", "ML", "MM", "MMHG", "MS", "SEC",
]);

const SHORT_FORM_PATTERN = /^(?:[A-Z]{2,8}|[A-Z][A-Za-z]*\d+[A-Za-z\d]*|[A-Z]\/[A-Z]|[A-Z][A-Za-z]{0,3}-[A-Za-z\d]{2,8}|[A-Z]{2,6}[a-z]{1,4}[A-Z]{0,4})$/;
const TOKEN_PATTERN = /\b[A-Za-z][A-Za-z\d]*(?:\/[A-Za-z\d]+|-[A-Za-z\d]+)?\b/g;

export const normalizeAbbreviation = (value) => String(value || "").trim().toUpperCase();

export const isAbbreviationCandidate = (value) => {
  const surface = String(value || "").trim().replace(/^[([{]+|[\])},;:.]+$/g, "");
  const normalized = normalizeAbbreviation(surface);
  if (!surface || EXCLUDED_UPPERCASE.has(normalized) || UNIT_FORMS.has(normalized)) return false;
  return SHORT_FORM_PATTERN.test(surface);
};

const abbreviationCategory = (surface) => {
  if (surface.includes("/")) return "slash_form";
  if (surface.includes("-")) return "hyphenated_short_form";
  if (/\d/.test(surface)) return "alphanumeric";
  if (/^[A-Z]+$/.test(surface)) return "uppercase";
  return "mixed_case_medical";
};

const normalizedLetters = (value) => String(value || "").replace(/[^A-Za-z\d]/g, "").toLowerCase();

// Schwartz-Hearst-style backward alignment. The first short-form character
// must land at a word boundary, preventing arbitrary parenthetical notes from
// becoming definitions.
export const alignShortFormToLongForm = (shortForm, longForm) => {
  const short = normalizedLetters(shortForm);
  const long = String(longForm || "").trim();
  if (short.length < 2 || !long) return false;
  let shortIndex = short.length - 1;
  let longIndex = long.length - 1;
  while (shortIndex >= 0) {
    const wanted = short[shortIndex];
    while (longIndex >= 0) {
      const matchesCharacter = long[longIndex].toLowerCase() === wanted;
      const matchesRequiredBoundary = shortIndex !== 0
        || longIndex === 0
        || !/[A-Za-z\d]/.test(long[longIndex - 1]);
      if (matchesCharacter && matchesRequiredBoundary) break;
      longIndex -= 1;
    }
    if (longIndex < 0) return false;
    shortIndex -= 1;
    longIndex -= 1;
  }
  const wordCount = long.split(/\s+/).filter(Boolean).length;
  return wordCount <= Math.min(short.length + 5, short.length * 2);
};

const boundedLongForm = (value, shortForm) => {
  const words = String(value || "").trim().split(/\s+/).filter(Boolean);
  const shortLength = normalizedLetters(shortForm).length;
  const maxWords = Math.min(shortLength + 5, shortLength * 2);
  const boundedWords = words.slice(-maxWords);
  for (let start = boundedWords.length - 1; start >= 0; start -= 1) {
    const candidate = boundedWords.slice(start).join(" ").replace(/^[^A-Za-z\d]+/, "");
    if (alignShortFormToLongForm(shortForm, candidate)) return candidate;
  }
  return boundedWords.join(" ").replace(/^[^A-Za-z\d]+/, "");
};

const reconstructText = (items) => (Array.isArray(items) ? items : [])
  .map((item) => ({ value: String(item?.str || ""), eol: Boolean(item?.hasEOL) }))
  .reduce((text, item) => {
    if (!item.value) return text;
    const separator = !text || /\s$/.test(text) || /^\s/.test(item.value) ? "" : " ";
    return `${text}${separator}${item.value}${item.eol ? "\n" : ""}`;
  }, "")
  .replace(/[ \t]+\n/g, "\n");

export const extractAbbreviations = (items, { pageNumber = 1 } = {}) => {
  const text = reconstructText(items);
  const definitions = new Map();
  const addDefinition = (shortForm, longForm, definitionType, sourceText) => {
    const surface = String(shortForm || "").trim();
    const candidateLongForm = String(longForm || "").trim();
    if (!isAbbreviationCandidate(surface) || !alignShortFormToLongForm(surface, candidateLongForm)) return;
    const key = normalizeAbbreviation(surface);
    definitions.set(key, {
      shortForm: surface,
      normalized: key,
      longForm: candidateLongForm,
      status: "confirmed",
      definitionType,
      definitionSource: `Page ${pageNumber}`,
      sourceText: String(sourceText || "").trim(),
    });
  };

  const forwardPattern = /([^\n.!?;:()]{2,120}?)\s*\(([A-Za-z][A-Za-z\d/-]{1,11})\)/g;
  for (const match of text.matchAll(forwardPattern)) {
    const longForm = boundedLongForm(match[1], match[2]);
    addDefinition(match[2], longForm, "long_form_then_short_form", match[0]);
  }
  const reversePattern = /\b([A-Za-z][A-Za-z\d/-]{1,11})\s*\(([^\n.!?;:()]{2,120})\)/g;
  for (const match of text.matchAll(reversePattern)) {
    addDefinition(match[1], match[2], "short_form_then_long_form", match[0]);
  }

  const occurrences = new Map();
  for (const match of text.matchAll(TOKEN_PATTERN)) {
    if (!isAbbreviationCandidate(match[0])) continue;
    const key = normalizeAbbreviation(match[0]);
    const list = occurrences.get(key) || [];
    list.push({ surface: match[0], start: match.index, end: match.index + match[0].length });
    occurrences.set(key, list);
  }

  return [...occurrences.entries()].map(([normalized, found]) => {
    const definition = definitions.get(normalized);
    return {
      id: `abbr-${pageNumber}-${normalized.replace(/[^A-Z0-9]+/g, "-")}`,
      shortForm: definition?.shortForm || found[0].surface,
      normalized,
      category: abbreviationCategory(found[0].surface),
      longForm: definition?.longForm || "",
      status: definition ? "confirmed" : found.length > 1 ? "candidate" : "unresolved",
      definitionType: definition?.definitionType || null,
      definitionSource: definition?.definitionSource || null,
      sourceText: definition?.sourceText || null,
      occurrences: found,
      occurrenceCount: found.length,
      firstPage: pageNumber,
      scope: "page",
    };
  }).sort((left, right) => {
    const statusOrder = { confirmed: 0, candidate: 1, unresolved: 2 };
    return statusOrder[left.status] - statusOrder[right.status]
      || left.shortForm.localeCompare(right.shortForm);
  });
};

const normalizeLongForm = (value) => String(value || "")
  .trim()
  .replace(/\s+/g, " ")
  .toLowerCase();

const pageListLabel = (pageNumbers) => {
  const pages = [...pageNumbers].sort((left, right) => left - right);
  if (!pages.length) return null;
  return `${pages.length === 1 ? "Page" : "Pages"} ${pages.join(", ")}`;
};

// Build one document-wide evidence index from the page-local deterministic
// extraction. Explicit definitions found on any page resolve that short form
// everywhere in the document. Conflicting explicit expansions are retained as
// alternatives and never promoted to confirmed automatically.
export const extractDocumentAbbreviations = (pages = []) => {
  const groups = new Map();

  [...pages]
    .sort((left, right) => Number(left?.pageNumber) - Number(right?.pageNumber))
    .forEach(({ pageNumber, items }) => {
      const safePageNumber = Math.max(1, Number(pageNumber) || 1);
      extractAbbreviations(items, { pageNumber: safePageNumber }).forEach((entry) => {
        const group = groups.get(entry.normalized) || {
          normalized: entry.normalized,
          surfaces: [],
          occurrences: [],
          pageNumbers: new Set(),
          expansions: new Map(),
        };
        group.surfaces.push(entry.shortForm);
        group.pageNumbers.add(safePageNumber);
        group.occurrences.push(...entry.occurrences.map((occurrence) => ({
          ...occurrence,
          pageNumber: safePageNumber,
        })));

        if (entry.status === "confirmed" && entry.longForm) {
          const expansionKey = normalizeLongForm(entry.longForm);
          const expansion = group.expansions.get(expansionKey) || {
            longForm: entry.longForm,
            sources: new Set(),
            sourceTexts: [],
            definitionTypes: new Set(),
          };
          expansion.sources.add(safePageNumber);
          if (entry.sourceText) expansion.sourceTexts.push(entry.sourceText);
          if (entry.definitionType) expansion.definitionTypes.add(entry.definitionType);
          group.expansions.set(expansionKey, expansion);
        }
        groups.set(entry.normalized, group);
      });
    });

  return [...groups.values()].map((group) => {
    const alternatives = [...group.expansions.values()]
      .map((expansion) => ({
        longForm: expansion.longForm,
        pages: [...expansion.sources].sort((left, right) => left - right),
        confirmationCount: expansion.sources.size,
        sourceText: expansion.sourceTexts[0] || null,
        definitionTypes: [...expansion.definitionTypes],
      }))
      .sort((left, right) => right.confirmationCount - left.confirmationCount
        || left.longForm.localeCompare(right.longForm));
    const resolved = alternatives.length === 1 ? alternatives[0] : null;
    const pageNumbers = [...group.pageNumbers].sort((left, right) => left - right);
    const shortForm = group.surfaces[0] || group.normalized;
    const status = resolved
      ? "confirmed"
      : alternatives.length > 1 || group.occurrences.length > 1
        ? "candidate"
        : "unresolved";

    return {
      id: `abbr-document-${group.normalized.replace(/[^A-Z0-9]+/g, "-")}`,
      shortForm,
      normalized: group.normalized,
      category: abbreviationCategory(shortForm),
      longForm: resolved?.longForm || "",
      status,
      definitionType: resolved ? "document_context" : alternatives.length > 1 ? "conflicting_document_context" : null,
      definitionSource: resolved ? pageListLabel(resolved.pages) : null,
      definitionSources: resolved?.pages || [],
      sourceText: resolved?.sourceText || null,
      occurrences: group.occurrences,
      occurrenceCount: group.occurrences.length,
      confirmationCount: resolved?.confirmationCount || 0,
      firstPage: pageNumbers[0],
      pageNumbers,
      pageCount: pageNumbers.length,
      alternatives,
      resolvedFromContext: Boolean(resolved && pageNumbers.some((page) => !resolved.pages.includes(page))),
      scope: "document",
    };
  }).sort((left, right) => {
    const statusOrder = { confirmed: 0, candidate: 1, unresolved: 2 };
    return statusOrder[left.status] - statusOrder[right.status]
      || left.shortForm.localeCompare(right.shortForm);
  });
};
