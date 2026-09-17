# Mytrima Terraform state backend — bootstrap

Creates the S3 bucket + DynamoDB lock table `../terraform`'s own remote state backend
needs. Deliberately a separate stack with its own local state — see `main.tf`'s own top
comment for why this can't just be folded into `../terraform` itself (a real
chicken-and-egg problem: the backend has to exist before Terraform can use it).

## Status: validated, not yet applied

`terraform validate`/`fmt` both pass (real HashiCorp AWS provider v5.100.0, checked
against its own current schema — not memory). Never `plan`'d or `apply`'d — same reason
as everywhere else in `../terraform`: that needs real AWS credentials this assistant
does not have and should not be given.

## Running this

```bash
cd infra/terraform-bootstrap
terraform init
terraform plan     # READ THIS before applying
terraform apply    # creates a real S3 bucket + DynamoDB table
```

Then note the two outputs (`state_bucket_name`, `lock_table_name`) and follow
`../terraform/main.tf`'s own "ACTIVATING THIS BACKEND" comment to point the main stack at
them.

## What this creates

- An S3 bucket (`mytrima-terraform-state-<account id>`) — versioned, AES256-encrypted,
  every public-access path blocked, `prevent_destroy` set so an accidental `terraform
  destroy` here can't silently delete every past state file the main stack depends on.
- A DynamoDB table (pay-per-request, no fixed capacity to pay for while idle) for state
  locking, using Terraform's own required `LockID` hash key.

## Why this exists now, specifically

`../terraform/ses-smtp-credentials.tf` pushes a real SES SMTP secret into Terraform state
at creation time (an inherent IAM limitation — see that file's own top comment). Local
state with no encryption-at-rest guarantee beyond the host filesystem, and no locking if
a second person or CI pipeline ever touches this, mattered less before that secret existed
in it. This closes that gap.
