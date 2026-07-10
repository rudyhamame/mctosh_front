import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiUrl } from "../config/api";
import { writeStoredPatientSession } from "../utils/patientSessionCleanup";
import "./patientApp.css";

const PatientLoginPage = ({ onLogin }) => {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch(apiUrl("/api/patient-auth/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message || "Something went wrong.");
        return;
      }
      writeStoredPatientSession(data);
      onLogin(data);
      navigate("/patient/call");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="pa_page">
      <div className="pa_card">
        <h1 className="pa_title">MCTOSHS</h1>
        <p className="pa_subtitle">Sign in to talk with your care team.</p>
        <form onSubmit={handleSubmit}>
          <div className="pa_field">
            <label>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
          </div>
          <div className="pa_field">
            <label>Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required />
          </div>
          {error && <p className="pa_error">{error}</p>}
          <button className="pa_submit_btn" type="submit" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="pa_switch">
          New here? <button type="button" onClick={() => navigate("/patient/signup")}>Create an account</button>
        </p>
        <p className="pa_switch">
          Clinician? <button type="button" onClick={() => navigate("/login")}>Sign in here</button>
        </p>
      </div>
    </div>
  );
};

export default PatientLoginPage;
