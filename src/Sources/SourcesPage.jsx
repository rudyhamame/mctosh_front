import React, { useRef, useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { readStoredSession } from "../utils/sessionCleanup";
import { apiUrl } from "../config/api";
import "./sourcesPage.css";

const TYPE_LABELS = {
  pdf: "PDF", word: "Word", youtube: "YouTube", image: "Image",
  textbook: "Textbook", reference: "Reference", review: "Review",
  xray: "X-Ray", ct: "CT Scan", mri: "MRI", ultrasound: "Ultrasound",
};
const TYPE_COLORS = {
  pdf: "#4fc3f7", word: "#4fc3f7", youtube: "#e53935", image: "#81c784",
  textbook: "#4fc3f7", reference: "#a5d6a7", review: "#ce93d8",
  xray: "#b0bec5", ct: "#4dd0e1", mri: "#9575cd", ultrasound: "#4db6ac",
};

const authHeader = () => {
  const token = readStoredSession()?.token || "";
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MB
const CLOUDINARY_RAW_LIMIT_BYTES = 10 * 1024 * 1024;

const formatMb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const isPdfFile = (file) =>
  file?.type === "application/pdf" || /\.pdf$/i.test(String(file?.name || ""));

const isCloudinarySizeError = (message = "", status = 0) => {
  if (status === 413) return true;
  return /cloudinary|file size|too large|payload too large|maximum|max size|limit exceeded/i.test(message);
};

const readResponsePayload = async (res) => {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
};

const COMPRESSION_LABELS = {
  low: "Low compression",
  recommended: "Recommended",
  extreme: "Extreme",
};

const SourcesPage = () => {
  const navigate = useNavigate();
  const fileDocRef      = useRef(null);
  const fileImgRef      = useRef(null);
  const pendingDocType  = useRef("textbook");
  const pendingImgType  = useRef("xray");
  const dropdownRef     = useRef(null);
  const addBtnRef       = useRef(null);

  const [sources,  setSources]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);
  const [info,     setInfo]     = useState(null);
  const [dropOpen, setDropOpen] = useState(false);
  const [ytInput,  setYtInput]  = useState(false);
  const [ytUrl,    setYtUrl]    = useState("");
  const [compressionPrompt, setCompressionPrompt] = useState(null);
  const [compressionBusy, setCompressionBusy] = useState(false);

  /* ── Load sources ── */
  useEffect(() => {
    (async () => {
      try {
        const res  = await fetch(apiUrl("/api/sources/"), { headers: authHeader() });
        const data = await res.json();
        if (res.ok) setSources(data.sources || []);
      } catch {}
      setLoading(false);
    })();
  }, []);

  /* ── Close dropdown on outside click ── */
  useEffect(() => {
    if (!dropOpen) return;
    const handler = (e) => {
      if (
        !dropdownRef.current?.contains(e.target) &&
        !addBtnRef.current?.contains(e.target)
      ) setDropOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dropOpen]);

  /* ── Upload file ── */
  const [uploadCount, setUploadCount] = useState(0);

  // Split preview is local (pdf-lib page count) and free — no iLovePDF call,
  // no credits spent — unlike the old per-level compression size check
  // (confirmed by direct measurement to cost 3 real credits per prompt-open,
  // low/recommended/extreme, even when the user never compressed anything).
  // Compression itself is now offered as a single static "Recommended"
  // button with no upfront size check; a real compression call only happens
  // if the user actually clicks it.
  const fetchSplitPreview = useCallback(async (file) => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(apiUrl("/api/sources/split-preview"), {
      method: "POST",
      headers: authHeader(),
      body: form,
    });
    const data = await readResponsePayload(res);
    if (!res.ok) throw new Error(data.error || "Failed to check split options.");
    return data;
  }, []);

  const offerPdfCompression = useCallback(async (file, type, reason, knownOptions = null) => {
    setCompressionPrompt({
      file,
      type,
      reason,
      currentSizeBytes: knownOptions?.currentSizeBytes ?? file.size,
      maxSizeBytes: knownOptions?.maxSizeBytes ?? CLOUDINARY_RAW_LIMIT_BYTES,
      attemptedCompressionLevel: knownOptions?.attemptedCompressionLevel || null,
      attemptedSizeBytes: knownOptions?.attemptedSizeBytes || null,
      compressionError: knownOptions?.compressionError || null,
      splitSuggestion: knownOptions?.splitSuggestion || null,
      loadingSplit: !knownOptions,
    });

    if (knownOptions) return;

    try {
      const data = await fetchSplitPreview(file);
      setCompressionPrompt((prev) => {
        if (!prev || prev.file !== file) return prev;
        return { ...prev, splitSuggestion: data.splitSuggestion || null, loadingSplit: false };
      });
    } catch (e) {
      setCompressionPrompt((prev) => {
        if (!prev || prev.file !== file) return prev;
        return { ...prev, compressionError: e.message, loadingSplit: false };
      });
    }
  }, [fetchSplitPreview]);

  const uploadFile = useCallback(async (file, type, options = {}) => {
    const { compressPdf = false, compressPdfLevel = "" } = options;
    setError(null);
    setInfo(null);
    setUploadCount((n) => n + 1);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("type", type);
      form.append("name", file.name);
      if (compressPdf) form.append("compressPdf", "true");
      if (compressPdfLevel) form.append("compressPdfLevel", compressPdfLevel);
      const res  = await fetch(apiUrl("/api/sources/save"), { method: "POST", headers: authHeader(), body: form });
      const data = await readResponsePayload(res);
      if (!res.ok) {
        const message = data.error || `"${file.name}" failed.`;
        if (isPdfFile(file) && data.needsCompression) {
          void offerPdfCompression(file, type, message, data);
          return;
        }
        if (isPdfFile(file) && isCloudinarySizeError(message, res.status)) {
          void offerPdfCompression(file, type, `"${file.name}" is over the Cloudinary upload limit. Compress it and retry?`);
          return;
        }
        throw new Error(message);
      }
      if (data.duplicate) {
        setInfo(`"${file.name}" is already in your sources.`);
        return;
      }
      setSources((prev) => [data.source, ...prev]);
    } catch (e) {
      setError(e.message);
    } finally {
      setUploadCount((n) => n - 1);
    }
  }, [offerPdfCompression]);

  const handleCompressAndUpload = useCallback(async (compressionLevel) => {
    if (!compressionPrompt?.file || !compressionPrompt?.type || !compressionLevel) return;
    setCompressionBusy(true);
    setError(null);
    setInfo(null);
    try {
      setInfo(`Compressing "${compressionPrompt.file.name}" with iLovePDF (${COMPRESSION_LABELS[compressionLevel] || compressionLevel}) and uploading now…`);
      setCompressionPrompt(null);
      await uploadFile(compressionPrompt.file, compressionPrompt.type, {
        compressPdf: true,
        compressPdfLevel: compressionLevel,
      });
    } catch (e) {
      setError(e.message || "Failed to compress this PDF.");
    } finally {
      setCompressionBusy(false);
    }
  }, [compressionPrompt, uploadFile]);

  const handleSplitAndUpload = useCallback(async () => {
    const prompt = compressionPrompt;
    const parts = prompt?.splitSuggestion?.suggestedParts;
    if (!prompt?.file || !prompt?.type || !parts) return;
    setCompressionBusy(true);
    setError(null);
    setInfo(null);
    try {
      setInfo(`Splitting "${prompt.file.name}" into ${parts} parts behind the scenes…`);
      setCompressionPrompt(null);
      const form = new FormData();
      form.append("file", prompt.file);
      form.append("type", prompt.type);
      form.append("name", prompt.file.name);
      form.append("parts", String(parts));
      setUploadCount((n) => n + 1);
      const res  = await fetch(apiUrl("/api/sources/split-and-save"), { method: "POST", headers: authHeader(), body: form });
      const data = await readResponsePayload(res);
      if (!res.ok) throw new Error(data.error || `Failed to split "${prompt.file.name}".`);
      if (data.duplicate) {
        setInfo(`"${prompt.file.name}" is already in your sources.`);
      } else {
        setSources((prev) => [data.source, ...prev]);
        setInfo(
          `Uploaded "${prompt.file.name}" as one source, stored behind the scenes as ${data.partCount} parts` +
          (data.oversizedParts ? ` (${data.oversizedParts} part${data.oversizedParts > 1 ? "s" : ""} still over the limit even after compressing).` : ".")
        );
      }
    } catch (e) {
      setError(e.message || "Failed to split this PDF.");
    } finally {
      setCompressionBusy(false);
      setUploadCount((n) => n - 1);
    }
  }, [compressionPrompt]);

  /* ── Save YouTube link ── */
  const saveYoutube = useCallback(async (url) => {
    setError(null);
    setUploadCount((n) => n + 1);
    setYtInput(false);
    setYtUrl("");
    try {
      const form = new FormData();
      form.append("type", "youtube");
      form.append("name", url);
      form.append("url",  url);
      const res  = await fetch(apiUrl("/api/sources/save"), { method: "POST", headers: authHeader(), body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed.");
      setSources((prev) => [data.source, ...prev]);
    } catch (e) {
      setError(e.message);
    } finally {
      setUploadCount((n) => n - 1);
    }
  }, []);

  /* ── Open ── same destination the old separate "Open" column used to
     link to, now reached by clicking the name itself. */
  const isSourceOpenable = (s) => (s.type === "youtube" ? Boolean(s.url) : Boolean(s.key || s.parts?.length));
  const openSource = useCallback((s) => {
    if (!isSourceOpenable(s)) return;
    if (s.type === "youtube") {
      navigate("/youtube", { state: { sourceId: s._id, sourceName: s.name, sourceUrl: s.url } });
    } else {
      navigate("/pdf-reader", { state: { sourceId: s._id, pdfName: s.name } });
    }
  }, [navigate]);

  /* ── Delete ── */
  const deleteSource = useCallback(async (id) => {
    try {
      await fetch(apiUrl(`/api/sources/${id}`), { method: "DELETE", headers: authHeader() });
      setSources((prev) => prev.filter((s) => s._id !== id));
    } catch {}
  }, []);

  /* ── Rename ── inline edit in the Name column, not a modal — one field,
     no reason to interrupt with a dialog. renamingId tracks which row (if
     any) is currently in edit mode; renameValue is that row's own draft
     text, reset fresh every time a new row starts editing. */
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);

  const startRename = useCallback((source) => {
    setError(null);
    setRenamingId(source._id);
    setRenameValue(source.name);
  }, []);

  const cancelRename = useCallback(() => {
    setRenamingId(null);
    setRenameValue("");
  }, []);

  const submitRename = useCallback(async (id) => {
    const name = renameValue.trim();
    if (!name) { setError("Name is required."); return; }
    setRenameBusy(true);
    try {
      const res = await fetch(apiUrl(`/api/sources/${id}`), {
        method: "PATCH",
        headers: { ...authHeader(), "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await readResponsePayload(res);
      if (!res.ok) throw new Error(data.error || "Failed to rename.");
      setSources((prev) => prev.map((s) => (s._id === id ? { ...s, name: data.name || name } : s)));
      setRenamingId(null);
      setRenameValue("");
    } catch (e) {
      setError(e.message || "Failed to rename.");
    } finally {
      setRenameBusy(false);
    }
  }, [renameValue]);

  /* ── File picker ── */
  const handleFile = (e, type) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    e.target.value = "";
    for (const file of files) {
      const resolvedType = type === "doc" ? pendingDocType.current : type;
      if (file.size > MAX_UPLOAD_BYTES) {
        if (isPdfFile(file)) {
          void offerPdfCompression(file, resolvedType, `"${file.name}" is ${formatMb(file.size)}, above the 100 MB Cloudinary limit. Compress it before upload?`);
        } else {
          setError(`"${file.name}" is too large (${formatMb(file.size)}). Maximum is 100 MB.`);
        }
        continue;
      }
      if (isPdfFile(file) && file.size > CLOUDINARY_RAW_LIMIT_BYTES) {
        void offerPdfCompression(file, resolvedType, `"${file.name}" is ${formatMb(file.size)}, above the ${formatMb(CLOUDINARY_RAW_LIMIT_BYTES)} Cloudinary PDF upload limit. Compress it with iLovePDF before uploading?`);
        continue;
      }
      uploadFile(file, resolvedType);
    }
  };

  return (
    <div id="sources_page">

      {/* ── Header ── */}
      <div id="sources_header">
        <button id="sources_back_btn" onClick={() => navigate("/home")}>←</button>
        <span id="sources_header_title">Hyle Source Organisation</span>
        {uploadCount > 0 && <span id="sources_uploading_label">Uploading {uploadCount > 1 ? `${uploadCount} files` : ""}…</span>}

        <div id="sources_add_wrap">
          <button
            id="sources_add_btn"
            ref={addBtnRef}
            onClick={() => { setDropOpen((o) => !o); setYtInput(false); }}
          >
            + Add Source
          </button>

          {dropOpen && (
            <div id="sources_dropdown" ref={dropdownRef}>
              <button className="sources_drop_item" style={{ "--src-color": "#4fc3f7" }}
                onClick={() => { pendingDocType.current = "textbook"; setDropOpen(false); fileDocRef.current?.click(); }}>
                <i className="fi fi-rr-book-alt sources_drop_icon" />
                <span className="sources_drop_label">Textbook</span>
                <span className="sources_drop_tag">PDF</span>
              </button>
              <button className="sources_drop_item" style={{ "--src-color": "#a5d6a7" }}
                onClick={() => { pendingDocType.current = "reference"; setDropOpen(false); fileDocRef.current?.click(); }}>
                <i className="fi fi-rr-book-bookmark sources_drop_icon" />
                <span className="sources_drop_label">Reference Book</span>
                <span className="sources_drop_tag">PDF</span>
              </button>
              <button className="sources_drop_item" style={{ "--src-color": "#ce93d8" }}
                onClick={() => { pendingDocType.current = "review"; setDropOpen(false); fileDocRef.current?.click(); }}>
                <i className="fi fi-rr-document sources_drop_icon" />
                <span className="sources_drop_label">Review</span>
                <span className="sources_drop_tag">PDF</span>
              </button>
              <button className="sources_drop_item" style={{ "--src-color": "#e53935" }}
                onClick={() => { setDropOpen(false); setYtInput(true); }}>
                <i className="fi fi-rr-play-alt sources_drop_icon" />
                <span className="sources_drop_label">YouTube Link</span>
                <span className="sources_drop_tag">Transcription</span>
              </button>
              <div className="sources_drop_divider">Radiological Imaging</div>
              <button className="sources_drop_item" style={{ "--src-color": "#b0bec5" }}
                onClick={() => { pendingImgType.current = "xray"; setDropOpen(false); fileImgRef.current?.click(); }}>
                <i className="fi fi-rr-x-ray sources_drop_icon" />
                <span className="sources_drop_label">Radiograph (X-Ray)</span>
                <span className="sources_drop_tag">Imaging</span>
              </button>
              <button className="sources_drop_item" style={{ "--src-color": "#4dd0e1" }}
                onClick={() => { pendingImgType.current = "ct"; setDropOpen(false); fileImgRef.current?.click(); }}>
                <i className="fi fi-rr-target sources_drop_icon" />
                <span className="sources_drop_label">CT Scan</span>
                <span className="sources_drop_tag">Imaging</span>
              </button>
              <button className="sources_drop_item" style={{ "--src-color": "#9575cd" }}
                onClick={() => { pendingImgType.current = "mri"; setDropOpen(false); fileImgRef.current?.click(); }}>
                <i className="fi fi-rr-brain sources_drop_icon" />
                <span className="sources_drop_label">MRI</span>
                <span className="sources_drop_tag">Imaging</span>
              </button>
              <button className="sources_drop_item" style={{ "--src-color": "#4db6ac" }}
                onClick={() => { pendingImgType.current = "ultrasound"; setDropOpen(false); fileImgRef.current?.click(); }}>
                <i className="fi fi-rr-wave-sine sources_drop_icon" />
                <span className="sources_drop_label">Ultrasound</span>
                <span className="sources_drop_tag">Imaging</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Hidden file inputs */}
      <input ref={fileDocRef} type="file" accept=".pdf,.doc,.docx" multiple style={{ display: "none" }}
        onChange={(e) => handleFile(e, "doc")} />
      <input ref={fileImgRef} type="file" accept="image/*,.dcm" multiple style={{ display: "none" }}
        onChange={(e) => handleFile(e, pendingImgType.current)} />

      {/* ── YouTube URL bar ── */}
      {ytInput && (
        <div id="sources_yt_bar">
          <input id="sources_yt_input" type="url" placeholder="https://www.youtube.com/watch?v=…"
            value={ytUrl} onChange={(e) => setYtUrl(e.target.value)} autoFocus
            onKeyDown={(e) => { if (e.key === "Enter" && ytUrl.trim()) saveYoutube(ytUrl.trim()); }}
          />
          <button id="sources_yt_submit" disabled={!ytUrl.trim()}
            onClick={() => saveYoutube(ytUrl.trim())}>Add</button>
          <button id="sources_yt_cancel" onClick={() => { setYtInput(false); setYtUrl(""); }}>Cancel</button>
        </div>
      )}

      {/* ── Feedback ── */}
      {error && <div id="sources_error">{error}</div>}
      {info  && <div id="sources_info">{info}</div>}
      {compressionPrompt && (
        <div id="sources_compress_prompt">
          <div className="sources_compress_prompt__copy">
            <strong>Compress PDF for upload?</strong>
            <p>{compressionPrompt.reason}</p>
            <p>
              Current size: <span>{formatMb(compressionPrompt.currentSizeBytes || compressionPrompt.file.size)}</span>
            </p>
            {compressionPrompt.attemptedCompressionLevel && compressionPrompt.attemptedSizeBytes ? (
              <p className="sources_compress_prompt__note">
                Last attempt: <span>{COMPRESSION_LABELS[compressionPrompt.attemptedCompressionLevel] || compressionPrompt.attemptedCompressionLevel}</span> produced {formatMb(compressionPrompt.attemptedSizeBytes)}.
              </p>
            ) : null}

            {/* Split is offered up front, before compression — it's instant
                and free (local pdf-lib page count, no iLovePDF call), so
                users who'd rather just split don't wait on anything. */}
            {compressionPrompt.loadingSplit ? (
              <p className="sources_compress_prompt__loading">Checking whether this PDF can be split…</p>
            ) : compressionPrompt.splitSuggestion ? (
              <div className="sources_split_option">
                <p className="sources_compress_prompt__note">
                  Split it into {compressionPrompt.splitSuggestion.suggestedParts} pieces behind the scenes instead (~{formatMb(compressionPrompt.splitSuggestion.estimatedPartSizeBytes)} each, {compressionPrompt.splitSuggestion.numPages} pages total) — no compression needed, and it still shows up as one source that opens and reads like a single PDF.
                </p>
                <button
                  type="button"
                  className="sources_compress_option"
                  disabled={compressionBusy}
                  onClick={handleSplitAndUpload}
                >
                  <strong>Split into {compressionPrompt.splitSuggestion.suggestedParts} parts</strong>
                  <span>Stored as separate pieces, viewed as one seamless document</span>
                </button>
              </div>
            ) : (
              <p className="sources_compress_prompt__note">
                This PDF can't be split further (too few pages) — compression is the only option below.
              </p>
            )}

            {/* No upfront size check here on purpose (that cost 3 real
                iLovePDF credits per prompt-open just to show estimates,
                confirmed by direct measurement) — "Recommended" is offered
                as a static, immediately-clickable action; the real
                compression call only happens if actually clicked. Falls
                forward to "Extreme" only if Recommended genuinely wasn't
                enough. */}
            <p className="sources_compress_prompt__note">Or compress it instead, via the existing iLovePDF flow on the backend:</p>
            {compressionPrompt.attemptedCompressionLevel === "extreme" ? (
              <p className="sources_compress_prompt__note">
                Extreme compression still wasn't enough — splitting (above) is the remaining option.
              </p>
            ) : (
              <div className="sources_compress_options">
                <button
                  type="button"
                  className="sources_compress_option"
                  disabled={compressionBusy || compressionPrompt.compressionAvailable === false}
                  onClick={() => handleCompressAndUpload(compressionPrompt.attemptedCompressionLevel === "recommended" ? "extreme" : "recommended")}
                >
                  <strong>{compressionPrompt.attemptedCompressionLevel === "recommended" ? "Try extreme compression" : "Compress (recommended)"}</strong>
                  <span>Runs the real iLovePDF compression and retries the upload — no preview, size isn't known until this finishes</span>
                </button>
              </div>
            )}
            {compressionPrompt.compressionError ? (
              <p className="sources_compress_prompt__error">{compressionPrompt.compressionError}</p>
            ) : null}
          </div>
          <div className="sources_compress_prompt__actions">
            <button
              type="button"
              className="sources_compress_btn"
              disabled={compressionBusy}
              onClick={() => setCompressionPrompt(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Table ── */}
      <div id="sources_body">
        <table id="sources_table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Format</th>
              <th>Name</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="sources_td_status">Loading…</td></tr>
            ) : sources.length === 0 ? (
              <tr><td colSpan={4} className="sources_td_status">No sources yet — click + Add Source to get started.</td></tr>
            ) : sources.map((s) => (
              <tr key={s._id}>
                <td>
                  <span className="sources_type_badge" style={{ "--src-color": TYPE_COLORS[s.type] || "#aaa" }}>
                    {TYPE_LABELS[s.type] || s.type}
                  </span>
                </td>
                <td className="sources_td_format">{s.format || "—"}</td>
                <td className="sources_td_name">
                  {renamingId === s._id ? (
                    <span className="sources_rename_group">
                      <input
                        type="text"
                        className="sources_rename_input"
                        value={renameValue}
                        autoFocus
                        disabled={renameBusy}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") submitRename(s._id);
                          if (e.key === "Escape") cancelRename();
                        }}
                      />
                      <button
                        type="button"
                        className="sources_rename_confirm"
                        onClick={() => submitRename(s._id)}
                        disabled={renameBusy}
                        title="Save"
                      >{renameBusy ? "…" : "✓"}</button>
                      <button
                        type="button"
                        className="sources_rename_cancel"
                        onClick={cancelRename}
                        disabled={renameBusy}
                        title="Cancel"
                      >✕</button>
                    </span>
                  ) : (
                    <span className="sources_rename_group">
                      {isSourceOpenable(s) ? (
                        <button type="button" className="sources_name_text sources_name_text--link" onClick={() => openSource(s)} title={`Open ${s.name}`}>
                          {s.name}
                        </button>
                      ) : (
                        <span className="sources_name_text" title={s.name}>{s.name}</span>
                      )}
                      <button
                        type="button"
                        className="sources_rename_btn"
                        onClick={() => startRename(s)}
                        title="Rename"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M5 21h14c1.1 0 2-.9 2-2v-7h-2v7H5V5h7V3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2" />
                          <path d="M7 13v3c0 .55.45 1 1 1h3c.27 0 .52-.11.71-.29l9-9a.996.996 0 0 0 0-1.41l-3-3a.996.996 0 0 0-1.41 0l-9.01 8.99A1 1 0 0 0 7 13m10-7.59L18.59 7 17.5 8.09 15.91 6.5zm-8 8 5.5-5.5 1.59 1.59-5.5 5.5H9z" />
                        </svg>
                      </button>
                    </span>
                  )}
                </td>
                <td className="sources_td_actions">
                  <button className="sources_del_btn" onClick={() => deleteSource(s._id)}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

    </div>
  );
};

export default SourcesPage;
