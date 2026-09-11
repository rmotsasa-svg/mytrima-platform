import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Fixed dev port, deliberately different from frontend/'s own 5173 — the
// two are separate deployables (see this project's own README) that can
// run side by side locally. Not referenced by any backend CORS_ORIGIN
// entry the way frontend's port is (this site's own signup form always
// posts to the backend's real, deployed origin, not a hardcoded one — see
// src/api.ts), so unlike frontend/vite.config.ts there's no drift risk in
// letting this be a plain default rather than a hard requirement — fixed
// anyway, for the same predictability during local dev.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
  },
});
