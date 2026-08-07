import { describe, expect, it } from "vitest";
import { glueParagraphLines, repairLineBreakHyphenation } from "./repairLineBreakHyphenation";

describe("line-break dehyphenation", () => {
  it("joins a known broken word", () => {
    const result = repairLineBreakHyphenation("char-\nacterized");
    expect(result.normalizedText).toBe("characterized");
    expect(result.transformations[0].ruleId).toBe("KNOWN_JOINED_WORD");
  });
  it("preserves known compounds", () => {
    expect(repairLineBreakHyphenation("beat-\nto-beat").normalizedText).toBe("beat-to-beat");
    expect(repairLineBreakHyphenation("long-\nterm").normalizedText).toBe("long-term");
  });
  it("removes soft hyphens without changing ordinary hyphens", () => {
    expect(repairLineBreakHyphenation("char\u00ADacterized").normalizedText).toBe("characterized");
    expect(repairLineBreakHyphenation("dose-dependent").normalizedText).toBe("dose-dependent");
  });
  it("preserves ambiguous and unknown candidates", () => {
    const resources = { isKnownWord: () => true, isKnownHyphenatedWord: () => true };
    expect(repairLineBreakHyphenation("long-\nterm", resources).normalizedText).toBe("long-\nterm");
    expect(repairLineBreakHyphenation("qzx-\nabc").normalizedText).toBe("qzx-\nabc");
  });
  it("glues repaired lines only after dehyphenation", () => {
    const repaired = repairLineBreakHyphenation("char-\nacterized\nheart rate");
    expect(repaired.normalizedText).toBe("characterized\nheart rate");
    expect(glueParagraphLines(repaired.normalizedText)).toBe("characterized heart rate");
  });
});
