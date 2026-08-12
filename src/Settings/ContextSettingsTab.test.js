import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const component = fs.readFileSync(path.resolve("src/Settings/ContextSettingsTab.jsx"), "utf8");
const styles = fs.readFileSync(path.resolve("src/Settings/contextSettingsTab.css"), "utf8");

describe("Context Settings review UI", () => {
  it("exposes accessible labels for review actions, filters, progress, and candidate selection", () => {
    [
      "Filter review queue by status", "Choose another correction candidate", "Accept suggestion",
      "Reject suggestion", "Edit suggestion", "Mark original correct", "Mark unresolved", "Reanalyze",
      'aria-live="polite"', "<progress",
    ].forEach((label) => expect(component).toContain(label));
  });

  it("keeps wide review data scrollable and provides a narrow-screen layout", () => {
    expect(styles).toMatch(/\.context_table_wrap\s*\{[^}]*overflow:\s*auto/s);
    expect(styles).toContain("@media (max-width:760px)");
    expect(styles).toContain("grid-template-columns:1fr");
  });
});
