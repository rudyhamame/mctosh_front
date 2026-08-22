export const MW_COLUMN_GROUPS = Object.freeze({
  entry: "Entry",
  meaning: "Meaning",
  linguistic: "Linguistic",
  historical: "Historical",
  relations: "Relations / Notes",
  debug: "Debug",
});

export const MW_COLUMNS = Object.freeze({
  headword: { label: "Headword", group: "entry" },
  entryId: { label: "Entry ID", group: "entry" },
  uuid: { label: "UUID", group: "entry" },
  homograph: { label: "Homograph", group: "entry" },
  partOfSpeech: { label: "Part of Speech", shortLabel: "POS", group: "entry" },
  source: { label: "Source", group: "entry" },
  offensive: { label: "Offensive", group: "entry" },
  translation: { label: "Translation", group: "entry" },
  senseNumber: { label: "Sense", group: "meaning" },
  senseType: { label: "Sense Type", group: "meaning" },
  verbDivider: { label: "Verb Divider", group: "meaning" },
  definitions: { label: "Definition", group: "meaning", multiline: true },
  dividedSense: { label: "Divided Sense", group: "meaning" },
  dividedDefinitions: { label: "Divided Definition", group: "meaning", multiline: true },
  examples: { label: "Example", group: "meaning", multiline: true },
  pronunciation: { label: "Pronunciation", group: "linguistic" },
  audio: { label: "Audio", group: "linguistic" },
  variants: { label: "Variants", group: "linguistic", complex: true },
  inflections: { label: "Inflections", group: "linguistic", complex: true },
  subjectStatusLabels: { label: "Subject / Status Labels", group: "linguistic" },
  usageLabels: { label: "Usage Labels", group: "linguistic" },
  grammar: { label: "Grammar", group: "linguistic" },
  etymology: { label: "Etymology", group: "historical", complex: true },
  firstKnownUse: { label: "First Known Use", group: "historical" },
  synonymDiscussion: { label: "Synonym Discussion", group: "relations", complex: true },
  usages: { label: "Usage Notes", group: "relations", complex: true },
  quotes: { label: "Quotes", group: "relations", complex: true },
  runOns: { label: "Run-ons", group: "relations", complex: true },
  derivedForms: { label: "Derived Forms", group: "relations", complex: true },
  sourcePath: { label: "Source Path", group: "debug" },
  rawSense: { label: "Raw Sense", group: "debug", complex: true },
  rawEntry: { label: "Raw Entry", group: "debug", complex: true },
});

export const MW_TABLE_MODES = Object.freeze({
  dictionary: {
    label: "Dictionary",
    columns: ["headword", "partOfSpeech", "senseNumber", "definitions", "examples"],
  },
  detailed: {
    label: "Detailed",
    columns: ["headword", "homograph", "partOfSpeech", "pronunciation", "senseNumber", "senseType", "subjectStatusLabels", "usageLabels", "grammar", "definitions", "examples", "etymology", "firstKnownUse"],
  },
  raw: {
    label: "Raw Schema",
    columns: [],
  },
});
