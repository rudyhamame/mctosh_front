import { useCallback, useEffect, useRef, useState } from "react";
import { suggestMedicalPredictions, suggestPredictions } from "../utils/predictionApi";
import { suggestCorpusCorrections } from "../Shared/corpusSttResolver";
import { getCaretCoordinates } from "./caretCoordinates";
import "./predictionOverlay.css";

const TARGET_SELECTOR = [
  "input:not([type])",
  "input[type='text']",
  "input[type='search']",
  "input[type='email']",
  "input[type='url']",
  "input[type='tel']",
  "textarea",
  "[contenteditable='true']",
  "[contenteditable='plaintext-only']",
].join(", ");
const WORD_RE = /[\p{L}\p{N}'-]+$/u;

const predictableTarget = (element) => {
  if (!(element instanceof HTMLElement)) return null;
  const target = element.matches?.(TARGET_SELECTOR)
    ? element
    : element.closest?.("[contenteditable='true'], [contenteditable='plaintext-only']");
  if (!target?.matches?.(TARGET_SELECTOR) || target.disabled || target.readOnly || target.dataset.noPredict !== undefined) return null;
  return target;
};

const isPredictable = (element) => Boolean(predictableTarget(element));

const targetText = (target) => target.isContentEditable
  ? String(target.textContent || "")
  : String(target.value || "");

const contentEditablePointAt = (target, requestedOffset) => {
  const offset = Math.max(0, Math.min(targetText(target).length, requestedOffset));
  const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
  let remaining = offset;
  let node = walker.nextNode();
  let lastNode = null;
  while (node) {
    lastNode = node;
    if (remaining <= node.data.length) return { node, offset: remaining };
    remaining -= node.data.length;
    node = walker.nextNode();
  }
  if (lastNode) return { node: lastNode, offset: lastNode.data.length };
  return { node: target, offset: 0 };
};

const targetSelection = (target) => {
  if (!target.isContentEditable) {
    const start = target.selectionStart ?? target.value.length;
    return { start, end: target.selectionEnd ?? start };
  }
  const selection = window.getSelection();
  if (!selection?.rangeCount || !target.contains(selection.anchorNode) || !target.contains(selection.focusNode)) {
    const end = targetText(target).length;
    return { start: end, end };
  }
  const range = selection.getRangeAt(0);
  const beforeStart = document.createRange();
  beforeStart.selectNodeContents(target);
  beforeStart.setEnd(range.startContainer, range.startOffset);
  const beforeEnd = document.createRange();
  beforeEnd.selectNodeContents(target);
  beforeEnd.setEnd(range.endContainer, range.endOffset);
  return { start: beforeStart.toString().length, end: beforeEnd.toString().length };
};

const setNativeValue = (el, value) => {
  const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
};

const dispatchTargetInput = (target, text) => {
  try {
    target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  } catch {
    target.dispatchEvent(new Event("input", { bubbles: true }));
  }
};

const currentWordPrefix = (value, caret) => {
  const match = value.slice(0, caret).match(WORD_RE);
  return match ? match[0] : "";
};

const publishSuggestions = (target, prefix = "", suggestions = [], medicalSuggestions = []) => {
  window.dispatchEvent(new CustomEvent("amctoshs:prediction-suggestions", {
    detail: {
      target,
      prefix,
      suggestions,
      generalSuggestions: suggestions,
      medicalSuggestions,
    },
  }));
};

// App-level inline completion. The suggested suffix exists only in this
// visual overlay; it is never written into the editor value until Space
// explicitly commits it.
const PredictionOverlay = () => {
  const [suffixHighlight, setSuffixHighlight] = useState(null);
  const targetRef = useRef(null);
  const completionRef = useRef(null);
  const correctionSelectionRef = useRef(null);
  const debounceRef = useRef(null);
  const requestIdRef = useRef(0);
  const applyingRef = useRef(false);

  useEffect(() => {
    const findGuardedEditable = (target) => {
      const editable = target?.closest?.("input, textarea, [contenteditable='true'], [contenteditable='plaintext-only']");
      return editable && editable.dataset.browserCallout !== "allow" ? editable : null;
    };
    const suppressEditableContextMenu = (event) => {
      if (!findGuardedEditable(event.target)) return;
      event.preventDefault();
    };
    const suppressEditableSelection = (event) => {
      if (!findGuardedEditable(event.target)) return;
      event.preventDefault();
    };
    document.addEventListener("contextmenu", suppressEditableContextMenu, true);
    document.addEventListener("selectstart", suppressEditableSelection, true);
    return () => {
      document.removeEventListener("contextmenu", suppressEditableContextMenu, true);
      document.removeEventListener("selectstart", suppressEditableSelection, true);
    };
  }, []);

  // App-owned word selection for ordinary text fields. The native range is
  // still used for replacement/keyboard input, but the visible selection is
  // painted by this layer so Safari cannot mount its own selection callout.
  useEffect(() => {
    const isField = (target) => {
      const field = target?.closest?.("input, textarea");
      if (!field || field.dataset.browserCallout === "allow" || field.dataset.noAppSelection !== undefined) return null;
      if (field.tagName === "INPUT" && ["button", "checkbox", "color", "date", "file", "hidden", "radio", "range", "reset", "submit", "time"].includes(field.type)) return null;
      return field;
    };
    let overlay = null;
    let activeField = null;
    let handleCleanup = null;
    let lastFieldPress = null;
    let suppressDoubleClickUntil = 0;
    let logicalStart = 0;
    let logicalEnd = 0;

    const publishLogicalSelection = (field, start, end) => {
      if (!field) return;
      if (end > start) {
        field.dataset.appSelectionStart = String(start);
        field.dataset.appSelectionEnd = String(end);
      } else {
        delete field.dataset.appSelectionStart;
        delete field.dataset.appSelectionEnd;
      }
      window.dispatchEvent(new CustomEvent("amctoshs:editable-selection", {
        detail: {
          target: field,
          text: end > start ? field.value.slice(start, end) : "",
          start,
          end,
          persistent: end > start,
        },
      }));
    };
    const clearOverlay = () => {
      const previousField = activeField;
      handleCleanup?.();
      handleCleanup = null;
      overlay?.remove();
      overlay = null;
      activeField = null;
      logicalStart = 0;
      logicalEnd = 0;
      if (previousField) publishLogicalSelection(previousField, 0, 0);
    };
    const caretAtPoint = (field, clientX) => {
      const styles = window.getComputedStyle(field);
      const canvas = caretAtPoint.canvas || (caretAtPoint.canvas = document.createElement("canvas"));
      const context = canvas.getContext("2d");
      if (!context) return field.selectionStart ?? field.value.length;
      context.font = styles.font;
      const rect = field.getBoundingClientRect();
      const x = Math.max(0, clientX - rect.left - (Number.parseFloat(styles.paddingLeft) || 0) + field.scrollLeft);
      let low = 0;
      let high = field.value.length;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (context.measureText(field.value.slice(0, middle + 1)).width < x) low = middle + 1;
        else high = middle;
      }
      const before = context.measureText(field.value.slice(0, low)).width;
      const after = context.measureText(field.value.slice(0, low + 1)).width;
      return x <= before + (after - before) / 2 ? low : Math.min(low + 1, field.value.length);
    };
    const drawOverlay = (field) => {
      if (!overlay || !field || activeField !== field) return;
      const start = logicalStart;
      const end = logicalEnd;
      if (end <= start) return clearOverlay();
      const startPoint = getCaretCoordinates(field, start);
      const endPoint = getCaretCoordinates(field, end);
      const rect = field.getBoundingClientRect();
      Object.assign(overlay.style, {
        left: `${rect.left + startPoint.left - field.scrollLeft}px`,
        top: `${rect.top + startPoint.top - field.scrollTop}px`,
        width: `${Math.max(2, endPoint.left - startPoint.left)}px`,
        height: `${Math.max(1, startPoint.height)}px`,
      });
    };
    const selectWord = (event, requestedField = null) => {
      const field = requestedField || isField(event.target);
      if (!field || !field.value) return;
      event.preventDefault();
      event.stopPropagation();
      const position = caretAtPoint(field, event.clientX);
      const isWord = (character) => /[\p{L}\p{N}'_-]/u.test(character || "");
      let start = Math.min(position, field.value.length - 1);
      if (!isWord(field.value[start]) && start > 0 && isWord(field.value[start - 1])) start -= 1;
      if (!isWord(field.value[start])) return;
      let end = start + 1;
      while (start > 0 && isWord(field.value[start - 1])) start -= 1;
      while (end < field.value.length && isWord(field.value[end])) end += 1;
      field.focus({ preventScroll: true });
      activeField = field;
      logicalStart = start;
      logicalEnd = end;
      // Keep Safari's real selection collapsed. The app paints and owns the
      // selected range, so WebKit has no native selection to attach its
      // Copy/Paste/Look Up menu to.
      field.setSelectionRange(end, end, "none");
      publishLogicalSelection(field, start, end);
      overlay?.remove();
      overlay = document.createElement("span");
      overlay.className = "app_selection_overlay";
      ["start", "end"].forEach((edge) => {
        const handle = document.createElement("i");
        handle.className = `app_selection_handle app_selection_handle--${edge}`;
        handle.setAttribute("aria-label", `Move selection ${edge}`);
        handle.addEventListener("pointerdown", (pointerEvent) => {
          pointerEvent.preventDefault();
          pointerEvent.stopPropagation();
          handleCleanup?.();
          const pointerId = pointerEvent.pointerId;
          const move = (moveEvent) => {
            if (moveEvent.pointerId !== pointerId || !activeField) return;
            moveEvent.preventDefault();
            const position = caretAtPoint(activeField, moveEvent.clientX);
            const currentStart = logicalStart;
            const currentEnd = logicalEnd;
            const nextStart = edge === "start" ? Math.min(position, currentEnd - 1) : currentStart;
            const nextEnd = edge === "end" ? Math.max(currentStart + 1, position) : currentEnd;
            activeField.focus({ preventScroll: true });
            logicalStart = nextStart;
            logicalEnd = nextEnd;
            activeField.setSelectionRange(edge === "start" ? nextStart : nextEnd, edge === "start" ? nextStart : nextEnd, "none");
            publishLogicalSelection(activeField, nextStart, nextEnd);
            drawOverlay(activeField);
          };
          const stop = (endEvent) => {
            if (endEvent.pointerId !== pointerId) return;
            handleCleanup?.();
            handleCleanup = null;
          };
          handleCleanup = () => {
            document.removeEventListener("pointermove", move);
            document.removeEventListener("pointerup", stop);
            document.removeEventListener("pointercancel", stop);
          };
          document.addEventListener("pointermove", move, { passive: false });
          document.addEventListener("pointerup", stop);
          document.addEventListener("pointercancel", stop);
        }, { passive: false });
        overlay.appendChild(handle);
      });
      document.body.appendChild(overlay);
      drawOverlay(field);
    };
    const onPointerDown = (event) => {
      const field = isField(event.target);
      if (!field || event.button > 0) return;
      const now = performance.now();
      const previous = lastFieldPress;
      const elapsed = previous ? now - previous.time : Number.POSITIVE_INFINITY;
      const distance = previous
        ? Math.hypot(event.clientX - previous.x, event.clientY - previous.y)
        : Number.POSITIVE_INFINITY;
      const isSecondPress = previous?.field === field && elapsed >= 25 && elapsed <= 500 && distance <= 28;

      if (isSecondPress) {
        // Safari begins its native edit-menu gesture on the second press, well
        // before `dblclick`/`contextmenu`. Claim that press in capture phase and
        // create the app-owned selection immediately.
        event.preventDefault();
        event.stopPropagation();
        suppressDoubleClickUntil = now + 900;
        lastFieldPress = null;
        selectWord(event, field);
        return;
      }

      if (activeField === field) clearOverlay();
      lastFieldPress = {
        field,
        time: now,
        x: event.clientX,
        y: event.clientY,
      };
    };
    const onDoubleClick = (event) => {
      const field = isField(event.target);
      if (!field) return;
      event.preventDefault();
      event.stopPropagation();
      // Mouse browsers may still emit dblclick after the second pointer-down.
      // Do not rebuild the same selection, but always consume the native event.
      if (performance.now() < suppressDoubleClickUntil) return;
      selectWord(event, field);
    };
    const clearOnInput = (event) => {
      if (isField(event.target)) clearOverlay();
    };
    const updateSelection = () => {
      if (activeField && document.activeElement === activeField) drawOverlay(activeField);
    };
    const prepareSelectionForInput = (target) => {
      if (target !== activeField || logicalEnd <= logicalStart) return false;
      // Expand the native range only at the instant an edit is committed. It
      // is never exposed during the selecting gesture, so Safari cannot mount
      // its edit menu, while normal typing still replaces the app selection.
      target.setSelectionRange(logicalStart, logicalEnd, "forward");
      clearOverlay();
      return true;
    };
    const onBeforeInput = (event) => {
      const field = isField(event.target);
      if (field) prepareSelectionForInput(field);
    };
    const onVirtualKeyboardBeforeInput = (event) => {
      const field = isField(event.detail?.target);
      if (field) prepareSelectionForInput(field);
    };
    document.addEventListener("pointerdown", onPointerDown, { capture: true, passive: false });
    document.addEventListener("dblclick", onDoubleClick, true);
    document.addEventListener("beforeinput", onBeforeInput, true);
    document.addEventListener("input", clearOnInput, true);
    document.addEventListener("selectionchange", updateSelection);
    window.addEventListener("virtual-keyboard:before-input", onVirtualKeyboardBeforeInput);
    window.addEventListener("resize", updateSelection);
    window.addEventListener("scroll", updateSelection, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("dblclick", onDoubleClick, true);
      document.removeEventListener("beforeinput", onBeforeInput, true);
      document.removeEventListener("input", clearOnInput, true);
      document.removeEventListener("selectionchange", updateSelection);
      window.removeEventListener("virtual-keyboard:before-input", onVirtualKeyboardBeforeInput);
      window.removeEventListener("resize", updateSelection);
      window.removeEventListener("scroll", updateSelection, true);
      clearOverlay();
    };
  }, []);

  const writeTargetRange = useCallback((el, start, end, insertedText, selectionStart, selectionEnd = selectionStart) => {
    applyingRef.current = true;
    if (el.isContentEditable) {
      const range = document.createRange();
      const startPoint = contentEditablePointAt(el, start);
      const endPoint = contentEditablePointAt(el, end);
      range.setStart(startPoint.node, startPoint.offset);
      range.setEnd(endPoint.node, endPoint.offset);
      range.deleteContents();
      const insertedNode = document.createTextNode(insertedText);
      range.insertNode(insertedNode);
      const relativeStart = Math.max(0, Math.min(insertedText.length, selectionStart - start));
      const relativeEnd = Math.max(relativeStart, Math.min(insertedText.length, selectionEnd - start));
      const selection = window.getSelection();
      const selectedRange = document.createRange();
      selectedRange.setStart(insertedNode, relativeStart);
      selectedRange.setEnd(insertedNode, relativeEnd);
      selection?.removeAllRanges();
      selection?.addRange(selectedRange);
      dispatchTargetInput(el, insertedText);
    } else {
      const currentValue = String(el.value || "");
      setNativeValue(el, `${currentValue.slice(0, start)}${insertedText}${currentValue.slice(end)}`);
      el.setSelectionRange(
        selectionStart,
        selectionEnd,
        selectionEnd > selectionStart ? "forward" : "none",
      );
    }
    applyingRef.current = false;
  }, []);

  const positionSuffixHighlight = useCallback((el, caret, suffix) => {
    const text = String(suffix || "");
    if (!el?.isConnected || !text) {
      setSuffixHighlight(null);
      return;
    }
    const computed = window.getComputedStyle(el);
    const typography = {
      fontFamily: computed.fontFamily,
      fontSize: computed.fontSize,
      fontStyle: computed.fontStyle,
      fontWeight: computed.fontWeight,
      letterSpacing: computed.letterSpacing,
      lineHeight: computed.lineHeight,
      textTransform: computed.textTransform,
    };
    if (el.isContentEditable) {
      const range = document.createRange();
      const point = contentEditablePointAt(el, caret);
      range.setStart(point.node, point.offset);
      range.collapse(true);
      const rect = range.getClientRects()[0] || range.getBoundingClientRect() || el.getBoundingClientRect();
      setSuffixHighlight({
        top: rect.top,
        left: rect.left,
        minHeight: Math.max(1, rect.height || Number.parseFloat(computed.lineHeight) || 16),
        text,
        ...typography,
      });
      return;
    }
    const point = getCaretCoordinates(el, caret);
    const rect = el.getBoundingClientRect();
    setSuffixHighlight({
      top: rect.top - el.scrollTop + point.top,
      left: rect.left - el.scrollLeft + point.left,
      minHeight: Math.max(1, point.height),
      text,
      ...typography,
    });
  }, []);

  const dismiss = useCallback(() => {
    requestIdRef.current += 1;
    clearTimeout(debounceRef.current);
    const completion = completionRef.current;
    completionRef.current = null;
    completion?.el?.classList.remove("prediction_inline_active");
    setSuffixHighlight(null);
    publishSuggestions(completion?.el || targetRef.current, "", []);

  }, []);

  const runSuggest = useCallback((el) => {
    const value = targetText(el);
    const selection = targetSelection(el);
    const caret = selection.start;
    if (selection.end !== caret) return;
    const prefix = currentWordPrefix(value, caret);

    if (prefix.length < 2) {
      dismiss();
      return;
    }

    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const requestId = ++requestIdRef.current;
      const medicalRequest = suggestMedicalPredictions(prefix, 12);
      const results = await suggestPredictions(prefix, 12);
      if (requestId !== requestIdRef.current || targetRef.current !== el || !el.isConnected) return;

      const currentValue = targetText(el);
      const currentSelection = targetSelection(el);
      const currentCaret = currentSelection.start;
      const currentPrefix = currentWordPrefix(currentValue, currentCaret);
      if (currentSelection.end !== currentCaret || currentPrefix.toLocaleLowerCase() !== prefix.toLocaleLowerCase()) return;

      const word = results.find((candidate) =>
        candidate.length > prefix.length &&
        candidate.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase()));
      if (!word) {
        completionRef.current = null;
        el.classList.remove("prediction_inline_active");
        setSuffixHighlight(null);
      } else {
        const start = currentCaret - prefix.length;
        const suffix = word.slice(prefix.length);
        completionRef.current = { el, start, caret: currentCaret, prefix, word, suggestions: results };
        el.classList.add("prediction_inline_active");
        requestAnimationFrame(() => positionSuffixHighlight(el, currentCaret, suffix));
      }
      // Corpus is local and should render immediately. UMLS fills its own rail
      // independently so a large terminology file never delays autocomplete.
      publishSuggestions(el, prefix, results, []);

      const medicalResults = await medicalRequest;
      if (requestId !== requestIdRef.current || targetRef.current !== el || !el.isConnected) return;
      const latestSelection = targetSelection(el);
      const latestPrefix = currentWordPrefix(targetText(el), latestSelection.start);
      if (latestSelection.end !== latestSelection.start || latestPrefix.toLocaleLowerCase() !== prefix.toLocaleLowerCase()) return;
      publishSuggestions(el, prefix, results, medicalResults);
    }, 150);
  }, [dismiss, positionSuffixHighlight]);

  const acceptCompletion = useCallback((requestedWord = "") => {
    const completion = completionRef.current;
    if (!completion?.el?.isConnected) return false;
    const { el, start, caret, word } = completion;
    if (targetText(el).slice(start, caret) !== completion.prefix) {
      return false;
    }

    const requested = String(requestedWord || "").trim();
    const prefix = completion.prefix || "";
    const acceptedWord = requested
      && requested.length > prefix.length
      && requested.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())
      ? requested
      : word;

    completionRef.current = null;
    el.classList.remove("prediction_inline_active");
    setSuffixHighlight(null);
    publishSuggestions(el, "", []);
    requestIdRef.current += 1;
    clearTimeout(debounceRef.current);
    const insertedText = `${acceptedWord} `;
    writeTargetRange(el, start, caret, insertedText, start + insertedText.length);
    return true;
  }, [writeTargetRange]);

  const acceptTargetPrediction = useCallback((target, requestedWord = "") => {
    if (!target?.isConnected) return false;
    if (completionRef.current?.el === target && acceptCompletion(requestedWord)) return true;

    // Controlled React fields can rerender between prediction and Space,
    // invalidating the exact completion snapshot. Recover from the field's
    // selected suffix and the keyboard rail's current first suggestion.
    const value = targetText(target);
    const selection = targetSelection(target);
    const prefix = currentWordPrefix(value, selection.start);
    const selectedSuffix = selection.end > selection.start
      ? value.slice(selection.start, selection.end)
      : "";
    const requested = String(requestedWord || "").trim();
    const inferred = target.classList.contains("prediction_inline_active") && selectedSuffix
      ? `${prefix}${selectedSuffix}`
      : "";
    const word = requested || inferred;
    if (!prefix || !word || !word.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())) return false;

    const start = selection.start - prefix.length;
    const end = selection.end;
    const insertedText = `${word} `;
    completionRef.current = null;
    target.classList.remove("prediction_inline_active");
    setSuffixHighlight(null);
    publishSuggestions(target, "", []);
    requestIdRef.current += 1;
    clearTimeout(debounceRef.current);
    writeTargetRange(target, start, end, insertedText, start + insertedText.length);
    return true;
  }, [acceptCompletion, writeTargetRange]);

  const replaceTargetWordWithPrediction = useCallback((target, requestedWord) => {
    const word = String(requestedWord || "").trim();
    if (!target?.isConnected || !word) return false;

    const value = targetText(target);
    const completion = completionRef.current?.el === target
      ? completionRef.current
      : null;
    const correctionSelection = correctionSelectionRef.current?.target === target
      ? correctionSelectionRef.current
      : null;
    const selection = targetSelection(target);
    let start;
    let end;

    if (completion) {
      // The suffix is visual-only, so replace only the actually typed token.
      start = Math.max(0, Math.min(value.length, completion.start));
      end = Math.max(start, Math.min(value.length, completion.caret));
    } else if (correctionSelection) {
      start = Math.max(0, Math.min(value.length, correctionSelection.start));
      end = Math.max(start, Math.min(value.length, correctionSelection.end));
    } else {
      // No inline snapshot is required: replace the complete token around the
      // caret/selection with the exact rail item the user chose.
      start = Math.max(0, Math.min(value.length, selection.start));
      end = Math.max(start, Math.min(value.length, selection.end));
      while (start > 0 && /[\p{L}\p{N}'-]/u.test(value[start - 1])) start -= 1;
      while (end < value.length && /[\p{L}\p{N}'-]/u.test(value[end])) end += 1;
    }

    const insertedText = `${word} `;
    completionRef.current = null;
    correctionSelectionRef.current = null;
    target.classList.remove("prediction_inline_active");
    setSuffixHighlight(null);
    publishSuggestions(target, "", []);
    requestIdRef.current += 1;
    clearTimeout(debounceRef.current);
    writeTargetRange(target, start, end, insertedText, start + insertedText.length);
    return true;
  }, [writeTargetRange]);

  useEffect(() => {
    const activeElement = document.activeElement;
    const activeTarget = predictableTarget(activeElement);
    if (activeTarget) {
      targetRef.current = activeTarget;
      const selection = targetSelection(activeTarget);
      if (targetText(activeTarget) && selection.start === selection.end) runSuggest(activeTarget);
    }
  }, [runSuggest]);

  useEffect(() => {
    const onFocusIn = (event) => {
      // Keyboard controls are an extension of the active editor. Moving DOM
      // focus into them must not dismiss the editor's pending completion.
      if (event.target?.closest?.(".vk_panel, .vk_toggle")) return;
      const target = predictableTarget(event.target);
      if (!target) {
        dismiss();
        targetRef.current = null;
        return;
      }
      if (correctionSelectionRef.current?.target !== target) correctionSelectionRef.current = null;
      targetRef.current = target;
      const selection = targetSelection(target);
      if (targetText(target) && selection.start === selection.end) runSuggest(target);
    };

    const onFocusOut = (event) => {
      if (event.target !== targetRef.current) return;
      const blurredTarget = event.target;
      // Safari may report no relatedTarget during a touch-generated click.
      // Resolve focus on the next frame so keyboard controls can accept the
      // completion before an actual outside focus change dismisses it.
      window.requestAnimationFrame(() => {
        if (targetRef.current !== blurredTarget) return;
        const activeElement = document.activeElement;
        if (activeElement === blurredTarget || activeElement?.closest?.(".vk_panel, .vk_toggle")) return;
        if (correctionSelectionRef.current?.target === blurredTarget) {
          correctionSelectionRef.current = null;
          publishSuggestions(blurredTarget, "", []);
        }
        dismiss();
        targetRef.current = null;
      });
    };

    const onInput = (event) => {
      const target = predictableTarget(event.target);
      if (applyingRef.current || !target) return;
      if (correctionSelectionRef.current?.target === target) correctionSelectionRef.current = null;
      target.classList.remove("prediction_inline_active");
      completionRef.current = null;
      publishSuggestions(target, "", []);
      targetRef.current = target;
      runSuggest(target);
    };

    const onBeforeInput = (event) => {
      const target = predictableTarget(event.target);
      if (applyingRef.current || completionRef.current?.el !== target) return;
      // iPad/Safari may deliver Space as beforeinput without a usable
      // keydown. Accept the inline completion before the browser inserts the
      // space, so it cannot leave the prediction in the field unchanged.
      if (event.inputType === "insertText" && event.data === " ") {
        event.preventDefault();
        acceptCompletion();
        return;
      }
      dismiss();
    };

    const onKeyDown = (event) => {
      const target = predictableTarget(event.target);
      if (!target || completionRef.current?.el !== target) return;
      if (event.key === " " || event.key === "Spacebar") {
        event.preventDefault();
        acceptCompletion();
      } else if (event.key === "Escape") {
        event.preventDefault();
        dismiss();
      } else if (["Tab", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
        // Navigation dismisses the visual suffix and then proceeds normally.
        dismiss();
      }
    };

    const onVirtualKeyboardSpace = (event) => {
      const target = predictableTarget(event.detail?.target);
      if (!target) return;
      if (targetRef.current !== target) targetRef.current = target;
      event.detail.handled = acceptTargetPrediction(target, event.detail?.word);
    };

    const onVirtualKeyboardPrediction = (event) => {
      const target = predictableTarget(event.detail?.target);
      const word = String(event.detail?.word || "");
      if (!target || !word) return;
      if (targetRef.current !== target) targetRef.current = target;
      event.detail.handled = replaceTargetWordWithPrediction(target, word);
    };

    const onVirtualKeyboardBeforeInput = (event) => {
      if (event.detail?.target !== targetRef.current || completionRef.current?.el !== targetRef.current) return;
      dismiss();
    };

    const onVirtualKeyboardInput = (event) => {
      const target = predictableTarget(event.detail?.target);
      if (!target || event.detail?.inputType !== "deleteContentBackward") return;
      targetRef.current = target;
      runSuggest(target);
    };

    const onSelectionChange = () => {
      const target = predictableTarget(document.activeElement);
      if (!target) return;
      const selection = targetSelection(target);
      const completion = completionRef.current?.el === target ? completionRef.current : null;
      if (completion) {
        const caretAtTypedEnd = selection.start === completion.caret && selection.end === completion.caret;
        if (caretAtTypedEnd) return;
        dismiss();
        return;
      }
      if (selection.end <= selection.start) {
        if (correctionSelectionRef.current?.target === target && correctionSelectionRef.current.persistent) return;
        correctionSelectionRef.current = null;
        publishSuggestions(target, "", []);
        return;
      }
      const selectedText = targetText(target).slice(selection.start, selection.end).trim();
      const suggestions = suggestCorpusCorrections(selectedText, 12);
      correctionSelectionRef.current = {
        target,
        text: selectedText,
        start: selection.start,
        end: selection.end,
        persistent: false,
      };
      targetRef.current = target;
      publishSuggestions(target, selectedText, suggestions);
    };

    const onAppEditableSelection = (event) => {
      const target = predictableTarget(event.detail?.target);
      const selectedText = String(event.detail?.text || "").trim();
      if (!target) return;
      if (!selectedText) {
        if (correctionSelectionRef.current?.target === target) {
          correctionSelectionRef.current = null;
          publishSuggestions(target, "", []);
        }
        return;
      }
      if (completionRef.current?.el === target) {
        completionRef.current = null;
        target.classList.remove("prediction_inline_active");
        setSuffixHighlight(null);
      }
      const value = targetText(target);
      const start = Math.max(0, Math.min(value.length, Number(event.detail?.start) || 0));
      const end = Math.max(start, Math.min(value.length, Number(event.detail?.end) || start + selectedText.length));
      correctionSelectionRef.current = {
        target,
        text: selectedText,
        start,
        end,
        persistent: Boolean(event.detail?.persistent),
      };
      targetRef.current = target;
      publishSuggestions(target, selectedText, suggestCorpusCorrections(selectedText, 12));
    };

    const repositionHighlight = () => {
      const completion = completionRef.current;
      if (!completion) return;
      positionSuffixHighlight(completion.el, completion.caret, completion.word.slice(completion.prefix.length));
    };

    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("input", onInput);
    document.addEventListener("beforeinput", onBeforeInput, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("select", onSelectionChange, true);
    window.addEventListener("virtual-keyboard:space", onVirtualKeyboardSpace);
    window.addEventListener("virtual-keyboard:prediction", onVirtualKeyboardPrediction);
    window.addEventListener("virtual-keyboard:before-input", onVirtualKeyboardBeforeInput);
    window.addEventListener("virtual-keyboard:input", onVirtualKeyboardInput);
    window.addEventListener("amctoshs:editable-selection", onAppEditableSelection);
    window.addEventListener("scroll", repositionHighlight, true);
    window.addEventListener("resize", repositionHighlight);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("input", onInput);
      document.removeEventListener("beforeinput", onBeforeInput, true);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("select", onSelectionChange, true);
      window.removeEventListener("virtual-keyboard:space", onVirtualKeyboardSpace);
      window.removeEventListener("virtual-keyboard:prediction", onVirtualKeyboardPrediction);
      window.removeEventListener("virtual-keyboard:before-input", onVirtualKeyboardBeforeInput);
      window.removeEventListener("virtual-keyboard:input", onVirtualKeyboardInput);
      window.removeEventListener("amctoshs:editable-selection", onAppEditableSelection);
      window.removeEventListener("scroll", repositionHighlight, true);
      window.removeEventListener("resize", repositionHighlight);
      completionRef.current?.el?.classList.remove("prediction_inline_active");
      clearTimeout(debounceRef.current);
    };
  }, [acceptCompletion, acceptTargetPrediction, dismiss, positionSuffixHighlight, replaceTargetWordWithPrediction, runSuggest]);

  if (!suffixHighlight) return null;
  const { text, ...suffixStyle } = suffixHighlight;
  return <span className="prediction_suffix_highlight" style={suffixStyle} aria-hidden="true">{text}</span>;
};

export default PredictionOverlay;
