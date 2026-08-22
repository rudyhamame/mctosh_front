import { describe, expect, it } from "vitest";
import { isResponseStillCurrent, makeRequestId } from "./pdfSegmentationRequest.js";

describe("pdfSegmentationRequest — makeRequestId", () => {
  it("produces distinct ids on successive calls", () => {
    const a = makeRequestId();
    const b = makeRequestId();
    expect(a).not.toBe(b);
  });
});

describe("pdfSegmentationRequest — isResponseStillCurrent (spec §3, freeze the request page)", () => {
  it("applies when it's the latest request and the user never navigated away", () => {
    const latestRequest = { pageNumber: 12, requestId: "r1" };
    expect(isResponseStillCurrent({ latestRequest, currentPageNumber: 12, requestedPageNumber: 12, requestId: "r1" })).toBe(true);
  });

  it("drops the response if the user navigated to a different page before it arrived", () => {
    // Segmentation started on page 12, response arrives while the user is now on page 25.
    const latestRequest = { pageNumber: 12, requestId: "r1" };
    expect(isResponseStillCurrent({ latestRequest, currentPageNumber: 25, requestedPageNumber: 12, requestId: "r1" })).toBe(false);
  });

  it("drops a stale response when a second click superseded it on the same page", () => {
    // First click's response (r1) arrives after a second click (r2) was already issued.
    const latestRequest = { pageNumber: 12, requestId: "r2" };
    expect(isResponseStillCurrent({ latestRequest, currentPageNumber: 12, requestedPageNumber: 12, requestId: "r1" })).toBe(false);
  });

  it("applies correctly to the newer request once it resolves", () => {
    const latestRequest = { pageNumber: 12, requestId: "r2" };
    expect(isResponseStillCurrent({ latestRequest, currentPageNumber: 12, requestedPageNumber: 12, requestId: "r2" })).toBe(true);
  });

  it("drops a response if the user left and came back to the same page, but a newer request was issued in between", () => {
    // Navigated 12 -> 25 -> 12, but re-clicked "AI Segment Page" on the
    // second visit (r2) before the original (r1) resolved.
    const latestRequest = { pageNumber: 12, requestId: "r2" };
    expect(isResponseStillCurrent({ latestRequest, currentPageNumber: 12, requestedPageNumber: 12, requestId: "r1" })).toBe(false);
  });

  it("returns false when there is no request on record at all", () => {
    expect(isResponseStillCurrent({ latestRequest: null, currentPageNumber: 12, requestedPageNumber: 12, requestId: "r1" })).toBe(false);
  });
});
