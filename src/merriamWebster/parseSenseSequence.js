import { isRecord, isTaggedTuple } from "./guards";
import { parseDefinitionText } from "./parseDefinitionText";

const KNOWN_CONTAINER_TAGS = new Set(["pseq", "bs"]);

export const parseSenseSequence = (value, context, sourcePath) => {
  const rows = [];

  const walk = (node, path, inheritedType = context.senseTypeOverride) => {
    if (isTaggedTuple(node)) {
      const [tag, payload] = node;
      if (tag === "sense" || tag === "sen") {
        rows.push(context.createSenseRow(payload, inheritedType || tag, path));
        return;
      }
      if (KNOWN_CONTAINER_TAGS.has(tag)) {
        const nextType = inheritedType || tag;
        if (isRecord(payload) && (payload.dt || payload.sn || payload.sdsense)) {
          rows.push(context.createSenseRow(payload, nextType, path));
          return;
        }
        if (Array.isArray(payload)) {
          payload.forEach((item, index) => walk(item, `${path}[1][${index}]`, nextType));
          return;
        }
        if (isRecord(payload)) {
          Object.entries(payload).forEach(([key, item]) => {
            if (["sense", "sen", "sseq", "pseq", "bs"].includes(key)) {
              walk(item, `${path}[1].${key}`, nextType);
            }
          });
        }
        return;
      }
      context.unknownTags?.push({ tag, payload, sourcePath: path });
      return;
    }

    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}[${index}]`, inheritedType));
      return;
    }

    if (isRecord(node)) {
      if (node.dt || node.sn || node.sdsense) {
        rows.push(context.createSenseRow(node, inheritedType || "unknown", path));
        return;
      }
      Object.entries(node).forEach(([key, item]) => {
        if (["sense", "sen", "sseq", "pseq", "bs"].includes(key)) walk(item, `${path}.${key}`, inheritedType || (key === "sense" || key === "sen" ? key : undefined));
      });
    }
  };

  walk(value, sourcePath);
  return rows;
};

export const parseSensePayloadDefinition = (sense, sourcePath) => parseDefinitionText(sense?.dt, `${sourcePath}[1].dt`);
