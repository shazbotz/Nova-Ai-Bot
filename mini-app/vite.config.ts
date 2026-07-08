import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Served by the backend at /app/* (single-service deployment), so all
  // built asset URLs must be prefixed with /app/ instead of the default "/".
  // Without this, index.html would reference /assets/... at the domain root,
  // which Express only serves under /app/assets/..., breaking the built app
  // with 404s on every JS/CSS file in production.
  base: "/app/",
  server: {
    port: parseInt(process.env.PORT || "3000"),
    host: true,
    allowedHosts: true,
    proxy: {
      "/api": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
  },
});
