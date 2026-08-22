const LEVELS = ["sentence", "clause", "phrase", "word", "morpheme"];

const idOf = (node) => String(node?.entityId || "");
const spanOf = (node) => node?.payload?.canonicalSpan || null;
const validSpan = (span) => Number.isInteger(Number(span?.start))
  && Number.isInteger(Number(span?.end))
  && Number(span.end) > Number(span.start);
const overlaps = (left, right) => validSpan(left) && validSpan(right)
  && Number(left.start) < Number(right.end)
  && Number(right.start) < Number(left.end);
const ordered = (nodes) => [...nodes].sort((left, right) =>
  (Number(spanOf(left)?.start) || 0) - (Number(spanOf(right)?.start) || 0)
  || (Number(left.displayIndex) || 0) - (Number(right.displayIndex) || 0)
  || idOf(left).localeCompare(idOf(right)));

const boundingSpan = (spans) => {
  const usable = spans.filter(validSpan);
  if (!usable.length) return null;
  return {
    start: Math.min(...usable.map((span) => Number(span.start))),
    end: Math.max(...usable.map((span) => Number(span.end))),
  };
};

const syntheticNode = ({ type, parent, span, suffix, displayIndex = 0 }) => ({
  entityId: `derived-${type}-${idOf(parent)}-${suffix}`,
  entityType: type,
  parentEntityId: idOf(parent),
  displayIndex,
  pageIndexes: parent?.pageIndexes || [],
  payload: {
    canonicalSpan: span,
    structuralPlaceholder: true,
    typeLabel: type === "morpheme" ? "unresolved" : "structural",
  },
});

/**
 * Produce the one hierarchy the Sentential Meaning view promises:
 * PhysicalBlock -> sentence -> clause -> phrase -> word -> morpheme -> character.
 *
 * Stored linguistic nodes remain authoritative. Missing structural levels are
 * represented by clearly marked placeholders; they are not presented as an
 * inferred grammatical analysis. Character leaves are materialized from the
 * canonical stream instead of storing millions of character documents in DB.
 */
export const buildStrictPhysicalBlockHierarchy = ({ block, nodes = [], canonicalCharacters = [] }) => {
  const byType = new Map(LEVELS.map((type) => [type, ordered(nodes.filter((node) => node.entityType === type))]));
  const claimed = new Map(LEVELS.map((type) => [type, new Set()]));
  const output = [];
  const blockSpans = Array.isArray(block?.canonicalSpans) && block.canonicalSpans.length
    ? block.canonicalSpans
    : block?.canonicalSpan ? [block.canonicalSpan] : [];
  const blockSpan = boundingSpan(blockSpans);

  const candidatesFor = (type, parent, lineage) => {
    const available = byType.get(type) || [];
    const used = claimed.get(type);
    const exact = available.filter((node) => !used.has(idOf(node)) && String(node.parentEntityId || "") === idOf(parent));
    if (exact.length) return exact;
    const lineageIds = new Set(lineage.map(idOf));
    const parentSpan = spanOf(parent);
    return available.filter((node) => {
      if (used.has(idOf(node))) return false;
      const storedParent = String(node.parentEntityId || "");
      return lineageIds.has(storedParent) || overlaps(parentSpan, spanOf(node));
    });
  };

  const appendCharacters = (morpheme) => {
    const span = spanOf(morpheme);
    if (!validSpan(span)) return;
    const start = Math.max(0, Number(span.start));
    const end = Math.min(canonicalCharacters.length, Number(span.end));
    for (let canonicalIndex = start; canonicalIndex < end; canonicalIndex += 1) {
      const value = canonicalCharacters[canonicalIndex] ?? "";
      output.push({
        entityId: `derived-character-${idOf(morpheme)}-${canonicalIndex}`,
        entityType: "character",
        parentEntityId: idOf(morpheme),
        displayIndex: canonicalIndex - start,
        pageIndexes: morpheme.pageIndexes || [],
        payload: {
          value,
          codePoint: value ? `U+${value.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}` : "",
          canonicalSpan: { start: canonicalIndex, end: canonicalIndex + 1 },
          materializedFromCanonicalText: true,
        },
      });
    }
  };

  const appendLevel = (parent, levelIndex, lineage) => {
    if (levelIndex >= LEVELS.length) {
      appendCharacters(parent);
      return;
    }
    const type = LEVELS[levelIndex];
    let children = candidatesFor(type, parent, lineage);
    if (!children.length) {
      const span = spanOf(parent) || blockSpan;
      if (!validSpan(span)) return;
      children = [syntheticNode({ type, parent, span, suffix: levelIndex })];
    }
    children.forEach((child, index) => {
      if (!child.payload?.structuralPlaceholder) claimed.get(type).add(idOf(child));
      const normalized = { ...child, parentEntityId: idOf(parent), displayIndex: Number(child.displayIndex) || index };
      output.push(normalized);
      appendLevel(normalized, levelIndex + 1, [...lineage, normalized]);
    });
  };

  let sentences = (byType.get("sentence") || []).filter((node) => !blockSpan || overlaps(blockSpan, spanOf(node)));
  if (!sentences.length && validSpan(blockSpan)) {
    const physicalRoot = { entityId: String(block?.id || block?.entityId || "physical-block"), pageIndexes: block?.pageIndexes || [], payload: { canonicalSpan: blockSpan } };
    sentences = [syntheticNode({ type: "sentence", parent: physicalRoot, span: blockSpan, suffix: "block" })];
  }
  sentences.forEach((sentence, index) => {
    claimed.get("sentence").add(idOf(sentence));
    const normalized = { ...sentence, parentEntityId: String(block?.id || block?.entityId || ""), displayIndex: Number(sentence.displayIndex) || index };
    output.push(normalized);
    appendLevel(normalized, 1, [normalized]);
  });
  return output;
};

