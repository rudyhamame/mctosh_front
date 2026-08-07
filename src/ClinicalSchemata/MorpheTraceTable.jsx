import React from "react";
import { DOMAIN_LABELS } from "./amctoshsMorpheConstants";

const display = (value, fallback = "—") => value == null || value === "" ? fallback : value;

export default function MorpheTraceTable({ index, activeDomain, onSelectItem, selectedItemId }) {
  const groups = activeDomain === "all"
    ? [...index.byDomain.values()]
    : (index.byDomain.get(activeDomain) ? [index.byDomain.get(activeDomain)] : []);
  const traceSchemas = groups.flatMap((group) => group.traceSchemas);
  const traceInstances = groups.flatMap((group) => group.traceInstances);
  const rows = [
    ...traceSchemas.map((trace) => ({ ...trace, rowType: "Trace Schema", dimension: trace.traceDimension || "3D", label: trace.name, detail: trace.phenomenon?.name || trace.type?.name })),
    ...traceInstances.map((trace) => {
      const parent = index.traceSchemasById?.get(String(trace.traceSchemaId));
      return { ...trace, rowType: "Trace Instance", dimension: parent?.traceDimension || "3D", label: trace.sourceInstanceName || "(unresolved source)", detail: trace.observation?.value != null ? `${trace.observation.value}${trace.observation.unit ? ` ${trace.observation.unit}` : ""}` : "" };
    }),
  ];

  return (
    <section id="mrp_trace_table_panel" aria-labelledby="mrp_trace_table_title">
      <div className="mrp_trace_table_head">
        <div>
          <span className="mrp_panel_label">AMCTOSHS Trace Values</span>
          <h2 id="mrp_trace_table_title">3D and 4D Traces</h2>
        </div>
        <span className="mrp_count_chip">{rows.length} trace{rows.length !== 1 ? "s" : ""}</span>
      </div>
      <div className="mrp_trace_table_wrap">
        <table className="mrp_trace_table">
          <thead>
            <tr><th>Dimension</th><th>Type</th><th>Trace</th><th>Phenomenon / value</th><th>Domain</th><th>Status</th></tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan="6" className="mrp_trace_empty">No 3D or 4D traces are saved for this domain.</td></tr>
            ) : rows.map((row) => {
              const domain = row.domainOfAccess || groups.find((group) => group.traceSchemas.some((trace) => trace._id === row.traceSchemaId))?.traceSchemas[0]?.domainOfAccess;
              return (
                <tr key={`${row.rowType}-${row._id}`} className={selectedItemId === row._id ? "mrp_trace_row--active" : ""} onClick={() => onSelectItem(row.rowType === "Trace Schema" ? "traceSchemas" : "traceInstances", row._id)}>
                  <td><span className={`mrp_trace_dimension mrp_trace_dimension--${row.dimension.toLowerCase()}`}>{row.dimension}</span></td>
                  <td>{row.rowType}</td>
                  <td className="mrp_trace_name">{display(row.label)}</td>
                  <td>{display(row.detail)}</td>
                  <td>{display(DOMAIN_LABELS[domain] || domain)}</td>
                  <td>{display(row.epistemicStatus || row.traceStatus)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
