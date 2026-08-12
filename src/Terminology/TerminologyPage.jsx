import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiUrl } from "../config/api";
import { readStoredSession } from "../utils/sessionCleanup";
import "./terminologyPage.css";

const authHeaders = () => {
  const token = readStoredSession()?.token || "";
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const formatItems = (value) => (
  Number.isFinite(Number(value)) ? Number(value).toLocaleString() : "—"
);

const UMLS_ABBREVIATION_GROUPS = [
  {
    title: "System and format",
    items: [
      ["UMLS", "Unified Medical Language System"],
      ["NLM", "National Library of Medicine"],
      ["UTS", "UMLS Terminology Services"],
      ["RRF", "Rich Release Format"],
    ],
  },
  {
    title: "Identifiers",
    items: [
      ["CUI", "Concept unique identifier"],
      ["AUI", "Atom unique identifier"],
      ["LUI", "Lexical unique identifier (term)"],
      ["SUI", "String unique identifier"],
      ["TUI", "Semantic-type unique identifier"],
      ["RUI", "Relationship unique identifier"],
      ["SCUI", "Source-asserted concept identifier"],
      ["SDUI", "Source-asserted descriptor identifier"],
      ["SAUI", "Source-asserted atom identifier"],
      ["SRUI", "Source-attributed relationship identifier"],
    ],
  },
  {
    title: "Files",
    items: [
      ["MRCONSO", "Concept names, synonyms, terms, types, and codes"],
      ["MRDEF", "Definitions"],
      ["MRSTY", "Semantic types"],
      ["MRREL", "Relationships"],
      ["MRSAB", "Source abbreviations and vocabulary metadata"],
      ["MRFILES", "Release-file metadata and row counts"],
    ],
  },
  {
    title: "Fields",
    items: [
      ["LAT", "Language of term"],
      ["TS", "Term status"],
      ["STT", "String type"],
      ["ISPREF", "Preferred-atom indicator"],
      ["SAB", "Source abbreviation"],
      ["RSAB", "Root source abbreviation"],
      ["VSAB", "Versioned source abbreviation"],
      ["TTY", "Term type in source"],
      ["STR", "Term string"],
      ["DEF", "Definition"],
      ["STY", "Semantic type"],
      ["REL", "Relationship label"],
      ["RELA", "Additional relationship label"],
      ["SL", "Source of relationship labels"],
      ["SON", "Source official name"],
      ["CODE", "Identifier or code for a string in its source"],
      ["SUPPRESS", "Suppressibility status"],
      ["CVF", "Content-view flag"],
    ],
  },
  {
    title: "REL values",
    items: [
      ["AQ", "Allowed qualifier"],
      ["CHD", "Has child relationship"],
      ["DEL", "Deleted concept"],
      ["PAR", "Has parent relationship"],
      ["QB", "Can be qualified by"],
      ["RB", "Has a broader relationship"],
      ["RL", "Similar or alike relationship"],
      ["RN", "Has a narrower relationship"],
      ["RO", "Other relationship"],
      ["RQ", "Related and possibly synonymous"],
      ["RU", "Related, unspecified"],
      ["SY", "Source-asserted synonymy"],
      ["XR", "Not related; no mapping"],
    ],
  },
];

const TerminologyPage = () => {
  const navigate = useNavigate();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [abbreviationQuery, setAbbreviationQuery] = useState("");

  const sourceAbbreviations = useMemo(() => {
    const filter = abbreviationQuery.trim().toLowerCase();
    const sources = Array.isArray(status?.sourceAbbreviations) ? status.sourceAbbreviations : [];
    if (!filter) return sources;
    return sources.filter((source) => [
      source.abbreviation,
      source.officialName,
      ...(source.versions || []).map((version) => version.abbreviation),
    ].some((value) => String(value || "").toLowerCase().includes(filter)));
  }, [abbreviationQuery, status?.sourceAbbreviations]);

  const abbreviationCount = UMLS_ABBREVIATION_GROUPS.reduce((total, group) => total + group.items.length, 0)
    + (status?.sourceAbbreviations || []).reduce((total, source) => total + 1 + (source.versions?.length || 0), 0);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(apiUrl("/api/terminology/status"), { headers: authHeaders() });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not inspect the terminology files.");
      setStatus(data);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadStatus(); }, [loadStatus]);

  const search = async (event) => {
    event.preventDefault();
    if (query.trim().length < 2) return;
    setSearching(true);
    setError("");
    try {
      const response = await fetch(apiUrl(`/api/terminology/search?q=${encodeURIComponent(query.trim())}`), { headers: authHeaders() });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Terminology search failed.");
      setResults(data.results || []);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSearching(false);
    }
  };

  return (
    <main id="terminology_page">
      <header className="terminology_header">
        <button type="button" className="terminology_back" onClick={() => navigate("/home")} aria-label="Back to Home">
          <i className="fi fi-rr-arrow-left" aria-hidden="true" />
        </button>
        <div className="terminology_identity">
          <span>AMCTOSHS Reference Services</span>
          <h1>AMCTOSHS Terminology</h1>
          <p>Local normalized UMLS concepts, terms, definitions, semantic types, relations, and source vocabularies.</p>
        </div>
        <button type="button" className="terminology_refresh" onClick={loadStatus} disabled={loading}>
          <i className={`fi fi-rr-refresh${loading ? " terminology_spin" : ""}`} aria-hidden="true" />
          <span>Refresh</span>
        </button>
      </header>

      <section className="terminology_body">
        {error && <div className="terminology_notice terminology_notice--error">{error}</div>}

        <div className="terminology_summary">
          <article>
            <span>Local RRF files</span>
            <strong>{status?.readyToRead ? "Ready" : "Waiting"}</strong>
            <small>{status?.files?.filter((file) => file.found).length || 0} / {status?.files?.length || 5} detected</small>
          </article>
          <article>
            <span>Local reference items</span>
            <strong>{formatItems(status?.totalItems)}</strong>
            <small>Records across detected sections</small>
          </article>
          <article>
            <span>Detected release</span>
            <strong>{status?.release || "—"}</strong>
            <small>Read directly from disk</small>
          </article>
        </div>

        <section className="terminology_panel terminology_import_panel">
          <div className="terminology_panel_heading">
            <div>
              <span>01 / Local workspace</span>
              <h2>UMLS RRF files</h2>
            </div>
            <span className={`terminology_state ${status?.readyToRead ? "terminology_state--ready" : ""}`}>
              <i aria-hidden="true" /> {status?.readyToRead ? "Ready to read" : "Waiting for files"}
            </span>
          </div>
          <p className="terminology_path"><span>Local folder</span><code>{status?.filesDirectory || "Loading…"}</code></p>
          <div className="terminology_table_wrap">
            <table className="terminology_table">
              <thead><tr><th>File</th><th>Purpose</th><th>Local section</th><th>Items</th><th>Status</th></tr></thead>
              <tbody>
                {(status?.files || []).map((file) => (
                  <tr key={file.name}>
                    <td><code>{file.name}</code>{file.required && <em>Required</em>}</td>
                    <td>{file.description}</td>
                    <td>{file.key === "semanticTypes" ? "Semantic types" : `${file.key.charAt(0).toUpperCase()}${file.key.slice(1)}`}</td>
                    <td>{file.found ? formatItems(file.itemCount) : "—"}</td>
                    <td><span className={`terminology_file_status ${file.found ? "terminology_file_status--found" : ""}`}>{file.found ? "Detected" : "Missing"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="terminology_command">
            <p>The backend reads these files on demand. No upload, MongoDB import, or duplication is performed.</p>
            <code>TERMINOLOGY_FILES_DIR={status?.filesDirectory || "./terminology-service/imports"}</code>
          </div>
        </section>

        <section className="terminology_panel">
          <div className="terminology_panel_heading">
            <div><span>02 / Local reference</span><h2>Direct-file sections</h2></div>
            <span className="terminology_database_live"><i aria-hidden="true" /> Local only</span>
          </div>
          <div className="terminology_collection_grid">
            {(status?.files || []).map((file) => (
              <article key={file.name}><span>{file.key === "semanticTypes" ? "Semantic types" : `${file.key.charAt(0).toUpperCase()}${file.key.slice(1)}`}</span><strong>{file.found ? formatItems(file.itemCount) : "Missing"}</strong><code>{file.name}</code></article>
            ))}
          </div>
        </section>

        <section className="terminology_panel">
          <div className="terminology_panel_heading terminology_search_heading">
            <div><span>03 / Reference</span><h2>Search local terminology</h2></div>
            <form onSubmit={search} className="terminology_search">
              <i className="fi fi-rr-search" aria-hidden="true" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search a concept or synonym" />
              <button type="submit" disabled={searching || query.trim().length < 2}>{searching ? "Searching…" : "Search"}</button>
            </form>
          </div>
          <div className="terminology_table_wrap">
            <table className="terminology_table terminology_reference_table terminology_reference_table--simple">
              <thead><tr><th>Concept ID</th><th>Concept</th><th>Definition</th><th>Unified strings</th></tr></thead>
              <tbody>
                {results.length ? results.map((concept) => (
                  <tr key={concept.cui}>
                    <td><code>{concept.cui || "—"}</code></td>
                    <td><strong>{concept.preferredName || "—"}</strong></td>
                    <td className="terminology_definition">{concept.definition || "No definition available."}</td>
                    <td>
                      <details className="terminology_unified_strings">
                        <summary><strong>{formatItems(concept.unifiedStringCount)}</strong> strings</summary>
                        <ul>{(concept.unifiedStrings || []).map((string) => <li key={string}>{string}</li>)}</ul>
                      </details>
                    </td>
                  </tr>
                )) : <tr><td colSpan="4" className="terminology_empty">Search for a term to see which strings UMLS unifies under each concept.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section className="terminology_panel terminology_abbreviation_panel" aria-labelledby="terminology-abbreviations-heading">
          <div className="terminology_panel_heading">
            <div>
              <span>04 / Keywords</span>
              <h2 id="terminology-abbreviations-heading">UMLS abbreviation key</h2>
            </div>
            <span className="terminology_abbreviation_count">
              {formatItems(abbreviationCount)} terms
            </span>
          </div>
          <div className="terminology_abbreviation_groups">
            {UMLS_ABBREVIATION_GROUPS.map((group) => (
              <section key={group.title} className="terminology_abbreviation_group">
                <h3>{group.title}</h3>
                <dl>
                  {group.items.map(([abbreviation, meaning]) => (
                    <div key={abbreviation} className="terminology_abbreviation_item">
                      <dt><code>{abbreviation}</code></dt>
                      <dd>{meaning}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
          <section className="terminology_source_abbreviations" aria-labelledby="terminology-source-abbreviations-heading">
            <div className="terminology_source_abbreviations_heading">
              <div>
                <h3 id="terminology-source-abbreviations-heading">Source vocabularies</h3>
                <p>Every root and versioned source abbreviation read from the local <code>MRSAB.RRF</code> release.</p>
              </div>
              <label className="terminology_abbreviation_search">
                <i className="fi fi-rr-search" aria-hidden="true" />
                <input
                  value={abbreviationQuery}
                  onChange={(event) => setAbbreviationQuery(event.target.value)}
                  placeholder="Find MSH, SNOMEDCT, LNC…"
                  aria-label="Search UMLS source abbreviations"
                />
              </label>
            </div>
            <div className="terminology_source_abbreviation_grid">
              {sourceAbbreviations.map((source) => (
                <article key={source.abbreviation} className="terminology_source_abbreviation_item">
                  <div>
                    <code>{source.abbreviation}</code>
                    <span>{source.officialName || "Source vocabulary"}</span>
                  </div>
                  {source.versions?.length > 0 && (
                    <ul aria-label={`Versioned abbreviations for ${source.abbreviation}`}>
                      {source.versions.map((version) => (
                        <li key={version.abbreviation}>
                          <code>{version.abbreviation}</code>
                          {version.version && <small>{version.version}</small>}
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              ))}
              {!sourceAbbreviations.length && (
                <p className="terminology_source_abbreviation_empty">
                  {status?.sourceAbbreviations?.length ? "No abbreviations match this search." : "No source abbreviations were found in MRSAB.RRF."}
                </p>
              )}
            </div>
          </section>
        </section>
      </section>
    </main>
  );
};

export default TerminologyPage;
