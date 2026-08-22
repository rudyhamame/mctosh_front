import { defineConfig } from "vite";

// Deliberately separate from vite.config.js: the modules under test here
// (pdfTextNormalizer/pdfTextMapping/pdfSearchIndex/pdfFuzzySearch/
// pdfTextCorrection) are plain JS with no DOM/React dependency, so this
// doesn't need the app's React plugin, HTTPS dev-server plugin, or backend
// proxy config — just a plain Node test environment.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.js"],
  },
});
