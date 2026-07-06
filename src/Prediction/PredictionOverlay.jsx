import React, { useCallback, useEffect, useRef, useState } from "react";
import { suggestPredictions } from "../utils/predictionApi";
import { getCaretCoordinates } from "./caretCoordinates";
import "./predictionOverlay.css";

const TARGET_SELECTOR = "input:not([type]), input[type='text'], input[type='search'], textarea";
const WORD_RE = /[\p{L}\p{N}'-]+$/u;

const isPredictable = (el) =>
  el instanceof HTMLElement &&
  el.matches?.(TARGET_SELECTOR) &&
  !el.disabled &&
  !el.readOnly &&
  el.dataset.noPredict === undefined;

const setNativeValue = (el, value) => {
  const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
};

const currentWordPrefix = (value, caret) => {
  const match = value.slice(0, caret).match(WORD_RE);
  return match ? match[0] : "";
};

// One instance mounted at the app root (see AppRouter.js) — listens for
// focus on any plain text input/textarea anywhere in the app and offers
// word completions drawn from whichever pools are enabled in Settings.
// Fully global by event delegation, so no individual page/component needs
// to opt in.
const PredictionOverlay = () => {
  const [suggestions, setSuggestions] = useState([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [box, setBox] = useState(null); // { top, left, height }
  const targetRef = useRef(null);
  const prefixRef = useRef("");
  const debounceRef = useRef(null);
  const requestIdRef = useRef(0);

  const dismiss = useCallback(() => {
    setSuggestions([]);
    setBox(null);
    prefixRef.current = "";
  }, []);

  const runSuggest = useCallback((el) => {
    const caret = el.selectionStart ?? el.value.length;
    const prefix = currentWordPrefix(el.value, caret);
    prefixRef.current = prefix;

    if (prefix.length < 2) { dismiss(); return; }

    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const myRequestId = ++requestIdRef.current;
      const results = await suggestPredictions(prefix);
      if (myRequestId !== requestIdRef.current || targetRef.current !== el) return;
      if (!results.length) { dismiss(); return; }
      const coords = getCaretCoordinates(el, caret);
      const rect = el.getBoundingClientRect();
      setBox({
        top: rect.top - el.scrollTop + coords.top + coords.height + 4,
        left: rect.left - el.scrollLeft + coords.left,
      });
      setSuggestions(results);
      setActiveIndex(0);
    }, 150);
  }, [dismiss]);

  const acceptSuggestion = useCallback((word) => {
    const el = targetRef.current;
    if (!el) return;
    const caret = el.selectionStart ?? el.value.length;
    const prefix = prefixRef.current;
    const start = caret - prefix.length;
    const nextValue = el.value.slice(0, start) + word + " " + el.value.slice(caret);
    setNativeValue(el, nextValue);
    const nextCaret = start + word.length + 1;
    el.setSelectionRange(nextCaret, nextCaret);
    dismiss();
  }, [dismiss]);

  useEffect(() => {
    const onFocusIn = (e) => {
      targetRef.current = isPredictable(e.target) ? e.target : null;
      if (!targetRef.current) dismiss();
    };
    const onFocusOut = (e) => {
      if (e.target === targetRef.current) {
        targetRef.current = null;
        // Let a click on the suggestion list register before it disappears.
        setTimeout(dismiss, 120);
      }
    };
    const onInput = (e) => {
      if (e.target === targetRef.current) runSuggest(e.target);
    };
    const onKeyDown = (e) => {
      if (e.target !== targetRef.current || suggestions.length === 0) return;
      if (e.key === "Tab" || (e.key === "ArrowRight" && e.target.selectionStart === e.target.value.length)) {
        e.preventDefault();
        acceptSuggestion(suggestions[activeIndex]);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % suggestions.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
      } else if (e.key === "Escape") {
        dismiss();
      }
    };
    const onScrollOrResize = () => dismiss();

    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("input", onInput);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("input", onInput);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
      clearTimeout(debounceRef.current);
    };
  }, [runSuggest, acceptSuggestion, dismiss, suggestions, activeIndex]);

  if (!box || suggestions.length === 0) return null;

  return (
    <div id="predict_overlay" style={{ top: box.top, left: box.left }}>
      {suggestions.map((word, i) => (
        <button
          type="button"
          key={word}
          className={`predict_chip${i === activeIndex ? " predict_chip--active" : ""}`}
          onMouseDown={(e) => { e.preventDefault(); acceptSuggestion(word); }}
        >
          {word}
        </button>
      ))}
    </div>
  );
};

export default PredictionOverlay;
