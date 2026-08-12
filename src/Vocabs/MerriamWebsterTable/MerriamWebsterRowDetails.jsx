const JsonBlock = ({ value }) => {
  if (value === undefined || value === null || (Array.isArray(value) && value.length === 0)) return <span className="mw_detail_empty">—</span>;
  return <pre>{JSON.stringify(value, null, 2)}</pre>;
};

const TextList = ({ values }) => (
  Array.isArray(values) && values.length
    ? <ul>{values.map((value, index) => <li key={`${String(value)}-${index}`}>{String(value)}</li>)}</ul>
    : <span className="mw_detail_empty">—</span>
);

export default function MerriamWebsterRowDetails({ row }) {
  return (
    <div className="mw_row_details">
      <section><h4>Entry metadata</h4><dl><dt>Entry ID</dt><dd>{row.entryId || "—"}</dd><dt>UUID</dt><dd>{row.uuid || "—"}</dd><dt>Homograph</dt><dd>{row.homograph ?? "—"}</dd><dt>Source</dt><dd>{row.source || "—"}</dd><dt>Section</dt><dd>{row.section || "—"}</dd><dt>Stems</dt><dd>{row.stems?.length ? row.stems.join(", ") : "—"}</dd><dt>Offensive</dt><dd>{row.offensive ? "Yes" : "No"}</dd></dl><JsonBlock value={{ sort: row.entrySort, alternateHeadwords: row.alternateHeadwords }} /></section>
      <section><h4>Pronunciations</h4><TextList values={row.pronunciation} /><JsonBlock value={row.pronunciationDetails} /></section>
      <section><h4>Variants and inflections</h4><JsonBlock value={{ variants: row.variants, inflections: row.inflections }} /></section>
      <section><h4>Labels and grammar</h4><JsonBlock value={{ subjectStatusLabels: row.subjectStatusLabels, usageLabels: row.usageLabels, grammar: row.grammar }} /></section>
      <section><h4>Definition components</h4><JsonBlock value={{ components: row.definitionComponents, dividedSense: row.dividedSense, dividedComponents: row.dividedDefinitionComponents, notes: row.definitionNotes, supplemental: row.supplementalDefinitions }} /></section>
      <section><h4>Examples</h4><JsonBlock value={row.exampleDetails?.length ? row.exampleDetails : row.examples} /></section>
      <section><h4>History and notes</h4><JsonBlock value={{ etymology: row.etymology, firstKnownUse: row.firstKnownUse, usages: row.usages, synonymDiscussion: row.synonymDiscussion, quotes: row.quotes, crossReferences: row.crossReferences, directionalCrossReferences: row.directionalCrossReferences, artwork: row.artwork, tables: row.tables }} /></section>
      <section><h4>Run-ons and derived forms</h4><JsonBlock value={{ runOnPhrase: row.runOnPhrase, runOns: row.runOns, derivedForms: row.derivedForms }} /></section>
      <section className="mw_detail_wide"><h4>Source path</h4><code>{row.sourcePath}</code></section>
      <details className="mw_detail_wide"><summary>Raw sense JSON</summary><JsonBlock value={row.rawSense} /></details>
      <details className="mw_detail_wide"><summary>Raw entry JSON</summary><JsonBlock value={row.rawEntry} /></details>
    </div>
  );
}
