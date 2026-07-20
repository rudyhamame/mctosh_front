import React, { useEffect, useRef, useState } from "react";
import "./clinicalVignetteBuilderPanel.css";
import { apiUrl } from "../config/api";
import { readStoredSession } from "../utils/sessionCleanup";

// Same domain list as NarrativeModePanel.jsx's ENTITY_DOMAINS (kept in
// sync manually — both mirror back/validation/amctoshsVignetteSchemas.js's
// ENTITY_DOMAINS), plus "Any" for an unscoped goal.
const GOAL_DOMAINS = ["Any", "Atoms", "Molecules", "Tissues", "Organs", "Organ Systems", "Humans", "Societies"];

const INTERVENTION_TYPES = [
  { key: "diagnosis", label: "Diagnosis" },
  { key: "treatment", label: "Treatment" },
  { key: "trace_collecting", label: "Trace Collecting" },
];

const authHeaders = () => {
  const session = readStoredSession();
  return session?.token ? { Authorization: `Bearer ${session.token}` } : {};
};
const jsonHeaders = () => ({ "Content-Type": "application/json", ...authHeaders() });

const PHASE_LABELS = { speaking: "Patient-as-speaking (Humans, Societies)", silent: "Patient-as-silent (Atoms → Organ Systems)" };

// Matches SmartVideoPanel.jsx's own local copy of AI_PROVIDERS
// (src/hooks/useAIProvider.js) — display labels only, not provider-
// selection state.
const PROVIDER_LABEL = {
  local: "Local (Ollama)",
  openai: "OpenAI",
  groq: "Groq",
  moonshot: "Kimi (Moonshot)",
  gemini: "Gemini",
};

const ClinicalVignetteBuilderPanel = ({ onClose, provider, providerModels }) => {
  const [goalDomain, setGoalDomain] = useState("Any");
  const [interventionType, setInterventionType] = useState("diagnosis");
  const [mode, setMode] = useState("study");
  const [constrained, setConstrained] = useState(true);

  const [activeJob, setActiveJob] = useState(null);
  const [activeVignette, setActiveVignette] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  const [savedVignettes, setSavedVignettes] = useState([]);
  const [savedOpen, setSavedOpen] = useState(false);

  const [submittedText, setSubmittedText] = useState("");
  const [submittedTraceNames, setSubmittedTraceNames] = useState("");
  const [attemptBusy, setAttemptBusy] = useState(false);

  const pollRef = useRef(null);

  const loadSaved = async () => {
    try {
      const res = await fetch(apiUrl("/api/amctoshs-vignettes"), { headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setSavedVignettes(Array.isArray(data.vignettes) ? data.vignettes : []);
    } catch {
      // best-effort
    }
  };

  useEffect(() => { loadSaved(); }, []);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const fetchVignette = async (id) => {
    const res = await fetch(apiUrl(`/api/amctoshs-vignettes/${id}`), { headers: authHeaders() });
    const data = await res.json().catch(() => ({}));
    if (res.ok) setActiveVignette(data);
    return data;
  };

  const startPolling = (jobId) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(apiUrl(`/api/amctoshs-vignettes/jobs/${jobId}`), { headers: authHeaders() });
        const job = await res.json().catch(() => ({}));
        if (!res.ok) return;
        setActiveJob(job);
        if (["completed", "partially_completed", "failed", "cancelled"].includes(job.status)) {
          clearInterval(pollRef.current);
          pollRef.current = null;
          setGenerating(false);
          if (job.resultVignetteId) {
            await fetchVignette(job.resultVignetteId);
            loadSaved();
          } else if (job.error) {
            setError(job.error);
          }
        }
      } catch {
        // keep polling — a transient network hiccup shouldn't kill the loop
      }
    }, 1500);
  };

  const generate = async () => {
    setError("");
    setActiveVignette(null);
    setSubmittedText("");
    setSubmittedTraceNames("");
    setGenerating(true);
    try {
      const res = await fetch(apiUrl("/api/amctoshs-vignettes/jobs"), {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ goalDomain, interventionType, mode, constrained, provider }),
      });
      const job = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(job.error || "Failed to start generation.");
        setGenerating(false);
        return;
      }
      setActiveJob(job);
      startPolling(job.id);
    } catch {
      setError("Failed to start generation — check your connection.");
      setGenerating(false);
    }
  };

  const cancelJob = async () => {
    if (!activeJob) return;
    try {
      await fetch(apiUrl(`/api/amctoshs-vignettes/jobs/${activeJob.id}/cancel`), { method: "POST", headers: authHeaders() });
    } catch {
      // best-effort
    }
  };

  const submitAttempt = async () => {
    if (!activeVignette) return;
    setAttemptBusy(true);
    setError("");
    try {
      const body = interventionType === "trace_collecting"
        ? { interventionType, submittedTraceNames: submittedTraceNames.split(",").map((t) => t.trim()).filter(Boolean) }
        : { interventionType, submittedText };
      const res = await fetch(apiUrl(`/api/amctoshs-vignettes/${activeVignette.id}/attempt`), {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Failed to grade that attempt.");
        return;
      }
      setActiveVignette(data);
    } catch {
      setError("Failed to grade that attempt — check your connection.");
    } finally {
      setAttemptBusy(false);
    }
  };

  const reveal = async () => {
    if (!activeVignette) return;
    try {
      const res = await fetch(apiUrl(`/api/amctoshs-vignettes/${activeVignette.id}/reveal`), { method: "POST", headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setActiveVignette(data);
    } catch {
      // best-effort
    }
  };

  const deleteVignette = async (id) => {
    try {
      const res = await fetch(apiUrl(`/api/amctoshs-vignettes/${id}`), { method: "DELETE", headers: authHeaders() });
      if (res.ok) {
        setSavedVignettes((prev) => prev.filter((v) => v.id !== id));
        if (activeVignette?.id === id) setActiveVignette(null);
      }
    } catch {
      // best-effort
    }
  };

  const speakingInstances = (activeVignette?.instances || []).filter((i) => i.phase === "speaking");
  const silentInstances = (activeVignette?.instances || []).filter((i) => i.phase === "silent");
  const isExamHidden = activeVignette?.mode === "exam" && !activeVignette?.revealed;

  return (
    <div id="cvb_panel" onMouseDown={(event) => event.stopPropagation()}>
      <div id="cvb_header">
        <span id="cvb_header_title"><i className="bx bx-user-plus" /> Clinical Vignette Generator</span>
        <button type="button" id="cvb_close" onClick={onClose} title="Close">✕</button>
      </div>

      <div id="cvb_body">
        <div className="cvb_notice">
          <i className="bx bx-info-circle" />
          Generates a clinical vignette by instantiating AMCTOSHS domains — Humans/Societies speak first, the rest stay silent underneath.
        </div>

        <label className="cvb_label" htmlFor="cvb_goal_domain">AMCTOSHS Domain of Goal</label>
        <select id="cvb_goal_domain" value={goalDomain} onChange={(event) => setGoalDomain(event.target.value)}>
          {GOAL_DOMAINS.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>

        <label className="cvb_label" htmlFor="cvb_intervention">Intervention Type of Goal</label>
        <select id="cvb_intervention" value={interventionType} onChange={(event) => setInterventionType(event.target.value)}>
          {INTERVENTION_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>

        <div className="cvb_toggle_row">
          <label className="cvb_toggle">
            <input type="checkbox" checked={constrained} onChange={(event) => setConstrained(event.target.checked)} />
            Constrain to already-built Entity Schemas
          </label>
        </div>
        <p className="entity_builder_helper cvb_helper">
          {constrained ? "Only reuses schemas/traces/values already built in the Entities Builder." : "The model may invent new schemas/traces/values not yet built."}
        </p>

        <div className="cvb_toggle_row">
          <label className="cvb_toggle">
            <input type="radio" name="cvb_mode" checked={mode === "study"} onChange={() => setMode("study")} />
            Study case
          </label>
          <label className="cvb_toggle">
            <input type="radio" name="cvb_mode" checked={mode === "exam"} onChange={() => setMode("exam")} />
            Exam
          </label>
        </div>
        <p className="entity_builder_helper cvb_helper">
          {mode === "exam" ? "Silent-domain instances stay hidden until you submit an attempt or reveal them." : "Everything is shown once generated — no scoring."}
        </p>

        {error && <div className="narrative_mode_status narrative_mode_status--error"><i className="bx bx-error" /> {error}</div>}

        <div id="cvb_actions">
          <button type="button" id="cvb_generate" onClick={generate} disabled={generating}>
            {generating ? <i className="bx bx-loader-circle pdf_icon_spin" /> : <i className="bx bx-plus-medical" />}
            {generating ? "Generating..." : "Generate Clinical Vignette"}
          </button>
          {generating && activeJob && (
            <button type="button" onClick={cancelJob}><i className="bx bx-x" /> Cancel</button>
          )}
        </div>

        {activeJob && (
          <div className="cvb_phase_status">
            {(activeJob.phases || []).map((phase) => (
              <div key={phase.key} className={`cvb_phase cvb_phase--${phase.status}`}>
                <i className={phase.status === "completed" ? "bx bx-check-circle" : phase.status === "failed" ? "bx bx-error-circle" : phase.status === "running" ? "bx bx-loader-circle pdf_icon_spin" : "bx bx-circle"} />
                {PHASE_LABELS[phase.key]}
              </div>
            ))}
          </div>
        )}

        {activeVignette && (
          <>
            <div className="entity_builder_section_title">Patient-as-speaking</div>
            <pre id="cvb_narrative">{activeVignette.speakingNarrative}</pre>
            <div id="cvb_instance_list">
              {speakingInstances.map((inst, i) => (
                <div key={i} className="cvb_instance">
                  <strong>{inst.instantiationName}</strong> — {inst.entitySchemaName} / {inst.entitySchemaTraceName}: {inst.entitySchemaTraceValueEntry}
                  <span className="cvb_instance_domain">{inst.domain}</span>
                </div>
              ))}
            </div>

            <div className="entity_builder_section_title">Patient-as-silent</div>
            {isExamHidden ? (
              <div className="cvb_exam_block">
                <p className="entity_builder_helper">Hidden until you submit an attempt or reveal it.</p>

                {interventionType === "trace_collecting" ? (
                  <>
                    <label className="cvb_label" htmlFor="cvb_trace_names">Trace names you'd collect (comma-separated)</label>
                    <input id="cvb_trace_names" value={submittedTraceNames} onChange={(event) => setSubmittedTraceNames(event.target.value)} placeholder="Example: ejection fraction, troponin" />
                  </>
                ) : (
                  <>
                    <label className="cvb_label" htmlFor="cvb_submitted_text">Your {interventionType}</label>
                    <textarea id="cvb_submitted_text" value={submittedText} onChange={(event) => setSubmittedText(event.target.value)} placeholder={`Write your ${interventionType} attempt...`} />
                  </>
                )}

                <div id="cvb_actions">
                  <button type="button" onClick={submitAttempt} disabled={attemptBusy}>
                    {attemptBusy ? <i className="bx bx-loader-circle pdf_icon_spin" /> : <i className="bx bx-send" />} Submit Attempt
                  </button>
                  <button type="button" onClick={reveal}><i className="bx bx-show" /> Reveal</button>
                </div>

                {(activeVignette.attempts || []).length > 0 && (
                  <div id="cvb_attempt_history">
                    {activeVignette.attempts.map((a, i) => (
                      <div key={i} className={`cvb_attempt cvb_attempt--${a.gradedResult}`}>
                        <strong>{a.gradedResult}</strong> ({INTERVENTION_TYPES.find((t) => t.key === a.interventionType)?.label || a.interventionType})
                        <p>{a.gradedRationale}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div id="cvb_instance_list">
                {silentInstances.length === 0 && (
                  <p className="entity_builder_helper">No silent-domain instances yet.</p>
                )}
                {silentInstances.map((inst, i) => (
                  <div key={i} className="cvb_instance">
                    <strong>{inst.instantiationName}</strong> — {inst.entitySchemaName} / {inst.entitySchemaTraceName}: {inst.entitySchemaTraceValueEntry}
                    <span className="cvb_instance_domain">{inst.domain}</span>
                  </div>
                ))}
                {activeVignette.mode === "exam" && activeVignette.examKey && (
                  <div className="cvb_exam_key">
                    <div><strong>Intended diagnosis:</strong> {activeVignette.examKey.intendedDiagnosis}</div>
                    <div><strong>Intended treatment:</strong> {activeVignette.examKey.intendedTreatment}</div>
                    <div><strong>Expected traces:</strong> {(activeVignette.examKey.expectedTraceNames || []).join(", ")}</div>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        <button type="button" id="cvb_saved_toggle" onClick={() => setSavedOpen((v) => !v)}>
          <i className={savedOpen ? "bx bx-chevron-down" : "bx bx-chevron-right"} /> Saved Clinical Vignettes ({savedVignettes.length})
        </button>
        {savedOpen && (
          <div id="cvb_saved_list">
            {savedVignettes.length === 0 && <p className="entity_builder_helper">No saved clinical vignettes yet.</p>}
            {savedVignettes.map((v) => (
              <div key={v.id} className="cvb_saved_item">
                <button type="button" className="cvb_saved_open" onClick={() => fetchVignette(v.id)}>
                  {v.goal?.domain || "Any"} — {INTERVENTION_TYPES.find((t) => t.key === v.goal?.interventionType)?.label || v.goal?.interventionType} ({v.mode})
                </button>
                <button type="button" onClick={() => deleteVignette(v.id)} title="Delete"><i className="bx bx-trash" /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pinned outside the scrollable body — same convention as
          SmartVideoPanel.jsx's own footer. Model name: prefer the
          resolved job/vignette's own modelName (the ACTUAL model a
          completed request resolved to, which can differ from the
          selected provider's default if it fell back) — before that
          exists yet, fall back to providerModels[provider] (from
          GET /api/settings/ai-status, the same source Settings' own AI
          Providers section and SmartVideoPanel's footer both read). */}
      <div id="cvb_footer">
        <i className="bx bx-chip" />
        You are using: {PROVIDER_LABEL[provider] || provider}
        {(activeVignette?.modelName || activeJob?.modelName || providerModels?.[provider]) && (
          <span id="cvb_footer_model"> · {activeVignette?.modelName || activeJob?.modelName || providerModels[provider]}</span>
        )}
      </div>
    </div>
  );
};

export default ClinicalVignetteBuilderPanel;
