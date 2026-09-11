export function AboutPage() {
  return (
    <div className="page-content">
      <section className="page-hero">
        <p className="eyebrow">About us</p>
        <h1>Growth tooling shouldn't be out of reach.</h1>
        <p className="page-hero-sub">
          Most growth-consultancy advice is built for businesses that can already afford a consultancy. Mytrima exists
          for the ones that can't yet — a real toolkit instead of a report you pay for once and file away.
        </p>
      </section>

      <section className="prose-block">
        <h2>Why we built this</h2>
        <p>
          A Growth Audit, a website analytics setup, a booking system, a way to actually see what customers think —
          each one is normally its own subscription, its own login, its own learning curve. For a business run by one
          or two people between customers, that adds up to more admin than growth. Mytrima puts the tools a growth
          consultancy would recommend into one dashboard, priced and built for that reality.
        </p>
      </section>

      <section className="prose-block">
        <h2>What we believe</h2>
        <div className="belief-grid">
          <div className="belief-card">
            <h3>Real data over guesswork</h3>
            <p>Every number on your dashboard comes from something that actually happened — a real sale, a real visit, a real rating. Never a projection dressed up as a fact.</p>
          </div>
          <div className="belief-card">
            <h3>Built for a phone, not a desk</h3>
            <p>Most of the businesses we're building for run day to day from a phone. Mytrima is designed around that, not adapted to it as an afterthought.</p>
          </div>
          <div className="belief-card">
            <h3>Honest about what's not there yet</h3>
            <p>We're early. Where something isn't built yet, we'd rather say so than pretend otherwise.</p>
          </div>
        </div>
      </section>

      <section className="prose-block">
        <h2>Where we are</h2>
        <p>Based in Maseru, Lesotho, building for businesses across the country.</p>
      </section>
    </div>
  );
}
