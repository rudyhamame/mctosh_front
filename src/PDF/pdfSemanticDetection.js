export const SEMANTIC_DETECTION_SCOPE = Object.freeze({
  CURRENT_PAGE: "selected_page",
  VISIBLE_PAGES: "visible_pages",
  PAGE_RANGE: "page_range",
  ENTIRE_DOCUMENT: "entire_document",
});

export const SEMANTIC_REGION_TYPES = Object.freeze([
  "chapter_title", "section_title", "subsection_title", "paragraph_title", "body_paragraph",
  "figure", "figure_caption", "table", "table_caption", "table_of_contents", "list", "equation", "header", "footer", "page_number", "unknown",
]);

const rowKey = (span) => Math.round((span.pageTop ?? span.geoTop ?? 0) * 4) / 4;

export const buildSemanticCandidates = (spans, pageIndex, imageRects = []) => {
  const rows = new Map();
  (Array.isArray(spans) ? spans : []).forEach((span, index) => {
    const text = String(span.text || span.str || "").trim();
    if (!text) return;
    const left = span.pageLeft ?? span.geoLeft ?? 0;
    const top = span.pageTop ?? span.geoTop ?? 0;
    const right = span.pageRight ?? span.geoRight ?? left;
    const bottom = span.pageBottom ?? top + (span.pageHeight ?? span.geoHeight ?? 0);
    const key = rowKey(span);
    const row = rows.get(key) || { pageIndex, index, left, top, right, bottom, texts: [] };
    row.left = Math.min(row.left, left); row.top = Math.min(row.top, top);
    row.right = Math.max(row.right, right); row.bottom = Math.max(row.bottom, bottom);
    row.texts.push(text);
    rows.set(key, row);
  });
  const candidates = [...rows.values()].sort((a, b) => a.top - b.top || a.left - b.left).map((row, index) => ({
    id: `p${pageIndex + 1}-text-${index + 1}`,
    pageIndex,
    bbox: { x: row.left, y: row.top, width: Math.max(0, row.right - row.left), height: Math.max(0, row.bottom - row.top) },
    text: row.texts.join(" "),
    kind: "text_block",
    features: { lineCount: 1, readingOrder: index },
  }));
  imageRects.forEach((rect, index) => candidates.push({
    id: `p${pageIndex + 1}-image-${index + 1}`,
    pageIndex,
    bbox: { x: rect.x, y: rect.y, width: rect.w, height: rect.h },
    kind: "image",
    features: { imageCoverage: 1, readingOrder: candidates.length },
  }));
  return candidates;
};

export const unionCandidateBoxes = (candidateIds, candidatesById) => {
  const candidates = (Array.isArray(candidateIds) ? candidateIds : []).map((id) => candidatesById.get(id)).filter(Boolean);
  if (!candidates.length) throw new Error("Semantic region has no valid candidates.");
  const left = Math.min(...candidates.map((item) => item.bbox.x));
  const top = Math.min(...candidates.map((item) => item.bbox.y));
  const right = Math.max(...candidates.map((item) => item.bbox.x + item.bbox.width));
  const bottom = Math.max(...candidates.map((item) => item.bbox.y + item.bbox.height));
  return { x: left, y: top, w: right - left, h: bottom - top };
};

export const semanticTypeToBBoxType = (type) => ({
  chapter_title: "bbox",
  section_title: "bbox",
  subsection_title: "bbox",
  paragraph_title: "bbox",
  body_paragraph: "bbox",
  figure: "imageBBox",
  list: "bbox",
  table: "bbox",
  table_of_contents: "bbox",
}[type] || null);
