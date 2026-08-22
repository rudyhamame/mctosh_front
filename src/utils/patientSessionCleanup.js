import { apiUrl } from "../config/api";

const SESSION_STORAGE_KEY = "patient_state";

export const readStoredPatientSession = () => {
  try {
    const sessionState = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (sessionState) return JSON.parse(sessionState);
    const persistedState = localStorage.getItem(SESSION_STORAGE_KEY);
    return persistedState ? JSON.parse(persistedState) : null;
  } catch (error) {
    return null;
  }
};

export const writeStoredPatientSession = (nextState) => {
  try {
    const serializedState = JSON.stringify(nextState);
    sessionStorage.setItem(SESSION_STORAGE_KEY, serializedState);
    localStorage.setItem(SESSION_STORAGE_KEY, serializedState);
  } catch (error) {
    // Ignore storage write errors.
  }
};

// Deliberately removeItem, NOT sessionStorage.clear()/localStorage.clear()
// (unlike the clinician-side sessionCleanup.js) — a clinician and patient
// can be logged in in the same browser under separate keys ("state" vs
// "patient_state"); clearing everything would wipe the other session too.
export const clearStoredPatientSession = () => {
  sessionStorage.removeItem(SESSION_STORAGE_KEY);
  localStorage.removeItem(SESSION_STORAGE_KEY);
};

export const notifyPatientBackendLogout = ({ token } = {}) => {
  if (token && typeof fetch === "function") {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeoutId = globalThis.setTimeout(() => {
      try { controller?.abort(); } catch {}
    }, 1200);

    return fetch(apiUrl("/api/patient-auth/logout"), {
      method: "POST",
      mode: "cors",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      keepalive: true,
      signal: controller?.signal,
    })
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => { globalThis.clearTimeout(timeoutId); });
  }
  return Promise.resolve();
};

export const logoutStoredPatientSession = ({ clear = true } = {}) => {
  const storedSession = readStoredPatientSession();
  return notifyPatientBackendLogout({ token: storedSession?.token }).finally(() => {
    if (clear) clearStoredPatientSession();
  });
};
