import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { apiUrl } from "../config/api";
import { readStoredSession } from "../utils/sessionCleanup";

export const GRAPHICS_PAGES = [
  { id: "home", title: "Home", path: "/home" },
  { id: "ai", title: "AI Chat", path: "/ai" },
  { id: "about", title: "About", path: "/about" },
  { id: "portfolio", title: "Portfolio", path: "/portfolio" },
  { id: "sources", title: "Sources", path: "/sources" },
  { id: "youtube", title: "YouTube", path: "/youtube" },
  { id: "podcast", title: "Podcast", path: "/podcast" },
  { id: "pdf-reader", title: "PDF Reader", path: "/pdf-reader" },
  { id: "hylomorphism", title: "Hylomorphism", path: "/hylomorphism" },
  { id: "phenomena", title: "Phenomena", path: "/phenomena" },
  { id: "voice-profile", title: "Voice Profile", path: "/voice-profile" },
  { id: "draft", title: "Drafts", path: "/draft" },
  { id: "card", title: "Card", path: "/card" },
  { id: "clinical-schemata", title: "Clinical Schemata", path: "/clinical-schemata" },
  { id: "clinical-vignettes", title: "Clinical Vignettes", path: "/clinical-vignettes" },
  { id: "morphemes", title: "RabbitHole Morphemes", path: "/morphemes" },
  { id: "terminology", title: "Terminology", path: "/terminology" },
  { id: "reasoning", title: "Reasoning", path: "/amctoshs-reasoning" },
  { id: "segmentations", title: "Segmentations", path: "/segmentations" },
  { id: "human-atlas", title: "Human Atlas", path: "/human-atlas" },
  { id: "freeform", title: "Freeform", path: "/freeform" },
  { id: "faq", title: "FAQ", path: "/faq" },
  { id: "documentation", title: "Documentation", path: "/documentation" },
  { id: "settings", title: "Settings", path: "/settings" },
];

export const pageIdForPath = (pathname) => {
  const match = GRAPHICS_PAGES.find(({ path }) => pathname === path || pathname.startsWith(`${path}/`));
  return match?.id || "home";
};

export const cssColorValues = (() => {
  const cssFiles = import.meta.glob("../**/*.css", { query: "?raw", import: "default", eager: true });
  const colors = new Set();
  const colorPattern = /#[\da-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/gi;
  Object.values(cssFiles).forEach((css) => {
    String(css).match(colorPattern)?.forEach((color) => colors.add(color.trim()));
  });
  return [...colors];
})();

export const DEFAULT_GRAPHICS_COLOR = "";

export const graphicsAuthHeaders = () => {
  const token = readStoredSession()?.token || "";
  return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
};

const safariThemeColor = (color) => {
  const value = String(color || "").trim();
  const match = value.match(/^#([\da-f]{3}|[\da-f]{6})$/i);
  if (!match) return value;
  const hex = match[1].length === 3 ? match[1].split("").map((part) => part + part).join("") : match[1];
  return `rgb(${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)})`;
};

export const GraphicsSettingsRuntime = () => {
  const { pathname } = useLocation();

  useEffect(() => {
    let cancelled = false;
    let latestSettings = {};
    const pageRoot = document.documentElement;
    const pageBody = document.body;
    pageRoot.classList.remove("theme-dark", "theme-disabled-dark");
    pageRoot.classList.add("theme-light");
    const apply = (settings, explicitPageId = "") => {
      if (cancelled) return;
      const color = settings?.[explicitPageId || pageIdForPath(pathname)];
      const fallbackColor = getComputedStyle(pageRoot).getPropertyValue("--rh-paper").trim() || "#f2f0e8";
      const themeColor = color || fallbackColor;
      const themeMeta = document.createElement("meta");
      themeMeta.name = "theme-color";
      themeMeta.content = safariThemeColor(themeColor);
      document.querySelector('meta[name="theme-color"]')?.replaceWith(themeMeta);
      if (!document.head.contains(themeMeta)) document.head.appendChild(themeMeta);
    };
    const load = async () => {
      try {
        const response = await fetch(apiUrl("/api/user/me/graphics-settings"), { headers: graphicsAuthHeaders() });
        const data = await response.json();
        latestSettings = data.graphicsSettings || {};
        apply(latestSettings);
      } catch { latestSettings = {}; apply(latestSettings); }
    };
    load();
    const onChange = (event) => {
      latestSettings = event.detail?.settings || event.detail || {};
      apply(latestSettings, event.detail?.pageId || "");
    };
    window.addEventListener("rh:graphics-settings-changed", onChange);
    const observer = new MutationObserver(() => apply(latestSettings));
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      cancelled = true;
      observer.disconnect();
      window.removeEventListener("rh:graphics-settings-changed", onChange);
      pageRoot.style.removeProperty("--rh-document-background");
      pageBody.style.removeProperty("--rh-document-background");
    };
  }, [pathname]);

  return null;
};
