import { describe, expect, it } from "vitest";
import { flattenPersistedAnnotationLayers } from "./useAllSegments.js";

describe("saved segmentation layer normalization", () => {
  it("preserves the legacy flat page format", () => {
    const stored = { 2: [{ id: "paragraph-1", type: "bbox" }] };
    expect(flattenPersistedAnnotationLayers(stored)).toBe(stored);
  });

  it("merges persisted annotation layers into their database pages", () => {
    const stored = [
      {
        id: "layer-1",
        visible: true,
        annotations: {
          2: [{ id: "page-1", type: "pageBBox" }],
          3: [{ id: "paragraph-2", type: "bbox" }],
        },
      },
      {
        id: "layer-2",
        visible: false,
        annotations: {
          2: [{ id: "paragraph-1", type: "bbox" }],
        },
      },
    ];

    expect(flattenPersistedAnnotationLayers(stored)).toEqual({
      2: [
        { id: "page-1", type: "pageBBox" },
        { id: "paragraph-1", type: "bbox" },
      ],
      3: [{ id: "paragraph-2", type: "bbox" }],
    });
  });
});
