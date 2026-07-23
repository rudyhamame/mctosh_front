import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLongPressSelect } from "../utils/longPressSelect";
import "./amctoshsAboutPage.css";

// AmctoshsAboutPage — a dedicated conceptual page explaining the AMCTOSHS
// model itself: ontic patient, traces, modes of access (patient-as-speakable
// / patient-as-unspeakable), the AMCTOSHS Entity Schema, 3D instantiation,
// Identity, the 4D representational patient, domains, reasoning, the
// ASK/EXAMINE doctor loop, and the recursive epistemic loop. This is
// distinct from the existing general About page (About/AboutPage.jsx,
// still at /about) — that page explains the university-patient/real-patient
// pedagogical framing; this one is the formal AMCTOSHS ontology/epistemology
// itself, linked from the Home page's "The AMCTOSHS Model" button.
//
// Every diagram, definition, distinction, and example below is transcribed
// from the AMCTOSHS model spec verbatim — only the visual presentation
// (boxes/arrows instead of literal monospace ASCII, cards, tables) is new.

// ── Small reusable diagram primitives ───────────────────────────────────
const Node = ({ children, sub, variant, wide, small }) => (
  <div
    className={[
      "amc_node",
      variant ? `amc_node--${variant}` : "",
      wide ? "amc_node--wide" : "",
      small ? "amc_node--sm" : "",
    ].filter(Boolean).join(" ")}
  >
    {children}
    {sub && <span className="amc_node_sub">{sub}</span>}
  </div>
);

const ArrowDown = ({ label }) => (
  <div className="amc_arrow_down">
    <span className="amc_arrow_down_glyph" aria-hidden="true">↓</span>
    {label && <span className="amc_arrow_down_label">{label}</span>}
  </div>
);

const Branch = ({ children }) => <div className="amc_branch">{children}</div>;
const BranchCol = ({ label, children }) => (
  <div className="amc_branch_col">
    {label && <div className="amc_branch_col_label">{label}</div>}
    {children}
  </div>
);

const Diagram = ({ title, children }) => (
  <div className="amc_diagram">
    {title && <div className="amc_diagram_title">{title}</div>}
    <div className="amc_flow">{children}</div>
  </div>
);

const Quote = ({ tag, children }) => (
  <blockquote className="amc_quote">
    {tag && <span className="amc_quote_tag">{tag}</span>}
    {children}
  </blockquote>
);

const Code = ({ children }) => <pre className="amc_code">{children}</pre>;

const TermDef = ({ term, body }) => (
  <div className="amc_termdef">
    <div className="amc_termdef_term">{term}</div>
    <div className="amc_termdef_eq">=</div>
    <div className="amc_termdef_body">{body}</div>
  </div>
);

const Neq = ({ a, b, c }) => (
  <div className="amc_neq_row">
    <span className="amc_neq_term">{a}</span>
    <span className="amc_neq_sign">≠</span>
    <span className="amc_neq_term">{b}</span>
    {c && <>
      <span className="amc_neq_sign">≠</span>
      <span className="amc_neq_term">{c}</span>
    </>}
  </div>
);

const DefinitionBlock = ({ label, children }) => (
  <div className="amc_definition_block">
    {label && <div className="amc_definition_block_label">{label}</div>}
    <div className="amc_definition_block_text">{children}</div>
  </div>
);

const Callout = ({ warn, children }) => (
  <div className={`amc_callout${warn ? " amc_callout--warn" : ""}`}>{children}</div>
);

// Eyebrow number is looked up from SECTIONS by id rather than passed in as
// a literal — a hand-typed num prop on every <Section> silently drifted out
// of sync with the nav sidebar's own (SECTIONS-index-derived) numbering the
// moment a section was inserted or reordered; deriving both from the same
// array is the only way they can't disagree.
const Section = ({ id, title, children }) => {
  const index = SECTIONS.findIndex((s) => s.id === id);
  const num = String(index + 1).padStart(2, "0");
  return (
    <section id={id} className="amc_section">
      <div className="amc_section_eyebrow">
        <span className="amc_section_eyebrow_num">{num}</span>
        <span>AMCTOSHS Model</span>
      </div>
      <h2 className="amc_section_heading">{title}</h2>
      {children}
    </section>
  );
};

// ── Nav outline — 21 sections, per the model's own required structure ──
const SECTIONS = [
  { id: "amc-hero",         label: "The Core Model" },
  { id: "amc-ontic",        label: "Ontic vs Representational Patient" },
  { id: "amc-traces",       label: "Traces & Modes of Access" },
  { id: "amc-speakable",    label: "Patient-as-Speakable" },
  { id: "amc-speakable-discrepancy", label: "Speakable as Identity Discrepancy" },
  { id: "amc-unspeakable",  label: "Patient-as-Unspeakable" },
  { id: "amc-not-subobj",   label: "Not Subjective/Objective" },
  { id: "amc-medium",       label: "Trace Medium vs Mode of Access" },
  { id: "amc-schema",       label: "AMCTOSHS Entity Schema" },
  { id: "amc-3d",           label: "3D AMCTOSHS Instantiation" },
  { id: "amc-identity",     label: "Identity" },
  { id: "amc-4d",           label: "4D AMCTOSHS" },
  { id: "amc-domains",      label: "Domains" },
  { id: "amc-before",       label: "Representation Before Reasoning" },
  { id: "amc-reasoning",    label: "The Reasoning Layer" },
  { id: "amc-ask-examine",  label: "ASK / EXAMINE" },
  { id: "amc-recursive",    label: "Recursive Epistemic Loop" },
  { id: "amc-pericarditis", label: "Example: Acute Pericarditis" },
  { id: "amc-distinctions", label: "Conceptual Distinctions" },
  { id: "amc-architecture", label: "Complete Architecture" },
  { id: "amc-definition",   label: "Core Definition" },
];

const AmctoshsAboutPage = () => {
  const navigate = useNavigate();
  const scrollRef = useRef(null);
  const bodyRef = useRef(null);
  const [activeId, setActiveId] = useState("amc-hero");
  const [scale, setScale] = useState(1);
  const [copied, setCopied] = useState(false);

  useLongPressSelect(bodyRef);

  const applyScale = (next) => setScale(Math.min(2, Math.max(0.5, Math.round(next * 10) / 10)));

  const handleCopy = () => {
    const text = bodyRef.current?.innerText || "";
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };

  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    const visible = new Set();
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        });
        const first = SECTIONS.find((s) => visible.has(s.id));
        if (first) setActiveId(first.id);
      },
      { root: scrollEl, rootMargin: "0px 0px -60% 0px", threshold: 0 },
    );
    SECTIONS.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  const scrollTo = (id) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div id="amc_page">
      <div id="amc_header">
        <button id="amc_back_btn" onClick={() => navigate(-1)}>←</button>
        <span id="amc_header_title">The AMCTOSHS Model</span>
        <span id="amc_header_sub">ontic patient · traces · modes of access · 3D/4D representation · reasoning</span>
        <button id="amc_copy_btn" onClick={handleCopy} title="Copy all text">
          {copied ? "Copied ✓" : "Copy"}
        </button>
        <div id="amc_zoom_controls">
          <button onClick={() => applyScale(scale - 0.1)} disabled={scale <= 0.5}>−</button>
          <button id="amc_zoom_label" onClick={() => applyScale(1)} title="Reset zoom">{Math.round(scale * 100)}%</button>
          <button onClick={() => applyScale(scale + 0.1)} disabled={scale >= 2}>+</button>
        </div>
      </div>

      <div id="amc_layout">
        <nav id="amc_nav">
          {SECTIONS.map(({ id, label }, i) => (
            <button
              key={id}
              className={`amc_nav_item${activeId === id ? " amc_nav_item--active" : ""}`}
              onClick={() => scrollTo(id)}
            >
              <span className="amc_nav_item_num">{String(i + 1).padStart(2, "0")}</span>
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div id="amc_scroll" ref={scrollRef}>
          <div id="amc_body" ref={bodyRef} style={{ fontSize: `${scale}rem` }}>

            {/* ══════════════════════════════════════════════════════════
                HERO — Core definition + the master architecture diagram
               ══════════════════════════════════════════════════════════ */}
            <section id="amc-hero" className="amc_section" style={{ borderTop: "none" }}>
              <div id="amc_hero">
                <div id="amc_hero_eyebrow">A Model, Not a Product Category</div>
                <h1 id="amc_hero_title">
                  AMCTOSHS is not the ontic patient.<br />
                  It is the representational patient through which<br />
                  the ontic patient becomes intelligible.
                </h1>
                <p className="amc_lede">
                  AMCTOSHS is <strong>not simply a medical application, EHR, clinical database,
                  or diagnostic AI.</strong> It is a model of a <strong>representational patient</strong>{" "}
                  constructed from traces of an inaccessible <strong>ontic patient</strong>.
                </p>
                <p className="amc_lede">
                  Those concepts may overlap technically with parts of its implementation, but
                  none of them alone define AMCTOSHS. Do not reinterpret AMCTOSHS into a
                  conventional medical informatics model. It is not merely:
                </p>
                <ul className="amc_not_list">
                  <li>a digital twin</li>
                  <li>an EHR</li>
                  <li>a patient database</li>
                  <li>a knowledge graph</li>
                  <li>a diagnostic AI</li>
                  <li>a clinical decision support system</li>
                </ul>

                <Diagram title="The AMCTOSHS Architecture">
                  <Node>ONTIC PATIENT</Node>
                  <ArrowDown label="produces traces" />
                  <Node>MODES OF ACCESS</Node>
                  <Branch>
                    <BranchCol><Node small>patient-as-speakable</Node></BranchCol>
                    <BranchCol><Node small>patient-as-unspeakable</Node></BranchCol>
                  </Branch>
                  <ArrowDown />
                  <Node>TRACES BECOME REPRESENTABLE</Node>
                  <ArrowDown />
                  <Node>INSTANTIATION OF AMCTOSHS ENTITY SCHEMA</Node>
                  <ArrowDown />
                  <Node variant="accent" wide>
                    AMCTOSHS(t)
                    <span className="amc_node_sub">= one 3D representational slice of the ontic patient&rsquo;s Identity</span>
                  </Node>
                  <ArrowDown label="multiple temporally ordered instantiations" />
                  <Node variant="accent" wide>
                    AMCTOSHS(t₁ → tₙ)
                    <span className="amc_node_sub">= 4D representational patient</span>
                  </Node>
                  <ArrowDown />
                  <Node>REASONING</Node>
                  <ArrowDown />
                  <Node variant="ghost" wide>better understanding of the inaccessible ontic patient</Node>
                </Diagram>
              </div>
            </section>

            {/* ══════════════════════════════════════════════════════════
                1 — Ontic vs Representational Patient
               ══════════════════════════════════════════════════════════ */}
            <Section id="amc-ontic" title="Ontological Level — Ontic Patient vs Representational Patient">
              <p className="amc_section_body">
                There is an <strong>ontic patient</strong>, existing independently of our representation.
              </p>
              <p className="amc_section_body">
                But we cannot directly possess or reproduce that patient epistemically.
              </p>
              <p className="amc_section_body">
                We only encounter <strong>traces</strong>.
              </p>
              <Diagram><Node variant="ghost">Ontic patient ≠ known patient</Node></Diagram>
              <p className="amc_section_body">
                The ontic patient remains epistemically inaccessible in full. This distinction
                is <strong>fundamental to AMCTOSHS</strong>.
              </p>
              <Callout>
                AMCTOSHS must never be presented as though it <em>is</em> the ontic patient.
                AMCTOSHS is a representation through which we attempt to understand the ontic patient.
              </Callout>

              <DefinitionBlock label="Core Epistemological Principle">
                We cannot reach the ontic patient directly. We can only access traces of the
                ontic patient. Through modes of access, these traces become the basis for
                structured representations that instantiate AMCTOSHS. AMCTOSHS is therefore
                the <strong>representational patient</strong> through which we attempt to
                understand the inaccessible ontic patient.
              </DefinitionBlock>
            </Section>

            {/* ══════════════════════════════════════════════════════════
                2 — Traces & Modes of Access (intro)
               ══════════════════════════════════════════════════════════ */}
            <Section id="amc-traces" title="Modes of Access">
              <p className="amc_section_body">
                The traces of the ontic patient become available through two fundamental{" "}
                <strong>modes of access</strong>:
              </p>
              <Diagram>
                <Node small>patient-as-speakable</Node>
                <Node small>patient-as-unspeakable</Node>
              </Diagram>
              <p className="amc_section_body">These are not two patients.</p>
              <Callout>
                They are two <strong>modes of access to the traces of one ontic patient</strong>.
              </Callout>
            </Section>

            {/* ══════════════════════════════════════════════════════════
                3 — Patient-as-Speakable
               ══════════════════════════════════════════════════════════ */}
            <Section id="amc-speakable" title="Patient-as-Speakable">
              <p className="amc_section_body">
                <strong>Patient-as-speakable</strong> is the mode through which the patient becomes
                accessible through what can be articulated, narrated, reported, remembered,
                answered, or otherwise rendered into discourse.
              </p>
              <p className="amc_section_body">It includes what can be:</p>
              <ul className="amc_plain_list">
                {["said by the patient", "answered when asked", "narrated", "described", "remembered", "interpreted linguistically", "reported by relatives or witnesses"].map((t) => <li key={t}>{t}</li>)}
              </ul>

              <p className="amc_section_body">For example:</p>
              <Quote>
                &ldquo;I started having chest pain yesterday. It gets worse when I breathe deeply,
                but it feels better when I sit forward.&rdquo;
              </Quote>
              <p className="amc_section_body">
                The physician does <strong>not directly encounter the chest pain</strong>.
              </p>
              <p className="amc_section_body">
                The physician encounters a <strong>linguistic trace produced about the chest pain</strong>.
              </p>

              <Diagram>
                <Node>Ontic patient</Node>
                <ArrowDown label="produces" />
                <Node small>Experience of chest pain</Node>
                <ArrowDown label="expressed through" />
                <Node small>Speech / narrative</Node>
                <ArrowDown label="encountered through a mode of access" />
                <Node small>Linguistic trace</Node>
                <ArrowDown label="represented in AMCTOSHS" />
                <Node variant="accent">AMCTOSHS</Node>
              </Diagram>

              <p className="amc_section_body">The patient-as-speakable can provide access to things such as:</p>
              <ul className="amc_plain_list">
                {["pain", "fatigue", "memory", "prior events", "medication use", "social context", "beliefs", "symptoms no observer can directly measure", "temporal relationships", "personal narrative"].map((t) => <li key={t}>{t}</li>)}
              </ul>

              <p className="amc_section_body">A trace may look conceptually like:</p>
              <div className="amc_code_pair">
                <Code>{`{
  "mode_of_access": "patient_as_speakable",
  "trace": {
    "type": "utterance",
    "content": "The pain gets worse when
                 I take a deep breath."
  }
}`}</Code>
                <Code>{`{
  "representation": {
    "subject": "chest_pain",
    "property": "relation_to_inspiration",
    "value": "worsens"
  }
}`}</Code>
              </div>
              <p className="amc_section_body">AMCTOSHS may then construct a representation such as the one above from the trace on the left.</p>

              <p className="amc_section_body">The distinction must remain explicit:</p>
              <Neq a="utterance" b="representation" c="ontic reality" />
              <Callout>These are epistemologically distinct.</Callout>
            </Section>

            {/* ══════════════════════════════════════════════════════════
                Patient-as-Speakable as a Response to Identity Discrepancy
               ══════════════════════════════════════════════════════════ */}
            <Section id="amc-speakable-discrepancy" title="Patient-as-Speakable as a Response to Identity Discrepancy">
              <DefinitionBlock>
                A patient speaks out when the current slice of Identity contains a state,
                sensation, function, or relation that differs meaningfully from the slices of
                Identity to which the patient is accustomed.
              </DefinitionBlock>

              <Diagram>
                <Node small>Usual Identity slices<span className="amc_node_sub">t₁ → t₂ → t₃ → t₄ — stable / familiar pattern</span></Node>
                <ArrowDown />
                <Node small>Current slice t₅<span className="amc_node_sub">contains unfamiliar change</span></Node>
                <ArrowDown label="experienced as discrepancy" />
                <Node small>pain / dysfunction / fear / limitation / novelty</Node>
                <ArrowDown />
                <Node small>patient speaks out</Node>
                <ArrowDown />
                <Node variant="accent">patient-as-speakable</Node>
              </Diagram>

              <p className="amc_section_body">Example:</p>
              <div className="amc_code_pair">
                <Code>{`Usual slices:
walking without chest pain
walking without dyspnea
normal strength`}</Code>
                <Code>{`Current slice:
walking → chest pain`}</Code>
              </div>
              <Diagram>
                <Node small>Difference from expected Identity continuity</Node>
                <ArrowDown />
                <Node variant="ghost" wide>&ldquo;I get chest pain when I walk.&rdquo;</Node>
              </Diagram>

              <Callout>
                The patient is not merely reporting a symptom. The patient is reporting a{" "}
                <strong>perceived deviation in their own Identity across time</strong>.
              </Callout>

              <p className="amc_section_body">Represent this relation explicitly:</p>
              <Diagram>
                <Node small>CURRENT IDENTITY SLICE</Node>
                <div className="amc_neq_row" style={{ margin: "0.3rem 0" }}>
                  <span className="amc_neq_sign" style={{ margin: "0 auto" }}>≠</span>
                </div>
                <Node small>EXPECTED / HABITUAL IDENTITY SLICES</Node>
                <ArrowDown />
                <Node small>DISCREPANCY IS EXPERIENCED</Node>
                <ArrowDown />
                <Node>PATIENT SPEAKS OUT</Node>
              </Diagram>

              <Callout warn>
                Do not reduce this principle to: <strong>new state → speak</strong>. That is too narrow.
              </Callout>
              <p className="amc_section_body">
                A patient may speak out about something chronic that they are already used to
                having because it:
              </p>
              <ul className="amc_plain_list">
                {["worsened", "changed character", "crossed a tolerance threshold", "interfered with a new function", "became meaningful in a new context"].map((t) => <li key={t}>{t}</li>)}
              </ul>
              <p className="amc_section_body">Therefore, the stronger principle is:</p>
              <Callout><strong>perceived mismatch between current Identity and expected Identity → speak</strong></Callout>

              <p className="amc_section_body">Preserve this distinction:</p>
              <Neq a="Ontic change" b="Experienced discrepancy" c="Spoken trace" />

              <p className="amc_section_body">The full conceptual relation is:</p>
              <Diagram>
                <Node small>past self-experienced / represented Identity</Node>
                <ArrowDown label="compared with" />
                <Node small>current experienced Identity</Node>
                <ArrowDown />
                <Node small>difference becomes salient</Node>
                <ArrowDown />
                <Node small>speech / shout / complaint / narrative</Node>
                <ArrowDown />
                <Node small>trace available through patient-as-speakable</Node>
                <ArrowDown />
                <Node variant="accent">representation in AMCTOSHS</Node>
              </Diagram>

              <p className="amc_section_body">This provides a deeper foundation for the <strong>chief complaint</strong>:</p>
              <DefinitionBlock label="Foundation for the Chief Complaint">
                The chief complaint is often the linguistic emergence of a perceived break in
                expected Identity continuity.
              </DefinitionBlock>

              <Callout>
                Do not present this as an absolute rule that all speech requires novelty. Present
                it as a central mechanism by which patient-as-speakable often emerges from
                temporal self-comparison across Identity slices.
              </Callout>
            </Section>

            {/* ══════════════════════════════════════════════════════════
                4 — Patient-as-Unspeakable
               ══════════════════════════════════════════════════════════ */}
            <Section id="amc-unspeakable" title="Patient-as-Unspeakable">
              <p className="amc_section_body">
                <strong>Patient-as-unspeakable</strong> is the mode through which the patient
                becomes accessible through traces that do not depend on the patient&rsquo;s
                discursive self-representation.
              </p>
              <p className="amc_section_body">Examples include:</p>
              <ul className="amc_plain_list">
                {["ECG waveform", "blood pressure", "heart sounds", "skin color", "CT image", "serum troponin", "temperature", "histology", "heart rate", "physical movement", "palpated mass", "pupil response", "laboratory measurements", "electrical signals", "morphology", "physiology", "physical examination", "imaging"].map((t) => <li key={t}>{t}</li>)}
              </ul>

              <p className="amc_section_body">For example, the heart does not tell the physician:</p>
              <Quote>&ldquo;I have a pericardial effusion.&rdquo;</Quote>
              <p className="amc_section_body">
                Instead, there may be an <strong>echocardiographic trace</strong> from which a
                representation is constructed.
              </p>

              <Diagram>
                <Node>Ontic patient</Node>
                <ArrowDown />
                <Node small>Physical state/process</Node>
                <ArrowDown label="produces" />
                <Node small>Physical/measurable trace</Node>
                <ArrowDown label="encountered through" />
                <Node small>Mode of access / instrument / examination</Node>
                <ArrowDown />
                <Node variant="accent">Representation in AMCTOSHS</Node>
              </Diagram>

              <div className="amc_code_pair">
                <Code>{`{
  "mode_of_access": "patient_as_unspeakable",
  "trace": {
    "type": "electrophysiological_trace",
    "source": "ECG",
    "content": "measured_signal"
  }
}`}</Code>
                <Code>{`{
  "representation": {
    "subject": "ECG",
    "property": "ST_segment_distribution",
    "value": "diffuse_elevation"
  }
}`}</Code>
              </div>

              <p className="amc_section_body">Again, these must not be collapsed:</p>
              <Neq a="ECG signal" b={<>&ldquo;diffuse ST elevation&rdquo;</>} c="pericarditis" />
              <Callout>These are three epistemologically distinct levels.</Callout>
            </Section>

            {/* ══════════════════════════════════════════════════════════
                5 — NOT Subjective/Objective
               ══════════════════════════════════════════════════════════ */}
            <Section id="amc-not-subobj" title="Speakable/Unspeakable Is NOT Subjective/Objective">
              <p className="amc_section_body">This distinction is critical.</p>
              <Callout warn>
                Do <strong>not</strong> define: Speakable = subjective, Unspeakable = objective.
                That is wrong.
              </Callout>

              <p className="amc_section_body">For example, a physician may say:</p>
              <Quote>&ldquo;I hear a systolic murmur.&rdquo;</Quote>
              <p className="amc_section_body">
                The statement is linguistically expressed, but the <strong>epistemic origin of
                the evidence</strong> is patient-as-unspeakable. The chain is:
              </p>
              <Diagram>
                <Node small>Ontic cardiac phenomenon</Node>
                <ArrowDown />
                <Node small>acoustic trace</Node>
                <ArrowDown />
                <Node small>physician perception</Node>
                <ArrowDown />
                <Node small>physician statement</Node>
              </Diagram>
              <p className="amc_section_body">
                Therefore, the final stored representation may be linguistic — <em>&ldquo;systolic
                murmur&rdquo;</em> — but its <strong>mode of access / epistemic origin</strong> remains
                patient-as-unspeakable.
              </p>

              <p className="amc_section_body">Similarly:</p>
              <Quote>&ldquo;My glucose monitor says 320.&rdquo;</Quote>
              <p className="amc_section_body">
                This is spoken by the patient, but the information originated from an instrument.
              </p>
            </Section>

            {/* ══════════════════════════════════════════════════════════
                6 — Trace Medium vs Mode of Access
               ══════════════════════════════════════════════════════════ */}
            <Section id="amc-medium" title="Trace Medium vs Mode of Access">
              <p className="amc_section_body">
                AMCTOSHS must distinguish at least two dimensions:
              </p>
              <div className="amc_code_pair">
                <div>
                  <div className="amc_subheading" style={{ marginTop: 0 }}>Mode of access</div>
                  <ul className="amc_plain_list">
                    <li>patient-as-speakable</li>
                    <li>patient-as-unspeakable</li>
                  </ul>
                </div>
                <div>
                  <div className="amc_subheading" style={{ marginTop: 0 }}>Trace medium</div>
                  <ul className="amc_plain_list">
                    {["speech", "text", "image", "sound", "electrical signal", "chemical measurement", "physical interaction", "etc."].map((t) => <li key={t}>{t}</li>)}
                  </ul>
                </div>
              </div>
              <Callout warn>These must <strong>not be conflated</strong>.</Callout>
            </Section>

            {/* ══════════════════════════════════════════════════════════
                7 — AMCTOSHS Entity Schema
               ══════════════════════════════════════════════════════════ */}
            <Section id="amc-schema" title="AMCTOSHS Entity Schema">
              <p className="amc_section_body">
                The <strong>AMCTOSHS Entity Schema</strong> is the formal representational schema
                capable of being instantiated from traces.
              </p>
              <p className="amc_section_body">It defines:</p>
              <Callout><strong>how a patient can be represented</strong></Callout>
              <p className="amc_section_body">
                The AMCTOSHS Entity Schema is not itself a particular patient.
              </p>
              <Diagram>
                <Node wide>AMCTOSHS ENTITY SCHEMA<span className="amc_node_sub">= schema of a representational patient</span></Node>
              </Diagram>
              <p className="amc_section_body">A particular instantiation is something conceptually like:</p>
              <Diagram>
                <Node variant="accent" wide>AMCTOSHS of a particular patient at t₁<span className="amc_node_sub">= concrete instantiation of that schema</span></Node>
              </Diagram>
              <p className="amc_section_body">
                The schema provides the formal structure into which representations derived from
                traces can be instantiated.
              </p>
            </Section>

            {/* ══════════════════════════════════════════════════════════
                8 — 3D AMCTOSHS Instantiation
               ══════════════════════════════════════════════════════════ */}
            <Section id="amc-3d" title="Each Instantiation Is a 3D Slice of the Ontic Patient's Identity">
              <p className="amc_section_body">
                This is <strong>one of the most important principles of the entire model</strong>.
              </p>
              <p className="amc_section_body">Each instantiation, AMCTOSHS(t), is a:</p>
              <Callout><strong>3D representational slice of the ontic patient&rsquo;s Identity.</strong></Callout>
              <p className="amc_section_body">It is not the ontic patient itself.</p>
              <p className="amc_section_body">It is not merely &ldquo;data collected at a time.&rdquo;</p>
              <p className="amc_section_body">It is a structured representation of:</p>
              <Callout>who/what this patient is represented as being at this temporal slice.</Callout>

              <Diagram>
                <Node small>Traces accessible at/around t₁</Node>
                <ArrowDown />
                <Node small>Modes of access</Node>
                <ArrowDown />
                <Node small>AMCTOSHS Entity Schema</Node>
                <ArrowDown label="instantiate" />
                <Node variant="accent">AMCTOSHS(t₁)</Node>
                <ArrowDown />
                <Node variant="ghost" wide>3D slice of the ontic patient&rsquo;s represented Identity</Node>
              </Diagram>

              <p className="amc_section_body">The distinction must remain:</p>
              <Neq a="Ontic patient" b="AMCTOSHS slice" />
              <p className="amc_section_body">Rather:</p>
              <Diagram>
                <Node small>Ontic patient&rsquo;s traces</Node>
                <ArrowDown label="mode of access" />
                <Node small>representation of Identity-at-t</Node>
                <ArrowDown />
                <Node variant="accent">AMCTOSHS(t)</Node>
              </Diagram>
            </Section>

            {/* ══════════════════════════════════════════════════════════
                9 — Identity
               ══════════════════════════════════════════════════════════ */}
            <Section id="amc-identity" title="Identity">
              <p className="amc_section_body">
                Each AMCTOSHS instantiation is specifically a slice of the{" "}
                <strong>Identity of the ontic patient</strong>. The concept of Identity is essential.
              </p>
              <p className="amc_section_body">
                The patient is not represented as a random collection of measurements. The
                representations belong to <strong>one continuing identity</strong>.
              </p>

              <Diagram>
                <Node variant="accent">Identity</Node>
                <Branch>
                  <BranchCol label="t₁ slice"><Node small>AMCTOSHS₁</Node></BranchCol>
                  <BranchCol label="t₂ slice"><Node small>AMCTOSHS₂</Node></BranchCol>
                  <BranchCol label="t₃ slice"><Node small>AMCTOSHS₃</Node></BranchCol>
                </Branch>
                <ArrowDown />
                <Node variant="accent" wide>4D AMCTOSHS</Node>
              </Diagram>

              <p className="amc_section_body">
                The temporal slices belong to the same represented patient because{" "}
                <strong>Identity is preserved through change</strong>.
              </p>
            </Section>

            {/* ══════════════════════════════════════════════════════════
                10 — 4D AMCTOSHS (+ the dedicated 3D vs 4D recap)
               ══════════════════════════════════════════════════════════ */}
            <Section id="amc-4d" title="The 4D AMCTOSHS">
              <DefinitionBlock label="Core Dimensional Principle">
                Each instantiation of the AMCTOSHS Entity Schema is a{" "}
                <strong>3D representational slice</strong> of the ontic patient&rsquo;s Identity.
                The ordered integration of identity-preserving AMCTOSHS instantiations across
                time constitutes the <strong>4D AMCTOSHS</strong> representation of that patient.
              </DefinitionBlock>

              <p className="amc_section_body">
                The full AMCTOSHS representation emerges when multiple 3D instantiations are
                related across time:
              </p>
              <Diagram>
                <Node small>AMCTOSHS(t₁)</Node>
                <ArrowDown />
                <Node small>AMCTOSHS(t₂)</Node>
                <ArrowDown />
                <Node small>AMCTOSHS(t₃)</Node>
                <ArrowDown />
                <Node small>…</Node>
                <ArrowDown />
                <Node small>AMCTOSHS(tₙ)</Node>
              </Diagram>
              <p className="amc_section_body">The result is AMCTOSHS(t₁ → tₙ), which is the:</p>
              <Callout><strong>4D representational patient</strong></Callout>
              <p className="amc_section_body">This is not merely a stack of snapshots.</p>
              <p className="amc_section_body">
                The identity-preserving temporal relationships between these slices produce the
                4D representation. The 4D AMCTOSHS contains concepts such as:
              </p>
              <div className="amc_equation_row">
                {["state", "persistence", "change", "events", "temporal order", "emergence", "disappearance", "relations among states"].map((t, i, arr) => (
                  <React.Fragment key={t}>
                    <span className="amc_equation_term">{t}</span>
                    {i < arr.length - 1 && <span className="amc_plus">+</span>}
                  </React.Fragment>
                ))}
                <span className="amc_eq">=</span>
                <span className="amc_equation_result">4D AMCTOSHS</span>
              </div>
              <p className="amc_section_body">
                AMCTOSHS therefore represents something closer to a{" "}
                <strong>worldline of patient Identity</strong> than a static medical record.
              </p>

              <table className="amc_compare_table">
                <thead><tr><th>3D state / slice</th><th>4D temporal relation</th></tr></thead>
                <tbody>
                  <tr>
                    <td>BP = 90/60 at 10:00</td>
                    <td>BP 120/80 → falls to 100/70 → falls to 90/60 → after fluids rises to 110/75</td>
                  </tr>
                </tbody>
              </table>
              <p className="amc_section_body">
                The second row expresses temporal relations and changing states within the 4D
                AMCTOSHS. The identity of the represented patient persists through those changes.
              </p>

              <div className="amc_subheading">3D Versus 4D</div>
              <p className="amc_section_body">
                <strong>3D</strong> — each AMCTOSHS instantiation, AMCTOSHS(t), represents a{" "}
                <strong>3D slice of the ontic patient&rsquo;s Identity</strong> — one temporally
                bounded representational state.
              </p>
              <p className="amc_section_body">
                <strong>4D</strong> — the temporal integration of identity-linked 3D slices creates
                AMCTOSHS(t₁ → tₙ), the <strong>4D representational patient</strong>.
              </p>

              <div className="amc_timeline">
                {["t₁", "t₂", "t₃", "t₄"].map((t, i) => (
                  <React.Fragment key={t}>
                    <div className="amc_timeline_step">
                      <div className="amc_timeline_t">{t}</div>
                      <div className="amc_timeline_dot" />
                      <div className="amc_timeline_node">AMCTOSHS{["₁","₂","₃","₄"][i]}</div>
                    </div>
                    {i < 3 && <div className="amc_timeline_line" />}
                  </React.Fragment>
                ))}
              </div>
              <div className="amc_timeline_brace">
                <strong>4D AMCTOSHS</strong> — continuity of represented patient Identity
              </div>

              <Callout>The 4D AMCTOSHS is not merely many snapshots stored together.</Callout>
              <p className="amc_section_body">The slices are related by:</p>
              <ul className="amc_plain_list">
                {["identity", "temporal order", "state transitions", "persistence", "change", "emergence", "disappearance", "events", "relations"].map((t) => <li key={t}>{t}</li>)}
              </ul>
            </Section>

            {/* ══════════════════════════════════════════════════════════
                11 — Domains
               ══════════════════════════════════════════════════════════ */}
            <Section id="amc-domains" title="Domains of AMCTOSHS">
              <p className="amc_section_body">AMCTOSHS represents the patient across the following domains:</p>
              <div className="amc_domain_row">
                {["Atoms", "Molecules", "Cells", "Tissues", "Organs", "Organ Systems"].map((d, i, arr) => (
                  <React.Fragment key={d}>
                    <span className="amc_domain_chip">{d}</span>
                    {i < arr.length - 1 && <span className="amc_domain_arrow">→</span>}
                  </React.Fragment>
                ))}
              </div>
              <div className="amc_domain_row">
                <span className="amc_domain_chip amc_domain_chip--social">Humans</span>
                <span className="amc_domain_arrow">→</span>
                <span className="amc_domain_chip amc_domain_chip--social">Societies</span>
              </div>

              <p className="amc_section_body">
                These domains belong to <strong>one representational architecture</strong>. They
                must not be presented as disconnected databases or independent datasets. They
                are different domains through which the Identity of the represented patient can
                be structured.
              </p>
              <p className="amc_section_body">
                The lower/material domains represent bodily organization across scales — Atoms →
                Molecules → Cells → Tissues → Organs → Organ Systems.
              </p>
              <p className="amc_section_body">
                The <strong>Humans</strong> and <strong>Societies</strong> domains are especially
                important for representing dimensions of the patient that involve narrative,
                behavior, relationships, social context, meaning, discourse, and the patient&rsquo;s
                existence within larger human and social structures.
              </p>
              <Callout warn>
                Patient-as-speakable has an especially important relationship to these domains,
                but the architecture must not falsely imply that speakable information belongs
                only to Human/Society or that unspeakable information belongs only to biological
                domains.
              </Callout>
              <p className="amc_section_body">
                The entire AMCTOSHS remains <strong>one representational patient</strong>.
              </p>
            </Section>

            {/* ══════════════════════════════════════════════════════════
                12 — Representation Before Reasoning
               ══════════════════════════════════════════════════════════ */}
            <Section id="amc-before" title="Representation Comes Before Reasoning">
              <div className="amc_subheading" style={{ marginTop: 0 }}>AMCTOSHS Is Not a Conventional Medical Record</div>
              <Callout warn>
                Do not present the architecture as: history / physical examination / labs /
                imaging. These are useful clinical workflow categories, but they are not the
                fundamental epistemological architecture of AMCTOSHS.
              </Callout>
              <p className="amc_section_body">The deeper architecture is:</p>
              <Diagram>
                <Node>ONTIC PATIENT</Node>
                <ArrowDown />
                <Node small>TRACES</Node>
                <ArrowDown />
                <Node small>MODES OF ACCESS</Node>
                <Branch>
                  <BranchCol><Node small>patient-as-speakable</Node></BranchCol>
                  <BranchCol><Node small>patient-as-unspeakable</Node></BranchCol>
                </Branch>
                <ArrowDown />
                <Node small>REPRESENTATIONS</Node>
                <ArrowDown />
                <Node small>AMCTOSHS INSTANTIATIONS</Node>
                <ArrowDown />
                <Node small>4D REPRESENTATIONAL PATIENT</Node>
                <ArrowDown />
                <Node>REASONING</Node>
              </Diagram>
              <p className="amc_section_body">
                Traditional categories such as history, examination, imaging, and laboratory
                testing may exist within the system, but they are <strong>subordinate to this
                deeper architecture</strong>.
              </p>

              <div className="amc_subheading">Representation Comes Before Reasoning</div>
              <p className="amc_section_body">
                AMCTOSHS is explicitly <strong>not</strong> intended to follow the simplistic architecture:
              </p>
              <Diagram>
                <Node small>raw data</Node>
                <ArrowDown />
                <Node small>AI</Node>
                <ArrowDown />
                <Node small>diagnosis</Node>
              </Diagram>
              <p className="amc_section_body">Instead:</p>
              <Diagram>
                <Node small>traces</Node>
                <ArrowDown />
                <Node small>modes of access</Node>
                <ArrowDown />
                <Node small>structured representations</Node>
                <ArrowDown />
                <Node small>3D AMCTOSHS instantiations</Node>
                <ArrowDown />
                <Node small>4D representational patient</Node>
                <ArrowDown />
                <Node small>reasoning over AMCTOSHS</Node>
                <ArrowDown />
                <Node variant="accent">understanding / inference / diagnosis / decision</Node>
              </Diagram>
              <Callout>
                The <strong>object of reasoning is AMCTOSHS</strong>, not the ontic patient
                directly. Reasoning therefore occurs over representations. It never claims direct
                epistemic possession of the ontic patient.
              </Callout>
            </Section>

            {/* ══════════════════════════════════════════════════════════
                13 — The Reasoning Layer
               ══════════════════════════════════════════════════════════ */}
            <Section id="amc-reasoning" title="The Reasoning Layer">
              <p className="amc_section_body">The reasoning layer operates on the representational patient. It can ask questions such as:</p>
              <ul className="amc_prose_list">
                <li>What is represented?</li>
                <li>What changed?</li>
                <li>What persisted?</li>
                <li>What preceded what?</li>
                <li>What explains what?</li>
                <li>What is missing?</li>
                <li>What is contradictory?</li>
                <li>What hypothesis best accounts for these representations?</li>
                <li>What new mode of access should be used to obtain additional traces?</li>
              </ul>
              <p className="amc_section_body">Reasoning may operate <strong>within one 3D slice</strong>, and <strong>across multiple temporally related 3D slices</strong>. Therefore it can reason about:</p>
              <ul className="amc_plain_list">
                {["state", "change", "persistence", "emergence", "disappearance", "temporal order", "causal relationships", "hypotheses", "diagnosis", "decisions", "future information needs"].map((t) => <li key={t}>{t}</li>)}
              </ul>

              <div className="amc_subheading">Reasoning Must Preserve Epistemic Boundaries</div>
              <p className="amc_section_body">
                The reasoning layer must never falsely turn an inference into an observed trace. For example:
              </p>
              <Diagram>
                <Node small>ECG signal</Node>
                <ArrowDown label="interpretation" />
                <Node small>diffuse ST elevation</Node>
                <ArrowDown label="reasoning" />
                <Node small>acute pericarditis hypothesis</Node>
              </Diagram>
              <p className="amc_section_body">These are different epistemic levels. Do not collapse them into:</p>
              <Callout warn>&ldquo;patient has acute pericarditis&rdquo;</Callout>
              <p className="amc_section_body">as though AMCTOSHS had direct access to ontic truth. Instead, the representation should preserve the distinction between:</p>
              <div className="amc_equation_row">
                {["trace", "representation", "interpretation", "inference", "hypothesis", "conclusion"].map((t, i, arr) => (
                  <React.Fragment key={t}>
                    <span className="amc_equation_term">{t}</span>
                    {i < arr.length - 1 && <span className="amc_plus" aria-hidden="true">→</span>}
                  </React.Fragment>
                ))}
              </div>
              <Callout>
                The system reasons toward better understanding of the ontic patient, but never
                becomes epistemically identical to the ontic patient.
              </Callout>

              <div className="amc_subheading">Reasoning Reunifies the Epistemically Divided Encounter</div>
              <p className="amc_section_body">
                The ontic patient is one. But the patient becomes available through different
                modes of access.
              </p>
              <Diagram>
                <Node>ONTIC PATIENT</Node>
                <ArrowDown />
                <Node small>TRACES</Node>
                <Branch>
                  <BranchCol><Node small>PATIENT-AS-SPEAKABLE</Node><ArrowDown /><Node small>REPRESENTATIONS</Node></BranchCol>
                  <BranchCol><Node small>PATIENT-AS-UNSPEAKABLE</Node><ArrowDown /><Node small>REPRESENTATIONS</Node></BranchCol>
                </Branch>
                <ArrowDown />
                <Node variant="accent">AMCTOSHS</Node>
                <ArrowDown />
                <Node>REASONING</Node>
                <ArrowDown />
                <Node variant="ghost" wide>MORE COHERENT REPRESENTATION OF PATIENT IDENTITY</Node>
              </Diagram>
              <DefinitionBlock>
                Reasoning attempts to <strong>reunify</strong>, within the representational
                patient, the traces of the one ontic patient that became epistemically available
                through different modes of access.
              </DefinitionBlock>
            </Section>

            {/* ══════════════════════════════════════════════════════════
                14 — ASK / EXAMINE
               ══════════════════════════════════════════════════════════ */}
            <Section id="amc-ask-examine" title="ASK and EXAMINE Follow the Two Modes of Access">
              <p className="amc_section_body">
                The older clinical <strong>DOCTOR LOOP</strong> gains a deeper formal basis in AMCTOSHS.
              </p>
              <p className="amc_section_body">
                <strong>ASK</strong> primarily interrogates the patient through patient-as-speakable.
              </p>
              <p className="amc_section_body">
                <strong>EXAMINE</strong> primarily interrogates the patient through patient-as-unspeakable.
              </p>

              <Diagram>
                <Node>ENCOUNTER</Node>
                <Branch>
                  <BranchCol>
                    <Node small>ASK</Node><ArrowDown /><Node small>SPEAKABLE</Node>
                  </BranchCol>
                  <BranchCol>
                    <Node small>EXAMINE</Node><ArrowDown /><Node small>UNSPEAKABLE</Node>
                  </BranchCol>
                </Branch>
                <ArrowDown label="→ VERIFY →" />
                <Node small>ASSIGN</Node>
                <ArrowDown />
                <Node small>THINK</Node>
                <ArrowDown />
                <Node variant="ghost" wide>determine what to ASK / EXAMINE next</Node>
              </Diagram>

              <Callout warn>
                Do not reduce ASK to &ldquo;history taking&rdquo; and EXAMINE to only &ldquo;physical
                examination.&rdquo; Conceptually, they correspond to the two fundamental modes of access.
              </Callout>
            </Section>

            {/* ══════════════════════════════════════════════════════════
                15 — Recursive Epistemic Loop
               ══════════════════════════════════════════════════════════ */}
            <Section id="amc-recursive" title="The Recursive Clinical Epistemic Loop">
              <p className="amc_section_body">
                Reasoning can identify an information gap. That information gap can determine the
                next mode of access. Then new traces can be obtained. Those traces can produce new
                representations. Those representations can instantiate or update AMCTOSHS. Then
                reasoning occurs again.
              </p>
              <Diagram title="The Loop">
                <Node>REASONING</Node>
                <ArrowDown label="information gap identified" />
                <Node small>choose mode of access</Node>
                <Branch>
                  <BranchCol><Node small>ASK / patient-as-speakable</Node></BranchCol>
                  <BranchCol><Node small>EXAMINE / patient-as-unspeakable</Node></BranchCol>
                </Branch>
                <ArrowDown />
                <Node small>new traces</Node>
                <ArrowDown />
                <Node small>new representations</Node>
                <ArrowDown />
                <Node small>new AMCTOSHS instantiation / update</Node>
                <ArrowDown />
                <Node small>new reasoning</Node>
                <ArrowDown />
                <Node variant="ghost" wide>new information gap or conclusion</Node>
              </Diagram>
            </Section>

            {/* ══════════════════════════════════════════════════════════
                16 — Pericarditis example
               ══════════════════════════════════════════════════════════ */}
            <Section id="amc-pericarditis" title="Example: Acute Pericarditis">
              <div className="amc_code_pair">
                <div>
                  <div className="amc_subheading" style={{ marginTop: 0 }}>Patient-as-Speakable</div>
                  <Quote tag="S1">&ldquo;The pain is worse when I breathe deeply.&rdquo;</Quote>
                  <Quote tag="S2">&ldquo;It feels better when I lean forward.&rdquo;</Quote>
                  <p className="amc_section_body" style={{ fontSize: "0.85em" }}>
                    S1 → pleuritic characteristic of pain<br />
                    S2 → positional characteristic of pain
                  </p>
                </div>
                <div>
                  <div className="amc_subheading" style={{ marginTop: 0 }}>Patient-as-Unspeakable</div>
                  <Quote tag="U1">ECG → diffuse ST-segment elevation</Quote>
                  <Quote tag="U2">Auscultation → pericardial friction rub</Quote>
                </div>
              </div>

              <p className="amc_section_body">Then reasoning integrates them:</p>
              <Diagram>
                <Branch>
                  <BranchCol label="Speakable">
                    <Node small>S1 → pleuritic pain</Node>
                    <Node small>S2 → positional pain</Node>
                  </BranchCol>
                  <BranchCol label="Unspeakable">
                    <Node small>U1 → diffuse ST ↑</Node>
                    <Node small>U2 → friction rub</Node>
                  </BranchCol>
                </Branch>
                <ArrowDown />
                <Node variant="accent" wide>acute pericarditis hypothesis</Node>
              </Diagram>

              <Callout>
                This does <strong>not</strong> mean the system directly touched &ldquo;acute
                pericarditis&rdquo; in the ontic patient. It means that representations derived
                from traces support a hypothesis that best explains the represented state.
              </Callout>
            </Section>

            {/* ══════════════════════════════════════════════════════════
                17 — Conceptual Distinctions
               ══════════════════════════════════════════════════════════ */}
            <Section id="amc-distinctions" title="Conceptual Distinctions That Must Never Be Collapsed">
              <div className="amc_neq_grid">
                <Neq a="Ontic patient" b="AMCTOSHS" />
                <Neq a="Trace" b="Representation" />
                <Neq a="Representation" b="Ontic reality" />
                <Neq a="Observation/interpretation" b="Inference" />
                <Neq a="Hypothesis" b="Fact about the ontic patient" />
                <Neq a="Patient-as-speakable" b="Subjective" />
                <Neq a="Patient-as-unspeakable" b="Objective" />
                <Neq a="Trace medium" b="Mode of access" />
                <Neq a="AMCTOSHS Entity Schema" b="AMCTOSHS instantiation" />
                <Neq a="3D AMCTOSHS slice" b="4D AMCTOSHS" />
                <Neq a="AMCTOSHS" b="Electronic Health Record" />
                <Neq a="Reasoning over AMCTOSHS" b="Direct reasoning over the ontic patient" />
              </div>
              <Callout>These distinctions are critical to the ontology.</Callout>
            </Section>

            {/* ══════════════════════════════════════════════════════════
                18 — Complete Architecture (mega diagram)
               ══════════════════════════════════════════════════════════ */}
            <Section id="amc-architecture" title="The Complete Conceptual Architecture">
              <p className="amc_section_body">
                Every concept and relationship in the model above, in one continuous architecture:
              </p>
              <Diagram title="Full AMCTOSHS Architecture">
                <Node>ONTIC PATIENT</Node>
                <ArrowDown label="produces" />
                <Node small>TRACES</Node>
                <ArrowDown />
                <Node small>MODES OF ACCESS</Node>
                <Branch>
                  <BranchCol>
                    <Node small>PATIENT-AS-SPEAKABLE</Node>
                    <ArrowDown />
                    <Node small>SPEAKABLE-ORIGIN REPRESENTATIONS</Node>
                  </BranchCol>
                  <BranchCol>
                    <Node small>PATIENT-AS-UNSPEAKABLE</Node>
                    <ArrowDown />
                    <Node small>UNSPEAKABLE-ORIGIN REPRESENTATIONS</Node>
                  </BranchCol>
                </Branch>
                <ArrowDown />
                <Node small>AMCTOSHS ENTITY SCHEMA</Node>
                <ArrowDown label="instantiated" />
                <Node variant="accent" wide>AMCTOSHS(t₁)<span className="amc_node_sub">3D REPRESENTATIONAL SLICE OF PATIENT IDENTITY</span></Node>
                <ArrowDown />
                <Node small>AMCTOSHS(t₂)</Node>
                <ArrowDown />
                <Node small>AMCTOSHS(t₃)</Node>
                <ArrowDown />
                <Node small>…</Node>
                <ArrowDown />
                <Node small>AMCTOSHS(tₙ)</Node>
                <ArrowDown label="temporal integration + identity persistence" />
                <Node variant="accent" wide>4D AMCTOSHS INSTANCE<span className="amc_node_sub">REPRESENTATIONAL PATIENT</span></Node>
                <ArrowDown />
                <Node>REASONING</Node>
                <Branch>
                  <BranchCol><Node small>INFER</Node></BranchCol>
                  <BranchCol><Node small>VERIFY</Node></BranchCol>
                  <BranchCol><Node small>DECIDE</Node></BranchCol>
                </Branch>
                <ArrowDown />
                <Node small>IDENTIFY INFORMATION GAP</Node>
                <ArrowDown />
                <Node small>SELECT MODE OF ACCESS</Node>
                <Branch>
                  <BranchCol>
                    <Node small>ASK</Node><ArrowDown /><Node small>PATIENT-AS-SPEAKABLE</Node>
                  </BranchCol>
                  <BranchCol>
                    <Node small>EXAMINE</Node><ArrowDown /><Node small>PATIENT-AS-UNSPEAKABLE</Node>
                  </BranchCol>
                </Branch>
                <ArrowDown />
                <Node small>NEW TRACES</Node>
                <ArrowDown />
                <Node small>NEW REPRESENTATIONS</Node>
                <ArrowDown />
                <Node small>NEW / UPDATED AMCTOSHS</Node>
                <div className="amc_loopback">↩ loops back into REASONING, above</div>
              </Diagram>
            </Section>

            {/* ══════════════════════════════════════════════════════════
                19 — What AMCTOSHS is trying to achieve + Core Definition
               ══════════════════════════════════════════════════════════ */}
            <Section id="amc-definition" title="What AMCTOSHS Is Trying to Achieve">
              <p className="amc_section_body">The goal is not to claim perfect reproduction of reality.</p>
              <Callout>
                The goal is to construct an increasingly coherent representational patient from traces.
              </Callout>
              <Diagram>
                <Node variant="ghost" wide>INACCESSIBLE ONTIC PATIENT</Node>
                <ArrowDown label="traces" />
                <Node small>modes of access</Node>
                <ArrowDown />
                <Node small>representations</Node>
                <ArrowDown />
                <Node variant="accent">AMCTOSHS</Node>
                <ArrowDown />
                <Node small>reasoning</Node>
                <ArrowDown />
                <Node small>new targeted access to traces</Node>
                <ArrowDown />
                <Node small>better representations</Node>
                <ArrowDown />
                <Node small>richer AMCTOSHS</Node>
                <ArrowDown />
                <Node variant="ghost">better understanding</Node>
              </Diagram>
              <p className="amc_section_body">
                The system therefore progressively improves its representation without claiming
                that representation becomes identical to ontic reality.
              </p>

              <div id="amc_closing_definition">
                <div className="amc_subheading">Core Definition of AMCTOSHS</div>
                <DefinitionBlock label="The Core Current Definition">
                  AMCTOSHS is a <strong>4D representational patient</strong> constructed by
                  instantiating the AMCTOSHS Entity Schema into temporally related 3D slices of
                  the ontic patient&rsquo;s Identity, using traces of the inaccessible ontic
                  patient obtained through modes of access — patient-as-speakable and
                  patient-as-unspeakable. Reasoning operates on this representational patient to
                  progressively improve our understanding of the ontic patient.
                </DefinitionBlock>
              </div>

              <div className="amc_subheading">In Summary</div>
              <div className="amc_recap_card">
                <div className="amc_recap_row"><div className="amc_recap_key">Ontology</div><div className="amc_recap_val">There is an ontic patient.</div></div>
                <div className="amc_recap_row"><div className="amc_recap_key">Epistemology</div><div className="amc_recap_val">The ontic patient cannot be directly reached. Only traces become accessible.</div></div>
                <div className="amc_recap_row"><div className="amc_recap_key">Access</div><div className="amc_recap_val">Traces are encountered through: patient-as-speakable, patient-as-unspeakable.</div></div>
                <div className="amc_recap_row"><div className="amc_recap_key">Representation</div><div className="amc_recap_val">Those traces are used to instantiate the AMCTOSHS Entity Schema.</div></div>
                <div className="amc_recap_row"><div className="amc_recap_key">3D</div><div className="amc_recap_val">Each instantiation is a 3D representational slice of the ontic patient&rsquo;s Identity.</div></div>
                <div className="amc_recap_row"><div className="amc_recap_key">4D</div><div className="amc_recap_val">Identity-linked, temporally ordered 3D instantiations constitute the 4D AMCTOSHS representational patient.</div></div>
                <div className="amc_recap_row"><div className="amc_recap_key">Reasoning</div><div className="amc_recap_val">Reasoning operates on AMCTOSHS — not directly on the ontic patient — to progressively improve our understanding of the ontic patient.</div></div>
                <div className="amc_recap_row"><div className="amc_recap_key">Recursion</div><div className="amc_recap_val">Reasoning identifies what needs to be accessed next, producing new traces, new representations, and an increasingly developed AMCTOSHS.</div></div>
              </div>

              <p id="amc_footer_tag">
                AMCTOSHS is not the ontic patient. It is the representational patient through
                which the ontic patient becomes intelligible.
              </p>
            </Section>

          </div>
        </div>
      </div>
    </div>
  );
};

export default AmctoshsAboutPage;
