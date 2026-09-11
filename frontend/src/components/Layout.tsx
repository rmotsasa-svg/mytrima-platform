import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Button } from "./ui";
import "./Layout.css";

const NAV_ITEMS: { to: string; label: string }[] = [
  { to: "/", label: "Snapshot" },
  { to: "/onboarding", label: "Getting started" },
  { to: "/growth-audit", label: "Growth audit" },
  { to: "/customer-experience", label: "Customer experience" },
  { to: "/reports", label: "Reports" },
  { to: "/sales", label: "Sales" },
  { to: "/customers", label: "Customers" },
  { to: "/catalog", label: "Catalog" },
  { to: "/bookings", label: "Bookings" },
  { to: "/staff", label: "Staff" },
  { to: "/support", label: "Support" },
  { to: "/settings", label: "Settings" },
];

export function Layout() {
  const { session, logout } = useAuth();
  const profile = session.status === "loggedIn" ? session.profile : null;

  return (
    <div className="shell">
      <aside className="shell-nav">
        <div className="shell-brand">
          <img src="/brand/lockup-horizontal-dark-compact.svg" alt="Mytrima" />
        </div>
        <nav>
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === "/"} className={({ isActive }) => (isActive ? "shell-link active" : "shell-link")}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="shell-account">
          {profile && (
            <>
              <div className="shell-account-email">{profile.email}</div>
              <div className="shell-account-role">{profile.role.replace("_", " ")}</div>
            </>
          )}
          <Button variant="ghost" onClick={() => void logout()}>
            Sign out
          </Button>
        </div>
      </aside>
      <main className="shell-content">
        <Outlet />
      </main>
    </div>
  );
}
