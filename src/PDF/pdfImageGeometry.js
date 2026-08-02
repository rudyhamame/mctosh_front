const multiplyMatrices = (first, second) => [
  first[0] * second[0] + first[2] * second[1],
  first[1] * second[0] + first[3] * second[1],
  first[0] * second[2] + first[2] * second[3],
  first[1] * second[2] + first[3] * second[3],
  first[0] * second[4] + first[2] * second[5] + first[4],
  first[1] * second[4] + first[3] * second[5] + first[5],
];

const transformPoint = (matrix, x, y) => ({
  x: matrix[0] * x + matrix[2] * y + matrix[4],
  y: matrix[1] * x + matrix[3] * y + matrix[5],
});

export const extractPlacedImageRects = (operatorList, viewport, ops) => {
  if (!operatorList?.fnArray?.length || !viewport?.transform || !ops) return [];
  const scale = Math.max(0.0001, Number(viewport.scale) || 1);
  const imageOps = new Set([
    ops.paintImageXObject,
    ops.paintInlineImageXObject,
    ops.paintJpegXObject,
  ].filter(Number.isFinite));
  const stack = [];
  const rects = [];
  let current = [1, 0, 0, 1, 0, 0];

  for (let index = 0; index < operatorList.fnArray.length; index += 1) {
    const fn = operatorList.fnArray[index];
    const args = operatorList.argsArray[index];
    if (fn === ops.save) {
      stack.push([...current]);
    } else if (fn === ops.restore) {
      current = stack.pop() || current;
    } else if (fn === ops.transform && Array.isArray(args) && args.length >= 6) {
      current = multiplyMatrices(current, args);
    } else if (fn === ops.paintFormXObjectBegin) {
      stack.push([...current]);
      if (Array.isArray(args?.[0]) && args[0].length >= 6) current = multiplyMatrices(current, args[0]);
    } else if (fn === ops.paintFormXObjectEnd) {
      current = stack.pop() || current;
    } else if (imageOps.has(fn)) {
      const matrix = multiplyMatrices(viewport.transform, current);
      const points = [
        transformPoint(matrix, 0, 0),
        transformPoint(matrix, 1, 0),
        transformPoint(matrix, 0, 1),
        transformPoint(matrix, 1, 1),
      ];
      const left = Math.min(...points.map((point) => point.x)) / scale;
      const top = Math.min(...points.map((point) => point.y)) / scale;
      const right = Math.max(...points.map((point) => point.x)) / scale;
      const bottom = Math.max(...points.map((point) => point.y)) / scale;
      if (right - left >= 8 && bottom - top >= 8) {
        rects.push({ x: left, y: top, w: right - left, h: bottom - top });
      }
    }
  }
  return rects;
};
