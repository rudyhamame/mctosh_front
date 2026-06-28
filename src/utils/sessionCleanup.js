import { apiUrl } from "../config/api";

const SESSION_STORAGE_KEY = "state";

export const readStoredSession = () => {
  try {
    const sessionState = sessionStorage.getItem(SESSION_STORAGE_KEY);

    if (sessionState) {
      return JSON.parse(sessionState);
    }

    const persistedState = localStorage.getItem(SESSION_STORAGE_KEY);
    return persistedState ? JSON.parse(persistedState) : null;
  } catch (error) {
    return null;
  }
};

export const writeStoredSession = (nextState) => {
  try {
    const serializedState = JSON.stringify(nextState);
    sessionStorage.setItem(SESSION_STORAGE_KEY, serializedState);
    localStorage.setItem(SESSION_STORAGE_KEY, serializedState);
  } catch (error) {
    // Ignore storage write errors.
  }
};

export const clearStoredSession = () => {
  sessionStorage.clear();
  localStorage.clear();
};

export const notifyBackendLogout = ({ userId, token } = {}) => {
  if (token && typeof fetch === "function") {
    const controller =
      typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeoutId = globalThis.setTimeout(() => {
      try {
        controller?.abort();
      } catch {}
    }, 1200);

    return fetch(apiUrl("/api/user/logout"), {
      method: "POST",
      mode: "cors",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      keepalive: true,
      signal: controller?.signal,
    })
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => {
        globalThis.clearTimeout(timeoutId);
      });
  }

  return Promise.resolve();
};

export const logoutStoredSession = ({ clear = true, tokenless = false } = {}) => {
  const storedSession = readStoredSession();

  return notifyBackendLogout({
    userId: storedSession?.my_id,
    token: tokenless ? "" : storedSession?.token,
  }).finally(() => {
    if (clear) {
      clearStoredSession();
    }
  });
};
