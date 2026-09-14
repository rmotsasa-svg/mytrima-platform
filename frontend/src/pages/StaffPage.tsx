import { Fragment, useEffect, useState } from "react";
import { StaffApi } from "../api/resources";
import type { Role, StaffActivityLogEntry, StaffProfile } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../api/client";
import { Banner, Button, Card, EmptyState, PageHeader, Pill, formatDateTime } from "../components/ui";

const ROLES: Role[] = ["owner", "manager", "staff", "read_only"];

const ACTIVITY_LABEL: Record<StaffActivityLogEntry["action"], string> = {
  "petty_cash.replenish": "Replenished petty cash",
  "petty_cash.pay_vendor": "Paid a vendor from petty cash",
  "sale.refund": "Processed a refund/exchange",
  "sale.recorded": "Recorded a sale",
  "booking.created_by_staff": "Booked a customer directly",
};

function staffDisplayName(member: Pick<StaffProfile, "firstName" | "lastName" | "email">): string {
  const name = [member.firstName, member.lastName].filter(Boolean).join(" ");
  return name || member.email;
}

export function StaffPage() {
  const { session } = useAuth();
  const isOwner = session.status === "loggedIn" && session.profile.role === "owner";

  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activityId, setActivityId] = useState<string | null>(null);

  async function load() {
    if (!isOwner) return;
    setLoading(true);
    try {
      setStaff(await StaffApi.list());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load staff.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwner]);

  async function changeRole(userId: string, role: Role) {
    setBusyId(userId);
    setError(null);
    try {
      await StaffApi.changeRole(userId, role);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not change that account's role.");
    } finally {
      setBusyId(null);
    }
  }

  async function toggleActive(member: StaffProfile) {
    setBusyId(member.id);
    setError(null);
    try {
      await (member.isActive ? StaffApi.deactivate(member.id) : StaffApi.reactivate(member.id));
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update this account.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Staff"
        subtitle={isOwner ? `${staff.length} account${staff.length === 1 ? "" : "s"} on this tenant` : "Your profile"}
        actions={
          isOwner && (
            <Button variant="primary" onClick={() => setShowInvite((s) => !s)}>
              {showInvite ? "Cancel" : "Invite teammate"}
            </Button>
          )
        }
      />

      {error && <Banner kind="error">{error}</Banner>}

      <OwnProfileCard />

      {!isOwner && (
        <>
          <div style={{ height: "1.1rem" }} />
          <Banner kind="info">Only an owner can view or manage the full staff list.</Banner>
        </>
      )}

      {isOwner && (
        <>
          <div style={{ height: "1.1rem" }} />
          {showInvite && (
            <>
              <InviteForm
                onInvited={() => {
                  setShowInvite(false);
                  void load();
                }}
              />
              <div style={{ height: "1.1rem" }} />
            </>
          )}
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>MFA</th>
                  <th>Status</th>
                  <th>Member since</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {staff.map((member) =>
                  editingId === member.id ? (
                    <EditStaffNameRow
                      key={member.id}
                      member={member}
                      onSaved={() => {
                        setEditingId(null);
                        void load();
                      }}
                      onCancel={() => setEditingId(null)}
                    />
                  ) : (
                    <Fragment key={member.id}>
                      <tr>
                        <td>{staffDisplayName(member)}</td>
                        <td>{member.email}</td>
                        <td>
                          <select
                            value={member.role}
                            disabled={busyId === member.id}
                            onChange={(e) => void changeRole(member.id, e.target.value as Role)}
                            style={{ border: "1px solid var(--color-border)", borderRadius: 6, padding: "0.25rem 0.4rem" }}
                          >
                            {ROLES.map((r) => (
                              <option key={r} value={r}>
                                {r.replace("_", " ")}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <Pill tone={member.mfaEnabled ? "positive" : "neutral"}>{member.mfaEnabled ? "Enabled" : "Not set up"}</Pill>
                        </td>
                        <td>
                          <Pill tone={member.isActive ? "positive" : "critical"}>{member.isActive ? "Active" : "Deactivated"}</Pill>
                        </td>
                        <td>{formatDateTime(member.createdAt)}</td>
                        <td>
                          <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                            <Button variant="ghost" onClick={() => setEditingId(member.id)}>
                              Edit name
                            </Button>
                            <Button variant="ghost" onClick={() => setActivityId((id) => (id === member.id ? null : member.id))}>
                              {activityId === member.id ? "Hide activity" : "Activity"}
                            </Button>
                            <Button
                              variant={member.isActive ? "danger" : "secondary"}
                              disabled={busyId === member.id}
                              onClick={() => void toggleActive(member)}
                            >
                              {member.isActive ? "Deactivate" : "Reactivate"}
                            </Button>
                          </div>
                        </td>
                      </tr>
                      {activityId === member.id && (
                        <tr>
                          <td colSpan={7} style={{ background: "var(--color-surface-sunken)" }}>
                            <StaffActivityPanel userId={member.id} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                )}
              </tbody>
            </table>
            {!loading && staff.length === 0 && <EmptyState>No staff accounts yet.</EmptyState>}
          </div>
        </>
      )}
    </div>
  );
}

/** "Allow tenant to add Name and lastname" — real gap closed 2026-09-14.
 * Real PATCH semantics — see AuthService.updateProfile()'s own comment. */
function EditStaffNameRow({
  member,
  onSaved,
  onCancel,
}: {
  member: StaffProfile;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [firstName, setFirstName] = useState(member.firstName ?? "");
  const [lastName, setLastName] = useState(member.lastName ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSave() {
    setError(null);
    setSubmitting(true);
    try {
      await StaffApi.updateProfile(member.id, firstName, lastName);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save this teammate's name.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <tr>
      <td colSpan={7}>
        {error && <Banner kind="error">{error}</Banner>}
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
          <input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="First name" style={{ width: "9rem" }} />
          <input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Last name" style={{ width: "9rem" }} />
          <Button variant="primary" disabled={submitting} onClick={() => void handleSave()}>
            {submitting ? "Saving…" : "Save"}
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </td>
    </tr>
  );
}

/** "Add staff activities history" — real gap closed 2026-09-14. See
 * staff-activity.service.ts's own comment for exactly which real actions
 * this covers — deliberately not every possible mutation. */
function StaffActivityPanel({ userId }: { userId: string }) {
  const [entries, setEntries] = useState<StaffActivityLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    StaffApi.activity(userId)
      .then((e) => !cancelled && setEntries(e))
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : "Could not load this teammate's activity."));
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (error) return <Banner kind="error">{error}</Banner>;
  if (!entries) return <p style={{ margin: "0.5rem 0", fontSize: "0.85rem", color: "var(--color-ink-muted)" }}>Loading…</p>;
  if (entries.length === 0) {
    return (
      <p style={{ margin: "0.5rem 0", fontSize: "0.85rem", color: "var(--color-ink-muted)" }}>
        No logged activity yet — petty cash, refunds/exchanges, sales, and staff-created bookings appear here.
      </p>
    );
  }

  return (
    <div style={{ padding: "0.75rem 0", display: "flex", flexDirection: "column", gap: "0.3rem" }}>
      {entries.map((e) => (
        <div key={e.id} style={{ fontSize: "0.82rem", display: "flex", gap: "0.6rem" }}>
          <span style={{ color: "var(--color-ink-muted)" }}>{formatDateTime(e.occurredAt)}</span>
          <span>{ACTIVITY_LABEL[e.action]}</span>
          {e.details && (
            <span style={{ color: "var(--color-ink-muted)" }}>
              {Object.entries(e.details)
                .map(([k, v]) => `${k}: ${v}`)
                .join(", ")}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function OwnProfileCard() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [nameLoaded, setNameLoaded] = useState(false);
  const [nameMessage, setNameMessage] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);

  useEffect(() => {
    StaffApi.me().then((profile) => {
      setFirstName(profile.firstName ?? "");
      setLastName(profile.lastName ?? "");
      setNameLoaded(true);
    });
  }, []);

  async function handleSubmit() {
    setError(null);
    setMessage(null);
    setSubmitting(true);
    try {
      await StaffApi.changeOwnPassword(currentPassword, newPassword);
      setMessage("Password changed.");
      setCurrentPassword("");
      setNewPassword("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not change your password.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSaveName() {
    setNameError(null);
    setNameMessage(null);
    setSavingName(true);
    try {
      await StaffApi.updateOwnProfile(firstName, lastName);
      setNameMessage("Name saved.");
    } catch (err) {
      setNameError(err instanceof ApiError ? err.message : "Could not save your name.");
    } finally {
      setSavingName(false);
    }
  }

  return (
    <>
      {/* "Allow tenant to add Name and lastname" — real gap closed
       * 2026-09-14; a staff member's own name, editable here without
       * needing an owner/manager to do it for them (PATCH /staff/me). */}
      <Card title="Your name">
        {nameMessage && <Banner kind="info">{nameMessage}</Banner>}
        {nameError && <Banner kind="error">{nameError}</Banner>}
        <div className="form-grid">
          <div className="field">
            <label htmlFor="own-first-name">First name</label>
            <input id="own-first-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} disabled={!nameLoaded} />
          </div>
          <div className="field">
            <label htmlFor="own-last-name">Last name</label>
            <input id="own-last-name" value={lastName} onChange={(e) => setLastName(e.target.value)} disabled={!nameLoaded} />
          </div>
          <Button variant="primary" disabled={savingName || !nameLoaded} onClick={() => void handleSaveName()}>
            {savingName ? "Saving…" : "Save name"}
          </Button>
        </div>
      </Card>

      <div style={{ height: "1.1rem" }} />

      <Card title="Change your own password">
        {message && <Banner kind="info">{message}</Banner>}
        {error && <Banner kind="error">{error}</Banner>}
        <div className="form-grid">
          <div className="field">
            <label htmlFor="current-pw">Current password</label>
            <input id="current-pw" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="new-pw">New password</label>
            <input id="new-pw" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </div>
          <Button variant="primary" disabled={submitting || !currentPassword || !newPassword} onClick={() => void handleSubmit()}>
            {submitting ? "Changing…" : "Change password"}
          </Button>
        </div>
      </Card>
    </>
  );
}

function InviteForm({ onInvited }: { onInvited: () => void }) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("staff");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      await StaffApi.registerStaff(email.trim(), password, role, firstName, lastName);
      onInvited();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not invite this teammate.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card title="Invite a teammate">
      {error && <Banner kind="error">{error}</Banner>}
      <div className="form-grid">
        <div className="field">
          <label htmlFor="invite-first-name">First name</label>
          <input id="invite-first-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="invite-last-name">Last name</label>
          <input id="invite-last-name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="invite-email">Email</label>
          <input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="invite-password">Temporary password</label>
          <input id="invite-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="invite-role">Role</label>
          <select id="invite-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r.replace("_", " ")}
              </option>
            ))}
          </select>
        </div>
        <Button variant="primary" disabled={submitting || !email || !password} onClick={() => void handleSubmit()}>
          {submitting ? "Inviting…" : "Invite"}
        </Button>
      </div>
    </Card>
  );
}
