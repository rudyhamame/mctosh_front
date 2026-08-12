import { apiUrl } from "../config/api";
import { readStoredSession } from "./sessionCleanup";

const headers = () => {
  const token = readStoredSession()?.token || "";
  return token ? { Authorization: `Bearer ${token}` } : {};
};
const parse = async (response) => {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || data.error || "Vocabulary request failed.");
  return data;
};
export const saveVocabulary = async (vocabulary) => parse(await fetch(apiUrl("/api/vocabs/saved"), { method: "POST", headers: { ...headers(), "Content-Type": "application/json" }, body: JSON.stringify(vocabulary) }));
export const updateVocabulary = async (id, vocabulary) => parse(await fetch(apiUrl("/api/vocabs/saved/" + encodeURIComponent(id)), { method: "PUT", headers: { ...headers(), "Content-Type": "application/json" }, body: JSON.stringify(vocabulary) }));
export const listSavedVocabulary = async () => parse(await fetch(apiUrl("/api/vocabs/saved"), { headers: headers() }));
export const deleteSavedVocabulary = async (id) => parse(await fetch(apiUrl(`/api/vocabs/saved/${encodeURIComponent(id)}`), { method: "DELETE", headers: headers() }));
