import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import AboutContentAR from "./AboutContentAR";
import "./aboutPage.css";

const SECTIONS_EN = [
  { id: "about-objectives",   label: "Objectives" },
  { id: "about-what",         label: "What is MCTOSHS?" },
  { id: "about-pivotal",      label: "A pivotal clarification" },
  { id: "about-modes",        label: "Two modes of access" },
  { id: "about-uni-patient",  label: "University vs Real Patient" },
  { id: "about-comm",         label: "Clinical Communication" },
  { id: "about-reality",      label: "Presentation & Representation" },
  { id: "about-psyche",       label: "Psyche" },
  { id: "about-epistemology", label: "Clinical Epistemology" },
  { id: "about-means",        label: "Means of Access" },
  { id: "about-ball",         label: "Ball & Observer" },
  { id: "about-how",          label: "How it works" },
  { id: "about-cards",        label: "Cards" },
  { id: "about-types",        label: "Extraction Types" },
  { id: "about-conclusion",   label: "Conclusion" },
];

const SECTIONS_AR = [
  { id: "about-objectives",   label: "الأهداف" },
  { id: "about-what",         label: "ما هو MCTOSHS؟" },
  { id: "about-pivotal",      label: "توضيح محوري" },
  { id: "about-modes",        label: "وسيلتا الوصول" },
  { id: "about-uni-patient",  label: "المريض الجامعي مقابل الحقيقي" },
  { id: "about-comm",         label: "التواصل السريري" },
  { id: "about-reality",      label: "العرض والتمثيل" },
  { id: "about-psyche",       label: "النفس" },
  { id: "about-epistemology", label: "الإبستيمولوجيا السريرية" },
  { id: "about-means",        label: "وسائل الوصول" },
  { id: "about-how",          label: "كيف يعمل" },
  { id: "about-cards",        label: "البطاقات" },
  { id: "about-types",        label: "أنواع الاستخراج" },
  { id: "about-conclusion",   label: "الخاتمة" },
];

const AboutPage = () => {
  const navigate = useNavigate();
  const scrollRef = useRef(null);
  const [activeId, setActiveId] = useState("about-what");
  const [scale,    setScale]    = useState(1);
  const [copied,   setCopied]   = useState(false);
  const [lang,     setLang]     = useState("en");
  const bodyRef = useRef(null);

  const SECTIONS = lang === "ar" ? SECTIONS_AR : SECTIONS_EN;

  const applyScale = (next) =>
    setScale(Math.min(2, Math.max(0.5, Math.round(next * 10) / 10)));

  const pinchRef = useRef({ dist: null, base: 1 });
  const onTouchStart = (e) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchRef.current = { dist: Math.hypot(dx, dy), base: scale };
    }
  };
  const onTouchMove = (e) => {
    if (e.touches.length !== 2 || pinchRef.current.dist === null) return;
    e.preventDefault();
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const newDist = Math.hypot(dx, dy);
    const next = pinchRef.current.base * (newDist / pinchRef.current.dist);
    setScale(Math.min(2, Math.max(0.5, next)));
  };
  const onTouchEnd = () => { pinchRef.current.dist = null; };

  const handleCopy = () => {
    const text = bodyRef.current?.innerText || "";
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };

  const handleAR = () => setLang(l => l === "ar" ? "en" : "ar");

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove",  onTouchMove,  { passive: false });
    el.addEventListener("touchend",   onTouchEnd,   { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove",  onTouchMove);
      el.removeEventListener("touchend",   onTouchEnd);
    };
  }, [scale]);

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
        <span id="about_header_title">About MCTOSHS</span>
        <button id="about_copy_btn" onClick={handleCopy} title="Copy all text">
          {copied ? "Copied ✓" : "Copy"}
        </button>
        <button
          id="about_ar_btn"
          className={lang === "ar" ? "about_ar_btn--active" : ""}
          onClick={handleAR}
          title={lang === "ar" ? "Switch to English" : "Switch to Arabic"}
        >
          {lang === "ar" ? "EN" : "AR"}
        </button>
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
          {lang === "ar" ? (
            <div id="about_ar_body" dir="rtl" lang="ar" style={{ fontSize: `${scale}rem` }}>
              <AboutContentAR />
            </div>
          ) : (
          <div id="about_body" ref={bodyRef} style={{ fontSize: `${scale}rem` }}>

            <section id="about-objectives" className="about_section">
              <h2 className="about_section_title">Objectives</h2>
              <div className="about_audience_row">
                <span className="about_audience_label">Audience</span>
                <span className="about_audience_value">Medical students — students who work daily with lectures, textbooks, charts, images, laboratory reports, and diagnostic labels, and need to learn not to mistake these representations for the patient.</span>
              </div>
              <ol className="about_objectives_list">
                <li>
                  <span className="about_obj_label">Distinguish the university patient from the real patient</span>
                  <span className="about_obj_desc">The university patient — lecture cases, textbook vignettes, charts, images, lab tables, diagnoses — is a pedagogical representation, not the patient. Teach students not to mistake it for the living human from whom such representations arise.</span>
                </li>
                <li>
                  <span className="about_obj_label">Separate Clinical Presentation from Clinical Representation</span>
                  <span className="about_obj_desc">Distinguish the living clinical event (Patient Reality → Patient Access → Patient Interpretation → Clinician Access → Clinician Interpretation → Clinical Intervention) from its re-presentation in language (cases, lectures, textbooks, exams, charts). Never collapse the representation into the presentation.</span>
                </li>
                <li>
                  <span className="about_obj_label">Understand the modes of the patient's physis</span>
                  <span className="about_obj_desc">Recognize that the patient's physical reality spans multiple biological scales — from molecule to the whole human — and that clinical findings, traces, and concepts each refer to specific levels of this hierarchy.</span>
                </li>
                <li>
                  <span className="about_obj_label">Syntactic and semantic analysis of clinical language</span>
                  <span className="about_obj_desc">Perform both syntactic (linguistic) and semantic (meaning) analysis of clinical statements — identifying how language is structured and what each term actually refers to in patient reality.</span>
                </li>
                <li>
                  <span className="about_obj_label">Move from representation to reality</span>
                  <span className="about_obj_desc">Progress from language-mediated knowledge toward a more adequate, patient-centered encounter with the real patient — from language to patient.</span>
                </li>
              </ol>
            </section>

            <section id="about-what" className="about_section">
              <h2 className="about_section_title">What is MCTOSHS?</h2>
              <p className="about_section_body">
                MCTOSHS is a project for medical students. It uncovers how they should think about
                the patient as represented in university documents, lectures, textbooks, and clinical
                teaching materials.
              </p>
              <p className="about_section_body">
                Its purpose is not merely to help students memorize medical language. It teaches
                them to distinguish:
              </p>
              <ul className="about_objectives_list about_objectives_list--compact about_objectives_list--grid2" style={{ marginTop: "0.6rem" }}>
                <li><span className="about_obj_label">Patient Reality</span> <span className="about_obj_desc">the living patient — Hyle, physis, psyche</span></li>
                <li><span className="about_obj_label">Patient Access</span> <span className="about_obj_desc">traces arising from patient reality</span></li>
                <li><span className="about_obj_label">Patient Interpretation</span> <span className="about_obj_desc">phenomena — what the patient experiences</span></li>
                <li><span className="about_obj_label">Clinician Access</span> <span className="about_obj_desc">traces received by the clinician</span></li>
                <li><span className="about_obj_label">Clinician Interpretation</span> <span className="about_obj_desc">subjective perception + diagnosis</span></li>
                <li><span className="about_obj_label">Clinical Intervention</span> <span className="about_obj_desc">action directed at patient reality</span></li>
              </ul>
              <p className="about_section_body">
                A lecture, chart, image, laboratory value, or diagnosis is not the patient itself.
                Each is only a structured route toward the patient&apos;s reality.
              </p>
              <p className="about_section_body">For example, a lecture may state:</p>
              <blockquote className="about_what_quote">
                &ldquo;Chest pain radiating to the left arm, ST-segment elevation, and elevated
                troponin suggest myocardial infarction.&rdquo;
              </blockquote>
              <p className="about_section_body">MCTOSHS teaches the student to separate this statement:</p>
              <ul className="about_objectives_list about_objectives_list--compact about_objectives_list--grid2" style={{ marginTop: "0.6rem" }}>
                <li><span className="about_obj_label">Chest pain</span> <span className="about_obj_desc">— a lived phenomenon experienced by the patient</span></li>
                <li><span className="about_obj_label">ST-segment elevation</span> <span className="about_obj_desc">— an interpreted ECG trace</span></li>
                <li><span className="about_obj_label">Elevated troponin</span> <span className="about_obj_desc">— an interpreted laboratory trace of a molecular measurement</span></li>
                <li><span className="about_obj_label">Myocardial infarction</span> <span className="about_obj_desc">— a diagnostic concept</span></li>
                <li><span className="about_obj_label">The actual pathological reality</span> <span className="about_obj_desc">— myocardial ischemia, coronary obstruction, and tissue injury in the patient&apos;s heart</span></li>
              </ul>
              <p className="about_section_body">
                The student therefore learns not to confuse the diagnosis with the disease, the
                trace with the process, or the written case with the living patient.
              </p>
            </section>

            <section id="about-pivotal" className="about_section about_section--pivotal">
              <h2 className="about_section_title">A pivotal clarification</h2>
              <p className="about_section_body">
                The medical student&apos;s available world is the <strong>Clinical Representation</strong>
                — lectures, textbooks, charts, case reports, diagnostic labels, and images. This is
                what the student has before they enter clinical practice. MCTOSHS works with this
                representation as its starting material.
              </p>
              <p className="about_section_body" style={{ marginTop: "0.75rem" }}>
                But the Clinical Representation is not the Clinical Presentation. It is a
                re-encoding — selected, simplified, and organized for teaching — of what occurred
                between a real patient and a real clinician. The Clinical Presentation itself
                involves a living patient, lived phenomena, real traces, and a situated encounter.
              </p>
              <p className="about_section_body about_section_body--warning" style={{ marginTop: "0.75rem" }}>
                The Clinical Representation comes first because it is what we have.
                The Clinical Presentation comes next because the patient is what matters.
              </p>
            </section>

            <section id="about-modes" className="about_section">
              <h2 className="about_section_title">Two modes of clinical access</h2>
              <p className="about_section_body">
                Access to Patient Reality occurs through traces. There are two distinct modes in
                which traces become accessible — one on the patient&apos;s side, one on the
                clinician&apos;s side. Both are part of the <strong>Clinical Presentation</strong>.
              </p>

              <table className="about_compare_table" style={{ marginTop: "1rem" }}>
                <thead>
                  <tr>
                    <th>Patient Access <span style={{ fontWeight: 400, opacity: 0.7 }}>(step 2)</span></th>
                    <th>Clinician Access <span style={{ fontWeight: 400, opacity: 0.7 }}>(step 4)</span></th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td>Traces arise from Patient Reality (Hyle)</td><td>Traces reach the clinician through the encounter</td></tr>
                  <tr><td>Bodily signals, measurable outputs</td><td>Examination, interview, imaging, laboratory</td></tr>
                  <tr><td>Precedes any observer</td><td>Requires the clinician to be present</td></tr>
                  <tr><td>Interpreted by the patient as symptoms (step 3)</td><td>Interpreted by the clinician as diagnosis (step 5)</td></tr>
                </tbody>
              </table>

              <p className="about_section_body about_section_body--warning" style={{ marginTop: "1rem" }}>
                Texts — lectures, charts, textbooks, case reports — are not a mode of access to
                the patient. They are <strong>Clinical Representations</strong>: re-encodings of a
                Clinical Presentation that has already occurred. They give access to a
                representation, not to the patient.
              </p>
            </section>

            <section id="about-uni-patient" className="about_section">
              <h2 className="about_section_title">University Patient vs Real Patient</h2>
              <p className="about_section_body">
                The <strong>university patient</strong> is not the real patient. It is a{" "}
                <strong>representation constructed for teaching</strong>.
              </p>

              <div className="about_unipt_compare">
                <div className="about_unipt_col">
                  <div className="about_unipt_col_title">Real Patient</div>
                  <ul className="about_comm_list">
                    <li>a living human being existing in time</li>
                    <li>body, psyche, history, environment</li>
                    <li>symptoms, behaviour, uncertainty</li>
                    <li>change, and response to the clinician</li>
                  </ul>
                </div>
                <div className="about_unipt_col">
                  <div className="about_unipt_col_title">University Patient</div>
                  <ul className="about_comm_list">
                    <li>a pedagogical representation of a patient</li>
                    <li>lecture case, textbook vignette, slide</li>
                    <li>exam question, simulated chart, image</li>
                    <li>laboratory table, diagnosis</li>
                  </ul>
                </div>
              </div>

              <div className="about_unipt_traits">
                <div className="about_unipt_trait_col">
                  <div className="about_unipt_trait_title">The university patient is usually:</div>
                  <ul className="about_comm_list">
                    <li>selected</li>
                    <li>simplified</li>
                    <li>compressed</li>
                    <li>already named</li>
                    <li>organized around a teaching objective</li>
                    <li>stripped of much ambiguity and embodiment</li>
                  </ul>
                </div>
                <div className="about_unipt_trait_col">
                  <div className="about_unipt_trait_title">The real patient is:</div>
                  <ul className="about_comm_list">
                    <li>changing through time</li>
                    <li>only partially known</li>
                    <li>not fully captured by language</li>
                    <li>affected by the encounter itself</li>
                    <li>more than their diagnosis, chart, symptoms, or test results</li>
                  </ul>
                </div>
              </div>

              <p className="about_section_body" style={{ marginTop: "1.2rem" }}>A precise MCTOSHS formulation:</p>
              <blockquote className="about_what_quote">
                The university patient is a semantic and pedagogical representation of selected
                traces, concepts, and clinical relations. The real patient is the ontic living
                human from whom such traces arise.
              </blockquote>

              <div className="about_unipt_flow">
                <div className="about_unipt_flow_item">Real patient</div>
                <div className="about_unipt_flow_arrow">↓</div>
                <div className="about_unipt_flow_item">produces phenomena and traces</div>
                <div className="about_unipt_flow_arrow">↓</div>
                <div className="about_unipt_flow_item">traces are encountered and represented</div>
                <div className="about_unipt_flow_arrow">↓</div>
                <div className="about_unipt_flow_item">university documents select and organize those representations</div>
                <div className="about_unipt_flow_arrow">↓</div>
                <div className="about_unipt_flow_item">student learns from the university patient</div>
                <div className="about_unipt_flow_arrow">↓</div>
                <div className="about_unipt_flow_item about_unipt_flow_item--return">clinician must return to the real patient</div>
              </div>

              <p className="about_section_body about_section_body--warning" style={{ marginTop: "1.2rem" }}>
                So MCTOSHS exists to prevent this error: treating the university patient as though
                they were the real patient.
              </p>
              <p className="about_section_body" style={{ marginTop: "0.75rem" }}>
                The university patient is a route toward the patient, not the patient himself or herself.
              </p>
            </section>

            <section id="about-comm" className="about_section">
              <h2 className="about_section_title">Clinical Communication</h2>
              <p className="about_section_body">
                The relation between patient and clinician is bidirectional. Each direction carries
                a distinct kind of content.
              </p>

              <div className="about_comm_grid">
                <div className="about_comm_direction">
                  <div className="about_comm_arrow">Patient &rarr; Clinician</div>
                  <p className="about_comm_desc">
                    Patient reality affects the clinician through <strong>traces</strong>:
                  </p>
                  <ul className="about_comm_list">
                    <li>symptoms</li>
                    <li>signs</li>
                    <li>speech</li>
                    <li>examination findings</li>
                    <li>images</li>
                    <li>sounds</li>
                    <li>laboratory outputs</li>
                    <li>behaviour</li>
                    <li>bodily responses</li>
                  </ul>
                </div>

                <div className="about_comm_direction">
                  <div className="about_comm_arrow">Clinician &rarr; Patient</div>
                  <p className="about_comm_desc">
                    The clinician affects the patient through <strong>intervention</strong>:
                  </p>
                  <ul className="about_comm_list">
                    <li>questions</li>
                    <li>examination</li>
                    <li>medication</li>
                    <li>procedures</li>
                    <li>advice</li>
                    <li>monitoring</li>
                    <li>reassurance</li>
                    <li>treatment</li>
                  </ul>
                </div>
              </div>

              <p className="about_section_body about_section_body--callout" style={{ marginTop: "1.2rem" }}>
                The whole of this bidirectional relation is called <strong>Clinical Communication</strong>.
              </p>
            </section>

            <section id="about-reality" className="about_section">
              <h2 className="about_section_title">Clinical Presentation &amp; Representation</h2>

              {/* ── Layer 1: Clinical Presentation ── */}
              <div className="about_layer_label">The Clinical Presentation</div>
              <p className="about_section_body">
                What actually occurs between patient and clinician — the living event:
              </p>

              <div className="about_pres_snake">
                {/* Row 1 */}
                <div className="about_pres_row">
                  <div className="about_reality_card about_reality_card--ontic">
                    <div className="about_reality_card_label">1. Patient Reality</div>
                    <div className="about_reality_card_sub">Patient Hyle — the raw living substrate</div>
                    <ul className="about_reality_list">
                      <li>body, organs, physiology</li>
                      <li>pathological processes</li>
                      <li>environment, time, change</li>
                    </ul>
                  </div>
                  <div className="about_reality_arrow">→</div>
                  <div className="about_reality_card about_reality_card--epistemic">
                    <div className="about_reality_card_label">2. Patient Access</div>
                    <div className="about_reality_card_sub">Traces-to-patient — how reality becomes accessible</div>
                    <ul className="about_reality_list">
                      <li>bodily signals and outputs</li>
                      <li>measurable and observable traces</li>
                    </ul>
                  </div>
                  <div className="about_reality_arrow">→</div>
                  <div className="about_reality_card about_reality_card--phenom">
                    <div className="about_reality_card_label">3. Patient Interpretation</div>
                    <div className="about_reality_card_sub">Usually one part — subjective only</div>
                    <ul className="about_reality_list">
                      <li><strong>Subjective</strong> — meaning-to-them: phenomena (pain, breathlessness, fear)</li>
                      <li>The patient has no clinical representation background</li>
                      <li>Their interpretation is lived, not clinical</li>
                    </ul>
                  </div>
                </div>

                {/* Down arrow: card 3 → card 4 (right side) */}
                <svg className="about_pres_curve" viewBox="0 0 32 36" aria-hidden="true">
                  <defs>
                    <marker id="pres-arrow-marker" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
                      <path d="M0,0 L6,3 L0,6 Z" fill="currentColor" opacity="0.5"/>
                    </marker>
                  </defs>
                  <path
                    d="M 16 2 L 16 32"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeDasharray="4,3"
                    opacity="0.4"
                    markerEnd="url(#pres-arrow-marker)"
                  />
                </svg>

                {/* Row 2 — right to left so card 4 sits below card 3 */}
                <div className="about_pres_row">
                  <div className="about_reality_card about_reality_card--praxis">
                    <div className="about_reality_card_label">6. Clinical Intervention</div>
                    <div className="about_reality_card_sub">Treatment — action directed at patient reality</div>
                    <ul className="about_reality_list">
                      <li>medication, procedures, surgery</li>
                      <li>monitoring and prevention</li>
                      <li>advice and reassurance</li>
                    </ul>
                  </div>
                  <div className="about_reality_arrow">←</div>
                  <div className="about_reality_card about_reality_card--semantic">
                    <div className="about_reality_card_label">5. Clinician Interpretation</div>
                    <div className="about_reality_card_sub">Two parts — subjective and objective</div>
                    <ul className="about_reality_list">
                      <li><strong>Subjective</strong> — meaning-to-them: the clinician&apos;s lived perception of this patient</li>
                      <li><strong>Objective</strong> — meaning-to-the-representation-reservoir: diagnosis, labels, codes entered into the clinical record</li>
                    </ul>
                  </div>
                  <div className="about_reality_arrow">←</div>
                  <div className="about_reality_card about_reality_card--interp">
                    <div className="about_reality_card_label">4. Clinician Access</div>
                    <div className="about_reality_card_sub">Traces-to-clinician — what the clinician receives</div>
                    <ul className="about_reality_list">
                      <li>examination, interview, observation</li>
                      <li>imaging, laboratory, measurement</li>
                      <li>signs and reported symptoms</li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* ── Layer 2: Clinical Representation ── */}
              <div className="about_layer_label" style={{ marginTop: "1.6rem" }}>The Clinical Representation</div>
              <p className="about_section_body">
                The re-presentation of Clinical Presentations through language — constructed
                after the fact, for teaching, communication, and record:
              </p>
              <div className="about_repr_examples">
                {["cases", "lectures", "textbooks", "exams", "charts", "reports", "diagnostic labels", "images", "guidelines"].map(t => (
                  <span key={t} className="about_repr_tag">{t}</span>
                ))}
              </div>
              <p className="about_section_body about_section_body--warning" style={{ marginTop: "1rem" }}>
                The Clinical Representation selects, simplifies, and encodes. It is a route toward
                the Clinical Presentation — not the presentation itself.
              </p>
            </section>

            <section id="about-psyche" className="about_section">
              <h2 className="about_section_title">Psyche</h2>
              <div className="about_psyche_def">
                <div className="about_psyche_term">Psyche</div>
                <div className="about_psyche_eq">=</div>
                <div className="about_psyche_body">
                  the internal living principle by which an entity<br />
                  changes, develops, regulates itself, and maintains continuity<br />
                  through transformation.
                </div>
              </div>
            </section>

            <section id="about-epistemology" className="about_section">
              <h2 className="about_section_title">Clinical Epistemology</h2>
              <p className="about_section_body">
                Clinical epistemology in MCTOSHS concerns how knowledge is acquired at each stage
                of the Clinical Presentation — and how Clinical Representation adds a further
                layer of epistemic distance.
              </p>
              <p className="about_section_body" style={{ marginTop: "0.6rem" }}>
                No one has direct access to Patient Reality (Patient Hyle). What is accessible is
                always a <strong>trace</strong> — a signal, symptom, sign, image, or measurement
                that arises from the patient but is not the patient. Both the patient and the
                clinician encounter traces, but differently.
              </p>

              {/* ── Epistemic map of the 6 steps ── */}
              <div className="about_epist_map">
                <div className="about_epist_map_row about_epist_map_row--patient">
                  <div className="about_epist_map_label">Patient side</div>
                  <div className="about_epist_map_steps">
                    <div className="about_epist_map_step">
                      <div className="about_epist_map_num">1</div>
                      <div className="about_epist_map_name">Patient Reality</div>
                      <div className="about_epist_map_sub">Exists independently — not yet known by anyone</div>
                    </div>
                    <div className="about_epist_map_arrow">→</div>
                    <div className="about_epist_map_step">
                      <div className="about_epist_map_num">2</div>
                      <div className="about_epist_map_name">Patient Access</div>
                      <div className="about_epist_map_sub">Traces arise from physis — measurable and observable outputs</div>
                    </div>
                    <div className="about_epist_map_arrow">→</div>
                    <div className="about_epist_map_step">
                      <div className="about_epist_map_num">3</div>
                      <div className="about_epist_map_name">Patient Interpretation</div>
                      <div className="about_epist_map_sub"><strong>Subjective only</strong> — meaning-to-them: phenomena as lived experience. No clinical representation background; interpretation is felt, not clinically named.</div>
                    </div>
                  </div>
                </div>
                <div className="about_epist_map_row about_epist_map_row--clinician">
                  <div className="about_epist_map_label">Clinician side</div>
                  <div className="about_epist_map_steps">
                    <div className="about_epist_map_step">
                      <div className="about_epist_map_num">4</div>
                      <div className="about_epist_map_name">Clinician Access</div>
                      <div className="about_epist_map_sub">Traces reach the clinician — via examination, interview, imaging, labs</div>
                    </div>
                    <div className="about_epist_map_arrow">→</div>
                    <div className="about_epist_map_step">
                      <div className="about_epist_map_num">5</div>
                      <div className="about_epist_map_name">Clinician Interpretation</div>
                      <div className="about_epist_map_sub"><strong>Subjective</strong> — meaning-to-them: the clinician&apos;s lived perception of this patient (phenomena). <strong>Objective</strong> — meaning-to-the-representation-reservoir: diagnosis, labels, codes that enter the clinical record.</div>
                    </div>
                    <div className="about_epist_map_arrow">→</div>
                    <div className="about_epist_map_step">
                      <div className="about_epist_map_num">6</div>
                      <div className="about_epist_map_name">Clinical Intervention</div>
                      <div className="about_epist_map_sub">Knowledge is converted into action directed at Patient Reality</div>
                    </div>
                  </div>
                </div>
                <div className="about_epist_map_row about_epist_map_row--repr">
                  <div className="about_epist_map_label">Representation</div>
                  <div className="about_epist_map_steps">
                    <div className="about_epist_map_step about_epist_map_step--wide">
                      <div className="about_epist_map_name">Clinical Representation</div>
                      <div className="about_epist_map_sub">The presentation is re-encoded in language — lectures, charts, textbooks, exams — adding a second layer of epistemic distance from Patient Reality</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Epistemic sequence within step 4 & 5 ── */}
              <p className="about_section_body" style={{ marginTop: "1.3rem" }}>
                Within <strong>Clinician Access</strong> and <strong>Clinician Interpretation</strong>
                (steps 4 and 5), a precise epistemic sequence unfolds. The word <em>recognition</em>
                is commonly used to name this — but the etymology reveals that recognition is not the
                first act:
              </p>

              {/* ── Etymology block ── */}
              <div className="about_epist_etymology">
                <div className="about_epist_etym_word">recognition</div>
                <div className="about_epist_etym_eq">= <span className="about_epist_etym_morph">re-</span> + <span className="about_epist_etym_morph">cogn-</span> + <span className="about_epist_etym_morph">-ition</span></div>
                <div className="about_epist_etym_rows">
                  <div className="about_epist_etym_row">
                    <span className="about_epist_etym_morph">re-</span>
                    <span className="about_epist_etym_gloss">again / back</span>
                  </div>
                  <div className="about_epist_etym_row">
                    <span className="about_epist_etym_morph">cogn-</span>
                    <span className="about_epist_etym_gloss">know — from Latin <em>cognōscere</em>, "to come to know"</span>
                  </div>
                  <div className="about_epist_etym_row">
                    <span className="about_epist_etym_morph">-ition</span>
                    <span className="about_epist_etym_gloss">act or process</span>
                  </div>
                </div>
                <div className="about_epist_etym_result">
                  From Latin <em>recognōscere</em>: "to know again, acknowledge, examine, identify."
                  Literally: <strong>knowing something as this identifiable thing.</strong>
                </div>
              </div>

              <p className="about_section_body" style={{ marginTop: "1rem" }}>
                Because <em>recognōscere</em> implies knowing <em>again</em>, it presupposes prior
                steps — encounter, noticing, and differentiation must come first. The corrected
                sequence within steps 4 and 5:
              </p>

              <div className="about_epist_cols">

                <div className="about_epist_col">
                  <div className="about_epist_col_title">Epistemic sequence (steps 4 &amp; 5)</div>
                  <ol className="about_epist_steps">
                    {[
                      { label: "Clinician Access established",  sub: "positioned to receive traces from the patient",                     mark: null },
                      { label: "Encounter / reception",         sub: "a trace reaches the clinician — the most primitive epistemic event", mark: "primitive" },
                      { label: "Noticing",                      sub: "something registers before any identification",                      mark: "primitive" },
                      { label: "Differentiation",               sub: "that something is separated from its background",                    mark: null },
                      { label: "Recognition",                   sub: "cognoscere → recognoscere: knowing it as this identifiable thing",  mark: "recognition" },
                      { label: "Naming",                        sub: "a linguistic handle is attached",                                    mark: null },
                      { label: "Relation-building",             sub: "the named trace is connected to others",                             mark: null },
                      { label: "Interpretation",                sub: "meaning is assigned — this is Clinician Interpretation (step 5)",    mark: null },
                      { label: "Concept formation",             sub: "a stable, repeatable category is constructed",                       mark: null },
                      { label: "Diagnosis",                     sub: "Patient Morphe: the concept is applied to this patient now",         mark: null },
                    ].map((s, i) => (
                      <li key={i} className={`about_epist_step${s.mark ? ` about_epist_step--${s.mark}` : ""}`}>
                        <div className="about_epist_step_label">{s.label}</div>
                        <div className="about_epist_step_sub">{s.sub}</div>
                      </li>
                    ))}
                  </ol>
                </div>

                <div className="about_epist_col">
                  <div className="about_epist_col_title">Clinical example — ECG trace</div>
                  <ol className="about_epist_steps about_epist_steps--example">
                    {[
                      { label: "Clinician positioned at ECG",                      sub: "Clinician Access (step 4)",                          mark: null },
                      { label: "A signal reaches the clinician",                   sub: "encounter / reception",                              mark: "primitive" },
                      { label: "Something is noticed on the trace",                sub: "noticing — before any identification",               mark: "primitive" },
                      { label: "ST segment distinguished from baseline",           sub: "differentiation",                                    mark: null },
                      { label: "Recognized as this patterned signal",              sub: "cognoscere → recognoscere",                     mark: "recognition" },
                      { label: "\"ST elevation\" is named",                        sub: "naming",                                             mark: null },
                      { label: "Related to symptoms, troponin, anatomy",           sub: "relation-building",                                  mark: null },
                      { label: "Possible ischemia interpreted",                    sub: "Clinician Interpretation begins (step 5)",           mark: null },
                      { label: "Myocardial infarction concept formed or rejected", sub: "concept formation",                                  mark: null },
                      { label: "Diagnosis applied to this patient now",            sub: "Patient Morphé — diagnosis",                    mark: null },
                    ].map((s, i) => (
                      <li key={i} className={`about_epist_step${s.mark ? ` about_epist_step--${s.mark}` : ""}`}>
                        <div className="about_epist_step_label">{s.label}</div>
                        <div className="about_epist_step_sub">{s.sub}</div>
                      </li>
                    ))}
                  </ol>
                </div>

              </div>

              {/* ── Perception / Recognition / Knowledge distinction ── */}
              <div className="about_epist_distinctions" style={{ marginTop: "1.4rem" }}>
                <div className="about_epist_distinction">
                  <span className="about_epist_term">Perception</span>
                  <span className="about_epist_eq">=</span>
                  <span className="about_epist_def">receiving a trace (step 4 — Clinician Access)</span>
                </div>
                <div className="about_epist_distinction about_epist_distinction--highlighted">
                  <span className="about_epist_term">Recognition</span>
                  <span className="about_epist_eq">=</span>
                  <span className="about_epist_def">knowing the trace as this identifiable thing — <em>recognōscere</em></span>
                </div>
                <div className="about_epist_distinction">
                  <span className="about_epist_term">Interpretation</span>
                  <span className="about_epist_eq">=</span>
                  <span className="about_epist_def">assigning meaning in context — forming the Patient Morph&#233; (step 5)</span>
                </div>
                <div className="about_epist_distinction">
                  <span className="about_epist_term">Representation</span>
                  <span className="about_epist_eq">=</span>
                  <span className="about_epist_def">re-encoding the presentation in language — adding epistemic distance</span>
                </div>
              </div>

              <p className="about_section_body about_section_body--callout" style={{ marginTop: "1.1rem" }}>
                Encounter and noticing are prior to recognition. Recognition is prior to interpretation.
                Interpretation is prior to diagnosis. The Clinical Representation begins only after
                the presentation has occurred — and the student receives it last, furthest from Patient Reality.
              </p>
            </section>

            <section id="about-means" className="about_section">
              <h2 className="about_section_title">Means of Access</h2>
              <p className="about_section_body">
                A <strong>means of access</strong> is whatever channel connects an observer to the
                traces of clinical reality — not to clinical reality itself, which no observer can
                reach directly. In MCTOSHS the concept operates on three levels simultaneously —
                epistemological, phenomenological, and structural — and understanding all three is
                necessary to understand what the system is doing and why.
              </p>

              <div className="about_means_level">
                <div className="about_means_level_marker">I</div>
                <div className="about_means_level_body">
                  <div className="about_means_level_title">Clinician Access — traces to the clinician</div>
                  <p className="about_section_body about_section_body--callout">
                    No one observes Patient Reality directly. Only its traces.
                  </p>
                  <p className="about_section_body" style={{ marginTop: "0.75rem" }}>
                    What the clinician encounters in the Clinical Presentation is always a
                    <strong> trace</strong> — a symptom, sign, measurement, image, or sound
                    that arises from Patient Reality but is not Patient Reality itself. The
                    disease process, the failing organ, the pathological change — these are
                    inferred from traces, never seen directly.
                  </p>
                  <p className="about_section_body" style={{ marginTop: "0.75rem" }}>
                    The Clinical Representation adds a further remove: it encodes the
                    clinician&apos;s observation of traces into language. What the student
                    receives is not the trace — it is a linguistic re-encoding of the
                    observation of a trace.
                  </p>
                </div>
              </div>

              <div className="about_means_level">
                <div className="about_means_level_marker">II</div>
                <div className="about_means_level_body">
                  <div className="about_means_level_title">Patient Interpretation — the patient's access to their own traces</div>
                  <p className="about_section_body">
                    The patient does not experience their condition as a diagnosis. They experience it
                    through their body — through the five sensory modalities that constitute
                    Patient Interpretation (step 3 of the Clinical Presentation):
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
                  <div className="about_means_level_title">From Clinical Representation to Clinical Presentation</div>
                  <p className="about_section_body">
                    The Clinical Representation names clinical entities — <em>burning sensation,
                    ST elevation, dyspnoea</em> — as categories. These categories are still
                    unanchored: they are abstract terms without a subject, a body, or a moment.
                  </p>
                  <p className="about_section_body" style={{ marginTop: "0.6rem" }}>
                    The move from Representation to Presentation happens when a specific patient,
                    through their sensory modalities — Eye, Ear, Tongue, Skin, Nose — reports
                    what they actually experience. A general category becomes a lived phenomenon:
                    located in a body, expressed through a sense, situated in time.
                  </p>
                  <p className="about_section_body" style={{ marginTop: "0.6rem" }}>
                    This is the structural link between Clinical Representation and Patient
                    Interpretation (step 3 of the Clinical Presentation).
                  </p>
                </div>
              </div>
            </section>

            <section id="about-ball" className="about_section">
              <h2 className="about_section_title">Patient Reality, Trace, and Identity Through Time</h2>
              <p className="about_section_body">
                A 2D observer can know only the circular cross-section created where a 3D ball
                intersects its plane. The circle is not the ball — it is a limited representation
                under one relation of access. The same distinction applies clinically:{" "}
                <strong>a trace is not the patient and is not the patient's total physis.</strong>
              </p>

              {/* ── Case 1 ── */}
              <div className="about_ball_case">
                <div className="about_ball_case_title">Case 1 — The ball changes, but the observed circle does not</div>
                <p className="about_section_body">
                  The ball changes above and below the 2D plane: its upper region elongates,
                  its lower region compresses, or its internal structure changes. Yet its
                  intersection with the plane remains the same circle.
                </p>

                <svg viewBox="0 0 300 155" className="about_ball_svg" aria-label="Ball changes, circle unchanged">
                  {/*
                    Center of intersection: cx=120, cy=100  rx=62
                    Upper arc: elongated ry=82  → top at y=18   sweep=1 (CW from left = upward)
                    Lower arc: compressed ry=30 → bottom at y=130 sweep=1 (CW from right = downward)
                    Fill and stroke separated so the plane dashed line stays clean.
                  */}

                  {/* ── upper half: fill ── */}
                  <path d="M 58 100 A 62 82 0 0 1 182 100 Z"
                    fill="rgba(99,102,241,0.07)" stroke="none"/>
                  {/* ── upper half: arc stroke only (no plane-line stroke) ── */}
                  <path d="M 58 100 A 62 82 0 0 1 182 100"
                    fill="none" stroke="currentColor" strokeWidth="1.3" opacity="0.65"/>
                  {/* internal layer lines — spread far apart (stretched) */}
                  <line x1="79" y1="38" x2="161" y2="38"  stroke="currentColor" strokeWidth="0.5" strokeDasharray="2,3" opacity="0.2"/>
                  <line x1="63" y1="68" x2="177" y2="68"  stroke="currentColor" strokeWidth="0.5" strokeDasharray="2,3" opacity="0.2"/>
                  <text x="92" y="56" fontSize="7.5" fill="currentColor" opacity="0.55" fontStyle="italic">elongated</text>

                  {/* ── lower half: fill ── */}
                  <path d="M 182 100 A 62 30 0 0 1 58 100 Z"
                    fill="rgba(239,68,68,0.06)" stroke="none"/>
                  {/* ── lower half: arc stroke only ── */}
                  <path d="M 182 100 A 62 30 0 0 1 58 100"
                    fill="none" stroke="currentColor" strokeWidth="1.3" opacity="0.65"/>
                  {/* internal layer line — tight (compressed) */}
                  <line x1="68" y1="116" x2="172" y2="116" stroke="currentColor" strokeWidth="0.5" strokeDasharray="2,3" opacity="0.2"/>
                  <text x="89" y="122" fontSize="7.5" fill="currentColor" opacity="0.55" fontStyle="italic">compressed</text>

                  {/* ── 2D plane ── */}
                  <line x1="5" y1="100" x2="278" y2="100"
                    stroke="currentColor" strokeWidth="0.8" strokeDasharray="4,3" opacity="0.4"/>
                  <text x="222" y="97" fontSize="7" fill="currentColor" opacity="0.4" fontStyle="italic">2D plane</text>

                  {/* ── intersection ellipse — same despite the shape change ── */}
                  <ellipse cx="120" cy="100" rx="62" ry="8"
                    fill="rgba(229,57,53,0.1)" stroke="#e53935" strokeWidth="1.7"/>
                  <text x="186" y="104" fontSize="8" fill="#e53935">= unchanged</text>
                </svg>

                <div className="about_ball_code">
                  3D object changes<br/>
                  &nbsp;&nbsp;- upper part elongates<br/>
                  &nbsp;&nbsp;- lower part compresses<br/>
                  &nbsp;&nbsp;- internal structure changes<br/>
                  <br/>
                  2D intersection remains: same circle
                </div>

                <table className="about_compare_table" style={{ marginTop: "0.8rem" }}>
                  <thead><tr><th>Observed trace</th><th>Possible hidden patient changes</th></tr></thead>
                  <tbody>
                    <tr>
                      <td>Oxygen saturation remains 96%</td>
                      <td>Left-ventricular function worsens; pulmonary venous pressure rises; interstitial edema begins; compensatory tachypnea maintains oxygenation.</td>
                    </tr>
                  </tbody>
                </table>
                <p className="about_ball_rule">MCTOSHS rule: Stable trace does not prove stable patient reality.</p>
              </div>

              {/* ── Case 2 ── */}
              <div className="about_ball_case">
                <div className="about_ball_case_title">Case 2 — The observed circle changes, but the ball remains the same ball</div>
                <p className="about_section_body">
                  The sphere itself remains unchanged, but it moves through the 2D plane at an angle.
                  The observer sees a small circle, then a larger circle, then the maximal circle,
                  then a smaller circle, and finally no circle at all.
                </p>

                <svg viewBox="0 0 310 118" className="about_ball_svg" aria-label="Circle changes, ball identity unchanged">
                  {/* plane */}
                  <line x1="5" y1="60" x2="305" y2="60" stroke="currentColor" strokeWidth="0.7" strokeDasharray="4,3" opacity="0.35"/>
                  <text x="2" y="56" fontSize="7" fill="currentColor" opacity="0.38" fontStyle="italic">plane</text>
                  {/* "same sphere" note */}
                  <text x="95" y="11" fontSize="7.5" fill="currentColor" opacity="0.45" fontStyle="italic">same sphere — different intersections with the plane</text>

                  {/* pos 1 — tiny */}
                  <circle cx="28" cy="60" r="7" fill="rgba(229,57,53,0.1)" stroke="#e53935" strokeWidth="1.2"/>
                  <text x="17" y="78" fontSize="7.5" fill="currentColor" opacity="0.55">small</text>
                  <text x="39" y="63" fontSize="10" fill="currentColor" opacity="0.28">&#8594;</text>

                  {/* pos 2 — medium */}
                  <circle cx="87" cy="60" r="19" fill="rgba(229,57,53,0.1)" stroke="#e53935" strokeWidth="1.3"/>
                  <text x="76" y="88" fontSize="7.5" fill="currentColor" opacity="0.55">larger</text>
                  <text x="110" y="63" fontSize="10" fill="currentColor" opacity="0.28">&#8594;</text>

                  {/* pos 3 — maximal */}
                  <circle cx="158" cy="60" r="31" fill="rgba(229,57,53,0.12)" stroke="#e53935" strokeWidth="1.8"/>
                  <text x="141" y="103" fontSize="7.5" fill="currentColor" opacity="0.55">maximal</text>
                  <text x="194" y="63" fontSize="10" fill="currentColor" opacity="0.28">&#8594;</text>

                  {/* pos 4 — medium again */}
                  <circle cx="230" cy="60" r="19" fill="rgba(229,57,53,0.1)" stroke="#e53935" strokeWidth="1.3"/>
                  <text x="217" y="88" fontSize="7.5" fill="currentColor" opacity="0.55">smaller</text>
                  <text x="253" y="63" fontSize="10" fill="currentColor" opacity="0.28">&#8594;</text>

                  {/* pos 5 — disappearing */}
                  <circle cx="285" cy="60" r="5" fill="rgba(229,57,53,0.18)" stroke="#e53935" strokeWidth="1.2"/>
                  <text x="262" y="78" fontSize="7.5" fill="currentColor" opacity="0.55">disappears</text>
                </svg>

                <table className="about_compare_table" style={{ marginTop: "0.8rem" }}>
                  <thead><tr><th>Observed trace changes</th><th>Correct interpretation</th></tr></thead>
                  <tbody>
                    <tr>
                      <td>Blood pressure changes from 90/60 to 140/90, or an ECG changes from sinus rhythm to atrial fibrillation.</td>
                      <td>The patient remains physiologically intact. A time-indexed trace has changed; the patient's physis has not.</td>
                    </tr>
                  </tbody>
                </table>
                <p className="about_ball_rule">MCTOSHS rule: Changed trace does not prove changed patient physis.</p>
              </div>

              {/* ── Comparison table ── */}
              <table className="about_compare_table" style={{ marginTop: "1.5rem" }}>
                <thead>
                  <tr><th>2D ball case</th><th>Clinical equivalent</th><th>Correct conclusion</th></tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Circle unchanged while ball changes elsewhere</td>
                    <td>Stable SpO&#8322; while cardiac function or pulmonary pressure worsens</td>
                    <td>Stable trace does not prove stable total physis.</td>
                  </tr>
                  <tr>
                    <td>Circle changes while the ball remains the same ball</td>
                    <td>ECG, blood pressure, temperature, or pain score changes</td>
                    <td>Changed trace does not prove changed patient physis.</td>
                  </tr>
                </tbody>
              </table>

              {/* ── MCTOSHS Principle ── */}
              <div className="about_ball_principle">
                <div>Entity identity<br/>&nbsp;&nbsp;= continuity of the whole being through time</div>
                <div style={{ marginTop: "0.55rem" }}>Physis at t&#8320;<br/>&nbsp;&nbsp;= one actual physical state of that entity</div>
                <div style={{ marginTop: "0.55rem" }}>Trace at t&#8320;<br/>&nbsp;&nbsp;= one accessible representation of that state</div>
              </div>

              <p className="about_section_body" style={{ marginTop: "0.9rem" }}>
                A clinical trace is neither the patient nor the whole current physis of the patient.
                It is a constrained slice of a changing living entity. Clinical knowledge improves
                by integrating <strong>multiple traces, multiple means of access, multiple moments
                in time, and causal relations.</strong>
              </p>
            </section>

            <section id="about-how" className="about_section">
              <h2 className="about_section_title">How it works</h2>
              <p className="about_section_body">
                Upload a PDF in the Hyles page. The system extracts hyles and classifies
                them into five cards — Objects, Traces, Phenomena, Concepts, and Models —
                each further organised by biological scale (Molecule → Cell → Tissue → Organ → Organ System → Human).
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
                      <span className="about_type_desc_inline">— built from multiple morphemes into a single word. <em>e.g. myocardium, cardiomyocyte</em></span>
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

            <section id="about-conclusion" className="about_section about_conclusion">
              <h2 className="about_section_title">Conclusion</h2>
              <p className="about_what_tagline">
                MCTOSHS is a <strong>patient-centered</strong> route from representation to reality:
                from language to patient.
              </p>
              <p className="about_section_body">
                It begins with the medical student&apos;s available world &mdash; lectures,
                textbooks, charts, images, laboratory reports, and diagnostic labels &mdash; and
                teaches the student not to mistake these representations for the patient.
              </p>
              <p className="about_section_body">
                Through structured analysis, MCTOSHS moves the student from medical language toward
                the reality it tries to represent: the patient&apos;s physis, psyche, traces, lived
                phenomena, and pathological processes.
              </p>
              <p className="about_what_tagline">
                The final aim is not a better representation alone. It is a more adequate,
                patient-centered encounter with the real patient.
              </p>
            </section>

          </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AboutPage;
