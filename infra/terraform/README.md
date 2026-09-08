# Mytrima Infrastructure — AWS Africa (Cape Town)

Terraform for the pilot-stage RDS PostgreSQL instance and ElastiCache Redis cache, sized
and priced against [`../../hosting-cost-comparison.md`](../../hosting-cost-comparison.md)
— the decision that document records (2026-09-07) is AWS Africa (Cape Town), `af-south-1`.

## Status: validated, not applied

`terraform validate` has actually been run against this configuration (real HashiCorp AWS
provider v5.100.0, downloaded and checked against — not assumed) and **passes**:
`Success! The configuration is valid.` Every resource argument was checked against the
AWS provider's own current documentation before being written, not against memory.

**What this does NOT mean**: this has never been `terraform plan`'d or `apply`'d against
a real AWS account — that needs real AWS credentials, which this assistant does not have
and should not be given (creating AWS accounts/access keys is the kind of account-level
action a human does, not an AI agent). `validate` proves the configuration is internally
consistent and matches the provider's schema; it says nothing about whether the *plan*
would actually succeed against your specific account (VPC quirks, service limits, IAM
permissions, etc. can only be found by actually running `plan`).

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
- Security groups scoping both to the default VPC's own CIDR — never publicly accessible.

## What this deliberately does NOT create, and why

- **No dedicated VPC** — uses the account's existing default VPC/subnets. Per Master Plan
  Section 2 ("right-size before scale"), building dedicated networking for a 5–10 tenant
  pilot with no app-hosting compute even defined yet is complexity ahead of an actual
  need. Revisit once a real compute resource (ECS/EC2/etc.) exists — at that point, the
  security groups in `network.tf` should reference that resource's security group
  specifically instead of the whole VPC CIDR.
- **No remote state backend** (S3 + DynamoDB lock table) — local state only for now. Fine
  for one person iterating; unsafe (no locking, easy to lose) the moment a second person
  or a CI pipeline touches this. Add an S3 backend block in `main.tf` once that bucket
  exists.
- **No app-hosting compute** (ECS, EC2, Lambda, etc.) — the Master Plan's own Stage 1
  topology doesn't specify one yet beyond "single app instance," and inventing a specific
  compute choice here would be scope this document didn't ask for.

## Before this touches real tenant data

Per the pilot-only choices flagged inline in `rds.tf`: `skip_final_snapshot = true` and
`deletion_protection = false` make this instance trivial to tear down during early
iteration, at the direct cost of easy accidental data loss. Flip both before any real
customer's data lands here — and get the security advisor review the main README's
checklist already calls for before the first real tenant record is written.
