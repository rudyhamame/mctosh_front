import React, { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { apiUrl } from "../config/api";
import { readStoredSession } from "../utils/sessionCleanup";
import PDFPage, { PDF_TYPE_ICON } from "./PDFPage";
import "./pdfReaderWorkspace.css";

const BackArrowIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="2 2 20 20" aria-hidden="true">
    <path d="M16.46 4.11a1 1 0 0 0-1.04.07l-10 7a.997.997 0 0 0 0 1.64l10 7c.17.12.37.18.57.18a.997.997 0 0 0 1-1V5c0-.37-.21-.71-.54-.89ZM15 17.08 7.74 12 15 6.92z" />
  </svg>
);

const authFetch = (url, options = {}) => {
  const token = readStoredSession()?.token || "";
  return fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` },
  });
};

const makeTab = (sourceId, name, page = null) => ({
  id: `${sourceId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
  sourceId,
  name: name || "Untitled",
  page,
});

// The single tab strip + "open a document" picker, in the header. There's
// only ever one set of tabs — split view (see PDFReaderWorkspace below)
// shows several of these same tabs' pages in parallel rather than owning a
// second, independent set of tabs. Tabs are deliberately lightweight
// "quick-switch shortcuts" — PDFPage remounts fresh on every tab switch
// (via the `key` prop where it's rendered) rather than preserving each
// tab's page position/zoom/in-progress annotations.
const TabStrip = ({
  tabs, setTabs, activeId, setActiveId, tabTypes, splitModeOn, checkedIds, onToggleCheck,
  undoRedo, pageNav,
}) => {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sources, setSources] = useState([]);
  const [loadingSources, setLoadingSources] = useState(false);
  const pickerRef = useRef(null);

  useEffect(() => {
    if (!pickerOpen) return;
    setLoadingSources(true);
    authFetch(apiUrl("/api/sources"))
      .then((r) => r.json())
      .then((data) => setSources((data.sources || []).filter((s) => s.type !== "youtube")))
      .catch(() => setSources([]))
      .finally(() => setLoadingSources(false));
  }, [pickerOpen]);

  useEffect(() => {
    if (!pickerOpen) return;
    const onDocClick = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) setPickerOpen(false);
    };
    // Deferred by a tick so this listener can never react to the same click
    // that just set pickerOpen true (the "+" button's own mousedown/click) —
    // attaching it synchronously here occasionally raced that click and
    // closed the picker again immediately, which read as "needs several
    // clicks to open."
    const attachTimer = setTimeout(() => document.addEventListener("mousedown", onDocClick), 0);
    return () => {
      clearTimeout(attachTimer);
      document.removeEventListener("mousedown", onDocClick);
    };
  }, [pickerOpen]);

  const openTab = useCallback((sourceId, name) => {
    const tab = makeTab(sourceId, name);
    setTabs((prev) => [...prev, tab]);
    setActiveId(tab.id);
    setPickerOpen(false);
  }, [setTabs, setActiveId]);

  const closeTab = useCallback((e, tabId) => {
    e.stopPropagation();
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== tabId);
      setActiveId((curActive) => (tabId === curActive ? (next[next.length - 1]?.id ?? null) : curActive));
      return next;
    });
  }, [setTabs, setActiveId]);

  return (
    <div className="pdfw_tabbar">
      {/* Three explicit grid columns (see pdfReaderWorkspace.css) instead
          of one flex row — a single row can't genuinely CENTER page-nav
          against the tab strip's own variable, scrollable width; a
          1fr/auto/1fr grid keeps the center column mathematically
          centered in the bar regardless of tab count or whether
          undo/redo is even rendered. */}
      <div className="pdfw_tabbar_left">
        <div className="pdfw_tabstrip">
          {tabs.map((t) => (
            <button
              key={t.id}
              className={`pdfw_tab${t.id === activeId ? " pdfw_tab--active" : ""}`}
              onClick={() => setActiveId(t.id)}
              title={t.name}
            >
              {splitModeOn && (
                <span
                  className="pdfw_tab_check"
                  onClick={(e) => { e.stopPropagation(); onToggleCheck(t.id); }}
                >
                  <i className={checkedIds.includes(t.id) ? "bxf bx-checkbox-checked" : "bx bx-checkbox"} />
                </span>
              )}
              <span className="pdfw_tab_label">{t.name}</span>
              {tabTypes?.[t.id] && (
                <i
                  className={`${PDF_TYPE_ICON[tabTypes[t.id]]} pdfw_tab_type`}
                  title={tabTypes[t.id]}
                />
              )}
              <span className="pdfw_tab_close" onClick={(e) => closeTab(e, t.id)}>
                <i className="bx bx-x" />
              </span>
            </button>
          ))}
        </div>

        {/* Deliberately a sibling of .pdfw_tabstrip, not a child — the strip
            scrolls horizontally (overflow-x: auto), and per the CSS overflow
            spec that also computes overflow-y to auto, which would clip the
            picker popover below since it renders outside the strip's own
            bounding box. Living outside the scroll container avoids that
            entirely instead of fighting it with overflow-y: visible (which
            the spec doesn't allow to survive next to overflow-x: auto). */}
        <div className="pdfw_tab_add_wrap" ref={pickerRef}>
          <button className="pdfw_tab_add" onClick={() => setPickerOpen((v) => !v)} title="Open a document in a new tab">
            <i className="bx bx-plus" />
          </button>
          {pickerOpen && (
            <div className="pdfw_picker">
              <select
                className="pdfw_picker_select"
                autoFocus
                value=""
                disabled={loadingSources || sources.length === 0}
                onChange={(e) => {
                  const s = sources.find((src) => src._id === e.target.value);
                  if (s) openTab(s._id, s.name);
                }}
              >
                <option value="" disabled>
                  {loadingSources ? "Loading…" : sources.length === 0 ? "No sources available" : "Select a source…"}
                </option>
                {sources.map((s) => (
                  <option key={s._id} value={s._id}>{s.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Hoisted here from PDFPage's own toolbar (see hidePageNav prop on
          the active tab's PDFPage instance below) — one row for whichever
          tab is active, instead of one per open tab/pane. Always rendered
          (even when empty) so it keeps its own grid column and stays the
          true center regardless of whether a document with pages is open. */}
      <div className="pdfw_tabbar_center">
        {pageNav && pageNav.pageCount > 0 && (
          <div id="pdf_page_nav" className="pdfw_page_nav_group">
            <button onClick={pageNav.goToPrevPage} disabled={pageNav.pageNum <= 1 || pageNav.disabled} title="Previous page">‹</button>
            <span id="pdf_page_nav_label">{pageNav.pageNum} / {pageNav.pageCount}</span>
            <button onClick={pageNav.goToNextPage} disabled={pageNav.pageNum >= pageNav.pageCount || pageNav.disabled} title="Next page">›</button>
          </div>
        )}
      </div>

      {/* Hoisted here from PDFPage's own toolbar (see hideUndoRedo prop on
          the active tab's PDFPage instance below) — one row for whichever
          tab is active, instead of one per open tab/pane. Always rendered
          (even when empty) so it keeps its own grid column, matching the
          center column's own reasoning above. */}
      <div className="pdfw_tabbar_right">
        {undoRedo && (
          <div id="pdf_annot_right_group" className="pdfw_undo_redo_group">
            <div id="pdf_annot_actions">
              <button className="annot_action_btn" onClick={undoRedo.undo} title="Undo last" disabled={!undoRedo.canUndo}><i className="bx bx-undo" /></button>
              {undoRedo.hasHistory && (
                <button
                  className={`annot_action_btn${undoRedo.historyOpen ? " annot_action_btn--active" : ""}`}
                  onClick={undoRedo.toggleHistory}
                  title="Annotation History — every step taken this session"
                >
                  <i className="bx bx-history" />
                </button>
              )}
              <button className="annot_action_btn" onClick={undoRedo.redo} title="Redo" disabled={!undoRedo.canRedo}><i className="bx bx-redo" /></button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

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
const PaneBody = ({ tab, onTabTypeChange, isActive, pdfPageRef, onUndoRedoStateChange, onPageNavStateChange }) => (
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
  const initial = location.state || {};

  const [tabs, setTabs] = useState(() => (initial.sourceId ? [makeTab(initial.sourceId, initial.pdfName, initial.page)] : []));
  // Safe to read tabs here: useState initializers run once, synchronously,
  // in declaration order on mount — tabs is already set by the time this line runs.
  const [activeId, setActiveId] = useState(() => tabs[0]?.id ?? null);

  // Handles every navigation TO this route AFTER the initial mount (e.g. a
  // Medical Exams page-link clicked while the reader is already open) — the
  // useState initializer above only ever runs once, so a second `navigate()`
  // with new state while this component stays mounted needs its own effect.
  // location.key is unique per history entry, so it fires exactly once per
  // distinct navigation (including the first one, harmlessly re-opening the
  // same tab the initializer already created — mount order in React
  // guarantees the initializer above ran first).
  const lastLocationKeyRef = useRef(location.key);
  useEffect(() => {
    if (lastLocationKeyRef.current === location.key) return;
    lastLocationKeyRef.current = location.key;
    const { sourceId, pdfName, page } = location.state || {};
    if (!sourceId) return;
    const tab = makeTab(sourceId, pdfName, page);
    setTabs((prev) => [...prev, tab]);
    setActiveId(tab.id);
  }, [location.key, location.state]);

  // Split view has no pane of its own to open — it shows several of the
  // *same* open tabs' pages in parallel. The button only appears once
  // there's more than one tab to actually split between; clicking it just
  // reveals a checkbox on each tab, and checking two or more is what makes
  // their pages render side by side (no extra toolbars added).
  const [splitModeOn, setSplitModeOn] = useState(false);
  const [checkedIds, setCheckedIds] = useState([]);

  const toggleSplitMode = useCallback(() => {
    setSplitModeOn((on) => {
      if (on) setCheckedIds([]); // turning split mode off resets back to single view
      return !on;
    });
  }, []);

  const onToggleCheck = useCallback((tabId) => {
    setCheckedIds((prev) => (prev.includes(tabId) ? prev.filter((id) => id !== tabId) : [...prev, tabId]));
  }, []);

  useEffect(() => {
    // A closed tab can't stay checked, and split mode with nothing left
    // open isn't meaningful — both just fall back to single view.
    setCheckedIds((prev) => prev.filter((id) => tabs.some((t) => t.id === id)));
    if (tabs.length <= 1) { setSplitModeOn(false); setCheckedIds([]); }
  }, [tabs]);

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
  const [undoRedoState, setUndoRedoState] = useState({ canUndo: false, canRedo: false, hasHistory: false, historyOpen: false });
  useEffect(() => { setUndoRedoState({ canUndo: false, canRedo: false, hasHistory: false, historyOpen: false }); }, [activeId]);
  const undoRedo = activeId ? {
    ...undoRedoState,
    undo: () => activePageRef.current?.undo(),
    redo: () => activePageRef.current?.redo(),
    toggleHistory: () => activePageRef.current?.toggleHistory(),
  } : null;

  // Same pattern as undoRedo above, for the prev/page-number/next row.
  const [pageNavState, setPageNavState] = useState({ pageNum: 1, pageCount: 0, disabled: false });
  useEffect(() => { setPageNavState({ pageNum: 1, pageCount: 0, disabled: false }); }, [activeId]);
  const pageNav = activeId ? {
    ...pageNavState,
    goToPrevPage: () => activePageRef.current?.goToPrevPage(),
    goToNextPage: () => activePageRef.current?.goToNextPage(),
  } : null;

  return (
    <div id="pdfw_root">
      <div id="pdfw_header">
        <button id="pdfw_back" onClick={() => navigate("/home")} title="Back to Home">
          <BackArrowIcon />
        </button>
        <TabStrip
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
        />
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
            />
          </div>
        ))}
      </div>
    </div>
  );
};

export default PDFReaderWorkspace;
