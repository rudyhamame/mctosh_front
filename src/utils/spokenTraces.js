import { apiUrl } from "../config/api";
import { readStoredSession } from "./sessionCleanup";

const headers = () => {
  const token = readStoredSession()?.token || "";
  return {
    ...(token ? { Authorization: "Bearer " + token } : {}),
    "Content-Type": "application/json",
  };
};

const parse = async (response) => {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error?.message || data.error || "Spoken trace request failed.");
  }
  return data;
};

export const listSpokenTraces = async (signal) => parse(await fetch(apiUrl("/api/spoken-traces"), {
  headers: headers(),
  signal,
}));

export const createSpokenTrace = async (input) => parse(await fetch(apiUrl("/api/spoken-traces"), {
  method: "POST",
  headers: headers(),
  body: JSON.stringify(input),
}));

export const updateSpokenTrace = async (id, input) => parse(await fetch(apiUrl("/api/spoken-traces/" + encodeURIComponent(id)), {
  method: "PUT",
  headers: headers(),
  body: JSON.stringify(input),
}));

export const deleteSpokenTrace = async (id) => parse(await fetch(apiUrl("/api/spoken-traces/" + encodeURIComponent(id)), {
  method: "DELETE",
  headers: headers(),
}));
