import { useCallback, useEffect, useRef, useState } from "react";

const PDF_READER_LAST_TAB_KEY = "pdf_reader_last_tab_v1";

export const DEFAULT_UNDO_REDO_STATE = {
  canUndo: false,
  canRedo: false,
  hasHistory: false,
  historyOpen: false,
  activeSurface: "pdf",
};

export const DEFAULT_PAGE_NAV_STATE = {
  pageNum: 1,
  pageCount: 0,
  disabled: false,
  readingMode: "single",
  bookletRightPage: null,
  searchOpen: false,
  searchQuery: "",
  searchMatchCount: 0,
  searchActiveIndex: -1,
  searchScanning: false,
  searchActiveMatchType: null,
  searchActiveConfidence: null,
  searchActiveMatchedText: null,
};

export const DEFAULT_ZOOM_STATE = {
  zoom: 1,
  percent: 100,
  canZoomOut: true,
  canZoomIn: true,
  disabled: false,
};

const safeSessionStorage = () => {
  if (typeof window === "undefined" || !window.sessionStorage) return null;
  return window.sessionStorage;
};

const sanitizeReaderTabSnapshot = (value) => {
  if (!value || typeof value.sourceId !== "string" || !value.sourceId.trim()) return null;
  return {
    sourceId: value.sourceId,
    pdfName: typeof value.pdfName === "string" && value.pdfName.trim() ? value.pdfName : "Untitled",
    page: Number.isFinite(value.page) ? value.page : null,
  };
};

export const createReaderTab = (sourceId, name, page = null) => ({
  id: `${sourceId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
  sourceId,
  name: name || "Untitled",
  page,
});

export const readStoredReaderTab = () => {
  try {
    const storage = safeSessionStorage();
    const raw = storage?.getItem(PDF_READER_LAST_TAB_KEY);
    if (!raw) return null;
    return sanitizeReaderTabSnapshot(JSON.parse(raw));
  } catch {
    return null;
  }
};

export const storeReaderTab = (tab) => {
  try {
    const storage = safeSessionStorage();
    if (!storage) return;
    const snapshot = sanitizeReaderTabSnapshot(tab);
    if (!snapshot) {
      storage.removeItem(PDF_READER_LAST_TAB_KEY);
      return;
    }
    storage.setItem(PDF_READER_LAST_TAB_KEY, JSON.stringify(snapshot));
  } catch {
    // best-effort persistence only
  }
};

const readInitialReaderSnapshot = (locationState) => {
  const navSnapshot = sanitizeReaderTabSnapshot(locationState || {});
  return navSnapshot || readStoredReaderTab() || {};
};

export const usePdfReaderWorkspaceState = ({ locationKey, locationState }) => {
  const initialSnapshot = readInitialReaderSnapshot(locationState);
  const [tabs, setTabs] = useState(() => (
    initialSnapshot.sourceId
      ? [createReaderTab(initialSnapshot.sourceId, initialSnapshot.pdfName, initialSnapshot.page)]
      : []
  ));
  const [activeId, setActiveId] = useState(() => tabs[0]?.id ?? null);
  const [splitModeOn, setSplitModeOn] = useState(false);
  const [checkedIds, setCheckedIds] = useState([]);
  const lastLocationKeyRef = useRef(locationKey);

  useEffect(() => {
    if (lastLocationKeyRef.current === locationKey) return;
    lastLocationKeyRef.current = locationKey;
    const nextSource = sanitizeReaderTabSnapshot(locationState || {});
    if (!nextSource) return;
    const tab = createReaderTab(nextSource.sourceId, nextSource.pdfName, nextSource.page);
    setTabs((prev) => [...prev, tab]);
    setActiveId(tab.id);
  }, [locationKey, locationState]);

  const toggleSplitMode = useCallback(() => {
    setSplitModeOn((on) => {
      if (on) setCheckedIds([]);
      return !on;
    });
  }, []);

  const onToggleCheck = useCallback((tabId) => {
    setCheckedIds((prev) => (prev.includes(tabId) ? prev.filter((id) => id !== tabId) : [...prev, tabId]));
  }, []);

  useEffect(() => {
    setCheckedIds((prev) => prev.filter((id) => tabs.some((tab) => tab.id === id)));
    if (tabs.length <= 1) {
      setSplitModeOn(false);
      setCheckedIds([]);
    }
  }, [tabs]);

  return {
    tabs,
    setTabs,
    activeId,
    setActiveId,
    splitModeOn,
    toggleSplitMode,
    checkedIds,
    onToggleCheck,
  };
};
