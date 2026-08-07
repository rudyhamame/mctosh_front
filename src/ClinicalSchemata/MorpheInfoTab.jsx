import React from "react";

const ConceptSection = ({ number, title, children }) => (
  <section className="mrp_info_section">
    <div className="mrp_info_section_kicker">{number}</div>
    <h2>{title}</h2>
    {children}
  </section>
);

const Flow = ({ children, className = "" }) => (
  <div className={`mrp_info_flow ${className}`.trim()} aria-label="Conceptual flow">
    {children}
  </div>
);

const CodeExample = ({ children }) => (
  <pre className="mrp_info_code"><code>{children}</code></pre>
);

export default function MorpheInfoTab({ onBackToEntities }) {
  return (
    <div id="mrp_information" role="tabpanel" aria-labelledby="mrp_information_tab">
      <div className="mrp_info_intro">
        <div>
          <div className="mrp_info_kicker">AMCTOSHS Morphe ontology</div>
          <h1>AMCTOSHS Morphe Entities</h1>
          <p>Schemas, traces, trace values, and schema instantiation</p>
        </div>
        <button type="button" className="mrp_info_return" onClick={onBackToEntities}>
          <i className="bx bx-left-arrow-alt" aria-hidden="true" /> Entities
        </button>
      </div>

      <div className="mrp_info_sections">
        <ConceptSection number="01" title="Schema">
          <p>A Schema is a noetic structural form that defines the fields, relations, constraints, and possible values through which an AMCTOSHS Morphe Entity can be represented.</p>
          <p>The Schema is not the concrete entity itself. It specifies how Trace Values can be organized into an instance representing an entity or one temporal slice of it.</p>
          <Flow>
            <span>Schema</span><b>-&gt;</b><span>defines possible fields</span><b>-&gt;</b><span>receives Trace Values</span><b>-&gt;</b><span>generates an Instance</span><b>-&gt;</b><span>renders the represented entity</span>
          </Flow>
          <CodeExample>{`HEART_SCHEMA = {
  identity: {},
  structure: {},
  sound: {},
  electricalActivity: {},
  movement: {},
  measurements: {}
}`}</CodeExample>
          <p className="mrp_info_note">This is a simplified conceptual example. It does not replace the actual Schema implementation.</p>
        </ConceptSection>

        <ConceptSection number="02" title="Trace">
          <p>A Trace is what provides access to an entity. AMCTOSHS distinguishes between a 3D Trace, an ontic manifestation in one present temporal slice, and a 4D Trace, a noetic temporal construction.</p>
          <div className="mrp_info_subsection">
            <h3>2.1 3D Trace</h3>
            <p>A 3D Trace is an ontic manifestation available within one present temporal slice. It occurs in reality and is accessed through perception, measurement, examination, or an instrument.</p>
            <div className="mrp_info_examples"><span>a sound wave</span><span>a visible movement</span><span>a palpable vibration</span><span>an electrical signal</span><span>a pressure wave</span><span>a tissue structure visible in an image</span></div>
            <Flow><span>Ontic entity</span><b>-&gt;</b><span>produces or presents a 3D Trace</span><b>-&gt;</b><span>observer or instrument accesses the Trace</span></Flow>
            <p className="mrp_info_note">A 3D Trace is not the entire entity; it is one manifestation through which the entity becomes accessible. Example: Heart -&gt; produces sound -&gt; the sound event is a 3D Trace.</p>
          </div>
          <div className="mrp_info_subsection">
            <h3>2.2 4D Trace</h3>
            <p>A 4D Trace is a noetic temporal construction produced by retaining, ordering, and relating multiple 3D Trace Values. It is available to thought, memory, or computation rather than directly seen in one present slice.</p>
            <Flow className="mrp_info_flow--stack"><span>3D Trace at t1</span><span>3D Trace at t2</span><span>3D Trace at t3</span><b>↓</b><span>Trace Value memory stack</span><b>↓</b><strong>4D Trace</strong></Flow>
            <div className="mrp_info_examples"><span>rate</span><span>rhythm</span><span>sequence</span><span>duration</span><span>persistence</span><span>change</span><span>trend</span><span>trajectory</span><span>acceleration</span><span>recurrence</span></div>
            <p className="mrp_info_note">A 4D Trace is grounded in 3D Traces, but constructed through memory, temporal ordering, comparison, or computation. Individual detected heartbeats are 3D Trace occurrences; ordered timestamps form a memory stack; heart rate and rhythm are 4D Trace constructions. A rate value itself is not an ontic 3D Trace.</p>
          </div>
          <div className="mrp_info_subsection">
            <h3>3D Trace Values vs 4D Trace Values</h3>
            <p>A 3D Trace Value is obtainable from one present ontic slice.</p>
            <p>A 4D Trace Value requires the retention and relation of temporally distinct 3D Trace Values.</p>
            <p>A 4D Trace Value cannot be obtained from one isolated slice. It requires retaining and relating Trace Values from at least two temporally distinct 3D slices.</p>
            <Flow className="mrp_info_flow--major"><span>One present slice is sufficient</span><b>-&gt;</b><strong>3D Trace Value</strong><span>Two or more temporally distinct slices are required</span><b>-&gt;</b><strong>4D Trace Value</strong></Flow>
            <p>At t1, a Trace is ontically present. After t1 has passed, that Trace is no longer presently accessible as the same ontic event. What remains available to the system is its persistent record or Trace Value. At t2, the system can relate the retained Trace Value from t1 to the presently obtained Trace Value at t2.</p>
            <p className="mrp_info_note">The past Trace is not presently ontic; its retained Trace Value is used in the memory stack.</p>
            <Flow className="mrp_info_flow--stack"><span>3D Trace at t1 -&gt; Trace Value retained in memory</span><span>3D Trace at t2 -&gt; new Trace Value</span><b>retained value at t1 + new value at t2 -&gt; temporal comparison</b><strong>4D Trace Value</strong></Flow>
          </div>
          <div className="mrp_info_subsection">
            <h3>Rate requires temporal comparison</h3>
            <p>A single heart sound at t1 does not provide heart rate. A second heart sound at t2 is not sufficient by itself either. Heart rate becomes available only when the system retains the occurrence or timestamp from t1 and compares it with t2.</p>
            <CodeExample>{`sound1 at t1 -> 3D ontic Trace
record(sound1, t1) -> retained Trace Value
sound2 at t2 -> 3D ontic Trace
record(sound1, t1) + sound2 at t2 -> temporal comparison
dt = t2 - t1 -> 4D Trace Value
rate = 1 / dt -> derived 4D Trace Value`}</CodeExample>
            <p className="mrp_info_note">Rate is a 4D Trace Value because one sound occurrence cannot provide rate. Rate is not obtainable from one present 3D Trace; it depends on a memory stack that preserves and relates temporally distinct 3D Trace Values.</p>
          </div>
          <div className="mrp_info_subsection">
            <h3>Volume comparison</h3>
            <p>The spatial occupation of a cardiac chamber can be accessed within one temporal slice. Therefore, chamber volume at t1 is a 3D Trace Value. A change in chamber volume requires comparing volume at t1 with volume at t2. Therefore, chamber-volume change is a 4D Trace Value.</p>
            <p className="mrp_info_note">Volume at one time is 3D. Change in volume across time is 4D.</p>
            <Flow><span>chamber space occupation at t1</span><b>-&gt;</b><span>one slice is sufficient</span><b>-&gt;</b><strong>3D Trace Value</strong></Flow>
            <Flow><span>volume at t1 + volume at t2</span><b>-&gt;</b><span>temporal comparison</span><b>-&gt;</b><strong>4D Trace Value</strong></Flow>
          </div>
          <div className="mrp_info_subsection">
            <h3>Classification by access requirement</h3>
            <div className="mrp_info_table_wrap">
              <table className="mrp_info_table">
                <thead><tr><th>Item</th><th>Required access</th><th>Classification</th></tr></thead>
                <tbody>
                  <tr><td>Sound present</td><td>One temporal slice</td><td>3D Trace Value</td></tr>
                  <tr><td>Chamber volume at t1</td><td>One temporal slice</td><td>3D Trace Value</td></tr>
                  <tr><td>Chamber shape at t1</td><td>One temporal slice</td><td>3D Trace Value</td></tr>
                  <tr><td>Interval between two sounds</td><td>At least two slices</td><td>4D Trace Value</td></tr>
                  <tr><td>Heart rate</td><td>Multiple temporally ordered traces</td><td>4D Trace Value</td></tr>
                  <tr><td>Rhythm</td><td>Multiple temporally ordered traces</td><td>4D Trace Value</td></tr>
                  <tr><td>Persistence</td><td>Comparison across time</td><td>4D Trace Value</td></tr>
                  <tr><td>Change in chamber volume</td><td>Comparison across time</td><td>4D Trace Value</td></tr>
                  <tr><td>Trend</td><td>Multiple temporally ordered values</td><td>4D Trace Value</td></tr>
                </tbody>
              </table>
            </div>
            <p className="mrp_info_note">Classify by access requirement: single temporal slice or multiple temporally distinct slices. Mathematics alone does not make a value 4D; a value derived from one spatial slice can remain 3D.</p>
          </div>
          <div className="mrp_info_subsection">
            <h3>Trace Value memory stack</h3>
            <p>A Trace Value memory stack is an ordered persistent collection of Trace Values indexed by time.</p>
            <CodeExample>{`[
  { traceValueId: "sound-1", time: "t1", value: "sound_present" },
  { traceValueId: "sound-2", time: "t2", value: "sound_present" }
]`}</CodeExample>
            <p className="mrp_info_note">The memory stack does not recreate the past ontic Trace. It preserves a representation of the past Trace so that temporal relations can be constructed.</p>
            <CodeExample>{`const is4DTraceValue =
  requiredTemporalSlices >= 2 ||
  requiresTemporalOrdering === true ||
  requiresMemoryStack === true;`}</CodeExample>
            <CodeExample>{`{
  dimensionalClass: "4D",
  derivationType: "temporal",
  requiresMemoryStack: true,
  sourceTraceValueIds: ["trace-value-t1", "trace-value-t2"],
  temporalRelation: "interval"
}`}</CodeExample>
          </div>
        </ConceptSection>

        <ConceptSection number="03" title="Trace Value">
          <p>A Trace Value is the represented value obtained from, assigned to, or derived from a Trace. The Trace is the manifestation; the Trace Value is the value used by the Schema.</p>
          <div className="mrp_info_value_grid">
            <div><strong>Trace</strong><span>an audible heart sound</span><strong>Trace Value</strong><code>soundPresent = true</code></div>
            <div><strong>Trace</strong><span>an electrical voltage signal</span><strong>Trace Value</strong><code>voltage = 1.2 mV</code></div>
            <div><strong>Traces</strong><span>ordered heartbeat events</span><strong>Trace Value</strong><code>heartRate = 80 bpm</code></div>
          </div>
          <p>Trace Values are representational values grounded in Traces. They may be:</p>
          <ul className="mrp_info_list">
            <li><strong>Direct</strong> - assigned from one accessed 3D Trace, such as <code>soundPresent = true</code>.</li>
            <li><strong>Derived</strong> - computed from multiple Trace Values, such as <code>heartRate = 80 bpm</code>.</li>
            <li><strong>Classified</strong> - assigned by comparing a value with a rule, range, or Schema, such as <code>heartRateClassification = normal</code>.</li>
          </ul>
        </ConceptSection>

        <ConceptSection number="04" title="Schema Instantiation">
          <p>A Schema is instantiated when one or more Trace Values are assigned to its fields. Instantiation generates a noetic instance of the Schema. The generated instance represents an entity or a temporal slice; it is not numerically identical to the ontic entity.</p>
          <Flow className="mrp_info_flow--major"><span>Schema</span><b>+</b><span>Trace Value</span><b>=</b><strong>Schema Instance</strong></Flow>
          <Flow><span>Ontic entity</span><b>-&gt;</b><span>Trace</span><b>-&gt;</b><span>Trace Value</span><b>-&gt;</b><span>Schema field assignment</span><b>-&gt;</b><span>Schema instantiation</span><b>-&gt;</b><span>rendered Morphe Entity instance</span></Flow>

          <div className="mrp_info_subsection">
            <h3>Partial instantiation</h3>
            <p>One Trace Value can partially instantiate a Schema when incomplete or unknown fields are allowed.</p>
            <CodeExample>{`HEART_SCHEMA = {
  soundPresent: null,
  heartRate: null,
  rhythm: null,
  movement: null
}

soundPresent = true

HEART_INSTANCE_1 = {
  soundPresent: true,
  heartRate: null,
  rhythm: null,
  movement: null
}`}</CodeExample>
            <p className="mrp_info_note">Use explicit states such as <code>unknown</code>, <code>not_observed</code>, <code>not_applicable</code>, or <code>unresolved</code>. A missing value is not automatically <code>false</code> or <code>normal</code>.</p>
          </div>

          <div className="mrp_info_subsection">
            <h3>Value modification and instance generation</h3>
            <p>Every accepted Trace Value modification causes the Schema to be instantiated again for the relevant identity and temporal slice.</p>
            <ul className="mrp_info_list">
              <li>Same entity identity and same temporal slice - update or regenerate the existing instance.</li>
              <li>Same entity identity and different temporal slice - generate a new temporal instance.</li>
              <li>Different entity identity - generate a separate instance.</li>
            </ul>
            <CodeExample>{`heartRate = 80 bpm at 10:00
heartRate = 110 bpm at 10:05

heart-1@10:00 -> { heartRate: 80 }
heart-1@10:05 -> { heartRate: 110 }`}</CodeExample>
          </div>

          <div className="mrp_info_subsection">
            <h3>Rendering rule</h3>
            <p>To instantiate a Schema is to generate an Instance. To render the Instance is to visually express the Schema using the currently assigned Trace Values.</p>
            <Flow><span>Schema</span><b>-&gt;</b><span>receives values</span><b>-&gt;</b><span>generates instance</span><b>-&gt;</b><strong>renders entity representation</strong></Flow>
            <p className="mrp_info_note">The renderer must validate the value, identify the Schema field, entity identity, and temporal slice, then create or update the instance and preserve temporal history when appropriate. The rendered entity must always be derived from the stored Schema Instance, not from separate visual state.</p>
            <CodeExample>{`const nextInstance = instantiateSchema({
  schema,
  previousInstance,
  traceValueModification,
  entityIdentity,
  temporalSlice
});

const renderedEntity = renderSchemaInstance(nextInstance);`}</CodeExample>
          </div>
          <div className="mrp_info_subsection">
            <h3>3D slice and 4D temporal instances</h3>
            <p>A 3D Trace Value can instantiate a Schema for one temporal slice. A 4D Trace Value can instantiate a Schema only after the system has constructed the value from a temporally ordered memory stack.</p>
            <Flow><span>3D Trace</span><b>-&gt;</b><span>3D Trace Value</span><b>-&gt;</b><strong>instantiate Schema at t1</strong></Flow>
            <CodeExample>{`{
  schemaId: "heart-schema",
  sliceId: "heart-1@t1",
  values: { soundPresent: true, chamberVolume: 120 }
}`}</CodeExample>
            <p className="mrp_info_note">This is a 3D slice instance.</p>
            <Flow><span>3D Trace Value at t1 + 3D Trace Value at t2</span><b>-&gt;</b><span>memory-stack comparison</span><b>-&gt;</b><strong>4D Trace Value</strong><b>-&gt;</b><strong>instantiate temporal Schema</strong></Flow>
            <CodeExample>{`{
  schemaId: "heart-temporal-schema",
  interval: { start: "t1", end: "t2" },
  values: { heartRate: 80, rhythm: "regular" },
  sourceSliceIds: ["heart-1@t1", "heart-1@t2"]
}`}</CodeExample>
            <p className="mrp_info_note">This is a 4D temporal instance.</p>
          </div>
        </ConceptSection>

        <section className="mrp_info_diagram" aria-label="AMCTOSHS Morphe conceptual model">
          <div className="mrp_info_section_kicker">MODEL</div>
          <h2>From ontic access to rendered instance</h2>
          <div className="mrp_info_domain_diagram">
            <div><small>ONTIC DOMAIN</small><strong>Entity</strong><span>↓</span><strong>3D Trace</strong></div>
            <div><small>ACCESS AND REPRESENTATION</small><strong>Trace Value</strong><span>↓</span><strong>Schema Field Assignment</strong></div>
            <div><small>NOETIC DOMAIN</small><strong>Schema Instance</strong><span>↓</span><strong>Rendered Morphe Entity</strong></div>
          </div>
          <div className="mrp_info_temporal_diagram">
            <span>3D Trace Value at t1</span><span>3D Trace Value at t2</span><span>3D Trace Value at t3</span><b>↓ ordered memory stack ↓</b><strong>4D Trace</strong><b>↓ derived Trace Values ↓</b><strong>new temporal Schema Instance</strong>
          </div>
          <p className="mrp_info_note">Every generated instance should retain provenance: its Schema, entity identity, temporal slice, generating Trace Value identifiers, previous instance where applicable, generation time, and schema-instantiation method.</p>
          <p className="mrp_info_conclusion"><strong>3D</strong> -&gt; what can be accessed from one present ontic slice.<br /><strong>4D</strong> -&gt; what can be constructed only by retaining and relating multiple temporal slices.</p>
        </section>
      </div>
    </div>
  );
}
