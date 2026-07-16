import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiUrl } from "../config/api";
import { readStoredSession } from "../utils/sessionCleanup";
import HyleCards from "../PDF/HyleCards";
import "./cardPage.css";

const authFetch = (url, options = {}) => {
  const token = readStoredSession()?.token || "";
  return fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` },
  });
};

const ALL_MODES = ["sub-molecule","molecule","sub-cell","cell","sub-tissue","tissue","sub-organ","organ","sub-system","system","sub-human","human"];
const modeObj   = () => Object.fromEntries(ALL_MODES.map((m) => [m, []]));
const EMPTY_HYLES = () => ({
  entities: modeObj(), traces: modeObj(), phenomena: modeObj(),
  concept: modeObj(), models: modeObj(), _total: 0,
});

const CARDS = [
  { key: "entities",  label: "Entities" },
  { key: "traces",    label: "Traces" },
  { key: "phenomena", label: "Phenomena" },
  { key: "concept",   label: "Concept" },
  { key: "models",    label: "Models" },
];

const initStatus = () => ({ value: "pending", at: new Date().toISOString() });

// "objects" was the card name before the Entities rename — extractions saved
// before that rename still have nouns tagged "objects" in the database, so
// reads alias it to "entities" here rather than losing that historical data.
const normalizeCard = (card) => (card === "objects" ? "entities" : card);

const inflateExtraction = (extraction) => {
  const data = EMPTY_HYLES();
  for (const { id, num, noun, card, mode, reason, status } of extraction.nouns || []) {
    const normalizedCard = normalizeCard(card);
    if (data[normalizedCard]?.[mode]) {
      data[normalizedCard][mode].push({ id, num, noun, reason: reason || "", status: status?.value ? status : initStatus() });
    }
  }
  data._total = extraction.totalNouns || 0;
  return data;
};

const deflateNounData = (hyleData) => {
  const nouns = [];
  for (const card of ["entities","traces","phenomena","concept","models"]) {
    for (const mode of ALL_MODES) {
      for (const item of hyleData[card]?.[mode] || []) {
        nouns.push({ id: item.id, num: item.num, noun: item.noun, card, mode, reason: item.reason || "", status: item.status });
      }
    }
  }
  return nouns;
};

const CardPage = () => {
  const navigate = useNavigate();
  const { card: urlCard } = useParams();
  const activeCard = CARDS.find((c) => c.key === urlCard)?.key || "entities";

  const [hyleData,  setHyleData]  = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [fontSize,  setFontSize]  = useState(1);
  const [activeTab, setActiveTab] = useState(activeCard);

  // Hyle add form
  const [addHyle,   setAddHyle]   = useState("");
  const [addCard,   setAddCard]   = useState(activeCard);
  const nounInputRef = useRef(null);

  // Extraction metadata needed to save back
  const extractionMeta = useRef(null);

  useEffect(() => {
    setLoading(true);
    authFetch(apiUrl("/api/pdf/history"))
      .then((r) => r.json())
      .then((d) => {
        const extractions = d.extractions || [];
        if (extractions.length === 0) return;
        const first = extractions[0];
        return authFetch(apiUrl(`/api/pdf/history/${first._id}`))
          .then((r) => r.json())
          .then((data) => {
            const ex = data.extraction;
            setHyleData(inflateExtraction(ex));
            extractionMeta.current = {
              filename:   ex.documentId?.filename || "unknown.pdf",
              pageCount:  ex.documentId?.pageCount || 1,
              type:       ex.type || "text-based",
              pageNumber: ex.pageNumber,
              provider:   ex.provider || "manual",
              model:      ex.model    || "user",
              systemMessageSnapshot: ex.systemMessageSnapshot || "",
            };
          });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleAddNoun = useCallback(async () => {
    const noun = addHyle.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.,;:]+$/, "");
    if (!noun) return;

    const mode = "organ";
    const base = hyleData || EMPTY_HYLES();

    // Deduplicate
    const exists = ["entities","traces","phenomena","concept","models"].some((c) =>
      ALL_MODES.some((m) => base[c][m].some((it) => it.noun === noun))
    );
    if (exists) return;

    const num  = (base[addCard][mode]?.length || 0) + 1;
    const next = {
      ...base,
      [addCard]: {
        ...base[addCard],
        [mode]: [...base[addCard][mode], { id: `${addCard}_${mode}_${Date.now()}`, num, noun, reason: "manual", status: initStatus() }],
      },
      _total: (base._total || 0) + 1,
    };

    setHyleData(next);
    setAddHyle("");
    nounInputRef.current?.focus();

    if (!extractionMeta.current) return;
    setSaving(true);
    try {
      await authFetch(apiUrl("/api/pdf/save-extraction"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...extractionMeta.current,
          nouns: deflateNounData(next),
          totalNouns: next._total,
        }),
      });
    } catch {}
    finally { setSaving(false); }
  }, [addHyle, addCard, hyleData]);

  return (
    <div id="card_page">
      <div id="card_header">
        <button className="card_home_btn" onClick={() => navigate("/home")}>⌂</button>
        <span id="card_header_title">
          {CARDS.find((c) => c.key === activeTab)?.label || activeTab}
        </span>
        <div className="hyle_font_controls" id="card_font_controls">
          <button className="hyle_font_btn" onClick={() => setFontSize((s) => Math.max(0.5, +(s - 0.05).toFixed(2)))} disabled={fontSize <= 0.5}>−</button>
          <span className="hyle_font_label">{Math.round(fontSize * 100)}%</span>
          <button className="hyle_font_btn" onClick={() => setFontSize((s) => Math.min(1.6, +(s + 0.05).toFixed(2)))} disabled={fontSize >= 1.6}>+</button>
        </div>
      </div>

      {/* Add noun bar */}
      <div id="card_add_bar">
        <input
          ref={nounInputRef}
          id="card_hyle_input"
          type="text"
          placeholder="Add hyle…"
          value={addHyle}
          onChange={(e) => setAddHyle(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleAddNoun(); }}
          disabled={loading || saving}
        />
        <select
          id="card_card_select"
          value={addCard}
          onChange={(e) => setAddCard(e.target.value)}
          disabled={loading || saving}
        >
          {CARDS.map(({ key, label }) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
        <button
          id="card_add_btn"
          onClick={handleAddNoun}
          disabled={!addHyle.trim() || loading || saving}
        >
          {saving ? "…" : "Add"}
        </button>
      </div>

      <div id="card_tabs">
        {CARDS.map(({ key, label }) => (
          <button
            key={key}
            className={`card_tab${activeTab === key ? " card_tab--active" : ""}`}
            onClick={() => { setActiveTab(key); navigate(`/card/${key}`, { replace: true }); }}
          >
            {label}
          </button>
        ))}
      </div>

      <div id="card_body">
        {loading ? (
          <div id="card_loading">Loading…</div>
        ) : (
          <HyleCards
            data={hyleData || EMPTY_HYLES()}
            streaming={false}
            onStatus={() => {}}
            onMove={() => {}}
            onDelete={() => {}}
            activeCard={activeTab}
            fontSize={fontSize}
          />
        )}
      </div>
    </div>
  );
};

export default CardPage;
