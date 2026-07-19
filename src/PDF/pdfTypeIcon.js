// Pulled out of PDFPage.jsx into its own module: that file's default export
// is a component, and Vite's React Fast Refresh requires a component file to
// export *only* components — a named export of a plain object alongside the
// default component export ("PDF_TYPE_ICON" export is incompatible) made
// every edit to PDFPage.jsx fall back to a full page reload instead of a
// proper hot update. PDFReaderWorkspace.jsx imports this directly now too.
export const PDF_TYPE_ICON = {
  "text-based": "bx bx-check-circle",
  "mixed":      "bx bx-error",
  "scanned":    "bx bx-image",
};
