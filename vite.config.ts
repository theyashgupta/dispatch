import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "src/web",
  plugins: [react()],
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
