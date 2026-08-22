import { useNavigate } from "react-router-dom";
import "./metaPatientNoumenaAboutPage.css";

const MetaPatientNoumenaAboutPage = () => {
  const navigate = useNavigate();
  return (
    <main id="meta_patient_noumena_about_page">
      <header className="mpn_about_header">
        <button type="button" className="mpn_about_home" onClick={() => navigate("/home")} aria-label="Home" title="Home">
          <i className="fi fi-rr-home" aria-hidden="true" />
        </button>
        <div>
          <p className="mpn_about_kicker">About</p>
          <h1>Meta-Patient Noumena</h1>
          <p className="mpn_about_subtitle">Representations of patient reality, prepared for clinical access.</p>
        </div>
        <button type="button" className="mpn_about_morphe" onClick={() => navigate("/clinical-schemata")}>
          <i className="fi fi-rr-network" aria-hidden="true" /> Morphe
        </button>
      </header>

      <div className="mpn_about_body">
        <section>
          <span className="mpn_about_number">01</span>
          <div>
            <h2>What is a Meta-Patient Noumenon?</h2>
            <p>A Meta-Patient Noumenon is a representation about a Patient Noumenon. It can be a record, image, measurement, description, model, or other trace that refers to a patient without being the patient itself.</p>
          </div>
        </section>
        <section>
          <span className="mpn_about_number">02</span>
          <div>
            <h2>Why it matters</h2>
            <p>Clinical work begins with mediated access. Notes, scans, laboratory values, conversations, and extracted entities are different ways in which patient reality becomes available to observation, comparison, and reasoning.</p>
          </div>
        </section>
        <section>
          <span className="mpn_about_number">03</span>
          <div>
            <h2>From source to Morphe</h2>
            <p>RabbitHole keeps the source traceable while organizing accepted representations into Morphe entities. Morphe is the structured destination where schemas, traces, values, relations, and instances can be explored.</p>
            <button type="button" className="mpn_about_cta" onClick={() => navigate("/clinical-schemata")}>Open Morphe <i className="fi fi-rr-arrow-up-right" aria-hidden="true" /></button>
          </div>
        </section>
        <article className="mpn_about_card">
          <div className="mpn_about_card_kicker">04 · Meaning Reconstruction</div>
          <h2>Reading as meaning reconstruction</h2>
          <p>Reading is a process of <strong>meaning reconstruction</strong> because the meaning being recovered is not created by the text from nothing; its constituent noetic elements already exist within the reader.</p>
          <p>These pre-existing meanings can be understood as the fragments of a cracked ceramic plate, while the <strong>logic encoded in the text functions as the fracture pattern that constrains their reassembly</strong>.</p>
          <p>Lexical selection, syntax, order, grammatical relations, and context determine which noetic fragments are relevant and restrict the ways in which they can be combined. Just as ceramic fragments resist incompatible arrangements because their edges do not correspond, incompatible interpretations fail to satisfy the relational pattern imposed by the text.</p>
          <p>As the reader proceeds, possible assemblies are progressively constrained until the available noetic elements converge on a coherent meaning-whole, analogous to the original plate reconstructed from its fragments.</p>
          <p>The text therefore does not act as a container that directly carries meaning into the mind; it acts as a <strong>reconstructive constraint-pattern</strong> that guides the retrieval and relational assembly of already existing noetic meanings into the meaning-whole represented by the text.</p>
        </article>
        <article className="mpn_about_card">
          <div className="mpn_about_card_kicker">05 · RabbitHole Aha Moment</div>
          <h2>RabbitHole Aha Moment</h2>
          <p>An <strong>Aha Moment</strong> occurs when <strong>reconstructed meaning outruns conscious logic</strong>. It is the critical instant in which a meaning that has already emerged, but remains supported only by <strong>ungrounded logic</strong>, is about to collapse because its justification has not yet arrived.</p>
          <p>Then, suddenly, the missing logic appears and <strong>asserts the meaning</strong>, stabilizing the entire reconstruction. The logic does not create the meaning; it arrives late enough to validate and ground a meaning that was already noetically present.</p>
          <p>In RabbitHole terms, this is a <strong>survival moment</strong>: the reconstructed meaning was on the verge of falling from <strong>4D into 3D</strong>, losing its noetic coherence and collapsing back into mere observable traces, until the arriving logic arrests that fall and secures the meaning as a coherent intelligible whole.</p>
          <p>Thus, the Aha Moment is both a moment of <strong>convergence and rescue</strong>: meaning appears first, logic catches up, contradiction collapses, and the reconstructed whole survives.</p>
        </article>
        <article className="mpn_about_card">
          <div className="mpn_about_card_kicker">06 · Life and Death to RabbitHole</div>
          <h2>Life and Death to RabbitHole</h2>
          <p>To RabbitHole, <strong>a living entity is a traceable noumenon</strong>: the continuing meaning-whole whose existence, states, and transformations can be followed through the traces it produces across its modes. The trace is not Life itself; it is the manifestation or evidence through which the noumenon remains reconstructable and its continuity can be followed.</p>
          <p><strong>Death terminates the HUMAN mode</strong> because HUMAN is the mode whose continuing existence requires the patient to remain actively traceable through brain-mediated continuity. When permanent cessation of brain function occurs, this living HUMAN trajectory can no longer continue. Other modes of the same matter remain traceable—organs, tissues, cells, molecules, atoms, records, memories, and physical traces—but the HUMAN mode has reached its terminal state.</p>
          <p>Before death: <strong>Atom → Molecule → Cell → Tissue → Organ → System → Human → …</strong></p>
          <p>After death: <strong>Atom ✓, Molecule ✓, Cell ✓ temporarily, Tissue ✓, Organ ✓ structurally, System may persist partially or artificially, HUMAN ✕ as a continuing living mode.</strong></p>
          <p>Death therefore does not make the material untraceable; it makes the <strong>HUMAN-mode continuation untraceable forward</strong>. The patient still has a <strong>past trace as a Human</strong>, but there is no next living HUMAN state to trace.</p>
          <p>Thus, <strong>Life is prospective traceable continuity, while death is the termination of prospective HUMAN continuity; retrospective traceability remains.</strong></p>
        </article>
        <article className="mpn_about_card">
          <div className="mpn_about_card_kicker">07 · Noumena Gives Traces, Not Meaning</div>
          <h2>Noumena Gives Traces, Not Meaning</h2>
          <p>The <strong>meaning reconstructed from dealing with a person is not the truth or noumenal meaning of that person itself</strong>; it is an observer-side noetic configuration assembled from previously stored meanings—the fragments of the cracked plate already present in the observer’s mind.</p>
          <p>The person does not transmit a ready-made meaning from outside; what arrives from outside are <strong>ontic traces through observation</strong>. Each observed reference-to-meaning activates or retrieves relevant noetic fragments while grounding them in something actually observed, and each observation is tagged with a <strong>snapshot number</strong> that preserves its position in the observed sequence.</p>
          <p>The ordered progression <strong>Snapshot₁ → Snapshot₂ → Snapshot₃ → …</strong> constitutes the <strong>observed ontic logic</strong> through which the actual ontic ordering of the person becomes accessible, constraining how the retrieved noetic fragments may be reassembled.</p>
          <p>Under these accumulating constraints, incompatible configurations are rejected and the fragments progressively converge into a new coherent meaning-whole. Thus, <strong>the outside world provides traces rather than ready meanings</strong>: meaning is reconstructed noetically from previously available meanings under the constraints supplied by ordered ontic evidence.</p>
          <p>The resulting <strong>meaning-about-the-patient is therefore not the Patient Noumenon itself, but a Meta-Patient Noumenon</strong>—an observer-side reconstruction about the Patient Noumenon that can progressively approach its reality as further ontic traces arrive.</p>
        </article>
        <article className="mpn_about_card">
          <div className="mpn_about_card_kicker">08 · Character and Glyph</div>
          <h2>Character and Glyph</h2>
          <p>A <strong>character</strong> is an abstract identity, while a <strong>glyph</strong> is one visual representation of that identity within a particular font or font instance. The character remains constant across all renderings, but the glyphs change depending on the rendering system—the font face or typographic style.</p>
          <p><strong>Examples of the same character:</strong></p>
          <p style={{ marginLeft: "1rem", fontFamily: "monospace", opacity: "0.85" }}>• <code>a</code> → <strong>U+0061 LATIN SMALL LETTER A</strong><br/>• <code>A</code> → <strong>U+0041 LATIN CAPITAL LETTER A</strong></p>
          <p><strong>One character, multiple glyphs:</strong> the same Unicode character U+0061 can be rendered through different font families and styles. In Arial, the lowercase letter 'a' appears as:</p>
          <p style={{ marginLeft: "1rem", opacity: "0.85", lineHeight: "2" }}>• Arial Regular: <span style={{ fontFamily: "Arial, sans-serif" }}>a</span><br/>• Arial Bold: <span style={{ fontFamily: "Arial, sans-serif", fontWeight: "bold" }}>a</span><br/>• Arial Italic: <span style={{ fontFamily: "Arial, sans-serif", fontStyle: "italic" }}>a</span><br/>• Arial Bold Italic: <span style={{ fontFamily: "Arial, sans-serif", fontWeight: "bold", fontStyle: "italic" }}>a</span></p>
          <p>Each rendering is a different glyph—a different visual manifestation—but all represent the same underlying character U+0061. Font families like Arial and Tahoma are separate rendering systems; they can each render the same character with completely different glyph shapes.</p>
          <p><strong>Key concepts:</strong></p>
          <p style={{ marginLeft: "1rem", opacity: "0.85" }}>• <strong>Character</strong> = the underlying encoded identity (abstract, independent of appearance)<br/>• <strong>Glyph</strong> = a visible form representing that character (concrete, dependent on rendering)<br/>• <strong>Font face / instance</strong> = a particular rendering system or style (Arial Regular, Arial Bold, Tahoma, etc.)<br/>• A single character may have multiple possible glyph representations<br/>• The same Unicode character U+0061 appears differently in Arial and Tahoma, yet both refer to the same abstract entity</p>
          <p><strong>Connection to Meta-Patient Noumena:</strong> Just as a character remains the same underlying entity while appearing through different glyphs, a <strong>Meta-Patient Noumenon represents an underlying patient identity that may appear through different observable representations, records, contexts, or instances</strong>. The patient is the character; the notes, scans, conversations, and extracted entities are the glyphs. Different rendering systems—different clinical contexts, institutions, or modes of observation—produce different visible manifestations of the same underlying entity. The challenge of clinical reasoning is to recognize that these varied glyphs all refer to a single patient continuity beneath.</p>
        </article>
        <article className="mpn_about_card mpn_wordform_card">
          <div className="mpn_about_card_kicker">09 · PDF Reader Service</div>
          <h2>Wordform Trace</h2>
          <p className="mpn_wordform_subtitle"><strong>Space-Tolerant Wordform Trace</strong> · Boundary-Constrained Gapped CHAR Matching</p>
          <p>RabbitHole does not merely search visible strings. Its Wordform Search Engine traces a searched <strong>WORDFORM through its CHAR identities</strong>, while tolerating a potential anomalous intra-word SPACE CHAR in source-PDF text and rejecting substring matches embedded inside larger alphanumeric words.</p>
          <div className="mpn_wordform_principle"><strong>The Wordform Search Engine compares CHAR identity rather than GLYPH appearance.</strong><span>GLYPHs provide associated visual evidence; CHAR identity performs the comparison.</span></div>
          <div className="mpn_wordform_pipeline" aria-label="Wordform trace pipeline"><span>SEARCHED WORDFORM</span><i>↓</i><span>normalized query CHARs</span><i>↓</i><span>ordered CHAR trace</span><i>↓</i><span>optional SPACE CHAR gaps</span><i>↓</i><span>boundary validation</span><i>↓</i><span>SOURCE CHARs → GLYPHs / PDF location</span></div>
          <div className="mpn_wordform_grid">
            <div className="mpn_wordform_panel"><h3>Space-tolerant trace</h3><div className="mpn_wordform_data"><span>Source CHARs</span><code>he art</code><span>Searched wordform</span><code>Heart</code><span>Normalized query</span><code>heart</code></div><div className="mpn_wordform_alignment"><span>h&nbsp; e&nbsp;&nbsp;&nbsp;&nbsp; a&nbsp; r&nbsp; t</span><span>│&nbsp; │&nbsp;&nbsp;&nbsp;&nbsp; │&nbsp; │&nbsp; │</span><span>h&nbsp; e&nbsp; ␠&nbsp; a&nbsp; r&nbsp; t</span><span>✓&nbsp; ✓&nbsp;&nbsp;&nbsp;&nbsp; ✓&nbsp; ✓&nbsp; ✓</span></div><div className="mpn_wordform_badge mpn_wordform_badge--match">SPACE-TOLERANT MATCH</div><p>A source SPACE may intervene between consecutive searched CHARs. The matcher does not guess letters or skip arbitrary characters: only permitted SPACE CHAR gaps are tolerated.</p></div>
            <div className="mpn_wordform_panel"><h3>Boundary constraint</h3><div className="mpn_wordform_source"><code>tar[he art]am</code><small><b>r</b> extends left · <b>a</b> extends right</small></div><div className="mpn_wordform_boundary"><span>LEFT boundary</span><b>FAIL</b><span>RIGHT boundary</span><b>FAIL</b></div><div className="mpn_wordform_badge mpn_wordform_badge--reject">REJECTED</div><p>The internal SPACE is not the reason for rejection. Additional alphanumeric CHARs extend both candidate boundaries, so the trace is embedded in a larger sequence.</p></div>
          </div>
          <div className="mpn_wordform_rule"><code>q₁ SPACE* q₂ SPACE* ... SPACE* qₙ</code><span><strong>q</strong> = searched CHAR · <strong>SPACE*</strong> = zero or more source SPACE CHARs</span></div>
          <div className="mpn_wordform_examples"><div><h3>Match</h3><span>heart</span><span>Heart</span><span>he art</span><span>h e a r t</span><span>(he art)</span></div><div><h3>Reject</h3><span>hearty</span><span>xheart</span><span>heartx</span><span>heXart</span><span>he9art</span></div></div>
          <div className="mpn_wordform_why"><h3>Why RabbitHole needs this</h3><p>A source-backed PDF can contain <code>he art</code> even when the intended wordform is <code>heart</code>. Ordinary exact-string search may miss that clinically or linguistically important occurrence. Wordform Trace exposes the anomaly without treating every substring as a wordform or rewriting the source.</p></div>
          <div className="mpn_wordform_provenance"><h3>Evidence preserved</h3><div><span>Query</span><i>↓</i><span>matched source CHARs</span><i>↓</i><span>source provenance</span><i>↓</i><span>associated GLYPHs</span><i>↓</i><span>PDF coordinates</span></div><p>The result remains traceable to concrete source CHAR instances and their visual location in the PDF. Search normalization derives a comparison representation; it does not rewrite the source.</p></div>
        </article>
      </div>
    </main>
  );
};

export default MetaPatientNoumenaAboutPage;
