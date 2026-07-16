import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./medicalExams.css";
import { apiUrl } from "../config/api";
import { readStoredSession } from "../utils/sessionCleanup";

// ── Helpers ───────────────────────────────────────────────────────────────────

const authHeaders = () => {
  const session = readStoredSession();
  return session?.token ? { Authorization: `Bearer ${session.token}` } : {};
};

const jsonHeaders = () => ({ "Content-Type": "application/json", ...authHeaders() });

const uid = () => Math.random().toString(36).slice(2, 10);

const formatDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
};

const spanProgress = (span) => {
  const total = Math.max(0, span.toPage - span.fromPage + 1);
  const done = (span.completedPages || []).filter((p) => p >= span.fromPage && p <= span.toPage).length;
  return { done, total };
};

const DEFAULT_FORM = { name: "", country: "", objectives: "", examDate: "" };

// ── Component ─────────────────────────────────────────────────────────────────

export default function MedicalExamsPage() {
  const navigate = useNavigate();

  const [exams, setExams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [createError, setCreateError] = useState("");

  const [expandedId, setExpandedId] = useState(null);
  const [hyleSources, setHyleSources] = useState([]);
  const [selectedSourceId, setSelectedSourceId] = useState("");

  const [spanDrafts, setSpanDrafts] = useState({}); // examSourceId -> { label, fromPage, toPage }
  const [expandedSpanId, setExpandedSpanId] = useState(null);

  // ── Load ──────────────────────────────────────────────────────────────────

  const fetchExams = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(apiUrl("/api/medical-exams"), { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      setExams(data.exams || []);
    } catch { /* ignore transient network errors */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchExams(); }, [fetchExams]);

  useEffect(() => {
    fetch(apiUrl("/api/sources"), { headers: authHeaders() })
      .then((r) => r.json())
      .then((data) => setHyleSources((data.sources || []).filter((s) => s.type !== "youtube")))
      .catch(() => setHyleSources([]));
  }, []);

  // ── Create exam ───────────────────────────────────────────────────────────

  const createExam = async () => {
    setCreateError("");
    if (!form.name.trim()) { setCreateError("Exam name is required."); return; }
    try {
      const res = await fetch(apiUrl("/api/medical-exams"), {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) { setCreateError(data.error || "Failed to create exam."); return; }
      setExams((prev) => [...prev, data]);
      setForm(DEFAULT_FORM);
    } catch {
      setCreateError("Failed to reach the server.");
    }
  };

  const deleteExam = async (id) => {
    try {
      const res = await fetch(apiUrl(`/api/medical-exams/${id}`), { method: "DELETE", headers: authHeaders() });
      if (res.ok) {
        setExams((prev) => prev.filter((e) => e.id !== id));
        if (expandedId === id) setExpandedId(null);
      }
    } catch { /* ignore */ }
  };

  // ── Mutations (whole-`sources`-array PATCH, per the API's design) ─────────

  const patchExam = async (examId, patch) => {
    try {
      const res = await fetch(apiUrl(`/api/medical-exams/${examId}`), {
        method: "PATCH",
        headers: jsonHeaders(),
        body: JSON.stringify(patch),
      });
      if (!res.ok) return null;
      const updated = await res.json();
      setExams((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
      return updated;
    } catch {
      return null;
    }
  };

  const addSource = async (exam) => {
    const source = hyleSources.find((s) => s._id === selectedSourceId);
    if (!source) return;
    const nextSources = [...exam.sources, { id: uid(), sourceId: source._id, name: source.name, pageSpans: [] }];
    await patchExam(exam.id, { sources: nextSources });
    setSelectedSourceId("");
  };

  const removeSource = async (exam, examSourceId) => {
    await patchExam(exam.id, { sources: exam.sources.filter((s) => s.id !== examSourceId) });
  };

  const addSpan = async (exam, examSourceId) => {
    const draft = spanDrafts[examSourceId] || {};
    const fromPage = Math.max(1, parseInt(draft.fromPage, 10) || 1);
    const toPage = Math.max(fromPage, parseInt(draft.toPage, 10) || fromPage);
    const nextSources = exam.sources.map((s) => (
      s.id === examSourceId
        ? { ...s, pageSpans: [...s.pageSpans, { id: uid(), label: (draft.label || "").trim(), fromPage, toPage, completedPages: [] }] }
        : s
    ));
    await patchExam(exam.id, { sources: nextSources });
    setSpanDrafts((prev) => ({ ...prev, [examSourceId]: { label: "", fromPage: "", toPage: "" } }));
  };

  const removeSpan = async (exam, examSourceId, spanId) => {
    const nextSources = exam.sources.map((s) => (
      s.id === examSourceId ? { ...s, pageSpans: s.pageSpans.filter((sp) => sp.id !== spanId) } : s
    ));
    await patchExam(exam.id, { sources: nextSources });
  };

  const togglePageDone = async (exam, examSourceId, spanId, page) => {
    const nextSources = exam.sources.map((s) => {
      if (s.id !== examSourceId) return s;
      return {
        ...s,
        pageSpans: s.pageSpans.map((sp) => {
          if (sp.id !== spanId) return sp;
          const has = sp.completedPages.includes(page);
          return { ...sp, completedPages: has ? sp.completedPages.filter((p) => p !== page) : [...sp.completedPages, page] };
        }),
      };
    });
    await patchExam(exam.id, { sources: nextSources });
  };

  const openPage = (examSource, page) => {
    navigate("/pdf-reader", { state: { sourceId: examSource.sourceId, pdfName: examSource.name, page } });
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div id="mex_root">
      <div id="mex_header">
        <button id="mex_back" onClick={() => navigate("/home")} title="Back">
          <i className="fi fi-rr-arrow-left" />
        </button>
        <div id="mex_header_titles">
          <span id="mex_title">Medical Exams</span>
          <span id="mex_subtitle">Track exams, their sources, and reading progress</span>
        </div>
        <span className="mex_count_badge">{exams.length} exam{exams.length !== 1 ? "s" : ""}</span>
      </div>

      <div id="mex_body">
        {/* ── Add exam form ── */}
        <div id="mex_add_panel">
          <span className="mex_panel_label"><i className="fi fi-rr-add-document" /> Add Exam</span>
          <div className="mex_field_row">
            <div className="mex_field mex_field--grow">
              <label className="mex_label">Exam Name</label>
              <input className="mex_input" placeholder="e.g. USMLE Step 2 CK" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="mex_field">
              <label className="mex_label">Exam Country</label>
              <input className="mex_input" placeholder="e.g. USA" value={form.country} onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))} />
            </div>
            <div className="mex_field">
              <label className="mex_label">Exam Date</label>
              <input type="date" className="mex_input" value={form.examDate} onChange={(e) => setForm((f) => ({ ...f, examDate: e.target.value }))} />
            </div>
          </div>
          <div className="mex_field">
            <label className="mex_label">Exam Objectives</label>
            <textarea className="mex_textarea" rows={2} placeholder="What this exam covers / your goals for it…" value={form.objectives} onChange={(e) => setForm((f) => ({ ...f, objectives: e.target.value }))} />
          </div>
          {createError && <p className="mex_error">{createError}</p>}
          <div className="mex_form_actions">
            <button className="mex_btn mex_btn--primary" onClick={createExam} disabled={!form.name.trim()}>
              <i className="fi fi-rr-plus" /> Add Exam
            </button>
          </div>
        </div>

        {/* ── Exams table ── */}
        <div id="mex_table_wrap">
          {loading ? (
            <p className="mex_empty_hint">Loading…</p>
          ) : exams.length === 0 ? (
            <div className="mex_empty">
              <i className="fi fi-rr-graduation-cap" />
              <p>No exams yet</p>
              <p className="mex_empty_hint">Add one above to start tracking sources and progress</p>
            </div>
          ) : (
            <table id="mex_table">
              <thead>
                <tr>
                  <th></th>
                  <th>Name</th>
                  <th>Country</th>
                  <th>Date</th>
                  <th>Sources</th>
                  <th>Objectives</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {exams.map((exam) => {
                  const isOpen = expandedId === exam.id;
                  return (
                    <React.Fragment key={exam.id}>
                      <tr className={`mex_row${isOpen ? " mex_row--active" : ""}`} onClick={() => setExpandedId(isOpen ? null : exam.id)}>
                        <td className="mex_expand_cell"><i className={`fi ${isOpen ? "fi-rr-angle-down" : "fi-rr-angle-right"}`} /></td>
                        <td className="mex_name_cell">{exam.name}</td>
                        <td>{exam.country || "—"}</td>
                        <td>{formatDate(exam.examDate)}</td>
                        <td>{exam.sources.length}</td>
                        <td className="mex_objectives_cell">{exam.objectives || "—"}</td>
                        <td>
                          <button className="mex_del_btn" onClick={(e) => { e.stopPropagation(); deleteExam(exam.id); }} title="Delete exam">
                            <i className="fi fi-rr-trash" />
                          </button>
                        </td>
                      </tr>

                      {isOpen && (
                        <tr className="mex_detail_row">
                          <td colSpan={7}>
                            <div className="mex_detail">
                              {/* Add source */}
                              <div className="mex_add_source_row">
                                <select
                                  className="mex_select"
                                  value={selectedSourceId}
                                  onChange={(e) => setSelectedSourceId(e.target.value)}
                                >
                                  <option value="">Select a Hyle source to add…</option>
                                  {hyleSources
                                    .filter((s) => !exam.sources.some((es) => es.sourceId === s._id))
                                    .map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
                                </select>
                                <button className="mex_btn mex_btn--sm" onClick={() => addSource(exam)} disabled={!selectedSourceId}>
                                  <i className="fi fi-rr-plus" /> Add Source
                                </button>
                              </div>

                              {exam.sources.length === 0 ? (
                                <p className="mex_empty_hint">No sources added yet.</p>
                              ) : exam.sources.map((es) => (
                                <div key={es.id} className="mex_source_card">
                                  <div className="mex_source_head">
                                    <span className="mex_source_name"><i className="fi fi-rr-file-pdf" /> {es.name}</span>
                                    <button className="mex_del_btn" onClick={() => removeSource(exam, es.id)} title="Remove source">
                                      <i className="fi fi-rr-cross-small" />
                                    </button>
                                  </div>

                                  {/* Add page span */}
                                  <div className="mex_add_span_row">
                                    <input
                                      className="mex_input mex_input--sm mex_input--grow"
                                      placeholder="Span label (optional), e.g. Chapter 3: Arrhythmias"
                                      value={spanDrafts[es.id]?.label || ""}
                                      onChange={(e) => setSpanDrafts((prev) => ({ ...prev, [es.id]: { ...prev[es.id], label: e.target.value } }))}
                                    />
                                    <input
                                      type="number" min={1} className="mex_input mex_input--sm mex_input--num"
                                      placeholder="From"
                                      value={spanDrafts[es.id]?.fromPage || ""}
                                      onChange={(e) => setSpanDrafts((prev) => ({ ...prev, [es.id]: { ...prev[es.id], fromPage: e.target.value } }))}
                                    />
                                    <input
                                      type="number" min={1} className="mex_input mex_input--sm mex_input--num"
                                      placeholder="To"
                                      value={spanDrafts[es.id]?.toPage || ""}
                                      onChange={(e) => setSpanDrafts((prev) => ({ ...prev, [es.id]: { ...prev[es.id], toPage: e.target.value } }))}
                                    />
                                    <button
                                      className="mex_btn mex_btn--sm"
                                      onClick={() => addSpan(exam, es.id)}
                                      disabled={!spanDrafts[es.id]?.fromPage || !spanDrafts[es.id]?.toPage}
                                    >
                                      <i className="fi fi-rr-plus" /> Add Span
                                    </button>
                                  </div>

                                  {es.pageSpans.length === 0 ? (
                                    <p className="mex_empty_hint">No page spans yet.</p>
                                  ) : es.pageSpans.map((span) => {
                                    const { done, total } = spanProgress(span);
                                    const spanKey = `${es.id}:${span.id}`;
                                    const isSpanOpen = expandedSpanId === spanKey;
                                    const pages = Array.from({ length: span.toPage - span.fromPage + 1 }, (_, i) => span.fromPage + i);
                                    return (
                                      <div key={span.id} className="mex_span_card">
                                        <div className="mex_span_head" onClick={() => setExpandedSpanId(isSpanOpen ? null : spanKey)}>
                                          <i className={`fi ${isSpanOpen ? "fi-rr-angle-down" : "fi-rr-angle-right"}`} />
                                          <span className="mex_span_label">{span.label || `Pages ${span.fromPage}–${span.toPage}`}</span>
                                          <span className="mex_span_range">p.{span.fromPage}–{span.toPage}</span>
                                          <span className="mex_span_progress">{done}/{total} done</span>
                                          <button className="mex_del_btn" onClick={(e) => { e.stopPropagation(); removeSpan(exam, es.id, span.id); }} title="Delete span">
                                            <i className="fi fi-rr-trash" />
                                          </button>
                                        </div>
                                        {isSpanOpen && (
                                          <div className="mex_page_grid">
                                            {pages.map((p) => {
                                              const done_ = span.completedPages.includes(p);
                                              return (
                                                <div key={p} className={`mex_page_chip${done_ ? " mex_page_chip--done" : ""}`}>
                                                  <button
                                                    className="mex_page_chip_check"
                                                    onClick={(e) => { e.stopPropagation(); togglePageDone(exam, es.id, span.id, p); }}
                                                    title={done_ ? "Mark unfinished" : "Mark finished"}
                                                  >
                                                    <i className={`fi ${done_ ? "fi-sr-checkbox" : "fi-rr-square"}`} />
                                                  </button>
                                                  <button
                                                    className="mex_page_chip_num"
                                                    onClick={() => openPage(es, p)}
                                                    title={`Open page ${p} in the PDF Reader`}
                                                  >
                                                    {p}
                                                  </button>
                                                </div>
                                              );
                                            })}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
