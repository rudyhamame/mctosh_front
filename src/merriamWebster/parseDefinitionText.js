import { isTaggedTuple, isVerbalIllustration } from "./guards";
import { parseMWMarkup } from "./parseMarkup";

const emptyResult = () => ({
  definitions: [],
  examples: [],
  definitionComponents: [],
  exampleDetails: [],
  notes: [],
  supplemental: [],
  unknown: [],
});

const merge = (target, source) => {
  for (const key of Object.keys(target)) {
    if (Array.isArray(source?.[key])) target[key].push(...source[key]);
  }
};

const extractIllustrations = (payload, sourcePath) => {
  if (!Array.isArray(payload)) return [];
  return payload.map((illustration, index) => {
    const parsed = parseMWMarkup(illustration?.t || "");
    return {
      ...parsed,
      attribution: illustration?.aq || null,
      raw: illustration,
      sourcePath: `${sourcePath}[${index}]`,
    };
  }).filter((item) => item.displayText);
};

export const parseDefinitionText = (dt, sourcePath = "dt") => {
  const result = emptyResult();
  if (!Array.isArray(dt)) return result;

  dt.forEach((component, index) => {
    const path = `${sourcePath}[${index}]`;
    if (!isTaggedTuple(component)) {
      if (Array.isArray(component)) merge(result, parseDefinitionText(component, path));
      else result.supplemental.push({ value: component, sourcePath: path });
      return;
    }

    const [tag, payload] = component;
    if (tag === "text") {
      const parsed = parseMWMarkup(payload);
      if (parsed.displayText) result.definitions.push(parsed.displayText);
      result.definitionComponents.push({ tag, ...parsed, sourcePath: path });
      return;
    }
    if (isVerbalIllustration(component)) {
      const examples = extractIllustrations(payload, `${path}[1]`);
      result.examples.push(...examples.map((item) => item.displayText));
      result.exampleDetails.push(...examples);
      return;
    }
    if (["snote", "ri", "ca"].includes(tag)) {
      result.notes.push({ tag, payload, sourcePath: path });
      return;
    }
    if (["uns", "bnw"].includes(tag)) {
      result.supplemental.push({ tag, payload, sourcePath: path });
      if (Array.isArray(payload)) merge(result, parseDefinitionText(payload, `${path}[1]`));
      return;
    }
    result.unknown.push({ tag, payload, sourcePath: path });
  });

  return result;
};
