import React, { useEffect, useState } from "react";

export default function MorpheTraceTable({ index, selectedItemId, onCreateValue }) {
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const groups = [...index.byDomain.values()];
  const traceSchemas = groups.flatMap((group) => group.traceSchemas);
  const traceInstances = groups.flatMap((group) => group.traceInstances);
  const selectedInstance = traceInstances.find((trace) => trace._id === selectedItemId);
  const selectedTrace = selectedInstance
    ? index.traceSchemasById?.get(String(selectedInstance.traceSchemaId))
    : traceSchemas.find((trace) => trace._id === selectedItemId);
  const values = selectedTrace
    ? traceInstances.filter((trace) => String(trace.traceSchemaId) === String(selectedTrace._id))
    : [];
  const title = selectedTrace?.name || "Select a trace";

  useEffect(() => {
    setAdding(false);
    setValue("");
    setUnit("");
    setError("");
  }, [selectedTrace?._id]);

  const closeAddRow = () => {
    if (saving) return;
    setAdding(false);
    setValue("");
    setUnit("");
    setError("");
  };

  const saveValue = async () => {
    if (!selectedTrace || !String(value).trim() || saving) return;
    setSaving(true);
    setError("");
    try {
      await onCreateValue({ traceSchemaId: selectedTrace._id, value, unit });
      setAdding(false);
      setValue("");
      setUnit("");
    } catch (err) {
      setError(err.message || "Failed to add the trace value.");
    } finally {
      setSaving(false);
    }
  };

  const handleEditorKeyDown = (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      saveValue();
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeAddRow();
    }
  };

  return (
    <section id="mrp_trace_table_panel" aria-labelledby="mrp_trace_table_title">
      <div className="mrp_trace_table_head">
        <div>
          <span className="mrp_panel_label">AMCTOSHS Trace Values</span>
          <h2 id="mrp_trace_table_title">{title}</h2>
        </div>
        <div className="mrp_trace_table_actions">
          <span className="mrp_count_chip">{values.length} value{values.length !== 1 ? "s" : ""}</span>
          <button
            type="button"
            className={`mrp_trace_add_row${adding ? " mrp_trace_add_row--active" : ""}`}
            onClick={() => {
              if (adding) closeAddRow();
              else {
                setAdding(true);
                setError("");
              }
            }}
            disabled={!selectedTrace || saving}
            aria-label={adding ? "Cancel new trace value" : "Add new trace value row"}
            title={adding ? "Cancel" : "Add new row"}
          >
            {adding ? "x" : "+"}
          </button>
        </div>
      </div>
      <div className="mrp_trace_table_wrap">
        <table className="mrp_trace_table">
          <thead>
            <tr><th>Value</th><th>Unit</th></tr>
          </thead>
          <tbody>
            {adding && selectedTrace && (
              <tr className="mrp_trace_add_row_fields">
                <td>
                  <input
                    type="text"
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                    onKeyDown={handleEditorKeyDown}
                    placeholder="Value"
                    aria-label="Trace value"
                    autoFocus
                  />
                  {error && <span className="mrp_trace_add_error">{error}</span>}
                </td>
                <td>
                  <div className="mrp_trace_unit_editor">
                    <input
                      type="text"
                      value={unit}
                      onChange={(event) => setUnit(event.target.value)}
                      onKeyDown={handleEditorKeyDown}
                      placeholder="Unit"
                      aria-label="Trace value unit"
                    />
                    <button type="button" onClick={saveValue} disabled={!String(value).trim() || saving} aria-label="Save trace value" title="Save">
                      <i className={saving ? "bx bx-loader-alt mrp_icon_spin" : "bx bx-check"} aria-hidden="true" />
                    </button>
                  </div>
                </td>
              </tr>
            )}
            {!selectedTrace ? (
              <tr><td colSpan="2" className="mrp_trace_empty">Select a trace to view its values.</td></tr>
            ) : values.length === 0 && !adding ? (
              <tr><td colSpan="2" className="mrp_trace_empty">No values are recorded for this trace.</td></tr>
            ) : values.map((trace) => (
              <tr key={trace._id}>
                <td>{trace.observation?.value == null || trace.observation.value === "" ? "-" : trace.observation.value}</td>
                <td>{trace.observation?.unit || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
