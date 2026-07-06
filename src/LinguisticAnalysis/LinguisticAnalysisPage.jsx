import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { apiUrl } from "../config/api";
import { readStoredSession } from "../utils/sessionCleanup";
import { LINGUISTIC_UNITS } from "../Linguistics/linguisticUnits";
import AIProviderSelect from "../App/AIProviderSelect";
import { useAIProvider } from "../hooks/useAIProvider";
import { useLongPressSelect } from "../utils/longPressSelect";
import "./linguisticAnalysisPage.css";

const authFetch = (url, options = {}) => {
  const token = readStoredSession()?.token || "";
  return fetch(url, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` } });
};

const PREVIEW_CONTEXT = 60;

const normalizeWhitespace = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();

const buildSearchIndex = (value) => {
  const source = String(value || "");
  let normalized = "";
  const map = [];
  let pendingSpace = false;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (/\s/.test(ch)) {
      if (normalized) pendingSpace = true;
      continue;
    }
    if (pendingSpace) {
      normalized += " ";
      map.push(i);
      pendingSpace = false;
    }
    normalized += ch.toLowerCase();
    map.push(i);
  }

  return { normalized, map };
};

const findOriginalRange = (index, needle, normalizedStart = 0) => {
  const normalizedNeedle = normalizeWhitespace(needle);
  if (!normalizedNeedle) return null;

  const normIndex = index.normalized.indexOf(normalizedNeedle, normalizedStart);
  if (normIndex === -1) return null;

  const origStart = index.map[normIndex];
  const origEnd = index.map[normIndex + normalizedNeedle.length - 1] + 1;
  return { normalizedStart: normIndex, normalizedEnd: normIndex + normalizedNeedle.length, start: origStart, end: origEnd };
};

const buildPageRanges = (pages) => {
  let cursor = 0;
  return (pages || []).map((page, idx) => {
    const start = cursor;
    const end = start + String(page.markdown || "").length;
    cursor = end + (idx < pages.length - 1 ? 2 : 0);
    return { pageNumber: page.pageNumber, start, end };
  });
};

const findPageByOffset = (pageRanges, offset) => {
  if (!pageRanges.length) return null;
  return pageRanges.find((page) => offset >= page.start && offset < page.end) || pageRanges[pageRanges.length - 1];
};

const deriveUnitRecords = ({ classification, pageText, pages, pageRangeFrom, pageRangeTo }) => {
  const tags = [];
  const fullIndex = buildSearchIndex(pageText);
  const pageRanges = buildPageRanges(pages);
  const searchStarts = new Map();

  for (const [unitType, items] of Object.entries(classification || {})) {
    (items || []).forEach((text, order) => {
      const normalizedText = normalizeWhitespace(text);
      const searchKey = `${unitType}::${normalizedText}`;
      const firstTry = findOriginalRange(fullIndex, text, searchStarts.get(searchKey) || 0);
      const match = firstTry || findOriginalRange(fullIndex, text, 0);

      if (match) searchStarts.set(searchKey, match.normalizedEnd);

      const startPage = match ? findPageByOffset(pageRanges, match.start) : null;
      const endPage = match ? findPageByOffset(pageRanges, Math.max(match.start, match.end - 1)) : null;
      const originText = match ? pageText.slice(match.start, match.end) : "";

      tags.push({
        id: `${unitType}-${order}-${normalizedText || tags.length}`,
        unit: unitType,
        unitType,
        text,
        normalizedText,
        order,
        pageRangeFrom,
        pageRangeTo,
        originResolved: Boolean(match),
        originText,
        contextBefore: match ? pageText.slice(Math.max(0, match.start - PREVIEW_CONTEXT), match.start) : "",
        contextAfter: match ? pageText.slice(match.end, Math.min(pageText.length, match.end + PREVIEW_CONTEXT)) : "",
        globalStart: match ? match.start : null,
        globalEnd: match ? match.end : null,
        originPageFrom: startPage?.pageNumber ?? null,
        originPageTo: endPage?.pageNumber ?? null,
        pageStartOffset: match && startPage ? match.start - startPage.start : null,
        pageEndOffset: match && endPage ? match.end - endPage.start : null,
      });
    });
  }

  return tags;
};

const mapStoredUnit = (unit) => ({
  id: unit._id,
  unit: unit.unitType,
  unitType: unit.unitType,
  text: unit.text,
  normalizedText: unit.normalizedText || normalizeWhitespace(unit.text),
  order: unit.order || 0,
  pageRangeFrom: unit.pageRangeFrom,
  pageRangeTo: unit.pageRangeTo,
  originResolved: Boolean(unit.originResolved),
  originText: unit.originText || "",
  contextBefore: unit.contextBefore || "",
  contextAfter: unit.contextAfter || "",
  globalStart: Number.isFinite(unit.globalStart) ? unit.globalStart : null,
  globalEnd: Number.isFinite(unit.globalEnd) ? unit.globalEnd : null,
  originPageFrom: Number.isFinite(unit.originPageFrom) ? unit.originPageFrom : null,
  originPageTo: Number.isFinite(unit.originPageTo) ? unit.originPageTo : null,
  pageStartOffset: Number.isFinite(unit.pageStartOffset) ? unit.pageStartOffset : null,
  pageEndOffset: Number.isFinite(unit.pageEndOffset) ? unit.pageEndOffset : null,
});

const LinguisticAnalysisPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { provider, setProvider } = useAIProvider();
  // Read-only preview text — selection only turns on after a long press.
  const previewTextRef = useRef(null);
  useLongPressSelect(previewTextRef);

  const [sources,        setSources]        = useState([]);
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [selectedId,     setSelectedId]     = useState(null);
  const [rangeFrom,      setRangeFrom]      = useState(1);
  const [rangeTo,        setRangeTo]        = useState(1);
  const [rangeAll,       setRangeAll]       = useState(false);
  const [pageText,       setPageText]       = useState("");
  const [pageSlices,     setPageSlices]     = useState([]);
  const [pageTextLoading, setPageTextLoading] = useState(false);
  const [pageTextError,  setPageTextError]  = useState("");
  const [tags,           setTags]           = useState([]);
  const [tagsLoading,    setTagsLoading]    = useState(false);
  const [activeTagId,    setActiveTagId]    = useState(null);
  const [classifying,    setClassifying]    = useState(false);
  const [classifyErr,    setClassifyErr]    = useState("");

  const selectedSource = sources.find((s) => s._id === selectedId) || null;
  const effectiveRangeFrom = rangeAll ? 1 : rangeFrom;
  const effectiveRangeTo = rangeAll ? (selectedSource?.pageCount || 1) : rangeTo;
  const activeTag = useMemo(() => tags.find((tag) => tag.id === activeTagId) || null, [tags, activeTagId]);

  // Left column: every source that already has a cached Markdown conversion
  useEffect(() => {
    setSourcesLoading(true);
    authFetch(apiUrl("/api/sources/with-markdown"))
      .then((r) => r.json())
      .then((d) => setSources(d.sources || []))
      .finally(() => setSourcesLoading(false));
  }, []);

  // Arriving from the PDF Reader's Actions → Linguistic Analysis picker —
  // pre-select the source and the page range it asked for.
  useEffect(() => {
    const { sourceId, rangeFrom: f, rangeTo: t, rangeAll: all } = location.state || {};
    if (!sourceId) return;
    setSelectedId(sourceId);
    setRangeFrom(f || 1);
    setRangeTo(t || f || 1);
    setRangeAll(Boolean(all));
  }, [location.state]);

  const selectSource = useCallback((source) => {
    setSelectedId(source._id);
    setRangeFrom(1);
    setRangeTo(1);
    setRangeAll(false);
    setTags([]);
    setActiveTagId(null);
    setClassifyErr("");
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedId(null);
    setPageText("");
    setPageSlices([]);
    setPageTextError("");
    setTags([]);
    setActiveTagId(null);
    setClassifyErr("");
  }, []);

  // Fetch the selected range's already-converted Markdown whenever selection/range changes
  useEffect(() => {
    if (!selectedId) {
      setPageText("");
      setPageSlices([]);
      return;
    }
    setPageTextLoading(true);
    setPageTextError("");
    setActiveTagId(null);
    const query = rangeAll
      ? "?from=1&to=" + encodeURIComponent(selectedSource?.pageCount || 1) + "&includePages=1"
      : `?from=${effectiveRangeFrom}&to=${effectiveRangeTo}&includePages=1`;
    authFetch(apiUrl(`/api/sources/${selectedId}/markdown${query}`))
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "Failed to load this range.");
        setPageText(data.markdown || "");
        setPageSlices(Array.isArray(data.pages) ? data.pages : []);
      })
      .catch((e) => setPageTextError(e.message))
      .finally(() => setPageTextLoading(false));
  }, [selectedId, selectedSource?.pageCount, effectiveRangeFrom, effectiveRangeTo, rangeAll]);

  useEffect(() => {
    if (!selectedId || !selectedSource) {
      setTags([]);
      return;
    }

    setTagsLoading(true);
    setActiveTagId(null);
    authFetch(apiUrl(`/api/linguistic-units?sourceId=${selectedId}&from=${effectiveRangeFrom}&to=${effectiveRangeTo}`))
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "Failed to load saved linguistic units.");
        setTags((data.units || []).map(mapStoredUnit));
      })
      .catch(() => setTags([]))
      .finally(() => setTagsLoading(false));
  }, [selectedId, selectedSource, effectiveRangeFrom, effectiveRangeTo]);

  useEffect(() => {
    if (!activeTag?.originResolved) return;
    const hit = document.getElementById("la_preview_active_hit");
    if (hit) hit.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeTag, pageText]);

  const handleClassify = useCallback(async () => {
    if (!pageText.trim() || classifying || !selectedSource) return;
    setClassifying(true);
    setClassifyErr("");
    try {
      const res = await authFetch(apiUrl("/api/youtube/classify-units"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: pageText, provider }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Classification failed.");
      const nextTags = deriveUnitRecords({
        classification: data,
        pageText,
        pages: pageSlices,
        pageRangeFrom: effectiveRangeFrom,
        pageRangeTo: effectiveRangeTo,
      });

      const saveRes = await authFetch(apiUrl("/api/linguistic-units/bulk"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceId: selectedId,
          sourceName: selectedSource.name,
          pageRangeFrom: effectiveRangeFrom,
          pageRangeTo: effectiveRangeTo,
          pageCount: selectedSource.pageCount,
          analysisProvider: provider,
          units: nextTags.map((tag) => ({
            unitType: tag.unitType,
            text: tag.text,
            normalizedText: tag.normalizedText,
            order: tag.order,
            originResolved: tag.originResolved,
            originText: tag.originText,
            contextBefore: tag.contextBefore,
            contextAfter: tag.contextAfter,
            globalStart: tag.globalStart,
            globalEnd: tag.globalEnd,
            originPageFrom: tag.originPageFrom,
            originPageTo: tag.originPageTo,
            pageStartOffset: tag.pageStartOffset,
            pageEndOffset: tag.pageEndOffset,
          })),
        }),
      });
      const saved = await saveRes.json();
      if (!saveRes.ok) throw new Error(saved.error || "Classification saved locally, but persistence failed.");

      const savedTags = (saved.units || []).map(mapStoredUnit);
      setTags(savedTags);
      setActiveTagId(savedTags.find((tag) => tag.originResolved)?.id || null);
    } catch (e) {
      setClassifyErr(e.message);
    } finally {
      setClassifying(false);
    }
  }, [
    classifying,
    effectiveRangeFrom,
    effectiveRangeTo,
    pageSlices,
    pageText,
    provider,
    selectedId,
    selectedSource,
  ]);

  const previewContent = useMemo(() => {
    if (!activeTag?.originResolved || !Number.isFinite(activeTag.globalStart) || !Number.isFinite(activeTag.globalEnd)) {
      return pageText;
    }

    const start = Math.max(0, activeTag.globalStart);
    const end = Math.min(pageText.length, activeTag.globalEnd);

    return (
      <>
        {pageText.slice(0, start)}
        <mark id="la_preview_active_hit">{pageText.slice(start, end)}</mark>
        {pageText.slice(end)}
      </>
    );
  }, [activeTag, pageText]);

  return (
    <div id="la_page">
      <div id="la_header">
        <button id="la_back_btn" onClick={() => navigate("/home")}>←</button>
        <span id="la_title">Clinical Linguistic Analysis</span>
        <AIProviderSelect provider={provider} setProvider={setProvider} disabled={classifying} />
      </div>

      <div id="la_body">
        {/* Left — source list until selection, then selected markdown text */}
        <div id="la_sources">
          {!selectedSource ? (
            <>
              <div id="la_sources_label">Stored Markdowns</div>
              <div id="la_sources_scroll">
                {sourcesLoading ? (
                  <p className="la_muted">Loading…</p>
                ) : sources.length === 0 ? (
                  <p className="la_muted">No sources have a stored Markdown yet — open one in the PDF Reader and use its MD button first.</p>
                ) : (
                  sources.map((s) => (
                    <button
                      key={s._id}
                      className={`la_source_row${selectedId === s._id ? " la_source_row--active" : ""}`}
                      onClick={() => selectSource(s)}
                    >
                      <span className="la_source_name">{s.name}</span>
                      <span className="la_source_pages">{s.pageCount} page{s.pageCount === 1 ? "" : "s"}</span>
                    </button>
                  ))
                )}
              </div>
            </>
          ) : (
            <>
              <div id="la_preview_header">
                <button id="la_preview_back" onClick={clearSelection}>← Markdowns</button>
                <span id="la_preview_title">{selectedSource.name}</span>
              </div>
              <div id="la_preview_body">
                {pageTextLoading ? (
                  <p className="la_muted">Loading page text…</p>
                ) : pageTextError ? (
                  <p className="la_muted la_error_text">⚠ {pageTextError}</p>
                ) : pageText.trim() ? (
                  <pre id="la_preview_text" ref={previewTextRef}>{previewContent}</pre>
                ) : (
                  <p className="la_muted">No stored markdown text is available for this selection.</p>
                )}
              </div>
            </>
          )}
        </div>

        {/* Right — page picker + linguistic units table */}
        <div id="la_main">
          {!selectedSource ? (
            <div id="la_empty">
              <span id="la_empty_icon">📄</span>
              <p>Pick a source on the left to analyze its language.</p>
            </div>
          ) : (
            <>
              <div id="la_page_bar">
                <span id="la_page_source_name">{selectedSource.name}</span>
                <label id="la_range_all_row">
                  <input type="checkbox" checked={rangeAll} onChange={(e) => setRangeAll(e.target.checked)} />
                  All Pages ({selectedSource.pageCount})
                </label>
                {!rangeAll && (
                  <div id="la_range_inputs">
                    <label>
                      From
                      <input type="number" min={1} max={selectedSource.pageCount} value={rangeFrom} onChange={(e) => setRangeFrom(Math.max(1, Math.min(selectedSource.pageCount, Number(e.target.value) || 1)))} />
                    </label>
                    <label>
                      To
                      <input type="number" min={1} max={selectedSource.pageCount} value={rangeTo} onChange={(e) => setRangeTo(Math.max(1, Math.min(selectedSource.pageCount, Number(e.target.value) || 1)))} />
                    </label>
                  </div>
                )}
                <button
                  id="la_classify_btn"
                  onClick={handleClassify}
                  disabled={!pageText.trim() || classifying || pageTextLoading}
                  title="Classify the selected range's morphemes, words, syntagms, clauses, sentences and paragraphs"
                >
                  {classifying ? "Analyzing…" : "Analyze"}
                </button>
                {tags.length > 0 && <button className="la_clear_btn" onClick={() => { setTags([]); setActiveTagId(null); }}>Hide</button>}
              </div>
              {classifyErr && <p id="la_error">⚠ {classifyErr}</p>}

              <div id="la_table_wrap">
                {pageTextLoading ? (
                  <p className="la_muted">Loading page text…</p>
                ) : pageTextError ? (
                  <p className="la_muted la_error_text">⚠ {pageTextError}</p>
                ) : tagsLoading ? (
                  <p className="la_muted">Loading stored linguistic units…</p>
                ) : (
                  <div id="la_table_scroll">
                    <table id="la_table">
                      <thead>
                        <tr>
                          {LINGUISTIC_UNITS.map((u) => {
                            const count = tags.filter((t) => t.unit === u.id).length;
                            return (
                              <th key={u.id} style={{ "--lu-color": u.color }}>
                                <span className="la_unit_pill" style={{ "--lu-color": u.color }}>{u.label}</span>
                                <span className="la_th_desc">{u.desc}</span>
                                {count > 0 && <span className="la_th_count">{count}</span>}
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {(() => {
                          const cols = LINGUISTIC_UNITS.map((u) => tags.filter((t) => t.unit === u.id));
                          const rowCount = Math.max(1, ...cols.map((c) => c.length));
                          return Array.from({ length: rowCount }, (_, i) => (
                            <tr key={i}>
                            {LINGUISTIC_UNITS.map((u, ci) => {
                              const tag = cols[ci][i];
                              return (
                                <td key={u.id} className="la_td_cell">
                                  {tag ? (
                                    <button
                                      type="button"
                                      className={`la_tag la_tag_btn${activeTagId === tag.id ? " la_tag_btn--active" : ""}`}
                                      style={{ "--lu-color": u.color }}
                                      onClick={() => tag.originResolved && setActiveTagId(tag.id)}
                                      disabled={!tag.originResolved}
                                      title={tag.originResolved
                                        ? `Jump to ${tag.originPageFrom === tag.originPageTo || !tag.originPageTo ? `page ${tag.originPageFrom}` : `pages ${tag.originPageFrom}-${tag.originPageTo}`}`
                                        : "No origin reference could be resolved for this unit."}
                                    >
                                      <span>{tag.text}</span>
                                      {tag.originResolved && (
                                        <span className="la_tag_ref">
                                          p{tag.originPageFrom}{tag.originPageTo && tag.originPageTo !== tag.originPageFrom ? `-${tag.originPageTo}` : ""}
                                        </span>
                                      )}
                                    </button>
                                  ) : null}
                                </td>
                              );
                            })}
                          </tr>
                          ));
                        })()}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default LinguisticAnalysisPage;
