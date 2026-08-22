import { describe, expect, it } from "vitest";
import { detectTopicLabel, chooseTopicCopula, analyzeTopicBodyFragment } from "./topicLabelDetector";
import { normalizeTopicSentence } from "./topicSentenceNormalizer";

describe("topic label detection", () => {
  it("extracts a topic and body", () => {
    const result = detectTopicLabel("Sinus rhythm: Normal rhythm that originates from the sinus node.");
    expect(result.detected).toBe(true);
    expect(result.topicLabel).toBe("Sinus rhythm");
    expect(result.bodyText).toBe("Normal rhythm that originates from the sinus node.");
  });

  it("rejects ordinary clause, quotation, ratio, time, and discourse colons", () => {
    for (const text of [
      "The reason is simple: the valve is narrowed.",
      "The patient said: \u201cI feel dizzy.\u201d",
      "The ratio was 1:2.",
      "The medication was given at 08:30.",
      "Warning: Do not administer this drug.",
    ]) expect(detectTopicLabel(text).detected).toBe(false);
  });

  it("classifies measurement and property labels", () => {
    expect(detectTopicLabel("PR interval: 120\u201320 milliseconds.").classification).toBe("measurement_label");
    expect(detectTopicLabel("P wave: Upright in leads II, III, and aVF.").classification).toBe("property_label");
  });

  it("distinguishes relative-clause verbs from a main predicate", () => {
    expect(analyzeTopicBodyFragment("Normal rhythm that originates from the sinus node.")).toMatchObject({
      hasFiniteVerb: true, finiteVerbScope: "relative_clause", hasMainClausePredicate: false, phraseType: "nominal",
    });
    expect(analyzeTopicBodyFragment("The rhythm originates from the sinus node.")).toMatchObject({
      hasFiniteVerb: true, finiteVerbScope: "main_clause", hasMainClausePredicate: true, phraseType: "complete_clause",
    });
  });
});

describe("topic sentence normalization", () => {
  it("normalizes nominal, property, measurement, pronoun, and independent sentences", () => {
    expect(normalizeTopicSentence("Normal rhythm originating from the sinus node.", "Sinus rhythm").normalizedText)
      .toBe("Sinus rhythm is a normal rhythm originating from the sinus node.");
    expect(normalizeTopicSentence("Upright in leads II, III, and aVF.", "P wave").normalizedText)
      .toBe("The P wave is upright in leads II, III, and aVF.");
    expect(normalizeTopicSentence("120\u201320 milliseconds.", "PR interval").normalizedText)
      .toBe("The PR interval is 120\u201320 milliseconds.");
    expect(normalizeTopicSentence("Blood pumped by the heart.", "Cardiac output").normalizedText)
      .toBe("Cardiac output is blood pumped by the heart.");
    expect(normalizeTopicSentence("It is characterized by a P wave.", "Sinus rhythm").normalizedText)
      .toBe("Sinus rhythm is characterized by a P wave.");
    expect(normalizeTopicSentence("The sinoatrial node initiates the impulse.", "Sinus rhythm").dependsOnTopic)
      .toBe(false);
  });

  it("preserves plural topic agreement", () => {
    expect(chooseTopicCopula("Atria").copula).toBe("are");
    expect(normalizeTopicSentence("Upper chambers of the heart.", "Atria").normalizedText)
      .toBe("Atria are the upper chambers of the heart.");
  });
});
