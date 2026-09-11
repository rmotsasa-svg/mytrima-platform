import { Link } from "react-router-dom";

/**
 * Real pricing and package content, given 2026-09-11 (replacing the
 * earlier price-only version, and before that the "not set yet"
 * placeholder — see this file's own git history). Billing period assumed
 * monthly (not stated explicitly) — the standard SaaS convention.
 *
 * These three paid tiers are consultancy-service engagements layered on
 * top of the software platform — a human-delivered audit, strategy, and
 * implementation service, not a software feature unlock. That's why there
 * is no contradiction with the real fact that the backend has no
 * per-tier feature gating at all (tenant.status is decorative — see the
 * main README's "Self-serve signup" section): every account gets the same
 * software access regardless of tier, because what actually differs
 * between Pro Plus/Growth Plan/Growth Partner is the level of hands-on
 * service Mytrima's own team provides alongside it, not a software
 * capability the app itself would need to unlock.
 *
 * "Includes all Tier 1/Tier 1 & 2 Diagnostic features" in the tenant's own
 * original wording became "Includes everything in <tier name>" below —
 * same cumulative-inclusion claim, just referencing the actual displayed
 * tier names rather than an internal "Tier 1/2" label that appears nowhere
 * else on this page.
 */
const CORE_TIERS = [
  {
    name: "Pro Plus",
    price: 350,
    mostPopular: false,
    tagline: "Ideal for businesses seeking an objective, professional evaluation of their weaknesses before committing capital to changes.",
    features: [
      "Comprehensive 40-Question Growth Audit & Baseline Scoring",
      "Full Competitor Landscape Analysis",
      "End-to-End Customer Journey & Sales Pipeline Assessment",
      "Strategic Identification of Top Capital Leaks",
      "Monthly Executive Summary Reports",
    ],
  },
  {
    name: "Growth Plan",
    price: 420,
    mostPopular: true,
    tagline: "Our most popular tier. Designed for expanding companies that require both the strategy and the execution support to repair revenue leaks.",
    features: [
      "Includes everything in Pro Plus",
      "Customized Growth Strategy Design and 90-Day Action Blueprint",
      "Active Sales Optimization, Scripting, and Pipeline Structuring",
      "Customer Experience Design and Feedback System Deployment",
      "Retention, Reactivation, and Renewal Program Architecture",
      "Live KPI Management Dashboard & Monthly Executive Governance Reports",
      "Direct, hands-on implementation support from our growth specialists",
    ],
  },
  {
    name: "Growth Partner",
    price: 600,
    mostPopular: false,
    tagline:
      "An enterprise-grade, fractional Chief Growth Officer (CGO) engagement. Built for companies scaling quickly that require advanced data infrastructure and organizational alignment.",
    features: [
      "Includes everything in Pro Plus and Growth Plan",
      "Advanced Analytics, Data Modeling, and Attribution Setup",
      "End-to-End CRM System Implementation and Automation",
      "Full Marketing Channel & Spend Optimization",
      "Granular Customer Lifecycle Segmentation and Behavioral Messaging",
      "Custom Staff Performance Tracking & Incentive Systems",
      "Dedicated Monthly Growth Planning Sessions",
      "Quarterly Strategic Boardroom Reviews",
    ],
  },
] as const;

export function PackagesPage() {
  return (
    <div className="page-content">
      <section className="page-hero">
        <p className="eyebrow">Packages</p>
        <h1>Simple pricing, built around real growth.</h1>
        <p className="page-hero-sub">Start free, then move up as your business does. No card required to start.</p>
      </section>

      <section className="package-bookend">
        <div>
          <h3>Start Free</h3>
          <p>
            Explore the platform yourself — the Growth Audit tool, website analytics, bookings, customer experience
            tracking, and sales reporting, self-serve. No consultancy services included.
          </p>
        </div>
        <a href="/#signup" className="btn btn-primary">
          Start free
        </a>
      </section>

      <section className="packages-grid">
        {CORE_TIERS.map((tier) => (
          <div className={tier.mostPopular ? "package-card package-card-featured" : "package-card"} key={tier.name}>
            {tier.mostPopular && <p className="package-badge">Most popular</p>}
            <h3>{tier.name}</h3>
            <p className="package-price">
              R{tier.price}
              <span className="package-price-period">/month</span>
            </p>
            <p className="package-tagline">{tier.tagline}</p>
            <ul className="package-features">
              {tier.features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
            <a href="/#signup" className={tier.mostPopular ? "btn btn-primary" : "btn btn-ghost"}>
              Get started
            </a>
          </div>
        ))}
      </section>

      <section className="package-bookend">
        <div>
          <h3>Enterprise</h3>
          <p>For organizations that need something beyond Growth Partner — multiple locations, custom infrastructure, or a bespoke engagement. Tell us what you need and we'll scope it.</p>
        </div>
        <Link to="/contact" className="btn btn-ghost">
          Request a quote
        </Link>
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
