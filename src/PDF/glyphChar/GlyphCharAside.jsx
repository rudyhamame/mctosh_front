import React, { useEffect, useLayoutEffect, useMemo, useState } from "react";
import "./glyphChar.css";
import { downloadGlyphCharPageReport } from "./glyphCharAnalysisClient.js";
import { finalPredictionCharacter } from "./glyphCharComparison.js";
import { deriveGlyphCharCounters, glyphResultState } from "./glyphCharCounters.js";

const EyeBigIcon = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={24} height={24} fill="currentColor" viewBox="0 0 24 24" {...props}>
    {/* Boxicons v3.0.8 · https://boxicons.com · https://docs.boxicons.com/free */}
    <path d="M12 8a4 4 0 1 0 0 8 4 4 0 1 0 0-8" />
    <path d="M12 4c-7.67 0-9.94 7.65-9.96 7.73-.05.18-.05.37 0 .55.02.08 2.3 7.73 9.96 7.73s9.94-7.65 9.96-7.73c.05-.18.05-.37 0-.55C21.94 11.65 19.66 4 12 4m0 14c-5.47 0-7.51-4.77-7.95-6 .44-1.23 2.48-6 7.95-6s7.51 4.78 7.95 6c-.44 1.23-2.48 6-7.95 6" />
  </svg>
);

const EnvelopeIcon = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={24} height={24} fill="currentColor" viewBox="0 0 24 24" {...props}>
    {/* Boxicons v3.0.8 · https://boxicons.com · https://docs.boxicons.com/free */}
    <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2m0 2v.51l-8 6.22-8-6.22V6zM4 18V9.04l7.39 5.74c.18.14.4.21.61.21s.43-.07.61-.21L20 9.03v8.96H4Z" />
  </svg>
);

const InfoSquareIcon = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={24} height={24} fill="currentColor" viewBox="0 0 24 24" {...props}>
    {/* Boxicons v3.0.8 · https://boxicons.com · https://docs.boxicons.com/free */}
    <path d="M11 11h2v6h-2zm0-4h2v2h-2z" />
    <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2m0 16H5V5h14z" />
  </svg>
);

const RefreshCcwDotIcon = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={24} height={24} fill="currentColor" viewBox="0 0 24 24" {...props}>
    {/* Boxicons v3.0.8 · https://boxicons.com · https://docs.boxicons.com/free */}
    <path d="M12 9a3 3 0 1 0 0 6 3 3 0 1 0 0-6" />
    <path d="M18.13 17.13c-.15.18-.31.36-.48.52-.73.74-1.59 1.31-2.54 1.71-1.97.83-4.26.83-6.23 0-.95-.4-1.81-.98-2.54-1.72a7.8 7.8 0 0 1-1.71-2.54c-.42-.99-.63-2.03-.63-3.11H2c0 1.35.26 2.66.79 3.89.5 1.19 1.23 2.26 2.14 3.18.92.92 1.99 1.64 3.18 2.14 1.23.52 2.54.79 3.89.79s2.66-.26 3.89-.79c1.19-.5 2.26-1.22 3.18-2.14.17-.17.32-.35.48-.52L22 20.99v-6h-6l2.13 2.13Zm.94-12.2a9.9 9.9 0 0 0-3.18-2.14 10.12 10.12 0 0 0-7.79 0c-1.19.5-2.26 1.23-3.18 2.14-.17.17-.32.35-.48.52L1.99 3v6h6L5.86 6.87c.15-.18.31-.36.48-.52.73-.74 1.59-1.31 2.54-1.71 1.97-.83 4.26-.83 6.23 0 .95.4 1.81.98 2.54 1.72.74.73 1.31 1.59 1.71 2.54.42.99.63 2.03.63 3.11h2c0-1.35-.26-2.66-.79-3.89-.5-1.19-1.23-2.26-2.14-3.18Z" />
  </svg>
);

const FILTERS = [
  ["ALL", "All"], ["MATCH", "Predicted / match"], ["DISAGREEMENT", "Disagreements"],
  ["AMBIGUOUS", "Ambiguous"], ["UNPREDICTABLE", "Unpredictable"], ["UNAVAILABLE", "Unavailable"],
  ["OPEN_SET_UNCERTAIN", "Open-set uncertain"], ["OUT_OF_VOCABULARY", "Out of vocabulary"],
  ["UNRESOLVED", "Unresolved"], ["NO_GIVEN_CHAR", "No Given"], ["NO_VISIBLE_GLYPH", "No visible glyph"],
  ["OBSERVE_ONLY", "Observe only"], ["REVIEW_REQUIRED", "Review required"], ["ELIGIBLE_WITH_PROVENANCE", "Eligible"], ["HUMAN_ASSERTED", "Human asserted"],
];
const stateSymbol = (state) => ({ MATCH: "✓", DISAGREEMENT: "⚠", AMBIGUOUS: "?", NO_GIVEN_CHAR: "—", NO_VISIBLE_GLYPH: "∅", UNPREDICTABLE: "×", UNAVAILABLE: "∅", OPEN_SET_UNCERTAIN: "?", OUT_OF_VOCABULARY: "∅", UNRESOLVED: "?", MULTI_CHAR_GLYPH: "≠" }[state] || "·");
const shownChar = (value) => value === " " ? "SPACE" : value == null || value === "" ? "∅" : value;
const documentExtractionCompleteness = (processedPages, totalPages) => {
  const processed = Math.max(0, Number(processedPages) || 0);
  const total = Math.max(0, Number(totalPages) || 0);
  if (!processed || !total) return "NOT EXTRACTED";
  if (processed >= total) return "FULLY EXTRACTED";
  return "PARTIALLY EXTRACTED";
};
const implicitPipelineStatusLabel = (extraction, documentPageCount) => {
  const totalPages = Number(extraction?.pageCount || documentPageCount) || 0;
  const charsProcessedPages = Number(extraction?.processedPages || 0);
  const implicitProcessedPages = extraction?.implicitDefinitionsProcessedPages != null
    ? Number(extraction.implicitDefinitionsProcessedPages)
    : (extraction?.pages || []).filter((page) => page.implicitDefinitionsComplete).length;
  return `CHARS ${documentExtractionCompleteness(charsProcessedPages, totalPages)} · GLYPH ${documentExtractionCompleteness(implicitProcessedPages, totalPages)}`;
};
const retrievalProgressMessage = (progress) => {
  const value = Math.max(0, Math.min(100, Number(progress) || 0));
  if (value >= 100) return "Layer 1 data retrieved.";
  if (value >= 85) return "Preparing the Layer 1 dashboard…";
  if (value >= 50) return "Retrieving saved glyph-definition and analysis metadata…";
  if (value >= 15) return "Retrieving persisted character counters…";
  return "Connecting to the evidence database…";
};
const pct = (value) => `${(Math.max(0, Number(value) || 0) * 100).toFixed(1)}%`;
const predictionMetric = (prediction) => prediction?.confidence ?? prediction?.modelScore;
const charClassFor = (character) => {
  if (/^\p{L}$/u.test(character)) return "letters";
  if (/^\p{N}$/u.test(character)) return "numbers";
  if (/^\p{S}$/u.test(character)) return "symbols";
  if (/^\p{P}$/u.test(character)) return "punctuation";
  if (/^[\s\p{Z}]$/u.test(character)) return "whitespace";
  return "other";
};
const whitespaceClassFor = (character) => {
  if (character === " ") return "ordinarySpace";
  if (character === "\t") return "tab";
  if (character === "\n") return "newline";
  if (character === "\r") return "carriageReturn";
  if (character === "\u00a0") return "nonBreakingSpace";
  if (character === "\u2003") return "emSpace";
  if (character === "\u2002") return "enSpace";
  if (character === "\u2009") return "thinSpace";
  return "otherUnicodeSpacing";
};
const unicodeCodePointKey = (character) => {
  const codePoint = String(character || "").codePointAt(0);
  return codePoint == null ? null : `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
};
const registeredEmbeddedFontFaces = new Set();
const normalizedPdfFontName = (value) => String(value || "")
  .replace(/^[A-Z]{6}\+/u, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/gu, "");
const registerPdfFontFace = async (fontObject) => {
  const family = String(fontObject?.loadedName || "").trim();
  if (!family || !fontObject?.data || typeof FontFace !== "function" || !document.fonts?.add) return null;
  if (registeredEmbeddedFontFaces.has(family)) return family;
  const face = new FontFace(family, fontObject.data, {
    weight: fontObject?.black ? "900" : fontObject?.bold ? "700" : "400",
    style: fontObject?.italic ? "italic" : "normal",
  });
  await face.load();
  document.fonts.add(face);
  registeredEmbeddedFontFaces.add(family);
  return family;
};
const unicodeCharacterPreview = (codePointKey) => {
  const codePoint = Number.parseInt(String(codePointKey).replace(/^U\+/i, ""), 16);
  if (!Number.isFinite(codePoint)) return "unknown character";
  const character = String.fromCodePoint(codePoint);
  if (/^\p{M}$/u.test(character)) return `◌${character}`;
  if (/^\p{Cc}$/u.test(character)) return "control character";
  if (/^\p{Cf}$/u.test(character)) return "invisible format character";
  if (/^\p{Cs}$/u.test(character)) return "surrogate code unit";
  if (/^\p{Co}$/u.test(character)) return `private-use “${character}”`;
  return `“${character}”`;
};
const glyphPrediction = (glyph) => glyph?.prediction
  || glyph?.visualEvidence?.raster?.recognition
  || glyph?.visualEvidence?.raster?.prediction
  || glyph?.visualEvidence?.vector?.prediction
  || glyph?.visualEvidence?.vector?.recognition
  || null;
const predictionCharacter = (prediction) => finalPredictionCharacter(prediction);
const glyphComparison = (glyph) => {
  return glyphResultState(glyph);
};
const CV_STAGE_LABELS = [
  ["rendered", "Rendered crop"],
  ["blurred", "Gaussian blur"],
  ["threshold", "Otsu threshold"],
  ["tight", "Tight crop"],
  ["normalized", "96×96 normalized"],
  ["contours", "Detected contours"],
];

const EvidenceCandidates = ({ prediction }) => prediction?.candidates?.length > 0 && (
  <div className="glyph_visual_candidates">
    <h5>Model candidates</h5>
    {prediction.candidates.map((candidate) => {
      const character = candidate.char ?? candidate.value;
      const score = candidate.probability ?? candidate.modelScore ?? candidate.confidence;
      return <div key={character}><b>{shownChar(character)}</b><span>{pct(score)}</span></div>;
    })}
  </div>
);

const RecognitionPanel = ({ title, prediction, showScore = true }) => {
  const [infoOpen, setInfoOpen] = useState(null);
  return (
    <section className="glyph_character_recognition">
      <header><h5>{title}</h5><small>Character recognition · {prediction?.modelName || "model unavailable"} {prediction?.modelVersion || ""}</small></header>
      <div className="glyph_visual_prediction">
        <small>{prediction?.openSetAssessment?.status === "IN_VOCABULARY" ? title : "Final evidence status"}</small><strong>{shownChar(predictionCharacter(prediction))}</strong>
        {showScore && <span>{predictionMetric(prediction) != null
          ? `${prediction.probabilitiesCalibrated ? "Model confidence" : "Model score"} · ${pct(predictionMetric(prediction))}`
          : "Unavailable"}</span>}
      </div>
      <dl className="glyph_visual_evidence_metrics">
        <dt className="glyph_evidence_term">Closed-set top candidate
          <button type="button" className="glyph_evidence_info" aria-label="Explain closed-set top candidate" onClick={() => setInfoOpen((open) => open === "closed" ? null : "closed")}><InfoSquareIcon /></button>
          {infoOpen === "closed" && <span className="glyph_evidence_note">The model’s highest-scoring character from its predefined list of known characters. It is the best match in that list, not a guarantee that the glyph is correct.</span>}
        </dt>
        <dd>{shownChar(prediction?.closedSetTopCandidate)}</dd>
        <dt className="glyph_evidence_term">Open-set assessment
          <button type="button" className="glyph_evidence_info" aria-label="Explain open-set assessment" onClick={() => setInfoOpen((open) => open === "open" ? null : "open")}><InfoSquareIcon /></button>
          {infoOpen === "open" && <span className="glyph_evidence_note">Checks whether the glyph resembles any character in the model’s known vocabulary. IN_VOCABULARY means it likely matches a known character; OUT_OF_VOCABULARY means it does not reliably match; UNCERTAIN means the evidence is insufficient; UNAVAILABLE means no assessment was produced.</span>}
        </dt>
        <dd>{prediction?.openSetAssessment?.status || "UNAVAILABLE"}</dd>
      </dl>
      <EvidenceCandidates prediction={prediction} />
    </section>
  );
};

const VECTOR_MORPHOLOGY_DEFINITIONS = [
  ["Contours", "Connected boundary paths that describe the outside and inside of a glyph outline."],
  ["Closed contours", "Contours whose endpoint joins their starting point, enclosing a region."],
  ["Open contours", "Contours with distinct endpoints; they do not enclose an area by themselves."],
  ["Counters", "Enclosed negative spaces inside a glyph, such as the spaces in A, B, or O."],
  ["Curves", "Bezier curve segments used to describe rounded portions of an outline."],
  ["Line segments", "Straight outline segments between points in the glyph path."],
  ["Aspect ratio", "The glyph outline width divided by its height."],
];

const LAYER1_TERM_DEFINITIONS = {
  "Glyph instances": "One occurrence of a glyph definition on a page. Repeated instances can share one shape while having different positions, sizes, or transforms.",
  "Unique definitions": "The reusable, font-specific glyph shapes found in this scope. A definition is identified by its font reference and glyph ID.",
  "Studied": "Instances for which Layer 1 completed an evidence record. This does not guarantee a usable character prediction.",
  "Displayed rows": "The number of glyph result rows currently shown after the active result filter is applied.",
  "Non-row instances": "Glyph instances in scope that are not currently represented by a displayed result row.",
  "Font reference": "The PDF's internal identifier for a font resource. It is required with a glyph ID because the same ID can refer to different shapes in different fonts.",
  "Glyph ID": "The number a particular font assigns to a drawable shape. It has meaning only within that font; for example, ID 36 may be A in one font and a different shape in another.",
  "Cached prediction": "When instances share a glyph definition, the recognizer can analyze that shape once and reuse the prediction for the other instances.",
  "Vector cache": "Stored vector morphology and outline evidence. It is separate from browser visual-recognition predictions.",
  "Total glyph instances": "The number of extracted character occurrences that have an ordered Implicit Glyph Index row in the current scope.",
  "Average instances / definition": "The total mapped glyph instances divided by the number of unique reusable glyph definitions.",
  "Font Families": "Distinct PDF font families referenced by the extracted characters and their glyph definitions.",
  "Vector source": "Whether a reusable glyph definition includes an extracted vector outline from its PDF font program.",
  "Vector source available": "Glyph definitions for which a usable vector outline was extracted from the PDF font program.",
  "Vector source unavailable": "Glyph definitions for which no usable vector outline could be extracted.",
  "Definition type": "The PDF font-outline structure used by a glyph: simple, composite, or unknown/unsupported.",
  "Simple": "A glyph definition drawn directly from its own outline contours.",
  "Composite": "A glyph definition assembled from references to one or more component glyphs.",
  "Unknown / unsupported": "A glyph whose definition format could not be identified or is not supported by the extractor.",
  "Predicted": "A glyph for which the recognizer produced an accepted character prediction.",
  "Ambiguous": "A glyph with multiple plausible character predictions and no sufficiently decisive winner.",
  "Unpredictable": "A glyph that was analyzed but could not be assigned a reliable character prediction.",
  "Unavailable": "Evidence or recognition output that could not be produced for this glyph.",
  "No visible glyph": "An extracted character occurrence without a visible glyph box suitable for visual analysis.",
  "In vocabulary": "The glyph is sufficiently similar to a character represented in the recognizer's known vocabulary.",
  "Out of vocabulary": "The glyph does not reliably match any character in the recognizer's known vocabulary.",
  "Open-set uncertain": "The open-set check could not decide whether the glyph belongs to the known vocabulary.",
  "Observe only": "Evidence is retained for observation but is not admitted as a canonical character assertion.",
  "Review required": "The evidence needs human review before it can be admitted downstream.",
  "Eligible": "The evidence satisfies the automatic admission requirements and retains its provenance.",
  "Human asserted": "A human explicitly supplied or confirmed the admitted character.",
  "Full agreement": "PDF mapping, vector evidence, and raster evidence agree on the character.",
  "PDF mapping disagreement": "The PDF's character mapping conflicts with visual or structural glyph evidence.",
  "Vector/Raster disagreement": "Vector-outline and raster-image recognizers predict different characters.",
  "Unresolved": "Available evidence does not support a final resolved character.",
  "No Given Char": "The PDF extraction supplied no source character for comparison.",
  "Raster available": "A rasterized glyph image is available for visual recognition.",
  "Raster unavailable": "No usable rasterized glyph image is available.",
  "Vector available": "Vector outline morphology is available for the glyph.",
  "Vector unavailable": "Vector outline morphology is unavailable for the glyph.",
  "Letters": "Unicode characters classified as letters.",
  "Numbers": "Unicode characters classified as numbers.",
  "Symbols": "Unicode characters classified as symbols, such as mathematical or currency signs.",
  "Punctuation": "Unicode characters classified as punctuation marks.",
  "Whitespace": "Spacing and control characters that separate or format text.",
  "Other characters": "Extracted characters outside the letter, number, symbol, punctuation, and whitespace classes.",
  "Instances": "All Implicit Glyph Index rows represented by this definition-card summary.",
  "Glyph Definitions": "Unique reusable font-and-glyph identities observed in the extracted characters.",
  "Definitions reused": "Glyph definitions observed in more than one extracted character occurrence.",
};

const DashboardInfoLabel = ({ term, label = term }) => {
  const [open, setOpen] = useState(false);
  const explanation = LAYER1_TERM_DEFINITIONS[term] || `Observed count for ${label}.`;
  return <span className="glyph_evidence_term">{label}
    <button type="button" className="glyph_evidence_info" aria-label={`Explain ${label}`} onClick={(event) => { event.stopPropagation(); setOpen((value) => !value); }}><InfoSquareIcon /></button>
    {open && <span className="glyph_evidence_note">{explanation}</span>}
  </span>;
};

const Layer1InfoTerm = ({ term, label = term }) => {
  return <dt><DashboardInfoLabel term={term} label={label} /></dt>;
};

const DashboardBarChart = ({ title, items, onSelect }) => {
  const max = Math.max(1, ...items.map((item) => Number(item.value) || 0));
  return (
    <article className="glyph_dashboard_card">
      <header><h4>{title}</h4><small>Observed counts</small></header>
      {items.length ? <div className="glyph_dashboard_bars" role="list" aria-label={title}>
        {items.map((item) => <div key={item.label} role="button" tabIndex={item.value ? 0 : -1} aria-disabled={!item.value} className={`glyph_dashboard_bar_row${item.value ? "" : " is-disabled"}`} onClick={() => { if (item.value) onSelect?.(item); }} onKeyDown={(event) => { if (item.value && (event.key === "Enter" || event.key === " ")) onSelect?.(item); }}>
          <DashboardInfoLabel term={item.label} /><i><b style={{ width: `${Math.max(0, (Number(item.value) || 0) / max) * 100}%` }} /></i><strong>{Number(item.value || 0).toLocaleString()}</strong>
        </div>)}
      </div> : null}
    </article>
  );
};

const donutCountClass = (value) => {
  const length = Number(value || 0).toLocaleString().length;
  return length >= 10 ? "glyph_dashboard_donut_count--dense"
    : length >= 7 ? "glyph_dashboard_donut_count--compact"
      : "";
};

const DashboardDonut = ({ title, items, total }) => {
  const safeTotal = Math.max(1, Number(total) || items.reduce((sum, item) => sum + (Number(item.value) || 0), 0));
  let cursor = 0;
  const stops = items.map((item) => {
    const start = cursor;
    cursor += ((Number(item.value) || 0) / safeTotal) * 360;
    return `${item.color || "#6d8392"} ${start}deg ${cursor}deg`;
  }).join(", ");
  return (
    <article className="glyph_dashboard_card glyph_dashboard_donut_card">
      <header><h4>{title}</h4><small>Current distribution</small></header>
      <div className="glyph_dashboard_donut_body">
        <div className="glyph_dashboard_donut" style={{ background: `conic-gradient(${stops || "#303943 0 360deg"})` }}><strong className={donutCountClass(total)}>{Number(total || 0).toLocaleString()}</strong><small>Total</small></div>
        <div className="glyph_dashboard_legend">{items.map((item) => <div key={item.label}><i style={{ background: item.color || "#6d8392" }} /><DashboardInfoLabel term={item.label} /><strong>{Number(item.value || 0).toLocaleString()}</strong></div>)}</div>
      </div>
    </article>
  );
};

const emptyDefinitionSummary = {
  observedUnique: 0,
  observedInstances: 0,
  fontFamilies: 0,
  fontFamilyNames: [],
  averageInstancesPerDefinition: null,
  reuse: { usedOnce: 0, reused: 0 },
  vectorSource: { available: 0, unavailable: 0 },
  definitionType: { simple: 0, composite: 0, unknown: 0 },
  fontProgramDefinitions: { available: false },
  partial: false,
};

const indexedFontFamilies = (definitions = []) => {
  const families = new Map();
  definitions.forEach((row) => {
    const name = String(row.font || row.fontRef || "").replace(/^[A-Z]{6}\+/i, "").trim();
    const key = name.toLocaleLowerCase();
    if (key && !families.has(key)) families.set(key, name);
  });
  return [...families.values()].sort((left, right) => left.localeCompare(right));
};

const implicitDefinitionAggregation = (definitions = [], partial = false) => {
  const observedUnique = definitions.length;
  const observedInstances = definitions.reduce((total, row) => total + Number(row.observedInstances || 0), 0);
  const usedOnce = definitions.filter((row) => Number(row.observedInstances || 0) === 1).length;
  const vectorAvailable = definitions.filter((row) => row.vectorSource === "available").length;
  const simple = definitions.filter((row) => row.definitionType === "simple").length;
  const composite = definitions.filter((row) => row.definitionType === "composite").length;
  const fontFamilyNames = indexedFontFamilies(definitions);
  const fontFamilies = fontFamilyNames.length;
  return {
    summary: {
      ...emptyDefinitionSummary,
      observedUnique,
      observedInstances,
      fontFamilies,
      fontFamilyNames,
      averageInstancesPerDefinition: observedUnique ? observedInstances / observedUnique : null,
      reuse: { usedOnce, reused: observedUnique - usedOnce },
      vectorSource: { available: vectorAvailable, unavailable: observedUnique - vectorAvailable },
      definitionType: { simple, composite, unknown: observedUnique - simple - composite },
      fontProgramDefinitions: { available: vectorAvailable > 0 },
      partial,
      source: "implicit-characters",
    },
    definitions,
  };
};

const DefinitionMetricsPie = ({ summary }) => {
  const metrics = [
    { label: "Instances", value: Number(summary.observedInstances || 0), color: "#2388d8" },
    { label: "Glyph Definitions", value: Number(summary.observedUnique || 0), color: "#7554d8" },
    { label: "Definitions reused", value: Number(summary.reuse?.reused || 0), color: "#41a66b" },
  ];
  const observedMetricTotal = metrics.reduce((total, metric) => total + metric.value, 0);
  const metricTotal = Math.max(1, observedMetricTotal);
  let cursor = 0;
  const stops = metrics.map((metric) => {
    const start = cursor;
    cursor += (metric.value / metricTotal) * 360;
    return `${metric.color} ${start}deg ${cursor}deg`;
  }).join(", ");
  return <div className="glyph_dashboard_definition_pie" aria-label="Glyph definition metrics pie chart">
    <div className="glyph_dashboard_donut" role="img" aria-label={metrics.map((metric) => `${metric.label}: ${metric.value}`).join(", ")} style={{ background: `conic-gradient(${observedMetricTotal ? stops : "#303943 0deg 360deg"})` }}>
      <strong className={donutCountClass(summary.observedUnique)}>{Number(summary.observedUnique || 0).toLocaleString()}</strong>
      <small>Definitions</small>
    </div>
    <div className="glyph_dashboard_definition_pie_legend">
      {metrics.map((metric) => <div key={metric.label}><i style={{ background: metric.color }} /><DashboardInfoLabel term={metric.label} /><strong>{metric.value.toLocaleString()}</strong></div>)}
    </div>
  </div>;
};

const GlyphDefinitionsCard = ({ state, onOpen }) => {
  const [infoOpen, setInfoOpen] = useState(false);
  const summary = state.summary || emptyDefinitionSummary;
  const indexedNames = indexedFontFamilies(state.definitions);
  const fontFamilyNames = indexedNames.length ? indexedNames : summary.fontFamilyNames || [];
  const fontFamilies = fontFamilyNames.length || Number(summary.fontFamilies || 0);
  const fontFamilyRows = Array.from({ length: Math.ceil(fontFamilyNames.length / 2) }, (_, rowIndex) => (
    fontFamilyNames.slice(rowIndex * 2, rowIndex * 2 + 2)
  ));
  const unique = Number(summary.observedUnique || 0);
  return <article className="glyph_dashboard_card glyph_dashboard_definitions_card">
    <header>
      <span><h4>Implicit Glyph Definitions</h4><small>Reusable font-and-glyph identities studied automatically from Implicit Characters</small></span>
      <span className="glyph_dashboard_definition_header_actions">
        <button type="button" className="glyph_evidence_info" aria-label="Explain Glyph Definitions" onClick={() => setInfoOpen((open) => !open)}><InfoSquareIcon /></button>
      </span>
      {infoOpen && <p className="glyph_dashboard_definition_note">A Glyph Definition is the reusable font-level visual design identified by its font program and glyph ID. Multiple rendered Glyph Instances may instantiate the same Glyph Definition.</p>}
    </header>
    <strong className="glyph_dashboard_chars_count glyph_dashboard_definition_total">{Number(state.instanceCount ?? summary.observedInstances ?? 0).toLocaleString()}</strong>
    <small className="glyph_dashboard_definition_total_label"><DashboardInfoLabel term="Total glyph instances" label="total glyph instances" /></small>
    <DefinitionMetricsPie summary={summary} />
    <dl className="glyph_dashboard_definition_stats glyph_dashboard_definition_average"><Layer1InfoTerm term="Average instances / definition" /><dd>{summary.averageInstancesPerDefinition == null ? "—" : Number(summary.averageInstancesPerDefinition).toFixed(2)}</dd></dl>
    <section className="glyph_dashboard_definition_group"><h5 className="glyph_dashboard_definition_group_heading"><DashboardInfoLabel term="Font Families" /><strong>{fontFamilies.toLocaleString()}</strong></h5><div className="glyph_dashboard_definition_font_table_wrap"><table className="glyph_dashboard_definition_font_table" aria-label="Extracted font families"><tbody>{fontFamilyRows.length ? fontFamilyRows.map((row, rowIndex) => <tr key={`${rowIndex}:${row.join(":")}`}>{row.map((fontName) => <td key={fontName} title={fontName}>{fontName}</td>)}{row.length < 2 && <td aria-hidden="true" />}</tr>) : <tr><td colSpan="2" className="glyph_dashboard_definition_font_empty">No font families identified</td></tr>}</tbody></table></div></section>
    <section className="glyph_dashboard_definition_group"><h5><DashboardInfoLabel term="Vector source" /></h5><dl className="glyph_dashboard_definition_stats"><Layer1InfoTerm term="Vector source available" label="Available" /><dd>{Number(summary.vectorSource?.available || 0).toLocaleString()}</dd><Layer1InfoTerm term="Vector source unavailable" label="Unavailable" /><dd>{Number(summary.vectorSource?.unavailable || 0).toLocaleString()}</dd></dl></section>
    <section className="glyph_dashboard_definition_group"><h5><DashboardInfoLabel term="Definition type" /></h5><dl className="glyph_dashboard_definition_stats"><Layer1InfoTerm term="Simple" /><dd>{Number(summary.definitionType?.simple || 0).toLocaleString()}</dd><Layer1InfoTerm term="Composite" /><dd>{Number(summary.definitionType?.composite || 0).toLocaleString()}</dd><Layer1InfoTerm term="Unknown / unsupported" /><dd>{Number(summary.definitionType?.unknown || 0).toLocaleString()}</dd></dl></section>
    {summary.fontProgramDefinitions?.available && <p className="glyph_dashboard_definition_inventory">Font inventory: {Number(summary.fontProgramDefinitions.observedInDocument || 0).toLocaleString()} observed / {Number(summary.fontProgramDefinitions.totalAvailable || 0).toLocaleString()} available · {Number(summary.fontProgramDefinitions.unusedInDocument || 0).toLocaleString()} unused</p>}
    {state.status === "error" && <p className="glyph_dashboard_definition_error">{state.error}</p>}
  </article>;
};

const GlyphDefinitionDrawer = ({ state, selected, instanceState, pageViewport, pageSize, pdfDoc, onClose, onSelectDefinition, onSelectInstance, onPageChange }) => {
  const [page, setPage] = useState(0);
  const [textPageOpen, setTextPageOpen] = useState(false);
  const [embeddedFonts, setEmbeddedFonts] = useState({ byName: {}, bySequence: {}, loaded: 0 });
  const definitionRows = useMemo(() => state.definitions.flatMap((definition) => {
    const characters = definition.characters?.length ? definition.characters : [{ unicode: "UNMAPPED", value: "", count: 0 }];
    return characters.map((character, characterIndex) => ({ definition, character, characterIndex }));
  }), [state.definitions]);
  const renderAllPageRows = true;
  const tablePageSize = Math.max(1, definitionRows.length);
  const pageCount = Math.max(1, Math.ceil(definitionRows.length / tablePageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleDefinitions = definitionRows.slice(
    currentPage * tablePageSize,
    (currentPage + 1) * tablePageSize,
  );
  const originalPageWidth = Math.max(1, Number(pageSize?.width || 0) || Number(pageViewport?.width || 0) / Math.max(0.0001, Number(pageViewport?.scale || 1)));
  const originalPageHeight = Math.max(1, Number(pageSize?.height || 0) || Number(pageViewport?.height || 0) / Math.max(0.0001, Number(pageViewport?.scale || 1)));

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount - 1));
  }, [pageCount]);

  useEffect(() => {
    let cancelled = false;
    const pageNumber = Number(definitionRows[0]?.definition?.pageNumber);
    if (!textPageOpen || !pdfDoc?.getPage || !Number.isInteger(pageNumber)) {
      setEmbeddedFonts({ byName: {}, bySequence: {}, loaded: 0 });
      return () => { cancelled = true; };
    }
    const resolveEmbeddedFonts = async () => {
      const pdfPage = await pdfDoc.getPage(pageNumber);
      const content = await pdfPage.getTextContent({ disableNormalization: true });
      const byName = {};
      const itemFonts = {};
      const fontNames = [...new Set(content.items.map((item) => item?.fontName).filter(Boolean))];
      let loaded = 0;
      await Promise.all(fontNames.map(async (fontName) => {
        const style = content.styles?.[fontName] || {};
        let fontObject = null;
        try {
          if (pdfPage.commonObjs?.has(fontName)) fontObject = pdfPage.commonObjs.get(fontName);
        } catch {
          fontObject = null;
        }
        let family = String(fontObject?.loadedName || style.fontFamily || fontObject?.fallbackName || "").trim();
        try {
          const registeredFamily = await registerPdfFontFace(fontObject);
          if (registeredFamily) family = registeredFamily;
        } catch {
          // PDF.js can expose unsupported or damaged programs. Its resolved
          // family/fallback remains preferable to replacing every font.
        }
        if (!family) return;
        if (fontObject?.loadedName) loaded += 1;
        const fontSpec = {
          family,
          weight: fontObject?.black ? 900 : fontObject?.bold ? 700 : 400,
          style: fontObject?.italic ? "italic" : "normal",
        };
        itemFonts[fontName] = fontSpec;
        [fontName, style.fontFamily, fontObject?.name, fontObject?.loadedName].forEach((name) => {
          const key = normalizedPdfFontName(name);
          if (key) byName[key] = fontSpec;
        });
      }));
      const sourceCharacters = content.items.flatMap((item) => Array.from(String(item?.str || ""), (value) => ({
        value,
        font: itemFonts[item?.fontName] || null,
      })));
      const bySequence = {};
      let sourceIndex = 0;
      definitionRows.forEach(({ definition, character }) => {
        const value = String(character?.value || "");
        if (!value) return;
        if (sourceCharacters[sourceIndex]?.value !== value) {
          const matchIndex = sourceCharacters.findIndex((candidate, index) => index >= sourceIndex && index <= sourceIndex + 16 && candidate.value === value);
          if (matchIndex >= 0) sourceIndex = matchIndex;
        }
        const sourceCharacter = sourceCharacters[sourceIndex];
        if (sourceCharacter?.value === value && sourceCharacter.font) bySequence[definition.sequenceIndex] = sourceCharacter.font;
        if (sourceCharacter?.value === value) sourceIndex += 1;
      });
      if (!cancelled) setEmbeddedFonts({ byName, bySequence, loaded });
    };
    resolveEmbeddedFonts().catch(() => {
      if (!cancelled) setEmbeddedFonts({ byName: {}, bySequence: {}, loaded: 0 });
    });
    return () => { cancelled = true; };
  }, [definitionRows, pdfDoc, textPageOpen]);

  return (
  <section className="glyph_definition_drawer" role="dialog" aria-modal="false" aria-labelledby="glyph_definition_drawer_title">
    <header><span><small>AUTHORITATIVE PERSISTED EVIDENCE</small><h3 id="glyph_definition_drawer_title">Index</h3></span><div className="glyph_definition_drawer_actions"><button type="button" onClick={() => setTextPageOpen(true)} aria-label="Open implicit text page" title="Open implicit text page"><i className="bx bx-file" aria-hidden="true" /></button><button type="button" onClick={onClose} aria-label="Close glyph definition index"><i className="bx bx-x" aria-hidden="true" /></button></div></header>
    <div className="glyph_definition_drawer_body">
      <div className="glyph_definition_table_wrap">
        <div className="glyph_definition_table_scroll">
        <table className="glyph_definition_table">
          <thead><tr><th>Order</th><th>Page</th><th>Block</th><th>Line</th><th>Span</th><th>Char</th><th>Bold</th><th>Italic</th><th>Underline</th><th>Character</th><th>Unicode</th><th>Data type</th><th>Definition ID</th><th>Font</th><th>Font program hash</th><th>Glyph ID</th><th>Glyph name</th><th>Observed instances</th><th>Vector source</th><th>Definition type</th></tr></thead>
          <tbody>{visibleDefinitions.map(({ definition: row, character, characterIndex }) => <tr key={`${row.pageNumber}:${row.sequenceIndex}:${row.definitionId}:${characterIndex}`} className={selected?.definitionId === row.definitionId ? "is-selected" : ""} onClick={() => onSelectDefinition(row)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSelectDefinition(row); }}>
            <td>{Number.isFinite(Number(row.textOrder)) ? Number(row.textOrder).toLocaleString() : Number.isFinite(Number(row.sequenceIndex)) ? Number(row.sequenceIndex).toLocaleString() : "—"}</td><td>{row.pageNumber ?? "—"}</td><td>{row.blockIndex ?? "—"}</td><td>{row.lineIndex ?? "—"}</td><td>{row.spanIndex ?? "—"}</td><td>{row.charIndex ?? "—"}</td><td>{row.bold ? "YES" : "NO"}</td><td>{row.italic ? "YES" : "NO"}</td><td>{row.underline ? "YES" : "NO"}</td><td>{shownChar(character.value)}</td><td>{character.unicode || "UNMAPPED"}</td><td>{character.dataType || charClassFor(character.value)}</td><td title={row.definitionId}>{row.definitionId}</td><td>{row.font || row.fontRef || "—"}</td><td title={row.fontProgramSha256 || ""}>{row.fontProgramSha256 || "fallback identity"}</td><td>{row.glyphId ?? "—"}</td><td>{row.glyphName || "—"}</td><td>{Number(row.observedInstances || 0).toLocaleString()}</td><td>{row.vectorSource}</td><td>{row.definitionType}</td>
          </tr>)}</tbody>
        </table>
        </div>
      </div>
      <aside className="glyph_definition_instances">
        <header><h4>Definition instances</h4><small>{selected ? selected.definitionId : "Select a definition"}</small></header>
        {selected && <figure className="glyph_definition_vector_preview">
          {selected.vectorEvidence?.outline?.svgPath
            ? <svg viewBox={selected.vectorEvidence.outline.viewBox || "0 0 100 100"} role="img" aria-label={`Vector outline for ${selected.glyphName || `glyph ${selected.glyphId}`}`}><path d={selected.vectorEvidence.outline.svgPath} /></svg>
            : <span>{selected.vectorUnavailableReason || "Vector outline unavailable for this definition."}</span>}
          <figcaption><strong>{selected.glyphName || `Glyph ${selected.glyphId ?? "—"}`}</strong><small>{selected.font || selected.fontRef || "Unknown font"}</small></figcaption>
        </figure>}
        {instanceState.status === "loading" && <p>Loading persisted locations…</p>}
        {instanceState.status === "error" && <p className="glyph_dashboard_definition_error">{instanceState.error}</p>}
        {instanceState.status === "ready" && !instanceState.instances.length && <p>No instances found in this scope.</p>}
        {instanceState.instances.map((instance) => <button type="button" key={`${instance.pageNumber}:${instance.glyphInstanceId}`} onClick={() => onSelectInstance(instance)}><strong>Page {instance.pageNumber}</strong><span>Instance {instance.instanceIndex + 1} · {shownChar(instance.givenChar)}</span><small>{instance.bbox ? JSON.stringify(instance.bbox) : "No bounding box"}</small></button>)}
      </aside>
    </div>
    {textPageOpen && <div className="glyph_definition_text_page_layer" role="dialog" aria-modal="true" aria-label="Implicit text page">
      <div className="glyph_definition_text_page_toolbar"><strong>Implicit text · Page {definitionRows[0]?.definition?.pageNumber ?? "—"}</strong><small>{definitionRows.length.toLocaleString()} extracted characters · {Math.round(originalPageWidth)} × {Math.round(originalPageHeight)} pt · {embeddedFonts.loaded.toLocaleString()} embedded fonts loaded</small><button type="button" onClick={() => setTextPageOpen(false)} aria-label="Close implicit text page"><i className="bx bx-x" aria-hidden="true" /></button></div>
      <div className="glyph_definition_text_page_scroll">
        <div className="glyph_definition_text_page" style={{ width: `${originalPageWidth}px`, height: `${originalPageHeight}px` }}>
          {definitionRows.map(({ definition: row, character, characterIndex }) => {
            const box = row.bbox;
            const x = Number(box?.x);
            const y = Number(box?.y);
            const width = Number(box?.width);
            const height = Number(box?.height);
            if (![x, y, width, height].every(Number.isFinite)) return null;
            const embeddedFont = embeddedFonts.bySequence[row.sequenceIndex]
              || embeddedFonts.byName[normalizedPdfFontName(row.font || row.fontRef)]
              || null;
            const fontFamily = embeddedFont?.family
              || row.font
              || row.fontRef
              || "sans-serif";
            return <span key={`${row.pageNumber}:${row.sequenceIndex}:${characterIndex}`} className="glyph_definition_text_page_char" style={{ left: `${x}px`, top: `${y}px`, minWidth: `${Math.max(1, width)}px`, height: `${Math.max(1, height)}px`, fontFamily, fontSize: `${Math.max(1, Number(row.fontSize) || height * .8)}px`, fontWeight: embeddedFont?.weight ?? (row.bold ? 700 : 400), fontStyle: embeddedFont?.style || (row.italic ? "italic" : "normal"), textDecoration: row.underline ? "underline" : "none" }}>{character.value || " "}</span>;
          })}
        </div>
      </div>
    </div>}
  </section>
  );
};

const CharClassesPie = ({ classes, whitespaceCounts, otherCharacterCounts, total }) => {
  const [whitespaceInfoOpen, setWhitespaceInfoOpen] = useState(null);
  const items = [
    ["Letters", classes.letters, "#2388d8"],
    ["Numbers", classes.numbers, "#7554d8"],
    ["Symbols", classes.symbols, "#ed8d24"],
    ["Punctuation", classes.punctuation, "#d94b5c"],
    ["Whitespace", classes.whitespace, "#41a66b"],
    ["Other characters", classes.other, "#778894"],
  ];
  const whitespaceItems = [
    ["ordinarySpace", "ordinary space"], ["tab", "tab"], ["newline", "newline"],
    ["carriageReturn", "carriage return"], ["nonBreakingSpace", "non-breaking space"],
    ["emSpace", "em space"], ["enSpace", "en space"], ["thinSpace", "thin space"],
    ["otherUnicodeSpacing", "other Unicode spacing characters"],
  ];
  const otherItems = Object.entries(otherCharacterCounts || {})
    .filter(([, count]) => Number(count || 0) > 0)
    .sort(([left], [right]) => Number.parseInt(left.slice(2), 16) - Number.parseInt(right.slice(2), 16));
  const safeTotal = Math.max(1, Number(total) || 0);
  let cursor = 0;
  const stops = items.map(([label, value, color]) => {
    const start = cursor;
    cursor += ((Number(value) || 0) / safeTotal) * 360;
    return `${color} ${start}deg ${cursor}deg`;
  }).join(", ");
  return <div className="glyph_dashboard_donut_body glyph_dashboard_chars_pie" aria-label="Character class distribution">
    <div className="glyph_dashboard_donut" style={{ background: `conic-gradient(${stops || "#303943 0 360deg"})` }}><strong className={donutCountClass(total)}>{Number(total || 0).toLocaleString()}</strong><small>Total</small></div>
    <div className="glyph_dashboard_legend">
      {items.map(([label, value, color]) => <React.Fragment key={label}>
        <div><i style={{ background: color }} /><DashboardInfoLabel term={label} /><strong>{Number(value || 0).toLocaleString()}</strong></div>
        {label === "Whitespace" && <div className="glyph_dashboard_whitespace_tree">
          {whitespaceItems.map(([key, whitespaceLabel], index) => <div key={key}><span className="glyph_dashboard_whitespace_label">{index === whitespaceItems.length - 1 ? "└──" : "├──"} {whitespaceLabel}{key === "nonBreakingSpace" && <><button type="button" className="glyph_evidence_info" aria-label="Explain non-breaking space" onClick={() => setWhitespaceInfoOpen((open) => open === key ? null : key)}><InfoSquareIcon /></button>{whitespaceInfoOpen === key && <span className="glyph_evidence_note">A non-breaking space (U+00A0) is a whitespace character that prevents an automatic line break at its position. It is commonly used to keep values and units, initials, or related words together on the same line.</span>}</>}</span><strong>{Number(whitespaceCounts?.[key] || 0).toLocaleString()}</strong></div>)}
        </div>}
        {label === "Other characters" && <div className="glyph_dashboard_other_tree">
          {otherItems.length > 0
            ? otherItems.map(([codePoint, count], index) => <div key={codePoint}><span>{index === otherItems.length - 1 ? "└──" : "├──"} <b>{codePoint}</b> · {unicodeCharacterPreview(codePoint)}</span><strong>{Number(count || 0).toLocaleString()}</strong></div>)
            : <div><span>└── No other Unicode characters</span><strong>0</strong></div>}
        </div>}
      </React.Fragment>)}
    </div>
  </div>;
};

const GlyphResultList = ({ glyphs, selectedId, onSelect, showPageNumber = true, simple = false, fullList = false, cellGrid = false }) => {
  if (cellGrid) {
    return (
      <div className="glyph_char_results glyph_char_results--cell-grid" role="grid" aria-label="Glyph result cells">
        {glyphs.map((glyph, index) => (
          <button
            type="button"
            role="gridcell"
            key={glyph.id}
            className={`glyph_char_result_cell glyph_char_result_cell--${String(glyphComparison(glyph) || "pending").toLowerCase()}${glyph.id === selectedId ? " is-selected" : ""}`}
            onClick={() => onSelect(glyph)}
            title={`${showPageNumber ? `Page ${glyph.pageNumber} · ` : ""}${glyphComparison(glyph)} · Glyph ID ${glyph.glyphId ?? "—"}`}
            aria-label={`${shownChar(glyph.given.value)}${showPageNumber ? `, page ${glyph.pageNumber}` : ""}`}
          >
            <strong>{shownChar(glyph.given.value)}</strong>
            <small>{showPageNumber ? `p.${glyph.pageNumber}` : `#${index + 1}`}</small>
          </button>
        ))}
      </div>
    );
  }
  const rowHeight = 46;
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(300);
  const resultsRef = React.useRef(null);
  useLayoutEffect(() => {
    if (!fullList || !resultsRef.current) return undefined;
    const updateHeight = () => setViewportHeight(Math.max(160, resultsRef.current.clientHeight));
    updateHeight();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(updateHeight) : null;
    observer?.observe(resultsRef.current);
    return () => observer?.disconnect();
  }, [fullList]);
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - 4);
  const end = Math.min(glyphs.length, start + Math.ceil(viewportHeight / rowHeight) + 8);
  return (
    <div ref={resultsRef} className={`glyph_char_results${fullList ? " glyph_char_results--viewport" : ""}`} style={fullList ? undefined : { height: viewportHeight }} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
      <div className="glyph_char_results_spacer" style={{ height: glyphs.length * rowHeight }}>
        {glyphs.slice(start, end).map((glyph, offset) => (
          <button
            type="button"
            key={glyph.id}
            className={`glyph_char_result glyph_char_result--${String(glyphComparison(glyph) || "pending").toLowerCase()}${glyph.id === selectedId ? " is-selected" : ""}`}
            style={{ top: (start + offset) * rowHeight, height: rowHeight }}
            onClick={() => onSelect(glyph)}
          >
            {simple
              ? <>
                  <span className="glyph_char_instance_index">{start + offset + 1}</span>
                  <span className="glyph_char_instance_glyph">{shownChar(glyph.given.value)}</span>
                  <span className="glyph_char_result_meta">{showPageNumber ? `p.${glyph.pageNumber} · ` : ""}Glyph ID {glyph.glyphId ?? "—"}</span>
                </>
              : <>
                  <span className="glyph_char_result_state">{stateSymbol(glyphComparison(glyph))}</span>
                  <span className="glyph_char_result_pair">{shownChar(glyph.given.value)} <i>→</i> {shownChar(finalPredictionCharacter(glyph.visualEvidence?.raster?.prediction || glyph.prediction))}</span>
                  <span className="glyph_char_result_meta">{showPageNumber ? `p.${glyph.pageNumber} · ` : ""}{glyphComparison(glyph)}</span>
                </>}
          </button>
        ))}
      </div>
    </div>
  );
};

const GlyphCharAside = ({ analysis, currentPage, pageCount, pageViewport, pdfDoc, onNavigatePage, onClose, onStartAnalysis, onResultsDeleted, onSelectGlyph }) => {
  const [scope, setScope] = useState("document");
  const [scopeMenuOpen, setScopeMenuOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("analysis");
  const [dashboardView, setDashboardView] = useState("overview");
  const [inspectorTab, setInspectorTab] = useState("vector");
  const [rasterStageIndex, setRasterStageIndex] = useState(0);
  const [morphologyInfoKey, setMorphologyInfoKey] = useState(null);
  const [filter, setFilter] = useState("ALL");
  const [confirmedChar, setConfirmedChar] = useState("");
  const [trainingState, setTrainingState] = useState({ status: "idle", message: "" });
  const [reportOpen, setReportOpen] = useState(false);
  const [reportOptions, setReportOptions] = useState({ profile: "standard", includeDebug: false, includeImages: false, imageProfile: "diagnostic" });
  const [reportState, setReportState] = useState({ status: "idle", message: "" });
  const [charsReextractState, setCharsReextractState] = useState({ status: "idle", message: "" });
  const [charsControlState, setCharsControlState] = useState({ status: "idle", action: null, message: "" });
  const [glyphDefinitionState, setGlyphDefinitionState] = useState({ status: "idle", summary: emptyDefinitionSummary, definitions: [], error: "" });
  const [glyphDefinitionIndexState, setGlyphDefinitionIndexState] = useState({ status: "idle", definitions: [], pagination: null, error: "" });
  const [glyphDefinitionDrawerOpen, setGlyphDefinitionDrawerOpen] = useState(false);
  const [selectedDefinition, setSelectedDefinition] = useState(null);
  const [definitionInstanceState, setDefinitionInstanceState] = useState({ status: "idle", instances: [], error: "" });
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  const { glyphs, charGlyphs = [], charExtraction = null, selectedGlyph, status, error, progress, retrievalStatus = "ready", retrievalProgress = 100 } = analysis;
  useEffect(() => {
    let cancelled = false;
    if (!pdfDoc?.getPage || !currentPage) {
      setPageSize({ width: 0, height: 0 });
      return () => { cancelled = true; };
    }
    pdfDoc.getPage(currentPage).then((pdfPage) => {
      if (cancelled) return;
      const viewport = pdfPage.getViewport({ scale: 1 });
      setPageSize({ width: Number(viewport.width) || 0, height: Number(viewport.height) || 0 });
    }).catch(() => {
      if (!cancelled) setPageSize({ width: 0, height: 0 });
    });
    return () => { cancelled = true; };
  }, [currentPage, pdfDoc]);
  const scopeStatusLabel = implicitPipelineStatusLabel(charExtraction, pageCount);
  const [retrievalLoaderVisible, setRetrievalLoaderVisible] = useState(false);
  const [displayedRetrievalProgress, setDisplayedRetrievalProgress] = useState(0);
  useEffect(() => {
    if (retrievalStatus === "retrieving") {
      setRetrievalLoaderVisible(true);
      setDisplayedRetrievalProgress((current) => current >= 100 ? 0 : current);
      const cap = Number(retrievalProgress) >= 50 ? 99 : 49;
      const timer = window.setInterval(() => {
        setDisplayedRetrievalProgress((current) => current < cap ? current + 1 : current);
      }, 70);
      return () => window.clearInterval(timer);
    }
    if (retrievalLoaderVisible) {
      const timer = window.setInterval(() => {
        setDisplayedRetrievalProgress((current) => current < 100 ? current + 1 : current);
      }, 18);
      return () => window.clearInterval(timer);
    }
    return undefined;
  }, [retrievalLoaderVisible, retrievalProgress, retrievalStatus]);
  useEffect(() => {
    if (retrievalStatus !== "retrieving" && displayedRetrievalProgress >= 100) {
      const timer = window.setTimeout(() => setRetrievalLoaderVisible(false), 250);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [displayedRetrievalProgress, retrievalStatus]);
  const reextractChars = async () => {
    if (charsReextractState.status === "working") return;
    setCharsReextractState({ status: "working", message: "" });
    try {
      await analysis.reextractChars?.();
      setCharsReextractState({ status: "idle", message: "" });
    } catch (reextractError) {
      setCharsReextractState({ status: "error", message: reextractError.message || "Could not re-extract CHARS." });
    }
  };
  const controlChars = async (action) => {
    if (charsControlState.status === "working") return;
    const operation = action === "pause" ? analysis.pauseChars : action === "resume" ? analysis.resumeChars : analysis.cancelChars;
    if (!operation) return;
    setCharsControlState({ status: "working", action, message: "" });
    try {
      await operation();
      setCharsControlState({ status: "idle", action: null, message: "" });
    } catch (controlError) {
      setCharsControlState({ status: "error", action: null, message: controlError.message || `Could not ${action} Implicit Character extraction.` });
    }
  };
  const charsRunning = ["queued", "processing", "resetting"].includes(charExtraction?.status);
  const charsPaused = charExtraction?.status === "paused";
  const charsProcessedPages = Number(charExtraction?.processedPages || 0);
  const charsPageCount = Number(charExtraction?.pageCount || pageCount || 0);
  const implicitProcessedPages = Number(charExtraction?.implicitDefinitionsProcessedPages || 0);
  const implicitPipelineComplete = charsPageCount > 0
    && charsProcessedPages >= charsPageCount
    && implicitProcessedPages >= charsPageCount;
  const implicitGlobalStatus = implicitPipelineComplete
    ? "CHARS FULLY EXTRACTED · GLYPH FULLY EXTRACTED"
    : charsPaused
      ? `PAUSED · CHARS ${charsProcessedPages.toLocaleString()}/${charsPageCount.toLocaleString()} · GLYPH ${implicitProcessedPages.toLocaleString()}/${charsPageCount.toLocaleString()}`
      : charExtraction?.status === "cancelled"
        ? "CHARS CANCELLED · GLYPH CANCELLED"
        : charExtraction?.status === "failed"
          ? "CHARS FAILED · GLYPH FAILED"
          : charsRunning
            ? `PROCESSING · CHARS ${charsProcessedPages.toLocaleString()}/${charsPageCount.toLocaleString()} · GLYPH ${implicitProcessedPages.toLocaleString()}/${charsPageCount.toLocaleString()}`
            : scopeStatusLabel;
  const scopedGlyphs = useMemo(
    () => scope === "page"
      ? glyphs.filter((glyph) => glyph.pageNumber === currentPage)
      : glyphs,
    [currentPage, glyphs, scope],
  );
  const scopedCharGlyphs = useMemo(
    () => scope === "page"
      ? charGlyphs.filter((glyph) => glyph.pageNumber === currentPage)
      : charGlyphs,
    [charGlyphs, currentPage, scope],
  );
  // PDF text traces contain whitespace entries, but whitespace is not a
  // visible glyph and is not part of the recognizer vocabulary. Keep it out
  // of the comparison result buckets so it cannot appear as a false
  // predicted character such as SPACE.
  const comparableGlyphs = useMemo(
    () => scopedGlyphs.filter((glyph) => glyph.visible !== false),
    [scopedGlyphs],
  );
  const isPageScope = scope === "page";
  const glyphDefinitionRequestKey = "document";
  const glyphDefinitionRefreshKey = charExtraction;
  useEffect(() => {
    let cancelled = false;
    if (!charExtraction?.id || !analysis.loadImplicitGlyphDefinitions) {
      setGlyphDefinitionState({ status: "idle", requestKey: glyphDefinitionRequestKey, summary: emptyDefinitionSummary, definitions: [], error: "" });
      return () => { cancelled = true; };
    }
    setGlyphDefinitionState((current) => current.status === "ready" && current.requestKey === glyphDefinitionRequestKey
      ? { ...current, error: "" }
      : { ...current, status: "loading", requestKey: glyphDefinitionRequestKey, error: "" });
    const definitionRequest = analysis.loadImplicitGlyphDefinitions({ pageNumber: null });
    const instanceRequest = analysis.loadImplicitGlyphInstances
      ? analysis.loadImplicitGlyphInstances({ pageNumber: null, offset: 0, limit: 1 })
      : Promise.resolve(null);
    Promise.all([definitionRequest, instanceRequest]).then(([response, instanceResponse]) => {
      const glyphDefinitions = response?.glyphDefinitions;
      if (!cancelled) setGlyphDefinitionState({ status: "ready", requestKey: glyphDefinitionRequestKey, implicitDefinitionsStatus: charExtraction?.implicitDefinitionsStatus || "completed", implicitDefinitionsProcessedPages: Number(charExtraction?.implicitDefinitionsProcessedPages || 0), implicitDefinitionsPageCount: Number(charExtraction?.pageCount || pageCount || 0), instanceCount: Number(instanceResponse?.pagination?.total ?? response?.instanceCount ?? glyphDefinitions?.summary?.observedInstances ?? 0), summary: glyphDefinitions?.summary || emptyDefinitionSummary, definitions: glyphDefinitions?.definitions || [], error: "" });
    }).catch((definitionError) => {
      if (!cancelled) setGlyphDefinitionState((current) => ({ ...current, status: "error", error: definitionError.message || "Could not load glyph definitions." }));
    });
    return () => { cancelled = true; };
  }, [analysis.loadImplicitGlyphDefinitions, analysis.loadImplicitGlyphInstances, glyphDefinitionRefreshKey, glyphDefinitionRequestKey, pageCount]);
  const openDefinition = async (definition) => {
    setSelectedDefinition(definition);
    if (definition.implicit) {
      setDefinitionInstanceState({ status: "ready", instances: definition.instances || [], error: "" });
      return;
    }
    setDefinitionInstanceState({ status: "loading", instances: [], error: "" });
    try {
      const response = await analysis.loadGlyphDefinitionInstances({ definitionId: definition.definitionId, pageNumber: isPageScope ? currentPage : null });
      setDefinitionInstanceState({ status: "ready", instances: response.instances || [], error: "" });
    } catch (instanceError) {
      setDefinitionInstanceState({ status: "error", instances: [], error: instanceError.message || "Could not load definition instances." });
    }
  };
  const loadGlyphIndexPage = async (offset = 0) => {
    if (!analysis.loadImplicitGlyphInstances || !charExtraction?.id) return;
    setGlyphDefinitionIndexState((current) => ({ ...current, status: "loading", error: "" }));
    try {
      const pageNumber = currentPage;
      let response = await analysis.loadImplicitGlyphInstances({ pageNumber, offset, limit: 100 });
      if (response.pagination?.hasMore) {
        const allInstances = [...(response.instances || [])];
        let nextOffset = Number(response.pagination.offset || 0) + allInstances.length;
        while (response.pagination?.hasMore) {
          response = await analysis.loadImplicitGlyphInstances({ pageNumber, offset: nextOffset, limit: 100 });
          allInstances.push(...(response.instances || []));
          nextOffset += (response.instances || []).length;
        }
        response = { ...response, instances: allInstances, pagination: { total: allInstances.length, offset: 0, limit: allInstances.length || 1, hasMore: false } };
      }
      const definitions = (response.instances || []).map((instance) => ({
        ...instance,
        definitionId: instance.definitionId || `instance:${instance.pageNumber}:${instance.sequenceIndex}`,
        characters: [{ unicode: instance.unicode, value: instance.character, dataType: instance.characterDataType || charClassFor(instance.character), count: 1 }],
        observedInstances: 1,
        pageCount: 1,
        implicit: true,
        instances: [instance],
      }));
      setGlyphDefinitionIndexState({ status: "ready", pageScoped: true, definitions, pagination: response.pagination || null, error: "" });
    } catch (definitionError) {
      setGlyphDefinitionIndexState((current) => ({ ...current, status: "error", error: definitionError.message || "Could not retrieve the definition index." }));
    }
  };
  useEffect(() => {
    if (!glyphDefinitionDrawerOpen || !charExtraction?.id) return undefined;
    setSelectedDefinition(null);
    setDefinitionInstanceState({ status: "idle", instances: [], error: "" });
    void loadGlyphIndexPage(0);
    return undefined;
  }, [glyphDefinitionDrawerOpen, currentPage, charExtraction?.id]);
  const openGlyphDefinitionIndex = async () => {
    setScopeMenuOpen(false);
    setGlyphDefinitionDrawerOpen(true);
  };
  const selectDefinitionInstance = (instance) => {
    onNavigatePage?.(instance.pageNumber);
    const glyph = glyphs.find((entry) => entry.serverGlyphId === instance.glyphInstanceId || entry.id === instance.glyphInstanceId);
    if (glyph) { analysis.selectGlyph?.(glyph); onSelectGlyph?.(glyph); }
  };
  const analyzedGlyphs = useMemo(
    () => status === "analyzing"
      ? scopedGlyphs.filter((glyph) => ["studied", "failed"].includes(glyph.analysisStatus))
      : scopedGlyphs,
    [scopedGlyphs, status],
  );
  const summary = useMemo(() => {
    const metadata = analysis.analysisMetadata;
    const counts = analyzedGlyphs.length ? deriveGlyphCharCounters(analyzedGlyphs) : metadata?.counts || deriveGlyphCharCounters([]);
    const liveAllDocumentInstances = !isPageScope && status === "analyzing"
      ? Math.max(scopedGlyphs.length, Number(progress.instancesEvaluated || 0))
      : !isPageScope && !scopedGlyphs.length && metadata ? Number(metadata.glyphInstances || 0) : scopedGlyphs.length;
    const liveAllDocumentStudied = !isPageScope && status === "analyzing"
      ? Math.max(scopedGlyphs.filter((glyph) => glyph.analysisStatus === "studied" || glyph.analysisStatus === "failed").length, Number(progress.instancesEvaluated || 0))
      : !isPageScope && !scopedGlyphs.length && metadata ? Number(metadata.counts?.instances?.studied || metadata.glyphInstances || 0) : scopedGlyphs.filter((glyph) => glyph.analysisStatus === "studied" || glyph.analysisStatus === "failed").length;
    const charClasses = { letters: 0, numbers: 0, symbols: 0, punctuation: 0, whitespace: 0, other: 0 };
    const whitespaceCounts = { ordinarySpace: 0, tab: 0, newline: 0, carriageReturn: 0, nonBreakingSpace: 0, emSpace: 0, enSpace: 0, thinSpace: 0, otherUnicodeSpacing: 0 };
    let otherCharacterCounts = {};
    scopedCharGlyphs.forEach((glyph) => {
      if (glyph.given?.value == null || glyph.given.value === "") return;
      Array.from(String(glyph.given.value)).forEach((character) => {
        const characterClass = charClassFor(character);
        charClasses[characterClass] += 1;
        if (characterClass === "whitespace") whitespaceCounts[whitespaceClassFor(character)] += 1;
        if (characterClass === "other") {
          const codePointKey = unicodeCodePointKey(character);
          if (codePointKey) otherCharacterCounts[codePointKey] = Number(otherCharacterCounts[codePointKey] || 0) + 1;
        }
      });
    });
    let charsExtracted = Object.values(charClasses).reduce((total, count) => total + count, 0);
    if (charExtraction?.id) {
      let persistedChars = isPageScope
        ? charExtraction.pages?.find((page) => Number(page.pageNumber) === Number(currentPage))
        : charExtraction;
      if (isPageScope && !persistedChars && Number(charExtraction.activePage) === Number(currentPage)) {
        const savedClassCounts = { letters: 0, numbers: 0, symbols: 0, punctuation: 0, whitespace: 0, other: 0 };
        const savedWhitespaceCounts = { ordinarySpace: 0, tab: 0, newline: 0, carriageReturn: 0, nonBreakingSpace: 0, emSpace: 0, enSpace: 0, thinSpace: 0, otherUnicodeSpacing: 0 };
        const savedOtherCharacterCounts = {};
        let savedChars = 0;
        (charExtraction.pages || []).forEach((page) => {
          savedChars += Number(page.charCount || 0);
          Object.keys(savedClassCounts).forEach((key) => { savedClassCounts[key] += Number(page.classCounts?.[key] || 0); });
          Object.keys(savedWhitespaceCounts).forEach((key) => { savedWhitespaceCounts[key] += Number(page.whitespaceCounts?.[key] || 0); });
          Object.entries(page.otherCharacterCounts || {}).forEach(([key, count]) => {
            savedOtherCharacterCounts[key] = Number(savedOtherCharacterCounts[key] || 0) + Number(count || 0);
          });
        });
        persistedChars = {
          charCount: Math.max(0, Number(charExtraction.charCount || 0) - savedChars),
          classCounts: Object.fromEntries(Object.keys(savedClassCounts).map((key) => [key, Math.max(0, Number(charExtraction.classCounts?.[key] || 0) - savedClassCounts[key])])),
          whitespaceCounts: Object.fromEntries(Object.keys(savedWhitespaceCounts).map((key) => [key, Math.max(0, Number(charExtraction.whitespaceCounts?.[key] || 0) - savedWhitespaceCounts[key])])),
          otherCharacterCounts: Object.fromEntries(Object.entries(charExtraction.otherCharacterCounts || {}).map(([key, count]) => [key, Math.max(0, Number(count || 0) - Number(savedOtherCharacterCounts[key] || 0))])),
        };
      }
      Object.keys(charClasses).forEach((key) => { charClasses[key] = Number(persistedChars?.classCounts?.[key] || 0); });
      Object.keys(whitespaceCounts).forEach((key) => { whitespaceCounts[key] = Number(persistedChars?.whitespaceCounts?.[key] || 0); });
      otherCharacterCounts = Object.fromEntries(Object.entries(persistedChars?.otherCharacterCounts || {}).map(([key, count]) => [key, Number(count || 0)]));
      const identifiedOtherTotal = Object.values(otherCharacterCounts).reduce((total, count) => total + Number(count || 0), 0);
      if (identifiedOtherTotal > charClasses.other) {
        // Detailed persisted evidence is stronger than a stale parent total.
        charClasses.other = identifiedOtherTotal;
      }
      charsExtracted = Number(persistedChars?.charCount || 0);
    }
    return {
      counts,
      chars: charsExtracted,
      charClasses,
      whitespaceCounts,
      otherCharacterCounts,
      // Studied means that an evidence record was completed. It does not
      // imply that a usable character prediction exists.
      studied: liveAllDocumentStudied,
      instances: liveAllDocumentInstances,
      unique: status === "analyzing" && progress.definitionsAnalyzed > 0
        ? progress.definitionsAnalyzed
        : !isPageScope && !scopedGlyphs.length && metadata ? Number(metadata.uniqueDefinitions || 0) : new Set(scopedGlyphs.map((glyph) => glyph.definitionCacheKey || glyph.resolvedCacheKey).filter(Boolean)).size,
    };
  }, [analysis.analysisMetadata, analyzedGlyphs, charExtraction, currentPage, isPageScope, progress.definitionsAnalyzed, progress.instancesEvaluated, scopedCharGlyphs, scopedGlyphs, status]);
  const dashboardMetrics = useMemo(() => {
    const characterCounts = new Map();
    const fontCounts = new Map();
    analyzedGlyphs.forEach((glyph) => {
      const prediction = glyphPrediction(glyph);
      const character = finalPredictionCharacter(prediction);
      if (character != null && prediction?.status === "predicted") characterCounts.set(character, (characterCounts.get(character) || 0) + 1);
      if (glyph.fontName) fontCounts.set(glyph.fontName, (fontCounts.get(glyph.fontName) || 0) + 1);
    });
    const top = (map) => [...map.entries()].sort(([, left], [, right]) => right - left).slice(0, 10).map(([label, value]) => ({ label: shownChar(label), value }));
    return {
      characters: top(characterCounts),
      fonts: top(fontCounts),
      recognition: [
        ["Predicted", summary.counts.raster.predicted, "#62c878", "MATCH"],
        ["Ambiguous", summary.counts.raster.ambiguous, "#e6bd62", "AMBIGUOUS"],
        ["Unpredictable", summary.counts.raster.unpredictable, "#db7d85", "UNPREDICTABLE"],
        ["Unavailable", summary.counts.raster.unavailable, "#788593", "UNAVAILABLE"],
        ["No visible glyph", summary.counts.evidenceComparison.noVisibleGlyph, "#9a7bc8", "NO_VISIBLE_GLYPH"],
      ].map(([label, value, color, filterValue]) => ({ label, value, color, filterValue })),
      openSet: [
        ["In vocabulary", summary.counts.openSet.inVocabulary, "#62c878", "MATCH"],
        ["Out of vocabulary", summary.counts.openSet.outOfVocabulary, "#db7d85", "OUT_OF_VOCABULARY"],
        ["Open-set uncertain", summary.counts.openSet.uncertain, "#e6bd62", "OPEN_SET_UNCERTAIN"],
        ["Unavailable", summary.counts.openSet.unavailable, "#788593", "UNAVAILABLE"],
      ].map(([label, value, color, filterValue]) => ({ label, value, color, filterValue })),
      admission: [
        ["Observe only", summary.counts.admission.OBSERVE_ONLY, "#71808c"],
        ["Review required", summary.counts.admission.REVIEW_REQUIRED, "#e9a72d"],
        ["Eligible", summary.counts.admission.ELIGIBLE_WITH_PROVENANCE, "#2dae68"],
        ["Human asserted", summary.counts.admission.HUMAN_ASSERTED, "#8255c7"],
      ].map(([label, value, color]) => ({ label, value, color })),
      comparison: [
        ["Full agreement", summary.counts.evidenceComparison.fullAgreement, "#62c878", "MATCH"],
        ["PDF mapping disagreement", summary.counts.evidenceComparison.pdfMappingDisagreement, "#e6bd62", "DISAGREEMENT"],
        ["Vector/Raster disagreement", summary.counts.evidenceComparison.vectorRasterDisagreement, "#e6bd62", "DISAGREEMENT"],
        ["Unresolved", summary.counts.evidenceComparison.unresolved, "#db7d85", "UNRESOLVED"],
        ["No Given Char", summary.counts.evidenceComparison.noGivenChar, "#788593", "NO_GIVEN_CHAR"],
        ["No visible glyph", summary.counts.evidenceComparison.noVisibleGlyph, "#9a7bc8", "NO_VISIBLE_GLYPH"],
      ].map(([label, value, color, filterValue]) => ({ label, value, color, filterValue })),
      morphology: [
        ["Raster available", summary.counts.morphology.rasterAvailable, "#1f8ed6"],
        ["Raster unavailable", summary.counts.morphology.rasterUnavailable, "#d94747"],
        ["Vector available", summary.counts.morphology.vectorAvailable, "#2dac68"],
        ["Vector unavailable", summary.counts.morphology.vectorUnavailable, "#e7a521"],
      ].map(([label, value, color]) => ({ label, value, color })),
    };
  }, [analyzedGlyphs, summary]);
  const filtered = useMemo(() => {
    if (filter === "ALL") return comparableGlyphs;
    if (["OBSERVE_ONLY", "REVIEW_REQUIRED", "ELIGIBLE_WITH_PROVENANCE", "HUMAN_ASSERTED"].includes(filter)) {
      return comparableGlyphs.filter((glyph) => (glyph.admissionDecision?.state || "OBSERVE_ONLY") === filter);
    }
    if (filter === "UNRESOLVED") return comparableGlyphs.filter((glyph) => ["UNPREDICTABLE", "UNAVAILABLE", "OPEN_SET_UNCERTAIN", "OUT_OF_VOCABULARY"].includes(glyphComparison(glyph)));
    return comparableGlyphs.filter((glyph) => glyphComparison(glyph) === filter);
  }, [comparableGlyphs, filter]);
  const pageIsActive = Number(progress.activePage) === Number(currentPage);
  const pageIsRequested = Number(progress.requestedPage) === Number(currentPage);
  const pageHasCompletedCheckpoint = Number(progress.pageProgressPage) === Number(currentPage) && Boolean(progress.pageComplete);
  const pageEvidenceState = scopedGlyphs.length > 0
    ? summary.studied >= scopedGlyphs.length ? "ready" : "processing"
    : pageHasCompletedCheckpoint ? "ready"
    : pageIsActive ? "processing" : status === "analyzing" || pageIsRequested ? "waiting" : "empty";
  const showStartControl = isPageScope
    ? !scopedGlyphs.length && !pageHasCompletedCheckpoint && !pageIsActive && !pageIsRequested
    : ["idle", "saved", "failed", "cancelled"].includes(status);
  const visibleSelectedGlyph = scope === "page" && selectedGlyph?.pageNumber !== currentPage ? null : selectedGlyph;
  const vectorEvidence = visibleSelectedGlyph?.visualEvidence?.vector || null;
  const rasterEvidence = visibleSelectedGlyph?.visualEvidence?.raster || null;
  const vectorPrediction = vectorEvidence?.prediction || null;
  const rasterPrediction = rasterEvidence?.prediction || rasterEvidence?.recognition || glyphPrediction(visibleSelectedGlyph) || null;
  const cvStages = rasterEvidence?.stages || null;
  const comparisonState = visibleSelectedGlyph?.evidenceComparison?.state || visibleSelectedGlyph?.comparison || "UNRESOLVED";
  const admission = visibleSelectedGlyph?.admissionDecision;
  const validation = visibleSelectedGlyph?.validationProvenance;
  const typographic = rasterEvidence?.typographicEvidence || vectorEvidence?.typographicEvidence || {};
  const rasterViewerStages = cvStages
    ? CV_STAGE_LABELS.filter(([key]) => cvStages[key]).map(([key, label]) => ({ key, label, src: cvStages[key] }))
    : [
        { key: "rendered", label: "Rendered pixels", src: visibleSelectedGlyph?.renderedCrop },
        { key: "normalized", label: "Normalized pixels", src: visibleSelectedGlyph?.normalizedCrop },
      ].filter((stage) => stage.src);
  const activeRasterStage = rasterViewerStages[rasterStageIndex] || rasterViewerStages[0] || null;
  useEffect(() => {
    setConfirmedChar("");
    setTrainingState({ status: "idle", message: "" });
    setRasterStageIndex(0);
    setMorphologyInfoKey(null);
  }, [visibleSelectedGlyph?.id]);
  const trainSelectedGlyph = async () => {
    const label = confirmedChar.normalize("NFC");
    if (Array.from(label).length !== 1 || /\s/u.test(label)) {
      setTrainingState({ status: "error", message: "Enter exactly one visible character." });
      return;
    }
    setTrainingState({ status: "saving", message: "Saving explicit training evidence…" });
    try {
      const result = await analysis.trainSelectedGlyph(label);
      setTrainingState({ status: "saved", message: `Human-confirmed label stored. Added to the human-confirmed training dataset · ${result.sampleCount} sample${result.sampleCount === 1 ? "" : "s"}.` });
    } catch (trainingError) {
      setTrainingState({ status: "error", message: trainingError.message || "Human confirmation could not be stored." });
    }
  };
  const deleteAllResults = async () => {
    if (!window.confirm("Permanently delete all saved Glyph → Char analysis results for this document?")) return;
    try {
      await analysis.deleteAllResults();
      onResultsDeleted?.();
    } catch {
      // The hook exposes the API failure in the panel's existing error area.
    }
  };
  const saveDownload = ({ blob, filename }) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  };
  const generateReport = async (confirmLarge = false) => {
    if (!analysis.jobId) return;
    setReportState({ status: "generating", message: "Loading every persisted glyph on this page…" });
    const selectedGlyphInstanceId = selectedGlyph?.pageNumber === currentPage
      ? selectedGlyph.serverGlyphId || String(selectedGlyph.id || "").split(":").slice(-2).join(":")
      : null;
    try {
      if (reportOptions.includeImages) {
        const bundle = await downloadGlyphCharPageReport(analysis.jobId, {
          pageNumber: currentPage,
          format: "bundle",
          profile: reportOptions.profile,
          includeDebug: reportOptions.includeDebug,
          includeImages: true,
          imageProfile: reportOptions.imageProfile,
          selectedGlyphInstanceId,
          confirmLarge,
        });
        saveDownload(bundle);
        setReportState({ status: "complete", message: `${bundle.reportStatus || "Layer 1"} ZIP downloaded · ${bundle.glyphCount?.toLocaleString() || "all"} persisted glyphs.` });
      } else {
        const common = {
          pageNumber: currentPage,
          profile: reportOptions.profile,
          includeDebug: reportOptions.includeDebug,
          selectedGlyphInstanceId,
        };
        const json = await downloadGlyphCharPageReport(analysis.jobId, { ...common, format: "json" });
        const markdown = await downloadGlyphCharPageReport(analysis.jobId, { ...common, format: "markdown" });
        saveDownload(json);
        saveDownload(markdown);
        setReportState({ status: "complete", message: `${json.reportStatus || "Layer 1"} JSON + Markdown downloaded · ${json.glyphCount?.toLocaleString() || "all"} persisted glyphs.` });
      }
    } catch (reportError) {
      if (reportError.code === "LARGE_REPORT_CONFIRMATION_REQUIRED"
          && window.confirm(`${reportError.message}\n\nGenerate the complete forensic image bundle anyway?`)) {
        await generateReport(true);
        return;
      }
      setReportState({ status: "error", message: reportError.message || "The Layer 1 report could not be generated." });
    }
  };
  return (
    <aside id="glyph_char_aside" aria-label="GLYPH to CHAR evidence layer" aria-busy={retrievalLoaderVisible}>
      <div className="glyph_char_header_tabs">
        <div className="glyph_char_mini_page_nav" aria-label="Layer 1 page navigation">
          <button type="button" onClick={() => onNavigatePage?.(Math.max(1, currentPage - 1))} disabled={!pageCount || currentPage <= 1} aria-label="Previous page" title="Previous page"><i className="bx bx-chevron-left" aria-hidden="true" /></button>
          <span>{currentPage} / {pageCount || "—"}</span>
          <button type="button" onClick={() => onNavigatePage?.(Math.min(pageCount || currentPage, currentPage + 1))} disabled={!pageCount || currentPage >= pageCount} aria-label="Next page" title="Next page"><i className="bx bx-chevron-right" aria-hidden="true" /></button>
        </div>

        <div className="glyph_char_header_tags">
          <div className="glyph_char_header_action_stack">
            <div className="glyph_char_header_status_row">
              <div className="glyph_char_scope_select_label" onPointerDownCapture={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
                <button type="button" className="glyph_char_scope_select" aria-haspopup="listbox" aria-expanded={scopeMenuOpen} aria-label="Analysis scope" onClick={() => setScopeMenuOpen((open) => !open)}>
                  {scope === "document" ? "All document" : `Page ${currentPage}`} <i className="bx bx-chevron-down" aria-hidden="true" />
                </button>
                {scopeMenuOpen && <div className="glyph_char_scope_menu" role="listbox" aria-label="Analysis scope options">
                  {["document", "page"].map((value) => (
                    <button key={value} type="button" role="option" aria-selected={scope === value} onClick={() => { setScope(value); setScopeMenuOpen(false); }}>
                      {value === "document" ? "All document" : `Page ${currentPage}`}
                    </button>
                  ))}
                </div>}
              </div>
            </div>
            <div className="glyph_char_header_analysis_row">
              {showStartControl && <button
                type="button"
                className="glyph_char_start_button"
                onClick={() => onStartAnalysis?.(isPageScope
                  ? { scope: "page", pageNumber: currentPage }
                  : { scope: "document" })}
              >
                <span>{isPageScope
                  ? <><span>SEE</span> <EyeBigIcon className="glyph_char_header_icon" aria-label={`Page ${currentPage} Analysis`} /></>
                  : status === "failed" ? "Retry Document Analysis"
                    : status === "cancelled" ? "Resume Document Analysis"
                    : <><span>SEE</span> <EyeBigIcon className="glyph_char_header_icon" aria-label="Document Analysis" /></>}</span>
              </button>}
              <button
                type="button"
                className="glyph_char_report_trigger"
                onClick={() => { setReportOpen(true); setReportState({ status: "idle", message: "" }); }}
                disabled={!analysis.canGenerateReport}
                aria-label="Generate Layer 1 report"
              >
                <span>REPORT</span>
                <EnvelopeIcon className="glyph_char_header_icon" aria-hidden="true" />
              </button>
              <button
                type="button"
                className="glyph_char_empty_results_btn"
                onClick={deleteAllResults}
                disabled={!analysis.canDeleteResults || status === "analyzing" || status === "deleting"}
                title="Delete all saved glyph results"
                aria-label="Delete all saved glyph results"
              >
                <i className="bx bx-trash" aria-hidden="true" />
              </button>
              {analysis.canCancelAnalysis && <button
                type="button"
                className="glyph_char_cancel_button"
                onClick={() => analysis.cancelAnalysis?.().catch(() => {})}
                disabled={status === "canceling"}
              >{status === "canceling" ? "Aborting…" : "Abort analysis"}</button>}
              {onClose && <button type="button" className="glyph_char_close" onClick={onClose} aria-label="Return to PDF reader" title="Return to PDF reader"><i className="bx bx-x" aria-hidden="true" /></button>}
            </div>
          </div>
        </div>
      </div>

      {retrievalLoaderVisible && <div className="glyph_char_retrieving" role="status" aria-live="polite"><div className="glyph_char_retrieving_loader" style={{ "--glyph-retrieval-progress": `${displayedRetrievalProgress * 3.6}deg` }} aria-label={`${displayedRetrievalProgress}% retrieved`}><strong>{displayedRetrievalProgress}%</strong></div><span><strong>Retrieving Layer 1 data</strong><small>{retrievalProgressMessage(displayedRetrievalProgress)}</small></span></div>}

      {reportOpen && (
        <section className="glyph_char_report_dialog" role="dialog" aria-modal="false" aria-labelledby="glyph_char_report_title">
          <header>
            <div><small>LAYER 1 EXPORT</small><h3 id="glyph_char_report_title">Generate Report</h3></div>
            <button type="button" onClick={() => setReportOpen(false)} aria-label="Close report options"><i className="bx bx-x" aria-hidden="true" /></button>
          </header>
          <fieldset>
            <legend>Format</legend>
            <label><input type="radio" checked readOnly /> <span>JSON + Markdown</span></label>
          </fieldset>
          <fieldset>
            <legend>Report Profile</legend>
            <label><input type="radio" name="glyph-report-profile" checked={reportOptions.profile === "standard"} onChange={() => setReportOptions((current) => ({ ...current, profile: "standard" }))} /> <span>Standard</span></label>
            <label><input type="radio" name="glyph-report-profile" checked={reportOptions.profile === "forensic"} onChange={() => setReportOptions((current) => ({ ...current, profile: "forensic" }))} /> <span>Forensic</span></label>
          </fieldset>
          <fieldset>
            <legend>Evidence Options</legend>
            <label><input type="checkbox" checked={reportOptions.includeDebug} onChange={(event) => setReportOptions((current) => ({ ...current, includeDebug: event.target.checked }))} /> <span>Include Debug Evidence</span></label>
            <label><input type="checkbox" checked={reportOptions.includeImages} onChange={(event) => setReportOptions((current) => ({ ...current, includeImages: event.target.checked }))} /> <span>Include Glyph Images (.zip)</span></label>
          </fieldset>
          {reportOptions.includeImages && (
            <fieldset>
              <legend>Image Export</legend>
              <label><input type="radio" name="glyph-image-profile" checked={reportOptions.imageProfile === "diagnostic"} onChange={() => setReportOptions((current) => ({ ...current, imageProfile: "diagnostic" }))} /> <span>Diagnostic</span></label>
              <label><input type="radio" name="glyph-image-profile" checked={reportOptions.imageProfile === "complete"} onChange={() => setReportOptions((current) => ({ ...current, imageProfile: "complete" }))} /> <span>Complete Forensic</span></label>
              <small>Diagnostic includes failures, disagreement, ambiguity, open-set review, Human evidence, and the selected glyph. Complete Forensic includes every available visible glyph artifact and may be large.</small>
            </fieldset>
          )}
          <dl>
            <dt>Scope</dt><dd>Current Page · {currentPage}</dd>
            <dt>Completeness</dt><dd>{pageEvidenceState === "ready" ? "Expected complete" : "Will be marked PARTIAL"}</dd>
          </dl>
          {pageEvidenceState !== "ready" && <p className="glyph_char_report_warning">The backend will export only persisted evidence and explicitly mark the report PARTIAL. It will not pretend the running analysis is complete.</p>}
          <button type="button" className="glyph_char_report_generate" onClick={() => generateReport(false)} disabled={reportState.status === "generating"}>
            {reportState.status === "generating" ? "Generating…" : reportOptions.includeImages ? "Generate ZIP Report" : "Download JSON + Markdown"}
          </button>
          {reportState.message && <p className={`glyph_char_report_message glyph_char_report_message--${reportState.status}`}>{reportState.message}</p>}
        </section>
      )}

      {glyphDefinitionDrawerOpen && <GlyphDefinitionDrawer
        state={glyphDefinitionIndexState}
        selected={selectedDefinition}
        instanceState={definitionInstanceState}
        pageViewport={pageViewport}
        pageSize={pageSize}
        pdfDoc={pdfDoc}
        onClose={() => { setGlyphDefinitionDrawerOpen(false); setSelectedDefinition(null); setGlyphDefinitionIndexState({ status: "idle", definitions: [], pagination: null, error: "" }); setDefinitionInstanceState({ status: "idle", instances: [], error: "" }); }}
        onSelectDefinition={openDefinition}
        onSelectInstance={selectDefinitionInstance}
        onPageChange={loadGlyphIndexPage}
      />}


      <div className="glyph_char_detection_layout glyph_char_detection_layout--surface">
      <section id="glyph_char_tab_panel_analysis" className={`glyph_char_summary glyph_char_summary--${scope}`} aria-label={isPageScope ? `Page ${currentPage} glyph analysis` : "Document glyph analysis"}>
        <div className="glyph_dashboard_chart_grid">
        {dashboardView === "overview" || dashboardView === "charts" || dashboardView === "recognition" || dashboardView === "comparison" ? <>
          <div className="glyph_dashboard_chart_column" aria-label="Glyph and character counters">
            <div className="glyph_dashboard_column_heading">
              <h3 className="glyph_dashboard_column_title">IMPLICIT</h3>
              <small className="glyph_dashboard_column_flow">CHARS → GLYPH</small>
              <div className="glyph_dashboard_column_status_row"><span className="glyph_dashboard_column_status">{implicitGlobalStatus}</span></div>
              <div className="glyph_dashboard_implicit_global_actions">
                <span className="glyph_dashboard_chars_controls">
                  <button type="button" onClick={() => controlChars("cancel")} disabled={!charExtraction?.id || !["queued", "processing", "paused"].includes(charExtraction?.status) || charsControlState.status === "working"} title="Stop and discard Implicit Characters and Glyphs" aria-label="Stop and discard Implicit Characters and Glyphs"><i className="bx bx-stop" aria-hidden="true" /></button>
                  <button type="button" onClick={() => controlChars(charsPaused ? "resume" : "pause")} disabled={!charExtraction?.id || (!charsRunning && !charsPaused) || charsControlState.status === "working"} title={charsPaused ? "Resume Implicit Characters and Glyphs" : "Pause Implicit Characters and Glyphs"} aria-label={charsPaused ? "Resume Implicit Characters and Glyphs" : "Pause Implicit Characters and Glyphs"}><i className={`bx ${charsPaused ? "bx-play" : "bx-pause"}`} aria-hidden="true" /></button>
                  <button type="button" className={charsReextractState.status === "working" ? "glyph_dashboard_chars_control--working" : ""} onClick={reextractChars} disabled={!charExtraction?.id || charsRunning || charsReextractState.status === "working" || charsControlState.status === "working"} title={charsReextractState.message || "Re-extract Implicit Characters and Glyphs"} aria-label="Re-extract Implicit Characters and Glyphs"><RefreshCcwDotIcon aria-hidden="true" /></button>
                </span>
                <button type="button" className="glyph_dashboard_definition_index_trigger" onClick={openGlyphDefinitionIndex} disabled={!charExtraction?.id || glyphDefinitionState.status === "idle"}>Index <i className="bx bx-right-arrow-alt" aria-hidden="true" /></button>
              </div>
              <div className="glyph_dashboard_implicit_progress">
                {!charExtraction?.id
                  ? <span>Waiting for Implicit extraction</span>
                  : charsPaused
                    ? <span>Paused · page <strong>{charExtraction.activePage || Math.min(charsProcessedPages + 1, charsPageCount)}</strong> / {charsPageCount}</span>
                    : charsRunning
                      ? <><span>Page <strong>{charExtraction.activePage || Math.min(charsProcessedPages + 1, charsPageCount)}</strong> / {charsPageCount}</span><span>CHARS {Number(charExtraction.activePageProcessedChars || 0).toLocaleString()} / {Number(charExtraction.activePageCharCount || 0).toLocaleString()}</span><span>GLYPH {Number(charExtraction.activePageProcessedGlyphs || 0).toLocaleString()} / {Number(charExtraction.activePageCharCount || 0).toLocaleString()}</span></>
                      : <span>Pages completed · CHARS <strong>{charsProcessedPages}</strong> / {charsPageCount} · GLYPH <strong>{implicitProcessedPages}</strong> / {charsPageCount}</span>}
              </div>
            </div>
            <article className="glyph_dashboard_card glyph_dashboard_chars_noumena"><header><span><h4>Implicit Characters</h4><small>Code-extracted identity</small></span></header><strong className="glyph_dashboard_chars_count">{summary.chars.toLocaleString()}</strong><small>characters extracted and classified one character at a time</small><div className="glyph_dashboard_chars_live">{charExtraction?.id ? charsPaused ? <span>Paused at page <strong>{charExtraction.activePage || Math.min(Number(charExtraction.processedPages || 0) + 1, Number(charExtraction.pageCount || pageCount))}</strong> / {charExtraction.pageCount || pageCount}</span> : charsRunning ? <><span>Current extracting page <strong>{charExtraction.activePage || Math.min(Number(charExtraction.processedPages || 0) + 1, Number(charExtraction.pageCount || pageCount))}</strong> / {charExtraction.pageCount || pageCount}</span>{Boolean(charExtraction.activePageCharCount) && <span>{Number(charExtraction.activePageProcessedChars || 0).toLocaleString()} / {Number(charExtraction.activePageCharCount).toLocaleString()} chars</span>}</> : <span>{charExtraction.processedPages || 0} / {charExtraction.pageCount || pageCount} pages saved</span> : <span>Waiting for CHARS extraction</span>}</div>{charsControlState.message && <small className="glyph_dashboard_chars_control_error">{charsControlState.message}</small>}<CharClassesPie classes={summary.charClasses} whitespaceCounts={summary.whitespaceCounts} otherCharacterCounts={summary.otherCharacterCounts} total={summary.chars} /><p>Characters are extracted by code, not traced from visible glyph outlines.</p></article>
            <GlyphDefinitionsCard state={glyphDefinitionState} onOpen={openGlyphDefinitionIndex} />
          </div>
          <div className="glyph_dashboard_chart_column" aria-label="Raster and open-set analytics">
            <div className="glyph_dashboard_column_heading"><h3 className="glyph_dashboard_column_title">EXPLICIT</h3><small className="glyph_dashboard_column_flow">GLYPH → CHARS</small><div className="glyph_dashboard_column_status_row"><span className="glyph_dashboard_column_status">GLYPH {documentExtractionCompleteness(progress.pagesCompleted, progress.pagesTotal || pageCount)}</span></div></div>
            <article className="glyph_dashboard_card glyph_dashboard_metric_card glyph_dashboard_metric_card--blue"><header><h4>Glyph Instances</h4><small>Observed counts</small></header><dl><Layer1InfoTerm term="Glyph instances" /><dd>{summary.instances.toLocaleString()}</dd><Layer1InfoTerm term="Unique definitions" /><dd>{summary.unique.toLocaleString()}</dd><Layer1InfoTerm term="Studied" /><dd>{summary.studied.toLocaleString()}</dd><Layer1InfoTerm term="Displayed rows" /><dd>{filtered.length.toLocaleString()}</dd><Layer1InfoTerm term="Non-row instances" /><dd>{Math.max(0, summary.instances - filtered.length).toLocaleString()}</dd></dl></article>
            <article className="glyph_dashboard_card glyph_dashboard_metric_card glyph_dashboard_metric_card--green"><header><h4>Raster Recognition</h4><small>Observed counts</small></header><dl><Layer1InfoTerm term="Predicted" /><dd>{summary.counts.raster.predicted}</dd><Layer1InfoTerm term="Ambiguous" /><dd>{summary.counts.raster.ambiguous}</dd><Layer1InfoTerm term="Unpredictable" /><dd>{summary.counts.raster.unpredictable}</dd><Layer1InfoTerm term="Unavailable" /><dd>{summary.counts.raster.unavailable}</dd></dl></article>
            <DashboardBarChart title="Recognition outcomes" items={dashboardMetrics.recognition} onSelect={(item) => { if (item.filterValue) { setFilter(item.filterValue); setActiveTab("results"); } }} />
            <DashboardBarChart title="Open-set assessment" items={dashboardMetrics.openSet} onSelect={(item) => { if (item.filterValue) { setFilter(item.filterValue); setActiveTab("results"); } }} />
            <DashboardDonut title="Morphology availability" items={dashboardMetrics.morphology} total={summary.instances} />
          </div>
          <div className="glyph_dashboard_chart_column" aria-label="Vector and evidence analytics">
            <div className="glyph_dashboard_column_heading"><h3 className="glyph_dashboard_column_title">CANONICAL TEXT</h3><small className="glyph_dashboard_column_flow">CANONICAL REPRESENTATION</small></div>
            <article className="glyph_dashboard_card glyph_dashboard_metric_card glyph_dashboard_metric_card--blue"><header><h4>Vector Recognition</h4><small>Observed counts</small></header><dl><Layer1InfoTerm term="Predicted" /><dd>{summary.counts.vector.predicted}</dd><Layer1InfoTerm term="Ambiguous" /><dd>{summary.counts.vector.ambiguous}</dd><Layer1InfoTerm term="Unpredictable" /><dd>{summary.counts.vector.unpredictable}</dd><Layer1InfoTerm term="Unavailable" /><dd>{summary.counts.vector.unavailable}</dd></dl></article>
            <DashboardDonut title="Admission status" items={dashboardMetrics.admission} total={analyzedGlyphs.length} />
            <DashboardBarChart title="Evidence comparison" items={dashboardMetrics.comparison} onSelect={(item) => { if (item.filterValue) { setFilter(item.filterValue); setActiveTab("results"); } }} />
            <DashboardBarChart title="Font distribution · Top 10" items={dashboardMetrics.fonts} />
          </div>
        </> : <div className="glyph_dashboard_empty_panel"><strong>{dashboardView === "heatmaps" ? "No observed disagreement heatmap data" : dashboardView === "trends" ? "No historical telemetry available" : dashboardView === "distributions" ? "Distribution view ready when evidence is available" : dashboardView === "exports" ? "Use REPORT to export persisted Layer 1 evidence" : "Select a dashboard view"}</strong><span>Only actual Layer 1 evidence is shown; synthetic values are not generated.</span></div>}
        </div>
        {!isPageScope && status === "analyzing" && (
          <div className="glyph_char_progress">
            <span>Analyzing complete document…</span>
            <strong>{progress.instancesEvaluated.toLocaleString()} evaluated · {progress.pagesCompleted}/{progress.pagesTotal} pages</strong>
            <progress aria-label="All-document analysis progress" value={progress.pagesCompleted} max={Math.max(1, progress.pagesTotal)} />
          </div>
        )}
        {error && <p className="glyph_char_error">{error}</p>}
      </section>

      <div className="glyph_layer1_evidence_results_viewport">
      <section className="glyph_char_inspector glyph_char_inspector--layer1-surface" aria-label="Selected glyph visual evidence">
        {!visibleSelectedGlyph ? <p className="glyph_char_empty">Select a visible glyph or a result row.</p> : <>
          <section className="glyph_visual_evidence" aria-label="GLYPH VISUAL EVIDENCE">
            <nav className="glyph_inspector_tabs" role="tablist" aria-label="Glyph evidence morphology views">
              <button type="button" role="tab" aria-selected={inspectorTab === "vector"} className={inspectorTab === "vector" ? "is-active" : ""} onClick={() => setInspectorTab("vector")}>
                <span>Glyph Vector Source Morphology</span><small>Glyph Definition Evidence</small>
              </button>
              <button type="button" role="tab" aria-selected={inspectorTab === "raster"} className={inspectorTab === "raster" ? "is-active" : ""} onClick={() => setInspectorTab("raster")}>
                <span>Glyph Raster Visual Morphology</span><small>Glyph Instance Evidence</small>
              </button>
              <button type="button" role="tab" aria-selected={inspectorTab === "gate"} className={inspectorTab === "gate" ? "is-active" : ""} onClick={() => setInspectorTab("gate")}>
                <span>Layer 1 Instrument Gate</span><small>Measurement Validity</small>
              </button>
              <button type="button" role="tab" aria-selected={inspectorTab === "human"} className={inspectorTab === "human" ? "is-active" : ""} onClick={() => setInspectorTab("human")}>
                <span>Human Confirmation</span><small>Independent Human Evidence</small>
              </button>
              <button type="button" role="tab" aria-selected={inspectorTab === "metadata"} className={inspectorTab === "metadata" ? "is-active" : ""} onClick={() => setInspectorTab("metadata")}>
                <span>Glyph Metadata</span><small>Instance Identity and Geometry</small>
              </button>
              <button type="button" role="tab" aria-selected={inspectorTab === "debug"} className={inspectorTab === "debug" ? "is-active" : ""} onClick={() => setInspectorTab("debug")}>
                <span>Evidence / Debug</span><small>Technical Diagnostics</small>
              </button>
            </nav>

            <article className="glyph_visual_card glyph_visual_card--vector" hidden={inspectorTab !== "vector"}>
              {!vectorEvidence?.available && <p className="glyph_visual_unavailable">{vectorEvidence?.unavailableReason || "No reliable glyph outline was exposed."}</p>}
              <section className="glyph_morphology_phenomena" aria-label="Glyph morphology phenomena">
                <h5>Phenomena</h5>
                <figure className="glyph_morphology_phenomena_preview glyph_vector_preview">
                  {vectorEvidence?.available && vectorEvidence?.outline?.svgPath
                    ? <svg viewBox={vectorEvidence.outline.viewBox || "0 0 100 100"} role="img" aria-label="Glyph vector preview"><path d={vectorEvidence.outline.svgPath} /></svg>
                    : <span>VECTOR UNAVAILABLE</span>}
                </figure>
                <div className="glyph_morphology_phenomena_grid">
                  {[["Contours", "contourCount"], ["Closed contours", "closedContourCount"], ["Open contours", "openContourCount"], ["Counters", "counterEstimate"], ["Curves", "curveCount"], ["Line segments", "lineSegmentCount"], ["Aspect ratio", "aspectRatio"]].map(([label, key]) => (
                    <div className="glyph_morphology_phenomenon" key={key}>
                      <span>{label}</span><strong>{vectorEvidence?.morphology?.[key] ?? "—"}</strong>
                      <button type="button" aria-label={`Explain ${label}`} onClick={() => setMorphologyInfoKey((current) => current === key ? null : key)}><InfoSquareIcon /></button>
                      {morphologyInfoKey === key && <p>{VECTOR_MORPHOLOGY_DEFINITIONS.find(([term]) => term === label)?.[1]}</p>}
                    </div>
                  ))}
                  <div className="glyph_morphology_phenomenon">
                    <span>Font reference</span><strong>{visibleSelectedGlyph.fontName || "—"}</strong>
                  </div>
                  <div className="glyph_morphology_phenomenon">
                    <span>Glyph ID</span><strong>{visibleSelectedGlyph.glyphId ?? "—"}</strong>
                  </div>
                </div>
              </section>
              <RecognitionPanel title="Vector Predicted Char" prediction={vectorPrediction} showScore={false} />
            </article>

            <article className="glyph_visual_card glyph_visual_card--raster" hidden={inspectorTab !== "raster"}>
              <section className="glyph_morphology_phenomena glyph_morphology_phenomena--raster" aria-label="Raster glyph morphology phenomena">
                <h5>Phenomena</h5>
                <div className="glyph_raster_viewer" aria-label="OpenCV raster stage viewer">
                  {activeRasterStage ? <>
                    <button
                      type="button"
                      className="glyph_raster_viewer_action glyph_raster_viewer_action--previous"
                      onClick={() => setRasterStageIndex((index) => (index - 1 + rasterViewerStages.length) % rasterViewerStages.length)}
                      disabled={rasterViewerStages.length < 2}
                      aria-label="Previous raster stage"
                    ><i className="bx bx-chevron-left" aria-hidden="true" /></button>
                    <figure>
                      <img src={activeRasterStage.src} alt={`OpenCV ${activeRasterStage.label.toLowerCase()}`} />
                      <figcaption>{activeRasterStage.label} · {rasterStageIndex + 1}/{rasterViewerStages.length}</figcaption>
                    </figure>
                    <button
                      type="button"
                      className="glyph_raster_viewer_action glyph_raster_viewer_action--next"
                      onClick={() => setRasterStageIndex((index) => (index + 1) % rasterViewerStages.length)}
                      disabled={rasterViewerStages.length < 2}
                      aria-label="Next raster stage"
                    ><i className="bx bx-chevron-right" aria-hidden="true" /></button>
                  </> : <span className="glyph_raster_viewer_empty">No raster image available.</span>}
                </div>
                {visibleSelectedGlyph.visualStagesStatus === "loading" && <p className="glyph_visual_stage_notice">Loading stored OpenCV stages…</p>}
                {visibleSelectedGlyph.visualStagesStatus === "unavailable" && <p className="glyph_visual_unavailable">{visibleSelectedGlyph.visualStagesError}</p>}
                <div className="glyph_morphology_phenomena_grid">
                  {[ ["Contours", "contourCount"], ["Counters", "counterEstimate"], ["Components", "connectedComponents"], ["Aspect ratio", "aspectRatio"], ["Foreground", "foregroundPercentage"], ["Edges", "edgePixelPercentage"] ].map(([label, key]) => (
                    <div className="glyph_morphology_phenomenon" key={key}>
                      <span>{label}</span><strong>{rasterEvidence?.morphology?.[key] ?? "—"}</strong>
                      <button type="button" aria-label={`Explain ${label}`} onClick={() => setMorphologyInfoKey((current) => current === key ? null : key)}><InfoSquareIcon /></button>
                      {morphologyInfoKey === key && <p>{VECTOR_MORPHOLOGY_DEFINITIONS.find(([term]) => term === label)?.[1] || "A measured property of the raster glyph evidence."}</p>}
                    </div>
                  ))}
                </div>
              </section>
              <RecognitionPanel title="Raster Predicted Char" prediction={rasterPrediction} />
              {!rasterEvidence?.available && <p className="glyph_visual_unavailable">{rasterEvidence?.unavailableReason || "Raster evidence is unavailable."}</p>}
            </article>

            <article className="glyph_visual_card glyph_visual_card--given" hidden={inspectorTab !== "gate"}>
              <header><small>PDF Evidence</small><h4>Given Char</h4></header>
              <div className="glyph_visual_prediction"><small>Given Char</small><strong>{shownChar(visibleSelectedGlyph.given.value)}</strong><span>{visibleSelectedGlyph.given.source}</span></div>
            </article>

            <article className="glyph_visual_card glyph_visual_card--human" hidden={inspectorTab !== "human"}>
              <header><small>Explicit human evidence</small><h4>Human Confirmed Char</h4></header>
              <div className="glyph_visual_prediction"><small>Human Confirmed Char</small><strong>{shownChar(visibleSelectedGlyph.humanConfirmation?.confirmedChar)}</strong><span>{visibleSelectedGlyph.humanConfirmation?.source || "Not confirmed"}</span></div>
            </article>

            <section className="glyph_cv_training glyph_cv_training--standalone" aria-label="Human confirmation for selected glyph" hidden={inspectorTab !== "human"}>
              <div><small>Independent evidence channel</small><strong>Confirm the selected glyph</strong></div>
              <label>
                <span>Correct character</span>
                <input
                  type="text"
                  value={confirmedChar}
                  onChange={(event) => setConfirmedChar(event.target.value)}
                  placeholder="A"
                  aria-label="Human-confirmed character"
                  autoComplete="off"
                  spellCheck="false"
                />
              </label>
              <button
                type="button"
                onClick={trainSelectedGlyph}
                disabled={trainingState.status === "saving" || !cvStages?.normalized}
              >{trainingState.status === "saving" ? "Saving…" : "Confirm Character"}</button>
              <small className={`glyph_cv_training_message glyph_cv_training_message--${trainingState.status}`}>
                {trainingState.message || "Confirmation is stored separately for deliberate future model training. It does not retrain or override the base model. PDF /ToUnicode is never a training label."}
              </small>
            </section>

            <article className="glyph_visual_card glyph_visual_card--comparison" hidden={inspectorTab !== "gate"}>
              <header><h4>Evidence agreement</h4></header>
              <strong>{comparisonState}</strong>
            </article>

            <article className="glyph_visual_card glyph_measurement_validity" hidden={inspectorTab !== "gate"}>
              <header><small>Layer 1 instrument gate</small><h4>MEASUREMENT VALIDITY</h4></header>
              <dl className="glyph_visual_evidence_metrics">
                <dt>Raster model</dt><dd>{rasterPrediction?.modelName || "unavailable"} {rasterPrediction?.modelVersion || ""}</dd>
                <dt>Vector model</dt><dd>{vectorPrediction?.modelName || "unavailable"} {vectorPrediction?.modelVersion || ""}</dd>
                <dt>Validation profile</dt><dd>{validation?.validationProfileVersion || "unavailable"}</dd>
                <dt>Profile approval</dt><dd>{validation?.approvedForDownstream ? "APPROVED" : "NOT APPROVED"}</dd>
                <dt>Open-set</dt><dd>{visibleSelectedGlyph.openSetAssessment?.status || "UNAVAILABLE"}</dd>
                <dt>Typographic evidence</dt><dd>{typographic.available ? "AVAILABLE" : "UNAVAILABLE"}</dd>
                <dt>Admission</dt><dd>{admission?.state || "OBSERVE_ONLY"}</dd>
                <dt>Admitted Char</dt><dd>{shownChar(admission?.admittedChar)}</dd>
              </dl>
              <div className="glyph_admission_reasons">{(admission?.reasonCodes || ["ADMISSION_DECISION_UNAVAILABLE"]).map((reason) => <span key={reason}>{reason}</span>)}</div>
            </article>

            <details className="glyph_typographic_details" hidden={inspectorTab !== "gate"}>
              <summary>TYPOGRAPHIC-RELATIVE EVIDENCE</summary>
              <dl className="glyph_visual_evidence_metrics">
                {[ ["fontSize","Font size"], ["widthToFontSize","Width / font size"], ["heightToFontSize","Height / font size"],
                  ["rawCropWidthToExpectedFontPixels","Raw crop width / expected font pixels"], ["rawCropHeightToExpectedFontPixels","Raw crop height / expected font pixels"],
                  ["inkWidthToExpectedFontPixels","Ink width / expected font pixels"], ["inkHeightToExpectedFontPixels","Ink height / expected font pixels"],
                  ["advanceWidthToEm","Advance / em"], ["glyphTopToEm","Top / em"], ["glyphBottomToEm","Bottom / em"],
                  ["glyphWidthToEm","Glyph width / em"], ["glyphHeightToEm","Glyph height / em"], ["capHeight","Cap height"], ["xHeight","x-height"]
                ].map(([key,label]) => <React.Fragment key={key}><dt>{label}</dt><dd>{typographic[key] ?? "unavailable"}</dd></React.Fragment>)}
              </dl>
            </details>
          </section>
          {inspectorTab === "metadata" && <dl className="glyph_char_metadata">
              <dt>Page</dt><dd>{visibleSelectedGlyph.pageNumber}</dd>
              <Layer1InfoTerm term="Font reference" label="Font" /><dd>{visibleSelectedGlyph.fontName || "unknown"}</dd>
              <Layer1InfoTerm term="Glyph ID" /><dd>{visibleSelectedGlyph.glyphId ?? "unavailable"}</dd>
              <dt>Geometry</dt><dd>{visibleSelectedGlyph.geometryConfidence} · {visibleSelectedGlyph.geometryMethod}</dd>
              <dt>BBox</dt><dd>{[visibleSelectedGlyph.bbox.x, visibleSelectedGlyph.bbox.y, visibleSelectedGlyph.bbox.width, visibleSelectedGlyph.bbox.height].map((value) => Number(value).toFixed(2)).join(", ")}</dd>
            </dl>}
          {inspectorTab === "debug" && <section className="glyph_char_debug">
            <dl>
              <dt>Given provenance</dt><dd>{visibleSelectedGlyph.given.source}</dd>
              <dt>Raw code</dt><dd>{visibleSelectedGlyph.given.rawCode ?? "unavailable"}</dd>
              <dt>Vector recognizer</dt><dd>{vectorPrediction?.modelName ? `${vectorPrediction.modelName} ${vectorPrediction.modelVersion || ""}` : "unavailable"}</dd>
              <dt>Vector source</dt><dd>{vectorEvidence?.outlineSource || "unavailable"}</dd>
              <Layer1InfoTerm term="Vector cache" /><dd>{vectorEvidence?.cacheKey || "unavailable"}</dd>
              <dt>Raster recognizer</dt><dd>{rasterPrediction?.modelName ? `${rasterPrediction.modelName} ${rasterPrediction.modelVersion || ""}` : "unavailable"}</dd>
              <dt>Prediction source</dt><dd>{rasterPrediction?.predictionSource || "unavailable"}</dd>
              <dt>Preprocessing version</dt><dd>{rasterPrediction?.preprocessingVersion || "unavailable"}</dd>
              <dt>Calibration version</dt><dd>{rasterPrediction?.calibrationVersion || "unavailable"}</dd>
              <dt>Raster crop</dt><dd>{rasterEvidence?.method || "pending"}</dd>
              <dt>Raster normalization</dt><dd>{rasterEvidence?.normalization || "pending"}</dd>
              <dt>Raster fingerprint</dt><dd>{rasterEvidence?.fingerprint || visibleSelectedGlyph.visualFingerprint || "pending"}</dd>
              <dt>Raster cache</dt><dd>{rasterEvidence?.instanceCacheKey || "pending"}</dd>
              <dt>Transform</dt><dd>{visibleSelectedGlyph.transform?.join(", ") || "unavailable"}</dd>
            </dl>
            {visibleSelectedGlyph.renderedCrop && <img src={visibleSelectedGlyph.renderedCrop} alt="Raw rendered glyph crop" />}
          </section>}
        </>}
      </section>

      <section className="glyph_char_list_section glyph_char_list_section--layer1-surface" aria-label="Glyph results">
        <section className="glyph_layer1_results_block">
          <h3>
            <span>{isPageScope ? `Page ${currentPage} glyph results` : "Glyph results"}</span>
            <span className="glyph_char_results_heading_actions">
              <span>{filtered.length.toLocaleString()}</span>
            </span>
          </h3>
          <div className="glyph_char_filters" role="tablist" aria-label="Filter glyph comparisons">
            {FILTERS.map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={filter === value} className={filter === value ? "is-active" : ""} onClick={() => setFilter(value)}>{label}</button>)}
          </div>
          {filtered.length > 0
            ? <GlyphResultList key={`${scope}:${currentPage}:${filter}`} glyphs={filtered} selectedId={visibleSelectedGlyph?.id} onSelect={onSelectGlyph} showPageNumber={!isPageScope} fullList cellGrid />
            : <p className="glyph_char_empty glyph_char_empty--instances">No glyph results yet.</p>}
        </section>
      </section>
      </div>
      </div>
    </aside>
  );
};

export default GlyphCharAside;
