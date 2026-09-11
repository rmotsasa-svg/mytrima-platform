import { useState, type FormEvent } from "react";
import { registerTenant, SignupApiError } from "./api";
import "./App.css";

/** Same env-var-with-a-default pattern as api.ts's own API_BASE_URL — where
 * "Sign in" and the post-signup "verify your email" link both point. */
const APP_URL: string = (import.meta.env.VITE_APP_URL as string | undefined) ?? "http://localhost:5173";

const FEATURES = [
  {
    title: "Growth Audit",
    body: "A real 40-question instrument scored across seven sections — not a generic checklist. Answer once, get a weighted score, a band (from Weak to Strong), and specific actions for whatever scored lowest.",
  },
  {
    title: "Website analytics",
    body: "Paste one line into your site and start seeing real visits — pages, referrers, devices, sessions. No Google Analytics account to connect, no cookie banner to add: sessions reset every browser visit, and visitor IPs and exact devices are never stored.",
  },
  {
    title: "Bookings",
    body: "A public booking link your customers use directly — no account needed on their side. Confirm, decline, or mark no-shows from your own dashboard.",
  },
  {
    title: "Customer experience",
    body: "Star ratings and NPS, collected the moment a customer is willing to give it, rolled up into one real average — not a spreadsheet you update by hand.",
  },
  {
    title: "Sales & reporting",
    body: "Record a sale in seconds. See conversion rate, repeat rate, and customer lifetime value computed from what you've actually sold — not projected.",
  },
  {
    title: "One dashboard",
    body: "Every module above lives in one place, for one login — built for a business running on a phone between customers, not a spreadsheet on a desk.",
  },
];

type FormStatus = "idle" | "submitting" | "success";

export function App() {
  const [tenantName, setTenantName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerPassword, setOwnerPassword] = useState("");
  const [status, setStatus] = useState<FormStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setStatus("submitting");
    try {
      await registerTenant(tenantName.trim(), ownerEmail.trim(), ownerPassword);
      setStatus("success");
    } catch (err) {
      setError(err instanceof SignupApiError ? err.message : "Could not reach Mytrima right now — please try again shortly.");
      setStatus("idle");
    }
  }

  return (
    <div className="page">
      <header className="topbar">
        <img src="/brand/lockup-horizontal-light.svg" alt="Mytrima" className="topbar-logo" />
        <a href={APP_URL} className="topbar-signin">
          Sign in
        </a>
      </header>

      <section className="hero">
        <p className="eyebrow">Built for how you grow</p>
        <h1>Growth tooling for Lesotho businesses, in one place.</h1>
        <p className="hero-sub">
          A real Growth Audit, website analytics, booking, and customer feedback — for a business that runs on a phone
          between customers, not a spreadsheet on a desk.
        </p>
        <a href="#signup" className="btn btn-primary btn-large">
          Start free
        </a>
      </section>

      <section className="features">
        <h2>Everything a growth consultancy would tell you to track — already built.</h2>
        <div className="feature-grid">
          {FEATURES.map((f) => (
            <div className="feature-card" key={f.title}>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="snippet-highlight">
        <div className="snippet-copy">
          <p className="eyebrow">Website analytics</p>
          <h2>Your website's traffic, without the setup.</h2>
          <p>
            Paste one line into your site's HTML. That's the entire integration — no account to connect, no approval to
            wait on. It starts sending real visits back to your dashboard the next time someone loads your page.
          </p>
        </div>
        <pre className="snippet-block">
          <code>{'<script src="https://api.mytrima.co.za/analytics/tracker.js"\n        data-tenant-id="your-id" async></script>'}</code>
        </pre>
      </section>

      <section id="signup" className="signup">
        <h2>Start your business's account</h2>
        <p className="signup-sub">No card, no sales call. You'll get a real verification email before you can sign in.</p>

        {status === "success" ? (
          <div className="signup-success">
            <p>
              <strong>Account created.</strong> Check <strong>{ownerEmail}</strong> for a verification link — click it,
              then <a href={APP_URL}>sign in</a> to set up your business.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="signup-form">
            {error && <div className="signup-error">{error}</div>}
            <div className="field">
              <label htmlFor="tenantName">Business name</label>
              <input id="tenantName" value={tenantName} onChange={(e) => setTenantName(e.target.value)} required autoComplete="organization" />
            </div>
            <div className="field">
              <label htmlFor="ownerEmail">Your email</label>
              <input
                id="ownerEmail"
                type="email"
                value={ownerEmail}
                onChange={(e) => setOwnerEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
            <div className="field">
              <label htmlFor="ownerPassword">Password</label>
              <input
                id="ownerPassword"
                type="password"
                value={ownerPassword}
                onChange={(e) => setOwnerPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />
              <span className="field-hint">At least 8 characters.</span>
            </div>
            <button type="submit" className="btn btn-primary btn-large" disabled={status === "submitting"}>
              {status === "submitting" ? "Creating your account…" : "Create account"}
            </button>
          </form>
        )}
      </section>

      <footer className="footer">
        <img src="/brand/lockup-horizontal-light.svg" alt="Mytrima" className="footer-logo" />
        <p>Maseru, Lesotho</p>
      </footer>
    </div>
  );
}
