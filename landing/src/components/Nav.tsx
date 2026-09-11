import { NavLink } from "react-router-dom";

/** Same env-var-with-a-default pattern as api.ts's own API_BASE_URL —
 * where "Sign in" points. Deliberately not a route on this site: it's the
 * frontend/ SPA's own login, a completely different deployed app. */
const APP_URL: string = (import.meta.env.VITE_APP_URL as string | undefined) ?? "http://localhost:5173";

const NAV_LINKS = [
  { to: "/", label: "Home" },
  { to: "/about", label: "About us" },
  { to: "/solution", label: "Our solution" },
  { to: "/packages", label: "Packages" },
  { to: "/success-stories", label: "Success stories" },
  { to: "/contact", label: "Contact" },
];

export function Nav() {
  return (
    <header className="topbar">
      <a href="/" className="topbar-brand">
        <img src="/brand/lockup-horizontal-light.svg" alt="Mytrima" className="topbar-logo" />
      </a>
      <nav className="topbar-nav">
        {NAV_LINKS.map((link) => (
          <NavLink key={link.to} to={link.to} end={link.to === "/"} className={({ isActive }) => (isActive ? "topbar-link is-active" : "topbar-link")}>
            {link.label}
          </NavLink>
        ))}
      </nav>
      <a href={APP_URL} className="topbar-signin">
        Sign in
      </a>
    </header>
  );
}
