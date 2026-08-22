import React, { useMemo, useState } from "react";
import { apiUrl } from "../config/api";
import { readStoredSession } from "../utils/sessionCleanup";

const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${readStoredSession()?.token || ""}`,
});

const STATUS_LABELS = ["VALID", "SUSPECT", "NONSENSE"];

const CorpusSanitizerPanel = ({ rows, records, onRecords }) => {
  const [activeTab, setActiveTab] = useState("ALL");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const [occurrenceLimit, setOccurrenceLimit] = useState(() => localStorage.getItem("mctosh_corpus_sanitizer_occurrence_limit") || "");
  const counts = useMemo(() => records.reduce((result, item) => ({ ...result, [item.status]: (result[item.status] || 0) + 1 }), { VALID: 0, SUSPECT: 0, NONSENSE: 0 }), [records]);
  const visible = activeTab === "ALL" ? records : records.filter((item) => item.status === activeTab);
  const numericOccurrenceLimit = Number(occurrenceLimit);
  const eligibleRows = useMemo(() => rows.filter((row) => (
    !occurrenceLimit || (numericOccurrenceLimit >= 1 && Number(row.originalOccurrence ?? row.occurrence ?? 0) <= numericOccurrenceLimit)
  )), [numericOccurrenceLimit, occurrenceLimit, rows]);

  const changeOccurrenceLimit = (value) => {
    const normalized = value === "" ? "" : String(Math.max(1, Math.floor(Number(value) || 1)));
    setOccurrenceLimit(normalized);
    localStorage.setItem("mctosh_corpus_sanitizer_occurrence_limit", normalized);
  };

  const run = async () => {
    setRunning(true); setProgress(1); setStage("Starting sanitizer"); setError("");
    try {
      const completed = new Map(records.map((record) => [record.normalized, record]));
      const batchSize = 2000;
      for (let offset = 0; offset < eligibleRows.length; offset += batchSize) {
        const batch = eligibleRows.slice(offset, offset + batchSize);
        const response = await fetch(apiUrl("/api/corpus-sanitizer/run?stream=1"), {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ rows: batch }),
        });
        if (!response.ok || !response.body) throw new Error("Corpus sanitizer failed to start streaming progress.");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let batchRecords = [];
        const consumeLine = (line) => {
          if (!line.trim()) return;
          const message = JSON.parse(line);
          if (message.type === "error") throw new Error(message.error || "Corpus sanitizer failed.");
          if (message.type === "progress") {
            const overall = ((offset + (Math.max(0, Math.min(100, Number(message.progress) || 0)) / 100) * batch.length) / eligibleRows.length) * 100;
            setProgress(Math.max(1, Math.min(100, Math.round(overall))));
            setStage(message.stage || "Sanitizing corpus");
          }
          if (message.type === "complete") batchRecords = message.records || [];
        };
        while (true) {
          const { value, done } = await reader.read();
          buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          lines.forEach(consumeLine);
          if (done) break;
        }
        if (buffer.trim()) consumeLine(buffer);
        batchRecords.forEach((record) => completed.set(record.normalized, record));
        onRecords([...completed.values()]);
      }
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setRunning(false);
      setStage("");
    }
  };

  const emptySanitizer = async () => {
    if (!window.confirm("Empty all Corpus Sanitizer results and saved review decisions? The Corpus, source text, and UMLS will not be changed.")) return;
    setError("");
    try {
      const response = await fetch(apiUrl("/api/corpus-sanitizer/clear"), {
        method: "DELETE",
        headers: authHeaders(),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not empty the Corpus Sanitizer.");
      onRecords([]);
      setActiveTab("ALL");
      setProgress(0);
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const review = async (item, decision, correction = "") => {
    try {
      const response = await fetch(apiUrl(`/api/corpus-sanitizer/${encodeURIComponent(item.normalized)}/review`), {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ decision, correction }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Review could not be saved.");
      onRecords(records.map((record) => record.normalized === item.normalized ? { ...record, ...data.record } : record));
    } catch (requestError) { setError(requestError.message); }
  };

  const correct = (item) => {
    const suggested = item.suggestions?.[0]?.value || item.token;
    const correction = window.prompt("Correction used in the derived corpus only", suggested);
    if (correction?.trim()) void review(item, "CORRECTED", correction.trim());
  };

  return (
    <section className="sett_corpus_sanitizer" aria-labelledby="corpus-sanitizer-title">
      <div className="sett_corpus_sanitizer_header">
        <div><h3 id="corpus-sanitizer-title">Corpus Sanitizer</h3><p>Corpus strings are checked against read-only UMLS. Only the derived Corpus is classified or corrected; UMLS and original source text are never changed.</p></div>
        <div className="sett_corpus_sanitizer_run_controls">
          <label>
            <span>Maximum original occurrence</span>
            <input
              type="number"
              min="1"
              step="1"
              value={occurrenceLimit}
              placeholder="All"
              disabled={running}
              onChange={(event) => changeOccurrenceLimit(event.target.value)}
            />
            <small>{eligibleRows.length.toLocaleString()} of {rows.length.toLocaleString()} strings eligible</small>
          </label>
          <button className="sett_corpus_sanitizer_empty" type="button" onClick={emptySanitizer} disabled={running || !records.length}><i className="fi fi-rr-trash" /> Empty Sanitizer</button>
          <button className="sett_corpus_sanitizer_run" type="button" onClick={run} disabled={running || !eligibleRows.length} title={running ? stage : undefined}><i className="fi fi-rr-broom" /> {running ? `${stage} · ${progress}%` : "Run Sanitizer"}</button>
        </div>
      </div>
      <div className="sett_corpus_sanitizer_counts">
        {STATUS_LABELS.map((status) => <article key={status} data-status={status.toLocaleLowerCase()}><span>{status}</span><strong>{counts[status].toLocaleString()}</strong></article>)}
      </div>
      <div className="sett_corpus_sanitizer_tabs" role="tablist">
        {["ALL", ...STATUS_LABELS].map((status) => <button key={status} type="button" role="tab" aria-selected={activeTab === status} className={activeTab === status ? "is-active" : ""} onClick={() => setActiveTab(status)}>{status === "ALL" ? "All" : status.charAt(0) + status.slice(1).toLocaleLowerCase()}</button>)}
      </div>
      {error && <p className="sett_corpus_error">⚠ {error}</p>}
      <div className="sett_corpus_sanitizer_table_wrap">
        <table className="sett_corpus_sanitizer_table">
          <thead><tr><th>Token</th><th>Status</th><th>Frequency</th><th>Source</th><th>Reason / evidence</th><th>Suggested correction</th><th>Context</th><th>Actions</th></tr></thead>
          <tbody>
            {visible.length ? visible.map((item) => (
              <tr key={item.normalized}>
                <td><strong>{item.token}</strong>{item.medicalMatch?.cui && <small>{item.medicalMatch.cui} · {item.medicalMatch.tty}</small>}</td>
                <td><span className={`sett_corpus_sanitizer_status sett_corpus_sanitizer_status--${item.status.toLocaleLowerCase()}`}>{item.status}</span></td>
                <td>{Number(item.occurrence || item.frequency || 0).toLocaleString()}</td>
                <td>{item.sources || "—"}</td>
                <td><strong>{String(item.reason || "").replaceAll("_", " ")}</strong><small>{(item.evidence || []).join(" · ") || "—"}</small></td>
                <td>{item.suggestions?.[0] ? <><strong>{item.suggestions[0].value}</strong><small>{Math.round(item.suggestions[0].confidence * 100)}%</small></> : "—"}</td>
                <td>{item.contextExamples?.[0] || <span title="Current corpus records do not retain sentence context">Unavailable</span>}</td>
                <td><div className="sett_corpus_sanitizer_actions">
                  <button title="Approve as valid" onClick={() => review(item, "APPROVED")}><i className="fi fi-rr-check" /></button>
                  <button title="Mark as nonsense" onClick={() => review(item, "NONSENSE")}><i className="fi fi-rr-cross" /></button>
                  <button title="Correct derived corpus token" onClick={() => correct(item)}><i className="fi fi-rr-pencil" /></button>
                  <button title="Add to dictionary" onClick={() => review(item, "APPROVED")}><i className="fi fi-rr-book-plus" /></button>
                  <button title="Add as abbreviation" onClick={() => review(item, "ABBREVIATION")}><i className="fi fi-rr-text" /></button>
                  <button title="Ignore for now" onClick={() => review(item, "IGNORED")}><i className="fi fi-rr-eye-crossed" /></button>
                </div></td>
              </tr>
            )) : <tr><td colSpan="8" className="sett_corpus_empty">{records.length ? "No tokens match this status." : "Run the sanitizer to classify the current corpus."}</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
};

export default CorpusSanitizerPanel;
