import React from "react";
import { createRoot } from "react-dom/client";
import AppRouter from "./AppRouter";
import { applyStoredTheme } from "./utils/theme";
import "./color.css";
import "./App/App.css";
import "@fortawesome/fontawesome-free/css/all.min.css";
import "@flaticon/flaticon-uicons/css/all/all.css";
import { installDoubleTapZoomGuard } from "./utils/disableDoubleTapZoom";

applyStoredTheme();
installDoubleTapZoomGuard();
createRoot(document.getElementById("root")).render(<AppRouter />);
