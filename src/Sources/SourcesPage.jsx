import React, { useRef, useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { readStoredSession } from "../utils/sessionCleanup";
import { apiUrl } from "../config/api";
import {
  dismissSourceTask,
  startSourceSplit,
  startSourceUpload,
  useSourceBackgroundTasks,
} from "./sourceBackgroundTasks";
import { clearPendingSplit, loadPendingSplit, savePendingSplit } from "./sourcePendingSplit";
import "./sourcesPage.css";

const TYPE_LABELS = {
  pdf: "PDF", word: "Word", youtube: "YouTube", podcast: "Podcast", image: "Image",
  textbook: "Textbook", reference: "Reference", review: "Review",
  xray: "X-Ray", ct: "CT Scan", mri: "MRI", ultrasound: "Ultrasound",
};

const authHeader = () => {
  const token = readStoredSession()?.token || "";
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const MAX_UPLOAD_BYTES = 512 * 1024 * 1024; // 512 MB local source limit
// Kept only for compatibility with legacy background-task state; local source
// uploads no longer use a Cloudinary-size threshold.
const CLOUDINARY_RAW_LIMIT_BYTES = MAX_UPLOAD_BYTES;
const ACCESS_MODE_TABS = [
  "All",
  "Sight / Text",
  "Sight / Image",
  "Sight + Hearing / Video",
  "Hearing / Recording",
];

const formatMb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const displaySourceName = (name) => String(name || "").replace(/\.[a-z0-9]{1,8}$/i, "");
const formatDuration = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
const isPdfFile = (file) =>
  file?.type === "application/pdf" || /\.pdf$/i.test(String(file?.name || ""));
const sourceTypeFromFile = (file, fallback = "textbook") => {
  const mime = String(file?.type || "").toLowerCase();
  const name = String(file?.name || "").toLowerCase();
  if (mime.startsWith("image/") || /\.(dcm|dicom|png|jpe?g|gif|webp|tiff?)$/i.test(name)) return "image";
  if (mime === "application/pdf" || /\.(pdf|doc|docx|txt|rtf)$/i.test(name)) return "textbook";
  return fallback;
};
const modeOfAccessFromSource = (source) => {
  const explicitMode = String(source?.modeOfAccess || source?.mode_of_access || "").trim();
  if (explicitMode) return explicitMode;
  const format = String(source?.format || "").toLowerCase();
  if (["mp3", "wav", "m4a", "aac", "ogg", "flac", "podcast"].includes(format) || source?.type === "podcast") {
    return "Hearing / Recording";
  }
  if (["mp4", "webm", "mov", "avi", "mkv", "youtube"].includes(format) || source?.type === "youtube") {
    return "Sight + Hearing / Video";
  }
  if (["png", "jpg", "jpeg", "gif", "webp", "tif", "tiff", "dcm", "dicom"].includes(format)
    || ["image", "xray", "ct", "mri", "ultrasound"].includes(String(source?.type || "").toLowerCase())) {
    return "Sight / Image";
  }
  return "Sight / Text";
};
const readResponsePayload = async (res) => {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
};

const readableError = (value, fallback = "An unexpected error occurred.") => {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const messages = value.map((item) => readableError(item, "")).filter(Boolean);
    if (messages.length) return messages.join("; ");
  }
  if (value && typeof value === "object") {
    for (const key of ["message", "error", "detail", "reason"]) {
      if (value[key] != null && value[key] !== value) {
        const message = readableError(value[key], "");
        if (message) return message;
      }
    }
    try {
      const serialized = JSON.stringify(value);
      if (serialized && serialized !== "{}") return serialized;
    } catch {}
  }
  return fallback;
};

const SourcesPage = () => {
  const navigate = useNavigate();
  const fileDocRef      = useRef(null);
  const fileImgRef      = useRef(null);
  const pendingDocType  = useRef("textbook");
  const pendingImgType  = useRef("xray");
  const dropdownRef     = useRef(null);
  const addBtnRef       = useRef(null);
  const splitPreviewXhrRef = useRef(null);

  const [sources,  setSources]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);
  const [info,     setInfo]     = useState(null);
  const [dropOpen, setDropOpen] = useState(false);
  const [linkInputMode, setLinkInputMode] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [compressionPrompt, setCompressionPrompt] = useState(null);
  const [splitCheckElapsed, setSplitCheckElapsed] = useState(0);
  const [deleteMode, setDeleteMode] = useState(false);
  const [selectedSourceIds, setSelectedSourceIds] = useState([]);
  const [accessModeTab, setAccessModeTab] = useState("All");
  const [swipedSourceId, setSwipedSourceId] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const swipeStartXRef = useRef(null);
  const backgroundTasks = useSourceBackgroundTasks();
  const compressionBusy = backgroundTasks.some((task) => task.kind === "split" && task.status === "running");
  const handledBackgroundTasks = useRef(new Set());
  const availableAccessModeTabs = [
    ...ACCESS_MODE_TABS,
    ...sources.map((source) => modeOfAccessFromSource(source)),
  ].filter((mode, index, modes) => modes.indexOf(mode) === index);
  const visibleSources = accessModeTab === "All"
    ? sources
    : sources.filter((source) => modeOfAccessFromSource(source) === accessModeTab);

  const handleSourceTouchStart = (event) => {
    swipeStartXRef.current = event.touches[0]?.clientX ?? null;
  };

  const handleSourceTouchEnd = (sourceId, event) => {
    const startX = swipeStartXRef.current;
    swipeStartXRef.current = null;
    if (startX == null) return;
    const endX = event.changedTouches[0]?.clientX ?? startX;
    const distance = endX - startX;
    if (distance < -40) setSwipedSourceId(sourceId);
    else if (distance > 40 && swipedSourceId === sourceId) setSwipedSourceId(null);
  };

  /* ── Load sources ── */
  useEffect(() => {
    (async () => {
      try {
        const res  = await fetch(apiUrl("/api/sources/"), { headers: authHeader() });
        const data = await res.json();
        if (res.ok) setSources(data.sources || []);
      } catch {}
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    const activeSources = sources.filter((source) => ["queued", "uploading", "processing"].includes(source.ocrStatus));
    if (!activeSources.length) return undefined;
    const timer = window.setInterval(async () => {
      try {
        const statuses = await Promise.all(activeSources.map(async (source) => {
          const response = await fetch(apiUrl(`/api/sources/${source._id}/ocr/status`), { headers: authHeader() });
          const data = await response.json();
          return response.ok ? { id: source._id, status: data.status, progress: data.job?.progress || 0 } : null;
        }));
        const statusById = new Map(statuses.filter(Boolean).map((item) => [item.id, item]));
        setSources((current) => current.map((source) => {
          const update = statusById.get(source._id);
          return update ? { ...source, ocrStatus: update.status, ocrProgress: update.progress } : source;
        }));
      } catch {}
    }, 2000);
    return () => window.clearInterval(timer);
  }, [sources]);

  /* ── Close dropdown on outside click ── */
  useEffect(() => {
    if (!dropOpen) return;
    const handler = (e) => {
      if (
        !dropdownRef.current?.contains(e.target) &&
        !addBtnRef.current?.contains(e.target)
      ) setDropOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dropOpen]);

  /* ── Upload file ── */
  const [uploadCount, setUploadCount] = useState(0);
  const backgroundUploadCount = backgroundTasks.filter((task) => task.status === "running").length;

  useEffect(() => {
    for (const task of backgroundTasks) {
      if (handledBackgroundTasks.current.has(task.id) || task.status === "running") continue;
      handledBackgroundTasks.current.add(task.id);

      if (task.status === "completed") {
        const source = task.result?.source;
        if (source) {
          setSources((current) => current.some((item) => item._id === source._id)
            ? current
            : [source, ...current]);
        }
        setInfo(task.result?.duplicate
          ? `"${task.name}" is already in your sources.`
          : task.kind === "split"
            ? `Uploaded "${task.name}" as one source, stored behind the scenes as ${task.result?.partCount || "multiple"} parts.`
            : `Uploaded "${task.name}".`);
        dismissSourceTask(task.id);
        continue;
      }

      if (task.status === "failed") {
        setError(task.message || `Failed to process "${task.name}".`);
        dismissSourceTask(task.id);
      }
    }
  }, [backgroundTasks]);

  const pollSplitPreviewJob = useCallback((jobId, onProgress) => new Promise((resolve, reject) => {
    const poll = async () => {
      try {
        const response = await fetch(apiUrl(`/api/sources/ingest/${jobId}`), { headers: authHeader() });
        const data = await readResponsePayload(response);
        if (!response.ok) throw new Error(readableError(data.error, "Could not read PDF inspection status."));
        const job = data.job || {};
        onProgress?.({
          stage: "inspecting",
          stageLabel: job.stage || "Inspecting PDF page structure",
          progress: Number(job.progress) || 0,
          uploadJobId: jobId,
        });
        if (job.status === "failed") throw new Error(job.error || "PDF inspection failed.");
        if (job.status === "ready") {
          resolve({
            uploadJobId: jobId,
            currentSizeBytes: job.sizeBytes,
            maxSizeBytes: CLOUDINARY_RAW_LIMIT_BYTES,
            splitUnavailableReason: null,
            splitSuggestion: {
              numPages: job.pageCount,
              suggestedParts: job.requestedParts,
              estimatedPartSizeBytes: Math.ceil(job.sizeBytes / job.requestedParts),
              repaired: job.stage === "Ready to split after repair",
            },
          });
          return;
        }
        window.setTimeout(poll, 1000);
      } catch (error) {
        reject(error);
      }
    };
    void poll();
  }), []);

  // Upload once, then follow the persisted backend inspection job.
  const fetchSplitPreview = useCallback((file, type, onProgress) => new Promise((resolve, reject) => {
    splitPreviewXhrRef.current?.abort();
    const xhr = new XMLHttpRequest();
    splitPreviewXhrRef.current = xhr;
    xhr.open("POST", apiUrl("/api/sources/split-preview"));
    const token = readStoredSession()?.token || "";
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.timeout = 15 * 60 * 1000;

    xhr.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      const progress = Math.min(100, Math.round((event.loaded / event.total) * 100));
      onProgress?.({ stage: progress >= 100 ? "inspecting" : "uploading", progress, loaded: event.loaded, total: event.total });
    });
    xhr.upload.addEventListener("load", () => {
      onProgress?.({ stage: "inspecting", progress: 100, loaded: file.size, total: file.size });
    });
    xhr.addEventListener("load", () => {
      splitPreviewXhrRef.current = null;
      const data = (() => {
        if (!xhr.responseText) return {};
        try { return JSON.parse(xhr.responseText); } catch { return { error: xhr.responseText }; }
      })();
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(readableError(data.error, "Failed to check split options.")));
        return;
      }
      if (xhr.status === 202 && data.jobId) {
        onProgress?.({ stage: "inspecting", stageLabel: data.stage, progress: data.progress || 5, uploadJobId: data.jobId });
        void pollSplitPreviewJob(data.jobId, onProgress).then(resolve, reject);
        return;
      }
      resolve(data);
    });
    xhr.addEventListener("error", () => {
      splitPreviewXhrRef.current = null;
      reject(new Error("The PDF checker lost its connection to the backend."));
    });
    xhr.addEventListener("timeout", () => {
      splitPreviewXhrRef.current = null;
      reject(new Error("The PDF checker timed out after 15 minutes."));
    });
    xhr.addEventListener("abort", () => {
      splitPreviewXhrRef.current = null;
      reject(new DOMException("PDF check cancelled.", "AbortError"));
    });

    const form = new FormData();
    form.append("file", file, file?.name || "source.pdf");
    form.append("type", type || "textbook");
    form.append("name", file?.name || "source.pdf");
    xhr.send(form);
  }), [pollSplitPreviewJob]);

  const updateSplitCheckProgress = useCallback((file, progress) => {
    setCompressionPrompt((current) => current && (!file || current.file === file)
      ? {
        ...current,
        checkerStage: progress.stage,
        checkerStageLabel: progress.stageLabel || current.checkerStageLabel,
        checkerProgress: progress.progress,
        checkerLoaded: progress.loaded ?? current.checkerLoaded,
        checkerTotal: progress.total ?? current.checkerTotal,
        uploadJobId: progress.uploadJobId || current.uploadJobId,
      }
      : current);
  }, []);

  useEffect(() => {
    if (!compressionPrompt?.loadingSplit) {
      setSplitCheckElapsed(0);
      return undefined;
    }
    const startedAt = compressionPrompt.checkerStartedAt || Date.now();
    const tick = () => setSplitCheckElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [compressionPrompt?.loadingSplit, compressionPrompt?.checkerStartedAt]);

  useEffect(() => () => splitPreviewXhrRef.current?.abort(), []);

  const offerPdfSplit = useCallback(async (file, type, reason, knownOptions = null) => {
    const pendingValue = {
      file,
      type,
      reason,
      currentSizeBytes: knownOptions?.currentSizeBytes ?? file.size,
      maxSizeBytes: knownOptions?.maxSizeBytes ?? CLOUDINARY_RAW_LIMIT_BYTES,
      splitSuggestion: knownOptions?.splitSuggestion || null,
      splitUnavailableReason: knownOptions?.splitUnavailableReason || null,
    };
    setCompressionPrompt({
      ...pendingValue,
      splitUnavailableReason: knownOptions?.splitUnavailableReason
        ? readableError(knownOptions.splitUnavailableReason, "The PDF could not be inspected for splitting.")
        : null,
      loadingSplit: true,
      checkerStage: "caching",
      checkerProgress: 0,
      checkerLoaded: 0,
      checkerTotal: file.size,
      checkerStartedAt: Date.now(),
    });

    const persisted = await savePendingSplit(pendingValue, (progress) => {
      updateSplitCheckProgress(file, { ...progress, stage: "caching" });
    });
    if (!persisted) {
      setCompressionPrompt((current) => current?.file === file
        ? { ...current, loadingSplit: false, splitSuggestion: null, splitUnavailableReason: "The browser could not reserve durable space for this PDF." }
        : current);
      return;
    }

    if (knownOptions) {
      setCompressionPrompt((current) => current?.file === file
        ? { ...current, loadingSplit: false, checkerStage: "complete", checkerProgress: 100 }
        : current);
      return;
    }

    setCompressionPrompt((current) => current?.file === file
      ? { ...current, checkerStage: "uploading", checkerProgress: 0, checkerLoaded: 0, checkerStartedAt: Date.now() }
      : current);

    try {
      let persistedServerJobId = "";
      const data = await fetchSplitPreview(file, type, (progress) => {
        updateSplitCheckProgress(file, progress);
        if (progress.uploadJobId && progress.uploadJobId !== persistedServerJobId) {
          persistedServerJobId = progress.uploadJobId;
          void savePendingSplit({ ...pendingValue, uploadJobId: progress.uploadJobId });
        }
      });
      setCompressionPrompt((prev) => {
        if (!prev || prev.file !== file) return prev;
        return {
          ...prev,
          splitSuggestion: data.splitSuggestion || null,
          splitUnavailableReason: data.splitUnavailableReason
            ? readableError(data.splitUnavailableReason, "The PDF could not be inspected for splitting.")
            : null,
          loadingSplit: false,
          checkerStage: "complete",
          checkerProgress: 100,
          uploadJobId: data.uploadJobId || null,
        };
      });
      void savePendingSplit({
        file,
        type,
        reason,
        currentSizeBytes: data.currentSizeBytes ?? file.size,
        maxSizeBytes: data.maxSizeBytes ?? CLOUDINARY_RAW_LIMIT_BYTES,
        splitSuggestion: data.splitSuggestion || null,
        splitUnavailableReason: data.splitUnavailableReason || null,
        uploadJobId: data.uploadJobId || null,
      });
    } catch (e) {
      setCompressionPrompt((prev) => {
        if (!prev || prev.file !== file) return prev;
        return { ...prev, splitUnavailableReason: e.message, loadingSplit: false };
      });
    }
  }, [fetchSplitPreview, updateSplitCheckProgress]);

  // Clear any pre-migration split prompt left in browser storage. Local source
  // uploads no longer ask the user to split PDFs.
  useEffect(() => {
    void clearPendingSplit();
  }, []);

  const uploadFile = useCallback((file, type) => {
    setError(null);
    setInfo(null);
    startSourceUpload({ file, type });
  }, []);

  const handleSplitAndUpload = useCallback(() => {
    const prompt = compressionPrompt;
    const parts = prompt?.splitSuggestion?.suggestedParts;
    if ((!prompt?.file && !prompt?.uploadJobId) || !prompt?.type || !parts) return;
    const sourceName = prompt.file?.name || prompt.fileName || "source.pdf";
    setError(null);
    setInfo(null);
    setInfo(`Splitting "${sourceName}" into ${parts} parts in the background. You can browse other pages.`);
    setCompressionPrompt(null);
    void clearPendingSplit();
    startSourceSplit({ file: prompt.file, type: prompt.type, parts, uploadJobId: prompt.uploadJobId, name: sourceName });
  }, [compressionPrompt]);

  /* ── Save YouTube link ── */
  const saveLinkSource = useCallback(async (type, url) => {
    setError(null);
    setUploadCount((n) => n + 1);
    setLinkInputMode("");
    setLinkUrl("");
    try {
      const form = new FormData();
      form.append("type", type);
      form.append("name", url);
      form.append("url",  url);
      const res  = await fetch(apiUrl("/api/sources/save"), { method: "POST", headers: authHeader(), body: form });
      const data = await readResponsePayload(res);
      if (!res.ok) throw new Error(data.error || "Save failed.");
      if (data.duplicate) {
        setInfo(`"${data.source?.name || url}" is already in your sources.`);
        return;
      }
      setSources((prev) => [data.source, ...prev]);
    } catch (e) {
      setError(e.message);
    } finally {
      setUploadCount((n) => n - 1);
    }
  }, []);

  /* ── Open ── same destination the old separate "Open" column used to
     link to, now reached by clicking the name itself. */
  const isSourceOpenable = (s) => (
    s.type === "youtube" || s.type === "podcast"
      ? Boolean(s.url)
      : Boolean(s.key || s.parts?.length)
  );
  const openSource = useCallback((s) => {
    if (!isSourceOpenable(s)) return;
    if (s.type === "youtube") {
      navigate("/youtube", { state: { sourceId: s._id, sourceName: s.name, sourceUrl: s.url } });
    } else if (s.type === "podcast") {
      navigate(`/podcast/${s._id}`, { state: { sourceId: s._id, sourceName: s.name, sourceUrl: s.url } });
    } else {
      navigate("/pdf-reader", { state: { sourceId: s._id, pdfName: s.name } });
    }
  }, [navigate]);

  /* ── Delete ── */
  const deleteSource = useCallback(async (id) => {
    try {
      await fetch(apiUrl(`/api/sources/${id}`), { method: "DELETE", headers: authHeader() });
      setSources((prev) => prev.filter((s) => s._id !== id));
    } catch {}
  }, []);

  const toggleSourceSelection = useCallback((id) => {
    setSelectedSourceIds((current) => current.includes(id)
      ? current.filter((selectedId) => selectedId !== id)
      : [...current, id]);
  }, []);

  const toggleAllSourceSelection = useCallback(() => {
    setSelectedSourceIds((current) => (
      current.length === sources.length ? [] : sources.map((source) => source._id)
    ));
  }, [sources]);

  const deleteSelectedSources = useCallback(async () => {
    if (!selectedSourceIds.length || deleteBusy) return;
    if (!window.confirm(`Delete ${selectedSourceIds.length} selected source${selectedSourceIds.length === 1 ? "" : "s"}?`)) return;
    setDeleteBusy(true);
    try {
      const results = await Promise.all(selectedSourceIds.map(async (id) => {
        const response = await fetch(apiUrl(`/api/sources/${id}`), {
          method: "DELETE",
          headers: authHeader(),
        });
        return { id, ok: response.ok };
      }));
      const deletedIds = new Set(results.filter((result) => result.ok).map((result) => result.id));
      setSources((current) => current.filter((source) => !deletedIds.has(source._id)));
      setSelectedSourceIds((current) => current.filter((id) => !deletedIds.has(id)));
      if (deletedIds.size !== results.length) setError("Some selected sources could not be deleted.");
      else setDeleteMode(false);
    } catch {
      setError("Could not delete the selected sources. Please try again.");
    } finally {
      setDeleteBusy(false);
    }
  }, [deleteBusy, selectedSourceIds]);

  /* ── Rename ── inline edit in the Name column, not a modal — one field,
     no reason to interrupt with a dialog. renamingId tracks which row (if
     any) is currently in edit mode; renameValue is that row's own draft
     text, reset fresh every time a new row starts editing. */
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);

  const startRename = useCallback((source) => {
    setError(null);
    setRenamingId(source._id);
    setRenameValue(source.name);
  }, []);

  const cancelRename = useCallback(() => {
    setRenamingId(null);
    setRenameValue("");
  }, []);

  const submitRename = useCallback(async (id) => {
    const name = renameValue.trim();
    if (!name) { setError("Name is required."); return; }
    setRenameBusy(true);
    try {
      const res = await fetch(apiUrl(`/api/sources/${id}`), {
        method: "PATCH",
        headers: { ...authHeader(), "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await readResponsePayload(res);
      if (!res.ok) throw new Error(data.error || "Failed to rename.");
      setSources((prev) => prev.map((s) => (s._id === id ? { ...s, name: data.name || name } : s)));
      setRenamingId(null);
      setRenameValue("");
    } catch (e) {
      setError(e.message || "Failed to rename.");
    } finally {
      setRenameBusy(false);
    }
  }, [renameValue]);

  /* ── File picker ── */
  const handleFile = (e, type) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    e.target.value = "";
    for (const file of files) {
      const selectedType = type === "doc" ? pendingDocType.current : type;
      const resolvedType = sourceTypeFromFile(file, selectedType);
      if (file.size > MAX_UPLOAD_BYTES) {
        setError(`"${file.name}" is too large (${formatMb(file.size)}). Maximum is 512 MB.`);
        continue;
      }
      uploadFile(file, resolvedType);
    }
  };

  return (
    <div id="sources_page">

      {/* ── Header ── */}
      <div id="sources_header">
        <button id="sources_back_btn" onClick={() => navigate("/home")} aria-label="Home" title="Home">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 13h1v7c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-7h1c.4 0 .77-.24.92-.62.15-.37.07-.8-.22-1.09l-8.99-9a.996.996 0 0 0-1.41 0l-9.01 9c-.29.29-.37.72-.22 1.09s.52.62.92.62Zm9-8.59 6 6V20H6v-9.59z" />
          </svg>
        </button>
        <button id="sources_morphe_btn" onClick={() => navigate("/about/meta-patient-noumena")} aria-label="About Meta-Patient Noumena" title="About Meta-Patient Noumena">
          <i className="fi fi-rr-info" aria-hidden="true" />
        </button>
      </div>

      {/* Hidden file inputs */}
      <input ref={fileDocRef} type="file" accept=".pdf,.doc,.docx" multiple style={{ display: "none" }}
        onChange={(e) => handleFile(e, "doc")} />
      <input ref={fileImgRef} type="file" accept="image/*,.dcm" multiple style={{ display: "none" }}
        onChange={(e) => handleFile(e, pendingImgType.current)} />

      {/* ── Link source bar ── */}
      {linkInputMode && (
        <div id="sources_yt_bar">
          <input id="sources_yt_input" type="url" placeholder={linkInputMode === "podcast" ? "https://divineinterventionpodcasts.com/..." : "https://www.youtube.com/watch?v=…"}
            value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} autoFocus
            onKeyDown={(e) => { if (e.key === "Enter" && linkUrl.trim()) saveLinkSource(linkInputMode, linkUrl.trim()); }}
          />
          <button id="sources_yt_submit" disabled={!linkUrl.trim()}
            onClick={() => saveLinkSource(linkInputMode, linkUrl.trim())}>Add</button>
          <button id="sources_yt_cancel" onClick={() => { setLinkInputMode(""); setLinkUrl(""); }}>Cancel</button>
        </div>
      )}

      {/* ── Feedback ── */}
      {error && <div id="sources_error">{error}</div>}
      {info  && <div id="sources_info">{info}</div>}
      {false && compressionPrompt && (
        <div id="sources_compress_prompt">
          <div className="sources_compress_prompt__copy">
            <strong>Split PDF for upload?</strong>
            <p>{compressionPrompt.reason}</p>
            <p>
              Current size: <span>{formatMb(compressionPrompt.currentSizeBytes || compressionPrompt.file?.size || 0)}</span>
            </p>
            {compressionPrompt.loadingSplit ? (
              <div className="sources_split_checker" aria-live="polite">
                <div className="sources_split_checker__status">
                  <strong>
                    {compressionPrompt.checkerStage === "inspecting"
                      ? `${compressionPrompt.checkerStageLabel || "Inspecting PDF page structure"}: ${compressionPrompt.checkerProgress || 0}%`
                      : compressionPrompt.checkerStage === "caching"
                        ? `Preparing reload-safe copy: ${compressionPrompt.checkerProgress || 0}%`
                      : `Uploading to checker: ${compressionPrompt.checkerProgress || 0}%`}
                  </strong>
                  <span>{formatDuration(splitCheckElapsed)}</span>
                </div>
                <div
                  className={`sources_split_checker__track${compressionPrompt.checkerStage === "inspecting" ? " sources_split_checker__track--inspecting" : ""}`}
                  role="progressbar"
                  aria-valuemin="0"
                  aria-valuemax="100"
                  aria-valuenow={compressionPrompt.checkerProgress || 0}
                >
                  <span style={{ width: `${compressionPrompt.checkerProgress || 0}%` }} />
                </div>
                <p>
                  {compressionPrompt.checkerStage === "inspecting"
                    ? "Upload complete. Progress is reported by the persisted backend inspection job."
                    : compressionPrompt.checkerStage === "caching"
                      ? `${formatMb(compressionPrompt.checkerLoaded || 0)} of ${formatMb(compressionPrompt.checkerTotal || compressionPrompt.file?.size || 0)} saved in browser storage`
                    : `${formatMb(compressionPrompt.checkerLoaded || 0)} of ${formatMb(compressionPrompt.checkerTotal || compressionPrompt.file?.size || 0)}`}
                </p>
              </div>
            ) : compressionPrompt.splitSuggestion ? (
              <div className="sources_split_option">
                <p className="sources_compress_prompt__note">
                  Split it into {compressionPrompt.splitSuggestion.suggestedParts} pieces behind the scenes (~{formatMb(compressionPrompt.splitSuggestion.estimatedPartSizeBytes)} each, {compressionPrompt.splitSuggestion.numPages} pages total). It still appears as one source that opens and reads like a single PDF.
                </p>
                {compressionPrompt.splitSuggestion.repaired && (
                  <p className="sources_compress_prompt__note">The PDF structure was automatically repaired before its {compressionPrompt.splitSuggestion.numPages} pages were counted.</p>
                )}
                <button
                  type="button"
                  className="sources_compress_option"
                  disabled={compressionBusy}
                  onClick={handleSplitAndUpload}
                >
                  <strong>Split into {compressionPrompt.splitSuggestion.suggestedParts} parts</strong>
                  <span>Stored as separate pieces, viewed as one seamless document</span>
                </button>
              </div>
            ) : (
              <p className="sources_compress_prompt__note">
                Splitting is unavailable: {compressionPrompt.splitUnavailableReason || "the PDF page structure could not be inspected."}
              </p>
            )}
          </div>
          <div className="sources_compress_prompt__actions">
            <button
              type="button"
              className="sources_compress_btn"
              disabled={compressionBusy}
              onClick={() => {
                splitPreviewXhrRef.current?.abort();
                if (compressionPrompt.uploadJobId) {
                  void fetch(apiUrl(`/api/sources/ingest/${compressionPrompt.uploadJobId}`), {
                    method: "DELETE",
                    headers: authHeader(),
                  });
                }
                setCompressionPrompt(null);
                void clearPendingSplit();
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Table ── */}
      <div id="sources_body">
        <div className="sources_table_stage">
        <div className="sources_access_tabs" role="tablist" aria-label="Sort sources by mode of access">
          <span className="sources_access_tabs__label">Sort by mode of access</span>
          <div className="sources_access_tabs__list">
            {availableAccessModeTabs.map((mode) => (
              <button
                key={mode}
                type="button"
                role="tab"
                aria-selected={accessModeTab === mode}
                className={`sources_access_tab${accessModeTab === mode ? " sources_access_tab--active" : ""}`}
                onClick={() => setAccessModeTab(mode)}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>
        <div className="sources_table_scroll">
        <table id="sources_table">
          <thead>
            <tr>
              {deleteMode && (
                <th className="sources_select_col">
                  <input
                    type="checkbox"
                    checked={sources.length > 0 && selectedSourceIds.length === sources.length}
                    onChange={toggleAllSourceSelection}
                    aria-label="Select all sources"
                  />
                </th>
              )}
              <th className="sources_type_col">Mode of Access</th>
              <th className="sources_format_col">Format</th>
              <th className="sources_name_col">Name</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={deleteMode ? 4 : 3} className="sources_td_status">Loading…</td></tr>
            ) : visibleSources.map((s) => (
              <tr
                key={s._id}
                className={`sources_row${swipedSourceId === s._id ? " sources_row--swiped" : ""}`}
                onTouchStart={handleSourceTouchStart}
                onTouchEnd={(event) => handleSourceTouchEnd(s._id, event)}
              >
                {deleteMode && (
                  <td className="sources_select_col">
                    <input
                      type="checkbox"
                      checked={selectedSourceIds.includes(s._id)}
                      onChange={() => toggleSourceSelection(s._id)}
                      aria-label={`Select ${s.name}`}
                    />
                  </td>
                )}
                <td>
                  <span className="sources_type_badge">
                    {modeOfAccessFromSource(s)}
                  </span>
                </td>
                <td className="sources_td_format">{s.format || "—"}</td>
                <td className="sources_td_name">
                  {renamingId === s._id ? (
                    <span className="sources_rename_group sources_row_content">
                      <input
                        type="text"
                        className="sources_rename_input"
                        value={renameValue}
                        autoFocus
                        disabled={renameBusy}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") submitRename(s._id);
                          if (e.key === "Escape") cancelRename();
                        }}
                      />
                      <button
                        type="button"
                        className="sources_rename_confirm"
                        onClick={() => submitRename(s._id)}
                        disabled={renameBusy}
                        title="Save"
                      >{renameBusy ? "…" : "✓"}</button>
                      <button
                        type="button"
                        className="sources_rename_cancel"
                        onClick={cancelRename}
                        disabled={renameBusy}
                        title="Cancel"
                      >✕</button>
                    </span>
                  ) : (
                    <span className="sources_rename_group sources_row_content">
                      {isSourceOpenable(s) ? (
                        <button type="button" className="sources_name_text sources_name_text--link" onClick={() => openSource(s)} title={`Open ${s.name}`}>
                          {displaySourceName(s.name)}
                        </button>
                      ) : (
                        <span className="sources_name_text" title={s.name}>{displaySourceName(s.name)}</span>
                      )}
                      {swipedSourceId === s._id && <span className="sources_row_actions">
                      <button
                        type="button"
                        className="sources_rename_btn"
                        onClick={() => startRename(s)}
                        title="Rename"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M5 21h14c1.1 0 2-.9 2-2v-7h-2v7H5V5h7V3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2" />
                          <path d="M7 13v3c0 .55.45 1 1 1h3c.27 0 .52-.11.71-.29l9-9a.996.996 0 0 0 0-1.41l-3-3a.996.996 0 0 0-1.41 0l-9.01 8.99A1 1 0 0 0 7 13m10-7.59L18.59 7 17.5 8.09 15.91 6.5zm-8 8 5.5-5.5 1.59 1.59-5.5 5.5H9z" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        className="sources_del_btn"
                        onClick={() => {
                          if (window.confirm(`Delete “${s.name}”?`)) deleteSource(s._id);
                        }}
                        title={`Delete ${s.name}`}
                        aria-label={`Delete ${s.name}`}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M9 3h6l1 2h4v2H4V5h4zm-2 6h2v9H7zm4 0h2v9h-2zm4 0h2v9h-2z" />
                          <path d="M6 21h12l1-14H5z" opacity=".35" />
                        </svg>
                      </button>
                      </span>}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="sources_add_row">
              <td colSpan={deleteMode ? 4 : 3}>
                <button
                  type="button"
                  className="sources_add_row_btn"
                  onClick={() => fileDocRef.current?.click()}
                  aria-label="Add source"
                  title="Add source"
                >+
                </button>
              </td>
            </tr>
          </tfoot>
        </table>
        </div>
        </div>
      </div>

    </div>
  );
};

export default SourcesPage;
