import { detectMWResponseType, MW_RESPONSE_TYPES } from "./detectResponse";
import { isMWEntry } from "./guards";
import { cleanMWText } from "./parseMarkup";
import { parseDefinitionText } from "./parseDefinitionText";
import { parseSenseSequence } from "./parseSenseSequence";

const asArray = (value) => Array.isArray(value) ? value : value == null ? [] : [value];
const compact = (values) => values.filter((value) => value !== undefined && value !== null && value !== "");
const unique = (values) => [...new Set(compact(values))];

const cleanHeadword = (value) => String(value || "").replace(/\*/g, "").replace(/:\d+$/, "").trim();

const pronunciationMetadata = (entry) => {
  const objects = [
    ...asArray(entry?.hwi?.prs),
    ...asArray(entry?.prs),
  ].filter((item) => item && typeof item === "object");
  return {
    pronunciation: unique(objects.map((item) => String(item.mw || item.ipa || "").trim())),
    audio: unique(objects.map((item) => String(item?.sound?.audio || "").trim())),
    pronunciationDetails: objects,
  };
};

const entryContext = (entry, entryIndex) => {
  const pronunciation = pronunciationMetadata(entry);
  return {
    entryIndex,
    entryId: entry?.meta?.id,
    uuid: entry?.meta?.uuid,
    source: entry?.meta?.src,
    entrySort: entry?.meta?.sort,
    section: entry?.meta?.section,
    stems: asArray(entry?.meta?.stems),
    headword: cleanHeadword(entry?.hwi?.hw || entry?.meta?.id),
    pronunciationLabel: entry?.hwi?.psl,
    homograph: entry?.hom,
    partOfSpeech: entry?.fl,
    ...pronunciation,
    variants: compact([...asArray(entry?.ahws), ...asArray(entry?.vrs), ...asArray(entry?.cxs)]),
    alternateHeadwords: asArray(entry?.ahws),
    inflections: asArray(entry?.ins),
    crossReferences: asArray(entry?.cxs),
    directionalCrossReferences: asArray(entry?.dxnls),
    subjectStatusLabels: unique(asArray(entry?.sls).map(String)),
    usageLabels: unique(asArray(entry?.lbs).map(String)),
    etymology: entry?.et,
    firstKnownUse: entry?.date,
    synonymDiscussion: entry?.syns,
    usages: entry?.usages,
    quotes: entry?.quotes,
    runOns: entry?.dros,
    derivedForms: entry?.uros,
    artwork: entry?.art,
    tables: entry?.table,
    shortDefinitions: asArray(entry?.shortdef).map(cleanMWText).filter(Boolean),
    offensive: Boolean(entry?.meta?.offensive),
    rawEntry: entry,
  };
};

const normalizeGrammar = (value) => {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return value == null ? undefined : String(value);
};

const createSenseRowFactory = ({ base, entry, verbDivider, runOnPhrase, senseTypeOverride }) => (
  sense,
  detectedType,
  sourcePath,
) => {
  const definition = parseDefinitionText(sense?.dt, `${sourcePath}[1].dt`);
  const divided = sense?.sdsense;
  const dividedDefinition = parseDefinitionText(divided?.dt, `${sourcePath}[1].sdsense.dt`);
  return {
    ...base,
    verbDivider,
    runOnPhrase,
    senseNumber: sense?.sn,
    senseType: senseTypeOverride || detectedType || "unknown",
    definitions: definition.definitions,
    examples: definition.examples,
    definitionComponents: definition.definitionComponents,
    exampleDetails: definition.exampleDetails,
    definitionNotes: definition.notes,
    supplementalDefinitions: definition.supplemental,
    subjectStatusLabels: unique([...base.subjectStatusLabels, ...asArray(sense?.sls).map(String)]),
    usageLabels: unique([...base.usageLabels, ...asArray(sense?.lbs).map(String)]),
    grammar: normalizeGrammar(sense?.sgram),
    dividedSense: divided?.sd,
    dividedDefinitions: dividedDefinition.definitions,
    dividedDefinitionComponents: dividedDefinition.definitionComponents,
    etymology: sense?.et ?? base.etymology,
    variants: compact([...base.variants, ...asArray(sense?.vrs)]),
    inflections: compact([...base.inflections, ...asArray(sense?.ins)]),
    pronunciationDetails: compact([...base.pronunciationDetails, ...asArray(sense?.prs)]),
    sourcePath,
    rawSense: sense,
    rawEntry: entry,
  };
};

const parseDefinitionBlocks = ({ blocks, base, entry, entryPath, unknownTags, runOnPhrase, senseTypeOverride }) => (
  asArray(blocks).flatMap((definitionBlock, definitionIndex) => {
    const blockPath = `${entryPath}.def[${definitionIndex}]`;
    const createSenseRow = createSenseRowFactory({
      base,
      entry,
      verbDivider: definitionBlock?.vd,
      runOnPhrase,
      senseTypeOverride,
    });
    return parseSenseSequence(definitionBlock?.sseq, { createSenseRow, unknownTags, senseTypeOverride }, `${blockPath}.sseq`);
  })
);

const fallbackEntryRow = (entry, base, entryPath) => ({
  ...base,
  senseType: "unknown",
  definitions: base.shortDefinitions,
  examples: [],
  definitionComponents: base.shortDefinitions.map((displayText, index) => ({
    tag: "shortdef",
    rawText: asArray(entry.shortdef)[index],
    displayText,
    sourcePath: `${entryPath}.shortdef[${index}]`,
  })),
  exampleDetails: [],
  definitionNotes: [],
  supplementalDefinitions: [],
  dividedDefinitions: [],
  sourcePath: entryPath,
  rawSense: null,
  rawEntry: entry,
});

export const normalizeMWResponse = (response) => {
  const type = detectMWResponseType(response);
  const normalized = { type, rows: [], suggestions: [], unknownTags: [], rawResponse: response };
  if (type === MW_RESPONSE_TYPES.SUGGESTIONS) {
    normalized.suggestions = response.map(String);
    return normalized;
  }
  if (type !== MW_RESPONSE_TYPES.ENTRIES) return normalized;

  response.forEach((entry, entryIndex) => {
    if (!isMWEntry(entry)) return;
    const entryPath = `response[${entryIndex}]`;
    const base = entryContext(entry, entryIndex);
    const entryRows = parseDefinitionBlocks({
      blocks: entry.def,
      base,
      entry,
      entryPath,
      unknownTags: normalized.unknownTags,
    });

    asArray(entry.dros).forEach((runOn, runOnIndex) => {
      entryRows.push(...parseDefinitionBlocks({
        blocks: runOn?.def,
        base: {
          ...base,
          headword: cleanHeadword(runOn?.drp) || base.headword,
          partOfSpeech: runOn?.fl || runOn?.psl || base.partOfSpeech,
          pronunciation: unique([...base.pronunciation, ...pronunciationMetadata(runOn).pronunciation]),
        },
        entry,
        entryPath: `${entryPath}.dros[${runOnIndex}]`,
        unknownTags: normalized.unknownTags,
        runOnPhrase: runOn?.drp,
        senseTypeOverride: "dros",
      }));
    });

    normalized.rows.push(...(entryRows.length ? entryRows : [fallbackEntryRow(entry, base, entryPath)]));
  });
  return normalized;
};

export const normalizeSavedVocabulary = (savedItem, itemIndex = 0) => {
  if (Array.isArray(savedItem?.dictionaryResponse)) {
    const normalized = normalizeMWResponse(savedItem.dictionaryResponse);
    return {
      ...normalized,
      rows: normalized.rows.map((row) => ({
        ...row,
        savedId: savedItem.id,
        savedItem,
        translation: savedItem.translation || "",
      })),
    };
  }
  const definitionObjects = asArray(savedItem?.definitions);
  return {
    type: "legacy",
    suggestions: [],
    unknownTags: [],
    rawResponse: null,
    rows: [{
      entryIndex: itemIndex,
      entryId: savedItem?.id,
      source: savedItem?.source,
      headword: savedItem?.word,
      partOfSpeech: definitionObjects[0]?.partOfSpeech,
      pronunciation: compact([savedItem?.phonetic]),
      audio: compact([savedItem?.audioUrl]),
      senseType: "unknown",
      definitions: definitionObjects.map((item) => cleanMWText(item?.definition)).filter(Boolean),
      examples: definitionObjects.map((item) => cleanMWText(item?.example)).filter(Boolean),
      shortDefinitions: definitionObjects.map((item) => cleanMWText(item?.definition)).filter(Boolean),
      sourcePath: `saved[${itemIndex}]`,
      rawSense: null,
      rawEntry: savedItem,
      savedId: savedItem?.id,
      savedItem,
      translation: savedItem?.translation || "",
      offensive: false,
    }],
  };
};
