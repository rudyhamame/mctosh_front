import { normalizePdfText } from "./pdfTextNormalizer.js";
import { weightedEditDistance, similarityFromDistance } from "./pdfFuzzySearch.js";
import { analyzePageLayout, blockToText, buildLines } from "./pdfPageLayout.js";

// Deterministic, local text-matching — no AI/LLM call. The page's Markdown
// (already cached server-side from Tesseract OCR — see getPageText in
// PDFPage.jsx) gives real paragraph boundaries; the PDF's own text layer
// gives real geometry. Matching one against the other with the same
// fuzzy/normalization tools the search bar already uses is enough to place
// a bbox per paragraph without needing a model call for something this
// mechanical.
// Low enough to keep short-but-real headings ("Cardiac Output", "Etiology")
// rather than only ever catching full body paragraphs, high enough to
// still drop page numbers/lone digits/stray single words.
const MIN_PARAGRAPH_CHARS = 8;
const MATCH_SIMILARITY_THRESHOLD = 0.55;
const MATCH_START_ANCHOR_THRESHOLD = 0.52;
// A short prefix can score slightly higher than the full paragraph when the
// final lines contain OCR substitutions. Within this tolerance, prefer the
// candidate whose normalized length is closest to the target so the visual
// rectangle does not stop before the paragraph ends.
// OCR noise on a final left-column line can lower the complete-run score
// enough to make a one-line-short prefix look marginally better. Treat those
// close scores as equivalent and let length completeness decide.
const MATCH_SCORE_TIE_WINDOW = 0.16;
// Stop extending a candidate run of lines once its own text is already this
// many times longer than the paragraph it's being matched against — past
// that point it can only get a worse score, no need to keep scanning.
const MAX_WINDOW_OVERSHOOT = 1.6;

const compactOf = (text) => normalizePdfText(text).compactText;
const layoutTrackKey = (line) => `${line?.isFullWidth ? "full" : "column"}:${line?.columnIndex ?? "none"}`;

// Small pages and sparse pages may not provide enough recurring line gaps for
// pdfPageLayout's statistical gutter detector. A large, repeated horizontal
// gap between item centers is still safe evidence of two columns; use it only
// when the normal result has produced one track, never to override a stronger
// layout classification.
const buildSparseTwoColumnLines = (spatialItems) => {
  if (spatialItems.length < 4) return [];
  const heights = spatialItems.map((item) => item.y2 - item.y1).sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)] || 1;
  const centers = [...new Set(spatialItems.map((item) => (item.x1 + item.x2) / 2))].sort((a, b) => a - b);
  let split = null;
  let largestGap = 0;
  for (let index = 1; index < centers.length; index += 1) {
    const gap = centers[index] - centers[index - 1];
    if (gap > largestGap) {
      largestGap = gap;
      split = (centers[index] + centers[index - 1]) / 2;
    }
  }
  if (split == null || largestGap < Math.max(28, medianHeight * 4)) return [];
  const leftItems = spatialItems.filter((item) => (item.x1 + item.x2) / 2 <= split);
  const rightItems = spatialItems.filter((item) => (item.x1 + item.x2) / 2 > split);
  if (leftItems.length < 2 || rightItems.length < 2) return [];
  const makeColumnBlocks = (items, columnIndex) => buildLines(items).map((line) => ({
    ...line,
    xMin: Math.min(...line.items.map((item) => item.x1)),
    xMax: Math.max(...line.items.map((item) => item.x2)),
    isFullWidth: false,
    columnIndex,
  }));
  return [...makeColumnBlocks(leftItems, 0), ...makeColumnBlocks(rightItems, 1)]
    .sort((a, b) => a.columnIndex - b.columnIndex || a.y1 - b.y1);
};

// Smart Segmenting receives PDFPage's page-space spans rather than the raw
// PDF.js items used by the search index. Convert them into the layout module's
// common spatial shape, then use its gutter/column/zone reading order. A
// naive top-to-bottom sort interleaves left and right columns whenever their
// baselines are aligned, making the end of a left paragraph look like a
// continuation of the right paragraph beside it.
export const buildSmartSegmentLines = (spans) => {
  const spatialItems = (Array.isArray(spans) ? spans : [])
    .filter((span) => String(span?.text || "").trim())
    .map((span, itemIndex) => ({
      text: span.text,
      x1: span.pageLeft ?? span.geoLeft ?? 0,
      x2: span.pageRight ?? span.geoRight ?? 0,
      y1: span.pageTop ?? span.geoTop ?? 0,
      y2: span.pageBottom ?? ((span.pageTop ?? span.geoTop ?? 0) + (span.pageHeight ?? span.geoHeight ?? 0)),
      pageHeight: span.pageHeight ?? span.geoHeight ?? 0,
      itemIndex,
      hasEOL: Boolean(span.hasEOL),
    }))
    .filter((item) => item.x2 > item.x1 && item.y2 > item.y1);

  const layout = analyzePageLayout(spatialItems);
  const normalTracks = new Set(layout.blocks.map(layoutTrackKey));
  const sparseTwoColumnBlocks = normalTracks.size <= 1 ? buildSparseTwoColumnLines(spatialItems) : [];
  const blocks = normalTracks.size <= 1
    ? (sparseTwoColumnBlocks.length ? sparseTwoColumnBlocks : layout.blocks)
    : layout.blocks;
  return blocks
    .map((block) => {
      const { text } = blockToText(block);
      return {
        text: text.trim(),
        rect: {
          x: block.xMin,
          y: block.y1,
          w: Math.max(0, block.xMax - block.xMin),
          h: Math.max(0, block.y2 - block.y1),
        },
        columnIndex: block.columnIndex,
        isFullWidth: block.isFullWidth,
      };
    })
    .filter((line) => line.text && line.rect.w > 0 && line.rect.h > 0);
};

// If OCR returned a single interleaved block for a multi-column page, there
// is no trustworthy paragraph boundary left in Markdown to match. The PDF
// text layer still gives us a safe fallback: group adjacent visual lines that
// belong to the same column and are vertically close, never joining a left
// line to a right line just because their baselines align.
export const buildVisualFallbackBBoxes = (lines) => {
  const groups = [];
  for (const line of lines) {
    const candidates = groups
      .map((group) => {
        const previousLine = group.lines[group.lines.length - 1];
        const overlapX = Math.max(0, Math.min(
          previousLine.rect.x + previousLine.rect.w,
          line.rect.x + line.rect.w,
        ) - Math.max(previousLine.rect.x, line.rect.x));
        const narrowerWidth = Math.max(1, Math.min(previousLine.rect.w, line.rect.w));
        const leftDelta = Math.abs(previousLine.rect.x - line.rect.x);
        const sameVisualColumn = overlapX / narrowerWidth >= 0.35
          || leftDelta <= Math.max(18, narrowerWidth * 0.18);
        const verticalGap = line.rect.y - (previousLine.rect.y + previousLine.rect.h);
        const verticallyAdjacent = verticalGap >= -Math.max(3, previousLine.rect.h * 0.3)
          && verticalGap <= Math.max(18, previousLine.rect.h * 1.8);
        return { group, previousLine, verticalGap, leftDelta, eligible: sameVisualColumn && verticallyAdjacent };
      })
      .filter((candidate) => candidate.eligible)
      .sort((a, b) => a.verticalGap - b.verticalGap || a.leftDelta - b.leftDelta);
    if (candidates.length) candidates[0].group.lines.push(line);
    else groups.push({ lines: [line] });
  }
  return groups.map(({ lines: groupLines }) => {
    const left = Math.min(...groupLines.map((line) => line.rect.x));
    const top = Math.min(...groupLines.map((line) => line.rect.y));
    const right = Math.max(...groupLines.map((line) => line.rect.x + line.rect.w));
    const bottom = Math.max(...groupLines.map((line) => line.rect.y + line.rect.h));
    return {
      text: groupLines.map((line) => line.text).join(" "),
      rect: { x: left, y: top, w: right - left, h: bottom - top },
    };
  });
};

const cleanMarkdownBlock = (block) => String(block || "")
  .replace(/^#{1,6}\s+/gm, "")
  .replace(/^>\s?/gm, "")
  .replace(/^[-*+]\s+/gm, "")
  .replace(/^\d+[.)]\s+/gm, "")
  .replace(/\*\*([^*]+)\*\*/g, "$1")
  .replace(/\*([^*]+)\*/g, "$1")
  .replace(/`([^`]+)`/g, "$1")
  .replace(/\|/g, " ")
  .replace(/[ \t]+/g, " ")
  .trim();

const isAllCapsHeading = (value) => {
  const letters = String(value || "").replace(/[^A-Za-z]+/g, "");
  return letters.length >= 3 && letters === letters.toUpperCase();
};

const isChapterHeading = (value) => /^chapter\s+(?:\d+|[ivxlcdm]+)\b/i.test(String(value || "").trim());

const looksLikeOcrTitle = (value) => {
  const text = String(value || "").trim();
  const letters = text.replace(/[^A-Za-z]+/g, "");
  return letters.length >= 3
    && text.length <= 100
    && text.split(/\s+/).length <= 10
    && !/[.!?;:]$/.test(text)
    && !/^\d+$/.test(text);
};

const parseOcrBulletItems = (raw) => {
  const items = [];
  let current = null;
  for (const sourceLine of String(raw || "").split(/\r?\n/)) {
    const markerMatch = sourceLine.match(/^\s*(?:(?:[-+•◦▪‣]|\d+[.)])\s+|\*(?!\*)\s*)(\S.*)$/);
    if (markerMatch) {
      if (current) items.push(current);
      current = cleanMarkdownBlock(markerMatch[1]);
    } else if (current && sourceLine.trim()) {
      current = `${current} ${cleanMarkdownBlock(sourceLine)}`.trim();
    }
  }
  if (current) items.push(current);
  return items.filter((item) => item.length >= MIN_PARAGRAPH_CHARS);
};

// OCR blocks are the structural source. Markdown characters are stripped
// from each OCR line, but their presence or heading depth never determines
// whether the line is a section or paragraph title.
const parseOcrBlock = (raw) => {
  const lines = String(raw || "")
    .split(/\r?\n/)
    .map((line) => cleanMarkdownBlock(line))
    .filter(Boolean);
  const firstLine = lines[0] || "";
  const title = looksLikeOcrTitle(firstLine) ? firstLine : "";
  return {
    title,
    bodyText: title ? lines.slice(1).join(" ").trim() : cleanMarkdownBlock(raw),
  };
};

const parseOcrTableRows = (raw) => {
  const tableLines = String(raw || "")
    .split(/\r?\n/)
    .filter((line) => /^\s*\|.*\|\s*$/.test(line));
  if (tableLines.length < 2) return [];

  const isSeparatorRow = (line) => line
    .replace(/^\s*\||\|\s*$/g, "")
    .split("|")
    .every((cell) => /^\s*:?-{3,}:?\s*$/.test(cell));

  return tableLines.flatMap((line, rowIndex) => {
    if (isSeparatorRow(line) || isSeparatorRow(tableLines[rowIndex + 1] || "")) return [];
    const cells = line
      .replace(/^\s*\||\|\s*$/g, "")
      .split("|")
      .map((cell) => cleanMarkdownBlock(cell))
      .filter((cell) => cell && !/^:?-{3,}:?$/.test(cell));
    // Header-only rows do not represent a paragraph. A data row uses its
    // first meaningful cell as the paragraph title and the rest as its body.
    if (cells.length < 2) return [];
    const [title, ...bodyCells] = cells;
    const bodyText = bodyCells.join(" ").trim();
    if (!title || !bodyText) return [];
    return [{
      raw: line,
      text: `${title} ${bodyText}`,
      ocrTitle: title,
      ocrBodyText: bodyText,
      isTableRow: true,
    }];
  });
};

const splitOcrBlocks = (ocrText) => String(ocrText || "")
  .split(/\n\s*\n+/)
  .flatMap((block) => {
    const tableRows = parseOcrTableRows(block);
    if (tableRows.length) return tableRows;
    const ocr = parseOcrBlock(block);
    return [{
      raw: block,
      text: cleanMarkdownBlock(block),
      ocrTitle: ocr.title,
      ocrBodyText: ocr.bodyText,
      ocrBulletItems: parseOcrBulletItems(block),
      isTableRow: false,
    }];
  })
  .filter((block) => block.ocrTitle || block.text.length >= MIN_PARAGRAPH_CHARS);

// A Markdown heading owns every following body/list block until the next
// heading. This is important for medical callouts such as KEY FACT, where two
// bullet blocks are one visual/semantic paragraph and must produce one bbox.
// Media starts a new region so an Axis section does not absorb its following
// ECG image and figure caption.
const buildOcrParagraphRecords = (ocrText) => {
  const records = [];
  let section = null;
  let pendingFigure = false;
  let pendingParagraphTitle = null;
  const flushSection = () => {
    if (!section) return;
    const children = section.parts.map((part) => ({
      text: part.text,
      title: part.title || "",
      matchText: part.matchText || part.text,
      children: part.children || [],
    }));
    records.push({
      // The section owns one title and can contain multiple titled/untitled
      // paragraph records beneath it.
      text: section.parts.length ? section.parts.map((part) => part.text).join("\n\n") : section.title,
      matchText: [section.title, ...section.parts.map((part) => part.matchText || part.text)].filter(Boolean).join("\n\n"),
      title: section.title,
      isSection: children.length > 0,
      isChapter: Boolean(section.isChapter),
      isTable: Boolean(section.isTable),
      isFigure: false,
      children,
    });
    section = null;
  };
  const appendBulletItems = (items) => {
    const bullets = items.map((text) => ({ text, matchText: text, title: "", isBullet: true, children: [] }));
    const stagedTitle = pendingParagraphTitle || "";
    if (!section) {
      const text = items.join("\n");
      records.push({
        text,
        matchText: text,
        title: stagedTitle,
        isSection: false,
        isTable: false,
        isFigure: false,
        children: bullets,
      });
      pendingParagraphTitle = null;
      return;
    }

    let part = !stagedTitle ? section.parts[section.parts.length - 1] : null;
    if (!part) {
      part = { text: "", title: stagedTitle, matchText: "", children: [] };
      section.parts.push(part);
    }
    part.text = [part.text, ...items].filter(Boolean).join("\n");
    part.matchText = [part.matchText, ...items].filter(Boolean).join("\n");
    part.children = [...(part.children || []), ...bullets];
    pendingParagraphTitle = null;
  };
  for (const block of splitOcrBlocks(ocrText)) {
    const isMedia = /^!\[[^\]]*\]\([^)]*\)/.test(block.raw.trim());
    const isParagraphHeadingInsideSection = Boolean(
      !isMedia
      && !pendingFigure
      && block.ocrTitle
      && section
      && isAllCapsHeading(section.title)
      && !isAllCapsHeading(block.ocrTitle),
    );
    if (block.isTableRow) {
      // A mixed-case table caption can be staged as a paragraph heading under
      // an all-caps running header. Promote it to the table's own section title
      // instead of attaching the table rows to that unrelated page header.
      if (pendingParagraphTitle) {
        const tableTitle = pendingParagraphTitle;
        pendingParagraphTitle = null;
        flushSection();
        section = { title: tableTitle, parts: [], isTable: true };
      } else if (!section) {
        section = { title: "Table", parts: [], isTable: true };
      }
      section.isTable = true;
      section.parts.push({
        text: block.ocrBodyText,
        title: block.ocrTitle,
        matchText: `${block.ocrTitle}\n\n${block.ocrBodyText}`,
      });
      pendingParagraphTitle = null;
    } else if (block.ocrBulletItems?.length) {
      appendBulletItems(block.ocrBulletItems);
    } else if (isMedia) {
      flushSection();
      pendingFigure = true;
      pendingParagraphTitle = null;
    } else if (!pendingFigure && block.ocrTitle && !isParagraphHeadingInsideSection) {
      flushSection();
      pendingFigure = false;
      pendingParagraphTitle = null;
      section = { title: block.ocrTitle, parts: [], isChapter: isChapterHeading(block.ocrTitle) };
      if (block.ocrBodyText) section.parts.push({ text: block.ocrBodyText, title: "", matchText: block.ocrBodyText });
    } else if (isParagraphHeadingInsideSection) {
      pendingParagraphTitle = block.ocrTitle;
      if (block.ocrBodyText) {
        section.parts.push({
          text: block.ocrBodyText,
          title: block.ocrTitle,
          matchText: `${block.ocrTitle}\n\n${block.ocrBodyText}`,
        });
        pendingParagraphTitle = null;
      }
    } else if (pendingFigure) {
      const figureTitle = block.text.match(/^\s*(FIG(?:URE)?\s+\S+)/i)?.[1]?.trim() || "Figure";
      records.push({
        text: block.text,
        title: figureTitle,
        isSection: true,
        isFigure: true,
        children: [{ text: block.text, title: "" }],
      });
      pendingFigure = false;
    } else if (section) {
      const title = pendingParagraphTitle || "";
      const body = block.ocrBodyText || block.text;
      section.parts.push({
        text: body,
        title,
        matchText: title ? `${title}\n\n${body}` : body,
      });
      pendingParagraphTitle = null;
    } else {
      const title = pendingParagraphTitle || "";
      const body = block.ocrBodyText || block.text;
      records.push({
        text: body,
        matchText: title ? `${title}\n\n${body}` : body,
        title,
        isSection: false,
        isFigure: false,
        children: [],
      });
      pendingParagraphTitle = null;
    }
  }
  if (pendingParagraphTitle) {
    records.push({ text: "", matchText: pendingParagraphTitle, title: pendingParagraphTitle, isSection: false, isFigure: false, children: [] });
  }
  flushSection();
  return records;
};

// Public compatibility helper used by the existing tests and callers.
export const splitMarkdownIntoParagraphs = (markdown) => (
  splitOcrBlocks(markdown).map((block) => block.text)
);

// Ordered forward matcher: walks the page's text lines (already in reading
// order — groupSpansIntoLines sorts top-to-bottom, left-to-right) while
// searching every still-available start position for each Markdown paragraph.
// OCR Markdown can contain a paragraph that the PDF text layer cannot see
// (tables, figures, or a single OCR error). Searching forward instead of
// pinning the next paragraph to the old cursor keeps one missing paragraph
// from poisoning every match after it.
//
// Returns [{ text, rect }] — one entry per paragraph it could confidently
// place. A paragraph it can't confidently match (e.g. a table OCR
// rendered very differently from the PDF's own text layer, or a caption
// pulled from a figure) is just skipped rather than force-matched to the
// wrong lines — better to under-segment than to draw a wrong box.
// `debug`, if passed an array, gets one entry per paragraph attempted
// (matched or not) — { paragraph, bestScore, matched } — purely so
// PDFPage.jsx's runSmartSegmenting can console.log exactly where/why a
// real page came back with zero matches (empty markdown vs. empty spans
// vs. every paragraph scoring under threshold are otherwise
// indistinguishable from the outside). No effect on the returned matches.
export const matchParagraphsToLines = (paragraphs, lines, debug = null) => {
  const results = [];
  const linesByTrack = new Map();
  for (const line of lines) {
    const track = layoutTrackKey(line);
    const trackLines = linesByTrack.get(track) || [];
    trackLines.push(line);
    linesByTrack.set(track, trackLines);
  }
  // OCR can emit the right column before the left column. Keep progress per
  // visual track so that matching a right-column paragraph does not advance a
  // single global cursor past all of the left-column lines.
  const trackCursors = new Map();
  for (const paragraph of paragraphs) {
    const paragraphText = typeof paragraph === "string" ? paragraph : (paragraph?.matchText || paragraph?.text);
    const paragraphBodyText = typeof paragraph === "string" ? paragraph : (paragraph?.bodyText ?? paragraph?.text);
    const targetCompact = compactOf(paragraphText);
    if (targetCompact.length < MIN_PARAGRAPH_CHARS) {
      debug?.push({ paragraph: paragraphText, bestScore: null, matched: false, reason: "too-short" });
      continue;
    }

    let bestStart = -1;
    let bestEnd = -1;
    let bestScore = -1;
    let bestLengthDelta = Infinity;
    let bestTrack = "";
    let bestMatchedLines = [];
    for (const [track, trackLines] of linesByTrack) {
      const cursor = trackCursors.get(track) ?? 0;
      for (let start = cursor; start < trackLines.length; start++) {
        const startCompact = compactOf(trackLines[start].text);
        const anchorLength = Math.min(64, startCompact.length, targetCompact.length);
        const hasExplicitTitle = typeof paragraph !== "string" && Boolean(paragraph?.title);
        if (anchorLength < (hasExplicitTitle ? 3 : MIN_PARAGRAPH_CHARS)) continue;
        const startAnchor = startCompact.slice(0, anchorLength);
        const targetAnchor = targetCompact.slice(0, anchorLength);
        const anchorDistance = weightedEditDistance(startAnchor, targetAnchor);
        const anchorScore = similarityFromDistance(anchorDistance, startAnchor.length, targetAnchor.length);
        // Overall fuzzy similarity alone can favor an interior run whose length
        // happens to resemble the OCR paragraph. Geometry must begin where the
        // paragraph's opening text begins, otherwise the saved text is complete
        // while the visible bbox starts one or more lines too low.
        if (anchorScore < MATCH_START_ANCHOR_THRESHOLD) continue;
        let accumulated = "";
        for (let end = start; end < trackLines.length; end++) {
          accumulated += compactOf(trackLines[end].text);
          // Do not accept an attractive short prefix as the whole paragraph.
          // Requiring most of the target text makes the resulting visual box
          // reach the paragraph's final line instead of stopping early.
          if (accumulated.length >= targetCompact.length * 0.78) {
            // Comparing only up to a little past the target's own length keeps
            // weightedEditDistance's O(n*m) cost bounded even if a run of tiny
            // lines lets `accumulated` run long before hitting the overshoot cap.
            const candidate = accumulated.length > targetCompact.length + 20
              ? accumulated.slice(0, targetCompact.length + 20)
              : accumulated;
            const distance = weightedEditDistance(candidate, targetCompact);
            const score = similarityFromDistance(distance, candidate.length, targetCompact.length);
            const lengthDelta = Math.abs(accumulated.length - targetCompact.length);
            const isBetterScore = score > bestScore + MATCH_SCORE_TIE_WINDOW;
            const isComparableButMoreComplete = score >= bestScore - MATCH_SCORE_TIE_WINDOW
              && lengthDelta < bestLengthDelta;
            if (isBetterScore || isComparableButMoreComplete) {
              bestScore = score;
              bestLengthDelta = lengthDelta;
              bestStart = start;
              bestEnd = end;
              bestTrack = track;
              bestMatchedLines = trackLines.slice(start, end + 1);
            }
          }
          if (accumulated.length >= targetCompact.length * MAX_WINDOW_OVERSHOOT) break;
        }
      }
    }

    const matched = bestStart !== -1 && bestEnd !== -1 && bestScore >= MATCH_SIMILARITY_THRESHOLD;
    debug?.push({ paragraph: paragraphText, bestScore, matched });
    if (!matched) continue;

    // A noisy final line can make the shorter prefix score slightly better
    // than the complete paragraph. If the selected run is still shorter than
    // the target, cautiously claim the next line only when it matches the
    // remaining paragraph text and stays on the same visual track.
    const matchedLines = [...bestMatchedLines];
    const matchedTrackLines = linesByTrack.get(bestTrack) || [];
    let nextLineIndex = bestEnd + 1;
    let matchedLength = matchedLines.reduce((length, line) => length + compactOf(line.text).length, 0);
    while (nextLineIndex < matchedTrackLines.length && matchedLength < targetCompact.length * 0.95) {
      const nextLine = matchedTrackLines[nextLineIndex];
      const nextCompact = compactOf(nextLine.text);
      const remainingTarget = targetCompact.slice(matchedLength);
      const continuationLength = Math.min(nextCompact.length, remainingTarget.length);
      if (continuationLength < MIN_PARAGRAPH_CHARS) break;
      const continuation = nextCompact.slice(0, continuationLength);
      const continuationScore = similarityFromDistance(
        weightedEditDistance(continuation, remainingTarget.slice(0, continuationLength)),
        continuation.length,
        continuationLength,
      );
      if (continuationScore < 0.42) break;
      matchedLines.push(nextLine);
      matchedLength += nextCompact.length;
      nextLineIndex += 1;
    }
    const left = Math.min(...matchedLines.map((l) => l.rect.x));
    const right = Math.max(...matchedLines.map((l) => l.rect.x + l.rect.w));
    const top = Math.min(...matchedLines.map((l) => l.rect.y));
    const bottom = Math.max(...matchedLines.map((l) => l.rect.y + l.rect.h));
    results.push({
      text: paragraphBodyText,
      title: typeof paragraph === "string" ? "" : (paragraph?.title || ""),
      isSection: typeof paragraph === "string" ? false : Boolean(paragraph?.isSection),
      isChapter: typeof paragraph === "string" ? false : Boolean(paragraph?.isChapter),
      isFigure: typeof paragraph === "string" ? false : Boolean(paragraph?.isFigure),
      children: typeof paragraph === "string" ? [] : (paragraph?.children || []),
      rect: { x: left, y: top, w: right - left, h: bottom - top },
      columnIndex: matchedLines[0]?.columnIndex ?? null,
      isFullWidth: Boolean(matchedLines[0]?.isFullWidth),
    });
    trackCursors.set(bestTrack, nextLineIndex);
  }
  return results;
};

const unionSegmentRects = (segments) => {
  if (!segments.length) return null;
  const left = Math.min(...segments.map((segment) => segment.rect.x));
  const top = Math.min(...segments.map((segment) => segment.rect.y));
  const right = Math.max(...segments.map((segment) => segment.rect.x + segment.rect.w));
  const bottom = Math.max(...segments.map((segment) => segment.rect.y + segment.rect.h));
  return { x: left, y: top, w: right - left, h: bottom - top };
};

// A table row often spans two visual tracks: the first cell contains its
// title while the remaining cells contain its body. The ordinary matcher
// deliberately never crosses tracks, so match the cells independently and
// union their geometry into one semantic paragraph bbox.
const matchTableRecordToLines = (table, lines, debug = null) => {
  const childSegments = table.children.flatMap((child) => {
    const combined = matchParagraphsToLines([child], lines)[0];
    if (combined) return [{ ...combined, kind: "paragraph", childSegments: [] }];

    const titleMatch = matchParagraphsToLines([{
      text: child.title,
      matchText: child.title,
      title: child.title,
    }], lines)[0];
    const bodyMatch = matchParagraphsToLines([child.text], lines)[0];
    const parts = [titleMatch, bodyMatch].filter(Boolean);
    const rect = unionSegmentRects(parts);
    if (!rect || !titleMatch || !bodyMatch) return [];
    return [{
      text: child.text,
      title: child.title,
      rect,
      columnIndex: titleMatch.columnIndex,
      isFullWidth: false,
      kind: "paragraph",
      childSegments: [],
    }];
  });

  const caption = matchParagraphsToLines([{
    text: table.title,
    matchText: table.title,
    title: table.title,
  }], lines)[0];
  const rect = unionSegmentRects([caption, ...childSegments].filter(Boolean));
  const matched = Boolean(rect && childSegments.length);
  debug?.push({ paragraph: table.matchText, bestScore: matched ? 1 : -1, matched, table: true });
  if (!matched) return null;
  return {
    text: table.text,
    title: table.title,
    isSection: true,
    isTable: true,
    isFigure: false,
    children: table.children,
    rect,
    columnIndex: caption?.columnIndex ?? childSegments[0]?.columnIndex ?? null,
    isFullWidth: Boolean(caption?.isFullWidth),
    kind: "section",
    childSegments,
  };
};

const looksLikeParagraphTitle = (text) => {
  const value = String(text || "").trim();
  return value.length >= MIN_PARAGRAPH_CHARS
    && value.length <= 140
    && !/[.!?]$/.test(value)
    && value.split(/\s+/).length <= 14;
};

const mergeAdjacentTitles = (matches) => {
  const merged = [];
  for (const match of matches) {
    const previous = merged[merged.length - 1];
    const sameTrack = previous
      && previous.columnIndex === match.columnIndex
      && previous.isFullWidth === match.isFullWidth;
    const verticalGap = sameTrack ? match.rect.y - (previous.rect.y + previous.rect.h) : Infinity;
    const titleCanJoin = sameTrack
      && looksLikeParagraphTitle(previous.text)
      && verticalGap <= Math.max(18, previous.rect.h * 1.8);
    if (titleCanJoin) {
      const left = Math.min(previous.rect.x, match.rect.x);
      const top = Math.min(previous.rect.y, match.rect.y);
      const right = Math.max(previous.rect.x + previous.rect.w, match.rect.x + match.rect.w);
      const bottom = Math.max(previous.rect.y + previous.rect.h, match.rect.y + match.rect.h);
      merged[merged.length - 1] = {
        ...match,
        title: previous.title || previous.text.split("\n")[0].trim(),
        // Keep the title separate from the body text stored on the card.
        text: match.text,
        rect: { x: left, y: top, w: right - left, h: bottom - top },
      };
    } else {
      merged.push(match);
    }
  }
  return merged;
};

const looksLikeVisualTitle = (text) => {
  const value = String(text || "").trim();
  return value.length >= 2
    && value.length <= 80
    && value.split(/\s+/).length <= 8
    && !/[.!?]$/.test(value)
    && !/^\d+$/.test(value);
};

const attachUnmatchedVisualTitles = (matches, lines) => matches.map((match) => {
  const expectedTitle = String(match.title || "").trim();
  const expectedTitleCompact = compactOf(expectedTitle);
  const candidates = lines
    .filter((line) => {
      if (expectedTitleCompact) {
        if (compactOf(line.text) !== expectedTitleCompact) return false;
      } else if (!looksLikeVisualTitle(line.text)) return false;
      const lineArea = Math.max(1, line.rect.w * line.rect.h);
      const belongsToAnotherParagraph = matches.some((other) => {
        if (other === match) return false;
        const overlapX = Math.max(0, Math.min(
          line.rect.x + line.rect.w,
          other.rect.x + other.rect.w,
        ) - Math.max(line.rect.x, other.rect.x));
        const overlapY = Math.max(0, Math.min(
          line.rect.y + line.rect.h,
          other.rect.y + other.rect.h,
        ) - Math.max(line.rect.y, other.rect.y));
        return overlapX * overlapY >= lineArea * 0.75;
      });
      if (belongsToAnotherParagraph) return false;
      const lineBottom = line.rect.y + line.rect.h;
      const verticalGap = match.rect.y - lineBottom;
      if (verticalGap < -1 || verticalGap > Math.max(22, line.rect.h * 1.8)) return false;
      const overlapX = Math.max(0, Math.min(
        line.rect.x + line.rect.w,
        match.rect.x + match.rect.w,
      ) - Math.max(line.rect.x, match.rect.x));
      const narrowerWidth = Math.max(1, Math.min(line.rect.w, match.rect.w));
      const leftDelta = Math.abs(line.rect.x - match.rect.x);
      return overlapX / narrowerWidth >= 0.5
        || leftDelta <= Math.max(14, narrowerWidth * 0.2);
    })
    .sort((a, b) => (match.rect.y - (a.rect.y + a.rect.h)) - (match.rect.y - (b.rect.y + b.rect.h)));
  const titleLine = candidates[0];
  if (!titleLine) return match;
  const left = Math.min(titleLine.rect.x, match.rect.x);
  const top = Math.min(titleLine.rect.y, match.rect.y);
  const right = Math.max(titleLine.rect.x + titleLine.rect.w, match.rect.x + match.rect.w);
  const bottom = Math.max(titleLine.rect.y + titleLine.rect.h, match.rect.y + match.rect.h);
  const title = expectedTitle || titleLine.text.trim();
  return {
    ...match,
    title,
    text: match.text,
    rect: { x: left, y: top, w: right - left, h: bottom - top },
  };
});

const linesInsideRect = (lines, rect) => lines.filter((line) => {
    const centerX = line.rect.x + line.rect.w / 2;
    const centerY = line.rect.y + line.rect.h / 2;
    return centerX >= rect.x
      && centerX <= rect.x + rect.w
      && centerY >= rect.y
      && centerY <= rect.y + rect.h;
  });

const attachParagraphBullets = (match, lines) => {
  const bullets = (match.children || []).filter((child) => child.isBullet);
  if (!bullets.length) return { ...match, kind: "paragraph", childSegments: [] };
  const paragraphLines = linesInsideRect(lines, match.rect);
  const childSegments = matchParagraphsToLines(bullets, paragraphLines)
    .map((bullet) => ({ ...bullet, kind: "bullet", childSegments: [] }));
  return { ...match, kind: "paragraph", childSegments };
};

const attachSectionParagraphs = (matches, lines) => matches.map((match) => {
  if (!match.isSection || !match.children?.length) return attachParagraphBullets(match, lines);
  const sectionLines = linesInsideRect(lines, match.rect);
  const childSegments = matchParagraphsToLines(match.children, sectionLines)
    .map((paragraph) => attachParagraphBullets(paragraph, sectionLines));
  return { ...match, kind: "section", childSegments };
});

// A section with one logical paragraph is a titled paragraph, not a section
// container. Keep the section geometry so its title remains inside the same
// BBox, while preserving any nested bullet segments. Figures stay special
// because their child is a caption paired with an image.
const collapseSingleParagraphSections = (matches) => matches.map((match) => {
  if (
    match.kind !== "section"
    || match.isFigure
    || match.childSegments?.length > 1
  ) return match;
  const paragraph = match.childSegments?.[0];
  return {
    ...match,
    kind: "paragraph",
    isSection: false,
    text: paragraph?.text || match.text,
    title: match.title || paragraph?.title || "",
    childSegments: paragraph?.childSegments || [],
  };
});

const attachFigureImages = (matches, imageRects) => {
  const usedImages = new Set();
  return matches.map((match) => {
    if (!match.isFigure) return match;
    const candidates = (imageRects || [])
      .map((rect, index) => {
        const overlapX = Math.max(0, Math.min(rect.x + rect.w, match.rect.x + match.rect.w) - Math.max(rect.x, match.rect.x));
        const narrowerWidth = Math.max(1, Math.min(rect.w, match.rect.w));
        const verticalGap = match.rect.y - (rect.y + rect.h);
        return { rect, index, verticalGap, overlapRatio: overlapX / narrowerWidth };
      })
      .filter((candidate) => (
        !usedImages.has(candidate.index)
        && candidate.verticalGap >= -4
        && candidate.verticalGap <= 320
        && candidate.overlapRatio >= 0.3
      ))
      .sort((a, b) => a.verticalGap - b.verticalGap || b.overlapRatio - a.overlapRatio);
    const image = candidates[0];
    if (!image) return match;
    usedImages.add(image.index);
    const left = Math.min(image.rect.x, match.rect.x);
    const top = Math.min(image.rect.y, match.rect.y);
    const right = Math.max(image.rect.x + image.rect.w, match.rect.x + match.rect.w);
    const bottom = Math.max(image.rect.y + image.rect.h, match.rect.y + match.rect.h);
    return {
      ...match,
      imageSegment: { rect: image.rect, title: "Figure image", text: "" },
      rect: { x: left, y: top, w: right - left, h: bottom - top },
    };
  });
};

// Full pipeline: this page's own Markdown text + page-space text spans (any
// granularity — line or item level both work, see
// buildPageSpansForSmartSegmenting in PDFPage.jsx) -> candidate paragraph
// rects, ready to become real bbox annotations once the caller assigns
// ids/colors/border settings.
export const segmentPageIntoParagraphBBoxes = (markdown, spans, debug = null, imageRects = []) => {
  const paragraphs = buildOcrParagraphRecords(markdown);
  if (debug) debug.paragraphCount = paragraphs.length;
  if (!paragraphs.length) return [];
  const lines = buildSmartSegmentLines(spans);
  if (debug) debug.lineCount = lines.length;
  if (!lines.length) return [];
  const attempts = debug ? [] : null;
  const regularParagraphs = paragraphs.filter((paragraph) => !paragraph.isTable);
  const tableMatches = paragraphs
    .filter((paragraph) => paragraph.isTable)
    .map((table) => matchTableRecordToLines(table, lines, attempts))
    .filter(Boolean);
  const regularMatches = collapseSingleParagraphSections(attachSectionParagraphs(
    attachUnmatchedVisualTitles(
      mergeAdjacentTitles(matchParagraphsToLines(regularParagraphs, lines, attempts)),
      lines,
    ),
    lines,
  ));
  const combinedMatches = tableMatches.length
    ? [...regularMatches, ...tableMatches].sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x)
    : regularMatches;
  const results = attachFigureImages(combinedMatches, imageRects);
  if (results.length) {
    const lineSharesMatchedColumn = (line) => results.some((result) => {
      const overlapX = Math.max(0, Math.min(line.rect.x + line.rect.w, result.rect.x + result.rect.w) - Math.max(line.rect.x, result.rect.x));
      const narrowerWidth = Math.max(1, Math.min(line.rect.w, result.rect.w));
      const lineCenter = line.rect.x + line.rect.w / 2;
      const resultCenter = result.rect.x + result.rect.w / 2;
      return overlapX / narrowerWidth >= 0.35
        || Math.abs(lineCenter - resultCenter) <= Math.max(24, narrowerWidth * 0.3);
    });
    // A successful right-column match must not suppress recovery of an
    // unmatched left column. Fill only geometry not already represented by
    // a confident Markdown match, avoiding duplicate boxes on matched text.
    const unmatchedFallback = buildVisualFallbackBBoxes(lines.filter((line) => !lineSharesMatchedColumn(line)));
    if (debug) {
      debug.attempts = attempts;
      debug.partialVisualFallbackCount = unmatchedFallback.length;
    }
    return [...results, ...unmatchedFallback];
  }

  const fallback = buildVisualFallbackBBoxes(lines);
  if (debug) {
    debug.attempts = attempts;
    debug.usedVisualFallback = fallback.length > 0;
  }
  return fallback;
};
