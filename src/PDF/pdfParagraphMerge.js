export const buildParagraphMergePlan = (records) => {
  const hasCompleteReadingOrder = (records || []).every((record) => Number.isFinite(record.readingOrder));
  const orderedRecords = [...(records || [])].sort((left, right) => {
    if (hasCompleteReadingOrder && left.readingOrder !== right.readingOrder) {
      return left.readingOrder - right.readingOrder;
    }
    const topDelta = (left.paragraph?.y ?? 0) - (right.paragraph?.y ?? 0);
    if (topDelta !== 0) return topDelta;
    const leftDelta = (left.paragraph?.x ?? 0) - (right.paragraph?.x ?? 0);
    if (leftDelta !== 0) return leftDelta;
    return (left.inputOrder ?? 0) - (right.inputOrder ?? 0);
  });

  return {
    orderedRecords,
    // Earlier paragraphs are prepended to the final selected paragraph,
    // which remains the persisted annotation and owns the merged children.
    survivor: orderedRecords.at(-1)?.paragraph || null,
    mergedLines: orderedRecords.flatMap((record) => record.lines || []),
  };
};
