const normalizeTitleLine = (value) => String(value || "")
  .normalize("NFKC")
  .replace(/\s+/g, " ")
  .replace(/[\s:;,.\-]+$/g, "")
  .trim()
  .toLocaleLowerCase();

export const removeParagraphTitleLine = (lines, title) => {
  const sourceLines = (Array.isArray(lines) ? lines : [])
    .map((line) => String(line || "").trim())
    .filter(Boolean);
  const titleKey = normalizeTitleLine(title);
  if (!titleKey) return { bodyLines: sourceLines, removedLine: "" };
  const titleIndex = sourceLines.findIndex((line) => normalizeTitleLine(line) === titleKey);
  if (titleIndex < 0) return { bodyLines: sourceLines, removedLine: "" };
  return {
    bodyLines: sourceLines.filter((_, index) => index !== titleIndex),
    removedLine: sourceLines[titleIndex],
  };
};

export const removeParagraphTitleFromText = (value, title) => {
  const text = String(value || "").trim();
  if (!text || !String(title || "").trim()) return text;
  const lines = text.split(/\r?\n/);
  const separated = removeParagraphTitleLine(lines, title);
  if (separated.removedLine) return separated.bodyLines.join("\n");
  const escapedTitle = String(title).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`^[\\s:;,.\\-]*${escapedTitle}[\\s:;,.\\-]*`, "i"), "").trim();
};
