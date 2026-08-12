import { useCallback, useRef, useState } from "react";

const useDraggableFloating = () => {
  const panelRef = useRef(null);
  const dragRef = useRef(null);
  const [dragStyle, setDragStyle] = useState(null);

  const onPointerDown = useCallback((event) => {
    if (event.button !== undefined && event.button !== 0) return;
    if (event.target.closest?.("button, input, select, textarea, a")) return;
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, left: rect.left, top: rect.top };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    const onMove = (moveEvent) => {
      const drag = dragRef.current;
      if (!drag || moveEvent.pointerId !== drag.pointerId) return;
      const left = Math.max(8, Math.min(window.innerWidth - rect.width - 8, drag.left + moveEvent.clientX - drag.startX));
      const top = Math.max(8, Math.min(window.innerHeight - rect.height - 8, drag.top + moveEvent.clientY - drag.startY));
      setDragStyle({ left: `${left}px`, top: `${top}px`, right: "auto", bottom: "auto", transform: "none" });
    };
    const onUp = (upEvent) => {
      if (upEvent.pointerId !== drag.pointerId) return;
      dragRef.current = null;
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
  }, []);

  return { panelRef, dragStyle, dragHandleProps: { onPointerDown } };
};

export default useDraggableFloating;
