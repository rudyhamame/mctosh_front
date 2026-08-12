import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiUrl } from "../config/api";
import { readStoredSession } from "../utils/sessionCleanup";
import "./contextSettingsTab.css";

const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${readStoredSession()?.token || ""}`,
});
const request = async (path, options = {}) => {
  const response = await fetch(apiUrl(path), { ...options, headers: { ...authHeaders(), ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : data.error?.message || "Context request failed.");
  return data;
};

const CONTEXT_NUMBERS = [
  ["previousSentenceCount", "Previous sentences", 0, 5], ["nextSentenceCount", "Following sentences", 0, 5],
  ["leftTokenCount", "Left-token window", 0, 100], ["rightTokenCount", "Right-token window", 0, 100],
];
const CONTEXT_FLAGS = [
  ["includePreviousParagraphWhenIncomplete", "Include previous paragraph when incomplete"],
  ["includeNextParagraphWhenIncomplete", "Include next paragraph when incomplete"],
  ["respectDocumentBoundaries", "Respect document boundaries"], ["respectPageBoundaries", "Respect page boundaries"],
  ["respectBlockBoundaries", "Respect block boundaries"], ["respectColumnBoundaries", "Respect column boundaries"],
  ["respectTableCellBoundaries", "Respect table-cell boundaries"], ["includeOcrConfidence", "Use OCR confidence"],
  ["useBoundingBoxContinuity", "Use bounding-box continuity"], ["includeImageEvidence", "Include page-image evidence when available"],
];
const CATEGORY_LABELS = {
  OCR_CHARACTER: "OCR character error", SPELLING: "Spelling error", TOKEN_SPLIT: "Token split", TOKEN_MERGE: "Token merge",
  GRAMMAR: "Grammar error", MISSING_WORD: "Missing word", DUPLICATED_WORD: "Duplicated word", WRONG_WORD: "Wrong word",
  PUNCTUATION: "Punctuation error", CAPITALIZATION: "Capitalization error", READING_ORDER: "Reading-order error",
  TERMINOLOGY: "Terminology error", UNRESOLVED: "Unresolved anomaly",
};
const PROTECTION_LABELS = {
  NEGATION: "Negation", UNCERTAINTY: "Uncertainty", TEMPORALITY: "Temporality", LATERALITY: "Laterality",
  ANATOMY: "Anatomical entities", DIAGNOSIS: "Diagnoses", SYMPTOM: "Symptoms and signs", MEDICATION: "Medications",
  DOSE: "Medication doses", NUMBER: "Numbers", RANGE: "Ranges", UNIT: "Units", LAB_VALUE: "Laboratory values",
  PERSON_NAME: "Person names", DATE: "Dates", RELATION: "Clinical relations",
};

const Metric = ({ label, value, detail }) => <div className="context_metric"><span>{label}</span><strong>{value ?? "—"}</strong>{detail && <small>{detail}</small>}</div>;
const Check = ({ label, checked, onChange, disabled }) => (
  <label className="context_check"><input type="checkbox" checked={Boolean(checked)} onChange={(event) => onChange(event.target.checked)} disabled={disabled} /><span>{label}</span></label>
);

const InlineDiff = ({ original = "", corrected = "" }) => {
  if (!corrected || original === corrected) return <span>{original}</span>;
  const before = original.split(/(\s+)/);
  const after = corrected.split(/(\s+)/);
  let start = 0;
  while (start < before.length && before[start] === after[start]) start += 1;
  let beforeEnd = before.length - 1;
  let afterEnd = after.length - 1;
  while (beforeEnd >= start && afterEnd >= start && before[beforeEnd] === after[afterEnd]) { beforeEnd -= 1; afterEnd -= 1; }
  return <span className="context_diff">{before.slice(0, start).join("")}<span className="context_diff_change" aria-label={`Changed from ${before.slice(start, beforeEnd + 1).join("")} to ${after.slice(start, afterEnd + 1).join("")}`}><del>{before.slice(start, beforeEnd + 1).join("") || "∅"}</del><span aria-hidden="true"> → </span><ins>{after.slice(start, afterEnd + 1).join("") || "∅"}</ins></span>{before.slice(beforeEnd + 1).join("")}</span>;
};

export default function ContextSettingsTab() {
  const navigate = useNavigate();
  const [settings, setSettings] = useState(null);
  const [defaults, setDefaults] = useState(null);
  const [overview, setOverview] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [selectedDocuments, setSelectedDocuments] = useState([]);
  const [job, setJob] = useState(null);
  const [review, setReview] = useState({ items: [], page: 1, pages: 1, total: 0 });
  const [reviewStatus, setReviewStatus] = useState("ALL");
  const [evaluation, setEvaluation] = useState(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [candidateChoices, setCandidateChoices] = useState({});

  const loadReview = useCallback(async (page = 1, status = reviewStatus) => {
    const data = await request(`/api/context/review?page=${page}&limit=25&status=${encodeURIComponent(status)}`);
    setReview(data);
  }, [reviewStatus]);
  const refresh = useCallback(async () => {
    const [settingsData, overviewData, documentsData, evaluationData] = await Promise.all([
      request("/api/settings/context"), request("/api/context/overview"), request("/api/context/documents"), request("/api/context/evaluation"),
    ]);
    setSettings(settingsData.settings); setDefaults(settingsData.defaults); setOverview(overviewData.overview);
    setJob(overviewData.job); setDocuments(documentsData.documents || []); setEvaluation(evaluationData.evaluation);
  }, []);

  useEffect(() => { refresh().then(() => loadReview()).catch((e) => setError(e.message)); }, [refresh, loadReview]);
  useEffect(() => {
    if (!job?._id || !["QUEUED", "RUNNING"].includes(job.status)) return undefined;
    const timer = window.setInterval(async () => {
      try {
        const data = await request(`/api/context/jobs/${job._id}`); setJob(data.job);
        if (["COMPLETED", "FAILED", "CANCELLED"].includes(data.job.status)) { await refresh(); await loadReview(); }
      } catch (e) { setError(e.message); }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [job?._id, job?.status, loadReview, refresh]);

  const patchSetting = (group, key, value) => setSettings((current) => ({ ...current, [group]: { ...current[group], [key]: value } }));
  const save = async () => {
    setSaving(true); setError("");
    try { const data = await request("/api/settings/context", { method: "PATCH", body: JSON.stringify(settings) }); setSettings(data.settings); setMessage("Context settings saved as a new analysis configuration version."); }
    catch (e) { setError(e.message); } finally { setSaving(false); }
  };
  const start = async (path, body = {}) => {
    setBusy(path); setError("");
    try { const data = await request(path, { method: "POST", body: JSON.stringify(body) }); setJob(data.job); setMessage("Background job started. You may leave this tab safely."); }
    catch (e) { setError(e.message); } finally { setBusy(""); }
  };
  const clearDerived = async () => {
    if (!window.confirm("Clear unreviewed derived analyses? Original evidence and accepted canonical corrections are preserved.")) return;
    setBusy("clear"); setError("");
    try {
      const data = await request("/api/context/clear-derived", { method: "POST", body: "{}" });
      setMessage(`Removed ${data.removed} unreviewed derived analyses. Observed and canonical text were preserved.`);
      await Promise.all([refresh(), loadReview(1)]);
    } catch (e) { setError(e.message); } finally { setBusy(""); }
  };
  const exportResults = async () => {
    setBusy("export");
    try {
      const response = await fetch(apiUrl("/api/context/export"), { headers: authHeaders() });
      if (!response.ok) throw new Error("Failed to export Context review results.");
      const blob = await response.blob();
      const href = URL.createObjectURL(blob); const anchor = document.createElement("a");
      anchor.href = href; anchor.download = "context-review-results.json"; anchor.click(); URL.revokeObjectURL(href);
    } catch (e) { setError(e.message); } finally { setBusy(""); }
  };
  const jobAction = async (action) => {
    if (!job?._id) return;
    try { const data = await request(`/api/context/jobs/${job._id}/${action}`, { method: "POST", body: "{}" }); setJob(data.job); }
    catch (e) { setError(e.message); }
  };
  const reviewAction = async (analysis, action, body = {}) => {
    setBusy(`${analysis._id}:${action}`); setError("");
    try { await request(`/api/context/analyses/${analysis._id}/${action}`, { method: "POST", body: JSON.stringify({ expectedVersion: analysis.__v, ...body }) }); await Promise.all([loadReview(review.page), refresh()]); }
    catch (e) { setError(e.message); } finally { setBusy(""); }
  };
  const addAcceptedTerm = async (analysis, suggested = "") => {
    const term = window.prompt("Accepted term to add to the Context lexicon", suggested);
    if (!term) return;
    setBusy(`${analysis._id}:term`);
    try {
      await request(`/api/context/analyses/${analysis._id}/add-term`, { method: "POST", body: JSON.stringify({ term }) });
      setMessage(`“${term}” is now approved reviewed-correction evidence.`);
    } catch (e) { setError(e.message); } finally { setBusy(""); }
  };
  const active = ["QUEUED", "RUNNING", "PAUSED"].includes(job?.status);
  const metrics = useMemo(() => overview ? [
    ["Documents", overview.documents], ["Reconstructed sentences", overview.sentences], ["Tokens", overview.tokens],
    ["Awaiting analysis", overview.awaitingAnalysis], ["Suspicious", overview.suspicious], ["Suggested corrections", overview.suggested],
    ["Accepted", overview.accepted], ["Rejected", overview.rejected], ["Unresolved", overview.unresolved],
  ] : [], [overview]);

  if (!settings) return <div className="context_loading" role="status">Loading Context settings…</div>;
  return <div className="context_tab">
    <header className="context_title_row"><div><h2 className="sett_section_title">Context</h2><p className="sett_section_desc">Reconstruct, inspect, and safely correct the observed corpus without overwriting source evidence.</p></div><span className="context_version">{overview?.pipelineVersion || "Context pipeline"}</span></header>
    {error && <div className="context_alert context_alert--error" role="alert">{error}</div>}
    {message && <div className="context_alert" role="status">{message}</div>}

    <section className="context_panel" aria-labelledby="context-overview"><h3 id="context-overview">Overview</h3><p>Context analysis detects extraction, OCR, spelling, tokenization, punctuation, and clear grammar errors. It proposes minimal corrections without intentionally paraphrasing or changing facts.</p><div className="context_metrics">{metrics.map(([label, value]) => <Metric key={label} label={label} value={Number(value || 0).toLocaleString()} />)}<Metric label="Analysis engine" value={overview?.provider} detail={overview?.model} /><Metric label="Last analysis" value={overview?.lastAnalysisAt ? new Date(overview.lastAnalysisAt).toLocaleString() : "Never"} /></div></section>

    <section className="context_panel"><div className="context_panel_heading"><div><h3>Context configuration</h3><p>Sentence context is primary; token windows are generated dynamically and never persisted as duplicate strings.</p></div><button className="context_btn context_btn--quiet" onClick={() => setSettings((current) => ({ ...current, context: defaults.context }))}>Reset defaults</button></div><div className="context_number_grid">{CONTEXT_NUMBERS.map(([key, label, min, max]) => <label key={key}><span>{label}</span><input type="number" min={min} max={max} value={settings.context[key]} onChange={(event) => patchSetting("context", key, Math.max(min, Math.min(max, Number(event.target.value))))} /></label>)}</div><div className="context_checks">{CONTEXT_FLAGS.map(([key, label]) => <Check key={key} label={label} checked={settings.context[key]} disabled={key === "respectDocumentBoundaries"} onChange={(value) => patchSetting("context", key, value)} />)}</div></section>

    <section className="context_panel"><h3>Detection configuration</h3><div className="context_checks context_checks--categories">{Object.entries(CATEGORY_LABELS).map(([key, label]) => <Check key={key} label={label} checked={settings.detection.categories[key]} onChange={(value) => setSettings((current) => ({ ...current, detection: { ...current.detection, categories: { ...current.detection.categories, [key]: value } } }))} />)}</div><div className="context_number_grid">{[["minimumSuspicionScore", "Minimum suspicion", 0, 1, .05], ["minimumAutoAcceptConfidence", "Auto-acceptable threshold", 0, 1, .05], ["minimumReviewConfidence", "Review threshold", 0, 1, .05], ["maximumEditDistance", "Maximum edit distance", 1, 20, 1]].map(([key, label, min, max, step]) => <label key={key}><span>{label}</span><input type="number" min={min} max={max} step={step} value={settings.detection[key]} onChange={(event) => patchSetting("detection", key, Number(event.target.value))} /></label>)}</div><div className="context_checks"><Check label="Require terminology evidence for medical corrections" checked={settings.detection.requireTerminologyEvidence} onChange={(value) => patchSetting("detection", "requireTerminologyEvidence", value)} /><Check label="Always review protected-fact changes" checked={settings.detection.alwaysReviewProtectedFacts} onChange={(value) => patchSetting("detection", "alwaysReviewProtectedFacts", value)} /><Check label="Use contextual AI when configured" checked={settings.detection.useContextualAi !== false} onChange={(value) => patchSetting("detection", "useContextualAi", value)} /></div></section>

    <section className="context_panel"><div className="context_panel_heading"><div><h3>Meaning protection</h3><p>Any enabled fact added, removed, or changed forces human review—even at high confidence.</p></div><button className="context_btn context_btn--quiet" onClick={() => setSettings((current) => ({ ...current, protection: defaults.protection }))}>Enable all</button></div><div className="context_checks context_checks--categories">{Object.entries(PROTECTION_LABELS).map(([key, label]) => <Check key={key} label={label} checked={settings.protection[key]} onChange={(value) => patchSetting("protection", key, value)} />)}</div></section>
    <div className="context_save_row"><button className="context_btn context_btn--primary" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save Context settings"}</button></div>

    <section className="context_panel"><h3>Analysis controls</h3><div className="context_documents" aria-label="Documents selected for Context analysis">{documents.map((document) => <Check key={document._id} label={document.name} checked={selectedDocuments.includes(document._id)} onChange={(checked) => setSelectedDocuments((current) => checked ? [...current, document._id] : current.filter((id) => id !== document._id))} />)}</div><div className="context_actions"><button className="context_btn" disabled={active || busy} onClick={() => start("/api/context/reconstruct", selectedDocuments.length ? { documentIds: selectedDocuments } : {})}><i className="fi fi-rr-refresh" /> Reconstruct corpus</button><button className="context_btn context_btn--primary" disabled={active || busy} onClick={() => start("/api/context/analyze")}><i className="fi fi-rr-play" /> Analyze unprocessed / retry failed</button><button className="context_btn" disabled={active || !selectedDocuments.length || busy} onClick={() => start("/api/context/analyze/selected", { documentIds: selectedDocuments })}>Analyze selected</button><button className="context_btn" disabled={job?.status !== "RUNNING"} onClick={() => jobAction("pause")}>Pause</button><button className="context_btn" disabled={job?.status !== "PAUSED"} onClick={() => jobAction("resume")}>Resume</button><button className="context_btn context_btn--danger" disabled={!active} onClick={() => jobAction("cancel")}>Cancel</button><button className="context_btn" disabled={busy === "export"} onClick={exportResults}>Export review</button><button className="context_btn context_btn--danger" disabled={busy === "clear"} onClick={clearDerived}>Clear derived</button></div>{job && <div className="context_job" aria-live="polite"><div><strong>{job.type}</strong><span>{job.status}</span><b>{job.progress || 0}%</b></div><progress max="100" value={job.progress || 0} /><div className="context_job_stats"><span>Documents {job.documentsProcessed}/{job.documentsTotal}</span><span>Sentences {job.sentencesProcessed}/{job.sentencesTotal}</span><span>Suspicious {job.suspiciousFound}</span><span>Errors {job.errorCount}</span><span>{job.sentencesProcessed ? `~${Math.max(0, job.sentencesTotal - job.sentencesProcessed)} remaining` : "Estimating work…"}</span></div></div>}</section>

    <section className="context_panel context_review_panel"><div className="context_panel_heading"><div><h3>Review queue</h3><p>{review.total.toLocaleString()} analyses. Original evidence remains immutable.</p></div><select aria-label="Filter review queue by status" value={reviewStatus} onChange={(event) => { setReviewStatus(event.target.value); loadReview(1, event.target.value).catch((e) => setError(e.message)); }}><option value="ALL">All statuses</option>{["PENDING", "AUTO_ACCEPTABLE", "REVIEW_REQUIRED", "ACCEPTED", "REJECTED", "UNRESOLVED"].map((status) => <option key={status}>{status}</option>)}</select></div><div className="context_table_wrap"><table className="context_table"><thead><tr><th>Source</th><th>Original / correction</th><th>Evidence</th><th>Confidence</th><th>Status</th><th>Actions</th></tr></thead><tbody>{review.items.length ? review.items.map((analysis) => { const sentence = analysis.sentenceId || {}; const chosenId = candidateChoices[analysis._id] || analysis.selectedCandidateId; const candidate = analysis.candidates?.find((item) => item.id === chosenId) || analysis.candidates?.[0]; const firstSpan = analysis.errorSpans?.[0]; return <tr key={analysis._id}><td><strong>{sentence.documentName || "Document"}</strong><small>Page {sentence.pageNumber || "—"} · {sentence.extractionMethod || "—"}</small><small>OCR {sentence.averageOcrConfidence == null ? "—" : `${Math.round(sentence.averageOcrConfidence * 100)}%`}</small><button className="context_source_link" onClick={() => navigate("/pdf-reader", { state: { sourceId: sentence.documentId, pdfName: sentence.documentName, page: sentence.pageNumber } })}>View source page</button></td><td className="context_sentence_cell"><InlineDiff original={sentence.originalText} corrected={candidate?.correctedSentence} />{analysis.candidates?.length > 1 && <select className="context_candidate_select" aria-label="Choose another correction candidate" value={candidate?.id || ""} onChange={(event) => setCandidateChoices((current) => ({ ...current, [analysis._id]: event.target.value }))}>{analysis.candidates.map((item, index) => <option key={item.id} value={item.id}>Candidate {index + 1} · {Math.round(item.confidence * 100)}%</option>)}</select>}{candidate?.changesMeaning && <span className="context_warning"><i className="fi fi-rr-triangle-warning" /> Meaning-change review required</span>}</td><td><span className="context_type">{firstSpan?.errorType || "No anomaly"}</span><small>{firstSpan?.evidence?.join(" ") || "No deterministic evidence."}</small>{candidate?.protectedFactsChanged?.length > 0 && <small>Protected: {candidate.protectedFactsChanged.map((fact) => fact.original?.type).join(", ")}</small>}{sentence.tokens?.some((token) => token.bbox) && <details><summary>Source boxes</summary><small>{sentence.tokens.filter((token) => token.bbox).map((token) => `${token.text}: ${JSON.stringify(token.bbox)}`).join(" · ")}</small></details>}</td><td>{Math.round((candidate?.confidence ?? analysis.errorProbability ?? 0) * 100)}%</td><td><span className={`context_status context_status--${String(analysis.reviewStatus).toLowerCase()}`}>{analysis.reviewStatus}</span></td><td><div className="context_row_actions"><button title="Accept suggestion" aria-label="Accept suggestion" disabled={!candidate || busy} onClick={() => reviewAction(analysis, "accept", { candidateId: candidate?.id })}><i className="fi fi-rr-check" /></button><button title="Reject suggestion" aria-label="Reject suggestion" disabled={busy} onClick={() => reviewAction(analysis, "reject")}><i className="fi fi-rr-cross" /></button><button title="Edit suggestion" aria-label="Edit suggestion" disabled={busy} onClick={() => { const text = window.prompt("Canonical correction", candidate?.correctedSentence || sentence.originalText || ""); if (text != null) reviewAction(analysis, "manual-correction", { canonicalText: text }); }}><i className="fi fi-rr-pencil" /></button><button title="Mark original correct" aria-label="Mark original correct" disabled={busy} onClick={() => reviewAction(analysis, "mark-original-correct")}><i className="fi fi-rr-shield-check" /></button><button title="Mark unresolved" aria-label="Mark unresolved" disabled={busy} onClick={() => reviewAction(analysis, "unresolved")}><i className="fi fi-rr-question" /></button><button title="Reanalyze" aria-label="Reanalyze" disabled={busy || ["ACCEPTED", "REJECTED"].includes(analysis.reviewStatus)} onClick={() => reviewAction(analysis, "reanalyze")}><i className="fi fi-rr-refresh" /></button><button title="Add accepted term to corpus lexicon" aria-label="Add accepted term to corpus lexicon" disabled={busy || analysis.reviewStatus !== "ACCEPTED"} onClick={() => addAcceptedTerm(analysis, candidate?.replacementText || "")}><i className="fi fi-rr-book-plus" /></button></div></td></tr>; }) : <tr><td colSpan="6" className="context_empty">No review items match this filter.</td></tr>}</tbody></table></div><div className="context_pagination"><button disabled={review.page <= 1} onClick={() => loadReview(review.page - 1)}>Previous</button><span>Page {review.page} of {review.pages}</span><button disabled={review.page >= review.pages} onClick={() => loadReview(review.page + 1)}>Next</button></div></section>

    <section className="context_panel"><h3>Evaluation</h3><p>{evaluation?.sufficient ? "Metrics are based only on reviewed decisions." : "Insufficient reviewed data. At least 20 reviewed items are required before safety metrics are presented as meaningful."}</p><div className="context_metrics"><Metric label="Reviewed sample" value={evaluation?.reviewedSampleSize || 0} /><Metric label="Detection precision" value={evaluation?.detectionPrecision == null ? "Insufficient reviewed data" : `${Math.round(evaluation.detectionPrecision * 100)}%`} /><Metric label="Detection recall" value={evaluation?.detectionRecall == null ? "Insufficient reviewed data" : `${Math.round(evaluation.detectionRecall * 100)}%`} /><Metric label="Acceptance rate" value={evaluation?.correctionAcceptanceRate == null ? "Insufficient reviewed data" : `${Math.round(evaluation.correctionAcceptanceRate * 100)}%`} /><Metric label="False-correction rate" value={evaluation?.falseCorrectionRate == null ? "Insufficient reviewed data" : `${Math.round(evaluation.falseCorrectionRate * 100)}%`} /><Metric label="Meaning-changing suggestions" value={evaluation?.meaningChangingSuggestionRate == null ? "Insufficient reviewed data" : `${Math.round(evaluation.meaningChangingSuggestionRate * 100)}%`} /></div></section>
  </div>;
}
