const DEV_API_BASE_URL = (() => {
  if (typeof window === "undefined") {
    return "http://localhost:4000";
  }

  if (window.location.protocol === "https:") {
    return window.location.origin;
  }

  const currentHostname = String(window.location.hostname || "").trim();

  if (["localhost", "127.0.0.1"].includes(currentHostname)) {
    return "http://localhost:4000";
  }

  return `http://${currentHostname}:4000`;
})();

const DEFAULT_API_BASE_URL = import.meta.env.DEV
  ? DEV_API_BASE_URL
  : "https://mctosh-back.onrender.com";

const PROD_ENV_API_BASE_URL = String(
  import.meta.env.VITE_API_BASE_URL || "",
).trim();
const DEV_ENV_API_BASE_URL = String(
  import.meta.env.VITE_API_BASE_URL_DEV || "",
).trim();

const isSecureDevContext =
  import.meta.env.DEV &&
  typeof window !== "undefined" &&
  window.location.protocol === "https:";

export const API_BASE_URL = (
  import.meta.env.DEV
    ? isSecureDevContext
      ? DEFAULT_API_BASE_URL
      : DEV_ENV_API_BASE_URL || DEFAULT_API_BASE_URL
    : PROD_ENV_API_BASE_URL || DEFAULT_API_BASE_URL
).replace(/\/+$/, "");

export const apiUrl = (path) => `${API_BASE_URL}${path}`;
