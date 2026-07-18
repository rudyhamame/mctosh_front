export const drawAnnotation = (ctx, ann, scale = 1) => {
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
    const flowLevel = clamp((settings?.flow ?? 38) / 100, 0, 1);
    const showBorder = settings?.border !== false;
    ctx.save();
    traceRibbonPath(ribbon.left, ribbon.right);
    ctx.globalAlpha = penType === "fountain" ? 0.92 : 0.97;
    ctx.fill();

    if (showBorder && penType === "ball") {
      ctx.globalAlpha = 0.16 + flowLevel * 0.18;
      ctx.lineWidth = Math.max(0.6, baseWidth * (0.14 + flowLevel * 0.1)) * s;
      drawPolyline(points);
      ctx.stroke();
      if (flowLevel > 0.18) {
        ctx.globalAlpha = 0.04 + flowLevel * 0.08;
        ctx.lineWidth = Math.max(1, baseWidth * (1.15 + flowLevel * 0.75)) * s;
        drawPolyline(points);
        ctx.stroke();
      }
    }

    if (showBorder && penType === "fountain") {
      ctx.globalAlpha = 0.18 + flowLevel * 0.16;
      ctx.lineWidth = Math.max(0.8, baseWidth * 0.18) * s;
      drawPolyline(points);
      ctx.stroke();
      ctx.globalAlpha = 0.05 + flowLevel * 0.11;
      ctx.lineWidth = Math.max(1, baseWidth * (1.7 + flowLevel * 1.1)) * s;
      drawPolyline(points);
      ctx.stroke();
    }
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
    const softness = clamp((ann.highlightSettings?.softness ?? 72) / 100, 0, 1);
    const body = clamp((ann.highlightSettings?.body ?? 58) / 100, 0, 1);
    const lowZoomBoost = clamp((1 - s) * 0.4, 0, 0.22);
    const previousLineCap = ctx.lineCap;
    const previousComposite = ctx.globalCompositeOperation;
    ctx.lineCap = ann.mode === "line" && ann.taperEnds === false ? "butt" : "round";
    ctx.lineJoin = "round";
    ctx.globalCompositeOperation = "multiply";

    // Outer feather: broad and airy so the mark feels soaked into the page.
    if (drawHighlightPath(ann.points, ann.mode)) {
      ctx.globalAlpha = Math.min(0.92, opacity * (0.22 + softness * 0.16 + lowZoomBoost * 0.7));
      ctx.lineWidth = visibleWidth(width * (1.18 + softness * 0.24), 4.4);
      ctx.stroke();
    }

    // Main body: the visual marker stroke.
    if (drawHighlightPath(ann.points, ann.mode)) {
      ctx.globalAlpha = Math.min(0.96, opacity * (0.68 + body * 0.22 + lowZoomBoost));
      ctx.lineWidth = visibleWidth(width * (0.88 + softness * 0.08), 3.6);
      ctx.stroke();
    }

    // Center density: gives that richer Goodnotes-like middle band.
    if (drawHighlightPath(ann.points, ann.mode)) {
      ctx.globalAlpha = Math.min(0.82, opacity * (0.18 + body * 0.12 + lowZoomBoost * 0.45));
      ctx.lineWidth = visibleWidth(width * (0.52 + body * 0.08), 2.1);
      ctx.stroke();
    }

    // Gentle edge wobble on freehand marks keeps them from looking too vector-perfect.
    if (ann.mode !== "line" && ann.points.length > 2 && drawHighlightPath(ann.points, ann.mode)) {
      ctx.globalAlpha = opacity * 0.07;
      ctx.lineWidth = width * (0.96 + softness * 0.12);
      ctx.stroke();
    }

    ctx.globalCompositeOperation = previousComposite;
    ctx.lineCap = previousLineCap;
  };

  ctx.save();
  ctx.strokeStyle = ann.color;
  ctx.fillStyle   = ann.color;
  ctx.lineWidth   = visibleWidth((ann.lineWidth || 2) * s, 1.4);
  ctx.lineCap     = "round";
  ctx.lineJoin    = "round";

  switch (ann.type) {
    case "highlight": {
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
      drawExpressivePen(ann.points, ann.lineWidth || 2, ann.penType || "ball", ann.penSettings);
      break;
    case "line":
      ctx.beginPath(); ctx.moveTo(p(ann.x1), p(ann.y1)); ctx.lineTo(p(ann.x2), p(ann.y2)); ctx.stroke();
      break;
    case "drawTextSelection":
      ctx.save();
      ctx.setLineDash([8, 6]);
      ctx.lineWidth = Math.max(1.5, 2 * s);
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
    case "rect":
      ctx.strokeRect(p(ann.x), p(ann.y), p(ann.w), p(ann.h));
      break;
    case "circle":
      ctx.beginPath();
      ctx.ellipse(p(ann.x + ann.w / 2), p(ann.y + ann.h / 2), Math.abs(p(ann.w / 2)), Math.abs(p(ann.h / 2)), 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case "text":
      ctx.save();
      {
        const text = ann.text || "";
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
        const padX = Math.max(3, fontSize * 0.18);
        const padY = Math.max(2, fontSize * 0.16);
        ctx.fillStyle = ann.color;
        if (ann.textBordered) {
          ctx.save();
          ctx.lineWidth = Math.max(1, fontSize * 0.08);
          ctx.strokeStyle = ann.color;
          ctx.globalAlpha = 0.85;
          if (ctx.roundRect) {
            ctx.beginPath();
            ctx.roundRect(left - padX, textTop - padY, textWidth + padX * 2, textHeight + padY * 2, [Math.max(3, fontSize * 0.12)]);
            ctx.stroke();
          } else {
            ctx.strokeRect(left - padX, textTop - padY, textWidth + padX * 2, textHeight + padY * 2);
          }
          ctx.restore();
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
