const GROUPS = [
  {
    outcome: "Understand your business",
    items: [
      {
        title: "Growth Audit",
        body: "A real 40-question instrument, scored across seven sections. Answer once, get a weighted score, a band (from Weak to Strong), and specific actions for whatever scored lowest — not a generic checklist everyone gets the same result on.",
      },
    ],
  },
  {
    outcome: "Get found and understood",
    items: [
      {
        title: "Website analytics",
        body: "Paste one line into your site and start seeing real visits — pages, referrers, devices, sessions. No Google Analytics account to connect, no cookie banner required: sessions reset every browser visit, and visitor IPs and exact devices are never stored.",
      },
      {
        title: "Customer experience",
        body: "Star ratings and NPS, collected the moment a customer is willing to give it, rolled into one real average. See what's working and what isn't without chasing anyone down for feedback.",
      },
    ],
  },
  {
    outcome: "Run the day to day",
    items: [
      {
        title: "Bookings",
        body: "A public booking link your customers use directly — no account needed on their side. Confirm, decline, or mark no-shows from your own dashboard.",
      },
      {
        title: "Sales & reporting",
        body: "Record a sale in seconds. See conversion rate, repeat rate, and customer lifetime value computed from what you've actually sold — not projected.",
      },
    ],
  },
];

export function SolutionPage() {
  return (
    <div className="page-content">
      <section className="page-hero">
        <p className="eyebrow">Our solution</p>
        <h1>Everything a growth consultancy would tell you to track — already built.</h1>
        <p className="page-hero-sub">
          Grouped by what each one is actually for, not by feature name — because that's the order a real business
          needs them in.
        </p>
      </section>

      {GROUPS.map((group) => (
        <section className="solution-group" key={group.outcome}>
          <h2>{group.outcome}</h2>
          <div className="feature-grid">
            {group.items.map((item) => (
              <div className="feature-card" key={item.title}>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </div>
            ))}
          </div>
        </section>
      ))}

      <section className="prose-block">
        <h2>One dashboard, one login</h2>
        <p>
          Every module above lives in one place — built for a business running on a phone between customers, not a
          spreadsheet on a desk. No separate subscription per tool, no separate password to remember.
        </p>
      </section>
    </div>
  );
}
