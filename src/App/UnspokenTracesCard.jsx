export default function UnspokenTracesCard() {
  return (
    <article className="app_dashboard_card app_unspoken_traces_card">
      <div className="app_card_heading">
        <div>
          <span className="app_card_kicker">04 / RabbitHole MORPHE: 3D TRACES</span>
          <h2>Unspoken Traces</h2>
        </div>
        <span className="app_trace_card_icon" aria-hidden="true"><i className="fi fi-rr-eye" /></span>
      </div>
      <p className="app_card_description">
        Unspoken Traces illuminate all sub-human modes of the PATIENT object: directly through clinician senses, or indirectly through instruments that interpret traces for clinicians.
      </p>
      <div className="app_unspoken_trace_modes">
        <div><strong>Direct</strong><span>Clinician senses</span></div>
        <div><strong>Indirect</strong><span>Instrument interpretation</span></div>
      </div>
    </article>
  );
}
