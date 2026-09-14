import { useEffect, useState } from "react";
import { GoalsApi, OnboardingApi, SnapshotApi, TenantApi } from "../api/resources";
import type { BusinessSnapshot } from "../api/types";
import { useAuth } from "./AuthContext";
import { ApiError } from "../api/client";
import { Banner, Button, Card, Pill } from "../components/ui";
import { NotificationPhoneCard, PayfastMerchantIdCard, SocialConnectionCard } from "../pages/SettingsPage";
import { GrowthAuditPage } from "../pages/GrowthAuditPage";
import "./auth-pages.css";

type WizardStep = 1 | 2 | 3 | 4 | 5;

const STEP_TITLES: Record<WizardStep, string> = {
  1: "Tell us about your business",
  2: "What are you trying to achieve?",
  3: "Connect your data",
  4: "Complete your Growth Audit",
  5: "Your Growth Command Centre",
};

/**
 * Phase 8 of the GrowthOS-aligned restructuring plan
 * (C:\Users\USER\.claude\plans\twinkly-sprouting-orbit.md). Rendered by
 * App.tsx's AuthGate in place of the normal <Layout> routes, the same
 * "pre-dashboard gate, not a redirect that can be raced" pattern already
 * used for mfaEnrollmentRequired (MfaEnrollPage.tsx) — same teal
 * full-bleed background as every other pre-dashboard screen (auth-pages
 * .css), widened here since this wizard's content (a 6-way objective
 * pick, an embedded Growth Audit) genuinely needs more than a login
 * form's 380px.
 *
 * Every step below is a REAL write against an existing endpoint (or a
 * Phase 3/7 one from this same plan) — nothing here is a fabricated
 * "draft" state with its own fake save. Step 4 embeds GrowthAuditPage.tsx
 * completely unmodified, per the plan's own explicit instruction — this
 * component never re-implements audit submission, it only polls the real
 * OnboardingApi status afterward to know whether that real submission
 * actually happened.
 */
export function OnboardingWizardPage({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState<WizardStep>(1);

  return (
    <div className="auth-page">
      <div className="auth-card" style={{ maxWidth: 720 }}>
        <div className="auth-brand">
          <img src="/brand/lockup-horizontal-teal.png" alt="Mytrima — Built for how you grow" />
        </div>
        <p className="auth-subtitle" style={{ marginBottom: "0.2rem" }}>
          Step {step} of 5 — {STEP_TITLES[step]}
        </p>
        <div style={{ height: 6, borderRadius: 999, background: "var(--color-surface-sunken)", overflow: "hidden", marginBottom: "1.3rem" }}>
          <div style={{ height: "100%", width: `${(step / 5) * 100}%`, background: "var(--color-teal)", transition: "width 0.3s ease" }} />
        </div>

        {step === 1 && <BusinessBasicsStep onNext={() => setStep(2)} />}
        {step === 2 && <ObjectiveStep onNext={() => setStep(3)} />}
        {step === 3 && <ConnectDataStep onNext={() => setStep(4)} />}
        {step === 4 && <GrowthAuditStep onNext={() => setStep(5)} />}
        {step === 5 && <CommandCentreStep onDone={onComplete} />}
      </div>
    </div>
  );
}

function BusinessBasicsStep({ onNext }: { onNext: () => void }) {
  const [description, setDescription] = useState("");
  const [industry, setIndustry] = useState("");
  const [location, setLocation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!description.trim()) {
      setError("Tell us at least a little about the business — this is what makes every recommendation below real, not generic.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await TenantApi.setBusinessProfile({ description: description.trim(), industry: industry.trim() || undefined, location: location.trim() || undefined });
      onNext();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save your business profile.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      {error && <Banner kind="error">{error}</Banner>}
      <div className="field" style={{ marginBottom: "0.85rem" }}>
        <label htmlFor="wiz-description">What does this business do?</label>
        <textarea id="wiz-description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="A hair and beauty salon in Maseru, three chairs, open six days a week." />
      </div>
      <div className="form-grid" style={{ marginBottom: "1.1rem" }}>
        <div className="field">
          <label htmlFor="wiz-industry">Industry</label>
          <input id="wiz-industry" value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="Salon & beauty" />
        </div>
        <div className="field">
          <label htmlFor="wiz-location">Location</label>
          <input id="wiz-location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Maseru" />
        </div>
      </div>
      <Button variant="primary" disabled={submitting} style={{ width: "100%", justifyContent: "center" }} onClick={() => void handleSubmit()}>
        {submitting ? "Saving…" : "Continue"}
      </Button>
    </div>
  );
}

const OBJECTIVES: { label: string; objective: string; metric: string }[] = [
  { label: "Increase revenue", objective: "Increase revenue", metric: "Monthly revenue (LSL)" },
  { label: "Get more customers", objective: "Get more customers", metric: "New customers per month" },
  { label: "Improve retention", objective: "Improve customer retention", metric: "Repeat rate (%)" },
  { label: "Improve customer experience", objective: "Improve customer experience", metric: "Average rating (out of 5)" },
  { label: "Improve sales", objective: "Improve sales conversion", metric: "Conversion rate (%)" },
  { label: "Build brand", objective: "Build brand awareness", metric: "Social media reach" },
];

function defaultDeadline(): string {
  const d = new Date();
  d.setDate(d.getDate() + 90);
  return d.toISOString().slice(0, 10);
}

/** Real baseline/target numbers are collected from the owner directly —
 * deliberately NOT defaulted to a guessed pair of numbers (e.g. both 0),
 * which would either be fabricated data or fail GoalService's own real
 * "target must differ from baseline" validation. Only the objective/
 * metric LABELS (real strings, not measurements) and the deadline (a real
 * future date, editable) get sensible pre-filled defaults — matching this
 * whole session's "never fabricate a number" discipline applied to what's
 * actually a number here. */
function ObjectiveStep({ onNext }: { onNext: () => void }) {
  const { session } = useAuth();
  const tenantId = session.status === "loggedIn" ? session.profile.tenantId : "";
  const [picked, setPicked] = useState<number | null>(null);
  const [baselineValue, setBaselineValue] = useState("");
  const [targetValue, setTargetValue] = useState("");
  const [deadline, setDeadline] = useState(defaultDeadline());
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (picked === null) return;
    const baseline = Number(baselineValue);
    const target = Number(targetValue);
    if (!Number.isFinite(baseline) || !Number.isFinite(target)) {
      setError("Enter your real current number and a real target — both as plain numbers.");
      return;
    }
    if (baseline === target) {
      setError("Your target needs to be different from where you're starting — otherwise there's nothing to track.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const choice = OBJECTIVES[picked];
      await GoalsApi.create(tenantId, { objective: choice.objective, metric: choice.metric, baselineValue: baseline, targetValue: target, deadline, priority: "high" });
      onNext();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save this goal.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      {error && <Banner kind="error">{error}</Banner>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "1.1rem" }}>
        {OBJECTIVES.map((o, i) => (
          <button
            key={o.label}
            type="button"
            onClick={() => setPicked(i)}
            style={{
              padding: "0.55rem 0.9rem",
              borderRadius: 8,
              border: i === picked ? "2px solid var(--color-teal)" : "1px solid var(--color-border)",
              background: i === picked ? "var(--color-mint-soft)" : "var(--color-surface)",
              cursor: "pointer",
              fontSize: "0.88rem",
              fontWeight: i === picked ? 600 : 500,
            }}
          >
            {o.label}
          </button>
        ))}
      </div>

      {picked !== null && (
        <>
          <p style={{ fontSize: "0.85rem", color: "var(--color-ink-muted)", marginTop: 0 }}>
            Tracking: <strong>{OBJECTIVES[picked].metric}</strong>
          </p>
          <div className="form-grid" style={{ marginBottom: "1.1rem" }}>
            <div className="field">
              <label htmlFor="wiz-baseline">Where you are now</label>
              <input id="wiz-baseline" value={baselineValue} onChange={(e) => setBaselineValue(e.target.value)} inputMode="decimal" />
            </div>
            <div className="field">
              <label htmlFor="wiz-target">Where you want to be</label>
              <input id="wiz-target" value={targetValue} onChange={(e) => setTargetValue(e.target.value)} inputMode="decimal" />
            </div>
            <div className="field">
              <label htmlFor="wiz-deadline">By when</label>
              <input id="wiz-deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </div>
          </div>
        </>
      )}

      <Button variant="primary" disabled={picked === null || submitting} style={{ width: "100%", justifyContent: "center" }} onClick={() => void handleSubmit()}>
        {submitting ? "Saving…" : "Set this goal"}
      </Button>
    </div>
  );
}

function ConnectDataStep({ onNext }: { onNext: () => void }) {
  const { session } = useAuth();
  const tenantId = session.status === "loggedIn" ? session.profile.tenantId : "";

  return (
    <div>
      <p style={{ marginTop: 0, color: "var(--color-ink-muted)", fontSize: "0.88rem" }}>
        Optional, and you can always do this later from Settings — but a business already connected sees real numbers on its Dashboard from day one.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem", marginBottom: "1.1rem" }}>
        <NotificationPhoneCard />
        <PayfastMerchantIdCard tenantId={tenantId} />
        <SocialConnectionCard tenantId={tenantId} />
      </div>
      <Button variant="primary" style={{ width: "100%", justifyContent: "center" }} onClick={onNext}>
        Continue
      </Button>
    </div>
  );
}

function GrowthAuditStep({ onNext }: { onNext: () => void }) {
  const { session } = useAuth();
  const tenantId = session.status === "loggedIn" ? session.profile.tenantId : "";
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  /** Never assumes the embedded, unmodified GrowthAuditPage.tsx actually
   * submitted anything — checks the real OnboardingApi status (the same
   * signal computeIsFirstRun() itself is built from) before advancing.
   * `isFirstRun` still true here means either the Goal (step 2, already
   * genuinely real by this point) or the Growth Audit hasn't landed —
   * since step 2 is already confirmed complete to have reached this step,
   * still-true here can only mean the audit itself hasn't been submitted
   * yet. */
  async function handleContinue() {
    setChecking(true);
    setError(null);
    try {
      const status = await OnboardingApi.get(tenantId);
      if (status.isFirstRun) {
        setError("Submit the Growth Audit above first — once it's in, come back and click Continue.");
        return;
      }
      onNext();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not check your progress.");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div>
      <p style={{ marginTop: 0, color: "var(--color-ink-muted)", fontSize: "0.88rem" }}>
        This is the real 40-question instrument — the same one on the Growth Audit page you'll use again later. Submit it below, then continue.
      </p>
      <div style={{ border: "1px solid var(--color-border)", borderRadius: 10, padding: "0.5rem 0.9rem", marginBottom: "1.1rem", maxHeight: 420, overflowY: "auto" }}>
        <GrowthAuditPage />
      </div>
      {error && <Banner kind="error">{error}</Banner>}
      <Button variant="primary" disabled={checking} style={{ width: "100%", justifyContent: "center" }} onClick={() => void handleContinue()}>
        {checking ? "Checking…" : "I've submitted my audit — continue"}
      </Button>
    </div>
  );
}

const SEVERITY_TONE: Record<"critical" | "warning" | "info", "critical" | "attention" | "neutral"> = {
  critical: "critical",
  warning: "attention",
  info: "neutral",
};

function CommandCentreStep({ onDone }: { onDone: () => void }) {
  const { session } = useAuth();
  const tenantId = session.status === "loggedIn" ? session.profile.tenantId : "";
  const [snapshot, setSnapshot] = useState<BusinessSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    SnapshotApi.get(tenantId)
      .then(setSnapshot)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load your Growth Score."));
  }, [tenantId]);

  return (
    <div>
      <p style={{ marginTop: 0, fontSize: "0.92rem" }}>You're set up. Here's where things stand right now — this is your real Dashboard, every time you sign in from here.</p>
      {error && <Banner kind="error">{error}</Banner>}
      {snapshot && (
        <>
          <Card title="Growth Score">
            {snapshot.growthAudit.latestScore === null ? (
              <p style={{ color: "var(--color-ink-muted)", margin: 0 }}>Not yet computed.</p>
            ) : (
              <p style={{ margin: 0 }}>
                <strong className="tabular" style={{ fontSize: "1.4rem" }}>
                  {snapshot.growthAudit.latestScore}
                </strong>{" "}
                / 100 {snapshot.growthAudit.latestBand && <Pill tone="gold">{snapshot.growthAudit.latestBand}</Pill>}
              </p>
            )}
          </Card>
          <div style={{ height: "0.9rem" }} />
          <Card title="Today's priorities">
            {snapshot.priorities.length === 0 ? (
              <p style={{ color: "var(--color-ink-muted)", margin: 0 }}>Nothing needs your attention right now.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {snapshot.priorities.map((p, i) => (
                  <div key={i} style={{ display: "flex", gap: "0.6rem", alignItems: "center", fontSize: "0.85rem" }}>
                    <Pill tone={SEVERITY_TONE[p.severity]}>{p.severity}</Pill>
                    <span>{p.label}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <div style={{ height: "1.3rem" }} />
        </>
      )}
      <Button variant="primary" style={{ width: "100%", justifyContent: "center" }} onClick={onDone}>
        Enter Mytrima
      </Button>
    </div>
  );
}
