// Shared YouTube IFrame Player API loader — this exact loadYTApi/
// extractVideoId pair was already duplicated verbatim between
// src/YouTube/YouTubePage.jsx and src/Hylomorphism/YouTubeSourcePage.jsx;
// factored out here so a third caller (PDF/SmartVideoPanel.jsx) doesn't
// triple it. Deliberately not retrofitted into those two existing files —
// they work today and aren't part of this change.
let ytApiReady = false;
let ytApiCallbacks = [];
export const loadYTApi = (cb) => {
  if (ytApiReady) { cb(); return; }
  ytApiCallbacks.push(cb);
  if (document.getElementById("yt_iframe_api")) return;
  window.onYouTubeIframeAPIReady = () => {
    ytApiReady = true;
    ytApiCallbacks.forEach((f) => f());
    ytApiCallbacks = [];
  };
  const s = document.createElement("script");
  s.id = "yt_iframe_api";
  s.src = "https://www.youtube.com/iframe_api";
  document.head.appendChild(s);
};

export const extractVideoId = (url = "") => {
  try {
    const u = new URL(url);
    let vid = u.searchParams.get("v");
    if (!vid) {
      const m = url.match(/(?:youtu\.be\/|\/embed\/|\/shorts\/)([A-Za-z0-9_-]{11})/);
      vid = m?.[1] ?? null;
    }
    return vid;
  } catch { return null; }
};
