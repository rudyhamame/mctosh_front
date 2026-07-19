import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./infoPopupButton.css";

const InfoIcon = () => (
  <svg className="pdf_toolbar_svg_icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="2 2 20 20" aria-hidden="true">
    <path d="M11 11h2v6h-2zm0-4h2v2h-2z" />
    <path d="M16.71 2.29A1 1 0 0 0 16 2H8c-.27 0-.52.11-.71.29l-5 5A1 1 0 0 0 2 8v8c0 .27.11.52.29.71l5 5c.19.19.44.29.71.29h8c.27 0 .52-.11.71-.29l5-5A1 1 0 0 0 22 16V8c0-.27-.11-.52-.29-.71zM20 15.58l-4.41 4.41H8.42l-4.41-4.41V8.41L8.42 4h7.17L20 8.41z" />
  </svg>
);

// Shared by the PDF Reader's annotation toolbar (LabeledPercentKnob,
// AnnotControlHeaderInfo) and the AMCTOSHS Entities Builder panel. The
// popup is portalled straight to document.body (position: fixed,
// positioned from the trigger's own getBoundingClientRect()) instead of
// rendering inline as position:absolute — several real DOM parents this
// button lives inside (.annot_tool_options, the entity builder's scrolling
// body) have overflow-x/y:auto/hidden, and an absolutely-positioned popup
// nested inside gets silently clipped the instant it extends past the
// container's own bounds. Escaping the DOM subtree entirely is the only
// fix that works regardless of dock edge or scroll position.
export const InfoPopupButton = ({ info, label }) => {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const popupRef = useRef(null);

  const toggleOpen = () => {
    setOpen((wasOpen) => {
      if (wasOpen) return false;
      const rect = btnRef.current?.getBoundingClientRect();
      if (rect) setPos({ top: rect.bottom + 6, left: rect.left });
      return true;
    });
  };

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e) => {
      if (btnRef.current?.contains(e.target) || popupRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    // The popup's own fixed position is a one-time snapshot taken on open,
    // not live-tracked — closing on any scroll/resize (capture phase, so it
    // catches scrolling inside a scrollable ancestor too, not just the
    // window) avoids it drifting away from its trigger instead.
    const onScrollOrResize = () => setOpen(false);
    document.addEventListener("mousedown", onDocDown);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open]);

  if (!info) return null;

  return (
    <>
      <button
        type="button"
        ref={btnRef}
        className="annot_control_info_btn"
        onClick={toggleOpen}
        title={info}
        aria-label={label}
      >
        <InfoIcon />
      </button>
      {open && pos && createPortal(
        <div
          ref={popupRef}
          className="annot_control_info_popup"
          style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 500 }}
        >
          {info}
        </div>,
        document.body,
      )}
    </>
  );
};

export default InfoPopupButton;
