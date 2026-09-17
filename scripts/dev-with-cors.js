// Cross-platform substitute for `CORS_ORIGIN=... npm run start:dev`
// (that shell syntax doesn't work on Windows, and this repo has no
// cross-env dependency). Sets CORS_ORIGIN to every real local dev origin
// that calls this API cross-origin — the SPA (frontend/vite.config.ts's
// fixed port 5173), the marketing/signup site (landing/vite.config.ts's
// fixed port 5174, see its HomePage.tsx registerTenant() call), and the
// platform admin app (admin/vite.config.ts's fixed port 5175, added
// Phase 1 of the admin-platform plan) — only if it isn't already set in
// the real environment, then hands off to the normal `nest start --watch`
// dev server. Local dev convenience only — never touches how the app
// runs in any real deployment, which sets CORS_ORIGIN itself.
process.env.CORS_ORIGIN ??= "http://localhost:5173,http://localhost:5174,http://localhost:5175";

// Same "local dev convenience only, never touches a real deployment"
// reasoning as CORS_ORIGIN above — without this, the admin app's
// bootstrap endpoint (POST /admin-auth/register) has no real key to
// gate against locally (AdminApiKeyGuard fails closed with no key
// configured at all, same as a real deployment with ADMIN_API_KEY unset
// — see that guard's own comment). A real deployment sets its own real
// ADMIN_API_KEY; this default only ever applies when nothing already did.
process.env.ADMIN_API_KEY ??= "dev-only-admin-bootstrap-key";

const { spawn } = require("child_process");
// shell: true — on Windows, spawning the "npx.cmd" shim directly (no
// shell) throws EINVAL; routing it through the shell is the standard fix
// and matches how npm itself invokes .cmd shims on this platform.
const child = spawn("npx", ["nest", "start", "--watch"], {
  stdio: "inherit",
  env: process.env,
  shell: true,
});
child.on("exit", (code) => process.exit(code ?? 0));
