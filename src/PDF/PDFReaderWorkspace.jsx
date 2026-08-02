import React, { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import PDFPage from "./PDFPage";
import PDFReaderWorkspaceTabStrip from "./PDFReaderWorkspaceTabStrip";
import {
  DEFAULT_PAGE_NAV_STATE,
  DEFAULT_UNDO_REDO_STATE,
  storeReaderTab,
  usePdfReaderWorkspaceState,
} from "./pdfReaderWorkspaceState";
import "./pdfReaderWorkspace.css";

// One tab's page, rendered as its own pane — no per-pane toolbar or tab
// strip of its own; split view is just N of these side by side, driven
// entirely by which tabs are checked in the single shared TabStrip above.
// isActive/pdfPageRef/onUndoRedoStateChange/onPageNavStateChange are only
// ever passed for whichever ONE pane corresponds to activeId — the rest
// render their own undo/redo + page nav internally as normal (hideUndoRedo/
// hidePageNav stay false for them), since a single hoisted row in the tab
// bar can only ever drive one tab's state at a time; split view showing
// several *other* tabs alongside the active one keeps each of those with
// their own in-toolbar controls.
const PaneBody = ({ tab, onTabTypeChange, isActive, pdfPageRef, onUndoRedoStateChange, onPageNavStateChange, toolbarHost }) => (
  <div className="pdfw_pane_body">
    {tab ? (
      <PDFPage
        key={tab.id}
        ref={isActive ? pdfPageRef : undefined}
        embeddedSourceId={tab.sourceId}
        embeddedPdfName={tab.name}
        embeddedHomePath="/home"
        homeLabel="Home"
        hideHyleControls
        fitToContainer
        hideUndoRedo={isActive}
        onUndoRedoStateChange={isActive ? onUndoRedoStateChange : undefined}
        hidePageNav={isActive}
        onPageNavStateChange={isActive ? onPageNavStateChange : undefined}
        toolbarHost={isActive ? toolbarHost : null}
        initialPage={tab.page}
        onPdfTypeChange={(type) => onTabTypeChange(tab.id, type)}
      />
    ) : (
      <div className="pdfw_pane_empty">
        <i className="bxf bx-file-pdf" />
        <p>No document open — click + to open one</p>
      </div>
    )}
  </div>
);

const PDFReaderWorkspace = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    tabs,
    setTabs,
    activeId,
    setActiveId,
    splitModeOn,
    toggleSplitMode,
    checkedIds,
    onToggleCheck,
  } = usePdfReaderWorkspaceState({
    locationKey: location.key,
    locationState: location.state,
  });
  const [toolbarHostEl, setToolbarHostEl] = useState(null);

  // pdf-type (text-based/mixed/scanned) per tab, reported by each PDFPage
  // instance via onPdfTypeChange — shown as an icon after the tab's name.
  const [tabTypes, setTabTypes] = useState({});
  const onTabTypeChange = useCallback((tabId, type) => {
    setTabTypes((prev) => (prev[tabId] === type ? prev : { ...prev, [tabId]: type }));
  }, []);

  const panesToShow = checkedIds.length > 0
    ? checkedIds.map((id) => tabs.find((t) => t.id === id)).filter(Boolean)
    : [tabs.find((t) => t.id === activeId) || null];

  // Undo/history/redo, hoisted from the active tab's own PDFPage toolbar
  // into the tab bar (see TabStrip's undoRedo prop) — undoRedoState is
  // reported via PDFPage's onUndoRedoStateChange effect (a ref alone can't
  // trigger this component to re-render its own buttons). Reset to
  // defaults whenever the active tab changes; the new pane's own
  // mount-time effect reports its real state again immediately after.
  const activePageRef = useRef(null);
  const [undoRedoState, setUndoRedoState] = useState(DEFAULT_UNDO_REDO_STATE);
  useEffect(() => { setUndoRedoState(DEFAULT_UNDO_REDO_STATE); }, [activeId]);
  const undoRedo = activeId ? {
    ...undoRedoState,
    undo: () => activePageRef.current?.undo(),
    redo: () => activePageRef.current?.redo(),
    toggleHistory: () => activePageRef.current?.toggleHistory(),
  } : null;

  // Same pattern as undoRedo above, for the prev/page-number/next row.
  const [pageNavState, setPageNavState] = useState(DEFAULT_PAGE_NAV_STATE);
  useEffect(() => { setPageNavState(DEFAULT_PAGE_NAV_STATE); }, [activeId]);

  const pageNav = activeId ? {
    ...pageNavState,
    goToPrevPage: () => activePageRef.current?.goToPrevPage(),
    goToNextPage: () => activePageRef.current?.goToNextPage(),
    setReadingMode: (v) => activePageRef.current?.setReadingMode(v),
    setBookletRightPage: (v) => activePageRef.current?.setBookletRightPage(v),
    insertBlankPageAfterCurrent: () => activePageRef.current?.insertBlankPageAfterCurrent(),
  } : null;

  useEffect(() => {
    const activeTab = tabs.find((t) => t.id === activeId) || null;
    if (!activeTab) {
      storeReaderTab(null);
      return;
    }
    storeReaderTab({
      sourceId: activeTab.sourceId,
      pdfName: activeTab.name,
      page: pageNavState.pageCount > 0 ? pageNavState.pageNum : activeTab.page,
    });
  }, [tabs, activeId, pageNavState.pageCount, pageNavState.pageNum]);

  return (
    <div id="pdfw_root">
      <div id="pdfw_header">
        <div id="pdfw_header_main">
          <PDFReaderWorkspaceTabStrip
            tabs={tabs}
            setTabs={setTabs}
            activeId={activeId}
            setActiveId={setActiveId}
            tabTypes={tabTypes}
            splitModeOn={splitModeOn}
            checkedIds={checkedIds}
            onToggleCheck={onToggleCheck}
            undoRedo={undoRedo}
            pageNav={pageNav}
            onBack={() => navigate("/home")}
          />
          <div id="pdfw_toolbar_host" ref={setToolbarHostEl} />
        </div>
        {tabs.length > 1 && (
          <button
            id="pdfw_split_toggle"
            className={splitModeOn ? "pdfw_split_toggle--active" : ""}
            onClick={toggleSplitMode}
            title={splitModeOn ? "Stop selecting tabs to split" : "Check two or more tabs to view their pages side by side"}
          >
            <i className={splitModeOn ? "bx bx-checkbox" : "bx bx-columns"} />
            {splitModeOn ? "Done" : "Split view"}
          </button>
        )}
      </div>

      <div id="pdfw_panes" className={panesToShow.length > 1 ? "pdfw_panes--split" : ""}>
        {panesToShow.map((tab, i) => (
          <div className="pdfw_pane" key={tab?.id ?? `empty_${i}`}>
            <PaneBody
              tab={tab}
              onTabTypeChange={onTabTypeChange}
              isActive={Boolean(tab) && tab.id === activeId}
              pdfPageRef={activePageRef}
              onUndoRedoStateChange={setUndoRedoState}
              onPageNavStateChange={setPageNavState}
              toolbarHost={toolbarHostEl}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

export default PDFReaderWorkspace;
