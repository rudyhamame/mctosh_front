import { describe, expect, it } from "vitest";
import { detectMWResponseType } from "./detectResponse";
import { flattenRawJson } from "./flattenRawJson";
import { normalizeMWResponse } from "./normalizeResponse";
import { parseMWMarkup } from "./parseMarkup";

const entry = (overrides = {}) => ({
  meta: { id: "heart:1", uuid: "abc123", src: "collegiate", offensive: false },
  hom: 1,
  hwi: { hw: "heart", prs: [{ mw: "ˈhärt", sound: { audio: "heart001" } }] },
  fl: "noun",
  ...overrides,
});

const definition = (sseq, overrides = {}) => ({ sseq, ...overrides });

describe("Merriam-Webster response interpreter", () => {
  it("normalizes a normal sense as the primary row", () => {
    const response = [entry({ def: [definition([[["sense", { sn: "1 a", dt: [["text", "{bc}a hollow muscular organ"]] }]]])], shortdef: ["a hollow muscular organ"] })];
    const normalized = normalizeMWResponse(response);
    expect(normalized.type).toBe("entries");
    expect(normalized.rows).toHaveLength(1);
    expect(normalized.rows[0]).toMatchObject({
      entryIndex: 0,
      entryId: "heart:1",
      headword: "heart",
      partOfSpeech: "noun",
      pronunciation: ["ˈhärt"],
      audio: ["heart001"],
      senseNumber: "1 a",
      senseType: "sense",
      definitions: ["a hollow muscular organ"],
      sourcePath: "response[0].def[0].sseq[0][0]",
    });
    expect(normalized.rows[0].rawEntry).toBe(response[0]);
  });

  it("extracts examples and preserves attribution/raw markup", () => {
    const response = [entry({ def: [definition([[["sense", { sn: "1", dt: [["text", "{bc}definition"], ["vis", [{ t: "the patient's {wi}heart{/wi} was examined", aq: { auth: "A Doctor" } }]]] }]]])] })];
    const row = normalizeMWResponse(response).rows[0];
    expect(row.examples).toEqual(["the patient's heart was examined"]);
    expect(row.exampleDetails[0].attribution).toEqual({ auth: "A Doctor" });
    expect(row.definitionComponents[0].rawText).toBe("{bc}definition");
  });

  it("recursively parses nested pseq senses", () => {
    const response = [entry({ def: [definition([[["pseq", [[["sense", { sn: "2", dt: [["text", "{bc}nested"]] }]]]]]])] })];
    const row = normalizeMWResponse(response).rows[0];
    expect(row.senseType).toBe("pseq");
    expect(row.definitions).toEqual(["nested"]);
    expect(row.sourcePath).toContain("[1]");
  });

  it("parses binding substitutes and marks them as bs", () => {
    const response = [entry({ def: [definition([[["bs", { sense: { sn: "3", dt: [["text", "{bc}binding substitute"]] } }]]])] })];
    const row = normalizeMWResponse(response).rows[0];
    expect(row.senseType).toBe("bs");
    expect(row.senseNumber).toBe("3");
    expect(row.sourcePath).toContain(".sense");
  });

  it("normalizes abbreviated sen tuples", () => {
    const response = [entry({ def: [definition([[["sen", { sn: "4", dt: [["text", "{bc}abbreviated sense"]] }]]])] })];
    expect(normalizeMWResponse(response).rows[0]).toMatchObject({ senseType: "sen", definitions: ["abbreviated sense"] });
  });

  it("keeps divided senses distinct from parent definitions", () => {
    const response = [entry({ def: [definition([[["sense", { sn: "5", dt: [["text", "{bc}parent"]], sdsense: { sd: "especially", dt: [["text", "{bc}divided"]] } }]]])] })];
    const row = normalizeMWResponse(response).rows[0];
    expect(row.definitions).toEqual(["parent"]);
    expect(row.dividedSense).toBe("especially");
    expect(row.dividedDefinitions).toEqual(["divided"]);
  });

  it("supports multiple definition blocks", () => {
    const response = [entry({ def: [
      definition([[["sense", { sn: "1", dt: [["text", "{bc}first"]] }]]]),
      definition([[["sense", { sn: "2", dt: [["text", "{bc}second"]] }]]]),
    ] })];
    expect(normalizeMWResponse(response).rows.map((row) => row.definitions[0])).toEqual(["first", "second"]);
  });

  it("supports multiple homographs", () => {
    const response = [
      entry({ hom: 1, def: [definition([[["sense", { sn: "1", dt: [["text", "{bc}noun"]] }]]])] }),
      entry({ meta: { id: "heart:2" }, hom: 2, fl: "verb", def: [definition([[["sense", { sn: "1", dt: [["text", "{bc}verb"]] }]]])] }),
    ];
    expect(normalizeMWResponse(response).rows.map((row) => [row.homograph, row.partOfSpeech])).toEqual([[1, "noun"], [2, "verb"]]);
  });

  it("parses defined run-ons through the same sense parser", () => {
    const response = [entry({ def: [], dros: [{ drp: "heart of hearts", def: [definition([[["sense", { sn: "1", dt: [["text", "{bc}innermost feelings"]] }]]])] }] })];
    const row = normalizeMWResponse(response).rows[0];
    expect(row).toMatchObject({ headword: "heart of hearts", runOnPhrase: "heart of hearts", senseType: "dros", definitions: ["innermost feelings"] });
    expect(row.sourcePath).toContain("response[0].dros[0].def[0]");
  });

  it("creates a fallback semantic row for an entry without def", () => {
    const row = normalizeMWResponse([entry({ shortdef: ["a short definition"] })]).rows[0];
    expect(row).toMatchObject({ senseType: "unknown", definitions: ["a short definition"], sourcePath: "response[0]" });
  });

  it("detects and preserves suggestion responses", () => {
    const response = ["heart", "hearty", "heartily"];
    expect(detectMWResponseType(response)).toBe("suggestions");
    expect(normalizeMWResponse(response)).toMatchObject({ type: "suggestions", suggestions: response, rows: [] });
  });

  it("preserves unknown tagged tuples without breaking known rows", () => {
    const response = [entry({
      def: [definition([
        ["mystery", { value: true }],
        [["sense", { dt: [["text", "{bc}known"]] }]],
      ])],
    })];
    const normalized = normalizeMWResponse(response);
    expect(normalized.rows[0].definitions).toEqual(["known"]);
    expect(normalized.unknownTags[0]).toMatchObject({ tag: "mystery", sourcePath: "response[0].def[0].sseq[0]" });
  });

  it("cleans known inline markup without mutating raw text", () => {
    expect(parseMWMarkup("{bc}a {it}hollow{/it} {d_link|organ|organ:1}")).toEqual({ rawText: "{bc}a {it}hollow{/it} {d_link|organ|organ:1}", displayText: "a hollow organ" });
  });

  it("flattens the complete raw schema with untruncated paths and primitive types", () => {
    const rows = flattenRawJson([{ meta: { id: "heart:1", offensive: false }, value: null }]);
    expect(rows).toContainEqual({ path: "response[0].meta.id", type: "string", value: "heart:1" });
    expect(rows).toContainEqual({ path: "response[0].meta.offensive", type: "boolean", value: false });
    expect(rows).toContainEqual({ path: "response[0].value", type: "null", value: null });
  });
});
