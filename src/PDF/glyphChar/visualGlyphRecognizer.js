/* Browser-only fallback for unsaved PDFs.

Character identity is intentionally unavailable here. The former browser
template matcher used pixel overlap as if it were a classifier; keeping that
behavior would let legacy shape matching masquerade as neural output. Saved
PDFs are recognized by the versioned TorchScript backend. */
export const createVisualGlyphRecognizer = () => ({
  name: "glyph-identity-fusion-v2-backend-required",
  async predict() {
    return {
      predictedChar: null,
      predictedChars: [],
      candidates: [],
      confidence: null,
      modelScore: null,
      status: "unavailable",
      modelName: "rabbit-glyph-raster-fusion",
      modelVersion: "v2",
      probabilitiesCalibrated: false,
      predictionSource: "RASTER_BASE_MODEL",
      openSetAssessment: { status: "UNAVAILABLE", score: null, method: "explicit-knownness-energy-v1", nearestKnownCandidates: [], reason: "Backend required." },
      unavailableReason: "Neural glyph recognition requires a saved PDF and the local PDF-structure service.",
    };
  },
});
