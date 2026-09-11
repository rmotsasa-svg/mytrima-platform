import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Fixed dev port (not Vite's default-if-free behaviour) because the
// backend's CORS_ORIGIN allowlist (src/common/cors.ts) has to name an exact
// origin ahead of time — a silently-incrementing port (5174, 5175, ...)
// would drift out of sync with whatever CORS_ORIGIN was actually set to.
// strictPort: true fails loudly instead of drifting if 5173 is taken.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
});
