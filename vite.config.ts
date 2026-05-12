import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:3000",
      "/device-sync/pending-manifest.txt": "http://127.0.0.1:3000"
    }
  },
  build: {
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
