import React, { useState } from "react";
import "./hyleCards.css";

const currentStatus = (item) => item.status?.value || "pending";

const CARDS = [
  { key: "objects",   label: "Objects" },
  { key: "traces",    label: "Traces" },
  { key: "phenomena", label: "Phenomena" },
  { key: "concept",   label: "Concept" },
  { key: "models",    label: "Models" },
];

const MODES = [
  { key: "sub-molecule", label: "sub-Molecule" },
  { key: "molecule",     label: "Molecule" },
  { key: "sub-cell",     label: "sub-Cell" },
  { key: "cell",         label: "Cell" },
  { key: "sub-tissue",   label: "sub-Tissue" },
  { key: "tissue",       label: "Tissue" },
  { key: "sub-organ",    label: "sub-Organ" },
  { key: "organ",        label: "Organ" },
  { key: "sub-system",   label: "sub-System" },
  { key: "system",       label: "System" },
  { key: "sub-human",    label: "sub-Human" },
  { key: "human",        label: "Human" },
];

const HyleRow = ({ item, cardKey, modeKey, index, onStatus, onMove, onDelete }) => {
  const [moveCard, setMoveCard] = useState(cardKey);
  const [moveMode, setMoveMode] = useState(modeKey);

  const applyMove = (newCard, newMode) => onMove(cardKey, modeKey, index, newCard, newMode);

  const handleCardChange = (e) => { setMoveCard(e.target.value); applyMove(e.target.value, moveMode); };
  const handleModeChange = (e) => { setMoveMode(e.target.value); applyMove(moveCard, e.target.value); };

  const status = currentStatus(item);

  return (
    <tr className={`hyle_row noun_row--${status}`}>
      <td className="hyle_td_num">{item.num}</td>
      <td className="hyle_td_hyle">{item.noun}</td>
      <td className="hyle_td_mode">
        <select className="ncc_select" value={moveMode} onChange={handleModeChange} title="Mode">
          {MODES.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}
        </select>
      </td>
      <td className="hyle_td_card">
        <select className="ncc_select" value={moveCard} onChange={handleCardChange} title="Card">
          {CARDS.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}
        </select>
      </td>
      <td className="hyle_td_actions">
        <button
          className={`ncc_btn ncc_accept${status === "accepted" ? " ncc_active" : ""}`}
          title="Accept"
          onClick={() => onStatus(cardKey, modeKey, index, "accepted")}
        >✓</button>
        <button
          className={`ncc_btn ncc_reject${status === "rejected" ? " ncc_active" : ""}`}
          title="Reject"
          onClick={() => onStatus(cardKey, modeKey, index, "rejected")}
        >✕</button>
        <button
          className="ncc_btn ncc_delete"
          title="Delete"
          onClick={() => onDelete(cardKey, modeKey, index)}
        >🗑</button>
      </td>
    </tr>
  );
};

const HyleCards = ({ data, streaming, onStatus, onMove, onDelete, activeCard = "objects", fontSize = 1 }) => {
  const card = CARDS.find((c) => c.key === activeCard) || CARDS[0];

  const rows = MODES.flatMap(({ key: modeKey }) =>
    (data?.[card.key]?.[modeKey] || []).map((item, i) => ({ item, modeKey, index: i }))
  );

  return (
    <div className="hyle_tabs_root">
      <div className={`hyle_card noun_card--${activeCard}`}>
        <div className="hyle_table_wrap" style={{ fontSize: `${fontSize}rem` }}>
          <table className="hyle_table">
            <thead>
              <tr>
                <th className="hyle_th_num">#</th>
                <th className="hyle_th_hyle">Hyle</th>
                <th className="hyle_th_mode">Mode</th>
                <th className="hyle_th_card">Card</th>
                <th className="hyle_th_actions"></th>
              </tr>
            </thead>
            <tbody>
              {streaming && rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="hyle_loading_row">
                    <span className="hyle_streaming_dot" />
                    Asking AI to extract nouns…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="hyle_empty_row">No nouns yet</td>
                </tr>
              ) : (
                rows.map(({ item, modeKey, index }) => (
                  <HyleRow
                    key={item.id || `${modeKey}_${index}`}
                    item={item}
                    cardKey={card.key}
                    modeKey={modeKey}
                    index={index}
                    onStatus={onStatus}
                    onMove={onMove}
                    onDelete={onDelete}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default HyleCards;
