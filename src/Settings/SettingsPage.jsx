import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { API_BASE_URL, apiUrl } from "../config/api";
import { readStoredSession } from "../utils/sessionCleanup";
import { MCTOSH_PROMPT_TEXT } from "../Hylomorphism/mctoshPrompt";
import { getPredictionPools, setPredictionPoolEnabled, rebuildPredictionPool, ingestPredictionPool } from "../utils/predictionApi";
import objectivesEn from "../MCC/mccqeObjectivesData.json";
import objectivesAr from "../MCC/mccqeObjectivesArabicData.json";
import "./settingsPage.css";

const stripHtml = (html) => String(html || "").replace(/<[^>]+>/g, " ");

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
  { id: "prompts",    label: "Prompts",         icon: "fi fi-rr-document" },
  { id: "ai",         label: "AI Providers",    icon: "fi fi-rr-microchip-ai" },
  { id: "ai_access",  label: "AI Access",       icon: "fi fi-rr-shield-check" },
  { id: "social",     label: "Social Publish",  icon: "fi fi-rr-megaphone" },
  { id: "prediction", label: "Predictive Text", icon: "fi fi-rr-keyboard" },
  { id: "theme",      label: "Theme",           icon: "fi fi-rr-palette" },
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
  const location = useLocation();
  const [section,   setSection]   = useState(() => new URLSearchParams(location.search).get("section") || "prompts");
  const [theme,     setTheme]     = useState(() => localStorage.getItem("mctosh_theme") || "original");
  const [aiCodebase, setAiCodebase] = useState(() => localStorage.getItem("mctosh_ai_codebase") === "true");
  const [aiDb,       setAiDb]       = useState(() => localStorage.getItem("mctosh_ai_db")       === "true");
  const [providers, setProviders] = useState([]);
  const [aiLoading, setAiLoading] = useState(true);
  const [defProvider, setDefProvider] = useState(() => localStorage.getItem("mctosh_ai_provider") || "groq");
  const [predictPools,   setPredictPools]   = useState([]);
  const [predictLoading, setPredictLoading] = useState(true);
  const [predictBusyKey, setPredictBusyKey] = useState(null);
  const [predictError,   setPredictError]   = useState("");
  const [socialConfig, setSocialConfig] = useState({
    metaAppId: "",
    metaAppSecret: "",
    instagramAccountId: "",
    accessToken: "",
    graphApiVersion: "",
    accessTokenMasked: "",
    metaAppSecretMasked: "",
  });
  const [socialOauthInfo, setSocialOauthInfo] = useState({ redirectUri: "", scopes: [] });
  const [socialOrig, setSocialOrig] = useState(null);
  const [socialLoading, setSocialLoading] = useState(true);
  const [socialSaving, setSocialSaving] = useState(false);
  const [socialStatus, setSocialStatus] = useState("");
  const [socialTesting, setSocialTesting] = useState(false);
  const [socialConnecting, setSocialConnecting] = useState(false);
  const [socialTestResult, setSocialTestResult] = useState(null);

  const loadSocialConfig = async (statusMessage = "") => {
    setSocialLoading(true);
    try {
      const r = await fetch(apiUrl("/api/settings/instagram-config"), { headers: authHeader() });
      const d = await r.json().catch(() => ({}));
      const next = {
        metaAppId: d.config?.metaAppId || "",
        metaAppSecret: "",
        instagramAccountId: d.config?.instagramAccountId || "",
        accessToken: "",
        graphApiVersion: d.config?.graphApiVersion || "",
        accessTokenMasked: d.config?.accessTokenMasked || "",
        metaAppSecretMasked: d.config?.metaAppSecretMasked || "",
      };
      setSocialConfig(next);
      setSocialOauthInfo({
        redirectUri: d.oauth?.redirectUri || "",
        scopes: Array.isArray(d.oauth?.scopes) ? d.oauth.scopes : [],
      });
      setSocialOrig(next);
      if (statusMessage) {
        setSocialStatus(statusMessage);
        setTimeout(() => setSocialStatus(""), 2400);
      }
    } catch {
      const next = {
        metaAppId: "",
        metaAppSecret: "",
        instagramAccountId: "",
        accessToken: "",
        graphApiVersion: "",
        accessTokenMasked: "",
        metaAppSecretMasked: "",
      };
      setSocialConfig(next);
      setSocialOauthInfo({ redirectUri: "", scopes: [] });
      setSocialOrig(next);
    } finally {
      setSocialLoading(false);
    }
  };

  useEffect(() => {
    fetch(apiUrl("/api/settings/ai-status"))
      .then(r => r.json())
      .then(d => setProviders(d.providers || []))
      .catch(() => {})
      .finally(() => setAiLoading(false));
  }, []);

  useEffect(() => {
    getPredictionPools()
      .then(setPredictPools)
      .catch((e) => setPredictError(e.message))
      .finally(() => setPredictLoading(false));
  }, []);

  useEffect(() => {
    void loadSocialConfig();
  }, []);

  useEffect(() => {
    const requestedSection = new URLSearchParams(location.search).get("section");
    if (requestedSection) setSection(requestedSection);

    const oauthStatus = new URLSearchParams(location.search).get("status");
    const oauthMessage = new URLSearchParams(location.search).get("message");
    if (oauthStatus === "success") {
      setSection("social");
      void loadSocialConfig("Connected");
      if (oauthMessage) setSocialStatus("Connected");
    } else if (oauthStatus === "error" && oauthMessage) {
      setSection("social");
      setSocialStatus("Error");
    }
  }, [location.search]);

  useEffect(() => {
    const backendOrigin = (() => {
      try { return new URL(API_BASE_URL).origin; } catch { return ""; }
    })();
    const handleMessage = (event) => {
      if (backendOrigin && event.origin !== backendOrigin) return;
      if (event.data?.type !== "instagram-oauth") return;
      const payload = event.data?.payload || {};
      setSection("social");
      setSocialConnecting(false);
      if (payload.status === "success") {
        void loadSocialConfig("Connected");
      } else {
        setSocialStatus("Error");
      }
      if (payload.message) {
        setSocialTestResult({
          ok: payload.status === "success",
          error: payload.status === "success" ? "" : payload.message,
          checks: payload.status === "success" ? [{
            key: "oauth",
            ok: true,
            label: "Instagram OAuth",
            detail: payload.message,
          }] : [],
          graphApiVersion: socialConfig.graphApiVersion || "",
        });
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [socialConfig.graphApiVersion]);

  const handleTheme = (id) => {
    setTheme(id);
    applyTheme(id);
  };

  const handleTogglePredictPool = async (key, enabled) => {
    setPredictPools((prev) => prev.map((p) => (p.key === key ? { ...p, enabled } : p)));
    try {
      await setPredictionPoolEnabled(key, enabled);
    } catch (e) {
      setPredictError(e.message);
      setPredictPools((prev) => prev.map((p) => (p.key === key ? { ...p, enabled: !enabled } : p)));
    }
  };

  const handleRefreshPredictPool = async (pool) => {
    setPredictBusyKey(pool.key);
    setPredictError("");
    try {
      let wordCount;
      if (pool.source === "computed") {
        wordCount = await rebuildPredictionPool(pool.key);
      } else if (pool.key === "mccqe_objectives") {
        const text = [...objectivesEn, ...objectivesAr]
          .map((o) => `${o.title || ""} ${stripHtml(o.content || "")}`)
          .join("\n");
        wordCount = await ingestPredictionPool(pool.key, text);
      }
      setPredictPools((prev) => prev.map((p) => (p.key === pool.key ? { ...p, wordCount, builtAt: new Date().toISOString() } : p)));
    } catch (e) {
      setPredictError(e.message);
    } finally {
      setPredictBusyKey(null);
    }
  };

  const handleProvider = (id) => {
    setDefProvider(id);
    localStorage.setItem("mctosh_ai_provider", id);
  };

  const handleSaveSocial = async () => {
    setSocialSaving(true);
    try {
      const body = {
        metaAppId: socialConfig.metaAppId,
        instagramAccountId: socialConfig.instagramAccountId,
        graphApiVersion: socialConfig.graphApiVersion,
      };
      if (socialConfig.metaAppSecret.trim()) body.metaAppSecret = socialConfig.metaAppSecret;
      if (socialConfig.accessToken.trim()) body.accessToken = socialConfig.accessToken;

      const res = await fetch(apiUrl("/api/settings/instagram-config"), {
        method: "PATCH",
        headers: authHeader(),
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to save Instagram configuration.");
      const next = {
        metaAppId: data.config?.metaAppId || "",
        metaAppSecret: "",
        instagramAccountId: data.config?.instagramAccountId || "",
        accessToken: "",
        graphApiVersion: data.config?.graphApiVersion || "",
        accessTokenMasked: data.config?.accessTokenMasked || "",
        metaAppSecretMasked: data.config?.metaAppSecretMasked || "",
      };
      setSocialConfig(next);
      setSocialOrig(next);
      setSocialStatus("Saved");
    } catch (e) {
      setSocialStatus("Error");
    } finally {
      setSocialSaving(false);
      setTimeout(() => setSocialStatus(""), 1800);
    }
  };

  const handleConnectSocial = async () => {
    setSocialConnecting(true);
    setSocialStatus("");
    setSocialTestResult(null);
    try {
      const hasUnsavedCoreChanges = Boolean(
        !socialOrig ||
        socialConfig.metaAppId !== socialOrig.metaAppId ||
        socialConfig.graphApiVersion !== socialOrig.graphApiVersion ||
        socialConfig.instagramAccountId !== socialOrig.instagramAccountId ||
        socialConfig.metaAppSecret.trim() ||
        socialConfig.accessToken.trim()
      );

      if (hasUnsavedCoreChanges) {
        const saveBody = {
          metaAppId: socialConfig.metaAppId,
          instagramAccountId: socialConfig.instagramAccountId,
          graphApiVersion: socialConfig.graphApiVersion,
        };
        if (socialConfig.metaAppSecret.trim()) saveBody.metaAppSecret = socialConfig.metaAppSecret;
        if (socialConfig.accessToken.trim()) saveBody.accessToken = socialConfig.accessToken;
        const saveRes = await fetch(apiUrl("/api/settings/instagram-config"), {
          method: "PATCH",
          headers: authHeader(),
          body: JSON.stringify(saveBody),
        });
        const saveData = await saveRes.json().catch(() => ({}));
        if (!saveRes.ok) throw new Error(saveData.error || "Failed to save Instagram configuration before connecting.");
        const next = {
          metaAppId: saveData.config?.metaAppId || "",
          metaAppSecret: "",
          instagramAccountId: saveData.config?.instagramAccountId || "",
          accessToken: "",
          graphApiVersion: saveData.config?.graphApiVersion || "",
          accessTokenMasked: saveData.config?.accessTokenMasked || "",
          metaAppSecretMasked: saveData.config?.metaAppSecretMasked || "",
        };
        setSocialConfig(next);
        setSocialOrig(next);
      }

      const returnTo = new URL("/cvs/settings?section=social", window.location.origin).toString();
      const res = await fetch(`${apiUrl("/api/settings/instagram-connect/start")}?returnTo=${encodeURIComponent(returnTo)}`, {
        headers: authHeader(false),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to start Instagram connection.");

      const popup = window.open(data.authUrl, "mctosh-instagram-connect", "width=720,height=820,resizable=yes,scrollbars=yes");
      if (!popup) throw new Error("The Instagram login popup was blocked by your browser.");
      setSocialStatus("Connecting");
      const watchPopup = window.setInterval(() => {
        if (!popup.closed) return;
        window.clearInterval(watchPopup);
        setSocialConnecting(false);
        setSocialStatus((current) => (current === "Connecting" ? "" : current));
      }, 500);
    } catch (e) {
      setSocialConnecting(false);
      setSocialStatus("Error");
      setSocialTestResult({
        ok: false,
        error: e.message || "Failed to start Instagram connection.",
        checks: [],
        graphApiVersion: socialConfig.graphApiVersion || "",
      });
    }
  };

  const handleTestSocial = async () => {
    setSocialTesting(true);
    setSocialTestResult(null);
    try {
      const res = await fetch(apiUrl("/api/settings/instagram-config/test"), {
        method: "POST",
        headers: authHeader(),
        body: JSON.stringify({
          metaAppId: socialConfig.metaAppId,
          metaAppSecret: socialConfig.metaAppSecret,
          instagramAccountId: socialConfig.instagramAccountId,
          accessToken: socialConfig.accessToken,
          graphApiVersion: socialConfig.graphApiVersion,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Connection test failed.");
      setSocialTestResult({
        ok: Boolean(data.ok),
        error: "",
        checks: Array.isArray(data.checks) ? data.checks : [],
        graphApiVersion: data.graphApiVersion || "",
      });
    } catch (e) {
      setSocialTestResult({
        ok: false,
        error: e.message || "Connection test failed.",
        checks: [],
        graphApiVersion: socialConfig.graphApiVersion || "",
      });
    } finally {
      setSocialTesting(false);
    }
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

          {section === "social" && (
            <div className="sett_section">
              <h2 className="sett_section_title">Social Publishing</h2>
              <p className="sett_section_desc">
                Save your Instagram Login publishing credentials here. These values are stored encrypted on the backend per user and are used by the Social Media Control page for publish, reel, and scheduler flows.
              </p>

              <div className="sett_prompt_block">
                <div className="sett_prompt_header">
                  <div>
                    <div className="sett_prompt_label">Instagram Login Publishing Credentials</div>
                    <div className="sett_prompt_desc">Leave secret fields blank if you want to keep the already-saved value unchanged. Facebook Page ID is no longer required for this setup.</div>
                  </div>
                  <div className="sett_prompt_actions">
                    {socialStatus && <span className={`sett_save_status${socialStatus === "Error" ? " sett_save_status--err" : ""}`}>{socialStatus}</span>}
                    <button className="sett_btn sett_btn--ghost" onClick={handleConnectSocial} disabled={socialSaving || socialLoading || socialTesting || socialConnecting}>
                      {socialConnecting ? "Connecting…" : "Connect Instagram"}
                    </button>
                    <button className="sett_btn sett_btn--ghost" onClick={handleTestSocial} disabled={socialSaving || socialLoading || socialTesting}>
                      {socialTesting ? "Testing…" : "Test Connection"}
                    </button>
                    <button className="sett_btn sett_btn--primary" onClick={handleSaveSocial} disabled={socialSaving || socialLoading}>
                      {socialSaving ? "Saving…" : "Save"}
                    </button>
                  </div>
                </div>

                {socialLoading ? (
                  <div className="sett_prompt_loading">Loading…</div>
                ) : (
                  <>
                    <div className="sett_social_grid">
                      <label className="sett_social_field">
                        <span>Instagram App ID</span>
                        <input value={socialConfig.metaAppId} onChange={(e) => setSocialConfig((prev) => ({ ...prev, metaAppId: e.target.value }))} />
                      </label>
                      <label className="sett_social_field">
                        <span>Instagram App Secret</span>
                        <input type="password" placeholder={socialConfig.metaAppSecretMasked || "Not set"} value={socialConfig.metaAppSecret} onChange={(e) => setSocialConfig((prev) => ({ ...prev, metaAppSecret: e.target.value }))} />
                      </label>
                      <label className="sett_social_field">
                        <span>Instagram Account ID</span>
                        <input value={socialConfig.instagramAccountId} onChange={(e) => setSocialConfig((prev) => ({ ...prev, instagramAccountId: e.target.value }))} />
                      </label>
                      <label className="sett_social_field">
                        <span>Access Token</span>
                        <input type="password" placeholder={socialConfig.accessTokenMasked || "Not set"} value={socialConfig.accessToken} onChange={(e) => setSocialConfig((prev) => ({ ...prev, accessToken: e.target.value }))} />
                      </label>
                      <label className="sett_social_field">
                        <span>Graph API Version</span>
                        <input value={socialConfig.graphApiVersion} onChange={(e) => setSocialConfig((prev) => ({ ...prev, graphApiVersion: e.target.value }))} placeholder="v25.0" />
                      </label>
                    </div>

                    <div className="sett_social_oauth_box">
                      <div className="sett_social_oauth_title">OAuth Redirect URI for Meta Dashboard</div>
                      <div className="sett_social_oauth_desc">
                        Copy this exact redirect URI into the Instagram Login settings in your Meta app. The value must match exactly.
                      </div>
                      <input className="sett_social_oauth_input" readOnly value={socialOauthInfo.redirectUri || "Unavailable"} onFocus={(e) => e.target.select()} />
                      {socialOauthInfo.scopes?.length > 0 && (
                        <div className="sett_social_oauth_scopes">
                          Requested scopes: {socialOauthInfo.scopes.join(", ")}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>

              {socialTestResult && (
                <div className={`sett_social_test${socialTestResult.ok ? " sett_social_test--ok" : " sett_social_test--err"}`}>
                  <div className="sett_social_test_title">
                    {socialTestResult.ok ? "Connection looks good" : "Connection needs attention"}
                  </div>
                  {socialTestResult.graphApiVersion && (
                    <div className="sett_social_test_meta">Graph API version: {socialTestResult.graphApiVersion}</div>
                  )}
                  {socialTestResult.error && (
                    <div className="sett_social_test_error">{socialTestResult.error}</div>
                  )}
                  {socialTestResult.checks?.length > 0 && (
                    <div className="sett_social_test_checks">
                      {socialTestResult.checks.map((check) => (
                        <div key={check.key} className={`sett_social_test_check${check.ok ? " sett_social_test_check--ok" : " sett_social_test_check--err"}`}>
                          <div className="sett_social_test_check_label">{check.label}</div>
                          <div className="sett_social_test_check_detail">{check.detail}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="sett_social_help">
                <div className="sett_social_help_title">Where to get these values</div>
                <div className="sett_social_help_intro">
                  This page now follows the Instagram Login route. Your Instagram account must be a professional account, and this setup no longer depends on a Facebook Page ID.
                </div>
                <ol className="sett_social_help_list">
                  <li>Open Meta for Developers, add the use case named <strong>Manage messaging and content on Instagram</strong>, and open the Instagram Login setup.</li>
                  <li>Copy the Instagram App ID and App Secret from the Instagram Login area of the dashboard.</li>
                  <li>Use Instagram Login to generate a publishing access token for your professional Instagram account.</li>
                  <li>Copy your Instagram Account ID from the Instagram API tools or account lookup.</li>
                  <li>Paste the values here, save them, then use Social Media Control to test the connection and publish.</li>
                </ol>
                <div className="sett_social_help_note">
                  Recommended permissions usually include Instagram account access and <code>instagram_content_publish</code>. The App ID and App Secret are optional for direct publishing if you already have a valid token, but they will be needed when we add full OAuth connect flow.
                </div>
              </div>
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

          {/* ═══ PREDICTIVE TEXT ═══ */}
          {section === "prediction" && (
            <div className="sett_section">
              <h2 className="sett_section_title">Predictive Text</h2>
              <p className="sett_section_desc">
                Word suggestions appear while typing in any text field across MCTOSHS. Check which text pools feed the
                suggestion list below — each pool's word frequencies are combined, so you can mix and match. Turning
                everything off disables suggestions entirely.
              </p>

              {predictError && <p className="sett_section_desc" style={{ color: "#f44336" }}>⚠ {predictError}</p>}

              {predictLoading ? (
                <div className="sett_ai_loading">Loading pools…</div>
              ) : (
                <div id="sett_predict_pools">
                  {predictPools.map((pool) => (
                    <label key={pool.key} className="sett_predict_pool_row">
                      <input
                        type="checkbox"
                        checked={pool.enabled}
                        onChange={(e) => handleTogglePredictPool(pool.key, e.target.checked)}
                      />
                      <div className="sett_predict_pool_info">
                        <span className="sett_predict_pool_label">{pool.label}</span>
                        <span className="sett_predict_pool_meta">
                          {pool.wordCount > 0
                            ? `${pool.wordCount.toLocaleString()} words indexed${pool.builtAt ? ` · updated ${new Date(pool.builtAt).toLocaleDateString()}` : ""}`
                            : "Not indexed yet"}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="sett_btn sett_btn--ghost"
                        onClick={(e) => { e.preventDefault(); handleRefreshPredictPool(pool); }}
                        disabled={predictBusyKey === pool.key}
                      >
                        {predictBusyKey === pool.key ? "Working…" : pool.source === "computed" ? "Rebuild" : "Sync"}
                      </button>
                    </label>
                  ))}
                </div>
              )}
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
