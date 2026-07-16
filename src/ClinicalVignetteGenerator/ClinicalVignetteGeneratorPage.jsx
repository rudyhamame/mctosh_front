import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./clinicalVignetteGenerator.css";
import { apiUrl } from "../config/api";
import { readStoredSession } from "../utils/sessionCleanup";
import { AI_PROVIDERS } from "../hooks/useAIProvider";

// ── Constants ─────────────────────────────────────────────────────────────────

const EXAMS = [
  { value: "USMLE_STEP_1", label: "USMLE Step 1" },
  { value: "USMLE_STEP_2_CK", label: "USMLE Step 2 CK" },
  { value: "USMLE_STEP_3", label: "USMLE Step 3" },
  { value: "NBME_SUBJECT_SHELF", label: "NBME Subject Shelf" },
];

const ORGAN_SYSTEMS = [
  { value: "cardiovascular", label: "Cardiovascular" },
  { value: "respiratory", label: "Respiratory" },
  { value: "gastrointestinal", label: "Gastrointestinal" },
  { value: "renal_urinary", label: "Renal / Urinary" },
  { value: "endocrine", label: "Endocrine" },
  { value: "reproductive", label: "Reproductive" },
  { value: "musculoskeletal", label: "Musculoskeletal" },
  { value: "neurological", label: "Neurological" },
  { value: "hematologic_lymphatic", label: "Hematologic / Lymphatic" },
  { value: "immune", label: "Immune" },
  { value: "dermatologic", label: "Dermatologic" },
  { value: "psychiatric", label: "Psychiatric / Behavioral" },
  { value: "multisystem", label: "Multisystem / General" },
];

const TOPICS_BY_SYSTEM = {
  cardiovascular: [
    "acute_coronary_syndrome", "heart_failure", "atrial_fibrillation", "hypertension",
    "valvular_heart_disease", "peripheral_artery_disease", "aortic_dissection",
    "infective_endocarditis", "deep_vein_thrombosis_pe", "cardiomyopathy",
  ],
  respiratory: [
    "asthma", "copd", "pneumonia", "pulmonary_embolism", "pneumothorax",
    "pulmonary_fibrosis", "lung_cancer", "tuberculosis", "ards", "sleep_apnea",
  ],
  gastrointestinal: [
    "gi_bleeding", "peptic_ulcer_disease", "inflammatory_bowel_disease", "acute_pancreatitis",
    "cirrhosis", "cholecystitis", "appendicitis", "bowel_obstruction", "colorectal_cancer", "gerd",
  ],
  renal_urinary: [
    "acute_kidney_injury", "chronic_kidney_disease", "nephrotic_syndrome", "nephrolithiasis",
    "urinary_tract_infection", "electrolyte_disorders", "glomerulonephritis", "benign_prostatic_hyperplasia",
  ],
  endocrine: [
    "diabetes_mellitus", "diabetic_ketoacidosis", "thyroid_disorders", "adrenal_insufficiency",
    "cushing_syndrome", "pituitary_disorders", "hypoglycemia", "osteoporosis",
  ],
  reproductive: [
    "preeclampsia_eclampsia", "ectopic_pregnancy", "normal_labor_delivery", "menopause",
    "ovarian_cysts_masses", "sexually_transmitted_infections", "contraception", "infertility",
  ],
  musculoskeletal: [
    "osteoarthritis", "rheumatoid_arthritis", "fractures_trauma", "low_back_pain",
    "gout", "septic_arthritis", "osteomyelitis", "systemic_lupus_erythematosus",
  ],
  neurological: [
    "stroke", "seizure_disorders", "headache_migraine", "meningitis", "peripheral_neuropathy",
    "multiple_sclerosis", "parkinson_disease", "traumatic_brain_injury", "dementia",
  ],
  hematologic_lymphatic: [
    "anemia", "thrombocytopenia", "coagulation_disorders", "leukemia",
    "lymphoma", "sickle_cell_disease", "transfusion_reactions",
  ],
  immune: [
    "allergic_reactions_anaphylaxis", "autoimmune_disorders", "immunodeficiency", "vasculitis", "hiv_aids",
  ],
  dermatologic: [
    "cellulitis", "psoriasis", "skin_cancer", "drug_eruptions", "atopic_dermatitis",
  ],
  psychiatric: [
    "major_depressive_disorder", "anxiety_disorders", "schizophrenia", "substance_use_disorders",
    "bipolar_disorder", "eating_disorders", "personality_disorders",
  ],
  multisystem: [
    "sepsis", "shock", "trauma_evaluation", "toxicology_overdose",
    "perioperative_management", "preventive_care_screening",
  ],
};

const MODELS_BY_PROVIDER = {
  local: ["", "llama3.2:3b", "llama3.1:8b", "qwen2.5:7b"],
  openai: ["", "gpt-4o-mini", "gpt-4o", "gpt-4.1-mini"],
  groq: ["", "meta-llama/llama-4-scout-17b-16e-instruct", "llama-3.3-70b-versatile", "moonshotai/kimi-k2-instruct"],
  moonshot: ["", "kimi-k2.5", "kimi-k1.5"],
  gemini: ["", "gemini-2.5-flash", "gemini-2.5-pro"],
};

const humanize = (value) => String(value || "")
  .split("_")
  .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
  .join(" ");

const PHYSICIAN_TASKS = [
  { value: "diagnosis", label: "Diagnosis" },
  { value: "best_next_step", label: "Best next step" },
  { value: "initial_management", label: "Initial management" },
  { value: "definitive_management", label: "Definitive management" },
  { value: "investigation", label: "Investigation" },
  { value: "prognosis", label: "Prognosis" },
  { value: "prevention", label: "Prevention" },
  { value: "ethics", label: "Ethics" },
  { value: "patient_safety", label: "Patient safety" },
];

const DIFFICULTIES = [
  { value: "easy", label: "Easy" },
  { value: "moderate", label: "Moderate" },
  { value: "hard", label: "Hard" },
];

const PATIENT_POPULATIONS = [
  { value: "adult", label: "Adult" },
  { value: "pediatric", label: "Pediatric" },
  { value: "obstetric", label: "Obstetric" },
  { value: "geriatric", label: "Geriatric" },
  { value: "mixed", label: "Mixed" },
];

const REVIEW_STATUSES = [
  { value: "pending", label: "Pending" },
  { value: "reviewed", label: "Reviewed" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

const TERMINAL_JOB_STATUSES = ["completed", "partially_completed", "failed", "cancelled"];

const labelFor = (list, value) => list.find((o) => o.value === value)?.label || value;

const DEFAULT_FORM = {
  count: 10,
  exam: "USMLE_STEP_2_CK",
  system: ORGAN_SYSTEMS[0].value,
  topic: TOPICS_BY_SYSTEM[ORGAN_SYSTEMS[0].value][0],
  physicianTask: "diagnosis",
  difficulty: "moderate",
  patientPopulation: "adult",
  optionCount: 4,
  includeExplanation: true,
  includeIncorrectExplanations: true,
  includePrerequisiteConcepts: true,
  includeEducationalObjective: true,
  provider: "groq",
  model: "",
};

const SAFETY_NOTICE =
  "AI-generated educational content. Not an official USMLE question and not verified for clinical decision-making until medically reviewed.";

// ── Helpers ───────────────────────────────────────────────────────────────────

const authHeaders = () => {
  const session = readStoredSession();
  return session?.token ? { Authorization: `Bearer ${session.token}` } : {};
};

const jsonHeaders = () => ({ "Content-Type": "application/json", ...authHeaders() });

const downloadJson = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function ClinicalVignetteGeneratorPage() {
  const navigate = useNavigate();

  // ── Generator form ────────────────────────────────────────────────────────
  const [form, setForm] = useState(DEFAULT_FORM);
  const setField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const setSystem = (system) => setForm((prev) => ({ ...prev, system, topic: TOPICS_BY_SYSTEM[system]?.[0] || "" }));
  const setProvider = (provider) => setForm((prev) => ({
    ...prev,
    provider,
    model: (MODELS_BY_PROVIDER[provider] || [""]).includes(prev.model) ? prev.model : "",
  }));

  // ── Job state ─────────────────────────────────────────────────────────────
  const [activeJob, setActiveJob] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [generateError, setGenerateError] = useState("");

  // ── Results state ─────────────────────────────────────────────────────────
  const [questions, setQuestions] = useState([]);
  const [questionsLoading, setQuestionsLoading] = useState(false);
  const [filters, setFilters] = useState({
    system: "", topic: "", difficulty: "", physicianTask: "", reviewStatus: "", jobId: "",
  });
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [revealedAnswers, setRevealedAnswers] = useState(() => new Set());
  const [revealedExplanations, setRevealedExplanations] = useState(() => new Set());
  const [jsonPreviewId, setJsonPreviewId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState(null);
  const [editError, setEditError] = useState("");

  const isJobActive = activeJob && !TERMINAL_JOB_STATUSES.includes(activeJob.status);

  // ── Data loading ──────────────────────────────────────────────────────────

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch(apiUrl("/api/clinical-vignettes/jobs"), { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      setJobs(data.jobs || []);
    } catch { /* ignore transient network errors */ }
  }, []);

  const fetchQuestions = useCallback(async () => {
    setQuestionsLoading(true);
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });
      params.set("limit", "200");
      const res = await fetch(apiUrl(`/api/clinical-vignettes?${params.toString()}`), { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      setQuestions(data.questions || []);
    } catch { /* ignore transient network errors */ } finally {
      setQuestionsLoading(false);
    }
  }, [filters]);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);
  useEffect(() => { fetchQuestions(); }, [fetchQuestions]);

  // Poll the active job until it reaches a terminal state.
  useEffect(() => {
    if (!activeJob?.id || TERMINAL_JOB_STATUSES.includes(activeJob.status)) return undefined;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(apiUrl(`/api/clinical-vignettes/jobs/${activeJob.id}`), { headers: authHeaders() });
        if (!res.ok || cancelled) return;
        const job = await res.json();
        if (cancelled) return;
        setActiveJob(job);
        setJobs((prev) => {
          const exists = prev.some((j) => j.id === job.id);
          return exists ? prev.map((j) => (j.id === job.id ? job : j)) : [job, ...prev];
        });
        if (TERMINAL_JOB_STATUSES.includes(job.status)) {
          fetchQuestions();
        }
      } catch { /* ignore transient network errors */ }
    };
    const interval = setInterval(poll, 1500);
    return () => { cancelled = true; clearInterval(interval); };
  }, [activeJob?.id, activeJob?.status, fetchQuestions]);

  // ── Generator actions ─────────────────────────────────────────────────────

  const startGeneration = async () => {
    setGenerateError("");
    try {
      const res = await fetch(apiUrl("/api/clinical-vignettes/jobs"), {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify(form),
      });
      const body = await res.json();
      if (!res.ok) {
        setGenerateError(body.details ? body.details.join("; ") : body.error || "Failed to start generation.");
        return;
      }
      setActiveJob(body);
      setJobs((prev) => [body, ...prev]);
    } catch {
      setGenerateError("Failed to reach the server.");
    }
  };

  const cancelActiveJob = async () => {
    if (!activeJob?.id) return;
    try {
      const res = await fetch(apiUrl(`/api/clinical-vignettes/jobs/${activeJob.id}/cancel`), {
        method: "POST", headers: authHeaders(),
      });
      if (res.ok) setActiveJob(await res.json());
    } catch { /* ignore */ }
  };

  const retryFailedBatches = async (jobId) => {
    try {
      const res = await fetch(apiUrl(`/api/clinical-vignettes/jobs/${jobId}/retry-failed`), {
        method: "POST", headers: authHeaders(),
      });
      if (res.ok) setActiveJob(await res.json());
    } catch { /* ignore */ }
  };

  const resetForm = () => { setForm(DEFAULT_FORM); setGenerateError(""); };

  // ── Question actions ──────────────────────────────────────────────────────

  const toggleReveal = (setFn, id) => setFn((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const toggleSelected = (id) => toggleReveal(setSelectedIds, id);

  const toggleSelectAll = () => {
    setSelectedIds((prev) => (prev.size === questions.length
      ? new Set()
      : new Set(questions.map((q) => q.id))));
  };

  const deleteQuestion = async (id) => {
    try {
      const res = await fetch(apiUrl(`/api/clinical-vignettes/${id}`), { method: "DELETE", headers: authHeaders() });
      if (res.ok) {
        setQuestions((prev) => prev.filter((q) => q.id !== id));
        setSelectedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
      }
    } catch { /* ignore */ }
  };

  const setReviewStatus = async (id, status) => {
    try {
      const res = await fetch(apiUrl(`/api/clinical-vignettes/${id}/review`), {
        method: "PATCH", headers: jsonHeaders(), body: JSON.stringify({ status }),
      });
      if (res.ok) {
        const updated = await res.json();
        setQuestions((prev) => prev.map((q) => (q.id === updated.id ? updated : q)));
      }
    } catch { /* ignore */ }
  };

  const regenerateQuestion = async (id) => {
    try {
      const res = await fetch(apiUrl(`/api/clinical-vignettes/${id}/regenerate`), { method: "POST", headers: authHeaders() });
      if (res.ok) {
        const job = await res.json();
        setActiveJob(job);
        setJobs((prev) => [job, ...prev]);
      }
    } catch { /* ignore */ }
  };

  const startEdit = (q) => {
    setEditingId(q.id);
    setEditError("");
    setEditDraft({
      question: q.question,
      narrative: q.vignette.narrative,
      options: q.options.map((o) => ({ ...o })),
      correctOptionId: q.correctOptionId,
      diagnosis: q.explanation?.diagnosis || "",
      reasoning: q.explanation?.reasoning || "",
      educationalObjective: q.explanation?.educationalObjective || "",
      incorrectReasons: Object.fromEntries(
        (q.explanation?.incorrectOptions || []).map((io) => [io.optionId, io.reason]),
      ),
    });
  };

  const cancelEdit = () => { setEditingId(null); setEditDraft(null); setEditError(""); };

  const saveEdit = async (q) => {
    const d = editDraft;
    const incorrectOptions = d.options
      .filter((o) => o.id !== d.correctOptionId)
      .map((o) => ({ optionId: o.id, reason: (d.incorrectReasons[o.id] || "").trim() || "Reason not provided." }));
    const body = {
      question: d.question,
      vignette: { ...q.vignette, narrative: d.narrative },
      options: d.options,
      correctOptionId: d.correctOptionId,
      explanation: {
        ...q.explanation,
        diagnosis: d.diagnosis,
        reasoning: d.reasoning,
        educationalObjective: d.educationalObjective,
        incorrectOptions,
      },
    };
    try {
      const res = await fetch(apiUrl(`/api/clinical-vignettes/${q.id}`), {
        method: "PATCH", headers: jsonHeaders(), body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setEditError(data.details ? data.details.join("; ") : data.error || "Failed to save.");
        return;
      }
      setQuestions((prev) => prev.map((x) => (x.id === data.id ? data : x)));
      cancelEdit();
    } catch {
      setEditError("Failed to reach the server.");
    }
  };

  const exportQuestions = async (ids) => {
    if (ids.length === 0) return;
    try {
      const res = await fetch(apiUrl("/api/clinical-vignettes/export"), {
        method: "POST", headers: jsonHeaders(), body: JSON.stringify({ ids }),
      });
      if (!res.ok) return;
      downloadJson(await res.blob(), `clinical-vignettes-${Date.now()}.json`);
    } catch { /* ignore */ }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div id="cvg_root">
      {/* ── Header ── */}
      <div id="cvg_header">
        <button id="cvg_back" onClick={() => navigate("/home")} title="Back">
          <i className="fi fi-rr-arrow-left" />
        </button>
        <div id="cvg_header_titles">
          <span id="cvg_title">Clinical Vignette Generator</span>
          <span id="cvg_subtitle">AI-generated USMLE Step 2 CK–style practice questions</span>
        </div>
        <div id="cvg_header_meta">
          <span className="cvg_count_badge">{questions.length} question{questions.length !== 1 ? "s" : ""}</span>
        </div>
      </div>

      <div id="cvg_safety_notice">
        <i className="fi fi-rr-triangle-warning" />
        {SAFETY_NOTICE}
      </div>

      {/* ── Body ── */}
      <div id="cvg_body">

        {/* ── Left: generator + jobs ── */}
        <div id="cvg_left">
          <div id="cvg_form_panel">
            <span className="cvg_panel_label"><i className="fi fi-rr-flask" /> Generator</span>

            <div className="cvg_field_row">
              <div className="cvg_field">
                <label className="cvg_label">Number of questions</label>
                <input
                  type="number" min={1} max={100} className="cvg_input"
                  value={form.count}
                  onChange={(e) => setField("count", Math.min(100, Math.max(1, parseInt(e.target.value, 10) || 1)))}
                />
              </div>
              <div className="cvg_field">
                <label className="cvg_label">Answer choices</label>
                <select className="cvg_select" value={form.optionCount} onChange={(e) => setField("optionCount", parseInt(e.target.value, 10))}>
                  {[4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            </div>

            <div className="cvg_field">
              <label className="cvg_label">Examination</label>
              <select className="cvg_select" value={form.exam} onChange={(e) => setField("exam", e.target.value)}>
                {EXAMS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
              </select>
            </div>

            <div className="cvg_field">
              <label className="cvg_label">Organ system</label>
              <select className="cvg_select" value={form.system} onChange={(e) => setSystem(e.target.value)}>
                {ORGAN_SYSTEMS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>

            <div className="cvg_field">
              <label className="cvg_label">Topic</label>
              <select className="cvg_select" value={form.topic} onChange={(e) => setField("topic", e.target.value)}>
                {(TOPICS_BY_SYSTEM[form.system] || []).map((t) => <option key={t} value={t}>{humanize(t)}</option>)}
              </select>
            </div>

            <div className="cvg_field">
              <label className="cvg_label">Physician task</label>
              <select className="cvg_select" value={form.physicianTask} onChange={(e) => setField("physicianTask", e.target.value)}>
                {PHYSICIAN_TASKS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>

            <div className="cvg_field_row">
              <div className="cvg_field">
                <label className="cvg_label">Difficulty</label>
                <select className="cvg_select" value={form.difficulty} onChange={(e) => setField("difficulty", e.target.value)}>
                  {DIFFICULTIES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
              </div>
              <div className="cvg_field">
                <label className="cvg_label">Patient population</label>
                <select className="cvg_select" value={form.patientPopulation} onChange={(e) => setField("patientPopulation", e.target.value)}>
                  {PATIENT_POPULATIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
            </div>

            <div className="cvg_field_row">
              <div className="cvg_field">
                <label className="cvg_label">AI provider</label>
                <select className="cvg_select" value={form.provider} onChange={(e) => setProvider(e.target.value)}>
                  {AI_PROVIDERS.filter((p) => p.id !== "manual").map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </div>
              <div className="cvg_field">
                <label className="cvg_label">Model</label>
                <select className="cvg_select" value={form.model} onChange={(e) => setField("model", e.target.value)}>
                  {(MODELS_BY_PROVIDER[form.provider] || [""]).map((m) => (
                    <option key={m || "default"} value={m}>{m || "Provider default"}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="cvg_checkbox_group">
              <label className="cvg_checkbox">
                <input type="checkbox" checked={form.includeExplanation} onChange={(e) => setField("includeExplanation", e.target.checked)} />
                Detailed explanation
              </label>
              <label className="cvg_checkbox">
                <input type="checkbox" checked={form.includeIncorrectExplanations} onChange={(e) => setField("includeIncorrectExplanations", e.target.checked)} />
                Explanations for incorrect options
              </label>
              <label className="cvg_checkbox">
                <input type="checkbox" checked={form.includePrerequisiteConcepts} onChange={(e) => setField("includePrerequisiteConcepts", e.target.checked)} />
                Prerequisite concepts
              </label>
              <label className="cvg_checkbox">
                <input type="checkbox" checked={form.includeEducationalObjective} onChange={(e) => setField("includeEducationalObjective", e.target.checked)} />
                Educational objective
              </label>
            </div>

            {generateError && <p className="cvg_error">{generateError}</p>}

            <div className="cvg_form_actions">
              <button
                className="cvg_btn cvg_btn--primary"
                onClick={startGeneration}
                disabled={isJobActive || !form.system.trim() || !form.topic.trim()}
              >
                <i className="fi fi-rr-bolt" /> Generate
              </button>
              {isJobActive && (
                <button className="cvg_btn cvg_btn--cancel" onClick={cancelActiveJob}>
                  <i className="fi fi-rr-cross-small" /> Cancel
                </button>
              )}
              <button className="cvg_btn" onClick={resetForm} disabled={isJobActive}>
                <i className="fi fi-rr-refresh" /> Reset
              </button>
            </div>
          </div>

          {/* Job progress */}
          {activeJob && (
            <div id="cvg_job_progress">
              <div className="cvg_job_progress_head">
                <span className={`cvg_job_status cvg_job_status--${activeJob.status}`}>{activeJob.status.replace(/_/g, " ")}</span>
                <span className="cvg_job_progress_text">{activeJob.progressMessage}</span>
              </div>
              <div className="cvg_progress_bar">
                <div
                  className="cvg_progress_bar_fill"
                  style={{ width: `${activeJob.totalRequested ? Math.min(100, (activeJob.totalGenerated / activeJob.totalRequested) * 100) : 0}%` }}
                />
              </div>
              {activeJob.error && <p className="cvg_error">{activeJob.error}</p>}
              {TERMINAL_JOB_STATUSES.includes(activeJob.status) && activeJob.batches?.some((b) => b.status === "failed") && (
                <button className="cvg_btn cvg_btn--sm" onClick={() => retryFailedBatches(activeJob.id)}>
                  <i className="fi fi-rr-redo" /> Retry failed batches
                </button>
              )}
            </div>
          )}

          {/* Job history */}
          <div id="cvg_job_history">
            <span className="cvg_panel_label"><i className="fi fi-rr-clock" /> Generation jobs</span>
            <div id="cvg_job_history_list">
              {jobs.length === 0 ? (
                <p className="cvg_empty_hint">No jobs yet</p>
              ) : jobs.map((j) => (
                <button
                  key={j.id}
                  className={`cvg_job_row${filters.jobId === j.id ? " cvg_job_row--active" : ""}`}
                  onClick={() => setFilters((prev) => ({ ...prev, jobId: prev.jobId === j.id ? "" : j.id }))}
                  title="Filter results to this job"
                >
                  <span className={`cvg_job_status cvg_job_status--${j.status}`}>{j.status.replace(/_/g, " ")}</span>
                  <span className="cvg_job_row_meta">{j.params?.system} · {j.params?.topic}</span>
                  <span className="cvg_job_row_count">{j.totalGenerated}/{j.totalRequested}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Right: results ── */}
        <div id="cvg_right">
          <div id="cvg_filter_bar">
            <input className="cvg_input cvg_input--sm" placeholder="Filter: system" value={filters.system} onChange={(e) => setFilters((p) => ({ ...p, system: e.target.value }))} />
            <input className="cvg_input cvg_input--sm" placeholder="Filter: topic" value={filters.topic} onChange={(e) => setFilters((p) => ({ ...p, topic: e.target.value }))} />
            <select className="cvg_select cvg_select--sm" value={filters.difficulty} onChange={(e) => setFilters((p) => ({ ...p, difficulty: e.target.value }))}>
              <option value="">All difficulties</option>
              {DIFFICULTIES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
            <select className="cvg_select cvg_select--sm" value={filters.physicianTask} onChange={(e) => setFilters((p) => ({ ...p, physicianTask: e.target.value }))}>
              <option value="">All tasks</option>
              {PHYSICIAN_TASKS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <select className="cvg_select cvg_select--sm" value={filters.reviewStatus} onChange={(e) => setFilters((p) => ({ ...p, reviewStatus: e.target.value }))}>
              <option value="">All review statuses</option>
              {REVIEW_STATUSES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            {filters.jobId && (
              <button className="cvg_btn cvg_btn--sm" onClick={() => setFilters((p) => ({ ...p, jobId: "" }))}>
                <i className="fi fi-rr-cross-small" /> Clear job filter
              </button>
            )}
          </div>

          <div id="cvg_toolbar">
            <label className="cvg_checkbox">
              <input type="checkbox" checked={questions.length > 0 && selectedIds.size === questions.length} onChange={toggleSelectAll} />
              Select all
            </label>
            <span className="cvg_toolbar_count">{selectedIds.size} selected</span>
            <button className="cvg_btn cvg_btn--sm" onClick={() => exportQuestions([...selectedIds])} disabled={selectedIds.size === 0}>
              <i className="fi fi-rr-download" /> Export selected
            </button>
            <button className="cvg_btn cvg_btn--sm" onClick={() => exportQuestions(questions.map((q) => q.id))} disabled={questions.length === 0}>
              <i className="fi fi-rr-download" /> Export all
            </button>
          </div>

          <div id="cvg_results_list">
            {questionsLoading ? (
              <p className="cvg_empty_hint">Loading…</p>
            ) : questions.length === 0 ? (
              <div className="cvg_empty">
                <i className="fi fi-rr-document" />
                <p>No questions yet</p>
                <p className="cvg_empty_hint">Use the generator on the left to create some</p>
              </div>
            ) : questions.map((q) => {
              const showAnswer = revealedAnswers.has(q.id);
              const showExplanation = revealedExplanations.has(q.id);
              const isEditing = editingId === q.id;
              return (
                <div key={q.id} className="cvg_card">
                  <div className="cvg_card_head">
                    <input type="checkbox" checked={selectedIds.has(q.id)} onChange={() => toggleSelected(q.id)} />
                    <span className="cvg_badge">{q.system}</span>
                    <span className="cvg_badge">{q.topic}</span>
                    <span className="cvg_badge cvg_badge--difficulty">{labelFor(DIFFICULTIES, q.difficulty)}</span>
                    <span className="cvg_badge">{labelFor(PHYSICIAN_TASKS, q.physicianTask)}</span>
                    <span className={`cvg_badge cvg_badge--review cvg_badge--review-${q.qualityControl?.medicalReviewStatus}`}>
                      {labelFor(REVIEW_STATUSES, q.qualityControl?.medicalReviewStatus)}
                    </span>
                    {q.similarityFlag && <span className="cvg_badge cvg_badge--warn" title="Flagged as similar to an existing question">Similar</span>}
                  </div>

                  {isEditing ? (
                    <div className="cvg_edit_form">
                      <label className="cvg_label">Narrative</label>
                      <textarea className="cvg_textarea" rows={3} value={editDraft.narrative} onChange={(e) => setEditDraft((d) => ({ ...d, narrative: e.target.value }))} />
                      <label className="cvg_label">Question</label>
                      <textarea className="cvg_textarea" rows={2} value={editDraft.question} onChange={(e) => setEditDraft((d) => ({ ...d, question: e.target.value }))} />
                      <label className="cvg_label">Options (select the correct one)</label>
                      {editDraft.options.map((o, i) => (
                        <div className="cvg_edit_option_row" key={o.id}>
                          <input type="radio" checked={editDraft.correctOptionId === o.id} onChange={() => setEditDraft((d) => ({ ...d, correctOptionId: o.id }))} />
                          <span className="cvg_option_id">{o.id}</span>
                          <input
                            className="cvg_input"
                            value={o.text}
                            onChange={(e) => setEditDraft((d) => {
                              const options = [...d.options];
                              options[i] = { ...options[i], text: e.target.value };
                              return { ...d, options };
                            })}
                          />
                        </div>
                      ))}
                      <label className="cvg_label">Diagnosis</label>
                      <input className="cvg_input" value={editDraft.diagnosis} onChange={(e) => setEditDraft((d) => ({ ...d, diagnosis: e.target.value }))} />
                      <label className="cvg_label">Reasoning</label>
                      <textarea className="cvg_textarea" rows={3} value={editDraft.reasoning} onChange={(e) => setEditDraft((d) => ({ ...d, reasoning: e.target.value }))} />
                      <label className="cvg_label">Educational objective</label>
                      <input className="cvg_input" value={editDraft.educationalObjective} onChange={(e) => setEditDraft((d) => ({ ...d, educationalObjective: e.target.value }))} />
                      {editDraft.options.filter((o) => o.id !== editDraft.correctOptionId).map((o) => (
                        <div key={o.id}>
                          <label className="cvg_label">Why {o.id} is incorrect</label>
                          <input
                            className="cvg_input"
                            value={editDraft.incorrectReasons[o.id] || ""}
                            onChange={(e) => setEditDraft((d) => ({ ...d, incorrectReasons: { ...d.incorrectReasons, [o.id]: e.target.value } }))}
                          />
                        </div>
                      ))}
                      {editError && <p className="cvg_error">{editError}</p>}
                      <div className="cvg_edit_actions">
                        <button className="cvg_btn cvg_btn--primary cvg_btn--sm" onClick={() => saveEdit(q)}><i className="fi fi-rr-check" /> Save</button>
                        <button className="cvg_btn cvg_btn--sm" onClick={cancelEdit}><i className="fi fi-rr-cross-small" /> Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="cvg_narrative">{q.vignette.narrative}</p>
                      <p className="cvg_question">{q.question}</p>
                      <div className="cvg_options">
                        {q.options.map((o) => (
                          <div
                            key={o.id}
                            className={`cvg_option${showAnswer && o.id === q.correctOptionId ? " cvg_option--correct" : ""}`}
                          >
                            <span className="cvg_option_id">{o.id}</span>
                            <span>{o.text}</span>
                          </div>
                        ))}
                      </div>

                      <div className="cvg_card_toggles">
                        <button className="cvg_btn cvg_btn--sm" onClick={() => toggleReveal(setRevealedAnswers, q.id)}>
                          <i className={`fi ${showAnswer ? "fi-rr-eye-crossed" : "fi-rr-eye"}`} /> {showAnswer ? "Hide" : "Show"} answer
                        </button>
                        <button className="cvg_btn cvg_btn--sm" onClick={() => toggleReveal(setRevealedExplanations, q.id)}>
                          <i className={`fi ${showExplanation ? "fi-rr-eye-crossed" : "fi-rr-eye"}`} /> {showExplanation ? "Hide" : "Show"} explanation
                        </button>
                        <button className="cvg_btn cvg_btn--sm" onClick={() => setJsonPreviewId(jsonPreviewId === q.id ? null : q.id)}>
                          <i className="fi fi-rr-brackets-curly" /> JSON
                        </button>
                      </div>

                      {showExplanation && (
                        <div className="cvg_explanation">
                          {q.explanation?.uncertaintyWarning && (
                            <p className="cvg_uncertainty"><i className="fi fi-rr-triangle-warning" /> {q.explanation.uncertaintyWarning}</p>
                          )}
                          <p><strong>Diagnosis:</strong> {q.explanation?.diagnosis}</p>
                          <p><strong>Reasoning:</strong> {q.explanation?.reasoning}</p>
                          {q.explanation?.incorrectOptions?.length > 0 && (
                            <ul>
                              {q.explanation.incorrectOptions.map((io) => (
                                <li key={io.optionId}><strong>{io.optionId}:</strong> {io.reason}</li>
                              ))}
                            </ul>
                          )}
                          {q.explanation?.prerequisiteConcepts?.length > 0 && (
                            <p><strong>Prerequisite concepts:</strong> {q.explanation.prerequisiteConcepts.join(", ")}</p>
                          )}
                          {q.explanation?.educationalObjective && (
                            <p><strong>Objective:</strong> {q.explanation.educationalObjective}</p>
                          )}
                        </div>
                      )}

                      <div className="cvg_card_actions">
                        <button className="cvg_btn cvg_btn--sm" onClick={() => startEdit(q)}><i className="fi fi-rr-pencil" /> Edit</button>
                        <button className="cvg_btn cvg_btn--sm" onClick={() => regenerateQuestion(q.id)}><i className="fi fi-rr-refresh" /> Regenerate</button>
                        <select
                          className="cvg_select cvg_select--sm"
                          value={q.qualityControl?.medicalReviewStatus || "pending"}
                          onChange={(e) => setReviewStatus(q.id, e.target.value)}
                        >
                          {REVIEW_STATUSES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                        </select>
                        <button className="cvg_btn cvg_btn--sm cvg_btn--danger" onClick={() => deleteQuestion(q.id)}><i className="fi fi-rr-trash" /> Delete</button>
                      </div>
                    </>
                  )}

                  {jsonPreviewId === q.id && (
                    <pre className="cvg_json_preview">{JSON.stringify(q, null, 2)}</pre>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
