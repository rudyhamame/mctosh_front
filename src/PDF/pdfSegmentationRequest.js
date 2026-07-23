// pdfSegmentationRequest.js
//
// Pure "is this AI segmentation response still the one I'm waiting on"
// predicate (spec §3 — freeze the request page), pulled out of
// PdfNarrativeView.jsx so the race-protection logic is unit-testable
// without mounting a component. A response only applies to the UI when
// BOTH: (a) it's the LATEST request issued (guards against two clicks on
// the same page racing each other) and (b) the user is still looking at
// the exact page it was issued for (guards against navigating away
// during an in-flight request). Either check failing means the response
// is silently dropped from the UI — it's already correctly persisted
// server-side under the page it was requested for, so navigating back
// later loads it for free via a plain GET, no re-call needed.

export const makeRequestId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * `latestRequest`: {pageNumber, requestId} of the most recently issued
 * segment request (survives page navigation). `currentPageNumber`: the
 * page the UI is showing RIGHT NOW. `requestedPageNumber`/`requestId`:
 * identity of the specific response being checked.
 */
export const isResponseStillCurrent = ({ latestRequest, currentPageNumber, requestedPageNumber, requestId }) => (
  !!latestRequest
  && latestRequest.requestId === requestId
  && latestRequest.pageNumber === requestedPageNumber
  && currentPageNumber === requestedPageNumber
);
