import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiUrl } from "../config/api";
import {
  readStoredPatientSession,
  logoutStoredPatientSession,
  clearStoredPatientSession,
} from "../utils/patientSessionCleanup";
import "./patientApp.css";

const authHeaders = () => {
  const token = readStoredPatientSession()?.token || "";
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const PatientSettingsPage = ({ onLogout }) => {
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

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
