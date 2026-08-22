import { getStroke } from "perfect-freehand";
import { isBBoxType } from "./pdfBBoxTypes.js";

const isClosedBBoxPath = (ann) => ann?.closed !== false;

const svgNumber = (value) => Number(value.toFixed(3));
const closedSvgPath = (points) => {
  if (!Array.isArray(points) || points.length < 3) return "";
  let path = `M ${svgNumber(points[0][0])} ${svgNumber(points[0][1])}`;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    path += ` Q ${svgNumber(current[0])} ${svgNumber(current[1])} ${svgNumber((current[0] + next[0]) / 2)} ${svgNumber((current[1] + next[1]) / 2)}`;
  }
  return `${path} Z`;
};

// Returns a genuine vector outline in annotation/document coordinates. The
// same persisted point data can therefore scale with the PDF without being
// enlarged as canvas pixels.
export const getPenAnnotationSvgPath = (ann) => {
  const points = Array.isArray(ann?.points) ? ann.points : [];
  if (ann?.type !== "pen" || points.length < 2) return "";
  const settings = ann.penSettings || {};
  const penType = ann.penType || "ball";
  const baseWidth = Math.max(0.05, Number(ann.lineWidth) || 2);
  const flow = Math.min(1, Math.max(0, (settings.flow ?? 38) / 100));
  const taper = Math.min(1, Math.max(0, (settings.taper ?? 72) / 100));

  if (penType !== "fountain") {
    const size = baseWidth * (0.72 + (1.18 - 0.72) * flow);
    const outline = getStroke(points.map((point) => ({
      x: point.x,
      y: point.y,
      pressure: Math.min(1, Math.max(0.02, point.pressure ?? 0.5)),
    })), {
      size,
      thinning: 0.72,
      smoothing: 0.32,
      streamline: 0.22,
      simulatePressure: false,
      last: true,
      start: { taper: size * (0.6 + taper * 6), cap: false },
      end: { taper: size * (0.6 + taper * 6), cap: false },
    });
    return closedSvgPath(outline);
  }

  const left = [];
  const right = [];
  const nibAngle = ((settings.nibAngle ?? 35) * Math.PI) / 180;
  const nibSpread = Math.min(1, Math.max(0, (settings.nibSpread ?? 68) / 100));
  const flowBoost = 1 + flow * 0.34;
  const count = points.length;
  for (let index = 0; index < count; index += 1) {
    const point = points[index];
    const previous = points[Math.max(0, index - 1)];
    const next = points[Math.min(count - 1, index + 1)];
    const source = index > 0 ? previous : point;
    const dt = Math.max(1, Math.abs((point.t ?? 0) - (source.t ?? 0)));
    const velocity = Math.hypot(point.x - source.x, point.y - source.y) / dt;
    const pressure = Math.min(1, Math.max(0, point.pressure ?? 0.5));
    const hasPressure = pressure > 0.01 && pressure < 0.99;
    const edge = Math.sin((index / Math.max(1, count - 1)) * Math.PI);
    const edgeTaper = (0.1 + (1 - taper) * 0.28) + (1 - (0.1 + (1 - taper) * 0.28)) * Math.pow(edge, 0.7 + taper * 0.9);
    const strokeAngle = Math.atan2(point.y - source.y, point.x - source.x);
    const broadness = Math.abs(Math.sin(strokeAngle - nibAngle));
    const nibBoost = 0.78 + (1 + nibSpread * 0.72 - 0.78) * broadness;
    const pressureFactor = hasPressure ? 0.72 + (1.9 - 0.72) * Math.pow(pressure, 0.8) : 1;
    const velocityFactor = hasPressure ? Math.max(0.86, 1.08 - velocity * 0.55) : Math.max(0.5, 1.38 - velocity * 2.8);
    const width = Math.max(0.05, baseWidth * pressureFactor * velocityFactor * edgeTaper * flowBoost * nibBoost);
    let dx = next.x - previous.x;
    let dy = next.y - previous.y;
    const length = Math.hypot(dx, dy) || 1;
    dx /= length;
    dy /= length;
    const half = width / 2;
    left.push([point.x - dy * half, point.y + dx * half]);
    right.push([point.x + dy * half, point.y - dx * half]);
  }
  return closedSvgPath([...left, ...right.reverse()]);
};

export const drawAnnotation = (ctx, ann, scale = 1, appearanceScale = 1) => {
  const s  = scale;
  const p  = (v) => v * s;
  const pt = ({ x, y }) => [x * s, y * s];
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const lerp = (a, b, t) => a + (b - a) * t;
  const visibleWidth = (width, minPx = 1.2) => Math.max(minPx, width);
  const visibleSize = (size, minPx = 11) => Math.max(minPx, size);
  const drawPolyline = (points) => {
    if (!points || points.length < 2) return;
    const [fx, fy] = pt(points[0]);
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    if (points.length === 2) {
      const [x, y] = pt(points[1]);
      ctx.lineTo(x, y);
      return;
    }
    for (let i = 1; i < points.length - 1; i++) {
      const [x, y] = pt(points[i]);
      const [nx, ny] = pt(points[i + 1]);
      ctx.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2);
    }
    const [lx, ly] = pt(points[points.length - 1]);
    ctx.lineTo(lx, ly);
  };
  const strokeVelocity = (a, b) => {
    const dt = Math.max(1, Math.abs((b.t ?? 0) - (a.t ?? 0)));
    const distance = Math.hypot(b.x - a.x, b.y - a.y);
    return distance / dt;
  };
  const penWidthForPoint = (baseWidth, prevPoint, point, penType, index, count, settings) => {
    const velocity = prevPoint ? strokeVelocity(prevPoint, point) : 0;
    const pressure = Math.min(1, Math.max(0, point.pressure ?? 0.5));
    const hasRealPressure = pressure > 0.01 && pressure < 0.99;
    const edgeTaper = Math.sin((Math.min(1, Math.max(0, index / Math.max(1, count - 1)))) * Math.PI);
    const taperLevel = clamp((settings?.taper ?? 72) / 100, 0, 1);
    const taper = lerp(0.1 + (1 - taperLevel) * 0.28, 1, Math.pow(edgeTaper, 0.7 + taperLevel * 0.9));
    const flowLevel = clamp((settings?.flow ?? 38) / 100, 0, 1);
    const flowBoost = 1 + flowLevel * (penType === "fountain" ? 0.34 : 0.18);
    let nibDirectionBoost = 1;

    if (penType === "fountain") {
      const nibAngleDeg = settings?.nibAngle ?? 35;
      const nibSpread = clamp((settings?.nibSpread ?? 68) / 100, 0, 1);
      if (prevPoint) {
        const strokeAngle = Math.atan2(point.y - prevPoint.y, point.x - prevPoint.x);
        const nibAngle = (nibAngleDeg * Math.PI) / 180;
        const broadness = Math.abs(Math.sin(strokeAngle - nibAngle));
        nibDirectionBoost = lerp(0.78, 1 + nibSpread * 0.72, broadness);
      }
      const pressureFactor = hasRealPressure
        ? lerp(0.72, 1.9, Math.pow(pressure, 0.8))
        : 1;
      const velocityFactor = hasRealPressure
        ? Math.max(0.86, 1.08 - velocity * 0.55)
        : Math.max(0.5, 1.38 - velocity * 2.8);
      return baseWidth * pressureFactor * velocityFactor * taper * flowBoost * nibDirectionBoost;
    }

    const pressureFactor = hasRealPressure
      ? lerp(0.88, 1.35, Math.pow(pressure, 0.9))
      : 1;
    const velocityFactor = hasRealPressure
      ? Math.max(0.9, 1.03 - velocity * 0.3)
      : Math.max(0.7, 1.14 - velocity * 1.3);
    return baseWidth * pressureFactor * velocityFactor * taper * flowBoost;
  };
  const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const buildStrokeRibbon = (points, baseWidth, penType, settings) => {
    if (!points || points.length < 2) return null;
    const left = [];
    const right = [];
    const widths = points.map((point, index) =>
      visibleWidth(
        penWidthForPoint(baseWidth, index > 0 ? points[index - 1] : null, point, penType, index, points.length, settings) * s,
        penType === "fountain" ? 1.35 : 1.15
      )
    );

    for (let i = 0; i < points.length; i++) {
      const current = points[i];
      const prev = points[Math.max(0, i - 1)];
      const next = points[Math.min(points.length - 1, i + 1)];
      let dx = next.x - prev.x;
      let dy = next.y - prev.y;
      const length = Math.hypot(dx, dy) || 1;
      dx /= length;
      dy /= length;
      const nx = -dy;
      const ny = dx;
      const half = widths[i] / 2;
      left.push({ x: p(current.x) + nx * half, y: p(current.y) + ny * half });
      right.push({ x: p(current.x) - nx * half, y: p(current.y) - ny * half });
    }

    return { left, right };
  };
  const traceRibbonPath = (edgeA, edgeB) => {
    if (!edgeA.length || !edgeB.length) return;
    ctx.beginPath();
    ctx.moveTo(edgeA[0].x, edgeA[0].y);
    if (edgeA.length === 1) {
      ctx.lineTo(edgeB[0].x, edgeB[0].y);
      ctx.closePath();
      return;
    }
    for (let i = 1; i < edgeA.length; i++) {
      const mid = midpoint(edgeA[i - 1], edgeA[i]);
      ctx.quadraticCurveTo(edgeA[i - 1].x, edgeA[i - 1].y, mid.x, mid.y);
    }
    const lastA = edgeA[edgeA.length - 1];
    ctx.lineTo(lastA.x, lastA.y);
    for (let i = edgeB.length - 1; i > 0; i--) {
      const mid = midpoint(edgeB[i], edgeB[i - 1]);
      ctx.quadraticCurveTo(edgeB[i].x, edgeB[i].y, mid.x, mid.y);
    }
    ctx.lineTo(edgeB[0].x, edgeB[0].y);
    ctx.closePath();
  };
  const drawExpressivePen = (points, baseWidth, penType, settings) => {
    if (!points || points.length < 2) return;
    const ribbon = buildStrokeRibbon(points, baseWidth, penType, settings);
    if (!ribbon) return;
    ctx.save();
    traceRibbonPath(ribbon.left, ribbon.right);
    // Pen ink is always solid. Flow may shape the stroke width, but it must
    // never fade the selected color or make the stroke translucent.
    ctx.globalAlpha = 1;
    ctx.fill();
    ctx.restore();
  };
  // perfect-freehand's own recommended smoothing recipe (average each
  // outline point with its neighbor via a quadratic curve, instead of
  // stroking the raw polygon edges) — same quadratic-through-midpoints
  // technique traceRibbonPath already uses above, just over the
  // library's outline instead of our own hand-built ribbon.
  const traceStrokeOutline = (outline) => {
    if (!outline.length) return;
    ctx.beginPath();
    const [startX, startY] = outline[0];
    ctx.moveTo(startX, startY);
    for (let i = 0; i < outline.length; i++) {
      const [x0, y0] = outline[i];
      const [x1, y1] = outline[(i + 1) % outline.length];
      ctx.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
    }
    ctx.closePath();
  };
  // The "ball" pen's dynamic mode — variable-width, pressure-sensitive
  // ink — is generated by perfect-freehand instead of our own hand-built
  // ribbon (buildStrokeRibbon/penWidthForPoint above), which is what
  // GoodNotes/Apple Notes/etc. use under the hood for that same feel.
  // "fountain" stays on the custom ribbon renderer above: its width
  // depends on stroke DIRECTION relative to a fixed nib angle, which
  // perfect-freehand's pressure-only width model has no equivalent for.
  // ann.points[].pressure is already a full 0–1 curve by the time this
  // runs — either real hardware pressure, or finalizePenStroke's own
  // synthetic velocity/edge-taper heuristic (applySyntheticStrokePressure,
  // PDFPage.jsx) — so simulatePressure stays off; overriding with
  // perfect-freehand's own velocity guess would ignore that pipeline.
  const drawExpressivePenBall = (points, baseWidth, settings) => {
    if (!points || points.length < 2) return;
    const flowLevel = clamp((settings?.flow ?? 38) / 100, 0, 1);
    const taperLevel = clamp((settings?.taper ?? 72) / 100, 0, 1);
    const size = visibleWidth(baseWidth * s * lerp(0.72, 1.18, flowLevel), 1.15);
    const strokePoints = points.map((point) => ({
      x: p(point.x),
      y: p(point.y),
      pressure: clamp(point.pressure ?? 0.5, 0.02, 1),
    }));
    const outline = getStroke(strokePoints, {
      size,
      thinning: 0.72,
      smoothing: 0.32,
      streamline: 0.22,
      simulatePressure: false,
      last: true,
      // Keep the taper inside the exact first/last pen points. A rounded
      // taper cap extends beyond those points, making the mark begin/end
      // before or after where the pen actually touched the page.
      start: { taper: size * (0.6 + taperLevel * 6), cap: false },
      end: { taper: size * (0.6 + taperLevel * 6), cap: false },
    });
    if (!outline.length) return;
    ctx.save();
    traceStrokeOutline(outline);
    ctx.globalAlpha = 1;
    ctx.fill();
    ctx.restore();
  };
  const drawSimplePen = (points, baseWidth) => {
    if (!points || points.length < 2) return;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.lineWidth = Math.max(0.6, baseWidth * s);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    drawPolyline(points);
    ctx.stroke();
    ctx.restore();
  };
  const drawHighlightPath = (points, mode) => {
    if (!points || points.length < 2) return false;
    ctx.beginPath();
    if (mode === "line") {
      const [fx, fy] = pt(points[0]);
      const [lx, ly] = pt(points[points.length - 1]);
      ctx.moveTo(fx, fy);
      ctx.lineTo(lx, ly);
      return true;
    }
    const [fx, fy] = pt(points[0]);
    ctx.moveTo(fx, fy);
    if (points.length === 2) {
      const [lx, ly] = pt(points[1]);
      ctx.lineTo(lx, ly);
      return true;
    }
    for (let i = 1; i < points.length - 1; i++) {
      const [x, y] = pt(points[i]);
      const [nx, ny] = pt(points[i + 1]);
      ctx.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2);
    }
    const [lx, ly] = pt(points[points.length - 1]);
    ctx.lineTo(lx, ly);
    return true;
  };
  const drawExpressiveHighlight = (ann) => {
    if (!ann.points || ann.points.length < 2) return;
    const width = visibleWidth((ann.lineWidth || 16) * s, 3.25);
    const opacity = ann.opacity ?? 0.35;
    const previousLineCap = ctx.lineCap;
    const previousStrokeStyle = ctx.strokeStyle;
    ctx.lineCap = ann.mode === "line" && ann.taperEnds === false ? "butt" : "round";
    ctx.lineJoin = "round";
    const drawStableFlatStroke = () => {
      if (ann.mode === "line" || typeof ann.highlightOrientation !== "number" || ann.points.length < 2) return false;
      // Use a true 2D centerline stroke. Its width is constant in the page
      // plane, so vertical drift changes only the path, never the apparent
      // thickness or the perspective of the marker.
      if (!drawHighlightPath(ann.points, ann.mode)) return false;
      ctx.save();
      ctx.lineWidth = width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = Math.min(1, Math.max(0, opacity));
      ctx.strokeStyle = ann.color || "#ffff00";
      ctx.stroke();
      ctx.restore();
      return true;
    };
    // The covered glyphs are painted separately above this stroke.
    // Render the highlight as one filled outline (not repeated strokes)
    // to avoid local overdraw at sampled points. Use perfect-freehand to
    // build a genuine polygon outline and fill it once with a single
    // global alpha and a multiply blend so page ink remains readable.
    try {
      if (drawStableFlatStroke()) {
        ctx.lineCap = previousLineCap;
        ctx.strokeStyle = previousStrokeStyle;
        return;
      }
      const strokePoints = ann.points.map((pt) => ({ x: p(pt.x), y: p(pt.y), pressure: clamp(pt.pressure ?? 0.5, 0.02, 1) }));
      const outlineSize = visibleWidth(width, 3.6);
      const outline = getStroke(strokePoints, {
        size: outlineSize,
        thinning: 0.1,
        smoothing: 0.2,
        streamline: 0.15,
        simulatePressure: false,
        last: true,
        start: { taper: 0, cap: false },
        end: { taper: 0, cap: false },
      });
      if (outline && outline.length) {
        ctx.save();
        // Use normal/source-over compositing and an RGBA fill so the
        // annotation's alpha is applied uniformly to the final shape
        // (avoids per-sample compounding). This produces a natural
        // translucent highlighter effect where underlying text remains
        // readable.
        // Keep canvas-level multiply blend so markers interact with page ink.
        // Use source-over when drawing the fill onto this canvas, but
        // apply the stroke opacity via globalAlpha so overlapping samples
        // don't compound inside the single filled geometry.
        ctx.globalCompositeOperation = "source-over";
        traceStrokeOutline(outline);
        // Opacity is a direct user-facing percentage: 0% is invisible and
        // 100% is fully opaque. The multiply blend keeps printed glyphs
        // readable underneath even at the maximum.
        const finalAlpha = Math.min(1, Math.max(0, opacity));
        ctx.globalAlpha = finalAlpha;
        ctx.fillStyle = ann.color || "#ffff00";
        ctx.fill();
        ctx.restore();
      }
    } catch (e) {
      // Fallback to stroking path if perfect-freehand fails for any reason.
      ctx.save();
      ctx.globalCompositeOperation = "multiply";
      ctx.strokeStyle = ann.color;
      if (drawHighlightPath(ann.points, ann.mode)) {
        ctx.globalAlpha = Math.min(1, Math.max(0, opacity));
        ctx.lineWidth = visibleWidth(width, 3.6);
        ctx.stroke();
      }
      ctx.restore();
    }

    ctx.lineCap = previousLineCap;
    ctx.strokeStyle = previousStrokeStyle;
  };

  ctx.save();
  ctx.strokeStyle = ann.color;
  ctx.fillStyle   = ann.color;
  ctx.lineWidth   = visibleWidth((ann.lineWidth || 2) * s, 1.4);
  ctx.lineCap     = "round";
  ctx.lineJoin    = "round";

  // Shapes tools only (line/arrow/rect/circle) — border.borderStyle set
  // once at creation time (PDFPage.jsx's onDown), from the toolbar's
  // Border style toggle. Dash lengths scale with the stroke's own width
  // so a thicker border still reads as clearly dashed/dotted, not just a
  // faint texture.
  if ((isBBoxType(ann.type) || ["rect", "circle", "freeshape", "line", "arrow"].includes(ann.type)) && ann.borderStyle && ann.borderStyle !== "solid") {
    const w = ctx.lineWidth;
    ctx.setLineDash(ann.borderStyle === "dotted" ? [w * 0.01, w * 2.2] : [w * 2.4, w * 1.6]);
  }

  // All registered BBox subtypes share this renderer. A future tableBBox or
  // figureBBox becomes drawable by registering it; no switch case is needed.
  if (isBBoxType(ann.type)) {
    if (Array.isArray(ann.points) && ann.points.length >= 2) {
      const points = ann.points;
      const closed = isClosedBBoxPath(ann);
      const [fx, fy] = pt(points[0]);
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      if (points.length === 2) {
        const [lx, ly] = pt(points[1]);
        ctx.lineTo(lx, ly);
      } else if (ann.geometry === "rectangle") {
        // Committed manual BBoxes are true geometric rectangles. Use straight
        // segments so the minimum-area orientation is preserved; the live
        // draft remains freeform until pointer-up.
        for (let i = 1; i < points.length; i += 1) {
          const [x, y] = pt(points[i]);
          ctx.lineTo(x, y);
        }
        if (closed) ctx.closePath();
      } else {
        for (let i = 1; i < points.length - 1; i++) {
          const [x, y] = pt(points[i]);
          const [nx, ny] = pt(points[i + 1]);
          ctx.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2);
        }
        const [lx, ly] = pt(points[points.length - 1]);
        ctx.lineTo(lx, ly);
        if (closed) ctx.closePath();
      }
      ctx.save();
      // Smart boxes are guides over the document; keep their outline light
      // enough that the PDF content remains primary.
      // BBox geometry follows `s`; visual chrome follows the same page-relative
      // scale as the rendered PDF.
      const borderSize = Math.min(1, Math.max(0.5, ann.smartSegmented ? 1 : (ann.lineWidth ?? 1))) * appearanceScale;
      ctx.setLineDash([8, 6].map((value) => value * appearanceScale));
      ctx.lineWidth = Math.max(0.5, borderSize);
      if (closed) {
        ctx.globalAlpha = 0.12;
        ctx.fillStyle = ann.color;
        ctx.fill();
      }
      ctx.globalAlpha = 0.95;
      ctx.strokeStyle = ann.color;
      ctx.stroke();
      ctx.restore();
    } else {
      ctx.save();
      // Keep persisted smart-segmentation guides visually lightweight even
      // when the general bbox tool uses a thicker user-selected stroke.
      const borderSize = Math.min(1, Math.max(0.5, ann.smartSegmented ? 1 : (ann.lineWidth ?? 1))) * appearanceScale;
      ctx.setLineDash([8, 6].map((value) => value * appearanceScale));
      ctx.lineWidth = Math.max(0.5, borderSize);
      ctx.globalAlpha = 0.95;
      ctx.strokeRect(p(ann.x), p(ann.y), p(ann.w), p(ann.h));
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.12;
      ctx.fillRect(p(ann.x), p(ann.y), p(ann.w), p(ann.h));
      ctx.restore();
    }
    ctx.restore();
    return;
  }

  switch (ann.type) {
    case "highlight": {
      // Draw the marker stroke on the blended annotation canvas. Masked
      // glyphs are painted separately above it, so the stroke stays behind
      // the text instead of washing it out.
      drawExpressiveHighlight(ann);
      break;
    }
    case "underline":
      ctx.beginPath();
      ctx.moveTo(p(ann.x),         p(ann.y + ann.h));
      ctx.lineTo(p(ann.x + ann.w), p(ann.y + ann.h));
      ctx.stroke();
      break;
    case "strikethrough":
      ctx.beginPath();
      ctx.moveTo(p(ann.x),         p(ann.y + ann.h / 2));
      ctx.lineTo(p(ann.x + ann.w), p(ann.y + ann.h / 2));
      ctx.stroke();
      break;
    case "pen":
      if (!ann.points || ann.points.length < 2) break;
      if (ann.penSettings?.dynamic === true) {
        if ((ann.penType || "ball") === "fountain") {
          drawExpressivePen(ann.points, ann.lineWidth || 2, "fountain", ann.penSettings);
        } else {
          drawExpressivePenBall(ann.points, ann.lineWidth || 2, ann.penSettings);
        }
      } else {
        drawSimplePen(ann.points, ann.lineWidth || 2);
      }
      break;
    case "line":
      ctx.beginPath(); ctx.moveTo(p(ann.x1), p(ann.y1)); ctx.lineTo(p(ann.x2), p(ann.y2)); ctx.stroke();
      break;
    case "smartVideoCapture":
      ctx.save();
      ctx.setLineDash([8, 6]);
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.95;
      ctx.strokeRect(p(ann.x), p(ann.y), p(ann.w), p(ann.h));
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.12;
      ctx.fillRect(p(ann.x), p(ann.y), p(ann.w), p(ann.h));
      ctx.restore();
      break;
    case "arrow": {
      const [x1, y1, x2, y2] = [p(ann.x1), p(ann.y1), p(ann.x2), p(ann.y2)];
      const dx = x2 - x1, dy = y2 - y1, len = Math.sqrt(dx * dx + dy * dy);
      if (len === 0) break;
      const ux = dx / len, uy = dy / len, hl = Math.max(14, (ann.lineWidth || 2) * 6) * s, ha = Math.PI / 6;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - hl * (ux * Math.cos(ha) - uy * Math.sin(ha)), y2 - hl * (uy * Math.cos(ha) + ux * Math.sin(ha)));
      ctx.lineTo(x2 - hl * (ux * Math.cos(ha) + uy * Math.sin(ha)), y2 - hl * (uy * Math.cos(ha) - ux * Math.sin(ha)));
      ctx.closePath(); ctx.fill();
      break;
    }
    case "rect": {
      const radius = Math.max(0, (ann.borderRadius || 0) * s);
      const rw = p(ann.w), rh = p(ann.h);
      const capped = radius > 0 && ctx.roundRect ? Math.min(radius, Math.abs(rw) / 2, Math.abs(rh) / 2) : 0;
      ctx.beginPath();
      if (capped > 0) {
        ctx.roundRect(p(ann.x), p(ann.y), rw, rh, capped);
      } else {
        ctx.rect(p(ann.x), p(ann.y), rw, rh);
      }
      // Same low-alpha wash convention as ann.textBackground (see the
      // "text" case below) — fill first so the stroke still reads as a
      // crisp border on top of it.
      if (ann.shapeBackground) {
        ctx.save();
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = ann.color; // fill always matches the shape's own border/ink color — no independent fill color
        ctx.fill();
        ctx.restore();
      }
      ctx.stroke();
      break;
    }
    case "circle":
      ctx.beginPath();
      ctx.ellipse(p(ann.x + ann.w / 2), p(ann.y + ann.h / 2), Math.abs(p(ann.w / 2)), Math.abs(p(ann.h / 2)), 0, 0, Math.PI * 2);
      if (ann.shapeBackground) {
        ctx.save();
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = ann.color; // fill always matches the shape's own border/ink color — no independent fill color
        ctx.fill();
        ctx.restore();
      }
      ctx.stroke();
      break;
    case "freeshape": {
      // An arbitrary closed outline — captured the same way a pen stroke
      // is (PDFPage.jsx's onDown/onMove, points pushed + smoothed via
      // smoothStrokePoint), but drawn CLOSED (last point connects back to
      // the first) and fillable/strokeable like rect/circle rather than
      // left open like a pen stroke. Same quadratic-curve smoothing as
      // drawPolyline above, just closing the path instead of leaving it open.
      if (!ann.points || ann.points.length < 2) break;
      const points = ann.points;
      const [fx, fy] = pt(points[0]);
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      if (points.length === 2) {
        const [lx, ly] = pt(points[1]);
        ctx.lineTo(lx, ly);
      } else {
        for (let i = 1; i < points.length - 1; i++) {
          const [x, y] = pt(points[i]);
          const [nx, ny] = pt(points[i + 1]);
          ctx.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2);
        }
        const [lx, ly] = pt(points[points.length - 1]);
        ctx.lineTo(lx, ly);
        ctx.closePath();
      }
      if (ann.shapeBackground) {
        ctx.save();
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = ann.color;
        ctx.fill();
        ctx.restore();
      }
      ctx.stroke();
      break;
    }
    case "text":
      ctx.save();
      {
        const listPrefix = ann.listStyle === "bullet" ? "• " : ann.listStyle === "numbered" ? "1. " : "";
        const text = `${listPrefix}${ann.text || ""}`;
        const fontSize = visibleSize((ann.fontSize || 16) * s, 11);
        const fontFamily = ann.fontFamily || "sans-serif";
        const fontWeight = ann.fontBold ? "700" : "400";
        const fontStyle = ann.fontItalic ? "italic" : "normal";
        const textAlign = ann.textAlign || "left";
        const baseline = ann.textBaseline || "alphabetic";
        ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${JSON.stringify(fontFamily)}`;
        ctx.textAlign = textAlign;
        ctx.textBaseline = baseline;
        const x = p(ann.x);
        const y = p(ann.y);
        const metrics = ctx.measureText(text);
        const textWidth = metrics.width;
        const ascent = metrics.actualBoundingBoxAscent ?? fontSize * 0.8;
        const descent = metrics.actualBoundingBoxDescent ?? fontSize * 0.2;
        const textTop = baseline === "top" ? y : y - ascent;
        const textHeight = ascent + descent;
        const left = textAlign === "center" ? x - textWidth / 2 : textAlign === "right" ? x - textWidth : x;
        // 100 = the original fixed ratio, so annotations saved before this
        // setting existed (ann.padding undefined) render identically.
        const paddingMul = (ann.padding ?? 100) / 100;
        const padX = Math.max(3, fontSize * 0.18) * paddingMul;
        const padY = Math.max(2, fontSize * 0.16) * paddingMul;
        ctx.fillStyle = ann.color;
        if (ann.textBackground) {
          // Same low-alpha wash of the background swatch's own color
          // (independently chosen from the text/ink color, via the same
          // floating color picker) as the live editor preview
          // (~0x40/255 ≈ 25%) — a highlight-style wash behind the text,
          // not a solid block, so the text drawn on top (still ann.color,
          // full opacity) stays readable. Falls back to ann.color only
          // for annotations saved before textBackgroundColor existed.
          ctx.save();
          ctx.globalAlpha = 0.25;
          ctx.fillStyle = ann.textBackgroundColor || ann.color;
          if (ctx.roundRect) {
            ctx.beginPath();
            ctx.roundRect(left - padX, textTop - padY, textWidth + padX * 2, textHeight + padY * 2, [Math.max(3, fontSize * 0.12)]);
            ctx.fill();
          } else {
            ctx.fillRect(left - padX, textTop - padY, textWidth + padX * 2, textHeight + padY * 2);
          }
          ctx.restore();
          ctx.fillStyle = ann.color;
        }
        ctx.fillText(text, x, y);
        if (ann.textUnderline) {
          ctx.save();
          ctx.lineWidth = Math.max(1, fontSize * 0.075);
          ctx.beginPath();
          ctx.moveTo(left, textTop + textHeight + Math.max(1.5, padY * 0.45));
          ctx.lineTo(left + textWidth, textTop + textHeight + Math.max(1.5, padY * 0.45));
          ctx.stroke();
          ctx.restore();
        }
      }
      ctx.restore();
      break;
    default: break;
  }

  // Linguistic unit badge — small label tab at top-left of the annotation
  if (ann.unit) {
    const bx = p(ann.x ?? ann.x1 ?? (ann.points?.[0]?.x ?? 0));
    const by = p(ann.y ?? ann.y1 ?? (ann.points?.[0]?.y ?? 0));
    const fs = visibleSize(11 * s, 9);
    ctx.save();
    ctx.font         = `700 ${fs}px sans-serif`;
    ctx.globalAlpha  = 0.92;
    const label      = ann.unit.charAt(0).toUpperCase() + ann.unit.slice(1);
    const tw         = ctx.measureText(label).width;
    const pad        = visibleWidth(3 * s, 2.5);
    const bw         = tw + pad * 2;
    const bh         = fs + pad * 2;
    ctx.fillStyle    = ann.color;
    ctx.beginPath();
    ctx.roundRect(bx, by - bh, bw, bh, [visibleWidth(3 * s, 2.5)]);
    ctx.fill();
    ctx.fillStyle    = "#000";
    ctx.globalAlpha  = 0.85;
    ctx.fillText(label, bx + pad, by - pad);
    ctx.restore();
  }

  ctx.restore();
};
