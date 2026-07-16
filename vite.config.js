import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";

const devHost = "192.168.68.104";
const devPort = 5173;
const backendProxyTarget = "https://localhost:4000";

const isExpectedSocketProxyClose = (error) => {
  const errorCode = String(error?.code || "").trim();
  const errorMessage = String(error?.message || "").trim();

  return (
    errorCode === "ECONNREFUSED" ||
    errorCode === "ECONNRESET" ||
    errorCode === "EPIPE" ||
    /socket has been ended/i.test(errorMessage) ||
    /write after end/i.test(errorMessage)
  );
};

const sharedProxyConfig = {
  "/api": {
    target: backendProxyTarget,
    changeOrigin: true,
    secure: false,
  },
  "/socket.io": {
    target: backendProxyTarget,
    changeOrigin: true,
    secure: false,
    ws: true,
    configure(proxy) {
      proxy.on("error", (error, req, res) => {
        if (isExpectedSocketProxyClose(error)) {
          if (
            res &&
            typeof res.writeHead === "function" &&
            !res.headersSent
          ) {
            res.writeHead(502);
          }

          if (res && typeof res.end === "function" && !res.writableEnded) {
            res.end();
          }
          return;
        }

        console.error(
          `[vite] socket proxy error: ${error?.message || error}`,
          req?.url || "",
        );
      });
    },
  },
};

export default defineConfig({
  // AMCTOSHS | CVS (Cardiovascular System) is a sub-app of the future MCTOSH
  // product, served at mctoshs.ca/cvs/ instead of the domain root.
  base: "/cvs/",
  plugins: [react(), basicSsl()],
  server: {
    host: devHost,
    port: devPort,
    strictPort: true,
    watch: {
      ignored: [
        "**/.git/**",
        "**/.vite/**",
        "**/build/**",
        "**/node_modules/**",
      ],
      interval: 250,
      usePolling: true,
    },
    proxy: sharedProxyConfig,
  },
  preview: {
    host: devHost,
    port: devPort,
    strictPort: true,
    proxy: sharedProxyConfig,
  },
  esbuild: {
    loader: "jsx",
    include: /src\/.*\.[jt]sx?$/,
    exclude: [],
  },
  optimizeDeps: {
    esbuildOptions: {
      loader: {
        ".js": "jsx",
        ".jsx": "jsx",
      },
    },
  },
  build: {
    outDir: "build/cvs",
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, "/");

          if (!normalizedId.includes("node_modules")) {
            return undefined;
          }

          if (normalizedId.includes("pdfjs-dist")) {
            return "vendor-pdf";
          }

          if (
            normalizedId.includes("@ffmpeg") ||
            normalizedId.includes("tesseract.js") ||
            normalizedId.includes("livekit-client") ||
            normalizedId.includes("jspdf")
          ) {
            return "vendor-heavy";
          }

          // NOTE: react/react-dom/react-router-dom deliberately do NOT get
          // their own manual chunk here (they used to, as "vendor-react").
          // That split created a genuine circular ES module dependency in
          // production: react-dom's own "scheduler" dependency has no
          // "react" in its package path, so it landed in the catch-all
          // "vendor" chunk below, while things depending on React (e.g.
          // framer-motion) also landed in "vendor" — so "vendor-react"
          // imported from "vendor" (for scheduler) AND "vendor" imported
          // from "vendor-react" (for React itself) at the same time. Two
          // chunks that mutually import from each other race at module
          // evaluation time; whichever runs first sees the other's export
          // as still-undefined, which is exactly what threw "Cannot read
          // properties of undefined (reading 'createContext')" in
          // production. Letting React fall through into the same
          // catch-all "vendor" chunk as everything that depends on it
          // removes the cross-chunk boundary entirely, so this class of
          // bug can't recur just because some future dependency's path
          // doesn't happen to contain the substring "react".

          if (
            normalizedId.includes("@mui") ||
            normalizedId.includes("@emotion") ||
            normalizedId.includes("@fortawesome") ||
            normalizedId.includes("@flaticon")
          ) {
            return "vendor-ui";
          }

          return "vendor";
        },
      },
    },
  },
});
