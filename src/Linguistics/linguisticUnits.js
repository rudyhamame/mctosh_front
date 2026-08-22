export const LINGUISTIC_UNITS = [
  { id: "morpheme",  label: "Morpheme",  color: "#b39ddb", rank: 0, desc: "Smallest meaningful form (prefix, root, suffix)" },
  { id: "word",      label: "Word",      color: "#4fc3f7", rank: 1, desc: "Lexical / grammatical unit"                      },
  { id: "syntagm",   label: "Syntagm",   color: "#69f0ae", rank: 2, desc: "Phrase — NP, VP, PP, AdjP…"                     },
  { id: "clause",    label: "Clause",    color: "#fff176", rank: 3, desc: "Subject + predicate structure"                   },
  { id: "sentence",  label: "Sentence",  color: "#ffa94d", rank: 4, desc: "Complete autonomous utterance"                  },
  { id: "paragraph", label: "Paragraph", color: "#ff6b6b", rank: 5, desc: "Thematic discourse unit"                        },
];

export const unitById = (id) => LINGUISTIC_UNITS.find(u => u.id === id) ?? null;
