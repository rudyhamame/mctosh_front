import React, { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { apiUrl } from "../config/api";
import { readStoredSession } from "../utils/sessionCleanup";
import PDFPage, { PDF_TYPE_ICON } from "./PDFPage";
import "./pdfReaderWorkspace.css";

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
const TabStrip = ({ tabs, setTabs, activeId, setActiveId, tabTypes, splitModeOn, checkedIds, onToggleCheck }) => {
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
  );
};

// One tab's page, rendered as its own pane — no per-pane toolbar or tab
// strip of its own; split view is just N of these side by side, driven
// entirely by which tabs are checked in the single shared TabStrip above.
const PaneBody = ({ tab, onTabTypeChange }) => (
  <div className="pdfw_pane_body">
    {tab ? (
      <PDFPage
        key={tab.id}
        embeddedSourceId={tab.sourceId}
        embeddedPdfName={tab.name}
        embeddedHomePath="/home"
        homeLabel="Home"
        hideHyleControls
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

  return (
    <div id="pdfw_root">
      <div id="pdfw_header">
        <button id="pdfw_back" onClick={() => navigate("/home")} title="Back to Home">
          <i className="bx bx-arrow-back" />
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
            <PaneBody tab={tab} onTabTypeChange={onTabTypeChange} />
          </div>
        ))}
      </div>
    </div>
  );
};

export default PDFReaderWorkspace;
