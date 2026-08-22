const MAX_TOPIC_LABEL_CHARACTERS = 120;
const MAX_TOPIC_LABEL_WORDS = 15;
const DISCOURSE_LABELS = new Set(["warning", "note", "question"]);
const QUOTATION_INTRODUCERS = /\b(?:said|states|stated|notes|reported|asked|replied|writes?)$/iu;
const FINITE_CLAUSE = /\b(?:am|is|are|was|were|be|been|being|has|have|had|does|do|did|can|could|will|would|should|may|might|must|contains?|causes?|shows?|means?|seems?|appears?|was|were)\b/iu;
const MEASUREMENT = /(?:^|\s)(?:\d+(?:[.,]\d+)?(?:\s*[–-]\s*\d+(?:[.,]\d+)?)?|\d+\/\d+)(?:\s*[a-z%μ°][\w²³/.-]*)/iu;
const TIME_OR_RATIO = /^(?:\d{1,2}:\d{2}|\d+(?:\.\d+)?\s*:\s*\d+(?:\.\d+)?)$/u;
const URL = /^(?:https?:\/\/|ftp:\/\/|www\.)/iu;
const FINITE_VERB = /\b(?:is|are|was|were|has|have|had|contains?|causes?|shows?|means?|initiates?|pumps?|receives?|contracts?|varies|changes?|remains?|precedes?|follows?|originates?|characterized)\b/iu;
const RELATIVE_CLAUSE = /\b(?:that|which|who|whom)\s+(?:is|are|was|were|has|have|contains?|originates?|causes?|shows?|precedes?|follows?)\b/iu;
const MAIN_SUBJECT = /^(?:the|a|an|this|that|these|those|each|every|blood|heart|patient|node|ventricle|atrium|atria|rate|rhythm)\b[\s\S]*?\b(?:is|are|was|were|has|have|contains?|causes?|shows?|initiates?|pumps?|receives?|contracts?|varies|changes?|precedes?|follows?|originates?)\b/iu;

const cleanLabel = (value) => String(value || "").replace(/\s+/gu, " ").trim();

const isPluralTopic = (label) => {
  const normalized = label.toLowerCase();
  if (/\b(?:atria|ventricles|chambers|waves|intervals|rates|nodes|valves|arteries|veins)\b/iu.test(normalized)) return true;
  if (/\b(?:status|diabetes|analysis|sinus|news|physics|series)\b$/iu.test(normalized)) return false;
  return /(?:ae|ices|ies|s|ia)$/iu.test(normalized) && !/\b(?:is|was|has|does)\b/iu.test(normalized);
};

export const chooseTopicCopula = (topicLabel) => ({
  copula: isPluralTopic(topicLabel) ? "are" : "is",
  status: "resolved",
  reason: isPluralTopic(topicLabel) ? "controlled_plural_topic" : "conservative_singular_default",
});

export const analyzeTopicBodyFragment = (bodyText) => {
  const body = cleanLabel(bodyText);
  const hasFiniteVerb = FINITE_VERB.test(body);
  const relativeVerb = RELATIVE_CLAUSE.test(body);
  const hasMainClausePredicate = Boolean(hasFiniteVerb && !relativeVerb && MAIN_SUBJECT.test(body));
  const finiteVerbScope = !hasFiniteVerb ? "none" : relativeVerb && !hasMainClausePredicate ? "relative_clause" : hasMainClausePredicate ? "main_clause" : "ambiguous";
  const phraseType = MEASUREMENT.test(body) ? "measurement"
    : /^(?:do not|don't|never|avoid|administer|take|use)\b/iu.test(body) ? "instruction"
      : /^["“'`]/u.test(body) ? "quotation"
        : /,\s+[^.]+(?:,|\band\b)/iu.test(body) && !hasFiniteVerb ? "enumeration"
          : relativeVerb ? "nominal"
            : /^(?:upright|inverted|regular|irregular|normal|abnormal|present|absent|elevated|reduced|increased|decreased)\b/iu.test(body) ? "adjectival"
            : /^(?:characterized|originating|located|formed|connected|followed|associated)\b/iu.test(body) ? "participial"
              : hasMainClausePredicate ? "complete_clause" : "nominal";
  return { hasMainClausePredicate, hasFiniteVerb, finiteVerbScope, phraseType };
};

const classifyTopic = (label, body) => {
  if (MEASUREMENT.test(body)) return "measurement_label";
  if (/^(?:upright|inverted|regular|irregular|normal|abnormal|present|absent|elevated|reduced|increased|decreased)\b/iu.test(body)) return "property_label";
  if (/^(?:a|an|the)\b/iu.test(body)) return "definition_label";
  return "topic_label";
};

export const detectTopicLabel = (paragraphText, options = {}) => {
  const originalText = typeof paragraphText === "string" ? paragraphText : "";
  const text = originalText.trim();
  const maxCharacters = options.maxTopicLabelCharacters || MAX_TOPIC_LABEL_CHARACTERS;
  const maxWords = options.maxTopicLabelWords || MAX_TOPIC_LABEL_WORDS;
  const notDetected = (classification = "not_a_label", confidence = "ambiguous", constructionType = "not_topic_structure") => ({
    detected: false, originalText, topicLabel: null, bodyText: originalText,
    delimiter: null, labelStart: null, labelEnd: null, classification, confidence,
    constructionType, rightSideAnalysis: analyzeTopicBodyFragment(originalText),
    implicitRelation: { inserted: false, predicateType: "none", surfaceForm: null, ruleId: null }, normalizedText: null,
    status: constructionType === "not_topic_structure" ? "rejected" : "ambiguous",
  });
  if (!text) return notDetected();
  const match = text.match(/^([^:\n]{1,120})\s*:\s+([\s\S]+)$/u);
  if (!match) return notDetected();
  const label = cleanLabel(match[1]);
  const bodyText = match[2].trim();
  const labelStart = originalText.indexOf(label);
  const labelEnd = labelStart + label.length;
  const reject = () => notDetected("not_a_label", "ambiguous");
  if (!label || label.length > maxCharacters || label.split(/\s+/u).length > maxWords) return reject();
  if (label.endsWith(".") || label.endsWith("?") || label.endsWith("!") || URL.test(label) || TIME_OR_RATIO.test(label)) return reject();
  if (DISCOURSE_LABELS.has(label.toLowerCase())) return notDetected("not_a_label", "exact_rule", "instruction_label");
  if (QUOTATION_INTRODUCERS.test(label) || /^["“'`]/u.test(bodyText)) return notDetected("not_a_label", "exact_rule", "quotation_introduction");
  if (FINITE_CLAUSE.test(label)) return notDetected("not_a_label", "exact_rule", "ordinary_clause_colon");
  if (TIME_OR_RATIO.test(bodyText)) return notDetected("not_a_label", "exact_rule", "ambiguous");
  if (URL.test(bodyText)) return notDetected("not_a_label", "exact_rule", "ordinary_clause_colon");
  const rightSideAnalysis = analyzeTopicBodyFragment(bodyText);
  const constructionType = rightSideAnalysis.phraseType === "measurement" ? "label_plus_measurement_fragment"
    : rightSideAnalysis.phraseType === "adjectival" ? "label_plus_adjectival_fragment"
      : rightSideAnalysis.phraseType === "participial" ? "label_plus_participial_fragment"
        : rightSideAnalysis.phraseType === "enumeration" ? "label_plus_enumeration"
          : rightSideAnalysis.phraseType === "complete_clause" ? "label_plus_complete_clause" : "label_plus_nominal_fragment";
  return {
    detected: true,
    originalText,
    topicLabel: label,
    bodyText,
    delimiter: ":",
    labelStart,
    labelEnd,
    classification: classifyTopic(label, bodyText),
    confidence: "structural_rule",
    constructionType,
    rightSideAnalysis,
    implicitRelation: { inserted: constructionType !== "label_plus_complete_clause", predicateType: constructionType === "label_plus_adjectival_fragment" ? "copular_property" : constructionType === "label_plus_measurement_fragment" ? "copular_measurement" : constructionType === "label_plus_enumeration" ? "enumeration" : constructionType === "label_plus_complete_clause" ? "none" : "copular_classification", surfaceForm: constructionType === "label_plus_complete_clause" ? null : isPluralTopic(label) ? "are" : "is", ruleId: constructionType === "label_plus_complete_clause" ? null : constructionType.toUpperCase() },
    normalizedText: null,
    status: "preserved",
  };
};
