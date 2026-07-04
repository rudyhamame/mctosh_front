import React from "react";
import "./portfolioPage.css";

const CLINICAL = [
  {
    title: "Surgery Observership",
    org: "Lattakia University",
    loc: "Latakia, Syria",
    dates: "Sept 2024 – Sept 2025",
    bullets: [
      "Observed surgical procedures and operating room workflow, including pre-operative assessment, intra-operative protocols, and post-operative handover.",
      "Noted multidisciplinary coordination and perioperative safety processes.",
    ],
  },
  {
    title: "Internal Medicine Observership",
    org: "Lattakia University",
    loc: "Latakia, Syria",
    dates: "Sept 2024 – Sept 2025",
    bullets: [
      "Shadowed attendings and residents during ward rounds on General Internal Medicine wards.",
      "Observed inpatient assessments, diagnostic reasoning, case presentations, management and discharge planning.",
      "Noted multidisciplinary coordination, medication reconciliation, and common internal-medicine workflows.",
    ],
  },
  {
    title: "Pharmacy Assistant Training",
    org: "PG Gateway Pharmacy",
    loc: "Prince George, BC",
    dates: "Jan 2018 – Mar 2018",
    bullets: [
      "Supported prescription processing and safe dispensing in a community pharmacy.",
      "Managed labeling, inventory, documentation, and patient guidance.",
    ],
  },
];

const VOLUNTEER = [
  {
    title: "Center Supporter Volunteer",
    org: "BC Cancer Centre for the North",
    loc: "Prince George, BC",
    dates: "Nov 2017 – Nov 2018",
    bullets: [
      "Supported oncology patients with refreshments and general assistance.",
      "Engaged in patient interaction within a clinical care environment.",
      "Played piano for patients as part of supportive, non-clinical engagement.",
    ],
  },
  {
    title: "Administrative Office Assistant Volunteer",
    org: "Heart and Stroke Foundation",
    loc: "Prince George, BC",
    dates: "Apr 2018 – Aug 2018",
    bullets: [
      "Data entry and administrative support.",
      "Assisted in organizing school visits and fundraising events.",
    ],
  },
];

const WORK = [
  { title: "Team Leader",  org: "Wendy's",      loc: "Prince George, BC", dates: "Feb 2019 – May 2021" },
  { title: "Team Member",  org: "Mary Brown's", loc: "Hamilton, ON",      dates: "Dec 2018 – Feb 2019" },
  { title: "Team Member",  org: "Karma Candy",  loc: "Hamilton, ON",      dates: "Nov 2017 – Jan 2018" },
];

const EDUCATION = [
  { degree: "Doctor of Medicine (MD)",  inst: "Latakia University (formerly Tishreen University)", loc: "Latakia, Syria",  dates: "2013 – 2025" },
  { degree: "Computer Science Courses", inst: "York University",                                   loc: "Toronto, ON",     dates: "2020 – 2021" },
  { degree: "Biomedical Sciences Courses", inst: "York University",                                loc: "Toronto, ON",     dates: "2019 – 2021" },
];

const TECH = ["React", "Vite", "Express.js", "Node.js", "MongoDB", "JavaScript", "TypeScript", "HTML", "CSS"];

const ExpItem = ({ title, org, loc, dates, bullets }) => (
  <div className="pf_exp_item">
    <div className="pf_exp_header">
      <span className="pf_exp_title">{title}</span>
      <span className="pf_exp_dates">{dates}</span>
    </div>
    <div className="pf_exp_org">{org} — {loc}</div>
    {bullets && (
      <ul className="pf_exp_bullets">
        {bullets.map((b, i) => <li key={i}>{b}</li>)}
      </ul>
    )}
  </div>
);

const PortfolioPage = () => (
  <div id="pf_page">

    {/* ─── Hero ─── */}
    <header id="pf_hero">
      <img id="pf_photo" src={`${import.meta.env.BASE_URL}photo.jpg`} alt="Rudy Hamame" />
      <h1 id="pf_name">Rudy Hamame</h1>
      <p id="pf_title">International Medical Graduate &middot; Full-Stack Developer</p>
      <a id="pf_resume_btn" href={`${import.meta.env.BASE_URL}resume.pdf`} download="Rudy_Hamame_Resume.pdf">
        Download Resume
      </a>

      <div id="pf_links">
        <a href="mailto:rudyhamameca@gmail.com" className="pf_link">rudyhamameca@gmail.com</a>
        <a href="tel:4165433399" className="pf_link">(416) 543-3399</a>
        <a href="https://www.linkedin.com/in/rudyhamame" target="_blank" rel="noopener noreferrer" className="pf_link">LinkedIn</a>
        <a href="https://github.com/rudyhamame" target="_blank" rel="noopener noreferrer" className="pf_link">GitHub</a>
        <a href="https://www.mctoshs.ca" target="_blank" rel="noopener noreferrer" className="pf_link">mctoshs.ca</a>
      </div>
    </header>

    <main id="pf_main">

      {/* ─── About ─── */}
      <section className="pf_section">
        <h2 className="pf_section_title">About</h2>
        <p className="pf_body">
          Canadian citizen and International Medical Graduate (MD, Dec 2025) with hands-on clinical
          training across internal medicine, surgery, pediatrics, obstetrics &amp; gynecology, and
          emergency medicine. Proven at delivering patient-centred care and supporting
          multidisciplinary teams through hospital clinical exposure and volunteer work at BC Cancer
          Centre and the Heart &amp; Stroke Foundation.
        </p>
        <p className="pf_body" style={{ marginTop: "0.75rem" }}>
          Seeking clinical or medically related roles while preparing for CaRMS. Also experienced in
          full-stack web development and prototype development to build healthcare-focused tools.
        </p>
      </section>

      {/* ─── Projects ─── */}
      <section className="pf_section">
        <h2 className="pf_section_title">Projects</h2>
        <div className="pf_project_card">
          <div className="pf_project_header">
            <span className="pf_project_name">MCTOSHS</span>
            <span className="pf_project_date">2020 – Present</span>
          </div>
          <p className="pf_body">
            A clinical learning platform that teaches medical students to interpret clinical
            materials by separating patient processes from diagnostic concepts. Lead developer
            and product owner, responsible for design, implementation, and deployment.
          </p>
          <ul className="pf_project_bullets">
            <li>Primary audience: medical students — case-based curriculum to improve clinical reasoning</li>
            <li>Built AI-assisted extraction pipeline for PDFs, lectures, and clinical texts with SSE streaming chat</li>
            <li>Implemented full-stack application (React + Vite frontend; Express/Node.js + MongoDB backend)</li>
            <li>Integrated multiple AI providers (OpenAI, Groq, Ollama, Gemini) to improve answer fidelity and latency</li>
            <li>Owned UX, feature prioritization, and prototype-to-deployment workflow</li>
          </ul>
          <div className="pf_tech_tags">
            {TECH.map(t => <span key={t} className="pf_tag">{t}</span>)}
          </div>
          <div className="pf_project_links">
            <a href="https://www.mctoshs.ca" target="_blank" rel="noopener noreferrer" className="pf_project_link">mctoshs.ca</a>
            <a href="https://github.com/rudyhamame" target="_blank" rel="noopener noreferrer" className="pf_project_link pf_project_link--ghost">GitHub</a>
          </div>
        </div>
      </section>

      {/* ─── Skills ─── */}
      <section className="pf_section">
        <h2 className="pf_section_title">Skills</h2>
        <div className="pf_skills_grid">
          <div className="pf_skill_group">
            <div className="pf_skill_group_title">Technical</div>
            <ul className="pf_skill_list">
              <li>Full-stack web development</li>
              <li>React.js, Vite, TypeScript, JavaScript</li>
              <li>Express.js, Node.js, MongoDB</li>
              <li>HTML &amp; CSS</li>
              <li>Software prototyping</li>
              <li>Data structuring &amp; conceptual modeling</li>
            </ul>
          </div>
          <div className="pf_skill_group">
            <div className="pf_skill_group_title">Clinical &amp; People</div>
            <ul className="pf_skill_list">
              <li>Patient-facing communication</li>
              <li>Team collaboration</li>
              <li>Administrative support &amp; data entry</li>
              <li>Community engagement &amp; event support</li>
            </ul>
          </div>
          <div className="pf_skill_group">
            <div className="pf_skill_group_title">Analytical</div>
            <ul className="pf_skill_list">
              <li>Systems thinking</li>
              <li>Problem solving</li>
              <li>Independent project leadership</li>
            </ul>
          </div>
          <div className="pf_skill_group">
            <div className="pf_skill_group_title">Languages</div>
            <ul className="pf_skill_list">
              <li>Arabic — Native</li>
              <li>English — Professional</li>
            </ul>
          </div>
        </div>
      </section>

      {/* ─── Experience ─── */}
      <section className="pf_section">
        <h2 className="pf_section_title">Experience</h2>

        <div className="pf_exp_group_label">Clinical Training</div>
        {CLINICAL.map((e, i) => <ExpItem key={i} {...e} />)}

        <div className="pf_exp_group_label pf_exp_group_label--spaced">Volunteer</div>
        {VOLUNTEER.map((e, i) => <ExpItem key={i} {...e} />)}

        <div className="pf_exp_group_label pf_exp_group_label--spaced">Work</div>
        {WORK.map((e, i) => (
          <div key={i} className="pf_exp_item pf_exp_item--compact">
            <div className="pf_exp_header">
              <span className="pf_exp_title">{e.title}</span>
              <span className="pf_exp_dates">{e.dates}</span>
            </div>
            <div className="pf_exp_org">{e.org} — {e.loc}</div>
          </div>
        ))}
      </section>

      {/* ─── Education ─── */}
      <section className="pf_section">
        <h2 className="pf_section_title">Education</h2>
        {EDUCATION.map((e, i) => (
          <div key={i} className="pf_edu_item">
            <div className="pf_edu_degree">{e.degree}</div>
            <div className="pf_edu_meta">{e.inst} — {e.loc} &middot; {e.dates}</div>
          </div>
        ))}
      </section>

      {/* ─── Awards ─── */}
      <section className="pf_section">
        <h2 className="pf_section_title">Awards</h2>
        <div className="pf_edu_item">
          <div className="pf_edu_degree">Lifetime Member — Golden Key International Honour Society</div>
          <div className="pf_edu_meta">York University — Toronto, ON &middot; 2019</div>
        </div>
      </section>

      {/* ─── Interests ─── */}
      <section className="pf_section">
        <h2 className="pf_section_title">Interests</h2>
        <div className="pf_tech_tags">
          {["Amateur Pianist", "Vocalist", "Clinical Epistemology", "Medical Modeling", "Full-Stack Development"].map(t => (
            <span key={t} className="pf_tag">{t}</span>
          ))}
        </div>
      </section>

      {/* ─── Contact ─── */}
      <section className="pf_section">
        <h2 className="pf_section_title">Contact</h2>
        <div className="pf_contact_grid">
          <a href="mailto:rudyhamameca@gmail.com" className="pf_contact_item">
            <span className="pf_contact_label">Email</span>
            <span className="pf_contact_value">rudyhamameca@gmail.com</span>
          </a>
          <a href="tel:4165433399" className="pf_contact_item">
            <span className="pf_contact_label">Phone</span>
            <span className="pf_contact_value">(416) 543-3399</span>
          </a>
          <a href="https://www.linkedin.com/in/rudyhamame" target="_blank" rel="noopener noreferrer" className="pf_contact_item">
            <span className="pf_contact_label">LinkedIn</span>
            <span className="pf_contact_value">linkedin.com/in/rudyhamame</span>
          </a>
          <a href="https://github.com/rudyhamame" target="_blank" rel="noopener noreferrer" className="pf_contact_item">
            <span className="pf_contact_label">GitHub</span>
            <span className="pf_contact_value">github.com/rudyhamame</span>
          </a>
        </div>
      </section>

    </main>

    <footer id="pf_footer">
      Rudy Hamame &middot; {new Date().getFullYear()}
    </footer>

  </div>
);

export default PortfolioPage;
