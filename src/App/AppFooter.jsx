import React from "react";
import "./appFooter.css";

// Thin, app-wide toolbar strip pinned to the bottom of the viewport on
// every authenticated page (rendered globally in AppRouter, sibling to
// <Routes>) — home for controls that used to float as their own separate
// fixed-position buttons, starting with the AI trigger.
const AppFooter = ({ children }) => (
  <footer id="app_footer">
    <div id="app_footer_end">{children}</div>
  </footer>
);

export default AppFooter;
