import React, { useEffect, useMemo, useState } from "react";
import { normalizeAtom, normalizeConcept, normalizeDefinition } from "./umlsClient";
import { readUmlsLanguage, UMLS_LANGUAGE_CHANGE_EVENT } from "./umlsSettings";
import { expandUmlsTermType } from "./umlsTermTypes";
import "./umlsConceptTable.css";

const uniqueBy = (values, keyOf) => {
  const seen = new Set();
  return values.filter((value) => {
    const key = keyOf(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const definitionForAtom = (definitions, atom) => {
  const atomSource = String(atom.rootSource || "").toUpperCase();
  const atomLanguage = String(atom.language || "").toUpperCase();
  if (!atomSource) return "—";

  const matches = definitions.filter((definition) => {
    if (String(definition.rootSource || "").toUpperCase() !== atomSource) return false;
    const definitionLanguage = String(definition.language || "").toUpperCase();
    return !definitionLanguage || !atomLanguage || definitionLanguage === atomLanguage;
  });

  return uniqueBy(matches, (definition) => definition.value)
    .map((definition) => definition.value)
    .join("\n") || "—";
};

const MiniTable = ({ title, columns, rows, empty }) => (
  <section className="umls_card_section">
    <h3>{title}</h3>
    <div className="umls_card_table_wrap">
      <table>
        <thead><tr>{columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead>
        <tbody>
          {rows.length ? rows.map((row, index) => (
            <tr key={row.key || index}>{columns.map((column) => <td key={column.key}>{row[column.key] || "—"}</td>)}</tr>
          )) : <tr><td className="umls_card_empty" colSpan={columns.length}>{empty}</td></tr>}
        </tbody>
      </table>
    </div>
  </section>
);

export default function UmlsConceptTable({ items = [], entryIndexById }) {
  const [language, setLanguage] = useState(() => readUmlsLanguage());

  useEffect(() => {
    const syncLanguage = (event) => setLanguage(event?.detail?.language || readUmlsLanguage());
    window.addEventListener(UMLS_LANGUAGE_CHANGE_EVENT, syncLanguage);
    window.addEventListener("storage", syncLanguage);
    return () => {
      window.removeEventListener(UMLS_LANGUAGE_CHANGE_EVENT, syncLanguage);
      window.removeEventListener("storage", syncLanguage);
    };
  }, []);

  const cards = useMemo(() => items.map((item, index) => {
    const savedConcept = item.umls || item.umlsData?.result || item.umlsResponse?.result || {};
    const concept = normalizeConcept({ ...savedConcept, name: savedConcept.name || item.word });
    const resources = savedConcept.resources || {};
    const definitions = (resources.definitions?.items || []).map(normalizeDefinition).filter((definition) => definition.value);
    const atoms = (resources.atoms?.items || [])
      .map(normalizeAtom)
      .filter((atom) => atom.name && String(atom.language || "").toUpperCase() === language);
    const entryIndex = entryIndexById?.get(item.id) ?? index;
    const semanticType = concept.semanticTypes.map((type) => type.name || type.tui).filter(Boolean).join(", ");
    const conceptRows = [{
      key: `${concept.cui || item.id}-concept`,
      cui: concept.cui,
      concept: concept.preferredName,
      semanticType,
    }];
    const variations = uniqueBy(atoms, (atom) => atom.aui || String(atom.name))
      .map((atom) => ({
        key: atom.aui || atom.name,
        aui: atom.aui,
        string: atom.name,
        language: atom.language,
        termType: expandUmlsTermType(atom.termType),
        definition: definitionForAtom(definitions, atom),
      }));

    return {
      key: item.id || concept.cui || item.word,
      id: `vocab#${String(entryIndex + 1).padStart(2, "0")}`,
      entry: item.word || "Untitled",
      conceptRows,
      variations,
      hasUmls: Boolean(concept.cui && atoms.length),
    };
  }), [items, entryIndexById, language]);

  if (!cards.length) return <p className="umls_cards_empty">No vocabulary entries match this view.</p>;

  return (
    <div className="umls_card_grid">
      {cards.map((card, cardIndex) => (
        <article className={`umls_vocab_card${card.hasUmls ? "" : " umls_vocab_card--empty"}`} key={card.key}>
          <span className="umls_card_counter" aria-label={`Card ${cardIndex + 1}`}>
            {String(cardIndex + 1).padStart(2, "0")}
          </span>
          <div className="umls_card_top_row">
            <table className="umls_card_identity">
              <thead><tr><th>ID</th><th>Entry</th></tr></thead>
              <tbody><tr><td><code>{card.id}</code></td><td><strong>{card.entry}</strong></td></tr></tbody>
            </table>
            <MiniTable
              title="Concepts"
              columns={[
                { key: "cui", label: "CUI" },
                { key: "concept", label: "Concept" },
                { key: "semanticType", label: "Semantic Type" },
              ]}
              rows={card.hasUmls ? card.conceptRows : []}
              empty="No UMLS concept found."
            />
          </div>
          <div className="umls_card_bottom_row">
            <MiniTable
              title="Variation"
              columns={[
                { key: "aui", label: "AUI" },
                { key: "string", label: "String" },
                { key: "language", label: "Language" },
                { key: "termType", label: "Term Type" },
                { key: "definition", label: "Definition" },
              ]}
              rows={card.variations}
              empty="No string variations available."
            />
          </div>
        </article>
      ))}
    </div>
  );
}
