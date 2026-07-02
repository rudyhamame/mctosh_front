import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";

const backendProxyTarget = "http://localhost:4000";

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
  },
  "/socket.io": {
    target: backendProxyTarget,
    changeOrigin: true,
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
  plugins: [react(), basicSsl()],
  server: {
    host: "0.0.0.0",
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
    host: "0.0.0.0",
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
    outDir: "build",
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
            normalizedId.includes("livekit-client")
          ) {
            return "vendor-heavy";
          }

          if (
            normalizedId.includes("react") ||
            normalizedId.includes("react-dom") ||
            normalizedId.includes("react-router-dom")
          ) {
            return "vendor-react";
          }

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
