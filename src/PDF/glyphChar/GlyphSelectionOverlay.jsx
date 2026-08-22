import React from "react";

export const glyphBoxToViewport = (bbox, scale) => ({
  left: bbox.x * scale,
  top: bbox.y * scale,
  width: Math.max(1, bbox.width * scale),
  height: Math.max(1, bbox.height * scale),
});

const GlyphSelectionOverlay = ({ glyph, scale }) => {
  if (!glyph?.bbox || glyph.visible === false) return null;
  return (
    <div className="glyph_char_selection_layer" aria-hidden="true">
      <div className="glyph_char_selection_box" style={glyphBoxToViewport(glyph.bbox, scale)} />
    </div>
  );
};

export default GlyphSelectionOverlay;

