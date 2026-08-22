export const UMLS_LANGUAGE_STORAGE_KEY = "mctosh_umls_language";
export const UMLS_LANGUAGE_CHANGE_EVENT = "mctosh:umls-language-change";

export const UMLS_LANGUAGE_OPTIONS = [
  { code: "ENG", label: "English" },
  { code: "ARA", label: "Arabic" },
  { code: "CHI", label: "Chinese" },
  { code: "CZE", label: "Czech" },
  { code: "DAN", label: "Danish" },
  { code: "DUT", label: "Dutch" },
  { code: "FIN", label: "Finnish" },
  { code: "FRE", label: "French" },
  { code: "GER", label: "German" },
  { code: "GRE", label: "Greek" },
  { code: "HEB", label: "Hebrew" },
  { code: "HUN", label: "Hungarian" },
  { code: "ITA", label: "Italian" },
  { code: "JPN", label: "Japanese" },
  { code: "KOR", label: "Korean" },
  { code: "NOR", label: "Norwegian" },
  { code: "POL", label: "Polish" },
  { code: "POR", label: "Portuguese" },
  { code: "RUS", label: "Russian" },
  { code: "SPA", label: "Spanish" },
  { code: "SWE", label: "Swedish" },
  { code: "TUR", label: "Turkish" },
];

const validCodes = new Set(UMLS_LANGUAGE_OPTIONS.map(({ code }) => code));

export const normalizeUmlsLanguage = (value) => {
  const code = String(value || "").trim().toUpperCase();
  return validCodes.has(code) ? code : "ENG";
};

export const readUmlsLanguage = () => {
  if (typeof window === "undefined") return "ENG";
  return normalizeUmlsLanguage(window.localStorage.getItem(UMLS_LANGUAGE_STORAGE_KEY));
};

export const writeUmlsLanguage = (value) => {
  const language = normalizeUmlsLanguage(value);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(UMLS_LANGUAGE_STORAGE_KEY, language);
    window.dispatchEvent(new CustomEvent(UMLS_LANGUAGE_CHANGE_EVENT, { detail: { language } }));
  }
  return language;
};
