import { Link } from "react-router-dom";

/**
 * No real, permissioned customer story is loaded here yet — see the
 * scoping conversation this page came out of (2026-09-11): rather than
 * invent a testimonial or a result, this ships an honest "just starting
 * out" state. Swap PLACEHOLDER for a real business name, quote, and
 * result the moment one is confirmed — the markup below
 * (.story-card/.story-quote) is already built to hold it.
 */
export function SuccessStoriesPage() {
  return (
    <div className="page-content">
      <section className="page-hero">
        <p className="eyebrow">Success stories</p>
        <h1>We're just getting started.</h1>
        <p className="page-hero-sub">
          Mytrima is early — real stories from real businesses using it will show up here as they come in, not before.
        </p>
      </section>

      <section className="prose-block">
        <div className="signup-success" style={{ maxWidth: 560 }}>
          <p>
            Using Mytrima and want to be one of the first businesses featured here? <Link to="/contact">Get in touch</Link>.
          </p>
        </div>
      </section>
    </div>
  );
}
