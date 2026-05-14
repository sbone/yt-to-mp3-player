import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const devHost = process.env.DEV_CLIENT_HOST ?? "127.0.0.1";
const devPort = Number(process.env.DEV_CLIENT_PORT ?? 5173);
const apiTarget = process.env.API_PROXY_TARGET ?? "http://127.0.0.1:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    host: devHost,
    port: devPort,
    proxy: {
      "/api": apiTarget,
      "/device-sync/pending-manifest.txt": apiTarget
    }
  },
  build: {
    cssMinify: "esbuild",
    outDir: "dist/public",
    emptyOutDir: false,
    rollupOptions: {
      input: resolve(__dirname, "src/client/main.tsx"),
      output: {
        entryFileNames: "client.js",
        chunkFileNames: "chunks/[name].js",
        assetFileNames: (assetInfo) => {
          if (assetInfo.name === "style.css" || assetInfo.name === "main.css" || assetInfo.name === "client.css") {
            return "client.css";
          }
          return "assets/[name][extname]";
        }
      }
    }
  }
});
