import { useSyncExternalStore } from "react";
import { apiUrl } from "../config/api";
import { readStoredSession } from "../utils/sessionCleanup";

let tasks = [];
const listeners = new Set();
const pollers = new Map();
const requests = new Map();
const dismissedServerJobIds = new Set();
let hydrationRequest = null;

const emit = () => {
  tasks = [...tasks];
  listeners.forEach((listener) => listener());
};

const updateTask = (id, patch) => {
  tasks = tasks.map((task) => (task.id === id ? { ...task, ...patch } : task));
  emit();
};

const authToken = () => readStoredSession()?.token || "";
const taskId = () => `source-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const parsePayload = (text) => {
  if (!text) return {};
  try { return JSON.parse(text); } catch { return { error: text }; }
};

const errorText = (value, fallback) => {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object") {
    return errorText(value.message ?? value.error ?? value.detail, fallback);
  }
  return fallback;
};

const pollSourceJob = (taskIdValue, jobId) => {
  if (pollers.has(taskIdValue)) return;
  const poll = async () => {
    const token = authToken();
    try {
      const response = await fetch(apiUrl(`/api/sources/ingest/${jobId}`), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await response.json();
      if (!response.ok) throw new Error(errorText(data.error, "Could not read source ingest status."));
      const job = data.job;
      if (job.status === "completed") {
        updateTask(taskIdValue, {
          status: "completed",
          phase: "completed",
          progress: 100,
          message: job.partCount ? `Split into ${job.partCount} parts` : "Upload complete",
          result: { source: job.source, partCount: job.partCount },
        });
        pollers.delete(taskIdValue);
        return;
      }
      if (job.status === "failed") {
        updateTask(taskIdValue, { status: "failed", phase: "failed", progress: job.progress || 0, message: job.error || "Source splitting failed." });
        pollers.delete(taskIdValue);
        return;
      }
      if (job.status === "cancelled") {
        updateTask(taskIdValue, { status: "cancelled", phase: "cancelled", progress: job.progress || 0, message: job.stage || "Splitting cancelled" });
        pollers.delete(taskIdValue);
        return;
      }
      if (job.status === "ready") {
        updateTask(taskIdValue, { progress: 100, phase: "ready", message: job.stage || "PDF inspection complete" });
        pollers.delete(taskIdValue);
        return;
      }
      updateTask(taskIdValue, {
        progress: job.progress || 0,
        phase: job.status || "processing",
        message: job.stage || (job.status === "inspecting" ? "Inspecting PDF page structure…" : "Splitting PDF in background…"),
      });
    } catch (error) {
      updateTask(taskIdValue, { message: error.message || "Checking background job…" });
    }
    const timer = window.setTimeout(poll, 2000);
    pollers.set(taskIdValue, timer);
  };
  void poll();
};

const addServerJob = (job) => {
  if (dismissedServerJobIds.has(String(job._id))) return null;
  const existing = tasks.find((task) => task.serverJobId === String(job._id));
  if (existing) {
    updateTask(existing.id, {
      status: job.status === "completed" ? "completed" : job.status === "failed" ? "failed" : job.status === "cancelled" ? "cancelled" : "running",
      phase: job.status,
      progress: job.progress || 0,
      message: job.stage || job.error || existing.message,
    });
    if (["inspecting", "queued", "processing"].includes(job.status)) pollSourceJob(existing.id, job._id);
    return existing.id;
  }
  const id = taskId();
  tasks = [{
    id,
    serverJobId: String(job._id),
    file: null,
    type: job.sourceType,
    kind: "split",
    name: job.name,
    status: job.status === "completed" ? "completed" : job.status === "failed" ? "failed" : job.status === "cancelled" ? "cancelled" : "running",
    phase: job.status,
    progress: job.progress || 0,
    message: job.status === "completed" ? `Split into ${job.partCount || "multiple"} parts` : job.stage || job.error || "Splitting PDF in background…",
    result: job.status === "completed" ? { source: job.source, partCount: job.partCount } : undefined,
    createdAt: Date.now(),
  }, ...tasks];
  emit();
  if (["inspecting", "queued", "processing"].includes(job.status)) pollSourceJob(id, job._id);
  return id;
};

const requestSourceTaskHydration = async () => {
  const token = authToken();
  if (!token) return;
  try {
    const response = await fetch(apiUrl("/api/sources/ingest/active"), { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) return;
    const data = await response.json();
    (data.jobs || []).forEach(addServerJob);
  } catch {}
};

export const hydrateSourceTasks = () => {
  if (hydrationRequest) return hydrationRequest;
  hydrationRequest = requestSourceTaskHydration().finally(() => {
    hydrationRequest = null;
  });
  return hydrationRequest;
};

const runUploadRequest = ({ id, endpoint, form, processingLabel }) => new Promise((resolve) => {
  const xhr = new XMLHttpRequest();
  requests.set(id, xhr);
  xhr.open("POST", apiUrl(endpoint));
  const token = authToken();
  if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

  xhr.upload.addEventListener("progress", (event) => {
    if (!event.lengthComputable) return;
    const progress = Math.min(99, Math.round((event.loaded / event.total) * 100));
    updateTask(id, {
      progress,
      phase: progress >= 99 ? "processing" : "uploading",
      message: progress >= 99 ? processingLabel : `Uploading ${progress}%`,
    });
  });

  xhr.addEventListener("loadend", () => requests.delete(id));
  xhr.addEventListener("load", () => resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, data: parsePayload(xhr.responseText) }));
  xhr.addEventListener("error", () => resolve({ ok: false, status: 0, data: { error: "The network connection failed during upload." } }));
  xhr.addEventListener("abort", () => resolve({ ok: false, status: 0, data: { error: "The upload was cancelled." } }));
  xhr.send(form);
});

const addTask = ({ file, type, kind }) => {
  const id = taskId();
  tasks = [{
    id,
    file,
    type,
    kind,
    name: file.name,
    status: "running",
    phase: "uploading",
    progress: 0,
    message: "Preparing upload…",
    createdAt: Date.now(),
  }, ...tasks];
  emit();
  return id;
};

export const startSourceUpload = ({ file, type }) => {
  const id = addTask({ file, type, kind: "upload" });
  const form = new FormData();
  form.append("file", file, file?.name || "source.pdf");
  form.append("type", type);
  form.append("name", file.name);

  void runUploadRequest({ id, endpoint: "/api/sources/save", form, processingLabel: "Saving source…" }).then(({ ok, status, data }) => {
    if (tasks.find((task) => task.id === id)?.status === "cancelled") return;
    if (ok) {
      updateTask(id, { status: "completed", phase: "completed", progress: 100, message: data.duplicate ? "Source already exists" : "Upload complete", result: data });
      return;
    }
    if (data.needsCompression || status === 413) {
      updateTask(id, { status: "needs_split", phase: "waiting", progress: 100, message: "Split confirmation required", result: data });
      return;
    }
    updateTask(id, { status: "failed", phase: "failed", message: errorText(data.error, `Failed to upload "${file.name}".`), result: data });
  });
  return id;
};

export const startSourceSplit = ({ file, type, parts, uploadJobId, name }) => {
  const taskFile = file || { name: name || "source.pdf" };
  const id = addTask({ file: taskFile, type, kind: "split" });
  const form = new FormData();
  if (file) form.append("file", file, file?.name || "source.pdf");
  if (uploadJobId) form.append("uploadJobId", uploadJobId);
  form.append("type", type);
  form.append("name", file?.name || name || "source.pdf");
  form.append("parts", String(parts));

  void runUploadRequest({ id, endpoint: "/api/sources/split-and-save", form, processingLabel: `Splitting into ${parts} parts…` }).then(({ ok, data }) => {
    if (tasks.find((task) => task.id === id)?.status === "cancelled") return;
    if (ok) {
      if (data.jobId) {
        updateTask(id, { serverJobId: String(data.jobId), phase: "processing", progress: 0, message: "Splitting PDF in background…" });
        pollSourceJob(id, data.jobId);
        return;
      }
      updateTask(id, { status: "completed", phase: "completed", progress: 100, message: data.duplicate ? "Source already exists" : `Split into ${data.partCount || parts} parts`, result: data });
      return;
    }
    updateTask(id, { status: "failed", phase: "failed", message: errorText(data.error, `Failed to split "${taskFile.name}".`), result: data });
  });
  return id;
};

export const cancelSourceTask = async (id) => {
  const task = tasks.find((candidate) => candidate.id === id);
  if (!task || task.status !== "running") return;
  requests.get(id)?.abort();
  requests.delete(id);
  const timer = pollers.get(id);
  if (timer) window.clearTimeout(timer);
  pollers.delete(id);
  updateTask(id, { status: "cancelled", phase: "cancelled", message: "Cancelling…" });
  if (task.serverJobId) {
    try {
      const token = authToken();
      const response = await fetch(apiUrl(`/api/sources/ingest/${task.serverJobId}`), {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) throw new Error("The backend could not cancel this split.");
      updateTask(id, { status: "cancelled", phase: "cancelled", message: "Splitting cancelled" });
    } catch (error) {
      updateTask(id, { status: "failed", phase: "failed", message: error.message || "Could not cancel splitting." });
    }
  } else {
    updateTask(id, { status: "cancelled", phase: "cancelled", message: "Upload cancelled" });
  }
};

export const dismissSourceTask = (id) => {
  const task = tasks.find((candidate) => candidate.id === id);
  if (task?.serverJobId) dismissedServerJobIds.add(String(task.serverJobId));
  requests.get(id)?.abort();
  requests.delete(id);
  const timer = pollers.get(id);
  if (timer) window.clearTimeout(timer);
  pollers.delete(id);
  tasks = tasks.filter((task) => task.id !== id);
  emit();
  if (task?.serverJobId) {
    const token = authToken();
    void fetch(apiUrl(`/api/sources/ingest/${task.serverJobId}`), {
      method: "DELETE",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).catch(() => {});
  }
};

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = () => tasks;

export const useSourceBackgroundTasks = () => useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
