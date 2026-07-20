import React from "react";
import { createRoot } from "react-dom/client";
import AppRouter from "./AppRouter";
import { applyStoredTheme } from "./utils/theme";
import "./color.css";
import "./App/App.css";
import "@fortawesome/fontawesome-free/css/all.min.css";
import "@flaticon/flaticon-uicons/css/all/all.css";

// AppRouter.js's <Router basename="/cvs"> only matches paths under /cvs —
// index.html itself (vite.config.js's base: "/cvs/") is served for ANY
// unmatched path too (Render's static-site SPA fallback), including the
// bare domain root. Loading it there lets the JS bundle itself load fine
// (its own asset URLs are absolute /cvs/... paths) but React Router then
// has nothing to match against basename="/cvs" and mounts nothing — a
// blank #root, not an error, which is why it silently read as "the site
// is broken" rather than a 404. Redirect BEFORE mounting rather than
// changing the basename itself, since every internal link/navigate() call
// in this app already assumes routes live under /cvs.
const path = window.location.pathname;
if (path !== "/cvs" && !path.startsWith("/cvs/")) {
  window.location.replace(`/cvs${path === "/" ? "" : path}${window.location.search}${window.location.hash}`);
} else {
  applyStoredTheme();
  createRoot(document.getElementById("root")).render(<AppRouter />);
}
