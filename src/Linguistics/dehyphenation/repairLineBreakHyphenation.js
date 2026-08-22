import { defaultLexicalResources, normalizeLexicalWord } from "../dictionaries/protectedHyphenatedTerms";

const LINE_BREAK_HYPHEN_PATTERN = /([\p{L}]+)-[ \t]*\r?\n[ \t]*([\p{L}]+(?:-[\p{L}]+)*)/gu;
const SOFT_HYPHEN = /\u00ad/gu;

// Keep this separate from dehyphenation: a line can be repaired without
// losing the ordered Hyle line stack, then those repaired lines are glued
// into the paragraph consumed by the next linguistic stage.
export const glueParagraphLines = (text) => String(text || "")
  .replace(/\s*\r?\n\s*/gu, " ")
  .replace(/[ \t]+/gu, " ")
  .trim();

const known = (resources, name, value) => typeof resources?.[name] === "function" && resources[name](value);

const decideCandidate = (left, right, resources) => {
  const joined = `${left}${right}`;
  const hyphenated = `${left}-${right}`;
  const joinedKnown = known(resources, "isKnownWord", joined)
    || known(resources, "isKnownMedicalWord", joined)
    || known(resources, "isKnownDocumentWord", joined);
  const hyphenatedKnown = known(resources, "isKnownHyphenatedWord", hyphenated);
  if (hyphenatedKnown && !joinedKnown) return { replacement: hyphenated, status: "resolved", decision: "preserve_hyphen", ruleId: "KNOWN_HYPHENATED_WORD", resolutionSource: "protected_compound" };
  if (joinedKnown && !hyphenatedKnown) return { replacement: joined, status: "resolved", decision: "remove_hyphen", ruleId: "KNOWN_JOINED_WORD", resolutionSource: "dictionary" };
  if (joinedKnown && hyphenatedKnown) return { replacement: null, status: "ambiguous", decision: "preserve_source", ruleId: "BOTH_CANDIDATES_KNOWN", resolutionSource: "none" };
  return { replacement: null, status: "unresolved", decision: "preserve_source", ruleId: "NO_KNOWN_CANDIDATE", resolutionSource: "none" };
};

export function repairLineBreakHyphenation(text, lexicalResources = defaultLexicalResources, options = {}) {
  if (typeof text !== "string") return { originalText: "", normalizedText: "", status: "not_applicable", transformations: [], ambiguousCandidates: [], unresolvedCandidates: [] };
  if (!text) return { originalText: text, normalizedText: text, status: "not_applicable", transformations: [], ambiguousCandidates: [], unresolvedCandidates: [] };
  const resources = { ...defaultLexicalResources, ...lexicalResources };
  const transformations = [];
  const ambiguousCandidates = [];
  const unresolvedCandidates = [];
  let normalizedText = text.replace(SOFT_HYPHEN, "");
  const softHyphensRemoved = text.length - normalizedText.length;
  let offset = 0;
  normalizedText = normalizedText.replace(LINE_BREAK_HYPHEN_PATTERN, (original, left, right, matchOffset) => {
    const decision = decideCandidate(left, right, resources);
    const outputText = decision.replacement || original;
    const outputStart = matchOffset + offset;
    const record = {
      id: `dehyphenation-${transformations.length + 1}`,
      type: "line_break_dehyphenation",
      originalText: original,
      leftPart: left,
      rightPart: right,
      candidateWithoutHyphen: `${left}${right}`,
      candidateWithHyphen: `${left}-${right}`,
      replacement: decision.replacement,
      outputText,
      start: outputStart,
      end: outputStart + outputText.length,
      status: decision.status,
      decision: decision.decision,
      ruleId: decision.ruleId,
      resolutionSource: decision.resolutionSource,
    };
    transformations.push(record);
    if (decision.status === "ambiguous") ambiguousCandidates.push(record);
    if (decision.status === "unresolved") unresolvedCandidates.push(record);
    if (!decision.replacement) return original;
    offset += decision.replacement.length - original.length;
    return decision.replacement;
  });
  const status = transformations.some((item) => item.status === "ambiguous" || item.status === "unresolved")
    ? "completed_with_warnings" : transformations.length || softHyphensRemoved ? "completed" : "not_applicable";
  return {
    originalText: text,
    normalizedText,
    status,
    transformations,
    ambiguousCandidates,
    unresolvedCandidates,
    softHyphensRemoved,
    method: options.method || "deterministic_dictionary_validated_dehyphenation",
  };
}
