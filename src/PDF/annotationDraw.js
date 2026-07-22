import { getStroke } from "perfect-freehand";

// The highlight tool shares its color palette with every other annotation
// tool (ANNOT_COLORS in PDFPage.jsx), which includes near-black and other
// dark hues — fine for pen/text ink, but multiplied (mix-blend-mode) over
// already-dark PDF text at anything above default opacity, a dark pick
// darkens the text toward unreadable instead of "highlighting" it. Real
// highlighter markers don't have this problem because a marker literally
// can't be darker than translucent-pastel; clamp lightness the same way
// so any color choice stays legible, keeping the picked hue.
const hexToHsl = (hex) => {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return { h, s, l };
};
const hue2rgb = (p, q, t) => {
  let tt = t;
  if (tt < 0) tt += 1;
  if (tt > 1) tt -= 1;
  if (tt < 1 / 6) return p + (q - p) * 6 * tt;
  if (tt < 1 / 2) return q;
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
  return p;
};
const hslToRgb = (h, s, l) => {
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, h) * 255),
    b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  };
};
const HIGHLIGHT_MIN_LIGHTNESS = 0.55;
// Returns both a usable CSS color and its {r,g,b} — the safe (lightness-
// clamped) version of a picked color, used both to paint the highlight
// itself and (via relativeLuminance below) to decide whether masked text
// drawn on top of it should be black or white.
const highlightSafeColorRgb = (hex) => {
  if (typeof hex !== "string" || !/^#[0-9a-f]{6}$/i.test(hex)) return { r: 255, g: 224, b: 102 };
  const { h, s, l } = hexToHsl(hex);
  if (l >= HIGHLIGHT_MIN_LIGHTNESS) {
    return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
  }
  return hslToRgb(h, s, HIGHLIGHT_MIN_LIGHTNESS);
};
const rgbToCss = ({ r, g, b }) => `rgb(${r}, ${g}, ${b})`;
const highlightSafeColor = (hex) => rgbToCss(highlightSafeColorRgb(hex));
// WCAG relative luminance → pick whichever of black/white ink reads better
// against the (already-lightened, so usually bright) highlight color.
const relativeLuminance = ({ r, g, b }) => {
  const toLinear = (c) => {
    const cs = c / 255;
    return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
};
const contrastInkFor = (hex) => (relativeLuminance(highlightSafeColorRgb(hex)) > 0.42 ? "#000000" : "#ffffff");

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
    const showBorder = settings?.border !== false;
    const size = visibleWidth(baseWidth * s, 1.15);
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
      start: { taper: size * (0.6 + taperLevel * 6), cap: true },
      end: { taper: size * (0.6 + taperLevel * 6), cap: true },
    });
    if (!outline.length) return;
    ctx.save();
    traceStrokeOutline(outline);
    ctx.globalAlpha = 0.97;
    ctx.fill();

    if (showBorder) {
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
    const body = clamp((ann.highlightSettings?.body ?? 58) / 100, 0, 1);
    const lowZoomBoost = clamp((1 - s) * 0.4, 0, 0.22);
    const previousLineCap = ctx.lineCap;
    const previousComposite = ctx.globalCompositeOperation;
    const previousStrokeStyle = ctx.strokeStyle;
    ctx.lineCap = ann.mode === "line" && ann.taperEnds === false ? "butt" : "round";
    ctx.lineJoin = "round";
    ctx.globalCompositeOperation = "multiply";
    // This function only ever runs when there's no maskedText (see the
    // "highlight" case in drawAnnotation below — it's skipped entirely
    // when masked text exists, since drawMaskedHighlightText draws its
    // own band + text instead) — i.e. only when Auto Contrast was off for
    // this annotation. Use the color exactly as picked, no clamping.
    ctx.strokeStyle = ann.color;

    // Single main highlight body only.
    if (drawHighlightPath(ann.points, ann.mode)) {
      ctx.globalAlpha = Math.min(0.96, opacity * (0.68 + body * 0.22 + lowZoomBoost));
      ctx.lineWidth = visibleWidth(width, 3.6);
      ctx.stroke();
    }

    ctx.globalCompositeOperation = previousComposite;
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
  if (["rect", "circle", "line", "arrow"].includes(ann.type) && ann.borderStyle && ann.borderStyle !== "solid") {
    const w = ctx.lineWidth;
    ctx.setLineDash(ann.borderStyle === "dotted" ? [w * 0.01, w * 2.2] : [w * 2.4, w * 1.6]);
  }

  switch (ann.type) {
    case "highlight": {
      // The masked/recolored text (drawMaskedHighlightText, drawn on the
      // separate #pdf_mask_canvas above this one) already paints its own
      // opaque band wherever it covers text — drawing the original
      // translucent band here too just shows through at the edges where
      // the two don't pixel-perfectly line up, reading as a mismatched
      // "double highlight" halo. Skip it whenever there's masked text;
      // annotations with none (e.g. highlighting blank space) still get
      // the normal translucent band as their only visual.
      if (!Array.isArray(ann.maskedText) || !ann.maskedText.length) drawExpressiveHighlight(ann);
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
    case "drawTextSelection":
    case "smartVideoCapture":
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
        ctx.fillStyle = ann.shapeBackgroundColor || ann.color;
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
        ctx.fillStyle = ann.shapeBackgroundColor || ann.color;
        ctx.fill();
        ctx.restore();
      }
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

// Renders on a SEPARATE, non-multiply-blended canvas (#pdf_mask_canvas,
// stacked above #pdf_annot_canvas — see PDFPage.jsx's own render effect).
// #pdf_annot_canvas has mix-blend-mode:multiply applied via CSS to the
// whole element, so it composites against the PDF page canvas beneath it
// no matter what globalCompositeOperation is used for an individual draw
// call inside it — an "opaque" fill drawn there still gets multiplied
// against whatever's underneath, so a dark original glyph keeps showing
// through instead of being replaced. Only a canvas with normal (source-
// over) element-level blending can actually hide/replace content below
// it, hence the separate layer.
export const drawMaskedHighlightText = (ctx, ann, scale = 1) => {
  if (!Array.isArray(ann.maskedText) || !ann.maskedText.length) return;
  const s = scale;
  const p = (v) => v * s;
  const inkColor = contrastInkFor(ann.color);
  const fillColor = highlightSafeColor(ann.color);

  // Group into visual lines (same "within half a span's own height"
  // tolerance PDFPage.jsx's findSpansOverlappingHighlight uses) and fill
  // ONE merged rect per line, from the leftmost to the rightmost masked
  // word — a separate opaque fillRect per word (previous version) left a
  // gap at every word boundary, reading as disconnected blocks instead of
  // the one continuous band the highlight ink itself already is.
  const sorted = [...ann.maskedText].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  for (const t of sorted) {
    const centerY = t.y + t.height / 2;
    let line = lines.find((l) => Math.abs(l.centerY - centerY) < Math.max(t.height, l.height) * 0.5);
    if (!line) {
      line = { centerY, height: t.height, items: [] };
      lines.push(line);
    }
    line.items.push(t);
  }

  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  for (const line of lines) {
    const left = Math.min(...line.items.map((t) => t.x));
    const right = Math.max(...line.items.map((t) => t.x + t.width));
    const top = Math.min(...line.items.map((t) => t.y));
    const bottom = Math.max(...line.items.map((t) => t.y + t.height));
    ctx.fillStyle = fillColor;
    ctx.fillRect(p(left), p(top), p(right - left), p(bottom - top));
    for (const t of line.items) {
      // Span boxes are top-anchored at baseline - fontSize*0.8 with
      // height === fontSize (see the text-layer build effect in
      // PDFPage.jsx), so the baseline sits at top + 0.8*height.
      // fontFamily is pdf.js's own generic classification of the PDF's
      // real (often embedded/subset) font — serif/sans-serif/monospace,
      // not the exact typeface, but a real match for the original's
      // general look rather than an always-sans-serif guess.
      const fontFamily = t.fontFamily || "sans-serif";
      ctx.font = `${t.fontStyle || "normal"} ${t.fontWeight || "normal"} ${Math.max(8, t.fontSize * s)}px ${fontFamily.includes(" ") ? `"${fontFamily}"` : fontFamily}`;
      ctx.fillStyle = inkColor;
      ctx.fillText(t.text, p(t.x), p(t.y) + p(t.height) * 0.8);
    }
  }
  ctx.restore();
};
