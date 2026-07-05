export const drawAnnotation = (ctx, ann, scale = 1) => {
  const s  = scale;
  const p  = (v) => v * s;
  const pt = ({ x, y }) => [x * s, y * s];

  ctx.save();
  ctx.strokeStyle = ann.color;
  ctx.fillStyle   = ann.color;
  ctx.lineWidth   = (ann.lineWidth || 2) * s;
  ctx.lineCap     = "round";
  ctx.lineJoin    = "round";

  switch (ann.type) {
    case "highlight": {
      if (!ann.points || ann.points.length < 2) break;
      const opacity = ann.opacity ?? 0.35;
      const width   = (ann.lineWidth || 16) * s;
      const buildHighlightPath = () => {
        ctx.beginPath();
        if (ann.mode === "line") {
          const [fx, fy] = pt(ann.points[0]);
          const [lx, ly] = pt(ann.points[ann.points.length - 1]);
          ctx.moveTo(fx, fy); ctx.lineTo(lx, ly);
        } else {
          const [fx, fy] = pt(ann.points[0]);
          ctx.moveTo(fx, fy);
          for (let i = 1; i < ann.points.length; i++) { const [x, y] = pt(ann.points[i]); ctx.lineTo(x, y); }
        }
      };
      // Bordered mode: stroke a slightly wider, more opaque pass first so a
      // solid edge peeks out around the translucent fill on top of it.
      if (ann.bordered) {
        buildHighlightPath();
        ctx.globalAlpha = Math.min(1, opacity + 0.45);
        ctx.lineWidth   = width + 3 * s;
        ctx.stroke();
      }
      buildHighlightPath();
      ctx.globalAlpha = opacity;
      ctx.lineWidth   = width;
      ctx.stroke();
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
      ctx.beginPath();
      { const [fx, fy] = pt(ann.points[0]); ctx.moveTo(fx, fy); }
      for (let i = 1; i < ann.points.length; i++) { const [x, y] = pt(ann.points[i]); ctx.lineTo(x, y); }
      ctx.stroke();
      break;
    case "line":
      ctx.beginPath(); ctx.moveTo(p(ann.x1), p(ann.y1)); ctx.lineTo(p(ann.x2), p(ann.y2)); ctx.stroke();
      break;
    case "arrow": {
      const [x1, y1, x2, y2] = [p(ann.x1), p(ann.y1), p(ann.x2), p(ann.y2)];
      const dx = x2 - x1, dy = y2 - y1, len = Math.sqrt(dx * dx + dy * dy);
      if (len === 0) break;
      const ux = dx / len, uy = dy / len, hl = 14 * s, ha = Math.PI / 6;
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
      ctx.font = `${(ann.fontSize || 16) * s}px sans-serif`;
      ctx.fillText(ann.text || "", p(ann.x), p(ann.y));
      break;
    default: break;
  }

  // Linguistic unit badge — small label tab at top-left of the annotation
  if (ann.unit) {
    const bx = p(ann.x ?? ann.x1 ?? (ann.points?.[0]?.x ?? 0));
    const by = p(ann.y ?? ann.y1 ?? (ann.points?.[0]?.y ?? 0));
    const fs = Math.max(9, 11 * s);
    ctx.save();
    ctx.font         = `700 ${fs}px sans-serif`;
    ctx.globalAlpha  = 0.92;
    const label      = ann.unit.charAt(0).toUpperCase() + ann.unit.slice(1);
    const tw         = ctx.measureText(label).width;
    const pad        = 3 * s;
    const bw         = tw + pad * 2;
    const bh         = fs + pad * 2;
    ctx.fillStyle    = ann.color;
    ctx.beginPath();
    ctx.roundRect(bx, by - bh, bw, bh, [3 * s]);
    ctx.fill();
    ctx.fillStyle    = "#000";
    ctx.globalAlpha  = 0.85;
    ctx.fillText(label, bx + pad, by - pad);
    ctx.restore();
  }

  ctx.restore();
};
