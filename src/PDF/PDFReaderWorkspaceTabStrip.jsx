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

const InsertPageIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M13 10h-2v3H8v2h3v3h2v-3h3v-2h-3z" />
    <path d="m19.94 7.68-.03-.09a.8.8 0 0 0-.2-.29l-5-5c-.09-.09-.19-.15-.29-.2l-.09-.03a.8.8 0 0 0-.26-.05c-.02 0-.04-.01-.06-.01H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-12s-.01-.04-.01-.06c0-.09-.02-.17-.05-.26ZM6 20V4h7v4c0 .55.45 1 1 1h4v11z" />
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

const ReaderPageNavigation = ({ pageNav }) => {
  const [readingModeMenuOpen, setReadingModeMenuOpen] = useState(false);
  const readingModeMenuRef = useRef(null);
  const [notebookMenuOpen, setNotebookMenuOpen] = useState(false);
  const notebookMenuRef = useRef(null);
  useEffect(() => {
    if (!readingModeMenuOpen) return undefined;
    const close = (event) => {
      if (!readingModeMenuRef.current?.contains(event.target)) setReadingModeMenuOpen(false);
    };
    document.addEventListener("pointerdown", close, true);
    return () => document.removeEventListener("pointerdown", close, true);
  }, [readingModeMenuOpen]);
  useEffect(() => {
    if (!notebookMenuOpen) return undefined;
    const close = (event) => {
      if (!notebookMenuRef.current?.contains(event.target)) setNotebookMenuOpen(false);
    };
    document.addEventListener("pointerdown", close, true);
    return () => document.removeEventListener("pointerdown", close, true);
  }, [notebookMenuOpen]);
  if (!pageNav || pageNav.pageCount <= 0) return null;
  return (
    <div id="pdf_page_nav_row" className="pdfw_page_nav_group">
      <div id="pdf_page_nav">
        <button onClick={pageNav.goToPrevPage} disabled={pageNav.pageNum <= 1 || pageNav.disabled} title="Previous page">‹</button>
        <span id="pdf_page_nav_label">{pageNav.pageNum} / {pageNav.pageCount}</span>
        <button onClick={pageNav.goToNextPage} disabled={pageNav.pageNum >= pageNav.pageCount || pageNav.disabled} title="Next page">›</button>
      </div>
      {pageNav.pageCount > 1 && (
        <>
          <div ref={readingModeMenuRef} className={`pdf_reading_mode_menu_wrap${readingModeMenuOpen ? " pdf_reading_mode_menu_wrap--open" : ""}`}>
            <button
              type="button"
              id="pdf_reading_mode_toggle"
              className={!pageNav.markdownOpen ? "pdf_reading_mode_toggle--active" : undefined}
              onClick={() => {
                if (pageNav.markdownOpen) pageNav.setReadingMode("single");
                setReadingModeMenuOpen((open) => !open);
              }}
              title="Reading mode"
            >
              PDF
            </button>
            {readingModeMenuOpen && (
              <div className="pdf_reading_mode_menu" role="menu" aria-label="Reading mode">
                <button type="button" className={pageNav.readingMode === "single" ? "pdf_reading_mode_menu_item--active" : undefined} onClick={() => { pageNav.setReadingMode("single"); setReadingModeMenuOpen(false); }}>
                  <i className="bx bx-file" />
                  <span>One-page PDF</span>
                </button>
                <button type="button" className={pageNav.readingMode === "booklet" ? "pdf_reading_mode_menu_item--active" : undefined} onClick={() => { pageNav.setReadingMode("booklet"); setReadingModeMenuOpen(false); }}>
                  <i className="bx bx-book-open" />
                  <span>Two-pages PDF</span>
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            id="pdf_ocr_companion_toggle"
            className={[
              pageNav.markdownOpen ? "pdf_ocr_companion_toggle--active" : "",
              pageNav.markdownMenuOpen ? "pdf_ocr_companion_toggle--menu-open" : "",
            ].filter(Boolean).join(" ") || undefined}
            onClick={pageNav.toggleMarkdownAside}
            title={pageNav.markdownOpen ? "Markdown options" : "Choose Markdown mode"}
            disabled={pageNav.disabled}
          >
            MD
          </button>
          <div ref={notebookMenuRef} className={`pdf_notebook_menu_wrap${notebookMenuOpen ? " pdf_notebook_menu_wrap--open" : ""}`}>
            <button
              type="button"
              id="pdf_notebook_toggle"
              className={pageNav.notebookOpen ? "pdf_notebook_toggle--active" : undefined}
              onClick={() => setNotebookMenuOpen((open) => !open)}
              title="Freeform Notebook options"
              disabled={pageNav.disabled}
            >
              NB
            </button>
            {notebookMenuOpen && (
              <div className="pdf_notebook_menu" role="menu" aria-label="Freeform Notebook modes">
                {[
                  ["notebook-only", "Notebook only"],
                  ["notebook-pdf", "Notebook with PDF"],
                  ["notebook-md", "Notebook with MD"],
                  ["notebook-pdf-md", "Notebook with PDF and MD"],
                ].map(([mode, label]) => (
                  <button key={mode} type="button" role="menuitem" className={pageNav.notebookMode === mode ? "pdf_notebook_menu_item--active" : undefined} onClick={() => { pageNav.setNotebookView(mode); setNotebookMenuOpen(false); }}>
                    <i className={mode === "notebook-only" ? "bx bx-notepad" : mode === "notebook-md" ? "bx bx-file" : mode === "notebook-pdf-md" ? "bx bx-columns" : "bx bx-book"} />
                    <span>{label}</span>
                  </button>
                ))}
                {pageNav.notebookOpen && <button type="button" role="menuitem" className="pdf_notebook_menu_item--close" onClick={() => { pageNav.closeNotebook(); setNotebookMenuOpen(false); }}><i className="bx bx-x" /><span>Close Notebook</span></button>}
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

const ReaderAnnotationActions = ({ undoRedo, pageNav }) => {
  if (!undoRedo) return null;
  return (
    <div id="pdf_annot_right_group" className="pdfw_undo_redo_group">
      <div id="pdf_annot_actions">
        {pageNav && pageNav.pageCount > 0 && pageNav.readingMode === "single" && (
          <button
            type="button"
            id="pdf_insert_blank_page_btn"
            onClick={pageNav.insertBlankPageAfterCurrent}
            disabled={pageNav.insertingBlankPage || !pageNav.canInsertBlankPage}
            title="Insert a blank page after this one"
          >
            {pageNav.insertingBlankPage ? <i className="bx bx-loader-alt bx-spin" /> : <InsertPageIcon />}
          </button>
        )}
        <div id="pdf_annot_action_btn_group">
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
      </div>
    </div>
  );
};

const ReaderZoomControls = ({ zoomControls, label }) => {
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
    <div className="pdfw_zoom_group" aria-label={`${label || "Page"} zoom controls`}>
      {label && <span className="pdfw_zoom_surface_label">{label}</span>}
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
        className="pdfw_zoom_label"
        onClick={zoomControls.resetZoom}
        disabled={zoomControls.disabled}
        title="Reset zoom"
      >
        {zoomControls.percent || 100}%
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
    </div>
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
  undoRedo,
  pageNav,
  zoomControls,
  annotationSaveStatus,
  onAnnotationSaveStateChange,
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
        <ReaderPageNavigation pageNav={pageNav} />
      </div>

      <div className="pdfw_tabbar_right">
        <ReaderZoomControls zoomControls={zoomControls} label="PDF/MD" />
        <ReaderAnnotationActions undoRedo={undoRedo} pageNav={pageNav} />
      </div>
    </div>
  );
};

export default PDFReaderWorkspaceTabStrip;
