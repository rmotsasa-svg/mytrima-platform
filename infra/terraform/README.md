# Mytrima Infrastructure — AWS Africa (Cape Town)

Terraform for the pilot-stage RDS PostgreSQL instance, ElastiCache Redis cache, and (added
2026-09-17, closing the gap this file used to flag under "What this deliberately does NOT
create") a single EC2 app instance, sized and priced against
[`../../hosting-cost-comparison.md`](../../hosting-cost-comparison.md) — the decision that
document records (2026-09-07) is AWS Africa (Cape Town), `af-south-1`.

## Status: validated, pinned to a real account, not yet applied

`terraform validate` has actually been run against this configuration (real HashiCorp AWS
provider v5.100.0, downloaded and checked against — not assumed) and **passes**:
`Success! The configuration is valid.` Every resource argument was checked against the
AWS provider's own current documentation before being written, not against memory.

**The real target account was provided 2026-09-11**: `284460774146`, now wired into the
`aws` provider block via `allowed_account_ids` (see `main.tf`/`variables.tf`). This is a
pure safety check, not a credential — it makes `plan`/`apply` refuse to run at all the
moment they're pointed at credentials for any *other* account, rather than silently
provisioning real, billed resources somewhere unintended. Re-validated after adding it:
still `Success! The configuration is valid.`

**What this does NOT mean**: this has never been `terraform plan`'d or `apply`'d against
the real account — that needs real AWS *credentials* (an access key, an SSO profile, or
similar), which this assistant does not have and should not be given (creating access
keys and running `plan`/`apply` against a real, billed account is the kind of
account-level, real-money action a human does, not an AI agent). `validate` proves the
configuration is internally consistent and matches the provider's schema, and the account
pin above proves it will at least refuse to run against the wrong account; neither says
anything about whether the *plan* would actually succeed against this specific account's
real state (VPC quirks, service limits, IAM permissions, the `af-south-1` opt-in
requirement below, etc. can only be found by actually running `plan`).

## Prerequisites

1. **An AWS account** with billing set up.
2. **`af-south-1` enabled** — it's an AWS "opt-in region," off by default. Enable it under
   Account → AWS Regions in the console before running `terraform plan`/`apply`, or the
   first apply fails with `OptInRequired`.
3. **AWS credentials** available to Terraform — typically `aws configure` (AWS CLI) or the
   `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` environment variables. Never commit these,
   and never put them in a `.tfvars` file that gets committed (see `.gitignore`).
4. **Terraform** `>= 1.5` and the AWS provider `~> 5.0` (pinned in `.terraform.lock.hcl`,
   which — unlike everything else Terraform generates locally — IS meant to be committed).

## Running this

```bash
cd infra/terraform
terraform init      # downloads the AWS provider — already done once, safe to re-run
terraform plan       # shows what would be created — READ THIS before applying
terraform apply      # actually creates real AWS resources that cost real money
```

## What this creates

- An RDS PostgreSQL instance (`db.t4g.micro` by default — see `variables.tf`), encrypted
  at rest, with its master password **auto-managed by AWS Secrets Manager** (RDS's native
  `manage_master_user_password` feature — no password is ever set, seen, or stored by
  Terraform, this repo, or its state file).
- An ElastiCache Redis replication group (`cache.t4g.micro` by default), single node, with
  both at-rest and in-transit encryption enabled.
- **A single EC2 app instance** (`t4g.small` by default — see `variables.tf`, `compute.tf`)
  matching this project's own Stage 1 "single app instance" topology: Amazon Linux 2023
  (arm64, matching the Graviton family used everywhere else here), Docker pre-installed via
  `user_data`, a stable Elastic IP, and shell access via **SSM Session Manager only** — no
  SSH key pair to manage or leak, no port 22 ever opened.
- Security groups: Postgres/Redis now scope their ingress to the app instance's own security
  group specifically (not the whole default VPC CIDR — this file used to flag that as a gap;
  resolved now that a real compute resource exists to scope to). The app instance's own
  security group allows 80/443 from anywhere (it's the public-facing piece) and nothing else
  inbound.
- **A Route53 hosted zone for `mytrima.co.za`** (`dns.tf`) — the tenant's own explicit
  domain decision (2026-09-17). An `api.mytrima.co.za` A record already points at the app
  instance's Elastic IP. **Read `dns.tf`'s own top comment before ever applying this** —
  the domain already has real, live email addresses in use today; cutting nameservers over
  to this zone before it also has those existing mail records recreated in it would break
  them.
- **SES domain + DKIM verification for `mytrima.co.za`** (`dns.tf`) — closes the exact
  prerequisite README.md's own "Sending the actual email" section named as outstanding.
  Only proves domain ownership to SES; not a secret, safe in Terraform state.
- **Real SES SMTP credentials** (`ses-smtp-credentials.tf`) — a dedicated IAM user scoped
  to nothing but sending mail as this one verified identity, its access key converted into
  an SMTP password via Terraform's own SigV4 computation, pushed straight into a Secrets
  Manager secret the app fetches at runtime. **Read that file's own top comment before
  applying**: unlike `rds.tf`'s password, this secret genuinely does pass through
  Terraform state at creation time — there's no IAM/SES equivalent of RDS's own
  AWS-manages-it-and-Terraform-never-sees-it feature. Get a real remote state backend
  (see the gap below) in place before this matters more than it already does.

## What this deliberately does NOT create, and why

- **No dedicated VPC** — uses the account's existing default VPC/subnets. Per Master Plan
  Section 2 ("right-size before scale"), building dedicated networking for a 5–10 tenant
  pilot is complexity ahead of an actual need.
- **No remote state backend** (S3 + DynamoDB lock table) — local state only for now. Fine
  for one person iterating; unsafe (no locking, easy to lose) the moment a second person
  or a CI pipeline touches this. Add an S3 backend block in `main.tf` once that bucket
  exists.
- **No deployed application, no TLS.** `compute.tf`'s own top comment is explicit about
  this: this provisions a real, running instance with Docker installed and reachable — it
  does not decide how a build actually gets onto it (an ECR image + a pull step, a CI job
  that pushes a build and restarts a systemd unit, etc.), and there's no ACM certificate
  because ACM only attaches to an ALB/CloudFront/API Gateway, none of which exist yet — a
  bare EC2 instance needs its own reverse proxy (e.g. Caddy) doing its own Let's Encrypt
  ACME HTTP-01 challenge instead, which is exactly why port 80 stays open in the app
  security group. Both are real next decisions, not guessed at here.
- **No DNS records yet for `app.`/`admin.`/the bare domain/`www.`** — those belong to the
  three static SPAs (`frontend/`/`admin/`/`landing/`), whose hosting (S3+CloudFront or
  equivalent) hasn't been decided/provisioned in this directory yet. Add those once it is.

## Production environment variables this domain decision now has real answers for

Once this is applied and the app is actually reachable, set (see the main README's own
env-var references for what each controls):

```
API_PUBLIC_BASE_URL=https://api.mytrima.co.za
APP_BASE_URL=https://app.mytrima.co.za
WEB_PUBLIC_BASE_URL=https://app.mytrima.co.za
CORS_ORIGIN=https://app.mytrima.co.za,https://admin.mytrima.co.za,https://mytrima.co.za,https://www.mytrima.co.za
EMAIL_FROM_ADDRESS=Mytrima <noreply@mytrima.co.za>
```

`app.`/`admin.`/the bare domain in `CORS_ORIGIN` above are still real URLs, not live ones
yet — see "What this deliberately does NOT create" above for why their DNS records don't
exist in this directory yet.

## Before this touches real tenant data

Per the pilot-only choices flagged inline in `rds.tf`: `skip_final_snapshot = true` and
`deletion_protection = false` make this instance trivial to tear down during early
iteration, at the direct cost of easy accidental data loss. Flip both before any real
customer's data lands here — and get the security advisor review the main README's
checklist already calls for before the first real tenant record is written.
