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

const VirtualKeyboard = ({
  inline = false,
  autoOpenOnFocus = true,
  showToggle = true,
  panelClassName = "",
  panelPortalId = "",
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
  const targetRef = useRef(null);
  const recognitionRef = useRef(null);
  const deleteDelayRef = useRef(null);
  const deleteRepeatRef = useRef(null);
  const lastShiftTapRef = useRef(0);
  const shift = shiftMode !== "off";
  const shiftLocked = shiftMode === "locked";

  const revealFocusedTarget = useCallback((element = targetRef.current) => {
    if (!isTextTarget(element) || !element.isConnected) return;
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
      setPredictedWords(Array.isArray(event.detail.suggestions) ? event.detail.suggestions : []);
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
    if (changedTarget) setPredictedWords([]);
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
      if (!isTextTarget(targetRef.current)) return;
      targetRef.current.focus({ preventScroll: true });
      setOpen(true);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("focusin", onFocusIn);
    window.addEventListener("virtual-keyboard:toggle", onToggleRequest);
    window.addEventListener("virtual-keyboard:open", onOpenRequest);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("virtual-keyboard:toggle", onToggleRequest);
      window.removeEventListener("virtual-keyboard:open", onOpenRequest);
    };
  }, [autoOpenOnFocus, open, refreshTarget, revealFocusedTarget, stopStt]);

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

  const backspace = useCallback(() => {
    const target = focusTarget();
    if (!target) return;
    window.dispatchEvent(new CustomEvent("virtual-keyboard:before-input", { detail: { target } }));
    if (target.isContentEditable) {
      document.execCommand("delete", false);
      dispatchInput(target, { inputType: "deleteContentBackward" });
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
  }, []);

  const stopDeleteRepeat = useCallback(() => {
    if (deleteDelayRef.current) window.clearTimeout(deleteDelayRef.current);
    if (deleteRepeatRef.current) window.clearInterval(deleteRepeatRef.current);
    deleteDelayRef.current = null;
    deleteRepeatRef.current = null;
  }, []);

  const startDeleteRepeat = useCallback((event) => {
    event.preventDefault();
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
    if (detail.handled) setPredictedWords([]);
    else insertText(" ");
    consumeOneShotShift();
  }, [consumeOneShotShift, insertText, predictedWords]);
  const acceptPredictedWord = useCallback((word) => {
    const activeTarget = focusTarget();
    if (!activeTarget) return;
    const detail = { target: activeTarget, word, handled: false };
    window.dispatchEvent(new CustomEvent("virtual-keyboard:prediction", { detail }));
    if (detail.handled) setPredictedWords([]);
    consumeOneShotShift();
  }, [consumeOneShotShift]);
  const activeSttProvider = STT_PROVIDER_OPTIONS.find((option) => option.id === activeSttSettings.provider);
  const activeSttModel = activeSttProvider?.models.find((model) => model.id === activeSttSettings.model);

  const keyboardPanel = open ? (
    <div className={`vk_panel vk_panel--docked${panelPortalId ? " vk_panel--inline-slot" : ""}${panelClassName ? ` ${panelClassName}` : ""}`} role="dialog" aria-label="Virtual keyboard">
      <div className="vk_panel_header">
        <span>Keyboard</span>
        {corpusReady && <span className="vk_corpus_status" title="Corpus ready — prediction text is available" aria-label="Corpus ready"><span /></span>}
        <span className="vk_stt_provider" title="Speech-to-text provider used by the Keyboard">
          <b>STT</b>
          <span>{activeSttProvider?.label || activeSttSettings.provider}</span>
          <small>{activeSttModel?.label || activeSttSettings.model}</small>
        </span>
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
        <button type="button" onPointerDown={(event) => event.preventDefault()} onClick={() => { stopStt(); setOpen(false); }} aria-label="Hide keyboard"><i className="bx bx-x" /></button>
      </div>
      {!target && <p className="vk_no_target">Focus a text field to start typing with the keyboard.</p>}
      {predictedWords.length > 0 && (
        <div className="vk_prediction_rail" aria-label="Predicted words">
          <span>Predictions</span>
          <div>
            {predictedWords.map((word) => (
              <button
                type="button"
                key={word}
                onPointerDown={(event) => {
                  event.preventDefault();
                  acceptPredictedWord(word);
                }}
                onClick={(event) => {
                  // Pointer activation is committed above before Safari can
                  // blur the field. Keep click for keyboard/screen-reader use.
                  if (event.detail === 0) acceptPredictedWord(word);
                }}
              >
                {word}
              </button>
            ))}
          </div>
        </div>
      )}
      {ROWS.map((row, rowIndex) => (
        <div className="vk_row" key={rowIndex}>
          {row.map((key) => <button type="button" key={key} onPointerDown={(event) => event.preventDefault()} onClick={() => { insertText(shift ? key.toUpperCase() : key); consumeOneShotShift(); }}>{shift ? key.toUpperCase() : key}</button>)}
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
          onClick={sttStatus === "processing" ? undefined : sttStatus !== "idle" ? stopStt : startStt}
        >
          {["starting", "listening", "processing"].includes(sttStatus) && (
            <span className={`vk_stt_loader vk_stt_loader--${sttStatus}`} aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          )}
          <i className={`fi ${sttStatus !== "idle" ? "fi-rr-square" : "fi-rr-microphone"}`} />
          <span aria-live="polite">{sttStatus === "processing" ? "Processing…" : sttStatus === "starting" ? "Starting…" : sttStatus === "listening" ? "Listening…" : sttStatus === "waiting" ? "Idle" : "STT"}</span>
        </button>
        <button
          type="button"
          className={shift ? `vk_key--active${shiftLocked ? " vk_key--locked" : ""}` : undefined}
          aria-pressed={shift}
          title={shiftLocked ? "Shift Lock on" : shift ? "Shift for next key" : "Shift; double-tap to lock"}
          onPointerDown={(event) => event.preventDefault()}
          onClick={pressShift}
        ><i className={shiftLocked ? "bx bxs-up-arrow-alt" : "bx bx-up-arrow-alt"} /> Shift</button>
        <button
          type="button"
          onPointerDown={(event) => {
            event.preventDefault();
            pressSpace();
          }}
          onClick={(event) => {
            if (event.detail === 0) pressSpace();
          }}
          className="vk_space"
        >Space</button>
        <button type="button" onPointerDown={(event) => event.preventDefault()} onClick={pressEnter}><i className="bx bx-enter" /> Enter</button>
        <button
          type="button"
          aria-label="Delete; hold to delete continuously"
          title="Delete; hold to delete continuously"
          onPointerDown={startDeleteRepeat}
          onPointerUp={stopDeleteRepeat}
          onPointerCancel={stopDeleteRepeat}
          onLostPointerCapture={stopDeleteRepeat}
        >
          <i className="bx bx-delete" /> Delete
        </button>
      </div>
    </div>
  ) : null;

  const panelPortalTarget = panelPortalId && typeof document !== "undefined"
    ? document.getElementById(panelPortalId)
    : null;

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
    </>
  );
};

export default VirtualKeyboard;
