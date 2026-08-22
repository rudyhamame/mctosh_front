import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  deleteRabbitHoleDocument,
  getDocumentReconstructionCanonicalText,
  getDocumentReconstructionPhysicalPages,
  getDocumentReconstructionStatus,
  getPhysicalLineSemanticTree,
  getPhysicalBlockSemanticTree,
  listRabbitHoleDocuments,
  pauseBackendDocumentReconstruction,
} from "../PDF/documentReconstructionClient.js";
import { buildStrictPhysicalBlockHierarchy } from "./rabbitHoleSemanticTree.js";
import "./rabbitHoleSemanticHolder.css";
import "./rabbitHoleSemanticHolderViewport.css";

const textOf = (value) => String(value ?? "").replace(/\s+/gu, " ").trim();
const linesOfPage = (page) => page?.physicalLines?.length ? page.physicalLines : page?.lines || [];
const formatDate = (value) => value ? new Date(value).toLocaleString() : "—";
const spanOf = (node) => node?.payload?.canonicalSpan || null;
const orderedNodes = (nodes) => [...nodes].sort((left, right) =>
  (Number(left.displayIndex) || 0) - (Number(right.displayIndex) || 0)
  || String(left.entityId).localeCompare(String(right.entityId)));

const canonicalValue = (node, canonicalCharacters) => {
  const payload = node?.payload || {};
  const span = spanOf(node);
  if (span && Number.isFinite(Number(span.start)) && Number.isFinite(Number(span.end)) && canonicalCharacters.length) {
    return canonicalCharacters.slice(Number(span.start), Number(span.end)).join("");
  }
  return textOf(payload.canonicalText || payload.resolvedText || payload.resolvedTextPreview || payload.surface || payload.value || payload.text || payload.label);
};

function SemanticNode({ node, childrenByParent, canonicalCharacters, level = 0 }) {
  const children = childrenByParent.get(String(node.entityId)) || [];
  const [open, setOpen] = useState(level < 5);
  const payload = node.payload || {};
  const metadata = [payload.clauseType, payload.phraseType, payload.typeLabel, payload.codePoint, payload.structuralPlaceholder ? "unresolved structure" : "", spanOf(node) ? `${spanOf(node).start}–${spanOf(node).end}` : ""].filter(Boolean).join(" · ");
  return (
    <div className="rhs_semantic_node" style={{ "--rhs-depth": level }}>
      <div className="rhs_semantic_row">
        <button type="button" className="rhs_tree_toggle" onClick={() => setOpen((value) => !value)} disabled={!children.length} aria-label={open ? "Collapse" : "Expand"}>
          {children.length ? (open ? "▾" : "▸") : "·"}
        </button>
        <span className={`rhs_type rhs_type--${node.entityType}`}>{node.entityType}</span>
        <span className="rhs_value" title={canonicalValue(node, canonicalCharacters)}>{node.entityType === "character" && canonicalValue(node, canonicalCharacters) === " " ? "space" : canonicalValue(node, canonicalCharacters) || "∅"}</span>
        {metadata && <span className="rhs_meta">{metadata}</span>}
      </div>
      {open && children.length > 0 && <div className="rhs_semantic_children">{children.map((child) => <SemanticNode key={child.entityId} node={child} childrenByParent={childrenByParent} canonicalCharacters={canonicalCharacters} level={level + 1} />)}</div>}
    </div>
  );
}

function PhysicalLineTree({ entry, selected, expanded, onSelect, semanticState, onLoad, canonicalCharacters }) {
  const block = entry.line;
  const blockId = String(block.id || block.entityId);
  const tree = semanticState?.data;
  const nodes = useMemo(() => buildStrictPhysicalBlockHierarchy({ block, nodes: tree?.nodes || [], canonicalCharacters }), [block, canonicalCharacters, tree?.nodes]);
  const nodeIds = useMemo(() => new Set(nodes.map((node) => String(node.entityId))), [nodes]);
  const childrenByParent = useMemo(() => {
    const map = new Map();
    for (const node of orderedNodes(nodes)) {
      const parentId = String(node.parentEntityId || "");
      if (!nodeIds.has(parentId)) continue;
      const children = map.get(parentId) || [];
      children.push(node);
      map.set(parentId, children);
    }
    return map;
  }, [nodeIds, nodes]);
  const roots = useMemo(() => orderedNodes(nodes.filter((node) => !nodeIds.has(String(node.parentEntityId || "")))), [nodeIds, nodes]);
  const blockText = textOf(block.canonicalText || block.sourceText || block.resolvedText || block.text);
  const toggle = () => {
    onSelect(blockId, true);
    if (!expanded) void onLoad(blockId);
  };

  return (
    <article id={`rhs-line-${CSS.escape(blockId)}`} className={`rhs_block_tree ${selected ? "rhs_block_tree--selected" : ""}`}>
      <button type="button" className="rhs_block_heading" onClick={toggle} aria-expanded={expanded}>
        <span className="rhs_block_chevron">{expanded ? "▾" : "▸"}</span>
        <span className="rhs_type rhs_type--physical-line">physical line</span>
        <strong>Line {Number(block.resolvedLineIndex ?? entry.lineIndex) + 1}</strong>
        <span className="rhs_block_preview">{blockText || "No canonical text"}</span>
        <small>Page {entry.pageIndex + 1}</small>
      </button>
      {expanded && (
        <div className="rhs_block_body">
          <dl className="rhs_line_diagnostics">
            <dt>Source range</dt><dd>{block.sourceStartIndex}–{Math.max(block.sourceStartIndex, Number(block.sourceEndIndex) - 1)}</dd>
            <dt>Characters</dt><dd>{block.sourceCharacterRange ? `${block.sourceCharacterRange.start}–${Math.max(block.sourceCharacterRange.start, block.sourceCharacterRange.endExclusive - 1)}` : `${block.sourceCharacterIds?.length || 0} exact IDs`}</dd>
            <dt>Baseline</dt><dd>{Number(block.dominantBaseline || 0).toFixed(3)}</dd>
            <dt>Envelope</dt><dd>{Number(block.upperEnvelope || 0).toFixed(3)}–{Number(block.lowerEnvelope || 0).toFixed(3)}</dd>
            <dt>Line height</dt><dd>{Number(block.dominantLineHeight || 0).toFixed(3)}</dd>
            <dt>Flow</dt><dd>{block.writingDirection || "ltr"} · {Number(block.orientation || 0).toFixed(1)}°</dd>
          </dl>
          <details className="rhs_line_items"><summary>Source items ({block.items?.length || 0})</summary>{(block.items || []).map((item) => <div key={item.id}><b>{item.sourceOrder}</b><span>{item.text || "∅"}</span><small>bbox {Number(item.bbox?.x || 0).toFixed(2)},{Number(item.bbox?.y || 0).toFixed(2)} {Number(item.bbox?.width || 0).toFixed(2)}×{Number(item.bbox?.height || 0).toFixed(2)} · baseline {Number(item.baseline || 0).toFixed(2)} · offset {Number(item.normalizedBaselineOffset || 0).toFixed(3)} · overlap {Number(item.verticalOverlap || 0).toFixed(2)} · {item.relativeVerticalPosition} · {item.scriptCandidate}<br />transform {item.transform?.join(", ") || "not supplied"} · evidence {(item.sameLineEvidence || []).join(", ") || "none"}</small></div>)}</details>
          {semanticState?.loading && <div className="rhs_tree_hint">Loading canonical linguistic nodes…</div>}
          {semanticState?.error && <div className="rhs_tree_error">{semanticState.error}</div>}
          {!semanticState?.loading && !semanticState?.error && roots.map((node) => <SemanticNode key={node.entityId} node={node} childrenByParent={childrenByParent} canonicalCharacters={canonicalCharacters} />)}
          {!semanticState?.loading && !semanticState?.error && tree && roots.length === 0 && (
            <div className="rhs_unassigned">
              <strong>No overlapping sentential structure</strong>
              <span>This PhysicalLine is saved, but no sentence, clause, phrase, word, or morpheme node overlaps its canonical character span.</span>
              {blockText && <p>{blockText}</p>}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

export default function RabbitHoleSemanticHolderPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [documents, setDocuments] = useState([]);
  const [selectedDocumentId, setSelectedDocumentId] = useState("");
  const [pages, setPages] = useState([]);
  const [selectedBlockId, setSelectedBlockId] = useState("");
  const [expandedBlocks, setExpandedBlocks] = useState(() => new Set());
  const [semanticByBlock, setSemanticByBlock] = useState({});
  const [canonicalStream, setCanonicalStream] = useState("");
  const [loading, setLoading] = useState(true);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [error, setError] = useState("");

  const selectedDocument = useMemo(() => documents.find((document) => String(document._id) === String(selectedDocumentId)) || null, [documents, selectedDocumentId]);
  const selectedRun = selectedDocument?.latestSavedRun || null;
  const canonicalCharacters = useMemo(() => Array.from(canonicalStream), [canonicalStream]);
  const lineEntries = useMemo(() => pages.flatMap((page) => linesOfPage(page).map((line, lineIndex) => ({ pageIndex: Number(page.pageIndex), lineIndex, line }))), [pages]);
  const legacyBlockByLineId = useMemo(() => new Map(pages.flatMap((page) => (page.physicalBlocks || []).flatMap((block) => (block.lineIds || []).map((lineId) => [String(lineId), block])))), [pages]);

  const refreshDocuments = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await listRabbitHoleDocuments();
      const nextDocuments = result.documents || [];
      setDocuments(nextDocuments);
      const requestedRunId = location.state?.runId;
      if (requestedRunId) {
        const requested = nextDocuments.find((document) => String(document.latestSavedRun?._id) === String(requestedRunId));
        if (requested) setSelectedDocumentId(String(requested._id));
      }
    } catch (cause) {
      setError(cause.message || "Could not load PDF documents.");
    } finally {
      setLoading(false);
    }
  }, [location.state?.runId]);

  useEffect(() => { void refreshDocuments(); }, [refreshDocuments]);

  useEffect(() => {
    setPages([]);
    setCanonicalStream("");
    setSelectedBlockId("");
    setExpandedBlocks(new Set());
    setSemanticByBlock({});
    if (!selectedRun?._id) return undefined;
    let alive = true;
    setWorkspaceLoading(true);
    setError("");
    const loadWorkspace = async () => {
      try {
        const loadedPages = [];
        let fromPage = 0;
        while (alive) {
          const result = await getDocumentReconstructionPhysicalPages(selectedRun._id, fromPage, 50);
          loadedPages.push(...(result.pages || []));
          if (!result.hasMore || result.nextPage == null) break;
          fromPage = result.nextPage;
        }
        if (!alive) return;
        setPages(loadedPages);
        const firstLine = loadedPages.flatMap(linesOfPage)[0];
        if (firstLine) {
          const firstId = String(firstLine.id || firstLine.entityId);
          setSelectedBlockId(firstId);
          setExpandedBlocks(new Set([firstId]));
        }
        setWorkspaceLoading(false);
        const chunks = [];
        let from = 0;
        while (alive) {
          const result = await getDocumentReconstructionCanonicalText(selectedRun._id, from, 200);
          chunks.push(...(result.chunks || []));
          if (result.next == null) break;
          from = result.next;
        }
        if (alive) setCanonicalStream(chunks.sort((a, b) => Number(a.start ?? a.startCanonicalIndex ?? 0) - Number(b.start ?? b.startCanonicalIndex ?? 0)).map((chunk) => chunk.text || "").join(""));
      } catch (cause) {
        if (alive) setError(cause.message || "Could not load the saved PhysicalBlocks.");
      } finally {
        if (alive) setWorkspaceLoading(false);
      }
    };
    void loadWorkspace();
    return () => { alive = false; };
  }, [selectedRun?._id]);

  const loadSemanticTree = useCallback(async (blockId) => {
    if (!selectedRun?._id || semanticByBlock[blockId]?.data || semanticByBlock[blockId]?.loading) return;
    setSemanticByBlock((current) => ({ ...current, [blockId]: { loading: true, error: "", data: null } }));
    try {
      let data;
      try {
        data = await getPhysicalLineSemanticTree(selectedRun._id, blockId);
      } catch (lineError) {
        const legacyBlock = legacyBlockByLineId.get(String(blockId));
        if (!legacyBlock) throw lineError;
        data = await getPhysicalBlockSemanticTree(selectedRun._id, legacyBlock.id || legacyBlock.entityId);
      }
      setSemanticByBlock((current) => ({ ...current, [blockId]: { loading: false, error: "", data } }));
    } catch (cause) {
      setSemanticByBlock((current) => ({ ...current, [blockId]: { loading: false, error: cause.message || "Could not load this line tree.", data: null } }));
    }
  }, [legacyBlockByLineId, selectedRun?._id, semanticByBlock]);

  useEffect(() => { if (selectedBlockId) void loadSemanticTree(selectedBlockId); }, [loadSemanticTree, selectedBlockId]);

  const selectBlock = (blockId, toggle = false) => {
    setSelectedBlockId(blockId);
    setExpandedBlocks((current) => {
      const next = new Set(current);
      if (toggle && next.has(blockId)) next.delete(blockId);
      else next.add(blockId);
      return next;
    });
  };

  const jumpToBlock = (blockId) => {
    selectBlock(blockId);
    void loadSemanticTree(blockId);
    window.requestAnimationFrame(() => document.getElementById(`rhs-line-${CSS.escape(blockId)}`)?.scrollIntoView({ block: "start", behavior: "smooth" }));
  };
  const deleteSavedTree = async (event, document) => {
    event.stopPropagation();
    const runId = String(document.latestSavedRun?._id || "");
    if (deletingId) return;
    if (!window.confirm(`Delete “${document.filename}” and all of its saved RabbitHole data? This cannot be undone.`)) return;
    setDeletingId(runId || String(document._id));
    setError("");
    try {
      if (runId) {
        let current = (await getDocumentReconstructionStatus(runId)).run;
        const stopped = new Set(["complete", "complete-with-unresolved", "partial", "paused", "cancelled", "failed", "interrupted"]);
        if (!stopped.has(current?.status) && current?.capabilities?.canPause) await pauseBackendDocumentReconstruction(runId);
        for (let attempt = 0; attempt < 120 && !stopped.has(current?.status); attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 500));
          current = (await getDocumentReconstructionStatus(runId)).run;
        }
        if (!stopped.has(current?.status)) throw new Error("The reconstruction did not stop within 60 seconds.");
      }
      await deleteRabbitHoleDocument(document._id);
      if (String(selectedDocumentId) === String(document._id)) setSelectedDocumentId("");
      await refreshDocuments();
    } catch (cause) {
      setError(cause.message || "Could not delete the saved RabbitHole tree.");
    } finally {
      setDeletingId("");
    }
  };

  const leaveWorkspace = () => { setSelectedDocumentId(""); setPages([]); setError(""); };

  return (
    <main className="rhs_page">
      <header className="rhs_header">
        <button type="button" className="rhs_back" onClick={selectedDocument ? leaveWorkspace : () => navigate(-1)}>← {selectedDocument ? "PDFs" : "Back"}</button>
        <div><h1>RabbitHole Hylomorphic Entities in 3D Mode</h1><p>{selectedDocument ? "PhysicalLines ordered by source flow · overlapping canonical linguistic tree" : "Choose a PDF to inspect its saved canonical structure"}</p></div>
      </header>
      {error && <div className="rhs_error">{error}</div>}

      {!selectedDocument && (
        <section className="rhs_catalog" aria-label="PDF documents">
          <div className="rhs_catalog_heading"><div><h2>PDF documents</h2><p>Each document opens its newest database-saved RabbitHole tree.</p></div><span>{documents.length}</span></div>
          {loading && <div className="rhs_empty rhs_empty--large">Loading PDFs…</div>}
          {!loading && documents.length === 0 && <div className="rhs_empty rhs_empty--large">No PDFs are available yet.</div>}
          <div className="rhs_pdf_grid">
            {documents.map((document) => {
              const run = document.latestSavedRun;
              return (
                <div className="rhs_pdf_card" key={document._id}>
                  <button type="button" className="rhs_pdf_select" onClick={() => setSelectedDocumentId(String(document._id))}>
                    <span className="rhs_pdf_icon" aria-hidden="true">PDF</span>
                    <span className="rhs_pdf_identity"><strong>{document.filename}</strong><small>{document.pageCount} pages · {document.type}</small></span>
                    <span className={`rhs_storage_badge ${run ? "rhs_storage_badge--saved" : ""}`}>{run ? "DB SAVED" : "NO TREE"}</span>
                    <span className="rhs_pdf_card_meta">{run ? `${run.status} · ${formatDate(run.completedAt || run.updatedAt)}` : "Reconstruct this PDF in the Reader first."}</span>
                  </button>
                  <button type="button" className="rhs_card_delete" onClick={(event) => void deleteSavedTree(event, document)} aria-label={`Delete document ${document.filename}`}>{deletingId === String(run?._id || document._id) ? "…" : "⌫"}</button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {selectedDocument && (
        <div className="rhs_workspace">
          <div className="rhs_workspace_header"><div><h2>{selectedDocument.filename}</h2><p>{selectedDocument.pageCount} PDF pages · {lineEntries.length} physical lines</p></div><span className={`rhs_storage_badge ${selectedRun ? "rhs_storage_badge--saved" : ""}`}>{selectedRun ? "✓ DB SAVED" : "NO SAVED TREE"}</span></div>
          {!selectedRun && <div className="rhs_empty rhs_empty--large">This PDF has no saved RabbitHole tree. Open it in the PDF Reader and reconstruct it first.</div>}
          {selectedRun && workspaceLoading && <div className="rhs_empty rhs_empty--large">Loading pages and PhysicalBlocks…</div>}
          {selectedRun && !workspaceLoading && (
            <div className="rhs_layout">
              <aside className="rhs_blocks" aria-label="PhysicalLines by PDF page">
                <div className="rhs_section_title">PhysicalLines <span>{lineEntries.length}</span></div>
                {pages.map((page) => (
                  <section className="rhs_block_page" key={page.pageIndex}>
                    <div className="rhs_page_separator"><span>PAGE {Number(page.pageIndex) + 1}</span><i /></div>
                    {linesOfPage(page).map((line, lineIndex) => {
                      const blockId = String(line.id || line.entityId);
                      return <button type="button" className={`rhs_block_link ${selectedBlockId === blockId ? "rhs_block_link--selected" : ""}`} key={blockId} onClick={() => jumpToBlock(blockId)}><span>{lineIndex + 1}</span><strong>{textOf(line.canonicalText || line.sourceText || line.text) || "Empty PhysicalLine"}</strong></button>;
                    })}
                    {!linesOfPage(page).length && <div className="rhs_page_empty">No saved physical structure</div>}
                  </section>
                ))}
              </aside>
              <section className="rhs_content" aria-label="Canonical PhysicalLine evidence and sentential trees">
                <div className="rhs_tree_legend"><strong>PhysicalLine ↔ Sentential Meaning</strong><span>sentence → clause → phrase → word → morpheme → character</span></div>
                {lineEntries.length === 0 && <div className="rhs_empty rhs_empty--large">The run is saved, but it contains no physical structure.</div>}
                <div className="rhs_tree">
                  {lineEntries.map((entry) => {
                    const blockId = String(entry.line.id || entry.line.entityId);
                    return <PhysicalLineTree key={blockId} entry={entry} selected={selectedBlockId === blockId} expanded={expandedBlocks.has(blockId)} onSelect={selectBlock} semanticState={semanticByBlock[blockId]} onLoad={loadSemanticTree} canonicalCharacters={canonicalCharacters} />;
                  })}
                </div>
              </section>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
