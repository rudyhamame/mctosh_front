const FULL_REPLACEMENT_THRESHOLD = 0.94;
const TOKEN_CORRECTION_THRESHOLD = 0.82;
const MIN_ACCEPTABLE_ALIGNMENT = 0.7;
const OCR_LINE_INTERSECTION_THRESHOLD = 0.35;

const protectedMedicalTerms = new Set([
  "ECG", "EEG", "EMG", "QRS", "QT", "PR", "AV", "SA", "BP", "HR", "RR",
  "SpO₂", "PaO₂", "PaCO₂", "CO₂", "O₂", "HCO₃⁻", "Na⁺", "K⁺", "Ca²⁺", "Cl⁻",
  "DNA", "RNA", "mRNA", "ATP", "ADP", "CT", "MRI", "PET", "ICU", "IV", "IM",
  "SC", "CNS", "PNS", "COPD", "ARDS", "STEMI", "NSTEMI",
  "HbA1c", "eGFR", "FiO₂", "FiO2", "EtCO₂", "EtCO2",
]);

export const normalizeForComparison = (value) => String(value || "")
  .normalize("NFKC")
  .replace(/[‐‑‒–—]/g, "-")
  .replace(/\s+/g, " ")
  .trim()
  .toLocaleLowerCase();

export const isProtectedMedicalToken = (token) => (
  protectedMedicalTerms.has(token)
  || /^[A-Z]{2,8}$/.test(token)
  || /^[A-Z]{1,5}\d+[A-Z\d]*$/.test(token)
  || /[₂₃₄⁺⁻²³]/u.test(token)
  || /^[A-Za-z]{1,4}[₀-₉]+$/u.test(token)
);

const scientificSymbols = (value) => String(value || "").match(/[₂₃₄⁺⁻²³α-ωΑ-Ω≥≤±°μ]/gu) || [];

export const validateScientificSymbols = (raw, corrected) => (
  scientificSymbols(raw).join("") === scientificSymbols(corrected).join("")
    ? []
    : ["Scientific symbols changed during correction"]
);

const editDistance = (left, right) => {
  const a = normalizeForComparison(left);
  const b = normalizeForComparison(right);
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length];
};

export const normalizedStringSimilarity = (left, right) => {
  const a = normalizeForComparison(left);
  const b = normalizeForComparison(right);
  if (!a && !b) return 1;
  return 1 - editDistance(a, b) / Math.max(1, a.length, b.length);
};

const words = (value) => String(value || "").match(/[\p{L}\p{N}₂₃₄⁺⁻²³]+/gu) || [];

export const buildTextCorrectionAudit = (rawValue, correctedValue, warnings = []) => {
  const rawTokens = words(rawValue);
  const correctedTokens = words(correctedValue);
  const entries = [];
  let rawIndex = 0;
  let correctedIndex = 0;
  const addEntry = (status, raw, corrected, rawCount, correctedCount) => {
    entries.push({
      status,
      raw,
      corrected,
      rawTokenIndexes: Array.from({ length: rawCount }, (_, offset) => rawIndex + offset),
      correctedTokenIndexes: Array.from({ length: correctedCount }, (_, offset) => correctedIndex + offset),
    });
    rawIndex += rawCount;
    correctedIndex += correctedCount;
  };

  while (rawIndex < rawTokens.length || correctedIndex < correctedTokens.length) {
    if (rawIndex >= rawTokens.length) {
      addEntry("inserted", "", correctedTokens[correctedIndex], 0, 1);
      continue;
    }
    if (correctedIndex >= correctedTokens.length) {
      addEntry("deleted", rawTokens[rawIndex], "", 1, 0);
      continue;
    }

    const rawToken = rawTokens[rawIndex];
    const correctedToken = correctedTokens[correctedIndex];
    const rawKey = normalizeForComparison(rawToken);
    const correctedKey = normalizeForComparison(correctedToken);
    if (rawKey === correctedKey) {
      addEntry(rawToken === correctedToken ? "unchanged" : "corrected", rawToken, correctedToken, 1, 1);
      continue;
    }

    let grouped = false;
    for (let count = Math.min(4, rawTokens.length - rawIndex); count >= 2; count -= 1) {
      const fragments = rawTokens.slice(rawIndex, rawIndex + count);
      if (normalizeForComparison(fragments.join("")) !== correctedKey) continue;
      addEntry("joined", fragments.join(" "), correctedToken, count, 1);
      grouped = true;
      break;
    }
    if (grouped) continue;
    for (let count = Math.min(4, correctedTokens.length - correctedIndex); count >= 2; count -= 1) {
      const fragments = correctedTokens.slice(correctedIndex, correctedIndex + count);
      if (rawKey !== normalizeForComparison(fragments.join(""))) continue;
      addEntry("split", rawToken, fragments.join(" "), 1, count);
      grouped = true;
      break;
    }
    if (grouped) continue;

    if (normalizeForComparison(rawTokens[rawIndex + 1]) === correctedKey) {
      addEntry("deleted", rawToken, "", 1, 0);
      continue;
    }
    if (rawKey === normalizeForComparison(correctedTokens[correctedIndex + 1])) {
      addEntry("inserted", "", correctedToken, 0, 1);
      continue;
    }

    const similarity = normalizedStringSimilarity(rawToken, correctedToken);
    addEntry(similarity >= TOKEN_CORRECTION_THRESHOLD ? "corrected" : "uncertain", rawToken, correctedToken, 1, 1);
  }

  const statusCounts = entries.reduce((counts, entry) => ({
    ...counts,
    [entry.status]: (counts[entry.status] || 0) + 1,
  }), {});
  const accountedRawTokenCount = entries.reduce((count, entry) => count + entry.rawTokenIndexes.length, 0);
  const accountedCorrectedTokenCount = entries.reduce((count, entry) => count + entry.correctedTokenIndexes.length, 0);
  const unresolvedCount = (statusCounts.uncertain || 0) + (statusCounts.inserted || 0) + (statusCounts.deleted || 0);
  const warningList = (warnings || []).filter(Boolean);
  return {
    entries,
    summary: {
      rawTokenCount: rawTokens.length,
      correctedTokenCount: correctedTokens.length,
      accountedRawTokenCount,
      accountedCorrectedTokenCount,
      silentOmissionCount: Math.max(0, rawTokens.length - accountedRawTokenCount),
      unresolvedCount,
      warningCount: warningList.length,
      statusCounts,
      verified: unresolvedCount === 0
        && warningList.length === 0
        && accountedRawTokenCount === rawTokens.length
        && accountedCorrectedTokenCount === correctedTokens.length,
    },
  };
};

const isExplicitProtectedMedicalToken = (token) => (
  protectedMedicalTerms.has(String(token || ""))
  || /^[A-Z]{1,5}\d+[A-Z\d]*$/.test(String(token || ""))
  || /^[A-Z][a-z]+[A-Z]\d[A-Za-z\d]*$/.test(String(token || ""))
  || /[₂₃₄⁺⁻²³]/u.test(String(token || ""))
  || /^[A-Za-z]{1,4}[₀-₉]+$/u.test(String(token || ""))
);

export const normalizeNaturalCasing = (value) => {
  const text = String(value || "");
  return text.replace(/[\p{L}\p{N}₂₃₄⁺⁻²³]+/gu, (token, offset) => {
    if (isExplicitProtectedMedicalToken(token)) return token;
    return token.toLocaleLowerCase();
  });
};

export const capitalizeSentenceStarts = (value) => normalizeNaturalCasing(value);

const restoreSplitWordsFromReference = (value, correctedReference) => {
  const text = String(value || "");
  const referenceWords = new Map();
  for (const token of words(correctedReference)) {
    const key = normalizeForComparison(token);
    if (key.length >= 4 && !referenceWords.has(key)) referenceWords.set(key, token);
  }
  if (!referenceWords.size) return text;

  const tokens = [...text.matchAll(/[\p{L}\p{N}₂₃₄⁺⁻²³]+/gu)].map((match) => ({
    text: match[0],
    start: match.index,
    end: match.index + match[0].length,
  }));
  const replacements = [];
  for (let index = 0; index < tokens.length;) {
    let replacement = null;
    const maxParts = Math.min(4, tokens.length - index);
    for (let partCount = maxParts; partCount >= 2; partCount -= 1) {
      const parts = tokens.slice(index, index + partCount);
      const whitespaceOnly = parts.slice(0, -1).every((part, partIndex) => (
        /^[ \t]+$/.test(text.slice(part.end, parts[partIndex + 1].start))
      ));
      if (!whitespaceOnly) continue;
      const joinedKey = normalizeForComparison(parts.map((part) => part.text).join(""));
      const referenceWord = referenceWords.get(joinedKey);
      if (!referenceWord) continue;
      replacement = {
        start: parts[0].start,
        end: parts[parts.length - 1].end,
        text: referenceWord,
        partCount,
      };
      break;
    }
    if (replacement) {
      replacements.push(replacement);
      index += replacement.partCount;
    } else {
      index += 1;
    }
  }

  return replacements.reduceRight((result, replacement) => (
    `${result.slice(0, replacement.start)}${replacement.text}${result.slice(replacement.end)}`
  ), text);
};

export const applyOcrTokenCasing = (value, correctedReference) => {
  const casingByToken = new Map();
  for (const token of words(correctedReference)) {
    const key = normalizeForComparison(token);
    if (key && !casingByToken.has(key)) casingByToken.set(key, token);
  }
  const boundaryCorrected = restoreSplitWordsFromReference(value, correctedReference);
  return capitalizeSentenceStarts(boundaryCorrected.replace(/[\p{L}\p{N}₂₃₄⁺⁻²³]+/gu, (token) => (
    naturalCaseToken(casingByToken.get(normalizeForComparison(token)) || token, token)
  )));
};

const naturalCaseToken = (token, rawToken = "") => {
  const value = String(token || "");
  const raw = String(rawToken || "");
  if (!value) return value;
  if (isExplicitProtectedMedicalToken(value) || isExplicitProtectedMedicalToken(raw)) {
    return isExplicitProtectedMedicalToken(raw) ? raw : value;
  }
  return value.toLocaleLowerCase();
};

const cleanMarkdownLine = (line) => String(line || "")
  .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/, "")
  .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
  .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
  .replace(/[*_`~|]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const cleanOcrCandidateText = (value) => String(value || "")
  .split(/\r?\n/)
  .map(cleanMarkdownLine)
  .map((line) => line.replace(/(?:\s*-{3,}\s*)+/g, " ").replace(/\s+/g, " ").trim())
  .filter(Boolean)
  .join("\n");

const ocrWordWindowCandidates = (ocrText, rawText) => {
  const ocrTokens = words(ocrText);
  const rawTokens = words(rawText);
  if (!ocrTokens.length || !rawTokens.length || ocrTokens.length <= rawTokens.length + 8) return [];
  const rawAnchor = rawTokens.slice(0, Math.min(4, rawTokens.length)).map(normalizeForComparison);
  const starts = [];
  for (let start = 0; start < ocrTokens.length; start += 1) {
    let matches = 0;
    for (let offset = 0; offset < rawAnchor.length && start + offset < ocrTokens.length; offset += 1) {
      if (normalizeForComparison(ocrTokens[start + offset]) === rawAnchor[offset]) matches += 1;
    }
    if (matches >= Math.max(1, Math.ceil(rawAnchor.length * 0.5))) starts.push(start);
  }
  const candidates = [];
  for (const start of starts.slice(0, 24)) {
    for (let delta = -4; delta <= 8; delta += 2) {
      const length = Math.max(1, rawTokens.length + delta);
      const text = ocrTokens.slice(start, start + length).join(" ").trim();
      if (text) candidates.push(text);
    }
  }
  return candidates;
};

const rectIntersectionRatio = (bbox, lineBBox) => {
  if (!bbox || !lineBBox) return 0;
  const ax = bbox.x ?? 0;
  const ay = bbox.y ?? 0;
  const aw = bbox.width ?? bbox.w ?? 0;
  const ah = bbox.height ?? bbox.h ?? 0;
  const bx = lineBBox.x ?? 0;
  const by = lineBBox.y ?? 0;
  const bw = lineBBox.width ?? lineBBox.w ?? 0;
  const bh = lineBBox.height ?? lineBBox.h ?? 0;
  const width = Math.max(0, Math.min(ax + aw, bx + bw) - Math.max(ax, bx));
  const height = Math.max(0, Math.min(ay + ah, by + bh) - Math.max(ay, by));
  const intersection = width * height;
  // A paragraph BBox may occupy only a small part of one large OCR table
  // block. Treat strong containment in either direction as a geometric
  // match; token-window alignment narrows the large block afterward.
  return Math.max(
    intersection / Math.max(1, bw * bh),
    intersection / Math.max(1, aw * ah),
  );
};

const markdownCandidates = (markdown, rawText) => {
  const lines = String(markdown || "").split(/\r?\n/).map(cleanMarkdownLine).filter(Boolean);
  const targetWords = Math.max(1, words(rawText).length);
  const candidates = [];
  for (let start = 0; start < lines.length; start += 1) {
    let candidate = "";
    for (let end = start; end < Math.min(lines.length, start + 8); end += 1) {
      candidate = `${candidate} ${lines[end]}`.trim();
      const count = words(candidate).length;
      if (count >= Math.max(1, targetWords - 4) && count <= targetWords + 8) candidates.push(candidate);
      if (count > targetWords + 8) break;
    }
  }
  for (const line of lines) candidates.push(...ocrWordWindowCandidates(line, rawText));
  return [...new Set(candidates)];
};

const chooseOcrCandidate = ({ rawPdfText, bboxPdf, ocrPage }) => {
  const geometricLines = (ocrPage?.lines || [])
    .filter((line) => line?.text && rectIntersectionRatio(bboxPdf, line.bbox) >= OCR_LINE_INTERSECTION_THRESHOLD)
    .sort((a, b) => (a.bbox?.y ?? 0) - (b.bbox?.y ?? 0) || (a.bbox?.x ?? 0) - (b.bbox?.x ?? 0));
  const geometricText = cleanOcrCandidateText(geometricLines.map((line) => line.text).join("\n"));
  const candidates = geometricLines.length
    ? [geometricText, ...ocrWordWindowCandidates(geometricText, rawPdfText)]
    : markdownCandidates(ocrPage?.markdown, rawPdfText);
  return [...new Set(candidates.filter(Boolean))]
    .map((text) => ({ text, similarity: normalizedStringSimilarity(rawPdfText, text) }))
    .sort((a, b) => b.similarity - a.similarity)[0] || null;
};

const alignTokens = (rawTokens, ocrTokens) => {
  const rows = rawTokens.length + 1;
  const cols = ocrTokens.length + 1;
  const score = Array.from({ length: rows }, () => Array(cols).fill(0));
  const move = Array.from({ length: rows }, () => Array(cols).fill(""));
  for (let i = 1; i < rows; i += 1) { score[i][0] = -i; move[i][0] = "up"; }
  for (let j = 1; j < cols; j += 1) { score[0][j] = -j; move[0][j] = "left"; }
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const similarity = normalizedStringSimilarity(rawTokens[i - 1], ocrTokens[j - 1]);
      const options = [
        { value: score[i - 1][j - 1] + (similarity * 2 - 1), move: "diag" },
        { value: score[i - 1][j] - 1, move: "up" },
        { value: score[i][j - 1] - 1, move: "left" },
      ].sort((a, b) => b.value - a.value);
      score[i][j] = options[0].value;
      move[i][j] = options[0].move;
    }
  }
  const aligned = [];
  let i = rawTokens.length;
  let j = ocrTokens.length;
  while (i || j) {
    if (move[i][j] === "diag") {
      aligned.push({ rawIndex: i - 1, ocrIndex: j - 1, similarity: normalizedStringSimilarity(rawTokens[i - 1], ocrTokens[j - 1]) });
      i -= 1; j -= 1;
    } else if (move[i][j] === "up") {
      aligned.push({ rawIndex: i - 1, ocrIndex: null, similarity: 0 }); i -= 1;
    } else {
      aligned.push({ rawIndex: null, ocrIndex: j - 1, similarity: 0 }); j -= 1;
    }
  }
  return aligned.reverse();
};

const correctAlignedTokens = (rawText, ocrText) => {
  const rawTokens = words(rawText);
  const ocrTokens = words(ocrText);
  const aligned = alignTokens(rawTokens, ocrTokens);
  const rawByOcrIndex = new Map();
  for (const item of aligned) {
    if (item.rawIndex == null || item.ocrIndex == null || item.similarity < TOKEN_CORRECTION_THRESHOLD) continue;
    rawByOcrIndex.set(item.ocrIndex, rawTokens[item.rawIndex]);
  }
  let ocrIndex = 0;
  const correctedText = capitalizeSentenceStarts(String(ocrText).replace(/[\p{L}\p{N}₂₃₄⁺⁻²³]+/gu, (token) => {
    const rawToken = rawByOcrIndex.get(ocrIndex);
    ocrIndex += 1;
    return naturalCaseToken(token, rawToken);
  }));
  return {
    correctedText,
    replacementCount: aligned.filter((item) => item.rawIndex != null && item.ocrIndex != null && item.similarity >= TOKEN_CORRECTION_THRESHOLD).length,
  };
};

export async function correctBBoxText({ rawPdfText, bboxPdf, ocrPage } = {}) {
  const rawText = String(rawPdfText || "");
  const audited = (result) => ({
    ...result,
    correctionAudit: buildTextCorrectionAudit(result.rawText, result.correctedText, result.correctionWarnings),
  });
  if (!rawText.trim()) {
    return audited({ rawText, correctedText: rawText, ocrCandidateText: "", correctionSource: "pdf_text_layer", correctionConfidence: 1, correctionWarnings: [] });
  }
  const candidate = chooseOcrCandidate({ rawPdfText: rawText, bboxPdf, ocrPage });
  if (!candidate || candidate.similarity < MIN_ACCEPTABLE_ALIGNMENT) {
    return audited({
      rawText,
      correctedText: normalizeNaturalCasing(rawText),
      ocrCandidateText: candidate?.text || "",
      correctionSource: "pdf_text_layer",
      correctionConfidence: candidate?.similarity || 0,
      correctionWarnings: ["No reliable OCR alignment was found"],
    });
  }
  const corrected = correctAlignedTokens(rawText, candidate.text);
  const warnings = validateScientificSymbols(rawText, corrected.correctedText);
  if (warnings.length) {
    return audited({ rawText, correctedText: normalizeNaturalCasing(rawText), ocrCandidateText: candidate.text, correctionSource: "pdf_text_layer", correctionConfidence: candidate.similarity, correctionWarnings: warnings });
  }
  const source = corrected.replacementCount ? "ocr_alignment" : "pdf_text_layer";
  return audited({
    rawText,
    correctedText: normalizeNaturalCasing(corrected.correctedText || rawText),
    ocrCandidateText: candidate.text,
    correctionSource: source,
    correctionConfidence: candidate.similarity >= FULL_REPLACEMENT_THRESHOLD ? candidate.similarity : Math.min(candidate.similarity, 0.93),
    correctionWarnings: source === "ocr_alignment" ? [] : ["OCR alignment did not produce a safe correction"],
  });
}

export const BBOX_TEXT_CORRECTION_VERSION = "1.5.0";
