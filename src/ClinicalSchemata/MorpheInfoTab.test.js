import { describe, expect, it } from "vitest";
import fs from "node:fs";

const infoSource = fs.readFileSync(new URL("./MorpheInfoTab.jsx", import.meta.url), "utf8");

describe("AMCTOSHS Morphe Information content", () => {
  it("states the single-slice versus temporal measurability criterion", () => {
    expect(infoSource).toContain("A 3D Trace Value is obtainable from one present ontic slice.");
    expect(infoSource).toContain("A 4D Trace Value requires the retention and relation of temporally distinct 3D Trace Values.");
    expect(infoSource).toContain("The past Trace is not presently ontic; its retained Trace Value is used in the memory stack.");
  });

  it("classifies rate, rhythm, volume, change, and memory-stack provenance", () => {
    expect(infoSource).toContain("Rate is a 4D Trace Value because one sound occurrence cannot provide rate.");
    expect(infoSource).toContain("<td>Heart rate</td>");
    expect(infoSource).toContain("<td>Rhythm</td>");
    expect(infoSource).toContain("<td>Chamber volume at t1</td>");
    expect(infoSource).toContain("<td>Change in chamber volume</td>");
    expect(infoSource).toContain("Trace Value memory stack");
  });

  it("distinguishes 3D slice instantiation from 4D temporal instantiation", () => {
    expect(infoSource).toContain("This is a 3D slice instance.");
    expect(infoSource).toContain("This is a 4D temporal instance.");
    expect(infoSource).toContain("sourceSliceIds: [\"heart-1@t1\", \"heart-1@t2\"]");
  });
});
