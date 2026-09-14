import { useState } from "react";
import { useParams } from "react-router-dom";
import { NpsApi, RatingsApi } from "../api/resources";
import { ApiError } from "../api/client";
import { Banner, Button } from "../components/ui";
import "../auth/auth-pages.css";

/**
 * REAL GAP found 2026-09-14 building "request rating/NPS through WhatsApp
 * or email": `POST /ratings` and `POST /nps` have been public, unauthenticated
 * endpoints since their own first pass (a customer submitting one is not a
 * Mytrima account holder anywhere in this system) — but nothing anywhere in
 * this codebase ever gave a real customer a page to land on and actually
 * use them. Confirmed by grep before building this, not assumed: `landing/`
 * is marketing-only with no tenant/customer-scoped routes, and this SPA's
 * own `CustomerExperiencePage.tsx` is the tenant-facing moderation view, not
 * a customer submission form.
 *
 * Reached WITHOUT a session, same as VerifyEmailPage.tsx — checked in
 * App.tsx's AuthGate before the normal logged-in/logged-out branch, since a
 * customer clicking a link from an SMS/email/WhatsApp message has no
 * Mytrima account and never will. `tenantId`/`customerId` come straight
 * from the URL (CustomerController.requestFeedback() builds this exact
 * link) — there's no secret token here, same trust model as a mailed
 * physical comment card: anyone with the link can leave feedback AS that
 * customer record, which is an accepted, low-stakes trade-off for a
 * feedback form (not a data-access surface) at this pilot's scale.
 *
 * Rating and NPS are two independent, separately-submitted forms on one
 * page rather than one combined form — a customer might have an opinion on
 * only one of them, and neither backend endpoint depends on the other.
 */
export function FeedbackPage() {
  const { tenantId, customerId } = useParams<{ tenantId: string; customerId: string }>();

  return (
    <div className="auth-page">
      <div className="auth-card" style={{ maxWidth: 440 }}>
        <div className="auth-brand">
          <img src="/brand/icon-mark-teal.png" alt="" width={34} height={34} style={{ borderRadius: 8 }} />
          <h1>Tell us how we did</h1>
        </div>
        {!tenantId || !customerId ? (
          <Banner kind="error">This feedback link is missing information and can't be used.</Banner>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.4rem" }}>
            <RatingForm tenantId={tenantId} customerId={customerId} />
            <hr style={{ border: "none", borderTop: "1px solid var(--color-border)", margin: 0 }} />
            <NpsForm tenantId={tenantId} customerId={customerId} />
          </div>
        )}
      </div>
    </div>
  );
}

function RatingForm({ tenantId, customerId }: { tenantId: string; customerId: string }) {
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (stars === 0) {
      setError("Pick a star rating first.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await RatingsApi.submit(tenantId, customerId, stars, comment || undefined);
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not submit your rating — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) return <Banner kind="info">Thanks for rating us!</Banner>;

  return (
    <div>
      <p className="auth-subtitle" style={{ marginBottom: "0.6rem" }}>
        How would you rate your experience?
      </p>
      {error && <Banner kind="error">{error}</Banner>}
      <div style={{ display: "flex", gap: "0.4rem", fontSize: "2rem", marginBottom: "0.75rem" }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setStars(n)}
            aria-label={`${n} star${n === 1 ? "" : "s"}`}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 0, lineHeight: 1, color: n <= stars ? "#e8a933" : "var(--color-border)" }}
          >
            ★
          </button>
        ))}
      </div>
      <textarea
        placeholder="Anything you'd like to add? (optional)"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={3}
        style={{ width: "100%", resize: "vertical", marginBottom: "0.75rem" }}
      />
      <Button variant="primary" disabled={submitting} onClick={() => void submit()}>
        {submitting ? "Submitting…" : "Submit rating"}
      </Button>
    </div>
  );
}

function NpsForm({ tenantId, customerId }: { tenantId: string; customerId: string }) {
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (score === null) {
      setError("Pick a score first.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await NpsApi.submit(tenantId, customerId, score, comment || undefined);
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not submit your answer — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) return <Banner kind="info">Thanks for your answer!</Banner>;

  return (
    <div>
      <p className="auth-subtitle" style={{ marginBottom: "0.6rem" }}>
        How likely are you to recommend us to a friend? (0 = not at all, 10 = extremely likely)
      </p>
      {error && <Banner kind="error">{error}</Banner>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem", marginBottom: "0.75rem" }}>
        {Array.from({ length: 11 }, (_, n) => n).map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setScore(n)}
            style={{
              width: 32,
              height: 32,
              borderRadius: 6,
              border: "1px solid var(--color-border)",
              background: score === n ? "var(--color-teal)" : "transparent",
              color: score === n ? "#fff" : "inherit",
              cursor: "pointer",
              fontSize: "0.85rem",
            }}
          >
            {n}
          </button>
        ))}
      </div>
      <textarea
        placeholder="What's the main reason for your score? (optional)"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={3}
        style={{ width: "100%", resize: "vertical", marginBottom: "0.75rem" }}
      />
      <Button variant="primary" disabled={submitting} onClick={() => void submit()}>
        {submitting ? "Submitting…" : "Submit answer"}
      </Button>
    </div>
  );
}
