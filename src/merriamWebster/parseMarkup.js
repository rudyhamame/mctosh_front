const SIMPLE_TOKENS = Object.freeze({
  bc: ": ",
  ldquo: "“",
  rdquo: "”",
  laquo: "«",
  raquo: "»",
  inf: "",
  "/inf": "",
  sup: "",
  "/sup": "",
  it: "",
  "/it": "",
  wi: "",
  "/wi": "",
  sc: "",
  "/sc": "",
  phrase: "",
  "/phrase": "",
  qword: "",
  "/qword": "",
  parahw: "",
  "/parahw": "",
});

const readableToken = (token) => {
  if (Object.hasOwn(SIMPLE_TOKENS, token)) return SIMPLE_TOKENS[token];
  const [tag, ...parts] = token.split("|");
  if (["sx", "d_link", "a_link", "i_link", "et_link", "mat", "phrase", "dx", "dxt", "ri"].includes(tag)) {
    return parts.find((part) => part && !/^https?:/i.test(part)) || "";
  }
  if (tag === "gloss") return parts[0] ? `(${parts[0]})` : "";
  if (tag === "sup" || tag === "inf") return parts[0] || "";
  return parts.length ? parts[0] || "" : "";
};

export const parseMWMarkup = (value) => {
  const rawText = String(value ?? "");
  const displayText = rawText
    .replace(/\{([^{}]+)\}/g, (_match, token) => readableToken(token))
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/^\s*:\s*/, "")
    .trim();
  return { rawText, displayText };
};

export const cleanMWText = (value) => parseMWMarkup(value).displayText;
