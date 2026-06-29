import React, { useEffect, useState } from "react";
import { useHistory } from "react-router-dom";
import { apiUrl } from "../config/api";
import { readStoredSession } from "../utils/sessionCleanup";
import { MCTOSH_PROMPT_TEXT } from "../Hylomorphism/mctoshPrompt";
import "./settingsPage.css";

const authHeader = () => {
  const token = readStoredSession()?.token || "";
  return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
};

const THEMES = [
  { id: "original", label: "Original", desc: "Deep blue-navy — the MCTOSH default", bg: "#0d0d1a", surface: "#1e1e3a", text: "#ffffff", border: "#2a2a4a" },
  { id: "light",    label: "Light",    desc: "Clean white with soft contrast",       bg: "#f8f8fc", surface: "#ffffff",  text: "#111122", border: "#d0d0e0" },
  { id: "dark",     label: "Dark",     desc: "Pure black — minimal ink",             bg: "#000000", surface: "#0f0f0f",  text: "#f0f0f0", border: "#222222" },
];

const SECTIONS = [
  { id: "prompts",   label: "Prompts",       icon: "fi fi-rr-document" },
  { id: "ai",        label: "AI Providers",  icon: "fi fi-rr-microchip-ai" },
  { id: "theme",     label: "Theme",         icon: "fi fi-rr-palette" },
];

const applyTheme = (id) => {
  document.documentElement.classList.remove("theme-light", "theme-dark");
  if (id === "light") document.documentElement.classList.add("theme-light");
  if (id === "dark")  document.documentElement.classList.add("theme-dark");
  localStorage.setItem("mctosh_theme", id);
};

// ── Prompt editor sub-component ───────────────────────────────────────────────
const PromptEditor = ({ label, desc, fetchUrl, saveUrl, method = "PATCH", field = "systemMessage", defaultText }) => {
  const [text,    setText]    = useState("");
  const [orig,    setOrig]    = useState("");
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [status,  setStatus]  = useState("");

  useEffect(() => {
    if (!fetchUrl) { setText(defaultText || ""); setOrig(defaultText || ""); setLoading(false); return; }
    fetch(apiUrl(fetchUrl), { headers: authHeader() })
      .then(r => r.json())
      .then(d => { const t = d[field] || d.prompt || d.systemMessage || ""; setText(t); setOrig(t); })
      .catch(() => { setText(defaultText || ""); setOrig(defaultText || ""); })
      .finally(() => setLoading(false));
  }, [fetchUrl, field, defaultText]);

  const handleSave = async () => {
    if (!saveUrl) {
      localStorage.setItem("mctosh_prompt_mctosh", text);
      setOrig(text);
      setStatus("Saved");
      setTimeout(() => setStatus(""), 1800);
      return;
    }
    setSaving(true);
    try {
      const body = { [field]: text };
      const res = await fetch(apiUrl(saveUrl), {
        method,
        headers: authHeader(),
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Save failed");
      setOrig(text);
      setStatus("Saved");
    } catch { setStatus("Error"); }
    finally { setSaving(false); setTimeout(() => setStatus(""), 1800); }
  };

  const handleReset = () => { setText(defaultText || orig); };

  const isDirty = text !== orig;

  return (
    <div className="sett_prompt_block">
      <div className="sett_prompt_header">
        <div>
          <div className="sett_prompt_label">{label}</div>
          <div className="sett_prompt_desc">{desc}</div>
        </div>
        <div className="sett_prompt_actions">
          {status && <span className={`sett_save_status${status === "Error" ? " sett_save_status--err" : ""}`}>{status}</span>}
          <button className="sett_btn sett_btn--ghost" onClick={handleReset} disabled={!isDirty || loading}>Reset</button>
          <button className="sett_btn sett_btn--primary" onClick={handleSave} disabled={!isDirty || saving || loading}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
      {loading
        ? <div className="sett_prompt_loading">Loading…</div>
        : <textarea className="sett_prompt_textarea" value={text} onChange={e => setText(e.target.value)} rows={12} spellCheck={false} />
      }
    </div>
  );
};

// ── Main ──────────────────────────────────────────────────────────────────────
const SettingsPage = () => {
  const history  = useHistory();
  const [section,   setSection]   = useState("prompts");
  const [theme,     setTheme]     = useState(() => localStorage.getItem("mctosh_theme") || "original");
  const [providers, setProviders] = useState([]);
  const [aiLoading, setAiLoading] = useState(true);
  const [defProvider, setDefProvider] = useState(() => localStorage.getItem("mctosh_ai_provider") || "groq");

  useEffect(() => {
    fetch(apiUrl("/api/settings/ai-status"))
      .then(r => r.json())
      .then(d => setProviders(d.providers || []))
      .catch(() => {})
      .finally(() => setAiLoading(false));
  }, []);

  const handleTheme = (id) => {
    setTheme(id);
    applyTheme(id);
  };

  const handleProvider = (id) => {
    setDefProvider(id);
    localStorage.setItem("mctosh_ai_provider", id);
  };

  const mctoshDefaultText = localStorage.getItem("mctosh_prompt_mctosh") || MCTOSH_PROMPT_TEXT;

  return (
    <div id="sett_page">
      {/* ── Header ── */}
      <div id="sett_header">
        <button id="sett_back_btn" onClick={() => history.push("/home")}>←</button>
        <span id="sett_header_title">Settings</span>
      </div>

      <div id="sett_layout">
        {/* ── Sidebar ── */}
        <nav id="sett_nav">
          {SECTIONS.map(s => (
            <button
              key={s.id}
              className={`sett_nav_item${section === s.id ? " sett_nav_item--active" : ""}`}
              onClick={() => setSection(s.id)}
            >
              <i className={s.icon} />
              <span>{s.label}</span>
            </button>
          ))}
        </nav>

        {/* ── Content ── */}
        <div id="sett_content">

          {/* ═══ PROMPTS ═══ */}
          {section === "prompts" && (
            <div className="sett_section">
              <h2 className="sett_section_title">Prompts</h2>
              <p className="sett_section_desc">Edit the AI prompts used across MCTOSH. Changes take effect immediately on the server for backend prompts.</p>

              <PromptEditor
                label="Hyle Extraction"
                desc="Used when extracting hyles from PDF, Word, or image sources — the core MCTOSH classification engine."
                fetchUrl="/api/pdf/system-message"
                saveUrl="/api/pdf/system-message"
                method="PATCH"
                field="systemMessage"
              />
              <PromptEditor
                label="Linguistic Unit Classification"
                desc="Used in the YouTube source analyser to classify transcript text into morphemes, words, syntagms, clauses, sentences, and paragraphs."
                fetchUrl="/api/youtube/classify-prompt"
                saveUrl="/api/youtube/classify-prompt"
                method="PATCH"
                field="prompt"
              />
              <PromptEditor
                label="MCTOSH Classification Prompt"
                desc="The formal 12-section classification prompt accessible from the Hyle-to-Meaning page. Stored locally in your browser."
                fetchUrl={null}
                saveUrl={null}
                field="prompt"
                defaultText={mctoshDefaultText}
              />
            </div>
          )}

          {/* ═══ AI PROVIDERS ═══ */}
          {section === "ai" && (
            <div className="sett_section">
              <h2 className="sett_section_title">AI Providers</h2>
              <p className="sett_section_desc">
                Select the default AI provider used across MCTOSH. The provider is sent with every extraction and classification request.
                Configure API keys in your backend environment variables.
              </p>

              <div id="sett_provider_default_row">
                <span className="sett_field_label">Default provider</span>
                <select
                  id="sett_provider_select"
                  value={defProvider}
                  onChange={e => handleProvider(e.target.value)}
                >
                  {providers.map(p => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
              </div>

              {aiLoading
                ? <div className="sett_ai_loading">Checking providers…</div>
                : (
                  <div id="sett_provider_grid">
                    {providers.map(p => (
                      <div
                        key={p.id}
                        className={`sett_provider_card${defProvider === p.id ? " sett_provider_card--active" : ""}`}
                        onClick={() => handleProvider(p.id)}
                      >
                        <div className="sett_provider_top">
                          <span className="sett_provider_name">{p.label}</span>
                          <span className={`sett_provider_badge${p.configured ? " sett_provider_badge--ok" : " sett_provider_badge--off"}`}>
                            {p.configured ? "Configured" : "No key"}
                          </span>
                        </div>
                        <div className="sett_provider_model">{p.model}</div>
                        <div className="sett_provider_base">{p.baseUrl}</div>
                        {defProvider === p.id && <div className="sett_provider_active_tag">Default</div>}
                      </div>
                    ))}
                  </div>
                )
              }
            </div>
          )}

          {/* ═══ THEME ═══ */}
          {section === "theme" && (
            <div className="sett_section">
              <h2 className="sett_section_title">Theme</h2>
              <p className="sett_section_desc">Choose the visual style for MCTOSH. Applied immediately and remembered across sessions.</p>

              <div id="sett_theme_grid">
                {THEMES.map(t => (
                  <button
                    key={t.id}
                    className={`sett_theme_card${theme === t.id ? " sett_theme_card--active" : ""}`}
                    onClick={() => handleTheme(t.id)}
                  >
                    <div className="sett_theme_preview" style={{ background: t.bg, border: `1px solid ${t.border}` }}>
                      <div className="sett_theme_preview_surface" style={{ background: t.surface, border: `1px solid ${t.border}` }}>
                        <div className="sett_theme_preview_line" style={{ background: t.text, opacity: 0.8 }} />
                        <div className="sett_theme_preview_line sett_theme_preview_line--short" style={{ background: t.text, opacity: 0.4 }} />
                      </div>
                    </div>
                    <div className="sett_theme_label">{t.label}</div>
                    <div className="sett_theme_desc">{t.desc}</div>
                    {theme === t.id && <div className="sett_theme_check">✓ Active</div>}
                  </button>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
