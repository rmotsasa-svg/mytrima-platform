import { useEffect, useState } from "react";
import { StaffApi } from "../api/resources";
import type { Role, StaffProfile } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../api/client";
import { Banner, Button, Card, EmptyState, PageHeader, Pill, formatDateTime } from "../components/ui";

const ROLES: Role[] = ["owner", "staff", "read_only"];

export function StaffPage() {
  const { session } = useAuth();
  const isOwner = session.status === "loggedIn" && session.profile.role === "owner";

  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);

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
                  <th>Email</th>
                  <th>Role</th>
                  <th>MFA</th>
                  <th>Status</th>
                  <th>Member since</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {staff.map((member) => (
                  <tr key={member.id}>
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
                      <Button variant={member.isActive ? "danger" : "secondary"} disabled={busyId === member.id} onClick={() => void toggleActive(member)}>
                        {member.isActive ? "Deactivate" : "Reactivate"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!loading && staff.length === 0 && <EmptyState>No staff accounts yet.</EmptyState>}
          </div>
        </>
      )}
    </div>
  );
}

function OwnProfileCard() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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

  return (
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
  );
}

function InviteForm({ onInvited }: { onInvited: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("staff");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      await StaffApi.registerStaff(email.trim(), password, role);
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
