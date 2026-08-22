import React, { useEffect, useRef, useState } from "react";
import { apiUrl } from "../config/api";
import "./systemMessageModal.css";

const SystemMessageModal = ({ onClose }) => {
  const [text, setText]     = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const textareaRef          = useRef(null);

  useEffect(() => {
    fetch(apiUrl("/api/pdf/system-message"))
      .then((r) => r.json())
      .then((d) => { setText(d.systemMessage || ""); })
      .catch(() => {});

    textareaRef.current?.focus();
  }, []);

  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handlePaste = () => {
    navigator.clipboard.readText().then((t) => setText(t)).catch(() => {});
  };

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await fetch(apiUrl("/api/pdf/system-message"), {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ systemMessage: text }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {}
    finally { setSaving(false); }
  };

  return (
    <div id="sys_modal_overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div id="sys_modal">
        <div id="sys_modal_header">
          <span>System Message</span>
          <button id="sys_modal_close" onClick={onClose}>✕</button>
        </div>
        <textarea
          ref={textareaRef}
          id="sys_modal_textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
        />
        <div id="sys_modal_footer">
          <span id="sys_modal_hint">This message is sent to the AI before every extraction.</span>
          <div id="sys_modal_actions">
            <button className="sys_modal_btn" onClick={handleCopy}>
              {copied ? "Copied" : "Copy"}
            </button>
            <button className="sys_modal_btn" onClick={handlePaste}>Paste</button>
            <button className="sys_modal_btn sys_modal_btn--primary" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : saved ? "Saved" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SystemMessageModal;
