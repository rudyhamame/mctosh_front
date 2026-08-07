import { chooseTopicCopula } from "./topicLabelDetector";

const FINITE_VERB = /\b(?:is|are|was|were|has|have|had|contains?|causes?|shows?|means?|initiates?|pumps?|receives?|contracts?|varies|changes?|remains?|appears?|seems?|becomes?|precedes?|follows?|originates?|increases?|decreases?)\b/iu;
const STARTING_PRONOUN = /^(it|this|that|these|those)\b\s*/iu;
const ARTICLE = /^(?:a|an|the)\b/iu;
const EXPLICIT_SUBJECT = /^(?:the|a|an|this|that|these|those|each|every|blood|heart|patient|node|ventricle|atrium|atria|rate|rhythm)\b[\s\S]*\b(?:is|are|was|were|has|have|contains?|causes?|shows?|initiates?|pumps?|receives?|contracts?|varies|changes?|precedes?|follows?|originates?)\b/iu;

const startsWithAdjective = (text) => /^(?:normal|abnormal|upright|inverted|regular|irregular|present|absent|elevated|reduced|increased|decreased|characterized|originating|originates|pumped|located|formed|connected)\b/iu.test(text);
const startsWithMeasurement = (text) => /^\d+(?:[.,]\d+)?(?:\s*[–-]\s*\d+(?:[.,]\d+)?)?/u.test(text);
const startsWithMassNoun = (text) => /^(?:blood|water|air|fluid|oxygen|volume|material|information|evidence)\b/iu.test(text);
const lowerFirst = (text) => text ? `${text[0].toLowerCase()}${text.slice(1)}` : text;
const isEnumeration = (text) => /,\s+[^.]+(?:,|\band\b)/iu.test(text) && !FINITE_VERB.test(text) && !startsWithAdjective(text);

export const normalizeTopicSentence = (sentenceText, topicLabel) => {
  const originalText = String(sentenceText || "").trim();
  const topic = String(topicLabel || "").trim();
  const none = { originalText, normalizedText: originalText, dependsOnTopic: false, topicDependencyType: "none", topicLabelText: topic || null, topicConstructionType: "label_plus_complete_clause", usedTopicContext: false, usedImplicitRelation: false, implicitPredicateType: "none", surfaceCopula: null, normalizationMethod: "none", transformationSteps: [] };
  if (!originalText || !topic) return none;

  const pronounMatch = originalText.match(STARTING_PRONOUN);
  if (pronounMatch) {
    const remainder = originalText.slice(pronounMatch[0].length);
    if (/^(?:is|are|was|were|has|have|had|contains?|causes?|shows?|seems?|appears?)\b/iu.test(remainder)) {
      const normalizedText = `${topic} ${remainder}`;
      return { ...none, normalizedText, topicConstructionType: "label_plus_complete_clause", dependsOnTopic: true, topicDependencyType: /^(?:this|that|these|those)\b/iu.test(pronounMatch[0]) ? "demonstrative_reference" : "pronoun_reference", usedTopicContext: true, transformationSteps: [{ type: "topic_label_injection", sourceText: pronounMatch[0].trim(), insertedText: topic, outputText: topic, start: 0, end: topic.length, ruleId: "topic-context-leading-reference" }] };
    }
  }

  if (EXPLICIT_SUBJECT.test(originalText)) return none;
  if (isEnumeration(originalText)) {
    return { ...none, normalizedText: `${topic} include ${lowerFirst(originalText)}`, topicConstructionType: "label_plus_enumeration", dependsOnTopic: true, topicDependencyType: "nominal_fragment", usedTopicContext: true, usedImplicitRelation: true, implicitPredicateType: "enumeration", surfaceCopula: "includes", normalizationMethod: "topic_enumeration_rule", transformationSteps: [{ type: "copula_insertion", insertedText: "include", outputText: "include", start: topic.length + 1, end: topic.length + 7, ruleId: "LABEL_PLUS_ENUMERATION" }] };
  }
  if (!FINITE_VERB.test(originalText) || startsWithAdjective(originalText) || startsWithMeasurement(originalText)) {
    const { copula } = chooseTopicCopula(topic);
    if (startsWithMeasurement(originalText)) {
      return { ...none, normalizedText: `The ${topic} ${copula} ${originalText}`, topicConstructionType: "label_plus_measurement_fragment", dependsOnTopic: true, topicDependencyType: "measurement_fragment", usedTopicContext: true, usedImplicitRelation: true, implicitPredicateType: "copular_measurement", surfaceCopula: copula, normalizationMethod: "topic_measurement_rule", transformationSteps: [{ type: "topic_article_insertion", insertedText: "The", outputText: "The", start: 0, end: 3, ruleId: "TOPIC_COMMON_NOUN_DEFINITE_ARTICLE" }, { type: "copula_insertion", insertedText: copula, outputText: copula, start: `The ${topic} `.length, end: `The ${topic} ${copula}`.length, ruleId: "LABEL_PLUS_MEASUREMENT_FRAGMENT" }] };
    }
    const propertyLike = startsWithAdjective(originalText) && !/^(?:normal|abnormal|characterized|originating)\s+rhythm\b/iu.test(originalText);
    const body = ARTICLE.test(originalText) ? lowerFirst(originalText) : originalText;
    const massNoun = startsWithMassNoun(originalText);
    const article = ARTICLE.test(originalText) ? "" : (propertyLike || massNoun ? "" : (copula === "are" ? "the " : "a "));
    const subject = propertyLike ? `The ${topic}` : topic;
    const finalText = `${subject} ${copula} ${article}${propertyLike || article || massNoun ? lowerFirst(body) : body}`;
    const constructionType = propertyLike ? (startsWithAdjective(originalText) && /^(?:characterized|originating|located|formed|connected)/iu.test(originalText) ? "label_plus_participial_fragment" : "label_plus_adjectival_fragment") : "label_plus_nominal_fragment";
    const predicateType = propertyLike ? (constructionType === "label_plus_adjectival_fragment" ? "copular_property" : "copular_classification") : "copular_classification";
    const copulaStart = `${subject} `.length;
    const steps = [{ type: "copula_insertion", insertedText: copula, outputText: copula, start: copulaStart, end: copulaStart + copula.length, ruleId: constructionType.toUpperCase() }];
    if (article) {
      const articleStart = `${subject} ${copula} `.length;
      steps.push({ type: "article_insertion", insertedText: article.trim(), outputText: article.trim(), start: articleStart, end: articleStart + article.trim().length, ruleId: "BARE_SINGULAR_COUNT_NOUN" });
    }
    return { ...none, normalizedText: finalText, topicConstructionType: constructionType, dependsOnTopic: true, topicDependencyType: propertyLike ? "property_fragment" : "nominal_fragment", usedTopicContext: true, usedImplicitRelation: true, implicitPredicateType: predicateType, surfaceCopula: copula, normalizationMethod: constructionType === "label_plus_adjectival_fragment" ? "topic_adjectival_fragment_rule" : constructionType === "label_plus_participial_fragment" ? "topic_participial_fragment_rule" : "topic_nominal_fragment_rule", transformationSteps: steps };
  }
  return none;
};

export const normalizeTopicSentences = (sentences, topicLabel) => (sentences || []).map((sentence) => normalizeTopicSentence(sentence, topicLabel));
