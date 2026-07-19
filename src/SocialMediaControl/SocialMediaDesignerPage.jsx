import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Group, Image as KonvaImage, Layer, Rect, Stage, Text, Transformer } from "react-konva";
import { apiUrl } from "../config/api";
import { readStoredSession } from "../utils/sessionCleanup";
import "./socialMediaDesignerPage.css";

const DESIGN_PRESETS = {
  square: { width: 1080, height: 1080, label: "Square 1080 x 1080" },
  portrait: { width: 1080, height: 1350, label: "Portrait 1080 x 1350" },
  story: { width: 1080, height: 1920, label: "Story 1080 x 1920" },
};

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

const getPresetKeyForPost = (post) => {
  const format = String(post?.format || "").toLowerCase();
  if (format.includes("story") || format.includes("reel")) return "story";
  if (format.includes("single")) return "square";
  return "portrait";
};

const getDefaultGradient = (campaignId) => {
  switch (campaignId) {
    case "clinical-education":
      return ["#24466c", "#61d4ff"];
    case "product-philosophy":
      return ["#47235e", "#d68eff"];
    case "release-note":
      return ["#1d5b43", "#7bd389"];
    default:
      return ["#ff7a59", "#4fc3f7"];
  }
};

const sanitizeFileName = (value) => String(value || "mctoshs-post")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "")
  || "mctoshs-post";

const formatCampaignLabel = (campaignId) => String(campaignId || "brand post")
  .replace(/-/g, " ")
  .toUpperCase();

const useLoadedImage = (src) => {
  const [image, setImage] = useState(null);

  useEffect(() => {
    if (!src) {
      setImage(null);
      return;
    }

    const nextImage = new window.Image();
    nextImage.crossOrigin = "anonymous";
    nextImage.onload = () => setImage(nextImage);
    nextImage.onerror = () => setImage(null);
    nextImage.src = src;
  }, [src]);

  return image;
};

const makeElementId = (prefix) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;

const getCoverCrop = (image, width, height) => {
  if (!image?.width || !image?.height || !width || !height) return undefined;
  const frameRatio = width / height;
  const imageRatio = image.width / image.height;

  if (imageRatio > frameRatio) {
    const cropWidth = image.height * frameRatio;
    return {
      x: (image.width - cropWidth) / 2,
      y: 0,
      width: cropWidth,
      height: image.height,
    };
  }

  const cropHeight = image.width / frameRatio;
  return {
    x: 0,
    y: (image.height - cropHeight) / 2,
    width: image.width,
    height: cropHeight,
  };
};

const createDesignFromPost = (post, presetKey) => {
  const preset = DESIGN_PRESETS[presetKey] || DESIGN_PRESETS.portrait;
  const mediaUrl = getPreviewMedia(post);
  const gradient = getDefaultGradient(post?.campaignId);

  const elements = [
    {
      id: "overlay",
      kind: "rect",
      x: 0,
      y: 0,
      width: preset.width,
      height: preset.height,
      fill: mediaUrl ? "rgba(9, 12, 20, 0.36)" : "rgba(255,255,255,0)",
      locked: true,
    },
    {
      id: "badge-bg",
      kind: "rect",
      x: 68,
      y: 72,
      width: Math.min(340, preset.width - 136),
      height: 58,
      fill: "rgba(255,255,255,0.78)",
      cornerRadius: 999,
      locked: false,
    },
    {
      id: "badge",
      kind: "text",
      x: 94,
      y: 89,
      width: Math.min(280, preset.width - 188),
      text: formatCampaignLabel(post?.campaignId),
      fontSize: 24,
      fontStyle: "bold",
      fill: "#1b1022",
      locked: false,
    },
    {
      id: "title",
      kind: "text",
      x: 86,
      y: Math.max(210, Math.round(preset.height * 0.48)),
      width: preset.width - 172,
      text: post?.title || "AMCTOSHS post",
      fontSize: presetKey === "story" ? 92 : 74,
      fontStyle: "bold",
      fill: "#ffffff",
      locked: false,
    },
    {
      id: "objective",
      kind: "text",
      x: 92,
      y: Math.max(380, Math.round(preset.height * 0.69)),
      width: preset.width - 184,
      text: post?.objective || "Add an objective for this post.",
      fontSize: presetKey === "story" ? 34 : 28,
      fontStyle: "normal",
      fill: "rgba(255,255,255,0.95)",
      locked: false,
    },
  ];

  if (mediaUrl) {
    elements.unshift({
      id: "media",
      kind: "image",
      x: 0,
      y: 0,
      width: preset.width,
      height: preset.height,
      src: mediaUrl,
      locked: true,
    });
  }

  return {
    width: preset.width,
    height: preset.height,
    backgroundStart: gradient[0],
    backgroundEnd: gradient[1],
    elements,
  };
};

const downloadDataUrl = (dataUrl, fileName) => {
  const link = document.createElement("a");
  link.download = fileName;
  link.href = dataUrl;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

const KonvaElement = ({ element, isSelected, onSelect, onChange }) => {
  const shapeRef = useRef(null);
  const transformerRef = useRef(null);
  const image = useLoadedImage(element.src);
  const crop = useMemo(
    () => (element.kind === "image" ? getCoverCrop(image, element.width, element.height) : undefined),
    [element.height, element.kind, element.width, image],
  );

  useEffect(() => {
    if (!isSelected || !transformerRef.current || !shapeRef.current) return;
    transformerRef.current.nodes([shapeRef.current]);
    transformerRef.current.getLayer()?.batchDraw();
  }, [isSelected]);

  const commonProps = {
    ref: shapeRef,
    x: element.x,
    y: element.y,
    rotation: element.rotation || 0,
    draggable: !element.locked,
    onClick: onSelect,
    onTap: onSelect,
    onDragEnd: (event) => {
      onChange({
        ...element,
        x: event.target.x(),
        y: event.target.y(),
      });
    },
    onTransformEnd: () => {
      const node = shapeRef.current;
      if (!node) return;
      const scaleX = node.scaleX();
      const scaleY = node.scaleY();
      node.scaleX(1);
      node.scaleY(1);

      if (element.kind === "text") {
        onChange({
          ...element,
          x: node.x(),
          y: node.y(),
          width: Math.max(120, node.width() * scaleX),
          fontSize: Math.max(16, (element.fontSize || 20) * scaleY),
          rotation: node.rotation(),
        });
        return;
      }

      onChange({
        ...element,
        x: node.x(),
        y: node.y(),
        width: Math.max(40, node.width() * scaleX),
        height: Math.max(40, node.height() * scaleY),
        rotation: node.rotation(),
      });
    },
  };

  return (
    <>
      {element.kind === "rect" ? (
        <Rect
          {...commonProps}
          width={element.width}
          height={element.height}
          fill={element.fill}
          cornerRadius={element.cornerRadius || 0}
        />
      ) : null}
      {element.kind === "text" ? (
        <Text
          {...commonProps}
          width={element.width}
          text={element.text}
          fontSize={element.fontSize}
          fontStyle={element.fontStyle}
          fill={element.fill}
          lineHeight={1.15}
        />
      ) : null}
      {element.kind === "image" && image ? (
        <Group
          x={element.x}
          y={element.y}
          rotation={element.rotation || 0}
          clipX={0}
          clipY={0}
          clipWidth={element.width}
          clipHeight={element.height}
          onClick={onSelect}
          onTap={onSelect}
        >
          <KonvaImage
            ref={shapeRef}
            image={image}
            x={0}
            y={0}
            width={element.width}
            height={element.height}
            crop={crop}
          />
        </Group>
      ) : null}
      {isSelected && !element.locked ? (
        <Transformer
          ref={transformerRef}
          rotateEnabled
          enabledAnchors={
            element.kind === "text"
              ? ["middle-left", "middle-right"]
              : ["top-left", "top-right", "bottom-left", "bottom-right"]
          }
          boundBoxFunc={(oldBox, nextBox) => {
            if (nextBox.width < 40 || nextBox.height < 40) return oldBox;
            return nextBox;
          }}
        />
      ) : null}
    </>
  );
};

const SocialMediaDesignerPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const stageRef = useRef(null);
  const canvasWrapRef = useRef(null);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedPostId, setSelectedPostId] = useState("");
  const [presetKey, setPresetKey] = useState("portrait");
  const [design, setDesign] = useState(createDesignFromPost(null, "portrait"));
  const [selectedElementId, setSelectedElementId] = useState("");
  const [exportState, setExportState] = useState("idle");
  const [canvasViewport, setCanvasViewport] = useState({ width: 960, height: 620 });

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
        const initialPostId = new URLSearchParams(location.search).get("post") || "";
        const initialPost = nextPosts.find((post) => post.id === initialPostId) || nextPosts[0] || null;
        const nextPresetKey = getPresetKeyForPost(initialPost);
        setPosts(nextPosts);
        setSelectedPostId(initialPost?.id || "");
        setPresetKey(nextPresetKey);
        setDesign(createDesignFromPost(initialPost, nextPresetKey));
        setSelectedElementId("");
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    void loadPosts();
  }, [location.search]);

  useEffect(() => {
    if (!canvasWrapRef.current) return undefined;

    const updateViewport = () => {
      const el = canvasWrapRef.current;
      if (!el) return;
      // clientWidth/Height include the wrap's own padding — read it back out
      // via computed style so the stage is sized to fit *inside* that
      // padding, not flush against it (which forced the wrap to scroll to
      // show the last ~18px of a stage that was scaled to its full box).
      const cs = window.getComputedStyle(el);
      const paddingX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
      const paddingY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
      const nextWidth = Math.max(1, (el.clientWidth || 960) - paddingX);
      const nextHeight = Math.max(1, (el.clientHeight || 620) - paddingY);
      setCanvasViewport({ width: nextWidth, height: nextHeight });
    };

    updateViewport();

    const observer = new window.ResizeObserver(updateViewport);
    observer.observe(canvasWrapRef.current);
    return () => observer.disconnect();
  }, []);

  const selectedPost = useMemo(
    () => posts.find((post) => post.id === selectedPostId) || posts[0] || null,
    [posts, selectedPostId],
  );

  const selectedElement = useMemo(
    () => design.elements.find((element) => element.id === selectedElementId) || null,
    [design.elements, selectedElementId],
  );

  const stageScale = useMemo(
    () => Math.min(
      1,
      canvasViewport.width / Math.max(1, design.width),
      canvasViewport.height / Math.max(1, design.height),
    ),
    [canvasViewport.height, canvasViewport.width, design.height, design.width],
  );

  const fittedStageSize = useMemo(
    () => ({
      width: Math.max(1, Math.round(design.width * stageScale)),
      height: Math.max(1, Math.round(design.height * stageScale)),
    }),
    [design.height, design.width, stageScale],
  );

  const selectedMedia = getPreviewMedia(selectedPost);

  const updateElement = (elementId, updater) => {
    setDesign((current) => ({
      ...current,
      elements: current.elements.map((element) => (
        element.id === elementId
          ? { ...element, ...updater(element) }
          : element
      )),
    }));
  };

  const handleSelectPost = (post) => {
    const nextPresetKey = getPresetKeyForPost(post);
    setSelectedPostId(post.id);
    setPresetKey(nextPresetKey);
    setDesign(createDesignFromPost(post, nextPresetKey));
    setSelectedElementId("");
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("post", post.id);
    window.history.replaceState({}, "", nextUrl.toString());
  };

  const handlePresetChange = (nextPresetKey) => {
    setPresetKey(nextPresetKey);
    setDesign(createDesignFromPost(selectedPost, nextPresetKey));
    setSelectedElementId("");
  };

  const handleReloadDraft = () => {
    setDesign(createDesignFromPost(selectedPost, presetKey));
    setSelectedElementId("");
  };

  const handleExportImage = () => {
    if (!stageRef.current) return;
    setExportState("exporting");
    try {
      const dataUrl = stageRef.current.toDataURL({
        pixelRatio: Math.max(2, 2 / Math.max(stageScale, 0.2)),
      });
      downloadDataUrl(dataUrl, `${sanitizeFileName(selectedPost?.title)}.png`);
      setExportState("done");
      window.setTimeout(() => setExportState((state) => (state === "done" ? "idle" : state)), 1600);
    } catch (err) {
      setError(err.message || "Failed to export this design.");
      setExportState("error");
    }
  };

  const handleAddTextBlock = () => {
    const nextId = makeElementId("text");
    setDesign((current) => ({
      ...current,
      elements: [
        ...current.elements,
        {
          id: nextId,
          kind: "text",
          x: 120,
          y: 140,
          width: current.width - 240,
          text: "New text block",
          fontSize: 36,
          fontStyle: "bold",
          fill: "#ffffff",
          locked: false,
        },
      ],
    }));
    setSelectedElementId(nextId);
  };

  const handleAddPanel = () => {
    const nextId = makeElementId("panel");
    setDesign((current) => ({
      ...current,
      elements: [
        ...current.elements,
        {
          id: nextId,
          kind: "rect",
          x: 120,
          y: 120,
          width: 420,
          height: 220,
          fill: "rgba(255,255,255,0.16)",
          cornerRadius: 24,
          locked: false,
        },
      ],
    }));
    setSelectedElementId(nextId);
  };

  const handleDeleteSelected = () => {
    if (!selectedElement || ["media", "overlay"].includes(selectedElement.id)) return;
    setDesign((current) => ({
      ...current,
      elements: current.elements.filter((element) => element.id !== selectedElement.id),
    }));
    setSelectedElementId("");
  };

  return (
    <div id="smd_page">
      <header id="smd_header">
        <div className="smd_header_title">
          <p className="smd_eyebrow">React Konva Design Studio</p>
          <h1>Create real Instagram post artwork</h1>
        </div>
        <div className="smd_header_actions">
          <button className="smd_btn smd_btn--ghost" onClick={() => navigate("/social-media-control")}>
            Back to Control
          </button>
          <Link className="smd_btn smd_btn--ghost" to={selectedPost?.id ? `/instagram-home-preview?post=${selectedPost.id}` : "/instagram-home-preview"}>
            Open Preview
          </Link>
          <Link className="smd_btn smd_btn--primary" to="/settings">
            Open Settings
          </Link>
        </div>
      </header>

      <main id="smd_layout">
        <aside className="smd_sidebar">
          <div className="smd_sidebar_block">
            <p className="smd_eyebrow">Draft Queue</p>
            <strong>{posts.length} posts</strong>
            <p className="smd_help">Choose a saved post and it will seed the canvas with title, objective, campaign label, and media.</p>
          </div>

          {loading ? <p className="smd_empty">Loading drafts…</p> : null}
          {error ? <p className="smd_empty smd_empty--error">{error}</p> : null}

          <div className="smd_post_list">
            {posts.map((post) => (
              <button
                key={post.id}
                type="button"
                className={`smd_post_item${post.id === selectedPost?.id ? " smd_post_item--active" : ""}`}
                onClick={() => handleSelectPost(post)}
              >
                <span>{post.stage || "Drafting"}</span>
                <strong>{post.title || "Untitled post"}</strong>
                <small>{post.format || "Post"}</small>
              </button>
            ))}
          </div>

          <div className="smd_sidebar_block">
            <p className="smd_eyebrow">Canvas Size</p>
            <div className="smd_preset_list">
              {Object.entries(DESIGN_PRESETS).map(([key, preset]) => (
                <button
                  key={key}
                  type="button"
                  className={`smd_preset_btn${presetKey === key ? " smd_preset_btn--active" : ""}`}
                  onClick={() => handlePresetChange(key)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <div className="smd_sidebar_block">
            <p className="smd_eyebrow">Canvas Tools</p>
            <div className="smd_button_grid">
              <button className="smd_btn smd_btn--ghost" onClick={handleReloadDraft} disabled={!selectedPost}>
                Reload Draft
              </button>
              <button className="smd_btn smd_btn--ghost" onClick={handleAddTextBlock}>
                Add Text
              </button>
              <button className="smd_btn smd_btn--ghost" onClick={handleAddPanel}>
                Add Panel
              </button>
              <button className="smd_btn smd_btn--primary" onClick={handleExportImage} disabled={exportState === "exporting"}>
                {exportState === "exporting" ? "Exporting…" : exportState === "done" ? "PNG exported" : "Export PNG"}
              </button>
            </div>
          </div>

          {selectedElement ? (
            <div className="smd_sidebar_block smd_inspector">
              <p className="smd_eyebrow">Selected Element</p>
              <strong>{selectedElement.id}</strong>
              {selectedElement.kind === "text" ? (
                <>
                  <label className="smd_field">
                    <span>Text</span>
                    <textarea
                      rows={4}
                      value={selectedElement.text || ""}
                      onChange={(event) => updateElement(selectedElement.id, () => ({ text: event.target.value }))}
                    />
                  </label>
                  <label className="smd_field">
                    <span>Font Size</span>
                    <input
                      type="range"
                      min="18"
                      max="140"
                      value={selectedElement.fontSize || 36}
                      onChange={(event) => updateElement(selectedElement.id, () => ({ fontSize: Number(event.target.value) }))}
                    />
                  </label>
                  <label className="smd_field">
                    <span>Color</span>
                    <input
                      type="color"
                      value={selectedElement.fill || "#ffffff"}
                      onChange={(event) => updateElement(selectedElement.id, () => ({ fill: event.target.value }))}
                    />
                  </label>
                </>
              ) : null}
              {selectedElement.kind === "rect" ? (
                <label className="smd_field">
                  <span>Fill</span>
                  <input
                    type="color"
                    value={(selectedElement.fill || "#ffffff").startsWith("#") ? selectedElement.fill : "#ffffff"}
                    onChange={(event) => updateElement(selectedElement.id, () => ({ fill: event.target.value }))}
                  />
                </label>
              ) : null}
              {!["media", "overlay"].includes(selectedElement.id) ? (
                <button className="smd_btn smd_btn--ghost" onClick={handleDeleteSelected}>
                  Delete Selected
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="smd_sidebar_block smd_inspector">
            <p className="smd_eyebrow">Background</p>
            <label className="smd_field">
              <span>Gradient Start</span>
              <input
                type="color"
                value={design.backgroundStart}
                onChange={(event) => setDesign((current) => ({ ...current, backgroundStart: event.target.value }))}
              />
            </label>
            <label className="smd_field">
              <span>Gradient End</span>
              <input
                type="color"
                value={design.backgroundEnd}
                onChange={(event) => setDesign((current) => ({ ...current, backgroundEnd: event.target.value }))}
              />
            </label>
          </div>

          {selectedMedia ? (
            <div className="smd_media_card">
              <img src={selectedMedia} alt={selectedPost?.title || "Selected draft media"} />
            </div>
          ) : null}
        </aside>

        <section className="smd_editor_shell">
          <div className="smd_canvas_toolbar">
            <div>
              <p className="smd_eyebrow">Canvas</p>
              <strong>{design.width} x {design.height}</strong>
            </div>
            <p>Click an element to edit it. Drag on canvas to position it. Use the handles to resize.</p>
          </div>

          <div className="smd_canvas_wrap" ref={canvasWrapRef}>
            <div
              className="smd_canvas_stage"
              style={{
                width: `${design.width * stageScale}px`,
                height: `${design.height * stageScale}px`,
              }}
            >
              <Stage
                ref={stageRef}
                width={fittedStageSize.width}
                height={fittedStageSize.height}
                onMouseDown={(event) => {
                  if (event.target === event.target.getStage()) setSelectedElementId("");
                }}
              >
                <Layer>
                  <Group scaleX={stageScale} scaleY={stageScale}>
                    <Rect
                      x={0}
                      y={0}
                      width={design.width}
                      height={design.height}
                      fillLinearGradientStartPoint={{ x: 0, y: 0 }}
                      fillLinearGradientEndPoint={{ x: design.width, y: design.height }}
                      fillLinearGradientColorStops={[0, design.backgroundStart, 1, design.backgroundEnd]}
                    />

                    {design.elements.map((element) => (
                      <KonvaElement
                        key={element.id}
                        element={element}
                        isSelected={selectedElementId === element.id}
                        onSelect={() => setSelectedElementId(element.id)}
                        onChange={(nextElement) => {
                          setDesign((current) => ({
                            ...current,
                            elements: current.elements.map((item) => (item.id === element.id ? nextElement : item)),
                          }));
                        }}
                      />
                    ))}
                  </Group>
                </Layer>
              </Stage>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};

export default SocialMediaDesignerPage;
