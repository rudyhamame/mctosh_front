import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import "./segmentationsPage.css";
import { apiUrl } from "../config/api";
import { readStoredSession } from "../utils/sessionCleanup";
import { BBOX_CARD_TYPES, bboxTypeHas, getBBoxTypeDefinition } from "../PDF/pdfBBoxTypes";
import { extractMedicalStatements } from "./medicalStatementsExtraction";

// AMCTOSHS Segmentation — lists every "segment" (a content BBox, drawn
// and text-extracted in the PDF Reader — see PDF/EntityBuilderPanel.jsx,
// the same BBOX_CARD_TYPES source of truth) belonging to one source
// document in a left aside, one document at a time. Selecting a segment
// shows it in the main area with an "Extract Medical Statements" button;
// each AMCTOSHS Medical Statement mounts as its own line underneath once
// extracted. The extraction logic itself is a placeholder for now (see
// medicalStatementsExtraction.js) — this page only owns the shell: list,
// select, trigger, render one-per-line.

const authHeaders = () => {
  const token = readStoredSession()?.token || "";
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const isDocumentSource = (s) => (
  s && s.type !== "youtube" && s.type !== "podcast" && Boolean(s.key || s.parts?.length)
);

const segmentKeyFor = (pageNum, bboxId) => `${pageNum}::${bboxId}`;

const previewText = (text, max = 110) => {
  const flat = String(text || "").replace(/\s+/g, " ").trim();
  if (!flat) return "";
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

export default function SegmentationsPage() {
  const navigate = useNavigate();
  const location = useLocation();

  const [sources, setSources] = useState([]);
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [sourcesError, setSourcesError] = useState("");

  const [selectedSourceId, setSelectedSourceId] = useState(location.state?.sourceId || "");
  const [layers, setLayers] = useState({});
  const [annotationsLoading, setAnnotationsLoading] = useState(false);
  const [annotationsError, setAnnotationsError] = useState("");

  const [selectedSegmentKey, setSelectedSegmentKey] = useState(null);
  const [statementsBySegment, setStatementsBySegment] = useState({}); // { [key]: {status, statements, error} }
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(apiUrl("/api/sources/"), { headers: authHeaders() });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
        if (!cancelled) setSources(Array.isArray(data.sources) ? data.sources.filter(isDocumentSource) : []);
      } catch (err) {
        if (!cancelled) setSourcesError(err.message || "Could not load sources.");
      } finally {
        if (!cancelled) setSourcesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!selectedSourceId) { setLayers({}); return; }
    let cancelled = false;
    setAnnotationsLoading(true);
    setAnnotationsError("");
    setSelectedSegmentKey(null);
    (async () => {
      try {
        const res = await fetch(apiUrl(`/api/source-annotations/${selectedSourceId}`), { headers: authHeaders() });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
        if (!cancelled) setLayers(data.layers || {});
      } catch (err) {
        if (!cancelled) setAnnotationsError(err.message || "Could not load this source's segments.");
      } finally {
        if (!cancelled) setAnnotationsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedSourceId]);

  // Flattened, page-grouped list of content segments — the exact same
  // BBOX_CARD_TYPES filter (bbox, imageBBox) EntityBuilderPanel.jsx uses
  // to decide what's a real extracted-text/image segment vs. a container
  // or title BBox, which never carry their own text.
  const segmentGroups = useMemo(() => {
    const pageNums = Object.keys(layers)
      .map((n) => Number(n))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);

    return pageNums.map((pageNum) => {
      const pageSegments = (layers[pageNum] || [])
        .filter((bbox) => bbox && BBOX_CARD_TYPES.has(bbox.type))
        .map((bbox, index) => ({
          key: segmentKeyFor(pageNum, bbox.id),
          pageNum,
          bbox,
          index: index + 1,
          isImage: bboxTypeHas(bbox.type, "capturesImage"),
          typeLabel: getBBoxTypeDefinition(bbox.type)?.label || "Segment",
          displayTitle: bbox.title?.trim()
            || `${bboxTypeHas(bbox.type, "capturesImage") ? "Image BBox" : "BBox"} ${index + 1}`,
        }));
      return { pageNum, segments: pageSegments };
    }).filter((group) => group.segments.length > 0);
  }, [layers]);

  const totalSegments = segmentGroups.reduce((n, g) => n + g.segments.length, 0);

  const selectedSegment = useMemo(() => {
    for (const group of segmentGroups) {
      const hit = group.segments.find((s) => s.key === selectedSegmentKey);
      if (hit) return hit;
    }
    return null;
  }, [segmentGroups, selectedSegmentKey]);

  const selectedSource = sources.find((s) => s._id === selectedSourceId) || null;
  const selectedSourceName = selectedSource?.name || location.state?.sourceName || location.state?.pdfName || "";

  const selectSegment = (key) => {
    setSelectedSegmentKey(key);
    setDrawerOpen(false);
  };

  const statementState = selectedSegmentKey
    ? (statementsBySegment[selectedSegmentKey] || { status: "idle", statements: [], error: "" })
    : { status: "idle", statements: [], error: "" };

  const runExtraction = async () => {
    if (!selectedSegment) return;
    const key = selectedSegment.key;
    setStatementsBySegment((prev) => ({ ...prev, [key]: { status: "loading", statements: [], error: "" } }));
    try {
      const statements = await extractMedicalStatements({
        id: selectedSegment.bbox.id,
        pageNum: selectedSegment.pageNum,
        type: selectedSegment.bbox.type,
        text: selectedSegment.bbox.text || "",
      });
      setStatementsBySegment((prev) => ({ ...prev, [key]: { status: "done", statements: statements || [], error: "" } }));
    } catch (err) {
      setStatementsBySegment((prev) => ({
        ...prev,
        [key]: { status: "error", statements: [], error: err.message || "Failed to extract medical statements." },
      }));
    }
  };

  const asideContent = (
    <>
      <div id="segp_left_head">
        <span className="segp_panel_label">Segments</span>
        <span className="segp_count_pill">{totalSegments}</span>
      </div>

      <div id="segp_segment_list">
        {!selectedSourceId ? (
          <div className="segp_empty">
            <i className="fi fi-rr-shapes" />
            <p>Select a source above to list its segments.</p>
          </div>
        ) : annotationsLoading ? (
          <div className="segp_empty">
            <i className="bx bx-loader-circle segp_icon_spin" />
            <p>Loading segments…</p>
          </div>
        ) : annotationsError ? (
          <div className="segp_empty">
            <i className="bx bx-error" />
            <p>{annotationsError}</p>
          </div>
        ) : totalSegments === 0 ? (
          <div className="segp_empty">
            <i className="fi fi-rr-shapes" />
            <p>No segments found for this source yet.</p>
            <p className="segp_empty_hint">Draw content BBoxes for it in the PDF Reader first.</p>
          </div>
        ) : (
          segmentGroups.map((group) => (
            <div key={group.pageNum} className="segp_page_group">
              <div className="segp_page_group_label">Page {group.pageNum}</div>
              {group.segments.map((seg) => (
                <button
                  key={seg.key}
                  type="button"
                  className={`segp_segment_row${selectedSegmentKey === seg.key ? " segp_segment_row--active" : ""}`}
                  onClick={() => selectSegment(seg.key)}
                >
                  <i className={seg.isImage ? "fi fi-rr-picture" : "fi fi-rr-text"} />
                  <span className="segp_segment_row_text">
                    <span className="segp_segment_row_title">{seg.displayTitle}</span>
                    {!seg.isImage && (
                      <span className="segp_segment_row_preview">
                        {previewText(seg.bbox.text) || "No text extracted yet."}
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          ))
        )}
      </div>
    </>
  );

  return (
    <div id="segp_root">
      <div id="segp_header">
        <button id="segp_back" onClick={() => navigate("/home")} title="Back">
          <i className="fi fi-rr-arrow-left" />
        </button>
        <button id="segp_drawer_toggle" onClick={() => setDrawerOpen((v) => !v)} title="Browse segments">
          <i className="fi fi-rr-menu-burger" />
        </button>
        <div id="segp_header_titles">
          <span id="segp_title">AMCTOSHS Segmentation</span>
          <span id="segp_subtitle">Segment (BBox) → AMCTOSHS Medical Statements</span>
        </div>

        <select
          id="segp_source_select"
          value={selectedSourceId}
          onChange={(e) => setSelectedSourceId(e.target.value)}
          disabled={sourcesLoading}
        >
          <option value="">{sourcesLoading ? "Loading sources…" : "Select a source…"}</option>
          {sources.map((s) => (
            <option key={s._id} value={s._id}>{s.name}</option>
          ))}
        </select>
      </div>

      {sourcesError && (
        <div id="segp_row_error">
          <i className="bx bx-error" /> {sourcesError}
          <button type="button" onClick={() => setSourcesError("")}><i className="bx bx-x" /></button>
        </div>
      )}

      <div id="segp_body">
        <div id="segp_left">{asideContent}</div>

        {drawerOpen && (
          <div id="segp_drawer_backdrop" onClick={() => setDrawerOpen(false)}>
            <div id="segp_drawer_sheet" onClick={(e) => e.stopPropagation()}>{asideContent}</div>
          </div>
        )}

        <div id="segp_right">
          {!selectedSourceId ? (
            <div id="segp_no_selection">
              <i className="fi fi-rr-shapes" />
              <p>Select a source to get started</p>
            </div>
          ) : !selectedSegment ? (
            <div id="segp_no_selection">
              <i className="fi fi-rr-arrow-small-left" />
              <p>Select a segment from the list to view it</p>
              {selectedSourceName && <p className="segp_empty_hint">{selectedSourceName}</p>}
            </div>
          ) : (
            <>
              <div id="segp_seg_header">
                <div id="segp_seg_header_title">
                  <span id="segp_seg_name">{selectedSegment.displayTitle}</span>
                  <span className="segp_dim_badge">Page {selectedSegment.pageNum}</span>
                  <span className="segp_dim_badge segp_dim_badge--type">{selectedSegment.typeLabel}</span>
                </div>
              </div>

              <div id="segp_seg_body">
                <div id="segp_seg_content">
                  {selectedSegment.isImage ? (
                    selectedSegment.bbox.imageDataUrl ? (
                      <img
                        id="segp_seg_image"
                        src={selectedSegment.bbox.imageDataUrl}
                        alt={selectedSegment.displayTitle}
                      />
                    ) : (
                      <p className="segp_empty_hint">No image captured for this segment yet.</p>
                    )
                  ) : (
                    <p id="segp_seg_text">
                      {selectedSegment.bbox.text?.trim() || "No text extracted for this segment yet."}
                    </p>
                  )}
                </div>

                <div id="segp_statements_section">
                  <div id="segp_statements_head">
                    <span className="segp_panel_label">AMCTOSHS Medical Statements</span>
                    <button
                      type="button"
                      id="segp_extract_btn"
                      onClick={runExtraction}
                      disabled={statementState.status === "loading"}
                    >
                      {statementState.status === "loading" ? (
                        <><i className="bx bx-loader-circle segp_icon_spin" /> Extracting…</>
                      ) : (
                        <><i className="fi fi-rr-sparkles" /> Extract Medical Statements</>
                      )}
                    </button>
                  </div>

                  {statementState.status === "error" ? (
                    <div className="segp_empty segp_statements_empty">
                      <i className="bx bx-error" />
                      <p>{statementState.error}</p>
                    </div>
                  ) : statementState.status === "idle" ? (
                    <div className="segp_empty segp_statements_empty">
                      <i className="fi fi-rr-document" />
                      <p>Click &ldquo;Extract Medical Statements&rdquo; to begin.</p>
                    </div>
                  ) : statementState.status === "done" && statementState.statements.length === 0 ? (
                    <div className="segp_empty segp_statements_empty">
                      <i className="fi fi-rr-document" />
                      <p>No AMCTOSHS Medical Statements extracted from this segment.</p>
                    </div>
                  ) : statementState.status === "loading" ? null : (
                    <ul id="segp_statement_list">
                      {statementState.statements.map((statement, i) => (
                        <li key={statement.id || i} className="segp_statement_row">
                          <span className="segp_statement_index">{i + 1}</span>
                          <span className="segp_statement_text">{statement.text || statement}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
