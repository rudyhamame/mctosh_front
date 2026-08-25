import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createPortal } from "react-dom";
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
  <svg className="pdfw_undo_action_icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="0 0 24 24" style={{ transform: "rotate(-90deg)", transformOrigin: "center" }} aria-hidden="true">
    <path d="M15 5c0-1.65-1.35-3-3-3S9 3.35 9 5s1.35 3 3 3 3-1.35 3-3m-4 0c0-.55.45-1 1-1s1 .45 1 1-.45 1-1 1-1-.45-1-1m8 0c-1.65 0-3 1.35-3 3s1.35 3 3 3 3-1.35 3-3-1.35-3-3-3m0 4c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1M8 8c0-1.65-1.35-3-3-3S2 6.35 2 8s1.35 3 3 3 3-1.35 3-3M4 8c0-.55.45-1 1-1s1 .45 1 1-.45 1-1 1-1-.45-1-1m1.22 13.14c.81.53 1.74.8 2.68.8.67 0 1.33-.14 1.97-.41l.98-.43c.74-.32 1.59-.32 2.32 0l.98.43c1.52.67 3.25.52 4.64-.39a4.88 4.88 0 0 0 2.22-4.1c0-2.25-1.53-4.2-3.71-4.75-.51-.13-.97-.39-1.35-.76l-.48-.48c-1.91-1.91-5.02-1.91-6.92 0l-.48.48c-.37.37-.84.63-1.35.76-2.18.55-3.71 2.5-3.71 4.75 0 1.66.83 3.19 2.22 4.1Zm1.98-6.91c.86-.22 1.65-.66 2.27-1.29l.48-.48c.56-.56 1.31-.85 2.05-.85s1.48.28 2.05.85l.48.48c.63.63 1.41 1.07 2.28 1.29A2.89 2.89 0 0 1 19 17.04c0 1-.48 1.88-1.31 2.42s-1.83.63-2.75.23l-.98-.43a4.9 4.9 0 0 0-3.93 0l-.98.43c-.91.4-1.91.32-2.75-.23s-1.31-1.43-1.31-2.42c0-1.33.9-2.49 2.2-2.81Z" />
  </svg>
);

const RedoActionIcon = () => (
  <svg className="pdfw_redo_action_icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="0 0 24 24" style={{ transform: "rotate(90deg)", transformOrigin: "center" }} aria-hidden="true">
    <path d="M15 5c0-1.65-1.35-3-3-3S9 3.35 9 5s1.35 3 3 3 3-1.35 3-3m-4 0c0-.55.45-1 1-1s1 .45 1 1-.45 1-1 1-1-.45-1-1m8 0c-1.65 0-3 1.35-3 3s1.35 3 3 3 3-1.35 3-3-1.35-3-3-3m0 4c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1M8 8c0-1.65-1.35-3-3-3S2 6.35 2 8s1.35 3 3 3 3-1.35 3-3M4 8c0-.55.45-1 1-1s1 .45 1 1-.45 1-1 1-1-.45-1-1m1.22 13.14c.81.53 1.74.8 2.68.8.67 0 1.33-.14 1.97-.41l.98-.43c.74-.32 1.59-.32 2.32 0l.98.43c1.52.67 3.25.52 4.64-.39a4.88 4.88 0 0 0 2.22-4.1c0-2.25-1.53-4.2-3.71-4.75-.51-.13-.97-.39-1.35-.76l-.48-.48c-1.91-1.91-5.02-1.91-6.92 0l-.48.48c-.37.37-.84.63-1.35.76-2.18.55-3.71 2.5-3.71 4.75 0 1.66.83 3.19 2.22 4.1Zm1.98-6.91c.86-.22 1.65-.66 2.27-1.29l.48-.48c.56-.56 1.31-.85 2.05-.85s1.48.28 2.05.85l.48.48c.63.63 1.41 1.07 2.28 1.29A2.89 2.89 0 0 1 19 17.04c0 1-.48 1.88-1.31 2.42s-1.83.63-2.75.23-1.91-.32-2.75-.23-1.31-1.43-1.31-2.42c0-1.33.9-2.49 2.2-2.81Z" />
  </svg>
);

const HistoryActionIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M21.71 3.71 20.3 2.3l-2.29 2.29V2h-2v2.22c-.41-.14-.84-.22-1.27-.22a5.99 5.99 0 0 0-5.05 2.75L2.93 17.26c-.7 1.08-.54 2.53.37 3.44.53.53 1.24.8 1.95.8.51 0 1.03-.14 1.48-.43l10.51-6.76c1.73-1.11 2.76-3 2.76-5.05 0-.44-.09-.86-.22-1.27H22v-2h-2.59L21.7 3.7Zm-5.54 8.93-.37.24-2.58-2.58-1.41 1.41 2.28 2.28-1.32.85-1.54-1.54-1.41 1.41 1.23 1.23-5.38 3.46c-.3.19-.69.15-.94-.1a.76.76 0 0 1-.1-.94l6.76-10.51c.74-1.15 2-1.84 3.36-1.84.54 0 1.08.22 1.46.61l1.2 1.2c.38.38.61.92.61 1.46 0 1.37-.69 2.62-1.84 3.37Z" />
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
    const onKeyDown = (event) => {
      if (event.key === "Escape") setPickerOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const attachTimer = setTimeout(() => document.addEventListener("pointerdown", onDocClick), 0);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      clearTimeout(attachTimer);
      document.removeEventListener("pointerdown", onDocClick);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
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

const SourcePickerModal = ({ open, loading, sources, dialogRef, onClose, onSelect }) => {
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="pdfw_source_picker_backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="pdfw_source_picker_modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pdfw-source-picker-title"
      >
        <header className="pdfw_source_picker_header">
          <div>
            <span>Sources</span>
            <h2 id="pdfw-source-picker-title">Choose a document</h2>
          </div>
          <button type="button" autoFocus onClick={onClose} aria-label="Close document picker" title="Close">
            <i className="bx bx-x" />
          </button>
        </header>
        <div className="pdfw_source_picker_list" role="list">
          {loading ? (
            <div className="pdfw_source_picker_state"><i className="bx bx-loader-alt bx-spin" /><span>Loading available documents…</span></div>
          ) : sources.length ? sources.map((source) => (
            <button
              type="button"
              role="listitem"
              className="pdfw_source_picker_item"
              key={source._id}
              onClick={() => onSelect(source._id, source.name)}
            >
              <span className="pdfw_source_picker_icon"><i className="bx bxs-file-pdf" /></span>
              <span className="pdfw_source_picker_identity">
                <strong>{source.name || "Untitled document"}</strong>
                <small>{String(source.format || source.type || "PDF").replace("application/", "").toUpperCase()}</small>
              </span>
              <i className="bx bx-right-arrow-alt" aria-hidden="true" />
            </button>
          )) : (
            <div className="pdfw_source_picker_state"><i className="bx bx-file" /><span>No source documents are available.</span></div>
          )}
        </div>
      </section>
    </div>,
    document.body,
  );
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
    <div className="pdfw_document_tabstrip">
      {tabs.map((tab) => {
        const showingStatus = tab.id === activeId && showSaveStatus;
        return (
          <button
            type="button"
            key={tab.id}
            className={`pdfw_document_tab${tab.id === activeId ? " pdfw_document_tab--active" : ""}`}
            onClick={() => setActiveId(tab.id)}
            title={tab.name}
          >
            {splitModeOn && (
              <span
                className="pdfw_document_tab_check"
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleCheck(tab.id);
                }}
              >
                <i className={checkedIds.includes(tab.id) ? "bxf bx-checkbox-checked" : "bx bx-checkbox"} />
              </span>
            )}
            <span className={`pdfw_document_tab_label${showingStatus ? " pdfw_document_tab_label--save-status" : ""}`}>
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
                className={`${PDF_TYPE_ICON[tabTypes[tab.id]]} pdfw_document_tab_type`}
                title={tabTypes[tab.id]}
              />
            )}
            <span className="pdfw_document_tab_close" onClick={(event) => onCloseTab(event, tab.id)}>
              <i className="bx bx-x" />
            </span>
          </button>
        );
      })}
    </div>
  );
};

const ReaderSearchBar = ({ pageNav }) => {
  const searchInputRef = useRef(null);

  useEffect(() => {
    const onVirtualKeyboardEnter = (event) => {
      if (event.detail?.target !== searchInputRef.current) return;
      pageNav.runSearch?.(searchInputRef.current.value);
    };
    window.addEventListener("virtual-keyboard:enter", onVirtualKeyboardEnter);
    return () => window.removeEventListener("virtual-keyboard:enter", onVirtualKeyboardEnter);
  }, [pageNav]);

  if (!pageNav) return null;

  if (!pageNav.searchOpen) {
    return (
      <button
        type="button"
        className="pdfw_search_toggle"
        onClick={() => pageNav.setSearchOpen(true)}
        aria-label="Open Wordform Search"
        title="Open Wordform Search"
      >
        <i className="bx bx-search" aria-hidden="true" />
      </button>
    );
  }

  return (
    <div
      className="pdfw_search_group pdfw_search_group--open"
      role="search"
      aria-label="Wordform Search"
    >
      <input
        ref={searchInputRef}
        className="pdfw_search_input"
        data-vk-enter-action="search"
        value={pageNav.searchQuery || ""}
        onChange={(event) => pageNav.setSearchQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            pageNav.runSearch?.();
          }
        }}
        placeholder="Wordform Search"
        aria-label="Wordform Search"
        autoFocus
      />
      {pageNav.searchMatches?.length > 0 && (
        <div className="pdfw_search_results_dropdown" role="listbox" aria-label="Search results">
          {pageNav.searchMatches.map((match, index) => (
            <button
              type="button"
              role="option"
              aria-selected={index === pageNav.searchActiveIndex}
              className={`pdfw_search_result${index === pageNav.searchActiveIndex ? " is-active" : ""}`}
              key={`${match.page}-${index}-${match.originalMatchedText || "match"}`}
              onClick={() => pageNav.selectSearchMatch?.(index)}
            >
              <span className="pdfw_search_result_page">Page {match.page}</span>
              <span className="pdfw_search_result_text">{match.originalMatchedText || pageNav.searchQuery}</span>
              <span className="pdfw_search_result_type">{match.matchType || "match"}</span>
            </button>
          ))}
        </div>
      )}
      <span className="pdfw_search_count">
        {pageNav.searchScanning ? (
          <span className="pdfw_search_loader" aria-label="Search in progress" role="status" />
        ) : pageNav.searchMatchCount ? `${pageNav.searchActiveIndex + 1}/${pageNav.searchMatchCount}` : ""}
      </span>
  
      <button type="button" className="pdfw_search_action" onClick={() => pageNav.goToSearchMatch(-1)} disabled={!pageNav.searchMatchCount} title="Previous match" aria-label="Previous match"><i className="bx bx-chevron-up" /></button>
      <button type="button" className="pdfw_search_action" onClick={() => pageNav.goToSearchMatch(1)} disabled={!pageNav.searchMatchCount} title="Next match" aria-label="Next match"><i className="bx bx-chevron-down" /></button>
      <button type="button" className="pdfw_search_action" onClick={() => pageNav.setSearchOpen(false)} title="Close Wordform Search" aria-label="Close Wordform Search"><i className="bx bx-x" /></button>
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

const ReaderNavigatorToggle = ({ pageNav }) => {
  if (!pageNav || pageNav.pageCount <= 0) return null;
  const active = Boolean(pageNav.documentNavigatorOpen || pageNav.outlineOpen);
  return (
    <button
      type="button"
      className={`pdf_reader_nav_action pdfw_navigator_mount_toggle${active ? " pdf_reader_nav_action--active" : ""}`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        pageNav.openDocumentNavigator?.("navigator");
      }}
      disabled={pageNav.disabled}
      title={active ? "Close Page Navigator and Document Structure" : "Open Page Navigator and Document Structure"}
      aria-label={active ? "Close Page Navigator and Document Structure" : "Open Page Navigator and Document Structure"}
      aria-pressed={active}
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M21 16V8l-5 4zM3 5h15v2H3zm0 6h11v2H3zm0 6h15v2H3z" />
      </svg>
    </button>
  );
};

const ReaderPageController = ({ pageNav }) => {
  const [expanded, setExpanded] = useState(false);
  if (!pageNav || pageNav.pageCount <= 0) return null;

  const toggleExpanded = () => setExpanded((open) => !open);
  const handleLabelKeyDown = (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleExpanded();
    }
  };

  return (
    <>
      <div id="pdf_page_nav" className={`pdf_reader_page_controller${expanded ? " pdf_reader_page_controller--expanded" : ""}`} aria-label="Page controller">
        {expanded && (
          <button type="button" onClick={pageNav.goToPrevPage} disabled={pageNav.disabled || pageNav.pageNum <= 1} title="Previous page" aria-label={`Go to previous page${pageNav.pageNum > 1 ? `, page ${pageNav.pageNum - 1}` : ""}`}>
            <i className="bx bx-chevron-left" aria-hidden="true" />
          </button>
        )}
        <span
          id="pdf_page_nav_label"
          role="button"
          tabIndex={0}
          onClick={toggleExpanded}
          onKeyDown={handleLabelKeyDown}
          aria-expanded={expanded}
          aria-live="polite"
          aria-label={`${expanded ? "Collapse" : "Expand"} page controls. Page ${pageNav.pageNum} of ${pageNav.pageCount}`}
        >
          <strong>{pageNav.pageNum}</strong>
          {expanded && <><i aria-hidden="true">/</i><span>{pageNav.pageCount}</span></>}
        </span>
        {expanded && (
          <button type="button" onClick={pageNav.goToNextPage} disabled={pageNav.disabled || pageNav.pageNum >= pageNav.pageCount} title="Next page" aria-label={`Go to next page${pageNav.pageNum < pageNav.pageCount ? `, page ${pageNav.pageNum + 1}` : ""}`}>
            <i className="bx bx-chevron-right" aria-hidden="true" />
          </button>
        )}
      </div>
      {pageNav.readingMode === "booklet" && (
        <div id="pdf_page_nav_right">
          <button onClick={() => pageNav.setBookletRightPage(Math.max(1, (pageNav.bookletRightPage || 1) - 1))} disabled={(pageNav.bookletRightPage || 1) <= 1 || pageNav.disabled} title="Previous companion page">‹</button>
          <span id="pdf_page_nav_right_label">{pageNav.bookletRightPage || 1} / {pageNav.pageCount}</span>
          <button onClick={() => pageNav.setBookletRightPage(Math.min(pageNav.pageCount, (pageNav.bookletRightPage || 1) + 1))} disabled={(pageNav.bookletRightPage || 1) >= pageNav.pageCount || pageNav.disabled} title="Next companion page">›</button>
        </div>
      )}
    </>
  );
};

const ReaderPageNavigation = ({ pageNav }) => {
  const navigate = useNavigate();
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [functionsMenuOpen, setFunctionsMenuOpen] = useState(false);
  const modeMenuRef = useRef(null);
  const functionsMenuRef = useRef(null);
  useEffect(() => {
    if (!modeMenuOpen && !functionsMenuOpen) return undefined;
    const close = (event) => {
      if (modeMenuRef.current?.contains(event.target) || functionsMenuRef.current?.contains(event.target)) return;
      setModeMenuOpen(false);
      setFunctionsMenuOpen(false);
    };
    // Run after the button's own pointer/click handlers. Capture mode can
    // close the menu before React receives the toggle click when the header
    // is layered over the reader chrome.
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [functionsMenuOpen, modeMenuOpen]);
  if (!pageNav || pageNav.pageCount <= 0) return null;

  const selectMode = (action) => () => {
    action?.();
    setModeMenuOpen(false);
  };
  const selectFunction = (action) => () => {
    action?.();
    setFunctionsMenuOpen(false);
  };
  const preventNavigationDoubleZoom = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  const modeSections = [
    {
      id: "pdf",
      title: "PDF",
      items: [
        { id: "pdf-single", icon: "bx bx-file", label: "One-page PDF", active: pageNav.readingMode === "single" && !pageNav.markdownOpen, onSelect: selectMode(() => pageNav.setReadingMode("single")) },
        { id: "pdf-booklet", icon: "bx bx-book-open", label: "Two-pages PDF", active: pageNav.readingMode === "booklet", onSelect: selectMode(() => pageNav.setReadingMode("booklet")) },
      ],
    },
    {
      id: "plain-text",
      title: "Plain-Text Document",
      items: [
        { id: "plain-text-only", icon: "bx bx-file", label: "Document only", active: pageNav.markdownOpen && pageNav.markdownMode === "visual-only", onSelect: selectMode(() => pageNav.setMarkdownMode("md-only")) },
        { id: "plain-text-pdf", icon: "bx bx-book-open", label: "Document with PDF page", active: pageNav.markdownOpen && pageNav.markdownMode === "visual-raw", onSelect: selectMode(() => pageNav.setMarkdownMode("md-pdf")) },
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
  const functionSections = [{
    id: "pdf-functions",
    title: "Functions on PDF",
    items: [
      { id: "layer-1-glyph-char", icon: "bx bx-shape-circle", label: "Layer 1 · Glyph → Char", active: pageNav.glyphCharAsideOpen, disabled: pageNav.disabled, role: "menuitemcheckbox", onSelect: selectFunction(pageNav.toggleGlyphCharAside) },
      { id: "page-concepts", icon: pageNav.pageConceptBusy ? "bx bx-loader-alt bx-spin" : "bx bx-bulb", label: pageNav.pageConceptBusy ? "Cancel page concept analysis" : "Build page concepts", active: pageNav.pageConceptBusy, disabled: pageNav.disabled, role: "menuitem", onSelect: selectFunction(pageNav.buildPageConcepts) },
      { id: "smart-video", icon: "bx bx-video", label: "Smart Video", active: pageNav.smartVideoActive, disabled: pageNav.disabled, role: "menuitemcheckbox", onSelect: selectFunction(pageNav.toggleSmartVideo) },
      { id: "abbreviations", icon: "bx bx-font", label: "Abbreviations", active: pageNav.abbreviationPanelOpen, disabled: pageNav.disabled, role: "menuitemcheckbox", onSelect: selectFunction(pageNav.toggleAbbreviationPanel) },
      { id: "illumination", icon: pageNav.isCurrentPageFullySegmented ? "bx bx-show" : "bx bx-low-vision", label: "RabbitHole Illumination", active: pageNav.entityBuilderOpen, disabled: pageNav.disabled, role: "menuitemcheckbox", onSelect: selectFunction(pageNav.toggleEntityBuilder) },
      { id: "document-rabbithole", icon: "bx bx-git-branch", label: "Document RabbitHole", active: pageNav.sentenceTreeOpen, disabled: pageNav.disabled, role: "menuitemcheckbox", onSelect: selectFunction(pageNav.toggleSentenceTree) },
      { id: "clinical-vignette-generator", icon: "bx bx-user-plus", label: "Clinical Vignette Generator", disabled: pageNav.disabled, role: "menuitem", onSelect: selectFunction(() => navigate("/clinical-vignettes")) },
      { id: "pdf-forensics", icon: "bx bx-shield-quarter", label: "PDF Forensics", active: pageNav.markdownOpen && pageNav.markdownMode === "forensics", disabled: pageNav.disabled, role: "menuitemcheckbox", onSelect: selectFunction(() => pageNav.setMarkdownMode?.("forensics")) },
    ],
  }];
  const selectedFunctionLabel = functionSections
    .flatMap((section) => section.items)
    .find((item) => item.active)?.label || "FUNCTIONS";

  return (
    <div
      id="pdf_page_nav_row"
      className="pdfw_page_nav_group"
      onDoubleClick={preventNavigationDoubleZoom}
    >
      <div ref={functionsMenuRef} className={`pdfw_mode_menu_wrap${functionsMenuOpen ? " pdfw_mode_menu_wrap--open" : ""}`}>
        <button
          type="button"
          id="pdfw_functions_toggle"
          className={`pdfw_menu_toggle${functionsMenuOpen ? " pdfw_mode_toggle--active" : ""}`}
          aria-expanded={functionsMenuOpen}
          aria-haspopup="menu"
          onClick={() => {
            setFunctionsMenuOpen((open) => !open);
            setModeMenuOpen(false);
          }}
          title={selectedFunctionLabel === "FUNCTIONS" ? "Functions on PDF" : selectedFunctionLabel}
        >
          <span>{selectedFunctionLabel}</span> <i className="bx bx-chevron-down" aria-hidden="true" />
        </button>
        {functionsMenuOpen && (
          <div className="pdfw_mode_menu pdfw_functions_menu" role="menu" aria-label="Functions on PDF">
            {functionSections.map((section) => <ReaderModeMenuSection key={section.id} {...section} />)}
          </div>
        )}
      </div>
      {pageNav.pageCount > 1 && (
        <>
          <div ref={modeMenuRef} className={`pdfw_mode_menu_wrap${modeMenuOpen ? " pdfw_mode_menu_wrap--open" : ""}`}>
            <button
              type="button"
              id="pdfw_mode_toggle"
              className={`pdfw_menu_toggle${modeMenuOpen ? " pdfw_mode_toggle--active" : ""}`}
              aria-expanded={modeMenuOpen}
              aria-haspopup="menu"
              onClick={() => {
                setModeMenuOpen((open) => !open);
                setFunctionsMenuOpen(false);
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
    <>
      <button id="pdfw_back" onClick={onBack} title="Back to Home">
        <BackArrowIcon />
      </button>

      <div className="pdfw_document_tabbar">
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

        <button
          className="pdfw_document_tab pdfw_document_tab--active pdfw_document_tab_add"
          onClick={() => setPickerOpen((value) => !value)}
          title="Open a document in a new tab"
        >
          <i className="bx bx-plus" />
        </button>
      </div>

      <ReaderPageController pageNav={pageNav} />
      <div className="pdfw_tabbar_right">
        <ReaderSearchBar pageNav={pageNav} />
        <ReaderPageNavigation pageNav={pageNav} />
        <ReaderNavigatorToggle pageNav={pageNav} />
      </div>
      <SourcePickerModal
        open={pickerOpen}
        loading={loadingSources}
        sources={sources}
        dialogRef={pickerRef}
        onClose={() => setPickerOpen(false)}
        onSelect={openTab}
      />
    </>
  );
};

export default PDFReaderWorkspaceTabStrip;
