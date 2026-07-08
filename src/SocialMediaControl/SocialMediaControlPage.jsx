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

  const handleOpenDesignerTab = () => {
    const designerUrl = new URL(`${window.location.origin}/cvs/social-media-designer`);
    if (selectedPostId) designerUrl.searchParams.set("post", selectedPostId);
    window.open(designerUrl.toString(), "_blank", "noopener,noreferrer");
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
          <button className="smc_action_btn smc_action_btn--primary" onClick={handleOpenDesignerTab}>
            Open Design Studio
          </button>
          <button className="smc_action_btn smc_action_btn--ghost" onClick={handleOpenPreviewTab}>
            Open Instagram Preview
          </button>
          <button className="smc_action_btn smc_action_btn--ghost" onClick={() => window.location.reload()}>
            Refresh Status
          </button>
          <button className="smc_action_btn smc_action_btn--ghost" onClick={handleCreatePost}>
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

        <section className="smc_designer_strip">
          <div className="smc_designer_strip_copy">
            <p className="smc_section_eyebrow">Designer Flow</p>
            <h3>The separate designer is now the main creation workspace.</h3>
            <p>
              Choose a campaign here, then open the standalone designer to build the artwork. Social Media Control stays focused on drafts, publishing, and queue management.
            </p>
          </div>
          <div className="smc_designer_strip_controls">
            <div className="smc_designer_campaigns">
              {CAMPAIGNS.map((campaign) => (
                <button
                  key={campaign.id}
                  className={`smc_campaign_pill${campaign.id === selectedCampaignId ? " smc_campaign_pill--active" : ""}`}
                  onClick={() => handleCampaignSelect(campaign.id)}
                >
                  {campaign.label}
                </button>
              ))}
            </div>
            <div className="smc_designer_actions">
              <button className="smc_action_btn smc_action_btn--ghost" onClick={handleGenerateCopy} disabled={!selectedPostId || copyState === "generating"}>
                {copyState === "generating" ? "Generating copy…" : copyState === "done" ? "Copy generated" : "Generate AI Copy"}
              </button>
              <button className="smc_action_btn smc_action_btn--ghost" onClick={handleRunPreflight} disabled={!selectedPostId || preflightState === "loading"}>
                {preflightState === "loading" ? "Checking…" : "Run Preflight"}
              </button>
              <button className="smc_action_btn smc_action_btn--primary" onClick={handleOpenDesignerTab}>
                Open Designer
              </button>
            </div>
          </div>
        </section>

        <section className="smc_grid smc_grid--bottom">
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
