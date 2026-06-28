import React, { useState } from "react";

const currentStatus = (item) => item.status?.value || "pending";
import "./nounCards.css";

const CARDS = [
  { key: "objects",    label: "Objects" },
  { key: "traces",     label: "Traces" },
  { key: "phenomena",  label: "Phenomena" },
  { key: "concept",    label: "Concept" },
];

const MODES = [
  { key: "sub-molecule", label: "sub-Molecule",  sub: true },
  { key: "molecule",     label: "Molecule",      sub: false },
  { key: "sub-cell",     label: "sub-Cell",      sub: true },
  { key: "cell",         label: "Cell",          sub: false },
  { key: "sub-tissue",   label: "sub-Tissue",    sub: true },
  { key: "tissue",       label: "Tissue",        sub: false },
  { key: "sub-organ",    label: "sub-Organ",     sub: true },
  { key: "organ",        label: "Organ",         sub: false },
  { key: "sub-system",   label: "sub-System",    sub: true },
  { key: "system",       label: "System",        sub: false },
  { key: "sub-human",    label: "sub-Human",     sub: true },
  { key: "human",        label: "Human",         sub: false },
];

const NounChip = ({ item, cardKey, modeKey, index, onStatus, onMove }) => {
  const [moveCard, setMoveCard] = useState(cardKey);
  const [moveMode, setMoveMode] = useState(modeKey);

  const applyMove = (newCard, newMode) => {
    onMove(cardKey, modeKey, index, newCard, newMode);
  };

  const handleCardChange = (e) => {
    const val = e.target.value;
    setMoveCard(val);
    applyMove(val, moveMode);
  };

  const handleModeChange = (e) => {
    const val = e.target.value;
    setMoveMode(val);
    applyMove(moveCard, val);
  };

  const { id, noun, reason } = item;
  const status = currentStatus(item);

  return (
    <span className={`noun_chip noun_chip--${status}`}>
      <span className="noun_chip_id">{id}</span>
      <span className="noun_chip_noun">{noun}</span>
      {reason && <span className="noun_chip_reason">{reason}</span>}
      <div className="noun_chip_controls">
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
        <select className="ncc_select" value={moveCard} onChange={handleCardChange} title="Move to card">
          {CARDS.map(({ key, label }) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
        <select className="ncc_select" value={moveMode} onChange={handleModeChange} title="Move to mode">
          {MODES.map(({ key, label }) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </div>
    </span>
  );
};

const NounCards = ({ data, streaming, onStatus, onMove }) => {
  const [active, setActive] = useState("objects");
  const card = CARDS.find((c) => c.key === active);

  return (
    <div className="noun_tabs_root">
      <div className="noun_tabs_bar">
        {CARDS.map(({ key, label }) => {
          const count = MODES.reduce((n, m) => n + (data?.[key]?.[m.key]?.length || 0), 0);
          return (
            <button
              key={key}
              className={`noun_tab noun_tab--${key}${active === key ? " noun_tab--active" : ""}`}
              onClick={() => setActive(key)}
            >
              {label}
              {count > 0 && <span className="noun_tab_count">{count}</span>}
              {streaming && <span className="noun_streaming_dot" />}
            </button>
          );
        })}
      </div>

      <div className={`noun_card noun_card--${active}`}>
        <div className="noun_table_wrap">
          <table className="noun_table">
            <thead>
              <tr>
                {MODES.map(({ key, label, sub }) => (
                  <th key={key} className={sub ? "noun_th--sub" : ""}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {streaming && MODES.every(({ key: m }) => (data?.[card.key]?.[m]?.length || 0) === 0) ? (
                <tr>
                  <td colSpan={MODES.length} className="noun_loading_row">
                    <span className="noun_streaming_dot" />
                    Asking AI to extract nouns…
                  </td>
                </tr>
              ) : (
                <tr>
                  {MODES.map(({ key: modeKey, sub }) => {
                    const words = data?.[card.key]?.[modeKey] || [];
                    return (
                      <td key={modeKey} className={sub ? "noun_td--sub" : ""}>
                        {words.length > 0 && (
                          <div className="noun_chips">
                            {words.map((item, i) => (
                              <NounChip
                                key={item.id || i}
                                item={item}
                                cardKey={card.key}
                                modeKey={modeKey}
                                index={i}
                                onStatus={onStatus}
                                onMove={onMove}
                              />
                            ))}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default NounCards;
