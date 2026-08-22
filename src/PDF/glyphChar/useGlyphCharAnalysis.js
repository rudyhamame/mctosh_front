import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { compareGlyphChar } from "./glyphCharComparison.js";
import { extractNativeGlyphInstances, extractPdfJsFallbackGlyphInstances } from "./glyphExtraction.js";
import { createGlyphPredictionCache } from "./glyphPredictionCache.js";
import { createGlyphVisualRenderer } from "./glyphVisualRenderer.js";
import { createVisualGlyphRecognizer } from "./visualGlyphRecognizer.js";
import { cancelGlyphCharAnalysis, deleteGlyphCharAnalysisResults, getGlyphCharAnalysisResults, getGlyphCharVisualStages, getSavedGlyphCharAnalysis, startGlyphCharAnalysis, trainGlyphCharSample } from "./glyphCharAnalysisClient.js";

const pauseForBrowser = () => new Promise((resolve) => {
  if (typeof requestIdleCallback === "function") requestIdleCallback(resolve, { timeout: 80 });
  else setTimeout(resolve, 0);
});

const priorityPages = (count, current) => {
  const pages = [];
  const seen = new Set();
  const push = (page) => { if (page >= 1 && page <= count && !seen.has(page)) { seen.add(page); pages.push(page); } };
  push(current);
  for (let distance = 1; distance < count; distance += 1) { push(current - distance); push(current + distance); }
  return pages;
};

const runBounded = async (items, limit, worker, cancelled) => {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length && !cancelled()) {
      const index = cursor++;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
};

const MAX_HYDRATED_GLYPHS = 30000;

const waitForPoll = (cancelled, delay = 1400) => new Promise((resolve) => {
  const started = Date.now();
  const tick = () => {
    if (cancelled() || Date.now() - started >= delay) resolve();
    else setTimeout(tick, Math.min(100, delay));
  };
  tick();
});

const hydrateServerGlyph = (glyph, documentId, vectorDefinitions = new Map()) => {
  const vectorRef = glyph?.visualEvidence?.vector || null;
  const vectorDefinition = vectorRef?.definitionRef ? vectorDefinitions.get(vectorRef.definitionRef) : null;
  return {
    ...glyph,
    id: `${documentId}:${glyph.id}`,
    serverGlyphId: glyph.id,
    documentId,
    renderedCrop: null,
    normalizedCrop: null,
    visualEvidence: {
      ...(glyph.visualEvidence || {}),
      vector: vectorDefinition ? { ...vectorDefinition, ...vectorRef } : vectorRef,
    },
  };
};

export const useGlyphCharAnalysis = ({ enabled = false, requestedPage = null, forceReanalysis = false, requestNonce = 0, pdfDoc, pdfjsUtil, documentId, pageCount, initialPage, loadNativeEvidence }) => {
  const [glyphs, setGlyphs] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const selectedIdRef = useRef(null);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [toUnicodeDetected, setToUnicodeDetected] = useState(false);
  const [progress, setProgress] = useState({ pagesCompleted: 0, pagesTotal: pageCount || 0, instancesEvaluated: 0, definitionsAnalyzed: 0 });
  const cacheDiagnosticsRef = useRef({ definitions: 0, hits: 0, misses: 0 });
  const rendererRef = useRef(null);
  const cancelRunRef = useRef(null);
  const glyphsRef = useRef([]);
  const jobIdRef = useRef(null);
  const savedResultsPage = enabled ? 0 : Number(initialPage) || 1;

  useEffect(() => {
    if (!pdfDoc || !pageCount) {
      setGlyphs([]);
      selectedIdRef.current = null;
      setSelectedId(null);
      setStatus("idle");
      setError("");
      setToUnicodeDetected(false);
      setProgress({ pagesCompleted: 0, pagesTotal: pageCount || 0, instancesEvaluated: 0, definitionsAnalyzed: 0 });
      return undefined;
    }
    const run = { cancelled: false };
    cancelRunRef.current = () => { run.cancelled = true; };
    jobIdRef.current = null;
    const renderer = createGlyphVisualRenderer({ pdfDoc });
    rendererRef.current = renderer;
    const recognizer = createVisualGlyphRecognizer();
    const predictionCache = createGlyphPredictionCache();
    let all = [];
    glyphsRef.current = all;
    let evaluated = 0;
    selectedIdRef.current = null;
    setGlyphs([]); setSelectedId(null); setError(""); setToUnicodeDetected(false); setStatus(enabled ? "analyzing" : "idle");
    setProgress({ pagesCompleted: 0, pagesTotal: pageCount, instancesEvaluated: 0, definitionsAnalyzed: 0, requestedPage: Number(requestedPage) || null, activePage: null, pageProgressPage: Number(requestedPage) || null, pageComplete: false });
    let activeAnalysisPage = null;
    let requestedPageComplete = false;

    const publish = (pagesCompleted) => {
      if (run.cancelled) return;
      cacheDiagnosticsRef.current = predictionCache.diagnostics();
      setGlyphs([...all]);
      setProgress({
        pagesCompleted,
        pagesTotal: pageCount,
        instancesEvaluated: evaluated,
        definitionsAnalyzed: cacheDiagnosticsRef.current.definitions,
        requestedPage: Number(requestedPage) || null,
        activePage: activeAnalysisPage,
        pageProgressPage: Number(requestedPage) || null,
        pageComplete: requestedPageComplete,
      });
    };

    const analyzeLocally = async () => {
      let completedPages = 0;
      for (const pageNumber of priorityPages(pageCount, initialPage || 1)) {
        if (run.cancelled) break;
        activeAnalysisPage = pageNumber;
        publish(completedPages);
        let extraction = null;
        try { extraction = await loadNativeEvidence?.(pageNumber); } catch { extraction = null; }
        if ((extraction?.native?.forensic?.fonts || []).some((font) => Boolean(font?.toUnicode))) {
          setToUnicodeDetected(true);
        }
        let pageGlyphs = extractNativeGlyphInstances({ extraction, documentId, pageNumber });
        if (!pageGlyphs.length) {
          pageGlyphs = await extractPdfJsFallbackGlyphInstances({ pdfDoc, pdfjsUtil, documentId, pageNumber });
        }
        all.push(...pageGlyphs);
        publish(completedPages);
        await runBounded(pageGlyphs, 2, async (glyph, index) => {
          if (run.cancelled) return;
          if (!glyph.visible) {
            glyph.comparison = compareGlyphChar({ givenChars: glyph.given.values, prediction: null, visible: false });
            glyph.analysisStatus = "studied";
            evaluated += 1;
            return;
          }
          try {
            const visual = await renderer.render(glyph, { includeImages: false });
            glyph.renderedCrop = visual?.renderedCrop || null;
            glyph.normalizedCrop = visual?.normalizedCrop || null;
            glyph.visualFingerprint = visual?.visualFingerprint || null;
            glyph.visualEvidence = visual ? {
              method: visual.cropMethod,
              renderScale: visual.renderScale,
              normalization: visual.normalization,
            } : null;
            const cacheKey = glyph.definitionCacheKey || `visual:${visual?.visualFingerprint || glyph.id}`;
            glyph.resolvedCacheKey = cacheKey;
            glyph.prediction = await predictionCache.getOrCreate(cacheKey, () => recognizer.predict({
              imageData: visual?.normalizedImageData,
              empty: visual?.empty,
            }));
            glyph.openSetAssessment = glyph.prediction?.openSetAssessment || { status: "UNAVAILABLE", method: "browser-fallback" };
            glyph.admissionDecision = { state: "OBSERVE_ONLY", admittedChar: null,
              reasonCodes: ["NO_APPROVED_VALIDATION_PROFILE", "BACKEND_EVIDENCE_UNAVAILABLE"],
              policyVersion: "layer1-admission-v1", validationProfileVersion: null };
            glyph.comparison = compareGlyphChar({ givenChars: glyph.given.values, prediction: glyph.prediction, visible: !visual?.empty });
            glyph.analysisStatus = "studied";
          } catch (analysisError) {
            glyph.prediction = { predictedChar: null, predictedChars: [], confidence: 0, candidates: [], recognizer: recognizer.name, status: "unpredictable", error: analysisError.message };
            glyph.admissionDecision = { state: "OBSERVE_ONLY", admittedChar: null, reasonCodes: ["ANALYSIS_UNAVAILABLE"], policyVersion: "layer1-admission-v1", validationProfileVersion: null };
            glyph.comparison = compareGlyphChar({ givenChars: glyph.given.values, prediction: glyph.prediction, visible: glyph.visible });
            glyph.analysisStatus = "failed";
          }
          evaluated += 1;
          if (index % 12 === 0) publish(completedPages);
        }, () => run.cancelled);
        completedPages += 1;
        activeAnalysisPage = null;
        publish(completedPages);
        if (!selectedIdRef.current && pageGlyphs.length) {
          const firstVisible = pageGlyphs.find((glyph) => glyph.visible);
          if (firstVisible && !run.cancelled) {
            selectedIdRef.current = firstVisible.id;
            setSelectedId(firstVisible.id);
            if (firstVisible.visible && !firstVisible.normalizedCrop) {
              const specimen = await renderer.render(firstVisible, { includeImages: true }).catch(() => null);
              if (specimen && !run.cancelled) {
                firstVisible.renderedCrop = specimen.renderedCrop;
                firstVisible.normalizedCrop = specimen.normalizedCrop;
                setGlyphs([...all]);
              }
            }
          }
        }
        await pauseForBrowser();
      }
      if (!run.cancelled) setStatus("complete");
    };

    const analyzeInBackground = async () => {
      const started = await startGlyphCharAnalysis(documentId, requestedPage
        ? { scope: "page", pageNumber: requestedPage, force: forceReanalysis }
        : { scope: "document" });
      let job = started.job;
      if (!job?.id) throw new Error("The server did not return a glyph analysis job.");
      jobIdRef.current = job.id;
      const chunksByKey = new Map();
      const vectorDefinitions = new Map();
      let loadedThroughPage = 0;
      let selectedInitialized = false;
      while (!run.cancelled) {
        if (requestedPage) {
          const requested = await getGlyphCharAnalysisResults(job.id, 0, { pageNumber: requestedPage });
          job = requested.job || job;
          (requested.chunks || []).forEach((chunk) => {
            (chunk.vectorDefinitions || []).forEach((definition) => {
              if (definition?.definitionRef) vectorDefinitions.set(definition.definitionRef, definition);
            });
            chunksByKey.set(`${chunk.pageNumber}:${chunk.chunkIndex}`, (chunk.glyphs || []).map((glyph) => hydrateServerGlyph(glyph, documentId, vectorDefinitions)));
          });
          requestedPageComplete = (requested.chunks || []).some((chunk) => Number(chunk.pageNumber) === Number(requestedPage));
        }
        const response = await getGlyphCharAnalysisResults(job.id, loadedThroughPage);
        job = response.job || job;
        if (job.toUnicodeDetected) setToUnicodeDetected(true);
        (response.chunks || []).forEach((chunk) => {
          (chunk.vectorDefinitions || []).forEach((definition) => {
            if (definition?.definitionRef) vectorDefinitions.set(definition.definitionRef, definition);
          });
          chunksByKey.set(`${chunk.pageNumber}:${chunk.chunkIndex}`, (chunk.glyphs || []).map((glyph) => hydrateServerGlyph(glyph, documentId, vectorDefinitions)));
          loadedThroughPage = Math.max(loadedThroughPage, Number(chunk.pageNumber) || 0);
        });
        let retainedGlyphCount = [...chunksByKey.values()].reduce((sum, chunk) => sum + chunk.length, 0);
        if (retainedGlyphCount > MAX_HYDRATED_GLYPHS) {
          const selectedPage = [...chunksByKey.values()].flat().find((glyph) => glyph.id === selectedIdRef.current)?.pageNumber;
          const protectedPages = new Set([Number(initialPage) || 1, selectedPage].filter(Number.isFinite));
          const candidatePages = [...new Set([...chunksByKey.keys()].map((key) => Number(key.split(":")[0])))]
            .filter((page) => !protectedPages.has(page))
            .sort((left, right) => left - right);
          for (const page of candidatePages) {
            if (retainedGlyphCount <= MAX_HYDRATED_GLYPHS) break;
            for (const [key, chunk] of chunksByKey) {
              if (Number(key.split(":")[0]) !== page) continue;
              retainedGlyphCount -= chunk.length;
              chunksByKey.delete(key);
            }
          }
        }
        all = [...chunksByKey.entries()]
          .sort(([left], [right]) => {
            const [leftPage, leftChunk] = left.split(":").map(Number);
            const [rightPage, rightChunk] = right.split(":").map(Number);
            return leftPage - rightPage || leftChunk - rightChunk;
          })
          .flatMap(([, glyphChunk]) => glyphChunk);
        glyphsRef.current = all;
        cacheDiagnosticsRef.current = {
          definitions: Number(job.uniqueDefinitions || 0),
          hits: Math.max(0, Number(job.glyphInstances || 0) - Number(job.uniqueDefinitions || 0)),
          misses: Number(job.uniqueDefinitions || 0),
        };
        setGlyphs([...all]);
        setProgress({
          pagesCompleted: Number(job.processedPages || 0),
          pagesTotal: Number(job.pageCount || pageCount),
          instancesEvaluated: Number(job.glyphInstances || all.length),
          definitionsAnalyzed: Number(job.uniqueDefinitions || 0),
          requestedPage: Number(job.requestedPage) || null,
          activePage: Number(job.activePage) || null,
          pageProgressPage: Number(requestedPage) || null,
          pageComplete: requestedPageComplete,
        });
        if (!selectedInitialized && !selectedIdRef.current) {
          const first = all.find((glyph) => glyph.pageNumber === (initialPage || 1) && glyph.visible)
            || all.find((glyph) => glyph.visible);
          if (first) {
            selectedInitialized = true;
            selectedIdRef.current = first.id;
            setSelectedId(first.id);
          }
        }
        const hasMoreSavedPages = Boolean(response.hydration?.hasMore);
        if (job.status === "completed" && !hasMoreSavedPages) { setStatus("complete"); return; }
        if (job.status === "partial" && !hasMoreSavedPages) { setStatus("saved"); return; }
        if (job.status === "cancelled") { setStatus("cancelled"); return; }
        if (job.status === "failed") throw new Error(job.error || "Glyph analysis failed.");
        setStatus("analyzing");
        if (hasMoreSavedPages) {
          await pauseForBrowser();
          continue;
        }
        await waitForPoll(() => run.cancelled);
      }
    };

    const loadSavedResults = async () => {
      if (!documentId || documentId === "local" || !/^[a-f\d]{24}$/i.test(String(documentId))) return;
      const existing = await getSavedGlyphCharAnalysis(documentId);
      const job = existing?.job;
      if (!job?.id || run.cancelled) return;
      setToUnicodeDetected(Boolean(job.toUnicodeDetected));
      jobIdRef.current = job.id;
      const response = await getGlyphCharAnalysisResults(job.id, 0, { pageNumber: savedResultsPage });
      if (run.cancelled) return;
      const vectorDefinitions = new Map((response.chunks || []).flatMap((chunk) => chunk.vectorDefinitions || []).filter((definition) => definition?.definitionRef).map((definition) => [definition.definitionRef, definition]));
      all = (response.chunks || []).flatMap((chunk) => (chunk.glyphs || []).map((glyph) => hydrateServerGlyph(glyph, documentId, vectorDefinitions)));
      glyphsRef.current = all;
      setGlyphs([...all]);
      setProgress({
        pagesCompleted: Number(job.processedPages || 0),
        pagesTotal: Number(job.pageCount || pageCount),
        instancesEvaluated: Number(job.glyphInstances || all.length),
        definitionsAnalyzed: Number(job.uniqueDefinitions || 0),
        requestedPage: Number(job.requestedPage) || null,
        activePage: Number(job.activePage) || null,
        pageProgressPage: Number(savedResultsPage) || null,
        pageComplete: (response.chunks || []).some((chunk) => Number(chunk.pageNumber) === Number(savedResultsPage)),
      });
      cacheDiagnosticsRef.current = {
        definitions: Number(job.uniqueDefinitions || 0),
        hits: Math.max(0, Number(job.glyphInstances || 0) - Number(job.uniqueDefinitions || 0)),
        misses: Number(job.uniqueDefinitions || 0),
      };
      const firstVisible = all.find((glyph) => glyph.visible);
      if (firstVisible) {
        selectedIdRef.current = firstVisible.id;
        setSelectedId(firstVisible.id);
      }
      // The saved-results path used to always report `saved`, even when the
      // persisted worker was already queued or processing. That made the UI
      // say "Processing has not been started" while the backend was working.
      setStatus(job.status === "queued" || job.status === "processing"
        ? "analyzing"
        : job.status === "completed"
          ? "complete"
          : job.status === "failed"
            ? "failed"
            : job.status === "cancelled"
              ? "cancelled"
              : "saved");
      return job;
    };

    const analyze = async () => {
      if (!enabled) {
        const savedJob = await loadSavedResults();
        // Reconnect to an active persisted job after a reload or when the
        // panel is opened after the worker has already started. This also
        // restores polling, rather than leaving the panel stuck on a stale
        // saved snapshot.
        if (!run.cancelled && (savedJob?.status === "queued" || savedJob?.status === "processing")) {
          await analyzeInBackground();
        }
        return;
      }
      if (documentId && documentId !== "local") {
        try {
          await analyzeInBackground();
          return;
        } catch (serverError) {
          // A local, unsaved PDF has no Source bytes on the backend. Preserve
          // the visual layer for that case, but saved PDFs always use the
          // durable background worker so reloads resume from MongoDB.
          if (serverError?.status !== 422) throw serverError;
        }
      }
      await analyzeLocally();
    };

    analyze().catch((analysisError) => {
      if (!run.cancelled) { setStatus("failed"); setError(analysisError.message || "Glyph analysis failed."); }
    });
    return () => { run.cancelled = true; if (cancelRunRef.current) cancelRunRef.current = null; renderer.clear(); if (rendererRef.current === renderer) rendererRef.current = null; predictionCache.clear(); };
  // initialPage is deliberately excluded: page navigation must not discard a
  // running document analysis. It only defines priority at document load.
  }, [documentId, enabled, forceReanalysis, loadNativeEvidence, pageCount, pdfDoc, pdfjsUtil, requestedPage, requestNonce, savedResultsPage]);

  const selectedGlyph = useMemo(() => glyphs.find((glyph) => glyph.id === selectedId) || null, [glyphs, selectedId]);
  const selectGlyph = useCallback((glyphOrId) => {
    const id = typeof glyphOrId === "string" ? glyphOrId : glyphOrId?.id || null;
    selectedIdRef.current = id;
    setSelectedId(id);
    const glyph = glyphsRef.current.find((entry) => entry.id === id);
    if (!glyph || glyph.normalizedCrop || !glyph.visible) return;
    if (jobIdRef.current && glyph.serverGlyphId) {
      if (glyph.visualStagesStatus === "loading" || glyph.visualEvidence?.raster?.stages) return;
      glyph.visualStagesStatus = "loading";
      setGlyphs([...glyphsRef.current]);
      void getGlyphCharVisualStages(jobIdRef.current, { pageNumber: glyph.pageNumber, glyphId: glyph.serverGlyphId }).then(({ visualStage }) => {
        if (!visualStage?.stages) return;
        glyph.visualEvidence = {
          ...(glyph.visualEvidence || {}),
          raster: {
            ...(glyph.visualEvidence?.raster || {}),
            stages: visualStage.stages,
            preprocessing: visualStage.preprocessing || glyph.visualEvidence?.raster?.preprocessing,
          },
        };
        glyph.renderedCrop = visualStage.stages.rendered || null;
        glyph.normalizedCrop = visualStage.stages.normalized || null;
        glyph.visualStagesStatus = "ready";
        setGlyphs([...glyphsRef.current]);
      }).catch((stageError) => {
        glyph.visualStagesStatus = "unavailable";
        glyph.visualStagesError = stageError.message || "Stored OpenCV visual stages are unavailable.";
        setGlyphs([...glyphsRef.current]);
      });
      return;
    }
    if (!rendererRef.current) return;
    void rendererRef.current.render(glyph, { includeImages: true }).then((visual) => {
      if (!visual) return;
      glyph.renderedCrop = visual.renderedCrop;
      glyph.normalizedCrop = visual.normalizedCrop;
      setGlyphs([...glyphsRef.current]);
    }).catch(() => {});
  }, []);
  useEffect(() => {
    if (selectedId) selectGlyph(selectedId);
  }, [selectGlyph, selectedId]);
  const deleteAllResults = useCallback(async () => {
    setStatus("deleting");
    setError("");
    try {
      const jobId = jobIdRef.current;
      if (jobId) await deleteGlyphCharAnalysisResults(jobId);
      jobIdRef.current = null;
      glyphsRef.current = [];
      selectedIdRef.current = null;
      setGlyphs([]);
      setSelectedId(null);
      setStatus("idle");
      setToUnicodeDetected(false);
      setProgress({ pagesCompleted: 0, pagesTotal: pageCount || 0, instancesEvaluated: 0, definitionsAnalyzed: 0, requestedPage: null, activePage: null });
    } catch (deleteError) {
      setStatus("failed");
      setError(deleteError.message || "Could not delete glyph analysis results.");
      throw deleteError;
    }
  }, [pageCount]);
  const cancelAnalysis = useCallback(async () => {
    setStatus("canceling");
    setError("");
    try {
      const jobId = jobIdRef.current;
      if (jobId) await cancelGlyphCharAnalysis(jobId);
      cancelRunRef.current?.();
      setProgress((current) => ({ ...current, requestedPage: null, activePage: null }));
      setStatus("cancelled");
    } catch (cancelError) {
      setStatus("failed");
      setError(cancelError.message || "Could not cancel glyph analysis.");
      throw cancelError;
    }
  }, []);
  const trainSelectedGlyph = useCallback(async (confirmedChar) => {
    const glyph = glyphsRef.current.find((entry) => entry.id === selectedIdRef.current);
    if (!jobIdRef.current || !glyph?.serverGlyphId) throw new Error("Select a saved glyph before confirming its character.");
    if (!glyph.visualEvidence?.raster?.stages?.normalized) throw new Error("Wait for the stored normalized OpenCV mask to load.");
    const result = await trainGlyphCharSample(jobIdRef.current, {
      pageNumber: glyph.pageNumber,
      glyphId: glyph.serverGlyphId,
      confirmedChar,
    });
    const definitionCacheKey = result.trainingSample?.definitionCacheKey;
    glyphsRef.current.forEach((entry) => {
      if (!definitionCacheKey || entry.definitionCacheKey !== definitionCacheKey) return;
      entry.humanConfirmation = {
        confirmedChar: result.trainingSample.confirmedChar,
        fingerprint: result.trainingSample.fingerprint,
        source: result.trainingSample.source,
      };
    });
    setGlyphs([...glyphsRef.current]);
    return result;
  }, []);
  return {
    glyphs, selectedGlyph, selectGlyph, trainSelectedGlyph, cancelAnalysis, deleteAllResults,
    jobId: jobIdRef.current,
    canGenerateReport: Boolean(jobIdRef.current),
    // The backend reports queued work separately from processing. Keep the
    // abort control available for both states, including a requested page
    // that is waiting for the worker to pick it up.
    canCancelAnalysis: ["analyzing", "canceling"].includes(status)
      || Boolean(progress.activePage)
      || Boolean(progress.requestedPage),
    canDeleteResults: Boolean(jobIdRef.current),
    toUnicodeDetected, status, error, progress, cacheDiagnostics: cacheDiagnosticsRef.current,
  };
};
