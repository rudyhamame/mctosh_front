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
    ops.paintInlineImageXObjectGroup,
    ops.paintJpegXObject,
    ops.paintImageXObjectRepeat,
    ops.paintImageMaskXObject,
    ops.paintImageMaskXObjectGroup,
    ops.paintImageMaskXObjectRepeat,
    ops.paintSolidColorImageMask,
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
    } else if (fn === ops.transform && args && args.length >= 6) {
      current = multiplyMatrices(current, args);
    } else if (fn === ops.paintFormXObjectBegin) {
      stack.push([...current]);
      if (args?.[0] && args[0].length >= 6) current = multiplyMatrices(current, args[0]);
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

/** Extract axis-aligned ruling segments from PDF.js path operations. */
export const extractVectorRulingLines = (operatorList, viewport, ops) => {
  if (!operatorList?.fnArray?.length || !viewport?.transform || !ops) return [];
  const stack = []; let current = [1, 0, 0, 1, 0, 0]; let pending = [];
  const lines = [];
  const paintOps = new Set([ops.stroke, ops.closeStroke, ops.fillStroke, ops.eoFillStroke, ops.closeFillStroke, ops.closeEOFillStroke].filter(Number.isFinite));
  const emit = () => { lines.push(...pending); pending = []; };
  for (let index = 0; index < operatorList.fnArray.length; index += 1) {
    const fn = operatorList.fnArray[index]; const args = operatorList.argsArray[index];
    if (fn === ops.save) stack.push([...current]);
    else if (fn === ops.restore) current = stack.pop() || current;
    else if (fn === ops.transform && args?.length >= 6) current = multiplyMatrices(current, args);
    else if (fn === ops.paintFormXObjectBegin) { stack.push([...current]); if (args?.[0]?.length >= 6) current = multiplyMatrices(current, args[0]); }
    else if (fn === ops.paintFormXObjectEnd) current = stack.pop() || current;
    else if (fn === ops.constructPath) {
      const pathOps = args?.[0] || []; const coords = args?.[1] || []; let cursor = 0; let point = null;
      const matrix = multiplyMatrices(viewport.transform, current);
      const add = (a, b) => {
        const start = transformPoint(matrix, a.x, a.y); const end = transformPoint(matrix, b.x, b.y);
        const dx = Math.abs(end.x - start.x); const dy = Math.abs(end.y - start.y);
        if (Math.max(dx, dy) >= 3 && Math.min(dx, dy) <= Math.max(0.8, Math.max(dx, dy) * 0.015)) pending.push({ x1: start.x, y1: start.y, x2: end.x, y2: end.y, source: "pdfjs-vector-path" });
      };
      pathOps.forEach((pathOp) => {
        if (pathOp === ops.moveTo) { point = { x: Number(coords[cursor]), y: Number(coords[cursor + 1]) }; cursor += 2; }
        else if (pathOp === ops.lineTo) { const next = { x: Number(coords[cursor]), y: Number(coords[cursor + 1]) }; cursor += 2; if (point) add(point, next); point = next; }
        else if (pathOp === ops.rectangle) {
          const x = Number(coords[cursor]); const y = Number(coords[cursor + 1]); const width = Number(coords[cursor + 2]); const height = Number(coords[cursor + 3]); cursor += 4;
          const corners = [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }];
          corners.forEach((corner, cornerIndex) => add(corner, corners[(cornerIndex + 1) % corners.length])); point = corners[0];
        } else if ([ops.curveTo, ops.curveTo2, ops.curveTo3].includes(pathOp)) cursor += pathOp === ops.curveTo ? 6 : 4;
      });
    } else if (paintOps.has(fn)) emit();
    else if ([ops.endPath, ops.fill, ops.eoFill].includes(fn)) pending = [];
  }
  return lines.sort((left, right) => left.y1 - right.y1 || left.x1 - right.x1 || left.y2 - right.y2 || left.x2 - right.x2);
};
