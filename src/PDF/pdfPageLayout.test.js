import { describe, expect, it } from "vitest";
import { analyzePageLayout } from "./pdfPageLayout.js";

// Builds a plain spatial item. y grows downward (matches PDF.js viewport
// space, same convention PDFPage.jsx's own span-building effect uses).
const item = (text, x1, y1, width, height = 10) => ({ text, x1, x2: x1 + width, y1, y2: y1 + height });

const readingOrderText = (items) => items.map((it) => it.text).join(" ");

describe("pdfPageLayout — single column", () => {
  it("keeps plain top-to-bottom order when there's no repeated gutter", () => {
    const items = [
      item("First", 50, 0, 60),
      item("line", 120, 0, 40),
      item("Second", 50, 20, 70),
      item("line", 130, 20, 40),
      item("Third", 50, 40, 60),
    ];
    const layout = analyzePageLayout(items);
    expect(layout.columnCount).toBe(1);
    expect(readingOrderText(layout.itemsInReadingOrder)).toBe("First line Second line Third");
  });
});

describe("pdfPageLayout — two columns", () => {
  // A row-aligned two-column table of contents: left and right entries
  // sit at the SAME y on every row, exactly the layout that broke a
  // naive top-then-left sort (interleaved left/right/left/right).
  const twoColumnToc = () => {
    const rows = [
      ["Electrocardiogram", "18", "Dyslipidemia", "55"],
      ["Cardiac Physical Exam", "22", "Hypertension", "57"],
      ["Arrhythmias", "25", "Pericardial Disease", "64"],
      ["Congestive Heart Failure", "34", "Endocarditis", "67"],
      ["Cardiomyopathy", "40", "Vascular Diseases", "75"],
      ["Aortic Stenosis", "43", "Peripheral Artery Disease", "79"],
      ["Mitral Regurgitation", "46", "Deep Vein Thrombosis", "83"],
      ["Pulmonary Vascular Disease", "49", "Aortic Dissection", "87"],
      ["Cardiac Tamponade", "52", "Pulmonary Embolism", "91"],
    ];
    const items = [];
    // Label widths vary per row, like real typeset text of differing
    // lengths, so the label-to-page-number gap lands at a different x on
    // most rows — only the true gutter (page number's fixed right-
    // aligned position at 330 to the right column's fixed start at 500)
    // recurs at the same x every row. Values below are verified (by a
    // brute-force search over candidate width sets, not hand-picked) to
    // produce exactly one detected gutter with this algorithm — a small
    // fixed-row synthetic fixture has much less "room" for widths to
    // spread across than a real multi-hundred-point page does, so
    // hand-picked-looking values can accidentally collide into a false
    // second gutter by pure pigeonhole even when they look varied.
    const leftWidths = [65, 199, 122, 236, 159, 176, 256, 117, 87];
    const rightWidths = [210, 176, 77, 146, 227, 216, 185, 182, 119];
    rows.forEach((row, i) => {
      const y = i * 20;
      items.push(item(row[0], 60, y, leftWidths[i]));
      items.push(item(row[1], 330, y, 20)); // left column's own right-aligned page number
      items.push(item(row[2], 500, y, rightWidths[i])); // real gutter: fixed 330+20=350 .. 500
      items.push(item(row[3], 660, y, 20));
    });
    return items;
  };

  it("detects exactly one gutter and two columns", () => {
    const layout = analyzePageLayout(twoColumnToc());
    expect(layout.columnCount).toBe(2);
    expect(layout.gutters).toHaveLength(1);
  });

  it("orders the entire left column before the entire right column (no interleaving)", () => {
    const layout = analyzePageLayout(twoColumnToc());
    const text = readingOrderText(layout.itemsInReadingOrder);
    const leftEnd = text.indexOf("Cardiomyopathy 40");
    const rightStart = text.indexOf("Dyslipidemia 55");
    expect(leftEnd).toBeGreaterThan(-1);
    expect(rightStart).toBeGreaterThan(-1);
    expect(leftEnd).toBeLessThan(rightStart);
    // And within a column, top-to-bottom order is preserved.
    expect(text.indexOf("Electrocardiogram")).toBeLessThan(text.indexOf("Cardiac Physical Exam"));
    expect(text.indexOf("Dyslipidemia")).toBeLessThan(text.indexOf("Hypertension"));
  });

  it("keeps a left-column page number attributed to the left column, not the right", () => {
    // This is the exact bug reported live: a right-aligned page number
    // sitting close to (but not crossing) the gutter was misclassified.
    const layout = analyzePageLayout(twoColumnToc());
    const pageNumBlock = layout.blocks.find((b) => b.items.some((it) => it.text === "18"));
    const rightColBlock = layout.blocks.find((b) => b.items.some((it) => it.text === "Dyslipidemia"));
    expect(pageNumBlock.columnIndex).not.toBe(null);
    expect(pageNumBlock.columnIndex).toBe(rightColBlock.columnIndex - 1);
  });
});

describe("pdfPageLayout — full-width elements", () => {
  it("places a full-width title before both columns", () => {
    const items = [
      item("Cardiovascular Review Article", 60, 0, 500), // spans across where the gutter will be
      item("Left para one", 60, 30, 220),
      item("Right para one", 500, 30, 220),
      item("Left para two", 60, 50, 220),
      item("Right para two", 500, 50, 220),
      item("Left para three", 60, 70, 220),
      item("Right para three", 500, 70, 220),
    ];
    const layout = analyzePageLayout(items);
    const text = readingOrderText(layout.itemsInReadingOrder);
    expect(text.indexOf("Cardiovascular Review Article")).toBe(0);
    expect(text.indexOf("Left para one")).toBeLessThan(text.indexOf("Right para one"));
  });

  it("splits into zones around a full-width heading halfway down the page", () => {
    const items = [
      item("Left upper", 60, 0, 220),
      item("Right upper", 500, 0, 220),
      item("Left upper two", 60, 20, 220),
      item("Right upper two", 500, 20, 220),
      item("SECTION HEADING SPANNING BOTH COLUMNS", 60, 40, 500),
      item("Left lower", 60, 70, 220),
      item("Right lower", 500, 70, 220),
      item("Left lower two", 60, 90, 220),
      item("Right lower two", 500, 90, 220),
    ];
    const layout = analyzePageLayout(items);
    const text = readingOrderText(layout.itemsInReadingOrder);
    // Reading order: left-upper block, right-upper block, heading, left-lower block, right-lower block.
    expect(text.indexOf("Left upper")).toBeLessThan(text.indexOf("Right upper"));
    expect(text.indexOf("Right upper two")).toBeLessThan(text.indexOf("SECTION HEADING"));
    expect(text.indexOf("SECTION HEADING")).toBeLessThan(text.indexOf("Left lower"));
    expect(text.indexOf("Left lower two")).toBeLessThan(text.indexOf("Right lower"));
  });
});

describe("pdfPageLayout — trailing page-number tab is not promoted to its own column", () => {
  it("keeps a consistently-positioned label-to-page-number gap out of gutter detection", () => {
    // The real bug this reproduces: a right column's OWN label-to-page-
    // number gap sits at a nearly fixed x on every row (unlike the sibling
    // twoColumnToc fixture, where varying label lengths keep that gap's
    // position from ever clustering into a strong bucket). A gap that
    // consistent can rack up just as many votes as the real inter-column
    // gutter, and — before the isNumberTabSegment filter — got accepted as
    // a genuine second gutter, splitting "just the page numbers" into
    // their own trailing reading-order zone instead of staying with their
    // own row.
    const rows = Array.from({ length: 10 }, (_, i) => i);
    const items = [];
    rows.forEach((i) => {
      const y = i * 20;
      items.push(item(`LeftEntry${i}LongerLabelText`, 60, y, 220));
      items.push(item(`RightEntry${i}`, 500, y, 150)); // fixed width every row
      items.push(item(`${20 + i}`, 700, y, 20)); // fixed x every row
    });
    const layout = analyzePageLayout(items);
    expect(layout.columnCount).toBe(2);
    expect(layout.gutters).toHaveLength(1);
    const text = readingOrderText(layout.itemsInReadingOrder);
    const num0 = text.indexOf("20");
    const rightEntryLast = text.indexOf(`RightEntry${rows.length - 1}`);
    expect(num0).toBeGreaterThan(-1);
    // Row 0's own page number must stay attached near its own row, not get
    // flushed into a separate trailing zone after every right-column label.
    expect(num0).toBeLessThan(rightEntryLast);
  });
});

describe("pdfPageLayout — table of contents crossing many rows stays column-clean", () => {
  it("never lets left-column content directly touch right-column content in reading order without a column boundary between them", () => {
    const rows = Array.from({ length: 12 }, (_, i) => i);
    const items = [];
    // Verified (brute-force search, not hand-picked — see the sibling
    // TOC test's own comment on why linear/hand-picked widths risk
    // colliding into a false second gutter on a small fixture) to
    // produce exactly one detected gutter. Only the fixed-position page
    // numbers (300, 700) and the real gutter between them stay
    // consistent across every row; these widths vary per row like real
    // differing label lengths.
    const leftWidths = [129, 99, 176, 161, 201, 150, 94, 193, 92, 125, 193, 122];
    const rightWidths = [217, 204, 189, 97, 140, 185, 151, 109, 212, 143, 100, 162];
    for (const i of rows) {
      const y = i * 18;
      items.push(item(`LeftEntry${i}`, 60, y, leftWidths[i]));
      items.push(item(`${10 + i}`, 300, y, 20));
      items.push(item(`RightEntry${i}`, 480, y, rightWidths[i]));
      items.push(item(`${50 + i}`, 700, y, 20));
    }
    const layout = analyzePageLayout(items);
    expect(layout.columnCount).toBe(2);
    const text = readingOrderText(layout.itemsInReadingOrder);
    // Every LeftEntry must appear before every RightEntry.
    const lastLeftIdx = Math.max(...rows.map((i) => text.indexOf(`LeftEntry${i}`)));
    const firstRightIdx = Math.min(...rows.map((i) => text.indexOf(`RightEntry${i}`)));
    expect(lastLeftIdx).toBeLessThan(firstRightIdx);
  });
});
