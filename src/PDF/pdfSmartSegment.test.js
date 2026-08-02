import { describe, expect, it } from "vitest";
import { buildSmartSegmentLines, buildVisualFallbackBBoxes, matchParagraphsToLines, segmentPageIntoParagraphBBoxes, splitMarkdownIntoParagraphs } from "./pdfSmartSegment.js";

describe("splitMarkdownIntoParagraphs", () => {
  it("splits on blank lines and strips Markdown syntax", () => {
    const markdown = [
      "# Cardiac Output",
      "",
      "Cardiac output equals **stroke volume** multiplied by heart rate.",
      "",
      "- Preload",
      "- Afterload",
      "- Contractility",
    ].join("\n");
    const paragraphs = splitMarkdownIntoParagraphs(markdown);
    expect(paragraphs).toContain("Cardiac Output");
    expect(paragraphs).toContain("Cardiac output equals stroke volume multiplied by heart rate.");
    expect(paragraphs.some((p) => p.includes("Preload") && p.includes("Afterload"))).toBe(true);
  });

  it("drops fragments shorter than the minimum paragraph length", () => {
    const paragraphs = splitMarkdownIntoParagraphs("Hi\n\n1\n\nA real sentence long enough to count.");
    expect(paragraphs).toEqual(["A real sentence long enough to count."]);
  });
});

// Builds a synthetic page: one "line" per array entry, laid out as a
// simple single-column stack (each line 10pt tall, 12pt apart, spanning
// x=0..200) — enough geometry for matchParagraphsToLines to union rects
// without needing a real PDF.
const makeLines = (texts) => texts.map((text, i) => ({
  text,
  rect: { x: 0, y: i * 12, w: 200, h: 10 },
}));

describe("matchParagraphsToLines", () => {
  it("matches each paragraph to its own contiguous run of lines, in order", () => {
    const lines = makeLines([
      "Cardiac output equals stroke",
      "volume multiplied by heart rate.",
      "Preload afterload and",
      "contractility all affect it.",
    ]);
    const paragraphs = [
      "Cardiac output equals stroke volume multiplied by heart rate.",
      "Preload afterload and contractility all affect it.",
    ];
    const results = matchParagraphsToLines(paragraphs, lines);
    expect(results).toHaveLength(2);
    expect(results[0].text).toBe(paragraphs[0]);
    expect(results[1].text).toBe(paragraphs[1]);
    // First paragraph should union lines 0-1 (y: 0..10 and 12..22 -> top 0, bottom 22)
    expect(results[0].rect.y).toBe(0);
    expect(results[0].rect.h).toBe(22);
    // Second paragraph starts after the first one's lines are consumed —
    // its top should be at or after the first paragraph's bottom, not
    // overlapping/reusing the same lines.
    expect(results[1].rect.y).toBeGreaterThanOrEqual(results[0].rect.y + results[0].rect.h - 1);
  });

  it("skips a paragraph that has no matching lines rather than forcing a wrong match", () => {
    const lines = makeLines([
      "The heart has four chambers total.",
      "Two atria and two ventricles exist.",
    ]);
    const paragraphs = [
      "The heart has four chambers total. Two atria and two ventricles exist.",
      "This sentence describes something completely unrelated to cardiology at all.",
    ];
    const results = matchParagraphsToLines(paragraphs, lines);
    expect(results).toHaveLength(1);
    expect(results[0].text).toBe(paragraphs[0]);
  });

  it("keeps matching later paragraphs when an earlier OCR paragraph is absent", () => {
    const paragraphs = [
      "OCR generated heading that is not present in the PDF text layer.",
      "Cardiac output equals stroke volume multiplied by heart rate.",
    ];
    const lines = makeLines([
      "Cardiac output equals stroke volume",
      "multiplied by heart rate.",
    ]);
    const results = matchParagraphsToLines(paragraphs, lines);
    expect(results).toHaveLength(1);
    expect(results[0].text).toBe(paragraphs[1]);
    expect(results[0].rect.y).toBe(0);
  });

  it("returns nothing for an empty line list", () => {
    expect(matchParagraphsToLines(["Some paragraph text long enough to matter."], [])).toEqual([]);
  });

  it("keeps independent progress when OCR lists the right column first", () => {
    const lines = [
      { text: "Right column paragraph starts here and continues.", rect: { x: 300, y: 0, w: 180, h: 10 }, columnIndex: 1, isFullWidth: false },
      { text: "Right column paragraph ends on this line.", rect: { x: 300, y: 14, w: 180, h: 10 }, columnIndex: 1, isFullWidth: false },
      { text: "Left column paragraph starts here and continues.", rect: { x: 0, y: 0, w: 180, h: 10 }, columnIndex: 0, isFullWidth: false },
      { text: "Left column paragraph ends on this line.", rect: { x: 0, y: 14, w: 180, h: 10 }, columnIndex: 0, isFullWidth: false },
    ];
    const results = matchParagraphsToLines([
      "Right column paragraph starts here and continues. Right column paragraph ends on this line.",
      "Left column paragraph starts here and continues. Left column paragraph ends on this line.",
    ], lines);
    expect(results).toHaveLength(2);
    expect(results[0].rect.x).toBe(300);
    expect(results[0].rect.h).toBe(24);
    expect(results[1].rect.x).toBe(0);
    expect(results[1].rect.h).toBe(24);
  });

  it("does not keep a high-scoring prefix when the paragraph continues", () => {
    const lines = makeLines([
      "The cardiac cycle begins with ventricular filling.",
      "A small OCR variation appears in the next line of the paragraph.",
      "The final line still belongs to the same paragraph and must be boxed.",
    ]);
    const results = matchParagraphsToLines([
      "The cardiac cycle begins with ventricular filling. A small OCR variation appears in the next line of the paragraph. The final line still belongs to the same paragraph and must be boxed.",
    ], lines);
    expect(results).toHaveLength(1);
    expect(results[0].rect.h).toBe(34);
  });

  it("anchors geometry to the opening line instead of a similar interior run", () => {
    const lines = makeLines([
      "Normal adult heart rate is sixty to one hundred beats per minute.",
      "Heart rate below sixty beats per minute is called bradycardia.",
      "Heart rate above one hundred beats per minute is called tachycardia.",
      "The rhythm should then be assessed for regularity and origin.",
    ]);
    const paragraph = "Normal adult heart rate is 60 to 100 beats per minute. Heart rate below 60 beats per minute is called bradycardia. Heart rate above 100 beats per minute is called tachycardia. The rhythm should then be assessed for regularity and origin.";
    const results = matchParagraphsToLines([paragraph], lines);
    expect(results).toHaveLength(1);
    expect(results[0].rect.y).toBe(0);
    expect(results[0].rect.h).toBe(46);
  });
});

describe("buildSmartSegmentLines", () => {
  it("keeps a two-column page in column reading order", () => {
    const spans = [];
    for (let row = 0; row < 6; row += 1) {
      spans.push({ text: `Left column line ${row}`, pageLeft: 40, pageRight: 220, pageTop: row * 20, pageBottom: row * 20 + 10, pageHeight: 10 });
      spans.push({ text: `Right column line ${row}`, pageLeft: 340, pageRight: 520, pageTop: row * 20, pageBottom: row * 20 + 10, pageHeight: 10 });
    }
    const lines = buildSmartSegmentLines(spans);
    const leftLast = lines.map((line) => line.text).findIndex((text) => text === "Left column line 5");
    const rightFirst = lines.map((line) => line.text).findIndex((text) => text === "Right column line 0");
    expect(leftLast).toBeGreaterThanOrEqual(0);
    expect(rightFirst).toBeGreaterThan(leftLast);
  });
});

describe("segmentPageIntoParagraphBBoxes", () => {
  it("falls back to column-local visual groups when OCR interleaves columns", () => {
    const spans = [];
    for (let row = 0; row < 6; row += 1) {
      spans.push({ text: `Left ${row}`, pageLeft: 40, pageRight: 180, pageTop: row * 20, pageBottom: row * 20 + 10, pageHeight: 10 });
      spans.push({ text: `Right ${row}`, pageLeft: 340, pageRight: 480, pageTop: row * 20, pageBottom: row * 20 + 10, pageHeight: 10 });
    }
    const result = segmentPageIntoParagraphBBoxes(
      "Left 0 Right 0 Left 1 Right 1 Left 2 Right 2 Left 3 Right 3 Left 4 Right 4 Left 5 Right 5",
      spans,
    );
    expect(result).toHaveLength(2);
    expect(result[0].rect.x).toBe(40);
    expect(result[1].rect.x).toBe(340);
  });
});

describe("buildVisualFallbackBBoxes", () => {
  it("merges adjacent paragraph lines even when layout flags fluctuate", () => {
    const lines = [
      { text: "First line", rect: { x: 40, y: 100, w: 180, h: 12 }, columnIndex: 0, isFullWidth: false },
      { text: "Second line", rect: { x: 40, y: 118, w: 170, h: 12 }, columnIndex: null, isFullWidth: true },
      { text: "Third line", rect: { x: 40, y: 136, w: 150, h: 12 }, columnIndex: 1, isFullWidth: false },
    ];
    const results = buildVisualFallbackBBoxes(lines);
    expect(results).toHaveLength(1);
    expect(results[0].text).toBe("First line Second line Third line");
    expect(results[0].rect.h).toBe(48);
  });
});

describe("segmentPageIntoParagraphBBoxes", () => {
  it("returns [] when there is no markdown or no spans", () => {
    expect(segmentPageIntoParagraphBBoxes("", [])).toEqual([]);
    expect(segmentPageIntoParagraphBBoxes("Some markdown text here that is long enough.", [])).toEqual([]);
  });

  it("end-to-end: Markdown paragraph -> matched span-derived line -> bbox rect", () => {
    const markdown = "The mitral valve separates the left atrium from the left ventricle.";
    // One PDF text span per word, laid out left-to-right on a single line —
    // buildTextLines (via groupSpansIntoLines) should merge these into one
    // line since they share the same pageTop within tolerance.
    const words = markdown.split(" ");
    const spans = words.map((word, i) => ({
      text: word,
      pageLeft: i * 20,
      pageRight: i * 20 + 18,
      pageTop: 100,
      pageBottom: 112,
      pageHeight: 12,
    }));
    const results = segmentPageIntoParagraphBBoxes(markdown, spans);
    expect(results).toHaveLength(1);
    expect(results[0].text).toBe(markdown);
    expect(results[0].rect.x).toBe(0);
    expect(results[0].rect.y).toBe(100);
    expect(results[0].rect.h).toBe(12);
  });

  it("includes a Markdown title immediately above its paragraph", () => {
    const lines = [
      { text: "Cardiac Output", pageLeft: 0, pageRight: 160, pageTop: 100, pageBottom: 112, pageHeight: 12 },
      { text: "Cardiac output equals stroke volume multiplied by heart rate.", pageLeft: 0, pageRight: 360, pageTop: 118, pageBottom: 130, pageHeight: 12 },
    ];
    const results = segmentPageIntoParagraphBBoxes(
      "Cardiac Output\n\nCardiac output equals stroke volume multiplied by heart rate.",
      lines,
    );
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Cardiac Output");
    expect(results[0].text).not.toContain("Cardiac Output");
    expect(results[0].text).toContain("Cardiac output equals stroke volume multiplied by heart rate.");
    expect(results[0].rect.y).toBe(100);
    expect(results[0].rect.h).toBe(30);
  });

  it("recovers both columns when a sparse page has too few gutter votes", () => {
    const spans = [
      { text: "Right paragraph starts here.", pageLeft: 340, pageRight: 480, pageTop: 100, pageBottom: 112, pageHeight: 12 },
      { text: "Right paragraph continues here.", pageLeft: 340, pageRight: 500, pageTop: 118, pageBottom: 130, pageHeight: 12 },
      { text: "Left paragraph starts here.", pageLeft: 40, pageRight: 180, pageTop: 100, pageBottom: 112, pageHeight: 12 },
      { text: "Left paragraph continues here.", pageLeft: 40, pageRight: 200, pageTop: 118, pageBottom: 130, pageHeight: 12 },
    ];
    const results = segmentPageIntoParagraphBBoxes([
      "Right paragraph starts here. Right paragraph continues here.",
      "Left paragraph starts here. Left paragraph continues here.",
    ].join("\n\n"), spans);
    expect(results).toHaveLength(2);
    expect(results.map((result) => result.rect.x)).toEqual([340, 40]);
  });

  it("fills an unmatched left column even when the right column matched", () => {
    const spans = [
      { text: "Left paragraph starts here.", pageLeft: 40, pageRight: 180, pageTop: 100, pageBottom: 112, pageHeight: 12 },
      { text: "Right paragraph starts here.", pageLeft: 340, pageRight: 480, pageTop: 100, pageBottom: 112, pageHeight: 12 },
      { text: "Left paragraph continues here.", pageLeft: 40, pageRight: 200, pageTop: 118, pageBottom: 130, pageHeight: 12 },
      { text: "Right paragraph continues here.", pageLeft: 340, pageRight: 500, pageTop: 118, pageBottom: 130, pageHeight: 12 },
    ];
    const results = segmentPageIntoParagraphBBoxes(
      "Right paragraph starts here. Right paragraph continues here.",
      spans,
    );
    expect(results).toHaveLength(2);
    expect(results.map((result) => result.rect.x).sort((a, b) => a - b)).toEqual([40, 340]);
  });

  it("does not create an extra fallback bbox inside an already matched column", () => {
    const spans = [
      { text: "Left paragraph starts here.", pageLeft: 40, pageRight: 180, pageTop: 100, pageBottom: 112, pageHeight: 12 },
      { text: "Right paragraph starts here.", pageLeft: 340, pageRight: 480, pageTop: 100, pageBottom: 112, pageHeight: 12 },
      { text: "Left paragraph continues here.", pageLeft: 40, pageRight: 200, pageTop: 118, pageBottom: 130, pageHeight: 12 },
      { text: "Right paragraph continues here.", pageLeft: 340, pageRight: 500, pageTop: 118, pageBottom: 130, pageHeight: 12 },
      { text: "Unmatched right-column footer", pageLeft: 340, pageRight: 470, pageTop: 180, pageBottom: 192, pageHeight: 12 },
    ];
    const results = segmentPageIntoParagraphBBoxes(
      "Right paragraph starts here. Right paragraph continues here.",
      spans,
    );
    expect(results).toHaveLength(2);
    expect(results.filter((result) => result.rect.x === 340)).toHaveLength(1);
  });

  it("uses a standalone bold Markdown line as the card title", () => {
    const spans = [
      { text: "Clinical Features", pageLeft: 40, pageRight: 180, pageTop: 100, pageBottom: 112, pageHeight: 12 },
      { text: "Patients commonly present with exertional dyspnea.", pageLeft: 40, pageRight: 320, pageTop: 118, pageBottom: 130, pageHeight: 12 },
    ];
    const results = segmentPageIntoParagraphBBoxes(
      "**Clinical Features**\nPatients commonly present with exertional dyspnea.",
      spans,
    );
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Clinical Features");
  });

  it("includes a short visual heading omitted from the Markdown paragraph", () => {
    const spans = [
      { text: "Rate", pageLeft: 200, pageRight: 235, pageTop: 100, pageBottom: 112, pageHeight: 12 },
      { text: "Normal adult heart rate is sixty to one hundred beats per minute.", pageLeft: 200, pageRight: 500, pageTop: 118, pageBottom: 130, pageHeight: 12 },
      { text: "Rates below sixty beats per minute are called bradycardia.", pageLeft: 200, pageRight: 480, pageTop: 136, pageBottom: 148, pageHeight: 12 },
    ];
    const body = "Normal adult heart rate is sixty to one hundred beats per minute. Rates below sixty beats per minute are called bradycardia.";
    const results = segmentPageIntoParagraphBBoxes(body, spans);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Rate");
    expect(results[0].text).toBe(body);
    expect(results[0].rect.y).toBe(100);
    expect(results[0].rect.h).toBe(48);
  });

  it("does not reuse a short line from the previous paragraph as a title", () => {
    const spans = [
      { text: "KEY FACT", pageLeft: 30, pageRight: 95, pageTop: 100, pageBottom: 112, pageHeight: 12 },
      { text: "Heart rate is calculated from the number of large", pageLeft: 30, pageRight: 190, pageTop: 118, pageBottom: 130, pageHeight: 12 },
      { text: "boxes between two consecutive", pageLeft: 30, pageRight: 145, pageTop: 136, pageBottom: 148, pageHeight: 12 },
      { text: "QRS complexes.", pageLeft: 30, pageRight: 100, pageTop: 148, pageBottom: 160, pageHeight: 12 },
      { text: "Presuming the ECG uses the usual recording speed.", pageLeft: 30, pageRight: 190, pageTop: 166, pageBottom: 178, pageHeight: 12 },
    ];
    const results = segmentPageIntoParagraphBBoxes([
      "Heart rate is calculated from the number of large boxes between two consecutive QRS complexes.",
      "Presuming the ECG uses the usual recording speed.",
    ].join("\n\n"), spans);
    expect(results).toHaveLength(2);
    expect(results[0].title).toBe("KEY FACT");
    expect(results[1].title).toBe("");
    expect(results[1].rect.y).toBe(166);
  });

  it("nests one bbox per bullet inside its enclosing paragraph bbox", () => {
    const spans = [
      { text: "KEY FACT", pageLeft: 30, pageRight: 95, pageTop: 100, pageBottom: 112, pageHeight: 12 },
      { text: "*Heart rate equals three hundred divided by the number of boxes.", pageLeft: 30, pageRight: 200, pageTop: 118, pageBottom: 130, pageHeight: 12 },
      { text: "*Presuming the ECG uses the usual recording speed.", pageLeft: 30, pageRight: 190, pageTop: 136, pageBottom: 148, pageHeight: 12 },
    ];
    const markdown = [
      "# KEY FACT",
      "",
      "*Heart rate equals three hundred divided by the number of boxes.",
      "",
      "*Presuming the ECG uses the usual recording speed.",
    ].join("\n");
    const results = segmentPageIntoParagraphBBoxes(markdown, spans);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("KEY FACT");
    expect(results[0].kind).toBe("paragraph");
    expect(results[0].childSegments).toHaveLength(2);
    expect(results[0].childSegments.map((bullet) => bullet.kind)).toEqual(["bullet", "bullet"]);
    expect(results[0].childSegments[0].text).toContain("Heart rate");
    expect(results[0].childSegments[1].text).toContain("Presuming");
    expect(results[0].childSegments[0].rect.h).toBe(12);
    expect(results[0].text).toContain("Heart rate");
    expect(results[0].text).toContain("Presuming");
    expect(results[0].rect.y).toBe(100);
    expect(results[0].rect.h).toBe(48);
  });

  it("keeps short Markdown headings as separate titled paragraphs", () => {
    const spans = [
      { text: "Rate", pageLeft: 200, pageRight: 235, pageTop: 100, pageBottom: 112, pageHeight: 12 },
      { text: "Normal heart rate is sixty to one hundred beats per minute.", pageLeft: 200, pageRight: 500, pageTop: 118, pageBottom: 130, pageHeight: 12 },
      { text: "Axis", pageLeft: 200, pageRight: 235, pageTop: 160, pageBottom: 172, pageHeight: 12 },
      { text: "The QRS axis represents the mean direction of ventricular current.", pageLeft: 200, pageRight: 510, pageTop: 178, pageBottom: 190, pageHeight: 12 },
    ];
    const markdown = [
      "# Rate",
      "",
      "Normal heart rate is sixty to one hundred beats per minute.",
      "",
      "# Axis",
      "",
      "The QRS axis represents the mean direction of ventricular current.",
    ].join("\n");
    const results = segmentPageIntoParagraphBBoxes(markdown, spans);
    expect(results).toHaveLength(2);
    expect(results.map((result) => result.title)).toEqual(["Rate", "Axis"]);
    expect(results.every((result) => result.kind === "paragraph" && result.childSegments.length === 0)).toBe(true);
  });

  it("builds paragraph hierarchy from plain OCR blocks without Markdown headings", () => {
    const rows = [
      "ELECTROCARDIOGRAM",
      "An ECG assesses the electrical activity of the heart.",
      "Rate",
      "Normal adult heart rate is sixty to one hundred beats per minute.",
      "Rhythm",
      "Sinus rhythm originates from the sinus node.",
      "Axis",
      "The QRS axis is determined from leads I, II, and aVF.",
    ];
    const spans = rows.map((text, index) => ({
      text,
      pageLeft: 200,
      pageRight: 520,
      pageTop: 100 + index * 18,
      pageBottom: 112 + index * 18,
      pageHeight: 12,
    }));
    const markdown = [
      "ELECTROCARDIOGRAM",
      "",
      rows[1],
      "",
      "Rate",
      "",
      rows[3],
      "",
      "Rhythm",
      "",
      rows[5],
      "",
      "Axis",
      "",
      rows[7],
    ].join("\n");

    const results = segmentPageIntoParagraphBBoxes(markdown, spans);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("ELECTROCARDIOGRAM");
    expect(results[0].kind).toBe("section");
    expect(results[0].childSegments).toHaveLength(4);
    expect(results[0].childSegments.map((child) => child.title)).toEqual(["", "Rate", "Rhythm", "Axis"]);
  });

  it("segments OCR table rows into titled paragraph boxes", () => {
    const spans = [
      { text: "TABLE 2.1-1. Axis Deviation", pageLeft: 40, pageRight: 260, pageTop: 100, pageBottom: 112, pageHeight: 12 },
      { text: "Normal axis", pageLeft: 40, pageRight: 130, pageTop: 120, pageBottom: 132, pageHeight: 12 },
      { text: "Mean ventricular vector points toward leads I and aVF.", pageLeft: 40, pageRight: 390, pageTop: 138, pageBottom: 150, pageHeight: 12 },
      { text: "Left axis deviation", pageLeft: 40, pageRight: 170, pageTop: 170, pageBottom: 182, pageHeight: 12 },
      { text: "The vector points toward lead I and away from aVF.", pageLeft: 40, pageRight: 370, pageTop: 188, pageBottom: 200, pageHeight: 12 },
    ];
    const ocr = [
      "CARDIOVASCULAR",
      "",
      "HIGH-YIELD FACTS IN",
      "",
      "19",
      "",
      "TABLE 2.1-1. Axis Deviation",
      "",
      "| Finding | Description |",
      "| --- | --- |",
      "| Normal axis | Mean ventricular vector points toward leads I and aVF. |",
      "| Left axis deviation | The vector points toward lead I and away from aVF. |",
    ].join("\n");

    const results = segmentPageIntoParagraphBBoxes(ocr, spans);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("TABLE 2.1-1. Axis Deviation");
    expect(results[0].kind).toBe("section");
    expect(results[0].childSegments).toHaveLength(2);
    expect(results[0].childSegments.map((child) => child.title)).toEqual(["Normal axis", "Left axis deviation"]);
    expect(results[0].childSegments[0].text).toBe("Mean ventricular vector points toward leads I and aVF.");
  });

  it("creates a figure section with image and caption children", () => {
    const spans = [
      { text: "FIGURE 2.1-1. Normal electrocardiogram from a healthy subject.", pageLeft: 200, pageRight: 510, pageTop: 650, pageBottom: 662, pageHeight: 12 },
    ];
    const imageRect = { x: 200, y: 460, w: 310, h: 180 };
    const markdown = [
      "![img-0.jpeg](img-0.jpeg)",
      "",
      "FIGURE 2.1-1. Normal electrocardiogram from a healthy subject.",
    ].join("\n");
    const results = segmentPageIntoParagraphBBoxes(markdown, spans, null, [imageRect]);
    expect(results).toHaveLength(1);
    expect(results[0].kind).toBe("section");
    expect(results[0].title).toBe("FIGURE 2.1-1.");
    expect(results[0].imageSegment?.rect).toEqual(imageRect);
    expect(results[0].childSegments).toHaveLength(1);
    expect(results[0].rect).toEqual({ x: 200, y: 460, w: 310, h: 202 });
  });
});
