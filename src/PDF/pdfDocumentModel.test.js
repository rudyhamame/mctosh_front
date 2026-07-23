import { describe, expect, it } from "vitest";
import { analyzePageLayout } from "./pdfPageLayout.js";
import { buildParagraphs, detectHeadings } from "./pdfDocumentModel.js";

// Same y-grows-downward convention as pdfPageLayout.test.js's own item()
// helper, but this module reads fontSize/itemIndex off each spatial item
// (paragraph provenance + heading-by-font-size detection need both), so
// this is its own local helper rather than a modification to the sibling
// test file's existing one.
const makeItemFactory = () => {
  let nextIndex = 0;
  return (text, x1, y1, width, height = 10, fontSize = height) => ({
    text, x1, x2: x1 + width, y1, y2: y1 + height, fontSize, itemIndex: nextIndex++,
  });
};

describe("pdfDocumentModel — paragraph grouping", () => {
  it("merges a multi-line same-column paragraph into one node", () => {
    const item = makeItemFactory();
    const items = [
      item("First line of the paragraph", 60, 0, 200),
      item("second line continues", 60, 12, 200),
      item("and a third line", 60, 24, 200),
    ];
    const layout = analyzePageLayout(items);
    const paragraphs = buildParagraphs(layout);
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0].lineCount).toBe(3);
    expect(paragraphs[0].text).toBe("First line of the paragraph second line continues and a third line");
  });

  it("splits consecutive table-of-contents rows into separate entries even with normal line spacing", () => {
    const item = makeItemFactory();
    // Same small (12px) line-to-line gap as the "merges a multi-line
    // paragraph" test above uses for genuine wrapped prose — the point is
    // that gap alone can't distinguish "next line of this paragraph" from
    // "next TOC entry"; only each line's own trailing page number can.
    const items = [
      item("Electrocardiogram", 60, 0, 100, 10),
      item("18", 172, 0, 20, 10),
      item("Cardiac Physical Exam", 60, 12, 100, 10),
      item("22", 172, 12, 20, 10),
      item("Arrhythmias", 60, 24, 100, 10),
      item("25", 172, 24, 20, 10),
    ];
    const layout = analyzePageLayout(items);
    const paragraphs = buildParagraphs(layout);
    expect(paragraphs).toHaveLength(3);
    expect(paragraphs[0].text).toBe("Electrocardiogram 18");
    expect(paragraphs[1].text).toBe("Cardiac Physical Exam 22");
    expect(paragraphs[2].text).toBe("Arrhythmias 25");
  });

  it("starts a new paragraph across a large vertical gap", () => {
    const item = makeItemFactory();
    const items = [
      item("First line of the paragraph", 60, 0, 200),
      item("second line continues", 60, 12, 200),
      // Big jump — a real paragraph break, not just normal line spacing.
      item("A brand new paragraph starts here", 60, 40, 200),
    ];
    const layout = analyzePageLayout(items);
    const paragraphs = buildParagraphs(layout);
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0].lineCount).toBe(2);
    expect(paragraphs[1].lineCount).toBe(1);
  });

  it("keeps a full-width heading separate from the two-column body it introduces", () => {
    const item = makeItemFactory();
    const items = [
      item("Cardiovascular Review Article", 60, 0, 500),
      item("Left para one", 60, 30, 220),
      item("Right para one", 500, 30, 220),
      item("Left para two", 60, 50, 220),
      item("Right para two", 500, 50, 220),
      item("Left para three", 60, 70, 220),
      item("Right para three", 500, 70, 220),
    ];
    const layout = analyzePageLayout(items);
    expect(layout.columnCount).toBe(2); // sanity: gutter detection kicked in
    const paragraphs = buildParagraphs(layout);
    const heading = paragraphs.find((p) => p.text === "Cardiovascular Review Article");
    expect(heading).toBeTruthy();
    expect(heading.isFullWidth).toBe(true);
    // Never merged with either column's body text.
    const bodyParagraphs = paragraphs.filter((p) => p !== heading);
    for (const p of bodyParagraphs) {
      expect(p.text).not.toContain("Cardiovascular Review Article");
      expect(p.isFullWidth).toBe(false);
    }
  });
});

describe("pdfDocumentModel — heading detection", () => {
  it("gives two distinct oversized font sizes distinct, correctly-ordered levels", () => {
    const item = makeItemFactory();
    // Five body-sized lines (fontSize 10) establish the median/body size;
    // large gaps between every line (accounting for each line's own
    // height, so a tall heading's bounding box doesn't itself touch the
    // next line — real typeset headings have visible clearance around
    // them) so each stays its own paragraph.
    const items = [
      item("Body text one", 60, 0, 200, 10),
      item("Heading1", 60, 25, 100, 20),   // level 1: largest
      item("Body text two", 60, 65, 200, 10),
      item("Heading2", 60, 90, 100, 15),   // level 2: smaller, still eligible
      item("Body text three", 60, 125, 200, 10),
      item("Body text four", 60, 150, 200, 10),
      item("Body text five", 60, 175, 200, 10),
    ];
    const layout = analyzePageLayout(items);
    const paragraphs = detectHeadings(buildParagraphs(layout), layout);
    const heading1 = paragraphs.find((p) => p.text === "Heading1");
    const heading2 = paragraphs.find((p) => p.text === "Heading2");
    expect(heading1.type).toBe("heading");
    expect(heading1.level).toBe(1);
    expect(heading2.type).toBe("heading");
    expect(heading2.level).toBe(2);
    const body = paragraphs.find((p) => p.text === "Body text one");
    expect(body.type).toBe("paragraph");
  });
});

describe("pdfDocumentModel — provenance", () => {
  it("covers every source itemIndex exactly once across sibling paragraphs", () => {
    const item = makeItemFactory();
    const items = [
      item("Paragraph one line one", 60, 0, 200),
      item("Paragraph one line two", 60, 12, 200),
      // Large gap -> second paragraph.
      item("Paragraph two line one", 60, 40, 200),
      item("Paragraph two line two", 60, 52, 200),
    ];
    const layout = analyzePageLayout(items);
    const paragraphs = buildParagraphs(layout);
    const allIndexes = paragraphs.flatMap((p) => p.itemIndexes);
    expect(new Set(allIndexes).size).toBe(items.length);
    expect([...new Set(allIndexes)].sort((a, b) => a - b)).toEqual(items.map((it) => it.itemIndex));
  });

  it("gives each paragraph itemOffsets that slice back to the exact right source item", () => {
    const item = makeItemFactory();
    const items = [
      item("Paragraph", 60, 0, 100),
      item("one", 170, 0, 40),
      item("line", 220, 0, 40),
      item("two", 60, 12, 40),
    ];
    const layout = analyzePageLayout(items);
    const paragraphs = buildParagraphs(layout);
    const p = paragraphs[0];
    for (const o of p.itemOffsets) {
      const sourceItem = items.find((it) => it.itemIndex === o.itemIndex);
      expect(p.text.slice(o.start, o.end)).toBe(sourceItem.text);
    }
  });
});

describe("pdfDocumentModel — low-confidence flagging (candidate for AI resegment)", () => {
  it("flags a paragraph whose own internal item gap is gutter-sized but landed in one rough group anyway", () => {
    const item = makeItemFactory();
    // Reproduces the real bug this was built for: 5 ordinary rows
    // establish a stable rough gutter (consistent wide gap -> vote at
    // mid=280), then one more row's own "right column" content starts
    // closer in than the rough gutter's x — its own item-to-item gap
    // (40) is still clearly gutter-sized (floor is ~17), but its x-center
    // (250) falls on the LEFT side of the rough gutter (280), so
    // analyzePageLayout's two-pass pre-split groups it with the left
    // item anyway, and per-group buildLines never re-checks for an
    // internal gap once grouped. This is exactly the geometric signature
    // hasSuspiciousInternalGap exists to catch.
    const rows = [0, 1, 2, 3, 4];
    const items = [];
    for (const i of rows) {
      items.push(item(`Left${i}`, 60, i * 20, 100, 10));
      items.push(item(`Right${i}`, 400, i * 20, 100, 10));
    }
    items.push(item("Electrocardiogram", 60, 100, 100, 10));
    items.push(item("Dyslipidemia", 200, 100, 100, 10)); // gap from left item = 200-160 = 40
    const layout = analyzePageLayout(items);
    expect(layout.columnCount).toBe(2); // sanity: the rough gutter WAS detected from the other 5 rows
    const paragraphs = buildParagraphs(layout);
    const merged = paragraphs.find((p) => p.text.includes("Electrocardiogram"));
    expect(merged.text).toContain("Dyslipidemia"); // confirms the merge actually happened, same as live
    expect(merged.lowConfidence).toBe(true);
    const clean = paragraphs.find((p) => p.text === "Left0");
    expect(clean.lowConfidence).toBe(false);
  });

  it("does not flag an ordinary paragraph with only normal word-to-word gaps", () => {
    const item = makeItemFactory();
    const items = [
      item("A", 60, 0, 10, 10),
      item("normal", 74, 0, 50, 10), // gap = 74-70 = 4, well under gutterMinWidth
      item("sentence", 128, 0, 60, 10),
    ];
    const layout = analyzePageLayout(items);
    const paragraphs = buildParagraphs(layout);
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0].lowConfidence).toBe(false);
  });

  it("does not flag a clean, already-correctly-segmented TOC row for its own ordinary label-to-page-number gap", () => {
    const item = makeItemFactory();
    // A short label with a far-right-aligned page number, exactly like a
    // real table-of-contents entry — the gap here is gutter-sized purely
    // because the label is short, not because anything got merged. This
    // is one single, already-correct paragraph (its own gap ends the
    // block, per blockEndsWithPageNumberToken), so it must not also get
    // an unnecessary "fix with AI" affordance.
    const items = [
      item("Cardiomyopathy", 60, 0, 100, 10),
      item("40", 260, 0, 20, 10), // gap = 260-160 = 100, well over gutterMinWidth
    ];
    const layout = analyzePageLayout(items);
    const paragraphs = buildParagraphs(layout);
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0].text).toBe("Cardiomyopathy 40");
    expect(paragraphs[0].lowConfidence).toBe(false);
  });
});
