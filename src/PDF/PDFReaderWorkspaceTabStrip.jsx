import React, { useCallback, useEffect, useRef, useState } from "react";
import { apiUrl } from "../config/api";
import { readStoredSession } from "../utils/sessionCleanup";
import { PDF_TYPE_ICON } from "./pdfTypeIcon";
import { createReaderTab } from "./pdfReaderWorkspaceState";

const BackArrowIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="2 2 20 20" aria-hidden="true">
    <path d="M16.46 4.11a1 1 0 0 0-1.04.07l-10 7a.997.997 0 0 0 0 1.64l10 7c.17.12.37.18.57.18a.997.997 0 0 0 1-1V5c0-.37-.21-.71-.54-.89ZM15 17.08 7.74 12 15 6.92z" />
  </svg>
);

const UndoActionIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 20 20" aria-hidden="true">
    <path d="M7.1 5.2 3.8 8.5l3.3 3.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M4.2 8.5h6.05a4.75 4.75 0 1 1 0 9.5H8.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const RedoActionIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 20 20" aria-hidden="true">
    <path d="m12.9 5.2 3.3 3.3-3.3 3.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M15.8 8.5H9.75a4.75 4.75 0 1 0 0 9.5h1.55" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const HistoryActionIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 20 20" aria-hidden="true">
    <path d="M3.9 9.8a6.1 6.1 0 1 0 1.86-4.37L3.8 7.35" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M3.8 3.95v3.4h3.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M10 6.9v3.35l2.2 1.35" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const authFetch = (url, options = {}) => {
  const token = readStoredSession()?.token || "";
  return fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` },
  });
};

const useSourcePicker = () => {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sources, setSources] = useState([]);
  const [loadingSources, setLoadingSources] = useState(false);
  const pickerRef = useRef(null);

  useEffect(() => {
    if (!pickerOpen) return;
    setLoadingSources(true);
    authFetch(apiUrl("/api/sources"))
      .then((response) => response.json())
      .then((data) => setSources((data.sources || []).filter((source) => source.type !== "youtube" && source.type !== "podcast")))
      .catch(() => setSources([]))
      .finally(() => setLoadingSources(false));
  }, [pickerOpen]);

  useEffect(() => {
    if (!pickerOpen) return;
    const onDocClick = (event) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target)) setPickerOpen(false);
    };
    const attachTimer = setTimeout(() => document.addEventListener("mousedown", onDocClick), 0);
    return () => {
      clearTimeout(attachTimer);
      document.removeEventListener("mousedown", onDocClick);
    };
  }, [pickerOpen]);

  return {
    pickerOpen,
    setPickerOpen,
    sources,
    loadingSources,
    pickerRef,
  };
};

const ReaderTabs = ({ tabs, activeId, splitModeOn, checkedIds, tabTypes, annotationSaveStatus, setActiveId, onToggleCheck, onCloseTab }) => {
  const [showSaveStatus, setShowSaveStatus] = useState(false);

  useEffect(() => {
    if (!annotationSaveStatus || annotationSaveStatus === "idle") {
      setShowSaveStatus(false);
      return undefined;
    }
    setShowSaveStatus(true);
    if (!["saved", "error"].includes(annotationSaveStatus)) return undefined;
    const timer = setTimeout(() => setShowSaveStatus(false), 1400);
    return () => clearTimeout(timer);
  }, [annotationSaveStatus]);

  return (
    <div className="pdfw_tabstrip">
      {tabs.map((tab) => {
        const showingStatus = tab.id === activeId && showSaveStatus;
        return (
          <button
            type="button"
            key={tab.id}
            className={`pdfw_tab${tab.id === activeId ? " pdfw_tab--active" : ""}`}
            onClick={() => setActiveId(tab.id)}
            title={tab.name}
          >
            {splitModeOn && (
              <span
                className="pdfw_tab_check"
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleCheck(tab.id);
                }}
              >
                <i className={checkedIds.includes(tab.id) ? "bxf bx-checkbox-checked" : "bx bx-checkbox"} />
              </span>
            )}
            <span className={`pdfw_tab_label${showingStatus ? " pdfw_tab_label--save-status" : ""}`}>
              {showingStatus && annotationSaveStatus === "saving"
                ? "Saving…"
                : showingStatus && annotationSaveStatus === "saved"
                  ? "Saved"
                  : showingStatus && annotationSaveStatus === "error"
                    ? "Save failed"
                    : tab.name}
            </span>
            {tabTypes?.[tab.id] && (
              <i
                className={`${PDF_TYPE_ICON[tabTypes[tab.id]]} pdfw_tab_type`}
                title={tabTypes[tab.id]}
              />
            )}
            <span className="pdfw_tab_close" onClick={(event) => onCloseTab(event, tab.id)}>
              <i className="bx bx-x" />
            </span>
          </button>
        );
      })}
    </div>
  );
};

const ReaderSearchBar = ({ pageNav }) => {
  if (!pageNav) return null;
  return (
    <div className={`pdfw_search_group${pageNav.searchOpen ? " pdfw_search_group--open" : ""}`}>
      {!pageNav.searchOpen ? (
        <button
          type="button"
          className="pdfw_search_toggle"
          onClick={() => pageNav.setSearchOpen(true)}
          disabled={pageNav.disabled}
          title="Search in document"
          aria-label="Search in document"
        >
          <i className="bx bx-search" />
        </button>
      ) : (
        <>
          <i className="bx bx-search pdfw_search_icon" aria-hidden="true" />
          <input
            className="pdfw_search_input"
            value={pageNav.searchQuery || ""}
            onChange={(event) => pageNav.setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                pageNav.goToSearchMatch(event.shiftKey ? -1 : 1);
              } else if (event.key === "Escape") {
                pageNav.closeSearch();
              }
            }}
            placeholder="Search document"
            aria-label="Search document"
            autoFocus
          />
          <span className="pdfw_search_count">
            {pageNav.searchScanning ? "…" : pageNav.searchMatchCount ? `${pageNav.searchActiveIndex + 1} / ${pageNav.searchMatchCount}` : "—"}
          </span>
          <button type="button" className="pdfw_search_action" onClick={() => pageNav.goToSearchMatch(-1)} disabled={!pageNav.searchMatchCount} title="Previous match" aria-label="Previous match"><i className="bx bx-chevron-up" /></button>
          <button type="button" className="pdfw_search_action" onClick={() => pageNav.goToSearchMatch(1)} disabled={!pageNav.searchMatchCount} title="Next match" aria-label="Next match"><i className="bx bx-chevron-down" /></button>
          <button type="button" className="pdfw_search_action" onClick={pageNav.closeSearch} title="Close search" aria-label="Close search"><i className="bx bx-x" /></button>
        </>
      )}
    </div>
  );
};

const ReaderModeMenuItem = ({ icon, label, active = false, disabled = false, danger = false, role = "menuitemradio", onSelect }) => {
  const checkedProps = role === "menuitemradio" || role === "menuitemcheckbox"
    ? { "aria-checked": active }
    : {};
  return (
    <button
      type="button"
      role={role}
      className={`pdfw_mode_menu_item${active ? " pdfw_mode_menu_item--active" : ""}${danger ? " pdfw_mode_menu_item--danger" : ""}`}
      disabled={disabled}
      onClick={onSelect}
      {...checkedProps}
    >
      <i className={icon} aria-hidden="true" />
      <span>{label}</span>
      {active && <i className="bx bx-check pdfw_mode_menu_check" aria-hidden="true" />}
    </button>
  );
};

const ReaderModeMenuSection = ({ title, items }) => (
  <section className="pdfw_mode_menu_section" aria-label={title}>
    <span className="pdfw_mode_menu_heading">{title}</span>
    <div className="pdfw_mode_menu_items">
      {items.map((item) => <ReaderModeMenuItem key={item.id} {...item} />)}
    </div>
  </section>
);

const ReaderPageNavigation = ({ pageNav, splitModeOn, onToggleSplit }) => {
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const modeMenuRef = useRef(null);
  useEffect(() => {
    if (!modeMenuOpen) return undefined;
    const close = (event) => {
      if (!modeMenuRef.current?.contains(event.target)) setModeMenuOpen(false);
    };
    document.addEventListener("pointerdown", close, true);
    return () => document.removeEventListener("pointerdown", close, true);
  }, [modeMenuOpen]);
  if (!pageNav || pageNav.pageCount <= 0) return null;

  const selectMode = (action) => () => {
    action?.();
    setModeMenuOpen(false);
  };
  const modeSections = [
    {
      id: "pdf",
      title: "PDF",
      items: [
        { id: "pdf-single", icon: "bx bx-file", label: "One-page PDF", active: pageNav.readingMode === "single" && !pageNav.markdownOpen, onSelect: selectMode(() => pageNav.setReadingMode("single")) },
        { id: "pdf-booklet", icon: "bx bx-book-open", label: "Two-pages PDF", active: pageNav.readingMode === "booklet", onSelect: selectMode(() => pageNav.setReadingMode("booklet")) },
        { id: "pdf-split", icon: "bx bx-columns", label: splitModeOn ? "Close split view" : "Split-view documents", role: "menuitemcheckbox", active: splitModeOn, disabled: pageNav.disabled, onSelect: selectMode(onToggleSplit) },
      ],
    },
    {
      id: "plain-text",
      title: "Plain-Text Document",
      items: [
        { id: "plain-text-only", icon: "bx bx-file", label: "Document only", active: pageNav.markdownOpen && pageNav.markdownMode === "visual-only", onSelect: selectMode(() => pageNav.setMarkdownMode("md-only")) },
        { id: "plain-text-pdf", icon: "bx bx-book-open", label: "Document with PDF page", active: pageNav.markdownOpen && pageNav.markdownMode === "visual-raw", onSelect: selectMode(() => pageNav.setMarkdownMode("md-pdf")) },
        { id: "plain-text-analyser", icon: "bx bx-table", label: "Document analyser", active: pageNav.markdownOpen && pageNav.markdownMode === "raw", onSelect: selectMode(() => pageNav.setMarkdownMode("md-analyser")) },
      ],
    },
    {
      id: "notebook",
      title: "Notebook",
      items: [
        { id: "notebook-only", icon: "bx bx-notepad", label: "Notebook only", active: pageNav.notebookMode === "notebook-only", onSelect: selectMode(() => pageNav.setNotebookView("notebook-only")) },
        { id: "notebook-pdf", icon: "bx bx-book", label: "Notebook with PDF", active: pageNav.notebookMode === "notebook-pdf", onSelect: selectMode(() => pageNav.setNotebookView("notebook-pdf")) },
        { id: "notebook-md", icon: "bx bx-file", label: "Notebook with Plain-Text Document", active: pageNav.notebookMode === "notebook-md", onSelect: selectMode(() => pageNav.setNotebookView("notebook-md")) },
        { id: "notebook-pdf-md", icon: "bx bx-columns", label: "Notebook with PDF and Plain-Text Document", active: pageNav.notebookMode === "notebook-pdf-md", onSelect: selectMode(() => pageNav.setNotebookView("notebook-pdf-md")) },
        ...(pageNav.notebookOpen ? [{ id: "notebook-close", icon: "bx bx-x", label: "Close Notebook", role: "menuitem", danger: true, onSelect: selectMode(pageNav.closeNotebook) }] : []),
      ],
    },
  ];

  return (
    <div id="pdf_page_nav_row" className="pdfw_page_nav_group">
      <button
          type="button"
        className={`pdf_reader_nav_action${pageNav.outlineOpen ? " pdf_reader_nav_action--active" : ""}`}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          pageNav.toggleOutline();
        }}
        disabled={pageNav.disabled}
        title="Open outline and bookmarks"
        aria-label="Open outline and bookmarks"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M20 16.18V13c0-1.1-.9-2-2-2h-5V7.82c1.16-.41 2-1.51 2-2.82 0-1.65-1.35-3-3-3S9 3.35 9 5c0 1.3.84 2.4 2 2.82V11H6c-1.1 0-2 .9-2 2v3.18c-1.16.41-2 1.51-2 2.82 0 1.65 1.35 3 3 3s3-1.35 3-3c0-1.3-.84-2.4-2-2.82V13h5v3.18c-1.16.41-2 1.51-2 2.82 0 1.65 1.35 3 3 3s3-1.35 3-3c0-1.3-.84-2.4-2-2.82V13h5v3.18c-1.16.41-2 1.51-2 2.82 0 1.65 1.35 3 3 3s3-1.35 3-3c0-1.3-.84-2.4-2-2.82M12 4c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1M5 20c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1m7 0c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1m7 0c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1" />
        </svg>
      </button>
      <span className="pdfw_nav_separator pdfw_nav_separator--before-modes" aria-hidden="true" />
      {pageNav.pageCount > 1 && (
        <>
          <div ref={modeMenuRef} className={`pdfw_mode_menu_wrap${modeMenuOpen ? " pdfw_mode_menu_wrap--open" : ""}`}>
            <button
              type="button"
              id="pdfw_mode_toggle"
              className={modeMenuOpen ? "pdfw_mode_toggle--active" : undefined}
              aria-expanded={modeMenuOpen}
              onClick={() => {
                setModeMenuOpen((open) => !open);
              }}
              title="Choose reading mode"
            >
              MODE <i className="bx bx-chevron-down" aria-hidden="true" />
            </button>
            {modeMenuOpen && (
              <div className="pdfw_mode_menu" role="menu" aria-label="Reader modes">
                {modeSections.map((section) => <ReaderModeMenuSection key={section.id} {...section} />)}
              </div>
            )}
          </div>
        </>
      )}
      {pageNav.readingMode === "booklet" && (
        <div id="pdf_page_nav_right">
          <button onClick={() => pageNav.setBookletRightPage(Math.max(1, (pageNav.bookletRightPage || 1) - 1))} disabled={(pageNav.bookletRightPage || 1) <= 1 || pageNav.disabled} title="Previous page">‹</button>
          <span id="pdf_page_nav_right_label">{pageNav.bookletRightPage || 1} / {pageNav.pageCount}</span>
          <button onClick={() => pageNav.setBookletRightPage(Math.min(pageNav.pageCount, (pageNav.bookletRightPage || 1) + 1))} disabled={(pageNav.bookletRightPage || 1) >= pageNav.pageCount || pageNav.disabled} title="Next page">›</button>
        </div>
      )}
    </div>
  );
};

export const ReaderAnnotationActions = ({ undoRedo, pageNav }) => {
  if (!undoRedo) return null;
  const activeSurface = String(undoRedo.activeSurface || "pdf").toLowerCase();
  return (
    <div className="pdfw_toolbar_annotation_actions" aria-label="Annotation history actions">
      <span
        className={`pdf_annot_active_surface pdf_annot_active_surface--${activeSurface}`}
        aria-label={`Active annotation surface: ${activeSurface.toUpperCase()}`}
        aria-live="polite"
      >
        {activeSurface.toUpperCase()}
      </span>
      <button className="annot_action_btn" onClick={undoRedo.undo} title="Undo last annotation step" disabled={!undoRedo.canUndo}><UndoActionIcon /></button>
      {undoRedo.hasHistory && (
        <button
          className={`annot_action_btn${undoRedo.historyOpen ? " annot_action_btn--active" : ""}`}
          onClick={undoRedo.toggleHistory}
          title="Annotation timeline"
        >
          <HistoryActionIcon />
        </button>
      )}
      <button className="annot_action_btn" onClick={undoRedo.redo} title="Redo last undone step" disabled={!undoRedo.canRedo}><RedoActionIcon /></button>
    </div>
  );
};

const ReaderOverflowMenu = ({ undoRedo, pageNav, splitModeOn, onToggleSplit }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (!ref.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", close, true);
    return () => document.removeEventListener("pointerdown", close, true);
  }, [open]);

  const run = (action) => {
    action?.();
    setOpen(false);
  };

  return (
    <div className="pdfw_overflow_wrap" ref={ref}>
      <button type="button" className="pdfw_overflow_button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label="More reader actions" title="More reader actions">
        <i className="bx bx-dots-horizontal-rounded" />
      </button>
      {open && (
        <div className="pdfw_overflow_menu" role="menu" aria-label="More reader actions">
          <button type="button" role="menuitem" onClick={() => run(pageNav?.toggleOutline)} disabled={!pageNav}><i className="bx bx-list-ul" /> Contents and bookmarks</button>
          <button type="button" role="menuitem" onClick={() => run(pageNav?.toggleBookmark)} disabled={!pageNav}><i className="bx bx-bookmark" /> Toggle bookmark</button>
          <button type="button" role="menuitem" onClick={() => run(undoRedo?.undo)} disabled={!undoRedo?.canUndo}><i className="bx bx-undo" /> Undo</button>
          <button type="button" role="menuitem" onClick={() => run(undoRedo?.redo)} disabled={!undoRedo?.canRedo}><i className="bx bx-redo" /> Redo</button>
          <button type="button" role="menuitem" onClick={() => run(undoRedo?.toggleHistory)} disabled={!undoRedo?.hasHistory}><i className="bx bx-history" /> Annotation history</button>
          <button type="button" role="menuitem" onClick={() => run(onToggleSplit)} disabled={!pageNav || pageNav.pageCount < 2}><i className="bx bx-columns" /> {splitModeOn ? "Close split view" : "Split view"}</button>
        </div>
      )}
    </div>
  );
};

const ReaderZoomControls = ({ zoomControls }) => {
  const holdRef = useRef({ timer: null, interval: null, suppressClick: false });

  const stopZoomHold = useCallback(() => {
    const state = holdRef.current;
    if (state.timer) window.clearTimeout(state.timer);
    if (state.interval) window.clearInterval(state.interval);
    state.timer = null;
    state.interval = null;
  }, []);

  useEffect(() => () => stopZoomHold(), [stopZoomHold]);

  const startZoomHold = useCallback((direction) => {
    if (zoomControls.disabled) return;
    const canZoom = direction < 0 ? zoomControls.canZoomOut : zoomControls.canZoomIn;
    if (!canZoom) return;
    stopZoomHold();
    const state = holdRef.current;
    state.suppressClick = false;
    const zoomStep = direction < 0 ? zoomControls.zoomOut : zoomControls.zoomIn;
    zoomStep();
    state.timer = window.setTimeout(() => {
      state.timer = null;
      state.suppressClick = true;
      const holdStart = performance.now();
      state.interval = window.setInterval(() => {
        const currentCanZoom = direction < 0 ? zoomControls.canZoomOut : zoomControls.canZoomIn;
        if (!currentCanZoom) {
          stopZoomHold();
          return;
        }
        const elapsed = performance.now() - holdStart;
        const progress = Math.min(1, elapsed / 1800);
        const multiplier = 1 + 7 * progress * progress;
        for (let step = 0; step < multiplier; step += 1) zoomStep();
      }, 48);
    }, 220);
  }, [stopZoomHold, zoomControls]);

  const finishZoomPress = useCallback((event) => {
    const suppressClick = holdRef.current.suppressClick;
    stopZoomHold();
    if (suppressClick && event) {
      event.preventDefault();
      event.stopPropagation();
    }
    // Keep the flag through pointerup so the synthetic click is consumed by
    // handleZoomClick; cancellation/leave has no following click to consume.
    if (!suppressClick || event?.type !== "pointerup") holdRef.current.suppressClick = false;
  }, [stopZoomHold]);

  const handleZoomClick = useCallback((action) => (event) => {
    if (holdRef.current.suppressClick) {
      event.preventDefault();
      holdRef.current.suppressClick = false;
      return;
    }
    action();
  }, []);

  if (!zoomControls) return null;
  return (
    <>
      <button
        type="button"
        className="pdfw_zoom_btn"
        onPointerDown={() => startZoomHold(-1)}
        onPointerUp={finishZoomPress}
        onPointerCancel={finishZoomPress}
        onPointerLeave={finishZoomPress}
        onClick={handleZoomClick(zoomControls.zoomOut)}
        disabled={zoomControls.disabled || !zoomControls.canZoomOut}
        title="Zoom out"
      >
        <i className="bx bx-minus" />
      </button>
      <button
        type="button"
        className="pdfw_zoom_btn"
        onPointerDown={() => startZoomHold(1)}
        onPointerUp={finishZoomPress}
        onPointerCancel={finishZoomPress}
        onPointerLeave={finishZoomPress}
        onClick={handleZoomClick(zoomControls.zoomIn)}
        disabled={zoomControls.disabled || !zoomControls.canZoomIn}
        title="Zoom in"
      >
        <i className="bx bx-plus" />
      </button>
    </>
  );
};

const PDFReaderWorkspaceTabStrip = ({
  tabs,
  setTabs,
  activeId,
  setActiveId,
  tabTypes,
  splitModeOn,
  checkedIds,
  onToggleCheck,
  pageNav,
  onToggleSplit,
  annotationSaveStatus,
  onBack,
}) => {
  const {
    pickerOpen,
    setPickerOpen,
    sources,
    loadingSources,
    pickerRef,
  } = useSourcePicker();

  const openTab = useCallback((sourceId, name) => {
    const tab = createReaderTab(sourceId, name);
    setTabs((prev) => [...prev, tab]);
    setActiveId(tab.id);
    setPickerOpen(false);
  }, [setTabs, setActiveId, setPickerOpen]);

  const closeTab = useCallback((event, tabId) => {
    event.stopPropagation();
    setTabs((prev) => {
      const next = prev.filter((tab) => tab.id !== tabId);
      setActiveId((currentActiveId) => (tabId === currentActiveId ? (next[next.length - 1]?.id ?? null) : currentActiveId));
      return next;
    });
  }, [setTabs, setActiveId]);

  return (
    <div className="pdfw_tabbar">
      <div className="pdfw_tabbar_left">
        <button id="pdfw_back" onClick={onBack} title="Back to Home">
          <BackArrowIcon />
          <span id="pdfw_back_label">Back</span>
        </button>

        <ReaderTabs
          tabs={tabs}
          activeId={activeId}
          splitModeOn={splitModeOn}
          checkedIds={checkedIds}
          tabTypes={tabTypes}
          annotationSaveStatus={annotationSaveStatus}
          setActiveId={setActiveId}
          onToggleCheck={onToggleCheck}
          onCloseTab={closeTab}
        />

        <div className="pdfw_tab_add_wrap" ref={pickerRef}>
          <button className="pdfw_tab_add" onClick={() => setPickerOpen((value) => !value)} title="Open a document in a new tab">
            <i className="bx bx-plus" />
          </button>
          {pickerOpen && (
            <div className="pdfw_picker">
              <select
                className="pdfw_picker_select"
                autoFocus
                value=""
                disabled={loadingSources || sources.length === 0}
                onChange={(event) => {
                  const source = sources.find((item) => item._id === event.target.value);
                  if (source) openTab(source._id, source.name);
                }}
              >
                <option value="" disabled>
                  {loadingSources ? "Loading…" : sources.length === 0 ? "No sources available" : "Select a source…"}
                </option>
                {sources.map((source) => (
                  <option key={source._id} value={source._id}>{source.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      <div className="pdfw_tabbar_center">
        <ReaderSearchBar pageNav={pageNav} />
        <ReaderPageNavigation pageNav={pageNav} splitModeOn={splitModeOn} onToggleSplit={onToggleSplit} />
      </div>
    </div>
  );
};

export default PDFReaderWorkspaceTabStrip;
