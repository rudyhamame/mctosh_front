import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import "./splitView.css";

const MIN_PANE_RATIO = 0.15; // neither pane can be dragged smaller than 15% of the width

// Only static, param-free routes make sense as a generic "open this in the
// other pane" target — /card/:card, /draft/:id etc. need an id the picker
// has no way to supply, so they're left out (a user can still navigate to
// them *from inside* the opened pane, same as any normal page).
const SPLIT_VIEW_PAGES = [
  { path: "/home",                   icon: "fi-rr-home",               label: "Home" },
  { path: "/hylomorphism/youtube_source", icon: "fi-rr-play-alt",      label: "YouTube Source" },
  { path: "/hylomorphism/pdf_source",     icon: "fi-rr-file-pdf",      label: "PDF Source" },
  { path: "/sources",                icon: "fi-rr-books",               label: "AMCTOSHS Hyle" },
  { path: "/clinical-schemata",      icon: "fi-rr-network",             label: "MCTOSH Entities" },
  { path: "/patient-instantiation",  icon: "fi-rr-hospital-user",       label: "Patient Instantiation" },
  { path: "/hylomorphism",           icon: "fi-rr-diagram-project",     label: "Hylomorphism" },
  { path: "/pdf-reader",             icon: "fi-rr-file-pdf",            label: "PDF Reader" },
  { path: "/units-extraction",       icon: "fi-rr-book-open-reader",    label: "AMCTOSHS Units Extraction while Studying" },
  { path: "/linguistic-analysis",    icon: "fi-rr-language",            label: "Clinical Linguistic Analysis" },
  { path: "/mcc/mccqe/objectives",   icon: "fi-rr-document-signed",     label: "MCCQE Objectives" },
  { path: "/draft",                  icon: "fi-rr-notebook",            label: "AMCTOSHS Draft" },
  { path: "/ai",                     icon: "fi-rr-comment-alt",         label: "AI Chat" },
  { path: "/social-media-control",   icon: "fi-rr-megaphone",           label: "AMCTOSHS Social Media Control" },
  { path: "/instagram-home-preview", icon: "fi-rr-mobile-notch",        label: "Instagram Home Preview" },
  { path: "/social-media-designer",  icon: "fi-rr-palette",             label: "Social Media Designer" },
  { path: "/youtube",                icon: "fi-rr-video-camera-alt",    label: "YouTube" },
  { path: "/human-atlas",            icon: "fi-rr-body",                label: "Human Atlas" },
  { path: "/freeform",               icon: "fi-rr-note-sticky",         label: "Freeform" },
  { path: "/phenomena",              icon: "fi-rr-list-check",          label: "Phenomena" },
  { path: "/settings",               icon: "fi-rr-settings",            label: "Settings" },
  { path: "/patient/login",          icon: "fi-rr-sign-in-alt",         label: "Patient Login" },
  { path: "/patient/signup",         icon: "fi-rr-user-add",            label: "Patient Signup" },
  { path: "/patient/call",           icon: "fi-rr-phone-call",          label: "Patient Call" },
  { path: "/patient/settings",       icon: "fi-rr-user-gear",           label: "Patient Settings" },
  { path: "/portfolio",              icon: "fi-rr-user",                label: "Portfolio" },
  { path: "/about",                  icon: "fi-rr-info",                label: "About" },
];

const SplitViewContext = createContext(null);

export const SplitViewProvider = ({ children }) => {
  const [splitPath, setSplitPath] = useState(null);
  const [splitRatio, setSplitRatio] = useState(0.5); // primary pane's share of the width, 0..1
  return (
    <SplitViewContext.Provider value={{ splitPath, setSplitPath, splitRatio, setSplitRatio }}>
      {children}
    </SplitViewContext.Provider>
  );
};

// The secondary pane is a real <iframe> onto this same app (same origin, so
// it shares the login session via localStorage) rather than trying to mount
// a second copy of an arbitrary page component in the same React tree —
// most pages here assume they're the only instance mounted (hardcoded DOM
// ids, canvas/WebRTC/singleton effects), so mounting two at once would
// fight over those. An iframe is a fully independent, fully live page with
// none of that risk, at the cost of a second app boot.
export const SplitViewFrame = ({ children }) => {
  const ctx = useContext(SplitViewContext);
  const frameRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  // Dragging over a live <iframe> normally swallows mousemove the instant the
  // cursor crosses into it (the events fire on the iframe's own document,
  // not this one) — freezing the resize the moment you drag past the
  // divider. `dragging` renders a transparent overlay on top of both panes
  // for the duration of the drag so this document keeps receiving the move
  // events regardless of which pane the cursor is over.
  const handleDividerDragStart = useCallback((e) => {
    e.preventDefault();
    const frame = frameRef.current;
    if (!frame) return;
    setDragging(true);

    const onMove = (ev) => {
      const clientX = ev.touches ? ev.touches[0].clientX : ev.clientX;
      const rect = frame.getBoundingClientRect();
      const ratio = (clientX - rect.left) / rect.width;
      ctx.setSplitRatio(Math.min(1 - MIN_PANE_RATIO, Math.max(MIN_PANE_RATIO, ratio)));
    };
    const onEnd = () => {
      setDragging(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onEnd);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onEnd);
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
  }, [ctx]);

  if (!ctx?.splitPath) return children;

  const page = SPLIT_VIEW_PAGES.find((p) => p.path === ctx.splitPath);
  const iframeSrc = `${window.location.origin}${import.meta.env.BASE_URL}${ctx.splitPath.replace(/^\//, "")}`;
  const ratio = ctx.splitRatio ?? 0.5;

  return (
    <div id="split_view_frame" ref={frameRef}>
      <div id="split_view_pane_primary" style={{ flexBasis: `${ratio * 100}%` }}>{children}</div>
      <div
        id="split_view_divider"
        onMouseDown={handleDividerDragStart}
        onTouchStart={handleDividerDragStart}
        title="Drag to resize"
      />
      <div id="split_view_pane_secondary" style={{ flexBasis: `${(1 - ratio) * 100}%` }}>
        <div id="split_view_pane_header">
          <span>{page?.label || ctx.splitPath}</span>
          <button type="button" onClick={() => ctx.setSplitPath(null)} title="Close split view">
            <i className="fi fi-rr-cross-small" />
          </button>
        </div>
        <iframe id="split_view_iframe" title={page?.label || "Split view"} src={iframeSrc} />
      </div>
      {dragging && <div id="split_view_drag_overlay" />}
    </div>
  );
};

// Hidden inside an already-secondary pane (window.self !== window.top) so a
// split view can't be opened recursively inside itself — the picker button
// only ever appears on a top-level tab/window.
export const SplitViewButton = () => {
  const ctx = useContext(SplitViewContext);
  const [pickerOpen, setPickerOpen] = useState(false);

  if (!ctx || (typeof window !== "undefined" && window.self !== window.top)) return null;

  return (
    <div id="split_view_btn_wrap">
      <button
        type="button"
        id="split_view_btn"
        className={ctx.splitPath ? "split_view_btn--active" : ""}
        onClick={() => setPickerOpen((o) => !o)}
        title="Split screen"
      >
        <i className="fi fi-rr-columns-3" />
      </button>
      {pickerOpen && (
        <div id="split_view_picker">
          {ctx.splitPath && (
            <button
              type="button"
              className="split_view_picker_item split_view_picker_item--close"
              onClick={() => { ctx.setSplitPath(null); setPickerOpen(false); }}
            >
              <i className="fi fi-rr-cross-small" /> Close split view
            </button>
          )}
          {SPLIT_VIEW_PAGES.map((p) => (
            <button
              key={p.path}
              type="button"
              className={`split_view_picker_item${ctx.splitPath === p.path ? " split_view_picker_item--active" : ""}`}
              onClick={() => { ctx.setSplitPath(p.path); setPickerOpen(false); }}
            >
              <i className={`fi ${p.icon}`} /> {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
