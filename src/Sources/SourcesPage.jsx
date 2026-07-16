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
  const [clearingMarkdownId, setClearingMarkdownId] = useState(null);

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

  /* ── Delete ── */
  const deleteSource = useCallback(async (id) => {
    try {
      await fetch(apiUrl(`/api/sources/${id}`), { method: "DELETE", headers: authHeader() });
      setSources((prev) => prev.filter((s) => s._id !== id));
    } catch {}
  }, []);

  const deleteMarkdownExtraction = useCallback(async (source) => {
    if (!source?._id || !source.hasMarkdown || clearingMarkdownId === source._id) return;
    if (!window.confirm(`Delete the cached text extraction for "${source.name}"? The source file will stay in Sources.`)) return;

    setError(null);
    setInfo(null);
    setClearingMarkdownId(source._id);
    try {
      const res = await fetch(apiUrl(`/api/sources/${source._id}/markdown?all=1`), {
        method: "DELETE",
        headers: authHeader(),
      });
      const data = await readResponsePayload(res);
      if (!res.ok) throw new Error(data.error || "Failed to delete the text extraction.");

      setSources((prev) => prev.map((item) => (
        item._id === source._id ? { ...item, hasMarkdown: false } : item
      )));
      setInfo(`Deleted text extraction for "${source.name}".`);
    } catch (e) {
      setError(e.message || "Failed to delete the text extraction.");
    } finally {
      setClearingMarkdownId(null);
    }
  }, [clearingMarkdownId]);

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
              <th>Open</th>
              <th>Text Extraction</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="sources_td_status">Loading…</td></tr>
            ) : sources.length === 0 ? (
              <tr><td colSpan={6} className="sources_td_status">No sources yet — click + Add Source to get started.</td></tr>
            ) : sources.map((s) => (
              <tr key={s._id}>
                <td>
                  <span className="sources_type_badge" style={{ "--src-color": TYPE_COLORS[s.type] || "#aaa" }}>
                    {TYPE_LABELS[s.type] || s.type}
                  </span>
                </td>
                <td className="sources_td_format">{s.format || "—"}</td>
                <td className="sources_td_name">{s.name}</td>
                <td className="sources_td_url">
                  {s.type === "youtube"
                    ? s.url
                      ? <button className="sources_url_link"
                          onClick={() => navigate("/youtube", { state: { sourceId: s._id, sourceName: s.name, sourceUrl: s.url } })}>
                          {s.name}
                        </button>
                      : <span className="sources_url_none">—</span>
                    : (s.key || s.parts?.length)
                      ? <button className="sources_url_link"
                          onClick={() => navigate("/pdf-reader", { state: { sourceId: s._id, pdfName: s.name } })}>
                          {s.name}
                        </button>
                      : <span className="sources_url_none">—</span>}
                </td>
                <td className="sources_td_markdown">
                  {s.format === "youtube" ? (
                    <span className="sources_url_none">—</span>
                  ) : (
                    <span className="sources_extract_group">
                      <span
                        className={`sources_extract_dot${s.hasMarkdown ? " sources_extract_dot--done" : " sources_extract_dot--pending"}`}
                        title={s.hasMarkdown ? "Text extracted" : "Not extracted yet — use Actions → Text Extraction in the PDF Reader"}
                      />
                      {s.hasMarkdown ? (
                        <button
                          type="button"
                          className="sources_extract_delete"
                          onClick={() => deleteMarkdownExtraction(s)}
                          disabled={clearingMarkdownId === s._id}
                          title={clearingMarkdownId === s._id ? "Deleting cached text extraction…" : "Delete cached text extraction"}
                        >
                          {clearingMarkdownId === s._id ? "…" : "×"}
                        </button>
                      ) : null}
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
