import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { registerTenant, SignupApiError } from "../api";
import { AdBanner } from "../components/AdBanner";

type FormStatus = "idle" | "submitting" | "success";

export function HomePage() {
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
    <>
      <section className="hero">
        <p className="eyebrow">Built for how you grow</p>
        <h1>Growth tooling for Lesotho businesses, in one place.</h1>
        <p className="hero-sub">
          A real Growth Audit, website analytics, booking, and customer feedback — for a business that runs on a phone
          between customers, not a spreadsheet on a desk.
        </p>
        <div className="hero-actions">
          <a href="#signup" className="btn btn-primary btn-large">
            Start free
          </a>
          <Link to="/solution" className="btn btn-ghost btn-large">
            See our solution
          </Link>
        </div>
      </section>

      <section className="ad-banners">
        <AdBanner
          eyebrow="Growth Audit"
          title="See where you actually stand."
          body="A real 40-question instrument, scored across seven sections — not a gut feeling about how the business is doing."
          linkTo="/solution"
          linkLabel="How it's scored"
          chart="bars"
        />
        <AdBanner
          eyebrow="Website analytics"
          title="Watch your traffic build, day by day."
          body="One line of code on your site, and real visits start showing up on your dashboard — no analytics account to set up first."
          linkTo="/solution"
          linkLabel="How it works"
          chart="line"
        />
        <AdBanner
          eyebrow="Customer experience"
          title="Turn feedback into one clear number."
          body="Star ratings and NPS roll up into a real average the moment a customer is willing to give it — not a spreadsheet you update by hand."
          linkTo="/solution"
          linkLabel="See the full picture"
          chart="donut"
        />
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
              then <a href={(import.meta.env.VITE_APP_URL as string | undefined) ?? "http://localhost:5173"}>sign in</a>{" "}
              to set up your business.
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
    </>
  );
}
