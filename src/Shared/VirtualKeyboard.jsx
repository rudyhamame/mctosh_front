import React, { useCallback, useEffect, useRef, useState } from "react";
import "./virtualKeyboard.css";

const isTextTarget = (element) => {
  if (!element || element.dataset?.virtualKeyboard === "false") return false;
  if (element.isContentEditable) return true;
  if (element.tagName === "TEXTAREA") return true;
  if (element.tagName !== "INPUT") return false;
  return !["button", "checkbox", "color", "date", "file", "hidden", "radio", "range", "reset", "submit", "time"].includes(element.type);
};

const ROWS = [
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  ["z", "x", "c", "v", "b", "n", "m", ",", ".", "?"] ,
];

const dispatchInput = (target, init = {}) => {
  try {
    target.dispatchEvent(new InputEvent("input", { bubbles: true, ...init }));
  } catch {
    target.dispatchEvent(new Event("input", { bubbles: true }));
  }
};

const replaceInputSelection = (target, text) => {
  const start = target.selectionStart ?? target.value.length;
  const end = target.selectionEnd ?? start;
  const nextValue = `${target.value.slice(0, start)}${text}${target.value.slice(end)}`;
  const prototype = target.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (setter) setter.call(target, nextValue);
  else target.value = nextValue;
  const caret = start + text.length;
  target.setSelectionRange(caret, caret);
  dispatchInput(target, { inputType: "insertText", data: text });
};

const VirtualKeyboard = () => {
  const [open, setOpen] = useState(false);
  const [shift, setShift] = useState(false);
  const [targetLabel, setTargetLabel] = useState("");
  const targetRef = useRef(null);

  const refreshTarget = useCallback((element) => {
    if (!isTextTarget(element)) {
      targetRef.current = null;
      setOpen(false);
      setTargetLabel("");
      return;
    }
    targetRef.current = element;
    if (element.tagName === "INPUT" || element.tagName === "TEXTAREA") {
      element.inputMode = "none";
    }
    setTargetLabel(element.getAttribute("aria-label") || element.getAttribute("placeholder") || element.id || "Text field");
  }, []);

  useEffect(() => {
    const onFocusIn = (event) => refreshTarget(event.target);
    const onFocusOut = (event) => {
      window.setTimeout(() => {
        const activeElement = document.activeElement;
        // A delayed blur from the previous field must not clear a newer field.
        if (isTextTarget(activeElement)) {
          refreshTarget(activeElement);
          return;
        }
        if (activeElement !== event.target && !activeElement?.closest?.(".vk_panel, .vk_toggle, .pdf_freeform_notebook_keyboard")) {
          targetRef.current = null;
          setOpen(false);
        }
      }, 0);
    };
    const onToggleRequest = () => {
      if (!isTextTarget(targetRef.current)) return;
      targetRef.current.focus({ preventScroll: true });
      setOpen((value) => !value);
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    window.addEventListener("virtual-keyboard:toggle", onToggleRequest);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      window.removeEventListener("virtual-keyboard:toggle", onToggleRequest);
    };
  }, [refreshTarget]);

  const focusTarget = () => {
    const target = targetRef.current;
    if (!target) return null;
    target.focus({ preventScroll: true });
    return target;
  };

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
    if (target.isContentEditable) {
      document.execCommand("delete", false);
      dispatchInput(target, { inputType: "deleteContentBackward" });
      return;
    }
    const start = target.selectionStart ?? 0;
    const end = target.selectionEnd ?? start;
    if (start === 0 && end === 0) return;
    const from = start === end ? start - 1 : start;
    const nextValue = `${target.value.slice(0, from)}${target.value.slice(end)}`;
    const prototype = target.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (setter) setter.call(target, nextValue);
    else target.value = nextValue;
    target.setSelectionRange(from, from);
    dispatchInput(target, { inputType: "deleteContentBackward" });
  }, []);

  const pressEnter = useCallback(() => insertText("\n"), [insertText]);

  if (!targetRef.current) return null;
  return (
    <>
      <button
        type="button"
        className="vk_toggle"
        aria-label={open ? "Hide virtual keyboard" : "Show virtual keyboard"}
        title={`${open ? "Hide" : "Show"} virtual keyboard${targetLabel ? ` for ${targetLabel}` : ""}`}
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => { focusTarget(); setOpen((value) => !value); }}
      >
        <i className="fi fi-rr-keyboard" aria-hidden="true" />
      </button>
      {open && (
        <div className="vk_panel" role="dialog" aria-label="Virtual keyboard">
          <div className="vk_panel_header">
            <span>Keyboard</span>
            <button type="button" onPointerDown={(event) => event.preventDefault()} onClick={() => setOpen(false)} aria-label="Hide keyboard"><i className="bx bx-x" /></button>
          </div>
          {ROWS.map((row, rowIndex) => (
            <div className="vk_row" key={rowIndex}>
              {row.map((key) => <button type="button" key={key} onPointerDown={(event) => event.preventDefault()} onClick={() => insertText(shift ? key.toUpperCase() : key)}>{shift ? key.toUpperCase() : key}</button>)}
            </div>
          ))}
          <div className="vk_row vk_row--actions">
            <button type="button" className={shift ? "vk_key--active" : undefined} onPointerDown={(event) => event.preventDefault()} onClick={() => setShift((value) => !value)}><i className="bx bx-up-arrow-alt" /> Shift</button>
            <button type="button" onPointerDown={(event) => event.preventDefault()} onClick={() => insertText(" ")} className="vk_space">Space</button>
            <button type="button" onPointerDown={(event) => event.preventDefault()} onClick={pressEnter}><i className="bx bx-enter" /> Enter</button>
            <button type="button" onPointerDown={(event) => event.preventDefault()} onClick={backspace}><i className="bx bx-delete" /> Delete</button>
          </div>
        </div>
      )}
    </>
  );
};

export default VirtualKeyboard;
