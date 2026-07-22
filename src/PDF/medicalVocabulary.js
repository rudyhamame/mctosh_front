// medicalVocabulary.js
//
// Curated, free/local vocabulary used ONLY to decide whether a repaired
// split-word candidate ("myoc" + "ardial" -> "myocardial") is a real word
// worth suggesting during selected-text correction (pdfTextCorrection.js).
// Not used by search — search is tolerant by construction and never needs
// a dictionary to find "myoc ardial infar ction" for the query "myocardial
// infarction" (see pdfFuzzySearch.js's compact-text stage).
//
// Deliberately a plain local data file, not a licensed terminology system
// (UMLS/SNOMED/RxNorm/ICD all require accepting a license before use) —
// this is hand-curated common cardiology/general-medicine vocabulary, kept
// intentionally small and easy to extend. Add more terms as this app's
// document set grows; nothing else in pdfTextCorrection.js needs to change
// to pick them up.

export const MEDICAL_VOCABULARY = new Set([
  // Cardiac rhythm / electrophysiology
  "bradycardia", "tachycardia", "arrhythmia", "arrhythmias", "fibrillation",
  "flutter", "asystole", "bradyarrhythmia", "bradyarrhythmias",
  "tachyarrhythmia", "tachyarrhythmias", "conduction", "reentry",
  "wolffparkinsonwhite", "torsades", "extrasystole", "palpitations",

  // Heart failure / structural
  "cardiomyopathy", "cardiomegaly", "hypertrophy", "hfpef", "hfref",
  "dyspnea", "orthopnea", "edema", "congestion", "regurgitation",
  "stenosis", "prolapse", "aneurysm", "dissection", "tamponade",
  "effusion", "pericarditis", "myocarditis", "endocarditis",

  // Coronary / ischemic
  "myocardial", "infarction", "ischemia", "ischemic", "angina",
  "atherosclerosis", "thrombosis", "embolism", "revascularization",

  // Vascular
  "cardiovascular", "hypertension", "hypotension", "vasoconstriction",
  "vasodilation", "atherosclerotic", "peripheral", "claudication",

  // Basic anatomy — easy to overlook, but exactly the common short words a
  // fuzzy dictionary fallback could otherwise "correct" into something else
  "heart", "failure", "lung", "lungs", "blood", "pressure", "artery",
  "arteries", "vein", "veins", "valve", "valves", "chamber", "chambers",
  "ventricle", "ventricles", "atrium", "atria", "aorta", "aortic",
  "mitral", "tricuspid", "pulmonary", "systolic", "diastolic", "output",
  "rhythm", "rate", "murmur", "pulse", "vessel", "vessels", "muscle",

  // Pharmacology
  "spironolactone", "sympathomimetics", "sympathomimetic",
  "parasympathomimetic", "anticoagulant", "anticoagulants",
  "antiplatelet", "antiarrhythmic", "vasopressor", "diuretic",
  "diuretics", "inotrope", "inotropic", "chronotropic",
  "betablocker", "acei", "arb", "arni", "sglt2", "glp1",

  // Labs / biomarkers
  "troponin", "hba1c", "bnp", "ntprobnp", "creatinine", "electrolyte",
  "electrolytes", "hyperkalemia", "hypokalemia", "hypernatremia",
  "hyponatremia", "hypercalcemia", "hypocalcemia",

  // Common general-medicine words that split-word repair sees often
  "patient", "patients", "history", "presented", "presentation",
  "diagnosis", "diagnosed", "treatment", "treated", "symptom",
  "symptoms", "examination", "physical", "clinical", "chronic",
  "acute", "severe", "moderate", "mild", "bilateral", "unilateral",
  "anterior", "posterior", "lateral", "medial", "proximal", "distal",
]);

/** Adds one or more terms at runtime (e.g. a future per-user custom list) — lowercase, no punctuation, matching how split-word candidates are checked. */
export const addMedicalVocabulary = (terms) => {
  for (const term of terms) MEDICAL_VOCABULARY.add(String(term).toLowerCase());
};
