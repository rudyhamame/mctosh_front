import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { readStoredSession } from "../utils/sessionCleanup";
import { apiUrl } from "../config/api";
import "./voiceProfilePage.css";

const authHeader = () => {
  const token = readStoredSession()?.token || "";
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const CONSENT_STATEMENT =
  "I confirm this is my own voice, or I have explicit permission from the " +
  "person whose voice this is to create and use an AI clone of it.";

const LANGUAGES = [
  { id: "en", label: "English" },
  { id: "ar", label: "Arabic" },
];

const MAX_RECORDING_MS = 60 * 1000; // a reference sample only needs a few seconds; caps accidental long recordings

const formatDate = (iso) => (iso ? new Date(iso).toLocaleString() : "");

const VoiceProfilePage = () => {
  const navigate = useNavigate();
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Upload/record form state — shared by both "create" and "replace sample"
  // flows (replaceTargetId set = replacing an existing profile's sample).
  const [name, setName] = useState("My Voice");
  const [language, setLanguage] = useState("en");
  const [consentChecked, setConsentChecked] = useState(false);
  const [pendingBlob, setPendingBlob] = useState(null); // { blob, url } from either recording or file pick
  const [replaceTargetId, setReplaceTargetId] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const [recording, setRecording] = useState(false);
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const recordingStreamRef = useRef(null);
  const recordingTimeoutRef = useRef(null);

  const [previewingId, setPreviewingId] = useState(null);
  const previewAudioRef = useRef(null);
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState("");

  const fileInputRef = useRef(null);

  const loadProfiles = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(apiUrl("/api/voice-clone/profile"), { headers: authHeader() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to load voice profiles.");
      setProfiles(data.profiles || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadProfiles(); }, [loadProfiles]);

  useEffect(() => () => {
    // Unmount cleanup — stop any live mic stream/recorder and revoke the
    // pending-sample object URL so nothing keeps recording or leaks memory
    // after the user navigates away mid-flow.
    recordingStreamRef.current?.getTracks().forEach((t) => t.stop());
    if (recordingTimeoutRef.current) clearTimeout(recordingTimeoutRef.current);
    if (pendingBlob?.url) URL.revokeObjectURL(pendingBlob.url);
  }, [pendingBlob]);

  const resetForm = () => {
    if (pendingBlob?.url) URL.revokeObjectURL(pendingBlob.url);
    setPendingBlob(null);
    setReplaceTargetId(null);
    setConsentChecked(false);
    setFormError("");
    setName("My Voice");
    setLanguage("en");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const startRecording = async () => {
    setFormError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordingStreamRef.current = stream;
      recordedChunksRef.current = [];
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunksRef.current.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        recordingStreamRef.current = null;
        const blob = new Blob(recordedChunksRef.current, { type: "audio/webm" });
        setPendingBlob({ blob, url: URL.createObjectURL(blob) });
      };
      recorder.start();
      setRecording(true);
      recordingTimeoutRef.current = setTimeout(() => stopRecording(), MAX_RECORDING_MS);
    } catch (err) {
      setFormError(
        err?.name === "NotAllowedError" ? "Microphone access was denied." : (err.message || "Could not start recording.")
      );
    }
  };

  const stopRecording = () => {
    if (recordingTimeoutRef.current) { clearTimeout(recordingTimeoutRef.current); recordingTimeoutRef.current = null; }
    mediaRecorderRef.current?.stop();
    setRecording(false);
  };

  const handleFilePick = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPendingBlob({ blob: file, url: URL.createObjectURL(file), fileName: file.name });
  };

  const beginReplace = (profile) => {
    resetForm();
    setReplaceTargetId(profile.id);
    setName(profile.name);
    setLanguage(profile.language);
  };

  const handleSubmit = async () => {
    if (!pendingBlob) { setFormError("Record or upload a voice sample first."); return; }
    if (!consentChecked) { setFormError("You must confirm the consent statement below."); return; }

    setSubmitting(true);
    setFormError("");
    try {
      const form = new FormData();
      form.append("sample", pendingBlob.blob, pendingBlob.fileName || "sample.webm");
      form.append("name", name.trim() || "My Voice");
      form.append("language", language);
      form.append("consent", "true");

      const isReplace = Boolean(replaceTargetId);
      const url = isReplace
        ? apiUrl(`/api/voice-clone/profile/${replaceTargetId}/sample`)
        : apiUrl("/api/voice-clone/profile");
      const res = await fetch(url, { method: isReplace ? "PUT" : "POST", headers: authHeader(), body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to save voice profile.");

      resetForm();
      await loadProfiles();
    } catch (e) {
      setFormError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (profile) => {
    if (!window.confirm(`Delete "${profile.name}"? This removes the recording permanently.`)) return;
    try {
      const res = await fetch(apiUrl(`/api/voice-clone/profile/${profile.id}`), { method: "DELETE", headers: authHeader() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to delete voice profile.");
      setProfiles((prev) => prev.filter((p) => p.id !== profile.id));
    } catch (e) {
      setError(e.message);
    }
  };

  const handlePreview = async (profile) => {
    setPreviewingId(profile.id);
    setError("");
    try {
      const res = await fetch(apiUrl(`/api/voice-clone/profile/${profile.id}/preview`), { method: "POST", headers: authHeader() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to synthesize preview.");
      previewAudioRef.current?.pause();
      const audio = new Audio(data.audioUrl);
      previewAudioRef.current = audio;
      audio.onended = () => setPreviewingId((id) => (id === profile.id ? null : id));
      await audio.play();
    } catch (e) {
      setError(e.message);
      setPreviewingId(null);
    }
  };

  const beginRename = (profile) => { setRenamingId(profile.id); setRenameValue(profile.name); };

  const submitRename = async (profile) => {
    const trimmed = renameValue.trim();
    setRenamingId(null);
    if (!trimmed || trimmed === profile.name) return;
    try {
      const res = await fetch(apiUrl(`/api/voice-clone/profile/${profile.id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to rename voice profile.");
      setProfiles((prev) => prev.map((p) => (p.id === profile.id ? { ...p, name: data.profile.name } : p)));
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div id="voice_profile_page">
      <div id="voice_profile_header">
        <button id="voice_profile_back_btn" onClick={() => navigate("/settings?section=ai")}>←</button>
        <span id="voice_profile_header_title">Voice Profiles</span>
      </div>

      <div id="voice_profile_body">
        <p className="voice_profile_intro">
          Record or upload a short sample of your own voice to let the local 3D avatar (OpenVoiceClone) speak
          chatbot replies in your voice. Only use your own voice, or a voice you have explicit permission to clone.
        </p>

        {error && <div className="voice_profile_error_banner">{error}</div>}

        {/* ── Create / replace form ── */}
        <div className="voice_profile_form_card">
          <div className="voice_profile_form_title">
            {replaceTargetId ? "Replace sample" : "New voice profile"}
          </div>

          <div className="voice_profile_form_row">
            <label className="voice_profile_field">
              <span>Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
            </label>
            <label className="voice_profile_field">
              <span>Language</span>
              <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
              </select>
            </label>
          </div>

          <div className="voice_profile_capture_row">
            {!recording ? (
              <button type="button" className="voice_profile_btn voice_profile_btn--ghost" onClick={startRecording}>
                <i className="fi fi-rr-microphone" /> Record sample
              </button>
            ) : (
              <button type="button" className="voice_profile_btn voice_profile_btn--recording" onClick={stopRecording}>
                <i className="fi fi-rr-square" /> Stop recording…
              </button>
            )}
            <button type="button" className="voice_profile_btn voice_profile_btn--ghost" onClick={() => fileInputRef.current?.click()}>
              <i className="fi fi-rr-upload" /> Upload file
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/wav,audio/mpeg,audio/webm,audio/mp3,.wav,.mp3,.webm"
              style={{ display: "none" }}
              onChange={handleFilePick}
            />
          </div>

          {pendingBlob && (
            <div className="voice_profile_pending_sample">
              <audio controls src={pendingBlob.url} />
              <button type="button" className="voice_profile_btn voice_profile_btn--ghost" onClick={resetForm}>Discard</button>
            </div>
          )}

          <label className="voice_profile_consent_row">
            <input type="checkbox" checked={consentChecked} onChange={(e) => setConsentChecked(e.target.checked)} />
            <span>{CONSENT_STATEMENT}</span>
          </label>

          {formError && <div className="voice_profile_form_error">{formError}</div>}

          <div className="voice_profile_form_actions">
            {replaceTargetId && (
              <button type="button" className="voice_profile_btn voice_profile_btn--ghost" onClick={resetForm} disabled={submitting}>
                Cancel
              </button>
            )}
            <button
              type="button"
              className="voice_profile_btn voice_profile_btn--primary"
              onClick={handleSubmit}
              disabled={submitting || !pendingBlob || !consentChecked}
            >
              {submitting ? "Saving…" : replaceTargetId ? "Replace sample" : "Create profile"}
            </button>
          </div>
        </div>

        {/* ── Existing profiles ── */}
        <div className="voice_profile_list">
          {loading ? (
            <div className="voice_profile_loading">Loading voice profiles…</div>
          ) : profiles.length === 0 ? (
            <div className="voice_profile_empty">No voice profiles yet — create one above.</div>
          ) : (
            profiles.map((profile) => (
              <div key={profile.id} className="voice_profile_card">
                <div className="voice_profile_card_top">
                  {renamingId === profile.id ? (
                    <input
                      className="voice_profile_rename_input"
                      value={renameValue}
                      autoFocus
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={() => submitRename(profile)}
                      onKeyDown={(e) => { if (e.key === "Enter") submitRename(profile); if (e.key === "Escape") setRenamingId(null); }}
                    />
                  ) : (
                    <span className="voice_profile_card_name" onClick={() => beginRename(profile)} title="Click to rename">
                      {profile.name}
                    </span>
                  )}
                  <span className="voice_profile_card_lang">{profile.language === "ar" ? "Arabic" : "English"}</span>
                </div>
                <div className="voice_profile_card_meta">
                  {profile.hasEmbedding ? "Ready" : "Processing…"} · Created {formatDate(profile.createdAt)}
                </div>
                <div className="voice_profile_card_actions">
                  <button
                    type="button"
                    className="voice_profile_btn voice_profile_btn--ghost"
                    onClick={() => handlePreview(profile)}
                    disabled={!profile.hasEmbedding || previewingId === profile.id || profile.language !== "en"}
                    title={profile.language !== "en" ? "Preview is only available for English profiles right now" : ""}
                  >
                    {previewingId === profile.id ? "Playing…" : "Preview"}
                  </button>
                  <button type="button" className="voice_profile_btn voice_profile_btn--ghost" onClick={() => beginReplace(profile)}>
                    Replace sample
                  </button>
                  <button type="button" className="voice_profile_btn voice_profile_btn--danger" onClick={() => handleDelete(profile)}>
                    Delete
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default VoiceProfilePage;
