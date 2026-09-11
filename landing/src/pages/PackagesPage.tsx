import { Link } from "react-router-dom";

/**
 * Real pricing tiers not set yet — see the scoping conversation this page
 * came out of (2026-09-11): rather than invent package names/prices, this
 * ships an honest interim state. Swap PLACEHOLDER for real tiers the
 * moment they're decided — the markup below (.packages-grid/.package-card)
 * is already built to hold them.
 */
export function PackagesPage() {
  return (
    <div className="page-content">
      <section className="page-hero">
        <p className="eyebrow">Packages</p>
        <h1>Pricing, built around a pilot cohort first.</h1>
        <p className="page-hero-sub">
          We're finalizing packages while we work directly with our first businesses. Get in touch and we'll walk you
          through what's available right now.
        </p>
      </section>

      <section className="prose-block">
        <div className="signup-success" style={{ maxWidth: 560 }}>
          <p>
            No published price list yet — <Link to="/contact">contact us</Link> and we'll talk through what fits your
            business. Every account can still <a href="/#signup">start free</a> today.
          </p>
        </div>
      </section>
    </div>
  );
}
