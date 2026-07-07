import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiUrl } from "../config/api";
import { readStoredSession } from "../utils/sessionCleanup";
import "./socialMediaControlPage.css";

const CAMPAIGNS = [
  {
    id: "feature-drop",
    label: "Feature Drop",
    accent: "#ff7a59",
    hook: "Show one sharp MCTOSHS capability with a concrete workflow payoff.",
    cta: "Invite viewers to try the feature or book a demo.",
    formats: ["Carousel", "Reel", "Story"],
    defaultTitle: "New MCTOSHS feature drop",
    defaultObjective: "Show the workflow value of one concrete MCTOSHS feature.",
    defaultSlides: ["Hook", "Problem", "Workflow", "Result", "CTA"],
  },
  {
    id: "clinical-education",
    label: "Clinical Education",
    accent: "#4fc3f7",
    hook: "Translate a clinical concept into structured, memorable slides.",
    cta: "Drive saves and shares from medical learners.",
    formats: ["Carousel", "Story"],
    defaultTitle: "Clinical concept through MCTOSHS",
    defaultObjective: "Teach a clinical idea through clear, structured visual steps.",
    defaultSlides: ["Hook", "Concept", "Structure", "Why it matters", "CTA"],
  },
  {
    id: "product-philosophy",
    label: "Product Philosophy",
    accent: "#9c6bff",
    hook: "Explain the MCTOSHS worldview and why representation matters.",
    cta: "Build brand depth and thoughtful engagement.",
    formats: ["Carousel", "Quote Post"],
    defaultTitle: "Why MCTOSHS exists",
    defaultObjective: "Express the philosophical core of the product in a shareable form.",
    defaultSlides: ["Question", "Thesis", "Implication", "Product view", "CTA"],
  },
  {
    id: "release-note",
    label: "Release Note",
    accent: "#7bd389",
    hook: "Announce a shipping update with clear before/after value.",
    cta: "Push existing followers back into the product.",
    formats: ["Single Image", "Carousel", "Story"],
    defaultTitle: "MCTOSHS release update",
    defaultObjective: "Announce a new capability with a before/after framing.",
    defaultSlides: ["Release", "Before", "After", "Use case", "CTA"],
  },
];

const FORMATS = ["Carousel", "Single Image", "Story", "Reel", "Quote Post"];
const STAGES = ["Drafting", "Needs review", "Ready to publish", "Scheduled", "Paused", "Published"];
const TONES = ["Professional", "Didactic", "Bold", "Minimal"];
const AUDIENCES = ["Medical students", "Clinicians", "Medical educators", "Digital health founders"];

const authHeaders = (json = true) => {
  const token = readStoredSession()?.token || "";
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  if (json) headers["Content-Type"] = "application/json";
  return headers;
};

const createPostPayload = (campaign) => ({
  title: campaign.defaultTitle,
  campaignId: campaign.id,
  format: campaign.formats[0] || "Carousel",
  stage: "Drafting",
  objective: campaign.defaultObjective,
  caption: `${campaign.hook} ${campaign.cta}`,
  tone: "Professional",
  audience: "Medical students",
  cta: campaign.cta,
  notes: "",
  assetBrief: `Visual direction: ${campaign.label}. Keep the message clear, editorial, and product-focused.`,
  mediaUrl: "",
  mediaUrls: [],
  mediaAssets: [],
  mediaUrlsText: "",
  slides: campaign.defaultSlides,
  hashtags: ["#MCTOSHS", "#DigitalHealth", "#MedicalEducation"],
  slidesText: campaign.defaultSlides.join("\n"),
  hashtagsText: ["#MCTOSHS", "#DigitalHealth", "#MedicalEducation"].join("\n"),
  scheduledFor: "",
});

const listToTextarea = (items) => Array.isArray(items) ? items.join("\n") : "";
const textareaToList = (value) => String(value || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
const formatDateTimeInput = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const inferAssetKind = (url, format = "") => {
  const lowerUrl = String(url || "").toLowerCase();
  if (/\.(mp4|mov|m4v|webm)(\?|$)/.test(lowerUrl)) return "video";
  if (String(format || "").trim().toLowerCase() === "reel") return "video";
  return "image";
};

const getReadinessCheck = (readiness, key) => (
  (readiness?.checks || []).find((check) => check.key === key) || null
);

const SocialMediaControlPage = () => {
  const navigate = useNavigate();
  const [posts, setPosts] = useState([]);
  const [postsLoading, setPostsLoading] = useState(true);
  const [postsError, setPostsError] = useState("");
  const [selectedPostId, setSelectedPostId] = useState("");
  const [selectedCampaignId, setSelectedCampaignId] = useState(CAMPAIGNS[0].id);
  const [editor, setEditor] = useState(createPostPayload(CAMPAIGNS[0]));
  const [saveState, setSaveState] = useState("idle");
  const [publishState, setPublishState] = useState("idle");
  const [uploadState, setUploadState] = useState("idle");
  const [copyState, setCopyState] = useState("idle");
  const [assetBusyUrl, setAssetBusyUrl] = useState("");
  const [preflight, setPreflight] = useState(null);
  const [preflightState, setPreflightState] = useState("idle");
  const [readiness, setReadiness] = useState(null);
  const [readinessLoading, setReadinessLoading] = useState(true);
  const [readinessError, setReadinessError] = useState("");
  const saveTimerRef = useRef(null);

  const selectedCampaign = useMemo(
    () => CAMPAIGNS.find((campaign) => campaign.id === selectedCampaignId) || CAMPAIGNS[0],
    [selectedCampaignId],
  );

  const selectedPost = useMemo(
    () => posts.find((post) => post.id === selectedPostId) || null,
    [posts, selectedPostId],
  );

  const weeklyQueue = useMemo(
    () => posts
      .filter((post) => post.scheduledFor || post.stage === "Ready to publish" || post.stage === "Scheduled")
      .slice()
      .sort((a, b) => new Date(a.scheduledFor || a.updatedAt) - new Date(b.scheduledFor || b.updatedAt))
      .slice(0, 4),
    [posts],
  );

  const previewAsset = useMemo(() => {
    const assets = Array.isArray(editor.mediaAssets) ? editor.mediaAssets : [];
    if (assets.length) return assets[0];
    if (editor.mediaUrl) return { url: editor.mediaUrl, kind: inferAssetKind(editor.mediaUrl, editor.format) };
    return null;
  }, [editor.mediaAssets, editor.mediaUrl, editor.format]);

  const generatedOutline = useMemo(() => ([
    `Hook for ${editor.audience}: make the pain visible in one sentence.`,
    `Demonstrate the ${selectedCampaign.label.toLowerCase()} workflow inside MCTOSHS.`,
    "Show the result in a compact before/after frame.",
    `Close with a ${editor.tone.toLowerCase()} CTA that invites saves, shares, or a product visit.`,
  ]), [editor.audience, editor.tone, selectedCampaign.label]);

  const readinessSummary = useMemo(() => {
    if (readinessLoading) {
      return {
        tone: "pending",
        title: "Checking Instagram connection",
        detail: "Loading your saved Meta publishing credentials and server readiness.",
      };
    }
    if (readinessError) {
      return {
        tone: "error",
        title: "Could not verify Instagram connection",
        detail: readinessError,
      };
    }

    const tokenCheck = getReadinessCheck(readiness, "access_token");
    const instagramCheck = getReadinessCheck(readiness, "instagram_account");
    const storageCheck = getReadinessCheck(readiness, "cloudinary_images");

    if (readiness?.isReady) {
      return {
        tone: "ok",
        title: "Instagram publishing is connected",
        detail: "Your Instagram account, access token, and media storage are configured for live publishing.",
      };
    }

    if (tokenCheck?.ok && (instagramCheck?.ok || storageCheck?.ok)) {
      return {
        tone: "warning",
        title: "Credentials are partially connected",
        detail: readiness?.nextStep || "One or more Instagram publishing fields still need attention before live publishing will work.",
      };
    }

    return {
      tone: "error",
      title: "Instagram publishing is not connected yet",
      detail: readiness?.nextStep || "Open Social Publish settings and save your Meta credentials first.",
    };
  }, [readiness, readinessError, readinessLoading]);

  const publishDisabledReason = useMemo(() => {
    if (!selectedPostId) return "Create or select a post first.";
    const assetCount = Math.max(
      Array.isArray(editor.mediaUrls) ? editor.mediaUrls.length : 0,
      textareaToList(editor.mediaUrlsText).length,
      Array.isArray(editor.mediaAssets) ? editor.mediaAssets.length : 0,
      editor.mediaUrl ? 1 : 0,
    );
    if (!assetCount) return "Add at least one public image or video before publishing.";
    if (readinessLoading) return "Instagram connection is still loading.";
    if (readinessError) return "Instagram readiness could not be verified.";
    if (!readiness?.isReady) return readiness?.nextStep || "Complete the Social Publish setup first.";
    return "";
  }, [editor.mediaAssets, editor.mediaUrl, editor.mediaUrls, editor.mediaUrlsText, readiness, readinessError, readinessLoading, selectedPostId]);

  useEffect(() => {
    const loadPosts = async () => {
      setPostsLoading(true);
      setPostsError("");
      try {
        const res = await fetch(apiUrl("/api/social-media/posts"), { headers: authHeaders(false) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Failed to load social posts.");
        const nextPosts = data.posts || [];
        setPosts(nextPosts);
        if (nextPosts.length) {
          const first = nextPosts[0];
          setSelectedPostId(first.id);
          setSelectedCampaignId(first.campaignId || CAMPAIGNS[0].id);
          setEditor({
            ...first,
            slidesText: listToTextarea(first.slides),
            hashtagsText: listToTextarea(first.hashtags),
            mediaUrlsText: listToTextarea(first.mediaUrls),
            scheduledFor: formatDateTimeInput(first.scheduledFor),
          });
        }
      } catch (err) {
        setPostsError(err.message);
      } finally {
        setPostsLoading(false);
      }
    };

    const loadReadiness = async () => {
      setReadinessLoading(true);
      setReadinessError("");
      try {
        const res = await fetch(apiUrl("/api/social-media/readiness"), { headers: authHeaders(false) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Failed to load publishing readiness.");
        setReadiness(data);
      } catch (err) {
        setReadinessError(err.message);
      } finally {
        setReadinessLoading(false);
      }
    };

    void loadPosts();
    void loadReadiness();

    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, []);

  const pushEditorFromPost = (post) => {
    setSelectedPostId(post.id);
    setSelectedCampaignId(post.campaignId || CAMPAIGNS[0].id);
    setEditor({
      ...post,
      slidesText: listToTextarea(post.slides),
      hashtagsText: listToTextarea(post.hashtags),
      mediaUrlsText: listToTextarea(post.mediaUrls),
      scheduledFor: formatDateTimeInput(post.scheduledFor),
    });
    setSaveState("idle");
    setPublishState("idle");
    setUploadState("idle");
    setCopyState("idle");
    setAssetBusyUrl("");
    setPreflight(null);
    setPreflightState("idle");
  };

  const reloadPost = async (postId) => {
    if (!postId) return null;
    const res = await fetch(apiUrl(`/api/social-media/posts/${postId}`), {
      headers: authHeaders(false),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Failed to reload this social post.");
    const nextPost = data.post;
    setPosts((prev) => [nextPost, ...prev.filter((post) => post.id !== nextPost.id)]);
    pushEditorFromPost(nextPost);
    return nextPost;
  };

  const persistPost = async (draftEditor) => {
    if (!selectedPostId) return;
    setSaveState("saving");
    try {
      const payload = {
        ...draftEditor,
        slides: textareaToList(draftEditor.slidesText),
        hashtags: textareaToList(draftEditor.hashtagsText),
        mediaUrls: textareaToList(draftEditor.mediaUrlsText),
        scheduledFor: draftEditor.scheduledFor || null,
      };
      payload.mediaAssets = payload.mediaUrls.map((url) => {
        const existing = (draftEditor.mediaAssets || []).find((asset) => asset.url === url);
        return existing || { url, kind: inferAssetKind(url, draftEditor.format) };
      });
      payload.mediaUrl = payload.mediaUrls[0] || draftEditor.mediaUrl || "";
      delete payload.id;
      delete payload.createdAt;
      delete payload.updatedAt;
      delete payload.slidesText;
      delete payload.hashtagsText;
      delete payload.mediaUrlsText;

      const res = await fetch(apiUrl(`/api/social-media/posts/${selectedPostId}`), {
        method: "PATCH",
        headers: authHeaders(true),
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to save this post.");
      const saved = data.post;
      setPosts((prev) => [saved, ...prev.filter((post) => post.id !== saved.id)]);
      setEditor((prev) => ({
        ...prev,
        ...saved,
        slidesText: listToTextarea(saved.slides),
        hashtagsText: listToTextarea(saved.hashtags),
        mediaUrlsText: listToTextarea(saved.mediaUrls),
        scheduledFor: formatDateTimeInput(saved.scheduledFor),
      }));
      setSaveState("saved");
      window.setTimeout(() => setSaveState((state) => (state === "saved" ? "idle" : state)), 1200);
    } catch (err) {
      setSaveState("error");
      setPostsError(err.message);
    }
  };

  const scheduleSave = (nextEditor) => {
    setEditor(nextEditor);
    if (!selectedPostId) return;
    setSaveState("dirty");
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      void persistPost(nextEditor);
    }, 700);
  };

  const handleSelectPost = (post) => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    pushEditorFromPost(post);
  };

  const handleCreatePost = async () => {
    const campaign = selectedCampaign;
    setPostsError("");
    try {
      const res = await fetch(apiUrl("/api/social-media/posts"), {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify(createPostPayload(campaign)),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to create a social post.");
      const post = data.post;
      setPosts((prev) => [post, ...prev]);
      pushEditorFromPost(post);
    } catch (err) {
      setPostsError(err.message);
    }
  };

  const handleDeletePost = async () => {
    if (!selectedPostId) return;
    if (!window.confirm("Delete this social post draft?")) return;
    setPostsError("");
    try {
      const res = await fetch(apiUrl(`/api/social-media/posts/${selectedPostId}`), {
        method: "DELETE",
        headers: authHeaders(false),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to delete this social post.");
      const nextPosts = posts.filter((post) => post.id !== selectedPostId);
      setPosts(nextPosts);
      if (nextPosts.length) pushEditorFromPost(nextPosts[0]);
      else {
        setSelectedPostId("");
        setEditor(createPostPayload(selectedCampaign));
      }
    } catch (err) {
      setPostsError(err.message);
    }
  };

  const handlePublishPost = async () => {
    if (!selectedPostId) return;
    setPostsError("");
    setPublishState("publishing");
    try {
      const res = await fetch(apiUrl(`/api/social-media/posts/${selectedPostId}/publish`), {
        method: "POST",
        headers: authHeaders(false),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to publish this Instagram post.");
      const publishedPost = data.post;
      setPosts((prev) => [publishedPost, ...prev.filter((post) => post.id !== publishedPost.id)]);
      pushEditorFromPost(publishedPost);
      setPublishState("published");
      window.setTimeout(() => setPublishState((state) => (state === "published" ? "idle" : state)), 1800);
    } catch (err) {
      setPublishState("error");
      try {
        await reloadPost(selectedPostId);
      } catch {}
      setPostsError(err.message);
    }
  };

  const handleGenerateCopy = async () => {
    if (!selectedPostId) return;
    setPostsError("");
    setCopyState("generating");
    try {
      const res = await fetch(apiUrl(`/api/social-media/posts/${selectedPostId}/generate-copy`), {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({ provider: "groq" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to generate social copy.");
      const nextPost = data.post;
      setPosts((prev) => [nextPost, ...prev.filter((post) => post.id !== nextPost.id)]);
      pushEditorFromPost(nextPost);
      setCopyState("done");
      window.setTimeout(() => setCopyState((state) => (state === "done" ? "idle" : state)), 1500);
    } catch (err) {
      setCopyState("error");
      setPostsError(err.message);
    }
  };

  const handleAssetUpload = async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!selectedPostId || !files.length) return;
    setPostsError("");
    setUploadState("uploading");
    try {
      const form = new FormData();
      files.forEach((file) => form.append("files", file));
      const res = await fetch(apiUrl(`/api/social-media/posts/${selectedPostId}/assets`), {
        method: "POST",
        headers: authHeaders(false),
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to upload assets.");
      const nextPost = data.post;
      setPosts((prev) => [nextPost, ...prev.filter((post) => post.id !== nextPost.id)]);
      pushEditorFromPost(nextPost);
      setUploadState("done");
      window.setTimeout(() => setUploadState((state) => (state === "done" ? "idle" : state)), 1500);
    } catch (err) {
      setUploadState("error");
      setPostsError(err.message);
    }
  };

  const handleRemoveAsset = async (url) => {
    if (!selectedPostId || !url) return;
    setPostsError("");
    setAssetBusyUrl(url);
    try {
      const res = await fetch(apiUrl(`/api/social-media/posts/${selectedPostId}/remove-asset`), {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({ url }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to remove this asset.");
      const nextPost = data.post;
      setPosts((prev) => [nextPost, ...prev.filter((post) => post.id !== nextPost.id)]);
      pushEditorFromPost(nextPost);
    } catch (err) {
      setPostsError(err.message);
    } finally {
      setAssetBusyUrl("");
    }
  };

  const handleRunPreflight = async () => {
    if (!selectedPostId) return;
    setPostsError("");
    setPreflightState("loading");
    try {
      const res = await fetch(apiUrl(`/api/social-media/posts/${selectedPostId}/preflight`), {
        headers: authHeaders(false),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to run preflight checks.");
      setPreflight(data);
      setPreflightState("done");
    } catch (err) {
      setPreflightState("error");
      setPostsError(err.message);
    }
  };

  const handleMoveAsset = (url, direction) => {
    const assets = Array.isArray(editor.mediaAssets) ? [...editor.mediaAssets] : [];
    const idx = assets.findIndex((asset) => asset.url === url);
    if (idx === -1) return;
    const targetIdx = direction === "up" ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= assets.length) return;
    const nextAssets = [...assets];
    const [moved] = nextAssets.splice(idx, 1);
    nextAssets.splice(targetIdx, 0, moved);
    scheduleSave({
      ...editor,
      mediaAssets: nextAssets,
      mediaUrls: nextAssets.map((asset) => asset.url),
      mediaUrl: nextAssets[0]?.url || "",
      mediaUrlsText: listToTextarea(nextAssets.map((asset) => asset.url)),
    });
  };

  const handleToggleScheduled = (post, nextStage) => {
    const nextEditor = {
      ...post,
      stage: nextStage,
      slidesText: listToTextarea(post.slides),
      hashtagsText: listToTextarea(post.hashtags),
      mediaUrlsText: listToTextarea(post.mediaUrls),
      scheduledFor: formatDateTimeInput(post.scheduledFor),
    };
    setSelectedPostId(post.id);
    setSelectedCampaignId(post.campaignId || CAMPAIGNS[0].id);
    scheduleSave(nextEditor);
  };

  const handleCampaignSelect = (campaignId) => {
    setSelectedCampaignId(campaignId);
    if (!selectedPostId) return;
    const campaign = CAMPAIGNS.find((item) => item.id === campaignId) || CAMPAIGNS[0];
    scheduleSave({
      ...editor,
      campaignId,
      format: campaign.formats.includes(editor.format) ? editor.format : (campaign.formats[0] || editor.format),
    });
  };

  const handleFieldChange = (field, value) => {
    scheduleSave({ ...editor, [field]: value });
  };

  const handleOpenPreviewTab = () => {
    const previewUrl = new URL(`${window.location.origin}/cvs/instagram-home-preview`);
    if (selectedPostId) previewUrl.searchParams.set("post", selectedPostId);
    window.open(previewUrl.toString(), "_blank", "noopener,noreferrer");
  };

  return (
    <div id="smc_page">
      <header id="smc_header">
        <div id="smc_header_left">
          <button id="smc_back_btn" onClick={() => navigate("/home")}>←</button>
          <div>
            <div id="smc_kicker">MCTOSHS Growth Surface</div>
            <h1 id="smc_title">Social Media Control</h1>
          </div>
        </div>
        <div id="smc_header_actions">
          <button className="smc_action_btn smc_action_btn--ghost" onClick={handleOpenPreviewTab}>
            Open Instagram Preview
          </button>
          <button className="smc_action_btn smc_action_btn--ghost" onClick={() => window.location.reload()}>
            Refresh Status
          </button>
          <button className="smc_action_btn smc_action_btn--primary" onClick={handleCreatePost}>
            New Post Draft
          </button>
        </div>
      </header>

      <main id="smc_body">
        <section id="smc_hero">
          <div id="smc_hero_copy">
            <p className="smc_section_eyebrow">Campaign Engine</p>
            <h2>Generate, store, review, and prepare MCTOSHS posts from one control room.</h2>
            <p>
              This page is now connected to a real backend draft store. Social posts
              live in MongoDB, autosave as you edit, and the Instagram readiness box
              reflects the server&apos;s actual Meta configuration state.
            </p>
          </div>

          <div id="smc_hero_metrics">
            <div className="smc_metric_card">
              <span className="smc_metric_value">{posts.length}</span>
              <span className="smc_metric_label">Saved post drafts</span>
            </div>
            <div className="smc_metric_card">
              <span className="smc_metric_value">{posts.filter((post) => post.stage === "Ready to publish").length}</span>
              <span className="smc_metric_label">Ready to publish</span>
            </div>
            <div className="smc_metric_card">
              <span className="smc_metric_value">{readiness?.readyCount ?? 0}/{readiness?.totalChecks ?? 4}</span>
              <span className="smc_metric_label">Instagram readiness checks</span>
            </div>
          </div>
        </section>

        {postsError && <div id="smc_status_banner" className="smc_status_banner--error">⚠ {postsError}</div>}

        <section className={`smc_connection_banner smc_connection_banner--${readinessSummary.tone}`}>
          <div className="smc_connection_copy">
            <p className="smc_section_eyebrow">Instagram Connection</p>
            <h3>{readinessSummary.title}</h3>
            <p>{readinessSummary.detail}</p>
          </div>
          <div className="smc_connection_actions">
            <button className="smc_action_btn smc_action_btn--ghost" onClick={() => navigate("/settings")}>
              Open Social Publish Settings
            </button>
            <button className="smc_action_btn smc_action_btn--ghost" onClick={() => window.location.reload()}>
              Recheck Connection
            </button>
          </div>
        </section>

        <section className="smc_grid smc_grid--top">
          <article className="smc_panel">
            <div className="smc_panel_head">
              <div>
                <p className="smc_section_eyebrow">Campaign Templates</p>
                <h3>Choose the post strategy</h3>
              </div>
            </div>

            <div className="smc_campaign_list">
              {CAMPAIGNS.map((campaign) => (
                <button
                  key={campaign.id}
                  className={`smc_campaign_card${campaign.id === selectedCampaignId ? " smc_campaign_card--active" : ""}`}
                  onClick={() => handleCampaignSelect(campaign.id)}
                >
                  <div className="smc_campaign_top">
                    <span className="smc_campaign_name">{campaign.label}</span>
                    <span className="smc_campaign_formats">{campaign.formats.join(" · ")}</span>
                  </div>
                  <p className="smc_campaign_text">{campaign.hook}</p>
                  <p className="smc_campaign_cta">{campaign.cta}</p>
                </button>
              ))}
            </div>
          </article>

          <article className="smc_panel smc_panel--generator">
            <div className="smc_panel_head">
              <div>
                <p className="smc_section_eyebrow">Caption Studio</p>
                <h3>Shape the live post brief</h3>
              </div>
              <div className={`smc_save_state smc_save_state--${saveState}`}>
                {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : saveState === "error" ? "Save error" : saveState === "dirty" ? "Unsaved changes" : "Synced"}
              </div>
            </div>

            <div className="smc_form">
              <label className="smc_field">
                <span>Tone</span>
                <select value={editor.tone} onChange={(e) => handleFieldChange("tone", e.target.value)}>
                  {TONES.map((tone) => <option key={tone}>{tone}</option>)}
                </select>
              </label>

              <label className="smc_field">
                <span>Audience</span>
                <select value={editor.audience} onChange={(e) => handleFieldChange("audience", e.target.value)}>
                  {AUDIENCES.map((audience) => <option key={audience}>{audience}</option>)}
                </select>
              </label>

              <label className="smc_field">
                <span>Format</span>
                <select value={editor.format} onChange={(e) => handleFieldChange("format", e.target.value)}>
                  {FORMATS.map((format) => <option key={format}>{format}</option>)}
                </select>
              </label>

              <label className="smc_field">
                <span>Stage</span>
                <select value={editor.stage} onChange={(e) => handleFieldChange("stage", e.target.value)}>
                  {STAGES.map((stage) => <option key={stage}>{stage}</option>)}
                </select>
              </label>
            </div>

            <div className="smc_toolbar_row">
              <button className="smc_action_btn smc_action_btn--ghost smc_action_btn--small" onClick={handleGenerateCopy} disabled={!selectedPostId || copyState === "generating"}>
                {copyState === "generating" ? "Generating copy…" : copyState === "done" ? "Copy generated" : "Generate AI Copy"}
              </button>
              <label className="smc_upload_btn">
                <input type="file" accept="image/*,video/*" multiple onChange={handleAssetUpload} />
                {uploadState === "uploading" ? "Uploading assets…" : uploadState === "done" ? "Assets uploaded" : "Upload Assets"}
              </label>
              <button className="smc_action_btn smc_action_btn--ghost smc_action_btn--small" onClick={handleRunPreflight} disabled={!selectedPostId || preflightState === "loading"}>
                {preflightState === "loading" ? "Checking…" : "Run Preflight"}
              </button>
            </div>

            <div id="smc_generated_brief">
              <div className="smc_brief_chip">Selected: {selectedCampaign.label}</div>
              <ul>
                {generatedOutline.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </article>
        </section>

        <section className="smc_grid smc_grid--bottom">
          <article className="smc_panel">
            <div className="smc_panel_head">
              <div>
                <p className="smc_section_eyebrow">Post Queue</p>
                <h3>Real saved social drafts</h3>
              </div>
              <div className="smc_panel_head_actions">
                <button className="smc_action_btn smc_action_btn--primary smc_action_btn--small" onClick={handleCreatePost}>
                  Create Post Here
                </button>
                <button className="smc_action_btn smc_action_btn--ghost smc_action_btn--small" onClick={handleDeletePost} disabled={!selectedPostId}>
                  Delete Post
                </button>
              </div>
            </div>

            {postsLoading ? (
              <p className="smc_empty_state">Loading social drafts…</p>
            ) : posts.length === 0 ? (
              <p className="smc_empty_state">No saved social posts yet. Create your first post to start the control queue.</p>
            ) : (
              <div id="smc_post_layout">
                <div id="smc_post_list">
                  {posts.map((post) => (
                    <div
                      key={post.id}
                      role="button"
                      tabIndex={0}
                      className={`smc_post_item${post.id === selectedPostId ? " smc_post_item--active" : ""}`}
                      onClick={() => handleSelectPost(post)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleSelectPost(post); } }}
                    >
                      <div className="smc_post_item_top">
                        <span>{post.title}</span>
                        <span className="smc_stage_badge" data-stage={post.stage}>{post.stage}</span>
                      </div>
                      <span className="smc_post_item_type">{post.format}</span>
                      {post.stage === "Scheduled" && (
                        <button type="button" className="smc_queue_btn" onClick={(e) => { e.stopPropagation(); handleToggleScheduled(post, "Paused"); }}>
                          Pause
                        </button>
                      )}
                      {post.stage === "Paused" && (
                        <button type="button" className="smc_queue_btn" onClick={(e) => { e.stopPropagation(); handleToggleScheduled(post, "Scheduled"); }}>
                          Resume
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                <div id="smc_post_detail">
                  <div className="smc_post_preview">
                    <div className="smc_phone_frame">
                      <div className="smc_phone_topbar">
                        <span>MCTOSHS</span>
                        <span>{editor.format}</span>
                      </div>
                      <div className="smc_phone_canvas">
                        {previewAsset ? (
                          previewAsset.kind === "video" ? (
                            <video className="smc_phone_media" src={previewAsset.url} controls muted playsInline />
                          ) : (
                            <img className="smc_phone_media" src={previewAsset.url} alt="" />
                          )
                        ) : null}
                        <div className="smc_phone_content">
                          <div className="smc_phone_tag">{selectedCampaign.label}</div>
                          <h4>{editor.title || "Untitled social post"}</h4>
                          <p>{editor.objective || "Add an objective to frame the creative."}</p>
                        </div>
                      </div>
                    </div>

                    <div className="smc_preview_launch">
                      <p className="smc_section_eyebrow">Standalone Preview</p>
                      <strong>Review this post in a dedicated Instagram-style tab.</strong>
                      <p>
                        Open a cleaner preview page so you can browse the post without the crowded editor and switch between drafts there.
                      </p>
                      <button className="smc_action_btn smc_action_btn--primary" onClick={handleOpenPreviewTab}>
                        Open Preview In New Tab
                      </button>
                    </div>
                  </div>

                  <div className="smc_post_copy smc_editor_stack">
                    <div className={`smc_publish_state smc_publish_state--${publishState}`}>
                      {publishState === "publishing"
                        ? "Publishing to Instagram…"
                        : publishState === "published"
                          ? "Published successfully."
                          : publishState === "error"
                            ? "Publishing failed."
                            : editor.publishStatus || "Not published"}
                    </div>

                    <div className="smc_publish_meta">
                      <span>Assets: {Math.max(Array.isArray(editor.mediaUrls) ? editor.mediaUrls.length : 0, textareaToList(editor.mediaUrlsText).length)}</span>
                      <span>{editor.publishedAt ? `Published ${new Date(editor.publishedAt).toLocaleString()}` : "Not yet published"}</span>
                    </div>

                    <label className="smc_field">
                      <span>Title</span>
                      <input value={editor.title || ""} onChange={(e) => handleFieldChange("title", e.target.value)} />
                    </label>

                    <label className="smc_field">
                      <span>Objective</span>
                      <textarea rows={3} value={editor.objective || ""} onChange={(e) => handleFieldChange("objective", e.target.value)} />
                    </label>

                    <label className="smc_field">
                      <span>Caption</span>
                      <textarea rows={6} value={editor.caption || ""} onChange={(e) => handleFieldChange("caption", e.target.value)} />
                    </label>

                    <div className="smc_editor_duo">
                      <label className="smc_field">
                        <span>Slides</span>
                        <textarea rows={5} value={editor.slidesText || ""} onChange={(e) => handleFieldChange("slidesText", e.target.value)} />
                      </label>

                      <label className="smc_field">
                        <span>Hashtags</span>
                        <textarea rows={5} value={editor.hashtagsText || ""} onChange={(e) => handleFieldChange("hashtagsText", e.target.value)} />
                      </label>
                    </div>

                    <div className="smc_editor_duo">
                      <label className="smc_field">
                        <span>Primary Media URL</span>
                        <input value={editor.mediaUrl || ""} onChange={(e) => handleFieldChange("mediaUrl", e.target.value)} placeholder="https://..." />
                      </label>

                      <label className="smc_field">
                        <span>Call To Action</span>
                        <input value={editor.cta || ""} onChange={(e) => handleFieldChange("cta", e.target.value)} />
                      </label>
                    </div>

                    <div className="smc_editor_duo">
                      <label className="smc_field">
                        <span>All Media URLs</span>
                        <textarea rows={5} value={editor.mediaUrlsText || ""} onChange={(e) => handleFieldChange("mediaUrlsText", e.target.value)} placeholder="One public image or video URL per line" />
                      </label>

                      <label className="smc_field">
                        <span>Scheduled Time</span>
                        <input type="datetime-local" value={editor.scheduledFor || ""} onChange={(e) => handleFieldChange("scheduledFor", e.target.value)} />
                      </label>
                    </div>

                    <div className="smc_editor_duo">
                      <label className="smc_field">
                        <span>Instagram Publish ID</span>
                        <input value={editor.lastPublishId || ""} readOnly placeholder="Will appear after publishing" />
                      </label>

                      <div className="smc_asset_stack">
                        <span className="smc_asset_label">Uploaded Assets</span>
                        <label className="smc_device_upload">
                          <input type="file" accept="image/*,video/*" multiple onChange={handleAssetUpload} />
                          <span className="smc_device_upload_title">
                            {uploadState === "uploading" ? "Uploading from device…" : "Upload Media From Device"}
                          </span>
                          <span className="smc_device_upload_text">
                            Choose images or videos from your computer or phone. Uploaded files are stored and added to this post automatically.
                          </span>
                        </label>
                        <div className="smc_asset_list">
                          {(editor.mediaAssets || []).length
                            ? editor.mediaAssets.map((asset) => (
                                <div key={`${asset.kind}:${asset.url}`} className="smc_asset_row">
                                <a href={asset.url} target="_blank" rel="noreferrer" className="smc_asset_chip">
                                  <span className="smc_asset_kind">{asset.kind}</span>
                                  {asset.url}
                                </a>
                                <button type="button" className="smc_asset_order" onClick={() => handleMoveAsset(asset.url, "up")}>↑</button>
                                <button type="button" className="smc_asset_order" onClick={() => handleMoveAsset(asset.url, "down")}>↓</button>
                                <button
                                  type="button"
                                  className="smc_asset_remove"
                                    onClick={() => handleRemoveAsset(asset.url)}
                                    disabled={assetBusyUrl === asset.url}
                                  >
                                    {assetBusyUrl === asset.url ? "Removing…" : "Remove"}
                                  </button>
                                </div>
                              ))
                            : <span className="smc_asset_empty">No uploaded assets yet.</span>}
                        </div>
                      </div>
                    </div>

                    <label className="smc_field">
                      <span>Asset Brief</span>
                      <textarea rows={3} value={editor.assetBrief || ""} onChange={(e) => handleFieldChange("assetBrief", e.target.value)} />
                    </label>

                    <label className="smc_field">
                      <span>Internal Notes</span>
                      <textarea rows={3} value={editor.notes || ""} onChange={(e) => handleFieldChange("notes", e.target.value)} />
                    </label>

                    <label className="smc_field">
                      <span>Last Publish Error</span>
                      <textarea rows={2} value={editor.lastPublishError || ""} readOnly placeholder="If Meta rejects the publish request, the error will appear here." />
                    </label>

                    <div className="smc_publish_actions">
                      <button
                        className="smc_action_btn smc_action_btn--primary"
                        onClick={handlePublishPost}
                        disabled={publishState === "publishing" || Boolean(publishDisabledReason)}
                      >
                        {publishState === "publishing"
                          ? "Publishing…"
                          : editor.publishStatus === "Publish failed"
                            ? "Retry Publish"
                            : "Publish To Instagram"}
                      </button>
                      <span className="smc_publish_hint">
                        Supports single-image posts, image-only carousels, and reels from a public video URL. Scheduled posts marked `Scheduled` auto-publish after their scheduled time.
                      </span>
                    </div>
                    {publishDisabledReason && (
                      <div className="smc_publish_reason">
                        {publishDisabledReason}
                      </div>
                    )}

                    <div className="smc_preflight_block">
                      <h4>Preflight</h4>
                      {preflight ? (
                        <div className="smc_preflight_list">
                          {preflight.checks.map((check) => (
                            <div key={check.key} className={`smc_preflight_item smc_preflight_item--${check.level}`}>
                              <strong>{check.label}</strong>
                              <p>{check.detail}</p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="smc_empty_state">Run preflight to check caption, assets, scheduling, and server readiness before publishing.</p>
                      )}
                    </div>

                    <div className="smc_history_block">
                      <h4>Activity</h4>
                      <div className="smc_history_list">
                        {(editor.history || []).length
                          ? editor.history.map((item, idx) => (
                              <div key={`${item.at || idx}-${item.action || idx}`} className="smc_history_item">
                                <div className="smc_history_top">
                                  <strong>{item.action || "event"}</strong>
                                  <span>{item.status || ""}</span>
                                </div>
                                <p>{item.detail || ""}</p>
                                <div className="smc_history_meta">
                                  <span>{item.at ? new Date(item.at).toLocaleString() : ""}</span>
                                  {item.meta ? <span>{item.meta}</span> : null}
                                </div>
                              </div>
                            ))
                          : <p className="smc_empty_state">No activity yet for this post.</p>}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </article>

          <article className="smc_panel smc_panel--side">
            <div className="smc_panel_head">
              <div>
                <p className="smc_section_eyebrow">Publishing Readiness</p>
                <h3>Server-side Instagram status</h3>
              </div>
            </div>

            {readinessLoading ? (
              <p className="smc_empty_state">Loading readiness checks…</p>
            ) : readinessError ? (
              <p className="smc_empty_state smc_empty_state--error">⚠ {readinessError}</p>
            ) : (
              <>
                <div className={`smc_readiness_summary${readiness?.isReady ? " smc_readiness_summary--ok" : ""}`}>
                  <strong>{readiness?.isReady ? "Ready for live publishing" : "Not fully configured yet"}</strong>
                  <p>{readiness?.nextStep}</p>
                </div>

                <div className="smc_checklist">
                  {(readiness?.checks || []).map((check) => (
                    <div key={check.key} className="smc_check_row">
                      <span className={`smc_check_icon${check.ok ? " smc_check_icon--ok" : " smc_check_icon--off"}`}>{check.ok ? "●" : "○"}</span>
                      <div>
                        <strong>{check.label}</strong>
                        <span>{check.detail}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            <div className="smc_week_plan">
              <h4>Next queue</h4>
              {weeklyQueue.length ? (
                weeklyQueue.map((slot) => (
                  <div key={slot.id} className="smc_week_row">
                    <span className="smc_week_day">
                      {slot.scheduledFor ? new Date(slot.scheduledFor).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "Soon"}
                    </span>
                    <div>
                      <strong>{slot.format}</strong>
                      <p>{slot.title}</p>
                      <div className="smc_week_actions">
                        {slot.stage === "Scheduled" && <button type="button" className="smc_queue_btn" onClick={() => handleToggleScheduled(slot, "Paused")}>Pause</button>}
                        {slot.stage === "Paused" && <button type="button" className="smc_queue_btn" onClick={() => handleToggleScheduled(slot, "Scheduled")}>Resume</button>}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <p className="smc_empty_state">No queued posts yet. Mark a post ready or give it a schedule time.</p>
              )}
            </div>
          </article>
        </section>
      </main>
    </div>
  );
};

export default SocialMediaControlPage;
