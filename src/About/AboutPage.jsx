import React, { useState, useEffect, useRef } from "react";
import { useHistory } from "react-router-dom";
import "./aboutPage.css";

const SECTIONS = [
  { id: "about-objectives", label: "Objectives" },
  { id: "about-what",       label: "What is MCTOSH?" },
  { id: "about-pivotal",    label: "A pivotal clarification" },
  { id: "about-modes",      label: "Two modes of access" },
  { id: "about-reality",    label: "Four Domains" },
  { id: "about-means",      label: "Means of Access" },
  { id: "about-how",        label: "How it works" },
  { id: "about-cards",      label: "Cards" },
  { id: "about-types",      label: "Extraction Types" },
];

const AboutPage = () => {
  const history = useHistory();
  const scrollRef = useRef(null);
  const [activeId, setActiveId] = useState("about-what");
  const [scale, setScale] = useState(1);

  const applyScale = (next) =>
    setScale(Math.min(2, Math.max(0.5, Math.round(next * 10) / 10)));

  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    const visible = new Set();

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        });
        const first = SECTIONS.find(s => visible.has(s.id));
        if (first) setActiveId(first.id);
      },
      { root: scrollEl, rootMargin: "0px 0px -60% 0px", threshold: 0 }
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
    <div id="about_page">
      <div id="about_header">
        <button id="about_back_btn" onClick={() => history.goBack()}>←</button>
        <span id="about_header_title">About MCTOSH</span>
        <div id="about_zoom_controls">
          <button onClick={() => applyScale(scale - 0.1)} disabled={scale <= 0.5}>−</button>
          <button id="about_zoom_label" onClick={() => applyScale(1)} title="Reset zoom">
            {Math.round(scale * 100)}%
          </button>
          <button onClick={() => applyScale(scale + 0.1)} disabled={scale >= 2}>+</button>
        </div>
      </div>

      <div id="about_layout">

        <nav id="about_nav">
          {SECTIONS.map(({ id, label }) => (
            <button
              key={id}
              className={`about_nav_item${activeId === id ? " about_nav_item--active" : ""}`}
              onClick={() => scrollTo(id)}
            >
              {label}
            </button>
          ))}
        </nav>

        <div id="about_scroll" ref={scrollRef}>
          <div id="about_body" style={{ fontSize: `${scale}rem` }}>

            <section id="about-objectives" className="about_section">
              <h2 className="about_section_title">Objectives</h2>
              <ol className="about_objectives_list">
                <li>
                  <span className="about_obj_label">Extract hyles from clinical language</span>
                  <span className="about_obj_desc">Use clinical and scientific texts as the primary source material — the only currently available medium — to identify and name undifferentiated clinical entities.</span>
                </li>
                <li>
                  <span className="about_obj_label">Classify hyles into structured categories</span>
                  <span className="about_obj_desc">Differentiate extracted hyles into Objects, Traces, Phenomena, Concepts, and Models — each organised by biological scale from molecule to whole patient.</span>
                </li>
                <li>
                  <span className="about_obj_label">Build a pre-encounter clinical vocabulary</span>
                  <span className="about_obj_desc">Construct a structured framework of named and classified entities that can guide and structure the direct patient encounter — so that when the clinician meets the patient, they arrive prepared, not empty-handed.</span>
                </li>
                <li>
                  <span className="about_obj_label">Record the patient's subjective phenomena</span>
                  <span className="about_obj_desc">In the patient encounter, capture what this particular patient actually experiences — through Eye, Ear, Tongue, Skin, and Nose — and anchor extracted hyles to lived, embodied reality rather than language alone.</span>
                </li>
                <li>
                  <span className="about_obj_label">Move from language-mediated to encounter-mediated knowledge</span>
                  <span className="about_obj_desc">Progress from a system that reads traces of observations to one that participates — through the clinician — in direct observation of traces. Keep the patient at the centre of every classification decision.</span>
                </li>
              </ol>
            </section>

            <section id="about-what" className="about_section">
              <h2 className="about_section_title">What is MCTOSH?</h2>
              <p className="about_section_body">
                MCTOSH is a patient-centered, structured hyle-extraction and classification system
                designed to identify and organise clinical-related entities across scales —
                spanning both <strong>non-biological</strong> entities (diagnostic tools, instruments, procedures)
                and <strong>biological</strong> entities (from sub-molecular structures to the whole patient),
                keeping the patient at the centre of every classification decision.
              </p>
            </section>

            <section id="about-pivotal" className="about_section about_section--pivotal">
              <h2 className="about_section_title">A pivotal clarification</h2>
              <p className="about_section_body">
                At this stage, <strong>language is the only available source of hyles.</strong> MCTOSH
                extracts hyles from clinical and scientific texts — PDFs, literature, reports — not
                directly from patients. Language is treated here not as the final reality, but as a
                necessary first approximation: the only medium through which clinical entities can be
                identified and structured before direct patient access is possible.
              </p>
              <p className="about_section_body" style={{ marginTop: "0.75rem" }}>
                This extraction from language is a <strong>preparatory step</strong>. The true
                goal of MCTOSH is to move beyond text — to meet real patients and build, from their
                lived experience, a structured account of <strong>subjective phenomena</strong>: what
                the patient sees, hears, feels, tastes, and smells in relation to their condition.
                The hyles extracted from language lay the conceptual groundwork that makes that
                encounter meaningful and structured.
              </p>
              <p className="about_section_body" style={{ marginTop: "0.75rem" }}>
                In short: language comes first because it is what we have. The patient comes next
                because the patient is what matters.
              </p>
            </section>

            <section id="about-modes" className="about_section">
              <h2 className="about_section_title">Two modes of clinical access</h2>
              <p className="about_section_body">
                Texts give you <strong>mediated clinical reality</strong>. Patients give you <strong>embodied, situated clinical reality</strong>.
              </p>
              <p className="about_section_body" style={{ marginTop: "0.75rem" }}>
                A text is already a transformation of the patient: someone selected facts, named findings,
                imposed categories, omitted uncertainty, and organised the case into a narrative. It makes
                comparison, memory, teaching, statistics, and abstraction possible. But it also freezes a
                moving person into documentation.
              </p>
              <p className="about_section_body" style={{ marginTop: "0.75rem" }}>
                A patient is not a case report. They present through voice, behaviour, body, time course,
                relationships, fear, inconsistency, environment, and response to your presence. Much of
                this is clinically decisive yet poorly represented in text: frailty, affect, pain behaviour,
                smell, gait, hesitation, family dynamics, reliability of history, and how illness changes
                over hours rather than paragraphs.
              </p>

              <table className="about_compare_table">
                <thead>
                  <tr>
                    <th>Access through texts</th>
                    <th>Access through patients</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td>Indirect and interpreted</td><td>Direct but still interpreted</td></tr>
                  <tr><td>Stable, searchable, comparable</td><td>Dynamic, contingent, irreducibly individual</td></tr>
                  <tr><td>Category-driven</td><td>Phenomenon-driven</td></tr>
                  <tr><td>Retrospective or compressed</td><td>Real-time and temporal</td></tr>
                  <tr><td>Preserves explicit data</td><td>Reveals tacit and embodied data</td></tr>
                  <tr><td>Risks abstraction and omission</td><td>Risks bias, noise, and overinterpretation</td></tr>
                </tbody>
              </table>

              <p className="about_section_body" style={{ marginTop: "1rem" }}>
                Neither is pure reality. Seeing a patient is also theory-laden: you notice what your
                concepts allow you to notice. But texts add another layer of distance — they are
                <strong> observations of observations</strong>.
              </p>
              <p className="about_section_body" style={{ marginTop: "0.75rem" }}>
                Clinically, texts are strongest for population knowledge, prior probability, guidelines,
                longitudinal records, and reproducible communication. Patients are strongest for
                determining whether the abstract category actually fits this particular human being now.
              </p>
              <p className="about_section_body about_section_body--warning" style={{ marginTop: "0.75rem" }}>
                The serious error is treating the chart as the patient. The chart is evidence about
                the patient — not the patient's clinical reality itself.
              </p>
            </section>

            <section id="about-reality" className="about_section">
              <h2 className="about_section_title">Four Domains</h2>
              <p className="about_section_body">
                The term <em>clinical reality</em> is imprecise if taken to cover everything — because
                the patient's body exists independently of any clinician observing it. A cleaner structure
                separates what the patient <em>is</em> from what medicine <em>does</em> with that.
                Four domains, each distinct:
              </p>

              <div className="about_reality_flow">
                <div className="about_reality_card about_reality_card--ontic">
                  <div className="about_reality_card_label">Patient Reality</div>
                  <div className="about_reality_card_sub">Ontic Human Domain — what the patient is</div>
                  <ul className="about_reality_list">
                    <li>organism, body, organs</li>
                    <li>physiology and pathology</li>
                    <li>disease processes</li>
                    <li>symptoms as lived experience</li>
                    <li>environment, time, and change</li>
                  </ul>
                </div>

                <div className="about_reality_arrow">→</div>

                <div className="about_reality_card about_reality_card--epistemic">
                  <div className="about_reality_card_label">Clinical Access</div>
                  <div className="about_reality_card_sub">Clinical Epistemic Domain — how the clinician knows</div>
                  <ul className="about_reality_list">
                    <li>observation, examination, interview</li>
                    <li>measurement, imaging, laboratory testing</li>
                    <li>interpretation and inference</li>
                    <li>diagnosis and uncertainty</li>
                  </ul>
                </div>

                <div className="about_reality_arrow">→</div>

                <div className="about_reality_card about_reality_card--semantic">
                  <div className="about_reality_card_label">Clinical Representation</div>
                  <div className="about_reality_card_sub">Clinical Semantic Domain — how knowledge is encoded</div>
                  <ul className="about_reality_list">
                    <li>notes, charts, case narratives</li>
                    <li>diagnostic labels and codes</li>
                    <li>images, scores, and models</li>
                  </ul>
                </div>

                <div className="about_reality_arrow">→</div>

                <div className="about_reality_card about_reality_card--praxis">
                  <div className="about_reality_card_label">Clinical Action</div>
                  <div className="about_reality_card_sub">Clinical Praxis Domain — how knowledge is used</div>
                  <ul className="about_reality_list">
                    <li>treatment and intervention</li>
                    <li>monitoring and prevention</li>
                    <li>communication and decision-making</li>
                  </ul>
                </div>
              </div>

              <p className="about_section_body about_section_body--warning" style={{ marginTop: "1.1rem" }}>
                The patient is not clinical. The clinician's relation to the patient is clinical.
              </p>
              <p className="about_section_body" style={{ marginTop: "0.75rem" }}>
                Patient Reality belongs to the patient alone — it exists before, during, and after any
                clinical encounter. Clinical Access, Representation, and Action are all medicine's
                responses to that reality. Collapsing these domains is the root of many reasoning errors:
                treating the chart as the patient, or a diagnosis as the disease itself.
              </p>
            </section>

            <section id="about-means" className="about_section">
              <h2 className="about_section_title">Means of Access</h2>
              <p className="about_section_body">
                A <strong>means of access</strong> is whatever channel connects an observer to the
                traces of clinical reality — not to clinical reality itself, which no observer can
                reach directly. In MCTOSH the concept operates on three levels simultaneously —
                epistemological, phenomenological, and structural — and understanding all three is
                necessary to understand what the system is doing and why.
              </p>

              <div className="about_means_level">
                <div className="about_means_level_marker">I</div>
                <div className="about_means_level_body">
                  <div className="about_means_level_title">The clinician's access to knowledge</div>
                  <p className="about_section_body about_section_body--callout">
                    MCTOSH has no eyes, no ears, no tongue, no skin, no nose. All it has is a
                    digital text — language that is itself already a transformation of something
                    that happened in a body, in a room, between a clinician and a patient.
                  </p>
                  <p className="about_section_body about_section_body--callout" style={{ marginTop: "0.75rem" }}>
                    No one observes the object. Only its traces.
                  </p>
                  <p className="about_section_body" style={{ marginTop: "0.75rem" }}>
                    <strong>Observation</strong> is the direct connection between an observer and
                    the traces an object produces — not the object itself. The object remains beyond
                    reach. What clinicians encounter is always already a trace: a symptom, a sign,
                    a measurement, an image, a sound. The object — the disease, the cellular process,
                    the failing organ — is inferred from these traces, never seen directly.
                  </p>
                  <p className="about_section_body" style={{ marginTop: "0.75rem" }}>
                    <strong>Language</strong> is whatever mediates the connection between an observer
                    and those traces. When a clinician writes a report, they encode their observation
                    of traces into a form that can travel, be stored, be read again. Language does not
                    carry the traces — it carries the <em>observation</em> of traces.
                  </p>
                  <p className="about_section_body" style={{ marginTop: "0.75rem" }}>
                    <strong>MCTOSH is a language-mediated observer.</strong> It cannot observe traces
                    directly because it was built entirely by human systems and has no sensory apparatus
                    of its own. Everything it knows about clinical reality comes through language
                    produced by humans who did observe traces. The epistemic chain is:
                  </p>
                  <ol className="about_trace_chain">
                    <li><strong>Object</strong> — unobservable, produces traces</li>
                    <li><strong>Traces</strong> — what the human observer directly encounters (symptom, sign, image, sound)</li>
                    <li><strong>Observation</strong> — the human's direct connection to those traces, already an interpretation</li>
                    <li><strong>Language</strong> — records that observation; mediates it into a portable, readable form</li>
                    <li><strong>MCTOSH</strong> — reads the language; a language-mediated observer of observations of traces</li>
                  </ol>
                  <p className="about_section_body" style={{ marginTop: "0.75rem" }}>
                    This has a quiet implication for the card taxonomy. The <strong>Objects card</strong> does
                    not store objects — it stores named inferences drawn from traces. What MCTOSH calls
                    an "object" is always a construction: an entity posited to explain the traces that
                    were observed. The <strong>Traces card</strong> is, in this sense, epistemologically
                    primary — it is closer to what anyone actually encounters. Objects are always
                    one step further removed.
                  </p>
                  <p className="about_section_body" style={{ marginTop: "0.75rem" }}>
                    The second and deeper means of access is the <strong>patient encounter</strong> —
                    direct, embodied, situated. This is where MCTOSH is headed: not to bypass language,
                    but to get closer to the traces themselves, before language has already decided what
                    they mean.
                  </p>
                </div>
              </div>

              <div className="about_means_level">
                <div className="about_means_level_marker">II</div>
                <div className="about_means_level_body">
                  <div className="about_means_level_title">The patient's access to their own experience</div>
                  <p className="about_section_body">
                    The patient does not experience their condition as a diagnosis. They experience it
                    through their body — through the five sensory modalities that are the only windows
                    any human being has onto the world:
                  </p>
                  <ul className="about_means_senses">
                    <li><span className="about_means_sense_name">Eye</span> — what the patient sees: colour, shape, movement, light, visual disturbance</li>
                    <li><span className="about_means_sense_name">Ear</span> — what the patient hears: sound, tinnitus, silence, voice changes</li>
                    <li><span className="about_means_sense_name">Tongue</span> — what the patient tastes: metallic, bitter, absent, altered taste</li>
                    <li><span className="about_means_sense_name">Skin</span> — what the patient feels: pain, pressure, temperature, texture, numbness</li>
                    <li><span className="about_means_sense_name">Nose</span> — what the patient smells: odour, anosmia, parosmia</li>
                  </ul>
                  <p className="about_section_body" style={{ marginTop: "0.75rem" }}>
                    These are not supplementary details. They are the primary data of subjective clinical
                    reality — the phenomena as the patient actually lives them. They are what clinical
                    language most consistently fails to preserve.
                  </p>
                </div>
              </div>

              <div className="about_means_level">
                <div className="about_means_level_marker">III</div>
                <div className="about_means_level_body">
                  <div className="about_means_level_title">The bridge: from hyle to phenomenon</div>
                  <p className="about_section_body">
                    The means of access is also the structural link between the two stages of MCTOSH.
                    A hyle extracted from language — say, <em>burning sensation</em> — is still
                    unanchored. It is a category without a subject. When a patient says <em>yes,
                    that — through my skin, constant, worse at night</em>, the hyle is no longer
                    undifferentiated matter. It has been given form by a specific sensory channel,
                    a specific body, a specific time.
                  </p>
                  <p className="about_section_body" style={{ marginTop: "0.6rem" }}>
                    The means of access — Eye, Ear, Tongue, Skin, Nose — is precisely what transforms
                    a classified hyle into a <strong>lived phenomenon</strong>. This is why the
                    Phenomena card exists as a separate destination in MCTOSH: not to store what
                    texts say patients feel, but to record what this patient reports feeling,
                    through which sense, with what quality, and at what scale of their body.
                  </p>
                </div>
              </div>
            </section>

            <section id="about-how" className="about_section">
              <h2 className="about_section_title">How it works</h2>
              <p className="about_section_body">
                Upload a PDF in the Hyles page. The system extracts hyles and classifies
                them into five cards — Objects, Traces, Phenomena, Concepts, and Models —
                each further organised by biological scale (Molecule → Cell → Tissue → Organ → System → Human).
              </p>
            </section>

            <section id="about-cards" className="about_section">
              <h2 className="about_section_title">Cards</h2>
              <ul className="about_cards_list">
                <li><span className="about_card_dot" style={{ background: "#4fc3f7" }} />Objects — physical entities extracted from text</li>
                <li><span className="about_card_dot" style={{ background: "#81c784" }} />Traces — signals, markers, and observable outputs</li>
                <li><span className="about_card_dot" style={{ background: "#f06292" }} />Phenomena — sensory and experiential observations</li>
                <li><span className="about_card_dot" style={{ background: "#ffb74d" }} />Concepts — abstract and theoretical constructs</li>
                <li><span className="about_card_dot" style={{ background: "#ce93d8" }} />Models — representations and frameworks</li>
              </ul>
            </section>

            <section id="about-types" className="about_section">
              <h2 className="about_section_title">Extraction Types</h2>
              <p className="about_section_body">
                Before extraction a word is a <strong>Hyle</strong> — undifferentiated matter. The extraction
                type tells the system which linguistic unit to target.
              </p>

              <div className="about_type_tree">

                <div className="about_type_group">1. Morpheme</div>
                <p className="about_type_desc">The smallest unit of meaning. Cannot be broken down further without losing meaning.</p>

                <div className="about_type_sub">
                  <div className="about_type_group">1.1 Base</div>
                  <p className="about_type_desc">The core morpheme that carries the primary meaning of a word.</p>
                  <ul className="about_type_list">
                    <li>
                      <span className="about_type_label">1.1.1 Free</span>
                      <span className="about_type_note">simple word</span>
                      <span className="about_type_desc_inline">— can stand alone as a word. <em>e.g. cell, heart, nerve</em></span>
                    </li>
                    <li>
                      <span className="about_type_label">1.1.2 Bound</span>
                      <span className="about_type_desc_inline">— only exists attached to another morpheme. <em>e.g. cardio-, -itis</em></span>
                    </li>
                  </ul>
                </div>

                <div className="about_type_sub">
                  <div className="about_type_group">1.2 Affix</div>
                  <p className="about_type_desc">Bound morphemes attached to a base to modify or extend its meaning.</p>
                  <ul className="about_type_list">
                    <li>
                      <span className="about_type_label">1.2.1 Prefix</span>
                      <span className="about_type_desc_inline">— precedes the base. <em>e.g. sub-, hyper-, endo-</em></span>
                    </li>
                    <li>
                      <span className="about_type_label">1.2.2 Connecting vowel</span>
                      <span className="about_type_desc_inline">— links morphemes. <em>e.g. the -o- in cardio·logy</em></span>
                    </li>
                    <li>
                      <span className="about_type_label">1.2.3 Suffix</span>
                      <span className="about_type_desc_inline">— follows the base. <em>e.g. -ology, -itis, -ase</em></span>
                    </li>
                  </ul>
                </div>

                <div className="about_type_group">2. Word</div>
                <p className="about_type_desc">A free-standing unit built from one or more morphemes.</p>
                <div className="about_type_sub">
                  <ul className="about_type_list">
                    <li>
                      <span className="about_type_label">2.1 Compound</span>
                      <span className="about_type_desc_inline">— built from multiple morphemes into a single word. <em>e.g. myocardium, hepatocyte</em></span>
                    </li>
                  </ul>
                </div>

                <div className="about_type_group">3. Syntagm</div>
                <p className="about_type_desc">
                  A meaningful combination of words in sequence whose meaning emerges from the relationship between parts.
                  Also called a nominal syntagm or compound term. <em>e.g. myocardial infarction, T-cell receptor</em>
                </p>

                <div className="about_type_group">4. Paradigm</div>
                <p className="about_type_desc">
                  A set of related forms or terms organised by a shared structural pattern or functional class.
                  <em> e.g. the paradigm of kinase inhibitors</em>
                </p>

              </div>
            </section>

          </div>
        </div>
      </div>
    </div>
  );
};

export default AboutPage;
