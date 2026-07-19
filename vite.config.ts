import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import { visualizer } from "rollup-plugin-visualizer";

export default defineConfig({
  root: "src/web",
  plugins: [
    react(),
    ...(process.env.ANALYZE === "1"
      ? [
          visualizer({
            filename: "dist/bundle-stats.html",
            template: "treemap",
            gzipSize: true,
            brotliSize: true,
            open: false,
          }) as PluginOption,
        ]
      : []),
  ],
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      // Regex key: a bare "/api" prefix also matches frontend module URLs under
      // src/web (e.g. lib/api.ts), which would be proxied to Express and blank the
      // page. Anchoring to /api/ ensures only backend API paths are proxied.
      "^/api/": {
        target: "http://localhost:4700",
        changeOrigin: true,
      },
    },
  },
});
