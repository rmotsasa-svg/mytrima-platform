import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Fixed dev port 5175 — deliberately different from frontend/'s 5173 and
// landing/'s 5174, so all three can run side by side locally (see this
// project's own README). This app makes real authenticated calls to the
// backend (admin login, tenant management), so — like frontend/'s own
// port — CORS_ORIGIN on the backend needs this exact origin listed for
// those calls to succeed cross-origin in dev.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    strictPort: true,
  },
});
