import React, { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import PDFPage from "./PDFPage";
import PDFReaderWorkspaceTabStrip, { ReaderAnnotationActions } from "./PDFReaderWorkspaceTabStrip";
import VirtualKeyboard from "../Shared/VirtualKeyboard";
import ServiceStatusFooter from "../App/ServiceStatusFooter";
import {
  DEFAULT_PAGE_NAV_STATE,
  DEFAULT_ZOOM_STATE,
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
const PaneBody = ({
  tab,
  onTabTypeChange,
  isActive,
  pdfPageRef,
  onUndoRedoStateChange,
  onPageNavStateChange,
  onZoomStateChange,
  onAnnotationSaveStateChange,
  toolbarLeading,
  toolbarHost,
  textToolbarOptionsHost,
  entityBuilderHost,
  markdownHost,
  markdownHostRef,
  onLayer1OnlyChange,
}) => (
  <div className={`pdfw_pane_body${isActive && markdownHost ? " pdfw_pane_body--md" : ""}`}>
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
        onZoomStateChange={isActive ? onZoomStateChange : undefined}
        onAnnotationSaveStateChange={isActive ? onAnnotationSaveStateChange : undefined}
        toolbarLeading={isActive ? toolbarLeading : null}
        toolbarHost={isActive ? toolbarHost : null}
        textToolbarOptionsHost={isActive ? textToolbarOptionsHost : null}
        entityBuilderHost={isActive ? entityBuilderHost : null}
        markdownHost={isActive ? markdownHost : null}
        layer1Only={isActive}
        onLayer1OnlyChange={isActive ? onLayer1OnlyChange : undefined}
        initialPage={tab.page}
        onPdfTypeChange={(type) => onTabTypeChange(tab.id, type)}
      />
    ) : (
      <div className="pdfw_pane_empty">
        <i className="bxf bx-file-pdf" />
        <p>No document open — click + to open one</p>
      </div>
    )}
    {isActive && <div id="pdfw_markdown_host" ref={markdownHostRef} />}
  </div>
);

const PDFReaderWorkspace = () => {
  const rootRef = useRef(null);
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
  const [textToolbarOptionsHostEl, setTextToolbarOptionsHostEl] = useState(null);
  const [entityBuilderHostEl, setEntityBuilderHostEl] = useState(null);
  const [markdownHostEl, setMarkdownHostEl] = useState(null);
  const [layer1Only, setLayer1Only] = useState(false);
  const onLayer1OnlyChange = useCallback((open) => setLayer1Only(Boolean(open)), []);

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
  const onPageNavStateChange = useCallback((nextState) => {
    setPageNavState(nextState);
    if (!activeId || nextState.pageCount <= 0 || nextState.pageNum <= 0) return;
    setTabs((prev) => prev.map((tab) => tab.id === activeId ? { ...tab, page: nextState.pageNum } : tab));
    const activeTab = tabs.find((tab) => tab.id === activeId);
    if (activeTab) {
      storeReaderTab({
        sourceId: activeTab.sourceId,
        pdfName: activeTab.name,
        page: nextState.pageNum,
      });
    }
  }, [activeId, setTabs, tabs]);
  const [zoomState, setZoomState] = useState(DEFAULT_ZOOM_STATE);
  useEffect(() => {
    setZoomState(DEFAULT_ZOOM_STATE);
  }, [activeId]);
  const [annotationSaveStatus, setAnnotationSaveStatus] = useState("idle");
  useEffect(() => { setAnnotationSaveStatus("idle"); }, [activeId]);

  const pageNav = activeId ? {
    ...pageNavState,
    goToPrevPage: () => activePageRef.current?.goToPrevPage(),
    goToNextPage: () => activePageRef.current?.goToNextPage(),
    setReadingMode: (v) => activePageRef.current?.setReadingMode(v),
    setBookletRightPage: (v) => activePageRef.current?.setBookletRightPage(v),
    toggleOcrBlankPage: () => activePageRef.current?.toggleOcrBlankPage(),
    toggleMarkdownAside: () => activePageRef.current?.toggleMarkdownAside(),
    setMarkdownMode: (mode) => activePageRef.current?.setMarkdownMode(mode),
    toggleSentenceTree: () => activePageRef.current?.toggleSentenceTree(),
    setNotebookView: (mode) => activePageRef.current?.setNotebookView(mode),
    closeNotebook: () => activePageRef.current?.closeNotebook(),
    setSearchOpen: (value) => activePageRef.current?.setSearchOpen(value),
    setSearchQuery: (value) => activePageRef.current?.setSearchQuery(value),
    runSearch: (query) => activePageRef.current?.runSearch(query),
    goToSearchMatch: (direction) => activePageRef.current?.goToSearchMatch(direction),
    closeSearch: () => activePageRef.current?.closeSearch(),
    insertBlankPageAfterCurrent: () => activePageRef.current?.insertBlankPageAfterCurrent(),
    toggleOutline: () => activePageRef.current?.toggleOutline(),
    openDocumentNavigator: (view) => activePageRef.current?.openDocumentNavigator(view),
    buildPageConcepts: () => activePageRef.current?.buildPageConcepts(),
    toggleGlyphCharAside: () => activePageRef.current?.toggleGlyphCharAside(),
    toggleBookmark: () => activePageRef.current?.toggleBookmark(),
    toggleSmartVideo: () => activePageRef.current?.toggleSmartVideo(),
    toggleEntityBuilder: () => activePageRef.current?.toggleEntityBuilder(),
    toggleAbbreviationPanel: () => activePageRef.current?.toggleAbbreviationPanel(),
  } : null;
  const zoomControls = activeId ? {
    ...zoomState,
    zoomOut: () => activePageRef.current?.zoomOut?.(),
    zoomIn: () => activePageRef.current?.zoomIn?.(),
    resetZoom: () => activePageRef.current?.resetZoom?.(),
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
    <div id="pdfw_root" ref={rootRef}>
      <div id="pdfw_entity_builder_host" ref={setEntityBuilderHostEl} />
      <div id="pdfw_main" className={[
        pageNav?.glyphCharAsideOpen,
        pageNav?.entityBuilderOpen,
        pageNav?.abbreviationPanelOpen,
        pageNav?.sentenceTreeOpen,
        pageNav?.smartVideoActive,
        pageNav?.markdownOpen,
        pageNav?.notebookOpen,
        pageNav?.outlineOpen,
      ].some(Boolean) ? "pdfw_main--function-open" : undefined}>
        <div id="pdfw_header">
          <PDFReaderWorkspaceTabStrip
            tabs={tabs}
            setTabs={setTabs}
            activeId={activeId}
            setActiveId={setActiveId}
            tabTypes={tabTypes}
            splitModeOn={splitModeOn}
            checkedIds={checkedIds}
            onToggleCheck={onToggleCheck}
            pageNav={pageNav}
            onToggleSplit={toggleSplitMode}
            annotationSaveStatus={annotationSaveStatus}
            onBack={() => navigate("/home")}
          />
        </div>

        <div id="pdfw_panes" className={`${panesToShow.length > 1 ? "pdfw_panes--split " : ""}${layer1Only ? "pdfw_panes--layer1-only" : ""}`}>
          <div id="pdfw_toolbar_host" ref={setToolbarHostEl} aria-label="Annotation tools" />
          {panesToShow.map((tab, i) => (
            <div className="pdfw_pane" key={tab?.id ?? `empty_${i}`}>
              <PaneBody
                tab={tab}
                onTabTypeChange={onTabTypeChange}
                isActive={Boolean(tab) && tab.id === activeId}
                pdfPageRef={activePageRef}
                onUndoRedoStateChange={setUndoRedoState}
                onPageNavStateChange={setPageNavState}
              onZoomStateChange={setZoomState}
              onAnnotationSaveStateChange={setAnnotationSaveStatus}
              toolbarLeading={<ReaderAnnotationActions undoRedo={undoRedo} pageNav={pageNav} />}
              toolbarHost={toolbarHostEl}
              textToolbarOptionsHost={textToolbarOptionsHostEl}
                entityBuilderHost={entityBuilderHostEl}
                markdownHost={markdownHostEl}
                markdownHostRef={setMarkdownHostEl}
                onLayer1OnlyChange={onLayer1OnlyChange}
              />
            </div>
          ))}
        </div>
        <div id="pdfw_text_subtoolbar_host" ref={setTextToolbarOptionsHostEl} aria-label="Annotation tool options" />
        <div id="pdfw_keyboard_slot" aria-label="PDF text input keyboard">
          <VirtualKeyboard inline autoOpenOnFocus openOnCommand showToggle={false} panelPortalId="pdfw_keyboard_slot" predictionPortalId="pdfw_footer_predictions" panelClassName="pdfw_virtual_keyboard" />
        </div>
        {activeId && (
          <footer id="pdfw_footer" aria-label="PDF Reader status and predictions">
            <ServiceStatusFooter containerId="pdfw_footer_services" />
            <div id="pdfw_footer_predictions" aria-label="Prediction suggestions" />
          </footer>
        )}
      </div>
    </div>
  );
};

export default PDFReaderWorkspace;
