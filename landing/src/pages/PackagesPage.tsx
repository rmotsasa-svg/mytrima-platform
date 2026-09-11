import { Link } from "react-router-dom";

/**
 * Real pricing, given 2026-09-11. Billing period assumed monthly — the
 * standard SaaS convention, not stated explicitly when these figures were
 * given; confirm if that's wrong and this is a one-time or annual figure
 * instead.
 *
 * KNOWN GAP, deliberately not hidden: no billing/tier enforcement exists
 * anywhere in the backend yet (tenant.status is decorative — see the main
 * README's "Self-serve signup" section). Every account created through
 * POST /auth/tenants gets full, identical access regardless of which
 * package a visitor clicks here. This page displays real prices; charging
 * for them and gating features by tier is a separate, not-yet-built
 * project. Not disclosed on the page itself (a customer doesn't need that
 * detail), only here.
 */
const PACKAGES = [
  { name: "Start Free", price: null, cta: "Start free", to: "/#signup" },
  { name: "Pro Plus", price: 350, cta: "Get started", to: "/#signup" },
  { name: "Growth Plan", price: 420, cta: "Get started", to: "/#signup" },
  { name: "Growth Plus", price: 600, cta: "Get started", to: "/#signup" },
  { name: "Enterprise", price: "quote", cta: "Request a quote", to: "/contact" },
] as const;

function PriceTag({ price }: { price: number | "quote" | null }) {
  if (price === null) {
    return <p className="package-price">Free</p>;
  }
  if (price === "quote") {
    return <p className="package-price package-price-quote">Request a quote</p>;
  }
  return (
    <p className="package-price">
      R{price}
      <span className="package-price-period">/month</span>
    </p>
  );
}

export function PackagesPage() {
  return (
    <div className="page-content">
      <section className="page-hero">
        <p className="eyebrow">Packages</p>
        <h1>Simple pricing, built around real growth.</h1>
        <p className="page-hero-sub">Start free, then move up as your business does. No card required to start.</p>
      </section>

      <section className="packages-grid">
        {PACKAGES.map((pkg) => (
          <div className="package-card" key={pkg.name}>
            <h3>{pkg.name}</h3>
            <PriceTag price={pkg.price} />
            {pkg.to.startsWith("/#") ? (
              <a href={pkg.to} className="btn btn-primary">
                {pkg.cta}
              </a>
            ) : (
              <Link to={pkg.to} className="btn btn-ghost">
                {pkg.cta}
              </Link>
            )}
          </div>
        ))}
      </section>

      <section className="prose-block">
        <p>
          Not sure which fits? <Link to="/contact">Talk to us</Link> — we'll help you pick the right one for where your
          business is right now.
        </p>
      </section>
    </div>
  );
}
