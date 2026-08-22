import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./faqPage.css";
import { buildCanonicalFaqItems } from "../ontology/amctoshsOntology";

const FAQ_STORAGE_KEY = "amctoshs_faq_edits";

// Legacy editable content retained only as a migration reference. New
// ontology-facing FAQ content comes from the canonical ontology registry
// below; user edits in localStorage still override canonical defaults.
const LEGACY_FAQ_ITEMS = [
  {
    id: "amctoshs",
    question: "What is RabbitHole?",
    answer: "<p><strong>RabbitHole</strong> is a framework for representing the <strong>reality of the patient</strong> through two dimensions of representation:</p><p><strong>3D Reality</strong> — the patient’s spatial configuration: the organization, position, structure, and intrinsic relations of the patient’s constituents at a particular state. What can be distinguished in this 3D reality depends on the Mode of Access, from Humans down to Atoms.</p><p><strong>4D Reality</strong> — the patient’s <strong>change</strong>: the continuity of the patient’s identity across distinct 3D realities. In RabbitHole, the fourth dimension is not time itself, but <strong>change in spatial configuration while identity is preserved</strong>.</p>",
  },
  {
    id: "awareness",
    question: "What is awareness in RabbitHole?",
    answer: "<p>In RabbitHole, <strong>awareness belongs to 3D Reality</strong>. A 3D Reality contains <strong>identity + state</strong>: the Self exists as a particular spatial configuration with particular structures, traces, conditions, and relations. Awareness arises within this state because the Self can distinguish one thing from another and establish selective relations with Hyle. Awareness therefore requires limitation and differentiation: something becomes an object of awareness only when it is distinguished from what it is not. In this sense, <strong>awareness begins with distinction</strong>. If everything were given simultaneously without boundaries, contrast, foreground, background, or differentiation, nothing could be specifically identified; therefore, <strong>to be aware of everything without distinction is functionally to be aware of nothing</strong>.</p><p><strong>4D Reality does not itself possess awareness because, in RabbitHole, 4D contains identity without any particular state.</strong> The different states belong to the distinct 3D Realities; what remains invariant through their changes is only the identity that relates them as realities of the same patient. Thus, while each 3D Reality can be expressed as <strong>identity + state</strong>, 4D Reality represents <strong>identity through change</strong>, independent of any single state. Since awareness requires a particular state from which distinctions and relations can be established, awareness can occur only within a 3D Reality, not in the state-independent identity of 4D Reality. Therefore, <strong>3D = identity + state → distinction → awareness</strong>, whereas <strong>4D = identity through change → continuity, without a particular state and therefore without awareness</strong>.</p>",
  },
  {
    id: "identity-state-reality",
    question: "What are Identity, State, and Reality in RabbitHole?",
    answer: "<p>In RabbitHole, a particular <strong>3D Reality</strong> can be represented as <strong>Identity + State</strong>. The <strong>State</strong> includes everything that can vary in a given 3D configuration—such as position, structure, traces, conditions, and spatial relations—whereas <strong>Identity</strong> is what remains attributable to the same patient across those variations. Conceptually, <strong>Identity = Reality − State</strong>: when the particular state is abstracted from a Reality, what remains is the identity that unifies its different manifestations.</p><p>Accordingly, successive 3D Realities may have different states while preserving the same identity:</p><p><strong>Reality₁ = Identity + State₁</strong><br /><strong>Reality₂ = Identity + State₂</strong><br /><strong>Reality₃ = Identity + State₃</strong></p><p>where <strong>State₁ ≠ State₂ ≠ State₃</strong>, while <strong>Identity remains invariant</strong>. Thus, <strong>State differentiates Realities, while Identity unifies them</strong>. In this sense, <strong>3D Reality is Identity in a particular State, whereas 4D Reality is Identity across the change of States, without privileging any single State</strong>.</p><p>At the level of the complete 4D Reality, <strong>no further change remains outside the totality of the patient’s states</strong>: all states are included in the identity’s full trajectory, so there is no remaining state to change into. In this sense, <strong>no change means full identity</strong>; 4D identity is stable because it contains the complete continuity of the patient across all states.</p>",
  },
  {
    id: "hyle",
    question: "What does “Hyle” mean, and what is the Hyle of RabbitHole?",
    answer: "<strong>Hyle</strong> means the matter or given reality that exists prior to our organization or understanding of it. In RabbitHole, <strong>Hyle is the field of objects as they exist intrinsically, before the Self has established relations with them</strong>. In RabbitHole, <strong>Hyle is the object of study: that which is given to the Self before and during investigation</strong>. Through studying Hyle—its instantiations, traces, and intrinsic relations—the Self constructs Schemas. A textbook illustrates this well: before I read it, the book and the relations represented within it exist independently of me; they are intrinsic to the object and its content. When I begin studying it, I progressively establish relations with its linguistic referrals to <strong>schemas, traces, instantiations, and their intrinsic relations</strong>. The book itself has not changed; what changes is its relation to me—it becomes an <strong>extrinsic object of my access, study, understanding, and memory</strong>.",
  },
  {
    id: "schema",
    question: "What does “Schema” mean, and what is the Schema of RabbitHole?",
    answer: "<strong>Schema</strong> means an organized form or structure through which something can be represented and recognized. In RabbitHole, a <strong>Schema is a noetic structure produced by the Self through the study of objects</strong>. By observing and comparing instantiations, their traces, and their intrinsic relations, the Self abstracts what is common and organizes it into a Schema. A Schema is therefore <strong>not an object itself and does not exist inside the object</strong>; it is the result of studying objects. Once formed, it can be used to recognize new instantiations, interpret traces and relations, and understand the linguistic references encountered in a textbook or other source.",
  },
  {
    id: "study",
    question: "What does “To Study” mean in RabbitHole?",
    answer: "<strong>Study</strong> is the Self’s active relational engagement with Hyle, the object of study, through which the Self establishes extrinsic relations with what is already intrinsic to Hyle—its linguistic references, instantiations, traces, and intrinsic relations. <strong>Study does not create those intrinsic relations; they belong to Hyle independently of the Self.</strong> Rather, through Study, the Self accesses, distinguishes, compares, and relates to these intrinsic structures, progressively organizing what is accessed into Schemas and thereby transforming an initially unrelated object of study into one with which the Self has established meaningful extrinsic relations.",
  },
  {
    id: "first-step-study-text",
    question: "What is the first step of studying a text?",
    answer: "<strong>Extract linguistic references.</strong>",
  },
  {
    id: "independence",
    question: "Are Hyle and Schema independent or dependent?",
    answer: "<p><strong>Hyle is independent.</strong> It is the object of study and exists independently of whether the Self accesses, studies, understands, or represents it. Its instantiations, traces, and intrinsic relations do not depend on the Self’s knowledge of them. Study does not produce Hyle; it only establishes an extrinsic relation between the Self and Hyle.</p><p><strong>Schema is dependent.</strong> A Schema is a noetic organization produced through Study and therefore depends on both <strong>Hyle</strong> and the <strong>a priori structures of the Self</strong>. Hyle provides the independent object of study—its instantiations, traces, and intrinsic relations—while the a priori provides the prior conditions through which the Self can access, distinguish, compare, relate, and organize what is encountered. Hyle can exist without a Schema, but a Schema cannot arise independently of either what is studied or the conditions that make Study possible. Even when a Schema is encountered through a textbook, its linguistic representation ultimately refers to structures abstracted from prior study of Hyle. In short: <strong>Hyle is independent reality; a priori is the precondition of Study; Schema is the dependent noetic result of their interaction through Study.</strong></p>",
  },
  {
    id: "death",
    question: "What is the RabbitHole Death?",
    answer: "<p><strong>Life</strong> is the succession of distinct 3D slices through time in which <strong>change occurs while the patient’s identity is preserved</strong>. Each slice differs from the preceding one because the patient’s traces, states, structures, and relations may change, yet these changing slices remain continuously attributable to the same patient. Life is therefore not the absence of change, but the <strong>preservation of identity through change</strong> across the patient’s 4D trajectory.</p><p><strong>Death</strong> is the termination of this identity-preserving succession. At death, the patient ceases to generate further distinct 3D slices in which change occurs while the same living patient identity is preserved. The final patient-specific 3D slice therefore becomes the terminal slice of that patient’s living 4D trajectory. In this sense, <strong>Life is identity preserved through successive change; Death is the point at which that succession of identity-through-change ends.</strong></p>",
    arabicAnswer: "<p><strong>الحياة</strong> في RabbitHole هي تعاقبٌ زمني لشرائح ثلاثية الأبعاد متميزة، يحدث خلالها <strong>التغيّر مع استمرار هوية المريض محفوظة عبر هذا التغيّر</strong>. فكل شريحة ثلاثية الأبعاد تختلف عن سابقتها نتيجة تغيّر حالات المريض وآثاره وبُناه وعلاقاته، إلا أن جميع هذه الشرائح تظل منسوبة إلى المريض ذاته ضمن مساره رباعي الأبعاد. وعليه، لا تُعرَّف الحياة بغياب التغيّر، بل بـ <strong>استمرارية الهوية عبر سلسلة من التغيّرات المتعاقبة</strong>.</p><p><strong>الموت</strong> هو انقطاع هذا التعاقب الذي تُحفَظ فيه هوية المريض عبر التغيّر. فعند الموت، يتوقف ظهور شرائح ثلاثية الأبعاد لاحقة تمثّل حالات متغيّرة مع استمرار هوية المريض الحي، وتصبح آخر شريحة ثلاثية الأبعاد خاصة به هي <strong>الشريحة النهائية في مساره الحياتي رباعي الأبعاد</strong>. وبذلك يمكن تلخيص العلاقة بالقول: <strong>الحياة هي استمرار الهوية عبر التغيّر، والموت هو انتهاء هذا الاستمرار التعاقبي للهوية عبر التغيّر.</strong></p>",
  },
];

const FAQ_ITEMS = buildCanonicalFaqItems();

const readSavedFaq = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(FAQ_STORAGE_KEY) || "{}");
    return Object.fromEntries(FAQ_ITEMS.map((item) => [item.id, {
      question: saved[item.id]?.question || item.question,
      answer: saved[item.id]?.answer || item.answer,
    }]));
  } catch {
    return Object.fromEntries(FAQ_ITEMS.map((item) => [item.id, { question: item.question, answer: item.answer }]));
  }
};

const FAQPage = () => {
  const navigate = useNavigate();
  const [entries, setEntries] = useState(readSavedFaq);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(null);

  useEffect(() => {
    localStorage.setItem(FAQ_STORAGE_KEY, JSON.stringify(entries));
  }, [entries]);

  const startEditing = (event, item) => {
    event.preventDefault();
    event.stopPropagation();
    setEditingId(item.id);
    setDraft(entries[item.id]);
  };

  const saveEditing = (event, item) => {
    event.preventDefault();
    event.stopPropagation();
    setEntries((previous) => ({ ...previous, [item.id]: draft }));
    setEditingId(null);
    setDraft(null);
  };

  const cancelEditing = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setEditingId(null);
    setDraft(null);
  };

  const resetEntry = (event, item) => {
    event.preventDefault();
    event.stopPropagation();
    setEntries((previous) => ({ ...previous, [item.id]: { question: item.question, answer: item.answer } }));
    setEditingId(null);
    setDraft(null);
  };

  return (
    <main id="faq_page">
      <header id="faq_header">
        <button type="button" id="faq_back" onClick={() => navigate(-1)} aria-label="Go back">←</button>
        <div>
          <span id="faq_eyebrow">RabbitHole</span>
          <h1>Frequently Asked Questions</h1>
        </div>
      </header>

      <div id="faq_scroll">
        <section id="faq_intro" aria-labelledby="faq_intro_title">
          <span>Concepts and foundations</span>
          <h2 id="faq_intro_title">Understanding RabbitHole</h2>
          <p>Answers to common questions about the language, concepts, and architecture of RabbitHole.</p>
        </section>

        <section id="faq_list" aria-label="Frequently asked questions">
          {FAQ_ITEMS.map((item, index) => {
            const entry = entries[item.id];
            const editing = editingId === item.id;
            const currentDraft = editing ? draft : entry;
            return (
              <details className="faq_item" open={index === 0} key={item.id}>
                <summary>
                  <span className="faq_number">{String(index + 1).padStart(2, "0")}</span>
                  {editing ? (
                    <input
                      className="faq_question_editor"
                      value={currentDraft.question}
                      onChange={(event) => setDraft((previous) => ({ ...previous, question: event.target.value }))}
                      onClick={(event) => event.stopPropagation()}
                      aria-label="FAQ question"
                    />
                  ) : <span>{entry.question}</span>}
                  <span className="faq_summary_actions">
                    {editing ? (
                      <>
                        <button type="button" className="faq_action faq_action--save" onClick={(event) => saveEditing(event, item)}>Save</button>
                        <button type="button" className="faq_action" onClick={cancelEditing}>Cancel</button>
                      </>
                    ) : (
                      <button type="button" className="faq_action" onClick={(event) => startEditing(event, item)}>Edit</button>
                    )}
                    <i className="fi fi-rr-angle-small-down" aria-hidden="true" />
                  </span>
                </summary>
                <div className="faq_answer">
                  {editing ? (
                    <>
                      <div
                        className="faq_answer_editor"
                        contentEditable
                        suppressContentEditableWarning
                        dangerouslySetInnerHTML={{ __html: currentDraft.answer }}
                        onInput={(event) => setDraft((previous) => ({ ...previous, answer: event.currentTarget.innerHTML }))}
                        aria-label="FAQ answer"
                        role="textbox"
                        aria-multiline="true"
                      />
                      <button type="button" className="faq_reset_button" onClick={(event) => resetEntry(event, item)}>Reset original</button>
                    </>
                  ) : item.arabicAnswer ? (
                    <div className="faq_bilingual_answer">
                      <div className="faq_english_answer" dangerouslySetInnerHTML={{ __html: entry.answer }} />
                      <div className="faq_arabic" dir="rtl" lang="ar" dangerouslySetInnerHTML={{ __html: item.arabicAnswer }} />
                    </div>
                  ) : <div dangerouslySetInnerHTML={{ __html: entry.answer }} />}
                </div>
              </details>
            );
          })}
        </section>
      </div>
    </main>
  );
};

export default FAQPage;
