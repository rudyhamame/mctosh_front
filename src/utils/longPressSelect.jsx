import React, { useEffect, useRef } from "react";

// Makes a block of read-only text unselectable by a quick click/drag —
// selection only turns on once the press has been held for `delay` ms
// without moving more than `moveTolerance` px. A quick click (e.g. to seek,
// to trigger a highlight, or just to scroll by touch-dragging over the text)
// never starts a selection; only a deliberate long press does.
//
// The word picked is the one under the finger/cursor at touchDOWN, not
// wherever it happens to be at release — we don't just flip `user-select`
// and let the browser's native long-press gesture pick a word itself,
// because that native gesture resolves against wherever the touch point
// is when the OS actually triggers selection, which on several mobile
// browsers is effectively the release point if the flip happens mid-touch.
// Instead we snapshot the touchdown coordinates and, once the hold
// completes, explicitly resolve and select the word AT THAT POINT.
export function attachLongPressSelect(el, { delay = 400, moveTolerance = 10 } = {}) {
  if (!el) return () => {};

  const setSelectable = (on) => {
    el.style.userSelect = on ? "text" : "none";
    el.style.webkitUserSelect = on ? "text" : "none";
  };
  setSelectable(false);

  let timer = null;
  let start = null;
  let armed = false;

  const clearTimer = () => { if (timer) { clearTimeout(timer); timer = null; } };
  const point = (e) => (e.touches ? e.touches[0] : e);

  const selectWordAt = (x, y) => {
    let range = null;
    if (document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(x, y);
    } else if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(x, y);
      if (pos) {
        range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
      }
    }
    if (!range || !el.contains(range.startContainer)) return false;

    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) return false;
    const text = node.textContent;
    let s = range.startOffset;
    let en = s;
    while (s > 0 && /\S/.test(text[s - 1])) s--;
    while (en < text.length && /\S/.test(text[en])) en++;
    if (s === en) return false;

    const wordRange = document.createRange();
    wordRange.setStart(node, s);
    wordRange.setEnd(node, en);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(wordRange);
    return true;
  };

  const onStart = (e) => {
    setSelectable(false);
    window.getSelection?.()?.removeAllRanges();
    const p = point(e);
    start = { x: p.clientX, y: p.clientY };
    armed = true;
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      if (!armed) return;
      setSelectable(true);
      if (selectWordAt(start.x, start.y)) navigator.vibrate?.(15);
    }, delay);
  };

  const onMove = (e) => {
    if (!armed || !timer) return;
    const p = point(e);
    if (Math.hypot(p.clientX - start.x, p.clientY - start.y) > moveTolerance) {
      armed = false;
      clearTimer();
    }
  };

  const onEnd = () => {
    armed = false;
    clearTimer();
  };

  el.addEventListener("mousedown", onStart);
  el.addEventListener("touchstart", onStart, { passive: true });
  el.addEventListener("mousemove", onMove);
  el.addEventListener("touchmove", onMove, { passive: true });
  document.addEventListener("mouseup", onEnd);
  document.addEventListener("touchend", onEnd);
  document.addEventListener("touchcancel", onEnd);

  return () => {
    el.removeEventListener("mousedown", onStart);
    el.removeEventListener("touchstart", onStart);
    el.removeEventListener("mousemove", onMove);
    el.removeEventListener("touchmove", onMove);
    document.removeEventListener("mouseup", onEnd);
    document.removeEventListener("touchend", onEnd);
    document.removeEventListener("touchcancel", onEnd);
    setSelectable(false);
  };
}

// React hook wrapper — pass a ref to the scrollable/text container.
export function useLongPressSelect(ref, opts) {
  useEffect(() => attachLongPressSelect(ref.current, opts), [ref, opts?.delay, opts?.moveTolerance]);
}

// Drop-in wrapper for text blocks rendered in a list (e.g. one per row in a
// .map()) — each instance manages its own ref/effect internally, so it works
// without the caller having to juggle one ref per item. Forwards every other
// prop (className, dir, dangerouslySetInnerHTML, ...) to the rendered tag.
export function LongPressSelectable({ as: Tag = "div", delay, moveTolerance, ...props }) {
  const ref = useRef(null);
  useLongPressSelect(ref, { delay, moveTolerance });
  return <Tag ref={ref} {...props} />;
}
