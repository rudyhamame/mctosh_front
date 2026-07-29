import React, { useMemo, useState } from "react";
import "./entityBuilderPanel.css";
import { BBOX_CARD_TYPES, bboxTypeHas } from "./pdfBBoxTypes.js";

const DEFAULT_ENTITY_BUILDER_TEXT_FONT_SIZE = 12;

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
  onArmBBoxInsideContainer = null,
  armedBBoxInsideContainer = null,
}) => {
  const [editingNameId, setEditingNameId] = useState(null);
  const [editingNameValue, setEditingNameValue] = useState("");
  const isImageBBox = (bbox) => bboxTypeHas(bbox?.type, "capturesImage");
  const normalizedBboxes = useMemo(() => (
    (Array.isArray(bboxCards) ? bboxCards : [])
      .filter((bbox) => bbox && BBOX_CARD_TYPES.has(bbox.type))
      .map((bbox, index) => ({
        ...bbox,
        _index: index + 1,
      }))
  ), [bboxCards]);
  const bboxContainers = useMemo(() => (
    (Array.isArray(bboxCards) ? bboxCards : [])
      .filter((bbox) => bbox && bboxTypeHas(bbox.type, "containsChildren"))
  ), [bboxCards]);
  const groupedBboxes = useMemo(() => {
    const assigned = new Set();
    const groups = bboxContainers.map((container, containerIndex) => {
      const contained = normalizedBboxes.filter((bbox) => {
        if (assigned.has(bbox.id)) return false;
        const inset = 2;
        const within =
          bbox.x >= (container.x - inset)
          && bbox.y >= (container.y - inset)
          && bbox.x + bbox.w <= container.x + container.w + inset
          && bbox.y + bbox.h <= container.y + container.h + inset;
        if (within) assigned.add(bbox.id);
        return within;
      });
      return contained.length ? { container, contained, _index: containerIndex + 1 } : null;
    }).filter(Boolean);
    const standalone = normalizedBboxes.filter((bbox) => !assigned.has(bbox.id));
    return { groups, standalone };
  }, [bboxContainers, normalizedBboxes]);

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
        onClick={() => onMoveBBoxUp?.(bbox.id, pageNum)}
        aria-label={`Move ${bbox._displayTitle || "segment"} up`}
        title="Move up"
        disabled={!canMoveUp}
      >
        {moveUpIcon}
      </button>
      <button
        type="button"
        className="entity_builder_bbox_name_btn"
        onClick={() => onMoveBBoxDown?.(bbox.id, pageNum)}
        aria-label={`Move ${bbox._displayTitle || "segment"} down`}
        title="Move down"
        disabled={!canMoveDown}
      >
        {moveDownIcon}
      </button>
    </>
  );
  const armContainerBBox = (container) => onArmBBoxInsideContainer?.(container.id, pageNum);
  const renderSegments = () => (
    <>
      {normalizedBboxes.length === 0 && bboxContainers.length === 0 ? (
        <p className="entity_builder_helper">
          No segments on page {pageNum ?? "?"} yet.
        </p>
      ) : (
        <div id="entity_builder_bbox_cards">
          {groupedBboxes.groups.map(({ container, contained, _index }) => (
            <section key={container.id} className="entity_builder_bbox_container">
              <div className="entity_builder_bbox_container_header">
                <div className="entity_builder_bbox_name_row">
                  <strong>{container.title?.trim() || `Segment Container ${_index}`}</strong>
                  <button
                    type="button"
                    className={`entity_builder_bbox_name_btn${armedBBoxInsideContainer?.containerId === container.id && armedBBoxInsideContainer?.pageNum === pageNum ? " entity_builder_bbox_name_btn--active" : ""}`}
                    onClick={() => armContainerBBox(container)}
                    aria-label={`Add segment inside ${container.title?.trim() || `Segment Container ${_index}`}`}
                    title="Add segment inside container"
                    disabled={!onArmBBoxInsideContainer}
                  >
                    {containerBBoxIcon}
                  </button>
                  <button
                    type="button"
                    className="entity_builder_bbox_name_btn"
                    onClick={() => startEditName(container)}
                    aria-label={`Edit Segment Container ${_index} name`}
                    title="Edit name"
                    >
                      <i className="bx bx-edit" />
                    </button>
                  {renderMoveButtons(container)}
                </div>
                <span>{contained.length} card{contained.length !== 1 ? "s" : ""}</span>
              </div>
              <div className="entity_builder_bbox_container_body">
                {contained.map((bbox) => (
                  <article key={bbox.id} className="entity_builder_bbox_card">
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
                            <strong>{bbox._displayTitle}</strong>
                          </div>
                          <div className="entity_builder_bbox_actions">
                            {renderMoveButtons(bbox)}
                            <button
                              type="button"
                              className="entity_builder_bbox_name_btn"
                              onClick={() => startEditName(bbox)}
                              aria-label={`Edit ${bbox._displayTitle}`}
                              title="Edit name"
                            >
                              <i className="bx bx-edit" />
                            </button>
                            <button
                              type="button"
                              className="entity_builder_bbox_name_btn entity_builder_bbox_name_btn--danger"
                              onClick={() => handleDeleteBBox(bbox)}
                              aria-label={`Delete ${bbox._displayTitle}`}
                              title="Delete segment"
                              disabled={!onDeleteBBox}
                            >
                              <i className="bx bx-trash" />
                            </button>
                          </div>
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
                      </div>
                    ) : (
                      <div
                        className="entity_builder_bbox_text"
                        style={{ fontSize: `${bbox.fontSize || DEFAULT_ENTITY_BUILDER_TEXT_FONT_SIZE}px` }}
                      >
                        {bbox.text?.trim() ? bbox.text : "No text extracted yet."}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </section>
          ))}
          {groupedBboxes.standalone.map((bbox) => (
            <article key={bbox.id} className="entity_builder_bbox_card">
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
                      <strong>{bbox._displayTitle}</strong>
                    </div>
                    <div className="entity_builder_bbox_actions">
                      {renderMoveButtons(bbox)}
                      <button
                        type="button"
                        className="entity_builder_bbox_name_btn"
                        onClick={() => startEditName(bbox)}
                        aria-label={`Edit ${bbox._displayTitle}`}
                        title="Edit name"
                      >
                        <i className="bx bx-edit" />
                      </button>
                      <button
                        type="button"
                        className="entity_builder_bbox_name_btn entity_builder_bbox_name_btn--danger"
                        onClick={() => handleDeleteBBox(bbox)}
                        aria-label={`Delete ${bbox._displayTitle}`}
                        title="Delete segment"
                        disabled={!onDeleteBBox}
                      >
                        <i className="bx bx-trash" />
                      </button>
                    </div>
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
                </div>
              ) : (
                <div
                  className="entity_builder_bbox_text"
                  style={{ fontSize: `${bbox.fontSize || DEFAULT_ENTITY_BUILDER_TEXT_FONT_SIZE}px` }}
                >
                  {bbox.text?.trim() ? bbox.text : "No text extracted yet."}
                </div>
              )}
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
        {renderSegments()}
      </div>
    </div>
  );
};

export default EntityBuilderPanel;
