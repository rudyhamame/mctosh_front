import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

const LOCAL_TERMINOLOGY_WORDS = [
  {
    cui: "LOCAL-TTY",
    preferredName: "TTY",
    tty: "TTY",
    sty: "—",
    definition: "Term Type: the type of term or source name represented in a terminology source.",
    definitionSource: "RabbitHole local terminology",
    unifiedStrings: ["TTY", "Term Type"],
  },
  {
    cui: "LOCAL-STY",
    preferredName: "STY",
    tty: "—",
    sty: "STY",
    definition: "Semantic Type: the semantic category assigned to a terminology concept.",
    definitionSource: "RabbitHole local terminology",
    unifiedStrings: ["STY", "Semantic Type"],
  },
];

const REFERENCE_COLUMNS = [
  { key: "cui", label: "ID (CUI)", className: "terminology_reference_cell--id" },
  { key: "concept", label: "Value", className: "terminology_reference_cell--concept" },
  { key: "sty", label: "Semantic Type (STY)", className: "terminology_reference_cell--sty" },
  { key: "abbreviations", label: "Abbreviations", className: "terminology_reference_cell--abbreviations" },
  { key: "definitionAui", label: "AUI", className: "terminology_reference_cell--definition-aui" },
  { key: "definitionValue", label: "Value", className: "terminology_reference_cell--definition-value" },
  { key: "definitionSource", label: "Source (SAB)", className: "terminology_reference_cell--definition-source" },
  { key: "stringSui", label: "ID (SUI)", className: "terminology_reference_cell--string-sui" },
  { key: "stringValue", label: "Value", className: "terminology_reference_cell--string-value" },
  { key: "stringTty", label: "Term Type (TTY)", className: "terminology_reference_cell--string-tty" },
];

const REFERENCE_TABS = [
  { key: "concepts", label: "Concepts", keys: ["abbreviations"] },
  { key: "definitions", label: "Definitions", keys: ["definitionAui", "definitionValue", "definitionSource"] },
  { key: "strings", label: "Strings", keys: ["stringSui", "stringValue", "stringTty"] },
];

const CONCEPT_IDENTITY_KEYS = ["cui", "concept", "sty"];
const referenceColumnsFor = (tabKey) => REFERENCE_COLUMNS.filter((column) => (
  CONCEPT_IDENTITY_KEYS.includes(column.key)
  || REFERENCE_TABS.find((tab) => tab.key === tabKey)?.keys.includes(column.key)
));

const referenceHeaderLayoutFor = (tabKey) => [
  { type: "group", label: "Concept", keys: tabKey === "concepts" ? [...CONCEPT_IDENTITY_KEYS, "abbreviations"] : CONCEPT_IDENTITY_KEYS },
  ...(tabKey === "concepts"
    ? []
    : [{ type: "group", label: REFERENCE_TABS.find((tab) => tab.key === tabKey)?.label || "", keys: REFERENCE_TABS.find((tab) => tab.key === tabKey)?.keys || [] }]),
];

const stringItemsFor = (concept) => (
  Array.isArray(concept.stringItems) && concept.stringItems.length
    ? concept.stringItems
    : (concept.unifiedStrings || []).map((value) => ({ sui: "", value, tty: "" }))
);

const renderStringList = (concept, property) => {
  const items = stringItemsFor(concept);
  if (!items.length) return "—";
  return (
    <ul className="terminology_string_values">
      {items.map((item, index) => <li key={`${item.sui || "string"}-${item.value}-${index}`}>{item[property] || "—"}</li>)}
    </ul>
  );
};

const definitionItemsFor = (concept) => (
  Array.isArray(concept.definitionItems) && concept.definitionItems.length
    ? concept.definitionItems
    : (concept.definition ? [{ aui: "", value: concept.definition, source: concept.definitionSource || "" }] : [])
);

const renderDefinitionCell = (item, column) => {
  const values = { definitionAui: item.aui, definitionValue: item.value, definitionSource: item.source };
  return values[column.key] || "—";
};

const renderDefinitionList = (concept, property) => {
  const items = definitionItemsFor(concept);
  if (!items.length) return "—";
  return (
    <ul className="terminology_definition_values">
      {items.map((item, index) => <li key={`${item.aui || "definition"}-${index}`}>{item[property] || "—"}</li>)}
    </ul>
  );
};

const renderAbbreviations = (concept) => {
  const items = Array.isArray(concept.abbreviations) ? concept.abbreviations : [];
  if (!items.length) return "—";
  const visibleItems = items.slice(0, 3);
  return (
    <div className="terminology_abbreviation_values">
      <div className="terminology_abbreviation_chips">
        {visibleItems.map((item, index) => <span key={`${item.str}-${item.aui || index}`} title={`${item.tty || ""}${item.sab ? ` · ${item.sab}` : ""}`}>{item.str}</span>)}
      </div>
      {items.length > visibleItems.length && (
        <details>
          <summary>+{items.length - visibleItems.length} more</summary>
          <ul>{items.slice(3).map((item, index) => <li key={`${item.str}-${item.aui || index}`}>{item.str}</li>)}</ul>
        </details>
      )}
    </div>
  );
};

const renderReferenceCell = (concept, column) => {
  switch (column.key) {
    case "cui":
      return <code>{concept.cui || "—"}</code>;
    case "concept":
      return (
        <div className="terminology_concept_value">
          <strong>{concept.preferredName || "—"}</strong>
          {String(concept.cui || "").startsWith("LOCAL-") && <span className="terminology_local_badge">Local</span>}
        </div>
      );
    case "abbreviations":
      return renderAbbreviations(concept);
    case "sty":
      return <code className="terminology_value_badge">{concept.sty || "—"}</code>;
    case "definitionAui":
      return renderDefinitionList(concept, "aui");
    case "definitionValue":
      return renderDefinitionList(concept, "value");
    case "definitionSource":
      return renderDefinitionList(concept, "source");
    case "stringSui":
      return renderStringList(concept, "sui");
    case "stringValue":
      return renderStringList(concept, "value");
    case "stringTty":
      return renderStringList(concept, "tty");
    default:
      return "—";
  }
};

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
  const [searchLanguages, setSearchLanguages] = useState(["ENG", "ARA"]);
  const [abbreviationQuery, setAbbreviationQuery] = useState("");
  const [referenceTab, setReferenceTab] = useState("concepts");
  const searchAbortRef = useRef(null);

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
    if (query.trim().length < 2 || !searchLanguages.length) return;
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;
    const searchQuery = query.trim();
    setSearching(true);
    setError("");
    setResults([]);
    try {
      const languages = searchLanguages.join(",");
      const response = await fetch(apiUrl(`/api/terminology/search?q=${encodeURIComponent(searchQuery)}&languages=${encodeURIComponent(languages)}&stream=1`), {
        headers: authHeaders(),
        signal: controller.signal,
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Terminology search failed.");
      }
      if (!response.body) throw new Error("Terminology search stream is unavailable.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const streamedResults = new Map();
      const appendResult = (item) => {
        if (!item?.cui || streamedResults.has(item.cui)) streamedResults.set(item?.cui || `result-${streamedResults.size}`, item);
        else streamedResults.set(item.cui, item);
        setResults([...streamedResults.values()]);
      };
      const processEvents = (chunk) => {
        chunk.split("\n\n").filter(Boolean).forEach((rawEvent) => {
          const eventName = rawEvent.match(/^event:\s*(.+)$/m)?.[1] || "message";
          const dataLine = rawEvent.match(/^data:\s*(.+)$/m)?.[1];
          if (!dataLine) return;
          const payload = JSON.parse(dataLine);
          if (eventName === "result") appendResult(payload);
          if (eventName === "complete") {
            streamedResults.clear();
            (payload.results || []).forEach((item) => streamedResults.set(item.cui, item));
            setResults([...streamedResults.values()]);
          }
          if (eventName === "error") throw new Error(payload.error || "Terminology search failed.");
        });
      };
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";
        events.forEach(processEvents);
        if (done) break;
      }
      if (buffer.trim()) processEvents(buffer);
    } catch (requestError) {
      if (requestError.name === "AbortError") return;
      setError(requestError.message);
    } finally {
      if (searchAbortRef.current === controller) setSearching(false);
    }
  };

  return (
    <main id="terminology_page">
      <header className="terminology_header">
        <button type="button" className="terminology_back" onClick={() => navigate("/home")} aria-label="Back to Home">
          <i className="fi fi-rr-arrow-left" aria-hidden="true" />
        </button>
        <div className="terminology_identity">
          <span>RabbitHole Reference Services</span>
          <h1>RabbitHole Terminology</h1>
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
            <span>Unique concepts</span>
            <strong>{formatItems(status?.conceptCount)}</strong>
            <small>Distinct CUIs in MRCONSO.RRF</small>
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
              <button type="submit" disabled={searching || query.trim().length < 2 || !searchLanguages.length}>{searching ? "Searching…" : "Search"}</button>
            </form>
          </div>
          <div className="terminology_language_filters" aria-label="Search languages">
            <span>Languages</span>
            {[['ENG', 'English'], ['ARA', 'Arabic']].map(([code, label]) => (
              <label key={code}>
                <input
                  type="checkbox"
                  checked={searchLanguages.includes(code)}
                  onChange={() => setSearchLanguages((current) => current.includes(code)
                    ? current.filter((language) => language !== code)
                    : [...current, code])}
                />
                {label}
              </label>
            ))}
          </div>
          <div className="terminology_reference_tabs" role="tablist" aria-label="Terminology result categories">
            {REFERENCE_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={referenceTab === tab.key}
                className={referenceTab === tab.key ? "is-active" : ""}
                onClick={() => setReferenceTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="terminology_table_wrap terminology_reference_table_wrap">
            <table className="terminology_table terminology_reference_table terminology_reference_table--simple" key={referenceTab}>
              <caption className="terminology_visually_hidden">Local terminology search results</caption>
              <thead>
                <tr>
                  {referenceHeaderLayoutFor(referenceTab).map((item) => item.type === "group"
                    ? <th key={item.label} colSpan={item.keys.length} scope="colgroup">{item.label}</th>
                    : <th key={item.key} rowSpan="2" scope="col">{REFERENCE_COLUMNS.find((column) => column.key === item.key)?.label}</th>)}
                </tr>
                <tr>
                  {referenceHeaderLayoutFor(referenceTab).filter((item) => item.type === "group").flatMap((group) => group.keys).map((key) => {
                    const column = REFERENCE_COLUMNS.find((item) => item.key === key);
                    return <th key={key} scope="col">{column.label}</th>;
                  })}
                </tr>
              </thead>
              <tbody>
                {results.length ? results.flatMap((concept) => {
                  const columns = referenceColumnsFor(referenceTab);
                  if (referenceTab !== "definitions") {
                    return [(
                      <tr key={concept.cui} className={String(concept.cui || "").startsWith("LOCAL-") ? "terminology_reference_row--local" : undefined}>
                        {columns.map((column) => (
                          <td key={column.key} className={`terminology_reference_cell ${column.className}`} data-label={column.label}>
                            {renderReferenceCell(concept, column)}
                          </td>
                        ))}
                      </tr>
                    )];
                  }
                  const definitions = definitionItemsFor(concept);
                  const rows = definitions.length ? definitions : [{ aui: "", value: "", source: "" }];
                  return rows.map((definition, index) => (
                    <tr key={`${concept.cui}-definition-${definition.aui || index}`} className={String(concept.cui || "").startsWith("LOCAL-") ? "terminology_reference_row--local" : undefined}>
                      {index === 0 && columns.filter((column) => CONCEPT_IDENTITY_KEYS.includes(column.key)).map((column) => (
                        <td key={column.key} rowSpan={rows.length} className={`terminology_reference_cell ${column.className}`} data-label={column.label}>
                          {renderReferenceCell(concept, column)}
                        </td>
                      ))}
                      {columns.filter((column) => !CONCEPT_IDENTITY_KEYS.includes(column.key)).map((column) => (
                        <td key={column.key} className={`terminology_reference_cell ${column.className}`} data-label={column.label}>
                          {renderDefinitionCell(definition, column)}
                        </td>
                      ))}
                    </tr>
                  ));
                }) : <tr><td colSpan={referenceColumnsFor(referenceTab).length} className="terminology_empty">Search for a term to see which strings UMLS unifies under each concept.</td></tr>}
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
