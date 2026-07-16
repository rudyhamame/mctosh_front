import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { readStoredSession } from "../utils/sessionCleanup";
import { apiUrl } from "../config/api";
import MCTOSHPromptModal from "./MCTOSHPromptModal";
import "./hylomorphismPage.css";

const TYPE_OPTIONS = [
  { value: "pdf",     label: "PDF" },
  { value: "word",    label: "Word" },
  { value: "youtube", label: "YouTube" },
  { value: "image",   label: "Image" },
];

const TYPE_ROUTE = {
  pdf:     (src) => ({ path: "/hylomorphism/pdf_source",      state: { sourceId: src._id, pdfName: src.name } }),
  word:    (src) => ({ path: "/hylomorphism/pdf_source",      state: { sourceId: src._id, pdfName: src.name } }),
  youtube: (src) => ({ path: "/hylomorphism/youtube_source",  state: { sourceId: src._id, sourceName: src.name, sourceUrl: src.url } }),
  image:   (src) => ({ path: "/hylomorphism/pdf_source",      state: { sourceId: src._id, pdfName: src.name } }),
};

const authHeader = () => {
  const token = readStoredSession()?.token || "";
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const HylomorphismPage = () => {
  const navigate = useNavigate();
  const [allSources,   setAllSources]   = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [sourceType,   setSourceType]   = useState("pdf");
  const [showPrompt,   setShowPrompt]   = useState(false);

  useEffect(() => {
    fetch(apiUrl("/api/sources/"), { headers: authHeader() })
      .then(r => r.json())
      .then(d => setAllSources(d.sources || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = allSources.filter(s => s.type === sourceType);

  const handleSourceSelect = (e) => {
    const id = e.target.value;
    if (!id) return;
    const src = allSources.find(s => s._id === id);
    if (!src) return;
    const { path, state } = (TYPE_ROUTE[src.type] ?? TYPE_ROUTE.pdf)(src);
    navigate(path, { state });
  };

  const noSourcesMsg = loading
    ? "Loading…"
    : filtered.length === 0
      ? `No ${TYPE_OPTIONS.find(t => t.value === sourceType)?.label ?? ""} sources found`
      : `Select a source…`;

  return (
    <div id="hylo_page">
      <div id="hylo_header">
        <button id="hylo_back_btn" onClick={() => navigate("/home")}>←</button>
        <span id="hylo_header_title">Hyle-to-Meaning</span>
        <button id="hylo_prompt_btn" onClick={() => setShowPrompt(true)} title="View AMCTOSHS Classification Prompt">Prompt</button>
      </div>
      {showPrompt && <MCTOSHPromptModal onClose={() => setShowPrompt(false)} />}

      <div id="hylo_source_body">
        <div id="hylo_source_card">
          <div className="hylo_field">
            <label className="hylo_label" htmlFor="hylo_type_select">Source Type</label>
            <select
              id="hylo_type_select"
              value={sourceType}
              onChange={e => setSourceType(e.target.value)}
            >
              {TYPE_OPTIONS.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          <div className="hylo_field">
            <label className="hylo_label" htmlFor="hylo_source_select">Hyle Source</label>
            <select
              id="hylo_source_select"
              defaultValue=""
              key={sourceType}
              onChange={handleSourceSelect}
              disabled={loading || filtered.length === 0}
            >
              <option value="" disabled>{noSourcesMsg}</option>
              {filtered.map(s => (
                <option key={s._id} value={s._id}>{s.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </div>
  );
};

export default HylomorphismPage;
