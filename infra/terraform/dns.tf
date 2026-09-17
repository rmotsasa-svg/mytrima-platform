/**
 * `mytrima.co.za` — the tenant's own explicit domain decision (2026-09-17),
 * resolving what used to be an inconsistent `.co.za`/`.co.ls` mix across
 * this repo (see privacy-policy.html/README.md's own git history for that
 * fix). NOT YET APPLIED, same status as every other resource in this
 * directory (main.tf's own top comment).
 *
 * REAL PREREQUISITE THIS DOES NOT DO: registering the domain itself.
 * `.co.za` is not on AWS Route53's own registerable-TLD list — it must be
 * registered through a ZADNA-accredited South African registrar. This
 * file only creates a Route53 HOSTED ZONE to manage its DNS from AWS,
 * regardless of where it's registered.
 *
 * REAL RISK if mishandled, flagged loudly because this is genuinely easy
 * to get wrong: `mytrima.co.za` already has real, live email addresses in
 * use today (rmotsasa@mytrima.co.za, info@mytrima.co.za — see
 * privacy-policy.html) via whatever mail provider currently serves them.
 * This zone starts EMPTY of those records. Pointing the domain's
 * registrar-side nameservers at this zone's `name_servers` output (see
 * outputs.tf) before recreating the domain's EXISTING MX/mail records
 * here first would break real email delivery. Export the current DNS
 * records from wherever they're managed today and add them to this zone
 * BEFORE cutting over nameservers — do not skip this.
 */

resource "aws_route53_zone" "primary" {
  name    = var.domain_name
  comment = "Mytrima ${var.environment} — managed by Terraform"
  tags    = local.common_tags
}

# The backend API's own real subdomain — matches WEB_PUBLIC_BASE_URL/
# API_PUBLIC_BASE_URL's existing production convention (README.md's own
# "A real SPA frontend" section) and HomePage.tsx's already-written
# `https://api.mytrima.co.za/analytics/tracker.js` reference. Points at
# the app instance's own Elastic IP (compute.tf).
#
# DELIBERATELY NOT created here: app./admin./the bare domain + www. —
# those belong to the three static SPAs (frontend/landing/admin), whose
# hosting (S3+CloudFront or equivalent) hasn't been decided/provisioned
# in this directory yet. Adding DNS for a target that doesn't exist would
# be worse than not having it. Add those records once that hosting does.
#
# Also not yet reachable over HTTPS — nothing is listening on 443 on the
# app instance yet (see compute.tf's own security-group comment on the
# ACME HTTP-01 challenge a reverse proxy there will eventually need); this
# record is real DNS, not a claim that the API is live-servable today.
resource "aws_route53_record" "api" {
  zone_id = aws_route53_zone.primary.zone_id
  name    = "api.${var.domain_name}"
  type    = "A"
  ttl     = 300
  records = [aws_eip.app.public_ip]
}

/**
 * Closes the real, disclosed prerequisite README.md's own "Sending the
 * actual email" section names: "SES needs domain/DKIM DNS verification
 * on mytrima.co.za before it can actually send from a real address."
 * Domain + DKIM identity verification only PROVES ownership of the
 * domain to SES — it is not a secret and is safe to manage in Terraform
 * state. The real SMTP credentials themselves are generated in
 * ses-smtp-credentials.tf — see that file's own top comment for the
 * honest limitation of doing that via Terraform at all, versus by hand.
 */
resource "aws_ses_domain_identity" "primary" {
  domain = var.domain_name
}

resource "aws_route53_record" "ses_verification" {
  zone_id = aws_route53_zone.primary.zone_id
  name    = "_amazonses.${var.domain_name}"
  type    = "TXT"
  ttl     = 600
  records = [aws_ses_domain_identity.primary.verification_token]
}

resource "aws_ses_domain_dkim" "primary" {
  domain = aws_ses_domain_identity.primary.domain
}

# SES's own DKIM setup needs exactly 3 CNAME records, one per generated
# token — count = 3 matches dkim_tokens' own fixed-length list (confirmed
# against the provider's docs, not assumed).
resource "aws_route53_record" "ses_dkim" {
  count   = 3
  zone_id = aws_route53_zone.primary.zone_id
  name    = "${aws_ses_domain_dkim.primary.dkim_tokens[count.index]}._domainkey.${var.domain_name}"
  type    = "CNAME"
  ttl     = 600
  records = ["${aws_ses_domain_dkim.primary.dkim_tokens[count.index]}.dkim.amazonses.com"]
}
