/**
 * Mytrima infrastructure — AWS Africa (Cape Town), af-south-1.
 * Per Master Plan Section 4 ("Terraform from day one") and the hosting
 * decision recorded in hosting-cost-comparison.md (2026-09-07).
 *
 * NOT YET APPLIED — same "written, not run" honesty standard as every SQL
 * migration in db/migrations/. Every resource argument below was checked
 * against the AWS provider's own current documentation (not memory) before
 * being written; `terraform validate`/`plan` have not been run against a
 * real AWS account in this environment (that requires AWS credentials this
 * assistant does not have and should not be given — see README.md's
 * "AWS Cape Town vs. Azure South Africa" section on why account creation
 * and credential handling are the user's to do, not this assistant's).
 */

terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # KNOWN GAP: local state only — matters more now than it used to, since
  # ses-smtp-credentials.tf's own real secret lives in this state file (see
  # that file's own top comment). ../terraform-bootstrap creates the S3
  # bucket + DynamoDB lock table this needs; a backend block can't
  # reference a variable (a real Terraform constraint, not a style choice),
  # so the values below are the exact literal names that stack's own
  # defaults produce — deterministic, not guessed. See
  # ../terraform-bootstrap/main.tf's own top comment for why this can't
  # just be applied automatically as part of this same stack.
  #
  # ACTIVATING THIS BACKEND, once ../terraform-bootstrap has been applied:
  #   1. Uncomment the backend "s3" block below.
  #   2. Run `terraform init` in this directory — it will offer to migrate
  #      the existing local state into the bucket. Say yes.
  #   3. Confirm with `terraform plan` that it shows no changes (proving
  #      the migrated state matches what's actually running) before
  #      deleting the local terraform.tfstate* files by hand.
  #
  # backend "s3" {
  #   bucket         = "mytrima-terraform-state-284460774146"
  #   key            = "pilot/terraform.tfstate"
  #   region         = "af-south-1"
  #   dynamodb_table = "mytrima-terraform-lock"
  #   encrypt        = true
  # }
}

provider "aws" {
  region = var.aws_region

  # Real safety check, added 2026-09-11 once the target account (284460774146)
  # was actually given: makes any plan/apply fail immediately, before
  # touching a single resource, if the AWS credentials in use resolve to a
  # different account than the one this configuration is meant for — the
  # kind of mistake that's cheap to catch here and expensive (real billed
  # resources in the wrong account) to catch after the fact.
  allowed_account_ids = [var.aws_account_id]
}
