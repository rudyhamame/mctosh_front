import React, { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { API_BASE_URL, apiUrl } from "../config/api";
import { readStoredSession, writeStoredSession } from "../utils/sessionCleanup";
import { MCTOSH_PROMPT_TEXT } from "../Hylomorphism/mctoshPrompt";
import { getPredictionPools, setPredictionPoolEnabled, rebuildPredictionPool, ingestPredictionPool } from "../utils/predictionApi";
import objectivesEn from "../MCC/mccqeObjectivesData.json";
import objectivesAr from "../MCC/mccqeObjectivesArabicData.json";
import AvatarProviderSelector from "../Avatar/AvatarProviderSelector";
import {
  readVoiceSettings, writeVoiceSettings,
  TTS_PROVIDERS, readTtsProviderId, writeTtsProviderId,
} from "../Avatar/local3d/ttsProviderSettings";
import { applyTheme, readStoredTheme } from "../utils/theme";
import "./settingsPage.css";

const TTS_PROVIDER_OPTIONS = [
  { id: TTS_PROVIDERS.BROWSER, label: "Browser Speech Synthesis", desc: "Free, built into your browser — no setup needed." },
  { id: TTS_PROVIDERS.OPENVOICE, label: "OpenVoiceClone", desc: "Speaks in your own cloned voice — needs a voice profile below." },
  { id: TTS_PROVIDERS.KOKORO, label: "Kokoro", desc: "Not available yet — reserved for a future self-hosted option.", disabled: true },
];

const stripHtml = (html) => String(html || "").replace(/<[^>]+>/g, " ");

const readApiError = (data, fallback) => (
  typeof data?.error === "string" ? data.error : data?.error?.message || fallback
);

const authHeader = () => {
  const token = readStoredSession()?.token || "";
  return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
};

const THEMES = [
  { id: "original", label: "Original", desc: "Deep blue-navy classic theme",          bg: "#0d0d1a", surface: "#1e1e3a", text: "#ffffff", border: "#2a2a4a" },
  { id: "light",    label: "Light",    desc: "Clean white default with soft contrast", bg: "#f8f8fc", surface: "#ffffff",  text: "#111122", border: "#d0d0e0" },
  { id: "dark",     label: "Dark",     desc: "Pure black — minimal ink",             bg: "#000000", surface: "#0f0f0f",  text: "#f0f0f0", border: "#222222" },
];

const SECTIONS = [
  { id: "personal",   label: "Personal Information", icon: "fi fi-rr-user" },
  { id: "prompts",    label: "Prompts",         icon: "fi fi-rr-document" },
  { id: "ai",         label: "AI Providers",    icon: "fi fi-rr-microchip-ai" },
  { id: "ai_access",  label: "AI Access",       icon: "fi fi-rr-shield-check" },
  { id: "social",     label: "Social Publish",  icon: "fi fi-rr-megaphone" },
  { id: "prediction", label: "Predictive Text", icon: "fi fi-rr-keyboard" },
  { id: "pdf_reader", label: "PDF Reader",      icon: "fi fi-rr-file-pdf" },
  { id: "theme",      label: "Theme",           icon: "fi fi-rr-palette" },
];

// Kept in sync with the same list PDFPage.jsx reads from localStorage
// ("mctosh_pdf_translate_lang") for the selection bar's "Translate to" action.
const TRANSLATE_LANGUAGES = [
  "English", "Spanish", "French", "German", "Portuguese", "Italian",
  "Arabic", "Hindi", "Mandarin Chinese", "Japanese", "Korean", "Russian",
];

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
  const [section,   setSection]   = useState(() => new URLSearchParams(location.search).get("section") || "personal");
  const [theme,     setTheme]     = useState(() => readStoredTheme());
  const [pdfTranslateLang, setPdfTranslateLang] = useState(() => localStorage.getItem("mctosh_pdf_translate_lang") || "English");
  const [providers, setProviders] = useState([]);
  const [aiLoading, setAiLoading] = useState(true);
  const [aiRefreshing, setAiRefreshing] = useState(false);
  const [anamUsage, setAnamUsage] = useState(null);
  const [anamUsageLoading, setAnamUsageLoading] = useState(true);
  const [anamUsageError, setAnamUsageError] = useState("");
  const [anamTrial, setAnamTrial] = useState(null);
  const [anamTrialLoading, setAnamTrialLoading] = useState(true);
  const [ttsProviderId, setTtsProviderId] = useState(() => readTtsProviderId());
  const [selectedVoiceProfileId, setSelectedVoiceProfileId] = useState(() => readVoiceSettings().voiceProfileId);
  const [voiceProfiles, setVoiceProfiles] = useState([]);
  const [voiceProfilesLoading, setVoiceProfilesLoading] = useState(true);
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
  const [socialMeta, setSocialMeta] = useState({ hasAccessToken: false, hasMetaAppSecret: false, updatedAt: "" });
  const [socialOrig, setSocialOrig] = useState(null);
  const [socialLoading, setSocialLoading] = useState(true);
  const [socialSaving, setSocialSaving] = useState(false);
  const [socialStatus, setSocialStatus] = useState("");
  const [socialTesting, setSocialTesting] = useState(false);
  const [socialConnecting, setSocialConnecting] = useState(false);
  const [socialTestResult, setSocialTestResult] = useState(null);

  const [personalName,     setPersonalName]     = useState("");
  const [personalOrigName, setPersonalOrigName] = useState("");
  const [personalUsername, setPersonalUsername] = useState("");
  const [personalPhoto, setPersonalPhoto] = useState("");
  const [personalOrigPhoto, setPersonalOrigPhoto] = useState("");
  const [personalLoading,  setPersonalLoading]  = useState(true);
  const [personalSaving,   setPersonalSaving]   = useState(false);
  const [personalStatus,   setPersonalStatus]   = useState("");
  const profilePhotoInputRef = useRef(null);
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordStatus, setPasswordStatus] = useState("");

  useEffect(() => {
    fetch(apiUrl("/api/user/me"), { headers: authHeader() })
      .then((r) => r.json())
      .then((d) => {
        setPersonalName(d.name || "");
        setPersonalOrigName(d.name || "");
        setPersonalUsername(d.username || "");
        setPersonalPhoto(d.profilePhoto || "");
        setPersonalOrigPhoto(d.profilePhoto || "");
      })
      .catch(() => {})
      .finally(() => setPersonalLoading(false));
  }, []);

  const handleSavePersonal = async () => {
    const name = personalName.trim();
    if (!name) { setPersonalStatus("Error"); setTimeout(() => setPersonalStatus(""), 1800); return; }
    setPersonalSaving(true);
    try {
      const res = await fetch(apiUrl("/api/user/me"), {
        method: "PATCH",
        headers: authHeader(),
        body: JSON.stringify({ name, profilePhoto: personalPhoto }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(readApiError(data, "Save failed"));
      setPersonalName(data.name || name);
      setPersonalOrigName(data.name || name);
      setPersonalPhoto(data.profilePhoto || "");
      setPersonalOrigPhoto(data.profilePhoto || "");
      // Keep the profile menu / anywhere else reading the cached session's
      // name (App.js's displayName) in sync immediately, not just on next
      // login — same read/write pair sessionCleanup.js already exposes.
      const session = readStoredSession();
      if (session) writeStoredSession({ ...session, name: data.name || name, profilePhoto: data.profilePhoto || "" });
      setPersonalStatus("Saved");
    } catch {
      setPersonalStatus("Error");
    } finally {
      setPersonalSaving(false);
      setTimeout(() => setPersonalStatus(""), 1800);
    }
  };

  const handleProfilePhotoFile = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setPersonalStatus("Image only");
      setTimeout(() => setPersonalStatus(""), 1800);
      return;
    }
    if (file.size > 1_000_000) {
      setPersonalStatus("Too large");
      setTimeout(() => setPersonalStatus(""), 1800);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setPersonalPhoto(String(reader.result || ""));
    reader.onerror = () => {
      setPersonalStatus("Error");
      setTimeout(() => setPersonalStatus(""), 1800);
    };
    reader.readAsDataURL(file);
  };

  const handlePasswordChange = (field, value) => {
    setPasswordStatus("");
    setPasswordForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSavePassword = async () => {
    const currentPassword = passwordForm.currentPassword.trim();
    const newPassword = passwordForm.newPassword;
    const confirmPassword = passwordForm.confirmPassword;
    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordStatus("Fill all fields");
      setTimeout(() => setPasswordStatus(""), 2200);
      return;
    }
    if (newPassword.length < 6) {
      setPasswordStatus("Min 6 chars");
      setTimeout(() => setPasswordStatus(""), 2200);
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordStatus("Mismatch");
      setTimeout(() => setPasswordStatus(""), 2200);
      return;
    }

    setPasswordSaving(true);
    try {
      const res = await fetch(apiUrl("/api/user/me/password"), {
        method: "PATCH",
        headers: authHeader(),
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(readApiError(data, "Password update failed"));
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setPasswordStatus("Saved");
    } catch (error) {
      setPasswordStatus(error.message || "Error");
    } finally {
      setPasswordSaving(false);
      setTimeout(() => setPasswordStatus(""), 2400);
    }
  };

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
      setSocialMeta({
        hasAccessToken: Boolean(d.config?.hasAccessToken),
        hasMetaAppSecret: Boolean(d.config?.hasMetaAppSecret),
        updatedAt: d.config?.updatedAt || "",
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
      setSocialMeta({ hasAccessToken: false, hasMetaAppSecret: false, updatedAt: "" });
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

  // Dev AI Avatar (Anam) usage — org-wide minutes used this calendar month,
  // computed backend-side from Anam's own session records (see
  // GET /api/anam/usage in back/routes/AnamAPI.js — Anam has no dedicated
  // usage API, so this sums session durations itself).
  useEffect(() => {
    fetch(apiUrl("/api/anam/usage"), { headers: authHeader() })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || "Could not load Anam usage.");
        setAnamUsage(d);
      })
      .catch((e) => setAnamUsageError(e.message))
      .finally(() => setAnamUsageLoading(false));
  }, []);

  // This user's own one-minute Anam trial (separate from the org-wide
  // usage above) — see GET /api/anam/trial in back/routes/AnamAPI.js.
  useEffect(() => {
    fetch(apiUrl("/api/anam/trial"), { headers: authHeader() })
      .then((r) => r.json())
      .then((d) => setAnamTrial(d))
      .catch(() => {})
      .finally(() => setAnamTrialLoading(false));
  }, []);

  useEffect(() => {
    fetch(apiUrl("/api/voice-clone/profile"), { headers: authHeader() })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || "Could not load voice profiles.");
        setVoiceProfiles(d.profiles || []);
      })
      .catch(() => setVoiceProfiles([]))
      .finally(() => setVoiceProfilesLoading(false));
  }, []);

  const handleTtsProvider = (id) => {
    setTtsProviderId(id);
    writeTtsProviderId(id);
  };

  const handleVoiceProfile = (id) => {
    setSelectedVoiceProfileId(id);
    writeVoiceSettings({ voiceProfileId: id || null });
  };

  // Live refresh: hits each provider's real /models endpoint on the backend
  // (see ai-status?live=1) instead of just checking whether an env key is
  // set, so this both confirms the provider is actually reachable right now
  // and pulls back the model ids really running behind it.
  const handleRefreshProviders = async () => {
    setAiRefreshing(true);
    try {
      const r = await fetch(apiUrl("/api/settings/ai-status?live=1"));
      const d = await r.json().catch(() => ({}));
      setProviders(d.providers || []);
    } catch {
      // leave the existing list in place on failure
    } finally {
      setAiRefreshing(false);
    }
  };

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
        void loadSocialConfig("Connected").then(() => {
          void runSocialTest({ silent: true });
        });
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
          testedAt: new Date().toISOString(),
        });
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [socialConfig.graphApiVersion]);

  const handleTheme = (id) => {
    setTheme(applyTheme(id));
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

  // Persists the chosen model for one provider (overrides its env-var
  // default backend-side — see PATCH /api/settings/ai-provider-model).
  const handleProviderModel = async (providerId, model) => {
    setProviders((prev) => prev.map((p) => (p.id === providerId ? { ...p, model } : p)));
    try {
      await fetch(apiUrl("/api/settings/ai-provider-model"), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ providerId, model }),
      });
    } catch {
      // the select already reflects the choice locally; a failed save just
      // means it won't survive a refresh, which the user can retry
    }
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
      setSocialMeta({
        hasAccessToken: Boolean(data.config?.hasAccessToken),
        hasMetaAppSecret: Boolean(data.config?.hasMetaAppSecret),
        updatedAt: data.config?.updatedAt || "",
      });
      setSocialOrig(next);
      setSocialStatus("Saved");
    } catch (e) {
      setSocialStatus("Error");
    } finally {
      setSocialSaving(false);
      setTimeout(() => setSocialStatus(""), 1800);
    }
  };

  const runSocialTest = async ({ silent = false } = {}) => {
    if (!silent) {
      setSocialTesting(true);
      setSocialTestResult(null);
    }
    try {
      const body = {
        metaAppId: socialConfig.metaAppId,
        instagramAccountId: socialConfig.instagramAccountId,
        graphApiVersion: socialConfig.graphApiVersion,
      };
      if (socialConfig.metaAppSecret.trim()) body.metaAppSecret = socialConfig.metaAppSecret;
      if (socialConfig.accessToken.trim()) body.accessToken = socialConfig.accessToken;

      const res = await fetch(apiUrl("/api/settings/instagram-config/test"), {
        method: "POST",
        headers: authHeader(),
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Connection test failed.");
      setSocialTestResult({
        ok: Boolean(data.ok),
        error: "",
        checks: Array.isArray(data.checks) ? data.checks : [],
        graphApiVersion: data.graphApiVersion || "",
        testedAt: new Date().toISOString(),
      });
    } catch (e) {
      setSocialTestResult({
        ok: false,
        error: e.message || "Connection test failed.",
        checks: [],
        graphApiVersion: socialConfig.graphApiVersion || "",
        testedAt: new Date().toISOString(),
      });
    } finally {
      setSocialTesting(false);
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
        setSocialMeta({
          hasAccessToken: Boolean(saveData.config?.hasAccessToken),
          hasMetaAppSecret: Boolean(saveData.config?.hasMetaAppSecret),
          updatedAt: saveData.config?.updatedAt || "",
        });
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
    await runSocialTest();
  };

  const handleClearSocialToken = async () => {
    if (!window.confirm("Clear the saved Instagram access token?")) return;
    setSocialSaving(true);
    try {
      const res = await fetch(apiUrl("/api/settings/instagram-config/clear-token"), {
        method: "POST",
        headers: authHeader(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to clear the saved Instagram token.");
      setSocialConfig((prev) => ({
        ...prev,
        accessToken: "",
        accessTokenMasked: data.config?.accessTokenMasked || "",
      }));
      setSocialMeta({
        hasAccessToken: Boolean(data.config?.hasAccessToken),
        hasMetaAppSecret: Boolean(data.config?.hasMetaAppSecret),
        updatedAt: data.config?.updatedAt || "",
      });
      setSocialTestResult(null);
      setSocialStatus("Cleared");
    } catch (e) {
      setSocialStatus("Error");
      setSocialTestResult({
        ok: false,
        error: e.message || "Failed to clear the saved Instagram token.",
        checks: [],
        graphApiVersion: socialConfig.graphApiVersion || "",
        testedAt: new Date().toISOString(),
      });
    } finally {
      setSocialSaving(false);
      setTimeout(() => setSocialStatus(""), 1800);
    }
  };

  const socialTokenStateLabel = socialMeta.hasAccessToken
    ? socialTestResult?.ok === false
      ? "Saved but failing verification"
      : socialTestResult?.ok === true
        ? "Saved and verified"
        : "Saved but not verified yet"
    : "No token saved";

  const socialLastUpdatedLabel = socialMeta.updatedAt
    ? new Date(socialMeta.updatedAt).toLocaleString()
    : "Never";
  const canTestSocialConnection = socialMeta.hasAccessToken || Boolean(socialConfig.accessToken.trim());

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

          {/* ═══ PERSONAL INFORMATION ═══ */}
          {section === "personal" && (
            <div className="sett_section">
              <h2 className="sett_section_title">Personal Information</h2>
              <p className="sett_section_desc">Your account's basic identity — shown across AMCTOSHS wherever your name appears.</p>

              {personalLoading ? (
                <div className="sett_prompt_loading">Loading…</div>
              ) : (
                <>
                <div className="sett_prompt_block">
                  <div className="sett_prompt_header">
                    <div>
                      <div className="sett_prompt_label">Profile pic</div>
                      <div className="sett_prompt_desc">Shown in the Home page profile button and account menu.</div>
                    </div>
                    <div className="sett_prompt_actions">
                      <button
                        className="sett_btn sett_btn--ghost"
                        onClick={() => profilePhotoInputRef.current?.click()}
                        disabled={personalSaving}
                      >
                        Choose image
                      </button>
                      <button
                        className="sett_btn sett_btn--ghost"
                        onClick={() => setPersonalPhoto("")}
                        disabled={!personalPhoto || personalSaving}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                  <div className="sett_profile_photo_row">
                    <div className="sett_profile_photo_preview">
                      {personalPhoto ? (
                        <img src={personalPhoto} alt="Profile preview" />
                      ) : (
                        <span>{(personalName || personalUsername || "P").trim().slice(0, 2).toUpperCase()}</span>
                      )}
                    </div>
                    <div className="sett_profile_photo_hint">
                      Use a square PNG, JPG, WebP, or GIF under 1 MB.
                    </div>
                    <input
                      ref={profilePhotoInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      hidden
                      onChange={handleProfilePhotoFile}
                    />
                  </div>

                  <div className="sett_prompt_header">
                    <div>
                      <div className="sett_prompt_label">Display name</div>
                      <div className="sett_prompt_desc">Shown in the profile menu, and anywhere else your name appears in the app.</div>
                    </div>
                    <div className="sett_prompt_actions">
                      {personalStatus && (
                        <span className={`sett_save_status${personalStatus === "Error" ? " sett_save_status--err" : ""}`}>
                          {personalStatus}
                        </span>
                      )}
                      <button
                        className="sett_btn sett_btn--ghost"
                        onClick={() => {
                          setPersonalName(personalOrigName);
                          setPersonalPhoto(personalOrigPhoto);
                        }}
                        disabled={(personalName === personalOrigName && personalPhoto === personalOrigPhoto) || personalSaving}
                      >
                        Reset
                      </button>
                      <button
                        className="sett_btn sett_btn--primary"
                        onClick={handleSavePersonal}
                        disabled={(personalName === personalOrigName && personalPhoto === personalOrigPhoto) || personalSaving}
                      >
                        {personalSaving ? "Saving…" : "Save"}
                      </button>
                    </div>
                  </div>
                  <input
                    type="text"
                    className="sett_text_input"
                    value={personalName}
                    onChange={(e) => setPersonalName(e.target.value)}
                    maxLength={100}
                    placeholder="Your name"
                  />

                  <div className="sett_prompt_header" style={{ marginTop: "1.1rem" }}>
                    <div>
                      <div className="sett_prompt_label">Username</div>
                      <div className="sett_prompt_desc">Used to sign in — not editable here.</div>
                    </div>
                  </div>
                  <input type="text" className="sett_text_input" value={personalUsername} disabled readOnly />
                </div>

                <div className="sett_prompt_block">
                  <div className="sett_prompt_header">
                    <div>
                      <div className="sett_prompt_label">Change password</div>
                      <div className="sett_prompt_desc">Enter your current password, then choose a new one.</div>
                    </div>
                    <div className="sett_prompt_actions">
                      {passwordStatus && (
                        <span className={`sett_save_status${passwordStatus !== "Saved" ? " sett_save_status--err" : ""}`}>
                          {passwordStatus}
                        </span>
                      )}
                      <button
                        className="sett_btn sett_btn--primary"
                        onClick={handleSavePassword}
                        disabled={passwordSaving}
                      >
                        {passwordSaving ? "Saving…" : "Change password"}
                      </button>
                    </div>
                  </div>

                  <div className="sett_password_grid">
                    <label className="sett_password_field">
                      <span>Current password</span>
                      <input
                        type="password"
                        className="sett_text_input"
                        value={passwordForm.currentPassword}
                        onChange={(e) => handlePasswordChange("currentPassword", e.target.value)}
                        autoComplete="current-password"
                      />
                    </label>
                    <label className="sett_password_field">
                      <span>New password</span>
                      <input
                        type="password"
                        className="sett_text_input"
                        value={passwordForm.newPassword}
                        onChange={(e) => handlePasswordChange("newPassword", e.target.value)}
                        autoComplete="new-password"
                      />
                    </label>
                    <label className="sett_password_field">
                      <span>Confirm new password</span>
                      <input
                        type="password"
                        className="sett_text_input"
                        value={passwordForm.confirmPassword}
                        onChange={(e) => handlePasswordChange("confirmPassword", e.target.value)}
                        autoComplete="new-password"
                      />
                    </label>
                  </div>
                </div>
                </>
              )}
            </div>
          )}

          {/* ═══ PROMPTS ═══ */}
          {section === "prompts" && (
            <div className="sett_section">
              <h2 className="sett_section_title">Prompts</h2>
              <p className="sett_section_desc">Edit the AI prompts used across AMCTOSHS. Changes take effect immediately on the server for backend prompts.</p>

              <PromptEditor
                label="Hyle Extraction"
                desc="Used when extracting hyles from PDF, Word, or image sources — the core AMCTOSHS classification engine."
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
                label="AMCTOSHS Classification Prompt"
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
              <div className="sett_section_header_row">
                <div>
                  <h2 className="sett_section_title">AI Providers</h2>
                  <p className="sett_section_desc">
                    Select the default AI provider used across AMCTOSHS. The provider is sent with every extraction and classification request.
                    Configure API keys in your backend environment variables.
                  </p>
                </div>
                <button
                  type="button"
                  className="sett_btn sett_btn--ghost sett_provider_refresh_btn"
                  onClick={handleRefreshProviders}
                  disabled={aiRefreshing || aiLoading}
                  title="Ping every provider's /models endpoint to refresh status and the live model list"
                >
                  <i className={`fi fi-rr-refresh${aiRefreshing ? " sett_spin" : ""}`} />
                  {aiRefreshing ? "Refreshing…" : "Refresh"}
                </button>
              </div>

              <div className="sett_usage_card">
                <div className="sett_usage_card_header">
                  <span className="sett_usage_card_title">Dev AI Avatar (Anam)</span>
                  {anamUsage?.monthStart && (
                    <span className="sett_usage_card_period">
                      {new Date(anamUsage.monthStart).toLocaleDateString(undefined, { month: "long", year: "numeric" })}
                    </span>
                  )}
                </div>
                {anamUsageLoading ? (
                  <div className="sett_ai_loading">Loading usage…</div>
                ) : anamUsageError ? (
                  <div className="sett_usage_card_error">{anamUsageError}</div>
                ) : (
                  <div className="sett_usage_card_body">
                    <span className="sett_usage_minutes">{anamUsage.minutesUsed.toLocaleString()}</span>
                    <span className="sett_usage_unit">minutes used this month</span>
                    <span className="sett_usage_sessions">
                      {anamUsage.sessionCount.toLocaleString()} session{anamUsage.sessionCount === 1 ? "" : "s"}
                    </span>
                  </div>
                )}
              </div>

              <div className="sett_usage_card">
                <div className="sett_usage_card_header">
                  <span className="sett_usage_card_title">Your Anam Trial</span>
                </div>
                <p className="sett_section_desc" style={{ margin: "0 0 0.6rem" }}>
                  Every account gets one minute of the cloud Anam avatar to try — once it's used up, Dev AI
                  automatically switches to the Local 3D avatar for you.
                </p>
                {anamTrialLoading ? (
                  <div className="sett_ai_loading">Loading trial status…</div>
                ) : anamTrial ? (
                  <div className="sett_usage_card_body">
                    <span className="sett_usage_minutes">
                      {anamTrial.secondsUsed}<span className="sett_usage_unit" style={{ marginLeft: "0.3rem" }}>/ {anamTrial.totalSeconds}s used</span>
                    </span>
                    <span className="sett_usage_sessions">
                      {anamTrial.exhausted ? "Trial used up — now on Local 3D" : `${anamTrial.secondsRemaining}s remaining`}
                    </span>
                  </div>
                ) : (
                  <div className="sett_usage_card_error">Could not load trial status.</div>
                )}
              </div>

              <div className="sett_usage_card">
                <AvatarProviderSelector />
              </div>

              <div className="sett_usage_card">
                <div className="sett_usage_card_header">
                  <span className="sett_usage_card_title">Local 3D Voice</span>
                </div>
                <p className="sett_section_desc" style={{ margin: "0 0 0.6rem" }}>
                  Choose which engine the local 3D avatar speaks with. OpenVoiceClone needs at least one ready
                  voice profile — record or upload one below, then select it here.
                </p>

                <div id="sett_tts_provider_grid">
                  {TTS_PROVIDER_OPTIONS.map((opt) => (
                    <div
                      key={opt.id}
                      className={`sett_provider_card${ttsProviderId === opt.id ? " sett_provider_card--active" : ""}${opt.disabled ? " sett_provider_card--disabled" : ""}`}
                      onClick={() => !opt.disabled && handleTtsProvider(opt.id)}
                    >
                      <div className="sett_provider_top">
                        <span className="sett_provider_name">{opt.label}</span>
                        {ttsProviderId === opt.id && <span className="sett_provider_active_tag">Active</span>}
                      </div>
                      <div className="sett_provider_status_msg">{opt.desc}</div>
                    </div>
                  ))}
                </div>

                {ttsProviderId === TTS_PROVIDERS.OPENVOICE && (
                  <div id="sett_provider_default_row" style={{ marginTop: "0.8rem" }}>
                    <span className="sett_field_label">Voice profile</span>
                    {voiceProfilesLoading ? (
                      <span className="sett_ai_loading">Loading…</span>
                    ) : (
                      <select
                        value={selectedVoiceProfileId || ""}
                        onChange={(e) => handleVoiceProfile(e.target.value)}
                      >
                        <option value="">— Select a voice profile —</option>
                        {voiceProfiles.map((p) => (
                          <option key={p.id} value={p.id} disabled={!p.hasEmbedding}>
                            {p.name} ({p.language === "ar" ? "Arabic" : "English"}){p.hasEmbedding ? "" : " — processing…"}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                )}

                {ttsProviderId === TTS_PROVIDERS.OPENVOICE && !voiceProfilesLoading && voiceProfiles.length === 0 && (
                  <p className="sett_provider_status_msg" style={{ marginTop: "0.5rem" }}>
                    No voice profiles yet — create one to use your own cloned voice.
                  </p>
                )}

                <button
                  type="button"
                  className="sett_btn sett_btn--ghost"
                  style={{ marginTop: "0.8rem" }}
                  onClick={() => navigate("/voice-profile")}
                >
                  Manage voice profiles
                </button>
              </div>

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
                          <span className={`sett_provider_badge sett_provider_badge--${
                            p.status === "online" ? "ok"
                              : p.status === "error" ? "error"
                              : p.status === "unconfigured" ? "off"
                              : p.configured ? "ok" : "off"
                          }`}>
                            {p.status === "online" ? "Online"
                              : p.status === "error" ? "Error"
                              : p.status === "unconfigured" ? "No key"
                              : (p.configured ? "Configured" : "No key")}
                          </span>
                        </div>
                        <select
                          className="sett_provider_model_select"
                          value={p.model}
                          onClick={e => e.stopPropagation()}
                          onChange={e => handleProviderModel(p.id, e.target.value)}
                          title={p.status === "online" ? "Model in use for this provider" : "Model in use — Refresh to see the provider's live model list"}
                        >
                          {Array.from(new Set([p.model, ...(p.models || [])])).map(m => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                        {p.status === "online" && p.modelAvailable === false && (
                          <div className="sett_provider_model_warn" title="This model wasn't in the provider's live /models list">
                            ⚠ not listed by provider
                          </div>
                        )}
                        <div className="sett_provider_base">{p.baseUrl}</div>
                        {p.statusMessage && (
                          <div className={`sett_provider_status_msg${p.status === "error" ? " sett_provider_status_msg--error" : ""}`}>
                            {p.statusMessage}
                          </div>
                        )}
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
                    <button className="sett_btn sett_btn--ghost" onClick={handleTestSocial} disabled={socialSaving || socialLoading || socialTesting || !canTestSocialConnection}>
                      {socialTesting ? "Testing…" : "Test Connection"}
                    </button>
                    <button className="sett_btn sett_btn--ghost" onClick={handleClearSocialToken} disabled={socialSaving || socialLoading || !socialMeta.hasAccessToken}>
                      Clear Saved Token
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
                      <div className="sett_social_status_grid">
                        <div className="sett_social_status_item">
                          <span>Token status</span>
                          <strong>{socialTokenStateLabel}</strong>
                        </div>
                        <div className="sett_social_status_item">
                          <span>Token stored</span>
                          <strong>{socialMeta.hasAccessToken ? "Yes" : "No"}</strong>
                        </div>
                        <div className="sett_social_status_item">
                          <span>App secret stored</span>
                          <strong>{socialMeta.hasMetaAppSecret ? "Yes" : "No"}</strong>
                        </div>
                        <div className="sett_social_status_item">
                          <span>Last credential update</span>
                          <strong>{socialLastUpdatedLabel}</strong>
                        </div>
                      </div>
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
              {!canTestSocialConnection && !socialLoading && (
                <div className="sett_social_inline_hint">
                  No access token saved. <strong>Connect Instagram</strong> first, then test the connection.
                </div>
              )}

              {socialTestResult && (
                <div className={`sett_social_test${socialTestResult.ok ? " sett_social_test--ok" : " sett_social_test--err"}`}>
                  <div className="sett_social_test_title">
                    {socialTestResult.ok ? "Connection looks good" : "Connection needs attention"}
                  </div>
                  {socialTestResult.graphApiVersion && (
                    <div className="sett_social_test_meta">Graph API version: {socialTestResult.graphApiVersion}</div>
                  )}
                  {socialTestResult.testedAt && (
                    <div className="sett_social_test_meta">Last verification: {new Date(socialTestResult.testedAt).toLocaleString()}</div>
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
                A complete breakdown of what AMCTOSHS AI can and cannot access during a conversation.
              </p>

              <div className="sett_access_group">
                <div className="sett_access_group_header sett_access_group_header--on">
                  <i className="fi fi-rr-check-circle" /> Always available
                </div>
                <ul className="sett_access_list">
                  <li><strong>AMCTOSHS domain model</strong> — Clinical Presentation 6-step pipeline (Patient Reality → Patient Access → Patient Interpretation → Clinician Access → Clinician Interpretation → Clinical Intervention) and Clinical Representation theory injected into every system prompt.</li>
                  <li><strong>Conversation history</strong> — all messages exchanged in the current session are included with each request, giving the AI full context of the ongoing conversation.</li>
                  <li><strong>Selected AI provider &amp; model</strong> — the provider you choose in the chat dropdown determines which backend inference engine processes the request.</li>
                </ul>
              </div>

              <div className="sett_access_group">
                <div className="sett_access_group_header sett_access_group_header--off">
                  <i className="fi fi-rr-terminal" /> Codebase context
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
                <div className="sett_access_group_header sett_access_group_header--off">
                  <i className="fi fi-rr-database" /> DB context
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
                Word suggestions appear while typing in any text field across AMCTOSHS. Check which text pools feed the
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

          {/* ═══ PDF READER ═══ */}
          {section === "pdf_reader" && (
            <div className="sett_section">
              <h2 className="sett_section_title">PDF Reader</h2>
              <p className="sett_section_desc">
                Settings for the PDF Reader's selection bar — the thin action bar that appears under the toolbar when you double-click a word.
              </p>

              <div id="sett_provider_default_row">
                <span className="sett_field_label">Translate to</span>
                <select
                  id="sett_pdf_translate_lang_select"
                  value={pdfTranslateLang}
                  onChange={(e) => {
                    setPdfTranslateLang(e.target.value);
                    localStorage.setItem("mctosh_pdf_translate_lang", e.target.value);
                  }}
                >
                  {TRANSLATE_LANGUAGES.map((lang) => (
                    <option key={lang} value={lang}>{lang}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* ═══ THEME ═══ */}
          {section === "theme" && (
            <div className="sett_section">
              <h2 className="sett_section_title">Theme</h2>
              <p className="sett_section_desc">Choose the visual style for AMCTOSHS. Applied immediately and remembered across sessions.</p>

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
