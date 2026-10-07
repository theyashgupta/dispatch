import { resolve } from "node:path";
import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import { visualizer } from "rollup-plugin-visualizer";

export default defineConfig({
  root: "src/web",
  base: "./",
  resolve: {
    alias: { "@": resolve(import.meta.dirname, "src/web") },
  },
  plugins: [
    tanstackRouter({
      target: "react",
      routesDirectory: resolve(import.meta.dirname, "src/web/routes"),
      generatedRouteTree: resolve(
        import.meta.dirname,
        "src/web/routeTree.gen.ts",
      ),
    }),
    react(),
    tailwindcss(),
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
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "src/web/index.html"),
        terminal: resolve(import.meta.dirname, "src/web/terminal.html"),
        viewer: resolve(import.meta.dirname, "src/web/viewer.html"),
      },
    },
  },
  server: {
    proxy: {
      // Regex key: a bare "/api" prefix also matches frontend module URLs under
      // src/web (e.g. lib/http.ts), which would be proxied to Express and blank the
      // page. Anchoring to /api/ ensures only backend API paths are proxied.
      "^/api/": {
        target: "http://localhost:4700",
        changeOrigin: true,
      },
      // Same anchoring rationale as /api/ above; ws:true also proxies the
      // terminal's WebSocket upgrade, or the relative iframe src 404s/blanks
      // under `npm run dev` even though the production single-origin build works.
      "^/sessions/": {
        target: "http://localhost:4700",
        changeOrigin: true,
        ws: true,
      },
      // Same anchoring rationale as /api/ above; no ws needed, the viewer page
      // has no WebSocket, only its HTML/asset GETs and the /api/ file fetch.
      "^/viewer/": {
        target: "http://localhost:4700",
        changeOrigin: true,
      },
    },
  },
});
