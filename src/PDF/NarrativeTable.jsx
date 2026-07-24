import React from "react";
import { buildTableGrid } from "./pdfSegmentTree.js";

// Real <table> grid rendering for a v2 "table" element — replaces the
// pre-redesign flattened captioned-box rendering. `table` is the
// structure's own tables[] entry (rows/cols/cells, from Docling's
// TableFormer structure with native-PyMuPDF-sourced cell text — see
// back/helpers/pdfStructureFusion.js). buildTableGrid resolves rowSpan/
// colSpan into a rows[][] grid where only the owning (top-left) slot of a
// merged cell renders a real <td>; every other slot it covers renders
// nothing (the browser's own rowSpan/colSpan attributes account for the
// visual space).
const NarrativeTable = ({ table, tableElement, onJumpToSource, title }) => {
  if (!table) return null;
  const grid = buildTableGrid(table);
  if (!grid.length) return null;
  const handleCellClick = (cell) => (event) => {
    event.stopPropagation();
    if (window.getSelection?.()?.toString()) return; // a drag-to-select shouldn't also jump the PDF view
    onJumpToSource?.(cell?.bbox ? [cell.bbox] : (tableElement?.bbox ? [tableElement.bbox] : []));
  };
  const handleTitleClick = (event) => {
    event.stopPropagation();
    onJumpToSource?.(tableElement?.bbox ? [tableElement.bbox] : []);
  };
  return (
    <div className="narrative_seg_table_wrap">
      <div className="narrative_seg_table_title" onClick={handleTitleClick} title="Jump to source">{title || "Table"}</div>
      <table className="narrative_seg_table">
        <tbody>
          {grid.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, colIndex) => {
                if (!cell || cell.spanned) return null;
                return (
                  <td
                    key={colIndex}
                    rowSpan={cell.rowSpan || 1}
                    colSpan={cell.colSpan || 1}
                    onClick={handleCellClick(cell)}
                    title="Jump to source"
                  >
                    {cell.text}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default NarrativeTable;
