// pdfPageLayout.js
//
// Page layout analysis: reconstructs true reading order from PDF.js text
// items' raw positions, BEFORE any text normalization or search indexing
// happens. content.items is not guaranteed to be in human reading order —
// for a two-column page in particular, naively concatenating items in
// their PDF-stream order can interleave unrelated left/right column
// content into one nonsensical string. This module fixes that at the
// source: pdfSearchIndex.js's originalText is built FROM this module's
// output, not from raw item order, and PDFPage.jsx's interactive
// selection (double-click word merge, drag-handle line-to-line
// continuation) uses the same row/column grouping so both stay
// consistent with each other.
//
// Pure, DOM-free, deterministic — takes plain {text, x1, x2, y1, y2}
// spatial items (already in viewport-scaled PDF-space coordinates; see
// itemsFromPdfJs() for how PDF.js's own item.transform/item.width feed
// this) and returns a reading-order reconstruction. No canvas
// measureText, no getBoundingClientRect — see pdfPageLayout.test.js and
// PDFPage.jsx's own geo* span fields for why that matters (WebKit has
// confirmed getBoundingClientRect quirks with this app's zoom feature
// that don't affect deterministic PDF-transform math).
//
// Architecture (spec):
//   PDF.js text items
//     -> spatial normalization (itemsFromPdfJs)
//     -> line reconstruction (buildLines)
//     -> per-line segmentation + column-gutter detection (detectGutters)
//     -> block classification: full-width vs column-N (classifyBlocks)
//     -> reading-order reconstruction, zone-aware (buildReadingOrder)
//
// Scope note: this implements the core geometric reconstruction (lines,
// N-column detection via gap-position consensus, full-width blocks,
// zone-based reading order, hyphenation/dehyphenation staying column-
// local). It does not implement dedicated table-grid detection, running
// header/footer stripping, or a full visual debug overlay — those are
// real, separate features or extensive UI work.  A wrong column count
// just falls back to reading order (1 column = today's plain top-to-
// bottom behavior), which is a safe degradation, not silent data loss.

/** Multiplies pageViewport.transform × item.transform (same math PDF.js's own text layer and PDFPage.jsx's span-building effect use) to get an item's viewport-space origin + font size. */
const transformItem = (item, viewportTransform) => {
  const vt = viewportTransform;
  const it = item.transform;
  const tx = [
    vt[0] * it[0] + vt[2] * it[1],
    vt[1] * it[0] + vt[3] * it[1],
    vt[0] * it[2] + vt[2] * it[3],
    vt[1] * it[2] + vt[3] * it[3],
    vt[0] * it[4] + vt[2] * it[5] + vt[4],
    vt[1] * it[4] + vt[3] * it[5] + vt[5],
  ];
  const fontSize = Math.hypot(tx[0], tx[1]);
  const scale = Math.hypot(vt[0], vt[1]);
  return { x: tx[4], y: tx[5], fontSize, width: item.width * scale };
};

/**
 * Converts PDF.js content.items (for one page) into plain spatial items
 * {text, x1, x2, y1, y2, itemIndex} using pageViewport.transform (a plain
 * 6-number array — pass `pageViewport.transform`, not the viewport object
 * itself, to keep this pure/DOM-free). One item per PDF.js text item
 * (unlike PDFPage.jsx's own span-building, which further splits each item
 * into word/whitespace tokens for click hit-testing — layout analysis
 * only needs item-level granularity).
 *
 * `viewportTransform` is optional. When omitted (e.g. building the search
 * index, which has no rendered canvas/viewport at all — it only ever
 * touches PDF.js's plain content.items), this falls back to PDF.js's own
 * raw item.transform directly. Every threshold this module uses is
 * derived from the data's own average line height, not a fixed pixel
 * value, so an unscaled coordinate space produces identical layout
 * decisions — only the ABSOLUTE numbers differ, never the relative ones
 * the algorithm actually reasons about. The one real difference: PDF
 * space has Y increasing UPWARD (bottom-left origin), so it's negated
 * here to keep ascending sort meaning "top of page first", matching the
 * viewport-transformed path's convention.
 */
export const itemsFromPdfJs = (items, viewportTransform = null) => {
  const out = [];
  for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
    const item = items[itemIndex];
    if (!item.str) continue;
    let x, y, fontSize, width;
    if (viewportTransform) {
      ({ x, y, fontSize, width } = transformItem(item, viewportTransform));
    } else {
      const t = item.transform;
      fontSize = Math.hypot(t[0], t[1]);
      width = item.width;
      x = t[4];
      y = -t[5];
    }
    if (fontSize < 1) continue;
    out.push({
      text: item.str,
      x1: x, x2: x + width,
      y1: y - fontSize * 0.8, y2: y + fontSize * 0.2,
      itemIndex,
      hasEOL: !!item.hasEOL,
      fontSize,
    });
  }
  return out;
};

/**
 * Groups items into visual lines via one deterministic pass sorted by y1
 * — NOT a pairwise "is this close enough to the OTHER item" comparator.
 * That distinction matters: a pairwise-tolerance comparator isn't
 * transitive (A close to B and B close to C doesn't imply A close to C,
 * which genuinely happens when a drop-cap sits a couple pixels off from
 * the rest of its own word), and Array.prototype.sort requires a
 * transitive comparator for well-defined, ENGINE-CONSISTENT results —
 * confirmed live (this exact bug, in PDFPage.jsx's selection code): V8
 * and JavaScriptCore produced different orderings for an ill-defined
 * comparator on identical input. A single top-to-bottom pass assigning a
 * fixed integer line index has no such ambiguity.
 */
export const buildLines = (items) => {
  if (!items.length) return [];
  const avgHeight = items.reduce((s, it) => s + (it.y2 - it.y1), 0) / items.length || 1;
  const lineTolerance = Math.max(4, avgHeight * 0.6);
  const sorted = [...items].sort((a, b) => a.y1 - b.y1);
  const lines = [];
  let current = null;
  let refY = null;
  for (const item of sorted) {
    if (refY === null || Math.abs(item.y1 - refY) > lineTolerance) {
      current = { lineIndex: lines.length, y1: item.y1, y2: item.y2, items: [] };
      lines.push(current);
      refY = item.y1;
    }
    current.items.push(item);
    current.y1 = Math.min(current.y1, item.y1);
    current.y2 = Math.max(current.y2, item.y2);
  }
  for (const line of lines) line.items.sort((a, b) => a.x1 - b.x1);
  return lines;
};

// A candidate gutter must be at least this many line-heights wide to
// qualify at all (the vote-count + width-ranking in detectGutters is what
// actually picks the real gutter out of several qualifying candidates —
// this floor just keeps ordinary word-to-word spacing, a couple pixels
// wide at most, out of consideration entirely). Confirmed live against a
// real distorted-font document at RAW PDF.js item granularity (not
// PDFPage.jsx's own finer word/whitespace-token spans): a genuine,
// visually obvious inter-column gutter measured only ~3.0x the page's
// average line height — right at the previous 3x floor, so ordinary
// per-row jitter pushed some/most rows just under it and the gutter went
// completely undetected (zero votes, not just a marginal shortfall,
// since this is a hard cutoff). 2.5x leaves headroom below that real
// gutter while staying far above normal intra-word/intra-phrase gaps.
const GUTTER_MIN_WIDTH_RATIO = 1.7;
export const computeGutterMinWidth = (avgHeight) => Math.max(16, avgHeight * GUTTER_MIN_WIDTH_RATIO);

/**
 * Splits one line's own items into horizontal segments wherever THAT
 * line has an internal gap wide enough to plausibly be a column gutter.
 * Local to one line — a stray short item on some OTHER line can't affect
 * this line's own segmentation (the flaw an earlier whole-page version
 * of this had, confirmed live: a single stray fragment anywhere on the
 * page could bridge what should have been two separate columns).
 */
const segmentLine = (line, gutterMinWidth) => {
  const segments = [];
  let current = null;
  for (const item of line.items) {
    if (current && item.x1 <= current.xMax + gutterMinWidth) {
      current.xMax = Math.max(current.xMax, item.x2);
      current.items.push(item);
    } else {
      current = { xMin: item.x1, xMax: item.x2, items: [item] };
      segments.push(current);
    }
  }
  return segments;
};

/**
 * Detects column gutter X-position(s) by POSITION consensus, not gap
 * WIDTH. A true column gutter is fixed by the page layout, so it recurs
 * at nearly the same X on many different lines. A table-of-contents
 * line's own label-to-page-number gap can be JUST AS WIDE as the real
 * gutter, but its position drifts with each line's own label length —
 * confirmed live, gap-width-only detection misclassified page numbers
 * (and the tail of long left-column entries) as belonging to the right
 * column. Collecting every sufficiently-wide internal gap from every
 * line and voting for the most common X (bucketed, since real
 * coordinates rarely repeat exactly) finds the structurally-fixed gutter
 * and ignores the line-by-line noise. Returns up to 2 gutters (3
 * columns) — generous for real documents without chasing every possible
 * N, and each requires its own minimum vote count so a weak signal falls
 * back to single-column rather than guessing.
 */
export const MIN_GUTTER_VOTES = 3;

/**
 * True when a segment is just a bare page number / roman numeral (e.g.
 * "22", "iv") — the trailing tail of a table-of-contents row, not real
 * column content. Confirmed live: when a document's label-to-page-number
 * gap happens to sit at a nearly FIXED x on every row (e.g. a wide,
 * consistent tab stop rather than dot leaders hugging the label), it can
 * out-vote or tie the real inter-column gutter, promoting "just the page
 * numbers" into their own detected column — the tail-end content ends up
 * reading as a whole separate zone instead of staying attached to the row
 * it belongs to. A real reading column almost never consists of a single
 * 1-5 character digit/roman-numeral token, so gaps whose right-hand
 * segment looks like this are excluded from gutter candidacy entirely,
 * whether or not they'd otherwise win the vote.
 */
const isNumberTabSegment = (seg) => {
  const combined = seg.items.map((it) => it.text).join("").trim();
  return combined.length > 0 && combined.length <= 5 && /^[ivxlcdm\d]+$/i.test(combined);
};

export const detectGutters = (lines, avgHeight) => {
  const gutterMinWidth = computeGutterMinWidth(avgHeight);
  const gaps = []; // { mid, width }
  const segmentsByLine = new Map();
  let linesWithGaps = 0;
  for (const line of lines) {
    const segs = segmentLine(line, gutterMinWidth);
    segmentsByLine.set(line.lineIndex, segs);
    if (segs.length > 1) linesWithGaps++;
    for (let i = 1; i < segs.length; i++) {
      if (isNumberTabSegment(segs[i])) continue;
      gaps.push({ mid: (segs[i - 1].xMax + segs[i].xMin) / 2, width: segs[i].xMin - segs[i - 1].xMax });
    }
  }
  const bucketWidth = Math.max(20, avgHeight * 2);
  const buckets = new Map();
  for (const g of gaps) {
    const key = Math.round(g.mid / bucketWidth);
    const b = buckets.get(key) || { count: 0, sum: 0, widthSum: 0 };
    b.count++; b.sum += g.mid; b.widthSum += g.width;
    buckets.set(key, b);
  }
  // Proportional as well as absolute: a fixed vote count is easy for a
  // handful of coincidentally-similar row widths to hit by chance on a
  // small/sparse page. But the proportion has to be measured against
  // linesWithGaps (lines that even HAVE an internal gap, i.e. could
  // structurally cast a vote at all), not every line on the page —
  // confirmed live, scaling against total page lines was WAY too strict
  // on a real full page (dozens of single-column/full-width lines that
  // can never contribute a gap at all diluted the denominator enough
  // that the real gutter's 15 genuine votes fell under the requirement,
  // silently falling back to single-column and breaking column-scoped
  // selection entirely).
  const requiredVotes = Math.max(MIN_GUTTER_VOTES, Math.ceil(linesWithGaps * 0.3));
  const qualifying = [...buckets.values()].filter((b) => b.count >= requiredVotes);
  // Ranked by WIDTH, not vote count. A real inter-column gutter is
  // structurally the widest recurring whitespace on the page (generous
  // column margins by typesetting convention); a same-column structural
  // gap — most commonly a label-to-page-number tab stop — can rack up
  // MORE votes than the true gutter whenever a document's two columns
  // have uneven entry counts (confirmed live: several page-only "orphan"
  // rows with no right-column counterpart at that row each cast a vote
  // for their own label gap, outnumbering the rows that actually cross
  // the real gutter), but it's essentially never wider than genuine
  // inter-column whitespace. Vote count still GATES candidacy (a
  // one-off wide gap is noise, not a gutter) — it just doesn't rank it.
  qualifying.sort((a, b) => (b.widthSum / b.count) - (a.widthSum / a.count));
  const top = qualifying[0];
  const runnerUp = qualifying[1];
  // A genuine 3-column page has a SECOND gutter roughly as strong as the
  // first (every row crosses both). Requiring the runner-up to carry a
  // real share of the winner's vote count avoids manufacturing a third
  // column out of a much weaker secondary signal.
  const SECOND_GUTTER_MIN_RATIO = 0.6;
  const acceptedBuckets = top && runnerUp && runnerUp.count >= top.count * SECOND_GUTTER_MIN_RATIO
    ? [top, runnerUp]
    : (top ? [top] : []);
  const gutters = acceptedBuckets.map((b) => b.sum / b.count).sort((a, b) => a - b);
  return { gutters, gutterMinWidth, segmentsByLine };
};

/**
 * Classifies every line into one or more blocks: either a single
 * full-width block, or one block per column its content actually falls
 * in. A line is full-width when it has NO internal gap at a detected
 * gutter position (content reads continuously straight through where
 * the gutter normally sits — a title or section heading) AND its own
 * extent genuinely crosses that gutter with real margin on both sides.
 * Content that merely comes CLOSE to a gutter (e.g. a right-aligned page
 * number sitting just before it) has no reason to have a gap AT the
 * gutter and doesn't cross it, so it stays correctly attributed to its
 * own column instead of being forced full-width or hopping columns.
 */
export const classifyBlocks = (lines, gutterInfo) => {
  const { gutters, segmentsByLine } = gutterInfo;
  const avgHeight = lines.length ? lines.reduce((s, l) => s + (l.y2 - l.y1), 0) / lines.length : 1;
  const margin = Math.max(4, avgHeight * 0.5);
  const blocks = [];
  for (const line of lines) {
    const segs = segmentsByLine.get(line.lineIndex) || segmentLine(line, computeGutterMinWidth(avgHeight));
    const isSingleSegment = segs.length === 1;
    const crossesGutter = isSingleSegment && gutters.some((gx) => segs[0].xMin < gx - margin && segs[0].xMax > gx + margin);
    if (crossesGutter) {
      blocks.push({ lineIndex: line.lineIndex, y1: line.y1, y2: line.y2, xMin: segs[0].xMin, xMax: segs[0].xMax, items: segs[0].items, isFullWidth: true, columnIndex: null });
      continue;
    }
    for (const seg of segs) {
      const center = (seg.xMin + seg.xMax) / 2;
      let columnIndex = 0;
      for (const gx of gutters) if (center > gx) columnIndex++;
      blocks.push({ lineIndex: line.lineIndex, y1: line.y1, y2: line.y2, xMin: seg.xMin, xMax: seg.xMax, items: seg.items, isFullWidth: false, columnIndex });
    }
  }
  return blocks;
};

/**
 * Joins one block's own items into LOCAL text (offsets start at 0), using
 * the same convention pdfSearchIndex.js's originalText has always used:
 * "\n" after an item that really ends a line (item.hasEOL), " "
 * otherwise. pdfSearchIndex.js then adds its own forced "\n" between
 * whole blocks — a page-wide convention on top of this shared within-
 * block joining rule.
 */
export const blockToText = (block) => {
  let text = "";
  const itemOffsets = [];
  for (const spatialItem of block.items) {
    const str = spatialItem.text || "";
    if (!str) continue;
    const start = text.length;
    text += str;
    itemOffsets.push({ start, end: text.length, itemIndex: spatialItem.itemIndex });
    text += spatialItem.hasEOL ? "\n" : " ";
  }
  return { text, itemOffsets };
};

/**
 * Final reading order: top-to-bottom overall, but a full-width block
 * (title, section heading, ...) acts as a zone break — every column's
 * accumulated content since the last break is flushed IN COLUMN ORDER
 * (all of column 0 top-to-bottom, then all of column 1, ...) before the
 * full-width block itself, then a fresh zone starts underneath it. This
 * is what keeps "left column entirely before right column" instead of
 * interleaving by raw Y position, while still handling a full-width
 * title at the top or a section heading partway down correctly.
 */
export const buildReadingOrder = (blocks, columnCount) => {
  const sorted = [...blocks].sort((a, b) => a.y1 - b.y1 || a.xMin - b.xMin);
  let buffers = Array.from({ length: Math.max(1, columnCount) }, () => []);
  const ordered = [];
  const flush = () => {
    for (const buf of buffers) ordered.push(...buf);
    buffers = Array.from({ length: Math.max(1, columnCount) }, () => []);
  };
  for (const block of sorted) {
    if (block.isFullWidth) {
      flush();
      ordered.push(block);
    } else {
      buffers[block.columnIndex].push(block);
    }
  }
  flush();
  return ordered;
};

/**
 * Re-merges lines that a rough per-column pre-split (see analyzePageLayout)
 * artificially broke apart: two lines from DIFFERENT rough-column groups,
 * at a similar height, with no real gap between their extents at the
 * split point, are genuinely one continuous line (most commonly a
 * full-width title/heading whose own items legitimately span both rough
 * columns) rather than two separate column entries that merely happen to
 * sit at a similar Y. O(n^2) over per-page line counts (tens, not
 * thousands), which is fine at this scale.
 */
const reconcileSplitLines = (perGroupLines, avgHeight) => {
  const pool = [];
  perGroupLines.forEach((groupLines, groupIdx) => {
    for (const line of groupLines) pool.push({ ...line, groupIdxs: new Set([groupIdx]) });
  });
  const lineTolerance = Math.max(4, avgHeight * 0.6);
  const gutterMinWidth = computeGutterMinWidth(avgHeight);
  const used = new Set();
  const merged = [];
  for (let i = 0; i < pool.length; i++) {
    if (used.has(i)) continue;
    used.add(i);
    let current = pool[i];
    let mergedSomething = true;
    while (mergedSomething) {
      mergedSomething = false;
      for (let j = 0; j < pool.length; j++) {
        if (used.has(j)) continue;
        const other = pool[j];
        // Never re-merge two lines that already share a group — only
        // cross-group merges represent "this turned out to be one
        // genuinely full-width line after all".
        if ([...other.groupIdxs].some((g) => current.groupIdxs.has(g))) continue;
        const avgTopA = (current.y1 + current.y2) / 2;
        const avgTopB = (other.y1 + other.y2) / 2;
        if (Math.abs(avgTopA - avgTopB) > lineTolerance) continue;
        const [left, right] = current.items[0].x1 <= other.items[0].x1 ? [current, other] : [other, current];
        const leftMaxX = Math.max(...left.items.map((it) => it.x2));
        const rightMinX = Math.min(...right.items.map((it) => it.x1));
        if (rightMinX - leftMaxX >= gutterMinWidth) continue; // a real gap — genuinely two different columns' content
        current = {
          y1: Math.min(current.y1, other.y1),
          y2: Math.max(current.y2, other.y2),
          items: [...current.items, ...other.items].sort((a, b) => a.x1 - b.x1),
          groupIdxs: new Set([...current.groupIdxs, ...other.groupIdxs]),
        };
        used.add(j);
        mergedSomething = true;
        break;
      }
    }
    merged.push(current);
  }
  merged.sort((a, b) => a.y1 - b.y1);
  // isFullWidth: items came from more than one rough-column group and
  // stayed merged through reconciliation — a real continuous line, not
  // an artifact of the pre-split. columnIndex is meaningless/null then;
  // otherwise it's simply which single group the line's items came from.
  return merged.map((line, idx) => ({
    lineIndex: idx,
    y1: line.y1,
    y2: line.y2,
    items: line.items,
    isFullWidth: line.groupIdxs.size > 1,
    columnIndex: line.groupIdxs.size === 1 ? [...line.groupIdxs][0] : null,
  }));
};

/**
 * Full pipeline: spatial items -> lines -> gutters -> blocks -> reading
 * order -> flat item order. `items` are plain {text,x1,x2,y1,y2,...}
 * (see itemsFromPdfJs for the PDF.js-specific conversion). Returns:
 *   { lines, columnCount, gutters, blocks (in reading order),
 *     itemsInReadingOrder (flat, ready to join into text) }
 *
 * Runs line-clustering TWICE. Pass 1 is the naive whole-page version,
 * used only to get a rough gutter estimate — the gutter-voting algorithm
 * is a statistical consensus across many lines, tolerant of a handful of
 * misclustered ones, so it still finds a usable estimate even from this
 * pass's occasional mistakes. Pass 2 re-clusters lines SEPARATELY per
 * rough column using that estimate, which is what actually fixes cross-
 * column interference: confirmed live, an unrelated item from a
 * DIFFERENT column sharing a similar Y purely by coincidence (this
 * document's own decorative font puts a drop-cap-sized glyph mid-phrase,
 * not just at a word's start, so two fragments of ONE word can differ in
 * Y by the same couple of pixels as two genuinely different, unrelated
 * lines elsewhere on the page) was disrupting pass 1's single global
 * pass, splitting one word's two fragments into different "lines".
 * reconcileSplitLines() immediately undoes the one case where this
 * pre-split is wrong: a genuinely full-width line whose own items
 * legitimately span both rough columns.
 */
export const analyzePageLayout = (items) => {
  if (!items.length) return { lines: [], columnCount: 1, gutters: [], blocks: [], itemsInReadingOrder: [] };

  const roughLines = buildLines(items);
  const roughAvgHeight = roughLines.reduce((s, l) => s + (l.y2 - l.y1), 0) / roughLines.length || 1;
  const roughGutters = detectGutters(roughLines, roughAvgHeight).gutters;

  if (!roughGutters.length) {
    // No column signal at all — single column, nothing to pre-split, no
    // cross-column interference is even possible. Use the naive pass
    // directly with the original segment-based classifier.
    const gutterInfo = detectGutters(roughLines, roughAvgHeight);
    const blocks = classifyBlocks(roughLines, gutterInfo);
    const orderedBlocks = buildReadingOrder(blocks, 1);
    return { lines: roughLines, columnCount: 1, gutters: [], blocks: orderedBlocks, itemsInReadingOrder: orderedBlocks.flatMap((b) => b.items) };
  }

  // Re-cluster lines SEPARATELY per rough column (fixes cross-column
  // interference), then reconcile any line that turns out to genuinely
  // be full-width. columnIndex/isFullWidth come directly off each
  // reconciled line — NOT from re-running detectGutters on these new
  // lines, which would find nothing (by construction, no line spans two
  // columns anymore once properly split, so there's no internal gap left
  // to rediscover a gutter from).
  const columnCount = roughGutters.length + 1;
  const groups = Array.from({ length: columnCount }, () => []);
  for (const it of items) {
    const cx = (it.x1 + it.x2) / 2;
    let col = 0;
    for (const gx of roughGutters) if (cx > gx) col++;
    groups[col].push(it);
  }
  const perGroupLines = groups.map((g) => (g.length ? buildLines(g) : []));
  const lines = reconcileSplitLines(perGroupLines, roughAvgHeight);

  // Cross-group merging (above) catches a full-width line made of
  // several items straddling the gutter. It CAN'T catch one made of a
  // single PDF text item (common for a short heading/title, which often
  // needs no font/style change mid-string) — that single item gets
  // assigned wholesale to whichever rough group its own center falls on,
  // never triggering a cross-group merge at all. Direct extent-crossing
  // check as a fallback: a line whose own xMin..xMax genuinely straddles
  // a gutter (with margin, so a line merely coming close doesn't count)
  // is full-width regardless of how many items it's made of.
  const fullWidthMargin = Math.max(4, roughAvgHeight * 0.5);
  const blocks = lines.map((line) => {
    const xMin = Math.min(...line.items.map((it) => it.x1));
    const xMax = Math.max(...line.items.map((it) => it.x2));
    const crossesGutter = !line.isFullWidth
      && roughGutters.some((gx) => xMin < gx - fullWidthMargin && xMax > gx + fullWidthMargin);
    return {
      lineIndex: line.lineIndex,
      y1: line.y1,
      y2: line.y2,
      xMin, xMax,
      items: line.items,
      isFullWidth: line.isFullWidth || crossesGutter,
      columnIndex: (line.isFullWidth || crossesGutter) ? null : line.columnIndex,
    };
  });
  const orderedBlocks = buildReadingOrder(blocks, columnCount);
  const itemsInReadingOrder = orderedBlocks.flatMap((b) => b.items);
  return { lines, columnCount, gutters: roughGutters, blocks: orderedBlocks, itemsInReadingOrder };
};
