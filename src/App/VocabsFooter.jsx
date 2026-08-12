import React, { useEffect, useRef, useState } from "react";
import useDraggableFloating from "../Shared/useDraggableFloating";
import { saveVocabulary } from "../utils/vocabApi";
import "./vocabsFooter.css";

const LookupIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M22 11.96c-.02-.39-.26-.74-.63-.89L17.44 9.5l3.43-6a1 1 0 0 0-.16-1.2 1 1 0 0 0-1.2-.16l-6.34 3.62L9.71 2.3c-.29-.29-.72-.37-1.09-.22S8 2.6 8 3v3.82l-4.84-.81a.99.99 0 0 0-1.05.53c-.2.39-.13.86.18 1.17l4.4 4.4-4.51 6.31a.99.99 0 0 0 .04 1.21c.28.35.76.47 1.17.29l5.87-2.51.76 3.79c.08.41.4.72.81.79.06 0 .11.01.17.01.35 0 .67-.18.86-.49l2.5-4.16 6.15 3.51a1.005 1.005 0 0 0 1.33-1.43l-3.37-5.06 2.99-1.49a1 1 0 0 0 .55-.94Zm-5.45 1.15c-.26.13-.45.36-.52.64s-.02.57.13.81l1.65 2.48-3.32-1.9a1 1 0 0 0-1.35.35l-1.67 2.78-.49-2.46c-.06-.29-.25-.55-.52-.69a1 1 0 0 0-.86-.04l-3.71 1.59 2.92-4.09c.28-.4.24-.94-.11-1.29L5.91 8.5l2.92.49c.29.05.59-.03.81-.22s.35-.47.35-.76V5.42l2.29 2.29c.32.32.81.39 1.2.16l3.82-2.18-2.18 3.82c-.14.25-.17.55-.08.83s.3.49.57.6l2.93 1.17-2.01 1Z" />
  </svg>
);

const VocabsFooter = () => {
  const [open, setOpen] = useState(false);
  const [entry, setEntry] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [queuedWord, setQueuedWord] = useState("");
  const inputRef = useRef(null);
  const { panelRef, dragStyle, dragHandleProps } = useDraggableFloating();

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const queueEntry = async (event) => {
    event.preventDefault();
    const word = entry.trim();
    if (!word || busy) return;
    setBusy(true);
    setError("");
    setQueuedWord("");
    try {
      const response = await saveVocabulary({
        word,
        translation: "",
        definitions: [],
        source: "manual",
        sourceLabel: "Manual entry",
      });
      setEntry("");
      setQueuedWord(response.saved?.word || word);
      window.dispatchEvent(new CustomEvent("amctoshs:vocab-saved", { detail: response.saved }));
      inputRef.current?.focus();
    } catch (requestError) {
      setError(requestError.message || "Could not add the entry to the vocabulary queue.");
    } finally {
      setBusy(false);
    }
  };

  return <div className="vocabs_footer_tool">
    {open && <div ref={panelRef} className="vocabs_footer_panel vocabs_footer_queue_panel" style={dragStyle || undefined} role="dialog" aria-label="Queue a vocabulary entry">
      <div className="vocabs_footer_panel_header" {...dragHandleProps}><span><LookupIcon /> Lookup</span><button type="button" onClick={() => setOpen(false)} aria-label="Close Lookup">×</button></div>
      <form className="vocabs_footer_queue_form" onSubmit={queueEntry}>
        <input
          ref={inputRef}
          value={entry}
          onChange={(event) => { setEntry(event.target.value); setQueuedWord(""); setError(""); }}
          onFocus={() => queueMicrotask(() => window.dispatchEvent(new CustomEvent("virtual-keyboard:open")))}
          placeholder="Enter vocabulary entry"
          aria-label="Vocabulary entry to queue"
          disabled={busy}
        />
        <button type="submit" disabled={busy || !entry.trim()} aria-label="Add entry to Queued vocabulary" title="Add to Queued">
          <i className={`fi ${busy ? "fi-rr-spinner" : "fi-rr-plus"}`} aria-hidden="true" />
        </button>
      </form>
      {queuedWord && <p className="vocabs_footer_queue_status" aria-live="polite"><i className="fi fi-rr-check" /> “{queuedWord}” added to Queued.</p>}
      {error && <p className="vocabs_footer_queue_error" role="alert">{error}</p>}
    </div>}
    <button type="button" className={`vocabs_footer_button${open ? " vocabs_footer_button--active" : ""}`} onClick={() => { setQueuedWord(""); setError(""); setOpen((value) => !value); }} aria-expanded={open} aria-label="Open Lookup" title="Lookup"><LookupIcon /></button>
  </div>;
};

export default VocabsFooter;
