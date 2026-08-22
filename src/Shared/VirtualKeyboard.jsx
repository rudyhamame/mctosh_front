import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { STT_PROVIDER_OPTIONS, STT_PROVIDERS } from "../Avatar/local3d/sttProviderSettings";
import { getConfiguredStt, startConfiguredStt } from "./configuredStt";
import { createCorpusSttResolver } from "./corpusSttResolver";
import "./virtualKeyboard.css";

const isTextTarget = (element) => {
  if (!element || element.dataset?.virtualKeyboard === "false") return false;
  if (element.isContentEditable) return true;
  if (element.tagName === "TEXTAREA") return true;
  if (element.tagName !== "INPUT") return false;
  return !["button", "checkbox", "color", "date", "file", "hidden", "radio", "range", "reset", "submit", "time"].includes(element.type);
};

const ROWS = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  ["z", "x", "c", "v", "b", "n", "m", ",", ".", "?"] ,
];

const getTokenBeforeCaret = (element) => {
  if (!element) return "";
  if (element.isContentEditable) {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return "";
    const range = selection.getRangeAt(0).cloneRange();
    range.selectNodeContents(element);
    range.setEnd(selection.anchorNode, selection.anchorOffset);
    return String(range.toString()).match(/[\p{L}\p{N}'-]+$/u)?.[0] || "";
  }
  const value = String(element.value || "");
  const caret = element.selectionStart ?? value.length;
  return value.slice(0, caret).match(/[\p{L}\p{N}'-]+$/u)?.[0] || "";
};

const dispatchInput = (target, init = {}) => {
  try {
    target.dispatchEvent(new InputEvent("input", { bubbles: true, ...init }));
  } catch {
    target.dispatchEvent(new Event("input", { bubbles: true }));
  }
};

const setInputValue = (target, value) => {
  const prototype = target.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (setter) setter.call(target, value);
  else target.value = value;
};

const replaceInputSelection = (target, text) => {
  window.dispatchEvent(new CustomEvent("virtual-keyboard:before-input", { detail: { target } }));
  const start = target.selectionStart ?? target.value.length;
  const end = target.selectionEnd ?? start;
  const nextValue = `${target.value.slice(0, start)}${text}${target.value.slice(end)}`;
  setInputValue(target, nextValue);
  const caret = start + text.length;
  target.setSelectionRange(caret, caret);
  dispatchInput(target, { inputType: "insertText", data: text });
};

const editableForSelection = (selection) => {
  const node = selection?.anchorNode;
  const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  return element?.closest?.("[contenteditable='true'], [contenteditable='plaintext-only']") || null;
};

const selectionBelongsTo = (selection, target) => {
  if (!selection?.rangeCount || !target?.isContentEditable || selection.isCollapsed) return false;
  const range = selection.getRangeAt(0);
  return target.contains(range.commonAncestorContainer);
};

const appTextSelection = (target) => {
  if (!target || target.isContentEditable) return null;
  const start = Number.parseInt(target.dataset?.appSelectionStart, 10);
  const end = Number.parseInt(target.dataset?.appSelectionEnd, 10);
  if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) return null;
  return { start, end };
};

const VirtualKeyboard = ({
  inline = false,
  autoOpenOnFocus = true,
  showToggle = true,
  panelClassName = "",
  panelPortalId = "",
  predictionPortalId = "",
  openOnCommand = false,
  onLoginAutofill = null,
}) => {
  const [open, setOpen] = useState(false);
  const [shiftMode, setShiftMode] = useState("off");
  const [targetLabel, setTargetLabel] = useState("");
  const [target, setTarget] = useState(null);
  const [sttStatus, setSttStatus] = useState("idle");
  const [sttPreview, setSttPreview] = useState("");
  const [sttResultSource, setSttResultSource] = useState("");
  const [sttError, setSttError] = useState("");
  const [activeSttSettings, setActiveSttSettings] = useState(() => getConfiguredStt());
  const [corpusReady, setCorpusReady] = useState(() => localStorage.getItem("mctosh_corpus_status") === "ready");
  const [predictedWords, setPredictedWords] = useState([]);
  const [medicalPredictedWords, setMedicalPredictedWords] = useState([]);
  const [boldSuccess, setBoldSuccess] = useState(false);
  const [floatMode, setFloatMode] = useState(() => localStorage.getItem("mctosh_keyboard_float_mode") === "true");
  const [floatingPosition, setFloatingPosition] = useState(null);
  const targetRef = useRef(null);
  const panelRef = useRef(null);
  const floatDragRef = useRef(null);
  const recognitionRef = useRef(null);
  const deleteDelayRef = useRef(null);
  const deleteRepeatRef = useRef(null);
  const boldDelayRef = useRef(null);
  const boldLongPressRef = useRef(false);
  const boldSelectionRef = useRef(null);
  const lastShiftTapRef = useRef(0);
  const predictionDragRef = useRef(null);
  const predictionClickRef = useRef(null);
  const shift = shiftMode !== "off";
  const shiftLocked = shiftMode === "locked";

  const toggleFloatMode = useCallback(() => {
    setFloatMode((current) => {
      const next = !current;
      localStorage.setItem("mctosh_keyboard_float_mode", String(next));
      if (!next) setFloatingPosition(null);
      return next;
    });
  }, []);

  const startFloatDrag = useCallback((event) => {
    if (!floatMode || event.button !== 0 || event.target.closest("button")) return;
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    floatDragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }, [floatMode]);

  const moveFloatDrag = useCallback((event) => {
    const drag = floatDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const viewportWidth = window.visualViewport?.width || window.innerWidth;
    const viewportHeight = window.visualViewport?.height || window.innerHeight;
    setFloatingPosition({
      left: Math.min(Math.max(8, event.clientX - drag.offsetX), Math.max(8, viewportWidth - drag.width - 8)),
      top: Math.min(Math.max(8, event.clientY - drag.offsetY), Math.max(8, viewportHeight - drag.height - 8)),
    });
  }, []);

  const finishFloatDrag = useCallback((event) => {
    const drag = floatDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    floatDragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }, []);

  const revealFocusedTarget = useCallback((element = targetRef.current) => {
    if (!isTextTarget(element) || !element.isConnected) return;
    // The PDF Notebook owns its own scroll position and caret visibility.
    // Opening the app keyboard must not recenter or jump the typing page.
    if (element.classList?.contains("pdf_freeform_notebook_editor")) return;
    const routeViewport = document.getElementById("app_route_view");
    const keyboardPanel = document.querySelector(".vk_panel");
    const targetRect = element.getBoundingClientRect();
    const viewportRect = routeViewport?.contains(element)
      ? routeViewport.getBoundingClientRect()
      : { top: 0, bottom: window.visualViewport?.height || window.innerHeight };
    const keyboardRect = keyboardPanel?.getBoundingClientRect();
    const keyboardOverlapsTargetColumn = Boolean(
      keyboardRect
      && keyboardRect.left < targetRect.right
      && keyboardRect.right > targetRect.left,
    );
    const visibleTop = Math.max(0, viewportRect.top) + 14;
    const visibleBottom = Math.min(
      viewportRect.bottom,
      keyboardOverlapsTargetColumn && keyboardRect.top > viewportRect.top
        ? keyboardRect.top
        : window.visualViewport?.height || window.innerHeight,
    ) - 14;
    if (targetRect.top >= visibleTop && targetRect.bottom <= visibleBottom) return;
    element.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" });
  }, []);

  const consumeOneShotShift = useCallback(() => {
    lastShiftTapRef.current = 0;
    setShiftMode((current) => current === "locked" ? current : "off");
  }, []);

  const pressShift = useCallback(() => {
    const now = Date.now();
    setShiftMode((current) => {
      if (current === "locked") {
        lastShiftTapRef.current = 0;
        return "off";
      }
      if (current === "once") {
        const isDoubleTap = lastShiftTapRef.current > 0 && now - lastShiftTapRef.current <= 500;
        lastShiftTapRef.current = 0;
        return isDoubleTap ? "locked" : "off";
      }
      lastShiftTapRef.current = now;
      return "once";
    });
  }, []);

  useEffect(() => {
    const refreshCorpusStatus = () => {
      setCorpusReady(localStorage.getItem("mctosh_corpus_status") === "ready");
    };
    window.addEventListener("amctoshs:corpus-status", refreshCorpusStatus);
    window.addEventListener("storage", refreshCorpusStatus);
    refreshCorpusStatus();
    return () => {
      window.removeEventListener("amctoshs:corpus-status", refreshCorpusStatus);
      window.removeEventListener("storage", refreshCorpusStatus);
    };
  }, []);

  useEffect(() => {
    const onSuggestions = (event) => {
      if (event.detail?.target !== targetRef.current) return;
      setPredictedWords(Array.isArray(event.detail.generalSuggestions)
        ? event.detail.generalSuggestions
        : Array.isArray(event.detail.suggestions) ? event.detail.suggestions : []);
      setMedicalPredictedWords(Array.isArray(event.detail.medicalSuggestions) ? event.detail.medicalSuggestions : []);
    };
    window.addEventListener("amctoshs:prediction-suggestions", onSuggestions);
    return () => window.removeEventListener("amctoshs:prediction-suggestions", onSuggestions);
  }, []);

  useLayoutEffect(() => {
    if (!open || !isTextTarget(target)) return undefined;
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => revealFocusedTarget(target));
    });
    const settleTimer = window.setTimeout(() => revealFocusedTarget(target), 180);
    const onViewportResize = () => revealFocusedTarget(target);
    window.visualViewport?.addEventListener("resize", onViewportResize);
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      window.clearTimeout(settleTimer);
      window.visualViewport?.removeEventListener("resize", onViewportResize);
    };
  }, [open, revealFocusedTarget, target]);

  const refreshTarget = useCallback((element) => {
    // Keep the current target and panel alive when focus moves to a control
    // inside the keyboard (or another non-text control). The keyboard should
    // close only through its explicit toggle or close button.
    if (!isTextTarget(element)) return;
    const changedTarget = targetRef.current !== element;
    targetRef.current = element;
    setTarget(element);
    if (changedTarget) {
      setPredictedWords([]);
      setMedicalPredictedWords([]);
    }
    element.setAttribute?.("inputmode", "none");
    setTargetLabel(element.getAttribute("aria-label") || element.getAttribute("placeholder") || element.id || "Text field");
    // Focus alone should not open the floating keyboard. If it is already
    // open, changing text targets must not close it either.
  }, []);

  const stopStt = useCallback(() => {
    const session = recognitionRef.current;
    if (!session || session.stopping) return;
    session.shouldContinue = false;
    session.stopping = true;

    // MediaRecorder providers still have to upload and transcribe their final
    // audio chunk. Keep the session mounted until onEnd so that result is not
    // discarded and the keyboard can display its processing state.
    if (session.provider !== STT_PROVIDERS.BROWSER) setSttStatus("processing");
    if (session.controller?.stop) session.controller.stop();
  }, []);

  useEffect(() => () => stopStt(), [stopStt]);

  useEffect(() => {
    const session = recognitionRef.current;
    if (session && session.target !== target) stopStt();
  }, [stopStt, target]);

  useEffect(() => {
    const onFocusIn = (event) => {
      if (!isTextTarget(event.target)) return;
      // Set this again during focus as well as pointer-down. Safari and some
      // Chromium builds can decide to show the native keyboard after focus
      // has already fired, especially for dynamically mounted PDF inputs.
      event.target.setAttribute?.("inputmode", "none");
      document.body.classList.toggle(
        "pdf-textbox-focused",
        Boolean(event.target.closest?.("#pdfw_root")),
      );
      refreshTarget(event.target);
      if (autoOpenOnFocus) {
        setOpen(true);
        window.requestAnimationFrame(() => revealFocusedTarget(event.target));
      }
    };
    // Set inputMode before the browser focuses a tapped field. Doing this only
    // from focusin is too late for Safari, which may already be opening its
    // native keyboard by then.
    const onPointerDown = (event) => {
      if (!isTextTarget(event.target)) return;
      event.target.setAttribute?.("inputmode", "none");
      if (event.target.closest?.("#pdfw_root")) {
        // Do not let the browser's native input click path open its keyboard.
        // Restore focus ourselves so the shared keyboard remains the active
        // editor for PDF text fields.
        event.preventDefault();
        event.target.focus({ preventScroll: true });
        refreshTarget(event.target);
        setOpen(true);
        return;
      }
      if (document.activeElement === event.target) refreshTarget(event.target);
    };
    const onToggleRequest = () => {
      if (!isTextTarget(targetRef.current)) return;
      const nextOpen = !open;
      targetRef.current.focus({ preventScroll: true });
      if (!nextOpen) stopStt();
      setOpen(nextOpen);
    };
    const onOpenRequest = () => {
      if (!isTextTarget(targetRef.current) && !openOnCommand) return;
      targetRef.current?.focus({ preventScroll: true });
      setOpen(true);
    };
    const onCloseRequest = () => {
      document.body.classList.remove("pdf-textbox-focused");
      stopStt();
      setOpen(false);
    };
    const onFocusOut = (event) => {
      if (event.target !== targetRef.current) return;
      const nextTarget = event.relatedTarget;
      // Keep the keyboard available while the user presses one of its keys,
      // and let it follow focus when another text field is selected.
      if (nextTarget && (panelRef.current?.contains(nextTarget) || isTextTarget(nextTarget))) return;
      window.requestAnimationFrame(() => {
        if (document.activeElement === targetRef.current || panelRef.current?.contains(document.activeElement)) return;
        document.body.classList.remove("pdf-textbox-focused");
        stopStt();
        setOpen(false);
      });
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    window.addEventListener("virtual-keyboard:toggle", onToggleRequest);
    window.addEventListener("virtual-keyboard:open", onOpenRequest);
    window.addEventListener("virtual-keyboard:close", onCloseRequest);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      window.removeEventListener("virtual-keyboard:toggle", onToggleRequest);
      window.removeEventListener("virtual-keyboard:open", onOpenRequest);
      window.removeEventListener("virtual-keyboard:close", onCloseRequest);
      document.body.classList.remove("pdf-textbox-focused");
    };
  }, [autoOpenOnFocus, open, openOnCommand, refreshTarget, revealFocusedTarget, stopStt]);

  const focusTarget = () => {
    const target = targetRef.current;
    if (!target) return null;
    if (document.activeElement !== target) target.focus({ preventScroll: true });
    return target;
  };

  const startStt = useCallback(async () => {
    const activeTarget = focusTarget();
    if (!activeTarget) return;
    // Materialize an app-owned input selection only for the edit operation;
    // during ordinary selection it stays collapsed to suppress Safari's
    // native Copy/Paste callout.
    window.dispatchEvent(new CustomEvent("virtual-keyboard:before-input", { detail: { target: activeTarget } }));
    // Snapshot the current DEDUP corpus for this listening session. Every STT
    // provider passes through the same resolver before text reaches a field.
    const resolveCorpusTranscript = createCorpusSttResolver();
    stopStt();
    setSttError("");
    setSttPreview("");
    setSttResultSource("");

    let updateDictation;
    if (activeTarget.isContentEditable) {
      const selection = window.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : document.createRange();
      if (!selection?.rangeCount) {
        range.selectNodeContents(activeTarget);
        range.collapse(false);
      }
      range.deleteContents();
      const textNode = document.createTextNode("");
      range.insertNode(textNode);
      updateDictation = (transcript) => {
        textNode.data = transcript;
        const caret = document.createRange();
        caret.setStartAfter(textNode);
        caret.collapse(true);
        selection?.removeAllRanges();
        selection?.addRange(caret);
        dispatchInput(activeTarget, { inputType: "insertFromDictation", data: transcript });
      };
    } else {
      const start = activeTarget.selectionStart ?? activeTarget.value.length;
      const end = activeTarget.selectionEnd ?? start;
      const before = activeTarget.value.slice(0, start);
      const after = activeTarget.value.slice(end);
      const needsSpace = Boolean(before && !/\s$/.test(before));
      updateDictation = (transcript) => {
        const inserted = `${needsSpace && transcript ? " " : ""}${transcript}`;
        setInputValue(activeTarget, `${before}${inserted}${after}`);
        const caret = before.length + inserted.length;
        activeTarget.setSelectionRange(caret, caret);
        dispatchInput(activeTarget, { inputType: "insertFromDictation", data: inserted });
      };
    }

    const session = {
      target: activeTarget,
      shouldContinue: true,
      committedTranscript: "",
      cycleTranscript: "",
      controller: null,
      provider: null,
      stopping: false,
      speechActive: false,
      processing: false,
    };
    recognitionRef.current = session;
    setSttStatus("starting");
    try {
      const settings = getConfiguredStt();
      session.provider = settings.provider;
      setActiveSttSettings(settings);
      session.controller = await startConfiguredStt({
        continuous: true,
        language: document.documentElement.lang || navigator.language || "en-US",
        onStart: () => { if (recognitionRef.current === session) setSttStatus("waiting"); },
        onSpeechActivityChange: (active) => {
          if (recognitionRef.current !== session) return;
          session.speechActive = active;
          if (!session.stopping && !session.processing) setSttStatus(active ? "listening" : "waiting");
        },
        onProcessingChange: (processing) => {
          if (recognitionRef.current !== session) return;
          session.processing = processing;
          if (processing) setSttStatus("processing");
          else if (!session.stopping) setSttStatus(session.speechActive ? "listening" : "waiting");
        },
        onText: (transcript, { final, provider }) => {
          if (recognitionRef.current !== session) return;
          const resolvedTranscript = resolveCorpusTranscript(transcript);
          const providerOption = STT_PROVIDER_OPTIONS.find((option) => option.id === provider);
          const modelOption = providerOption?.models.find((model) => model.id === settings.model);
          const corpusAdjusted = resolvedTranscript.trim() !== String(transcript || "").trim();
          setSttResultSource([
            providerOption?.label || provider || "STT",
            modelOption?.label || settings.model,
            corpusAdjusted ? "Corpus corrected" : "Direct result",
          ].filter(Boolean).join(" · "));
          if (final) {
            session.committedTranscript = `${session.committedTranscript}${session.committedTranscript ? " " : ""}${resolvedTranscript.trim()}`;
            session.cycleTranscript = "";
          } else {
            session.cycleTranscript = resolvedTranscript.trimStart();
          }
          const separator = session.committedTranscript && session.cycleTranscript ? " " : "";
          const completeTranscript = `${session.committedTranscript}${separator}${session.cycleTranscript}`;
          updateDictation(completeTranscript);
          setSttPreview(completeTranscript);
        },
        onError: (error) => {
          if (recognitionRef.current !== session) return;
          setSttError(error.message || "Speech recognition failed.");
        },
        onEnd: () => {
          if (recognitionRef.current !== session) return;
          recognitionRef.current = null;
          setSttStatus("idle");
        },
      });
      if (recognitionRef.current !== session) session.controller.abort?.();
      else if (session.stopping) session.controller.stop?.();
    } catch (error) {
      recognitionRef.current = null;
      setSttStatus("idle");
      setSttError(error.message || "Could not start speech recognition.");
    }
  }, [stopStt]);

  const insertText = useCallback((text) => {
    const target = focusTarget();
    if (!target) return;
    if (target.isContentEditable) {
      const selection = window.getSelection();
      if (!selection?.rangeCount) return;
      const range = selection.getRangeAt(0);
      range.deleteContents();
      range.insertNode(document.createTextNode(text));
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
      dispatchInput(target, { inputType: "insertText", data: text });
      return;
    }
    replaceInputSelection(target, text);
  }, []);

  const applyBold = useCallback(() => {
    const selection = window.getSelection();
    const savedSelection = boldSelectionRef.current;
    if (savedSelection?.kind === "text") {
      const activeTarget = savedSelection.target;
      const value = String(activeTarget?.value || "");
      const start = Math.max(0, Math.min(value.length, savedSelection.start));
      const end = Math.max(start, Math.min(value.length, savedSelection.end));
      if (!activeTarget?.isConnected || end <= start) return false;
      const formatRequest = { target: activeTarget, start, end, format: "bold", handled: false };
      window.dispatchEvent(new CustomEvent("amctoshs:format-selection", { detail: formatRequest }));
      if (formatRequest.handled) {
        setBoldSuccess(true);
        window.setTimeout(() => setBoldSuccess(false), 700);
        return true;
      }
      const selectedText = value.slice(start, end);
      setInputValue(activeTarget, `${value.slice(0, start)}<strong>${selectedText}</strong>${value.slice(end)}`);
      const nextStart = start + "<strong>".length;
      const nextEnd = nextStart + selectedText.length;
      activeTarget.dataset.appSelectionStart = String(nextStart);
      activeTarget.dataset.appSelectionEnd = String(nextEnd);
      activeTarget.setSelectionRange(nextEnd, nextEnd, "none");
      dispatchInput(activeTarget, { inputType: "formatBold", data: selectedText });
      setBoldSuccess(true);
      window.setTimeout(() => setBoldSuccess(false), 700);
      return true;
    }
    if (savedSelection) {
      selection?.removeAllRanges();
      selection?.addRange(savedSelection);
    }
    const activeTarget = editableForSelection(selection) || focusTarget();
    if (!selectionBelongsTo(selection, activeTarget)) return false;
    let formatted = false;
    try {
      document.execCommand("styleWithCSS", false, true);
      formatted = document.execCommand("bold", false, null);
    } catch {
      formatted = false;
    }
    if (!formatted) {
      try {
        const range = selection.getRangeAt(0);
        const strong = document.createElement("strong");
        strong.appendChild(range.extractContents());
        range.insertNode(strong);
        selection.removeAllRanges();
        const appliedRange = document.createRange();
        appliedRange.selectNodeContents(strong);
        selection.addRange(appliedRange);
        formatted = true;
      } catch {
        return false;
      }
    }
    dispatchInput(activeTarget, { inputType: "formatBold" });
    setBoldSuccess(true);
    window.setTimeout(() => setBoldSuccess(false), 700);
    return true;
  }, []);

  const stopBoldPress = useCallback(() => {
    if (boldDelayRef.current) window.clearTimeout(boldDelayRef.current);
    boldDelayRef.current = null;
    boldSelectionRef.current = null;
  }, []);

  const startBoldPress = useCallback((event) => {
    event.preventDefault();
    stopBoldPress();
    boldLongPressRef.current = false;
    const selection = window.getSelection();
    const appSelection = appTextSelection(targetRef.current);
    boldSelectionRef.current = appSelection
      ? { kind: "text", target: targetRef.current, ...appSelection }
      : selectionBelongsTo(selection, targetRef.current)
        ? selection.getRangeAt(0).cloneRange()
        : null;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    boldDelayRef.current = window.setTimeout(() => {
      boldLongPressRef.current = true;
      applyBold();
      stopBoldPress();
    }, 450);
  }, [applyBold, stopBoldPress]);

  useEffect(() => () => stopBoldPress(), [stopBoldPress]);

  const backspace = useCallback(() => {
    const target = focusTarget();
    if (!target) return;
    window.dispatchEvent(new CustomEvent("virtual-keyboard:before-input", { detail: { target } }));
    if (target.isContentEditable) {
      document.execCommand("delete", false);
      dispatchInput(target, { inputType: "deleteContentBackward" });
      window.dispatchEvent(new CustomEvent("virtual-keyboard:input", { detail: { target, inputType: "deleteContentBackward" } }));
      return;
    }
    const start = target.selectionStart ?? 0;
    const end = target.selectionEnd ?? start;
    if (start === 0 && end === 0) return;
    const previousCharacter = start === end ? Array.from(target.value.slice(0, start)).at(-1) || "" : "";
    const from = start === end ? start - previousCharacter.length : start;
    const nextValue = `${target.value.slice(0, from)}${target.value.slice(end)}`;
    setInputValue(target, nextValue);
    target.setSelectionRange(from, from);
    dispatchInput(target, { inputType: "deleteContentBackward" });
    window.dispatchEvent(new CustomEvent("virtual-keyboard:input", { detail: { target, inputType: "deleteContentBackward" } }));
  }, []);

  const stopDeleteRepeat = useCallback(() => {
    if (deleteDelayRef.current) window.clearTimeout(deleteDelayRef.current);
    if (deleteRepeatRef.current) window.clearInterval(deleteRepeatRef.current);
    deleteDelayRef.current = null;
    deleteRepeatRef.current = null;
  }, []);

  const startDeleteRepeat = useCallback((event) => {
    event.preventDefault();
    // Keep the text field as the active editing target while deleting. This
    // prevents the keyboard from closing when the Delete button is pressed.
    focusTarget();
    stopDeleteRepeat();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    backspace();
    consumeOneShotShift();
    deleteDelayRef.current = window.setTimeout(() => {
      deleteRepeatRef.current = window.setInterval(backspace, 55);
    }, 340);
  }, [backspace, consumeOneShotShift, stopDeleteRepeat]);

  useEffect(() => () => stopDeleteRepeat(), [stopDeleteRepeat]);

  const pressEnter = useCallback(() => {
    const activeTarget = focusTarget();
    if (activeTarget?.dataset?.vkEnterAction === "search" || activeTarget?.classList?.contains("pdfw_search_input")) {
      window.dispatchEvent(new CustomEvent("virtual-keyboard:enter", { detail: { target: activeTarget } }));
      consumeOneShotShift();
      return;
    }
    insertText("\n");
    consumeOneShotShift();
  }, [consumeOneShotShift, insertText]);
  const pressSpace = useCallback(() => {
    const activeTarget = focusTarget();
    if (!activeTarget) return;
    // Pass the rail's primary candidate as a recovery value. The prediction
    // layer normally owns the inline completion, but a controlled React field
    // may rerender between the last letter and this click.
    const detail = {
      target: activeTarget,
      word: predictedWords[0] || "",
      prefix: getTokenBeforeCaret(activeTarget),
      handled: false,
    };
    window.dispatchEvent(new CustomEvent("virtual-keyboard:space", { detail }));
    if (detail.handled) {
      setPredictedWords([]);
      setMedicalPredictedWords([]);
    }
    else insertText(" ");
    consumeOneShotShift();
  }, [consumeOneShotShift, insertText, predictedWords]);
  const acceptPredictedWord = useCallback((word) => {
    const activeTarget = focusTarget();
    if (!activeTarget) return;
    const detail = { target: activeTarget, word, handled: false };
    window.dispatchEvent(new CustomEvent("virtual-keyboard:prediction", { detail }));
    if (detail.handled) {
      setPredictedWords([]);
      setMedicalPredictedWords([]);
    }
    consumeOneShotShift();
  }, [consumeOneShotShift]);
  const startPredictionGesture = useCallback((event) => {
    event.preventDefault();
    const scroller = event.currentTarget.parentElement;
    predictionDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startScrollLeft: scroller?.scrollLeft || 0,
      scroller,
      moved: false,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, []);
  const movePredictionGesture = useCallback((event) => {
    const gesture = predictionDragRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    if (Math.hypot(deltaX, deltaY) > 7) gesture.moved = true;
    if (gesture.scroller) gesture.scroller.scrollLeft = gesture.startScrollLeft - deltaX;
  }, []);
  const finishPredictionGesture = useCallback((event, word, cancelled = false) => {
    const gesture = predictionDragRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    predictionDragRef.current = null;
    predictionClickRef.current = !cancelled && !gesture.moved
      ? { word, expiresAt: performance.now() + 1000 }
      : null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }, []);
  const clickPredictedWord = useCallback((event, word) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.detail === 0) {
      acceptPredictedWord(word);
      return;
    }
    const pending = predictionClickRef.current;
    predictionClickRef.current = null;
    if (pending?.word === word && performance.now() <= pending.expiresAt) acceptPredictedWord(word);
  }, [acceptPredictedWord]);
  const activeSttProvider = STT_PROVIDER_OPTIONS.find((option) => option.id === activeSttSettings.provider);
  const activeSttModel = activeSttProvider?.models.find((model) => model.id === activeSttSettings.model);
  const sttStateLabel = sttStatus === "starting"
    ? "STARTING"
    : sttStatus === "listening"
      ? "LISTENING"
      : sttStatus === "processing"
        ? "PROCESSING"
        : sttStatus === "waiting"
          ? "WAITING"
          : sttError
            ? "ERROR"
            : "IDLE";

  const panelPortalTarget = panelPortalId && typeof document !== "undefined"
    ? document.getElementById(panelPortalId)
    : null;
  const predictionPortalTarget = predictionPortalId && typeof document !== "undefined"
    ? document.getElementById(predictionPortalId)
    : null;

  const predictionPanel = (
    <div className="vk_prediction_space" aria-label="Prediction suggestions">
      {predictedWords.length > 0 && (
        <div className="vk_prediction_rail vk_prediction_rail--general" aria-label="General Corpus predictions">
          <span>General</span>
          <div>
            {predictedWords.map((word) => (
              <button type="button" key={word} onPointerDown={startPredictionGesture} onPointerMove={movePredictionGesture} onPointerUp={(event) => finishPredictionGesture(event, word)} onPointerCancel={(event) => finishPredictionGesture(event, word, true)} onLostPointerCapture={(event) => finishPredictionGesture(event, word, true)} onClick={(event) => clickPredictedWord(event, word)}>{word}</button>
            ))}
          </div>
        </div>
      )}
      {medicalPredictedWords.length > 0 && (
        <div className="vk_prediction_rail vk_prediction_rail--medical" aria-label="Medical UMLS predictions">
          <span>Medical</span>
          <div>
            {medicalPredictedWords.map((word) => (
              <button type="button" key={word} onPointerDown={startPredictionGesture} onPointerMove={movePredictionGesture} onPointerUp={(event) => finishPredictionGesture(event, word)} onPointerCancel={(event) => finishPredictionGesture(event, word, true)} onLostPointerCapture={(event) => finishPredictionGesture(event, word, true)} onClick={(event) => clickPredictedWord(event, word)}>{word}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  const searchTargetActive = Boolean(
    target?.dataset?.vkEnterAction === "search"
    || target?.classList?.contains("pdfw_search_input")
    || targetRef.current?.dataset?.vkEnterAction === "search"
    || targetRef.current?.classList?.contains("pdfw_search_input")
    || document.activeElement?.classList?.contains("pdfw_search_input")
  );

  const keyboardPanel = open ? (
    <div
      ref={panelRef}
      className={`vk_panel ${floatMode ? "vk_panel--floating" : "vk_panel--docked"}${panelPortalId ? " vk_panel--inline-slot" : ""}${panelClassName ? ` ${panelClassName}` : ""}`}
      style={floatMode && floatingPosition ? { left: floatingPosition.left, top: floatingPosition.top, right: "auto", bottom: "auto", transform: "none" } : undefined}
      onPointerDown={(event) => {
        if (event.target.closest("button")) {
          event.preventDefault();
          focusTarget();
        }
      }}
      role="dialog"
      aria-label="Virtual keyboard"
    >
      <div
        className="vk_panel_header"
        onPointerDown={startFloatDrag}
        onPointerMove={moveFloatDrag}
        onPointerUp={finishFloatDrag}
        onPointerCancel={finishFloatDrag}
        onLostPointerCapture={finishFloatDrag}
      >
        <span className="vk_header_meta vk_header_identity"><small>INPUT /</small><strong>KEYBOARD</strong></span>
        <span className="vk_stt_provider" title="Speech-to-text provider used by the Keyboard">
          <small>MODE /</small>
          <strong>STT</strong>
          <em data-state={sttStateLabel}>{sttStateLabel}</em>
        </span>
        {corpusReady && <span className="vk_ready_state" title="Corpus ready — prediction text is available"><i /> READY</span>}
        <span className="vk_header_meta vk_header_language" title={`${activeSttProvider?.label || activeSttSettings.provider} · ${activeSttModel?.label || activeSttSettings.model}`}><small>LANG /</small><strong>EN-US</strong></span>
        {(sttPreview || sttError) && (
          <output className={sttError ? "vk_stt_feedback vk_stt_feedback--error" : "vk_stt_feedback"}>
            {sttError ? sttError : (
              <>
                {sttResultSource && <span className="vk_stt_result_source">{sttResultSource}</span>}
                <span className="vk_stt_result_text">{sttPreview}</span>
              </>
            )}
          </output>
        )}
        <div className="vk_panel_header_actions">
          <button
            type="button"
            className={floatMode ? "vk_float_toggle vk_float_toggle--active" : "vk_float_toggle"}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={toggleFloatMode}
            aria-label={floatMode ? "Dock keyboard" : "Float keyboard"}
            aria-pressed={floatMode}
            title={floatMode ? "Dock keyboard" : "Float keyboard"}
          >
            {floatMode ? (
              <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                <rect x="3" y="11" width="14" height="5" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
                <path d="M6 8h8M10 3v5m-2-2 2 2 2-2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                <rect x="3" y="4" width="14" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
                <path d="M6 8V6h2m6 2V6h-2M6 12v2h2m6-2v2h-2" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
          <button type="button" onPointerDown={(event) => event.preventDefault()} onClick={() => { stopStt(); setOpen(false); }} aria-label="Hide keyboard" title="Hide keyboard"><i className="bx bx-x" /></button>
        </div>
      </div>
      {!target && <p className="vk_no_target">Focus a text field to start typing with the keyboard.</p>}
      {!predictionPortalTarget && predictionPanel}
      {ROWS.map((row, rowIndex) => (
        <div className={`vk_row vk_row--${rowIndex + 1}`} key={rowIndex}>
          {row.map((key) => key === "b" ? (
            <button
              type="button"
              key={key}
              className={boldSuccess ? "vk_key--success" : undefined}
              aria-label="B; hold to bold selected text"
              title="B; hold to bold selected text"
              onPointerDown={startBoldPress}
              onPointerUp={stopBoldPress}
              onPointerCancel={stopBoldPress}
              onLostPointerCapture={stopBoldPress}
              onClick={() => {
                if (boldLongPressRef.current) {
                  boldLongPressRef.current = false;
                  return;
                }
                insertText(shift ? key.toUpperCase() : key);
                consumeOneShotShift();
              }}
            >{shift ? key.toUpperCase() : key}</button>
          ) : <button type="button" key={key} onPointerDown={(event) => event.preventDefault()} onClick={() => { insertText(shift ? key.toUpperCase() : key); consumeOneShotShift(); }}>{shift ? key.toUpperCase() : key}</button>)}
        </div>
      ))}
      <div className="vk_row vk_row--actions">
        <button
          type="button"
          className={sttStatus !== "idle" ? "vk_stt_key vk_key--active" : "vk_stt_key"}
          aria-label={sttStatus === "processing" ? "Transcribing recorded speech" : sttStatus !== "idle" ? "Stop speech typing" : "Start speech typing"}
          aria-pressed={sttStatus !== "idle"}
          title={sttError || (sttStatus === "processing" ? "Processing and transcribing recorded audio" : sttStatus !== "idle" ? "Stop live speech typing" : "Start live speech typing")}
          onPointerDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.preventDefault();
            focusTarget();
            if (sttStatus === "processing") return;
            if (sttStatus !== "idle") stopStt();
            else startStt();
          }}
        >
          {["starting", "listening", "processing"].includes(sttStatus) && (
            <span className={`vk_stt_loader vk_stt_loader--${sttStatus}`} aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          )}
          <span className="vk_action_symbol" aria-hidden="true">{sttStatus !== "idle" ? "■" : "⌕"}</span>
        </button>
        <button
          type="button"
          className={`vk_shift_key${shift ? ` vk_key--active${shiftLocked ? " vk_key--locked" : ""}` : ""}`}
          aria-pressed={shift}
          title={shiftLocked ? "Shift Lock on" : shift ? "Shift for next key" : "Shift; double-tap to lock"}
          onPointerDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.preventDefault();
            pressShift();
            focusTarget();
          }}
        ><span className="vk_action_symbol" aria-hidden="true">⇧</span></button>
        <button
          type="button"
          onPointerDown={(event) => {
            event.preventDefault();
            pressSpace();
          }}
          onClick={(event) => {
            event.preventDefault();
            if (event.detail === 0) pressSpace();
            focusTarget();
          }}
          className="vk_space"
        >␠</button>
        <button className="vk_enter_key" type="button" aria-label={searchTargetActive ? "Search" : "Enter"} title={searchTargetActive ? "Search" : "Enter"} onPointerDown={(event) => event.preventDefault()} onClick={pressEnter}>
          {searchTargetActive ? <i className="bx bx-search" aria-hidden="true" /> : <span className="vk_action_symbol" aria-hidden="true">↵</span>}
        </button>
        <button
          type="button"
          className="vk_delete_key"
          aria-label="Delete; hold to delete continuously"
          title="Delete; hold to delete continuously"
          onPointerDown={startDeleteRepeat}
          onClick={(event) => {
            event.preventDefault();
            focusTarget();
          }}
          onPointerUp={stopDeleteRepeat}
          onPointerCancel={stopDeleteRepeat}
          onLostPointerCapture={stopDeleteRepeat}
        >
          <span className="vk_action_symbol" aria-hidden="true">⌫</span>
        </button>
        {onLoginAutofill && (
          <button
            type="button"
            className="vk_login_autofill_key"
            aria-label="Fill login credentials and sign in"
            title="Fill saved login credentials and sign in"
            onPointerDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.preventDefault();
              onLoginAutofill();
            }}
          >
            <span className="vk_action_symbol" aria-hidden="true">↪</span>
          </button>
        )}
      </div>
    </div>
  ) : null;

  return (
    <>
      {showToggle && (
        <button
          type="button"
          className={`vk_toggle${inline ? " vk_toggle--footer" : ""}`}
          aria-label={open ? "Hide virtual keyboard" : "Show virtual keyboard"}
          title={target ? `${open ? "Hide" : "Show"} virtual keyboard${targetLabel ? ` for ${targetLabel}` : ""}` : "Focus a text field to use the virtual keyboard"}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            const nextOpen = !open;
            focusTarget();
            if (!nextOpen) stopStt();
            setOpen(nextOpen);
          }}
        >
          <i className="fi fi-rr-keyboard" aria-hidden="true" />
        </button>
      )}
      {keyboardPanel && (panelPortalTarget ? createPortal(keyboardPanel, panelPortalTarget) : keyboardPanel)}
      {open && predictionPortalTarget && createPortal(predictionPanel, predictionPortalTarget)}
    </>
  );
};

export default VirtualKeyboard;
