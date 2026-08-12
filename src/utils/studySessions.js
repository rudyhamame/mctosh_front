import { apiUrl } from "../config/api";
import { readStoredSession } from "./sessionCleanup";

const authHeaders = () => {
  const token = readStoredSession()?.token || "";
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const parseResponse = async (response) => {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || data.error || "Study session request failed.");
  return data;
};

export const listStudySessions = async (signal) => (
  parseResponse(await fetch(apiUrl("/api/study-sessions"), { headers: authHeaders(), signal }))
);

export const startStudySession = async () => (
  parseResponse(await fetch(apiUrl("/api/study-sessions"), {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({}),
  }))
);

export const stopStudySession = async (id) => (
  parseResponse(await fetch(apiUrl(`/api/study-sessions/${encodeURIComponent(id)}/stop`), {
    method: "POST",
    headers: authHeaders(),
  }))
);

export const deleteStudySession = async (id) => (
  parseResponse(await fetch(apiUrl(`/api/study-sessions/${encodeURIComponent(id)}`), {
    method: "DELETE",
    headers: authHeaders(),
  }))
);
