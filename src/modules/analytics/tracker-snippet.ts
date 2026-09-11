/**
 * The actual tracking snippet a tenant embeds on THEIR OWN website — a
 * plain classic `<script>` tag, no build step or bundler needed on the
 * tenant's side:
 *
 *   <script src="https://<this-api's-domain>/analytics/tracker.js"
 *           data-tenant-id="<their tenant id>" async></script>
 *
 * Design choices, each one a direct consequence of decisions already made
 * in website-visit.service.ts / migration 0025 — see those files' own
 * comments for the full reasoning, not repeated here:
 *   - Reads the tenant id from the script tag's own `data-tenant-id`
 *     attribute (the same technique Plausible/Fathom-style trackers use)
 *     rather than requiring a separate global-variable snippet — one
 *     script tag is the entire integration.
 *   - Derives the API origin to POST to from `currentScript.src` itself
 *     (wherever this file was actually loaded from) rather than a
 *     hardcoded domain, so this one file works unmodified in any
 *     environment (local dev, staging, production).
 *   - Session id lives ONLY in `sessionStorage` (cleared when the tab/
 *     session ends), generated client-side, never a persistent cookie.
 *   - Never reads or sends anything about the visitor beyond what this
 *     file shows below — no fingerprinting, no third-party requests.
 *   - Every network failure is swallowed — a tenant's own site must never
 *     break, slow down, or throw a console error because of this tracker;
 *     it is best-effort telemetry, not a feature their site depends on.
 *
 * Served as a real HTTP response by AnalyticsController.trackerScript()
 * rather than a static file, matching AppController's own
 * inline-string-response pattern for the dashboard HTML — this project's
 * established "no new static-file-serving dependency" discipline.
 */
export const TRACKER_SNIPPET_JS = `(function () {
  var currentScript = document.currentScript;
  if (!currentScript) return;
  var tenantId = currentScript.getAttribute("data-tenant-id");
  if (!tenantId) return;

  var apiOrigin;
  try {
    apiOrigin = new URL(currentScript.src).origin;
  } catch (e) {
    return;
  }

  var SESSION_KEY = "mytrima_analytics_session_id";

  function randomId() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function getSessionId() {
    try {
      var existing = window.sessionStorage.getItem(SESSION_KEY);
      if (existing) return existing;
      var fresh = randomId();
      window.sessionStorage.setItem(SESSION_KEY, fresh);
      return fresh;
    } catch (e) {
      // sessionStorage unavailable (private browsing, disabled storage) —
      // fall back to a per-pageview id rather than recording nothing at
      // all; a real, disclosed trade-off ("sessions" degrade to one page
      // view each in that browser), not a silent miscount elsewhere.
      return randomId();
    }
  }

  var payload = {
    sessionId: getSessionId(),
    path: window.location.pathname,
    referrer: document.referrer || undefined,
  };

  fetch(apiOrigin + "/analytics/collect/" + encodeURIComponent(tenantId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(function () {
    // See this file's own top comment: never let a failed beacon surface
    // as an error on the tenant's own site.
  });
})();
`;
