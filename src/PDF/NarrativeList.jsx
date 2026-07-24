import React from "react";
import { buildListTree } from "./pdfSegmentTree.js";

// Real nested <ul>/<ol> rendering for a v2 "list" element — replaces the
// pre-redesign flat one-<li>-per-segment rendering. markerType drives the
// tag/list-style so a numbered/roman/alpha list reads with its own real
// markers (not always a bullet), and a nested childList renders as a real
// nested <ul>/<ol> INSIDE its own parent <li>, matching how an outline
// actually looks — not a sibling flattened back out to the top level.
const LIST_STYLE_BY_MARKER = {
  bullet: { tag: "ul", style: "disc" },
  numbered: { tag: "ol", style: "decimal" },
  alpha: { tag: "ol", style: "lower-alpha" },
  roman: { tag: "ol", style: "lower-roman" },
};

const ListItemNode = ({ item, onJumpToSource, getText }) => {
  const handleClick = (event) => {
    event.stopPropagation();
    if (window.getSelection?.()?.toString()) return; // a drag-to-select shouldn't also jump the PDF view
    onJumpToSource?.(item.bbox ? [item.bbox] : []);
  };
  return (
    <li className="narrative_seg_list_item" onClick={handleClick} title="Jump to source">
      {getText(item)}
      {item.childList && <NarrativeList listElement={item.childList} onJumpToSource={onJumpToSource} getText={getText} nested />}
    </li>
  );
};

const NarrativeList = ({ listElement, elementsById, onJumpToSource, getText, nested = false }) => {
  // Top-level callers pass a raw "list" element + elementsById; nested
  // recursive calls (from ListItemNode above) already pass a built tree
  // (via item.childList, itself the output of buildListTree) with no
  // elementsById needed a second time.
  const tree = elementsById ? buildListTree(listElement, elementsById) : listElement;
  if (!tree?.items?.length) return null;
  const { tag: Tag, style } = LIST_STYLE_BY_MARKER[tree.items[0]?.listMeta?.markerType] || LIST_STYLE_BY_MARKER.bullet;
  return (
    <Tag className={`narrative_seg_list${nested ? " narrative_seg_list--nested" : ""}`} style={{ listStyleType: style }}>
      {tree.items.map((item) => (
        <ListItemNode key={item.id} item={item} onJumpToSource={onJumpToSource} getText={getText} />
      ))}
    </Tag>
  );
};

export default NarrativeList;
