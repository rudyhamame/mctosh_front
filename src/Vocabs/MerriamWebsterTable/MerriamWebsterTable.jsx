import { useEffect, useMemo, useState } from "react";
import { MW_COLUMNS, MW_TABLE_MODES } from "../../merriamWebster/columns";
import { flattenRawJson } from "../../merriamWebster/flattenRawJson";
import { normalizeSavedVocabulary } from "../../merriamWebster/normalizeResponse";
import MerriamWebsterColumnSelector from "./MerriamWebsterColumnSelector";
import MerriamWebsterRowDetails from "./MerriamWebsterRowDetails";
import "./merriamWebsterTable.css";

const audioUrl = (audio) => {
  const value = String(audio || "").trim();
  if (!value || /^https?:/i.test(value)) return value;
  const lower = value.toLowerCase();
  const directory = lower.startsWith("bix") ? "bix" : lower.startsWith("gg") ? "gg" : /^[^a-z]/.test(lower) ? "number" : lower[0];
  return `https://media.merriam-webster.com/audio/prons/en/us/mp3/${directory}/${encodeURIComponent(value)}.mp3`;
};

const sortableText = (value) => {
  if (Array.isArray(value)) return value.map(sortableText).join(" ");
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value ?? "");
};

const summarizeComplex = (value) => {
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
  if (value && typeof value === "object") return `${Object.keys(value).length} field${Object.keys(value).length === 1 ? "" : "s"}`;
  return String(value ?? "—");
};

const CellValue = ({ columnKey, value }) => {
  if (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)) return <span className="mw_empty">—</span>;
  if (columnKey === "audio") {
    return <div className="mw_audio_list">{(Array.isArray(value) ? value : [value]).map((item, index) => <audio key={`${item}-${index}`} controls preload="none" src={audioUrl(item)} />)}</div>;
  }
  if (columnKey === "offensive") return value ? "Yes" : "No";
  if (MW_COLUMNS[columnKey]?.complex || (typeof value === "object" && !Array.isArray(value))) {
    return <details className="mw_cell_json"><summary>{summarizeComplex(value)}</summary><pre>{JSON.stringify(value, null, 2)}</pre></details>;
  }
  if (Array.isArray(value)) {
    const rendered = <div className="mw_cell_list">{value.map((item, index) => <span key={`${sortableText(item)}-${index}`}>{typeof item === "object" ? summarizeComplex(item) : String(item)}</span>)}</div>;
    if (value.length > 2 || sortableText(value).length > 260) {
      return <details className="mw_text_expand"><summary>{String(value[0]).slice(0, 180)}{String(value[0]).length > 180 ? "…" : ""}</summary>{rendered}</details>;
    }
    return rendered;
  }
  return <span>{String(value)}</span>;
};

export default function MerriamWebsterTable({ savedItems, onEdit, onDelete, busyId }) {
  const [mode, setMode] = useState("dictionary");
  const [columns, setColumns] = useState(MW_TABLE_MODES.dictionary.columns);
  const [sort, setSort] = useState({ key: "headword", direction: "asc" });
  const [expanded, setExpanded] = useState(() => new Set());

  const groups = useMemo(() => savedItems.map(normalizeSavedVocabulary), [savedItems]);
  const suggestions = useMemo(() => groups.flatMap((group) => group.suggestions || []), [groups]);
  const semanticRows = useMemo(() => groups.flatMap((group) => group.rows), [groups]);
  const rawRows = useMemo(() => groups.flatMap((group, groupIndex) => (
    Array.isArray(group.rawResponse)
      ? flattenRawJson(group.rawResponse).map((row, index) => ({ ...row, id: `${groupIndex}-${index}` }))
      : []
  )), [groups]);

  useEffect(() => {
    if (mode !== "raw") setColumns(MW_TABLE_MODES[mode].columns);
  }, [mode]);

  const rows = useMemo(() => {
    const copy = [...semanticRows];
    copy.sort((left, right) => {
      const comparison = sortableText(left[sort.key]).localeCompare(sortableText(right[sort.key]), undefined, { numeric: true, sensitivity: "base" });
      return sort.direction === "asc" ? comparison : -comparison;
    });
    return copy;
  }, [semanticRows, sort]);

  const changeSort = (key) => setSort((current) => ({ key, direction: current.key === key && current.direction === "asc" ? "desc" : "asc" }));
  const toggleExpanded = (key) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  return (
    <div className="mw_table_shell">
      <div className="mw_table_toolbar">
        <div className="mw_mode_switch" role="group" aria-label="Vocabulary table mode">
          {Object.entries(MW_TABLE_MODES).map(([key, item]) => <button type="button" key={key} className={mode === key ? "is-active" : ""} onClick={() => setMode(key)}>{item.label}</button>)}
        </div>
        {mode !== "raw" && <MerriamWebsterColumnSelector selected={columns} onChange={setColumns} />}
        <span className="mw_row_count">{mode === "raw" ? rawRows.length : rows.length} rows</span>
      </div>

      {mode === "raw" ? (
        <div className="mw_table_scroll"><table className="mw_table mw_raw_table"><thead><tr><th>Path</th><th>Type</th><th>Value</th></tr></thead><tbody>{rawRows.map((row) => <tr key={row.id}><td><code>{row.path}</code></td><td>{row.type}</td><td><button className="mw_copy_value" type="button" title="Copy value" onClick={() => navigator.clipboard?.writeText(String(row.value ?? "null"))}>{String(row.value ?? "null")}</button></td></tr>)}</tbody></table>{rawRows.length === 0 && <p className="mw_table_empty">No Merriam-Webster raw response is stored for these terms.</p>}</div>
      ) : rows.length ? (
        <div className="mw_table_scroll">
          <table className="mw_table">
            <thead><tr><th className="mw_expand_column" aria-label="Expand" />{columns.map((key) => <th key={key}><button type="button" onClick={() => changeSort(key)}>{MW_COLUMNS[key]?.shortLabel || MW_COLUMNS[key]?.label || key}{sort.key === key && <i className={`fi ${sort.direction === "asc" ? "fi-rr-angle-small-up" : "fi-rr-angle-small-down"}`} />}</button></th>)}<th className="mw_actions_column" aria-label="Actions" /></tr></thead>
            <tbody>{rows.map((row, index) => {
              const rowKey = `${row.savedId || "response"}-${row.sourcePath}-${index}`;
              const isExpanded = expanded.has(rowKey);
              return [
                <tr key={rowKey}>
                  <td><button className="mw_expand_button" type="button" onClick={() => toggleExpanded(rowKey)} aria-label={isExpanded ? "Collapse sense details" : "Expand sense details"}><i className={`fi ${isExpanded ? "fi-rr-angle-small-down" : "fi-rr-angle-small-right"}`} /></button></td>
                  {columns.map((key) => <td key={key} className={MW_COLUMNS[key]?.multiline ? "is-multiline" : ""}><CellValue columnKey={key} value={row[key]} /></td>)}
                  <td><span className="mw_row_actions"><button type="button" onClick={() => onEdit(row.savedItem)} disabled={!row.savedItem || busyId === row.savedId} aria-label={`Edit ${row.headword || "vocabulary"}`} title="Edit vocabulary"><i className="fi fi-rr-pencil" /></button><button className="is-delete" type="button" onClick={() => onDelete(row.savedItem)} disabled={!row.savedItem || busyId === row.savedId} aria-label={`Delete ${row.headword || "vocabulary"}`} title="Delete vocabulary"><i className={`fi ${busyId === row.savedId ? "fi-rr-spinner" : "fi-rr-trash"}`} /></button></span></td>
                </tr>,
                isExpanded && <tr className="mw_details_row" key={`${rowKey}-details`}><td colSpan={columns.length + 2}><MerriamWebsterRowDetails row={row} /></td></tr>,
              ];
            })}</tbody>
          </table>
        </div>
      ) : suggestions.length ? (
        <div className="mw_table_scroll"><table className="mw_table"><thead><tr><th>Suggestion</th></tr></thead><tbody>{suggestions.map((suggestion, index) => <tr key={`${suggestion}-${index}`}><td>{suggestion}</td></tr>)}</tbody></table></div>
      ) : <p className="mw_table_empty">No semantic dictionary rows are available.</p>}
    </div>
  );
}
