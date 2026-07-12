import React, { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiUrl } from "../config/api";
import {
  readStoredPatientSession,
  logoutStoredPatientSession,
  clearStoredPatientSession,
} from "../utils/patientSessionCleanup";
import TalkingHead, {
  AVATAR_TRANSFORM_STORAGE_KEY,
  DEFAULT_AVATAR_TRANSFORM,
  readStoredAvatarTransform,
} from "./TalkingHead";
import "./patientApp.css";

const AVATAR_SLIDERS = [
  { key: "moveX", label: "Move X", min: -3, max: 3, step: 0.01 },
  { key: "moveY", label: "Move Y", min: -3, max: 3, step: 0.01 },
  { key: "rotateX", label: "Tilt", min: -0.5, max: 0.5, step: 0.01 },
  { key: "rotateY", label: "Turn", min: -3.14, max: 3.14, step: 0.01 },
  { key: "zoom", label: "Zoom", min: 0.72, max: 1.7, step: 0.01 },
];

const authHeaders = () => {
  const token = readStoredPatientSession()?.token || "";
  return token ? { Authorization: `Bearer ${token}` } : {};
};

// What back/agent/patientCallAgent.js actually runs — read-only here,
// unlike the clinician-side AI Providers setting, since none of this is
// configurable per patient; every call uses this same fixed pipeline.
const AI_PIPELINE = [
  { stage: "Speech-to-Text", model: "gpt-4o-transcribe" },
  { stage: "Conversation (English)", model: "gpt-4o-mini" },
  { stage: "Conversation (Arabic)", model: "gpt-4o" },
  { stage: "Text-to-Speech", model: "gpt-4o-mini-tts" },
  { stage: "Voice activity detection", model: "Silero VAD (LiveKit inference)" },
  { stage: "Turn/end-of-speech detection", model: "LiveKit semantic turn detector" },
  { stage: "Post-call summary", model: "gpt-4o-mini" },
];

const PatientSettingsPage = ({ onLogout }) => {
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [showAiInfo, setShowAiInfo] = useState(false);
  const [showAvatarSettings, setShowAvatarSettings] = useState(false);
  const [previewAvatar, setPreviewAvatar] = useState("female");
  const [avatarTransform, setAvatarTransform] = useState(
    () => readStoredAvatarTransform() || DEFAULT_AVATAR_TRANSFORM
  );
  // Never actually plays anything — TalkingHead only uses this to drive its
  // mouth from live call audio, which doesn't apply to a static Settings
  // preview; a ref with nothing attached makes it skip that quietly.
  const previewAudioRef = useRef(null);

  const updateAvatarTransform = (key, value) => {
    setAvatarTransform((prev) => {
      const next = { ...prev, [key]: value };
      localStorage.setItem(AVATAR_TRANSFORM_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const resetAvatarTransform = () => {
    localStorage.removeItem(AVATAR_TRANSFORM_STORAGE_KEY);
    setAvatarTransform(DEFAULT_AVATAR_TRANSFORM);
  };

  const handleLogout = async () => {
    await logoutStoredPatientSession();
    onLogout();
    navigate("/patient/login");
  };

  // Backend only deactivates login (deletes the PatientAccount) — the
  // patient's Patient record and call history are deliberately kept for
  // clinician continuity (see PatientAuthAPI.js's DELETE /account).
  const handleDeleteAccount = async () => {
    if (!window.confirm(
      "Delete your MCTOSHS account? You won't be able to log in with this email again. This cannot be undone."
    )) return;

    setError("");
    setDeleting(true);
    try {
      const res = await fetch(apiUrl("/api/patient-auth/account"), {
        method: "DELETE",
        headers: authHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error?.message || "Could not delete your account.");
        return;
      }
      clearStoredPatientSession();
      onLogout();
      navigate("/patient/login");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="pa_page">
      <div className="pa_card">
        <h1 className="pa_title">Settings</h1>
        <p className="pa_subtitle">Manage your MCTOSHS account.</p>

        <div className="pa_settings_list">
          <button
            type="button"
            className="pa_settings_item"
            onClick={() => setShowAiInfo((v) => !v)}
            aria-expanded={showAiInfo}
          >
            <i className="fi fi-rr-microchip-ai" />
            AI Provider
            <i className={`fi ${showAiInfo ? "fi-rr-angle-small-up" : "fi-rr-angle-small-down"} pa_settings_item_chevron`} />
          </button>
          {showAiInfo && (
            <div className="pa_ai_info_panel">
              {AI_PIPELINE.map((row) => (
                <div className="pa_ai_info_row" key={row.stage}>
                  <span className="pa_ai_info_stage">{row.stage}</span>
                  <span className="pa_ai_info_model">{row.model}</span>
                </div>
              ))}
            </div>
          )}

          <button
            type="button"
            className="pa_settings_item"
            onClick={() => setShowAvatarSettings((v) => !v)}
            aria-expanded={showAvatarSettings}
          >
            <i className="fi fi-rr-camera-viewfinder" />
            Avatar Position
            <i className={`fi ${showAvatarSettings ? "fi-rr-angle-small-up" : "fi-rr-angle-small-down"} pa_settings_item_chevron`} />
          </button>
          {showAvatarSettings && (
            <div className="pa_avatar_settings_panel">
              <div className="pa_avatar_preview">
                <TalkingHead
                  audioElement={previewAudioRef}
                  active={false}
                  agentState=""
                  avatar={previewAvatar}
                  transform={avatarTransform}
                />
              </div>

              <div className="pa_avatar_toggle" role="radiogroup" aria-label="Preview avatar">
                <button
                  type="button"
                  className={`pa_avatar_toggle_btn ${previewAvatar === "female" ? "pa_avatar_toggle_btn--active" : ""}`}
                  onClick={() => setPreviewAvatar("female")}
                >
                  Female
                </button>
                <button
                  type="button"
                  className={`pa_avatar_toggle_btn ${previewAvatar === "male" ? "pa_avatar_toggle_btn--active" : ""}`}
                  onClick={() => setPreviewAvatar("male")}
                >
                  Male
                </button>
              </div>

              {AVATAR_SLIDERS.map((s) => (
                <label className="pa_avatar_slider_row" key={s.key}>
                  <span className="pa_avatar_slider_label">{s.label}</span>
                  <input
                    type="range"
                    min={s.min}
                    max={s.max}
                    step={s.step}
                    value={avatarTransform[s.key]}
                    onChange={(e) => updateAvatarTransform(s.key, parseFloat(e.target.value))}
                  />
                  <span className="pa_avatar_slider_value">{avatarTransform[s.key].toFixed(2)}</span>
                </label>
              ))}

              <button type="button" className="pa_avatar_reset_btn" onClick={resetAvatarTransform}>
                Reset to default
              </button>
            </div>
          )}

          <button type="button" className="pa_settings_item" onClick={handleLogout}>
            <i className="fi fi-rr-sign-out-alt" />
            Log out
          </button>
          <button
            type="button"
            className="pa_settings_item pa_settings_item--danger"
            onClick={handleDeleteAccount}
            disabled={deleting}
          >
            <i className="fi fi-rr-trash" />
            {deleting ? "Deleting…" : "Delete my account"}
          </button>
        </div>

        {error && <p className="pa_error">{error}</p>}

        <p className="pa_switch">
          <button type="button" onClick={() => navigate("/patient/call")}>Back to call</button>
        </p>
      </div>
    </div>
  );
};

export default PatientSettingsPage;
