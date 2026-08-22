import { describe, expect, it } from "vitest";
import {
  compareSourceAndResolved,
  applyManualResolution,
  decideCharacterIdentityConflict,
  deterministicHash,
  getLogicalRootPath,
  getEffectiveEntity,
  getEffectiveBoundary,
  getLogicalEntitiesAtPdfLocation,
  getMissingSpaceCandidates,
  getPhysicalEvidence,
  reconstructDocument as reconstructDocumentCore,
  getParagraphEvidence,
} from "./documentReconstruction.js";

const item = (str, x, y, width, { fontSize = 10, hasEOL = false, fontName = "FixtureFont" } = {}) => ({
  str,
  dir: "ltr",
  width,
  height: fontSize,
  transform: [fontSize, 0, 0, fontSize, x, -y],
  fontName,
  hasEOL,
});

const page = (pageIndex, items) => ({ pageIndex, width: 600, height: 800, items });
const reconstructDocument = (input) => reconstructDocumentCore({
  ...input,
  documentFormAssignments: input.documentFormAssignments ?? [{
    type: "PARAGRAPH",
    bboxes: (input.pages || []).map((entry) => ({ pageIndex: entry.pageIndex, x: -1000, y: -1000, width: 3000, height: 3000 })),
    source: "test-fixture-manual-assignment",
  }],
});

describe("document reconstruction — deterministic evidence architecture", () => {
  it("uses wide deterministic identities for large evidence streams", () => {
    const hashes = new Set(Array.from({ length: 100000 }, (_, index) => deterministicHash(["document", Math.floor(index / 1000), index, String.fromCodePoint(32 + index % 90)])));
    expect(hashes.size).toBe(100000);
    expect([...hashes][0]).toMatch(/^[a-f0-9]{32}$/);
  });

  it("preserves immutable PDF.js source items and separates characters from glyphs", () => {
    const result = reconstructDocument({ documentId: "doc-fixture", fileName: "Fixture.pdf", pages: [page(0, [item("Heart", 40, 80, 25)])] });
    expect(result.evidence.sourceEvidence[0].rawText).toBe("Heart");
    expect(Object.isFrozen(result.evidence.sourceEvidence[0])).toBe(true);
    expect(result.evidence.embeddedCharacters).toHaveLength(5);
    expect(result.evidence.glyphs).toHaveLength(5);
    expect(result.characters).toHaveLength(5);
    expect(result.evidence.glyphs[0].id).not.toBe(result.characters[0].id);
    expect(result.validation).toEqual({ valid: true, errors: [] });
  });

  it("exposes canonical text as a separate Unicode artifact with auditable spans", () => {
    const result = reconstructDocument({ documentId: "doc-canonical", pages: [page(0, [item("The ﬁ heart pumps blood.", 20, 50, 150)])] });
    expect(result.canonicalText.version).toBe("canonical-text-v1");
    expect(result.canonicalText.text).toContain("fi");
    expect(result.canonicalText.statistics.ligatureExpansions).toBe(1);
    expect(result.words[0].canonicalSpan).toEqual(expect.objectContaining({ start: 0, end: 3 }));
    expect(result.sentences[0].canonicalSpan.characterIds.length).toBeGreaterThan(0);
    expect(result.paragraphs[0].canonicalSpan.end).toBeLessThanOrEqual(result.canonicalText.characterCount);
    expect(result.validation.valid).toBe(true);
  });

  it("builds a versioned linguistic hierarchy and keeps lexemes as explicit relations", () => {
    const result = reconstructDocument({ documentId: "doc-linguistic", pages: [page(0, [item("The heart pumps blood.", 20, 50, 150)])] });
    expect(result.linguisticModelVersion).toBe("canonical-linguistic-v1");
    expect(result.sentences).toHaveLength(1);
    expect(result.clauses).toHaveLength(1);
    expect(result.phrases).toHaveLength(1);
    expect(result.clauses[0].sentenceId).toBe(result.sentences[0].id);
    expect(result.phrases[0].clauseId).toBe(result.clauses[0].id);
    expect(result.phrases[0].canonicalSpan).toEqual(expect.objectContaining({ start: result.sentences[0].canonicalSpan.start }));
    const pumps = result.words.find((word) => word.resolvedText === "pumps");
    expect(pumps).toEqual(expect.objectContaining({ parentPhraseId: result.phrases[0].id, lexicalRelation: expect.objectContaining({ type: "REALIZES" }) }));
    expect(result.lexemes.find((lexeme) => lexeme.id === pumps.lexemeId)).toEqual(expect.objectContaining({ lemma: "pumps", unresolved: true }));
    expect(result.validation.valid).toBe(true);
  });

  it("produces stable IDs and reconstruction hashes for identical evidence and config", () => {
    const input = { documentId: "doc-stable", pages: [page(0, [item("Stable text.", 20, 50, 60)])] };
    const first = reconstructDocument(input);
    const second = reconstructDocument(input);
    expect(second.run.reconstructionHash).toBe(first.run.reconstructionHash);
    expect(second.characters.map((entry) => entry.id)).toEqual(first.characters.map((entry) => entry.id));
    expect(second.sentences.map((entry) => entry.id)).toEqual(first.sentences.map((entry) => entry.id));
  });

  it("does not equate text-item boundaries with word boundaries", () => {
    const result = reconstructDocument({
      documentId: "doc-fragmented",
      pages: [page(0, [item("hyper", 20, 50, 25), item("ten", 45.5, 50, 15), item("sion", 61, 50, 20)])],
    });
    expect(result.words.map((word) => word.resolvedText)).toEqual(["hypertension"]);
    expect(result.evidence.sourceEvidence).toHaveLength(3);
  });

  it("inserts a constrained missing-space boundary without treating a concept as one word", () => {
    const input = {
      documentId: "doc-missing-space",
      pages: [page(0, [item("blood", 20, 50, 25), item("pressure", 45.5, 50, 40)])],
    };
    const initial = reconstructDocument(input);
    expect(initial.words.map((word) => word.resolvedText)).toEqual(["bloodpressure"]);
    const [candidate] = getMissingSpaceCandidates(initial, (surface) => ({ corpus: { recognized: ["blood", "pressure"].includes(surface) } }));
    expect(candidate.segmentation).toEqual(["blood", "pressure"]);
    const resolved = reconstructDocument({ ...input, wordSplitDecisions: [{ ...candidate, ruleId: "WORD_MISSING_SPACE_MULTI_EVIDENCE", evidence: { corpus: "fixture" } }] });
    expect(resolved.words.map((word) => word.resolvedText)).toEqual(["blood", "pressure"]);
    expect(resolved.transformations).toEqual(expect.arrayContaining([expect.objectContaining({ type: "INSERT_WORD_BOUNDARY", before: "bloodpressure", after: "blood pressure" })]));
    expect(resolved.validation.valid).toBe(true);
  });

  it("splits multiple words contained in one PDF text item", () => {
    const result = reconstructDocument({ documentId: "doc-merged", pages: [page(0, [item("heart rate", 20, 50, 60)])] });
    expect(result.words.map((word) => word.resolvedText)).toEqual(["heart", "rate"]);
    expect(result.evidence.sourceEvidence).toHaveLength(1);
  });

  it("preserves and explains an embedded false space removed by geometry", () => {
    const result = reconstructDocument({ documentId: "doc-false-space", pages: [page(0, [item("hea ", 20, 50, 15), item("rt", 31.5, 50, 10)])] });
    const word = result.words.find((entry) => entry.resolvedText === "heart");
    expect(word.rawText).toBe("hea rt");
    expect(word.morphologyStatus).toBe("not-analyzed");
    expect(word.morphemeIds).toEqual([]);
    expect(result.morphemes).toEqual([]);
    expect(compareSourceAndResolved(result, word.id).transformations).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "REMOVE_EXTRACTION_SPACE", before: "hea rt", after: "heart" }),
    ]));
  });

  it("normalizes ligatures without overwriting raw evidence and records alignment", () => {
    const result = reconstructDocument({ documentId: "doc-ligature", pages: [page(0, [item("ﬁbrosis", 20, 50, 45)])] });
    expect(result.evidence.sourceEvidence[0].rawText).toBe("ﬁbrosis");
    expect(result.words[0].normalizedText).toBe("fibrosis");
    expect(result.transformations.some((entry) => entry.type === "LIGATURE_EXPANSION")).toBe(true);
    expect(result.alignments.some((entry) => entry.relation === "expansion" && entry.canonicalCharacterIds.length === 2)).toBe(true);
    expect(result.validation.valid).toBe(true);
  });

  it("joins line- and page-crossing hyphenation while preserving both physical spans", () => {
    const result = reconstructDocument({
      documentId: "doc-cross-page",
      pages: [page(0, [item("hyper-", 20, 760, 35, { hasEOL: true })]), page(1, [item("tension", 20, 40, 42)])],
    });
    const word = result.words.find((entry) => entry.resolvedText === "hypertension");
    expect(word).toBeTruthy();
    expect(word.rawText).toBe("hyper-tension");
    expect(word.spansPages).toBe(true);
    expect(word.pageIndexes).toEqual([0, 1]);
    expect(compareSourceAndResolved(result, word.id).transformations[0].type).toBe("LINE_HYPHEN_JOIN");
    expect(getPhysicalEvidence(result, word.id).map((ref) => ref.pageIndex)).toContain(0);
    expect(getPhysicalEvidence(result, word.id).map((ref) => ref.pageIndex)).toContain(1);
  });

  it("applies abbreviation and decimal rules before terminal-period rules", () => {
    const result = reconstructDocument({
      documentId: "doc-sentences",
      pages: [page(0, [item("Dr. Smith measured 3.5 mg. Is this normal? Yes.", 20, 50, 280)])],
    });
    expect(result.sentences.map((sentence) => sentence.resolvedText)).toEqual([
      "Dr. Smith measured 3.5 mg.",
      "Is this normal?",
      "Yes.",
    ]);
    expect(result.boundaries.some((entry) => entry.ruleId === "SENTENCE_KNOWN_ABBREVIATION")).toBe(true);
    expect(result.boundaries.some((entry) => entry.ruleId === "SENTENCE_DECIMAL_PERIOD")).toBe(true);
  });

  it("uses document recurrence to exclude running headers from prose without deleting evidence", () => {
    const result = reconstructDocument({
      documentId: "doc-running-header",
      pages: [
        page(0, [item("Cardiology Manual", 20, 30, 90), item("The heart contracts.", 20, 120, 110)]),
        page(1, [item("Cardiology Manual", 20, 30, 90), item("Blood circulates.", 20, 120, 95)]),
      ],
    });
    expect(result.words.some((word) => word.resolvedText === "Cardiology")).toBe(false);
    expect(result.physical.pages.flatMap((entry) => entry.regions).some((region) => region.regionType === "header" && region.includeInBodyReadingOrder === false)).toBe(true);
    expect(result.evidence.sourceEvidence.some((entry) => entry.rawText === "Cardiology Manual")).toBe(true);
  });

  it("keeps OCR as a noncanonical spatial observation", () => {
    const result = reconstructDocument({
      documentId: "doc-ocr-only",
      pages: [page(0, [])],
      ocrObservations: [{ id: "ocr-1", pageIndex: 0, text: "heart", bbox: { x: 20, y: 30, width: 40, height: 10 }, pageWidth: 600, pageHeight: 800, engine: "fixture-ocr" }],
    });
    expect(result.characters).toEqual([]);
    expect(result.evidence.ocrObservations[0]).toEqual(expect.objectContaining({ text: "heart", canonical: false, characterIds: [] }));
  });

  it("spatially aligns OCR disagreement without mutating canonical text", () => {
    const result = reconstructDocument({
      documentId: "doc-ocr-conflict",
      pages: [page(0, [item("cat", 20, 50, 30)])],
      ocrObservations: [{ id: "ocr-cat", pageIndex: 0, text: "car", confidence: 97, bbox: { x: 20, y: 42, width: 30, height: 10 }, pageWidth: 600, pageHeight: 800, engine: "fixture-ocr", engineVersion: "1" }],
    });
    expect(result.words[0].resolvedText).toBe("cat");
    expect(result.evidence.ocrAlignments[0]).toEqual(expect.objectContaining({ status: "OCR_CONTRADICTION", canonicalText: "cat", observedText: "car", distance: 1 }));
    expect(result.evidence.conflicts[0]).toEqual(expect.objectContaining({ type: "CHARACTER_IDENTITY_CONFLICT", sourceValue: "t", status: "unresolved" }));
    expect(decideCharacterIdentityConflict(result, result.evidence.conflicts[0].id).decision).toBe("keep-source");
  });

  it("layers manual character review above the deterministic value", () => {
    const result = reconstructDocument({ documentId: "doc-manual-character", pages: [page(0, [item("cat", 20, 50, 30)])] });
    const character = result.characters.at(-1);
    const reviewed = applyManualResolution(result, { targetId: character.id, action: "accept-candidate", newState: { value: "r", candidateSelected: "r" }, userId: "fixture" });
    expect(reviewed.characters.at(-1).value).toBe("t");
    expect(reviewed.words[0].resolvedText).toBe("cat");
    expect(getEffectiveEntity(reviewed, character.id)).toEqual(expect.objectContaining({ deterministicValue: "t", effectiveValue: "r", manualOverride: expect.objectContaining({ status: "ACTIVE" }) }));
  });

  it("layers manual boundary review without rewriting deterministic boundaries", () => {
    const result = reconstructDocument({ documentId: "doc-manual-boundary", pages: [page(0, [item("heart rate", 20, 50, 60)])] });
    const boundary = result.boundaries.find((entry) => entry.boundaryType === "word");
    const reviewed = applyManualResolution(result, { targetId: boundary.id, action: "join", newState: { decision: "same" }, userId: "fixture" });
    expect(reviewed.boundaries.find((entry) => entry.id === boundary.id).decision).toBe("boundary");
    expect(getEffectiveBoundary(reviewed, boundary.id)).toEqual(expect.objectContaining({ deterministicDecision: "boundary", effectiveDecision: "same", manualOverride: expect.objectContaining({ status: "ACTIVE" }) }));
  });

  it("roots logical nodes through generic structural divisions and back to PDF evidence", () => {
    const result = reconstructDocument({
      documentId: "doc-root",
      fileName: "Cardiology.pdf",
      pages: [page(0, [item("The heart contracts.", 20, 50, 110)])],
      outlines: [
        { id: "chapter", title: "Chapter 1", level: 1, startPage: 1, endPage: 5 },
        { id: "section", title: "1.1 Cardiac Function", level: 2, startPage: 1, endPage: 2 },
      ],
    });
    const word = result.words.find((entry) => entry.resolvedText === "heart");
    expect(getLogicalRootPath(result, word.id).map((entry) => entry.label)).toEqual([
      "Cardiology.pdf", "Chapter 1", "1.1 Cardiac Function", "Paragraph 1", "Sentence 1", "heart",
    ]);
    expect(getPhysicalEvidence(result, word.id).every((ref) => ref.pageIndex === 0 && ref.textItemId && ref.lineId)).toBe(true);
    const heartRef = getPhysicalEvidence(result, word.id)[0];
    expect(getLogicalEntitiesAtPdfLocation(result, { pageIndex: 0, x: heartRef.x, y: heartRef.y }).map((entry) => entry.id)).toContain(word.id);
  });

  it.skip("legacy: inferred first-line indentation created paragraphs", () => {
    const result = reconstructDocument({ documentId: "doc-indent-paragraphs", pages: [page(0, [
      item("The heart pumps blood through the", 40, 50, 190, { hasEOL: true }),
      item("systemic circulation. Cardiac output is", 20, 62, 210, { hasEOL: true }),
      item("determined by heart rate and stroke volume.", 20, 74, 230, { hasEOL: true }),
      item("Increased afterload may decrease", 40, 86, 180, { hasEOL: true }),
      item("stroke volume.", 20, 98, 80, { hasEOL: true }),
    ])] });
    expect(result.paragraphs).toHaveLength(2);
    expect(result.paragraphBoundaryDecisions.some((entry) => entry.ruleId === "PARAGRAPH_FIRST_LINE_INDENT" && entry.decision === "new-paragraph")).toBe(true);
    expect(result.paragraphs[0].lineIds).toHaveLength(3);
    expect(getParagraphEvidence(result, result.paragraphs[0].id).lines).toHaveLength(3);
  });

  it.skip("legacy: inferred block gaps created paragraphs", () => {
    const result = reconstructDocument({ documentId: "doc-block-paragraphs", pages: [page(0, [
      item("The heart pumps blood through the", 20, 50, 190, { hasEOL: true }),
      item("systemic circulation. It contracts.", 20, 62, 180, { hasEOL: true }),
      item("This remains in the first paragraph.", 20, 74, 190, { hasEOL: true }),
      item("Increased afterload may decrease", 20, 98, 180, { hasEOL: true }),
      item("stroke volume.", 20, 110, 80, { hasEOL: true }),
    ])] });
    expect(result.paragraphs).toHaveLength(2);
    expect(result.paragraphBoundaryDecisions.some((entry) => ["PARAGRAPH_BLOCK_GAP", "PARAGRAPH_BLANK_LINE"].includes(entry.ruleId) && entry.decision === "new-paragraph")).toBe(true);
    expect(result.paragraphs[0].sentenceIds.length).toBeGreaterThan(1);
  });

  it.skip("legacy: automatic paragraphs crossed page transitions", () => {
    const result = reconstructDocument({ documentId: "doc-cross-page-paragraph", pages: [
      page(0, [item("Chronic systemic hypertension causes the", 20, 740, 220, { hasEOL: true }), item("left ventricle to generate greater pressure", 20, 752, 230, { hasEOL: true })]),
      page(1, [item("during systole and may eventually produce", 20, 50, 220, { hasEOL: true }), item("concentric hypertrophy.", 20, 62, 130, { hasEOL: true })]),
    ] });
    expect(result.paragraphs).toHaveLength(1);
    expect(result.paragraphs[0].pageIndexes).toEqual([0, 1]);
    expect(result.paragraphBoundaryDecisions.some((entry) => entry.ruleId === "PARAGRAPH_CROSS_PAGE_CONTINUATION")).toBe(true);
  });

  it.skip("legacy: inferred indentation started cross-page paragraphs", () => {
    const result = reconstructDocument({ documentId: "doc-cross-page-new-paragraph", pages: [
      page(0, [item("The first paragraph begins here and", 20, 716, 190, { hasEOL: true }), item("continues with another visual line", 20, 728, 180, { hasEOL: true }), item("before it finishes on this page.", 20, 740, 170, { hasEOL: true })]),
      page(1, [item("The second paragraph begins indented.", 40, 50, 200, { hasEOL: true }), item("Its continuation returns to the margin.", 20, 62, 210, { hasEOL: true })]),
    ] });
    expect(result.paragraphs).toHaveLength(2);
    expect(result.paragraphBoundaryDecisions.some((entry) => entry.evidence.pageTransition && entry.ruleId === "PARAGRAPH_FIRST_LINE_INDENT" && entry.decision === "new-paragraph")).toBe(true);
  });

  it.skip("legacy: inferred columns created paragraph spans", () => {
    const rows = Array.from({ length: 6 }, (_, index) => [
      item(`Left column line ${index}.`, 20, 50 + index * 14, 130, { hasEOL: true }),
      item(`Right column line ${index}.`, 380, 50 + index * 14, 140, { hasEOL: true }),
    ]).flat();
    const result = reconstructDocument({ documentId: "doc-two-column-paragraphs", pages: [page(0, rows)] });
    const lineById = new Map(result.physical.pages[0].regions.flatMap((region) => region.lines.map((line) => [line.id, line])));
    expect(result.physical.pages[0].columnCount).toBe(2);
    expect(result.paragraphs.every((paragraph) => new Set(paragraph.lineIds.map((id) => lineById.get(id)?.columnId)).size === 1)).toBe(true);
    expect(result.paragraphBoundaryDecisions.some((entry) => entry.ruleId === "PARAGRAPH_REGION_TRANSITION" && entry.evidence.sameColumn === false)).toBe(true);
  });

  it.skip("legacy: inferred list geometry created paragraphs", () => {
    const result = reconstructDocument({ documentId: "doc-list-paragraph", pages: [page(0, [
      item("1. Tachycardia may occur with", 20, 50, 160, { hasEOL: true }),
      item("sympathetic stimulation.", 40, 62, 130, { hasEOL: true }),
      item("2. Bradycardia may occur with", 20, 86, 160, { hasEOL: true }),
      item("increased vagal tone.", 40, 98, 120, { hasEOL: true }),
    ])] });
    expect(result.paragraphs).toHaveLength(2);
    expect(result.paragraphBoundaryDecisions.some((entry) => entry.ruleId === "PARAGRAPH_HANGING_CONTINUATION" && entry.decision === "same-paragraph")).toBe(true);
    expect(result.paragraphBoundaryDecisions.some((entry) => entry.ruleId === "PARAGRAPH_LIST_ITEM_START" && entry.decision === "new-paragraph")).toBe(true);
  });

  it.skip("legacy: paragraph inference reconciled sentence boundaries", () => {
    const result = reconstructDocument({ documentId: "doc-sentence-paragraph-conflict", pages: [page(0, [
      item("This long sentence begins on the", 40, 50, 180, { hasEOL: true }),
      item("continuation line and remains", 20, 62, 160, { hasEOL: true }),
      item("physically continuous without punctuation", 20, 74, 210, { hasEOL: true }),
      item("but this recurring indent is strong", 40, 86, 190, { hasEOL: true }),
      item("enough to expose disagreement.", 20, 98, 160, { hasEOL: true }),
    ])] });
    expect(result.evidence.conflicts).toEqual(expect.arrayContaining([expect.objectContaining({ type: "SENTENCE_PARAGRAPH_BOUNDARY_CONFLICT", status: "reconciled", reconciliation: "split-sentence-at-strong-physical-paragraph-boundary" })]));
    expect(result.sentences).toHaveLength(2);
  });
});
