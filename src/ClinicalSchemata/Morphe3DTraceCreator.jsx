import React, { useMemo, useState } from "react";

const BIOLOGICAL_SENSORS = [
  ["EYES", "Eyes"],
  ["EARS", "Ears"],
  ["NOSE", "Nose"],
  ["TONGUE", "Tongue"],
  ["SKIN", "Skin"],
  ["VESTIBULAR_SYSTEM", "Vestibular system"],
];

const nextTraceId = (traceSchemas) => {
  const maximum = traceSchemas.reduce((current, trace) => {
    const match = String(trace.traceId || "").toUpperCase().match(/^TRACE_3D_(\d+)$/);
    return match ? Math.max(current, Number(match[1])) : current;
  }, 0);
  return `TRACE_3D_${maximum + 1}`;
};

export default function Morphe3DTraceCreator({ traceSchemas, selectedObject, creating, error, onCreate }) {
  const [formOpen, setFormOpen] = useState(false);
  const [biologicalSensor, setBiologicalSensor] = useState(BIOLOGICAL_SENSORS[0][0]);
  const [accessMethod, setAccessMethod] = useState("DIRECT");
  const [proxyDevices, setProxyDevices] = useState("");
  const [traceName, setTraceName] = useState("");
  const traceId = useMemo(() => nextTraceId(traceSchemas), [traceSchemas]);

  const submit = async (event) => {
    event.preventDefault();
    if (!selectedObject) return onCreate({ biologicalSensor, accessMethod, proxyDevices, traceName });
    if (!traceName.trim()) return false;
    const created = await onCreate({ biologicalSensor, accessMethod, proxyDevices, traceName });
    if (created) {
      setTraceName("");
      setProxyDevices("");
      setFormOpen(false);
    }
  };

  return (
    <div id="mrp_3d_trace_creator">
      <div id="mrp_3d_trace_header">
        <div>
          <h2>3D Traces</h2>
          {selectedObject && <span>for {selectedObject.name}</span>}
        </div>
        <button type="button" id="mrp_add_3d_trace_btn" onClick={() => setFormOpen((open) => !open)} aria-expanded={formOpen} aria-controls="mrp_add_3d_trace_form" title="Add 3D Trace">
          <span aria-hidden="true">+</span>
        </button>
      </div>

      {formOpen && (
        <form id="mrp_add_3d_trace_form" onSubmit={submit}>
          {!selectedObject && <p className="mrp_trace_create_hint">Select an RabbitHole object first.</p>}
          <label className="mrp_field">
            <span>Biological sensor</span>
            <select className="mrp_input" value={biologicalSensor} onChange={(event) => setBiologicalSensor(event.target.value)}>
              {BIOLOGICAL_SENSORS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="mrp_field">
            <span>Access method</span>
            <select className="mrp_input" value={accessMethod} onChange={(event) => setAccessMethod(event.target.value)}>
              <option value="DIRECT">Direct</option>
              <option value="INDIRECT">Indirect</option>
            </select>
          </label>
          {accessMethod === "INDIRECT" && (
              <label className="mrp_field">
                <span>Proxy devices (optional)</span>
                <textarea className="mrp_input mrp_trace_devices_input" value={proxyDevices} onChange={(event) => setProxyDevices(event.target.value)} placeholder="List devices used for detection, separated by commas or new lines" rows={2} />
              </label>
          )}
          <label className="mrp_field">
            <span>Trace ID</span>
            <input className="mrp_input" value={traceId} readOnly aria-readonly="true" />
          </label>
          <label className="mrp_field">
            <span>Trace name</span>
            <input className="mrp_input" value={traceName} onChange={(event) => setTraceName(event.target.value)} maxLength={160} required />
          </label>
          {error && <p className="mrp_object_create_error">{error}</p>}
          <button type="submit" className="mrp_save_btn" disabled={creating}>{creating ? "Adding…" : "Add 3D Trace"}</button>
        </form>
      )}
    </div>
  );
}
