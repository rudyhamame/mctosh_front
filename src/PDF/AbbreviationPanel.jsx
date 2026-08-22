import React, { useMemo, useState } from "react";
import "./abbreviationPanel.css";

const STATUS_LABELS = {
  confirmed: "Confirmed",
  candidate: "Candidate",
  unresolved: "Unresolved",
};

const STATUS_FILTERS = [
  { status: "confirmed", label: "confirmed" },
  { status: "candidate", label: "candidates" },
  { status: "unresolved", label: "unresolved" },
];

const AbbreviationPanel = ({ width, onResizeStart, onClose, pageNum, entries = [], loading = false, error = "", progress = null }) => {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [statusFilter, setStatusFilter] = useState(null);
  const filteredEntries = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return entries.filter((entry) => (
      (!statusFilter || entry.status === statusFilter)
      && (!needle || `${entry.shortForm} ${entry.longForm}`.toLowerCase().includes(needle))
    ));
  }, [entries, query, statusFilter]);
  const selected = filteredEntries.find((entry) => entry.id === selectedId) || null;

  return (
    <aside id="abbreviation_panel" style={width ? { width } : undefined} aria-label="Abbreviations">
      <div className="pdf_aside_resize_handle" onMouseDown={onResizeStart} onTouchStart={onResizeStart} />
      <header className="abbreviation_panel_header">
        <span><strong>AB</strong> Abbreviations</span>
        <small>Document · Page {pageNum}</small>
        <button type="button" onClick={onClose} title="Close Abbreviations" aria-label="Close Abbreviations">✕</button>
      </header>
      <div className="abbreviation_panel_search">
        <i className="bx bx-search" aria-hidden="true" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search short or long form" />
        {query && <button type="button" onClick={() => setQuery("")} aria-label="Clear search"><i className="bx bx-x" /></button>}
      </div>
      <div className="abbreviation_panel_summary">
        {STATUS_FILTERS.map(({ status, label }) => (
          <button
            key={status}
            type="button"
            className={statusFilter === status ? "abbreviation_panel_summary--active" : ""}
            aria-pressed={statusFilter === status}
            onClick={() => setStatusFilter((current) => current === status ? null : status)}
          >
            <strong>{entries.filter((entry) => entry.status === status).length}</strong>
            {label}
          </button>
        ))}
      </div>
      <div className="abbreviation_panel_body">
        {loading ? (
          <div className="abbreviation_panel_state">
            <i className="bx bx-loader-alt bx-spin" />
            Building document context{progress?.total ? ` · ${progress.completed}/${progress.total} pages` : "…"}
          </div>
        ) : error ? (
          <div className="abbreviation_panel_state abbreviation_panel_state--error">{error}</div>
        ) : filteredEntries.length ? (
          <div className="abbreviation_table_wrap">
            <table className="abbreviation_table">
              <thead><tr><th>Short Form</th><th>Long Form</th><th>Status</th><th>Occurrences</th><th>Pages</th></tr></thead>
              <tbody>
                {filteredEntries.map((entry) => (
                  <tr key={entry.id} className={selectedId === entry.id ? "abbreviation_table_row--selected" : ""} onClick={() => setSelectedId(entry.id)}>
                    <td><button type="button" onClick={() => setSelectedId(entry.id)}>{entry.shortForm}</button></td>
                    <td>{entry.longForm || "—"}</td>
                    <td><span className={`abbreviation_status abbreviation_status--${entry.status}`}>{STATUS_LABELS[entry.status]}</span></td>
                    <td>{entry.occurrenceCount}</td>
                    <td>{entry.pageNumbers?.join(", ") || entry.firstPage}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="abbreviation_panel_state">
            {statusFilter ? `No ${STATUS_LABELS[statusFilter].toLowerCase()} abbreviations match this filter.` : "No abbreviation candidates were detected in this document."}
          </div>
        )}
      </div>
      {selected && (
        <section className="abbreviation_detail" aria-label={`${selected.shortForm} details`}>
          <div><span>Short form</span><strong>{selected.shortForm}</strong></div>
          <div><span>Resolved meaning</span><strong>{selected.longForm || "Not resolved"}</strong></div>
          <div><span>Status</span><strong>{STATUS_LABELS[selected.status]}</strong></div>
          <div><span>Definition source</span><strong>{selected.definitionSource || `Page ${pageNum}`}</strong></div>
          <div><span>Found on pages</span><strong>{selected.pageNumbers?.join(", ") || selected.firstPage}</strong></div>
          <div><span>Explicit confirmations</span><strong>{selected.confirmationCount || 0}</strong></div>
          <div><span>Scope</span><strong>{selected.scope}</strong></div>
          {selected.alternatives?.length > 1 && (
            <div><span>Competing meanings</span><strong>{selected.alternatives.map((item) => `${item.longForm} (${item.pages.join(", ")})`).join(" · ")}</strong></div>
          )}
          {selected.sourceText && <blockquote>{selected.sourceText}</blockquote>}
        </section>
      )}
    </aside>
  );
};

export default AbbreviationPanel;
