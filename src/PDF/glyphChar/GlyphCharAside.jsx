import React, { useEffect, useMemo, useState } from "react";
import "./glyphChar.css";
import { downloadGlyphCharPageReport } from "./glyphCharAnalysisClient.js";
import { finalPredictionCharacter } from "./glyphCharComparison.js";
import { deriveGlyphCharCounters, glyphResultState } from "./glyphCharCounters.js";

const FILTERS = [
  ["ALL", "All"], ["MATCH", "Predicted / match"], ["DISAGREEMENT", "Disagreements"],
  ["AMBIGUOUS", "Ambiguous"], ["UNPREDICTABLE", "Unpredictable"], ["UNAVAILABLE", "Unavailable"],
  ["OPEN_SET_UNCERTAIN", "Open-set uncertain"], ["OUT_OF_VOCABULARY", "Out of vocabulary"],
  ["UNRESOLVED", "Unresolved"], ["NO_GIVEN_CHAR", "No Given"], ["NO_VISIBLE_GLYPH", "No visible glyph"],
  ["OBSERVE_ONLY", "Observe only"], ["REVIEW_REQUIRED", "Review required"], ["ELIGIBLE_WITH_PROVENANCE", "Eligible"], ["HUMAN_ASSERTED", "Human asserted"],
];
const stateSymbol = (state) => ({ MATCH: "✓", DISAGREEMENT: "⚠", AMBIGUOUS: "?", NO_GIVEN_CHAR: "—", NO_VISIBLE_GLYPH: "∅", UNPREDICTABLE: "×", UNAVAILABLE: "∅", OPEN_SET_UNCERTAIN: "?", OUT_OF_VOCABULARY: "∅", UNRESOLVED: "?", MULTI_CHAR_GLYPH: "≠" }[state] || "·");
const shownChar = (value) => value === " " ? "SPACE" : value == null || value === "" ? "∅" : value;
const pct = (value) => `${(Math.max(0, Number(value) || 0) * 100).toFixed(1)}%`;
const predictionMetric = (prediction) => prediction?.confidence ?? prediction?.modelScore;
const glyphPrediction = (glyph) => glyph?.prediction
  || glyph?.visualEvidence?.raster?.recognition
  || glyph?.visualEvidence?.raster?.prediction
  || glyph?.visualEvidence?.vector?.prediction
  || glyph?.visualEvidence?.vector?.recognition
  || null;
const predictionCharacter = (prediction) => finalPredictionCharacter(prediction);
const glyphComparison = (glyph) => {
  return glyphResultState(glyph);
};
const CV_STAGE_LABELS = [
  ["rendered", "Rendered crop"],
  ["blurred", "Gaussian blur"],
  ["threshold", "Otsu threshold"],
  ["tight", "Tight crop"],
  ["normalized", "96×96 normalized"],
  ["contours", "Detected contours"],
];

const EvidenceCandidates = ({ prediction }) => prediction?.candidates?.length > 0 && (
  <div className="glyph_visual_candidates">
    <h5>Model candidates</h5>
    {prediction.candidates.map((candidate) => {
      const character = candidate.char ?? candidate.value;
      const score = candidate.probability ?? candidate.modelScore ?? candidate.confidence;
      return <div key={character}><b>{shownChar(character)}</b><span>{pct(score)}</span></div>;
    })}
  </div>
);

const RecognitionPanel = ({ title, prediction }) => (
  <section className="glyph_character_recognition">
    <header><small>Character recognition · {prediction?.modelName || "model unavailable"} {prediction?.modelVersion || ""}</small><h5>{title}</h5></header>
    <div className="glyph_visual_prediction">
      <small>{prediction?.openSetAssessment?.status === "IN_VOCABULARY" ? title : "Final evidence status"}</small><strong>{shownChar(predictionCharacter(prediction))}</strong>
      <span>{predictionMetric(prediction) != null
        ? `${prediction.probabilitiesCalibrated ? "Model confidence" : "Model score"} · ${pct(predictionMetric(prediction))}`
        : "Unavailable"}</span>
    </div>
    <dl className="glyph_visual_morphology">
      <dt>Closed-set top candidate</dt><dd>{shownChar(prediction?.closedSetTopCandidate)}</dd>
      <dt>Open-set assessment</dt><dd>{prediction?.openSetAssessment?.status || "UNAVAILABLE"}</dd>
    </dl>
    <EvidenceCandidates prediction={prediction} />
  </section>
);

const MorphologyRows = ({ morphology, keys }) => (
  <dl className="glyph_visual_morphology">
    {keys.map(([key, label]) => morphology?.[key] != null && <React.Fragment key={key}><dt>{label}</dt><dd>{String(morphology[key])}</dd></React.Fragment>)}
  </dl>
);

const MetricCard = ({ title, children, tone = "neutral" }) => (
  <article className={`glyph_metric_card glyph_metric_card--${tone}`}>
    <h4>{title}</h4>
    {children}
  </article>
);

const GlyphResultList = ({ glyphs, selectedId, onSelect, showPageNumber = true }) => {
  const rowHeight = 46;
  const [scrollTop, setScrollTop] = useState(0);
  const viewportHeight = 300;
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - 4);
  const end = Math.min(glyphs.length, start + Math.ceil(viewportHeight / rowHeight) + 8);
  return (
    <div className="glyph_char_results" style={{ height: viewportHeight }} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
      <div className="glyph_char_results_spacer" style={{ height: glyphs.length * rowHeight }}>
        {glyphs.slice(start, end).map((glyph, offset) => (
          <button
            type="button"
            key={glyph.id}
            className={`glyph_char_result glyph_char_result--${String(glyphComparison(glyph) || "pending").toLowerCase()}${glyph.id === selectedId ? " is-selected" : ""}`}
            style={{ top: (start + offset) * rowHeight, height: rowHeight }}
            onClick={() => onSelect(glyph)}
          >
            <span className="glyph_char_result_state">{stateSymbol(glyphComparison(glyph))}</span>
            <span className="glyph_char_result_pair">{shownChar(glyph.given.value)} <i>→</i> {shownChar(finalPredictionCharacter(glyph.visualEvidence?.raster?.prediction || glyph.prediction))}</span>
            <span className="glyph_char_result_meta">{showPageNumber ? `p.${glyph.pageNumber} · ` : ""}{glyphComparison(glyph)}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

const GlyphCharAside = ({ analysis, currentPage, onClose, onStartAnalysis, onResultsDeleted, onSelectGlyph }) => {
  const [scope, setScope] = useState("document");
  const [filter, setFilter] = useState("ALL");
  const [confirmedChar, setConfirmedChar] = useState("");
  const [trainingState, setTrainingState] = useState({ status: "idle", message: "" });
  const [reportOpen, setReportOpen] = useState(false);
  const [reportOptions, setReportOptions] = useState({ profile: "standard", includeDebug: false, includeImages: false, imageProfile: "diagnostic" });
  const [reportState, setReportState] = useState({ status: "idle", message: "" });
  const { glyphs, selectedGlyph, status, error, progress, cacheDiagnostics } = analysis;
  const scopedGlyphs = useMemo(
    () => scope === "page"
      ? glyphs.filter((glyph) => glyph.pageNumber === currentPage)
      : glyphs,
    [currentPage, glyphs, scope],
  );
  // PDF text traces contain whitespace entries, but whitespace is not a
  // visible glyph and is not part of the recognizer vocabulary. Keep it out
  // of the comparison result buckets so it cannot appear as a false
  // predicted character such as SPACE.
  const comparableGlyphs = useMemo(
    () => scopedGlyphs.filter((glyph) => glyph.visible !== false),
    [scopedGlyphs],
  );
  const isPageScope = scope === "page";
  const summary = useMemo(() => {
    const counts = deriveGlyphCharCounters(scopedGlyphs);
    const liveAllDocumentInstances = !isPageScope && status === "analyzing"
      ? Math.max(scopedGlyphs.length, Number(progress.instancesEvaluated || 0))
      : scopedGlyphs.length;
    const liveAllDocumentStudied = !isPageScope && status === "analyzing"
      ? Math.max(scopedGlyphs.filter((glyph) => glyph.analysisStatus === "studied" || glyph.analysisStatus === "failed").length, Number(progress.instancesEvaluated || 0))
      : scopedGlyphs.filter((glyph) => glyph.analysisStatus === "studied" || glyph.analysisStatus === "failed").length;
    return {
      counts,
      // Studied means that an evidence record was completed. It does not
      // imply that a usable character prediction exists.
      studied: liveAllDocumentStudied,
      instances: liveAllDocumentInstances,
      unique: new Set(scopedGlyphs.map((glyph) => glyph.definitionCacheKey || glyph.resolvedCacheKey).filter(Boolean)).size,
    };
  }, [comparableGlyphs, isPageScope, progress.instancesEvaluated, scopedGlyphs, status]);
  const filtered = useMemo(() => {
    if (filter === "ALL") return comparableGlyphs;
    if (["OBSERVE_ONLY", "REVIEW_REQUIRED", "ELIGIBLE_WITH_PROVENANCE", "HUMAN_ASSERTED"].includes(filter)) {
      return comparableGlyphs.filter((glyph) => (glyph.admissionDecision?.state || "OBSERVE_ONLY") === filter);
    }
    if (filter === "UNRESOLVED") return comparableGlyphs.filter((glyph) => ["UNPREDICTABLE", "UNAVAILABLE", "OPEN_SET_UNCERTAIN", "OUT_OF_VOCABULARY"].includes(glyphComparison(glyph)));
    return comparableGlyphs.filter((glyph) => glyphComparison(glyph) === filter);
  }, [comparableGlyphs, filter]);
  const pageIsActive = Number(progress.activePage) === Number(currentPage);
  const pageIsRequested = Number(progress.requestedPage) === Number(currentPage);
  const pageHasCompletedCheckpoint = Number(progress.pageProgressPage) === Number(currentPage) && Boolean(progress.pageComplete);
  const pageEvidenceState = scopedGlyphs.length > 0
    ? summary.studied >= scopedGlyphs.length ? "ready" : "processing"
    : pageHasCompletedCheckpoint ? "ready"
    : pageIsActive ? "processing" : status === "analyzing" || pageIsRequested ? "waiting" : "empty";
  const showStartControl = isPageScope
    ? !scopedGlyphs.length && !pageHasCompletedCheckpoint && !pageIsActive && !pageIsRequested
    : ["idle", "saved", "failed", "cancelled"].includes(status);
  const visibleSelectedGlyph = scope === "page" && selectedGlyph?.pageNumber !== currentPage ? null : selectedGlyph;
  const vectorEvidence = visibleSelectedGlyph?.visualEvidence?.vector || null;
  const rasterEvidence = visibleSelectedGlyph?.visualEvidence?.raster || null;
  const vectorPrediction = vectorEvidence?.prediction || null;
  const rasterPrediction = rasterEvidence?.prediction || rasterEvidence?.recognition || glyphPrediction(visibleSelectedGlyph) || null;
  const cvStages = rasterEvidence?.stages || null;
  const comparisonState = visibleSelectedGlyph?.evidenceComparison?.state || visibleSelectedGlyph?.comparison || "UNRESOLVED";
  const admission = visibleSelectedGlyph?.admissionDecision;
  const validation = visibleSelectedGlyph?.validationProvenance;
  const typographic = rasterEvidence?.typographicEvidence || vectorEvidence?.typographicEvidence || {};
  useEffect(() => {
    setConfirmedChar("");
    setTrainingState({ status: "idle", message: "" });
  }, [visibleSelectedGlyph?.id]);
  const trainSelectedGlyph = async () => {
    const label = confirmedChar.normalize("NFC");
    if (Array.from(label).length !== 1 || /\s/u.test(label)) {
      setTrainingState({ status: "error", message: "Enter exactly one visible character." });
      return;
    }
    setTrainingState({ status: "saving", message: "Saving explicit training evidence…" });
    try {
      const result = await analysis.trainSelectedGlyph(label);
      setTrainingState({ status: "saved", message: `Human-confirmed label stored. Added to the human-confirmed training dataset · ${result.sampleCount} sample${result.sampleCount === 1 ? "" : "s"}.` });
    } catch (trainingError) {
      setTrainingState({ status: "error", message: trainingError.message || "Human confirmation could not be stored." });
    }
  };
  const deleteAllResults = async () => {
    if (!window.confirm("Permanently delete all saved Glyph → Char analysis results for this document?")) return;
    try {
      await analysis.deleteAllResults();
      onResultsDeleted?.();
    } catch {
      // The hook exposes the API failure in the panel's existing error area.
    }
  };
  const saveDownload = ({ blob, filename }) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  };
  const generateReport = async (confirmLarge = false) => {
    if (!analysis.jobId) return;
    setReportState({ status: "generating", message: "Loading every persisted glyph on this page…" });
    const selectedGlyphInstanceId = selectedGlyph?.pageNumber === currentPage
      ? selectedGlyph.serverGlyphId || String(selectedGlyph.id || "").split(":").slice(-2).join(":")
      : null;
    try {
      if (reportOptions.includeImages) {
        const bundle = await downloadGlyphCharPageReport(analysis.jobId, {
          pageNumber: currentPage,
          format: "bundle",
          profile: reportOptions.profile,
          includeDebug: reportOptions.includeDebug,
          includeImages: true,
          imageProfile: reportOptions.imageProfile,
          selectedGlyphInstanceId,
          confirmLarge,
        });
        saveDownload(bundle);
        setReportState({ status: "complete", message: `${bundle.reportStatus || "Layer 1"} ZIP downloaded · ${bundle.glyphCount?.toLocaleString() || "all"} persisted glyphs.` });
      } else {
        const common = {
          pageNumber: currentPage,
          profile: reportOptions.profile,
          includeDebug: reportOptions.includeDebug,
          selectedGlyphInstanceId,
        };
        const json = await downloadGlyphCharPageReport(analysis.jobId, { ...common, format: "json" });
        const markdown = await downloadGlyphCharPageReport(analysis.jobId, { ...common, format: "markdown" });
        saveDownload(json);
        saveDownload(markdown);
        setReportState({ status: "complete", message: `${json.reportStatus || "Layer 1"} JSON + Markdown downloaded · ${json.glyphCount?.toLocaleString() || "all"} persisted glyphs.` });
      }
    } catch (reportError) {
      if (reportError.code === "LARGE_REPORT_CONFIRMATION_REQUIRED"
          && window.confirm(`${reportError.message}\n\nGenerate the complete forensic image bundle anyway?`)) {
        await generateReport(true);
        return;
      }
      setReportState({ status: "error", message: reportError.message || "The Layer 1 report could not be generated." });
    }
  };
  return (
    <aside id="glyph_char_aside" aria-label="GLYPH to CHAR evidence layer">
      <header className="glyph_char_header">
        <div className="glyph_char_header_inner">
        <div className="glyph_char_header_identity">
          <small>LAYER 1</small>
          <h2>GLYPH <span>→</span> CHAR</h2>
        </div>
        <div className="glyph_char_header_tags">
          <div className="glyph_char_header_action_stack">
            <div className="glyph_char_header_status_row">
              <span className={`glyph_char_status glyph_char_status--${status}`}>{status}</span>
              <label className="glyph_char_scope_select_label">
                <span className="sr-only">Analysis scope</span>
                <select className="glyph_char_scope_select" value={scope} onChange={(event) => setScope(event.target.value)} aria-label="Analysis scope">
                  <option value="document">All document</option>
                  <option value="page">Page {currentPage}</option>
                </select>
              </label>
              {onClose && <button type="button" className="glyph_char_close" onClick={onClose} aria-label="Return to PDF reader" title="Return to PDF reader"><i className="bx bx-x" aria-hidden="true" /></button>}
            </div>
            <div className="glyph_char_header_analysis_row">
              {showStartControl && <button
                type="button"
                className="glyph_char_start_button"
                onClick={() => onStartAnalysis?.(isPageScope
                  ? { scope: "page", pageNumber: currentPage }
                  : { scope: "document" })}
              >
                <i className="bx bx-play" aria-hidden="true" />
                <span>{isPageScope
                  ? `Page ${currentPage} Analysis`
                  : status === "failed" ? "Retry Document Analysis"
                    : status === "cancelled" ? "Resume Document Analysis"
                    : "Document Analysis"}</span>
              </button>}
              <button
                type="button"
                className="glyph_char_report_trigger"
                onClick={() => { setReportOpen(true); setReportState({ status: "idle", message: "" }); }}
                disabled={!analysis.canGenerateReport}
                aria-label="Generate Layer 1 report"
              >
                <i className="bx bx-file" aria-hidden="true" />
                <span>Generate Report</span>
              </button>
            </div>
          </div>
        </div>
        </div>
      </header>

      {reportOpen && (
        <section className="glyph_char_report_dialog" role="dialog" aria-modal="false" aria-labelledby="glyph_char_report_title">
          <header>
            <div><small>LAYER 1 EXPORT</small><h3 id="glyph_char_report_title">Generate Report</h3></div>
            <button type="button" onClick={() => setReportOpen(false)} aria-label="Close report options"><i className="bx bx-x" aria-hidden="true" /></button>
          </header>
          <fieldset>
            <legend>Format</legend>
            <label><input type="radio" checked readOnly /> <span>JSON + Markdown</span></label>
          </fieldset>
          <fieldset>
            <legend>Report Profile</legend>
            <label><input type="radio" name="glyph-report-profile" checked={reportOptions.profile === "standard"} onChange={() => setReportOptions((current) => ({ ...current, profile: "standard" }))} /> <span>Standard</span></label>
            <label><input type="radio" name="glyph-report-profile" checked={reportOptions.profile === "forensic"} onChange={() => setReportOptions((current) => ({ ...current, profile: "forensic" }))} /> <span>Forensic</span></label>
          </fieldset>
          <fieldset>
            <legend>Evidence Options</legend>
            <label><input type="checkbox" checked={reportOptions.includeDebug} onChange={(event) => setReportOptions((current) => ({ ...current, includeDebug: event.target.checked }))} /> <span>Include Debug Evidence</span></label>
            <label><input type="checkbox" checked={reportOptions.includeImages} onChange={(event) => setReportOptions((current) => ({ ...current, includeImages: event.target.checked }))} /> <span>Include Glyph Images (.zip)</span></label>
          </fieldset>
          {reportOptions.includeImages && (
            <fieldset>
              <legend>Image Export</legend>
              <label><input type="radio" name="glyph-image-profile" checked={reportOptions.imageProfile === "diagnostic"} onChange={() => setReportOptions((current) => ({ ...current, imageProfile: "diagnostic" }))} /> <span>Diagnostic</span></label>
              <label><input type="radio" name="glyph-image-profile" checked={reportOptions.imageProfile === "complete"} onChange={() => setReportOptions((current) => ({ ...current, imageProfile: "complete" }))} /> <span>Complete Forensic</span></label>
              <small>Diagnostic includes failures, disagreement, ambiguity, open-set review, Human evidence, and the selected glyph. Complete Forensic includes every available visible glyph artifact and may be large.</small>
            </fieldset>
          )}
          <dl>
            <dt>Scope</dt><dd>Current Page · {currentPage}</dd>
            <dt>Completeness</dt><dd>{pageEvidenceState === "ready" ? "Expected complete" : "Will be marked PARTIAL"}</dd>
          </dl>
          {pageEvidenceState !== "ready" && <p className="glyph_char_report_warning">The backend will export only persisted evidence and explicitly mark the report PARTIAL. It will not pretend the running analysis is complete.</p>}
          <button type="button" className="glyph_char_report_generate" onClick={() => generateReport(false)} disabled={reportState.status === "generating"}>
            {reportState.status === "generating" ? "Generating…" : reportOptions.includeImages ? "Generate ZIP Report" : "Download JSON + Markdown"}
          </button>
          {reportState.message && <p className={`glyph_char_report_message glyph_char_report_message--${reportState.status}`}>{reportState.message}</p>}
        </section>
      )}


      {analysis.canCancelAnalysis && (
        <div className="glyph_char_cancel">
          <button
            type="button"
            onClick={() => analysis.cancelAnalysis?.().catch(() => {})}
            disabled={status === "canceling"}
          >
            {status === "canceling" ? "Aborting…" : "Abort analysis"}
          </button>
          <small>Stops queued or ongoing work. Saved page results are retained.</small>
        </div>
      )}

      <div className="glyph_char_detection_layout">
      <section className={`glyph_char_summary glyph_char_summary--${scope}`} aria-label={isPageScope ? `Page ${currentPage} glyph analysis` : "Document glyph analysis"}>
        <h3>
          <span>{isPageScope ? `Page ${currentPage} analysis` : "All-document analysis"}</span>
          {isPageScope && <span className={`glyph_char_page_state glyph_char_page_state--${pageEvidenceState}`}>{pageEvidenceState}</span>}
        </h3>
        <div className="glyph_metric_cards">
          <MetricCard title="GLYPH INSTANCES" tone="blue"><dl>
            <dt>Glyph instances</dt><dd>{summary.instances.toLocaleString()}</dd><dt>Unique glyph definitions</dt><dd>{summary.unique.toLocaleString()}</dd><dt>Studied</dt><dd>{summary.studied.toLocaleString()}</dd><dt>Displayed rows</dt><dd>{filtered.length.toLocaleString()}</dd><dt>Non-row instances</dt><dd>{Math.max(0, summary.instances - filtered.length).toLocaleString()}</dd>
          </dl></MetricCard>
          <MetricCard title="RASTER RECOGNITION" tone="green"><dl><dt>Predicted</dt><dd>{summary.counts.raster.predicted}</dd><dt>Ambiguous</dt><dd>{summary.counts.raster.ambiguous}</dd><dt>Unpredictable</dt><dd>{summary.counts.raster.unpredictable}</dd><dt>Unavailable</dt><dd>{summary.counts.raster.unavailable}</dd></dl></MetricCard>
          <MetricCard title="VECTOR RECOGNITION" tone="blue"><dl><dt>Predicted</dt><dd>{summary.counts.vector.predicted}</dd><dt>Ambiguous</dt><dd>{summary.counts.vector.ambiguous}</dd><dt>Unpredictable</dt><dd>{summary.counts.vector.unpredictable}</dd><dt>Unavailable</dt><dd>{summary.counts.vector.unavailable}</dd></dl></MetricCard>
          <MetricCard title="MORPHOLOGY AVAILABILITY" tone="purple"><dl><dt>Raster available</dt><dd>{summary.counts.morphology.rasterAvailable}</dd><dt>Raster unavailable</dt><dd>{summary.counts.morphology.rasterUnavailable}</dd><dt>Vector available</dt><dd>{summary.counts.morphology.vectorAvailable}</dd><dt>Vector unavailable</dt><dd>{summary.counts.morphology.vectorUnavailable}</dd></dl></MetricCard>
          <MetricCard title="OPEN-SET ASSESSMENT" tone="amber"><dl><dt>In vocabulary</dt><dd>{summary.counts.openSet.inVocabulary}</dd><dt>Out of vocabulary</dt><dd>{summary.counts.openSet.outOfVocabulary}</dd><dt>Open-set uncertain</dt><dd>{summary.counts.openSet.uncertain}</dd><dt>Unavailable</dt><dd>{summary.counts.openSet.unavailable}</dd></dl></MetricCard>
          <MetricCard title="EVIDENCE COMPARISON" tone="amber"><dl><dt>Full agreement</dt><dd>{summary.counts.evidenceComparison.fullAgreement}</dd><dt>PDF mapping disagreement</dt><dd>{summary.counts.evidenceComparison.pdfMappingDisagreement}</dd><dt>Vector/Raster disagreement</dt><dd>{summary.counts.evidenceComparison.vectorRasterDisagreement}</dd><dt>Unresolved</dt><dd>{summary.counts.evidenceComparison.unresolved}</dd><dt>No Given Char</dt><dd>{summary.counts.evidenceComparison.noGivenChar}</dd><dt>No visible glyph</dt><dd>{summary.counts.evidenceComparison.noVisibleGlyph}</dd></dl></MetricCard>
          <MetricCard title="LAYER 1 ADMISSION" tone="purple"><dl><dt>Eligible with provenance</dt><dd>{summary.counts.admission.ELIGIBLE_WITH_PROVENANCE}</dd><dt>Review required</dt><dd>{summary.counts.admission.REVIEW_REQUIRED}</dd><dt>Observe only</dt><dd>{summary.counts.admission.OBSERVE_ONLY}</dd><dt>Human asserted</dt><dd>{summary.counts.admission.HUMAN_ASSERTED}</dd></dl></MetricCard>
        </div>
        {!isPageScope && status === "analyzing" && (
          <div className="glyph_char_progress">
            <span>Analyzing complete document…</span>
            <strong>{progress.instancesEvaluated.toLocaleString()} evaluated · {progress.pagesCompleted}/{progress.pagesTotal} pages</strong>
            <progress aria-label="All-document analysis progress" value={progress.pagesCompleted} max={Math.max(1, progress.pagesTotal)} />
          </div>
        )}
        {!isPageScope
          ? <small>{progress.definitionsAnalyzed} unique definitions analyzed · {cacheDiagnostics.hits || 0} cached predictions reused</small>
          : <div className={`glyph_char_page_notice glyph_char_page_notice--${pageEvidenceState}`}>
              {pageEvidenceState === "ready" && `${summary.studied.toLocaleString()} glyph instances studied on page ${currentPage}.`}
              {pageEvidenceState === "processing" && `${summary.studied.toLocaleString()} of ${scopedGlyphs.length.toLocaleString()} page glyphs studied.`}
              {pageEvidenceState === "waiting" && `Waiting for saved evidence from page ${currentPage}.`}
              {pageEvidenceState === "empty" && `No saved glyph evidence is available for page ${currentPage}.`}
            </div>}
        {error && <p className="glyph_char_error">{error}</p>}
      </section>

      <section className="glyph_char_inspector" aria-label="Selected glyph">
        <h3>{isPageScope ? `Selected glyph · page ${currentPage}` : "Selected glyph"}</h3>
        {!visibleSelectedGlyph ? <p className="glyph_char_empty">Select a visible glyph or a result row.</p> : <>
          <section className="glyph_visual_evidence" aria-label="GLYPH VISUAL EVIDENCE">
            <h4>GLYPH VISUAL EVIDENCE</h4>

            <article className="glyph_visual_card glyph_visual_card--vector">
              <header><div><small>Glyph Definition Evidence</small><h4>Vector Morphology</h4></div><span className={`glyph_visual_state glyph_visual_state--${vectorEvidence?.status || "unavailable"}`}>{vectorEvidence?.status || "unavailable"}</span></header>
              <figure className="glyph_vector_preview">
                {vectorEvidence?.available && vectorEvidence?.outline?.svgPath
                  ? <svg viewBox={vectorEvidence.outline.viewBox || "0 0 100 100"} role="img" aria-label="Normalized glyph outline"><path d={vectorEvidence.outline.svgPath} /></svg>
                  : <span>VECTOR UNAVAILABLE</span>}
              </figure>
              {!vectorEvidence?.available && <p className="glyph_visual_unavailable">{vectorEvidence?.unavailableReason || "No reliable glyph outline was exposed."}</p>}
              <MorphologyRows morphology={vectorEvidence?.morphology} keys={[["contourCount", "Contours"], ["closedContourCount", "Closed contours"], ["openContourCount", "Open contours"], ["counterEstimate", "Counters"], ["curveCount", "Curves"], ["lineSegmentCount", "Line segments"], ["aspectRatio", "Aspect ratio"]]} />
              <RecognitionPanel title="Vector Predicted Char" prediction={vectorPrediction} />
            </article>

            <article className="glyph_visual_card glyph_visual_card--raster">
              <header><div><small>Visual-Instance Evidence</small><h4>Raster Morphology</h4></div><span className={`glyph_visual_state glyph_visual_state--${rasterEvidence?.status || "unavailable"}`}>{rasterEvidence?.status || "unavailable"}</span></header>
              <div className="glyph_raster_previews">
                {cvStages
                  ? CV_STAGE_LABELS.map(([key, label]) => cvStages[key] && (
                      <figure key={key}><img src={cvStages[key]} alt={`OpenCV ${label.toLowerCase()}`} /><figcaption>{label}</figcaption></figure>
                    ))
                  : <>
                      <figure>{visibleSelectedGlyph.renderedCrop ? <img src={visibleSelectedGlyph.renderedCrop} alt="Original rendered glyph crop" /> : <span>{visibleSelectedGlyph.visible ? "…" : "∅"}</span>}<figcaption>Rendered pixels</figcaption></figure>
                      <figure>{visibleSelectedGlyph.normalizedCrop ? <img src={visibleSelectedGlyph.normalizedCrop} alt="Normalized raster glyph" /> : <span>{visibleSelectedGlyph.visible ? "…" : "∅"}</span>}<figcaption>Normalized pixels</figcaption></figure>
                    </>}
              </div>
              {visibleSelectedGlyph.visualStagesStatus === "loading" && <p className="glyph_visual_stage_notice">Loading stored OpenCV stages…</p>}
              {visibleSelectedGlyph.visualStagesStatus === "unavailable" && <p className="glyph_visual_unavailable">{visibleSelectedGlyph.visualStagesError}</p>}
              <MorphologyRows morphology={rasterEvidence?.morphology} keys={[["contourCount", "Contours"], ["counterEstimate", "Counters"], ["connectedComponents", "Components"], ["aspectRatio", "Aspect ratio"], ["foregroundPercentage", "Foreground"], ["edgePixelPercentage", "Edges"]]} />
              <RecognitionPanel title="Raster Predicted Char" prediction={rasterPrediction} />
              <details className="glyph_morph_similarity_debug">
                <summary>Morphological similarity · debug only</summary>
                <dl>
                  <dt>Nearest template</dt><dd>{shownChar(rasterEvidence?.morphologicalSimilarity?.nearestTemplate)}</dd>
                  <dt>Template similarity</dt><dd>{rasterEvidence?.morphologicalSimilarity?.templateSimilarityScore ?? "unavailable"}</dd>
                  <dt>Dice</dt><dd>{rasterEvidence?.morphologicalSimilarity?.dice ?? "unavailable"}</dd>
                  <dt>IoU</dt><dd>{rasterEvidence?.morphologicalSimilarity?.iou ?? "unavailable"}</dd>
                  <dt>Contour similarity</dt><dd>{rasterEvidence?.morphologicalSimilarity?.contourSimilarity ?? "unavailable"}</dd>
                </dl>
              </details>
              <section className="glyph_cv_training" aria-label="Human confirmation for selected glyph">
                <div><small>Independent evidence channel</small><strong>Human Confirmation</strong></div>
                <label>
                  <span>Correct character</span>
                  <input
                    type="text"
                    value={confirmedChar}
                    onChange={(event) => setConfirmedChar(event.target.value)}
                    placeholder="A"
                    aria-label="Human-confirmed character"
                    autoComplete="off"
                    spellCheck="false"
                  />
                </label>
                <button
                  type="button"
                  onClick={trainSelectedGlyph}
                  disabled={trainingState.status === "saving" || !cvStages?.normalized}
                >{trainingState.status === "saving" ? "Saving…" : "Confirm Character"}</button>
                <small className={`glyph_cv_training_message glyph_cv_training_message--${trainingState.status}`}>
                  {trainingState.message || "Confirmation is stored separately for deliberate future model training. It does not retrain or override the base model. PDF /ToUnicode is never a training label."}
                </small>
              </section>
              {!rasterEvidence?.available && <p className="glyph_visual_unavailable">{rasterEvidence?.unavailableReason || "Raster evidence is unavailable."}</p>}
            </article>

            <article className="glyph_visual_card glyph_visual_card--given">
              <header><small>PDF Evidence</small><h4>Given Char</h4></header>
              <div className="glyph_visual_prediction"><small>Given Char</small><strong>{shownChar(visibleSelectedGlyph.given.value)}</strong><span>{visibleSelectedGlyph.given.source}</span></div>
            </article>

            <article className="glyph_visual_card glyph_visual_card--human">
              <header><small>Explicit human evidence</small><h4>Human Confirmed Char</h4></header>
              <div className="glyph_visual_prediction"><small>Human Confirmed Char</small><strong>{shownChar(visibleSelectedGlyph.humanConfirmation?.confirmedChar)}</strong><span>{visibleSelectedGlyph.humanConfirmation?.source || "Not confirmed"}</span></div>
            </article>

            <article className="glyph_visual_card glyph_visual_card--comparison">
              <header><h4>Evidence agreement</h4></header>
              <strong>{comparisonState}</strong>
            </article>

            <article className="glyph_visual_card glyph_measurement_validity">
              <header><small>Layer 1 instrument gate</small><h4>MEASUREMENT VALIDITY</h4></header>
              <dl className="glyph_visual_morphology">
                <dt>Raster model</dt><dd>{rasterPrediction?.modelName || "unavailable"} {rasterPrediction?.modelVersion || ""}</dd>
                <dt>Vector model</dt><dd>{vectorPrediction?.modelName || "unavailable"} {vectorPrediction?.modelVersion || ""}</dd>
                <dt>Validation profile</dt><dd>{validation?.validationProfileVersion || "unavailable"}</dd>
                <dt>Profile approval</dt><dd>{validation?.approvedForDownstream ? "APPROVED" : "NOT APPROVED"}</dd>
                <dt>Open-set</dt><dd>{visibleSelectedGlyph.openSetAssessment?.status || "UNAVAILABLE"}</dd>
                <dt>Typographic evidence</dt><dd>{typographic.available ? "AVAILABLE" : "UNAVAILABLE"}</dd>
                <dt>Admission</dt><dd>{admission?.state || "OBSERVE_ONLY"}</dd>
                <dt>Admitted Char</dt><dd>{shownChar(admission?.admittedChar)}</dd>
              </dl>
              <div className="glyph_admission_reasons">{(admission?.reasonCodes || ["ADMISSION_DECISION_UNAVAILABLE"]).map((reason) => <span key={reason}>{reason}</span>)}</div>
            </article>

            <details className="glyph_typographic_details">
              <summary>TYPOGRAPHIC-RELATIVE EVIDENCE</summary>
              <dl className="glyph_visual_morphology">
                {[ ["fontSize","Font size"], ["widthToFontSize","Width / font size"], ["heightToFontSize","Height / font size"],
                  ["rawCropWidthToExpectedFontPixels","Raw crop width / expected font pixels"], ["rawCropHeightToExpectedFontPixels","Raw crop height / expected font pixels"],
                  ["inkWidthToExpectedFontPixels","Ink width / expected font pixels"], ["inkHeightToExpectedFontPixels","Ink height / expected font pixels"],
                  ["advanceWidthToEm","Advance / em"], ["glyphTopToEm","Top / em"], ["glyphBottomToEm","Bottom / em"],
                  ["glyphWidthToEm","Glyph width / em"], ["glyphHeightToEm","Glyph height / em"], ["capHeight","Cap height"], ["xHeight","x-height"]
                ].map(([key,label]) => <React.Fragment key={key}><dt>{label}</dt><dd>{typographic[key] ?? "unavailable"}</dd></React.Fragment>)}
              </dl>
            </details>
          </section>
          <dl className="glyph_char_metadata">
            <dt>Page</dt><dd>{visibleSelectedGlyph.pageNumber}</dd>
            <dt>Font</dt><dd>{visibleSelectedGlyph.fontName || "unknown"}</dd>
            <dt>Glyph ID</dt><dd>{visibleSelectedGlyph.glyphId ?? "unavailable"}</dd>
            <dt>Geometry</dt><dd>{visibleSelectedGlyph.geometryConfidence} · {visibleSelectedGlyph.geometryMethod}</dd>
            <dt>BBox</dt><dd>{[visibleSelectedGlyph.bbox.x, visibleSelectedGlyph.bbox.y, visibleSelectedGlyph.bbox.width, visibleSelectedGlyph.bbox.height].map((value) => Number(value).toFixed(2)).join(", ")}</dd>
          </dl>
          <details className="glyph_char_debug">
            <summary>Evidence / debug</summary>
            <dl>
              <dt>Given provenance</dt><dd>{visibleSelectedGlyph.given.source}</dd>
              <dt>Raw code</dt><dd>{visibleSelectedGlyph.given.rawCode ?? "unavailable"}</dd>
              <dt>Vector recognizer</dt><dd>{vectorPrediction?.modelName ? `${vectorPrediction.modelName} ${vectorPrediction.modelVersion || ""}` : "unavailable"}</dd>
              <dt>Vector source</dt><dd>{vectorEvidence?.outlineSource || "unavailable"}</dd>
              <dt>Vector cache</dt><dd>{vectorEvidence?.cacheKey || "unavailable"}</dd>
              <dt>Raster recognizer</dt><dd>{rasterPrediction?.modelName ? `${rasterPrediction.modelName} ${rasterPrediction.modelVersion || ""}` : "unavailable"}</dd>
              <dt>Prediction source</dt><dd>{rasterPrediction?.predictionSource || "unavailable"}</dd>
              <dt>Preprocessing version</dt><dd>{rasterPrediction?.preprocessingVersion || "unavailable"}</dd>
              <dt>Calibration version</dt><dd>{rasterPrediction?.calibrationVersion || "unavailable"}</dd>
              <dt>Raster crop</dt><dd>{rasterEvidence?.method || "pending"}</dd>
              <dt>Raster normalization</dt><dd>{rasterEvidence?.normalization || "pending"}</dd>
              <dt>Raster fingerprint</dt><dd>{rasterEvidence?.fingerprint || visibleSelectedGlyph.visualFingerprint || "pending"}</dd>
              <dt>Raster cache</dt><dd>{rasterEvidence?.instanceCacheKey || "pending"}</dd>
              <dt>Transform</dt><dd>{visibleSelectedGlyph.transform?.join(", ") || "unavailable"}</dd>
            </dl>
            {visibleSelectedGlyph.renderedCrop && <img src={visibleSelectedGlyph.renderedCrop} alt="Raw rendered glyph crop" />}
          </details>
        </>}
      </section>

      <section className="glyph_char_list_section">
        <h3>
          <span>{isPageScope ? `Page ${currentPage} glyph results` : "Glyph results"}</span>
          <span className="glyph_char_results_heading_actions">
            <span>{filtered.length.toLocaleString()}</span>
            <button
              type="button"
              className="glyph_char_empty_results_btn"
              onClick={deleteAllResults}
              disabled={!analysis.canDeleteResults || status === "analyzing" || status === "deleting"}
              title="Delete all saved glyph results"
              aria-label="Delete all saved glyph results"
            >
              <i className="bx bx-trash" aria-hidden="true" />
            </button>
          </span>
        </h3>
        <div className="glyph_char_filters" role="tablist" aria-label="Filter glyph comparisons">
          {FILTERS.map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={filter === value} className={filter === value ? "is-active" : ""} onClick={() => setFilter(value)}>{label}</button>)}
        </div>
        <GlyphResultList key={`${scope}:${currentPage}:${filter}`} glyphs={filtered} selectedId={visibleSelectedGlyph?.id} onSelect={onSelectGlyph} showPageNumber={!isPageScope} />
      </section>
      </div>
    </aside>
  );
};

export default GlyphCharAside;
