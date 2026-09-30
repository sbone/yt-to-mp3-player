import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    cssMinify: "esbuild",
    outDir: "dist/public",
    emptyOutDir: false,
    rollupOptions: {
      input: resolve(import.meta.dirname, "src/client/main.tsx"),
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
