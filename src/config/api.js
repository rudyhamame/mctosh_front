const DEV_API_BASE_URL = (() => {
  if (typeof window === "undefined") {
    return "https://localhost:4000";
  }

  // In development, route API calls through the Vite origin. This is
  // important when the Reader is opened on another device: that device's
  // localhost is not the laptop running the backend. Vite's /api proxy then
  // sends both devices to the same backend instance.
  return window.location.origin;
})();

const DEFAULT_API_BASE_URL = import.meta.env.DEV
  ? DEV_API_BASE_URL
  : "https://rabbithole-api.mctoshs.ca";

const PROD_ENV_API_BASE_URL = String(
  import.meta.env.VITE_API_BASE_URL || "",
).trim();
export const API_BASE_URL = (
  import.meta.env.DEV
    ? DEV_API_BASE_URL
    : PROD_ENV_API_BASE_URL || DEFAULT_API_BASE_URL
).replace(/\/+$/, "");

export const apiUrl = (path) => `${API_BASE_URL}${path}`;
