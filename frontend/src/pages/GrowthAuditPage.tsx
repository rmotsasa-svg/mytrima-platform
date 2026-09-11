import { useEffect, useState } from "react";
import { GrowthAuditApi } from "../api/resources";
import type { GrowthAuditAnswers, GrowthAuditQuestions, GrowthAuditResponse, PerformanceBand, RecommendationResult } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../api/client";
import { Banner, Button, Card, EmptyState, PageHeader, Pill, formatDateTime } from "../components/ui";

const BAND_TONE: Record<PerformanceBand, "positive" | "attention" | "critical" | "neutral" | "gold"> = {
  "High-Growth": "positive",
  Stable: "gold",
  Weak: "attention",
  Critical: "critical",
};

/** The 0-4 scale itself (question id -> integer score, see
 * growth-audit.service.ts's `Answers` type) is real and backend-enforced;
 * these five labels are this SPA's own plain-English gloss on that scale,
 * not text pulled from the Mytrima_Growth_Audit_Questionnaire.docx this
 * instrument mirrors (this repo has no copy of that document to quote) —
 * disclosed here rather than presented as the questionnaire's own wording. */
const SCALE_LABELS = ["0 — Not in place", "1 — Just started", "2 — Partially in place", "3 — Mostly in place", "4 — Fully in place"];

export function GrowthAuditPage() {
  const { session } = useAuth();
  const tenantId = session.status === "loggedIn" ? session.profile.tenantId : "";
  const canSubmit = session.status === "loggedIn" && session.profile.role !== "read_only";

  const [questions, setQuestions] = useState<GrowthAuditQuestions | null>(null);
  const [history, setHistory] = useState<GrowthAuditResponse[]>([]);
  const [recommendations, setRecommendations] = useState<RecommendationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  async function load() {
    if (!tenantId) return;
    setLoading(true);
    try {
      const [q, h, r] = await Promise.all([GrowthAuditApi.questions(), GrowthAuditApi.list(tenantId), GrowthAuditApi.recommendations(tenantId)]);
      setQuestions(q);
      setHistory(h);
      setRecommendations(r);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the Growth Audit.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const latest = [...history].sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime())[0];

  return (
    <div>
      <PageHeader
        title="Growth audit"
        subtitle="A 40-question, 7-section instrument scoring how growth-ready the business is right now."
        actions={
          canSubmit &&
          questions && (
            <Button variant="primary" onClick={() => setShowForm((s) => !s)}>
              {showForm ? "Cancel" : latest ? "Retake the audit" : "Take the audit"}
            </Button>
          )
        }
      />

      {error && <Banner kind="error">{error}</Banner>}

      {showForm && questions && (
        <>
          <AuditForm
            questions={questions}
            onSubmitted={() => {
              setShowForm(false);
              void load();
            }}
          />
          <div style={{ height: "1.1rem" }} />
        </>
      )}

      {!loading && !latest && !showForm && (
        <div className="card">
          <EmptyState>No Growth Audit on record yet{canSubmit ? " — take the first one above." : "."}</EmptyState>
        </div>
      )}

      {latest && !showForm && (
        <>
          <Card
            title={`Latest result — ${formatDateTime(latest.submittedAt)}`}
            actions={<Pill tone={BAND_TONE[latest.result.band]}>{latest.result.band}</Pill>}
          >
            <p style={{ marginTop: 0 }}>
              Overall score: <strong className="tabular">{latest.result.overallScore.toFixed(1)}</strong> / 100
            </p>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Section</th>
                    <th>Weight</th>
                    <th>Section score</th>
                    <th>Weighted contribution</th>
                  </tr>
                </thead>
                <tbody>
                  {latest.result.sections.map((s) => (
                    <tr key={s.key}>
                      <td>{s.name}</td>
                      <td>{s.weightPct}%</td>
                      <td>{s.sectionPct.toFixed(0)}%</td>
                      <td className="tabular">{s.weightedContribution.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div style={{ height: "1.1rem" }} />

          {recommendations && <RecommendationsView recommendations={recommendations} />}

          {history.length > 1 && (
            <>
              <div style={{ height: "1.1rem" }} />
              <Card title="History">
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Submitted</th>
                        <th>Score</th>
                        <th>Band</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...history]
                        .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime())
                        .map((h) => (
                          <tr key={h.id}>
                            <td>{formatDateTime(h.submittedAt)}</td>
                            <td className="tabular">{h.result.overallScore.toFixed(1)}</td>
                            <td>
                              <Pill tone={BAND_TONE[h.result.band]}>{h.result.band}</Pill>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}

function RecommendationsView({ recommendations }: { recommendations: RecommendationResult }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "1.1rem" }}>
      <Card title="Where the points are">
        {recommendations.topSectionHasNoAppSignal && (
          <Banner kind="info">The top-opportunity section has no in-app signal Mytrima can verify automatically — action here relies on your own follow-through.</Banner>
        )}
        {recommendations.rankedSections.length === 0 ? (
          <p style={{ color: "var(--color-ink-muted)" }}>Nothing ranked yet.</p>
        ) : (
          <ol style={{ margin: 0, paddingLeft: "1.1rem" }}>
            {recommendations.rankedSections.slice(0, 5).map((s) => (
              <li key={s.sectionKey} style={{ marginBottom: "0.4rem" }}>
                <strong>{s.sectionName}</strong> — {s.sectionPct.toFixed(0)}% today, {s.weightedOpportunity.toFixed(1)} points of overall score still available
              </li>
            ))}
          </ol>
        )}
        {recommendations.actionToActionRate !== null && (
          <p style={{ marginTop: "0.8rem", fontSize: "0.85rem", color: "var(--color-ink-muted)" }}>
            {(recommendations.actionToActionRate * 100).toFixed(0)}% of past recommended actions were later detected as actually done.
          </p>
        )}
      </Card>
      <Card title="Recommended next actions">
        {recommendations.actions.length === 0 ? (
          <p style={{ color: "var(--color-ink-muted)" }}>No specific actions surfaced.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
            {recommendations.actions.map((a) => (
              <li key={a.actionKey} style={{ marginBottom: "0.5rem" }}>
                {a.actionLabel}
                <div style={{ fontSize: "0.8rem", color: "var(--color-ink-muted)" }}>Scored {a.score}/4 on: {a.questionText}</div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {recommendations.divergences.length > 0 && (
        <Card title="Worth a second look">
          <p style={{ marginTop: 0, fontSize: "0.85rem", color: "var(--color-ink-muted)" }}>
            Scored weak on the survey, but Mytrima's own data shows it's already happening — the answer may be out of date.
          </p>
          <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
            {recommendations.divergences.map((d) => (
              <li key={d.questionId} style={{ marginBottom: "0.4rem" }}>
                {d.note}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function AuditForm({ questions, onSubmitted }: { questions: GrowthAuditQuestions; onSubmitted: () => void }) {
  const [answers, setAnswers] = useState<GrowthAuditAnswers>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const allQuestionIds = questions.sections.flatMap((s) => s.questionIds);
  const answeredCount = allQuestionIds.filter((id) => id in answers).length;

  async function handleSubmit() {
    const missing = allQuestionIds.filter((id) => !(id in answers));
    if (missing.length > 0) {
      setError(`Answer every question first — ${missing.length} remaining.`);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await GrowthAuditApi.submit(answers);
      onSubmitted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not submit this audit.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card title={`Answer every question (${answeredCount} of ${allQuestionIds.length})`}>
      {error && <Banner kind="error">{error}</Banner>}
      <div style={{ display: "flex", flexDirection: "column", gap: "1.4rem" }}>
        {questions.sections.map((section) => (
          <div key={section.key}>
            <h3 style={{ fontSize: "1rem", marginBottom: "0.7rem" }}>
              {section.name} <span style={{ color: "var(--color-ink-muted)", fontWeight: 400, fontSize: "0.82rem" }}>({section.weightPct}% of overall score)</span>
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
              {section.questionIds.map((id) => (
                <div key={id}>
                  <p style={{ margin: "0 0 0.4rem", fontSize: "0.9rem" }}>{questions.questionText[id]}</p>
                  <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                    {SCALE_LABELS.map((label, score) => (
                      <label
                        key={score}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.3rem",
                          border: `1px solid ${answers[id] === score ? "var(--color-teal)" : "var(--color-border)"}`,
                          background: answers[id] === score ? "var(--color-mint-soft)" : "var(--color-surface)",
                          borderRadius: 7,
                          padding: "0.3rem 0.55rem",
                          fontSize: "0.8rem",
                          cursor: "pointer",
                        }}
                      >
                        <input
                          type="radio"
                          name={`q-${id}`}
                          checked={answers[id] === score}
                          onChange={() => setAnswers((prev) => ({ ...prev, [id]: score }))}
                          style={{ margin: 0 }}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: "1.2rem" }}>
        <Button variant="primary" disabled={submitting} onClick={() => void handleSubmit()}>
          {submitting ? "Submitting…" : "Submit audit"}
        </Button>
      </div>
    </Card>
  );
}
