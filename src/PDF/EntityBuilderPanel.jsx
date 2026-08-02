import React, { useEffect, useMemo, useState } from "react";
import "./entityBuilderPanel.css";
import { BBOX_CARD_TYPES, bboxTypeHas, canBBoxContain, getBBoxTypeAbbreviation } from "./pdfBBoxTypes.js";
import { applyOcrTokenCasing } from "./bboxTextCorrection.js";

const DEFAULT_ENTITY_BUILDER_TEXT_FONT_SIZE = 12;

const normalizeBuilderText = (value) => String(value || "")
  .replace(/^\s*(?:[\u2022\u25E6\-*]|\d+[.)])\s*/, "")
  .replace(/\s+/g, " ")
  .trim()
  .toLowerCase();

const paragraphTextWithSubLines = (paragraph, subLines = [], textFor = (item) => item.text || "") => {
  const originalText = String(textFor(paragraph) || "").trim();
  const lines = originalText.split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return originalText;
  const subLineRecords = subLines
    .map((subLine) => String(textFor(subLine) || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean))
    .filter((record) => record.length);
  const lineMatches = (line, target) => (
    line === target
    || line.includes(target)
    || target.includes(line)
  );
  const subLineIndexes = new Set();
  subLineRecords.forEach((record) => {
    const start = lines.findIndex((line) => lineMatches(normalizeBuilderText(line), normalizeBuilderText(record[0])));
    if (start < 0) return;
    for (let offset = 0; offset < record.length && start + offset < lines.length; offset++) {
      subLineIndexes.add(start + offset);
    }
  });
  let paragraphLineNumber = 0;
  return lines.map((line, index) => {
    const isSubLine = subLineIndexes.has(index);
    const lineNumber = isSubLine ? null : ++paragraphLineNumber;
    const className = [
      "entity_builder_bbox_text_line",
      isSubLine ? "entity_builder_bbox_text_line--subline" : "",
    ].filter(Boolean).join(" ");
    return (
      <span key={`${paragraph.id}-line-${index}`} className={className}>
        {lineNumber != null && <span className="entity_builder_bbox_line_index" aria-hidden="true">L{lineNumber}</span>}
        {isSubLine && <span className="entity_builder_bbox_subline_index" aria-hidden="true">SL</span>}
        <span className="entity_builder_bbox_line_content">{line.trim()}</span>
      </span>
    );
  });
};

const EntityBuilderPanel = ({
  width = null,
  onResizeStart = null,
  onClose,
  bboxCards = [],
  pageNum = null,
  onUpdateBBoxName = null,
  onDeleteBBox = null,
  onMoveBBoxUp = null,
  onMoveBBoxDown = null,
  onMergeParagraphs = null,
  onArmBBoxInsideContainer = null,
  armedBBoxInsideContainer = null,
}) => {
  const [editingNameId, setEditingNameId] = useState(null);
  const [editingNameValue, setEditingNameValue] = useState("");
  const [openMinibarId, setOpenMinibarId] = useState(null);
  const [textView, setTextView] = useState("corrected");
  const [paragraphMergeMode, setParagraphMergeMode] = useState(false);
  const [selectedParagraphIds, setSelectedParagraphIds] = useState(() => new Set());
  const isImageBBox = (bbox) => bboxTypeHas(bbox?.type, "capturesImage");
  const normalizedBboxes = useMemo(() => (
    (Array.isArray(bboxCards) ? bboxCards : [])
      .filter((bbox) => bbox && (BBOX_CARD_TYPES.has(bbox.type) || bbox.type === "subLineBBox"))
      .map((bbox, index) => ({
        ...bbox,
        _index: index + 1,
      }))
  ), [bboxCards]);
  const bboxContainers = useMemo(() => (
    (Array.isArray(bboxCards) ? bboxCards : [])
      .filter((bbox) => bbox && bboxTypeHas(bbox.type, "containsChildren"))
  ), [bboxCards]);
  const layoutColumns = useMemo(() => (
    (Array.isArray(bboxCards) ? bboxCards : []).filter((bbox) => bbox?.type === "columnBBox")
  ), [bboxCards]);
  const groupedBboxes = useMemo(() => {
    const paragraphBboxes = normalizedBboxes.filter((bbox) => bbox.type === "bbox");
    const subLineBboxes = normalizedBboxes.filter((bbox) => bbox.type === "subLineBBox");
    const subLineChildren = new Map();
    const columnChildren = new Map();
    const columnContentChildren = new Map();
    const nestedSubLineIds = new Set();
    const isInside = (child, parent) => {
      const inset = 2;
      return child.x >= parent.x - inset
        && child.y >= parent.y - inset
        && child.x + child.w <= parent.x + parent.w + inset
        && child.y + child.h <= parent.y + parent.h + inset;
    };
    layoutColumns.forEach((column) => {
      const explicitContainer = bboxContainers.find((candidate) => (
        candidate.id === column.parentId && canBBoxContain(candidate.type, column.type)
      ));
      const geometricContainer = bboxContainers
        .filter((candidate) => canBBoxContain(candidate.type, column.type) && isInside(column, candidate))
        .sort((a, b) => (a.w * a.h) - (b.w * b.h))[0];
      const parent = explicitContainer || geometricContainer;
      if (!parent) return;
      columnChildren.set(parent.id, [...(columnChildren.get(parent.id) || []), column]);
    });
    normalizedBboxes.filter((bbox) => ["bbox", "imageBBox"].includes(bbox.type)).forEach((content) => {
      const explicitColumn = layoutColumns.find((column) => (
        column.id === content.parentId && canBBoxContain(column.type, content.type)
      ));
      const geometricColumn = layoutColumns
        .filter((column) => canBBoxContain(column.type, content.type) && isInside(content, column))
        .sort((a, b) => (a.w * a.h) - (b.w * b.h))[0];
      const parent = explicitColumn || geometricColumn;
      if (!parent) return;
      columnContentChildren.set(parent.id, [
        ...(columnContentChildren.get(parent.id) || []),
        content,
      ]);
    });
    subLineBboxes.forEach((subLine) => {
      const explicitParent = paragraphBboxes.find((paragraph) => paragraph.id === subLine.parentId);
      const geometricParent = paragraphBboxes
        .filter((paragraph) => canBBoxContain(paragraph.type, subLine.type) && isInside(subLine, paragraph))
        .sort((a, b) => (a.w * a.h) - (b.w * b.h))[0];
      const parent = explicitParent || geometricParent;
      if (!parent) return;
      subLineChildren.set(parent.id, [...(subLineChildren.get(parent.id) || []), subLine]);
      nestedSubLineIds.add(subLine.id);
    });
    const assigned = new Set();
    const buildGroup = (container, containerIndex) => {
      const contained = normalizedBboxes.filter((bbox) => {
        if (bbox.id === container.id || nestedSubLineIds.has(bbox.id) || assigned.has(bbox.id)) return false;
        const nestedInPartition = (columnChildren.get(container.id) || []).some((column) => (
          canBBoxContain(column.type, bbox.type)
          && (bbox.parentId === column.id || isInside(bbox, column))
        ));
        if (nestedInPartition) {
          assigned.add(bbox.id);
          return false;
        }
        const withinGeometry = isInside(bbox, container);
        const within = canBBoxContain(container.type, bbox.type)
          && (bbox.parentId === container.id || withinGeometry);
        if (within) assigned.add(bbox.id);
        return within;
      });
      return { container, contained, _index: containerIndex + 1 };
    };
    const pageContainers = bboxContainers.filter((container) => container.type === "pageBBox");
    const groups = pageContainers.length
      ? pageContainers.map((page, pageIndex) => buildGroup(page, pageIndex))
      : bboxContainers.map((container, containerIndex) => buildGroup(container, containerIndex));
    const standalone = normalizedBboxes.filter((bbox) => !assigned.has(bbox.id) && !nestedSubLineIds.has(bbox.id));
    return { groups, standalone, subLineChildren, columnChildren, columnContentChildren };
  }, [bboxContainers, layoutColumns, normalizedBboxes]);

  const correctedTextFor = (bbox) => {
    const sourceText = String(bbox.text || bbox.rawPdfText || "");
    const candidateText = String(
      bbox.textCorrection?.applied ? (bbox.correctedText || sourceText) : (bbox.ocrCorrectedText || bbox.correctedText || sourceText),
    );
    const wordCount = (value) => (value.match(/[\p{L}\p{N}]+/gu) || []).length;
    // OCR suggestions can be incomplete when the first line is visually
    // distinct. Never let a shorter suggestion hide text already extracted
    // from the BBox.
    return wordCount(candidateText) >= wordCount(sourceText)
      && candidateText.replace(/\s+/g, " ").length >= sourceText.replace(/\s+/g, " ").length * 0.85
      ? candidateText
      : sourceText;
  };
  const textForView = (bbox, view) => view === "raw"
    ? String(bbox.rawPdfText || bbox.text || "")
    : correctedTextFor(bbox);
  const textFor = (bbox) => textForView(bbox, textView);
  const textLinesForView = (bbox) => {
    if (!Array.isArray(bbox?.textLines) || !bbox.textLines.length) return textFor(bbox);
    const lines = bbox.textLines.join("\n");
    return textView === "corrected"
      ? applyOcrTokenCasing(lines, correctedTextFor(bbox))
      : lines;
  };
  const correctionSummary = useMemo(() => {
    const textBboxes = normalizedBboxes.filter((bbox) => bboxTypeHas(bbox.type, "extractsText"));
    return textBboxes.reduce((summary, bbox) => {
      const auditSummary = bbox.textCorrection?.audit?.summary;
      if (auditSummary) summary.audited += 1;
      else summary.unaudited += 1;
      summary.unresolved += auditSummary?.unresolvedCount || 0;
      summary.auditWarnings += auditSummary?.warningCount || 0;
      summary.silentOmissions += auditSummary?.silentOmissionCount || 0;
      if (bbox.textCorrection?.applied) summary.applied += 1;
      else if (bbox.ocrCorrectedText) summary.suggested += 1;
      else if (!bbox.textCorrection?.ocrJobId) summary.pending += 1;
      else summary.checked += 1;
      return summary;
    }, {
      applied: 0,
      suggested: 0,
      pending: 0,
      checked: 0,
      audited: 0,
      unaudited: 0,
      unresolved: 0,
      auditWarnings: 0,
      silentOmissions: 0,
    });
  }, [normalizedBboxes]);

  useEffect(() => {
    setParagraphMergeMode(false);
    setSelectedParagraphIds(new Set());
  }, [pageNum]);

  useEffect(() => {
    const availableIds = new Set(normalizedBboxes.filter((bbox) => bbox.type === "bbox").map((bbox) => bbox.id));
    setSelectedParagraphIds((current) => {
      const next = new Set([...current].filter((id) => availableIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [normalizedBboxes]);

  const toggleParagraphMergeCandidate = (bboxId) => {
    setSelectedParagraphIds((current) => {
      const next = new Set(current);
      if (next.has(bboxId)) next.delete(bboxId);
      else next.add(bboxId);
      return next;
    });
  };

  const cancelParagraphMerge = () => {
    setParagraphMergeMode(false);
    setSelectedParagraphIds(new Set());
  };

  const mergeSelectedParagraphs = () => {
    const orderedIds = normalizedBboxes
      .filter((bbox) => bbox.type === "bbox" && selectedParagraphIds.has(bbox.id))
      .map((bbox) => bbox.id);
    if (orderedIds.length < 2 || !onMergeParagraphs) return;
    onMergeParagraphs(orderedIds, pageNum);
    cancelParagraphMerge();
  };

  const renderParagraphMergeCheckbox = (bbox) => (
    paragraphMergeMode && bbox?.type === "bbox" ? (
      <label className="entity_builder_merge_checkbox" title="Include paragraph in merge">
        <input
          type="checkbox"
          checked={selectedParagraphIds.has(bbox.id)}
          onChange={() => toggleParagraphMergeCandidate(bbox.id)}
          aria-label={`Select ${bbox._displayTitle || "paragraph"} for merging`}
        />
        <span aria-hidden="true" />
      </label>
    ) : null
  );

  const startEditName = (bbox) => {
    setEditingNameId(bbox.id);
    setEditingNameValue(bbox.title?.trim() || bbox._displayTitle || "");
  };

  const cancelEditName = () => {
    setEditingNameId(null);
    setEditingNameValue("");
  };

  const commitEditName = (bbox) => {
    const nextName = editingNameValue.trim();
    if (nextName) onUpdateBBoxName?.(bbox.id, nextName, pageNum);
    cancelEditName();
  };

  const handleDeleteBBox = (bbox) => {
    if (!bbox?.id || !onDeleteBBox) return;
    if (editingNameId === bbox.id) cancelEditName();
    onDeleteBBox(bbox.id, pageNum);
  };

  const canMoveUp = Boolean(onMoveBBoxUp);
  const canMoveDown = Boolean(onMoveBBoxDown);
  const containerBBoxIcon = (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      fill="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M14.5 11h5c.83 0 1.5-.67 1.5-1.5v-5c0-.83-.67-1.5-1.5-1.5h-5c-.83 0-1.5.67-1.5 1.5v5c0 .83.67 1.5 1.5 1.5m.5-6h4v4h-4zM9.5 3h-5C3.67 3 3 3.67 3 4.5v15c0 .83.67 1.5 1.5 1.5h5c.83 0 1.5-.67 1.5-1.5v-15c0-.83-.67-1.5-1.5-1.5M9 19H5V5h4zm7 2h2v-3h3v-2h-3v-3h-2v3h-3v2h3z"></path>
    </svg>
  );
  const moveUpIcon = (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      fill="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M13 16v-5h3l-4-4-4 4h3v5zM3 3h3v2H3zm5 0h3v2H8zm5 0h3v2h-3zm5 0h3v2h-3z"></path>
    </svg>
  );
  const moveDownIcon = (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      fill="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M13 8h-2v5H8l4 4 4-4h-3zM3 19h3v2H3zm5 0h3v2H8zm5 0h3v2h-3zm5 0h3v2h-3z"></path>
    </svg>
  );
  const renderMoveButtons = (bbox) => (
    <>
      <button
        type="button"
        className="entity_builder_bbox_name_btn"
        onClick={() => {
          onMoveBBoxUp?.(bbox.id, pageNum);
          setOpenMinibarId(null);
        }}
        aria-label={`Move ${bbox._displayTitle || "segment"} up`}
        title="Move up"
        disabled={!canMoveUp}
      >
        {moveUpIcon}
      </button>
      <button
        type="button"
        className="entity_builder_bbox_name_btn"
        onClick={() => {
          onMoveBBoxDown?.(bbox.id, pageNum);
          setOpenMinibarId(null);
        }}
        aria-label={`Move ${bbox._displayTitle || "segment"} down`}
        title="Move down"
        disabled={!canMoveDown}
      >
        {moveDownIcon}
      </button>
    </>
  );
  const armContainerBBox = (container) => onArmBBoxInsideContainer?.(container.id, pageNum);
  const renderBBoxId = (bbox) => (
    <span className="entity_builder_bbox_id" title="Global AMCTOSHS Hyle BBox ID">
      {bbox.hyleId || bbox.id}
    </span>
  );
  const renderMinibarToggle = (bbox) => (
    <button
      type="button"
      className={`entity_builder_bbox_minibar_toggle${openMinibarId === bbox.id ? " entity_builder_bbox_minibar_toggle--active" : ""}`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setOpenMinibarId((current) => current === bbox.id ? null : bbox.id);
      }}
      aria-label={`Open actions for ${bbox._displayTitle || "BBox"}`}
      aria-expanded={openMinibarId === bbox.id}
      title="Open BBox actions"
    >
      <i className="bx bx-dots-vertical-rounded" />
    </button>
  );
  const renderBBoxActionMinibar = (bbox, {
    allowArm = false,
    allowEdit = true,
    allowMove = true,
    allowDelete = true,
  } = {}) => openMinibarId === bbox.id ? (
    <div className="entity_builder_bbox_actions entity_builder_bbox_minibar" role="menu" aria-label={`Actions for ${bbox._displayTitle || getBBoxTypeAbbreviation(bbox.type)}`}>
      {allowArm && (
        <button
          type="button"
          className={`entity_builder_bbox_name_btn${armedBBoxInsideContainer?.containerId === bbox.id && armedBBoxInsideContainer?.pageNum === pageNum ? " entity_builder_bbox_name_btn--active" : ""}`}
          onClick={() => {
            armContainerBBox(bbox);
            setOpenMinibarId(null);
          }}
          aria-label={`Add segment inside ${bbox.title?.trim() || bbox._displayTitle || getBBoxTypeAbbreviation(bbox.type)}`}
          title="Add segment inside"
          disabled={!onArmBBoxInsideContainer}
          role="menuitem"
        >
          {containerBBoxIcon}
        </button>
      )}
      {allowMove && renderMoveButtons(bbox)}
      {allowEdit && (
        <button
          type="button"
          className="entity_builder_bbox_name_btn"
          onClick={() => {
            setOpenMinibarId(null);
            startEditName(bbox);
          }}
          aria-label={`Edit ${bbox._displayTitle || getBBoxTypeAbbreviation(bbox.type)}`}
          title="Edit name"
          role="menuitem"
        >
          <i className="bx bx-edit" />
        </button>
      )}
      {allowDelete && (
        <button
          type="button"
          className="entity_builder_bbox_name_btn entity_builder_bbox_name_btn--danger"
          onClick={() => {
            setOpenMinibarId(null);
            handleDeleteBBox(bbox);
          }}
          aria-label={`Delete ${bbox._displayTitle || getBBoxTypeAbbreviation(bbox.type)}`}
          title="Delete segment"
          disabled={!onDeleteBBox}
          role="menuitem"
        >
          <i className="bx bx-trash" />
        </button>
      )}
    </div>
  ) : null;
  const renderNestedColumns = (parent) => {
    const columns = groupedBboxes.columnChildren.get(parent.id) || [];
    if (!columns.length) return null;
    return (
      <div className="entity_builder_bbox_nested_children entity_builder_bbox_column_children">
        {columns.map((column, index) => {
          const contentChildren = groupedBboxes.columnContentChildren.get(column.id) || [];
          const selectedColumnText = textFor(column).trim();
          const rawParts = selectedColumnText
            ? [{ kind: "text", text: selectedColumnText }]
            : Array.isArray(column.textParts) && column.textParts.length
            ? column.textParts
            : [
                ...(column.unbulletedText ? [{ kind: "text", text: column.unbulletedText }] : []),
                ...(column.bulletedText ? [{ kind: "bullet", text: column.bulletedText }] : []),
              ];
          const parts = textView === "corrected"
            ? rawParts.map((part) => ({
                ...part,
                text: applyOcrTokenCasing(part.text, correctedTextFor(parent)),
              }))
            : rawParts;
          return (
            <article key={column.id} className="entity_builder_bbox_nested_item entity_builder_bbox_column_card entity_builder_bbox_tree_node entity_builder_bbox_tree_node--partition" data-bbox-type={column.type}>
              <div className="entity_builder_bbox_nested_item_head">
                <span className="entity_builder_bbox_type_block">
                  <strong>Part {index + 1}</strong>
                  {renderBBoxId(column)}
                </span>
                {renderMinibarToggle(column)}
                {renderBBoxActionMinibar(column, { allowEdit: false, allowMove: false })}
              </div>
              {contentChildren.length ? contentChildren.map((content) => (
                <article key={content.id} className={`entity_builder_bbox_card entity_builder_bbox_partition_paragraph entity_builder_bbox_tree_node entity_builder_bbox_tree_node--${content.type === "imageBBox" ? "figure" : "paragraph"}`} data-bbox-type={content.type}>
                  <div className="entity_builder_bbox_title">
                    {renderParagraphMergeCheckbox(content)}
                    <span className="entity_builder_bbox_type_block">
                      <strong>{content._displayTitle || getBBoxTypeAbbreviation(content.type)}</strong>
                      {renderBBoxId(content)}
                    </span>
                    {renderMinibarToggle(content)}
                    {renderBBoxActionMinibar(content)}
                  </div>
                  {isImageBBox(content) ? (
                    <div className="entity_builder_bbox_image_wrap">
                      {content.imageDataUrl ? (
                        <img className="entity_builder_bbox_image_preview" src={content.imageDataUrl} alt={content._displayTitle} loading="lazy" />
                      ) : (
                        <div className="entity_builder_bbox_image_empty">No image extracted yet.</div>
                      )}
                      <div className="entity_builder_bbox_image_meta">
                        {content.imageWidth && content.imageHeight ? `${content.imageWidth} × ${content.imageHeight}px` : "Image snippet"}
                      </div>
                      {textFor(content).trim() && <div className="entity_builder_bbox_text">{textFor(content)}</div>}
                    </div>
                  ) : (
                    <div
                      className="entity_builder_bbox_text"
                      style={{ fontSize: `${content.fontSize || DEFAULT_ENTITY_BUILDER_TEXT_FONT_SIZE}px` }}
                    >
                      {paragraphDisplayText(content) || "No text extracted yet."}
                    </div>
                  )}
                </article>
              )) : (
                <>
                  <div className="entity_builder_bbox_column_lines">
                    {parts.length ? parts.map((part, partIndex) => (
                      <div
                        key={`${column.id}-${part.kind}-${part.bulletId || partIndex}`}
                        className={`entity_builder_bbox_column_part entity_builder_bbox_column_part--${part.kind}`}
                      >
                        {part.kind === "bullet" ? "• " : ""}{part.text}
                      </div>
                    )) : <span className="entity_builder_bbox_nested_text">No text extracted yet.</span>}
                  </div>
                </>
              )}
            </article>
          );
        })}
      </div>
    );
  };
  const hasNestedColumns = (bbox) => (groupedBboxes.columnChildren.get(bbox.id) || []).length > 0;
  const paragraphDisplayText = (paragraph) => paragraphTextWithSubLines(
    paragraph,
    groupedBboxes.subLineChildren.get(paragraph.id) || [],
    (item) => textLinesForView(item),
  );
  const renderSegments = () => (
    <>
      {normalizedBboxes.length === 0 && bboxContainers.length === 0 ? (
        <p className="entity_builder_helper">
          No segments on page {pageNum ?? "?"} yet.
        </p>
      ) : (
        <div id="entity_builder_bbox_cards">
          {groupedBboxes.groups.map(({ container, contained, _index }) => (
            <section key={container.id} className="entity_builder_bbox_container entity_builder_bbox_tree_node entity_builder_bbox_tree_node--root" data-bbox-type={container.type}>
              <div className="entity_builder_bbox_container_header">
                <div className="entity_builder_bbox_name_row">
                  <span className="entity_builder_bbox_type_block">
                    <strong>{container.title?.trim() || container._displayTitle || `${getBBoxTypeAbbreviation(container.type)} ${_index}`}</strong>
                    {renderBBoxId(container)}
                  </span>
                  {renderMinibarToggle(container)}
                  {renderBBoxActionMinibar(container, { allowArm: true })}
                </div>
              </div>
              <div className="entity_builder_bbox_container_body">
                {renderNestedColumns(container)}
                {contained.map((bbox) => (
                  <article key={bbox.id} className={`entity_builder_bbox_card entity_builder_bbox_tree_node entity_builder_bbox_tree_node--${bbox.type === "imageBBox" ? "figure" : "paragraph"}`} data-bbox-type={bbox.type}>
                    <div className="entity_builder_bbox_top">
                      {editingNameId === bbox.id ? (
                        <input
                          className="entity_builder_bbox_name_input"
                          value={editingNameValue}
                          onChange={(e) => setEditingNameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitEditName(bbox);
                            if (e.key === "Escape") cancelEditName();
                          }}
                          onBlur={() => commitEditName(bbox)}
                          autoFocus
                        />
                      ) : (
                        <div className="entity_builder_bbox_name_row">
                          <div className="entity_builder_bbox_title">
                            {renderParagraphMergeCheckbox(bbox)}
                            <span className="entity_builder_bbox_type_block">
                              <strong>{bbox._displayTitle}</strong>
                              {renderBBoxId(bbox)}
                            </span>
                            {renderMinibarToggle(bbox)}
                          </div>
                          {renderBBoxActionMinibar(bbox)}
                        </div>
                      )}
                    </div>
                    {isImageBBox(bbox) ? (
                      <div className="entity_builder_bbox_image_wrap">
                        {bbox.imageDataUrl ? (
                          <img
                            className="entity_builder_bbox_image_preview"
                            src={bbox.imageDataUrl}
                            alt={bbox._displayTitle}
                            loading="lazy"
                          />
                        ) : (
                          <div className="entity_builder_bbox_image_empty">No image extracted yet.</div>
                        )}
                        <div className="entity_builder_bbox_image_meta">
                          {bbox.imageWidth && bbox.imageHeight ? `${bbox.imageWidth} × ${bbox.imageHeight}px` : "Image snippet"}
                        </div>
                        {textFor(bbox).trim() && <div className="entity_builder_bbox_text">{textFor(bbox)}</div>}
                      </div>
                    ) : !hasNestedColumns(bbox) ? (
                      <>
                        <div
                          className="entity_builder_bbox_text"
                          style={{ fontSize: `${bbox.fontSize || DEFAULT_ENTITY_BUILDER_TEXT_FONT_SIZE}px` }}
                        >
                          {paragraphDisplayText(bbox) || "No text extracted yet."}
                        </div>
                      </>
                    ) : null}
                    {renderNestedColumns(bbox)}
                  </article>
                ))}
              </div>
            </section>
          ))}
          {groupedBboxes.standalone.map((bbox) => (
            <article key={bbox.id} className={`entity_builder_bbox_card entity_builder_bbox_tree_node entity_builder_bbox_tree_node--${bbox.type === "imageBBox" ? "figure" : "paragraph"}`} data-bbox-type={bbox.type}>
              <div className="entity_builder_bbox_top">
                {editingNameId === bbox.id ? (
                  <input
                    className="entity_builder_bbox_name_input"
                    value={editingNameValue}
                    onChange={(e) => setEditingNameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitEditName(bbox);
                      if (e.key === "Escape") cancelEditName();
                    }}
                    onBlur={() => commitEditName(bbox)}
                    autoFocus
                  />
                ) : (
                  <div className="entity_builder_bbox_name_row">
                    <div className="entity_builder_bbox_title">
                      {renderParagraphMergeCheckbox(bbox)}
                      <span className="entity_builder_bbox_type_block">
                        <strong>{bbox._displayTitle}</strong>
                        {renderBBoxId(bbox)}
                      </span>
                      {renderMinibarToggle(bbox)}
                    </div>
                    {renderBBoxActionMinibar(bbox)}
                  </div>
                )}
              </div>
              {isImageBBox(bbox) ? (
                <div className="entity_builder_bbox_image_wrap">
                  {bbox.imageDataUrl ? (
                    <img
                      className="entity_builder_bbox_image_preview"
                      src={bbox.imageDataUrl}
                      alt={bbox._displayTitle}
                      loading="lazy"
                    />
                  ) : (
                    <div className="entity_builder_bbox_image_empty">No image extracted yet.</div>
                  )}
                  <div className="entity_builder_bbox_image_meta">
                    {bbox.imageWidth && bbox.imageHeight ? `${bbox.imageWidth} × ${bbox.imageHeight}px` : "Image snippet"}
                  </div>
                  {textFor(bbox).trim() && <div className="entity_builder_bbox_text">{textFor(bbox)}</div>}
                </div>
                ) : !hasNestedColumns(bbox) ? (
                  <>
                    <div
                      className="entity_builder_bbox_text"
                      style={{ fontSize: `${bbox.fontSize || DEFAULT_ENTITY_BUILDER_TEXT_FONT_SIZE}px` }}
                    >
                      {paragraphDisplayText(bbox) || "No text extracted yet."}
                    </div>
                  </>
                ) : null}
                {renderNestedColumns(bbox)}
              </article>
          ))}
        </div>
      )}
    </>
  );
  return (
    <div
      id="entity_builder_panel"
      style={width ? { width } : undefined}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div
        className="pdf_aside_resize_handle"
        onMouseDown={onResizeStart || undefined}
        onTouchStart={onResizeStart || undefined}
      />
      <div id="entity_builder_header">
        <span id="entity_builder_header_title">
          <i className="bx bx-network-chart" /> AMCTOSHS Segments Builder
        </span>
        <button type="button" id="entity_builder_close" onClick={onClose} title="Close">✕</button>
      </div>

      <div id="entity_builder_body">
        <div className="entity_builder_global_text_view">
          <div>
            <span className="entity_builder_global_text_label">BBox text</span>
            <span className="entity_builder_global_text_summary">
              {correctionSummary.applied} corrected
              {correctionSummary.suggested ? ` · ${correctionSummary.suggested} suggested` : ""}
              {correctionSummary.pending ? ` · ${correctionSummary.pending} pending` : ""}
              {correctionSummary.unresolved || correctionSummary.auditWarnings || correctionSummary.unaudited
                ? ` · ${correctionSummary.unresolved + correctionSummary.auditWarnings + correctionSummary.unaudited} review`
                : ""}
              {` · audit ${correctionSummary.audited}/${correctionSummary.audited + correctionSummary.unaudited}`}
              {` · ${correctionSummary.silentOmissions} omitted`}
            </span>
          </div>
          <div className="entity_builder_global_text_controls">
            <div className="entity_builder_text_tabs" role="tablist" aria-label="Text view for every BBox">
              <button
                type="button"
                role="tab"
                aria-selected={textView === "corrected"}
                className={textView === "corrected" ? "entity_builder_text_tab--active" : ""}
                onClick={() => setTextView("corrected")}
              >Corrected</button>
              <button
                type="button"
                role="tab"
                aria-selected={textView === "raw"}
                className={textView === "raw" ? "entity_builder_text_tab--active" : ""}
                onClick={() => setTextView("raw")}
              >Raw</button>
            </div>
            <div className="entity_builder_merge_tool">
              {paragraphMergeMode && (
                <span className="entity_builder_merge_count" aria-label={`${selectedParagraphIds.size} paragraphs selected`}>
                  {selectedParagraphIds.size}
                </span>
              )}
              <button
                type="button"
                className={`entity_builder_merge_icon${paragraphMergeMode ? " entity_builder_merge_icon--active" : ""}`}
                onClick={paragraphMergeMode ? mergeSelectedParagraphs : () => setParagraphMergeMode(true)}
                disabled={paragraphMergeMode
                  ? selectedParagraphIds.size < 2
                  : (!onMergeParagraphs || normalizedBboxes.filter((bbox) => bbox.type === "bbox").length < 2)}
                aria-label={paragraphMergeMode ? "Merge selected paragraphs" : "Select paragraphs to merge"}
                title={paragraphMergeMode ? "Merge selected paragraphs" : "Merge paragraphs"}
              >
                <i className="bx bx-merge" aria-hidden="true" />
              </button>
              {paragraphMergeMode && (
                <button
                  type="button"
                  className="entity_builder_merge_icon entity_builder_merge_cancel_icon"
                  onClick={cancelParagraphMerge}
                  aria-label="Cancel paragraph merge"
                  title="Cancel merge"
                >
                  <i className="bx bx-x" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        </div>
        {renderSegments()}
      </div>
    </div>
  );
};

export default EntityBuilderPanel;
