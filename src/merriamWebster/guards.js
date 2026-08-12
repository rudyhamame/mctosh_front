export const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const isMWEntry = (value) => isRecord(value) && (
  isRecord(value.meta)
  || isRecord(value.hwi)
  || Array.isArray(value.def)
  || Array.isArray(value.shortdef)
);

export const isTaggedTuple = (value) => (
  Array.isArray(value)
  && value.length >= 2
  && typeof value[0] === "string"
);

export const isSenseTuple = (value) => (
  isTaggedTuple(value)
  && ["sense", "sen", "bs", "pseq"].includes(value[0])
);

export const isDefinitionText = (value) => (
  Array.isArray(value)
  && value.every((item) => Array.isArray(item) || isTaggedTuple(item))
);

export const isVerbalIllustration = (value) => (
  isTaggedTuple(value)
  && value[0] === "vis"
  && Array.isArray(value[1])
);
