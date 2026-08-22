import React from "react";
import "./appFooter.css";
import ServiceStatusFooter from "./ServiceStatusFooter";

// Thin app-wide toolbar rendered in normal flow as the final child of the
// shared App_viewportScale routed-app column.
const AppFooter = ({ children }) => (
  <footer id="app_footer">
    <ServiceStatusFooter />
    <div id="app_footer_end">{children}</div>
  </footer>
);

export default AppFooter;
