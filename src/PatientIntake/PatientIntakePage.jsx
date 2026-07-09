import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiUrl } from "../config/api";
import { readStoredSession } from "../utils/sessionCleanup";
import "./patientIntakePage.css";

const authHeaders = (json = true) => {
  const token = readStoredSession()?.token || "";
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  if (json) headers["Content-Type"] = "application/json";
  return headers;
};

const EMPTY_PERSONAL = {
  firstName: "", lastName: "", dateOfBirth: "", gender: "",
  nationality: "", phoneCode: "", phoneNumber: "", email: "",
  street: "", city: "", state: "", postalCode: "", country: "",
};

const EMPTY_CLINICAL = {
  chiefComplaint: "", historyOfPresentIllness: "", pastMedicalHistory: "",
  familyHistory: "", socialHistory: "", bloodType: "", allergies: "",
  chronicConditions: "", currentMedications: "",
  vitalSigns: { height: "", weight: "", bloodPressure: "", heartRate: "", temperature: "", oxygenSaturation: "" },
};

const PERSONAL_FIELDS = [
  ["firstName", "First name"], ["lastName", "Last name"], ["dateOfBirth", "Date of birth"],
  ["gender", "Gender"], ["phoneNumber", "Phone number"], ["email", "Email"],
];
const CLINICAL_FIELDS = [
  ["chiefComplaint", "Chief complaint", true], ["historyOfPresentIllness", "History of present illness", true],
  ["pastMedicalHistory", "Past medical history", true], ["familyHistory", "Family history", true],
  ["socialHistory", "Social history", true], ["allergies", "Allergies"],
  ["chronicConditions", "Chronic conditions", true], ["currentMedications", "Current medications", true],
];

const Field = ({ label, value, onChange, textarea }) => (
  <div className="pin_field">
    <label className="pin_field_label">{label}</label>
    {textarea
      ? <textarea className="pin_field_input pin_field_textarea" value={value} onChange={e => onChange(e.target.value)} rows={2} />
      : <input className="pin_field_input" value={value} onChange={e => onChange(e.target.value)} />
    }
  </div>
);

const PatientIntakePage = () => {
  const navigate = useNavigate();

  const [config, setConfig] = useState(null);
  const [webhooks, setWebhooks] = useState({ eventsUrl: "", recordAnswerToolUrl: "", finishIntakeToolUrl: "" });
  const [isConfigured, setIsConfigured] = useState(false);
  const [form, setForm] = useState({
    telnyxPublicKey: "", phoneNumberDisplay: "",
    displayName: "", webhookToolSharedSecret: "", telnyxApiKey: "",
  });
  const [savingConfig, setSavingConfig] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [generatingSecret, setGeneratingSecret] = useState(false);

  const [calls, setCalls] = useState([]);
  const [callsFilter, setCallsFilter] = useState("pending");
  const [selectedCallId, setSelectedCallId] = useState("");
  const [selectedCall, setSelectedCall] = useState(null);
  const [draftPersonal, setDraftPersonal] = useState(EMPTY_PERSONAL);
  const [draftClinical, setDraftClinical] = useState(EMPTY_CLINICAL);
  const [reviewBusy, setReviewBusy] = useState(false);

  const loadConfig = async () => {
    try {
      const res = await fetch(apiUrl("/api/patient-intake/config"), { headers: authHeaders(false) });
      const data = await res.json();
      if (!res.ok) return;
      setConfig(data.config);
      setWebhooks(data.webhooks || { eventsUrl: "", recordAnswerToolUrl: "", finishIntakeToolUrl: "" });
      setIsConfigured(Boolean(data.isConfigured));
      setForm(f => ({
        ...f,
        telnyxPublicKey: data.config?.telnyxPublicKey || "",
        phoneNumberDisplay: data.config?.phoneNumberDisplay || "",
        displayName: data.config?.displayName || "",
      }));
    } finally {
      setConfigLoaded(true);
    }
  };

  const loadCalls = async (filter) => {
    const qs = filter ? `?approvalStatus=${filter}` : "";
    const res = await fetch(apiUrl(`/api/patient-intake/calls${qs}`), { headers: authHeaders(false) });
    const data = await res.json();
    if (res.ok) setCalls(data.calls || []);
  };

  useEffect(() => { loadConfig(); }, []);
  useEffect(() => { loadCalls(callsFilter); }, [callsFilter]);

  const saveConfig = async () => {
    setSavingConfig(true);
    try {
      const body = {
        telnyxPublicKey: form.telnyxPublicKey,
        phoneNumberDisplay: form.phoneNumberDisplay,
        displayName: form.displayName,
      };
      if (form.webhookToolSharedSecret) body.webhookToolSharedSecret = form.webhookToolSharedSecret;
      if (form.telnyxApiKey) body.telnyxApiKey = form.telnyxApiKey;

      const res = await fetch(apiUrl("/api/patient-intake/config"), {
        method: "PATCH", headers: authHeaders(true), body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        setConfig(data.config);
        setWebhooks(data.webhooks || { eventsUrl: "", recordAnswerToolUrl: "", finishIntakeToolUrl: "" });
        setIsConfigured(Boolean(data.isConfigured));
        setForm(f => ({ ...f, webhookToolSharedSecret: "", telnyxApiKey: "" }));
      }
    } finally {
      setSavingConfig(false);
    }
  };

  const generateSecret = async () => {
    setGeneratingSecret(true);
    try {
      const res = await fetch(apiUrl("/api/patient-intake/config/generate-secret"), {
        method: "POST", headers: authHeaders(false),
      });
      const data = await res.json();
      if (res.ok && data.secret) setForm(f => ({ ...f, webhookToolSharedSecret: data.secret }));
    } finally {
      setGeneratingSecret(false);
    }
  };

  const openCall = async (id) => {
    setSelectedCallId(id);
    const res = await fetch(apiUrl(`/api/patient-intake/calls/${id}`), { headers: authHeaders(false) });
    const data = await res.json();
    if (!res.ok) return;
    setSelectedCall(data.call);
    setDraftPersonal({ ...EMPTY_PERSONAL, ...(data.call?.draft?.personal || {}) });
    setDraftClinical({ ...EMPTY_CLINICAL, ...(data.call?.draft?.clinical || {}) });
  };

  const approveCall = async () => {
    if (!selectedCallId) return;
    setReviewBusy(true);
    try {
      const res = await fetch(apiUrl(`/api/patient-intake/calls/${selectedCallId}/approve`), {
        method: "POST", headers: authHeaders(true),
        body: JSON.stringify({ personal: draftPersonal, clinical: draftClinical }),
      });
      if (res.ok) {
        setSelectedCallId(""); setSelectedCall(null);
        loadCalls(callsFilter);
      }
    } finally {
      setReviewBusy(false);
    }
  };

  const rejectCall = async () => {
    if (!selectedCallId) return;
    setReviewBusy(true);
    try {
      const res = await fetch(apiUrl(`/api/patient-intake/calls/${selectedCallId}/reject`), {
        method: "POST", headers: authHeaders(true),
      });
      if (res.ok) {
        setSelectedCallId(""); setSelectedCall(null);
        loadCalls(callsFilter);
      }
    } finally {
      setReviewBusy(false);
    }
  };

  return (
    <div id="pin_page">
      <header id="pin_header">
        <button className="pin_back_btn" onClick={() => navigate(-1)}>← Back</button>
        <h1>Patient Intake — WhatsApp Voice</h1>
        <span className={`pin_status_pill ${isConfigured ? "pin_status_pill--ok" : "pin_status_pill--off"}`}>
          {isConfigured ? "Configured" : "Not configured"}
        </span>
      </header>

      <section className="pin_section">
        <h2>Telnyx WhatsApp Voice Connection</h2>
        <p className="pin_section_sub">
          Set up manually in Telnyx's dashboard: create an AI Assistant, bind it directly to your WhatsApp-Calling-enabled Telnyx number,
          paste the <strong>Events webhook URL</strong> into the number/connection's Call Control webhook setting, and add two
          <strong> webhook tools</strong> to the Assistant — <code>recordAnswer</code> (params: <code>call_control_id</code>, <code>fieldKey</code>, <code>value</code>) pointed at the
          <strong> Record-answer tool URL</strong>, and <code>finishIntake</code> (param: <code>call_control_id</code>) pointed at the
          <strong> Finish-intake tool URL</strong>. Add a custom header <code>x-intake-secret</code> with the shared secret below to both tools.
        </p>
        {configLoaded && (
          <div className="pin_config_form">
            <div className="pin_field">
              <label className="pin_field_label">Events webhook URL</label>
              <input className="pin_field_input" readOnly value={webhooks.eventsUrl} onFocus={e => e.target.select()} />
            </div>
            <div className="pin_field">
              <label className="pin_field_label">Record-answer tool URL</label>
              <input className="pin_field_input" readOnly value={webhooks.recordAnswerToolUrl} onFocus={e => e.target.select()} />
            </div>
            <div className="pin_field">
              <label className="pin_field_label">Finish-intake tool URL</label>
              <input className="pin_field_input" readOnly value={webhooks.finishIntakeToolUrl} onFocus={e => e.target.select()} />
            </div>
            <Field label="Telnyx public key (Ed25519)" value={form.telnyxPublicKey} onChange={v => setForm(f => ({ ...f, telnyxPublicKey: v }))} />
            <Field label="Phone number (display)" value={form.phoneNumberDisplay} onChange={v => setForm(f => ({ ...f, phoneNumberDisplay: v }))} />
            <Field label="Display name" value={form.displayName} onChange={v => setForm(f => ({ ...f, displayName: v }))} />
            <div className="pin_field">
              <label className="pin_field_label">
                Webhook tool shared secret {config?.hasWebhookToolSharedSecret && <span className="pin_masked">({config.webhookToolSharedSecretMasked})</span>}
              </label>
              <div className="pin_secret_row">
                <input className="pin_field_input" type="password" placeholder={config?.hasWebhookToolSharedSecret ? "Leave blank to keep current" : ""}
                  value={form.webhookToolSharedSecret} onChange={e => setForm(f => ({ ...f, webhookToolSharedSecret: e.target.value }))} />
                <button type="button" className="pin_generate_btn" onClick={generateSecret} disabled={generatingSecret}>
                  {generatingSecret ? "…" : "Generate"}
                </button>
              </div>
            </div>
            <div className="pin_field">
              <label className="pin_field_label">
                Telnyx API key <span className="pin_masked">(reserved, not required yet{config?.hasTelnyxApiKey ? `, ${config.telnyxApiKeyMasked}` : ""})</span>
              </label>
              <input className="pin_field_input" type="password" placeholder={config?.hasTelnyxApiKey ? "Leave blank to keep current" : ""}
                value={form.telnyxApiKey} onChange={e => setForm(f => ({ ...f, telnyxApiKey: e.target.value }))} />
            </div>
            <button className="pin_save_btn" onClick={saveConfig} disabled={savingConfig}>
              {savingConfig ? "Saving…" : "Save configuration"}
            </button>
          </div>
        )}
      </section>

      <section className="pin_section">
        <h2>Intake Calls</h2>
        <div className="pin_filter_row">
          {["pending", "approved", "rejected", ""].map(f => (
            <button key={f || "all"} className={`pin_filter_btn ${callsFilter === f ? "pin_filter_btn--active" : ""}`}
              onClick={() => setCallsFilter(f)}>
              {f || "all"}
            </button>
          ))}
        </div>
        <div className="pin_calls_layout">
          <ul className="pin_calls_list">
            {calls.length === 0 && <li className="pin_calls_empty">No calls in this view.</li>}
            {calls.map(c => (
              <li key={c._id} className={`pin_call_item ${selectedCallId === c._id ? "pin_call_item--active" : ""}`}
                onClick={() => openCall(c._id)}>
                <span className="pin_call_from">{c.fromNumber || "Unknown number"}</span>
                <span className="pin_call_status">{c.status} · {c.approvalStatus}</span>
              </li>
            ))}
          </ul>

          {selectedCall && (
            <div className="pin_review_panel">
              <h3>Review draft</h3>
              <div className="pin_review_grid">
                {PERSONAL_FIELDS.map(([key, label]) => (
                  <Field key={key} label={label} value={draftPersonal[key] || ""}
                    onChange={v => setDraftPersonal(p => ({ ...p, [key]: v }))} />
                ))}
              </div>
              <div className="pin_review_grid">
                {CLINICAL_FIELDS.map(([key, label, textarea]) => (
                  <Field key={key} label={label} textarea={textarea} value={draftClinical[key] || ""}
                    onChange={v => setDraftClinical(c => ({ ...c, [key]: v }))} />
                ))}
              </div>

              <h4>Transcript</h4>
              <div className="pin_transcript">
                {(selectedCall.transcript || []).length === 0 && <p className="pin_transcript_empty">No transcript yet.</p>}
                {(selectedCall.transcript || []).map((t, i) => (
                  <div key={i} className={`pin_transcript_line pin_transcript_line--${t.role}`}>
                    <strong>{t.role === "bot" ? "MCTOSHS" : "Patient"}:</strong> {t.text}
                  </div>
                ))}
              </div>

              <div className="pin_review_actions">
                <button className="pin_approve_btn" onClick={approveCall} disabled={reviewBusy || selectedCall.approvalStatus === "approved"}>
                  Approve → Create Patient
                </button>
                <button className="pin_reject_btn" onClick={rejectCall} disabled={reviewBusy || selectedCall.approvalStatus === "approved"}>
                  Reject
                </button>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

export default PatientIntakePage;
