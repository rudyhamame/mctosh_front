import { describe, expect, it } from "vitest";
import { formatForensicValue } from "./PDFForensicPanel";

describe("PDF Forensics evidence formatting", () => {
  it("keeps empty arrays visible and primitive arrays readable", () => {
    expect(formatForensicValue([])).toBe("[]");
    expect(formatForensicValue(["A", -5, "B"])).toBe("A, -5, B");
  });

  it("renders raw PDF control bytes as explicit escapes", () => {
    expect(formatForensicValue("[(BIOCHEMISTR)15(Y\u001fM)]"))
      .toBe("[(BIOCHEMISTR)15(Y\\u001FM)]");
  });

  it("preserves raw PDF string and array syntax", () => {
    expect(formatForensicValue("(HEART)")).toBe("(HEART)");
    expect(formatForensicValue("[(HEA) 180 (RT)]")).toBe("[(HEA) 180 (RT)]");
  });
});
