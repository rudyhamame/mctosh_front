import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useHistory } from "react-router-dom";
import { apiUrl } from "../config/api";
import { readStoredSession } from "../utils/sessionCleanup";
import "./phenomenaPage.css";

const authFetch = (url, options = {}) => {
  const token = readStoredSession()?.token || "";
  return fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` },
  });
};

const MEANS = [
  { key: "eye",    label: "Eye" },
  { key: "ear",    label: "Ear" },
  { key: "tongue", label: "Tongue" },
  { key: "skin",   label: "Skin" },
  { key: "nose",   label: "Nose" },
];

const MODES = [
  { key: "sub-molecule", label: "sub-Molecule", sub: true  },
  { key: "molecule",     label: "Molecule",     sub: false },
  { key: "sub-cell",     label: "sub-Cell",     sub: true  },
  { key: "cell",         label: "Cell",         sub: false },
  { key: "sub-tissue",   label: "sub-Tissue",   sub: true  },
  { key: "tissue",       label: "Tissue",       sub: false },
  { key: "sub-organ",    label: "sub-Organ",    sub: true  },
  { key: "organ",        label: "Organ",        sub: false },
  { key: "sub-system",   label: "sub-System",   sub: true  },
  { key: "system",       label: "System",       sub: false },
  { key: "sub-human",    label: "sub-Human",    sub: true  },
  { key: "human",        label: "Human",        sub: false },
];

const key = (noun, mode) => `${noun}::${mode}`;

const PhenomenaPage = () => {
  const history = useHistory();
  const [pool, setPool]             = useState([]);  // [{noun, mode}] from PDF extractions
  const [assignments, setAssignments] = useState({}); // { "noun::mode": Phenomenon doc }
  const [loading, setLoading]       = useState(true);
  const [activeMeans, setActiveMeans] = useState("all");
  const [saving, setSaving]         = useState({});   // { "noun::mode": true }
  const [formNoun, setFormNoun]     = useState("");   // "noun::mode"
  const [formMeans, setFormMeans]   = useState("");

  // ── Load pool + existing assignments ──────────────────────────────────────
  useEffect(() => {
    Promise.all([
      authFetch(apiUrl("/api/phenomena/pool")).then((r) => r.json()),
      authFetch(apiUrl("/api/phenomena")).then((r) => r.json()),
    ])
      .then(([poolData, assignData]) => {
        setPool(poolData.pool || []);
        const map = {};
        for (const p of assignData.phenomena || []) {
          map[key(p.phenomenon, p.mode)] = p;
        }
        setAssignments(map);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // ── Assign / change / remove a means ─────────────────────────────────────
  const handleMeansChange = useCallback(async (noun, mode, newMeans) => {
    const k        = key(noun, mode);
    const existing = assignments[k];

    setSaving((s) => ({ ...s, [k]: true }));

    try {
      if (!newMeans && existing) {
        // Remove assignment
        await authFetch(apiUrl(`/api/phenomena/${existing._id}`), { method: "DELETE" });
        setAssignments((a) => { const n = { ...a }; delete n[k]; return n; });

      } else if (newMeans && !existing) {
        // Create assignment
        const res  = await authFetch(apiUrl("/api/phenomena"), {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ phenomenon: noun, means: newMeans, mode }),
        });
        const data = await res.json();
        if (res.ok) setAssignments((a) => ({ ...a, [k]: data.phenomenon }));

      } else if (newMeans && existing && existing.means !== newMeans) {
        // Update means
        const res  = await authFetch(apiUrl(`/api/phenomena/${existing._id}`), {
          method:  "PATCH",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ means: newMeans }),
        });
        const data = await res.json();
        if (res.ok) setAssignments((a) => ({ ...a, [k]: data.phenomenon }));
      }
    } catch {}

    setSaving((s) => { const n = { ...s }; delete n[k]; return n; });
  }, [assignments]);

  // ── Form add ─────────────────────────────────────────────────────────────
  const handleFormAdd = useCallback(async () => {
    if (!formNoun || !formMeans) return;
    const [noun, mode] = formNoun.split("::");
    await handleMeansChange(noun, mode, formMeans);
    setFormNoun("");
    setFormMeans("");
  }, [formNoun, formMeans, handleMeansChange]);

  // ── Filter pool by active means tab ───────────────────────────────────────
  const filteredPool = useMemo(() => {
    if (activeMeans === "all") return pool;
    return pool.filter(({ noun, mode: m }) => assignments[key(noun, m)]?.means === activeMeans);
  }, [pool, assignments, activeMeans]);

  // Build means → count map for tab badges
  const countByMeans = useMemo(() => {
    const map = {};
    for (const { noun, mode: m } of pool) {
      const a = assignments[key(noun, m)];
      if (a) map[a.means] = (map[a.means] || 0) + 1;
    }
    return map;
  }, [pool, assignments]);

  // Organise filtered pool by mode → array of nouns
  const byMode = useMemo(() => {
    const out = {};
    for (const { key: mk } of MODES) out[mk] = [];
    for (const { noun, mode: m } of filteredPool) out[m]?.push(noun);
    return out;
  }, [filteredPool]);

  return (
    <div id="phen_page">

      {/* Header */}
      <div id="phen_header">
        <button className="phen_home_btn" onClick={() => history.push("/home")} title="Home">⌂</button>
        <span id="phen_header_title">Phenomena</span>
        <span style={{ fontSize: "0.72rem", color: "var(--color-text-muted)" }}>
          {pool.length} extracted · {Object.keys(assignments).length} assigned
        </span>
      </div>

      {/* Add form */}
      <div id="phen_add_form">
        <select
          id="phen_form_noun"
          value={formNoun}
          onChange={(e) => setFormNoun(e.target.value)}
          disabled={pool.length === 0}
        >
          <option value="">— Select phenomenon —</option>
          {pool.map(({ noun, mode: m }) => (
            <option key={`${noun}::${m}`} value={`${noun}::${m}`}>
              {noun}  ({m})
            </option>
          ))}
        </select>

        <select
          id="phen_form_means"
          value={formMeans}
          onChange={(e) => setFormMeans(e.target.value)}
        >
          <option value="">— Mean of access —</option>
          {MEANS.map(({ key: mk, label }) => (
            <option key={mk} value={mk}>{label}</option>
          ))}
        </select>

        <button
          id="phen_form_add"
          onClick={handleFormAdd}
          disabled={!formNoun || !formMeans}
        >
          Add
        </button>
      </div>

      {/* Sense filter tabs */}
      <div id="phen_sense_tabs">
        <button
          className={`phen_sense_tab${activeMeans === "all" ? " phen_sense_tab--active-all" : ""}`}
          onClick={() => setActiveMeans("all")}
        >
          All
          {pool.length > 0 && <span className="phen_tab_count">{pool.length}</span>}
        </button>
        {MEANS.map(({ key: mk, label }) => (
          <button
            key={mk}
            className={`phen_sense_tab phen_sense_tab--${mk}${activeMeans === mk ? " phen_sense_tab--active" : ""}`}
            onClick={() => setActiveMeans(mk)}
          >
            {label}
            {countByMeans[mk] > 0 && <span className="phen_tab_count">{countByMeans[mk]}</span>}
          </button>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <div className="phen_state">Loading…</div>
      ) : pool.length === 0 ? (
        <div className="phen_state">No phenomena extracted yet — use the Hyles page to extract hyles.</div>
      ) : (
        <div id="phen_table_wrap">
          <table className="phen_table">
            <thead>
              <tr>
                <th>Phenomenon</th>
                <th>Mode</th>
                <th>Means of access</th>
              </tr>
            </thead>
            <tbody>
              {filteredPool.map(({ noun, mode: m }) => {
                const k       = key(noun, m);
                const current = assignments[k]?.means || "";
                const isBusy  = saving[k];
                return (
                  <tr key={k} className={current ? `phen_row--${current}` : ""}>
                    <td className="phen_td_noun">{noun}</td>
                    <td className="phen_td_mode">{m}</td>
                    <td className="phen_td_means">
                      <select
                        className="phen_chip_select"
                        value={current}
                        disabled={isBusy}
                        onChange={(e) => handleMeansChange(noun, m, e.target.value)}
                      >
                        <option value="">—</option>
                        {MEANS.map(({ key: sk, label }) => (
                          <option key={sk} value={sk}>{label}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default PhenomenaPage;
