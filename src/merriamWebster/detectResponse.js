import { isMWEntry } from "./guards";

export const MW_RESPONSE_TYPES = Object.freeze({
  ENTRIES: "entries",
  SUGGESTIONS: "suggestions",
  EMPTY: "empty",
  UNKNOWN: "unknown",
});

export const detectMWResponseType = (response) => {
  if (!Array.isArray(response)) return MW_RESPONSE_TYPES.UNKNOWN;
  if (response.length === 0) return MW_RESPONSE_TYPES.EMPTY;
  if (response.every((item) => typeof item === "string")) return MW_RESPONSE_TYPES.SUGGESTIONS;
  if (response.some(isMWEntry)) return MW_RESPONSE_TYPES.ENTRIES;
  return MW_RESPONSE_TYPES.UNKNOWN;
};
