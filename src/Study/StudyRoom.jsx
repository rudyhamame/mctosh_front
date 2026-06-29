import React, { useEffect, useState } from "react";
import { useHistory } from "react-router-dom";
import StudyPDFPanel from "./StudyPDFPanel";
import { apiUrl } from "../config/api";
import { readStoredSession } from "../utils/sessionCleanup";
import "./studyRoom.css";

const authHeader = () => {
  const token = readStoredSession()?.token || "";
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const CARDS = [
  { key: "objects",   label: "Objects",   color: "#4fc3f7" },
  { key: "traces",    label: "Traces",    color: "#81c784" },
  { key: "phenomena", label: "Phenomena", color: "#f06292" },
  { key: "concept",   label: "Concepts",  color: "#ffb74d" },
  { key: "models",    label: "Models",    color: "#ce93d8" },
];

const ALL_MODES = ["sub-molecule","molecule","sub-cell","cell","sub-tissue","tissue","sub-organ","organ","sub-system","system","sub-human","human"];

const StudyRoom = () => {
  const history = useHistory();

  // ── Card data ──────────────────────────────────────────────────────────────
  const [hyleData,   setHyleData]   = useState(null);
  const [cardTab,    setCardTab]    = useState("objects");
  const [cardLoading, setCardLoading] = useState(true);

  // ── Source / PDF state ────────────────────────────────────────────────────
  const [sources,    setSources]    = useState([]);
  const [activeSource, setActiveSource] = useState(null); // { _id, name }

  useEffect(() => {
    // Load PDF sources
    fetch(apiUrl("/api/sources/"), { headers: authHeader() })
      .then(r => r.json())
      .then(d => setSources((d.sources || []).filter(s => s.type === "pdf")))
      .catch(() => {});

    // Load latest hyle extraction
    setCardLoading(true);
    fetch(apiUrl("/api/pdf/history"), { headers: authHeader() })
      .then(r => r.json())
      .then(d => {
        const ex = d.extractions?.[0];
        if (!ex) return;
        return fetch(apiUrl(`/api/pdf/history/${ex._id}`), { headers: authHeader() })
          .then(r => r.json())
          .then(({ extraction }) => {
            const data = { objects: {}, traces: {}, phenomena: {}, concept: {}, models: {} };
            for (const card of Object.keys(data)) {
              data[card] = Object.fromEntries(ALL_MODES.map(m => [m, []]));
            }
            for (const noun of extraction.nouns || []) {
              if (data[noun.card]?.[noun.mode]) data[noun.card][noun.mode].push(noun);
            }
            setHyleData(data);
          });
      })
      .catch(() => {})
      .finally(() => setCardLoading(false));
  }, []);

  const activeRows = hyleData
    ? ALL_MODES.flatMap(m => (hyleData[cardTab]?.[m] || []).map(it => ({ ...it, mode: m })))
    : [];

  return (
    <div id="study_page">
      {/* ── Header ── */}
      <div id="study_header">
        <button id="study_back_btn" onClick={() => history.push("/home")}>←</button>
        <span id="study_title">MCTOSH Representation Space</span>

        <div id="study_source_wrap">
          <select
            id="study_source_select"
            value={activeSource?._id || ""}
            onChange={e => {
              const s = sources.find(x => x._id === e.target.value);
              setActiveSource(s || null);
            }}
          >
            <option value="">— Mount PDF source —</option>
            {sources.map(s => (
              <option key={s._id} value={s._id}>{s.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Body ── */}
      <div id="study_body">

        {/* ── Left: compact cards ── */}
        <div id="study_cards_panel">
          <div id="study_card_tabs">
            {CARDS.map(c => (
              <button
                key={c.key}
                className={`study_card_tab${cardTab === c.key ? " study_card_tab--active" : ""}`}
                style={{ "--card-color": c.color }}
                onClick={() => setCardTab(c.key)}
              >
                {c.label}
              </button>
            ))}
          </div>

          <div id="study_card_body">
            {cardLoading ? (
              <p className="study_card_empty">Loading…</p>
            ) : activeRows.length === 0 ? (
              <p className="study_card_empty">No hyles yet</p>
            ) : (
              <table id="study_card_table">
                <tbody>
                  {activeRows.map((it, i) => (
                    <tr key={it.id || i} className={`study_hyle_row study_hyle_row--${it.status?.value || "pending"}`}>
                      <td className="study_td_num">{it.num}</td>
                      <td className="study_td_noun">{it.noun}</td>
                      <td className="study_td_mode">{it.mode}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* ── Right: PDF viewer + annotation ── */}
        <div id="study_pdf_panel">
          <StudyPDFPanel
            sourceId={activeSource?._id || null}
            sourceName={activeSource?.name || ""}
          />
        </div>
      </div>
    </div>
  );
};

export default StudyRoom;
