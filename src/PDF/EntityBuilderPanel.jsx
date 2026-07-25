import React, { useMemo, useState } from "react";
import "./entityBuilderPanel.css";

const DEFAULT_ENTITY_BUILDER_TEXT_FONT_SIZE = 12;

const EntityBuilderPanel = ({
  onClose,
  bboxCards = [],
  pageNum = null,
  pageCount = 0,
  onPageChange = null,
  onUpdateBBoxFontSize = null,
  onUpdateBBoxName = null,
  onDeleteBBox = null,
  onMoveBBoxUp = null,
  onMoveBBoxDown = null,
  onArmBBoxInsideContainer = null,
  armedBBoxInsideContainer = null,
}) => {
  const [editingNameId, setEditingNameId] = useState(null);
  const [editingNameValue, setEditingNameValue] = useState("");
  const normalizedBboxes = useMemo(() => (
    (Array.isArray(bboxCards) ? bboxCards : [])
      .filter((bbox) => bbox && bbox.type === "bbox")
      .map((bbox, index) => ({
        ...bbox,
        _index: index + 1,
      }))
  ), [bboxCards]);
  const sharedFontSize = useMemo(() => {
    if (!normalizedBboxes.length) return DEFAULT_ENTITY_BUILDER_TEXT_FONT_SIZE;
    const sizes = normalizedBboxes.map((bbox) => Math.min(24, Math.max(10, Math.round(Number(bbox.fontSize) || DEFAULT_ENTITY_BUILDER_TEXT_FONT_SIZE))));
    return sizes.every((size) => size === sizes[0]) ? sizes[0] : null;
  }, [normalizedBboxes]);
  const displayedFontSize = sharedFontSize ?? DEFAULT_ENTITY_BUILDER_TEXT_FONT_SIZE;
  const bboxContainers = useMemo(() => (
    (Array.isArray(bboxCards) ? bboxCards : [])
      .filter((bbox) => bbox && bbox.type === "bboxContainer")
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
  const canGoPrevPage = Boolean(onPageChange) && pageNum > 1;
  const canGoNextPage = Boolean(onPageChange) && pageNum < pageCount;
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
        aria-label={`Move ${bbox._displayTitle || "bbox"} up`}
        title="Move up"
        disabled={!canMoveUp}
      >
        {moveUpIcon}
      </button>
      <button
        type="button"
        className="entity_builder_bbox_name_btn"
        onClick={() => onMoveBBoxDown?.(bbox.id, pageNum)}
        aria-label={`Move ${bbox._displayTitle || "bbox"} down`}
        title="Move down"
        disabled={!canMoveDown}
      >
        {moveDownIcon}
      </button>
    </>
  );
  const goPrevPage = () => onPageChange?.(Math.max(1, pageNum - 1));
  const goNextPage = () => onPageChange?.(Math.min(pageCount || pageNum + 1, pageNum + 1));
  const armContainerBBox = (container) => onArmBBoxInsideContainer?.(container.id, pageNum);

  return (
    <div
      id="entity_builder_panel"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div id="entity_builder_header">
        <span id="entity_builder_header_title">
          <i className="bx bx-network-chart" /> AMCTOSHS Entity Builder
        </span>
        <button type="button" id="entity_builder_close" onClick={onClose} title="Close">✕</button>
      </div>

      <div id="entity_builder_body">
        <div className="entity_builder_bbox_meta_row entity_builder_bbox_meta_row--top">
          <label className="entity_builder_bbox_font_label" htmlFor="entity_builder_bbox_font_all">
            All Cards Font Size
          </label>
          <div className="entity_builder_bbox_font_control">
            <button
              type="button"
              className="entity_builder_bbox_font_btn"
              onClick={() => onUpdateBBoxFontSize?.(displayedFontSize - 1, pageNum)}
              disabled={!onUpdateBBoxFontSize || displayedFontSize <= 10}
              aria-label="Decrease bbox font size for all cards"
              title="Decrease font size for all cards"
            >
              <i className="bx bx-minus" />
            </button>
            <span className="entity_builder_bbox_font_value">
              {sharedFontSize == null ? `${displayedFontSize}px*` : `${displayedFontSize}px`}
            </span>
            <button
              type="button"
              className="entity_builder_bbox_font_btn"
              onClick={() => onUpdateBBoxFontSize?.(displayedFontSize + 1, pageNum)}
              disabled={!onUpdateBBoxFontSize || displayedFontSize >= 24}
              aria-label="Increase bbox font size for all cards"
              title="Increase font size for all cards"
            >
              <i className="bx bx-plus" />
            </button>
          </div>
        </div>
        <div className="entity_builder_page_nav">
          <button
            type="button"
            className="entity_builder_page_nav_btn"
            onClick={goPrevPage}
            disabled={!canGoPrevPage}
            title="Previous builder page"
            aria-label="Previous builder page"
          >
            ‹
          </button>
          <span className="entity_builder_page_nav_label">
            Page {pageNum ?? "?"} / {pageCount || "?"}
          </span>
          <button
            type="button"
            className="entity_builder_page_nav_btn"
            onClick={goNextPage}
            disabled={!canGoNextPage}
            title="Next builder page"
            aria-label="Next builder page"
          >
            ›
          </button>
        </div>
        <div className="entity_builder_section_title">BBox Cards</div>
        {normalizedBboxes.length === 0 && bboxContainers.length === 0 ? (
          <p className="entity_builder_helper">
            No bbox cards on page {pageNum ?? "?"} yet.
          </p>
        ) : (
          <div id="entity_builder_bbox_cards">
            {groupedBboxes.groups.map(({ container, contained, _index }) => (
              <section key={container.id} className="entity_builder_bbox_container">
                <div className="entity_builder_bbox_container_header">
                  <div className="entity_builder_bbox_name_row">
                    <strong>{container.title?.trim() || `BBox Container ${_index}`}</strong>
                    <button
                      type="button"
                      className={`entity_builder_bbox_name_btn${armedBBoxInsideContainer?.containerId === container.id && armedBBoxInsideContainer?.pageNum === pageNum ? " entity_builder_bbox_name_btn--active" : ""}`}
                      onClick={() => armContainerBBox(container)}
                      aria-label={`Add bbox inside ${container.title?.trim() || `BBox Container ${_index}`}`}
                      title="Add bbox inside container"
                      disabled={!onArmBBoxInsideContainer}
                    >
                      {containerBBoxIcon}
                    </button>
                    <button
                      type="button"
                      className="entity_builder_bbox_name_btn"
                      onClick={() => startEditName(container)}
                      aria-label={`Edit BBox Container ${_index} name`}
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
                                title="Delete bbox"
                                disabled={!onDeleteBBox}
                              >
                                <i className="bx bx-trash" />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                      <div
                        className="entity_builder_bbox_text"
                        style={{ fontSize: `${bbox.fontSize || DEFAULT_ENTITY_BUILDER_TEXT_FONT_SIZE}px` }}
                      >
                        {bbox.text?.trim() ? bbox.text : "No text extracted yet."}
                      </div>
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
                          title="Delete bbox"
                          disabled={!onDeleteBBox}
                        >
                          <i className="bx bx-trash" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <div
                  className="entity_builder_bbox_text"
                  style={{ fontSize: `${bbox.fontSize || DEFAULT_ENTITY_BUILDER_TEXT_FONT_SIZE}px` }}
                >
                  {bbox.text?.trim() ? bbox.text : "No text extracted yet."}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default EntityBuilderPanel;
