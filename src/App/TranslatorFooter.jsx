import React, { useEffect, useRef, useState } from "react";
import { apiUrl } from "../config/api";
import { readStoredSession } from "../utils/sessionCleanup";
import { useAIProvider } from "../hooks/useAIProvider";
import { readSttSettings, STT_PROVIDER_OPTIONS } from "../Avatar/local3d/sttProviderSettings";
import { startConfiguredStt } from "../Shared/configuredStt";
import useDraggableFloating from "../Shared/useDraggableFloating";
import { lookupDictionaryWord } from "../utils/dictionarySettings";
import "./translatorFooter.css";

const TARGET_LANGUAGES = ["English", "French", "Spanish", "Arabic", "German", "Italian", "Portuguese"];

const TranslatorFooter = () => {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [targetLang, setTargetLang] = useState("English");
  const [result, setResult] = useState("");
  const [example, setExample] = useState("");
  const [dictionaryResult, setDictionaryResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const recognitionRef = useRef(null);
  const { provider } = useAIProvider();
  const [configuredProvider, setConfiguredProvider] = useState(() => localStorage.getItem("mctosh_ai_provider") || provider);
  const [sttSettings, setSttSettings] = useState(() => readSttSettings());
  const { panelRef, dragStyle, dragHandleProps } = useDraggableFloating();

  useEffect(() => () => recognitionRef.current?.abort?.(), []);

  const toggleListening = async () => {
    if (listening) {
      recognitionRef.current?.stop?.();
      return;
    }
    setError("");
    const settings = readSttSettings();
    setSttSettings(settings);
    const pending = { stop: () => {}, abort: () => {} };
    recognitionRef.current = pending;
    try {
      const controller = await startConfiguredStt({
        continuous: false,
        language: "en-US",
        onStart: () => setListening(true),
        onText: (transcript) => setText(transcript),
        onError: (sttError) => setError(sttError.message || "Could not hear that word."),
        onEnd: () => { setListening(false); recognitionRef.current = null; },
      });
      if (recognitionRef.current !== pending) controller.abort?.();
      else recognitionRef.current = controller;
    } catch (sttError) {
      recognitionRef.current = null;
      setListening(false);
      setError(sttError.message || "Speech input is unavailable.");
    }
  };

  const translate = async (event) => {
    event.preventDefault();
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    setError("");
    setDictionaryResult(null);
    setExample("");
    try {
      const token = readStoredSession()?.token || "";
      const selectedProvider = localStorage.getItem("mctosh_ai_provider") || configuredProvider;
      const response = await fetch(apiUrl("/api/ai/text-tool"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ text: value, action: "translate", targetLang, provider: selectedProvider }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error?.message || "Translation failed.");
      setResult(String(data.result || "").trim());
      setExample(String(data.example || "").trim());
      try {
        setDictionaryResult(await lookupDictionaryWord(value, { provider: selectedProvider }));
      } catch (dictionaryError) {
        setDictionaryResult({ error: dictionaryError.message || "No dictionary result was found." });
      }
    } catch (err) {
      setError(err.message || "Translation failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="translator_footer_tool">
      {open && (
        <div ref={panelRef} className="translator_panel" role="dialog" aria-label="Translator and dictionary" style={dragStyle || undefined}>
          <div className="translator_panel_header" {...dragHandleProps}>
            <span className="translator_panel_title"><i className="fi fi-rr-language" aria-hidden="true" /> Translator + Dictionary</span>
            <div className="translator_panel_providers" aria-label="Configured providers">
              <span title="Translation provider"><b>Translator</b> Google Cloud</span>
              <span title="Speech-to-text provider"><b>STT</b> {STT_PROVIDER_OPTIONS.find((item) => item.id === sttSettings.provider)?.label || sttSettings.provider}</span>
              <span title="Dictionary provider"><b>Dictionary</b> Merriam-Webster Medical · Collegiate fallback</span>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close translator">×</button>
          </div>
          <form onSubmit={translate}>
            <div className="translator_input_row">
              <input value={text} onChange={(event) => setText(event.target.value)} placeholder="Type a word or phrase…" aria-label="Text to translate" autoFocus />
              <button type="button" className={`translator_mic${listening ? " translator_mic--active" : ""}`} onClick={toggleListening} title={listening ? "Stop listening" : "Speak a word or phrase"} aria-label={listening ? "Stop listening" : "Speak a word or phrase"}><i className={`fi ${listening ? "fi-rr-square" : "fi-rr-microphone"}`} aria-hidden="true" /></button>
            </div>
            <div className="translator_controls"><label htmlFor="translator_target_lang">Translate to</label><select id="translator_target_lang" value={targetLang} onChange={(event) => setTargetLang(event.target.value)}>{TARGET_LANGUAGES.map((language) => <option key={language}>{language}</option>)}</select><button type="submit" disabled={busy || !text.trim()}>{busy ? "…" : "Translate"}</button></div>
          </form>
          {error && <p className="translator_error">{error}</p>}
          {result && <div className="translator_result" aria-live="polite"><span>Translated term</span><strong>{result}</strong></div>}
          {dictionaryResult && (
            <div className={`translator_dictionary${dictionaryResult.error ? " translator_dictionary--error" : ""}`} aria-live="polite">
              <span>Dictionary result · English</span>
              <strong>{dictionaryResult.error || dictionaryResult.text}</strong>
            </div>
          )}
          {example && <div className="translator_example" aria-live="polite"><span>Example · English</span><strong>{example}</strong></div>}
        </div>
      )}
      <button type="button" className={`translator_footer_button${open ? " translator_footer_button--active" : ""}`} onClick={() => { setConfiguredProvider(localStorage.getItem("mctosh_ai_provider") || provider); setSttSettings(readSttSettings()); setOpen((value) => !value); }} aria-expanded={open} aria-label="Open translator" title="Translator"><i className="fi fi-rr-language" aria-hidden="true" /></button>
    </div>
  );
};

export default TranslatorFooter;
