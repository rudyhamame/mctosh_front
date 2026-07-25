import React, { useMemo } from "react";
import "./entityBuilderPanel.css";
const EntityBuilderPanel = ({ onClose, bboxCards = [], pageNum = null }) => {
  const normalizedBboxes = useMemo(() => (
    (Array.isArray(bboxCards) ? bboxCards : [])
      .filter((bbox) => bbox && bbox.type === "bbox")
      .map((bbox, index) => ({
        ...bbox,
        _index: index + 1,
      }))
  ), [bboxCards]);

  return (
    <div id="entity_builder_panel" onMouseDown={(event) => event.stopPropagation()}>
      <div id="entity_builder_header">
        <span id="entity_builder_header_title">
          <i className="bx bx-network-chart" /> AMCTOSHS Entity Builder
        </span>
        <button type="button" id="entity_builder_close" onClick={onClose} title="Close">✕</button>
      </div>

      <div id="entity_builder_body">
        <div className="entity_builder_section_title">BBox Cards</div>
        {normalizedBboxes.length === 0 ? (
          <p className="entity_builder_helper">
            No bbox cards on page {pageNum ?? "?"} yet.
          </p>
        ) : (
          <div id="entity_builder_bbox_cards">
            {normalizedBboxes.map((bbox) => (
              <article key={bbox.id} className="entity_builder_bbox_card">
                <div className="entity_builder_bbox_top">
                  <div className="entity_builder_bbox_title">
                    <strong>BBox {bbox._index}</strong>
                    <span>page {pageNum ?? "?"}</span>
                  </div>
                </div>
                <div className="entity_builder_bbox_text">
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
