import React, { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { drawPagePatina } from "./pagePatina";
import { getSafeCanvasOutputScale } from "./canvasBudget";

const PagePatinaOverlay = forwardRef(({ page, width, height, className = "" }, ref) => {
  const canvasRef = useRef(null);
  useImperativeHandle(ref, () => canvasRef.current, []);
  useEffect(() => {
    // Patina is a soft decorative wash, not text or line art. Rendering it at
    // one backing pixel per CSS pixel avoids another full HiDPI page bitmap.
    const outputScale = getSafeCanvasOutputScale(width, height, Math.min(1, window.devicePixelRatio || 1));
    drawPagePatina(canvasRef.current, page, width, height, outputScale);
  }, [height, page, width]);
  return <canvas ref={canvasRef} className={`pdf_page_patina_canvas ${className}`} aria-hidden="true" />;
});

PagePatinaOverlay.displayName = "PagePatinaOverlay";
export default PagePatinaOverlay;
