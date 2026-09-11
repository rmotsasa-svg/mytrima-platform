import { useState, type FormEvent } from "react";

/**
 * Real business email/phone not given yet — see the scoping conversation
 * this page came out of (2026-09-11). Deliberately left blank rather than
 * publishing a personal address or a placeholder that could be mistaken
 * for real: the two rows below render automatically, once, the moment
 * these are filled in — nothing to remember to "turn on" elsewhere.
 */
const CONTACT_EMAIL = "";
const CONTACT_PHONE = "";

/** No backend endpoint exists to receive a contact submission yet, so this
 * opens the visitor's own email client with the message pre-filled —
 * functional the moment CONTACT_EMAIL above is a real address, no new
 * backend infrastructure required. Deliberately does NOT guess a fallback
 * address (e.g. "hello@mytrima.co.za") — this domain's email isn't
 * confirmed to receive mail at all, and a fabricated "to" address would
 * silently swallow a real visitor's message into nothing. */
function buildMailto(name: string, email: string, message: string): string {
  const subject = encodeURIComponent(`Message from ${name || "the Mytrima site"}`);
  const body = encodeURIComponent(`${message}\n\n— ${name} (${email})`);
  return `mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`;
}

export function ContactPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    window.location.href = buildMailto(name, email, message);
  }

  return (
    <div className="page-content">
      <section className="page-hero">
        <p className="eyebrow">Contact</p>
        <h1>Talk to us directly.</h1>
        <p className="page-hero-sub">Questions about Mytrima, a package, or your account — reach out and a real person replies.</p>
      </section>

      <section className="prose-block contact-layout">
        {CONTACT_EMAIL ? (
          <form onSubmit={handleSubmit} className="signup-form contact-form">
            <div className="field">
              <label htmlFor="contact-name">Your name</label>
              <input id="contact-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="contact-email">Your email</label>
              <input id="contact-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="contact-message">Message</label>
              <textarea id="contact-message" rows={5} value={message} onChange={(e) => setMessage(e.target.value)} required />
            </div>
            <button type="submit" className="btn btn-primary btn-large">
              Send message
            </button>
          </form>
        ) : (
          <div className="signup-success" style={{ maxWidth: 480 }}>
            <p>
              Direct contact details are being finalized — in the meantime, reach out through{" "}
              <a href="/#signup">the signup form</a> and mention what you'd like to ask.
            </p>
          </div>
        )}

        {(CONTACT_EMAIL || CONTACT_PHONE) && (
          <div className="contact-direct">
            {CONTACT_EMAIL && (
              <div>
                <h3>Email</h3>
                <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
              </div>
            )}
            {CONTACT_PHONE && (
              <div>
                <h3>Phone / WhatsApp</h3>
                <a href={`tel:${CONTACT_PHONE}`}>{CONTACT_PHONE}</a>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
