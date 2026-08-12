import React, { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { API_BASE_URL, apiUrl } from "../config/api";
import { readStoredSession, writeStoredSession } from "../utils/sessionCleanup";
import { MCTOSH_PROMPT_TEXT } from "../Hylomorphism/mctoshPrompt";
import { getPredictionPools, setPredictionPoolEnabled, rebuildPredictionPool, ingestPredictionPool } from "../utils/predictionApi";
import objectivesEn from "../MCC/mccqeObjectivesData.json";
import objectivesAr from "../MCC/mccqeObjectivesArabicData.json";
import AvatarProviderSelector from "../Avatar/AvatarProviderSelector";
import CameraPresetTab from "./CameraPresetTab";
import ContextSettingsTab from "./ContextSettingsTab";
import { readDevAiSettings, writeDevAiSettings } from "../App/devAiSettings";
import {
  readVoiceSettings, writeVoiceSettings,
  TTS_PROVIDERS, readTtsProviderId, writeTtsProviderId,
  KOKORO_VOICE_OPTIONS,
  SUPERTONIC_VOICE_OPTIONS,
} from "../Avatar/local3d/ttsProviderSettings";
import {
  readSttSettings,
  writeSttSettings,
  STT_PROVIDER_OPTIONS,
} from "../Avatar/local3d/sttProviderSettings";
import { AVATAR_POSE_CONTROLS, emitAvatarPoseUpdate, readSavedPose, writeSavedPose } from "../Avatar/local3d/avatarPoseSettings";
import { applyTheme, readStoredTheme } from "../utils/theme";
import { MEDICAL_DICTIONARY_API_URL, OTHER_DICTIONARY_API_URL } from "../utils/dictionarySettings";
import { listSavedVocabulary } from "../utils/vocabApi";
import { readUmlsLanguage, UMLS_LANGUAGE_OPTIONS, writeUmlsLanguage } from "../Vocabs/umlsSettings";
import "./settingsPage.css";

const TTS_PROVIDER_OPTIONS = [
  { id: TTS_PROVIDERS.BROWSER, label: "Browser Speech Synthesis", desc: "Free, built into your browser — no setup needed." },
  { id: TTS_PROVIDERS.OPENVOICE, label: "OpenVoiceClone", desc: "Speaks in your own cloned voice — needs a voice profile below." },
  { id: TTS_PROVIDERS.KOKORO, label: "Kokoro", desc: "Free, self-hosted — pick the Kokoro voice you want here." },
  { id: TTS_PROVIDERS.SUPERTONIC, label: "Supertonic", desc: "Fast local TTS with built-in voices — pick the Supertonic voice you want here." },
];

const stripHtml = (html) => String(html || "").replace(/<[^>]+>/g, " ");

const CORPUS_INPUTS = [
  { id: "hyle_text", label: "Hyle Text extraction Text" },
  { id: "hyle_ocr", label: "Hyle OCR Text" },
  { id: "notebook", label: "Notebook Typing Text" },
  { id: "vocabs", label: "AMCTOSHS Vocabs text" },
];

const corpusTokens = (value) => String(value || "")
  .normalize("NFKC")
  .toLocaleLowerCase()
  .match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) || [];

const corpusDataType = (string) => /[\p{L}]/u.test(string) && /[\p{N}]/u.test(string)
  ? "alphanumeric"
  : /^[\p{N}]+$/u.test(string) ? "number" : "word";

const countCorpusWords = (sourceTexts) => {
  const counts = new Map();
  sourceTexts.forEach(({ source, texts }) => texts.forEach((text) => corpusTokens(text).forEach((word) => {
    const current = counts.get(word) || { occurrence: 0, sources: new Set(), sourceCounts: {} };
    current.occurrence += 1;
    current.sources.add(source);
    current.sourceCounts[source] = (current.sourceCounts[source] || 0) + 1;
    counts.set(word, current);
  })));
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    .map(([string, details], index) => ({
      id: `corpus#${index + 1}`,
      string,
      occurrence: details.occurrence,
      sources: [...details.sources].join(", "),
      sourceCounts: details.sourceCounts,
      dataType: corpusDataType(string),
    }));
};

const DEFAULT_SEMANTIC_DETECTION_SETTINGS = {
  enabled: true,
  provider: "openai",
  model: "gpt-5.6-terra",
  reasoningEffort: "medium",
  sendOriginalPdf: true,
  sendPageImage: true,
  includeAdjacentPages: true,
  confidenceThreshold: 0.85,
  preserveExistingAnnotations: true,
  usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0, runs: 0, lastRunAt: null },
};

const DEFAULT_OCR_SETTINGS = {
  enabled: true,
  automaticallyProcessOnUpload: true,
  persistRawResponse: true,
  retryFailedJobs: true,
};

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
  { id: "vocabs",     label: "AMCTOSHS Vocabs", icon: "fi fi-rr-book-alt" },
  { id: "ai_access",  label: "AI Access",       icon: "fi fi-rr-shield-check" },
  { id: "social",     label: "Social Publish",  icon: "fi fi-rr-megaphone" },
  { id: "prediction", label: "Corpus", icon: "fi fi-rr-keyboard" },
  { id: "context",    label: "Context", icon: "fi fi-rr-brain-circuit" },
  { id: "pdf_reader", label: "PDF Reader",      icon: "fi fi-rr-file-pdf" },
  { id: "theme",      label: "Theme",           icon: "fi fi-rr-palette" },
];

// Dev-only camera tuning tool (moved off the Home page, see
// CameraPresetTab.jsx) — restricted to a single username, not a general
// permission/role, since it's a one-person workflow (tune a shot, copy it
// as code, paste it into ThreadPyramidLogo.jsx, commit).
const CAMERA_TAB_USERNAME = "rudyhamame";
const CAMERA_SECTION = { id: "camera", label: "3D Camera", icon: "fi fi-rr-camera" };

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
  const canSeeCameraTab = readStoredSession()?.username === CAMERA_TAB_USERNAME;
  const visibleSections = canSeeCameraTab ? [...SECTIONS, CAMERA_SECTION] : SECTIONS;
  const [theme,     setTheme]     = useState(() => readStoredTheme());
  const [pdfTranslateLang, setPdfTranslateLang] = useState(() => localStorage.getItem("mctosh_pdf_translate_lang") || "English");
  const [vocabTranslateLang, setVocabTranslateLang] = useState(() => localStorage.getItem("mctosh_vocab_translate_lang") || "French");
  const [umlsLanguage, setUmlsLanguage] = useState(() => readUmlsLanguage());
  const [providers, setProviders] = useState([]);
  const [translators, setTranslators] = useState([]);
  const [phoneticProviders, setPhoneticProviders] = useState([]);
  const [semanticDetectionSettings, setSemanticDetectionSettings] = useState(DEFAULT_SEMANTIC_DETECTION_SETTINGS);
  const [semanticDetectionUsage, setSemanticDetectionUsage] = useState(DEFAULT_SEMANTIC_DETECTION_SETTINGS.usage);
  const [semanticDetectionSaving, setSemanticDetectionSaving] = useState(false);
  const [ocrSettings, setOcrSettings] = useState(DEFAULT_OCR_SETTINGS);
  const [ocrSaving, setOcrSaving] = useState(false);
  const [aiLoading, setAiLoading] = useState(true);
  const [aiRefreshing, setAiRefreshing] = useState(false);
  const [anamUsage, setAnamUsage] = useState(null);
  const [anamUsageLoading, setAnamUsageLoading] = useState(true);
  const [anamUsageError, setAnamUsageError] = useState("");
  const [anamTrial, setAnamTrial] = useState(null);
  const [anamTrialLoading, setAnamTrialLoading] = useState(true);
  const [ttsProviderId, setTtsProviderId] = useState(() => readTtsProviderId());
  const [selectedVoiceProfileId, setSelectedVoiceProfileId] = useState(() => readVoiceSettings().voiceProfileId);
  const [selectedKokoroVoice, setSelectedKokoroVoice] = useState(() => readVoiceSettings().kokoroVoice);
  const [selectedSupertonicVoice, setSelectedSupertonicVoice] = useState(() => readVoiceSettings().supertonicVoice);
  const [interruptOnSpeech, setInterruptOnSpeech] = useState(() => readDevAiSettings().interruptOnSpeech);
  const [sttSettings, setSttSettings] = useState(() => readSttSettings());
  const [avatarPose, setAvatarPose] = useState(() => readSavedPose());
  const [savedAvatarPose, setSavedAvatarPose] = useState(() => readSavedPose());
  const [voiceProfiles, setVoiceProfiles] = useState([]);
  const [voiceProfilesLoading, setVoiceProfilesLoading] = useState(true);
  const [defProvider, setDefProvider] = useState(() => localStorage.getItem("mctosh_ai_provider") || "groq");
  const [predictPools,   setPredictPools]   = useState([]);
  const [predictLoading, setPredictLoading] = useState(true);
  const [predictBusyKey, setPredictBusyKey] = useState(null);
  const [predictError,   setPredictError]   = useState("");
  const [predictionEnabled, setPredictionEnabled] = useState(() => localStorage.getItem("mctosh_prediction_enabled") === "true");
  const [corpusRows, setCorpusRows] = useState([]);
  const [corpusInputCounts, setCorpusInputCounts] = useState(() => Object.fromEntries(CORPUS_INPUTS.map(({ id }) => [id, 0])));
  const [selectedCorpusSource, setSelectedCorpusSource] = useState("all");
  const [corpusSettingsOpen, setCorpusSettingsOpen] = useState(false);
  const [corpusDataTypes, setCorpusDataTypes] = useState({ word: true, number: true, alphanumeric: true });
  const [corpusRefreshTick, setCorpusRefreshTick] = useState(0);
  const [corpusLoading, setCorpusLoading] = useState(false);
  const [corpusProgress, setCorpusProgress] = useState(0);
  const [corpusError, setCorpusError] = useState("");
  const corpusTextsRef = useRef(Object.fromEntries(CORPUS_INPUTS.map(({ id }) => [id, []])));
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
      .then(d => {
        setProviders(d.providers || []);
        setTranslators(d.translators || []);
        setPhoneticProviders(d.phonetics || []);
      })
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

  const handleKokoroVoice = (id) => {
    const nextVoice = id || KOKORO_VOICE_OPTIONS[0]?.id || "";
    setSelectedKokoroVoice(nextVoice);
    writeVoiceSettings({ kokoroVoice: nextVoice });
    if (ttsProviderId !== TTS_PROVIDERS.KOKORO) {
      handleTtsProvider(TTS_PROVIDERS.KOKORO);
    }
  };

  const handleSupertonicVoice = (id) => {
    const nextVoice = id || SUPERTONIC_VOICE_OPTIONS[0]?.id || "";
    setSelectedSupertonicVoice(nextVoice);
    writeVoiceSettings({ supertonicVoice: nextVoice });
    if (ttsProviderId !== TTS_PROVIDERS.SUPERTONIC) {
      handleTtsProvider(TTS_PROVIDERS.SUPERTONIC);
    }
  };

  const handleInterruptOnSpeech = (checked) => {
    setInterruptOnSpeech(Boolean(checked));
    writeDevAiSettings({ interruptOnSpeech: Boolean(checked) });
  };

  const handleSttProvider = (provider) => {
    const next = writeSttSettings({ provider });
    setSttSettings(next);
  };

  const handleSttModel = (model) => {
    const next = writeSttSettings({ model });
    setSttSettings(next);
  };

  const handleAvatarPose = (key, value) => {
    const nextPose = { ...avatarPose, [key]: Number(value) };
    setAvatarPose(nextPose);
    emitAvatarPoseUpdate(nextPose);
  };

  const handleSaveAvatarPose = () => {
    const nextPose = writeSavedPose(avatarPose);
    setAvatarPose(nextPose);
    setSavedAvatarPose(nextPose);
  };

  const handleIgnoreAvatarPose = () => {
    const nextPose = { ...savedAvatarPose };
    setAvatarPose(nextPose);
    emitAvatarPoseUpdate(nextPose);
  };

  const avatarPoseDirty = AVATAR_POSE_CONTROLS.some(
    ({ key }) => Math.abs((avatarPose[key] || 0) - (savedAvatarPose[key] || 0)) > 0.0001
  );

  // Live refresh: hits each provider's real /models endpoint on the backend
  // (see ai-status?live=1) instead of just checking whether an env key is
  // set, so this both confirms the provider is actually reachable right now
  // and pulls back the model ids really running behind it.
  const handleRefreshProviders = async () => {
    setAiRefreshing(true);
    try {
      const providerResponse = await fetch(apiUrl("/api/settings/ai-status?live=1"));
      const providerData = await providerResponse.json().catch(() => ({}));
      setProviders(providerData.providers || []);
      setTranslators(providerData.translators || []);
      setPhoneticProviders(providerData.phonetics || []);
    } catch {
      // leave the existing list in place on failure
    } finally {
      setAiRefreshing(false);
    }
  };

  useEffect(() => {
    getPredictionPools()
      .then((pools) => {
        setPredictPools(pools);
        if (localStorage.getItem("mctosh_prediction_enabled") === null) {
          setPredictionEnabled(pools.some((pool) => pool.enabled));
        }
      })
      .catch((e) => setPredictError(e.message))
      .finally(() => setPredictLoading(false));
  }, []);

  useEffect(() => {
    // Corpus construction is deliberately independent of the selected
    // settings section. It starts when Settings mounts and keeps running in
    // the background while the user visits another settings tab.
    if (corpusRefreshTick === 0) {
      try {
        const snapshot = JSON.parse(localStorage.getItem("mctosh_corpus_snapshot") || "null");
        if (snapshot?.rows && snapshot?.inputCounts) {
          setCorpusRows(snapshot.rows);
          setCorpusInputCounts(snapshot.inputCounts);
          setCorpusProgress(100);
          setCorpusLoading(false);
          return undefined;
        }
        const cachedWords = JSON.parse(localStorage.getItem("mctosh_corpus_words") || "[]");
        if (Array.isArray(cachedWords) && cachedWords.length > 0) {
          const cachedRows = cachedWords.map((string, index) => ({
            id: `corpus#${index + 1}`,
            string: String(string),
            occurrence: 1,
            sources: "—",
            sourceCounts: {},
            dataType: corpusDataType(String(string)),
          }));
          setCorpusRows(cachedRows);
          setCorpusProgress(100);
          setCorpusLoading(false);
          return undefined;
        }
      } catch {
        // A malformed cache is ignored; the explicit refresh can rebuild it.
      }
    }
    const controller = new AbortController();
    const request = (url) => fetch(apiUrl(url), { headers: authHeader(), signal: controller.signal })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok && response.status !== 202) throw new Error(readApiError(data, "Corpus request failed."));
        return data;
      });

    const loadCorpus = async () => {
      setCorpusLoading(true);
      setCorpusProgress(0);
      setCorpusInputCounts(Object.fromEntries(CORPUS_INPUTS.map(({ id }) => [id, 0])));
      corpusTextsRef.current = Object.fromEntries(CORPUS_INPUTS.map(({ id }) => [id, []]));
      setCorpusRows([]);
      localStorage.removeItem("mctosh_corpus_words");
      localStorage.removeItem("mctosh_corpus_unit_words");
      setCorpusError("");
      localStorage.setItem("mctosh_corpus_status", "building");
      window.dispatchEvent(new Event("amctoshs:corpus-status"));
      try {
        const sourceData = await request("/api/sources/");
        setCorpusProgress(8);
        const pdfSources = (sourceData.sources || []).filter((source) => {
          const format = String(source.format || "").toLowerCase();
          return format === "pdf" || format === "application/pdf";
        });
        const totalTasks = Math.max(1, pdfSources.length * 3 + 1);
        let completedTasks = 0;
        const track = (promise, inputId, getText) => promise
          .then((data) => {
            if (inputId && getText) {
              const text = getText(data);
              corpusTextsRef.current[inputId].push(text);
              setCorpusInputCounts((current) => ({
                ...current,
                [inputId]: current[inputId] + corpusTokens(text).length,
              }));
              const liveRows = countCorpusWords(CORPUS_INPUTS.map(({ id }, index) => ({
                source: String(index + 1).padStart(2, "0"),
                texts: corpusTextsRef.current[id],
              })));
              localStorage.setItem("mctosh_corpus_words", JSON.stringify(liveRows.map((row) => row.string)));
              window.dispatchEvent(new Event("amctoshs:corpus-words"));
              setCorpusRows(liveRows);
            }
            return data;
          })
          .finally(() => {
            completedTasks += 1;
            setCorpusProgress(8 + Math.round((completedTasks / totalTasks) * 88));
          });

        const [nativeResults, ocrResults, notebookResults, vocabResult] = await Promise.all([
          Promise.allSettled(pdfSources.map((source) => track(
            request(`/api/sources/${source._id}/text`),
            "hyle_text",
            (data) => data.text || "",
          ))),
          Promise.allSettled(pdfSources.map((source) => track(
            request(`/api/sources/${source._id}/markdown`),
            "hyle_ocr",
            (data) => data.markdown || "",
          ))),
          Promise.allSettled(pdfSources.map((source) => track(
            request(`/api/source-annotations/${source._id}`),
            "notebook",
            (data) => data?.readerState?.notebookText || "",
          ))),
          track(
            listSavedVocabulary(),
            "vocabs",
            (data) => (Array.isArray(data?.saved) ? data.saved : []).map((entry) => entry.word || entry.term || "").join("\n"),
          ),
        ]);

        const nativeText = nativeResults.flatMap((result) => result.status === "fulfilled" ? [result.value.text || ""] : []);
        const ocrText = ocrResults.flatMap((result) => result.status === "fulfilled" ? [result.value.markdown || ""] : []);
        const notebookText = notebookResults.flatMap((result) => {
          const value = result.status === "fulfilled" ? result.value?.readerState?.notebookText : "";
          return typeof value === "string" ? [value] : [];
        });
        const vocabText = (Array.isArray(vocabResult?.saved) ? vocabResult.saved : [])
          .map((entry) => entry.word || entry.term || "")
          .join("\n");
        const inputTexts = { hyle_text: nativeText, hyle_ocr: ocrText, notebook: notebookText, vocabs: [vocabText] };
        const inputCounts = Object.fromEntries(CORPUS_INPUTS.map(({ id }) => [id, inputTexts[id].reduce((total, text) => total + corpusTokens(text).length, 0)]));
        setCorpusInputCounts(inputCounts);
        const completedRows = countCorpusWords(CORPUS_INPUTS.map(({ id }, index) => ({
          source: String(index + 1).padStart(2, "0"),
          texts: inputTexts[id],
        })));
        localStorage.setItem("mctosh_corpus_words", JSON.stringify(completedRows.map((row) => row.string)));
        try {
          localStorage.setItem("mctosh_corpus_snapshot", JSON.stringify({ rows: completedRows, inputCounts }));
        } catch {
          // Large corpora may exceed localStorage; the word-list cache still
          // lets the next visit avoid an automatic rebuild.
        }
        window.dispatchEvent(new Event("amctoshs:corpus-words"));
        setCorpusRows(completedRows);
        setCorpusProgress(100);
        localStorage.setItem("mctosh_corpus_status", "ready");
        window.dispatchEvent(new Event("amctoshs:corpus-status"));
      } catch (error) {
        if (error.name !== "AbortError") {
          setCorpusError(error.message || "Could not build the Corpus.");
          localStorage.setItem("mctosh_corpus_status", "error");
          window.dispatchEvent(new Event("amctoshs:corpus-status"));
        }
      } finally {
        if (!controller.signal.aborted) setCorpusLoading(false);
      }
    };
    void loadCorpus();
    return () => controller.abort();
  }, [corpusRefreshTick]);

  useEffect(() => {
    const deduplicatedWords = corpusRows
      .filter((row) => corpusDataTypes[row.dataType])
      .map((row) => row.string);
    try {
      localStorage.setItem("mctosh_corpus_unit_words", JSON.stringify(deduplicatedWords));
      window.dispatchEvent(new Event("amctoshs:corpus-words"));
    } catch {
      // Prediction can fall back to the server if browser storage is unavailable.
    }
  }, [corpusDataTypes, corpusRows]);

  useEffect(() => {
    void loadSocialConfig();
  }, []);

  useEffect(() => {
    fetch(apiUrl("/api/settings/semantic-detection"), { headers: authHeader() })
      .then((response) => response.json())
      .then((data) => {
        setSemanticDetectionSettings({ ...DEFAULT_SEMANTIC_DETECTION_SETTINGS, ...(data.settings || {}) });
        setSemanticDetectionUsage({ ...DEFAULT_SEMANTIC_DETECTION_SETTINGS.usage, ...(data.settings?.usage || {}) });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch(apiUrl("/api/settings/ocr"), { headers: authHeader() })
      .then((response) => response.json())
      .then((data) => setOcrSettings({ ...DEFAULT_OCR_SETTINGS, ...(data.settings || {}) }))
      .catch(() => {});
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

  const handlePredictionToggle = async (enabled) => {
    setPredictionEnabled(enabled);
    localStorage.setItem("mctosh_prediction_enabled", String(enabled));
    window.dispatchEvent(new Event("amctoshs:prediction-toggle"));
    setPredictError("");
    if (predictPools.length === 0) return;
    setPredictBusyKey("all");
    try {
      const nextPools = await Promise.all(predictPools.map(async (pool) => {
        const updated = await setPredictionPoolEnabled(pool.key, enabled);
        return updated || { ...pool, enabled };
      }));
      setPredictPools(nextPools);
    } catch (error) {
      setPredictionEnabled(!enabled);
      localStorage.setItem("mctosh_prediction_enabled", String(!enabled));
      setPredictError(error.message);
    } finally {
      setPredictBusyKey(null);
    }
  };

  const handleRefreshCorpus = () => {
    localStorage.setItem("mctosh_corpus_status", "building");
    localStorage.removeItem("mctosh_corpus_snapshot");
    setCorpusRefreshTick((value) => value + 1);
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

  const updateSemanticDetectionSettings = async (patch) => {
    const next = { ...semanticDetectionSettings, ...patch };
    setSemanticDetectionSettings(next);
    setSemanticDetectionSaving(true);
    try {
      const response = await fetch(apiUrl("/api/settings/semantic-detection"), {
        method: "PATCH",
        headers: authHeader(),
        body: JSON.stringify(next),
      });
      if (!response.ok) throw new Error("Failed to save settings.");
    } catch {
      // Keep the optimistic value; a later refresh will restore the server value.
    } finally {
      setSemanticDetectionSaving(false);
    }
  };

  const updateOcrSettings = async (patch) => {
    const next = { ...ocrSettings, ...patch };
    setOcrSettings(next);
    setOcrSaving(true);
    try {
      const response = await fetch(apiUrl("/api/settings/ocr"), {
        method: "PATCH",
        headers: authHeader(),
        body: JSON.stringify(next),
      });
      if (!response.ok) throw new Error("Failed to save OCR settings.");
      const data = await response.json();
      setOcrSettings({ ...DEFAULT_OCR_SETTINGS, ...(data.settings || {}) });
    } catch {
      // A refresh restores the persisted value if this optimistic save failed.
    } finally {
      setOcrSaving(false);
    }
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

      const returnTo = new URL("/settings?section=social", window.location.origin).toString();
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
  const datatypeCorpusRows = corpusRows.filter((row) => corpusDataTypes[row.dataType]);
  const visibleCorpusRows = selectedCorpusSource === "all"
    ? corpusRows
    : selectedCorpusSource === "unique"
      ? datatypeCorpusRows.map((row) => ({ ...row, occurrence: 1 }))
      : datatypeCorpusRows
      .filter((row) => row.sourceCounts[selectedCorpusSource])
      .map((row) => ({
        ...row,
        sources: selectedCorpusSource,
        occurrence: row.sourceCounts[selectedCorpusSource],
      }));
  const corpusTotalOccurrences = corpusRows.reduce((total, row) => total + row.occurrence, 0);

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
          {visibleSections.map(s => (
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
                  <span className="sett_usage_card_title">Document OCR Cache</span>
                  {ocrSaving && <span className="sett_usage_card_period">Saving…</span>}
                </div>
                <p className="sett_section_desc" style={{ margin: "0 0 0.8rem" }}>
                  Run OCR manually from the Sources table, then store and reuse its page structure for BBoxes, search, semantic detection, and the PDF assistant.
                </p>
                <div className="sett_stt_model_row">
                  <span><strong>Provider / exact model</strong><small>The model version is part of the persistent cache key.</small></span>
                  <span> Tesseract · <code>tesseract-5</code></span>
                </div>
                {[
                  ["enabled", "Enable document OCR"],
                  ["persistRawResponse", "Persist raw provider pages"],
                  ["retryFailedJobs", "Retry failed jobs"],
                ].map(([key, label]) => (
                  <label className="sett_toggle_row" key={key}>
                    <span className="sett_toggle_copy"><span className="sett_toggle_title">{label}</span></span>
                    <input type="checkbox" checked={ocrSettings[key]} onChange={(event) => updateOcrSettings({ [key]: event.target.checked })} />
                  </label>
                ))}
              </div>

              <div className="sett_usage_card">
                <div className="sett_usage_card_header">
                  <span className="sett_usage_card_title">Semantic Document Detection</span>
                  {semanticDetectionSaving && <span className="sett_usage_card_period">Saving…</span>}
                </div>
                <p className="sett_section_desc" style={{ margin: "0 0 0.8rem" }}>
                  Classify document structure with candidate geometry and OpenAI. This is separate from Smart Segmenting.
                </p>
                <div className="sett_usage_card_body" aria-label="Semantic detection token usage">
                  <span className="sett_usage_minutes">{Number(semanticDetectionUsage.totalTokens || 0).toLocaleString()}</span>
                  <span className="sett_usage_unit">tokens consumed</span>
                  <span className="sett_usage_sessions">
                    ${Number(semanticDetectionUsage.costUsd || 0).toFixed(6)} estimated API cost · {Number(semanticDetectionUsage.runs || 0).toLocaleString()} run{semanticDetectionUsage.runs === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="sett_section_desc" style={{ margin: "0.45rem 0 0.8rem" }}>
                  Input: {Number(semanticDetectionUsage.promptTokens || 0).toLocaleString()} · Output: {Number(semanticDetectionUsage.completionTokens || 0).toLocaleString()} tokens
                  {semanticDetectionUsage.lastRunAt ? ` · Last run ${new Date(semanticDetectionUsage.lastRunAt).toLocaleString()}` : ""}
                </div>
                <label className="sett_toggle_row">
                  <span className="sett_toggle_copy"><span className="sett_toggle_title">Enable Semantic Detect</span></span>
                  <input type="checkbox" checked={semanticDetectionSettings.enabled} onChange={(event) => updateSemanticDetectionSettings({ enabled: event.target.checked })} />
                </label>
                <div className="sett_stt_model_row">
                  <span><strong>Provider / model</strong><small>Credentials stay on the application backend.</small></span>
                  <span>OpenAI · <code>gpt-5.6-terra</code></span>
                </div>
                <label className="sett_stt_model_row">
                  <span><strong>Reasoning effort</strong></span>
                  <select value={semanticDetectionSettings.reasoningEffort} onChange={(event) => updateSemanticDetectionSettings({ reasoningEffort: event.target.value })}>
                    <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
                  </select>
                </label>
                {[
                  ["sendOriginalPdf", "Send original PDF"],
                  ["sendPageImage", "Send current page as PNG"],
                  ["includeAdjacentPages", "Include adjacent pages as context"],
                  ["preserveExistingAnnotations", "Preserve existing annotations"],
                ].map(([key, label]) => (
                  <label className="sett_toggle_row" key={key}>
                    <span className="sett_toggle_copy"><span className="sett_toggle_title">{label}</span></span>
                    <input type="checkbox" checked={semanticDetectionSettings[key]} onChange={(event) => updateSemanticDetectionSettings({ [key]: event.target.checked })} />
                  </label>
                ))}
                <label className="sett_stt_model_row">
                  <span><strong>Minimum confidence</strong></span>
                  <input type="number" min="0" max="1" step="0.01" value={semanticDetectionSettings.confidenceThreshold} onChange={(event) => updateSemanticDetectionSettings({ confidenceThreshold: Number(event.target.value) })} />
                </label>
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
                  <span className="sett_usage_card_title">Dev AI Voice Call</span>
                </div>
                <p className="sett_section_desc" style={{ margin: "0 0 0.6rem" }}>
                  Let your voice interrupt the avatar mid-reply. When enabled, Dev AI will stop speaking and switch to your new turn as soon as your interruption is recognized.
                </p>
                <label className="sett_toggle_row">
                  <span className="sett_toggle_copy">
                    <span className="sett_toggle_title">Interrupt avatar on speech</span>
                    <span className="sett_toggle_desc">Useful for barge-in conversations, but may be more sensitive to speaker bleed from the avatar.</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={interruptOnSpeech}
                    onChange={(e) => handleInterruptOnSpeech(e.target.checked)}
                  />
                </label>
              </div>

              <div className="sett_usage_card">
                <div className="sett_usage_card_header">
                  <span className="sett_usage_card_title">Speech-to-Text</span>
                  <span className="sett_usage_card_period">Voice input</span>
                </div>
                <p className="sett_section_desc" style={{ margin: "0 0 0.8rem" }}>
                  Choose how your microphone audio is converted to text during PDF Agent voice calls.
                </p>
                <div id="sett_stt_provider_grid">
                  {STT_PROVIDER_OPTIONS.map((option) => (
                    <button
                      type="button"
                      key={option.id}
                      className={`sett_provider_card sett_stt_provider_card${sttSettings.provider === option.id ? " sett_provider_card--active" : ""}`}
                      onClick={() => handleSttProvider(option.id)}
                    >
                      <div className="sett_provider_top">
                        <span className="sett_provider_name">{option.label}</span>
                        {sttSettings.provider === option.id && <span className="sett_stt_active_mark"><i className="fi fi-rr-check" /> Active</span>}
                      </div>
                      <span className="sett_provider_status_msg">{option.description}</span>
                    </button>
                  ))}
                </div>
                <label className="sett_stt_model_row">
                  <span>
                    <strong>Transcription model</strong>
                    <small>{sttSettings.provider === "openai"
                      ? "Audio is securely sent through your backend OpenAI connection."
                      : sttSettings.provider === "local-whisper"
                        ? "Audio is sent only to the local Whisper service on this device."
                        : "Managed by your browser and operating system."}</small>
                  </span>
                  <select value={sttSettings.model} onChange={(event) => handleSttModel(event.target.value)}>
                    {STT_PROVIDER_OPTIONS.find((option) => option.id === sttSettings.provider)?.models.map((item) => (
                      <option key={item.id} value={item.id}>{item.label}</option>
                    ))}
                  </select>
                </label>
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
                      {opt.id === TTS_PROVIDERS.KOKORO && (
                        <div className="sett_provider_inline_picker" onClick={(e) => e.stopPropagation()}>
                          <span className="sett_provider_inline_picker_label">Voice</span>
                          <select
                            className="sett_provider_inline_select"
                            value={selectedKokoroVoice || ""}
                            onChange={(e) => handleKokoroVoice(e.target.value)}
                          >
                            {KOKORO_VOICE_OPTIONS.map((voice) => (
                              <option key={voice.id} value={voice.id}>
                                {voice.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                      {opt.id === TTS_PROVIDERS.SUPERTONIC && (
                        <div className="sett_provider_inline_picker" onClick={(e) => e.stopPropagation()}>
                          <span className="sett_provider_inline_picker_label">Voice</span>
                          <select
                            className="sett_provider_inline_select"
                            value={selectedSupertonicVoice || ""}
                            onChange={(e) => handleSupertonicVoice(e.target.value)}
                          >
                            {SUPERTONIC_VOICE_OPTIONS.map((voice) => (
                              <option key={voice.id} value={voice.id}>
                                {voice.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
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

              <div className="sett_usage_card">
                <div className="sett_usage_card_header">
                  <span className="sett_usage_card_title">Local 3D Posture</span>
                </div>
                <p className="sett_section_desc" style={{ margin: "0 0 0.6rem" }}>
                  Tune the default resting pose for the Local 3D avatar. Save to keep the changes, or ignore to restore the last saved pose.
                </p>
                <div className="sett_avatar_pose_grid">
                  {AVATAR_POSE_CONTROLS.map((control) => (
                    <label className="sett_avatar_pose_row" key={control.key}>
                      <span className="sett_avatar_pose_label">{control.label}</span>
                      <input
                        type="range"
                        min={control.min}
                        max={control.max}
                        step={control.step}
                        value={avatarPose[control.key]}
                        onChange={(e) => handleAvatarPose(control.key, e.target.value)}
                      />
                      <span className="sett_avatar_pose_value">{avatarPose[control.key].toFixed(2)}</span>
                    </label>
                  ))}
                </div>
                {avatarPoseDirty && (
                  <div className="sett_avatar_pose_actions">
                    <button type="button" className="sett_btn sett_btn--primary" onClick={handleSaveAvatarPose}>
                      Save
                    </button>
                    <button type="button" className="sett_btn sett_btn--ghost" onClick={handleIgnoreAvatarPose}>
                      Ignore
                    </button>
                  </div>
                )}
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

          {/* ═══ AMCTOSHS VOCABS ═══ */}
          {section === "vocabs" && (
            <div className="sett_section">
              <h2 className="sett_section_title">AMCTOSHS Vocabs</h2>
              <p className="sett_section_desc">
                Configure the three terminology layers used by AMCTOSHS: dictionary definitions, translation, and UMLS medical concept mapping.
              </p>

              <div className="sett_usage_card sett_translator_provider_card sett_translator_provider_card--first">
                <div className="sett_usage_card_header">
                  <span className="sett_usage_card_title">Translation Provider</span>
                  <span className="sett_usage_card_period">Translated terms</span>
                </div>
                {translators.map((translator) => (
                  <div className="sett_translator_provider_row" key={translator.id}>
                    <div>
                      <strong>{translator.label}</strong>
                      <small>{translator.baseUrl} · model {translator.model}</small>
                      <small>Backend environment variable: <code>{translator.envKey}</code></small>
                    </div>
                    <span className={`sett_provider_badge sett_provider_badge--${translator.configured ? "ok" : "off"}`}>
                      {translator.configured ? "Configured" : "No key"}
                    </span>
                  </div>
                ))}
                <div className="sett_translator_language_row">
                  <label htmlFor="sett_vocab_translate_lang_select">Translate vocabulary to</label>
                  <select
                    id="sett_vocab_translate_lang_select"
                    value={vocabTranslateLang}
                    onChange={(event) => {
                      setVocabTranslateLang(event.target.value);
                      localStorage.setItem("mctosh_vocab_translate_lang", event.target.value);
                    }}
                  >
                    {TRANSLATE_LANGUAGES.map((language) => <option key={language} value={language}>{language}</option>)}
                  </select>
                </div>
              </div>

              <div className="sett_usage_card sett_translator_provider_card">
                <div className="sett_usage_card_header">
                  <span className="sett_usage_card_title">Phonetic Provider</span>
                  <span className="sett_usage_card_period">IPA and pronunciation audio</span>
                </div>
                {phoneticProviders.map((phoneticProvider) => (
                  <div className="sett_translator_provider_row" key={phoneticProvider.id}>
                    <div>
                      <strong>{phoneticProvider.label}</strong>
                      <small>{phoneticProvider.baseUrl}/&lt;word&gt;</small>
                      <small>{(phoneticProvider.capabilities || []).join(" · ")} · No API key required</small>
                    </div>
                    <span className="sett_provider_badge sett_provider_badge--ok">Available</span>
                  </div>
                ))}
              </div>

              <div className="sett_usage_card sett_translators_card">
                <div className="sett_usage_card_header">
                  <span className="sett_usage_card_title">Dictionary Providers</span>
                  <span className="sett_usage_card_period">Definitions and usage</span>
                </div>
                <p className="sett_section_desc" style={{ margin: "0 0 0.8rem" }}>
                  The Dictionary tool checks Merriam-Webster Medical first, then the Collegiate Dictionary, with AI as the final fallback when configured.
                </p>
                <div className="sett_translator_grid">
                  <div className="sett_provider_card sett_translator_card sett_provider_card--active">
                    <div className="sett_provider_top">
                      <span className="sett_provider_name">Merriam-Webster Medical Dictionary</span>
                      <span className="sett_provider_badge">Primary</span>
                    </div>
                    <span className="sett_provider_base">{MEDICAL_DICTIONARY_API_URL}/&lt;term&gt;</span>
                    <span className="sett_provider_status_msg">Medical definitions, pronunciations, parts of speech, and spelling suggestions. Requires <code>MERRIAM_WEBSTER_MEDICAL_API_KEY</code> on the backend.</span>
                    <span className="sett_provider_active_tag">Medical</span>
                  </div>
                  <div className="sett_provider_card sett_translator_card sett_provider_card--active">
                    <div className="sett_provider_top">
                      <span className="sett_provider_name">Merriam-Webster's Collegiate Dictionary</span>
                      <span className="sett_provider_badge">Fallback</span>
                    </div>
                    <span className="sett_provider_base">{OTHER_DICTIONARY_API_URL}/&lt;term&gt;</span>
                    <span className="sett_provider_status_msg">General definitions, pronunciations, parts of speech, and spelling suggestions. Requires <code>MERRIAM_WEBSTER_COLLEGIATE_API_KEY</code> on the backend.</span>
                    <span className="sett_provider_active_tag">General</span>
                  </div>
                  <div className="sett_provider_card sett_translator_card sett_provider_card--active sett_vocab_ai_fallback_card">
                    <div className="sett_provider_top">
                      <span className="sett_provider_name">AI Dictionary</span>
                      <span className="sett_provider_badge">Final fallback</span>
                    </div>
                    <select
                      className="sett_provider_model_select"
                      value={defProvider}
                      onChange={e => handleProvider(e.target.value)}
                      aria-label="Default AI fallback provider"
                    >
                      {providers.map(p => (
                        <option key={p.id} value={p.id}>{p.label}</option>
                      ))}
                    </select>
                    <span className="sett_provider_status_msg">Used only when the configured Merriam-Webster dictionaries cannot return a definition.</span>
                    <span className="sett_provider_active_tag">{providers.find((provider) => provider.id === defProvider)?.label || "AI"}</span>
                  </div>
                </div>
              </div>

              <div className="sett_usage_card sett_translator_provider_card">
                <div className="sett_usage_card_header">
                  <span className="sett_usage_card_title">UMLS</span>
                  <span className="sett_usage_card_period">Medical terminology and concepts</span>
                </div>
                <div className="sett_translator_provider_row">
                  <div>
                    <strong>Unified Medical Language System</strong>
                    <small>Concepts, CUIs, synonyms, semantic types, relationships, and source vocabulary codes.</small>
                    <small>Backend environment variable: <code>UMLS_API_KEY</code></small>
                  </div>
                  <span className="sett_provider_badge sett_provider_badge--off">Backend integration</span>
                </div>
                <p className="sett_section_desc" style={{ margin: "0.7rem 0 0" }}>
                  UMLS is the terminology layer for AMCTOSHS Vocabs. Add your UTS API key to <code>back/.env</code>; it should be called through the backend, never directly from the browser.
                </p>
                <div className="sett_translator_language_row">
                  <label htmlFor="sett_umls_language_select">UMLS result language</label>
                  <select
                    id="sett_umls_language_select"
                    value={umlsLanguage}
                    onChange={(event) => setUmlsLanguage(writeUmlsLanguage(event.target.value))}
                  >
                    {UMLS_LANGUAGE_OPTIONS.map(({ code, label }) => (
                      <option key={code} value={code}>{label} ({code})</option>
                    ))}
                  </select>
                </div>
              </div>
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

          {/* ═══ CORPUS ═══ */}
          {section === "prediction" && (
            <div className="sett_section">
              <div className="sett_corpus_title_row">
                <h2 className="sett_section_title">Corpus</h2>
                <div className="sett_corpus_title_actions">
                  <button
                    type="button"
                    className="sett_corpus_settings_btn"
                    onClick={handleRefreshCorpus}
                    disabled={corpusLoading}
                    aria-label="Refresh corpus"
                    title="Refresh corpus"
                  >
                    <i className="fi fi-rr-refresh" />
                  </button>
                  <button
                    type="button"
                    className="sett_corpus_settings_btn"
                    onClick={() => setCorpusSettingsOpen((open) => !open)}
                    aria-label="Corpus settings"
                    title="Corpus settings"
                  >
                    <i className="fi fi-rr-settings" />
                  </button>
                </div>
              </div>
              {corpusSettingsOpen && (
                <div className="sett_corpus_settings_menu" role="group" aria-label="Corpus datatype settings">
                  <div className="sett_corpus_settings_menu_title">Datatypes included in prediction text</div>
                  {Object.keys(corpusDataTypes).map((dataType) => (
                    <label className="sett_corpus_datatype_option" key={dataType}>
                      <input
                        type="checkbox"
                        checked={corpusDataTypes[dataType]}
                        onChange={(event) => setCorpusDataTypes((current) => ({ ...current, [dataType]: event.target.checked }))}
                      />
                      <span>{dataType}</span>
                    </label>
                  ))}
                </div>
              )}
              <p className="sett_section_desc">
                Corpus is assembled from the text that AMCTOSHS can access. Every word is normalized, counted across
                all four inputs, and listed alphabetically.
              </p>

              <button
                type="button"
                className={`sett_prediction_pill${predictionEnabled ? " sett_prediction_pill--on" : ""}`}
                role="switch"
                aria-checked={predictionEnabled}
                onClick={() => handlePredictionToggle(!predictionEnabled)}
                disabled={predictLoading || predictBusyKey === "all"}
              >
                <span className="sett_prediction_pill_track"><span /></span>
                <span>{predictBusyKey === "all" ? "Updating prediction text…" : predictionEnabled ? "Prediction text: On" : "Prediction text: Off"}</span>
              </button>

              {corpusError && <p className="sett_section_desc sett_corpus_error">⚠ {corpusError}</p>}

              {corpusLoading && (
                <div className="sett_corpus_progress_block" aria-live="polite">
                  <div className="sett_corpus_progress_header">
                    <span>Building corpus…</span>
                    <strong>{corpusProgress}%</strong>
                  </div>
                  <div className="sett_corpus_progress_track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={corpusProgress}>
                    <div className="sett_corpus_progress_value" style={{ width: `${corpusProgress}%` }} />
                  </div>
                  <div className="sett_corpus_progress_note">The table updates as each stored text source finishes.</div>
                </div>
              )}

              <div className="sett_corpus_inputs" aria-label="Corpus inputs">
                <button
                  type="button"
                  className={`sett_corpus_input${selectedCorpusSource === "all" ? " sett_corpus_input--active" : ""}`}
                  onClick={() => setSelectedCorpusSource("all")}
                >
                  <span className="sett_corpus_input_index">ALL</span>
                  <span className="sett_corpus_input_label">All corpus sources</span>
                  <strong>{corpusTotalOccurrences.toLocaleString()}</strong>
                  <span className="sett_corpus_input_meta">word occurrences</span>
                </button>
                <button
                  type="button"
                  className={`sett_corpus_input${selectedCorpusSource === "unique" ? " sett_corpus_input--active" : ""}`}
                  onClick={() => setSelectedCorpusSource("unique")}
                >
                  <span className="sett_corpus_input_index">DEDUP</span>
                  <span className="sett_corpus_input_label">Deduplicated strings</span>
                  <strong>{datatypeCorpusRows.length.toLocaleString()}</strong>
                  <span className="sett_corpus_input_meta">unique strings</span>
                </button>
                {CORPUS_INPUTS.map(({ id, label }, index) => (
                  <button
                    type="button"
                    className={`sett_corpus_input${selectedCorpusSource === String(index + 1).padStart(2, "0") ? " sett_corpus_input--active" : ""}`}
                    key={id}
                    onClick={() => setSelectedCorpusSource(String(index + 1).padStart(2, "0"))}
                  >
                    <span className="sett_corpus_input_index">{String(index + 1).padStart(2, "0")}</span>
                    <span className="sett_corpus_input_label">{label}</span>
                    <strong>{corpusInputCounts[id].toLocaleString()}</strong>
                    <span className="sett_corpus_input_meta">{corpusLoading ? "live word occurrences" : "word occurrences"}</span>
                  </button>
                ))}
              </div>

              <div className="sett_corpus_table_wrap">
                <table className="sett_corpus_table">
                  <thead><tr><th>Source</th><th>Corpus ID</th><th>String</th><th>Occurrence</th><th>Data type</th></tr></thead>
                  <tbody>
                    {visibleCorpusRows.length > 0 ? visibleCorpusRows.map((row) => (
                      <tr key={row.id}><td><code>{row.sources}</code></td><td><code>{row.id}</code></td><td>{row.string}</td><td>{row.occurrence.toLocaleString()}</td><td>{row.dataType}</td></tr>
                    )) : <tr><td colSpan="5" className="sett_corpus_empty">{corpusLoading ? "Waiting for the first source…" : "No words found in the available inputs."}</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ═══ CONTEXT ═══ */}
          {section === "context" && <ContextSettingsTab />}

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

          {section === "camera" && canSeeCameraTab && (
            <div className="sett_section">
              <h2 className="sett_section_title">3D Camera</h2>
              <p className="sett_section_desc">Tune the Home page pyramid's camera shot per level. Pick a level, drag/pinch the 3D view to the shot you want, then save it — this copies the shot to your clipboard as code to paste into ThreadPyramidLogo.jsx and commit. Nothing here ships to other visitors on its own.</p>
              <CameraPresetTab />
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
