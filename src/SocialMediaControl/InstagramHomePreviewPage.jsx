import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { apiUrl } from "../config/api";
import { readStoredSession } from "../utils/sessionCleanup";
import "./instagramHomePreviewPage.css";

const authHeaders = () => {
  const token = readStoredSession()?.token || "";
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const listToArray = (value) => Array.isArray(value) ? value : [];

const textToArray = (value) => String(value || "")
  .split(/\r?\n/)
  .map((item) => item.trim())
  .filter(Boolean);

const getPreviewMedia = (post) => (
  post?.mediaAssets?.[0]?.url
  || post?.mediaUrl
  || listToArray(post?.mediaUrls)[0]
  || textToArray(post?.mediaUrlsText)[0]
  || ""
);

const formatTimestamp = (value) => {
  if (!value) return "Not published yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not published yet";
  return date.toLocaleString();
};

const InstagramHomePreviewPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedPostId, setSelectedPostId] = useState("");

  useEffect(() => {
    const initialPostId = new URLSearchParams(location.search).get("post") || "";
    if (initialPostId) setSelectedPostId(initialPostId);
  }, [location.search]);

  useEffect(() => {
    const loadPosts = async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(apiUrl("/api/social-media/posts"), {
          headers: authHeaders(),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Failed to load social posts.");
        const nextPosts = data.posts || [];
        setPosts(nextPosts);
        setSelectedPostId((current) => current || nextPosts[0]?.id || "");
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    void loadPosts();
  }, []);

  const selectedPost = useMemo(
    () => posts.find((post) => post.id === selectedPostId) || posts[0] || null,
    [posts, selectedPostId],
  );

  const selectedMedia = getPreviewMedia(selectedPost);
  const hashtags = listToArray(selectedPost?.hashtags).length
    ? listToArray(selectedPost?.hashtags)
    : textToArray(selectedPost?.hashtagsText);

  return (
    <div id="ig_preview_page">
      <header id="ig_preview_header">
        <div>
          <p className="ig_preview_eyebrow">Instagram Home Preview</p>
          <h1>{selectedPost?.title || "MCTOSHS feed preview"}</h1>
          <p className="ig_preview_subtitle">
            A clean standalone tab for reviewing how your MCTOSHS Instagram post feels before publishing.
          </p>
        </div>
        <div className="ig_preview_actions">
          <button className="ig_preview_btn ig_preview_btn--ghost" onClick={() => navigate("/social-media-control")}>
            Back to Control
          </button>
          <Link
            className="ig_preview_btn ig_preview_btn--ghost"
            to={selectedPost?.id ? `/social-media-designer?post=${selectedPost.id}` : "/social-media-designer"}
          >
            Open Designer
          </Link>
          <Link className="ig_preview_btn ig_preview_btn--primary" to="/settings">
            Open Settings
          </Link>
        </div>
      </header>

      <main id="ig_preview_layout">
        <aside className="ig_preview_sidebar">
          <div className="ig_preview_sidebar_head">
            <p className="ig_preview_eyebrow">Draft Queue</p>
            <strong>{posts.length} posts</strong>
          </div>

          {loading ? <p className="ig_preview_empty">Loading drafts…</p> : null}
          {error ? <p className="ig_preview_empty ig_preview_empty--error">{error}</p> : null}
          {!loading && !error && posts.length === 0 ? <p className="ig_preview_empty">No saved social posts yet.</p> : null}

          <div className="ig_preview_post_list">
            {posts.map((post) => (
              <button
                key={post.id}
                type="button"
                className={`ig_preview_post_item${post.id === selectedPost?.id ? " ig_preview_post_item--active" : ""}`}
                onClick={() => setSelectedPostId(post.id)}
              >
                <span className="ig_preview_post_stage">{post.stage || "Drafting"}</span>
                <strong>{post.title || "Untitled post"}</strong>
                <span>{post.format || "Post"}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="ig_preview_canvas">
          <div className="ig_preview_single">
            <div className="ig_preview_phone_frame">
              <div className="ig_preview_phone_topbar">
                <span>MCTOSHS</span>
                <span>{selectedPost?.format || "Post"}</span>
              </div>
              <div className="ig_preview_phone_canvas">
                <div className="ig_preview_phone_tag">{selectedPost?.campaignId || "brand post"}</div>
                <h2>{selectedPost?.title || "Your preview will appear here"}</h2>
                <p>{selectedPost?.objective || "Add a title and objective to shape the post preview."}</p>
              </div>
            </div>

            <article className="ig_preview_post_card">
              <div className="ig_preview_post_card_head">
                <strong>Preview caption</strong>
                <span>{formatTimestamp(selectedPost?.publishedAt)}</span>
              </div>
              <p className="ig_preview_post_caption">
                {selectedPost?.caption || "Your caption preview will show here once you write it."}
              </p>
              {hashtags.length ? (
                <div className="ig_preview_tags">
                  {hashtags.slice(0, 8).map((tag) => <span key={tag}>{tag}</span>)}
                </div>
              ) : null}
              {selectedMedia ? (
                <div className="ig_preview_attached_media">
                  <img src={selectedMedia} alt={selectedPost?.title || "Attached post media"} />
                </div>
              ) : null}
            </article>
          </div>

          <section className="ig_preview_notes">
            <div className="ig_preview_note_card">
              <p className="ig_preview_eyebrow">Objective</p>
              <strong>{selectedPost?.objective || "No objective added yet."}</strong>
              <p>{selectedPost?.cta || "No CTA yet."}</p>
            </div>
            <div className="ig_preview_note_card">
              <p className="ig_preview_eyebrow">Asset status</p>
              <strong>{selectedMedia ? "Media attached" : "No media attached yet"}</strong>
              <p>{selectedPost?.lastPublishError || "No recent publish error for this draft."}</p>
            </div>
          </section>
        </section>
      </main>
    </div>
  );
};

export default InstagramHomePreviewPage;
