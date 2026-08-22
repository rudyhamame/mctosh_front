export const GLYPH_CHAR_COMPARISON_STATES = Object.freeze({
  MATCH: "MATCH",
  DISAGREEMENT: "DISAGREEMENT",
  AMBIGUOUS: "AMBIGUOUS",
  UNPREDICTABLE: "UNPREDICTABLE",
  NO_GIVEN_CHAR: "NO_GIVEN_CHAR",
  NO_VISIBLE_GLYPH: "NO_VISIBLE_GLYPH",
  MULTI_CHAR_GLYPH: "MULTI_CHAR_GLYPH",
  OUT_OF_VOCABULARY: "OUT_OF_VOCABULARY",
  OPEN_SET_UNCERTAIN: "OPEN_SET_UNCERTAIN",
});

export const finalPredictionCharacter = (prediction) => {
  const openSet = String(prediction?.openSetAssessment?.status || "").toUpperCase();
  if (["OUT_OF_VOCABULARY", "OPEN_SET_UNCERTAIN"].includes(openSet)) return null;
  return prediction?.status === "predicted" && prediction?.predictedChar != null
    ? prediction.predictedChar : null;
};

export const compareGlyphChar = ({ givenChars = [], prediction = null, visible = true }) => {
  if (!visible) return GLYPH_CHAR_COMPARISON_STATES.NO_VISIBLE_GLYPH;
  if (prediction?.openSetAssessment?.status === "OUT_OF_VOCABULARY") return GLYPH_CHAR_COMPARISON_STATES.OUT_OF_VOCABULARY;
  if (prediction?.openSetAssessment?.status === "OPEN_SET_UNCERTAIN") return GLYPH_CHAR_COMPARISON_STATES.OPEN_SET_UNCERTAIN;
  const given = Array.isArray(givenChars) ? givenChars : [];
  const final = finalPredictionCharacter(prediction);
  const predicted = final == null ? [] : [final];
  if (prediction?.status === "ambiguous") return GLYPH_CHAR_COMPARISON_STATES.AMBIGUOUS;
  if (prediction?.status !== "predicted" || !predicted.length) return GLYPH_CHAR_COMPARISON_STATES.UNPREDICTABLE;
  if (!given.length) return GLYPH_CHAR_COMPARISON_STATES.NO_GIVEN_CHAR;
  if (given.length !== 1 || predicted.length !== 1) return GLYPH_CHAR_COMPARISON_STATES.MULTI_CHAR_GLYPH;
  return given[0] === predicted[0]
    ? GLYPH_CHAR_COMPARISON_STATES.MATCH
    : GLYPH_CHAR_COMPARISON_STATES.DISAGREEMENT;
};

export const GLYPH_VISUAL_COMPARISON_STATES = Object.freeze({
  FULL_AGREEMENT: "FULL_AGREEMENT",
  PDF_MAPPING_DISAGREEMENT: "PDF_MAPPING_DISAGREEMENT",
  VECTOR_RASTER_DISAGREEMENT: "VECTOR_RASTER_DISAGREEMENT",
  VECTOR_ONLY: "VECTOR_ONLY",
  RASTER_ONLY: "RASTER_ONLY",
  AMBIGUOUS: "AMBIGUOUS",
  NO_GIVEN_CHAR: "NO_GIVEN_CHAR",
  NO_VISIBLE_GLYPH: "NO_VISIBLE_GLYPH",
  UNRESOLVED: "UNRESOLVED",
});

export const compareGlyphVisualEvidence = ({ givenChar = null, vectorPrediction = null, rasterPrediction = null, visible = true }) => {
  if (!visible) return GLYPH_VISUAL_COMPARISON_STATES.NO_VISIBLE_GLYPH;
  if (givenChar == null || givenChar === "") return GLYPH_VISUAL_COMPARISON_STATES.NO_GIVEN_CHAR;
  if (vectorPrediction?.status === "ambiguous" || rasterPrediction?.status === "ambiguous") return GLYPH_VISUAL_COMPARISON_STATES.AMBIGUOUS;
  const vector = finalPredictionCharacter(vectorPrediction);
  const raster = finalPredictionCharacter(rasterPrediction);
  if (vector && raster) {
    if (vector !== raster) return GLYPH_VISUAL_COMPARISON_STATES.VECTOR_RASTER_DISAGREEMENT;
    return vector === givenChar ? GLYPH_VISUAL_COMPARISON_STATES.FULL_AGREEMENT : GLYPH_VISUAL_COMPARISON_STATES.PDF_MAPPING_DISAGREEMENT;
  }
  if (vector) return GLYPH_VISUAL_COMPARISON_STATES.VECTOR_ONLY;
  if (raster) return GLYPH_VISUAL_COMPARISON_STATES.RASTER_ONLY;
  return GLYPH_VISUAL_COMPARISON_STATES.UNRESOLVED;
};
