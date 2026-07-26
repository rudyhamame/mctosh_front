// medicalStatementsExtraction.js
//
// Seam for AMCTOSHS Medical Statement extraction — turning one segment's
// (a content BBox's) extracted text into a list of discrete medical
// statements, one per line in SegmentationsPage's main area. The actual
// extraction logic hasn't been specified yet, so this always resolves to
// an empty list until that logic is wired in here.

/**
 * @param {{ id: string, pageNum: number, type: string, text: string }} segment
 * @returns {Promise<Array<{ id: string, text: string }>>}
 */
export const extractMedicalStatements = async (segment) => {
  void segment;
  return [];
};
