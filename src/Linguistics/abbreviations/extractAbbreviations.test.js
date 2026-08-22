import { describe, expect, it } from "vitest";
import { extractDocumentAbbreviations } from "./extractAbbreviations.js";

const page = (pageNumber, text) => ({
  pageNumber,
  items: [{ str: text, hasEOL: true }],
});

describe("extractDocumentAbbreviations", () => {
  it("uses an explicit definition on one page to resolve occurrences on other pages", () => {
    const entries = extractDocumentAbbreviations([
      page(1, "An electrocardiogram (ECG) was obtained."),
      page(2, "The ECG showed sinus rhythm."),
    ]);
    const ecg = entries.find((entry) => entry.normalized === "ECG");

    expect(ecg).toMatchObject({
      longForm: "electrocardiogram",
      status: "confirmed",
      scope: "document",
      occurrenceCount: 2,
      pageNumbers: [1, 2],
      definitionSources: [1],
      resolvedFromContext: true,
    });
  });

  it("keeps conflicting document expansions as a candidate", () => {
    const entries = extractDocumentAbbreviations([
      page(1, "Atrial fibrillation (AF) was present."),
      page(2, "An acceleration factor (AF) was calculated."),
    ]);
    const af = entries.find((entry) => entry.normalized === "AF");

    expect(af.status).toBe("candidate");
    expect(af.longForm).toBe("");
    expect(af.alternatives).toHaveLength(2);
  });

  it("does not falsely confirm a repeated abbreviation without a definition", () => {
    const [entry] = extractDocumentAbbreviations([
      page(1, "ECG was obtained."),
      page(3, "Repeat ECG tomorrow."),
    ]);

    expect(entry.status).toBe("candidate");
    expect(entry.confirmationCount).toBe(0);
  });
});
