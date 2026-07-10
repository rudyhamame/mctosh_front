import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiUrl } from "../config/api";
import { writeStoredPatientSession } from "../utils/patientSessionCleanup";
import "./patientApp.css";

const PatientSignupPage = ({ onLogin }) => {
  const navigate = useNavigate();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // Signup succeeded but the patient hasn't confirmed they've saved their
  // code yet — session data is held here rather than persisted/navigated
  // immediately, so the code-reveal screen below is unskippable.
  const [pendingSession, setPendingSession] = useState(null);
  const [copied, setCopied] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch(apiUrl("/api/patient-auth/signup"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName, lastName, email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message || "Something went wrong.");
        return;
      }
      setPendingSession(data);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleCopyCode = () => {
    navigator.clipboard?.writeText(pendingSession.patientCode).then(() => setCopied(true)).catch(() => {});
  };

  const handleContinue = () => {
    writeStoredPatientSession(pendingSession);
    onLogin(pendingSession);
    navigate("/patient/call");
  };

  // Every call requires this exact code (see PatientCallPage.jsx) —
  // MCTOSHS's backend only ever stores it hashed, so this is the one and
  // only time it can ever be shown.
  if (pendingSession) {
    return (
      <div className="pa_page">
        <div className="pa_card">
          <h1 className="pa_title">Save your patient code</h1>
          <p className="pa_subtitle">
            You'll need this exact code every time you start a call — it's how MCTOSHS knows it's really you.
            It's shown only this once and can't be recovered later, so save it somewhere safe now.
          </p>
          <div className="pa_patient_code">{pendingSession.patientCode}</div>
          <button type="button" className="pa_submit_btn" onClick={handleCopyCode}>
            {copied ? "Copied!" : "Copy code"}
          </button>
          <button type="button" className="pa_submit_btn pa_submit_btn--secondary" onClick={handleContinue}>
            I've saved it — continue
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="pa_page">
      <div className="pa_card">
        <h1 className="pa_title">MCTOSHS</h1>
        <p className="pa_subtitle">Create your account to get started.</p>
        <form onSubmit={handleSubmit}>
          <div className="pa_field">
            <label>First name</label>
            <input value={firstName} onChange={e => setFirstName(e.target.value)} required autoFocus />
          </div>
          <div className="pa_field">
            <label>Last name</label>
            <input value={lastName} onChange={e => setLastName(e.target.value)} required />
          </div>
          <div className="pa_field">
            <label>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required />
          </div>
          <div className="pa_field">
            <label>Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} />
          </div>
          {error && <p className="pa_error">{error}</p>}
          <button className="pa_submit_btn" type="submit" disabled={loading}>
            {loading ? "Creating account…" : "Create account"}
          </button>
        </form>
        <p className="pa_switch">
          Already have an account? <button type="button" onClick={() => navigate("/patient/login")}>Sign in</button>
        </p>
        <p className="pa_switch">
          Clinician? <button type="button" onClick={() => navigate("/login")}>Sign in here</button>
        </p>
      </div>
    </div>
  );
};

export default PatientSignupPage;
