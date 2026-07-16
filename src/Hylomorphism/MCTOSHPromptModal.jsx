import React, { useState } from "react";
import { MCTOSH_PROMPT_TEXT } from "./mctoshPrompt";
import "./mctoshPromptModal.css";

const SECTIONS = [
  { roman: "I",    title: "Input" },
  { roman: "II",   title: "Linguistic Decomposition" },
  { roman: "III",  title: "Morpheme Analysis" },
  { roman: "IV",   title: "Word & Phrase Analysis" },
  { roman: "V",    title: "Phrase-Head Rule" },
  { roman: "VI",   title: "Ontological Levels" },
  { roman: "VII",  title: "Mode Classification" },
  { roman: "VIII", title: "Trace vs Phenomenon" },
  { roman: "IX",   title: "Symptom Rule" },
  { roman: "X",    title: "Assertion & Negation" },
  { roman: "XI",   title: "Output Format" },
  { roman: "XII",  title: "Quality Control" },
];

const MCTOSHPromptModal = ({ onClose }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard?.writeText(MCTOSH_PROMPT_TEXT).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };

  return (
    <div id="mcp_overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div id="mcp_modal">
        <div id="mcp_header">
          <span id="mcp_title">AMCTOSHS Clinical Linguistic Decomposition &amp; Ontological Classification Prompt</span>
          <button id="mcp_copy_btn" onClick={handleCopy}>{copied ? "Copied ✓" : "Copy Prompt"}</button>
          <button id="mcp_close_btn" onClick={onClose}>×</button>
        </div>

        <div id="mcp_nav">
          {SECTIONS.map(s => (
            <a key={s.roman} href={`#mcp_sec_${s.roman}`} className="mcp_nav_item">
              <span className="mcp_nav_roman">{s.roman}</span>
              <span className="mcp_nav_label">{s.title}</span>
            </a>
          ))}
        </div>

        <div id="mcp_body">
          <p className="mcp_intro">
            You are an expert clinical linguist and ontological classifier working within the AMCTOSHS framework.
            Your task is to analyze clinical text in two stages: <strong>Stage 1 — Linguistic Decomposition</strong> and{" "}
            <strong>Stage 2 — AMCTOSHS Ontological Classification</strong>.
          </p>
          <p className="mcp_intro">
            Do not classify a medical expression from a word alone. First identify its morphemes, words, phrase
            structure, grammatical head, modifiers, assertion status, source, temporality, and clinical role.
            The original text is always the authority.
          </p>

          {/* I */}
          <section id="mcp_sec_I" className="mcp_section">
            <h2 className="mcp_sec_title"><span className="mcp_roman">I.</span> Input</h2>
            <p className="mcp_p">You will receive:</p>
            <ol className="mcp_ol">
              <li>Raw clinical text.</li>
              <li>Optionally, pre-extracted linguistic annotations.</li>
              <li>Optionally, a previous AMCTOSHS classification.</li>
            </ol>
            <p className="mcp_p">Use the raw clinical text to verify every conclusion.</p>
          </section>

          {/* II */}
          <section id="mcp_sec_II" className="mcp_section">
            <h2 className="mcp_sec_title"><span className="mcp_roman">II.</span> Stage 1 — Linguistic Decomposition</h2>
            <p className="mcp_p">For every clinically meaningful sentence, divide the text into:</p>
            <pre className="mcp_code">Document → sentence → clause → syntagm / phrase → word → morpheme</pre>
            <p className="mcp_p">Extract only medically meaningful language, including:</p>
            <div className="mcp_two_col">
              {["anatomy","biological entities","physiological processes","pathological processes","symptoms","signs","laboratory terms","imaging terms","measurements","medications","procedures","diagnoses","qualifiers","negations","temporal expressions","uncertainty expressions","causal expressions","comparison expressions","severity expressions"].map(i => (
                <span key={i} className="mcp_tag">{i}</span>
              ))}
            </div>
          </section>

          {/* III */}
          <section id="mcp_sec_III" className="mcp_section">
            <h2 className="mcp_sec_title"><span className="mcp_roman">III.</span> Morpheme Analysis</h2>
            <p className="mcp_p">For each medically meaningful word, identify medically relevant morphemes when possible.</p>
            <div className="mcp_morph_grid">
              {[
                ["myocarditis",       [["myo","muscle"],["cardi","heart"],["itis","inflammation"]]],
                ["electrocardiogram", [["electro","electrical"],["cardi","heart"],["gram","recorded trace"]]],
                ["tachycardia",       [["tachy","fast"],["cardi","heart"],["ia","state/condition"]]],
                ["hypoglycemia",      [["hypo","low"],["glyc","glucose"],["emia","blood condition"]]],
              ].map(([word, parts]) => (
                <div key={word} className="mcp_morph_card">
                  <div className="mcp_morph_word">{word}</div>
                  {parts.map(([m, d]) => (
                    <div key={m} className="mcp_morph_row"><span className="mcp_morph_m">{m}</span><span className="mcp_morph_eq">=</span><span className="mcp_morph_d">{d}</span></div>
                  ))}
                </div>
              ))}
            </div>
            <div className="mcp_callout">
              Do not treat morphemes as final ontological labels. Morphemes only generate candidate meanings.<br/>
              <em>Example: electrocardiogram contains "cardi," but it is not a cardiac object — it is a recorded cardiac electrical trace.</em>
            </div>
          </section>

          {/* IV */}
          <section id="mcp_sec_IV" className="mcp_section">
            <h2 className="mcp_sec_title"><span className="mcp_roman">IV.</span> Word and Phrase Analysis</h2>
            <p className="mcp_p">For every clinically meaningful phrase, identify:</p>
            <table className="mcp_table">
              <thead><tr><th>Field</th><th>Required Output</th></tr></thead>
              <tbody>
                {[
                  ["Surface phrase","Exact phrase from text"],
                  ["Normalized expression","Standard medical form"],
                  ["Head word","Main semantic noun or predicate"],
                  ["Modifiers","Adjectives, adverbs, prepositions, laterality, location, severity, duration"],
                  ["Morphemes","Relevant medical morphemes"],
                  ["Syntagm type","Noun phrase, verb phrase, adjective phrase, prepositional phrase, clause"],
                  ["Anatomical target","Structure named or implied"],
                  ["Biological target","Molecule, cell, tissue, organ, system, etc."],
                  ["Event/process target","Process named or implied"],
                  ["Measurement target","What is being measured, if applicable"],
                  ["Relation type","Has-value, occurs-in, affects, causes, located-in, denies, suggests, etc."],
                  ["Assertion status","Present, absent, possible, historical, planned, conditional, family history"],
                  ["Negation","None, denied, absent, ruled out, no evidence of"],
                  ["Temporality","Current, acute, chronic, past, future, duration unknown"],
                  ["Experiencer/source","Patient, clinician, laboratory, imaging device, monitor, chart, family"],
                  ["Evidence source","Patient report, physical exam, lab, imaging, pathology, ECG, device, clinician inference"],
                  ["Confidence","Explicit, necessarily implied, inferred, uncertain"],
                ].map(([f, o]) => <tr key={f}><td>{f}</td><td>{o}</td></tr>)}
              </tbody>
            </table>
          </section>

          {/* V */}
          <section id="mcp_sec_V" className="mcp_section">
            <h2 className="mcp_sec_title"><span className="mcp_roman">V.</span> Phrase-Head Rule</h2>
            <p className="mcp_p">The grammatical head controls the primary classification of the phrase.</p>
            {[
              {
                phrase: '"left ventricular systolic dysfunction"',
                head: "dysfunction", mods: "left, ventricular, systolic",
                meaning: "a dysfunction concept concerning systolic activity of the left ventricle",
                results: [["Left ventricle","Level 1, Sub-organ"],["Systolic contraction","Level 3, Sub-organ phenomenon"],["Left ventricular systolic dysfunction","Level 4, clinical concept"]],
              },
              {
                phrase: '"elevated serum troponin"',
                head: "troponin", mods: "elevated, serum",
                meaning: "a measured concentration of troponin in serum that is above reference range",
                results: [["Troponin","Level 1, Molecule"],["Troponin assay value","Level 2, Molecule-level trace"],["Elevated serum troponin","Level 2, interpreted laboratory finding"]],
              },
            ].map(ex => (
              <div key={ex.phrase} className="mcp_example">
                <pre className="mcp_code">{ex.phrase}{"\n"}Head: {ex.head} | Modifiers: {ex.mods}{"\n"}Meaning: {ex.meaning}</pre>
                {ex.results.map(([k, v]) => (
                  <div key={k} className="mcp_result_row"><span className="mcp_result_term">{k}</span><span className="mcp_arrow">→</span><span className="mcp_result_val">{v}</span></div>
                ))}
              </div>
            ))}
          </section>

          {/* VI */}
          <section id="mcp_sec_VI" className="mcp_section">
            <h2 className="mcp_sec_title"><span className="mcp_roman">VI.</span> AMCTOSHS Ontological Levels</h2>
            <p className="mcp_p">After linguistic analysis, classify each extracted item into one primary level.</p>
            {[
              { level: "Level 1 — Object", desc: "Material entity, biological structure, physical substrate, molecular component, anatomical entity.", examples: "heart · left ventricle · myocardium · cardiomyocyte · mitochondrion · troponin · sodium ion · gastric mucosa" },
              { level: "Level 2 — Trace", desc: "Captured access-product from the patient.", examples: "ECG waveform · troponin result · blood pressure reading · echocardiographic image · auscultated sound · patient-reported pain · chest X-ray opacity" },
              { level: "Level 3 — Phenomenon", desc: "Real process, event, functional activity, state-change, or lived experience occurring in the patient.", examples: "systole · diastole · myocardial contraction · cardiomyocyte depolarization · acid reflux · ischemia · inflammation · pain as felt · dyspnea as felt" },
              { level: "Level 4 — Concept", desc: "Diagnosis, disease name, clinical label, syndrome, theory, classification, hypothesis, interpretation.", examples: "heart failure · myocardial infarction · GERD · atrial fibrillation · pneumonia · acute coronary syndrome" },
            ].map(l => (
              <div key={l.level} className="mcp_level_card">
                <div className="mcp_level_title">{l.level}</div>
                <p className="mcp_level_desc">{l.desc}</p>
                <div className="mcp_level_examples">{l.examples}</div>
              </div>
            ))}
          </section>

          {/* VII */}
          <section id="mcp_sec_VII" className="mcp_section">
            <h2 className="mcp_sec_title"><span className="mcp_roman">VII.</span> AMCTOSHS Mode Classification</h2>
            <p className="mcp_p">Assign the narrowest valid mode. Never use Human when a narrower anatomical scale is available.</p>
            <div className="mcp_mode_grid">
              {["Sub-molecule","Molecule","Sub-cell","Cell","Sub-tissue","Tissue","Sub-organ","Organ","Sub-Organ System","Organ System","Sub-human","Human"].map((m, i) => (
                <div key={m} className="mcp_mode_item"><span className="mcp_mode_num">{i+1}.</span> {m}</div>
              ))}
            </div>
            <pre className="mcp_code">{`Systole                           → Level 3, Organ: Heart
Left ventricular systole          → Level 3, Sub-organ: Left ventricle
Myocardial contraction            → Level 3, Tissue: Myocardium
Action potential in cardiomyocyte → Level 3, Cell: Cardiomyocyte
SA-node depolarization            → Level 3, Sub-organ: Sinoatrial node
Fatigue                           → Level 3, Human`}</pre>
          </section>

          {/* VIII */}
          <section id="mcp_sec_VIII" className="mcp_section">
            <h2 className="mcp_sec_title"><span className="mcp_roman">VIII.</span> Trace vs Phenomenon Rule</h2>
            <div className="mcp_callout">
              <strong>Does it occur in the patient independently of observation?</strong><br/>
              Yes → Object or Phenomenon &nbsp;·&nbsp; No → Trace or Concept
            </div>
            <pre className="mcp_code">{`Actual electrical propagation through myocardium → Level 3, Tissue phenomenon
ECG waveform recording electrical propagation    → Level 2, Organ-level trace
Actual ventricular contraction                   → Level 3, Sub-organ phenomenon
Echo image recording ventricular motion          → Level 2, Sub-organ trace`}</pre>
          </section>

          {/* IX */}
          <section id="mcp_sec_IX" className="mcp_section">
            <h2 className="mcp_sec_title"><span className="mcp_roman">IX.</span> Symptom Rule</h2>
            <p className="mcp_p">Separate the symptom itself from its report. When both are present, output both.</p>
            <pre className="mcp_code">{`"Chest pain"                 → Level 3, Human, lived experience
"Patient reports chest pain" → Level 2, Human, patient-reported trace`}</pre>
          </section>

          {/* X */}
          <section id="mcp_sec_X" className="mcp_section">
            <h2 className="mcp_sec_title"><span className="mcp_roman">X.</span> Assertion, Negation, and Temporality Rules</h2>
            <p className="mcp_p">Do not treat all mentioned terms as present reality.</p>
            <pre className="mcp_code">{`"No chest pain"                → chest pain is negated, not present
"History of heart failure"     → concept is historical, not necessarily current
"Rule out pulmonary embolism"  → diagnostic possibility, not diagnosis
"Possible pneumonia"           → uncertain concept
"Family history of diabetes"   → contextual information, not patient disease
"Scheduled for echocardiogram" → planned future trace, not current result`}</pre>
            <p className="mcp_p">Allowed statuses:</p>
            <div className="mcp_two_col">
              {["Present","Absent / denied","Measured","Observed","Patient-reported","Historical","Possible","Suspected","Differential","Planned","Conditional","Family history","Unknown"].map(s => (
                <span key={s} className="mcp_tag">{s}</span>
              ))}
            </div>
          </section>

          {/* XI */}
          <section id="mcp_sec_XI" className="mcp_section">
            <h2 className="mcp_sec_title"><span className="mcp_roman">XI.</span> Required Output Format</h2>
            <div className="mcp_output_block">
              <div className="mcp_output_label">A. Linguistic Decomposition Table</div>
              <p className="mcp_p">Columns: ID · Surface Phrase · Normalized Expression · Head Word · Modifiers · Morphemes · Syntagm Type · Relation · Assertion · Negation · Temporality</p>
            </div>
            <div className="mcp_output_block">
              <div className="mcp_output_label">B. AMCTOSHS Classification Table</div>
              <p className="mcp_p">Columns: ID · Extracted Expression · Level · Mode · Ontic/Epistemic Status · Clinical Role · Structural Scale Basis · Certainty · Explanation</p>
              <pre className="mcp_code">Structural Scale Basis: Explicitly stated · Necessarily implied · Inferred · Unresolved</pre>
            </div>
            <div className="mcp_output_block">
              <div className="mcp_output_label">C. Internal Phrase Expansion</div>
              <p className="mcp_p">For every complex phrase, split it into ontological components.</p>
              <pre className="mcp_code">{`Phrase: "Reduced left ventricular ejection fraction"
  left ventricle                                    → Level 1, Sub-organ
  ejection process                                  → Level 3, Sub-organ
  echocardiographic / calculated ejection fraction  → Level 2, Sub-organ trace
  "reduced ejection fraction"                       → Level 2, interpreted quantitative finding`}</pre>
            </div>
            <div className="mcp_output_block">
              <div className="mcp_output_label">D. AMCTOSHS Diagnostic Circle</div>
              <pre className="mcp_code">Object / structure → process / phenomenon → trace → clinical interpretation → concept</pre>
              <p className="mcp_p">Use "not established" when the text does not support a causal or diagnostic link.</p>
            </div>
          </section>

          {/* XII */}
          <section id="mcp_sec_XII" className="mcp_section">
            <h2 className="mcp_sec_title"><span className="mcp_roman">XII.</span> Final Quality Control</h2>
            <p className="mcp_p">Before finalizing, verify:</p>
            <ol className="mcp_ol">
              <li>Did I identify the grammatical head of every complex medical phrase?</li>
              <li>Did I separate the actual object or process from its measurement?</li>
              <li>Did I separate the symptom as lived experience from the patient's report?</li>
              <li>Did I preserve negation, uncertainty, temporality, and source?</li>
              <li>Did I classify the phrase according to context rather than only its root word?</li>
              <li>Did I assign the narrowest valid AMCTOSHS mode?</li>
              <li>Did I avoid assigning Human when organ, tissue, cell, or molecule is more precise?</li>
              <li>Did I avoid converting suspected concepts into confirmed diagnoses?</li>
              <li>Did I preserve the raw text as the final authority?</li>
            </ol>
            <div className="mcp_callout mcp_callout--final">Analyze the supplied clinical text now.</div>
          </section>
        </div>
      </div>
    </div>
  );
};

export default MCTOSHPromptModal;
