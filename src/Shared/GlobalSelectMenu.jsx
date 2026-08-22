import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const GlobalSelectMenu = () => {
  const [active, setActive] = useState(null);

  useEffect(() => {
    const open = (event) => {
      const select = event.target.closest?.("select");
      if (!select || select.disabled || !select.options.length) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = select.getBoundingClientRect();
      setActive({ select, rect, options: Array.from(select.options).map((option) => ({ value: option.value, label: option.textContent, disabled: option.disabled })) });
    };
    const close = (event) => {
      if (!event.target.closest?.(".global_select_menu")) setActive(null);
    };
    const escape = (event) => { if (event.key === "Escape") setActive(null); };
    document.addEventListener("pointerdown", open, true);
    document.addEventListener("click", close, true);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", open, true);
      document.removeEventListener("click", close, true);
      document.removeEventListener("keydown", escape);
    };
  }, []);

  if (!active) return null;
  const { select, rect, options } = active;
  const menuHeight = Math.min(320, Math.max(48, options.length * 38 + 10));
  const below = rect.bottom + menuHeight <= window.innerHeight - 8;
  const style = { top: below ? rect.bottom + 4 : Math.max(8, rect.top - menuHeight - 4), left: Math.min(Math.max(8, rect.left), window.innerWidth - Math.max(180, rect.width) - 8), minWidth: Math.max(180, rect.width) };
  const choose = (option) => {
    if (option.disabled) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    setter?.call(select, option.value);
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    setActive(null);
  };
  return createPortal(
    <div className="global_select_menu" role="listbox" style={style} onPointerDown={(event) => event.stopPropagation()}>
      {options.map((option, index) => <button type="button" role="option" key={`${option.value}-${index}`} aria-selected={select.value === option.value} disabled={option.disabled} className={select.value === option.value ? "is-selected" : ""} onClick={() => choose(option)}>{option.label || "—"}</button>)}
    </div>,
    document.body,
  );
};

export default GlobalSelectMenu;
