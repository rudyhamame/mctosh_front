import { finalPredictionCharacter } from "./glyphCharComparison.js";

const predictionOf = (glyph, channel) => glyph?.visualEvidence?.[channel]?.prediction
  || glyph?.visualEvidence?.[channel]?.recognition || null;
const recognitionState = (prediction) => ["predicted", "ambiguous", "unpredictable", "unavailable"].includes(String(prediction?.status || "unavailable").toLowerCase())
  ? String(prediction?.status || "unavailable").toLowerCase() : "unavailable";
const openSetState = (glyph, raster, vector) => {
  const value = String(glyph?.openSetAssessment?.status || raster?.openSetAssessment?.status || vector?.openSetAssessment?.status || "UNAVAILABLE").toUpperCase();
  return ["IN_VOCABULARY", "OUT_OF_VOCABULARY", "OPEN_SET_UNCERTAIN"].includes(value) ? value : "UNAVAILABLE";
};

export const glyphResultState = (glyph) => {
  if (glyph?.visible === false) return "NO_VISIBLE_GLYPH";
  const raster = predictionOf(glyph, "raster") || glyph?.prediction;
  const openSet = openSetState(glyph, raster, predictionOf(glyph, "vector"));
  if (openSet === "OUT_OF_VOCABULARY" || openSet === "OPEN_SET_UNCERTAIN") return openSet;
  if (raster?.status === "ambiguous") return "AMBIGUOUS";
  const predicted = finalPredictionCharacter(raster);
  if (raster?.status === "unavailable" || !raster) return "UNAVAILABLE";
  if (raster?.status !== "predicted" || predicted == null) return "UNPREDICTABLE";
  const given = Array.isArray(glyph?.given?.values) ? glyph.given.values : glyph?.given?.value == null ? [] : Array.from(String(glyph.given.value));
  if (!given.length) return "NO_GIVEN_CHAR";
  if (given.length !== 1) return "MULTI_CHAR_GLYPH";
  return given[0] === predicted ? "MATCH" : "DISAGREEMENT";
};

export const deriveGlyphCharCounters = (glyphs = []) => {
  const counts = {
    instances: { total: glyphs.length, studied: glyphs.filter((glyph) => ["studied", "failed"].includes(glyph?.analysisStatus)).length },
    raster: { predicted: 0, ambiguous: 0, unpredictable: 0, unavailable: 0 },
    vector: { predicted: 0, ambiguous: 0, unpredictable: 0, unavailable: 0 },
    morphology: { rasterAvailable: 0, rasterUnavailable: 0, vectorAvailable: 0, vectorUnavailable: 0 },
    openSet: { inVocabulary: 0, outOfVocabulary: 0, uncertain: 0, unavailable: 0 },
    evidenceComparison: { fullAgreement: 0, pdfMappingDisagreement: 0, vectorRasterDisagreement: 0, unresolved: 0, noGivenChar: 0, noVisibleGlyph: 0 },
    admission: { ELIGIBLE_WITH_PROVENANCE: 0, REVIEW_REQUIRED: 0, OBSERVE_ONLY: 0, HUMAN_ASSERTED: 0 },
  };
  glyphs.forEach((glyph) => {
    const raster = predictionOf(glyph, "raster") || glyph?.prediction;
    const vector = predictionOf(glyph, "vector");
    if (glyph?.visualEvidence?.raster?.available) counts.morphology.rasterAvailable += 1; else counts.morphology.rasterUnavailable += 1;
    if (glyph?.visualEvidence?.vector?.available) counts.morphology.vectorAvailable += 1; else counts.morphology.vectorUnavailable += 1;
    counts.raster[recognitionState(raster)] += 1;
    counts.vector[recognitionState(vector)] += 1;
    const openSet = openSetState(glyph, raster, vector);
    if (openSet === "IN_VOCABULARY") counts.openSet.inVocabulary += 1;
    else if (openSet === "OUT_OF_VOCABULARY") counts.openSet.outOfVocabulary += 1;
    else if (openSet === "OPEN_SET_UNCERTAIN") counts.openSet.uncertain += 1;
    else counts.openSet.unavailable += 1;
    const result = glyphResultState(glyph);
    if (result === "NO_VISIBLE_GLYPH") counts.evidenceComparison.noVisibleGlyph += 1;
    else if (!(Array.isArray(glyph?.given?.values) ? glyph.given.values : glyph?.given?.value == null ? [] : Array.from(String(glyph.given.value))).length) counts.evidenceComparison.noGivenChar += 1;
    else if (["OUT_OF_VOCABULARY", "OPEN_SET_UNCERTAIN", "UNPREDICTABLE", "UNAVAILABLE", "AMBIGUOUS"].includes(result)) counts.evidenceComparison.unresolved += 1;
    else {
      const given = glyph?.given?.value;
      const rasterValue = finalPredictionCharacter(raster);
      const vectorValue = finalPredictionCharacter(vector);
      if (rasterValue && vectorValue && rasterValue !== vectorValue) counts.evidenceComparison.vectorRasterDisagreement += 1;
      else if (rasterValue && vectorValue && rasterValue === vectorValue && rasterValue === given) counts.evidenceComparison.fullAgreement += 1;
      else if (rasterValue || vectorValue) counts.evidenceComparison.pdfMappingDisagreement += 1;
      else counts.evidenceComparison.unresolved += 1;
    }
    const admission = glyph?.admissionDecision?.state || "OBSERVE_ONLY";
    counts.admission[Object.hasOwn(counts.admission, admission) ? admission : "OBSERVE_ONLY"] += 1;
  });
  return counts;
};
