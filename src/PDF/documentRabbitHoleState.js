export const RABBIT_HOLE_BUSY_STATUSES = Object.freeze(["preflighting", "running", "pausing", "cancelling"]);

export const isRabbitHoleBusy = (status) => RABBIT_HOLE_BUSY_STATUSES.includes(status);

export const backendRunToRabbitHoleStatus = (run) => {
  if (["complete", "complete-with-unresolved", "partial"].includes(run?.status)) return "complete";
  if (run?.status === "paused") return "paused";
  if (run?.status === "cancelled") return "cancelled";
  if (["failed", "interrupted"].includes(run?.status)) return "error";
  if (run?.status === "pausing") return "pausing";
  if (run?.status === "cancelling" || run?.cancelRequested) return "cancelling";
  return "running";
};

export const rabbitHoleStatusTitle = (status) => ({
  complete: "Backend reconstruction complete",
  paused: "Backend reconstruction paused",
  pausing: "Pausing backend reconstruction",
  cancelled: "Backend reconstruction cancelled",
  cancelling: "Cancelling backend reconstruction",
  error: "Backend reconstruction stopped",
})[status] || "Reconstructing document in the background";

const dateMilliseconds = (value) => {
  const milliseconds = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(milliseconds) ? milliseconds : null;
};

export const calculateRabbitHoleOverallProgress = (run, now = Date.now()) => {
  const progress = run?.progress || {};
  const pageCount = Math.max(0, Number(progress.pageCount) || 0);
  const boundedPages = (value) => Math.min(pageCount, Math.max(0, Number(value) || 0));
  const finalizationComplete = Boolean(
    progress.finalizationComplete
    || ["complete", "complete-with-unresolved", "partial"].includes(run?.status),
  );
  const totalUnits = Math.max(1, pageCount * 3 + 1);
  const completedUnits = boundedPages(progress.extractedPages)
    + boundedPages(progress.reconstructedPages)
    + boundedPages(progress.completedPages)
    + (finalizationComplete ? 1 : 0);
  const fraction = finalizationComplete ? 1 : Math.min(0.999, completedUnits / totalUnits);
  const startedAt = dateMilliseconds(run?.createdAt);
  const stoppedAt = dateMilliseconds(run?.completedAt)
    ?? dateMilliseconds(run?.pausedAt)
    ?? Math.max(0, Number(now) || Date.now());
  const elapsedMs = startedAt == null ? null : Math.max(0, stoppedAt - startedAt);
  const estimatedTotalMs = !finalizationComplete && elapsedMs != null && fraction > 0
    ? elapsedMs / fraction
    : elapsedMs;
  const remainingMs = finalizationComplete
    ? 0
    : estimatedTotalMs == null ? null : Math.max(0, estimatedTotalMs - elapsedMs);

  return {
    completedUnits,
    totalUnits,
    fraction,
    percent: finalizationComplete ? 100 : Math.min(99.9, fraction * 100),
    elapsedMs,
    estimatedTotalMs,
    remainingMs,
    finalizationComplete,
  };
};

export const formatRabbitHoleDuration = (milliseconds) => {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "";
  const totalMinutes = Math.max(1, Math.ceil(milliseconds / 60_000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${totalMinutes}m`;
};
