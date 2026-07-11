import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  getReferenceOrgans,
  getCellTypeTree,
  getOntologyTree,
  getFtuIllustrations,
  getTissueBlocks,
} from "../utils/humanAtlasApi";
import "./humanAtlasPage.css";

const TABS = [
  { id: "organs", label: "3D Organs", icon: "fi-rr-heart" },
  { id: "cellTypes", label: "Cell Types", icon: "fi-rr-microscope" },
  { id: "ontology", label: "Ontology", icon: "fi-rr-diagram-subtask" },
  { id: "ftu", label: "FTU Illustrations", icon: "fi-rr-picture" },
  { id: "tissueBlocks", label: "Tissue Blocks", icon: "fi-rr-layers" },
];

const CARDIO_LABEL_HINTS = ["heart", "vasculature", "vein", "artery", "blood"];

/* ── Reference-organ grouping ── */
const groupOrgans = (raw) => {
  const map = new Map();
  raw.forEach((entry) => {
    const label = entry.label || "Unknown organ";
    if (!map.has(label)) {
      map.set(label, { label, representationOf: entry.representation_of, variants: [] });
    }
    map.get(label).variants.push({
      key: entry["@id"],
      sex: entry.sex || null,
      side: entry.side || null,
      file: entry.object?.file || null,
    });
  });
  return Array.from(map.values()).sort((a, b) => {
    const aCardio = CARDIO_LABEL_HINTS.some((h) => a.label.toLowerCase().includes(h));
    const bCardio = CARDIO_LABEL_HINTS.some((h) => b.label.toLowerCase().includes(h));
    if (aCardio !== bCardio) return aCardio ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
};

const variantLabel = (variant) => [variant.sex, variant.side].filter(Boolean).join(" – ") || "Model";

/* ── 3D .glb viewer (Three.js, OrbitControls, auto-framed) ── */
const GlbViewer = ({ url }) => {
  const mountRef = useRef(null);
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !url) return undefined;
    setStatus("loading");

    let disposed = false;
    let frameId;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, mount.clientWidth / (mount.clientHeight || 1), 0.01, 100000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x33334d, 1.7));
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
    keyLight.position.set(2, 3, 4);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.6);
    fillLight.position.set(-3, -1, -2);
    scene.add(fillLight);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

    const loader = new GLTFLoader();
    loader.load(
      url,
      (gltf) => {
        if (disposed) return;
        scene.add(gltf.scene);

        const box = new THREE.Box3().setFromObject(gltf.scene);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);
        gltf.scene.position.sub(center);

        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        camera.near = maxDim / 200;
        camera.far = maxDim * 30;
        camera.position.set(0, 0, maxDim * 1.8);
        camera.updateProjectionMatrix();
        controls.target.set(0, 0, 0);
        controls.update();

        setStatus("ready");
      },
      undefined,
      () => { if (!disposed) setStatus("error"); },
    );

    const animate = () => {
      frameId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!mount.clientWidth || !mount.clientHeight) return;
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      window.removeEventListener("resize", handleResize);
      controls.dispose();
      renderer.dispose();
      scene.traverse((obj) => {
        obj.geometry?.dispose?.();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m) => m?.dispose?.());
      });
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, [url]);

  return (
    <div id="ha_viewer_mount" ref={mountRef}>
      {status !== "ready" && (
        <div className="ha_viewer_overlay">
          {status === "error" ? "Failed to load model." : "Loading model…"}
        </div>
      )}
    </div>
  );
};

/* ── Organs tab ── */
const OrgansTab = () => {
  const [organs, setOrgans] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");
  const [selectedLabel, setSelectedLabel] = useState(null);
  const [selectedVariantKey, setSelectedVariantKey] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getReferenceOrgans()
      .then((raw) => {
        if (cancelled) return;
        const grouped = groupOrgans(raw);
        setOrgans(grouped);
        if (grouped.length) {
          setSelectedLabel(grouped[0].label);
          setSelectedVariantKey(grouped[0].variants[0].key);
        }
      })
      .catch((err) => !cancelled && setError(err.message));
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    if (!organs) return [];
    const q = query.trim().toLowerCase();
    return q ? organs.filter((o) => o.label.toLowerCase().includes(q)) : organs;
  }, [organs, query]);

  const selectedOrgan = organs?.find((o) => o.label === selectedLabel) || null;
  const selectedVariant = selectedOrgan?.variants.find((v) => v.key === selectedVariantKey) || selectedOrgan?.variants[0];

  if (error) return <div className="ha_tab_error">{error}</div>;
  if (!organs) return <div className="ha_tab_loading">Loading reference organs…</div>;

  return (
    <div id="ha_organs_tab">
      <div id="ha_organs_list_col">
        <input
          id="ha_organs_search"
          type="text"
          placeholder="Search organs…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div id="ha_organs_list">
          {filtered.map((organ) => (
            <button
              key={organ.label}
              className={`ha_organ_item ${organ.label === selectedLabel ? "ha_organ_item_active" : ""}`}
              onClick={() => {
                setSelectedLabel(organ.label);
                setSelectedVariantKey(organ.variants[0].key);
              }}
            >
              {organ.label}
              <span className="ha_organ_variant_count">{organ.variants.length}</span>
            </button>
          ))}
          {!filtered.length && <div className="ha_tab_empty">No organs match "{query}".</div>}
        </div>
      </div>

      <div id="ha_organs_viewer_col">
        {selectedOrgan && (
          <>
            <div id="ha_viewer_header">
              <span id="ha_viewer_title">{selectedOrgan.label}</span>
              {selectedOrgan.variants.length > 1 && (
                <div id="ha_variant_switch">
                  {selectedOrgan.variants.map((v) => (
                    <button
                      key={v.key}
                      className={`ha_variant_btn ${v.key === selectedVariantKey ? "ha_variant_btn_active" : ""}`}
                      onClick={() => setSelectedVariantKey(v.key)}
                    >
                      {variantLabel(v)}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {selectedVariant?.file
              ? <GlbViewer key={selectedVariant.key} url={selectedVariant.file} />
              : <div className="ha_tab_empty">No 3D model available for this variant.</div>}
            <a
              id="ha_viewer_download"
              href={selectedVariant?.file}
              target="_blank"
              rel="noreferrer"
            >
              <i className="fi fi-rr-download" /> Open .glb source
            </a>
          </>
        )}
      </div>
    </div>
  );
};

/* ── Generic ontology-shaped tree (shared by Cell Types + Ontology tabs) ── */
const OntologyTreeView = ({ data }) => {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(() => new Set());

  const toggle = (id) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const matchSet = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !data) return null;
    const matched = new Set();
    Object.values(data.nodes).forEach((node) => {
      const hay = [node.label, ...(node.synonymLabels || [])].join(" ").toLowerCase();
      if (hay.includes(q)) matched.add(node.id);
    });
    const visible = new Set(matched);
    matched.forEach((id) => {
      let cur = data.nodes[id];
      while (cur?.parent && data.nodes[cur.parent]) {
        visible.add(cur.parent);
        cur = data.nodes[cur.parent];
      }
    });
    return { matched, visible };
  }, [query, data]);

  const renderNode = (id, depth) => {
    const node = data.nodes[id];
    if (!node) return null;
    if (matchSet && !matchSet.visible.has(id)) return null;

    const hasChildren = (node.children || []).length > 0;
    const isOpen = matchSet ? true : expanded.has(id);
    const isMatch = matchSet?.matched.has(id);

    return (
      <div key={id} className="ha_tree_node" style={{ "--depth": depth }}>
        <div
          className={`ha_tree_row ${isMatch ? "ha_tree_row_match" : ""}`}
          onClick={() => hasChildren && toggle(id)}
        >
          <i className={`fi ${hasChildren ? (isOpen ? "fi-rr-caret-down" : "fi-rr-caret-right") : "fi-rr-circle-small"} ha_tree_caret`} />
          <span className="ha_tree_label">{node.label}</span>
          {hasChildren && <span className="ha_tree_child_count">{node.children.length}</span>}
        </div>
        {hasChildren && isOpen && (
          <div className="ha_tree_children">
            {node.children.map((childId) => renderNode(childId, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  if (!data) return null;
  const rootNode = data.nodes[data.root];

  return (
    <div className="ha_tree_tab">
      <input
        className="ha_tree_search"
        type="text"
        placeholder="Search terms…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="ha_tree_scroll">
        {(rootNode?.children || []).map((childId) => renderNode(childId, 0))}
      </div>
    </div>
  );
};

const TreeFetchTab = ({ fetcher }) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetcher().then((d) => !cancelled && setData(d)).catch((err) => !cancelled && setError(err.message));
    return () => { cancelled = true; };
  }, [fetcher]);

  if (error) return <div className="ha_tab_error">{error}</div>;
  if (!data) return <div className="ha_tab_loading">Loading tree…</div>;
  return <OntologyTreeView data={data} />;
};

/* ── FTU illustrations tab ── */
const FtuTab = () => {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");
  const [openItem, setOpenItem] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getFtuIllustrations()
      .then((data) => !cancelled && setItems(data))
      .catch((err) => !cancelled && setError(err.message));
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    if (!items) return [];
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) =>
      `${it.label} ${it.organ_label}`.toLowerCase().includes(q));
  }, [items, query]);

  const pngOf = (item) => item.illustration_files?.find((f) => f.file_format === "image/png")?.file;

  if (error) return <div className="ha_tab_error">{error}</div>;
  if (!items) return <div className="ha_tab_loading">Loading FTU illustrations…</div>;

  return (
    <div id="ha_ftu_tab">
      <input
        className="ha_tree_search"
        type="text"
        placeholder="Search functional tissue units…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div id="ha_ftu_grid">
        {filtered.map((item) => {
          const png = pngOf(item);
          return (
            <button key={item["@id"]} className="ha_ftu_card" onClick={() => png && setOpenItem(item)}>
              {png
                ? <img src={png} alt={item.label} loading="lazy" />
                : <div className="ha_ftu_no_image"><i className="fi fi-rr-picture" /></div>}
              <span className="ha_ftu_label">{item.label}</span>
              <span className="ha_ftu_organ">{item.organ_label}</span>
            </button>
          );
        })}
        {!filtered.length && <div className="ha_tab_empty">No illustrations match "{query}".</div>}
      </div>

      {openItem && (
        <div id="ha_ftu_lightbox" onClick={() => setOpenItem(null)}>
          <img src={pngOf(openItem)} alt={openItem.label} />
          <span id="ha_ftu_lightbox_label">{openItem.label} — {openItem.organ_label}</span>
        </div>
      )}
    </div>
  );
};

/* ── Tissue blocks tab (organ-scoped — the unfiltered dataset is far too large to fetch at once) ── */
const TissueBlocksTab = ({ organOptions }) => {
  const [selectedIri, setSelectedIri] = useState(organOptions[0]?.representationOf || "");
  const [blocks, setBlocks] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!selectedIri) return undefined;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getTissueBlocks(selectedIri)
      .then((data) => !cancelled && setBlocks(data))
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [selectedIri]);

  return (
    <div id="ha_tissue_tab">
      <div id="ha_tissue_controls">
        <label htmlFor="ha_tissue_organ_select">Organ</label>
        <select
          id="ha_tissue_organ_select"
          value={selectedIri}
          onChange={(e) => setSelectedIri(e.target.value)}
        >
          {organOptions.map((o) => (
            <option key={o.label} value={o.representationOf}>{o.label}</option>
          ))}
        </select>
        {blocks && <span id="ha_tissue_count">{blocks.length} tissue block{blocks.length === 1 ? "" : "s"}</span>}
      </div>

      {loading && <div className="ha_tab_loading">Loading tissue blocks…</div>}
      {error && <div className="ha_tab_error">{error}</div>}

      {!loading && blocks && (
        <div id="ha_tissue_list">
          {blocks.map((block) => (
            <a
              key={block["@id"]}
              className="ha_tissue_row"
              href={block.link || undefined}
              target="_blank"
              rel="noreferrer"
            >
              <span className="ha_tissue_donor">{block.donor?.label || "Unknown donor"}</span>
              <span className="ha_tissue_desc">{block.description}</span>
              <span className="ha_tissue_tech">
                {[...new Set((block.datasets || []).map((d) => d.technology).filter(Boolean))].join(", ")}
              </span>
            </a>
          ))}
          {!blocks.length && <div className="ha_tab_empty">No tissue blocks registered for this organ.</div>}
        </div>
      )}
    </div>
  );
};

/* ── Page ── */
const HumanAtlasPage = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("organs");
  const [organOptions, setOrganOptions] = useState([]);

  // Reference-organ list is reused to build the organ picker on the Tissue
  // Blocks tab (its ontology-term IRIs double as the tissue-blocks filter).
  useEffect(() => {
    let cancelled = false;
    getReferenceOrgans()
      .then((raw) => !cancelled && setOrganOptions(groupOrgans(raw)))
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  return (
    <div id="ha_page">
      <div id="ha_header">
        <button id="ha_back_btn" onClick={() => navigate("/home")}>←</button>
        <span id="ha_header_title">Human Reference Atlas</span>
        <a id="ha_header_link" href="https://apps.humanatlas.io/api" target="_blank" rel="noreferrer">
          apps.humanatlas.io/api <i className="fi fi-rr-arrow-up-right-from-square" />
        </a>
      </div>

      <div id="ha_tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`ha_tab_btn ${activeTab === tab.id ? "ha_tab_btn_active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <i className={`fi ${tab.icon}`} /> {tab.label}
          </button>
        ))}
      </div>

      <div id="ha_tab_body">
        {activeTab === "organs" && <OrgansTab />}
        {activeTab === "cellTypes" && <TreeFetchTab fetcher={getCellTypeTree} />}
        {activeTab === "ontology" && <TreeFetchTab fetcher={getOntologyTree} />}
        {activeTab === "ftu" && <FtuTab />}
        {activeTab === "tissueBlocks" && organOptions.length > 0 && <TissueBlocksTab organOptions={organOptions} />}
      </div>
    </div>
  );
};

export default HumanAtlasPage;
