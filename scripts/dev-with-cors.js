// Cross-platform substitute for `CORS_ORIGIN=... npm run start:dev`
// (that shell syntax doesn't work on Windows, and this repo has no
// cross-env dependency). Sets CORS_ORIGIN to both real local dev origins
// that call this API cross-origin — the SPA (frontend/vite.config.ts's
// fixed port 5173) AND the marketing/signup site
// (landing/vite.config.ts's fixed port 5174, see its HomePage.tsx
// registerTenant() call) — only if it isn't already set in the real
// environment, then hands off to the normal `nest start --watch` dev
// server. Local dev convenience only — never touches how the app runs in
// any real deployment, which sets CORS_ORIGIN itself.
process.env.CORS_ORIGIN ??= "http://localhost:5173,http://localhost:5174";

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
