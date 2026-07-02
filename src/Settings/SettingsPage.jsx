import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiUrl } from "../config/api";
import { readStoredSession } from "../utils/sessionCleanup";
import { MCTOSH_PROMPT_TEXT } from "../Hylomorphism/mctoshPrompt";
import "./settingsPage.css";

const authHeader = () => {
  const token = readStoredSession()?.token || "";
  return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
};

const THEMES = [
  { id: "original", label: "Original", desc: "Deep blue-navy — the MCTOSHS default", bg: "#0d0d1a", surface: "#1e1e3a", text: "#ffffff", border: "#2a2a4a" },
  { id: "light",    label: "Light",    desc: "Clean white with soft contrast",       bg: "#f8f8fc", surface: "#ffffff",  text: "#111122", border: "#d0d0e0" },
  { id: "dark",     label: "Dark",     desc: "Pure black — minimal ink",             bg: "#000000", surface: "#0f0f0f",  text: "#f0f0f0", border: "#222222" },
];

const SECTIONS = [
  { id: "prompts",   label: "Prompts",       icon: "fi fi-rr-document" },
  { id: "ai",        label: "AI Providers",  icon: "fi fi-rr-microchip-ai" },
  { id: "ai_access", label: "AI Access",     icon: "fi fi-rr-shield-check" },
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
  const navigate = useNavigate();
  const [section,   setSection]   = useState("prompts");
  const [theme,     setTheme]     = useState(() => localStorage.getItem("mctosh_theme") || "original");
  const [aiCodebase, setAiCodebase] = useState(() => localStorage.getItem("mctosh_ai_codebase") === "true");
  const [aiDb,       setAiDb]       = useState(() => localStorage.getItem("mctosh_ai_db")       === "true");
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
        <button id="sett_back_btn" onClick={() => navigate("/home")}>←</button>
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
              <p className="sett_section_desc">Edit the AI prompts used across MCTOSHS. Changes take effect immediately on the server for backend prompts.</p>

              <PromptEditor
                label="Hyle Extraction"
                desc="Used when extracting hyles from PDF, Word, or image sources — the core MCTOSHS classification engine."
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
                label="MCTOSHS Classification Prompt"
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
                Select the default AI provider used across MCTOSHS. The provider is sent with every extraction and classification request.
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

          {/* ═══ AI ACCESS ═══ */}
          {section === "ai_access" && (
            <div className="sett_section">
              <h2 className="sett_section_title">AI Access</h2>
              <p className="sett_section_desc">
                A complete breakdown of what MCTOSHS AI can and cannot access during a conversation. Toggles for codebase and DB are available inside the Dev AI chat panel.
              </p>

              <div className="sett_access_group">
                <div className="sett_access_group_header sett_access_group_header--on">
                  <i className="fi fi-rr-check-circle" /> Always available
                </div>
                <ul className="sett_access_list">
                  <li><strong>MCTOSHS domain model</strong> — Clinical Presentation 6-step pipeline (Patient Reality → Patient Access → Patient Interpretation → Clinician Access → Clinician Interpretation → Clinical Intervention) and Clinical Representation theory injected into every system prompt.</li>
                  <li><strong>Conversation history</strong> — all messages exchanged in the current session are included with each request, giving the AI full context of the ongoing conversation.</li>
                  <li><strong>Selected AI provider &amp; model</strong> — the provider you choose in the chat dropdown determines which backend inference engine processes the request.</li>
                </ul>
              </div>

              <div className="sett_access_group">
                <div className="sett_access_group_header sett_access_group_header--toggle">
                  <i className="fi fi-rr-terminal" /> Codebase context
                  <button
                    className={`sett_access_toggle${aiCodebase ? " sett_access_toggle--on" : ""}`}
                    onClick={() => setAiCodebase(v => { localStorage.setItem("mctosh_ai_codebase", String(!v)); return !v; })}
                  >{aiCodebase ? "ON" : "OFF"}</button>
                </div>
                <ul className="sett_access_list">
                  <li><strong>Backend source files</strong> — all <code>.js</code> files inside <code>back/</code>: Express routes, Mongoose models, middleware, utilities, AI API handlers.</li>
                  <li><strong>Frontend source files</strong> — all <code>.js</code> / <code>.jsx</code> files inside <code>front/src/</code>: pages, components, hooks, config, CSS (not included, only JS).</li>
                  <li><strong>File paths</strong> — every file is prefixed with its relative path so the AI can reference exact locations (e.g. <code>back/routes/AIAPI.js</code>).</li>
                  <li><strong>Size limits</strong> — 60 000 chars total across all files, 4 000 chars per individual file. Files that exceed the per-file limit are truncated with a notice. Files added first (filesystem order) take priority before the total cap is hit.</li>
                  <li><strong>Excluded</strong> — <code>node_modules/</code>, <code>.git/</code>, <code>dist/</code>, <code>build/</code>, and binary/asset files are never read.</li>
                </ul>
              </div>

              <div className="sett_access_group">
                <div className="sett_access_group_header sett_access_group_header--toggle">
                  <i className="fi fi-rr-database" /> DB context
                  <button
                    className={`sett_access_toggle${aiDb ? " sett_access_toggle--on" : ""}`}
                    onClick={() => setAiDb(v => { localStorage.setItem("mctosh_ai_db", String(!v)); return !v; })}
                  >{aiDb ? "ON" : "OFF"}</button>
                </div>
                <ul className="sett_access_list">
                  <li><strong>Sources</strong> — name, type, and creation date for every source document belonging to your account (<code>Source.find(&#123; userId &#125;)</code>).</li>
                  <li><strong>Phenomena count</strong> — total number of phenomena extracted and linked to your account.</li>
                  <li><strong>Page extractions count</strong> — total number of page-level extractions linked to your account.</li>
                  <li><strong>Scope</strong> — all queries are filtered by your <code>userId</code>. No other user's data is ever fetched.</li>
                </ul>
              </div>

              <div className="sett_access_group">
                <div className="sett_access_group_header sett_access_group_header--off">
                  <i className="fi fi-rr-ban" /> No access — ever
                </div>
                <ul className="sett_access_list">
                  <li><strong>Environment variables &amp; secrets</strong> — the <code>.env</code> file, API keys, JWT secret, database credentials, and SMTP credentials are never read or sent.</li>
                  <li><strong>Other users' data</strong> — DB queries are always scoped to your own <code>userId</code>.</li>
                  <li><strong>File system outside the project</strong> — only <code>back/</code> and <code>front/src/</code> are scanned; nothing else on the host machine.</li>
                  <li><strong>Code execution</strong> — the AI reads and reasons about source files but cannot run shell commands, execute code, or modify any file.</li>
                  <li><strong>CSS / asset files</strong> — only <code>.js</code> and <code>.jsx</code> files are collected; <code>.css</code>, images, fonts, and other assets are excluded.</li>
                  <li><strong>Network requests</strong> — the AI cannot make external HTTP calls on your behalf during a conversation.</li>
                </ul>
              </div>
            </div>
          )}

          {/* ═══ THEME ═══ */}
          {section === "theme" && (
            <div className="sett_section">
              <h2 className="sett_section_title">Theme</h2>
              <p className="sett_section_desc">Choose the visual style for MCTOSHS. Applied immediately and remembered across sessions.</p>

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
