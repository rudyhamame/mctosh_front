import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiUrl } from "../config/api";
import { readStoredSession } from "../utils/sessionCleanup";
import "./rabbitHoleHyleEntities4D.css";

const authHeaders = () => {
  const token = readStoredSession()?.token || "";
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const formatDate = (value) => {
  if (!value) return "No timestamp";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "No timestamp" : date.toLocaleString();
};

const accessMode = (source) => {
  const explicit = source?.modeOfAccess || source?.mode_of_access;
  if (explicit) return explicit;
  if (["youtube", "podcast"].includes(source?.type)) return "Sight + Hearing";
  if (source?.type === "image") return "Sight";
  return "Sight · Text";
};

export default function RabbitHoleHyleEntities4DPage() {
  const navigate = useNavigate();
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const response = await fetch(apiUrl("/api/sources/"), { headers: authHeaders() });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Could not load Hyle entities.");
        if (alive) setSources(payload.sources || []);
      } catch (cause) {
        if (alive) setError(cause.message || "Could not load Hyle entities.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  return (
    <main className="rh4d_page">
      <header className="rh4d_header">
        <button type="button" className="rh4d_back" onClick={() => navigate(-1)} aria-label="Go back">←</button>
        <div>
          <p className="rh4d_kicker">RabbitHole · Hyle · 4D</p>
          <h1>RabbitHole Hylomorphic Entities in 4D Mode</h1>
          <p className="rh4d_subtitle">View each Hyle entity as a persistent identity across its saved states and representations.</p>
        </div>
      </header>

      <section className="rh4d_definition" aria-label="4D mode definition">
        <strong>4D Mode</strong>
        <span>Identity through change · the entity remains itself while its accessible representations and states change over time.</span>
      </section>

      {error && <div className="rh4d_error" role="alert">{error}</div>}
      {loading && <div className="rh4d_empty">Loading Hyle entities…</div>}
      {!loading && !error && sources.length === 0 && <div className="rh4d_empty">No Hyle entities have been added yet.</div>}

      {!loading && !error && sources.length > 0 && (
        <section className="rh4d_entity_grid" aria-label="Hyle entities">
          {sources.map((source) => (
            <article className="rh4d_entity" key={source._id}>
              <div className="rh4d_entity_topline">
                <span className="rh4d_entity_id">HYLE ENTITY</span>
                <span className="rh4d_entity_state">persistent</span>
              </div>
              <h2>{source.name || "Unnamed entity"}</h2>
              <dl>
                <div><dt>Mode of access</dt><dd>{accessMode(source)}</dd></div>
                <div><dt>Representation</dt><dd>{source.format || source.type || "—"}</dd></div>
                <div><dt>Observed state</dt><dd>{source.ocrStatus || "saved"}</dd></div>
                <div><dt>Last change</dt><dd>{formatDate(source.updatedAt || source.createdAt)}</dd></div>
              </dl>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
