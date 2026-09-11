import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { TenantApi } from "../api/resources";
import type { TenantProfile } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../api/client";
import { Banner, Button, Card, PageHeader } from "../components/ui";

/**
 * REAL GAP the tenant asked about directly ("business set up page where is
 * it") — closed 2026-09-11. Nothing in this platform anywhere (schema,
 * backend, or this SPA) had ever had a home for a business's own identity:
 * what it does, where it is, how to reach it, what sector it's in, or what
 * growth outcome it's chasing. Products/services with prices already had a
 * real home — the Catalog page — so this page doesn't duplicate that, it
 * links to it.
 */
export function BusinessProfilePage() {
  const { session } = useAuth();
  const isOwner = session.status === "loggedIn" && session.profile.role === "owner";

  const [profile, setProfile] = useState<TenantProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setProfile(await TenantApi.getMe());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the business profile.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div>
      <PageHeader
        title="Business profile"
        subtitle="What your business is, where it is, and how customers and Mytrima reach you."
        actions={
          isOwner && (
            <Button variant="primary" onClick={() => setShowForm((s) => !s)}>
              {showForm ? "Cancel" : "Edit"}
            </Button>
          )
        }
      />
      {error && <Banner kind="error">{error}</Banner>}

      {showForm && profile && (
        <>
          <ProfileForm
            profile={profile}
            onSaved={(updated) => {
              setProfile(updated);
              setShowForm(false);
            }}
          />
          <div style={{ height: "1.1rem" }} />
        </>
      )}

      {!loading && profile && (
        <>
          <Card title={profile.name}>
            <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", rowGap: "0.6rem", columnGap: "1rem" }}>
              <Field label="Description" value={profile.description} />
              <Field label="Industry" value={profile.industry} />
              <Field label="Location" value={profile.location} />
              <Field label="Contact email" value={profile.contactEmail} />
              <Field label="Contact phone" value={profile.contactPhone} />
              <Field label="Business goal" value={profile.businessGoal} />
            </dl>
            {!profile.description && !profile.industry && !profile.location && !profile.contactEmail && !profile.contactPhone && !profile.businessGoal && (
              <p style={{ color: "var(--color-ink-muted)", fontSize: "0.88rem", marginTop: "0.8rem" }}>
                Nothing filled in yet.{isOwner ? " Click Edit above to get started." : " Ask an owner to fill this in."}
              </p>
            )}
          </Card>

          <div style={{ height: "1.1rem" }} />

          <Card title="Products &amp; services">
            <p style={{ marginTop: 0, color: "var(--color-ink-muted)", fontSize: "0.88rem" }}>
              What you sell and what it costs lives in your Catalog, not here — services and products a customer can book or buy, each with its own price.
            </p>
            <Link to="/catalog" className="btn btn-secondary">
              Go to Catalog →
            </Link>
          </Card>
        </>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string }) {
  return (
    <>
      <dt style={{ color: "var(--color-ink-muted)", fontSize: "0.85rem" }}>{label}</dt>
      <dd style={{ margin: 0 }}>{value || <span style={{ color: "var(--color-ink-muted)" }}>Not set</span>}</dd>
    </>
  );
}

function ProfileForm({ profile, onSaved }: { profile: TenantProfile; onSaved: (updated: TenantProfile) => void }) {
  const [description, setDescription] = useState(profile.description ?? "");
  const [industry, setIndustry] = useState(profile.industry ?? "");
  const [location, setLocation] = useState(profile.location ?? "");
  const [contactEmail, setContactEmail] = useState(profile.contactEmail ?? "");
  const [contactPhone, setContactPhone] = useState(profile.contactPhone ?? "");
  const [businessGoal, setBusinessGoal] = useState(profile.businessGoal ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      await TenantApi.setBusinessProfile({ description, industry, location, contactEmail, contactPhone, businessGoal });
      onSaved({ ...profile, description, industry, location, contactEmail, contactPhone, businessGoal });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save your business profile.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card title="Edit business profile">
      {error && <Banner kind="error">{error}</Banner>}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
        <div className="field">
          <label htmlFor="bp-description">Business description</label>
          <textarea id="bp-description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What does your business do, in a sentence or two?" />
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="bp-industry">Industry</label>
            <input id="bp-industry" value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="e.g. Retail, Hospitality, Salon & beauty" />
          </div>
          <div className="field">
            <label htmlFor="bp-location">Location</label>
            <input id="bp-location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Maseru, Lesotho" />
          </div>
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="bp-contact-email">Contact email</label>
            <input id="bp-contact-email" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="hello@yourbusiness.co.ls" />
          </div>
          <div className="field">
            <label htmlFor="bp-contact-phone">Contact phone</label>
            <input id="bp-contact-phone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="+26658123456" />
          </div>
        </div>
        <div className="field">
          <label htmlFor="bp-goal">Business goal</label>
          <textarea id="bp-goal" value={businessGoal} onChange={(e) => setBusinessGoal(e.target.value)} placeholder="What are you trying to achieve over the next year?" />
        </div>
        <div>
          <Button variant="primary" disabled={submitting} onClick={() => void handleSubmit()}>
            {submitting ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
