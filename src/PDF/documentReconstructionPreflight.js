export const DEFAULT_RECONSTRUCTION_SAFETY_CONFIG = Object.freeze({
  samplePageCount: 5,
  backendPageThreshold: 180,
  backendCharacterThreshold: 120000,
  backendItemThreshold: 24000,
  safariCharacterBudget: 75000,
  safariItemBudget: 14000,
  defaultCharacterBudget: 180000,
  defaultItemBudget: 36000,
});

const uniqueSorted = (values) => [...new Set(values)].sort((a, b) => a - b);

export const selectPreflightPageNumbers = (pageCount, sampleCount = DEFAULT_RECONSTRUCTION_SAFETY_CONFIG.samplePageCount) => {
  const total = Math.max(0, Math.floor(Number(pageCount) || 0));
  if (!total) return [];
  const count = Math.max(1, Math.min(total, Math.floor(Number(sampleCount) || 1)));
  if (count === 1) return [1];
  return uniqueSorted(Array.from({ length: count }, (_, index) => 1 + Math.round(index * (total - 1) / (count - 1))));
};

export const estimateDocumentComplexity = ({ pageCount, samples }) => {
  const valid = (samples || []).filter((sample) => Number.isFinite(Number(sample.characters)) && Number.isFinite(Number(sample.items)));
  const mean = (key) => valid.length ? valid.reduce((sum, sample) => sum + Math.max(0, Number(sample[key]) || 0), 0) / valid.length : 0;
  const total = Math.max(0, Number(pageCount) || 0);
  const estimatedCharacters = Math.round(mean("characters") * total);
  const estimatedItems = Math.round(mean("items") * total);
  return { sampledPages: valid.length, pageCount: total, estimatedCharacters, estimatedItems, estimatedEvidenceBytes: estimatedCharacters * 720 };
};

export const chooseReconstructionMode = ({ estimate, sourceBacked, config = DEFAULT_RECONSTRUCTION_SAFETY_CONFIG }) => {
  const large = estimate.pageCount >= config.backendPageThreshold || estimate.estimatedCharacters >= config.backendCharacterThreshold || estimate.estimatedItems >= config.backendItemThreshold;
  if (!large) return { mode: "browser", reason: "within-browser-working-set" };
  return sourceBacked ? { mode: "backend", reason: "estimated-document-complexity" } : { mode: "browser-partial", reason: "large-document-not-source-backed" };
};
