import React, { useState } from "react";
import { apiUrl } from "../config/api";
import { lookupDictionaryWord } from "../utils/dictionarySettings";
import { readStoredSession } from "../utils/sessionCleanup";
import { listSavedVocabulary, saveVocabulary } from "../utils/vocabApi";
import "./vocabLookup.css";

const normalizedTerm = (value) => String(value || "").normalize("NFKC").trim().toLocaleLowerCase();

const VocabLookup = ({ compact = false, onSaved }) => {
  const [term, setTerm] = useState("");
  const [result, setResult] = useState(null);
  const [matches, setMatches] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [busy, setBusy] = useState(false);
  const [savingCandidate, setSavingCandidate] = useState("");
  const [error, setError] = useState("");
  const [targetLanguage, setTargetLanguage] = useState("French");

  const search = async (event) => {
    event.preventDefault();
    const value = term.trim();
    if (!value || busy || savingCandidate) return;
    setBusy(true);
    setError("");
    setResult(null);
    setMatches([]);
    setCandidates([]);
    try {
      const data = await listSavedVocabulary();
      const saved = Array.isArray(data.saved) ? data.saved : [];
      const key = normalizedTerm(value);
      const exact = saved.find((item) => normalizedTerm(item.word) === key);
      if (exact && (exact.translation || exact.definitions?.length)) {
        setResult(exact);
        return;
      }
      const related = saved.filter((item) => normalizedTerm(item.word).includes(key) || key.includes(normalizedTerm(item.word))).slice(0, 6);
      setMatches(related);
      const provider = localStorage.getItem("mctosh_ai_provider") || undefined;
      const dictionary = await lookupDictionaryWord(value, { provider });
      if (dictionary.dictionaryResponseType === "suggestions") {
        setResult(dictionary);
        return;
      }
      const firstDefinition = dictionary.definitions?.[0];
      setCandidates([{
        ...dictionary,
        definitions: firstDefinition ? [firstDefinition] : [],
        candidateId: normalizedTerm(dictionary.word || value),
      }]);
    } catch (lookupError) {
      setError(lookupError.message || "Could not search saved vocabulary.");
    } finally {
      setBusy(false);
    }
  };

  const saveCandidate = async (candidate) => {
    const value = String(candidate?.word || term || "").trim();
    if (!value || !candidate || savingCandidate) return;
    setSavingCandidate(candidate.candidateId);
    setError("");
    try {
      const provider = localStorage.getItem("mctosh_ai_provider") || undefined;
      const token = readStoredSession()?.token || "";
      const translationResponse = await fetch(apiUrl("/api/ai/text-tool"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ text: value, action: "translate", targetLang: targetLanguage, provider }),
      });
      const translationData = await translationResponse.json().catch(() => ({}));
      const response = await saveVocabulary({
        ...candidate,
        translation: translationResponse.ok ? String(translationData.result || "").trim() : "",
      });
      setResult(response.saved);
      setCandidates((current) => current.filter((item) => item.candidateId !== candidate.candidateId));
      setMatches([]);
      onSaved?.(response.saved);
      window.dispatchEvent(new CustomEvent("amctoshs:vocab-saved", { detail: response.saved }));
    } catch (processError) {
      setError(processError.message || `Could not process “${value}”.`);
    } finally {
      setSavingCandidate("");
    }
  };

  const showSavedResult = (item) => {
    setTerm(item.word);
    setResult(item);
    setMatches([]);
    setCandidates([]);
    setError("");
  };

  return (
    <div className={`vocabs_lookup${compact ? " vocabs_lookup--compact" : ""}`}>
      <form className="vocabs_search" onSubmit={search}>
        <div className="vocabs_search_field">
          <i className="fi fi-rr-search" aria-hidden="true" />
          <input value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Search or add a vocabulary term…" aria-label="Vocabulary term" />
        </div>
        {!compact && <select className="vocabs_language" value={targetLanguage} onChange={(event) => setTargetLanguage(event.target.value)} aria-label="Translation language"><option>French</option><option>Spanish</option><option>Arabic</option><option>German</option><option>Italian</option></select>}
        <button type="submit" disabled={busy || savingCandidate || !term.trim()} aria-label="Search vocabulary" title="Search vocabulary"><i className={`fi ${busy ? "fi-rr-spinner" : "fi-rr-arrow-right"}`} /><span>{busy ? "Searching…" : "Search"}</span></button>
      </form>

      {error && <p className="vocabs_error" role="alert"><i className="fi fi-rr-exclamation" /> {error}</p>}

      {candidates.length > 0 && (
        <section className="vocabs_candidates" aria-live="polite">
          <div className="vocabs_candidates_heading"><span>Dictionary result</span><strong>Save this entry</strong></div>
          <div className="vocabs_candidate_list">
            {candidates.map((candidate) => (
              <article className="vocabs_candidate" key={candidate.candidateId}>
                <div className="vocabs_candidate_copy">
                  <strong>{candidate.word}</strong>
                  {candidate.partOfSpeech && <span>{candidate.partOfSpeech}</span>}
                  {candidate.definitions?.length ? candidate.definitions.map((definition, index) => (
                    <div key={`${definition.definition}-${index}`}>
                      <p>{definition.definition || "No definition available."}</p>
                      {definition.example && <small>Example: {definition.example}</small>}
                    </div>
                  )) : <p>No definition available.</p>}
                </div>
                <button type="button" onClick={() => void saveCandidate(candidate)} disabled={Boolean(savingCandidate)} aria-label={`Save ${candidate.word}`} title="Save this result">
                  <i className={`fi ${savingCandidate === candidate.candidateId ? "fi-rr-spinner" : "fi-rr-plus"}`} />
                </button>
              </article>
            ))}
          </div>
        </section>
      )}

      {matches.length > 0 && (
        <div className="vocabs_matches">
          <span>Related saved terms</span>
          <div>{matches.map((item) => <button type="button" key={item.id} onClick={() => showSavedResult(item)}>{item.word}<i className="fi fi-rr-arrow-small-right" /></button>)}</div>
        </div>
      )}

      {result?.dictionaryResponseType === "suggestions" && (
        <div className="vocabs_suggestions_table_wrap" aria-live="polite">
          <table className="vocabs_suggestions_table"><thead><tr><th>Suggestion</th></tr></thead><tbody>{result.suggestions.map((suggestion) => <tr key={suggestion}><td><button type="button" onClick={() => { setTerm(suggestion); setResult(null); setCandidates([]); }}>{suggestion}</button></td></tr>)}</tbody></table>
        </div>
      )}

      {result && result.dictionaryResponseType !== "suggestions" && !candidates.length && <article className="vocabs_result" aria-live="polite">
        <div className="vocabs_result_heading">
          <div><span>Saved term</span><h3>{result.word}</h3>{result.translation && <small>{targetLanguage}: {result.translation}</small>}</div>
          <div className="vocabs_result_meta"><small>{result.sourceLabel || "RabbitHole Vocabs"}</small><span className="vocabs_saved_badge"><i className="fi fi-rr-check" /> Saved</span></div>
        </div>
        {result.phonetic && <div className="vocabs_phonetic">/{result.phonetic.replace(/^\/+|\/+$/g, "")}/</div>}
        <div className="vocabs_definitions">{(result.definitions || []).map((definition, index) => <div key={`${definition.definition}-${index}`}><b>{String(index + 1).padStart(2, "0")}</b><p>{definition.definition}</p></div>)}</div>
      </article>}
    </div>
  );
};

export default VocabLookup;
