export const getLayer1Admission = (glyph) => glyph?.admissionDecision || {
  state: "OBSERVE_ONLY", admittedChar: null,
  reasonCodes: ["ADMISSION_DECISION_UNAVAILABLE"], policyVersion: null,
};

export const getAdmittedChar = (glyph) => {
  const admission = getLayer1Admission(glyph);
  return ["ELIGIBLE_WITH_PROVENANCE", "HUMAN_ASSERTED"].includes(admission.state)
    ? admission.admittedChar || null : null;
};
