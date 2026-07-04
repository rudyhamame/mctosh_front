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

const SourcesPage = () => {
  const navigate = useNavigate();
  const fileDocRef      = useRef(null);
  const fileImgRef      = useRef(null);
  const pendingDocType  = useRef("textbook");
  const pendingImgType  = useRef("image");
  const dropdownRef     = useRef(null);
  const addBtnRef       = useRef(null);

  const [sources,  setSources]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);
  const [info,     setInfo]     = useState(null);
  const [dropOpen, setDropOpen] = useState(false);
  const [ytInput,  setYtInput]  = useState(false);
  const [ytUrl,    setYtUrl]    = useState("");

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

  const uploadFile = useCallback(async (file, type) => {
    setError(null);
    setInfo(null);
    setUploadCount((n) => n + 1);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("type", type);
      form.append("name", file.name);
      const res  = await fetch(apiUrl("/api/sources/save"), { method: "POST", headers: authHeader(), body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `"${file.name}" failed.`);
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
  }, []);

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

  /* ── Download as Markdown ── */
  const [markdownBusyId, setMarkdownBusyId] = useState(null);

  const downloadMarkdown = useCallback(async (id, name) => {
    setError(null);
    setMarkdownBusyId(id);
    try {
      const res  = await fetch(apiUrl(`/api/sources/${id}/markdown`), { headers: authHeader() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Markdown conversion failed.");
      const blob = new Blob([data.markdown], { type: "text/markdown" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href = url;
      a.download = `${name.replace(/\.[^./]+$/, "")}.md`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e.message);
    } finally {
      setMarkdownBusyId(null);
    }
  }, []);

  /* ── File picker ── */
  const MAX_BYTES = 100 * 1024 * 1024; // 100 MB

  const handleFile = (e, type) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    e.target.value = "";
    for (const file of files) {
      if (file.size > MAX_BYTES) {
        setError(`"${file.name}" is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is 100 MB.`);
        continue;
      }
      const resolvedType = type === "doc" ? pendingDocType.current : type;
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
                <span className="sources_drop_label">Textbook Document</span>
                <span className="sources_drop_tag">Document</span>
              </button>
              <button className="sources_drop_item" style={{ "--src-color": "#a5d6a7" }}
                onClick={() => { pendingDocType.current = "reference"; setDropOpen(false); fileDocRef.current?.click(); }}>
                <i className="fi fi-rr-book-bookmark sources_drop_icon" />
                <span className="sources_drop_label">Reference Book Document</span>
                <span className="sources_drop_tag">Document</span>
              </button>
              <button className="sources_drop_item" style={{ "--src-color": "#ce93d8" }}
                onClick={() => { pendingDocType.current = "review"; setDropOpen(false); fileDocRef.current?.click(); }}>
                <i className="fi fi-rr-document sources_drop_icon" />
                <span className="sources_drop_label">Review Document</span>
                <span className="sources_drop_tag">Document</span>
              </button>
              <button className="sources_drop_item" style={{ "--src-color": "#e53935" }}
                onClick={() => { setDropOpen(false); setYtInput(true); }}>
                <i className="fi fi-rr-play-alt sources_drop_icon" />
                <span className="sources_drop_label">YouTube Link</span>
                <span className="sources_drop_tag">Transcription</span>
              </button>
              <button className="sources_drop_item" style={{ "--src-color": "#81c784" }}
                onClick={() => { pendingImgType.current = "image"; setDropOpen(false); fileImgRef.current?.click(); }}>
                <i className="fi fi-rr-picture sources_drop_icon" />
                <span className="sources_drop_label">Image</span>
                <span className="sources_drop_tag">OCR</span>
              </button>
              <div className="sources_drop_divider">Imaging</div>
              <button className="sources_drop_item" style={{ "--src-color": "#b0bec5" }}
                onClick={() => { pendingImgType.current = "xray"; setDropOpen(false); fileImgRef.current?.click(); }}>
                <i className="fi fi-rr-body-scan sources_drop_icon" />
                <span className="sources_drop_label">Radiograph (X-Ray)</span>
                <span className="sources_drop_tag">Imaging</span>
              </button>
              <button className="sources_drop_item" style={{ "--src-color": "#4dd0e1" }}
                onClick={() => { pendingImgType.current = "ct"; setDropOpen(false); fileImgRef.current?.click(); }}>
                <i className="fi fi-rr-circle-scan sources_drop_icon" />
                <span className="sources_drop_label">CT Scan</span>
                <span className="sources_drop_tag">Imaging</span>
              </button>
              <button className="sources_drop_item" style={{ "--src-color": "#9575cd" }}
                onClick={() => { pendingImgType.current = "mri"; setDropOpen(false); fileImgRef.current?.click(); }}>
                <i className="fi fi-rr-scanner sources_drop_icon" />
                <span className="sources_drop_label">MRI</span>
                <span className="sources_drop_tag">Imaging</span>
              </button>
              <button className="sources_drop_item" style={{ "--src-color": "#4db6ac" }}
                onClick={() => { pendingImgType.current = "ultrasound"; setDropOpen(false); fileImgRef.current?.click(); }}>
                <i className="fi fi-rr-pulse sources_drop_icon" />
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

      {/* ── Table ── */}
      <div id="sources_body">
        <table id="sources_table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Name</th>
              <th>Open</th>
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
                <td className="sources_td_name">{s.name}</td>
                <td className="sources_td_url">
                  {s.url
                    ? s.type === "youtube"
                      ? <button className="sources_url_link"
                          onClick={() => navigate("/youtube", { state: { sourceId: s._id, sourceName: s.name, sourceUrl: s.url } })}>
                          {s.name}
                        </button>
                      : <button className="sources_url_link"
                          onClick={() => navigate("/hylomorphism/pdf_source", { state: { sourceId: s._id, pdfName: s.name } })}>
                          {s.name}
                        </button>
                    : <span className="sources_url_none">—</span>}
                </td>
                <td className="sources_td_actions">
                  {s.key && s.type !== "youtube" && s.type !== "image" && (
                    <button
                      className="sources_md_btn"
                      onClick={() => downloadMarkdown(s._id, s.name)}
                      disabled={markdownBusyId === s._id}
                      title="Download as Markdown"
                    >
                      {markdownBusyId === s._id ? "…" : "MD"}
                    </button>
                  )}
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
